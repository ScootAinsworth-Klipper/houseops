export const HOUSEHOLD_TIMEZONE = "America/Chicago";
const WEEKDAY_MAP = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
};
function getZonedParts(date, timeZone) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).formatToParts(date);
    const get = (type) => parts.find((p) => p.type === type)?.value || "0";
    const rawHour = parseInt(get("hour"), 10);
    return {
        year: parseInt(get("year"), 10),
        month: parseInt(get("month"), 10),
        day: parseInt(get("day"), 10),
        weekday: WEEKDAY_MAP[get("weekday")] ?? 0,
        hour: rawHour === 24 ? 0 : rawHour,
        minute: parseInt(get("minute"), 10),
    };
}
function zonedWallTimeToUtc(year, month, day, hour, minute, timeZone) {
    const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
    const offsetAt = (d) => {
        const p = getZonedParts(d, timeZone);
        return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0) - d.getTime();
    };
    const pass1 = new Date(utcGuess - offsetAt(new Date(utcGuess)));
    return new Date(utcGuess - offsetAt(pass1));
}
function getCalendarParts(date, zoneOption) {
    if (typeof zoneOption === "string") {
        return getZonedParts(date, zoneOption);
    }
    if (zoneOption === false) {
        return {
            year: date.getFullYear(),
            month: date.getMonth() + 1,
            day: date.getDate(),
            weekday: date.getDay(),
            hour: date.getHours(),
            minute: date.getMinutes(),
        };
    }
    return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        weekday: date.getUTCDay(),
        hour: date.getUTCHours(),
        minute: date.getUTCMinutes(),
    };
}
function wallTimeToDate(year, month, day, hour, minute, zoneOption) {
    if (typeof zoneOption === "string") {
        return zonedWallTimeToUtc(year, month, day, hour, minute, zoneOption);
    }
    if (zoneOption === false) {
        return new Date(year, month - 1, day, hour, minute, 0, 0);
    }
    return new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
}
/**
 * Calculates the next occurrence timestamp for a ticket based on completion time or previous schedule.
 */
export function calculateNextOccurrence(ticket, referenceDate = new Date(), zoneOption = true) {
    if (ticket.recurrence.type === "OnDemand") {
        return new Date(referenceDate);
    }
    const startHour = ticket.preferredWindow.startHour;
    const startMinute = ticket.preferredWindow.startMinute || 0;
    const baseParts = getCalendarParts(referenceDate, zoneOption);
    const scratch = new Date(Date.UTC(baseParts.year, baseParts.month - 1, baseParts.day, 12, 0, 0, 0));
    switch (ticket.recurrence.type) {
        case "Daily":
            scratch.setUTCDate(scratch.getUTCDate() + 1);
            break;
        case "Weekdays": {
            for (let i = 1; i <= 7; i++) {
                scratch.setUTCDate(scratch.getUTCDate() + 1);
                const day = scratch.getUTCDay();
                if (day >= 1 && day <= 5) {
                    break;
                }
            }
            break;
        }
        case "Weekends": {
            for (let i = 1; i <= 7; i++) {
                scratch.setUTCDate(scratch.getUTCDate() + 1);
                const day = scratch.getUTCDay();
                if (day === 0 || day === 6) {
                    break;
                }
            }
            break;
        }
        case "DaysOfWeek": {
            const allowed = ticket.recurrence.daysOfWeek && ticket.recurrence.daysOfWeek.length > 0
                ? ticket.recurrence.daysOfWeek
                : [1, 2, 3, 4, 5];
            for (let i = 1; i <= 7; i++) {
                scratch.setUTCDate(scratch.getUTCDate() + 1);
                if (allowed.includes(scratch.getUTCDay())) {
                    break;
                }
            }
            break;
        }
        case "Weekly":
            scratch.setUTCDate(scratch.getUTCDate() + 7);
            break;
        case "Monthly":
            scratch.setUTCMonth(scratch.getUTCMonth() + 1);
            break;
        case "IntervalDays": {
            const days = ticket.recurrence.intervalDays || 1;
            scratch.setUTCDate(scratch.getUTCDate() + days);
            break;
        }
    }
    return wallTimeToDate(scratch.getUTCFullYear(), scratch.getUTCMonth() + 1, scratch.getUTCDate(), startHour, startMinute, zoneOption);
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
export function evaluateFloatingTickets(tickets, now = new Date(), zoneOption = true) {
    const updated = [];
    const floated = [];
    for (const ticket of tickets) {
        if (ticket.currentStatus !== "Pending" || ticket.recurrence.type === "OnDemand")
            continue;
        const scheduledTime = new Date(ticket.nextScheduledAt);
        const windowEndTime = new Date(scheduledTime.getTime() + ticket.preferredWindow.durationMinutes * 60 * 1000);
        // If window has passed
        if (now.getTime() > windowEndTime.getTime()) {
            const nowParts = getCalendarParts(now, zoneOption);
            const startHour = ticket.preferredWindow.startHour;
            const startMinute = ticket.preferredWindow.startMinute || 0;
            const allowedDays = getAllowedDays(ticket);
            const isPastWindowToday = nowParts.hour > startHour ||
                (nowParts.hour === startHour && nowParts.minute >= startMinute);
            const candidate = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day, 12, 0, 0, 0));
            if (isPastWindowToday) {
                candidate.setUTCDate(candidate.getUTCDate() + 1);
            }
            if (allowedDays) {
                for (let i = 0; i < 7; i++) {
                    if (allowedDays.includes(candidate.getUTCDay())) {
                        break;
                    }
                    candidate.setUTCDate(candidate.getUTCDate() + 1);
                }
            }
            const nextDate = wallTimeToDate(candidate.getUTCFullYear(), candidate.getUTCMonth() + 1, candidate.getUTCDate(), startHour, startMinute, zoneOption);
            const modifiedTicket = {
                ...ticket,
                nextScheduledAt: nextDate.toISOString(),
                isFloated: true
            };
            updated.push(modifiedTicket);
            floated.push(ticket.id);
        }
    }
    return { updated, floated };
}
