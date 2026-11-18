# Broadcast Snooze & Resume Design

**Date:** 2026-11-18  
**Status:** Proposed  
**Scope:** Backend (`announcer_client.ts`, `routes.ts`) + Web Dashboard (`public/index.html`, `public/app.js`) + Tests

---

## Goal
Allow Dad (and only Dad's profile) to temporarily snooze automated household voice broadcasts for a set duration (e.g., when guests are over) and either resume early or have broadcasts automatically resume by the next day—without ever getting stuck muted indefinitely.

Manual Dad-triggered broadcasts (**Broadcast Now / Nudge**, **Test Voice**, **Send Back & Announce**) and requested **School Menu** announcements continue to work even while snoozed.

---

## Architecture & Behavior

### 1. Snooze State in `QuietHoursConfig` (`daemon/announcer_client.ts`)
- Add `snoozedUntil?: string | null` (ISO 8601 timestamp) to `QuietHoursConfig`.
- Add helper `isSnoozed(now: Date = new Date()): boolean`:
  - Returns `true` if `activeQuietConfig.snoozedUntil` is set and `new Date(snoozedUntil).getTime() > now.getTime()`.
  - If `snoozedUntil` is in the past, it is expired (and can be treated as inactive / cleared on next update).
- Update `isQuietHours(now: Date = new Date(), startHour?: number, endHour?: number): boolean`:
  - When using `activeQuietConfig` (no explicit `startHour`/`endHour` overrides), return `true` if `activeQuietConfig.forceMute` is true **or** `isSnoozed(now)` is true; otherwise evaluate the scheduled `startTime`–`endTime` window when `enabled` is true.
- Update `setQuietHoursConfig`:
  - Support setting `snoozedUntil` (string) or clearing it (`null` / `""`).
- Persistence:
  - Stored in SQLite `settings` under `"quiet_hours_config"` just like `enabled`, `forceMute`, `startTime`, `endTime`, so snooze survives Pi restarts.

### 2. API Endpoints (`src/api/routes.ts`)
- `GET /api/settings/quiet-hours`:
  - Returns `{ ...cfg, isCurrentlyQuiet: isQuietHours(now), isSnoozed: isSnoozed(now) }`.
- `POST /api/settings/quiet-hours`:
  - Accepts `snoozedUntil` (ISO string or `null`) in addition to `enabled`, `forceMute`, `startTime`, `endTime`.
- **Manual / Requested Broadcast Bypass**:
  - `announceSchoolMenu` (`src/core/school_menu.ts` & `/api/menu/announce`) already passes `bypassQuietHours: true`.
  - Update manual UI-triggered broadcast routes to pass `bypassQuietHours: true` to `broadcastAnnouncement`:
    - `POST /api/tickets/:id/nudge` ("Broadcast Now" / Nudge)
    - `POST /api/tickets/:id/reopen` (when `announce: true`, "Send Back & Announce")
    - `POST /api/announce` ("Test Voice")
  - Automated broadcasts in `src/daemon.ts` (scheduled chore reminders, overdue nudges, Google Tasks voice-completion confirmations) keep `bypassQuietHours = false` so they are silenced during snooze and quiet hours.

### 3. Dad-Only UI (`public/index.html`, `public/app.js`)
- **Profile Gate**: Already enforced by `openQuietHoursModal()` (`currentProfile !== "Dad"` triggers the Dad PIN prompt). Kids' profiles cannot access snooze/quiet controls.
- **Header Chip (`#chipQuiet`)**:
  - When `isSnoozed` is true (and not `forceMute`), show e.g. `🌙 Snoozed til 11:30p` (or `🌙 Snoozed til 6a`) with `.active` styling.
- **Quiet Hours & Snooze Modal (`#quietHoursModal`)**:
  - Add a **Snooze Broadcasts** section at the top of the modal with one-tap duration buttons:
    - **1 hr** (`+1h`)
    - **2 hrs** (`+2h`)
    - **4 hrs** (`+4h`)
    - **Until Tomorrow** (next occurrence of `endTime`, e.g., `6:00 AM` next morning—guaranteed to resume the next day)
  - When currently snoozed (or `forceMute` is on), display a prominent **🔊 Resume Broadcasts Now** button that clears `snoozedUntil` and `forceMute` immediately and saves.
  - Keep existing **Mute Indefinitely (`forceMute`)** and **Daily Quiet Hours Schedule** below for full control.

---

## Verification Plan
- Unit tests in `tests/daemon/announcer.test.ts`:
  - `isSnoozed()` and `isQuietHours()` return `true` before `snoozedUntil` and `false` after `snoozedUntil` expires.
  - Clearing `snoozedUntil` (`null`) immediately resumes (`isSnoozed() === false`).
  - `broadcastAnnouncement(..., bypassQuietHours = true)` still executes when snoozed; `bypassQuietHours = false` is muted.
- API route tests in `tests/api/routes.test.ts`:
  - `POST /api/settings/quiet-hours` persists `snoozedUntil` and `GET /api/settings/quiet-hours` reports `isSnoozed` / `isCurrentlyQuiet`.
- Full `npm run build` and `npx vitest run`.
