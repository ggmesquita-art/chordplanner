# setup-opus-orquestrador.ps1
# Configura o Claude Code no Windows para o padrão "Opus orquestra, Sonnet/Haiku executam".
# Compatível com Windows PowerShell 5.1 e PowerShell 7+. Idempotente: pode rodar de novo sem duplicar nada.
#
# Uso (no PowerShell, na pasta onde salvou o arquivo):
#   powershell -ExecutionPolicy Bypass -File .\setup-opus-orquestrador.ps1             # global (%USERPROFILE%\.claude)
#   powershell -ExecutionPolicy Bypass -File .\setup-opus-orquestrador.ps1 -Projeto    # só no repositório atual (.\.claude)
#
# Observação: se você roda o Claude Code DENTRO do WSL, use o script .sh dentro do WSL.
# O ~/.claude do WSL e o %USERPROFILE%\.claude do Windows são pastas diferentes.

param(
    [switch]$Projeto
)

$ErrorActionPreference = 'Stop'

if ($Projeto) {
    $Base     = Join-Path (Get-Location) '.claude'
    $ClaudeMd = Join-Path (Get-Location) 'CLAUDE.md'
} else {
    $UserHome = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }
    $Base     = Join-Path $UserHome '.claude'
    $ClaudeMd = Join-Path $Base 'CLAUDE.md'
}
$Agents = Join-Path $Base 'agents'
New-Item -ItemType Directory -Force -Path $Agents | Out-Null

# UTF-8 sem BOM e quebras de linha LF: o frontmatter YAML não pode começar com BOM.
$Utf8SemBom = New-Object System.Text.UTF8Encoding($false)

function Write-Arquivo([string]$Caminho, [string]$Conteudo) {
    $texto = ($Conteudo -replace "`r`n", "`n").TrimStart("`n")
    if (-not $texto.EndsWith("`n")) { $texto += "`n" }
    [System.IO.File]::WriteAllText($Caminho, $texto, $Utf8SemBom)
}

function Backup-Arquivo([string]$Caminho) {
    if (Test-Path -LiteralPath $Caminho) {
        $carimbo = Get-Date -Format 'yyyyMMddHHmmss'
        Copy-Item -LiteralPath $Caminho -Destination "$Caminho.bak.$carimbo" -Force
    }
}

# ---------------------------------------------------------------------------
# 1. Executor: implementação de tarefas bem definidas (Sonnet)
# ---------------------------------------------------------------------------
$executor = @'
---
name: executor
description: Implementa tarefas delimitadas e bem especificadas (código, refatoração, testes, transformação de dados). Use quando o orquestrador já decidiu O QUE fazer e só falta fazer.
model: sonnet
effort: medium
tools: Read, Edit, Write, Grep, Glob, Bash
---
Você é um executor. Recebe do orquestrador uma tarefa já decidida.

Regras:
- Faça só o que foi pedido. Não amplie o escopo nem refatore o que não foi solicitado.
- Escreva apenas nos caminhos indicados na tarefa.
- Antes de reportar, rode a verificação que a tarefa pedir (testes, lint, build). Se não houver, diga que não verificou.
- Se a tarefa for ambígua ou exigir decisão de arquitetura, pare e devolva a dúvida em vez de escolher.

Relatório final (curto, sem colar arquivos inteiros):
1. O que mudou (arquivo:linha)
2. Como verificou e o resultado
3. Dúvidas ou riscos não resolvidos
'@

# ---------------------------------------------------------------------------
# 2. Explorador: leitura e varredura em massa, só leitura (Haiku)
#    Também substitui o Explore embutido, que com sessão Opus herdaria Opus.
# ---------------------------------------------------------------------------
$explore = @'
---
name: Explore
description: Varredura somente leitura de código, logs e documentos — localizar arquivos, símbolos, padrões e ocorrências. Devolve conclusões destiladas, não despejos de arquivo.
model: haiku
effort: low
tools: Read, Grep, Glob
---
Você localiza e resume; não edita nada.
Devolva: a resposta direta, os caminhos relevantes (arquivo:linha) e trechos de no máximo 10 linhas quando indispensáveis.
Se não encontrar, diga onde procurou.
'@

# ---------------------------------------------------------------------------
# 3. Revisor: segunda leitura independente de diffs (Sonnet, só leitura)
# ---------------------------------------------------------------------------
$revisor = @'
---
name: revisor
description: Revisa um diff ou conjunto de mudanças procurando bugs, regressões, falhas de segurança e desvios da especificação. Somente leitura.
model: sonnet
effort: high
tools: Read, Grep, Glob, Bash
---
Revise as mudanças indicadas sem editar nada. Pode rodar testes e comandos de leitura.
Liste apenas achados concretos, do mais grave ao menos grave, cada um com arquivo:linha, cenário de falha e correção sugerida.
Não liste preferências de estilo. Se não houver achados, diga isso em uma linha.
'@

$arquivos = [ordered]@{
    'executor.md' = $executor
    'explore.md'  = $explore
    'revisor.md'  = $revisor
}
foreach ($nome in $arquivos.Keys) {
    $caminho = Join-Path $Agents $nome
    Backup-Arquivo $caminho
    Write-Arquivo $caminho $arquivos[$nome]
}

# ---------------------------------------------------------------------------
# 4. Política de orquestração no CLAUDE.md (bloco delimitado, substituível)
# ---------------------------------------------------------------------------
$Inicio = '<!-- orquestracao-opus:inicio -->'
$Fim    = '<!-- orquestracao-opus:fim -->'

$bloco = @'
<!-- orquestracao-opus:inicio -->
## Orquestração (quando a sessão principal for Opus)
Em tarefas não triviais, atue como orquestrador: entenda o objetivo, decida a arquitetura,
divida o trabalho, integre os resultados e faça a revisão final. Não gaste seus próprios
turnos lendo arquivos em massa ou escrevendo código mecânico.

Roteamento:
- Localizar, varrer, inventariar (código, logs, documentos) → subagente `Explore` (Haiku)
- Implementar algo já decidido e bem especificado → subagente `executor` (Sonnet)
- Segunda leitura de um diff antes de concluir → subagente `revisor` (Sonnet)
- Arquitetura, ambiguidade, trade-offs, integração e decisão final → você mesmo

Regras:
- Tarefa pequena (poucos minutos, 1–2 arquivos): faça direto; delegar custa mais que fazer.
- Cada delegação leva: objetivo, arquivos/caminhos permitidos, critério de pronto e como verificar.
- Subagentes independentes rodam em paralelo.
- Nunca aceite "pronto" sem conferir: rode você mesmo os testes/checagens críticos antes de concluir.
<!-- orquestracao-opus:fim -->
'@

$atual = ''
if (Test-Path -LiteralPath $ClaudeMd) {
    Backup-Arquivo $ClaudeMd
    $atual = [System.IO.File]::ReadAllText($ClaudeMd)
    # remove bloco anterior, se existir
    $padrao = '(?s)\r?\n?' + [regex]::Escape($Inicio) + '.*?' + [regex]::Escape($Fim) + '\r?\n?'
    $atual = [regex]::Replace($atual, $padrao, "`n")
    $atual = ($atual -replace "`r`n", "`n").TrimEnd("`n")
}
$novo = if ($atual) { $atual + "`n`n" + $bloco } else { $bloco }
Write-Arquivo $ClaudeMd $novo

# ---------------------------------------------------------------------------
# 5. Checagens
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host "Instalado em: $Agents"
Write-Host "Política em:  $ClaudeMd"
Write-Host ''

foreach ($var in 'CLAUDE_CODE_SUBAGENT_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL_FORCE') {
    foreach ($escopo in 'Process', 'User', 'Machine') {
        $valor = [Environment]::GetEnvironmentVariable($var, $escopo)
        if ($valor) {
            Write-Host "ATENÇÃO: $var=$valor está definida (escopo $escopo)." -ForegroundColor Yellow
            Write-Host "  Ela sobrescreve o model: dos subagentes. Para remover:" -ForegroundColor Yellow
            Write-Host "  [Environment]::SetEnvironmentVariable('$var', `$null, '$escopo')" -ForegroundColor Yellow
        }
    }
}

$claude = Get-Command claude -ErrorAction SilentlyContinue
if ($claude) {
    try { Write-Host "Claude Code: $(& claude --version 2>$null)" } catch { Write-Host 'Claude Code: versão não detectada' }
} else {
    Write-Host 'Claude Code não encontrado no PATH deste terminal (normal se você o usa só dentro do WSL).'
}

Write-Host ''
Write-Host 'Próximos passos dentro do Claude Code:'
Write-Host '  /model   → escolha Opus'
Write-Host '  /effort  → high (max só para planejamento difícil)'
Write-Host '  /agents  → confira executor, Explore e revisor'
Write-Host '  /tasks   → durante o uso, confirme em que modelo cada subagente rodou'
