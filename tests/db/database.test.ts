import { describe, it, expect, beforeEach } from "vitest";
import { initDatabase, HouseOpsDatabase } from "../../src/db/database";
import { HouseTicket, CompletionRecord } from "../../src/core/types";

describe("SQLite Persistence & Audit Store", () => {
  let db: HouseOpsDatabase;

  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  it("stores, updates, and retrieves tickets", () => {
    const ticket: HouseTicket = {
      id: "TICK-101",
      title: "Dishwasher",
      category: "Kitchen",
      priority: "P2-Normal",
      recurrence: { type: "Daily", baseOnCompletion: false },
      preferredWindow: { startHour: 20, durationMinutes: 30 },
      currentStatus: "Pending",
      nextScheduledAt: "2026-11-13T20:00:00.000Z"
    };

    db.saveTicket(ticket);
    const tickets = db.getTickets();
    expect(tickets.length).toBe(1);
    expect(tickets[0].id).toBe("TICK-101");
    expect(tickets[0].title).toBe("Dishwasher");
    expect(tickets[0].recurrence.type).toBe("Daily");

    // Update status
    ticket.currentStatus = "Verified";
    db.saveTicket(ticket);
    const updated = db.getTicket("TICK-101");
    expect(updated?.currentStatus).toBe("Verified");
  });

  it("records completion audit entries with photo references and tags", () => {
    db.saveTicket({
      id: "TICK-101",
      title: "Dishwasher",
      category: "Kitchen",
      priority: "P2-Normal",
      recurrence: { type: "Daily", baseOnCompletion: false },
      preferredWindow: { startHour: 20, durationMinutes: 30 },
      currentStatus: "Pending",
      nextScheduledAt: "2026-11-13T20:00:00.000Z"
    });

    const record: CompletionRecord = {
      id: "AUDIT-1",
      ticketId: "TICK-101",
      completedAt: "2026-11-13T20:30:00.000Z",
      method: "Photo_Verified",
      photoPath: "/var/houseops/photos/dish_1.jpg",
      notes: "Loaded and running",
      actor: "Father"
    };

    db.recordCompletion(record);
    const history = db.getAuditLog("TICK-101");
    expect(history.length).toBe(1);
    expect(history[0].id).toBe("AUDIT-1");
    expect(history[0].method).toBe("Photo_Verified");
    expect(history[0].photoPath).toBe("/var/houseops/photos/dish_1.jpg");
  });

  it("persists key-value settings", () => {
    db.setSetting("google_calendar_id", "family_chores@group.calendar.google.com");
    expect(db.getSetting("google_calendar_id")).toBe("family_chores@group.calendar.google.com");
    expect(db.getSetting("nonexistent", "default_val")).toBe("default_val");
  });

  it("manages offline sync queue entries", () => {
    db.queueSync("sync_calendar", "TICK-101", { title: "Dishes" });
    const pending = db.getPendingSyncs();
    expect(pending.length).toBe(1);
    expect(pending[0].action).toBe("sync_calendar");
    expect(pending[0].ticket_id).toBe("TICK-101");
    expect(pending[0].payload.title).toBe("Dishes");

    db.removeSync(pending[0].id);
    expect(db.getPendingSyncs().length).toBe(0);
  });
});
