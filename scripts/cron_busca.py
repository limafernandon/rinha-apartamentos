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
import time
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
        "VivaReal": f"https://www.vivareal.com.br/aluguel/minas-gerais/belo-horizonte/bairros/{slug}/apartamento_residencial/",
        "Zap": f"https://www.zapimoveis.com.br/aluguel/apartamentos/mg+belo-horizonte++{slug}/",
    }


def parse_zap_ldjson(ld_text):
    """Parser do Zap: ItemList JSON-LD embutido. Retorna lista de listings."""
    items = []
    for block in re.findall(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>',
                            ld_text, re.S) or [ld_text]:
        try:
            d = json.loads(block.strip())
        except json.JSONDecodeError:
            continue
        if not (isinstance(d, dict) and d.get("@type") == "ItemList"):
            continue
        for el in d.get("itemListElement", []):
            it = el.get("item", {})
            if it.get("@type") != "Product":
                continue
            off = it.get("offers", {}) or {}
            price = off.get("price")
            cond = 0.0
            addp = off.get("additionalProperty")
            if isinstance(addp, dict) and addp.get("name") == "Condominium Fee":
                cond = float(addp.get("value") or 0)
            pets = it.get("petsAllowed")
            amenities = " ".join(a.get("value", "") for a in it.get("amenityFeature", []) if isinstance(a, dict))
            items.append({
                "titulo": (it.get("name") or "").strip() or f"Zap id {it.get('@id')}",
                "link": it.get("url", ""),
                "preco_aluguel": float(price) if price else None,
                "condominio": cond, "iptu": 0.0,
                "custo_total": (float(price) + cond) if price else None,
                "area": float((it.get("floorSize") or {}).get("value") or 0) or None,
                "quartos": it.get("numberOfBedrooms"),
                "banheiros": it.get("numberOfBathroomsTotal"),
                "vagas": 1 if "Garage" in amenities else 0,
                "endereco": (it.get("address") or {}).get("streetAddress", ""),
                "descricao": (it.get("description") or ""),
                "nao_aceita_pet": pets is False,
            })
    return items


def extrair_listings(portal, url):
    """Fetch direto (urllib + UA de browser) + parse do JSON-LD embutido no HTML."""
    if url.startswith("fixture://"):
        html = pathlib.Path(url[len("fixture://"):]).read_text(encoding="utf-8")  # guarda de teste offline
    else:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
            "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
            "Accept": "text/html,application/xhtml+xml,*/*;q=0.8"})
        with urllib.request.urlopen(req, timeout=40) as r:
            html = r.read().decode("utf-8", errors="replace")
        if "Attention Required" in html or "cf-error" in html.lower():
            raise RuntimeError("bloqueio Cloudflare detectado")
    achados = {}
    if portal == "VivaReal":
        products = re.findall(r'\{"@type":"Product","@id":"(\d+)","name":"([^"]*)","url":"([^"]*)"', html)
        for aid, name, link in products:
            if aid in achados:
                continue
            j = html.find(f'"@id":"{aid}"')
            janela = html[j:j + 6000]
            pm = re.search(r'"price":([\d.]+)', janela)
            cm = re.search(r'Condominium Fee","value":([\d.]+)', janela)
            im = re.search(r'IPTU[^"]*","value":([\d.]+)', janela)
            em = re.search(r'"streetAddress":"([^"]*)"', janela)
            preco = float(pm.group(1)) if pm else None
            cond = float(cm.group(1)) if cm else 0.0
            iptu = float(im.group(1)) if im else 0.0
            am = re.search(r'([\d.]+) m²', name)
            qm = re.search(r'(\d+)\s*quartos?', name)
            bm = re.search(r'(\d+)\s*banheiros?', name)
            vm = re.search(r'(\d+)\s*vagas?', name)
            achados[aid] = {
                "titulo": name.strip(), "link": link,
                "preco_aluguel": preco, "condominio": cond, "iptu": iptu,
                "custo_total": (preco + cond + iptu) if preco else None,
                "area": float(am.group(1)) if am else None,
                "quartos": int(qm.group(1)) if qm else None,
                "banheiros": int(bm.group(1)) if bm else None,
                "vagas": int(vm.group(1)) if vm else None,
                "endereco": em.group(1).strip() if em else "",
            }
    else:  # Zap — JSON-LD ItemList estruturado (ver scripts/fixtures/)
        return parse_zap_ldjson(html)
    return list(achados.values())


def passa_filtros(item, prefs):
    """Filtros ANTES de inserir. Estritos: dado essencial faltando = reprova."""
    custo = item.get("custo_total") or item.get("preco_aluguel")
    if not custo:
        return False, "dados incompletos: sem preço"
    if "Custo Total Máximo (aluguel+condomínio)" in prefs and custo > float(prefs["Custo Total Máximo (aluguel+condomínio)"]):
        return False, f"custo {custo:.0f} > máx {prefs['Custo Total Máximo (aluguel+condomínio)']}"
    texto = " ".join([str(item.get("titulo") or ""), str(item.get("endereco") or ""),
                      str(item.get("descricao") or "")]).lower()
    for kw in [k.strip().lower() for k in str(prefs.get("Excluir Palavras-chave", "")).split(";") if k.strip()]:
        if kw in texto:
            return False, f"palavra-chave '{kw}'"
    q, v = item.get("quartos"), item.get("vagas")
    if q is None:
        return False, "dados incompletos: sem quartos"
    if q < int(prefs.get("Quartos Mínimos", 1)):
        return False, f"{q} quartos < mín {prefs.get('Quartos Mínimos')}"
    if v is None:
        return False, "dados incompletos: sem vagas"
    if v < int(prefs.get("Vagas Mínimas", 0)):
        return False, f"{v} vagas < mín {prefs.get('Vagas Mínimas')}"
    if item.get("nao_aceita_pet"):
        return False, "não aceita pet (petsAllowed=false)"
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

    cont = {"VivaReal": {"novos": 0, "deduped": 0, "filtrados": 0, "extraidos": 0, "erro": ""},
            "Zap": {"novos": 0, "deduped": 0, "filtrados": 0, "extraidos": 0, "erro": ""}}

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
                cont[portal]["erro"] = str(e)[:120]
                log(f"{portal}/{b}: erro na extração: {e}")
                time.sleep(3)  # backoff — proteção anti rate-limit do portal
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
                        "titulo": item.get("titulo"), "bairro": b, "portal": portal,
                        "endereco": item.get("endereco") or "",
                        "preco_aluguel": item.get("preco_aluguel") or "",
                        "condominio": item.get("condominio") if item.get("condominio") is not None else "",
                        "iptu": item.get("iptu") if item.get("iptu") is not None else "",
                        "custo_total": item.get("custo_total") if item.get("custo_total") is not None else "",
                        "area": item.get("area") if item.get("area") is not None else "",
                        "quartos": item.get("quartos") if item.get("quartos") is not None else "",
                        "banheiros": item.get("banheiros") if item.get("banheiros") is not None else "",
                        "vagas": item.get("vagas") if item.get("vagas") is not None else ""})
                    cont[portal]["deduped" if r.get("deduped") else "novos"] += 1
                except Exception as e:
                    log(f"addListing falhou ({item['link']}): {e}")

    # distinguir: parser quebrado (suspeito) vs portal bloqueado (403, normal, retry na próxima rodada)
    suspeito = [p for p in ("VivaReal", "Zap") if cont[p]["extraidos"] == 0 and "403" not in cont[p]["erro"]]
    bloqueados = [p for p in ("VivaReal", "Zap") if cont[p]["extraidos"] == 0 and "403" in cont[p]["erro"]]
    resumo = (f"🔎 Rinha cron {datetime.now().strftime('%d/%m %H:%M')} — "
              f"VivaReal: {cont['VivaReal']['novos']} novos/{cont['VivaReal']['deduped']} dup/{cont['VivaReal']['filtrados']} filt. "
              f"Zap: {cont['Zap']['novos']} novos/{cont['Zap']['deduped']} dup/{cont['Zap']['filtrados']} filt.")
    if bloqueados:
        resumo += f" 🛡️ {', '.join(bloqueados)} bloqueado(s) nesta rodada (retry na próxima)"
    if suspeito:
        resumo += f" ⚠️ PARSER_SUSPEITO: 0 listings em {', '.join(suspeito)}"
    print(resumo)  # stdout é entregue pelo deliver do cronjob (no_agent)
    log(resumo)


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
