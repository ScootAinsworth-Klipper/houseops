import { evaluateFloatingTickets } from "./core/scheduler.js";
import { isQuietHours, broadcastAnnouncement } from "../daemon/announcer_client.js";
export async function runDaemonCycle(db, options = {}) {
    const now = options.now || new Date();
    const announcer = options.announcerFn || broadcastAnnouncement;
    // 1. Evaluate & float slipped tickets
    const tickets = db.getTickets();
    const floatingResult = evaluateFloatingTickets(tickets, now);
    for (const updated of floatingResult.updated) {
        db.saveTicket(updated);
        db.queueSync("float_ticket", updated.id, { nextScheduledAt: updated.nextScheduledAt });
    }
    // 2. Evaluate Broadcast Reminders (Per-task config or P1 default)
    let announcedCount = 0;
    if (!isQuietHours(now)) {
        for (const ticket of tickets) {
            if (ticket.currentStatus !== "Pending")
                continue;
            const schedTime = new Date(ticket.nextScheduledAt).getTime();
            const diffMinutes = Math.round((schedTime - now.getTime()) / (60 * 1000));
            const timing = ticket.broadcast?.timing || (ticket.priority === "P1-Urgent" ? "exact" : "none");
            if (timing === "none")
                continue;
            let shouldAnnounce = false;
            if (timing === "exact" && diffMinutes >= -2 && diffMinutes <= 2) {
                shouldAnnounce = true;
            }
            else if (timing === "15m_before" && diffMinutes >= 12 && diffMinutes <= 16) {
                shouldAnnounce = true;
            }
            else if (timing === "overdue" && diffMinutes <= -5 && diffMinutes >= -15) {
                shouldAnnounce = true;
            }
            // Guard against repeat announcements within 15 minutes
            if (shouldAnnounce && ticket.broadcast?.lastAnnouncedAt) {
                const lastAnnounceTime = new Date(ticket.broadcast.lastAnnouncedAt).getTime();
                if (now.getTime() - lastAnnounceTime < 15 * 60 * 1000) {
                    shouldAnnounce = false;
                }
            }
            if (shouldAnnounce) {
                const message = ticket.broadcast?.customMessage ||
                    `Friendly reminder for ${ticket.assignee || "the house"}: it is time for ${ticket.title}.`;
                const speakers = ticket.broadcast?.speakers && ticket.broadcast.speakers.length > 0
                    ? ticket.broadcast.speakers
                    : ["All Rooms"];
                await broadcastAnnouncement(message, speakers);
                // Record last announcement time
                ticket.broadcast = {
                    ...(ticket.broadcast || { timing, speakers }),
                    lastAnnouncedAt: now.toISOString()
                };
                db.saveTicket(ticket);
                announcedCount++;
            }
        }
    }
    return {
        floatedCount: floatingResult.floated.length,
        announcedCount
    };
}
let daemonTimer = null;
export function startDaemon(db, intervalMs = 60000) {
    if (daemonTimer)
        return;
    console.log("⚡ HouseOps Background Scheduler Daemon active (polling every 60s)");
    daemonTimer = setInterval(() => {
        runDaemonCycle(db).catch(err => console.error("Daemon cycle error:", err));
    }, intervalMs);
}
export function stopDaemon() {
    if (daemonTimer) {
        clearInterval(daemonTimer);
        daemonTimer = null;
    }
}
