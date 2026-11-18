// Lógica pura do service worker (testável): lista de precache, versão e código do sw.js.
// Samples de instrumentos NÃO passam por aqui: o smplr guarda em Cache API ("chordplanner-samples",
// ver src/audio/loaders.ts) e as requisições cross-origin não são interceptadas pelo SW.

/** Arquivos que nunca entram no precache (o próprio SW e mapas de fonte). */
const IGNORADOS = /(^|\/)sw\.js$|\.map$/;

/** Normaliza, remove ignorados/duplicados e ordena (versão estável). */
export function listaPrecache(arquivos: readonly string[]): string[] {
  const set = new Set<string>();
  for (const a of arquivos) {
    const n = a.replace(/\\/g, "/").replace(/^\.?\//, "");
    if (n && !IGNORADOS.test(n)) set.add(n);
  }
  return [...set].sort();
}

/** Hash (FNV-1a 32 bits, hex) da lista: muda quando entra/sai/renomeia arquivo hashado. */
export function versaoSw(lista: readonly string[]): string {
  let h = 0x811c9dc5;
  for (const c of lista.join("\n")) {
    h ^= c.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Código do sw.js. URLs são relativas ao escopo do SW (funciona em subcaminho). */
export function renderSw(arquivos: readonly string[]): string {
  const lista = listaPrecache(arquivos);
  const versao = versaoSw(lista);
  return `// Gerado no build — não editar. Versão ${versao}
const VERSAO = ${JSON.stringify(versao)};
const CACHE = "chordplanner-shell-" + VERSAO;
const ARQUIVOS = ${JSON.stringify(lista, null, 1)};
const escopo = self.registration.scope;
const urls = ARQUIVOS.map((a) => new URL(a, escopo).href);
const raiz = new URL("index.html", escopo).href;

self.addEventListener("install", (e) => {
  // Sem skipWaiting aqui: a nova versão espera o usuário aceitar (mensagem SKIP_WAITING).
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(urls)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith("chordplanner-shell-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // CDN de samples: smplr/Cache API cuidam
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match(raiz, { cacheName: CACHE })));
    return;
  }
  const chave = url.origin + url.pathname;
  if (urls.includes(chave)) {
    e.respondWith(caches.match(chave, { cacheName: CACHE }).then((r) => r || fetch(req)));
  }
});
`;
}
