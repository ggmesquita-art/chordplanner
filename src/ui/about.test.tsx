// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AboutButton } from "./About";

afterEach(cleanup);

describe("About", () => {
  it("abre com o criador e os links; Esc fecha e devolve o foco ao botão", () => {
    render(<AboutButton />);
    const btn = screen.getByRole("button", { name: "About" });
    fireEvent.click(btn);
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Guilherme Mesquita");
    expect(dialog.textContent).toContain("THE MESQUITA DJ");
    const hrefs = within(dialog)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([
      "mailto:ggmesquita@gmail.com",
      "https://github.com/ggmesquita-art/chordplanner",
      "https://linktr.ee/themesquita",
      "https://soundcloud.com/themesquita",
    ]);
    // Links externos abrem fora (nova aba / navegador do sistema no desktop).
    expect(within(dialog).getAllByRole("link").slice(1).every((a) => a.getAttribute("target") === "_blank" && a.getAttribute("rel")?.includes("noopener"))).toBe(true);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(btn);
  });
});
