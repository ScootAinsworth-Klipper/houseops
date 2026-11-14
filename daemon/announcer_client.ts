import { spawn } from "child_process";
import path from "path";
import { HouseTicket } from "../src/core/types.js";

export interface QuietHoursConfig {
  enabled: boolean;
  forceMute: boolean;
  startTime: string; // "HH:MM", e.g. "22:00"
  endTime: string;   // "HH:MM", e.g. "06:00"
}

let activeQuietConfig: QuietHoursConfig = {
  enabled: true,
  forceMute: false,
  startTime: "22:00",
  endTime: "06:00"
};

export function setQuietHoursConfig(cfg: Partial<QuietHoursConfig>): QuietHoursConfig {
  if (cfg.enabled !== undefined) activeQuietConfig.enabled = Boolean(cfg.enabled);
  if (cfg.forceMute !== undefined) activeQuietConfig.forceMute = Boolean(cfg.forceMute);
  if (cfg.startTime) activeQuietConfig.startTime = cfg.startTime;
  if (cfg.endTime) activeQuietConfig.endTime = cfg.endTime;
  return { ...activeQuietConfig };
}

export function getQuietHoursConfig(): QuietHoursConfig {
  return { ...activeQuietConfig };
}

function parseTimeFraction(hhmm: string, fallback: number): number {
  const parts = (hhmm || "").split(":").map(Number);
  if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return parts[0] + parts[1] / 60;
  }
  return fallback;
}

/**
 * Checks whether current local time falls inside quiet hours.
 * Default quiet hours: 22:00 (10:00 PM) to 06:00 (6:00 AM).
 */
export function isQuietHours(now: Date = new Date(), startHour?: number, endHour?: number): boolean {
  let sHour: number;
  let eHour: number;

  if (startHour !== undefined || endHour !== undefined) {
    sHour = startHour ?? 22.0;
    eHour = endHour ?? 6.0;
  } else {
    if (activeQuietConfig.forceMute) return true;
    if (!activeQuietConfig.enabled) return false;
    sHour = parseTimeFraction(activeQuietConfig.startTime, 22.0);
    eHour = parseTimeFraction(activeQuietConfig.endTime, 6.0);
  }

  const current = now.getHours() + now.getMinutes() / 60;
  if (sHour > eHour) {
    // Overnight quiet hours (e.g. 22.0 to 6.0)
    return current >= sHour || current < eHour;
  }
  return current >= sHour && current < eHour;
}

export type AnnouncementType = "deadline_nudge" | "morning_briefing" | "custom";

/**
 * Builds conversational spoken text for Nest speaker announcements.
 */
export function buildAnnouncementText(
  type: AnnouncementType,
  ticket?: HouseTicket,
  minutesRemaining?: number,
  choreTitles?: string[]
): string {
  switch (type) {
    case "deadline_nudge":
      return `Friendly reminder: ${ticket?.title || "your household task"} deadline is in ${minutesRemaining || 45} minutes.`;
    case "morning_briefing":
      const count = choreTitles ? choreTitles.length : 0;
      if (count === 0) {
        return "Good morning! All your household tasks are currently up to date. Have a wonderful day.";
      }
      const list = choreTitles!.slice(0, 3).join(", ");
      return `Good morning. You have ${count} household task${count === 1 ? "" : "s"} scheduled today: ${list}.`;
    case "custom":
    default:
      return ticket?.title || "Household operations alert.";
  }
}

/**
 * Dispatches spoken announcement via the Python pychromecast script.
 */
export async function broadcastAnnouncement(
  message: string,
  speakerName?: string | string[],
  scriptPath?: string,
  bypassQuietHours: boolean = false
): Promise<boolean> {
  if (!bypassQuietHours && isQuietHours()) {
    console.log(`[Announcer] Muted announcement due to quiet hours: "${message}"`);
    return false;
  }

  const script = scriptPath || path.resolve(process.cwd(), "daemon/cast_announcer.py");
  const args = [script, message];
  if (speakerName) {
    const spkStr = Array.isArray(speakerName) ? speakerName.join(",") : speakerName;
    args.push("--speaker", spkStr);
  }

  return new Promise((resolve) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(false);
      }
    }, 30000);

    const finish = (code: number | null) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(code === 0);
      }
    };

    const proc = spawn("python3", args, { stdio: "inherit" });
    proc.on("error", () => {
      // Fallback for Windows or systems where python3 is python
      const winProc = spawn("python", args, { stdio: "inherit" });
      winProc.on("close", (code) => finish(code));
      winProc.on("error", () => finish(1));
    });
    proc.on("close", (code) => finish(code));
  });
}
