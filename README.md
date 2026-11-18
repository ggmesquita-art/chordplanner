# ChordPlanner

Planejador de progressões de acordes guiado por escala. Design completo em [`DESIGN.md`](DESIGN.md).

App só de frontend (Vite + React + TypeScript, Zustand, Tone.js). Sem backend: o estado fica no `localStorage` atrás da interface `SongRepository` (`src/state/repository.ts`), pronta para um backend futuro.

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # Vitest (núcleo de teoria, store, fumaça da UI)
npm run build
```

- `src/core/` — teoria musical pura e testada (escalas, acordes, diatônicos, modificadores, voicings, análise funcional, tempo, arranjo, braço de violão, prática).
- `src/audio/` — motor de áudio. `engine.ts` é uma fachada leve; Tone.js e smplr (`player.ts`, `loaders.ts`) só são baixados no primeiro som. Samples via smplr: SplendidGrandPiano, E-Pianos, VCSL, Smolken e MusyngKite (FluidR3 como plano B).
- `src/state/` — store Zustand com desfazer/refazer e persistência.
- `src/export/` — cifra em texto, MIDI (`.mid`), arquivo JSON reimportável (com validação de conteúdo externo) e link de compartilhamento (`#s=…`, música comprimida no fragmento da URL).
- `src/ui/` — componentes (roda, progressão, arranjo, modificadores, seletores).
- `src/sw/` e `src/pwa.ts` — service worker gerado no build (`vite.config.ts`) para uso offline; ícones gerados por `scripts/gen-icons.py`.

Roadmap e o que falta: [`ROADMAP_FINAL.md`](ROADMAP_FINAL.md).
