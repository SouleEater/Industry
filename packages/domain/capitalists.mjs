// Промышленники. Пять способностей из расшифровки персонажей (PPTX №116).
// Модуль чистый: принимает игрока и ставки, возвращает числа и решения.
//
//   repeat-card          Эварист  раз за фазу производства: 2 угля → повторить свою карту
//   compensation-plus-one Генри    значение своего диска для компенсации считается на 1 больше
//   unrestricted-bids    Моника   диски без ограничений по значению и владельцу; ничью проигрывает
//   paired-extra-disc    Артур    дополнительный диск 2 своего цвета
//                                 База: ставится как любой другой диск.
//                                 «Интербеллум» заменяет эту карту обновлённой, где двойку
//                                 нужно выкладывать одновременно с другой своей ставкой
//                                 на другую карту (флаг pairedExtraDisc).
//   metal-for-upgrade    Тимур    металл вместо жетона модернизации, но только когда жетоны кончились

export const ABILITIES = [
  // База
  'repeat-card', 'compensation-plus-one', 'unrestricted-bids', 'paired-extra-disc', 'metal-for-upgrade',
  // «Интербеллум»
  'compensation-before-normal',   // раз на каждое немодернизированное предприятие — его компенсация
  'variable-plus-two',            // диск переменного капитала на 2 больше потраченного угля
  'personal-manager',             // личный жетон и несколько управляющих на одной карте
];

/** Прибавка к значению диска переменного капитала. */
export const variableBonus = player => (has(player, 'variable-plus-two') ? 2 : 0);
/** Можно ли класть несколько управляющих на одно предприятие. */
export const stacksManagers = player => has(player, 'personal-manager');

export const has = (player, name) => Boolean(player) && player.ability === name;

/** Сколько единиц компенсации даёт проигравший диск (F: Генри считает на 1 больше). */
export const compensationUnits = (player, value) =>
  value + (has(player, 'compensation-plus-one') ? 1 : 0);

/** Чем платится модернизация. Металл — только при нулевом запасе жетонов. */
export const upgradeCost = player =>
  player.wallet.upgrade === 0 && has(player, 'metal-for-upgrade')
    ? { coal: 1, metal: 1 }
    : { coal: 1, upgrade: 1 };

/** Дополнительный диск, который добавляется к обычному комплекту 1–4. */
export const extraDisc = player =>
  has(player, 'paired-extra-disc')
    ? { id: 'bonus2', kind: 'fixed', value: 2, used: false, bonus: true }
    : null;

/** Моника ставит диск на любое значение и на занятое ею же предприятие. */
export const ignoresBidLimits = player => has(player, 'unrestricted-bids');

/**
 * Победитель лота. Ничья возможна только из-за Моники (F02):
 * при равенстве на максимуме предприятие уходит сопернику, Моника получает компенсацию.
 */
export function pickWinner(bids, playerOf) {
  if (!bids.length) return null;
  const max = Math.max(...bids.map(b => b.value));
  const top = bids.filter(b => b.value === max);
  if (top.length === 1) return top[0];
  return top.find(b => !ignoresBidLimits(playerOf(b.playerId))) ?? top[0];
}
