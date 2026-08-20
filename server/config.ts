import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).optional(),
  GAME_SERVER_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  GAME_SERVER_HOST: z.string().min(1).optional(),
  DATABASE_URL: z.string().url().optional(),
  CRAFTY_AUTH_SECRET: z.string().min(32).optional(),
  ALLOWED_ORIGINS: z.string().optional(),
});

export interface ServerConfig {
  environment: "development" | "test" | "production";
  port: number;
  host: string;
  databaseUrl: string;
  authSecret: string;
  allowedOrigins: string[];
}

export function loadServerConfig(environment: Record<string, string | undefined> = process.env): ServerConfig {
  const parsed = configSchema.parse(environment);
  const isProduction = parsed.NODE_ENV === "production";
  const databaseUrl = parsed.DATABASE_URL
    ?? (isProduction ? undefined : "postgres://crafty:crafty@127.0.0.1:5434/crafty");
  const authSecret = parsed.CRAFTY_AUTH_SECRET
    ?? (isProduction ? undefined : "crafty-local-development-secret-change-me");

  if (!databaseUrl) throw new Error("DATABASE_URL is required in production");
  if (!authSecret) throw new Error("CRAFTY_AUTH_SECRET is required in production");

  const allowedOrigins = parsed.ALLOWED_ORIGINS
    ? parsed.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim().replace(/\/$/, "")).filter(Boolean)
    : isProduction
      ? []
      : ["http://localhost:3001", "http://127.0.0.1:3001"];

  for (const origin of allowedOrigins) {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`Unsupported ALLOWED_ORIGINS protocol: ${url.protocol}`);
    }
  }

  return {
    environment: parsed.NODE_ENV,
    port: parsed.GAME_SERVER_PORT ?? parsed.PORT ?? 2567,
    host: parsed.GAME_SERVER_HOST ?? (isProduction ? "0.0.0.0" : "127.0.0.1"),
    databaseUrl,
    authSecret,
    allowedOrigins,
  };
}
