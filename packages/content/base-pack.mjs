// Игровой пакет, выведенный из расшифровки пользовательских макетов.
// Каталог остаётся источником истины: здесь нет ни одного числа, введённого вручную.
// Пакет НЕ является сверенной оригинальной колодой — см. docs/06-base-archive.md.
import { userBaseCatalog } from './user-base-catalog.mjs';
import { universityCards, auctionManagers, deferredManagers } from './interbellum.mjs';
import { interbellumCompanies } from './interbellum-companies.mjs';

const GROUP_LABEL = { oil: 'Нефть', metal: 'Металл', mine: 'Шахта' };

// limit: null в каталоге означает «кратность на макете не напечатана», а не бесконечность.
// Движку нужно число, поэтому такая строка идёт ×1 и помечается для сверки.
function playable(effect) {
  if (effect.kind === 'upgrade') return { kind: 'upgrade' };
  if (effect.kind === 'convert' && effect.limit === null) return { ...effect, limit: 1, limitUnknown: true };
  return effect;
}
const hasUnknownLimit = effects => effects.some(e => e.kind === 'convert' && e.limit === null);

const definitions = {}, deck = [], startupIds = [];

for (const entry of userBaseCatalog.entries) {
  if (entry.kind === 'company') {
    // В каталоге upgraded = basic + добавленные строки, поэтому advanced — это хвост.
    const added = entry.upgraded.slice(entry.basic.length);
    definitions[entry.id] = {
      name: `${GROUP_LABEL[entry.group]} ${entry.title.split(' ').pop()}`,
      kind: 'company', tone: entry.group === 'mine' ? 'coal' : entry.group,
      compensation: entry.compensation,
      effects: entry.basic.map(playable),
      advanced: added.map(playable),
      images: entry.images,
      notes: entry.notes,
      unknownLimit: hasUnknownLimit([entry.compensation, ...entry.basic, ...added]),
      officialVerified: false,
    };
    deck.push(entry.id);
  } else if (entry.kind === 'startup') {
    definitions[entry.id] = {
      name: entry.title, kind: 'startup', starting: entry.starting,
      effects: entry.basic.map(playable), advanced: [],
      images: entry.images, notes: entry.notes, officialVerified: false,
    };
    startupIds.push(entry.id);
  }
}

const capitalistCards = userBaseCatalog.entries
  .filter(e => e.kind === 'capitalist')
  .map(e => ({ id: e.id, name: e.title, text: e.description, ability: e.ability, images: e.images, notes: e.notes }));

// Предприятия дополнения в общем словаре определений: в базовую колоду они не входят,
// но нужны, когда партия идёт с «Интербеллумом».
for (const entry of interbellumCompanies) {
  definitions[entry.id] = {
    name: `Интербеллум ${entry.id.slice(3)}`,
    kind: 'company', tone: 'coal',
    compensation: entry.compensation,
    effects: entry.basic, advanced: entry.advanced,
    images: [], notes: entry.notes, officialVerified: false, expansion: true,
  };
}

export const basePack = {
  version: `base-playable-from-${userBaseCatalog.version}`,
  provenance: 'user-supplied-layouts',
  officialVerified: false,
  startupId: startupIds[0],   // совместимость: один стартовый на всех
  startupIds,                 // разные стартовые предприятия, как в правилах
  capitalists: capitalistCards,
  // Модуль «Интербеллума»: университеты и жетоны управляющих.
  universities: universityCards,
  managers: auctionManagers,
  deferredManagers,
  definitions,
  deck,
  // Колода дополнения: 24 новые карты плюс 24 случайные базовые.
  // Правила дополнения, подготовка, пункт0: полный вариант делит базовые карты
  // на 12 стопок по иллюстрациям и берёт по две из каждой. Иллюстрации в каталоге
  // не размечены, поэтому применяется разрешённое правилами упрощение — 24 случайные
  // базовые карты, с оговоркой, что колода будет менее сбалансированной.
  expansionDeck: interbellumCompanies.map(c => c.id),
  expansionBaseCount: 24,
  // Инвентарь: чего не хватает до полной базовой коробки.
  expectedCompanies: userBaseCatalog.expectedCompanies,
  observedCompanies: deck.length,
  missingCompanies: userBaseCatalog.expectedCompanies - deck.length,
  unknownLimitCards: deck.filter(id => definitions[id].unknownLimit).length,
};
