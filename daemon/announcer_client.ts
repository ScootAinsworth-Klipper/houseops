import { spawn } from "child_process";
import path from "path";
import { HouseTicket } from "../src/core/types.js";

/**
 * Checks whether current local time falls inside quiet hours.
 * Default quiet hours: 21:30 (9:30 PM) to 07:00 (7:00 AM).
 */
export function isQuietHours(now: Date = new Date(), startHour: number = 21.5, endHour: number = 7.0): boolean {
  const current = now.getHours() + now.getMinutes() / 60;
  if (startHour > endHour) {
    // Overnight quiet hours (e.g. 21.5 to 7.0)
    return current >= startHour || current < endHour;
  }
  return current >= startHour && current < endHour;
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
  speakerName?: string,
  scriptPath?: string
): Promise<boolean> {
  if (isQuietHours()) {
    console.log(`[Announcer] Muted announcement due to quiet hours: "${message}"`);
    return false;
  }

  const script = scriptPath || path.resolve(process.cwd(), "daemon/cast_announcer.py");
  const args = [script, message];
  if (speakerName) {
    args.push("--speaker", speakerName);
  }

  return new Promise((resolve) => {
    const proc = spawn("python3", args, { stdio: "inherit" });
    proc.on("error", () => {
      // Fallback for Windows or systems where python3 is python
      const winProc = spawn("python", args, { stdio: "inherit" });
      winProc.on("close", (code) => resolve(code === 0));
      winProc.on("error", () => resolve(false));
    });
    proc.on("close", (code) => resolve(code === 0));
  });
}
