import { describe, it, expect, vi } from "vitest";
import {
  formatCalendarEvent,
  formatGoogleTask,
  syncTicketToCalendar,
  syncTicketToTasks,
  pollTaskCompletions
} from "../../src/sync/google";
import { HouseTicket } from "../../src/core/types";

describe("Google API Sync Connector", () => {
  const sampleTicket: HouseTicket = {
    id: "TICK-201",
    title: "Kitchen Trash Pickup",
    category: "Kitchen",
    priority: "P1-Urgent",
    recurrence: { type: "Daily", baseOnCompletion: false },
    preferredWindow: { startHour: 19, durationMinutes: 45 },
    currentStatus: "Pending",
    nextScheduledAt: "2026-11-13T19:00:00.000Z"
  };

  it("formats Google Calendar event correctly with status badge in title", () => {
    const event = formatCalendarEvent(sampleTicket);
    expect(event.summary).toBe("🏠 [HouseOps] Kitchen Trash Pickup");
    expect(event.description).toContain("TICK-201");
    expect(event.description).toContain("Status: Pending");
    expect(event.start?.dateTime).toBe("2026-11-13T19:00:00.000Z");
    expect(event.end?.dateTime).toBe("2026-11-13T19:45:00.000Z");
  });

  it("formats Google Task correctly for voice check-offs", () => {
    const task = formatGoogleTask(sampleTicket);
    expect(task.title).toBe("Kitchen Trash Pickup");
    expect(task.notes).toContain("Ticket: TICK-201");
    expect(task.status).toBe("needsAction");
  });

  it("calls Google Calendar insert/update API properly", async () => {
    const mockCalendar = {
      events: {
        insert: vi.fn().mockResolvedValue({ data: { id: "gcal_event_123" } }),
        update: vi.fn().mockResolvedValue({ data: { id: "gcal_event_123" } })
      }
    };

    const eventId = await syncTicketToCalendar(mockCalendar as any, "primary", sampleTicket);
    expect(eventId).toBe("gcal_event_123");
    expect(mockCalendar.events.insert).toHaveBeenCalledTimes(1);

    // Update existing event
    const existingTicket = { ...sampleTicket, googleCalendarEventId: "gcal_event_123" };
    await syncTicketToCalendar(mockCalendar as any, "primary", existingTicket);
    expect(mockCalendar.events.update).toHaveBeenCalledTimes(1);
  });

  it("polls Google Tasks for completed voice check-offs", async () => {
    const mockTasks = {
      tasks: {
        get: vi.fn().mockImplementation(async ({ task }: { task: string }) => {
          if (task === "task_1") return { data: { id: "task_1", status: "completed" } };
          return { data: { id: "task_2", status: "needsAction" } };
        })
      }
    };

    const completed = await pollTaskCompletions(mockTasks as any, "@default", ["task_1", "task_2"]);
    expect(completed).toEqual(["task_1"]);
  });
});
