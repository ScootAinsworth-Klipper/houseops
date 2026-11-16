import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanKeepMediaTitle, pollGoogleKeepDownloads } from "../../src/core/keep_relay.js";
import { initDatabase, HouseOpsDatabase } from "../../src/db/database.js";
import { runDaemonCycle } from "../../src/daemon.js";

describe("Google Keep Downloads Relay", () => {
  it("normalizes Keep list items cleanly", () => {
    expect(cleanKeepMediaTitle("Gladiator 2")).toBe("Gladiator 2");
    expect(cleanKeepMediaTitle("download Inception")).toBe("Inception");
    expect(cleanKeepMediaTitle("grab Severance S02E05")).toBe("Severance S02E05");
    expect(cleanKeepMediaTitle("torrent Dune Part Two")).toBe("Dune Part Two");
    expect(cleanKeepMediaTitle("   ")).toBeNull();
    expect(cleanKeepMediaTitle("")).toBeNull();
  });

  it("skips runner when credentials are missing and cleans returned items", async () => {
    const runner = vi.fn().mockResolvedValue({
      ok: true,
      items: ["Gladiator 2", "download Inception", "  "],
    });

    expect(
      await pollGoogleKeepDownloads({ email: "", masterToken: "aas_et/x" }, runner)
    ).toEqual([]);
    expect(runner).not.toHaveBeenCalled();

    const queries = await pollGoogleKeepDownloads(
      { email: "user@gmail.com", masterToken: "aas_et/x", listTitle: "Downloads" },
      runner
    );
    expect(runner).toHaveBeenCalledTimes(1);
    expect(queries).toEqual(["Gladiator 2", "Inception"]);
  });

  describe("Daemon Cycle Integration", () => {
    let db: HouseOpsDatabase;

    beforeEach(() => {
      db = initDatabase(":memory:");
    });

    it("polls Google Keep Downloads list, dispatches to TorrentRelay, and announces", async () => {
      db.setSetting("google_keep_email", "scoot@gmail.com");
      db.setSetting("google_keep_master_token", "aas_et/test");
      db.setSetting("google_keep_list_title", "Downloads");
      db.setSetting("media_relay_url", "http://192.168.1.199:8090");
      db.setSetting("media_relay_key", "secret123");

      const mockKeepRunner = vi.fn().mockResolvedValue({
        ok: true,
        items: ["Gladiator 2"],
      });

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ ok: true, spokenMessage: "Starting 2160p download for Gladiator 2." }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch as any;
      const mockAnnounce = vi.fn().mockResolvedValue(true);

      try {
        await runDaemonCycle(db, {
          announcerFn: mockAnnounce,
          keepRunner: mockKeepRunner,
        });

        expect(mockKeepRunner).toHaveBeenCalledWith(
          expect.objectContaining({
            email: "scoot@gmail.com",
            masterToken: "aas_et/test",
            listTitle: "Downloads",
          })
        );
        expect(mockFetch).toHaveBeenCalledWith(
          "http://192.168.1.199:8090/api/voice-download",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({ query: "Gladiator 2" }),
          })
        );
        expect(mockAnnounce).toHaveBeenCalledWith("Starting 2160p download for Gladiator 2.");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("does not poll Google Keep if credentials or media_relay_url are absent", async () => {
      db.setSetting("google_keep_email", "scoot@gmail.com");
      const mockKeepRunner = vi.fn();
      const mockAnnounce = vi.fn();

      await runDaemonCycle(db, {
        announcerFn: mockAnnounce,
        keepRunner: mockKeepRunner,
      });

      expect(mockKeepRunner).not.toHaveBeenCalled();
      expect(mockAnnounce).not.toHaveBeenCalled();
    });
  });
});
