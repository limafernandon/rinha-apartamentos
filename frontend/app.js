/* 🥊 Rinha de Apartamentos — app.js (vanilla, sem build) */
'use strict';

/* ---------- Config ---------- */
// APPS_SCRIPT_URL já é definido em config.js (prioridade: ?url=... > config).
// Fallback caso config.js não carregue:
const URL_BACKEND = (typeof APPS_SCRIPT_URL !== 'undefined' && APPS_SCRIPT_URL)
  ? APPS_SCRIPT_URL : '';

const STATUS_ENCONTRADO = 'Encontrado pelo agente';
const STATUS_DESCARTADO = 'Descartado';
const STATUS_APROVADO = 'Aprovado (seleção)';

const state = {
  imoveis: [],
  aba: 'selecao',
  carregando: false,
  cardAtualId: null,
  reprovarId: null,
};

/* ---------- Utils ---------- */
const brl = (v) => {
  const n = Number(v);
  if (!isFinite(n) || !v) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
};

const num = (v) => {
  const n = Number(v);
  return isFinite(n) && v !== '' ? n : null;
};

function toast(msg, tipo = 'info') {
  const t = document.createElement('div');
  t.className = `toast toast-${tipo}`;
  t.textContent = msg;
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

/* ---------- API Apps Script ---------- */
async function apiList(status) {
  if (!APPS_SCRIPT_URL) throw new Error('BACKEND_NAO_CONFIGURADO');
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set('action', 'list');
  if (status) url.searchParams.set('status', status);
  const res = await fetch(url.toString(), { method: 'GET', redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data && Array.isArray(data.items)) return data.items;
  return Array.isArray(data) ? data : (data.imoveis || data.data || []);
}

async function apiPatch(id, patch) {
  if (!APPS_SCRIPT_URL) throw new Error('BACKEND_NAO_CONFIGURADO');
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // evita preflight no Apps Script
    body: JSON.stringify({ action: 'update', id, patch }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json().catch(() => ({}));
  if (data && data.error) throw new Error(data.error);
  return data;
}

/* ---------- Carga ---------- */
async function carregar(silent = false) {
  if (state.carregando) return;
  state.carregando = true;
  try {
    state.imoveis = await apiList();
    render();
  } catch (e) {
    if (e.message === 'BACKEND_NAO_CONFIGURADO') {
      toast('Backend ainda não configurado. Use ?url=<URL do Apps Script> na barra de endereço.', 'erro');
    } else {
      toast('Falha de rede ao falar com o ringue. Tenta de novo aí! 🥊', 'erro');
    }
    console.error(e);
    if (!silent && !state.imoveis.length) {
      document.getElementById('card-area').innerHTML =
        '<p class="vazio">Sem conexão com o juiz (Apps Script). Recarregue quando voltar.</p>';
    }
  } finally {
    state.carregando = false;
    document.getElementById('loading-selecao').classList.add('oculto');
    document.getElementById('loading-visita').classList.add('oculto');
  }
}

/* ---------- Abas ---------- */
function trocarAba(aba) {
  state.aba = aba;
  document.querySelectorAll('.aba').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === aba));
  document.querySelectorAll('.painel').forEach((p) => p.classList.toggle('ativa', p.id === `aba-${aba}`));
  if (aba === 'visita') carregar(true);
}

/* ---------- SELEÇÃO (cards tinder) ---------- */
function pileSelecao() {
  return state.imoveis.filter((i) => i.Status === STATUS_ENCONTRADO);
}

function imgDeAnuncio(imovel) {
  // Campo 'Link Anúncio' pode conter URL de imagem ou do anúncio; usamos como fallback.
  const link = (imovel['Link Anúncio'] || '').trim();
  if (/^https?:\/\/.+\.(jpe?g|png|webp|gif)(\?|$)/i.test(link)) return link;
  return link || null;
}

function renderSelecao() {
  const area = document.getElementById('card-area');
  const pilha = pileSelecao();
  if (!pilha.length) {
    area.innerHTML = '<p class="vazio">🥊 Ringue vazio! O agente tá caçando novos lutadores...</p>';
    return;
  }
  const im = pilha[0];
  state.cardAtualId = im.ID;
  const img = imgDeAnuncio(im);
  area.innerHTML = `
    <div class="card-lutador">
      ${img ? `<img class="card-img" src="${escapeHtml(img)}" alt="Imóvel" onerror="this.style.display='none'">`
             : '<div class="card-img card-img-vazio">🥊</div>'}
      <div class="card-corpo">
        <div class="card-preco">${brl(im['Custo Total'] || somaTotal(im))}</div>
        <h2 class="card-titulo">${escapeHtml(im['Título do Anúncio'] || im.Bairro || 'Lutador anônimo')}</h2>
        <p class="card-bairro">📍 ${escapeHtml(im.Bairro || 'Bairro desconhecido')}</p>
        <div class="card-stats">
          <span>📐 ${num(im['Área']) ? num(im['Área']) + ' m²' : '—'}</span>
          <span>🛏️ ${num(im['Quartos']) ?? '—'} quarto(s)</span>
          <span>🚿 ${num(im['Banheiros']) ?? '—'} banh.</span>
          <span>🚗 ${num(im['Vagas']) ?? '—'} vaga(s)</span>
        </div>
        <div class="card-detalhe">
          Aluguel ${brl(im['Preço Aluguel'])} · Cond. ${brl(im['Condomínio'])} · IPTU ${brl(im['IPTU'])}
        </div>
        ${im['Link Anúncio'] ? `<a class="card-link" href="${escapeHtml(im['Link Anúncio'])}" target="_blank" rel="noopener">Ver anúncio ↗</a>` : ''}
      </div>
      <div class="card-vs">🥊 VS</div>
      <div class="card-acoes">
        <button class="btn btn-perigo" data-acao="reprovar" title="Reprovar">❌ Nocaute</button>
        <button class="btn btn-ouro" data-acao="eu" title="Eu preencho o formulário">✋ Eu preencho</button>
        <button class="btn btn-vermelho" data-acao="agente" title="Agente contata">🥊 Agente contata</button>
      </div>
    </div>`;
  area.querySelectorAll('[data-acao]').forEach((b) =>
    b.addEventListener('click', () => acaoCard(b.dataset.acao)));
}

function somaTotal(im) {
  const s = ['Preço Aluguel', 'Condomínio', 'IPTU'].reduce((a, k) => a + (num(im[k]) || 0), 0);
  return s || null;
}

function acaoCard(acao) {
  const id = state.cardAtualId;
  if (!id) return;
  if (acao === 'reprovar') {
    state.reprovarId = id;
    document.getElementById('modal-reprovar').classList.remove('oculto');
    document.getElementById('justificativa').value = '';
    document.getElementById('justificativa').focus();
    return;
  }
  const patch = acao === 'eu'
    ? { Status: STATUS_APROVADO, Contato: 'Eu mesmo' }
    : { Status: STATUS_APROVADO, Contato: 'Agente' };
  aplicarPatch(id, patch, acao === 'eu' ? '✋ Você assume o contato!' : '🥊 Agente vai pra porrada!');
}

function aplicarPatch(id, patch, msgOk) {
  // Otimista: tira o card da pilha já
  const im = state.imoveis.find((i) => i.ID === id);
  if (im) Object.assign(im, patch);
  render();
  apiPatch(id, patch)
    .then(() => toast(msgOk, 'ok'))
    .catch((e) => {
      toast('Não rolou salvar no Sheets. Recarregando dados...', 'erro');
      carregar(true);
      console.error(e);
    });
}

/* ---------- Modal reprovar ---------- */
function confirmarReprovar() {
  const just = document.getElementById('justificativa').value.trim();
  if (!just) {
    toast('Justificativa é obrigatória pra nocautear um lutador! 💥', 'erro');
    return;
  }
  const id = state.reprovarId;
  fecharModal();
  aplicarPatch(id, { Status: STATUS_DESCARTADO, Notas: just }, '💥 Lutador nocauteado!');
}
function fecharModal() {
  document.getElementById('modal-reprovar').classList.add('oculto');
  state.reprovarId = null;
}

/* ---------- VISITA (tabela) ---------- */
function renderVisita() {
  const cont = document.getElementById('visita-container');
  const lista = state.imoveis.filter(
    (i) => i.Status !== STATUS_ENCONTRADO && i.Status !== STATUS_DESCARTADO);
  if (!lista.length) {
    cont.innerHTML = '<p class="vazio">Nenhum lutador classificado ainda. Volte pra aba SELEÇÃO! 🥊</p>';
    return;
  }
  const linhas = lista.map((im) => {
    const total = num(im['Custo Total']) || somaTotal(im);
    const st = (im.Status || '—');
    return `
    <div class="linha-visita" data-id="${escapeHtml(im.ID || '')}">
      <div class="lv-main">
        <div class="lv-topo">
          <span class="badge badge-${slug(st)}">${escapeHtml(st)}</span>
          <span class="badge badge-ouro">${brl(total)}</span>
        </div>
        <a class="lv-titulo" href="${escapeHtml(im['Link Anúncio'] || '#')}" target="_blank" rel="noopener">
          ${escapeHtml(im['Título do Anúncio'] || '—')} ↗
        </a>
        <p class="lv-meta">📍 ${escapeHtml(im.Bairro || '—')} · ${brl(im['Preço Aluguel'])} + cond. ${brl(im['Condomínio'])} + IPTU ${brl(im['IPTU'])}
        ${num(im['Área']) ? ` · ${num(im['Área'])} m²` : ''}${num(im['Quartos']) ? ` · 🛏️ ${num(im['Quartos'])}` : ''}${num(im['Vagas']) ? ` · 🚗 ${num(im['Vagas'])}` : ''}</p>
      </div>
      <div class="lv-nota">
        <label>Nota da visita:</label>
        <textarea rows="2" placeholder="Anote aqui o que achou da visita...">${escapeHtml(im['Nota Visitada'] || '')}</textarea>
        <button class="btn btn-sec btn-salvar-nota">Salvar nota</button>
      </div>
    </div>`;
  }).join('');
  cont.innerHTML = `<div class="visita-lista">${linhas}</div>`;
  cont.querySelectorAll('.linha-visita').forEach((row) => {
    row.querySelector('.btn-salvar-nota').addEventListener('click', async () => {
      const nota = row.querySelector('textarea').value.trim();
      const id = row.dataset.id;
      try {
        await apiPatch(id, { 'Nota Visitada': nota });
        const im = state.imoveis.find((i) => i.ID === id);
        if (im) im['Nota Visitada'] = nota;
        toast('📝 Nota salva!', 'ok');
      } catch (e) {
        toast('Falha ao salvar a nota. Tenta de novo!', 'erro');
        console.error(e);
      }
    });
  });
}

/* ---------- Helpers ---------- */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function slug(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
}

function render() {
  if (state.aba === 'selecao') renderSelecao();
  else renderVisita();
}

/* ---------- Boot ---------- */
document.querySelectorAll('.aba').forEach((b) => b.addEventListener('click', () => trocarAba(b.dataset.aba)));
document.getElementById('btn-cancelar-reprovar').addEventListener('click', fecharModal);
document.getElementById('btn-confirmar-reprovar').addEventListener('click', confirmarReprovar);
document.getElementById('modal-reprovar').addEventListener('click', (e) => {
  if (e.target.id === 'modal-reprovar') fecharModal();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharModal(); });

render();
carregar();
