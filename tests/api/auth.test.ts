import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildServer } from "../../src/server";

describe("HouseOps Access Key Authentication & Health Probe", () => {
  describe("without accessKey configured", () => {
    let app: any;

    beforeAll(async () => {
      app = await buildServer({ dbPath: ":memory:", photoDir: "test_photos", accessKey: "" });
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it("reports authRequired=false on /api/health and allows /api/tickets", async () => {
      const health = await app.inject({ method: "GET", url: "/api/health" });
      expect(health.statusCode).toBe(200);
      expect(JSON.parse(health.body)).toEqual({ ok: true, authRequired: false });

      const tickets = await app.inject({ method: "GET", url: "/api/tickets" });
      expect(tickets.statusCode).toBe(200);
    });
  });

  describe("with accessKey configured", () => {
    let app: any;
    const SECRET = "family-key-2026";

    beforeAll(async () => {
      app = await buildServer({ dbPath: ":memory:", photoDir: "test_photos", accessKey: SECRET });
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it("allows unauthenticated /api/health probe with authRequired=true", async () => {
      const health = await app.inject({ method: "GET", url: "/api/health" });
      expect(health.statusCode).toBe(200);
      expect(JSON.parse(health.body)).toEqual({ ok: true, authRequired: true });
    });

    it("blocks unauthenticated API and photo requests with 401", async () => {
      const apiRes = await app.inject({ method: "GET", url: "/api/tickets" });
      expect(apiRes.statusCode).toBe(401);

      const photoRes = await app.inject({ method: "GET", url: "/photos/sample.jpg" });
      expect(photoRes.statusCode).toBe(401);
    });

    it("serves a login page on GET / when unauthenticated", async () => {
      const pageRes = await app.inject({ method: "GET", url: "/" });
      expect(pageRes.statusCode).toBe(401);
      expect(pageRes.headers["content-type"]).toContain("text/html");
      expect(pageRes.body).toContain("Access Key");
      expect(pageRes.body).toContain("/api/auth/login");
    });

    it("rejects wrong keys and accepts valid X-HouseOps-Key and Bearer headers", async () => {
      const wrongRes = await app.inject({
        method: "GET",
        url: "/api/tickets",
        headers: { "x-houseops-key": "wrong-key" }
      });
      expect(wrongRes.statusCode).toBe(401);

      const headerRes = await app.inject({
        method: "GET",
        url: "/api/tickets",
        headers: { "x-houseops-key": SECRET }
      });
      expect(headerRes.statusCode).toBe(200);

      const bearerRes = await app.inject({
        method: "GET",
        url: "/api/tickets",
        headers: { authorization: `Bearer ${SECRET}` }
      });
      expect(bearerRes.statusCode).toBe(200);
    });

    it("sets HttpOnly session cookie when loading / with X-HouseOps-Key", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/",
        headers: { "x-houseops-key": SECRET }
      });
      expect(res.statusCode).toBe(200);
      const setCookie = res.headers["set-cookie"];
      const cookieHeader = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie || "");
      expect(cookieHeader).toContain("houseops_auth=");
      expect(cookieHeader).toContain("HttpOnly");

      const authCookie = cookieHeader.split(";")[0];
      const followUp = await app.inject({
        method: "GET",
        url: "/api/tickets",
        headers: { cookie: authCookie }
      });
      expect(followUp.statusCode).toBe(200);
    });

    it("supports POST /api/auth/login and POST /api/auth/logout", async () => {
      const badLogin = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { key: "nope" }
      });
      expect(badLogin.statusCode).toBe(401);

      const goodLogin = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { key: SECRET }
      });
      expect(goodLogin.statusCode).toBe(200);
      const setCookie = goodLogin.headers["set-cookie"];
      const cookiePair = (Array.isArray(setCookie) ? setCookie[0] : String(setCookie)).split(";")[0];

      const authed = await app.inject({
        method: "GET",
        url: "/api/tickets",
        headers: { cookie: cookiePair }
      });
      expect(authed.statusCode).toBe(200);

      const logout = await app.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers: { cookie: cookiePair }
      });
      expect(logout.statusCode).toBe(200);
      const clearedCookie = String(logout.headers["set-cookie"] || "");
      expect(clearedCookie).toContain("Max-Age=0");
    });
  });
});
