#!/bin/bash
# setup-fable-orquestrador-macos.sh
# Configura o Claude Code no macOS para o padrão "Fable orquestra, Sonnet/Haiku executam".
# Compatível com o bash 3.2 que vem no macOS e com zsh como shell padrão. Idempotente.
#
# Uso (no Terminal):
#   bash setup-fable-orquestrador-macos.sh                  # instala global (~/.claude)
#   bash setup-fable-orquestrador-macos.sh --projeto        # só no repositório atual (./.claude)
#   bash setup-fable-orquestrador-macos.sh --corrigir-env   # também comenta, com backup, linhas que
#                                                           # definem CLAUDE_CODE_SUBAGENT_MODEL nos arquivos do shell
# As opções podem ser combinadas.
#
# Dica: renomeie para .command e dê duplo clique no Finder para instalar a versão global.

set -euo pipefail

MODO="global"
CORRIGIR_ENV=0
for arg in "$@"; do
  case "$arg" in
    --projeto) MODO="projeto" ;;
    --corrigir-env) CORRIGIR_ENV=1 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "Opção desconhecida: $arg (use --help)"; exit 1 ;;
  esac
done

if [[ "$MODO" == "projeto" ]]; then
  BASE="./.claude"
  CLAUDE_MD="./CLAUDE.md"
else
  BASE="$HOME/.claude"
  CLAUDE_MD="$HOME/.claude/CLAUDE.md"
fi
AGENTS="$BASE/agents"
mkdir -p "$AGENTS"

backup() { [[ -f "$1" ]] && cp -p "$1" "$1.bak.$(date +%Y%m%d%H%M%S)" || true; }

# ---------------------------------------------------------------------------
# 1. Executor: implementação de tarefas bem definidas (Sonnet)
# ---------------------------------------------------------------------------
backup "$AGENTS/executor.md"
cat > "$AGENTS/executor.md" <<'EOF'
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
EOF

# ---------------------------------------------------------------------------
# 2. Explorador: leitura e varredura em massa, só leitura (Haiku)
#    Também substitui o Explore embutido, que com sessão Fable herdaria Opus.
# ---------------------------------------------------------------------------
backup "$AGENTS/explore.md"
cat > "$AGENTS/explore.md" <<'EOF'
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
EOF

# ---------------------------------------------------------------------------
# 3. Revisor: segunda leitura independente de diffs (Sonnet, só leitura)
# ---------------------------------------------------------------------------
backup "$AGENTS/revisor.md"
cat > "$AGENTS/revisor.md" <<'EOF'
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
EOF

# ---------------------------------------------------------------------------
# 4. Política de orquestração no CLAUDE.md (bloco delimitado, substituível)
# ---------------------------------------------------------------------------
INICIO="<!-- orquestracao-fable:inicio -->"
FIM="<!-- orquestracao-fable:fim -->"
touch "$CLAUDE_MD"
backup "$CLAUDE_MD"
# remove bloco anterior, se existir
if grep -q "$INICIO" "$CLAUDE_MD"; then
  awk -v i="$INICIO" -v f="$FIM" '
    $0==i {skip=1; next}
    $0==f {skip=0; next}
    !skip' "$CLAUDE_MD" > "$CLAUDE_MD.tmp" && mv "$CLAUDE_MD.tmp" "$CLAUDE_MD"
fi
cat >> "$CLAUDE_MD" <<EOF
$INICIO
## Orquestração (quando a sessão principal for Fable)
Em tarefas não triviais, atue como orquestrador: entenda o objetivo, decida a arquitetura,
divida o trabalho, integre os resultados e faça a revisão final. Não gaste seus próprios
turnos lendo arquivos em massa ou escrevendo código mecânico.

Roteamento:
- Localizar, varrer, inventariar (código, logs, documentos) → subagente \`Explore\` (Haiku)
- Implementar algo já decidido e bem especificado → subagente \`executor\` (Sonnet)
- Segunda leitura de um diff antes de concluir → subagente \`revisor\` (Sonnet)
- Arquitetura, ambiguidade, trade-offs, integração e decisão final → você mesmo

Regras:
- Tarefa pequena (poucos minutos, 1–2 arquivos): faça direto; delegar custa mais que fazer.
- Cada delegação leva: objetivo, arquivos/caminhos permitidos, critério de pronto e como verificar.
- Subagentes independentes rodam em paralelo.
- Nunca aceite "pronto" sem conferir: rode você mesmo os testes/checagens críticos antes de concluir.
$FIM
EOF

# ---------------------------------------------------------------------------
# 5. Checagens específicas do macOS
# ---------------------------------------------------------------------------
AMARELO=$'\033[33m'; NORMAL=$'\033[0m'
avisar() { printf '%sATENÇÃO:%s %s\n' "$AMARELO" "$NORMAL" "$1"; }

echo
echo "Instalado em: $AGENTS"
echo "Política em:  $CLAUDE_MD"
echo

# 5a. Variáveis que sobrescrevem o model: dos subagentes
for var in CLAUDE_CODE_SUBAGENT_MODEL CLAUDE_CODE_SUBAGENT_MODEL_FORCE; do
  valor="${!var:-}"
  [[ -n "$valor" ]] && avisar "$var=$valor está definida neste terminal. Rode: unset $var"
  if command -v launchctl >/dev/null 2>&1; then
    valor_lc="$(launchctl getenv "$var" 2>/dev/null || true)"
    [[ -n "$valor_lc" ]] && avisar "$var=$valor_lc está definida via launchctl (afeta apps abertos pelo Finder). Rode: launchctl unsetenv $var"
  fi
done

# 5b. Arquivos de inicialização do shell (zsh é o padrão no macOS)
for rc in "$HOME/.zshrc" "$HOME/.zprofile" "$HOME/.zshenv" "$HOME/.bash_profile" "$HOME/.bashrc" "$HOME/.profile"; do
  [[ -f "$rc" ]] || continue
  if grep -Eq '^[[:space:]]*(export[[:space:]]+)?CLAUDE_CODE_SUBAGENT_MODEL(_FORCE)?=' "$rc"; then
    if [[ "$CORRIGIR_ENV" == "1" ]]; then
      backup "$rc"
      awk '{
        if ($0 ~ /^[[:space:]]*(export[[:space:]]+)?CLAUDE_CODE_SUBAGENT_MODEL(_FORCE)?=/) print "# desativado por setup-fable-orquestrador: " $0;
        else print
      }' "$rc" > "$rc.tmp" && cat "$rc.tmp" > "$rc" && rm -f "$rc.tmp"
      echo "Comentei a definição de CLAUDE_CODE_SUBAGENT_MODEL em $rc (backup criado). Abra um novo terminal."
    else
      avisar "$rc define CLAUDE_CODE_SUBAGENT_MODEL. Rode de novo com --corrigir-env ou remova a linha à mão."
    fi
  fi
done

# 5c. Claude Code instalado?
if command -v claude >/dev/null 2>&1; then
  echo "Claude Code: $(claude --version 2>/dev/null || echo 'versão não detectada') ($(command -v claude))"
else
  avisar "Claude Code não está no PATH. Instale com: curl -fsSL https://claude.ai/install.sh | bash"
fi

echo
echo "Próximos passos dentro do Claude Code:"
echo "  /model   → escolha Fable"
echo "  /effort  → high (max só para planejamento difícil)"
echo "  /agents  → confira executor, Explore e revisor"
echo "  /tasks   → durante o uso, confirme em que modelo cada subagente rodou"
