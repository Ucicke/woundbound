"""Copy only runtime assets to dist and losslessly compress PNG artwork."""
import json
import shutil
from pathlib import Path

try:
    from PIL import Image, features
except ImportError as exc:
    raise SystemExit('Install Pillow: python -m pip install -r scripts/requirements-build.txt') from exc

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'public'
DESTINATION = ROOT / 'dist'


def main():
    if not features.check('webp'):
        raise SystemExit('Pillow must be built with WebP support')
    paths = json.loads((ROOT / 'scripts/runtime-assets.json').read_text(encoding='utf-8'))
    if len(paths) != len(set(paths)):
        raise SystemExit('Duplicate runtime asset in manifest')
    original_bytes = output_bytes = 0
    for path in paths:
        relative = Path(path)
        if relative.is_absolute() or '..' in relative.parts or relative.parts[0] != 'assets':
            raise SystemExit(f'Invalid asset path: {path}')
        source = SOURCE / relative
        if not source.is_file():
            raise SystemExit(f'Missing runtime asset: {source}')
        target = DESTINATION / (relative.with_suffix('.webp') if relative.suffix.lower() == '.png' else relative)
        target.parent.mkdir(parents=True, exist_ok=True)
        if relative.suffix.lower() == '.png':
            with Image.open(source) as image:
                image.save(target, 'WEBP', lossless=True, exact=True, method=6)
        else:
            shutil.copy2(source, target)
        original_bytes += source.stat().st_size
        output_bytes += target.stat().st_size
    print(f'Runtime assets: {len(paths)} files, {original_bytes / 1048576:.1f} MiB -> {output_bytes / 1048576:.1f} MiB')


if __name__ == '__main__':
    main()
