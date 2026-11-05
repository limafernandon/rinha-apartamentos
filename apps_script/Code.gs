/**
 * Rinha de Apartamentos — backend Apps Script.
 * Planilha: busca_apto (aba 'Imóveis' + aba 'Preferencias').
 *
 * DEPLOY (manual):
 *   1. Cole este arquivo em script.google.com (novo projeto).
 *   2. Deploy → New deployment → Web app
 *      - Execute as: Me (eu mesmo)
 *      - Who has access: Anyone
 *   3. Copie a URL /exec e coloque em scripts/config.json (campo apps_script_url).
 *
 * Endpoints (Web app):
 *   GET  ?action=list&status=<status>        → listagens por status
 *   GET  ?action=prefs                       → preferências ativas
 *   POST {action:'update', id, patch}        → atualiza campos de um imóvel
 *   POST {action:'addListing', ...campos}    → adiciona imóvel (dedupe por link)
 *   POST {action:'vote', id, usuario, voto, motivo?}
 *                                            → registra voto (gostei|nocaute) do juiz
 *                                              (fefo|ray) nas colunas 'Voto Fefo'/'Voto Ray';
 *                                              nocaute → Status=Descartado (motivo opcional em
 *                                              'Notas/Observações'); 2 gostei → Status='Aprovado (seleção)'
 *                                              com Contato vazio (decidido na shortlist).
 *   GET/POST ?action=ping                    → healthcheck
 */
const SHEET_ID = '1hnlg419ue29oE-WwBVqJtCFIj84htdMU2efYZk3uzGc';
const ABA_IMOVEIS = 'Imóveis';
const ABA_PREFS = 'Preferencias';

function doGet(e) { return handle_(e && e.parameter ? e.parameter : {}); }
function doPost(e) {
  var params = {};
  try { params = JSON.parse(e.postData.contents); } catch (err) { params = {}; }
  if (e && e.parameter) { for (var k in e.parameter) params[k] = params[k] || e.parameter[k]; }
  return handle_(params);
}

function handle_(params) {
  var action = params.action || 'ping';
  try {
    var out;
    if (action === 'ping') out = { ok: true, version: 2 };
    else if (action === 'list') out = listByStatus(params.status || '');
    else if (action === 'update') out = update(params.id, params.patch || {});
    else if (action === 'addListing') out = addListing(params);
    else if (action === 'prefs') out = prefs();
    else if (action === 'vote') out = vote(params);
    else out = { ok: false, error: 'ação desconhecida: ' + action };
    return json_(out);
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Lê a aba Imóveis; header mapeado removendo sufixos '(R$)'/'(0-5)'/'(m²)'. */
function readImoveis_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(ABA_IMOVEIS);
  var data = sh.getDataRange().getValues();
  var header = data[0].map(function (h) {
    return String(h).replace(/\s*\((R\$|0-5|m²)\)\s*$/i, '').trim();
  });
  return { sh: sh, header: header, rows: data.slice(1) };
}

/** Ação 'list': retorna imóveis, opcionalmente filtrados por Status. */
function listByStatus(status) {
  var r = readImoveis_();
  var out = [];
  r.rows.forEach(function (row, i) {
    var obj = {};
    r.header.forEach(function (h, c) { obj[h] = row[c]; });
    if (!obj['ID']) return;
    if (status && String(obj['Status'] || '') !== String(status)) return;
    obj['_linha'] = i + 2;
    out.push(obj);
  });
  return { ok: true, items: out };
}

/** Ação 'update': acha a linha pela coluna ID e aplica patch por nome de coluna. */
function update(id, patch) {
  if (!id) return { ok: false, error: 'id obrigatório' };
  var r = readImoveis_();
  var idxId = r.header.indexOf('ID');
  if (idxId < 0) return { ok: false, error: 'coluna ID não encontrada' };
  for (var i = 0; i < r.rows.length; i++) {
    if (String(r.rows[i][idxId]) === String(id)) {
      var linha = i + 2, colunas = [], valores = [];
      for (var campo in patch) {
        var c = r.header.indexOf(campo);
        if (campo === '_linha') continue;
        if (c < 0) return { ok: false, error: 'coluna desconhecida: ' + campo };
        colunas.push(c);
        valores.push(patch[campo]);
      }
      if (colunas.length) {
        var minC = Math.min.apply(null, colunas), maxC = Math.max.apply(null, colunas);
        var faixa = r.sh.getRange(linha, minC + 1, 1, maxC - minC + 1);
        var atual = faixa.getValues()[0];
        colunas.forEach(function (c, j) { atual[c - minC] = valores[j]; });
        faixa.setValues([atual]);
      }
      return { ok: true, id: id, linha: linha, atualizados: colunas.length };
    }
  }
  return { ok: false, error: 'ID não encontrado: ' + id };
}

/** Ação 'addListing': dedupe por link (coluna 16, 'Link Anúncio'); senão appendRow. */
function addListing(p) {
  var r = readImoveis_();
  var COL_LINK = 15; // 0-indexed → coluna 16 (Link Anúncio)
  var link = p.link || p['Link Anúncio'] || '';
  if (link) {
    for (var i = 0; i < r.rows.length; i++) {
      if (String(r.rows[i][COL_LINK]) === String(link)) {
        return { ok: true, deduped: true, id: r.rows[i][r.header.indexOf('ID')] };
      }
    }
  }
  var id = 'APT-' + Date.now();
  var hoje = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd');
  // Mapa header → valor
  var valoresPorColuna = {};
  valoresPorColuna['ID'] = id;
  valoresPorColuna['Data Adicionado'] = hoje;
  valoresPorColuna['Título do Anúncio'] = p.titulo || p['Título do Anúncio'] || '';
  valoresPorColuna['Bairro'] = p.bairro || p['Bairro'] || '';
  valoresPorColuna['Endereço/Rua'] = p.endereco || p['Endereço/Rua'] || '';
  valoresPorColuna['Preço Aluguel'] = p.preco_aluguel || p['Preço Aluguel'] || '';
  valoresPorColuna['Condomínio'] = p.condominio || p['Condomínio'] || '';
  valoresPorColuna['IPTU'] = p.iptu || p['IPTU'] || '';
  valoresPorColuna['Custo Total'] = p.custo_total || p['Custo Total'] || '';
  valoresPorColuna['Área'] = p.area || p['Área'] || '';
  valoresPorColuna['Quartos'] = p.quartos || p['Quartos'] || '';
  valoresPorColuna['Banheiros'] = p.banheiros || p['Banheiros'] || '';
  valoresPorColuna['Vagas Garagem'] = p.vagas || p['Vagas Garagem'] || ''; // header real é 'Vagas Garagem' (não normalizado por readImoveis_)
  valoresPorColuna['Andar'] = p.andar || p['Andar'] || '';
  valoresPorColuna['Portal'] = p.portal || p['Portal'] || '';
  valoresPorColuna['Link Anúncio'] = link;
  valoresPorColuna['Status'] = 'Encontrado pelo agente'; // default obrigatório
  valoresPorColuna['Prioridade'] = p['Prioridade'] || '';
  valoresPorColuna['Vibe Bairro'] = p['Vibe Bairro'] || '';
  valoresPorColuna['Qualidade Imóvel'] = p['Qualidade Imóvel'] || '';
  valoresPorColuna['Nota Visitada'] = p['Nota Visitada'] || '';
  valoresPorColuna['Notas/Observações'] = p.notas || p['Notas/Observações'] || '';
  valoresPorColuna['Contato'] = p.contato || '';
  valoresPorColuna['Formulario Enviado'] = p['Formulario Enviado'] || '';

  var linha = r.header.map(function (h) {
    return valoresPorColuna[h] !== undefined ? valoresPorColuna[h] : '';
  });
  r.sh.appendRow(linha);
  return { ok: true, deduped: false, id: id };
}

/** Ação 'vote': registra voto de 1 usuário direto nas colunas da aba Imóveis.
 *  Colunas: 'Voto Fefo' e 'Voto Ray' → 'gostei' | 'nocaute' | ''.
 *  Regras:
 *   - nocaute de QUALQUER um  → Status = Descartado (Notas/Observações = motivo, se vier)
 *   - 2 gostei (os dois juízes) → Status = 'Aprovado (seleção)' (Contato fica vazio → decidido na shortlist)
 */
function vote(p) {
  var usuario = String(p.usuario || '').toLowerCase(); // 'fefo' | 'ray'
  var voto = String(p.voto || '');
  if ((usuario !== 'fefo' && usuario !== 'ray') || (voto !== 'gostei' && voto !== 'nocaute'))
    return { ok: false, error: 'parametros obrigatorios: usuario(fefo|ray), voto(gostei|nocaute)' };
  if (!p.id) return { ok: false, error: 'id obrigatório' };

  var colVoto = usuario === 'fefo' ? 'Voto Fefo' : 'Voto Ray';
  var patch = {};
  patch[colVoto] = voto;

  if (voto === 'nocaute') {
    patch.Status = 'Descartado';
    if (p.motivo) patch['Notas/Observações'] = p.motivo;
    var respNoc = update(p.id, patch);
    return { ok: respNoc.ok !== false, id: p.id, resultado: 'nocauteado' };
  }

  // gostei: precisa dos DOIS. Ler o voto do outro juiz antes de gravar o meu.
  var r = readImoveis_();
  var idxId = r.header.indexOf('ID');
  var linhaObj = null;
  for (var i = 0; i < r.rows.length; i++) {
    if (String(r.rows[i][idxId]) === String(p.id)) { linhaObj = r.rows[i]; break; }
  }
  if (!linhaObj) return { ok: false, error: 'ID nao encontrado: ' + p.id };

  var colOutro = usuario === 'fefo' ? 'Voto Ray' : 'Voto Fefo';
  var votoOutro = String(linhaObj[r.header.indexOf(colOutro)] || '').toLowerCase();
  var resp = update(p.id, patch);
  if (resp.ok === false) return resp;

  if (votoOutro === 'gostei') {
    update(p.id, { Status: 'Aprovado (seleção)' });
    return { ok: true, id: p.id, resultado: 'shortlist' };
  }
  return { ok: true, id: p.id, resultado: 'aguardando-outro-juiz' };
}

/** Ação 'prefs': {Filtro: Valor} só onde Ativo=true. */
function prefs() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(ABA_PREFS);
  if (!sh) return { ok: true, prefs: {} };
  var data = sh.getDataRange().getValues();
  var out = {};
  for (var i = 1; i < data.length; i++) {
    var filtro = data[i][0], valor = data[i][1], ativo = data[i][2];
    if (filtro === '' || filtro === undefined) continue;
    var ativoBool = (ativo === true || String(ativo).toUpperCase() === 'TRUE' || ativo === 'Sim');
    if (ativoBool) out[String(filtro)] = valor;
  }
  return { ok: true, prefs: out };
}
