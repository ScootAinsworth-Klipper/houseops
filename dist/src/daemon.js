import crypto from "crypto";
import fs from "fs";
import path from "path";
import { evaluateFloatingTickets, calculateNextOccurrence } from "./core/scheduler.js";
import { createGoogleTasksClient, syncTicketToTasks } from "./sync/google.js";
import { isQuietHours, broadcastAnnouncement } from "../daemon/announcer_client.js";
import { parseMenuVoiceQuery, announceSchoolMenu } from "./core/school_menu.js";
export async function runDaemonCycle(db, options = {}) {
    const now = options.now || new Date();
    const announcer = options.announcerFn || broadcastAnnouncement;
    const tickets = db.getTickets();
    // 0. Auto-reactivate recurring tickets whose next window has arrived
    for (const ticket of tickets) {
        if (ticket.currentStatus === "Verified" && ticket.recurrence.type !== "OnDemand") {
            const schedTime = new Date(ticket.nextScheduledAt).getTime();
            if (now.getTime() >= schedTime - 30 * 60 * 1000) {
                ticket.currentStatus = "Pending";
                ticket.googleTaskId = undefined; // Force fresh Google Task for new cycle
                if (ticket.broadcast) {
                    delete ticket.broadcast.lastAnnouncedStage;
                    delete ticket.broadcast.lastAnnouncedAt;
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
            if (ticket.currentStatus !== "Pending" || ticket.recurrence.type === "OnDemand")
                continue;
            const schedTime = new Date(ticket.nextScheduledAt).getTime();
            const diffMinutes = Math.round((schedTime - now.getTime()) / (60 * 1000));
            const stages = ticket.broadcast?.stages ||
                (ticket.broadcast?.timing && ticket.broadcast.timing !== "none" ? [ticket.broadcast.timing] : []);
            if (stages.length === 0 && ticket.priority === "P1-Urgent") {
                stages.push("exact");
            }
            if (stages.length === 0)
                continue;
            let triggeredStage = null;
            if (stages.includes("exact") && diffMinutes >= -2 && diffMinutes <= 2) {
                triggeredStage = "exact";
            }
            else if (stages.includes("15m_before") && diffMinutes >= 12 && diffMinutes <= 16) {
                triggeredStage = "15m_before";
            }
            else if (stages.includes("overdue") && diffMinutes <= -15 && diffMinutes >= -25) {
                triggeredStage = "overdue";
            }
            if (!triggeredStage)
                continue;
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
            }
            else if (triggeredStage === "15m_before") {
                message = `Friendly reminder for ${person}: ${ticket.title} is coming up in 15 minutes.`;
            }
            else if (!message) {
                message = `Friendly reminder for ${person}: it is time for ${ticket.title}.`;
            }
            const speakers = ticket.broadcast?.speakers && ticket.broadcast.speakers.length > 0
                ? ticket.broadcast.speakers
                : ["All Rooms"];
            const targetProfile = ticket.assignee || "Family";
            if (triggeredStage === "overdue") {
                db.pushNotification(targetProfile, `⚠️ Overdue: ${ticket.title}`, `${ticket.title} is now overdue! Please finish it.`, "active");
                if (targetProfile !== "Dad") {
                    db.pushNotification("Dad", `⏳ Overdue (${targetProfile}): ${ticket.title}`, `${ticket.title} (${targetProfile}) is 15m overdue.`, "active");
                }
            }
            else if (triggeredStage === "15m_before") {
                db.pushNotification(targetProfile, `⏰ Upcoming (15m): ${ticket.title}`, `${ticket.title} is coming up in 15 minutes.`, "active");
            }
            else {
                db.pushNotification(targetProfile, `⏰ Time for Chore: ${ticket.title}`, message, "active");
            }
            await broadcastAnnouncement(message, speakers);
            // Record last announcement stage and time
            ticket.broadcast = {
                ...(ticket.broadcast || { speakers }),
                stages: stages,
                lastAnnouncedAt: now.toISOString(),
                lastAnnouncedStage: triggeredStage
            };
            db.saveTicket(ticket);
            announcedCount++;
        }
    }
    // 3. Google Tasks 2-Way Sync & Standalone Google Home Voice Check-Off Poller
    const webappUrl = db.getSetting("google_webapp_url");
    const clientId = db.getSetting("google_client_id");
    const clientSecret = db.getSetting("google_client_secret");
    const refreshToken = db.getSetting("google_refresh_token");
    if (webappUrl || (clientId && clientSecret && refreshToken)) {
        try {
            const gClient = createGoogleTasksClient({ webappUrl, clientId, clientSecret, refreshToken });
            const currentTickets = db.getTickets();
            // 3a. Push any Pending tickets that don't yet have a Google Task ID (or reuse existing task with matching Ticket ID in notes)
            const listRes = await gClient.tasks.list({ tasklist: "@default" });
            const gTasks = listRes.data?.items || [];
            for (const t of currentTickets) {
                if (t.currentStatus === "Pending" && !t.googleTaskId) {
                    const existing = gTasks.find(g => g.status === "needsAction" && (g.notes || "").includes(`Ticket: ${t.id}`));
                    if (existing) {
                        t.googleTaskId = existing.id;
                        await syncTicketToTasks(gClient, "@default", t);
                        db.saveTicket(t);
                    }
                    else {
                        const gId = await syncTicketToTasks(gClient, "@default", t);
                        if (gId) {
                            t.googleTaskId = gId;
                            db.saveTicket(t);
                        }
                    }
                }
            }
            // 3b. Poll Google Tasks for completions or voice-added phrases from Google Home speakers
            const linkedTaskIds = new Set(currentTickets.map(t => t.googleTaskId).filter(Boolean));
            for (const t of currentTickets) {
                if (t.currentStatus === "Pending" && t.googleTaskId) {
                    const matchedGTask = gTasks.find(g => g.id === t.googleTaskId);
                    if (matchedGTask && matchedGTask.status === "completed") {
                        const completedAt = new Date().toISOString();
                        const actor = t.assignee || "Google Home";
                        const audit = {
                            id: `AUDIT-${crypto.randomUUID()}`,
                            ticketId: t.id,
                            completedAt,
                            method: "Voice_Closed",
                            notes: `🎙️ Checked off via Google Home ("${t.title}")`,
                            actor
                        };
                        const nextDate = calculateNextOccurrence(t, new Date(completedAt));
                        t.currentStatus = "Verified";
                        t.lastCompletedAt = completedAt;
                        t.nextScheduledAt = nextDate.toISOString();
                        t.isFloated = false;
                        db.completeTicketTransaction(t, audit);
                        db.pushNotification("Dad", `🎙️ ${actor} Completed Chore`, `${t.title} checked off via Google Home.`, "audit");
                        const person = actor === "Family" ? "everyone" : actor;
                        const confirmMsg = `Awesome! ${t.title} is marked complete. Great job, ${person}!`;
                        const speakers = t.broadcast?.speakers?.length ? t.broadcast.speakers : ["All Rooms"];
                        await broadcastAnnouncement(confirmMsg, speakers);
                    }
                }
            }
            // 3c. Check unlinked voice tasks (School Menu voice queries & chore completion phrases)
            // Only intercept explicit menu queries or chore completions so regular personal Google Tasks are never touched!
            const completionMarkers = /\b(done|finished|complete|completed|did|fed|swapped|cleaned|picked up|unloaded|loaded|sorted|gathered|wiped|took out|checked off|houseops)\b/i;
            const stopWords = new Set(["the", "a", "an", "to", "in", "on", "for", "of", "is", "are", "was", "were", "done", "finished", "complete", "completed", "did", "just", "i", "we", "he", "she", "camden", "sawyer", "dad", "please", "now", "right", "task", "chore", "with", "out", "up"]);
            for (const g of gTasks) {
                if (g.status === "needsAction" && !linkedTaskIds.has(g.id) && !(g.notes || "").includes("Ticket: TICK-")) {
                    const rawTitle = (g.title || "").trim();
                    if (!rawTitle)
                        continue;
                    // Intercept School Lunch / Breakfast / Menu Routine triggers first
                    const menuQuery = parseMenuVoiceQuery(rawTitle);
                    if (menuQuery) {
                        try {
                            await gClient.tasks.delete({ tasklist: "@default", task: g.id });
                        }
                        catch (_) { }
                        const spoken = await announceSchoolMenu(db, { meal: menuQuery.meal, target: menuQuery.target });
                        console.log(`[SchoolMenu] Voice query "${rawTitle}" -> "${spoken.message}"`);
                        continue;
                    }
                    if (!completionMarkers.test(rawTitle))
                        continue;
                    const lower = rawTitle.toLowerCase();
                    const spokenWords = lower.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 2);
                    let bestTicket = null;
                    let bestScore = 0;
                    for (const t of currentTickets) {
                        const titleWords = t.title.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 2 && !stopWords.has(w));
                        let score = 0;
                        for (const tw of titleWords) {
                            if (spokenWords.some((sw) => sw === tw || (sw.length >= 3 && (tw.startsWith(sw) || sw.startsWith(tw))))) {
                                score += 2;
                            }
                        }
                        if (score > 0 && t.currentStatus === "Pending")
                            score += 1;
                        if (score > bestScore) {
                            bestScore = score;
                            bestTicket = t;
                        }
                    }
                    if (bestTicket && bestScore >= 2) {
                        let actor = bestTicket.assignee || "Google Home";
                        if (lower.includes("sawyer"))
                            actor = "Sawyer";
                        else if (lower.includes("camden"))
                            actor = "Camden";
                        else if (lower.includes("dad"))
                            actor = "Dad";
                        const completedAt = new Date().toISOString();
                        const audit = {
                            id: `AUDIT-${crypto.randomUUID()}`,
                            ticketId: bestTicket.id,
                            completedAt,
                            method: "Voice_Closed",
                            notes: `🎙️ "${rawTitle}"`,
                            actor
                        };
                        const nextDate = calculateNextOccurrence(bestTicket, new Date(completedAt));
                        bestTicket.currentStatus = "Verified";
                        bestTicket.lastCompletedAt = completedAt;
                        bestTicket.nextScheduledAt = nextDate.toISOString();
                        bestTicket.isFloated = false;
                        db.completeTicketTransaction(bestTicket, audit);
                        db.pushNotification("Dad", `🎙️ ${actor} Completed Chore`, `${bestTicket.title} — "${rawTitle}"`, "audit");
                        // Clean up the temporary voice-added task & mark linked Google Task completed
                        try {
                            await gClient.tasks.delete({ tasklist: "@default", task: g.id });
                        }
                        catch (_) { }
                        if (bestTicket.googleTaskId) {
                            try {
                                await syncTicketToTasks(gClient, "@default", bestTicket);
                            }
                            catch (_) { }
                        }
                        const person = actor === "Family" ? "everyone" : actor;
                        const confirmMsg = `Awesome! ${bestTicket.title} is marked complete. Great job, ${person}!`;
                        const speakers = bestTicket.broadcast?.speakers?.length ? bestTicket.broadcast.speakers : ["All Rooms"];
                        await broadcastAnnouncement(confirmMsg, speakers);
                    }
                }
            }
        }
        catch (err) {
            console.error("Google Tasks sync error:", err);
        }
    }
    return {
        floatedCount: floatingResult.floated.length,
        announcedCount
    };
}
let daemonTimer = null;
let lastPhotoPruneAt = 0;
export function pruneOldLocalPhotos(maxAgeDays = 30) {
    const photoDir = path.resolve(process.cwd(), process.env.PHOTO_DIR || "photos");
    if (!fs.existsSync(photoDir))
        return 0;
    const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    let deleted = 0;
    try {
        for (const file of fs.readdirSync(photoDir)) {
            if (!/\.(jpg|jpeg|png|webp)$/i.test(file))
                continue;
            const fullPath = path.join(photoDir, file);
            const stat = fs.statSync(fullPath);
            if (stat.isFile() && stat.mtimeMs < cutoffMs) {
                fs.unlinkSync(fullPath);
                deleted++;
            }
        }
        if (deleted > 0) {
            console.log(`[Storage] Auto-pruned ${deleted} local photo(s) older than ${maxAgeDays} days from ${photoDir}`);
        }
    }
    catch (err) {
        console.error("[Storage] Photo prune error:", err);
    }
    return deleted;
}
function getAdaptivePollIntervalMs(defaultMs) {
    if (defaultMs < 15000)
        return defaultMs;
    const now = new Date();
    const chicagoParts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Chicago",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    }).formatToParts(now);
    const wd = chicagoParts.find(p => p.type === "weekday")?.value || "";
    const h = parseInt(chicagoParts.find(p => p.type === "hour")?.value || "0", 10);
    const m = parseInt(chicagoParts.find(p => p.type === "minute")?.value || "0", 10);
    const isWeekday = !["Sat", "Sun"].includes(wd);
    const mins = h * 60 + m;
    // Poll every 5s during school morning prep (6:00 AM - 8:30 AM CST) for snappy "What's for lunch?" answers
    if (isWeekday && mins >= 360 && mins <= 510) {
        return 5000;
    }
    return defaultMs;
}
export function startDaemon(db, intervalMs = 15000) {
    if (daemonTimer)
        return;
    console.log(`⚡ HouseOps Background Scheduler & Google Tasks Daemon active (polling every ${Math.round(intervalMs / 1000)}s, 5s on weekday mornings)`);
    pruneOldLocalPhotos(30);
    lastPhotoPruneAt = Date.now();
    const tick = async () => {
        try {
            if (Date.now() - lastPhotoPruneAt > 6 * 60 * 60 * 1000) {
                pruneOldLocalPhotos(30);
                lastPhotoPruneAt = Date.now();
            }
            await runDaemonCycle(db);
        }
        catch (err) {
            console.error("Daemon cycle error:", err);
        }
        finally {
            if (daemonTimer !== null) {
                daemonTimer = setTimeout(tick, getAdaptivePollIntervalMs(intervalMs));
            }
        }
    };
    daemonTimer = setTimeout(tick, 3000);
}
export function stopDaemon() {
    if (daemonTimer) {
        clearTimeout(daemonTimer);
        daemonTimer = null;
    }
}
