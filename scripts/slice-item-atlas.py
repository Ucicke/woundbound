from pathlib import Path
from PIL import Image, ImageDraw
import argparse
import json
from collections import Counter

ROOT = Path(__file__).resolve().parents[1]
FRAME = 512
PADDING = 24

SHEETS = {
    'restyle': {
        'source': 'public/assets/source/raw/items-woundbound-expansion-2-pixel-imagegen.png',
        'destination': 'public/assets/source/items-woundbound-expansion-2-grid.png',
        'items': [
            ('rust-sickle', 2, 2), ('clockmaker-pendulum', 1, 3), ('cracked-censer', 3, 3), ('windup-mouse', 3, 2),
            ('silver-bullet', 1, 2), ('black-bile', 2, 2), ('brass-monocle', 2, 2), ('bone-whistle', 2, 2),
            ('broken-metronome', 2, 2), ('bloodied-bandage', 2, 2), ('ash-hourglass', 2, 2), ('iron-manacle', 2, 2),
            ('mercury-thermometer', 1, 2), ('music-box-key', 2, 2), ('sinner-mask', 2, 2), ('needleless-compass', 2, 2),
        ],
    },
    'new': {
        'source': 'public/assets/source/raw/items-woundbound-expansion-3-imagegen.png',
        'destination': 'public/assets/source/items-woundbound-expansion-3-grid.png',
        'overrides': {
            'powder-horn': 'public/assets/source/raw/items-woundbound-powder-horn-transparent-imagegen.png',
        },
        'items': [
            ('leather-prayerbook', 2, 2), ('two-faced-coin', 1, 1), ('raven-claw', 2, 2), ('sealed-writ', 1, 2),
            ('hunter-jaw-trap', 3, 2), ('powder-horn', 2, 2), ('copper-handbell', 1, 2), ('glass-eye', 1, 1),
            ('garlic-braid', 1, 3), ('reliquary-cross', 3, 3), ('executioner-tongs', 2, 2), ('clockwork-coil', 2, 2),
            ('copper-wire-loop', 2, 2), ('silver-spoon', 2, 2), ('blackthorn-fork', 3, 3), ('bone-rosary', 2, 3),
        ],
    },
}

def remove_flat_checkerboard(image):
    """Remove a baked near-white checkerboard without eating outlined ivory art."""
    if image.mode == 'RGBA':
        return image
    rgb = image.convert('RGB')
    width, height = rgb.size
    pixels = rgb.load()
    counts = Counter(rgb.getdata())
    # ImageGen sometimes bakes the neutral checkerboard into the sheet. Remove
    # common checker colors anywhere (including enclosed holes), plus softer
    # near-neutral pixels connected to the sheet edge. Isolated pale pixels may
    # be real highlights, so never key every bright pixel globally.
    baked_background = {
        color for color, count in counts.items()
        if min(color) >= 220 and max(color) - min(color) <= 18 and count >= 20000
    }
    candidate = Image.new('L', (width, height), 0)
    mask_pixels = candidate.load()
    for y in range(height):
        for x in range(width):
            r, g, b = pixels[x, y]
            if min(r, g, b) >= 210 and max(r, g, b) - min(r, g, b) <= 36:
                mask_pixels[x, y] = 1

    seed = next(((x, 0) for x in range(width) if mask_pixels[x, 0] == 1), None)
    if seed is None:
        seed = next(((x, height - 1) for x in range(width) if mask_pixels[x, height - 1] == 1), None)
    if seed is None:
        raise RuntimeError('No checkerboard seed found along image border')
    ImageDraw.floodfill(candidate, seed, 2, thresh=0)
    alpha = Image.new('L', (width, height), 255)
    alpha_pixels = alpha.load()
    for y in range(height):
        for x in range(width):
            color = pixels[x, y]
            if mask_pixels[x, y] == 2 or color in baked_background:
                alpha_pixels[x, y] = 0
    result = rgb.convert('RGBA')
    result.putalpha(alpha)
    return result

def build(sheet):
    source_path = ROOT / sheet['source']
    dest_path = ROOT / sheet['destination']
    source = remove_flat_checkerboard(Image.open(source_path))
    atlas = Image.new('RGBA', (FRAME * 4, FRAME * 4), (0, 0, 0, 0))
    metadata = {}
    for index, (item_id, footprint_width, footprint_height) in enumerate(sheet['items']):
        row, column = divmod(index, 4)
        x0, x1 = round(column * source.width / 4), round((column + 1) * source.width / 4)
        y0, y1 = round(row * source.height / 4), round((row + 1) * source.height / 4)
        override_path = sheet.get('overrides', {}).get(item_id)
        cell = Image.open(ROOT / override_path).convert('RGBA') if override_path else source.crop((x0, y0, x1, y1))
        alpha = cell.getchannel('A').point(lambda value: 255 if value > 24 else 0)
        box = alpha.getbbox()
        if not box:
            raise RuntimeError(f'Empty generated sprite: {item_id}')
        sprite = cell.crop(box)
        max_width = FRAME - PADDING * 2
        max_height = FRAME - PADDING * 2
        scale = min(max_width / sprite.width, max_height / sprite.height)
        size = (max(1, round(sprite.width * scale)), max(1, round(sprite.height * scale)))
        sprite = sprite.resize(size, Image.Resampling.NEAREST)
        sprite.putalpha(sprite.getchannel('A').point(lambda value: 255 if value > 24 else 0))
        px, py = (FRAME - size[0]) // 2, (FRAME - size[1]) // 2
        atlas.alpha_composite(sprite, (column * FRAME + px, row * FRAME + py))
        metadata[item_id] = {'frame': index, 'x': px, 'y': py, 'width': size[0], 'height': size[1]}
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(dest_path, optimize=True)
    print(json.dumps(metadata, ensure_ascii=False, indent=2))

parser = argparse.ArgumentParser()
parser.add_argument('sheet', choices=SHEETS)
build(SHEETS[parser.parse_args().sheet])
