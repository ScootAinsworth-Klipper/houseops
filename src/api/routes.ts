import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import path from "path";
import fs from "fs";
import crypto from "crypto";
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

      // Idempotency guard: if already verified, return without double-counting
      if (ticket.currentStatus === "Verified") {
        return reply.send({ success: true, ticket, alreadyCompleted: true });
      }

      const completedAt = new Date().toISOString();
      const method = req.body?.method || "Quick_Complete";

      // 1. Prepare completion audit with UUID
      const audit: CompletionRecord = {
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
    }
  );

  // Upload photo verification proof
  app.post("/api/tickets/:id/photo", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = req.params;
    const ticket = db.getTicket(id);
    if (!ticket) return reply.status(404).send({ error: "Ticket not found" });

    // Idempotency guard
    if (ticket.currentStatus === "Verified") {
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
    const audit: CompletionRecord = {
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
  app.get("/api/audit", async (req: FastifyRequest<{ Querystring: { ticketId?: string } }>, reply) => {
    const audits = db.getAuditLog(req.query.ticketId);
    return reply.send(audits);
  });
}
