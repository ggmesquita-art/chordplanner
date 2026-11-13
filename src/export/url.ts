// Link de compartilhamento: a música vai no fragmento da URL (nada passa por servidor).
// Formato: `#s=<modo>.<base64url>`; modo "1" = deflate-raw, modo "0" = JSON puro em UTF-8.

import { parseSongFile, serializeSongFile, type SongFile } from "./json";

export const SHARE_PREFIX = "#s=";

const CHUNK = 0x8000;
/** Limites para links recebidos de terceiros: evitam travar a aba com um link gigante ou uma "bomba" de compressão. */
const MAX_HASH_CHARS = 400_000;
const MAX_JSON_BYTES = 2_000_000;

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, maxBytes = Infinity): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  // Sem await: a escrita só termina quando a leitura consome a saída.
  writer.write(bytes as BufferSource).catch(() => {});
  writer.close().catch(() => {});
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      void reader.cancel().catch(() => {});
      throw new Error("conteúdo grande demais");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export async function encodeShare(file: SongFile): Promise<string> {
  const raw = new TextEncoder().encode(serializeSongFile(file));
  if (typeof CompressionStream !== "undefined") {
    try {
      return `${SHARE_PREFIX}1.${toBase64Url(await pipe(raw, new CompressionStream("deflate-raw")))}`;
    } catch {
      // cai no modo sem compressão
    }
  }
  return `${SHARE_PREFIX}0.${toBase64Url(raw)}`;
}

export async function decodeShare(hash: string): Promise<SongFile | null> {
  try {
    const h = hash.startsWith("#") ? hash : `#${hash}`;
    if (!h.startsWith(SHARE_PREFIX) || h.length > MAX_HASH_CHARS) return null;
    const body = h.slice(SHARE_PREFIX.length);
    const dot = body.indexOf(".");
    if (dot < 0) return null;
    const mode = body.slice(0, dot);
    const bytes = fromBase64Url(body.slice(dot + 1));
    let json: Uint8Array;
    if (mode === "0") json = bytes;
    else if (mode === "1") {
      if (typeof DecompressionStream === "undefined") return null;
      json = await pipe(bytes, new DecompressionStream("deflate-raw"), MAX_JSON_BYTES);
    } else return null;
    return parseSongFile(new TextDecoder("utf-8", { fatal: true }).decode(json));
  } catch {
    return null;
  }
}
