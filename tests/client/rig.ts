// A GameSession on a fake world and a recording `send`, with a manual clock — for the feature tests.
import type { SfxId } from '../../src/contracts/audio';
import type { CharacterSave } from '../../src/contracts/items';
import type { ClientMessage, Command, CommandMessage, ServerMessage, ZoneInfo } from '../../src/contracts/net';
import type { WorldView } from '../../src/contracts/sim';
import { rules } from '../../src/game';
import { GameSession } from '../../src/client/session';
import { DEFAULT_SETTINGS } from '../../src/client/settings';
import { initialUiState } from '../../src/client/state';
import { createStateBox, type StateBox } from '../../src/client/store';
import { fakeWorld, player, prop, worldView, zoneInfo, type FakeWorld } from './helpers';

export interface Rig {
  session: GameSession;
  box: StateBox;
  world: FakeWorld;
  sent: ClientMessage[];
  sounds: SfxId[];
  clock: { t: number; wall: number };
  ch: CharacterSave;
}

export function rig(view: WorldView = worldView({ players: [player(1, 'Ysolde', 0, 0)] })): Rig {
  const box = createStateBox(initialUiState({ ...DEFAULT_SETTINGS }));
  const world = fakeWorld(view);
  const sent: ClientMessage[] = [];
  const sounds: SfxId[] = [];
  const clock = { t: 1000, wall: 1_700_000_000_000 };
  const session = new GameSession({
    box,
    rules,
    send: (m) => {
      sent.push(m);
      return true;
    },
    now: () => clock.t,
    wallNow: () => clock.wall,
    sound: (id) => sounds.push(id),
    world,
  });
  const ch = { ...rules.createCharacter('Ysolde', 42), id: 'me' };
  return { session, box, world, sent, sounds, clock, ch };
}

export function feed(r: Rig, ...msgs: ServerMessage[]): void {
  for (const m of msgs) r.session.handle(m);
}

/** welcome → character → zone (own hideout by default). */
export function enter(r: Rig, zone: Partial<ZoneInfo> = {}): void {
  feed(
    r,
    { t: 'welcome', protocol: 1, characterId: r.ch.id, tickRate: 60, serverTime: 0 },
    { t: 'character', character: r.ch },
    {
      t: 'zone',
      zone: zoneInfo({ ownerCharacterId: r.ch.id, ownerName: r.ch.name, props: [prop(1, 'mapDevice', 0, -180), prop(2, 'anvil', -180, 80)], ...zone }),
    },
  );
}

export function commands(r: Rig): Command[] {
  return r.sent.filter((m): m is CommandMessage => m.t === 'cmd').map((m) => m.cmd);
}

export function lastCmd(r: Rig): CommandMessage {
  const m = [...r.sent].reverse().find((x) => x.t === 'cmd');
  if (!m || m.t !== 'cmd') throw new Error('no command sent');
  return m;
}

/** Answer the newest command. */
export function answer(r: Rig, ok: boolean, extra: { error?: string; message?: string } = {}): void {
  feed(r, { t: 'result', id: lastCmd(r).id, ok, ...extra });
}

export const flush = () => new Promise((res) => setTimeout(res, 0));
export const IDLE = { moveX: 0, moveY: 0, held: 0, flask: -1 };
export const TICK = { blocked: false, autoAttack: false, bot: null, alpha: 1 } as const;
