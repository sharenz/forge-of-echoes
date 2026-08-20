import { defineTypes, MapSchema, Schema } from "@colyseus/schema";

export class NetworkPlayer extends Schema {
  characterId = "";
  name = "";
  classId = "amazon";
  x = 480;
  y = 540;
  facingX = 0;
  facingY = 1;
  lastProcessedSequence = 0;
  connected = true;
}

defineTypes(NetworkPlayer, {
  characterId: "string",
  name: "string",
  classId: "string",
  x: "number",
  y: "number",
  facingX: "number",
  facingY: "number",
  lastProcessedSequence: "number",
  connected: "boolean",
});

export class HideoutState extends Schema {
  roomKind = "hideout";
  partyId = "";
  ownerCharacterId = "";
  players = new MapSchema<NetworkPlayer>();
}

defineTypes(HideoutState, {
  roomKind: "string",
  partyId: "string",
  ownerCharacterId: "string",
  players: { map: NetworkPlayer },
});
