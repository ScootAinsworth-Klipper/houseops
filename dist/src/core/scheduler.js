/**
 * Calculates the next occurrence timestamp for a ticket based on completion time or previous schedule.
 */
export function calculateNextOccurrence(ticket, referenceDate = new Date()) {
    const baseDate = new Date(referenceDate);
    const next = new Date(baseDate);
    const startMinute = ticket.preferredWindow.startMinute || 0;
    switch (ticket.recurrence.type) {
        case "Daily":
            next.setUTCDate(next.getUTCDate() + 1);
            break;
        case "Weekdays": {
            let candidate = new Date(baseDate);
            for (let i = 1; i <= 7; i++) {
                candidate.setUTCDate(candidate.getUTCDate() + 1);
                const day = candidate.getUTCDay();
                if (day >= 1 && day <= 5) {
                    next.setTime(candidate.getTime());
                    break;
                }
            }
            break;
        }
        case "Weekends": {
            let candidate = new Date(baseDate);
            for (let i = 1; i <= 7; i++) {
                candidate.setUTCDate(candidate.getUTCDate() + 1);
                const day = candidate.getUTCDay();
                if (day === 0 || day === 6) {
                    next.setTime(candidate.getTime());
                    break;
                }
            }
            break;
        }
        case "DaysOfWeek": {
            const allowed = ticket.recurrence.daysOfWeek && ticket.recurrence.daysOfWeek.length > 0
                ? ticket.recurrence.daysOfWeek
                : [1, 2, 3, 4, 5];
            let candidate = new Date(baseDate);
            for (let i = 1; i <= 7; i++) {
                candidate.setUTCDate(candidate.getUTCDate() + 1);
                const day = candidate.getUTCDay();
                if (allowed.includes(day)) {
                    next.setTime(candidate.getTime());
                    break;
                }
            }
            break;
        }
        case "Weekly":
            next.setUTCDate(next.getUTCDate() + 7);
            break;
        case "Monthly":
            next.setUTCMonth(next.getUTCMonth() + 1);
            break;
        case "IntervalDays":
            const days = ticket.recurrence.intervalDays || 1;
            next.setUTCDate(next.getUTCDate() + days);
            break;
    }
    // Anchor to preferred window hour & minute (in UTC)
    next.setUTCHours(ticket.preferredWindow.startHour, startMinute, 0, 0);
    return next;
}
function getAllowedDays(ticket) {
    if (ticket.recurrence.type === "Weekdays")
        return [1, 2, 3, 4, 5];
    if (ticket.recurrence.type === "Weekends")
        return [0, 6];
    if (ticket.recurrence.type === "DaysOfWeek")
        return ticket.recurrence.daysOfWeek || [1, 2, 3, 4, 5];
    return null;
}
/**
 * Scans pending tickets to identify any whose scheduled window has passed without completion,
 * floating them forward to the next available designated chore window without duplication.
 */
export function evaluateFloatingTickets(tickets, now = new Date(), useUtc = true) {
    const updated = [];
    const floated = [];
    for (const ticket of tickets) {
        if (ticket.currentStatus !== "Pending")
            continue;
        const scheduledTime = new Date(ticket.nextScheduledAt);
        const windowEndTime = new Date(scheduledTime.getTime() + ticket.preferredWindow.durationMinutes * 60 * 1000);
        // If window has passed
        if (now.getTime() > windowEndTime.getTime()) {
            const nextWindow = new Date(now);
            const currentHour = useUtc ? now.getUTCHours() : now.getHours();
            const currentMinute = useUtc ? now.getUTCMinutes() : now.getMinutes();
            const startMinute = ticket.preferredWindow.startMinute || 0;
            const allowedDays = getAllowedDays(ticket);
            const isPastWindowToday = currentHour > ticket.preferredWindow.startHour ||
                (currentHour === ticket.preferredWindow.startHour && currentMinute >= startMinute);
            // Advance until we land on an allowed day and time
            let candidate = new Date(now);
            if (isPastWindowToday) {
                if (useUtc)
                    candidate.setUTCDate(candidate.getUTCDate() + 1);
                else
                    candidate.setDate(candidate.getDate() + 1);
            }
            if (allowedDays) {
                for (let i = 0; i < 7; i++) {
                    const day = useUtc ? candidate.getUTCDay() : candidate.getDay();
                    if (allowedDays.includes(day)) {
                        break;
                    }
                    if (useUtc)
                        candidate.setUTCDate(candidate.getUTCDate() + 1);
                    else
                        candidate.setDate(candidate.getDate() + 1);
                }
            }
            if (useUtc) {
                candidate.setUTCHours(ticket.preferredWindow.startHour, startMinute, 0, 0);
            }
            else {
                candidate.setHours(ticket.preferredWindow.startHour, startMinute, 0, 0);
            }
            const modifiedTicket = {
                ...ticket,
                nextScheduledAt: candidate.toISOString(),
                isFloated: true
            };
            updated.push(modifiedTicket);
            floated.push(ticket.id);
        }
    }
    return { updated, floated };
}
