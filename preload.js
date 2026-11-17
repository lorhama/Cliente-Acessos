// Ponte segura entre a tela (renderer) e o programa (main). A tela não tem acesso direto ao Node.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  carregar: () => ipcRenderer.invoke('dados:carregar'),
  salvar: d => ipcRenderer.invoke('dados:salvar', d),
  salvarSync: d => ipcRenderer.sendSync('dados:salvar-sync', d),
  copiar: t => ipcRenderer.invoke('copiar', t),
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
