import { afterEach, describe, expect, it, vi } from "vitest";
import { applyUpdate, pwaStore, registerServiceWorker, resetPwa } from "./pwa";
import { listaPrecache, renderSw, versaoSw } from "./sw/precache";

describe("precache", () => {
  it("normaliza, ordena, deduplica e ignora sw.js/mapas", () => {
    const l = listaPrecache(["./index.html", "assets/b.js", "/assets/a.js", "assets/a.js", "sw.js", "assets/a.js.map", "icons/i.png"]);
    expect(l).toEqual(["assets/a.js", "assets/b.js", "icons/i.png", "index.html"]);
  });
  it("versão é estável e muda com a lista", () => {
    const a = versaoSw(["a", "b"]);
    expect(versaoSw(["a", "b"])).toBe(a);
    expect(versaoSw(["a", "c"])).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });
  it("sw.js contém os arquivos e a versão", () => {
    const src = renderSw(["index.html", "assets/player-x.js"]);
    expect(src).toContain('"assets/player-x.js"');
    expect(src).toContain(versaoSw(["assets/player-x.js", "index.html"]));
    expect(() => new Function(src)).not.toThrow();
  });
});

class FakeSW extends EventTarget {
  state = "installing";
  postMessage = vi.fn();
}

function fakeNav(controller: unknown, reg: EventTarget) {
  const sw = Object.assign(new EventTarget(), { controller, register: vi.fn().mockResolvedValue(reg) });
  Object.defineProperty(globalThis.navigator, "serviceWorker", { value: sw, configurable: true });
  return sw;
}

describe("registerServiceWorker / store", () => {
  afterEach(() => {
    resetPwa();
    Reflect.deleteProperty(globalThis.navigator, "serviceWorker");
  });

  it("não registra quando desabilitado (dev)", async () => {
    expect(await registerServiceWorker({ enabled: false })).toBeNull();
  });

  it("primeira instalação → offlineReady", async () => {
    const w = new FakeSW();
    const reg = Object.assign(new EventTarget(), { installing: null, waiting: null });
    const sw = fakeNav(null, reg);
    await registerServiceWorker({ enabled: true, baseUrl: "/app/" });
    expect(sw.register).toHaveBeenCalledWith("/app/sw.js");
    (reg as { installing: unknown }).installing = w;
    reg.dispatchEvent(new Event("updatefound"));
    w.state = "installed";
    w.dispatchEvent(new Event("statechange"));
    expect(pwaStore.getSnapshot()).toEqual({ updateReady: false, offlineReady: true });
    pwaStore.dismissOffline();
    expect(pwaStore.getSnapshot().offlineReady).toBe(false);
  });

  it("atualização → updateReady e applyUpdate manda SKIP_WAITING; notifica assinantes", async () => {
    const w = new FakeSW();
    const reg = Object.assign(new EventTarget(), { installing: null, waiting: null });
    fakeNav({}, reg);
    const l = vi.fn();
    pwaStore.subscribe(l);
    await registerServiceWorker({ enabled: true, baseUrl: "./" });
    (reg as { installing: unknown }).installing = w;
    reg.dispatchEvent(new Event("updatefound"));
    w.state = "installed";
    w.dispatchEvent(new Event("statechange"));
    expect(pwaStore.getSnapshot().updateReady).toBe(true);
    expect(l).toHaveBeenCalled();
    applyUpdate();
    expect(w.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });

  it("SW já em espera com controller → updateReady imediato", async () => {
    const w = new FakeSW();
    fakeNav({}, Object.assign(new EventTarget(), { installing: null, waiting: w }));
    await registerServiceWorker({ enabled: true });
    expect(pwaStore.getSnapshot().updateReady).toBe(true);
  });
});
