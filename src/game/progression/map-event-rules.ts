// The seam between the Atlas tree and the Event Director (docs/atlas-rework/tree-events-interface.md): the tree resolves to
// `AtlasRules.extraRules`; this turns the encounter rules into the two typed lenses the rest reads:
//   slate  (creation time: how many events, how likely, mandatory)  -> rollMapEvent / mapEventOdds
//   sim    (run time: lens effects, timers, rewards)                -> RunConfig.eventModifiers -> the sim
// Pure and deterministic. Rules of nodes whose engine is not live never reach `extraRules`, so this is inert until stream B
// switches the 'events' engine on.
import type { MapEventKind, MapEventModifiers } from '../../contracts/map-events';
import { getMapMod } from '../../data/progression';
import type { AtlasRules } from './atlas-rules';
import type { MapEventSlateModifiers } from './map-events';
import type { MapItem } from '../../contracts/items';

/** The tree's encounter ids (ATLAS_EVENT_KIND_IDS) that map onto the events that exist today. */
export const ATLAS_EVENT_TO_KIND: Readonly<Record<string, MapEventKind>> = {
  stalker: 'hunted', echoing: 'echoRift', caravan: 'vaultbreakers', rivalCrowns: 'secondCrown', fault: 'wound', emberRelay: 'blackout',
  pactAltar: 'pactAltar', orchard: 'orchard', ring: 'ring', host: 'host', anvil: 'anvil', bellwatch: 'bellwatch',
};

/** The reverse: which tree encounter id a finished event of this kind credits (first completion = one Atlas point). */
export function atlasEventIdOf(kind: MapEventKind): string | undefined {
  return Object.keys(ATLAS_EVENT_TO_KIND).find(id => ATLAS_EVENT_TO_KIND[id] === kind);
}

export interface MapEventRuleSet {
  slate: MapEventSlateModifiers & { mandatory?: boolean };
  sim: MapEventModifiers;
}

/** Danger mods make the trophies of measured events (Stalker whiffs) count more: each active danger mod is +1 to the tally. */
export function dangerModCount(map: MapItem): number {
  let n = 0;
  for (const m of new Set(map.mods.map(x => x.modId))) if (getMapMod(m)?.kind === 'danger') n++;
  return n;
}

export function mapEventRules(atlas: AtlasRules, map?: MapItem): MapEventRuleSet {
  const slate: MapEventRuleSet['slate'] = {};
  const sim: MapEventModifiers = {};
  let reward = 1;
  for (const { rule } of atlas.extraRules) {
    switch (rule.id) {
      case 'eventSlots':
        slate.extraSlots = (slate.extraSlots ?? 0) + rule.extra;
        reward *= 1 + rule.rewardMore / 100;
        break;
      case 'eventsAlways':
        slate.chance = 1;
        slate.mandatory = rule.mandatory;
        reward *= 1 + rule.rewardMore / 100;
        if (rule.timeoutSeconds > 0) sim.timeoutSeconds = rule.timeoutSeconds;
        break;
      case 'eventSmall':
        if (rule.effect === 'ingredientChance') sim.ingredientChance = (sim.ingredientChance ?? 0) + rule.value;
        else if (rule.effect === 'timers') sim.timerScale = (sim.timerScale ?? 1) + rule.value;
        else if (rule.effect === 'gradeEase') sim.gradeEase = (sim.gradeEase ?? 0) + rule.value;
        break;
      case 'eventLens':
        switch (ATLAS_EVENT_TO_KIND[rule.event]) {
          case 'hunted': sim.whiffMultiplier = 2; sim.stalkerLife = 1.1; break;
          case 'echoRift': sim.echoTolerance = (sim.echoTolerance ?? 0) + 2; sim.echoLife = (sim.echoLife ?? 1) * 1.1; break;
          case 'vaultbreakers': sim.lockLife = 0.8; sim.caravanSpeed = 1.1; break;
          case 'secondCrown': sim.rivalLife = 1.15; sim.rivalUnique = 1.5; break;
          case 'wound': sim.faultMonsterDamage = 1.5; sim.faultPreview = 1; break;
          case 'blackout': sim.relayWick = 1.3; sim.relayBearers = 1; break;
          case 'pactAltar': sim.pactExtra = 1; break;
          case 'orchard': sim.bloomRipen = 1.25; sim.bloomTarget = 1.2; break;
          case 'ring': sim.gradeEase = (sim.gradeEase ?? 0) + 0.15; sim.championLife = 1.2; break;
          case 'host': sim.thawRate = 0.8; sim.hostCount = 1.15; break;
          case 'anvil': sim.anvilBoons = 1; sim.anvilCost = 1.2; break;
          case 'bellwatch': sim.tollScale = 1.15; sim.cantorLife = 1.15; break;
          default: break;
        }
        break;
      case 'voidBreach':
        // Voidtouched Atlas: a corrupted map always rolls a Void Breach; the strength scales its tide and its pay.
        if (map?.corrupted) slate.forced = ['voidBreach'];
        sim.voidStrength = (sim.voidStrength ?? 0) + rule.strength;
        break;
      default:
        break;
    }
  }
  if (reward !== 1) sim.rewardMultiplier = reward;
  if (map) { const tally = dangerModCount(map); if (tally > 0) sim.tally = tally; }
  return { slate, sim };
}
