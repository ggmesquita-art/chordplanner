import { describe, expect, it } from "vitest";
import { makeChord } from "../core/chords";
import { makeSpeller, pcName } from "../core/pitch";
import { getScale, pitchSet } from "../core/scales";
import { makeSong } from "../core/song";
import { songToText } from "./text";

const sharp = (pc: number) => pcName(pc, false);

function setup() {
  const song = makeSong();
  const block = song.blocks[song.arrangement[0].blockId];
  block.chords = [makeChord(0, "maj", 4), makeChord(5, "maj", 4), makeChord(7, "maj", 4), makeChord(0, "maj", 4)];
  return { song, block };
}

describe("songToText", () => {
  it("casa 2 com ×2 sai em notação de repetição", () => {
    const { song, block } = setup();
    song.arrangement[0].repeat = 2;
    block.ending = [makeChord(9, "m", 4)];
    expect(songToText(song, () => sharp)).toBe("[Verso A ×2]  4/4 ♩=90\n|: C | F | G | 1. C :| 2. Am |");
  });

  it("casa 2 é ignorada com ×1", () => {
    const { song, block } = setup();
    block.ending = [makeChord(9, "m", 4)];
    expect(songToText(song, () => sharp)).toBe("[Verso A]  4/4 ♩=90\n| C | F | G | C |");
  });

  it("tom próprio do bloco aparece no cabeçalho", () => {
    const { song, block } = setup();
    block.key = { tonic: 4, scaleId: "dorian" };
    expect(songToText(song, () => sharp).split("\n")[0]).toBe("[Verso A]  4/4 ♩=90  (E dórico)");
  });

  it("a grafia é por bloco", () => {
    const { song, block } = setup();
    block.chords = [makeChord(10, "maj", 4)];
    block.key = { tonic: 3, scaleId: "major" };
    const spellFor = (b: typeof block) => (b.key ? makeSpeller(b.key.tonic, pitchSet(b.key.tonic, getScale(b.key.scaleId)), "auto") : sharp);
    expect(songToText(song, spellFor)).toContain("| B♭ |");
    expect(songToText(song, () => sharp)).toContain("| A♯ |");
  });
});
