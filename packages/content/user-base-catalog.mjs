// Transcription of the supplied layouts, not an official or playable content pack.
// Source identity is preserved: no silent deduplication or correction of artwork.
const gain = values => ({ kind: 'gain', gain: values });
const trade = (cost, output, limit = 1) => ({ kind: 'convert', cost, gain: output, limit });
const c = n => ({ coal: n }), m = n => ({ metal: n }), o = n => ({ oil: n });
const u = n => ({ upgrade: n }), money = n => ({ money: n });
const entries = [];
function company(group, entry, slide, compensation, basic, added, notes = []) {
  const number = entries.filter(x => x.group === group).length + 1;
  entries.push({ id: `user-${group}-${String(number).padStart(2, '0')}`, group,
    title: `${{ oil: 'Нефтяное предприятие', metal: 'Металлургическое предприятие', mine: 'Шахта' }[group]} ${number}`,
    kind: 'company', source: { archiveEntry: entry, slides: [slide, slide + 1] },
    compensation, basic, upgraded: [...basic, ...added], notes });
}

company('oil', 9, 1, gain(m(1)), [gain(m(1))], [trade({ coal: 1, oil: 1 }, money(6), 2)]);
company('oil', 9, 3, trade(c(2), o(1)), [trade(c(2), o(1), 2)], [trade({ coal: 1, metal: 1 }, money(4), 3)],
  ['В PDF №008 на стр. 3–4 показан другой рецепт: 1 уголь → 1 нефть, ×1. Здесь точно записан PPTX №009.']);
company('oil', 9, 5, trade(c(2), o(1)), [trade(c(1), o(1))], [trade({ coal: 1, metal: 1 }, money(4), 3)]);
company('oil', 9, 7, trade(m(1), u(1)), [trade(m(1), u(1), null)], [trade(c(3), money(4), 3)],
  ['На производственной стрелке PPTX отсутствует кратность. В PDF №008, стр. 5–6, указано ×1. Не нормализовать без сверки.']);
company('oil', 9, 9, gain(c(2)), [gain(m(1))], [trade({ coal: 1, oil: 1 }, money(6), 2)]);
company('oil', 9, 11, gain(c(2)), [gain(m(1))], [trade({ metal: 1, oil: 1 }, money(7), 2)]);
company('oil', 9, 13, gain(m(1)), [trade(m(1), o(1), 2)], [trade(c(3), money(4), 3)],
  ['В PDF №008 соответствующие стр. 11–12 идут в порядке улучшенная/обычная; в PPTX 13–14 порядок обычная/улучшенная.']);
company('oil', 9, 15, gain(m(1)), [trade(m(1), u(1))], [trade({ metal: 1, oil: 1 }, money(7), 2)]);
company('oil', 9, 17, trade(o(1), m(3)), [trade(c(2), o(1), 2)], [trade({ coal: 1, metal: 1 }, money(4), 3)]);

company('metal', 24, 1, trade(m(1), o(1)), [trade(m(1), u(1), null)], [trade(m(2), money(2), 4)],
  ['Первая производственная стрелка без напечатанной кратности. На второй строке именно ДВА металла на входе; не исправлять по аналогии с другими картами.']);
company('metal', 24, 3, gain(c(2)), [trade(u(1), money(5))], [gain(c(3))]);
company('metal', 24, 5, gain(c(2)), [trade(o(1), money(4))], [gain(c(3))]);
company('metal', 24, 7, gain(c(2)), [gain(m(1))], [trade(o(1), money(4))]);
company('metal', 24, 9, gain(c(2)), [gain(c(2))], [trade(u(1), money(5), 2)]);
company('metal', 24, 11, trade(m(1), u(1)), [trade(o(1), money(4))], [gain(c(3))]);
company('metal', 24, 13, gain(m(1)), [gain(m(1))], [trade(u(1), money(5), 2)]);
company('metal', 24, 15, gain(m(1)), [trade(u(1), money(5))], [gain(m(2))]);
company('metal', 24, 17, gain(m(1)), [gain(c(2))], [trade(o(1), money(4), 2)]);
company('metal', 24, 19, gain(c(2)), [gain(c(2))], [trade(o(1), money(4), 2)]);
company('metal', 24, 21, gain(c(2)), [gain(m(1))], [trade(o(1), money(4), 2)]);
company('metal', 24, 23, trade(m(1), o(1)), [trade(o(1), money(4))], [gain({ metal: 1, coal: 2 })]);

company('mine', 128, 2, gain(m(1)), [trade(c(2), money(2), 2)], [gain(o(1))]);
company('mine', 128, 4, trade(m(1), o(1)), [gain(c(2))], [gain(o(1))]);
company('mine', 128, 6, gain(m(1)), [gain(m(2))], [gain(m(1))]);
company('mine', 128, 8, gain(c(2)), [gain(c(2))], [gain(c(3))]);
company('mine', 128, 10, gain(c(2)), [gain(c(2))], [trade(m(1), money(2), 4)]);
company('mine', 128, 12, trade(c(2), o(1)), [trade(c(2), money(2), 2)], [gain(m(2))]);
company('mine', 128, 14, trade(m(1), u(1)), [gain(c(2))], [trade(m(2), money(2), 4)]);
company('mine', 128, 16, gain(m(1)), [gain(c(2))], [trade(m(2), money(2), 4)]);
company('mine', 128, 18, gain(c(2)), [trade(m(1), money(2), 2)], [gain(c(3))]);
company('mine', 128, 20, trade(c(2), o(1)), [trade(c(2), money(2), 2)], [gain(o(1))]);

const starts = [
  [{ coal: 1, metal: 1 }, trade(c(2), money(2), 2)],
  [{ coal: 1, metal: 1 }, trade(o(1), money(4))],
  [c(2), trade(c(3), money(4))],
  [c(2), trade(m(1), money(2), 2)],
  [u(1), trade({ coal: 1, metal: 1 }, money(4))],
];
starts.forEach(([starting, sale], index) => entries.push({ id: `user-start-${index + 1}`, group: 'startup', kind: 'startup',
  title: `Стартовое предприятие ${index + 1}`, source: { archiveEntry: 117, slides: [index + 1] }, starting,
  basic: [gain(u(1)), sale, { kind: 'upgrade', cost: { coal: 1, upgrade: 1 }, limit: 'unlimited' }],
  notes: ['starting описывает только верхнюю строку макета; общие стартовые ресурсы из правил сюда не добавлены.'] }));
const capitalists = [
  ['Эварист', 'Один раз в каждой фазе производства можно потратить 2 угля и повторно использовать свою карту.', 'repeat-card',
    ['В PDF №115, стр. 1, этот персонаж назван «Поль». Имя «Эварист» взято из PPTX №116.']],
  ['Генри', 'Для получения компенсации значение своего диска считается на 1 больше.', 'compensation-plus-one', []],
  ['Моника', 'Можно ставить диски без ограничений по значению и владельцу; значения не суммируются. При равенстве значений получить компенсацию.', 'unrestricted-bids', []],
  ['Артур', 'У вас есть дополнительный диск 2 (он считается диском вашего цвета).', 'paired-extra-disc',
    ['В макете уже указана одновременная постановка. Не заменять её вариантом старой редакции.',
     'Владелец коробки уточнил 28.09.2026: постановка дополнительной двойки НЕ обязательна. '
     + 'Слово «нужно» на макете описывает, как её ставить (вместе с другой своей ставкой на другую карту), а не обязанность её выставить.']],
  ['Тимур', 'При модернизации можно тратить металл вместо жетона модернизации, но сначала нужно потратить все свои жетоны модернизации.', 'metal-for-upgrade', []],
];
capitalists.forEach(([title, description, ability, notes], index) => entries.push({ id: `user-capitalist-${index + 1}`,
  group: 'capitalist', kind: 'capitalist', title, description, ability,
  source: { archiveEntry: 116, slides: [index + 1] }, notes }));

export const userBaseCatalog = {
  version: 'user-base-transcription-0.1', provenance: 'user-supplied-layouts', playable: false,
  officialVerified: false, expectedCompanies: 36, observedCompanyPairs: 31,
  status: 'source-transcribed-awaiting-reconciliation',
  legend: { coal: 'уголь', metal: 'металл', oil: 'нефть', upgrade: 'жетон модернизации', money: 'деньги' },
  entries: entries.map(entry => ({ ...entry, officialId: null, status: 'source-transcribed',
    images: entry.source.slides.map(slide => `/apps/web/assets/user-base/${String(entry.source.archiveEntry).padStart(3, '0')}-${String(slide).padStart(2, '0')}.jpg`) })),
};
