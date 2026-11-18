import { useEffect } from "react";
import { useStore } from "../state/store";

/** Aplica o tema escolhido em `<html data-theme>`; "auto" remove o atributo e segue o sistema. */
export function useTheme() {
  const theme = useStore((s) => s.theme);
  useEffect(() => {
    const el = document.documentElement;
    if (theme === "auto") delete el.dataset.theme;
    else el.dataset.theme = theme;
  }, [theme]);
}
