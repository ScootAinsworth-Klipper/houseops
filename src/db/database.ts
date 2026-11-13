import DatabaseConstructor, { Database } from "better-sqlite3";
import { HouseTicket, CompletionRecord } from "../core/types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  priority TEXT NOT NULL,
  recurrence_type TEXT NOT NULL,
  recurrence_interval_days INTEGER,
  recurrence_base_on_completion INTEGER NOT NULL DEFAULT 1,
  start_hour INTEGER NOT NULL,
  duration_minutes INTEGER NOT NULL,
  current_status TEXT NOT NULL,
  last_completed_at TEXT,
  next_scheduled_at TEXT NOT NULL,
  is_floated INTEGER NOT NULL DEFAULT 0,
  google_calendar_event_id TEXT,
  google_task_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS completion_records (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  method TEXT NOT NULL,
  photo_path TEXT,
  notes TEXT,
  actor TEXT NOT NULL DEFAULT 'Father',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sync_queue (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  payload TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(current_status);
CREATE INDEX IF NOT EXISTS idx_completion_ticket_id ON completion_records(ticket_id);
CREATE INDEX IF NOT EXISTS idx_sync_queue_created ON sync_queue(created_at);
`;

export class HouseOpsDatabase {
  private db: Database;

  constructor(dbPath: string = ":memory:") {
    this.db = new DatabaseConstructor(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);

    // Auto-migrate schema additions
    try { this.db.exec("ALTER TABLE tickets ADD COLUMN start_minute INTEGER NOT NULL DEFAULT 0"); } catch (_) {}
    try { this.db.exec("ALTER TABLE tickets ADD COLUMN days_of_week TEXT"); } catch (_) {}
    try { this.db.exec("ALTER TABLE tickets ADD COLUMN assignee TEXT NOT NULL DEFAULT 'Dad'"); } catch (_) {}
    try { this.db.exec("ALTER TABLE tickets ADD COLUMN broadcast TEXT"); } catch (_) {}
  }

  saveTicket(ticket: HouseTicket): void {
    const stmt = this.db.prepare(`
      INSERT INTO tickets (
        id, title, category, priority, assignee, recurrence_type, recurrence_interval_days,
        days_of_week, recurrence_base_on_completion, start_hour, start_minute, duration_minutes, current_status,
        last_completed_at, next_scheduled_at, is_floated, google_calendar_event_id, google_task_id, broadcast, updated_at
      ) VALUES (
        @id, @title, @category, @priority, @assignee, @recurrence_type, @recurrence_interval_days,
        @days_of_week, @recurrence_base_on_completion, @start_hour, @start_minute, @duration_minutes, @current_status,
        @last_completed_at, @next_scheduled_at, @is_floated, @google_calendar_event_id, @google_task_id, @broadcast, datetime('now')
      )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        category = excluded.category,
        priority = excluded.priority,
        assignee = excluded.assignee,
        recurrence_type = excluded.recurrence_type,
        recurrence_interval_days = excluded.recurrence_interval_days,
        days_of_week = excluded.days_of_week,
        recurrence_base_on_completion = excluded.recurrence_base_on_completion,
        start_hour = excluded.start_hour,
        start_minute = excluded.start_minute,
        duration_minutes = excluded.duration_minutes,
        current_status = excluded.current_status,
        last_completed_at = excluded.last_completed_at,
        next_scheduled_at = excluded.next_scheduled_at,
        is_floated = excluded.is_floated,
        google_calendar_event_id = excluded.google_calendar_event_id,
        google_task_id = excluded.google_task_id,
        broadcast = excluded.broadcast,
        updated_at = datetime('now')
    `);

    stmt.run({
      id: ticket.id,
      title: ticket.title,
      category: ticket.category,
      priority: ticket.priority,
      assignee: ticket.assignee || "Dad",
      recurrence_type: ticket.recurrence.type,
      recurrence_interval_days: ticket.recurrence.intervalDays || null,
      days_of_week: ticket.recurrence.daysOfWeek ? JSON.stringify(ticket.recurrence.daysOfWeek) : null,
      recurrence_base_on_completion: ticket.recurrence.baseOnCompletion ? 1 : 0,
      start_hour: ticket.preferredWindow.startHour,
      start_minute: ticket.preferredWindow.startMinute || 0,
      duration_minutes: ticket.preferredWindow.durationMinutes,
      current_status: ticket.currentStatus,
      last_completed_at: ticket.lastCompletedAt || null,
      next_scheduled_at: ticket.nextScheduledAt,
      is_floated: ticket.isFloated ? 1 : 0,
      google_calendar_event_id: ticket.googleCalendarEventId || null,
      google_task_id: ticket.googleTaskId || null,
      broadcast: ticket.broadcast ? JSON.stringify(ticket.broadcast) : null
    });
  }

  getTicket(id: string): HouseTicket | null {
    const row = this.db.prepare("SELECT * FROM tickets WHERE id = ?").get(id) as any;
    if (!row) return null;
    return this.mapRowToTicket(row);
  }

  getTickets(): HouseTicket[] {
    const rows = this.db.prepare("SELECT * FROM tickets ORDER BY next_scheduled_at ASC").all() as any[];
    return rows.map(r => this.mapRowToTicket(r));
  }

  deleteTicket(id: string): void {
    this.db.prepare("DELETE FROM tickets WHERE id = ?").run(id);
  }

  recordCompletion(record: CompletionRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO completion_records (id, ticket_id, completed_at, method, photo_path, notes, actor)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.id,
      record.ticketId,
      record.completedAt,
      record.method,
      record.photoPath || null,
      record.notes || null,
      record.actor || "Father"
    );
  }

  completeTicketTransaction(ticket: HouseTicket, record: CompletionRecord): void {
    const completeTx = this.db.transaction(() => {
      this.recordCompletion(record);
      this.saveTicket(ticket);
    });
    completeTx();
  }

  queueSync(action: string, ticketId: string, payload: any): void {
    this.db.prepare(`
      INSERT INTO sync_queue (id, action, ticket_id, payload, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(`SYNC-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`, action, ticketId, JSON.stringify(payload));
  }

  getPendingSyncs(): Array<{ id: string; action: string; ticket_id: string; payload: any; attempts: number }> {
    const rows = this.db.prepare("SELECT * FROM sync_queue ORDER BY created_at ASC").all() as any[];
    return rows.map(r => ({
      id: r.id,
      action: r.action,
      ticket_id: r.ticket_id,
      payload: r.payload ? JSON.parse(r.payload) : null,
      attempts: r.attempts
    }));
  }

  removeSync(id: string): void {
    this.db.prepare("DELETE FROM sync_queue WHERE id = ?").run(id);
  }

  getAuditLog(ticketId?: string): CompletionRecord[] {
    let rows: any[];
    if (ticketId) {
      rows = this.db.prepare("SELECT * FROM completion_records WHERE ticket_id = ? ORDER BY completed_at DESC").all(ticketId) as any[];
    } else {
      rows = this.db.prepare("SELECT * FROM completion_records ORDER BY completed_at DESC LIMIT 100").all() as any[];
    }
    return rows.map(r => ({
      id: r.id,
      ticketId: r.ticket_id,
      completedAt: r.completed_at,
      method: r.method,
      photoPath: r.photo_path || undefined,
      notes: r.notes || undefined,
      actor: r.actor
    }));
  }

  setSetting(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(key, value);
  }

  getSetting(key: string, defaultValue: string = ""): string {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as any;
    return row ? row.value : defaultValue;
  }

  close(): void {
    this.db.close();
  }

  private mapRowToTicket(row: any): HouseTicket {
    let daysOfWeek: number[] | undefined;
    if (row.days_of_week) {
      try { daysOfWeek = JSON.parse(row.days_of_week); } catch (_) {}
    }

    let broadcast = undefined;
    if (row.broadcast) {
      try { broadcast = JSON.parse(row.broadcast); } catch (_) {}
    }

    return {
      id: row.id,
      title: row.title,
      category: row.category,
      priority: row.priority,
      assignee: row.assignee || "Dad",
      broadcast,
      recurrence: {
        type: row.recurrence_type,
        intervalDays: row.recurrence_interval_days || undefined,
        daysOfWeek,
        baseOnCompletion: row.recurrence_base_on_completion === 1
      },
      preferredWindow: {
        startHour: row.start_hour,
        startMinute: row.start_minute || 0,
        durationMinutes: row.duration_minutes
      },
      currentStatus: row.current_status,
      lastCompletedAt: row.last_completed_at || undefined,
      nextScheduledAt: row.next_scheduled_at,
      isFloated: row.is_floated === 1,
      googleCalendarEventId: row.google_calendar_event_id || undefined,
      googleTaskId: row.google_task_id || undefined
    };
  }
}

export function initDatabase(dbPath: string = ":memory:"): HouseOpsDatabase {
  return new HouseOpsDatabase(dbPath);
}
