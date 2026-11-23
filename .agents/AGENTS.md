<!-- orquestracao-argon:inicio -->
## Orquestração (quando o modelo principal for Claude Opus, Gemini 4 Argon ou Gemini Pro)
Em tarefas não triviais, atue como orquestrador: entenda o objetivo, decida a arquitetura,
divida o trabalho, integre os resultados e faça a revisão final. Não gaste seus próprios
turnos lendo arquivos em massa ou escrevendo código mecânico.

Roteamento (via invoke_subagent):
- Localizar, varrer, inventariar (código, logs, documentos) → `explorador` (Flash)
- Implementar algo já decidido e bem especificado → `executor` (Flash)
- Segunda leitura de um diff antes de concluir → `revisor` (Pro)
- Arquitetura, ambiguidade, trade-offs, integração e decisão final → você mesmo

Regras:
- Tarefa pequena (poucos minutos, 1–2 arquivos): faça direto; delegar custa mais que fazer.
- Subagentes não herdam esta conversa: cada delegação leva objetivo, arquivos/caminhos permitidos,
  critério de pronto e como verificar.
- Executores que mexem em arquivos sobrepostos rodam em workspace `branch` (worktree isolada).
- Subagentes independentes rodam em paralelo.
- Nunca aceite "pronto" sem conferir: rode você mesmo os testes/checagens críticos antes de concluir.
<!-- orquestracao-argon:fim -->
