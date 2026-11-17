// Atualização do programa pela internet (mesmo padrão do LoPDV).
// O programa consulta o versao.json no GitHub; se houver versão nova, avisa. Ao confirmar: baixa o pacote, confere tamanho/SHA-256 e a
// ASSINATURA (chave pública embutida) e entrega a troca de arquivos ao atualizar.ps1, que roda depois que o programa fecha,
// troca os arquivos, abre o programa de novo e, se algo der errado, volta para a versão anterior.
const fs = require('fs'), path = require('path'), https = require('https'), crypto = require('crypto'), { spawn, spawnSync } = require('child_process');
const { app } = require('electron');
const { maior, lerManifesto, assinaturaOk } = require('./versao-lib');

const VERSAO = app.getVersion();
const RAIZ = app.getAppPath();                 // pasta dos arquivos do programa (resources\app no programa instalado)
const DATA = app.getPath('userData');          // pasta de dados (dados.json, backups, logs)
const PASTA = path.join(DATA, 'atualizacao');
const ARQ_LOG = path.join(DATA, 'atualizacao.log');
const PUBLICA = () => fs.readFileSync(path.join(RAIZ, 'atualizacao-publica.pem'), 'utf8');
const PODE = () => app.isPackaged && process.platform === 'win32';

const est = { fase: 'ocioso', pct: 0, erro: '' };   // fase: ocioso | baixando | conferindo | iniciando | reiniciando | erro
let disp = null, checado = '', erroUlt = '';

function logar(t) { try { fs.mkdirSync(DATA, { recursive: true }); fs.appendFileSync(ARQ_LOG, '[' + new Date().toLocaleString('sv-SE') + '] ' + t + '\n', 'utf8'); } catch (e) { /* */ } }
function urlManifesto() { try { return String(JSON.parse(fs.readFileSync(path.join(RAIZ, 'atualizacao.json'), 'utf8')).manifesto || '').trim(); } catch (e) { return ''; } }

// GET com redirecionamentos (o GitHub redireciona downloads). Devolve texto, ou grava em arquivo.
function obter(url, { destino, max = 400e6, onProgresso, n = 0 } = {}) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(url); } catch (e) { return reject(new Error('Endereço de atualização inválido.')); }
    if (u.protocol !== 'https:') return reject(new Error('O endereço de atualização precisa começar com https://'));
    const req = https.get(u, { headers: { 'User-Agent': 'ClienteAcessos-Atualizador/' + VERSAO, 'Cache-Control': 'no-cache' }, timeout: 30000 }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume(); if (n >= 6) return reject(new Error('Redirecionamentos demais.'));
        return resolve(obter(new URL(res.headers.location, u).toString(), { destino, max, onProgresso, n: n + 1 }));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('O servidor de atualização respondeu ' + res.statusCode + '.')); }
      const total = Number(res.headers['content-length']) || 0; let lido = 0; const hash = crypto.createHash('sha256');
      const saida = destino ? fs.createWriteStream(destino) : null, partes = [];
      res.on('data', d => {
        lido += d.length; if (lido > max) { req.destroy(new Error('Arquivo grande demais.')); return; }
        hash.update(d); if (saida) saida.write(d); else partes.push(d);
        if (onProgresso && total) onProgresso(Math.min(99, Math.round(100 * lido / total)));
      });
      res.on('end', () => { if (saida) saida.end(() => resolve({ sha256: hash.digest('hex'), tamanho: lido })); else resolve(Buffer.concat(partes).toString('utf8')); });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('O servidor de atualização demorou demais para responder.')));
    req.on('error', reject);
  });
}

async function verificar() {
  const url = urlManifesto();
  if (!url) return { ok: false, erro: 'O endereço de atualização não está configurado.' };
  try {
    const m = lerManifesto(await obter(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { max: 2e6 }), PUBLICA());   // t= evita o cache do GitHub
    checado = new Date().toISOString(); erroUlt = '';
    disp = maior(m.versao, VERSAO) ? { versao: m.versao, data: m.data || '', notas: m.notas || [], arquivo: m.arquivo, sha256: m.sha256, assinatura: m.assinatura, tamanho: m.tamanho || 0, url } : null;
    return { ok: true, nova: disp ? disp.versao : null };
  } catch (e) { erroUlt = e.message; return { ok: false, erro: e.message }; }
}
function situacao() {
  return { versao: VERSAO, disponivel: disp && { versao: disp.versao, data: disp.data, notas: disp.notas, tamanho: disp.tamanho }, checado, erro: erroUlt, pode: PODE(), fase: est.fase };
}
function status() { return { versao: VERSAO, fase: est.fase, pct: est.pct, erro: est.erro }; }

// Comando que roda o atualizar.ps1: lê o texto do script e executa na memória (não depende da política de execução de scripts).
function comandoAtualizador() {
  const pj = path.join(PASTA, 'params.json').replace(/'/g, "''");
  const c = "$p = Get-Content -Raw -Encoding UTF8 '" + pj + "' | ConvertFrom-Json; & ([scriptblock]::Create([IO.File]::ReadAllText($p.ps1))) -Zip $p.zip -Dir $p.dir -Versao $p.versao -Anterior $p.anterior -Exe $p.exe -Data $p.data -Self $p.ps1";
  return 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "' + c + '"';
}
const dorme = ms => new Promise(r => setTimeout(r, ms));
async function esperaMarca(ms) { const m = path.join(PASTA, 'iniciado.txt'); const fim = Date.now() + ms; while (Date.now() < fim) { if (fs.existsSync(m)) return true; await dorme(250); } return false; }
// Inicia o atualizador de 2 jeitos: (A) pelo WMI, que cria o processo fora do grupo do programa e por isso sobrevive ao fechamento dele; (B) cmd /c start.
async function lancarAtualizador() {
  const marca = path.join(PASTA, 'iniciado.txt'); try { fs.unlinkSync(marca); } catch (e) { /* */ }
  const cmd = comandoAtualizador(); const saida = path.join(PASTA, 'atualizador-saida.txt');
  try {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', "$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $env:CLIENTEACESSOS_CMD }; 'WMI retorno=' + $r.ReturnValue + ' pid=' + $r.ProcessId"], { env: { ...process.env, CLIENTEACESSOS_CMD: cmd }, windowsHide: true, encoding: 'utf8', timeout: 20000 });
    logar('Início do atualizador (A, WMI): ' + String(r.stdout || '').trim() + (r.stderr ? ' | erro: ' + String(r.stderr).trim().slice(0, 300) : ''));
  } catch (e) { logar('Início do atualizador (A, WMI) falhou: ' + e.message); }
  if (await esperaMarca(15000)) { logar('Atualizador confirmou que iniciou (A).'); return true; }
  logar('O atualizador não respondeu pelo método A; tentando o método B.');
  try {
    const fd = fs.openSync(saida, 'a');
    const ch = spawn('cmd.exe', ['/d', '/s', '/c', 'start "" /b ' + cmd], { detached: true, stdio: ['ignore', fd, fd], windowsHide: true, windowsVerbatimArguments: true });
    ch.on('error', e => logar('Início do atualizador (B) erro: ' + e.message)); ch.unref();
  } catch (e) { logar('Início do atualizador (B) falhou: ' + e.message); }
  if (await esperaMarca(15000)) { logar('Atualizador confirmou que iniciou (B).'); return true; }
  let s = ''; try { s = fs.readFileSync(saida, 'utf8').trim().slice(-400); } catch (e) { /* */ }
  logar('O atualizador não iniciou por nenhum método.' + (s ? ' Saída: ' + s : '')); return false;
}

// Baixa, confere e entrega ao atualizar.ps1. Responde na hora; o andamento vai pelo status().
async function aplicar(encerrar) {
  if (!PODE()) throw new Error('A atualização automática só funciona no programa instalado (Windows).');
  if (['baixando', 'conferindo', 'iniciando', 'reiniciando'].includes(est.fase)) throw new Error('A atualização já está em andamento.');
  const d = disp;
  if (!d || !maior(d.versao, VERSAO)) throw new Error('Não há atualização disponível. Clique em "Verificar agora".');
  est.fase = 'baixando'; est.pct = 0; est.erro = '';
  (async () => {
    try {
      fs.mkdirSync(PASTA, { recursive: true }); try { fs.unlinkSync(path.join(PASTA, 'resultado.json')); } catch (e) { /* */ }
      logar('===== Atualização ' + VERSAO + ' -> ' + d.versao + ' (pedida pelo usuário) ====='); logar('[1] Baixando o pacote da nova versão');
      const zip = path.join(PASTA, 'pacote-' + d.versao + '.zip');
      const r = await obter(new URL(d.arquivo, d.url).toString(), { destino: zip, onProgresso: p => { est.pct = p; } });
      est.fase = 'conferindo'; est.pct = 100; logar('Pacote baixado. [2] Conferindo SHA-256 e assinatura');
      if (r.sha256 !== d.sha256) throw new Error('O pacote baixado está corrompido (conferência SHA-256 falhou). Tente de novo.');
      if (!assinaturaOk(d, PUBLICA())) throw new Error('Assinatura do pacote inválida. Atualização bloqueada.');
      const ps1 = path.join(PASTA, 'atualizar.ps1'); fs.copyFileSync(path.join(RAIZ, 'atualizar.ps1'), ps1);
      logar('Pacote conferido: SHA-256 e assinatura corretos.');
      fs.writeFileSync(path.join(PASTA, 'params.json'), JSON.stringify({ ps1, zip, dir: RAIZ, versao: d.versao, anterior: VERSAO, exe: process.execPath, data: DATA }), 'utf8');
      est.fase = 'iniciando'; logar('[3] Iniciando o atualizador (fora do processo do programa)');
      // o programa só fecha DEPOIS de o atualizador provar que está rodando (iniciado.txt); senão mostra o erro e continua aberto
      if (!await lancarAtualizador()) throw new Error('O atualizador não iniciou neste computador (veja o log da atualização). O programa não foi alterado e continua aberto.');
      est.fase = 'reiniciando'; logar('Atualizador em execução. [4] Fechando o programa');
      setTimeout(() => encerrar(), 1500);
    } catch (e) { est.fase = 'erro'; est.erro = e.message; logar('FALHA: ' + e.message); }
  })();
  return { ok: true };
}

// Resultado da atualização anterior (gravado pelo atualizar.ps1); lido uma vez ao abrir o programa.
function resultado() {
  const f = path.join(PASTA, 'resultado.json');
  try { const r = JSON.parse(fs.readFileSync(f, 'utf8')); fs.unlinkSync(f); return r; } catch (e) { return null; }
}
function agendar() {
  if (!PODE()) return;
  const tick = async () => { try { if (est.fase === 'ocioso' || est.fase === 'erro') await verificar(); } catch (e) { /* */ } };
  setTimeout(tick, 20000); setInterval(tick, 600 * 1000).unref();
}
function novidades() { try { return JSON.parse(fs.readFileSync(path.join(RAIZ, 'novidades.json'), 'utf8')).versoes || []; } catch (e) { return []; } }

module.exports = { verificar, situacao, status, aplicar, agendar, novidades, resultado, logar, ARQ_LOG, VERSAO };
