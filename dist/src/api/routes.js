import path from "path";
import fs from "fs";
import crypto from "crypto";
import { calculateNextOccurrence, evaluateFloatingTickets } from "../core/scheduler.js";
import { broadcastAnnouncement } from "../../daemon/announcer_client.js";
export function registerRoutes(app, db, photoDir) {
    fs.mkdirSync(photoDir, { recursive: true });
    // Get all tickets
    app.get("/api/tickets", async (_req, reply) => {
        const tickets = db.getTickets();
        return reply.send(tickets);
    });
    // Create or update a ticket
    app.post("/api/tickets", async (req, reply) => {
        const body = req.body;
        if (!body.title || !body.category) {
            return reply.status(400).send({ error: "Title and Category are required" });
        }
        const ticket = {
            id: body.id || `TICK-${Date.now().toString().slice(-4)}`,
            title: body.title,
            category: body.category,
            priority: body.priority || "P2-Normal",
            assignee: body.assignee || "Dad",
            broadcast: body.broadcast,
            recurrence: body.recurrence || { type: "Daily", baseOnCompletion: true },
            preferredWindow: body.preferredWindow || { startHour: 19, startMinute: 0, durationMinutes: 45 },
            currentStatus: body.currentStatus || "Pending",
            nextScheduledAt: body.nextScheduledAt || new Date().toISOString(),
            isFloated: false,
            googleCalendarEventId: body.googleCalendarEventId,
            googleTaskId: body.googleTaskId
        };
        db.saveTicket(ticket);
        return reply.status(201).send(ticket);
    });
    // Delete a ticket
    app.delete("/api/tickets/:id", async (req, reply) => {
        db.deleteTicket(req.params.id);
        return reply.send({ success: true, id: req.params.id });
    });
    // Instant Task Nudge Broadcast
    app.post("/api/tickets/:id/nudge", async (req, reply) => {
        const ticket = db.getTicket(req.params.id);
        if (!ticket)
            return reply.status(404).send({ error: "Ticket not found" });
        const person = ticket.assignee === "Family" ? "the house" : (ticket.assignee || "the house");
        const message = ticket.broadcast?.customMessage ||
            `Attention ${person}: Dad needs ${ticket.title} done right now.`;
        const speakers = ticket.broadcast?.speakers && ticket.broadcast.speakers.length > 0
            ? ticket.broadcast.speakers
            : ["All Rooms"];
        // Reactivate on-demand task to Pending so it shows active
        if (ticket.recurrence.type === "OnDemand") {
            ticket.currentStatus = "Pending";
            ticket.nextScheduledAt = new Date().toISOString();
            db.saveTicket(ticket);
        }
        const ok = await broadcastAnnouncement(message, speakers);
        return reply.send({ success: ok, message, speakers });
    });
    // Helper: Smart natural-language ticket matcher
    const matchTicketFromPhrase = (phrase) => {
        const tickets = db.getTickets();
        const clean = phrase.toLowerCase().trim();
        // 1. Direct ID or substring match
        const direct = tickets.find(t => t.id.toLowerCase() === clean || t.title.toLowerCase().includes(clean));
        if (direct)
            return direct;
        // 2. Keyword overlap match (so full spoken sentences match any task dynamically)
        const stopWords = new Set(["the", "a", "an", "to", "in", "on", "for", "of", "is", "are", "was", "were", "done", "finished", "complete", "completed", "did", "just", "i", "we", "he", "she", "camden", "sawyer", "dad", "please", "now", "right", "task", "chore", "with", "out", "up"]);
        const spokenWords = clean.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length >= 2);
        let bestTicket = null;
        let bestScore = 0;
        for (const t of tickets) {
            const titleWords = t.title.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length >= 2 && !stopWords.has(w));
            let score = 0;
            for (const tw of titleWords) {
                if (spokenWords.some(sw => sw === tw || (sw.length >= 3 && (tw.startsWith(sw) || sw.startsWith(tw))))) {
                    score += 2;
                }
            }
            // Bonus if ticket is currently Pending (prefer active chores over already verified ones)
            if (score > 0 && t.currentStatus === "Pending") {
                score += 1;
            }
            if (score > bestScore) {
                bestScore = score;
                bestTicket = t;
            }
        }
        return bestTicket;
    };
    // Voice Assistant / Webhook Quick Trigger (GET or POST)
    const triggerHandler = async (req, reply) => {
        const rawPhrase = req.params.query.trim();
        const ticket = matchTicketFromPhrase(rawPhrase);
        if (!ticket) {
            return reply.status(404).send({ error: `No task found matching '${rawPhrase}'` });
        }
        const person = ticket.assignee === "Family" ? "the house" : (ticket.assignee || "the house");
        const message = ticket.broadcast?.customMessage ||
            `Attention ${person}: Dad needs ${ticket.title} done right now.`;
        const speakers = ticket.broadcast?.speakers && ticket.broadcast.speakers.length > 0
            ? ticket.broadcast.speakers
            : ["All Rooms"];
        // Set ticket to Pending so it appears active
        ticket.currentStatus = "Pending";
        ticket.nextScheduledAt = new Date().toISOString();
        db.saveTicket(ticket);
        const ok = await broadcastAnnouncement(message, speakers);
        return reply.send({ success: ok, ticket, message, speakers });
    };
    app.post("/api/trigger/:query", triggerHandler);
    app.get("/api/trigger/:query", triggerHandler);
    // Voice Assistant / Webhook Quick Complete (GET or POST)
    const completeVoiceHandler = async (req, reply) => {
        const spokenText = (req.body?.text || req.query?.text || req.params?.query || "").trim();
        if (!spokenText) {
            return reply.status(400).send({ error: "No voice phrase provided" });
        }
        const ticket = matchTicketFromPhrase(spokenText);
        if (!ticket) {
            return reply.status(404).send({ error: `No task found matching '${spokenText}'` });
        }
        // Detect if speaker mentioned their name in the phrase
        const lower = spokenText.toLowerCase();
        let actor = req.body?.actor || ticket.assignee || "Voice Assistant";
        if (lower.includes("sawyer"))
            actor = "Sawyer";
        else if (lower.includes("camden"))
            actor = "Camden";
        else if (lower.includes("dad"))
            actor = "Dad";
        const completedAt = new Date().toISOString();
        const audit = {
            id: `AUDIT-${crypto.randomUUID()}`,
            ticketId: ticket.id,
            completedAt,
            method: "Voice_Closed",
            notes: `🎙️ "${spokenText}"`,
            actor
        };
        const nextDate = calculateNextOccurrence(ticket, new Date(completedAt));
        ticket.currentStatus = "Verified";
        ticket.lastCompletedAt = completedAt;
        ticket.nextScheduledAt = nextDate.toISOString();
        ticket.isFloated = false;
        db.completeTicketTransaction(ticket, audit);
        db.queueSync("complete_ticket", ticket.id, { method: "Voice_Closed", completedAt });
        const person = actor === "Family" ? "everyone" : actor;
        const confirmMsg = `Awesome! ${ticket.title} is marked complete. Great job, ${person}!`;
        const speakers = ticket.broadcast?.speakers && ticket.broadcast.speakers.length > 0
            ? ticket.broadcast.speakers
            : ["All Rooms"];
        const ok = await broadcastAnnouncement(confirmMsg, speakers);
        return reply.send({ success: ok, ticket, audit, message: confirmMsg });
    };
    app.post("/api/done/:query", completeVoiceHandler);
    app.get("/api/done/:query", completeVoiceHandler);
    app.post("/api/complete/:query", completeVoiceHandler);
    app.get("/api/complete/:query", completeVoiceHandler);
    app.post("/api/voice", completeVoiceHandler);
    app.get("/api/voice", completeVoiceHandler);
    // Complete a ticket (Quick Complete or Voice)
    app.post("/api/tickets/:id/complete", async (req, reply) => {
        const { id } = req.params;
        const ticket = db.getTicket(id);
        if (!ticket)
            return reply.status(404).send({ error: "Ticket not found" });
        // Idempotency guard: if already verified, return without double-counting (except for OnDemand tasks)
        if (ticket.currentStatus === "Verified" && ticket.recurrence.type !== "OnDemand") {
            return reply.send({ success: true, ticket, alreadyCompleted: true });
        }
        const completedAt = new Date().toISOString();
        const method = req.body?.method || "Quick_Complete";
        // 1. Prepare completion audit with UUID
        const audit = {
            id: `AUDIT-${crypto.randomUUID()}`,
            ticketId: ticket.id,
            completedAt,
            method,
            photoPath: req.body?.photoPath,
            notes: req.body?.notes,
            actor: "Father"
        };
        // 2. Calculate next occurrence
        const nextDate = calculateNextOccurrence(ticket, new Date(completedAt));
        // 3. Update ticket state atomically
        ticket.currentStatus = "Verified";
        ticket.lastCompletedAt = completedAt;
        ticket.nextScheduledAt = nextDate.toISOString();
        ticket.isFloated = false;
        db.completeTicketTransaction(ticket, audit);
        db.queueSync("complete_ticket", ticket.id, { method, completedAt });
        return reply.send({ success: true, ticket, audit });
    });
    // Upload photo verification proof
    app.post("/api/tickets/:id/photo", async (req, reply) => {
        const { id } = req.params;
        const ticket = db.getTicket(id);
        if (!ticket)
            return reply.status(404).send({ error: "Ticket not found" });
        // Idempotency guard (except for OnDemand tasks)
        if (ticket.currentStatus === "Verified" && ticket.recurrence.type !== "OnDemand") {
            return reply.send({ success: true, ticket, alreadyCompleted: true });
        }
        const data = await req.file();
        if (!data)
            return reply.status(400).send({ error: "No photo file provided" });
        const filename = `${id}_${Date.now()}${path.extname(data.filename) || ".jpg"}`;
        const filePath = path.join(photoDir, filename);
        await new Promise((resolve, reject) => {
            const writeStream = fs.createWriteStream(filePath);
            data.file.pipe(writeStream);
            writeStream.on("finish", resolve);
            writeStream.on("error", reject);
        });
        const completedAt = new Date().toISOString();
        const audit = {
            id: `AUDIT-${crypto.randomUUID()}`,
            ticketId: ticket.id,
            completedAt,
            method: "Photo_Verified",
            photoPath: `/photos/${filename}`,
            actor: "Father"
        };
        const nextDate = calculateNextOccurrence(ticket, new Date(completedAt));
        ticket.currentStatus = "Verified";
        ticket.lastCompletedAt = completedAt;
        ticket.nextScheduledAt = nextDate.toISOString();
        ticket.isFloated = false;
        db.completeTicketTransaction(ticket, audit);
        db.queueSync("verify_photo", ticket.id, { photoPath: `/photos/${filename}`, completedAt });
        return reply.send({ success: true, ticket, audit });
    });
    // Evaluate and float overdue pending chores
    app.post("/api/scheduler/float", async (_req, reply) => {
        const tickets = db.getTickets();
        const result = evaluateFloatingTickets(tickets, new Date());
        for (const updated of result.updated) {
            db.saveTicket(updated);
        }
        return reply.send(result);
    });
    // Get audit log
    app.get("/api/audit", async (req, reply) => {
        const audits = db.getAuditLog(req.query.ticketId);
        return reply.send(audits);
    });
    // Test Voice Broadcast
    app.post("/api/announce", async (req, reply) => {
        const msg = req.body?.message || "Hello! HouseOps voice broadcast is operational across all rooms.";
        const speaker = req.body?.speaker || "All Rooms";
        const ok = await broadcastAnnouncement(msg, speaker);
        return reply.send({ success: ok, message: msg, speaker });
    });
}
