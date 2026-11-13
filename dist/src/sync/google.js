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
        const res = await tasksClient.tasks.patch({
            tasklist: tasklistId,
            task: ticket.googleTaskId,
            requestBody: taskBody
        });
        return res.data?.id || ticket.googleTaskId;
    }
    else {
        const res = await tasksClient.tasks.insert({
            tasklist: tasklistId,
            requestBody: taskBody
        });
        return res.data?.id || "";
    }
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
