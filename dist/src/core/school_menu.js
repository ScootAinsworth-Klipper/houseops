import { broadcastAnnouncement } from "../../daemon/announcer_client.js";
export const NOVEMBER_2026_LPPS_MENUS = [
    {
        date: "2026-11-02",
        breakfastOnTheGo: "Pancake Minis",
        breakfastTraditional: "Buttermilk Pancakes",
        lunch: "Kickin' Meatballs, Mashed Potatoes, Steamed Mixed Veggies, Roll",
        note: ""
    },
    {
        date: "2026-11-03",
        breakfastOnTheGo: "",
        breakfastTraditional: "",
        lunch: "",
        note: "Election Day - No School"
    },
    {
        date: "2026-11-04",
        breakfastOnTheGo: "Buttermilk Sausage Biscuit",
        breakfastTraditional: "Buttermilk Sausage Biscuit",
        lunch: "Cheesy Nachos, Taco Meat, Refried Beans, Salsa",
        note: ""
    },
    {
        date: "2026-11-05",
        breakfastOnTheGo: "Breakfast Pizza",
        breakfastTraditional: "Breakfast Pizza",
        lunch: "Chicken Teriyaki, Jasmine Rice, Eggroll w/ Sweet & Sour Sauce (**Middle/High), Carrot Sticks & Ranch Dip, Veggie Juice (***Elementary)",
        note: ""
    },
    {
        date: "2026-11-06",
        breakfastOnTheGo: "Grilled Cheese Sandwich",
        breakfastTraditional: "Grilled Cheese Sandwich",
        lunch: "Hamburger or Chicken Sandwich, French Fries, Relish Cup",
        note: ""
    },
    {
        date: "2026-11-09",
        breakfastOnTheGo: "Buttermilk Chicken Biscuit",
        breakfastTraditional: "Buttermilk Chicken Biscuit",
        lunch: "Cheesy Bread, Marinara Sauce, Green Beans, Carrot Sticks & Ranch Dip",
        note: ""
    },
    {
        date: "2026-11-10",
        breakfastOnTheGo: "Chorizo Sunrise Stick",
        breakfastTraditional: "Chorizo Sunrise Stick",
        lunch: "Pizza, Corn, Veggie Juice",
        note: ""
    },
    {
        date: "2026-11-11",
        breakfastOnTheGo: "Pancake & Sausage Sandwich",
        breakfastTraditional: "Pancake on a Stick",
        lunch: "Turkey & Dressing w/ Brown Gravy, Fluffy Yeast Roll, Sweet Peas & Yams, Fall Fruit Cup",
        note: ""
    },
    {
        date: "2026-11-12",
        breakfastOnTheGo: "Cereal Bar",
        breakfastTraditional: "Breakfast Pizza",
        lunch: "Corn Dog, French Fries, Fresh Broccoli & Ranch Dip",
        note: "Early Dismissal"
    },
    {
        date: "2026-11-13",
        breakfastOnTheGo: "Chocolate Chip BeneFIT Bar",
        breakfastTraditional: "Chocolate Chip BeneFIT Bar",
        lunch: "Pork Chop, Cheesy Potatoes, Black Eyed Peas, Roll",
        note: "World Kindness Day"
    },
    {
        date: "2026-11-16",
        breakfastOnTheGo: "Cinnamon Filled Breakfast Pastry",
        breakfastTraditional: "Grits & Buttered Toast",
        lunch: "Chicken Strips, Mashed Potatoes & Gravy, Green Beans, Roll (*Highschool only)",
        note: ""
    },
    {
        date: "2026-11-17",
        breakfastOnTheGo: "Ham & Swiss Croissant",
        breakfastTraditional: "Ham & Swiss Croissant",
        lunch: "Orange Chicken, Vegetable Fried Rice, Steamed Broccoli, Cucumber & Tomato Salad, Sugar Cookie",
        note: ""
    },
    {
        date: "2026-11-18",
        breakfastOnTheGo: "Buttermilk Sausage Biscuit",
        breakfastTraditional: "Buttermilk Sausage Biscuit",
        lunch: "Pasta & Meat Sauce, Corn, Garlic Roll",
        note: ""
    },
    {
        date: "2026-11-19",
        breakfastOnTheGo: "Breakfast Pizza",
        breakfastTraditional: "Breakfast Pizza",
        lunch: "BBQ Chicken Drumstick, Mac & Cheese, Black Eyed Peas, Steamed Mixed Veggies",
        note: ""
    },
    {
        date: "2026-11-20",
        breakfastOnTheGo: "Frosted Toaster Pastry or Fruit & Yogurt Parfait",
        breakfastTraditional: "Frosted Toaster Pastry or Fruit & Yogurt Parfait",
        lunch: "Chicken Sandwich, French Fries, Veggie Juice (*Highschool only)",
        note: ""
    },
    { date: "2026-11-23", breakfastOnTheGo: "", breakfastTraditional: "", lunch: "", note: "Thanksgiving Break - No School" },
    { date: "2026-11-24", breakfastOnTheGo: "", breakfastTraditional: "", lunch: "", note: "Thanksgiving Break - No School" },
    { date: "2026-11-25", breakfastOnTheGo: "", breakfastTraditional: "", lunch: "", note: "Thanksgiving Break - No School" },
    { date: "2026-11-26", breakfastOnTheGo: "", breakfastTraditional: "", lunch: "", note: "Thanksgiving Break - No School" },
    { date: "2026-11-27", breakfastOnTheGo: "", breakfastTraditional: "", lunch: "", note: "Thanksgiving Break - No School" },
    {
        date: "2026-11-30",
        breakfastOnTheGo: "French Toast Sticks",
        breakfastTraditional: "French Toast Sticks",
        lunch: "Red Beans & Rice, Cornbread, Mustard Greens, Sweet Potatoes, Juice Rush Cup",
        note: ""
    }
];
export function ensureInitialSchoolMenus(db) {
    const existing = db.getSchoolMenus("2026-11");
    if (existing.length === 0) {
        db.upsertSchoolMenus(NOVEMBER_2026_LPPS_MENUS);
    }
}
export function getLocalDateStr(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Chicago",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(now);
    const y = parts.find(p => p.type === "year")?.value || "2026";
    const m = parts.find(p => p.type === "month")?.value || "01";
    const d = parts.find(p => p.type === "day")?.value || "01";
    return `${y}-${m}-${d}`;
}
function getLocalHourMinute(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Chicago",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    }).formatToParts(now);
    const h = parseInt(parts.find(p => p.type === "hour")?.value || "0", 10);
    const m = parseInt(parts.find(p => p.type === "minute")?.value || "0", 10);
    return { hour: isNaN(h) ? now.getHours() : h, minute: isNaN(m) ? now.getMinutes() : m };
}
function cleanForSpeech(text) {
    return (text || "")
        .replace(/\*\*\*/g, "")
        .replace(/\*\*/g, "")
        .replace(/\*/g, "")
        .replace(/\bw\//gi, "with ")
        .replace(/\s+/g, " ")
        .trim();
}
function formatSpokenDate(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    return dt.toLocaleDateString("en-US", {
        timeZone: "UTC",
        weekday: "long",
        month: "long",
        day: "numeric"
    });
}
export function resolveActiveSchoolMenu(db, now = new Date()) {
    ensureInitialSchoolMenus(db);
    const todayDate = getLocalDateStr(now);
    const all = db.getSchoolMenus();
    const todayEntry = all.find(e => e.date === todayDate) || null;
    const { hour } = getLocalHourMinute(now);
    // If after 2 PM or weekend/no-school day, also look up the next upcoming school day with lunch
    const nextSchoolEntry = all.find(e => {
        if (!e.lunch)
            return false;
        if (e.date > todayDate)
            return true;
        if (e.date === todayDate && hour < 14)
            return true;
        return false;
    }) || null;
    return { todayDate, todayEntry, nextSchoolEntry };
}
export function buildMenuSpeech(db, options = {}) {
    const now = options.now || new Date();
    const { todayDate, todayEntry, nextSchoolEntry } = resolveActiveSchoolMenu(db, now);
    const meal = options.meal || "lunch";
    const { hour } = getLocalHourMinute(now);
    let targetEntry = null;
    let dayLabel = "Today";
    if (options.target === "today") {
        targetEntry = todayEntry;
        dayLabel = "Today";
    }
    else if (options.target === "tomorrow") {
        const all = db.getSchoolMenus();
        targetEntry = all.find(e => e.date > todayDate && (e.lunch || e.note)) || null;
        dayLabel = targetEntry ? `on ${formatSpokenDate(targetEntry.date)}` : "tomorrow";
    }
    else {
        // Auto: if today has school lunch and it's before 2 PM, use today; otherwise explain & give next school day
        if (todayEntry && todayEntry.lunch && hour < 14) {
            targetEntry = todayEntry;
            dayLabel = "Today";
        }
        else if (todayEntry && todayEntry.note && !todayEntry.lunch) {
            targetEntry = nextSchoolEntry;
            const prefix = `There is no school today because of ${todayEntry.note}.`;
            if (!targetEntry) {
                return { message: `${prefix} The next school lunch menu has not been loaded yet.`, entry: null };
            }
            const lunchSpeech = cleanForSpeech(targetEntry.lunch);
            return {
                message: `${prefix} Next school day, ${formatSpokenDate(targetEntry.date)}, lunch will be ${lunchSpeech}, with fruit and milk.`,
                entry: targetEntry
            };
        }
        else {
            targetEntry = nextSchoolEntry;
            dayLabel = targetEntry && targetEntry.date !== todayDate
                ? `on ${formatSpokenDate(targetEntry.date)}`
                : "Today";
        }
    }
    if (!targetEntry) {
        return {
            message: "I do not have the upcoming school menu loaded yet. Ask Dad to import this month's school menu in HouseOps!",
            entry: null
        };
    }
    if (!targetEntry.lunch && targetEntry.note) {
        return {
            message: `No school lunch ${dayLabel.toLowerCase()} for ${targetEntry.note}.`,
            entry: targetEntry
        };
    }
    const greeting = hour < 12 ? "Good morning Sawyer! " : "";
    const lunchText = cleanForSpeech(targetEntry.lunch);
    const otg = cleanForSpeech(targetEntry.breakfastOnTheGo);
    const trad = cleanForSpeech(targetEntry.breakfastTraditional);
    const isToday = dayLabel === "Today";
    const breakfastSummary = otg && trad
        ? (otg.toLowerCase() === trad.toLowerCase()
            ? `${otg}`
            : `${trad} for traditional breakfast, or ${otg} on the go`)
        : (trad || otg);
    if (meal === "breakfast") {
        const bText = breakfastSummary || "not listed";
        return {
            message: `${greeting}${isToday ? "Today's" : `For ${formatSpokenDate(targetEntry.date)},`} school breakfast is ${bText}, plus fruit juice and milk.`,
            entry: targetEntry
        };
    }
    if (meal === "all" || (meal === "lunch" && isToday && hour < 9 && breakfastSummary)) {
        return {
            message: `${greeting}${isToday ? "Today's" : `Next school day, ${formatSpokenDate(targetEntry.date)},`} lunch is ${lunchText}, with fruit and milk. And for breakfast: ${breakfastSummary}.`,
            entry: targetEntry
        };
    }
    return {
        message: `${greeting}${isToday ? "Today's" : `Next school day, ${formatSpokenDate(targetEntry.date)},`} school lunch is ${lunchText}, with fruit and milk.`,
        entry: targetEntry
    };
}
export function parseMenuVoiceQuery(rawText) {
    const clean = (rawText || "").toLowerCase().trim();
    if (!clean)
        return null;
    const isMenuIntent = /\b(school lunch|lunch check|check lunch|what'?s for lunch|what is for lunch|for lunch|school breakfast|breakfast check|what'?s for breakfast|what is for breakfast|for breakfast|school menu|menu check|cafeteria|lunch menu|breakfast menu)\b/i.test(clean) ||
        clean === "lunch" ||
        clean === "breakfast" ||
        clean === "menu";
    if (!isMenuIntent)
        return null;
    const hasLunch = /\blunch\b/i.test(clean);
    const hasBreakfast = /\bbreakfast\b/i.test(clean);
    const meal = hasBreakfast && hasLunch ? "all" : hasBreakfast ? "breakfast" : hasLunch ? "lunch" : "all";
    const target = /\btomorrow\b/i.test(clean) ? "tomorrow" : "auto";
    return { meal, target };
}
export async function announceSchoolMenu(db, options = {}) {
    const { message, entry } = buildMenuSpeech(db, options);
    const speakers = options.speakers?.length
        ? options.speakers
        : ["Kitchen display", "Living Room display", "Sawyer's Mini"];
    const success = await broadcastAnnouncement(message, speakers, undefined, options.bypassQuietHours !== false);
    return { success, message, entry };
}
