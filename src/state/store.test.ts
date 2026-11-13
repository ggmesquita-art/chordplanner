import { beforeEach, describe, expect, it } from "vitest";
import { INSTRUMENTS, hasInstrument } from "../audio/instruments";
import { FAMILY_SUGGESTIONS, SCALE_SUGGESTIONS, suggestionsFor } from "../audio/scaleInstruments";
import { SCALES } from "../core/scales";
import { makeSong } from "../core/song";
import { selectBlock, selectDirty, useStore } from "./store";

describe("instrumentos (§5.2–5.3)", () => {
  it("ids únicos e tessituras válidas", () => {
    const ids = new Set(INSTRUMENTS.map((i) => i.id));
    expect(ids.size).toBe(INSTRUMENTS.length);
    for (const i of INSTRUMENTS) expect(i.range[0], i.id).toBeLessThan(i.range[1]);
  });

  it("todo instrumento sampleado tem fonte smplr e plano B GM", () => {
    for (const i of INSTRUMENTS.filter((d) => d.engine === "sampler")) {
      expect(i.source.smplr, i.id).toBeTruthy();
      expect(i.source.gm, i.id).toBeTruthy();
    }
  });

  it("todo id sugerido existe no catálogo", () => {
    for (const s of [...Object.values(SCALE_SUGGESTIONS), ...Object.values(FAMILY_SUGGESTIONS)])
      for (const id of s!.instruments) expect(hasInstrument(id), id).toBe(true);
  });

  it("toda escala resolve ao menos uma sugestão", () => {
    for (const sc of SCALES) expect(suggestionsFor(sc).instruments.length, sc.id).toBeGreaterThan(0);
    expect(suggestionsFor(SCALES.find((s) => s.id === "hirajoshi")!).instruments[0]).toBe("koto");
  });
});

describe("store", () => {
  beforeEach(() => {
    useStore.setState({ song: makeSong(), tonic: null, scaleId: "major", startWithSelected: false, selectedItem: 0, selectedChord: null, past: [], future: [] });
  });

  const chords = () => selectBlock(useStore.getState())!.chords;

  it("ao definir a tônica, a progressão começa com o acorde da tônica", () => {
    useStore.getState().setTonic(2);
    expect(chords().map((c) => [c.root, c.quality])).toEqual([[2, "maj"]]);
  });

  it("com o checkbox marcado, começa vazia e o primeiro clique abre a progressão", () => {
    useStore.setState({ startWithSelected: true });
    useStore.getState().setTonic(0);
    expect(chords()).toEqual([]);
    useStore.getState().addChord(5, "maj");
    expect(chords().map((c) => c.root)).toEqual([5]);
  });

  it("trocar a tônica transpõe mantendo os graus; desfazer volta", () => {
    const s = useStore.getState();
    s.setTonic(0);
    s.addChord(7, "maj");
    useStore.getState().setTonic(2);
    expect(chords().map((c) => c.root)).toEqual([2, 9]);
    useStore.getState().undo();
    expect(chords().map((c) => c.root)).toEqual([0, 7]);
  });

  it("limpar com checkbox desmarcado recoloca a tônica", () => {
    const s = useStore.getState();
    s.setTonic(9);
    useStore.setState({ scaleId: "minor" });
    s.addChord(5, "maj");
    useStore.getState().clearBlock();
    expect(chords().map((c) => [c.root, c.quality])).toEqual([[9, "m"]]);
  });

  it("jazzificar aplica a 7ª diatônica de cada grau", () => {
    const s = useStore.getState();
    s.setTonic(0);
    for (const [r, q] of [[2, "m"], [7, "maj"], [11, "dim"]] as const) useStore.getState().addChord(r, q);
    useStore.getState().applyPreset("jazzify");
    const exts = chords().map((c) => c.modifiers.map((m) => m.value).join());
    expect(exts).toEqual(["maj7", "7", "7", "7"]);
  });

  it("blocos: instância vinculada compartilha o bloco; tornar único separa", () => {
    const s = useStore.getState();
    s.setTonic(0);
    s.addLinkedInstance(0);
    let song = useStore.getState().song;
    expect(song.arrangement[0].blockId).toBe(song.arrangement[1].blockId);
    useStore.getState().makeUnique(1);
    song = useStore.getState().song;
    expect(song.arrangement[0].blockId).not.toBe(song.arrangement[1].blockId);
    expect(Object.keys(song.blocks).length).toBe(2);
  });

  it("durante a reprodução, a progressão segue o bloco que toca", () => {
    const s = useStore.getState();
    s.setTonic(0);
    useStore.getState().addBlock();
    useStore.getState().selectItem(0);
    useStore.setState({ followPlayback: true });
    useStore.getState().setPlayhead({ itemIndex: 1, chordIndex: 0, eventIndex: 3 });
    expect(useStore.getState().selectedItem).toBe(1);
    useStore.setState({ followPlayback: false });
    useStore.getState().setPlayhead({ itemIndex: 0, chordIndex: 0, eventIndex: 0 });
    expect(useStore.getState().selectedItem).toBe(1);
  });

  it("salvar, alterar, abrir e novo", () => {
    const s = useStore.getState();
    s.newSong();
    expect(selectDirty(useStore.getState())).toBe(false);
    useStore.getState().setTonic(2);
    expect(selectDirty(useStore.getState())).toBe(true);

    useStore.getState().renameSong("Balada em Ré");
    useStore.getState().saveSong();
    const id = useStore.getState().songId!;
    expect(id).toBeTruthy();
    expect(selectDirty(useStore.getState())).toBe(false);
    expect(useStore.getState().savedSongs.map((m) => m.name)).toContain("Balada em Ré");

    useStore.getState().addChord(7, "maj");
    expect(selectDirty(useStore.getState())).toBe(true);

    useStore.getState().newSong();
    expect(useStore.getState().tonic).toBeNull();
    expect(useStore.getState().songId).toBeNull();
    expect(useStore.getState().past).toEqual([]);

    expect(useStore.getState().openSong(id)).toBe(true);
    const st = useStore.getState();
    expect(st.tonic).toBe(2);
    expect(st.songName).toBe("Balada em Ré");
    expect(selectBlock(st)!.chords.map((c) => c.root)).toEqual([2]);
    expect(selectDirty(st)).toBe(false);

    useStore.getState().saveCopy("Cópia");
    expect(useStore.getState().songId).not.toBe(id);
    useStore.getState().deleteSong(id);
    expect(useStore.getState().savedSongs.map((m) => m.name)).toEqual(["Cópia"]);
  });
});
