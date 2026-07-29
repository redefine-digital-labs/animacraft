import {
  DOCS_CONTENT,
  DOCS_LOCALES,
  DOCS_VERSION,
} from './docs-center-content.js';

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
