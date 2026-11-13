#!/bin/bash
# desativar-orquestracao.sh
# Desativa (ou reativa) a configuração global instalada pelos scripts
# setup-fable-orquestrador*.sh e setup-antigravity-orquestrador.sh.
# Não apaga nada: move os agentes para uma pasta "desativados" e guarda o bloco de política
# retirado, para poder reativar depois. Roda em macOS (bash 3.2), Linux e WSL.
#
# Uso:
#   bash desativar-orquestracao.sh                  # desativa Claude Code e Antigravity
#   bash desativar-orquestracao.sh --claude         # só Claude Code
#   bash desativar-orquestracao.sh --antigravity    # só Antigravity
#   bash desativar-orquestracao.sh --reativar       # desfaz (combina com --claude/--antigravity)
#   bash desativar-orquestracao.sh --projeto        # age no repositório atual em vez do global

set -euo pipefail

ACAO="desativar"; ALVO_CLAUDE=1; ALVO_AGY=1; MODO="global"; ESCOLHEU=0
for arg in "$@"; do
  case "$arg" in
    --claude) [[ $ESCOLHEU == 0 ]] && ALVO_AGY=0; ALVO_CLAUDE=1; ESCOLHEU=1 ;;
    --antigravity) [[ $ESCOLHEU == 0 ]] && ALVO_CLAUDE=0; ALVO_AGY=1; ESCOLHEU=1 ;;
    --reativar) ACAO="reativar" ;;
    --projeto) MODO="projeto" ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "Opção desconhecida: $arg (use --help)"; exit 1 ;;
  esac
done

# processa <rótulo> <pasta de agentes> <arquivo de regras> <marcador> <arquivos...>
processa() {
  local rotulo="$1" agents="$2" regras="$3" marca="$4"; shift 4
  local desat; desat="$(dirname "$agents")/agents-desativados"
  local inicio="<!-- ${marca}:inicio -->" fim="<!-- ${marca}:fim -->"
  local bloco_salvo="$desat/bloco-politica.md"
  echo "== $rotulo ($ACAO)"

  if [[ "$ACAO" == "desativar" ]]; then
    mkdir -p "$desat"
    local f movidos=0
    for f in "$@"; do
      if [[ -f "$agents/$f" ]]; then mv -f "$agents/$f" "$desat/$f"; movidos=$((movidos+1)); fi
    done
    echo "   agentes movidos para $desat: $movidos"
    if [[ -f "$regras" ]] && grep -qF "$inicio" "$regras"; then
      awk -v i="$inicio" -v f="$fim" '$0==i{p=1} p{print} $0==f{p=0}' "$regras" > "$bloco_salvo"
      cp -p "$regras" "$regras.bak.$(date +%Y%m%d%H%M%S)"
      awk -v i="$inicio" -v f="$fim" '$0==i{skip=1;next} $0==f{skip=0;next} !skip' "$regras" \
        | awk '{a[NR]=$0} END{n=NR; while(n>0 && a[n]=="") n--; for(k=1;k<=n;k++) print a[k]}' > "$regras.tmp"
      cat "$regras.tmp" > "$regras"; rm -f "$regras.tmp"
      echo "   política retirada de $regras (guardada em $bloco_salvo)"
    else
      echo "   nenhum bloco de política encontrado em $regras"
    fi
  else
    local f voltaram=0
    if [[ -d "$desat" ]]; then
      mkdir -p "$agents"
      for f in "$@"; do
        if [[ -f "$desat/$f" ]]; then mv -f "$desat/$f" "$agents/$f"; voltaram=$((voltaram+1)); fi
      done
    fi
    echo "   agentes restaurados em $agents: $voltaram"
    if [[ -f "$bloco_salvo" ]]; then
      touch "$regras"
      if grep -qF "$inicio" "$regras"; then
        echo "   política já está ativa em $regras"
      else
        [[ -s "$regras" ]] && printf '\n' >> "$regras"; cat "$bloco_salvo" >> "$regras"
        echo "   política reinserida em $regras"
      fi
    else
      echo "   nenhum bloco guardado para reinserir"
    fi
  fi
}

if [[ "$MODO" == "projeto" ]]; then
  C_AGENTS="./.claude/agents";        C_REGRAS="./CLAUDE.md"
  G_AGENTS="./.agents/agents";        G_REGRAS="./.agents/AGENTS.md"
else
  C_AGENTS="$HOME/.claude/agents";    C_REGRAS="$HOME/.claude/CLAUDE.md"
  G_AGENTS="$HOME/.gemini/config/agents"; G_REGRAS="$HOME/.gemini/AGENTS.md"
fi

[[ $ALVO_CLAUDE == 1 ]] && processa "Claude Code" "$C_AGENTS" "$C_REGRAS" "orquestracao-fable" executor.md explore.md revisor.md
[[ $ALVO_AGY == 1 ]] && processa "Antigravity" "$G_AGENTS" "$G_REGRAS" "orquestracao-argon" executor.md explorador.md revisor.md

echo
echo "Sessões já abertas continuam com a configuração antiga: reinicie o Claude Code / agy."
