# Atualizador do Cliente Acessos. Chamado pelo proprio programa depois que o usuario confirma. Roda escondido; registra tudo em atualizacao.log (pasta de dados)
param([string]$Zip, [string]$Dir, [string]$Versao, [string]$Anterior, [string]$Exe, [string]$Data, [switch]$Elevado, [string]$Self = '')
$ErrorActionPreference = 'Continue'
$pasta = Join-Path $Data 'atualizacao'
New-Item -ItemType Directory -Force -Path $pasta -ErrorAction SilentlyContinue | Out-Null
$log = Join-Path $Data 'atualizacao.log'
function G($t) { $l = '[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $t; try { Add-Content -Path $log -Value $l -Encoding UTF8 -ErrorAction Stop } catch { try { Add-Content -Path (Join-Path $env:TEMP 'clienteacessos-atualizacao.log') -Value $l -Encoding UTF8 } catch { } } }
# avisa ao programa que o atualizador esta rodando (ele so se fecha depois disso)
try { [IO.File]::WriteAllText((Join-Path $pasta 'iniciado.txt'), (Get-Date).ToString('o')) } catch { }
$t0 = Get-Date
function Resultado($ok, $erro) {
  $o = @{ ok = $ok; versao = $Versao; anterior = $Anterior; erro = $erro; quando = (Get-Date).ToString('o') } | ConvertTo-Json -Compress
  try { [IO.File]::WriteAllText((Join-Path $pasta 'resultado.json'), $o, (New-Object Text.UTF8Encoding($false))) } catch { }
}
$nomeExe = [IO.Path]::GetFileName($Exe)
function Processos { @(Get-CimInstance Win32_Process -Filter ("Name='" + $nomeExe + "'") -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -and ($_.ExecutablePath -ieq $Exe) }) }
function Iniciar { try { Start-Process -FilePath $Exe -WorkingDirectory (Split-Path $Exe) } catch { G ('Nao consegui abrir o programa: ' + $_.Exception.Message) } }

G ('===== Atualizacao ' + $Anterior + ' -> ' + $Versao + ' (inicio) =====')
# 1) permissao de escrita na pasta do programa; se faltar, pede ao Windows (UAC) uma vez
$teste = Join-Path $Dir ('.escrita-' + [guid]::NewGuid().ToString('N')); $escreve = $true
try { [IO.File]::WriteAllText($teste, 'x'); Remove-Item $teste -Force } catch { $escreve = $false }
if (-not $escreve -and -not $Elevado) {
  G 'Sem permissao de escrita; pedindo elevacao.'
  try { Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$p = Get-Content -Raw -Encoding UTF8 ''' + (Join-Path $pasta 'params.json') + '''  | ConvertFrom-Json; & ([scriptblock]::Create([IO.File]::ReadAllText($p.ps1))) -Zip $p.zip -Dir $p.dir -Versao $p.versao -Anterior $p.anterior -Exe $p.exe -Data $p.data -Self $p.ps1 -Elevado"'); exit } catch { G ('Elevacao recusada: ' + $_.Exception.Message); Resultado $false 'O Windows nao autorizou a atualizacao (permissao de administrador).'; Iniciar; exit }
}
# 1b) extrai o pacote novo ja agora, enquanto o programa ainda esta fechando. tar.exe do Windows e bem mais rapido que Expand-Archive
$tmp = Join-Path $env:TEMP ('clienteacessos-upd-' + $Versao); $extraiu = $false
try {
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
  if (Test-Path $tar) { & $tar -xf $Zip -C $tmp 2>$null; if ($LASTEXITCODE -eq 0 -and (Test-Path (Join-Path $tmp 'package.json'))) { $extraiu = $true } }
} catch { }
# 2) espera o programa fechar; depois forca se precisar
G 'Aguardando o programa fechar.'
for ($i = 0; $i -lt 60; $i++) { if ((Processos).Count -eq 0) { break }; Start-Sleep -Seconds 1 }
Processos | ForEach-Object { G ('Forcando encerramento do processo ' + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 800
G ('Programa fechado apos ' + [int]((Get-Date) - $t0).TotalSeconds + ' s.')
$rb = Join-Path $Data ('rollback\' + $Anterior)
try {
  # 3) copia de seguranca dos arquivos atuais (para voltar se algo der errado). Os dados (dados.json) ficam em outra pasta e nao sao tocados.
  G 'Guardando uma copia de seguranca dos arquivos atuais.'
  if (Test-Path $rb) { Remove-Item $rb -Recurse -Force -ErrorAction SilentlyContinue }
  New-Item -ItemType Directory -Force -Path $rb | Out-Null
  & robocopy $Dir $rb /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw ('Falha ao guardar a copia de seguranca (robocopy ' + $LASTEXITCODE + ').') }
  # 4) extrai o pacote novo (se ainda nao extraiu)
  if (-not $extraiu) { if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }; Expand-Archive -Path $Zip -DestinationPath $tmp -Force }
  if (-not (Test-Path (Join-Path $tmp 'package.json'))) { throw 'O pacote novo nao tem o package.json.' }
  # o atualizador so troca arquivos do programa: se a lista de bibliotecas mudou, e preciso um instalador novo
  $deps = { param($f) try { (Get-Content $f -Raw -Encoding UTF8 | ConvertFrom-Json).dependencies | ConvertTo-Json -Compress } catch { 'x' + [guid]::NewGuid() } }
  if ((& $deps (Join-Path $Dir 'package.json')) -ne (& $deps (Join-Path $tmp 'package.json'))) { throw 'Esta versao exige um instalador novo (mudou uma biblioteca do programa). Nada foi alterado.' }
  # 5) copia os arquivos novos por cima
  G 'Instalando os arquivos novos.'
  & robocopy $tmp $Dir /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw ('Falha ao copiar os arquivos novos (robocopy ' + $LASTEXITCODE + ').') }
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  $verInstalada = ''; try { $verInstalada = (Get-Content (Join-Path $Dir 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version } catch { }
  if ($verInstalada -ne $Versao) { throw ('Os arquivos ficaram na versao ' + $verInstalada + ' em vez de ' + $Versao + '.') }
  # 6) registro do Windows (se tiver permissao)
  try { Set-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\3f9d2c1a-6b7e-4e58-9a2d-8c4b1f6e7a05' -Name DisplayVersion -Value $Versao -ErrorAction Stop } catch { }
  # 7) abre o programa novo e confere se ele subiu
  G 'Abrindo a nova versao.'
  Iniciar
  $subiu = $false
  for ($i = 0; $i -lt 30; $i++) { Start-Sleep -Seconds 1; if ((Processos).Count -gt 0) { $subiu = $true; break } }
  if (-not $subiu) { throw 'O programa novo nao abriu.' }
  Resultado $true ''
  G ('RESULTADO: CONCLUIDA - ' + $Anterior + ' -> ' + $Versao + ' em ' + [int]((Get-Date) - $t0).TotalSeconds + ' s.')
} catch {
  $falha = $_.Exception.Message; G ('FALHA: ' + $falha)
  # volta para a versao anterior
  try {
    Processos | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Sleep -Seconds 2
    if (Test-Path $rb) { & robocopy $rb $Dir /E /NFL /NDL /NJH /NJS /NP | Out-Null; G 'Arquivos da versao anterior restaurados.' }
  } catch { G ('Erro ao restaurar: ' + $_.Exception.Message) }
  Resultado $false ('A atualizacao falhou e o programa voltou para a versao ' + $Anterior + '. Motivo: ' + $falha)
  G ('RESULTADO: FALHA - ' + $Anterior + ' -> ' + $Versao + ' (programa voltou para a versao anterior). Motivo: ' + $falha)
  Iniciar
}
