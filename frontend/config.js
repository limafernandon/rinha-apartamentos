// Configuração do frontend Rinha de Apartamentos.
//
// Prioridade de resolução da URL do backend (Apps Script):
//   1. Query param na URL da página:  ?url=https://script.google.com/macros/s/XXXX/exec
//   2. Valor abaixo (APPS_SCRIPT_URL).
//
// ⚠️ NÃO preencha com URL de produção aqui. Cole a URL real do deploy do
// Apps Script apenas quando ela existir, ou use ?url=... na barra de endereço.
const APPS_SCRIPT_URL = window.APPS_SCRIPT_URL_OVERRIDE ||
  (new URLSearchParams(window.location.search).get('url')) ||
  'https://script.google.com/macros/s/AKfycbx0H19iVvVGbNsQr34GzpcaEvbKP-7KnR0M_qY3vQNIHmTyKbgkJ6X35y_pGIg4mDYbvg/exec';
