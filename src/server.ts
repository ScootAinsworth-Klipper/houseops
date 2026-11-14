import Fastify, { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import cors from "@fastify/cors";
import path from "path";
import fs from "fs";
import { initDatabase, HouseOpsDatabase } from "./db/database.js";
import { registerRoutes } from "./api/routes.js";
import { startDaemon } from "./daemon.js";

export interface ServerOptions {
  dbPath?: string;
  photoDir?: string;
  staticDir?: string;
  port?: number;
  enableDaemon?: boolean;
}

export async function buildServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } }); // 25MB max

  const dbPath = options.dbPath || path.resolve(process.cwd(), "data/houseops.db");
  const photoDir = path.resolve(process.cwd(), options.photoDir || process.env.PHOTO_DIR || "photos");
  const staticDir = path.resolve(process.cwd(), options.staticDir || "public");

  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  fs.mkdirSync(photoDir, { recursive: true });
  fs.mkdirSync(staticDir, { recursive: true });

  const db = initDatabase(dbPath);

  // Serve static UI assets without stale caching on mobile WebViews
  await app.register(fastifyStatic, {
    root: staticDir,
    prefix: "/",
    cacheControl: false,
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    }
  });

  // Serve verified photos
  await app.register(fastifyStatic, {
    root: photoDir,
    prefix: "/photos/",
    decorateReply: false
  });

  registerRoutes(app, db, photoDir);

  if (options.enableDaemon) {
    startDaemon(db);
  }

  return app;
}

if (process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js")) {
  const port = parseInt(process.env.PORT || "8088", 10);
  buildServer().then(server => {
    server.listen({ port, host: "0.0.0.0" }, (err, address) => {
      if (err) {
        console.error("Server start error:", err);
        process.exit(1);
      }
      console.log(`🏠 HouseOps Server running at ${address}`);
    });
  });
}
