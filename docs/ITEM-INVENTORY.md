# Woundbound item inventory

## Inventory rules

Woundbound uses free-form 6×6 backpack grids. Items occupy their own block shapes and can be moved or rotated; there are no fixed weapon, armor, ring, amulet, or other equipment slots. The Diablo IV reference is used only for the variety of object kinds. A category such as protection or jewelry is descriptive flavor, not an equipment slot.

Class names below describe the visual and thematic collections used to curate each hero's starter items. They do not restrict who can carry, move, combine, or receive an item. Room rewards are selected from the shared catalog of all 64 items.

## Categories

| Category | Meaning in Woundbound |
| --- | --- |
| Weapon | Blades, ranged weapons, and objects whose primary identity is an attack. |
| Protection | Armor, coverings, shields, and defensive objects. This does not occupy an armor slot. |
| Jewelry | Small charms and personal ornaments. This does not occupy a ring or amulet slot. |
| Relic | Sacred or uncanny objects with a distinct autonomous effect. |
| Tool | Practical instruments and mechanisms. |
| Consumable | Medicine or supplies used by an autonomous effect. |
| Ammo | Ammunition-themed objects; these remain independent inventory pieces, not a required slot or resource attachment. |

## Visual collections and item IDs

Each collection contains 16 sprites, arranged as one transparent 4×4 atlas. IDs refer to `definitionId` in the game catalog.

### Страж

| ID | Category |
| --- | --- |
| `blade` | Weapon |
| `desperate` | Weapon |
| `whetstone` | Tool |
| `iron-manacle` | Protection |
| `heart` | Jewelry |
| `teeth-reliquary` | Relic |
| `rust-sickle` | Weapon |
| `hollow-bell` | Relic |
| `hooked-nail` | Weapon |
| `executioner-tongs` | Weapon |
| `blackthorn-fork` | Weapon |
| `sinner-mask` | Protection |
| `graveward-buckler` | Protection |
| `watchman-cuirass` | Protection |
| `mourners-gauntlets` | Protection |
| `last-rite-ring` | Jewelry |

### Охотница

| ID | Category |
| --- | --- |
| `hunter-bow` | Weapon |
| `dagger` | Weapon |
| `hunter-quiver` | Ammo |
| `hunter-jaw-trap` | Tool |
| `hunter-cloak` | Protection |
| `hunter-bracer` | Protection |
| `hunter-boots` | Protection |
| `glass-eye` | Jewelry |
| `raven-claw` | Jewelry |
| `bone-whistle` | Tool |
| `brass-monocle` | Jewelry |
| `needleless-compass` | Jewelry |
| `grave-rifle` | Weapon |
| `powder-horn` | Ammo |
| `silver-bullet` | Ammo |
| `copper-wire-loop` | Tool |

### Паломник

| ID | Category |
| --- | --- |
| `ashen-censer` | Tool |
| `cracked-censer` | Tool |
| `leather-prayerbook` | Relic |
| `bone-rosary` | Relic |
| `reliquary-cross` | Relic |
| `sealed-writ` | Relic |
| `bloodied-bandage` | Consumable |
| `mercy` | Consumable |
| `silver-spoon` | Consumable |
| `garlic-braid` | Consumable |
| `copper-handbell` | Tool |
| `pilgrim-mantle` | Protection |
| `pilgrim-vest` | Protection |
| `widow-needle` | Weapon |
| `saint-medal` | Jewelry |
| `two-faced-coin` | Jewelry |

### Часовщица

| ID | Category |
| --- | --- |
| `lantern` | Tool |
| `spring` | Tool |
| `parasite-key` | Tool |
| `moth-glass` | Jewelry |
| `clockmaker-pendulum` | Weapon |
| `windup-mouse` | Tool |
| `black-bile` | Consumable |
| `broken-metronome` | Tool |
| `ash-hourglass` | Relic |
| `mercury-thermometer` | Tool |
| `music-box-key` | Tool |
| `clockwork-coil` | Weapon |
| `clockwork-cuirass` | Protection |
| `clockmaker-gloves` | Protection |
| `pocket-watch-pendant` | Jewelry |
| `gearling-ring` | Jewelry |

## Passive item traits

The 16 added class-themed items broaden the catalog with passive bonuses. They still occupy ordinary grid shapes and work alongside active items:

- Protection and armor items reduce each incoming hit, up to the combat cap.
- Damage bonuses strengthen all active damage items in that hero's bag.
- Healing bonuses strengthen that hero's active healing items.
- Cooldown bonuses speed up that hero's active items.
- Wind bonuses strengthen automatic doll-winding effects.

Rarity remains independent of category and class theme. Any definition can roll any rarity; rarity scales its combat values. New item definitions, class groupings, and category labels are maintained in `src/combat/items.ts`.

## Art source and slicing

- Original ImageGen sources: `public/assets/source/raw/items-woundbound-class-*-imagegen.png` and `public/assets/source/raw/items-woundbound-glass-eye-transparent-imagegen.png`.
- Runtime 4×4 atlases: `public/assets/source/items-woundbound-class-{guard,huntress,pilgrim,clockmaker}-grid.png`.
- `scripts/slice-class-item-atlases.py` trims each transparent icon into a 512×512 cell and writes `src/presentation/ClassItemArt.ts`.
- Phaser loads only these four item atlases. The art catalog keeps each sprite's source aspect ratio in inventory, rewards, and drag previews.
