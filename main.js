// Cliente Acessos — painel de acessos remotos por loja. Janela principal (Electron).
// A tela (renderer) mostra as lojas e abre o Web Client do TeamViewer em abas (<webview>) dentro do próprio programa.
const { app, BrowserWindow, Menu, dialog, shell, ipcMain, session, clipboard } = require('electron');
const path = require('path');
const dados = require('./dados');
const atu = require('./atualizador');
const { HOSTS_OK, HOSTS_LOGIN, hostDe, ehHttps, urlTeamViewerOk, limparUA } = require('./util');

const PARTICAO = 'persist:teamviewer';   // sessão própria: o login do TeamViewer fica guardado entre as aberturas
let win = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

  // Segurança: os <webview> só podem carregar o TeamViewer, sem acesso ao Node e sem preload.
  app.on('web-contents-created', (_e, wc) => {
    wc.on('will-attach-webview', (e, prefs, params) => {
      delete prefs.preload; delete prefs.preloadURL;
      prefs.nodeIntegration = false; prefs.nodeIntegrationInSubFrames = false; prefs.contextIsolation = true;
      if (params.partition !== PARTICAO || !urlTeamViewerOk(params.src)) e.preventDefault();
    });
    if (wc.getType() === 'webview') {
      // janelas auxiliares (ex.: login com Google/Microsoft/Apple, transferência de arquivos) abrem dentro do programa; o resto vai para o navegador
      wc.setWindowOpenHandler(({ url }) => {
        const ok = url === 'about:blank' || (ehHttps(url) && (HOSTS_OK.test(hostDe(url)) || HOSTS_LOGIN.test(hostDe(url))));
        if (ok) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, width: 560, height: 720 } };
        if (ehHttps(url)) shell.openExternal(url);
        return { action: 'deny' };
      });
    }
  });

  const confiavel = e => { try { return String(e.senderFrame.url).startsWith('file://'); } catch (x) { return false; } };

  function prepararSessao() {
    const s = session.fromPartition(PARTICAO);
    s.setUserAgent(limparUA(s.getUserAgent()));
    const permitidas = new Set(['clipboard-read', 'clipboard-sanitized-write', 'media', 'fullscreen']);
    s.setPermissionRequestHandler((wc, perm, cb, det) => cb(permitidas.has(perm) && HOSTS_OK.test(hostDe((det && det.requestingUrl) || wc.getURL()))));
    s.setPermissionCheckHandler((wc, perm, origin) => permitidas.has(perm) && HOSTS_OK.test(hostDe(origin)));
  }

  function enviarMenu(acao) { if (win && !win.isDestroyed()) win.webContents.send('menu:acao', acao); }

  function menu() {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Sistema', submenu: [
        { label: 'Fazer backup agora', click: () => enviarMenu('backup') },
        { label: 'Abrir pasta de dados e backups', click: () => shell.openPath(app.getPath('userData')) },
        { label: 'Iniciar com o Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: m => app.setLoginItemSettings({ openAtLogin: m.checked }) },
        { type: 'separator' }, { role: 'quit', label: 'Sair' }] },
      { label: 'Exibir', submenu: [{ role: 'togglefullscreen', label: 'Tela cheia' }, { role: 'zoomIn', label: 'Aumentar' }, { role: 'zoomOut', label: 'Diminuir' }, { role: 'resetZoom', label: 'Tamanho normal' }] },
      { label: 'Ajuda', submenu: [
        { label: 'Verificar atualização…', click: () => enviarMenu('atualizacao') },
        { label: 'Novidades da versão', click: () => enviarMenu('novidades') },
        { label: 'Sobre o Cliente Acessos', click: () => enviarMenu('sobre') }] },
    ]));
  }

  function criarJanela() {
    win = new BrowserWindow({
      width: 1400, height: 860, minWidth: 960, minHeight: 600, title: 'Cliente Acessos', backgroundColor: '#11151b',
      icon: path.join(__dirname, 'build', 'icon.png'),
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: true },
    });
    win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    win.webContents.setWindowOpenHandler(({ url }) => { if (ehHttps(url)) shell.openExternal(url); return { action: 'deny' }; });
    win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) e.preventDefault(); });
    win.on('closed', () => { win = null; });
  }

  ipcMain.handle('dados:carregar', e => confiavel(e) ? dados.carregar() : null);
  ipcMain.handle('dados:salvar', (e, d) => confiavel(e) ? dados.salvar(d) : { ok: false });
  ipcMain.on('dados:salvar-sync', (e, d) => { e.returnValue = confiavel(e) ? dados.salvar(d) : { ok: false }; });
  ipcMain.handle('copiar', (e, t) => { if (confiavel(e)) clipboard.writeText(String(t == null ? '' : t).slice(0, 200)); return true; });
  ipcMain.handle('app:info', e => confiavel(e) ? { versao: app.getVersion(), pasta: app.getPath('userData'), empacotado: app.isPackaged } : null);
  ipcMain.handle('backup:agora', e => confiavel(e) ? dados.backup(true) : { ok: false });
  ipcMain.handle('pasta:abrir', e => { if (confiavel(e)) shell.openPath(app.getPath('userData')); return true; });
  ipcMain.handle('upd:novidades', e => confiavel(e) ? atu.novidades() : []);
  ipcMain.handle('upd:situacao', e => confiavel(e) ? atu.situacao() : null);
  ipcMain.handle('upd:verificar', e => confiavel(e) ? atu.verificar() : { ok: false });
  ipcMain.handle('upd:status', e => confiavel(e) ? atu.status() : null);
  ipcMain.handle('upd:aplicar', async e => { if (!confiavel(e)) return { ok: false }; try { return await atu.aplicar(() => app.quit()); } catch (x) { return { ok: false, erro: x.message }; } });

  app.whenReady().then(() => {
    dados.init(app.getPath('userData'));
    dados.backup(false);                       // backup ao abrir (um por dia; guarda os últimos 14)
    prepararSessao();
    criarJanela(); menu();
    atu.agendar();
    win.webContents.once('did-finish-load', () => {
      const r = atu.resultado();               // resultado da atualização que acabou de acontecer
      if (r) dialog.showMessageBox(win, r.ok
        ? { type: 'info', title: 'Atualização concluída', message: 'O Cliente Acessos foi atualizado para a versão ' + r.versao + '.' }
        : { type: 'warning', title: 'Atualização não concluída', message: String(r.erro || 'A atualização falhou.') });
    });
  });
  app.on('will-quit', () => { try { dados.backup(false); } catch (e) { /* */ } });   // depois que a tela gravou os dados ao fechar
  app.on('window-all-closed', () => app.quit());
}
