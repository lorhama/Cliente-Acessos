// Funções puras (sem Electron), usadas pelo programa e pelos testes.

// Endereços do TeamViewer que podem abrir dentro das abas de sessão.
const HOSTS_OK = /(^|\.)(teamviewer\.com|tvwebservices\.org)$/i;
// Endereços de login (Google, Microsoft, Apple) que podem abrir em janela auxiliar quando o TeamViewer pede.
const HOSTS_LOGIN = /(^|\.)(google\.com|gstatic\.com|googleapis\.com|microsoftonline\.com|live\.com|microsoft\.com|apple\.com|recaptcha\.net)$/i;

function hostDe(u) { try { return new URL(u).hostname; } catch (e) { return ''; } }
function ehHttps(u) { try { return new URL(u).protocol === 'https:'; } catch (e) { return false; } }
function urlTeamViewerOk(u) { return ehHttps(u) && HOSTS_OK.test(hostDe(u)); }

// O Web Client pode recusar navegadores "diferentes": tira do identificador o nome do Electron e do programa
// (que pode ter espaço, como "Cliente Acessos/1.0.0"), mantendo o Chrome.
function limparUA(ua) {
  return String(ua || '')
    .replace(/\s+Electron\/[\d.]+/i, '')
    .replace(/(\(KHTML, like Gecko\))\s+.*?\s+(?=Chrome\/)/, '$1 ');
}

module.exports = { HOSTS_OK, HOSTS_LOGIN, hostDe, ehHttps, urlTeamViewerOk, limparUA };
