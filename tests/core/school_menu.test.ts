import { describe, it, expect, beforeEach } from "vitest";
import { HouseOpsDatabase } from "../../src/db/database.js";
import {
  ensureInitialSchoolMenus,
  parseMenuVoiceQuery,
  buildMenuSpeech
} from "../../src/core/school_menu.js";

describe("School Menu Engine", () => {
  let db: HouseOpsDatabase;

  beforeEach(() => {
    db = new HouseOpsDatabase(":memory:");
    ensureInitialSchoolMenus(db);
  });

  it("seeds November 2026 Livingston Parish menus cleanly", () => {
    const menus = db.getSchoolMenus("2026-11");
    expect(menus.length).toBeGreaterThanOrEqual(21);
    const nov17 = db.getSchoolMenu("2026-11-17");
    expect(nov17?.lunch).toContain("Orange Chicken");
    expect(nov17?.breakfastTraditional).toContain("Ham & Swiss Croissant");
  });

  it("parses menu voice queries without matching unrelated chores", () => {
    expect(parseMenuVoiceQuery("What's for lunch?")).toEqual({ meal: "lunch", target: "auto" });
    expect(parseMenuVoiceQuery("What is for breakfast tomorrow")).toEqual({ meal: "breakfast", target: "tomorrow" });
    expect(parseMenuVoiceQuery("school menu check")).toEqual({ meal: "all", target: "auto" });
    expect(parseMenuVoiceQuery("Sawyer cleaned up the living room")).toBeNull();
    expect(parseMenuVoiceQuery("Camden fed the dogs")).toBeNull();
  });

  it("formats morning lunch+breakfast speech, afternoon rollover, and Thanksgiving holiday", () => {
    // 7:15 AM CST on Tuesday Nov 17, 2026 = 13:15 UTC
    const tueMorning = new Date("2026-11-17T13:15:00Z");
    const morningSpeech = buildMenuSpeech(db, { meal: "lunch", now: tueMorning });
    expect(morningSpeech.message).toContain("Good morning Sawyer!");
    expect(morningSpeech.message).toContain("Orange Chicken");
    expect(morningSpeech.message).toContain("Ham & Swiss Croissant");

    // 4:00 PM CST on Friday Nov 13, 2026 = 22:00 UTC -> rolls forward to Monday Nov 16
    const friEvening = new Date("2026-11-13T22:00:00Z");
    const nextSpeech = buildMenuSpeech(db, { meal: "lunch", now: friEvening });
    expect(nextSpeech.message).toContain("Monday, November 16");
    expect(nextSpeech.message).toContain("Chicken Strips");
    expect(nextSpeech.message).not.toContain("*");

    // Thanksgiving Break morning Nov 24, 2026 -> explains break + gives Monday Nov 30
    const breakMorning = new Date("2026-11-24T13:30:00Z");
    const breakSpeech = buildMenuSpeech(db, { meal: "lunch", now: breakMorning });
    expect(breakSpeech.message).toContain("Thanksgiving Break");
    expect(breakSpeech.message).toContain("November 30");
    expect(breakSpeech.message).toContain("Red Beans & Rice");
  });
});
