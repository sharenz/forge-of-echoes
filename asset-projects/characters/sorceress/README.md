# Sorceress asset-production project

This directory contains the versioned manifest and reusable AI prompt kit. Heavy source media is deliberately stored under the gitignored `art-source/characters/sorceress/` directory.

Run the interactive guide from the repository root:

```bash
npm run assets
# or, after npm link
crafty-assets
```

## Workflow

1. Generate and approve the master design with GPT Image.
2. Generate south, north, and east reference images from that master.
3. Animate each approved direction reference with Veo.
4. Review the generated video and synchronized sound before accepting it.
5. Save approved media under the exact filenames below.
6. Let the CLI validate progress and build review sprite sheets with the deterministic packer.

## Required source files

- Master image: `art-source/characters/sorceress/references/master.png`
- south reference: `art-source/characters/sorceress/references/south.png`
- north reference: `art-source/characters/sorceress/references/north.png`
- east reference: `art-source/characters/sorceress/references/east.png`

Core videos (12):

- `art-source/characters/sorceress/videos/south/idle.mp4`
- `art-source/characters/sorceress/videos/south/run.mp4`
- `art-source/characters/sorceress/videos/south/attack.mp4`
- `art-source/characters/sorceress/videos/south/cast.mp4`
- `art-source/characters/sorceress/videos/north/idle.mp4`
- `art-source/characters/sorceress/videos/north/run.mp4`
- `art-source/characters/sorceress/videos/north/attack.mp4`
- `art-source/characters/sorceress/videos/north/cast.mp4`
- `art-source/characters/sorceress/videos/east/idle.mp4`
- `art-source/characters/sorceress/videos/east/run.mp4`
- `art-source/characters/sorceress/videos/east/attack.mp4`
- `art-source/characters/sorceress/videos/east/cast.mp4`

Extended videos (9, prepared for later runtime support):

- `art-source/characters/sorceress/videos/south/dash.mp4`
- `art-source/characters/sorceress/videos/south/hit.mp4`
- `art-source/characters/sorceress/videos/south/death.mp4`
- `art-source/characters/sorceress/videos/north/dash.mp4`
- `art-source/characters/sorceress/videos/north/hit.mp4`
- `art-source/characters/sorceress/videos/north/death.mp4`
- `art-source/characters/sorceress/videos/east/dash.mp4`
- `art-source/characters/sorceress/videos/east/hit.mp4`
- `art-source/characters/sorceress/videos/east/death.mp4`

Do not copy generated assets over the live game files until they have been visually approved in the generated contact sheets and in a dedicated in-game comparison.
