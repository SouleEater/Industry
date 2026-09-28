import { userBaseCatalog } from '/packages/content/user-base-catalog.mjs';
const labels = userBaseCatalog.legend;
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const bundle = values => Object.entries(values).map(([key, count]) => `${labels[key]} × ${count}`).join(' + ');
function effectText(effect) {
  if (effect.kind === 'gain') return `Получить ${bundle(effect.gain)}`;
  if (effect.kind === 'upgrade') return `${bundle(effect.cost)} → улучшить предприятие; без ограничения числа операций`;
  return `${bundle(effect.cost)} → ${bundle(effect.gain)}${effect.limit === null ? '; кратность не указана в макете' : `; лимит: ${effect.limit}`}`;
}
const list = effects => `<ol>${effects.map(e => `<li>${escape(effectText(e))}</li>`).join('')}</ol>`;
function card(entry) {
  return `<article class="catalog-card"><small>${escape(entry.id)}</small><h2>${escape(entry.title)}</h2>
    <div class="card-faces">${entry.images.map((src, index) => `<button class="face" data-id="${entry.id}" data-side="${index}" aria-label="Увеличить: ${escape(entry.title)}, ${index ? 'улучшенная' : 'обычная'} сторона"><img src="${src}" alt="${escape(entry.title)} — ${entry.kind === 'company' ? index ? 'улучшенная сторона' : 'обычная сторона' : 'лицевая сторона'}" loading="lazy" width="900" height="${entry.kind === 'capitalist' ? '623' : '1300'}"><span>${entry.kind === 'company' ? index ? 'Улучшенная' : 'Обычная' : 'Увеличить'}</span></button>`).join('')}</div>
    ${entry.compensation ? `<h3>Компенсация за единицу диска</h3><p>${escape(effectText({ ...entry.compensation, limit: 1 }))}</p>` : ''}
    ${entry.starting ? `<h3>Начальный запас на карте</h3><p>${escape(bundle(entry.starting))}</p>` : ''}
    ${entry.basic ? `<h3>Производство</h3>${list(entry.basic)}` : ''}
    ${entry.upgraded ? `<details><summary>Производство после улучшения</summary>${list(entry.upgraded)}</details>` : ''}
    ${entry.description ? `<p>${escape(entry.description)}</p>` : ''}
    ${entry.notes.map(note => `<p class="source-note">${escape(note)}</p>`).join('')}
    <p class="source-reference">Источник: файл №${entry.source.archiveEntry}, слайды ${entry.source.slides.join(', ')}. Расшифровано по макету, с официальным экземпляром не сверено.</p></article>`;
}
function render() {
  const group = document.querySelector('#group').value;
  const query = document.querySelector('#search').value.trim().toLocaleLowerCase('ru');
  const filtered = userBaseCatalog.entries.filter(e => (group === 'all' || e.group === group) && `${e.title} ${e.id}`.toLocaleLowerCase('ru').includes(query));
  document.querySelector('#count').textContent = `Найдено: ${filtered.length} из ${userBaseCatalog.entries.length}`;
  document.querySelector('#catalog').innerHTML = filtered.length ? filtered.map(card).join('') : '<p>Карт по этому запросу нет.</p>';
}
document.querySelector('#group').addEventListener('change', render);
document.querySelector('#search').addEventListener('input', render);
document.querySelector('#catalog').addEventListener('click', event => {
  const button = event.target.closest('button[data-id]');
  if (!button) return;
  const entry = userBaseCatalog.entries.find(e => e.id === button.dataset.id);
  const img = document.querySelector('#preview-image');
  img.src = entry.images[Number(button.dataset.side)]; img.alt = button.getAttribute('aria-label');
  document.querySelector('#preview-title').textContent = entry.title;
  document.querySelector('#card-preview').showModal();
});
document.querySelector('#close-preview').addEventListener('click', () => document.querySelector('#card-preview').close());
render();
