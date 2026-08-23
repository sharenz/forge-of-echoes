# Forge of Echoes asset forge

`crafty-assets` is the interactive production guide for AI-assisted game art. It begins by asking what kind of asset you want to create, then supplies the appropriate workflow, prompts, expected filenames, progress checks, and deterministic conversion tooling.

The Sorceress character pipeline is enabled first. Character classes, monsters, portals, and world objects share the same top-level project model so their specialized flows can be added without redesigning the CLI.

## Start the wizard

```bash
npm run assets
```

After linking the repository package, it is also available globally:

```bash
npm link
crafty-assets
```

The first screen asks what you want to create. Choose **Character**, followed by **Sorceress**.

Useful non-interactive checks:

```bash
crafty-assets --init-sorceress
crafty-assets --status
```

## Directory contract

The CLI creates two deliberately separate areas:

```text
asset-projects/characters/sorceress/    versioned manifest, prompts, and guide
art-source/characters/sorceress/        ignored heavyweight source media and builds
```

`asset-projects/` belongs in Git. It makes the creative brief and production contract reproducible.

`art-source/` is ignored because source images, videos, extracted audio, and review sheets can be large. Store important originals in backed-up object storage if they must survive beyond the local workstation.

## Guided workflow

The wizard advances by detecting approved media at exact paths:

1. Master Sorceress design from GPT Image.
2. South, north, and east identity references from GPT Image.
3. Core idle, run, attack, and cast clips from Veo, including generated sound.
4. Optional dash, hit, and death clips prepared for later runtime support.
5. Candidate sheet, WebP preview, metadata, and audio extraction through the existing deterministic Python packer.

Every prompt can be printed or copied from the terminal. Approved outputs should be saved at the destination shown by the wizard; status updates automatically without a separate “mark complete” database.

## Review builds are intentionally safe

The **Build candidate sheets** command writes only to:

```text
art-source/characters/sorceress/build/
```

It does not overwrite the current production sprites. Inspect the candidate sheets, animated WebP previews, and extracted audio first. Installing approved assets into `public/` and updating runtime metadata is a separate, deliberate step.

The packer requires Python 3, Pillow, NumPy, and FFmpeg. It extracts video frames and audio, removes the chroma background, despills colored edges, applies one shared crop per sheet, produces review animations, and emits animation metadata.

## Extending the forge

Asset-specific definitions live under `scripts/crafty-assets/`. A future asset type supplies:

- its identity/design prompts;
- required reference views;
- animation or state definitions;
- expected source filenames;
- processing and validation commands;
- runtime installation rules.

Generic terminal interaction, progress reporting, prompt browsing, clipboard support, and safe review output remain shared.
