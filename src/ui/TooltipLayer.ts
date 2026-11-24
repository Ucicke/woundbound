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
  tooltipBounds?: { x: number; y: number; width: number; height: number };
  safeTop?: number;
  poolItem?: boolean;
  poolBottom?: number;
  poolSides?: { left: number; right: number };
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
    if (anchor?.tooltipBounds) {
      this.showContainedDetail(content, anchor.tooltipBounds, screenWidth, screenHeight);
      return;
    }
    const compact = screenWidth < 520 || screenHeight < 520;
    const compactField = compact && anchor?.safeTop !== undefined;
    const widthCap = screenWidth < 520 ? 290 : screenHeight < 520 ? 264 : 400;
    const compactHeight = 148;
    const poolNeedsSide = anchor?.poolBottom !== undefined && anchor.safeTop !== undefined && anchor.safeTop + compactHeight > anchor.poolBottom;
    const sideWidth = poolNeedsSide && anchor
      ? Math.max(anchor.x - (anchor.poolSides?.left ?? 8),
        (anchor.poolSides?.right ?? screenWidth - 8) - anchor.x - anchor.width) - 14
      : widthCap;
    const width = Math.max(1, Math.min(screenWidth - 16, widthCap, sideWidth));
    const bodyCopy = truncate([content.summary, content.description].filter(Boolean).join('\n'), compactField && !anchor?.poolItem ? 88 : compact ? 320 : 520);
    const relationLimit = compactField ? 1 : compact ? 2 : 3;
    const relationDetailLimit = compactField ? 36 : compact ? 92 : 140;
    const relations = content.relations.slice(0, relationLimit).map(relation => ({
      ...relation,
      detail: poolNeedsSide ? relation.detail : truncate(relation.detail, relationDetailLimit),
    }));
    const key = `${content.key}|${content.title}|${content.tags.map(tag => tag.label).join(',')}|${bodyCopy}|${relations.map(relation => `${relation.active ? 1 : 0}:${relation.label}:${relation.detail}`).join('|')}|${width}|${screenHeight}`;
    if (key === this.contentKey) {
      this.moveTo(pointerX, pointerY, screenWidth, screenHeight);
      return;
    }

    const textWidth = Math.max(1, width - 72);
    const body = this.scene.add.text(0, 0, bodyCopy, {
      fontFamily: 'Georgia, serif', fontSize: compactField ? '10px' : compact ? '12px' : '15px', lineSpacing: compactField ? 0 : compact ? 2 : 3,
      color: '#e6d8c4', wordWrap: { width: textWidth }, resolution: 2,
    });
    const relationRows = relations.map(relation => this.scene.add.text(0, 0,
      poolNeedsSide
        ? `${relation.active ? '✓' : '◇'} ${relation.label}\n${relation.detail}`
        : `${relation.active ? '✓' : '◇'} ${relation.label} · ${relation.detail}`, {
      fontFamily: 'Georgia, serif', fontStyle: 'bold', fontSize: compactField ? '9px' : compact ? '12px' : '14px', lineSpacing: compactField ? 0 : compact ? 1 : 2,
      color: relation.color, wordWrap: { width: textWidth }, resolution: 2,
    }));
    const contentTop = compactField ? 50 : 70;
    const bottomInset = 24;
    const topInset = screenHeight < 520 ? 60 : 8;
    const rowHeight = poolNeedsSide && anchor?.poolBottom !== undefined
      ? Math.max(96, anchor.poolBottom - anchor.y)
      : screenHeight;
    const maxHeight = Math.max(1, Math.min(compactField ? compactHeight : screenHeight, rowHeight, screenHeight - topInset - 8));
    if (poolNeedsSide) {
      const availableHeight = maxHeight - contentTop - bottomInset;
      const gap = relationRows.length ? 4 : 0;
      const relationHeight = relationRows.reduce((total, row) => total + row.height, 0);
      const wrapped = body.getWrappedText();
      const lineHeight = body.height / Math.max(1, wrapped.length);
      const summaryLines = content.summary ? body.getWrappedText(content.summary).length : 0;
      const maxLines = Math.max(1, summaryLines, Math.floor((availableHeight - relationHeight - gap) / lineHeight));
      if (wrapped.length > maxLines) {
        if (maxLines <= summaryLines) body.setText(content.summary);
        else {
          const visible = wrapped.slice(0, maxLines);
          visible[maxLines - 1] = visible[maxLines - 1]!.slice(0, -2) + '…';
          body.setText(visible.join('\n'));
        }
      }
    }
    const relationGap = bodyCopy && relationRows.length ? (poolNeedsSide ? 4 : 8) : 0;
    const rowGap = poolNeedsSide ? 0 : compact ? 6 : 8;
    const contentHeight = body.height + relationGap + relationRows.reduce((total, row) => total + row.height + rowGap, 0);
    const requestedHeight = contentTop + contentHeight + bottomInset;
    const minimumHeight = compactField ? 96 : 112;
    const height = Math.min(maxHeight, Math.max(Math.min(minimumHeight, maxHeight), requestedHeight));
    const availableContentHeight = Math.max(1, height - contentTop - bottomInset);
    const contentScale = Math.min(1, availableContentHeight / Math.max(1, contentHeight));

    this.clearChildren();
    this.addPanel(width, height);
    this.addTitle(content.title, width, compact, compactField);
    this.addTags(content.tags, width, compact, compactField);

    const text = this.scene.add.container(36, contentTop);
    if (bodyCopy) text.add(body);
    let contentY = body.height + relationGap;
    relationRows.forEach((row, index) => {
      row.setPosition(0, contentY);
      text.add(row);
      contentY += row.height + rowGap;
    });
    if (!poolNeedsSide) text.setScale(1, contentScale);
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

  private addTitle(value: string, width: number, compact: boolean, compactField = false): void {
    const title = this.scene.add.text(0, 0, value, {
      fontFamily: '"Woundbound Title", Georgia, serif', fontStyle: 'bold', fontSize: compactField ? '14px' : compact ? '17px' : '22px',
      color: '#fff0d4', resolution: 2, stroke: '#171414', strokeThickness: 2,
    });
    if (title.width > width - 72) title.setScale((width - 72) / title.width);
    title.setPosition(36, compactField ? 12 : 22);
    this.root.add(title);
  }

  private addTags(tags: TooltipTag[], width: number, compact: boolean, compactField = false): void {
    const labels = tags.map(tag => this.scene.add.text(0, 0, tag.label, {
      fontFamily: 'Georgia, serif', fontStyle: 'bold', fontSize: compactField ? '9px' : compact ? '10px' : '12px', color: tag.color, resolution: 2,
    }));
    const availableWidth = Math.max(1, width - 72);
    const unscaledWidth = labels.reduce((total, label) => total + label.width + 14, 0) + Math.max(0, labels.length - 1) * 4;
    const tagScale = Math.min(1, availableWidth / Math.max(1, unscaledWidth));
    const background = this.scene.add.graphics();
    const tagY = compactField ? 34 : 47;
    const tagHeight = compactField ? 14 : 18;
    let x = 36;
    labels.forEach(label => {
      label.setScale(tagScale).setPosition(x + 7 * tagScale, tagY + 2 * tagScale);
      const tagWidth = label.displayWidth + 14 * tagScale;
      background.fillStyle(0x17121a, .8).fillRoundedRect(x, tagY, tagWidth, tagHeight * tagScale, 3 * tagScale);
      background.lineStyle(1, 0x8b765c, .65).strokeRoundedRect(x, tagY, tagWidth, tagHeight * tagScale, 3 * tagScale);
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
    if (anchor.poolBottom !== undefined && anchor.safeTop !== undefined && anchor.safeTop + this.boxHeight > anchor.poolBottom) {
      const right = anchor.x + anchor.width + gap;
      const left = anchor.x - this.boxWidth - gap;
      const leftLimit = anchor.poolSides?.left ?? margin;
      const rightLimit = (anchor.poolSides?.right ?? screenWidth - margin) - this.boxWidth;
      const x = right <= rightLimit ? right : Math.max(leftLimit, left);
      const y = Math.max(topInset, anchor.poolBottom - this.boxHeight);
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

  private showContainedDetail(content: ItemTooltipContent, bounds: NonNullable<TooltipAnchor['tooltipBounds']>, screenWidth: number, screenHeight: number): void {
    const width = Math.max(1, Math.min(bounds.width, screenWidth - 16));
    const maxHeight = Math.max(1, Math.min(bounds.height, screenHeight - 16));
    const x = Math.max(8, Math.min(screenWidth - width - 8, bounds.x));
    const y = Math.max(8, Math.min(screenHeight - maxHeight - 8, bounds.y));
    if (maxHeight < 118) {
      this.showInlineDetail(content, x, y, width, maxHeight);
      return;
    }

    const narrow = width < 180;
    const relationLimit = width < 240 ? 1 : 2;
    const detail = [
      content.summary,
      content.description,
      ...content.relations.slice(0, relationLimit).map(relation => `${relation.active ? '✓' : '◇'} ${relation.label} · ${truncate(relation.detail, narrow ? 28 : 140)}`),
    ].filter(Boolean).join('\n');

    const key = `${content.key}|contained|${width}|${maxHeight}|${detail}`;
    if (key === this.contentKey) {
      this.root.setPosition(x, y).setVisible(true);
      return;
    }

    const title = this.scene.add.text(0, 0, content.title, {
      fontFamily: '"Woundbound Title", Georgia, serif', fontStyle: 'bold', fontSize: width < 180 ? '12px' : width < 260 ? '14px' : width < 320 ? '15px' : '17px',
      color: '#fff0d4', resolution: 2, stroke: '#171414', strokeThickness: 2,
    }).setOrigin(.5, 0);
    if (title.width > width - 42) title.setScale((width - 42) / title.width);
    title.setPosition(width / 2, 12);

    const tags = this.scene.add.text(0, 0, truncate(content.tags.map(tag => tag.label).join(' · '), 52), {
      fontFamily: 'Georgia, serif', fontStyle: 'bold', fontSize: width < 180 ? '8px' : width < 260 ? '9px' : '10px',
      color: content.tags[0]?.color ?? '#d8bb82', resolution: 2,
    }).setOrigin(.5, 0);
    if (tags.width > width - 36) tags.setScale((width - 36) / tags.width);
    tags.setPosition(width / 2, 37);

    const body = this.scene.add.text(0, 0, detail, {
      fontFamily: 'Georgia, serif', fontSize: width < 180 ? '8px' : width < 260 ? '9px' : width < 320 ? '10px' : '11px', lineSpacing: 1,
      color: '#e6d8c4', wordWrap: { width: width - 36 }, resolution: 2,
    });
    body.setPosition(18, 57);
    const height = Math.min(maxHeight, Math.max(118, body.y + body.height + 12));
    const availableHeight = Math.max(1, height - body.y - 12);
    if (body.height > availableHeight) body.setScale(1, availableHeight / body.height);

    this.clearChildren();
    const backing = this.scene.add.graphics();
    backing.fillStyle(0x21171d, .985).fillRoundedRect(4, 4, Math.max(1, width - 8), Math.max(1, height - 8), 4);
    this.root.add(backing);
    this.addPanel(width, height);
    this.root.add(title);
    this.root.add(tags);
    this.root.add(body);
    this.boxWidth = width;
    this.boxHeight = height;
    this.contentKey = key;
    this.root.setPosition(x, y).setVisible(true);
  }

  private showInlineDetail(content: ItemTooltipContent, x: number, y: number, width: number, height: number): void {
    const relation = content.description.length < 42 ? content.relations[0] : undefined;
    const lines = [truncate(content.summary, width < 220 ? 44 : 58), content.description,
      ...(relation ? [`${relation.active ? '✓' : '◇'} ${relation.label} · ${truncate(relation.detail, 48)}`] : [])]
      .filter(Boolean);
    const copy = lines.join('\n');
    const key = `${content.key}|inline|${width}|${height}|${copy}`;
    if (key === this.contentKey) {
      this.root.setPosition(x, y).setVisible(true);
      return;
    }

    const backing = this.scene.add.graphics();
    backing.fillStyle(0x21171d, .985).fillRoundedRect(1, 1, Math.max(1, width - 2), Math.max(1, height - 2), 3);
    backing.lineStyle(1, 0x8b765c, .78).strokeRoundedRect(1, 1, Math.max(1, width - 2), Math.max(1, height - 2), 3);
    const showTitle = height >= 85;
    const title = showTitle ? this.scene.add.text(7, 5, content.title, {
      fontFamily: '"Woundbound Title", Georgia, serif', fontStyle: 'bold', fontSize: '13px',
      color: '#fff0d4', resolution: 2,
    }) : undefined;
    if (title && title.width > width - 14) title.setScale((width - 14) / title.width);
    const bodyY = title ? Math.max(23, title.displayHeight + 9) : 4;
    const body = this.scene.add.text(7, bodyY, copy, {
      fontFamily: 'Georgia, serif', fontSize: width < 220 ? '9px' : '10px', lineSpacing: 0,
      color: '#eadfce', wordWrap: { width: Math.max(1, width - 14) }, resolution: 2,
    });
    const availableHeight = Math.max(1, height - bodyY - 4);
    if (body.height > availableHeight) body.setScale(1, availableHeight / body.height);

    this.clearChildren();
    this.root.add(backing);
    if (title) this.root.add(title);
    this.root.add(body);
    this.boxWidth = width;
    this.boxHeight = height;
    this.contentKey = key;
    this.root.setPosition(x, y).setVisible(true);
  }

  private addPanel(width: number, height: number): void {
    const capX = Math.min(76, Math.max(18, Math.floor(width * .24)));
    const capY = Math.min(40, Math.max(4, Math.floor(height * .23)));
    const frame = this.scene.add.nineslice(0, 0, 'ui-tooltip-frame-small', 'trimmed', width, height, capX, capX, capY, capY).setOrigin(0);
    this.root.add(frame);
  }
}
