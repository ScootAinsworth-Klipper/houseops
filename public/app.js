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
        ${p1Badge}
        ${floatedBadge}
        <span class="badge badge-general">${t.recurrence.type}</span>
      </div>
      <div class="ticket-schedule">
        <span>🕒</span> Window: ${dateStr} at ${timeStr} (${t.preferredWindow.durationMinutes}m)
      </div>
      <div class="card-actions">
        <button class="btn btn-verify" onclick="triggerCameraCapture('${t.id}')">
          📸 Verify (Photo)
        </button>
        <button class="btn btn-done" onclick="quickCompleteTicket('${t.id}')">
          ✓ Done
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
  document.getElementById("newTicketModal").classList.add("open");
}
function closeNewTicketModal() {
  document.getElementById("newTicketModal").classList.remove("open");
}
function toggleRecurrenceDays(val) {
  document.getElementById("grpIntervalDays").style.display = val === "IntervalDays" ? "flex" : "none";
}

async function submitNewTicket() {
  const title = document.getElementById("inpTitle").value.trim();
  const category = document.getElementById("inpCategory").value;
  const priority = document.getElementById("inpPriority").value;
  const recType = document.getElementById("inpRecurrence").value;
  const intervalDays = parseInt(document.getElementById("inpIntervalDays").value, 10) || 1;
  const startHour = parseInt(document.getElementById("inpHour").value, 10) || 19;

  if (!title) {
    alert("Please enter a task title.");
    return;
  }

  const now = new Date();
  const nextSched = new Date(now);
  if (now.getHours() >= startHour) {
    nextSched.setDate(nextSched.getDate() + 1);
  }
  nextSched.setHours(startHour, 0, 0, 0);

  const payload = {
    title,
    category,
    priority,
    recurrence: {
      type: recType,
      intervalDays: recType === "IntervalDays" ? intervalDays : undefined,
      baseOnCompletion: true
    },
    preferredWindow: { startHour, durationMinutes: 45 },
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

window.addEventListener("DOMContentLoaded", () => {
  loadTickets();
  setInterval(loadTickets, 30000); // 30s auto-refresh
});
