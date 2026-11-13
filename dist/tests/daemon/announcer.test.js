import { describe, it, expect } from "vitest";
import { isQuietHours, buildAnnouncementText } from "../../daemon/announcer_client";
describe("Speaker Announcer Rules & Quiet Hours", () => {
    it("enforces quiet hours between 21:30 and 07:00", () => {
        // 22:00 -> Quiet hours
        const d1 = new Date("2026-11-13T22:00:00");
        expect(isQuietHours(d1, 21.5, 7.0)).toBe(true);
        // 06:45 -> Quiet hours
        const d2 = new Date("2026-11-13T06:45:00");
        expect(isQuietHours(d2, 21.5, 7.0)).toBe(true);
        // 14:00 -> Active hours
        const d3 = new Date("2026-11-13T14:00:00");
        expect(isQuietHours(d3, 21.5, 7.0)).toBe(false);
        // 21:15 -> Active hours
        const d4 = new Date("2026-11-13T21:15:00");
        expect(isQuietHours(d4, 21.5, 7.0)).toBe(false);
    });
    it("builds friendly natural language spoken text for deadline reminder", () => {
        const ticket = {
            id: "TICK-301",
            title: "Kitchen Counters & Sink",
            category: "Kitchen",
            priority: "P1-Urgent",
            recurrence: { type: "Daily", baseOnCompletion: false },
            preferredWindow: { startHour: 19, durationMinutes: 60 },
            currentStatus: "Pending",
            nextScheduledAt: "2026-11-13T19:00:00.000Z"
        };
        const text = buildAnnouncementText("deadline_nudge", ticket, 45);
        expect(text).toContain("Friendly reminder");
        expect(text).toContain("Kitchen Counters & Sink");
        expect(text).toContain("45 minutes");
    });
    it("builds morning briefing spoken summary", () => {
        const text = buildAnnouncementText("morning_briefing", undefined, undefined, [
            "Kitchen Trash pickup",
            "HVAC Filter check"
        ]);
        expect(text).toContain("Good morning");
        expect(text).toContain("2 household tasks");
        expect(text).toContain("Kitchen Trash pickup");
    });
});
