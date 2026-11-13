# HouseOps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete HouseOps household ticketing engine: Raspberry Pi 24/7 background daemon, local SQLite audit/photo store, Google Calendar & Tasks sync engine, local Nest speaker broadcast engine (`pychromecast`), and multi-device AMOLED client for S26 Ultra and Tab S8 Ultra.

**Architecture:** Node.js/TypeScript backend service running on the Raspberry Pi 3B (with a companion Python Cast service for local Google Cast audio streaming). The service maintains a local SQLite database for tickets and photo proof binaries, syncs bi-directionally with Google Calendar (for visual time blocks) and Google Tasks (for Assistant voice check-offs), and serves a fast, responsive AMOLED web application/PWA.

**Tech Stack:** Node.js (TypeScript, Fastify, Better-SQLite3), Python 3 (`pychromecast`, `gTTS` for local speaker broadcasts), Google APIs (Calendar v3, Tasks v1), Vanilla JS / Tailwind CSS for the responsive PWA client.

**Spec:** `C:\Gemini\HouseOps\docs\superpowers\specs\2026-11-13-houseops-design.md`

## Global Constraints

- **Platform Target**: Raspberry Pi 3B (ARMv7/ARM64 Linux) as host daemon; Android (Chrome PWA / WebView) on S26 Ultra and Tab S8 Ultra as clients.
- **Theme Standard**: True Black AMOLED mode (`#000000` base) matching Klipperraker Pro styling.
- **Zero Duplicate Chores**: Overdue/slipped chores must float forward in place; never spawn duplicate tickets for the same recurring chore.
- **Completion-Based Recurrence**: Cadence clock must reset from actual completion timestamp when `baseOnCompletion: true`.
- **Quiet Hours**: Speaker audio broadcasts must be suppressed between 21:30 and 07:00 local time.

## Review Focus

1. **Network Disconnection / Google API Offline**: When Internet drops, local UI and SQLite tickets must function fully offline, queuing Google sync updates until reconnected.
2. **Nest Speaker Unavailable**: If a Google Cast speaker is powered off or unreachable via mDNS, the cast engine must log a warning and fail gracefully without crashing or stalling the scheduler.
3. **Large Photo Uploads**: Direct camera captures on 200MP phone cameras (S26 Ultra) must be resized client-side before upload to prevent Pi memory exhaustion.
4. **Concurrent Voice Check-off & UI Click**: If a ticket is completed via voice at the same moment the UI opens, the status change must resolve cleanly without duplicate audit entries.
5. **Late-Night Task Slipped**: When a task scheduled at 20:00 slips past quiet hours (21:30), the floating engine must shift it to tomorrow's designated window without triggering nighttime speaker broadcasts.

---

### Task 1: Core Domain Engine & Floating Algorithm

**Files:**
- Create: `src/core/types.ts`
- Create: `src/core/scheduler.ts`
- Test: `tests/core/scheduler.test.ts`

**Interfaces:**
- Produces: `calculateNextOccurrence(ticket: HouseTicket, completedAt: Date): Date`
- Produces: `evaluateFloatingTickets(tickets: HouseTicket[], now: Date): { updated: HouseTicket[], floated: string[] }`

- [ ] **Step 1: Write failing test for recurrence and floating logic**

```typescript
// tests/core/scheduler.test.ts
import { describe, it, expect } from "vitest";
import { calculateNextOccurrence, evaluateFloatingTickets } from "../../src/core/scheduler";
import { HouseTicket } from "../../src/core/types";

describe("HouseOps Scheduler", () => {
  it("calculates completion-based recurrence correctly", () => {
    const ticket: HouseTicket = {
      id: "TICK-1",
      title: "HVAC Filter",
      category: "HVAC",
      priority: "P2-Normal",
      recurrence: { type: "IntervalDays", intervalDays: 60, baseOnCompletion: true },
      preferredWindow: { startHour: 19, durationMinutes: 30 },
      currentStatus: "Pending",
      nextScheduledAt: "2026-11-01T19:00:00Z"
    };
    const completedAt = new Date("2026-11-13T20:15:00Z");
    const next = calculateNextOccurrence(ticket, completedAt);
    expect(next.toISOString()).toBe("2027-01-12T19:00:00.000Z");
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
      nextScheduledAt: "2026-11-12T19:00:00Z" // yesterday
    };
    const now = new Date("2026-11-13T08:00:00Z");
    const result = evaluateFloatingTickets([ticket], now);
    expect(result.floated).toContain("TICK-2");
    expect(new Date(result.updated[0].nextScheduledAt).getDate()).toBe(13);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/scheduler.test.ts`  
Expected: FAIL with missing module/functions

- [ ] **Step 3: Implement domain types & scheduling logic in `src/core/scheduler.ts`**

Define `HouseTicket` in `src/core/types.ts` matching the spec. Implement `calculateNextOccurrence` and `evaluateFloatingTickets` in `src/core/scheduler.ts` ensuring single-instance in-place floating.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/scheduler.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/ types.ts src/core/scheduler.ts tests/core/scheduler.test.ts
git commit -m "feat(core): implement ticket models, completion recurrence, and floating engine"
```

---

### Task 2: SQLite Persistence Layer & Photo Store

**Files:**
- Create: `src/db/database.ts`
- Create: `src/db/schema.sql`
- Test: `tests/db/database.test.ts`

**Interfaces:**
- Consumes: `HouseTicket`, `CompletionRecord` from `src/core/types.ts`
- Produces: `initDatabase(dbPath: string): DatabaseInstance`
- Produces: `saveTicket(ticket: HouseTicket): void`
- Produces: `getTickets(): HouseTicket[]`
- Produces: `recordCompletion(record: CompletionRecord): void`

- [ ] **Step 1: Write failing test for database persistence and audit log**

```typescript
// tests/db/database.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { initDatabase } from "../../src/db/database";

describe("Database Storage", () => {
  let db: any;
  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  it("stores and retrieves tickets and completion records", () => {
    db.saveTicket({
      id: "TICK-101",
      title: "Dishwasher",
      category: "Kitchen",
      priority: "P2-Normal",
      recurrence: { type: "Daily", baseOnCompletion: false },
      preferredWindow: { startHour: 20, durationMinutes: 30 },
      currentStatus: "Pending",
      nextScheduledAt: "2026-11-13T20:00:00Z"
    });
    const tickets = db.getTickets();
    expect(tickets.length).toBe(1);
    expect(tickets[0].id).toBe("TICK-101");

    db.recordCompletion({
      id: "AUDIT-1",
      ticketId: "TICK-101",
      completedAt: "2026-11-13T20:30:00Z",
      method: "Voice_Closed",
      actor: "Father"
    });
    const history = db.getAuditLog("TICK-101");
    expect(history.length).toBe(1);
    expect(history[0].method).toBe("Voice_Closed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db/database.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement SQLite persistence with better-sqlite3 in `src/db/database.ts`**

Create `schema.sql` for tables `tickets`, `completion_records`, and `settings`. Implement CRUD and transaction methods in `src/db/database.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/db/database.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/db/ tests/db/
git commit -m "feat(db): add SQLite persistence and audit log store"
```

---

### Task 3: Google Calendar & Tasks Two-Way Sync Connector

**Files:**
- Create: `src/sync/google.ts`
- Test: `tests/sync/google.test.ts`

**Interfaces:**
- Consumes: `HouseTicket` from `src/core/types.ts`
- Produces: `syncTicketToCalendar(auth: any, ticket: HouseTicket): Promise<string>`
- Produces: `syncTicketToTasks(auth: any, ticket: HouseTicket): Promise<string>`
- Produces: `pollTaskCompletions(auth: any, taskIds: string[]): Promise<string[]>`

- [ ] **Step 1: Write failing test for Google Sync Connector with mocked Google API**

```typescript
// tests/sync/google.test.ts
import { describe, it, expect, vi } from "vitest";
import { syncTicketToCalendar, pollTaskCompletions } from "../../src/sync/google";

describe("Google API Sync Connector", () => {
  it("formats and pushes calendar time blocks with status prefix", async () => {
    const mockCalendar = { events: { insert: vi.fn().mockResolvedValue({ data: { id: "gcal_123" } }) } };
    const eventId = await syncTicketToCalendar(mockCalendar as any, {
      id: "TICK-1",
      title: "Mop Floors",
      category: "General",
      priority: "P2-Normal",
      recurrence: { type: "Weekly", baseOnCompletion: false },
      preferredWindow: { startHour: 18, durationMinutes: 45 },
      currentStatus: "Pending",
      nextScheduledAt: "2026-11-13T18:00:00Z"
    });
    expect(eventId).toBe("gcal_123");
    expect(mockCalendar.events.insert).toHaveBeenCalledWith(expect.objectContaining({
      requestBody: expect.objectContaining({ summary: "🏠 [HouseOps] Mop Floors" })
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sync/google.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement Google Calendar & Tasks integration in `src/sync/google.ts`**

Implement `syncTicketToCalendar`, `syncTicketToTasks`, and `pollTaskCompletions` using `@googleapis/calendar` and `@googleapis/tasks` with OAuth token refresh support.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sync/google.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sync/ tests/sync/
git commit -m "feat(sync): implement Google Calendar time-blocking and Google Tasks voice bridge"
```

---

### Task 4: Raspberry Pi Local Nest Speaker Broadcast Engine

**Files:**
- Create: `daemon/cast_announcer.py`
- Create: `daemon/announcer_client.ts`
- Test: `tests/daemon/announcer.test.ts`

**Interfaces:**
- Produces: `broadcastAnnouncement(message: string, speakerGroup?: string): Promise<boolean>`
- Produces: `isQuietHours(now: Date): boolean`

- [ ] **Step 1: Write failing test for announcer client and quiet-hours enforcement**

```typescript
// tests/daemon/announcer.test.ts
import { describe, it, expect } from "vitest";
import { isQuietHours } from "../../daemon/announcer_client";

describe("Speaker Announcer Rules", () => {
  it("enforces quiet hours between 21:30 and 07:00", () => {
    expect(isQuietHours(new Date("2026-11-13T22:00:00"))).toBe(true);
    expect(isQuietHours(new Date("2026-11-13T06:30:00"))).toBe(true);
    expect(isQuietHours(new Date("2026-11-13T14:00:00"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/daemon/announcer.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement Python `cast_announcer.py` using `pychromecast` and TypeScript client wrapper**

Write `daemon/cast_announcer.py` using `pychromecast` to discover Google Nest devices, generate speech via `gTTS`, and stream the MP3 via local HTTP to the Cast device. Implement `daemon/announcer_client.ts` to call the announcer script with quiet-hours suppression.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/daemon/announcer.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add daemon/ tests/daemon/
git commit -m "feat(announcer): add pychromecast local TTS speaker broadcast engine"
```

---

### Task 5: Fastify Daemon Engine & REST/Photo API

**Files:**
- Create: `src/server.ts`
- Create: `src/api/routes.ts`
- Test: `tests/api/routes.test.ts`

**Interfaces:**
- Produces: `GET /api/tickets` -> `HouseTicket[]`
- Produces: `POST /api/tickets/:id/verify` (accepts multipart photo or JSON) -> `CompletionRecord`
- Produces: `POST /api/tickets/:id/float` -> `HouseTicket`

- [ ] **Step 1: Write failing integration test for API endpoints**

```typescript
// tests/api/routes.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildServer } from "../../src/server";

describe("HouseOps REST API", () => {
  let app: any;
  beforeAll(async () => {
    app = await buildServer({ dbPath: ":memory:" });
  });
  afterAll(async () => {
    await app.close();
  });

  it("returns tickets and verifies with proof", async () => {
    const res = await app.inject({ method: "GET", url: "/api/tickets" });
    expect(res.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/routes.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement Fastify server and photo upload route with image optimization**

Implement `src/server.ts` and `src/api/routes.ts` using `@fastify/multipart` to save verified photo binaries to `/var/houseops/photos/` and record the completion in SQLite.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/routes.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server.ts src/api/ tests/api/
git commit -m "feat(api): implement REST API and photo proof upload handlers"
```

---

### Task 6: Responsive Multi-Device AMOLED Web Client

**Files:**
- Create: `public/index.html`
- Create: `public/app.js`
- Create: `public/styles.css`
- Create: `public/manifest.json`

**Interfaces:**
- Produces: Responsive PWA dashboard with 1-tap camera capture, AMOLED dark mode, and quick-action cards for S26 Ultra and Tab S8 Ultra.

- [ ] **Step 1: Implement PWA manifest and mobile viewport HTML**

Build `public/index.html` with camera `<input type="file" accept="image/*" capture="environment">` for native 1-tap photo verification, floating status badges, and Tab S8 Ultra split layout.

- [ ] **Step 2: Implement True Black AMOLED styles in `public/styles.css`**

Add CSS custom variables with `--bg-main: #000000`, card borders, badge chips, and responsive tablet grid.

- [ ] **Step 3: Implement dynamic client interaction in `public/app.js`**

Fetch tickets from `/api/tickets`, handle 1-tap verify, 1-tap complete without photo, client-side photo resizing before upload, and live countdown timers.

- [ ] **Step 4: Verify client builds and renders cleanly**

Run static analysis and local node server to verify UI layout and responsiveness.

- [ ] **Step 5: Commit**

```bash
git add public/
git commit -m "feat(ui): create responsive AMOLED multi-device client with camera proof"
```

---

### Task 7: Raspberry Pi Deployment & Systemd Service

**Files:**
- Create: `scripts/install-pi.sh`
- Create: `scripts/houseops.service`
- Create: `README.md`

- [ ] **Step 1: Create systemd unit file `scripts/houseops.service`**

Define auto-start on boot with restart-on-failure.

- [ ] **Step 2: Create automated setup script `scripts/install-pi.sh`**

Script installs Node.js, Python dependencies (`pychromecast`, `gTTS`), creates `/var/houseops/photos`, and registers the systemd service.

- [ ] **Step 3: Write complete setup & Google OAuth pairing guide in `README.md`**

Document step-by-step pairing of Google Calendar and Google Tasks.

- [ ] **Step 4: Commit**

```bash
git add scripts/ README.md
git commit -m "feat(deploy): add Raspberry Pi installer, systemd service, and docs"
```
