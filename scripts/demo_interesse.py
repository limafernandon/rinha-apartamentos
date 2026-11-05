# -*- coding: utf-8 -*-
"""Demonstrar interesse num anúncio via browser (hermes browser_exec).

Uso: python scripts/demo_interesse.py <link_do_anuncio>
Lê dados_fefo (nome/telefone/email) de scripts/config.json.

Retorna dict {ok, detalhe, screenshot} (impresso em JSON no stdout).
"""
import json
import pathlib
import sys
import re

HOME = pathlib.Path.home()
CONFIG = HOME / "Documents/rinha-apartamentos/scripts/config.json"

SELETORES_BOTAO = [
    "tenho interesse", "fale com o anunciante", "demonstrar interesse",
    "quero alugar", "entrar em contato", "mensage ao anunciante",
]


def load_fefo():
    cfg = json.loads(CONFIG.read_text(encoding="utf-8")) if CONFIG.exists() else {}
    d = cfg.get("dados_fefo", {})
    return {k: d.get(k, "") for k in ("nome", "telefone", "email")}


def demonstrar_interesse(link: str, dados: dict) -> dict:
    """Abre o anúncio, acha botão/form de interesse, preenche e submete.

    Cada passo é defensivo (try/except) com screenshot antes de falhar.
    """
    from hermes_tools import capture_screenshot, fill_input, js, new_tab, wait_for_load

    resp = {"ok": False, "detalhe": "", "screenshot": None}
    try:
        new_tab(link)
        wait_for_load()
        resp["detalhe"] = "página aberta: " + (js("document.title") or "")
    except Exception as e:
        resp["screenshot"] = capture_screenshot()
        resp["detalhe"] = f"falha ao abrir link: {e}"
        return resp

    try:
        # Procura botão/link de interesse pelo texto
        achou = js("""(() => {
          const termos = %s;
          const els = [...document.querySelectorAll('button, a, [role=button]')];
          const alvo = els.find(e => {
            const t = (e.innerText || '').toLowerCase();
            return termos.some(x => t.includes(x));
          });
          if (alvo) { alvo.scrollIntoView({block:'center'}); alvo.click(); return alvo.innerText; }
          return null;
        })()""" % json.dumps(SELETORES_BOTAO))
        if achou:
            wait_for_load()
            resp["detalhe"] += f" | botão clicado: {achou}"
        else:
            resp["detalhe"] += " | nenhum botão de interesse encontrado; tentando form direto"
    except Exception as e:
        resp["screenshot"] = capture_screenshot()
        resp["detalhe"] += f" | erro ao buscar botão: {e}"
        return resp

    try:
        # Preenche campos: heurística por nome/id/placeholder/type
        campos = [("nome", dados["nome"], r"name|nome|first.?name"),
                  ("telefone", dados["telefone"], r"phone|tel|celular|whats"),
                  ("email", dados["email"], r"email|e-mail")]
        preenchidos = js("""(() => {
          const pares = %s;
          const inputs = [...document.querySelectorAll('input, textarea')];
          let ok = 0;
          for (const [val, re] of pares) {
            const rx = new RegExp(re, 'i');
            const inp = inputs.find(i => !i.disabled && i.type !== 'hidden' &&
              (rx.test(i.name || '') || rx.test(i.id || '') || rx.test(i.placeholder || '') ||
               (i.type === 'tel' && re.includes('tel')) || (i.type === 'email' && re.includes('email'))));
            if (inp) { inp.focus(); inp.value = val; inp.dispatchEvent(new Event('input', {bubbles:true})); ok++; }
          }
          return ok;
        })()""" % json.dumps([[v, rx] for (_n, v, rx) in campos]))
        resp["detalhe"] += f" | campos preenchidos: {preenchidos}/3"
        if preenchidos < 1:
            resp["screenshot"] = capture_screenshot()
            resp["detalhe"] += " | nenhum campo localizado"
            return resp
    except Exception as e:
        resp["screenshot"] = capture_screenshot()
        resp["detalhe"] += f" | erro ao preencher form: {e}"
        return resp

    try:
        # Submete: botão submit do form, ou botão com texto de envio
        enviado = js("""(() => {
          const form = document.querySelector('form');
          if (form) { const b = form.querySelector('button[type=submit], input[type=submit], button');
            if (b) { b.click(); return 'form:' + (b.innerText || b.type); } form.submit(); return 'form.submit()'; }
          const els = [...document.querySelectorAll('button, a, [role=button]')];
          const b = els.find(e => /enviar|envoyer|send|candidat/i.test(e.innerText || ''));
          if (b) { b.click(); return 'botao:' + b.innerText; }
          return null;
        })()""")
        wait_for_load()
        resp["screenshot"] = capture_screenshot()
        if enviado:
            resp["ok"] = True
            resp["detalhe"] += f" | submetido via {enviado}"
        else:
            resp["detalhe"] += " | não encontrei botão de envio"
    except Exception as e:
        resp["screenshot"] = capture_screenshot()
        resp["detalhe"] += f" | erro ao submeter: {e}"
    return resp


def main():
    if len(sys.argv) < 2:
        print("uso: python scripts/demo_interesse.py <link_do_anuncio>")
        sys.exit(1)
    dados = load_fefo()
    print(json.dumps(demonstrar_interesse(sys.argv[1], dados), ensure_ascii=False))


if __name__ == "__main__":
    main()
