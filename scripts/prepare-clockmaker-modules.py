"""Prepare the generated clockmaker niche and chroma-keyed resource modules."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
raw = root / 'public/assets/source/raw'
ui = root / 'public/assets/ui'

# Preserve every pixel outside the old, baked-in tube.
board = Image.open(ui / 'dashboard-clockmaker-gothic-pixel.png').convert('RGBA')
edit = Image.open(raw / 'dashboard-clockmaker-niche-imagegen.png').convert('RGBA')
if board.size != edit.size:
    raise ValueError('Generated niche must have the same dimensions as the original board')
box = (480, 282, 1180, 435)
board.paste(edit.crop(box), box[:2])
board.save(ui / 'dashboard-clockmaker-modular.png')

for name in ('single', 'double'):
    image = Image.open(raw / f'clockmaker-tube-{name}-imagegen.png').convert('RGBA')
    pixels = []
    for r, g, b, a in image.getdata():
        # The same chroma is used in the sealed tube interiors, not only outside.
        distance = max(abs(r - 4), abs(g - 63), abs(b - 63))
        alpha = max(0, min(255, round((distance - 14) * 255 / 22)))
        pixels.append((r, g, b, min(a, alpha)))
    image.putdata(pixels)
    bounds = image.getbbox()
    if bounds is None:
        raise ValueError(f'Empty module: {name}')
    image = image.crop(bounds)
    result = Image.new('RGBA', (image.width + 12, image.height + 12))
    result.alpha_composite(image, (6, 6))
    result.save(ui / f'clockmaker-tube-{name}.png')
    print(f'{name}: original bounds {bounds}, output {result.size}')
