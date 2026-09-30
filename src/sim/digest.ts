// FNV-1a digest over the authoritative world state (exact float bits), for determinism tests.
import { AREA_KINDS, type RunPhase } from '../contracts/sim';
import { MAP_EVENT_KINDS, MAP_EVENT_PHASES } from '../contracts/map-events';
import type { World } from './world';

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
const PHASES: readonly RunPhase[] = ['hideout', 'tell', 'fight', 'boss', 'cleared', 'failed'];

class Fnv {
  h = 0x811c9dc5;

  int(n: number): void {
    let h = this.h;
    const v = n >>> 0;
    h = Math.imul(h ^ (v & 0xff), 0x01000193);
    h = Math.imul(h ^ ((v >>> 8) & 0xff), 0x01000193);
    h = Math.imul(h ^ ((v >>> 16) & 0xff), 0x01000193);
    h = Math.imul(h ^ (v >>> 24), 0x01000193);
    this.h = h;
  }

  float(v: number): void {
    f32[0] = v;
    this.int(u32[0]);
  }
}

export function digestWorld(w: World): number {
  const h = new Fnv();
  h.int(w.tick);
  h.int(w.players.length);
  for (const p of w.players) {
    h.int(p.id);
    h.float(p.x);
    h.float(p.y);
    h.float(p.life);
    h.float(p.focus);
    h.int(p.dead ? 1 : 0);
    const d = p.debuffs;
    for (let k = 0; k < d.remaining.length; k++) {
      h.float(d.remaining[k]);
      h.int(d.stacks[k]);
    }
  }
  const event = w.mapEvent;
  if (event) {
    h.int(MAP_EVENT_KINDS.indexOf(event.plan.kind) + 1); h.int(event.plan.wave); h.float(event.plan.angle);
    h.int(event.finished ? 1 : 0); h.float(event.timer); h.float(event.grace); h.int(event.pulses);
    if (event.plan.kind === 'vaultbreakers') h.float(event.deadline);
    if (event.plan.required || event.plan.next) {
      for (let plan: typeof event.plan | undefined = event.plan; plan; plan = plan.next) {
        h.int(MAP_EVENT_KINDS.indexOf(plan.kind) + 1); h.int(plan.wave); h.float(plan.angle); h.int(plan.required ? 1 : 0);
      }
      h.int(0);
    }
    for (const id of event.members) h.int(id);
    h.int(event.view ? MAP_EVENT_PHASES.indexOf(event.view.phase) + 1 : 0);
    if (event.view) { h.float(event.view.x); h.float(event.view.y); h.int(event.view.remaining); }
  }
  const m = w.monsters;
  h.int(m.count);
  for (let i = 0; i < m.hwm; i++) {
    if (!m.alive[i]) continue;
    h.int(m.id[i]);
    h.int(m.kind[i]);
    h.float(m.x[i]);
    h.float(m.y[i]);
    h.float(m.life[i]);
    h.int(m.state[i]);
  }
  const pr = w.projectiles;
  h.int(pr.count);
  for (let i = 0; i < pr.hwm; i++) {
    if (!pr.alive[i]) continue;
    h.int(pr.id[i]);
    h.float(pr.x[i]);
    h.float(pr.y[i]);
  }
  const mo = w.motes;
  h.int(mo.count);
  for (let i = 0; i < mo.hwm; i++) {
    if (!mo.alive[i]) continue;
    h.float(mo.x[i]);
    h.float(mo.y[i]);
    h.float(mo.xp[i]);
  }
  h.int(w.drops.length);
  for (const d of w.drops) {
    h.int(d.id);
    h.int(d.spec.owner);
    h.int(d.spec.token);
    h.float(d.x);
    h.float(d.y);
  }
  h.int(w.areas.length);
  for (const a of w.areas) {
    h.int(a.id);
    h.int(AREA_KINDS.indexOf(a.kind));
    h.float(a.x);
    h.float(a.y);
    h.float(a.age);
  }
  h.int(w.props.length);
  for (const pp of w.props) h.int(pp.state);
  const d = w.director;
  h.int(PHASES.indexOf(d.phase));
  h.int(d.wave);
  h.int(w.kills);
  h.int(w.combatRng.state());
  h.int(w.lootRng.state());
  h.int(w.worldRng.state());
  return h.h >>> 0;
}
