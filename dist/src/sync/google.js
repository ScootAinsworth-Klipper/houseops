/**
 * Formats a HouseTicket into a Google Calendar event payload.
 */
export function formatCalendarEvent(ticket) {
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
    if (ticket.currentStatus === "Verified")
        colorId = "2"; // green
    else if (ticket.priority === "P1-Urgent")
        colorId = "11"; // red
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
export function formatGoogleTask(ticket) {
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
export async function syncTicketToCalendar(calendarClient, calendarId = "primary", ticket) {
    const eventBody = formatCalendarEvent(ticket);
    if (ticket.googleCalendarEventId) {
        const res = await calendarClient.events.update({
            calendarId,
            eventId: ticket.googleCalendarEventId,
            requestBody: eventBody
        });
        return res.data?.id || ticket.googleCalendarEventId;
    }
    else {
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
export async function syncTicketToTasks(tasksClient, tasklistId = "@default", ticket) {
    const taskBody = formatGoogleTask(ticket);
    if (ticket.googleTaskId) {
        try {
            const res = await tasksClient.tasks.patch({
                tasklist: tasklistId,
                task: ticket.googleTaskId,
                requestBody: taskBody
            });
            if (res.data?.id)
                return res.data.id;
        }
        catch (_) {
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
export async function pollTaskCompletions(tasksClient, tasklistId = "@default", taskIds) {
    const completedTaskIds = [];
    for (const taskId of taskIds) {
        try {
            const res = await tasksClient.tasks.get({
                tasklist: tasklistId,
                task: taskId
            });
            if (res.data?.status === "completed") {
                completedTaskIds.push(taskId);
            }
        }
        catch (e) {
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
export function createGoogleTasksClient(config) {
    if (config.webappUrl) {
        const url = config.webappUrl;
        async function scriptRequest(payload) {
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                redirect: "follow"
            });
            if (!res.ok) {
                throw new Error(`Apps Script request failed (${res.status})`);
            }
            return { data: await res.json() };
        }
        return {
            tasks: {
                insert: ({ tasklist = "@default", requestBody }) => scriptRequest({ op: "insert", tasklist, body: requestBody }),
                patch: ({ tasklist = "@default", task, requestBody }) => scriptRequest({ op: "patch", tasklist, task, body: requestBody }),
                get: ({ tasklist = "@default", task }) => scriptRequest({ op: "get", tasklist, task }),
                list: ({ tasklist = "@default" } = {}) => scriptRequest({ op: "list", tasklist }),
                delete: ({ tasklist = "@default", task }) => scriptRequest({ op: "delete", tasklist, task })
            },
            drive: {
                uploadPhoto: (filename, base64Data, mimeType = "image/jpeg") => scriptRequest({
                    op: "upload_photo",
                    folderName: "HouseOps Photos",
                    filename,
                    base64Data,
                    mimeType
                })
            }
        };
    }
    async function getAccessToken() {
        if (cachedAccessToken && Date.now() < cachedTokenExpiry - 60_000) {
            return cachedAccessToken;
        }
        const res = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: config.clientId || "",
                client_secret: config.clientSecret || "",
                refresh_token: config.refreshToken || "",
                grant_type: "refresh_token"
            })
        });
        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Google OAuth token refresh failed (${res.status}): ${errText}`);
        }
        const data = (await res.json());
        cachedAccessToken = data.access_token;
        cachedTokenExpiry = Date.now() + (data.expires_in || 3500) * 1000;
        return cachedAccessToken;
    }
    async function apiRequest(method, urlPath, body) {
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
        if (res.status === 204)
            return { data: {} };
        return { data: await res.json() };
    }
    return {
        tasks: {
            insert: ({ tasklist = "@default", requestBody }) => apiRequest("POST", `/lists/${encodeURIComponent(tasklist)}/tasks`, requestBody),
            patch: ({ tasklist = "@default", task, requestBody }) => apiRequest("PATCH", `/lists/${encodeURIComponent(tasklist)}/tasks/${encodeURIComponent(task)}`, requestBody),
            get: ({ tasklist = "@default", task }) => apiRequest("GET", `/lists/${encodeURIComponent(tasklist)}/tasks/${encodeURIComponent(task)}`),
            list: ({ tasklist = "@default" } = {}) => apiRequest("GET", `/lists/${encodeURIComponent(tasklist)}/tasks?showCompleted=true&showHidden=true&maxResults=100`),
            delete: ({ tasklist = "@default", task }) => apiRequest("DELETE", `/lists/${encodeURIComponent(tasklist)}/tasks/${encodeURIComponent(task)}`)
        }
    };
}
