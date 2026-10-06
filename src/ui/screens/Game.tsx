// The in-game layer: HUD, docked panels, modals and the crafting overlays. `fe-game--left/--right` publish the
// docked panels to CSS (--free-l / --free-r), so the HUD, toasts and overlays centre in the uncovered area.
import { useEffect, useRef } from 'preact/hooks';
import type { Panel } from '../../contracts/ui';
import { AffixChoicePopover } from '../items/Crafting';
import { CommandDeck } from '../hud/CommandDeck';
import { DebuffBar } from '../hud/Debuffs';
import { Chat } from '../hud/Chat';
import { DeathOverlay, LevelUpBurst, NetStats, Toasts } from '../hud/Feedback';
import { TopHud } from '../hud/TopHud';
import { panelFixups, visiblePanels } from '../lib/panels';
import { CharacterPanel } from '../panels/Character';
import { CraftingBenchPanel } from '../panels/CraftingBench';
import { InventoryPanel } from '../panels/Inventory';
import { MapDevicePanel } from '../panels/MapDevice';
import { MerchantPanel } from '../panels/Merchant';
import { DebugMerchantPanel } from '../panels/DebugMerchant';
import { MenuModal, RunSummaryModal } from '../panels/Modals';
import { CheatSheet, CoachCard } from '../guide/Dock';
import { DragHand } from '../guide/Hand';
import { GuideDriver } from '../guide/Driver';
import { HelpWindow } from '../guide/Help';
import { MenuBar } from '../guide/MenuBar';
import { WorldGuide } from '../guide/World';
import { PartyPanel } from '../panels/Party';
import { SkillsPanel } from '../panels/Skills';
import { StashPanel } from '../panels/Stash';
import { TradePanel } from '../panels/Trade';
import { shallowEqual, useStore, useUi } from '../store';
import { cx } from '../components/common';
import { PlayerMenu } from '../components/PlayerMenu';
import { useLocal } from '../local';

function LeftPanel({ panel }: { panel: Panel }) {
  switch (panel) {
    case 'stash':
      return <StashPanel />;
    case 'character':
      return <CharacterPanel />;
    case 'skills':
      return <SkillsPanel />;
    case 'party':
      return <PartyPanel />;
    case 'mapDevice':
      return <MapDevicePanel />;
    case 'merchant':
      return <MerchantPanel />;
    case 'debugMerchant':
      return <DebugMerchantPanel />;
    case 'craftingBench':
      return <CraftingBenchPanel />;
    case 'trade':
      return <TradePanel />;
    default:
      return null;
  }
}

export function GameScreen() {
  const store = useStore();
  const local = useLocal();
  const open = useUi((s) => s.openPanels, shallowEqual);
  const paused = useUi((s) => s.paused);
  const tradeId = useUi((s) => s.trade?.tradeId ?? null);
  const vis = visiblePanels(open);
  const prev = useRef<Panel[]>(open);
  const prevTrade = useRef<string | null>(null);

  // Keep the panel set consistent (one left panel; stash / merchant / device bring the inventory along).
  useEffect(() => {
    const fix = panelFixups(prev.current, open);
    prev.current = open;
    for (const p of fix.close) store.actions.closePanel(p);
    for (const p of fix.open) store.actions.openPanel(p);
  }, [open, store]);

  // A trade that opens brings its window up (with the inventory); a trade that ends takes it down. Hiding the window
  // behind another panel keeps the trade running (the HUD shows a chip to bring it back).
  useEffect(() => {
    const was = prevTrade.current;
    prevTrade.current = tradeId;
    if (tradeId && tradeId !== was) store.actions.openPanel('trade');
    if (!tradeId && was && store.get().openPanels.includes('trade')) store.actions.closePanel('trade');
  }, [tradeId, store]);

  // A panel opening or closing under the cursor invalidates whatever tooltip it was showing.
  useEffect(() => local.hideTooltip(), [vis.left, vis.right, vis.modal, local]);

  // The menu blocks local input while open (the world keeps running online).
  useEffect(() => {
    const menuOpen = vis.modal === 'menu';
    if (menuOpen !== paused) store.actions.setPaused(menuOpen);
  }, [vis.modal, paused, store]);

  return (
    <div class={cx('fe-game', vis.left && 'fe-game--left', vis.left === 'skills' && 'fe-game--wide', vis.right && 'fe-game--right')}>
      <GuideDriver />
      <WorldGuide />
      <TopHud />
      <Toasts />
      <LevelUpBurst />
      <Chat />
      <CommandDeck />
      <MenuBar side="l" />
      <MenuBar side="r" />
      <div class="fe-guidedock" aria-label="Tips">
        <CheatSheet />
        <CoachCard />
      </div>
      <DragHand />
      <DebuffBar />
      <NetStats />
      <DeathOverlay />
      {vis.left && <LeftPanel key={vis.left} panel={vis.left} />}
      {vis.right && <InventoryPanel />}
      {vis.modal === 'menu' && <MenuModal />}
      {vis.modal === 'help' && <HelpWindow />}
      <RunSummaryModal />
      <AffixChoicePopover />
      <PlayerMenu />
    </div>
  );
}
