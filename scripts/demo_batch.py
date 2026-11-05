# -*- coding: utf-8 -*-
"""Rodada batch: demonstrar interesse nas listagens Aprovadas, contato=Agente.

Lê listagens via Apps Script (GET ?action=list&status=Aprovado (seleção)),
filtra Contato=='Agente' e Formulario Enviado vazio, limita a 5 por rodada.
Sucesso → POST update {Formulario Enviado:'true', Data Formulario: hoje}.
Falha   → notifica Telegram e NÃO marca.
"""
import datetime
import json
import pathlib
import sys
import urllib.parse
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from demo_interesse import demonstrar_interesse  # noqa: E402
from tg_notify import send  # noqa: E402

CONFIG = pathlib.Path(__file__).parent / "config.json"


def _http(url, body=None):
    req = urllib.request.Request(
        url, data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def main():
    cfg = json.loads(CONFIG.read_text(encoding="utf-8")) if CONFIG.exists() else {}
    url = cfg.get("apps_script_url", "").strip()
    if not url:
        print("ERRO: apps_script_url vazio em scripts/config.json — configure antes de rodar.")
        sys.exit(1)
    url = url.rstrip("/")

    lista = _http(url + "?action=list&status=" + urllib.parse.quote("Aprovado (seleção)"))
    itens = [i for i in lista.get("items", [])
             if i.get("Contato") == "Agente"
             and not str(i.get("Formulario Enviado") or "").strip().lower() in ("true", "1", "sim", "x")]
    alvo = itens[:5]
    print(f"Encontradas {len(itens)} candidatas; processando {len(alvo)} nesta rodada.")
    hoje = datetime.date.today().isoformat()
    for item in alvo:
        link = item.get("Link Anúncio") or item.get("Link Anuncio") or ""
        resp = demonstrar_interesse(link, cfg.get("dados_fefo", {}))
        if resp.get("ok"):
            _http(url + "?action=update", {
                "action": "update", "id": item.get("ID"),
                "patch": {"Formulario Enviado": "true", "Data Formulario": hoje}})
            print(f"[OK] {item['ID']} — {resp['detalhe']}")
        else:
            send(f"⚠️ Form de {item['ID']} falhou — preenche na mão: {link}\n{resp['detalhe']}")
            print(f"[FALHA] {item['ID']} — {resp['detalhe']}")


if __name__ == "__main__":
    main()
