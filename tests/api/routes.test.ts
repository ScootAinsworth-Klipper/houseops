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
    const firstNextSchedule = compBody.ticket.nextScheduledAt;

    // Concurrent/duplicate completion attempt must be idempotent
    const duplicateCompleteRes = await app.inject({
      method: "POST",
      url: "/api/tickets/TICK-TEST-1/complete",
      payload: {
        method: "Quick_Complete",
        notes: "Accidental second click"
      }
    });
    expect(duplicateCompleteRes.statusCode).toBe(200);
    const dupBody = JSON.parse(duplicateCompleteRes.body);
    expect(dupBody.alreadyCompleted).toBe(true);
    expect(dupBody.ticket.nextScheduledAt).toBe(firstNextSchedule);

    // 4. Check audit log (must only have 1 entry)
    const auditRes = await app.inject({ method: "GET", url: "/api/audit" });
    expect(auditRes.statusCode).toBe(200);
    const audits = JSON.parse(auditRes.body);
    expect(audits.length).toBe(1);
    expect(audits[0].ticketId).toBe("TICK-TEST-1");
  });

  it("creates and triggers On-Demand task via voice/webhook endpoint", async () => {
    // 1. Create an on-demand task
    const createRes = await app.inject({
      method: "POST",
      url: "/api/tickets",
      payload: {
        id: "TICK-DOGS-ONDEMAND",
        title: "Take Dogs Out",
        category: "General",
        assignee: "Son",
        priority: "P2-Normal",
        recurrence: { type: "OnDemand", baseOnCompletion: true },
        preferredWindow: { startHour: 0, startMinute: 0, durationMinutes: 60 },
        broadcast: {
          speakers: ["All Rooms"],
          customMessage: "Attention Camden: Time to take the dogs out!"
        },
        nextScheduledAt: new Date().toISOString()
      }
    });
    expect(createRes.statusCode).toBe(201);

    // 2. Trigger task via /api/trigger/:query (case-insensitive substring match)
    const triggerRes = await app.inject({
      method: "POST",
      url: "/api/trigger/take%20dogs"
    });
    expect(triggerRes.statusCode).toBe(200);
    const trigData = JSON.parse(triggerRes.body);
    expect(trigData.ticket.id).toBe("TICK-DOGS-ONDEMAND");
    expect(trigData.message).toBe("Attention Camden: Time to take the dogs out!");
    expect(trigData.speakers).toContain("All Rooms");

    // 3. Complete the on-demand task
    const compRes = await app.inject({
      method: "POST",
      url: "/api/tickets/TICK-DOGS-ONDEMAND/complete",
      payload: { method: "Quick_Complete" }
    });
    expect(compRes.statusCode).toBe(200);

    // 4. Trigger via GET (for simple webhooks / Google Home URLs)
    const getTrigRes = await app.inject({
      method: "GET",
      url: "/api/trigger/dogs"
    });
    expect(getTrigRes.statusCode).toBe(200);
    const getTrigData = JSON.parse(getTrigRes.body);
    expect(getTrigData.ticket.currentStatus).toBe("Pending");

    // 5. Complete via voice assistant endpoint /api/done/:query
    const voiceDoneRes = await app.inject({
      method: "GET",
      url: "/api/done/dogs"
    });
    expect(voiceDoneRes.statusCode).toBe(200);
    const voiceDoneData = JSON.parse(voiceDoneRes.body);
    expect(voiceDoneData.ticket.currentStatus).toBe("Verified");
    expect(voiceDoneData.audit.method).toBe("Voice_Closed");
    expect(voiceDoneData.message).toContain("Awesome!");
  });
});
