import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { previewNotes, stop } from "../../audio/engine";
import type { Chord } from "../../core/chords";
import { makeQuestion, scoreAnswer, type PracticeLevel, type Question } from "../../core/practice";
import { voiceChord } from "../../core/voicing";
import { currentInstrument, useCtx } from "../hooks";

/** Intervalo entre os acordes da cadência (ms) e pausa extra antes do acorde-alvo. */
const STEP_MS = 900;
const TARGET_GAP_MS = 400;

type Score = { right: number; total: number; streak: number };

export function Practice({ onClose }: { onClose: () => void }) {
  const ctx = useCtx();
  const [level, setLevel] = useState<PracticeLevel>("basic");
  const [question, setQuestion] = useState<Question | null>(() => (ctx ? makeQuestion(ctx, "basic", Math.random) : null));
  const [answer, setAnswer] = useState<number | null>(null);
  const [score, setScore] = useState<Score>({ right: 0, total: 0, streak: 0 });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const dialog = useRef<HTMLDivElement>(null);
  const listenBtn = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const sound = useCallback((chord: Chord) => {
    void previewNotes(voiceChord(chord), currentInstrument());
  }, []);

  const listen = useCallback(
    (q: Question | null) => {
      if (!q) return;
      clearTimers();
      stop();
      const seq = [...q.cadence, q.target.chord];
      seq.forEach((chord, i) => {
        const at = i * STEP_MS + (i === seq.length - 1 ? TARGET_GAP_MS : 0);
        timers.current.push(setTimeout(() => sound(chord), at));
      });
    },
    [clearTimers, sound],
  );

  const next = useCallback(
    (lvl: PracticeLevel, previous?: number) => {
      setAnswer(null);
      const q = ctx ? makeQuestion(ctx, lvl, Math.random, previous) : null;
      setQuestion(q);
      listen(q);
    },
    [ctx, listen],
  );

  // Ao abrir: foco em "Ouvir". Ao fechar/desmontar: cancela timers e para o áudio.
  useEffect(() => {
    listenBtn.current?.focus();
    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      stop();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const respond = (degreeIndex: number) => {
    if (!question || answer !== null) return;
    const ok = scoreAnswer(question, degreeIndex);
    setAnswer(degreeIndex);
    setScore((s) => ({ right: s.right + (ok ? 1 : 0), total: s.total + 1, streak: ok ? s.streak + 1 : 0 }));
    clearTimers();
    stop();
    sound(question.target.chord);
  };

  const changeLevel = (lvl: PracticeLevel) => {
    if (lvl === level) return;
    setLevel(lvl);
    next(lvl);
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Tab") {
      const els = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? []);
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      listen(question);
    } else if (/^[1-7]$/.test(e.key) && question) {
      e.stopPropagation();
      const opt = question.options[Number(e.key) - 1];
      if (opt) respond(opt.degreeIndex);
    }
  };

  const picked = question?.options.find((o) => o.degreeIndex === answer);
  const correct = question && answer !== null && scoreAnswer(question, answer);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialog}
        className="modal practice"
        role="dialog"
        aria-modal="true"
        aria-label="Modo prática"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h3>🎧 Modo prática</h3>
        {!ctx || !question ? (
          <p>Defina a tônica para praticar</p>
        ) : (
          <>
            <p className="muted small">Ouça a cadência e adivinhe o grau do último acorde. Teclas 1–7 respondem; Espaço ouve de novo.</p>
            <div className="practice-levels" role="group" aria-label="Nível">
              <button className={`btn${level === "basic" ? " primary" : ""}`} aria-pressed={level === "basic"} onClick={() => changeLevel("basic")}>
                Básico
              </button>
              <button className={`btn${level === "all" ? " primary" : ""}`} aria-pressed={level === "all"} onClick={() => changeLevel("all")}>
                Todos os graus
              </button>
            </div>
            <button ref={listenBtn} className="btn primary" onClick={() => listen(question)}>
              ▶ Ouvir
            </button>
            <div className="practice-answers" role="group" aria-label="Resposta">
              {question.options.map((o, i) => (
                <button key={o.degreeIndex} className="btn" disabled={answer !== null} onClick={() => respond(o.degreeIndex)} aria-keyshortcuts={String(i + 1)}>
                  {o.roman}
                </button>
              ))}
            </div>
            <p className={`practice-feedback${answer === null ? "" : correct ? " ok" : " bad"}`} role="status">
              {answer === null ? "" : correct ? `✓ Isso: ${question.target.roman}` : `✗ Era ${question.target.roman} — você marcou ${picked?.roman}`}
            </p>
            <p className="practice-score small" aria-label="Placar">
              Acertos {score.right}/{score.total} · sequência {score.streak}
            </p>
          </>
        )}
        <div className="modal-actions">
          {ctx && question && (
            <button className="btn" disabled={answer === null} onClick={() => next(level, question.target.degreeIndex)}>
              Próxima
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
