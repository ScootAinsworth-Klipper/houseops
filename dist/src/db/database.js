import DatabaseConstructor from "better-sqlite3";
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
    db;
    constructor(dbPath = ":memory:") {
        this.db = new DatabaseConstructor(dbPath);
        this.db.pragma("journal_mode = WAL");
        this.db.exec(SCHEMA);
    }
    saveTicket(ticket) {
        const stmt = this.db.prepare(`
      INSERT INTO tickets (
        id, title, category, priority, recurrence_type, recurrence_interval_days,
        recurrence_base_on_completion, start_hour, duration_minutes, current_status,
        last_completed_at, next_scheduled_at, is_floated, google_calendar_event_id, google_task_id, updated_at
      ) VALUES (
        @id, @title, @category, @priority, @recurrence_type, @recurrence_interval_days,
        @recurrence_base_on_completion, @start_hour, @duration_minutes, @current_status,
        @last_completed_at, @next_scheduled_at, @is_floated, @google_calendar_event_id, @google_task_id, datetime('now')
      )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        category = excluded.category,
        priority = excluded.priority,
        recurrence_type = excluded.recurrence_type,
        recurrence_interval_days = excluded.recurrence_interval_days,
        recurrence_base_on_completion = excluded.recurrence_base_on_completion,
        start_hour = excluded.start_hour,
        duration_minutes = excluded.duration_minutes,
        current_status = excluded.current_status,
        last_completed_at = excluded.last_completed_at,
        next_scheduled_at = excluded.next_scheduled_at,
        is_floated = excluded.is_floated,
        google_calendar_event_id = excluded.google_calendar_event_id,
        google_task_id = excluded.google_task_id,
        updated_at = datetime('now')
    `);
        stmt.run({
            id: ticket.id,
            title: ticket.title,
            category: ticket.category,
            priority: ticket.priority,
            recurrence_type: ticket.recurrence.type,
            recurrence_interval_days: ticket.recurrence.intervalDays || null,
            recurrence_base_on_completion: ticket.recurrence.baseOnCompletion ? 1 : 0,
            start_hour: ticket.preferredWindow.startHour,
            duration_minutes: ticket.preferredWindow.durationMinutes,
            current_status: ticket.currentStatus,
            last_completed_at: ticket.lastCompletedAt || null,
            next_scheduled_at: ticket.nextScheduledAt,
            is_floated: ticket.isFloated ? 1 : 0,
            google_calendar_event_id: ticket.googleCalendarEventId || null,
            google_task_id: ticket.googleTaskId || null
        });
    }
    getTicket(id) {
        const row = this.db.prepare("SELECT * FROM tickets WHERE id = ?").get(id);
        if (!row)
            return null;
        return this.mapRowToTicket(row);
    }
    getTickets() {
        const rows = this.db.prepare("SELECT * FROM tickets ORDER BY next_scheduled_at ASC").all();
        return rows.map(r => this.mapRowToTicket(r));
    }
    recordCompletion(record) {
        const stmt = this.db.prepare(`
      INSERT INTO completion_records (id, ticket_id, completed_at, method, photo_path, notes, actor)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(record.id, record.ticketId, record.completedAt, record.method, record.photoPath || null, record.notes || null, record.actor || "Father");
    }
    completeTicketTransaction(ticket, record) {
        const completeTx = this.db.transaction(() => {
            this.recordCompletion(record);
            this.saveTicket(ticket);
        });
        completeTx();
    }
    queueSync(action, ticketId, payload) {
        this.db.prepare(`
      INSERT INTO sync_queue (id, action, ticket_id, payload, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(`SYNC-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`, action, ticketId, JSON.stringify(payload));
    }
    getPendingSyncs() {
        const rows = this.db.prepare("SELECT * FROM sync_queue ORDER BY created_at ASC").all();
        return rows.map(r => ({
            id: r.id,
            action: r.action,
            ticket_id: r.ticket_id,
            payload: r.payload ? JSON.parse(r.payload) : null,
            attempts: r.attempts
        }));
    }
    removeSync(id) {
        this.db.prepare("DELETE FROM sync_queue WHERE id = ?").run(id);
    }
    getAuditLog(ticketId) {
        let rows;
        if (ticketId) {
            rows = this.db.prepare("SELECT * FROM completion_records WHERE ticket_id = ? ORDER BY completed_at DESC").all(ticketId);
        }
        else {
            rows = this.db.prepare("SELECT * FROM completion_records ORDER BY completed_at DESC LIMIT 100").all();
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
    setSetting(key, value) {
        this.db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(key, value);
    }
    getSetting(key, defaultValue = "") {
        const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
        return row ? row.value : defaultValue;
    }
    close() {
        this.db.close();
    }
    mapRowToTicket(row) {
        return {
            id: row.id,
            title: row.title,
            category: row.category,
            priority: row.priority,
            recurrence: {
                type: row.recurrence_type,
                intervalDays: row.recurrence_interval_days || undefined,
                baseOnCompletion: row.recurrence_base_on_completion === 1
            },
            preferredWindow: {
                startHour: row.start_hour,
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
export function initDatabase(dbPath = ":memory:") {
    return new HouseOpsDatabase(dbPath);
}
