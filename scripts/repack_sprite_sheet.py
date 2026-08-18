#!/usr/bin/env python3
"""Repack loosely generated animation art into deterministic, safe frame cells.

Image generators tend to place a sprite a few pixels across the requested grid
boundary. A renderer then slices that artwork into two frames. This utility finds
connected alpha components, assigns them to the frame where most of their pixels
live, and re-anchors each frame by the feet of its largest (character) component.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


@dataclass(frozen=True)
class Component:
    label: int
    area: int
    x: np.ndarray
    y: np.ndarray
    cell: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--columns", type=int, default=8)
    parser.add_argument("--rows", type=int, default=6)
    parser.add_argument("--cell-size", type=int, default=304)
    parser.add_argument("--alpha-threshold", type=int, default=12)
    parser.add_argument("--min-component-pixels", type=int, default=4)
    parser.add_argument("--bottom-padding", type=int, default=18)
    parser.add_argument("--safety-margin", type=int, default=3)
    return parser.parse_args()


def overlap_cell(
    x: np.ndarray,
    y: np.ndarray,
    source_cell_width: int,
    source_cell_height: int,
    columns: int,
    rows: int,
) -> int:
    column = np.clip(x // source_cell_width, 0, columns - 1)
    row = np.clip(y // source_cell_height, 0, rows - 1)
    cells = row * columns + column
    return int(np.bincount(cells, minlength=columns * rows).argmax())


def components_for_image(
    pixels: np.ndarray,
    columns: int,
    rows: int,
    alpha_threshold: int,
    min_component_pixels: int,
) -> tuple[list[Component], np.ndarray, int, int]:
    height, width = pixels.shape[:2]
    if width % columns or height % rows:
        raise ValueError(f"{width}x{height} is not divisible by {columns}x{rows}")
    source_cell_width = width // columns
    source_cell_height = height // rows
    labels, _ = ndimage.label(pixels[:, :, 3] >= alpha_threshold, np.ones((3, 3), dtype=np.uint8))
    objects = ndimage.find_objects(labels)
    components: list[Component] = []
    for label, slices in enumerate(objects, start=1):
        if slices is None:
            continue
        local_y, local_x = np.where(labels[slices] == label)
        if len(local_x) < min_component_pixels:
            continue
        x = local_x + slices[1].start
        y = local_y + slices[0].start
        cell = overlap_cell(x, y, source_cell_width, source_cell_height, columns, rows)
        components.append(Component(label=label, area=len(x), x=x, y=y, cell=cell))
    return components, labels, source_cell_width, source_cell_height


def foot_anchor(component: Component) -> tuple[int, int]:
    height = int(component.y.max() - component.y.min() + 1)
    lower_band = max(6, round(height * 0.18))
    near_feet = component.y >= component.y.max() - lower_band
    return round(float(np.median(component.x[near_feet]))), int(component.y.max())


def repack(args: argparse.Namespace) -> None:
    source = Image.open(args.input).convert("RGBA")
    pixels = np.asarray(source)
    components, labels, _, _ = components_for_image(
        pixels,
        args.columns,
        args.rows,
        args.alpha_threshold,
        args.min_component_pixels,
    )
    output_width = args.columns * args.cell_size
    output_height = args.rows * args.cell_size
    output = np.zeros((output_height, output_width, 4), dtype=np.uint8)
    target_anchor_x = args.cell_size // 2
    target_anchor_y = args.cell_size - args.bottom_padding - 1

    for cell in range(args.columns * args.rows):
        group = [component for component in components if component.cell == cell]
        if not group:
            raise ValueError(f"No artwork detected for frame {cell}")
        primary = max(group, key=lambda component: component.area)
        anchor_x, anchor_y = foot_anchor(primary)
        group_mask = np.isin(labels, [component.label for component in group])
        source_y, source_x = np.where(group_mask)
        destination_x = source_x - anchor_x + target_anchor_x + (cell % args.columns) * args.cell_size
        destination_y = source_y - anchor_y + target_anchor_y + (cell // args.columns) * args.cell_size
        cell_left = (cell % args.columns) * args.cell_size
        cell_top = (cell // args.columns) * args.cell_size
        relative_x = destination_x - cell_left
        relative_y = destination_y - cell_top
        margin = args.safety_margin
        if (
            relative_x.min() < margin
            or relative_y.min() < margin
            or relative_x.max() >= args.cell_size - margin
            or relative_y.max() >= args.cell_size - margin
        ):
            bounds = (relative_x.min(), relative_y.min(), relative_x.max(), relative_y.max())
            raise ValueError(f"Frame {cell} is unsafe after anchoring: {bounds}")
        output[destination_y, destination_x] = pixels[source_y, source_x]

    args.output.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(output, "RGBA").save(args.output, optimize=True)
    print(
        f"Repacked {args.input} -> {args.output}: "
        f"{args.columns}x{args.rows} frames at {args.cell_size}px, "
        f"feet anchored {args.bottom_padding}px above the bottom"
    )


if __name__ == "__main__":
    repack(parse_args())
