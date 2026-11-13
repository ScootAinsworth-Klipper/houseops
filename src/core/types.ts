export type TicketCategory =
  | "Kitchen"
  | "HVAC"
  | "Bathrooms"
  | "Trash"
  | "Yard"
  | "General";

export type TicketPriority = "P1-Urgent" | "P2-Normal" | "P3-Low";

export type RecurrenceType = "Daily" | "Weekly" | "Monthly" | "IntervalDays";

export interface RecurrenceConfig {
  type: RecurrenceType;
  intervalDays?: number;
  baseOnCompletion: boolean;
}

export interface PreferredWindow {
  startHour: number; // 24-hr format (0-23)
  durationMinutes: number;
}

export type TicketStatus = "Pending" | "In_Progress" | "Verified";

export interface HouseTicket {
  id: string;
  title: string;
  category: TicketCategory;
  priority: TicketPriority;
  recurrence: RecurrenceConfig;
  preferredWindow: PreferredWindow;
  currentStatus: TicketStatus;
  lastCompletedAt?: string; // ISO 8601
  nextScheduledAt: string; // ISO 8601
  isFloated?: boolean;
  googleCalendarEventId?: string;
  googleTaskId?: string;
}

export type CompletionMethod = "Photo_Verified" | "Quick_Complete" | "Voice_Closed";

export interface CompletionRecord {
  id: string;
  ticketId: string;
  completedAt: string; // ISO 8601
  method: CompletionMethod;
  photoPath?: string;
  notes?: string;
  actor: "Father" | "Child_1" | "Child_2";
}
