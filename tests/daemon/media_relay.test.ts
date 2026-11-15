import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseMediaVoiceQuery, dispatchMediaVoiceDownload } from "../../src/core/media_relay.js";
import { initDatabase, HouseOpsDatabase } from "../../src/db/database.js";
import { runDaemonCycle } from "../../src/daemon.js";
import * as googleSync from "../../src/sync/google.js";

describe("HouseOps Media Voice Relay", () => {
  it("parses explicit download/grab/torrent prefixes and ignores normal chores", () => {
    expect(parseMediaVoiceQuery("download Inception")).toBe("Inception");
    expect(parseMediaVoiceQuery("Hey Google grab Severance S02E05")).toBe("Severance S02E05");
    expect(parseMediaVoiceQuery("clean download folder")).toBeNull();
    expect(parseMediaVoiceQuery("buy milk")).toBeNull();
    expect(parseMediaVoiceQuery("torrent Dune Part Two")).toBe("Dune Part Two");
    expect(parseMediaVoiceQuery("Hey Google, download Avatar: The Way of Water")).toBe("Avatar: The Way of Water");
    expect(parseMediaVoiceQuery("download")).toBeNull();
    expect(parseMediaVoiceQuery("")).toBeNull();
  });

  it("forwards query with X-Relay-Key and returns friendly offline message on error", async () => {
    const okFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, spokenMessage: "Starting 2160p download for Inception." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const msg = await dispatchMediaVoiceDownload(
      "Inception",
      { url: "http://192.168.1.50:8090", apiKey: "k1" },
      okFetch as any
    );
    expect(msg).toBe("Starting 2160p download for Inception.");
    expect(okFetch).toHaveBeenCalledWith(
      "http://192.168.1.50:8090/api/voice-download",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Relay-Key": "k1",
        }),
        body: JSON.stringify({ query: "Inception" }),
      })
    );

    const downFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const offlineMsg = await dispatchMediaVoiceDownload(
      "Inception",
      { url: "http://192.168.1.50:8090", apiKey: "k1" },
      downFetch as any
    );
    expect(offlineMsg).toContain("offline");
  });

  describe("Daemon Cycle Integration", () => {
    let db: HouseOpsDatabase;

    beforeEach(() => {
      db = initDatabase(":memory:");
      db.setSetting("google_webapp_url", "https://script.google.com/test");
    });

    it("intercepts voice download task, deletes task from Google, and announces result", async () => {
      db.setSetting("media_relay_url", "http://192.168.1.50:8090");
      db.setSetting("media_relay_key", "secret123");

      const mockDelete = vi.fn().mockResolvedValue({});
      const mockGClient = {
        tasks: {
          list: vi.fn().mockResolvedValue({
            data: {
              items: [
                {
                  id: "gtask-media-1",
                  title: "download Gladiator II",
                  status: "needsAction",
                  notes: "",
                },
              ],
            },
          }),
          delete: mockDelete,
          insert: vi.fn(),
          update: vi.fn(),
        },
      };

      vi.spyOn(googleSync, "createGoogleTasksClient").mockReturnValue(mockGClient as any);

      // Mock fetch globally or pass fetch mock if possible
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ ok: true, spokenMessage: "Starting 1080p download for Gladiator II." }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch as any;

      const mockAnnounce = vi.fn().mockResolvedValue(true);

      try {
        await runDaemonCycle(db, { announcerFn: mockAnnounce });

        expect(mockDelete).toHaveBeenCalledWith({
          tasklist: "@default",
          task: "gtask-media-1",
        });
        expect(mockAnnounce).toHaveBeenCalledWith("Starting 1080p download for Gladiator II.");
      } finally {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
      }
    });

    it("leaves download task untouched when media_relay_url is not configured", async () => {
      // media_relay_url not set
      const mockDelete = vi.fn().mockResolvedValue({});
      const mockGClient = {
        tasks: {
          list: vi.fn().mockResolvedValue({
            data: {
              items: [
                {
                  id: "gtask-media-2",
                  title: "download Gladiator II",
                  status: "needsAction",
                  notes: "",
                },
              ],
            },
          }),
          delete: mockDelete,
          insert: vi.fn(),
          update: vi.fn(),
        },
      };

      vi.spyOn(googleSync, "createGoogleTasksClient").mockReturnValue(mockGClient as any);
      const mockAnnounce = vi.fn().mockResolvedValue(true);

      try {
        await runDaemonCycle(db, { announcerFn: mockAnnounce });

        expect(mockDelete).not.toHaveBeenCalled();
        expect(mockAnnounce).not.toHaveBeenCalled();
      } finally {
        vi.restoreAllMocks();
      }
    });
  });
});
