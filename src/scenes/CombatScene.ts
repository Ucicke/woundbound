import Phaser from 'phaser';
import { advanceClock, stepEncounter, type CombatClock, type CombatItem } from '../combat/simulation.ts';
import { INVENTORY_GRID_SIZE, canPlaceItem, rotatedShape } from '../combat/inventory.ts';
import { ACTOR_STATE_FRAME_SIZE, ACTOR_STATES_ATLAS_URL, CLASS_ITEM_ATLAS_TEXTURES, CLASS_ITEM_ATLAS_URLS, DOLL_STOPPED_ATLAS_URL, DOLL_STOPPED_FRAME_SIZE, ITEM_ATLAS_FRAME_SIZE, PUPPET_DEATH_ATLAS_URL, PUPPET_DEATH_FRAME_SIZE } from '../presentation/ArtCatalog.ts';
import { GameUI } from '../ui/GameUI.ts';
import { PhaserHUD, type DragPreview, type UIZone } from '../ui/PhaserHUD.ts';
import { GameAudio } from '../presentation/GameAudio.ts';
import type { AudioChannel } from '../presentation/AudioSettings.ts';
import { assetUrl } from '../presentation/assetUrl.ts';

interface CanvasDrag {
  item: CombatItem; previewItem: CombatItem; pointerId: number; reward: boolean;
  startX: number; startY: number; x: number; y: number; active: boolean;
  heroId?: string; anchor?: number; valid?: boolean; grabIndex: number; grabX: number; grabY: number;
}

/** Phaser owns the visible Canvas, input, and presentation; combat remains pure TypeScript state. */
export class CombatScene extends Phaser.Scene {
  private ui!: GameUI;
  private hud!: PhaserHUD;
  private gameAudio!: GameAudio;
  private clock: CombatClock = { accumulator: 0 };
  private focused = true;
  private startingRun = false;
  private battleAssetsReady = false;
  private battleLoadFailed = false;
  private drag?: CanvasDrag;
  private pointerX = 0;
  private pointerY = 0;
  private hoverTarget = '';
  private hoverSoundTarget = '';
  private volumeDrag?: { channel: AudioChannel; x: number; width: number; pointerId: number };
  private encounterState?: GameUI['state'];
  private lastStage?: GameUI['run']['stage'];
  private preventCanvasContextMenu = (event: MouseEvent): void => { event.preventDefault(); };
  private onBlur = (): void => { this.focused = false; this.clock.accumulator = 0; this.clock.interrupted = true; };
  private onFocus = (): void => { this.focused = true; this.clock.accumulator = 0; this.clock.interrupted = true; };
  private onVisibility = (): void => { this.clock.accumulator = 0; this.clock.interrupted = true; };

  constructor() { super('combat'); }

  preload(): void {
    const asset = assetUrl;
    this.load.image('ui-button-plate', asset('/assets/ui/gothic-button-plate.png'));
    this.load.image('ui-button-hover-cog', asset('/assets/ui/button-hover-cog.png'));
    this.load.image('ui-tooltip-frame', asset('/assets/ui/gothic-tooltip-frame.png'));
    this.load.image('ui-panel-nine-slice', asset('/assets/ui/gothic-panel-nine-slice.png'));
    this.load.image('ui-descent-button', asset('/assets/ui/descent-button.png'));
    const opening = this.scale.height > this.scale.width ? 'portrait' : 'desktop';
    this.load.image(`ui-opening-${opening}`, asset(`/assets/ui/opening-${opening}-refined.png`));
    this.load.image('ui-woundbound-logo', asset('/assets/ui/woundbound-logo-refined.png'));
    GameAudio.preload(this, asset);
  }

  private loadBattleAssets(): void {
    const asset = assetUrl;
    for (const classId of Object.keys(CLASS_ITEM_ATLAS_TEXTURES) as Array<keyof typeof CLASS_ITEM_ATLAS_TEXTURES>) {
      this.load.spritesheet(CLASS_ITEM_ATLAS_TEXTURES[classId], asset(CLASS_ITEM_ATLAS_URLS[classId]), { frameWidth: ITEM_ATLAS_FRAME_SIZE, frameHeight: ITEM_ATLAS_FRAME_SIZE });
    }
    this.load.spritesheet('portraits', asset('/assets/source/raw/party-portraits-woundbound-imagegen.png'), { frameWidth: 543, frameHeight: 543 });
    const dashboardAssets = {
      guard: 'dashboard-guard-forged.png', huntress: 'dashboard-huntress-status-v2.png',
      pilgrim: 'dashboard-pilgrim-limestone.png', clockmaker: 'dashboard-clockmaker-status-v2.png',
    } as const;
    for (const [classId, file] of Object.entries(dashboardAssets)) this.load.image(`ui-dashboard-${classId}`, asset(`/assets/ui/${file}`));
    this.load.image('ui-tube-single', asset('/assets/ui/clockmaker-tube-single.png'));
    this.load.image('ui-tube-double', asset('/assets/ui/clockmaker-tube-double.png'));
    this.load.spritesheet('puppet-deaths', asset(PUPPET_DEATH_ATLAS_URL), { frameWidth: PUPPET_DEATH_FRAME_SIZE, frameHeight: PUPPET_DEATH_FRAME_SIZE });
    for (const classId of ['guard', 'huntress', 'pilgrim', 'clockmaker']) {
      this.load.image(`dead-portrait-${classId}`, asset(`/assets/ui/dead-portrait-${classId}.png`));
    }
    this.load.spritesheet('doll-portraits', asset('/assets/source/raw/party-doll-portraits-woundbound-imagegen.png'), { frameWidth: 543, frameHeight: 543 });
    this.load.spritesheet('actor-states', asset(ACTOR_STATES_ATLAS_URL), { frameWidth: ACTOR_STATE_FRAME_SIZE, frameHeight: ACTOR_STATE_FRAME_SIZE });
    this.load.spritesheet('doll-stopped', asset(DOLL_STOPPED_ATLAS_URL), { frameWidth: DOLL_STOPPED_FRAME_SIZE, frameHeight: DOLL_STOPPED_FRAME_SIZE });
    this.load.image('battlefield', asset('/assets/battlefield-gothic.png'));
    this.load.image('location-rat-catacombs', asset('/assets/location-rat-catacombs.png'));
    this.load.image('ui-frame-corner', asset('/assets/ui/gothic-frame-corner.png'));
    this.load.image('ui-inventory-texture', asset('/assets/ui/inventory-plum-texture.png'));
    this.load.image('ui-background-pattern', asset('/assets/ui/background-pattern.png'));
    this.load.on('progress', this.updateBattleLoadProgress, this);
    this.load.on('loaderror', this.onBattleLoadError, this);
    this.load.once('complete', this.finishBattleAssetLoad, this);
    this.load.start();
  }

  create(): void {
    this.game.canvas.addEventListener('contextmenu', this.preventCanvasContextMenu);
    this.createButtonPlateFrames();
    this.createCompactTooltipFrame();
    this.focused = document.hasFocus();
    this.ui = new GameUI();
    this.gameAudio = new GameAudio(this);
    this.gameAudio.applySettings(this.ui.audioSettings);
    this.encounterState = this.ui.state;
    this.hud = new PhaserHUD(this, this.ui);
    this.registerInput();
    this.loadBattleAssets();
  }

  private updateBattleLoadProgress(progress: number): void { this.hud.battleLoadProgress = progress; }

  private onBattleLoadError(file: Phaser.Loader.File): void {
    if (file.key !== 'background-music' && !file.key.startsWith('ui-opening-')) {
      this.battleLoadFailed = true;
      console.error('[Woundbound] Failed to load game asset:', file.key);
    }
  }

  private finishBattleAssetLoad(): void {
    this.load.off('progress', this.updateBattleLoadProgress, this);
    this.load.off('loaderror', this.onBattleLoadError, this);
    if (this.battleLoadFailed) {
      this.startingRun = false;
      this.hud.battleLoadFailed = true;
      return;
    }
    this.prepareVisualAssets();
    this.battleAssetsReady = true;
    this.hud.battleLoadProgress = 1;
    if (this.startingRun) this.finishBeginDescent();
  }

  private prepareVisualAssets(): void {
    this.createDashboardPortraits();
    this.createResourceModuleFrames();
    this.createButtonPlateFrames();
    this.createCompactTooltipFrame();
    this.enableGothicLighting();
    const pattern = this.textures.get('ui-background-pattern').getSourceImage() as HTMLImageElement;
    const tile = this.textures.createCanvas('ui-background-tile', pattern.width * 2, pattern.height * 2);
    if (tile) {
      const ctx = tile.context;
      ctx.drawImage(pattern, 0, 0);
      ctx.save(); ctx.translate(pattern.width * 2, 0); ctx.scale(-1, 1); ctx.drawImage(pattern, 0, 0); ctx.restore();
      ctx.save(); ctx.translate(0, pattern.height * 2); ctx.scale(1, -1); ctx.drawImage(pattern, 0, 0); ctx.restore();
      ctx.save(); ctx.translate(pattern.width * 2, pattern.height * 2); ctx.scale(-1, -1); ctx.drawImage(pattern, 0, 0); ctx.restore();
      tile.refresh();
    }
  }

  private registerInput(): void {
    const onResize = (size: Phaser.Structs.Size): void => { this.cameras.resize(size.width, size.height); };
    this.scale.on('resize', onResize);
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.pointerDown(pointer));
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => this.pointerMove(pointer));
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => this.pointerUp(pointer));
    this.input.on('pointerupoutside', (pointer: Phaser.Input.Pointer) => this.pointerUp(pointer));
    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => this.keyDown(event));
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('focus', this.onFocus);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.events.once('shutdown', () => {
      this.scale.off('resize', onResize);
      this.sound.get('background-music')?.destroy();
      this.game.canvas.removeEventListener('contextmenu', this.preventCanvasContextMenu);
      window.removeEventListener('blur', this.onBlur); window.removeEventListener('focus', this.onFocus);
      document.removeEventListener('visibilitychange', this.onVisibility);
    });
  }

  private createResourceModuleFrames(): void {
    for (const [key, width, height] of [['ui-tube-single', 1840, 391], ['ui-tube-double', 1888, 412]] as const) {
      const texture = this.textures.get(key);
      if (texture.has('left-cap')) continue;
      texture.add('left-cap', 0, 0, 0, 300, height);
      texture.add('glass-middle', 0, 300, 0, width - 600, height);
      texture.add('right-cap', 0, width - 300, 0, 300, height);
    }
  }

  private createButtonPlateFrames(): void {
    const texture = this.textures.get('ui-button-plate');
    if (texture.has('left-cap')) return;
    const width = 2172, height = 404, top = 160, cap = 300;
    texture.add('left-cap', 0, 0, top, cap, height);
    texture.add('center', 0, cap, top, width - cap * 2, height);
    texture.add('right-cap', 0, width - cap, top, cap, height);
  }

  private createCompactTooltipFrame(): void {
    if (this.textures.exists('ui-tooltip-frame-small')) return;
    const source = this.textures.get('ui-tooltip-frame').getSourceImage() as HTMLImageElement | HTMLCanvasElement;
    const width = Math.round(source.width / 4), height = Math.round(source.height / 4);
    const texture = this.textures.createCanvas('ui-tooltip-frame-small', width, height);
    if (!texture) return;
    texture.context.imageSmoothingEnabled = false;
    texture.context.drawImage(source, 0, 0, width, height);
    const pixels = texture.context.getImageData(0, 0, width, height).data;
    let left = width, top = height, right = 0, bottom = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3]! < 8) continue;
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
    texture.refresh();
    if (right >= left && bottom >= top) texture.add('trimmed', 0, left, top, right - left + 1, bottom - top + 1);
  }

  private enableGothicLighting(): void {
    if (this.game.renderer.type !== Phaser.WEBGL) return;
    this.cameras.main.filters.external.addVignette(.5, .52, .96, .1, 0x090711);
  }

  private createDashboardPortraits(): void {
    const size = 543;
    const arch = [[.116, .322], [.116, .17], [.13, .14], [.16, .12], [.20, .098], [.24, .12], [.28, .14], [.293, .17], [.293, .322]] as const;
    const clipPortrait = (ctx: CanvasRenderingContext2D): void => {
      ctx.beginPath();
      arch.forEach(([x, y], i) => {
        const px = (x - .0895) / .23 * size, py = (y - .097) / .23 * size;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.closePath(); ctx.clip();
    };
    const createPortrait = (sourceKey: 'portraits' | 'doll-portraits', targetKey: string, index: number, muted = false): void => {
      if (this.textures.exists(targetKey)) return;
      const atlas = this.textures.get(sourceKey), frame = atlas.get(index);
      const texture = this.textures.createCanvas(targetKey, size, size);
      if (!texture) return;
      const ctx = texture.context;
      ctx.save(); clipPortrait(ctx);
      ctx.drawImage(atlas.getSourceImage(index) as HTMLImageElement | HTMLCanvasElement, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight, 0, 0, size, size);
      ctx.restore();
      if (muted) {
        const pixels = ctx.getImageData(0, 0, size, size);
        for (let i = 0; i < pixels.data.length; i += 4) {
          const light = Math.round((pixels.data[i]! * .2126 + pixels.data[i + 1]! * .7152 + pixels.data[i + 2]! * .0722) * .72);
          pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = light;
        }
        ctx.putImageData(pixels, 0, 0);
      }
      texture.refresh();
    };
    for (let index = 0; index < 4; index++) {
      createPortrait('portraits', `dashboard-portrait-human-${index}`, index);
      createPortrait('portraits', `dashboard-portrait-rebirth-${index}`, index, true);
      createPortrait('doll-portraits', `dashboard-portrait-doll-${index}`, index);

      const classId = (['guard', 'huntress', 'pilgrim', 'clockmaker'] as const)[index]!;
      const deadKey = `dashboard-portrait-dead-${index}`;
      if (!this.textures.exists(deadKey)) {
        const source = this.textures.get(`dead-portrait-${classId}`).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
        const texture = this.textures.createCanvas(deadKey, size, size);
        if (texture) {
          const ctx = texture.context;
          ctx.save(); clipPortrait(ctx);
          const fit = Math.min(size / source.width, size / source.height) * .9;
          const drawWidth = source.width * fit, drawHeight = source.height * fit;
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(source, (size - drawWidth) / 2, (size - drawHeight) / 2, drawWidth, drawHeight);
          ctx.restore();
          texture.refresh();
        }
      }
    }
  }

  update(time: number, delta: number): void {
    if (this.encounterState !== this.ui.state) {
      this.encounterState = this.ui.state;
      this.clock.accumulator = 0;
      this.drag = undefined;
      this.volumeDrag = undefined;
      this.pointerX = -1; this.pointerY = -1;
      this.hoverTarget = '';
      this.hoverSoundTarget = '';
    }
    const visible = !document.hidden;
    const steps = advanceClock(this.clock, delta, visible, this.focused && !this.ui.dialogOpen && !this.startingRun);
    for (let i = 0; i < steps; i++) stepEncounter(this.ui.state, 50);
    this.gameAudio.consume(this.ui.state, visible && this.focused && !this.ui.dialogOpen && !this.startingRun);
    this.ui.tick(); this.ui.setPaused(!visible || !this.focused);
    if (this.lastStage && this.lastStage !== this.ui.run.stage && this.lastStage !== 'opening' && !this.startingRun) this.cameras.main.flash(180, 36, 23, 25, false);
    this.lastStage = this.ui.run.stage;
    const preview = this.drag?.active ? this.dragPreview() : undefined;
    this.hud.draw(this.pointerX, this.pointerY, preview);
  }

  private pointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.startingRun) return;
    if (this.drag || this.volumeDrag) return;
    this.pointerX = pointer.x; this.pointerY = pointer.y;
    const zone = this.hud.zoneAt(pointer.x, pointer.y);
    if (this.ui.optionsOpen && zone?.action === 'audio-volume' && (zone.value === 'music' || zone.value === 'effects')) {
      this.volumeDrag = { channel: zone.value, x: zone.x, width: zone.width, pointerId: pointer.id };
      this.updateVolume(pointer.x); return;
    }
    if (this.ui.dialogOpen) return;
    if (pointer.button === 2) {
      if (zone?.itemId && (this.ui.state.phase === 'preparation' || this.ui.state.phase === 'result') && this.ui.rotateItem(zone.itemId)) this.gameAudio.play('ui');
      this.forceDraw();
      return;
    }
    if (this.ui.selectedItem) {
      const item = this.findItem(this.ui.selectedItem);
      if (item) {
        const owner = this.ui.state.heroes.find(hero => hero.items.includes(item));
        const shape = rotatedShape(item);
        this.drag = { item, previewItem: { ...item }, pointerId: pointer.id, reward: this.ui.run.offers.includes(item), startX: pointer.x, startY: pointer.y, x: pointer.x, y: pointer.y,
          active: false, heroId: owner?.id, grabIndex: 0, grabX: shape[0]?.[0] ?? 0, grabY: shape[0]?.[1] ?? 0 };
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
          this.drag = { item, previewItem: { ...item }, pointerId: pointer.id, reward, startX: pointer.x, startY: pointer.y, x: pointer.x, y: pointer.y, active: false,
            heroId: zone.heroId, grabIndex: Math.max(0, shape.findIndex(([x, y]) => x === grabX && y === grabY)), grabX, grabY };
          return;
        }
      }
    }
  }

  private pointerUp(pointer: Phaser.Input.Pointer): void {
    if (this.startingRun) return;
    if (this.volumeDrag && this.volumeDrag.pointerId !== pointer.id) return;
    if (this.drag && this.drag.pointerId !== pointer.id) return;
    this.pointerX = pointer.x; this.pointerY = pointer.y;
    if (this.volumeDrag?.pointerId === pointer.id) {
      this.updateVolume(pointer.x); this.volumeDrag = undefined; return;
    }
    const zone = this.hud.zoneAt(pointer.x, pointer.y);
    const drag = this.drag;
    if (drag) {
      if (drag.active) {
        this.finishItemDrag(drag, zone);
      } else this.activateZone(zone, pointer);
      this.drag = undefined; this.forceDraw(); return;
    }
    this.activateZone(zone, pointer);
    this.forceDraw();
  }

  private finishItemDrag(drag: CanvasDrag, zone?: UIZone): void {
    const anchor = this.dragDestination(drag, zone);
    if (anchor !== undefined && zone?.heroId && canPlaceItem(this.ui.state, drag.previewItem, zone.heroId, anchor)) {
      const originalRotation = drag.item.rotation;
      drag.item.rotation = drag.previewItem.rotation;
      let placed = false;
      try {
        placed = this.ui.dropItem(drag.item.id, zone.heroId, anchor, drag.reward);
      } finally {
        if (!placed) {
          if (originalRotation === undefined) delete drag.item.rotation;
          else drag.item.rotation = originalRotation;
        }
      }
      if (placed) {
        this.hud.suppressPlacedItemTooltip(drag.item.id);
        this.gameAudio.play('ui');
      }
    } else if (zone?.floorDrop && !drag.reward) {
      if (this.ui.dropToStash(drag.item.id)) {
        this.hud.suppressPlacedItemTooltip(drag.item.id);
        this.gameAudio.play('ui');
      }
    } else if (zone?.action === 'claim' && drag.reward) {
      this.ui.action('claim', drag.item.id);
    }
  }

  private activateZone(zone: UIZone | undefined, pointer: Phaser.Input.Pointer): void {
    if (zone?.action && (!zone.itemId || zone.action === 'claim' || zone.action === 'wind')) {
      if (zone.action === 'floor-drop') return;
      if (zone.action === 'begin-run') { this.beginDescent(); return; }
      if (zone.action === 'fullscreen') { if (this.scale.isFullscreen) this.scale.stopFullscreen(); else this.scale.startFullscreen(); return; }
      if (zone.action === 'wind' && !this.ui.state.heroes.some(hero => hero.status === 'human' || hero.status === 'active')) {
        this.hud.showClickNotice(pointer.x, pointer.y, 'Некому заводить');
        this.forceDraw(); return;
      }
      if (zone.action === 'room') this.gameAudio.play('door');
      else if (zone.action !== 'wind') this.gameAudio.play('ui');
      this.ui.action(zone.action, zone.value ?? '');
      if (zone.action === 'audio-mute') this.gameAudio.applySettings(this.ui.audioSettings);
    }
    else if (!zone?.itemId && zone?.heroId && zone.cell !== undefined) this.ui.action('cell', `${zone.heroId}:${zone.cell}`);
  }

  private pointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.volumeDrag && this.volumeDrag.pointerId !== pointer.id) return;
    if (this.drag && this.drag.pointerId !== pointer.id) return;
    this.pointerX = pointer.x; this.pointerY = pointer.y;
    if (this.volumeDrag?.pointerId === pointer.id && pointer.isDown) { this.updateVolume(pointer.x); return; }
    const drag = this.drag;
    if (drag && pointer.isDown) {
      drag.x = pointer.x; drag.y = pointer.y;
      if (!drag.active && Math.hypot(pointer.x - drag.startX, pointer.y - drag.startY) >= 6) drag.active = true;
      if (drag.active) {
        this.updateDragDestination(drag);
        return;
      }
    }
    const target = this.hud.updateHover(pointer.x, pointer.y);
    const zone = this.hud.zoneAt(pointer.x, pointer.y);
    const action = zone?.action;
    const soundTarget = zone?.itemId ? `item:${zone.itemId}`
      : action && !['cell', 'inspect', 'wind', 'floor-drop'].includes(action) ? `action:${action}:${zone.value ?? ''}` : '';
    const changed = target !== this.hoverTarget || soundTarget !== this.hoverSoundTarget;
    if (soundTarget && soundTarget !== this.hoverSoundTarget && !pointer.isDown && !this.startingRun) this.gameAudio.play('hover');
    this.hoverSoundTarget = soundTarget;
    if (changed) { this.hoverTarget = target; this.forceDraw(); }
  }

  private dragDestination(drag: CanvasDrag, zone?: UIZone): number | undefined {
    if (!zone?.heroId || zone.cell === undefined) return undefined;
    const column = zone.cell % INVENTORY_GRID_SIZE - drag.grabX;
    const row = Math.floor(zone.cell / INVENTORY_GRID_SIZE) - drag.grabY;
    if (column < 0 || row < 0 || column >= INVENTORY_GRID_SIZE || row >= INVENTORY_GRID_SIZE) return undefined;
    return row * INVENTORY_GRID_SIZE + column;
  }

  private updateDragDestination(drag: CanvasDrag): void {
    const zone = this.hud.zoneAt(drag.x, drag.y);
    const anchor = this.dragDestination(drag, zone);
    drag.heroId = zone?.heroId;
    drag.anchor = anchor;
    drag.valid = anchor !== undefined && zone?.heroId !== undefined
      ? canPlaceItem(this.ui.state, drag.previewItem, zone.heroId, anchor)
      : zone?.cell !== undefined ? false : undefined;
  }

  private beginDescent(): void {
    if (this.startingRun || this.battleLoadFailed || this.ui.run.stage !== 'opening') return;
    this.gameAudio.play('door');
    this.startingRun = true;
    this.startMusic();
    this.drag = undefined;
    if (this.battleAssetsReady) this.finishBeginDescent();
  }

  private finishBeginDescent(): void {
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

  private startMusic(): void {
    const play = (): void => {
      if (!this.sound.get('background-music')?.isPlaying) {
        this.sound.play('background-music', { loop: true, volume: this.ui.audioSettings.musicMuted ? 0 : .32 * this.ui.audioSettings.music });
      }
    };
    if (this.cache.audio.exists('background-music')) { play(); return; }
    this.load.once('filecomplete-audio-background-music', play);
    this.load.audio('background-music', assetUrl('/assets/audio/crimson-rose-loop.ogg'));
    if (!this.load.isLoading()) this.load.start();
  }
  private dragPreview(): DragPreview | undefined {
    const drag = this.drag;
    if (!drag) return undefined;
    return { item: drag.previewItem, x: drag.x, y: drag.y, heroId: drag.heroId, anchor: drag.anchor, valid: drag.valid };
  }

  private keyDown(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    if ((key === 'r' || key === 'к') && this.drag?.active) {
      event.preventDefault(); this.drag.previewItem.rotation = ((this.drag.previewItem.rotation ?? 0) + 1) % 4;
      const [x, y] = rotatedShape(this.drag.previewItem)[this.drag.grabIndex] ?? [0, 0];
      this.drag.grabX = x; this.drag.grabY = y; this.updateDragDestination(this.drag); this.forceDraw();
    } else if ((key === 'r' || key === 'к') && this.ui.selectedItem) {
      event.preventDefault(); this.ui.rotateItem(this.ui.selectedItem); this.forceDraw();
    } else if (key === 'escape' && this.ui.optionsOpen) { this.ui.action('options'); this.forceDraw(); }
    else if (key === 'escape' && this.ui.confirmReset) { this.ui.action('cancel-reset'); this.forceDraw(); }
  }

  private updateVolume(x: number): void {
    const drag = this.volumeDrag;
    if (!drag) return;
    this.ui.setAudioVolume(drag.channel, (x - drag.x) / drag.width);
    this.gameAudio.applySettings(this.ui.audioSettings);
    this.forceDraw();
  }

  private findItem(id: string): CombatItem | undefined { return this.ui.allItems.find(item => item.id === id) ?? this.ui.run.offers.find(item => item.id === id); }
  private forceDraw(): void { this.hud.draw(this.pointerX, this.pointerY, this.dragPreview()); }
}
