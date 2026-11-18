// Registro do service worker + store mínimo (subscribe/snapshot) para o aviso de atualização.

export interface PwaEstado {
  updateReady: boolean;
  offlineReady: boolean;
}

let estado: PwaEstado = { updateReady: false, offlineReady: false };
const ouvintes = new Set<() => void>();
let esperando: ServiceWorker | null = null;

function atualiza(parcial: Partial<PwaEstado>) {
  estado = { ...estado, ...parcial };
  ouvintes.forEach((l) => l());
}

export const pwaStore = {
  subscribe(l: () => void) {
    ouvintes.add(l);
    return () => void ouvintes.delete(l);
  },
  getSnapshot: (): PwaEstado => estado,
  /** Some o aviso "pronto offline". */
  dismissOffline: () => atualiza({ offlineReady: false }),
};

/** Pede ao SW em espera para assumir; a página recarrega quando o controller mudar. */
export function applyUpdate() {
  if (!esperando) return;
  esperando.postMessage({ type: "SKIP_WAITING" });
}

/** Só para testes. */
export function resetPwa() {
  estado = { updateReady: false, offlineReady: false };
  esperando = null;
  ouvintes.clear();
}

/** Registra o SW (apenas em produção e contextos com suporte). Devolve a registration ou null. */
export async function registerServiceWorker(
  opts: { enabled?: boolean; baseUrl?: string } = {},
): Promise<ServiceWorkerRegistration | null> {
  const enabled = opts.enabled ?? import.meta.env.PROD;
  if (!enabled || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const sw = navigator.serviceWorker;
  const base = opts.baseUrl ?? import.meta.env.BASE_URL;
  // Já havia controller → um SW novo instalado é atualização; senão é a primeira instalação.
  const jaControlada = !!sw.controller;
  let recarregando = false;
  sw.addEventListener("controllerchange", () => {
    if (!jaControlada || recarregando) return;
    recarregando = true;
    location.reload();
  });

  const reg = await sw.register(`${base}sw.js`);
  const observa = (w: ServiceWorker) => {
    w.addEventListener("statechange", () => {
      if (w.state !== "installed") return;
      if (sw.controller) {
        esperando = w;
        atualiza({ updateReady: true });
      } else atualiza({ offlineReady: true });
    });
  };
  if (reg.waiting && sw.controller) {
    esperando = reg.waiting;
    atualiza({ updateReady: true });
  } else if (reg.installing) observa(reg.installing);
  reg.addEventListener("updatefound", () => {
    if (reg.installing) observa(reg.installing);
  });
  return reg;
}
