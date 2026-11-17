// Testes automáticos do Cliente Acessos (rodam sem Electron): node test/testes.js
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const RAIZ = path.join(__dirname, '..');
const util = require('../util');
const lib = require('../versao-lib');
const dados = require('../dados');

let ok = 0, falhas = 0;
function t(nome, fn) {
  try { fn(); ok++; console.log('  ok   ' + nome); } catch (e) { falhas++; console.log('  FALHA ' + nome + '\n        ' + e.message); }
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'clienteacessos-test-'));

console.log('util');
t('aceita só https do TeamViewer', () => {
  assert(util.urlTeamViewerOk('https://web.teamviewer.com/'));
  assert(util.urlTeamViewerOk('https://login.teamviewer.com/x?y=1'));
  assert(util.urlTeamViewerOk('https://teamviewer.com/'));
  for (const u of ['http://web.teamviewer.com/', 'https://teamviewer.com.evil.io/', 'https://evilteamviewer.com/', 'https://evil.com/?https://web.teamviewer.com/', 'javascript:alert(1)', 'file:///c:/x', '', null, 'web.teamviewer.com'])
    assert(!util.urlTeamViewerOk(u), 'deveria recusar ' + u);
});
t('limparUA tira Electron e o nome do programa (com ou sem espaço), mantém Chrome', () => {
  const base = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ';
  const fim = 'Chrome/126.0.6478.61 Safari/537.36';
  for (const nome of ['cliente-acessos/1.0.0 ', 'Cliente Acessos/1.0.0 ', 'ClienteAcessos/1.0.0 ', '']) {
    const r = util.limparUA(base + nome + 'Chrome/126.0.6478.61 Electron/31.0.0 Safari/537.36');
    assert.strictEqual(r, base + fim, JSON.stringify(nome) + ' -> ' + r);
  }
  assert.strictEqual(util.limparUA(base + fim), base + fim);
  assert.strictEqual(util.limparUA(''), '');
});
t('hosts de login (Google/Microsoft/Apple) reconhecidos', () => {
  assert(util.HOSTS_LOGIN.test('accounts.google.com') && util.HOSTS_LOGIN.test('login.microsoftonline.com') && util.HOSTS_LOGIN.test('appleid.apple.com'));
  assert(!util.HOSTS_LOGIN.test('google.com.evil.io') && !util.HOSTS_LOGIN.test('notgoogle.com'));
});

console.log('versão e assinatura');
t('comparação de versões', () => {
  assert(lib.maior('1.0.1', '1.0.0') && lib.maior('1.1.0', '1.0.9') && lib.maior('2.0.0', '1.9.9') && lib.maior('1.0.10', '1.0.9'));
  assert(!lib.maior('1.0.0', '1.0.0') && !lib.maior('1.0.0', '1.0.1'));
});
const par = crypto.generateKeyPairSync('ed25519');
const pubPem = par.publicKey.export({ type: 'spki', format: 'pem' });
const sha = crypto.createHash('sha256').update('pacote').digest('hex');
const assinar = (versao, s) => crypto.sign(null, Buffer.from(versao + '|' + s), par.privateKey).toString('base64');
const manifesto = (o = {}) => JSON.stringify(Object.assign({ versao: '1.0.1', data: '18/11/2026', arquivo: 'atualizacao-1.0.1.zip', sha256: sha, tamanho: 10, assinatura: assinar('1.0.1', sha), notas: [] }, o));
t('manifesto assinado é aceito', () => { assert.strictEqual(lib.lerManifesto(manifesto(), pubPem).versao, '1.0.1'); });
t('versão adulterada é recusada', () => { assert.throws(() => lib.lerManifesto(manifesto({ versao: '9.9.9' }), pubPem), /assinatura/); });
t('SHA-256 adulterado é recusado', () => { assert.throws(() => lib.lerManifesto(manifesto({ sha256: crypto.createHash('sha256').update('outro').digest('hex') }), pubPem), /assinatura/); });
t('assinatura de outra chave é recusada', () => {
  const outra = crypto.generateKeyPairSync('ed25519');
  const falsa = crypto.sign(null, Buffer.from('1.0.1|' + sha), outra.privateKey).toString('base64');
  assert.throws(() => lib.lerManifesto(manifesto({ assinatura: falsa }), pubPem), /assinatura/);
});
t('sem assinatura, JSON inválido e campos faltando são recusados', () => {
  assert.throws(() => lib.lerManifesto(manifesto({ assinatura: '' }), pubPem));
  assert.throws(() => lib.lerManifesto('não é json', pubPem), /inválido/);
  assert.throws(() => lib.lerManifesto(manifesto({ arquivo: '' }), pubPem), /campos/);
  assert.throws(() => lib.lerManifesto(manifesto({ versao: '1.0' }), pubPem), /campos/);
});
t('manifesto publicado (atualizacoes/versao.json) confere com a chave embutida e com o zip', () => {
  const mf = path.join(RAIZ, 'atualizacoes', 'versao.json');
  if (!fs.existsSync(mf)) return;   // ainda não publicado
  const pem = fs.readFileSync(path.join(RAIZ, 'atualizacao-publica.pem'), 'utf8');
  const m = lib.lerManifesto(fs.readFileSync(mf, 'utf8'), pem);
  const zip = fs.readFileSync(path.join(RAIZ, 'atualizacoes', m.arquivo));
  assert.strictEqual(crypto.createHash('sha256').update(zip).digest('hex'), m.sha256, 'SHA-256 do zip diferente do manifesto');
  assert.strictEqual(zip.length, m.tamanho, 'tamanho do zip diferente do manifesto');
  const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
  if (!process.env.PUBLICANDO) assert(!lib.maior(pkg.version, m.versao) , 'package.json (' + pkg.version + ') está à frente do manifesto (' + m.versao + '): falta rodar o publicador');
});

console.log('dados');
t('normalizar corrige lixo e limita campos', () => {
  const n = dados.normalizar({ lojas: [{ codigo: 'x'.repeat(100), status: 'invalido', conexoes: [{ apelido: 'A', tvid: '12a3 456-789', obs: 'o' }, null, 5] }, null, 'x'], historico: [{ lojaId: 'a' }, 7], config: { urlWebClient: 'http://evil.com' }, ui: { filtro: 'xx', sel: 'q' } });
  assert.strictEqual(n.lojas.length, 1); assert.strictEqual(n.lojas[0].codigo.length, 30);
  assert.strictEqual(n.lojas[0].status, 'em-andamento'); assert.strictEqual(n.lojas[0].conexoes.length, 1);
  assert.strictEqual(n.lojas[0].conexoes[0].tvid, '123456789'); assert(n.lojas[0].id && n.lojas[0].conexoes[0].id);
  assert.strictEqual(n.historico.length, 1); assert.strictEqual(n.config.urlWebClient, dados.URL_PADRAO); assert.strictEqual(n.ui.filtro, 'todas');
  assert.deepStrictEqual(dados.normalizar(null).lojas, []);
});
t('senha: cada conexão guarda a sua; a senha padrão vem como #tvtrier! e pode ser trocada; limites', () => {
  assert.strictEqual(dados.SENHA_PADRAO, '#tvtrier!');
  assert.strictEqual(dados.normalizar(null).config.senhaPadrao, '#tvtrier!');
  assert.strictEqual(dados.normalizar({ config: {} }).config.senhaPadrao, '#tvtrier!', 'dados antigos (sem o campo) ganham a padrão');
  assert.strictEqual(dados.normalizar({ config: { senhaPadrao: 'outra#1' } }).config.senhaPadrao, 'outra#1');
  assert.strictEqual(dados.normalizar({ config: { senhaPadrao: '' } }).config.senhaPadrao, '', 'vazia é permitido (sem sugestão)');
  assert.strictEqual(dados.normalizar({ config: { senhaPadrao: 5 } }).config.senhaPadrao, '#tvtrier!');
  const n = dados.normalizar({ lojas: [{ codigo: '1', conexoes: [{ apelido: 'A', tvid: '123456789', senha: '#tvtrier!' }, { apelido: 'B', tvid: '987654321' }, { apelido: 'C', tvid: '111111111', senha: 'x'.repeat(300) }] }] });
  assert.strictEqual(n.lojas[0].conexoes[0].senha, '#tvtrier!'); assert.strictEqual(n.lojas[0].conexoes[1].senha, ''); assert.strictEqual(n.lojas[0].conexoes[2].senha.length, 100);
  const d = tmp(); dados.init(d); dados.salvar(n);
  assert.deepStrictEqual(dados.carregar(), n);
});
t('salvar e carregar (ida e volta)', () => {
  const d = tmp(); dados.init(d);
  const x = dados.normalizar({ lojas: [{ id: 'L1', codigo: '33281', nome: 'Fraga', servico: 'Implantação', status: 'aguardando', conexoes: [{ id: 'C1', apelido: 'Caixa 1', tvid: '123456789', obs: '' }] }], ui: { sel: 'L1', filtro: 'todas' } });
  assert.strictEqual(dados.salvar(x).ok, true);
  assert.deepStrictEqual(dados.carregar(), x);
  assert(!fs.existsSync(path.join(d, 'dados.json.tmp')), 'não pode sobrar arquivo temporário');
});
t('arquivo danificado: guarda cópia e volta para o último backup', () => {
  const d = tmp(); dados.init(d);
  dados.salvar(dados.normalizar({ lojas: [{ id: 'L1', codigo: '77', conexoes: [] }] })); dados.backup(false);
  fs.writeFileSync(path.join(d, 'dados.json'), '{ quebrado');
  const r = dados.carregar();
  assert.strictEqual(r.lojas.length, 1); assert.strictEqual(r.lojas[0].codigo, '77');
  assert(fs.readdirSync(d).some(n => n.startsWith('dados-danificado-')), 'deveria guardar o arquivo danificado');
});
t('sem arquivo: começa vazio', () => { const d = tmp(); dados.init(d); assert.deepStrictEqual(dados.carregar().lojas, []); });
t('backups: guarda só os 14 mais recentes', () => {
  const d = tmp(); dados.init(d); dados.salvar(dados.normalizar({}));
  const pasta = path.join(d, 'backups');
  for (let i = 1; i <= 20; i++) fs.writeFileSync(path.join(pasta, 'dados-2026-01-' + String(i).padStart(2, '0') + '.json'), '{}');
  const r = dados.backup(false);
  assert.strictEqual(r.ok, true);
  const l = dados.listaBackups(); assert.strictEqual(l.length, 14);
  assert(!l.includes('dados-2026-01-01.json') && l.includes('dados-2026-01-20.json'));
});

console.log('projeto');
const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
t('arquivos do instalador (build.files) existem', () => {
  for (const p of pkg.build.files) {
    const alvo = path.join(RAIZ, p.replace(/\/\*\*$/, ''));
    assert(fs.existsSync(alvo), 'não existe: ' + p);
  }
});
t('versão do package.json aparece em novidades.json', () => {
  const nov = JSON.parse(fs.readFileSync(path.join(RAIZ, 'novidades.json'), 'utf8')).versoes;
  assert(nov.some(v => v.versao === pkg.version), 'novidades.json sem a versão ' + pkg.version);
});
t('atualizacao.json aponta para https', () => {
  const j = JSON.parse(fs.readFileSync(path.join(RAIZ, 'atualizacao.json'), 'utf8'));
  assert(/^https:\/\//.test(j.manifesto));
});
t('chave privada não está dentro do projeto versionado', () => {
  const gi = fs.readFileSync(path.join(RAIZ, '.gitignore'), 'utf8');
  assert(/\.chaves\//.test(gi));
  const pub = fs.readFileSync(path.join(RAIZ, 'atualizacao-publica.pem'), 'utf8');
  assert(/BEGIN PUBLIC KEY/.test(pub) && !/PRIVATE/.test(pub));
  for (const n of fs.readdirSync(RAIZ)) if (fs.statSync(path.join(RAIZ, n)).isFile()) assert(!/PRIVATE KEY/.test(fs.readFileSync(path.join(RAIZ, n), 'utf8').slice(0, 4000)) || n === 'testes.js', 'chave privada encontrada em ' + n);
});
t('atualizar.ps1 é ASCII puro (não quebra no PowerShell 5.1) e tem os parâmetros esperados', () => {
  const b = fs.readFileSync(path.join(RAIZ, 'atualizar.ps1'));
  for (const x of b) assert(x < 128, 'caractere não-ASCII no atualizar.ps1');
  const s = b.toString();
  for (const p of ['$Zip', '$Dir', '$Versao', '$Anterior', '$Exe', '$Data', '$Elevado', '$Self']) assert(s.includes(p), 'faltando ' + p);
});
t('tela: index.html liga style.css e app.js, com CSP', () => {
  const h = fs.readFileSync(path.join(RAIZ, 'renderer', 'index.html'), 'utf8');
  assert(h.includes('style.css') && h.includes('app.js') && /Content-Security-Policy/.test(h));
  assert(!/<script(?![^>]*src=)/.test(h), 'script inline não é permitido pela CSP');
  assert(!/ on\w+=/.test(h), 'atributo de evento inline não é permitido pela CSP');
});

t('tela: app.js executa sem erro quando a ponte do preload é uma propriedade global não configurável (como no Electron)', () => {
  const vm = require('vm');
  const pre = fs.readFileSync(path.join(RAIZ, 'preload.js'), 'utf8');
  const nomes = [...pre.matchAll(/exposeInMainWorld\(\s*'([^']+)'/g)].map(m => m[1]);
  assert(nomes.length === 1, 'esperava uma ponte no preload');
  const src = fs.readFileSync(path.join(RAIZ, 'renderer', 'app.js'), 'utf8');
  const el = () => new Proxy(function () {}, { get: (_t, k) => k === 'classList' ? { toggle() {}, add() {}, remove() {} } : (k === 'dataset' ? {} : el()), apply: () => el(), set: () => true });
  const ctx = vm.createContext({ document: { getElementById: el, createElement: el, addEventListener() {}, createTextNode: el, body: el() }, window: { addEventListener() {} }, setInterval() { return 0; }, setTimeout() { return 0; }, clearTimeout() {}, clearInterval() {}, console });
  // a ponte: não configurável e não gravável, igual ao contextBridge
  vm.runInContext('Object.defineProperty(globalThis, ' + JSON.stringify(nomes[0]) + ', { value: { info: async () => null, carregar: async () => null }, configurable: false, writable: false });', ctx);
  ctx.window.acessosApi = vm.runInContext(nomes[0], ctx);
  vm.runInContext(src, ctx, { filename: 'app.js' });   // SyntaxError aqui = a tela inteira não carrega
  // e o mesmo nome 'api' (versão 1.0.0) tem de ser detectado como erro
  const ctx2 = vm.createContext({});
  vm.runInContext("Object.defineProperty(globalThis, 'api', { value: {}, configurable: false });", ctx2);
  assert.throws(() => vm.runInContext('const api = 1;', ctx2), /already been declared/);
});

console.log('\n' + ok + ' passaram, ' + falhas + ' falharam');
process.exit(falhas ? 1 : 0);
