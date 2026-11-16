import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
function getCandidatePaths() {
    return [
        path.join(os.homedir(), ".local", "share", "@smartthings", "cli", "credentials.json"),
        path.join(os.homedir(), ".config", "@smartthings", "cli", "credentials.json"),
        path.join(process.env.LOCALAPPDATA || "", "@smartthings", "cli", "Data", "credentials.json")
    ].filter(Boolean);
}
function readAccessToken() {
    let best = null;
    let fallbackPath = null;
    for (const credsPath of getCandidatePaths()) {
        if (!fs.existsSync(credsPath))
            continue;
        if (!fallbackPath)
            fallbackPath = credsPath;
        try {
            const raw = JSON.parse(fs.readFileSync(credsPath, "utf8"));
            const entry = raw["default:api.smartthings.com"] || raw.default;
            if (!entry || !entry.accessToken)
                continue;
            const expiresMs = entry.expires ? Date.parse(entry.expires) : 0;
            const expired = !expiresMs || Date.now() >= expiresMs - 60_000;
            if (!best || expiresMs > best.expiresMs) {
                best = { token: entry.accessToken, expiresMs, expired, credsPath };
            }
        }
        catch {
            // Ignore malformed candidate file
        }
    }
    if (best) {
        return { token: best.token, expired: best.expired, credsPath: best.credsPath };
    }
    return { token: null, expired: true, credsPath: fallbackPath };
}
let lastCliRefreshAt = 0;
function refreshTokenViaCli() {
    if (Date.now() - lastCliRefreshAt < 15_000) {
        return Promise.resolve(readAccessToken().token);
    }
    lastCliRefreshAt = Date.now();
    return new Promise((resolve) => {
        const child = execFile("smartthings", ["locations", "--json"], { timeout: 25000 }, () => {
            const updated = readAccessToken();
            resolve(updated.token);
        });
        if (child.stdin)
            child.stdin.end();
    });
}
let inFlightTrigger = false;
export async function checkSmartThingsVirtualSwitchTrigger(deviceId) {
    if (!deviceId || inFlightTrigger)
        return false;
    let { token, expired } = readAccessToken();
    if (!token || expired) {
        token = await refreshTokenViaCli();
    }
    if (!token)
        return false;
    try {
        let res = await fetch(`https://api.smartthings.com/v1/devices/${deviceId}/status`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (res.status === 401) {
            const fresh = await refreshTokenViaCli();
            if (!fresh)
                return false;
            token = fresh;
            res = await fetch(`https://api.smartthings.com/v1/devices/${deviceId}/status`, {
                headers: { Authorization: `Bearer ${token}` }
            });
        }
        if (!res.ok)
            return false;
        const statusJson = await res.json();
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
            }
            finally {
                setTimeout(() => { inFlightTrigger = false; }, 3000);
            }
            return true;
        }
    }
    catch (_) {
        // Ignore transient network errors
    }
    return false;
}
