let tickets = [];
let pendingPhotoTicketId = null;

async function loadTickets() {
  try {
    const res = await fetch("/api/tickets");
    if (!res.ok) throw new Error("Failed to load tickets");
    tickets = await res.json();
    renderTickets();
    updateCounts();
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
  const active = tickets.filter(t => t.currentStatus !== "Verified" && !t.isFloated).length;
  const floated = tickets.filter(t => t.currentStatus !== "Verified" && t.isFloated).length;
  document.getElementById("countActive").innerText = active;
  document.getElementById("countFloated").innerText = floated;
}

function renderTickets() {
  const activeGrid = document.getElementById("viewActive");
  const floatedGrid = document.getElementById("viewFloated");

  const activeTickets = tickets.filter(t => t.currentStatus !== "Verified" && !t.isFloated);
  const floatedTickets = tickets.filter(t => t.currentStatus !== "Verified" && t.isFloated);

  activeGrid.innerHTML = activeTickets.length
    ? activeTickets.map(renderTicketCard).join("")
    : `<div style="color:var(--text-muted); padding:30px; text-align:center;">All caught up! Zero pending work orders. ⚡</div>`;

  floatedGrid.innerHTML = floatedTickets.length
    ? floatedTickets.map(renderTicketCard).join("")
    : `<div style="color:var(--text-muted); padding:30px; text-align:center;">No floated tasks. Operations on schedule! 🎯</div>`;
}

function renderTicketCard(t) {
  const catClass = `badge-${t.category.toLowerCase()}`;
  const isP1 = t.priority === "P1-Urgent";
  const p1Badge = isP1 ? `<span class="badge badge-p1">P1 Urgent</span>` : "";
  const floatedBadge = t.isFloated ? `<span class="badge badge-floated">⏳ Floated</span>` : "";
  const assignee = t.assignee || "Dad";
  const assigneeBadge = `<span class="badge" style="background:#1e1b4b; color:#c7d2fe; border:1px solid #4338ca;">👤 ${escapeHtml(assignee)}</span>`;

  let recLabel = t.recurrence.type;
  if (t.recurrence.type === "Weekdays") recLabel = "Mon - Fri";
  else if (t.recurrence.type === "Weekends") recLabel = "Sat - Sun";
  else if (t.recurrence.type === "DaysOfWeek" && t.recurrence.daysOfWeek) {
    const dayNames = ["Su", "M", "Tu", "W", "Th", "F", "Sa"];
    recLabel = t.recurrence.daysOfWeek.map(d => dayNames[d]).join(",");
  }

  const schedDate = new Date(t.nextScheduledAt);
  const timeStr = schedDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const dateStr = schedDate.toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric" });

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
        <span class="badge badge-general">${recLabel}</span>
      </div>
      <div class="ticket-schedule">
        <span>🕒</span> Window: ${dateStr} at ${timeStr} (${t.preferredWindow.durationMinutes}m)
      </div>
      <div class="card-actions">
        <button class="btn btn-verify" onclick="triggerCameraCapture('${t.id}')">
          📸 Verify
        </button>
        <button class="btn btn-done" onclick="quickCompleteTicket('${t.id}')">
          ✓ Done
        </button>
        <button class="btn btn-nudge" onclick="nudgeTicket('${t.id}', this)" title="Broadcast voice reminder right now">
          📢 Nudge
        </button>
        <button class="btn" onclick="openEditTicketModal('${t.id}')" style="flex:0; padding:8px 10px; background:var(--bg-card-alt); border-color:var(--border);" title="Edit Task">
          ✏️
        </button>
      </div>
    </div>
  `;
}

function renderAudit(audits) {
  const auditView = document.getElementById("viewAudit");
  if (!audits.length) {
    auditView.innerHTML = `<div style="color:var(--text-muted); padding:30px; text-align:center;">No verified completions recorded yet.</div>`;
    return;
  }

  auditView.innerHTML = audits.map(a => {
    const d = new Date(a.completedAt);
    const dateStr = `${d.toLocaleDateString()} at ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    const thumb = a.photoPath
      ? `<img src="${a.photoPath}" class="audit-thumb" onclick="window.open('${a.photoPath}')">`
      : `<div class="audit-thumb" style="display:flex; align-items:center; justify-content:center; font-size:20px;">✓</div>`;

    const methodBadge = a.method === "Photo_Verified"
      ? `<span class="badge badge-kitchen">📸 Photo Proof</span>`
      : a.method === "Voice_Closed"
      ? `<span class="badge badge-general">🎙️ Google Assistant</span>`
      : `<span class="badge badge-trash">✓ Quick Done</span>`;

    return `
      <div class="audit-item">
        ${thumb}
        <div class="audit-info">
          <div class="audit-title">${escapeHtml(a.ticketId)}</div>
          <div style="margin-top:3px;">${methodBadge}</div>
          <div class="audit-meta">Verified by ${a.actor || "Father"} • ${dateStr}</div>
        </div>
      </div>
    `;
  }).join("");
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
    // Client-side image resize to max 1600px to keep Pi memory low & uploads fast
    const resizedBlob = await resizeImage(file, 1600, 1600);
    const formData = new FormData();
    formData.append("photo", resizedBlob, "proof.jpg");

    const res = await fetch(`/api/tickets/${ticketId}/photo`, {
      method: "POST",
      body: formData
    });

    if (!res.ok) throw new Error("Photo upload failed");
    await loadTickets();
  } catch (e) {
    alert("Error uploading photo verification: " + e.message);
  }
}

// 1-Tap Quick Complete
async function quickCompleteTicket(ticketId) {
  try {
    const res = await fetch(`/api/tickets/${ticketId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "Quick_Complete" })
    });
    if (!res.ok) throw new Error("Complete failed");
    await loadTickets();
  } catch (e) {
    alert("Error completing ticket: " + e.message);
  }
}

// 1-Tap Instant Voice Nudge
async function nudgeTicket(ticketId, btn) {
  const original = btn ? btn.innerText : "";
  if (btn) {
    btn.disabled = true;
    btn.innerText = "⏳ Calling...";
  }

  try {
    const res = await fetch(`/api/tickets/${ticketId}/nudge`, { method: "POST" });
    const data = await res.json();
    if (btn) btn.innerText = data.success ? "✅ Nudged!" : "❌ Error";
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
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => {
        URL.revokeObjectURL(img.src);
        if (blob) resolve(blob);
        else reject(new Error("Canvas blob conversion failed"));
      }, "image/jpeg", 0.85);
    };
    img.onerror = reject;
  });
}

function switchTab(tab) {
  document.querySelectorAll(".nav-tab").forEach(t => t.classList.remove("active"));
  document.getElementById("viewActive").style.display = tab === "active" ? "grid" : "none";
  document.getElementById("viewFloated").style.display = tab === "floated" ? "grid" : "none";
  document.getElementById("viewAudit").style.display = tab === "audit" ? "flex" : "none";

  if (tab === "active") document.getElementById("tabBtnActive").classList.add("active");
  if (tab === "floated") document.getElementById("tabBtnFloated").classList.add("active");
  if (tab === "audit") {
    document.getElementById("tabBtnAudit").classList.add("active");
    loadAuditLog();
  }
}

function openNewTicketModal() {
  document.getElementById("inpEditTicketId").value = "";
  document.getElementById("modalTitle").innerText = "➕ Create House Task";
  document.getElementById("btnSubmitModal").innerText = "Create Task";
  document.getElementById("btnDeleteTicket").style.display = "none";
  document.getElementById("inpTitle").value = "";
  document.getElementById("inpCategory").value = "General";
  document.getElementById("inpAssignee").value = "Son";
  document.getElementById("inpPriority").value = "P2-Normal";
  document.getElementById("inpTime").value = "06:15";
  document.getElementById("inpRecurrence").value = "Weekdays";
  toggleRecurrenceOptions("Weekdays");
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

async function deleteCurrentTicket() {
  const id = document.getElementById("inpEditTicketId").value;
  if (!id) return;
  if (!confirm("Are you sure you want to delete this task?")) return;

  try {
    const res = await fetch(`/api/tickets/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Delete failed");
    closeNewTicketModal();
    await loadTickets();
  } catch (e) {
    alert("Error deleting task: " + e.message);
  }
}

function closeNewTicketModal() {
  document.getElementById("newTicketModal").classList.remove("open");
}

function toggleStageChip(el) {
  el.classList.toggle("active");
}

function toggleRecurrenceOptions(val) {
  document.getElementById("grpIntervalDays").style.display = val === "IntervalDays" ? "flex" : "none";
  document.getElementById("grpDaysOfWeek").style.display = val === "DaysOfWeek" ? "flex" : "none";
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

  const activeStages = Array.from(document.querySelectorAll("#timingChips .speaker-chip.active"))
    .map(c => c.dataset.stage);
  const customMessage = document.getElementById("inpBroadcastMessage").value.trim() || undefined;
  const activeSpeakerChips = Array.from(document.querySelectorAll("#speakerChips .speaker-chip.active"));
  const speakers = activeSpeakerChips.length > 0
    ? activeSpeakerChips.map(c => c.dataset.speaker)
    : ["All Rooms"];

  const broadcast = activeStages.length > 0 ? { stages: activeStages, speakers, customMessage } : undefined;

  const payload = {
    id: editId,
    title,
    category,
    priority,
    assignee,
    broadcast,
    recurrence: {
      type: recType,
      intervalDays: recType === "IntervalDays" ? intervalDays : undefined,
      daysOfWeek: recType === "DaysOfWeek" ? daysOfWeek : undefined,
      baseOnCompletion: true
    },
    preferredWindow: { startHour, startMinute, durationMinutes: 45 },
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
    setTimeout(() => pill.classList.remove("visible"), 1200);
  }
  loadTickets();
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

window.addEventListener("DOMContentLoaded", () => {
  loadTickets();
  setupPullToRefresh();
  setInterval(loadTickets, 30000); // 30s auto-refresh
});
