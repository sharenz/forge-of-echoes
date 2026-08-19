import type { FlaskId, FlaskResource } from "../domain";

export interface FlaskDefinition {
  id: FlaskId;
  name: string;
  icon: string;
  resource: FlaskResource;
  recovery: number;
  durationSeconds: number;
  maxInventoryStack: number;
  maxBeltStack: number;
  dropWeight: number;
}

export const FLASK_DEFINITIONS: Record<FlaskId, FlaskDefinition> = {
  "weak-health-flask": {
    id: "weak-health-flask",
    name: "Weak Health Flask",
    icon: "/item-icons/weak-health-flask.png",
    resource: "life",
    recovery: 20,
    durationSeconds: 2,
    maxInventoryStack: 20,
    maxBeltStack: 5,
    dropWeight: 55,
  },
  "weak-mana-flask": {
    id: "weak-mana-flask",
    name: "Weak Mana Flask",
    icon: "/item-icons/weak-mana-flask.png",
    resource: "mana",
    recovery: 25,
    durationSeconds: 2,
    maxInventoryStack: 20,
    maxBeltStack: 5,
    dropWeight: 45,
  },
};

export const FLASK_BELT_SLOT_COUNT = 5;
