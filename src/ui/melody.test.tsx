// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPreviewNotes } = vi.hoisted(() => ({
  mockPreviewNotes: vi.fn(async () => {}),
}));

vi.mock("../audio/engine", () => ({
  play: vi.fn(async () => {}),
  stop: vi.fn(),
  previewNotes: mockPreviewNotes,
  preload: vi.fn(),
  subscribeStatus: () => () => {},
  instrumentStatus: () => "ready",
  instrumentProgress: () => null,
  liveNoteOn: vi.fn(),
  liveNoteOff: vi.fn(),
  liveAllOff: vi.fn(),
}));

import { makeChord, makeRest } from "../core/chords";
import { makeMelodyNote, MELODY_MAX_MIDI, MELODY_MIN_MIDI, scalePitchesInRange } from "../core/melody";
import { scaleContext } from "../core/diatonic";
import { selectBlock, useStore } from "../state/store";
import { ChordWheel, DegreeStrip } from "./ChordWheel/ChordWheel";
import { Dock } from "./Layout/Dock";
import { MelodyTrack } from "./Melody/MelodyTrack";
import { compactMelodyRows, fitPxPerBeat, LANE_GUTTER_PX, MELODY_COMPACT_ROW_H, MELODY_ROW_H } from "./Melody/timelineLayout";

const currentMelody = () => selectBlock(useStore.getState())!.melody ?? [];

beforeEach(() => {
  mockPreviewNotes.mockClear();
  const s = useStore.getState();
  s.newSong();
  s.setTonic(0);
  s.setScale("major");
  s.setMode("strict");
  s.setMelodyGrid(0.5);
  s.setMelodyVisible(true);
  useStore.setState({
    dockPanels: { arrangement: true, melody: true, progression: true },
    melodyCompact: false,
  });
});

afterEach(cleanup);

describe("MelodyTrack (Camada 2)", () => {
  it("modo Estrito dobra a grade para notas da escala; Colorido mostra cromático", () => {
    const { container } = render(<MelodyTrack />);
    const strictRows = scalePitchesInRange(scaleContext(0, "major"), MELODY_MIN_MIDI, MELODY_MAX_MIDI);
    expect(container.querySelectorAll(".melody-axis-row")).toHaveLength(strictRows.length);

    act(() => useStore.getState().setMode("colorful"));
    expect(container.querySelectorAll(".melody-axis-row")).toHaveLength(MELODY_MAX_MIDI - MELODY_MIN_MIDI + 1);
  });

  it("clicar na grade insere nota na batida quantizada e toca preview na pista melodia", () => {
    render(<MelodyTrack />);
    const strictRows = scalePitchesInRange(scaleContext(0, "major"), MELODY_MIN_MIDI, MELODY_MAX_MIDI);
    const c5RowIdx = strictRows.indexOf(72);
    expect(c5RowIdx).toBeGreaterThanOrEqual(0);

    const canvas = screen.getByTestId("melody-canvas");
    canvas.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 896,
        height: strictRows.length * MELODY_ROW_H,
      }) as DOMRect;

    // 1.5 tempos em pxPerBeat=56 -> 84px (snapped to 1.5 com melodyGrid=0.5)
    fireEvent.click(canvas, { clientX: 88, clientY: c5RowIdx * MELODY_ROW_H + 5 });
    expect(currentMelody()).toHaveLength(1);
    expect(currentMelody()[0]).toMatchObject({ pitch: 72, start: 1.5, duration: 0.5 });
    expect(mockPreviewNotes).toHaveBeenCalledWith([72], expect.any(String), { seconds: 0.35, track: "melody" });
  });

  it("navegação por teclado move grau (Estrito), desloca início/duração e Delete remove", () => {
    act(() => {
      useStore.getState().upsertMelodyNote({ pitch: 60, start: 1, duration: 1 });
    });
    render(<MelodyTrack />);
    const noteBtn = screen.getByRole("button", { name: /^Nota C4/ });
    noteBtn.focus();

    // Sobe 1 linha no modo Estrito: C4 (60) -> D4 (62)
    fireEvent.keyDown(noteBtn, { key: "ArrowUp" });
    expect(currentMelody()[0].pitch).toBe(62);

    // Move para a direita pela grade da melodia (0.5): 1 -> 1.5
    fireEvent.keyDown(noteBtn, { key: "ArrowRight" });
    expect(currentMelody()[0].start).toBe(1.5);

    // Shift+Seta direita aumenta duração pela grade (0.5): 1 -> 1.5
    fireEvent.keyDown(noteBtn, { key: "ArrowRight", shiftKey: true });
    expect(currentMelody()[0].duration).toBe(1.5);

    // Delete remove a nota
    fireEvent.keyDown(noteBtn, { key: "Delete" });
    expect(currentMelody()).toHaveLength(0);
  });

  it("clique direito remove nota e mudar de escala exibe 'Ajustar à escala'", () => {
    act(() => {
      // E4 (64) pertence a C maior, mas está fora de C menor natural
      const b = selectBlock(useStore.getState())!;
      useStore.getState().setBlockProps(b.id, {});
      useStore.getState().upsertMelodyNote(makeMelodyNote(64, 0, 1));
    });
    render(<MelodyTrack />);
    expect(screen.queryByRole("button", { name: /Ajustar à escala/ })).toBeNull();

    act(() => useStore.getState().setScale("minor"));
    const adjustBtn = screen.getByRole("button", { name: /Ajustar à escala \(1\)/ });
    fireEvent.click(adjustBtn);
    expect(currentMelody()[0].pitch).toBe(63); // Eb4

    const noteBtn = screen.getByRole("button", { name: /^Nota / });
    fireEvent.contextMenu(noteBtn);
    expect(currentMelody()).toHaveLength(0);
  });

  it("controles M / S / Volume de melodia atualizam mixer.melody no store", () => {
    render(<MelodyTrack />);
    fireEvent.click(screen.getByRole("button", { name: "Silenciar Melodia" }));
    expect(useStore.getState().mixer.melody.muted).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Solo Melodia" }));
    expect(useStore.getState().mixer.melody.solo).toBe(true);
    fireEvent.change(screen.getByRole("slider", { name: "Volume de Melodia" }), { target: { value: "0.45" } });
    expect(useStore.getState().mixer.melody.volume).toBeCloseTo(0.45);
  });
});

describe("Dock com 3 camadas alinhadas", () => {
  it("exibe Arranjo, Melodia e Progressão e permite alternar a visibilidade da melodia", () => {
    render(<Dock />);
    expect(screen.getByRole("region", { name: "Arranjo" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Melodia" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Progressão" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /🎵 Melodia/ }));
    expect(useStore.getState().melodyVisible).toBe(false);
    expect(screen.queryByRole("region", { name: "Melodia" })).toBeNull();
  });

  it("zoom +/- escala largura de melodia e acordes juntos e scroll horizontal é acoplado", () => {
    act(() => {
      const c = useStore.getState().addChord(0, "maj")!;
      useStore.getState().setDuration(c.id, 2);
      useStore.getState().upsertMelodyNote({ pitch: 64, start: 0, duration: 2 });
    });
    const { container } = render(<Dock />);

    const canvas = screen.getByTestId("melody-canvas");
    const chordCard = container.querySelector(".chord-card") as HTMLElement;
    const widthBefore = chordCard.style.width;
    const canvasWidthBefore = canvas.style.width;
    expect(widthBefore).toBe("112px"); // 2 * 56

    fireEvent.click(screen.getByRole("button", { name: "Aumentar zoom da linha do tempo" }));
    expect(chordCard.style.width).toBe("152px"); // 2 * 76
    expect(canvas.style.width).not.toBe(canvasWidthBefore);

    const melodyScroll = container.querySelector(".melody-scroll") as HTMLDivElement;
    const timelineScroll = container.querySelector(".timeline-scroll") as HTMLDivElement;
    melodyScroll.scrollLeft = 180;
    fireEvent.scroll(melodyScroll);
    expect(timelineScroll.scrollLeft).toBe(180);

    timelineScroll.scrollLeft = 60;
    fireEvent.scroll(timelineScroll);
    expect(melodyScroll.scrollLeft).toBe(60);
  });

  it("fitPxPerBeat só reduz quando o conteúdo excede a largura visível", () => {
    // 16 tempos * 56 = 896 <= (1000 - 52 = 948) -> mantém 56
    expect(fitPxPerBeat(56, 16, 1000, LANE_GUTTER_PX, true)).toBe(56);
    // 32 tempos * 56 = 1792 > (852 - 52 = 800) -> ajusta para 800 / 32 = 25
    expect(fitPxPerBeat(56, 32, 852, LANE_GUTTER_PX, true)).toBe(25);
    // Desligado -> mantém 56 mesmo excedendo
    expect(fitPxPerBeat(56, 32, 852, LANE_GUTTER_PX, false)).toBe(56);
  });

  it("checkbox Ajustar na área visível ajusta melodia e acordes para caber sem scroll horizontal", () => {
    act(() => {
      useStore.getState().setTimelineFit(false);
      // 8 compassos (32 tempos) + padding -> 36 tempos * 56px = 2016px
      useStore.getState().setBlockChords(Array.from({ length: 8 }, () => makeChord(0, "maj", 4)));
      useStore.getState().upsertMelodyNote({ pitch: 64, start: 0, duration: 4 });
    });

    const { container } = render(<Dock />);
    const melodyScroll = container.querySelector(".melody-scroll") as HTMLDivElement;
    const timelineScroll = container.querySelector(".timeline-scroll") as HTMLDivElement;
    Object.defineProperty(melodyScroll, "clientWidth", { configurable: true, value: 772 }); // 720px disponíveis + 52px gutter
    Object.defineProperty(timelineScroll, "clientWidth", { configurable: true, value: 772 });

    const canvas = screen.getByTestId("melody-canvas");
    const firstCard = container.querySelector(".chord-card") as HTMLElement;
    expect(canvas.style.width).toBe("2016px");
    expect(firstCard.style.width).toBe("224px"); // 4 * 56

    const fitCheckbox = screen.getByRole("checkbox", { name: /Ajustar na área visível/ }) as HTMLInputElement;
    expect(fitCheckbox.checked).toBe(false);

    fireEvent.click(fitCheckbox);
    expect(useStore.getState().timelineFit).toBe(true);
    expect(fitCheckbox.checked).toBe(true);

    // 720px / 36 tempos = 20px/tempo -> canvas = 720px, acorde de 4 tempos = 80px, dock com .timeline-fit
    expect(canvas.style.width).toBe("720px");
    expect(firstCard.style.width).toBe("80px");
    expect(container.querySelector(".dock")?.classList.contains("timeline-fit")).toBe(true);

    fireEvent.click(fitCheckbox);
    expect(useStore.getState().timelineFit).toBe(false);
    expect(canvas.style.width).toBe("2016px");
    expect(firstCard.style.width).toBe("224px");
  });
});

describe("Inteligência harmônica (Melodia ↔ Acordes)", () => {
  it("colore notas da melodia conforme relação com o acorde (chord-tone, tension, passing, nc)", () => {
    act(() => {
      const s = useStore.getState();
      s.setBlockChords([makeChord(0, "maj", 4), makeRest(4)]);
      s.upsertMelodyNote({ pitch: 64, start: 0, duration: 1 }); // E4 sobre C -> chord-tone
      s.upsertMelodyNote({ pitch: 62, start: 1, duration: 1 }); // D4 sobre C -> tension
      s.upsertMelodyNote({ pitch: 65, start: 2, duration: 1 }); // F4 sobre C -> passing (avoid)
      s.upsertMelodyNote({ pitch: 60, start: 4, duration: 1 }); // C4 sobre N.C. -> nc
    });
    const { container } = render(<MelodyTrack />);
    const notes = Array.from(container.querySelectorAll<HTMLElement>(".melody-note"));
    expect(notes.map((n) => Array.from(n.classList).find((c) => c.startsWith("rel-")))).toEqual([
      "rel-chord-tone",
      "rel-tension",
      "rel-passing",
      "rel-nc",
    ]);
  });

  it("Auto-harmonizar gera acordes em bloco sem acordes em 1 undo e oferece preencher/substituir quando já há acordes", () => {
    act(() => {
      const s = useStore.getState();
      s.setBlockChords([]);
      s.setGrid("bar");
      s.upsertMelodyNote({ pitch: 60, start: 0, duration: 2 });
      s.upsertMelodyNote({ pitch: 64, start: 2, duration: 2 });
      s.upsertMelodyNote({ pitch: 67, start: 4, duration: 2 });
      s.upsertMelodyNote({ pitch: 71, start: 6, duration: 2 });
    });
    const pastBefore = useStore.getState().past.length;
    render(<MelodyTrack />);
    fireEvent.click(screen.getByRole("button", { name: /Auto-harmonizar/ }));
    const chords = () => selectBlock(useStore.getState())!.chords;
    expect(chords().map((c) => [c.root, c.quality])).toEqual([
      [0, "maj"],
      [7, "maj"],
    ]);
    expect(useStore.getState().past.length).toBe(pastBefore + 1);

    act(() => useStore.getState().undo());
    expect(chords()).toHaveLength(0);

    // Quando já existem acordes (incluindo N.C.), abre confirmação com Preencher vazios / Substituir tudo
    act(() => useStore.getState().setBlockChords([makeChord(5, "maj", 4), makeRest(4)]));
    fireEvent.click(screen.getByRole("button", { name: /Auto-harmonizar/ }));
    fireEvent.click(screen.getByRole("button", { name: "Preencher vazios" }));
    expect(chords().map((c) => c.root)).toEqual([5, 7]);

    fireEvent.click(screen.getByRole("button", { name: /Auto-harmonizar/ }));
    fireEvent.click(screen.getByRole("button", { name: "Substituir tudo" }));
    expect(chords().map((c) => c.root)).toEqual([0, 7]);
  });

  it("ChordWheel e DegreeStrip destacam acordes compatíveis com a melodia (.melody-dot / .melody-match)", () => {
    act(() => {
      const s = useStore.getState();
      s.setBlockChords([]);
      s.setGrid("bar");
      s.upsertMelodyNote({ pitch: 65, start: 0, duration: 2 }); // F4
      s.upsertMelodyNote({ pitch: 69, start: 2, duration: 2 }); // A4 -> aponta para F / Dm
    });
    const { container } = render(
      <>
        <ChordWheel />
        <DegreeStrip />
      </>,
    );
    expect(container.querySelectorAll(".melody-dot").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".slice.melody-match").length).toBeGreaterThan(0);
    const matchingDegrees = Array.from(container.querySelectorAll(".degree-main.melody-match")).map((b) => b.textContent);
    expect(matchingDegrees.some((t) => t?.includes("F") || t?.includes("Dm"))).toBe(true);
  });

  it("arrastar nota na grade não cria nota fantasma no click subsequente do canvas", () => {
    act(() => {
      useStore.getState().setMode("colorful");
      useStore.getState().upsertMelodyNote({ pitch: 60, start: 0, duration: 1 });
    });
    const { container } = render(<MelodyTrack />);
    const canvas = screen.getByTestId("melody-canvas");
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 896, height: 1200 }) as DOMRect;
    const noteEl = container.querySelector(".melody-note") as HTMLElement;
    fireEvent.pointerDown(noteEl, { button: 0, pointerType: "mouse", clientX: 10, clientY: 10 });
    fireEvent.pointerMove(noteEl, { clientX: 122, clientY: 10 }); // arrasta 2 tempos (112px)
    fireEvent.pointerUp(noteEl, { clientX: 122, clientY: 10 });
    fireEvent.click(canvas, { clientX: 250, clientY: 40 }); // click sintético imediatamente após soltar
    expect(currentMelody()).toHaveLength(1);
    expect(currentMelody()[0].start).toBe(2);
  });

  it("respiro N.C. selecionado não acende Dó maior na ChordWheel e clique em nota melódica guia a roda", () => {
    act(() => {
      const s = useStore.getState();
      s.setBlockChords([makeChord(0, "maj", 4)]);
      const rest = s.addRest(4)!;
      s.upsertMelodyNote({ pitch: 65, start: 4, duration: 1 }); // F4
      s.upsertMelodyNote({ pitch: 69, start: 5, duration: 1 }); // A4
      s.selectChord(rest.id);
    });
    const { container } = render(<ChordWheel />);
    expect(container.querySelectorAll(".slice.selected")).toHaveLength(0);

    const melNoteId = currentMelody()[0].id;
    act(() => useStore.getState().selectMelodyNote(melNoteId));
    expect(useStore.getState().selectedChord).toBeNull();
    expect(container.querySelectorAll(".slice.melody-match").length).toBeGreaterThan(0);
  });
});

describe("Painéis recolhíveis, modo compacto da melodia e popover em portal", () => {
  it("Arranjo, Melodia e Progressão recolhem e expandem individualmente no Dock", () => {
    const { container } = render(<Dock />);

    expect(container.querySelector(".arrangement .lane")).toBeTruthy();
    expect(container.querySelector(".melody-scroll")).toBeTruthy();
    expect(container.querySelector(".progression .timeline-scroll")).toBeTruthy();

    // Recolher Arranjo
    fireEvent.click(screen.getByRole("button", { name: "Recolher Arranjo" }));
    expect(useStore.getState().dockPanels.arrangement).toBe(false);
    expect(container.querySelector(".arrangement.panel-collapsed")).toBeTruthy();
    expect(container.querySelector(".arrangement .lane")).toBeNull();
    expect(container.querySelector(".melody-scroll")).toBeTruthy();
    expect(container.querySelector(".progression .timeline-scroll")).toBeTruthy();

    // Recolher Melodia
    fireEvent.click(screen.getByRole("button", { name: "Recolher Melodia" }));
    expect(useStore.getState().dockPanels.melody).toBe(false);
    expect(container.querySelector(".melody-track.panel-collapsed")).toBeTruthy();
    expect(container.querySelector(".melody-scroll")).toBeNull();
    expect(container.querySelector(".progression .timeline-gutter")).toBeNull();

    // Recolher Progressão
    fireEvent.click(screen.getByRole("button", { name: "Recolher Progressão" }));
    expect(useStore.getState().dockPanels.progression).toBe(false);
    expect(container.querySelector(".progression.panel-collapsed")).toBeTruthy();
    expect(container.querySelector(".progression .timeline-scroll")).toBeNull();

    // Expandir novamente os três painéis individualmente
    fireEvent.click(screen.getByRole("button", { name: "Expandir Arranjo" }));
    fireEvent.click(screen.getByRole("button", { name: "Expandir Melodia" }));
    fireEvent.click(screen.getByRole("button", { name: "Expandir Progressão" }));
    expect(useStore.getState().dockPanels).toEqual({ arrangement: true, melody: true, progression: true });
    expect(container.querySelector(".arrangement .lane")).toBeTruthy();
    expect(container.querySelector(".melody-scroll")).toBeTruthy();
    expect(container.querySelector(".progression .timeline-scroll")).toBeTruthy();
  });

  it("modo compacto da melodia encurta a grade vertical e mantém inserção por clique precisa", () => {
    act(() => {
      useStore.getState().upsertMelodyNote({ pitch: 64, start: 0, duration: 1 }); // E4
    });
    const { container } = render(<MelodyTrack />);
    const fullRows = scalePitchesInRange(scaleContext(0, "major"), MELODY_MIN_MIDI, MELODY_MAX_MIDI);
    const expectedCompactRows = compactMelodyRows(fullRows, currentMelody());
    expect(expectedCompactRows.length).toBeLessThan(fullRows.length);

    fireEvent.click(screen.getByRole("button", { name: "Modo compacto da melodia" }));
    expect(useStore.getState().melodyCompact).toBe(true);
    expect(container.querySelector(".melody-track.melody-compact")).toBeTruthy();
    expect(container.querySelectorAll(".melody-axis-row")).toHaveLength(expectedCompactRows.length);

    const canvas = screen.getByTestId("melody-canvas");
    expect(canvas.style.height).toBe(`${expectedCompactRows.length * MELODY_COMPACT_ROW_H}px`);

    const targetPitch = expectedCompactRows[0];
    canvas.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 896,
        height: expectedCompactRows.length * MELODY_COMPACT_ROW_H,
      }) as DOMRect;
    fireEvent.click(canvas, { clientX: 58, clientY: 4 });
    expect(currentMelody()).toHaveLength(2);
    expect(currentMelody().some((n) => n.pitch === targetPitch && n.start === 1)).toBe(true);
  });

  it("InstrumentPicker de Melodia e Progressão abre via portal em document.body com prioridade máxima e fecha com Esc", () => {
    const { container } = render(<Dock />);
    const dockEl = container.querySelector(".dock") as HTMLElement;
    const buttons = dockEl.querySelectorAll<HTMLButtonElement>(".picker-button");
    expect(buttons.length).toBeGreaterThanOrEqual(2);

    // 1) Seletor da Melodia
    fireEvent.click(buttons[0]);
    const portal1 = document.body.querySelector<HTMLElement>('.inst-popover-portal[data-popover-owner="dock"]');
    expect(portal1).toBeTruthy();
    expect(dockEl.contains(portal1!)).toBe(false);
    expect(portal1!.style.position).toBe("fixed");
    expect(Number(portal1!.style.zIndex)).toBeGreaterThanOrEqual(90);

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(document.body.querySelector(".inst-popover-portal")).toBeNull();

    // 2) Seletor da Progressão
    fireEvent.click(buttons[1]);
    const portal2 = document.body.querySelector<HTMLElement>('.inst-popover-portal[data-popover-owner="dock"]');
    expect(portal2).toBeTruthy();
    expect(dockEl.contains(portal2!)).toBe(false);
    expect(portal2!.style.position).toBe("fixed");
    expect(Number(portal2!.style.zIndex)).toBeGreaterThanOrEqual(90);

    // Fechar ao clicar fora
    fireEvent.pointerDown(document.body);
    expect(document.body.querySelector(".inst-popover-portal")).toBeNull();
  });
});
