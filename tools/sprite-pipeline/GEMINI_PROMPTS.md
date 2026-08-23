# Legacy Sorceress prompt notes

The maintained workflow and generated prompt kit now live behind the interactive asset forge:

```bash
npm run assets
```

See `ASSET_PIPELINE.md`. The notes below remain as historical context for the current v3 sheets; use the CLI-generated prompts for new source media.

Target: replace `/player-sorceress-locomotion-v3.png` + `/player-sorceress-actions-v3.png`
(both 8 columns × 6 rows, 304 px cells) with generated frames. West is mirrored east, so only
south / north / east are needed. **12 clips total**: 3 directions × (idle, run, attack, cast).

## Step 1 — Design her (iterate here, this fixes everything downstream)

In Gemini (image generation), iterate until you love her:

> Full-body character concept for a dark-fantasy action RPG: an ember sorceress, keeper of embers.
> Elegant dark-purple and charcoal layered robes with glowing orange ember trim, long black hair with
> smoldering ember glints, ornate flame staff with a floating fire orb. Painted style, rich contrast,
> dramatic rim light from the staff flame. Confident stance, full body visible head to toe, front view,
> plain neutral background. High detail concept art, no text.

Tweak freely (hair, palette, silhouette) — everything after this step reuses the image you pick.

## Step 2 — The three direction stills (attach the chosen image each time)

> Same exact character, unchanged design, colors and proportions: full body head to toe, standing in a
> relaxed neutral stance, centered with margin, on a perfectly flat solid bright green (#00FF00)
> chroma-key studio background, no ground shadow, even lighting, no text.
> …front view, facing the camera.            ← south
> …seen directly from behind, facing away.   ← north
> …side profile view, facing right.          ← east

Check: same costume in all three, feet visible, background truly flat green.

## Step 3 — Veo clips (attach the matching direction still per clip)

Common block — start every prompt with it:

> Static locked-off camera, no zoom, no pan, no cuts. The character stays centered and does not travel
> across the frame. The flat bright green chroma-key background stays uniform, no shadows on the ground,
> no lighting changes. Exact same character design, size and proportions throughout.

Then per action (audio line included — Veo generates the sound, we harvest it as game SFX):

- **idle** — "Subtle idle animation: slow breathing, slight weight shifts, hair and robes swaying gently,
  the staff flame flickering softly. Audio: soft fire crackle only."
- **run** — "She runs in place as if on a treadmill, a determined running cycle, robes and hair flowing
  with the motion. Audio: quick light footsteps on stone, cloth rustle."
- **attack** — "She thrusts her staff forward in one sharp strike, then returns to her stance.
  No projectiles and no spell effects leave the staff — only her body motion and the staff's small flame.
  Audio: a sharp fiery whoosh with a crackling impact."
- **cast** — "She raises the staff overhead with both hands, gathering power, then sweeps it down,
  returning to her stance. No projectiles and no spell effects leave the staff. Audio: a rising magical
  hum ending in a deep fiery burst."

(VFX like the actual fireball are rendered by the game engine on top — that's why the clips must not
contain projectiles; the *sound* of the spell is exactly what we want, though.)

## Step 4 — Save & hand over

Save to `~/Downloads/sorceress/` as `<direction>_<action>.mp4`, e.g. `south_idle.mp4` … `east_cast.mp4`.
Then Claude runs (per sheet, rows in config order, `--size 304`):

```
python3 tools/sprite-pipeline/pack_sprite_sheet.py --name player-sorceress-locomotion --out public --size 304 --pingpong \
  south-idle=~/Downloads/sorceress/south_idle.mp4 south-run=~/Downloads/sorceress/south_run.mp4 \
  north-idle=~/Downloads/sorceress/north_idle.mp4 north-run=~/Downloads/sorceress/north_run.mp4 \
  east-idle=~/Downloads/sorceress/east_idle.mp4   east-run=~/Downloads/sorceress/east_run.mp4
```

(same for the actions sheet without `--pingpong`; run cycles use `--trim` to cut one clean stride instead
of ping-pong), extracts each clip's audio as `.m4a` SFX, updates `character-animations.ts` (including a
real 8-frame idle instead of the current frozen pose), and wires the samples into `SkillAudio`.

Start with ONE clip (south idle) end-to-end before generating all 12.
