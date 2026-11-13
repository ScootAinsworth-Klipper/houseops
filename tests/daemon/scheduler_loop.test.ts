import { describe, it, expect, vi, beforeEach } from "vitest";
import { initDatabase, HouseOpsDatabase } from "../../src/db/database";
import { runDaemonCycle } from "../../src/daemon";

describe("Background Daemon Loop", () => {
  let db: HouseOpsDatabase;

  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  it("floats overdue tickets and handles deadline alert check in daemon cycle", async () => {
    // Insert an overdue ticket
    db.saveTicket({
      id: "TICK-OVERDUE",
      title: "Clean Kitchen Countertops",
      category: "Kitchen",
      priority: "P1-Urgent",
      recurrence: { type: "Daily", baseOnCompletion: true },
      preferredWindow: { startHour: 19, durationMinutes: 30 },
      currentStatus: "Pending",
      nextScheduledAt: "2026-11-12T19:00:00.000Z" // yesterday
    });

    const mockAnnounce = vi.fn().mockResolvedValue(true);
    const now = new Date("2026-11-13T08:00:00.000Z");

    const result = await runDaemonCycle(db, {
      now,
      announcerFn: mockAnnounce
    });

    expect(result.floatedCount).toBe(1);
    const updated = db.getTicket("TICK-OVERDUE");
    expect(updated?.isFloated).toBe(true);
  });
});
