import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

type Options = {
  /** Número de opções navegáveis (títulos de grupo não contam). */
  count: number;
  open: boolean;
  /** Índice ativo ao abrir (a opção atualmente escolhida). */
  initial: number;
  onChoose: (index: number) => void;
  /** Alt+P: ouvir a opção ativa. */
  onPlay?: (index: number) => void;
  /** Chamado quando o teclado move o cursor. */
  onNavigate?: () => void;
};

/** Combobox + listbox com `aria-activedescendant`: o foco fica no campo de busca. Esc é tratado pelo `usePopover`. */
export function useListbox({ count, open, initial, onChoose, onPlay, onNavigate }: Options) {
  const base = useId();
  const [active, setActive] = useState(0);
  const initialRef = useRef(initial);
  useEffect(() => {
    initialRef.current = initial;
  });

  const listId = `${base}-list`;
  const optionId = useCallback((i: number) => `${base}-opt-${i}`, [base]);

  useEffect(() => {
    if (open) setActive(Math.max(0, initialRef.current));
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(optionId(active))?.scrollIntoView?.({ block: "nearest" });
  }, [open, active, optionId]);

  const move = (to: number) => {
    if (count === 0) return;
    setActive((to + count) % count);
    onNavigate?.();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const i = Math.min(active, count - 1);
    const nav: Record<string, number | undefined> = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: count - 1 };
    if (nav[e.key] !== undefined) {
      e.preventDefault();
      move(nav[e.key]!);
    } else if (e.key === "Enter" && count > 0) {
      e.preventDefault();
      onChoose(i);
    } else if (e.altKey && e.code === "KeyP" && count > 0) {
      e.preventDefault();
      onPlay?.(i);
    }
  };

  return {
    active,
    resetActive: () => setActive(0),
    listId,
    optionId,
    inputProps: {
      role: "combobox" as const,
      "aria-expanded": open,
      "aria-controls": listId,
      "aria-activedescendant": count > 0 ? optionId(Math.min(active, count - 1)) : undefined,
      "aria-autocomplete": "list" as const,
      title: "↑↓ navegam · Enter escolhe · Alt+P ouve",
      onKeyDown,
    },
  };
}
