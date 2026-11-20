#!/usr/bin/env node
/**
 * NBA EDGE — starter z automatyczną aktualizacją.
 *   npm run serve        (albo dwuklik: „Uruchom NBA EDGE.bat” na Windows, „Uruchom NBA EDGE.command” na Macu)
 *
 * Co robi:
 *  1. Jeśli folder nie jest repozytorium Git (pobrany jako ZIP) — podłącza go do repozytorium z GitHuba,
 *     żeby dało się go aktualizować (pliki .env.local i folder data zostają nietknięte).
 *  2. Przy starcie sprawdza, czy na GitHubie jest nowa wersja; jeśli tak — pobiera ją, doinstalowuje
 *     zależności i buduje aplikację.
 *  3. Uruchamia aplikację i co kilka godzin sprawdza aktualizacje ponownie. Nową wersję instaluje
 *     tylko w dzień (10:00–20:00 czasu polskiego), bo mecze NBA są w Polsce w nocy — restart trwa 1–2 minuty.
 *  4. Gdy nowa wersja się nie zbuduje, wraca do poprzedniej i działa dalej.
 *
 * Ustawienia (w .env.local albo zmiennych środowiskowych):
 *   AUTO_UPDATE=0            wyłącza automatyczne aktualizacje
 *   UPDATE_CHECK_HOURS=3     co ile godzin sprawdzać (domyślnie 3)
 *   PORT=3000                port aplikacji
 * Plain Node (bez TypeScriptu), żeby działał nawet przed `npm install`.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WIN = process.platform === "win32";
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const REPO = String(pkg.repository?.url ?? pkg.repository ?? "").replace(/^git\+/, "");

// .env.local → process.env (tylko klucze, których jeszcze nie ma)
try {
  for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* brak .env.local — ustawienia domyślne */ }

const STATUS_FILE = path.join(path.resolve(ROOT, process.env.DATA_DIR || "./data"), "update-status.json");
const AUTO = process.env.AUTO_UPDATE !== "0";
const EVERY_MS = process.env.UPDATE_CHECK_MINUTES ? Math.max(1, Number(process.env.UPDATE_CHECK_MINUTES)) * 60_000 : Math.max(1, Number(process.env.UPDATE_CHECK_HOURS || 3)) * 3600_000;
const ANY_TIME = process.env.UPDATE_ANY_TIME === "1"; // aktualizuj także w nocy (np. do testów)
const PORT = process.env.PORT || "3000";

const log = (...a) => console.log(`[NBA EDGE ${new Date().toLocaleTimeString("pl-PL")}]`, ...a);
// git uruchamiamy bez powłoki (na Windows znaki jak „|” w argumentach zostałyby odczytane przez cmd);
// npm.cmd na Windows wymaga powłoki (argumenty npm są proste)
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", shell: false, windowsHide: true, ...opts });
const git = (...args) => run("git", args);
const ok = (r) => r.status === 0;
const npm = (args) => run(WIN ? "npm.cmd" : "npm", args, { stdio: "inherit", shell: WIN });

function readStatus() {
  try { return JSON.parse(fs.readFileSync(STATUS_FILE, "utf8")); } catch { return {}; }
}
function writeStatus(patch) {
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(STATUS_FILE, "utf8")); } catch { /* pierwszy zapis */ }
  const head = git("log", "-1", "--format=%h|%cI");
  const [version, date] = ok(head) ? head.stdout.trim().split("|") : [null, null];
  fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true });
  fs.writeFileSync(STATUS_FILE, JSON.stringify({ ...cur, autoUpdate: AUTO, version, versionDate: date, ...patch }, null, 2));
}

function hasGit() {
  return ok(run("git", ["--version"]));
}

/** Folder z ZIP-a → repozytorium Git (bez ruszania .env.local i data/, które są w .gitignore). */
function ensureRepo() {
  if (fs.existsSync(path.join(ROOT, ".git"))) return true;
  if (!REPO) return false;
  if (!hasGit()) {
    log("Automatyczne aktualizacje wymagają programu Git — zainstaluj go z https://git-scm.com i uruchom ponownie.");
    return false;
  }
  log("Podłączam folder do repozytorium (jednorazowo), żeby aplikacja mogła się aktualizować…");
  const head = run("git", ["ls-remote", "--symref", REPO, "HEAD"]);
  const branch = ok(head) ? (head.stdout.match(/ref: refs\/heads\/(\S+)\s+HEAD/)?.[1] ?? "main") : null;
  if (!branch) {
    log("Nie mogę połączyć się z repozytorium:", (head.stderr || "").trim().split("\n")[0] || "brak dostępu");
    return false;
  }
  const steps = [["init", "-q"], ["remote", "add", "origin", REPO], ["fetch", "-q", "origin", branch], ["reset", "-q", "--hard", `origin/${branch}`], ["branch", "-q", "-M", branch], ["branch", "-q", "--set-upstream-to", `origin/${branch}`]];
  for (const s of steps) {
    const r = git(...s);
    if (!ok(r)) {
      log("Nie udało się podłączyć repozytorium:", (r.stderr || "").trim().split("\n")[0]);
      fs.rmSync(path.join(ROOT, ".git"), { recursive: true, force: true });
      return false;
    }
  }
  log(`Gotowe — folder śledzi gałąź „${branch}”.`);
  return true;
}

/** Pobiera nową wersję, jeśli jest. Zwraca { updated, from } albo null. */
function pullUpdate() {
  const branch = git("rev-parse", "--abbrev-ref", "HEAD").stdout?.trim();
  if (!branch || branch === "HEAD") return null;
  const f = git("fetch", "-q", "origin", branch);
  if (!ok(f)) {
    log("Nie mogę sprawdzić aktualizacji (brak internetu albo dostępu do repozytorium).");
    writeStatus({ checkedAt: Date.now(), lastError: "brak połączenia z repozytorium" });
    return null;
  }
  const local = git("rev-parse", "HEAD").stdout.trim();
  const remote = git("rev-parse", `origin/${branch}`).stdout.trim();
  writeStatus({ checkedAt: Date.now(), lastError: null });
  if (local === remote) return { updated: false };
  if (readStatus().badCommit === remote) return { updated: false }; // ta wersja już raz się nie zbudowała — czekamy na poprawkę
  const behind = ok(git("merge-base", "--is-ancestor", local, remote));
  if (!behind) return { updated: false }; // lokalnie są nowsze/inne zmiany — nie ruszamy
  const dirty = git("status", "--porcelain", "--untracked-files=no").stdout.trim();
  if (dirty) {
    log("Jest nowa wersja, ale pliki aplikacji zostały zmienione ręcznie — pomijam aktualizację (cofnij zmiany albo zaktualizuj ręcznie: git pull).");
    writeStatus({ lastError: "pliki zmienione ręcznie — aktualizacja wstrzymana" });
    return { updated: false };
  }
  const changes = git("log", "--format=  • %s", `${local}..${remote}`).stdout.trim();
  log(`Nowa wersja dostępna:\n${changes}`);
  if (!ok(git("merge", "-q", "--ff-only", remote))) return { updated: false };
  const lockChanged = git("diff", "--name-only", local, remote).stdout.split("\n").some((f) => f === "package.json" || f === "package-lock.json");
  if (lockChanged) {
    log("Instaluję nowe zależności…");
    npm(["install", "--no-audit", "--no-fund"]);
  }
  const runnerChanged = git("diff", "--name-only", local, remote).stdout.split("\n").includes("scripts/run.mjs");
  return { updated: true, from: local, runnerChanged };
}

const builtHead = () => { try { return fs.readFileSync(path.join(ROOT, ".next", "NBA_EDGE_HEAD"), "utf8").trim(); } catch { return null; } };
function build() {
  log("Buduję aplikację (ok. 1 minuty)…");
  const r = npm(["run", "build"]);
  if (r.status !== 0) return false;
  const head = git("rev-parse", "HEAD");
  fs.writeFileSync(path.join(ROOT, ".next", "NBA_EDGE_HEAD"), ok(head) ? head.stdout.trim() : "local");
  return true;
}
function ensureBuilt(previous) {
  const head = git("rev-parse", "HEAD");
  const want = ok(head) ? head.stdout.trim() : "local";
  if (fs.existsSync(path.join(ROOT, ".next", "BUILD_ID")) && builtHead() === want) return true;
  if (build()) return true;
  if (previous) {
    log("Nowa wersja się nie zbudowała — wracam do poprzedniej (spróbuję ponownie, gdy pojawi się kolejna wersja).");
    writeStatus({ badCommit: want });
    git("reset", "-q", "--hard", previous);
    npm(["install", "--no-audit", "--no-fund"]);
    writeStatus({ lastError: "nowa wersja nie zbudowała się — przywrócono poprzednią" });
    return build();
  }
  return false;
}

let child = null;
function startServer() {
  const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
  child = spawn(process.execPath, [nextBin, "start", "-p", PORT], { cwd: ROOT, stdio: "inherit", env: process.env });
  child.on("exit", (code, sig) => {
    if (stopping) return;
    log(`Aplikacja zakończyła działanie (${sig ?? code}) — uruchamiam ponownie za 5 s…`);
    setTimeout(startServer, 5000);
  });
  log(`Aplikacja działa: http://localhost:${PORT}  (zamknij to okno albo Ctrl+C, aby wyłączyć)`);
}
let stopping = false;
function stopServer() {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    stopping = true;
    child.once("exit", () => { stopping = false; resolve(); });
    child.kill();
  });
}

const warsawHour = () => Number(new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", hour: "2-digit", hour12: false }).format(new Date()));

async function periodic() {
  if (!AUTO) return;
  const h = warsawHour();
  if (!ANY_TIME && (h < 10 || h >= 20)) return; // w nocy trwają mecze — nie restartujemy
  const r = pullUpdate();
  if (!r?.updated) return;
  log("Instaluję nową wersję — aplikacja będzie niedostępna przez 1–2 minuty…");
  await stopServer();
  if (r.runnerChanged) {
    // nowa wersja startera — uruchom ją (ten proces tylko czeka, żeby okno/terminal zostało otwarte)
    log("Zaktualizowano starter — uruchamiam jego nową wersję…");
    clearInterval(timer);
    writeStatus({ lastUpdateAt: Date.now() });
    const next = spawn(process.execPath, [fileURLToPath(import.meta.url)], { cwd: ROOT, stdio: "inherit", env: { ...process.env, NBA_EDGE_PREVIOUS: r.from } });
    process.removeAllListeners("SIGINT");
    process.on("SIGINT", () => next.kill("SIGINT"));
    next.on("exit", (code) => process.exit(code ?? 0));
    return;
  }
  ensureBuilt(r.from);
  writeStatus({ lastUpdateAt: Date.now() });
  startServer();
}

// ---------------- start ----------------
process.on("SIGINT", async () => { await stopServer(); process.exit(0); });
process.on("SIGTERM", async () => { await stopServer(); process.exit(0); });

if (!fs.existsSync(path.join(ROOT, "node_modules", "next"))) {
  log("Pierwsza instalacja zależności (1–3 minuty)…");
  npm(["install", "--no-audit", "--no-fund"]);
}
if (!fs.existsSync(path.join(ROOT, ".env.local")) && fs.existsSync(path.join(ROOT, ".env.example"))) {
  fs.copyFileSync(path.join(ROOT, ".env.example"), path.join(ROOT, ".env.local"));
  log("Utworzono plik ustawień .env.local (możesz w nim dodać klucz OddsPapi).");
}
let previous = process.env.NBA_EDGE_PREVIOUS || null; // po przeładowaniu startera: wersja, do której można wrócić
if (AUTO && ensureRepo()) {
  log("Sprawdzam aktualizacje…");
  const r = pullUpdate();
  if (r?.updated) { previous = r.from; writeStatus({ lastUpdateAt: Date.now() }); }
  else if (r) log("Masz najnowszą wersję.");
} else if (!AUTO) log("Automatyczne aktualizacje wyłączone (AUTO_UPDATE=0).");
if (!ensureBuilt(previous)) {
  log("Nie udało się zbudować aplikacji — sprawdź komunikaty powyżej.");
  process.exit(1);
}
writeStatus({});
startServer();
const timer = setInterval(() => { periodic().catch((e) => log("Błąd aktualizacji:", e.message)); }, EVERY_MS);
