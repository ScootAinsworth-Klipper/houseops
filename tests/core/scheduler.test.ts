import { describe, it, expect } from "vitest";
import { calculateNextOccurrence, evaluateFloatingTickets, HOUSEHOLD_TIMEZONE } from "../../src/core/scheduler";
import { HouseTicket } from "../../src/core/types";

describe("HouseOps Scheduler", () => {
  it("calculates completion-based recurrence correctly for interval days", () => {
    const ticket: HouseTicket = {
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
    const ticket: HouseTicket = {
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
    const ticket: HouseTicket = {
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
    const ticket: HouseTicket = {
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

  it("calculates weekday recurrence skipping weekends properly (e.g. dog feeding)", () => {
    const ticket: HouseTicket = {
      id: "TICK-DOG-AM",
      title: "Feed Dogs (Morning)",
      category: "General",
      priority: "P1-Urgent",
      assignee: "Son",
      recurrence: { type: "Weekdays", baseOnCompletion: true },
      preferredWindow: { startHour: 6, startMinute: 15, durationMinutes: 45 },
      currentStatus: "Pending",
      nextScheduledAt: "2026-11-13T06:15:00.000Z" // Friday morning
    };

    // Completed on Friday at 6:30 AM
    const completedFriday = new Date("2026-11-13T06:30:00.000Z"); // Friday
    const next = calculateNextOccurrence(ticket, completedFriday);

    // Next must be Monday Nov 16 at 06:15
    expect(next.getUTCDay()).toBe(1); // Monday
    expect(next.toISOString().startsWith("2026-11-16")).toBe(true);
    expect(next.getUTCHours()).toBe(6);
    expect(next.getUTCMinutes()).toBe(15);
  });

  it("handles OnDemand tasks correctly without advancing days or auto-floating", () => {
    const onDemandTicket: HouseTicket = {
      id: "TICK-ONDEMAND-DOGS",
      title: "Take Dogs Out",
      category: "General",
      priority: "P2-Normal",
      assignee: "Son",
      recurrence: { type: "OnDemand", baseOnCompletion: true },
      preferredWindow: { startHour: 0, startMinute: 0, durationMinutes: 60 },
      currentStatus: "Pending",
      nextScheduledAt: "2026-11-13T12:00:00.000Z"
    };

    const completed = new Date("2026-11-13T14:30:00.000Z");
    const next = calculateNextOccurrence(onDemandTicket, completed);
    expect(next.toISOString()).toBe(completed.toISOString());

    // Should never auto-float
    const now = new Date("2026-11-13T23:59:00.000Z");
    const result = evaluateFloatingTickets([onDemandTicket], now);
    expect(result.floated).toHaveLength(0);
    expect(result.updated).toHaveLength(0);
  });

  it("anchors preferredWindow hour/minute in America/Chicago (not UTC) across CST/CDT", () => {
    const laundry: HouseTicket = {
      id: "TICK-LAUNDRY",
      title: "Start a load of laundry",
      category: "Laundry",
      priority: "P1-Urgent",
      recurrence: { type: "Daily", baseOnCompletion: false },
      preferredWindow: { startHour: 12, startMinute: 15, durationMinutes: 60 },
      currentStatus: "Pending",
      // Yesterday Nov 15 12:15 PM CST = 18:15 UTC
      nextScheduledAt: "2026-11-15T18:15:00.000Z"
    };

    // At 6:15 AM CST (12:15Z) on Nov 16, it IS past yesterday's window -> should float to 12:15 PM CST TODAY (18:15Z), NOT 6:15 AM CST!
    const earlyMorningCst = new Date("2026-11-16T12:15:00.000Z");
    const floated = evaluateFloatingTickets([laundry], earlyMorningCst, HOUSEHOLD_TIMEZONE);
    expect(floated.floated).toEqual(["TICK-LAUNDRY"]);
    expect(floated.updated[0].nextScheduledAt).toBe("2026-11-16T18:15:00.000Z");

    // If already scheduled for today 12:15 PM CST (18:15Z), 6:15 AM CST must NOT float it
    const todayTicket: HouseTicket = {
      ...laundry,
      nextScheduledAt: "2026-11-16T18:15:00.000Z"
    };
    const notDueYet = evaluateFloatingTickets([todayTicket], earlyMorningCst, HOUSEHOLD_TIMEZONE);
    expect(notDueYet.floated).toHaveLength(0);

    // Completing at 12:30 PM CST (18:30Z) schedules tomorrow 12:15 PM CST (18:15Z)
    const nextCst = calculateNextOccurrence(laundry, new Date("2026-11-16T18:30:00.000Z"), HOUSEHOLD_TIMEZONE);
    expect(nextCst.toISOString()).toBe("2026-11-17T18:15:00.000Z");

    // In summer CDT (UTC-5, e.g., July 10), 12:15 PM CDT = 17:15 UTC
    const nextCdt = calculateNextOccurrence(laundry, new Date("2026-07-10T17:30:00.000Z"), HOUSEHOLD_TIMEZONE);
    expect(nextCdt.toISOString()).toBe("2026-07-11T17:15:00.000Z");
  });
});
