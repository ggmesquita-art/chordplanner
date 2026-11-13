/** Remove caracteres inválidos em nomes de arquivo. */
export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "chordplanner";
}

/** Baixa um texto como arquivo no navegador. */
export function downloadText(text: string, filename: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
