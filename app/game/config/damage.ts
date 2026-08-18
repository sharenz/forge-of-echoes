import type { DamageType } from "../domain";

export const DAMAGE_TYPE_DEFINITIONS: Record<DamageType, { label: string; color: string }> = {
  physical: { label: "Physical", color: "#eee0c7" },
  fire: { label: "Fire", color: "#ff9364" },
  cold: { label: "Cold", color: "#83d8ff" },
  lightning: { label: "Lightning", color: "#ffe06b" },
  chaos: { label: "Chaos", color: "#c899ff" },
};
