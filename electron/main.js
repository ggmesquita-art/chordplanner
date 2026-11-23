// Processo principal do app de desktop (Electron).
//
// - O app web compilado (dist/) é servido pelo esquema próprio app://chordplanner/, que é "seguro"
//   (Cache API, Web MIDI e áudio funcionam como em https).
// - Os samples dos instrumentos são pedidos pelo app a hosts https conhecidos. Aqui essas requisições
//   são interceptadas e respondidas do disco: primeiro o pacote embutido no app (resources/samples),
//   depois o cache do usuário; se faltar, baixa uma vez e guarda no cache. Assim o app funciona offline.
// - `--mirror-samples` abre o app escondido, carrega todos os instrumentos e grava os samples em
//   desktop-samples/ (usado no build para embutir os samples no instalador).

import { app, BrowserWindow, ipcMain, nativeTheme, net, protocol, screen, session, shell } from "electron";
import { execFile, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCHEME = "app";
const ORIGIN = `${SCHEME}://chordplanner`;
/** Hosts de onde o smplr e o plano B (FluidR3) baixam samples. */
const SAMPLE_HOSTS = new Set(["smpldsnds.github.io", "gleitz.github.io", "goldst.dev"]);
/** Hosts locais do serviço de IA (music_ai_module) permitidos mesmo em modo offline. */
const LOCAL_AI_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
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
const pathExists = (p) => fs.stat(p).then(() => true, () => false);

const AI_HOST = "127.0.0.1";
const AI_PORT = 8765;
const AI_HEALTH_URL = `http://${AI_HOST}:${AI_PORT}/health`;
const AI_MAX_LOGS = 30;
const AI_POLL_INTERVAL_MS = 400;
const AI_START_TIMEOUT_MS = 25000;
const AI_REQUIRED_DEPS = ["fastapi", "uvicorn", "midigpt"];

let aiChild = null;
let aiStartPromise = null;
let aiRecentLogs = [];
let aiQuitting = false;

function aiServerRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, "ai-server") : root;
}

async function aiSkillPath(aiRoot) {
  const bundledSkill = path.join(aiRoot, "music-composition");
  if (await pathExists(bundledSkill)) return bundledSkill;
  return path.join(root, ".agents", "skills", "music-composition");
}

async function findStandaloneBinary(aiRoot) {
  const exeName = process.platform === "win32" ? "chordplanner-ai.exe" : "chordplanner-ai";
  const candidates = [path.join(aiRoot, exeName), path.join(aiRoot, "bin", exeName)];
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

function runExecFile(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, timeout: 8000, ...options }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        error: error ?? null,
        stdout: typeof stdout === "string" ? stdout : String(stdout ?? ""),
        stderr: typeof stderr === "string" ? stderr : String(stderr ?? ""),
      });
    });
  });
}

async function inspectPythonCandidate(command, baseArgs) {
  const quickCheck = await runExecFile(command, [...baseArgs, "-c", "import fastapi, uvicorn, midigpt"]);
  if (quickCheck.ok) {
    return {
      status: "ok",
      command,
      baseArgs,
      pythonPath: baseArgs.length ? `${command} ${baseArgs.join(" ")}` : command,
    };
  }
  if (quickCheck.error?.code === "ENOENT") {
    return { status: "not_found" };
  }

  const diagCode =
    "import importlib.util, json, sys; " +
    "missing = [m for m in ('fastapi', 'uvicorn', 'midigpt') if importlib.util.find_spec(m) is None]; " +
    "print('__CHORDPLANNER_PY__:' + json.dumps({'exe': sys.executable, 'missing': missing}))";
  const diag = await runExecFile(command, [...baseArgs, "-c", diagCode]);
  const marker = "__CHORDPLANNER_PY__:";
  const line = diag.stdout
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(marker));
  if (!line) {
    return { status: "not_found" };
  }

  try {
    const parsed = JSON.parse(line.slice(marker.length));
    let missing = Array.isArray(parsed.missing) ? parsed.missing : [];
    if (missing.length === 0) {
      const verifiedMissing = [];
      for (const dep of AI_REQUIRED_DEPS) {
        const depCheck = await runExecFile(command, [...baseArgs, "-c", `import ${dep}`]);
        if (!depCheck.ok) verifiedMissing.push(dep);
      }
      missing = verifiedMissing.length > 0 ? verifiedMissing : [...AI_REQUIRED_DEPS];
    }
    return {
      status: "missing_deps",
      pythonPath: parsed.exe || (baseArgs.length ? `${command} ${baseArgs.join(" ")}` : command),
      missing,
    };
  } catch {
    return { status: "not_found" };
  }
}

async function findPythonCandidates(aiRoot) {
  const candidates = [];
  const seenFiles = new Set();
  const venvRoots = [
    path.join(aiRoot, ".venv_ai"),
    path.join(aiRoot, ".venv"),
    path.join(root, ".venv_ai"),
    path.join(root, ".venv"),
  ];

  for (const venvDir of venvRoots) {
    const relPaths =
      process.platform === "win32"
        ? [path.join("Scripts", "python.exe"), path.join("bin", "python.exe"), path.join("bin", "python")]
        : [path.join("bin", "python3"), path.join("bin", "python")];
    for (const rel of relPaths) {
      const fullPath = path.resolve(path.join(venvDir, rel));
      if (seenFiles.has(fullPath)) continue;
      seenFiles.add(fullPath);
      if (await exists(fullPath)) {
        candidates.push({ command: fullPath, baseArgs: [] });
      }
    }
  }

  candidates.push({ command: "python", baseArgs: [] });
  candidates.push({ command: "python3", baseArgs: [] });
  if (process.platform === "win32") {
    candidates.push({ command: "py", baseArgs: ["-3"] });
  }

  let firstMissingDeps = null;
  for (const candidate of candidates) {
    const result = await inspectPythonCandidate(candidate.command, candidate.baseArgs);
    if (result.status === "ok") {
      return {
        command: result.command,
        baseArgs: result.baseArgs,
        pythonPath: result.pythonPath,
      };
    }
    if (result.status === "missing_deps" && !firstMissingDeps) {
      firstMissingDeps = {
        missingDeps: true,
        pythonPath: result.pythonPath,
        missing: result.missing,
      };
    }
  }

  if (firstMissingDeps) return firstMissingDeps;
  return { missingPython: true };
}

function probeAIHealth(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(AI_HEALTH_URL, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => {
      resolve(false);
    });
  });
}

function appendAILog(streamName, chunk) {
  const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk ?? "");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    aiRecentLogs.push(`[${streamName}] ${line}`);
    while (aiRecentLogs.length > AI_MAX_LOGS) aiRecentLogs.shift();
  }
}

function isAIChildAlive() {
  return Boolean(aiChild && aiChild.exitCode === null && !aiChild.killed);
}

async function getAIServerStatus() {
  const starting = Boolean(aiStartPromise);
  const managed = isAIChildAlive();
  const running = await probeAIHealth(1500);
  let message = "Servidor IA parado.";
  if (running) {
    message = managed
      ? `Servidor IA em execução em ${AI_HOST}:${AI_PORT}.`
      : `Servidor IA já está em execução em ${AI_HOST}:${AI_PORT}.`;
  } else if (starting) {
    message = `Servidor IA iniciando em ${AI_HOST}:${AI_PORT}...`;
  }
  return {
    ok: true,
    running,
    starting,
    managed,
    pid: managed ? (aiChild?.pid ?? null) : null,
    message,
    recentLogs: [...aiRecentLogs],
  };
}

async function killChildProcess(child) {
  const pid = child?.pid;
  if (!pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    const res = await runExecFile("taskkill", ["/pid", String(pid), "/T", "/F"], { timeout: 5000 });
    if (!res.ok && child.exitCode === null) {
      try {
        child.kill();
      } catch {
        // ignore if already exited
      }
    }
    return;
  }
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    child.once("exit", finish);
    try {
      child.kill("SIGTERM");
    } catch {
      finish();
      return;
    }
    setTimeout(() => {
      if (!settled && child.exitCode === null) {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore if already exited
        }
      }
      finish();
    }, 2000);
  });
}

async function stopAIServer() {
  const child = aiChild;
  aiChild = null;
  if (child) {
    await killChildProcess(child);
  }
  const running = await probeAIHealth(500);
  return {
    ok: true,
    running,
    starting: false,
    managed: false,
    pid: null,
    message: child
      ? "Servidor IA encerrado."
      : running
        ? `Servidor IA externo ativo em ${AI_HOST}:${AI_PORT}.`
        : "Servidor IA parado.",
    recentLogs: [...aiRecentLogs],
  };
}

async function startAIServer() {
  if (aiStartPromise) return aiStartPromise;

  aiStartPromise = (async () => {
    const alreadyHealthy = await probeAIHealth(1500);
    if (alreadyHealthy) {
      const managed = isAIChildAlive();
      return {
        ok: true,
        running: true,
        managed,
        starting: false,
        pid: managed ? (aiChild?.pid ?? null) : null,
        message: "Servidor IA já está em execução em 127.0.0.1:8765.",
        recentLogs: [...aiRecentLogs],
      };
    }

    if (isAIChildAlive()) {
      await stopAIServer();
    }

    const aiRoot = aiServerRoot();
    const skillPath = await aiSkillPath(aiRoot);
    const standaloneBinary = await findStandaloneBinary(aiRoot);

    let command;
    let args;
    if (standaloneBinary) {
      command = standaloneBinary;
      args = [];
    } else {
      const py = await findPythonCandidates(aiRoot);
      if (py.missingPython) {
        return {
          ok: false,
          running: false,
          starting: false,
          managed: false,
          pid: null,
          missingPython: true,
          message: "Python 3 não encontrado. Instale Python 3.10+ e as dependências do servidor IA.",
          recentLogs: [...aiRecentLogs],
        };
      }
      if (py.missingDeps) {
        return {
          ok: false,
          running: false,
          starting: false,
          managed: false,
          pid: null,
          missingDeps: true,
          pythonPath: py.pythonPath,
          missing: py.missing,
          message: `Dependências Python ausentes (${py.missing.join(", ")}) em ${py.pythonPath}.`,
          recentLogs: [...aiRecentLogs],
        };
      }
      command = py.command;
      args = [...py.baseArgs, "-m", "music_ai_module.server"];
    }

    if (aiQuitting) {
      return {
        ok: false,
        running: false,
        starting: false,
        managed: false,
        pid: null,
        message: "Aplicativo em encerramento.",
        recentLogs: [...aiRecentLogs],
      };
    }

    aiRecentLogs = [];
    const prevPythonPath = process.env.PYTHONPATH;
    const pythonPathEnv = prevPythonPath ? `${aiRoot}${path.delimiter}${prevPythonPath}` : aiRoot;
    const env = {
      ...process.env,
      PYTHONPATH: pythonPathEnv,
      SKILL_PATH: skillPath,
      SERVER_HOST: AI_HOST,
      SERVER_PORT: String(AI_PORT),
      PYTHONUTF8: "1",
    };

    const child = spawn(command, args, {
      cwd: aiRoot,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    aiChild = child;

    if (aiQuitting) {
      await stopAIServer();
      return {
        ok: false,
        running: false,
        starting: false,
        managed: false,
        pid: null,
        message: "Aplicativo em encerramento.",
        recentLogs: [...aiRecentLogs],
      };
    }

    let exited = false;
    let exitDetail = "";
    child.stdout?.on("data", (chunk) => appendAILog("stdout", chunk));
    child.stderr?.on("data", (chunk) => appendAILog("stderr", chunk));
    child.once("error", (err) => {
      exited = true;
      exitDetail = err.message;
      appendAILog("error", err.message);
      if (aiChild === child) aiChild = null;
    });
    child.once("exit", (code, signal) => {
      exited = true;
      exitDetail = signal ? `signal ${signal}` : `code ${code}`;
      if (aiChild === child) aiChild = null;
    });

    const deadline = Date.now() + AI_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (exited || aiChild !== child) {
        return {
          ok: false,
          running: false,
          starting: false,
          managed: false,
          pid: null,
          message: `Servidor IA encerrou antes de ficar pronto (${exitDetail || "interrompido"}).`,
          recentLogs: [...aiRecentLogs],
        };
      }
      if (await probeAIHealth(1000)) {
        return {
          ok: true,
          running: true,
          starting: false,
          managed: true,
          pid: child.pid ?? null,
          message: "Servidor IA iniciado em 127.0.0.1:8765.",
          recentLogs: [...aiRecentLogs],
        };
      }
      if (exited || aiChild !== child) break;
      await new Promise((r) => setTimeout(r, AI_POLL_INTERVAL_MS));
    }

    if (exited || aiChild !== child) {
      return {
        ok: false,
        running: false,
        starting: false,
        managed: false,
        pid: null,
        message: `Servidor IA encerrou antes de ficar pronto (${exitDetail || "interrompido"}).`,
        recentLogs: [...aiRecentLogs],
      };
    }

    await stopAIServer();
    return {
      ok: false,
      running: false,
      starting: false,
      managed: false,
      pid: null,
      message: "Tempo limite (25s) ao iniciar o servidor IA em 127.0.0.1:8765.",
      recentLogs: [...aiRecentLogs],
    };
  })().finally(() => {
    aiStartPromise = null;
  });

  return aiStartPromise;
}

function registerAIHandlers() {
  ipcMain.handle("ai:start-server", () => startAIServer());
  ipcMain.handle("ai:stop-server", () => stopAIServer());
  ipcMain.handle("ai:server-status", () => getAIServerStatus());
}

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
  // Serviço local de IA (http://127.0.0.1:8765 / localhost): sempre permitido, mesmo com CHORDPLANNER_OFFLINE.
  protocol.handle("http", (req) => {
    const url = new URL(req.url);
    if (LOCAL_AI_HOSTS.has(url.hostname)) {
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
    }
    return offline ? Response.error() : net.fetch(req, { bypassCustomProtocolHandlers: true });
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
      preload: path.join(here, "preload.cjs"),
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
      void stopAIServer().finally(() => app.quit());
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
  app.on("before-quit", (e) => {
    if (aiQuitting) return;
    aiQuitting = true;
    if (!aiChild && !aiStartPromise) return;
    e.preventDefault();
    const waitStart = aiStartPromise ? aiStartPromise.catch(() => {}) : Promise.resolve();
    void waitStart
      .then(() => stopAIServer())
      .finally(() => {
        app.quit();
      });
  });
  app.whenReady().then(() => {
    registerProtocols();
    setPermissions();
    registerAIHandlers();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin" || mirrorMode) {
      aiQuitting = true;
      void stopAIServer().finally(() => app.quit());
    }
  });
}
