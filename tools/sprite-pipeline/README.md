# Sprite pipeline: still image → MiniMax H3 video → sprite sheet

Turns one monster illustration into a looping sprite sheet (rows = actions, columns = frames)
that `CharacterAnimator` / Phaser can play, plus an animated WebP per action for UI spots.

```
ChatGPT still (flat green bg)  →  ComfyUI: monster-i2v.workflow.json  →  39 PNG frames
        →  pack_sprite_sheet.py  →  <name>-sheet.png + <name>-<action>.webp + <name>.json
```

## 1. Make the still (ChatGPT image)

Prompt skeleton — keep it identical across monsters so they match:

> Full-body game monster illustration, "<monster description>", painted fantasy ARPG style
> matching <attach an existing monster PNG as style reference>, facing right, three-quarter side
> view, neutral idle stance, whole creature visible and centered with margin, **perfectly flat
> solid bright green background (#00FF00), no ground shadow, no text, no border**, 1024×1024.

Green-coloured monster? Use magenta `#FF00FF` instead and pass `--key magenta` later.

## 2. Animate it (ComfyUI)

1. ComfyUI → *Workflow → Open* → `tools/sprite-pipeline/monster-i2v.workflow.json`.
   Only core nodes are used; the models are the same as the official H3 I2V template
   (`minimax_h3_fl2va_pruned_int8_convrot`, `qwen3vl_32b_minimax_h3_nvfp4_awq`, `minimax_h3_video_vae_fp16`).
2. **Load Image** → upload the still. It is wired into `first_frame` **and** `last_frame`, which is what makes the clip loop.
3. In the H3 node edit only the *motion* sentence of the prompt (idle / walk / attack examples are in the note inside the workflow).
   Keep the "locked camera / flat green background / ends on the starting pose" lines.
4. `length` must be 22, 39, 56 or 73 (17k+5 frames @ 24 fps). 39 ≈ 1.6 s is right for idle/walk.
5. **Save Image** `filename_prefix` → one folder per action, e.g. `sprites/ashling_idle/frame`, `sprites/ashling_walk/frame`.
6. Queue once per action. Check the MP4 preview (`output/sprites/preview/...`); re-roll the seed if the creature drifts,
   changes design, or the background gets texture.

## 2b. Or run it from the CLI (no clicking)

`run_i2v.py` drives a running ComfyUI over its HTTP API — upload the still, queue one job per action, wait,
download the frames + MP4 preview, and (with `--pack`) build the sheet in one go:

```
# ComfyUI on this machine (default http://127.0.0.1:8188) or remote via --host / COMFY_HOST
python3 tools/sprite-pipeline/run_i2v.py --image ~/Desktop/ashling.png --name ashling --actions idle walk --pack
python3 tools/sprite-pipeline/run_i2v.py --host http://gpu-box:8188 --image ashling.png --name ashling \
    --actions idle walk attack --length 39 --seed 1234 --out ~/Downloads/sprites --pack --pack-args "--size 304"
```

Actions: `idle`, `walk`, `attack`, `hit` (prompts live in `prompts.py`; `--motion "…"` overrides the motion
sentence for a single action). Each run writes `run.json` (prompt_id, seed, length) next to the frames so a good
result can be reproduced with `--seed`. Standard library only — no pip installs.

Speed knobs (matter a lot on a Mac / MPS): `--turbo` inserts the `minimax_h3_fl2v_turbo_8step` LoRA and runs
8 steps instead of 20 (4–8 supported, strength 1.0); `--canvas 512` renders a smaller square for quick drafts
(768 is H3's native short edge); `--length 22` is the shortest clip. Note the H3 node's own tooltip says the
trained range is ~124–362 frames — short clips are allowed but less tested, so if 22/39 look bad try 124 and let
the packer pick 8 frames out of it.

Alternative without the script: `comfy run --workflow tools/sprite-pipeline/monster-i2v.api.json --wait --host … --port …`
([comfy-cli](https://github.com/Comfy-Org/comfy-cli), `pip install comfy-cli`). That runs the API-format file as-is,
so first upload the still through the UI (or copy it to `ComfyUI/input/`) and set `LoadImage.image`,
the prompt and the two `filename_prefix` values in the JSON by hand. `build_workflow.py` regenerates both JSON files.

## 3. Pack the sheet (this machine)

```
python3 tools/sprite-pipeline/pack_sprite_sheet.py --name ashling \
    idle=~/Downloads/sprites/ashling_idle walk=~/Downloads/sprites/ashling_walk
```

Defaults: 8 frames per action, 256 px cells, 10 fps preview, green key, output to `public/monsters/`.
The last video frame is skipped automatically (it equals the first). All actions share one crop box
so idle/walk/attack stay registered on screen. Useful flags: `--size 304`, `--frames 6`, `--key magenta`,
`--key-high 0.45` (stronger key if green remains), `--erode 0` (if thin parts vanish), `--out <dir>`.

Outputs:

- `ashling-sheet.png` — RGBA sprite sheet, row per action in the order given
- `ashling-idle.webp`, `ashling-walk.webp` — looping previews for tooltips / bestiary / UI
- `ashling.json` — `frameWidth/Height`, `columns`, and a `clips` block shaped like `character-animations.ts`

## 4. Register in the game

Add a `monster-animations.ts` mirroring `character-animations.ts` (`sheets` + `clips` with `row`, `startColumn`,
`frameCount`, `frameRate`) and load it with `load.spritesheet(...)` like the player sheets. Left-facing is `setFlipX`,
so never generate a "walk left" clip. Hit / death / spawn are cheaper and more consistent as procedural effects
(tint flash, squash, fade into the existing `-corpse.png`) than as generated clips.

`build_workflow.py` regenerates `monster-i2v.workflow.json` (layout, default prompt, wiring) — edit it rather than
hand-editing the JSON if you want to change the graph structurally.
