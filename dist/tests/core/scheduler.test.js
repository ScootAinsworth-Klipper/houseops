import { describe, it, expect } from "vitest";
import { calculateNextOccurrence, evaluateFloatingTickets } from "../../src/core/scheduler";
describe("HouseOps Scheduler", () => {
    it("calculates completion-based recurrence correctly for interval days", () => {
        const ticket = {
            id: "TICK-1",
            title: "HVAC Filter",
            category: "HVAC",
            priority: "P2-Normal",
            recurrence: { type: "IntervalDays", intervalDays: 60, baseOnCompletion: true },
            preferredWindow: { startHour: 19, durationMinutes: 30 },
            currentStatus: "Pending",
            nextScheduledAt: "2026-11-01T19:00:00.000Z"
        };
        const completedAt = new Date("2026-11-13T20:15:00.000Z");
        const next = calculateNextOccurrence(ticket, completedAt);
        // 60 days after Nov 13, 2026 is Jan 12, 2027
        expect(next.toISOString().startsWith("2027-01-12")).toBe(true);
        expect(next.getUTCHours()).toBe(19);
    });
    it("calculates daily recurrence correctly based on completion", () => {
        const ticket = {
            id: "TICK-DAILY",
            title: "Wipe Kitchen Counters",
            category: "Kitchen",
            priority: "P2-Normal",
            recurrence: { type: "Daily", baseOnCompletion: true },
            preferredWindow: { startHour: 20, durationMinutes: 30 },
            currentStatus: "Pending",
            nextScheduledAt: "2026-11-13T20:00:00.000Z"
        };
        const completedAt = new Date("2026-11-13T21:00:00.000Z");
        const next = calculateNextOccurrence(ticket, completedAt);
        expect(next.toISOString().startsWith("2026-11-14")).toBe(true);
        expect(next.getUTCHours()).toBe(20);
    });
    it("floats overdue pending chores to next window without creating duplicates", () => {
        const ticket = {
            id: "TICK-2",
            title: "Kitchen Trash",
            category: "Kitchen",
            priority: "P1-Urgent",
            recurrence: { type: "Daily", baseOnCompletion: false },
            preferredWindow: { startHour: 19, durationMinutes: 60 },
            currentStatus: "Pending",
            nextScheduledAt: "2026-11-12T19:00:00.000Z" // yesterday
        };
        const now = new Date("2026-11-13T08:00:00.000Z");
        const result = evaluateFloatingTickets([ticket], now);
        expect(result.floated).toContain("TICK-2");
        expect(result.updated.length).toBe(1);
        expect(new Date(result.updated[0].nextScheduledAt).getUTCDate()).toBe(13);
        expect(result.updated[0].isFloated).toBe(true);
    });
    it("does not float chores that are not yet overdue", () => {
        const ticket = {
            id: "TICK-3",
            title: "Evening Dishes",
            category: "Kitchen",
            priority: "P2-Normal",
            recurrence: { type: "Daily", baseOnCompletion: false },
            preferredWindow: { startHour: 20, durationMinutes: 60 },
            currentStatus: "Pending",
            nextScheduledAt: "2026-11-13T20:00:00.000Z" // tonight at 8pm
        };
        const now = new Date("2026-11-13T12:00:00.000Z"); // noon
        const result = evaluateFloatingTickets([ticket], now);
        expect(result.floated.length).toBe(0);
        expect(result.updated.length).toBe(0);
    });
});
