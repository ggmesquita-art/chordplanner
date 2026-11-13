# ChordPlanner

Planejador de progressões de acordes guiado por escala. Design completo em [`DESIGN.md`](DESIGN.md).

App só de frontend (Vite + React + TypeScript, Zustand, Tone.js). Sem backend: o estado fica no `localStorage` atrás da interface `SongRepository` (`src/state/repository.ts`), pronta para um backend futuro.

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # Vitest (núcleo de teoria, store, fumaça da UI)
npm run build
```

- `src/core/` — teoria musical pura e testada (escalas, acordes, diatônicos, modificadores, tempo, arranjo).
- `src/audio/` — motor Tone.js, catálogo de instrumentos e sugestões por escala. Samples via smplr: SplendidGrandPiano, E-Pianos, VCSL, Smolken e MusyngKite (FluidR3 como plano B), carregados sob demanda.
- `src/state/` — store Zustand com desfazer/refazer e persistência.
- `src/export/` — cifra em texto, MIDI (`.mid`), arquivo JSON reimportável (com validação de conteúdo externo) e link de compartilhamento (`#s=…`, música comprimida no fragmento da URL).
- `src/ui/` — componentes (roda, progressão, arranjo, modificadores, seletores).
