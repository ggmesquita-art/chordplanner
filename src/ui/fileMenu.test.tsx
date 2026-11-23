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

import { serializeSongFile } from "../export/json";
import { repository } from "../state/repository";
import { selectBlock, useStore } from "../state/store";
import { currentSongFile } from "./fileActions";
import { FileMenu } from "./FileMenu/FileMenu";

beforeEach(() => useStore.getState().newSong());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const importFile = async (content: string) => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([content], "x.json", { type: "application/json" });
  await act(async () => fireEvent.change(input, { target: { files: [file] } }));
};

describe("FileMenu", () => {
  it("falha ao salvar mostra alerta e não mostra Salvo", async () => {
    vi.spyOn(repository, "saveSong").mockReturnValue(false);
    render(<FileMenu />);
    await act(async () => fireEvent.click(screen.getByTitle("Salvar (Ctrl+S)")));
    expect(screen.getByRole("alert").textContent).toContain("Não foi possível salvar");
    expect(screen.queryByText("✓ Salvo")).toBeNull();
    expect(screen.getByText("⚠ Não salvou")).toBeTruthy();
  });

  it("falha ao renomear música já salva mostra o alerta de salvamento", async () => {
    useStore.getState().renameSong("Salva");
    expect(useStore.getState().saveSong()).toBe(true);
    vi.spyOn(repository, "saveSong").mockReturnValue(false);
    render(<FileMenu />);
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => fireEvent.change(screen.getByLabelText("Nome da música"), { target: { value: "Salvaa" } }));
    expect(screen.getByRole("alert").textContent).toContain("Não foi possível salvar");
  });

  it("importa um arquivo válido como música nova", async () => {
    const st = useStore.getState();
    st.setTonic(7);
    st.addChord(7, "maj");
    st.addChord(0, "maj");
    st.renameSong("Importada");
    const text = serializeSongFile(currentSongFile());
    st.newSong();
    render(<FileMenu />);
    await act(async () => fireEvent.click(screen.getByText("Abrir ▾")));
    await importFile(text);
    const s = useStore.getState();
    expect(s.songName).toBe("Importada");
    expect(s.songId).toBeNull();
    expect(selectBlock(s)!.chords.map((c) => c.root)).toEqual([7, 0]);
  });

  it("arquivo inválido mostra o erro e não altera a música", async () => {
    useStore.getState().renameSong("Original");
    render(<FileMenu />);
    await act(async () => fireEvent.click(screen.getByText("Abrir ▾")));
    await importFile("lixo");
    expect(screen.getByRole("alert").textContent?.length).toBeGreaterThan(0);
    expect(useStore.getState().songName).toBe("Original");
  });

  it("menu Abrir usa lista simples, sem botão dentro de role=option", async () => {
    useStore.getState().renameSong("Minha");
    expect(useStore.getState().saveSong()).toBe(true);
    render(<FileMenu />);
    await act(async () => fireEvent.click(screen.getByText("Abrir ▾")));
    expect(document.querySelectorAll('[role="option"] button').length).toBe(0);
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
    const open = screen.getByText("Minha").closest("button")!;
    expect(open.getAttribute("aria-current")).toBe("true");
  });
});
