import type Phaser from 'phaser';
import { INVENTORY_CELL_COUNT, INVENTORY_GRID_SIZE, inventoryColumn, inventoryRow, occupiedCells, rotatedShape } from '../combat/inventory.ts';
import { chooseHeroTarget, projectRoleIntent, type CombatEvent, type CombatItem, type Combatant, type EncounterState } from '../combat/simulation.ts';
import { ACTOR_ROWS, actorStateFrame, CLASS_ITEM_ART, type ActorSpriteId, type ActorSpriteState } from '../presentation/ArtCatalog.ts';
import { itemArtBounds } from '../presentation/itemGeometry.ts';
import type { GameUI } from './GameUI.ts';

export interface UIZone {
  x: number; y: number; width: number; height: number;
  action?: string; value?: string; itemId?: string; actorId?: string; heroId?: string; cell?: number; reward?: boolean; stash?: boolean;
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
const rarityLabels: Record<NonNullable<CombatItem['rarity']>, string> = { common: 'ОБЫЧНОЕ', uncommon: 'НЕОБЫЧНОЕ', rare: 'РЕДКОЕ', epic: 'МИФИЧЕСКОЕ', legendary: 'ЛЕГЕНДАРНОЕ' };
const categoryLabels: Record<NonNullable<CombatItem['category']>, string> = { weapon: 'ОРУЖИЕ', protection: 'ЗАЩИТА', jewelry: 'УКРАШЕНИЕ', relic: 'РЕЛИКВИЯ', tool: 'ИНСТРУМЕНТ', consumable: 'РАСХОДНИК', ammo: 'БОЕПРИПАС' };
function itemRarityTint(rarity: CombatItem['rarity']): number {
  const tier = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 }[rarity ?? 'common'];
  return rarityTints[tier]!;
}
const portraitFrames: Record<string, number> = { 'hero-1': 0, 'hero-2': 1, 'hero-3': 2, 'hero-4': 3 };
const actorStatus: Record<Combatant['status'], string> = { human: 'Человек', enemy: 'Враг', rebirthing: 'Перерождение', stopped: 'Кукла остановлена', active: 'Кукла заведена', dead: 'Погиб' };

/** All visible UI is drawn to Phaser's Canvas; input zones share these exact bounds. */
export class PhaserHUD {
  readonly zones: UIZone[] = [];
  private root: Phaser.GameObjects.Container;
  private actorLayer: Phaser.GameObjects.Container;
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
  private windAnimations = new Map<string, { from: number; to: number; until: number }>();
  private consumedSequence = 0;
  private lastShakeAt = 0;
  private encounterState: EncounterState;

  constructor(private readonly scene: Phaser.Scene, private readonly ui: GameUI) {
    this.root = scene.add.container(0, 0);
    this.actorLayer = scene.add.container(0, 0);
    this.root.add(this.actorLayer);
    this.encounterState = ui.state;
    scene.events.once('shutdown', () => {
      this.actorViews.clear(); this.pendingActorEvents = [];
      this.actorLayer.destroy();
    });
  }

  zoneAt(x: number, y: number): UIZone | undefined { return [...this.zones].reverse().find(zone => x >= zone.x && y >= zone.y && x <= zone.x + zone.width && y <= zone.y + zone.height); }

  draw(pointerX: number, pointerY: number, drag?: DragPreview): void {
    this.width = this.scene.scale.width; this.height = this.scene.scale.height; this.now = performance.now();
    if (this.encounterState !== this.ui.state) {
      this.encounterState = this.ui.state;
      this.clearTransientPresentation();
    }
    this.hover = this.zoneAt(pointerX, pointerY);
    for (const child of [...this.root.list]) if (child !== this.actorLayer) child.destroy();
    this.actorLayer.setVisible(false);
    this.zones.length = 0; this.cells.clear();
    if (this.ui.run.stage === 'opening') {
      this.openingModal();
      return;
    }
    if (this.ui.run.stage !== 'battle') this.pendingActorEvents = [];
    const compact = this.width < 820;
    this.layout(compact);
    this.consumePresentationEvents();
    this.background(); this.header(); this.party(); this.room(drag);
    if (!drag) this.itemSpeech();
    if (drag) this.drawDrag(drag);
    if (this.ui.confirmReset) this.resetDialog();
    if (this.hover?.itemId && !drag) this.tooltip(this.itemById(this.hover.itemId));
    else if (this.hover?.actorId && !drag) this.actorTooltip(this.ui.state.heroes.find(actor => actor.id === this.hover?.actorId) ?? this.ui.state.enemies.find(actor => actor.id === this.hover?.actorId));
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
    this.consumedSequence = 0;
    this.lastShakeAt = this.now;
    this.hover = undefined;
    this.zones.length = 0;
    this.cells.clear();
    this.scene.cameras.main.resetFX();
  }

  private layout(compact: boolean): void {
    const margin = Math.max(5, Math.round(this.width * .007));
    const head = compact ? 32 : Math.max(36, this.height * .045);
    const y = head + margin;
    const roomHeight = this.height - y - margin;
    if (compact) {
      const partyH = Math.floor(roomHeight * .59);
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
        if (target) this.windAnimations.set(target.id, { from: Math.max(0, target.wind - event.amount), to: target.wind, until: this.now + 260 });
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
  }

  private background(): void {
    const g = this.scene.add.graphics();
    g.fillStyle(0x171414, 1).fillRect(0, 0, this.width, this.height);
    g.lineStyle(1, 0x362b2c, .22);
    for (let diagonal = -this.height; diagonal < this.width; diagonal += 13) g.lineBetween(diagonal, 0, diagonal + this.height, this.height);
    for (const panel of [this.left, this.right]) {
      g.fillStyle(0x292329, 1).fillRoundedRect(panel.x, panel.y, panel.width, panel.height, 6);
      g.lineStyle(2, 0x80664f, .95).strokeRoundedRect(panel.x, panel.y, panel.width, panel.height, 6);
      g.lineStyle(1, 0x493941, .9).strokeRoundedRect(panel.x + 4, panel.y + 4, panel.width - 8, panel.height - 8, 4);
      const s = 10, x = panel.x, y = panel.y, w = panel.width, h = panel.height;
      g.lineStyle(2, 0xb28a5e, .95);
      for (const [cx, cy, dx, dy] of [[x+4,y+4,1,1],[x+w-4,y+4,-1,1],[x+4,y+h-4,1,-1],[x+w-4,y+h-4,-1,-1]] as const) {
        g.lineBetween(cx, cy, cx + dx * s, cy); g.lineBetween(cx, cy, cx, cy + dy * s);
      }
    }
    this.root.add(g);
    const ornamentSize = Math.min(this.width < 820 ? 34 : 64, this.left.width * .08, this.left.height * .09);
    this.frameCorners(this.left.x, this.left.y, this.left.width, this.left.height, ornamentSize, .9);
    this.frameCorners(this.right.x, this.right.y, this.right.width, this.right.height, ornamentSize, .9);
  }

  private text(value: string, x: number, y: number, size = 14, color = '#f3e5cc', maxWidth?: number, originX = 0): Phaser.GameObjects.Text {
    const text = this.scene.add.text(x, y, value, { fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'bold', fontSize: `${Math.round(size)}px`, color, resolution: 1,
      stroke: '#171414', strokeThickness: size < 12 ? 1 : 2, wordWrap: maxWidth ? { width: maxWidth } : undefined });
    text.setOrigin(originX, 0); this.root.add(text); return text;
  }

  private titleText(value: string, x: number, y: number, size: number, color: string, maxWidth?: number, originX = 0): Phaser.GameObjects.Text {
    const text = this.scene.add.text(x, y, value, { fontFamily: '"Woundbound Title", Georgia, serif', fontStyle: 'bold', fontSize: `${Math.round(size)}px`, color,
      resolution: 2, stroke: '#171414', strokeThickness: 2 });
    text.setOrigin(originX, 0);
    if (maxWidth && text.width > maxWidth) text.setScale(maxWidth / text.width);
    this.root.add(text); return text;
  }

  private button(label: string, x: number, y: number, width: number, height: number, action: string, value = '', primary = false): void {
    const hot = this.hover?.action === action && this.hover.value === value;
    const g = this.scene.add.graphics();
    if (hot) {
      g.fillStyle(primary ? 0xffd47a : 0xc19a68, .2).fillRoundedRect(x - 3, y - 3, width + 6, height + 6, 7);
    }
    g.fillStyle(primary ? (hot ? 0xa77a3d : 0x74552f) : (hot ? 0x514337 : 0x372e2c), 1).fillRoundedRect(x, y, width, height, 5);
    g.lineStyle(hot ? 2 : primary ? 2 : 1, primary ? (hot ? 0xffe4a2 : 0xe7bf72) : (hot ? 0xe0bd88 : 0x8a755c), 1).strokeRoundedRect(x, y, width, height, 5); this.root.add(g);
    if (label === '↻') this.text(label, x + width / 2, y + Math.max(3, (height - 20) / 2), Math.min(15, height * .43), hot ? '#ffffff' : '#fff0d4', width - 8, .5);
    else {
      const caption = this.titleText(label, x + width / 2, y + height / 2, Math.min(21, height * .6), hot ? '#ffffff' : '#fff0d4', width - 12, .5);
      caption.setOrigin(.5, .5);
    }
    this.zones.push({ x, y, width, height, action, value });
  }

  private header(): void {
    const stageName = this.ui.run.stage === 'victory' ? 'МЕХАНИЗМ СУДЬБЫ ОДОЛЁН' : this.ui.run.stage === 'defeat' ? 'ПОСЛЕДНИЙ ЗАВОД ОСТАНОВЛЕН' : `АКТ ${Math.min(3, Math.ceil(this.ui.run.room / 3))} · СПУСК ${this.ui.run.room}/10`;
    if (this.ui.run.stage !== 'opening') this.text(stageName, this.left.x, 8, Math.min(16, this.height * .022), '#dfc79e');
    if (this.ui.run.stage !== 'opening') this.button('↻', this.width - 42 - this.left.x, 5, 36, this.height < 600 ? 28 : 34, 'restart');
    if (this.ui.paused) this.text('ПАУЗА', this.width / 2, 8, 16, '#e8bd72', undefined, .5);
  }

  private party(): void {
    const g = this.scene.add.graphics(); this.root.add(g);
    const heroes = [...this.ui.state.heroes].sort((a, b) => a.slot - b.slot);
    const gap = 7, footerH = this.ui.selectedItem ? (this.width < 820 ? 26 : 31) : 0;
    const cardW = (this.left.width - 12 - gap) / 2, cardH = (this.left.height - 12 - gap - footerH) / 2;
    const pad = Math.max(12, Math.min(16, cardW * .035));
    const compact = this.width < 820;
    const headerH = compact ? 86 : 128;
    const cell = Math.max(1, Math.floor(Math.min((cardW - pad * 2) / INVENTORY_GRID_SIZE, (cardH - headerH - 16) / INVENTORY_GRID_SIZE)));
    for (let h = 0; h < heroes.length; h++) {
      const hero = heroes[h]!;
      const x = this.left.x + 6 + (h % 2) * (cardW + gap), y = this.left.y + 6 + Math.floor(h / 2) * (cardH + gap);
      const stopped = hero.status === 'stopped';
      const pulse = stopped ? .76 + .14 * (Math.sin(this.now / 125) + 1) / 2 : 1;
      const frameColor = stopped ? 0x929397 : hero.status === 'active' ? 0xd5aa68 : hero.status === 'dead' ? 0x76545c : 0xc19a78;
      const cardFill = stopped ? 0x343438 : hero.status === 'active' ? 0x382b30 : hero.status === 'human' ? 0x30283a : 0x28232b;
      const engravingColor = stopped ? 0xb9b9bc : 0xf4d8ad;
      const rivetColor = stopped ? 0xa5a5a8 : 0xf0cf9b;
      g.fillStyle(0x120f16, .65).fillRoundedRect(x, y + 2, cardW, cardH, 5);
      g.fillStyle(cardFill, 1).fillRoundedRect(x, y, cardW, cardH, 5);
      g.fillStyle(stopped ? 0x626267 : hero.status === 'human' ? 0x776080 : 0x5b4754, stopped ? .24 : .2).fillRoundedRect(x + 4, y + 4, cardW - 8, headerH - 4, 4);
      // Layered iron and brass bevels make each card read as a framed portrait plate.
      g.lineStyle(5, 0x17131a, .98).strokeRoundedRect(x, y, cardW, cardH, 5);
      g.lineStyle(2.5, frameColor, pulse).strokeRoundedRect(x + 1, y + 1, cardW - 2, cardH - 2, 5);
      g.lineStyle(1, engravingColor, .62).strokeRoundedRect(x + 4, y + 4, cardW - 8, cardH - 8, 4);
      g.lineStyle(1, 0x785d55, .7).lineBetween(x + 8, y + headerH, x + cardW - 8, y + headerH);
      // Short engraved corner brackets and rivets give the card a crafted metal frame.
      const corner = 11;
      g.lineStyle(1.5, frameColor, .88);
      for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const cx = sx > 0 ? x + 7 : x + cardW - 7, cy = sy > 0 ? y + 7 : y + cardH - 7;
        g.lineBetween(cx, cy + sy * corner, cx, cy);
        g.lineBetween(cx, cy, cx + sx * corner, cy);
        g.fillStyle(rivetColor, .7).fillCircle(cx, cy, 1.5);
      }
      this.frameCorners(x, y, cardW, cardH, Math.min(compact ? 28 : 46, cardW * .11), stopped ? .7 : 1);
      const iconSize = Math.min(compact ? 64 : 104, headerH - pad * 2);
      const isDoll = hero.status === 'active' || hero.status === 'stopped';
      const portraitPlate = this.scene.add.graphics();
      portraitPlate.fillStyle(0x110e15, .9).fillRect(x + pad - 4, y + pad - 4, iconSize + 8, iconSize + 8);
      portraitPlate.lineStyle(4, 0x19151c, 1).strokeRect(x + pad - 3, y + pad - 3, iconSize + 6, iconSize + 6);
      portraitPlate.lineStyle(2, frameColor, .98).strokeRect(x + pad - 2, y + pad - 2, iconSize + 4, iconSize + 4);
      portraitPlate.lineStyle(1, stopped ? 0xbdbdc0 : 0xffe5bd, .72).strokeRect(x + pad, y + pad, iconSize, iconSize);
      for (const [rx, ry] of [[-1, -1], [iconSize + 1, -1], [-1, iconSize + 1], [iconSize + 1, iconSize + 1]])
        portraitPlate.fillStyle(stopped ? 0xa8a8ab : 0xe4c18a, .84).fillCircle(x + pad + rx, y + pad + ry, 1.7);
      this.root.add(portraitPlate);
      this.actorImage(hero.id, x + pad + iconSize / 2, y + pad + iconSize / 2, iconSize, hero.status);
      if (isDoll) {
        const gearX = x + pad + iconSize - 1, gearY = y + pad + 10;
        const gear = this.scene.add.graphics();
        gear.fillStyle(0x241b19, 1).fillCircle(gearX, gearY, 9);
        const gearColor = stopped ? 0x929397 : 0xf0bd64;
        gear.lineStyle(1, gearColor, 1).strokeCircle(gearX, gearY, 9);
        gear.lineStyle(2, gearColor, 1);
        for (let tooth = 0; tooth < 8; tooth++) {
          const angle = tooth * Math.PI / 4;
          gear.lineBetween(gearX + Math.cos(angle) * 4, gearY + Math.sin(angle) * 4,
            gearX + Math.cos(angle) * 7, gearY + Math.sin(angle) * 7);
        }
        gear.strokeCircle(gearX, gearY, 3);
        this.root.add(gear);
      }
      const nameX = x + pad + iconSize + 8, nameW = Math.max(36, cardW - (nameX - x) - pad);
      this.titleText(hero.name, nameX, y + pad, compact ? 15 : 24, stopped ? '#d5d5d8' : '#fff2d9', nameW);
      const statusLabel = hero.status === 'human' ? 'ЖИВОЙ'
        : hero.status === 'active' ? 'ЗАВЕДЕНА'
        : hero.status === 'stopped' ? 'НУЖЕН ЗАВОД'
        : hero.status === 'rebirthing' ? 'ВОЗВРАТ'
        : 'ПОГИБ';
      const statusColor = hero.status === 'human' ? 0x9a4050 : hero.status === 'active' ? 0x796137 : hero.status === 'stopped' ? 0x5c6068 : 0x49333b;
      const statusY = y + pad + (compact ? 20 : 29);
      let statusFontSize = Math.max(4, Math.round(Math.min(compact ? 8 : 10, (nameW - 12) / (statusLabel.length * .68))));
      const statusText = this.scene.add.text(nameX + 5, statusY + 1, statusLabel, {
        fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'bold', fontSize: statusFontSize,
        color: stopped ? '#e1e1e3' : '#f5e4c6', resolution: 1, stroke: '#171414', strokeThickness: 1,
      }).setOrigin(0, 0);
      while (statusText.width + 12 > nameW && statusFontSize > 4) statusText.setFontSize(--statusFontSize);
      const statusWidth = Math.min(nameW, Math.ceil(statusText.width + 12));
      const statusPlate = this.scene.add.graphics();
      statusPlate.fillStyle(statusColor, .85).fillRoundedRect(nameX, statusY, statusWidth, compact ? 13 : 17, 4);
      statusPlate.lineStyle(1, stopped ? 0xaaaab0 : 0xcba56e, .75).strokeRoundedRect(nameX, statusY, statusWidth, compact ? 13 : 17, 4);
      this.root.add(statusPlate);
      this.root.add(statusText);
      const detailY = y + pad + (compact ? 38 : 51);
      const detailColor = stopped ? '#b9b9bd' : hero.status === 'active' ? '#e8c680' : '#ded0c5';
      if (hero.status === 'human') {
        this.cardGlyph('heart', nameX + 5, detailY + 7, 0xe95d68);
        this.text(`${Math.ceil(hero.hp)} / ${hero.maxHp}`, nameX + 16, detailY, compact ? 9 : 11, '#ffe1d7', nameW - 16);
      } else if (hero.status === 'stopped' || hero.status === 'active') {
        this.cardGlyph('gear', nameX + 5, detailY + 7, stopped ? 0x99999d : 0xe2aa5e);
        this.text(`${Math.ceil(hero.durability)}/${hero.maxDurability}`, nameX + 15, detailY, compact ? 8 : 10, detailColor, Math.max(40, nameW * .48));
        this.cardGlyph('key', nameX + nameW * .53 + 4, detailY + 7, stopped ? 0x99999d : 0x70c6d6);
        this.text(`${Math.ceil(hero.wind)}/${hero.maxWind}`, nameX + nameW * .53 + 13, detailY, compact ? 8 : 10, stopped ? '#b9b9bd' : '#a6e3e7', nameW * .47);
      } else if (hero.status === 'rebirthing') this.text(`ВОЗВРАЩЕНИЕ · ${(hero.rebirthMs / 1000).toFixed(1)}с`, nameX, detailY, compact ? 8 : 10, '#e4bd76', nameW);
      else this.text('ПОГИБ', nameX, detailY, compact ? 9 : 11, '#c4a9aa', nameW);
      const meterY = y + pad + (compact ? 55 : 74), meterH = compact ? 4 : 6;
      if (hero.status === 'human') this.meter(nameX, meterY, nameW, meterH, hero.hp, hero.maxHp, '', 0xed5e67);
      else if (hero.status === 'stopped' || hero.status === 'active') {
        this.meter(nameX, meterY, nameW, meterH, hero.durability, hero.maxDurability, '', stopped ? 0x858589 : 0xd4924d);
        const animation = this.windAnimations.get(hero.id);
        const shownWind = animation ? animation.from + (animation.to - animation.from) * Math.min(1, 1 - Math.max(0, animation.until - this.now) / 260) : hero.wind;
        this.meter(nameX, meterY + (compact ? 6 : 9), nameW, meterH, shownWind, hero.maxWind, '', stopped ? 0xaaa9ad : 0x65c7ce);
      } else if (hero.status === 'rebirthing') this.meter(nameX, meterY, nameW, meterH, 6000 - hero.rebirthMs, 6000, '', 0xd8a858);
      const gridX = x + (cardW - INVENTORY_GRID_SIZE * cell) / 2;
      const gridY = y + headerH + (cardH - headerH - INVENTORY_GRID_SIZE * cell) / 2;
      const itemOrigins: CombatItem[] = [];
      for (let i = 0; i < INVENTORY_CELL_COUNT; i++) {
        const cx = gridX + inventoryColumn(i) * cell, cy = gridY + inventoryRow(i) * cell;
        const item = hero.items.find(candidate => occupiedCells(candidate, candidate.cell ?? 0)?.includes(i));
        const occupied = item ? occupiedCells(item, item.cell ?? 0) : null;
        const isOrigin = item && occupied?.[0] === i;
        g.fillStyle(stopped ? (item ? 0x3e3e42 : 0x29292d) : (item ? 0x493543 : 0x272330), 1).fillRect(cx, cy, cell - 1, cell - 1);
        g.fillStyle(stopped ? (item ? 0x646469 : 0x4b4b50) : (item ? 0x77535a : 0x403547), stopped ? .16 : .2).fillRect(cx + 1, cy + 1, cell - 3, Math.max(2, cell * .22));
        g.lineStyle(1, stopped ? (item ? 0x77777b : 0x66666a) : (item ? 0x9b7566 : 0x74677e), item ? .62 : .78).strokeRect(cx + .5, cy + .5, cell - 2, cell - 2);
        g.lineStyle(1, stopped ? 0xc0c0c2 : 0xe6cda9, stopped ? .12 : .2).lineBetween(cx + 3, cy + 2, cx + cell - 4, cy + 2);
        // Restrained scratches add worn paper grain without making each cell noisy.
        for (let speck = 0; speck < 5; speck++) {
          const px = cx + 4 + ((i * 7 + hero.slot * 11 + speck * 13) % Math.max(4, cell - 8));
          const py = cy + 5 + ((i * 3 + hero.slot * 5 + speck * 9) % Math.max(4, cell - 10));
          g.fillStyle(stopped ? (speck % 2 ? 0xb1b1b4 : 0x99999d) : (speck % 2 ? 0xb9a2c0 : 0xd0b28d), speck === 2 ? .2 : .11).fillRect(px, py, speck === 3 ? 2 : 1, 1);
        }
        this.zones.push({ x: cx, y: cy, width: cell, height: cell, action: 'cell', value: `${hero.id}:${i}`, heroId: hero.id, cell: i,
          itemId: item && occupied?.includes(i) ? item.id : undefined });
        this.cells.set(`${hero.id}:${i}`, { x: cx, y: cy, size: cell });
        if (item && occupied?.includes(i) && isOrigin) itemOrigins.push(item);
      }
      const texture = this.scene.add.image(gridX + INVENTORY_GRID_SIZE * cell / 2, gridY + INVENTORY_GRID_SIZE * cell / 2, 'ui-inventory-texture')
        .setDisplaySize(INVENTORY_GRID_SIZE * cell, INVENTORY_GRID_SIZE * cell).setAlpha(stopped ? .11 : .2);
      this.root.add(texture);
      const crispGrid = this.scene.add.graphics();
      crispGrid.lineStyle(1, stopped ? 0xb3b3b8 : 0xb79a9e, stopped ? .42 : .57);
      for (let row = 0; row < INVENTORY_GRID_SIZE; row++) for (let column = 0; column < INVENTORY_GRID_SIZE; column++) {
        const cx = gridX + column * cell, cy = gridY + row * cell;
        crispGrid.strokeRect(cx + .5, cy + .5, cell - 1, cell - 1);
        crispGrid.lineStyle(1, stopped ? 0xe2e2e4 : 0xf3d5b4, stopped ? .12 : .2).lineBetween(cx + 2, cy + 2, cx + cell - 3, cy + 2);
        crispGrid.lineStyle(1, stopped ? 0xb3b3b8 : 0xb79a9e, stopped ? .42 : .57);
      }
      this.root.add(crispGrid);
      // Draw sprites only after every cell and grid line so the grid cannot cut through art.
      for (const item of itemOrigins) this.drawItem(item, gridX, gridY, cell, stopped);
      if (stopped && this.ui.state.phase === 'combat') {
        this.text('↻', x + cardW - pad - 14, y + pad + 1, compact ? 16 : 22, '#a8a8ab');
        this.zones.push({ x, y, width: cardW, height: headerH, action: 'wind', value: hero.id, actorId: hero.id });
      }
    }
    const rotateY = this.left.y + this.left.height - (compact ? 24 : 30);
    if (this.ui.selectedItem) {
      this.button('Повернуть ↻', this.left.x + 8, rotateY, compact ? 80 : 112, compact ? 22 : 28, 'rotate');
      this.button('В запас', this.left.x + (compact ? 94 : 122), rotateY, compact ? 64 : 82, compact ? 22 : 28, 'store', this.ui.selectedItem);
    }
  }

  private cardGlyph(kind: 'heart' | 'gear' | 'key', x: number, y: number, color: number): void {
    const g = this.scene.add.graphics();
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
    this.root.add(g);
  }

  private drawItem(item: CombatItem, gridX: number, gridY: number, cell: number, muted = false): void {
    const cells = rotatedShape(item);
    const anchorX = gridX + inventoryColumn(item.cell ?? 0) * cell, anchorY = gridY + inventoryRow(item.cell ?? 0) * cell;
    const frame = itemFrames[item.definitionId ?? 'blade'] ?? 0;
    const footprint = cells.map(([dx, dy]) => ({ x: anchorX + dx * cell, y: anchorY + dy * cell }));
    const plate = this.scene.add.graphics();
    const rarityTint = muted ? 0x77777b : itemRarityTint(item.rarity);
    for (const position of footprint) {
      plate.fillStyle(rarityTint, .46).fillRect(position.x, position.y, cell, cell);
      plate.fillStyle(0x211b22, .34).fillRect(position.x + 1, position.y + 1, cell - 2, cell - 2);
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
    this.root.add(plate);
    const art = itemCatalog[item.definitionId as keyof typeof itemCatalog] ?? CLASS_ITEM_ART.blade;
    const image = this.scene.add.image(0, 0, itemAtlases[item.definitionId ?? ''] ?? 'items-guard', frame);
    if (muted) image.setTint(0xb0b0b3);
    const turns = ((item.rotation ?? 0) % 4 + 4) % 4;
    const oddTurn = turns % 2 === 1;
    const artWidth = oddTurn ? art.content.height : art.content.width;
    const artHeight = oddTurn ? art.content.width : art.content.height;
    const bounds = itemArtBounds(cells, anchorX, anchorY, cell, artWidth, artHeight);
    const { centerX, centerY } = bounds;
    const inset = Math.max(2, cell * .09);
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
    this.root.add(image);
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
      const g = this.scene.add.graphics();
      const trackX = anchorX + barStart * cell + 2, trackY = anchorY + (bottomY + 1) * cell - 5, trackWidth = Math.max(4, barLength * cell - 4);
      g.fillStyle(0x211b1b, 1).fillRect(trackX, trackY, trackWidth, 3);
      g.fillStyle(muted ? 0x96969a : anticipation ? 0xffd37b : 0xe5b75f, 1).fillRect(trackX, trackY, trackWidth * cooldown, 3);
      this.root.add(g);
    }
  }

  private meter(x: number, y: number, width: number, height: number, value: number, max: number, label: string, color: number): void {
    const g = this.scene.add.graphics();
    g.fillStyle(0x191719, 1).fillRoundedRect(x, y, width, height, 3);
    g.fillStyle(color, 1).fillRoundedRect(x, y, width * Math.max(0, Math.min(1, value / Math.max(1, max))), height, 3); this.root.add(g);
    if (label) this.text(label, x, y - (this.width < 820 ? 10 : 14), this.width < 820 ? 7 : 10, '#f0ddbd', width);
  }

  private room(drag?: DragPreview): void {
    const run = this.ui.run, state = this.ui.state;
    const title = run.stage === 'victory' ? 'Архонт повержен' : run.stage === 'defeat' ? 'Завод остановлен' : run.stage === 'reward' ? 'Трофеи из пепла' : run.stage === 'cleared' ? 'Тишина после боя' : run.stage === 'route' ? 'Выберите следующий след' : run.stage === 'cache' ? 'Забытый тайник' : run.stage === 'workshop' ? 'Часовая мастерская' : run.stage === 'event' ? 'Лазарет забытого братства' : run.roomLabel;
    if (run.stage !== 'opening') this.titleText(title, this.right.x + 8, this.right.y + 4, this.width < 820 ? 16 : 23, '#f2d39a', this.right.width - 16);
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
    const background = this.scene.add.image(this.width / 2, this.height / 2,
      this.height > this.width ? 'ui-opening-portrait' : 'ui-opening-desktop');
    const scale = Math.max(this.width / background.width, this.height / background.height);
    background.setScale(scale);
    this.root.add(background);
    const w = Math.min(this.width - 28, 600, (this.height - 28) * 3), h = w / 3;
    const x = (this.width - w) / 2, y = (this.height - h) / 2;
    const hot = this.hover?.action === 'begin-run';
    const glow = this.scene.add.graphics();
    glow.fillStyle(0xe3a64c, hot ? .14 : .06).fillEllipse(this.width / 2, this.height / 2, w * .9, h * .8);
    this.root.add(glow);
    const plate = this.scene.add.image(this.width / 2, this.height / 2, 'ui-descent-button').setDisplaySize(w, h);
    if (hot) plate.setTint(0xffe3b2);
    this.root.add(plate);
    const size = Math.round(Math.min(54, w * .092));
    const label = this.scene.add.text(this.width / 2, y + h / 2 - 4, 'Начать спуск', {
      fontFamily: '"Woundbound Title", Georgia, serif', fontStyle: 'bold', fontSize: `${size}px`,
      color: '#F2E6D5', stroke: '#2b130f', strokeThickness: 3, resolution: 2,
      shadow: { offsetX: 0, offsetY: 2, color: 'rgba(26, 13, 8, 0.75)', blur: 3, fill: true },
    }).setOrigin(.5);
    if (label.width > w * .65) label.setScale(w * .65 / label.width);
    this.root.add(label);
    this.zones.push({ x, y, width: w, height: h, action: 'begin-run', value: '' });
  }

  private roomBackdrop(dim: boolean): void {
    const g = this.scene.add.graphics();
    g.fillStyle(0x211d27, 1).fillRoundedRect(this.field.x, this.field.y, this.field.width, this.field.height, 4);
    this.root.add(g);
    const label = this.ui.run.roomLabel.toLocaleLowerCase('ru');
    const location = label.includes('крыс') ? (this.ui.run.room === 1 ? 'location-rat-catacombs' : 'location-cave')
      : label.includes('культист') ? 'location-cult-base'
      : label.includes('автоматон') ? 'location-clockwork-foundry'
      : 'battlefield';
    const bg = this.scene.add.image(this.field.x + this.field.width / 2, this.field.y + this.field.height / 2, location);
    const source = this.scene.textures.get(location).getSourceImage() as HTMLImageElement;
    const targetRatio = this.field.width / this.field.height, sourceRatio = source.width / source.height;
    if (sourceRatio > targetRatio) {
      const cropWidth = source.height * targetRatio;
      bg.setCrop((source.width - cropWidth) / 2, 0, cropWidth, source.height).setScale(this.field.height / source.height);
    } else {
      const cropHeight = source.width / targetRatio;
      bg.setCrop(0, (source.height - cropHeight) / 2, source.width, cropHeight).setScale(this.field.width / source.width);
    }
    this.root.add(bg);
    if (dim) {
      const shade = this.scene.add.graphics();
      shade.fillStyle(0x17141b, .7).fillRect(this.field.x, this.field.y, this.field.width, this.field.height);
      this.root.add(shade);
    }
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
    const heroFormation = new Map<string, { lane: 'front' | 'rear' | 'flank'; rank: number; count: number }>();
    const laneCounts = { front: 0, rear: 0, flank: 0 };
    for (const hero of [...this.ui.state.heroes].sort((a, b) => a.slot - b.slot)) {
      const lane = projectRoleIntent(hero, enemyTarget).lane;
      heroFormation.set(hero.id, { lane, rank: laneCounts[lane]++, count: 0 });
    }
    for (const slot of heroFormation.values()) slot.count = laneCounts[slot.lane];
    const positions = new Map<string, { x: number; y: number; scale: number; actor: Combatant; hero: boolean; index: number }>();
    const actorPosition = (actor: Combatant, hero: boolean, index: number): { x: number; y: number; scale: number } => {
      const intent = projectRoleIntent(actor, enemyTarget);
      const formation = hero ? heroFormation.get(actor.id) : undefined;
      const depth = hero ? (intent.lane === 'front' ? .74 : intent.lane === 'flank' ? .56 : .49) : .38 + Math.floor(index / 2) * .28 + (index % 2) * .12;
      const baseY = ground.top + (ground.bottom - ground.top) * Math.max(.08, Math.min(.95, depth));
      let x = hero
        ? ground.left + (ground.right - ground.left) * (intent.lane === 'front' ? .55 + ((formation?.rank ?? 0) - ((formation?.count ?? 1) - 1) / 2) * .1 : intent.lane === 'rear' ? .34 + ((formation?.rank ?? 0) - ((formation?.count ?? 1) - 1) / 2) * .12 : .16)
        : ground.right - (ground.right - ground.left) * (.2 + (index % 2) * .15 + Math.floor(index / 2) * .04);
      let y = baseY + (hero ? ((formation?.rank ?? 0) - ((formation?.count ?? 1) - 1) / 2) * this.field.height * .035 : 0);
      if (hero && intent.lane === 'flank' && enemyTarget) {
        const activeRogue = action?.actorId === actor.id;
        x = activeRogue ? ground.right - (ground.right - ground.left) * .32 : ground.left + (ground.right - ground.left) * .16;
        y = activeRogue ? ground.top + (ground.bottom - ground.top) * .72 : ground.top + (ground.bottom - ground.top) * .49;
      }
      const lunge = action?.actorId === actor.id && (actor.reach ?? 'near') === 'near' ? (hero ? 1 : -1) * this.field.width * .085 * Math.sin(Math.PI * (1 - (this.ui.highlightUntil - now) / 700)) : 0;
      return { x: Math.max(ground.left, Math.min(ground.right, x + lunge)), y: Math.max(ground.top, Math.min(ground.bottom, y)), scale: .76 + (baseY - ground.top) / Math.max(1, ground.bottom - ground.top) * .44 };
    };
    const units = [...this.ui.state.heroes.map((actor, index) => ({ actor, hero: true, index })), ...this.ui.state.enemies.map((actor, index) => ({ actor, hero: false, index }))];
    for (const unit of units) {
      const position = actorPosition(unit.actor, unit.hero, unit.index);
      positions.set(unit.actor.id, { ...position, actor: unit.actor, hero: unit.hero, index: unit.index });
    }
    this.root.bringToTop(this.actorLayer);
    this.actorLayer.setVisible(true);
    const visibleActors = new Set<string>();
    const ordered = [...positions.values()].sort((a, b) => a.y - b.y);
    for (const position of ordered) {
      const { actor, hero, x, y, scale } = position;
      const artSize = Math.min(this.width < 820 ? 132 : 220, this.field.height * (this.width < 820 ? .4 : .39)) * scale;
      const sprite = actor.side === 'hero' ? actor.id : actor.isBoss ? 'boss' : actor.name.includes('крыса') ? 'rat' : actor.name.includes('Культист') ? 'cultist' : 'automaton';
      visibleActors.add(actor.id);
      const view = this.getActorView(actor, sprite);
      this.syncActorPose(actor, view, now);
      const actorSeed = [...actor.id].reduce((sum, character) => sum + character.charCodeAt(0), 0);
      const positionPhase = (x / Math.max(1, this.width)) * (y / Math.max(1, this.height)) * Math.PI * 5;
      view.motion.y = actor.status === 'dead' ? 0 : -0.8 - 0.8 * Math.sin(now / 360 + positionPhase + actorSeed * 0.17);
      view.container.setPosition(x, y).setDepth(y);
      if (Math.abs(view.size - artSize) > .5) {
        view.body.setDisplaySize(artSize, artSize);
        view.size = artSize;
      }
      // Hero sheets face right; enemy sheets are authored facing left toward the party.
      view.body.setFlipX(actor.side === 'enemy');
      view.shadow.clear().fillStyle(0x09090c, .34).fillEllipse(0, artSize * .43, artSize * .62, artSize * .16);
      view.meter.clear().fillStyle(0x191719, .95).fillRoundedRect(-artSize * .42, artSize * .45, artSize * .84, this.width < 820 ? 5 : 7, 3);
      const current = actor.status === 'active' || actor.status === 'stopped' || actor.status === 'dead' ? actor.durability : actor.hp;
      const max = actor.status === 'active' || actor.status === 'stopped' || actor.status === 'dead' ? actor.maxDurability : actor.maxHp;
      view.meter.setVisible(actor.status !== 'rebirthing' && actor.status !== 'dead');
      view.meter.fillStyle(hero ? 0x79c36b : 0xe05b59, 1).fillRoundedRect(-artSize * .42, artSize * .45, artSize * .84 * Math.max(0, Math.min(1, current / Math.max(1, max))), this.width < 820 ? 5 : 7, 3);
      view.body.setAlpha(actor.status === 'dead' ? .56 : actor.status === 'rebirthing' ? .78 : 1);
      const rogueFading = hero && actor.role === 'rogue' && action?.actorId === actor.id;
      if (actor.status === 'stopped') view.body.setTint(0xe6e6e8);
      else if (action?.actorId === actor.id) view.body.setTint(0xffe0a0);
      else if (action?.targetId === actor.id) view.body.setTint(0xff9a84);
      else view.body.clearTint();
      if (rogueFading) view.body.setAlpha(.45 + .35 * Math.abs(Math.sin(now / 110)));
      view.label.setText(actor.isBoss ? actor.name : '').setVisible(Boolean(actor.isBoss)).setPosition(0, -artSize * .78);
      view.key.clear();
      const doll = actor.status === 'active' || actor.status === 'stopped';
      view.key.setVisible(doll);
      if (doll) {
        view.key.lineStyle(2, actor.status === 'stopped' ? 0x96969a : 0xf0bd64, 1)
          .strokeCircle(-4, -artSize * .34, Math.max(3, artSize * .065))
          .lineBetween(-1, -artSize * .34, artSize * .13, -artSize * .34)
          .lineBetween(artSize * .04, -artSize * .34, artSize * .04, -artSize * .25)
          .lineBetween(artSize * .1, -artSize * .34, artSize * .1, -artSize * .28);
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
        const spark = this.scene.add.graphics();
        const radius = 7 + Math.sin(now / 35) * 2;
        spark.lineStyle(2, impactColor, .94);
        for (let ray = 0; ray < 8; ray++) {
          const angle = Math.PI * ray / 4, inner = radius * .45, outer = radius * (1.2 + .25 * Math.sin(now / 45 + ray));
          spark.lineBetween(to.x + Math.cos(angle) * inner, to.y + Math.sin(angle) * inner,
            to.x + Math.cos(angle) * outer, to.y + Math.sin(angle) * outer);
        }
        spark.fillStyle(impactColor, .7).fillCircle(to.x, to.y, radius * .28); this.root.add(spark);
        this.text(`${healed || winding ? '+' : '−'}${Math.ceil(action.amount)}`, to.x, to.y - 40 * to.scale - Math.sin(now / 70) * 3, 17 * to.scale, winding ? '#a6e3e7' : healed ? '#b9e493' : '#ff897b', undefined, .5);
      }
    }
  }

  private getActorView(actor: Combatant, sprite: string): BattlefieldActorView {
    const archetype = (sprite in ACTOR_ROWS ? sprite : 'rat') as ActorSpriteId;
    const pose = this.defaultActorPose(actor);
    const frame = actorStateFrame(archetype, pose);
    const existing = this.actorViews.get(actor.id);
    if (existing) {
      if (existing.archetype !== archetype) {
        existing.archetype = archetype;
        existing.frame = actorStateFrame(archetype, existing.pose);
        existing.body.setTexture(this.actorPoseTexture(existing.pose), existing.frame);
      }
      return existing;
    }
    const container = this.scene.add.container(0, 0);
    const shadow = this.scene.add.graphics();
    const motion = this.scene.add.container(0, 0);
    const action = this.scene.add.container(0, 0);
    const body = this.scene.add.sprite(0, 0, this.actorPoseTexture(pose), frame);
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

  private syncActorPose(actor: Combatant, view: BattlefieldActorView, now: number): void {
    if (actor.status === 'dead') {
      if (view.pose !== 'death' || view.frame !== actorStateFrame(view.archetype, 'death')) {
        view.pose = 'death';
        view.frame = actorStateFrame(view.archetype, 'death');
        view.body.setTexture('actor-states', view.frame);
      }
      return;
    }
    const temporary = view.pose === 'attack' || view.pose === 'hit' || view.pose === 'dollAttack';
    const pose = temporary && now < view.poseUntil ? view.pose : this.defaultActorPose(actor);
    if (pose === view.pose && view.frame === actorStateFrame(view.archetype, pose)) return;
    view.pose = pose;
    view.frame = actorStateFrame(view.archetype, pose);
    view.body.setTexture(this.actorPoseTexture(pose), view.frame);
  }

  private setActorPose(view: BattlefieldActorView, pose: ActorSpriteState, durationMs: number): void {
    view.pose = pose;
    view.poseUntil = this.now + durationMs;
    view.frame = actorStateFrame(view.archetype, pose);
    view.body.setTexture(this.actorPoseTexture(pose), view.frame);
  }

  private animateActorEvent(event: CombatEvent, positions: Map<string, { x: number; y: number; scale: number; actor: Combatant; hero: boolean; index: number }>): void {
    const target = this.actorViews.get(event.targetId);
    if (event.kind === 'wind') {
      if (target && this.now >= target.motionUntil) {
        target.motionUntil = this.now + 180;
        target.windUntil = this.now + 180;
        this.setActorPose(target, 'dollAttack', 180);
      }
      return;
    }
    if (event.kind !== 'item' && event.kind !== 'enemy') return;
    const source = this.actorViews.get(event.actorId);
    const sourcePos = positions.get(event.actorId), targetPos = positions.get(event.targetId);
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
    const offers = this.ui.run.offers, compact = this.width < 820;
    const gap = compact ? 6 : 10;
    const y0 = this.field.y + 3;
    const available = Math.max(1, this.right.y + this.right.height - 48 - y0);
    const height = Math.max(58, Math.min(compact ? 96 : 166, (available - gap * Math.max(0, offers.length - 1)) / Math.max(1, offers.length)));
    offers.forEach((item, index) => {
      const x = this.right.x + 12, y = y0 + index * (height + gap), w = this.right.width - 24;
      const color = itemRarityTint(item.rarity);
      const iconSize = Math.min(height - 14, compact ? 62 : 102);
      const iconWell = { x: x + 7, y: y + 7, width: iconSize + 14, height: height - 14 };
      const iconX = iconWell.x + iconWell.width / 2, iconY = y + height / 2;
      const textX = iconWell.x + iconWell.width + (compact ? 12 : 18), textWidth = Math.max(50, w - (textX - x) - 12);
      const g = this.scene.add.graphics();
      g.fillStyle(0x211b22, .98).fillRoundedRect(x, y, w, height, 6);
      g.fillStyle(color, .16).fillRoundedRect(x + 2, y + 2, w - 4, height - 4, 5);
      g.lineStyle(2, color, .95).strokeRoundedRect(x, y, w, height, 6);
      g.lineStyle(1, 0xe2c18a, .64).strokeRoundedRect(x + 4, y + 4, w - 8, height - 8, 4);
      this.root.add(g);
      const iconPlate = this.scene.add.graphics();
      iconPlate.fillStyle(0x17151b, .94).fillRoundedRect(iconWell.x, iconWell.y, iconWell.width, iconWell.height, 5);
      iconPlate.fillStyle(color, .22).fillRoundedRect(iconWell.x + 2, iconWell.y + 2, iconWell.width - 4, iconWell.height - 4, 4);
      iconPlate.lineStyle(1.5, color, .85).strokeRoundedRect(iconWell.x, iconWell.y, iconWell.width, iconWell.height, 5);
      iconPlate.lineStyle(1, 0xe2c18a, .42).strokeRoundedRect(iconWell.x + 3, iconWell.y + 3, iconWell.width - 6, iconWell.height - 6, 4);
      this.root.add(iconPlate);
      this.frameCorners(x, y, w, height, Math.min(compact ? 24 : 40, height * .3), .95);
      this.itemImage(item, iconX, iconY, iconSize);
      const titleY = y + (compact ? 8 : 12);
      const title = this.titleText(item.name, textX, titleY, compact ? 15 : 22, '#fff0cf', textWidth);
      const titleSpace = compact ? 17 : 24;
      if (title.displayHeight > titleSpace) title.setScale(title.scaleX * titleSpace / title.displayHeight);
      const rarityText = `${rarityLabels[item.rarity ?? 'common']}  ·  ${categoryLabels[item.category ?? 'relic']}`;
      this.text(rarityText, textX, titleY + (compact ? 18 : 25), compact ? 8 : 11, `#${color.toString(16).padStart(6, '0')}`, textWidth);
      const descY = titleY + (compact ? 35 : 47);
      const description = this.text(item.description ?? '', textX, descY, compact ? 9 : 12, '#e5d8c5', textWidth);
      const descriptionSpace = Math.max(1, y + height - (height >= 100 ? (compact ? 22 : 28) : 7) - descY);
      if (description.height > descriptionSpace) description.setScale(descriptionSpace / description.height);
      if (height >= 100) {
        const stats = item.effect === 'wind' ? `ЗАВОД +${item.windAmount ?? 0}  ·  КУЛДАУН ${(item.cooldownMs / 1000).toFixed(1)}с`
          : item.effect === 'heal' ? `ЛЕЧЕНИЕ ${item.damage}  ·  КУЛДАУН ${(item.cooldownMs / 1000).toFixed(1)}с`
          : item.trigger === 'passive' ? 'ПАССИВНЫЙ ЭФФЕКТ'
          : `УРОН ${item.damage}  ·  КУЛДАУН ${(item.cooldownMs / 1000).toFixed(1)}с`;
        this.text(stats, textX, y + height - (compact ? 18 : 23), compact ? 8 : 10, '#f0c96c', textWidth);
      }
      this.zones.push({ x, y, width: w, height, action: 'claim', value: item.id, itemId: item.id, reward: true });
    });
  }

  private workshop(): void {
    const x = this.right.x + 12, w = this.right.width - 24; let y = this.right.y + 52;
    this.text('Ключ возвращает куклам завод, но не чинит их корпус.', x, y, this.width < 820 ? 9 : 13, '#e1cfaf', w); y += this.width < 820 ? 36 : 54;
    this.button('Полностью завести кукол', x, y, w, 38, 'workshop-wind', '', true); y += 46;
    const cursed = this.ui.allItems.filter(item => item.definitionId === 'lantern' && !item.calmed);
    const calmed = this.ui.run.workshopCalmed;
    if (cursed.length && !calmed) { this.button(`Успокоить фонарь · ${cursed[0]!.name}`, x, y, w, 36, 'calm', cursed[0]!.id); y += 44; }
    else this.text(calmed ? 'Проклятие снято.' : 'Нет проклятых предметов.', x, y, 11, '#cdb993', w);
    this.button('Закончить работу', x, this.right.y + this.right.height - 44, w, 34, 'leave-workshop');
  }

  private event(): void {
    const x = this.right.x + 12, w = this.right.width - 24, y = this.right.y + 54;
    this.text('В лечебнице хватит припасов только на один выбор.', x, y, this.width < 820 ? 9 : 13, '#e1cfaf', w);
    this.button('Лечить людей · +15 здоровья', x, y + 46, w, 40, 'event-choice', 'heal');
    this.button('Починить кукол · +15 прочности', x, y + 96, w, 40, 'event-choice', 'repair');
  }

  private cleared(): void {
    const x = this.right.x + 12, w = this.right.width - 24;
    let y = this.right.y + 45;
    this.text(this.ui.state.floor.length ? 'Павшие куклы оставили вещи. Разложите их после боя.' : 'Враги повержены.', x, y, this.width < 820 ? 9 : 13, '#e1cfaf', w);
    y += 32;
    if (this.ui.state.floor.length) {
      this.text(`НА ПОЛУ · ${this.ui.state.floor.length}`, x, y, 11, '#f0cc86', w);
      y = this.drawLooseItems(this.ui.state.floor, x, y + 19, w) + 9;
    }
    if (this.ui.state.stash.length) {
      this.text(`В ЗАПАСЕ · ${this.ui.state.stash.length}`, x, y, 11, '#f0cc86', w);
      this.drawLooseItems(this.ui.state.stash, x, y + 19, w);
    }
    this.button('Выбрать следующую комнату', x, this.right.y + this.right.height - 44, w, 34, 'route', '', true);
  }

  private drawLooseItems(items: CombatItem[], x: number, y: number, width: number): number {
    const size = this.width < 820 ? 36 : 54, gap = 6;
    const columns = Math.max(1, Math.floor((width + gap) / (size + gap)));
    items.forEach((item, index) => {
      const bx = x + index % columns * (size + gap), by = y + Math.floor(index / columns) * (size + gap);
      this.card(bx, by, size, size, item.name);
      this.itemImage(item, bx + size / 2, by + size / 2, size - 4);
      this.zones.push({ x: bx, y: by, width: size, height: size, action: 'item', value: item.id, itemId: item.id });
    });
    return y + Math.ceil(items.length / columns) * (size + gap);
  }

  private ending(): void {
    const win = this.ui.run.stage === 'victory';
    const x = this.right.x + 12, y = this.field.y + 26, w = this.right.width - 24;
    const title = win ? 'Архонт повержен' : 'Отряд пал';
    this.titleText(title, x + w / 2, y, this.width < 820 ? 20 : 32, win ? '#f1ce86' : '#d3847a', w, .5);
    this.text(win ? 'Забег завершён. Победа осталась за отрядом.' : 'Куклы разрушены. Их вещи остались на полу.', x, y + 43, this.width < 820 ? 9 : 13, '#e9d5b5', w);
    let lootY = y + 82;
    if (this.ui.state.floor.length) {
      this.text(`НА ПОЛУ · ${this.ui.state.floor.length}`, x, lootY, 11, '#f0cc86', w);
      lootY = this.drawLooseItems(this.ui.state.floor, x, lootY + 19, w) + 10;
    }
    if (this.ui.state.stash.length) {
      this.text(`В ЗАПАСЕ · ${this.ui.state.stash.length}`, x, lootY, 11, '#f0cc86', w);
      this.drawLooseItems(this.ui.state.stash, x, lootY + 19, w);
    }
    this.button('Начать новый забег', x, this.right.y + this.right.height - 52, w, 42, 'restart', '', true);
  }

  private drawDropFootprint(drag: DragPreview): void {
    if (!drag.heroId || drag.anchor === undefined) return;
    const cells = occupiedCells(drag.item, drag.anchor) ?? [];
    const g = this.scene.add.graphics(); g.fillStyle(drag.valid ? 0x5fc49a : 0xef766c, .5); g.lineStyle(2, drag.valid ? 0x9df1c1 : 0xffa49b, 1);
    cells.forEach(index => {
      const cell = this.cells.get(`${drag.heroId}:${index}`); if (!cell) return;
      g.fillRect(cell.x, cell.y, cell.size, cell.size); g.strokeRect(cell.x + 1, cell.y + 1, cell.size - 2, cell.size - 2);
    }); this.root.add(g);
  }

  private drawDrag(drag: DragPreview): void {
    const shape = rotatedShape(drag.item);
    const size = Math.min(this.width < 820 ? 24 : 34, 160 / Math.max(1, shape.length));
    const g = this.scene.add.graphics(); g.fillStyle(drag.valid === false ? 0xae4f4e : 0xb98954, .82);
    for (const [dx, dy] of shape) g.fillRoundedRect(drag.x + dx * size, drag.y + dy * size, size - 2, size - 2, 3);
    this.root.add(g);
    const image = this.itemImage(drag.item, drag.x + size / 2, drag.y + size / 2, size * .9); image.setAlpha(.9);
  }

  private itemSpeech(): void {
    const speech = this.ui.dialogue.active;
    if (!speech || speech.expiresAt <= this.now) return;
    const hero = this.ui.state.heroes.find(candidate => candidate.id === speech.heroId);
    const item = hero?.items.find(candidate => candidate.id === speech.itemId);
    if (!item) return;
    const cells = occupiedCells(item, item.cell ?? 0);
    const anchor = cells?.map(index => this.cells.get(`${hero!.id}:${index}`)).find(Boolean);
    if (!anchor) return;
    const maxWidth = Math.min(this.width < 820 ? 155 : 210, this.width - 20);
    const label = this.scene.add.text(0, 0, speech.text, { fontFamily: 'Georgia, serif', fontStyle: 'bold',
      fontSize: this.width < 820 ? '10px' : '13px', color: '#fff0cc', stroke: '#241717', strokeThickness: 1,
      wordWrap: { width: maxWidth - 20 }, resolution: 2 });
    const w = Math.ceil(label.width + 18), h = Math.ceil(label.height + 12);
    const anchorX = anchor.x + anchor.size / 2, anchorY = anchor.y;
    const x = Math.max(5, Math.min(this.width - w - 5, anchorX - w / 2));
    const y = Math.max(5, Math.min(this.height - h - 8, anchorY - h - 9));
    const g = this.scene.add.graphics();
    g.fillStyle(0x1a151c, .96).fillRoundedRect(x, y, w, h, 5);
    g.lineStyle(1, 0xd5ad6c, 1).strokeRoundedRect(x, y, w, h, 5);
    const tailX = Math.max(x + 9, Math.min(x + w - 9, anchorX));
    g.fillStyle(0x1a151c, .96).fillTriangle(tailX - 4, y + h - 1, tailX + 4, y + h - 1, tailX, y + h + 6);
    this.root.add(g);
    label.setPosition(x + 9, y + 6); this.root.add(label);
  }

  private tooltip(item?: CombatItem): void {
    if (!item) return;
    const hero = this.ui.state.heroes.find(candidate => candidate.items.includes(item));
    const text = `${item.name}\n${this.ui.itemDescription(item, hero)}`;
    this.tooltipBox(text);
  }

  private actorTooltip(actor?: Combatant): void {
    if (!actor) return;
    const target = actor.side === 'enemy' && actor.status === 'enemy'
      ? chooseHeroTarget(this.ui.state.heroes, actor.targetPolicy, actor.slot, actor.reach)?.name
      : undefined;
    const details = actor.side === 'enemy'
      ? `Враги охотятся сначала на людей, затем на кукол.${target ? ` Сейчас атакует: ${target}.` : ''}`
      : `${actorStatus[actor.status]}${actor.status === 'stopped' ? '. Нажимайте, чтобы завести.' : '.'}`;
    this.tooltipBox(`${actor.name}\n${details}`);
  }

  private tooltipBox(value: string): void {
    const w = Math.min(this.width - 16, this.width < 820 ? Math.max(180, this.width * .6) : 330);
    const label = this.text(value, 0, 0, this.width < 820 ? 9 : 11, '#f1e0c1', w - 14);
    const availableHeight = Math.max(1, this.height - 26);
    if (label.height > availableHeight) label.setScale(availableHeight / label.height);
    const h = Math.ceil(label.displayHeight + 12);
    const x = Math.min(this.width - w - 8, Math.max(8, this.scene.input.activePointer.x + 12));
    const y = Math.min(this.height - h - 8, Math.max(8, this.scene.input.activePointer.y + 12));
    const g = this.scene.add.graphics();
    g.fillStyle(0x171414, .97).fillRoundedRect(x, y, w, h, 5);
    g.lineStyle(1, 0xe0bd7a, 1).strokeRoundedRect(x, y, w, h, 5);
    this.root.add(g);
    label.setPosition(x + 7, y + 6);
    this.root.bringToTop(label);
  }

  private resetDialog(): void {
    const x = this.width * .26, y = this.height * .34, w = this.width * .48, h = this.height * .3;
    const g = this.scene.add.graphics(); g.fillStyle(0x101012, .85).fillRect(0, 0, this.width, this.height);
    g.fillStyle(0x302728, 1).fillRoundedRect(x, y, w, h, 8); g.lineStyle(2, 0xd5ac66, 1).strokeRoundedRect(x, y, w, h, 8); this.root.add(g);
    this.titleText('Начать заново?', x + w / 2, y + 20, this.width < 820 ? 20 : 30, '#f0d18f', w - 24, .5);
    this.text('Текущий забег будет сброшен.', x + w / 2, y + 58, this.width < 820 ? 10 : 14, '#e0ceb1', undefined, .5);
    this.button('Сбросить', x + 12, y + h - 48, w / 2 - 18, 34, 'confirm-reset', '', true);
    this.button('Вернуться', x + w / 2 + 6, y + h - 48, w / 2 - 18, 34, 'cancel-reset');
  }

  private card(x: number, y: number, width: number, height: number, label: string): void {
    const g = this.scene.add.graphics(); g.fillStyle(0x372e2c, 1).fillRoundedRect(x, y, width, height, 4); g.lineStyle(1, 0x8b765b, 1).strokeRoundedRect(x, y, width, height, 4); this.root.add(g);
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
      const image = this.scene.add.image(corner.x, corner.y, 'ui-frame-corner').setOrigin(0, 0)
        .setDisplaySize(edge, edge).setFlipX(corner.flipX).setFlipY(corner.flipY).setAlpha(alpha);
      this.root.add(image);
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
    const image = this.scene.add.image(x, y, itemAtlases[id] ?? 'items-guard', itemFrames[id] ?? 0).setScale(scale).setRotation(angle);
    const offsetX = (art.content.x + art.content.width / 2 - image.width / 2) * scale;
    const offsetY = (art.content.y + art.content.height / 2 - image.height / 2) * scale;
    image.setPosition(x - (offsetX * Math.cos(angle) - offsetY * Math.sin(angle)), y - (offsetX * Math.sin(angle) + offsetY * Math.cos(angle)));
    this.root.add(image); return image;
  }

  private actorImage(id: string, x: number, y: number, size: number, status?: Combatant['status']): void {
    const doll = status === 'active' || status === 'stopped';
    const image = this.scene.add.image(x, y, doll ? 'doll-portraits' : 'portraits', portraitFrames[id] ?? 0).setDisplaySize(size, size);
    if (status === 'stopped') image.setTint(0xb8b8bc);
    this.root.add(image);
  }

  private itemById(id: string): CombatItem | undefined { return this.ui.allItems.find(item => item.id === id) ?? this.ui.run.offers.find(item => item.id === id); }
}
