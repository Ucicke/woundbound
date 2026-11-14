import Phaser from 'phaser';
import { advanceClock, stepEncounter, type CombatClock, type CombatItem } from '../combat/simulation.ts';
import { INVENTORY_GRID_SIZE, canPlaceItem, rotatedShape } from '../combat/inventory.ts';
import { ACTOR_STATE_FRAME_SIZE, ACTOR_STATES_ATLAS_URL, CLASS_ITEM_ATLAS_TEXTURES, CLASS_ITEM_ATLAS_URLS, DOLL_STOPPED_ATLAS_URL, DOLL_STOPPED_FRAME_SIZE, ITEM_ATLAS_FRAME_SIZE } from '../presentation/ArtCatalog.ts';
import { GameUI } from '../ui/GameUI.ts';
import { PhaserHUD, type DragPreview } from '../ui/PhaserHUD.ts';

interface CanvasDrag {
  item: CombatItem; reward: boolean; startX: number; startY: number; x: number; y: number; active: boolean;
  heroId?: string; grabIndex: number; grabX: number; grabY: number; originalRotation?: number;
}

/** Phaser owns the visible Canvas, input, and presentation; combat remains pure TypeScript state. */
export class CombatScene extends Phaser.Scene {
  private ui!: GameUI;
  private hud!: PhaserHUD;
  private clock: CombatClock = { accumulator: 0 };
  private focused = true;
  private nextRender = 0;
  private startingRun = false;
  private drag?: CanvasDrag;
  private pointerX = 0;
  private pointerY = 0;
  private encounterState?: GameUI['state'];
  private preventCanvasContextMenu = (event: MouseEvent): void => { event.preventDefault(); };
  private onBlur = (): void => { this.focused = false; this.clock.accumulator = 0; this.clock.interrupted = true; };
  private onFocus = (): void => { this.focused = true; this.clock.accumulator = 0; this.clock.interrupted = true; };
  private onVisibility = (): void => { this.clock.accumulator = 0; this.clock.interrupted = true; };

  constructor() { super('combat'); }

  preload(): void {
    const asset = (path: string): string => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
    for (const classId of Object.keys(CLASS_ITEM_ATLAS_TEXTURES) as Array<keyof typeof CLASS_ITEM_ATLAS_TEXTURES>) {
      this.load.spritesheet(CLASS_ITEM_ATLAS_TEXTURES[classId], asset(CLASS_ITEM_ATLAS_URLS[classId]), { frameWidth: ITEM_ATLAS_FRAME_SIZE, frameHeight: ITEM_ATLAS_FRAME_SIZE });
    }
    this.load.spritesheet('portraits', asset('/assets/source/raw/party-portraits-woundbound-imagegen.png'), { frameWidth: 543, frameHeight: 543 });
    this.load.spritesheet('doll-portraits', asset('/assets/source/raw/party-doll-portraits-woundbound-imagegen.png'), { frameWidth: 543, frameHeight: 543 });
    this.load.spritesheet('actor-states', asset(ACTOR_STATES_ATLAS_URL), { frameWidth: ACTOR_STATE_FRAME_SIZE, frameHeight: ACTOR_STATE_FRAME_SIZE });
    this.load.spritesheet('doll-stopped', asset(DOLL_STOPPED_ATLAS_URL), { frameWidth: DOLL_STOPPED_FRAME_SIZE, frameHeight: DOLL_STOPPED_FRAME_SIZE });
    this.load.image('battlefield', asset('/assets/battlefield-gothic.png'));
    this.load.image('location-cave', asset('/assets/location-cave.png'));
    this.load.image('location-cult-base', asset('/assets/location-cult-base.png'));
    this.load.image('location-clockwork-foundry', asset('/assets/location-clockwork-foundry.png'));
    this.load.image('location-rat-catacombs', asset('/assets/location-rat-catacombs.png'));
    this.load.image('ui-frame-corner', asset('/assets/ui/gothic-frame-corner.png'));
    this.load.image('ui-inventory-texture', asset('/assets/ui/inventory-plum-texture.png'));
    this.load.image('ui-descent-button', asset('/assets/ui/descent-button.png'));
    this.load.image('ui-opening-desktop', asset('/assets/ui/opening-desktop.png'));
    this.load.image('ui-opening-portrait', asset('/assets/ui/opening-portrait.png'));
  }

  create(): void {
    this.game.canvas.addEventListener('contextmenu', this.preventCanvasContextMenu);
    this.focused = document.hasFocus();
    this.ui = new GameUI();
    this.encounterState = this.ui.state;
    this.hud = new PhaserHUD(this, this.ui);
    this.scale.on('resize', (size: Phaser.Structs.Size) => this.cameras.resize(size.width, size.height));
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.pointerDown(pointer));
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => this.pointerMove(pointer));
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => this.pointerUp(pointer));
    this.input.on('pointerupoutside', (pointer: Phaser.Input.Pointer) => this.pointerUp(pointer));
    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => this.keyDown(event));
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('focus', this.onFocus);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.events.once('shutdown', () => {
      this.game.canvas.removeEventListener('contextmenu', this.preventCanvasContextMenu);
      window.removeEventListener('blur', this.onBlur); window.removeEventListener('focus', this.onFocus);
      document.removeEventListener('visibilitychange', this.onVisibility);
    });
  }

  update(time: number, delta: number): void {
    if (this.encounterState !== this.ui.state) {
      this.encounterState = this.ui.state;
      this.clock.accumulator = 0;
      this.drag = undefined; this.dragAnchor = undefined; this.dragValid = undefined;
      this.pointerX = -1; this.pointerY = -1;
      this.nextRender = 0;
    }
    const visible = !document.hidden;
    const steps = advanceClock(this.clock, delta, visible, this.focused && !this.ui.dialogOpen && !this.startingRun);
    for (let i = 0; i < steps; i++) stepEncounter(this.ui.state, 50);
    this.ui.tick(); this.ui.setPaused(!visible || !this.focused);
    if (time >= this.nextRender) {
      const preview = this.drag?.active ? this.dragPreview() : undefined;
      this.hud.draw(this.pointerX, this.pointerY, preview);
      this.nextRender = time + 80;
    }
  }

  private pointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.startingRun) return;
    this.pointerX = pointer.x; this.pointerY = pointer.y;
    const zone = this.hud.zoneAt(pointer.x, pointer.y);
    if (pointer.button === 2) {
      if (zone?.itemId && (this.ui.state.phase === 'preparation' || this.ui.state.phase === 'result')) this.ui.rotateItem(zone.itemId);
      this.forceDraw();
      return;
    }
    if (this.ui.selectedItem) {
      const item = this.findItem(this.ui.selectedItem);
      if (item) {
        const owner = this.ui.state.heroes.find(hero => hero.items.includes(item));
        const shape = rotatedShape(item);
        this.drag = { item, reward: this.ui.run.offers.includes(item), startX: pointer.x, startY: pointer.y, x: pointer.x, y: pointer.y,
          active: false, heroId: owner?.id, grabIndex: 0, grabX: shape[0]?.[0] ?? 0, grabY: shape[0]?.[1] ?? 0, originalRotation: item.rotation };
        this.ui.selectedItem = null;
        return;
      }
    }
    if (!zone) return;
    if (zone.itemId && (this.ui.state.phase === 'preparation' || this.ui.state.phase === 'result')) {
      const item = this.findItem(zone.itemId);
      if (item) {
        const source = zone.heroId ? this.ui.state.heroes.find(hero => hero.id === zone.heroId)?.items.includes(item) ?? false : false;
        const reward = this.ui.run.offers.includes(item);
        if (source || reward || this.ui.state.stash.includes(item) || this.ui.state.floor.includes(item)) {
          const shape = rotatedShape(item), anchor = item.cell ?? 0;
          const grabX = zone.cell === undefined ? shape[0]?.[0] ?? 0 : zone.cell % INVENTORY_GRID_SIZE - anchor % INVENTORY_GRID_SIZE;
          const grabY = zone.cell === undefined ? shape[0]?.[1] ?? 0 : Math.floor(zone.cell / INVENTORY_GRID_SIZE) - Math.floor(anchor / INVENTORY_GRID_SIZE);
          this.drag = { item, reward, startX: pointer.x, startY: pointer.y, x: pointer.x, y: pointer.y, active: false,
            heroId: zone.heroId, grabIndex: Math.max(0, shape.findIndex(([x, y]) => x === grabX && y === grabY)), grabX, grabY, originalRotation: item.rotation };
          return;
        }
      }
    }
  }

  private pointerUp(pointer: Phaser.Input.Pointer): void {
    if (this.startingRun) return;
    this.pointerX = pointer.x; this.pointerY = pointer.y;
    const zone = this.hud.zoneAt(pointer.x, pointer.y);
    const drag = this.drag;
    if (drag) {
      if (drag.active) {
        if (zone?.heroId && zone.cell !== undefined) {
          const anchor = zone.cell - drag.grabY * INVENTORY_GRID_SIZE - drag.grabX;
          const valid = canPlaceItem(this.ui.state, drag.item, zone.heroId, anchor);
          if (valid) this.ui.dropItem(drag.item.id, zone.heroId, anchor, drag.reward);
          else this.restoreRotation(drag);
        } else if (zone?.action === 'store' || zone?.stash) {
          this.ui.dropToStash(drag.item.id);
        } else if (zone?.action === 'claim' && drag.reward) {
          this.ui.action('claim', drag.item.id);
        } else this.restoreRotation(drag);
      } else if (zone?.action && (!zone.itemId || zone.action === 'claim')) this.ui.action(zone.action, zone.value ?? '');
      else if (!zone?.itemId && zone?.heroId && zone.cell !== undefined) this.ui.action('cell', `${zone.heroId}:${zone.cell}`);
      this.drag = undefined; this.forceDraw(); return;
    }
    if (zone?.action && (!zone.itemId || zone.action === 'claim')) {
      if (zone.action === 'begin-run') { this.beginDescent(); return; }
      this.ui.action(zone.action, zone.value ?? '');
    }
    else if (!zone?.itemId && zone?.heroId && zone.cell !== undefined) this.ui.action('cell', `${zone.heroId}:${zone.cell}`);
    this.forceDraw();
  }

  private pointerMove(pointer: Phaser.Input.Pointer): void {
    this.pointerX = pointer.x; this.pointerY = pointer.y;
    const drag = this.drag; if (!drag || !pointer.isDown) return;
    drag.x = pointer.x; drag.y = pointer.y;
    if (!drag.active && Math.hypot(pointer.x - drag.startX, pointer.y - drag.startY) >= 6) drag.active = true;
    if (drag.active) {
      const zone = this.hud.zoneAt(pointer.x, pointer.y);
      if (zone?.heroId && zone.cell !== undefined) {
        const anchor = zone.cell - drag.grabY * INVENTORY_GRID_SIZE - drag.grabX;
        const valid = canPlaceItem(this.ui.state, drag.item, zone.heroId, anchor);
        drag.heroId = zone.heroId; this.dragAnchor = anchor; this.dragValid = valid;
      } else { drag.heroId = undefined; this.dragAnchor = undefined; this.dragValid = undefined; }
    }
  }

  private dragAnchor?: number;
  private dragValid?: boolean;

  private beginDescent(): void {
    if (this.startingRun || this.ui.run.stage !== 'opening') return;
    this.startingRun = true;
    this.drag = undefined;
    const camera = this.cameras.main;
    camera.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.ui.action('begin-run');
      this.clock.accumulator = 0;
      this.forceDraw();
      camera.once(Phaser.Cameras.Scene2D.Events.FADE_IN_COMPLETE, () => {
        this.clock.accumulator = 0;
        this.startingRun = false;
      });
      camera.fadeIn(650, 10, 8, 12);
    });
    camera.fadeOut(450, 10, 8, 12);
  }
  private dragPreview(): DragPreview | undefined {
    const drag = this.drag;
    if (!drag) return undefined;
    return { item: drag.item, x: drag.x, y: drag.y, heroId: drag.heroId, anchor: this.dragAnchor, valid: this.dragValid };
  }

  private keyDown(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    if ((key === 'r' || key === 'к') && this.drag?.active) {
      event.preventDefault(); this.drag.item.rotation = ((this.drag.item.rotation ?? 0) + 1) % 4;
      const [x, y] = rotatedShape(this.drag.item)[this.drag.grabIndex] ?? [0, 0];
      this.drag.grabX = x; this.drag.grabY = y; this.forceDraw();
    } else if ((key === 'r' || key === 'к') && this.ui.selectedItem) {
      event.preventDefault(); this.ui.rotateItem(this.ui.selectedItem); this.forceDraw();
    } else if (key === 'escape' && this.ui.confirmReset) { this.ui.action('cancel-reset'); this.forceDraw(); }
  }

  private findItem(id: string): CombatItem | undefined { return this.ui.allItems.find(item => item.id === id) ?? this.ui.run.offers.find(item => item.id === id); }
  private restoreRotation(drag: CanvasDrag): void { if (drag.originalRotation === undefined) delete drag.item.rotation; else drag.item.rotation = drag.originalRotation; }
  private forceDraw(): void { this.hud.draw(this.pointerX, this.pointerY, this.dragPreview()); this.nextRender = this.time.now + 80; }
}
