// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

import { makeChord } from "../core/chords";
import { selectBlock, useStore } from "../state/store";
import { AIPanel } from "./AIPanel/AIPanel";
import { Header } from "./Header";
import { TopBar } from "./Layout/TopBar";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const HEALTH_OK = {
  status: "ok",
  model_loaded: true,
  default_model: "expressive_medium",
  available_models: ["expressive_medium", "prism_medium", "yellow_medium", "yellow_small"],
  skill_loaded: true,
  device: "cuda",
};

beforeEach(() => {
  useStore.getState().newSong();
  useStore.getState().setTonic(9); // A
  useStore.getState().setScale("minor"); // Am -> 8A
  useStore.getState().addChord(9, "m");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AIPanel & integração com Header/TopBar/Store", () => {
  it("abre pelo botão do Header, exibe chave Camelot sincronizada e estado offline", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    render(<Header />);
    const btn = screen.getByRole("button", { name: /IA Musical/i });
    await act(async () => fireEvent.click(btn));

    expect(screen.getByRole("dialog", { name: /IA Musical/i })).toBeTruthy();
    expect(screen.getByTestId("camelot-badge").textContent).toBe("8A");

    await waitFor(() => {
      expect(screen.getByText(/Servidor IA offline/i)).toBeTruthy();
    });

    // Vizinho relativo na roda Camelot (8A -> 8B = C Maior)
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Rel 8B/i })));
    expect(useStore.getState().tonic).toBe(0);
    expect(useStore.getState().scaleId).toBe("major");
    expect(screen.getByTestId("camelot-badge").textContent).toBe("8B");
  });

  it("abre também pela barra compacta do TopBar quando em modo auto", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(HEALTH_OK));
    vi.stubGlobal("fetch", fetchMock);
    useStore.setState({ topBar: "auto" });

    render(<TopBar />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "✨ IA" })));

    expect(screen.getByRole("dialog", { name: /IA Musical/i })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText(/Online · CUDA/i)).toBeTruthy();
    });
  });

  it("consulta o Plano Teórico (/plan) e aplica cifras ao bloco com Undo", async () => {
    const planPayload = {
      camelot_key: "8A",
      tonic_pc: 9,
      tonic_name: "A",
      scale_id: "minor",
      scale_pitches: [9, 11, 0, 2, 4, 5, 7],
      genre: "pop",
      total_bars: 4,
      chord_progression_per_bar: ["Am", "F", "C", "G"],
      voice_leading_style: "drop2",
      groove_style: "straight",
      target_roles_order: ["chords", "bass"],
      primer_python_code: "",
      theoretical_explanation: "Progressão i - VI - III - VII em Lá menor.",
    };

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/health")) return jsonResponse(HEALTH_OK);
      if (url.endsWith("/plan")) return jsonResponse(planPayload);
      return jsonResponse({}, 404);
    });

    render(<AIPanel onClose={() => {}} fetchImpl={fetchMock} />);
    await waitFor(() => expect(screen.getByText(/Online · CUDA/i)).toBeTruthy());

    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Consultar Plano Teórico/i })));
    await waitFor(() => expect(screen.getByText(/Progressão i - VI - III - VII/i)).toBeTruthy());

    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Aplicar cifras do plano/i })));
    const chords = selectBlock(useStore.getState())!.chords;
    expect(chords.map((c) => c.root)).toEqual([9, 5, 0, 7]);

    act(() => useStore.getState().undo());
    expect(selectBlock(useStore.getState())!.chords).toHaveLength(1); // volta ao acorde tônico inicial
  });

  it("harmoniza melodia (/generate) atualizando acordes + baixo num único commit com Ctrl+Z", async () => {
    // Prepara melodia no bloco atual e limpa acordes
    act(() => {
      useStore.getState().setBlockChords([]);
      useStore.getState().upsertMelodyNote({ pitch: 69, start: 0, duration: 2, velocity: 0.85 });
      useStore.getState().upsertMelodyNote({ pitch: 72, start: 4, duration: 2, velocity: 0.8 });
    });

    const genResult = {
      success: true,
      message: "Generation completed successfully",
      bpm: 90,
      time_signature: [4, 4],
      camelot_key: "8A",
      tracks: [
        {
          role: "chords",
          program: 0,
          name: "Chords (AI)",
          notes: [
            { pitch: 57, start_tick: 0, end_tick: 1920, velocity: 85 },
            { pitch: 60, start_tick: 0, end_tick: 1920, velocity: 85 },
            { pitch: 64, start_tick: 0, end_tick: 1920, velocity: 85 },
            { pitch: 53, start_tick: 1920, end_tick: 3840, velocity: 85 },
            { pitch: 57, start_tick: 1920, end_tick: 3840, velocity: 85 },
            { pitch: 60, start_tick: 1920, end_tick: 3840, velocity: 85 },
          ],
          chord_symbols: [
            { symbol: "Am", root_pc: 9, quality: "minor", start_tick: 0, end_tick: 1920 },
            { symbol: "F", root_pc: 5, quality: "major", start_tick: 1920, end_tick: 3840 },
          ],
        },
        {
          role: "bass",
          program: 33,
          name: "Bass (AI)",
          notes: [{ pitch: 45, start_tick: 0, end_tick: 1920, velocity: 90 }],
          chord_symbols: [],
        },
      ],
      theoretical_plan: {
        camelot_key: "8A",
        tonic_pc: 9,
        tonic_name: "A",
        scale_id: "minor",
        scale_pitches: [9, 11, 0, 2, 4, 5, 7],
        genre: "pop",
        total_bars: 2,
        chord_progression_per_bar: ["Am", "F"],
        voice_leading_style: "close",
        groove_style: "straight",
        target_roles_order: ["chords", "bass"],
        primer_python_code: "",
        theoretical_explanation: "Harmonização modal",
      },
      validation_report: {
        is_valid: true,
        scale_adherence: 1,
        voice_leading_score: 0.9,
        out_of_scale_bars: [],
        warnings: [],
      },
      primer_midi_b64: null,
      generation_time_sec: 0.85,
      vram_used_mb: 120,
      model_used: "expressive_medium",
    };

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/health")) return jsonResponse(HEALTH_OK);
      if (url.endsWith("/generate")) {
        const body = JSON.parse(String(init?.body));
        expect(body.target_tracks).toEqual(["chords", "bass"]);
        expect(body.generate_melody).toBe(false);
        expect(body.input_tracks[0].role).toBe("melody");
        return jsonResponse(genResult);
      }
      return jsonResponse({}, 404);
    });

    render(<AIPanel onClose={() => {}} fetchImpl={fetchMock} />);
    await waitFor(() => expect(screen.getByText(/Online · CUDA/i)).toBeTruthy());

    await act(async () => fireEvent.click(screen.getByRole("radio", { name: /Harmonizar Melodia/i })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Gerar com MIDI-GPT/i })));

    await waitFor(() => {
      const b = selectBlock(useStore.getState())!;
      expect(b.chords.map((c) => [c.root, c.quality])).toEqual([
        [9, "m"],
        [5, "maj"],
      ]);
      expect(b.bassInstrument).toBe("contrabass-pizz");
    });

    // Um único undo restaura acordes vazios e remove bassInstrument
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Desfazer/i })));
    const reverted = selectBlock(useStore.getState())!;
    expect(reverted.chords).toEqual([]);
    expect(reverted.bassInstrument).toBeUndefined();
  });

  it("gera melodia (/generate) para o Piano Roll e executa inpainting (/inpaint)", async () => {
    act(() => {
      useStore.getState().setBlockChords([
        makeChord(9, "m", 4),
        makeChord(5, "maj", 4),
        makeChord(0, "maj", 4),
        makeChord(7, "maj", 4),
      ]);
    });

    let lastEndpoint = "";
    const capturedPayloads: Record<string, unknown>[] = [];

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      lastEndpoint = url;
      if (url.endsWith("/health")) return jsonResponse(HEALTH_OK);
      capturedPayloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (url.endsWith("/generate")) {
        return jsonResponse({
          success: true,
          message: "ok",
          bpm: 90,
          time_signature: [4, 4],
          camelot_key: "8A",
          tracks: [
            {
              role: "melody",
              program: 0,
              name: "Melody (AI)",
              notes: [
                { pitch: 69, start_tick: 0, end_tick: 480, velocity: 95 },
                { pitch: 72, start_tick: 480, end_tick: 1440, velocity: 90 },
              ],
              chord_symbols: [],
            },
          ],
          theoretical_plan: null,
          validation_report: null,
          primer_midi_b64: null,
          generation_time_sec: 0.5,
          vram_used_mb: 0,
          model_used: "expressive_medium",
        });
      }
      if (url.endsWith("/inpaint")) {
        return jsonResponse({
          success: true,
          message: "ok",
          bpm: 90,
          time_signature: [4, 4],
          camelot_key: "8A",
          tracks: [
            {
              role: "chords",
              program: 0,
              name: "Chords (AI)",
              notes: [],
              chord_symbols: [
                { symbol: "Am", root_pc: 9, quality: "minor", start_tick: 0, end_tick: 1920 },
                { symbol: "Dm7", root_pc: 2, quality: "minor7", start_tick: 1920, end_tick: 3840 },
                { symbol: "G7", root_pc: 7, quality: "dominant7", start_tick: 3840, end_tick: 5760 },
                { symbol: "Am", root_pc: 9, quality: "minor", start_tick: 5760, end_tick: 7680 },
              ],
            },
            {
              role: "melody",
              program: 0,
              name: "Melody (AI)",
              notes: [{ pitch: 76, start_tick: 1920, end_tick: 2880, velocity: 100 }],
              chord_symbols: [],
            },
          ],
          theoretical_plan: null,
          validation_report: null,
          primer_midi_b64: null,
          generation_time_sec: 0.7,
          vram_used_mb: 0,
          model_used: "expressive_medium",
        });
      }
      return jsonResponse({}, 404);
    });

    render(<AIPanel onClose={() => {}} fetchImpl={fetchMock} />);
    await waitFor(() => expect(screen.getByText(/Online · CUDA/i)).toBeTruthy());

    // 1. Gerar Melodia
    await act(async () => fireEvent.click(screen.getByRole("radio", { name: /Gerar Melodia/i })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Gerar com MIDI-GPT/i })));
    await waitFor(() => expect(lastEndpoint.endsWith("/generate")).toBe(true));

    expect(selectBlock(useStore.getState())!.melody?.map((n) => n.pitch)).toEqual([69, 72]);
    // Acordes preservados
    expect(selectBlock(useStore.getState())!.chords).toHaveLength(4);

    // 2. Inpainting de Compassos [2..3]
    await act(async () => fireEvent.click(screen.getByRole("radio", { name: /Inpainting de Compassos/i })));
    fireEvent.change(screen.getByLabelText("Compasso inicial"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Compasso final"), { target: { value: "3" } });

    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Gerar com MIDI-GPT/i })));
    await waitFor(() => expect(lastEndpoint.endsWith("/inpaint")).toBe(true));

    expect(capturedPayloads[capturedPayloads.length - 1]?.inpaint_range).toEqual({
      start_bar: 1,
      end_bar: 3,
      roles: ["chords", "melody"],
    });
    expect(selectBlock(useStore.getState())!.chords[1]).toMatchObject({
      root: 2,
      quality: "m",
      modifiers: [{ kind: "ext", value: 7 }],
    });
    expect(selectBlock(useStore.getState())!.melody?.map((n) => n.pitch)).toEqual([76]);

    // Undo volta para estado antes do inpaint
    act(() => useStore.getState().undo());
    expect(selectBlock(useStore.getState())!.melody?.map((n) => n.pitch)).toEqual([69, 72]);
  });

  it("exibe fallback de erro amigável se o endpoint retornar HTTP 500", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/health")) return jsonResponse(HEALTH_OK);
      return jsonResponse({ detail: "Erro interno no motor" }, 500);
    });

    render(<AIPanel onClose={() => {}} fetchImpl={fetchMock} />);
    await waitFor(() => expect(screen.getByText(/Online · CUDA/i)).toBeTruthy());

    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Gerar com MIDI-GPT/i })));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Erro interno no motor"));
  });

  it("inicia automaticamente o servidor via window.chordplannerAI ao abrir offline no desktop", async () => {
    let serverRunning = false;
    const bridge = {
      startServer: vi.fn(async () => {
        serverRunning = true;
        return {
          ok: true,
          running: true,
          starting: false,
          managed: true,
          pid: 4321,
          message: "Servidor iniciado",
        };
      }),
      stopServer: vi.fn(async () => {
        serverRunning = false;
        return {
          ok: true,
          running: false,
          starting: false,
          managed: false,
          pid: null,
          message: "Servidor parado",
        };
      }),
      getServerStatus: vi.fn(async () => ({
        ok: true,
        running: serverRunning,
        starting: false,
        managed: serverRunning,
        pid: serverRunning ? 4321 : null,
        message: serverRunning ? "Ativo" : "Parado",
      })),
    };
    vi.stubGlobal("chordplannerAI", bridge);

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        if (!serverRunning) throw new TypeError("ECONNREFUSED");
        return jsonResponse(HEALTH_OK);
      }
      return jsonResponse({}, 404);
    });

    render(<AIPanel onClose={() => {}} fetchImpl={fetchMock} />);

    await waitFor(() => expect(bridge.startServer).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/Online · CUDA/i)).toBeTruthy());
    expect(screen.getByRole("button", { name: /Parar servidor/i })).toBeTruthy();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Parar servidor/i })));
    await waitFor(() => expect(bridge.stopServer).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/Servidor IA offline/i)).toBeTruthy());
  });

  it("trata clique manual em Iniciar servidor quando missingPython/missingDeps é retornado e oferece Modo Skill", async () => {
    const bridge = {
      startServer: vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          running: false,
          starting: false,
          managed: false,
          pid: null,
          message: "Falha inicial",
        })
        .mockResolvedValueOnce({
          ok: false,
          running: false,
          starting: false,
          managed: false,
          pid: null,
          missingPython: true,
          missingDeps: true,
          message: "Python 3.10+ ou torch/midigpt ausentes",
        }),
      stopServer: vi.fn(),
      getServerStatus: vi.fn(),
    };
    vi.stubGlobal("chordplannerAI", bridge);

    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("ECONNREFUSED"));

    render(<AIPanel onClose={() => {}} fetchImpl={fetchMock} />);

    await waitFor(() => expect(screen.getByRole("button", { name: /Iniciar servidor/i })).toBeTruthy());

    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Iniciar servidor/i })));

    await waitFor(() => {
      expect(screen.getByText(/Python \/ dependências do MIDI-GPT não encontrados/i)).toBeTruthy();
    });
    expect(screen.getByRole("region", { name: /Modo Skill sem IA/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Gerar via Skill \(sem IA\)/i })).toBeTruthy();
  });

  it("gera acordes, melodia e plano teórico via Skill (sem IA) quando offline com suporte a undo()", async () => {
    act(() => {
      useStore.getState().setBlockChords([]);
    });

    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("ECONNREFUSED"));

    render(<AIPanel onClose={() => {}} fetchImpl={fetchMock} />);
    await waitFor(() => expect(screen.getByText(/Servidor IA offline/i)).toBeTruthy());

    // Consulta plano teórico offline
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Consultar Plano Teórico/i })));
    await waitFor(() =>
      expect(screen.getByText(/Modo offline, sem servidor MIDI-GPT/i)).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: /✓ Aplicar cifras do plano/i })).toBeTruthy();

    // Gera bloco completo via Skill (sem IA)
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Gerar via Skill \(sem IA\)/i })));

    const generated = selectBlock(useStore.getState())!;
    expect(generated.chords.length).toBeGreaterThanOrEqual(4);
    expect((generated.melody ?? []).length).toBeGreaterThan(0);

    act(() => useStore.getState().undo());
    const reverted = selectBlock(useStore.getState())!;
    expect(reverted.chords).toEqual([]);
    expect(reverted.melody ?? []).toEqual([]);
  });

  it("exibe card de download do Hugging Face quando pesos estão ausentes, trata auth_required e habilita MIDI-GPT após download", async () => {
    let weightsDownloaded = false;
    let downloadCalls = 0;

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return jsonResponse({
          status: "ok",
          model_loaded: weightsDownloaded,
          default_model: "expressive_medium",
          available_models: [
            { name: "expressive_medium", loaded: weightsDownloaded, device: "cpu" },
          ],
          models_installed: weightsDownloaded ? ["expressive_medium"] : [],
          hf_repo: "Metacreation/MIDI-GPT",
          hf_authenticated: weightsDownloaded,
          skill_loaded: true,
          device: "cpu",
        });
      }
      if (url.endsWith("/models/download")) {
        downloadCalls += 1;
        const body = JSON.parse(String(init?.body)) as {
          model_name: string;
          hf_token: string | null;
          save_token: boolean;
        };
        if (downloadCalls === 1) {
          return jsonResponse({
            success: false,
            model_name: body.model_name,
            message: "Repositório gated requer token válido.",
            path: null,
            already_present: false,
            auth_required: true,
            repo_url: "https://huggingface.co/Metacreation/MIDI-GPT",
          });
        }
        expect(body.hf_token).toBe("hf_valid_token");
        expect(body.save_token).toBe(true);
        weightsDownloaded = true;
        return jsonResponse({
          success: true,
          model_name: body.model_name,
          message: "Pesos baixados com sucesso.",
          path: "/models/expressive_medium",
          already_present: false,
          auth_required: false,
          repo_url: "https://huggingface.co/Metacreation/MIDI-GPT",
        });
      }
      return jsonResponse({}, 404);
    });

    render(<AIPanel onClose={() => {}} fetchImpl={fetchMock} />);

    await waitFor(() =>
      expect(screen.getByRole("region", { name: /Download de pesos do Hugging Face/i })).toBeTruthy(),
    );

    const midiGptBtn = screen.getByRole("button", { name: /Gerar com MIDI-GPT/i }) as HTMLButtonElement;
    expect(midiGptBtn.disabled).toBe(true);
    expect(screen.getByRole("button", { name: /Gerar via Skill \(sem IA\)/i })).toBeTruthy();

    // Primeira tentativa sem token -> auth_required
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: /Baixar pesos do Hugging Face/i })),
    );
    await waitFor(() => expect(screen.getByText(/Repositório gated \(401\/403\)/i)).toBeTruthy());

    // Segunda tentativa com token + salvar token -> sucesso e atualiza /health
    fireEvent.change(screen.getByLabelText("Token Hugging Face"), {
      target: { value: "hf_valid_token" },
    });
    fireEvent.click(screen.getByLabelText("Salvar token no Hugging Face"));

    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: /Baixar pesos do Hugging Face/i })),
    );

    await waitFor(() => {
      expect(screen.queryByRole("region", { name: /Download de pesos do Hugging Face/i })).toBeNull();
    });
    const enabledMidiBtn = screen.getByRole("button", { name: /Gerar com MIDI-GPT/i }) as HTMLButtonElement;
    expect(enabledMidiBtn.disabled).toBe(false);
  });
});
