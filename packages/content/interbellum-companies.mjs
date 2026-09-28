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

const coal = n => ({ coal: n });
const metal = n => ({ metal: n });
const oil = n => ({ oil: n });
const upg = n => ({ upgrade: n });
const money = n => ({ money: n });
const mix = (...parts) => Object.assign({}, ...parts);

const take = values => ({ kind: 'gain', gain: values });
const swap = (cost, out, limit = 1) => ({ kind: 'convert', cost, gain: out, limit });
/** Поставка: однократный эффект, срабатывает при получении карты или при её модернизации. */
const supply = of => ({ kind: 'supply', of });
/** Текстовый эффект: разыгрывается в свою очередь при использовании карты. */
const text = (id, note) => ({ kind: 'text', id, text: note, needs: 'text' });
/** Постоянный эффект: действует с момента получения карты, в том числе на аукционе. */
const always = (id, note) => ({ kind: 'permanent', id, text: note, needs: 'permanent' });

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
  card(0, take(coal(2)), [supply(take(coal(3)))], [take(oil(1))]),
  card(1, take(metal(1)),
    [text('gain-per-card-sell-coal', 'Получите 1 уголь за каждую вашу карту, где можете продать уголь.')],
    [swap(metal(1), money(2), 4)]),
  card(2, take(metal(1)), [supply(take(upg(1)))], [swap(mix(coal(1), metal(1)), money(4), 3)]),
  card(3, swap(metal(1), oil(1)), [swap(metal(1), upg(1), 1)], [swap(metal(1), money(2), 4)]),
  card(4, swap(coal(1), metal(1)),
    [always('store-on-outbid', 'Всякий раз, когда соперник перебивает вашу ставку, которая до того была наивысшей на карте, кладите сюда 1 металл из резерва.'),
      text('take-all-from-card', 'Возьмите все металлы с этой карты.')],
    [take(upg(1))]),
  card(5, take(coal(2)), [swap(coal(1), oil(1), 1)],
    [text('bonus-per-sale-of-metal', 'Всякий раз, когда продаёте металл, получайте ещё 1 деньгу за каждую продажу.')],
    ['Владелец коробки 28.09.2026: строка работает на модернизированной стороне — это подтверждено.',
      'Расхождение в единице счёта: на карте напечатано «за каждую продажу», и пояснения дополнения (стр. 11) '
      + 'определяют продажу как отдельную операцию. Владелец описал эффект как «за каждый проданный металл». '
      + 'Разница видна, когда одна операция продаёт два металла. Реализуем по напечатанному, до сверки.']),
  card(6, swap(metal(1), oil(1)), [swap(metal(1), mix(coal(2), money(1)), 2)],
    [swap(mix(oil(1), upg(1)), money(10), 1)],
    ['На скане у выхода ДВА кубика угля и монета, кратность ×2. Владелец 28.09.2026 описал выход '
      + 'как «1 уголь и 1 монета». Оставлено по скану, расхождение требует сверки с картой.']),
  card(7, swap(coal(2), upg(1)), [swap(oil(1), money(4), 1)], [swap(mix(metal(1), upg(1)), money(8), 1)]),
  card(8, take(coal(2)), [swap(metal(1), money(2), 2)], [supply(take(oil(2)))]),
  card(9, take(coal(2)), [swap(upg(1), money(5), 1)],
    [text('gain-per-card-sell-metal', 'Получите 1 металл за каждую вашу карту, где можете продать металл.')]),
  card(10, swap(metal(1), upg(1)),
    [text('bonus-per-sale-of-oil', 'Всякий раз, когда продаёте нефть, получайте ещё 1 деньгу за каждую продажу.')],
    [swap(mix(coal(1), metal(1)), money(4), 3)]),
  card(11, take(coal(2)), [supply(take(coal(3)))], [swap(mix(metal(1), oil(1)), money(7), 2)]),
  card(12, swap(oil(1), metal(3)), [swap(mix(coal(1), upg(1)), money(7), 1)], [supply(take(coal(6)))]),
  card(13, swap(metal(1), coal(4)), [swap(oil(1), mix(coal(1), money(3)), 1)],
    [supply(swap(metal(1), money(2), 8))],
    ['Владелец коробки 28.09.2026: поставка срабатывает один раз при модернизации, '
      + 'но жетон управляющего с молнией позволяет разыграть её ещё раз в следующем раунде, '
      + 'если этот жетон положен на эту карту. Подтверждает смысл жетонов repeat-supply.']),
  card(14, take(coal(2)),
    [always('bonus-coal-on-mine', 'В фазе производства каждый ваш эффект добычи угля приносит дополнительный уголь.')],
    [take(upg(1))]),
  card(15, swap(oil(1), metal(3)), [swap(coal(2), metal(1), 1)], [supply(swap(oil(1), money(4), 4))]),
  card(16, swap(coal(1), metal(1)), [swap(coal(2), upg(1), 1)],
    [text('gain-per-card-exchange-metal', 'Получите 1 металл за каждую вашу карту, где можете обменять металл.')]),
  card(17, swap(metal(1), oil(1)), [swap(metal(1), oil(1), 2)], [supply(take(upg(2)))]),
  card(18, swap(coal(2), oil(1)),
    [always('extra-use-single-resource-sales', 'Каждый ваш эффект, продающий только один вид ресурса, можно применить ещё 1 раз.')],
    [take(mix(coal(1), metal(1)))]),
  card(19, swap(coal(1), metal(1)), [take(coal(2))],
    [{ kind: 'upgrade-next-in-line', needs: 'text',
      text: 'Модернизируйте следующее предприятие в вашей линии.' }],
    ['На скане одиночный значок переворота карты без стоимости — сама иконка не говорит, какую карту.',
      'Владелец коробки 28.09.2026: модернизируется следующая карта в линии после этой, '
      + 'и только если эта карта уже модернизирована. Реализуем так.',
      'Пояснения по текстовым эффектам в правилах дополнения такой формулировки не содержат, '
      + 'поэтому прочтение остаётся решением владельца, а не доказанным правилом.']),
  card(20, swap(coal(2), oil(1)), [supply(take(metal(2)))], [swap(mix(coal(1), oil(1)), money(6), 2)]),
  card(21, swap(metal(1), oil(1)), [supply(take(oil(1)))], [swap(mix(coal(1), metal(1)), money(4), 3)]),
  card(22, take(coal(2)),
    [always('store-upgrade-coal', 'Кладите на эту карту каждый уголь, который потратили на модернизацию.'),
      { ...swap(coal(2), upg(1), 2), from: 'card', needs: 'text', text: 'Тратится уголь, лежащий на этой карте.' }],
    [swap(metal(1), money(2), 4)]),
  card(23, swap(coal(2), oil(1)),
    [text('gain-per-card-exchange-coal', 'Получите 1 уголь за каждую вашу карту, где можете обменять уголь.')],
    [swap(oil(1), money(4), 2)]),
];

/** Какие механики требует строка, если движок её ещё не умеет. */
export const rowNeeds = row => row.needs ?? (row.kind === 'supply' ? (row.of.needs ?? 'supply') : null);

/** Карта играбельна, когда ни одной её строке не нужна нереализованная механика. */
export const companyNeeds = entry => {
  const set = new Set();
  for (const row of [entry.compensation, ...entry.basic, ...entry.advanced]) {
    const need = rowNeeds(row);
    if (need) set.add(need);
  }
  return [...set];
};
