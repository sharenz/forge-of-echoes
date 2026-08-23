import { defineRoom, defineServer } from "colyseus";
import express from "express";
import { createApiRouter } from "./http/createApiRouter";
import { HideoutRoom } from "./rooms/HideoutRoom";
import { MapRoom } from "./rooms/MapRoom";
import { getServerServices, type ServerServices } from "./services";
import { serverHealth } from "./observability/ServerHealth";
import { serverDrain } from "./observability/ServerDrain";
import { WIRE_PROTOCOL_VERSION } from "../multiplayer/protocol";

export interface GameServerOptions {
  allowedOrigins?: readonly string[];
}

const LOCAL_ORIGINS = ["http://localhost:3001", "http://127.0.0.1:3001"] as const;

export function createGameServer(injectedServices?: ServerServices, options: GameServerOptions = {}) {
  const allowedOrigins = new Set(options.allowedOrigins ?? LOCAL_ORIGINS);

  return defineServer({
    rooms: {
      hideout: defineRoom(HideoutRoom).filterBy(["partyId"]),
      map: defineRoom(MapRoom),
    },
    express: (app) => {
      const services = injectedServices ?? getServerServices();
      app.use(express.json({ limit: "16kb" }));
      app.use((request, response, next) => {
        response.setHeader("X-Crafty-Protocol-Version", String(WIRE_PROTOCOL_VERSION));
        const origin = request.headers.origin?.replace(/\/$/, "");
        if (origin && allowedOrigins.has(origin)) {
          response.setHeader("Access-Control-Allow-Origin", origin);
          response.setHeader("Vary", "Origin");
          response.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
          response.setHeader("Access-Control-Expose-Headers", "x-crafty-protocol-version");
          response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        }
        if (request.method === "OPTIONS") return void response.sendStatus(204);
        next();
      });
      app.get("/healthz", (_request, response) => response.status(200).json({
        status: serverDrain.isDraining ? "draining" : "ok",
        ...serverDrain.snapshot(),
        ...serverHealth.snapshot(),
      }));
      app.post("/admin/drain", (request, response) => {
        const remoteAddress = request.socket.remoteAddress ?? "";
        if (remoteAddress !== "127.0.0.1" && remoteAddress !== "::1" && remoteAddress !== "::ffff:127.0.0.1") {
          response.status(403).json({ error: "forbidden" });
          return;
        }
        response.status(202).json(serverDrain.begin());
      });
      app.use("/api", createApiRouter(services));
    },
  });
}
