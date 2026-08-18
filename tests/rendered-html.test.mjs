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
  assert.match(html, /Lighting the forge/);
  assert.match(html, /craft maps and rare equipment/i);
  assert.match(html, /property="og:image" content="https:\/\/crafty\.example\/og\.png"/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps the game systems modular and ships its social artwork", async () => {
  const [page, layout, globalStyles, cursor, shell, notification, mapMerchant, mapWorkshop, phaserWorld, inventoryPanel, attributesPanel, skillTreePanel, characterPanelTabs, inventoryGrid, itemIcon, itemTooltip, world, characterAnimator, skillAudio, domain, itemContainer, itemVisuals, stashEngine, equipment, combat, mapsEngine, encounters, lootEngine, containerConfig, stashConfig, damageConfig, audioConfig, equipmentSlotConfig, arenaConfig, characterAnimationConfig, mapConfig, monsterPackConfig, lootConfig, content, profile, stats, statRuleConfig, itemConfig, affixConfig, monsterConfig, skillConfig, merchantConfig, gameDesign] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/components/GameCursor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/GameShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/GameNotification.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/MapMerchant.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/MapWorkshop.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/PhaserWorld.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/InventoryPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/AttributesPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/SkillTreePanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/CharacterPanelTabs.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/InventoryGrid.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ItemIcon.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ItemTooltip.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/game2d/PhaserRuntime.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game2d/CharacterAnimator.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game2d/SkillAudio.ts", import.meta.url), "utf8"),
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
    readFile(new URL("../app/game/content.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/profile.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/stats.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/config/stat-rules.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/config/item-bases.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/config/affixes.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/config/monsters.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/config/skills.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/config/merchants.ts", import.meta.url), "utf8"),
    readFile(new URL("../GAME_DESIGN.md", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<GameShell \/>/);
  assert.match(layout, /<GameCursor \/>/);
  assert.match(cursor, /data-mode="default"/);
  assert.match(cursor, /addEventListener\("dragover"/);
  assert.doesNotMatch(cursor, /requestAnimationFrame/);
  assert.match(shell, /<PhaserWorld/);
  assert.match(shell, /<GameNotification/);
  assert.match(shell, /<MapMerchant/);
  assert.match(mapMerchant, /Maps for sale/);
  assert.match(mapWorkshop, /mapModifierDescription/);
  assert.match(merchantConfig, /amount: 0/);
  assert.match(world, /MAP MERCHANT/);
  assert.match(notification, /aria-live="polite"/);
  assert.doesNotMatch(shell, /className="toast"/);
  assert.match(shell, /mode="class-select"/);
  assert.match(world, /class PhaserRuntime/);
  assert.match(world, /pixelArt: true/);
  assert.match(world, /spatialBuckets/);
  assert.match(world, /MAP_SIZE = VIEW_SIZE \* 4/);
  assert.match(world, /setDeadzone\(360, 360\)/);
  assert.match(world, /PACK_REGIONS/);
  assert.match(world, /shouldSpawnNextWave/);
  assert.match(world, /spawnReturnPortal/);
  assert.match(world, /activateReturnPortal/);
  assert.doesNotMatch(world, /groundDrops\.length > 0/);
  assert.match(world, /waveElapsedSeconds/);
  assert.match(world, /rollHitDamage/);
  assert.doesNotMatch(world, /0\.85 \+ .*attackDamage/);
  assert.doesNotMatch(world, /enemyHealthMultiplier|enemySpeedMultiplier|ARENA_MONSTER\.baseLife \+ wave/);
  assert.match(world, /resolveMonsterStats/);
  assert.match(world, /rollMonsterPack/);
  assert.match(world, /spawnEnemyProjectile/);
  assert.match(world, /updateEnemyProjectiles/);
  assert.match(world, /archetype\.behavior === "jumper"/);
  assert.match(world, /hit\.evadeChance/);
  assert.match(world, /hit\.armor/);
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
  assert.match(world, /class-roster/);
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
  assert.match(skillAudio, /class SkillAudio/);
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
  assert.match(world, /rollGroundDrop/);
  assert.match(world, /updateGroundDrops/);
  assert.match(shell, /onLootPickup/);
  assert.match(shell, /quickStashItem/);
  assert.match(shell, /activeStashTab/);
  assert.match(shell, /const inserted = insertItem\(current\.inventory, item\)/);
  assert.match(world, /if \(!this\.options\.onLootPickup\(groundDrop\.drop\)\) continue/);
  assert.match(shell, /arena-inventory-toggle/);
  assert.match(shell, /paused=\{characterPanelOpen\}/);
  assert.match(phaserWorld, /updateArenaBalance/);
  assert.match(phaserWorld, /riftRecharge\.toFixed\(1\)/);
  assert.match(skillConfig, /maxCharges: 3/);
  assert.match(world, /riftCharges \+= 1/);
  assert.match(inventoryPanel, /dropIntoSlot/);
  assert.match(inventoryPanel, /onMoveItem/);
  assert.match(inventoryPanel, /role="tablist"/);
  assert.match(inventoryPanel, /Rename active stash tab/);
  assert.match(inventoryPanel, /onQuickMove=\{showStash/);
  assert.match(inventoryGrid, /canPlaceItem/);
  assert.match(inventoryGrid, /event\.ctrlKey && onQuickMove/);
  assert.match(inventoryGrid, /draggedOffset \?\? readOffset/);
  assert.match(inventoryGrid, /grid-drop-preview/);
  assert.match(inventoryGrid, /<ItemIcon item=\{item\}/);
  assert.match(itemIcon, /inventoryItemIcon\(item\)/);
  assert.match(itemTooltip, /tooltip-item-icon/);
  assert.match(itemVisuals, /CURRENCY_DEFINITIONS\[item\.baseId\]\.icon/);
  assert.match(globalStyles, /\.poe-grid-item > \.item-icon/);
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
  assert.match(skillTreePanel, /nextLevelSummary/);
  assert.match(characterPanelTabs, /"inventory"/);
  assert.match(characterPanelTabs, /"attributes"/);
  assert.match(characterPanelTabs, /"skills"/);
  assert.match(shell, /panel === "attributes"/);
  assert.match(shell, /panel === "skills"/);
  assert.match(globalStyles, /\.attributes-interface/);
  assert.match(globalStyles, /\.skill-tree-interface/);
  assert.match(itemTooltip, /tooltip-affixes/);
  assert.match(itemTooltip, /Hold Alt \/ Option for roll ranges/);
  assert.match(itemTooltip, /formatModifierWithRollRange/);
  assert.match(itemTooltip, /mapModifierDescription/);
  assert.match(inventoryPanel, /Collected this map/);
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
  assert.match(world, /evadeMultiplier/);
  assert.match(world, /armorMultiplier/);
  assert.doesNotMatch(content, /BARGAINS|Bargain/);
  assert.doesNotMatch(domain, /Bargain/);
  assert.match(domain, /interface MapItem/);
  assert.match(domain, /interface StashState/);
  assert.match(domain, /version: 8/);
  assert.match(domain, /interface EquipmentItem/);
  assert.match(profile, /grantCharacterExperience/);
  assert.match(profile, /localStorage/);
  assert.match(profile, /crafty\.profile\.v8/);
  assert.match(profile, /migrateV7Profile/);
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
  assert.match(phaserWorld, /damageSummary\(BASIC_ATTACK\.damage\)/);
  assert.match(world, /1 \/ Math\.max\(0\.01, this\.options\.arenaBalance\?\.attackSpeed/);
  assert.match(gameDesign, /hard cap of level 99/i);
  assert.match(gameDesign, /No temporary run power/);
  assert.match(gameDesign, /The four map axes/);
  await access(new URL("../public/og.png", import.meta.url));
  await access(new URL("../public/ember-sigil.png", import.meta.url));
  await access(new URL("../public/class-roster-v2.png", import.meta.url));
  await access(new URL("../public/player-amazon-v4.png", import.meta.url));
  await access(new URL("../public/player-barbarian-v4.png", import.meta.url));
  await access(new URL("../public/player-sorceress-v4.png", import.meta.url));
  await access(new URL("../public/player-amazon-sheet-v1.png", import.meta.url));
  await access(new URL("../public/player-barbarian-sheet-v1.png", import.meta.url));
  await access(new URL("../public/player-sorceress-locomotion-v3.png", import.meta.url));
  await access(new URL("../public/player-sorceress-actions-v3.png", import.meta.url));
  const itemIcons = (await readdir(new URL("../public/item-icons", import.meta.url))).filter((name) => name.endsWith(".png"));
  assert.equal(itemIcons.length, 20);
});
