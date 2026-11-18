// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../audio/engine", () => ({
  play: vi.fn(async () => {}),
  stop: vi.fn(),
  previewNotes: vi.fn(async () => {}),
  preload: vi.fn(),
  subscribeStatus: () => () => {},
  instrumentStatus: () => "ready",
  instrumentProgress: () => null,
  disposeInstrument: vi.fn(),
}));

// `discardSession` muda estado de módulo para sempre: aqui ele é um espião; a versão real só é
// exercitada no último `describe`, num grafo de módulos novo (vi.resetModules + importActual).
vi.mock("../state/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../state/store")>();
  return { ...actual, discardSession: vi.fn() };
});

import { encodeShare } from "../export/url";
import { repository } from "../state/repository";
import { discardSession, selectBlock, useStore } from "../state/store";
import { ErrorBoundary } from "./ErrorBoundary";
import { currentSongFile } from "./fileActions";
import { FileMenu } from "./FileMenu/FileMenu";
import { useSessionGuard } from "./hooks";
import { SharedLink } from "./SharedLink";

const chordsOf = () => selectBlock(useStore.getState())!.chords.map((c) => [c.root, c.quality]);

/** Música com alterações não salvas: tônica Sol + um acorde a mais. */
const makeDirty = () => {
  const st = useStore.getState();
  st.newSong();
  st.setTonic(7);
  st.addChord(0, "maj");
};

beforeEach(() => {
  useStore.getState().newSong();
  history.replaceState(null, "", "/");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "visibilityState");
});

function Guard() {
  useSessionGuard();
  return null;
}

describe("useSessionGuard", () => {
  const setVisibility = (v: "hidden" | "visible") => Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v });

  it("pagehide grava a sessão na hora", () => {
    const save = vi.spyOn(repository, "saveSession").mockReturnValue(true);
    render(<Guard />);
    window.dispatchEvent(new Event("pagehide"));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("visibilitychange grava só quando a página fica oculta", () => {
    const save = vi.spyOn(repository, "saveSession").mockReturnValue(true);
    render(<Guard />);
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(save).not.toHaveBeenCalled();
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("beforeunload com a sessão sendo persistida não bloqueia, mesmo com música suja", () => {
    makeDirty();
    vi.spyOn(repository, "saveSession").mockReturnValue(true);
    render(<Guard />);
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });

  it("beforeunload com o repositório falhando e música suja pede confirmação", () => {
    makeDirty();
    const save = vi.spyOn(repository, "saveSession").mockReturnValue(false);
    render(<Guard />);
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    expect(save).toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
  });

  it("beforeunload com o repositório falhando mas sem alterações não bloqueia", () => {
    vi.spyOn(repository, "saveSession").mockReturnValue(false);
    render(<Guard />);
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });
});

describe("Salvar e abrir (link compartilhado) quando o salvamento falha", () => {
  it("mostra o erro, mantém o diálogo e não troca a música", async () => {
    const st = useStore.getState();
    st.setTonic(2);
    st.renameSong("Do link");
    const hash = await encodeShare(currentSongFile());
    makeDirty();
    st.renameSong("Atual");
    const before = chordsOf();
    vi.spyOn(repository, "saveSong").mockReturnValue(false);

    location.hash = hash;
    render(<SharedLink />);
    const dlg = await screen.findByRole("alertdialog");
    await act(async () => fireEvent.click(within(dlg).getByText("Salvar e abrir")));

    expect(within(screen.getByRole("alertdialog")).getByRole("alert").textContent).toContain("Não foi possível salvar");
    expect(useStore.getState().songName).toBe("Atual");
    expect(useStore.getState().tonic).toBe(7);
    expect(chordsOf()).toEqual(before);
  });
});

describe("Salvar e continuar (menu Arquivo) quando o salvamento falha", () => {
  it("mantém a música atual e mostra o alerta", async () => {
    makeDirty();
    const before = chordsOf();
    vi.spyOn(repository, "saveSong").mockReturnValue(false);
    render(<FileMenu />);

    await act(async () => fireEvent.click(screen.getByTitle("Nova música")));
    expect(screen.getByRole("alertdialog").textContent).toContain("não salvas");
    await act(async () => fireEvent.click(screen.getByText("Salvar e continuar")));

    expect(chordsOf()).toEqual(before);
    expect(useStore.getState().tonic).toBe(7);
    expect(screen.getAllByRole("alert").some((a) => a.textContent?.includes("Não foi possível salvar"))).toBe(true);
  });
});

describe("ErrorBoundary: descartar a sessão", () => {
  function Boom(): never {
    throw new Error("explodiu");
  }

  it("exige o segundo clique; então descarta e recarrega", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    vi.mocked(discardSession).mockClear();

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByText("Descartar a sessão e recomeçar"));
    expect(discardSession).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Confirmar: descartar a sessão atual"));
    expect(discardSession).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

// ATENÇÃO: por último e isolado. A versão real de `discardSession` desliga a gravação para sempre
// no módulo em que roda; por isso usa um grafo de módulos novo e descartável.
describe("discardSession (real)", () => {
  afterEach(() => vi.useRealTimers());

  it("limpa a sessão guardada e depois disso mudanças no store não voltam a gravá-la", async () => {
    vi.resetModules();
    const { repository: repo } = await import("../state/repository");
    const store = await vi.importActual<typeof import("../state/store")>("../state/store");
    const save = vi.spyOn(repo, "saveSession").mockReturnValue(true);
    const clear = vi.spyOn(repo, "clearSession").mockImplementation(() => {});
    vi.useFakeTimers();

    // Sanidade: antes de descartar, a mudança é gravada após o debounce de 300 ms.
    store.useStore.getState().setTonic(2);
    vi.advanceTimersByTime(299);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);

    // Mudança pendente no debounce + descarte: o timer pendente é cancelado.
    save.mockClear();
    store.useStore.getState().setTonic(4);
    store.discardSession();
    expect(clear).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(save).not.toHaveBeenCalled();

    // Novas mudanças e flush explícito também não gravam.
    store.useStore.getState().addChord(4, "m");
    vi.advanceTimersByTime(1000);
    store.flushSession();
    expect(save).not.toHaveBeenCalled();
    expect(store.sessionAtRisk()).toBe(false);
  });
});
