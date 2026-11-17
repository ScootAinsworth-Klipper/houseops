import crypto from "crypto";
const COOKIE_NAME = "houseops_auth";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year
function safeEqual(a, b) {
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.length !== bufB.length)
        return false;
    return crypto.timingSafeEqual(bufA, bufB);
}
function parseCookies(cookieHeader) {
    const out = {};
    if (!cookieHeader)
        return out;
    for (const part of cookieHeader.split(";")) {
        const idx = part.indexOf("=");
        if (idx === -1)
            continue;
        const k = part.slice(0, idx).trim();
        const v = part.slice(idx + 1).trim();
        if (k)
            out[k] = decodeURIComponent(v);
    }
    return out;
}
function isHttpsRequest(req) {
    const xfProto = req.headers["x-forwarded-proto"];
    if (typeof xfProto === "string" && xfProto.toLowerCase().includes("https")) {
        return true;
    }
    return req.protocol === "https";
}
function buildSessionCookie(req, value, maxAgeSeconds) {
    const parts = [
        `${COOKIE_NAME}=${encodeURIComponent(value)}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${maxAgeSeconds}`
    ];
    if (isHttpsRequest(req)) {
        parts.push("Secure");
    }
    return parts.join("; ");
}
function extractHeaderKey(req) {
    const xKey = req.headers["x-houseops-key"];
    if (typeof xKey === "string" && xKey.length > 0) {
        return xKey;
    }
    const auth = req.headers.authorization;
    if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
        const token = auth.slice(7).trim();
        if (token.length > 0)
            return token;
    }
    return undefined;
}
function renderLoginHtml() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>HouseOps Login</title>
  <meta name="theme-color" content="#000000">
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #000000;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 20px;
    }
    .card {
      width: 100%;
      max-width: 380px;
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 16px;
      padding: 24px;
    }
    h1 { margin: 0 0 8px; font-size: 22px; }
    p { margin: 0 0 18px; color: #94a3b8; font-size: 14px; line-height: 1.4; }
    input {
      width: 100%;
      padding: 12px 14px;
      border-radius: 10px;
      border: 1px solid #334155;
      background: #020617;
      color: #f8fafc;
      font-size: 16px;
      margin-bottom: 12px;
    }
    button {
      width: 100%;
      padding: 12px;
      border-radius: 10px;
      border: none;
      background: #0284c7;
      color: #ffffff;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
    }
    .err {
      color: #f87171;
      font-size: 13px;
      margin-top: 10px;
      min-height: 18px;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>⚡ HouseOps</h1>
    <p>Enter your Household Access Key to connect.</p>
    <form id="loginForm">
      <input id="keyInput" type="password" placeholder="Access Key" autocomplete="current-password" required autofocus />
      <button type="submit">Unlock HouseOps</button>
      <div id="errMsg" class="err"></div>
    </form>
  </div>
  <script>
    document.getElementById("loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const errEl = document.getElementById("errMsg");
      errEl.textContent = "";
      const key = document.getElementById("keyInput").value;
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key })
        });
        if (res.ok) {
          window.location.reload();
        } else {
          errEl.textContent = "Incorrect Access Key.";
        }
      } catch (err) {
        errEl.textContent = "Connection error. Try again.";
      }
    });
  </script>
</body>
</html>`;
}
export function registerAuth(app, accessKey) {
    const trimmedKey = accessKey.trim();
    const authRequired = trimmedKey.length > 0;
    const sessionToken = authRequired
        ? crypto.createHmac("sha256", trimmedKey).update("houseops-session-v1").digest("hex")
        : "";
    app.get("/api/health", async (_req, reply) => {
        return reply.send({ ok: true, authRequired });
    });
    app.post("/api/auth/login", async (req, reply) => {
        if (!authRequired) {
            return reply.send({ ok: true, authRequired: false });
        }
        const provided = typeof req.body?.key === "string" ? req.body.key : "";
        if (!provided || !safeEqual(provided, trimmedKey)) {
            return reply.status(401).send({ error: "Invalid access key" });
        }
        reply.header("Set-Cookie", buildSessionCookie(req, sessionToken, COOKIE_MAX_AGE_SECONDS));
        return reply.send({ ok: true });
    });
    app.post("/api/auth/logout", async (req, reply) => {
        reply.header("Set-Cookie", buildSessionCookie(req, "", 0));
        return reply.send({ ok: true });
    });
    if (!authRequired)
        return;
    const publicPaths = new Set(["/api/health", "/api/auth/login", "/api/auth/logout", "/manifest.json", "/styles.css"]);
    app.addHook("onRequest", async (req, reply) => {
        if (req.method === "OPTIONS")
            return;
        const urlPath = req.url.split("?")[0];
        if (publicPaths.has(urlPath))
            return;
        const headerKey = extractHeaderKey(req);
        if (headerKey && safeEqual(headerKey, trimmedKey)) {
            if (req.method === "GET" && !urlPath.startsWith("/api/") && !urlPath.startsWith("/photos/")) {
                reply.header("Set-Cookie", buildSessionCookie(req, sessionToken, COOKIE_MAX_AGE_SECONDS));
            }
            return;
        }
        const cookies = parseCookies(req.headers.cookie);
        if (cookies[COOKIE_NAME] && safeEqual(cookies[COOKIE_NAME], sessionToken)) {
            return;
        }
        if (urlPath.startsWith("/api/") || urlPath.startsWith("/photos/")) {
            return reply.status(401).send({ error: "Unauthorized" });
        }
        return reply.status(401).type("text/html; charset=utf-8").send(renderLoginHtml());
    });
}
