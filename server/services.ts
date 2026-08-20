import { loadServerConfig, type ServerConfig } from "./config";
import { PostgresPlayerRepository } from "./persistence/PostgresPlayerRepository";
import type { PlayerRepository } from "./persistence/PlayerRepository";
import { PartyService } from "./services/PartyService";
import { MapAdmissionService } from "./services/MapAdmissionService";
import { PostgresTradeRepository } from "./persistence/PostgresTradeRepository";
import type { TradeRepository } from "./persistence/TradeRepository";

export interface ServerServices {
  authSecret: string;
  players: PlayerRepository;
  parties: PartyService;
  mapAdmissions: MapAdmissionService;
  trades?: TradeRepository;
}

let activeServices: ServerServices | null = null;

export function getServerServices(): ServerServices {
  if (!activeServices) throw new Error("Server services have not been initialized");
  return activeServices;
}

export function configureServerServices(services: ServerServices): void {
  activeServices = services;
}

export async function createServerServices(config: ServerConfig = loadServerConfig()): Promise<ServerServices> {
  const players = new PostgresPlayerRepository(config.databaseUrl);
  await players.initialize();
  return {
    authSecret: config.authSecret,
    players,
    parties: new PartyService(),
    mapAdmissions: new MapAdmissionService(),
    trades: new PostgresTradeRepository(config.databaseUrl),
  };
}
