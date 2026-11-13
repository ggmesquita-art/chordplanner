// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeSong } from "../core/song";
import { LocalSongRepository, type Session } from "./repository";

const session = (over: Partial<Session> = {}): Session => ({
  version: 1,
  scaleId: "major",
  tonic: 0,
  accidentals: "auto",
  mode: "colorful",
  startWithSelected: false,
  soundOnClick: true,
  metronome: false,
  followScale: false,
  song: makeSong(),
  ...over,
});

describe("LocalSongRepository", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("sessão válida faz ida e volta; campos simples inválidos viram padrão", () => {
    const repo = new LocalSongRepository();
    localStorage.setItem("chordplanner:session", JSON.stringify({ ...session(), mode: "x", metronome: "sim" }));
    const s = repo.loadSession()!;
    expect(s.mode).toBe("colorful");
    expect(s.metronome).toBe(false);
  });

  it("sessão com scaleId inexistente é descartada", () => {
    const repo = new LocalSongRepository();
    localStorage.setItem("chordplanner:session", JSON.stringify(session({ scaleId: "nao-existe" })));
    expect(repo.loadSession()).toBeNull();
  });

  it("JSON de músicas corrompido: lista vazia e cópia preservada", () => {
    const repo = new LocalSongRepository();
    localStorage.setItem("chordplanner:songs", "{quebrado");
    expect(repo.listSongs()).toEqual([]);
    expect(localStorage.getItem("chordplanner:songs.corrompido")).toBe("{quebrado");
  });

  it("saveSong devolve false quando setItem lança", () => {
    const repo = new LocalSongRepository();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("cota");
    });
    expect(repo.saveSong({ id: "a", name: "A", updatedAt: 1, scaleId: "major", tonic: 0, song: makeSong() })).toBe(false);
    expect(repo.saveSession(session())).toBe(false);
  });

  it("a primeira cópia do JSON corrompido não é sobrescrita por uma corrupção posterior", () => {
    const repo = new LocalSongRepository();
    localStorage.setItem("chordplanner:songs", "{primeira");
    repo.listSongs();
    localStorage.setItem("chordplanner:songs", "{segunda");
    repo.listSongs();
    expect(localStorage.getItem("chordplanner:songs.corrompido")).toBe("{primeira");
  });

  it("lista de músicas com metadados adulterados não quebra: campos coagidos, escala desconhecida fica de fora", () => {
    const repo = new LocalSongRepository();
    localStorage.setItem(
      "chordplanner:songs",
      JSON.stringify({
        a: { id: "a", name: { x: 1 }, updatedAt: "ontem", scaleId: "major", tonic: 99, song: makeSong() },
        b: { id: "b", name: "Outra", updatedAt: 5, scaleId: "nao-existe", tonic: 0, song: makeSong() },
        c: "lixo",
      }),
    );
    expect(repo.listSongs()).toEqual([{ id: "a", name: "Sem título", updatedAt: 0, scaleId: "major", tonic: null }]);
  });
});
