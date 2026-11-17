# Cliente Acessos

Programa de uso pessoal (Windows) para organizar os acessos remotos por farmácia/loja: menu lateral com o código da loja, o tipo de serviço e o status (em andamento, aguardando, concluído), e, na tela principal, os TeamViewers daquela loja. Cada conexão abre o **Web Client do TeamViewer** em uma aba dentro do próprio programa.

## O que o Web Client permite (e o que não)
- Conexão de saída (você controla o computador do cliente): tela, mouse e teclado.
- Arquivos: só do seu computador para o cliente. Receber arquivos do cliente não é suportado pelo Web Client.
- Área de transferência: somente texto.
- O TeamViewer não aceita abrir uma conexão por link com o ID já preenchido; por isso o botão **Conectar** copia o ID e abre a aba, e você cola (Ctrl+V) no campo de conexão.
- O login do TeamViewer fica guardado no programa (mesma conta em todas as abas). Se o login com Google/Microsoft/Apple for recusado dentro do programa, use e-mail e senha da conta TeamViewer.

## Onde ficam os dados
Pasta de dados do usuário do Windows (`%APPDATA%\Cliente Acessos`): `dados.json` (lojas, conexões, histórico) e `backups\` (um por dia, guarda os 14 últimos; o menu Sistema > Fazer backup agora cria um extra). Atualizar ou reinstalar o programa não mexe nesses dados.

## Onde o programa fica instalado
`C:\Users\<usuário>\AppData\Local\Programs\Cliente Acessos` (instalação só para o usuário, sem pedir administrador; o instalador deixa escolher outra pasta). Atalhos na área de trabalho e no menu Iniciar. Os dados ficam separados, em `%APPDATA%\Cliente Acessos`.

## Instalar pela primeira vez
1. No GitHub do projeto, abra **Actions > Gerar instalador Windows (.exe) > Run workflow** (ou crie a tag `v1.0.0`).
2. Quando terminar, baixe `Cliente Acessos Setup 1.0.0.exe` em **Artifacts** (ou em **Releases**, no caso da tag) e execute.
3. Alternativa sem GitHub: dar dois cliques em `build-windows.bat` (instala o Node.js se faltar e gera o `.exe` na pasta `dist`).

## Publicar uma nova versão (igual ao LoPDV)
O programa instalado consulta `atualizacoes/versao.json` neste repositório. Quando há versão maior, aparece o aviso no menu lateral e **Ajuda > Verificar atualização** mostra as novidades; ao confirmar, ele baixa o pacote, confere SHA-256 e assinatura, fecha, troca os arquivos, abre de novo e volta para a versão anterior se algo falhar.

```
python3 scripts/publicar.py 1.0.1 -c "o que foi corrigido" -m "o que foi melhorado"
git add -A && git commit -m "Versão 1.0.1" && git push
```
O publicador atualiza `package.json`, `CHANGELOG.md` e `novidades.json`, roda os testes, monta `atualizacoes/atualizacao-1.0.1.zip`, assina e grava `atualizacoes/versao.json`. Mudar MAIOR ou MENOR (1.0.x para 1.1.0) exige `--maior`. Se a versão trocar uma biblioteca (`dependencies` no `package.json`), é preciso gerar um instalador novo: a atualização automática recusa essa troca.

**Cópia de cada versão:** o instalador (`Cliente Acessos Setup <versão>.exe`), o pacote de atualização e o `versao.json` ficam guardados no computador da Lohama em `C:\Users\lorha\OneDrive\Documentos\IMPLANTAÇÕES\Sistemas\Gerenciamento Teamviewer\Versoes\<versão>\`. O publicador faz isso sozinho com `--destino "<essa pasta>"` (ou a variável `CLIENTEACESSOS_VERSOES`).

## Chave de assinatura
A atualização só é aceita se estiver assinada pela chave privada que corresponde à chave pública embutida em `atualizacao-publica.pem`. A **chave privada nunca entra no Git** (`.chaves/` está no `.gitignore`). Guarde uma cópia em local seguro: sem ela não dá para publicar atualizações que os programas já instalados aceitem (seria preciso instalar uma versão nova com outra chave pública). O publicador procura a chave em `--chave`, na variável `CLIENTEACESSOS_CHAVE` ou em `.chaves/chave-privada-atualizacao.pem`.

## Desenvolvimento
- `npm install` e `npm start` rodam o programa (Electron 31).
- `npm test` roda os testes (versão/assinatura, dados e backups, consistência do projeto).
- `npm run dist` gera o instalador em `dist/`.
