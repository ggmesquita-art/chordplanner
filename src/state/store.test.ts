import { beforeEach, describe, expect, it, vi } from "vitest";
import { INSTRUMENTS, hasInstrument } from "../audio/instruments";
import { FAMILY_SUGGESTIONS, SCALE_SUGGESTIONS, suggestionsFor } from "../audio/scaleInstruments";
import { SCALES } from "../core/scales";
import { makeSong } from "../core/song";
import { sanitizeContent } from "../export/json";
import { repository } from "./repository";
import { contentHash, normalizeHash, selectBlock, selectDirty, selectRegion, useStore } from "./store";

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

  it("desfazer/refazer restaura tônica e fundamentais", () => {
    useStore.getState().setTonic(0);
    useStore.getState().addChord(7, "maj");
    useStore.getState().setTonic(2);
    useStore.getState().undo();
    expect(useStore.getState().tonic).toBe(0);
    expect(chords().map((c) => c.root)).toEqual([0, 7]);
    useStore.getState().redo();
    expect(useStore.getState().tonic).toBe(2);
    expect(chords().map((c) => c.root)).toEqual([2, 9]);
  });

  it("aplicar template sem tônica e desfazer volta a tonic null", () => {
    useStore.getState().applyTemplate("pop");
    expect(useStore.getState().tonic).toBe(0);
    useStore.getState().undo();
    expect(useStore.getState().tonic).toBeNull();
  });

  it("primeira tônica entra no histórico em um único passo", () => {
    useStore.getState().setTonic(5);
    expect(useStore.getState().past.length).toBe(1);
    useStore.getState().undo();
    expect(useStore.getState().tonic).toBeNull();
    expect(chords()).toEqual([]);
  });

  it("trocar escala e desfazer restaura scaleId; sem mudança não cria histórico", () => {
    useStore.getState().setScale("minor");
    expect(useStore.getState().past.length).toBe(1);
    useStore.getState().setScale("minor");
    expect(useStore.getState().past.length).toBe(1);
    useStore.getState().undo();
    expect(useStore.getState().scaleId).toBe("major");
  });

  it("setBlockProps limita bpm e canal MIDI", () => {
    const id = selectBlock(useStore.getState())!.id;
    const props = () => selectBlock(useStore.getState())!;
    useStore.getState().setBlockProps(id, { bpm: 0, midiChannel: 99 });
    expect([props().bpm, props().midiChannel]).toEqual([30, 16]);
    useStore.getState().setBlockProps(id, { bpm: 999, midiChannel: 0 });
    expect([props().bpm, props().midiChannel]).toEqual([300, 1]);
    useStore.getState().setBlockProps(id, { bpm: undefined, midiChannel: NaN });
    expect(props().bpm).toBeUndefined();
    expect(props().midiChannel).toBeUndefined();
  });

  it("saveSong devolve false e não mexe no estado quando o repositório falha", () => {
    useStore.getState().newSong();
    useStore.getState().setTonic(2);
    const before = useStore.getState().savedHash;
    const spy = vi.spyOn(repository, "saveSong").mockReturnValue(false);
    expect(useStore.getState().saveSong()).toBe(false);
    expect(useStore.getState().savedHash).toBe(before);
    expect(useStore.getState().songId).toBeNull();
    expect(selectDirty(useStore.getState())).toBe(true);
    expect(useStore.getState().saveCopy("X")).toBe(false);
    expect(useStore.getState().songId).toBeNull();
    spy.mockRestore();
  });

  it("loadExternal carrega como música nova e suja", () => {
    const { song } = useStore.getState();
    useStore.getState().loadExternal({ name: "Externa", scaleId: "minor", tonic: 4, song });
    const st = useStore.getState();
    expect(st.songId).toBeNull();
    expect(st.songName).toBe("Externa");
    expect(st.song).not.toBe(song);
    expect(st.past).toEqual([]);
    expect(selectDirty(st)).toBe(true);
  });

  it("o hash do conteúdo não depende da ordem dos campos (recarregar não acusa alteração falsa)", () => {
    const st0 = useStore.getState();
    st0.newSong();
    st0.setTonic(0);
    st0.addChord(7, "maj");
    st0.addBlock();
    st0.moveItem(1, 0);
    const id = selectBlock(useStore.getState())!.id;
    // Overrides criados fora da ordem "canônica" dos campos.
    useStore.getState().setBlockProps(id, { instrument: "synth-pad" });
    useStore.getState().setBlockProps(id, { midiChannel: 3 });
    useStore.getState().setBlockProps(id, { bpm: 120 });
    const s = useStore.getState();
    const content = { scaleId: s.scaleId, tonic: s.tonic, song: s.song };
    const legacy = JSON.stringify([s.scaleId, s.tonic, s.song]);
    // O que volta do armazenamento passa pelo saneamento, que reconstrói os objetos em outra ordem.
    const reloaded = sanitizeContent(JSON.parse(JSON.stringify(content)))!;
    expect(JSON.stringify(reloaded.song)).not.toBe(JSON.stringify(s.song));
    expect(contentHash(reloaded)).toBe(contentHash(content));
    // Hash gravado por versões anteriores (ordem de inserção) é convertido para a forma atual.
    expect(normalizeHash(legacy)).toBe(contentHash(content));
    expect(normalizeHash(null)).toBeNull();
    expect(normalizeHash("não é json")).toBe("não é json");
  });

  it("região: da seleção até outro acorde, em ordem; desfeita ao mudar a seleção", () => {
    const st = useStore.getState();
    st.newSong();
    st.setTonic(0);
    st.addChord(5, "maj");
    st.addChord(7, "maj");
    const ids = selectBlock(useStore.getState())!.chords.map((c) => c.id);
    expect(selectRegion(useStore.getState())).toBeNull();
    useStore.getState().selectChord(ids[2]);
    useStore.getState().setRegionEnd(ids[0]);
    expect(selectRegion(useStore.getState())).toEqual({ from: 0, to: 2 });
    useStore.getState().setRegionEnd(ids[2]);
    expect(selectRegion(useStore.getState())).toBeNull();
    useStore.getState().setRegionEnd(ids[1]);
    useStore.getState().addChord(9, "m");
    expect(useStore.getState().regionEnd).toBeNull();
  });

  it("cor do bloco só aceita hexadecimal", () => {
    const id = selectBlock(useStore.getState())!.id;
    useStore.getState().setBlockProps(id, { color: "#ff6b81" });
    expect(selectBlock(useStore.getState())!.color).toBe("#ff6b81");
    useStore.getState().setBlockProps(id, { color: "url(x)" });
    expect(selectBlock(useStore.getState())!.color).toBe("#ff6b81");
  });
});
