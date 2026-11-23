# scripts/env.ps1
# Ativa o Node.js portátil do projeto (.tools\node) na sessão atual do PowerShell,
# baixando-o na primeira vez (com conferência de SHA-256). Não mexe no sistema.
#
# Uso:  . .\scripts\env.ps1      (repare no ponto: precisa rodar "dot-sourced")
#       npm install; npm run app:dist:win

$ErrorActionPreference = 'Stop'
$NodeVersion = 'v24.22.3'
$Root  = Split-Path -Parent $PSScriptRoot
$Tools = Join-Path $Root '.tools'
$Node  = Join-Path $Tools 'node'

if (-not (Test-Path (Join-Path $Node 'node.exe'))) {
    New-Item -ItemType Directory -Force $Tools | Out-Null
    $nome = "node-$NodeVersion-win-x64"
    $zip  = Join-Path $Tools "$nome.zip"
    Write-Host "Baixando Node.js $NodeVersion..."
    Invoke-WebRequest "https://nodejs.org/dist/$NodeVersion/$nome.zip" -OutFile $zip -UseBasicParsing
    $somas = (Invoke-WebRequest "https://nodejs.org/dist/$NodeVersion/SHASUMS256.txt" -UseBasicParsing).Content
    $esperado = (($somas -split "`n") | Select-String "$nome.zip").Line.Split(' ')[0]
    $obtido = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
    if ($esperado -ne $obtido) { Remove-Item $zip; throw "SHA-256 não confere para $nome.zip" }
    # tar.exe (embutido no Windows 10+) em vez de Expand-Archive, que trava com zips grandes.
    tar -xf $zip -C $Tools
    if ($LASTEXITCODE -ne 0) { throw "falha ao extrair $nome.zip" }
    Rename-Item (Join-Path $Tools $nome) 'node'
    Remove-Item $zip
}

if (($env:Path -split ';') -notcontains $Node) { $env:Path = "$Node;$env:Path" }
Write-Host "Node $(& node -v) / npm $(& npm -v) ativos nesta sessão."
