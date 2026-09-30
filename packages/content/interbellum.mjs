// Университеты и жетоны управляющих из дополнения «Интербеллум».
//
// Значения и картинки сняты с PDF издателя (scripts/extract-official-pdfs.py).
// Сами PDF и извлечённые картинки принадлежат издателю: публиковать их нельзя.
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
      { id: 'uni-metal-a', image: 'uni-1', options: [uniGain({ metal: 1 }), uniTrade({ oil: 1 }, { money: 4 })] },
      { id: 'uni-metal-b', image: 'uni-2', options: [uniGain({ metal: 1 }), uniTrade({ coal: 2 }, { money: 2 })] },
    ],
  },
  {
    id: 'uni-coal',
    sides: [
      { id: 'uni-coal-a', image: 'uni-3', options: [uniGain({ coal: 2 }), uniTrade({ metal: 1 }, { money: 2 })] },
      { id: 'uni-coal-b', image: 'uni-4', options: [uniGain({ coal: 2 }), uniTrade({ metal: 1 }, { oil: 1 })] },
    ],
  },
  {
    id: 'uni-money',
    sides: [
      { id: 'uni-money-a', image: 'uni-5', options: [uniGain({ money: 1 }), uniTrade({ metal: 1 }, { upgrade: 1 })] },
      { id: 'uni-money-b', image: 'uni-6', options: [uniGain({ money: 1 }), uniTrade({ coal: 2 }, { upgrade: 1 })] },
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
    { kind: 'repeat-supply' }),
  ...managerToken('local-coal-metal-or-oil', 1,
    'Получите либо 1 уголь и 1 металл, либо 1 нефть. Тратятся только эффектами этого предприятия.',
    { kind: 'local-choice', options: [{ coal: 1, metal: 1 }, { oil: 1 }] }),
  ...managerToken('local-four-coal', 1,
    'Получите 4 угля. Тратятся только эффектами этого предприятия.',
    { kind: 'local-gain', gain: { coal: 4 } }),
];

// Порядок страниц в «жетоны управляющих.pdf». Повторы поставки и «вывести за 4» — по два жетона.
const MANAGER_IMAGES = {
  'upgrade-for-metal': ['mgr-01'], 'repeat-supply': ['mgr-02', 'mgr-13'], 'money-if-all-sales': ['mgr-03'],
  'money-per-exchange': ['mgr-04'], 'discard-for-money': ['mgr-05', 'mgr-06'], 'oil-if-all-sales': ['mgr-07'],
  'free-exchange-once': ['mgr-08'], 'local-coal-metal-or-oil': ['mgr-09'], 'local-four-coal': ['mgr-10'],
  'repeat-each-exchange': ['mgr-11'], 'money-per-sale': ['mgr-12'], 'coal-per-sale': ['mgr-14'],
};
const seenFamily = {};
for (const token of managerTokens) {
  const n = seenFamily[token.family] = (seenFamily[token.family] ?? -1) + 1;
  token.image = MANAGER_IMAGES[token.family]?.[n] ?? null;
}

/** Личный управляющий промышленника: в стопку аукциона не попадает. */
export const personalManager = {
  id: 'personal-manager', family: 'personal-manager', personal: true,
  text: 'Получите либо 1 уголь и 1 металл, либо 1 жетон модернизации. Тратятся только эффектами этого предприятия.',
  effect: { kind: 'local-choice', options: [{ coal: 1, metal: 1 }, { upgrade: 1 }] },
  needs: null, playable: true, image: 'mgr-15',
};

/**
 * Стопка жетонов для аукциона — все 14.
 *
 * Раньше два жетона повтора поставки откладывались: поставок в движке не было,
 * и правила сами предписывают убирать их при игре без новых карт предприятий.
 * Теперь поставки реализованы, и стопка полная.
 * Личный жетон промышленника в стопку не входит: он выдаётся Распорядителю.
 */
export const auctionManagers = managerTokens;
export const deferredManagers = [];

/**
 * Промышленники «Интербеллума». В коробке их пять, «в том числе одна обновлённая»:
 * обновлённый Артур заменяет базовую карту, поэтому здесь только четыре новых.
 * Формулировки свои, значения сняты со сканов пользователя.
 */
export const interbellumCapitalists = [
  {
    id: 'ib-cap-compensation', images: ['/apps/web/assets/official/char-02.jpg'], name: 'Компенсатор', ability: 'compensation-before-normal',
    text: 'Используя каждое своё немодернизированное предприятие в фазе производства, можете один раз разыграть его эффект компенсации — перед обычными строками.',
    notes: [],
  },
  {
    id: 'ib-cap-variable', images: ['/apps/web/assets/official/char-04.jpg'], name: 'Капиталист', ability: 'variable-plus-two',
    text: 'Значение вашего диска переменного капитала на 2 больше, чем потрачено угля.',
    notes: ['Правила дополнения, «Отдельные модули»: без дисков переменного капитала этот промышленник не используется.'],
  },
  {
    id: 'ib-cap-personal', images: ['/apps/web/assets/official/char-07.jpg'], name: 'Распорядитель', ability: 'personal-manager',
    text: 'У вас есть личный управляющий. На одном предприятии можно размещать несколько управляющих.',
    notes: ['Правила дополнения, «Отдельные модули»: без жетонов управляющих этот промышленник не используется.'],
  },
  {
    id: 'ib-cap-neighbour', images: ['/apps/web/assets/official/char-08.jpg'], name: 'Сосед', ability: 'use-neighbour-card',
    text: 'В конце каждой фазы производства можете один раз потратить 1 металл, чтобы использовать не стартовое предприятие соседа справа.',
    notes: ['Постоянные эффекты чужой карты не действуют, жетоны управляющих на ней работают (правила дополнения, стр. 11).'],
  },
];

/** Промышленники дополнения, которых движок уже умеет. */
export const playableInterbellumCapitalists = interbellumCapitalists.filter(c => !c.needs);

/**
 * Четыре односторонних стартовых предприятия дополнения («Стартовые предприятия.pdf»,
 * стр. 3, 6, 7 и 9). Порядок строк — сверху вниз, как напечатано. Стартовые ресурсы
 * взяты с верхней полосы карты.
 *
 * Модернизация здесь параметризована: `cost` — что платится за одну карту, `limit` —
 * сколько раз (без `limit` — сколько угодно, как на базовых стартовых картах).
 */
const stTake = values => ({ kind: 'gain', gain: values });
const stTrade = (cost, output, limit) => ({ kind: 'convert', cost, gain: output, limit });
const stUpgrade = (cost, limit) => ({ kind: 'upgrade', cost, ...(limit ? { limit } : {}) });
export const interbellumStarts = [
  {
    id: 'ib-start-1', name: 'Стартовое предприятие 6', image: 'st-off-3', starting: { metal: 2 },
    effects: [stTrade({ coal: 1 }, { money: 1 }, 3), stUpgrade({ coal: 1 }, 1), stUpgrade({ upgrade: 1 }, 1)],
  },
  {
    id: 'ib-start-2', name: 'Стартовое предприятие 7', image: 'st-off-6', starting: { coal: 1, metal: 1 },
    effects: [
      { kind: 'permanent', rule: 'upgrade-on-gain', text: 'Всякий раз, когда получаете жетон модернизации, можете потратить жетон и уголь, чтобы модернизировать любое число карт.' },
      stTake({ upgrade: 1 }),
      stTrade({ coal: 1, metal: 1 }, { money: 4 }, 1),
    ],
  },
  {
    id: 'ib-start-3', name: 'Стартовое предприятие 8', image: 'st-off-7', starting: { coal: 2 },
    effects: [
      { kind: 'permanent', rule: 'store-on-big-compensation', resource: 'oil', text: 'Всякий раз, когда получаете компенсацию за диск 3 или 4, кладите 1 нефть на эту карту.' },
      { kind: 'take-stored', resource: 'oil', text: 'Возьмите всю нефть с этой карты.' },
      stTake({ upgrade: 1 }),
      stUpgrade({ coal: 1, upgrade: 1 }),
    ],
  },
  {
    id: 'ib-start-4', name: 'Стартовое предприятие 9', image: 'st-off-9', starting: { oil: 1 },
    effects: [stTake({ upgrade: 1 }), stTrade({ metal: 1 }, { coal: 2, money: 1 }, 2), stUpgrade({ coal: 1, upgrade: 1 })],
  },
];
