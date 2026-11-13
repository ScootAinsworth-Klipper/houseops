import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildServer } from "../../src/server";

describe("HouseOps REST API & Verification Endpoints", () => {
  let app: any;

  beforeAll(async () => {
    app = await buildServer({ dbPath: ":memory:", photoDir: "test_photos" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("handles ticket lifecycle via REST API", async () => {
    // 1. Create a ticket
    const createRes = await app.inject({
      method: "POST",
      url: "/api/tickets",
      payload: {
        id: "TICK-TEST-1",
        title: "Clean Kitchen Stovetop",
        category: "Kitchen",
        priority: "P2-Normal",
        recurrence: { type: "Daily", baseOnCompletion: true },
        preferredWindow: { startHour: 20, durationMinutes: 30 },
        nextScheduledAt: "2026-11-13T20:00:00.000Z"
      }
    });
    expect(createRes.statusCode).toBe(201);

    // 2. List tickets
    const listRes = await app.inject({ method: "GET", url: "/api/tickets" });
    expect(listRes.statusCode).toBe(200);
    const tickets = JSON.parse(listRes.body);
    expect(tickets.length).toBe(1);
    expect(tickets[0].id).toBe("TICK-TEST-1");

    // 3. Complete ticket without photo (Quick Complete)
    const completeRes = await app.inject({
      method: "POST",
      url: "/api/tickets/TICK-TEST-1/complete",
      payload: {
        method: "Quick_Complete",
        notes: "Done after dinner"
      }
    });
    expect(completeRes.statusCode).toBe(200);
    const compBody = JSON.parse(completeRes.body);
    expect(compBody.ticket.currentStatus).toBe("Verified");

    // 4. Check audit log
    const auditRes = await app.inject({ method: "GET", url: "/api/audit" });
    expect(auditRes.statusCode).toBe(200);
    const audits = JSON.parse(auditRes.body);
    expect(audits.length).toBe(1);
    expect(audits[0].ticketId).toBe("TICK-TEST-1");
  });
});
