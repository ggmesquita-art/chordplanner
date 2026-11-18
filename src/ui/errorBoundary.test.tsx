// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

import { ErrorBoundary } from "./ErrorBoundary";

afterEach(cleanup);

function Boom(): never {
  throw new Error("explodiu");
}

describe("ErrorBoundary", () => {
  it("mostra a tela de erro quando um filho lança", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Algo deu errado")).toBeTruthy();
    expect(screen.getByText("explodiu")).toBeTruthy();
    vi.restoreAllMocks();
  });
});
