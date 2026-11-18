// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

vi.mock("../audio/engine", () => ({
  play: vi.fn(async () => {}),
  stop: vi.fn(),
  previewNotes: vi.fn(async () => {}),
  preload: vi.fn(),
  subscribeStatus: () => () => {},
  instrumentStatus: () => "ready",
  instrumentProgress: () => null,
}));

import App from "../App";
import { useStore } from "../state/store";
import { selectBlock } from "../state/store";

describe("App (fumaça)", () => {
  it("renderiza, define tônica pela roda, adiciona acordes e aplica modificadores", async () => {
    render(<App />);
    expect(screen.getByText("escolha a tônica")).toBeTruthy();

    // Clicar na fatia de Ré maior define a tônica.
    const d = screen.getAllByRole("button").find((el) => el.getAttribute("aria-label")?.startsWith("Ré maior"))!;
    await act(async () => fireEvent.click(d));
    expect(useStore.getState().tonic).toBe(2);
    expect(selectBlock(useStore.getState())!.chords.length).toBe(1);

    // Adicionar Sol maior (IV) e Lá maior (V).
    for (const name of ["Sol maior", "Lá maior"]) {
      const el = screen.getAllByRole("button").find((b) => b.getAttribute("aria-label")?.startsWith(name))!;
      await act(async () => fireEvent.click(el));
    }
    const chords = selectBlock(useStore.getState())!.chords;
    expect(chords.map((c) => c.root)).toEqual([2, 7, 9]);

    // Colorido libera diatônicos + cromáticos idiomáticos (V/x, empréstimos de modos com a mesma
    // tônica, ii/x e subV — 18 em Ré maior); Estrito só diatônicos; Livre tudo.
    const enabled = () => screen.getAllByRole("button").filter((b) => b.classList.contains("slice") && b.getAttribute("aria-disabled") === "false");
    expect(enabled().length).toBe(25);
    const fs = screen.getAllByRole("button").find((b) => b.getAttribute("aria-label")?.startsWith("Fá sustenido maior"))!;
    expect(fs.getAttribute("aria-label")).toContain("V/vi");
    const gs = screen.getAllByRole("button").find((b) => b.getAttribute("aria-label")?.startsWith("Sol sustenido maior"))!;
    expect(gs.getAttribute("aria-disabled")).toBe("true");
    await act(async () => useStore.getState().setMode("strict"));
    expect(enabled().length).toBe(7);
    expect(document.querySelector(".wheel-hint")!.textContent).toContain("Colorido libera +18");
    await act(async () => useStore.getState().setMode("free"));
    expect(enabled().length).toBe(36);
    await act(async () => useStore.getState().setMode("colorful"));

    // Modificador 7 no acorde selecionado (A → A7).
    const seven = screen.getAllByRole("button", { pressed: false }).find((b) => b.textContent?.trim().endsWith("7") && b.textContent.includes("✓") && !b.textContent.includes("maj"))!;
    await act(async () => fireEvent.click(seven));
    expect(screen.getAllByText("A7").length).toBeGreaterThan(0);

    // Novo bloco + template + export.
    await act(async () => fireEvent.click(screen.getByLabelText("Novo bloco")));
    expect(useStore.getState().song.arrangement.length).toBe(2);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "⤓ Exportar ▾" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Cifra \(texto\)/ })));
    expect((screen.getByRole("dialog").querySelector("textarea") as HTMLTextAreaElement).value).toContain("A7");
  });

  it("salvar, novo (com confirmação) e abrir pela interface", async () => {
    useStore.getState().newSong();
    render(<App />);
    await act(async () => useStore.getState().setTonic(7));
    fireEvent.change(screen.getByLabelText("Nome da música"), { target: { value: "Teste G" } });
    await act(async () => fireEvent.click(screen.getByTitle("Salvar (Ctrl+S)")));
    expect(useStore.getState().savedSongs[0].name).toBe("Teste G");

    await act(async () => useStore.getState().addChord(0, "maj"));
    await act(async () => fireEvent.click(screen.getByTitle("Nova música")));
    expect(screen.getByRole("alertdialog").textContent).toContain("não salvas");
    await act(async () => fireEvent.click(screen.getByText("Descartar")));
    expect(useStore.getState().tonic).toBeNull();

    await act(async () => fireEvent.click(screen.getByText("Abrir ▾")));
    await act(async () => fireEvent.click(screen.getByText("Teste G")));
    expect(useStore.getState().tonic).toBe(7);
    expect(useStore.getState().songName).toBe("Teste G");
  });
});
