import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { userBaseCatalog as catalog } from '../packages/content/user-base-catalog.mjs';

test('unreconciled layouts retain source identity and cannot masquerade as a playable pack', () => {
  assert.equal(catalog.playable, false);
  assert.equal(catalog.officialVerified, false);
  assert.equal(catalog.deck, undefined);
  assert.equal(new Set(catalog.entries.map(e => e.id)).size, catalog.entries.length);
  for (const e of catalog.entries) {
    assert.equal(e.officialId, null);
    assert.ok(e.source.archiveEntry >= 0);
    assert.equal(e.images.length, e.source.slides.length);
    if (e.kind === 'company') assert.equal(e.images.length, 2);
    for (const effect of [...(e.basic || []), ...(e.upgraded || []), ...(e.compensation ? [e.compensation] : [])]) {
      for (const values of [effect.cost, effect.gain].filter(Boolean)) {
        for (const [resource, amount] of Object.entries(values)) {
          assert.ok(resource in catalog.legend);
          assert.ok(Number.isSafeInteger(amount) && amount > 0);
        }
      }
    }
  }
});

test('every displayed face is present and matches its provenance checksum', async () => {
  const root = new URL('../', import.meta.url);
  const assets = JSON.parse(await readFile(new URL('research/base-web-assets.json', root), 'utf8'));
  const source = JSON.parse(await readFile(new URL('research/base-import-manifest.json', root), 'utf8'));
  for (const entry of catalog.entries) {
    assert.ok(source.records.some(r => r.entry === entry.source.archiveEntry && r.path.endsWith('.pptx')));
    for (let i = 0; i < entry.images.length; i++) {
      const path = entry.images[i].slice(1);
      const record = assets.find(a => a.path === path);
      assert.ok(record, path);
      assert.equal(record.archiveEntry, entry.source.archiveEntry);
      assert.equal(record.slide, entry.source.slides[i]);
      const bytes = await readFile(new URL(path, root));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256, path);
    }
  }
});

test('source conflicts and unknown limits survive transcription without fabricated defaults', () => {
  const byId = id => catalog.entries.find(e => e.id === id);
  assert.equal(byId('user-oil-04').basic[0].limit, null);
  assert.equal(byId('user-metal-01').basic[0].limit, null);
  assert.equal(byId('user-oil-02').basic[0].cost.coal, 2);
  assert.equal(byId('user-oil-03').basic[0].cost.coal, 1);
  assert.ok(byId('user-oil-02').notes.some(n => n.includes('PDF')));
  assert.ok(byId('user-capitalist-1').notes.some(n => n.includes('Поль')));
});
