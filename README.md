# ChordPlanner

Planejador de progressões de acordes guiado por escala. Design completo em [`DESIGN.md`](DESIGN.md).

App só de frontend (Vite + React + TypeScript, Zustand, Tone.js). Sem backend: o estado fica no `localStorage` atrás da interface `SongRepository` (`src/state/repository.ts`), pronta para um backend futuro.

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # Vitest (núcleo de teoria, store, fumaça da UI)
npm run build
```

### App de desktop (macOS)

Versão standalone em Electron, com todos os samples embutidos: funciona sem internet desde a instalação.

```bash
npm run app:samples   # baixa os samples de todos os instrumentos para desktop-samples/ (uma vez; ~130 MB)
npm run app           # abre o app de desktop a partir do build
npm run app:dist      # gera release/ChordPlanner-<versão>-arm64.dmg
```

- `electron/main.js` serve o build por `app://chordplanner/` e responde os pedidos de samples do disco: primeiro os embutidos, depois o cache do usuário (o que faltar é baixado uma vez e guardado).
- Web MIDI liberado só para o próprio app; exports abrem a janela "Salvar como" do sistema; o item "Link" some no desktop (endereço `app://` não abre em outro computador).
- O `.dmg` não é assinado: no próprio Mac abre normalmente; em outro Mac é preciso clicar com o botão direito → Abrir (ou assinar/notarizar com uma conta Apple Developer).
- Testes manuais: `CHORDPLANNER_OFFLINE=1` simula o computador sem internet; `CHORDPLANNER_DEBUG=1` registra os pedidos de permissão. Ícone: `scripts/gen-mac-icon.py`.
- Instalação das dependências: o binário do Electron vem do script de instalação do pacote. Se o npm bloquear scripts, rode `node node_modules/electron/install.js`.

- `src/core/` — teoria musical pura e testada (escalas, acordes, diatônicos, modificadores, voicings, análise funcional, tempo, arranjo, braço de violão, prática).
- `src/audio/` — motor de áudio. `engine.ts` é uma fachada leve; Tone.js e smplr (`player.ts`, `loaders.ts`) só são baixados no primeiro som. Samples via smplr: SplendidGrandPiano, E-Pianos, VCSL, Smolken e MusyngKite (FluidR3 como plano B).
- `src/state/` — store Zustand com desfazer/refazer e persistência.
- `src/export/` — MIDI (`.mid`, com nomes dos acordes), MusicXML, ABC, ChordPro, cifra em texto, arquivo JSON reimportável (com validação de conteúdo externo) e link de compartilhamento (`#s=…`, música comprimida no fragmento da URL). Partituras usam `src/core/notation.ts` (compassos, ligaduras, armadura, grafia).
- `src/ui/` — componentes (roda, progressão, arranjo, modificadores, seletores).
- `src/sw/` e `src/pwa.ts` — service worker gerado no build (`vite.config.ts`) para uso offline; ícones gerados por `scripts/gen-icons.py`.

Roadmap e o que falta: [`ROADMAP_FINAL.md`](ROADMAP_FINAL.md).
