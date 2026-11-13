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

  const tickets = db.getTickets();

  // 0. Auto-reactivate recurring tickets whose next window has arrived
  for (const ticket of tickets) {
    if (ticket.currentStatus === "Verified" && ticket.recurrence.type !== "OnDemand") {
      const schedTime = new Date(ticket.nextScheduledAt).getTime();
      if (now.getTime() >= schedTime - 30 * 60 * 1000) {
        ticket.currentStatus = "Pending";
        if (ticket.broadcast) {
          delete (ticket.broadcast as any).lastAnnouncedStage;
          delete (ticket.broadcast as any).lastAnnouncedAt;
        }
        db.saveTicket(ticket);
      }
    }
  }

  // 1. Evaluate & float slipped tickets
  const floatingResult = evaluateFloatingTickets(tickets, now);
  for (const updated of floatingResult.updated) {
    db.saveTicket(updated);
    db.queueSync("float_ticket", updated.id, { nextScheduledAt: updated.nextScheduledAt });
  }

  // 2. Evaluate Broadcast Reminders (Per-task config or P1 default)
  let announcedCount = 0;
  if (!isQuietHours(now)) {
    for (const ticket of tickets) {
      if (ticket.currentStatus !== "Pending" || ticket.recurrence.type === "OnDemand") continue;

      const schedTime = new Date(ticket.nextScheduledAt).getTime();
      const diffMinutes = Math.round((schedTime - now.getTime()) / (60 * 1000));

      const stages: string[] = ticket.broadcast?.stages ||
        (ticket.broadcast?.timing && ticket.broadcast.timing !== "none" ? [ticket.broadcast.timing] : []);
      if (stages.length === 0 && ticket.priority === "P1-Urgent") {
        stages.push("exact");
      }
      if (stages.length === 0) continue;

      let triggeredStage: string | null = null;
      if (stages.includes("exact") && diffMinutes >= -2 && diffMinutes <= 2) {
        triggeredStage = "exact";
      } else if (stages.includes("15m_before") && diffMinutes >= 12 && diffMinutes <= 16) {
        triggeredStage = "15m_before";
      } else if (stages.includes("overdue") && diffMinutes <= -15 && diffMinutes >= -25) {
        triggeredStage = "overdue";
      }

      if (!triggeredStage) continue;

      // Guard against repeat announcement of the same stage
      if (ticket.broadcast?.lastAnnouncedStage === triggeredStage) {
        const lastAnnounceTime = new Date(ticket.broadcast.lastAnnouncedAt || 0).getTime();
        if (now.getTime() - lastAnnounceTime < 15 * 60 * 1000) {
          continue;
        }
      }

      let message = ticket.broadcast?.customMessage;
      const person = ticket.assignee === "Family" ? "the house" : (ticket.assignee || "the house");
      if (triggeredStage === "overdue") {
        message = `Attention ${person}: ${ticket.title} is now overdue. Please complete it and submit photo verification.`;
      } else if (triggeredStage === "15m_before") {
        message = `Friendly reminder for ${person}: ${ticket.title} is coming up in 15 minutes.`;
      } else if (!message) {
        message = `Friendly reminder for ${person}: it is time for ${ticket.title}.`;
      }

      const speakers = ticket.broadcast?.speakers && ticket.broadcast.speakers.length > 0
        ? ticket.broadcast.speakers
        : ["All Rooms"];

      await broadcastAnnouncement(message, speakers);

      // Record last announcement stage and time
      ticket.broadcast = {
        ...(ticket.broadcast || { speakers }),
        stages: stages as any,
        lastAnnouncedAt: now.toISOString(),
        lastAnnouncedStage: triggeredStage
      };
      db.saveTicket(ticket);
      announcedCount++;
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
