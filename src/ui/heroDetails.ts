import { ATTRIBUTE_EFFECT_PERCENT, attributeModifier, type HeroAttributes } from '../combat/simulation.ts';

const attributes = [
  ['strength', 'Сила', 'Урон оружия', ATTRIBUTE_EFFECT_PERCENT.itemOutput],
  ['dexterity', 'Ловкость', 'Перезарядка', ATTRIBUTE_EFFECT_PERCENT.cooldown],
  ['constitution', 'Стойкость', 'Броня', 1],
  ['intellect', 'Разум', 'Урон вещей', ATTRIBUTE_EFFECT_PERCENT.itemOutput],
  ['wisdom', 'Воля', 'Лечение', ATTRIBUTE_EFFECT_PERCENT.itemOutput],
  ['presence', 'Дух', 'Подзавод', ATTRIBUTE_EFFECT_PERCENT.itemOutput],
] as const;

export function signedNumber(value: number): string {
  return value < 0 ? `−${Math.abs(value)}` : `+${value}`;
}

export function heroAttributeRows(scores: HeroAttributes) {
  return attributes.map(([key, name, effect, multiplier]) => {
    const score = scores[key];
    const modifier = attributeModifier(score);
    const unit = key === 'constitution' ? '' : '%';
    return { name, score, modifier: signedNumber(modifier), effect, bonus: `${signedNumber(modifier * multiplier)}${unit}` };
  });
}
