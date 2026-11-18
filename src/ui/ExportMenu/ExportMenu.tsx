import { useRef, useState } from "react";
import { scaleContext } from "../../core/diatonic";
import { makeSpeller } from "../../core/pitch";
import type { Block } from "../../core/song";
import { downloadText, safeFileName } from "../../export/download";
import { songToText } from "../../export/text";
import { blockKey, useStore } from "../../state/store";
import { exportJson, shareUrl } from "../fileActions";
import { TextModal, type TextModalData } from "../TextModal";
import { usePopover } from "../usePopover";

/** Grafia de cada bloco pelo tom dele (tom próprio ou o da música). */
function spellFor(b: Block) {
  const st = useStore.getState();
  const key = blockKey(st, b);
  return makeSpeller(key?.tonic ?? null, key ? scaleContext(key.tonic, key.scaleId).pcs : [], st.accidentals);
}

/** Todos os formatos de exportação num só menu (o painel inferior fica mais fino). */
export function ExportMenu() {
  const { open, setOpen, ref } = usePopover();
  const [modal, setModal] = useState<TextModalData | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const onText = setModal;
  // Fecha a lista e devolve o foco ao botão (o item clicado deixa de existir).
  const run = (fn: () => void) => () => {
    setOpen(false);
    trigger.current?.focus();
    fn();
  };

  const midi = () => {
    const st = useStore.getState();
    // @tonejs/midi só é baixado quando alguém exporta.
    void import("../../export/midi").then(({ downloadMidi, songToMidi }) =>
      downloadMidi(
        songToMidi(st.song, { channel: st.midi.channel, splitBass: true, tonicFor: (id) => blockKey(st, st.song.blocks[id])?.tonic ?? null, spellFor, title: st.songName }),
        st.songName,
      ),
    );
  };
  /** Opções comuns das partituras: tom e grafia de cada bloco e o nome da música. */
  const notation = () => {
    const st = useStore.getState();
    return { title: st.songName, spellFor, keyFor: (b: Block) => blockKey(st, b) };
  };
  const file = (ext: string) => `${safeFileName(useStore.getState().songName)}.${ext}`;
  const musicXml = () =>
    void import("../../export/musicxml").then(({ songToMusicXml }) =>
      downloadText(songToMusicXml(useStore.getState().song, notation()), file("musicxml"), "application/vnd.recordare.musicxml+xml"),
    );
  const abc = () => void import("../../export/abc").then(({ songToAbc }) => downloadText(songToAbc(useStore.getState().song, notation()), file("abc"), "text/vnd.abc"));
  const chordPro = () =>
    void import("../../export/chordpro").then(({ songToChordPro }) => {
      const { title, keyFor } = notation();
      downloadText(songToChordPro(useStore.getState().song, spellFor, { title, keyFor }), file("cho"), "text/plain");
    });

  return (
    <div className="picker export-menu" ref={ref}>
      <button ref={trigger} className="btn" onClick={() => setOpen(!open)} aria-haspopup="true" aria-expanded={open} title="Exportar a música (DAW, partitura, cifra, arquivo, link)">
        ⤓ Exportar ▾
      </button>
      {open && (
        <div className="popover export-pop" role="group" aria-label="Formatos de exportação">
          <div className="group-title">Para DAW</div>
          <button className="export-item" onClick={run(midi)}>
            <b>MIDI (.mid)</b>
            <span className="muted small">Trilhas de acordes e baixo, tempo, compassos, marcadores e nomes dos acordes — Ableton, Logic, FL, Reaper, Cubase</span>
          </button>
          <button className="export-item" onClick={run(musicXml)}>
            <b>MusicXML (.musicxml)</b>
            <span className="muted small">Partitura com cifras, armadura e ensaios — MuseScore, Sibelius, Dorico, Finale, Logic, Cubase, Guitar Pro</span>
          </button>
          <div className="group-title">Cifra e partitura</div>
          <button className="export-item" onClick={run(() => onText({ title: "Cifra por seção", text: songToText(useStore.getState().song, spellFor) }))}>
            <b>Cifra (texto)</b>
            <span className="muted small">Seções, compassos e repetições para copiar</span>
          </button>
          <button className="export-item" onClick={run(chordPro)}>
            <b>ChordPro (.cho)</b>
            <span className="muted small">Cifra padrão de apps de repertório — OnSong, SongbookPro, forScore</span>
          </button>
          <button className="export-item" onClick={run(abc)}>
            <b>ABC (.abc)</b>
            <span className="muted small">Partitura em texto — abcjs, EasyABC, MuseScore</span>
          </button>
          <div className="group-title">ChordPlanner</div>
          <button className="export-item" onClick={run(() => exportJson())}>
            <b>Arquivo (.json)</b>
            <span className="muted small">Para guardar ou enviar; abre em “Importar arquivo…”</span>
          </button>
          <button
            className="export-item"
            onClick={run(
              () =>
                void shareUrl().then((url) =>
                  onText({
                    title: "Link de compartilhamento",
                    text: url,
                    hint: url.length > 8000 ? "Link longo: alguns aplicativos podem cortá-lo. Para músicas grandes, prefira exportar o JSON." : undefined,
                  }),
                ),
            )}
          >
            <b>🔗 Link</b>
            <span className="muted small">A música inteira dentro do endereço</span>
          </button>
        </div>
      )}
      {modal && <TextModal data={modal} onClose={() => (setModal(null), trigger.current?.focus())} />}
    </div>
  );
}
