let tickets = [];
let schoolMenuState = { todayDate: "", todayEntry: null, nextSchoolEntry: null, items: [] };
let pendingPhotoTicketId = null;
let currentProfile = localStorage.getItem("houseops_profile") || "Dad";
let dadFilter = "All";
let currentTab = "active";
const DAD_PIN = "1986";

function matchesProfileFilter(t) {
  const assignee = t.assignee || "Dad";
  if (currentProfile === "Camden" || currentProfile === "Sawyer") {
    return assignee === currentProfile || assignee === "Family";
  }
  if (currentProfile === "Dad") {
    return dadFilter === "All" || assignee === dadFilter;
  }
  return true; // Shared Family Display shows all tasks
}

function applyProfileUI() {
  const btn = document.getElementById("btnProfileSwitch");
  if (btn) {
    if (currentProfile === "Camden") {
      btn.innerHTML = "👦 Camden";
      btn.style.background = "#1e1b4b";
      btn.style.color = "#c7d2fe";
      btn.style.borderColor = "#4338ca";
    } else if (currentProfile === "Sawyer") {
      btn.innerHTML = "👧 Sawyer";
      btn.style.background = "#3b0764";
      btn.style.color = "#f5d0fe";
      btn.style.borderColor = "#a855f7";
    } else if (currentProfile === "Family") {
      btn.innerHTML = "👨‍👩‍👧‍👦 Shared";
      btn.style.background = "#451a03";
      btn.style.color = "#fcd34d";
      btn.style.borderColor = "#d97706";
    } else {
      btn.innerHTML = "👨 Dad";
      btn.style.background = "#064e3b";
      btn.style.color = "#6ee7b7";
      btn.style.borderColor = "#059669";
    }
  }

  const btnNewTask = document.getElementById("btnNewTask");
  if (btnNewTask) {
    btnNewTask.style.display = currentProfile === "Dad" ? "inline-flex" : "none";
  }

  const filterBar = document.getElementById("dadFilterBar");
  if (filterBar) {
    filterBar.style.display = (currentProfile === "Dad" && currentTab !== "audit") ? "flex" : "none";
  }

  if (window.HouseOpsNative && typeof window.HouseOpsNative.setProfile === "function") {
    try { window.HouseOpsNative.setProfile(currentProfile); } catch (_) {}
  }

  renderTickets();
  updateCounts();
  if (currentTab === "audit") loadAuditLog();
}

function setDadFilter(filterVal) {
  dadFilter = filterVal;
  document.querySelectorAll("#dadFilterBar .speaker-chip").forEach(chip => {
    chip.classList.toggle("active", chip.dataset.filter === filterVal);
  });
  renderTickets();
  updateCounts();
  if (currentTab === "audit") loadAuditLog();
}

function openProfileModal(isFirstRun = false) {
  const closeBtn = document.getElementById("btnCloseProfileModal");
  if (closeBtn) closeBtn.style.display = isFirstRun ? "none" : "inline-flex";
  document.getElementById("dadPinBox").style.display = "none";
  document.getElementById("dadPinError").style.display = "none";
  document.getElementById("inpDadPin").value = "";
  document.getElementById("profileModal").classList.add("open");
}

function closeProfileModal() {
  document.getElementById("profileModal").classList.remove("open");
}

function selectProfileOption(profile) {
  currentProfile = profile;
  localStorage.setItem("houseops_profile", profile);
  closeProfileModal();
  applyProfileUI();
}

function showDadPinPrompt() {
  if (currentProfile === "Dad" && localStorage.getItem("houseops_profile") === "Dad") {
    closeProfileModal();
    return;
  }
  const box = document.getElementById("dadPinBox");
  const inp = document.getElementById("inpDadPin");
  document.getElementById("dadPinError").style.display = "none";
  inp.value = "";
  box.style.display = "flex";
  setTimeout(() => {
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
    inp.focus();
  }, 100);
}

function verifyDadPin() {
  const pin = document.getElementById("inpDadPin").value.trim();
  if (pin === DAD_PIN) {
    selectProfileOption("Dad");
  } else {
    const err = document.getElementById("dadPinError");
    err.style.display = "block";
    document.getElementById("inpDadPin").value = "";
  }
}

let quietHoursState = {
  enabled: true,
  forceMute: false,
  startTime: "22:00",
  endTime: "06:00",
  isCurrentlyQuiet: false
};

function formatShortTime(hhmm) {
  const [hStr, mStr] = (hhmm || "00:00").split(":");
  const h = parseInt(hStr, 10) || 0;
  const m = parseInt(mStr, 10) || 0;
  const suffix = h >= 12 ? "p" : "a";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}

function updateQuietHoursChip() {
  const chip = document.getElementById("chipQuiet");
  const textEl = document.getElementById("chipQuietText");
  if (!chip || !textEl) return;

  if (quietHoursState.forceMute) {
    chip.classList.add("active");
    textEl.innerText = "Quiet: Muted";
  } else if (quietHoursState.isCurrentlyQuiet) {
    chip.classList.add("active");
    textEl.innerText = "Quiet: ON";
  } else if (quietHoursState.enabled) {
    chip.classList.remove("active");
    textEl.innerText = `Quiet: ${formatShortTime(quietHoursState.startTime)}–${formatShortTime(quietHoursState.endTime)}`;
  } else {
    chip.classList.remove("active");
    textEl.innerText = "Quiet: Off";
  }
}

async function loadQuietHours() {
  try {
    const res = await fetch("/api/settings/quiet-hours");
    if (!res.ok) return;
    quietHoursState = await res.json();
    updateQuietHoursChip();
  } catch (_) {}
}

function openQuietHoursModal() {
  if (currentProfile !== "Dad") {
    openProfileModal();
    showDadPinPrompt();
    return;
  }

  document.getElementById("chipForceMute").classList.toggle("active", Boolean(quietHoursState.forceMute));
  document.getElementById("chipQuietEnabled").classList.toggle("active", Boolean(quietHoursState.enabled));
  document.getElementById("inpQuietStart").value = quietHoursState.startTime || "22:00";
  document.getElementById("inpQuietEnd").value = quietHoursState.endTime || "06:00";

  const banner = document.getElementById("quietModalStatusBanner");
  if (quietHoursState.isCurrentlyQuiet) {
    banner.innerText = "🔇 Speakers are currently MUTED (Quiet Hours active).";
    banner.style.borderColor = "var(--purple)";
    banner.style.color = "#f5d0fe";
    banner.style.background = "rgba(168, 85, 247, 0.15)";
  } else {
    banner.innerText = "🔊 Voice broadcasts are currently ACTIVE.";
    banner.style.borderColor = "var(--green)";
    banner.style.color = "#6ee7b7";
    banner.style.background = "rgba(34, 197, 94, 0.12)";
  }

  document.getElementById("quietHoursModal").classList.add("open");
}

function closeQuietHoursModal() {
  document.getElementById("quietHoursModal").classList.remove("open");
}

async function saveQuietHours() {
  const forceMute = document.getElementById("chipForceMute").classList.contains("active");
  const enabled = document.getElementById("chipQuietEnabled").classList.contains("active");
  const startTime = document.getElementById("inpQuietStart").value || "22:00";
  const endTime = document.getElementById("inpQuietEnd").value || "06:00";

  try {
    const res = await fetch("/api/settings/quiet-hours", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled, forceMute, startTime, endTime })
    });
    if (!res.ok) throw new Error("Failed to save quiet hours");
    quietHoursState = await res.json();
    updateQuietHoursChip();
    closeQuietHoursModal();
  } catch (e) {
    alert("Error saving quiet hours: " + e.message);
  }
}

async function loadTickets() {
  try {
    const res = await fetch("/api/tickets");
    if (!res.ok) throw new Error("Failed to load tickets");
    tickets = await res.json();
    renderTickets();
    updateCounts();
    loadQuietHours();
  } catch (e) {
    console.error("Error loading tickets:", e);
  }
}

async function loadAuditLog() {
  try {
    const res = await fetch("/api/audit");
    if (!res.ok) throw new Error("Failed to load audit");
    const audits = await res.json();
    renderAudit(audits);
  } catch (e) {
    console.error("Error loading audit log:", e);
  }
}

function updateCounts() {
  const visible = tickets.filter(matchesProfileFilter);
  const active = visible.filter(t => t.recurrence.type === "OnDemand" || (t.currentStatus !== "Verified" && !t.isFloated)).length;
  const floated = visible.filter(t => t.recurrence.type !== "OnDemand" && t.currentStatus !== "Verified" && t.isFloated).length;
  document.getElementById("countActive").innerText = active;
  document.getElementById("countFloated").innerText = floated;
}

function renderSchoolMenuBanner() {
  const entry = schoolMenuState.nextSchoolEntry || schoolMenuState.todayEntry;
  if (!entry) return "";

  const isToday = entry.date === schoolMenuState.todayDate;
  const parts = entry.date.split("-").map(Number);
  const dt = new Date(parts[0], parts[1] - 1, parts[2]);
  const dayTitle = isToday
    ? "Today's School Menu"
    : `Next School Day • ${dt.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}`;

  const otg = entry.breakfastOnTheGo || "—";
  const trad = entry.breakfastTraditional || "—";
  const bfastLine = otg === trad
    ? escapeHtml(otg)
    : `<span style="color:var(--text-muted);">On-Go:</span> ${escapeHtml(otg)} &nbsp;|&nbsp; <span style="color:var(--text-muted);">Trad:</span> ${escapeHtml(trad)}`;
  const lunchLine = entry.lunch ? escapeHtml(entry.lunch) : (entry.note ? `🎉 ${escapeHtml(entry.note)}` : "—");

  return `
    <div class="ticket-card" style="grid-column: 1 / -1; border-left:3px solid #f59e0b; background:linear-gradient(135deg, rgba(245,158,11,0.08), var(--bg-card)); padding:12px 14px;">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
        <div style="font-size:13px; font-weight:800; color:#fbbf24;">🍎 ${dayTitle}</div>
        <div style="display:flex; gap:6px;">
          <button class="btn" onclick="speakSchoolMenu(this)" style="flex:0; padding:4px 9px; font-size:11px; color:#fbbf24; border-color:rgba(245,158,11,0.4); background:rgba(245,158,11,0.12);">
            🔊 Ask / Read Aloud
          </button>
          <button class="btn" onclick="openSchoolMenuModal()" style="flex:0; padding:4px 9px; font-size:11px; background:var(--bg-card-alt);">
            📅 Full Month
          </button>
        </div>
      </div>
      <div style="display:flex; flex-direction:column; gap:3px; margin-top:4px; font-size:12px; line-height:1.35;">
        <div><strong style="color:#fcd34d;">🍽️ Lunch:</strong> <span style="color:var(--text-main);">${lunchLine}</span></div>
        <div><strong style="color:#93c5fd;">🥐 Breakfast:</strong> <span style="color:var(--text-main);">${bfastLine}</span></div>
      </div>
    </div>
  `;
}

function renderTickets() {
  const activeGrid = document.getElementById("viewActive");
  const floatedGrid = document.getElementById("viewFloated");

  const visible = tickets.filter(matchesProfileFilter);
  const activeTickets = visible.filter(t => t.recurrence.type === "OnDemand" || (t.currentStatus !== "Verified" && !t.isFloated));
  const floatedTickets = visible.filter(t => t.recurrence.type !== "OnDemand" && t.currentStatus !== "Verified" && t.isFloated);

  const menuBannerHtml = (currentProfile === "Sawyer" || currentProfile === "Dad" || currentProfile === "Family")
    ? renderSchoolMenuBanner()
    : "";

  activeGrid.innerHTML = activeTickets.length
    ? menuBannerHtml + activeTickets.map(renderTicketCard).join("")
    : menuBannerHtml + `<div style="color:var(--text-muted); padding:30px; text-align:center;">All caught up! Zero pending work orders. ⚡</div>`;

  floatedGrid.innerHTML = floatedTickets.length
    ? floatedTickets.map(renderTicketCard).join("")
    : `<div style="color:var(--text-muted); padding:30px; text-align:center;">No floated tasks. Operations on schedule! 🎯</div>`;

  renderCalendar();
}

let weekOffsetDays = 0;

function changeWeekOffset(delta) {
  if (delta === 0) weekOffsetDays = 0;
  else weekOffsetDays += delta;
  renderCalendar();
}

function doesTicketOccurOnDate(t, targetDate) {
  const rec = t.recurrence || {};
  const type = rec.type;
  if (type === "OnDemand") return false;

  const dow = targetDate.getDay(); // 0=Sun .. 6=Sat
  if (type === "Daily") return true;
  if (type === "Weekdays") return dow >= 1 && dow <= 5;
  if (type === "Weekends") return dow === 0 || dow === 6;
  if (type === "DaysOfWeek") {
    return Array.isArray(rec.daysOfWeek) && rec.daysOfWeek.includes(dow);
  }

  const nextSched = new Date(t.nextScheduledAt);
  const startOfTarget = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
  const startOfSched = new Date(nextSched.getFullYear(), nextSched.getMonth(), nextSched.getDate());
  const diffDays = Math.round((startOfTarget - startOfSched) / (1000 * 60 * 60 * 24));

  if (type === "Weekly") {
    return dow === nextSched.getDay();
  }
  if (type === "IntervalDays") {
    const interval = rec.intervalDays || 1;
    return diffDays >= 0 && diffDays % interval === 0;
  }
  return diffDays === 0;
}

function formatTaskTime(h, m) {
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m || 0).padStart(2, "0")} ${suffix}`;
}

function formatDurationTotal(mins) {
  if (mins <= 0) return "0m";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function scrollToCalDay(dayId) {
  const el = document.getElementById(dayId);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function openNewTicketModalForDay(dow) {
  openNewTicketModal();
  document.getElementById("inpRecurrence").value = "DaysOfWeek";
  toggleRecurrenceOptions("DaysOfWeek");
  document.querySelectorAll("#grpDaysOfWeek .day-chip").forEach(c => {
    c.classList.toggle("active", parseInt(c.dataset.day, 10) === dow);
  });
}

function renderCalendar() {
  const calView = document.getElementById("viewCalendar");
  if (!calView) return;

  const visible = tickets.filter(matchesProfileFilter);
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const isAdmin = currentProfile === "Dad";

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(todayMidnight);
    d.setDate(d.getDate() + weekOffsetDays + i);
    const dayTickets = visible
      .filter(t => doesTicketOccurOnDate(t, d))
      .sort((a, b) => {
        const aMin = (a.preferredWindow?.startHour || 0) * 60 + (a.preferredWindow?.startMinute || 0);
        const bMin = (b.preferredWindow?.startHour || 0) * 60 + (b.preferredWindow?.startMinute || 0);
        return aMin - bMin;
      });
    const totalMins = dayTickets.reduce((sum, t) => sum + (t.preferredWindow?.durationMinutes || 30), 0);
    days.push({ date: d, tickets: dayTickets, totalMins });
  }

  const startStr = days[0].date.toLocaleDateString([], { month: "short", day: "numeric" });
  const endStr = days[6].date.toLocaleDateString([], { month: "short", day: "numeric" });

  // 1. Top Week Nav & 7-Day Load Heatmap Strip
  const stripItemsHtml = days.map((dayObj, idx) => {
    const d = dayObj.date;
    const count = dayObj.tickets.length;
    const isToday = d.getTime() === todayMidnight.getTime();
    const dowShort = d.toLocaleDateString([], { weekday: "short" });
    const dayNum = d.getDate();

    let pillBg = "var(--bg-card-alt)";
    let pillBorder = isToday ? "var(--accent)" : "var(--border)";
    let countColor = "var(--green)";
    if (count >= 6) {
      countColor = "var(--red)";
      pillBg = "rgba(239, 68, 68, 0.1)";
      if (!isToday) pillBorder = "rgba(239, 68, 68, 0.4)";
    } else if (count >= 4) {
      countColor = "var(--yellow)";
      pillBg = "rgba(234, 179, 8, 0.1)";
      if (!isToday) pillBorder = "rgba(234, 179, 8, 0.4)";
    }

    return `
      <div onclick="scrollToCalDay('cal-day-${idx}')" style="flex:1; min-width:42px; background:${pillBg}; border:1px solid ${pillBorder}; border-radius:10px; padding:6px 4px; display:flex; flex-direction:column; align-items:center; gap:2px; cursor:pointer;">
        <span style="font-size:10px; font-weight:700; color:${isToday ? "var(--accent)" : "var(--text-muted)"}; text-transform:uppercase;">${isToday ? "TODAY" : dowShort}</span>
        <span style="font-size:13px; font-weight:800; color:var(--text-main);">${dayNum}</span>
        <span style="font-size:11px; font-weight:800; color:${countColor}; margin-top:2px;">${count} <span style="font-size:9px; font-weight:600;">tasks</span></span>
      </div>
    `;
  }).join("");

  // 2. Detailed Day Cards
  const dayCardsHtml = days.map((dayObj, idx) => {
    const d = dayObj.date;
    const count = dayObj.tickets.length;
    const isToday = d.getTime() === todayMidnight.getTime();
    const fullDayLabel = d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });

    let loadBadge;
    if (count === 0) {
      loadBadge = `<span class="badge" style="background:var(--bg-card-alt); color:var(--text-muted); border:1px solid var(--border);">Free Day</span>`;
    } else if (count <= 3) {
      loadBadge = `<span class="badge" style="background:var(--green-soft); color:var(--green); border:1px solid rgba(34,197,94,0.35);">🟢 Light (${count})</span>`;
    } else if (count <= 5) {
      loadBadge = `<span class="badge" style="background:var(--yellow-soft); color:var(--yellow); border:1px solid rgba(234,179,8,0.35);">🟡 Moderate (${count})</span>`;
    } else {
      loadBadge = `<span class="badge" style="background:var(--red-soft); color:var(--red); border:1px solid rgba(239,68,68,0.4);">🔴 Heavy Load (${count})</span>`;
    }

    const addBtn = isAdmin
      ? `<button class="btn" onclick="openNewTicketModalForDay(${d.getDay()})" style="flex:0; padding:4px 8px; font-size:11px; background:var(--bg-card-alt);">+ Add</button>`
      : "";

    const rowsHtml = dayObj.tickets.length === 0
      ? `<div style="font-size:12px; color:var(--text-muted); padding:6px 2px;">No scheduled tasks on this day.</div>`
      : dayObj.tickets.map(t => {
          const timeLabel = formatTaskTime(t.preferredWindow?.startHour || 0, t.preferredWindow?.startMinute || 0);
          const assignee = t.assignee || "Dad";
          let personTag = `👨 Dad`;
          let personColor = "#6ee7b7";
          if (assignee === "Camden" || assignee === "Son") { personTag = "👦 Camden"; personColor = "#c7d2fe"; }
          else if (assignee === "Sawyer") { personTag = "👧 Sawyer"; personColor = "#f5d0fe"; }
          else if (assignee === "Family") { personTag = "👨‍👩‍👧‍👦 Family"; personColor = "#fcd34d"; }

          const isDoneToday = isToday && t.currentStatus === "Verified";
          const statusBadge = isDoneToday
            ? `<span style="font-size:10px; font-weight:700; color:var(--green); background:var(--green-soft); border:1px solid rgba(34,197,94,0.35); padding:2px 6px; border-radius:5px;">✓ Done</span>`
            : "";
          const reopenInlineBtn = (isDoneToday && isAdmin)
            ? `<button class="btn" onclick="event.stopPropagation(); reopenTicket('${t.id}', null, false, this)" style="flex:0; padding:3px 7px; font-size:10px; color:var(--yellow); border-color:rgba(234,179,8,0.4); background:var(--yellow-soft);" title="Mark Not Done / Send Back">↩️ Undo</button>`
            : "";

          const clickAttr = isAdmin ? `onclick="openEditTicketModal('${t.id}')" style="cursor:pointer; display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 10px; background:var(--bg-card-alt); border:1px solid var(--border); border-radius:8px;" title="Tap to edit schedule"` : `style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 10px; background:var(--bg-card-alt); border:1px solid var(--border); border-radius:8px;"`;

          return `
            <div ${clickAttr}>
              <div style="display:flex; align-items:center; gap:8px; min-width:0; flex:1;">
                <span style="font-size:11px; font-weight:700; color:var(--accent); background:rgba(56,189,248,0.12); padding:3px 6px; border-radius:5px; white-space:nowrap;">${timeLabel}</span>
                <span style="font-size:13px; font-weight:600; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; ${isDoneToday ? "text-decoration:line-through; opacity:0.75;" : ""}">${escapeHtml(t.title)}</span>
                ${statusBadge}
              </div>
              <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                ${reopenInlineBtn}
                <span style="font-size:11px; font-weight:700; color:${personColor};">${personTag}</span>
                ${isAdmin ? `<span style="font-size:11px; opacity:0.6;">✏️</span>` : ""}
              </div>
            </div>
          `;
        }).join("");

    const dateIso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const menuForDay = (schoolMenuState.items || []).find(m => m.date === dateIso);
    const menuDayHtml = menuForDay
      ? `<div style="font-size:11px; color:#fcd34d; background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.25); border-radius:7px; padding:5px 8px; margin-bottom:2px;">
           🍎 <strong>School Lunch:</strong> ${escapeHtml(menuForDay.lunch || menuForDay.note || "No School")}
         </div>`
      : "";

    return `
      <div class="ticket-card" id="cal-day-${idx}" style="border-left:${isToday ? "3px solid var(--accent)" : (count >= 6 ? "3px solid var(--red)" : "1px solid var(--border)")};">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:14px; font-weight:800; color:${isToday ? "var(--accent)" : "var(--text-main)"};">${isToday ? `Today • ${fullDayLabel}` : fullDayLabel}</span>
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="font-size:11px; color:var(--text-muted);">${formatDurationTotal(dayObj.totalMins)}</span>
            ${loadBadge}
            ${addBtn}
          </div>
        </div>
        <div style="display:flex; flex-direction:column; gap:6px; margin-top:4px;">
          ${menuDayHtml}
          ${rowsHtml}
        </div>
      </div>
    `;
  }).join("");

  calView.innerHTML = `
    <div style="background:var(--bg-card); border:1px solid var(--border); border-radius:12px; padding:12px; display:flex; flex-direction:column; gap:10px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <button class="btn" onclick="changeWeekOffset(-7)" style="flex:0; padding:6px 10px; font-size:12px;">◀ Prev</button>
        <div style="text-align:center;">
          <div style="font-size:13px; font-weight:800; color:var(--text-main);">📅 ${startStr} – ${endStr}</div>
          <div style="font-size:11px; color:var(--text-muted);">Tap any day to jump • ${isAdmin ? "Tap any task to reschedule" : "Weekly Chore Schedule"}</div>
        </div>
        <div style="display:flex; gap:4px;">
          ${weekOffsetDays !== 0 ? `<button class="btn" onclick="changeWeekOffset(0)" style="flex:0; padding:6px 8px; font-size:11px; color:var(--accent);">Today</button>` : ""}
          <button class="btn" onclick="changeWeekOffset(7)" style="flex:0; padding:6px 10px; font-size:12px;">Next ▶</button>
        </div>
      </div>
      <div style="display:flex; gap:5px; overflow-x:auto;">
        ${stripItemsHtml}
      </div>
    </div>
    ${dayCardsHtml}
  `;
}

function renderTicketCard(t) {
  const catClass = `badge-${t.category.toLowerCase()}`;
  const isP1 = t.priority === "P1-Urgent";
  const p1Badge = isP1 ? `<span class="badge badge-p1">P1 Urgent</span>` : "";
  const floatedBadge = t.isFloated ? `<span class="badge badge-floated">⏳ Floated</span>` : "";
  const reqPhotoBadge = t.requirePhoto ? `<span class="badge" style="background:#064e3b; color:#6ee7b7; border:1px solid #059669;">📸 Photo Req</span>` : "";
  const assignee = t.assignee || "Dad";
  let assigneeBadge;
  if (assignee === "Sawyer") {
    assigneeBadge = `<span class="badge" style="background:#3b0764; color:#f5d0fe; border:1px solid #a855f7;">👧 Sawyer</span>`;
  } else if (assignee === "Camden" || assignee === "Son") {
    assigneeBadge = `<span class="badge" style="background:#1e1b4b; color:#c7d2fe; border:1px solid #4338ca;">👦 Camden</span>`;
  } else if (assignee === "Dad") {
    assigneeBadge = `<span class="badge" style="background:#064e3b; color:#6ee7b7; border:1px solid #059669;">👨 Dad</span>`;
  } else if (assignee === "Family") {
    assigneeBadge = `<span class="badge" style="background:#451a03; color:#fcd34d; border:1px solid #d97706;">👨‍👩‍👧‍👦 Family</span>`;
  } else {
    assigneeBadge = `<span class="badge" style="background:#1e1b4b; color:#c7d2fe; border:1px solid #4338ca;">👤 ${escapeHtml(assignee)}</span>`;
  }

  const isOnDemand = t.recurrence.type === "OnDemand";
  let recLabel = t.recurrence.type;
  if (isOnDemand) recLabel = "⚡ On-Demand";
  else if (t.recurrence.type === "Weekdays") recLabel = "Mon - Fri";
  else if (t.recurrence.type === "Weekends") recLabel = "Sat - Sun";
  else if (t.recurrence.type === "DaysOfWeek" && t.recurrence.daysOfWeek) {
    const dayNames = ["Su", "M", "Tu", "W", "Th", "F", "Sa"];
    recLabel = t.recurrence.daysOfWeek.map(d => dayNames[d]).join(",");
  }

  const schedDate = new Date(t.nextScheduledAt);
  const timeStr = schedDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const dateStr = schedDate.toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric" });

  let schedDisplay;
  if (isOnDemand) {
    const lastDoneStr = t.lastCompletedAt
      ? ` • Last completed: ${new Date(t.lastCompletedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
      : "";
    schedDisplay = `<span>⚡</span> Ready on demand • Tap Broadcast to alert house${lastDoneStr}`;
  } else {
    schedDisplay = `<span>🕒</span> Window: ${dateStr} at ${timeStr} (${t.preferredWindow.durationMinutes}m)`;
  }

  const isAdmin = currentProfile === "Dad";
  const mustUsePhoto = !isAdmin && Boolean(t.requirePhoto);
  const doneBtnHtml = mustUsePhoto
    ? ""
    : `<button class="btn btn-done" onclick="quickCompleteTicket('${t.id}')">✓ Done</button>`;
  const nudgeBtnHtml = isAdmin
    ? `<button class="btn btn-nudge" onclick="nudgeTicket('${t.id}', this)" title="Broadcast voice reminder right now">📢 Nudge</button>`
    : "";
  const editBtnHtml = isAdmin
    ? `<button class="btn" onclick="openEditTicketModal('${t.id}')" style="flex:0; padding:8px 10px; background:var(--bg-card-alt); border-color:var(--border);" title="Edit Task">✏️</button>`
    : "";

  return `
    <div class="ticket-card ${t.isFloated ? "floated" : ""} ${isP1 ? "p1" : ""}" id="card-${t.id}">
      <div class="ticket-header">
        <div class="ticket-title">${escapeHtml(t.title)}</div>
      </div>
      <div class="badge-row">
        <span class="badge ${catClass}">${t.category}</span>
        ${assigneeBadge}
        ${p1Badge}
        ${floatedBadge}
        ${reqPhotoBadge}
        <span class="badge badge-general">${recLabel}</span>
      </div>
      <div class="ticket-schedule">
        ${schedDisplay}
      </div>
      <div class="card-actions">
        ${isOnDemand
          ? `<button class="btn btn-nudge" onclick="nudgeTicket('${t.id}', this)" title="Broadcast voice reminder right now">
               📢 Broadcast Now
             </button>
             ${doneBtnHtml}
             <button class="btn btn-verify" onclick="triggerCameraCapture('${t.id}')">
               📸 Proof
             </button>`
          : `<button class="btn btn-verify" onclick="triggerCameraCapture('${t.id}')">
               📸 Verify
             </button>
             ${doneBtnHtml}
             ${nudgeBtnHtml}`
        }
        ${editBtnHtml}
      </div>
    </div>
  `;
}

function renderAudit(audits) {
  const auditView = document.getElementById("viewAudit");
  if (!audits.length) {
    auditView.innerHTML = `<div style="color:var(--text-muted); padding:30px; text-align:center;">No verified completions recorded yet. Complete a task or take a photo proof to view history here! ⚡</div>`;
    return;
  }

  auditView.innerHTML = audits.map(a => {
    const d = new Date(a.completedAt);
    const dateStr = `${d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} at ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    const title = a.ticketTitle || a.ticketId;
    const thumb = a.photoPath
      ? `<div style="position:relative; cursor:pointer; flex-shrink:0;" onclick="openPhotoViewer('${a.photoPath}', '${escapeHtml(title).replace(/'/g, "\\'")}')" title="Tap to view fullscreen & zoom">
           <img src="${a.photoPath}" class="audit-thumb" style="display:block;">
           <span style="position:absolute; bottom:3px; right:3px; background:rgba(0,0,0,0.78); color:#fff; font-size:10px; padding:1px 4px; border-radius:4px; border:1px solid rgba(255,255,255,0.2);">🔍</span>
         </div>`
      : `<div class="audit-thumb" style="display:flex; align-items:center; justify-content:center; font-size:22px; background:var(--bg-card-alt); color:var(--green);">✓</div>`;

    const methodBadge = a.method === "Photo_Verified"
      ? `<span class="badge" style="background:#064e3b; color:#6ee7b7; border:1px solid #059669;">📸 Photo Proof</span>`
      : a.method === "Voice_Closed"
      ? `<span class="badge" style="background:#1e1b4b; color:#c7d2fe; border:1px solid #4338ca;">🎙️ Google Assistant</span>`
      : `<span class="badge" style="background:var(--bg-card-alt); color:var(--text-muted); border:1px solid var(--border);">✓ In-App Done</span>`;

    const assignee = a.actor && a.actor !== "Father" ? a.actor : (a.ticketAssignee || "Family");
    const notesHtml = a.notes
      ? `<div style="margin-top:5px; font-size:12px; color:#e2e8f0; background:rgba(255,255,255,0.05); padding:5px 8px; border-radius:6px; border-left:2px solid var(--accent);">${escapeHtml(a.notes)}</div>`
      : "";

    const isAdmin = currentProfile === "Dad";
    const adminSendBackBtn = isAdmin
      ? `<button class="btn btn-nudge" onclick="reopenTicket('${a.ticketId}', '${a.id}', true, this)" style="flex:0 0 auto; padding:5px 10px; font-size:11px;">
           📢 Send Back & Announce
         </button>`
      : "";
    const actionsHtml = `<div style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap;">
      <button class="btn" onclick="reopenTicket('${a.ticketId}', '${a.id}', false, this)" style="flex:0 0 auto; padding:5px 10px; font-size:11px; color:var(--yellow); border-color:rgba(234,179,8,0.4); background:var(--yellow-soft);">
        ↩️ Mark Not Done
      </button>
      ${adminSendBackBtn}
    </div>`;

    return `
      <div class="audit-item">
        ${thumb}
        <div class="audit-info">
          <div class="audit-title" style="font-weight:700; font-size:14px;">${escapeHtml(title)}</div>
          <div style="display:flex; gap:6px; align-items:center; margin-top:4px; flex-wrap:wrap;">
            ${methodBadge}
            <span class="badge" style="background:rgba(255,255,255,0.06); color:var(--text-muted); border:1px solid var(--border);">👤 ${escapeHtml(assignee)}</span>
          </div>
          ${notesHtml}
          <div class="audit-meta" style="margin-top:4px;">Completed ${dateStr}</div>
          ${actionsHtml}
        </div>
      </div>
    `;
  }).join("");
}

let pendingConfirmCallback = null;

function openConfirmModal({ title, message, confirmText = "Confirm", confirmClass = "btn-primary", confirmStyle = "", showReasonInput = false, onConfirm }) {
  document.getElementById("confirmModalTitle").innerText = title;
  document.getElementById("confirmModalMessage").innerText = message;
  const btn = document.getElementById("btnConfirmAction");
  btn.className = `btn ${confirmClass}`;
  btn.style.cssText = confirmStyle;
  btn.innerText = confirmText;

  const reasonGroup = document.getElementById("confirmReasonGroup");
  const reasonInp = document.getElementById("inpConfirmReason");
  reasonInp.value = "";
  reasonGroup.style.display = showReasonInput ? "flex" : "none";

  pendingConfirmCallback = onConfirm;
  document.getElementById("confirmActionModal").classList.add("open");
}

function closeConfirmModal() {
  document.getElementById("confirmActionModal").classList.remove("open");
  pendingConfirmCallback = null;
}

async function executeConfirmedAction() {
  const cb = pendingConfirmCallback;
  const reason = document.getElementById("inpConfirmReason").value.trim();
  closeConfirmModal();
  if (typeof cb === "function") {
    await cb(reason);
  }
}

async function reopenTicket(ticketId, auditId, announce, btn) {
  const t = tickets.find(x => x.id === ticketId);
  const title = t ? t.title : ticketId;

  openConfirmModal({
    title: announce ? "📢 Send Back & Announce?" : "↩️ Mark Task Not Done?",
    message: announce
      ? `Put "${title}" back into Active Work Orders and announce over the speakers that it needs to be finished?`
      : `Put "${title}" back into Active Work Orders for today?`,
    confirmText: announce ? "📢 Send Back" : "↩️ Mark Not Done",
    confirmClass: announce ? "btn-nudge" : "btn-primary",
    showReasonInput: Boolean(announce),
    onConfirm: async (reason) => {
      const original = btn ? btn.innerText : "";
      if (btn) {
        btn.disabled = true;
        btn.innerText = announce ? "⏳ Sending Back..." : "⏳ Reopening...";
      }
      try {
        let res;
        try {
          res = await fetch(`/api/tickets/${ticketId}/reopen`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              auditId: auditId || undefined,
              announce: Boolean(announce),
              reason: reason || undefined,
              actor: currentProfile
            })
          });
        } catch (_) {
          // Retry once after 1.5s if Wi-Fi or service had a momentary blip
          await new Promise(r => setTimeout(r, 1500));
          res = await fetch(`/api/tickets/${ticketId}/reopen`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              auditId: auditId || undefined,
              announce: Boolean(announce),
              reason: reason || undefined,
              actor: currentProfile
            })
          });
        }
        if (!res.ok) throw new Error("Failed to reopen task");
        await loadTickets();
        await loadAuditLog();
      } catch (e) {
        alert("Error reopening task: " + e.message);
        if (btn) {
          btn.disabled = false;
          btn.innerText = original;
        }
      }
    }
  });
}

let pzScale = 1;
let pzX = 0;
let pzY = 0;
let pzInitialized = false;

function updatePhotoTransform(animate = false) {
  const img = document.getElementById("photoViewerImg");
  const badge = document.getElementById("photoZoomBadge");
  if (!img) return;
  img.style.transition = animate ? "transform 180ms ease-out" : "none";
  img.style.transform = `translate3d(${pzX}px, ${pzY}px, 0) scale(${pzScale})`;
  if (badge) badge.innerText = `${Math.round(pzScale * 100)}%`;
}

function resetPhotoZoom(animate = true) {
  pzScale = 1;
  pzX = 0;
  pzY = 0;
  updatePhotoTransform(animate);
}

function adjustPhotoZoom(delta) {
  pzScale = Math.min(6, Math.max(1, +(pzScale + delta).toFixed(2)));
  if (pzScale === 1) {
    pzX = 0;
    pzY = 0;
  }
  updatePhotoTransform(true);
}

function setupPhotoZoomEngine() {
  if (pzInitialized) return;
  const stage = document.getElementById("photoStage");
  if (!stage) return;
  pzInitialized = true;

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let initialPinchDist = 0;
  let initialScale = 1;
  let lastTapTime = 0;

  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.35 : -0.35;
    adjustPhotoZoom(delta);
  }, { passive: false });

  stage.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
      isDragging = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      initialPinchDist = Math.hypot(dx, dy);
      initialScale = pzScale;
    } else if (e.touches.length === 1) {
      const now = Date.now();
      if (now - lastTapTime < 280) {
        // Double-tap toggles between 1x and 2.5x zoom
        if (pzScale > 1.1) {
          resetPhotoZoom(true);
        } else {
          pzScale = 2.5;
          pzX = 0;
          pzY = 0;
          updatePhotoTransform(true);
        }
        lastTapTime = 0;
        return;
      }
      lastTapTime = now;

      if (pzScale > 1) {
        isDragging = true;
        startX = e.touches[0].clientX - pzX;
        startY = e.touches[0].clientY - pzY;
      }
    }
  }, { passive: true });

  stage.addEventListener("touchmove", (e) => {
    if (e.touches.length === 2 && initialPinchDist > 0) {
      if (e.cancelable) e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const ratio = dist / initialPinchDist;
      pzScale = Math.min(6, Math.max(1, initialScale * ratio));
      if (pzScale === 1) {
        pzX = 0;
        pzY = 0;
      }
      updatePhotoTransform(false);
    } else if (e.touches.length === 1 && isDragging && pzScale > 1) {
      if (e.cancelable) e.preventDefault();
      pzX = e.touches[0].clientX - startX;
      pzY = e.touches[0].clientY - startY;
      updatePhotoTransform(false);
    }
  }, { passive: false });

  stage.addEventListener("touchend", (e) => {
    if (e.touches.length < 2) initialPinchDist = 0;
    if (e.touches.length === 0) isDragging = false;
  }, { passive: true });
}

function openPhotoViewer(src, title) {
  setupPhotoZoomEngine();
  document.getElementById("photoViewerImg").src = src;
  document.getElementById("photoViewerTitle").innerText = `📸 Proof: ${title}`;
  resetPhotoZoom(false);
  document.getElementById("photoViewerModal").classList.add("open");
}

function closePhotoViewer() {
  document.getElementById("photoViewerModal").classList.remove("open");
  resetPhotoZoom(false);
}

let activeRecognition = null;

function openVoiceModal() {
  const inp = document.getElementById("inpVoicePhrase");
  const statusEl = document.getElementById("voiceStatusText");
  inp.value = "";
  statusEl.style.display = "none";
  document.getElementById("voiceModal").classList.add("open");
  setTimeout(() => inp.focus(), 100);

  // If browser supports Web Speech API directly, try starting it
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRec) {
    try {
      activeRecognition = new SpeechRec();
      activeRecognition.lang = "en-US";
      activeRecognition.interimResults = true;
      statusEl.innerText = "🔴 Listening... speak now!";
      statusEl.style.display = "block";

      activeRecognition.onresult = (event) => {
        let transcript = "";
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        inp.value = transcript;
      };
      activeRecognition.onerror = () => {
        statusEl.style.display = "none";
      };
      activeRecognition.onend = () => {
        statusEl.style.display = "none";
      };
      activeRecognition.start();
    } catch (_) {}
  }
}

function closeVoiceModal() {
  if (activeRecognition) {
    try { activeRecognition.stop(); } catch (_) {}
    activeRecognition = null;
  }
  document.getElementById("voiceModal").classList.remove("open");
}

async function submitVoicePhrase() {
  const inp = document.getElementById("inpVoicePhrase");
  const statusEl = document.getElementById("voiceStatusText");
  const btn = document.getElementById("btnVoiceSubmit");
  const text = inp.value.trim();
  if (!text) return;

  btn.disabled = true;
  btn.innerText = "⏳ Matching...";
  statusEl.style.display = "block";
  statusEl.innerText = "Matching task & broadcasting confirmation...";

  try {
    const res = await fetch("/api/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, actor: currentProfile })
    });
    const data = await res.json();
    if (!res.ok) {
      statusEl.innerText = "❌ " + (data.error || "Could not match a task.");
      btn.disabled = false;
      btn.innerText = "✓ Complete Task";
      return;
    }
    if (data.menuQuery) {
      statusEl.innerText = `🍎 ${data.message}`;
      setTimeout(() => {
        closeVoiceModal();
        btn.disabled = false;
        btn.innerText = "✓ Complete Task";
      }, 2200);
      return;
    }
    statusEl.innerText = `✅ Marked '${data.ticket.title}' complete!`;
    await loadTickets();
    await loadAuditLog();
    setTimeout(() => {
      closeVoiceModal();
      btn.disabled = false;
      btn.innerText = "✓ Complete Task";
    }, 1200);
  } catch (e) {
    statusEl.innerText = "❌ Error: " + e.message;
    btn.disabled = false;
    btn.innerText = "✓ Complete Task";
  }
}

// 1-Tap Camera capture
function triggerCameraCapture(ticketId) {
  pendingPhotoTicketId = ticketId;
  const input = document.getElementById("cameraInput");
  input.value = "";
  input.click();
}

async function handlePhotoCaptured(input) {
  if (!input.files || !input.files[0] || !pendingPhotoTicketId) return;
  const file = input.files[0];
  const ticketId = pendingPhotoTicketId;
  pendingPhotoTicketId = null;

  try {
    // Client-side image resize to max 2560px HD at 94% quality
    const resizedBlob = await resizeImage(file, 2560, 2560);
    const formData = new FormData();
    formData.append("photo", resizedBlob, "proof.jpg");

    const res = await fetch(`/api/tickets/${ticketId}/photo?actor=${encodeURIComponent(currentProfile)}`, {
      method: "POST",
      body: formData
    });

    if (!res.ok) throw new Error("Photo upload failed");
    await loadTickets();
  } catch (e) {
    alert("Error uploading photo verification: " + e.message);
  }
}

// Confirmed Quick Complete
function quickCompleteTicket(ticketId) {
  const t = tickets.find(x => x.id === ticketId);
  const title = t ? t.title : "this task";

  openConfirmModal({
    title: "✓ Mark Task Complete?",
    message: `Are you sure "${title}" is completely finished?`,
    confirmText: "✓ Yes, It's Done!",
    confirmClass: "btn-done",
    onConfirm: async () => {
      try {
        const res = await fetch(`/api/tickets/${ticketId}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method: "Quick_Complete", actor: currentProfile })
        });
        if (!res.ok) throw new Error("Complete failed");
        await loadTickets();
      } catch (e) {
        alert("Error completing ticket: " + e.message);
      }
    }
  });
}

// Confirmed Instant Voice Nudge / Broadcast
function nudgeTicket(ticketId, btn) {
  const t = tickets.find(x => x.id === ticketId);
  const title = t ? t.title : "this task";
  const original = btn ? btn.innerText : "";
  const isBroadcast = original.includes("Broadcast");

  openConfirmModal({
    title: "📢 Broadcast Voice Alert?",
    message: `Announce "${title}" over the house speakers right now?`,
    confirmText: isBroadcast ? "📢 Broadcast Now" : "📢 Send Nudge",
    confirmClass: "btn-nudge",
    onConfirm: async () => {
      if (btn) {
        btn.disabled = true;
        btn.innerText = isBroadcast ? "⏳ Speaking..." : "⏳ Calling...";
      }

      try {
        const res = await fetch(`/api/tickets/${ticketId}/nudge`, { method: "POST" });
        const data = await res.json();
        if (btn) btn.innerText = data.success ? (isBroadcast ? "✅ Broadcasted!" : "✅ Nudged!") : "❌ Error";
        await loadTickets();
      } catch (e) {
        if (btn) btn.innerText = "❌ Failed";
      }

      setTimeout(() => {
        if (btn) {
          btn.disabled = false;
          btn.innerText = original;
        }
      }, 3500);
    }
  });
}

function resizeImage(file, maxWidth, maxHeight) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      if (w > maxWidth || h > maxHeight) {
        if (w > h) {
          h = Math.round((h * maxWidth) / w);
          w = maxWidth;
        } else {
          w = Math.round((w * maxHeight) / h);
          h = maxHeight;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => {
        URL.revokeObjectURL(img.src);
        if (blob) resolve(blob);
        else reject(new Error("Canvas blob conversion failed"));
      }, "image/jpeg", 0.94);
    };
    img.onerror = reject;
  });
}

const TAB_ORDER = ["active", "calendar", "floated", "audit"];
const TAB_PANE_IDS = {
  active: "viewActive",
  calendar: "viewCalendar",
  floated: "viewFloated",
  audit: "viewAudit"
};

function switchTab(tab) {
  currentTab = tab;
  try { sessionStorage.setItem("houseops_tab", tab); } catch (_) {}
  document.querySelectorAll(".nav-tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".tab-pane").forEach(p => {
    p.classList.remove("active", "swipe-preview");
    p.style.transition = "";
    p.style.transform = "";
    p.style.top = "";
  });

  const targetPane = document.getElementById(TAB_PANE_IDS[tab]);
  if (targetPane) targetPane.classList.add("active");

  const filterBar = document.getElementById("dadFilterBar");
  if (filterBar) {
    filterBar.style.display = (currentProfile === "Dad" && tab !== "audit") ? "flex" : "none";
  }

  let activeBtn = null;
  if (tab === "active") activeBtn = document.getElementById("tabBtnActive");
  if (tab === "calendar") {
    activeBtn = document.getElementById("tabBtnCalendar");
    renderCalendar();
  }
  if (tab === "floated") activeBtn = document.getElementById("tabBtnFloated");
  if (tab === "audit") {
    activeBtn = document.getElementById("tabBtnAudit");
    loadAuditLog();
  }
  if (activeBtn) {
    activeBtn.classList.add("active");
    try { activeBtn.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" }); } catch (_) {}
  }
}

function openNewTicketModal() {
  document.getElementById("inpEditTicketId").value = "";
  document.getElementById("modalTitle").innerText = "➕ Create House Task";
  document.getElementById("btnSubmitModal").innerText = "Create Task";
  document.getElementById("btnDeleteTicket").style.display = "none";
  document.getElementById("inpTitle").value = "";
  document.getElementById("inpCategory").value = "General";
  document.getElementById("inpAssignee").value = "Camden";
  document.getElementById("inpPriority").value = "P2-Normal";
  document.getElementById("inpTime").value = "06:15";
  document.getElementById("inpRecurrence").value = "Weekdays";
  toggleRecurrenceOptions("Weekdays");
  document.getElementById("chipRequirePhoto").classList.remove("active");
  document.querySelectorAll("#grpDaysOfWeek .day-chip").forEach(c => c.classList.remove("active"));
  document.querySelectorAll("#timingChips .speaker-chip").forEach(c => {
    c.classList.toggle("active", c.dataset.stage === "exact" || c.dataset.stage === "overdue");
  });
  document.querySelectorAll("#speakerChips .speaker-chip").forEach(c => {
    c.classList.toggle("active", c.dataset.speaker === "All Rooms");
  });
  document.getElementById("inpBroadcastMessage").value = "";
  document.getElementById("newTicketModal").classList.add("open");
}

function openEditTicketModal(ticketId) {
  const t = tickets.find(x => x.id === ticketId);
  if (!t) return;

  document.getElementById("inpEditTicketId").value = t.id;
  document.getElementById("modalTitle").innerText = "✏️ Edit House Task";
  document.getElementById("btnSubmitModal").innerText = "Save Changes";
  document.getElementById("btnDeleteTicket").style.display = "inline-block";

  document.getElementById("inpTitle").value = t.title || "";
  document.getElementById("inpCategory").value = t.category || "General";
  document.getElementById("inpAssignee").value = t.assignee || "Dad";
  document.getElementById("inpPriority").value = t.priority || "P2-Normal";

  const hh = String(t.preferredWindow.startHour).padStart(2, "0");
  const mm = String(t.preferredWindow.startMinute || 0).padStart(2, "0");
  document.getElementById("inpTime").value = `${hh}:${mm}`;

  document.getElementById("inpRecurrence").value = t.recurrence.type;
  toggleRecurrenceOptions(t.recurrence.type);
  document.getElementById("chipRequirePhoto").classList.toggle("active", Boolean(t.requirePhoto));

  if (t.recurrence.intervalDays) {
    document.getElementById("inpIntervalDays").value = t.recurrence.intervalDays;
  }

  const allowedDays = t.recurrence.daysOfWeek || [];
  document.querySelectorAll("#grpDaysOfWeek .day-chip").forEach(c => {
    c.classList.toggle("active", allowedDays.includes(parseInt(c.dataset.day, 10)));
  });

  const stages = t.broadcast?.stages || (t.broadcast?.timing ? [t.broadcast.timing] : []);
  document.querySelectorAll("#timingChips .speaker-chip").forEach(c => {
    c.classList.toggle("active", stages.includes(c.dataset.stage));
  });

  const speakers = t.broadcast?.speakers || ["All Rooms"];
  document.querySelectorAll("#speakerChips .speaker-chip").forEach(c => {
    c.classList.toggle("active", speakers.includes(c.dataset.speaker));
  });

  document.getElementById("inpBroadcastMessage").value = t.broadcast?.customMessage || "";
  document.getElementById("newTicketModal").classList.add("open");
}

function deleteCurrentTicket() {
  const id = document.getElementById("inpEditTicketId").value;
  if (!id) return;
  const title = document.getElementById("inpTitle").value || "this task";

  openConfirmModal({
    title: "🗑️ Delete Task?",
    message: `Are you sure you want to permanently delete "${title}"?`,
    confirmText: "🗑️ Delete",
    confirmClass: "",
    confirmStyle: "color:var(--red); border-color:rgba(239, 68, 68, 0.5); background:rgba(239, 68, 68, 0.15);",
    onConfirm: async () => {
      try {
        const res = await fetch(`/api/tickets/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Delete failed");
        closeNewTicketModal();
        await loadTickets();
      } catch (e) {
        alert("Error deleting task: " + e.message);
      }
    }
  });
}

function closeNewTicketModal() {
  document.getElementById("newTicketModal").classList.remove("open");
}

function toggleStageChip(el) {
  el.classList.toggle("active");
}

function toggleRecurrenceOptions(val) {
  const isInterval = val === "IntervalDays";
  const isDaysOfWeek = val === "DaysOfWeek";
  const isOnDemand = val === "OnDemand";

  document.getElementById("grpIntervalDays").style.display = isInterval ? "flex" : "none";
  document.getElementById("grpDaysOfWeek").style.display = isDaysOfWeek ? "flex" : "none";

  const grpTime = document.getElementById("grpTargetTime");
  if (grpTime) grpTime.style.display = isOnDemand ? "none" : "flex";

  const grpTiming = document.getElementById("grpBroadcastTiming");
  if (grpTiming) grpTiming.style.display = isOnDemand ? "none" : "flex";

  const hint = document.getElementById("onDemandBroadcastHint");
  if (hint) hint.style.display = isOnDemand ? "block" : "none";
}

function toggleDayChip(el) {
  el.classList.toggle("active");
}

function toggleSpeakerChip(el) {
  const isAllRooms = el.dataset.speaker === "All Rooms";
  if (isAllRooms) {
    const allChips = document.querySelectorAll("#speakerChips .speaker-chip");
    allChips.forEach(c => {
      if (c !== el) c.classList.remove("active");
    });
    el.classList.toggle("active");
  } else {
    const allRoomsChip = document.querySelector("#speakerChips .speaker-chip[data-speaker='All Rooms']");
    if (allRoomsChip) allRoomsChip.classList.remove("active");
    el.classList.toggle("active");
  }
}

async function submitNewTicket() {
  const editId = document.getElementById("inpEditTicketId").value || undefined;
  const title = document.getElementById("inpTitle").value.trim();
  const category = document.getElementById("inpCategory").value;
  const priority = document.getElementById("inpPriority").value;
  const assignee = document.getElementById("inpAssignee").value;
  const recType = document.getElementById("inpRecurrence").value;
  const intervalDays = parseInt(document.getElementById("inpIntervalDays").value, 10) || 1;
  const timeVal = document.getElementById("inpTime").value || "06:15";
  const [startHour, startMinute] = timeVal.split(":").map(Number);

  if (!title) {
    alert("Please enter a task title.");
    return;
  }

  let daysOfWeek = undefined;
  if (recType === "DaysOfWeek") {
    daysOfWeek = Array.from(document.querySelectorAll("#grpDaysOfWeek .day-chip.active"))
      .map(el => parseInt(el.dataset.day, 10));
    if (daysOfWeek.length === 0) {
      alert("Please select at least one day of the week.");
      return;
    }
  }

  // Calculate first scheduled date
  const now = new Date();
  let nextSched = new Date(now);

  if (recType !== "OnDemand") {
    const isPastTimeToday = now.getHours() > startHour || (now.getHours() === startHour && now.getMinutes() >= startMinute);

    if (isPastTimeToday) {
      nextSched.setDate(nextSched.getDate() + 1);
    }

    let allowedDays = null;
    if (recType === "Weekdays") allowedDays = [1, 2, 3, 4, 5];
    else if (recType === "Weekends") allowedDays = [0, 6];
    else if (recType === "DaysOfWeek") allowedDays = daysOfWeek;

    if (allowedDays) {
      for (let i = 0; i < 7; i++) {
        if (allowedDays.includes(nextSched.getDay())) break;
        nextSched.setDate(nextSched.getDate() + 1);
      }
    }

    nextSched.setHours(startHour, startMinute, 0, 0);
  }

  const activeStages = Array.from(document.querySelectorAll("#timingChips .speaker-chip.active"))
    .map(c => c.dataset.stage);
  const customMessage = document.getElementById("inpBroadcastMessage").value.trim() || undefined;
  const activeSpeakerChips = Array.from(document.querySelectorAll("#speakerChips .speaker-chip.active"));
  const speakers = activeSpeakerChips.length > 0
    ? activeSpeakerChips.map(c => c.dataset.speaker)
    : ["All Rooms"];

  const broadcast = (activeStages.length > 0 || recType === "OnDemand")
    ? { stages: activeStages, speakers, customMessage }
    : undefined;

  const requirePhoto = document.getElementById("chipRequirePhoto").classList.contains("active");

  const payload = {
    id: editId,
    title,
    category,
    priority,
    assignee,
    requirePhoto,
    broadcast,
    recurrence: {
      type: recType,
      intervalDays: recType === "IntervalDays" ? intervalDays : undefined,
      daysOfWeek: recType === "DaysOfWeek" ? daysOfWeek : undefined,
      baseOnCompletion: true
    },
    preferredWindow: {
      startHour: recType === "OnDemand" ? 0 : startHour,
      startMinute: recType === "OnDemand" ? 0 : startMinute,
      durationMinutes: 45
    },
    nextScheduledAt: nextSched.toISOString()
  };

  try {
    const res = await fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("Failed to create ticket");
    closeNewTicketModal();
    document.getElementById("inpTitle").value = "";
    await loadTickets();
  } catch (e) {
    alert("Error creating ticket: " + e.message);
  }
}

async function testVoiceBroadcast() {
  const btn = event?.target;
  const original = btn ? btn.innerText : "";
  if (btn) btn.innerText = "⏳ Speaking...";
  try {
    const res = await fetch("/api/announce", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Hello Scoot! HouseOps voice broadcast is operational across all rooms.", speaker: "All Rooms" })
    });
    const data = await res.json();
    if (btn) btn.innerText = data.success ? "✅ Broadcasted!" : "❌ Failed";
  } catch (e) {
    if (btn) btn.innerText = "❌ Error";
  }
  setTimeout(() => { if (btn) btn.innerText = original; }, 3000);
}

function escapeHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function manualRefresh() {
  const pill = document.getElementById("refreshPill");
  if (pill) {
    pill.classList.add("visible");
  }
  setTimeout(() => {
    window.location.reload();
  }, 250);
}

function setupPullToRefresh() {
  const content = document.getElementById("mainContent");
  if (!content) return;

  let startY = 0;
  let isAtTop = false;

  content.addEventListener("touchstart", (e) => {
    if (content.scrollTop <= 2) {
      startY = e.touches[0].clientY;
      isAtTop = true;
    } else {
      isAtTop = false;
    }
  }, { passive: true });

  content.addEventListener("touchmove", (e) => {
    if (!isAtTop) return;
    const currentY = e.touches[0].clientY;
    const diff = currentY - startY;
    if (diff > 80) {
      isAtTop = false;
      manualRefresh();
    }
  }, { passive: true });
}

function isSwipeIgnoredTarget(target) {
  let el = target;
  while (el && el !== document.body) {
    if (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA") return true;
    const style = window.getComputedStyle(el);
    const ox = style.overflowX;
    if ((ox === "auto" || ox === "scroll") && el.scrollWidth > el.clientWidth + 4) return true;
    el = el.parentElement;
  }
  return false;
}

function setupSwipeNavigation() {
  const container = document.getElementById("mainContent");
  if (!container) return;

  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let startTime = 0;
  let tracking = false;
  let lockedAxis = null;
  let activePane = null;
  let previewPane = null;
  let previewDir = 0;
  let currentIdx = -1;
  let animTimer = null;

  function clearPaneStyles(el) {
    if (!el) return;
    el.classList.remove("swipe-preview");
    el.style.transition = "";
    el.style.transform = "";
    el.style.top = "";
  }

  function resetSwipeState() {
    clearPaneStyles(activePane);
    clearPaneStyles(previewPane);
    tracking = false;
    lockedAxis = null;
    activePane = null;
    previewPane = null;
    previewDir = 0;
    currentIdx = -1;
  }

  container.addEventListener("touchstart", (e) => {
    if (animTimer) { clearTimeout(animTimer); animTimer = null; resetSwipeState(); }
    if (!e.touches || e.touches.length !== 1) { tracking = false; return; }
    if (document.querySelector(".modal-backdrop.open")) { tracking = false; return; }
    if (isSwipeIgnoredTarget(e.target)) { tracking = false; return; }

    activePane = document.getElementById(TAB_PANE_IDS[currentTab]);
    if (!activePane) { tracking = false; return; }
    currentIdx = TAB_ORDER.indexOf(currentTab);
    if (currentIdx === -1) { tracking = false; return; }

    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    lastX = startX;
    startTime = Date.now();
    lockedAxis = null;
    previewPane = null;
    previewDir = 0;
    tracking = true;
  }, { passive: true });

  container.addEventListener("touchmove", (e) => {
    if (!tracking || !e.touches || e.touches.length !== 1) return;
    const x = e.touches[0].clientX;
    const y = e.touches[0].clientY;
    const dx = x - startX;
    const dy = y - startY;
    lastX = x;

    if (!lockedAxis) {
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
      if (Math.abs(dx) > Math.abs(dy) * 1.25) {
        lockedAxis = "x";
      } else {
        lockedAxis = "y";
        tracking = false;
        return;
      }
    }

    if (lockedAxis === "x") {
      if (e.cancelable) e.preventDefault();
      const dir = dx < 0 ? 1 : -1;
      const nextIdx = currentIdx + dir;
      const w = container.clientWidth || window.innerWidth;

      if (nextIdx < 0 || nextIdx >= TAB_ORDER.length) {
        if (previewPane) { clearPaneStyles(previewPane); previewPane = null; previewDir = 0; }
        activePane.style.transition = "none";
        activePane.style.transform = `translate3d(${dx * 0.22}px, 0, 0)`;
        return;
      }

      if (previewDir !== dir) {
        if (previewPane) clearPaneStyles(previewPane);
        const nextTab = TAB_ORDER[nextIdx];
        if (nextTab === "audit") loadAuditLog();
        previewPane = document.getElementById(TAB_PANE_IDS[nextTab]);
        previewDir = dir;
        if (previewPane) {
          previewPane.classList.add("swipe-preview");
          previewPane.style.top = (14 + container.scrollTop) + "px";
        }
      }

      activePane.style.transition = "none";
      activePane.style.transform = `translate3d(${dx}px, 0, 0)`;
      if (previewPane) {
        previewPane.style.transition = "none";
        previewPane.style.transform = `translate3d(${dx + dir * w}px, 0, 0)`;
      }
    }
  }, { passive: false });

  function finishSwipe(cancelled) {
    if (!tracking) return;
    tracking = false;
    if (lockedAxis !== "x" || !activePane) {
      resetSwipeState();
      return;
    }

    const dx = lastX - startX;
    const dt = Date.now() - startTime;
    const dir = dx < 0 ? 1 : -1;
    const nextIdx = currentIdx + dir;
    const w = container.clientWidth || window.innerWidth;
    const canSwitch = !cancelled && nextIdx >= 0 && nextIdx < TAB_ORDER.length && previewPane &&
      (Math.abs(dx) > w * 0.25 || (Math.abs(dx) > 45 && dt < 320));

    const ease = "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)";
    const curActive = activePane;
    const curPreview = previewPane;

    curActive.style.transition = ease;
    if (curPreview) curPreview.style.transition = ease;

    if (canSwitch) {
      curActive.style.transform = `translate3d(${-dir * w}px, 0, 0)`;
      curPreview.style.transform = "translate3d(0, 0, 0)";
      const targetTab = TAB_ORDER[nextIdx];
      animTimer = setTimeout(() => {
        animTimer = null;
        clearPaneStyles(curActive);
        clearPaneStyles(curPreview);
        switchTab(targetTab);
        container.scrollTop = 0;
        activePane = null;
        previewPane = null;
        lockedAxis = null;
      }, 225);
    } else {
      curActive.style.transform = "translate3d(0, 0, 0)";
      if (curPreview) curPreview.style.transform = `translate3d(${dir * w}px, 0, 0)`;
      animTimer = setTimeout(() => {
        animTimer = null;
        clearPaneStyles(curActive);
        clearPaneStyles(curPreview);
        activePane = null;
        previewPane = null;
        lockedAxis = null;
      }, 225);
    }
  }

  container.addEventListener("touchend", () => finishSwipe(false), { passive: true });
  container.addEventListener("touchcancel", () => finishSwipe(true), { passive: true });
}

async function loadSchoolMenu() {
  try {
    const res = await fetch("/api/menu");
    if (res.ok) {
      schoolMenuState = await res.json();
      renderTickets();
    }
  } catch (_) {}
}

async function speakSchoolMenu(btn) {
  const orig = btn ? btn.innerText : "";
  if (btn) { btn.disabled = true; btn.innerText = "⏳ Speaking..."; }
  try {
    const res = await fetch("/api/menu/announce", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meal: "lunch", target: "auto" })
    });
    const data = await res.json();
    if (btn) btn.innerText = "✅ Spoken!";
    if (data.message && !data.success) {
      alert(data.message);
    }
    setTimeout(() => {
      if (btn) { btn.disabled = false; btn.innerText = orig; }
    }, 1500);
  } catch (e) {
    alert("Error announcing menu: " + e.message);
    if (btn) { btn.disabled = false; btn.innerText = orig; }
  }
}

function openSchoolMenuModal() {
  const body = document.getElementById("schoolMenuModalBody");
  const items = schoolMenuState.items || [];
  body.innerHTML = items.length
    ? items.map(m => {
        const parts = m.date.split("-").map(Number);
        const dt = new Date(parts[0], parts[1] - 1, parts[2]);
        const dayStr = dt.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
        const isToday = m.date === schoolMenuState.todayDate;
        const border = isToday ? "1px solid #f59e0b" : "1px solid var(--border)";
        if (!m.lunch && m.note) {
          return `<div style="padding:8px 10px; border-radius:8px; background:var(--bg-card-alt); border:${border}; font-size:12px;">
            <strong style="color:#fbbf24;">${dayStr}:</strong> 🎉 ${escapeHtml(m.note)}
          </div>`;
        }
        return `<div style="padding:8px 10px; border-radius:8px; background:var(--bg-card-alt); border:${border}; font-size:12px; display:flex; flex-direction:column; gap:2px;">
          <div style="font-weight:800; color:${isToday ? "#fbbf24" : "var(--text-main)"};">${dayStr}${m.note ? ` <span style="color:var(--accent); font-weight:600;">(${escapeHtml(m.note)})</span>` : ""}</div>
          <div><span style="color:#fcd34d; font-weight:700;">Lunch:</span> ${escapeHtml(m.lunch)}</div>
          <div><span style="color:#93c5fd; font-weight:700;">Breakfast:</span> ${escapeHtml(m.breakfastTraditional || m.breakfastOnTheGo)}${m.breakfastOnTheGo && m.breakfastTraditional && m.breakfastOnTheGo !== m.breakfastTraditional ? ` / On-Go: ${escapeHtml(m.breakfastOnTheGo)}` : ""}</div>
        </div>`;
      }).join("")
    : `<div style="color:var(--text-muted); font-size:12px;">No school menus loaded yet.</div>`;

  const impPanel = document.getElementById("schoolMenuImportPanel");
  if (impPanel) impPanel.style.display = currentProfile === "Dad" ? "flex" : "none";
  document.getElementById("schoolMenuModal").classList.add("open");
}

function closeSchoolMenuModal() {
  document.getElementById("schoolMenuModal").classList.remove("open");
}

async function importSchoolMenuCsv() {
  const raw = document.getElementById("inpMenuImport").value.trim();
  if (!raw) return;
  const entries = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cols = trimmed.split("|").map(s => s.trim());
    if (cols.length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(cols[0])) {
      entries.push({
        date: cols[0],
        breakfastOnTheGo: cols[1] || "",
        breakfastTraditional: cols[2] || cols[1] || "",
        lunch: cols[3] || "",
        note: cols[4] || ""
      });
    }
  }
  if (!entries.length) {
    alert("Format each line as:\nYYYY-MM-DD | On-The-Go | Traditional | Lunch");
    return;
  }
  const res = await fetch("/api/menu/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries })
  });
  if (res.ok) {
    document.getElementById("inpMenuImport").value = "";
    await loadSchoolMenu();
    openSchoolMenuModal();
  }
}

window.addEventListener("DOMContentLoaded", () => {
  if (!localStorage.getItem("houseops_profile")) {
    openProfileModal(true);
  }
  const urlTab = new URLSearchParams(window.location.search).get("tab");
  const savedTab = urlTab || sessionStorage.getItem("houseops_tab");
  if (savedTab && TAB_ORDER.includes(savedTab)) {
    switchTab(savedTab);
  }
  applyProfileUI();
  loadQuietHours();
  loadSchoolMenu();
  loadTickets();
  setupPullToRefresh();
  setupSwipeNavigation();
  setInterval(loadTickets, 30000); // 30s auto-refresh
});
