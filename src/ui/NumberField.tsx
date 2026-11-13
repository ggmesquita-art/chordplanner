import { useEffect, useRef, useState } from "react";

type Props = {
  value: number | undefined;
  min: number;
  max: number;
  onCommit: (v: number | undefined) => void;
  allowEmpty?: boolean;
  placeholder?: string;
  title?: string;
  "aria-label"?: string;
};

const asDraft = (v: number | undefined) => (v === undefined ? "" : String(v));

/** Campo numérico que só aplica o limite ao sair (blur/Enter); digitar nunca reescreve o texto. */
export function NumberField({ value, min, max, onCommit, allowEmpty, placeholder, title, "aria-label": ariaLabel }: Props) {
  const [draft, setDraft] = useState(asDraft(value));
  const focused = useRef(false);

  // Mudança externa (desfazer, tap, troca de bloco): o rascunho acompanha.
  useEffect(() => {
    if (!focused.current || (draft.trim() === "" ? value !== undefined : Number(draft) !== value)) setDraft(asDraft(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Só confirma o que mudou: sair do campo sem editar não pode criar um passo vazio no desfazer.
  const commit = () => {
    if (draft.trim() === "") {
      if (!allowEmpty) setDraft(asDraft(value));
      else if (value !== undefined) onCommit(undefined);
      return;
    }
    const n = Number(draft);
    if (!Number.isFinite(n)) return setDraft(asDraft(value));
    const v = Math.max(min, Math.min(max, Math.round(n)));
    if (v !== value) onCommit(v);
    setDraft(String(v));
  };

  return (
    <input
      type="number"
      min={min}
      max={max}
      value={draft}
      placeholder={placeholder}
      title={title}
      aria-label={ariaLabel}
      onFocus={() => (focused.current = true)}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        const n = Number(text);
        if (text.trim() !== "" && Number.isInteger(n) && n >= min && n <= max && n !== value) onCommit(n);
      }}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}
