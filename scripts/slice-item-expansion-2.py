from pathlib import Path
from PIL import Image
import json

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'public/assets/source/raw/items-woundbound-expansion-2-imagegen.png'
DEST = ROOT / 'public/assets/source/items-woundbound-expansion-2-grid.png'
FRAME = 512
PADDING = 24

# Row-major sprite identities; the geometry is mirrored in ArtCatalog.ts and
# items.ts. Keep raw generated artwork untouched and only derive this runtime atlas.
ITEMS = [
    ('rust-sickle', 2, 2), ('clockmaker-pendulum', 1, 3), ('cracked-censer', 3, 3), ('windup-mouse', 3, 2),
    ('silver-bullet', 1, 2), ('black-bile', 2, 2), ('brass-monocle', 2, 2), ('bone-whistle', 2, 1),
    ('broken-metronome', 2, 3), ('bloodied-bandage', 3, 2), ('ash-hourglass', 1, 3), ('iron-manacle', 2, 2),
    ('mercury-thermometer', 1, 3), ('music-box-key', 2, 2), ('sinner-mask', 2, 2), ('needleless-compass', 3, 2),
]

source = Image.open(SOURCE).convert('RGBA')
atlas = Image.new('RGBA', (FRAME * 4, FRAME * 4), (0, 0, 0, 0))
metadata = {}
for index, (item_id, footprint_width, footprint_height) in enumerate(ITEMS):
    row, column = divmod(index, 4)
    x0, x1 = round(column * source.width / 4), round((column + 1) * source.width / 4)
    y0, y1 = round(row * source.height / 4), round((row + 1) * source.height / 4)
    cell = source.crop((x0, y0, x1, y1))
    alpha = cell.getchannel('A').point(lambda value: 255 if value > 24 else 0)
    box = alpha.getbbox()
    if not box:
        raise RuntimeError(f'Empty generated sprite: {item_id}')
    sprite = cell.crop(box)
    max_width = FRAME - PADDING * 2
    max_height = FRAME - PADDING * 2
    scale = min(max_width / sprite.width, max_height / sprite.height)
    size = (max(1, round(sprite.width * scale)), max(1, round(sprite.height * scale)))
    sprite = sprite.resize(size, Image.Resampling.LANCZOS)
    sprite.putalpha(sprite.getchannel('A').point(lambda value: 255 if value > 24 else 0))
    px = (FRAME - size[0]) // 2
    py = (FRAME - size[1]) // 2
    atlas.alpha_composite(sprite, (column * FRAME + px, row * FRAME + py))
    metadata[item_id] = {'frame': index, 'x': px, 'y': py, 'width': size[0], 'height': size[1]}

atlas.save(DEST, optimize=True)
print(json.dumps(metadata, ensure_ascii=False, indent=2))
