import type { CombatItem, Combatant } from './simulation.ts';
import { areAdjacent, occupiedCells } from './inventory.ts';
import { COMBAT_CONFIG } from './config.ts';

export type HeroClass = 'guard' | 'huntress' | 'pilgrim' | 'clockmaker';
export type PuppetBranch = 'theatrical' | 'mechanical' | 'mystical';
export type PuppetCellTag = 'threaded' | 'mechanical' | 'cursed' | 'sacred';
export type PuppetPassiveId =
  | 'tin-parade' | 'bastion-counterwind' | 'reliquary-offering'
  | 'thread-dance' | 'clockwork-mark' | 'fate-streak'
  | 'penitent-winding' | 'spring-reservoir' | 'martyr-reflection'
  | 'puppet-mistress' | 'master-overclock' | 'gear-oracle';
export type PuppetFormId =
  | 'tin-soldier' | 'automaton-bastion' | 'armored-reliquary'
  | 'thread-marionette' | 'clockwork-pathfinder' | 'fate-hound'
  | 'winding-penitent' | 'spring-pilgrim' | 'martyr-doll'
  | 'puppet-mistress' | 'automaton-master' | 'gear-oracle';

export interface PuppetCellModifier {
  tag: PuppetCellTag;
  cells: readonly number[];
  label: string;
}

export interface PuppetForm {
  id: PuppetFormId;
  heroClass: HeroClass;
  branch: PuppetBranch;
  name: string;
  passiveId: PuppetPassiveId;
  passiveName: string;
  passiveDescription: string;
  maxDurability: number;
  maxWindUp: number;
  windDrainPerSecond: number;
  armor: number;
  damageTakenMultiplier: number;
  itemCooldownFactor: number;
  cellModifiers: readonly PuppetCellModifier[];
}

export interface PuppetPassiveState {
  itemActivations: number;
  mechanicalActivations: number;
  hitsTaken: number;
  repeatedTargetId: string | null;
  repeatedTargetCount: number;
}

export interface PuppetItemRules {
  outputMultiplier: number;
  cooldownMultiplier: number;
  chargeCost: number;
  chargeRefund: number;
  adjacentCooldownReductionMs: number;
  oracleCharge: number;
  durabilityRepair: number;
}

const diagonal = [0, 7, 14, 21, 28, 35] as const;
const reverseDiagonal = [5, 10, 15, 20, 25, 30] as const;
const centerLine = [2, 8, 14, 20, 26, 32] as const;
const edgeLine = [3, 9, 15, 21, 27, 33] as const;

export const PUPPET_FORMS: readonly PuppetForm[] = [
  { id: 'tin-soldier', heroClass: 'guard', branch: 'theatrical', name: 'Оловянный солдат', passiveId: 'tin-parade', passiveName: 'Парадный залп', passiveDescription: 'Каждая третья вещь срабатывает сильнее на 35% и ускоряет соседние вещи на 0,2 с.', maxDurability: 88, maxWindUp: 90, windDrainPerSecond: 4.8, armor: 0, damageTakenMultiplier: 1.1, itemCooldownFactor: .9, cellModifiers: [{ tag: 'threaded', cells: diagonal, label: 'Нитяные ячейки: кулдаун предметов −15%.' }] },
  { id: 'automaton-bastion', heroClass: 'guard', branch: 'mechanical', name: 'Автоматон-бастион', passiveId: 'bastion-counterwind', passiveName: 'Контрход бастиона', passiveDescription: 'Броня снижает каждый удар на 3. Каждый третий полученный удар возвращает 12 единиц завода.', maxDurability: 140, maxWindUp: 110, windDrainPerSecond: 3.8, armor: 3, damageTakenMultiplier: .9, itemCooldownFactor: 1.04, cellModifiers: [{ tag: 'mechanical', cells: reverseDiagonal, label: 'Механические ячейки: кулдаун −8%, срабатывание тратит 1 завод.' }] },
  { id: 'armored-reliquary', heroClass: 'guard', branch: 'mystical', name: 'Панцирный реликвариум', passiveId: 'reliquary-offering', passiveName: 'Подношение реликвариума', passiveDescription: 'Вещь на священной ячейке чинит куклу на 2 прочности и возвращает ей 4 единицы завода.', maxDurability: 118, maxWindUp: 105, windDrainPerSecond: 4.1, armor: 1, damageTakenMultiplier: .94, itemCooldownFactor: 1.02, cellModifiers: [{ tag: 'sacred', cells: centerLine, label: 'Священные ячейки: лечение усиливается на 20%.' }] },
  { id: 'thread-marionette', heroClass: 'huntress', branch: 'theatrical', name: 'Марионетка на нитях', passiveId: 'thread-dance', passiveName: 'Танец на нитях', passiveDescription: 'Вещи рядом друг с другом перезаряжаются на 18% быстрее; каждое срабатывание дополнительно ускоряет соседей на 0,1 с.', maxDurability: 78, maxWindUp: 92, windDrainPerSecond: 4.6, armor: 0, damageTakenMultiplier: 1.14, itemCooldownFactor: .96, cellModifiers: [{ tag: 'threaded', cells: reverseDiagonal, label: 'Нитяные ячейки: кулдаун предметов −15%.' }] },
  { id: 'clockwork-pathfinder', heroClass: 'huntress', branch: 'mechanical', name: 'Часовой следопыт', passiveId: 'clockwork-mark', passiveName: 'Прицельная метка', passiveDescription: 'Дальнобойная вещь на механической ячейке наносит на 40% больше и возвращает 4 единицы завода.', maxDurability: 96, maxWindUp: 100, windDrainPerSecond: 4.2, armor: 1, damageTakenMultiplier: .96, itemCooldownFactor: .94, cellModifiers: [{ tag: 'mechanical', cells: centerLine, label: 'Механические ячейки: кулдаун −8%, срабатывание тратит 1 завод.' }] },
  { id: 'fate-hound', heroClass: 'huntress', branch: 'mystical', name: 'Гончая судьбы', passiveId: 'fate-streak', passiveName: 'Нить неизбежности', passiveDescription: 'Вещи выбирают врага с наименьшим здоровьем. Повторные удары по той же цели усиливаются до 50%.', maxDurability: 94, maxWindUp: 108, windDrainPerSecond: 4.0, armor: 0, damageTakenMultiplier: .98, itemCooldownFactor: 1, cellModifiers: [{ tag: 'cursed', cells: edgeLine, label: 'Проклятые ячейки: урон +15%, срабатывание тратит 1 завод.' }] },
  { id: 'winding-penitent', heroClass: 'pilgrim', branch: 'theatrical', name: 'Заводной кающийся', passiveId: 'penitent-winding', passiveName: 'Покаянный подзавод', passiveDescription: 'Ручной подзавод даёт на 50% больше заряда, но отнимает 1 прочность.', maxDurability: 84, maxWindUp: 90, windDrainPerSecond: 4.7, armor: 0, damageTakenMultiplier: 1.1, itemCooldownFactor: .97, cellModifiers: [{ tag: 'cursed', cells: diagonal, label: 'Проклятые ячейки: урон +15%, срабатывание тратит 1 завод.' }] },
  { id: 'spring-pilgrim', heroClass: 'pilgrim', branch: 'mechanical', name: 'Пружинный пилигрим', passiveId: 'spring-reservoir', passiveName: 'Пружинный резерв', passiveDescription: 'Каждая занятая механическая ячейка замедляет расход завода на 12%, максимум на 60%.', maxDurability: 110, maxWindUp: 115, windDrainPerSecond: 3.5, armor: 2, damageTakenMultiplier: .94, itemCooldownFactor: 1.02, cellModifiers: [{ tag: 'mechanical', cells: reverseDiagonal, label: 'Механические ячейки: кулдаун −8%, срабатывание тратит 1 завод.' }] },
  { id: 'martyr-doll', heroClass: 'pilgrim', branch: 'mystical', name: 'Кукла-мученик', passiveId: 'martyr-reflection', passiveName: 'Мученический отпор', passiveDescription: 'Отражает четверть полученного урона атакующему, но сама получает на 15% больше урона.', maxDurability: 100, maxWindUp: 110, windDrainPerSecond: 4.0, armor: 0, damageTakenMultiplier: 1.15, itemCooldownFactor: 1, cellModifiers: [{ tag: 'sacred', cells: edgeLine, label: 'Священные ячейки: лечение усиливается на 20%.' }] },
  { id: 'puppet-mistress', heroClass: 'clockmaker', branch: 'theatrical', name: 'Хозяйка марионеток', passiveId: 'puppet-mistress', passiveName: 'Нити хозяйки', passiveDescription: 'Каждое срабатывание сокращает оставшийся кулдаун соседних вещей на 0,3 с.', maxDurability: 86, maxWindUp: 100, windDrainPerSecond: 4.3, armor: 0, damageTakenMultiplier: 1.08, itemCooldownFactor: .95, cellModifiers: [{ tag: 'threaded', cells: centerLine, label: 'Нитяные ячейки: кулдаун предметов −15%.' }] },
  { id: 'automaton-master', heroClass: 'clockmaker', branch: 'mechanical', name: 'Автоматон-мастер', passiveId: 'master-overclock', passiveName: 'Тройной разгон', passiveDescription: 'Каждое третье срабатывание вещи на механической ячейке усиливается на 60% и тратит 5 завода.', maxDurability: 104, maxWindUp: 108, windDrainPerSecond: 3.9, armor: 1, damageTakenMultiplier: .96, itemCooldownFactor: .98, cellModifiers: [{ tag: 'mechanical', cells: diagonal, label: 'Механические ячейки: кулдаун −8%, срабатывание тратит 1 завод.' }] },
  { id: 'gear-oracle', heroClass: 'clockmaker', branch: 'mystical', name: 'Оракул шестерёнок', passiveId: 'gear-oracle', passiveName: 'Предсказанный завод', passiveDescription: 'Каждое четвёртое срабатывание передаёт 15 единиц завода кукле с наименьшим зарядом.', maxDurability: 92, maxWindUp: 112, windDrainPerSecond: 3.9, armor: 0, damageTakenMultiplier: .95, itemCooldownFactor: 1.04, cellModifiers: [{ tag: 'sacred', cells: reverseDiagonal, label: 'Священные ячейки: лечение усиливается на 20%.' }] },
];

const formById = new Map(PUPPET_FORMS.map(form => [form.id, form]));

export function getPuppetForm(formId: PuppetFormId | null | undefined): PuppetForm | undefined {
  return formId ? formById.get(formId) : undefined;
}

export function choosePuppetForm(heroClass: HeroClass, random: () => number): PuppetForm {
  const choices = PUPPET_FORMS.filter(form => form.heroClass === heroClass);
  const roll = Math.max(0, Math.min(.999999, random()));
  return choices[Math.floor(roll * choices.length)]!;
}

export function defaultPuppetForm(heroClass: HeroClass): PuppetForm {
  return PUPPET_FORMS.find(form => form.heroClass === heroClass)!;
}

export function getPuppetCellModifiers(actor: Combatant, cell: number): PuppetCellModifier[] {
  const form = actor.isPuppet ? getPuppetForm(actor.puppetFormId) : undefined;
  return form?.cellModifiers.filter(modifier => modifier.cells.includes(cell)) ?? [];
}

export function getPuppetItemCellModifiers(actor: Combatant, item: CombatItem): PuppetCellModifier[] {
  const footprint = occupiedCells(item, item.cell ?? 0) ?? [];
  const matches = footprint.flatMap(cell => getPuppetCellModifiers(actor, cell));
  return [...new Map(matches.map(modifier => [modifier.tag, modifier])).values()];
}

export function getPuppetItemRules(actor: Combatant, item: CombatItem, targetId?: string): PuppetItemRules {
  const form = actor.isPuppet ? getPuppetForm(actor.puppetFormId) : undefined;
  if (!form) return { outputMultiplier: 1, cooldownMultiplier: 1, chargeCost: 0, chargeRefund: 0, adjacentCooldownReductionMs: 0, oracleCharge: 0, durabilityRepair: 0 };
  const cellModifiers = getPuppetItemCellModifiers(actor, item);
  const tags = new Set(cellModifiers.map(modifier => modifier.tag));
  const nextActivation = actor.puppetPassiveState.itemActivations + 1;
  const adjacent = actor.items.some(other => other.id !== item.id && areAdjacent(item, other));
  let outputMultiplier = 1;
  let cooldownMultiplier = form.itemCooldownFactor;
  let chargeCost = 0;
  let chargeRefund = 0;
  let adjacentCooldownReductionMs = 0;
  let oracleCharge = 0;
  let durabilityRepair = 0;

  if (tags.has('threaded')) cooldownMultiplier *= .85;
  if (tags.has('mechanical')) { cooldownMultiplier *= .92; chargeCost += 1; }
  if (tags.has('cursed')) {
    if (item.effect !== 'heal' && item.effect !== 'wind') outputMultiplier *= 1.15;
    chargeCost += 1;
  }
  if (tags.has('sacred') && item.effect === 'heal') outputMultiplier *= 1.2;

  switch (form.passiveId) {
    case 'tin-parade':
      if (nextActivation % 3 === 0) { outputMultiplier *= 1.35; adjacentCooldownReductionMs = 200; }
      break;
    case 'thread-dance':
      if (adjacent) { cooldownMultiplier *= .82; adjacentCooldownReductionMs = 100; }
      break;
    case 'clockwork-mark':
      if (item.reach === 'far' && tags.has('mechanical') && item.effect !== 'heal' && item.effect !== 'wind') { outputMultiplier *= 1.4; chargeRefund += 4; }
      break;
    case 'fate-streak':
      if (targetId && actor.puppetPassiveState.repeatedTargetId === targetId) outputMultiplier *= Math.min(1.5, 1 + actor.puppetPassiveState.repeatedTargetCount * .1);
      break;
    case 'spring-reservoir':
      if (tags.has('mechanical')) chargeRefund += 2;
      break;
    case 'reliquary-offering':
      if (tags.has('sacred')) { chargeRefund += 4; durabilityRepair = 2; }
      break;
    case 'puppet-mistress':
      adjacentCooldownReductionMs = 300;
      break;
    case 'master-overclock':
      if (tags.has('mechanical') && (actor.puppetPassiveState.mechanicalActivations + 1) % 3 === 0 && actor.windUpCharge >= 5) { outputMultiplier *= 1.6; chargeCost += 5; }
      break;
    case 'gear-oracle':
      if (nextActivation % 4 === 0) oracleCharge = tags.has('sacred') ? 20 : 15;
      break;
    case 'bastion-counterwind':
    case 'penitent-winding':
    case 'martyr-reflection':
      break;
  }

  return { outputMultiplier, cooldownMultiplier, chargeCost, chargeRefund, adjacentCooldownReductionMs, oracleCharge, durabilityRepair };
}

export function registerPuppetItemTrigger(actor: Combatant, item: CombatItem, targetId?: string): void {
  actor.puppetPassiveState.itemActivations++;
  if (getPuppetItemCellModifiers(actor, item).some(modifier => modifier.tag === 'mechanical')) actor.puppetPassiveState.mechanicalActivations++;
  if (getPuppetForm(actor.puppetFormId)?.passiveId !== 'fate-streak' || !targetId) return;
  if (actor.puppetPassiveState.repeatedTargetId === targetId) actor.puppetPassiveState.repeatedTargetCount++;
  else { actor.puppetPassiveState.repeatedTargetId = targetId; actor.puppetPassiveState.repeatedTargetCount = 1; }
}

export function getPuppetWindDrain(actor: Combatant): number {
  const form = actor.isPuppet ? getPuppetForm(actor.puppetFormId) : undefined;
  if (!form) return COMBAT_CONFIG.windPerSecond;
  if (form.passiveId !== 'spring-reservoir') return form.windDrainPerSecond;
  const mechanicalCells = new Set(form.cellModifiers.filter(modifier => modifier.tag === 'mechanical').flatMap(modifier => modifier.cells));
  const occupiedMechanicalCells = new Set(actor.items.flatMap(item => (occupiedCells(item, item.cell ?? 0) ?? []).filter(cell => mechanicalCells.has(cell))));
  return form.windDrainPerSecond * Math.max(.4, 1 - occupiedMechanicalCells.size * .12);
}
