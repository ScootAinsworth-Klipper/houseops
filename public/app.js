let tickets = [];
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

  renderTickets();
  updateCounts();
}

function setDadFilter(filterVal) {
  dadFilter = filterVal;
  document.querySelectorAll("#dadFilterBar .speaker-chip").forEach(chip => {
    chip.classList.toggle("active", chip.dataset.filter === filterVal);
  });
  renderTickets();
  updateCounts();
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

function renderTickets() {
  const activeGrid = document.getElementById("viewActive");
  const floatedGrid = document.getElementById("viewFloated");

  const visible = tickets.filter(matchesProfileFilter);
  const activeTickets = visible.filter(t => t.recurrence.type === "OnDemand" || (t.currentStatus !== "Verified" && !t.isFloated));
  const floatedTickets = visible.filter(t => t.recurrence.type !== "OnDemand" && t.currentStatus !== "Verified" && t.isFloated);

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
      ? `<img src="${a.photoPath}" class="audit-thumb" onclick="openPhotoViewer('${a.photoPath}', '${escapeHtml(title).replace(/'/g, "\\'")}')" style="cursor:pointer;" title="Tap to expand photo">`
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
        </div>
      </div>
    `;
  }).join("");
}

function openPhotoViewer(src, title) {
  document.getElementById("photoViewerImg").src = src;
  document.getElementById("photoViewerTitle").innerText = `📸 Proof: ${title}`;
  document.getElementById("photoViewerModal").classList.add("open");
}

function closePhotoViewer() {
  document.getElementById("photoViewerModal").classList.remove("open");
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
    // Client-side image resize to max 1600px to keep Pi memory low & uploads fast
    const resizedBlob = await resizeImage(file, 1600, 1600);
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

// 1-Tap Quick Complete
async function quickCompleteTicket(ticketId) {
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

// 1-Tap Instant Voice Nudge / Broadcast
async function nudgeTicket(ticketId, btn) {
  const original = btn ? btn.innerText : "";
  const isBroadcast = original.includes("Broadcast");
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
  currentTab = tab;
  document.querySelectorAll(".nav-tab").forEach(t => t.classList.remove("active"));
  document.getElementById("viewActive").style.display = tab === "active" ? "grid" : "none";
  document.getElementById("viewFloated").style.display = tab === "floated" ? "grid" : "none";
  document.getElementById("viewAudit").style.display = tab === "audit" ? "flex" : "none";

  const filterBar = document.getElementById("dadFilterBar");
  if (filterBar) {
    filterBar.style.display = (currentProfile === "Dad" && tab !== "audit") ? "flex" : "none";
  }

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
  if (!localStorage.getItem("houseops_profile")) {
    openProfileModal(true);
  }
  applyProfileUI();
  loadQuietHours();
  loadTickets();
  setupPullToRefresh();
  setInterval(loadTickets, 30000); // 30s auto-refresh
});
