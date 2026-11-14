from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'public/assets/source/raw/ui'
DEST = ROOT / 'public/assets/ui'

corner_source = Image.open(SOURCE / 'gothic-frame-corner-imagegen.png').convert('RGBA')
alpha = corner_source.getchannel('A')
bounds = alpha.getbbox()
if not bounds:
    raise RuntimeError('Generated frame corner has no visible pixels')
corner = corner_source.crop(bounds)
max_size, padding = 512, 16
scale = (max_size - padding * 2) / max(corner.size)
scaled = corner.resize((round(corner.width * scale), round(corner.height * scale)), Image.Resampling.LANCZOS)
frame = Image.new('RGBA', (max_size, max_size), (0, 0, 0, 0))
frame.alpha_composite(scaled, ((max_size - scaled.width) // 2, (max_size - scaled.height) // 2))
frame.save(DEST / 'gothic-frame-corner.png', optimize=True)

texture_source = Image.open(SOURCE / 'inventory-plum-texture-imagegen.png').convert('RGB')
texture = texture_source.resize((512, 512), Image.Resampling.LANCZOS)
texture.save(DEST / 'inventory-plum-texture.png', optimize=True)
print(f'Built {DEST / "gothic-frame-corner.png"} and {DEST / "inventory-plum-texture.png"}')
