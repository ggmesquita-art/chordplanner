import { describe, expect, it, vi } from "vitest";
import { okOnlyCache } from "./sampleCache";

/** Cache API mínima em memória. */
function fakeCaches() {
  const store = new Map<string, Response>();
  const cache = {
    match: async (r: Request) => store.get(r.url)?.clone(),
    put: async (r: Request, res: Response) => void store.set(r.url, res),
    delete: async (r: Request) => store.delete(r.url),
  } as unknown as Cache;
  return { store, api: { open: async () => cache } as unknown as CacheStorage };
}

const URL_A = "https://example.test/a.ogg";

describe("okOnlyCache", () => {
  it("guarda 200 e serve do cache na segunda vez", async () => {
    const { store, api } = fakeCaches();
    const net = vi.fn(async () => new Response("ok", { status: 200 }));
    const c = okOnlyCache("x", api, net as unknown as typeof fetch);
    expect((await c.fetch(URL_A)).status).toBe(200);
    expect(await (await c.fetch(URL_A)).text()).toBe("ok");
    expect(net).toHaveBeenCalledTimes(1);
    expect(store.has(URL_A)).toBe(true);
  });

  it("não guarda 503: a próxima tentativa vai à rede", async () => {
    const { store, api } = fakeCaches();
    const net = vi.fn().mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const c = okOnlyCache("x", api, net as unknown as typeof fetch);
    expect((await c.fetch(URL_A)).status).toBe(503);
    expect(store.has(URL_A)).toBe(false);
    expect((await c.fetch(URL_A)).status).toBe(200);
    expect(store.has(URL_A)).toBe(true);
  });

  it("entrada de erro gravada antes (pelo cache antigo) é descartada e baixada de novo", async () => {
    const { store, api } = fakeCaches();
    store.set(URL_A, new Response("", { status: 503 }));
    const net = vi.fn(async () => new Response("ok", { status: 200 }));
    const c = okOnlyCache("x", api, net as unknown as typeof fetch);
    expect((await c.fetch(URL_A)).status).toBe(200);
    expect(net).toHaveBeenCalledTimes(1);
  });

  it("sem Cache API utilizável, vai direto à rede", async () => {
    const api = { open: () => Promise.reject(new Error("não")) } as unknown as CacheStorage;
    const net = vi.fn(async () => new Response("ok", { status: 200 }));
    const c = okOnlyCache("x", api, net as unknown as typeof fetch);
    expect((await c.fetch(URL_A)).status).toBe(200);
  });
});
