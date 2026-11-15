import type Phaser from 'phaser';

export interface TooltipTag {
  label: string;
  color: string;
}

export interface TooltipRelation {
  label: string;
  detail: string;
  color: string;
}

export interface ItemTooltipContent {
  key: string;
  title: string;
  tags: TooltipTag[];
  summary: string;
  description: string;
  relations: TooltipRelation[];
}

interface TooltipAnchor { x: number; y: number; width: number; height: number }

/** Owns transient hover UI so pointer feedback never depends on rebuilding the full HUD. */
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
    const compact = screenWidth < 820;
    const width = Math.max(1, Math.min(screenWidth - 32, compact ? 290 : 400));
    const bodyCopy = [content.summary, content.description].filter(Boolean).join('\n');
    const key = `${content.key}|${content.title}|${content.tags.map(tag => tag.label).join(',')}|${bodyCopy}|${content.relations.map(relation => `${relation.label}:${relation.detail}`).join('|')}|${width}|${screenHeight}`;
    if (key === this.contentKey) {
      this.moveTo(pointerX, pointerY, screenWidth, screenHeight);
      return;
    }
    const body = this.scene.add.text(0, 0, bodyCopy, {
      fontFamily: 'Arial, sans-serif', fontSize: compact ? '12px' : '15px', lineSpacing: compact ? 2 : 3, color: '#e6d8c4',
      wordWrap: { width: width - 64 }, resolution: 2,
    });
    const relationHeight = content.relations.length * (compact ? 19 : 22);
    const height = Math.min(screenHeight - 32, Math.max(166, body.height + 122 + relationHeight));

    this.clearChildren();
    this.addPanel(width, height);
      const title = this.scene.add.text(0, 0, content.title, {
        fontFamily: '"Woundbound Title", Georgia, serif', fontStyle: 'bold', fontSize: compact ? '17px' : '22px',
        color: '#fff0d4', resolution: 2, stroke: '#171414', strokeThickness: 2,
      });
      if (title.width > width - 64) title.setScale((width - 64) / title.width);
      title.setPosition(32, 26);
      this.root.add(title);

      let tagX = width - 32;
      for (const tag of [...content.tags].reverse()) {
        const label = this.scene.add.text(tagX, 54, tag.label, {
          fontFamily: 'Arial, sans-serif', fontStyle: 'bold', fontSize: '12px', color: tag.color, resolution: 2,
        }).setOrigin(1, 0);
        if (label.width > width * .33) label.setScale(width * .33 / label.width);
        tagX -= label.displayWidth + 8;
        this.root.add(label);
      }

      body.setPosition(32, 80);
      const maxBodyHeight = Math.max(1, height - 112 - relationHeight);
      if (body.height > maxBodyHeight) body.setScale(Math.max(.45, maxBodyHeight / body.height));
      this.root.add(body);

      let relationY = 88 + body.displayHeight;
      for (const relation of content.relations) {
        const label = this.scene.add.text(32, relationY, relation.label, {
          fontFamily: 'Arial, sans-serif', fontStyle: 'bold', fontSize: compact ? '12px' : '14px', color: relation.color, resolution: 2,
        });
        const detail = this.scene.add.text(36 + label.width, relationY, `· ${relation.detail}`, {
          fontFamily: 'Arial, sans-serif', fontSize: compact ? '12px' : '14px', color: '#e6d8c4', resolution: 2,
        });
        const maxDetailWidth = Math.max(1, width - 68 - label.width);
        if (detail.width > maxDetailWidth) detail.setScale(maxDetailWidth / detail.width);
        this.root.add(label); this.root.add(detail);
        relationY += compact ? 19 : 22;
      }
    this.boxWidth = width; this.boxHeight = height; this.contentKey = key;
    this.moveTo(pointerX, pointerY, screenWidth, screenHeight);
  }

  showText(key: string, value: string, pointerX: number, pointerY: number, screenWidth: number, screenHeight: number): void {
    this.anchor = undefined;
    const longestLine = Math.max(...value.split('\n').map(line => line.length));
    const width = Math.max(1, Math.min(screenWidth - 32, screenWidth < 820 ? 290 : 350, Math.max(170, longestLine * (screenWidth < 820 ? 7 : 8) + 64)));
    const fullKey = `${key}|${value}|${width}|${screenHeight}`;
    if (fullKey === this.contentKey) {
      this.moveTo(pointerX, pointerY, screenWidth, screenHeight);
      return;
    }
    const label = this.scene.add.text(0, 0, value, {
      fontFamily: 'Arial, sans-serif', fontSize: screenWidth < 820 ? '12px' : '14px',
      color: '#f1e0c1', wordWrap: { width: width - 64 }, resolution: 2,
    });
    const height = Math.min(screenHeight - 32, Math.max(76, Math.ceil(label.height + 48)));
    this.clearChildren();
    this.addPanel(width, height);
    label.setPosition(32, 24);
    if (label.height > height - 48) label.setScale(Math.max(.45, (height - 48) / label.height));
    this.root.add(label);
    this.boxWidth = width; this.boxHeight = height; this.contentKey = fullKey;
    this.moveTo(pointerX, pointerY, screenWidth, screenHeight);
  }

  hide(): void {
    if (!this.contentKey) return;
    this.clearChildren();
    this.root.setVisible(false);
  }

  moveTo(pointerX: number, pointerY: number, screenWidth: number, screenHeight: number): void {
    const margin = Math.min(16, Math.max(8, Math.min(screenWidth, screenHeight) * .03));
    const gap = 14;
    const anchor = this.anchor ?? { x: pointerX, y: pointerY, width: 0, height: 0 };
    const leftX = anchor.x - this.boxWidth - gap, rightX = anchor.x + anchor.width + gap;
    const aboveY = anchor.y - this.boxHeight - gap, belowY = anchor.y + anchor.height + gap;
    const preferredX = pointerX > screenWidth * .62 ? leftX : rightX;
    const preferredY = pointerY > screenHeight * .40 ? aboveY : belowY;
    const candidates = [
      [preferredX, preferredY],
      [preferredX, aboveY], [preferredX, belowY],
      [leftX, preferredY], [rightX, preferredY],
      [Math.max(margin, Math.min(screenWidth - this.boxWidth - margin, anchor.x + anchor.width / 2 - this.boxWidth / 2)), aboveY],
      [Math.max(margin, Math.min(screenWidth - this.boxWidth - margin, anchor.x + anchor.width / 2 - this.boxWidth / 2)), belowY],
    ];
    const fits = candidates.find(([x, y]) => x! >= margin && y! >= margin && x! + this.boxWidth <= screenWidth - margin && y! + this.boxHeight <= screenHeight - margin);
    const x = fits?.[0] ?? Math.max(margin, Math.min(screenWidth - this.boxWidth - margin, preferredX));
    const y = fits?.[1] ?? Math.max(margin, Math.min(screenHeight - this.boxHeight - margin, preferredY));
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
