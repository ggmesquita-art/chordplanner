import { useRef } from "react";

/** `ariaLabel`: nome acessível quando o texto é só um ícone. */
export type SegmentedOption<T extends string> = { value: T; text: string; title?: string; ariaLabel?: string; disabled?: boolean };

/** Grupo de rádio com roving tabindex: setas movem e selecionam a opção vizinha habilitada. */
export function Segmented<T extends string>({ value, options, onChange, label, small }: { value: T; options: SegmentedOption<T>[]; onChange: (v: T) => void; label: string; small?: boolean }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const go = (from: number, step: 1 | -1 | "first" | "last") => {
    const n = options.length;
    let i = step === "first" ? -1 : step === "last" ? n : from;
    const d = step === "first" ? 1 : step === "last" ? -1 : step;
    for (let k = 0; k < n; k++) {
      i = (i + d + n) % n;
      if (!options[i].disabled) {
        onChange(options[i].value);
        refs.current[i]?.focus();
        return;
      }
    }
  };

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: "first", End: "last" }[e.key] as 1 | -1 | "first" | "last" | undefined;
    if (step === undefined) return;
    e.preventDefault();
    go(i, step);
  };

  // Se a opção marcada estiver desabilitada, a primeira habilitada mantém o foco por Tab.
  const tabbable = options.findIndex((o) => o.value === value && !o.disabled);
  const tabIndexFor = (i: number) => (i === (tabbable >= 0 ? tabbable : options.findIndex((o) => !o.disabled)) ? 0 : -1);

  return (
    <div className={`segmented ${small ? "small" : ""}`} role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => void (refs.current[i] = el)}
          role="radio"
          aria-checked={value === o.value}
          tabIndex={tabIndexFor(i)}
          className={value === o.value ? "on" : ""}
          title={o.title}
          aria-label={o.ariaLabel}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}
