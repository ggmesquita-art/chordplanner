import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INSTRUMENTS, hasInstrument } from "../audio/instruments";
import { FAMILY_SUGGESTIONS, SCALE_SUGGESTIONS, suggestionsFor } from "../audio/scaleInstruments";
import { isRest } from "../core/chords";
import { SCALES } from "../core/scales";
import { makeSong } from "../core/song";
import { sanitizeContent } from "../export/json";
import { repository } from "./repository";
import {
  DEFAULT_MIXER,
  blockKey,
  contentHash,
  normalizeHash,
  selectBlock,
  selectBlockCtx,
  selectDirty,
  selectEditChords,
  selectEditMelody,
  selectRegion,
  useStore,
} from "./store";

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
    useStore.setState({
      song: makeSong(),
      tonic: null,
      scaleId: "major",
      grid: "bar",
      melodyGrid: 0.5,
      mixer: structuredClone(DEFAULT_MIXER),
      startWithSelected: false,
      selectedItem: 0,
      selectedChord: null,
      selectedMelodyNote: null,
      past: [],
      future: [],
    });
  });

  const chords = () => selectBlock(useStore.getState())!.chords;

  it("com o checkbox desmarcado (padrão), definir a tônica e criar um novo bloco começam vazios", () => {
    useStore.getState().setTonic(2);
    expect(chords()).toEqual([]);
    useStore.getState().addBlock();
    expect(chords()).toEqual([]);
    expect(useStore.getState().selectedChord).toBeNull();
    useStore.getState().addChord(5, "maj");
    expect(chords().map((c) => c.root)).toEqual([5]);
  });

  it("com o checkbox marcado, definir a tônica, limpar e criar novo bloco iniciam com a tônica", () => {
    useStore.setState({ startWithSelected: true });
    useStore.getState().setTonic(2);
    expect(chords().map((c) => [c.root, c.quality])).toEqual([[2, "maj"]]);
    useStore.getState().addBlock();
    expect(chords().map((c) => [c.root, c.quality])).toEqual([[2, "maj"]]);
    expect(useStore.getState().selectedChord).toBe(chords()[0].id);
  });

  it("trocar a tônica transpõe mantendo os graus; desfazer volta", () => {
    const s = useStore.getState();
    s.setTonic(0);
    s.addChord(0, "maj");
    s.addChord(7, "maj");
    useStore.getState().setTonic(2);
    expect(chords().map((c) => c.root)).toEqual([2, 9]);
    useStore.getState().undo();
    expect(chords().map((c) => c.root)).toEqual([0, 7]);
  });

  it("limpar com checkbox desmarcado deixa vazio; marcado recoloca a tônica", () => {
    const s = useStore.getState();
    s.setTonic(9);
    useStore.setState({ scaleId: "minor" });
    s.addChord(5, "maj");
    useStore.getState().clearBlock();
    expect(chords()).toEqual([]);

    useStore.setState({ startWithSelected: true });
    s.addChord(5, "maj");
    useStore.getState().clearBlock();
    expect(chords().map((c) => [c.root, c.quality])).toEqual([[9, "m"]]);
  });

  it("jazzificar aplica a 7ª diatônica de cada grau", () => {
    const s = useStore.getState();
    s.setTonic(0);
    for (const [r, q] of [[0, "maj"], [2, "m"], [7, "maj"], [11, "dim"]] as const) useStore.getState().addChord(r, q);
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
    useStore.getState().addChord(2, "maj");
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
    useStore.getState().addChord(0, "maj");
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
    st.addChord(0, "maj");
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

  it("escopo 'Região' volta a 'Bloco' quando a região deixa de existir", () => {
    const st = useStore.getState();
    st.newSong();
    st.setTonic(0);
    st.addChord(0, "maj");
    st.addChord(7, "maj");
    const ids = selectBlock(useStore.getState())!.chords.map((c) => c.id);
    useStore.getState().selectChord(ids[0]);
    useStore.getState().setRegionEnd(ids[1]);
    useStore.getState().setPlayScope("region");
    expect(useStore.getState().playScope).toBe("region");
    useStore.getState().selectChord(ids[1]);
    expect(useStore.getState().playScope).toBe("block");
  });
});

describe("hash de conteúdo sem ids", () => {
  const base = () => {
    const song = makeSong();
    const block = Object.values(song.blocks)[0];
    block.chords.push({ id: "c1", root: 0, quality: "maj", modifiers: [], duration: 4 }, { id: "c2", root: 7, quality: "maj", modifiers: [], duration: 4 });
    return { scaleId: "major", tonic: 0, song };
  };

  it("conteúdo sem ids em acordes/itens tem o mesmo hash após sanitizeContent", () => {
    const orig = base();
    const stripped = structuredClone(orig);
    for (const b of Object.values(stripped.song.blocks)) for (const c of b.chords) delete (c as { id?: string }).id;
    for (const it of stripped.song.arrangement) delete (it as { id?: string }).id;
    const clean = sanitizeContent(stripped)!;
    expect(contentHash(clean)).toBe(contentHash(orig));
  });

  it("mudar uma fundamental muda o hash", () => {
    const orig = base();
    const changed = structuredClone(orig);
    Object.values(changed.song.blocks)[0].chords[0].root = 2;
    expect(contentHash(changed)).not.toBe(contentHash(orig));
  });
});

describe("coalescência do histórico", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    useStore.getState().newSong();
  });
  afterEach(() => vi.useRealTimers());

  it("duas chamadas de setBpm em 300 ms viram um passo, com o estado inicial preservado", () => {
    const before = useStore.getState().song.bpm;
    useStore.getState().setBpm(30);
    vi.advanceTimersByTime(300);
    useStore.getState().setBpm(300);
    expect(useStore.getState().past).toHaveLength(1);
    expect(useStore.getState().song.bpm).toBe(300);
    useStore.getState().undo();
    expect(useStore.getState().song.bpm).toBe(before);
  });

  it("com 1,5 s de intervalo são dois passos", () => {
    useStore.getState().setBpm(100);
    vi.advanceTimersByTime(1500);
    useStore.getState().setBpm(120);
    expect(useStore.getState().past).toHaveLength(2);
  });

  it("setBpm seguido de setSwing são dois passos", () => {
    useStore.getState().setBpm(100);
    useStore.getState().setSwing(30);
    expect(useStore.getState().past).toHaveLength(2);
  });

  it("desfazer no meio quebra a coalescência", () => {
    useStore.getState().setBpm(100);
    useStore.getState().undo();
    useStore.getState().setBpm(110);
    useStore.getState().undo();
    useStore.getState().setBpm(120);
    expect(useStore.getState().past).toHaveLength(1);
    useStore.getState().setBpm(130);
    expect(useStore.getState().past).toHaveLength(1);
  });

  it("setBlockProps só com bpm coalesce; com outro campo, não", () => {
    const id = Object.keys(useStore.getState().song.blocks)[0];
    useStore.getState().setBlockProps(id, { bpm: 100 });
    useStore.getState().setBlockProps(id, { bpm: 110 });
    expect(useStore.getState().past).toHaveLength(1);
    useStore.getState().setBlockProps(id, { pattern: "arp-up" });
    useStore.getState().setBlockProps(id, { pattern: "comping" });
    expect(useStore.getState().past).toHaveLength(3);
  });
});

describe("renameSong", () => {
  it("devolve false se a gravação falha, mantendo o nome na tela e a lista", () => {
    useStore.getState().newSong();
    useStore.getState().renameSong("Um");
    expect(useStore.getState().saveSong()).toBe(true);
    const list = useStore.getState().savedSongs;
    vi.spyOn(repository, "saveSong").mockReturnValue(false);
    expect(useStore.getState().renameSong("Dois")).toBe(false);
    expect(useStore.getState().songName).toBe("Dois");
    expect(useStore.getState().savedSongs).toEqual(list);
    vi.restoreAllMocks();
    expect(useStore.getState().renameSong("Tres")).toBe(true);
  });

  it("campos da v2 no bloco são validados; preferências da música e voicing do acorde", () => {
    const st = useStore.getState();
    st.newSong();
    st.setTonic(0);
    st.addChord(0, "maj");
    const id = selectBlock(useStore.getState())!.id;
    const b = () => selectBlock(useStore.getState())!;
    useStore.getState().setBlockProps(id, { bassInstrument: "nao-existe", drone: true, rampTo: 999, key: { tonic: 14, scaleId: "major" } });
    expect([b().bassInstrument, b().drone, b().rampTo, b().key]).toEqual([undefined, true, 300, undefined]);
    useStore.getState().setBlockProps(id, { bassInstrument: "piano", key: { tonic: 9, scaleId: "minor" }, drone: false });
    expect([b().bassInstrument, b().key, b().drone]).toEqual(["piano", { tonic: 9, scaleId: "minor" }, undefined]);
    useStore.getState().setSongProps({ voiceLeading: true });
    expect(useStore.getState().song.voiceLeading).toBe(true);
    useStore.getState().setSongProps({ voiceLeading: false });
    expect("voiceLeading" in useStore.getState().song).toBe(false);
    const chordId = b().chords[0].id;
    useStore.getState().setVoicing(chordId, "drop2");
    expect(b().chords[0].voicing).toBe("drop2");
    useStore.getState().setVoicing(chordId, "closed");
    expect(b().chords[0].voicing).toBeUndefined();
  });

  it("modulação: contexto do bloco, acorde da tônica do bloco e transposição que leva as tonalidades junto", () => {
    const st = useStore.getState();
    st.newSong();
    useStore.setState({ startWithSelected: true });
    st.setTonic(0);
    st.addBlock();
    const id = selectBlock(useStore.getState())!.id;
    useStore.getState().setBlockProps(id, { key: { tonic: 4, scaleId: "dorian" } });
    expect(selectBlockCtx(useStore.getState())!.tonic).toBe(4);
    expect(blockKey(useStore.getState(), selectBlock(useStore.getState()))).toEqual({ tonic: 4, scaleId: "dorian" });
    useStore.getState().clearBlock();
    expect(selectBlock(useStore.getState())!.chords.map((c) => [c.root, c.quality])).toEqual([[4, "m"]]);
    useStore.getState().setTonic(2);
    expect(selectBlock(useStore.getState())!.key).toEqual({ tonic: 6, scaleId: "dorian" });
    expect(selectBlock(useStore.getState())!.chords[0].root).toBe(6);
    useStore.getState().selectItem(0);
    expect(selectBlockCtx(useStore.getState())!.tonic).toBe(2);
    useStore.setState({ startWithSelected: false });
  });

  it("casa 2: as ações de edição atuam na casa 2 e a casa vazia some", () => {
    const st = useStore.getState();
    st.newSong();
    st.setTonic(0);
    st.addChord(0, "maj");
    useStore.getState().setEditEnding(true);
    useStore.getState().addChord(7, "maj");
    useStore.getState().addChord(0, "maj");
    let b = selectBlock(useStore.getState())!;
    expect(b.chords.map((c) => c.root)).toEqual([0]);
    expect(b.ending!.map((c) => c.root)).toEqual([7, 0]);
    expect(selectEditChords(useStore.getState()).length).toBe(2);
    const id = b.ending![0].id;
    useStore.getState().setDuration(id, 2);
    useStore.getState().moveChord(0, 1);
    b = selectBlock(useStore.getState())!;
    expect(b.ending!.map((c) => [c.root, c.duration])).toEqual([[0, 4], [7, 2]]);
    for (const c of b.ending!) useStore.getState().removeChord(c.id);
    expect(selectBlock(useStore.getState())!.ending).toBeUndefined();
    useStore.getState().addChord(5, "maj");
    useStore.getState().selectItem(0);
    expect(useStore.getState().editEnding).toBe(false);
    useStore.getState().clearEnding();
    expect(selectBlock(useStore.getState())!.ending).toBeUndefined();
  });
});

describe("casa 2: seleção e clonagem", () => {
  beforeEach(() => {
    const st = useStore.getState();
    st.newSong();
    st.setTonic(0);
    st.addChord(0, "maj");
  });
  const enterEnding = () => {
    useStore.getState().setEditEnding(true);
    useStore.getState().addChord(7, "maj");
  };

  it("trocar o bloco selecionado sai do modo casa 2", () => {
    const ops: [string, () => void][] = [
      ["addBlock", () => useStore.getState().addBlock()],
      ["addLinkedInstance", () => useStore.getState().addLinkedInstance(0)],
      ["applyTemplate", () => useStore.getState().applyTemplate("pop")],
    ];
    for (const [name, op] of ops) {
      useStore.getState().newSong();
      useStore.getState().setTonic(0);
      enterEnding();
      expect(useStore.getState().editEnding, name).toBe(true);
      op();
      expect(useStore.getState().editEnding, name).toBe(false);
    }
  });

  it("removeItem, moveItem e desfazer saem da casa 2 quando o bloco muda", () => {
    useStore.getState().addBlock();
    useStore.getState().selectItem(1);
    enterEnding();
    useStore.getState().removeItem(1);
    expect(useStore.getState().editEnding).toBe(false);

    useStore.getState().addBlock(); // seleciona o item 1
    useStore.getState().selectItem(0);
    useStore.getState().setEditEnding(true);
    useStore.getState().moveItem(0, 1);
    expect(useStore.getState().editEnding).toBe(false);

    useStore.getState().newSong();
    useStore.getState().setTonic(0);
    useStore.getState().addBlock(); // histórico: seleção no item 1
    useStore.getState().selectItem(1);
    useStore.getState().setEditEnding(true);
    useStore.getState().undo(); // volta a ter 1 item: bloco selecionado muda
    expect(useStore.getState().selectedItem).toBe(0);
    expect(useStore.getState().editEnding).toBe(false);
  });

  it("completeBar completa a casa 2 quando ela está em edição", () => {
    useStore.getState().setEditEnding(true);
    useStore.getState().addChord(7, "maj");
    const id = selectBlock(useStore.getState())!.ending![0].id;
    useStore.getState().setDuration(id, 3);
    useStore.getState().completeBar();
    const b = selectBlock(useStore.getState())!;
    expect(b.ending![0].duration).toBe(4);
    expect(b.chords[0].duration).toBe(4);
  });

  it("Tornar único copia a casa 2 com ids novos; o hash ignora esses ids", () => {
    enterEnding();
    useStore.getState().setEditEnding(false);
    useStore.getState().addLinkedInstance(0);
    useStore.getState().makeUnique(1);
    const { song } = useStore.getState();
    const blocks = Object.values(song.blocks);
    const ids = blocks.flatMap((b) => [...b.chords, ...(b.ending ?? [])].map((c) => c.id));
    expect(blocks.every((b) => b.ending?.length === 1)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    const s = useStore.getState();
    const content = { scaleId: s.scaleId, tonic: s.tonic, song: s.song };
    const reloaded = sanitizeContent(JSON.parse(JSON.stringify(content)))!;
    expect(contentHash(reloaded)).toBe(contentHash(content));
    const other = structuredClone(content);
    for (const b of Object.values(other.song.blocks)) b.ending![0].id = "outro";
    expect(contentHash(other)).toBe(contentHash(content));
  });

  it("addChord com modificadores: um único passo de desfazer", () => {
    const before = useStore.getState().past.length;
    useStore.getState().addChord(7, "maj", [{ kind: "ext", value: 7 }]);
    expect(useStore.getState().past.length).toBe(before + 1);
    expect(chordsOf().at(-1)!.modifiers).toEqual([{ kind: "ext", value: 7 }]);
    useStore.getState().undo();
    expect(chordsOf().map((c) => c.root)).toEqual([0]);
  });
});

describe("Etapa 6 (melodia, durações menores e N.C. no store)", () => {
  beforeEach(() => {
    useStore.setState({
      song: makeSong(),
      tonic: null,
      scaleId: "major",
      grid: "bar",
      melodyGrid: 0.5,
      mixer: structuredClone(DEFAULT_MIXER),
      startWithSelected: false,
      selectedItem: 0,
      selectedChord: null,
      selectedMelodyNote: null,
      editEnding: false,
      past: [],
      future: [],
    });
  });

  it("addChord usa a duração da grade ativa e setDuration aceita 0.25", () => {
    useStore.getState().setTonic(0);
    useStore.getState().setGrid(0.25);
    const c = useStore.getState().addChord(5, "maj")!;
    expect(c.duration).toBe(0.25);
    useStore.getState().setGrid(0.5);
    const c2 = useStore.getState().addChord(7, "maj")!;
    expect(c2.duration).toBe(0.5);
    useStore.getState().setDuration(c2.id, 0.1);
    expect(chordsOf().find((x) => x.id === c2.id)?.duration).toBe(0.25);
  });

  it("addRest, toggleRest e insertChordAtBeat preenchem lacunas com N.C.", () => {
    useStore.getState().setTonic(0);
    useStore.getState().setGrid(1);
    useStore.getState().addChord(0, "maj");
    const inserted = useStore.getState().insertChordAtBeat(4, { root: 7, quality: "maj", duration: 2 })!;
    expect(chordsOf().map((c) => [isRest(c), c.duration, c.root])).toEqual([
      [false, 1, 0],
      [true, 3, 0],
      [false, 2, 7],
    ]);
    useStore.getState().addRest(1);
    expect(isRest(chordsOf().at(-1))).toBe(true);
    useStore.getState().toggleRest(inserted.id);
    expect(isRest(chordsOf().find((c) => c.id === inserted.id))).toBe(true);
    useStore.getState().undo();
    expect(isRest(chordsOf().find((c) => c.id === inserted.id))).toBe(false);
  });

  it("setTonic transpõe melodia junto e ignora acordes N.C.", () => {
    useStore.getState().setTonic(0);
    useStore.getState().addChord(0, "maj");
    useStore.getState().addRest(2);
    useStore.getState().upsertMelodyNote({ pitch: 60, start: 0, duration: 1 });
    useStore.getState().upsertMelodyNote({ pitch: 64, start: 1, duration: 1 });
    useStore.getState().setTonic(2);
    expect(selectEditMelody(useStore.getState()).map((n) => n.pitch)).toEqual([62, 66]);
    expect(isRest(chordsOf()[1])).toBe(true);
    expect(chordsOf()[1].root).toBe(0);
    useStore.getState().undo();
    expect(selectEditMelody(useStore.getState()).map((n) => n.pitch)).toEqual([60, 64]);
  });

  it("snapBlockMelodyToScale ajusta notas fora e ignora ids no contentHash", () => {
    useStore.getState().setTonic(0);
    useStore.getState().upsertMelodyNote({ pitch: 61, start: 0, duration: 1 });
    useStore.getState().snapBlockMelodyToScale();
    expect(selectEditMelody(useStore.getState()).map((n) => n.pitch)).toEqual([60]);

    const s = useStore.getState();
    const h1 = contentHash(s);
    const cloned = structuredClone(s.song);
    Object.values(cloned.blocks)[0].melody![0].id = "outro-id";
    expect(contentHash({ ...s, song: cloned })).toBe(h1);
  });

  it("makeUnique clona melodia e melodyEnding com novos ids", () => {
    useStore.getState().setTonic(0);
    useStore.getState().upsertMelodyNote({ pitch: 60, start: 0, duration: 1 });
    useStore.getState().setEditEnding(true);
    useStore.getState().upsertMelodyNote({ pitch: 67, start: 0, duration: 1 });
    useStore.getState().setEditEnding(false);
    useStore.getState().addLinkedInstance(0);
    useStore.getState().makeUnique(1);
    const blocks = Object.values(useStore.getState().song.blocks);
    expect(blocks[0].melody![0].id).not.toBe(blocks[1].melody![0].id);
    expect(blocks[0].melodyEnding![0].id).not.toBe(blocks[1].melodyEnding![0].id);
  });

  it("setMelodyInstrument e setBlockProps validam melodia e mixer", () => {
    useStore.getState().setMelodyInstrument("flute");
    expect(useStore.getState().song.melodyInstrument).toBe("flute");
    const id = selectBlock(useStore.getState())!.id;
    useStore.getState().setBlockProps(id, { melodyInstrument: "violin", melodyMidiChannel: 99 });
    expect(selectBlock(useStore.getState())!.melodyInstrument).toBe("violin");
    expect(selectBlock(useStore.getState())!.melodyMidiChannel).toBe(16);
    useStore.getState().setTrackMix("melody", { volume: 3, muted: true });
    expect(useStore.getState().mixer.melody).toEqual({ volume: 1.5, muted: true, solo: false });
  });
});

const chordsOf = () => selectBlock(useStore.getState())!.chords;
