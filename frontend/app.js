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

/* Funil da aba Visita — colunas do kanban, na ordem (decisão Fefo 2026-11-05) */
const VISITA_COLUNAS = ['Aprovado (seleção)', 'Contato feito', 'Visita agendada', 'Visitado'];
const STATUS_AGENDADA = 'Visita agendada';
const STATUS_VISITADO = 'Visitado';
const STATUS_CONTATO = 'Contato feito';

const state = {
  imoveis: [],
  aba: 'selecao',
  carregando: false,
  cardAtualId: null,
  reprovarId: null,
  detalheId: null,
  usuario: '',
  nomeUsuario: '',
  prefs: {},
};

/* ---------- Login por código ---------- */
const LS_KEY = 'rinha_usuario';
function usuarioCache() { return localStorage.getItem(LS_KEY) || ''; }
function setUsuario(u) { localStorage.setItem(LS_KEY, u); state.usuario = u; }

function pedirCodigo(prefs) {
  // overlay simples de login (elemento #tela-codigo em index.html)
  return new Promise((resolve) => {
    const tela = document.getElementById('tela-codigo');
    const input = document.getElementById('input-codigo');
    const btn = document.getElementById('btn-entrar');
    tela.classList.remove('oculto');
    const tentar = () => {
      const cod = input.value.trim().toLowerCase();
      const valido = Object.entries(prefs || {})
        .some(([k, v]) => k.startsWith('Codigo ') && String(v).toLowerCase() === cod);
      if (!valido) { document.getElementById('erro-codigo').textContent = 'Código inválido, juiz.'; return; }
      const nome = Object.keys(prefs).find((k) => k.startsWith('Codigo ') && String(prefs[k]).toLowerCase() === cod).replace('Codigo ', '');
      setUsuario(cod); state.nomeUsuario = nome;
      tela.classList.add('oculto');
      resolve();
    };
    btn.onclick = tentar;
    input.onkeydown = (e) => { if (e.key === 'Enter') tentar(); };
    input.focus();
  });
}

async function apiPrefs() {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set('action', 'prefs');
  const res = await fetch(url.toString(), { method: 'GET', redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (data && data.prefs) || {};
}

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
    // Login: se não há juiz cacheado, pede o código antes de carregar o ringue.
    if (!state.usuario) {
      if (usuarioCache()) setUsuario(usuarioCache());
      else {
        state.prefs = await apiPrefs();
        await pedirCodigo(state.prefs);
      }
    }
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
  if (aba === 'visita' || aba === 'shortlist') carregar(true);
}

/* ---------- Sair (trocar de juiz) ---------- */
function sair() {
  localStorage.removeItem(LS_KEY);
  location.reload();
}

/* ---------- SELEÇÃO (cards tinder) ---------- */
function colunaVotoUsuario() {
  return state.usuario === 'fefo' ? 'Voto Fefo' : 'Voto Ray';
}

// Pula imóveis já votados pelo usuário corrente — mas os cards gostei POR mim
// continuam visíveis para o OUTRO usuário (coluna dele ainda vazia).
function pileSelecao() {
  const colVoto = colunaVotoUsuario();
  return state.imoveis.filter((i) =>
    i.Status === STATUS_ENCONTRADO
    && String(i[colVoto] || '').toLowerCase().trim() === '');
}

function imgDeAnuncio(imovel) {
  // Campo 'Link Anúncio' pode conter URL de imagem ou do anúncio; usamos como fallback.
  const link = (imovel['Link Anúncio'] || '').trim();
  if (/^https?:\/\/.+\.(jpe?g|png|webp|gif)(\?|$)/i.test(link)) return link;
  return link || null;
}

function cardHtml(im, topo) {
  const img = imgDeAnuncio(im);
  const colVoto = colunaVotoUsuario();
  const jaVotado = String(im[colVoto] || '').toLowerCase().trim() !== '';
  return `
    <div class="card-lutador ${topo ? 'card-topo' : 'card-atras'}">
      ${topo && jaVotado ? '<div class="selo-votado">💚 você já votou</div>' : ''}
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
          <span>🚗 ${num(im['Vagas Garagem'] ?? im['Vagas']) ?? '—'} vaga(s)</span>
        </div>
        <div class="card-detalhe">
          Aluguel ${brl(im['Preço Aluguel'])} · Cond. ${brl(im['Condomínio'])} · IPTU ${brl(im['IPTU'])}
        </div>
        ${im['Link Anúncio'] ? `<a class="card-link" href="${escapeHtml(im['Link Anúncio'])}" target="_blank" rel="noopener">Ver anúncio ↗</a>` : ''}
      </div>
      <div class="card-vs">🥊 VS</div>
      ${topo ? `
      <div class="card-acoes">
        <button class="btn btn-vermelho" data-acao="nocaute" title="Nocaute">💥 Nocaute</button>
        <button class="btn btn-ouro" data-acao="gostei" title="Gostei">💚 Gostei</button>
      </div>` : ''}
    </div>`;
}

function renderSelecao() {
  const area = document.getElementById('card-area');
  const pilha = pileSelecao();
  if (!pilha.length) {
    area.innerHTML = '<p class="vazio">🥊 Ringue vazio! O agente tá caçando novos lutadores...</p>';
    return;
  }
  const im = pilha[0];
  const prox = pilha[1];
  state.cardAtualId = im.ID;
  area.innerHTML = (prox ? cardHtml(prox, false) : '') + cardHtml(im, true);
  const topCard = area.querySelector('.card-lutador.card-topo');
  bindSwipe(topCard);
  area.querySelectorAll('[data-acao]').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.dataset.acao === 'gostei') animarSaida(topCard, 1, () => acaoCard('gostei'));
      else animarSaida(topCard, -1, () => acaoCard('nocaute'));
    }));
}

/* ---------- Swipe estilo Tinder ---------- */
function bindSwipe(cardEl) {
  let startX = 0, dx = 0, arrastando = false;
  cardEl.addEventListener('pointerdown', (e) => {
    arrastando = true; startX = e.clientX; dx = 0;
    cardEl.setPointerCapture(e.pointerId);
    cardEl.classList.add('arrastando');
  });
  cardEl.addEventListener('pointermove', (e) => {
    if (!arrastando) return;
    dx = e.clientX - startX;
    cardEl.style.transform = `translateX(${dx}px) rotate(${dx / 22}deg)`;
    cardEl.classList.toggle('gostei-hint', dx > 60);
    cardEl.classList.toggle('nocaute-hint', dx < -60);
  });
  cardEl.addEventListener('pointerup', () => {
    if (!arrastando) return; arrastando = false;
    cardEl.classList.remove('arrastando', 'gostei-hint', 'nocaute-hint');
    if (dx > 110) animarSaida(cardEl, 1, () => acaoCard('gostei'));
    else if (dx < -110) animarSaida(cardEl, -1, () => acaoCard('nocaute'));
    else { cardEl.style.transform = ''; dx = 0; }
  });
}

function animarSaida(cardEl, direcao, done) {
  cardEl.style.transition = 'transform .3s ease-in, opacity .3s';
  cardEl.style.transform = `translateX(${direcao * 900}px) rotate(${direcao * 30}deg)`;
  cardEl.style.opacity = '0';
  setTimeout(done, 300);
}

function somaTotal(im) {
  const s = ['Preço Aluguel', 'Condomínio', 'IPTU'].reduce((a, k) => a + (num(im[k]) || 0), 0);
  return s || null;
}

async function apiVote(id, voto, motivo) {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'vote', id, usuario: state.usuario, voto, motivo }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

/* ---------- Voto (gostei/nocaute) ---------- */
function acaoCard(acao) {
  const id = state.cardAtualId;
  if (!id) return;
  if (acao === 'gostei') {
    aplicarVoto(id, 'gostei');
  } else if (acao === 'nocaute') {
    state.reprovarId = id;
    document.getElementById('modal-reprovar').classList.remove('oculto');
    document.getElementById('justificativa').value = '';
  }
}

function aplicarVoto(id, voto, motivo) {
  // Otimista: atualiza estado local e tira o card da pilha
  const im = state.imoveis.find((i) => i.ID === id);
  const colVoto = colunaVotoUsuario();
  if (im) {
    im[colVoto] = voto;
    if (voto === 'nocaute') {
      im.Status = STATUS_DESCARTADO;
      if (motivo) im['Notas/Observações'] = motivo;
    }
  }
  render();
  apiVote(id, voto, motivo || '')
    .then((r) => toast(voto === 'gostei'
      ? (r.resultado === 'shortlist' ? '🔥 2 GOSTEI! Foi pra SHORTLIST!' : '💚 Faltou o voto do outro juiz...')
      : '💥 Nocauteado!', 'ok'))
    .catch(() => { toast('Falha ao salvar o voto. Recarregando...', 'erro'); carregar(true); });
}

/* ---------- Modal reprovar ---------- */
function confirmarReprovar() {
  const just = document.getElementById('justificativa').value.trim();
  const id = state.reprovarId;
  fecharModal();
  aplicarVoto(id, 'nocaute', just); // just pode ser '' — motivo é opcional
}
function fecharModal() {
  document.getElementById('modal-reprovar').classList.add('oculto');
  state.reprovarId = null;
}

/* ---------- SHORTLIST (2 gostei) ---------- */
function pileShortlist() {
  return state.imoveis.filter(
    (i) => String(i['Voto Fefo'] || '').toLowerCase() === 'gostei'
        && String(i['Voto Ray']  || '').toLowerCase() === 'gostei');
}

function renderShortlist() {
  const cont = document.getElementById('shortlist-container');
  const lista = pileShortlist();
  if (!lista.length) {
    cont.innerHTML = '<p class="vazio">Shortlist vazia. Precisa dos 2 GOSTEI dos juízes! 💚💚</p>';
    return;
  }
  cont.innerHTML = `<div class="visita-lista">${lista.map((im) => `
    <div class="linha-visita linha-shortlist" data-id="${escapeHtml(im.ID || '')}">
      <div class="lv-main">
        <div class="lv-topo">
          <span class="badge badge-shortlist">💚 ${escapeHtml(state.nomeUsuario)} + ${state.usuario === 'fefo' ? 'Ray' : 'Fefo'}</span>
          <span class="badge badge-ouro">${brl(num(im['Custo Total']) || somaTotal(im))}</span>
        </div>
        ${linhaVisitaHtml(im)}
      </div>
      <div class="lv-nota">
        ${im.Contato
          ? `<p class="lv-decidido">✅ Decidido: ${escapeHtml(im.Contato)}</p>`
          : `<div class="sl-acoes">
              <button class="btn btn-ouro" data-contato="Eu mesmo">✋ Eu preencho</button>
              <button class="btn btn-vermelho" data-contato="Agente">🥊 Agente contata</button>
             </div>`}
      </div>
    </div>`).join('')}</div>`;
  cont.querySelectorAll('.linha-shortlist [data-contato]').forEach((b) =>
    b.addEventListener('click', async () => {
      const id = b.closest('.linha-shortlist').dataset.id;
      b.disabled = true;
      try {
        await apiPatch(id, { Contato: b.dataset.contato });
        const im = state.imoveis.find((i) => i.ID === id);
        if (im) im.Contato = b.dataset.contato;
        toast(b.dataset.contato === 'Eu mesmo' ? '✋ Você assume o contato!' : '🥊 Agente vai pra porrada!', 'ok');
        render();
      } catch (e) {
        toast('Falha ao salvar a decisão de contato.', 'erro');
        b.disabled = false;
        console.error(e);
      }
    }));
}

/* ---------- VISITA (kanban com drag-and-drop) ---------- */
function pileVisita() {
  // Mesma regra da lista antiga: tudo que passou da seleção e não foi descartado.
  return state.imoveis.filter(
    (i) => i.Status !== STATUS_ENCONTRADO && i.Status !== STATUS_DESCARTADO);
}

function kanbanCardHtml(im) {
  return `
    <div class="kanban-card" draggable="true" data-id="${escapeHtml(im.ID || '')}">
      <div class="kc-topo">
        <span class="badge badge-ouro">${brl(num(im['Custo Total']) || somaTotal(im))}</span>
      </div>
      <div class="kc-titulo">${escapeHtml(im['Título do Anúncio'] || im.Bairro || '—')}</div>
      <p class="kc-meta">📍 ${escapeHtml(im.Bairro || '—')}${num(im['Quartos']) ? ` · 🛏️ ${num(im['Quartos'])}` : ''}${num(im['Vagas Garagem'] ?? im['Vagas']) ? ` · 🚗 ${num(im['Vagas Garagem'] ?? im['Vagas'])}` : ''}</p>
      ${im['Nota Visitada'] ? `<p class="kc-nota">📝 ${escapeHtml(String(im['Nota Visitada']).slice(0, 60))}</p>` : ''}
    </div>`;
}

function renderVisita() {
  const cont = document.getElementById('visita-container');
  const pilha = pileVisita();
  if (!pilha.length) {
    cont.innerHTML = '<p class="vazio">Nenhum lutador classificado ainda. Volte pra aba SELEÇÃO! 🥊</p>';
    return;
  }
  const colunas = VISITA_COLUNAS.map((status) => {
    const cards = pilha
      .filter((i) => (i.Status || '') === status)
      .map(kanbanCardHtml).join('');
    return `
      <div class="kanban-coluna" data-status="${escapeHtml(status)}">
        <div class="kc-cabeca">${escapeHtml(status)} <span class="kc-contagem">${pilha.filter((i) => (i.Status || '') === status).length}</span></div>
        <div class="kc-corpo" data-status="${escapeHtml(status)}">${cards}</div>
      </div>`;
  }).join('');
  cont.innerHTML = `<div class="kanban">${colunas}</div>`;
  bindKanban(cont);
}

/* Drag & drop: arrastar card entre colunas muda o Status (patch na planilha). */
function bindKanban(cont) {
  let arrastado = null;
  cont.querySelectorAll('.kanban-card').forEach((card) => {
    card.addEventListener('dragstart', (e) => {
      arrastado = card;
      card.classList.add('kc-arrastando');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.id); // necessário p/ Firefox
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('kc-arrastando');
      cont.querySelectorAll('.kc-corpo.kc-sobre').forEach((c) => c.classList.remove('kc-sobre'));
      arrastado = null;
    });
    card.addEventListener('click', () => abrirDetalhe(card.dataset.id));
  });
  cont.querySelectorAll('.kc-corpo').forEach((corpo) => {
    corpo.addEventListener('dragover', (e) => {
      e.preventDefault(); // obrigatório p/ permitir drop
      e.dataTransfer.dropEffect = 'move';
      corpo.classList.add('kc-sobre');
    });
    corpo.addEventListener('dragleave', () => corpo.classList.remove('kc-sobre'));
    corpo.addEventListener('drop', (e) => {
      e.preventDefault();
      corpo.classList.remove('kc-sobre');
      if (!arrastado) return;
      const novoStatus = corpo.dataset.status;
      moverCard(arrastado, novoStatus);
    });
  });
}

function moverCard(cardEl, novoStatus) {
  const id = cardEl.dataset.id;
  const im = state.imoveis.find((i) => i.ID === id);
  if (!im || im.Status === novoStatus) return;
  const statusAntigo = im.Status;
  im.Status = novoStatus;                       // otimista
  render();
  apiPatch(id, { Status: novoStatus })
    .then(() => toast(`📋 Status → ${novoStatus}`, 'ok'))
    .catch(() => {
      toast('Falha ao salvar o status. Recarregando...', 'erro');
      const im2 = state.imoveis.find((i) => i.ID === id);
      if (im2) im2.Status = statusAntigo;
      render();
      carregar(true);
    });
}

/* ---------- Modal de detalhes do imóvel ---------- */
function abrirDetalhe(id) {
  const im = state.imoveis.find((i) => i.ID === id);
  if (!im) return;
  state.detalheId = id;
  document.getElementById('detalhe-titulo').textContent = im['Título do Anúncio'] || im.Bairro || 'Imóvel';
  document.getElementById('detalhe-meta').textContent =
    `📍 ${im.Bairro || '—'} · ${brl(num(im['Custo Total']) || somaTotal(im))} · Status: ${im.Status || '—'}`;
  const sel = document.getElementById('detalhe-status');
  sel.innerHTML = VISITA_COLUNAS.concat(STATUS_ENCONTRADO, STATUS_DESCARTADO)
    .map((s) => `<option value="${escapeHtml(s)}" ${s === im.Status ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('');
  const link = document.getElementById('detalhe-link');
  if (im['Link Anúncio']) { link.href = im['Link Anúncio']; link.classList.remove('oculto'); }
  else link.classList.add('oculto');
  document.getElementById('detalhe-nota').value = im['Nota Visitada'] || '';
  document.getElementById('modal-detalhe').classList.remove('oculto');
}

function fecharDetalhe() {
  document.getElementById('modal-detalhe').classList.add('oculto');
  state.detalheId = null;
}

async function salvarDetalhe() {
  const id = state.detalheId;
  if (!id) return;
  const status = document.getElementById('detalhe-status').value;
  const nota = document.getElementById('detalhe-nota').value.trim();
  const im = state.imoveis.find((i) => i.ID === id);
  const patch = { 'Nota Visitada': nota };
  if (im && im.Status !== status) patch.Status = status;
  const btn = document.getElementById('btn-salvar-detalhe');
  btn.disabled = true;
  try {
    await apiPatch(id, patch);
    if (im) { im['Nota Visitada'] = nota; if (patch.Status) im.Status = status; }
    fecharDetalhe();
    render();
    toast('📝 Detalhes salvos!', 'ok');
  } catch (e) {
    toast('Falha ao salvar os detalhes. Tenta de novo!', 'erro');
    console.error(e);
  } finally {
    btn.disabled = false;
  }
}

/* ---------- Helpers ---------- */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* Helper DRY: título + meta compartilhado entre Visita e Shortlist */
function linhaVisitaHtml(im) {
  return `
    <a class="lv-titulo" href="${escapeHtml(im['Link Anúncio'] || '#')}" target="_blank" rel="noopener">
      ${escapeHtml(im['Título do Anúncio'] || '—')} ↗
    </a>
    <p class="lv-meta">📍 ${escapeHtml(im.Bairro || '—')} · ${brl(im['Preço Aluguel'])} + cond. ${brl(im['Condomínio'])} + IPTU ${brl(im['IPTU'])}
    ${num(im['Área']) ? ` · ${num(im['Área'])} m²` : ''}${num(im['Quartos']) ? ` · 🛏️ ${num(im['Quartos'])}` : ''}${num(im['Vagas Garagem'] ?? im['Vagas']) ? ` · 🚗 ${num(im['Vagas Garagem'] ?? im['Vagas'])}` : ''}</p>`;
}

function slug(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
}

function render() {
  if (state.aba === 'selecao') renderSelecao();
  else if (state.aba === 'shortlist') renderShortlist();
  else renderVisita();
}

/* ---------- Boot ---------- */
document.querySelectorAll('.aba').forEach((b) => b.addEventListener('click', () => trocarAba(b.dataset.aba)));
document.getElementById('btn-sair').addEventListener('click', sair);
document.getElementById('btn-cancelar-reprovar').addEventListener('click', fecharModal);
document.getElementById('btn-confirmar-reprovar').addEventListener('click', confirmarReprovar);
document.getElementById('modal-reprovar').addEventListener('click', (e) => {
  if (e.target.id === 'modal-reprovar') fecharModal();
});
document.getElementById('btn-cancelar-detalhe').addEventListener('click', fecharDetalhe);
document.getElementById('btn-salvar-detalhe').addEventListener('click', salvarDetalhe);
document.getElementById('modal-detalhe').addEventListener('click', (e) => {
  if (e.target.id === 'modal-detalhe') fecharDetalhe();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { fecharModal(); fecharDetalhe(); } });

render();
carregar();
