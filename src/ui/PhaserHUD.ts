import { heroAttributeRows, signedNumber } from './heroDetails.ts';
import type Phaser from 'phaser';
import { canUseInfirmary, RUN_ROOM_COUNT, type RoomKind, type RunStage } from '../combat/run.ts';
import { areAdjacent, INVENTORY_CELL_COUNT, INVENTORY_GRID_SIZE, inventoryColumn, inventoryRow, occupiedCells, rotatedShape, synergyTargets, SYNERGY_TAG_LABELS } from '../combat/inventory.ts';
import { chooseHeroTarget, heroArmorBreakdown, heroClassForActor, MAX_ARMOR, projectRoleIntent, type CombatEvent, type CombatItem, type Combatant, type EncounterState } from '../combat/simulation.ts';
import { ITEM_CLASS_LABELS } from '../combat/items.ts';
import { ACTOR_ROWS, actorStateFrame, stoppedDollTransform, CLASS_ITEM_ART, type ActorSpriteId, type ActorSpriteState } from '../presentation/ArtCatalog.ts';
import { itemArtBounds, type ItemCell } from '../presentation/itemGeometry.ts';
import { lootGrid } from './lootLayout.ts';
import { assetUrl } from '../presentation/assetUrl.ts';
import { getPuppetCellModifiers, getPuppetForm } from '../combat/puppets.ts';
import { COMBAT_CONFIG } from '../combat/config.ts';
import { formatItemNumber } from '../combat/formatNumber.ts';
import { GAME_VERSION } from '../version.ts';
import type { GameUI } from './GameUI.ts';
import { TooltipLayer, type ItemTooltipContent } from './TooltipLayer.ts';

export interface UIZone {
  x: number; y: number; width: number; height: number;
  action?: string; value?: string; itemId?: string; actorId?: string; heroId?: string; cell?: number; tooltipBounds?: { x: number; y: number; width: number; height: number }; stash?: boolean; floorDrop?: boolean;
}
export interface DragPreview { item: CombatItem; x: number; y: number; grabX: number; grabY: number; heroId?: string; anchor?: number; targetCell?: number; valid?: boolean }

interface BattlefieldActorView {
  actorId: string;
  container: Phaser.GameObjects.Container;
  motion: Phaser.GameObjects.Container;
  action: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Graphics;
  meter: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  key: Phaser.GameObjects.Graphics;
  size: number;
  lastMotionSequence: number;
  frame: number;
  archetype: ActorSpriteId;
  pose: ActorSpriteState;
  poseUntil: number;
  windUntil: number;
  motionUntil: number;
}

const itemCatalog = CLASS_ITEM_ART;
const itemFrames: Record<string, number> = Object.fromEntries(Object.entries(itemCatalog).map(([id, art]) => [id, art.frame]));
const itemAtlases: Record<string, string> = Object.fromEntries(Object.entries(itemCatalog).map(([id, art]) => [id, art.atlas]));
const rarityTints = [0x85868b, 0x45a45c, 0x428bdb, 0xa65bd2, 0xd6a52e] as const;
const controlIcons = new Set(['⚙', '↻', '?', '⛶', '‹', '›']);
const synergyRelationLabels: Record<string, string> = {
  blade: 'КЛИНОК', whetstone: 'КАМЕНЬ', clockwork: 'МЕХАНИЗМ', spring: 'ПРУЖИНА',
  firearm: 'ОРУЖИЕ', scope: 'ПРИЦЕЛ', support: 'ПОДДЕРЖКА', glass: 'СТЕКЛО', bell: 'КОЛОКОЛ',
};
const puppetBranchLabels = { theatrical: 'Кукольно-театральная', mechanical: 'Механико-стимпанковая', mystical: 'Религиозно-мистическая' } as const;
const rarityLabels: Record<NonNullable<CombatItem['rarity']>, string> = { common: 'ОБЫЧНОЕ', uncommon: 'НЕОБЫЧНОЕ', rare: 'РЕДКОЕ', epic: 'МИФИЧЕСКОЕ', legendary: 'ЛЕГЕНДАРНОЕ' };
const categoryLabels: Record<NonNullable<CombatItem['category']>, string> = { weapon: 'ОРУЖИЕ', protection: 'ЗАЩИТА', jewelry: 'УКРАШЕНИЕ', relic: 'РЕЛИКВИЯ', tool: 'ИНСТРУМЕНТ', consumable: 'ПРИПАС', ammo: 'БОЕПРИПАС' };
const clearedCopy: Record<RoomKind, { title: string; message: string }> = {
  battle: { title: 'Добыча', message: 'Общая добыча пуста.' },
  cache: { title: 'Добыча из тайника', message: 'Общая добыча пуста.' },
  workshop: { title: 'Мастерская', message: '' },
  event: { title: 'Передышка завершена', message: 'Выбор сделан.' },
  boss: { title: 'Враг повержен', message: 'Враг повержен.' },
};
function itemRarityTint(rarity: CombatItem['rarity']): number {
  const tier = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 }[rarity ?? 'common'];
  return rarityTints[tier]!;
}
function mixTint(start: number, end: number, amount: number): number {
  const t = Math.max(0, Math.min(1, amount));
  const channel = (shift: number): number => Math.round(((start >> shift) & 0xff) * (1 - t) + ((end >> shift) & 0xff) * t);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}
const portraitFrames: Record<string, number> = { 'hero-1': 0, 'hero-2': 1, 'hero-3': 2, 'hero-4': 3 };
const actorStatus: Record<Combatant['status'], string> = { human: 'Пока что живой', enemy: 'Враг', rebirthing: 'Перерождается', stopped: 'Кукла · завод кончился', active: 'Кукла · заведена', dead: 'Погиб навсегда' };
const actorCardStatus: Record<Combatant['status'], string> = { human: 'Пока жив', enemy: 'Враг', rebirthing: 'Перерожд.', stopped: 'Нет завода', active: 'Заведена', dead: 'Погиб' };
const classCardThemes = {
  guard: { frame: 0x8f9ba9, engraving: 0xc1cbd1, fill: 0x252b35, header: 0x526170, cell: 0x262c32, edge: 0x77828c, health: 0xe25955, tag: 0x60343b, dollTint: 0xc5d0de, puppetCellTint: 0x9e626b, art: 0 },
  huntress: { frame: 0x9e7c4e, engraving: 0xc6a66c, fill: 0x242c27, header: 0x536449, cell: 0x29342c, edge: 0x718363, health: 0x8ec86b, tag: 0x665b42, dollTint: 0xc5d19d, puppetCellTint: 0x78904e, art: 1 },
  pilgrim: { frame: 0xaaa7a0, engraving: 0xdfceab, fill: 0x302932, header: 0x75685b, cell: 0x302832, edge: 0x96897d, health: 0xe5ad5c, tag: 0x763f36, dollTint: 0xd3c7ae, puppetCellTint: 0x9d8875, art: 2 },
  clockmaker: { frame: 0xc0965c, engraving: 0xe5bf7f, fill: 0x2a2334, header: 0x685477, cell: 0x292435, edge: 0x9c7a56, health: 0xe5bb64, tag: 0x79603a, dollTint: 0xd2b6ce, puppetCellTint: 0x886997, art: 3 },
} as const;
// All generated class dashboards share the Clockmaker's portrait, nameplate, resource groove, and tray geometry.
const dashboardLayout = {
  guard: { portrait: [.115, .08, .23], tray: [.07, .414, .86, .515], labelX: .655, labelW: .46 },
  huntress: { portrait: [.115, .08, .23], tray: [.07, .414, .86, .515], labelX: .655, labelW: .46 },
  pilgrim: { portrait: [.115, .08, .23], tray: [.07, .423, .86, .474], labelX: .655, labelW: .46 },
  clockmaker: { portrait: [.115, .08, .23], tray: [.07, .414, .86, .515], labelX: .655, labelW: .46 },
} as const;
const INVENTORY_NICHE_HEIGHT = .525;
const INVENTORY_NICHE_CENTER = .66;
const PARTY_CARD_GAP = 7;
const POOL_TILE_GAP = 8;
const POOL_TOP_INSET = 3;
const POOL_BOTTOM_INSET = 30;
const POOL_GRID_OFFSET = 63;
const POOL_ROUTE_HEIGHT = 60;
const ROUTE_CARD_STYLE: Record<RoomKind, { label: string; icon: string; color: number }> = {
  battle: { label: 'Бой', icon: '⚔', color: 0xe19b83 },
  boss: { label: 'Босс', icon: '✦', color: 0xe19b83 },
  cache: { label: 'Тайник', icon: '', color: 0xebc388 },
  workshop: { label: 'Мастерская', icon: '⚙', color: 0xa5c9d0 },
  event: { label: 'Событие', icon: '✚', color: 0xbed6a8 },
};

/** All visible UI is drawn to Phaser's Canvas; input zones share these exact bounds. */
export class PhaserHUD {
  readonly zones: UIZone[] = [];
  battleLoadProgress = 0;
  battleLoadFailed = false;
  private root: Phaser.GameObjects.Container;
  private actorLayer: Phaser.GameObjects.Container;
  private readonly tooltips: TooltipLayer;
  private actorViews = new Map<string, BattlefieldActorView>();
  private pendingActorEvents: CombatEvent[] = [];
  private width = 1;
  private height = 1;
  private left = { x: 0, y: 0, width: 0, height: 0 };
  private right = { x: 0, y: 0, width: 0, height: 0 };
  private field = { x: 0, y: 0, width: 0, height: 0 };
  private cells = new Map<string, { x: number; y: number; size: number }>();
  private hover?: UIZone;
  private now = 0;
  private lootPage = 0;

  changeLootPage(direction: number): void {
    this.lootPage = Math.max(0, this.lootPage + direction);
    this.tooltips.hide();
  }
  private justPlacedItem?: string;
  private roomEntryPointer?: { x: number; y: number };

  suppressPlacedItemTooltip(itemId: string): void {
    this.justPlacedItem = itemId;
  }
  private clickNotice?: { x: number; y: number; text: string; until: number };
  private displayedHealth = new Map<string, { value: number; at: number }>();
  private currentRoom = 0;
  private currentStage?: RunStage;
  private priorRoomDead = new Set<string>();
  private openingHover = 0;
  private openingHoverAt = 0;
  private windAnimations = new Map<string, { from: number; to: number; until: number }>();
  private windFlashes = new Map<string, number>();
  private consumedSequence = 0;
  private lastShakeAt = 0;
  private encounterState: EncounterState;
  private readonly graphicsPool: Phaser.GameObjects.Graphics[] = [];
  private readonly textPool: Phaser.GameObjects.Text[] = [];
  private readonly imagePool: Phaser.GameObjects.Image[] = [];
  private readonly tileSpritePool: Phaser.GameObjects.TileSprite[] = [];
  private readonly nineSlicePool: Phaser.GameObjects.NineSlice[] = [];
  private graphicsCursor = 0;
  private textCursor = 0;
  private imageCursor = 0;
  private tileSpriteCursor = 0;
  private nineSliceCursor = 0;
  private readonly requestedImages = new Set<string>();

  private get compactLayout(): boolean {
    return this.width < 820 && this.height > this.width;
  }

  private get narrowPortrait(): boolean {
    return this.compactLayout && this.width < 420 && this.height >= 580;
  }

  private get wideLootLayout(): boolean {
    return !this.compactLayout && this.width >= 1100;
  }

  constructor(private readonly scene: Phaser.Scene, private readonly ui: GameUI) {
    this.root = scene.add.container(0, 0);
    this.actorLayer = scene.add.container(0, 0);
    this.addToRoot(this.actorLayer);
    this.tooltips = new TooltipLayer(scene);
    this.encounterState = ui.state;
    scene.events.once('shutdown', () => {
      this.actorViews.clear(); this.pendingActorEvents = [];
      this.actorLayer.destroy();
    });
  }

  zoneAt(x: number, y: number): UIZone | undefined {
    for (let index = this.zones.length - 1; index >= 0; index--) {
      const zone = this.zones[index]!;
      if (x >= zone.x && y >= zone.y && x <= zone.x + zone.width && y <= zone.y + zone.height) return zone;
    }
    return undefined;
  }

  showClickNotice(x: number, y: number, text: string): void { this.clickNotice = { x, y, text, until: performance.now() + 1200 }; }

  draw(pointerX: number, pointerY: number, drag?: DragPreview): void {
    this.width = this.scene.scale.width; this.height = this.scene.scale.height; this.now = performance.now();
    if (this.encounterState !== this.ui.state) {
      this.encounterState = this.ui.state;
      this.currentRoom = 0; this.priorRoomDead.clear();
      this.clearTransientPresentation();
    }
    if (this.currentRoom !== this.ui.run.room) {
      this.roomEntryPointer = { x: pointerX, y: pointerY };
      if (this.currentRoom) for (const hero of this.ui.state.heroes) if (hero.status === 'dead') this.priorRoomDead.add(hero.id);
      this.currentRoom = this.ui.run.room;
    }
    if (this.currentStage !== this.ui.run.stage) {
      this.lootPage = 0;
      this.currentStage = this.ui.run.stage;
      this.clickNotice = undefined;
      this.tooltips.hide();
    }
    this.hover = this.zoneAt(pointerX, pointerY);
    this.beginFrame();
    this.actorLayer.setVisible(false);
    this.zones.length = 0; this.cells.clear();
    if (this.ui.run.stage === 'opening') {
      this.tooltips.hide();
      this.openingModal();
      if (this.ui.optionsOpen) this.optionsDialog();
      this.versionStamp();
      return;
    }
    if (this.ui.run.stage !== 'battle') this.pendingActorEvents = [];
    const compact = this.compactLayout;
    this.layout(compact);
    this.consumePresentationEvents();
    this.background(); this.header(); this.party(drag); this.room(drag);
    if (this.ui.paused && this.ui.run.stage === 'battle') {
      const w = Math.min(150, this.field.width * .35), h = 48;
      const x = this.field.x + this.field.width - w - 16, y = this.field.y + 14;
      this.panelTexture(x, y, w, h);
      const label = this.text('ПАУЗА', x + w / 2, y + h / 2, 12, '#f5ddab', w - 24, .5);
      label.setOrigin(.5, .5);
    }
    this.versionStamp();
    if (!drag && !this.hover) this.itemSpeech();
    if (drag && !this.drawDropFootprint(drag)) this.drawDrag(drag);
    if (this.ui.confirmReset) this.resetDialog();
    if (this.ui.helpOpen) this.helpDialog();
    if (this.ui.heroInfoId) this.heroInfoDialog();
    if (this.ui.optionsOpen) this.optionsDialog();
    if (this.ui.rewardInfo) { this.rewardInfoDialog(this.ui.rewardInfo); return; }
    if (this.ui.dialogOpen) { this.tooltips.hide(); return; }
    this.renderHoverTooltip(pointerX, pointerY, drag);
    if (this.clickNotice && this.clickNotice.until > this.now) {
      const notice = this.clickNotice;
      const y = Math.max(4, notice.y - 34 - (1200 - (notice.until - this.now)) * .012);
      const x = Math.max(6, Math.min(this.width - 150, notice.x - 70));
      this.panelTexture(x, y, 146, 26); this.text(notice.text, x + 73, y + 6, 12, '#ffe4bd', 138, .5);
    }
  }

  private versionStamp(): void {
    if (import.meta.env.PROD || this.narrowPortrait) return;
    const y = this.ui.run.stage === 'opening' ? this.height - 36 : 12;
    this.text(GAME_VERSION, 12, y, 10, '#b9b1bc')
      .setAlpha(.82)
      .setStroke('#100b10', 2);
  }

  /** Reapply draw order when objects are reused for a different role on the next frame. */
  private addToRoot(objects: Phaser.GameObjects.GameObject | Phaser.GameObjects.GameObject[]): void {
    for (const object of Array.isArray(objects) ? objects : [objects]) {
      this.root.add(object);
      this.root.bringToTop(object);
    }
  }

  private beginFrame(): void {
    this.graphicsCursor = 0; this.textCursor = 0; this.imageCursor = 0;
    this.tileSpriteCursor = 0; this.nineSliceCursor = 0;
    for (const object of this.graphicsPool) object.setVisible(false);
    for (const object of this.textPool) object.setVisible(false);
    for (const object of this.imagePool) object.setVisible(false);
    for (const object of this.tileSpritePool) object.setVisible(false);
    for (const object of this.nineSlicePool) object.setVisible(false);
  }

  private acquireGraphics(): Phaser.GameObjects.Graphics {
    const index = this.graphicsCursor++;
    let graphics = this.graphicsPool[index];
    if (!graphics) { graphics = this.scene.add.graphics().setVisible(false); this.graphicsPool[index] = graphics; }
    graphics.clear().setAlpha(1).setVisible(true);
    return graphics;
  }

  private acquireText(x: number, y: number, value: string, style: Phaser.Types.GameObjects.Text.TextStyle): Phaser.GameObjects.Text {
    const index = this.textCursor++;
    let text = this.textPool[index];
    const completeStyle = { resolution: 1, ...style };
    if (!text) { text = this.scene.add.text(x, y, value, completeStyle).setVisible(false); this.textPool[index] = text; }
    else {
      text.lineSpacing = completeStyle.lineSpacing ?? 0;
      text.letterSpacing = completeStyle.letterSpacing ?? 0;
      text.style.setStyle(completeStyle, true, true);
      text.setText(value);
    }
    text.setPosition(x, y).setOrigin(0, 0).setScale(1).setRotation(0).setAlpha(1).setVisible(true);
    return text;
  }

  private acquireImage(x: number, y: number, key: string, frame?: string | number): Phaser.GameObjects.Image {
    const index = this.imageCursor++;
    let image = this.imagePool[index];
    if (!image) { image = this.scene.add.image(x, y, key, frame).setVisible(false); this.imagePool[index] = image; }
    else image.setTexture(key, frame);
    image.setPosition(x, y).setOrigin(.5).setScale(1).setRotation(0).setAlpha(1).setFlip(false, false).setCrop().setBlendMode(0).clearTint().setVisible(true);
    return image;
  }

  private acquireTileSprite(x: number, y: number, width: number, height: number, key: string): Phaser.GameObjects.TileSprite {
    const index = this.tileSpriteCursor++;
    let tile = this.tileSpritePool[index];
    if (!tile) { tile = this.scene.add.tileSprite(x, y, width, height, key).setVisible(false); this.tileSpritePool[index] = tile; }
    else tile.setTexture(key).setPosition(x, y).setSize(width, height);
    tile.setVisible(true);
    return tile;
  }

  private acquireNineSlice(x: number, y: number, width: number, height: number, left: number, right: number, top: number, bottom: number, key = 'ui-tooltip-frame-small'): Phaser.GameObjects.NineSlice {
    const index = this.nineSliceCursor++;
    let frame = this.nineSlicePool[index];
    const frameName = key === 'ui-tooltip-frame-small' ? 'trimmed' : undefined;
    if (!frame) {
      frame = this.scene.add.nineslice(x, y, key, frameName, width, height, left, right, top, bottom).setVisible(false);
      this.nineSlicePool[index] = frame;
    } else frame.setTexture(key, frameName).setPosition(x, y).setSlices(width, height, left, right, top, bottom);
    frame.setOrigin(0).setScale(1).setVisible(true);
    return frame;
  }

  /** Update only the transient hover layer; called directly from pointer events. */
  updateHover(pointerX: number, pointerY: number, drag?: DragPreview): string {
    this.hover = this.zoneAt(pointerX, pointerY);
    if (this.hover?.itemId !== this.justPlacedItem) this.justPlacedItem = undefined;
    this.renderHoverTooltip(pointerX, pointerY, drag);
    if (this.hover?.itemId) return `item:${this.hover.itemId}`;
    if (this.hover?.actorId) return `actor:${this.hover.actorId}`;
    if (this.hover?.heroId && this.hover.cell !== undefined) {
      const hero = this.ui.state.heroes.find(candidate => candidate.id === this.hover?.heroId);
      if (hero?.isPuppet && getPuppetCellModifiers(hero, this.hover.cell).length) return `cell:${hero.id}:${this.hover.cell}`;
    }
    return '';
  }

  private renderHoverTooltip(pointerX: number, pointerY: number, drag?: DragPreview): void {
    if (this.roomEntryPointer) {
      const { x, y } = this.roomEntryPointer;
      if (x === pointerX && y === pointerY) {
        this.tooltips.hide();
        return;
      }
      this.roomEntryPointer = undefined;
    }
    if (this.justPlacedItem && this.hover?.itemId === this.justPlacedItem) {
      this.tooltips.hide();
      return;
    }
    if (drag || this.scene.input.activePointer.isDown || this.ui.dialogOpen || this.ui.run.stage === 'opening') { this.tooltips.hide(); return; }
    const zone = this.hover;
    if (zone?.itemId) {
      const item = this.itemById(zone.itemId);
      if (item) {
        const hero = this.ui.state.heroes.find(candidate => candidate.items.includes(item));
        const relations = synergyTargets(item);
        const content = this.itemInspection(item, hero, relations);
        const poolBounds = this.ui.run.stage === 'cleared' ? this.poolContentBounds() : undefined;
        const related = hero?.items.filter(neighbour => neighbour !== item && areAdjacent(item, neighbour)
          && relations.some(rule => neighbour.tags?.includes(rule.tag))) ?? [];
        this.tooltips.showItem(content, pointerX, pointerY, this.width, this.height, {
          ...this.itemTooltipSource(zone, item),
          tooltipBounds: zone.tooltipBounds,
          safeTop: this.compactLayout && !zone.floorDrop ? poolBounds?.top ?? this.field.y : undefined,
          poolBounds,
          avoid: zone.heroId ? related.flatMap(neighbour => (occupiedCells(neighbour, neighbour.cell) ?? []).flatMap(index => {
            const cell = this.cells.get(`${zone.heroId}:${index}`);
            return cell ? [{ x: cell.x, y: cell.y, width: cell.size, height: cell.size }] : [];
          })) : undefined,
        });
        return;
      }
    }
    if (zone?.actorId) {
      const actor = this.ui.state.heroes.find(candidate => candidate.id === zone.actorId) ?? this.ui.state.enemies.find(candidate => candidate.id === zone.actorId);
      if (actor) { this.actorTooltip(actor, pointerX, pointerY); return; }
    }
    if (zone?.heroId && zone.cell !== undefined) {
      const hero = this.ui.state.heroes.find(candidate => candidate.id === zone.heroId);
      const modifier = hero?.isPuppet ? getPuppetCellModifiers(hero, zone.cell)[0] : undefined;
      if (modifier) {
        this.tooltips.showText(`cell:${hero?.id}:${zone.cell}`, modifier.label, pointerX, pointerY, this.width, this.height);
        return;
      }
    }
    this.tooltips.hide();
  }

  private itemInspection(item: CombatItem, hero?: Combatant, relations = synergyTargets(item)): ItemTooltipContent {
    const tags = [categoryLabels[item.category ?? 'relic'], ...(item.tags ?? []).map(tag => SYNERGY_TAG_LABELS[tag] ?? tag.toUpperCase())];

    const info = this.ui.itemDetails(item, hero);
    const icon = item.effect === 'heal' ? '✚' : item.effect === 'wind' ? '⚙' : item.effect === 'passive' ? '◆' : item.damageType === 'fire' ? '♨' : item.damageType === 'arcane' ? '✦' : '⚔';
    const damageLabel = !item.effect || item.effect === 'damage' ? (item.damageType === 'fire' ? 'огонь' : item.damageType === 'arcane' ? 'мистика' : 'физический') : '';
    const [primary, ...secondary] = info.stats;
    const stats = primary ? [`${icon} ${primary}${damageLabel ? ` (${damageLabel})` : ''}`, ...secondary] : [];
    return {
      key: item.id,
      title: item.name,
      tags: [
        { label: rarityLabels[item.rarity ?? 'common'], color: `#${itemRarityTint(item.rarity).toString(16).padStart(6, '0')}` },
        ...[...tags].reverse().map((label, index) => ({ label, color: ['#86ddb5', '#e3ba75', '#a5baf1'][index % 3]! })),
      ],
      stats,
      description: info.description,
      effects: [...info.modifiers, ...(item.passiveBonuses?.armor ? [`Общий предел брони: ${MAX_ARMOR}.`] : [])],
      relations: relations.map(rule => {
        const applied = info.adjacency.find(effect => effect.tag === rule.tag);
        const affectsNeighbour = !rule.negative && ['blade', 'firearm', 'clockwork'].includes(rule.tag);
        const active = hero?.items.some(candidate => candidate.id !== item.id
          && candidate.tags?.includes(rule.tag) && areAdjacent(item, candidate)) ?? false;
        return {
          label: (synergyRelationLabels[rule.tag] ?? SYNERGY_TAG_LABELS[rule.tag] ?? rule.tag).toLocaleLowerCase('ru').replace(/^./u, char => char.toLocaleUpperCase('ru')),
          detail: applied?.value ?? (affectsNeighbour ? `${rule.text} соседу` : rule.text),
          negative: !!rule.negative,
          active,
        };
      }),
    };
  }

  private rewardInfoDialog(item: CombatItem): void {
    this.modalBackdrop();
    this.zones.push({ x: 0, y: 0, width: this.width, height: this.height, action: 'close-reward-info' });
    const width = Math.min(290, this.width - 46);
    const bottom = this.tooltips.showItem({ ...this.itemInspection(item), shape: rotatedShape(item) }, 0, 0, this.width, this.height,
      { x: 0, y: 0, width: 0, height: 0, centered: true });
    this.button('Закрыть', (this.width - width) / 2, bottom + 10, width, 45, 'close-reward-info');
  }

  private itemTooltipSource(zone: UIZone, item: CombatItem): Pick<UIZone, 'x' | 'y' | 'width' | 'height'> {
    if (zone.heroId === undefined || zone.cell === undefined) return zone;
    const origin = this.cells.get(`${zone.heroId}:${item.cell ?? 0}`);
    if (!origin) return zone;
    const shape = rotatedShape(item);
    const columns = Math.max(1, ...shape.map(([x]) => x + 1));
    const rows = Math.max(1, ...shape.map(([, y]) => y + 1));
    return { x: origin.x, y: origin.y, width: columns * origin.size, height: rows * origin.size };
  }

  private clearTransientPresentation(): void {
    for (const view of this.actorViews.values()) {
      this.scene.tweens.killTweensOf(view.motion);
      this.scene.tweens.killTweensOf(view.action);
    }
    this.actorLayer.removeAll(true);
    this.actorViews.clear();
    this.pendingActorEvents = [];
    this.windAnimations.clear();
    this.displayedHealth.clear();
    this.clickNotice = undefined;
    this.windFlashes.clear();
    this.consumedSequence = 0;
    this.lastShakeAt = this.now;
    this.hover = undefined;
    this.zones.length = 0;
    this.cells.clear();
    this.scene.cameras.main.resetFX();
  }

  private partyCardSize(): { width: number; height: number } {
    const footer = this.ui.selectedItem ? (this.compactLayout ? 26 : 31) : 0;
    const padding = this.narrowPortrait ? 4 : 12;
    return {
      width: Math.max(1, (this.left.width - padding - PARTY_CARD_GAP) / 2),
      height: Math.max(1, (this.left.height - padding - PARTY_CARD_GAP - footer) / 2),
    };
  }

  private layout(compact: boolean): void {
    const margin = Math.max(5, Math.round(this.width * .007));
    const head = compact ? (this.narrowPortrait ? 34 : 62) : Math.max(62, this.height * .07);
    const y = head + margin;
    const roomHeight = this.height - y - margin;
    if (compact) {
      const { stage } = this.ui.run;
      const needsLootSpace = stage === 'reward' || stage === 'cache' || stage === 'cleared' || stage === 'route';
      const partyH = Math.floor(roomHeight * (needsLootSpace ? (this.narrowPortrait ? .56 : .57) : .59));
      this.left = { x: margin, y, width: this.width - margin * 2, height: partyH - margin };
      this.right = { x: margin, y: y + partyH, width: this.width - margin * 2, height: roomHeight - partyH };
    } else {
      const leftW = Math.floor((this.width - margin * 3) * .48);
      this.left = { x: margin, y, width: leftW, height: roomHeight };
      this.right = { x: margin * 2 + leftW, y, width: this.width - margin * 3 - leftW, height: roomHeight };
    }
    this.field = { x: this.right.x + 6, y: this.right.y + 30, width: this.right.width - 12, height: this.right.height - 38 };
  }

  private consumePresentationEvents(): void {
    for (const event of this.ui.state.events) {
      if (!event.sequence || event.sequence <= this.consumedSequence) continue;
      this.consumedSequence = event.sequence;
      if (this.ui.run.stage === 'battle' && event.kind !== 'state') {
        this.pendingActorEvents.push(event);
        if (this.pendingActorEvents.length > 24) this.pendingActorEvents.shift();
      }
      if (event.kind === 'wind') {
        const target = this.ui.state.heroes.find(hero => hero.id === event.targetId);
        if (target) {
          this.windAnimations.set(target.id, { from: Math.max(0, target.windUpCharge - event.amount), to: target.windUpCharge, until: this.now + 260 });
          this.windFlashes.set(target.id, this.now + 260);
        }
      }
      if (event.kind === 'enemy' || event.kind === 'item') {
        const sourceActor = [...this.ui.state.heroes, ...this.ui.state.enemies].find(actor => actor.id === event.actorId);
        const sourceItem = this.ui.allItems.find(item => item.id === event.sourceId);
        const target = [...this.ui.state.heroes, ...this.ui.state.enemies].find(actor => actor.id === event.targetId);
        const heavy = sourceActor?.isBoss || (sourceItem?.effect !== 'heal' && sourceItem?.effect !== 'wind' && event.amount >= Math.max(16, (target?.maxHp ?? 40) * .42));
        if (heavy && this.now - this.lastShakeAt >= 180) {
          this.scene.cameras.main.shake(110, .004);
          this.lastShakeAt = this.now;
        }
      }
    }
    for (const [id, animation] of this.windAnimations) if (animation.until < this.now) this.windAnimations.delete(id);
    for (const [id, until] of this.windFlashes) if (until < this.now) this.windFlashes.delete(id);
  }

  private background(): void {
    const tile = this.acquireTileSprite(0, 0, this.width, this.height, 'ui-background-tile').setOrigin(0).setTileScale(.32).setAlpha(.6);
    this.addToRoot(tile);
    const g = this.acquireGraphics();
    g.fillStyle(0x100c10, .4).fillRect(0, 0, this.width, this.height);
    this.addToRoot(g);
    this.panelTexture(this.right.x, this.right.y, this.right.width, this.right.height);
    const ornamentSize = Math.min(this.compactLayout ? 34 : 64, this.left.width * .08, this.left.height * .09);
    this.frameCorners(this.right.x, this.right.y, this.right.width, this.right.height, ornamentSize, .9);
  }

  private text(value: string, x: number, y: number, size = 14, color = '#f3e5cc', maxWidth?: number, originX = 0): Phaser.GameObjects.Text {
    const text = this.acquireText(x, y, value, { fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'bold', fontSize: `${Math.round(size)}px`, color, resolution: 1,
      stroke: '#171414', strokeThickness: size < 12 ? 1 : 2, wordWrap: maxWidth ? { width: maxWidth } : undefined });
    text.setOrigin(originX, 0); this.addToRoot(text); return text;
  }

  private titleText(value: string, x: number, y: number, size: number, color: string, maxWidth?: number, originX = 0): Phaser.GameObjects.Text {
    const text = this.acquireText(x, y, value, { fontFamily: '"Woundbound Title", Georgia, serif', fontStyle: 'bold', fontSize: `${Math.round(size)}px`, color,
      resolution: 2, stroke: '#171414', strokeThickness: 2 });
    text.setOrigin(originX, 0);
    if (maxWidth && text.width > maxWidth) text.setScale(maxWidth / text.width);
    this.addToRoot(text); return text;
  }

  private button(label: string, x: number, y: number, width: number, height: number, action: string, value = '',
    primary = false, enabled = true, hitArea = { x, y, width, height }): void {
    const hot = enabled && this.hover?.action === action && this.hover.value === value;
    const pressed = hot && this.scene.input.activePointer.leftButtonDown();
    const isControlIcon = controlIcons.has(label);
    if (this.scene.textures.exists('ui-button-plate')) {
      const capWidth = Math.min(width * .28, height * 300 / 404);
      const centerWidth = Math.max(1, width - capWidth * 2);
      const tint = pressed ? 0xc7a27b : hot ? 0xfff1d4 : isControlIcon ? 0xf3dcb8 : primary ? 0xffffff : 0xd0c1a8;
      const plate = [
        this.acquireImage(x, y, 'ui-button-plate', 'left-cap').setOrigin(0).setDisplaySize(capWidth, height),
        this.acquireImage(x + capWidth, y, 'ui-button-plate', 'center').setOrigin(0).setDisplaySize(centerWidth, height),
        this.acquireImage(x + capWidth + centerWidth, y, 'ui-button-plate', 'right-cap').setOrigin(0).setDisplaySize(capWidth, height),
      ];
      plate.forEach(part => part.setTint(tint).setAlpha(enabled ? 1 : .40));
      this.addToRoot(plate);
      if (hot && !pressed) this.buttonHover(plate, y, height);
      if (!isControlIcon && width >= height * 5) this.buttonGearTrain(x, y, width, height, hot);
    } else {
      const g = this.acquireGraphics();
      g.fillStyle(primary ? 0x74552f : 0x372e2c, 1).fillRoundedRect(x, y, width, height, 5);
      g.lineStyle(1, primary ? 0xe7bf72 : 0x8a755c, 1).strokeRoundedRect(x, y, width, height, 5);
      this.addToRoot(g);
    }
    if (isControlIcon) {
      const icon = this.acquireText(x + width / 2, y + height / 2, label, {
        fontFamily: 'Georgia, serif', fontStyle: 'bold', fontSize: `${Math.round(height * .68)}px`,
        color: !enabled ? '#978b84' : hot ? '#fff8e8' : '#f4dfba', stroke: '#171014', strokeThickness: 1, resolution: 2,
      }).setOrigin(.5);
      this.addToRoot(icon);
    }
    else {
      const fontSize = action === 'claim' ? Math.min(15, height * .38) : Math.min(21, height * .43);
      const sidePadding = width >= height * 5 ? height * 1.4 : 10;
      const caption = this.titleText(label, x + width / 2, y + height / 2, fontSize, hot ? '#fff8e0' : '#fff0d4', width - sidePadding * 2, .5);
      caption.setOrigin(.5, .5);
    }
    if (enabled) this.zones.push({ ...hitArea, action, value });
  }

  private buttonHover(plate: Phaser.GameObjects.Image[], y: number, height: number): void {
    const tick = Math.floor(this.now / 75);
    const lightAlpha = tick % 8 < 2 ? .38 : .28;
    for (const segment of plate) {
      const glow = this.acquireImage(segment.x, y, 'ui-button-plate', segment.frame.name)
        .setOrigin(0).setDisplaySize(segment.displayWidth, height).setTint(0xffc878)
        .setBlendMode('ADD').setAlpha(lightAlpha);
      this.addToRoot(glow);
    }

  }

  private buttonGearTrain(x: number, y: number, width: number, height: number, hot: boolean): void {
    const texture = 'ui-button-hover-cog';
    if (!this.scene.textures.exists(texture)) return;
    const size = Math.min(24, height * .47);
    const rotation = hot ? Math.floor(this.now / 75) * Math.PI / 24 : 0;
    for (const side of [-1, 1]) {
      const outerX = x + width / 2 + side * (width / 2 - height * .65);
      const innerX = outerX - side * size * .79;
      const outerY = y + height * .59;
      const innerY = y + height * .40;
      const tint = hot ? 0xffedcd : 0xd5b283;
      const backing = this.acquireGraphics();
      backing.fillStyle(0x171012, .94).fillEllipse((outerX + innerX) / 2, y + height / 2, size * 2, size * 1.42);
      this.addToRoot(backing);
      this.addToRoot([
        this.acquireImage(outerX, outerY, texture).setDisplaySize(size, size).setRotation(side * rotation).setTint(tint),
        this.acquireImage(innerX, innerY, texture).setDisplaySize(size, size).setRotation(-side * rotation + Math.PI / 12).setTint(tint),
      ]);
    }
  }

  private header(): void {
    const compact = this.compactLayout;
    const narrow = this.narrowPortrait;
    const controlWidth = narrow ? 33 : 36;
    const controlStep = narrow ? 35 : 40;
    const controlRight = this.width - this.left.x - 6;
    const firstControl = controlRight - controlWidth - controlStep * 3;
    const stageName = this.ui.run.stage === 'defeat' ? 'КОНЕЦ ЗАБЕГА' : `АКТ 1 · СПУСК ${this.ui.run.room}/${RUN_ROOM_COUNT}`;
    if (this.ui.run.stage !== 'opening' && this.ui.run.stage !== 'victory') {
      const controlsLeft = this.width - 162 - this.left.x;
      const centeredWidth = 2 * (controlsLeft - this.width / 2 - 8);
      const panelW = narrow ? Math.max(1, firstControl - 10) : compact
        ? Math.min(420, this.width * .74)
        : Math.min(420, this.width * .57, Math.max(1, centeredWidth >= 180 ? centeredWidth : controlsLeft - 16));
      const panelX = narrow ? 5 : compact || centeredWidth >= 180 ? (this.width - panelW) / 2 : 8;
      const panelH = compact ? 32 : Math.min(58, Math.max(54, this.height * .06));
      const panelY = 3;
      this.panelTexture(panelX, panelY, panelW, panelH);
      const label = this.acquireText(panelX + panelW / 2, panelY + panelH / 2, stageName, {
        fontFamily: 'Georgia, serif', fontStyle: 'bold', fontSize: `${Math.round(Math.min(compact ? 16 : 20, Math.max(14, this.height * .026)))}px`,
        color: '#f2dfbd', stroke: '#171414', strokeThickness: 2, resolution: 2,
      }).setOrigin(.5, .5);
      if (label.width > panelW - 20) label.setScale((panelW - 20) / label.width);
      this.addToRoot(label);
    }
    const controlY = compact && !narrow ? 36 : 5;
    const controlHeight = compact ? 28 : this.height < 600 ? 28 : 34;
    const controls = [['⚙', 'options'], ['⛶', 'fullscreen'], ['?', 'help'], ['↻', 'restart']] as const;
    controls.forEach(([icon, action], index) => {
      const x = firstControl + index * controlStep;
      const hitArea = narrow ? { x, y: 1, width: controlStep - 1, height: 36 } : undefined;
      this.button(icon, x, controlY, controlWidth, controlHeight, action, '', false, true, hitArea);
    });
  }

  private party(drag?: DragPreview): void {
    const g = this.acquireGraphics(); this.addToRoot(g);
    const heroes = [...this.ui.state.heroes].sort((a, b) => a.slot - b.slot);
    const { width: cardW, height: cardH } = this.partyCardSize();
    const boardSize = Math.max(1, Math.floor(Math.min(cardW - 4, cardH - 4)));
    const boardSpan = boardSize * 2 + PARTY_CARD_GAP + 4;
    const insetX = Math.round((this.left.width - boardSpan) / 2);
    const insetY = Math.round((cardH * 2 + PARTY_CARD_GAP - boardSpan) / 2) + (this.narrowPortrait ? 2 : 6);
    const nicheHeight = this.narrowPortrait ? .55 : INVENTORY_NICHE_HEIGHT;
    const cell = Math.max(1, Math.floor(boardSize * nicheHeight / INVENTORY_GRID_SIZE));
    const gridSize = INVENTORY_GRID_SIZE * cell;
    const compact = this.compactLayout;
    const inspectingInventory = ['reward', 'cache', 'cleared'].includes(this.ui.run.stage);
    for (let h = 0; h < heroes.length; h++) {
      const hero = heroes[h]!;
      const classId = heroClassForActor(hero) ?? 'guard';
      const theme = classCardThemes[classId];
      const layout = dashboardLayout[classId];
      const boardX = this.left.x + insetX + (h % 2) * (boardSize + PARTY_CARD_GAP + 4);
      const boardY = this.left.y + insetY + Math.floor(h / 2) * (boardSize + PARTY_CARD_GAP + 4);
      const itemTooltipBounds = inspectingInventory ? {
        x: boardX + boardSize * layout.tray[0],
        y: boardY + boardSize * layout.tray[1],
        width: boardSize * layout.tray[2],
        height: boardSize * layout.tray[3],
      } : undefined;
      const stopped = hero.status === 'stopped';
      const chargeRatio = stopped ? Math.max(0, Math.min(1, hero.windUpCharge / Math.max(1, hero.maxWindUp))) : 0;
      const windPulse = stopped ? (Math.sin(this.now / 125) + 1) / 2 : 0;
      const flashUntil = this.windFlashes.get(hero.id) ?? 0;
      const clickFlash = flashUntil > this.now ? (flashUntil - this.now) / 260 : 0;
      g.fillStyle(0x050408, .7).fillRoundedRect(boardX + 3, boardY + 5, boardSize, boardSize, 5);
      const board = this.acquireImage(boardX, boardY, `ui-dashboard-${classId}`).setOrigin(0).setDisplaySize(boardSize, boardSize);
      if (stopped) board.setTint(mixTint(0x777777, 0xf4dfad, chargeRatio * .65));
      else if (hero.status === 'dead') board.setTint(0x777777);
      else if (classId === 'pilgrim') board.setTint(0xe8e3dc);
      this.addToRoot(board);
      if (stopped && this.ui.state.phase === 'combat') {
        this.zones.push({ x: boardX, y: boardY, width: boardSize, height: boardSize, action: 'wind', value: hero.id });
      }
      const isPuppet = hero.isPuppet;
      this.actorImage(hero.id, boardX + boardSize * .2045, boardY + boardSize * .212, boardSize * .23, hero.status, theme.dollTint);
      const nameX = boardX + boardSize * layout.labelX, nameY = boardY + boardSize * .115;
      const nameW = boardSize * layout.labelW;
      const nameSize = Math.max(compact ? 10 : 11, Math.min(compact ? 15 : 19, boardSize * (compact ? .064 : .066)));
      let nameTextW = nameW;
      let puppetBadge: { size: number; offset: number; color: number } | undefined;
      if (isPuppet) {
        const badgeSize = Math.min(compact ? 12 : 18, Math.max(compact ? 7 : 10, boardSize * (compact ? .036 : .042)), nameSize * .9);
        const badgeInset = compact ? 3 : 5;
        const badgeOffset = nameW / 2 - badgeSize / 2 - badgeInset;
        const badgeColor = hero.status === 'dead' ? 0xaaa5a0 : stopped ? 0xb8b9bc : 0xf0bd64;
        puppetBadge = { size: badgeSize, offset: badgeOffset, color: badgeColor };
        nameTextW = Math.max(16, nameW - badgeSize * 2 - (compact ? 12 : 18));
      }
      const parchment = classId === 'pilgrim';
      const dimmed = stopped || hero.status === 'dead';
      const nameColor = parchment ? '#251c16' : dimmed ? '#d5d5d8' : '#fff2d9';
      const nameText = this.titleText(hero.name.toUpperCase(), nameX, nameY, nameSize, nameColor, nameTextW, .5);
      if (parchment) nameText.setStroke('#e9d6ac', 0);
      const statusLabel = actorCardStatus[hero.status].toUpperCase();
      const statusY = boardY + boardSize * (!compact && classId === 'clockmaker' ? .197 : .215);
      let statusFontSize = Math.max(compact ? 8 : 9, Math.round(Math.min(compact ? 10 : 12, boardSize * .05, (nameW - 8) / (statusLabel.length * .58))));
      const statusText = this.acquireText(nameX, statusY, statusLabel, {
        fontFamily: 'Georgia, serif', fontStyle: 'bold', fontSize: statusFontSize, letterSpacing: compact ? 0 : .2,
        color: parchment ? '#33251b' : dimmed ? '#e5e2df' : '#f4e5cd', resolution: 2, stroke: '#171414', strokeThickness: parchment ? 0 : 1,
      }).setOrigin(.5, .5);
      const statusWidth = isPuppet ? nameTextW : nameW - 8;
      while (statusText.width > statusWidth && statusFontSize > 7) statusText.setFontSize(--statusFontSize);
      if (statusText.width > statusWidth) statusText.setScale(statusWidth / statusText.width);
      this.addToRoot(statusText);
      if (puppetBadge) {
        const badgeY = nameY + nameText.displayHeight / 2;
        this.puppetStateBadge(nameX - puppetBadge.offset, badgeY, puppetBadge.size, puppetBadge.color);
        this.puppetStateBadge(nameX + puppetBadge.offset, badgeY, puppetBadge.size, puppetBadge.color);
      }
      const animation = this.windAnimations.get(hero.id);
      const shownWind = animation ? animation.from + (animation.to - animation.from) * Math.min(1, 1 - Math.max(0, animation.until - this.now) / 260) : hero.windUpCharge;
      this.resourceModule(boardX, boardY, boardSize, hero, shownWind);
      const gridX = Math.round(boardX + boardSize * (layout.tray[0] + layout.tray[2] / 2) - gridSize / 2);
      const gridY = Math.round(boardY + boardSize * INVENTORY_NICHE_CENTER - gridSize / 2);
      const infoSize = Math.max(12, Math.min(25, Math.round(boardSize * .085)));
      const infoX = Math.round(boardX + boardSize * .366 - infoSize / 2);
      const infoY = Math.round(boardY + boardSize * .314 - infoSize / 2);
      const infoTop = infoY - 6;
      const infoHitArea = this.narrowPortrait && !stopped ? {
        x: infoX - 7, y: infoTop, width: infoSize + 14, height: Math.min(gridY - 1, infoY + infoSize + 4) - infoTop,
      } : undefined;
      this.button('', infoX, infoY, infoSize, infoSize, 'hero-info', hero.id, false, true, infoHitArea);
      const infoGlyph = this.acquireText(infoX + infoSize / 2, infoY + infoSize / 2, 'i', {
        fontFamily: 'Georgia, serif', fontStyle: 'bold', fontSize: `${Math.round(infoSize * .67)}px`,
        color: '#fff7dc', stroke: '#171014', strokeThickness: 1, resolution: 2,
      }).setOrigin(.5, .5);
      this.addToRoot(infoGlyph);
      const gridMarks = this.acquireGraphics();
      const itemOrigins: CombatItem[] = [];
      for (let i = 0; i < INVENTORY_CELL_COUNT; i++) {
        const cx = gridX + inventoryColumn(i) * cell, cy = gridY + inventoryRow(i) * cell;
        const item = hero.items.find(candidate => occupiedCells(candidate, candidate.cell ?? 0)?.includes(i));
        const occupied = item ? occupiedCells(item, item.cell ?? 0) : null;
        const isOrigin = item && occupied?.[0] === i;
        const puppetCell = hero.isPuppet ? getPuppetCellModifiers(hero, i)[0] : undefined;
        if (puppetCell) gridMarks.fillStyle(theme.puppetCellTint, .23).fillRect(cx + 1, cy + 1, cell - 2, cell - 2);
        const windCard = stopped && this.ui.state.phase === 'combat';
        const itemId = item && occupied?.includes(i) ? item.id : undefined;
        this.zones.push({
          x: cx, y: cy, width: cell, height: cell,
          action: windCard ? 'wind' : 'cell', value: windCard ? hero.id : `${hero.id}:${i}`,
          heroId: hero.id, cell: i, itemId,
          tooltipBounds: itemId ? itemTooltipBounds : undefined,
        });
        this.cells.set(`${hero.id}:${i}`, { x: cx, y: cy, size: cell });
        if (item && occupied?.includes(i) && isOrigin) itemOrigins.push(item);
      }
      this.addToRoot(gridMarks);
      const texture = this.acquireImage(gridX + INVENTORY_GRID_SIZE * cell / 2, gridY + INVENTORY_GRID_SIZE * cell / 2, 'ui-inventory-texture')
        .setDisplaySize(gridSize, gridSize).setAlpha(stopped ? .05 : .08);
      this.addToRoot(texture);
      const crispGrid = this.acquireGraphics();
      crispGrid.lineStyle(1, stopped ? 0xbfc0c6 : theme.edge, .44);
      for (let line = 0; line <= INVENTORY_GRID_SIZE; line++) {
        crispGrid.lineBetween(gridX + line * cell, gridY, gridX + line * cell, gridY + gridSize);
        crispGrid.lineBetween(gridX, gridY + line * cell, gridX + gridSize, gridY + line * cell);
      }
      this.addToRoot(crispGrid);
      // Draw sprites only after every cell and grid line so the grid cannot cut through art.
      for (const item of itemOrigins) this.drawItem(item, gridX, gridY, cell, stopped || hero.status === 'rebirthing');
      const inspected = drag
        ? (drag.valid && drag.heroId === hero.id && drag.anchor !== undefined ? { ...drag.item, cell: drag.anchor } : undefined)
        : hero.items.find(item => item.id === this.hover?.itemId);
      const relations = inspected ? synergyTargets(inspected) : [];
      const sourceCells = inspected ? occupiedCells(inspected, inspected.cell ?? 0) ?? [] : [];
      if (relations.length && sourceCells.length) {
        const glow = this.acquireGraphics();
        const around = new Set<number>();
        const activeTargets = new Map<string, { item: CombatItem; negative: boolean }>();
        for (const index of sourceCells) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const col = inventoryColumn(index) + dx!, row = inventoryRow(index) + dy!;
          if (col >= 0 && col < INVENTORY_GRID_SIZE && row >= 0 && row < INVENTORY_GRID_SIZE) {
            const next = row * INVENTORY_GRID_SIZE + col;
            if (!sourceCells.includes(next)) around.add(next);
          }
        }
        for (const index of around) {
          const neighbour = hero.items.find(item => item.id !== inspected?.id && occupiedCells(item, item.cell ?? 0)?.includes(index));
          const match = relations.find(rule => neighbour?.tags?.includes(rule.tag));
          if (match && neighbour) activeTargets.set(neighbour.id, { item: neighbour, negative: !!match.negative });
          const color = match?.negative ? 0xf09d58 : match ? 0x78f2ad : 0xe3bf72;
          const cx = gridX + inventoryColumn(index) * cell, cy = gridY + inventoryRow(index) * cell;
          if (match) {
            glow.fillStyle(color, .20).fillRect(cx + 1, cy + 1, cell - 2, cell - 2);
            glow.lineStyle(1, color, .85).strokeRect(cx + 1, cy + 1, cell - 2, cell - 2);
          } else if (!neighbour) {
            glow.fillStyle(color, .55).fillCircle(cx + cell / 2, cy + cell / 2, Math.max(1, cell * .09));
          }
        }
        this.addToRoot(glow);
        for (const { item: target, negative } of activeTargets.values()) {
          const cells = occupiedCells(target, target.cell ?? 0);
          if (!cells?.length) continue;
          const topRight = cells.reduce((best, index) => inventoryRow(index) < inventoryRow(best)
            || inventoryRow(index) === inventoryRow(best) && inventoryColumn(index) > inventoryColumn(best) ? index : best);
          const markerRadius = Math.min(5, cell * .25);
          const markerX = gridX + (inventoryColumn(topRight) + 1) * cell - markerRadius - 1;
          const markerY = gridY + inventoryRow(topRight) * cell + markerRadius + 1;
          const markerColor = negative ? 0xf09d58 : 0x9bf0ba;
          const marker = this.acquireGraphics();
          marker.fillStyle(0x162018, .96).fillCircle(markerX, markerY, markerRadius);
          marker.lineStyle(1, markerColor, .95).strokeCircle(markerX, markerY, markerRadius);
          this.addToRoot(marker);
          this.addToRoot(this.acquireText(markerX, markerY, negative ? '!' : '✓', {
            fontFamily: 'Georgia, serif', fontStyle: 'bold', fontSize: `${Math.max(5, Math.floor(markerRadius * 1.4))}px`,
            color: negative ? '#ffd3ad' : '#d8ffe5',
            stroke: '#10140f', strokeThickness: 1, resolution: 2,
          }).setOrigin(.5));
        }
      }
      if (hero.status === 'rebirthing') {
        const dim = this.acquireGraphics().fillStyle(0x070a0f, .37).fillRect(gridX, gridY, gridSize, gridSize);
        this.addToRoot(dim);
      }
      if ((stopped || clickFlash > 0) && this.ui.state.phase === 'combat') {
        const chargeGlow = this.acquireGraphics();
        chargeGlow.fillStyle(theme.puppetCellTint, Math.min(.42, .025 + chargeRatio * .16 + windPulse * .035 + clickFlash * .3)).fillRoundedRect(boardX + 3, boardY + 3, boardSize - 6, boardSize - 6, 4);
        this.addToRoot(chargeGlow);
        if (stopped) {
          const promptY = boardY + boardSize * .60;
          const promptWidth = boardSize * .90;
          const promptX = boardX + boardSize / 2;
          const promptHeight = Math.max(24, boardSize * .11);
          this.panelTexture(promptX - promptWidth / 2, promptY, promptWidth, promptHeight);
          const prompt = this.titleText('НАЖМИ, ЧТОБЫ ЗАВЕСТИ', promptX, promptY + promptHeight / 2, Math.max(11, Math.min(19, boardSize * .055)), '#ffe3a8', promptWidth - 14, .5).setOrigin(.5);
          prompt.setAlpha(.75 + windPulse * .25);
        }
      }
    }
    const rotateY = this.left.y + this.left.height - (compact ? 24 : 30);
    if (this.ui.selectedItem) {
      this.button('Повернуть ↻', this.left.x + 8, rotateY, compact ? 80 : 112, compact ? 22 : 28, 'rotate');
    this.button('В пул', this.left.x + (compact ? 94 : 122), rotateY, compact ? 64 : 82, compact ? 22 : 28, 'store', this.ui.selectedItem);
    }
  }

  private cardGlyph(kind: 'heart' | 'gear' | 'key', x: number, y: number, color: number): void {
    const g = this.acquireGraphics();
    g.fillStyle(color, 1);
    if (kind === 'heart') {
      g.fillCircle(x - 2, y - 1, 3).fillCircle(x + 2, y - 1, 3);
      g.fillTriangle(x - 5, y, x + 5, y, x, y + 6);
    } else if (kind === 'gear') {
      g.lineStyle(2, color, 1).strokeCircle(x, y, 3);
      g.fillCircle(x, y, 1.3);
      for (let tooth = 0; tooth < 6; tooth++) {
        const angle = tooth * Math.PI / 3;
        g.lineBetween(x + Math.cos(angle) * 3, y + Math.sin(angle) * 3, x + Math.cos(angle) * 5, y + Math.sin(angle) * 5);
      }
    } else {
      g.lineStyle(1.8, color, 1).strokeCircle(x - 2, y - 1, 2.5);
      g.lineBetween(x, y, x + 5, y + 5).lineBetween(x + 3, y + 3, x + 5, y + 1).lineBetween(x + 4, y + 4, x + 6, y + 2);
    }
    this.addToRoot(g);
  }

  private drawItem(item: CombatItem, gridX: number, gridY: number, cell: number, muted = false): void {
    const cells = rotatedShape(item);
    const anchorX = gridX + inventoryColumn(item.cell ?? 0) * cell, anchorY = gridY + inventoryRow(item.cell ?? 0) * cell;
    this.drawItemFootprint(item, cells, anchorX, anchorY, cell, muted);
    const image = this.drawFootprintArt(item, cells, anchorX, anchorY, cell);
    if (muted) image.setTint(0xb0b0b3);
    const anticipation = this.ui.run.stage === 'battle' && this.ui.state.phase === 'combat' && this.ui.state.outcome === 'ongoing'
      && item.remainingMs > 0 && item.remainingMs < Math.min(300, item.cooldownMs * .2);
    if (anticipation) {
      image.x += Math.sin(this.now / 38) * Math.min(1, Math.max(1, cell * .04) * .35);
    }
    if (item.trigger !== 'passive' && item.effect !== 'passive') {
      const bottomY = Math.max(...cells.map(([, y]) => y));
      const bottomCells = cells.filter(([, y]) => y === bottomY).map(([x]) => x).sort((a, b) => a - b);
      let barStart = bottomCells[0] ?? 0, barLength = 1, currentStart = barStart, currentLength = 1;
      for (let index = 1; index < bottomCells.length; index++) {
        if (bottomCells[index] === bottomCells[index - 1]! + 1) currentLength++;
        else { if (currentLength > barLength) { barStart = currentStart; barLength = currentLength; } currentStart = bottomCells[index]!; currentLength = 1; }
      }
      if (currentLength > barLength) { barStart = currentStart; barLength = currentLength; }
      const cooldown = Math.max(0, Math.min(1, 1 - item.remainingMs / Math.max(1, item.cooldownMs)));
      const g = this.acquireGraphics();
      const trackHeight = Math.max(1, Math.min(3, Math.round(cell * .1)));
      const trackX = anchorX + barStart * cell + 2;
      const trackY = anchorY + (bottomY + 1) * cell - trackHeight - 2;
      const trackWidth = Math.max(4, barLength * cell - 4);
      g.fillStyle(0x211b1b, 1).fillRect(trackX, trackY, trackWidth, trackHeight);
      g.fillStyle(muted ? 0x96969a : anticipation ? 0xffd37b : 0xe5b75f, 1).fillRect(trackX, trackY, trackWidth * cooldown, trackHeight);
      this.addToRoot(g);
    }
  }

  private recess(x: number, y: number, width: number, height: number, edge: number, bottom: number): void {
    const g = this.acquireGraphics();
    g.fillStyle(0x08070a, .9).fillRect(x, y, width, height);
    g.fillStyle(edge, .35).fillRect(x, y, width, 2).fillRect(x, y, 2, height);
    g.fillStyle(0x08070a, .75).fillRect(x, y + height - 2, width, 2).fillRect(x + width - 2, y, 2, height);
    g.fillStyle(bottom, 1).fillRect(x + 3, y + 3, Math.max(0, width - 6), Math.max(0, height - 6));
    g.fillStyle(0x050408, .55).fillRect(x + 3, y + 3, Math.max(0, width - 6), 3).fillRect(x + 3, y + 3, 3, Math.max(0, height - 6));
    g.fillStyle(0x08070a, .2).fillRect(x + 6, y + 6, Math.max(0, width - 9), 2).fillRect(x + 6, y + 6, 2, Math.max(0, height - 9));
    this.addToRoot(g);
  }

  private meter(x: number, y: number, width: number, height: number, value: number, max: number, label: string, color: number): void {
    const g = this.acquireGraphics();
    const filled = Math.max(0, width - 4) * Math.max(0, Math.min(1, value / Math.max(1, max)));
    g.fillStyle(0x08070a, 1).fillRoundedRect(x, y, width, height, 3);
    g.lineStyle(1, 0xc1aa89, .45).strokeRoundedRect(x, y, width, height, 3);
    if (filled > 0) {
      g.fillStyle(color, 1).fillRoundedRect(x + 2, y + 2, filled, Math.max(2, height - 4), 2);
      g.fillStyle(0xffe8cd, .3).fillRect(x + 3, y + 2, Math.max(0, filled - 2), 1);
    }
    this.addToRoot(g);
    if (label) this.text(label, x, y - (this.compactLayout ? 10 : 14), this.compactLayout ? 7 : 10, '#f0ddbd', width);
  }

  private resourceModule(boardX: number, boardY: number, boardSize: number, hero: Combatant, shownWind: number): void {
    const isDoll = hero.status === 'active' || hero.status === 'stopped';
    const isRebirthing = hero.status === 'rebirthing';
    const sourceWidth = isDoll ? 1888 : 1840, sourceHeight = isDoll ? 412 : 391;
    const width = boardSize * .50, height = boardSize * .09;
    const capWidth = height * 300 / sourceHeight, middleWidth = Math.max(1, width - capWidth * 2);
    const x = boardX + boardSize * .66 - width / 2;
    const y = boardY + boardSize * .32 - height / 2;
    const g = this.acquireGraphics();
    const mapX = (fraction: number): number => {
      const sourceX = fraction * sourceWidth;
      if (sourceX <= 300) return x + sourceX * capWidth / 300;
      if (sourceX >= sourceWidth - 300) return x + width - (sourceWidth - sourceX) * capWidth / 300;
      return x + capWidth + (sourceX - 300) / (sourceWidth - 600) * middleWidth;
    };
    const liquid = (left: number, top: number, right: number, bottom: number, value: number, max: number, color: number): void => {
      const ratio = Math.max(0, Math.min(1, value / Math.max(1, max)));
      const lx = mapX(left), fillWidth = (mapX(right) - lx) * ratio;
      if (fillWidth <= 0) return;
      const ly = y + height * top, h = Math.max(1, height * (bottom - top));
      g.fillStyle(color, .3).fillRoundedRect(lx - 1, ly - 1, fillWidth + 2, h + 2, Math.min(3, h / 2));
      g.fillStyle(color, .96).fillRoundedRect(lx, ly, fillWidth, h, Math.min(2, h / 2));
      g.fillStyle(0xfff1dc, .22).fillRect(lx + 1, ly + 1, Math.max(0, fillWidth - 2), Math.max(1, h * .15));
    };
    const health = isDoll ? hero.durability : hero.hp;
    const healthKey = `card-${hero.id}-${isDoll ? 'doll' : 'human'}`;
    const previousHealth = this.displayedHealth.get(healthKey);
    const shownHealth = previousHealth ? previousHealth.value + (health - previousHealth.value) * (1 - Math.exp(-Math.max(0, this.now - previousHealth.at) / 250)) : health;
    this.displayedHealth.set(healthKey, { value: shownHealth, at: this.now });
    if (isDoll) {
      liquid(.145, .20, .85, .55, shownHealth, hero.maxDurability, 0xce3653);
      liquid(.145, .77, .85, .87, shownWind, hero.maxWindUp, 0xe4aa49);
    } else if (isRebirthing) {
      liquid(.16, .33, .84, .69, COMBAT_CONFIG.rebirthMs - hero.rebirthMs, COMBAT_CONFIG.rebirthMs, 0x59c9c5);
    } else if (hero.status === 'human') {
      liquid(.16, .33, .84, .69, shownHealth, hero.maxHp, 0xce3653);
    }
    this.addToRoot(g);
    const key = isDoll ? 'ui-tube-double' : 'ui-tube-single';
    const leftCap = this.acquireImage(x, y, key, 'left-cap').setOrigin(0).setDisplaySize(capWidth, height);
    const middle = this.acquireImage(x + capWidth, y, key, 'glass-middle').setOrigin(0).setDisplaySize(middleWidth, height);
    const rightCap = this.acquireImage(x + capWidth + middleWidth, y, key, 'right-cap').setOrigin(0).setDisplaySize(capWidth, height);
    this.addToRoot([leftCap, middle, rightCap]);
    if (hero.status === 'human' || isDoll) {
      const current = isDoll ? hero.durability : hero.hp;
      const maximum = isDoll ? hero.maxDurability : hero.maxHp;
      const value = this.acquireText(x + width / 2, y + height * .5, `${Math.ceil(current)} / ${maximum}`, {
        fontFamily: 'Georgia, serif', fontStyle: 'bold', fontSize: `${Math.round(Math.max(8, Math.min(16, height * .74)))}px`,
        color: '#fff1dc', stroke: '#171016', strokeThickness: 1, resolution: 2,
      }).setOrigin(.5, .5);
      if (value.width > width * .67) value.setScale(width * .67 / value.width);
      value.setShadow(0, 1, '#100b10', 2, false, true);
      this.addToRoot(value);
    }
  }

  private roomTitle(run: GameUI['run']): string {
    switch (run.stage) {
      case 'defeat': return 'Конец пути';
      case 'reward': return 'Трофеи из пепла';
      case 'cleared': return clearedCopy[run.current].title;
      case 'route': return 'Выберите следующий след';
      case 'cache': return run.roomLabel || 'Забытый тайник';
      case 'workshop': return 'Часовая мастерская';
      case 'event': return 'Лазарет забытого братства';
      default: return run.roomLabel;
    }
  }

  private room(drag?: DragPreview): void {
    const run = this.ui.run;
    if (run.stage !== 'victory' && run.stage !== 'cleared') {
      const title = this.roomTitle(run);
      this.panelTexture(this.right.x + 5, this.right.y + 3, this.right.width - 10, 27);
      if (run.stage !== 'opening') {
        const heading = this.titleText(title, this.right.x + this.right.width / 2, this.right.y + 16, this.compactLayout ? 15 : 19, '#f2d39a', this.right.width - 48, .5);
        heading.setOrigin(.5, .5);
      }
    }
    if (run.stage !== 'battle') this.roomBackdrop(true);
    if (run.stage === 'battle') this.battlefield();
    else if (run.stage === 'route') this.choices();
    else if (run.stage === 'reward' || run.stage === 'cache') this.rewards();
    else if (run.stage === 'workshop') this.workshop();
    else if (run.stage === 'event') this.event();
    else if (run.stage === 'cleared') this.cleared(drag?.item.id);
    else if (run.stage === 'victory' || run.stage === 'defeat') { this.battlefield(); this.ending(); }
  }

  private openingModal(): void {
    const orientation = this.height > this.width ? 'portrait' : 'desktop';
    const fallback = `ui-opening-${orientation === 'portrait' ? 'desktop' : 'portrait'}`;
    const backgroundKey = this.ensureImage(`ui-opening-${orientation}`, `/assets/ui/opening-${orientation}-refined.png`, fallback);
    const background = this.acquireImage(this.width / 2, this.height / 2,
      backgroundKey);
    const scale = Math.max(this.width / background.width, this.height / background.height);
    background.setScale(scale);
    this.addToRoot(background);

    const selectorH = Math.max(40, Math.min(48, this.height * .065));
    const optionH = Math.max(38, Math.min(44, this.height * .06));
    const menuExtra = this.ui.startLoadoutMenuOpen ? 4 + optionH * 2 : 0;
    const optionsH = Math.max(40, Math.min(46, this.height * .065));
    const verticalLimit = Math.max(60, this.height * .50 - selectorH - menuExtra - optionsH - 8);
    const w = Math.min(this.width - 28, 600, verticalLimit * 3);
    const h = w / 3;
    const selectorW = Math.min(360, w * .82, this.width - 32);
    const groupH = h + 12 + selectorH + menuExtra + 8 + optionsH;
    const groupY = Math.max(4, Math.min(this.height - groupH - 6, Math.max(this.height * .42, (this.height - groupH) / 2 + Math.min(40, this.height * .06))));
    const x = (this.width - w) / 2, y = groupY;
    const logo = this.acquireImage(this.width / 2, 0, 'ui-woundbound-logo').setOrigin(.5, 0);
    const logoWidth = Math.min(this.width * .84, 820, Math.max(1, y - 12) * logo.width / logo.height);
    const logoHeight = logoWidth * logo.height / logo.width;
    logo.setPosition(this.width / 2, Math.max(4, y - logoHeight - 18)).setDisplaySize(logoWidth, logoHeight); this.addToRoot(logo);
    const hot = this.hover?.action === 'begin-run';
    const delta = this.openingHoverAt ? Math.min(100, this.now - this.openingHoverAt) : 0;
    this.openingHoverAt = this.now;
    this.openingHover += ((hot ? 1 : 0) - this.openingHover) * (1 - Math.exp(-delta / 110));
    const hover = this.openingHover;
    const tick = Math.floor(this.now / 180) % 14;
    const buttonScale = 1 + hover * .018 + (tick === 0 ? .012 : tick === 1 ? .006 : 0);
    const plate = this.acquireImage(this.width / 2, y + h / 2, 'ui-descent-button').setDisplaySize(w * buttonScale, h * buttonScale);
    this.addToRoot(plate);
    if (hover > .01 || tick < 2) {
      const light = this.acquireImage(this.width / 2, y + h / 2, 'ui-descent-button')
        .setDisplaySize(w * buttonScale, h * buttonScale).setTint(0xffc878)
        .setBlendMode('ADD').setAlpha(hover * .24 + (tick === 0 ? .12 : .03));
      this.addToRoot(light);
    }
    const size = Math.round(Math.min(66, w * .115));
    const label = this.acquireText(this.width / 2, y + h / 2 - 4, 'Начать спуск', {
      fontFamily: '"Woundbound Title", Georgia, serif', fontStyle: 'bold', fontSize: `${size}px`,
      color: hot ? '#fff2d1' : '#F2E6D5', stroke: '#2b130f', strokeThickness: 3, resolution: 2,
      shadow: { offsetX: 0, offsetY: 2, color: 'rgba(26, 13, 8, 0.75)', blur: 3, fill: true },
    }).setOrigin(.5);
    label.setScale(Math.min(1, w * .78 / label.width) * (1 + hover * .025));
    this.addToRoot(label);
    this.zones.push({ x, y, width: w, height: h, action: 'begin-run', value: '' });
    if (this.battleLoadFailed || this.battleLoadProgress < 1) {
      const message = this.battleLoadFailed ? 'Ошибка загрузки · обновите страницу' : `Подготовка спуска · ${Math.round(this.battleLoadProgress * 100)}%`;
      this.text(message, this.width / 2, y + h - 22, Math.max(10, Math.min(14, h * .11)), '#ead1a9', w * .8, .5);
    }

    const selectorY = y + h + 12;
    const loadoutLabels = { full: 'Полный инвентарь', starter: 'Начальный комплект' };
    const selectorX = (this.width - selectorW) / 2;
    this.button(`${loadoutLabels[this.ui.startingLoadout]} ▾`, selectorX, selectorY, selectorW, selectorH, 'toggle-start-loadout');
    if (this.ui.startLoadoutMenuOpen) {
      (['full', 'starter'] as const).forEach((id, index) => {
        const selected = this.ui.startingLoadout === id;
        this.button(`${selected ? '✓ ' : ''}${loadoutLabels[id]}`, selectorX, selectorY + selectorH + 4 + index * optionH,
          selectorW, optionH, 'set-start-loadout', id, selected);
      });
    }
    const optionsY = selectorY + selectorH + menuExtra + 8;
    this.button('Опции', (this.width - selectorW) / 2, optionsY, selectorW, optionsH, 'options');
  }

  private roomBackdrop(dim: boolean): void {
    const g = this.acquireGraphics();
    g.fillStyle(0x211d27, 1).fillRoundedRect(this.field.x, this.field.y, this.field.width, this.field.height, 4);
    this.addToRoot(g);
    const label = this.ui.run.roomLabel.toLocaleLowerCase('ru');
    const location = label.includes('крыс') ? (this.ui.run.room === 1 ? 'location-rat-catacombs' : 'location-cave')
      : label.includes('культист') ? 'location-cult-base'
      : label.includes('автоматон') ? 'location-clockwork-foundry'
      : 'battlefield';
    const availableLocation = this.ensureImage(location, `/assets/${location}.png`, 'battlefield');
    const bg = this.acquireImage(this.field.x + this.field.width / 2, this.field.y + this.field.height / 2, availableLocation);
    const source = this.scene.textures.get(availableLocation).getSourceImage() as HTMLImageElement;
    const targetRatio = this.field.width / this.field.height, sourceRatio = source.width / source.height;
    if (sourceRatio > targetRatio) {
      const cropWidth = source.height * targetRatio;
      bg.setCrop((source.width - cropWidth) / 2, 0, cropWidth, source.height).setScale(this.field.height / source.height);
    } else {
      const cropHeight = source.width / targetRatio;
      bg.setCrop(0, (source.height - cropHeight) / 2, source.width, cropHeight).setScale(this.field.width / source.width);
    }
    this.addToRoot(bg);
    if (dim) {
      const shade = this.acquireGraphics();
      shade.fillStyle(0x17141b, .7).fillRect(this.field.x, this.field.y, this.field.width, this.field.height);
      this.addToRoot(shade);
    }
  }

  private ensureImage(key: string, path: string, fallback: string): string {
    if (this.scene.textures.exists(key)) return key;
    if (!this.requestedImages.has(key)) {
      this.requestedImages.add(key);
      this.scene.load.image(key, assetUrl(path));
      if (!this.scene.load.isLoading()) this.scene.load.start();
    }
    return fallback;
  }

  private battlefield(): void {
    this.roomBackdrop(false);
    const atCultistAltar = this.ui.run.roomLabel.toLocaleLowerCase('ru').includes('культист');
    const ground = {
      left: this.field.x + this.field.width * .06,
      right: this.field.x + this.field.width * .94,
      top: this.field.y + this.field.height * (atCultistAltar ? .44 : .27),
      bottom: this.field.y + this.field.height * .88,
    };
    const now = this.now;
    const action = this.ui.latestAction && now < this.ui.highlightUntil ? this.ui.latestAction : undefined;
    const enemyTarget = this.ui.state.enemies.find(enemy => enemy.status === 'enemy');
    const allActors = [...this.ui.state.heroes, ...this.ui.state.enemies];
    const actionTarget = action && allActors.find(candidate => candidate.id === action.targetId);
    const actionItem = action?.kind === 'item' ? this.ui.state.heroes.flatMap(hero => hero.items).find(item => item.id === action.sourceId) : undefined;
    const friendlyAction = actionItem?.effect === 'heal' || actionItem?.effect === 'wind';
    const enemyCount = this.ui.state.enemies.length;
    const heroFormation = new Map<string, { lane: 'front' | 'rear'; rank: number; count: number }>();
    const laneCounts = { front: 0, rear: 0 };
    for (const hero of [...this.ui.state.heroes].sort((a, b) => a.slot - b.slot)) {
      const lane = projectRoleIntent(hero, enemyTarget).lane;
      heroFormation.set(hero.id, { lane, rank: laneCounts[lane]++, count: 0 });
    }
    for (const slot of heroFormation.values()) slot.count = laneCounts[slot.lane];
    const positions = new Map<string, { x: number; y: number; scale: number; actor: Combatant; hero: boolean; index: number }>();
    const actorPosition = (actor: Combatant, hero: boolean, index: number): { x: number; y: number; scale: number } => {
      const intent = projectRoleIntent(actor, enemyTarget);
      const formation = hero ? heroFormation.get(actor.id) : undefined;
      let depth = .6;
      if (hero) depth = intent.lane === 'front' ? .74 : .49;
      else if (actor.isBoss) depth = .66;
      else if (enemyCount > 1) depth = .27 + index / (enemyCount - 1) * .55;
      const baseY = ground.top + (ground.bottom - ground.top) * Math.max(.08, Math.min(.95, depth));
      const rankOffset = (formation?.rank ?? 0) - ((formation?.count ?? 1) - 1) / 2;
      const horizontalProgress = intent.lane === 'front' ? .52 + rankOffset * .1 : .22 + rankOffset * .16;
      const enemyProgress = .73 + (index % 2) * .14 + Math.floor(index / 2) * .03;
      const x = hero
        ? ground.left + (ground.right - ground.left) * horizontalProgress
        : ground.left + (ground.right - ground.left) * enemyProgress;
      const y = baseY + (hero ? rankOffset * this.field.height * .1 : 0);
      const hostile = actionTarget && actionTarget.side !== actor.side;
      const nearFront = hero ? actor.role === 'guard' : (actor.reach ?? 'near') === 'near';
      const lunge = action?.actorId === actor.id && hostile && nearFront ? (hero ? 1 : -1) * this.field.width * .045 * Math.sin(Math.PI * (1 - (this.ui.highlightUntil - now) / 700)) : 0;
      return { x: Math.max(ground.left, Math.min(ground.right, x + lunge)), y: Math.max(ground.top, Math.min(ground.bottom, y)), scale: .76 + (baseY - ground.top) / Math.max(1, ground.bottom - ground.top) * .44 };
    };
    const units = [...this.ui.state.heroes.filter(actor => !this.priorRoomDead.has(actor.id)).map((actor, index) => ({ actor, hero: true, index })), ...this.ui.state.enemies.map((actor, index) => ({ actor, hero: false, index }))];
    for (const unit of units) {
      const position = actorPosition(unit.actor, unit.hero, unit.index);
      positions.set(unit.actor.id, { ...position, actor: unit.actor, hero: unit.hero, index: unit.index });
    }
    // Separate visible body footprints while preserving the front/rear depth rows.
    const standing = [...positions.values()].filter(position => position.actor.status !== 'dead' && position.actor.status !== 'rebirthing');
    const baseSize = Math.min(this.compactLayout ? 132 : 220, this.field.height * (this.compactLayout ? .35 : .39));
    const meterHeight = this.compactLayout ? 5 : 7;
    const frameInset = this.compactLayout ? 14 : 18;
    const fieldBottom = this.field.y + this.field.height;
    for (const position of positions.values()) {
      position.y = Math.min(position.y, fieldBottom - frameInset - meterHeight - baseSize * position.scale * .45);
    }
    for (const position of standing) {
      const margin = baseSize * position.scale * .32;
      position.x = Math.max(ground.left + margin, Math.min(ground.right - margin, position.x));
    }
    for (let pass = 0; pass < 8; pass++) {
      for (let i = 0; i < standing.length; i++) for (let j = i + 1; j < standing.length; j++) {
        const a = standing[i]!, b = standing[j]!;
        const sizeA = baseSize * a.scale, sizeB = baseSize * b.scale;
        const verticalOverlap = (sizeA + sizeB) * .40 - Math.abs(a.y - b.y);
        if (verticalOverlap <= 0) continue;
        const separation = (sizeA + sizeB) * (a.hero && b.hero ? .58 : .38) + (a.hero !== b.hero ? 14 : 6);
        const distanceX = Math.abs(a.x - b.x);
        if (distanceX >= separation) continue;

        const left = a.x <= b.x ? a : b, right = left === a ? b : a;
        const overlap = separation - distanceX;
        const leftRoom = Math.max(0, left.x - ground.left - baseSize * left.scale * .32);
        const rightRoom = Math.max(0, ground.right - right.x - baseSize * right.scale * .32);
        const shiftLeft = Math.min(Math.max(overlap / 2, overlap - rightRoom), leftRoom);
        const shiftRight = Math.min(overlap - shiftLeft, rightRoom);
        left.x -= shiftLeft;
        right.x += shiftRight;
        if (a.hero && b.hero && (this.compactLayout || overlap - shiftLeft - shiftRight > 6)) {
          const rear = a.y <= b.y ? a : b;
          const front = rear === a ? b : a;
          const frontLimit = fieldBottom - frameInset - meterHeight - baseSize * front.scale * .45;
          const forward = Math.min(verticalOverlap / 2, Math.max(0, frontLimit - front.y));
          front.y += forward;
          rear.y = Math.max(ground.top, rear.y - (verticalOverlap - forward));
        }
      }
    }
    this.root.bringToTop(this.actorLayer);
    this.actorLayer.setVisible(true);
    const visibleActors = new Set<string>();
    const ordered = [...positions.values()].sort((a, b) => a.y - b.y);
    for (const position of ordered) {
      const { actor, hero, x, y, scale } = position;
      const artSize = baseSize * scale;
      const sprite = actor.side === 'hero' ? actor.id : actor.isBoss ? 'boss' : actor.name.includes('крыса') ? 'rat' : actor.name.includes('Культист') ? 'cultist' : 'automaton';
      visibleActors.add(actor.id);
      const view = this.getActorView(actor, sprite);
      this.syncActorPose(actor, view, now);
      const actorSeed = [...actor.id].reduce((sum, character) => sum + character.charCodeAt(0), 0);
      const positionPhase = (x / Math.max(1, this.width)) * (y / Math.max(1, this.height)) * Math.PI * 5;
      view.motion.y = actor.status === 'dead' || actor.status === 'stopped' ? 0 : actor.status === 'rebirthing' ? -1.5 - 1.5 * Math.sin(now / 650 + positionPhase) : -0.8 - 0.8 * Math.sin(now / 360 + positionPhase + actorSeed * 0.17);
      view.container.setPosition(x, y).setDepth(y);
      this.sizeActorBody(view, artSize);
      // Hero sheets face right; enemy sheets are authored facing left toward the party.
      view.body.setFlipX(actor.side === 'enemy');
      view.shadow.clear()
        .fillStyle(0x12101c, .2).fillEllipse(0, artSize * .43, artSize * .76, artSize * .23)
        .fillStyle(0x09090c, .42).fillEllipse(0, artSize * .43, artSize * .48, artSize * .10);
      view.meter.clear().fillStyle(0x191719, .95).fillRoundedRect(-artSize * .24, artSize * .45, artSize * .48, meterHeight, 3);
      const current = actor.status === 'active' || actor.status === 'stopped' || actor.status === 'dead' ? actor.durability : actor.hp;
      const max = actor.status === 'active' || actor.status === 'stopped' || actor.status === 'dead' ? actor.maxDurability : actor.maxHp;
      const previous = this.displayedHealth.get(actor.id);
      const shown = previous ? previous.value + (current - previous.value) * (1 - Math.exp(-Math.max(0, now - previous.at) / 250)) : current;
      this.displayedHealth.set(actor.id, { value: shown, at: now });
      view.meter.setVisible(actor.status !== 'rebirthing' && actor.status !== 'dead');
      view.meter.fillStyle(hero ? 0x79c36b : 0xe05b59, 1).fillRoundedRect(-artSize * .24, artSize * .45, artSize * .48 * Math.max(0, Math.min(1, shown / Math.max(1, max))), meterHeight, 3);
      view.body.setAlpha(actor.status === 'dead' ? .56 : actor.status === 'rebirthing' ? .78 : 1);
      const actorClass = hero ? heroClassForActor(actor) : undefined;
      const dollTint = actorClass ? classCardThemes[actorClass].dollTint : 0xffffff;
      if (actor.status === 'stopped') {
        const chargeRatio = Math.max(0, Math.min(1, actor.windUpCharge / Math.max(1, actor.maxWindUp)));
        view.body.setTint(mixTint(0x85868d, 0xffe6a6, .2 + chargeRatio * .8));
      }
      else if (actor.status === 'active') view.body.setTint(mixTint(0xffffff, dollTint, .82));
      else if (action?.actorId === actor.id) view.body.setTint(0xffe0a0);
      else if (action?.targetId === actor.id) view.body.setTint(friendlyAction ? 0xa8e3aa : 0xff9a84);
      else view.body.setTint(0xeeeaf3);
      view.label.setText(actor.isBoss ? actor.name : '').setVisible(Boolean(actor.isBoss)).setPosition(0, -artSize * .78);
      view.key.clear();
      const doll = actor.status === 'active' || actor.status === 'stopped';
      view.key.setVisible(doll);
      if (doll) {
        const keyColor = actor.status === 'stopped' ? 0xb7b7bb : 0xf0bd64;
        const keySize = Math.max(5, artSize * .095);
        view.key.setPosition(0, -artSize * .4);
        view.key.lineStyle(2, 0x302329, 1).strokeCircle(0, 0, keySize * .4)
          .strokeEllipse(-keySize * .65, 0, keySize, keySize * 1.15)
          .strokeEllipse(keySize * .65, 0, keySize, keySize * 1.15);
        view.key.lineStyle(1.4, keyColor, 1).strokeCircle(0, 0, keySize * .36)
          .strokeEllipse(-keySize * .65, 0, keySize * .85, keySize)
          .strokeEllipse(keySize * .65, 0, keySize * .85, keySize)
          .lineBetween(-keySize * .3, 0, keySize * .3, 0);
        const winding = Math.max(0, Math.min(1, 1 - (view.windUntil - now) / 180));
        view.key.rotation = actor.status === 'stopped' ? -.45 + winding * Math.PI * 2 : Math.sin(now / 100) * .2;
      }
      const box = { x: x - artSize * .65, y: y - artSize * .75, width: artSize * 1.3, height: artSize * 1.55 };
      if (hero && actor.status === 'stopped' && this.ui.state.phase === 'combat') this.zones.push({ ...box, action: 'wind', value: actor.id, actorId: actor.id });
      else this.zones.push({ ...box, action: 'inspect', value: actor.id, actorId: actor.id });
    }
    for (const [id, view] of this.actorViews) if (!visibleActors.has(id)) {
      this.scene.tweens.killTweensOf(view.motion);
      this.scene.tweens.killTweensOf(view.action);
      view.container.destroy(); this.actorViews.delete(id);
    }
    this.actorLayer.sort('depth');
    for (const event of this.pendingActorEvents.splice(0)) this.animateActorEvent(event, positions);
    if (action) {
      const from = positions.get(action.actorId), to = positions.get(action.targetId);
      if (from && to) {
        const item = this.ui.state.heroes.find(hero => hero.id === action.actorId)?.items.find(candidate => candidate.id === action.sourceId);
        const healed = item?.effect === 'heal';
        const winding = item?.effect === 'wind';
        const impactColor = winding ? 0x70c6d6 : healed ? 0x9ee38d : item?.reach === 'far' ? 0xb58fff : 0xff8b69;
        const spark = this.acquireGraphics();
        const radius = 7 + Math.sin(now / 35) * 2;
        spark.lineStyle(2, impactColor, .94);
        for (let ray = 0; ray < 8; ray++) {
          const angle = Math.PI * ray / 4, inner = radius * .45, outer = radius * (1.2 + .25 * Math.sin(now / 45 + ray));
          spark.lineBetween(to.x + Math.cos(angle) * inner, to.y + Math.sin(angle) * inner,
            to.x + Math.cos(angle) * outer, to.y + Math.sin(angle) * outer);
        }
        spark.fillStyle(impactColor, .7).fillCircle(to.x, to.y, radius * .28); this.addToRoot(spark);
        this.text(`${healed || winding ? '+' : '−'}${Math.ceil(action.amount)}`, to.x, to.y - 40 * to.scale - Math.sin(now / 70) * 3, 17 * to.scale, winding ? '#a6e3e7' : healed ? '#b9e493' : '#ff897b', undefined, .5);
      }
    }
  }

  private getActorView(actor: Combatant, sprite: string): BattlefieldActorView {
    const archetype = (sprite in ACTOR_ROWS ? sprite : 'rat') as ActorSpriteId;
    const pose = this.defaultActorPose(actor);
    const frame = this.actorFrameFor(actor, archetype, pose);
    const existing = this.actorViews.get(actor.id);
    if (existing) {
      if (existing.archetype !== archetype) {
        existing.archetype = archetype;
        existing.frame = this.actorFrameFor(actor, archetype, existing.pose);
        existing.body.setTexture(this.actorTextureFor(actor, existing.pose), existing.frame);
      }
      return existing;
    }
    const container = this.scene.add.container(0, 0);
    const shadow = this.scene.add.graphics();
    const motion = this.scene.add.container(0, 0);
    const action = this.scene.add.container(0, 0);
    const body = this.scene.add.sprite(0, 0, this.actorTextureFor(actor, pose), frame);
    const meter = this.scene.add.graphics();
    const label = this.scene.add.text(0, 0, '', { fontFamily: 'Georgia, serif', fontSize: '11px', color: '#fff0d7', stroke: '#21171c', strokeThickness: 3, align: 'center' }).setOrigin(.5);
    const key = this.scene.add.graphics().setVisible(false);
    action.add(body); motion.add(action); container.add([shadow, motion, meter, label, key]);
    this.actorLayer.add(container);
    const view: BattlefieldActorView = { actorId: actor.id, container, motion, action, body, shadow, meter, label, key, size: -1, lastMotionSequence: 0, frame, archetype, pose, poseUntil: 0, windUntil: 0, motionUntil: 0 };
    this.actorViews.set(actor.id, view);
    return view;
  }

  private defaultActorPose(actor: Combatant): ActorSpriteState {
    if (actor.status === 'dead' || actor.status === 'rebirthing') return 'death';
    if (actor.side === 'hero' && actor.status === 'stopped') return 'dollStopped';
    return actor.side === 'hero' && actor.status === 'active' ? 'dollIdle' : 'idle';
  }

  private actorPoseTexture(pose: ActorSpriteState): string {
    return pose === 'dollStopped' ? 'doll-stopped' : 'actor-states';
  }

  private actorTextureFor(actor: Combatant, pose: ActorSpriteState): string {
    return actor.side === 'hero' && actor.status === 'dead' ? 'puppet-deaths' : this.actorPoseTexture(pose);
  }

  private actorFrameFor(actor: Combatant, archetype: ActorSpriteId, pose: ActorSpriteState): number {
    return actor.side === 'hero' && actor.status === 'dead'
      ? portraitFrames[actor.id] ?? 0
      : actorStateFrame(archetype, pose);
  }

  private sizeActorBody(view: BattlefieldActorView, size: number): void {
    const transform = view.pose === 'dollStopped' ? stoppedDollTransform(view.archetype) : { scale: 1, x: 0, y: 0 };
    const displaySize = size * transform.scale;
    view.body.setDisplaySize(displaySize, displaySize).setPosition(size * transform.x, size * transform.y);
    view.size = size;
  }

  private syncActorPose(actor: Combatant, view: BattlefieldActorView, now: number): void {
    if (actor.status === 'dead') {
      const frame = this.actorFrameFor(actor, view.archetype, 'death');
      const texture = this.actorTextureFor(actor, 'death');
      if (view.pose !== 'death' || view.frame !== frame || view.body.texture.key !== texture) {
        view.pose = 'death';
        view.frame = frame;
        view.body.setTexture(texture, frame);
      }
      return;
    }
    const temporary = view.pose === 'attack' || view.pose === 'hit' || view.pose === 'dollAttack';
    const pose = temporary && now < view.poseUntil ? view.pose : this.defaultActorPose(actor);
    const frame = this.actorFrameFor(actor, view.archetype, pose);
    if (pose === view.pose && view.frame === frame) return;
    view.pose = pose;
    view.frame = frame;
    view.body.setTexture(this.actorTextureFor(actor, pose), frame);
  }

  private setActorPose(view: BattlefieldActorView, pose: ActorSpriteState, durationMs: number): void {
    view.pose = pose;
    view.poseUntil = this.now + durationMs;
    view.frame = actorStateFrame(view.archetype, pose);
    view.body.setTexture(this.actorPoseTexture(pose), view.frame);
    if (view.size > 0) this.sizeActorBody(view, view.size);
  }

  private animateActorEvent(event: CombatEvent, positions: Map<string, { x: number; y: number; scale: number; actor: Combatant; hero: boolean; index: number }>): void {
    const target = this.actorViews.get(event.targetId);
    if (event.kind === 'wind') {
      if (target) target.windUntil = this.now + 180;
      if (target && this.now >= target.motionUntil) {
        target.motionUntil = this.now + 180;
        this.setActorPose(target, 'dollAttack', 180);
      }
      return;
    }
    if (event.kind !== 'item' && event.kind !== 'enemy') return;
    const source = this.actorViews.get(event.actorId);
    const sourcePos = positions.get(event.actorId), targetPos = positions.get(event.targetId);
    // Healing and winding are support actions, not strikes against an ally.
    const item = event.kind === 'item' ? this.ui.state.heroes.flatMap(hero => hero.items).find(candidate => candidate.id === event.sourceId) : undefined;
    if (item?.effect === 'heal' || item?.effect === 'wind') return;
    if (source && event.sequence && event.sequence > source.lastMotionSequence && targetPos && sourcePos) {
      source.lastMotionSequence = event.sequence;
      if (this.now >= source.motionUntil) {
        source.motionUntil = this.now + 180;
        const doll = sourcePos.actor.side === 'hero' && (sourcePos.actor.status === 'active' || sourcePos.actor.status === 'stopped');
        this.setActorPose(source, doll ? 'dollAttack' : 'attack', 190);
        this.scene.tweens.killTweensOf(source.action);
        source.action.setPosition(0, 0).setScale(1);
        const direction = Math.sign(targetPos.x - sourcePos.x) || 1;
        this.scene.tweens.add({ targets: source.action, x: direction * Math.max(5, source.size * .12), scaleX: 1.12, scaleY: .93, duration: 90, ease: 'Cubic.easeOut', yoyo: true });
      }
    }
    if (target && event.sequence && event.sequence > target.lastMotionSequence && sourcePos && targetPos) {
      target.lastMotionSequence = event.sequence;
      if (this.now >= target.motionUntil) {
        target.motionUntil = this.now + 160;
        const fallen = targetPos.actor.status === 'dead' || targetPos.actor.status === 'rebirthing';
        this.setActorPose(target, fallen ? 'death' : 'hit', fallen ? 1000 : 160);
        this.scene.tweens.killTweensOf(target.action);
        target.action.setPosition(0, 0).setScale(1);
        const direction = Math.sign(targetPos.x - sourcePos.x) || 1;
        this.scene.tweens.add({ targets: target.action, x: direction * Math.max(3, target.size * .07), scaleX: .94, scaleY: 1.04, duration: 55, ease: 'Sine.easeOut', yoyo: true, repeat: 1 });
      }
    }
  }

  private choices(): void {
    const choices = this.ui.roomChoices;
    const gap = 5, top = this.field.y + 12;
    const height = Math.min(this.compactLayout ? 91 : 110,
      (this.field.height - 24 - gap * Math.max(0, choices.length - 1)) / Math.max(1, choices.length));
    const width = this.right.width - 28;
    choices.forEach((choice, index) => {
      const x = this.right.x + 14, y = top + index * (height + gap);
      const style = ROUTE_CARD_STYLE[choice.kind];
      const hot = this.hover?.action === 'room' && this.hover.value === choice.id;
      const color = '#' + style.color.toString(16);
      this.panelTexture(x, y, width, height);
      const accent = this.acquireGraphics();
      const iconX = x + 39, iconY = y + height / 2;
      accent.fillStyle(style.color, hot ? .24 : .12).fillCircle(iconX, iconY, 18);
      accent.lineStyle(1, style.color, hot ? 1 : .6).strokeCircle(iconX, iconY, 18);
      if (hot) accent.strokeRoundedRect(x + 5, y + 5, width - 10, height - 10, 4);
      this.addToRoot(accent);
      if (choice.kind === 'cache') this.cardGlyph('key', iconX, iconY, style.color);
      else this.text(style.icon, iconX, iconY, 19, color, undefined, .5).setOrigin(.5);
      const textOffset = this.compactLayout ? 10 : 13;
      this.text(style.label, x + 68, iconY - textOffset, this.compactLayout ? 11 : 13, color).setOrigin(0, .5);
      this.titleText(choice.label, x + 68, iconY + textOffset, this.compactLayout ? 18 : 24, '#fff0d4', width - 112).setOrigin(0, .5);
      this.text('›', x + width - 27, iconY, 21, color, undefined, .5).setOrigin(.5);
      this.zones.push({ x, y, width, height, action: 'room', value: choice.id });
    });
  }

  private rewards(): void {
    const offers = this.ui.run.offers;
    if (!offers.length) return;
    const compact = this.compactLayout, narrow = this.narrowPortrait;
    const gap = narrow ? 5 : 8;
    const x = this.right.x + 10, y = this.field.y + (narrow ? 20 : 26), width = this.right.width - 20;
    this.text('Выберите один трофей', x + 5, this.field.y + 2, compact ? 12 : 15, '#e5d2b4', width - 10);
    const available = this.right.y + this.right.height - y - 12 - gap * (offers.length - 1);
    const height = Math.max(1, Math.min(compact ? 106 : 112, Math.floor(available / offers.length)));
    offers.forEach((item, index) => this.rewardCard(item, x, y + index * (height + gap), width, height));
  }

  private rewardCard(item: CombatItem, x: number, y: number, width: number, height: number): void {
    const narrow = this.narrowPortrait, compact = this.compactLayout;
    const color = itemRarityTint(item.rarity);
    const hot = this.hover?.value === item.id;
    const legendary = item.rarity === 'legendary';
    const back = this.acquireGraphics();
    back.fillStyle(hot ? 0x36232e : 0x261923, .98).fillRoundedRect(x, y, width, height, 5);
    back.lineStyle(1, 0x7e6361, .70).strokeRoundedRect(x + .5, y + .5, width - 1, height - 1, 5);
    back.fillStyle(color, legendary ? .92 : .66).fillRect(x + 3, y + 8, legendary ? 3 : 2, height - 16);
    this.addToRoot(back);

    const iconSize = Math.min(height - 25, narrow ? 41 : compact ? 58 : 86);
    const iconArea = Math.max(40, iconSize + (narrow ? 12 : 22));
    const iconX = x + 7 + iconArea / 2, iconY = y + height / 2 - 5;
    this.drawItemShape(item, iconX, iconY, iconSize, 'reward');
    this.text('Детали', iconX, y + height - 17, narrow ? 9 : 10, '#d5bdab', undefined, .5);

    const buttonWidth = narrow ? 79 : compact ? 94 : 136;
    const buttonHeight = Math.min(height - 8, narrow ? 46 : compact ? 48 : 50);
    const buttonX = x + width - buttonWidth - 7;
    const textX = x + 9 + iconArea;
    const textWidth = buttonX - textX - 8;
    let lineY = y + (narrow ? 4 : 11);
    const title = this.acquireText(textX, lineY, item.name, {
      fontFamily: '"Woundbound Title", Georgia, serif', fontStyle: 'bold', fontSize: narrow ? 13 : compact ? 16 : 22,
      color: '#fff0d8', wordWrap: { width: textWidth, useAdvancedWrap: true }, resolution: 2,
    });
    this.addToRoot(title);
    lineY += title.height + (narrow ? 0 : 2);
    const rarity = `#${mixTint(color, 0xffffff, .37).toString(16).padStart(6, '0')}`;
    const meta = this.simpleWrappedText(`${rarityLabels[item.rarity ?? 'common']} · ${categoryLabels[item.category ?? 'relic']}`,
      textX, lineY, narrow ? 9 : compact ? 10 : 12, rarity, textWidth);
    lineY += meta.height + 1;
    const stats = this.simpleWrappedText(this.rewardSummary(item), textX, lineY, narrow ? 11 : compact ? 12 : 14, '#efd194', textWidth);
    lineY += stats.height + (narrow ? 0 : 4);
    if (!narrow && item.description && lineY + 16 <= y + height - 6) {
      const description = this.simpleWrappedText(item.description, textX, lineY, compact ? 12 : 15, '#dfd3cc', textWidth);
      if (lineY + description.height > y + height - 5) {
        const lines = description.getWrappedText();
        const lineHeight = Math.ceil(description.height / Math.max(1, lines.length));
        const visibleLines = Math.floor((y + height - 5 - lineY) / lineHeight);
        if (visibleLines < 1) description.setVisible(false);
        else description.setText(`${lines.slice(0, visibleLines).join('\n').replace(/[^\S\n]+\S+$/u, '')}…`);
      }
    }

    this.zones.push({ x, y, width: buttonX - x, height, action: 'inspect-reward', value: item.id });
    this.zones.push({ x: x + 5, y, width: iconArea + 4, height, action: 'inspect-reward', value: item.id, itemId: item.id });
    this.button('Выбрать', buttonX, y + (height - buttonHeight) / 2, buttonWidth, buttonHeight, 'claim', item.id);
  }

  private rewardSummary(item: CombatItem): string {
    const number = formatItemNumber;
    if (item.trigger === 'passive' || item.effect === 'passive') {
      const bonus = item.passiveBonuses;
      if (bonus?.armor && item.classAffinity) {
        return `Броня +${number(bonus.armor)} · ${ITEM_CLASS_LABELS[item.classAffinity]}`;
      }
      return this.ui.itemDetails(item).stats[0] ?? 'Пассивное свойство';
    }
    const cooldown = number(Math.round(item.cooldownMs / 100) / 10);
    const label = item.effect === 'heal' ? 'Лечение' : item.effect === 'wind' ? 'Завод' : 'Урон';
    const amount = item.effect === 'wind' ? item.windAmount ?? item.damage : item.damage;
    return `${label} ${number(Math.round(amount))} · ${cooldown} с`;
  }

  private workshop(): void {
    const x = this.right.x + 12, w = this.right.width - 24; let y = this.right.y + 52;
    const hasPuppets = this.ui.state.heroes.some(hero => hero.status === 'active' || hero.status === 'stopped');
    const description = hasPuppets ? 'Ключ восстанавливает завод. Прочность корпуса не меняется.' : 'В отряде нет кукол для подзавода.';
    this.panelTexture(x, y, w, 42);
    this.text(description, x + 14, y + 12, this.compactLayout ? 13 : 15, '#f3e5cc', w - 28);
    y += 50;
    if (hasPuppets) {
      this.button('Полностью завести кукол', x, y, w, 38, 'workshop-wind', '', true);
      y += 46;
    }
    const cursed = this.ui.allItems.filter(item => item.definitionId === 'lantern' && !item.calmed);
    const calmed = this.ui.run.workshopCalmed;
    if (cursed.length && !calmed) { this.button(`Успокоить фонарь · ${cursed[0]!.name}`, x, y, w, 36, 'calm', cursed[0]!.id); y += 44; }
    else {
      this.panelTexture(x, y, w, 38);
      this.text(calmed ? 'Проклятие фонаря снято.' : 'Нет проклятых предметов.', x + 14, y + 11, this.compactLayout ? 13 : 15, '#f3e5cc', w - 28);
    }
    this.button('Закончить работу', x, this.right.y + this.right.height - 44, w, 34, 'leave-workshop');
  }

  private event(): void {
    const x = this.right.x + 12, w = this.right.width - 24, y = this.right.y + 54;
    const heal = canUseInfirmary(this.ui.run, 'heal');
    const repair = canUseInfirmary(this.ui.run, 'repair');
    if (!heal && !repair) {
      this.text('В отряде никто не нуждается в помощи.', x, y, 13, '#e1cfaf', w);
      this.button('Продолжить путь', x, y + 46, w, 40, 'event-choice', 'leave');
      return;
    }
    this.text('Припасов хватит на одно действие.', x, y, 13, '#e1cfaf', w);
    if (heal) this.button('Лечить людей · +15 здоровья', x, y + 46, w, 40, 'event-choice', 'heal');
    if (repair) this.button('Починить кукол · +15 прочности', x, y + (heal ? 96 : 46), w, 40, 'event-choice', 'repair');
  }

  private poolContentBounds() {
    const bottomInset = this.narrowPortrait ? 20 : this.wideLootLayout ? 40 : POOL_BOTTOM_INSET;
    return {
      panelTop: this.right.y + POOL_TOP_INSET,
      top: this.right.y + (this.narrowPortrait ? 52 : POOL_GRID_OFFSET),
      bottom: this.right.y + this.right.height - POOL_ROUTE_HEIGHT - bottomInset,
    };
  }

  private cleared(draggedItemId?: string): void {
    const x = this.right.x + 12, w = this.right.width - 24;
    const floorBottom = this.right.y + this.right.height - POOL_ROUTE_HEIGHT;
    const bounds = this.poolContentBounds();
    const pool = { x: x - 6, y: bounds.panelTop, width: w + 12, height: Math.max(1, floorBottom - bounds.panelTop - 6) };
    this.zones.push({ ...pool, action: 'floor-drop', floorDrop: true });
    const inset = this.narrowPortrait ? 10 : 22;
    const contentX = x + inset;
    const contentWidth = w - inset * 2;
    this.panelTexture(pool.x, pool.y, pool.width, pool.height);
    this.drawLooseItems(this.ui.state.floor, contentX, contentWidth, bounds, draggedItemId);
    if (!this.ui.state.floor.length) {
      const message = clearedCopy[this.ui.run.current].message;
      if (message) this.text(message, contentX, bounds.top, this.compactLayout ? 11 : 13, '#e1cfaf', contentWidth);
    }
    this.button('Выбрать следующую комнату', x, floorBottom, w, 50, 'route', '', true);
  }

  private drawLooseItems(items: CombatItem[], x: number, width: number, bounds: { top: number; bottom: number }, draggedItemId?: string): void {
    const narrow = this.narrowPortrait;
    const wide = this.wideLootLayout;
    const gap = narrow ? 6 : POOL_TILE_GAP;
    const gridY = bounds.top;
    const y = gridY - (narrow ? 24 : 32);
    const maxTile = narrow ? 54 : this.compactLayout ? 62 : wide ? 112 : 76;
    const { size, columns, rows } = lootGrid(width, bounds.bottom - gridY, gap, maxTile, wide ? 40 : 0);
    const pageSize = columns * rows;
    const pages = Math.max(1, Math.ceil(items.length / pageSize));
    this.lootPage = Math.min(this.lootPage, pages - 1);
    const navigationX = x + width - 132;
    this.titleText(`${this.roomTitle(this.ui.run)} · ${items.length}`, x, y + 3, wide ? 21 : 16, '#f0d39e', width - (pages > 1 ? 140 : 0));
    if (pages > 1) {
      this.text(`${this.lootPage + 1} / ${pages}`, navigationX + 66, y + 4, 14, '#f3e5cc', undefined, .5);
      this.button('‹', navigationX, y - 6, 38, 30, 'loot-page', '-1', false, this.lootPage > 0);
      this.button('›', navigationX + 94, y - 6, 38, 30, 'loot-page', '1', false, this.lootPage + 1 < pages);
    }
    const first = this.lootPage * pageSize;
    items.slice(first, first + pageSize).forEach((item, index) => {
      const bx = Math.round(x + index % columns * (size + gap));
      const by = Math.round(gridY + Math.floor(index / columns) * (size + gap));
      const tile = this.acquireGraphics();
      const held = item.id === draggedItemId;
      const hovered = !held && this.hover?.itemId === item.id;
      const rarity = itemRarityTint(item.rarity);
      tile.fillStyle(rarity, hovered ? .19 : .07).fillRoundedRect(bx, by, size, size, 3);
      if (hovered) tile.lineStyle(1, rarity, .8).strokeRoundedRect(bx, by, size, size, 3);
      this.addToRoot(tile);
      this.drawItemShape(item, bx + size / 2, by + size / 2, size - 4, held ? 'held' : 'loot');
      this.zones.push({ x: bx, y: by, width: size, height: size, action: 'item', value: item.id, itemId: item.id, floorDrop: true });
    });
  }

  private drawItemShape(item: CombatItem, centerX: number, centerY: number, size: number, mode: 'reward' | 'loot' | 'held' = 'reward'): void {
    const shape = rotatedShape(item);
    const columns = Math.max(1, ...shape.map(([x]) => x + 1));
    const rows = Math.max(1, ...shape.map(([, y]) => y + 1));
    const cell = Math.max(1, Math.floor(size / Math.max(columns, rows)));
    const x = Math.round(centerX - columns * cell / 2);
    const y = Math.round(centerY - rows * cell / 2);
    const footprint = this.drawItemFootprint(item, shape, x, y, cell, false, true);
    if (mode === 'held') footprint.setAlpha(.35);
    else if (mode === 'reward') this.itemImage(item, centerX, centerY, size * .94);
    else if (mode === 'loot' && shape.length < columns * rows) this.itemImage(item, centerX, centerY, size * .86);
    else this.drawFootprintArt(item, shape, x, y, cell);
  }

  private drawFootprintArt(item: CombatItem, shape: readonly ItemCell[], x: number, y: number, cell: number): Phaser.GameObjects.Image {
    const art = itemCatalog[item.definitionId as keyof typeof itemCatalog] ?? CLASS_ITEM_ART.blade;
    const oddTurn = (item.rotation ?? 0) % 2 !== 0;
    const bounds = itemArtBounds(shape, x, y, cell,
      oddTurn ? art.content.height : art.content.width, oddTurn ? art.content.width : art.content.height);
    const trim = Math.max(1, cell * .04) * 2;
    return this.itemImage(item, bounds.centerX, bounds.centerY,
      Math.max(1, bounds.right - bounds.left - trim), Math.max(1, bounds.bottom - bounds.top - trim));
  }

  private drawItemFootprint(item: CombatItem, shape: readonly ItemCell[], x: number, y: number, cell: number, muted: boolean, showCells = false): Phaser.GameObjects.Graphics {
    const outline = this.acquireGraphics();
    const rarity = muted ? 0x77777b : itemRarityTint(item.rarity);
    const fill = mixTint(0x17141c, rarity, item.rarity === 'common' ? .16 : .31);
    const selected = this.ui.selectedItem === item.id;
    const hovered = this.hover?.itemId === item.id;
    const common = !item.rarity || item.rarity === 'common';
    const occupied = new Set(shape.map(([dx, dy]) => `${dx},${dy}`));
    outline.fillStyle(fill, 1);
    for (const [dx, dy] of shape) outline.fillRect(x + dx * cell, y + dy * cell, cell, cell);
    if (showCells) {
      outline.lineStyle(1, rarity, .24);
      for (const [dx, dy] of shape) outline.strokeRect(x + dx * cell, y + dy * cell, cell, cell);
    }
    outline.lineStyle(selected || hovered ? 2 : 1, selected ? 0x79d9dd : rarity, selected || hovered ? 1 : common ? .45 : .82);
    for (const [dx, dy] of shape) {
      const left = x + dx * cell, top = y + dy * cell;
      if (!occupied.has(`${dx},${dy - 1}`)) outline.lineBetween(left, top, left + cell, top);
      if (!occupied.has(`${dx + 1},${dy}`)) outline.lineBetween(left + cell, top, left + cell, top + cell);
      if (!occupied.has(`${dx},${dy + 1}`)) outline.lineBetween(left, top + cell, left + cell, top + cell);
      if (!occupied.has(`${dx - 1},${dy}`)) outline.lineBetween(left, top, left, top + cell);
    }
    this.addToRoot(outline);
    return outline;
  }

  private ending(): void {
    const win = this.ui.run.stage === 'victory';
    const x = this.right.x + 12, y = this.field.y + 18, w = this.right.width - 24;
    if (!win) {
      this.panelTexture(x, y, w, 96);
      this.titleText('Завод остановлен', x + w / 2, y + 28, this.compactLayout ? 20 : 32, '#d3847a', w - 28, .5).setOrigin(.5, .5);
      this.text('Все куклы разрушены.', x + 14, y + 61, this.compactLayout ? 9 : 13, '#e9d5b5', w - 28);
    }
    this.button('Начать новый забег', x, this.right.y + this.right.height - 76, w, 64, 'restart', '', true);
  }

  private drawDropFootprint(drag: DragPreview): boolean {
    if (drag.heroId === undefined || drag.targetCell === undefined) return false;
    const grabbed = this.cells.get(`${drag.heroId}:${drag.targetCell}`);
    if (!grabbed) return false;
    const size = grabbed.size, x = grabbed.x - drag.grabX * size, y = grabbed.y - drag.grabY * size;
    const column = inventoryColumn(drag.targetCell) - drag.grabX;
    const row = inventoryRow(drag.targetCell) - drag.grabY;
    const shape = rotatedShape(drag.item);
    const target = this.ui.state.heroes.find(hero => hero.id === drag.heroId);
    const occupied = new Set(target?.items.filter(item => item.id !== drag.item.id).flatMap(item => occupiedCells(item, item.cell) ?? []));
    const tone = drag.valid ? 0x91e4d4 : 0xef8c83;
    const outline = this.acquireGraphics();
    const conflicts = this.acquireGraphics();
    outline.lineStyle(2, tone, 1);
    for (const [dx, dy] of shape) {
      if (column + dx < 0 || row + dy < 0 || column + dx >= INVENTORY_GRID_SIZE || row + dy >= INVENTORY_GRID_SIZE) continue;
      const left = x + dx * size, top = y + dy * size;
      const index = (row + dy) * INVENTORY_GRID_SIZE + column + dx;
      const blocked = occupied.has(index);
      outline.fillStyle(blocked ? 0xc54244 : tone, blocked ? .55 : .25).fillRect(left, top, size, size);
      outline.strokeRect(left + 1, top + 1, size - 2, size - 2);
      if (blocked) {
        const inset = size * .25;
        conflicts.lineStyle(2, 0xffd4ca, 1);
        conflicts.lineBetween(left + inset, top + inset, left + size - inset, top + size - inset);
        conflicts.lineBetween(left + size - inset, top + inset, left + inset, top + size - inset);
      }
    }
    this.addToRoot(outline);
    if (drag.anchor !== undefined && occupiedCells(drag.item, drag.anchor)) {
      this.drawFootprintArt(drag.item, shape, x, y, size).setAlpha(drag.valid ? .92 : .48);
    }
    this.addToRoot(conflicts);
    return true;
  }

  private drawDrag(drag: DragPreview): void {
    const shape = rotatedShape(drag.item);
    const targetCell = drag.heroId !== undefined && drag.anchor !== undefined
      ? this.cells.get(`${drag.heroId}:${drag.anchor}`) : undefined;
    const size = targetCell?.size ?? (this.narrowPortrait ? 16 : this.compactLayout ? 24 : 34);
    const x = drag.x - (drag.grabX + .5) * size, y = drag.y - (drag.grabY + .5) * size;
    const g = this.acquireGraphics(); g.fillStyle(drag.valid === false ? 0xae4f4e : 0xb98954, .82);
    for (const [dx, dy] of shape) g.fillRoundedRect(x + dx * size, y + dy * size, size - 2, size - 2, 3);
    this.addToRoot(g);
    this.drawFootprintArt(drag.item, shape, x, y, size).setAlpha(.92);
  }

  private itemSpeech(): void {
    if (this.ui.run.stage === 'route') return;
    const speech = this.ui.dialogue.active;
    if (!speech || speech.expiresAt <= this.now) return;
    if (this.ui.run.stage !== 'battle' && (speech.trigger === 'kill' || speech.trigger === 'ownerDeath')) return;
    const hero = this.ui.state.heroes.find(candidate => candidate.id === speech.heroId);
    const item = hero?.items.find(candidate => candidate.id === speech.itemId) ?? this.ui.state.floor.find(candidate => candidate.id === speech.itemId);
    if (!hero || !item) return;
    const cells = occupiedCells(item, speech.formerCell ?? item.cell ?? 0);
    const anchor = cells?.map(index => this.cells.get(`${hero!.id}:${index}`)).find(Boolean);
    if (!anchor) return;
    const width = Math.min(this.compactLayout ? 225 : 300, this.field.width - 24);
    const x = this.field.x + 12;
    const y = this.field.y + 12;
    const inset = 20;
    const style = {
      fontFamily: 'Georgia, serif', fontStyle: 'bold',
      fontSize: this.compactLayout ? '11px' : '14px', color: '#fff0cc',
      wordWrap: { width: width - inset * 2 }, resolution: 2,
    };
    const name = this.acquireText(x + inset, y + 16, item.name, { ...style, color: '#deb77b' });
    const line = this.acquireText(x + inset, y + 22 + name.height, speech.text, style);
    this.panelTexture(x, y, width, 38 + name.height + line.height);
    this.addToRoot([name, line]);
  }

  private actorTooltip(actor: Combatant, pointerX: number, pointerY: number): void {
    if (!actor) return;
    if (actor.side === 'hero') {
      this.tooltips.showText(`actor:${actor.id}:${actor.status}`, `${actor.name}\n${actorStatus[actor.status]}`, pointerX, pointerY, this.width, this.height);
      return;
    }
    const target = actor.side === 'enemy' && actor.status === 'enemy'
      ? chooseHeroTarget(this.ui.state.heroes, actor.targetPolicy, actor.slot, actor.reach)?.name
      : undefined;
    const form = actor.isPuppet ? getPuppetForm(actor.puppetFormId) : undefined;
    const pending = actor.status === 'rebirthing' ? getPuppetForm(actor.pendingPuppetFormId) : undefined;
    const details = actor.side === 'enemy'
      ? `Страж в строю прикрывает союзников. Остановленные куклы не удерживают переднюю линию; дальние атаки выбирают цель по своему правилу.${target ? ` Сейчас атакует: ${target}.` : ''}${actor.isBoss ? ' В затянувшемся бою ярость усиливает атаки.' : ''}`
      : form
        ? `${actorStatus[actor.status]}. ${form.name} · ${puppetBranchLabels[form.branch]}\nПрочность ${form.maxDurability} · броня ${form.armor} · заряд ${form.maxWindUp} · расход ${form.windDrainPerSecond}/с · входящий урон ×${form.damageTakenMultiplier.toFixed(2)}.\n${form.passiveName}: ${form.passiveDescription}\n${form.cellModifiers.map(modifier => `${modifier.label} Цвет ячеек: ${modifier.tag === 'threaded' ? 'бирюзовый' : modifier.tag === 'mechanical' ? 'латунный' : modifier.tag === 'cursed' ? 'фиолетовый' : 'зелёный'}.`).join('\n')}${actor.status === 'stopped' ? '\nНажимайте, чтобы завести.' : ''}`
        : `${actorStatus[actor.status]}${pending ? `. Предстоит перерождение: ${pending.name}.` : ''}${actor.status === 'stopped' ? '. Нажимайте, чтобы завести.' : '.'}`;
    this.tooltips.showText(`actor:${actor.id}:${details}`, `${actor.name}\n${details}`, pointerX, pointerY, this.width, this.height);
  }

  private resetDialog(): void {
    const w = Math.min(440, this.width - 24);
    const h = 220;
    const x = (this.width - w) / 2, y = (this.height - h) / 2;
    this.modalBackdrop(); this.panelTexture(x, y, w, h);
    this.titleText('Начать заново?', x + w / 2, y + 44, this.compactLayout ? 22 : 26, '#f0d18f', w - 64, .5);
    this.text('Текущий забег будет сброшен.', x + w / 2, y + 83, 14, '#e0ceb1', w - 64, .5);
    const buttonY = y + 138;
    const buttonWidth = (w - 80) / 2;
    this.button('Сбросить', x + 32, buttonY, buttonWidth, 44, 'confirm-reset', '', true);
    this.button('Вернуться', x + w / 2 + 8, buttonY, buttonWidth, 44, 'cancel-reset');
  }

  private helpDialog(): void {
    const w = Math.min(this.width - 24, 570), h = Math.min(this.height - 24, 418);
    const x = (this.width - w) / 2, y = (this.height - h) / 2;
    this.modalBackdrop(); this.panelTexture(x, y, w, h);
    this.zones.push({ x: 0, y: 0, width: this.width, height: this.height, action: 'help' });
    this.titleText('Как играть', x + w / 2, y + h * .20, 24, '#f1d49f', w * .8, .5);
    const text = this.text('Вещи сражаются сами. Между боями перетаскивайте добычу из общего пула в рюкзаки. Правая кнопка поворачивает предмет. При уходе из комнаты нераспределённая добыча пропадает.\n\nПавший человек перерождается в куклу. Чтобы её завести, нажмите на карточку или спрайт. Для завода нужен действующий союзник.\n\nУдары разрушают кукол. Забег заканчивается, когда весь отряд погибает.', x + w * .08, y + h * .27, 15, '#eadcc4', w * .84).setFontStyle('normal');
    const closeHeight = 44;
    const closeY = y + h - closeHeight - 38;
    const textHeight = Math.max(1, closeY - text.y - 16);
    for (let fontSize = 14; text.height > textHeight && fontSize >= 10; fontSize--) text.setFontSize(fontSize);
    const closeWidth = Math.min(260, w * .66);
    this.button('Понятно', x + (w - closeWidth) / 2, closeY, closeWidth, closeHeight, 'help');
  }

  private optionsDialog(): void {
    const w = Math.min(this.width - 24, 570), h = Math.min(this.height - 24, 360);
    const x = (this.width - w) / 2, y = (this.height - h) / 2;
    this.modalBackdrop(); this.panelTexture(x, y, w, h);
    // Consume clicks outside controls while the dialog is open.
    this.zones.push({ x: 0, y: 0, width: this.width, height: this.height, action: 'options-backdrop' });
    this.titleText('Опции', x + w / 2, y + h * .24, Math.min(28, h * .085), '#f1d49f', w * .75, .5).setOrigin(.5);
    const compact = w < 420;
    const inset = Math.max(30, w * .09), buttonW = compact ? 88 : 116;
    const trackX = x + inset, trackW = Math.max(36, w - inset * 2 - buttonW - 18);
    const rows = [
      { channel: 'music', label: 'Музыка', value: this.ui.audioSettings.music, muted: this.ui.audioSettings.musicMuted },
      { channel: 'effects', label: 'Звуки', value: this.ui.audioSettings.effects, muted: this.ui.audioSettings.effectsMuted },
    ] as const;
    rows.forEach((row, index) => {
      const rowY = y + h * (.35 + index * .18);
      const font = compact ? 14 : 16;
      this.text(row.label, trackX, rowY, font, '#f4e2c4');
      const percent = Math.round(row.value * 100);
      this.text(row.muted ? `${percent}% при включении` : `${percent}%`, trackX + trackW, rowY, row.muted ? 11 : font, row.muted ? '#b9aab3' : '#f4e2c4', undefined, 1);
      const trackY = rowY + 29, trackH = 12;
      const bar = this.acquireGraphics();
      bar.fillStyle(0x160e17, 1).fillRoundedRect(trackX, trackY, trackW, trackH, 5);
      bar.lineStyle(1, 0xa98660, .9).strokeRoundedRect(trackX, trackY, trackW, trackH, 5);
      bar.fillStyle(row.muted ? 0x756c72 : 0xd3a15c, 1).fillRoundedRect(trackX + 2, trackY + 2, Math.max(0, (trackW - 4) * row.value), trackH - 4, 4);
      const knobX = trackX + 2 + (trackW - 4) * row.value;
      bar.fillStyle(row.muted ? 0x91848e : 0xf1d4a0, 1).fillCircle(knobX, trackY + trackH / 2, 7);
      bar.lineStyle(2, 0x694a39, 1).strokeCircle(knobX, trackY + trackH / 2, 7);
      this.addToRoot(bar);
      this.zones.push({ x: trackX, y: trackY - 14, width: trackW, height: 40, action: 'audio-volume', value: row.channel });
      this.button(row.muted ? 'Вкл.' : 'Выкл.', trackX + trackW + 18, rowY + 8, buttonW, 40, 'audio-mute', row.channel);
    });
    this.button('Готово', x + w * .20, y + h * .69, w * .60, Math.min(46, h * .13), 'options');
    this.text(`Версия ${GAME_VERSION}`, x + w / 2, y + h * .85, 11, '#c1b1b9', w * .6, .5);
  }

  private modalBackdrop(): void {
    this.addToRoot(this.acquireGraphics().fillStyle(0x08070b, .84).fillRect(0, 0, this.width, this.height));
  }

  private panelTexture(x: number, y: number, w: number, h: number): void {
    if (w <= 420 && h <= 240) {
      const capX = Math.min(76, Math.max(18, Math.floor(w * .24)));
      const capY = Math.min(40, Math.max(4, Math.floor(h * .23)));
      this.addToRoot(this.acquireNineSlice(x, y, w, h, capX, capX, capY, capY));
      return;
    }
    // Keep the frame's upper and lower rails clear of text on short panels.
    const scale = Math.min(.18, w / 480, h / 700);
    const panel = this.acquireNineSlice(x, y, w / scale, h / scale, 240, 240, 220, 220, 'ui-panel-nine-slice');
    panel.setScale(scale);
    this.addToRoot(panel);
  }

  private heroInfoDialog(): void {
    const hero = this.ui.state.heroes.find(candidate => candidate.id === this.ui.heroInfoId);
    if (!hero) return;
    const narrow = this.width < 450;
    const width = Math.min(this.width - 16, 560);
    const inset = narrow ? 26 : 34;
    const contentWidth = width - inset * 2;
    const form = hero.isPuppet ? getPuppetForm(hero.puppetFormId) : undefined;
    const pending = hero.status === 'rebirthing' ? getPuppetForm(hero.pendingPuppetFormId) : undefined;
    const formContent = form ? [
      `${puppetBranchLabels[form.branch]} · расход ${formatItemNumber(form.windDrainPerSecond)}/с`,
      `Входящий урон ×${formatItemNumber(form.damageTakenMultiplier)}`,
      `${form.passiveName}: ${form.passiveDescription}`,
      ...form.cellModifiers.map(cell => cell.label),
    ].join('\n') : pending ? `Новая форма: ${pending.name}` : '';
    const formText = formContent ? this.acquireText(0, 0, formContent, {
      fontFamily: 'Georgia, serif', fontSize: narrow ? 12 : 14, color: '#e8dbc9', lineSpacing: 2,
      wordWrap: { width: contentWidth, useAdvancedWrap: true }, resolution: 2,
    }) : undefined;
    const formHeight = formText ? 24 + formText.height : 0;
    const height = 470 + formHeight;
    const x = (this.width - width) / 2, y = (this.height - height) / 2;
    const left = x + inset, top = y + 28;
    const theme = classCardThemes[heroClassForActor(hero) ?? 'guard'];
    this.modalBackdrop();
    this.panelTexture(x, y, width, height);
    this.zones.push({ x: 0, y: 0, width: this.width, height: this.height, action: 'close-hero-info' });
    this.addToRoot(this.acquireGraphics().fillStyle(theme.header, .72).fillRoundedRect(left, top, contentWidth, 64, 5));
    this.actorImage(hero.id, left + 37, top + 32, 58, hero.status, theme.dollTint);
    const accent = `#${theme.engraving.toString(16)}`;
    const labelX = left + 76;
    this.titleText(hero.name, labelX, top + 7, narrow ? 21 : 24, '#fff0d8', contentWidth - 82);
    this.text(actorCardStatus[hero.status], labelX, top + 32, 12, accent);
    const resource = hero.status === 'human' ? `Здоровье ${Math.ceil(hero.hp)} / ${hero.maxHp}`
      : hero.isPuppet ? `Прочность ${hero.durability} / ${hero.maxDurability} · завод ${Math.ceil(hero.windUpCharge)} / ${hero.maxWindUp}` : '';
    if (resource) this.simpleWrappedText(resource, labelX, top + 47, narrow ? 10 : 12, '#f2dfc9', contentWidth - 78);

    const rows = heroAttributeRows(hero.attributes);
    const gap = 8, columnWidth = (contentWidth - gap) / 2;
    this.titleText('Характеристики', left, top + 77, 16, '#f6d599', contentWidth);
    rows.forEach((row, index) => {
      const tileX = left + index % 2 * (columnWidth + gap), tileY = top + 99 + Math.floor(index / 2) * 36;
      this.addToRoot(this.acquireGraphics().fillStyle(theme.fill, .93).fillRoundedRect(tileX, tileY, columnWidth, 32, 3));
      this.text(row.name, tileX + 7, tileY + 9, 12, '#e8dacc');
      this.text(row.modifier, tileX + columnWidth - 6, tileY + 10, 11, accent, undefined, 1);
      this.text(String(row.score), tileX + columnWidth - 29, tileY + 4, 20, '#fff1d8', undefined, 1);
    });
    this.simpleWrappedText('Малое число — модификатор: (значение − 10) / 2 с округлением вниз.', left, top + 209, 11, '#d8c9bc', contentWidth);
    this.titleText('Что дают характеристики', left, top + 240, 15, '#f6d599', contentWidth);
    rows.forEach((row, index) => {
      const effectX = left + index % 2 * (columnWidth + gap), effectY = top + 262 + Math.floor(index / 2) * 17;
      this.text(row.effect, effectX, effectY, 11, '#ebdfd1');
      this.text(row.bonus, effectX + columnWidth - 3, effectY, 11, accent, undefined, 1);
    });

    const armor = heroArmorBreakdown(hero);
    this.titleText(`Броня ${armor.total} / ${MAX_ARMOR}`, left, top + 316, 15, '#f6d599', contentWidth);
    const origin = armor.form ? ` · форма ${signedNumber(armor.form)}` : '';
    this.simpleWrappedText(`Снаряжение ${signedNumber(armor.equipment)} · стойкость ${signedNumber(armor.constitution)}${origin}. Максимум ${MAX_ARMOR}.`,
      left, top + 336, 11, '#e8dbc9', contentWidth);
    if (formText) {
      const formY = top + 361;
      if (form) this.titleText(form.name, left, formY, 16, '#f6d599', contentWidth);
      this.addToRoot(formText.setPosition(left, formY + (form ? 22 : 4)));
    }
    this.button('Закрыть', x + inset, y + height - 70, contentWidth, 44, 'close-hero-info');
  }

  private simpleWrappedText(value: string, x: number, y: number, size: number, color: string, width: number): Phaser.GameObjects.Text {
    const text = this.acquireText(x, y, value, {
      fontFamily: 'Georgia, serif', fontSize: size, color, lineSpacing: 2, resolution: 2,
      wordWrap: { width, useAdvancedWrap: true },
    });
    this.addToRoot(text);
    return text;
  }

  private card(x: number, y: number, width: number, height: number, label: string): void {
    this.panelTexture(x, y, width, height);
    if (width > 70 && height > 55) this.frameCorners(x, y, width, height, Math.min(24, width * .15, height * .24), .78);
    if (width > 70 && height > 55) this.text(label, x + 7, y + 4, 11, '#f1d396', width - 14);
  }

  private frameCorners(x: number, y: number, width: number, height: number, size: number, alpha = 1): void {
    const edge = Math.max(8, Math.round(size));
    for (const corner of [
      { x, y, flipX: false, flipY: false },
      { x: x + width - edge, y, flipX: true, flipY: false },
      { x, y: y + height - edge, flipX: false, flipY: true },
      { x: x + width - edge, y: y + height - edge, flipX: true, flipY: true },
    ]) {
      const image = this.acquireImage(corner.x, corner.y, 'ui-frame-corner').setOrigin(0, 0)
        .setDisplaySize(edge, edge).setFlipX(corner.flipX).setFlipY(corner.flipY).setAlpha(alpha);
      this.addToRoot(image);
    }
  }

  private itemImage(item: CombatItem, x: number, y: number, width: number, height = width): Phaser.GameObjects.Image {
    const id = item.definitionId ?? 'blade';
    const art = itemCatalog[id as keyof typeof itemCatalog] ?? CLASS_ITEM_ART.blade;
    const turns = ((item.rotation ?? 0) % 4 + 4) % 4;
    const frameWidth = turns % 2 ? art.content.height : art.content.width;
    const frameHeight = turns % 2 ? art.content.width : art.content.height;
    const scale = Math.min(width / frameWidth, height / frameHeight);
    const angle = turns * Math.PI / 2;
    const image = this.acquireImage(x, y, itemAtlases[id] ?? 'items-guard', itemFrames[id] ?? 0).setScale(scale).setRotation(angle);
    const offsetX = (art.content.x + art.content.width / 2 - image.width / 2) * scale;
    const offsetY = (art.content.y + art.content.height / 2 - image.height / 2) * scale;
    image.setPosition(x - (offsetX * Math.cos(angle) - offsetY * Math.sin(angle)), y - (offsetX * Math.sin(angle) + offsetY * Math.cos(angle)));
    this.addToRoot(image); return image;
  }

  private puppetStateBadge(x: number, y: number, size: number, color: number): void {
    const g = this.acquireGraphics();
    const left = x - size / 2, top = y - size / 2, corner = Math.max(2, size * .16);
    g.fillStyle(0x1d171b, .98).fillRoundedRect(left, top, size, size, corner);
    g.lineStyle(1, 0x544333, 1).strokeRoundedRect(left, top, size, size, corner);
    g.lineStyle(1, color, .95).strokeRoundedRect(left + 1, top + 1, size - 2, size - 2, Math.max(1, corner - 1));
    const inner = size * .25, outer = size * .37;
    g.lineStyle(Math.max(1, size * .07), color, 1).strokeCircle(x, y, inner);
    for (let tooth = 0; tooth < 8; tooth++) {
      const angle = tooth * Math.PI / 4;
      g.lineBetween(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner,
        x + Math.cos(angle) * outer, y + Math.sin(angle) * outer);
    }
    g.fillStyle(0x120f12, 1).fillCircle(x, y, size * .085);
    this.addToRoot(g);
  }

  private actorImage(id: string, x: number, y: number, size: number, status?: Combatant['status'], dollTint = 0xffffff): Phaser.GameObjects.Image {
    const doll = status === 'active' || status === 'stopped';
    const kind = status === 'dead' ? 'dead' : doll ? 'doll' : status === 'rebirthing' ? 'rebirth' : 'human';
    const image = this.acquireImage(x, y, `dashboard-portrait-${kind}-${portraitFrames[id] ?? 0}`).setDisplaySize(size, size);
    if (status === 'stopped') image.setTint(0xb8b8bc);
    else if (doll) image.setTint(dollTint);
    else if (status === 'dead') image.setTint(0xc1c0c3);
    this.addToRoot(image);
    return image;
  }

  private itemById(id: string): CombatItem | undefined { return this.ui.allItems.find(item => item.id === id) ?? this.ui.run.offers.find(item => item.id === id); }
}
