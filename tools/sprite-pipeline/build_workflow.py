"""Generate a flat, core-nodes-only ComfyUI workflow for MiniMax H3 image-to-video
tuned for looping game-sprite clips. Mirrors the official H3 I2V template's
internal graph (UNETLoader / CLIPLoader(minimax) / VAELoader / MiniMaxH3ImageToVideo /
RandomNoise / KSamplerSelect(res_multistep) / BasicScheduler(simple,20) / BasicGuider /
SamplerCustomAdvanced / VAEDecode) and adds: first_frame == last_frame wiring,
square 768 canvas, short 39-frame length, per-frame PNG output and an MP4 preview.
"""
import json
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from prompts import build_prompt  # noqa: E402

nodes = []
links = []
_next_node = [1]
_next_link = [1]


def node(type_, pos, size, widgets=None, inputs=(), outputs=(), title=None, color=None):
    n = {
        "id": _next_node[0],
        "type": type_,
        "pos": list(pos),
        "size": list(size),
        "flags": {},
        "order": len(nodes),
        "mode": 0,
        "inputs": [dict(i) for i in inputs],
        "outputs": [dict(o) for o in outputs],
        "properties": {"Node name for S&R": type_},
        "widgets_values": list(widgets or []),
    }
    if title:
        n["title"] = title
    if color:
        n["color"] = color
        n["bgcolor"] = color
    _next_node[0] += 1
    nodes.append(n)
    return n


def inp(name, type_, widget=False):
    d = {"name": name, "type": type_, "link": None}
    if widget:
        d["widget"] = {"name": name}
    return d


def out(name, type_):
    return {"name": name, "type": type_, "links": []}


def link(src, src_slot, dst, dst_slot, type_):
    lid = _next_link[0]
    _next_link[0] += 1
    links.append([lid, src["id"], src_slot, dst["id"], dst_slot, type_])
    src["outputs"][src_slot]["links"].append(lid)
    dst["inputs"][dst_slot]["link"] = lid
    return lid


IDLE_PROMPT = build_prompt("idle")

NOTE = """## Monster sprite clip (MiniMax H3, first frame == last frame)

**What this does**: takes one still of a monster, animates it for ~1.6 s, and saves every
frame as a PNG (plus an MP4 preview). The same image is wired into `first_frame` **and**
`last_frame`, so the motion returns to the start pose and the frames loop.

**How to use**
1. `Load Image` → upload your monster (ChatGPT image, facing right, centered, on flat pure green `#00FF00`, no ground shadow).
2. Edit the **prompt** in the H3 node: keep the camera/background lines, change only the motion sentence.
   - idle → "stands in place ... slow breathing, slight weight shift"
   - walk → "walks in place as if on a treadmill, facing right, natural walk cycle, slight body bob, stays centered"
   - attack → "performs one quick attack swing to the right and returns to the idle pose" (length 39 or 56)
3. `length` must be on the 17k+5 grid: **22, 39, 56, 73** frames (24 fps). 39 ≈ 1.6 s is a good idle/walk loop.
4. Set the `filename_prefix` on **Save Image** per action, e.g. `sprites/ashling_idle/frame`.
5. Queue. Frames land in `ComfyUI/output/sprites/ashling_idle/frame_00001_.png …`.
6. On your machine: `python3 tools/sprite-pipeline/pack_sprite_sheet.py --name ashling idle=<frames dir> walk=<frames dir>`
   → sprite sheet PNG + animated WebP + JSON meta.

**Models** (same as the official H3 template, in `ComfyUI/models/...`)
- diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors
- text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors
- vae/minimax_h3_video_vae_fp16.safetensors

**Tips**: if the creature drifts or the camera moves, lower `steps` won't help — re-roll the seed or make the
motion sentence smaller. If the background gets texture, add "flat chroma key green screen" to the prompt.
Use magenta `#FF00FF` instead of green for green-coloured monsters (pass `--key magenta` to the pack script).
"""

# ---------------------------------------------------------------- layout (x, y)
X_IN, X_MODEL, X_COND, X_SAMPLE, X_DECODE, X_OUT = 0, 0, 520, 1020, 1440, 1800

# ---- notes
node("MarkdownNote", (X_IN, -640), (860, 560), [NOTE], title="README — monster sprite clip", color="#432")

# ---- input
load = node("LoadImage", (X_IN, 0), (320, 320), ["monster_idle.png", "image"],
            inputs=[inp("image", "COMBO", True), inp("upload", "IMAGEUPLOAD", True)],
            outputs=[out("IMAGE", "IMAGE"), out("MASK", "MASK")], title="Load Image (monster on flat green)")

scale = node("ImageScale", (X_IN + 0, 360), (320, 130), ["lanczos", 768, 768, "disabled"],
             inputs=[inp("image", "IMAGE"), inp("upscale_method", "COMBO", True), inp("width", "INT", True),
                     inp("height", "INT", True), inp("crop", "COMBO", True)],
             outputs=[out("IMAGE", "IMAGE")], title="Scale to 768x768 (H3 canvas)")

# ---- models
unet = node("UNETLoader", (X_MODEL, 560), (420, 82), ["minimax_h3_fl2va_pruned_int8_convrot.safetensors", "default"],
            inputs=[inp("unet_name", "COMBO", True), inp("weight_dtype", "COMBO", True)],
            outputs=[out("MODEL", "MODEL")])
clip = node("CLIPLoader", (X_MODEL, 680), (420, 106), ["qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", "minimax", "default"],
            inputs=[inp("clip_name", "COMBO", True), inp("type", "COMBO", True), inp("device", "COMBO", True)],
            outputs=[out("CLIP", "CLIP")])
vae = node("VAELoader", (X_MODEL, 820), (420, 58), ["minimax_h3_video_vae_fp16.safetensors"],
           inputs=[inp("vae_name", "COMBO", True)], outputs=[out("VAE", "VAE")], title="VAE (video)")

# ---- conditioning / latent
h3 = node("MiniMaxH3ImageToVideo", (X_COND, 0), (460, 520), [IDLE_PROMPT, 768, 768, 39],
          inputs=[inp("clip", "CLIP"), inp("vae", "VAE"), inp("first_frame", "IMAGE"), inp("last_frame", "IMAGE"),
                  inp("prompt", "STRING", True), inp("width", "INT", True), inp("height", "INT", True),
                  inp("length", "INT", True)],
          outputs=[out("positive", "CONDITIONING"), out("LATENT", "LATENT")],
          title="MiniMax H3 I2V — first_frame == last_frame (loop)")

# ---- sampling
noise = node("RandomNoise", (X_SAMPLE, 0), (360, 82), [1, "randomize"],
             inputs=[inp("noise_seed", "INT", True)], outputs=[out("NOISE", "NOISE")])
guider = node("BasicGuider", (X_SAMPLE, 130), (360, 46),
              inputs=[inp("model", "MODEL"), inp("conditioning", "CONDITIONING")], outputs=[out("GUIDER", "GUIDER")])
sampler = node("KSamplerSelect", (X_SAMPLE, 220), (360, 58), ["res_multistep"],
               inputs=[inp("sampler_name", "COMBO", True)], outputs=[out("SAMPLER", "SAMPLER")])
sched = node("BasicScheduler", (X_SAMPLE, 320), (360, 106), ["simple", 20, 1],
             inputs=[inp("model", "MODEL"), inp("scheduler", "COMBO", True), inp("steps", "INT", True),
                     inp("denoise", "FLOAT", True)],
             outputs=[out("SIGMAS", "SIGMAS")])
sca = node("SamplerCustomAdvanced", (X_SAMPLE, 470), (360, 110),
           inputs=[inp("noise", "NOISE"), inp("guider", "GUIDER"), inp("sampler", "SAMPLER"), inp("sigmas", "SIGMAS"),
                   inp("latent_image", "LATENT")],
           outputs=[out("output", "LATENT"), out("denoised_output", "LATENT")])

# ---- decode
decode = node("VAEDecode", (X_DECODE, 470), (300, 46),
              inputs=[inp("samples", "LATENT"), inp("vae", "VAE")], outputs=[out("IMAGE", "IMAGE")],
              title="VAE Decode (all frames)")

# ---- outputs
save_frames = node("SaveImage", (X_OUT, 0), (420, 400), ["sprites/monster_idle/frame"],
                   inputs=[inp("images", "IMAGE"), inp("filename_prefix", "STRING", True)],
                   title="Save every frame as PNG  ←  change prefix per action")
create_video = node("CreateVideo", (X_OUT, 460), (300, 100), [24, 8],
                    inputs=[inp("images", "IMAGE"), inp("audio", "AUDIO"), inp("fps", "FLOAT", True), inp("bit_depth", "INT", True)],
                    outputs=[out("VIDEO", "VIDEO")])
save_video = node("SaveVideo", (X_OUT, 620), (420, 420), ["sprites/preview/monster_idle", "auto", "auto"],
                  inputs=[inp("video", "VIDEO"), inp("filename_prefix", "STRING", True), inp("format", "COMBO", True),
                          inp("codec", "COMFY_DYNAMICCOMBO_V3", True)],
                  outputs=[out("video", "VIDEO")], title="MP4 preview of the raw clip")

# ---------------------------------------------------------------- wiring
link(load, 0, scale, 0, "IMAGE")
link(scale, 0, h3, 2, "IMAGE")          # first_frame
link(scale, 0, h3, 3, "IMAGE")          # last_frame  (loop trick)
link(clip, 0, h3, 0, "CLIP")
link(vae, 0, h3, 1, "VAE")
link(unet, 0, guider, 0, "MODEL")
link(h3, 0, guider, 1, "CONDITIONING")
link(unet, 0, sched, 0, "MODEL")
link(noise, 0, sca, 0, "NOISE")
link(guider, 0, sca, 1, "GUIDER")
link(sampler, 0, sca, 2, "SAMPLER")
link(sched, 0, sca, 3, "SIGMAS")
link(h3, 1, sca, 4, "LATENT")
link(sca, 0, decode, 0, "LATENT")
link(vae, 0, decode, 1, "VAE")
link(decode, 0, save_frames, 0, "IMAGE")
link(decode, 0, create_video, 0, "IMAGE")
link(create_video, 0, save_video, 0, "VIDEO")

groups = [
    {"id": 1, "title": "1 · Input (one still, facing right, flat green bg)", "bounding": [X_IN - 20, -80, 380, 600], "color": "#3f789e", "font_size": 24, "flags": {}},
    {"id": 2, "title": "2 · Models", "bounding": [X_MODEL - 20, 500, 480, 400], "color": "#3f789e", "font_size": 24, "flags": {}},
    {"id": 3, "title": "3 · Prompt + canvas + length", "bounding": [X_COND - 20, -80, 500, 620], "color": "#a1309b", "font_size": 24, "flags": {}},
    {"id": 4, "title": "4 · Sample + decode", "bounding": [X_SAMPLE - 20, -80, 800, 680], "color": "#88A", "font_size": 24, "flags": {}},
    {"id": 5, "title": "5 · Outputs (frames → pack_sprite_sheet.py)", "bounding": [X_OUT - 20, -80, 480, 1140], "color": "#b58b2a", "font_size": 24, "flags": {}},
]

workflow = {
    "id": str(uuid.uuid4()),
    "revision": 0,
    "last_node_id": _next_node[0] - 1,
    "last_link_id": _next_link[0] - 1,
    "nodes": nodes,
    "links": links,
    "groups": groups,
    "config": {},
    "extra": {"ds": {"scale": 0.6, "offset": [80, 720]}, "frontendVersion": "1.49.6"},
    "version": 0.4,
}

# ---------------------------------------------------------------- self-check
by_id = {n["id"]: n for n in nodes}
for lid, src, ss, dst, ds, t in links:
    assert lid in by_id[src]["outputs"][ss]["links"], lid
    assert by_id[dst]["inputs"][ds]["link"] == lid, lid
    assert by_id[src]["outputs"][ss]["type"] == t == by_id[dst]["inputs"][ds]["type"], (lid, t)
unlinked_required = []
for n in nodes:
    for i in n["inputs"]:
        if i["link"] is None and "widget" not in i and i["name"] not in ("audio",):
            unlinked_required.append((n["type"], i["name"]))
assert not unlinked_required, unlinked_required
out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "monster-i2v.workflow.json")
with open(out_path, "w") as fh:
    json.dump(workflow, fh, indent=2, ensure_ascii=False)
print("wrote", out_path, "nodes:", len(nodes), "links:", len(links))

# ---------------------------------------------------------------- API format (for `comfy run` / POST /prompt)
# {node_id: {"class_type", "inputs": {widget_name: value | [src_node_id, src_slot]}}} — notes are not executed.
api = {}
for n in nodes:
    if n["type"] == "MarkdownNote":
        continue
    widget_inputs = [i for i in n["inputs"] if "widget" in i]
    values = dict(zip((i["name"] for i in widget_inputs), n["widgets_values"]))  # extra widgets (e.g. 'randomize') are dropped
    for i in n["inputs"]:
        if i["link"] is not None:
            lid = i["link"]
            src = next(l for l in links if l[0] == lid)
            values[i["name"]] = [str(src[1]), src[2]]
    api[str(n["id"])] = {"class_type": n["type"], "inputs": values, "_meta": {"title": n.get("title", n["type"])}}
api_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "monster-i2v.api.json")
with open(api_path, "w") as fh:
    json.dump(api, fh, indent=2, ensure_ascii=False)
print("wrote", api_path, "nodes:", len(api))
