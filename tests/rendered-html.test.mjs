import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("https://crafty.example/", { headers: { accept: "text/html", host: "crafty.example" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Crafty application shell and production metadata", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Crafty — The Crucible<\/title>/i);
  assert.match(html, /Enter the Crucible/);
  assert.match(html, /Authoritative online realm/);
  assert.match(html, /characters and progression live authoritatively in PostgreSQL/i);
  assert.match(html, /craft maps and rare equipment/i);
  assert.match(html, /property="og:image" content="https:\/\/crafty\.example\/og\.png"/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps the game systems modular and ships its social artwork", async () => {
  const [page, layout, globalStyles, cursor, shell, notification, mapMerchant, mapWorkshop, phaserWorld, inventoryPanel, attributesPanel, skillTreePanel, inventoryGrid, itemIcon, itemTooltip, world, characterAnimator, gameAudio, monsterAudio, domain, itemContainer, itemVisuals, stashEngine, equipment, combat, mapsEngine, encounters, lootEngine, containerConfig, stashConfig, damageConfig, audioConfig, equipmentSlotConfig, arenaConfig, characterAnimationConfig, mapConfig, monsterPackConfig, lootConfig, profile, stats, statRuleConfig, itemConfig, affixConfig, monsterConfig, skillConfig, merchantConfig, flaskConfig, gameDesign] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/components/GameCursor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/GameShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/GameNotification.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/MerchantPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/MapWorkshop.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/PhaserWorld.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/InventoryPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/AttributesPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/SkillTreePanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/InventoryGrid.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ItemIcon.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ItemTooltip.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/game2d/PhaserRuntime.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game2d/CharacterAnimator.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game2d/audio/GameAudio.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game2d/audio/MonsterAudioMixer.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/domain.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/item-container.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/item-visuals.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/stash.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/equipment.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/combat.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/maps.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/encounters.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/loot.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/config/containers.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/config/stash.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/config/damage.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/config/audio.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/config/equipment-slots.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/config/arena.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/config/character-animations.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/config/maps.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/config/monster-packs.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/config/loot.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/profile.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/stats.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/config/stat-rules.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/config/item-bases.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/config/affixes.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/config/monsters.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/config/skills.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/config/merchants.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/config/flasks.ts", import.meta.url), "utf8"),
    readFile(new URL("../GAME_DESIGN.md", import.meta.url), "utf8"),
  ]);
  const itemComparison = await readFile(new URL("../app/game/item-comparison.ts", import.meta.url), "utf8");
  const itemDrop = await readFile(new URL("../app/game/item-drop.ts", import.meta.url), "utf8");
  const quickAction = await readFile(new URL("../app/components/useQuickAction.ts", import.meta.url), "utf8");
  const crafting = await readFile(new URL("../app/game/crafting.ts", import.meta.url), "utf8");
  const menuSoundtrack = await readFile(new URL("../app/components/MenuSoundtrack.tsx", import.meta.url), "utf8");
  const completionRewardConfig = await readFile(new URL("../app/game/config/rewards.ts", import.meta.url), "utf8");
  const completionRewards = await readFile(new URL("../app/game/rewards.ts", import.meta.url), "utf8");
  const authoritativeMapRoom = await readFile(new URL("../server/rooms/MapRoom.ts", import.meta.url), "utf8");

  assert.match(page, /<GameShell \/>/);
  assert.match(layout, /<GameCursor \/>/);
  assert.match(cursor, /data-mode="default"/);
  assert.match(cursor, /addEventListener\("dragover"/);
  assert.match(cursor, /addEventListener\("contextmenu", preventBrowserContextMenu\)/);
  assert.doesNotMatch(cursor, /requestAnimationFrame/);
  assert.match(shell, /<PhaserWorld/);
  assert.match(shell, /<MenuSoundtrack enabled=\{musicEnabled\} onEnabledChange=\{setMusicEnabled\} \/>/);
  assert.match(shell, /<HideoutSoundtrack enabled=\{musicEnabled\} onEnabledChange=\{setMusicEnabled\} \/>/);
  assert.match(shell, /<MapSoundtrack finalRageActive=\{mapFinalRageActive\} enabled=\{musicEnabled\} onEnabledChange=\{setMusicEnabled\} \/>/);
  assert.match(shell, /onFinalRageChange=\{setMapFinalRageActive\}/);
  assert.match(menuSoundtrack, /finalRageActive \? FINAL_RAGE_SOUNDTRACK : MAP_SOUNDTRACK/);
  assert.match(menuSoundtrack, /<audio ref=\{audioRef\}[^>]+loop/);
  assert.match(menuSoundtrack, /pointerdown/);
  assert.match(menuSoundtrack, /menu-soundtrack-control/);
  assert.match(menuSoundtrack, /onEnabledChange\(false\)/);
  assert.match(audioConfig, /\/music\/amber-hollow\.mp3/);
  assert.match(audioConfig, /\/music\/amber-hollow-watch\.mp3/);
  assert.match(audioConfig, /\/music\/hunted-wilds\.mp3/);
  assert.match(audioConfig, /\/music\/surrounded-by-fangs\.mp3/);
  assert.match(shell, /<GameNotification/);
  assert.match(shell, /<MerchantPanel/);
  assert.match(mapMerchant, /merchant\.name} trade window/);
  assert.match(mapMerchant, /Shop inventory/);
  assert.match(mapMerchant, /Your Backpack/);
  assert.match(mapMerchant, /quickAction\.fromClick/);
  assert.match(mapMerchant, /container=\{profile\.inventory\}/);
  assert.match(mapMerchant, /startOfferDrag/);
  assert.match(mapMerchant, /buy\(stockItem, \{ x, y \}\)/);
  assert.match(mapMerchant, /dropEffect=\{draggedOffer \? "copy" : "move"\}/);
  assert.match(mapMerchant, /<ItemTooltip item=\{stockItem\.previewItem\}/);
  assert.doesNotMatch(mapMerchant, /merchant-offer-detail/);
  assert.match(mapWorkshop, /mapModifierDescription/);
  assert.match(merchantConfig, /amount: 0/);
  assert.match(world, /MERCHANT/);
  assert.match(notification, /aria-live="polite"/);
  assert.doesNotMatch(shell, /className="toast"/);
  assert.match(shell, /mode="loading"/);
  assert.match(shell, /mode="character-create"/);
  assert.match(shell, /Your Characters/);
  assert.match(shell, /Create Character/);
  assert.match(shell, /Back to characters/);
  assert.match(world, /class PhaserRuntime/);
  assert.match(world, /consumeHeldSkillKeys\(\)/);
  assert.match(world, /this\.keys\.flameWave\.isDown/);
  assert.doesNotMatch(world, /JustDown\(this\.keys\.(?:nova|dash|ward|flameWave)\)/);
  assert.match(world, /pixelArt: true/);
  assert.doesNotMatch(world, /spatialBuckets/);
  assert.match(world, /MAP_SIZE = VIEW_SIZE \* 4/);
  assert.doesNotMatch(world, /setDeadzone\(/);
  assert.match(world, /startFollow\(this\.cameraTarget!, true, 0\.16, 0\.16\)/);
  assert.match(world, /renderPlayer\(this\.accumulator \/ FIXED_STEP\)/);
  assert.doesNotMatch(world, /MOVEMENT_ACCELERATION|PACK_REGIONS|shouldSpawnNextWave/);
  assert.match(world, /requires a server-backed multiplayer adapter/);
  assert.match(world, /syncNetworkMonsters/);
  assert.match(world, /syncNetworkCombatEvents/);
  assert.match(world, /spawnReturnPortal/);
  assert.match(world, /activateReturnPortal/);
  assert.match(world, /spawnCompletionChest/);
  assert.doesNotMatch(world, /openCompletionChest/);
  assert.match(world, /reward-chest-closed/);
  assert.doesNotMatch(world, /OPEN VICTORY CACHE FIRST|createMapCompletionRewards/);
  assert.match(authoritativeMapRoom, /createMapCompletionRewards/);
  assert.match(completionRewardConfig, /equipmentCount: 2/);
  assert.match(completionRewardConfig, /minimumGuaranteedEquipmentRarity: "magic"/);
  assert.match(completionRewardConfig, /currency: "scrap"/);
  assert.match(completionRewardConfig, /currency: "essence"/);
  assert.match(completionRewardConfig, /currency: "mapDust"/);
  assert.match(completionRewards, /atLeastRarity/);
  assert.match(completionRewards, /generateEquipmentWithRandom/);
  assert.match(world, /renderPlayerResources/);
  assert.match(world, /this\.options\.onReturnToHideout\(\)/);
  assert.doesNotMatch(world, /this\.lives/);
  assert.match(phaserWorld, /world-hud-safe-area/);
  assert.match(phaserWorld, /world-map-stats/);
  assert.match(phaserWorld, /Monster level/);
  assert.match(phaserWorld, /mapModifierDescription/);
  assert.match(phaserWorld, /mapModifierRewardDescription/);
  assert.match(globalStyles, /\.world-stat-stack/);
  assert.match(globalStyles, /\.map-active-modifiers/);
  assert.match(phaserWorld, /ResourceGlobe kind="life"/);
  assert.doesNotMatch(world, /groundDrops\.length > 0/);
  assert.doesNotMatch(world, /waveElapsedSeconds|updateFinalWaveRage|enemy\.aggro = true/);
  assert.match(world, /networkMap\.waveElapsedMilliseconds/);
  assert.match(phaserWorld, /rage in \$\{Math\.ceil\(hud\.finalRageIn\)\}s/);
  assert.match(globalStyles, /\.world-wave\.is-enraged/);
  assert.doesNotMatch(world, /rollHitDamage/);
  assert.match(authoritativeMapRoom, /rollHitDamage/);
  assert.doesNotMatch(world, /0\.85 \+ .*attackDamage/);
  assert.doesNotMatch(world, /enemyHealthMultiplier|enemySpeedMultiplier|ARENA_MONSTER\.baseLife \+ wave/);
  assert.doesNotMatch(world, /resolveMonsterStats|rollMonsterPack|spawnEnemyProjectile|updateEnemyProjectiles|hit\.evadeChance|hit\.armor/);
  assert.match(authoritativeMapRoom, /resolveMonsterStats/);
  assert.match(authoritativeMapRoom, /rollMonsterPack/);
  assert.match(world, /launchNetworkEnemyProjectile/);
  assert.match(world, /renderEnemyHealth/);
  assert.match(world, /healthLabelPool/);
  assert.match(world, /showDamageNumber/);
  assert.match(world, /DAMAGE_TYPE_DEFINITIONS\[damage\.type\]\.label/);
  assert.match(world, /damageNumberPool/);
  assert.match(world, /playerVisual/);
  assert.match(world, /playerAnimator/);
  assert.match(shell, /paused=\{Boolean\(panel\)\}/);
  assert.match(phaserWorld, /world-input-paused/);
  assert.match(globalStyles, /\.pixel-shell\.world-input-paused \.phaser-stage/);
  assert.match(world, /if \(this\.options\.paused\) return;/);
  assert.match(world, /load\.spritesheet/);
  assert.doesNotMatch(world, /updatePlayerVisual|playerAnimationLock|tweens\.killTweensOf\(this\.playerVisual/);
  assert.doesNotMatch(world, /createPlayerFrame|createPlayerAnimations/);
  assert.match(world, /vfx-slash/);
  assert.match(world, /vfx-dust/);
  assert.match(characterAnimator, /ANIMATION_UPDATE/);
  assert.match(characterAnimator, /releaseTextureFrame/);
  assert.match(characterAnimator, /currentLoopKey/);
  assert.match(characterAnimator, /setWorldTransform/);
  assert.match(characterAnimationConfig, /releaseFrame: 4/);
  assert.match(characterAnimationConfig, /player-amazon-sheet-v1\.png/);
  assert.match(characterAnimationConfig, /player-sorceress-locomotion-v3\.png/);
  assert.match(characterAnimationConfig, /player-sorceress-actions-v3\.png/);
  assert.match(world, /updateVfxParticles/);
  assert.match(world, /ember-sigil/);
  assert.match(world, /beginSkillAction/);
  assert.match(gameAudio, /class GameAudio/);
  assert.match(gameAudio, /voiceGroup/);
  assert.match(monsterAudio, /class MonsterAudioMixer/);
  assert.match(monsterAudio, /movementFrame/);
  assert.match(audioConfig, /"ember-nova"/);
  assert.match(arenaConfig, /waveSpawnIntervalSeconds: 30/);
  assert.match(arenaConfig, /tierModifiers/);
  assert.match(arenaConfig, /waveModifiers/);
  assert.match(combat, /resolveArenaStat/);
  assert.match(combat, /rollHitDamage/);
  assert.match(combat, /resolveStat\(0/);
  assert.match(combat, /waveStats/);
  assert.doesNotMatch(combat, /modifiers\.has|\? 5\.6 : 8|enemyHealthMultiplier/);
  assert.match(mapConfig, /modifiers: \[\{ stat: "monsterCount", mode: "more", base: 30 \}\]/);
  assert.match(mapConfig, /rewardModifiers/);
  assert.doesNotMatch(mapConfig, /description: "Waves|recover life while|erupt when slain|additional elite/);
  assert.match(mapsEngine, /mapModifierDescription/);
  assert.match(mapsEngine, /formatModifier/);
  assert.match(mapWorkshop, /Item quantity/);
  assert.match(mapWorkshop, /Monster rarity/);
  assert.match(encounters, /rollMonsterPack/);
  assert.match(encounters, /rareLeaderIndex/);
  assert.match(encounters, /resolveMonsterStats/);
  assert.match(monsterPackConfig, /MAGIC_PACK_MODIFIERS/);
  assert.match(monsterPackConfig, /RARE_MONSTER_MODIFIERS/);
  assert.match(monsterPackConfig, /rarityRewardModifiers/);
  assert.match(lootEngine, /dropChances/);
  assert.match(lootEngine, /rollEquipmentRarity/);
  assert.match(lootConfig, /equipmentRarityWeights/);
  assert.doesNotMatch(world, /rollGroundDrop|item: generateEquipment/);
  assert.match(world, /equipmentDropPresentation\(item\)/);
  assert.doesNotMatch(world, /rarity\.toUpperCase\(\).*ITEM/);
  assert.match(world, /updateGroundDrops/);
  assert.doesNotMatch(world, /dropInventoryItem/);
  assert.match(lootEngine, /kind: "inventory"/);
  assert.doesNotMatch(shell, /onLootPickup/);
  assert.doesNotMatch(shell, /takeProfileItem|worldRef|dropItemToGround/);
  assert.match(shell, /onlineQuickStash/);
  assert.match(shell, /activeStashTab/);
  assert.match(shell, /executeProfileCommand/);
  assert.match(world, /sendPickup\?\.\(groundDrop\.networkId\)/);
  assert.match(shell, /arena-inventory-toggle/);
  assert.match(shell, /character-interface-backdrop/);
  assert.match(shell, /onFlaskLoad=\{onlineLoadFlask\}/);
  assert.match(shell, /paused=\{Boolean\(panel\)\}/);
  assert.match(shell, /controlsBlocked=\{characterPanelOpen \|\| mapExitPending\}/);
  assert.match(phaserWorld, /updateArenaBalance/);
  assert.match(phaserWorld, /world-action-bar/);
  assert.match(phaserWorld, /world-bottom-hud/);
  assert.match(phaserWorld, /world-command-deck/);
  assert.match(globalStyles, /--command-deck-lower-offset: 18\.4%/);
  assert.match(globalStyles, /transform: translateY\(var\(--command-deck-lower-offset\)\)/);
  assert.match(phaserWorld, /hud-section-label/);
  assert.match(phaserWorld, /world-flask-slot-target/);
  assert.match(phaserWorld, /onFlaskLoad\?\.\(itemId, index\)/);
  assert.match(phaserWorld, /wardCooldown\.toFixed\(1\)/);
  assert.match(phaserWorld, /useSkill\("ward"\)/);
  assert.match(phaserWorld, /flameWaveCooldown\.toFixed\(1\)/);
  assert.match(phaserWorld, /useSkill\("flameWave"\)/);
  assert.doesNotMatch(shell, /hideout-prompt/);
  assert.match(skillConfig, /maxCharges: 3/);
  assert.match(world, /riftCharges \+= 1/);
  assert.match(inventoryPanel, /dropIntoSlot/);
  assert.match(inventoryPanel, /paperdoll-character/);
  assert.match(inventoryPanel, /paperdoll-\$\{profile\.character\.classId/);
  assert.match(globalStyles, /player-sorceress-v4\.png/);
  assert.match(globalStyles, /\.equipment-slot \.item-card > :not\(\.item-card-icon\)/);
  assert.doesNotMatch(inventoryPanel, /Drop to ground|onDropToGround|inventory-flask-belt|inventory-overview/);
  assert.match(phaserWorld, /onItemDropToGround/);
  assert.match(phaserWorld, /world-ground-drop-hint/);
  assert.doesNotMatch(phaserWorld, /useImperativeHandle/);
  assert.match(itemDrop, /source: "backpack" \| "stash" \| "equipment"/);
  assert.match(inventoryPanel, /onMoveItem/);
  assert.match(inventoryPanel, /role="tablist"/);
  assert.match(inventoryPanel, /Rename active stash tab/);
  assert.match(inventoryPanel, /onQuickMove=\{onQuickUnstash\}/);
  assert.match(inventoryPanel, /onQuickMove=\{quickUseBackpackItem\}/);
  assert.match(inventoryGrid, /canPlaceItem/);
  assert.match(inventoryGrid, /onContextMenu=/);
  assert.match(inventoryGrid, /quickAction\.fromContextMenu/);
  assert.doesNotMatch(inventoryGrid, /onDoubleClick/);
  assert.match(quickAction, /event\.ctrlKey && !event\.metaKey/);
  assert.match(quickAction, /DUPLICATE_GESTURE_WINDOW_MS/);
  assert.match(mapWorkshop, /onQuickMove=/);
  assert.doesNotMatch(mapWorkshop, /onCraft|map-device-crafting|Craft slotted map/);
  assert.match(mapMerchant, /quickAction\.fromClick/);
  assert.match(inventoryPanel, /setActiveCurrencySelection\(\{ itemId, \.\.\.position \}\)/);
  assert.match(inventoryPanel, /initialPosition=\{activeCurrencySelection\}/);
  assert.match(inventoryPanel, /event\.stopImmediatePropagation\(\)/);
  assert.match(inventoryPanel, /setActiveCurrencySelection\(null\)/);
  assert.match(inventoryPanel, /onApplyCurrency=\{applyCurrency\}/);
  assert.match(inventoryPanel, /Right-click a crafting material/);
  assert.match(inventoryGrid, /craft-target-valid/);
  assert.match(inventoryGrid, /findContainerEntry\(container, tooltip\.itemId\)/);
  assert.match(inventoryGrid, /CraftingTargetError/);
  assert.match(inventoryGrid, /Invalid target/);
  assert.match(crafting, /applyBackpackCurrency/);
  assert.match(shell, /type: "apply_currency", currencyItemId, targetItemId/);
  assert.match(shell, /station === "bench"\) setPanel\("inventory"\)/);
  assert.match(inventoryGrid, /draggedOffset \?\? readOffset/);
  assert.match(inventoryGrid, /grid-drop-preview/);
  assert.match(inventoryGrid, /container-\$\{container\.id\}/);
  assert.match(inventoryGrid, /<ItemIcon item=\{item\}/);
  assert.match(itemIcon, /inventoryItemIcon\(item\)/);
  assert.match(itemTooltip, /tooltip-item-icon/);
  assert.match(globalStyles, /\.item-tooltip-card\.rarity-magic > strong \{ color: var\(--magic\); \}/);
  assert.match(globalStyles, /\.item-tooltip-card\.rarity-rare > strong \{ color: var\(--rare\); \}/);
  assert.match(itemVisuals, /CURRENCY_DEFINITIONS\[item\.baseId\]\.icon/);
  assert.match(globalStyles, /\.poe-grid-item > \.item-icon/);
  assert.match(globalStyles, /\.world-command-deck \{/);
  assert.match(globalStyles, /bottom-command-frame-v2\.png/);
  assert.match(globalStyles, /\.poe-grid-wrap\.container-backpack \.poe-grid/);
  assert.match(globalStyles, /aspect-ratio: var\(--grid-columns\) \/ var\(--grid-rows\)/);
  assert.doesNotMatch(inventoryGrid, /packItems/);
  assert.match(itemContainer, /transferItem/);
  assert.match(stashEngine, /insertItemsIntoStash/);
  assert.match(stashEngine, /renameStashTab/);
  assert.match(stashConfig, /maximumTabs: 8/);
  assert.match(damageConfig, /fire: \{ label: "Fire"/);
  assert.match(itemContainer, /ignoredItemId/);
  assert.match(containerConfig, /columns: 12, rows: 8/);
  assert.match(equipmentSlotConfig, /ringLeft/);
  assert.match(equipmentSlotConfig, /ringRight/);
  assert.match(equipmentSlotConfig, /Main Hand/);
  assert.match(equipment, /chooseEquipmentSlot/);
  assert.match(inventoryPanel, /CHARACTER_EQUIPMENT_SLOTS\.map/);
  assert.doesNotMatch(inventoryPanel, /CharacterProgression|onAllocateAttribute|onAllocateSkill/);
  assert.doesNotMatch(inventoryPanel, /inventory-inspector/);
  assert.match(attributesPanel, /DERIVED_STAT_RULES/);
  assert.match(attributesPanel, /unspentAttributePoints/);
  assert.match(attributesPanel, /derived-stat-grid/);
  assert.match(skillTreePanel, /skill-node-track/);
  assert.match(skillTreePanel, /\[5, 10, 15, 20\]/);
  assert.match(skillTreePanel, /skillChangeSummary/);
  assert.match(skillTreePanel, /Object\.entries\(ACTIVE_SKILLS\)/);
  assert.match(skillTreePanel, /BASIC_ATTACK/);
  assert.match(skillTreePanel, /SKILL_TREE_BRANCHES\.map/);
  assert.match(skillTreePanel, /progress\.skillLevels\[id\]/);
  assert.match(globalStyles, /\.skill-discipline-grid/);
  assert.doesNotMatch(shell, /CharacterPanelTabs/);
  assert.match(shell, /panel === "attributes"/);
  assert.match(shell, /panel === "skills"/);
  assert.match(globalStyles, /\.attributes-interface/);
  assert.match(globalStyles, /\.skill-tree-interface/);
  assert.match(itemTooltip, /tooltip-affixes/);
  assert.match(itemTooltip, /Hold Alt \/ Option for ranges \+ equipped comparison/);
  assert.match(itemTooltip, /formatModifierWithRollRange/);
  assert.match(itemTooltip, /\[Affix - \{affixTagLabel\(affix\.tag\)\}\]/);
  assert.match(itemTooltip, /T\{affix\.tier\}\{showRollRanges \? ":" : ""\}/);
  assert.match(itemTooltip, /Currently equipped/);
  assert.match(itemTooltip, /Change after replacement/);
  assert.match(itemTooltip, /equipmentComparisons\.map/);
  assert.match(itemTooltip, /ranges \+ equipped comparison/);
  assert.match(itemComparison, /calculateCharacterStats/);
  assert.match(itemComparison, /CHARACTER_EQUIPMENT_SLOTS/);
  assert.match(globalStyles, /\.comparison-count-3/);
  assert.match(inventoryGrid, /profile=\{profile\}/);
  assert.match(globalStyles, /\.tooltip-stat-comparison/);
  assert.match(itemTooltip, /mapModifierDescription/);
  assert.doesNotMatch(inventoryPanel, /Collected this map/);
  assert.match(inventoryPanel, /highlightedIds=\{freshItems\}/);
  assert.match(shell, /mapDevice/);
  assert.match(domain, /type InventoryItem/);
  assert.match(phaserWorld, /world-character-stats/);
  assert.match(phaserWorld, /character-stat-breakdown/);
  assert.match(shell, /characterStatBreakdown/);
  assert.match(stats, /evadeChance/);
  assert.match(stats, /materializeRule/);
  assert.match(stats, /weaponAttackSpeedModifier/);
  assert.doesNotMatch(stats, /82 \+ level|1 \+ dexterity \* 0\.0025/);
  assert.match(statRuleConfig, /DERIVED_STAT_RULES/);
  assert.match(statRuleConfig, /perAttribute/);
  assert.doesNotMatch(world, /evadeMultiplier|armorMultiplier/);
  assert.doesNotMatch(domain, /Bargain/);
  assert.match(domain, /interface MapItem/);
  assert.match(domain, /interface StashState/);
  assert.match(domain, /version: 9/);
  assert.match(domain, /interface EquipmentItem/);
  assert.doesNotMatch(profile, /applyRunResult|grantCharacterExperience/);
  assert.match(authoritativeMapRoom, /grantCharacterExperience/);
  assert.doesNotMatch(profile, /localStorage|sessionStorage|crafty\.profile/);
  assert.doesNotMatch(shell, /saveProfile|crafty\.profile/);
  assert.match(shell, /multiplayer\.createCharacter/);
  assert.match(shell, /authoritativeProfile/);
  assert.match(stats, /sum\(increased\)|mode === "increased"/);
  assert.match(stats, /moreMultiplier/);
  assert.match(itemConfig, /perItemLevel/);
  assert.match(itemConfig, /attacksPerSecond/);
  assert.match(itemConfig, /slot: "helmet"/);
  assert.match(itemConfig, /slot: "offHand"/);
  assert.match(itemConfig, /slot: "amulet"/);
  assert.match(itemConfig, /slot: "gloves"/);
  assert.match(itemConfig, /slot: "belt"/);
  assert.match(affixConfig, /requiredItemLevel/);
  assert.match(monsterConfig, /contactDamagePerWave/);
  assert.match(monsterConfig, /baseLife: 18/);
  assert.match(monsterConfig, /cinder-spitter/);
  assert.match(monsterConfig, /behavior: "ranged"/);
  assert.match(monsterConfig, /rift-stalker/);
  assert.match(monsterConfig, /behavior: "jumper"/);
  assert.match(monsterConfig, /ironhide-brute/);
  assert.match(monsterConfig, /ember-skitter/);
  assert.match(skillConfig, /type: "fire", effectiveness: 1\.35/);
  assert.match(skillConfig, /presentation: \{ animation: "attack", vfx: "ember-lance", audio: "ember-lance" \}/);
  assert.match(skillConfig, /name: "Cinder Ward", key: "R"/);
  assert.match(skillConfig, /damageReduction: 45/);
  assert.match(skillConfig, /name: "Flame Wave", key: "F"/);
  assert.match(skillConfig, /projectileCount: 7/);
  assert.match(flaskConfig, /maxInventoryStack: 20/);
  assert.match(flaskConfig, /maxBeltStack: 5/);
  assert.match(flaskConfig, /recovery: 20/);
  assert.match(flaskConfig, /recovery: 25/);
  assert.match(authoritativeMapRoom, /runtime\.recoveries\.push/);
  assert.match(world, /KeyCodes\.ONE/);
  assert.match(world, /KeyCodes\.FIVE/);
  assert.match(phaserWorld, /world-flask-belt/);
  assert.doesNotMatch(inventoryPanel, /inventory-flask-belt/);
  assert.match(world, /resolveAttackTimeSeconds\(this\.options\.arenaBalance\?\.attackSpeed/);
  assert.match(world, /resolveCastTimeSeconds\(baseCastTime, networkPlayer\?\.castSpeed/);
  assert.match(world, /isWorldPointerOrigin\(pointer\.event\?\.target/);
  assert.doesNotMatch(world, /this\.input\.activePointer\.isDown/);
  assert.match(world, /MAX_DAMAGE_PRESENTATIONS_PER_BATCH/);
  assert.doesNotMatch(world, /Phaser loop stalled; restarting its animation-frame chain/);
  assert.match(gameDesign, /hard cap of level 99/i);
  assert.match(gameDesign, /No temporary run power/);
  assert.match(gameDesign, /The four map axes/);
  await access(new URL("../public/og.png", import.meta.url));
  await access(new URL("../public/music/amber-hollow.mp3", import.meta.url));
  await access(new URL("../public/music/amber-hollow-watch.mp3", import.meta.url));
  await access(new URL("../public/music/hunted-wilds.mp3", import.meta.url));
  await access(new URL("../public/music/surrounded-by-fangs.mp3", import.meta.url));
  await access(new URL("../public/ember-sigil.png", import.meta.url));
  await access(new URL("../public/player-amazon-v4.png", import.meta.url));
  await access(new URL("../public/player-barbarian-v4.png", import.meta.url));
  await access(new URL("../public/item-icons/weak-health-flask.png", import.meta.url));
  await access(new URL("../public/item-icons/weak-mana-flask.png", import.meta.url));
  await access(new URL("../public/player-sorceress-v4.png", import.meta.url));
  await access(new URL("../public/player-amazon-sheet-v1.png", import.meta.url));
  await access(new URL("../public/player-barbarian-sheet-v1.png", import.meta.url));
  await access(new URL("../public/player-sorceress-locomotion-v3.png", import.meta.url));
  await access(new URL("../public/player-sorceress-actions-v3.png", import.meta.url));
  await access(new URL("../public/ui/resource-globe-frame-v1.png", import.meta.url));
  const itemIcons = (await readdir(new URL("../public/item-icons", import.meta.url))).filter((name) => name.endsWith(".png"));
  assert.equal(itemIcons.length, 22);
});

test("stores only the remembered player name in browser storage", async () => {
  const [shell, client, profile, multiplayerHook, apiRouter] = await Promise.all([
    readFile(new URL("../app/components/GameShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/multiplayer/MultiplayerClient.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/profile.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/multiplayer/useMultiplayerHideout.ts", import.meta.url), "utf8"),
    readFile(new URL("../server/http/createApiRouter.ts", import.meta.url), "utf8"),
  ]);
  for (const source of [client, profile]) assert.doesNotMatch(source, /localStorage|sessionStorage|crafty\.profile/);
  assert.match(shell, /localStorage/);
  assert.match(shell, /crafty\.playerName/);
  assert.doesNotMatch(shell, /sessionStorage|crafty\.profile/);
  assert.match(shell, /authoritativeProfile/);
  assert.match(shell, /connectAccount/);
  assert.match(client, /\/api\/accounts\/session/);
  assert.match(client, /\/api\/profile/);
  assert.match(client, /\/api\/parties\/solo/);
  assert.match(multiplayerHook, /existingParty \?\?= await client\.createSoloParty\(selected\)/);
  assert.match(multiplayerHook, /connectToPartyHideout\(selected, existingParty\)/);
  assert.doesNotMatch(apiRouter, /\/dev\/accounts|\/dev\/session/);
  assert.match(apiRouter, /\/parties\/solo/);
});
