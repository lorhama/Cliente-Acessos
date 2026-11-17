'use strict';
// Tela do Cliente Acessos: menu lateral com as lojas, conexões do TeamViewer da loja e sessões do Web Client em abas.
// Tudo é montado com textContent (nunca innerHTML com dados digitados), então nome/observação não executam nada.

const api = window.acessosApi;   // exposto pelo preload (nome diferente de 'api' de propósito: ver preload.js)
const $ = id => document.getElementById(id);
const HOSTS_OK = /(^|\.)(teamviewer\.com|tvwebservices\.org)$/i;
const URL_PADRAO = 'https://web.teamviewer.com/';
const STATUS = { 'em-andamento': 'Em andamento', aguardando: 'Aguardando', concluido: 'Concluído' };
const FILTROS = [['todas', 'Todas'], ['em-andamento', 'Em andamento'], ['aguardando', 'Aguardando'], ['concluido', 'Concluídas']];
const FASES = { ocioso: 'Pronto', baixando: 'Baixando a nova versão…', conferindo: 'Conferindo o pacote (SHA-256 e assinatura)…', iniciando: 'Iniciando o atualizador…', reiniciando: 'O programa vai fechar e abrir sozinho com a nova versão…', erro: 'A atualização não foi concluída.' };

let D = null;                 // dados (lojas, historico, config, ui)
let info = { versao: '', pasta: '', empacotado: false };
const sessoes = new Map();    // conId -> { conId, lojaId, apelido, tvid, wv, histId, inicio }
const abaDaLoja = {};         // lojaId -> 'lista' | 'hist' | conId
let editLoja = null, editCon = null, pollUpd = null;

// ---------- utilidades ----------
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  kids.flat().forEach(c => { if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c))); });
  return e;
}
const novoId = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
const fmtId = t => String(t || '').replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
function fmtDur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + ' s';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' min';
  return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min';
}
function fmtCron(ms) { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 3600) + ':' + String(Math.floor(s % 3600 / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
const fmtData = iso => { const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); };
const urlOk = u => { try { const x = new URL(u); return x.protocol === 'https:' && HOSTS_OK.test(x.hostname); } catch (e) { return false; } };
const lojaAtual = () => D.lojas.find(l => l.id === D.ui.sel) || null;
const tituloLoja = l => 'Farmácia ' + l.codigo + (l.nome ? ' · ' + l.nome : '');
const abertasDaLoja = id => [...sessoes.values()].filter(s => s.lojaId === id);
function abaAtual() {
  const l = lojaAtual(); if (!l) return 'lista';
  const a = abaDaLoja[l.id] || 'lista';
  return (a === 'lista' || a === 'hist' || sessoes.has(a)) ? a : 'lista';
}
let tt = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 4200); }

let tSalvar = 0;
function persistir() { clearTimeout(tSalvar); tSalvar = setTimeout(() => api.salvar(D).then(r => { if (r && r.ok === false) toast('Não foi possível gravar os dados: ' + (r.erro || 'erro desconhecido')); }), 250); }

// ---------- menu lateral ----------
function renderChips() {
  const box = $('chips'); box.replaceChildren();
  FILTROS.forEach(([k, nome]) => {
    const n = k === 'todas' ? D.lojas.length : D.lojas.filter(l => l.status === k).length;
    box.append(h('button', { class: 'chip', type: 'button', 'aria-pressed': String(D.ui.filtro === k), onclick: () => { D.ui.filtro = k; persistir(); render(); } }, nome + ' (' + n + ')'));
  });
}
function renderLista() {
  const q = $('busca').value.trim().toLowerCase();
  const nav = $('lista'); nav.replaceChildren();
  const itens = D.lojas.filter(l => (D.ui.filtro === 'todas' || l.status === D.ui.filtro) &&
    (!q || (l.codigo + ' ' + l.nome + ' ' + l.servico).toLowerCase().includes(q)));
  if (!itens.length) nav.append(h('div', { class: 'vazio-lista' }, D.lojas.length ? 'Nenhuma loja neste filtro.' : 'Nenhuma loja ainda. Clique em “+ Nova loja”.'));
  itens.forEach(l => {
    const ab = abertasDaLoja(l.id).length;
    nav.append(h('button', { class: 'item' + (l.id === D.ui.sel ? ' ativo' : ''), type: 'button', 'aria-current': l.id === D.ui.sel ? 'true' : null, onclick: () => selecionar(l.id) },
      h('span', { class: 'dot ' + l.status, title: STATUS[l.status] }),
      h('span', { class: 'item-txt' },
        h('strong', null, 'Loja ' + l.codigo + (l.nome ? ' · ' + l.nome : '')),
        h('small', null, (l.servico || 'Sem serviço') + ' · ' + STATUS[l.status])),
      h('span', { class: 'count' + (ab ? ' aberta' : ''), title: ab ? ab + ' sessão(ões) aberta(s)' : l.conexoes.length + ' conexão(ões)' }, ab ? ab + ' ●' : l.conexoes.length)));
  });
}
function selecionar(id) { D.ui.sel = id; persistir(); render(); }

// ---------- topo, abas, faixa ----------
function renderTopo() {
  const t = $('topo'); t.replaceChildren();
  const l = lojaAtual();
  if (!l) {
    t.append(h('div', null, h('h2', null, 'Bem-vinda ao Cliente Acessos'),
      h('div', { class: 'meta' }, D.lojas.length ? 'Escolha uma loja no menu à esquerda.' : 'Cadastre a primeira loja para começar.')));
    return;
  }
  const sel = h('select', { 'aria-label': 'Status da loja', onchange: e => { l.status = e.target.value; persistir(); render(); } },
    Object.entries(STATUS).map(([k, v]) => h('option', { value: k, selected: l.status === k }, v)));
  t.append(
    h('div', null, h('h2', null, tituloLoja(l)),
      h('div', { class: 'meta' }, h('span', { class: 'badge ' + l.status }, STATUS[l.status]), l.servico ? '· ' + l.servico : '')),
    h('div', { class: 'head-actions' },
      h('label', { class: 'status-sel' }, 'Status', sel),
      h('button', { class: 'btn', type: 'button', onclick: () => abrirLoja(l) }, 'Editar'),
      h('button', { class: 'btn danger', type: 'button', onclick: () => excluirLoja(l) }, 'Excluir')));
}
function renderAbas() {
  const box = $('abas'); box.replaceChildren();
  const l = lojaAtual(); if (!l) return;
  const a = abaAtual();
  box.append(h('button', { class: 'aba' + (a === 'lista' ? ' ativa' : ''), type: 'button', onclick: () => irAba('lista') }, 'Conexões (' + l.conexoes.length + ')'));
  box.append(h('button', { class: 'aba' + (a === 'hist' ? ' ativa' : ''), type: 'button', onclick: () => irAba('hist') }, 'Histórico'));
  abertasDaLoja(l.id).forEach(s => box.append(
    h('div', { class: 'aba' + (a === s.conId ? ' ativa' : ''), role: 'tab', tabindex: '0', onclick: () => irAba(s.conId) },
      h('span', { class: 'pt' }), s.apelido + ' · ' + fmtId(s.tvid),
      h('span', { class: 'x', title: 'Fechar sessão', onclick: e => { e.stopPropagation(); fecharSessao(s.conId, true); } }, '×'))));
}
function irAba(a) { const l = lojaAtual(); if (!l) return; abaDaLoja[l.id] = a; render(); }
function renderFaixa() {
  const f = $('faixa'); f.replaceChildren();
  const s = sessoes.get(abaAtual());
  f.hidden = !s;
  if (!s) return;
  f.append(
    h('span', null, 'Sessão ', h('b', null, s.apelido), ' · ID ', h('b', null, fmtId(s.tvid)), ' · aberta há ', h('b', { id: 'tempo' }, fmtCron(Date.now() - s.inicio))),
    h('span', { class: 'espaco' }),
    h('span', null, 'Cole o ID (Ctrl+V) no campo de conexão do Web Client.'),
    h('button', { class: 'btn', type: 'button', onclick: () => copiarId(s.tvid) }, 'Copiar ID'),
    h('button', { class: 'btn', type: 'button', onclick: () => recarregar(s) }, 'Recarregar'),
    h('button', { class: 'btn danger', type: 'button', onclick: () => fecharSessao(s.conId, true) }, 'Fechar sessão'));
}
setInterval(() => { const s = sessoes.get(abaAtual()), t = $('tempo'); if (s && t) t.textContent = fmtCron(Date.now() - s.inicio); }, 1000);

// ---------- conteúdo: conexões e histórico ----------
function renderViews() {
  const l = lojaAtual(), a = abaAtual();
  $('viewLista').hidden = !!l && a !== 'lista';
  $('viewHist').hidden = !(l && a === 'hist');
  const v = $('viewLista'); v.replaceChildren();
  if (!l) {
    v.append(h('div', { class: 'vazio' }, h('h3', null, D.lojas.length ? 'Nenhuma loja selecionada' : 'Nenhuma loja cadastrada'),
      h('div', null, 'Cada loja guarda os TeamViewers do atendimento. As sessões abrem em abas aqui dentro.'),
      h('p', null, h('button', { class: 'btn primary', type: 'button', onclick: () => abrirLoja(null) }, '+ Nova loja'))));
    return;
  }
  if (a === 'lista') {
    const abertas = abertasDaLoja(l.id).length;
    v.append(h('div', { class: 'toolbar' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => abrirCon(null) }, '+ Novo TeamViewer'),
      h('button', { class: 'btn', type: 'button', disabled: !l.conexoes.length || abertas === l.conexoes.length, onclick: () => conectarTodos(l) }, 'Conectar todos')));
    const cards = h('div', { class: 'cards' });
    if (!l.conexoes.length) cards.append(h('div', { class: 'vazio' }, h('h3', null, 'Nenhum TeamViewer nesta loja'), h('div', null, 'Adicione o ID de cada computador que você atende (caixa, servidor, retaguarda…).')));
    l.conexoes.forEach(c => {
      const aberta = [...sessoes.values()].find(s => s.conId === c.id);
      cards.append(h('div', { class: 'card' },
        h('div', { class: 'card-top' }, h('h3', null, c.apelido),
          h('div', { class: 'card-menu' },
            h('button', { class: 'mini', type: 'button', onclick: () => abrirCon(c) }, 'Editar'),
            h('button', { class: 'mini', type: 'button', onclick: () => excluirCon(l, c) }, 'Excluir'))),
        h('div', { class: 'tvid' }, fmtId(c.tvid)),
        h('p', { class: 'obs' }, c.obs || ''),
        h('div', { class: 'card-actions' },
          h('button', { class: 'btn primary', type: 'button', onclick: () => abrirSessao(l, c) }, aberta ? 'Ir para a sessão' : 'Conectar'),
          h('button', { class: 'btn', type: 'button', onclick: () => copiarId(c.tvid) }, 'Copiar ID'))));
    });
    v.append(cards);
  }
  if (a === 'hist') renderHist(l);
}
function renderHist(l) {
  const v = $('viewHist'); v.replaceChildren();
  const hs = D.historico.filter(x => x.lojaId === l.id).slice().reverse();
  v.append(h('div', { class: 'toolbar' }, h('button', { class: 'btn danger', type: 'button', disabled: !hs.length, onclick: () => limparHist(l) }, 'Limpar histórico desta loja')));
  if (!hs.length) { v.append(h('div', { class: 'vazio' }, h('h3', null, 'Sem atendimentos registrados'), h('div', null, 'Cada sessão aberta aqui entra no histórico com início, fim e duração.'))); return; }
  const tb = h('tbody');
  hs.forEach(x => {
    const ini = new Date(x.inicio).getTime(), fim = x.fim ? new Date(x.fim).getTime() : NaN;
    const aberta = [...sessoes.values()].some(s => s.histId === x.id);
    tb.append(h('tr', null, h('td', null, x.apelido), h('td', null, fmtData(x.inicio)),
      h('td', null, aberta ? 'em andamento' : (x.fim ? fmtData(x.fim) : 'sem registro')),
      h('td', null, !isNaN(fim) && !isNaN(ini) ? fmtDur(fim - ini) : '—')));
  });
  v.append(h('table', { class: 'tabela' }, h('thead', null, h('tr', null, ['Conexão', 'Início', 'Fim', 'Duração'].map(t => h('th', null, t)))), tb));
}
function limparHist(l) {
  if (!confirm('Apagar o histórico de atendimentos da loja ' + l.codigo + '?')) return;
  const abertas = new Set(abertasDaLoja(l.id).map(s => s.histId));
  D.historico = D.historico.filter(x => x.lojaId !== l.id || abertas.has(x.id));
  persistir(); render();
}

// ---------- palco: mostra só a sessão da aba ativa ----------
function atualizarPalco() {
  const l = lojaAtual(), a = abaAtual();
  sessoes.forEach(s => { s.wv.classList.toggle('visivel', !!l && s.lojaId === l.id && a === s.conId); });
}
function render() {
  renderChips(); renderLista(); renderTopo(); renderAbas(); renderFaixa(); renderViews(); atualizarPalco();
}

// ---------- sessões do Web Client ----------
function copiarId(tvid) { api.copiar(String(tvid).replace(/\D/g, '')); toast('ID ' + fmtId(tvid) + ' copiado.'); }
function criarSessao(l, c) {
  const wv = document.createElement('webview');
  wv.className = 'sessao';
  wv.setAttribute('partition', 'persist:teamviewer');   // mesmo login em todas as abas e entre aberturas do programa
  wv.setAttribute('allowpopups', '');
  wv.addEventListener('did-fail-load', e => { if (e.isMainFrame && e.errorCode !== -3) toast('Não foi possível carregar o Web Client (' + (e.errorDescription || 'erro') + '). Confira a internet.'); });
  wv.addEventListener('render-process-gone', () => toast('A aba da sessão ' + c.apelido + ' parou de responder. Use “Recarregar”.'));
  // o endereço precisa estar definido ANTES de entrar na tela: é nesse momento que o programa confere partição e endereço
  wv.setAttribute('src', urlOk(D.config.urlWebClient) ? D.config.urlWebClient : URL_PADRAO);
  $('stage').append(wv);
  const hist = { id: novoId(), lojaId: l.id, conId: c.id, apelido: c.apelido, inicio: new Date().toISOString(), fim: '' };
  D.historico.push(hist);
  const s = { conId: c.id, lojaId: l.id, apelido: c.apelido, tvid: c.tvid, wv, histId: hist.id, inicio: Date.now() };
  sessoes.set(c.id, s);
  return s;
}
function abrirSessao(l, c, quieto) {
  if (!sessoes.has(c.id)) {
    criarSessao(l, c);
    if (!quieto) { copiarId(c.tvid); persistir(); }
  }
  abaDaLoja[l.id] = c.id;
  if (!quieto) render();
}
function conectarTodos(l) {
  const antes = abertasDaLoja(l.id).length;
  l.conexoes.forEach(c => abrirSessao(l, c, true));
  const novas = abertasDaLoja(l.id).length - antes;
  if (novas) { copiarId(l.conexoes[0].tvid); abaDaLoja[l.id] = l.conexoes[0].id; }
  persistir(); render();
  toast(novas + ' sessão(ões) aberta(s). Em cada aba use “Copiar ID” e cole no Web Client.');
}
function fecharSessao(conId, perguntar) {
  const s = sessoes.get(conId); if (!s) return;
  if (perguntar && !confirm('Fechar a sessão “' + s.apelido + '”? A conexão com o computador do cliente será encerrada.')) return;
  const hh = D.historico.find(x => x.id === s.histId); if (hh) hh.fim = new Date().toISOString();
  try { s.wv.remove(); } catch (e) { /* */ }
  sessoes.delete(conId);
  if (abaDaLoja[s.lojaId] === conId) abaDaLoja[s.lojaId] = 'lista';
  persistir(); render();
}
function recarregar(s) {
  if (!confirm('Recarregar a página encerra a conexão com o cliente. Continuar?')) return;
  try { s.wv.reload(); } catch (e) { toast('Não foi possível recarregar agora.'); }
}

// ---------- lojas e conexões (janelas) ----------
function abrirLoja(l) {
  editLoja = l ? l.id : null;
  $('tituloLoja').textContent = l ? 'Editar loja' : 'Nova loja';
  const f = $('formLoja');
  f.codigo.value = l ? l.codigo : ''; f.nome.value = l ? l.nome : ''; f.servico.value = l ? l.servico : ''; f.status.value = l ? l.status : 'em-andamento';
  $('dlgLoja').showModal(); f.codigo.focus();
}
$('formLoja').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target, v = { codigo: f.codigo.value.trim(), nome: f.nome.value.trim(), servico: f.servico.value.trim(), status: f.status.value };
  if (!v.codigo) return;
  let l = D.lojas.find(x => x.id === editLoja);
  if (l) Object.assign(l, v);
  else { l = { id: novoId(), ...v, criadoEm: new Date().toISOString(), conexoes: [] }; D.lojas.push(l); D.ui.sel = l.id; if (D.ui.filtro !== 'todas' && D.ui.filtro !== l.status) D.ui.filtro = 'todas'; }
  $('dlgLoja').close(); persistir(); render();
});
function excluirLoja(l) {
  const ab = abertasDaLoja(l.id).length;
  if (!confirm('Excluir a loja ' + l.codigo + ' com ' + l.conexoes.length + ' conexão(ões) e o histórico dela?' + (ab ? '\n\n' + ab + ' sessão(ões) aberta(s) será(ão) encerrada(s).' : '') + '\n\nIsso não pode ser desfeito (só pelos backups).')) return;
  abertasDaLoja(l.id).forEach(s => fecharSessao(s.conId, false));
  D.lojas = D.lojas.filter(x => x.id !== l.id);
  D.historico = D.historico.filter(x => x.lojaId !== l.id);
  delete abaDaLoja[l.id];
  D.ui.sel = D.lojas.length ? D.lojas[0].id : null;
  persistir(); render();
}
function abrirCon(c) {
  editCon = c ? c.id : null;
  $('tituloCon').textContent = c ? 'Editar TeamViewer' : 'Novo TeamViewer';
  const f = $('formCon');
  f.apelido.value = c ? c.apelido : ''; f.tvid.value = c ? fmtId(c.tvid) : ''; f.obs.value = c ? c.obs : '';
  $('dlgCon').showModal(); f.apelido.focus();
}
$('formCon').addEventListener('submit', e => {
  e.preventDefault();
  const l = lojaAtual(); if (!l) return;
  const f = e.target, tvid = f.tvid.value.replace(/\D/g, '');
  if (tvid.length < 8 || tvid.length > 12) { toast('O ID do TeamViewer tem de 8 a 12 números.'); f.tvid.focus(); return; }
  const v = { apelido: f.apelido.value.trim(), tvid, obs: f.obs.value.trim() };
  if (!v.apelido) return;
  const c = l.conexoes.find(x => x.id === editCon);
  if (c) { Object.assign(c, v); const s = sessoes.get(c.id); if (s) { s.apelido = v.apelido; s.tvid = tvid; } }
  else l.conexoes.push({ id: novoId(), ...v });
  $('dlgCon').close(); persistir(); render();
});
function excluirCon(l, c) {
  const aberta = sessoes.has(c.id);
  if (!confirm('Excluir o TeamViewer “' + c.apelido + '”?' + (aberta ? '\n\nA sessão aberta dele será encerrada.' : ''))) return;
  if (aberta) fecharSessao(c.id, false);
  l.conexoes = l.conexoes.filter(x => x.id !== c.id);
  persistir(); render();
}

// ---------- configurações, atualização, novidades, sobre ----------
function abrirCfg() { $('urlWeb').value = D.config.urlWebClient; $('dlgCfg').showModal(); }
function salvarUrl(url) {
  if (!urlOk(url)) { toast('Use um endereço https do teamviewer.com (ex.: ' + URL_PADRAO + ').'); return; }
  D.config.urlWebClient = url; $('urlWeb').value = url; persistir(); toast('Endereço salvo. Vale para as próximas sessões.');
}
async function backupAgora() { const r = await api.backupAgora(); toast(r && r.ok ? 'Backup feito.' : 'Não foi possível fazer o backup' + (r && r.erro ? ': ' + r.erro : '.')); }

function abrirInfo(titulo, corpo) { $('infoTitulo').textContent = titulo; const c = $('infoCorpo'); c.replaceChildren(...corpo); $('dlgInfo').showModal(); }
function listaNotas(notas) {
  return h('ul', { class: 'notas' }, (notas || []).map(n => h('li', null, h('span', { class: 'tipo ' + (n.tipo === 'correcao' ? 'correcao' : 'melhoria') }, n.tipo === 'correcao' ? 'Correção' : 'Melhoria'), n.texto)));
}
async function abrirNovidades() {
  const vs = await api.novidades();
  abrirInfo('Novidades', vs.length ? vs.map(v => h('div', null, h('h3', null, 'Versão ' + v.versao + (v.data ? ' · ' + v.data : '')), listaNotas(v.itens))) : [h('div', null, 'Sem novidades registradas.')]);
}
function abrirSobre() {
  abrirInfo('Sobre o Cliente Acessos', [
    h('p', null, 'Versão ' + info.versao + '. Organiza os acessos do TeamViewer por farmácia e abre as sessões do Web Client em abas dentro do programa.'),
    h('div', { class: 'dica' }, 'Dados e backups: ' + info.pasta),
    h('div', { class: 'dica' }, 'O Web Client só faz conexões de saída e envia arquivos do seu computador para o cliente (o contrário não é permitido pelo TeamViewer).')]);
}

async function renderUpd() {
  const s = await api.updSituacao(); const corpo = $('updCorpo'), ac = $('updAcoes');
  corpo.replaceChildren(); ac.replaceChildren();
  if (!s) { corpo.append(h('div', null, 'Não foi possível consultar a atualização.')); ac.append(h('button', { class: 'btn primary', 'data-action': 'fechar' }, 'Fechar')); return; }
  corpo.append(h('p', null, 'Versão instalada: ', h('b', null, s.versao), s.checado ? ' · última checagem ' + fmtData(s.checado) : ''));
  if (s.erro) corpo.append(h('div', { class: 'dica' }, 'Não deu para checar agora: ' + s.erro));
  if (s.disponivel) {
    corpo.append(h('p', null, 'Nova versão disponível: ', h('b', null, s.disponivel.versao), s.disponivel.data ? ' (' + s.disponivel.data + ')' : ''), listaNotas(s.disponivel.notas));
    if (!s.pode) corpo.append(h('div', { class: 'dica' }, 'A atualização automática só funciona no programa instalado (Windows).'));
  } else if (!s.erro) corpo.append(h('p', null, s.checado ? 'Você está com a versão mais recente.' : 'Ainda não foi checado. Clique em “Verificar agora”.'));
  corpo.append(h('div', { id: 'updFase' }), h('div', { class: 'barra', id: 'updBarra', hidden: true }, h('i')));
  ac.append(
    h('button', { class: 'btn', id: 'btnVer', type: 'button', onclick: verificarAgora }, 'Verificar agora'),
    h('button', { class: 'btn primary', id: 'btnAtu', type: 'button', disabled: !(s.disponivel && s.pode), onclick: atualizarAgora }, 'Atualizar agora'),
    h('button', { class: 'btn', 'data-action': 'fechar', type: 'button' }, 'Fechar'));
  if (['baixando', 'conferindo', 'iniciando', 'reiniciando'].includes(s.fase)) acompanhar();
}
async function abrirUpd(verificar) { $('dlgUpd').showModal(); await renderUpd(); if (verificar) verificarAgora(); }
async function verificarAgora() {
  const b = $('btnVer'); if (b) { b.disabled = true; b.textContent = 'Verificando…'; }
  await api.updVerificar(); await renderUpd(); atualizarBanner();
}
async function atualizarAgora() {
  const n = sessoes.size;
  if (n && !confirm('Há ' + n + ' sessão(ões) aberta(s). Atualizar fecha o programa e encerra as sessões. Continuar?')) return;
  $('btnAtu').disabled = true; $('btnVer').disabled = true;
  const r = await api.updAplicar();
  if (!r || r.ok === false) { toast((r && r.erro) || 'Não foi possível iniciar a atualização.'); return renderUpd(); }
  acompanhar();
}
function acompanhar() {
  clearInterval(pollUpd);
  pollUpd = setInterval(async () => {
    const st = await api.updStatus(); if (!st) return;
    const f = $('updFase'), b = $('updBarra');
    if (!f) { clearInterval(pollUpd); return; }
    f.textContent = (FASES[st.fase] || st.fase) + (st.fase === 'baixando' ? ' ' + Math.round(st.pct || 0) + '%' : '') + (st.erro ? ' ' + st.erro : '');
    b.hidden = !['baixando', 'conferindo'].includes(st.fase); b.firstChild.style.width = Math.round(st.pct || 0) + '%';
    if (st.fase === 'erro') { clearInterval(pollUpd); renderUpd().then(() => { const ff = $('updFase'); if (ff) ff.textContent = st.erro || FASES.erro; }); }
  }, 700);
}
async function atualizarBanner() {
  const s = await api.updSituacao(), b = $('updBanner');
  if (s && s.disponivel) { b.hidden = false; b.replaceChildren(h('span', null, 'Nova versão ' + s.disponivel.versao), h('button', { class: 'btn', type: 'button', onclick: () => abrirUpd(false) }, 'Ver')); }
  else b.hidden = true;
}

// ---------- eventos gerais ----------
document.addEventListener('click', e => {
  const a = e.target.closest('[data-action]'); if (!a) return;
  switch (a.dataset.action) {
    case 'nova-loja': abrirLoja(null); break;
    case 'config': abrirCfg(); break;
    case 'fechar': { const d = a.closest('dialog'); if (d) d.close(); clearInterval(pollUpd); break; }
    case 'salvar-url': salvarUrl($('urlWeb').value.trim()); break;
    case 'url-padrao': salvarUrl(URL_PADRAO); break;
    case 'backup': backupAgora(); break;
    case 'pasta': api.abrirPasta(); break;
  }
});
$('busca').addEventListener('input', renderLista);
window.addEventListener('beforeunload', () => {
  const agora = new Date().toISOString();
  sessoes.forEach(s => { const hh = D && D.historico.find(x => x.id === s.histId); if (hh && !hh.fim) hh.fim = agora; });
  if (D) api.salvarSync(D);
});

(async function iniciar() {
  info = (await api.info()) || info;
  D = await api.carregar();
  if (!D) { document.body.textContent = 'Não foi possível carregar os dados.'; return; }
  if (D.ui.sel && !D.lojas.some(l => l.id === D.ui.sel)) D.ui.sel = null;
  if (!D.ui.sel && D.lojas.length) D.ui.sel = D.lojas[0].id;
  // sessões que ficaram abertas quando o programa foi fechado de forma inesperada ficam sem horário de fim
  $('versao').textContent = 'Versão ' + info.versao;
  render();
  api.aoMenu(acao => { ({ backup: backupAgora, atualizacao: () => abrirUpd(true), novidades: abrirNovidades, sobre: abrirSobre })[acao]?.(); });
  atualizarBanner(); setInterval(atualizarBanner, 60000);
})();
