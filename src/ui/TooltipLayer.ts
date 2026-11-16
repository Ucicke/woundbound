import type Phaser from 'phaser';

export interface TooltipTag { label: string; color: string }
export interface TooltipRelation { label: string; detail: string; color: string }
export interface ItemTooltipContent {
  key: string;
  title: string;
  tags: TooltipTag[];
  summary: string;
  description: string;
  relations: TooltipRelation[];
}

interface TooltipAnchor { x: number; y: number; width: number; height: number }
interface ScrollViewport { x: number; y: number; width: number; height: number }

/** Owns transient, viewport-bounded hover UI in Phaser Canvas. */
export class TooltipLayer {
  private readonly root: Phaser.GameObjects.Container;
  private readonly maskGraphic: Phaser.GameObjects.Graphics;
  private readonly scrollMask: Phaser.Display.Masks.GeometryMask;
  private contentKey = '';
  private boxWidth = 0;
  private boxHeight = 0;
  private anchor?: TooltipAnchor;
  private scrollContent?: Phaser.GameObjects.Container;
  private scrollViewport?: ScrollViewport;
  private scrollOffset = 0;
  private maxScroll = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.root = scene.add.container(0, 0).setDepth(1000);
    this.maskGraphic = scene.add.graphics().setVisible(false);
    this.scrollMask = this.maskGraphic.createGeometryMask();
    scene.input.on('wheel', this.onWheel, this);
    scene.events.once('shutdown', () => {
      scene.input.off('wheel', this.onWheel, this);
      this.root.destroy(); this.maskGraphic.destroy(); this.scrollMask.destroy();
    });
  }

  showItem(content: ItemTooltipContent, pointerX: number, pointerY: number, screenWidth: number, screenHeight: number, anchor?: TooltipAnchor): void {
    this.anchor = anchor;
    const compact = screenWidth < 820;
    const width = Math.max(1, Math.min(Math.max(1, screenWidth - 16), compact ? 290 : 400));
    const bodyCopy = [content.summary, content.description].filter(Boolean).join('\n');
    const key = `${content.key}|${content.title}|${content.tags.map(tag => tag.label).join(',')}|${bodyCopy}|${content.relations.map(relation => `${relation.label}:${relation.detail}`).join('|')}|${width}|${screenHeight}`;
    if (key === this.contentKey) {
      this.moveTo(pointerX, pointerY, screenWidth, screenHeight);
      return;
    }

    const body = this.scene.add.text(0, 0, bodyCopy, {
      fontFamily: 'Georgia, serif', fontSize: compact ? '12px' : '15px', lineSpacing: compact ? 2 : 3, color: '#e6d8c4',
      wordWrap: { width: Math.max(1, width - 64) }, resolution: 2,
    });
    const rows: Phaser.GameObjects.Text[] = [];
    let contentHeight = body.height + (bodyCopy ? 8 : 0);
    for (const relation of content.relations) {
      const row = this.scene.add.text(0, 0, `${relation.label} · ${relation.detail}`, {
        fontFamily: 'Georgia, serif', fontStyle: 'bold', fontSize: compact ? '12px' : '14px', lineSpacing: compact ? 1 : 2,
        color: relation.color, wordWrap: { width: Math.max(1, width - 64) }, resolution: 2,
      });
      rows.push(row);
      contentHeight += row.height + (compact ? 6 : 8);
    }
    const maxHeight = Math.max(1, screenHeight - 16);
    const height = Math.min(maxHeight, Math.max(Math.min(166, maxHeight), 104 + contentHeight));
    const viewport: ScrollViewport = { x: 32, y: 78, width: Math.max(1, width - 64), height: Math.max(1, height - 102) };

    this.clearChildren();
    this.scrollOffset = 0;
    this.addPanel(width, height);
    const title = this.scene.add.text(0, 0, content.title, {
      fontFamily: '"Woundbound Title", Georgia, serif', fontStyle: 'bold', fontSize: compact ? '17px' : '22px',
      color: '#fff0d4', resolution: 2, stroke: '#171414', strokeThickness: 2,
    });
    if (title.width > width - 64) title.setScale((width - 64) / title.width);
    title.setPosition(32, 20);
    this.root.add(title);

    const labels = content.tags.map(tag => this.scene.add.text(0, 0, tag.label, {
      fontFamily: 'Georgia, serif', fontStyle: 'bold', fontSize: compact ? '10px' : '12px', color: tag.color, resolution: 2,
    }));
    const availableWidth = Math.max(1, width - 64);
    const unscaledWidth = labels.reduce((total, label) => total + label.width + 14, 0) + Math.max(0, labels.length - 1) * 4;
    const tagScale = Math.min(1, availableWidth / Math.max(1, unscaledWidth));
    const tagBackground = this.scene.add.graphics();
    let tagX = 32;
    for (const label of labels) {
      label.setScale(tagScale).setPosition(tagX + 7 * tagScale, 51 + 2 * tagScale);
      const tagWidth = label.displayWidth + 14 * tagScale;
      tagBackground.fillStyle(0x17121a, .8).fillRoundedRect(tagX, 51, tagWidth, 18 * tagScale, 3 * tagScale);
      tagBackground.lineStyle(1, 0x8b765c, .65).strokeRoundedRect(tagX, 51, tagWidth, 18 * tagScale, 3 * tagScale);
      tagX += tagWidth + 4 * tagScale;
    }
    this.root.add(tagBackground);
    labels.forEach(label => this.root.add(label));

    this.scrollContent = this.scene.add.container(0, 0);
    this.root.add(this.scrollContent);
    let contentY = viewport.y;
    if (bodyCopy) { body.setPosition(viewport.x, contentY); this.scrollContent.add(body); contentY += body.height + (content.relations.length ? 8 : 0); }
    rows.forEach((row, index) => {
      row.setPosition(viewport.x, contentY);
      this.scrollContent!.add(row);
      contentY += row.height + (compact ? 6 : 8);
    });
    this.scrollViewport = viewport;
    this.maxScroll = Math.max(0, contentY - viewport.y - viewport.height);
    this.scrollContent.setMask(this.scrollMask);
    if (this.maxScroll > 0) this.addScrollHint(width, height, compact);
    this.boxWidth = width; this.boxHeight = height; this.contentKey = key;
    this.moveTo(pointerX, pointerY, screenWidth, screenHeight);
  }

  showText(key: string, value: string, pointerX: number, pointerY: number, screenWidth: number, screenHeight: number): void {
    this.anchor = undefined;
    const compact = screenWidth < 820;
    const longestLine = Math.max(0, ...value.split('\n').map(line => line.length));
    const width = Math.max(1, Math.min(Math.max(1, screenWidth - 16), compact ? 290 : 350, Math.max(170, longestLine * (compact ? 7 : 8) + 64)));
    const fullKey = `${key}|${value}|${width}|${screenHeight}`;
    if (fullKey === this.contentKey) { this.moveTo(pointerX, pointerY, screenWidth, screenHeight); return; }
    const label = this.scene.add.text(0, 0, value, {
      fontFamily: 'Georgia, serif', fontSize: compact ? '12px' : '14px', color: '#f1e0c1',
      wordWrap: { width: Math.max(1, width - 64) }, resolution: 2,
    });
    const maxHeight = Math.max(1, screenHeight - 16);
    const height = Math.min(maxHeight, Math.max(Math.min(76, maxHeight), Math.ceil(label.height + 48)));
    const viewport: ScrollViewport = { x: 32, y: 24, width: Math.max(1, width - 64), height: Math.max(1, height - 48) };
    this.clearChildren();
    this.scrollOffset = 0;
    this.addPanel(width, height);
    this.scrollContent = this.scene.add.container(0, 0);
    label.setPosition(viewport.x, viewport.y);
    this.scrollContent.add(label);
    this.root.add(this.scrollContent);
    this.scrollViewport = viewport;
    this.maxScroll = Math.max(0, label.height - viewport.height);
    this.scrollContent.setMask(this.scrollMask);
    if (this.maxScroll > 0) this.addScrollHint(width, height, compact);
    this.boxWidth = width; this.boxHeight = height; this.contentKey = fullKey;
    this.moveTo(pointerX, pointerY, screenWidth, screenHeight);
  }

  hide(): void {
    if (!this.contentKey) return;
    this.clearChildren();
    this.root.setVisible(false);
  }

  moveTo(pointerX: number, pointerY: number, screenWidth: number, screenHeight: number): void {
    const margin = Math.min(8, Math.max(2, Math.min(screenWidth, screenHeight) * .025));
    const gap = 14;
    const anchor = this.anchor ?? { x: pointerX, y: pointerY, width: 0, height: 0 };
    const leftX = anchor.x - this.boxWidth - gap, rightX = anchor.x + anchor.width + gap;
    const aboveY = anchor.y - this.boxHeight - gap, belowY = anchor.y + anchor.height + gap;
    const preferredX = pointerX > screenWidth * .62 ? leftX : rightX;
    const preferredY = pointerY > screenHeight * .40 ? aboveY : belowY;
    const maxX = Math.max(margin, screenWidth - this.boxWidth - margin);
    const maxY = Math.max(margin, screenHeight - this.boxHeight - margin);
    const candidates = [
      [preferredX, preferredY], [preferredX, aboveY], [preferredX, belowY], [leftX, preferredY], [rightX, preferredY],
      [Math.max(margin, Math.min(maxX, anchor.x + anchor.width / 2 - this.boxWidth / 2)), aboveY],
      [Math.max(margin, Math.min(maxX, anchor.x + anchor.width / 2 - this.boxWidth / 2)), belowY],
    ];
    const fits = candidates.find(([x, y]) => x! >= margin && y! >= margin && x! + this.boxWidth <= screenWidth - margin && y! + this.boxHeight <= screenHeight - margin);
    const x = Math.max(margin, Math.min(maxX, fits?.[0] ?? preferredX));
    const y = Math.max(margin, Math.min(maxY, fits?.[1] ?? preferredY));
    this.root.setPosition(x, y).setVisible(true);
    this.updateScrollMask();
  }

  private onWheel(pointer: Phaser.Input.Pointer, _objects: Phaser.GameObjects.GameObject[], _deltaX: number, deltaY: number, _deltaZ: number, event?: WheelEvent): void {
    if (!this.root.visible || !this.scrollViewport || this.maxScroll <= 0) return;
    const box = this.scrollViewport;
    const x = this.root.x + box.x, y = this.root.y + box.y;
    if (pointer.x < x || pointer.x > x + box.width || pointer.y < y || pointer.y > y + box.height) return;
    this.scrollOffset = Math.max(0, Math.min(this.maxScroll, this.scrollOffset + deltaY));
    this.scrollContent?.setPosition(0, -this.scrollOffset);
    event?.preventDefault();
  }

  private updateScrollMask(): void {
    const viewport = this.scrollViewport;
    if (!viewport) return;
    this.maskGraphic.clear().fillStyle(0xffffff, 1).fillRect(
      this.root.x + viewport.x, this.root.y + viewport.y, viewport.width, viewport.height,
    );
  }

  private addScrollHint(width: number, height: number, compact: boolean): void {
    const hint = this.scene.add.text(width / 2, height - 18, 'Колесо мыши · прокрутка', {
      fontFamily: 'Georgia, serif', fontSize: compact ? '9px' : '10px', color: '#b5a38c', resolution: 2,
    }).setOrigin(.5, .5);
    this.root.add(hint);
  }

  private clearChildren(): void {
    this.root.removeAll(true);
    this.scrollContent = undefined;
    this.scrollViewport = undefined;
    this.maxScroll = 0;
    this.contentKey = '';
  }

  private addPanel(width: number, height: number): void {
    const capX = Math.min(76, Math.max(18, Math.floor(width * .24)));
    const capY = Math.min(40, Math.max(4, Math.floor(height * .23)));
    const frame = this.scene.add.nineslice(0, 0, 'ui-tooltip-frame-small', 'trimmed', width, height, capX, capX, capY, capY).setOrigin(0);
    this.root.add(frame);
  }
}
