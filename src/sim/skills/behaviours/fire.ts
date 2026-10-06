// Fire skill behaviours (data for the executor). Projectile speeds, ranges and radii are the fallbacks for a runtime def that
// leaves them at 0; the rules always fill speed and range.
import { SKILL_TIMING } from '../../../data/progression/skill-timing';
import type { SkillBehaviour } from '../types';

export const FIRE_BEHAVIOURS = {
  emberLance: {
    emitter: 'projectile', kind: 'emberLance', speed: 420, range: 320, radius: { fallback: 4 }, spread: 'extra', pierce: 'def',
    pierceAll: { skill: 'pierceAll', player: 'lancePierceAll' },
  },
  emberNova: {
    emitter: 'burst', kind: 'novaFlame', speed: 260, range: 170, radius: 5,
    fan: { skill: 'fan', player: 'novaFan' }, echo: { skill: 'echo', player: 'novaEcho' },
  },
  flameWave: {
    emitter: 'projectile', kind: 'flameWave', speed: 180, range: 170, radius: { fallback: 14 }, spread: 0.9, pierce: 'all',
    circle: { skill: 'circle', player: 'flameRing' },
  },
  cinderWard: {
    emitter: 'buff', buff: 'ward', duration: 5,
    restoreFocus: { skill: 'restoreFocus', player: 'wardFocus' }, renew: { skill: 'renew', player: 'wardRenew' },
  },
  cinderMortar: { emitter: 'lob', kind: 'cinderShell', flight: SKILL_TIMING.mortarFlight, range: 320, radius: 36 },
  // Roster batch 2 (SK3)
  immolationSigil: {
    emitter: 'pillar', telegraph: SKILL_TIMING.sigilTelegraph, reach: SKILL_TIMING.zoneReach, radius: 50, offset: SKILL_TIMING.sigilTwinOffset,
  },
} satisfies Record<string, SkillBehaviour>;
