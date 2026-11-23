import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AI_GENRES,
  AI_MODELS,
  AI_MODEL_LABELS,
  AIServerError,
  DEFAULT_AI_SERVER_URL,
  buildGenerationRequest,
  createMusicAIClient,
  generationResultToBlockPatch,
  getDesktopAIBridge,
  installedModelNames,
  planToChords,
  type AIGenModelName,
  type AIGenerationOptions,
  type AIHealthStatus,
  type DesktopAIServerStatus,
  type GenerationMode,
  type GenerationResult,
  type TheoreticalPlan,
  type TrackRole,
} from "../../ai/client";
import { buildOfflineSkillPlan, generateOfflineSkillPatch } from "../../ai/skillFallback";
import { camelotNeighbors, fromCamelotCode, toCamelotCode, type CamelotCode } from "../../core/camelot";
import { isRest } from "../../core/chords";
import { scaleContext } from "../../core/diatonic";
import { blockBeats } from "../../core/song";
import { gridBeats } from "../../core/timeline";
import { keyLabel } from "../../core/view";
import { blockKey, selectBlock, selectEditChords, selectEditMelody, useStore } from "../../state/store";

type Props = {
  onClose: () => void;
  serverUrl?: string;
  fetchImpl?: typeof fetch;
};

const MODE_OPTIONS: { id: GenerationMode; label: string; desc: string }[] = [
  {
    id: "harmonize",
    label: "Harmonizar Melodia",
    desc: "Usa a melodia do Piano Roll para gerar progressão de acordes e baixo.",
  },
  {
    id: "melody",
    label: "Gerar Melodia",
    desc: "Usa os acordes do bloco atual para gerar uma melodia expressiva.",
  },
  {
    id: "full",
    label: "Bloco Completo",
    desc: "Gera acordes, melodia e camada de baixo juntos na chave ativa.",
  },
  {
    id: "inpaint",
    label: "Inpainting de Compassos",
    desc: "Regenera apenas o intervalo de compassos selecionado, preservando o resto.",
  },
];

const GENRE_LABELS: Record<string, string> = {
  pop: "Pop",
  jazz: "Jazz",
  rock: "Rock",
  "hip-hop": "Hip-Hop",
  latin: "Latino / Bossa",
  blues: "Blues",
  classical: "Clássico",
  "dance-electronic": "Eletrônica / Dance",
  soundtrack: "Trilha Sonora",
  folk: "Folk / Acústico",
};

export function AIPanel({ onClose, serverUrl = DEFAULT_AI_SERVER_URL, fetchImpl }: Props) {
  const song = useStore((s) => s.song);
  const block = useStore((s) => selectBlock(s));
  const tonic = useStore((s) => s.tonic);
  const scaleId = useStore((s) => s.scaleId);
  const accidentals = useStore((s) => s.accidentals);
  const melodyGrid = useStore((s) => s.melodyGrid);
  const editChords = useStore((s) => selectEditChords(s));
  const editMelody = useStore((s) => selectEditMelody(s));
  const canUndo = useStore((s) => s.past.length > 0);
  const applyAIGeneration = useStore((s) => s.applyAIGeneration);
  const setKey = useStore((s) => s.setKey);
  const setBlockProps = useStore((s) => s.setBlockProps);
  const undo = useStore((s) => s.undo);

  const effectiveKey = blockKey({ tonic, scaleId }, block);
  const effectiveTonic = effectiveKey?.tonic ?? 0;
  const effectiveScale = effectiveKey?.scaleId ?? scaleId;
  const activeCamelot = toCamelotCode(effectiveTonic, effectiveScale);
  const neighbors = camelotNeighbors(activeCamelot);
  const meter = block?.meter ?? song.meter;
  const blockBars = block ? Math.max(4, Math.ceil(blockBeats(block) / Math.max(1, meter[0])) || 4) : 4;

  const [mode, setMode] = useState<GenerationMode>("full");
  const [modelName, setModelName] = useState<AIGenModelName>("expressive_medium");
  const [genre, setGenre] = useState<string>("pop");
  const [stylePrompt, setStylePrompt] = useState<string>("Modern Pop Ballad, emotional, piano driven");
  const [bars, setBars] = useState<number>(blockBars);
  const [density, setDensity] = useState<number>(5);
  const [polyphony, setPolyphony] = useState<number>(4);
  const [noteDuration, setNoteDuration] = useState<number>(0.6);
  const [temperature, setTemperature] = useState<number>(1.0);
  const [useVelocity, setUseVelocity] = useState<boolean>(true);
  const [useMicrotiming, setUseMicrotiming] = useState<boolean>(true);

  const [inpaintStartBar, setInpaintStartBar] = useState<number>(1);
  const [inpaintEndBar, setInpaintEndBar] = useState<number>(Math.min(2, blockBars));
  const [inpaintRoles, setInpaintRoles] = useState<TrackRole[]>(["chords", "melody"]);

  const [health, setHealth] = useState<AIHealthStatus | null>(null);
  const [healthState, setHealthState] = useState<"checking" | "online" | "offline">("checking");
  const [healthError, setHealthError] = useState<string | null>(null);
  const [serverAction, setServerAction] = useState<"starting" | "stopping" | null>(null);
  const [desktopStatus, setDesktopStatus] = useState<DesktopAIServerStatus | null>(null);

  const [hfToken, setHfToken] = useState<string>("");
  const [saveHfToken, setSaveHfToken] = useState<boolean>(false);
  const [downloadAuthRequired, setDownloadAuthRequired] = useState<boolean>(false);

  const [loadingAction, setLoadingAction] = useState<"plan" | "generate" | "download" | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [plan, setPlan] = useState<TheoreticalPlan | null>(null);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [appliedCount, setAppliedCount] = useState<number>(0);

  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const mountedRef = useRef(true);
  const healthSeqRef = useRef(0);
  const skillSeedRef = useRef(1);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    mountedRef.current = true;
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      mountedRef.current = false;
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const seq = ++healthSeqRef.current;
    const isCurrent = () => !cancelled && mountedRef.current && healthSeqRef.current === seq;
    const client = createMusicAIClient(serverUrl, fetchImpl);
    const bridge = getDesktopAIBridge();

    const init = async () => {
      try {
        const h = await client.checkHealth();
        if (!isCurrent()) return;
        setHealth(h);
        setHealthState("online");
        setHealthError(null);
        if (bridge) {
          bridge
            .getServerStatus()
            .then((s) => {
              if (isCurrent()) setDesktopStatus(s);
            })
            .catch(() => {});
        }
      } catch (err: unknown) {
        if (!isCurrent()) return;
        if (bridge) {
          setServerAction("starting");
          setHealthError(null);
          try {
            const startRes = await bridge.startServer();
            if (!isCurrent()) return;
            setDesktopStatus(startRes);
            if (startRes.ok) {
              try {
                const h = await client.checkHealth();
                if (!isCurrent()) return;
                setHealth(h);
                setHealthState("online");
                setHealthError(null);
              } catch (healthErr: unknown) {
                if (!isCurrent()) return;
                setHealth(null);
                setHealthState("offline");
                setHealthError(
                  healthErr instanceof Error
                    ? healthErr.message
                    : startRes.message || "Servidor IA offline",
                );
              }
            } else {
              setHealth(null);
              setHealthState("offline");
              setHealthError(startRes.message || "Não foi possível iniciar o servidor IA.");
            }
          } catch (startErr: unknown) {
            if (!isCurrent()) return;
            setHealth(null);
            setHealthState("offline");
            setHealthError(
              startErr instanceof Error ? startErr.message : "Falha ao iniciar servidor IA.",
            );
          } finally {
            if (isCurrent()) setServerAction(null);
          }
        } else {
          setHealth(null);
          setHealthState("offline");
          setHealthError(err instanceof Error ? err.message : "Servidor IA offline");
        }
      }
    };

    void init();
    return () => {
      cancelled = true;
    };
  }, [serverUrl, fetchImpl]);

  const refreshHealth = async () => {
    const seq = ++healthSeqRef.current;
    const isCurrent = () => mountedRef.current && healthSeqRef.current === seq;
    setHealthState("checking");
    setHealthError(null);
    const bridge = getDesktopAIBridge();
    try {
      const h = await createMusicAIClient(serverUrl, fetchImpl).checkHealth();
      if (!isCurrent()) return;
      setHealth(h);
      setHealthState("online");
      if (bridge) {
        bridge
          .getServerStatus()
          .then((s) => {
            if (isCurrent()) setDesktopStatus(s);
          })
          .catch(() => {});
      }
    } catch (err) {
      if (!isCurrent()) return;
      setHealth(null);
      setHealthState("offline");
      setHealthError(err instanceof Error ? err.message : "Servidor IA offline");
    }
  };

  const handleStartServer = async () => {
    const bridge = getDesktopAIBridge();
    setErrorMsg(null);
    setStatusMsg(null);
    if (!bridge) {
      await refreshHealth();
      return;
    }
    const seq = ++healthSeqRef.current;
    const isCurrent = () => mountedRef.current && healthSeqRef.current === seq;
    setServerAction("starting");
    setHealthError(null);
    try {
      const res = await bridge.startServer();
      if (!isCurrent()) return;
      setDesktopStatus(res);
      if (res.ok) {
        const h = await createMusicAIClient(serverUrl, fetchImpl).checkHealth();
        if (!isCurrent()) return;
        setHealth(h);
        setHealthState("online");
        setHealthError(null);
        setStatusMsg("Servidor IA iniciado e conectado.");
      } else {
        setHealth(null);
        setHealthState("offline");
        setHealthError(res.message || "Não foi possível iniciar o servidor IA.");
      }
    } catch (err) {
      if (!isCurrent()) return;
      setHealth(null);
      setHealthState("offline");
      setHealthError(err instanceof Error ? err.message : "Falha ao iniciar o servidor IA.");
    } finally {
      if (isCurrent()) setServerAction(null);
    }
  };

  const handleStopServer = async () => {
    const bridge = getDesktopAIBridge();
    if (!bridge) return;
    const seq = ++healthSeqRef.current;
    const isCurrent = () => mountedRef.current && healthSeqRef.current === seq;
    setErrorMsg(null);
    setStatusMsg(null);
    setServerAction("stopping");
    try {
      const res = await bridge.stopServer();
      if (!isCurrent()) return;
      setDesktopStatus(res);
      if (res.running) {
        setStatusMsg(res.message || "Servidor IA externo continua em execução.");
        await refreshHealth();
      } else {
        setHealth(null);
        setHealthState("offline");
        setHealthError(null);
        setStatusMsg(res.message || "Servidor IA parado.");
      }
    } catch (err) {
      if (!isCurrent()) return;
      setErrorMsg(err instanceof Error ? err.message : "Falha ao parar o servidor IA.");
    } finally {
      if (mountedRef.current) setServerAction(null);
    }
  };

  const handleDownloadWeights = async () => {
    setErrorMsg(null);
    setStatusMsg(null);
    setDownloadAuthRequired(false);
    setLoadingAction("download");
    try {
      const res = await createMusicAIClient(serverUrl, fetchImpl).downloadModel({
        model_name: modelName,
        hf_token: hfToken.trim() || null,
        save_token: saveHfToken,
      });
      if (!mountedRef.current) return;
      if (res.success) {
        setHfToken("");
        await refreshHealth();
        if (!mountedRef.current) return;
        setStatusMsg(
          res.message || `Pesos de ${AI_MODEL_LABELS[modelName].name} baixados com sucesso.`,
        );
      } else {
        if (res.auth_required) {
          setDownloadAuthRequired(true);
        }
        setErrorMsg(res.message || "Falha ao baixar os pesos do Hugging Face.");
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(
        err instanceof Error ? err.message : "Erro ao baixar pesos do Hugging Face.",
      );
    } finally {
      if (mountedRef.current) setLoadingAction(null);
    }
  };

  const handleSelectCamelot = (code: CamelotCode) => {
    const decoded = fromCamelotCode(code);
    if (block?.key) {
      setBlockProps(block.id, { key: { tonic: decoded.tonic, scaleId: decoded.scaleId } });
    } else {
      setKey(decoded.tonic, decoded.scaleId);
    }
  };

  const toggleInpaintRole = (role: TrackRole) => {
    setInpaintRoles((prev) => {
      if (prev.includes(role)) {
        const next = prev.filter((r) => r !== role);
        return next.length ? next : prev;
      }
      return [...prev, role];
    });
  };

  const buildSkillOptions = (): AIGenerationOptions => ({
    mode,
    modelName,
    genre,
    stylePrompt,
    bars,
    density,
    polyphony,
    noteDuration,
    temperature,
    useVelocity,
    useMicrotiming,
    inpaintRange:
      mode === "inpaint"
        ? {
            startBar: Math.max(0, inpaintStartBar - 1),
            endBar: Math.max(inpaintStartBar, Math.min(bars, inpaintEndBar)),
            roles: inpaintRoles,
          }
        : undefined,
  });

  const buildCurrentRequest = () => {
    if (!block) throw new Error("Nenhum bloco selecionado.");
    return buildGenerationRequest({
      block: {
        ...block,
        chords: editChords,
        melody: editMelody,
      },
      song,
      tonic,
      scaleId,
      options: buildSkillOptions(),
    });
  };

  const handleFetchPlan = async () => {
    if (!block) {
      setErrorMsg("Nenhum bloco selecionado.");
      return;
    }
    setErrorMsg(null);
    setStatusMsg(null);
    if (healthState === "offline") {
      const theoreticalPlan = buildOfflineSkillPlan({
        block: {
          ...block,
          chords: editChords,
          melody: editMelody,
        },
        song,
        tonic,
        scaleId,
        options: buildSkillOptions(),
      });
      setPlan(theoreticalPlan);
      setStatusMsg("Plano teórico consultado via Skill music-composition (sem IA).");
      return;
    }

    setLoadingAction("plan");
    try {
      const req = buildCurrentRequest();
      const theoreticalPlan = await createMusicAIClient(serverUrl, fetchImpl).createPlan(req);
      if (!mountedRef.current) return;
      setPlan(theoreticalPlan);
      setStatusMsg("Plano teórico consultado via Skill music-composition.");
    } catch (err) {
      if (!mountedRef.current) return;
      if (err instanceof AIServerError && err.status === 0) {
        const theoreticalPlan = buildOfflineSkillPlan({
          block: {
            ...block,
            chords: editChords,
            melody: editMelody,
          },
          song,
          tonic,
          scaleId,
          options: buildSkillOptions(),
        });
        setPlan(theoreticalPlan);
        setHealthState("offline");
        setHealth(null);
        setHealthError(err.message);
        setStatusMsg("Servidor inacessível; plano teórico gerado via Skill music-composition (sem IA).");
      } else {
        setErrorMsg(err instanceof Error ? err.message : "Falha ao consultar plano teórico.");
      }
    } finally {
      if (mountedRef.current) setLoadingAction(null);
    }
  };

  const handleSkillGenerate = () => {
    if (!block) return;
    setErrorMsg(null);
    setStatusMsg(null);
    setLoadingAction("generate");
    try {
      const seed = skillSeedRef.current++;
      const { plan: skillPlan, patch } = generateOfflineSkillPatch({
        block: {
          ...block,
          chords: editChords,
          melody: editMelody,
        },
        song,
        tonic,
        scaleId,
        options: { ...buildSkillOptions(), seed },
        melodyGridBeats: gridBeats(melodyGrid, meter),
      });

      setResult(null);
      setPlan(skillPlan);
      applyAIGeneration(patch);
      setAppliedCount((c) => c + 1);

      const parts: string[] = [];
      if (patch.chords) parts.push(`${patch.chords.length} acorde(s)`);
      if (patch.melody) parts.push(`${patch.melody.length} nota(s) de melodia`);
      if (patch.bassInstrument) parts.push("camada de baixo");
      setStatusMsg(
        parts.length
          ? `Aplicado ao bloco "${block.name}" via Skill music-composition (sem IA): ${parts.join(", ")}.`
          : "Geração simbólica concluída.",
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erro na geração simbólica via Skill.");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleGenerate = async () => {
    if (!block) return;
    const targetBlockId = block.id;
    const targetBlockName = block.name;
    setErrorMsg(null);
    setStatusMsg(null);
    setLoadingAction("generate");
    try {
      const req = buildCurrentRequest();
      const client = createMusicAIClient(serverUrl, fetchImpl);
      const res = mode === "inpaint" ? await client.inpaint(req) : await client.generate(req);
      if (!mountedRef.current) return;
      if (!res.success) {
        setErrorMsg(res.message || "Falha na geração MIDI-GPT.");
        setResult(res);
        return;
      }

      setResult(res);
      if (res.theoretical_plan) setPlan(res.theoretical_plan);

      if (selectBlock(useStore.getState())?.id !== targetBlockId) {
        setErrorMsg(`O bloco ativo mudou durante a geração; resultado de "${targetBlockName}" não foi aplicado.`);
        return;
      }

      const ctx = effectiveKey ? scaleContext(effectiveKey.tonic, effectiveKey.scaleId) : null;
      const patch = generationResultToBlockPatch(res, {
        mode,
        meter,
        scaleCtx: ctx,
        melodyGrid: gridBeats(melodyGrid, meter),
        currentBassInstrument: block.bassInstrument,
        inpaintRoles,
        syncKey: tonic === null && !block.key,
      });

      applyAIGeneration(patch);
      setAppliedCount((c) => c + 1);

      const parts: string[] = [];
      if (patch.chords) parts.push(`${patch.chords.length} acorde(s)`);
      if (patch.melody) parts.push(`${patch.melody.length} nota(s) de melodia`);
      if (patch.bassInstrument) parts.push("camada de baixo");
      setStatusMsg(
        parts.length
          ? `Aplicado ao bloco "${targetBlockName}": ${parts.join(", ")} (${res.generation_time_sec.toFixed(2)}s).`
          : "Geração concluída.",
      );
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMsg(err instanceof Error ? err.message : "Erro ao gerar com MIDI-GPT.");
    } finally {
      if (mountedRef.current) setLoadingAction(null);
    }
  };

  const handleApplyPlanChords = () => {
    if (!plan || !block) return;
    const chords = planToChords(plan, meter);
    if (!chords.length) return;
    applyAIGeneration({
      chords,
      ...(tonic === null && !block.key ? { tonic: plan.tonic_pc, scaleId: plan.scale_id } : {}),
    });
    setAppliedCount((c) => c + 1);
    setStatusMsg(`Progressão do plano (${chords.length} acordes) aplicada ao bloco "${block.name}".`);
  };

  const handleUndo = () => {
    if (!canUndo) return;
    undo();
    setStatusMsg("Última alteração de IA desfeita (Ctrl+Z).");
  };

  const bridge = getDesktopAIBridge();
  const installedModels = installedModelNames(health);
  const isSelectedModelInstalled = healthState === "online" && installedModels.includes(modelName);
  const hfRepoUrl =
    health?.hf_repo && /^https?:\/\//.test(health.hf_repo)
      ? health.hf_repo
      : health?.hf_repo
        ? `https://huggingface.co/${health.hf_repo}`
        : "https://huggingface.co/Metacreation/MIDI-GPT";

  const nonRestChordCount = editChords.filter((c) => !isRest(c)).length;
  const barOptions = Array.from(new Set([4, 8, 12, 16, blockBars])).sort((a, b) => a - b);

  return createPortal(
    <div className="modal-backdrop" data-popover-owner="topbar" onClick={onClose}>
      <div
        className="modal ai-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-panel-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ai-head">
          <div>
            <h3 id="ai-panel-title">✨ IA Musical (MIDI-GPT + Music-Composition)</h3>
            <p className="muted small ai-subtitle">
              Bloco ativo: <strong>{block?.name ?? "—"}</strong> ·{" "}
              {tonic === null && !block?.key
                ? "Sem tônica (padrão 8B / C Maior)"
                : keyLabel(effectiveTonic, effectiveScale, accidentals)}{" "}
              · {nonRestChordCount} acorde(s) · {editMelody.length} nota(s) na melodia
            </p>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Fechar painel IA"
          >
            ✕
          </button>
        </div>

        <div className="ai-status-bar">
          <div className={`ai-health-pill ${serverAction === "starting" ? "starting" : healthState}`}>
            <span className="ai-health-dot" aria-hidden="true" />
            {serverAction === "starting" && "Iniciando servidor IA..."}
            {serverAction === "stopping" && "Parando servidor IA..."}
            {serverAction === null && healthState === "checking" && "Verificando motor MIDI-GPT..."}
            {serverAction === null &&
              healthState === "online" &&
              `Online · ${health?.device?.toUpperCase() ?? "CPU"} · Skill ${
                health?.skill_loaded ? "carregada" : "padrão"
              }`}
            {serverAction === null &&
              healthState === "offline" &&
              "Servidor IA offline (127.0.0.1:8765)"}
          </div>
          <div className="ai-status-actions">
            {(healthState === "offline" || serverAction === "starting") && (
              <button
                type="button"
                className="btn small"
                onClick={() => void handleStartServer()}
                disabled={loadingAction !== null || serverAction !== null}
              >
                {serverAction === "starting" ? "Iniciando..." : "▶ Iniciar servidor"}
              </button>
            )}
            {healthState === "online" && desktopStatus?.managed && (
              <button
                type="button"
                className="btn small"
                onClick={() => void handleStopServer()}
                disabled={loadingAction !== null || serverAction !== null}
              >
                {serverAction === "stopping" ? "Parando..." : "⏹ Parar servidor"}
              </button>
            )}
            <button
              type="button"
              className="btn small"
              onClick={() => void refreshHealth()}
              disabled={loadingAction !== null || serverAction !== null}
            >
              ↻ Atualizar
            </button>
          </div>
        </div>

        {healthState === "offline" && serverAction !== "starting" && (
          <>
            {(desktopStatus?.missingPython || desktopStatus?.missingDeps) ? (
              <div className="ai-alert warn-box small" role="status">
                <strong>Python / dependências do MIDI-GPT não encontrados:</strong>{" "}
                {desktopStatus.message} O <strong>Modo Skill (sem IA)</strong> está disponível abaixo
                para gerar acordes, melodia e planos teóricos sem Python.
              </div>
            ) : (
              healthError && (
                <div className="ai-alert warn-box small" role="status">
                  {healthError}
                  {!bridge && (
                    <>
                      {" "}
                      Inicie localmente com <code className="mono">python -m music_ai_module.server</code> ou
                      use o <strong>Modo Skill (sem IA)</strong> abaixo.
                    </>
                  )}
                </div>
              )
            )}
            <div className="ai-skill-fallback-box small" role="region" aria-label="Modo Skill sem IA">
              <strong>Modo Skill music-composition (sem IA / sem Python):</strong> consulte o plano
              teórico e gere acordes, melodia, baixo ou inpainting no bloco atual com suporte a{" "}
              <kbd>Ctrl+Z</kbd> mesmo sem servidor Python.
            </div>
          </>
        )}

        {healthState === "online" && !isSelectedModelInstalled && (
          <section className="ai-weights-box" aria-label="Download de pesos do Hugging Face">
            <div className="ai-weights-head">
              <strong>
                Pesos do modelo {AI_MODEL_LABELS[modelName].name} não instalados localmente
              </strong>
              <span className="small muted">
                Baixe os checkpoints oficiais de{" "}
                <a href={hfRepoUrl} target="_blank" rel="noopener noreferrer">
                  {hfRepoUrl}
                </a>
                .
              </span>
            </div>
            {downloadAuthRequired && (
              <div className="ai-alert warn-box small" role="status">
                Repositório gated (401/403): acesse{" "}
                <a href={hfRepoUrl} target="_blank" rel="noopener noreferrer">
                  Metacreation/MIDI-GPT
                </a>
                , aceite os termos/licença e informe um Access Token (<code className="mono">read</code>)
                abaixo.
              </div>
            )}
            <div className="ai-weights-form">
              <input
                type="password"
                aria-label="Token Hugging Face"
                placeholder="Token HF opcional (hf_...)"
                value={hfToken}
                onChange={(e) => setHfToken(e.target.value)}
              />
              <label className="check small">
                <input
                  type="checkbox"
                  checked={saveHfToken}
                  onChange={(e) => setSaveHfToken(e.target.checked)}
                />
                Salvar token no Hugging Face
              </label>
              <button
                type="button"
                className="btn primary small"
                onClick={() => void handleDownloadWeights()}
                disabled={loadingAction !== null || serverAction !== null}
              >
                {loadingAction === "download"
                  ? "Baixando pesos..."
                  : "⬇ Baixar pesos do Hugging Face"}
              </button>
            </div>
          </section>
        )}

        <section className="ai-camelot-bar" aria-label="Chave Camelot">
          <div className="ai-camelot-active">
            <span className="ai-camelot-label">Roda Camelot</span>
            <strong className="ai-camelot-badge" data-testid="camelot-badge">
              {activeCamelot}
            </strong>
            <span className="small muted">
              {keyLabel(effectiveTonic, effectiveScale, accidentals)}
            </span>
          </div>
          <div className="ai-camelot-neighbors" aria-label="Vizinhos harmônicos Camelot">
            <button
              type="button"
              className="btn small"
              onClick={() => handleSelectCamelot(neighbors.relative)}
              title="Relativa (mesmo número A/B)"
            >
              Rel {neighbors.relative}
            </button>
            <button
              type="button"
              className="btn small"
              onClick={() => handleSelectCamelot(neighbors.dominant)}
              title="Dominante (+1 no relógio)"
            >
              +1 {neighbors.dominant}
            </button>
            <button
              type="button"
              className="btn small"
              onClick={() => handleSelectCamelot(neighbors.subdominant)}
              title="Subdominante (-1 no relógio)"
            >
              −1 {neighbors.subdominant}
            </button>
            <button
              type="button"
              className="btn small"
              onClick={() => handleSelectCamelot(neighbors.parallel)}
              title="Homônima paralela"
            >
              Par {neighbors.parallel}
            </button>
          </div>
        </section>

        <section className="ai-section" aria-label="Modo de geração">
          <div className="ai-modes" role="radiogroup" aria-label="Modo de geração IA">
            {MODE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={mode === opt.id}
                className={`ai-mode-btn ${mode === opt.id ? "active" : ""}`}
                onClick={() => setMode(opt.id)}
              >
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
          <p className="muted small ai-mode-desc">
            {MODE_OPTIONS.find((m) => m.id === mode)?.desc}
          </p>
        </section>

        {mode === "inpaint" && (
          <section className="ai-inpaint-box" aria-label="Intervalo de inpainting">
            <label className="field small">
              <span>Compasso inicial</span>
              <input
                type="number"
                aria-label="Compasso inicial"
                min={1}
                max={bars}
                value={inpaintStartBar}
                onChange={(e) => {
                  const v = Math.max(1, Math.min(bars, Number(e.target.value) || 1));
                  setInpaintStartBar(v);
                  if (inpaintEndBar < v) setInpaintEndBar(v);
                }}
              />
            </label>
            <label className="field small">
              <span>Compasso final</span>
              <input
                type="number"
                aria-label="Compasso final"
                min={inpaintStartBar}
                max={bars}
                value={inpaintEndBar}
                onChange={(e) =>
                  setInpaintEndBar(Math.max(inpaintStartBar, Math.min(bars, Number(e.target.value) || inpaintStartBar)))
                }
              />
            </label>
            <div className="ai-inpaint-roles">
              <span className="small muted">Faixas:</span>
              {(["chords", "melody", "bass"] as const).map((r) => (
                <label key={r} className="check small">
                  <input
                    type="checkbox"
                    checked={inpaintRoles.includes(r)}
                    onChange={() => toggleInpaintRole(r)}
                  />
                  {r === "chords" ? "Acordes" : r === "melody" ? "Melodia" : "Baixo"}
                </label>
              ))}
            </div>
          </section>
        )}

        <section className="ai-controls-grid" aria-label="Parâmetros do MIDI-GPT">
          <label className="field small">
            <span>Modelo</span>
            <select
              aria-label="Modelo"
              value={modelName}
              onChange={(e) => {
                setModelName(e.target.value as AIGenModelName);
                setDownloadAuthRequired(false);
              }}
            >
              {AI_MODELS.map((m) => {
                const installed = installedModels.includes(m);
                return (
                  <option key={m} value={m}>
                    {AI_MODEL_LABELS[m].name}
                    {health ? (installed ? " ✓" : " (não baixado)") : ""}
                  </option>
                );
              })}
            </select>
          </label>

          <label className="field small">
            <span>Gênero</span>
            <select
              aria-label="Gênero"
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
            >
              {AI_GENRES.map((g) => (
                <option key={g} value={g}>
                  {GENRE_LABELS[g] ?? g}
                </option>
              ))}
            </select>
          </label>

          <label className="field small">
            <span>Compassos</span>
            <select
              aria-label="Compassos"
              value={bars}
              onChange={(e) => {
                const nextBars = Number(e.target.value) || 4;
                setBars(nextBars);
                setInpaintStartBar((s) => Math.min(s, nextBars));
                setInpaintEndBar((end) => Math.min(end, nextBars));
              }}
            >
              {barOptions.map((n) => (
                <option key={n} value={n}>
                  {n} compassos
                </option>
              ))}
            </select>
          </label>

          <label className="field small ai-span-full">
            <span>Estilo / Prompt</span>
            <input
              type="text"
              aria-label="Estilo / Prompt"
              value={stylePrompt}
              onChange={(e) => setStylePrompt(e.target.value)}
              placeholder="Ex.: Neo-Soul, jazzy Rhodes voicings, warm groove"
            />
          </label>

          <label className="ai-slider small">
            <span className="ai-slider-head">
              <span>Densidade</span>
              <strong className="mono">{density}</strong>
            </span>
            <input
              type="range"
              aria-label="Densidade"
              min={1}
              max={10}
              step={1}
              value={density}
              onChange={(e) => setDensity(Number(e.target.value))}
            />
          </label>

          <label className="ai-slider small">
            <span className="ai-slider-head">
              <span>Polifonia</span>
              <strong className="mono">{polyphony}</strong>
            </span>
            <input
              type="range"
              aria-label="Polifonia"
              min={1}
              max={10}
              step={1}
              value={polyphony}
              onChange={(e) => setPolyphony(Number(e.target.value))}
            />
          </label>

          <label className="ai-slider small">
            <span className="ai-slider-head">
              <span>Duração (Staccato ↔ Legato)</span>
              <strong className="mono">{noteDuration.toFixed(2)}</strong>
            </span>
            <input
              type="range"
              aria-label="Duração relativa"
              min={0.1}
              max={1.0}
              step={0.05}
              value={noteDuration}
              onChange={(e) => setNoteDuration(Number(e.target.value))}
            />
          </label>

          <label className="ai-slider small">
            <span className="ai-slider-head">
              <span>Temperatura</span>
              <strong className="mono">{temperature.toFixed(2)}</strong>
            </span>
            <input
              type="range"
              aria-label="Temperatura"
              min={0.5}
              max={1.5}
              step={0.05}
              value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))}
            />
          </label>
        </section>

        <div className="ai-toggles">
          <label className="check small">
            <input
              type="checkbox"
              checked={useVelocity}
              onChange={(e) => setUseVelocity(e.target.checked)}
            />
            Velocity Humano
          </label>
          <label className="check small">
            <input
              type="checkbox"
              checked={useMicrotiming}
              onChange={(e) => setUseMicrotiming(e.target.checked)}
            />
            Microtiming Humano
          </label>
          <span className="muted small ai-model-hint">{AI_MODEL_LABELS[modelName].hint}</span>
        </div>

        <div className="ai-actions">
          <button
            type="button"
            className="btn"
            onClick={() => void handleFetchPlan()}
            disabled={loadingAction !== null || serverAction !== null || !block}
          >
            {loadingAction === "plan" ? "Consultando..." : "📐 Consultar Plano Teórico"}
          </button>
          {healthState === "offline" ? (
            <button
              type="button"
              className="btn primary"
              onClick={handleSkillGenerate}
              disabled={loadingAction !== null || serverAction !== null || !block}
            >
              {loadingAction === "generate" ? "Gerando..." : "🎼 Gerar via Skill (sem IA)"}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn primary"
                onClick={() => void handleGenerate()}
                disabled={
                  loadingAction !== null ||
                  serverAction !== null ||
                  !block ||
                  healthState !== "online" ||
                  !isSelectedModelInstalled
                }
                title={
                  healthState === "online" && !isSelectedModelInstalled
                    ? "Baixe os pesos do modelo no Hugging Face para habilitar o MIDI-GPT"
                    : undefined
                }
              >
                {loadingAction === "generate" ? "Gerando..." : "✨ Gerar com MIDI-GPT"}
              </button>
              {healthState === "online" && !isSelectedModelInstalled && (
                <button
                  type="button"
                  className="btn"
                  onClick={handleSkillGenerate}
                  disabled={loadingAction !== null || serverAction !== null || !block}
                >
                  🎼 Gerar via Skill (sem IA)
                </button>
              )}
            </>
          )}
          {appliedCount > 0 && (
            <button
              type="button"
              className="btn"
              onClick={handleUndo}
              disabled={!canUndo || loadingAction !== null}
              title="Desfazer última aplicação de IA (Ctrl+Z)"
            >
              ↩ Desfazer (Ctrl+Z)
            </button>
          )}
        </div>

        {errorMsg && (
          <div className="ai-alert error-box small" role="alert">
            {errorMsg}
          </div>
        )}
        {statusMsg && !errorMsg && (
          <div className="ai-alert ok-box small" role="status">
            {statusMsg}
          </div>
        )}

        {(plan || result?.validation_report) && (
          <section className="ai-result-card" aria-label="Plano teórico e validação">
            {plan && (
              <div className="ai-plan-block">
                <div className="ai-plan-head">
                  <strong>
                    Plano Teórico ({plan.camelot_key} · {plan.tonic_name} {plan.scale_id})
                  </strong>
                  <span className="muted small">
                    Voice-leading: {plan.voice_leading_style} · Groove: {plan.groove_style}
                  </span>
                </div>
                <div className="ai-chord-chips">
                  {plan.chord_progression_per_bar.map((sym, idx) => (
                    <span key={`${sym}-${idx}`} className="ai-chord-chip mono">
                      <span className="muted">{idx + 1}.</span> {sym}
                    </span>
                  ))}
                </div>
                {plan.theoretical_explanation && (
                  <p className="small muted ai-plan-text">{plan.theoretical_explanation}</p>
                )}
                <div className="ai-plan-footer">
                  <button
                    type="button"
                    className="btn small"
                    onClick={handleApplyPlanChords}
                    disabled={!block || loadingAction !== null}
                  >
                    ✓ Aplicar cifras do plano ao bloco
                  </button>
                </div>
              </div>
            )}

            {result?.validation_report && (
              <div className="ai-validation-row small">
                <span className={result.validation_report.is_valid ? "ok-text" : "warn"}>
                  {result.validation_report.is_valid ? "✓ Validação harmônica aprovada" : "⚠ Atenção na validação"}
                </span>
                <span className="mono muted">
                  Escala: {Math.round(result.validation_report.scale_adherence * 100)}%
                </span>
                <span className="mono muted">
                  Voice-leading: {Math.round(result.validation_report.voice_leading_score * 100)}%
                </span>
                <span className="mono muted">Modelo: {result.model_used}</span>
              </div>
            )}
          </section>
        )}
      </div>
    </div>,
    document.body,
  );
}
