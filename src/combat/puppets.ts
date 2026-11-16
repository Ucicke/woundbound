import type { CombatItem, Combatant } from './simulation.ts';
import { areAdjacent, inventoryIndex, INVENTORY_GRID_SIZE, occupiedCells } from './inventory.ts';
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

export const PUPPET_RULES = {
  threadedCooldownReduction: .15, mechanicalCooldownReduction: .08, mechanicalChargeCost: 1,
  cursedDamageBonus: .15, cursedChargeCost: 1, sacredHealingBonus: .2,
  tinEvery: 3, tinBonus: .35, tinNeighbourReductionMs: 200,
  bastionEveryHits: 3, bastionWindRefund: 12, bastionArmor: 3,
  reliquaryRepair: 2, reliquaryWindRefund: 4,
  threadCooldownReduction: .18, threadNeighbourReductionMs: 100,
  pathfinderDamageBonus: .4, pathfinderWindRefund: 4,
  fateBonusPerHit: .1, fateMaxBonus: .5,
  penitentWindBonus: .5, penitentDurabilityCost: 1,
  springDrainReductionPerCell: .12, springMaxDrainReduction: .6, springWindRefund: 2,
  martyrReflection: .25, martyrExtraDamage: .15,
  mistressNeighbourReductionMs: 300,
  masterEvery: 3, masterBonus: .6, masterChargeCost: 5,
  oracleEvery: 4, oracleWind: 15, oracleSacredWind: 20,
} as const;

const percent = (value: number): number => Math.round(value * 100);
const seconds = (ms: number): string => (ms / 1000).toFixed(1).replace('.', ',');
const rows = Array.from({ length: INVENTORY_GRID_SIZE }, (_, row) => row);
const diagonal = rows.map(row => inventoryIndex(row, row));
const reverseDiagonal = rows.map(row => inventoryIndex(INVENTORY_GRID_SIZE - 1 - row, row));
const centerLine = rows.map(row => inventoryIndex(Math.floor((INVENTORY_GRID_SIZE - 1) / 2), row));
const edgeLine = rows.map(row => inventoryIndex(Math.floor(INVENTORY_GRID_SIZE / 2), row));

const cellLabels: Record<PuppetCellTag, string> = {
  threaded: `Нитяные ячейки: кулдаун предметов −${percent(PUPPET_RULES.threadedCooldownReduction)}%.`,
  mechanical: `Механические ячейки: кулдаун −${percent(PUPPET_RULES.mechanicalCooldownReduction)}%, срабатывание тратит ${PUPPET_RULES.mechanicalChargeCost} завод.`,
  cursed: `Проклятые ячейки: урон +${percent(PUPPET_RULES.cursedDamageBonus)}%, срабатывание тратит ${PUPPET_RULES.cursedChargeCost} завод.`,
  sacred: `Священные ячейки: лечение усиливается на ${percent(PUPPET_RULES.sacredHealingBonus)}%.`,
};

const passiveDescriptions: Record<PuppetPassiveId, string> = {
  'tin-parade': `Каждое ${PUPPET_RULES.tinEvery}-е срабатывание вещи усиливается на ${percent(PUPPET_RULES.tinBonus)}% и ускоряет соседние вещи на ${seconds(PUPPET_RULES.tinNeighbourReductionMs)} с.`,
  'bastion-counterwind': `Базовая броня +${PUPPET_RULES.bastionArmor}. Каждый ${PUPPET_RULES.bastionEveryHits}-й полученный удар возвращает ${PUPPET_RULES.bastionWindRefund} единиц завода.`,
  'reliquary-offering': `Срабатывание вещи на священной ячейке чинит куклу на ${PUPPET_RULES.reliquaryRepair} прочности и возвращает ${PUPPET_RULES.reliquaryWindRefund} единицы завода.`,
  'thread-dance': `Кулдаун вещей рядом друг с другом уменьшается на ${percent(PUPPET_RULES.threadCooldownReduction)}%; их срабатывания дополнительно ускоряют соседей на ${seconds(PUPPET_RULES.threadNeighbourReductionMs)} с.`,
  'clockwork-mark': `Дальнобойная атакующая вещь на механической ячейке наносит на ${percent(PUPPET_RULES.pathfinderDamageBonus)}% больше урона и возвращает ${PUPPET_RULES.pathfinderWindRefund} единицы завода.`,
  'fate-streak': `Атакующие вещи выбирают врага с наименьшим здоровьем. Повторные удары по той же цели усиливаются на ${percent(PUPPET_RULES.fateBonusPerHit)}% за удар, максимум на ${percent(PUPPET_RULES.fateMaxBonus)}%.`,
  'penitent-winding': `Ручной подзавод даёт на ${percent(PUPPET_RULES.penitentWindBonus)}% больше заряда, но отнимает ${PUPPET_RULES.penitentDurabilityCost} прочность.`,
  'spring-reservoir': `Каждая занятая механическая ячейка замедляет расход завода на ${percent(PUPPET_RULES.springDrainReductionPerCell)}%, максимум на ${percent(PUPPET_RULES.springMaxDrainReduction)}%. Срабатывание вещи на ней возвращает ${PUPPET_RULES.springWindRefund} единицы завода.`,
  'martyr-reflection': `Отражает ${percent(PUPPET_RULES.martyrReflection)}% полученного урона атакующему, но сама получает на ${percent(PUPPET_RULES.martyrExtraDamage)}% больше урона.`,
  'puppet-mistress': `Каждое срабатывание сокращает оставшийся кулдаун соседних вещей на ${seconds(PUPPET_RULES.mistressNeighbourReductionMs)} с.`,
  'master-overclock': `Каждое ${PUPPET_RULES.masterEvery}-е срабатывание вещи на механической ячейке усиливается на ${percent(PUPPET_RULES.masterBonus)}% и дополнительно тратит ${PUPPET_RULES.masterChargeCost} завода, если его хватает на полный расход.`,
  'gear-oracle': `Каждое ${PUPPET_RULES.oracleEvery}-е срабатывание передаёт ${PUPPET_RULES.oracleWind} единиц завода другой кукле с наименьшим зарядом; со священной ячейки — ${PUPPET_RULES.oracleSacredWind}.`,
};

export const PUPPET_FORMS: readonly PuppetForm[] = [
  { id: 'tin-soldier', heroClass: 'guard', branch: 'theatrical', name: 'Оловянный солдат', passiveId: 'tin-parade', passiveName: 'Парадный залп', passiveDescription: passiveDescriptions['tin-parade'], maxDurability: 88, maxWindUp: 90, windDrainPerSecond: 4.8, armor: 0, damageTakenMultiplier: 1.1, itemCooldownFactor: .9, cellModifiers: [{ tag: 'threaded', cells: diagonal, label: cellLabels.threaded }] },
  { id: 'automaton-bastion', heroClass: 'guard', branch: 'mechanical', name: 'Автоматон-бастион', passiveId: 'bastion-counterwind', passiveName: 'Контрход бастиона', passiveDescription: passiveDescriptions['bastion-counterwind'], maxDurability: 140, maxWindUp: 110, windDrainPerSecond: 3.8, armor: PUPPET_RULES.bastionArmor, damageTakenMultiplier: .9, itemCooldownFactor: 1.04, cellModifiers: [{ tag: 'mechanical', cells: reverseDiagonal, label: cellLabels.mechanical }] },
  { id: 'armored-reliquary', heroClass: 'guard', branch: 'mystical', name: 'Панцирный реликвариум', passiveId: 'reliquary-offering', passiveName: 'Подношение реликвариума', passiveDescription: passiveDescriptions['reliquary-offering'], maxDurability: 118, maxWindUp: 105, windDrainPerSecond: 4.1, armor: 1, damageTakenMultiplier: .94, itemCooldownFactor: 1.02, cellModifiers: [{ tag: 'sacred', cells: centerLine, label: cellLabels.sacred }] },
  { id: 'thread-marionette', heroClass: 'huntress', branch: 'theatrical', name: 'Марионетка на нитях', passiveId: 'thread-dance', passiveName: 'Танец на нитях', passiveDescription: passiveDescriptions['thread-dance'], maxDurability: 78, maxWindUp: 92, windDrainPerSecond: 4.6, armor: 0, damageTakenMultiplier: 1.14, itemCooldownFactor: .96, cellModifiers: [{ tag: 'threaded', cells: reverseDiagonal, label: cellLabels.threaded }] },
  { id: 'clockwork-pathfinder', heroClass: 'huntress', branch: 'mechanical', name: 'Часовой следопыт', passiveId: 'clockwork-mark', passiveName: 'Прицельная метка', passiveDescription: passiveDescriptions['clockwork-mark'], maxDurability: 96, maxWindUp: 100, windDrainPerSecond: 4.2, armor: 1, damageTakenMultiplier: .96, itemCooldownFactor: .94, cellModifiers: [{ tag: 'mechanical', cells: centerLine, label: cellLabels.mechanical }] },
  { id: 'fate-hound', heroClass: 'huntress', branch: 'mystical', name: 'Гончая судьбы', passiveId: 'fate-streak', passiveName: 'Нить неизбежности', passiveDescription: passiveDescriptions['fate-streak'], maxDurability: 94, maxWindUp: 108, windDrainPerSecond: 4.0, armor: 0, damageTakenMultiplier: .98, itemCooldownFactor: 1, cellModifiers: [{ tag: 'cursed', cells: edgeLine, label: cellLabels.cursed }] },
  { id: 'winding-penitent', heroClass: 'pilgrim', branch: 'theatrical', name: 'Заводной кающийся', passiveId: 'penitent-winding', passiveName: 'Покаянный подзавод', passiveDescription: passiveDescriptions['penitent-winding'], maxDurability: 84, maxWindUp: 90, windDrainPerSecond: 4.7, armor: 0, damageTakenMultiplier: 1.1, itemCooldownFactor: .97, cellModifiers: [{ tag: 'cursed', cells: diagonal, label: cellLabels.cursed }] },
  { id: 'spring-pilgrim', heroClass: 'pilgrim', branch: 'mechanical', name: 'Пружинный пилигрим', passiveId: 'spring-reservoir', passiveName: 'Пружинный резерв', passiveDescription: passiveDescriptions['spring-reservoir'], maxDurability: 110, maxWindUp: 115, windDrainPerSecond: 3.5, armor: 2, damageTakenMultiplier: .94, itemCooldownFactor: 1.02, cellModifiers: [{ tag: 'mechanical', cells: reverseDiagonal, label: cellLabels.mechanical }] },
  { id: 'martyr-doll', heroClass: 'pilgrim', branch: 'mystical', name: 'Кукла-мученик', passiveId: 'martyr-reflection', passiveName: 'Мученический отпор', passiveDescription: passiveDescriptions['martyr-reflection'], maxDurability: 100, maxWindUp: 110, windDrainPerSecond: 4.0, armor: 0, damageTakenMultiplier: 1 + PUPPET_RULES.martyrExtraDamage, itemCooldownFactor: 1, cellModifiers: [{ tag: 'sacred', cells: edgeLine, label: cellLabels.sacred }] },
  { id: 'puppet-mistress', heroClass: 'clockmaker', branch: 'theatrical', name: 'Хозяйка марионеток', passiveId: 'puppet-mistress', passiveName: 'Нити хозяйки', passiveDescription: passiveDescriptions['puppet-mistress'], maxDurability: 86, maxWindUp: 100, windDrainPerSecond: 4.3, armor: 0, damageTakenMultiplier: 1.08, itemCooldownFactor: .95, cellModifiers: [{ tag: 'threaded', cells: centerLine, label: cellLabels.threaded }] },
  { id: 'automaton-master', heroClass: 'clockmaker', branch: 'mechanical', name: 'Автоматон-мастер', passiveId: 'master-overclock', passiveName: 'Тройной разгон', passiveDescription: passiveDescriptions['master-overclock'], maxDurability: 104, maxWindUp: 108, windDrainPerSecond: 3.9, armor: 1, damageTakenMultiplier: .96, itemCooldownFactor: .98, cellModifiers: [{ tag: 'mechanical', cells: diagonal, label: cellLabels.mechanical }] },
  { id: 'gear-oracle', heroClass: 'clockmaker', branch: 'mystical', name: 'Оракул шестерёнок', passiveId: 'gear-oracle', passiveName: 'Предсказанный завод', passiveDescription: passiveDescriptions['gear-oracle'], maxDurability: 92, maxWindUp: 112, windDrainPerSecond: 3.9, armor: 0, damageTakenMultiplier: .95, itemCooldownFactor: 1.04, cellModifiers: [{ tag: 'sacred', cells: reverseDiagonal, label: cellLabels.sacred }] },
];

const formById = new Map(PUPPET_FORMS.map(form => [form.id, form]));
const heroClasses: Record<HeroClass, true> = { guard: true, huntress: true, pilgrim: true, clockmaker: true };
if (formById.size !== PUPPET_FORMS.length || Object.keys(heroClasses).some(heroClass => {
  const forms = PUPPET_FORMS.filter(form => form.heroClass === heroClass);
  return forms.length !== 3 || new Set(forms.map(form => form.branch)).size !== 3;
})) throw new Error('Puppet catalog must contain unique forms for all three branches of each class');

export function getPuppetForm(formId: PuppetFormId | null | undefined): PuppetForm | undefined {
  return formId ? formById.get(formId) : undefined;
}

export function choosePuppetForm(heroClass: HeroClass, random: () => number): PuppetForm {
  const choices = PUPPET_FORMS.filter(form => form.heroClass === heroClass);
  const roll = random();
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new Error('Puppet RNG must return a finite number in [0, 1)');
  const form = choices[Math.floor(roll * choices.length)];
  if (!form) throw new Error(`No puppet form for class: ${heroClass}`);
  return form;
}

export function defaultPuppetForm(heroClass: HeroClass): PuppetForm {
  const form = PUPPET_FORMS.find(candidate => candidate.heroClass === heroClass);
  if (!form) throw new Error(`No puppet form for class: ${heroClass}`);
  return form;
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

  if (tags.has('threaded')) cooldownMultiplier *= 1 - PUPPET_RULES.threadedCooldownReduction;
  if (tags.has('mechanical')) { cooldownMultiplier *= 1 - PUPPET_RULES.mechanicalCooldownReduction; chargeCost += PUPPET_RULES.mechanicalChargeCost; }
  if (tags.has('cursed')) {
    if (item.effect !== 'heal' && item.effect !== 'wind') outputMultiplier *= 1 + PUPPET_RULES.cursedDamageBonus;
    chargeCost += PUPPET_RULES.cursedChargeCost;
  }
  if (tags.has('sacred') && item.effect === 'heal') outputMultiplier *= 1 + PUPPET_RULES.sacredHealingBonus;

  switch (form.passiveId) {
    case 'tin-parade':
      if (nextActivation % PUPPET_RULES.tinEvery === 0) { outputMultiplier *= 1 + PUPPET_RULES.tinBonus; adjacentCooldownReductionMs = PUPPET_RULES.tinNeighbourReductionMs; }
      break;
    case 'thread-dance':
      if (adjacent) { cooldownMultiplier *= 1 - PUPPET_RULES.threadCooldownReduction; adjacentCooldownReductionMs = PUPPET_RULES.threadNeighbourReductionMs; }
      break;
    case 'clockwork-mark':
      if (item.reach === 'far' && tags.has('mechanical') && item.effect !== 'heal' && item.effect !== 'wind') { outputMultiplier *= 1 + PUPPET_RULES.pathfinderDamageBonus; chargeRefund += PUPPET_RULES.pathfinderWindRefund; }
      break;
    case 'fate-streak':
      if (targetId && actor.puppetPassiveState.repeatedTargetId === targetId) outputMultiplier *= Math.min(1 + PUPPET_RULES.fateMaxBonus, 1 + actor.puppetPassiveState.repeatedTargetCount * PUPPET_RULES.fateBonusPerHit);
      break;
    case 'spring-reservoir':
      if (tags.has('mechanical')) chargeRefund += PUPPET_RULES.springWindRefund;
      break;
    case 'reliquary-offering':
      if (tags.has('sacred')) { chargeRefund += PUPPET_RULES.reliquaryWindRefund; durabilityRepair = PUPPET_RULES.reliquaryRepair; }
      break;
    case 'puppet-mistress':
      adjacentCooldownReductionMs = PUPPET_RULES.mistressNeighbourReductionMs;
      break;
    case 'master-overclock':
      if (tags.has('mechanical') && (actor.puppetPassiveState.mechanicalActivations + 1) % PUPPET_RULES.masterEvery === 0 && actor.windUpCharge >= chargeCost + PUPPET_RULES.masterChargeCost) { outputMultiplier *= 1 + PUPPET_RULES.masterBonus; chargeCost += PUPPET_RULES.masterChargeCost; }
      break;
    case 'gear-oracle':
      if (nextActivation % PUPPET_RULES.oracleEvery === 0) oracleCharge = tags.has('sacred') ? PUPPET_RULES.oracleSacredWind : PUPPET_RULES.oracleWind;
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
  return form.windDrainPerSecond * Math.max(1 - PUPPET_RULES.springMaxDrainReduction, 1 - occupiedMechanicalCells.size * PUPPET_RULES.springDrainReductionPerCell);
}
