import type Phaser from 'phaser';
import { RUN_ROOM_COUNT } from '../combat/run.ts';
import { INVENTORY_CELL_COUNT, INVENTORY_GRID_SIZE, inventoryColumn, inventoryRow, occupiedCells, rotatedShape, synergyTargets, SYNERGY_TAG_LABELS } from '../combat/inventory.ts';
import { attributeModifier, chooseHeroTarget, heroArmor, heroClassForActor, MAX_ARMOR, projectRoleIntent, type CombatEvent, type CombatItem, type Combatant, type EncounterState } from '../combat/simulation.ts';
import { ITEM_CLASS_LABELS } from '../combat/items.ts';
import { ACTOR_ROWS, actorStateFrame, stoppedDollTransform, CLASS_ITEM_ART, type ActorSpriteId, type ActorSpriteState } from '../presentation/ArtCatalog.ts';
import { itemArtBounds } from '../presentation/itemGeometry.ts';
import { assetUrl } from '../presentation/assetUrl.ts';
import { getPuppetCellModifiers, getPuppetForm } from '../combat/puppets.ts';
import { COMBAT_CONFIG } from '../combat/config.ts';
import { formatItemNumber } from '../combat/formatNumber.ts';
import { GAME_VERSION } from '../version.ts';
import type { GameUI } from './GameUI.ts';
import { TooltipLayer, type ItemTooltipContent } from './TooltipLayer.ts';

export interface UIZone {
  x: number; y: number; width: number; height: number;
  action?: string; value?: string; itemId?: string; actorId?: string; heroId?: string; cell?: number; reward?: boolean; stash?: boolean; floorDrop?: boolean;
}
export interface DragPreview { item: CombatItem; x: number; y: number; heroId?: string; anchor?: number; valid?: boolean }

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
const puppetBranchLabels = { theatrical: 'Кукольно-театральная', mechanical: 'Механико-стимпанковая', mystical: 'Религиозно-мистическая' } as const;
const rarityLabels: Record<NonNullable<CombatItem['rarity']>, string> = { common: 'ОБЫЧНОЕ', uncommon: 'НЕОБЫЧНОЕ', rare: 'РЕДКОЕ', epic: 'МИФИЧЕСКОЕ', legendary: 'ЛЕГЕНДАРНОЕ' };
const categoryLabels: Record<NonNullable<CombatItem['category']>, string> = { weapon: 'ОРУЖИЕ', protection: 'ЗАЩИТА', jewelry: 'УКРАШЕНИЕ', relic: 'РЕЛИКВИЯ', tool: 'ИНСТРУМЕНТ', consumable: 'ПРИПАС', ammo: 'БОЕПРИПАС' };
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
  guard: { portrait: [.115, .08, .23], tray: [.07, .414, .86, .515], labelX: .655, labelY: .11, labelW: .46 },
  huntress: { portrait: [.115, .08, .23], tray: [.07, .414, .86, .515], labelX: .655, labelY: .11, labelW: .46 },
  pilgrim: { portrait: [.115, .08, .23], tray: [.07, .414, .86, .515], labelX: .655, labelY: .11, labelW: .46 },
  clockmaker: { portrait: [.115, .08, .23], tray: [.07, .414, .86, .515], labelX: .655, labelY: .11, labelW: .46 },
} as const;

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
  private clickNotice?: { x: number; y: number; text: string; until: number };
  private displayedHealth = new Map<string, { value: number; at: number }>();
  private currentRoom = 0;
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
      if (this.currentRoom) for (const hero of this.ui.state.heroes) if (hero.status === 'dead') this.priorRoomDead.add(hero.id);
      this.currentRoom = this.ui.run.room;
    }
    this.hover = this.zoneAt(pointerX, pointerY);
    this.beginFrame();
    this.actorLayer.setVisible(false);
    this.zones.length = 0; this.cells.clear();
    if (this.ui.run.stage === 'opening') {
      this.tooltips.hide();
      this.openingModal();
      if (this.ui.optionsOpen) this.optionsDialog();
      this.text(GAME_VERSION, 8, this.height - 15, 10, '#aaa3aa').setAlpha(.65);
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
    this.text(GAME_VERSION, 8, this.height - 15, 10, '#aaa3aa').setAlpha(.65);
    if (!drag) this.itemSpeech();
    if (drag) this.drawDrag(drag);
    if (this.ui.confirmReset) this.resetDialog();
    if (this.ui.helpOpen) this.helpDialog();
    if (this.ui.heroInfoId) this.heroInfoDialog();
    if (this.ui.optionsOpen) this.optionsDialog();
    if (this.ui.dialogOpen) { this.tooltips.hide(); return; }
    this.renderHoverTooltip(pointerX, pointerY, drag);
    if (this.clickNotice && this.clickNotice.until > this.now) {
      const notice = this.clickNotice;
      const y = Math.max(4, notice.y - 34 - (1200 - (notice.until - this.now)) * .012);
      const x = Math.max(6, Math.min(this.width - 150, notice.x - 70));
      this.panelTexture(x, y, 146, 26); this.text(notice.text, x + 73, y + 6, 12, '#ffe4bd', 138, .5);
    }
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
    graphics.clear().setVisible(true);
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
    if (drag || this.ui.dialogOpen || this.ui.run.stage === 'opening') { this.tooltips.hide(); return; }
    const zone = this.hover;
    if (zone?.itemId) {
      const item = this.itemById(zone.itemId);
      if (item) {
        const hero = this.ui.state.heroes.find(candidate => candidate.items.includes(item));
        const tags = [categoryLabels[item.category ?? 'relic'], ...(item.tags ?? []).map(tag => SYNERGY_TAG_LABELS[tag] ?? tag.toUpperCase())];
        const relations = synergyTargets(item);
        const info = this.ui.itemDescription(item, hero);
        const match = info.match(/(?:Урон|Лечение|Подзавод):\s*\d+\./);
        const passive = info.match(/(?:Броня|Урон вещей|Урон дальних вещей|Лечение|Подзавод|Кулдаун):[^.]+/g)?.join(' · ');
        const stat = match?.[0].replace(/\.$/, '') ?? (item.effect === 'passive' ? passive ?? 'Пассивное свойство' : '');
        const icon = item.effect === 'heal' ? '✚' : item.effect === 'wind' ? '⚙' : item.effect === 'passive' ? '◆' : item.damageType === 'fire' ? '♨' : item.damageType === 'arcane' ? '✦' : '⚔';
        const damageLabel = !item.effect || item.effect === 'damage' ? (item.damageType === 'fire' ? 'огонь' : item.damageType === 'arcane' ? 'мистика' : 'физический') : '';
        const cooldown = info.match(/Кулдаун: ([^.]+(?:\.\d+)? с(?: → [^.]+(?:\.\d+)? с)?)/)?.[1] ?? `${(item.cooldownMs / 1000).toFixed(1)} с`;
        const content: ItemTooltipContent = {
          key: `${item.id}:${info}`,
          title: item.name,
          tags: [...tags].reverse().map((label, index) => ({ label, color: ['#86ddb5', '#e3ba75', '#a5baf1'][index % 3]! })),
          summary: stat ? `${icon} ${stat} ${damageLabel ? `(${damageLabel})` : ''} ${item.cooldownMs ? `· ⏱ ${cooldown}` : ''}` : '',
          description: [item.description ?? '', item.classAffinity ? `${ITEM_CLASS_LABELS[item.classAffinity]} · эффект +${Math.round((COMBAT_CONFIG.classAffinityMultiplier - 1) * 100)}%.` : '', item.passiveBonuses?.armor ? `Общий предел брони: ${MAX_ARMOR}.` : ''].filter(Boolean).join('\n'),
          relations: relations.map(rule => ({ label: SYNERGY_TAG_LABELS[rule.tag] ?? rule.tag.toUpperCase(), detail: rule.text, color: rule.negative ? '#ef9e70' : '#86ddb5' })),
        };
        this.tooltips.showItem(content, pointerX, pointerY, this.width, this.height, zone);
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

  private layout(compact: boolean): void {
    const margin = Math.max(5, Math.round(this.width * .007));
    const head = compact ? 62 : Math.max(62, this.height * .07);
    const y = head + margin;
    const roomHeight = this.height - y - margin;
    if (compact) {
      const partyH = Math.floor(roomHeight * (this.ui.run.stage === 'reward' || this.ui.run.stage === 'cache' ? .54 : .59));
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

  private button(label: string, x: number, y: number, width: number, height: number, action: string, value = '', primary = false): void {
    const hot = this.hover?.action === action && this.hover.value === value;
    if (this.scene.textures.exists('ui-button-plate')) {
      const capWidth = Math.min(width * .28, height * 300 / 404);
      const centerWidth = Math.max(1, width - capWidth * 2);
      const tint = hot ? 0xfff1d4 : primary ? 0xffffff : 0xd0c1a8;
      const plate = [
        this.acquireImage(x, y, 'ui-button-plate', 'left-cap').setOrigin(0).setDisplaySize(capWidth, height),
        this.acquireImage(x + capWidth, y, 'ui-button-plate', 'center').setOrigin(0).setDisplaySize(centerWidth, height),
        this.acquireImage(x + capWidth + centerWidth, y, 'ui-button-plate', 'right-cap').setOrigin(0).setDisplaySize(capWidth, height),
      ];
      plate.forEach(part => part.setTint(tint));
      this.addToRoot(plate);
      if (hot) {
        const highlight = this.acquireGraphics();
        highlight.fillStyle(0xffe8ba, .12).fillRoundedRect(x + capWidth, y + height * .25, centerWidth, height * .5, Math.min(5, height * .15));
        this.addToRoot(highlight);
      }
    } else {
      const g = this.acquireGraphics();
      g.fillStyle(primary ? 0x74552f : 0x372e2c, 1).fillRoundedRect(x, y, width, height, 5);
      g.lineStyle(1, primary ? 0xe7bf72 : 0x8a755c, 1).strokeRoundedRect(x, y, width, height, 5);
      this.addToRoot(g);
    }
    if (['⚙', '↻', '?', '⛶'].includes(label)) {
      const icon = this.acquireText(x + width / 2, y + height / 2, label, { fontFamily: 'Georgia, serif', fontSize: `${Math.round(height * .55)}px`, color: hot ? '#fff2d5' : '#d9c09a', stroke: '#171414', strokeThickness: 1, resolution: 2 }).setOrigin(.5);
      this.addToRoot(icon);
    }
    else {
      const fontSize = action === 'claim' ? Math.min(15, height * .38) : Math.min(21, height * .43);
      const caption = this.titleText(label, x + width / 2, y + height / 2, fontSize, hot ? '#ffffff' : '#fff0d4', width - 20, .5);
      caption.setOrigin(.5, .5);
    }
    this.zones.push({ x, y, width, height, action, value });
  }

  private header(): void {
    const compact = this.compactLayout;
    const stageName = this.ui.run.stage === 'defeat' ? 'КОНЕЦ ЗАБЕГА' : `АКТ 1 · СПУСК ${this.ui.run.room}/${RUN_ROOM_COUNT}`;
    if (this.ui.run.stage !== 'opening' && this.ui.run.stage !== 'victory') {
      const controlsLeft = this.width - 162 - this.left.x;
      const centeredWidth = 2 * (controlsLeft - this.width / 2 - 8);
      const panelW = compact
        ? Math.min(420, this.width * .74)
        : Math.min(420, this.width * .57, Math.max(1, centeredWidth >= 180 ? centeredWidth : controlsLeft - 16));
      const panelX = compact || centeredWidth >= 180 ? (this.width - panelW) / 2 : 8;
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
    const controlY = compact ? 36 : 5;
    const controlHeight = compact ? 28 : this.height < 600 ? 28 : 34;
    if (this.ui.run.stage !== 'opening') this.button('↻', this.width - 42 - this.left.x, controlY, 36, controlHeight, 'restart');
    this.button('?', this.width - 82 - this.left.x, controlY, 36, controlHeight, 'help');
    this.button('⛶', this.width - 122 - this.left.x, controlY, 36, controlHeight, 'fullscreen');
    this.button('⚙', this.width - 162 - this.left.x, controlY, 36, controlHeight, 'options');
  }

  private party(drag?: DragPreview): void {
    const g = this.acquireGraphics(); this.addToRoot(g);
    const heroes = [...this.ui.state.heroes].sort((a, b) => a.slot - b.slot);
    const gap = 7, footerH = this.ui.selectedItem ? (this.compactLayout ? 26 : 31) : 0;
    const cardW = (this.left.width - 12 - gap) / 2, cardH = (this.left.height - 12 - gap - footerH) / 2;
    const compact = this.compactLayout;
    for (let h = 0; h < heroes.length; h++) {
      const hero = heroes[h]!;
      const classId = heroClassForActor(hero) ?? 'guard';
      const theme = classCardThemes[classId];
      const layout = dashboardLayout[classId];
      const x = this.left.x + 6 + (h % 2) * (cardW + gap), y = this.left.y + 6 + Math.floor(h / 2) * (cardH + gap);
      const boardSize = Math.max(1, Math.min(cardW - 4, cardH - 4));
      const boardX = x + (cardW - boardSize) / 2, boardY = y + (cardH - boardSize) / 2;
      const stopped = hero.status === 'stopped';
      const chargeRatio = stopped ? Math.max(0, Math.min(1, hero.windUpCharge / Math.max(1, hero.maxWindUp))) : 0;
      const windPulse = stopped ? (Math.sin(this.now / 125) + 1) / 2 : 0;
      const flashUntil = this.windFlashes.get(hero.id) ?? 0;
      const clickFlash = flashUntil > this.now ? (flashUntil - this.now) / 260 : 0;
      g.fillStyle(0x050408, .7).fillRoundedRect(boardX + 3, boardY + 5, boardSize, boardSize, 5);
      const board = this.acquireImage(boardX, boardY, `ui-dashboard-${classId}`).setOrigin(0).setDisplaySize(boardSize, boardSize);
      if (stopped) board.setTint(mixTint(0x777777, 0xf4dfad, chargeRatio * .65));
      else if (hero.status === 'dead') board.setTint(0x777777);
      this.addToRoot(board);
      if (stopped && this.ui.state.phase === 'combat') this.zones.push({ x, y, width: cardW, height: cardH, action: 'wind', value: hero.id });
      const isPuppet = hero.isPuppet;
      this.actorImage(hero.id, boardX + boardSize * .2045, boardY + boardSize * .212, boardSize * .23, hero.status, theme.dollTint);
      const nameX = boardX + boardSize * layout.labelX, nameY = boardY + boardSize * (compact ? .095 : layout.labelY);
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
      const nameText = this.titleText(hero.name.toUpperCase(), nameX, nameY, nameSize, stopped || hero.status === 'dead' ? '#d5d5d8' : '#fff2d9', nameTextW, .5);
      const statusLabel = actorCardStatus[hero.status].toUpperCase();
      const labelGap = compact ? 1 : 2;
      const statusY = nameY + nameText.displayHeight + labelGap;
      let statusFontSize = Math.max(compact ? 7 : 8, Math.round(Math.min(compact ? 8 : 10, boardSize * .04, (nameW - 8) / (statusLabel.length * .58))));
      const statusText = this.acquireText(nameX, statusY, statusLabel, {
        fontFamily: 'Georgia, serif', fontStyle: 'bold', fontSize: statusFontSize, letterSpacing: compact ? 0 : .2,
        color: stopped || hero.status === 'dead' ? '#e5e2df' : '#f4e5cd', resolution: 2, stroke: '#171414', strokeThickness: 1,
      }).setOrigin(.5, 0);
      const statusWidth = isPuppet ? nameTextW : nameW - 8;
      while (statusText.width > statusWidth && statusFontSize > 7) statusText.setFontSize(--statusFontSize);
      if (statusText.width > statusWidth) statusText.setScale(statusWidth / statusText.width);
      const statusBackground = this.acquireGraphics();
      statusBackground.fillStyle(0x17141b, .96).fillRoundedRect(
        nameX - statusText.displayWidth / 2 - 3, statusY, statusText.displayWidth + 6, statusText.displayHeight, 2,
      );
      this.addToRoot(statusBackground);
      this.addToRoot(statusText);
      if (puppetBadge) {
        const badgeY = nameY + (nameText.displayHeight + labelGap + statusText.displayHeight) / 2;
        this.puppetStateBadge(nameX - puppetBadge.offset, badgeY, puppetBadge.size, puppetBadge.color);
        this.puppetStateBadge(nameX + puppetBadge.offset, badgeY, puppetBadge.size, puppetBadge.color);
      }
      const animation = this.windAnimations.get(hero.id);
      const shownWind = animation ? animation.from + (animation.to - animation.from) * Math.min(1, 1 - Math.max(0, animation.until - this.now) / 260) : hero.windUpCharge;
      this.resourceModule(boardX, boardY, boardSize, hero, shownWind);
      const cell = Math.max(1, Math.floor(boardSize * Math.min(layout.tray[2], layout.tray[3]) / INVENTORY_GRID_SIZE));
      const gridSize = INVENTORY_GRID_SIZE * cell;
      const gridX = boardX + boardSize * (layout.tray[0] + layout.tray[2] / 2) - gridSize / 2;
      const gridY = boardY + boardSize * (layout.tray[1] + layout.tray[3] / 2) - gridSize / 2;
      const availableInfoWidth = Math.max(1, gridX - (boardX + boardSize * .07));
      const infoSize = Math.min(38, boardSize * .13, Math.max(1, availableInfoWidth - 4));
      const infoX = boardX + boardSize * .07 + (availableInfoWidth - infoSize) / 2, infoY = gridY + (gridSize - infoSize) / 2;
      this.button('', infoX, infoY, infoSize, infoSize, 'hero-info', hero.id);
      const infoGlyph = this.acquireText(infoX + infoSize / 2, infoY + infoSize / 2, 'i', {
        fontFamily: 'Georgia, serif', fontStyle: 'bold', fontSize: `${Math.round(infoSize * .67)}px`,
        color: '#f6e4c1', stroke: '#171014', strokeThickness: 2, resolution: 2,
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
        this.zones.push({ x: cx, y: cy, width: cell, height: cell, action: windCard ? 'wind' : 'cell', value: windCard ? hero.id : `${hero.id}:${i}`, heroId: hero.id, cell: i,
          itemId: item && occupied?.includes(i) ? item.id : undefined });
        this.cells.set(`${hero.id}:${i}`, { x: cx, y: cy, size: cell });
        if (item && occupied?.includes(i) && isOrigin) itemOrigins.push(item);
      }
      this.addToRoot(gridMarks);
      const texture = this.acquireImage(gridX + INVENTORY_GRID_SIZE * cell / 2, gridY + INVENTORY_GRID_SIZE * cell / 2, 'ui-inventory-texture')
        .setDisplaySize(gridSize, gridSize).setAlpha(stopped ? .05 : .08);
      this.addToRoot(texture);
      const crispGrid = this.acquireGraphics();
      crispGrid.lineStyle(1, stopped ? 0xbfc0c6 : theme.edge, .34);
      for (let line = 0; line <= INVENTORY_GRID_SIZE; line++) {
        crispGrid.lineBetween(gridX + line * cell, gridY, gridX + line * cell, gridY + gridSize);
        crispGrid.lineBetween(gridX, gridY + line * cell, gridX + gridSize, gridY + line * cell);
      }
      this.addToRoot(crispGrid);
      // Draw sprites only after every cell and grid line so the grid cannot cut through art.
      for (const item of itemOrigins) this.drawItem(item, gridX, gridY, cell, stopped || hero.status === 'rebirthing');
      const inspected = drag?.heroId === hero.id && drag.anchor !== undefined ? { ...drag.item, cell: drag.anchor } : hero.items.find(item => item.id === this.hover?.itemId);
      const relations = inspected ? synergyTargets(inspected) : [];
      const sourceCells = inspected ? occupiedCells(inspected, inspected.cell ?? 0) ?? [] : [];
      if (relations.length && sourceCells.length) {
        const glow = this.acquireGraphics();
        const around = new Set<number>();
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
          const color = match?.negative ? 0xf09d58 : match ? 0x78f2ad : 0xe3bf72;
          const cx = gridX + inventoryColumn(index) * cell, cy = gridY + inventoryRow(index) * cell;
          glow.fillStyle(color, match ? .26 : .12).fillRect(cx + 1, cy + 1, cell - 2, cell - 2);
          glow.lineStyle(match ? 2 : 1, color, match ? 1 : .7).strokeRect(cx + 1, cy + 1, cell - 2, cell - 2);
        }
        this.addToRoot(glow);
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
    this.button('На пол', this.left.x + (compact ? 94 : 122), rotateY, compact ? 64 : 82, compact ? 22 : 28, 'store', this.ui.selectedItem);
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
    const frame = itemFrames[item.definitionId ?? 'blade'] ?? 0;
    const footprint = cells.map(([dx, dy]) => ({ x: anchorX + dx * cell, y: anchorY + dy * cell }));
    const plate = this.acquireGraphics();
    const rarityTint = muted ? 0x77777b : itemRarityTint(item.rarity);
    for (const position of footprint) {
      plate.fillStyle(0x17141c, 1).fillRect(position.x, position.y, cell, cell);
      plate.fillStyle(rarityTint, .24).fillRect(position.x + 1, position.y + 1, cell - 2, cell - 2);
    }
    // Trace only the outside contour; interior item cells have no distracting grid seams.
    const occupied = new Set(cells.map(([x, y]) => `${x},${y}`));
    const selected = this.ui.selectedItem === item.id;
    const hovered = this.hover?.itemId === item.id;
    plate.lineStyle(selected ? 2.5 : hovered ? 2 : 1.5, selected ? 0x79d9dd : muted && hovered ? 0xc3c3c6 : rarityTint, .95);
    cells.forEach(([dx, dy], index) => {
      const { x, y } = footprint[index]!;
      if (!occupied.has(`${dx},${dy - 1}`)) plate.lineBetween(x, y, x + cell, y);
      if (!occupied.has(`${dx + 1},${dy}`)) plate.lineBetween(x + cell, y, x + cell, y + cell);
      if (!occupied.has(`${dx},${dy + 1}`)) plate.lineBetween(x, y + cell, x + cell, y + cell);
      if (!occupied.has(`${dx - 1},${dy}`)) plate.lineBetween(x, y, x, y + cell);
    });
    this.addToRoot(plate);
    const art = itemCatalog[item.definitionId as keyof typeof itemCatalog] ?? CLASS_ITEM_ART.blade;
    const image = this.acquireImage(0, 0, itemAtlases[item.definitionId ?? ''] ?? 'items-guard', frame);
    if (muted) image.setTint(0xb0b0b3);
    const turns = ((item.rotation ?? 0) % 4 + 4) % 4;
    const oddTurn = turns % 2 === 1;
    const artWidth = oddTurn ? art.content.height : art.content.width;
    const artHeight = oddTurn ? art.content.width : art.content.height;
    const bounds = itemArtBounds(cells, anchorX, anchorY, cell, artWidth, artHeight);
    const { centerX, centerY } = bounds;
    const inset = Math.max(1, cell * .04);
    const fitWidth = Math.max(1, bounds.right - bounds.left - inset * 2);
    const fitHeight = Math.max(1, bounds.bottom - bounds.top - inset * 2);
    const baseScale = Math.min(fitWidth / artWidth, fitHeight / artHeight);
    const angle = turns * Math.PI / 2;
    const offsetX = (art.content.x + art.content.width / 2 - image.width / 2) * baseScale;
    const offsetY = (art.content.y + art.content.height / 2 - image.height / 2) * baseScale;
    image.setScale(baseScale).setRotation(angle);
    image.setPosition(centerX - (offsetX * Math.cos(angle) - offsetY * Math.sin(angle)), centerY - (offsetX * Math.sin(angle) + offsetY * Math.cos(angle)));
    const anticipation = this.ui.run.stage === 'battle' && this.ui.state.phase === 'combat' && this.ui.state.outcome === 'ongoing'
      && item.remainingMs > 0 && item.remainingMs < Math.min(300, item.cooldownMs * .2);
    if (anticipation) {
      image.x += Math.sin(this.now / 38) * Math.min(1, inset * .35);
    }
    this.addToRoot(image);
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
      const trackX = anchorX + barStart * cell + 2, trackY = anchorY + (bottomY + 1) * cell - 5, trackWidth = Math.max(4, barLength * cell - 4);
      g.fillStyle(0x211b1b, 1).fillRect(trackX, trackY, trackWidth, 3);
      g.fillStyle(muted ? 0x96969a : anticipation ? 0xffd37b : 0xe5b75f, 1).fillRect(trackX, trackY, trackWidth * cooldown, 3);
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
    const y = boardY + boardSize * .288 - height / 2;
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
        color: '#fff1dc', stroke: '#171016', strokeThickness: 2, resolution: 2,
      }).setOrigin(.5, .5);
      if (value.width > width * .67) value.setScale(width * .67 / value.width);
      value.setShadow(0, 1, '#100b10', 2, false, true);
      this.addToRoot(value);
    }
  }

  private room(drag?: DragPreview): void {
    const run = this.ui.run;
    if (run.stage !== 'victory') {
      const title = run.stage === 'defeat' ? 'Конец пути' : run.stage === 'reward' ? 'Трофеи из пепла' : run.stage === 'cleared' ? 'Тишина после боя' : run.stage === 'route' ? 'Выберите следующий след' : run.stage === 'cache' ? 'Забытый тайник' : run.stage === 'workshop' ? 'Часовая мастерская' : run.stage === 'event' ? 'Лазарет забытого братства' : run.roomLabel;
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
    else if (run.stage === 'cleared') this.cleared();
    else if (run.stage === 'victory' || run.stage === 'defeat') { this.battlefield(); this.ending(); }
    if (drag?.heroId && drag.anchor !== undefined) this.drawDropFootprint(drag);
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
    const modeLabel = this.ui.startingLoadout === 'full' ? 'Полный инвентарь ▾' : 'Начальные вещи ▾';
    this.button(modeLabel, (this.width - selectorW) / 2, selectorY, selectorW, selectorH, 'toggle-start-loadout');
    if (this.ui.startLoadoutMenuOpen) {
      const options = [
        { id: 'full', label: 'Полный инвентарь · для теста' },
        { id: 'starter', label: 'Начальный комплект' },
      ] as const;
      options.forEach((option, index) => {
        this.button(option.label, (this.width - selectorW) / 2, selectorY + selectorH + 4 + index * optionH,
          selectorW, optionH, 'set-start-loadout', option.id, this.ui.startingLoadout === option.id);
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
    const ground = {
      left: this.field.x + this.field.width * .06,
      right: this.field.x + this.field.width * .94,
      top: this.field.y + this.field.height * .27,
      bottom: this.field.y + this.field.height * .88,
    };
    const now = this.now;
    const action = this.ui.latestAction && now < this.ui.highlightUntil ? this.ui.latestAction : undefined;
    const enemyTarget = this.ui.state.enemies.find(enemy => enemy.status === 'enemy');
    const allActors = [...this.ui.state.heroes, ...this.ui.state.enemies];
    const actionTarget = action && allActors.find(candidate => candidate.id === action.targetId);
    const actionItem = action?.kind === 'item' ? this.ui.state.heroes.flatMap(hero => hero.items).find(item => item.id === action.sourceId) : undefined;
    const friendlyAction = actionItem?.effect === 'heal' || actionItem?.effect === 'wind';
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
      const depth = hero ? (intent.lane === 'front' ? .74 : .49) : .38 + Math.floor(index / 2) * .28 + (index % 2) * .12;
      const baseY = ground.top + (ground.bottom - ground.top) * Math.max(.08, Math.min(.95, depth));
      let x = hero
        ? ground.left + (ground.right - ground.left) * (intent.lane === 'front' ? .55 + ((formation?.rank ?? 0) - ((formation?.count ?? 1) - 1) / 2) * .1 : .34 + ((formation?.rank ?? 0) - ((formation?.count ?? 1) - 1) / 2) * .12)
        : ground.right - (ground.right - ground.left) * (.2 + (index % 2) * .15 + Math.floor(index / 2) * .04);
      const y = baseY + (hero ? ((formation?.rank ?? 0) - ((formation?.count ?? 1) - 1) / 2) * this.field.height * .035 : 0);
      const hostile = actionTarget && actionTarget.side !== actor.side;
      const nearFront = hero ? actor.role === 'guard' : (actor.reach ?? 'near') === 'near';
      const lunge = action?.actorId === actor.id && hostile && nearFront ? (hero ? 1 : -1) * this.field.width * .085 * Math.sin(Math.PI * (1 - (this.ui.highlightUntil - now) / 700)) : 0;
      return { x: Math.max(ground.left, Math.min(ground.right, x + lunge)), y: Math.max(ground.top, Math.min(ground.bottom, y)), scale: .76 + (baseY - ground.top) / Math.max(1, ground.bottom - ground.top) * .44 };
    };
    const units = [...this.ui.state.heroes.filter(actor => !this.priorRoomDead.has(actor.id)).map((actor, index) => ({ actor, hero: true, index })), ...this.ui.state.enemies.map((actor, index) => ({ actor, hero: false, index }))];
    for (const unit of units) {
      const position = actorPosition(unit.actor, unit.hero, unit.index);
      positions.set(unit.actor.id, { ...position, actor: unit.actor, hero: unit.hero, index: unit.index });
    }
    // Keep active actors' feet apart on the ground plane while allowing front and rear rows to overlap in depth.
    const standing = [...positions.values()].filter(position => position.actor.status !== 'dead' && position.actor.status !== 'rebirthing');
    const baseSize = Math.min(this.compactLayout ? 132 : 220, this.field.height * (this.compactLayout ? .4 : .39));
    for (let pass = 0; pass < 6; pass++) {
      for (let i = 0; i < standing.length; i++) for (let j = i + 1; j < standing.length; j++) {
        const a = standing[i]!, b = standing[j]!;
        const separation = baseSize * (a.scale + b.scale) * .30;
        if (Math.abs(a.y - b.y) > baseSize * (a.scale + b.scale) * .12 || Math.abs(a.x - b.x) >= separation) continue;
        const direction = a.x === b.x ? (a.index <= b.index ? -1 : 1) : Math.sign(a.x - b.x);
        const shift = (separation - Math.abs(a.x - b.x)) / 2;
        a.x = Math.max(ground.left, Math.min(ground.right, a.x + direction * shift));
        b.x = Math.max(ground.left, Math.min(ground.right, b.x - direction * shift));
      }
    }
    this.root.bringToTop(this.actorLayer);
    this.actorLayer.setVisible(true);
    const visibleActors = new Set<string>();
    const ordered = [...positions.values()].sort((a, b) => a.y - b.y);
    for (const position of ordered) {
      const { actor, hero, x, y, scale } = position;
      const artSize = Math.min(this.compactLayout ? 132 : 220, this.field.height * (this.compactLayout ? .4 : .39)) * scale;
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
      view.meter.clear().fillStyle(0x191719, .95).fillRoundedRect(-artSize * .30, artSize * .45, artSize * .60, this.compactLayout ? 5 : 7, 3);
      const current = actor.status === 'active' || actor.status === 'stopped' || actor.status === 'dead' ? actor.durability : actor.hp;
      const max = actor.status === 'active' || actor.status === 'stopped' || actor.status === 'dead' ? actor.maxDurability : actor.maxHp;
      const previous = this.displayedHealth.get(actor.id);
      const shown = previous ? previous.value + (current - previous.value) * (1 - Math.exp(-Math.max(0, now - previous.at) / 250)) : current;
      this.displayedHealth.set(actor.id, { value: shown, at: now });
      view.meter.setVisible(actor.status !== 'rebirthing' && actor.status !== 'dead');
      view.meter.fillStyle(hero ? 0x79c36b : 0xe05b59, 1).fillRoundedRect(-artSize * .30, artSize * .45, artSize * .60 * Math.max(0, Math.min(1, shown / Math.max(1, max))), this.compactLayout ? 5 : 7, 3);
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
    const y0 = this.right.y + 50, h = Math.min(54, this.right.height * .12), gap = 8;
    choices.forEach((choice, index) => this.button(choice.label, this.right.x + 12, y0 + index * (h + gap), this.right.width - 24, h, 'room', choice.id, choice.kind === 'battle' || choice.kind === 'boss'));
  }

  private rewards(): void {
    const offers = this.ui.run.offers, compact = this.compactLayout;
    const gap = compact ? 6 : 10;
    const y0 = this.field.y + 5;
    const available = Math.max(1, this.right.y + this.right.height - (compact ? 14 : 30) - y0);
    const height = Math.max(58, Math.min(compact ? 112 : 166, (available - gap * Math.max(0, offers.length - 1)) / Math.max(1, offers.length)));
    offers.forEach((item, index) => {
      const x = this.right.x + 12, y = y0 + index * (height + gap), w = this.right.width - 24;
      const color = itemRarityTint(item.rarity);
      const hot = this.hover?.action === 'claim' && this.hover.value === item.id;
      const shortCard = height < 126;
      const tinyCard = height < 70;
      const cardCompact = compact || shortCard;
      const iconSize = Math.min(height - 14, cardCompact ? 62 : 102);
      const iconWell = { x: x + 7, y: y + 7, width: iconSize + 14, height: height - 14 };
      const iconX = iconWell.x + iconWell.width / 2, iconY = y + height / 2;
      const textX = iconWell.x + iconWell.width + (cardCompact ? 12 : 18), textWidth = Math.max(50, w - (textX - x) - 12);
      this.panelTexture(x, y, w, height);
      const g = this.acquireGraphics();
      g.fillStyle(color, hot ? .25 : .14).fillRoundedRect(x + 2, y + 2, w - 4, height - 4, 5);
      g.lineStyle(hot ? 2 : 1, hot ? mixTint(color, 0xfff0d0, .28) : color, .8).strokeRoundedRect(x, y, w, height, 6);
      g.lineStyle(1, 0xe2c18a, hot ? .82 : .58).strokeRoundedRect(x + 4, y + 4, w - 8, height - 8, 4);
      this.addToRoot(g);
      this.panelTexture(iconWell.x, iconWell.y, iconWell.width, iconWell.height);
      this.frameCorners(x, y, w, height, Math.min(compact ? 24 : 40, height * .3), .95);
      this.itemImage(item, iconX, iconY, iconSize * .94);
      const titleY = y + (shortCard ? Math.min(23, height * .2) : compact ? 20 : 24);
      const ctaW = Math.min(compact ? 82 : 126, w * .25);
      const ctaH = compact ? Math.min(44, height - 10) : 36;
      const ctaX = x + w - ctaW - (compact ? 22 : 24);
      const copyWidth = Math.max(50, Math.min(textWidth - ctaW - 12, 65 * (cardCompact ? 13 : 24) * .53));
      const title = this.titleText(item.name, textX, titleY, cardCompact ? 14 : 24, '#fff0cf', copyWidth);
      if (title.scaleX < .82) {
        title.setScale(1);
        let readableName = item.name;
        while (readableName.length > 5 && title.width > copyWidth) {
          readableName = `${readableName.slice(0, -2).trimEnd()}…`;
          title.setText(readableName);
        }
      }
      const titleSpace = tinyCard ? 12 : shortCard || compact ? 19 : 27;
      if (title.displayHeight > titleSpace) title.setScale(title.scaleX * titleSpace / title.displayHeight);
      const rarityText = `${rarityLabels[item.rarity ?? 'common']}  ·  ${categoryLabels[item.category ?? 'relic']}`;
      const rarity = this.acquireText(textX, titleY + (tinyCard ? 11 : shortCard || compact ? 14 : 29), rarityText, {
        fontFamily: 'Georgia, serif', fontStyle: 'bold', fontSize: `${cardCompact ? 11 : 13}px`,
        color: item.rarity === 'common' || !item.rarity ? '#cfcbd0' : `#${mixTint(color, 0xffffff, .42).toString(16).padStart(6, '0')}`, stroke: '#171414', strokeThickness: 1, resolution: 2,
      });
      if (rarity.width > copyWidth) rarity.setScale(copyWidth / rarity.width);
      this.addToRoot(rarity);
      const descY = titleY + (cardCompact ? 27 : 52);
      const descriptionWidth = copyWidth;
      const description = this.acquireText(textX, descY, shortCard ? '' : item.description ?? '', {
        fontFamily: 'Georgia, serif', fontSize: `${cardCompact ? 11 : 15}px`, lineSpacing: cardCompact ? 2 : 3,
        color: '#eadfce', stroke: '#171414', strokeThickness: 1, resolution: 2,
        wordWrap: { width: descriptionWidth },
      });
      const descriptionSpace = Math.max(1, y + height - (cardCompact ? 40 : 60) - descY);
      if (shortCard || descriptionSpace < 8) description.setVisible(false);
      if (compact && description.height > descriptionSpace) {
        // Preserve a readable single line on small screens; the full description stays in the tooltip.
        let excerpt = item.description ?? '';
        description.setWordWrapWidth(0);
        while (excerpt.length && description.width > descriptionWidth) {
          excerpt = excerpt.slice(0, -1);
          description.setText(`${excerpt.trimEnd()}…`);
        }
        if (description.height > descriptionSpace) description.setVisible(false);
      } else if (description.height > descriptionSpace) description.setScale(descriptionSpace / description.height);
      this.addToRoot(description);
      if (height >= 58) {
        const cooldown = `⏱ ${(item.cooldownMs / 1000).toFixed(1)}с`;
        let stats: string;
        if (item.effect === 'wind') stats = `⚙ ЗАВОД +${formatItemNumber(item.windAmount ?? 0)}  ·  ${cooldown}`;
        else if (item.effect === 'heal') stats = `✚ ЛЕЧЕНИЕ ${formatItemNumber(item.damage)}  ·  ${cooldown}`;
        else if (item.trigger === 'passive') {
          const bonus = item.passiveBonuses;
          const parts = [bonus?.armor ? `БРОНЯ +${formatItemNumber(bonus.armor)}` : '', bonus?.damage ? `УРОН +${formatItemNumber(bonus.damage)}` : '',
            bonus?.healing ? `ЛЕЧЕНИЕ +${formatItemNumber(bonus.healing)}` : '', bonus?.wind ? `ЗАВОД +${formatItemNumber(bonus.wind)}` : '',
            bonus?.cooldownFactor && bonus.cooldownFactor < 1 ? `КУЛДАУН −${Math.round((1 - bonus.cooldownFactor) * 100)}%` : ''].filter(Boolean);
          stats = `◆ ${parts.join('  ·  ') || 'ПАССИВНОЕ СВОЙСТВО'}`;
        } else {
          const damageIcon = item.damageType === 'fire' ? '♨' : item.damageType === 'arcane' ? '✦' : '⚔';
          const damageType = item.damageType === 'fire' ? 'ОГОНЬ' : item.damageType === 'arcane' ? 'МИСТИКА' : 'ФИЗ.';
          stats = `${damageIcon} УРОН ${formatItemNumber(item.damage)} ${damageType}  ·  ${cooldown}`;
        }
        if (shortCard && item.trigger !== 'passive' && item.effect !== 'passive') {
          const icon = item.effect === 'wind' ? '⚙' : item.effect === 'heal' ? '✚' : item.damageType === 'fire' ? '♨' : item.damageType === 'arcane' ? '✦' : '⚔';
          const amount = item.effect === 'wind' ? item.windAmount ?? 0 : item.damage;
          const label = item.effect === 'wind' ? 'ЗАВОД' : item.effect === 'heal' ? 'ЛЕЧЕНИЕ' : 'УРОН';
          stats = `${icon} ${label} ${formatItemNumber(amount)} · ${cooldown}`;
        }
        let statsBottomInset = compact ? 39 : 54;
        if (shortCard) statsBottomInset = height >= 96 ? 42 : 34;
        if (tinyCard) statsBottomInset = 27;
        const statLabel = this.acquireText(textX, y + height - statsBottomInset, stats, {
          fontFamily: 'Georgia, serif', fontStyle: 'bold', fontSize: `${tinyCard ? 9 : cardCompact ? 11 : 14}px`, color: '#f2cf80',
          stroke: '#171414', strokeThickness: 1, resolution: 2,
        });
        const statWidth = Math.max(1, compact ? descriptionWidth : ctaX - textX - 10);
        if (statLabel.width > statWidth) statLabel.setScale(statWidth / statLabel.width);
        this.addToRoot(statLabel);
      }
      this.zones.push({ x, y, width: w, height, action: 'claim', value: item.id, itemId: item.id, reward: true });
      this.button('Взять', ctaX, y + (height - ctaH) / 2, ctaW, ctaH, 'claim', item.id, true);
    });
  }

  private workshop(): void {
    const x = this.right.x + 12, w = this.right.width - 24; let y = this.right.y + 52;
    this.text('Ключ возвращает куклам завод, но не чинит их корпус.', x, y, this.compactLayout ? 9 : 13, '#e1cfaf', w); y += this.compactLayout ? 36 : 54;
    this.button('Полностью завести кукол', x, y, w, 38, 'workshop-wind', '', true); y += 46;
    const cursed = this.ui.allItems.filter(item => item.definitionId === 'lantern' && !item.calmed);
    const calmed = this.ui.run.workshopCalmed;
    if (cursed.length && !calmed) { this.button(`Успокоить фонарь · ${cursed[0]!.name}`, x, y, w, 36, 'calm', cursed[0]!.id); y += 44; }
    else this.text(calmed ? 'Проклятие снято.' : 'Нет проклятых предметов.', x, y, 11, '#cdb993', w);
    this.button('Закончить работу', x, this.right.y + this.right.height - 44, w, 34, 'leave-workshop');
  }

  private event(): void {
    const x = this.right.x + 12, w = this.right.width - 24, y = this.right.y + 54;
    this.text('В лечебнице хватит припасов только на один выбор.', x, y, this.compactLayout ? 9 : 13, '#e1cfaf', w);
    this.button('Лечить людей · +15 здоровья', x, y + 46, w, 40, 'event-choice', 'heal');
    this.button('Починить кукол · +15 прочности', x, y + 96, w, 40, 'event-choice', 'repair');
  }

  private cleared(): void {
    const x = this.right.x + 12, w = this.right.width - 24;
    const floorBottom = this.right.y + this.right.height - 60;
    this.zones.push({ x: this.field.x, y: this.field.y, width: this.field.width, height: Math.max(0, floorBottom - this.field.y), action: 'floor-drop', floorDrop: true });
    const y = this.right.y + 45;
    if (this.ui.state.floor.length) {
      this.text(`НА ПОЛУ · ${this.ui.state.floor.length}`, x, y, 11, '#f0cc86', w);
      this.drawLooseItems(this.ui.state.floor, x, y + 19, w);
    } else this.text('Враги повержены.', x, y, this.compactLayout ? 9 : 13, '#e1cfaf', w);
    this.button('Выбрать следующую комнату', x, this.right.y + this.right.height - 60, w, 50, 'route', '', true);
  }

  private drawLooseItems(items: CombatItem[], x: number, y: number, width: number): number {
    const size = this.compactLayout ? 36 : 54, gap = 6;
    const columns = Math.max(1, Math.floor((width + gap) / (size + gap)));
    items.forEach((item, index) => {
      const bx = x + index % columns * (size + gap), by = y + Math.floor(index / columns) * (size + gap);
      this.card(bx, by, size, size, item.name);
      this.itemImage(item, bx + size / 2, by + size / 2, size - 4);
      this.zones.push({ x: bx, y: by, width: size, height: size, action: 'item', value: item.id, itemId: item.id, floorDrop: true });
    });
    return y + Math.ceil(items.length / columns) * (size + gap);
  }

  private ending(): void {
    const win = this.ui.run.stage === 'victory';
    const x = this.right.x + 12, y = this.field.y + 26, w = this.right.width - 24;
    if (!win) {
      this.panelTexture(x, y - 8, w, 86);
      this.titleText('Завод остановлен', x + w / 2, y, this.compactLayout ? 20 : 32, '#d3847a', w, .5);
      this.text('Все куклы разрушены.', x, y + 43, this.compactLayout ? 9 : 13, '#e9d5b5', w);
    }
    this.button('Начать новый забег', x, this.right.y + this.right.height - 76, w, 64, 'restart', '', true);
  }

  private drawDropFootprint(drag: DragPreview): void {
    if (!drag.heroId || drag.anchor === undefined) return;
    const cells = occupiedCells(drag.item, drag.anchor) ?? [];
    const g = this.acquireGraphics(); const color = drag.valid ? 0xf3ba63 : 0xef766c;
    cells.forEach(index => {
      const cell = this.cells.get(`${drag.heroId}:${index}`); if (!cell) return;
      g.fillStyle(color, .18).fillRect(cell.x, cell.y, cell.size, cell.size);
      g.fillStyle(color, .23).fillRect(cell.x + 2, cell.y + 2, cell.size - 4, cell.size - 4);
      g.lineStyle(1, color, .9).strokeRect(cell.x + 1, cell.y + 1, cell.size - 2, cell.size - 2);
    }); this.addToRoot(g);
  }

  private drawDrag(drag: DragPreview): void {
    const shape = rotatedShape(drag.item);
    const size = Math.min(this.compactLayout ? 24 : 34, 160 / Math.max(1, shape.length));
    const g = this.acquireGraphics(); g.fillStyle(drag.valid === false ? 0xae4f4e : 0xb98954, .82);
    for (const [dx, dy] of shape) g.fillRoundedRect(drag.x + dx * size, drag.y + dy * size, size - 2, size - 2, 3);
    this.addToRoot(g);
    const image = this.itemImage(drag.item, drag.x + size / 2, drag.y + size / 2, size * .9); image.setAlpha(.9);
  }

  private itemSpeech(): void {
    const speech = this.ui.dialogue.active;
    if (!speech || speech.expiresAt <= this.now) return;
    const hero = this.ui.state.heroes.find(candidate => candidate.id === speech.heroId);
    const item = hero?.items.find(candidate => candidate.id === speech.itemId) ?? this.ui.state.floor.find(candidate => candidate.id === speech.itemId);
    if (!hero || !item) return;
    const cells = occupiedCells(item, speech.formerCell ?? item.cell ?? 0);
    const anchor = cells?.map(index => this.cells.get(`${hero!.id}:${index}`)).find(Boolean);
    if (!anchor) return;
    const maxWidth = Math.min(this.compactLayout ? 155 : 210, this.width - 20);
    const label = this.acquireText(0, 0, speech.text, { fontFamily: 'Georgia, serif', fontStyle: 'bold',
      fontSize: this.compactLayout ? '10px' : '13px', color: '#fff0cc', stroke: '#241717', strokeThickness: 1,
      wordWrap: { width: maxWidth - 20 }, resolution: 2 });
    const w = Math.ceil(label.width + 18), h = Math.ceil(label.height + 12);
    const anchorX = anchor.x + anchor.size / 2, anchorY = anchor.y;
    const x = Math.max(5, Math.min(this.width - w - 5, anchorX - w / 2));
    const compact = this.compactLayout;
    const cardH = (this.left.height - 12 - 7 - (this.ui.selectedItem ? (compact ? 26 : 31) : 0)) / 2;
    const cardW = (this.left.width - 12 - 7) / 2;
    const boardSize = Math.max(1, Math.min(cardW - 4, cardH - 4));
    const heroIndex = [...this.ui.state.heroes].sort((a, b) => a.slot - b.slot).findIndex(candidate => candidate.id === hero.id);
    const cardY = this.left.y + 6 + Math.floor(Math.max(0, heroIndex) / 2) * (cardH + 7);
    const boardY = cardY + (cardH - boardSize) / 2;
    const trayTop = boardY + boardSize * .43, trayBottom = boardY + boardSize * .92;
    const y = Math.max(trayTop, Math.min(trayBottom - h, anchorY + anchor.size + 5));
    this.panelTexture(x, y, w, h);
    label.setPosition(x + 9, y + 6); this.addToRoot(label);
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
    const x = this.width * .26, y = this.height * .34, w = this.width * .48, h = this.height * .3;
    this.modalBackdrop(); this.panelTexture(x, y, w, h);
    this.titleText('Начать заново?', x + w / 2, y + 20, this.compactLayout ? 20 : 30, '#f0d18f', w - 24, .5);
    this.text('Текущий забег будет сброшен.', x + w / 2, y + 58, this.compactLayout ? 10 : 14, '#e0ceb1', undefined, .5);
    this.button('Сбросить', x + 12, y + h - 58, w / 2 - 18, 44, 'confirm-reset', '', true);
    this.button('Вернуться', x + w / 2 + 6, y + h - 58, w / 2 - 18, 44, 'cancel-reset');
  }

  private helpDialog(): void {
    const w = Math.min(this.width - 24, 570), h = Math.min(this.height - 24, 350);
    const x = (this.width - w) / 2, y = (this.height - h) / 2;
    this.modalBackdrop(); this.panelTexture(x, y, w, h);
    this.zones.push({ x: 0, y: 0, width: this.width, height: this.height, action: 'help' });
    this.titleText('Как играть', x + w / 2, y + h * .20, 24, '#f1d49f', w * .8, .5);
    const text = this.text('Вещи сражаются сами. Между боями перетаскивайте их в рюкзаки и поворачивайте правой кнопкой.\n\nПавший человек перерождается в куклу. Нажимайте на её карточку или спрайт, чтобы завести её: нужен действующий союзник.\n\nКуклы теряют прочность от ударов. Когда все окончательно погибнут, забег закончится. Оставленные на полу вещи пропадают при уходе.', x + w * .09, y + h * .28, 14, '#eadcc4', w * .82);
    if (text.height > h * .51) text.setScale(h * .51 / text.height);
    this.button('Понятно', x + 18, y + h - 56, w - 36, 44, 'help');
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
      this.text(`${Math.round(row.value * 100)}%`, trackX + trackW, rowY, font, '#f4e2c4', undefined, 1);
      const trackY = rowY + 29, trackH = 12;
      const bar = this.acquireGraphics();
      bar.fillStyle(0x160e17, 1).fillRoundedRect(trackX, trackY, trackW, trackH, 5);
      bar.lineStyle(1, 0xa98660, .9).strokeRoundedRect(trackX, trackY, trackW, trackH, 5);
      bar.fillStyle(row.muted ? 0x756c72 : 0xd3a15c, 1).fillRoundedRect(trackX + 2, trackY + 2, Math.max(0, (trackW - 4) * row.value), trackH - 4, 4);
      const knobX = trackX + 2 + (trackW - 4) * row.value;
      bar.fillStyle(0xf1d4a0, 1).fillCircle(knobX, trackY + trackH / 2, 7);
      bar.lineStyle(2, 0x694a39, 1).strokeCircle(knobX, trackY + trackH / 2, 7);
      this.addToRoot(bar);
      this.zones.push({ x: trackX, y: trackY - 14, width: trackW, height: 40, action: 'audio-volume', value: row.channel });
      this.button(row.muted ? 'Вкл.' : 'Выкл.', trackX + trackW + 18, rowY + 8, buttonW, 40, 'audio-mute', row.channel);
    });
    this.button('Готово', x + w * .20, y + h * .69, w * .60, Math.min(46, h * .13), 'options');
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
    const w = Math.min(this.width - 20, 660), h = Math.min(this.height - 20, hero.isPuppet ? 690 : 560), x = (this.width - w) / 2, y = (this.height - h) / 2;
    this.modalBackdrop(); this.panelTexture(x, y, w, h);
    this.zones.push({ x: 0, y: 0, width: this.width, height: this.height, action: 'close-hero-info' });
    this.titleText(hero.name, x + w / 2, y + h * .215, Math.min(26, h * .06), '#f1d49f', w * .76, .5).setOrigin(.5);
    const s = hero.attributes;
    const signed = (value: number): string => value >= 0 ? `+${value}` : `−${Math.abs(value)}`;
    const form = hero.isPuppet ? getPuppetForm(hero.puppetFormId) : undefined;
    const pending = hero.status === 'rebirthing' ? getPuppetForm(hero.pendingPuppetFormId) : undefined;
    const stateLabel = `${actorStatus[hero.status]}${form ? ` · ${form.name}` : pending ? ` · станет ${pending.name}` : ''}`;
    const stateText = this.text(stateLabel, x + w / 2, y + h * .25, 13, '#d9c7aa', w * .76, .5);
    if (stateText.width > w * .76) stateText.setScale(w * .76 / stateText.width);
    const left = x + w * .10, contentWidth = w * .80, gap = Math.max(14, w * .04), columnWidth = (contentWidth - gap) / 2;
    const rows = [
      { name: 'Сила', value: s.strength, effect: `Урон оружия ${signed(attributeModifier(s.strength) * 5)}%` },
      { name: 'Ловкость', value: s.dexterity, effect: `Перезарядка ${signed(-attributeModifier(s.dexterity) * 2)}%` },
      { name: 'Стойкость', value: s.constitution, effect: `Броня ${heroArmor(hero)}/${MAX_ARMOR} (стойкость ${signed(attributeModifier(s.constitution))})` },
      { name: 'Разум', value: s.intellect, effect: `Урон вещей ${signed(attributeModifier(s.intellect) * 5)}%` },
      { name: 'Воля', value: s.wisdom, effect: `Лечение ${signed(attributeModifier(s.wisdom) * 5)}%` },
      { name: 'Дух', value: s.presence, effect: `Подзавод ${signed(attributeModifier(s.presence) * 5)}%` },
    ];
    this.titleText('Характеристики', left, y + h * .29, Math.min(17, h * .038), '#e9ca91', contentWidth);
    rows.forEach((row, index) => {
      const col = index % 2, line = Math.floor(index / 2);
      const px = left + col * (columnWidth + gap), py = y + h * (.335 + line * .07);
      const font = Math.max(9, Math.min(15, h * .027));
      const name = this.text(row.name, px, py, font, '#f2e4ce');
      if (name.width > columnWidth * .56) name.setScale(columnWidth * .56 / name.width);
      const value = this.text(`${row.value} (${signed(attributeModifier(row.value))})`, px + columnWidth, py, font, '#f0d39e', undefined, 1);
      if (value.width > columnWidth * .42) value.setScale(columnWidth * .42 / value.width);
      const effect = this.text(row.effect, px, py + Math.max(13, h * .027), Math.max(8, font - 2), '#bdb1a7').setFontStyle('normal');
      if (effect.width > columnWidth) effect.setScale(columnWidth / effect.width);
    });
    if (form) {
      const formY = y + h * .56;
      this.titleText('Кукольная форма', left, formY, Math.min(17, h * .038), '#e9ca91', contentWidth);
      const detail = `${puppetBranchLabels[form.branch]}\nПрочность ${hero.durability}/${hero.maxDurability} · завод ${Math.ceil(hero.windUpCharge)}/${hero.maxWindUp} · броня ${form.armor}\nРасход ${form.windDrainPerSecond}/с · входящий урон ×${form.damageTakenMultiplier.toFixed(2)}\n\n${form.passiveName}: ${form.passiveDescription}\n${form.cellModifiers.map(cell => cell.label).join(' ')}`;
      const body = this.text(detail, left, formY + h * .04, Math.max(10, Math.min(14, h * .025)), '#e3d5c0', contentWidth).setFontStyle('normal');
      if (body.height > h * .19) body.setScale(h * .19 / body.height);
    } else if (pending) {
      const body = this.text(`Перерождение: ${pending.name}`, left, y + h * .57, 13, '#e3d5c0', contentWidth);
      if (body.width > contentWidth) body.setScale(contentWidth / body.width);
    }
    this.button('Закрыть', x + w * .20, y + h * .79, w * .60, Math.min(48, h * .10), 'close-hero-info');
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

  private itemImage(item: CombatItem, x: number, y: number, size: number): Phaser.GameObjects.Image {
    const id = item.definitionId ?? 'blade';
    const art = itemCatalog[id as keyof typeof itemCatalog] ?? CLASS_ITEM_ART.blade;
    const turns = ((item.rotation ?? 0) % 4 + 4) % 4;
    const frameWidth = turns % 2 ? art.content.height : art.content.width;
    const frameHeight = turns % 2 ? art.content.width : art.content.height;
    const scale = size / Math.max(frameWidth, frameHeight);
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
