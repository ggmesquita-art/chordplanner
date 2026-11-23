import { describe, expect, it } from "vitest";
import { makeChord, makeRest } from "../core/chords";
import { makeMelodyNote } from "../core/melody";
import { makeSong } from "../core/song";
import { parseSongFile, sanitizeContent, serializeSongFile, SongFileError, toSongFile } from "./json";
import { CURRENT_VERSION } from "./migrate";
import { decodeShare, encodeShare } from "./url";

function sample(name = "Minha música") {
  const song = makeSong();
  const block = Object.values(song.blocks)[0];
  block.chords.push(makeChord(0, "maj"), makeChord(7, "maj"));
  block.chords[1].modifiers = [{ kind: "ext", value: 7 }];
  return toSongFile({ name, scaleId: "major", tonic: 0, song });
}

const errorOf = (text: string) => {
  try {
    parseSongFile(text);
  } catch (e) {
    expect(e).toBeInstanceOf(SongFileError);
    return (e as Error).message;
  }
  return null;
};

describe("arquivo de música", () => {
  it("ida e volta", () => {
    const file = sample();
    expect(parseSongFile(serializeSongFile(file, true))).toEqual(file);
  });

  it("mensagens de erro", () => {
    const file = sample();
    expect(errorOf("{nao json")).toBe("O arquivo não é um JSON válido.");
    expect(errorOf(JSON.stringify({ ...file, format: "outro" }))).toBe("Este arquivo não é uma música do ChordPlanner.");
    expect(errorOf(JSON.stringify({ ...file, version: CURRENT_VERSION + 1 }))).toBe("Arquivo criado por uma versão mais nova do ChordPlanner.");
    expect(errorOf(JSON.stringify({ ...file, scaleId: "nao-existe" }))).toBe("O arquivo está danificado ou incompleto.");
  });

  it("nome: aparado, padrão e limitado a 80", () => {
    const file = sample();
    expect(parseSongFile(JSON.stringify({ ...file, name: "  Oi  " })).name).toBe("Oi");
    expect(parseSongFile(JSON.stringify({ ...file, name: 5 })).name).toBe("Sem título");
    expect(parseSongFile(JSON.stringify({ ...file, name: "a".repeat(200) })).name).toHaveLength(80);
  });
});

describe("sanitizeContent", () => {
  it("descarta acorde com qualidade desconhecida e limita bpm", () => {
    const { name: _n, format: _f, version: _v, ...content } = sample();
    const input = structuredClone(content) as any;
    const block = Object.values(input.song.blocks)[0] as any;
    block.chords.push({ id: "x", root: 2, quality: "xyz", modifiers: [], duration: 4 });
    input.song.bpm = 9999;
    const out = sanitizeContent(input)!;
    expect(out.song.bpm).toBe(300);
    expect(Object.values(out.song.blocks)[0].chords).toHaveLength(2);
  });

  it("rejeita escala inexistente", () => {
    const { song } = sample();
    expect(sanitizeContent({ scaleId: "nope", tonic: 0, song })).toBeNull();
  });

  it("regenera ids duplicados e não muta a entrada", () => {
    const { song } = sample();
    const block = Object.values(song.blocks)[0];
    block.chords[1].id = block.chords[0].id;
    const input = { scaleId: "major", tonic: 99, song };
    const snapshot = JSON.stringify(input);
    const out = sanitizeContent(input)!;
    expect(JSON.stringify(input)).toBe(snapshot);
    const [a, b] = Object.values(out.song.blocks)[0].chords;
    expect(a.id).not.toBe(b.id);
    expect(out.tonic).toBeNull();
    expect(out.song).not.toBe(song);
  });
});

describe("link de compartilhamento", () => {
  it("ida e volta com acentos e emoji", async () => {
    const file = sample("Balada em Ré 🎹");
    const hash = await encodeShare(file);
    expect(hash.startsWith("#s=")).toBe(true);
    expect(hash).toMatch(/^[A-Za-z0-9._=#-]+$/);
    expect(await decodeShare(hash)).toEqual(file);
    expect(await decodeShare(hash.slice(1))).toEqual(file);
  });

  it("entradas inválidas devolvem null", async () => {
    expect(await decodeShare("#s=1.lixo")).toBeNull();
    expect(await decodeShare("#s=0.lixo")).toBeNull();
    expect(await decodeShare("#outra-coisa")).toBeNull();
  });

  it("recusa links grandes demais e conteúdo que se expande além do limite", async () => {
    expect(await decodeShare(`#s=0.${"A".repeat(400_001)}`)).toBeNull();
    // ~3 MB de zeros comprimem para poucos KB: o limite de saída barra a expansão.
    const cs = new CompressionStream("deflate-raw");
    const w = cs.writable.getWriter();
    void w.write(new Uint8Array(3_000_000));
    void w.close();
    const packed = new Uint8Array(await new Response(cs.readable).arrayBuffer());
    const bomb = btoa(String.fromCharCode(...packed)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(bomb.length).toBeLessThan(20_000);
    expect(await decodeShare(`#s=1.${bomb}`)).toBeNull();
  });
});

describe("saneamento de campos usados em CSS", () => {
  it("cor de bloco só aceita hexadecimal", () => {
    const song = makeSong();
    const id = Object.keys(song.blocks)[0];
    const evil = structuredClone(song);
    evil.blocks[id].color = "url(https://exemplo.invalid/x)";
    evil.blocks[id].name = "n".repeat(500);
    const out = sanitizeContent({ scaleId: "major", tonic: 0, song: evil })!;
    expect(out.song.blocks[id].color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(out.song.blocks[id].name.length).toBe(80);
    expect(sanitizeContent({ scaleId: "major", tonic: 0, song })!.song.blocks[id].color).toBe(song.blocks[id].color);
  });
});

describe("conteúdo hostil (arquivo ou link de terceiros)", () => {
  it("chaves de protótipo como id de bloco são rejeitadas", () => {
    for (const key of ["__proto__", "constructor", "toString"]) {
      const text = `{"scaleId":"major","tonic":0,"song":{"blocks":{"${key}":{"chords":[]}},"arrangement":[{"blockId":"${key}"}]}}`;
      expect(sanitizeContent(JSON.parse(text)), key).toBeNull();
    }
    // Misturado com um bloco válido: sobra só o válido, e todo item aponta para um bloco próprio do objeto.
    const mixed = JSON.parse(
      `{"scaleId":"major","tonic":0,"song":{"blocks":{"__proto__":{"chords":[]},"a":{"chords":[]}},"arrangement":[{"blockId":"__proto__"},{"blockId":"a"}]}}`,
    );
    const out = sanitizeContent(mixed)!;
    expect(Object.keys(out.song.blocks)).toEqual(["a"]);
    expect(out.song.arrangement.map((i) => i.blockId)).toEqual(["a"]);
    expect(Object.getPrototypeOf(out.song.blocks)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).chords).toBeUndefined();
  });

  it("limita duração, quantidade de acordes, itens e tamanho de ids", () => {
    const chord = { root: 0, quality: "maj", duration: 1e300, modifiers: Array.from({ length: 50 }, () => ({ kind: "ext", value: 7 })) };
    const input = {
      scaleId: "major",
      tonic: 0,
      song: {
        blocks: { a: { chords: Array.from({ length: 1000 }, () => ({ ...chord })) } },
        arrangement: [{ id: "x".repeat(500), blockId: "a", repeat: 99 }, ...Array.from({ length: 1000 }, () => ({ blockId: "a" }))],
      },
    };
    const out = sanitizeContent(input)!;
    const chords = out.song.blocks.a.chords;
    expect(chords.length).toBe(256);
    expect(chords.every((c) => c.duration === 64 && c.modifiers.length <= 12)).toBe(true);
    expect(out.song.arrangement.length).toBe(256);
    expect(out.song.arrangement[0].repeat).toBe(16);
    expect(out.song.arrangement.every((i) => i.id.length <= 64)).toBe(true);
    expect(new Set(out.song.arrangement.map((i) => i.id)).size).toBe(256);
  });
});

describe("versão do arquivo", () => {
  it("versão futura mantém a mensagem; versão inválida é arquivo danificado; v1 migra para atual", () => {
    const base = JSON.parse(serializeSongFile(sample()));
    expect(errorOf(JSON.stringify({ ...base, version: CURRENT_VERSION + 1 }))).toContain("versão mais nova");
    expect(errorOf(JSON.stringify({ ...base, version: 0 }))).toContain("danificado");
    expect(errorOf(JSON.stringify({ ...base, version: 1 }))).toBeNull();
    const migrated = parseSongFile(JSON.stringify({ ...base, version: 1 }));
    expect(migrated.version).toBe(CURRENT_VERSION);
  });
});

describe("campos v4 (melodia, pausas N.C. e durações curtas)", () => {
  it("ida e volta em JSON e link #s= preservando melodia, melodyEnding, melodyInstrument e N.C.", async () => {
    const song = makeSong();
    song.melodyInstrument = "flute";
    const block = Object.values(song.blocks)[0];
    block.chords = [makeChord(0, "maj", 0.25), makeRest(1.75), makeChord(7, "maj", 2)];
    block.melodyInstrument = "violin";
    block.melodyMidiChannel = 4;
    block.melody = [makeMelodyNote(64, 0, 1, 0.9), makeMelodyNote(67, 1, 0.25)];
    block.melodyEnding = [makeMelodyNote(72, 0, 2)];

    const file = toSongFile({ name: "Melodia v2", scaleId: "major", tonic: 0, song });
    expect(parseSongFile(serializeSongFile(file))).toEqual(file);
    const hash = await encodeShare(file);
    expect(await decodeShare(hash)).toEqual(file);
  });

  it("saneamento normaliza sobreposição de melodia e descarta notas inválidas", () => {
    const song = makeSong();
    const id = Object.keys(song.blocks)[0];
    const raw = structuredClone(song) as unknown as { blocks: Record<string, Record<string, unknown>> };
    raw.blocks[id].chords = [{ rest: true, duration: 0.25 }, { rest: "nao", duration: 2 }];
    raw.blocks[id].melody = [
      { id: "m1", pitch: 60, start: 0, duration: 2 },
      { id: "m2", pitch: 64, start: 1, duration: 1 },
      { id: "bad", pitch: 120, start: 2, duration: 1 },
    ];
    raw.blocks[id].melodyInstrument = "nao-existe";
    const out = sanitizeContent({ scaleId: "major", tonic: 0, song: raw })!;
    const b = out.song.blocks[id];
    expect(b.chords).toHaveLength(1);
    expect(b.chords[0].rest).toBe(true);
    expect(b.chords[0].duration).toBe(0.25);
    expect(b.melody?.map((n) => [n.id, n.start, n.duration])).toEqual([
      ["m1", 0, 1],
      ["m2", 1, 1],
    ]);
    expect(b.melodyInstrument).toBeUndefined();
  });
});

describe("campos da v2 no arquivo", () => {
  it("preserva os válidos e descarta os inválidos", () => {
    const song = makeSong();
    const id = Object.keys(song.blocks)[0];
    const raw = structuredClone(song) as unknown as { blocks: Record<string, Record<string, unknown>>; voiceLeading?: unknown; reattack?: unknown };
    Object.assign(raw.blocks[id], {
      bassInstrument: "piano",
      drone: true,
      rampTo: 20,
      key: { tonic: 2, scaleId: "dorian" },
      ending: [makeChord(7, "maj", 4), { root: 99, quality: "maj" }],
    });
    raw.voiceLeading = true;
    raw.reattack = "sim";
    const out = sanitizeContent({ scaleId: "major", tonic: 0, song: raw })!;
    const b = out.song.blocks[id];
    expect([b.bassInstrument, b.drone, b.rampTo, b.key]).toEqual(["piano", true, 30, { tonic: 2, scaleId: "dorian" }]);
    expect(b.ending!.map((c) => c.root)).toEqual([7]);
    expect(out.song.voiceLeading).toBe(true);
    expect(out.song.reattack).toBeUndefined();
    Object.assign(raw.blocks[id], { key: { tonic: 2, scaleId: "nao-existe" }, bassInstrument: "x" });
    const out2 = sanitizeContent({ scaleId: "major", tonic: 0, song: raw })!;
    expect([out2.song.blocks[id].key, out2.song.blocks[id].bassInstrument]).toEqual([undefined, undefined]);
  });
});
