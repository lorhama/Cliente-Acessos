// Banco de dados do programa: um arquivo JSON na pasta de dados do usuário do Windows (dados.json),
// gravado de forma segura (arquivo temporário + troca) e com backups automáticos diários.
const fs = require('fs');
const path = require('path');
const { urlTeamViewerOk } = require('./util');

const URL_PADRAO = 'https://web.teamviewer.com/';
const STATUS = ['em-andamento', 'aguardando', 'concluido'];
const FILTROS = ['todas'].concat(STATUS);
const MANTER_BACKUPS = 14;

let pasta = '', arq = '';

const vazio = () => ({ versaoDados: 1, lojas: [], historico: [], config: { urlWebClient: URL_PADRAO }, ui: { sel: null, filtro: 'todas' } });
const novoId = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
const str = (v, max) => String(v == null ? '' : v).slice(0, max);

function init(dir) {
  pasta = dir; arq = path.join(dir, 'dados.json');
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
}

// Garante o formato dos dados (e limita tamanhos) antes de gravar ou de entregar à tela.
function normalizar(d) {
  const o = vazio();
  if (!d || typeof d !== 'object') return o;
  o.lojas = (Array.isArray(d.lojas) ? d.lojas : []).slice(0, 2000).filter(l => l && typeof l === 'object').map(l => ({
    id: str(l.id, 40) || novoId(),
    codigo: str(l.codigo, 30),
    nome: str(l.nome, 80),
    servico: str(l.servico, 60),
    status: STATUS.includes(l.status) ? l.status : 'em-andamento',
    criadoEm: str(l.criadoEm, 40),
    conexoes: (Array.isArray(l.conexoes) ? l.conexoes : []).slice(0, 200).filter(c => c && typeof c === 'object').map(c => ({
      id: str(c.id, 40) || novoId(),
      apelido: str(c.apelido, 60),
      tvid: str(c.tvid, 16).replace(/\D/g, ''),
      obs: str(c.obs, 200),
    })),
  }));
  o.historico = (Array.isArray(d.historico) ? d.historico : []).slice(-5000).filter(h => h && typeof h === 'object').map(h => ({
    id: str(h.id, 40) || novoId(), lojaId: str(h.lojaId, 40), conId: str(h.conId, 40),
    apelido: str(h.apelido, 60), inicio: str(h.inicio, 40), fim: str(h.fim, 40),
  }));
  const u = d.config && d.config.urlWebClient;
  o.config.urlWebClient = urlTeamViewerOk(u) ? String(u) : URL_PADRAO;
  const ui = d.ui || {};
  o.ui = { sel: str(ui.sel, 40) || null, filtro: FILTROS.includes(ui.filtro) ? ui.filtro : 'todas' };
  return o;
}

function carimbo() { return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'); }
function listaBackups() {
  try { return fs.readdirSync(path.join(pasta, 'backups')).filter(n => /^dados-.*\.json$/.test(n)).sort(); } catch (e) { return []; }
}
function ultimoBackup() { const l = listaBackups(); return l.length ? path.join(pasta, 'backups', l[l.length - 1]) : ''; }

function carregar() {
  if (fs.existsSync(arq)) {
    try { return normalizar(JSON.parse(fs.readFileSync(arq, 'utf8'))); }
    catch (e) {
      // arquivo danificado: guarda uma cópia e tenta o último backup (nunca apaga nada)
      try { fs.copyFileSync(arq, path.join(pasta, 'dados-danificado-' + carimbo() + '.json')); } catch (e2) { /* */ }
      const b = ultimoBackup();
      if (b) { try { return normalizar(JSON.parse(fs.readFileSync(b, 'utf8'))); } catch (e3) { /* */ } }
    }
  }
  return vazio();
}

function salvar(d) {
  try {
    const o = normalizar(d);
    const tmp = arq + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(o, null, 1), 'utf8');
    fs.renameSync(tmp, arq);
    return { ok: true };
  } catch (e) { return { ok: false, erro: e.message }; }
}

// Backup do dia (sobrescreve o do mesmo dia) ou, com "agora", um backup separado com hora. Guarda os últimos 14.
function backup(agora) {
  try {
    if (!fs.existsSync(arq)) return { ok: true, arquivo: '' };
    const nome = agora ? 'dados-' + carimbo() + '.json' : 'dados-' + new Date().toISOString().slice(0, 10) + '.json';
    const destino = path.join(pasta, 'backups', nome);
    fs.copyFileSync(arq, destino);
    const l = listaBackups();
    l.slice(0, Math.max(0, l.length - MANTER_BACKUPS)).forEach(n => { try { fs.unlinkSync(path.join(pasta, 'backups', n)); } catch (e) { /* */ } });
    return { ok: true, arquivo: destino };
  } catch (e) { return { ok: false, erro: e.message }; }
}

module.exports = { init, carregar, salvar, backup, normalizar, URL_PADRAO, listaBackups };
