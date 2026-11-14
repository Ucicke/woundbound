import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const files = {
  raw: 'public/assets/source/raw/items-woundbound-imagegen.png',
  grid: 'public/assets/source/items-woundbound-grid.png',
  first16Raw: 'public/assets/source/raw/items-woundbound-first16-imagegen.png',
  first16Grid: 'public/assets/source/items-woundbound-first16-grid.png',
  extraRaw: 'public/assets/source/raw/items-woundbound-expansion-imagegen.png',
  extraGrid: 'public/assets/source/items-woundbound-expansion-grid.png',
  extra2Raw: 'public/assets/source/raw/items-woundbound-expansion-2-pixel-imagegen.png',
  extra2Grid: 'public/assets/source/items-woundbound-expansion-2-grid.png',
  extra3Raw: 'public/assets/source/raw/items-woundbound-expansion-3-imagegen.png',
  extra3Grid: 'public/assets/source/items-woundbound-expansion-3-grid.png',
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

if (process.argv.includes('--items')) {
  const rawDimensions = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,pix_fmt', '-of', 'csv=s=,:p=0', files.raw]);
  if (!rawDimensions.endsWith(',rgba')) throw new Error(`${files.raw}: expected readable RGBA source, got ${rawDimensions}`);
  console.log(`PASS ${files.raw} preserved RGBA source (${rawDimensions.split(',').slice(0, 2).join('x')})`);
  validate(files.grid, 2048, 1024, 4, 2);
} else if (process.argv.includes('--first16')) {
  const rawDimensions = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,pix_fmt', '-of', 'csv=s=,:p=0', files.first16Raw]);
  if (rawDimensions !== '1254,1254,rgba') throw new Error(`${files.first16Raw}: expected preserved 1254x1254 RGBA source, got ${rawDimensions}`);
  console.log(`PASS ${files.first16Raw} preserved RGBA source (1254x1254)`);
  validate(files.first16Grid, 2048, 2048, 4, 4);
} else if (process.argv.includes('--expansion')) {
  const rawDimensions = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,pix_fmt', '-of', 'csv=s=,:p=0', files.extraRaw]);
  if (rawDimensions !== '1774,887,rgba') throw new Error(`${files.extraRaw}: expected preserved 1774x887 RGBA source, got ${rawDimensions}`);
  console.log(`PASS ${files.extraRaw} preserved RGBA source (1774x887)`);
  validate(files.extraGrid, 2048, 1024, 4, 2);
} else if (process.argv.includes('--expansion-2')) {
  const rawDimensions = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,pix_fmt', '-of', 'csv=s=,:p=0', files.extra2Raw]);
  if (rawDimensions !== '1263,1245,rgb24') throw new Error(`${files.extra2Raw}: expected preserved 1263x1245 RGB source, got ${rawDimensions}`);
  console.log(`PASS ${files.extra2Raw} preserved RGB source (1263x1245)`);
  validate(files.extra2Grid, 2048, 2048, 4, 4);
} else if (process.argv.includes('--expansion-3')) {
  const rawDimensions = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,pix_fmt', '-of', 'csv=s=,:p=0', files.extra3Raw]);
  if (rawDimensions !== '1247,1261,rgb24') throw new Error(`${files.extra3Raw}: expected preserved 1247x1261 RGB source, got ${rawDimensions}`);
  console.log(`PASS ${files.extra3Raw} preserved RGB source (1247x1261)`);
  validate(files.extra3Grid, 2048, 2048, 4, 4);
} else if (process.argv.includes('--actors')) {
  const rawDimensions = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,pix_fmt', '-of', 'csv=s=,:p=0', files.actorRaw]);
  if (rawDimensions !== '1086,1448,rgba') throw new Error(`${files.actorRaw}: expected preserved 1086x1448 RGBA source, got ${rawDimensions}`);
  console.log(`PASS ${files.actorRaw} preserved RGBA source (1086x1448)`);
  validate(files.actorAtlas, 1536, 2048, 6, 8);
} else if (process.argv.includes('--class-items')) {
  for (const atlas of files.classItems) {
    const rawDimensions = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,pix_fmt', '-of', 'csv=s=,:p=0', atlas.raw]);
    if (rawDimensions !== '1254,1254,rgba') throw new Error(`${atlas.raw}: expected preserved 1254x1254 RGBA source, got ${rawDimensions}`);
    console.log(`PASS ${atlas.raw} preserved RGBA source (1254x1254)`);
    if (atlas.grid) validate(atlas.grid, 2048, 2048, 4, 4);
  }
} else {
  console.log('Usage: node scripts/validate-pixel-assets.mjs --items|--first16|--expansion|--expansion-2|--expansion-3|--actors|--class-items');
  process.exitCode = 2;
}
