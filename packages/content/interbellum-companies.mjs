// 24 карты предприятий «Интербеллума», снятые со сканов пользователя.
//
// Обе стороны читаются с одного скана: правила базы, стр.5 — «полупрозрачные символы
// показывают, какой продвинутый эффект получит карта после модернизации». Поэтому
// серые строки внизу обычной стороны и есть модернизированная сторона. Компенсация
// печатается только на обычной стороне и в фазе производства не используется.
//
// Иллюстрации издателя в проект не входят: правила и компоненты защищены авторским
// правом. Здесь только игровые значения.
//
// officialVerified: false — сверки с физическими картами не было.

// Имена с префиксом ib: сборщик склеивает все модули в один классический скрипт,
// а в каталоге базы уже есть свои помощники coal/metal/money.
const ibCoal = n => ({ coal: n });
const ibMetal = n => ({ metal: n });
const ibOil = n => ({ oil: n });
const ibUpg = n => ({ upgrade: n });
const ibMoney = n => ({ money: n });
const ibMix = (...parts) => Object.assign({}, ...parts);

const ibTake = values => ({ kind: 'gain', gain: values });
const ibSwap = (cost, out, limit = 1) => ({ kind: 'convert', cost, gain: out, limit });
/** Поставка: однократный эффект, срабатывает при получении карты или при её модернизации. */
const supply = of => ({ kind: 'supply', of });
/**
 * Текстовые эффекты разыгрываются в свою очередь при использовании карты.
 * Те, что движок уже умеет, описаны машиночитаемо; остальные помечены `needs`.
 */
/** «Получите X за каждую вашу карту, где можете продать/обменять Y». */
const perCard = (out, on, resource, note) => ({ kind: 'count-cards', gain: out, on, resource, text: note });
/** «Всякий раз, когда продаёте Y, получайте ещё X за каждую продажу». */
const saleBonus = (on, resource, out, note) => ({ kind: 'operation-bonus', on, resource, gain: out, text: note });
/** «Возьмите всё, что лежит на этой карте». */
const takeStored = (resource, note) => ({ kind: 'take-stored', resource, text: note });
/**
 * Постоянный эффект: действует с момента получения карты, в том числе на аукционе.
 * `rule` называет конкретное поведение, которое реализует движок.
 */
const always = (rule, note, extra = {}) => ({ kind: 'permanent', rule, text: note, ...extra });

/**
 * card(номер скана, компенсация, обычные строки, продвинутые строки, примечания)
 * Порядок строк — сверху вниз, как напечатано.
 */
const card = (scan, compensation, basic, advanced, notes = []) => ({
  id: `ib-${String(scan).padStart(2, '0')}`,
  source: { file: 'Карты_предприятий.pdf', page: scan + 1 },
  compensation, basic, advanced, notes,
  officialVerified: false,
});

export const interbellumCompanies = [
  card(0, ibTake(ibCoal(2)), [supply(ibTake(ibCoal(3)))], [ibTake(ibOil(1))]),
  card(1, ibTake(ibMetal(1)),
    [perCard(ibCoal(1), 'sale', 'coal', 'Получите 1 уголь за каждую вашу карту, где можете продать уголь.')],
    [ibSwap(ibMetal(1), ibMoney(2), 4)]),
  card(2, ibTake(ibMetal(1)), [supply(ibTake(ibUpg(1)))], [ibSwap(ibMix(ibCoal(1), ibMetal(1)), ibMoney(4), 3)]),
  card(3, ibSwap(ibMetal(1), ibOil(1)), [ibSwap(ibMetal(1), ibUpg(1), 1)], [ibSwap(ibMetal(1), ibMoney(2), 4)]),
  card(4, ibSwap(ibCoal(1), ibMetal(1)),
    [always('store-on-outbid', 'Всякий раз, когда соперник перебивает вашу ставку, которая до того была наивысшей на карте, кладите сюда 1 металл из резерва.', { resource: 'metal' }),
      takeStored('metal', 'Возьмите все металлы с этой карты.')],
    [ibTake(ibUpg(1))]),
  card(5, ibTake(ibCoal(2)), [ibSwap(ibCoal(1), ibOil(1), 1)],
    [saleBonus('sale', 'metal', ibMoney(1), 'Всякий раз, когда продаёте металл, получайте ещё 1 деньгу за каждую продажу.')],
    ['Владелец коробки 28.09.2026: строка работает на модернизированной стороне — это подтверждено.',
      'Расхождение в единице счёта: на карте напечатано «за каждую продажу», и пояснения дополнения (стр. 11) '
      + 'определяют продажу как отдельную операцию. Владелец описал эффект как «за каждый проданный металл». '
      + 'Разница видна, когда одна операция продаёт два металла. Реализуем по напечатанному, до сверки.']),
  card(6, ibSwap(ibMetal(1), ibOil(1)), [ibSwap(ibMetal(1), ibMix(ibCoal(2), ibMoney(1)), 2)],
    [ibSwap(ibMix(ibOil(1), ibUpg(1)), ibMoney(10), 1)],
    ['Владелец коробки 28.09.2026 подтвердил: 1 металл обменивается на 2 угля и 1 деньгу, до двух раз.']),
  card(7, ibSwap(ibCoal(2), ibUpg(1)), [ibSwap(ibOil(1), ibMoney(4), 1)], [ibSwap(ibMix(ibMetal(1), ibUpg(1)), ibMoney(8), 1)]),
  card(8, ibTake(ibCoal(2)), [ibSwap(ibMetal(1), ibMoney(2), 2)], [supply(ibTake(ibOil(2)))]),
  card(9, ibTake(ibCoal(2)), [ibSwap(ibUpg(1), ibMoney(5), 1)],
    [perCard(ibMetal(1), 'sale', 'metal', 'Получите 1 металл за каждую вашу карту, где можете продать металл.')]),
  card(10, ibSwap(ibMetal(1), ibUpg(1)),
    [saleBonus('sale', 'oil', ibMoney(1), 'Всякий раз, когда продаёте нефть, получайте ещё 1 деньгу за каждую продажу.')],
    [ibSwap(ibMix(ibCoal(1), ibMetal(1)), ibMoney(4), 3)]),
  card(11, ibTake(ibCoal(2)), [supply(ibTake(ibCoal(3)))], [ibSwap(ibMix(ibMetal(1), ibOil(1)), ibMoney(7), 2)]),
  card(12, ibSwap(ibOil(1), ibMetal(3)), [ibSwap(ibMix(ibCoal(1), ibUpg(1)), ibMoney(7), 1)], [supply(ibTake(ibCoal(6)))]),
  card(13, ibSwap(ibMetal(1), ibCoal(4)), [ibSwap(ibOil(1), ibMix(ibCoal(1), ibMoney(3)), 1)],
    [supply(ibSwap(ibMetal(1), ibMoney(2), 8))],
    ['Владелец коробки 28.09.2026: поставка срабатывает один раз при модернизации, '
      + 'но жетон управляющего с молнией позволяет разыграть её ещё раз в следующем раунде, '
      + 'если этот жетон положен на эту карту. Подтверждает смысл жетонов repeat-supply.']),
  card(14, ibTake(ibCoal(2)),
    [always('bonus-on-gain', 'В фазе производства каждый ваш эффект добычи угля приносит дополнительный уголь.', { resource: 'coal' })],
    [ibTake(ibUpg(1))]),
  card(15, ibSwap(ibOil(1), ibMetal(3)), [ibSwap(ibCoal(2), ibMetal(1), 1)], [supply(ibSwap(ibOil(1), ibMoney(4), 4))]),
  card(16, ibSwap(ibCoal(1), ibMetal(1)), [ibSwap(ibCoal(2), ibUpg(1), 1)],
    [perCard(ibMetal(1), 'exchange', 'metal', 'Получите 1 металл за каждую вашу карту, где можете обменять металл.')]),
  card(17, ibSwap(ibMetal(1), ibOil(1)), [ibSwap(ibMetal(1), ibOil(1), 2)], [supply(ibTake(ibUpg(2)))]),
  card(18, ibSwap(ibCoal(2), ibOil(1)),
    [always('extra-single-resource-sale', 'Каждый ваш эффект, продающий только один вид ресурса, можно применить ещё 1 раз.', { amount: 1 })],
    [ibTake(ibMix(ibCoal(1), ibMetal(1)))]),
  card(19, ibSwap(ibCoal(1), ibMetal(1)), [ibTake(ibCoal(2))],
    [{ kind: 'upgrade-next', text: 'Модернизируйте следующее предприятие в вашей линии.' }],
    ['На скане одиночный значок переворота карты без стоимости — сама иконка не говорит, какую карту.',
      'Владелец коробки 28.09.2026: модернизируется следующая карта в линии после этой, '
      + 'и только если эта карта уже модернизирована. Реализуем так.',
      'Пояснения по текстовым эффектам в правилах дополнения такой формулировки не содержат, '
      + 'поэтому прочтение остаётся решением владельца, а не доказанным правилом.']),
  card(20, ibSwap(ibCoal(2), ibOil(1)), [supply(ibTake(ibMetal(2)))], [ibSwap(ibMix(ibCoal(1), ibOil(1)), ibMoney(6), 2)]),
  card(21, ibSwap(ibMetal(1), ibOil(1)), [supply(ibTake(ibOil(1)))], [ibSwap(ibMix(ibCoal(1), ibMetal(1)), ibMoney(4), 3)]),
  card(22, ibTake(ibCoal(2)),
    [always('store-upgrade-cost', 'Кладите на эту карту каждый уголь, который потратили на модернизацию.', { resource: 'coal' }),
      { ...ibSwap(ibCoal(2), ibUpg(1), 2), from: 'card', text: 'Тратится уголь, лежащий на этой карте.' }],
    [ibSwap(ibMetal(1), ibMoney(2), 4)]),
  card(23, ibSwap(ibCoal(2), ibOil(1)),
    [perCard(ibCoal(1), 'exchange', 'coal', 'Получите 1 уголь за каждую вашу карту, где можете обменять уголь.')],
    [ibSwap(ibOil(1), ibMoney(4), 2)]),
];

/**
 * Какие механики требует строка, если движок её ещё не умеет.
 * Поставки реализованы, поэтому обёртка сама по себе ничего не требует —
 * смотрим только на то, что внутри.
 */
export const rowNeeds = row => (row.kind === 'supply' ? rowNeeds(row.of) : row.needs ?? null);

/** Карта играбельна, когда ни одной её строке не нужна нереализованная механика. */
export const companyNeeds = entry => {
  const set = new Set();
  for (const row of [entry.compensation, ...entry.basic, ...entry.advanced]) {
    const need = rowNeeds(row);
    if (need) set.add(need);
  }
  return [...set];
};
