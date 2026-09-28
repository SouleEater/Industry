// Synthetic fixtures for verified rule mechanics. NOT the original game's card catalogue.
const gain = (values) => ({ kind: 'gain', gain: values });
const exchange = (cost, values, limit) => ({ kind: 'convert', cost, gain: values, limit });
export const trainingPack = {
  version: 'training-0.1', provenance: 'synthetic', startupId: 'office',
  definitions: {
    office: { name: 'Контора', kind: 'startup', starting: { coal: 3, metal: 1 },
      effects: [gain({ upgrade: 1 }), exchange({ coal: 1 }, { money: 2 }, 2), { kind: 'upgrade' }], advanced: [] },
    mine: { name: 'Угольная шахта', kind: 'company', tone: 'coal', compensation: gain({ coal: 2 }),
      effects: [gain({ coal: 3 })], advanced: [exchange({ coal: 2 }, { money: 3 }, 2)] },
    foundry: { name: 'Литейный цех', kind: 'company', tone: 'metal', compensation: gain({ metal: 1 }),
      effects: [exchange({ coal: 1 }, { metal: 1 }, 3)], advanced: [gain({ metal: 1 })] },
    refinery: { name: 'Нефтеперегонный завод', kind: 'company', tone: 'oil', compensation: exchange({ metal: 1 }, { oil: 1 }),
      effects: [exchange({ metal: 1 }, { oil: 1 }, 2)], advanced: [exchange({ oil: 1 }, { money: 5 }, 2)] },
    works: { name: 'Машиностроительный завод', kind: 'company', tone: 'metal', compensation: gain({ coal: 1 }),
      effects: [gain({ metal: 1 })], advanced: [exchange({ metal: 1 }, { money: 4 }, 2)] },
    depot: { name: 'Торговый склад', kind: 'company', tone: 'coal', compensation: gain({ coal: 1, metal: 1 }),
      effects: [exchange({ coal: 2 }, { money: 3 }, 3)], advanced: [gain({ coal: 2 })] },
    oilfield: { name: 'Нефтяной промысел', kind: 'company', tone: 'oil', compensation: gain({ oil: 1 }),
      effects: [gain({ oil: 1 })], advanced: [exchange({ oil: 1 }, { money: 4 }, 3)] },
  },
  deck: Array.from({ length: 6 }, () => ['mine', 'foundry', 'refinery', 'works', 'depot', 'oilfield']).flat(),
};
