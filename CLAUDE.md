<!-- orquestracao-fable:inicio -->
## Orquestração (quando a sessão principal for Fable)
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
<!-- orquestracao-fable:fim -->

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
