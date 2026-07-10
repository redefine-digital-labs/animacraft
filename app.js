import {
  explorerTransactionUrl,
  initializeChain,
  mintCharacter,
  openWalletSelector,
  publishMaker,
  uploadWalrusBlob,
} from './chain-runtime.js';

const slots = [
  { key: 'background', label: 'Background', icon: 'BG', colorKey: 'background', description: 'Scene, mood, and backdrop' },
  { key: 'hairBack', label: 'Back Hair', icon: 'HB', colorKey: 'hair', description: 'Rear silhouette and outer hair shape' },
  { key: 'hairFront', label: 'Front Hair', icon: 'HF', colorKey: 'hair', description: 'Bangs, fringe, and face framing' },
  { key: 'eyes', label: 'Eyes', icon: 'EY', colorKey: 'eyes', description: 'Expression focus and personality' },
  { key: 'mouth', label: 'Mouth', icon: 'MO', colorKey: 'skin', description: 'Subtle emotion detail' },
  { key: 'outfit', label: 'Outfit', icon: 'OF', colorKey: 'outfit', description: 'Base body and clothing style' },
  { key: 'accessory', label: 'Accessory', icon: 'AC', colorKey: 'accessory', description: 'Headwear, glasses, props, and signature details' },
];

const parts = {
  background: [
    { id: 'dawn', label: 'Dawn Paper' },
    { id: 'mint', label: 'Mint Gradient' },
    { id: 'violet', label: 'Violet Night' },
    { id: 'grid', label: 'Pixel Grid' },
  ],
  hairBack: [
    { id: 'wave', label: 'Soft Long' },
    { id: 'short', label: 'Short Shape' },
    { id: 'twin', label: 'Twin Tails' },
    { id: 'bob', label: 'Round Bob' },
  ],
  hairFront: [
    { id: 'side', label: 'Side Bangs' },
    { id: 'center', label: 'Center Bangs' },
    { id: 'swept', label: 'Swept Fringe' },
    { id: 'curtain', label: 'Curtain Bangs' },
  ],
  eyes: [
    { id: 'bright', label: 'Bright Round' },
    { id: 'sleepy', label: 'Sleepy' },
    { id: 'sharp', label: 'Sharp Gaze' },
    { id: 'round', label: 'Soft Dot Eyes' },
  ],
  mouth: [
    { id: 'calm', label: 'Calm' },
    { id: 'smile', label: 'Smile' },
    { id: 'flat', label: 'Flat' },
    { id: 'soft', label: 'Soft' },
  ],
  outfit: [
    { id: 'jacket', label: 'Short Jacket' },
    { id: 'robe', label: 'Fantasy Robe' },
    { id: 'suit', label: 'Academy Suit' },
    { id: 'hoodie', label: 'Hoodie' },
  ],
  accessory: [
    { id: 'halo', label: 'Small Halo' },
    { id: 'ribbon', label: 'Ribbon' },
    { id: 'pin', label: 'Star Pin' },
    { id: 'glasses', label: 'Round Glasses' },
  ],
};

const templates = [
  {
    id: 'daily-starlit',
    name: 'Starlit Daily OC',
    category: 'daily',
    creator: 'Animacraft Lab',
    style: 'Daily icon',
    license: 'Personal use',
    royaltyBps: 300,
    price: 'Free base + paid parts',
    uses: '1.8k',
    works: 426,
    parts: 28,
    accent: '#7b5cff',
    secondary: '#2db7a3',
    summary: 'A daily OC maker for profile icons, character sheets, and lightweight original characters.',
    licenseNote: 'Generate personal icons and OC profiles. Commercial use requires an add-on license.',
  },
  {
    id: 'fantasy-flower',
    name: 'Flower Familiar',
    category: 'fantasy',
    creator: 'Mori Atelier',
    style: 'Fantasy character',
    license: 'Paid commercial',
    royaltyBps: 500,
    price: 'Creator-set paid template',
    uses: '952',
    works: 218,
    parts: 36,
    accent: '#2db7a3',
    secondary: '#f0a23a',
    summary: 'A fantasy-friendly maker for spirits, familiars, story characters, and worldbuilding.',
    licenseNote: 'Paid templates, commercial licenses, and remix revenue can settle by part-level rules.',
  },
  {
    id: 'chibi-idol',
    name: 'Chibi Idol Maker',
    category: 'chibi',
    creator: 'Stage Mint',
    style: 'Chibi idol',
    license: 'Personal use',
    royaltyBps: 250,
    price: 'Free trial parts',
    uses: '2.4k',
    works: 703,
    parts: 42,
    accent: '#f06f8f',
    secondary: '#f0a23a',
    summary: 'A quick chibi maker for stage characters, fan OCs, and small profile images.',
    licenseNote: 'Personal use by default. Paid parts can unlock limited use or commercial add-ons.',
  },
];

const swatches = ['#7b5cff', '#2db7a3', '#f06f8f', '#f0a23a', '#335c81', '#7d5a50', '#24202b', '#f1c9b1'];

const defaultConfig = {
  network: 'testnet',
  rpcUrl: 'https://fullnode.testnet.sui.io:443',
  packageId: '0xTODO_ANIMACRAFT_PACKAGE',
  walrusPublisherUrl: 'https://publisher.walrus-testnet.walrus.space',
  walrusAggregatorUrl: 'https://aggregator.walrus-testnet.walrus.space',
  walrusUploadRelayUrl: 'https://upload-relay.testnet.walrus.space',
  walrusEpochs: 3,
  featuredMakers: {},
  appUrl: location.origin,
};

const runtimeConfig = {
  ...defaultConfig,
  ...(window.ANIMACRAFT_CONFIG || {}),
};

const chainActions = [
  {
    key: 'wallet',
    title: 'Wallet',
    body: 'Connect a Sui wallet. All creator and player writes are signed by the user.',
  },
  {
    key: 'walrus',
    title: 'Walrus assets',
    body: 'Stage PNG layers, icons, cover sheets, manifests, rendered OCs, and profile JSON as blobs.',
  },
  {
    key: 'maker',
    title: 'OCMaker object',
    body: 'Register creator profile, maker metadata, parts, item gates, and license policy on Sui.',
  },
  {
    key: 'oc',
    title: 'OCCharacter mint',
    body: 'Mint finished OCs with recipe hash, image blob, profile blob, and license snapshot.',
  },
];

const i18n = {
  en: {
    brandTagline: 'The Fully onchain Character Maker & Creator',
    navTemplates: 'Templates',
    navDocs: 'Docs',
    languageLabel: 'Language',
    walletConnect: 'Connect wallet',
    walletConnected: 'Wallet connected',
    myPage: 'MyPage',
    walletFirstTitle: 'Connect your wallet first',
    walletFirstCopy: 'MyPage, favorites, creator tools, saved OCs, and on-chain license actions unlock after wallet connection.',
    connectSuiWallet: 'Connect Sui wallet',
    myPageCopy: 'Works and on-chain OCs',
    favorite: 'Favorite',
    favoriteCopy: 'Saved makers',
    createMaker: 'Create maker',
    createMakerCopy: 'Publish an OC template',
    makeOc: 'Make OC',
    makeOcCopy: 'Continue current OC',
    browseTemplates: 'Browse templates',
    browseTemplatesCopy: 'Find a maker to play',
    docsCopy: 'Protocol and licensing',
    templatePlaza: 'Template Plaza',
    templateHero: 'Pick an artist-made template, then make your OC',
    templateHeroCopy: 'Choose a maker, combine parts, save a character, and let Animacraft handle provenance, licensing, revenue splits, and on-chain records.',
    search: 'Search',
    searchPlaceholder: 'Search style, creator, license...',
    filterAll: 'All',
    filterDaily: 'Daily icon',
    filterFantasy: 'Fantasy',
    filterChibi: 'Chibi',
  },
  zh: {
    brandTagline: 'The Fully onchain Character Maker & Creator',
    navTemplates: '模板广场',
    navDocs: '文档',
    languageLabel: '语言',
    walletConnect: '连接钱包',
    walletConnected: '钱包已连接',
    myPage: '我的页面',
    walletFirstTitle: '请先连接钱包',
    walletFirstCopy: '连接钱包后可使用个人页、收藏、创作者工具、已保存 OC 与链上授权操作。',
    connectSuiWallet: '连接 Sui 钱包',
    myPageCopy: '作品与链上 OC',
    favorite: '收藏',
    favoriteCopy: '已保存模板',
    createMaker: '创建模板',
    createMakerCopy: '发布 OC 模板',
    makeOc: '捏 OC',
    makeOcCopy: '继续当前 OC',
    browseTemplates: '浏览模板',
    browseTemplatesCopy: '找一个喜欢的模板开始捏',
    docsCopy: '协议与授权',
    templatePlaza: '模板广场',
    templateHero: '选择创作者模板，然后捏出你的 OC',
    templateHeroCopy: '选择模板、组合部件、保存角色，Animacraft 负责来源、授权、收益分配与链上记录。',
    search: '搜索',
    searchPlaceholder: '搜索风格、创作者、授权...',
    filterAll: '全部',
    filterDaily: '日常头像',
    filterFantasy: '幻想',
    filterChibi: 'Q版',
  },
  ja: {
    brandTagline: 'The Fully onchain Character Maker & Creator',
    navTemplates: 'テンプレート',
    navDocs: 'ドキュメント',
    languageLabel: '言語',
    walletConnect: 'ウォレット接続',
    walletConnected: '接続済み',
    myPage: 'マイページ',
    walletFirstTitle: '先にウォレットを接続してください',
    walletFirstCopy: '接続後、マイページ、保存、作成ツール、OC、オンチェーン権限を利用できます。',
    connectSuiWallet: 'Sui ウォレット接続',
    myPageCopy: '作品とオンチェーン OC',
    favorite: 'お気に入り',
    favoriteCopy: '保存したメーカー',
    createMaker: 'メーカー作成',
    createMakerCopy: 'OC テンプレートを公開',
    makeOc: 'OC を作る',
    makeOcCopy: '現在の OC を続ける',
    browseTemplates: 'テンプレートを見る',
    browseTemplatesCopy: '遊ぶメーカーを探す',
    docsCopy: 'プロトコルとライセンス',
    templatePlaza: 'テンプレート広場',
    templateHero: 'アーティスト製テンプレートを選び、OC を作る',
    templateHeroCopy: 'メーカーを選び、パーツを組み合わせ、キャラクターを保存。出所、ライセンス、収益分配、オンチェーン記録は Animacraft が扱います。',
    search: '検索',
    searchPlaceholder: 'スタイル、作者、ライセンスを検索...',
    filterAll: 'すべて',
    filterDaily: '日常アイコン',
    filterFantasy: 'ファンタジー',
    filterChibi: 'ちび',
  },
  ko: {
    brandTagline: 'The Fully onchain Character Maker & Creator',
    navTemplates: '템플릿',
    navDocs: '문서',
    languageLabel: '언어',
    walletConnect: '지갑 연결',
    walletConnected: '지갑 연결됨',
    myPage: '마이페이지',
    walletFirstTitle: '먼저 지갑을 연결하세요',
    walletFirstCopy: '지갑을 연결하면 마이페이지, 즐겨찾기, 창작 도구, 저장된 OC, 온체인 라이선스 기능을 사용할 수 있습니다.',
    connectSuiWallet: 'Sui 지갑 연결',
    myPageCopy: '작품과 온체인 OC',
    favorite: '즐겨찾기',
    favoriteCopy: '저장한 메이커',
    createMaker: '메이커 만들기',
    createMakerCopy: 'OC 템플릿 게시',
    makeOc: 'OC 만들기',
    makeOcCopy: '현재 OC 이어가기',
    browseTemplates: '템플릿 둘러보기',
    browseTemplatesCopy: '사용할 메이커 찾기',
    docsCopy: '프로토콜과 라이선스',
    templatePlaza: '템플릿 광장',
    templateHero: '작가 템플릿을 고르고 OC를 만드세요',
    templateHeroCopy: '메이커를 선택하고 파츠를 조합해 캐릭터를 저장하면, 출처, 라이선스, 수익 분배, 온체인 기록은 Animacraft가 처리합니다.',
    search: '검색',
    searchPlaceholder: '스타일, 크리에이터, 라이선스 검색...',
    filterAll: '전체',
    filterDaily: '데일리 아이콘',
    filterFantasy: '판타지',
    filterChibi: '치비',
  },
  vi: {
    brandTagline: 'The Fully onchain Character Maker & Creator',
    navTemplates: 'Mẫu',
    navDocs: 'Tài liệu',
    languageLabel: 'Ngôn ngữ',
    walletConnect: 'Kết nối ví',
    walletConnected: 'Đã kết nối ví',
    myPage: 'Trang của tôi',
    walletFirstTitle: 'Kết nối ví trước',
    walletFirstCopy: 'Sau khi kết nối ví, bạn có thể dùng MyPage, yêu thích, công cụ creator, OC đã lưu và quyền on-chain.',
    connectSuiWallet: 'Kết nối ví Sui',
    myPageCopy: 'Tác phẩm và OC on-chain',
    favorite: 'Yêu thích',
    favoriteCopy: 'Maker đã lưu',
    createMaker: 'Tạo maker',
    createMakerCopy: 'Xuất bản mẫu OC',
    makeOc: 'Tạo OC',
    makeOcCopy: 'Tiếp tục OC hiện tại',
    browseTemplates: 'Duyệt mẫu',
    browseTemplatesCopy: 'Tìm maker để bắt đầu',
    docsCopy: 'Giao thức và cấp quyền',
    templatePlaza: 'Quảng trường mẫu',
    templateHero: 'Chọn mẫu của artist, rồi tạo OC của bạn',
    templateHeroCopy: 'Chọn maker, ghép part, lưu nhân vật; Animacraft xử lý nguồn gốc, giấy phép, chia doanh thu và bản ghi on-chain.',
    search: 'Tìm kiếm',
    searchPlaceholder: 'Tìm phong cách, creator, license...',
    filterAll: 'Tất cả',
    filterDaily: 'Icon hằng ngày',
    filterFantasy: 'Fantasy',
    filterChibi: 'Chibi',
  },
};

const protocolSteps = [
  ['01', 'Material Layers', 'Creators upload transparent PNGs, anchors, order, and slot metadata to Walrus.'],
  ['02', 'Template Contract', 'A maker records usable parts, licenses, creator identity, royalties, and composition rules.'],
  ['03', 'OC Recipe', 'A user-made OC becomes a recipe that references templates, parts, colors, and license snapshots.'],
  ['04', 'Finished OC', 'The result can mint as a Soul / OC object with ownership, profile data, display image, and provenance.'],
  ['05', 'License Trade', 'Resale, commercial use, and remix licensing trigger on-chain splits for template and material creators.'],
  ['06', 'Creator Flywheel', 'Great templates bring OC makers; great OCs bring template sales and secondary market activity.'],
];

const state = {
  page: 'templates',
  creatorView: 'list',
  editorPanel: 'top',
  filter: 'all',
  search: '',
  templateId: 'daily-starlit',
  selectedSlot: 'hairFront',
  partSubView: 'overview',
  selectedLayer: 'hairFront',
  selectedItem: 'normal',
  slotOrder: slots.map((slot) => slot.key),
  visual: {
    background: 'dawn',
    hairBack: 'wave',
    hairFront: 'side',
    eyes: 'bright',
    mouth: 'calm',
    outfit: 'jacket',
    accessory: 'halo',
    palette: {
      background: '#f3dfc8',
      skin: '#f1c9b1',
      hair: '#7b5cff',
      eyes: '#2db7a3',
      outfit: '#335c81',
      accessory: '#f0a23a',
    },
  },
  assets: [],
  rules: [],
  paletteLinks: [{ primaryPartKey: 'hairBack', linkedPartKey: 'hairFront' }],
  customSlots: [],
  walletConnected: false,
  walletAddress: '',
  walletProvider: null,
  walletStatus: 'disconnected',
  chainMode: runtimeConfig.packageId.includes('TODO') ? 'draft' : 'live',
  publishing: false,
  publishStatus: '',
  publishDigest: '',
  minting: false,
  mintStatus: '',
  mintDigest: '',
  locale: localStorage.getItem('animacraft-locale') || 'en',
};

function $(id) {
  return document.getElementById(id);
}

function t(key) {
  return (i18n[state.locale] && i18n[state.locale][key]) || i18n.en[key] || key;
}

function setLocale(locale) {
  state.locale = i18n[locale] ? locale : 'en';
  localStorage.setItem('animacraft-locale', state.locale);
  document.documentElement.lang = state.locale === 'zh' ? 'zh-CN' : state.locale;
  renderI18n();
  renderWalletState();
}

function renderI18n() {
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
    node.setAttribute('placeholder', t(node.dataset.i18nPlaceholder));
  });
  ['accountLanguage'].forEach((id) => {
    if ($(id)) $(id).value = state.locale;
  });
  if ($('walletButton')) {
    const label = $('walletButton').querySelector('[data-i18n="walletConnect"]');
    if (label) label.textContent = state.walletConnected ? t('walletConnected') : t('walletConnect');
  }
}

function activeTemplate() {
  return templates.find((template) => template.id === state.templateId) || templates[0];
}

function activeMakerObjectId() {
  return runtimeConfig.featuredMakers?.[activeTemplate().id] || '';
}

function activeSlot() {
  return allSlots().find((slot) => slot.key === state.selectedSlot) || allSlots()[0];
}

function allSlots() {
  const merged = [...slots, ...state.customSlots];
  const byKey = new Map(merged.map((slot) => [slot.key, slot]));
  const ordered = state.slotOrder.map((key) => byKey.get(key)).filter(Boolean);
  const missing = merged.filter((slot) => !state.slotOrder.includes(slot.key));
  return [...ordered, ...missing];
}

function slotItems(slotKey) {
  return parts[slotKey] || [];
}

function slug(value) {
  return String(value)
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'part';
}

function splitList(value) {
  return String(value).split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
}

function download(name, content, type = 'application/json') {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function shortAddress(address) {
  if (!address) return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

async function connectSuiWallet() {
  try {
    await openWalletSelector();
  } catch (error) {
    state.publishStatus = error.message || 'Wallet connection failed.';
    renderPublishAction();
  }
}

function chainStatusItems() {
  const walletReady = state.walletConnected;
  const packageReady = !runtimeConfig.packageId.includes('TODO');
  const walrusReady = runtimeConfig.network === 'mainnet'
    ? Boolean(runtimeConfig.walrusUploadRelayUrl && runtimeConfig.walrusAggregatorUrl)
    : Boolean(runtimeConfig.walrusPublisherUrl && runtimeConfig.walrusAggregatorUrl);
  return [
    ['Network', runtimeConfig.network, 'Sui network used by wallet transactions.', 'ready'],
    ['Wallet', walletReady ? shortAddress(state.walletAddress) || 'Connected' : 'Not connected', walletReady ? 'Ready to sign creator and OC transactions.' : 'Connect before publishing or minting.', walletReady ? 'ready' : 'wait'],
    ['Package', packageReady ? shortAddress(runtimeConfig.packageId) : 'Draft package id', packageReady ? 'Move package can be called from PTBs.' : 'Publish Move package, then set packageId in config.js.', packageReady ? 'ready' : 'wait'],
    ['Walrus', walrusReady ? `${runtimeConfig.network} upload configured` : 'Missing endpoint', 'Assets are uploaded before their blob ids are committed to the maker transaction.', walrusReady ? 'ready' : 'wait'],
  ];
}

function filteredTemplates() {
  const query = state.search.trim().toLowerCase();
  return templates.filter((template) => {
    const matchesFilter = state.filter === 'all' || template.category === state.filter;
    const haystack = `${template.name} ${template.creator} ${template.style} ${template.license} ${template.summary}`.toLowerCase();
    return matchesFilter && (!query || haystack.includes(query));
  });
}

function setPage(page) {
  state.page = page === 'editor' ? 'make' : page === 'protocol' ? 'docs' : page;
  if (state.page === 'creator' && !state.creatorView) state.creatorView = 'list';
  document.querySelectorAll('.page').forEach((section) => {
    section.classList.toggle('active', section.id === state.page);
  });
  document.querySelectorAll('[data-page]').forEach((button) => {
    button.classList.toggle('active', button.dataset.page === state.page);
  });
  history.replaceState(null, '', `#${state.page}`);
  closeAccountPanel();
}

function setCreatorView(view) {
  state.creatorView = view;
  document.querySelectorAll('[data-creator-view]').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.creatorView === state.creatorView);
  });
  if ($('editingMakerTitle')) $('editingMakerTitle').textContent = activeTemplate().name;
  setEditorPanel(state.editorPanel || 'top');
}

function setEditorPanel(panel) {
  state.editorPanel = panel;
  document.querySelectorAll('[data-editor-panel]').forEach((section) => {
    section.classList.toggle('active', section.dataset.editorPanel === state.editorPanel);
  });
  document.querySelectorAll('[data-editor-panel-button]').forEach((button) => {
    button.classList.toggle('active', button.dataset.editorPanelButton === state.editorPanel);
  });
  const labels = {
    top: 'Maker Top',
    layers: 'Layer Editor',
    parts: 'Parts',
    rules: 'Rules',
    palette: 'Palette Rules',
    preview: 'Preview Check',
    publish: 'On-chain Publish',
    settings: 'Settings',
  };
  if ($('editingPanelKicker')) $('editingPanelKicker').textContent = labels[state.editorPanel] || 'Layer Editor';
}

function focusCreatorTop() {
  document.querySelector('.maker-list-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function syncTemplateFields() {
  const template = activeTemplate();
  $('creatorTemplateName').value = template.name;
  $('creatorName').value = template.creator;
  $('creatorWorld').value = template.style;
  $('creatorRoyalty').value = template.royaltyBps;
  $('profileWorld').value = template.style;
  $('templateTitle').textContent = template.name;
  $('avatarTemplate').textContent = template.name;
  $('licenseTitle').textContent = template.license;
  $('licenseDescription').textContent = template.licenseNote;
}

function renderTemplates() {
  const list = filteredTemplates();
  $('templateGrid').innerHTML = list.length ? list.map((template) => `
    <article class="template-card ${template.id === state.templateId ? 'active' : ''}" data-template="${template.id}">
      <div class="template-cover" style="--accent:${template.accent}; --secondary:${template.secondary};">
        <div class="cover-face">
          <span class="cover-hair"></span>
          <span class="cover-eye left"></span>
          <span class="cover-eye right"></span>
          <span class="cover-mouth"></span>
        </div>
        <span class="cover-style">${template.style}</span>
      </div>
      <div class="template-body">
        <div class="badge-row">
          <span>${template.license}</span>
          <span>${template.parts} parts</span>
          <span>${template.uses} uses</span>
        </div>
        <h2>${template.name}</h2>
        <p class="creator-line">by ${template.creator}</p>
        <p>${template.summary}</p>
        <div class="sample-strip" aria-label="${template.name} samples">
          ${[1, 2, 3, 4].map((item) => `<span style="--tilt:${item * 3}deg; --accent:${template.accent}; --secondary:${template.secondary};"></span>`).join('')}
        </div>
        <div class="template-footer">
          <span>${template.royaltyBps / 100}% royalty</span>
          <span>${template.works} works</span>
          <button class="primary" data-use-template="${template.id}">Start making</button>
        </div>
      </div>
    </article>
  `).join('') : '<div class="empty-state">No matching makers found.</div>';

  document.querySelectorAll('.template-card').forEach((card) => {
    card.addEventListener('click', (event) => {
      if (event.target.closest('[data-use-template]')) return;
      state.templateId = card.dataset.template;
      syncTemplateFields();
      renderAll();
    });
  });

  document.querySelectorAll('[data-use-template]').forEach((button) => {
    button.addEventListener('click', () => {
      state.templateId = button.dataset.useTemplate;
      syncTemplateFields();
      setPage('make');
      renderAll();
    });
  });
}

function renderSlots() {
  $('slotRail').innerHTML = allSlots().map((slot) => `
    <button class="slot-btn ${slot.key === state.selectedSlot ? 'active' : ''}" data-slot="${slot.key}">
      <span>${slot.icon}</span>
      <strong>${slot.label}</strong>
    </button>
  `).join('');

  document.querySelectorAll('[data-slot]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedSlot = button.dataset.slot;
      renderAll();
    });
  });
}

function renderParts() {
  const slot = activeSlot();
  $('slotTitle').textContent = slot.label;
  $('slotDescription').textContent = slot.description;
  $('partColor').value = state.visual.palette[slot.colorKey];
  $('partGrid').innerHTML = slotItems(slot.key).map((part, index) => `
    <button class="part-card ${state.visual[slot.key] === part.id ? 'active' : ''}" data-part="${part.id}">
      <span class="part-thumb" style="--accent:${state.visual.palette[slot.colorKey]}; --index:${index};"></span>
      <strong>${part.label}</strong>
      <small>${slot.key}/${part.id}</small>
    </button>
  `).join('');

  document.querySelectorAll('[data-part]').forEach((button) => {
    button.addEventListener('click', () => {
      state.visual[slot.key] = button.dataset.part;
      renderAll();
    });
  });
}

function renderSwatches() {
  const slot = activeSlot();
  $('swatchGrid').innerHTML = swatches.map((color) => `
    <button class="swatch ${state.visual.palette[slot.colorKey] === color ? 'active' : ''}" data-swatch="${color}" style="background:${color}" aria-label="Use ${color}"></button>
  `).join('');
  document.querySelectorAll('[data-swatch]').forEach((button) => {
    button.addEventListener('click', () => {
      state.visual.palette[slot.colorKey] = button.dataset.swatch;
      renderAll();
    });
  });
}

function renderAvatar() {
  const palette = state.visual.palette;
  const avatar = $('avatar');
  avatar.dataset.background = state.visual.background;
  avatar.dataset.hairBack = state.visual.hairBack;
  avatar.dataset.hairFront = state.visual.hairFront;
  avatar.dataset.eyes = state.visual.eyes;
  avatar.dataset.mouth = state.visual.mouth;
  avatar.dataset.outfit = state.visual.outfit;
  avatar.dataset.accessory = state.visual.accessory;
  document.querySelector('.avatar-bg').style.background =
    `radial-gradient(circle at 78% 18%, ${palette.accessory}80, transparent 28%), radial-gradient(circle at 14% 86%, ${palette.eyes}66, transparent 34%), linear-gradient(145deg, ${palette.background}, #fff7ed)`;
  document.querySelector('.hair-back').style.background = palette.hair;
  document.querySelector('.hair-front').style.background = palette.hair;
  document.querySelector('.face').style.background = palette.skin;
  document.querySelectorAll('.ear').forEach((ear) => { ear.style.background = palette.skin; });
  document.querySelector('.outfit').style.background = palette.outfit;
  document.querySelectorAll('.eye').forEach((eye) => { eye.style.background = palette.eyes; });
  document.querySelector('.accessory').style.borderColor = palette.accessory;
  document.querySelector('.accessory').style.background = `${palette.accessory}22`;
  $('avatarName').textContent = $('profileName').value || 'Untitled OC';
  $('characterNameTitle').textContent = $('profileName').value || 'Untitled OC';
  $('avatarWorld').textContent = $('profileWorld').value || activeTemplate().style;
}

function renderRecipe() {
  $('recipeList').innerHTML = allSlots().map((slot) => {
    const selected = slotItems(slot.key).find((part) => part.id === state.visual[slot.key]);
    return `<button data-slot="${slot.key}">${slot.label}: ${selected ? selected.label : state.visual[slot.key]}</button>`;
  }).join('');
  document.querySelectorAll('#recipeList [data-slot]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedSlot = button.dataset.slot;
      renderAll();
    });
  });
}

function creatorManifest() {
  return {
    schemaVersion: 'animacraft.creator-template.v1',
    template: {
      id: slug($('creatorTemplateName').value),
      name: $('creatorTemplateName').value,
      creator: $('creatorName').value,
      style: $('creatorWorld').value,
      license: $('creatorLicense').value,
      royaltyBps: Number($('creatorRoyalty').value || 0),
      storage: 'walrus',
      chain: 'sui',
      canvas: { width: 1024, height: 1024, anchorX: 512, anchorY: 512 },
    },
    runtime: {
      network: runtimeConfig.network,
      packageId: runtimeConfig.packageId,
      walrusPublisherUrl: runtimeConfig.walrusPublisherUrl,
      walrusAggregatorUrl: runtimeConfig.walrusAggregatorUrl,
      appUrl: runtimeConfig.appUrl,
    },
    slots: allSlots().map((slot, index) => ({
      key: slot.key,
      label: slot.label,
      renderOrder: index,
      colorKey: slot.colorKey,
      parts: slotItems(slot.key).map((part) => ({
        id: part.id,
        label: part.label,
        file: `${slot.key}_${part.id}.png`,
      })),
    })),
    rules: state.rules,
    paletteLinks: state.paletteLinks,
    assets: state.assets.map(({ name, size, type, slot, partId, blobId = '' }) => ({
      name,
      size,
      type,
      slot,
      partId,
      blobId,
    })),
  };
}

function ocPackage() {
  return {
    schemaVersion: 'animacraft.oc-package.v1',
    createdAt: new Date().toISOString(),
    template: {
      id: activeTemplate().id,
      name: activeTemplate().name,
      creator: activeTemplate().creator,
      license: activeTemplate().license,
      royaltyBps: activeTemplate().royaltyBps,
    },
    profile: {
      name: $('profileName').value || 'Untitled OC',
      world: $('profileWorld').value || activeTemplate().style,
      description: $('profileDescription').value,
      tags: splitList($('profileTags').value),
    },
    recipe: allSlots().map((slot, index) => ({
      slot: slot.key,
      part: state.visual[slot.key],
      color: state.visual.palette[slot.colorKey],
      renderOrder: index,
    })),
    onchainIntent: {
      network: runtimeConfig.network,
      packageId: runtimeConfig.packageId,
      materialStorage: 'Walrus blob ids',
      templateObject: 'Animacraft OCMaker object',
      ocObject: 'Animacraft OCCharacter object',
      settlement: 'creator royalty and license split',
      walletSigner: state.walletAddress || 'not-connected',
    },
  };
}

function renderAssets() {
  const assetQueue = $('assetQueue');
  if (!assetQueue) return;
  assetQueue.classList.toggle('empty', state.assets.length === 0);
  assetQueue.innerHTML = state.assets.length ? state.assets.map((asset) => `
    <div>
      <strong>${asset.name}</strong>
      <span>${asset.slot} · ${asset.partId} · ${(asset.size / 1024).toFixed(1)} KB${asset.blobId ? ' · Walrus ready' : ''}</span>
    </div>
  `).join('') : 'No layer files added yet.';
}

function renderChecklist() {
  const checks = [
    ['Maker metadata', $('creatorTemplateName').value.trim() && $('creatorName').value.trim()],
    ['Standard slots', allSlots().length >= 7],
    ['License rules', Number($('creatorRoyalty').value || 0) >= 0],
    ['Layer samples', state.assets.length > 0],
    ['OC preview', Boolean($('profileName').value.trim())],
  ];
  $('creatorChecklist').innerHTML = checks.map(([label, done]) => `
    <div class="${done ? 'done' : ''}">
      <span>${done ? 'OK' : 'WAIT'}</span>
      <strong>${label}</strong>
    </div>
  `).join('');
}

function renderRules() {
  if (!$('ruleLeftPart') || !$('ruleRightPart')) return;
  const options = allSlots().map((slot) => `<option value="${slot.key}">${slot.label}</option>`).join('');
  const previousLeft = $('ruleLeftPart').value;
  const previousRight = $('ruleRightPart').value;
  $('ruleLeftPart').innerHTML = options;
  $('ruleRightPart').innerHTML = options;
  $('ruleLeftPart').value = previousLeft || allSlots()[0]?.key || '';
  $('ruleRightPart').value = previousRight || allSlots()[1]?.key || allSlots()[0]?.key || '';
  $('selectionRuleList').innerHTML = state.rules.length
    ? state.rules.map((rule, index) => `
        <div>
          <span>${allSlots().find((slot) => slot.key === rule.leftPartKey)?.label || rule.leftPartKey}</span>
          <b>cannot combine with</b>
          <span>${allSlots().find((slot) => slot.key === rule.rightPartKey)?.label || rule.rightPartKey}</span>
          <button type="button" data-remove-rule="${index}" aria-label="Remove rule">×</button>
        </div>
      `).join('')
    : '<p>No selection rules yet.</p>';
  document.querySelectorAll('[data-remove-rule]').forEach((button) => {
    button.addEventListener('click', () => {
      state.rules.splice(Number(button.dataset.removeRule), 1);
      renderAll();
    });
  });
}

function renderPaletteLinks() {
  if (!$('palettePrimaryPart') || !$('paletteLinkedPart')) return;
  const options = allSlots().map((slot) => `<option value="${slot.key}">${slot.label}</option>`).join('');
  const previousPrimary = $('palettePrimaryPart').value;
  const previousLinked = $('paletteLinkedPart').value;
  $('palettePrimaryPart').innerHTML = options;
  $('paletteLinkedPart').innerHTML = options;
  $('palettePrimaryPart').value = previousPrimary || 'hairBack';
  $('paletteLinkedPart').value = previousLinked || 'hairFront';
  $('paletteLinkList').innerHTML = state.paletteLinks.length
    ? state.paletteLinks.map((link, index) => `
        <div>
          <span>${allSlots().find((slot) => slot.key === link.primaryPartKey)?.label || link.primaryPartKey}</span>
          <b>shares palette with</b>
          <span>${allSlots().find((slot) => slot.key === link.linkedPartKey)?.label || link.linkedPartKey}</span>
          <button type="button" data-remove-palette-link="${index}" aria-label="Remove palette link">×</button>
        </div>
      `).join('')
    : '<p>No linked palettes yet.</p>';
  document.querySelectorAll('[data-remove-palette-link]').forEach((button) => {
    button.addEventListener('click', () => {
      state.paletteLinks.splice(Number(button.dataset.removePaletteLink), 1);
      renderAll();
    });
  });
}

function renderPackage() {
  $('packagePreview').textContent = JSON.stringify(ocPackage(), null, 2);
}

function mintReadiness() {
  if (runtimeConfig.packageId.includes('TODO')) return 'The Move package is not configured yet.';
  if (!activeMakerObjectId()) return 'This template is a preview. Add its published OCMaker object id to public/config.js.';
  if (!state.walletConnected) return 'Connect a Sui wallet to mint this OC.';
  return 'Ready to store the OC image and profile on Walrus, then mint on Sui.';
}

function renderMintAction() {
  if (!$('mintOcOnchain')) return;
  const ready = !runtimeConfig.packageId.includes('TODO') && Boolean(activeMakerObjectId()) && state.walletConnected;
  $('mintOcOnchain').disabled = state.minting || !ready;
  $('mintOcOnchain').textContent = state.minting ? 'Minting…' : state.mintDigest ? 'Minted' : 'Mint OC';
  if (state.mintDigest) {
    $('mintOcStatus').innerHTML = `OC minted. <a href="${explorerTransactionUrl(state.mintDigest)}" target="_blank" rel="noreferrer">View transaction</a>`;
  } else {
    $('mintOcStatus').textContent = state.mintStatus || mintReadiness();
  }
}

function renderOcImageBlob() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const context = canvas.getContext('2d');
  const palette = state.visual.palette;
  context.fillStyle = palette.background;
  context.fillRect(0, 0, 1024, 1024);
  context.fillStyle = palette.outfit;
  context.beginPath();
  context.roundRect(260, 720, 504, 360, 120);
  context.fill();
  context.fillStyle = palette.skin;
  context.beginPath();
  context.ellipse(512, 490, 235, 285, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = palette.hair;
  context.beginPath();
  context.ellipse(512, 285, 300, 225, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = palette.eyes;
  context.beginPath();
  context.arc(425, 500, 24, 0, Math.PI * 2);
  context.arc(599, 500, 24, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = palette.accessory;
  context.lineWidth = 24;
  context.beginPath();
  context.ellipse(512, 145, 180, 54, 0, 0, Math.PI * 2);
  context.stroke();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not render the OC image.')), 'image/png');
  });
}

function renderImageMakerList() {
  $('imageMakerList').innerHTML = `
    ${templates.map((template) => `
      <article class="creator-maker-card ${template.id === state.templateId ? 'active' : ''}" data-maker="${template.id}" style="--accent:${template.accent}; --secondary:${template.secondary};">
        <div class="maker-cover-mini">
          <span class="mini-face"></span>
        </div>
        <div class="maker-card-body">
          <div class="maker-tags">
            <span>${template.license === 'Personal use' ? 'Private' : 'Listed'}</span>
            <span>${template.category === 'chibi' ? '1:1' : '9:16'}</span>
            <span>Free combine</span>
          </div>
          <h2>${template.name}</h2>
          <p>${template.summary}</p>
        </div>
        <div class="maker-card-actions">
          <button class="secondary" data-preview-maker="${template.id}">Preview</button>
          <button class="icon-button" data-open-maker="${template.id}" aria-label="Open ${template.name}">↗</button>
          <button class="primary" data-edit-maker="${template.id}">Edit</button>
        </div>
      </article>
    `).join('')}
  `;

  document.querySelectorAll('[data-preview-maker], [data-open-maker]').forEach((button) => {
    button.addEventListener('click', () => {
      state.templateId = button.dataset.previewMaker || button.dataset.openMaker;
      syncTemplateFields();
      setPage('make');
      renderAll();
    });
  });

  document.querySelectorAll('[data-edit-maker]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.editMaker) state.templateId = button.dataset.editMaker;
      syncTemplateFields();
      setCreatorView('edit');
      renderAll();
      focusCreatorTop();
    });
  });
}

function renderCreatorDetails() {
  const template = activeTemplate();
  $('detailMakerName').textContent = template.name;
  $('detailMakerTitle').textContent = template.name;
  if ($('layerMakerTitle')) $('layerMakerTitle').textContent = template.name;
  $('editingMakerTitle').textContent = template.name;
  $('detailPartCount').textContent = `${allSlots().length} / 750 parts`;
  $('detailDescription').textContent = template.summary || 'Build the template from layered assets, then bind the maker to license rules and on-chain provenance.';
  $('layerCount').textContent = allSlots().length;

  $('creatorPartsList').innerHTML = allSlots().map((slot, index) => `
    <button class="creator-part-row" data-slot="${slot.key}">
      <span>${String(index + 1).padStart(2, '0')}</span>
      <strong>${slot.label}</strong>
      <small>${slotItems(slot.key).length} items</small>
    </button>
  `).join('');

  $('creatorLayerList').innerHTML = allSlots().map((slot, index) => `
    <button class="layer-row ${state.selectedLayer === slot.key ? 'active' : ''}" data-layer-key="${slot.key}">
      <span>${index + 1}</span>
      <strong>${slot.label}</strong>
      <small>${slot.key}</small>
    </button>
  `).join('');

  renderPartWorkspace();
  renderLayerDetails();

  if ($('makerTopPartsList')) {
    $('makerTopPartsList').innerHTML = allSlots().map((slot, index) => `
      <div class="maker-top-row">
        <span class="maker-top-index">${String(index + 1).padStart(2, '0')}</span>
        <div class="maker-top-main">
          <strong>${slot.label}</strong>
          <small>${slot.key}</small>
        </div>
        <small class="maker-top-status">${index === 0 ? 'Last bastion ready' : `${slotItems(slot.key).length} items`}</small>
        <div class="maker-top-actions">
          <button class="secondary" data-slot-items="${slot.key}">Items</button>
          <button class="secondary" data-slot-settings="${slot.key}">Settings</button>
        </div>
      </div>
    `).join('');
  }

  if ($('makerTopLayerList')) {
    $('makerTopLayerList').innerHTML = allSlots().map((slot, index) => `
      <div class="maker-top-row">
        <span class="maker-top-index">${index + 1}</span>
        <div class="maker-top-main">
          <strong>${slot.label}</strong>
          <small>${slot.key}</small>
        </div>
        <small class="maker-top-status">${slot.kind || 'standard'}</small>
      </div>
    `).join('');
  }

  document.querySelectorAll('.creator-part-row').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedSlot = button.dataset.slot;
      state.selectedItem = state.visual[state.selectedSlot] || slotItems(state.selectedSlot)[0]?.id || '';
      state.partSubView = 'items';
      renderCreatorDetails();
      $('partWorkspace')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });

  document.querySelectorAll('[data-slot-items], [data-slot-settings]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedSlot = button.dataset.slotItems || button.dataset.slotSettings;
      state.selectedItem = state.visual[state.selectedSlot] || slotItems(state.selectedSlot)[0]?.id || '';
      state.partSubView = button.dataset.slotItems ? 'items' : 'settings';
      setEditorPanel('parts');
      renderCreatorDetails();
    });
  });

  document.querySelectorAll('[data-layer-key]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedLayer = button.dataset.layerKey;
      renderCreatorDetails();
    });
  });
}

function renderPartWorkspace() {
  if (!$('partWorkspace')) return;
  const slot = activeSlot();
  const items = slotItems(slot.key);
  const selectedItemForSlot = state.visual[slot.key] || items[0]?.id || '';
  const itemRows = items.map((item, index) => `
    <div class="item-row ${selectedItemForSlot === item.id ? 'active' : ''}" data-item-id="${item.id}">
      <span>No.${index + 1}</span>
      <strong>${item.label}</strong>
      <small>${item.assetStatus === 'staged' ? 'Walrus staged' : index === 0 ? 'Base item · public' : 'Public item'}</small>
      <button class="secondary" data-stage-item="${item.id}">Stage file</button>
      <button class="secondary" data-select-item="${item.id}">Select</button>
    </div>
  `).join('');

  if (state.partSubView === 'settings') {
    $('partWorkspace').innerHTML = `
      <div class="workspace-head">
        <div>
          <p class="kicker">Part Details</p>
          <h2>${slot.label}</h2>
        </div>
        <div class="workspace-actions">
          <button class="secondary" data-part-subview="items">Item List</button>
          <button class="secondary" data-select-layer-from-part="${slot.key}">Open layer</button>
        </div>
      </div>
      <div class="part-detail-grid">
        <label>Part name<input data-part-field="label" value="${slot.label}" /></label>
        <label>Part type<select data-part-field="kind">
          <option value="standard" ${slot.kind === 'standard' || !slot.kind ? 'selected' : ''}>Standard part</option>
          <option value="left-right-pair" ${slot.kind === 'left-right-pair' ? 'selected' : ''}>Left-right paired part</option>
          <option value="last-bastion" ${slot.kind === 'last-bastion' ? 'selected' : ''}>Last bastion part</option>
        </select></label>
        <label>Anchor X<input data-part-field="x" type="number" value="${slot.x ?? 0}" /></label>
        <label>Anchor Y<input data-part-field="y" type="number" value="${slot.y ?? 0}" /></label>
        <label>Layer name<input data-part-field="layerName" value="${slot.layerName || 'Normal'}" /></label>
        <label>Menu visibility<select data-part-field="menuVisible">
          <option value="visible" ${slot.menuVisible !== false ? 'selected' : ''}>Visible in menu</option>
          <option value="hidden" ${slot.menuVisible === false ? 'selected' : ''}>Hidden fixed layer</option>
        </select></label>
        <label>License gate<select data-part-field="licenseGate">
          <option value="included" ${slot.licenseGate !== 'paid' ? 'selected' : ''}>Included in maker license</option>
          <option value="paid" ${slot.licenseGate === 'paid' ? 'selected' : ''}>Paid add-on part</option>
        </select></label>
        <label>On-chain status<select data-part-field="assetStatus">
          <option value="draft" ${slot.assetStatus !== 'staged' ? 'selected' : ''}>Draft local slot</option>
          <option value="staged" ${slot.assetStatus === 'staged' ? 'selected' : ''}>Walrus staged</option>
        </select></label>
      </div>
    `;
  } else {
    $('partWorkspace').innerHTML = `
      <div class="workspace-head">
        <div>
          <p class="kicker">Item List</p>
          <h2>${slot.label}</h2>
        </div>
        <div class="workspace-actions">
          <button class="secondary" data-add-item>+ Add item</button>
          <button class="secondary" data-part-subview="settings">Part Settings</button>
        </div>
      </div>
      <div class="item-toolbar">
        <span>${items.length} items</span>
        <span>Sort key: Item No.</span>
        <span>Selected: ${selectedItemForSlot || 'none'}</span>
      </div>
      <div class="item-list">${itemRows || '<div class="empty-state">No items yet. Add the first item to make this part selectable.</div>'}</div>
    `;
  }

  document.querySelectorAll('[data-part-subview]').forEach((button) => {
    button.addEventListener('click', () => {
      state.partSubView = button.dataset.partSubview;
      renderPartWorkspace();
    });
  });

  document.querySelectorAll('[data-select-item]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedItem = button.dataset.selectItem;
      state.visual[slot.key] = state.selectedItem;
      renderAll();
    });
  });

  document.querySelectorAll('[data-stage-item]').forEach((button) => {
    button.addEventListener('click', () => {
      const item = slotItems(slot.key).find((entry) => entry.id === button.dataset.stageItem);
      if (!item) return;
      item.assetStatus = item.assetStatus === 'staged' ? 'draft' : 'staged';
      renderCreatorDetails();
    });
  });

  document.querySelectorAll('[data-select-layer-from-part]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedLayer = button.dataset.selectLayerFromPart;
      setEditorPanel('layers');
      renderAll();
      $('layerDetailsPanel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });

  document.querySelectorAll('[data-part-field]').forEach((input) => {
    input.addEventListener('change', () => updatePartField(slot.key, input.dataset.partField, input.value));
  });

  document.querySelectorAll('[data-add-item]').forEach((button) => {
    button.addEventListener('click', () => {
      const next = slotItems(slot.key).length + 1;
      const id = `item-${next}`;
      if (!parts[slot.key]) parts[slot.key] = [];
      parts[slot.key].push({ id, label: `Item ${next}` });
      state.selectedItem = id;
      state.visual[slot.key] = id;
      renderAll();
    });
  });
}

function updatePartField(slotKey, field, value) {
  const slot = allSlots().find((item) => item.key === slotKey);
  if (!slot) return;
  if (field === 'x' || field === 'y') slot[field] = Number(value || 0);
  else if (field === 'menuVisible') slot.menuVisible = value !== 'hidden';
  else slot[field] = value;
  if (field === 'label') {
    if (slot.key === state.selectedLayer && $('layerMakerTitle')) renderLayerDetails();
  }
  renderCreatorDetails();
}

function renderLayerDetails() {
  if (!$('layerDetailsPanel')) return;
  const layer = allSlots().find((slot) => slot.key === state.selectedLayer) || activeSlot();
  $('layerDetailsPanel').innerHTML = `
    <div class="workspace-head">
      <div>
        <p class="kicker">Layer Details</p>
        <h2>${layer.label}</h2>
      </div>
      <div class="workspace-actions">
        <button class="secondary" data-move-layer="up">Move front</button>
        <button class="secondary" data-move-layer="down">Move behind</button>
        <button class="secondary" data-stage-layer="${layer.key}">${layer.assetStatus === 'staged' ? 'Unstage asset' : 'Stage asset'}</button>
        <button class="secondary" data-open-part-modal>Add layer</button>
      </div>
    </div>
    <div class="part-detail-grid">
      <label>Layer name<input data-layer-field="layerName" value="${layer.layerName || layer.label}" /></label>
      <label>Anchor X<input data-layer-field="x" type="number" value="${layer.x ?? 0}" /></label>
      <label>Anchor Y<input data-layer-field="y" type="number" value="${layer.y ?? 0}" /></label>
      <label>Layer kind<select data-layer-field="kind">
        <option value="standard" ${layer.kind === 'standard' || !layer.kind ? 'selected' : ''}>Standard</option>
        <option value="left-right-pair" ${layer.kind === 'left-right-pair' ? 'selected' : ''}>Left-right pair</option>
        <option value="last-bastion" ${layer.kind === 'last-bastion' ? 'selected' : ''}>Last bastion</option>
      </select></label>
      <label>Menu visibility<select data-layer-field="menuVisible">
        <option value="visible" ${layer.menuVisible !== false ? 'selected' : ''}>Visible in menu</option>
        <option value="hidden" ${layer.menuVisible === false ? 'selected' : ''}>Hidden fixed layer</option>
      </select></label>
      <label>Walrus status<select data-layer-field="assetStatus">
        <option value="draft" ${layer.assetStatus !== 'staged' ? 'selected' : ''}>Draft slot</option>
        <option value="staged" ${layer.assetStatus === 'staged' ? 'selected' : ''}>Staged blob</option>
      </select></label>
      <div>
        <strong>Sui object</strong>
        <span>${layer.assetStatus === 'staged' ? 'Ready for template manifest' : 'Waiting for asset staging'}</span>
      </div>
      <div>
        <strong>Current items</strong>
        <span>${slotItems(layer.key).length} item records</span>
      </div>
    </div>
  `;

  document.querySelectorAll('[data-layer-field]').forEach((input) => {
    input.addEventListener('change', () => updateLayerField(layer.key, input.dataset.layerField, input.value));
  });

  document.querySelectorAll('[data-move-layer]').forEach((button) => {
    button.addEventListener('click', () => moveLayer(layer.key, button.dataset.moveLayer));
  });

  document.querySelectorAll('[data-stage-layer]').forEach((button) => {
    button.addEventListener('click', () => {
      updateLayerField(button.dataset.stageLayer, 'assetStatus', layer.assetStatus === 'staged' ? 'draft' : 'staged');
    });
  });

  document.querySelectorAll('[data-open-part-modal]').forEach((button) => {
    button.addEventListener('click', openPartModal);
  });
}

function updateLayerField(layerKey, field, value) {
  updatePartField(layerKey, field, value);
}

function moveLayer(layerKey, direction) {
  const order = [...state.slotOrder];
  const index = order.indexOf(layerKey);
  if (index === -1) return;
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= order.length) return;
  [order[index], order[target]] = [order[target], order[index]];
  state.slotOrder = order;
  renderAll();
}

function openMakerModal() {
  $('makerRegistrationModal').classList.add('active');
  $('makerRegistrationModal').setAttribute('aria-hidden', 'false');
  $('newMakerName').focus();
}

function closeMakerModal() {
  $('makerRegistrationModal').classList.remove('active');
  $('makerRegistrationModal').setAttribute('aria-hidden', 'true');
}

function openPartModal() {
  $('partRegistrationModal').classList.add('active');
  $('partRegistrationModal').setAttribute('aria-hidden', 'false');
  $('newPartName').focus();
}

function closePartModal() {
  $('partRegistrationModal').classList.remove('active');
  $('partRegistrationModal').setAttribute('aria-hidden', 'true');
}

function openAccountPanel() {
  $('accountPanel').classList.add('active');
  $('accountPanel').setAttribute('aria-hidden', 'false');
  $('accountButton').setAttribute('aria-expanded', 'true');
}

function closeAccountPanel() {
  $('accountPanel').classList.remove('active');
  $('accountPanel').setAttribute('aria-hidden', 'true');
  $('accountButton').setAttribute('aria-expanded', 'false');
}

function toggleWallet() {
  connectSuiWallet();
}

function renderWalletState() {
  $('walletButton').classList.toggle('connected', state.walletConnected);
  const walletLabel = $('walletButton').querySelector('[data-i18n="walletConnect"]');
  const displayAddress = shortAddress(state.walletAddress);
  if (walletLabel) walletLabel.textContent = state.walletConnected ? displayAddress : t('walletConnect');
  $('panelWalletButton').textContent = state.walletConnected ? `Wallet connected: ${displayAddress}` : t('connectSuiWallet');
  $('walletSummary').textContent = state.walletConnected ? `${state.walletProvider || 'Sui wallet'} · ${runtimeConfig.network}` : 'Wallet not connected';
  $('walletFirstCard').classList.toggle('connected', state.walletConnected);
  document.querySelector('.account-grid').classList.toggle('locked', !state.walletConnected);
  document.querySelectorAll('.account-grid [data-page]').forEach((button) => {
    button.disabled = !state.walletConnected;
  });
}

function publishReadiness() {
  if (runtimeConfig.packageId.includes('TODO')) return 'Publish the Move package and set packageId in config.js.';
  if (!state.walletConnected) return 'Connect a Sui wallet to sign publication.';
  if (!state.assets.length) return 'Upload at least one transparent PNG layer.';
  if (!$('creatorTemplateName').value.trim()) return 'Add a maker name in Settings.';
  return 'Ready to upload assets to Walrus and publish the maker on Sui.';
}

function renderPublishAction() {
  if (!$('publishMakerOnchain')) return;
  const ready = !runtimeConfig.packageId.includes('TODO') && state.walletConnected && state.assets.length > 0;
  $('publishMakerOnchain').disabled = state.publishing || !ready;
  $('publishMakerOnchain').textContent = state.publishing ? 'Publishing…' : state.publishDigest ? 'Published' : 'Upload & publish';
  $('makerPublishAction').classList.toggle('success', Boolean(state.publishDigest));
  $('makerPublishAction').classList.toggle('busy', state.publishing);
  if (state.publishDigest) {
    $('makerPublishStatus').innerHTML = `Published on ${runtimeConfig.network}. <a href="${explorerTransactionUrl(state.publishDigest)}" target="_blank" rel="noreferrer">View transaction</a>`;
  } else {
    $('makerPublishStatus').textContent = state.publishStatus || publishReadiness();
  }
}

function renderChainStatus() {
  if ($('chainStatusGrid')) {
    $('chainStatusGrid').innerHTML = chainStatusItems().map(([label, value, note, status]) => `
      <article class="chain-status-card ${status}">
        <span>${label}</span>
        <strong>${value}</strong>
        <small>${note}</small>
      </article>
    `).join('');
  }

  if ($('publishRuntimeCard')) {
    $('publishRuntimeCard').innerHTML = `
      <div>
        <span>Network</span>
        <strong>${runtimeConfig.network}</strong>
      </div>
      <div>
        <span>Package</span>
        <strong>${runtimeConfig.packageId.includes('TODO') ? 'Publish package first' : shortAddress(runtimeConfig.packageId)}</strong>
      </div>
      <div>
        <span>Walrus</span>
        <strong>${runtimeConfig.walrusPublisherUrl ? 'Ready for browser upload' : 'Configure endpoint'}</strong>
      </div>
      <div>
        <span>Signer</span>
        <strong>${state.walletConnected ? shortAddress(state.walletAddress) || 'Connected' : 'Connect wallet'}</strong>
      </div>
    `;
  }
  renderPublishAction();
}

function renderProtocol() {
  $('protocolSteps').innerHTML = protocolSteps.map(([number, title, body]) => `
    <article class="protocol-card">
      <span>${number}</span>
      <h2>${title}</h2>
      <p>${body}</p>
    </article>
  `).join('');
}

function renderChainActions() {
  document.querySelectorAll('[data-chain-action-list]').forEach((node) => {
    node.innerHTML = chainActions.map((action, index) => `
      <div>
        <span>${String(index + 1).padStart(2, '0')}</span>
        <strong>${action.title}</strong>
        <small>${action.body}</small>
      </div>
    `).join('');
  });
}

async function publishCurrentMaker() {
  if (state.publishing) return;
  state.publishing = true;
  state.publishStatus = 'Uploading PNG layers to Walrus…';
  state.publishDigest = '';
  renderAll();

  try {
    for (let index = 0; index < state.assets.length; index += 1) {
      const asset = state.assets[index];
      if (!asset.file) throw new Error(`${asset.name} is no longer available. Select the PNG files again.`);
      if (!asset.blobId) {
        state.publishStatus = `Uploading layer ${index + 1} of ${state.assets.length}: ${asset.name}`;
        renderPublishAction();
        const stored = await uploadWalrusBlob(asset.file);
        asset.blobId = stored.blobId;
        asset.walrusObjectId = stored.suiObjectId;
      }
    }

    state.publishStatus = 'Uploading the maker manifest to Walrus…';
    renderPublishAction();
    const manifest = creatorManifest();
    const manifestBlob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
    const storedManifest = await uploadWalrusBlob(manifestBlob);

    const assetSlots = [...new Set(state.assets.map((asset) => asset.slot))];
    const makerParts = assetSlots.map((key, index) => {
      const slot = allSlots().find((candidate) => candidate.key === key);
      return {
        key,
        label: slot?.label || key,
        kind: slot?.kind || 'standard',
        renderOrder: allSlots().findIndex((candidate) => candidate.key === key) >= 0
          ? allSlots().findIndex((candidate) => candidate.key === key)
          : index,
        menuVisible: slot?.menuVisible !== false,
        required: index === 0,
      };
    });
    const makerItems = state.assets.map((asset) => ({
      partKey: asset.slot,
      itemKey: asset.partId,
      label: asset.partId.replace(/-/g, ' '),
      blobId: asset.blobId,
      iconBlobId: '',
      gateKind: 0,
    }));
    const makerRules = state.rules.filter((rule) => assetSlots.includes(rule.leftPartKey) && assetSlots.includes(rule.rightPartKey));
    if (makerRules.length !== state.rules.length) {
      throw new Error('Every rule must reference parts that have uploaded PNG items.');
    }

    state.publishStatus = 'Waiting for your Sui wallet signature…';
    renderPublishAction();
    const transaction = await publishMaker({
      creator: {
        displayName: $('creatorName').value.trim(),
        bio: `${$('creatorWorld').value.trim()} OC maker creator`,
        avatarUrl: '',
      },
      maker: {
        name: $('creatorTemplateName').value.trim(),
        description: activeTemplate().summary,
        coverUrl: '',
        license: $('creatorLicense').value,
        royaltyBps: Number($('creatorRoyalty').value || 0),
      },
      manifestBlobId: storedManifest.blobId,
      parts: makerParts,
      items: makerItems,
      rules: makerRules,
    });
    state.publishDigest = transaction.digest;
    state.publishStatus = '';
  } catch (error) {
    console.error('Maker publication failed', error);
    state.publishStatus = error.message || 'Maker publication failed.';
  } finally {
    state.publishing = false;
    renderAll();
  }
}

async function mintCurrentOc() {
  if (state.minting) return;
  state.minting = true;
  state.mintStatus = 'Rendering your OC…';
  state.mintDigest = '';
  renderMintAction();

  try {
    const oc = ocPackage();
    const image = await renderOcImageBlob();
    state.mintStatus = 'Uploading OC image to Walrus…';
    renderMintAction();
    const storedImage = await uploadWalrusBlob(image);

    state.mintStatus = 'Uploading OC profile and recipe to Walrus…';
    renderMintAction();
    const profile = new Blob([JSON.stringify(oc)], { type: 'application/json' });
    const storedProfile = await uploadWalrusBlob(profile);
    const recipeBytes = new TextEncoder().encode(JSON.stringify(oc.recipe));
    const recipeHash = new Uint8Array(await crypto.subtle.digest('SHA-256', recipeBytes));

    state.mintStatus = 'Waiting for your Sui wallet signature…';
    renderMintAction();
    const transaction = await mintCharacter({
      makerId: activeMakerObjectId(),
      name: oc.profile.name,
      profileBlobId: storedProfile.blobId,
      imageBlobId: storedImage.blobId,
      imageUrl: `${runtimeConfig.walrusAggregatorUrl.replace(/\/$/, '')}/v1/blobs/${storedImage.blobId}`,
      recipeHash,
      recipe: oc.recipe.map((slot) => ({
        partKey: slot.slot,
        itemKey: slot.part,
        colorHex: slot.color,
        renderOrder: slot.renderOrder,
      })),
    });
    state.mintDigest = transaction.digest;
    state.mintStatus = '';
  } catch (error) {
    console.error('OC mint failed', error);
    state.mintStatus = error.message || 'OC mint failed.';
  } finally {
    state.minting = false;
    renderMintAction();
  }
}

function restoreMakerDraft() {
  const raw = localStorage.getItem('animacraft-maker-draft-v1');
  if (!raw) return;
  try {
    const draft = JSON.parse(raw);
    if (draft.visual) state.visual = draft.visual;
    if (Array.isArray(draft.rules)) state.rules = draft.rules;
    if (Array.isArray(draft.paletteLinks)) state.paletteLinks = draft.paletteLinks;
    const template = draft.manifest?.template;
    if (template) {
      $('creatorTemplateName').value = template.name || $('creatorTemplateName').value;
      $('creatorName').value = template.creator || $('creatorName').value;
      $('creatorWorld').value = template.style || $('creatorWorld').value;
      $('creatorLicense').value = template.license || $('creatorLicense').value;
      $('creatorRoyalty').value = template.royaltyBps ?? $('creatorRoyalty').value;
    }
  } catch (error) {
    console.warn('Ignored an unreadable local maker draft.', error);
  }
}

function renderAll() {
  syncTemplateFields();
  renderTemplates();
  renderSlots();
  renderParts();
  renderSwatches();
  renderAvatar();
  renderRecipe();
  renderAssets();
  renderChecklist();
  renderRules();
  renderPaletteLinks();
  renderPackage();
  renderImageMakerList();
  renderCreatorDetails();
  renderProtocol();
  renderChainStatus();
  renderChainActions();
  renderMintAction();
  renderI18n();
  renderWalletState();
  setCreatorView(state.creatorView);
  setEditorPanel(state.editorPanel);
}

document.querySelectorAll('[data-page]').forEach((button) => {
  button.addEventListener('click', () => {
    if ($('accountPanel')?.contains(button)) closeAccountPanel();
    setPage(button.dataset.page);
  });
});

$('accountPanel').addEventListener('click', (event) => {
  const navButton = event.target.closest('[data-page]');
  if (!navButton || navButton.disabled) return;
  event.preventDefault();
  event.stopPropagation();
  closeAccountPanel();
  setPage(navButton.dataset.page);
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

$('accountButton').addEventListener('click', () => {
  if ($('accountPanel').classList.contains('active')) closeAccountPanel();
  else openAccountPanel();
});

$('closeAccountPanel').addEventListener('click', closeAccountPanel);
$('walletButton').addEventListener('click', toggleWallet);
$('panelWalletButton').addEventListener('click', toggleWallet);
['accountLanguage'].forEach((id) => {
  $(id)?.addEventListener('change', (event) => setLocale(event.target.value));
});
$('backToMakerList').addEventListener('click', () => {
  setCreatorView('list');
  renderAll();
  focusCreatorTop();
});

document.querySelectorAll('[data-editor-panel-button]').forEach((button) => {
  button.addEventListener('click', () => {
    setEditorPanel(button.dataset.editorPanelButton);
    document.querySelector('.maker-detail-main')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

document.querySelectorAll('[data-new-maker-panel]').forEach((button) => {
  button.addEventListener('click', openMakerModal);
});

document.querySelectorAll('[data-open-part-modal]').forEach((button) => {
  button.addEventListener('click', openPartModal);
});

document.querySelectorAll('[data-filter]').forEach((button) => {
  button.addEventListener('click', () => {
    state.filter = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach((item) => item.classList.toggle('active', item === button));
    renderTemplates();
  });
});

$('templateSearch').addEventListener('input', (event) => {
  state.search = event.target.value;
  renderTemplates();
});

$('partColor').addEventListener('input', (event) => {
  state.visual.palette[activeSlot().colorKey] = event.target.value;
  renderAll();
});

['profileName', 'profileWorld', 'profileDescription', 'profileTags', 'creatorTemplateName', 'creatorName', 'creatorWorld', 'creatorLicense', 'creatorRoyalty'].forEach((id) => {
  $(id).addEventListener('input', renderAll);
});

$('assetUpload').addEventListener('change', (event) => {
  state.assets = [...event.target.files].map((file) => {
    const fileSlug = slug(file.name);
    const slot = allSlots().find((candidate) => fileSlug.startsWith(slug(candidate.key))) || activeSlot();
    const partId = fileSlug.replace(new RegExp(`^${slug(slot.key)}[-_]*`), '') || 'normal';
    return { name: file.name, size: file.size, type: file.type, slot: slot.key, partId, file, blobId: '' };
  });
  renderAll();
});

$('publishMakerOnchain')?.addEventListener('click', publishCurrentMaker);

$('addSelectionRule')?.addEventListener('click', () => {
  const leftPartKey = $('ruleLeftPart').value;
  const rightPartKey = $('ruleRightPart').value;
  if (!leftPartKey || !rightPartKey || leftPartKey === rightPartKey) {
    state.publishStatus = 'Choose two different parts for a selection rule.';
    renderPublishAction();
    return;
  }
  const duplicate = state.rules.some((rule) =>
    (rule.leftPartKey === leftPartKey && rule.rightPartKey === rightPartKey)
    || (rule.leftPartKey === rightPartKey && rule.rightPartKey === leftPartKey));
  if (!duplicate) {
    state.rules.push({ leftPartKey, leftItemKey: '', rightPartKey, rightItemKey: '' });
  }
  renderAll();
});

$('addPaletteLink')?.addEventListener('click', () => {
  const primaryPartKey = $('palettePrimaryPart').value;
  const linkedPartKey = $('paletteLinkedPart').value;
  if (!primaryPartKey || !linkedPartKey || primaryPartKey === linkedPartKey) return;
  const duplicate = state.paletteLinks.some((link) =>
    (link.primaryPartKey === primaryPartKey && link.linkedPartKey === linkedPartKey)
    || (link.primaryPartKey === linkedPartKey && link.linkedPartKey === primaryPartKey));
  if (!duplicate) state.paletteLinks.push({ primaryPartKey, linkedPartKey });
  renderAll();
});

$('saveMakerDraft')?.addEventListener('click', () => {
  const draft = {
    savedAt: new Date().toISOString(),
    manifest: creatorManifest(),
    visual: state.visual,
    rules: state.rules,
    paletteLinks: state.paletteLinks,
  };
  localStorage.setItem('animacraft-maker-draft-v1', JSON.stringify(draft));
  $('saveMakerDraft').textContent = 'Saved';
});

$('downloadManifest').addEventListener('click', () => {
  download(`${slug($('creatorTemplateName').value)}-manifest.json`, JSON.stringify(creatorManifest(), null, 2));
});

$('downloadPackage').addEventListener('click', () => {
  download(`${slug($('profileName').value)}-oc-package.json`, JSON.stringify(ocPackage(), null, 2));
});

$('mintOcOnchain')?.addEventListener('click', mintCurrentOc);

$('downloadRecipe').addEventListener('click', () => {
  download(`${slug($('profileName').value)}-recipe.json`, JSON.stringify(ocPackage().recipe, null, 2));
});

document.querySelectorAll('[data-close-maker-modal]').forEach((button) => {
  button.addEventListener('click', closeMakerModal);
});

document.querySelectorAll('[data-canvas-choice]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-canvas-choice]').forEach((item) => item.classList.toggle('active', item === button));
  });
});

document.querySelectorAll('[data-maker-type]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-maker-type]').forEach((item) => item.classList.toggle('active', item === button));
  });
});

document.querySelectorAll('[data-new-part-type]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-new-part-type]').forEach((item) => item.classList.toggle('active', item === button));
  });
});

$('makerRegistrationModal').addEventListener('click', (event) => {
  if (event.target === $('makerRegistrationModal')) closeMakerModal();
});

$('partRegistrationModal').addEventListener('click', (event) => {
  if (event.target === $('partRegistrationModal')) closePartModal();
});

document.querySelectorAll('[data-close-part-modal]').forEach((button) => {
  button.addEventListener('click', closePartModal);
});

$('registerMaker').addEventListener('click', () => {
  const name = $('newMakerName').value.trim() || 'Untitled OC Maker';
  const canvas = document.querySelector('[data-canvas-choice].active')?.dataset.canvasChoice || '1:1';
  const makerType = document.querySelector('[data-maker-type].active')?.dataset.makerType || 'Free combine';
  const firstPart = $('firstPartName')?.value.trim() || 'Face base';
  const firstPartType = $('firstPartType')?.value || 'standard';
  const firstLayer = $('firstLayerName')?.value.trim() || 'Normal';
  const id = `${slug(name)}-${Date.now().toString(36)}`;
  templates.unshift({
    id,
    name,
    category: 'daily',
    creator: $('creatorName').value || 'xiaopai',
    style: canvas,
    license: 'Personal use',
    royaltyBps: 300,
    price: 'Draft',
    uses: '0',
    works: 0,
    parts: 0,
    accent: '#27c5c8',
    secondary: '#f0a23a',
    summary: `${makerType} maker shell with Maker Top, first ${firstPartType} part "${firstPart}", and "${firstLayer}" layer prepared for asset upload.`,
    licenseNote: 'Draft maker. Configure release and publication before public use.',
  });
  state.templateId = id;
  state.creatorView = 'edit';
  state.editorPanel = 'top';
  $('newMakerName').value = '';
  closeMakerModal();
  renderAll();
  focusCreatorTop();
});

$('registerPart').addEventListener('click', () => {
  const label = $('newPartName').value.trim() || 'New part';
  const key = `${slug(label)}-${Date.now().toString(36)}`;
  const kind = document.querySelector('[data-new-part-type].active')?.dataset.newPartType || 'standard';
  const itemLabel = $('newPartItemName').value.trim() || 'Normal';
  const layerName = $('newPartLayerName').value.trim() || 'Normal';
  const menuVisible = $('newPartMenuVisible').value === 'visible';
  state.customSlots.push({
    key,
    label,
    icon: label.slice(0, 2).toUpperCase(),
    colorKey: 'accessory',
    description: `${kind} part created in Maker Top`,
    kind,
    layerName,
    menuVisible,
    x: 0,
    y: 0,
  });
  state.slotOrder.push(key);
  parts[key] = [{ id: 'normal', label: itemLabel }];
  state.visual[key] = 'normal';
  state.selectedSlot = key;
  state.selectedLayer = key;
  state.selectedItem = 'normal';
  state.partSubView = 'items';
  closePartModal();
  setEditorPanel('parts');
  renderAll();
});

window.addEventListener('hashchange', () => {
  const page = location.hash.replace('#', '') || 'templates';
  if (['templates', 'make', 'creator', 'docs', 'protocol', 'editor'].includes(page)) setPage(page);
});

initializeChain(runtimeConfig, (connection) => {
  state.walletConnected = connection.connected;
  state.walletAddress = connection.address;
  state.walletProvider = connection.provider;
  state.walletStatus = connection.status;
  renderWalletState();
  renderChainStatus();
});

restoreMakerDraft();
renderAll();
setPage(location.hash.replace('#', '') || 'templates');
