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
