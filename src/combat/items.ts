import type { CombatItem, ItemCategory, ItemClassAffinity } from './simulation.ts';

/** Catalog values are prototype balance choices; instances own their timers. */
const definitions: readonly Omit<CombatItem, 'id' | 'remainingMs' | 'cell'>[] = [
  { definitionId: 'blade', name: 'Кровожадный клинок', description: 'Бьёт переднего врага вблизи. Точильный камень рядом добавляет 8 урона.', damage: 8, cooldownMs: 1300, targetPolicy: 'front', trigger: 'always', reach: 'near', tags: ['blade'], shape: [[0, 0]] },
  { definitionId: 'dagger', name: 'Ржавый кинжал', description: 'Издалека бьёт врага с наименьшим здоровьем.', damage: 9, cooldownMs: 1500, targetPolicy: 'lowest', trigger: 'always', reach: 'far', tags: ['blade'], shape: [[0, 0], [0, 1]] },
  { definitionId: 'desperate', name: 'Клинок отчаяния', description: 'Бьёт переднего врага вблизи, когда у владельца меньше половины здоровья или прочности.', damage: 16, cooldownMs: 1700, targetPolicy: 'front', trigger: 'ownerBelowHalf', reach: 'near', tags: ['blade'], shape: [[0, 0], [1, 0]] },
  { definitionId: 'lantern', name: 'Ревнивый фонарь', description: 'Издалека бьёт переднего врага ниже половины здоровья. Рядом с клинком его кулдаун увеличивается на 50%; мастерская может успокоить фонарь.', damage: 14, cooldownMs: 1900, targetPolicy: 'front', trigger: 'targetBelowHalf', reach: 'far', tags: ['clockwork'], shape: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { definitionId: 'mercy', name: 'Склянка милости', description: 'Восстанавливает здоровье или прочность наиболее повреждённого союзника.', damage: 10, cooldownMs: 2500, targetPolicy: 'lowest', trigger: 'always', reach: 'far', effect: 'heal', healTarget: 'lowest', shape: [[0, 0]] },
  { definitionId: 'heart', name: 'Латунное сердце', description: 'Восстанавливает здоровье или прочность владельца.', damage: 8, cooldownMs: 2200, targetPolicy: 'front', trigger: 'always', reach: 'far', effect: 'heal', healTarget: 'self', tags: ['clockwork'], shape: [[0, 0], [1, 0], [1, 1]] },
  { definitionId: 'whetstone', name: 'Точильный камень', description: 'Бьёт переднего врага вблизи; соседнему клинку даёт 8 урона.', damage: 3, cooldownMs: 2200, targetPolicy: 'front', trigger: 'always', reach: 'near', tags: ['whetstone'], shape: [[0, 0], [1, 0]] },
  { definitionId: 'spring', name: 'Заводная пружина', description: 'Бьёт переднего врага издалека; соседнему механизму уменьшает кулдаун на 38%.', damage: 3, cooldownMs: 1900, targetPolicy: 'front', trigger: 'always', reach: 'far', tags: ['spring'], shape: [[0, 0], [0, 1]] },
  { definitionId: 'parasite-key', name: 'Ключ-паразит', description: 'Сам подзаводит куклу с наименьшим запасом завода. Соседняя пружина ускоряет его.', damage: 0, windAmount: 20, cooldownMs: 2400, targetPolicy: 'lowest', trigger: 'always', reach: 'far', effect: 'wind', tags: ['clockwork'], shape: [[0, 0], [0, 1]] },
  { definitionId: 'widow-needle', name: 'Посох вдовы', description: 'Восстанавливает здоровье или прочность наиболее повреждённого союзника, когда запас ниже половины.', damage: 6, cooldownMs: 1700, targetPolicy: 'lowest', trigger: 'allyBelowHalf', reach: 'far', effect: 'heal', healTarget: 'lowest', tags: ['support'], shape: [[0, 0], [1, 0], [1, 1]] },
  { definitionId: 'moth-glass', name: 'Стекло мотылька', description: 'Быстро стреляет фиолетовым осколком во врага с наименьшим здоровьем.', damage: 5, cooldownMs: 850, targetPolicy: 'lowest', trigger: 'always', reach: 'far', tags: ['glass'], shape: [[0, 0]] },
  { definitionId: 'hollow-bell', name: 'Полый колокол', description: 'Гулко бьёт переднего врага, когда тот изранен ниже половины.', damage: 20, cooldownMs: 3000, targetPolicy: 'front', trigger: 'targetBelowHalf', reach: 'near', tags: ['bell'], shape: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { definitionId: 'grave-rifle', name: 'Кладбищенская пищаль', description: 'Целится поверх переднего врага и стреляет в самого дальнего противника.', damage: 12, cooldownMs: 2100, targetPolicy: 'rear', trigger: 'always', reach: 'far', tags: ['firearm'], shape: [[0, 0], [1, 0]] },
  { definitionId: 'ashen-censer', name: 'Кадило с прахом', description: 'Восстанавливает здоровье или прочность наиболее повреждённого союзника.', damage: 4, cooldownMs: 1250, targetPolicy: 'lowest', trigger: 'always', reach: 'far', effect: 'heal', healTarget: 'lowest', tags: ['support'], shape: [[0, 0], [0, 1]] },
  { definitionId: 'hooked-nail', name: 'Крюк-погребальщик', description: 'Быстро цепляет переднего врага. Соседний точильный камень добавляет урон.', damage: 6, cooldownMs: 1050, targetPolicy: 'front', trigger: 'always', reach: 'near', tags: ['blade'], shape: [[0, 0], [0, 1]] },
  { definitionId: 'teeth-reliquary', name: 'Мощевик с зубами', description: 'Тяжело кусает переднего врага; соседняя пружина ускоряет его механизм.', damage: 11, cooldownMs: 2000, targetPolicy: 'front', trigger: 'always', reach: 'near', tags: ['clockwork'], shape: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { definitionId: 'rust-sickle', name: 'Ржавый серп', description: 'Быстро режет ближайшую цель. Соседний точильный камень добавляет урон.', damage: 7, cooldownMs: 1150, targetPolicy: 'front', trigger: 'always', reach: 'near', tags: ['blade'], shape: [[0, 0], [1, 0], [1, 1]] },
  { definitionId: 'clockmaker-pendulum', name: 'Маятник часовщика', description: 'Раскачивается медленно, но достаёт самого дальнего врага.', damage: 15, cooldownMs: 3300, targetPolicy: 'rear', trigger: 'always', reach: 'far', tags: ['clockwork'], shape: [[0, 0], [0, 1], [0, 2]] },
  { definitionId: 'cracked-censer', name: 'Треснувшее кадило', description: 'Восстанавливает здоровье или прочность наиболее повреждённого союзника, когда запас ниже половины.', damage: 7, cooldownMs: 2700, targetPolicy: 'lowest', trigger: 'allyBelowHalf', reach: 'far', effect: 'heal', healTarget: 'lowest', tags: ['support'], shape: [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]] },
  { definitionId: 'windup-mouse', name: 'Заводная мышь', description: 'Подзаводит куклу с наименьшим запасом завода.', damage: 0, windAmount: 14, cooldownMs: 3200, targetPolicy: 'lowest', trigger: 'always', reach: 'far', effect: 'wind', tags: ['clockwork'], shape: [[1, 0], [0, 1], [1, 1], [2, 1]] },
  { definitionId: 'silver-bullet', name: 'Серебряная пуля', description: 'Редкий тяжёлый выстрел пробивает передний ряд и бьёт дальнего врага.', damage: 22, cooldownMs: 4200, targetPolicy: 'rear', trigger: 'always', reach: 'far', tags: ['firearm'], shape: [[0, 0], [0, 1]] },
  { definitionId: 'black-bile', name: 'Склянка с чёрной желчью', description: 'Едкая жидкость обжигает врага с наименьшим здоровьем.', damage: 10, cooldownMs: 1950, targetPolicy: 'lowest', trigger: 'always', reach: 'far', tags: ['glass'], shape: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { definitionId: 'brass-monocle', name: 'Латунный монокль', description: 'Подсвечивает дальнюю цель; соседнее стрелковое оружие наносит на 8 урона больше.', damage: 2, cooldownMs: 1800, targetPolicy: 'rear', trigger: 'always', reach: 'far', tags: ['scope'], shape: [[0, 0], [1, 0], [1, 1]] },
  { definitionId: 'bone-whistle', name: 'Костяной свисток', description: 'Пронзительно поражает раненого противника издалека.', damage: 5, cooldownMs: 1350, targetPolicy: 'lowest', trigger: 'targetBelowHalf', reach: 'far', shape: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { definitionId: 'broken-metronome', name: 'Сломанный метроном', description: 'Отбивает тревожный ритм. Кулдаун соседних механизмов уменьшается на 38%.', damage: 2, cooldownMs: 2300, targetPolicy: 'front', trigger: 'always', reach: 'near', tags: ['spring'], shape: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { definitionId: 'bloodied-bandage', name: 'Окровавленный бинт', description: 'Восстанавливает здоровье или прочность наиболее повреждённого союзника.', damage: 4, cooldownMs: 1450, targetPolicy: 'lowest', trigger: 'always', reach: 'far', effect: 'heal', healTarget: 'lowest', tags: ['support'], shape: [[0, 0], [1, 0], [1, 1]] },
  { definitionId: 'ash-hourglass', name: 'Песочные часы с пеплом', description: 'Набравшийся пепел обрушивается на переднего врага, когда тот ослаблен.', damage: 18, cooldownMs: 3100, targetPolicy: 'front', trigger: 'targetBelowHalf', reach: 'far', tags: ['clockwork'], shape: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { definitionId: 'iron-manacle', name: 'Тяжёлый кандал', description: 'Скованная цепь медленно, но больно бьёт ближайшего противника.', damage: 16, cooldownMs: 3000, targetPolicy: 'front', trigger: 'always', reach: 'near', shape: [[0, 0], [1, 0], [1, 1]] },
  { definitionId: 'mercury-thermometer', name: 'Ртутный термометр', description: 'Восстанавливает здоровье или прочность владельца, когда запас ниже половины.', damage: 8, cooldownMs: 2600, targetPolicy: 'front', trigger: 'ownerBelowHalf', reach: 'far', effect: 'heal', healTarget: 'self', tags: ['glass'], shape: [[0, 0], [0, 1]] },
  { definitionId: 'music-box-key', name: 'Ключик от шкатулки', description: 'Игрушечный ключ колет переднего врага; кулдаун соседнего механизма уменьшается на 38%.', damage: 3, cooldownMs: 2600, targetPolicy: 'front', trigger: 'always', reach: 'near', tags: ['spring'], shape: [[0, 0], [1, 0], [0, 1]] },
  { definitionId: 'sinner-mask', name: 'Железная маска грешника', description: 'Восстанавливает здоровье или прочность владельца, когда запас ниже половины.', damage: 6, cooldownMs: 2500, targetPolicy: 'front', trigger: 'ownerBelowHalf', reach: 'far', effect: 'heal', healTarget: 'self', shape: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { definitionId: 'needleless-compass', name: 'Медный компас без стрелки', description: 'Беспокойная стрелка ищет самого дальнего врага. Рядом со стрелковым оружием добавляет ему урон.', damage: 3, cooldownMs: 1750, targetPolicy: 'rear', trigger: 'always', reach: 'far', tags: ['scope'], shape: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { definitionId: 'leather-prayerbook', name: 'Кожаный молитвенник', description: 'Восстанавливает здоровье или прочность наиболее повреждённого союзника, когда запас ниже половины.', damage: 5, cooldownMs: 2600, targetPolicy: 'lowest', trigger: 'allyBelowHalf', reach: 'far', effect: 'heal', healTarget: 'lowest', tags: ['support'], shape: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { definitionId: 'two-faced-coin', name: 'Перстень двуликого святого', description: 'Гранёный камень вспыхивает и бьёт противника с наименьшим здоровьем.', damage: 8, cooldownMs: 1400, targetPolicy: 'lowest', trigger: 'always', reach: 'far', shape: [[0, 0]] },
  { definitionId: 'raven-claw', name: 'Когтевой перстень ворона', description: 'Коготь на перстне быстро вспарывает ближайшего врага.', damage: 7, cooldownMs: 1250, targetPolicy: 'front', trigger: 'always', reach: 'near', tags: ['blade'], shape: [[0, 0], [1, 0], [1, 1]] },
  { definitionId: 'sealed-writ', name: 'Запечатанная грамота', description: 'Восстанавливает здоровье или прочность наиболее повреждённого союзника, когда запас ниже половины.', damage: 6, cooldownMs: 2300, targetPolicy: 'lowest', trigger: 'allyBelowHalf', reach: 'far', effect: 'heal', healTarget: 'lowest', tags: ['support'], shape: [[0, 0], [0, 1]] },
  { definitionId: 'hunter-jaw-trap', name: 'Охотничий капкан', description: 'Захлопывает стальные челюсти на переднем враге, когда тот ослаблен.', damage: 19, cooldownMs: 3100, targetPolicy: 'front', trigger: 'targetBelowHalf', reach: 'near', shape: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]] },
  { definitionId: 'powder-horn', name: 'Пороховой рожок', description: 'Выстреливает зарядом в дальнего врага.', damage: 13, cooldownMs: 2100, targetPolicy: 'rear', trigger: 'always', reach: 'far', tags: ['firearm'], shape: [[0, 0], [1, 0], [1, 1]] },
  { definitionId: 'copper-handbell', name: 'Медный ручной колокол', description: 'Звон оглушительно бьёт переднего противника, когда тот ранен.', damage: 15, cooldownMs: 2800, targetPolicy: 'front', trigger: 'targetBelowHalf', reach: 'far', tags: ['bell'], shape: [[0, 0], [0, 1]] },
  { definitionId: 'glass-eye', name: 'Стеклянный глаз', description: 'Высматривает дальнюю цель; соседнее стрелковое оружие наносит на 8 урона больше.', damage: 2, cooldownMs: 1700, targetPolicy: 'rear', trigger: 'always', reach: 'far', tags: ['scope'], shape: [[0, 0]] },
  { definitionId: 'garlic-braid', name: 'Чесночная коса', description: 'Восстанавливает здоровье или прочность наиболее повреждённого союзника.', damage: 5, cooldownMs: 2400, targetPolicy: 'lowest', trigger: 'always', reach: 'far', effect: 'heal', healTarget: 'lowest', tags: ['support'], shape: [[0, 0], [0, 1], [0, 2]] },
  { definitionId: 'reliquary-cross', name: 'Крест-мощевик', description: 'Святые останки подзаводят куклу с наименьшим запасом завода.', damage: 0, windAmount: 12, cooldownMs: 2700, targetPolicy: 'lowest', trigger: 'always', reach: 'far', effect: 'wind', tags: ['clockwork'], shape: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]] },
  { definitionId: 'executioner-tongs', name: 'Щипцы палача', description: 'Тяжёлые щипцы медленно, но больно хватают переднего врага.', damage: 17, cooldownMs: 2900, targetPolicy: 'front', trigger: 'always', reach: 'near', shape: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { definitionId: 'clockwork-coil', name: 'Часовая катушка', description: 'Ударяет переднего врага током; кулдаун соседних механизмов уменьшается на 38%.', damage: 4, cooldownMs: 2000, targetPolicy: 'front', trigger: 'always', reach: 'far', tags: ['spring'], shape: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { definitionId: 'copper-wire-loop', name: 'Петля из медной проволоки', description: 'Находит дальнюю цель; соседнее стрелковое оружие наносит на 8 урона больше.', damage: 3, cooldownMs: 1800, targetPolicy: 'rear', trigger: 'always', reach: 'far', tags: ['scope'], shape: [[0, 0], [1, 0], [1, 1]] },
  { definitionId: 'silver-spoon', name: 'Серебряная ложка', description: 'Восстанавливает здоровье или прочность владельца, когда запас ниже половины.', damage: 6, cooldownMs: 2500, targetPolicy: 'front', trigger: 'ownerBelowHalf', reach: 'far', effect: 'heal', healTarget: 'self', shape: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { definitionId: 'blackthorn-fork', name: 'Вилы из чёрного терновника', description: 'Колючие зубья быстро пробивают переднего врага.', damage: 8, cooldownMs: 1450, targetPolicy: 'front', trigger: 'always', reach: 'near', tags: ['blade'], shape: [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]] },
  { definitionId: 'bone-rosary', name: 'Чётки из костей', description: 'Восстанавливает здоровье или прочность наиболее повреждённого союзника, когда запас ниже половины.', damage: 7, cooldownMs: 3000, targetPolicy: 'lowest', trigger: 'allyBelowHalf', reach: 'far', effect: 'heal', healTarget: 'lowest', tags: ['support'], shape: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]] },
  { definitionId: 'graveward-buckler', name: 'Щит могильного дозора', description: 'Бьёт ближайшего врага и гасит часть входящего урона.', damage: 5, cooldownMs: 2500, targetPolicy: 'front', trigger: 'always', reach: 'near', passiveBonuses: { armor: 1 }, shape: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { definitionId: 'watchman-cuirass', name: 'Кираса ночного дозорного', description: 'Пассивно уменьшает входящий урон.', damage: 0, cooldownMs: 0, targetPolicy: 'front', trigger: 'passive', effect: 'passive', passiveBonuses: { armor: 2 }, shape: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]] },
  { definitionId: 'mourners-gauntlets', name: 'Перчатки скорбящего', description: 'Пассивно усиливают урон вещей владельца.', damage: 0, cooldownMs: 0, targetPolicy: 'front', trigger: 'passive', effect: 'passive', passiveBonuses: { damage: 2 }, shape: [[0, 0], [1, 0]] },
  { definitionId: 'last-rite-ring', name: 'Кольцо последнего обряда', description: 'Пассивно усиливает урон вещей владельца.', damage: 0, cooldownMs: 0, targetPolicy: 'front', trigger: 'passive', effect: 'passive', passiveBonuses: { damage: 1 }, shape: [[0, 0]] },
  { definitionId: 'hunter-bow', name: 'Ясеневый охотничий лук', description: 'Поражает дальнюю цель точным выстрелом.', damage: 11, cooldownMs: 1800, targetPolicy: 'rear', trigger: 'always', reach: 'far', tags: ['firearm'], shape: [[0, 0], [0, 1], [0, 2]] },
  { definitionId: 'hunter-quiver', name: 'Колчан костяных стрел', description: 'Пассивно усиливает дальнобойные вещи владельца.', damage: 0, cooldownMs: 0, targetPolicy: 'rear', trigger: 'passive', effect: 'passive', passiveBonuses: { damage: 1, damageReach: 'far' }, shape: [[0, 0], [0, 1], [0, 2]] },
  { definitionId: 'hunter-cloak', name: 'Плащ мшистой тени', description: 'Пассивно уменьшает входящий урон.', damage: 0, cooldownMs: 0, targetPolicy: 'front', trigger: 'passive', effect: 'passive', passiveBonuses: { armor: 1 }, shape: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { definitionId: 'hunter-bracer', name: 'Кожаный наруч охотницы', description: 'Пассивно усиливает урон вещей владельца.', damage: 0, cooldownMs: 0, targetPolicy: 'front', trigger: 'passive', effect: 'passive', passiveBonuses: { damage: 1 }, shape: [[0, 0], [1, 0]] },
  { definitionId: 'hunter-boots', name: 'Сапоги следопыта', description: 'Пассивно сокращают перезарядку вещей владельца.', damage: 0, cooldownMs: 0, targetPolicy: 'front', trigger: 'passive', effect: 'passive', passiveBonuses: { cooldownFactor: 0.92 }, shape: [[0, 0], [1, 0]] },
  { definitionId: 'pilgrim-mantle', name: 'Плащ паломника', description: 'Пассивно уменьшает входящий урон.', damage: 0, cooldownMs: 0, targetPolicy: 'front', trigger: 'passive', effect: 'passive', passiveBonuses: { armor: 1 }, shape: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { definitionId: 'pilgrim-vest', name: 'Стёганый оплечник паломника', description: 'Пассивно уменьшает входящий урон.', damage: 0, cooldownMs: 0, targetPolicy: 'front', trigger: 'passive', effect: 'passive', passiveBonuses: { armor: 2 }, shape: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { definitionId: 'saint-medal', name: 'Медаль святого утешителя', description: 'Пассивно усиливает лечение вещей владельца.', damage: 0, cooldownMs: 0, targetPolicy: 'front', trigger: 'passive', effect: 'passive', passiveBonuses: { healing: 2 }, shape: [[0, 0], [0, 1]] },
  { definitionId: 'clockwork-cuirass', name: 'Латунный заводной нагрудник', description: 'Пассивно уменьшает входящий урон.', damage: 0, cooldownMs: 0, targetPolicy: 'front', trigger: 'passive', effect: 'passive', passiveBonuses: { armor: 2 }, shape: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { definitionId: 'clockmaker-gloves', name: 'Перчатки часового мастера', description: 'Пассивно сокращают перезарядку вещей владельца.', damage: 0, cooldownMs: 0, targetPolicy: 'front', trigger: 'passive', effect: 'passive', passiveBonuses: { cooldownFactor: 0.9 }, shape: [[0, 0], [1, 0]] },
  { definitionId: 'pocket-watch-pendant', name: 'Карманные часы на цепочке', description: 'Пассивно сокращают перезарядку вещей владельца.', damage: 0, cooldownMs: 0, targetPolicy: 'front', trigger: 'passive', effect: 'passive', passiveBonuses: { cooldownFactor: 0.95 }, shape: [[0, 0], [0, 1]] },
  { definitionId: 'gearling-ring', name: 'Шестерёнчатый перстень', description: 'Пассивно усиливает подзавод вещей владельца.', damage: 0, cooldownMs: 0, targetPolicy: 'front', trigger: 'passive', effect: 'passive', passiveBonuses: { wind: 3 }, shape: [[0, 0]] },
];

export const ITEM_CLASS_GROUPS = {
  guard: ['blade', 'desperate', 'whetstone', 'iron-manacle', 'heart', 'teeth-reliquary', 'rust-sickle', 'hollow-bell', 'hooked-nail', 'executioner-tongs', 'blackthorn-fork', 'sinner-mask', 'graveward-buckler', 'watchman-cuirass', 'mourners-gauntlets', 'last-rite-ring'],
  huntress: ['hunter-bow', 'dagger', 'hunter-quiver', 'hunter-jaw-trap', 'hunter-cloak', 'hunter-bracer', 'hunter-boots', 'glass-eye', 'raven-claw', 'bone-whistle', 'brass-monocle', 'needleless-compass', 'grave-rifle', 'powder-horn', 'silver-bullet', 'copper-wire-loop'],
  pilgrim: ['ashen-censer', 'cracked-censer', 'leather-prayerbook', 'bone-rosary', 'reliquary-cross', 'sealed-writ', 'bloodied-bandage', 'mercy', 'silver-spoon', 'garlic-braid', 'copper-handbell', 'pilgrim-mantle', 'pilgrim-vest', 'widow-needle', 'saint-medal', 'two-faced-coin'],
  clockmaker: ['lantern', 'spring', 'parasite-key', 'moth-glass', 'clockmaker-pendulum', 'windup-mouse', 'black-bile', 'broken-metronome', 'ash-hourglass', 'mercury-thermometer', 'music-box-key', 'clockwork-coil', 'clockwork-cuirass', 'clockmaker-gloves', 'pocket-watch-pendant', 'gearling-ring'],
} as const satisfies Record<ItemClassAffinity, readonly string[]>;

export const ITEM_CLASS_LABELS: Record<ItemClassAffinity, string> = {
  guard: 'Страж', huntress: 'Охотница', pilgrim: 'Паломник', clockmaker: 'Часовщица',
};

export const ITEM_CATEGORY_LABELS: Record<ItemCategory, string> = {
  weapon: 'Оружие', protection: 'Защита', jewelry: 'Украшение', relic: 'Реликвия', tool: 'Инструмент', consumable: 'Припас', ammo: 'Боеприпас',
};

const categoryGroups: Record<ItemCategory, readonly string[]> = {
  weapon: ['blade', 'dagger', 'desperate', 'grave-rifle', 'hooked-nail', 'rust-sickle', 'executioner-tongs', 'blackthorn-fork', 'clockmaker-pendulum', 'hunter-bow', 'widow-needle', 'clockwork-coil'],
  protection: ['iron-manacle', 'sinner-mask', 'graveward-buckler', 'watchman-cuirass', 'mourners-gauntlets', 'hunter-cloak', 'hunter-bracer', 'hunter-boots', 'pilgrim-mantle', 'pilgrim-vest', 'clockwork-cuirass', 'clockmaker-gloves'],
  jewelry: ['heart', 'two-faced-coin', 'raven-claw', 'glass-eye', 'brass-monocle', 'needleless-compass', 'moth-glass', 'last-rite-ring', 'saint-medal', 'pocket-watch-pendant', 'gearling-ring'],
  relic: ['teeth-reliquary', 'hollow-bell', 'leather-prayerbook', 'sealed-writ', 'reliquary-cross', 'bone-rosary', 'ash-hourglass'],
  tool: ['lantern', 'whetstone', 'spring', 'parasite-key', 'bone-whistle', 'hunter-jaw-trap', 'copper-wire-loop', 'ashen-censer', 'cracked-censer', 'copper-handbell', 'windup-mouse', 'broken-metronome', 'mercury-thermometer', 'music-box-key'],
  consumable: ['mercy', 'black-bile', 'bloodied-bandage', 'garlic-braid', 'silver-spoon'],
  ammo: ['hunter-quiver', 'powder-horn', 'silver-bullet'],
};

const itemClassById = new Map<string, ItemClassAffinity>(Object.entries(ITEM_CLASS_GROUPS).flatMap(([classId, ids]) => ids.map(id => [id, classId as ItemClassAffinity])));
const itemCategoryById = new Map<string, ItemCategory>(Object.entries(categoryGroups).flatMap(([category, ids]) => ids.map(id => [id, category as ItemCategory])));

export const EXPANSION_ITEM_IDS = [
  'parasite-key', 'widow-needle', 'moth-glass', 'hollow-bell',
  'grave-rifle', 'ashen-censer', 'hooked-nail', 'teeth-reliquary',
  'rust-sickle', 'clockmaker-pendulum', 'cracked-censer', 'windup-mouse',
  'silver-bullet', 'black-bile', 'brass-monocle', 'bone-whistle',
  'broken-metronome', 'bloodied-bandage', 'ash-hourglass', 'iron-manacle',
  'mercury-thermometer', 'music-box-key', 'sinner-mask', 'needleless-compass',
  'leather-prayerbook', 'two-faced-coin', 'raven-claw', 'sealed-writ',
  'hunter-jaw-trap', 'powder-horn', 'copper-handbell', 'glass-eye',
  'garlic-braid', 'reliquary-cross', 'executioner-tongs', 'clockwork-coil',
  'copper-wire-loop', 'silver-spoon', 'blackthorn-fork', 'bone-rosary',
  'graveward-buckler', 'watchman-cuirass', 'mourners-gauntlets', 'last-rite-ring',
  'hunter-bow', 'hunter-quiver', 'hunter-cloak', 'hunter-bracer', 'hunter-boots',
  'pilgrim-mantle', 'pilgrim-vest', 'saint-medal',
  'clockwork-cuirass', 'clockmaker-gloves', 'pocket-watch-pendant', 'gearling-ring',
] as const;

const rarityWeights = [
  { rarity: 'common' as const, multiplier: 1, weight: .50 },
  { rarity: 'uncommon' as const, multiplier: 1.15, weight: .25 },
  { rarity: 'rare' as const, multiplier: 1.35, weight: .15 },
  { rarity: 'epic' as const, multiplier: 1.6, weight: .08 },
  { rarity: 'legendary' as const, multiplier: 1.9, weight: .02 },
];

export function createItem(definitionId: string, instanceId: string, random: () => number = Math.random): CombatItem {
  const definition = definitions.find(item => item.definitionId === definitionId);
  if (!definition) throw new Error(`Unknown item definition: ${definitionId}`);
  const roll = Math.max(0, Math.min(.999999, random()));
  let cumulative = 0;
  const tier = rarityWeights.find(entry => (cumulative += entry.weight) > roll) ?? rarityWeights[0]!;
  const passiveBonuses = definition.passiveBonuses ? {
    armor: definition.passiveBonuses.armor === undefined ? undefined : Math.round(definition.passiveBonuses.armor * tier.multiplier),
    damage: definition.passiveBonuses.damage === undefined ? undefined : Math.round(definition.passiveBonuses.damage * tier.multiplier),
    damageReach: definition.passiveBonuses.damageReach,
    healing: definition.passiveBonuses.healing === undefined ? undefined : Math.round(definition.passiveBonuses.healing * tier.multiplier),
    wind: definition.passiveBonuses.wind === undefined ? undefined : Math.round(definition.passiveBonuses.wind * tier.multiplier),
    cooldownFactor: definition.passiveBonuses.cooldownFactor === undefined ? undefined : Math.max(.5, 1 - (1 - definition.passiveBonuses.cooldownFactor) * tier.multiplier),
  } : undefined;
  const passive = definition.trigger === 'passive' || definition.effect === 'passive';
  const cooldownMs = passive ? 0 : Math.max(300, Math.round(definition.cooldownMs / tier.multiplier));
  return { ...definition, rarity: tier.rarity, rarityMultiplier: tier.multiplier,
    classAffinity: itemClassById.get(definitionId),
    category: itemCategoryById.get(definitionId),
    damageType: definitionId === 'lantern' ? 'fire' : definition.tags?.some(tag => tag === 'glass' || tag === 'bell') ? 'arcane' : 'physical',
    passiveBonuses,
    damage: Math.round(definition.damage * tier.multiplier),
    windAmount: definition.windAmount === undefined ? undefined : Math.round(definition.windAmount * tier.multiplier),
    cooldownMs,
    tags: definition.tags ? [...definition.tags] : undefined,
    shape: definition.shape?.map(cell => [...cell] as const), id: instanceId, remainingMs: cooldownMs };
}

export function itemDefinitionIds(): string[] { return definitions.map(item => item.definitionId!); }
