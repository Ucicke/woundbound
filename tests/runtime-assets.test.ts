import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest: string[] = JSON.parse(readFileSync('scripts/runtime-assets.json', 'utf8'));
const sourceFiles = ['src/scenes/CombatScene.ts', 'src/presentation/ArtCatalog.ts', 'src/presentation/ClassItemArt.ts'];

describe('production runtime assets', () => {
  it('contains every literal asset referenced by the loader and no missing source files', () => {
    expect(new Set(manifest).size).toBe(manifest.length);
    for (const asset of manifest) expect(existsSync(`public/${asset}`), asset).toBe(true);
    for (const source of sourceFiles) {
      const code = readFileSync(source, 'utf8');
      for (const match of code.matchAll(/['"]\/(assets\/[^'"$]+\.(?:png|ogg|ttf))['"]/g)) {
        expect(manifest, `${source}: ${match[1]}`).toContain(match[1]);
      }
    }
  });

  it('includes the variants resolved dynamically by class, orientation and location', () => {
    const dynamic = [
      ...['guard', 'huntress', 'pilgrim', 'clockmaker'].map(name => `assets/ui/dead-portrait-${name}.png`),
      ...['guard-gothic-pixel', 'huntress-gothic-pixel', 'pilgrim-gothic-pixel', 'clockmaker-modular'].map(name => `assets/ui/dashboard-${name}.png`),
      ...['desktop', 'portrait'].map(name => `assets/ui/opening-${name}-refined.png`),
      ...['cave', 'cult-base', 'clockwork-foundry'].map(name => `assets/location-${name}.png`),
      ...['gear-1', 'gear-2', 'gear-3', 'wind-1', 'wind-2', 'press-1', 'press-2', 'lock-open', 'door-open'].map(name => `assets/audio/sfx/${name}.ogg`),
      'assets/fonts/CormorantUnicase-Bold.ttf',
    ];
    for (const asset of dynamic) expect(manifest).toContain(asset);
  });
});
