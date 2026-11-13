export type TicketCategory =
  | "Kitchen"
  | "HVAC"
  | "Bathrooms"
  | "Trash"
  | "Yard"
  | "General";

export type TicketPriority = "P1-Urgent" | "P2-Normal" | "P3-Low";

export type RecurrenceType =
  | "Daily"
  | "Weekdays"
  | "Weekends"
  | "DaysOfWeek"
  | "Weekly"
  | "Monthly"
  | "IntervalDays"
  | "OnDemand";

export interface RecurrenceConfig {
  type: RecurrenceType;
  intervalDays?: number;
  daysOfWeek?: number[]; // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  baseOnCompletion: boolean;
}

export interface PreferredWindow {
  startHour: number; // 24-hr format (0-23)
  startMinute?: number; // 0-59
  durationMinutes: number;
}

export type BroadcastStage = "exact" | "15m_before" | "overdue";

export interface BroadcastConfig {
  stages?: BroadcastStage[]; // e.g. ["exact", "overdue"]
  timing?: string; // backwards compatibility
  speakers: string[];
  customMessage?: string;
  lastAnnouncedAt?: string;
  lastAnnouncedStage?: string;
}

export type TicketStatus = "Pending" | "In_Progress" | "Verified";

export interface HouseTicket {
  id: string;
  title: string;
  category: TicketCategory;
  priority: TicketPriority;
  assignee?: string;
  broadcast?: BroadcastConfig;
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
