import { loadServerConfig, type ServerConfig } from "./config";
import { PostgresPlayerRepository } from "./persistence/PostgresPlayerRepository";
import type { PlayerRepository } from "./persistence/PlayerRepository";
import { PostgresTradeRepository } from "./persistence/PostgresTradeRepository";
import type { TradeRepository } from "./persistence/TradeRepository";
import type { PartyCoordinator } from "./coordination/PartyCoordinator";
import type { ExpeditionCoordinator } from "./coordination/ExpeditionCoordinator";
import { PostgresCoordination } from "./coordination/PostgresCoordination";

export interface ServerServices {
  authSecret: string;
  players: PlayerRepository;
  parties: PartyCoordinator;
  expeditions: ExpeditionCoordinator;
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
  const coordination = new PostgresCoordination(config.databaseUrl, players);
  return {
    authSecret: config.authSecret,
    players,
    parties: coordination,
    expeditions: coordination,
    trades: new PostgresTradeRepository(config.databaseUrl),
  };
}
