import type Phaser from 'phaser';

export interface TooltipTag { label: string; color: string }
export interface TooltipRelation { label: string; detail: string; color: string; active?: boolean }
export interface ItemTooltipContent {
  key: string;
  title: string;
  tags: TooltipTag[];
  summary: string;
  description: string;
  relations: TooltipRelation[];
}

interface TooltipAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
  reward?: boolean;
  safeTop?: number;
}

const truncate = (value: string, maxLength: number): string =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1).trimEnd()}…` : value;

/** Owns short, viewport-bounded hover cards rendered by Phaser. */
export class TooltipLayer {
  private readonly root: Phaser.GameObjects.Container;
  private contentKey = '';
  private boxWidth = 0;
  private boxHeight = 0;
  private anchor?: TooltipAnchor;

  constructor(private readonly scene: Phaser.Scene) {
    this.root = scene.add.container(0, 0).setDepth(1000);
    scene.events.once('shutdown', () => this.root.destroy());
  }

  showItem(content: ItemTooltipContent, pointerX: number, pointerY: number, screenWidth: number, screenHeight: number, anchor?: TooltipAnchor): void {
    this.anchor = anchor;
    const compact = screenWidth < 520 || screenHeight < 520;
    const widthCap = screenWidth < 520 ? 290 : screenHeight < 520 ? 264 : 400;
    const width = Math.max(1, Math.min(screenWidth - 16, widthCap));
    const bodyCopy = truncate([content.summary, content.description].filter(Boolean).join('\n'), compact ? 320 : 520);
    const relations = content.relations.slice(0, compact ? 2 : 3).map(relation => ({
      ...relation,
      detail: truncate(relation.detail, compact ? 92 : 140),
    }));
    const key = `${content.key}|${content.title}|${content.tags.map(tag => tag.label).join(',')}|${bodyCopy}|${relations.map(relation => `${relation.active ? 1 : 0}:${relation.label}:${relation.detail}`).join('|')}|${width}|${screenHeight}`;
    if (key === this.contentKey) {
      this.moveTo(pointerX, pointerY, screenWidth, screenHeight);
      return;
    }

    const textWidth = Math.max(1, width - 72);
    const body = this.scene.add.text(0, 0, bodyCopy, {
      fontFamily: 'Georgia, serif', fontSize: compact ? '12px' : '15px', lineSpacing: compact ? 2 : 3,
      color: '#e6d8c4', wordWrap: { width: textWidth }, resolution: 2,
    });
    const relationRows = relations.map(relation => this.scene.add.text(0, 0, `${relation.active ? '✓' : '◇'} ${relation.label} · ${relation.detail}`, {
      fontFamily: 'Georgia, serif', fontStyle: 'bold', fontSize: compact ? '12px' : '14px', lineSpacing: compact ? 1 : 2,
      color: relation.color, wordWrap: { width: textWidth }, resolution: 2,
    }));
    const contentHeight = body.height + (bodyCopy && relationRows.length ? 8 : 0)
      + relationRows.reduce((total, row) => total + row.height + (compact ? 6 : 8), 0);
    const contentTop = 70;
    const bottomInset = 20;
    const topInset = screenHeight < 520 ? 60 : 8;
    const maxHeight = Math.max(1, screenHeight - topInset - 8);
    const requestedHeight = contentTop + contentHeight + bottomInset;
    const height = Math.min(maxHeight, Math.max(Math.min(112, maxHeight), requestedHeight));
    const availableContentHeight = Math.max(1, height - contentTop - bottomInset);
    const contentScale = Math.min(1, availableContentHeight / Math.max(1, contentHeight));

    this.clearChildren();
    this.addPanel(width, height);
    this.addTitle(content.title, width, compact);
    this.addTags(content.tags, width, compact);

    const text = this.scene.add.container(36, contentTop);
    if (bodyCopy) text.add(body);
    let contentY = body.height + (bodyCopy && relationRows.length ? 8 : 0);
    relationRows.forEach((row, index) => {
      row.setPosition(0, contentY);
      text.add(row);
      contentY += row.height + (compact ? 6 : 8);
    });
    text.setScale(1, contentScale);
    this.root.add(text);
    this.boxWidth = width;
    this.boxHeight = height;
    this.contentKey = key;
    this.moveTo(pointerX, pointerY, screenWidth, screenHeight);
  }

  showText(key: string, value: string, pointerX: number, pointerY: number, screenWidth: number, screenHeight: number): void {
    this.anchor = undefined;
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

  private addTitle(value: string, width: number, compact: boolean): void {
    const title = this.scene.add.text(0, 0, value, {
      fontFamily: '"Woundbound Title", Georgia, serif', fontStyle: 'bold', fontSize: compact ? '17px' : '22px',
      color: '#fff0d4', resolution: 2, stroke: '#171414', strokeThickness: 2,
    });
    if (title.width > width - 72) title.setScale((width - 72) / title.width);
    title.setPosition(36, 22);
    this.root.add(title);
  }

  private addTags(tags: TooltipTag[], width: number, compact: boolean): void {
    const labels = tags.map(tag => this.scene.add.text(0, 0, tag.label, {
      fontFamily: 'Georgia, serif', fontStyle: 'bold', fontSize: compact ? '10px' : '12px', color: tag.color, resolution: 2,
    }));
    const availableWidth = Math.max(1, width - 72);
    const unscaledWidth = labels.reduce((total, label) => total + label.width + 14, 0) + Math.max(0, labels.length - 1) * 4;
    const tagScale = Math.min(1, availableWidth / Math.max(1, unscaledWidth));
    const background = this.scene.add.graphics();
    let x = 36;
    labels.forEach(label => {
      label.setScale(tagScale).setPosition(x + 7 * tagScale, 47 + 2 * tagScale);
      const tagWidth = label.displayWidth + 14 * tagScale;
      background.fillStyle(0x17121a, .8).fillRoundedRect(x, 47, tagWidth, 18 * tagScale, 3 * tagScale);
      background.lineStyle(1, 0x8b765c, .65).strokeRoundedRect(x, 47, tagWidth, 18 * tagScale, 3 * tagScale);
      x += tagWidth + 4 * tagScale;
    });
    this.root.add(background);
    this.root.add(labels);
  }

  private moveTo(pointerX: number, pointerY: number, screenWidth: number, screenHeight: number): void {
    const margin = Math.min(8, Math.max(2, Math.min(screenWidth, screenHeight) * .025));
    const topInset = screenHeight < 520 ? 60 : margin;
    const gap = 14;
    const anchor = this.anchor ?? { x: pointerX, y: pointerY, width: 0, height: 0 };
    const maxX = Math.max(margin, screenWidth - this.boxWidth - margin);
    const maxY = Math.max(topInset, screenHeight - this.boxHeight - margin);
    if (anchor.reward) {
      const x = Math.max(margin, Math.min(maxX, anchor.x + 8));
      const aboveY = anchor.y - this.boxHeight - gap;
      const belowY = anchor.y + anchor.height + gap;
      const y = aboveY >= topInset ? aboveY : Math.max(topInset, Math.min(maxY, belowY));
      this.root.setPosition(x, y).setVisible(true);
      return;
    }

    if (anchor && screenWidth < 520 && screenHeight >= 520) {
      const x = Math.max(margin, Math.min(maxX, (screenWidth - this.boxWidth) / 2));
      const y = Math.max(topInset, Math.min(maxY, anchor.safeTop ?? screenHeight * .6));
      this.root.setPosition(x, y).setVisible(true);
      return;
    }

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
