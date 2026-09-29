// Headless playthrough harness: plays real maps with the real rules, the real (multiplayer) sim and the
// scripted bots from tests/sim/bot.ts — exactly the way the server wires them (GAME_SPEC §2, §11,
// ARCHITECTURE "Data flow in a map"):
//   • the owner opens the map; buildRunConfig(setup, hooks) makes the instance and every party member
//     joins it with addPlayer({ id, name, level, runtime: playerRuntime(ch, setup) });
//   • loot is instanced: each kill / the chest is rolled once per living player with that player's
//     CharacterSave (personal luck) and tagged with dropSpec(item, token, owner); a pickup is refused
//     unless the picker owns the drop;
//   • XP is shared: every 'xp' outcome goes to every LIVING player, level-ups refresh that player
//     (updatePlayer with restore + level); drunk flasks go through consumeFlask. "Living only" follows
//     the sim's guidance (src/sim/index.ts: a corpse beside a carry must not level for free) and
//     deliberately deviates from the literal contract text ("grant amount to EVERY player in the
//     instance", contracts/sim.ts) and GAME_SPEC §11 — reported to the orchestrator; the server must
//     pick one reading and this harness follows the sim's;
//   • optional re-entry: a dead player comes back through one of the map's 8 portals after a walk
//     (removePlayer, then addPlayer with a fresh runtime), counted against the portal budget.
//   • click pickups (GAME_SPEC §12): equipment is not collected by walking over it (DropSpec.autoPickup
//     false) and the bot never clicks, so the harness clicks for the player: the bot is shown its own
//     click-only drops as walk-over loot (it walks to them when it is safe and after the clear, like a
//     player walked there by a click), and any of them within PICKUP_REACH is requested
//     (run.requestPickup).
// Skill / attribute points are spent by a simple, sensible policy. Used by the balance suite
// (tests/game-progression/balance.test.ts).
import type { Attribute, SkillId } from '../../src/contracts/content';
import type { RunSetup } from '../../src/contracts/game';
import type { CharacterSave, Item, MapItem } from '../../src/contracts/items';
import { PORTALS_PER_MAP } from '../../src/contracts/net';
import {
  PICKUP_REACH, SIM_DT, type DropSpec, type RunConfig, type RunHooks, type SimEvent,
  type WorldView,
} from '../../src/contracts/sim';
import { rules } from '../../src/game';
import { createMapItem } from '../../src/game/progression';
import { createRun, type SimPlayerUpdate } from '../../src/sim';
import { createBot } from '../sim/bot';

/** How a player spends points. Skill steps are taken in order (a skill listed twice is ranked twice). */
export interface SpendPolicy {
  skills: readonly SkillId[];
  /** Attribute points cycle through this list. */
  attributes: readonly Attribute[];
}

/**
 * A new player's plan: the banked point on Ember Nova (the gateway to the destruction tree), a ward
 * for the crowds, then Nova to 3 (unlocks Rime Shards / Flame Wave), a blink, and damage from there.
 * Mostly Intelligence (Focus + spell damage) with some Strength for life.
 */
export const DEFAULT_POLICY: SpendPolicy = {
  skills: [
    'emberNova', 'cinderWard', 'emberNova', 'emberNova', 'riftStep', 'emberLance', 'rimeShards', 'emberNova', 'emberLance',
    'rimeShards', 'emberNova', 'emberLance', 'rimeShards', 'cinderWard', 'emberNova', 'emberLance', 'rimeShards', 'rimeShards',
    'arcChain', 'emberNova', 'emberLance', 'arcChain', 'cinderWard', 'emberNova', 'arcChain', 'emberLance', 'emberNova',
  ],
  attributes: ['int', 'str', 'int'],
};

/** Fallback when the plan is exhausted: keep ranking these in order. */
const FALLBACK_SKILLS: readonly SkillId[] = ['emberNova', 'emberLance', 'rimeShards', 'arcChain', 'cinderWard', 'riftStep', 'flameWave'];

/** Spend every unspent skill and attribute point by the policy (pure). */
export function spendPoints(ch: CharacterSave, policy: SpendPolicy = DEFAULT_POLICY): CharacterSave {
  let next = ch;
  let guard = 0;
  while (next.unspentSkillPoints > 0 && guard++ < 200) {
    const seen = new Map<SkillId, number>();
    let target: SkillId | null = null;
    for (const id of policy.skills) {
      const step = (seen.get(id) ?? 0) + 1;
      seen.set(id, step);
      if ((next.skillRanks[id] ?? 0) < step && rules.canRankUpSkill(next, id).ok) {
        target = id;
        break;
      }
    }
    target ??= FALLBACK_SKILLS.find((id) => rules.canRankUpSkill(next, id).ok) ?? null;
    if (!target) break;
    const r = rules.rankUpSkill(next, target);
    if (!r.ok) break;
    next = r.value;
  }
  let k = next.level * 7; // stable rotation start, independent of how many points arrive at once
  while (next.unspentAttributePoints > 0 && policy.attributes.length) {
    const r = rules.allocateAttribute(next, policy.attributes[k++ % policy.attributes.length]);
    if (!r.ok) break;
    next = r.value;
  }
  return next;
}

export interface PlayOptions {
  policy?: SpendPolicy;
  /** Give up (result 'timeout') after this much sim time. Default 20 minutes. */
  maxMinutes?: number;
  /** Adjust the instance config before the run starts (probes only). */
  tweakConfig?: (cfg: RunConfig) => void;
  /**
   * A dead player returns to their hideout and re-enters through one of the map's portals after this
   * many seconds (GAME_SPEC §0 / §11). Off by default: the balance guards want a clear without deaths.
   */
  reenterAfter?: number;
  /** Probe: every tick's events and the view after the step (diagnostics only). */
  onStep?: (events: readonly SimEvent[], view: WorldView, tick: number) => void;
}

export interface PlayResult {
  result: 'cleared' | 'failed' | 'timeout';
  /** Sim seconds until the map was cleared (boss dead), the party was down, or the timeout. */
  seconds: number;
  wave: number;
  kills: number;
  levelStart: number;
  levelEnd: number;
  /** Boss life fraction at the end (1 = never damaged / never spawned, 0 = dead). */
  bossLife: number;
  heraldKilled: boolean;
  /** Most monsters alive at once. */
  peakAlive: number;
  /** This player's lowest life as a fraction of maximum life during the run. */
  minLife: number;
  flasksDrunk: number;
  deaths: number;
  /** Portals used by the whole party (first entries + re-entries). */
  portalsUsed: number;
  /** Items this player picked up (their own instanced drops). */
  pickups: number;
  /** Times this player came back in through a portal after dying. */
  reentries: number;
  /** Items this player picked up after their first re-entry (instanced loot keeps flowing). */
  pickupsAfterReentry: number;
  character: CharacterSave;
  setup: RunSetup;
}

interface Member {
  id: number;
  ch: CharacterSave;
  bot: ReturnType<typeof createBot>;
  levelStart: number;
  inside: boolean;
  dead: boolean;
  deadAt: number;
  returned: boolean;
  deaths: number;
  flasksDrunk: number;
  pickups: number;
  reentries: number;
  pickupsAfterReentry: number;
  minLife: number;
  flaskPicked: boolean;
}

/** The instance's entry for one member (the same PlayerJoin a server builds). */
function joinOf(m: Member, setup: RunSetup) {
  return { id: m.id, name: m.ch.name, level: m.ch.level, runtime: rules.playerRuntime(m.ch, setup) };
}

/**
 * A party (1–4 characters) plays `map`: the first character is the owner — it opens the map from its
 * device — and everyone joins the instance. Every member keeps the XP, points spent, their own pickups
 * and the run log. One PlayResult per member, in order.
 */
export function playParty(starts: readonly CharacterSave[], map: MapItem, opts: PlayOptions = {}): PlayResult[] {
  if (starts.length < 1 || starts.length > 4) throw new Error('playParty: 1 to 4 characters');
  const policy = opts.policy ?? DEFAULT_POLICY;
  let owner = spendPoints(starts[0], policy);
  if (rules.findItem(owner, map.uid)) {
    const moved = rules.moveItem(owner, map.uid, { kind: 'mapDevice' });
    if (!moved.ok) throw new Error(`playParty: ${moved.error}`);
    owner = moved.value;
  } else {
    owner = { ...owner, mapDevice: map };
  }
  const opened = rules.openMap(owner);
  if (!opened.ok) throw new Error(`playParty: ${opened.error}`);
  const setup = opened.value.setup;

  const members: Member[] = [opened.value.character, ...starts.slice(1).map((c) => spendPoints(c, policy))].map((ch, i) => ({
    id: i + 1, ch, bot: createBot(), levelStart: ch.level, inside: false, dead: false, deadAt: 0, returned: false,
    deaths: 0, flasksDrunk: 0, pickups: 0, reentries: 0, pickupsAfterReentry: 0, minLife: 1, flaskPicked: false,
  }));
  const byId = new Map(members.map((m) => [m.id, m]));
  const member = (id: number): Member => {
    const m = byId.get(id);
    if (!m) throw new Error(`unknown player ${id}`);
    return m;
  };

  // Instanced loot, exactly as the server does it: roll per player, remember the owner of every token.
  const tokens = new Map<number, { owner: number; item: Item }>();
  let nextToken = 1;
  const specs = (owner: number, items: Item[]): DropSpec[] => items.map((item) => {
    const token = nextToken++;
    tokens.set(token, { owner, item });
    return rules.dropSpec(item, token, owner);
  });
  const hooks: RunHooks = {
    rollKillLoot: (ctx, ids, rng) => ids.flatMap((id) => specs(id, rules.rollKillLoot(setup, ctx, rng, member(id).ch))),
    rollChestLoot: (ids, rng) => ids.flatMap((id) => specs(id, rules.rollChestLoot(setup, rng, member(id).ch))),
    tryPickup: (playerId, token) => {
      const drop = tokens.get(token);
      if (!drop || drop.owner !== playerId) return false;
      const m = member(playerId);
      const r = rules.addToBackpack(m.ch, drop.item);
      if (!r.ok) return false;
      m.ch = r.value;
      m.pickups++;
      if (m.reentries > 0) m.pickupsAfterReentry++;
      tokens.delete(token);
      if (drop.item.kind === 'flask') m.flaskPicked = true;
      return true;
    },
  };
  const cfg = rules.buildRunConfig(setup, hooks);
  opts.tweakConfig?.(cfg);
  const run = createRun(cfg);
  let portalsUsed = 0;
  for (const m of members) {
    run.addPlayer(joinOf(m, setup));
    m.inside = true;
    portalsUsed++;
  }
  // Click pickups (GAME_SPEC §12). The player clicks their own click-only loot (equipment); the character
  // walks there and picks it up within PICKUP_REACH. The bot decides WHEN loot is worth the walk (only
  // when it is safe, and everything after the clear) but knows only walk-over drops, so it is shown its
  // own click-only drops as walk-over ones — it walks to them exactly as a player who clicked them would
  // be walked there — and the harness sends the click (run.requestPickup) once the drop is in reach.
  const refused = new Set<number>();
  const botView = (m: Member): WorldView => {
    const v = run.view;
    if (!v.drops.some((d) => d.spec.owner === m.id && !d.spec.autoPickup)) return v;
    const drops = v.drops.map((d) => (d.spec.owner === m.id && !d.spec.autoPickup && !refused.has(d.id)
      ? { ...d, spec: { ...d.spec, autoPickup: true } }
      : d));
    return { ...v, drops };
  };
  const clickLoot = (m: Member): void => {
    const v = run.view;
    const me = v.players.find((p) => p.id === m.id);
    if (!me || me.dead) return;
    for (const d of v.drops) {
      if (d.spec.owner !== m.id || d.spec.autoPickup || d.blocked || refused.has(d.id)) continue;
      if (Math.hypot(d.x - me.x, d.y - me.y) > PICKUP_REACH) continue;
      // 'full' leaves it lying (blocked); anything else but 'ok' would be a sim bug — never retry it.
      if (run.requestPickup(m.id, d.id) !== 'ok') refused.add(d.id);
    }
  };

  const maxTicks = Math.round(((opts.maxMinutes ?? 20) * 60) / SIM_DT);
  const reenterTicks = opts.reenterAfter !== undefined ? Math.round(opts.reenterAfter / SIM_DT) : -1;

  let clearedAt = -1;
  let downAt = -1;
  let heraldKilled = false;
  let peakAlive = 0;
  let bossLife = 1;
  let t = 0;
  for (; t < maxTicks; t++) {
    for (const m of members) {
      if (!m.inside) continue;
      clickLoot(m);
      run.setIntent(m.id, m.bot.intent(botView(m), m.id));
    }
    run.step();
    const events = run.drainEvents();
    opts.onStep?.(events, run.view, t);
    for (const o of run.drainOutcomes()) {
      switch (o.t) {
        case 'xp':
          // Shared XP: every living player in the instance gets it (the dead get nothing).
          for (const m of members) {
            if (!m.inside || m.dead) continue;
            const g = rules.grantXp(m.ch, o.amount);
            m.ch = g.character;
            if (g.levelsGained > 0) {
              m.ch = spendPoints(m.ch, policy);
              const update: SimPlayerUpdate = { ...rules.playerRuntime(m.ch, setup), restore: true, level: m.ch.level };
              run.updatePlayer(m.id, update);
            }
          }
          break;
        case 'flaskUsed': {
          const m = member(o.playerId);
          m.ch = rules.consumeFlask(m.ch, o.slot);
          m.flasksDrunk++;
          break;
        }
        case 'kill':
          if (o.isLieutenant) heraldKilled = true;
          break;
        case 'cleared':
          clearedAt = t;
          break;
        case 'playerDied': {
          const m = member(o.playerId);
          m.dead = true;
          m.deadAt = t;
          m.deaths++;
          break;
        }
        case 'returnPortal': {
          const m = member(o.playerId);
          m.returned = true;
          m.inside = false;
          run.removePlayer(m.id);
          break;
        }
        default:
          break;
      }
    }
    for (const m of members) {
      if (m.flaskPicked && m.inside) run.updatePlayer(m.id, { flasks: rules.playerRuntime(m.ch, setup).flasks });
      m.flaskPicked = false;
      // Respawn in the hideout, walk back and re-enter through a portal (if any are left).
      if (m.dead && reenterTicks >= 0 && t - m.deadAt >= reenterTicks && portalsUsed < PORTALS_PER_MAP) {
        run.removePlayer(m.id);
        m.dead = false;
        m.reentries++;
        run.addPlayer(joinOf(m, setup));
        portalsUsed++;
      }
    }
    const v = run.view;
    peakAlive = Math.max(peakAlive, v.run.monstersAlive);
    for (const p of v.players) {
      const m = byId.get(p.id);
      if (m && p.maxLife > 0 && !p.dead) m.minLife = Math.min(m.minLife, Math.max(0, p.life) / p.maxLife);
      else if (m && p.dead) m.minLife = 0;
    }
    if (v.run.boss) bossLife = v.run.boss.life / v.run.boss.maxLife;
    if (members.every((m) => m.returned)) break;
    // Party down with no way back in: the run is lost.
    const canReturn = reenterTicks >= 0 && portalsUsed < PORTALS_PER_MAP;
    if (clearedAt < 0 && members.every((m) => !m.inside || m.dead) && !canReturn) {
      downAt = t;
      break;
    }
    // After the clear, give the bots a minute to loot their chests and walk to the portal.
    if (clearedAt >= 0 && t - clearedAt > Math.round(60 / SIM_DT)) break;
  }

  const result: PlayResult['result'] = clearedAt >= 0 ? 'cleared' : downAt >= 0 ? 'failed' : 'timeout';
  const seconds = (clearedAt >= 0 ? clearedAt : downAt >= 0 ? downAt : t) * SIM_DT;
  const view = run.view;
  return members.map((m) => {
    const ch = rules.applyRunEnd(m.ch, {
      result: result === 'cleared' ? 'cleared' : result === 'failed' ? 'failed' : 'abandoned',
      tier: setup.map.tier,
      kills: view.run.kills,
      seconds,
      raresFound: 0,
      uniquesFound: 0,
    });
    return {
      result,
      seconds,
      wave: view.run.wave,
      kills: view.run.kills,
      levelStart: m.levelStart,
      levelEnd: ch.level,
      bossLife: result === 'cleared' ? 0 : bossLife,
      heraldKilled,
      peakAlive,
      minLife: m.minLife,
      flasksDrunk: m.flasksDrunk,
      deaths: m.deaths,
      portalsUsed,
      pickups: m.pickups,
      reentries: m.reentries,
      pickupsAfterReentry: m.pickupsAfterReentry,
      character: ch,
      setup,
    };
  });
}

/**
 * Put `map` in the device, open it and play it solo (a party of one) with the bot until the return
 * portal, death or the timeout.
 */
export function playMap(start: CharacterSave, map: MapItem, opts: PlayOptions = {}): PlayResult {
  return playParty([start], map, opts)[0];
}

// ---------------------------------------------------------------------------------------------
// Between maps: equip upgrades like a player reading Alt-compare
// ---------------------------------------------------------------------------------------------

/**
 * A rough "how strong is this character" score: log of the loadout's damage (the basic attack's
 * single-target DPS plus half of every other damaging skill's) plus log of effective life against
 * hits (life behind evasion, average resistance and damage taken), a little movement speed.
 */
export function powerScore(ch: CharacterSave): number {
  const d = rules.deriveStats(ch);
  let offence = 0;
  for (const id of ch.loadout) {
    if (!id) continue;
    const dps = rules.skillSheet(ch, id).dps ?? 0;
    offence += id === 'emberLance' ? dps : dps * 0.5;
  }
  const c = d.combat;
  const avgRes = (c.resist.fire + c.resist.cold + c.resist.lightning + c.resist.void) / 4;
  const ehp = c.maxLife / Math.max(0.05, (1 - c.evasion) * (1 - avgRes) * c.damageTaken);
  return Math.log(Math.max(1, offence)) + 0.6 * Math.log(Math.max(1, ehp)) + 0.3 * Math.log(Math.max(1, c.moveSpeed));
}

/**
 * Equip every backpack item that raises the power score (trying each slot it fits), repeatedly,
 * then discard the equipment left in the backpack so the next map's loot has room.
 */
export function upgradeGear(start: CharacterSave): CharacterSave {
  let ch = start;
  for (let pass = 0; pass < 12; pass++) {
    const base = powerScore(ch);
    let best: { ch: CharacterSave; score: number } | null = null;
    for (const e of ch.backpack.entries) {
      if (e.item.kind !== 'equipment') continue;
      for (const slot of rules.content.bases[e.item.baseId].slots) {
        const moved = rules.moveItem(ch, e.item.uid, { kind: 'equipment', slot });
        if (!moved.ok) continue;
        const score = powerScore(moved.value);
        if (score > base + 0.005 && (!best || score > best.score)) best = { ch: moved.value, score };
      }
    }
    if (!best) break;
    ch = best.ch;
  }
  for (const e of [...ch.backpack.entries]) {
    if (e.item.kind !== 'equipment') continue;
    const r = rules.discardItem(ch, e.item.uid);
    if (r.ok) ch = r.value;
  }
  return rules.clearNewFlags(ch);
}

/** The first map of a base in the backpack (starting kit maps, chest maps…). */
export function mapInBag(ch: CharacterSave, pred: (m: MapItem) => boolean = () => true): MapItem | null {
  for (const e of ch.backpack.entries) if (e.item.kind === 'map' && pred(e.item)) return e.item;
  return null;
}

/** One-line summary for logs. */
export function describePlay(r: PlayResult): string {
  const m = r.setup.map;
  return `${m.baseId} T${m.tier}: ${r.result} in ${Math.round(r.seconds)}s, wave ${r.wave}, L${r.levelStart}->L${r.levelEnd}, `
    + `kills ${r.kills}, boss ${Math.round(r.bossLife * 100)}%, herald ${r.heraldKilled ? 'dead' : 'alive'}, `
    + `peak ${r.peakAlive} alive, lowest life ${Math.round(r.minLife * 100)}%, flasks ${r.flasksDrunk}, `
    + `deaths ${r.deaths}, re-entries ${r.reentries}, portals ${r.portalsUsed}/${PORTALS_PER_MAP}, pickups ${r.pickups}`
    + (r.reentries > 0 ? ` (${r.pickupsAfterReentry} after re-entering)` : '');
}

/**
 * The map a player would open next at `tier`: a Normal one from the backpack (starting kit, chest
 * drops), else one bought from Rook (Tier 1 free, Tier 2 for Scrap), else a fresh Normal map.
 */
export function nextMap(ch: CharacterSave, tier: number): { character: CharacterSave; map: MapItem } {
  const own = mapInBag(ch, (m) => m.tier === tier && m.rarity === 'normal') ?? mapInBag(ch, (m) => m.tier === tier);
  if (own) return { character: ch, map: own };
  if (tier <= 2) {
    const bought = rules.buyOffer(ch, `map-t${tier}-ashenForge`);
    if (bought.ok && bought.value.item.kind === 'map') return { character: bought.value.character, map: bought.value.item };
  }
  return { character: ch, map: createMapItem('ashenForge', tier, `balance-t${tier}-${ch.nextUid}`) };
}

/**
 * A fresh character plays maps of these tiers in order, equipping upgrades between maps (the
 * pickups, XP and level-ups carry over, exactly as in the game).
 */
export function playChain(seed: number, tiers: readonly number[], opts: PlayOptions = {}): PlayResult[] {
  let ch = rules.createCharacter('Balance', seed);
  const out: PlayResult[] = [];
  for (const tier of tiers) {
    const next = nextMap(ch, tier);
    const r = playMap(next.character, next.map, opts);
    out.push(r);
    ch = upgradeGear(r.character);
  }
  return out;
}
