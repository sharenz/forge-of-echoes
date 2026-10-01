// Party wording helpers. Pure; covered by tests/ui/helpers.test.ts.
import type { PartyMemberInfo } from '../../contracts/net';
import { possessive } from './format';

/** Where a member is, from the reader's point of view ("In your hideout", "In Mira's hideout", "Ashen Forge T3"). */
export function locationText(m: PartyMemberInfo, myName: string): string {
  if (!m.online) return 'Offline';
  if (!m.zone) return 'Travelling';
  const map = `${m.zone.mapName ?? 'A map'}${m.zone.tier ? ` T${m.zone.tier}` : ''}`;
  if (m.zone.kind === 'map') {
    return m.zone.ownerName === m.name || m.zone.ownerName === myName ? map : `${map}, ${possessive(m.zone.ownerName)} map`;
  }
  if (m.zone.ownerName === myName) return m.name === myName ? 'In your hideout' : 'Visiting your hideout';
  if (m.zone.ownerName === m.name) return 'In their hideout';
  return `In ${possessive(m.zone.ownerName)} hideout`;
}
