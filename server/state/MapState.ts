import { MapSchema, Schema, defineTypes } from "@colyseus/schema";

export class NetworkMapPlayer extends Schema {
  characterId = "";
  name = "";
  classId = "sorceress";
  x = 0;
  y = 0;
  facingX = 0;
  facingY = 1;
  life = 100;
  maxLife = 100;
  focus = 100;
  maxFocus = 100;
  kills = 0;
  experience = 0;
  persistedExperience = 0;
  lastProcessedMovement = 0;
  lastProcessedAttack = 0;
  connected = true;
  worldIndex = 0;
}

defineTypes(NetworkMapPlayer, {
  characterId: "string", name: "string", classId: "string",
  x: "number", y: "number", facingX: "number", facingY: "number",
  life: "number", maxLife: "number", focus: "number", maxFocus: "number",
  kills: "number", experience: "number", persistedExperience: "number",
  lastProcessedMovement: "number", lastProcessedAttack: "number", connected: "boolean", worldIndex: "number",
});

export class NetworkGroundDrop extends Schema {
  id = "";
  x = 0;
  y = 0;
  source = "monster";
  rarity = "normal";
  expiresAt = 0;
}

defineTypes(NetworkGroundDrop, {
  id: "string", x: "number", y: "number",
  source: "string", rarity: "string", expiresAt: "number",
});

export class MapRoomState extends Schema {
  roomKind = "map";
  ticketId = "";
  ownerCharacterId = "";
  tier = 1;
  wave = 1;
  totalWaves = 6;
  monstersAlive = 0;
  completed = false;
  completionX = 1_920;
  completionY = 1_920;
  elapsedMilliseconds = 0;
  waveElapsedMilliseconds = 0;
  finalRageActive = false;
  players = new MapSchema<NetworkMapPlayer>();
  drops = new MapSchema<NetworkGroundDrop>();
}

defineTypes(MapRoomState, {
  roomKind: "string", ticketId: "string", ownerCharacterId: "string",
  tier: "number", wave: "number", totalWaves: "number", monstersAlive: "number",
  completed: "boolean", completionX: "number", completionY: "number",
  elapsedMilliseconds: "number", waveElapsedMilliseconds: "number", finalRageActive: "boolean",
  players: { map: NetworkMapPlayer }, drops: { map: NetworkGroundDrop },
});
