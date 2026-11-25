import type Phaser from 'phaser';
import type { ItemCell } from '../presentation/itemGeometry.ts';

export interface TooltipTag { label: string; color: string }
export interface TooltipRelation { label: string; detail: string; negative: boolean; active: boolean }
export interface ItemTooltipContent {
  key: string;
  title: string;
  tags: TooltipTag[];
  stats: string[];
  effects: string[];
  description: string;
  relations: TooltipRelation[];
  shape?: readonly ItemCell[];
}

interface TooltipAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
  tooltipBounds?: { x: number; y: number; width: number; height: number };
  safeTop?: number;
  poolBounds?: { panelTop: number; top: number; bottom: number };
  centered?: boolean;
  avoid?: ReadonlyArray<{ x: number; y: number; width: number; height: number }>;
}

const truncate = (value: string, maxLength: number): string =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1).trimEnd()}…` : value;

/** Owns short, viewport-bounded hover cards rendered by Phaser. */
export class TooltipLayer {
  private readonly root: Phaser.GameObjects.Container;
  private contentKey = '';
  private boxWidth = 0;
  private boxHeight = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.root = scene.add.container(0, 0).setDepth(1000);
    scene.events.once('shutdown', () => this.root.destroy());
  }

  showItem(content: ItemTooltipContent, pointerX: number, pointerY: number, screenWidth: number, screenHeight: number, anchor?: TooltipAnchor): number {
    const compact = screenWidth < 600 || screenHeight < 520;
    const width = Math.max(1, Math.min(screenWidth - (anchor?.centered ? 28 : 16), anchor?.centered ? 470 : compact ? 286 : 368));
    const key = JSON.stringify([content, width, screenHeight, !!anchor?.centered]);
    if (key !== this.contentKey) {
      this.clearChildren();
      const inset = 12;
      const textWidth = Math.max(1, width - inset * 2);
      const body = this.scene.add.container(inset, inset);
      const panel = this.scene.add.graphics();
      let y = 0;
      const addLine = (value: string, size: number, color: string, gap: number, bold = false, title = false): void => {
        if (!value) return;
        const label = this.scene.add.text(0, y, value, {
          fontFamily: title ? '"Woundbound Title", Georgia, serif' : 'Georgia, serif',
          fontSize: size, fontStyle: bold ? 'bold' : 'normal', color, resolution: 2,
          lineSpacing: 2, wordWrap: { width: textWidth, useAdvancedWrap: true },
        });
        body.add(label);
        y += label.height + gap;
      };
      addLine(content.title, compact ? 17 : 20, '#fff0d4', 5, true, true);
      y += this.addItemTags(body, content.tags, y, textWidth);
      if (content.shape?.length) {
        const shape = this.scene.add.graphics();
        for (const [column, row] of content.shape) {
          shape.fillStyle(0x715849, 1).fillRect(column * 12, y + row * 12, 11, 11);
          shape.lineStyle(1, 0xc9a881, .8).strokeRect(column * 12, y + row * 12, 11, 11);
        }
        const label = this.scene.add.text(Math.max(...content.shape.map(([column]) => column + 1)) * 12 + 10, y + 1, `Занимает клеток: ${content.shape.length}`, {
          fontFamily: 'Georgia, serif', fontSize: 12, color: '#f1e3d3', resolution: 2,
        });
        body.add([shape, label]);
        y += Math.max(16, Math.max(...content.shape.map(([, row]) => row + 1)) * 12) + 9;
      }
      if (content.stats.some(stat => stat.includes('→'))) addLine('База → итог', 10, '#dcc4a3', 3);
      for (const stat of content.stats) addLine(stat, compact ? 12 : 14, '#f4cd82', 2, true);
      y += 5;
      addLine(content.description, compact ? 12 : 14, '#f1e3d3', 5);
      if (content.effects.length) addLine('Модификаторы', 11, '#e6c69a', 3, true);
      for (const effect of content.effects) addLine(effect, compact ? 11 : 13, '#cdbdac', 3);
      for (const active of [true, false]) {
        const relations = content.relations.filter(relation => relation.active === active);
        if (!relations.length) continue;
        y += 5;
        addLine(active ? 'Действующее соседство' : 'Возможное соседство', 11, '#e6c69a', 3, true);
        for (const relation of relations) {
          const marker = active ? (relation.negative ? '!' : '✓') : '◇';
          const color = relation.negative ? '#efac85' : active ? '#90dfb2' : '#d8bb82';
          addLine(`${marker} ${relation.label} · ${relation.detail}`, compact ? 11 : 13, color, 3);
        }
      }
      const maxHeight = Math.max(1, screenHeight - (anchor?.centered ? 96 : screenHeight < 520 ? 68 : 16));
      const scale = Math.min(1, Math.max(1, maxHeight - inset * 2) / Math.max(1, y));
      body.setScale(scale);
      const height = Math.ceil(y * scale + inset * 2);
      panel.fillStyle(0x100c12, .98).fillRoundedRect(0, 0, width, height, 5);
      panel.lineStyle(1, 0xa98b60, .82).strokeRoundedRect(.5, .5, width - 1, height - 1, 5);
      this.root.add([panel, body]);
      this.boxWidth = width;
      this.boxHeight = height;
      this.contentKey = key;
    }
    if (anchor?.centered) {
      this.root.setPosition((screenWidth - this.boxWidth) / 2, (screenHeight - 72 - this.boxHeight) / 2).setVisible(true);
    } else this.placeItemTooltip(pointerX, pointerY, screenWidth, screenHeight, anchor);
    return this.root.y + this.boxHeight;
  }

  private addItemTags(body: Phaser.GameObjects.Container, tags: TooltipTag[], startY: number, width: number): number {
    if (!tags.length) return 0;
    const backing = this.scene.add.graphics();
    body.add(backing);
    let x = 0, y = startY;
    for (const tag of tags) {
      const label = this.scene.add.text(0, 0, tag.label, {
        fontFamily: 'Georgia, serif', fontSize: 10, fontStyle: 'bold', color: tag.color, resolution: 2,
      });
      const chipWidth = Math.min(width, label.width + 10);
      if (x && x + chipWidth > width) { x = 0; y += 18; }
      label.setPosition(x + 5, y + 2);
      if (label.width > chipWidth - 10) label.setScale(Math.max(1, chipWidth - 10) / label.width);
      backing.fillStyle(0x382d36, 1).fillRoundedRect(x, y, chipWidth, 15, 3);
      body.add(label);
      x += chipWidth + 5;
    }
    return y - startY + 21;
  }

  private placeItemTooltip(pointerX: number, pointerY: number, width: number, height: number, anchor?: TooltipAnchor): void {
    const gap = 8;
    const source = anchor ?? { x: pointerX, y: pointerY, width: 0, height: 0 };
    const minY = height < 520 ? 60 : gap;
    const maxX = Math.max(gap, width - this.boxWidth - gap);
    const maxY = Math.max(minY, height - this.boxHeight - gap);
    const clampX = (value: number): number => Math.max(gap, Math.min(maxX, value));
    const clampY = (value: number): number => Math.max(minY, Math.min(maxY, value));
    const centerX = clampX(source.x + (source.width - this.boxWidth) / 2);
    const centerY = clampY(source.y + (source.height - this.boxHeight) / 2);
    const right = source.x + source.width + gap, left = source.x - this.boxWidth - gap;
    const below = source.y + source.height + gap, above = source.y - this.boxHeight - gap;
    const candidates = [
      { x: right, y: centerY }, { x: left, y: centerY },
      { x: centerX, y: below }, { x: centerX, y: above },
    ];
    const free = anchor?.tooltipBounds;
    if (free && free.width >= this.boxWidth && free.height >= this.boxHeight) {
      candidates.unshift({ x: free.x + (free.width - this.boxWidth) / 2, y: free.y });
    }
    if (anchor?.safeTop !== undefined) {
      candidates.unshift({ x: centerX, y: anchor.safeTop });
    }
    const pool = anchor?.poolBounds;
    if (pool) candidates.push({ x: centerX, y: pool.panelTop - gap - this.boxHeight });
    if (pool && pool.bottom - pool.top >= this.boxHeight) {
      const poolY = Math.max(pool.top, Math.min(pool.bottom - this.boxHeight, centerY));
      candidates.unshift({ x: right, y: poolY }, { x: left, y: poolY });
    }
    const fitsViewport = ({ x, y }: { x: number; y: number }): boolean => x >= gap && x <= maxX && y >= minY && y <= maxY;
    const hasClearSource = ({ x, y }: { x: number; y: number }): boolean =>
      x >= right || x <= left || y >= below || y <= above;
    const fits = candidates.filter(fitsViewport).filter(hasClearSource);
    const clearNeighbours = ({ x, y }: { x: number; y: number }): boolean => !(anchor?.avoid ?? []).some(rect =>
      x < rect.x + rect.width && x + this.boxWidth > rect.x && y < rect.y + rect.height && y + this.boxHeight > rect.y);
    const preferred = fits.filter(({ y }) => !pool || (y >= pool.top && y + this.boxHeight <= pool.bottom)
      || y + this.boxHeight <= pool.panelTop - gap);
    const best = preferred.find(clearNeighbours) ?? preferred[0] ?? fits.find(clearNeighbours) ?? fits[0];
    this.root.setPosition(best?.x ?? clampX(right), best?.y ?? clampY(below)).setVisible(true);
  }

  showText(key: string, value: string, pointerX: number, pointerY: number, screenWidth: number, screenHeight: number): void {
    const compact = screenWidth < 520 || screenHeight < 520;
    const lines = value.split('\n');
    const longestLine = Math.max(0, ...lines.map(line => line.length));
    const widthCap = screenWidth < 520 ? 290 : 350;
    const width = Math.max(1, Math.min(screenWidth - 16, widthCap, Math.max(140, longestLine * (compact ? 7 : 8) + 48)));
    const textWidth = Math.max(1, width - 48);
    const label = this.scene.add.text(0, 0, truncate(value, compact ? 220 : 360), {
      fontFamily: 'Georgia, serif', fontSize: compact ? '12px' : '14px', color: '#f1e0c1',
      wordWrap: { width: textWidth }, resolution: 2,
    });
    const topInset = screenHeight < 520 ? 60 : 8;
    const maxHeight = Math.max(1, screenHeight - topInset - 8);
    const height = Math.min(maxHeight, Math.max(Math.min(54, maxHeight), label.height + 32));
    const contentScale = Math.min(1, Math.max(1, height - 32) / Math.max(1, label.height));

    this.clearChildren();
    this.addPanel(width, height);
    label.setPosition(24, 16).setScale(1, contentScale);
    this.root.add(label);
    this.boxWidth = width;
    this.boxHeight = height;
    this.contentKey = `${key}|${value}|${width}|${screenHeight}`;
    this.moveTo(pointerX, pointerY, screenWidth, screenHeight);
  }

  hide(): void {
    if (!this.contentKey) return;
    this.clearChildren();
    this.root.setVisible(false);
  }

  private moveTo(pointerX: number, pointerY: number, screenWidth: number, screenHeight: number): void {
    const margin = Math.min(8, Math.max(2, Math.min(screenWidth, screenHeight) * .025));
    const topInset = screenHeight < 520 ? 60 : margin;
    const gap = 14;
    const anchor = { x: pointerX, y: pointerY, width: 0, height: 0 };
    const maxX = Math.max(margin, screenWidth - this.boxWidth - margin);
    const maxY = Math.max(topInset, screenHeight - this.boxHeight - margin);
    const leftX = anchor.x - this.boxWidth - gap;
    const rightX = anchor.x + anchor.width + gap;
    const aboveY = anchor.y - this.boxHeight - gap;
    const belowY = anchor.y + anchor.height + gap;
    const preferredX = pointerX > screenWidth * .62 ? leftX : rightX;
    const preferredY = pointerY > screenHeight * .40 ? aboveY : belowY;
    const centerX = Math.max(margin, Math.min(maxX, anchor.x + anchor.width / 2 - this.boxWidth / 2));
    const candidates = [[preferredX, preferredY], [preferredX, aboveY], [preferredX, belowY], [leftX, preferredY], [rightX, preferredY], [centerX, aboveY], [centerX, belowY]];
    const fits = candidates.find(([x, y]) => x! >= margin && y! >= topInset && x! + this.boxWidth <= screenWidth - margin && y! + this.boxHeight <= screenHeight - margin);
    const x = Math.max(margin, Math.min(maxX, fits?.[0] ?? preferredX));
    const y = Math.max(topInset, Math.min(maxY, fits?.[1] ?? belowY));
    this.root.setPosition(x, y).setVisible(true);
  }

  private clearChildren(): void {
    this.root.removeAll(true);
    this.contentKey = '';
  }

  private addPanel(width: number, height: number): void {
    const capX = Math.min(76, Math.max(18, Math.floor(width * .24)));
    const capY = Math.min(40, Math.max(4, Math.floor(height * .23)));
    const frame = this.scene.add.nineslice(0, 0, 'ui-tooltip-frame-small', 'trimmed', width, height, capX, capX, capY, capY).setOrigin(0);
    this.root.add(frame);
  }
}
