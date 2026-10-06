// The guide's engine room: a component that renders nothing and does the side effects. It persists evidence ("this step is done") as account
// facts, notices which hideout objects the player used, listens to the client's world signals, picks the next first-time hint and shows it
// through the coach card, starts the cheat-sheet on a map entry, closes the Atlas once the portal is open, names the key to press for new
// points, and mirrors the current step onto the root element for CSS (`data-guide-step`, `data-guide-pulse`).
import { useEffect, useRef } from 'preact/hooks';
import type { GuideHintId, GuideProp } from '../../contracts/guide';
import type { Panel } from '../../contracts/ui';
import { gt } from '../../data/guide/strings';
import { dropSignal, HINT_POINTS, hintCandidates, pickHint } from './hints';
import { chipOf, coreDone, type ChipId } from './cheatsheet';
import { useGuideView } from './hooks';
import { NO_SEEN } from './live';
import { selectHintSnapshot } from './snapshot';
import { useLocal } from '../local';
import { useSignal, useStore, useUi } from '../store';
import { panelHotkey } from '../lib/points';

const SKIP_FLAG = 'foe.skipGuide';
/** Set by the character screen's "I have played before" tick; read (and cleared) once by the first game screen. */
export function setSkipFlag(on: boolean): void {
  try { if (on) localStorage.setItem(SKIP_FLAG, '1'); else localStorage.removeItem(SKIP_FLAG); } catch { /* per-browser convenience only */ }
}
function takeSkipFlag(): boolean {
  try {
    const on = localStorage.getItem(SKIP_FLAG) === '1';
    if (on) localStorage.removeItem(SKIP_FLAG);
    return on;
  } catch { return false; }
}

/** The panels that mark a hideout object as used (their name plates fade). */
const USED_BY_PANEL: Partial<Record<Panel, GuideProp>> = { mapDevice: 'mapDevice', stash: 'stash', craftingBench: 'anvil', merchant: 'merchant' };

export function GuideDriver() {
  const store = useStore();
  const local = useLocal();
  const { view, snap } = useGuideView();
  const viewRef = useRef(view);
  viewRef.current = view;
  const sent = useRef(new Set<string>());
  const autoClosed = useRef(false);

  // 1. Persist evidence: every step the snapshot proves and the account does not know yet. The action predicts, so this settles at once.
  const fresh = view.newlyDone.join(',');
  useEffect(() => {
    for (const id of view.newlyDone) {
      if (sent.current.has(id)) continue;
      sent.current.add(id);
      store.actions.guide({ op: 'done', id });
    }
  }, [fresh, store]);
  // A replay starts over: forget what this session already sent.
  const replays = snap.done.length === 0 ? 'zero' : 'some';
  useEffect(() => { if (replays === 'zero') sent.current.clear(); }, [replays]);

  // 1b. "I have played before" (ticked on the character screen): the first look at a fresh guide skips it, once.
  const mode = useUi((st) => st.character?.guide?.mode ?? null);
  const startedFresh = useUi((st) => (st.character?.guide?.done.length ?? 0) === 0);
  const flagTaken = useRef(false);
  useEffect(() => {
    if (mode === null || flagTaken.current) return;
    flagTaken.current = true;
    const wants = takeSkipFlag();
    if (wants && mode === 'active' && startedFresh) store.actions.guide({ op: 'skip' });
  }, [mode, startedFresh, store]);

  // 2. Objects the player used (panel opened): their name plates fade.
  useEffect(() => {
    let prev: readonly Panel[] = store.get().openPanels;
    return store.subscribe(() => {
      const s = store.get();
      if (s.openPanels === prev) return;
      const opened = s.openPanels.filter((p) => !prev.includes(p));
      prev = s.openPanels;
      const guide = s.character?.guide;
      if (!guide || guide.mode === 'skipped') return;
      for (const p of opened) {
        const prop = USED_BY_PANEL[p];
        if (prop && !guide.used?.includes(prop)) store.actions.guide({ op: 'used', id: prop });
      }
    });
  }, [store]);

  // 3. World signals: which chips were used, what dropped, a failed cast, a boss phase.
  useEffect(() => {
    const signals = store.signals;
    if (!signals) return;
    return signals.subscribe((sig) => {
      const now = performance.now();
      switch (sig.kind) {
        case 'mapEntered':
          local.guide.update((l) => ({ ...l, used: new Set<ChipId>(), coreAt: null, sheetAt: now, mapAt: now }));
          break;
        case 'used': {
          const chip = chipOf(sig.action);
          if (!chip) break;
          local.guide.update((l) => {
            if (l.used.has(chip)) return l;
            const used = new Set(l.used).add(chip);
            return { ...l, used, coreAt: coreDone(l.coreAt, used, now) };
          });
          break;
        }
        case 'drop': {
          const d = dropSignal(sig.tone);
          if (d.gear) local.guide.update((l) => (l.seen.gear && (!d.rare || l.seen.rare) ? l : { ...l, seen: { ...l.seen, gear: true, rare: l.seen.rare || d.rare } }));
          break;
        }
        case 'noFocus':
          local.guide.update((l) => (l.seen.noFocus ? l : { ...l, seen: { ...l.seen, noFocus: true } }));
          break;
        case 'bossPhase':
          if (sig.phase >= 1) local.guide.update((l) => (l.seen.bossPhase ? l : { ...l, seen: { ...l.seen, bossPhase: true } }));
          break;
      }
    });
  }, [store, local]);

  // 4. The cheat-sheet's clock: it starts with the map (also when the map was resumed after a reload) and resets when you leave it.
  const wanted = view.visible && !view.completed.has('fight');
  useEffect(() => {
    const now = performance.now();
    if (snap.zone === 'map') local.guide.update((l) => (l.sheetAt === null ? { ...l, sheetAt: now, mapAt: l.mapAt === -Infinity ? now : l.mapAt } : l));
    else local.guide.update((l) => (l.sheetAt === null && l.mapAt === -Infinity ? l : { ...l, sheetAt: null, coreAt: null, mapAt: -Infinity, used: new Set<ChipId>() }));
  }, [snap.zone, wanted, local]);

  // 5. The next hint: a half-second clock over the live state (the HUD updates at 15 Hz; a card needs no more).
  const levelBase = useRef(store.get().levelUpCount);
  useEffect(() => {
    const t = setInterval(() => {
      const s = store.get();
      const guide = s.character?.guide;
      if (!guide || s.screen !== 'game') return;
      const l = local.guide.get();
      if (l.card) return;
      const snapH = selectHintSnapshot(s, { leveledUp: s.levelUpCount > levelBase.current, seen: l.seen ?? NO_SEEN });
      const blocked = s.openPanels.some((p) => p === 'menu' || p === 'help') || !!s.runSummary || !!local.dialog.get() || !!s.affixChoice || !!s.hud?.dead || s.chatOpen;
      const id = pickHint(hintCandidates(snapH), {
        now: performance.now(), mode: guide.mode, tipsOn: s.settings.hints !== false, shown: guide.hints, lastShownAt: l.lastCardAt, enteredMapAt: l.mapAt, blocked,
      });
      if (!id) return;
      showHint(id);
    }, 500);
    const showHint = (id: GuideHintId): void => {
      const now = performance.now();
      store.actions.guide({ op: 'hint', id });
      if (id === 'levelUp') levelBase.current = store.get().levelUpCount;
      local.guide.update((l) => ({
        ...l, card: { id, at: now }, lastCardAt: now,
        seen: { ...l.seen, ...(id === 'firstLoot' ? { gear: false } : {}), ...(id === 'firstRare' ? { rare: false } : {}), ...(id === 'focusEmpty' ? { noFocus: false } : {}), ...(id === 'firstBossPhase' ? { bossPhase: false } : {}) },
      }));
    };
    return () => clearInterval(t);
  }, [store, local]);

  // 5b. Wearing one piece of the new loot is the "equip" step (the rest of a big haul can wait): the worn count rose since the step began.
  const worn = useUi((st) => Object.keys(st.character?.equipment ?? {}).length);
  const wornAtStep = useRef<number | null>(null);
  useEffect(() => {
    if (view.step !== 'equip') { wornAtStep.current = null; return; }
    if (wornAtStep.current === null) wornAtStep.current = worn;
    else if (worn > wornAtStep.current) store.actions.guide({ op: 'done', id: 'equip' });
  }, [view.step, worn, store]);

  // 6. Once the portal is open, take the Atlas and the inventory out of the way (once): the portal is what to click next.
  const atlasOpen = snap.atlasOpen;
  useEffect(() => {
    if (view.step === 'enter' && view.variant === 'normal') {
      if (!autoClosed.current && atlasOpen) {
        autoClosed.current = true;
        store.actions.closePanel('mapDevice');
        store.actions.closePanel('inventory');
      }
    } else autoClosed.current = false;
  }, [view.step, view.variant, atlasOpen, store]);

  // 7. Points that pile up unspent: name the key to press (the level-up burst and the first hint already said "you have points").
  const attr = useUi((st) => st.character?.unspentAttributePoints ?? 0);
  const skill = useUi((st) => st.character?.unspentSkillPoints ?? 0);
  const charId = useUi((st) => st.character?.id ?? null);
  const pts = useRef<{ id: string | null; a: number; s: number } | null>(null);
  useEffect(() => {
    const before = pts.current;
    pts.current = { id: charId, a: attr, s: skill };
    if (!before || before.id !== charId) return;
    if (attr > before.a && attr >= 6) store.actions.toast(gt('toasts.points', { count: attr, what: 'attribute points', key: panelHotkey('character') ?? 'C' }), 'good');
    else if (skill > before.s && skill >= 2) store.actions.toast(gt('toasts.points', { count: skill, what: 'skill points', key: panelHotkey('skills') ?? 'K' }), 'good');
  }, [attr, skill, charId, store]);

  // 8. CSS hooks on the root: that the guide is on, the step, and the control a card points at.
  const live = useSignal(local.guide);
  const card = live.card;
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.fe-root');
    if (!root) return;
    if (view.step) root.dataset.guideStep = view.step; else delete root.dataset.guideStep;
    if (view.visible) root.dataset.guide = 'on'; else delete root.dataset.guide;
    const point = card ? HINT_POINTS[card.id] : null;
    if (point) root.dataset.guidePulse = point; else delete root.dataset.guidePulse;
    return () => { delete root.dataset.guideStep; delete root.dataset.guide; delete root.dataset.guidePulse; };
  }, [view.step, view.visible, card?.id]);

  return null;
}
