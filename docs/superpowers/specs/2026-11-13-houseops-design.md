# HouseOps: Household Operations & Ticketing Engine
**Design Document**  
**Date:** 2026-11-13  
**Status:** Approved by User  
**Author:** Antigravity & User  

---

## 1. Intent & The Why

In a professional environment, operational ticketing systems ensure work is state-driven, assigned, verified, and continuously monitored so nothing slips through the cracks. At home, running a busy household as a single father of two demands the same level of operational clarity.

Traditional "to-do" or "chore" apps fail because:
1. When real life derails an evening, overdue items pile up into an overwhelming, demoralizing backlog of duplicate red tasks.
2. They lack operational verification (proof of completion).
3. They live in a silo separate from daily calendar time-blocking and ambient voice assistants.

**HouseOps** translates the rigor of an IT operations dashboard into home life: automated floating work orders, verification via instant photo capture, zero repetitive backlogs, native Google Calendar time-blocking, natural voice check-offs, and true spoken broadcasts over Google Nest speakers powered by a dedicated 24/7 Raspberry Pi 3B.

---

## 2. Goals, Non-Goals & Anti-Goals

### Goals
- **State-Driven Household Tickets**: Every chore, routine maintenance item, and recurring household duty is tracked as a ticket with states (`Pending`, `In Progress`, `Verified`).
- **Dynamic Floating Scheduling**: If a scheduled chore window slips, the ticket floats forward to the next available designated chore window rather than duplicating or piling into a static backlog.
- **Completion-Based Recurrence**: For recurring cadences (e.g. HVAC filters every 60 days, bathroom deep clean every 7 days), the next occurrence timer calculates from the timestamp of *actual completion*, preventing schedule drift.
- **Verification Audit Trail**: Every ticket closure records timestamp, method (`Photo Verified`, `Quick Complete`, or `Voice Closed`), and optional photo evidence stored in the history log.
- **Ambient Voice Check-offs**: Support natural voice check-offs (*"Hey Google, mark dishes done"* or *"Hey Google, check off trash"*) across every Nest device in the house via Google Tasks integration.
- **Spoken Room Broadcasts via Raspberry Pi 3B**: The dedicated 24/7 Raspberry Pi casts spoken deadline reminders and morning/evening briefings directly to Google Nest speakers over the local Wi-Fi network using local Google Cast/TTS.
- **Dual-Layer Alerts**: Spoken ambient reminders in the room paired with actionable push notifications on mobile devices.
- **Multi-Device Client**: Responsive executive interface on Samsung Galaxy S26 Ultra (phone), Galaxy Tab S8 Ultra (tablet), and laptop browser with True Black AMOLED theme.

### Non-Goals (Phase 1)
- **Kid Login Profiles / Gamification**: While the data model tags assignees for future expansion, Phase 1 focuses exclusively on the father's single-operator executive command center.
- **Financial / Allowance Tracking**: No point-to-dollar conversions, chore payouts, or external bank connections in Phase 1.
- **Multi-Tenant / Multi-Home**: Single household deployment.

### Anti-Goals
- **Guilt-Inducing Overdue Stacks**: Never generate duplicate overdue cards for the same recurring chore.
- **Rigid Voice Syntax**: Never force the user to memorize robotic, brittle voice commands to interact with Google Assistant.
- **Manual Data Entry Burden**: Check-offs must take 1 tap or 1 voice utterance; photo capture must be 1-tap from camera without multi-step upload dialogues.
- **Fragile Cloud Audio Bridges**: No reliance on paid smart home subscriptions or cloud tunnels to speak over Nest speakers.

---

## 3. System Architecture & Component Roles

```
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                       Google Cloud & Ecosystem                              │
 │  - Google Calendar (🏠 House Ops): Visual time blocks & schedule widget     │
 │  - Google Tasks (HouseOps Queue): Natural language voice check-off target   │
 │  - Google Assistant / Gemini: Handles voice input from all Nest speakers    │
 └──────────────────────────────┬───────────────────▲──────────────────────────┘
                                │ Cloud Sync        │ Voice Check-off
                                ▼                   │
 ┌──────────────────────────────────────────────────┴──────────────────────────┐
 │               Raspberry Pi 3B (24/7 Local Home Daemon)                      │
 │  - Runs HouseOps Core Daemon (Node.js/Python systemd service)               │
 │  - Floating Engine: Reschedules slipped chores into next viable window      │
 │  - Recurrence Engine: Resets interval timers from completion timestamp      │
 │  - Local Google Cast Announcer (pychromecast): Direct TTS to Nest speakers  │
 │  - SQLite Audit Database & Photo Proof Store                                │
 └──────────────┬───────────────────────────────────▲──────────────────────────┘
                │ Local LAN / Wi-Fi API             │
                ▼                                   ▼
 ┌───────────────────────────────────────────────────┐  ┌──────────────────────┐
 │             Multi-Device Client App               │  │ Google Nest Speakers │
 │  - S26 Ultra: 1-handed triage & fast camera proof │  │  (Kitchen, Living,   │
 │  - Tab S8 Ultra: Wall/desk operational dashboard  │  │   Bedrooms, etc.)    │
 │  - Laptop: Web management & cadence planning      │  │ - Spoken Broadcasts  │
 │  - AMOLED Dark Mode & Fast Status Cards           │  │ - Voice Check-offs   │
 └───────────────────────────────────────────────────┘  └──────────────────────┘
```

---

## 4. Hardware & Role Split

1. **Raspberry Pi 3B (Local Headless Server)**:
   - **Specs**: Quad-Core ARM, 1GB RAM, connected 24/7 on local home network.
   - **Responsibilities**:
     - Pulls Google Tasks and Calendar states every 60s.
     - Automatically shifts uncompleted chores to the next designated window when a window expires.
     - When a deadline is approaching (e.g. 45 min remaining on P1 task), connects to Google Nest speaker groups over local mDNS/Cast protocol and speaks the alert.
     - Serves the lightweight web/API client and stores photo proof binaries in a local directory (`/var/houseops/photos/`).

2. **Google Nest Speakers (Ambient Audio & Voice)**:
   - **Microphone role**: Accepts voice check-offs (*"Hey Google, mark laundry done"*) via native Google Tasks linkage.
   - **Speaker role**: Receives incoming TTS audio streams cast directly from the Raspberry Pi over local Wi-Fi.

3. **Client Devices (S26 Ultra, Tab S8 Ultra, Laptop)**:
   - Modern, responsive web app / installable PWA with camera API access.
   - Quick check-off buttons (`[📸 Photo Verify]`, `[✓ Complete without Photo]`, `[⏳ Snooze]`).
   - Detailed audit log of recent completions with image preview and voice completion tags.

---

## 5. Core Data Model

### 5.1 Ticket Schema
```typescript
interface HouseTicket {
  id: string;                     // e.g. "TICK-101"
  title: string;                  // e.g. "Kitchen Counters & Sink"
  category: "Kitchen" | "HVAC" | "Bathrooms" | "Trash" | "Yard" | "General";
  priority: "P1-Urgent" | "P2-Normal" | "P3-Low";
  recurrence: {
    type: "Daily" | "Weekly" | "Monthly" | "IntervalDays";
    intervalDays?: number;        // e.g. 60 for air filters
    baseOnCompletion: boolean;    // true = reset timer on actual completion date
  };
  preferredWindow: {
    startHour: number;            // 24-hr format (e.g. 19 for 7 PM)
    durationMinutes: number;      // e.g. 45
  };
  currentStatus: "Pending" | "In_Progress" | "Verified";
  lastCompletedAt?: string;       // ISO 8601
  nextScheduledAt: string;        // ISO 8601
  googleCalendarEventId?: string;
  googleTaskId?: string;
}
```

### 5.2 Completion Audit Schema
```typescript
interface CompletionRecord {
  id: string;
  ticketId: string;
  completedAt: string;            // Timestamp
  method: "Photo_Verified" | "Quick_Complete" | "Voice_Closed";
  photoPath?: string;             // File path on Pi (/var/houseops/photos/...)
  notes?: string;                 // Optional note
  actor: "Father" | "Child_1" | "Child_2";
}
```

---

## 6. Functional Workflows

### 6.1 The Floating Schedule Algorithm
1. Every 5 minutes, the Pi daemon scans all `Pending` tickets.
2. If a chore's time window has elapsed and it has not been completed:
   - The daemon finds the next open chore window (e.g., tomorrow at 7:00 PM).
   - It updates the Google Calendar event to the new time and moves the deadline.
   - The ticket in the UI displays a subtle badge: `Floated from Yesterday`.
   - **Crucial**: No duplicate tickets or duplicate calendar blocks are ever created.

### 6.2 Completion & Verification Workflows
- **Photo Verification**: Tap **📸 Verify** in HouseOps on phone or tablet -> Native camera opens -> Snap photo -> Ticket transitions to `Verified`. Pi stores image, updates Google Calendar event title to `[✓ Done]`, marks Google Task complete, and schedules the next recurrence.
- **1-Tap Quick Complete**: Tap **✓ Done (No Photo)** -> Instantly marked verified with `Quick_Complete` tag.
- **Voice Check-off**: Say *"Hey Google, mark kitchen counters done"* to any Nest speaker -> Google Tasks marks the item complete in the cloud -> Pi daemon detects completion on next sync poll -> Logs audit entry with `Closed via Voice (Google Assistant)` -> Recalculates and floats next occurrence.
- **Retroactive Photo**: If closed via voice, user can tap the ticket under "Recent Completions" to attach a photo proof later.

### 6.3 Voice Broadcast Engine (`pychromecast`)
- The Pi daemon maintains a persistent or on-demand Cast connection to designated Google Cast speaker groups (e.g., `"Whole House"` or `"Kitchen Speaker"`).
- **Morning Briefing**: Spoken summary at 7:30 AM (*"Good morning. You have 2 house tickets today: Trash pickup by 6 PM, and Kitchen Counters tonight."*).
- **Approaching Deadline Nudge**: 45 minutes before a window closes, if still `Pending`, the Pi chimes and speaks: *"Friendly reminder: Kitchen counters deadline is in 45 minutes."*
- **Quiet Hours**: Broadcasts are automatically muted between 9:30 PM and 7:00 AM.

---

## 7. What is Left to the Builder
- Selection of web app stack for the Pi (e.g. Fastify / Express backend + lightweight Vanilla JS / Svelte frontend).
- Setup script / systemd service configuration for Raspberry Pi OS.
- PWA manifest and service worker configuration for standalone app installation on S26 Ultra and Tab S8 Ultra.
- SQLite database migrations and schema indexes.
