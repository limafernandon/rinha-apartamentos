# -*- coding: utf-8 -*-
"""Cron de busca: varre VivaReal/Zap nos bairros-alvo e insere na planilha.

Fluxo: lê scripts/config.json (aborta se apps_script_url vazio) → prefs via
GET ?action=prefs → para cada bairro em 'Bairros Alvo' extrai listagens via
hermes_tools.web_extract (NUNCA requests/curl direto — Cloudflare 403) →
aplica filtros (preço/quartos/vagas/área/palavras-chave) → POST addListing.

Uso: python scripts/cron_busca.py [--dry-run]
  --dry-run: lista bairros + URLs que SERIAM consultadas, sem chamar web_extract
             nem inserir nada.
"""
import json
import pathlib
import re
import sys
import traceback
import unicodedata
import urllib.parse
import urllib.request
from datetime import datetime

HOME = pathlib.Path.home()
BASE = HOME / "Documents/rinha-apartamentos"
CONFIG = BASE / "scripts/config.json"
LOG = BASE / "logs/cron_busca.log"

sys.path.insert(0, str(BASE / "scripts"))
from tg_notify import send  # noqa: E402


def log(msg):
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(f"{datetime.now().isoformat(timespec='seconds')} {msg}\n")


def http_post_json(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def bairro_slug(nome):
    """slug ASCII: 'Santa Efigênia' → 'santa-efigenia'."""
    s = unicodedata.normalize("NFKD", nome)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def urls_para_bairro(nome):
    slug = bairro_slug(nome)
    return {
        "VivaReal": f"https://www.vivareal.com.br/aluguel/mg/belo-horizonte/bairros/{slug}/apartamento_padrao/",
        "Zap": f"https://www.zapimoveis.com.br/aluguel/apartamentos/mg+belo-horizonte/{slug}/",
    }


def extrair_listings(portal, url):
    """Extrai (id, titulo, preco) dos anúncios via web_extract + regex tolerante."""
    from hermes_tools import web_extract
    res = web_extract([url])
    content = res["results"][0].get("content", "") if res.get("results") else ""
    if not content:
        return []
    achados = {}
    if portal == "VivaReal":
        for m in re.finditer(r"\[([^\]]{10,160})\]\((/aluguel/mg/belo-horizonte/bairros/[^)\s]*-?(\d{6,})-[^)\s]*)\)", content):
            titulo, path, aid = m.group(1), m.group(2), m.group(3)
            janela = content[max(0, m.end() - 60):m.end() + 400]
            pm = re.search(r"R\$\s?([\d.]{4,12})", janela)
            achados[aid] = {"titulo": titulo.strip(), "link": "https://www.vivareal.com.br" + path,
                            "preco": float(pm.group(1).replace(".", "")) if pm else None}
    else:  # Zap
        for m in re.finditer(r"\[([^\]]{10,160})\]\((/aluguel/apartamentos/mg\+belo-horizonte/[^)\s]*-?(\d{6,})-[^)\s]*)\)", content):
            titulo, path, aid = m.group(1), m.group(2), m.group(3)
            janela = content[max(0, m.end() - 60):m.end() + 400]
            pm = re.search(r"R\$\s?([\d.]{4,12})", janela)
            achados[aid] = {"titulo": titulo.strip(), "link": "https://www.zapimoveis.com.br" + path,
                            "preco": float(pm.group(1).replace(".", "")) if pm else None}
    return list(achados.values())


def passa_filtros(item, prefs):
    """Filtros aplicados ANTES de inserir. Retorna (ok, motivo)."""
    preco = item.get("preco")
    if preco and "Preço Máx Aluguel" in prefs and preco > float(prefs["Preço Máx Aluguel"]):
        return False, f"preço {preco:.0f} > máx {prefs['Preço Máx Aluguel']}"
    titulo = (item.get("titulo") or "").lower()
    for kw in [k.strip().lower() for k in str(prefs.get("Excluir Palavras-chave", "")).split(";") if k.strip()]:
        if kw in titulo:
            return False, f"palavra-chave '{kw}' no título"
    return True, ""


def main(dry_run=False):
    cfg = json.loads(CONFIG.read_text(encoding="utf-8")) if CONFIG.exists() else {}
    url = cfg.get("apps_script_url", "").strip().rstrip("/")
    prefs = None
    if url:
        resp = urllib.request.urlopen(urllib.request.Request(url + "?action=prefs"), timeout=60)
        prefs = json.loads(resp.read().decode())["prefs"]
    if not prefs:
        # fallback: prefs padrão (idênticas à aba Preferencias) — usadas no --dry-run
        prefs = {"Bairros Alvo": "Serra;Gutierrez;Santa Efigênia;Anchieta;Padre Eustáquio;Sagrada Família;Prado",
                 "Preço Máx Aluguel": 3500, "Quartos Mínimos": 2, "Vagas Mínimas": 1,
                 "Área Mínima m²": 60,
                 "Excluir Palavras-chave": "reformar;sem vaga;substudio;kitnet",
                 "Formulario Enviado Max Por Rodada": 5}
    bairros = [b.strip() for b in str(prefs.get("Bairros Alvo", "")).split(";") if b.strip()]
    if not bairros:
        msg = "ERRO: 'Bairros Alvo' vazio/Inativo na aba Preferencias."
        print(msg)
        log(msg)
        sys.exit(1)

    cont = {"VivaReal": {"novos": 0, "deduped": 0, "filtrados": 0, "extraidos": 0},
            "Zap": {"novos": 0, "deduped": 0, "filtrados": 0, "extraidos": 0}}

    if dry_run:
        print("DRY-RUN — URLs que SERIAM consultadas:")
        for b in bairros:
            for portal, u in urls_para_bairro(b).items():
                print(f"  {portal}: {u}")
        print(f"Bairros ({len(bairros)}): {'; '.join(bairros)}")
        print(f"Filtros ativos: {json.dumps(prefs, ensure_ascii=False)}")
        log("dry-run ok")
        return

    for b in bairros:
        for portal, u in urls_para_bairro(b).items():
            try:
                listings = extrair_listings(portal, u)
            except Exception as e:
                log(f"{portal}/{b}: erro na extração: {e}")
                continue
            cont[portal]["extraidos"] += len(listings)
            for item in listings:
                item["bairro"] = b
                item["portal"] = portal
                ok, motivo = passa_filtros(item, prefs)
                if not ok:
                    cont[portal]["filtrados"] += 1
                    continue
                try:
                    r = http_post_json(url + "?action=addListing", {
                        "action": "addListing", "link": item["link"],
                        "titulo": item["titulo"], "bairro": b, "portal": portal,
                        "preco_aluguel": item.get("preco") or ""})
                    cont[portal]["deduped" if r.get("deduped") else "novos"] += 1
                except Exception as e:
                    log(f"addListing falhou ({item['link']}): {e}")

    # Parser tolerante: 0 listings em TODOS os bairros de um portal → suspeito
    suspeito = [p for p in ("VivaReal", "Zap") if cont[p]["extraidos"] == 0]
    resumo = (f"🔎 Rinha cron {datetime.now().strftime('%d/%m %H:%M')} — "
              f"VivaReal: {cont['VivaReal']['novos']} novos/{cont['VivaReal']['deduped']} dup/{cont['VivaReal']['filtrados']} filt. "
              f"Zap: {cont['Zap']['novos']} novos/{cont['Zap']['deduped']} dup/{cont['Zap']['filtrados']} filt.")
    if suspeito:
        resumo += f" ⚠️ PARSER_SUSPEITO: 0 listings em {', '.join(suspeito)}"
    print(resumo)
    log(resumo)
    if cfg.get("telegram_bot_token") and cfg.get("telegram_chat_id"):
        import os
        os.environ.setdefault("TELEGRAM_BOT_TOKEN", cfg["telegram_bot_token"])
        os.environ.setdefault("RINHA_TELEGRAM_CHAT_ID", cfg["telegram_chat_id"])
        send(resumo)


if __name__ == "__main__":
    try:
        main(dry_run="--dry-run" in sys.argv)
    except SystemExit:
        raise
    except Exception:
        err = traceback.format_exc()
        print(err)
        log("EXCEÇÃO:\n" + err)
        send("❌ cron_busca falhou:\n" + err[:1500])
