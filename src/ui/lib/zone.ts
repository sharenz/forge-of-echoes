// Zone naming for the banner and compact zone label. Pure; covered by tests/ui/helpers.test.ts.
import { possessive } from './format';

export interface ZoneSource {
  zone: 'hideout' | 'map';
  zoneOwnerName: string;
  zoneIsOwn: boolean;
  run: { mapName: string; tier: number } | null;
}

export interface ZoneLabel {
  /** Large line: "Your Hideout", "Mira's Hideout", "Ashen Forge". */
  title: string;
  /** Small line under it: "Tier 3", "Tier 3 · Mira's map", or null. */
  subtitle: string | null;
  /** Stable identity used to re-trigger the entry banner only when the zone really changes. */
  key: string;
}

export function zoneLabel(z: ZoneSource): ZoneLabel {
  if (z.zone === 'hideout') {
    const title = z.zoneIsOwn ? 'Your Hideout' : `${possessive(z.zoneOwnerName)} Hideout`;
    return { title, subtitle: z.zoneIsOwn ? null : 'Visiting a party member', key: `hideout:${z.zoneOwnerName}` };
  }
  const mapName = z.run?.mapName ?? 'Unknown Map';
  const tier = z.run?.tier ?? 0;
  const tierText = tier > 0 ? `Tier ${tier}` : null;
  const owner = z.zoneIsOwn ? null : `${possessive(z.zoneOwnerName)} map`;
  const subtitle = [tierText, owner].filter(Boolean).join(' · ') || null;
  return { title: mapName, subtitle, key: `map:${z.zoneOwnerName}:${mapName}:${tier}` };
}
