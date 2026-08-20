#!/usr/bin/env python3
"""Turn ComfyUI video frames (monster on a flat green/magenta background) into game sprites.

    python3 tools/sprite-pipeline/pack_sprite_sheet.py --name ashling \
        idle=~/Downloads/comfy/sprites/ashling_idle walk=~/Downloads/comfy/sprites/ashling_walk

For each `action=dir` pair it:
  1. loads the frames (sorted), picks `--frames` evenly spaced ones (the last video frame is
     skipped because first_frame == last_frame in the workflow, so the loop closes itself),
  2. chroma-keys the flat background away (soft key + despill + optional 1px erode),
  3. crops every frame with ONE shared box (union of all frames, squared) so frames stay registered,
  4. resizes to `--size`,
and writes, next to the sprite folder you pass with --out:
  <name>-sheet.png   rows = actions (in the order given), columns = frames, RGBA
  <name>-<action>.webp   animated preview per action (loops, --fps)
  <name>.json        frameWidth/Height, columns, rows and a ready-to-paste animation config

Only Pillow + numpy are required (both already installed on this machine).
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

KEYS = {
    "green": (0, 1, 2),    # dominant channel, other two
    "magenta": None,       # handled separately: R and B high, G low
}


VIDEO_SUFFIXES = {".mp4", ".mov", ".webm", ".mkv", ".gif"}


def has_audio_stream(video: Path) -> bool:
    if not shutil.which("ffprobe"):
        return False
    result = subprocess.run(["ffprobe", "-loglevel", "error", "-select_streams", "a", "-show_entries",
                             "stream=codec_type", "-of", "csv=p=0", str(video)], capture_output=True, text=True)
    return "audio" in result.stdout


def extract_audio(video: Path, target: Path) -> bool:
    """Extract the audio track as AAC (.m4a plays everywhere incl. Safari). Returns True on success."""
    result = subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(video), "-vn",
                             "-c:a", "aac", "-b:a", "128k", str(target)], capture_output=True, text=True)
    return result.returncode == 0 and target.exists() and target.stat().st_size > 0


def load_frames(source: Path) -> list[Image.Image]:
    """Load frames from a directory of images OR extract them from a video file (needs ffmpeg)."""
    if source.is_file() and source.suffix.lower() in VIDEO_SUFFIXES:
        if not shutil.which("ffmpeg"):
            sys.exit("ffmpeg is required to read video files (brew install ffmpeg)")
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(source), "-vsync", "0",
                            f"{tmp}/frame_%05d.png"], check=True)
            files = sorted(Path(tmp).glob("frame_*.png"))
            if not files:
                sys.exit(f"ffmpeg extracted no frames from {source}")
            return [Image.open(f).convert("RGB").copy() for f in files]
    files = sorted(p for p in source.iterdir() if p.suffix.lower() in {".png", ".webp", ".jpg", ".jpeg"})
    if not files:
        sys.exit(f"no image frames found in {source}")
    return [Image.open(p).convert("RGB") for p in files]


def pick_indices(total: int, wanted: int, drop_last: bool) -> list[int]:
    usable = total - 1 if drop_last and total > 1 else total
    wanted = min(wanted, usable)
    return [int(round(i * usable / wanted)) for i in range(wanted)]


def key_alpha(rgb: np.ndarray, key: str, low: float, high: float) -> np.ndarray:
    """Return alpha in [0,1]. `rgb` is float32 HxWx3 in [0,1].
    Key strength = how much the key colour dominates; low/high are the soft threshold band."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    if key == "green":
        strength = g - np.maximum(r, b)
    elif key == "magenta":
        strength = np.minimum(r, b) - g
    else:
        raise ValueError(key)
    alpha = 1.0 - np.clip((strength - low) / max(high - low, 1e-6), 0.0, 1.0)
    return alpha


def despill(rgb: np.ndarray, alpha: np.ndarray, key: str) -> np.ndarray:
    """Pull the key colour out of semi-transparent edge pixels so they don't glow green/pink."""
    out = rgb.copy()
    r, g, b = out[..., 0], out[..., 1], out[..., 2]
    if key == "green":
        limit = np.maximum(r, b)
        out[..., 1] = np.where(g > limit, limit, g)
    else:
        limit = g
        out[..., 0] = np.where(r > limit, limit, r)
        out[..., 2] = np.where(b > limit, limit, b)
    # only touch pixels near the edge (partially transparent) or clearly spill-coloured
    edge = (alpha < 0.999)[..., None]
    return np.where(edge, out, rgb)


def to_rgba(frame: Image.Image, key: str, low: float, high: float, erode: int) -> Image.Image:
    rgb = np.asarray(frame, dtype=np.float32) / 255.0
    alpha = key_alpha(rgb, key, low, high)
    rgb = despill(rgb, alpha, key)
    a8 = Image.fromarray((alpha * 255).astype(np.uint8), "L")
    if erode > 0:
        a8 = a8.filter(ImageFilter.MinFilter(2 * erode + 1))
    rgba = np.dstack([(rgb * 255).astype(np.uint8), np.asarray(a8)])
    return Image.fromarray(rgba, "RGBA")


def union_box(frames: list[Image.Image], pad: int) -> tuple[int, int, int, int]:
    visible_lut = [0] * 9 + [255] * 247  # alpha > 8 counts as visible
    boxes = [f.getchannel("A").point(visible_lut).getbbox() for f in frames]
    boxes = [b for b in boxes if b]
    if not boxes:
        sys.exit("every frame keyed to fully transparent — wrong --key colour or the background is not flat")
    left = min(b[0] for b in boxes) - pad
    top = min(b[1] for b in boxes) - pad
    right = max(b[2] for b in boxes) + pad
    bottom = max(b[3] for b in boxes) + pad
    # square it around the centre so the sprite is not distorted when resized to a square cell
    w, h = right - left, bottom - top
    side = max(w, h)
    cx, cy = (left + right) / 2, (top + bottom) / 2
    return int(round(cx - side / 2)), int(round(cy - side / 2)), int(round(cx + side / 2)), int(round(cy + side / 2))


def crop_pad(frame: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    """Crop to box, padding with transparency where the box leaves the image."""
    left, top, right, bottom = box
    canvas = Image.new("RGBA", (right - left, bottom - top), (0, 0, 0, 0))
    canvas.alpha_composite(frame, (max(0, -left), max(0, -top)),
                           (max(0, left), max(0, top), min(frame.width, right), min(frame.height, bottom)))
    return canvas


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("actions", nargs="+", help="action=dir pairs, e.g. idle=./frames/idle walk=./frames/walk")
    parser.add_argument("--name", required=True, help="monster id used for output filenames, e.g. ashling")
    parser.add_argument("--out", default="public/monsters", help="output directory (default: public/monsters)")
    parser.add_argument("--frames", type=int, default=8, help="frames to keep per action (default 8)")
    parser.add_argument("--size", type=int, default=256, help="square cell size in px (default 256)")
    parser.add_argument("--fps", type=float, default=10, help="frame rate for the preview webp + json (default 10)")
    parser.add_argument("--key", choices=["green", "magenta"], default="green", help="background colour to remove")
    parser.add_argument("--key-low", type=float, default=0.08, help="key strength where alpha starts to drop (default 0.08)")
    parser.add_argument("--key-high", type=float, default=0.35, help="key strength where the pixel is fully removed (default 0.35)")
    parser.add_argument("--erode", type=int, default=1, help="shrink the alpha by N px to kill colour fringe (default 1, 0 = off)")
    parser.add_argument("--pad", type=int, default=12, help="padding around the union crop box in source px (default 12)")
    parser.add_argument("--keep-last", action="store_true", help="do not drop the last video frame (use when first != last)")
    parser.add_argument("--pingpong", action="store_true", help="append the reversed frames so non-looping clips loop (forward-then-back); implies --keep-last")
    parser.add_argument("--trim", default="0:1", help="use only this fraction range of the clip, e.g. 0.2:0.8 (default 0:1)")
    parser.add_argument("--no-audio", action="store_true", help="skip extracting audio tracks from video inputs")
    parser.add_argument("--mask", action="append", default=[], metavar="X0:Y0:X1:Y1",
                        help="zero out this region (fractions of the frame) after keying, e.g. 0.85:0.3:1:0.9 "
                             "to remove a watermark; repeatable")
    args = parser.parse_args()

    out_dir = Path(args.out).expanduser()
    out_dir.mkdir(parents=True, exist_ok=True)

    rows: list[tuple[str, list[Image.Image]]] = []
    for pair in args.actions:
        if "=" not in pair:
            sys.exit(f"expected action=dir, got {pair!r}")
        action, directory = pair.split("=", 1)
        frames = load_frames(Path(directory).expanduser())
        start_fraction, end_fraction = (float(v) for v in args.trim.split(":"))
        if not 0 <= start_fraction < end_fraction <= 1:
            sys.exit(f"bad --trim {args.trim!r}; expected start:end with 0 <= start < end <= 1")
        frames = frames[int(len(frames) * start_fraction):max(int(len(frames) * end_fraction), int(len(frames) * start_fraction) + 1)]
        wanted = (args.frames + 1) // 2 + 1 if args.pingpong else args.frames
        indices = pick_indices(len(frames), wanted, drop_last=not (args.keep_last or args.pingpong))
        if args.pingpong:
            indices = indices + indices[-2:0:-1]
        keyed = [to_rgba(frames[i], args.key, args.key_low, args.key_high, args.erode) for i in indices]
        for region in args.mask:
            x0, y0, x1, y1 = (float(v) for v in region.split(":"))
            for frame in keyed:
                empty = Image.new("RGBA", (max(1, int(frame.width * (x1 - x0))), max(1, int(frame.height * (y1 - y0)))), (0, 0, 0, 0))
                frame.paste(empty, (int(frame.width * x0), int(frame.height * y0)))
        rows.append((action, keyed))
        print(f"{action}: {len(frames)} source frames -> kept indices {indices}")
        source = Path(directory).expanduser()
        if not args.no_audio and source.is_file() and source.suffix.lower() in VIDEO_SUFFIXES and has_audio_stream(source):
            audio_path = Path(args.out).expanduser() / f"{args.name}-{action}.m4a"
            audio_path.parent.mkdir(parents=True, exist_ok=True)
            if extract_audio(source, audio_path):
                print(f"  wrote {audio_path} (audio track)")

    # one crop box shared by ALL actions so idle/walk/attack line up on screen
    box = union_box([f for _, frames in rows for f in frames], args.pad)
    print(f"crop box {box} -> cell {args.size}px")

    columns = max(len(frames) for _, frames in rows)
    sheet = Image.new("RGBA", (columns * args.size, len(rows) * args.size), (0, 0, 0, 0))
    meta_rows = {}
    for row_index, (action, frames) in enumerate(rows):
        cells = [crop_pad(f, box).resize((args.size, args.size), Image.Resampling.LANCZOS) for f in frames]
        for col, cell in enumerate(cells):
            sheet.alpha_composite(cell, (col * args.size, row_index * args.size))
        webp_path = out_dir / f"{args.name}-{action}.webp"
        cells[0].save(webp_path, save_all=True, append_images=cells[1:], duration=int(round(1000 / args.fps)),
                      loop=0, lossless=True, method=6)
        meta_rows[action] = {"row": row_index, "startColumn": 0, "frameCount": len(cells), "frameRate": args.fps, "repeat": -1}
        print(f"  wrote {webp_path}")

    sheet_path = out_dir / f"{args.name}-sheet.png"
    sheet.save(sheet_path, optimize=True)
    meta = {
        "url": f"/{os.path.relpath(sheet_path, 'public')}" if str(sheet_path).startswith("public") else sheet_path.name,
        "columns": columns,
        "frameWidth": args.size,
        "frameHeight": args.size,
        "clips": meta_rows,
    }
    meta_path = out_dir / f"{args.name}.json"
    meta_path.write_text(json.dumps(meta, indent=2) + "\n")
    print(f"  wrote {sheet_path}  ({sheet.width}x{sheet.height})")
    print(f"  wrote {meta_path}")


if __name__ == "__main__":
    main()
