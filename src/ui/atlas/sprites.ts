// The DOM UI receives only icon() and portrait() from the game (contracts/ui.ts), but the Atlas also draws the game's
// own floor tiles, props and monster sprites. It generates just those, once per page, in idle-sized slices so no
// single task blocks input (the whole generateSprites() is a ~0.5 s task). Deterministic, same code as the renderer.
import { useEffect, useState } from 'preact/hooks';
import type { SpriteDef } from '../../contracts/art';
import { ossuarySprites } from '../../art/bestiary';
import { coliseumSprites } from '../../art/bestiary/coliseum';
import { fxSprites } from '../../art/fx';
import { ashboundHeraldSprites } from '../../art/monsters/ashboundHerald';
import { ashlingSprites } from '../../art/monsters/ashling';
import { cinderMatriarchSprites } from '../../art/monsters/cinderMatriarch';
import { cinderSpitterSprites } from '../../art/monsters/cinderSpitter';
import { emberSkitterSprites } from '../../art/monsters/emberSkitter';
import { ironhideBruteSprites } from '../../art/monsters/ironhideBrute';
import { riftStalkerSprites } from '../../art/monsters/riftStalker';
import { propSprites } from '../../art/props';
import { tileSprites } from '../../art/tiles';

const SLICES: (() => SpriteDef[])[] = [
  tileSprites, propSprites, fxSprites,
  ashlingSprites, emberSkitterSprites, cinderSpitterSprites, riftStalkerSprites, ironhideBruteSprites, ashboundHeraldSprites, cinderMatriarchSprites,
  ossuarySprites, coliseumSprites,
];

let pending: Promise<SpriteDef[]> | null = null;
let loaded: SpriteDef[] | null = null;

export function loadAtlasSprites(): Promise<SpriteDef[]> {
  pending ??= (async () => {
    const out: SpriteDef[] = [];
    for (const slice of SLICES) {
      out.push(...slice());
      await new Promise<void>((res) => setTimeout(res, 0));
    }
    loaded = out;
    return out;
  })();
  return pending;
}

/** The sprites the Atlas needs, or null while they are still being generated. */
export function useAtlasSprites(): SpriteDef[] | null {
  const [sprites, setSprites] = useState<SpriteDef[] | null>(loaded);
  useEffect(() => {
    let live = true;
    if (!loaded) loadAtlasSprites().then((s) => { if (live) setSprites(s); });
    return () => { live = false; };
  }, []);
  return sprites;
}
