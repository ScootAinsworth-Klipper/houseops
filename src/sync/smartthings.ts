import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";

function findCredentialsPath(): string | null {
  const candidates = [
    path.join(os.homedir(), ".config", "@smartthings", "cli", "credentials.json"),
    path.join(os.homedir(), ".local", "share", "@smartthings", "cli", "credentials.json"),
    path.join(process.env.LOCALAPPDATA || "", "@smartthings", "cli", "Data", "credentials.json")
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function readAccessToken(): { token: string | null; expired: boolean; credsPath: string | null } {
  const credsPath = findCredentialsPath();
  if (!credsPath) return { token: null, expired: true, credsPath: null };
  try {
    const raw = JSON.parse(fs.readFileSync(credsPath, "utf8"));
    const entry = raw["default:api.smartthings.com"] || raw.default;
    if (!entry || !entry.accessToken) return { token: null, expired: true, credsPath };
    const expiresMs = entry.expires ? Date.parse(entry.expires) : 0;
    const expired = !expiresMs || Date.now() >= expiresMs - 60_000;
    return { token: entry.accessToken, expired, credsPath };
  } catch {
    return { token: null, expired: true, credsPath };
  }
}

function refreshTokenViaCli(): Promise<string | null> {
  return new Promise((resolve) => {
    const child = execFile("smartthings", ["locations", "--json"], { timeout: 10000 }, () => {
      const updated = readAccessToken();
      resolve(updated.token);
    });
    if (child.stdin) child.stdin.end();
  });
}

let inFlightTrigger = false;

export async function checkSmartThingsVirtualSwitchTrigger(deviceId: string): Promise<boolean> {
  if (!deviceId || inFlightTrigger) return false;

  let { token, expired } = readAccessToken();
  if (!token || expired) {
    token = await refreshTokenViaCli();
  }
  if (!token) return false;

  try {
    let res = await fetch(`https://api.smartthings.com/v1/devices/${deviceId}/status`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (res.status === 401) {
      const fresh = await refreshTokenViaCli();
      if (!fresh) return false;
      token = fresh;
      res = await fetch(`https://api.smartthings.com/v1/devices/${deviceId}/status`, {
        headers: { Authorization: `Bearer ${token}` }
      });
    }

    if (!res.ok) return false;
    const statusJson: any = await res.json();
    const switchVal = statusJson?.components?.main?.switch?.switch?.value;

    if (switchVal === "on") {
      inFlightTrigger = true;
      try {
        await fetch(`https://api.smartthings.com/v1/devices/${deviceId}/commands`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            commands: [{ component: "main", capability: "switch", command: "off" }]
          })
        });
      } finally {
        setTimeout(() => { inFlightTrigger = false; }, 3000);
      }
      return true;
    }
  } catch (_) {
    // Ignore transient network errors
  }

  return false;
}
