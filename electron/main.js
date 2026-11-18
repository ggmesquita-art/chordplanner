// Processo principal do app de desktop (Electron).
//
// - O app web compilado (dist/) é servido pelo esquema próprio app://chordplanner/, que é "seguro"
//   (Cache API, Web MIDI e áudio funcionam como em https).
// - Os samples dos instrumentos são pedidos pelo app a hosts https conhecidos. Aqui essas requisições
//   são interceptadas e respondidas do disco: primeiro o pacote embutido no app (resources/samples),
//   depois o cache do usuário; se faltar, baixa uma vez e guarda no cache. Assim o app funciona offline.
// - `--mirror-samples` abre o app escondido, carrega todos os instrumentos e grava os samples em
//   desktop-samples/ (usado no build para embutir os samples no instalador).

import { app, BrowserWindow, nativeTheme, net, protocol, screen, session, shell } from "electron";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCHEME = "app";
const ORIGIN = `${SCHEME}://chordplanner`;
/** Hosts de onde o smplr e o plano B (FluidR3) baixam samples. */
const SAMPLE_HOSTS = new Set(["smpldsnds.github.io", "gleitz.github.io", "goldst.dev"]);
const MIME = { ".json": "application/json", ".js": "text/javascript", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".wav": "audio/wav", ".sfz": "text/plain" };

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const distDir = path.join(root, "dist");
const mirrorMode = process.argv.includes("--mirror-samples");
/** Teste: simula o computador sem internet (o https para fora falha; só o disco responde). */
const offline = !!process.env.CHORDPLANNER_OFFLINE;
const bundledSamples = app.isPackaged ? path.join(process.resourcesPath, "samples") : path.join(root, "desktop-samples");
const cacheDir = () => (mirrorMode ? bundledSamples : path.join(app.getPath("userData"), "samples"));

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } }]);

/** Caminho relativo seguro (host/caminho) para guardar a resposta de uma URL; null se suspeito. */
function sampleRel(url) {
  const parts = decodeURIComponent(url.pathname).split("/").filter(Boolean);
  if (!parts.length || parts.some((p) => p === ".." || p === "." || p.includes("\\"))) return null;
  return path.join(url.hostname, ...parts);
}

const exists = (f) => fs.stat(f).then((s) => s.isFile(), () => false);

function fileResponse(file) {
  const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  return new Response(Readable.toWeb(createReadStream(file)), { headers: { "content-type": type, "access-control-allow-origin": "*" } });
}

async function handleSample(req, url) {
  const rel = sampleRel(url);
  if (!rel) return net.fetch(req, { bypassCustomProtocolHandlers: true });
  for (const dir of [bundledSamples, cacheDir()]) {
    const file = path.join(dir, rel);
    if (await exists(file)) return fileResponse(file);
  }
  if (offline) return new Response(null, { status: 504 });
  // O GitHub Pages responde 503 em rajadas (o smplr pede centenas de arquivos de uma vez): tenta de novo.
  // "no-store": o arquivo vai para o cache de samples; não precisa de outra cópia no cache HTTP
  // (e um 503 do CDN não fica guardado lá).
  const get = () => net.fetch(req.url, { bypassCustomProtocolHandlers: true, cache: "no-store" });
  let res = await get();
  for (const wait of [800, 2500, 6000]) {
    if (res.status < 500) break;
    await new Promise((r) => setTimeout(r, wait));
    res = await get();
  }
  if (!res.ok) return res;
  const body = Buffer.from(await res.arrayBuffer());
  const file = path.join(cacheDir(), rel);
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, body);
    await fs.rename(tmp, file);
  } catch (err) {
    console.warn("não foi possível guardar o sample", rel, err);
  }
  const headers = new Headers(res.headers);
  headers.set("access-control-allow-origin", "*");
  headers.delete("content-encoding"); // o corpo já veio descomprimido
  headers.delete("content-length");
  return new Response(body, { status: res.status, headers });
}

function registerProtocols() {
  // App web compilado.
  protocol.handle(SCHEME, (req) => {
    const { pathname } = new URL(req.url);
    const rel = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
    const file = path.normalize(path.join(distDir, rel));
    if (!file.startsWith(distDir + path.sep)) return new Response("não encontrado", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  // Samples: disco primeiro; o resto do https segue normal.
  protocol.handle("https", (req) => {
    const url = new URL(req.url);
    if (req.method === "GET" && SAMPLE_HOSTS.has(url.hostname)) {
      return handleSample(req, url).catch((err) => {
        console.warn("falha ao servir sample", req.url, err);
        return new Response(null, { status: 502 });
      });
    }
    return offline ? Response.error() : net.fetch(req, { bypassCustomProtocolHandlers: true });
  });
}

function setPermissions() {
  // Web MIDI e copiar para a área de transferência, só para o próprio app. O Electron pede
  // "midiSysex" mesmo quando a página chama requestMIDIAccess({ sysex: false }).
  const allowed = new Set(["midi", "midiSysex", "clipboard-sanitized-write"]);
  const ours = (url) => typeof url === "string" && url.startsWith(ORIGIN);
  const debug = !!process.env.CHORDPLANNER_DEBUG;
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
    if (debug) console.log("permission request", permission, JSON.stringify(details));
    cb(allowed.has(permission) && ours(details.requestingUrl ?? wc.getURL()));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => {
    if (debug) console.log("permission check", permission, origin);
    return allowed.has(permission) && ours(origin);
  });
}

function createWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: Math.min(1440, sw),
    height: Math.min(900, sh),
    minWidth: 960,
    minHeight: 600,
    title: "ChordPlanner",
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0f1117" : "#f4f5f9",
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      // App instalado: o som sai sem precisar de clique antes (teclado MIDI toca logo ao abrir).
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  if (!mirrorMode) win.once("ready-to-show", () => win.show());

  // Links externos abrem no navegador; a janela só navega dentro do app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (url.startsWith(ORIGIN)) return;
    e.preventDefault();
    if (/^(https?|mailto):/.test(url)) void shell.openExternal(url);
  });

  if (mirrorMode) {
    win.webContents.on("page-title-updated", (_e, title) => {
      if (!title.startsWith("MIRROR:")) return;
      console.log(title.slice(7));
      app.quit();
    });
    win.webContents.on("console-message", (e) => console.log("[app]", e.message));
  }

  void win.loadURL(`${ORIGIN}/index.html${mirrorMode ? "?mirror-samples" : ""}`);
  return win;
}

if (!mirrorMode && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    registerProtocols();
    setPermissions();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin" || mirrorMode) app.quit();
  });
}
