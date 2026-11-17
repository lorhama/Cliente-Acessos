// Conferência de versão e de assinatura das atualizações (sem Electron, para poder ser testada).
const crypto = require('crypto');

const tup = v => String(v || '0').split('.').map(x => parseInt(x, 10) || 0);
const maior = (a, b) => {
  const x = tup(a), y = tup(b);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
};

// A assinatura vale para "versão|sha256" e é conferida com a chave pública que vai dentro do programa.
function assinaturaOk(m, pem) {
  try { return crypto.verify(null, Buffer.from(m.versao + '|' + m.sha256), pem, Buffer.from(String(m.assinatura || ''), 'base64')); }
  catch (e) { return false; }
}

function lerManifesto(txt, pem) {
  let m;
  try { m = JSON.parse(txt); } catch (e) { throw new Error('O arquivo de versão do servidor de atualização está inválido.'); }
  if (!/^\d+\.\d+\.\d+$/.test(m.versao || '') || !m.arquivo || !/^[0-9a-f]{64}$/.test(m.sha256 || ''))
    throw new Error('O arquivo de versão não tem os campos esperados.');
  if (!assinaturaOk(m, pem)) throw new Error('A assinatura do pacote de atualização não confere. A atualização foi bloqueada por segurança.');
  return m;
}

module.exports = { tup, maior, assinaturaOk, lerManifesto };
