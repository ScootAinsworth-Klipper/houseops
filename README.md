# ⚡ HouseOps: Household Operations & Ticketing Engine

An IT-operations ticketing system adapted for running a household. Built for high accountability, zero backlog fatigue, natural voice check-offs, and room-level spoken reminders.

---

## 🌟 Key Features

- **Dynamic Floating Chores**: Slipped tasks automatically float into the next designated window. Never stack up duplicate overdue tasks.
- **Completion-Based Recurrence**: Resets the clock on actual completion dates for maintenance cadences (e.g. HVAC filters every 60 days).
- **1-Tap Photo Proof**: Verify chores with instant camera captures. Photos are resized client-side to save network and storage.
- **Google Nest Spoken Broadcasts**: The Raspberry Pi connects directly over local Wi-Fi via `pychromecast` to speak deadline reminders and morning briefings aloud.
- **Google Tasks & Calendar Sync**: Check off tasks using everyday voice on any Nest speaker (*"Hey Google, mark trash done"*), automatically logged as `Closed via Voice`.
- **True Black AMOLED Mode**: Beautiful, responsive dashboard optimized for phone (S26 Ultra), tablet (Tab S8 Ultra), and desktop.

---

## 🚀 Raspberry Pi 3B Setup

1. Clone or copy HouseOps onto your Raspberry Pi:
   ```bash
   git clone https://github.com/ScootAinsworth-Klipper/houseops.git /home/pi/HouseOps
   cd /home/pi/HouseOps
   ```
2. Run the automated installer:
   ```bash
   chmod +x scripts/install-pi.sh
   ./scripts/install-pi.sh
   ```
3. Open your browser on your phone, tablet, or laptop:
   `http://<RASPBERRY_PI_IP>:8088`

---

## 📱 Mobile App (PWA) on S26 Ultra & Tab S8 Ultra

1. Open `http://<RASPBERRY_PI_IP>:8088` in Chrome on your phone or tablet.
2. Tap the Chrome menu (⋮) -> **"Add to Home screen"** or **"Install app"**.
3. HouseOps will open as a full-screen, standalone AMOLED app with camera access.
