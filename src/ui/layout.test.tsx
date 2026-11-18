// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../audio/engine", () => ({
  play: vi.fn(async () => {}),
  stop: vi.fn(),
  previewNotes: vi.fn(async () => {}),
  preload: vi.fn(),
  subscribeStatus: () => () => {},
  instrumentStatus: () => "ready",
  instrumentProgress: () => null,
  liveNoteOn: vi.fn(),
  liveNoteOff: vi.fn(),
  liveAllOff: vi.fn(),
}));

import { expandArrangement, makeSong } from "../core/song";
import { LocalSongRepository } from "../state/repository";
import { selectBlock, useStore } from "../state/store";
import { MiniDock } from "./Layout/Dock";
import { TopBar } from "./Layout/TopBar";

beforeEach(() => {
  useStore.getState().newSong();
  useStore.getState().setTonic(0);
  useStore.setState({ topBar: "pinned", dock: "full", playing: false, playhead: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const panel = () => document.querySelector(".top-panel") as HTMLElement;

describe("TopBar", () => {
  it("fixo: controles visíveis; recolher vira automático com a faixa compacta", () => {
    render(<TopBar />);
    expect(panel().hasAttribute("inert")).toBe(false);
    expect(screen.queryByRole("toolbar", { name: "Barra compacta" })).toBeNull();
    fireEvent.click(screen.getByLabelText("Recolher o topo"));
    expect(useStore.getState().topBar).toBe("auto");
    expect(screen.getByRole("toolbar", { name: "Barra compacta" })).toBeTruthy();
    expect(panel().hasAttribute("inert")).toBe(true);
  });

  it("automático: passar o mouse abre; sair fecha depois de um instante", () => {
    vi.useFakeTimers();
    useStore.setState({ topBar: "auto" });
    render(<TopBar />);
    const bar = document.querySelector(".topbar") as HTMLElement;
    fireEvent.mouseEnter(bar);
    expect(panel().hasAttribute("inert")).toBe(false);
    fireEvent.mouseLeave(bar);
    expect(panel().hasAttribute("inert")).toBe(false);
    act(() => void vi.advanceTimersByTime(400));
    expect(panel().hasAttribute("inert")).toBe(true);
  });

  it("automático: “Mostrar controles” mantém aberto ao sair o mouse; Esc e clique fora fecham", () => {
    vi.useFakeTimers();
    useStore.setState({ topBar: "auto" });
    render(<TopBar />);
    const bar = document.querySelector(".topbar") as HTMLElement;
    fireEvent.click(screen.getByRole("button", { name: "▾ Mostrar controles" }));
    fireEvent.mouseLeave(bar);
    act(() => void vi.advanceTimersByTime(1000));
    expect(panel().hasAttribute("inert")).toBe(false);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(panel().hasAttribute("inert")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "▾ Mostrar controles" }));
    expect(panel().hasAttribute("inert")).toBe(false);
    fireEvent.pointerDown(document.body);
    expect(panel().hasAttribute("inert")).toBe(true);
  });

  it("Esc já tratado por um popover interno não fecha o topo", () => {
    useStore.setState({ topBar: "auto" });
    render(<TopBar />);
    fireEvent.click(screen.getByRole("button", { name: "▾ Mostrar controles" }));
    const onDoc = (e: KeyboardEvent) => e.preventDefault();
    document.addEventListener("keydown", onDoc);
    fireEvent.keyDown(document.body, { key: "Escape" });
    document.removeEventListener("keydown", onDoc);
    expect(panel().hasAttribute("inert")).toBe(false);
  });

  it("o foco não se perde ao trocar de modo nem ao fechar com Esc", () => {
    render(<TopBar />);
    fireEvent.click(screen.getByLabelText("Recolher o topo"));
    const show = screen.getByRole("button", { name: "▾ Mostrar controles" });
    expect(document.activeElement).toBe(show);
    fireEvent.click(show);
    (screen.getByRole("button", { name: "⟲ Loop" }) as HTMLElement).focus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.activeElement?.textContent).toContain("Mostrar controles");
    fireEvent.click(screen.getByRole("button", { name: "📌 Fixar" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Recolher o topo"));
  });

  it("Fixar volta ao modo fixo", () => {
    useStore.setState({ topBar: "auto" });
    render(<TopBar />);
    fireEvent.click(screen.getByRole("button", { name: "📌 Fixar" }));
    expect(useStore.getState().topBar).toBe("pinned");
  });
});

describe("MiniDock", () => {
  // Definir a tônica já pôs o acorde I no bloco vazio: C, Am, F, G.
  const addChords = () => {
    const s = useStore.getState();
    for (const root of [9, 5, 7]) s.addChord(root, root === 9 ? "m" : "maj");
  };

  it("mostra os blocos e os acordes do bloco selecionado; clicar seleciona o acorde", () => {
    addChords();
    render(<MiniDock />);
    expect(screen.getByRole("group", { name: "Blocos do arranjo" }).textContent).toContain("Verso A");
    const chips = Array.from(document.querySelectorAll<HTMLButtonElement>(".mini-chord"));
    expect(chips.map((c) => c.textContent)).toEqual(["C", "Am", "F", "G"]);
    fireEvent.click(chips[2]);
    expect(useStore.getState().selectedChord).toBe(selectBlock(useStore.getState())!.chords[2].id);
  });

  it("destaca o bloco e o acorde que estão tocando", () => {
    addChords();
    render(<MiniDock />);
    act(() => useStore.setState({ playing: true, playhead: { itemIndex: 0, chordIndex: 1, eventIndex: 1 } }));
    const playing = document.querySelector(".mini-chord.playing");
    expect(playing?.textContent).toBe("Am");
    expect(playing?.getAttribute("aria-current")).toBe("true");
    expect(document.querySelector(".mini-block.playing")?.textContent).toContain("Verso A");
  });

  it("acorde da casa 2 tocando: clicar passa a progressão para a casa 2 e seleciona o acorde", () => {
    addChords();
    const s = useStore.getState();
    s.setRepeat(0, 2);
    s.setEditEnding(true);
    s.addChord(2, "m");
    s.setEditEnding(false);
    const st = useStore.getState();
    const ending = selectBlock(st)!.ending!;
    const events = expandArrangement(st.song).events;
    const eventIndex = events.findIndex((e) => e.inEnding);
    render(<MiniDock />);
    act(() => useStore.setState({ playing: true, playhead: { itemIndex: 0, chordIndex: 0, eventIndex } }));
    const chip = document.querySelector(".mini-chord.playing") as HTMLButtonElement;
    expect(chip.textContent).toBe("Dm");
    fireEvent.click(chip);
    expect(useStore.getState().editEnding).toBe(true);
    expect(useStore.getState().selectedChord).toBe(ending[0].id);
  });

  it("Expandir volta ao painel completo", () => {
    useStore.setState({ dock: "compact" });
    render(<MiniDock />);
    fireEvent.click(screen.getByRole("button", { name: "▴ Expandir" }));
    expect(useStore.getState().dock).toBe("full");
  });
});

describe("preferências de layout na sessão", () => {
  it("topBar/dock fazem ida e volta; valores inválidos viram o padrão", () => {
    localStorage.clear();
    const repo = new LocalSongRepository();
    const base = { version: 1, scaleId: "major", tonic: 0, accidentals: "auto", mode: "colorful", startWithSelected: false, soundOnClick: true, metronome: false, followScale: false, song: makeSong() };
    localStorage.setItem("chordplanner:session", JSON.stringify({ ...base, topBar: "auto", dock: "compact" }));
    expect(repo.loadSession()).toMatchObject({ topBar: "auto", dock: "compact" });
    localStorage.setItem("chordplanner:session", JSON.stringify({ ...base, topBar: "x", dock: 3 }));
    expect(repo.loadSession()).toMatchObject({ topBar: "pinned", dock: "full" });
  });
});
