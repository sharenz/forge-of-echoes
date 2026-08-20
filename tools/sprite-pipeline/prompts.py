"""Prompt templates for MiniMax H3 sprite clips. Shared by build_workflow.py and run_i2v.py.

Only the MOTION sentence changes per action; the camera/background/loop rules stay fixed so the
frames can be chroma-keyed and looped by pack_sprite_sheet.py.
"""

SETUP = (
    "Game sprite animation of the creature from <Picture 1>. The creature is centered on a perfectly flat, "
    "uniform, solid bright {bg_name} ({bg_hex}) chroma-key background."
)

RULES = (
    "The creature keeps its exact size, proportions, colors and design throughout. "
    "Locked static camera, no zoom, no pan, no cuts, no lighting change, no shadows on the ground, "
    "the {bg_name} background stays flat and uniform at all times. The motion ends exactly on the starting pose.\n"
    "Audio: silence."
)

MOTIONS = {
    "idle": (
        "Subtle idle loop: the creature stands in place, slow breathing, slight weight shift from foot to foot, "
        "small head movement, gentle sway of any cloth, tail, fur or flames. It does not move from its position."
    ),
    "walk": (
        "Walk cycle in place, as if on a treadmill, facing right: legs move in a natural walking rhythm, arms or "
        "forelimbs swing, the body bobs slightly with each step. The creature stays centered and does not travel."
    ),
    "attack": (
        "One quick attack: the creature winds up briefly, strikes to the right with its main weapon, claw or head, "
        "then returns to its relaxed stance. It stays centered and does not travel."
    ),
    "hit": (
        "The creature takes a hit from the right: a short flinch backwards, head snaps, then it recovers to its stance. "
        "It stays centered and does not travel."
    ),
}

BACKGROUNDS = {
    "green": ("green", "#00FF00"),
    "magenta": ("magenta", "#FF00FF"),
}


def build_prompt(action: str, key: str = "green", motion: str | None = None) -> str:
    bg_name, bg_hex = BACKGROUNDS[key]
    motion_text = motion or MOTIONS[action]
    return "\n".join([
        SETUP.format(bg_name=bg_name, bg_hex=bg_hex),
        motion_text,
        RULES.format(bg_name=bg_name),
    ])
