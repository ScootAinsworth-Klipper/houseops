import { HouseTicket } from "./types.js";

/**
 * Calculates the next occurrence timestamp for a ticket based on completion time or previous schedule.
 */
export function calculateNextOccurrence(ticket: HouseTicket, referenceDate: Date = new Date()): Date {
  const baseDate = new Date(referenceDate);
  const next = new Date(baseDate);

  switch (ticket.recurrence.type) {
    case "Daily":
      next.setUTCDate(next.getUTCDate() + 1);
      break;
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

  // Anchor to preferred window hour (in UTC)
  next.setUTCHours(ticket.preferredWindow.startHour, 0, 0, 0);
  return next;
}

/**
 * Scans pending tickets to identify any whose scheduled window has passed without completion,
 * floating them forward to the next available designated chore window without duplication.
 */
export function evaluateFloatingTickets(
  tickets: HouseTicket[],
  now: Date = new Date()
): { updated: HouseTicket[]; floated: string[] } {
  const updated: HouseTicket[] = [];
  const floated: string[] = [];

  for (const ticket of tickets) {
    if (ticket.currentStatus !== "Pending") continue;

    const scheduledTime = new Date(ticket.nextScheduledAt);
    const windowEndTime = new Date(scheduledTime.getTime() + ticket.preferredWindow.durationMinutes * 60 * 1000);

    // If window has passed
    if (now.getTime() > windowEndTime.getTime()) {
      const nextWindow = new Date(now);
      // If current time is already past preferred hour today, float to tomorrow; otherwise today
      if (now.getUTCHours() >= ticket.preferredWindow.startHour) {
        nextWindow.setUTCDate(nextWindow.getUTCDate() + 1);
      }
      nextWindow.setUTCHours(ticket.preferredWindow.startHour, 0, 0, 0);

      const modifiedTicket: HouseTicket = {
        ...ticket,
        nextScheduledAt: nextWindow.toISOString(),
        isFloated: true
      };

      updated.push(modifiedTicket);
      floated.push(ticket.id);
    }
  }

  return { updated, floated };
}
