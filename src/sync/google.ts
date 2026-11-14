import { HouseTicket } from "../core/types.js";

export interface GoogleCalendarEventPayload {
  summary: string;
  description: string;
  start: { dateTime: string; timeZone?: string };
  end: { dateTime: string; timeZone?: string };
  colorId?: string;
  extendedProperties?: {
    private?: Record<string, string>;
  };
}

export interface GoogleTaskPayload {
  title: string;
  notes: string;
  due?: string;
  status: "needsAction" | "completed";
}

/**
 * Formats a HouseTicket into a Google Calendar event payload.
 */
export function formatCalendarEvent(ticket: HouseTicket): GoogleCalendarEventPayload {
  const startTime = new Date(ticket.nextScheduledAt);
  const endTime = new Date(startTime.getTime() + ticket.preferredWindow.durationMinutes * 60 * 1000);

  const statusPrefix = ticket.currentStatus === "Verified" ? "✓ Done" : ticket.isFloated ? "⏳ Floated" : "Pending";
  const summary = `🏠 [HouseOps] ${ticket.title}`;
  const description = [
    `Ticket ID: ${ticket.id}`,
    `Category: ${ticket.category}`,
    `Priority: ${ticket.priority}`,
    `Status: ${ticket.currentStatus}`,
    ticket.isFloated ? "Note: Floated forward from previous window" : ""
  ].filter(Boolean).join("\n");

  // Color mapping: Red for P1, Blue for P2, Green for verified
  let colorId = "1"; // blue
  if (ticket.currentStatus === "Verified") colorId = "2"; // green
  else if (ticket.priority === "P1-Urgent") colorId = "11"; // red

  return {
    summary,
    description,
    start: { dateTime: startTime.toISOString() },
    end: { dateTime: endTime.toISOString() },
    colorId,
    extendedProperties: {
      private: {
        houseOpsTicketId: ticket.id,
        status: ticket.currentStatus
      }
    }
  };
}

/**
 * Formats a HouseTicket into a Google Task payload for voice check-offs.
 */
export function formatGoogleTask(ticket: HouseTicket): GoogleTaskPayload {
  return {
    title: ticket.title,
    notes: `Ticket: ${ticket.id} | Priority: ${ticket.priority} | Category: ${ticket.category}`,
    due: ticket.nextScheduledAt,
    status: ticket.currentStatus === "Verified" ? "completed" : "needsAction"
  };
}

/**
 * Pushes or updates a ticket in Google Calendar.
 */
export async function syncTicketToCalendar(
  calendarClient: any,
  calendarId: string = "primary",
  ticket: HouseTicket
): Promise<string> {
  const eventBody = formatCalendarEvent(ticket);

  if (ticket.googleCalendarEventId) {
    const res = await calendarClient.events.update({
      calendarId,
      eventId: ticket.googleCalendarEventId,
      requestBody: eventBody
    });
    return res.data?.id || ticket.googleCalendarEventId;
  } else {
    const res = await calendarClient.events.insert({
      calendarId,
      requestBody: eventBody
    });
    return res.data?.id || "";
  }
}

/**
 * Pushes or updates a ticket in Google Tasks.
 */
export async function syncTicketToTasks(
  tasksClient: any,
  tasklistId: string = "@default",
  ticket: HouseTicket
): Promise<string> {
  const taskBody = formatGoogleTask(ticket);

  if (ticket.googleTaskId) {
    try {
      const res = await tasksClient.tasks.patch({
        tasklist: tasklistId,
        task: ticket.googleTaskId,
        requestBody: taskBody
      });
      if (res.data?.id) return res.data.id;
    } catch (_) {
      // Fall through to insert if task was deleted on Google's side
    }
  }
  const res = await tasksClient.tasks.insert({
    tasklist: tasklistId,
    requestBody: taskBody
  });
  return res.data?.id || "";
}

/**
 * Polls Google Tasks to check if any tasks have been marked completed via Google Assistant voice commands.
 */
export async function pollTaskCompletions(
  tasksClient: any,
  tasklistId: string = "@default",
  taskIds: string[]
): Promise<string[]> {
  const completedTaskIds: string[] = [];

  for (const taskId of taskIds) {
    try {
      const res = await tasksClient.tasks.get({
        tasklist: tasklistId,
        task: taskId
      });
      if (res.data?.status === "completed") {
        completedTaskIds.push(taskId);
      }
    } catch (e) {
      // Ignore not found or transient errors
    }
  }

  return completedTaskIds;
}

let cachedAccessToken = "";
let cachedTokenExpiry = 0;

/**
 * Creates a lightweight Google Tasks v1 REST API client using Node's built-in fetch.
 */
export function createGoogleTasksClient(config: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}) {
  async function getAccessToken(): Promise<string> {
    if (cachedAccessToken && Date.now() < cachedTokenExpiry - 60_000) {
      return cachedAccessToken;
    }
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
        grant_type: "refresh_token"
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Google OAuth token refresh failed (${res.status}): ${errText}`);
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    cachedAccessToken = data.access_token;
    cachedTokenExpiry = Date.now() + (data.expires_in || 3500) * 1000;
    return cachedAccessToken;
  }

  async function apiRequest(method: string, urlPath: string, body?: any) {
    const token = await getAccessToken();
    const res = await fetch(`https://tasks.googleapis.com/tasks/v1${urlPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Google Tasks API ${method} ${urlPath} failed (${res.status}): ${errText}`);
    }
    if (res.status === 204) return { data: {} };
    return { data: await res.json() };
  }

  return {
    tasks: {
      insert: ({ tasklist = "@default", requestBody }: { tasklist?: string; requestBody: any }) =>
        apiRequest("POST", `/lists/${encodeURIComponent(tasklist)}/tasks`, requestBody),
      patch: ({ tasklist = "@default", task, requestBody }: { tasklist?: string; task: string; requestBody: any }) =>
        apiRequest("PATCH", `/lists/${encodeURIComponent(tasklist)}/tasks/${encodeURIComponent(task)}`, requestBody),
      get: ({ tasklist = "@default", task }: { tasklist?: string; task: string }) =>
        apiRequest("GET", `/lists/${encodeURIComponent(tasklist)}/tasks/${encodeURIComponent(task)}`),
      list: ({ tasklist = "@default" }: { tasklist?: string } = {}) =>
        apiRequest("GET", `/lists/${encodeURIComponent(tasklist)}/tasks?showCompleted=true&showHidden=true&maxResults=100`),
      delete: ({ tasklist = "@default", task }: { tasklist?: string; task: string }) =>
        apiRequest("DELETE", `/lists/${encodeURIComponent(tasklist)}/tasks/${encodeURIComponent(task)}`)
    }
  };
}
