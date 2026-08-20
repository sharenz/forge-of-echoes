#!/usr/bin/env python3
"""Run the monster image-to-video workflow against a ComfyUI server from the command line.

    python3 tools/sprite-pipeline/run_i2v.py --image ~/Desktop/ashling.png --name ashling --actions idle walk --pack

What it does, per action:
  1. uploads the still to ComfyUI (POST /upload/image),
  2. patches monster-i2v.api.json (image, prompt, length, seed, output prefixes) and queues it (POST /prompt),
  3. waits for the job (GET /history/<id>), downloads every produced frame + the MP4 preview (GET /view),
  4. optionally runs pack_sprite_sheet.py on the downloaded frames (--pack).

Needs only the Python standard library. ComfyUI host: --host, or COMFY_HOST env, default http://127.0.0.1:8188.
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import random
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from prompts import MOTIONS, build_prompt  # noqa: E402

API_TEMPLATE = HERE / "monster-i2v.api.json"
VALID_LENGTHS = (22, 39, 56, 73, 90, 107, 124)
TURBO_LORA = "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors"
TURBO_STEPS = 8


class Comfy:
    def __init__(self, host: str):
        self.host = host.rstrip("/")
        self.client_id = str(uuid.uuid4())

    def _request(self, path: str, data: bytes | None = None, headers: dict | None = None, method: str | None = None):
        req = urllib.request.Request(self.host + path, data=data, headers=headers or {}, method=method)
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return resp.read(), resp.headers
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", "replace")
            raise SystemExit(f"ComfyUI {path} -> HTTP {error.code}:\n{pretty_error(body)}") from None
        except urllib.error.URLError as error:
            raise SystemExit(f"Cannot reach ComfyUI at {self.host} ({error.reason}). Start it (e.g. `comfy launch`) "
                             f"or pass --host http://<machine>:8188") from None

    def get_json(self, path: str):
        body, _ = self._request(path)
        return json.loads(body)

    def post_json(self, path: str, payload: dict):
        body, _ = self._request(path, json.dumps(payload).encode(), {"Content-Type": "application/json"}, "POST")
        return json.loads(body)

    def upload_image(self, image: Path) -> str:
        boundary = "----crafty" + uuid.uuid4().hex
        mime = mimetypes.guess_type(image.name)[0] or "application/octet-stream"
        parts = [
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{image.name}\"\r\n"
            f"Content-Type: {mime}\r\n\r\n".encode() + image.read_bytes() + b"\r\n",
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue\r\n".encode(),
            f"--{boundary}--\r\n".encode(),
        ]
        body, _ = self._request("/upload/image", b"".join(parts), {"Content-Type": f"multipart/form-data; boundary={boundary}"}, "POST")
        info = json.loads(body)
        return info["name"] if not info.get("subfolder") else f"{info['subfolder']}/{info['name']}"

    def queue(self, prompt: dict) -> str:
        result = self.post_json("/prompt", {"prompt": prompt, "client_id": self.client_id})
        if result.get("node_errors"):
            raise SystemExit("ComfyUI rejected the workflow:\n" + json.dumps(result["node_errors"], indent=2))
        return result["prompt_id"]

    def wait(self, prompt_id: str, label: str, poll: float = 3.0) -> dict:
        started = time.time()
        last_line = ""
        while True:
            history = self.get_json(f"/history/{prompt_id}")
            if prompt_id in history:
                entry = history[prompt_id]
                status = entry.get("status", {})
                if status.get("status_str") == "error" or (status.get("completed") is False and status.get("status_str")):
                    raise SystemExit(f"{label}: ComfyUI reported an error:\n{format_messages(status.get('messages', []))}")
                print(f"\r{label}: done in {time.time() - started:5.0f}s{' ' * 20}")
                return entry
            queue = self.get_json("/queue")
            running = any(item[1] == prompt_id for item in queue.get("queue_running", []))
            position = next((index for index, item in enumerate(queue.get("queue_pending", [])) if item[1] == prompt_id), None)
            state = "running" if running else (f"queued #{position + 1}" if position is not None else "waiting")
            line = f"\r{label}: {state} … {time.time() - started:4.0f}s"
            if line != last_line:
                sys.stdout.write(line)
                sys.stdout.flush()
                last_line = line
            time.sleep(poll)

    def available(self, class_type: str, input_name: str) -> list[str]:
        """Filenames the server offers for a loader's combo input (e.g. UNETLoader/unet_name)."""
        info = self.get_json(f"/object_info/{class_type}")
        options = info.get(class_type, {}).get("input", {}).get("required", {}).get(input_name, [[]])[0]
        return list(options) if isinstance(options, list) else []

    def download(self, file_info: dict, target: Path) -> Path:
        query = urllib.parse.urlencode({"filename": file_info["filename"], "subfolder": file_info.get("subfolder", ""),
                                        "type": file_info.get("type", "output")})
        body, _ = self._request(f"/view?{query}")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
        return target


def pretty_error(body: str) -> str:
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return body
    lines = []
    if "error" in data:
        err = data["error"]
        lines.append(f"{err.get('type', 'error')}: {err.get('message', '')} {err.get('details', '')}".strip())
    for node_id, node_error in (data.get("node_errors") or {}).items():
        lines.append(f"node {node_id} ({node_error.get('class_type')}):")
        for item in node_error.get("errors", []):
            lines.append(f"  - {item.get('message')} {item.get('details', '')}".rstrip())
    return "\n".join(lines) or body


def format_messages(messages: list) -> str:
    for kind, payload in messages:
        if kind == "execution_error":
            return f"{payload.get('node_type')} (node {payload.get('node_id')}): {payload.get('exception_message')}"
    return json.dumps(messages, indent=2)


def find_node(prompt: dict, class_type: str) -> str:
    for node_id, node in prompt.items():
        if node["class_type"] == class_type:
            return node_id
    raise SystemExit(f"{API_TEMPLATE.name} has no {class_type} node")


def build_job(template: dict, image_name: str, action: str, args, seed: int) -> dict:
    prompt = json.loads(json.dumps(template))
    prompt[find_node(prompt, "LoadImage")]["inputs"]["image"] = image_name
    h3 = prompt[find_node(prompt, "MiniMaxH3ImageToVideo")]["inputs"]
    h3["prompt"] = build_prompt(action, args.key, motion=args.motion if len(args.actions) == 1 else None)
    h3["length"] = args.length
    h3["width"] = h3["height"] = args.canvas
    scale = prompt[find_node(prompt, "ImageScale")]["inputs"]
    scale["width"] = scale["height"] = args.canvas
    if args.unet:
        prompt[find_node(prompt, "UNETLoader")]["inputs"]["unet_name"] = args.unet
    prompt[find_node(prompt, "RandomNoise")]["inputs"]["noise_seed"] = seed
    prompt[find_node(prompt, "BasicScheduler")]["inputs"]["steps"] = args.steps
    if args.turbo:
        # LoraLoaderModelOnly between the UNET loader and everything that consumes MODEL (guider + scheduler)
        unet_id = find_node(prompt, "UNETLoader")
        lora_id = "turbo_lora"
        prompt[lora_id] = {"class_type": "LoraLoaderModelOnly", "_meta": {"title": "H3 turbo 8-step LoRA"},
                           "inputs": {"model": [unet_id, 0], "lora_name": TURBO_LORA, "strength_model": 1.0}}
        for node_id, node in prompt.items():
            if node_id == lora_id:
                continue
            for key, value in node["inputs"].items():
                if isinstance(value, list) and value[0] == unet_id:
                    node["inputs"][key] = [lora_id, 0]
    prompt[find_node(prompt, "SaveImage")]["inputs"]["filename_prefix"] = f"sprites/{args.name}_{action}/frame"
    prompt[find_node(prompt, "SaveVideo")]["inputs"]["filename_prefix"] = f"sprites/preview/{args.name}_{action}"
    return prompt


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--image", required=True, type=Path, help="monster still (flat green/magenta background)")
    parser.add_argument("--name", required=True, help="monster id, e.g. ashling")
    parser.add_argument("--actions", nargs="+", default=["idle"], choices=sorted(MOTIONS), help="clips to generate (default idle)")
    parser.add_argument("--motion", help="override the motion sentence (only with a single action)")
    parser.add_argument("--length", type=int, default=39, help=f"frames, one of {VALID_LENGTHS} (default 39)")
    parser.add_argument("--steps", type=int, help="sampler steps (default 20, or 8 with --turbo)")
    parser.add_argument("--unet", help="H3 diffusion model filename on the server (default: the template's; "
                                       "auto-picks the installed minimax_h3_fl2va_* file if that one is missing)")
    parser.add_argument("--turbo", action="store_true", help=f"use the {TURBO_LORA} LoRA (4-8 steps, ~2.5x faster)")
    parser.add_argument("--canvas", type=int, default=768, help="square canvas in px, multiple of 32 (default 768 = H3 native; 512 for quick drafts)")
    parser.add_argument("--seed", type=int, help="fixed seed (default: random per action, printed)")
    parser.add_argument("--key", choices=["green", "magenta"], default="green", help="background colour in the still")
    parser.add_argument("--host", default=os.environ.get("COMFY_HOST", "http://127.0.0.1:8188"), help="ComfyUI base URL")
    parser.add_argument("--out", type=Path, default=Path("~/Downloads/sprites").expanduser(), help="where to download frames")
    parser.add_argument("--pack", action="store_true", help="run pack_sprite_sheet.py on the downloaded frames")
    parser.add_argument("--pack-args", default="", help="extra args for pack_sprite_sheet.py, e.g. \"--size 304 --frames 6\"")
    args = parser.parse_args()
    sys.stdout.reconfigure(line_buffering=True)  # keep progress lines ordered with subprocess output

    if args.steps is None:
        args.steps = TURBO_STEPS if args.turbo else 20
    if args.length not in VALID_LENGTHS:
        parser.error(f"--length must be one of {VALID_LENGTHS} (MiniMax H3 uses 17k+5 frames)")
    if args.canvas % 32 or args.canvas < 256:
        parser.error("--canvas must be a multiple of 32 and at least 256")
    if args.motion and len(args.actions) != 1:
        parser.error("--motion can only be used with a single --actions value")
    if not args.image.is_file():
        parser.error(f"image not found: {args.image}")

    template = json.loads(API_TEMPLATE.read_text())
    comfy = Comfy(args.host)
    installed = comfy.available("UNETLoader", "unet_name")
    wanted = args.unet or template[find_node(template, "UNETLoader")]["inputs"]["unet_name"]
    if installed and wanted not in installed:
        candidates = [name for name in installed if "minimax_h3_fl2va" in name.lower()]
        if args.unet or len(candidates) != 1:
            raise SystemExit(f"{wanted} is not installed on {args.host}. Available H3 models: {candidates or installed}")
        print(f"note: {wanted} not installed, using {candidates[0]}")
        args.unet = candidates[0]
    image_name = comfy.upload_image(args.image)
    print(f"uploaded {args.image.name} -> ComfyUI input/{image_name}")

    jobs = []
    for action in args.actions:
        seed = args.seed if args.seed is not None else random.randrange(0, 2**53)
        prompt_id = comfy.queue(build_job(template, image_name, action, args, seed))
        print(f"{args.name}/{action}: queued {prompt_id} (seed {seed}, {args.length} frames)")
        jobs.append((action, prompt_id, seed))

    frame_dirs = {}
    for action, prompt_id, seed in jobs:
        entry = comfy.wait(prompt_id, f"{args.name}/{action}")
        frames_dir = args.out / f"{args.name}_{action}"
        count = 0
        for node_output in entry.get("outputs", {}).values():
            for value in node_output.values():
                if not isinstance(value, list):
                    continue
                for file_info in value:
                    if not isinstance(file_info, dict) or "filename" not in file_info:
                        continue
                    name = file_info["filename"]
                    if name.lower().endswith(".png"):
                        comfy.download(file_info, frames_dir / name)
                        count += 1
                    else:
                        comfy.download(file_info, args.out / "preview" / name)
        (frames_dir / "run.json").parent.mkdir(parents=True, exist_ok=True)
        (frames_dir / "run.json").write_text(json.dumps({"prompt_id": prompt_id, "seed": seed, "length": args.length,
                                                         "steps": args.steps, "action": action, "image": args.image.name}, indent=2) + "\n")
        print(f"{args.name}/{action}: {count} frames -> {frames_dir}  (preview in {args.out / 'preview'})")
        frame_dirs[action] = frames_dir

    if args.pack:
        command = [sys.executable, str(HERE / "pack_sprite_sheet.py"), "--name", args.name, "--key", args.key,
                   *args.pack_args.split(), *[f"{action}={path}" for action, path in frame_dirs.items()]]
        print("packing:", " ".join(command))
        subprocess.run(command, check=True)


if __name__ == "__main__":
    main()
