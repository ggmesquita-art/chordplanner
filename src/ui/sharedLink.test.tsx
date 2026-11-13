// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../audio/engine", () => ({
  play: vi.fn(async () => {}),
  stop: vi.fn(),
  previewNotes: vi.fn(async () => {}),
  preload: vi.fn(),
  subscribeStatus: () => () => {},
  instrumentStatus: () => "ready",
}));

import { encodeShare } from "../export/url";
import { useStore } from "../state/store";
import { currentSongFile } from "./fileActions";
import { SharedLink } from "./SharedLink";

beforeEach(() => {
  useStore.getState().newSong();
  history.replaceState(null, "", "/");
});
afterEach(cleanup);

const makeHash = async () => {
  const st = useStore.getState();
  st.setTonic(7);
  st.renameSong("Do link");
  const hash = await encodeShare(currentSongFile());
  st.newSong();
  return hash;
};

describe("SharedLink", () => {
  it("carrega a música do link e limpa o hash", async () => {
    location.hash = await makeHash();
    render(<SharedLink />);
    await waitFor(() => expect(useStore.getState().songName).toBe("Do link"));
    expect(useStore.getState().songId).toBeNull();
    expect(location.hash).toBe("");
  });

  it("com alterações não salvas pergunta; Cancelar mantém a atual", async () => {
    const hash = await makeHash();
    useStore.getState().renameSong("Atual");
    useStore.getState().setTonic(2);
    location.hash = hash;
    render(<SharedLink />);
    const dlg = await screen.findByRole("alertdialog");
    expect(dlg.textContent).toContain("Do link");
    fireEvent.click(screen.getByText("Cancelar"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(useStore.getState().songName).toBe("Atual");
    expect(location.hash).toBe("");
  });

  it("hash inválido mostra aviso", async () => {
    location.hash = "#s=1.xxxx";
    render(<SharedLink />);
    expect((await screen.findByRole("alert")).textContent).toContain("inválido");
    expect(location.hash).toBe("");
  });
});
