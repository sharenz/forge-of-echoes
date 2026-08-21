import { createGameServer } from "./createGameServer";
import { loadServerConfig } from "./config";
import { formatError } from "./logging";
import { configureServerServices, createServerServices } from "./services";

let server: ReturnType<typeof createGameServer> | null = null;
let fatalShutdownStarted = false;

function fatalShutdown(reason: unknown, label: string): void {
  console.error(`[game-server] ${label}\n${formatError(reason)}`);
  if (fatalShutdownStarted) return;
  fatalShutdownStarted = true;
  process.exitCode = 1;
  if (!server) {
    process.exit(1);
    return;
  }
  const error = reason instanceof Error ? reason : new Error(String(reason));
  void server.gracefullyShutdown(true, error).catch((shutdownError) => {
    console.error(`[game-server] graceful shutdown failed\n${formatError(shutdownError)}`);
    process.exit(1);
  });
}

process.on("unhandledRejection", (reason) => fatalShutdown(reason, "unhandled promise rejection"));
process.on("uncaughtException", (error, origin) => fatalShutdown(error, `uncaught exception (${origin})`));

const config = loadServerConfig();
const services = await createServerServices(config);
configureServerServices(services);

server = createGameServer(services, { allowedOrigins: config.allowedOrigins });
server.onShutdown(async () => {
  await services.trades?.close();
  await services.expeditions.close();
  await services.parties.close();
  await services.players.close();
});
await server.listen(config.port, config.host);
console.info(`[game-server] listening on ${config.host}:${config.port} (${config.environment})`);
