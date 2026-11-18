// Modo de espelhamento do app de desktop (`?mirror-samples`): carrega, um a um, todos os
// instrumentos com samples para que o processo principal grave os arquivos baixados e os embuta
// no instalador. Ao terminar, publica o resultado no título da janela (o processo principal lê).

import { disposeInstrument, instrumentStatus, preload, subscribeStatus, type LoadStatus } from "../audio/engine";
import { primeAudioContext } from "../audio/context";
import { INSTRUMENTS } from "../audio/instruments";

const TIMEOUT_MS = 180_000;

function settled(id: string): Promise<LoadStatus> {
  return new Promise((resolve) => {
    const check = () => {
      const st = instrumentStatus(id);
      if (st === "ready" || st === "error") {
        stopListening();
        clearTimeout(timer);
        resolve(st);
      }
    };
    const stopListening = subscribeStatus(check);
    const timer = setTimeout(() => {
      stopListening();
      resolve("error");
    }, TIMEOUT_MS);
    check();
  });
}

export async function mirrorAllSamples(): Promise<void> {
  primeAudioContext();
  const result: Record<string, LoadStatus> = {};
  for (const def of INSTRUMENTS) {
    if (def.engine !== "sampler") continue;
    preload(def.id);
    result[def.id] = await settled(def.id);
    console.log(`${def.id}: ${result[def.id]}`);
    disposeInstrument(def.id);
  }
  document.title = `MIRROR:${JSON.stringify(result)}`;
}
