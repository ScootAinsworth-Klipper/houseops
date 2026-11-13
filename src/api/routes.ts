import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import path from "path";
import fs from "fs";
import { HouseOpsDatabase } from "../db/database.js";
import { calculateNextOccurrence, evaluateFloatingTickets } from "../core/scheduler.js";
import { HouseTicket, CompletionRecord, CompletionMethod } from "../core/types.js";

export function registerRoutes(app: FastifyInstance, db: HouseOpsDatabase, photoDir: string) {
  fs.mkdirSync(photoDir, { recursive: true });

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
      recurrence: body.recurrence || { type: "Daily", baseOnCompletion: true },
      preferredWindow: body.preferredWindow || { startHour: 19, durationMinutes: 45 },
      currentStatus: body.currentStatus || "Pending",
      nextScheduledAt: body.nextScheduledAt || new Date().toISOString(),
      isFloated: false,
      googleCalendarEventId: body.googleCalendarEventId,
      googleTaskId: body.googleTaskId
    };

    db.saveTicket(ticket);
    return reply.status(201).send(ticket);
  });

  // Complete a ticket (Quick Complete or Voice)
  app.post(
    "/api/tickets/:id/complete",
    async (
      req: FastifyRequest<{
        Params: { id: string };
        Body: { method?: CompletionMethod; notes?: string; photoPath?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = req.params;
      const ticket = db.getTicket(id);
      if (!ticket) return reply.status(404).send({ error: "Ticket not found" });

      const completedAt = new Date().toISOString();
      const method = req.body?.method || "Quick_Complete";

      // 1. Record completion audit
      const audit: CompletionRecord = {
        id: `AUDIT-${Date.now()}`,
        ticketId: ticket.id,
        completedAt,
        method,
        photoPath: req.body?.photoPath,
        notes: req.body?.notes,
        actor: "Father"
      };
      db.recordCompletion(audit);

      // 2. Calculate next occurrence
      const nextDate = calculateNextOccurrence(ticket, new Date(completedAt));

      // 3. Update ticket state
      ticket.currentStatus = "Verified";
      ticket.lastCompletedAt = completedAt;
      ticket.nextScheduledAt = nextDate.toISOString();
      ticket.isFloated = false;
      db.saveTicket(ticket);

      return reply.send({ success: true, ticket, audit });
    }
  );

  // Upload photo verification proof
  app.post("/api/tickets/:id/photo", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = req.params;
    const ticket = db.getTicket(id);
    if (!ticket) return reply.status(404).send({ error: "Ticket not found" });

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

    // Record completion as Photo_Verified
    const completedAt = new Date().toISOString();
    const audit: CompletionRecord = {
      id: `AUDIT-${Date.now()}`,
      ticketId: ticket.id,
      completedAt,
      method: "Photo_Verified",
      photoPath: `/photos/${filename}`,
      actor: "Father"
    };
    db.recordCompletion(audit);

    // Calculate next occurrence
    const nextDate = calculateNextOccurrence(ticket, new Date(completedAt));
    ticket.currentStatus = "Verified";
    ticket.lastCompletedAt = completedAt;
    ticket.nextScheduledAt = nextDate.toISOString();
    ticket.isFloated = false;
    db.saveTicket(ticket);

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
}
