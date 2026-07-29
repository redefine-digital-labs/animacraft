import {
  DOCS_CONTENT,
  DOCS_LOCALES,
  DOCS_VERSION,
} from './docs-center-content.js';
import {
  DOCS_ARTICLE_FIGURES,
  DOCS_FIGURE_SPECS,
  DOCS_FIGURE_TERMS,
  DOCS_FIGURE_TYPES,
} from './docs-center-figures.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizedLocale(locale) {
  return DOCS_LOCALES.includes(locale) ? locale : 'en';
}

function normalizedText(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

function articleSearchText(article) {
  return normalizedText([
    article.title,
    article.summary,
    ...article.sections.flatMap((section) => [
      section.title,
      ...(section.paragraphs || []),
      ...(section.bullets || []),
      section.note || '',
    ]),
  ].join(' '));
}

function articleIndex(content) {
  return new Map(content.articles.map((article, index) => [
    article.id,
    { article, index },
  ]));
}

function categoryIndex(content) {
  return new Map(content.categories.map((category) => [category.id, category]));
}

function validateDocsFigures(articleIds) {
  const englishTermKeys = Object.keys(DOCS_FIGURE_TERMS.en || {}).sort();
  DOCS_LOCALES.forEach((locale) => {
    const terms = DOCS_FIGURE_TERMS[locale];
    if (!terms) throw new Error(`Docs figure terms are missing for ${locale}.`);
    if (JSON.stringify(Object.keys(terms).sort()) !== JSON.stringify(englishTermKeys)) {
      throw new Error(`Docs figure term keys differ for ${locale}.`);
    }
    englishTermKeys.forEach((key) => {
      if (!String(terms[key] || '').trim()) {
        throw new Error(`Docs figure term ${locale}.${key} is empty.`);
      }
    });
  });
  const allowedTypes = new Set(DOCS_FIGURE_TYPES);
  Object.entries(DOCS_FIGURE_SPECS).forEach(([figureId, spec]) => {
    if (!allowedTypes.has(spec.type)) {
      throw new Error(`Docs figure ${figureId} uses an unsupported type.`);
    }
    const assets = [
      ...Object.values(spec.assets || {}).filter((value) => typeof value === 'string'),
      ...Object.values(spec.assets || {})
        .filter(Array.isArray)
        .flat()
        .map((value) => (typeof value === 'string' ? value : value?.src)),
    ].filter(Boolean);
    assets.forEach((src) => {
      if (!String(src).startsWith('/makers/')) {
        throw new Error(`Docs figure ${figureId} must use a trusted local Maker asset.`);
      }
    });
  });
  Object.entries(DOCS_ARTICLE_FIGURES).forEach(([articleId, figureId]) => {
    if (!articleIds.includes(articleId)) {
      throw new Error(`Docs figure mapping references unknown article ${articleId}.`);
    }
    if (!DOCS_FIGURE_SPECS[figureId]) {
      throw new Error(`Docs article ${articleId} references unknown figure ${figureId}.`);
    }
  });
}

function validateLocaleContent(locale, content, canonical) {
  if (!content || typeof content !== 'object') {
    throw new Error(`Docs locale ${locale} is missing.`);
  }
  const requiredUiKeys = [
    'searchPlaceholder',
    'noResults',
    'updatedLabel',
    'readLabel',
    'previous',
    'next',
    'allTopics',
  ];
  requiredUiKeys.forEach((key) => {
    if (!String(content.ui?.[key] || '').trim()) {
      throw new Error(`Docs locale ${locale} is missing ui.${key}.`);
    }
  });
  const categories = Array.isArray(content.categories) ? content.categories : [];
  const articles = Array.isArray(content.articles) ? content.articles : [];
  if (!categories.length || !articles.length) {
    throw new Error(`Docs locale ${locale} must contain categories and articles.`);
  }
  const categoryIds = categories.map((category) => String(category.id || ''));
  const articleIds = articles.map((article) => String(article.id || ''));
  const stableIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  if (new Set(categoryIds).size !== categoryIds.length) {
    throw new Error(`Docs locale ${locale} contains duplicate category IDs.`);
  }
  if (new Set(articleIds).size !== articleIds.length) {
    throw new Error(`Docs locale ${locale} contains duplicate article IDs.`);
  }
  categories.forEach((category, index) => {
    if (!stableIdPattern.test(categoryIds[index])) {
      throw new Error(`Docs locale ${locale} category ${index} needs a stable kebab-case ID.`);
    }
    if (!String(category.title || '').trim() || !String(category.description || '').trim()) {
      throw new Error(`Docs category ${locale}.${category.id} needs a title and description.`);
    }
  });
  articleIds.forEach((articleId, index) => {
    if (!stableIdPattern.test(articleId)) {
      throw new Error(`Docs locale ${locale} article ${index} needs a stable kebab-case ID.`);
    }
  });
  if (canonical) {
    if (JSON.stringify(categoryIds) !== JSON.stringify(canonical.categoryIds)) {
      throw new Error(`Docs locale ${locale} category order differs from English.`);
    }
    if (JSON.stringify(articleIds) !== JSON.stringify(canonical.articleIds)) {
      throw new Error(`Docs locale ${locale} article order differs from English.`);
    }
  }
  const knownCategories = new Set(categoryIds);
  articles.forEach((article) => {
    if (!knownCategories.has(article.category)) {
      throw new Error(`Docs article ${locale}.${article.id} references an unknown category.`);
    }
    if (!String(article.title || '').trim() || !String(article.summary || '').trim()) {
      throw new Error(`Docs article ${locale}.${article.id} needs a title and summary.`);
    }
    if (!Array.isArray(article.sections) || !article.sections.length) {
      throw new Error(`Docs article ${locale}.${article.id} needs at least one section.`);
    }
    if (canonical && article.category !== canonical.articleCategories[article.id]) {
      throw new Error(`Docs article ${locale}.${article.id} category differs from English.`);
    }
    if (canonical && article.sections.length !== canonical.sectionCounts[article.id]) {
      throw new Error(`Docs article ${locale}.${article.id} section count differs from English.`);
    }
    article.sections.forEach((section, index) => {
      if (!String(section.title || '').trim()) {
        throw new Error(`Docs article ${locale}.${article.id} section ${index} needs a title.`);
      }
      const hasContent = (section.paragraphs || []).length
        || (section.bullets || []).length
        || String(section.note || '').trim();
      if (!hasContent) {
        throw new Error(`Docs article ${locale}.${article.id} section ${index} is empty.`);
      }
    });
  });
  return {
    categoryIds,
    articleIds,
    articleCategories: Object.fromEntries(articles.map((article) => [article.id, article.category])),
    sectionCounts: Object.fromEntries(articles.map((article) => [article.id, article.sections.length])),
  };
}

export function validateDocsContent() {
  const english = validateLocaleContent('en', DOCS_CONTENT.en, null);
  validateDocsFigures(english.articleIds);
  DOCS_LOCALES.filter((locale) => locale !== 'en').forEach((locale) => {
    validateLocaleContent(locale, DOCS_CONTENT[locale], english);
  });
  return {
    locales: [...DOCS_LOCALES],
    categories: english.categoryIds.length,
    articles: english.articleIds.length,
    version: DOCS_VERSION,
  };
}

function figureImage(src, className = '') {
  return `
    <img
      src="${escapeHtml(src)}"
      class="${escapeHtml(className)}"
      alt=""
      width="1024"
      height="1024"
      loading="lazy"
      decoding="async"
      draggable="false"
    />
  `;
}

function figureNode(label, className = '') {
  return `<span class="docs-figure-node ${escapeHtml(className)}">${escapeHtml(label)}</span>`;
}

function compositeMarkup(layers, className = '') {
  return `
    <div class="docs-figure-composite ${escapeHtml(className)}">
      ${layers.map((src) => figureImage(src, '')).join('')}
      <span class="docs-figure-crosshair"></span>
    </div>
  `;
}

function hierarchyFigure(terms) {
  return `
    <div class="docs-figure-hierarchy">
      <div class="docs-figure-person">
        <span aria-hidden="true">✦</span>
        <strong>${escapeHtml(terms.creator)}</strong>
      </div>
      <span class="docs-figure-arrow" aria-hidden="true">→</span>
      <div class="docs-hierarchy-stack">
        ${figureNode(terms.maker, 'level-maker')}
        ${figureNode(terms.part, 'level-part')}
        ${figureNode(terms.item, 'level-item')}
        ${figureNode(terms.style, 'level-style')}
        ${figureNode(terms.pngLayer, 'level-png')}
      </div>
      <span class="docs-figure-arrow" aria-hidden="true">→</span>
      <div class="docs-figure-person">
        <span aria-hidden="true">◎</span>
        <strong>${escapeHtml(terms.player)}</strong>
        <small>OC</small>
      </div>
    </div>
  `;
}

function playerFigure(spec, terms) {
  return `
    <div class="docs-figure-player">
      <div class="docs-player-preview">
        ${figureImage(spec.assets.cover, '')}
        <span>OC</span>
      </div>
      <div class="docs-player-controls">
        <div class="docs-player-parts">
          ${[terms.background, terms.skinBase, terms.eyes, terms.outfit, terms.frontHair].map((label, index) => `
            <span class="${index === 4 ? 'active' : ''}">${escapeHtml(label)}</span>
          `).join('')}
        </div>
        <div class="docs-player-items">
          ${spec.assets.choices.map((choice, index) => `
            <span class="${index === 0 ? 'active' : ''}">
              ${figureImage(choice.src, '')}
              <strong>${escapeHtml(choice.name)}</strong>
              <small>${escapeHtml(terms.item)} · ${escapeHtml(terms.defaultStyle)}</small>
            </span>
          `).join('')}
        </div>
        <div class="docs-player-palette" aria-hidden="true">
          ${['#25386f', '#75c8ef', '#7b52ff', '#f4b45e'].map((color) => (
            `<span style="--docs-swatch:${color}"></span>`
          )).join('')}
        </div>
      </div>
    </div>
  `;
}

function alignmentFigure(spec, terms) {
  const layers = spec.assets.layers;
  return `
    <div class="docs-figure-alignment">
      <div class="docs-alignment-master">
        <span class="docs-figure-eyebrow">${escapeHtml(terms.masterCanvas)} · 1024 × 1024</span>
        ${compositeMarkup(layers, 'with-grid')}
      </div>
      <span class="docs-figure-arrow" aria-hidden="true">→</span>
      <div class="docs-alignment-layers">
        <span class="docs-figure-eyebrow">${escapeHtml(terms.sameCanvas)}</span>
        <div>
          ${layers.map((src) => `<span>${figureImage(src, '')}<small>1024²</small></span>`).join('')}
        </div>
      </div>
      <span class="docs-figure-arrow" aria-hidden="true">→</span>
      <div class="docs-alignment-output">
        <span class="docs-figure-eyebrow">${escapeHtml(terms.alignedComposite)}</span>
        ${compositeMarkup(layers, '')}
        <div><span>X 0</span><span>Y 0</span><span>1×</span></div>
      </div>
    </div>
  `;
}

function importFigure(terms) {
  return `
    <div class="docs-figure-decision">
      <div class="docs-decision-start">${figureNode(terms.pngLayer, 'level-png')}<strong>${escapeHtml(terms.review)}</strong></div>
      <span class="docs-figure-arrow" aria-hidden="true">→</span>
      <div class="docs-decision-branches">
        <div>
          <strong>${escapeHtml(terms.exactCanvas)}</strong>
          <span>1024² → X 0 · Y 0 · 1×</span>
          <small class="success">${escapeHtml(terms.ready)}</small>
        </div>
        <div>
          <strong>${escapeHtml(terms.loosePng)}</strong>
          <span>${escapeHtml(terms.fitAndCenter)}</span>
          <small>${escapeHtml(terms.review)}</small>
        </div>
      </div>
      <span class="docs-figure-arrow" aria-hidden="true">→</span>
      <div class="docs-decision-lock">
        <strong>positionLocked</strong>
        <span>true → ${escapeHtml(terms.keepTransform)}</span>
        <span>false → ${escapeHtml(terms.resetTransform)}</span>
      </div>
    </div>
  `;
}

function tracksFigure(spec, terms) {
  return `
    <div class="docs-figure-tracks">
      <div class="docs-track-menu">
        <span class="docs-figure-eyebrow">${escapeHtml(terms.part)} · ${escapeHtml(terms.playerMenu)}</span>
        <div>${[terms.frontHair, terms.background, terms.skinBase, terms.outfit, terms.eyes].map((label, index) => (
          `<span><b>${index + 1}</b>${escapeHtml(label)}</span>`
        )).join('')}</div>
      </div>
      <div class="docs-track-order">
        <div class="docs-track-axis"><span>${escapeHtml(terms.back)}</span><strong>${escapeHtml(terms.renderOrder)}</strong><span>${escapeHtml(terms.front)}</span></div>
        ${spec.assets.layers.map((layer, index) => `
          <div style="--track-index:${index}">
            ${figureImage(layer.src, '')}
            <strong>${escapeHtml(terms[layer.term])}</strong>
            <span>${index + 1}</span>
          </div>
        `).join('')}
      </div>
      <div class="docs-track-preview">${figureImage(spec.assets.cover, '')}<span>${escapeHtml(terms.zOrder)}</span></div>
    </div>
  `;
}

function colorFigure(spec, terms) {
  return `
    <div class="docs-figure-color">
      <div class="docs-color-linked">
        ${spec.assets.layers.map((src, index) => `
          <div>${figureImage(src, '')}<span>${escapeHtml(terms.style)} ${index + 1}</span></div>
        `).join('')}
        <strong>${escapeHtml(terms.linkedStyles)}</strong>
      </div>
      <div class="docs-color-link-lines" aria-hidden="true"><span></span><span></span></div>
      <div class="docs-color-channel">
        <span aria-hidden="true">◉</span>
        <strong>${escapeHtml(terms.colorChannel)}</strong>
        <div>${['#182755', '#5bc1e9', '#7957ff', '#ef8fbe'].map((color) => (
          `<span style="--docs-swatch:${color}"></span>`
        )).join('')}</div>
        <small>${escapeHtml(terms.oneChannelPerStyle)}</small>
      </div>
    </div>
  `;
}

function rulesFigure(terms) {
  return `
    <div class="docs-figure-rules">
      <div class="docs-rule-owner"><small>${escapeHtml(terms.whenSelected)}</small><strong>${escapeHtml(terms.outfit)} / ${escapeHtml(terms.item)} A</strong></div>
      <div class="docs-rule-columns">
        <div class="docs-rule-branch requires">
          <strong>${escapeHtml(terms.requiresAll)}</strong>
          <span>${escapeHtml(terms.frontHair)} / ${escapeHtml(terms.style)} 2</span>
          <span>${escapeHtml(terms.eyes)} / ${escapeHtml(terms.style)} 1</span>
          <b aria-hidden="true">✓</b>
        </div>
        <div class="docs-rule-branch excludes">
          <strong>${escapeHtml(terms.excludes)}</strong>
          <span>${escapeHtml(terms.accessory)} / ${escapeHtml(terms.item)} A</span>
          <span>${escapeHtml(terms.accessory)} / ${escapeHtml(terms.item)} B</span>
          <b aria-hidden="true">×</b>
        </div>
      </div>
      <div class="docs-rule-result">
        <span>${escapeHtml(terms.renderer)}</span>
        <span>${escapeHtml(terms.random)}</span>
        <span>${escapeHtml(terms.preflight)}</span>
        <strong>${escapeHtml(terms.sameRuleGraph)}</strong>
      </div>
    </div>
  `;
}

function publishFigure(terms) {
  const steps = [
    ['1', terms.prepare, 'Quilt'],
    ['2', terms.upload, 'Walrus'],
    ['3', terms.certify, 'Walrus'],
    ['4', terms.publish, 'Sui'],
  ];
  return `
    <div class="docs-figure-publish">
      ${steps.map(([number, label, target], index) => `
        <div class="${index === 3 ? 'final' : ''}">
          <span>${number}</span>
          <strong>${escapeHtml(label)}</strong>
          <small>${escapeHtml(target)}</small>
          ${index < steps.length - 1 ? '<i aria-hidden="true">→</i>' : ''}
        </div>
      `).join('')}
      <div class="docs-publish-retry"><span>↺</span><strong>${escapeHtml(terms.retry)}</strong><small>${escapeHtml(terms.checkpoint)} · 2 ↔ 3</small></div>
    </div>
  `;
}

function chainFigure(spec, terms) {
  return `
    <div class="docs-figure-chain">
      <div class="docs-chain-oc">
        ${figureImage(spec.assets.cover, '')}
        <span>PNG</span>
        <strong>animacraft-oc.json</strong>
      </div>
      <div class="docs-chain-documents">
        <span>soul.md<small>${escapeHtml(terms.identity)}</small></span>
        <span>memory.md<small>${escapeHtml(terms.memory)}</small></span>
        <span>SKILL.md<small>${escapeHtml(terms.skills)}</small></span>
      </div>
      <div class="docs-chain-boundary">
        <span><b>01</b><strong>${escapeHtml(terms.local)}</strong><small>${escapeHtml(terms.editable)}</small></span>
        <i aria-hidden="true">→</i>
        <span><b>02</b><strong>Walrus</strong><small>${escapeHtml(terms.immutable)}</small></span>
        <i aria-hidden="true">→</i>
        <span><b>03</b><strong>Sui</strong><small>OCMaker</small></span>
        <i aria-hidden="true">→</i>
        <span class="gated"><b>04</b><strong>Soulidity</strong><small>🔒 ${escapeHtml(terms.gated)}</small></span>
      </div>
    </div>
  `;
}

function articleFigureMarkup(article, locale) {
  const figureId = DOCS_ARTICLE_FIGURES[article.id];
  const spec = DOCS_FIGURE_SPECS[figureId];
  if (!figureId || !spec) return '';
  const terms = DOCS_FIGURE_TERMS[normalizedLocale(locale)];
  const stage = {
    hierarchy: () => hierarchyFigure(terms),
    player: () => playerFigure(spec, terms),
    alignment: () => alignmentFigure(spec, terms),
    import: () => importFigure(terms),
    tracks: () => tracksFigure(spec, terms),
    color: () => colorFigure(spec, terms),
    rules: () => rulesFigure(terms),
    publish: () => publishFigure(terms),
    chain: () => chainFigure(spec, terms),
  }[spec.type]?.();
  if (!stage) return '';
  const captionId = `docsFigure-${figureId}-caption`;
  const usesFixtureArt = ['player', 'alignment', 'tracks', 'color', 'chain'].includes(spec.type);
  return `
    <figure class="docs-article-figure docs-article-figure--${escapeHtml(spec.type)}" aria-labelledby="${escapeHtml(captionId)}">
      <div
        class="docs-figure-stage"
        role="img"
        aria-label="${escapeHtml(`${article.title}. ${article.summary}`)}"
      >
        ${usesFixtureArt ? `<span class="docs-figure-fixture-note">${escapeHtml(terms.technicalExample)}</span>` : ''}
        ${stage}
      </div>
      <figcaption id="${escapeHtml(captionId)}">
        <strong>${escapeHtml(article.title)}</strong>
        <span>${escapeHtml(article.summary)}</span>
      </figcaption>
    </figure>
  `;
}

function sectionMarkup(section) {
  return `
    <section class="docs-article-section">
      <h3>${escapeHtml(section.title)}</h3>
      ${(section.paragraphs || []).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}
      ${(section.bullets || []).length
        ? `<ul>${section.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join('')}</ul>`
        : ''}
      ${section.note
        ? `<aside class="docs-note"><span aria-hidden="true">!</span><p>${escapeHtml(section.note)}</p></aside>`
        : ''}
    </section>
  `;
}

function categoryMarkup(category, articles, activeId, query) {
  const visible = articles.filter((article) => {
    if (article.category !== category.id) return false;
    return !query || articleSearchText(article).includes(query);
  });
  if (!visible.length) return '';
  return `
    <section class="docs-directory-group" data-doc-category="${escapeHtml(category.id)}">
      <div>
        <strong class="docs-directory-category-title">${escapeHtml(category.title)}</strong>
        <p>${escapeHtml(category.description || '')}</p>
      </div>
      <div class="docs-directory-links">
        ${visible.map((article) => `
          <button
            type="button"
            class="docs-topic-button${article.id === activeId ? ' active' : ''}"
            data-doc-article="${escapeHtml(article.id)}"
            ${article.id === activeId ? 'aria-current="page"' : ''}
          >
            <strong>${escapeHtml(article.title)}</strong>
            <span>${escapeHtml(article.summary)}</span>
          </button>
        `).join('')}
      </div>
    </section>
  `;
}

export function createDocsCenter(root) {
  if (!root) throw new Error('The Docs center root is missing.');
  validateDocsContent();

  let locale = 'en';
  let renderedLocale = null;
  let activeId = DOCS_CONTENT.en.articles[0].id;
  let rawQuery = '';
  let normalizedQuery = '';
  let searchSelection = null;
  let composingSearch = false;

  function scrollArticleIntoView() {
    const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    root.querySelector('#docsArticleReader')
      ?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
  }

  function render({ focusArticle = false, focusSearch = false } = {}) {
    const content = DOCS_CONTENT[normalizedLocale(locale)];
    const articles = content.articles;
    const articlesById = articleIndex(content);
    const categoriesById = categoryIndex(content);
    if (!articlesById.has(activeId)) activeId = articles[0].id;
    const { article, index } = articlesById.get(activeId);
    const category = categoriesById.get(article.category);
    const previous = articles[index - 1] || null;
    const next = articles[index + 1] || null;
    const directory = content.categories
      .map((entry) => categoryMarkup(entry, articles, activeId, normalizedQuery))
      .join('');
    const resultCount = content.articles.filter((entry) => (
      !normalizedQuery || articleSearchText(entry).includes(normalizedQuery)
    )).length;

    root.innerHTML = `
      <nav class="docs-category-strip" aria-label="${escapeHtml(content.ui.allTopics)}">
        ${content.categories.map((entry) => `
          <button
            type="button"
            data-doc-category-jump="${escapeHtml(entry.id)}"
            class="${entry.id === article.category ? 'active' : ''}"
            aria-pressed="${entry.id === article.category ? 'true' : 'false'}"
          >
            <strong>${escapeHtml(entry.title)}</strong>
            <span>${escapeHtml(entry.description || '')}</span>
          </button>
        `).join('')}
      </nav>
      <div class="docs-center-shell">
        <aside class="docs-directory">
          <label class="docs-search">
            <span>${escapeHtml(content.ui.searchPlaceholder)}</span>
            <input
              id="docsSearchInput"
              type="search"
              value="${escapeHtml(rawQuery)}"
              placeholder="${escapeHtml(content.ui.searchPlaceholder)}"
              autocomplete="off"
            />
          </label>
          <p class="docs-result-count" aria-live="polite">
            ${normalizedQuery ? `${resultCount} · ${escapeHtml(content.ui.allTopics)}` : escapeHtml(content.ui.allTopics)}
          </p>
          <nav class="docs-directory-nav" aria-label="${escapeHtml(content.ui.allTopics)}">
            ${directory || `<p class="docs-empty">${escapeHtml(content.ui.noResults)}</p>`}
          </nav>
        </aside>
        <article
          id="docsArticleReader"
          class="docs-article-reader"
          tabindex="-1"
          aria-labelledby="docsArticleTitle"
        >
          <header class="docs-article-head">
            <div>
              <p class="kicker">${escapeHtml(category?.title || '')}</p>
              <h2 id="docsArticleTitle">${escapeHtml(article.title)}</h2>
              <p>${escapeHtml(article.summary)}</p>
            </div>
            <span class="docs-version-badge">${escapeHtml(content.ui.updatedLabel)} · v${escapeHtml(DOCS_VERSION)}</span>
          </header>
          ${articleFigureMarkup(article, locale)}
          <div class="docs-article-body">
            ${article.sections.map(sectionMarkup).join('')}
          </div>
          <nav class="docs-article-pagination" aria-label="${escapeHtml(content.ui.readLabel)}">
            ${previous
              ? `<button type="button" data-doc-article="${escapeHtml(previous.id)}"><span>← ${escapeHtml(content.ui.previous)}</span><strong>${escapeHtml(previous.title)}</strong></button>`
              : '<span></span>'}
            ${next
              ? `<button type="button" data-doc-article="${escapeHtml(next.id)}"><span>${escapeHtml(content.ui.next)} →</span><strong>${escapeHtml(next.title)}</strong></button>`
              : '<span></span>'}
          </nav>
        </article>
      </div>
    `;
    renderedLocale = locale;

    if (focusArticle) root.querySelector('#docsArticleReader')?.focus({ preventScroll: true });
    if (focusSearch) {
      const input = root.querySelector('#docsSearchInput');
      input?.focus({ preventScroll: true });
      if (input && searchSelection) input.setSelectionRange(searchSelection.start, searchSelection.end);
    }
  }

  root.addEventListener('click', (event) => {
    const articleButton = event.target.closest('[data-doc-article]');
    if (articleButton) {
      activeId = articleButton.dataset.docArticle;
      rawQuery = '';
      normalizedQuery = '';
      render({ focusArticle: true });
      scrollArticleIntoView();
      return;
    }
    const categoryButton = event.target.closest('[data-doc-category-jump]');
    if (!categoryButton) return;
    const content = DOCS_CONTENT[normalizedLocale(locale)];
    const target = content.articles.find((article) => (
      article.category === categoryButton.dataset.docCategoryJump
    ));
    if (!target) return;
    activeId = target.id;
    rawQuery = '';
    normalizedQuery = '';
    render({ focusArticle: true });
    scrollArticleIntoView();
  });

  root.addEventListener('input', (event) => {
    if (event.target.id !== 'docsSearchInput') return;
    if (composingSearch || event.isComposing) return;
    if (event.target.value === rawQuery) return;
    rawQuery = event.target.value;
    normalizedQuery = normalizedText(rawQuery);
    searchSelection = {
      start: event.target.selectionStart ?? rawQuery.length,
      end: event.target.selectionEnd ?? rawQuery.length,
    };
    render({ focusSearch: true });
  });

  root.addEventListener('compositionstart', (event) => {
    if (event.target.id === 'docsSearchInput') composingSearch = true;
  });

  root.addEventListener('compositionend', (event) => {
    if (event.target.id !== 'docsSearchInput') return;
    composingSearch = false;
    rawQuery = event.target.value;
    normalizedQuery = normalizedText(rawQuery);
    searchSelection = {
      start: event.target.selectionStart ?? rawQuery.length,
      end: event.target.selectionEnd ?? rawQuery.length,
    };
    render({ focusSearch: true });
  });

  root.addEventListener('keydown', (event) => {
    const current = event.target.closest('.docs-topic-button');
    if (!current || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...root.querySelectorAll('.docs-topic-button')];
    const currentIndex = buttons.indexOf(current);
    if (currentIndex < 0 || !buttons.length) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : event.key === 'ArrowDown'
          ? Math.min(buttons.length - 1, currentIndex + 1)
          : Math.max(0, currentIndex - 1);
    buttons[nextIndex]?.focus();
  });

  return {
    render(nextLocale = locale) {
      const normalized = normalizedLocale(nextLocale);
      if (renderedLocale === normalized && root.childElementCount) return;
      locale = normalized;
      render();
    },
    select(articleId, { focus = false } = {}) {
      const content = DOCS_CONTENT[normalizedLocale(locale)];
      if (!content.articles.some((article) => article.id === articleId)) return false;
      activeId = articleId;
      rawQuery = '';
      normalizedQuery = '';
      render({ focusArticle: focus });
      return true;
    },
    getActiveArticleId() {
      return activeId;
    },
  };
}
