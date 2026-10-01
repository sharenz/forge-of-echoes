import { SKILL_IDS, type SkillId } from '../../contracts/content';

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
