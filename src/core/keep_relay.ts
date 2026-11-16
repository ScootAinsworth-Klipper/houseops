import { spawn } from "child_process";
import fs from "fs";
import path from "path";

export interface KeepPollConfig {
  email: string;
  masterToken: string;
  listTitle?: string;
  statePath?: string;
  scriptPath?: string;
  pythonBin?: string;
  timeoutMs?: number;
}

export interface KeepPollResult {
  ok: boolean;
  items: string[];
  error?: string;
}

export type KeepRunner = (config: KeepPollConfig) => Promise<KeepPollResult>;

/**
 * Normalizes a Google Keep list item into a clean TorrentRelay search query.
 * Examples:
 * - "Gladiator 2" -> "Gladiator 2"
 * - "download Inception" -> "Inception"
 * - "grab Severance S02E05" -> "Severance S02E05"
 */
export function cleanKeepMediaTitle(rawTitle: string): string | null {
  if (!rawTitle) return null;
  const trimmed = rawTitle.trim();
  if (!trimmed) return null;

  const stripped = trimmed.replace(/^(?:download|grab|torrent)\s+/i, "").trim();
  return stripped.length > 0 ? stripped : null;
}

function resolvePythonBinary(customBin?: string): string {
  if (customBin) return customBin;
  const venvUnix = path.resolve(process.cwd(), ".venv/bin/python");
  if (fs.existsSync(venvUnix)) return venvUnix;
  const venvWin = path.resolve(process.cwd(), ".venv/Scripts/python.exe");
  if (fs.existsSync(venvWin)) return venvWin;
  return "python3";
}

/**
 * Executes daemon/keep_downloads.py passing credentials over stdin JSON and
 * parses the stdout JSON response.
 */
export async function runKeepDownloadsScript(
  config: KeepPollConfig
): Promise<KeepPollResult> {
  const pythonBin = resolvePythonBinary(config.pythonBin);
  const scriptPath =
    config.scriptPath || path.resolve(process.cwd(), "daemon/keep_downloads.py");
  const statePath =
    config.statePath || path.resolve(process.cwd(), "data/keep_state.json");
  const listTitle = (config.listTitle || "Downloads").trim() || "Downloads";
  const timeoutMs = config.timeoutMs ?? 25000;

  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";

    const finish = (result: KeepPollResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const proc = spawn(pythonBin, [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch (_) {}
      finish({ ok: false, items: [], error: "Google Keep poll timed out" });
    }, timeoutMs);

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      finish({ ok: false, items: [], error: err.message });
    });

    proc.on("close", (code) => {
      if (stderr.trim()) {
        console.error(stderr.trim());
      }
      const lines = stdout
        .trim()
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const lastLine = lines[lines.length - 1] || "";

      try {
        const parsed = JSON.parse(lastLine);
        if (parsed && Array.isArray(parsed.items)) {
          finish({
            ok: Boolean(parsed.ok),
            items: parsed.items.map((x: unknown) => String(x)),
            error: typeof parsed.error === "string" ? parsed.error : undefined,
          });
          return;
        }
      } catch (_) {}

      finish({
        ok: false,
        items: [],
        error: `Keep script exited with code ${code}: ${lastLine || stderr.trim() || "no output"}`,
      });
    });

    proc.stdin.write(
      JSON.stringify({
        email: config.email,
        masterToken: config.masterToken,
        listTitle,
        statePath,
      })
    );
    proc.stdin.end();
  });
}

/**
 * Polls Google Keep Downloads list using the provided runner (defaults to Python gkeepapi).
 */
export async function pollGoogleKeepDownloads(
  config: KeepPollConfig,
  runner: KeepRunner = runKeepDownloadsScript
): Promise<string[]> {
  if (!config.email.trim() || !config.masterToken.trim()) {
    return [];
  }

  const result = await runner(config);
  if (!result.ok && result.error) {
    console.error(`[KeepRelay] ${result.error}`);
  }

  const queries: string[] = [];
  for (const rawItem of result.items || []) {
    const cleaned = cleanKeepMediaTitle(rawItem);
    if (cleaned) {
      queries.push(cleaned);
    }
  }
  return queries;
}
