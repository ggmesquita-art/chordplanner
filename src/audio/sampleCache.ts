// Cache dos samples baixados pelo smplr (Cache API).

export type SampleStorage = { fetch: (url: string) => Promise<Response> };

/**
 * Cache API que só guarda respostas 2xx. O `CacheStorage` do smplr grava qualquer resposta, então um
 * 503 passageiro do servidor de samples ficaria guardado para sempre (e aquela nota, muda). Entradas
 * ruins gravadas antes são descartadas e baixadas de novo.
 */
export function okOnlyCache(name: string, cachesApi: CacheStorage = caches, fetchFn: typeof fetch = fetch): SampleStorage {
  const opened = cachesApi.open(name);
  return {
    async fetch(url) {
      const request = new Request(url);
      let cache: Cache | null = null;
      try {
        cache = await opened;
        const hit = await cache.match(request);
        if (hit?.ok) return hit;
        if (hit) await cache.delete(request);
      } catch {
        // sem Cache API utilizável: só rede
      }
      const response = await fetchFn(request);
      if (response.ok && cache) await cache.put(request, response.clone()).catch(() => {});
      return response;
    },
  };
}
