# -*- coding: utf-8 -*-
"""Aplica mudanças estruturais na planilha busca_apto (Sheets API v4).

- Header W1:Y1 = Contato / Formulario Enviado / Data Formulario
- DataValidation coluna W (Agente / Eu mesmo), coluna Q (Status), strict
- Cria aba 'Preferencias' e escreve A1:C8
- Formata header de Preferencias (verde bold) + freeze row 1

Uso: python scripts/apply_sheet_changes.py
"""
import json
import time
import urllib.parse
import urllib.request
import pathlib

HOME = pathlib.Path.home()
TOKEN_FILE = HOME / "AppData/Local/hermes/profiles/corretor/mcp-tokens/google-workspace.json"
CLIENT_FILE = HOME / "AppData/Local/hermes/profiles/corretor/mcp-tokens/google-workspace.client.json"
SHEET_ID = "1hnlg419ue29oE-WwBVqJtCFIj84htdMU2efYZk3uzGc"

STATUS_OPCOES = [
    "Encontrado pelo agente", "Aprovado (seleção)", "Não iniciado", "Contato feito",
    "Agendada visita", "Visitado", "Proposta enviada", "Em negociação",
    "Descartado", "Alugado",
]

PREFS = [
    ["Filtro", "Valor", "Ativo"],
    ["Bairros Alvo", "Serra;Gutierrez;Santa Efigênia;Anchieta;Padre Eustáquio;Sagrada Família;Prado", True],
    ["Preço Máx Aluguel", 3500, True],
    ["Quartos Mínimos", 2, True],
    ["Vagas Mínimas", 1, True],
    ["Área Mínima m²", 60, True],
    ["Excluir Palavras-chave", "reformar;sem vaga;substudio;kitnet", True],
    ["Formulario Enviado Max Por Rodada", 5, True],
]


def _post(url, body, method="POST"):
    req = urllib.request.Request(
        url, data=json.dumps(body).encode("utf-8"), method=method,
        headers={"Authorization": "Bearer " + get_access_token(),
                 "Content-Type": "application/json; charset=utf-8"})
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        raise RuntimeError("HTTP %d: %s" % (e.code, e.read().decode("utf-8", "replace")))


def _get(url):
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + get_access_token()})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode("utf-8"))


def _http_error(e):
    try:
        return {"http": e.code, "body": e.read().decode("utf-8", "replace")}
    except Exception:
        return {"http": e.code}


def _url(path):
    # acentos (aba 'Imóveis') precisam ser percent-encoded; '/' obrigatória antes de ':method'
    if path.startswith(":"):
        p = path.lstrip(":")
        # método de spreadsheet-level: ID:batchUpdate; de values: ID/values:batchUpdate
        path = ("/" + p) if p.startswith("values") else (":" + p)
    return ("https://sheets.googleapis.com/v4/spreadsheets/" + SHEET_ID
            + urllib.parse.quote(path, safe="/:!()"))


def get_access_token():
    tok = json.loads(TOKEN_FILE.read_text(encoding="utf-8"))
    client = json.loads(CLIENT_FILE.read_text(encoding="utf-8"))
    if tok.get("expires_at") and tok["expires_at"] > time.time() + 120:
        return tok["access_token"]
    data = urllib.parse.urlencode({
        "client_id": client["client_id"], "client_secret": client["client_secret"],
        "refresh_token": tok["refresh_token"], "grant_type": "refresh_token",
    }).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=data,
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req) as r:
        resp = json.loads(r.read().decode())
    tok["access_token"] = resp["access_token"]
    tok["expires_at"] = time.time() + resp.get("expires_in", 3600)
    TOKEN_FILE.write_text(json.dumps(tok), encoding="utf-8")
    return tok["access_token"]


def api(path, body=None, method=None):
    url = _url(path)
    if body is None:
        return _get(url)
    return _post(url, body, method or "POST")


def main():
    escritas = []
    # (a) header W1:Y1
    r = api(":values:batchUpdate", {"valueInputOption": "USER_ENTERED", "data": [
        {"range": "Imóveis!W1:Y1", "values": [["Contato", "Formulario Enviado", "Data Formulario"]]}]})
    escritas.append("header W1:Y1: %d células" % r["totalUpdatedCells"])

    # (b) validação coluna W (index 22) + (c) coluna Q (index 16)
    meta = api("")
    sheet_id = next(s["properties"]["sheetId"] for s in meta["sheets"]
                    if s["properties"]["title"] == "Imóveis")
    validations = [
        {
         "range": {"sheetId": None, "startRowIndex": 0, "endRowIndex": 1000,
                     "startColumnIndex": 22, "endColumnIndex": 23},
         "rule": {"condition": {"type": "ONE_OF_LIST", "values": [
             {"userEnteredValue": "Agente"}, {"userEnteredValue": "Eu mesmo"}]},
             "inputMessage": "Escolha Agente ou Eu mesmo", "strict": True,
             "showCustomUi": True}},
        {
         "range": {"sheetId": None, "startRowIndex": 0, "endRowIndex": 1000,
                     "startColumnIndex": 16, "endColumnIndex": 17},
         "rule": {"condition": {"type": "ONE_OF_LIST", "values": [
             {"userEnteredValue": v} for v in STATUS_OPCOES]},
             "inputMessage": "Status do imóvel", "strict": True, "showCustomUi": True}},
    ]
    # resolver sheetId da aba Imóveis
    meta = api("")
    sheet_id = next(s["properties"]["sheetId"] for s in meta["sheets"]
                    if s["properties"]["title"] == "Imóveis")
    for v in validations:
        v["range"]["sheetId"] = sheet_id
    api(":batchUpdate", {"requests": [{"setDataValidation": v} for v in validations]})
    escritas.append("validações Q e W aplicadas (rows 1-1000, strict)")

    # (d) aba Preferencias
    try:
        api(":batchUpdate", {"requests": [{"addSheet": {"properties": {"title": "Preferencias"}}}]})
        escritas.append("aba Preferencias criada")
    except Exception as e:
        if "Já existe" in str(e) or "already exists" in str(e):
            escritas.append("aba Preferencias já existe")
        else:
            raise
    r = api(":values:batchUpdate", {"valueInputOption": "USER_ENTERED", "data": [
            {"range": "Preferencias!A1:C8", "values": PREFS}]})
    escritas.append("Preferencias A1:C8: %d células" % r["totalUpdatedCells"])

    # (e) formatação: header verde bold + freeze row 1
    pref_id = next(s["properties"]["sheetId"] for s in api("")["sheets"]
                   if s["properties"]["title"] == "Preferencias")
    api(":batchUpdate", {"requests": [
        {"repeatCell": {"range": {"sheetId": pref_id, "startRowIndex": 0, "endRowIndex": 1},
                        "cell": {"userEnteredFormat": {
                            "backgroundColor": {"red": 0.2, "green": 0.7, "blue": 0.3},
                            "textFormat": {"bold": True}}},
                        "fields": "userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.bold"}},
        {"updateSheetProperties": {"properties": {"sheetId": pref_id,
                                                  "gridProperties": {"frozenRowCount": 1}},
                                   "fields": "gridProperties.frozenRowCount"}}]})
    escritas.append("Preferencias formatada: header verde bold + freeze row 1")

    # VERIFICAÇÃO: ler de volta
    hdr = api(":values/Imóveis!W1:Y1")
    print("VERIFICAÇÃO header W1:Y1:", hdr.get("values"))
    prefs_read = api(":values/Preferencias!A1:C8")
    print("VERIFICAÇÃO Preferencias A1:C8:", json.dumps(prefs_read.get("values"), ensure_ascii=False))
    print("RESUMO:", "; ".join(escritas))


if __name__ == "__main__":
    main()
