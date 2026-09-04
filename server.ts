import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import { spawn, exec, execSync, ChildProcess } from "child_process";
import { promisify } from "util";
import { createServer as createViteServer } from "vite";
import multer from "multer";

const execAsync = promisify(exec);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Health Check Endpoint (Essential for Render zero-downtime health checking)
app.get("/api/health", (req, res) => {
  const bots = getEnrichedBots();
  const runningCount = bots.filter(b => b.status === "running").length;
  res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    platform: "Render & Cloud Ready",
    port: PORT,
    deploymentsTotal: bots.length,
    runningBots: runningCount,
    nodeVersion: process.version
  });
});

// Middleware for parsing JSON and URL-encoded bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Bot deployments registry
const DEPLOYMENTS_DIR = path.join(process.cwd(), "deployments");
const REGISTRY_FILE = path.join(DEPLOYMENTS_DIR, "registry.json");

// Default Telegram Bot Token (can be overridden with TELEGRAM_BOT_TOKEN environment variable)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8923444398:AAFlnI-_ijkNFyGQZ34L2wog5byerjV0kq0";

// Ensure deployments directory and registry file exist
if (!fs.existsSync(DEPLOYMENTS_DIR)) {
  fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
}
if (!fs.existsSync(REGISTRY_FILE)) {
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify([], null, 2));
}

// Multer storage for Web uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tempDir = path.join(DEPLOYMENTS_DIR, "temp");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}_${file.originalname}`);
  },
});
const upload = multer({ storage });

// Active background processes with runtime health tracking
interface ProcessRuntimeMeta {
  process: ChildProcess;
  startTime: number;
  pid?: number;
  crashCount: number;
  lastMemoryMB: number;
  lastCpuPercent: number;
  lastChecked: number;
  health: "healthy" | "degraded" | "unhealthy" | "idle";
  healthMessage: string;
}

const runningProcesses: Record<string, ProcessRuntimeMeta> = {};
const botCrashCounts: Record<string, number> = {};

// Interfaces
interface BotRegistryEntry {
  id: string;
  name: string;
  filename: string;
  language: "python" | "node";
  status: "running" | "stopped" | "crashed";
  path: string;
  entryPoint: string;
  dependencies: string[];
  created: string;
  uptime: number; // stores start timestamp when running, or 0
  error?: string;
  env?: Record<string, string>;
  ownerId?: number | string;
  ownerUsername?: string;
}

// Duration formatting matching client and server
function formatDurationSeconds(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return "0s";
  const totalSecs = Math.floor(seconds);
  const days = Math.floor(totalSecs / 86400);
  const hrs = Math.floor((totalSecs % 86400) / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hrs > 0 || days > 0) parts.push(`${hrs}h`);
  if (mins > 0 || hrs > 0 || days > 0) parts.push(`${mins}m`);
  parts.push(`${secs}s`);
  return parts.join(" ");
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return "0 MB";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

// Inspect process PID for memory and CPU metrics
function getPidMetrics(pid: number): { memoryMB: number; cpuPercent: number; alive: boolean } {
  try {
    process.kill(pid, 0);
  } catch {
    return { memoryMB: 0, cpuPercent: 0, alive: false };
  }

  let memoryMB = 0;
  let cpuPercent = 0;

  try {
    const statusFile = `/proc/${pid}/status`;
    if (fs.existsSync(statusFile)) {
      const content = fs.readFileSync(statusFile, "utf-8");
      const vmrssMatch = content.match(/^VmRSS:\s+(\d+)\s+kB/m);
      if (vmrssMatch) {
        memoryMB = parseFloat((parseInt(vmrssMatch[1], 10) / 1024).toFixed(1));
      }
    }
  } catch {}

  if (memoryMB === 0) {
    try {
      const output = execSync(`ps -o rss,%cpu -p ${pid} --no-headers`, {
        stdio: ["pipe", "pipe", "ignore"],
        encoding: "utf-8",
      }).trim();
      const parts = output.split(/\s+/);
      if (parts.length >= 2) {
        const rssKb = parseInt(parts[0], 10);
        if (!isNaN(rssKb)) memoryMB = parseFloat((rssKb / 1024).toFixed(1));
        const cpu = parseFloat(parts[1]);
        if (!isNaN(cpu)) cpuPercent = cpu;
      }
    } catch {}
  }

  return { memoryMB, cpuPercent, alive: true };
}

// Background status & health monitoring service
class StatusMonitoringService {
  private intervalId: NodeJS.Timeout | null = null;

  start() {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => this.tick(), 2500);
    console.log("Status Monitoring Service started (2.5s polling loop).");
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  tick() {
    for (const [botId, meta] of Object.entries(runningProcesses)) {
      const pid = meta.process.pid;
      if (!pid) continue;

      const { memoryMB, cpuPercent, alive } = getPidMetrics(pid);
      meta.lastChecked = Date.now();
      meta.pid = pid;

      if (!alive) {
        meta.health = "unhealthy";
        meta.healthMessage = "Process terminated unexpectedly";
        continue;
      }

      meta.lastMemoryMB = memoryMB;
      meta.lastCpuPercent = cpuPercent;

      const crashCount = botCrashCounts[botId] || 0;
      if (crashCount > 0 || memoryMB > 300 || cpuPercent > 80) {
        meta.health = "degraded";
        meta.healthMessage = memoryMB > 300 ? "High memory usage" : crashCount > 0 ? "Recovered from recent crash" : "High CPU load";
      } else {
        meta.health = "healthy";
        meta.healthMessage = "Operational & Running";
      }
    }
  }
}

const monitorService = new StatusMonitoringService();
monitorService.start();

// Enriched Bot objects combining registry and runtime health metrics
function getEnrichedBots() {
  const registry = readRegistry();
  const now = Date.now();

  return registry.map(bot => {
    const runInfo = runningProcesses[bot.id];
    const isRunning = !!runInfo && (runInfo.process.exitCode === null && !runInfo.process.killed);
    const actualStatus = isRunning ? "running" : bot.status === "running" ? "stopped" : bot.status;

    const createdMs = new Date(bot.created).getTime();
    const deploymentDurationSeconds = isNaN(createdMs) ? 0 : Math.max(0, Math.floor((now - createdMs) / 1000));

    const sessionUptimeSeconds = actualStatus === "running" && bot.uptime > 0
      ? Math.max(0, Math.floor((now - bot.uptime) / 1000))
      : 0;

    const restarts = botCrashCounts[bot.id] || 0;
    const pid = runInfo?.pid || runInfo?.process?.pid;
    const memoryMB = runInfo?.lastMemoryMB || 0;
    const cpuPercent = runInfo?.lastCpuPercent || 0;

    let health: "healthy" | "degraded" | "unhealthy" | "idle" = "idle";
    let healthMessage = "Process Stopped";

    if (actualStatus === "running") {
      if (runInfo?.health) {
        health = runInfo.health;
        healthMessage = runInfo.healthMessage;
      } else {
        health = "healthy";
        healthMessage = "Operational & Running";
      }
    } else if (actualStatus === "crashed") {
      health = "unhealthy";
      healthMessage = bot.error || "Process Crashed";
    }

    return {
      ...bot,
      status: actualStatus,
      pid: isRunning ? pid : undefined,
      memoryMB: isRunning ? memoryMB : 0,
      cpuPercent: isRunning ? cpuPercent : 0,
      restarts,
      health,
      healthMessage,
      deploymentDurationSeconds,
      sessionUptimeSeconds,
    };
  });
}

// Get guaranteed absolute directory for bot and ensure directory exists
function getBotPath(bot: { id: string; path?: string }): string {
  let botDir = bot.path;
  if (!botDir || !fs.existsSync(botDir)) {
    botDir = path.join(DEPLOYMENTS_DIR, bot.id);
  }
  if (!fs.existsSync(botDir)) {
    try {
      fs.mkdirSync(botDir, { recursive: true });
    } catch (e) {
      console.error(`Error creating directory for bot ${bot.id}:`, e);
    }
  }
  return botDir;
}

// Safely append to bot.log without crashing or throwing ENOENT
function safeAppendLog(botDir: string, message: string) {
  try {
    if (!fs.existsSync(botDir)) {
      fs.mkdirSync(botDir, { recursive: true });
    }
    const logFile = path.join(botDir, "bot.log");
    fs.appendFileSync(logFile, message);
  } catch (err: any) {
    console.error(`[SafeLog Error] Failed to write log in ${botDir}:`, err?.message || err);
  }
}

// Safely read bot.log without throwing ENOENT
function safeReadLogs(botDir: string, maxLines: number = 200): string {
  try {
    const logFile = path.join(botDir, "bot.log");
    if (!fs.existsSync(logFile)) {
      return "[System] No logs recorded yet.";
    }
    const logs = fs.readFileSync(logFile, "utf-8");
    const lines = logs.split("\n");
    return lines.slice(-maxLines).join("\n") || "[No Output Logged]";
  } catch (err: any) {
    return `[System] Could not read logs: ${err?.message || err}`;
  }
}

// Read registry
function readRegistry(): BotRegistryEntry[] {
  try {
    if (!fs.existsSync(REGISTRY_FILE)) return [];
    const raw = fs.readFileSync(REGISTRY_FILE, "utf-8");
    if (!raw.trim()) return [];
    const entries: BotRegistryEntry[] = JSON.parse(raw);
    return entries.map(bot => ({
      ...bot,
      path: getBotPath(bot)
    }));
  } catch (err) {
    console.error("Error reading registry:", err);
    return [];
  }
}

// Write registry
function writeRegistry(registry: BotRegistryEntry[]) {
  try {
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
  } catch (err) {
    console.error("Error writing registry:", err);
  }
}

// Helper to extract dependencies from script code
function extractDependencies(code: string, language: "python" | "node"): string[] {
  const deps = new Set<string>();
  if (language === "python") {
    const stdLib = new Set([
      "sys", "os", "time", "json", "math", "random", "re", "datetime", "urllib", "collections", "subprocess", "hashlib",
      "sqlite3", "logging", "threading", "asyncio", "socket", "sysconfig", "types", "traceback", "uuid", "base64",
      "csv", "shutil", "glob", "tempfile", "argparse", "copy", "io", "typing", "functools", "importlib", "string"
    ]);

    const lines = code.split("\n");
    for (let line of lines) {
      line = line.trim();
      // Skip commented lines
      if (line.startsWith("#")) continue;

      if (line.startsWith("import ")) {
        // e.g., "import os, sys, dotenv" or "import telebot"
        const remainder = line.substring(7).trim();
        // Split by commas, handling multiple packages on the same line
        const parts = remainder.split(",");
        for (const part of parts) {
          // Get the base package name (split on whitespace or dots)
          const clean = part.trim().split(/\s+/)[0].split(".")[0];
          if (clean && !stdLib.has(clean) && !clean.match(/^[0-9]/)) {
            if (clean === "bs4") deps.add("beautifulsoup4");
            else if (clean === "telegram") deps.add("python-telegram-bot");
            else if (clean === "telebot") deps.add("pyTelegramBotAPI");
            else if (clean === "dotenv") deps.add("python-dotenv");
            else if (clean === "PIL") deps.add("Pillow");
            else if (clean === "yaml") deps.add("pyyaml");
            else deps.add(clean);
          }
        }
      } else if (line.startsWith("from ")) {
        // e.g., "from dotenv import load_dotenv" or "from openai import OpenAI"
        // Match package name in "from <pkg> import <stuff>" or "from <pkg>.<subpkg> import <stuff>"
        const match = line.match(/^from\s+([a-zA-Z0-9._]+)\s+import/);
        if (match) {
          const clean = match[1].trim().split(".")[0];
          if (clean && !stdLib.has(clean) && !clean.match(/^[0-9]/)) {
            if (clean === "bs4") deps.add("beautifulsoup4");
            else if (clean === "telegram") deps.add("python-telegram-bot");
            else if (clean === "telebot") deps.add("pyTelegramBotAPI");
            else if (clean === "dotenv") deps.add("python-dotenv");
            else if (clean === "PIL") deps.add("Pillow");
            else if (clean === "yaml") deps.add("pyyaml");
            else deps.add(clean);
          }
        }
      }
    }
  } else {
    // Node.js: Matches require("pkg") or import ... from "pkg"
    const requireRegex = /require\(['"]([^'"]+)['"]\)/g;
    const importRegex = /from\s+['"]([^'"]+)['"]/g;
    let match;
    const stdLib = new Set([
      "fs", "path", "child_process", "crypto", "os", "http", "https", "util", "events", "stream", "net", "tls", "dns",
      "url", "querystring", "readline", "zlib", "buffer", "process", "assert", "vm"
    ]);

    while ((match = requireRegex.exec(code)) !== null) {
      const p = match[1].trim();
      if (!stdLib.has(p) && !p.startsWith(".") && !p.startsWith("/")) {
        deps.add(p);
      }
    }
    while ((match = importRegex.exec(code)) !== null) {
      const p = match[1].trim();
      if (!stdLib.has(p) && !p.startsWith(".") && !p.startsWith("/")) {
        deps.add(p);
      }
    }
  }
  return Array.from(deps);
}

// Automatically extract referenced environment variables and their default fallback strings from code
function extractEnvVariables(code: string, language: "python" | "node"): Record<string, string> {
  const envs: Record<string, string> = {};

  if (language === "python") {
    // os.getenv("KEY", "fallback") or os.getenv("KEY") or os.environ.get("KEY")
    const getenvRegex = /(?:os\.(?:getenv|environ\.get))\(\s*['"]([a-zA-Z0-9_]+)['"]\s*(?:,\s*['"]([^'"]*)['"])?\s*\)(?:\s*or\s*['"]([^'"]*)['"])?/g;
    let match;
    while ((match = getenvRegex.exec(code)) !== null) {
      const key = match[1];
      const val = match[2] || match[3] || "";
      envs[key] = val;
    }

    // os.environ['KEY']
    const environRegex = /os\.environ\[\s*['"]([a-zA-Z0-9_]+)['"]\s*\](?:\s*or\s*['"]([^'"]*)['"])?/g;
    while ((match = environRegex.exec(code)) !== null) {
      const key = match[1];
      const val = match[2] || "";
      envs[key] = val;
    }
  } else {
    // process.env.KEY or process.env['KEY']
    const processDotRegex = /process\.env\.([a-zA-Z0-9_]+)(?:\s*\|\|\s*['"]([^'"]*)['"])?/g;
    let match;
    while ((match = processDotRegex.exec(code)) !== null) {
      const key = match[1];
      const val = match[2] || "";
      envs[key] = val;
    }

    const processBracketRegex = /process\.env\[\s*['"]([a-zA-Z0-9_]+)['"]\s*\](?:\s*\|\|\s*['"]([^'"]*)['"])?/g;
    while ((match = processBracketRegex.exec(code)) !== null) {
      const key = match[1];
      const val = match[2] || "";
      envs[key] = val;
    }
  }

  // Pre-fill with system environment if available
  for (const key of Object.keys(envs)) {
    if (process.env[key]) {
      envs[key] = process.env[key]!;
    }
  }

  // Always guarantee TELEGRAM_BOT_TOKEN has a value if it is referenced or present
  if (envs["TELEGRAM_BOT_TOKEN"] === "" && process.env.TELEGRAM_BOT_TOKEN) {
    envs["TELEGRAM_BOT_TOKEN"] = process.env.TELEGRAM_BOT_TOKEN;
  }

  return envs;
}

// Clean up packages list
function cleanPackageNames(deps: string[], language: "python" | "node"): string[] {
  // Filters out invalid package names and maps them if needed
  return deps.filter(d => !d.includes("/") && !d.includes("\\") && d.length > 1);
}

// Auto install dependencies in the bot's folder
async function installBotDependencies(botDir: string, deps: string[], language: "python" | "node") {
  const cleanedDeps = cleanPackageNames(deps, language);
  if (cleanedDeps.length === 0) return;

  safeAppendLog(botDir, `\n[System] Installing dependencies: ${cleanedDeps.join(", ")}\n`);

  try {
    if (language === "node") {
      // Create local package.json if it doesn't exist
      const pkgJsonPath = path.join(botDir, "package.json");
      if (!fs.existsSync(pkgJsonPath)) {
        fs.writeFileSync(pkgJsonPath, JSON.stringify({
          name: path.basename(botDir),
          version: "1.0.0",
          private: true,
          dependencies: {}
        }, null, 2));
      }
      const cmd = `npm install ${cleanedDeps.join(" ")} --no-audit --no-fund`;
      safeAppendLog(botDir, `[System] Running: ${cmd}\n`);
      await execAsync(cmd, { cwd: botDir });
    } else {
      // Python dependencies
      let pipCmd = "pip3";
      try {
        await execAsync("pip3 --version");
      } catch {
        try {
          await execAsync("python3 -m pip --version");
          pipCmd = "python3 -m pip";
        } catch {
          safeAppendLog(botDir, `[System Warning] pip3 is not yet installed on system. Retrying pip setup...\n`);
          try {
            await execAsync("apt-get update && apt-get install -y python3-pip");
          } catch (e: any) {
            safeAppendLog(botDir, `[System Error] Failed to install pip: ${e.message}\n`);
            return;
          }
        }
      }

      const cmd = `${pipCmd} install ${cleanedDeps.join(" ")} --break-system-packages`;
      safeAppendLog(botDir, `[System] Running: ${cmd}\n`);
      await execAsync(cmd, { cwd: botDir });
    }
    safeAppendLog(botDir, `[System] Dependencies installed successfully.\n\n`);
  } catch (err: any) {
    console.error("Dependency installation failed:", err);
    safeAppendLog(botDir, `[System Error] Dependency installation failed: ${err.message}\n\n`);
  }
}

// Spawn a background bot process
function startBotProcess(bot: BotRegistryEntry) {
  // If already running, stop first
  if (runningProcesses[bot.id]) {
    stopBotProcess(bot.id);
  }

  const botPath = getBotPath(bot);
  bot.path = botPath;

  safeAppendLog(botPath, `\n--- [System] Bot process starting at ${new Date().toISOString()} ---\n`);

  // Check if entryPoint file exists on disk
  const entryFile = path.join(botPath, bot.entryPoint);
  if (!fs.existsSync(entryFile)) {
    const errMsg = `Script file '${bot.entryPoint}' not found in deployment folder. Please upload or provide the script.`;
    console.warn(`[BotRunner] Cannot start bot ${bot.id}: ${errMsg}`);
    safeAppendLog(botPath, `[System Error] ${errMsg}\n`);

    const registry = readRegistry();
    const idx = registry.findIndex(b => b.id === bot.id);
    if (idx !== -1) {
      registry[idx].status = "crashed";
      registry[idx].error = errMsg;
      registry[idx].uptime = 0;
      writeRegistry(registry);
    }
    return;
  }

  let cmd = "node";
  let args = [bot.entryPoint];

  if (bot.language === "python") {
    cmd = "python3";
    args = ["-u", bot.entryPoint]; // Unbuffered output to get logs instantly
  } else if (bot.entryPoint.endsWith(".ts")) {
    cmd = "npx";
    args = ["tsx", bot.entryPoint];
  }

  // Set environments including bot custom envs
  const envVars = {
    ...process.env,
    ...(bot.env || {}),
  };

  // Automatically write a local .env file in the bot's directory so direct loaders (like python-dotenv) work out-of-the-box
  try {
    const envContent = Object.entries(bot.env || {})
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
    fs.writeFileSync(path.join(botPath, ".env"), envContent);
  } catch (err: any) {
    console.error(`Failed to write local .env file for bot ${bot.id}:`, err);
  }

  try {
    const child = spawn(cmd, args, {
      cwd: botPath,
      env: envVars,
    });

    // Handle spawn error to prevent unhandled 'error' event crash
    child.on("error", (err: any) => {
      console.error(`Child process spawn error for bot ${bot.id}:`, err);
      safeAppendLog(botPath, `\n[System Process Error] Failed to start process '${cmd}': ${err.message}\n`);

      delete runningProcesses[bot.id];

      const registry = readRegistry();
      const idx = registry.findIndex(b => b.id === bot.id);
      if (idx !== -1) {
        registry[idx].status = "crashed";
        registry[idx].error = `Failed to start process: ${err.message}`;
        registry[idx].uptime = 0;
        writeRegistry(registry);
      }
    });

    runningProcesses[bot.id] = {
      process: child,
      startTime: Date.now(),
      pid: child.pid,
      crashCount: botCrashCounts[bot.id] || 0,
      lastMemoryMB: 0,
      lastCpuPercent: 0,
      lastChecked: Date.now(),
      health: "healthy",
      healthMessage: "Operational & Running",
    };

    child.stdout?.on("data", (data) => {
      safeAppendLog(botPath, data.toString());
    });

    child.stderr?.on("data", (data) => {
      safeAppendLog(botPath, `[Error] ${data.toString()}`);
    });

    child.on("close", (code, signal) => {
      console.log(`Bot ${bot.id} exited with code ${code} and signal ${signal}`);
      safeAppendLog(botPath, `\n--- [System] Bot process exited with code ${code} (${signal || "no signal"}) ---\n`);

      const registry = readRegistry();
      const idx = registry.findIndex(b => b.id === bot.id);

      // Extract the process startTime before deleting from runningProcesses
      const runInfo = runningProcesses[bot.id];
      delete runningProcesses[bot.id];

      if (idx !== -1) {
        // If it was supposed to be running (not manually stopped), check for crash or automatic restart
        if (registry[idx].status === "running") {
          const runtime = Date.now() - (runInfo?.startTime || Date.now());

          if (code !== 0 && code !== null) {
            // It crashed
            registry[idx].status = "crashed";
            registry[idx].error = `Exit code ${code}. Check logs for details.`;
            writeRegistry(registry);

            // Dynamic restart logic
            let crashCount = botCrashCounts[bot.id] || 0;
            if (runtime > 10000) {
              crashCount = 0;
            }
            crashCount++;
            botCrashCounts[bot.id] = crashCount;

            if (crashCount <= 3) {
              safeAppendLog(botPath, `[System] Crash detected. Auto-restarting in 5 seconds (Attempt ${crashCount}/3)...\n`);
              setTimeout(() => {
                const reg = readRegistry();
                const currentBot = reg.find(b => b.id === bot.id);
                if (currentBot && currentBot.status === "crashed") {
                  currentBot.status = "running";
                  currentBot.uptime = Date.now();
                  writeRegistry(reg);
                  startBotProcess(currentBot);
                }
              }, 5000);
            } else {
              safeAppendLog(botPath, `[System] Too many rapid crashes. Stopping auto-restart.\n`);
            }
          } else {
            // Stopped normally
            registry[idx].status = "stopped";
            registry[idx].uptime = 0;
            writeRegistry(registry);
          }
        }
      }
    });

    // Update state to running
    const registry = readRegistry();
    const idx = registry.findIndex(b => b.id === bot.id);
    if (idx !== -1) {
      registry[idx].status = "running";
      registry[idx].uptime = Date.now();
      registry[idx].error = undefined;
      writeRegistry(registry);
    }

  } catch (err: any) {
    console.error(`Failed to spawn bot process ${bot.id}:`, err);
    safeAppendLog(botPath, `[System Spawning Error] Failed to start process: ${err.message}\n`);
    const registry = readRegistry();
    const idx = registry.findIndex(b => b.id === bot.id);
    if (idx !== -1) {
      registry[idx].status = "crashed";
      registry[idx].error = err.message;
      writeRegistry(registry);
    }
  }
}

// Stop a bot process
function stopBotProcess(id: string) {
  const processInfo = runningProcesses[id];
  if (processInfo) {
    try {
      processInfo.process.kill("SIGTERM");
      // Fallback kill if SIGTERM fails after 3s
      setTimeout(() => {
        try {
          processInfo.process.kill("SIGKILL");
        } catch {}
      }, 3000);
    } catch (e) {
      console.error(`Failed to kill process ${id}:`, e);
    }
    delete runningProcesses[id];
  }

  const registry = readRegistry();
  const idx = registry.findIndex(b => b.id === id);
  if (idx !== -1) {
    registry[idx].status = "stopped";
    registry[idx].uptime = 0;
    writeRegistry(registry);
  }
}

// Automatically deploy a file (Web & Telegram shared)
async function deployBotFile(
  originalName: string,
  filePath: string,
  customName?: string,
  ownerId?: number | string,
  ownerUsername?: string
): Promise<BotRegistryEntry> {
  const id = `bot_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  const botDir = path.join(DEPLOYMENTS_DIR, id);
  fs.mkdirSync(botDir, { recursive: true });

  const ext = path.extname(originalName).toLowerCase();
  const language = ext === ".py" ? "python" : "node";
  const finalFilename = ext === ".ts" || ext === ".js" || ext === ".py" ? originalName : `index${ext}`;
  const destPath = path.join(botDir, finalFilename);

  // Copy or write file to target dir
  fs.copyFileSync(filePath, destPath);

  // Read file contents to extract dependencies and env vars
  const codeContents = fs.readFileSync(destPath, "utf-8");
  const extractedDeps = extractDependencies(codeContents, language);
  const extractedEnvs = extractEnvVariables(codeContents, language);

  // If script doesn't explicitly reference TELEGRAM_BOT_TOKEN but we have it, ensure it's still available as a fallback
  if (!extractedEnvs["TELEGRAM_BOT_TOKEN"] && TELEGRAM_BOT_TOKEN) {
    extractedEnvs["TELEGRAM_BOT_TOKEN"] = TELEGRAM_BOT_TOKEN;
  }

  // Save Bot entry in registry
  const botEntry: BotRegistryEntry = {
    id,
    name: customName || path.basename(originalName, ext),
    filename: finalFilename,
    language,
    status: "stopped",
    path: botDir,
    entryPoint: finalFilename,
    dependencies: extractedDeps,
    created: new Date().toISOString(),
    uptime: 0,
    env: extractedEnvs,
    ownerId: ownerId || "web_admin",
    ownerUsername: ownerUsername || "Web Dashboard"
  };

  const registry = readRegistry();
  registry.push(botEntry);
  writeRegistry(registry);

  // Install dependencies in background
  installBotDependencies(botDir, extractedDeps, language).then(() => {
    // Automatically start after dependency installation
    startBotProcess(botEntry);
  });

  return botEntry;
}

// Start all bots marked as running on server startup (24/7 background recovery)
function recoverRunningBots() {
  const registry = readRegistry();
  console.log(`Recovering deployed bots... Found ${registry.length} registered entries.`);
  for (const bot of registry) {
    if (bot.status === "running") {
      console.log(`Restarting bot: ${bot.name} (${bot.id})`);
      startBotProcess(bot);
    }
  }
}

// API Routes
app.get("/api/bots", (req, res) => {
  const bots = getEnrichedBots();
  res.json(bots);
});

app.post("/api/bots/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const { customName } = req.body;
    const originalName = req.file.originalname;
    const tempPath = req.file.path;

    const bot = await deployBotFile(originalName, tempPath, customName);

    // Clean up temporary upload file
    try {
      fs.unlinkSync(tempPath);
    } catch {}

    res.json({ success: true, bot });
  } catch (err: any) {
    console.error("Web deploy failure:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/bots/:id/start", (req, res) => {
  const { id } = req.params;
  const registry = readRegistry();
  const bot = registry.find(b => b.id === id);

  if (!bot) {
    return res.status(404).json({ error: "Bot not found" });
  }

  startBotProcess(bot);
  res.json({ success: true, status: "running" });
});

app.post("/api/bots/:id/stop", (req, res) => {
  const { id } = req.params;
  const registry = readRegistry();
  const bot = registry.find(b => b.id === id);

  if (!bot) {
    return res.status(404).json({ error: "Bot not found" });
  }

  stopBotProcess(id);
  res.json({ success: true, status: "stopped" });
});

const handleDeleteBot = (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  try {
    stopBotProcess(id);
    delete botCrashCounts[id];

    const registry = readRegistry();
    const idx = registry.findIndex(b => b.id === id);

    if (idx !== -1) {
      const bot = registry[idx];
      const botDir = getBotPath(bot);
      const defaultDir = path.join(DEPLOYMENTS_DIR, id);

      // Remove registry entry
      registry.splice(idx, 1);
      writeRegistry(registry);

      // Delete directory recursively
      try {
        if (fs.existsSync(botDir)) {
          fs.rmSync(botDir, { recursive: true, force: true });
        }
      } catch (e) {
        console.error(`Error deleting folder for bot ${id}:`, e);
      }

      try {
        if (fs.existsSync(defaultDir) && defaultDir !== botDir) {
          fs.rmSync(defaultDir, { recursive: true, force: true });
        }
      } catch (e) {
        console.error(`Error deleting default folder for bot ${id}:`, e);
      }

      return res.json({ success: true, message: "Bot deleted successfully" });
    }

    res.status(404).json({ error: "Bot not found" });
  } catch (err: any) {
    console.error(`Failed to delete bot ${id}:`, err);
    res.status(500).json({ error: err.message || "Failed to delete bot" });
  }
};

app.post("/api/bots/:id/delete", handleDeleteBot);
app.delete("/api/bots/:id", handleDeleteBot);
app.delete("/api/bots/:id/delete", handleDeleteBot);

app.get("/api/bots/:id/logs", (req, res) => {
  const { id } = req.params;
  const registry = readRegistry();
  const bot = registry.find(b => b.id === id);

  if (!bot) {
    return res.status(404).json({ error: "Bot not found" });
  }

  const botPath = getBotPath(bot);
  const logs = safeReadLogs(botPath, 200);
  res.json({ logs });
});

app.get("/api/bots/:id/code", (req, res) => {
  const { id } = req.params;
  const registry = readRegistry();
  const bot = registry.find(b => b.id === id);

  if (!bot) {
    return res.status(404).json({ error: "Bot not found" });
  }

  const botPath = getBotPath(bot);
  const fileLoc = path.join(botPath, bot.entryPoint);
  if (!fs.existsSync(fileLoc)) {
    return res.json({ code: `# Script file '${bot.entryPoint}' not found on server disk.\n# Please re-upload or update your script.` });
  }

  try {
    const code = fs.readFileSync(fileLoc, "utf-8");
    res.json({ code });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/bots/:id/env", (req, res) => {
  const { id } = req.params;
  const { env } = req.body;

  const registry = readRegistry();
  const idx = registry.findIndex(b => b.id === id);

  if (idx === -1) {
    return res.status(404).json({ error: "Bot not found" });
  }

  registry[idx].env = env;
  writeRegistry(registry);

  // Write updated .env file to disk immediately
  try {
    const envContent = Object.entries(env || {})
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
    fs.writeFileSync(path.join(registry[idx].path, ".env"), envContent);
  } catch (err: any) {
    console.error(`Failed to write local .env file for bot ${id}:`, err);
  }

  // If running, restart to apply env
  if (runningProcesses[id]) {
    stopBotProcess(id);
    startBotProcess(registry[idx]);
  }

  res.json({ success: true, bot: registry[idx] });
});

app.get("/api/stats", (req, res) => {
  const bots = getEnrichedBots();
  const running = bots.filter(b => b.status === "running").length;
  const stopped = bots.filter(b => b.status === "stopped").length;
  const crashed = bots.filter(b => b.status === "crashed").length;

  let totalMem = 0;
  let freeMem = 0;
  try {
    const memInfo = fs.readFileSync("/proc/meminfo", "utf8");
    const totalMatch = memInfo.match(/^MemTotal:\s+(\d+)/m);
    const availMatch = memInfo.match(/^MemAvailable:\s+(\d+)/m) || memInfo.match(/^MemFree:\s+(\d+)/m);
    if (totalMatch && availMatch) {
      totalMem = parseInt(totalMatch[1], 10) * 1024;
      freeMem = parseInt(availMatch[1], 10) * 1024;
    }
  } catch {
    totalMem = 8 * 1024 * 1024 * 1024;
    freeMem = 4 * 1024 * 1024 * 1024;
  }

  const totalBotMemoryMB = bots.reduce((acc, b) => acc + (b.memoryMB || 0), 0);
  const activePids = bots.filter(b => !!b.pid).length;
  const avgCpuPercent = running > 0
    ? parseFloat((bots.reduce((acc, b) => acc + (b.cpuPercent || 0), 0) / running).toFixed(1))
    : 0;

  res.json({
    totalBots: bots.length,
    activeBots: running,
    stoppedBots: stopped,
    crashedBots: crashed,
    memoryUsage: {
      used: totalMem - freeMem,
      total: totalMem,
      percentage: totalMem > 0 ? Math.round(((totalMem - freeMem) / totalMem) * 100) : 50
    },
    systemLoad: os.loadavg ? os.loadavg() : [0.15, 0.22, 0.18],
    uptime: Math.round(process.uptime()),
    processMetrics: {
      activePids,
      totalBotMemoryMB: parseFloat(totalBotMemoryMB.toFixed(1)),
      avgCpuPercent,
    }
  });
});

// Cached bot info to prevent rate limits or Telegram timeouts
let cachedBotInfo: any = null;
let lastBotInfoFetchTime = 0;

app.get("/api/bot-info", async (req, res) => {
  const now = Date.now();
  // Return cache if fetched within last 60 seconds
  if (cachedBotInfo && now - lastBotInfoFetchTime < 60000) {
    return res.json(cachedBotInfo);
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      if (data && data.ok) {
        cachedBotInfo = data;
        lastBotInfoFetchTime = now;
        return res.json(data);
      }
    }
  } catch (err: any) {
    console.warn("Could not fetch fresh bot info from Telegram API:", err.message);
  }

  // Fallback to cache if available
  if (cachedBotInfo) {
    return res.json(cachedBotInfo);
  }

  // Graceful fallback payload
  return res.json({
    ok: true,
    result: {
      id: 8923444398,
      is_bot: true,
      first_name: "Script Dispatcher Bot",
      username: "BotRunnerHub_bot",
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false
    }
  });
});

// Render Deployment Management & Diagnostic Endpoints
app.get("/api/render/status", async (req, res) => {
  let pythonAvailable = false;
  let pythonVersion = "Not Found";
  let pipAvailable = false;

  try {
    const pyVer = execSync("python3 --version", { encoding: "utf8" }).trim();
    pythonAvailable = true;
    pythonVersion = pyVer;
  } catch {
    pythonAvailable = false;
  }

  try {
    execSync("pip3 --version || python3 -m pip --version", { encoding: "utf8" });
    pipAvailable = true;
  } catch {
    pipAvailable = false;
  }

  const persistentDirExists = fs.existsSync(DEPLOYMENTS_DIR);
  const registryCount = readRegistry().length;

  res.json({
    renderReady: true,
    serviceType: "Web Service (Node.js & Python Dual Engine)",
    nodeVersion: process.version,
    port: PORT,
    environment: process.env.NODE_ENV || "development",
    pythonAvailable,
    pythonVersion,
    pipAvailable,
    persistentStorage: {
      path: DEPLOYMENTS_DIR,
      configured: persistentDirExists,
      activeDeployments: registryCount,
    },
    suggestedHealthCheck: "/api/health",
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

app.get("/api/render/config", (req, res) => {
  let renderYaml = "";
  let dockerfile = "";
  let renderBuildSh = "";

  try {
    if (fs.existsSync(path.join(process.cwd(), "render.yaml"))) {
      renderYaml = fs.readFileSync(path.join(process.cwd(), "render.yaml"), "utf8");
    }
    if (fs.existsSync(path.join(process.cwd(), "Dockerfile"))) {
      dockerfile = fs.readFileSync(path.join(process.cwd(), "Dockerfile"), "utf8");
    }
    if (fs.existsSync(path.join(process.cwd(), "render-build.sh"))) {
      renderBuildSh = fs.readFileSync(path.join(process.cwd(), "render-build.sh"), "utf8");
    }
  } catch (err: any) {
    console.error("Failed to read render config files:", err);
  }

  res.json({
    renderYaml,
    dockerfile,
    renderBuildSh,
    docsUrl: "https://render.com/docs/web-services",
    defaultBuildCommand: "npm install --include=dev && npm run build",
    defaultStartCommand: "npm run start",
    defaultHealthCheck: "/api/health",
  });
});

app.post("/api/render/deploy-webhook", async (req, res) => {
  const { webhookUrl } = req.body;
  if (!webhookUrl || typeof webhookUrl !== "string" || !webhookUrl.startsWith("https://api.render.com/deploy/")) {
    return res.status(400).json({ error: "Invalid Render Deploy Hook URL. Format must start with https://api.render.com/deploy/srv-..." });
  }

  try {
    const triggerRes = await fetch(webhookUrl, { method: "POST" });
    const triggerText = await triggerRes.text();
    if (triggerRes.ok) {
      return res.json({ success: true, message: "Render deployment triggered successfully!", response: triggerText });
    } else {
      return res.status(triggerRes.status).json({ error: `Render API rejected webhook trigger (${triggerRes.status}): ${triggerText}` });
    }
  } catch (err: any) {
    console.error("Error triggering Render deploy webhook:", err);
    return res.status(500).json({ error: `Failed to connect to Render Deploy Hook: ${err.message}` });
  }
});

// HTML Escaping Helper for Telegram formatting
function escapeHtml(str: string | number | undefined | null): string {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Helper to format Telegram bot message for an individual bot card
function formatBotCardTelegram(bot: ReturnType<typeof getEnrichedBots>[0]) {
  const isRunning = bot.status === "running";
  const statusEmoji = isRunning ? "🟢 RUNNING" : bot.status === "crashed" ? "⚠️ CRASHED" : "🔴 STOPPED";
  const healthLabel = bot.health === "healthy" ? "Healthy" : bot.health === "degraded" ? "Degraded" : bot.health === "unhealthy" ? "Unhealthy" : "Idle";
  const uptimeStr = isRunning ? formatDurationSeconds(bot.sessionUptimeSeconds || 0) : "Offline";
  const deployStr = formatDurationSeconds(bot.deploymentDurationSeconds || 0);
  const pidInfo = bot.pid ? `<code>${escapeHtml(bot.pid)}</code>` : "<i>None</i>";
  const ramInfo = isRunning && bot.memoryMB ? `<code>${escapeHtml(bot.memoryMB)} MB</code>` : "<i>0 MB</i>";
  const restartInfo = (bot.restarts || 0) > 0 ? ` | 🔄 Restarts: <code>${escapeHtml(bot.restarts)}</code>` : "";

  const botMsg = `🤖 <b>Bot Name</b>: <code>${escapeHtml(bot.name)}</code>\n` +
    `📄 <b>Script</b>: <code>${escapeHtml(bot.filename)}</code> (${bot.language === "python" ? "🐍 Python" : "🟢 Node.js"})\n` +
    `📊 <b>Status</b>: ${statusEmoji} (🩺 <b>${escapeHtml(healthLabel)}</b>)\n` +
    `⏱️ <b>Live Session Uptime</b>: <code>${escapeHtml(uptimeStr)}</code>\n` +
    `⏳ <b>Total Deployed Time</b>: <code>${escapeHtml(deployStr)}</code>\n` +
    `⚙️ <b>PID</b>: ${pidInfo} | 💾 <b>RAM</b>: ${ramInfo}${restartInfo}\n` +
    `📦 <b>Dependencies</b>: ${escapeHtml(bot.dependencies.join(", ")) || "None"}`;

  const controlButtons = [
    [
      { text: isRunning ? "⏸️ Stop" : "▶️ Start", callback_data: `${isRunning ? "stop" : "start"}_${bot.id}` },
      { text: "📜 Logs", callback_data: `logs_${bot.id}` },
      { text: "🔄 Refresh", callback_data: `refresh_bot_${bot.id}` },
      { text: "❌ Delete", callback_data: `delete_${bot.id}` }
    ]
  ];

  return { text: botMsg, markup: { inline_keyboard: controlButtons } };
}

const MAX_BOTS_PER_TELEGRAM_USER = 3;

// Generate centralized Telegram Status overview synchronized with Dashboard
function generateTelegramStatusReport(botUsername: string, userId?: number | string) {
  const allBots = getEnrichedBots();
  const bots = userId !== undefined
    ? allBots.filter(b => String(b.ownerId) === String(userId))
    : allBots;

  const total = bots.length;
  const running = bots.filter(b => b.status === "running").length;
  const stopped = bots.filter(b => b.status === "stopped").length;
  const crashed = bots.filter(b => b.status === "crashed").length;

  let totalMem = 0;
  let freeMem = 0;
  try {
    const memInfo = fs.readFileSync("/proc/meminfo", "utf8");
    const totalMatch = memInfo.match(/^MemTotal:\s+(\d+)/m);
    const availMatch = memInfo.match(/^MemAvailable:\s+(\d+)/m) || memInfo.match(/^MemFree:\s+(\d+)/m);
    if (totalMatch && availMatch) {
      totalMem = parseInt(totalMatch[1], 10) * 1024;
      freeMem = parseInt(availMatch[1], 10) * 1024;
    }
  } catch {
    totalMem = 8 * 1024 * 1024 * 1024;
    freeMem = 4 * 1024 * 1024 * 1024;
  }

  const hostUptimeSec = Math.round(process.uptime());
  const hostUptimeStr = formatDurationSeconds(hostUptimeSec);
  const hostRamUsedStr = formatBytes(totalMem - freeMem);
  const hostRamTotalStr = formatBytes(totalMem);
  const hostRamPercent = totalMem > 0 ? Math.round(((totalMem - freeMem) / totalMem) * 100) : 0;
  const totalBotMemory = bots.reduce((acc, b) => acc + (b.memoryMB || 0), 0);

  let scriptBreakdown = "";
  if (bots.length === 0) {
    scriptBreakdown = `<i>No scripts deployed under your account yet (0/${MAX_BOTS_PER_TELEGRAM_USER} slots used). Click ➕ Add Script to begin.</i>`;
  } else {
    scriptBreakdown = bots.map((b, i) => {
      const statusIcon = b.status === "running" ? "🟢" : b.status === "crashed" ? "⚠️" : "🔴";
      const uptimeStr = b.status === "running" ? formatDurationSeconds(b.sessionUptimeSeconds || 0) : "Offline";
      const deployStr = formatDurationSeconds(b.deploymentDurationSeconds || 0);
      const pidInfo = b.pid ? ` (PID: <code>${escapeHtml(b.pid)}</code>)` : "";
      const ramInfo = b.status === "running" && b.memoryMB ? ` | 💾 <code>${escapeHtml(b.memoryMB)} MB</code>` : "";
      const healthStr = b.health === "healthy" ? "Healthy" : b.health === "degraded" ? "Degraded" : b.health === "unhealthy" ? "Crashed" : "Idle";

      return `${i + 1}. ${statusIcon} <b>${escapeHtml(b.name)}</b>${pidInfo}\n` +
             `   ⏱️ <b>Session Uptime:</b> <code>${escapeHtml(uptimeStr)}</code>\n` +
             `   ⏳ <b>Total Deployed:</b> <code>${escapeHtml(deployStr)}</code>\n` +
             `   🩺 <b>Health:</b> <code>${escapeHtml(healthStr)}</code>${ramInfo}`;
    }).join("\n\n");
  }

  const quotaLine = userId !== undefined
    ? `👤 <b>Your Account Quota:</b> <code>${total} / ${MAX_BOTS_PER_TELEGRAM_USER} slots used</code>\n`
    : "";

  const text = `📊 <b>Platform & Process Status Hub</b>\n\n` +
    `🤖 <b>Dispatcher Bot:</b> ${escapeHtml(botUsername)}\n` +
    `🖥️ <b>Server Uptime:</b> <code>${escapeHtml(hostUptimeStr)}</code>\n` +
    `💾 <b>Host Memory:</b> <code>${escapeHtml(hostRamUsedStr)} / ${escapeHtml(hostRamTotalStr)} (${hostRamPercent}%)</code>\n` +
    `⚡ <b>Your Bots RAM Footprint:</b> <code>${totalBotMemory.toFixed(1)} MB</code>\n` +
    `${quotaLine}\n` +
    `📂 <b>Your Deployments Overview:</b>\n` +
    `• Total: <code>${total} / ${MAX_BOTS_PER_TELEGRAM_USER}</code> | 🟢 Running: <code>${running}</code> | 🔴 Stopped: <code>${stopped}</code> | ⚠️ Crashed: <code>${crashed}</code>\n\n` +
    `📋 <b>Your Active Scripts & Live Uptime:</b>\n` +
    `${scriptBreakdown}\n\n` +
    `<i>Live synchronized metrics • Updated at ${new Date().toLocaleTimeString()}</i>`;

  const markup = {
    inline_keyboard: [
      [
        { text: "🔄 Refresh Live Status", callback_data: "refresh_status" },
        { text: "🔍 Manage Deployments", callback_data: "view_catalog" }
      ]
    ]
  };

  return { text, markup };
}

// TELEGRAM BOT LONG-POLLING CLIENT
class TelegramBotPoller {
  private token: string;
  private offset: number = 0;
  private isRunning: boolean = false;
  private currentUploadUser: Record<number, { stage: "awaiting_file"; customName?: string }> = {};

  constructor(token: string) {
    this.token = token;
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log("Telegram Bot Poller initialized. Connecting to Telegram API...");
    try {
      console.log("Removing any active Telegram webhooks to avoid polling conflicts...");
      const delRes = await fetch(`https://api.telegram.org/bot${this.token}/deleteWebhook?drop_pending_updates=true`);
      const delData = await delRes.json();
      console.log("deleteWebhook response:", delData);
    } catch (e: any) {
      console.error("Error deleting webhook on startup:", e.message);
    }
    this.pollLoop();
  }

  async stop() {
    this.isRunning = false;
  }

  private async pollLoop() {
    while (this.isRunning) {
      try {
        const url = `https://api.telegram.org/bot${this.token}/getUpdates?offset=${this.offset}&timeout=15`;
        const res = await fetch(url);
        if (!res.ok) {
          if (res.status === 409) {
            console.warn("Received 409 Conflict in Telegram bot polling. Active webhook detected. Deleting webhook...");
            try {
              await fetch(`https://api.telegram.org/bot${this.token}/deleteWebhook?drop_pending_updates=true`);
            } catch (e: any) {
              console.error("Failed to delete webhook inside pollLoop:", e.message);
            }
            await new Promise(resolve => setTimeout(resolve, 4000));
            continue;
          }
          throw new Error(`Telegram API returned status ${res.status}`);
        }
        const data: any = await res.json();
        if (data.ok && data.result.length > 0) {
          for (const update of data.result) {
            this.offset = update.update_id + 1;
            await this.handleUpdate(update);
          }
        }
      } catch (err: any) {
        console.error("Error in Telegram bot polling:", err.message);
        // Wait 5 seconds before retrying to prevent rapid API hammering on connection loss
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  private async handleUpdate(update: any) {
    const msg = update.message;
    const callbackQuery = update.callback_query;

    if (callbackQuery) {
      await this.handleCallbackQuery(callbackQuery);
      return;
    }

    if (!msg) return;

    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const rawText = msg.text?.trim() || "";
    const cleanText = rawText.replace(/@[a-zA-Z0-9_]+/gi, "").trim().toLowerCase();

    // Handle uploaded scripts / documents
    if (msg.document) {
      await this.handleBotFileUpload(msg);
      return;
    }

    if (!rawText) return;

    // Command handling: Start / Menu
    if (
      cleanText === "/start" ||
      cleanText === "start" ||
      cleanText === "menu" ||
      cleanText === "/menu" ||
      cleanText === "/help" ||
      cleanText === "help" ||
      cleanText.includes("main menu") ||
      cleanText.includes("back")
    ) {
      this.currentUploadUser[userId] = { stage: "awaiting_file" }; // Reset state
      const userBots = readRegistry().filter(b => String(b.ownerId) === String(userId));
      await this.sendMainMenu(
        chatId,
        `👋 Hello <b>${escapeHtml(msg.from.first_name || "Developer")}</b>!\n\n` +
        `I am your centralized <b>Bot Deployment & Monitoring Agent</b>. I run, install dependencies, and manage your Python and Node.js backend scripts 24/7 in the background.\n\n` +
        `🔒 <b>Private Workspace:</b> Your deployments and logs are strictly isolated to your account.\n` +
        `📊 <b>Quota:</b> <code>${userBots.length} / ${MAX_BOTS_PER_TELEGRAM_USER} bot slots used</code>\n\n` +
        `Use the menu buttons below or send commands like <code>/status</code>, <code>/list</code>, <code>/logs</code>, or <code>/add</code>! 👇`
      );
      return;
    }

    // Command handling: Add Script
    if (
      cleanText === "/add" ||
      cleanText === "add" ||
      cleanText === "/upload" ||
      cleanText === "upload" ||
      cleanText.includes("add script") ||
      cleanText.includes("➕")
    ) {
      const userBots = readRegistry().filter(b => String(b.ownerId) === String(userId));
      if (userBots.length >= MAX_BOTS_PER_TELEGRAM_USER) {
        await this.sendMessage(
          chatId,
          `🚫 <b>Deployment Limit Reached (${userBots.length}/${MAX_BOTS_PER_TELEGRAM_USER} Bots)</b>\n\n` +
          `Each Telegram user is permitted a maximum of <b>${MAX_BOTS_PER_TELEGRAM_USER} bot deployments</b>.\n\n` +
          `To deploy a new script, please delete one of your existing bots first via <b>🔍 Deploy Check</b>.`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: "🔍 Manage & Delete Deployments", callback_data: "view_catalog" }]
              ]
            }
          }
        );
        return;
      }

      this.currentUploadUser[userId] = { stage: "awaiting_file" };
      await this.sendMessage(
        chatId,
        `📤 <b>Ready for Script Upload!</b> (${userBots.length}/${MAX_BOTS_PER_TELEGRAM_USER} slots used, ${MAX_BOTS_PER_TELEGRAM_USER - userBots.length} available)\n\n` +
        `Please directly attach and send me your script file. Supported formats:\n` +
        `- 🐍 <b>Python</b>: <code>.py</code> file\n` +
        `- 🟢 <b>Node.js</b>: <code>.js</code> or <code>.ts</code> file\n\n` +
        `I will auto-parse its imports, install all required dependencies, and launch it in the background immediately!`,
        {
          reply_markup: {
            keyboard: [[{ text: "🔙 Back to Main Menu" }]],
            resize_keyboard: true,
          }
        }
      );
      return;
    }

    // Command handling: Status (Button /status or 📊 Status or status)
    if (
      cleanText === "/status" ||
      cleanText === "status" ||
      cleanText.includes("status") ||
      cleanText.includes("📊")
    ) {
      let botUsername = "@BotRunnerHub_bot";
      try {
        const statsUrl = `https://api.telegram.org/bot${this.token}/getMe`;
        const r = await fetch(statsUrl);
        const d: any = await r.json();
        if (d.ok && d.result?.username) botUsername = `@${d.result.username}`;
      } catch {}

      const { text: responseText, markup } = generateTelegramStatusReport(botUsername, userId);
      await this.sendMessage(chatId, responseText, { reply_markup: markup });
      return;
    }

    // Command handling: Logs
    if (
      cleanText === "/logs" ||
      cleanText === "logs" ||
      cleanText === "/log" ||
      cleanText === "log" ||
      cleanText.includes("logs") ||
      cleanText.includes("📜")
    ) {
      const bots = getEnrichedBots().filter(b => String(b.ownerId) === String(userId));
      if (bots.length === 0) {
        await this.sendMessage(chatId, `📭 <b>No bots deployed yet under your account.</b> (0/${MAX_BOTS_PER_TELEGRAM_USER} slots used) Click '➕ Add Script' to spin one up.`);
        return;
      }

      const buttons = bots.map(b => [
        {
          text: `${b.status === "running" ? "🟢" : b.status === "crashed" ? "⚠️" : "🔴"} ${b.name}`,
          callback_data: `logs_${b.id}`
        }
      ]);

      await this.sendMessage(chatId, `📜 <b>Read Output Logs (${bots.length}/${MAX_BOTS_PER_TELEGRAM_USER} Deployments)</b>\n\nSelect one of your deployed bots below to view its last 20 console lines:`, {
        reply_markup: {
          inline_keyboard: buttons
        }
      });
      return;
    }

    // Command handling: List / Deploy Check
    if (
      cleanText === "/list" ||
      cleanText === "list" ||
      cleanText === "/deployments" ||
      cleanText === "deployments" ||
      cleanText === "catalog" ||
      cleanText === "bots" ||
      cleanText.includes("deploy check") ||
      cleanText.includes("deploy") ||
      cleanText.includes("🔍")
    ) {
      await this.sendDeploymentCatalog(chatId, userId);
      return;
    }

    // Default catch-all response
    await this.sendMessage(
      chatId,
      `❓ <b>Unrecognized command or text.</b>\n\n` +
      `Click <b>📊 Status</b> to check your health, <b>🔍 Deploy Check</b> to manage your bots (${MAX_BOTS_PER_TELEGRAM_USER} max), or send a <code>.py</code> / <code>.js</code> file to deploy!`,
      {
        reply_markup: {
          keyboard: [
            [{ text: "➕ Add Script" }, { text: "🔍 Deploy Check" }],
            [{ text: "📊 Status" }, { text: "📜 Logs" }]
          ],
          resize_keyboard: true,
        }
      }
    );
  }

  private async sendDeploymentCatalog(chatId: number, userId: number | string) {
    const bots = getEnrichedBots().filter(b => String(b.ownerId) === String(userId));
    if (bots.length === 0) {
      await this.sendMessage(
        chatId,
        `📭 <b>No bots deployed under your account yet.</b> (0/${MAX_BOTS_PER_TELEGRAM_USER} slots used)\n\n` +
        `Send a Python (<code>.py</code>) or Node.js (<code>.js</code>) script file or click <b>➕ Add Script</b> to deploy!`
      );
      return;
    }

    await this.sendMessage(
      chatId,
      `🔍 <b>Your Active Deployments (${bots.length}/${MAX_BOTS_PER_TELEGRAM_USER} slots used)</b>\n\n` +
      `Here is your private register of active instances with live uptime and health metrics:`
    );

    for (const bot of bots) {
      const { text: botMsg, markup } = formatBotCardTelegram(bot);
      await this.sendMessage(chatId, botMsg, { reply_markup: markup });
    }
  }

  private async handleCallbackQuery(query: any) {
    const data: string = query.data || "";
    const chatId = query.message?.chat?.id;
    const messageId = query.message?.message_id;
    const userId = query.from?.id;

    if (!chatId || !messageId) {
      await this.answerCallbackQuery(query.id, "Invalid action");
      return;
    }

    if (data === "refresh_status" || data === "status") {
      let botUsername = "@BotRunnerHub_bot";
      try {
        const statsUrl = `https://api.telegram.org/bot${this.token}/getMe`;
        const r = await fetch(statsUrl);
        const d: any = await r.json();
        if (d.ok && d.result?.username) botUsername = `@${d.result.username}`;
      } catch {}

      const { text: reportText, markup } = generateTelegramStatusReport(botUsername, userId);
      await this.answerCallbackQuery(query.id, "Live metrics updated!");
      
      try {
        await fetch(`https://api.telegram.org/bot${this.token}/editMessageText`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
            text: reportText,
            parse_mode: "HTML",
            reply_markup: markup
          })
        });
      } catch (e: any) {
        console.warn("Failed to edit Telegram status message:", e.message);
      }
      return;
    }

    if (data === "view_catalog") {
      await this.answerCallbackQuery(query.id, "Loading your deployments...");
      await this.sendDeploymentCatalog(chatId, userId);
      return;
    }

    const refreshBotMatch = data.match(/^refresh_bot_(.+)$/);
    if (refreshBotMatch) {
      const botId = refreshBotMatch[1];
      const registry = readRegistry();
      const bot = registry.find(b => b.id === botId);
      if (bot && bot.ownerId && String(bot.ownerId) !== String(userId)) {
        await this.answerCallbackQuery(query.id, "⛔ Access Denied: You do not own this bot.", { show_alert: true });
        return;
      }
      await this.answerCallbackQuery(query.id, "Bot metrics refreshed!");
      await this.editMessageStatus(chatId, messageId, botId);
      return;
    }

    const actionMatch = data.match(/^(start|stop|delete|logs)_(.+)$/);
    if (!actionMatch) {
      await this.answerCallbackQuery(query.id, "Action complete");
      return;
    }

    const [_, action, botId] = actionMatch;
    const registry = readRegistry();
    const bot = registry.find(b => b.id === botId);

    if (!bot) {
      await this.answerCallbackQuery(query.id, "Bot not found in index.");
      return;
    }

    // Security check: Only the owner can control or view their deployment
    if (bot.ownerId && String(bot.ownerId) !== String(userId)) {
      await this.answerCallbackQuery(query.id, "⛔ Access Denied: You do not own this bot deployment.", { show_alert: true });
      return;
    }

    if (action === "start") {
      startBotProcess(bot);
      await this.answerCallbackQuery(query.id, `Starting ${bot.name}...`);
      await this.editMessageStatus(chatId, messageId, botId);
    } else if (action === "stop") {
      stopBotProcess(botId);
      await this.answerCallbackQuery(query.id, `Stopping ${bot.name}...`);
      await this.editMessageStatus(chatId, messageId, botId);
    } else if (action === "delete") {
      stopBotProcess(botId);
      const reg = readRegistry();
      const idx = reg.findIndex(b => b.id === botId);
      if (idx !== -1) {
        const deletedBot = reg[idx];
        reg.splice(idx, 1);
        writeRegistry(reg);
        try {
          if (fs.existsSync(deletedBot.path)) {
            fs.rmSync(deletedBot.path, { recursive: true, force: true });
          }
        } catch {}
      }
      await this.answerCallbackQuery(query.id, "Bot deleted.");
      // Delete the message from telegram
      try {
        await fetch(`https://api.telegram.org/bot${this.token}/deleteMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, message_id: messageId })
        });
      } catch {}
    } else if (action === "logs") {
      const botPath = getBotPath(bot);
      const logsContent = safeReadLogs(botPath, 20);
      await this.answerCallbackQuery(query.id, "Logs loaded.");
      await this.sendMessage(chatId, `📜 <b>Terminal Logs for ${escapeHtml(bot.name)} (Last 20 Lines)</b>:\n\n<pre>${escapeHtml(logsContent || "[No Output Logged]")}</pre>`);
    }
  }

  private async editMessageStatus(chatId: number, messageId: number, botId: string) {
    const bots = getEnrichedBots();
    const bot = bots.find(b => b.id === botId);
    if (!bot) return;

    const { text: botMsg, markup } = formatBotCardTelegram(bot);

    try {
      await fetch(`https://api.telegram.org/bot${this.token}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          text: botMsg,
          parse_mode: "HTML",
          reply_markup: markup
        })
      });
    } catch (e: any) {
      console.warn("Failed to edit Telegram message status:", e.message);
    }
  }

  private async handleBotFileUpload(msg: any) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userUsername = msg.from.username ? `@${msg.from.username}` : (msg.from.first_name || `User_${userId}`);
    const document = msg.document;
    const fileName: string = document.file_name || "script.py";
    const ext = path.extname(fileName).toLowerCase();

    // Check user quota (Max 3 bots per user)
    const currentRegistry = readRegistry();
    const userBots = currentRegistry.filter(b => String(b.ownerId) === String(userId));
    if (userBots.length >= MAX_BOTS_PER_TELEGRAM_USER) {
      await this.sendMessage(
        chatId,
        `🚫 <b>Deployment Limit Reached (${userBots.length}/${MAX_BOTS_PER_TELEGRAM_USER} Bots)</b>\n\n` +
        `Each Telegram user is permitted a maximum of <b>${MAX_BOTS_PER_TELEGRAM_USER} bot deployments</b>.\n\n` +
        `To deploy <code>${escapeHtml(fileName)}</code>, please delete one of your existing bots first via <b>🔍 Deploy Check</b>.`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔍 Manage & Delete Deployments", callback_data: "view_catalog" }]
            ]
          }
        }
      );
      return;
    }

    if (ext !== ".py" && ext !== ".js" && ext !== ".ts") {
      await this.sendMessage(chatId, "⚠️ <b>Unsupported File Type!</b>\n\nPlease submit only standalone Python (<code>.py</code>) or JavaScript/TypeScript (<code>.js</code>, <code>.ts</code>) backend scripts!");
      return;
    }

    await this.sendMessage(chatId, `📥 Downloading <code>${escapeHtml(fileName)}</code> and assembling execution context... (Slot ${userBots.length + 1}/${MAX_BOTS_PER_TELEGRAM_USER})`);

    try {
      // 1. Fetch file path from telegram
      const getFileUrl = `https://api.telegram.org/bot${this.token}/getFile?file_id=${document.file_id}`;
      const fileRes = await fetch(getFileUrl);
      const fileData: any = await fileRes.json();

      if (!fileData.ok) {
        throw new Error(`Failed to get file from TG API: ${fileData.description}`);
      }

      const filePath = fileData.result.file_path;
      const downloadUrl = `https://api.telegram.org/file/bot${this.token}/${filePath}`;

      // 2. Download file to a local temp path
      const tempPath = path.join(DEPLOYMENTS_DIR, `temp_${Date.now()}_${fileName}`);
      const downloadRes = await fetch(downloadUrl);
      const buffer = await downloadRes.arrayBuffer();
      fs.writeFileSync(tempPath, Buffer.from(buffer));

      // 3. Deploy the file with owner tracking
      const bot = await deployBotFile(fileName, tempPath, undefined, userId, userUsername);

      // 4. Clean up temp file
      try {
        fs.unlinkSync(tempPath);
      } catch {}

      const successText = `🚀 <b>Bot Deployed Successfully via Telegram!</b>\n\n` +
        `🤖 <b>Id</b>: <code>${escapeHtml(bot.id)}</code>\n` +
        `🏷️ <b>Name</b>: <code>${escapeHtml(bot.name)}</code>\n` +
        `⚙️ <b>Platform</b>: ${bot.language === "python" ? "🐍 Python" : "🟢 Node.js"}\n` +
        `⚡ <b>Status</b>: Booting (Installing dependencies in background...)\n` +
        `👤 <b>Owner</b>: <code>${escapeHtml(userUsername)}</code> (Slot: ${userBots.length + 1}/${MAX_BOTS_PER_TELEGRAM_USER})\n` +
        `📦 <b>Required Dependencies</b>: ${escapeHtml(bot.dependencies.join(", ")) || "None detected"}\n\n` +
        `We are spawning the process now! Use <b>🔍 Deploy Check</b> to operate and view logs!`;

      await this.sendMessage(chatId, successText);

    } catch (err: any) {
      console.error("Telegram file deploy error:", err);
      await this.sendMessage(chatId, `❌ <b>Deployment Failed!</b>\n\nError: <code>${escapeHtml(err.message)}</code>`);
    }
  }

  private async sendMainMenu(chatId: number, text: string) {
    const keyboard = [
      [{ text: "➕ Add Script" }, { text: "🔍 Deploy Check" }],
      [{ text: "📊 Status" }, { text: "📜 Logs" }]
    ];
    await this.sendMessage(chatId, text, {
      reply_markup: {
        keyboard,
        resize_keyboard: true
      }
    });
  }

  private async sendMessage(chatId: number, text: string, extra: Record<string, any> = {}) {
    try {
      const url = `https://api.telegram.org/bot${this.token}/sendMessage`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: "HTML",
          ...extra
        })
      });
      const data: any = await res.json();
      if (!data.ok) {
        // Fallback retry without HTML parse_mode in case of any markup issue
        console.warn("Telegram sendMessage HTML error, retrying with raw text:", data.description);
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: text.replace(/<[^>]*>/g, ""),
            ...extra
          })
        });
      }
    } catch (err) {
      console.error("Failed to send message to Telegram:", err);
    }
  }

  private async answerCallbackQuery(callbackQueryId: string, text: string, options: { showAlert?: boolean; show_alert?: boolean } = {}) {
    try {
      await fetch(`https://api.telegram.org/bot${this.token}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_query_id: callbackQueryId,
          text: text,
          show_alert: options.showAlert ?? options.show_alert ?? false
        })
      });
    } catch (err) {
      console.error("Failed to answer callback query:", err);
    }
  }
}

// Start Telegram Poller
const poller = new TelegramBotPoller(TELEGRAM_BOT_TOKEN);
poller.start();

// Recover previously running processes
recoverRunningBots();

// Handle Vite Static Asset Serving & Routing
const isProduction = process.env.NODE_ENV === "production";

async function serveVite() {
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    // Serve client-side bundle for fallbacks
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Application Server listening on http://0.0.0.0:${PORT}`);
  });
}

serveVite();
