/**
 * The authoritative combat clock. A client cannot create more than one distinct
 * action inside a server tick, so presentation and input must use the same floor.
 */
export const AUTHORITATIVE_SIMULATION_HZ = 20;
export const AUTHORITATIVE_SIMULATION_STEP_SECONDS = 1 / AUTHORITATIVE_SIMULATION_HZ;

