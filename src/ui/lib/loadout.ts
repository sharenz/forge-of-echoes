// Loadout helpers: skill drag and drop (Skills panel, HUD slots), the Ctrl-click "first free slot" and preset summaries.
// Pure apart from the DragEvent plumbing; covered by tests/ui/skills-panel.test.ts.
import { SKILL_IDS, type SkillId } from '../../contracts/content';
import type { LoadoutPreset } from '../../contracts/items';

const SKILL_DRAG_TYPE = 'application/x-forge-skill';

export function beginSkillDrag(event: DragEvent, skill: SkillId | null): void {
  if (!skill || !event.dataTransfer) {
    event.preventDefault();
    return;
  }
  event.dataTransfer.setData(SKILL_DRAG_TYPE, skill);
  event.dataTransfer.effectAllowed = 'move';
}

export function allowSkillDrop(event: DragEvent): void {
  if (!event.dataTransfer?.types.includes(SKILL_DRAG_TYPE)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
}

export function droppedSkill(event: DragEvent): SkillId | null {
  const id = event.dataTransfer?.getData(SKILL_DRAG_TYPE);
  if (!id || !(SKILL_IDS as readonly string[]).includes(id)) return null;
  event.preventDefault();
  return id as SkillId;
}

/**
 * Where Ctrl/Cmd-click on a skill card puts it: the first empty slot, or -1 when the skill is already on the bar or the bar is
 * full (the click then explains instead of moving anything).
 */
export function firstFreeSlot(loadout: readonly (SkillId | null)[], skill: SkillId, slots: number): number {
  if (loadout.includes(skill)) return -1;
  for (let i = 0; i < slots; i++) if (!loadout[i]) return i;
  return -1;
}

/** A preset with nothing saved in it (loading it would empty the bar). */
export function presetEmpty(p: LoadoutPreset | undefined): boolean {
  return !p || p.loadout.every((s) => !s);
}

/** The preset that holds exactly the current bar (highlighted as the active one), or -1. */
export function matchingPreset(presets: readonly LoadoutPreset[], loadout: readonly (SkillId | null)[], slots: number): number {
  return presets.findIndex((p) => {
    if (presetEmpty(p)) return false;
    for (let i = 0; i < slots; i++) if ((p.loadout[i] ?? null) !== (loadout[i] ?? null)) return false;
    return true;
  });
}
