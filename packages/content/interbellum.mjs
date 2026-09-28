// Университеты и жетоны управляющих из дополнения «Интербеллум».
//
// Числовые значения сняты со сканов пользователя. Иллюстрации в проект не входят:
// правила и компоненты издателя защищены авторским правом, поэтому в цифровом столе
// используются только игровые значения и собственные формулировки.
//
// Университет — это карта с ДВУМЯ вариантами компенсации. Игрок, чей диск проиграл,
// делит свои единицы компенсации между вариантами как хочет (правила дополнения, стр. 7).

// Имена локальных помощников не должны совпадать с другими модулями:
// сборщик склеивает их в один классический скрипт.
const uniGain = values => ({ kind: 'gain', gain: values });
const uniTrade = (cost, output) => ({ kind: 'convert', cost, gain: output, limit: 1 });

// Стороны парные по верхнему варианту: металл/металл, уголь/уголь, деньги/деньги.
// Это следует из самих сканов; точная привязка сторон к физическим картам не доказана
// и влияет только на то, какие две грани не могут выпасть одновременно.
export const universityCards = [
  {
    id: 'uni-metal',
    sides: [
      { id: 'uni-metal-a', options: [uniGain({ metal: 1 }), uniTrade({ oil: 1 }, { money: 4 })] },
      { id: 'uni-metal-b', options: [uniGain({ metal: 1 }), uniTrade({ coal: 2 }, { money: 2 })] },
    ],
  },
  {
    id: 'uni-coal',
    sides: [
      { id: 'uni-coal-a', options: [uniGain({ coal: 2 }), uniTrade({ metal: 1 }, { money: 2 })] },
      { id: 'uni-coal-b', options: [uniGain({ coal: 2 }), uniTrade({ metal: 1 }, { oil: 1 })] },
    ],
  },
  {
    id: 'uni-money',
    sides: [
      { id: 'uni-money-a', options: [uniGain({ money: 1 }), uniTrade({ metal: 1 }, { upgrade: 1 })] },
      { id: 'uni-money-b', options: [uniGain({ money: 1 }), uniTrade({ coal: 2 }, { upgrade: 1 })] },
    ],
  },
];

/**
 * Жетоны управляющих. 14 обычных разыгрываются на аукционе, пятнадцатый —
 * личный жетон промышленника, он не попадает в стопку.
 *
 * `needs` перечисляет, какой механики требует жетон. Пока она не реализована,
 * жетон не попадает в игру: `playable` считается по этому полю.
 *   supply      — поставки (эффект ⚡) из дополнения
 *   localPool   — ресурсы, которые лежат на карте и тратятся только её эффектами
 */
const managerToken = (id, count, text, effect, needs = null) =>
  Array.from({ length: count }, (_, i) => ({
    id: count > 1 ? `${id}-${i + 1}` : id, family: id, text, effect, needs, playable: needs === null,
  }));

export const managerTokens = [
  ...managerToken('upgrade-for-metal', 1,
    'Можно потратить 1 металл и перевернуть это предприятие на улучшенную сторону.',
    { kind: 'upgrade-self', cost: { metal: 1 } }),
  ...managerToken('discard-for-money', 2,
    'Можно вывести это предприятие из игры и получить 4 денег.',
    { kind: 'discard-self', gain: { money: 4 } }),
  ...managerToken('money-per-exchange', 1,
    'За каждый обмен по этому предприятию вы получаете 1 деньгу.',
    { kind: 'per-operation', on: 'exchange', gain: { money: 1 } }),
  ...managerToken('money-per-sale', 1,
    'За каждую продажу по этому предприятию вы получаете 1 деньгу.',
    { kind: 'per-operation', on: 'sale', gain: { money: 1 } }),
  ...managerToken('coal-per-sale', 1,
    'За каждую продажу по этому предприятию вы получаете 1 уголь.',
    { kind: 'per-operation', on: 'sale', gain: { coal: 1 } }),
  ...managerToken('money-if-all-sales', 1,
    'Если все строки продажи этого предприятия применены полностью, вы получаете 3 деньги.',
    { kind: 'if-all-sales', gain: { money: 3 } }),
  ...managerToken('oil-if-all-sales', 1,
    'Если все строки продажи этого предприятия применены полностью, вы получаете 1 нефть.',
    { kind: 'if-all-sales', gain: { oil: 1 } }),
  ...managerToken('free-exchange-once', 1,
    'Одно применение обмена по этому предприятию не тратит ресурсы.',
    { kind: 'free-operation', on: 'exchange', times: 1 }),
  ...managerToken('repeat-each-exchange', 1,
    'Каждую строку обмена этого предприятия можно применить на 1 раз больше.',
    { kind: 'extra-limit', on: 'exchange', amount: 1 }),
  ...managerToken('repeat-supply', 2,
    'Эффект поставки этого предприятия разыгрывается ещё раз.',
    { kind: 'repeat-supply' }, 'supply'),
  ...managerToken('local-coal-metal-or-oil', 1,
    'Получите либо 1 уголь и 1 металл, либо 1 нефть. Тратятся только эффектами этого предприятия.',
    { kind: 'local-choice', options: [{ coal: 1, metal: 1 }, { oil: 1 }] }, 'localPool'),
  ...managerToken('local-four-coal', 1,
    'Получите 4 угля. Тратятся только эффектами этого предприятия.',
    { kind: 'local-gain', gain: { coal: 4 } }, 'localPool'),
];

/** Личный управляющий промышленника: в стопку аукциона не попадает. */
export const personalManager = {
  id: 'personal-manager', family: 'personal-manager', personal: true,
  text: 'Получите либо 1 уголь и 1 металл, либо 1 жетон модернизации. Тратятся только эффектами этого предприятия.',
  effect: { kind: 'local-choice', options: [{ coal: 1, metal: 1 }, { upgrade: 1 }] },
  needs: 'localPool', playable: false,
};

/**
 * Стопка жетонов для аукциона — 12 штук.
 *
 * Правила дополнения, «Отдельные модули»: играя без новых карт предприятий,
 * два жетона повтора поставки убираются в коробку. Поставок пока нет, то есть
 * это ровно наш случай, и стопка из 12 жетонов соответствует правилам.
 * Двенадцати хватает на четыре раунда даже вчетвером (3 университета × 4).
 *
 * Эффекты всех 12 жетонов стопки реализованы. Отложены только два жетона повтора
 * поставки: поставок в движке ещё нет, и правила сами предписывают убирать их,
 * когда играют без новых карт предприятий.
 */
export const auctionManagers = managerTokens.filter(t => t.needs !== 'supply');
export const deferredManagers = [...managerTokens.filter(t => t.needs === 'supply'), personalManager];
