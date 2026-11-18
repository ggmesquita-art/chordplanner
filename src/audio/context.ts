// AudioContext criado DENTRO de um gesto do usuário, sem Tone. O Safari/iOS só deixa
// um contexto sair de "suspended" dentro da ativação do usuário; como o motor (Tone)
// chega depois por import(), o contexto nasce aqui, de forma síncrona, e o motor o adota.

let ctx: AudioContext | null = null;

type Ctor = typeof AudioContext;
const ctorOf = (): Ctor | undefined =>
  typeof window === "undefined" ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext);

/** Cria (se preciso) e retoma o contexto. Chame de forma síncrona num handler de gesto. */
export function primeAudioContext(): void {
  const Ctor = ctorOf();
  if (!Ctor) return;
  try {
    ctx ??= new Ctor({ latencyHint: "interactive" });
    if (ctx.state !== "running") void ctx.resume().catch(() => {});
  } catch {
    // Sem áudio no ambiente (testes, navegador restrito): o motor cria o seu.
  }
}

/** Contexto criado no gesto, se houver; o motor o adota ao carregar. */
export const gestureAudioContext = (): AudioContext | null => ctx;
