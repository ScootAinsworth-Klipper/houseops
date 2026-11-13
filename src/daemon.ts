import { HouseOpsDatabase } from "./db/database.js";
import { evaluateFloatingTickets } from "./core/scheduler.js";
import { isQuietHours, buildAnnouncementText, broadcastAnnouncement } from "../daemon/announcer_client.js";

export interface DaemonCycleOptions {
  now?: Date;
  announcerFn?: (message: string) => Promise<boolean>;
}

export interface DaemonCycleResult {
  floatedCount: number;
  announcedCount: number;
}

export async function runDaemonCycle(
  db: HouseOpsDatabase,
  options: DaemonCycleOptions = {}
): Promise<DaemonCycleResult> {
  const now = options.now || new Date();
  const announcer = options.announcerFn || broadcastAnnouncement;

  // 1. Evaluate & float slipped tickets
  const tickets = db.getTickets();
  const floatingResult = evaluateFloatingTickets(tickets, now);
  for (const updated of floatingResult.updated) {
    db.saveTicket(updated);
    db.queueSync("float_ticket", updated.id, { nextScheduledAt: updated.nextScheduledAt });
  }

  // 2. Check for P1 approaching deadlines (between 30 and 45 minutes remaining)
  let announcedCount = 0;
  if (!isQuietHours(now)) {
    for (const ticket of tickets) {
      if (ticket.currentStatus !== "Pending" || ticket.priority !== "P1-Urgent") continue;

      const schedTime = new Date(ticket.nextScheduledAt).getTime();
      const diffMinutes = Math.round((schedTime - now.getTime()) / (60 * 1000));

      if (diffMinutes > 0 && diffMinutes <= 45 && diffMinutes >= 40) {
        const text = buildAnnouncementText("deadline_nudge", ticket, diffMinutes);
        await announcer(text);
        announcedCount++;
      }
    }
  }

  return {
    floatedCount: floatingResult.floated.length,
    announcedCount
  };
}

let daemonTimer: NodeJS.Timeout | null = null;

export function startDaemon(db: HouseOpsDatabase, intervalMs: number = 60000): void {
  if (daemonTimer) return;
  console.log("⚡ HouseOps Background Scheduler Daemon active (polling every 60s)");
  daemonTimer = setInterval(() => {
    runDaemonCycle(db).catch(err => console.error("Daemon cycle error:", err));
  }, intervalMs);
}

export function stopDaemon(): void {
  if (daemonTimer) {
    clearInterval(daemonTimer);
    daemonTimer = null;
  }
}
