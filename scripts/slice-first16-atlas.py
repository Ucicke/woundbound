from pathlib import Path
from PIL import Image
import json

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'public/assets/source/raw/items-woundbound-first16-imagegen.png'
DESTINATION = ROOT / 'public/assets/source/items-woundbound-first16-grid.png'
FRAME = 512
PADDING = 24
ITEMS = [
    'blade', 'dagger', 'desperate', 'lantern',
    'mercy', 'heart', 'whetstone', 'spring',
    'parasite-key', 'widow-needle', 'moth-glass', 'hollow-bell',
    'grave-rifle', 'ashen-censer', 'hooked-nail', 'teeth-reliquary',
]

source = Image.open(SOURCE).convert('RGBA')
atlas = Image.new('RGBA', (FRAME * 4, FRAME * 4), (0, 0, 0, 0))
metadata = {}
for frame, item_id in enumerate(ITEMS):
    row, column = divmod(frame, 4)
    left, right = round(column * source.width / 4), round((column + 1) * source.width / 4)
    top, bottom = round(row * source.height / 4), round((row + 1) * source.height / 4)
    cell = source.crop((left, top, right, bottom))
    alpha = cell.getchannel('A').point(lambda value: 255 if value > 16 else 0)
    bounds = alpha.getbbox()
    if not bounds:
        raise RuntimeError(f'Empty sprite: {item_id}')
    sprite = cell.crop(bounds)
    scale = min((FRAME - PADDING * 2) / sprite.width, (FRAME - PADDING * 2) / sprite.height)
    size = (max(1, round(sprite.width * scale)), max(1, round(sprite.height * scale)))
    sprite = sprite.resize(size, Image.Resampling.NEAREST)
    px, py = (FRAME - size[0]) // 2, (FRAME - size[1]) // 2
    atlas.alpha_composite(sprite, (column * FRAME + px, row * FRAME + py))
    metadata[item_id] = {'frame': frame, 'x': px, 'y': py, 'width': size[0], 'height': size[1]}

DESTINATION.parent.mkdir(parents=True, exist_ok=True)
atlas.save(DESTINATION, optimize=True)
print(json.dumps(metadata, indent=2))
