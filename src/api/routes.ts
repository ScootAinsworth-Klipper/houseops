import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { HouseOpsDatabase } from "../db/database.js";
import { calculateNextOccurrence, evaluateFloatingTickets } from "../core/scheduler.js";
import { HouseTicket, CompletionRecord, CompletionMethod } from "../core/types.js";
import { broadcastAnnouncement, getQuietHoursConfig, setQuietHoursConfig, isQuietHours, QuietHoursConfig } from "../../daemon/announcer_client.js";
import { runDaemonCycle } from "../daemon.js";

export function registerRoutes(app: FastifyInstance, db: HouseOpsDatabase, photoDir: string) {
  fs.mkdirSync(photoDir, { recursive: true });

  // Load persisted quiet hours config on startup
  const rawQuiet = db.getSetting("quiet_hours_config");
  if (rawQuiet) {
    try {
      setQuietHoursConfig(JSON.parse(rawQuiet));
    } catch (_) {}
  }

  // Get all tickets
  app.get("/api/tickets", async (_req, reply) => {
    const tickets = db.getTickets();
    return reply.send(tickets);
  });

  // Create or update a ticket
  app.post("/api/tickets", async (req: FastifyRequest<{ Body: Partial<HouseTicket> }>, reply: FastifyReply) => {
    const body = req.body;
    if (!body.title || !body.category) {
      return reply.status(400).send({ error: "Title and Category are required" });
    }

    const ticket: HouseTicket = {
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
      requirePhoto: Boolean(body.requirePhoto),
      googleCalendarEventId: body.googleCalendarEventId,
      googleTaskId: body.googleTaskId
    };

    db.saveTicket(ticket);
    return reply.status(201).send(ticket);
  });

  // Delete a ticket
  app.delete("/api/tickets/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    db.deleteTicket(req.params.id);
    return reply.send({ success: true, id: req.params.id });
  });

  // Instant Task Nudge Broadcast
  app.post("/api/tickets/:id/nudge", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const ticket = db.getTicket(req.params.id);
    if (!ticket) return reply.status(404).send({ error: "Ticket not found" });

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
  const matchTicketFromPhrase = (phrase: string) => {
    const tickets = db.getTickets();
    const clean = phrase.toLowerCase().trim();
    // 1. Direct ID or substring match
    const direct = tickets.find(t => t.id.toLowerCase() === clean || t.title.toLowerCase().includes(clean));
    if (direct) return direct;

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
  const triggerHandler = async (req: FastifyRequest<{ Params: { query: string } }>, reply: FastifyReply) => {
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
  const completeVoiceHandler = async (
    req: FastifyRequest<{ Params: { query?: string }; Querystring: { text?: string }; Body?: { text?: string; actor?: string } }>,
    reply: FastifyReply
  ) => {
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
    if (lower.includes("sawyer")) actor = "Sawyer";
    else if (lower.includes("camden")) actor = "Camden";
    else if (lower.includes("dad")) actor = "Dad";

    const completedAt = new Date().toISOString();
    const audit: CompletionRecord = {
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
  app.post(
    "/api/tickets/:id/complete",
    async (
      req: FastifyRequest<{
        Params: { id: string };
        Body: { method?: CompletionMethod; notes?: string; photoPath?: string; actor?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = req.params;
      const ticket = db.getTicket(id);
      if (!ticket) return reply.status(404).send({ error: "Ticket not found" });

      // Idempotency guard: if already verified, return without double-counting (except for OnDemand tasks)
      if (ticket.currentStatus === "Verified" && ticket.recurrence.type !== "OnDemand") {
        return reply.send({ success: true, ticket, alreadyCompleted: true });
      }

      const completedAt = new Date().toISOString();
      const method = req.body?.method || "Quick_Complete";
      const actor = req.body?.actor || ticket.assignee || "Dad";

      // 1. Prepare completion audit with UUID
      const audit: CompletionRecord = {
        id: `AUDIT-${crypto.randomUUID()}`,
        ticketId: ticket.id,
        completedAt,
        method,
        photoPath: req.body?.photoPath,
        notes: req.body?.notes,
        actor
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
    }
  );

  // Reopen / Send Back a completed ticket (Admin undo or rejection)
  app.post(
    "/api/tickets/:id/reopen",
    async (
      req: FastifyRequest<{
        Params: { id: string };
        Body?: { auditId?: string; announce?: boolean; reason?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = req.params;
      const ticket = db.getTicket(id);
      if (!ticket) return reply.status(404).send({ error: "Ticket not found" });

      if (req.body?.auditId) {
        db.deleteCompletionRecord(req.body.auditId);
      } else {
        db.deleteLatestCompletionForTicket(ticket.id);
      }

      ticket.currentStatus = "Pending";
      ticket.isFloated = false;
      ticket.googleTaskId = undefined; // Re-sync to Google Tasks as active
      ticket.nextScheduledAt = new Date().toISOString();

      db.saveTicket(ticket);

      let announced = false;
      if (req.body?.announce) {
        const person = ticket.assignee === "Family" ? "everyone" : (ticket.assignee || "the house");
        const reasonText = req.body.reason ? ` ${req.body.reason}` : "";
        const msg = `Attention ${person}: Dad checked ${ticket.title} and sent it back.${reasonText} Please make sure it is completely finished.`;
        const speakers = ticket.broadcast?.speakers?.length ? ticket.broadcast.speakers : ["All Rooms"];
        announced = await broadcastAnnouncement(msg, speakers);
      }

      return reply.send({ success: true, ticket, announced });
    }
  );

  // Upload photo verification proof
  app.post("/api/tickets/:id/photo", async (req: FastifyRequest<{ Params: { id: string }; Querystring: { actor?: string } }>, reply: FastifyReply) => {
    const { id } = req.params;
    const ticket = db.getTicket(id);
    if (!ticket) return reply.status(404).send({ error: "Ticket not found" });

    // Idempotency guard (except for OnDemand tasks)
    if (ticket.currentStatus === "Verified" && ticket.recurrence.type !== "OnDemand") {
      return reply.send({ success: true, ticket, alreadyCompleted: true });
    }

    const data = await (req as any).file();
    if (!data) return reply.status(400).send({ error: "No photo file provided" });

    const filename = `${id}_${Date.now()}${path.extname(data.filename) || ".jpg"}`;
    const filePath = path.join(photoDir, filename);

    await new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(filePath);
      data.file.pipe(writeStream);
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });

    const completedAt = new Date().toISOString();
    const actor = req.query?.actor || ticket.assignee || "Dad";
    const audit: CompletionRecord = {
      id: `AUDIT-${crypto.randomUUID()}`,
      ticketId: ticket.id,
      completedAt,
      method: "Photo_Verified",
      photoPath: `/photos/${filename}`,
      actor
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
  app.get("/api/audit", async (req: FastifyRequest<{ Querystring: { ticketId?: string } }>, reply) => {
    const audits = db.getAuditLog(req.query.ticketId);
    return reply.send(audits);
  });

  // Test Voice Broadcast
  app.post("/api/announce", async (req: FastifyRequest<{ Body: { message?: string; speaker?: string } }>, reply) => {
    const msg = req.body?.message || "Hello! HouseOps voice broadcast is operational across all rooms.";
    const speaker = req.body?.speaker || "All Rooms";
    const ok = await broadcastAnnouncement(msg, speaker);
    return reply.send({ success: ok, message: msg, speaker });
  });

  // Get Quiet Hours Settings & Status
  app.get("/api/settings/quiet-hours", async (_req, reply) => {
    const cfg = getQuietHoursConfig();
    return reply.send({
      ...cfg,
      isCurrentlyQuiet: isQuietHours(new Date())
    });
  });

  // Update Quiet Hours Settings
  app.post("/api/settings/quiet-hours", async (req: FastifyRequest<{ Body: Partial<QuietHoursConfig> }>, reply) => {
    const body = req.body || {};
    const updated = setQuietHoursConfig({
      enabled: body.enabled !== undefined ? Boolean(body.enabled) : undefined,
      forceMute: body.forceMute !== undefined ? Boolean(body.forceMute) : undefined,
      startTime: body.startTime,
      endTime: body.endTime
    });
    db.setSetting("quiet_hours_config", JSON.stringify(updated));
    return reply.send({
      ...updated,
      isCurrentlyQuiet: isQuietHours(new Date())
    });
  });

  // Google Tasks OAuth / Bridge Status
  app.get("/api/google/status", async (_req, reply) => {
    const hasRefresh = Boolean(db.getSetting("google_refresh_token"));
    const hasWebapp = Boolean(db.getSetting("google_webapp_url"));
    const clientId = db.getSetting("google_client_id");
    return reply.send({ connected: hasRefresh || hasWebapp, hasClientConfig: Boolean(clientId) });
  });

  // Save Google OAuth Credentials / Refresh Token or Apps Script WebApp URL directly
  app.post(
    "/api/google/auth",
    async (
      req: FastifyRequest<{ Body: { webappUrl?: string; clientId?: string; clientSecret?: string; refreshToken?: string } }>,
      reply
    ) => {
      const { webappUrl, clientId, clientSecret, refreshToken } = req.body || {};
      if (webappUrl) db.setSetting("google_webapp_url", webappUrl.trim());
      if (clientId) db.setSetting("google_client_id", clientId.trim());
      if (clientSecret) db.setSetting("google_client_secret", clientSecret.trim());
      if (refreshToken) db.setSetting("google_refresh_token", refreshToken.trim());

      // Trigger immediate sync
      await runDaemonCycle(db);
      const isConnected = Boolean(db.getSetting("google_refresh_token") || db.getSetting("google_webapp_url"));
      return reply.send({ success: true, connected: isConnected });
    }
  );
}
