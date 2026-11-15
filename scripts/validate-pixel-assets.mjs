import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const files = {
  actorRaw: 'public/assets/source/raw/combat-actors/woundbound-actor-states-imagegen.png',
  actorAtlas: 'public/assets/actors-woundbound-states-atlas.png',
  classItems: [
    { id: 'guard', raw: 'public/assets/source/raw/items-woundbound-class-guard-imagegen.png', grid: 'public/assets/source/items-woundbound-class-guard-grid.png' },
    { id: 'huntress', raw: 'public/assets/source/raw/items-woundbound-class-huntress-imagegen.png', grid: 'public/assets/source/items-woundbound-class-huntress-grid.png' },
    { id: 'pilgrim', raw: 'public/assets/source/raw/items-woundbound-class-pilgrim-imagegen.png', grid: 'public/assets/source/items-woundbound-class-pilgrim-grid.png' },
    { id: 'clockmaker', raw: 'public/assets/source/raw/items-woundbound-class-clockmaker-imagegen.png', grid: 'public/assets/source/items-woundbound-class-clockmaker-grid.png' },
    { id: 'glass-eye', raw: 'public/assets/source/raw/items-woundbound-glass-eye-transparent-imagegen.png' },
  ],
};

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `${command} failed`);
  return result.stdout.trim();
}

function validate(path, expectedWidth, expectedHeight, columns, rows) {
  if (!existsSync(path)) throw new Error(`Missing asset: ${path}`);
  const dimensions = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,pix_fmt', '-of', 'csv=s=,:p=0', path]);
  const [width, height, format] = dimensions.split(',');
  if (+width !== expectedWidth || +height !== expectedHeight) throw new Error(`${path}: expected ${expectedWidth}x${expectedHeight}, got ${width}x${height}`);
  if (format !== 'rgba') throw new Error(`${path}: expected RGBA, got ${format}`);
  const pixels = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { encoding: 'buffer', maxBuffer: expectedWidth * expectedHeight * 4 + 1024 });
  if (pixels.status !== 0 || pixels.stdout.length !== expectedWidth * expectedHeight * 4) throw new Error(`${path}: RGBA decode failed`);
  const bytes = pixels.stdout;
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const x0 = Math.floor(col * expectedWidth / columns), x1 = Math.floor((col + 1) * expectedWidth / columns);
    const y0 = Math.floor(row * expectedHeight / rows), y1 = Math.floor((row + 1) * expectedHeight / rows);
    let opaque = 0, transparent = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const alpha = bytes[(y * expectedWidth + x) * 4 + 3];
      if (alpha) opaque++; else transparent++;
    }
    if (!opaque) throw new Error(`${path}: frame ${row * columns + col} is empty`);
    if (!transparent) throw new Error(`${path}: frame ${row * columns + col} has no transparent background/gutter`);
    for (let x = x0; x < x1; x++) for (const y of [y0, y1 - 1]) {
      if (bytes[(y * expectedWidth + x) * 4 + 3] !== 0) throw new Error(`${path}: frame ${row * columns + col} touches a horizontal frame edge`);
    }
    for (let y = y0; y < y1; y++) for (const x of [x0, x1 - 1]) {
      if (bytes[(y * expectedWidth + x) * 4 + 3] !== 0) throw new Error(`${path}: frame ${row * columns + col} touches a vertical frame edge`);
    }
  }
  console.log(`PASS ${path} ${width}x${height} RGBA, ${columns * rows} occupied transparent frames`);
}

function assertTransparentRegion(path, imageWidth, imageHeight, left, top, right, bottom, label) {
  const pixels = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], {
    encoding: 'buffer', maxBuffer: imageWidth * imageHeight * 4 + 1024,
  });
  if (pixels.status !== 0 || pixels.stdout.length !== imageWidth * imageHeight * 4) throw new Error(`${path}: RGBA decode failed while checking ${label}`);
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    if (pixels.stdout[(y * imageWidth + x) * 4 + 3] !== 0) throw new Error(`${path}: ${label} is not transparent at ${x},${y}`);
  }
  console.log(`PASS ${path}: ${label} is transparent`);
}

function validateStandaloneSprite(path) {
  if (!existsSync(path)) throw new Error(`Missing asset: ${path}`);
  const dimensions = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,pix_fmt', '-of', 'csv=s=,:p=0', path]);
  const [width, height, format] = dimensions.split(',');
  if (format !== 'rgba') throw new Error(`${path}: expected RGBA, got ${format}`);
  validate(path, +width, +height, 1, 1);
}

if (process.argv.includes('--actors')) {
  const rawDimensions = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,pix_fmt', '-of', 'csv=s=,:p=0', files.actorRaw]);
  if (rawDimensions !== '1086,1448,rgba') throw new Error(`${files.actorRaw}: expected preserved 1086x1448 RGBA source, got ${rawDimensions}`);
  console.log(`PASS ${files.actorRaw} preserved RGBA source (1086x1448)`);
  validate(files.actorAtlas, 1536, 2048, 6, 8);
  assertTransparentRegion(files.actorAtlas, 1536, 2048, 0, 1024, 1536, 1135, 'rat-row spill guard');
} else if (process.argv.includes('--class-items')) {
  for (const atlas of files.classItems) {
    const rawDimensions = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,pix_fmt', '-of', 'csv=s=,:p=0', atlas.raw]);
    if (rawDimensions !== '1254,1254,rgba') throw new Error(`${atlas.raw}: expected preserved 1254x1254 RGBA source, got ${rawDimensions}`);
    console.log(`PASS ${atlas.raw} preserved RGBA source (1254x1254)`);
    if (atlas.grid) validate(atlas.grid, 2048, 2048, 4, 4);
  }
} else if (process.argv.includes('--class-ornaments')) {
  validate('public/assets/ui-class-ornaments.png', 1280, 1280, 2, 2);
} else if (process.argv.includes('--resource-modules')) {
  const single = 'public/assets/ui/clockmaker-tube-single.png';
  const double = 'public/assets/ui/clockmaker-tube-double.png';
  validate(single, 1840, 391, 1, 1);
  validate(double, 1888, 412, 1, 1);
  assertTransparentRegion(single, 1840, 391, 600, 150, 800, 230, 'single tube interior');
  assertTransparentRegion(double, 1888, 412, 600, 120, 800, 200, 'double upper interior');
  assertTransparentRegion(double, 1888, 412, 600, 325, 800, 340, 'double lower interior');
} else if (process.argv.includes('--class-frames')) {
  const path = 'public/assets/ui-class-frames.png';
  validate(path, 1280, 1280, 2, 2);
  for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
    assertTransparentRegion(path, 1280, 1280, col * 640 + 250, row * 640 + 250, col * 640 + 390, row * 640 + 390, `frame ${row * 2 + col} center`);
  }
} else if (process.argv.includes('--puppet-deaths')) {
  const raw = 'public/assets/source/raw/puppet-deaths-atlas-imagegen.png';
  const rawDimensions = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,pix_fmt', '-of', 'csv=s=,:p=0', raw]);
  if (rawDimensions !== '1261,1247,rgba') throw new Error(`${raw}: expected untouched 1261x1247 RGBA source, got ${rawDimensions}`);
  console.log(`PASS ${raw} preserved RGBA source (1261x1247)`);
  validate('public/assets/puppet-deaths-atlas.png', 1280, 1280, 2, 2);
  for (const name of ['guard', 'huntress', 'pilgrim', 'clockmaker']) {
    validateStandaloneSprite(`public/assets/ui/dead-portrait-${name}.png`);
  }
} else {
  console.log('Usage: node scripts/validate-pixel-assets.mjs --actors|--class-items|--class-ornaments|--class-frames|--resource-modules|--puppet-deaths');
  process.exitCode = 2;
}
