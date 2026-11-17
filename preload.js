// Ponte segura entre a tela (renderer) e o programa (main). A tela não tem acesso direto ao Node.
const { contextBridge, ipcRenderer } = require('electron');

// O nome exposto NÃO pode coincidir com nenhuma const/let/function de nível superior do app.js
// (o contextBridge cria a propriedade como não configurável: 'const api' na tela daria SyntaxError e a tela não carregaria).
contextBridge.exposeInMainWorld('acessosApi', {
  carregar: () => ipcRenderer.invoke('dados:carregar'),
  salvar: d => ipcRenderer.invoke('dados:salvar', d),
  salvarSync: d => ipcRenderer.sendSync('dados:salvar-sync', d),
  copiar: t => ipcRenderer.invoke('copiar', t),
  copiarSenha: t => ipcRenderer.invoke('copiar-senha', t),
  info: () => ipcRenderer.invoke('app:info'),
  backupAgora: () => ipcRenderer.invoke('backup:agora'),
  abrirPasta: () => ipcRenderer.invoke('pasta:abrir'),
  novidades: () => ipcRenderer.invoke('upd:novidades'),
  updSituacao: () => ipcRenderer.invoke('upd:situacao'),
  updVerificar: () => ipcRenderer.invoke('upd:verificar'),
  updAplicar: () => ipcRenderer.invoke('upd:aplicar'),
  updStatus: () => ipcRenderer.invoke('upd:status'),
  aoMenu: cb => ipcRenderer.on('menu:acao', (_e, acao) => cb(acao)),
});
