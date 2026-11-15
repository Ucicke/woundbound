from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "public/assets/source/raw"
UI = ROOT / "public/assets/ui"
RAW_ATLAS = RAW / "puppet-deaths-atlas-imagegen.png"
OUTPUT_ATLAS = ROOT / "public/assets/puppet-deaths-atlas.png"
FRAME_SIZE = 640
PORTRAITS = ("guard", "huntress", "pilgrim", "clockmaker")


def prepare_portraits() -> None:
    for name in PORTRAITS:
        source = Image.open(RAW / f"dead-portrait-{name}-imagegen.png").convert("RGBA")
        alpha_bounds = source.getchannel("A").getbbox()
        if not alpha_bounds:
            raise ValueError(f"{name}: portrait has no visible pixels")
        # Keep every generated pixel, trim transparent canvas, then add a clean
        # gutter so the art never touches its Phaser texture boundary.
        content = source.crop(alpha_bounds)
        framed = Image.new("RGBA", (content.width + 32, content.height + 32), (0, 0, 0, 0))
        framed.alpha_composite(content, (16, 16))
        framed.save(UI / f"dead-portrait-{name}.png", optimize=True)


def prepare_death_atlas() -> None:
    source = Image.open(RAW_ATLAS).convert("RGBA")
    if source.size != (1261, 1247):
        raise ValueError(f"Expected generated 1261x1247 sheet, got {source.size}")

    x_split, y_split = source.width // 2, source.height // 2
    regions = (
        (0, 0, x_split, y_split),
        (x_split, 0, source.width, y_split),
        (0, y_split, x_split, source.height),
        (x_split, y_split, source.width, source.height),
    )
    atlas = Image.new("RGBA", (FRAME_SIZE * 2, FRAME_SIZE * 2), (0, 0, 0, 0))
    for index, region in enumerate(regions):
        frame = source.crop(region)
        if frame.width > FRAME_SIZE or frame.height > FRAME_SIZE:
            raise ValueError(f"Frame {index} is larger than {FRAME_SIZE}px; do not scale generated art")
        x = (index % 2) * FRAME_SIZE + (FRAME_SIZE - frame.width) // 2
        y = (index // 2) * FRAME_SIZE + (FRAME_SIZE - frame.height) // 2
        atlas.alpha_composite(frame, (x, y))

    atlas.save(OUTPUT_ATLAS, optimize=True)
    print(f"Wrote {OUTPUT_ATLAS.relative_to(ROOT)} with 4 native-resolution 640px frames")


if __name__ == "__main__":
    prepare_portraits()
    prepare_death_atlas()
