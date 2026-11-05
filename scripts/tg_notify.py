# -*- coding: utf-8 -*-
"""Notificação Telegram.

Uso como CLI: python scripts/tg_notify.py 'texto da mensagem'
Uso como módulo: from tg_notify import send; send('texto')

Lê TELEGRAM_BOT_TOKEN e RINHA_TELEGRAM_CHAT_ID do ambiente; se ausentes,
apenas loga (não lança exceção).
"""
import os
import sys
import urllib.request


def send(texto: str):
    """Envia texto via Telegram. Retorna True se enviado, False caso contrário."""
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("RINHA_TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        print("[tg_notify] TELEGRAM_BOT_TOKEN ou RINHA_TELEGRAM_CHAT_ID não configurados "
              "— mensagem NÃO enviada:\n" + texto)
        return False
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    body = {"chat_id": chat_id, "text": texto[:4000], "disable_web_page_preview": True}
    req = urllib.request.Request(
        url, data=__import__("json").dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            r.read()
        return True
    except Exception as e:  # nunca quebra o chamador por causa de notificação
        print(f"[tg_notify] erro ao enviar: {e}")
        return False


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("uso: python scripts/tg_notify.py 'texto'")
        sys.exit(1)
    ok = send(sys.argv[1])
    sys.exit(0 if ok else 0)  # CLI sempre sai 0 quando só avisou config faltante
