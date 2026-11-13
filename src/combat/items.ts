import type { CombatItem } from './simulation.ts';

/** Catalog values are prototype balance choices; instances own their timers. */
const definitions: readonly Omit<CombatItem, 'id' | 'remainingMs' | 'cell'>[] = [
  { definitionId: 'blade', name: 'Кровожадный клинок', description: 'Бьёт переднего врага вблизи. Точильный камень рядом добавляет 2 урона.', damage: 8, cooldownMs: 1300, targetPolicy: 'front', trigger: 'always', reach: 'near', tags: ['blade'] },
  { definitionId: 'dagger', name: 'Ржавый кинжал', description: 'Издалека бьёт врага с наименьшим здоровьем.', damage: 9, cooldownMs: 1500, targetPolicy: 'lowest', trigger: 'always', reach: 'far', tags: ['blade'] },
  { definitionId: 'desperate', name: 'Клинок отчаяния', description: 'Бьёт переднего врага вблизи, когда у владельца меньше половины здоровья или прочности.', damage: 16, cooldownMs: 1700, targetPolicy: 'front', trigger: 'ownerBelowHalf', reach: 'near', tags: ['blade'] },
  { definitionId: 'lantern', name: 'Ревнивый фонарь', description: 'Издалека бьёт переднего врага, только если у него меньше половины здоровья.', damage: 14, cooldownMs: 1900, targetPolicy: 'front', trigger: 'targetBelowHalf', reach: 'far', tags: ['clockwork'] },
  { definitionId: 'mercy', name: 'Склянка милости', description: 'Лечит наиболее раненого человека; кукол лечить не может.', damage: 10, cooldownMs: 2500, targetPolicy: 'lowest', trigger: 'always', reach: 'far', effect: 'heal', healTarget: 'lowest' },
  { definitionId: 'heart', name: 'Латунное сердце', description: 'Лечит раненого владельца-человека; на кукол не действует.', damage: 8, cooldownMs: 2200, targetPolicy: 'front', trigger: 'always', reach: 'far', effect: 'heal', healTarget: 'self', tags: ['clockwork'] },
  { definitionId: 'whetstone', name: 'Точильный камень', description: 'Бьёт переднего врага вблизи; соседнему клинку даёт 2 урона.', damage: 3, cooldownMs: 2200, targetPolicy: 'front', trigger: 'always', reach: 'near', tags: ['whetstone'] },
  { definitionId: 'spring', name: 'Заводная пружина', description: 'Бьёт переднего врага издалека; соседнему механизму уменьшает кулдаун на 15%.', damage: 3, cooldownMs: 1900, targetPolicy: 'front', trigger: 'always', reach: 'far', tags: ['spring'] },
];

export function createItem(definitionId: string, instanceId: string): CombatItem {
  const definition = definitions.find(item => item.definitionId === definitionId);
  if (!definition) throw new Error(`Unknown item definition: ${definitionId}`);
  return { ...definition, tags: definition.tags ? [...definition.tags] : undefined, id: instanceId, remainingMs: definition.cooldownMs };
}

export function itemDefinitionIds(): string[] { return definitions.map(item => item.definitionId!); }
