import {
  explorerTransactionUrl,
  certifyWalrusUpload,
  initializeChain,
  mintCharacter,
  openWalletSelector,
  prepareWalrusUpload,
  publishMaker,
  registerAndUploadWalrus,
  walrusFileUrl,
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
    source: 'starter',
    name: 'Starlit Daily OC',
    category: 'daily',
    creator: 'Animacraft Lab',
    style: 'Daily icon',
    license: 'Personal use',
    royaltyBps: 300,
    price: 'Free base + paid parts',
    accent: '#7b5cff',
    secondary: '#2db7a3',
    summary: 'A daily OC maker for profile icons, character sheets, and lightweight original characters.',
    licenseNote: 'Generate personal icons and OC profiles. Commercial use requires an add-on license.',
  },
  {
    id: 'fantasy-flower',
    source: 'starter',
    name: 'Flower Familiar',
    category: 'fantasy',
    creator: 'Mori Atelier',
    style: 'Fantasy character',
    license: 'Paid commercial',
    royaltyBps: 500,
    price: 'Creator-set paid template',
    accent: '#2db7a3',
    secondary: '#f0a23a',
    summary: 'A fantasy-friendly maker for spirits, familiars, story characters, and worldbuilding.',
    licenseNote: 'Starter policy example for a paid commercial Maker. Marketplace settlement is not active in this preview.',
  },
  {
    id: 'chibi-idol',
    source: 'starter',
    name: 'Chibi Idol Maker',
    category: 'chibi',
    creator: 'Stage Mint',
    style: 'Chibi idol',
    license: 'Personal use',
    royaltyBps: 250,
    price: 'Free trial parts',
    accent: '#f06f8f',
    secondary: '#f0a23a',
    summary: 'A quick chibi maker for stage characters, fan OCs, and small profile images.',
    licenseNote: 'Personal use by default. Paid parts can unlock limited use or commercial add-ons.',
  },
];

const swatches = ['#7b5cff', '#2db7a3', '#f06f8f', '#f0a23a', '#335c81', '#7d5a50', '#24202b', '#f1c9b1'];

const defaultConfig = {
  network: 'mainnet',
  rpcUrl: 'https://fullnode.mainnet.sui.io:443',
  packageId: '0xTODO_ANIMACRAFT_PACKAGE',
  walrusAggregatorUrl: 'https://aggregator.walrus-mainnet.walrus.space',
  walrusUploadRelayUrl: 'https://upload-relay.mainnet.walrus.space',
  walrusRelayMaxTipMist: 1_000_000,
  walrusEpochs: 2,
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
    body: 'Stage item PNGs, optional picker icons, Maker manifests, finished OC images, and profile JSON as quilt patches.',
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
    templateHeroCopy: 'Choose a maker, combine Parts, and save a character with its recipe, license snapshot, provenance, and on-chain record.',
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
    templateHeroCopy: '选择模板、组合部件，并将角色连同配方、授权快照、来源与链上记录一起保存。',
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
    templateHeroCopy: 'メーカーを選び、パーツを組み合わせ、レシピ、ライセンスのスナップショット、来歴、オンチェーン記録と共にキャラクターを保存します。',
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
    templateHeroCopy: '메이커를 선택하고 파츠를 조합한 뒤 레시피, 라이선스 스냅샷, 출처, 온체인 기록과 함께 캐릭터를 저장합니다.',
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
    templateHeroCopy: 'Chọn maker, ghép Part và lưu nhân vật cùng công thức, bản chụp giấy phép, nguồn gốc và bản ghi on-chain.',
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
  ['05', 'License Snapshot', 'Each finished OC preserves the Maker license kind and royalty basis points; marketplace settlement is handled by a separate adapter.'],
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
  partSubView: 'items',
  selectedLayer: 'hairFront:normal',
  selectedItem: 'normal',
  makerCanvas: { width: 1024, height: 1024 },
  makerSlots: structuredClone(slots),
  makerParts: structuredClone(parts),
  slotOrder: slots.map((slot) => slot.key),
  layerOrder: [],
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
  walletConnected: false,
  walletAddress: '',
  walletProvider: null,
  walletStatus: 'disconnected',
  chainMode: runtimeConfig.packageId.includes('TODO') ? 'draft' : 'live',
  publishing: false,
  publishStatus: '',
  publishDigest: '',
  makerUploadSession: null,
  pendingMakerAssets: [],
  makerUploadStage: 'idle',
  makerManifestPatchId: '',
  pendingMakerManifestJson: '',
  minting: false,
  mintStatus: '',
  mintDigest: '',
  ocUploadSession: null,
  ocUploadStage: 'idle',
  ocImagePatchId: '',
  ocProfilePatchId: '',
  pendingOcPackage: null,
  pendingOcRecipeHash: null,
  pendingOcRecipeJson: '',
  previewingMaker: false,
  locale: localStorage.getItem('animacraft-locale') || 'en',
};

const makerModels = new Map();
const loadedMakerDrafts = new Set();

function makerDraftStorageKey(templateId = state.templateId) {
  return `animacraft-maker-draft-v2:${state.walletAddress || 'local'}:${templateId}`;
}

function defaultMakerVisual() {
  return structuredClone({
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
  });
}

function createMakerModel({ empty = false, canvas = { width: 1024, height: 1024 } } = {}) {
  return {
    canvas: { ...canvas },
    slots: empty ? [] : structuredClone(slots),
    parts: empty ? {} : structuredClone(parts),
    slotOrder: empty ? [] : slots.map((slot) => slot.key),
    layerOrder: [],
    visual: defaultMakerVisual(),
    rules: [],
    paletteLinks: empty ? [] : [{ primaryPartKey: 'hairBack', linkedPartKey: 'hairFront' }],
    assets: [],
    publishDigest: '',
    publishStatus: '',
  };
}

function syncActiveMakerModelRefs() {
  const model = makerModels.get(state.templateId);
  if (!model) return;
  Object.assign(model, {
    slots: state.makerSlots,
    canvas: state.makerCanvas,
    parts: state.makerParts,
    slotOrder: state.slotOrder,
    layerOrder: state.layerOrder,
    visual: state.visual,
    rules: state.rules,
    paletteLinks: state.paletteLinks,
    assets: state.assets,
    publishDigest: state.publishDigest,
    publishStatus: state.publishStatus,
  });
}

function activateMakerModel(templateId, options = {}) {
  syncActiveMakerModelRefs();
  if (!makerModels.has(templateId)) makerModels.set(templateId, createMakerModel(options));
  const model = makerModels.get(templateId);
  state.templateId = templateId;
  state.makerCanvas = model.canvas;
  state.makerSlots = model.slots;
  state.makerParts = model.parts;
  state.slotOrder = model.slotOrder;
  state.layerOrder = model.layerOrder;
  state.visual = model.visual;
  state.rules = model.rules;
  state.paletteLinks = model.paletteLinks;
  state.assets = model.assets;
  state.publishDigest = model.publishDigest;
  state.publishStatus = model.publishStatus;
  state.makerUploadSession = null;
  state.pendingMakerAssets = [];
  state.makerUploadStage = 'idle';
  state.makerManifestPatchId = '';
  state.pendingMakerManifestJson = '';
  state.selectedSlot = state.slotOrder[0] || '';
  state.selectedItem = state.selectedSlot ? state.visual[state.selectedSlot] || slotItems(state.selectedSlot)[0]?.id || '' : '';
  const firstLayer = state.selectedSlot ? creatorLayers(allSlots()[0])[0] : null;
  state.selectedLayer = firstLayer ? creatorLayerKey(state.selectedSlot, firstLayer.id) : '';
  state.partSubView = 'items';
  if (!loadedMakerDrafts.has(makerDraftStorageKey(templateId))) restoreMakerDraft(templateId);
}

makerModels.set(state.templateId, {
  canvas: state.makerCanvas,
  slots: state.makerSlots,
  parts: state.makerParts,
  slotOrder: state.slotOrder,
  layerOrder: state.layerOrder,
  visual: state.visual,
  rules: state.rules,
  paletteLinks: state.paletteLinks,
  assets: state.assets,
  publishDigest: state.publishDigest,
  publishStatus: state.publishStatus,
});

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
  return allSlots().find((slot) => slot.key === state.selectedSlot) || allSlots()[0] || null;
}

function allSlots() {
  const merged = state.makerSlots;
  const byKey = new Map(merged.map((slot) => [slot.key, slot]));
  const ordered = state.slotOrder.map((key) => byKey.get(key)).filter(Boolean);
  const missing = merged.filter((slot) => !state.slotOrder.includes(slot.key));
  return [...ordered, ...missing];
}

function playableSlots() {
  return allSlots().filter((slot) => slot.menuVisible !== false);
}

function slotItems(slotKey) {
  return state.makerParts[slotKey] || [];
}

function ensureSlotStructure(slot) {
  slot.colorKey ||= slot.key;
  if (!slot.kind) slot.kind = 'standard';
  if (!Array.isArray(slot.layers) || slot.layers.length === 0) {
    if (slot.kind === 'left-right-pair') {
      slot.layers = [
        { id: 'left', name: 'Left', x: slot.x || 0, y: slot.y || 0, opacity: 100, blendMode: 'normal' },
        { id: 'right', name: 'Right', x: slot.rightX || 0, y: slot.y || 0, opacity: 100, blendMode: 'normal' },
      ];
    } else {
      slot.layers = [{ id: 'normal', name: slot.layerName || 'Normal', x: slot.x || 0, y: slot.y || 0, opacity: 100, blendMode: 'normal' }];
    }
  }
  if (!Array.isArray(slot.colors) || slot.colors.length === 0) {
    slot.colors = [{ id: 'default', name: 'Default', value: state.visual.palette[slot.colorKey] || '#7b5cff' }];
  }
  state.visual.palette[slot.colorKey] ||= slot.colors[0]?.value || '#7b5cff';
  slotItems(slot.key).forEach((item, index) => {
    item.displayOrder ??= index + 1;
    item.visibility ??= 'public';
    item.images ||= {};
    item.iconAsset ||= null;
  });
  return slot;
}

function creatorLayers(slot) {
  return ensureSlotStructure(slot).layers;
}

function creatorColors(slot) {
  return ensureSlotStructure(slot).colors;
}

function creatorLayerKey(partKey, layerId) {
  return `${partKey}:${layerId}`;
}

function allCreatorLayers() {
  const layers = allSlots().flatMap((slot) => creatorLayers(slot).map((layer) => ({
    ...layer,
    partKey: slot.key,
    partLabel: slot.label,
    key: creatorLayerKey(slot.key, layer.id),
  })));
  const byKey = new Map(layers.map((layer) => [layer.key, layer]));
  const ordered = state.layerOrder.map((key) => byKey.get(key)).filter(Boolean);
  const missing = layers.filter((layer) => !state.layerOrder.includes(layer.key));
  if (missing.length) state.layerOrder.push(...missing.map((layer) => layer.key));
  return [...ordered, ...missing];
}

function selectedLayerRecord() {
  return allCreatorLayers().find((layer) => layer.key === state.selectedLayer) || allCreatorLayers()[0];
}

function assetCellKey(layerId, colorId) {
  return `${layerId}:${colorId}`;
}

function uploadedAssetCount(slot) {
  return slotItems(slot.key).reduce((count, item) => count + Object.values(item.images || {}).filter((asset) => asset?.file).length, 0);
}

function itemLayerAssets() {
  return state.assets.filter((asset) => asset.kind === 'item-layer');
}

function syncCreatorAssets() {
  state.assets = allSlots().flatMap((slot) => {
    const partIcon = slot.iconAsset?.file ? [{
      ...slot.iconAsset,
      name: slot.iconAsset.file.name,
      size: slot.iconAsset.file.size,
      type: slot.iconAsset.file.type,
      kind: 'part-icon',
      slot: slot.key,
      partId: '',
      itemId: '',
      layerId: '',
      colorId: '',
      identifier: `${slug(slot.key)}-part-icon.${slot.iconAsset.file.type === 'image/jpeg' ? 'jpg' : 'png'}`,
    }] : [];
    const itemAssets = slotItems(slot.key).flatMap((item) => {
      const icon = item.iconAsset?.file ? [{
        ...item.iconAsset,
        name: item.iconAsset.file.name,
        size: item.iconAsset.file.size,
        type: item.iconAsset.file.type,
        kind: 'item-icon',
        slot: slot.key,
        partId: item.id,
        itemId: item.id,
        layerId: '',
        colorId: '',
        identifier: `${slug(slot.key)}-${slug(item.id)}-icon.${item.iconAsset.file.type === 'image/jpeg' ? 'jpg' : 'png'}`,
      }] : [];
      const images = Object.entries(item.images || {}).flatMap(([cellKey, asset]) => {
        if (!asset?.file) return [];
        const [layerId, colorId] = cellKey.split(':');
        return [{
          ...asset,
          name: asset.file.name,
          size: asset.file.size,
          type: asset.file.type,
          kind: 'item-layer',
          slot: slot.key,
          partId: item.id,
          itemId: item.id,
          layerId,
          colorId,
          identifier: `${slug(slot.key)}-${slug(item.id)}-${slug(layerId)}-${slug(colorId)}.png`,
        }];
      });
      return [...icon, ...images];
    });
    return [...partIcon, ...itemAssets];
  });
}

function invalidateMakerUpload(message = '') {
  state.makerUploadSession = null;
  state.pendingMakerAssets = [];
  state.makerUploadStage = 'idle';
  state.makerManifestPatchId = '';
  state.pendingMakerManifestJson = '';
  state.publishDigest = '';
  state.publishStatus = message;
}

async function localPngAsset(file) {
  if (!file || (file.type !== 'image/png' && !file.name.toLowerCase().endsWith('.png'))) {
    throw new Error('Item images must be transparent PNG files.');
  }
  if (file.size > 20 * 1024 * 1024) throw new Error('Each Item image must be 20 MB or smaller.');
  const bitmap = await createImageBitmap(file);
  if (bitmap.width > 8192 || bitmap.height > 8192) {
    bitmap.close();
    throw new Error('Item images cannot exceed 8192 × 8192 px.');
  }
  const asset = {
    file,
    url: URL.createObjectURL(file),
    width: bitmap.width,
    height: bitmap.height,
    warning: bitmap.width < 600 || bitmap.height < 600 ? 'Below the recommended 600 × 600 px.' : '',
  };
  bitmap.close();
  return asset;
}

async function localIconAsset(file) {
  if (!file || !['image/png', 'image/jpeg'].includes(file.type)) throw new Error('Icons must be PNG or JPEG files.');
  if (file.size > 5 * 1024 * 1024) throw new Error('Icons must be 5 MB or smaller.');
  const bitmap = await createImageBitmap(file);
  if (bitmap.width > 4096 || bitmap.height > 4096) {
    bitmap.close();
    throw new Error('Icons cannot exceed 4096 × 4096 px.');
  }
  const asset = { file, url: URL.createObjectURL(file), width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return asset;
}

function slug(value) {
  return String(value)
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'part';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character]);
}

function safeCssColor(value, fallback = '#27c5c8') {
  const color = String(value || '').trim();
  return /^(#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([\d\s.,%+-]+\))$/i.test(color) ? color : fallback;
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
  const walrusReady = Boolean(runtimeConfig.walrusUploadRelayUrl && runtimeConfig.walrusAggregatorUrl);
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
    if (template.source === 'local') return false;
    const matchesFilter = state.filter === 'all' || template.category === state.filter;
    const haystack = `${template.name} ${template.creator} ${template.style} ${template.license} ${template.summary}`.toLowerCase();
    return matchesFilter && (!query || haystack.includes(query));
  });
}

function setPage(page) {
  state.page = page === 'editor' ? 'make' : page === 'protocol' ? 'docs' : page;
  if (state.page === 'make') {
    const playable = playableSlots();
    if (!playable.some((slot) => slot.key === state.selectedSlot)) state.selectedSlot = playable[0]?.key || '';
  }
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
  document.querySelector('.maker-list-panel')?.classList.toggle('editing', state.creatorView === 'edit');
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
    parts: 'Character Maker',
    rules: 'Rules',
    palette: 'Palette Rules',
    preview: 'Preview Check',
    publish: 'On-chain Publish',
    settings: 'Settings',
  };
  if ($('editingPanelKicker')) $('editingPanelKicker').textContent = labels[state.editorPanel] || 'Character Maker';
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
  $('creatorLicense').value = Object.entries({
    'personal-use': 'Personal use',
    'free-remix': 'Free remix',
    'paid-commercial': 'Paid commercial',
    'exclusive-commission': 'Exclusive commission',
  }).find(([, label]) => label === template.license)?.[0] || 'personal-use';
  $('profileWorld').value = template.style;
  $('templateTitle').textContent = template.name;
  $('avatarTemplate').textContent = template.name;
  $('licenseTitle').textContent = template.license;
  $('licenseDescription').textContent = template.licenseNote;
}

function renderTemplates() {
  const list = filteredTemplates();
  $('templateGrid').innerHTML = list.length ? list.map((template) => `
    <article class="template-card ${template.id === state.templateId ? 'active' : ''}" data-template="${escapeHtml(template.id)}">
      <div class="template-cover" style="--accent:${safeCssColor(template.accent)}; --secondary:${safeCssColor(template.secondary, '#f0a23a')};">
        <div class="cover-face">
          <span class="cover-hair"></span>
          <span class="cover-eye left"></span>
          <span class="cover-eye right"></span>
          <span class="cover-mouth"></span>
        </div>
        <span class="cover-style">${escapeHtml(template.style)}</span>
      </div>
      <div class="template-body">
        <div class="badge-row">
          <span>Starter example</span>
          <span>${escapeHtml(template.license)}</span>
          <span>${slots.length} Parts</span>
          <span>${Object.values(parts).reduce((total, items) => total + items.length, 0)} Items</span>
        </div>
        <h2>${escapeHtml(template.name)}</h2>
        <p class="creator-line">by ${escapeHtml(template.creator)}</p>
        <p>${escapeHtml(template.summary)}</p>
        <div class="sample-strip" aria-label="${escapeHtml(template.name)} samples">
          ${[1, 2, 3, 4].map((item) => `<span style="--tilt:${item * 3}deg; --accent:${safeCssColor(template.accent)}; --secondary:${safeCssColor(template.secondary, '#f0a23a')};"></span>`).join('')}
        </div>
        <div class="template-footer">
          <span>${Number(template.royaltyBps || 0) / 100}% royalty policy</span>
          <button class="primary" data-use-template="${escapeHtml(template.id)}">Start making</button>
        </div>
      </div>
    </article>
  `).join('') : '<div class="empty-state">No matching makers found.</div>';

  document.querySelectorAll('.template-card').forEach((card) => {
    card.addEventListener('click', (event) => {
      if (event.target.closest('[data-use-template]')) return;
      activateMakerModel(card.dataset.template);
      syncTemplateFields();
      renderAll();
    });
  });

  document.querySelectorAll('[data-use-template]').forEach((button) => {
    button.addEventListener('click', () => {
      activateMakerModel(button.dataset.useTemplate);
      syncTemplateFields();
      state.previewingMaker = false;
      setPage('make');
      renderAll();
    });
  });
}

function renderSlots() {
  $('slotRail').innerHTML = playableSlots().map((slot) => `
    <button class="slot-btn ${slot.key === state.selectedSlot ? 'active' : ''}" data-slot="${escapeHtml(slot.key)}">
      <span>${escapeHtml(slot.icon)}</span>
      <strong>${escapeHtml(slot.label)}</strong>
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
  if (!slot) {
    $('slotTitle').textContent = 'No Parts yet';
    $('slotDescription').textContent = 'Create the first Part in Character Maker.';
    $('partGrid').innerHTML = '';
    return;
  }
  $('slotTitle').textContent = slot.label;
  $('slotDescription').textContent = slot.description;
  const publicItems = slotItems(slot.key).filter((item) => item.visibility !== 'private').sort((left, right) => left.displayOrder - right.displayOrder);
  if (state.visual[slot.key] && !publicItems.some((item) => item.id === state.visual[slot.key])) {
    state.visual[slot.key] = slot.defaultItemId && publicItems.some((item) => item.id === slot.defaultItemId) ? slot.defaultItemId : publicItems[0]?.id || '';
  }
  $('partColor').value = safeCssColor(state.visual.palette[slot.colorKey]);
  $('partColor').disabled = uploadedAssetCount(slot) > 0;
  const removeOption = slot.allowRemove !== false ? `
    <button class="part-card ${state.visual[slot.key] ? '' : 'active'}" data-part="">
      <span class="part-thumb empty-thumb">×</span>
      <strong>None</strong>
      <small>Remove this Part</small>
    </button>
  ` : '';
  $('partGrid').innerHTML = removeOption + publicItems.map((part, index) => `
    <button class="part-card ${state.visual[slot.key] === part.id ? 'active' : ''}" data-part="${escapeHtml(part.id)}" ${selectionWouldBreakRule(slot.key, part.id) ? 'disabled title="Unavailable with the current selection"' : ''}>
      <span class="part-thumb" style="--accent:${safeCssColor(state.visual.palette[slot.colorKey])}; --index:${index};"></span>
      <strong>${escapeHtml(part.label)}</strong>
      <small>${escapeHtml(slot.key)}/${escapeHtml(part.id)}</small>
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
  if (!slot) {
    $('swatchGrid').innerHTML = '';
    return;
  }
  const makerColors = creatorColors(slot).map((color) => color.value);
  const choices = uploadedAssetCount(slot) ? makerColors : swatches;
  $('swatchGrid').innerHTML = choices.map((color) => `
    <button class="swatch ${state.visual.palette[slot.colorKey] === color ? 'active' : ''}" data-swatch="${color}" style="background:${color}" aria-label="Use ${color}"></button>
  `).join('');
  document.querySelectorAll('[data-swatch]').forEach((button) => {
    button.addEventListener('click', () => {
      applyPaletteColor(slot, button.dataset.swatch);
      renderAll();
    });
  });
}

function applyPaletteColor(slot, color) {
  state.visual.palette[slot.colorKey] = color;
  state.paletteLinks.filter((link) => link.primaryPartKey === slot.key || link.linkedPartKey === slot.key).forEach((link) => {
    const linkedKey = link.primaryPartKey === slot.key ? link.linkedPartKey : link.primaryPartKey;
    const linkedSlot = allSlots().find((candidate) => candidate.key === linkedKey);
    if (linkedSlot) state.visual.palette[linkedSlot.colorKey] = color;
  });
}

function renderAvatar() {
  const palette = state.visual.palette;
  const avatar = $('avatar');
  avatar.style.aspectRatio = `${state.makerCanvas.width} / ${state.makerCanvas.height}`;
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
  renderPlayerLayerAssets();
}

function selectionWouldBreakRule(partKey, itemId) {
  const selection = { ...state.visual, [partKey]: itemId };
  return state.rules.some((rule) => {
    const leftItem = selection[rule.leftPartKey];
    const rightItem = selection[rule.rightPartKey];
    const leftSelected = Boolean(leftItem) && (!rule.leftItemKey || leftItem === rule.leftItemKey);
    const rightSelected = Boolean(rightItem) && (!rule.rightItemKey || rightItem === rule.rightItemKey);
    return leftSelected && rightSelected;
  });
}

function renderPlayerLayerAssets() {
  if (!$('playerLayerAssets')) return;
  const images = allCreatorLayers().flatMap((layer) => {
    const item = slotItems(layer.partKey).find((candidate) => candidate.id === state.visual[layer.partKey] && candidate.visibility !== 'private');
    if (!item) return [];
    const slot = allSlots().find((candidate) => candidate.key === layer.partKey);
    const colors = creatorColors(slot);
    const selectedColor = colors.find((color) => color.value.toLowerCase() === String(state.visual.palette[slot.colorKey] || '').toLowerCase()) || colors[0];
    const asset = selectedColor ? item.images?.[assetCellKey(layer.id, selectedColor.id)] : null;
    return asset?.url ? [{ layer, asset }] : [];
  });
  $('playerLayerAssets').innerHTML = images.map(({ layer, asset }) => `
    <img src="${asset.url}" alt="${escapeHtml(layer.partLabel)} ${escapeHtml(layer.name)}" style="--layer-x:${layer.x || 0};--layer-y:${layer.y || 0};opacity:${(layer.opacity ?? 100) / 100};mix-blend-mode:${layer.blendMode || 'normal'}" />
  `).join('');
  $('avatar').classList.toggle('has-layer-assets', images.length > 0);
}

function renderRecipe() {
  $('recipeList').innerHTML = playableSlots().map((slot) => {
    const selected = slotItems(slot.key).find((part) => part.id === state.visual[slot.key]);
    return `<button data-slot="${slot.key}">${escapeHtml(slot.label)}: ${escapeHtml(selected ? selected.label : 'None')}</button>`;
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
    schemaVersion: 'animacraft.creator-template.v2',
    template: {
      id: slug($('creatorTemplateName').value),
      name: $('creatorTemplateName').value,
      creator: $('creatorName').value,
      style: $('creatorWorld').value,
      license: $('creatorLicense').value,
      royaltyBps: Number($('creatorRoyalty').value || 0),
      storage: 'walrus',
      chain: 'sui',
      canvas: {
        width: state.makerCanvas.width,
        height: state.makerCanvas.height,
        anchorX: Math.round(state.makerCanvas.width / 2),
        anchorY: Math.round(state.makerCanvas.height / 2),
      },
    },
    runtime: {
      network: runtimeConfig.network,
      packageId: runtimeConfig.packageId,
      walrusAggregatorUrl: runtimeConfig.walrusAggregatorUrl,
      walrusUploadRelayUrl: runtimeConfig.walrusUploadRelayUrl,
      appUrl: runtimeConfig.appUrl,
    },
    parts: allSlots().map((slot) => ({
      key: slot.key,
      label: slot.label,
      kind: slot.kind,
      menuVisible: slot.menuVisible !== false,
      allowRemove: slot.allowRemove !== false,
      defaultItemId: slot.defaultItemId || slotItems(slot.key)[0]?.id || '',
      anchor: { x: slot.x || 0, y: slot.y || 0, rightX: slot.rightX || 0 },
      controls: {
        moveX: Boolean(slot.allowMoveX),
        moveY: Boolean(slot.allowMoveY),
        scale: Boolean(slot.allowScale),
        rotate: Boolean(slot.allowRotate),
        pairedSpacing: Boolean(slot.allowSpacing),
        spacingStep: slot.spacingStep || 0,
        spacingSteps: slot.spacingSteps || 0,
      },
      iconIdentifier: slot.iconAsset?.file ? `${slug(slot.key)}-part-icon.${slot.iconAsset.file.type === 'image/jpeg' ? 'jpg' : 'png'}` : '',
      layers: creatorLayers(slot).map((layer) => ({
        id: layer.id,
        name: layer.name,
        renderOrder: allCreatorLayers().findIndex((candidate) => candidate.key === creatorLayerKey(slot.key, layer.id)),
        x: layer.x || 0,
        y: layer.y || 0,
        opacity: layer.opacity ?? 100,
        blendMode: layer.blendMode || 'normal',
      })),
      colors: creatorColors(slot),
      items: slotItems(slot.key).map((item) => ({
        id: item.id,
        label: item.label,
        displayOrder: item.displayOrder,
        visibility: item.visibility,
        iconIdentifier: item.iconAsset?.file ? `${slug(slot.key)}-${slug(item.id)}-icon.${item.iconAsset.file.type === 'image/jpeg' ? 'jpg' : 'png'}` : '',
        images: Object.keys(item.images || {}).filter((key) => item.images[key]?.file).map((key) => {
          const [layerId, colorId] = key.split(':');
          return { layerId, colorId, identifier: `${slug(slot.key)}-${slug(item.id)}-${slug(layerId)}-${slug(colorId)}.png` };
        }),
      })),
    })),
    rules: state.rules,
    paletteLinks: state.paletteLinks,
    assets: state.assets.map(({ name, size, type, kind, slot, partId, itemId, layerId, colorId, identifier = '', patchId = '', blobId = '' }) => ({
      name,
      size,
      type,
      kind,
      slot,
      partId,
      itemId,
      layerId,
      colorId,
      identifier,
      patchId,
      blobId,
    })),
  };
}

function creatorUploadManifest() {
  const manifest = creatorManifest();
  manifest.parts = manifest.parts.map((part) => {
    const publicItems = part.items.filter((item) => item.visibility !== 'private');
    return {
      ...part,
      defaultItemId: publicItems.some((item) => item.id === part.defaultItemId) ? part.defaultItemId : publicItems[0]?.id || '',
      items: publicItems,
    };
  });
  manifest.assets = publishableAssets().map(({ name, size, type, kind, slot, partId, itemId, layerId, colorId, identifier = '' }) => ({
    name,
    size,
    type,
    kind,
    slot,
    partId,
    itemId,
    layerId,
    colorId,
    identifier,
    patchId: '',
    blobId: '',
  }));
  return manifest;
}

function publishableAssets() {
  return state.assets.filter((asset) => {
    if (!asset.itemId) return true;
    return slotItems(asset.slot).some((item) => item.id === asset.itemId && item.visibility !== 'private');
  });
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
    })).filter((entry) => entry.part && slotItems(entry.slot).some((item) => item.id === entry.part && item.visibility !== 'private')),
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

function renderChecklist() {
  const layerAssets = itemLayerAssets();
  const checks = [
    ['Maker metadata', $('creatorTemplateName').value.trim() && $('creatorName').value.trim()],
    ['Standard slots', allSlots().length >= 7],
    ['License rules', Number($('creatorRoyalty').value || 0) >= 0],
    ['Item layer images', layerAssets.length > 0],
    ['OC preview', Boolean($('profileName').value.trim())],
  ];
  $('creatorChecklist').innerHTML = checks.map(([label, done]) => `
    <div class="${done ? 'done' : ''}">
      <span>${done ? 'OK' : 'WAIT'}</span>
      <strong>${label}</strong>
    </div>
  `).join('');
}

function selectionRuleSideLabel(partKey, itemKey) {
  const slot = allSlots().find((candidate) => candidate.key === partKey);
  const partLabel = slot?.label || partKey;
  if (!itemKey) return `${partLabel} / any Item`;
  const item = slotItems(partKey).find((candidate) => candidate.id === itemKey);
  return `${partLabel} / ${item?.label || itemKey}`;
}

function selectionRuleIssue(rule) {
  for (const [partKey, itemKey] of [[rule.leftPartKey, rule.leftItemKey], [rule.rightPartKey, rule.rightItemKey]]) {
    const slot = allSlots().find((candidate) => candidate.key === partKey);
    if (!slot) return 'A selection rule references a missing Part.';
    if (itemKey) {
      const item = slotItems(partKey).find((candidate) => candidate.id === itemKey);
      if (!item || item.visibility === 'private') return 'A selection rule references a missing or private Item.';
    }
  }
  return '';
}

function renderRuleItemOptions(selectId, partKey, preferredValue = '') {
  const select = $(selectId);
  if (!select) return;
  const items = slotItems(partKey).filter((item) => item.visibility !== 'private');
  select.innerHTML = `<option value="">Any Item in this Part</option>${items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`).join('')}`;
  select.value = items.some((item) => item.id === preferredValue) ? preferredValue : '';
  select.disabled = items.length === 0;
}

function makerPublicationIssues() {
  const issues = [];
  const makerParts = allSlots();
  if (!makerParts.length) issues.push('Add at least one Part.');
  if (makerParts.length > 750) issues.push('A Maker cannot contain more than 750 Parts.');
  if (makerParts.length && !makerParts.some((slot) => slot.menuVisible !== false)) issues.push('At least one Part must be visible in the player menu.');
  makerParts.forEach((slot) => {
    const items = slotItems(slot.key);
    const layers = creatorLayers(slot);
    const colors = creatorColors(slot);
    if (!items.length) issues.push(`${slot.label} needs at least one Item.`);
    if (items.length && !items.some((item) => item.visibility !== 'private')) issues.push(`${slot.label} needs at least one published Item.`);
    if (!layers.length) issues.push(`${slot.label} needs at least one Layer.`);
    if (!colors.length) issues.push(`${slot.label} needs at least one Color.`);
    if (new Set(items.map((item) => item.id)).size !== items.length) issues.push(`${slot.label} contains duplicate Item IDs.`);
    if (new Set(layers.map((layer) => layer.id)).size !== layers.length) issues.push(`${slot.label} contains duplicate Layer IDs.`);
    if (new Set(colors.map((color) => color.id)).size !== colors.length) issues.push(`${slot.label} contains duplicate Color IDs.`);
    items.filter((item) => item.visibility !== 'private').forEach((item) => {
      const missingCells = layers.flatMap((layer) => colors.filter((color) => !item.images?.[assetCellKey(layer.id, color.id)]?.file));
      if (missingCells.length) issues.push(`${slot.label} / ${item.label} needs ${missingCells.length} more PNG image${missingCells.length === 1 ? '' : 's'}.`);
    });
  });
  state.rules.forEach((rule) => {
    const issue = selectionRuleIssue(rule);
    if (issue) issues.push(issue);
  });
  const royaltyBps = Number($('creatorRoyalty').value || 0);
  if (!Number.isInteger(royaltyBps) || royaltyBps < 0 || royaltyBps > 10_000) issues.push('Royalty BPS must be an integer from 0 to 10000.');
  return [...new Set(issues)];
}

function renderCreatorValidation() {
  if (!$('creatorValidationList')) return;
  const structuredParts = allSlots().filter((slot) => ['standard', 'left-right-pair', 'last-bastion'].includes(ensureSlotStructure(slot).kind));
  const visibleParts = structuredParts.filter((slot) => slot.menuVisible !== false);
  const publicItems = structuredParts.flatMap((slot) => slotItems(slot.key).filter((item) => item.visibility !== 'private').map((item) => ({ slot, item })));
  const missingCells = publicItems.reduce((total, { slot, item }) => total + creatorLayers(slot).reduce((layerTotal, layer) => layerTotal + creatorColors(slot).filter((color) => !item.images?.[assetCellKey(layer.id, color.id)]?.file).length, 0), 0);
  const invalidRules = state.rules.filter((rule) => selectionRuleIssue(rule));
  const checks = [
    [structuredParts.length > 0, 'At least one valid Part is registered.'],
    [visibleParts.length > 0, 'At least one Part is visible in the player menu.'],
    [missingCells === 0, missingCells ? `${missingCells} required Layer × Color PNG cells are still empty.` : 'Every public Item has all required PNG images.'],
    [invalidRules.length === 0, invalidRules.length ? `${invalidRules.length} rules reference unavailable Parts or Items.` : 'All selection rules reference available Parts and Items.'],
    [itemLayerAssets().length > 0, itemLayerAssets().length ? `${itemLayerAssets().length} item images are ready for the Walrus quilt.` : 'Upload at least one Item image before release.'],
  ];
  $('creatorValidationList').innerHTML = checks.map(([done, label]) => `<li class="${done ? 'ok' : 'warn'}">${escapeHtml(label)}</li>`).join('');
}

function renderRules() {
  if (!$('ruleLeftPart') || !$('ruleRightPart') || !$('ruleLeftItem') || !$('ruleRightItem')) return;
  const options = allSlots().map((slot) => `<option value="${escapeHtml(slot.key)}">${escapeHtml(slot.label)}</option>`).join('');
  const previousLeft = $('ruleLeftPart').value;
  const previousRight = $('ruleRightPart').value;
  const previousLeftItem = $('ruleLeftItem').value;
  const previousRightItem = $('ruleRightItem').value;
  $('ruleLeftPart').innerHTML = options;
  $('ruleRightPart').innerHTML = options;
  $('ruleLeftPart').value = previousLeft || allSlots()[0]?.key || '';
  $('ruleRightPart').value = previousRight || allSlots()[1]?.key || allSlots()[0]?.key || '';
  renderRuleItemOptions('ruleLeftItem', $('ruleLeftPart').value, previousLeftItem);
  renderRuleItemOptions('ruleRightItem', $('ruleRightPart').value, previousRightItem);
  $('selectionRuleList').innerHTML = state.rules.length
    ? state.rules.map((rule, index) => `
        <div>
          <span>${escapeHtml(selectionRuleSideLabel(rule.leftPartKey, rule.leftItemKey))}</span>
          <b>cannot combine with</b>
          <span>${escapeHtml(selectionRuleSideLabel(rule.rightPartKey, rule.rightItemKey))}</span>
          <button type="button" data-remove-rule="${index}" aria-label="Remove rule">×</button>
        </div>
      `).join('')
    : '<p>No selection rules yet.</p>';
  document.querySelectorAll('[data-remove-rule]').forEach((button) => {
    button.addEventListener('click', () => {
      state.rules.splice(Number(button.dataset.removeRule), 1);
      invalidateMakerUpload();
      renderAll();
    });
  });
}

function renderPaletteLinks() {
  if (!$('palettePrimaryPart') || !$('paletteLinkedPart')) return;
  const options = allSlots().map((slot) => `<option value="${escapeHtml(slot.key)}">${escapeHtml(slot.label)}</option>`).join('');
  const previousPrimary = $('palettePrimaryPart').value;
  const previousLinked = $('paletteLinkedPart').value;
  $('palettePrimaryPart').innerHTML = options;
  $('paletteLinkedPart').innerHTML = options;
  $('palettePrimaryPart').value = previousPrimary || 'hairBack';
  $('paletteLinkedPart').value = previousLinked || 'hairFront';
  $('paletteLinkList').innerHTML = state.paletteLinks.length
    ? state.paletteLinks.map((link, index) => `
        <div>
          <span>${escapeHtml(allSlots().find((slot) => slot.key === link.primaryPartKey)?.label || link.primaryPartKey)}</span>
          <b>shares palette with</b>
          <span>${escapeHtml(allSlots().find((slot) => slot.key === link.linkedPartKey)?.label || link.linkedPartKey)}</span>
          <button type="button" data-remove-palette-link="${index}" aria-label="Remove palette link">×</button>
        </div>
      `).join('')
    : '<p>No linked palettes yet.</p>';
  document.querySelectorAll('[data-remove-palette-link]').forEach((button) => {
    button.addEventListener('click', () => {
      state.paletteLinks.splice(Number(button.dataset.removePaletteLink), 1);
      invalidateMakerUpload();
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
  return 'Prepare the OC quilt, register and upload it, certify it, then mint on Sui Mainnet.';
}

function renderMintAction() {
  if (!$('mintOcOnchain')) return;
  const baseReady = !runtimeConfig.packageId.includes('TODO') && Boolean(activeMakerObjectId()) && state.walletConnected;
  $('prepareOcUpload').disabled = state.minting || !baseReady || state.ocUploadStage !== 'idle';
  $('registerOcUpload').disabled = state.minting || !state.walletConnected || !['encoded', 'registered'].includes(state.ocUploadStage);
  $('registerOcUpload').textContent = state.ocUploadStage === 'registered' ? 'Retry upload' : 'Register & upload';
  $('certifyOcUpload').disabled = state.minting || !state.walletConnected || state.ocUploadStage !== 'uploaded';
  $('mintOcOnchain').disabled = state.minting || !state.walletConnected || state.ocUploadStage !== 'certified';
  $('mintOcOnchain').textContent = state.minting ? 'Minting…' : state.mintDigest ? 'Minted' : 'Mint OC';
  if (state.mintDigest) {
    $('mintOcStatus').innerHTML = `OC minted. <a href="${explorerTransactionUrl(state.mintDigest)}" target="_blank" rel="noreferrer">View transaction</a>`;
  } else {
    $('mintOcStatus').textContent = state.mintStatus || mintReadiness();
  }
}

async function renderOcImageBlob() {
  const canvas = document.createElement('canvas');
  canvas.width = state.makerCanvas.width;
  canvas.height = state.makerCanvas.height;
  const context = canvas.getContext('2d');
  const uploadedLayers = allCreatorLayers().flatMap((layer) => {
    const itemId = state.visual[layer.partKey] || slotItems(layer.partKey)[0]?.id;
    const item = slotItems(layer.partKey).find((candidate) => candidate.id === itemId && candidate.visibility !== 'private');
    const slot = allSlots().find((candidate) => candidate.key === layer.partKey);
    const colors = creatorColors(slot);
    const selectedColor = colors.find((color) => color.value.toLowerCase() === String(state.visual.palette[slot.colorKey] || '').toLowerCase()) || colors[0];
    const asset = selectedColor ? item?.images?.[assetCellKey(layer.id, selectedColor.id)] : null;
    return asset ? [{ layer, asset }] : [];
  });
  if (uploadedLayers.length) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    for (const { layer, asset } of uploadedLayers) {
      const bitmap = await createImageBitmap(asset.file);
      context.globalAlpha = (layer.opacity ?? 100) / 100;
      context.globalCompositeOperation = ['normal', 'multiply', 'screen', 'overlay'].includes(layer.blendMode)
        ? (layer.blendMode === 'normal' ? 'source-over' : layer.blendMode)
        : 'source-over';
      context.drawImage(bitmap, layer.x || 0, layer.y || 0, bitmap.width, bitmap.height);
      bitmap.close();
    }
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not render the OC image.')), 'image/png');
    });
  }
  const palette = state.visual.palette;
  context.fillStyle = palette.background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.scale(canvas.width / 1024, canvas.height / 1024);
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
  context.restore();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not render the OC image.')), 'image/png');
  });
}

function renderImageMakerList() {
  $('imageMakerList').innerHTML = `
    ${templates.map((template) => `
      <article class="creator-maker-card ${template.id === state.templateId ? 'active' : ''}" data-maker="${escapeHtml(template.id)}" style="--accent:${safeCssColor(template.accent)}; --secondary:${safeCssColor(template.secondary, '#f0a23a')};">
        <div class="maker-cover-mini">
          <span class="mini-face"></span>
        </div>
        <div class="maker-card-body">
          <div class="maker-tags">
            <span>${template.source === 'local' ? 'Local draft' : 'Starter example'}</span>
            <span>${template.category === 'chibi' ? '1:1' : '9:16'}</span>
            <span>Free combine</span>
          </div>
          <h2>${escapeHtml(template.name)}</h2>
          <p>${escapeHtml(template.summary)}</p>
        </div>
        <div class="maker-card-actions">
          <button class="secondary" data-preview-maker="${escapeHtml(template.id)}">Preview</button>
          <button class="icon-button" data-open-maker="${escapeHtml(template.id)}" aria-label="Open ${escapeHtml(template.name)}">↗</button>
          <button class="primary" data-edit-maker="${escapeHtml(template.id)}">Edit</button>
        </div>
      </article>
    `).join('')}
  `;

  document.querySelectorAll('[data-preview-maker], [data-open-maker]').forEach((button) => {
    button.addEventListener('click', () => {
      activateMakerModel(button.dataset.previewMaker || button.dataset.openMaker);
      syncTemplateFields();
      setPage('make');
      renderAll();
    });
  });

  document.querySelectorAll('[data-edit-maker]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.editMaker) activateMakerModel(button.dataset.editMaker);
      syncTemplateFields();
      setCreatorView('edit');
      renderAll();
      focusCreatorTop();
    });
  });
}

function renderCreatorDetails() {
  const template = activeTemplate();
  allSlots().forEach(ensureSlotStructure);
  const compositionLayers = allCreatorLayers();
  $('detailMakerTitle').textContent = template.name;
  $('editingMakerTitle').textContent = template.name;
  $('editingMakerTitle').title = template.name;
  $('detailDescription').textContent = template.summary || 'Build the template from layered assets, then bind the maker to license rules and on-chain provenance.';
  $('layerCount').textContent = compositionLayers.length;
  const publicItems = allSlots().flatMap((slot) => slotItems(slot.key).filter((item) => item.visibility !== 'private').map((item) => ({ slot, item })));
  const incompleteItems = publicItems.filter(({ slot, item }) => creatorLayers(slot).some((layer) => creatorColors(slot).some((color) => !item.images?.[assetCellKey(layer.id, color.id)]?.file)));
  if ($('makerTopPartSummary')) $('makerTopPartSummary').textContent = `${allSlots().length} Part${allSlots().length === 1 ? '' : 's'}`;
  if ($('makerTopAssetSummary')) $('makerTopAssetSummary').textContent = itemLayerAssets().length ? `${itemLayerAssets().length} item images ready` : 'No item images yet';
  if ($('makerTopRuleSummary')) $('makerTopRuleSummary').textContent = `${state.rules.length} Rule${state.rules.length === 1 ? '' : 's'}`;
  if ($('makerTopReadiness')) {
    $('makerTopReadiness').textContent = !allSlots().length
      ? 'Add the first Part'
      : incompleteItems.length === 0 ? 'Ready to preview' : `${incompleteItems.length} incomplete Item${incompleteItems.length === 1 ? '' : 's'}`;
  }
  if ($('makerTopChainState')) $('makerTopChainState').textContent = state.publishDigest ? 'Published' : runtimeConfig.packageId.includes('TODO') ? 'Package pending' : 'Local draft';
  const canvasRatio = state.makerCanvas.width === state.makerCanvas.height ? '1:1' : '9:16';
  if ($('makerCanvasTag')) $('makerCanvasTag').textContent = canvasRatio;
  if ($('canvasSizeLabel')) $('canvasSizeLabel').textContent = `${state.makerCanvas.width} × ${state.makerCanvas.height}`;
  if ($('creatorCanvasStage')) $('creatorCanvasStage').style.aspectRatio = `${state.makerCanvas.width} / ${state.makerCanvas.height}`;

  $('creatorPartsList').innerHTML = allSlots().map((slot, index) => `
    <button class="creator-part-row ${state.selectedSlot === slot.key ? 'active' : ''}" data-slot="${slot.key}">
      <span>${String(index + 1).padStart(2, '0')}</span>
      <strong>${escapeHtml(slot.label)}</strong>
      <small>${slotItems(slot.key).length} items · ${creatorLayers(slot).length} layers · ${uploadedAssetCount(slot)} files</small>
    </button>
  `).join('');

  $('creatorLayerList').innerHTML = compositionLayers.map((layer, index) => `
    <button class="layer-row ${state.selectedLayer === layer.key ? 'active' : ''}" data-layer-key="${layer.key}">
      <span>${index + 1}</span>
      <strong>${escapeHtml(layer.name)}</strong>
      <small>${escapeHtml(layer.partLabel)} · ${escapeHtml(layer.id)}</small>
    </button>
  `).join('');

  renderPartWorkspace();
  renderLayerDetails();
  renderCreatorCanvas();

  document.querySelectorAll('.creator-part-row').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedSlot = button.dataset.slot;
      state.selectedItem = state.visual[state.selectedSlot] || slotItems(state.selectedSlot)[0]?.id || '';
      state.partSubView = 'items';
      renderCreatorDetails();
    });
  });

  document.querySelectorAll('[data-layer-key]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedLayer = button.dataset.layerKey;
      state.selectedSlot = state.selectedLayer.split(':')[0];
      renderCreatorDetails();
    });
  });
}

function renderPartWorkspace() {
  if (!$('partWorkspace')) return;
  const active = activeSlot();
  if (!active) {
    $('partWorkspace').innerHTML = `
      <div class="empty-part-state">
        <span class="empty-part-mark">+</span>
        <strong>Create the first Part</strong>
        <p>Parts contain the Items, Layers, Colors, and PNG files users combine.</p>
        <button class="primary" data-empty-add-part>Add Part</button>
      </div>
    `;
    document.querySelector('[data-empty-add-part]')?.addEventListener('click', openPartModal);
    return;
  }
  const slot = ensureSlotStructure(active);
  const slotLabel = escapeHtml(slot.label);
  const items = slotItems(slot.key);
  const layers = creatorLayers(slot);
  const colors = creatorColors(slot);
  if (!items.some((item) => item.id === state.selectedItem)) {
    state.selectedItem = state.visual[slot.key] || items[0]?.id || '';
  }
  const selectedItemForSlot = state.selectedItem;
  const selectedItem = items.find((item) => item.id === selectedItemForSlot) || items[0];
  const totalCells = layers.length * colors.length;
  const itemRows = items.map((item, index) => `
    <button class="item-row ${selectedItemForSlot === item.id ? 'active' : ''}" data-select-item="${escapeHtml(item.id)}">
      <span>No.${index + 1}</span>
      <span class="item-row-copy"><strong>${escapeHtml(item.label)}</strong><small>${Object.values(item.images || {}).filter((asset) => asset?.file).length}/${totalCells} images · ${escapeHtml(item.visibility)}</small></span>
      <span class="item-row-thumb">${item.iconAsset?.url ? `<img src="${item.iconAsset.url}" alt="" />` : String(index + 1).padStart(2, '0')}</span>
    </button>
  `).join('');

  const tabs = `
    <div class="part-workspace-tabs" role="tablist" aria-label="${slotLabel} editor">
      <button class="${state.partSubView === 'items' ? 'active' : ''}" data-part-subview="items">Items</button>
      <button class="${state.partSubView === 'layers' ? 'active' : ''}" data-part-subview="layers">Layers & colors</button>
      <button class="${state.partSubView === 'settings' ? 'active' : ''}" data-part-subview="settings">Part settings</button>
    </div>
  `;

  if (state.partSubView === 'settings') {
    $('partWorkspace').innerHTML = `
      <div class="workspace-head">
        <div>
          <p class="kicker">Part Details</p>
          <h2>${slotLabel}</h2>
        </div>
        <div class="workspace-actions">
          <button class="secondary" data-select-layer-from-part="${creatorLayerKey(slot.key, layers[0].id)}">Composition order</button>
        </div>
      </div>
      ${tabs}
      <div class="part-detail-grid">
        <label>Part name<input data-part-field="label" value="${slotLabel}" /></label>
        <label>Part type<select data-part-field="kind" disabled>
          <option value="standard" ${slot.kind === 'standard' || !slot.kind ? 'selected' : ''}>Standard part</option>
          <option value="left-right-pair" ${slot.kind === 'left-right-pair' ? 'selected' : ''}>Left-right paired part</option>
          <option value="last-bastion" ${slot.kind === 'last-bastion' ? 'selected' : ''}>Last bastion part</option>
        </select></label>
        <label>Anchor X<input data-part-field="x" type="number" value="${slot.x ?? 0}" /></label>
        <label>Anchor Y<input data-part-field="y" type="number" value="${slot.y ?? 0}" /></label>
        <label>Menu visibility<select data-part-field="menuVisible">
          <option value="visible" ${slot.menuVisible !== false ? 'selected' : ''}>Visible in menu</option>
          <option value="hidden" ${slot.menuVisible === false ? 'selected' : ''}>Hidden fixed layer</option>
        </select></label>
        <label>Remove option<select data-part-field="allowRemove">
          <option value="yes" ${slot.allowRemove !== false ? 'selected' : ''}>User may remove</option>
          <option value="no" ${slot.allowRemove === false ? 'selected' : ''}>Always selected</option>
        </select></label>
        <label>Default item<select data-part-field="defaultItemId">${items.map((item) => `<option value="${escapeHtml(item.id)}" ${slot.defaultItemId === item.id || (!slot.defaultItemId && item === items[0]) ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}</select></label>
        <label>Part menu icon<input data-part-icon type="file" accept="image/png,image/jpeg" /></label>
        <div><strong>Icon status</strong><span>${slot.iconAsset ? `${slot.iconAsset.width} × ${slot.iconAsset.height}` : 'No custom icon'}</span></div>
        <label>License gate<select data-part-field="licenseGate">
          <option value="included" ${slot.licenseGate !== 'paid' ? 'selected' : ''}>Included in maker license</option>
          <option value="paid" ${slot.licenseGate === 'paid' ? 'selected' : ''}>Paid add-on part</option>
        </select></label>
        <label>Horizontal movement<select data-part-field="allowMoveX"><option value="no" ${!slot.allowMoveX ? 'selected' : ''}>Locked</option><option value="yes" ${slot.allowMoveX ? 'selected' : ''}>Player may move</option></select></label>
        <label>Vertical movement<select data-part-field="allowMoveY"><option value="no" ${!slot.allowMoveY ? 'selected' : ''}>Locked</option><option value="yes" ${slot.allowMoveY ? 'selected' : ''}>Player may move</option></select></label>
        <label>Scale control<select data-part-field="allowScale"><option value="no" ${!slot.allowScale ? 'selected' : ''}>Locked</option><option value="yes" ${slot.allowScale ? 'selected' : ''}>Player may scale</option></select></label>
        <label>Rotation control<select data-part-field="allowRotate"><option value="no" ${!slot.allowRotate ? 'selected' : ''}>Locked</option><option value="yes" ${slot.allowRotate ? 'selected' : ''}>Player may rotate</option></select></label>
        ${slot.kind === 'left-right-pair' ? `
          <label>Right layer X<input data-part-field="rightX" type="number" value="${slot.rightX || 0}" /></label>
          <label>Paired spacing<select data-part-field="allowSpacing"><option value="no" ${!slot.allowSpacing ? 'selected' : ''}>Locked</option><option value="yes" ${slot.allowSpacing ? 'selected' : ''}>Player may adjust</option></select></label>
          <label>Spacing step<input data-part-field="spacingStep" type="number" min="1" value="${slot.spacingStep || 3}" /></label>
          <label>Spacing moves<input data-part-field="spacingSteps" type="number" min="1" value="${slot.spacingSteps || 5}" /></label>
        ` : ''}
        <div><strong>Type lock</strong><span>Part type is immutable after creation so its layer contract stays stable.</span></div>
      </div>
    `;
  } else if (state.partSubView === 'layers') {
    $('partWorkspace').innerHTML = `
      <div class="workspace-head">
        <div><p class="kicker">Layers & Colors</p><h2>${slotLabel}</h2></div>
        <div class="workspace-actions">
          <button class="secondary" data-add-layer ${slot.kind !== 'standard' ? 'disabled' : ''}>Add layer</button>
          <button class="secondary" data-add-color>Add color</button>
        </div>
      </div>
      ${tabs}
      <div class="part-layer-builder">
        <section>
          <div class="builder-title"><strong>Layers</strong><span>${layers.length}</span></div>
          <div class="builder-list">${layers.map((layer, index) => `
            <div class="builder-row">
              <span>${index + 1}</span>
              <input data-inline-layer-name="${escapeHtml(layer.id)}" value="${escapeHtml(layer.name)}" aria-label="Layer name" />
              <small>Global #${allCreatorLayers().findIndex((candidate) => candidate.key === creatorLayerKey(slot.key, layer.id)) + 1}</small>
              ${slot.kind === 'standard' && layers.length > 1 ? `<button class="icon-command" data-delete-layer="${layer.id}" title="Delete layer" aria-label="Delete layer">×</button>` : ''}
            </div>
          `).join('')}</div>
        </section>
        <section>
          <div class="builder-title"><strong>Colors</strong><span>${colors.length}</span></div>
          <div class="builder-list">${colors.map((color) => `
            <div class="builder-row color-builder-row">
              <input type="color" data-color-value="${escapeHtml(color.id)}" value="${escapeHtml(color.value)}" aria-label="${escapeHtml(color.name)} color" />
              <input data-color-name="${escapeHtml(color.id)}" value="${escapeHtml(color.name)}" aria-label="Color name" />
              <small>${escapeHtml(color.id)}</small>
            </div>
          `).join('')}</div>
        </section>
      </div>
      <p class="workspace-message">${slot.kind === 'left-right-pair' ? 'Left-right pairs keep fixed Left and Right layers.' : slot.kind === 'last-bastion' ? 'Last bastion parts keep one fixed fallback layer.' : 'Each item needs one PNG for every layer and color it uses.'}</p>
    `;
  } else {
    const matrix = selectedItem ? layers.map((layer) => `
      <section class="asset-layer-group">
        <div class="asset-layer-head"><strong>${escapeHtml(layer.name)}</strong><span>${slotLabel}</span></div>
        <div class="asset-cell-grid">${colors.map((color) => {
          const key = assetCellKey(layer.id, color.id);
          const asset = selectedItem.images?.[key];
          return `
            <label class="asset-upload-cell ${asset?.file ? 'complete' : ''}">
              <input type="file" accept="image/png" data-upload-item-image data-item-id="${escapeHtml(selectedItem.id)}" data-layer-id="${escapeHtml(layer.id)}" data-color-id="${escapeHtml(color.id)}" />
              <span class="asset-cell-preview">${asset?.url ? `<img src="${asset.url}" alt="" />` : '<b>+</b>'}</span>
              <span class="asset-cell-copy"><strong>${escapeHtml(color.name)}</strong><small>${asset?.file ? `${asset.width} × ${asset.height}` : 'Upload PNG'}</small></span>
            </label>
          `;
        }).join('')}</div>
      </section>
    `).join('') : '';
    $('partWorkspace').innerHTML = `
      <div class="workspace-head">
        <div>
          <p class="kicker">Part Items</p>
          <h2>${slotLabel}</h2>
        </div>
        <div class="workspace-actions">
          <button class="primary" data-add-item>+ Add item</button>
        </div>
      </div>
      ${tabs}
      <div class="item-toolbar">
        <span>${items.length} items</span>
        <span>${layers.length} layers</span>
        <span>${colors.length} colors</span>
        <span>${uploadedAssetCount(slot)} uploaded files</span>
      </div>
      <div class="part-item-editor">
        <aside class="item-list">${itemRows || '<div class="empty-state">No items yet.</div>'}</aside>
        <div class="item-asset-editor">${selectedItem ? `
          <div class="item-editor-head">
            <div><p class="kicker">Item No.${items.indexOf(selectedItem) + 1}</p><h3>${escapeHtml(selectedItem.label)}</h3></div>
            ${items.indexOf(selectedItem) > 0 ? `<button class="secondary" data-delete-item="${escapeHtml(selectedItem.id)}">Delete item</button>` : '<span class="template-token">Required base item</span>'}
          </div>
          <div class="item-setting-row">
            <label>Item name<input data-item-field="label" value="${escapeHtml(selectedItem.label)}" /></label>
            <label>Publication<select data-item-field="visibility" ${items.indexOf(selectedItem) === 0 ? 'disabled' : ''}>
              <option value="public" ${selectedItem.visibility === 'public' ? 'selected' : ''}>Include in published Maker</option>
              <option value="private" ${selectedItem.visibility === 'private' ? 'selected' : ''}>Draft only</option>
            </select></label>
            <label>Display order<input data-item-field="displayOrder" type="number" min="1" value="${selectedItem.displayOrder}" /></label>
            <label>Picker icon<input type="file" accept="image/png,image/jpeg" data-upload-item-icon="${escapeHtml(selectedItem.id)}" /></label>
          </div>
          <div class="asset-matrix-head"><div><strong>Item images</strong><span>${Object.values(selectedItem.images || {}).filter((asset) => asset?.file).length}/${totalCells} cells complete</span></div><button class="secondary" data-part-subview="layers">Edit layers & colors</button></div>
          <div class="asset-matrix">${matrix}</div>
          <p class="workspace-message">${escapeHtml(slot.assetMessage || 'PNG images remain local until you prepare the Walrus quilt in On-chain Publish.')}</p>
        ` : '<div class="empty-state">Add an item to begin uploading images.</div>'}</div>
      </div>
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
      renderCreatorDetails();
    });
  });

  document.querySelectorAll('[data-select-layer-from-part]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedLayer = button.dataset.selectLayerFromPart;
      setEditorPanel('parts');
      renderAll();
      $('compositionOrder')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });

  document.querySelectorAll('[data-part-field]').forEach((input) => {
    input.addEventListener('change', () => updatePartField(slot.key, input.dataset.partField, input.value));
  });

  document.querySelector('[data-part-icon]')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const nextIcon = await localIconAsset(file);
      if (slot.iconAsset?.url) URL.revokeObjectURL(slot.iconAsset.url);
      slot.iconAsset = nextIcon;
      syncCreatorAssets();
      invalidateMakerUpload('Part icon changed. Prepare a new Walrus quilt before publishing.');
    } catch (error) {
      slot.assetMessage = error.message || 'Could not read this icon.';
    }
    renderCreatorDetails();
  });

  document.querySelectorAll('[data-upload-item-image]').forEach((input) => {
    input.addEventListener('change', async (event) => {
      const item = items.find((candidate) => candidate.id === input.dataset.itemId);
      const file = event.target.files?.[0];
      if (!item || !file) return;
      const key = assetCellKey(input.dataset.layerId, input.dataset.colorId);
      try {
        const nextAsset = await localPngAsset(file);
        if (item.images[key]?.url) URL.revokeObjectURL(item.images[key].url);
        item.images[key] = nextAsset;
        slot.assetMessage = item.images[key].warning || `${file.name} is ready for preview.`;
        syncCreatorAssets();
        invalidateMakerUpload('Assets changed. Prepare a new Walrus quilt before publishing.');
      } catch (error) {
        slot.assetMessage = error.message || 'Could not read this PNG.';
      }
      renderCreatorDetails();
    });
  });

  document.querySelectorAll('[data-upload-item-icon]').forEach((input) => {
    input.addEventListener('change', async (event) => {
      const item = items.find((candidate) => candidate.id === input.dataset.uploadItemIcon);
      const file = event.target.files?.[0];
      if (!item || !file) return;
      try {
        const nextIcon = await localIconAsset(file);
        if (item.iconAsset?.url) URL.revokeObjectURL(item.iconAsset.url);
        item.iconAsset = nextIcon;
        syncCreatorAssets();
        invalidateMakerUpload('Item icon changed. Prepare a new Walrus quilt before publishing.');
      } catch (error) {
        slot.assetMessage = error.message || 'Could not read this Item icon.';
      }
      renderCreatorDetails();
    });
  });

  document.querySelectorAll('[data-item-field]').forEach((input) => {
    input.addEventListener('change', () => {
      if (!selectedItem) return;
      selectedItem[input.dataset.itemField] = input.dataset.itemField === 'displayOrder' ? Number(input.value || 1) : input.value;
      invalidateMakerUpload();
      renderCreatorDetails();
    });
  });

  document.querySelectorAll('[data-add-item]').forEach((button) => {
    button.addEventListener('click', () => {
      const next = slotItems(slot.key).length + 1;
      const id = `item-${next}`;
      if (!state.makerParts[slot.key]) state.makerParts[slot.key] = [];
      state.makerParts[slot.key].push({ id, label: `Item ${next}` });
      ensureSlotStructure(slot);
      state.selectedItem = id;
      state.visual[slot.key] = id;
      invalidateMakerUpload();
      renderAll();
    });
  });

  document.querySelectorAll('[data-delete-item]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = items.findIndex((item) => item.id === button.dataset.deleteItem);
      if (index <= 0) return;
      Object.values(items[index].images || {}).forEach((asset) => asset?.url && URL.revokeObjectURL(asset.url));
      items.splice(index, 1);
      state.selectedItem = items[0]?.id || '';
      state.visual[slot.key] = state.selectedItem;
      syncCreatorAssets();
      invalidateMakerUpload();
      renderAll();
    });
  });

  document.querySelector('[data-add-layer]')?.addEventListener('click', () => {
    if (slot.kind !== 'standard') return;
    const next = layers.length + 1;
    const id = `layer-${next}-${Date.now().toString(36)}`;
    layers.push({ id, name: `Layer ${next}`, x: slot.x || 0, y: slot.y || 0, opacity: 100, blendMode: 'normal' });
    state.layerOrder.push(creatorLayerKey(slot.key, id));
    state.selectedLayer = creatorLayerKey(slot.key, id);
    invalidateMakerUpload();
    renderCreatorDetails();
  });

  document.querySelectorAll('[data-delete-layer]').forEach((button) => {
    button.addEventListener('click', () => {
      if (slot.kind !== 'standard' || layers.length <= 1) return;
      const layerId = button.dataset.deleteLayer;
      const index = layers.findIndex((layer) => layer.id === layerId);
      if (index < 0) return;
      layers.splice(index, 1);
      state.layerOrder = state.layerOrder.filter((key) => key !== creatorLayerKey(slot.key, layerId));
      items.forEach((item) => Object.keys(item.images || {}).forEach((key) => {
        if (key.startsWith(`${layerId}:`)) {
          if (item.images[key]?.url) URL.revokeObjectURL(item.images[key].url);
          delete item.images[key];
        }
      }));
      syncCreatorAssets();
      invalidateMakerUpload();
      renderCreatorDetails();
    });
  });

  document.querySelectorAll('[data-inline-layer-name]').forEach((input) => {
    input.addEventListener('change', () => {
      const layer = layers.find((candidate) => candidate.id === input.dataset.inlineLayerName);
      if (layer) layer.name = input.value.trim() || layer.name;
      invalidateMakerUpload();
      renderCreatorDetails();
    });
  });

  document.querySelector('[data-add-color]')?.addEventListener('click', () => {
    const next = colors.length + 1;
    colors.push({ id: `color-${next}-${Date.now().toString(36)}`, name: `Color ${next}`, value: swatches[(next - 1) % swatches.length] });
    invalidateMakerUpload();
    renderCreatorDetails();
  });

  document.querySelectorAll('[data-color-name], [data-color-value]').forEach((input) => {
    input.addEventListener('change', () => {
      const colorId = input.dataset.colorName || input.dataset.colorValue;
      const color = colors.find((candidate) => candidate.id === colorId);
      if (!color) return;
      if (input.dataset.colorName) color.name = input.value.trim() || color.name;
      else color.value = input.value;
      invalidateMakerUpload();
      renderCreatorDetails();
    });
  });
}

function updatePartField(slotKey, field, value) {
  const slot = allSlots().find((item) => item.key === slotKey);
  if (!slot) return;
  if (['x', 'y', 'rightX', 'spacingStep', 'spacingSteps'].includes(field)) slot[field] = Number(value || 0);
  else if (field === 'menuVisible') slot.menuVisible = value !== 'hidden';
  else if (field === 'allowRemove') slot.allowRemove = value === 'yes';
  else if (['allowMoveX', 'allowMoveY', 'allowScale', 'allowRotate', 'allowSpacing'].includes(field)) slot[field] = value === 'yes';
  else slot[field] = value;
  invalidateMakerUpload();
  renderCreatorDetails();
}

function renderLayerDetails() {
  if (!$('layerDetailsPanel')) return;
  const selected = selectedLayerRecord();
  if (!selected) {
    $('layerDetailsPanel').innerHTML = '<div class="empty-state">Add a Part to create its first composition Layer.</div>';
    return;
  }
  const slot = allSlots().find((candidate) => candidate.key === selected.partKey);
  const layer = creatorLayers(slot).find((candidate) => candidate.id === selected.id);
  const layerAssets = slotItems(slot.key).flatMap((item) => Object.entries(item.images || {}).filter(([key, asset]) => key.startsWith(`${layer.id}:`) && asset?.file));
  $('layerDetailsPanel').innerHTML = `
    <div class="workspace-head">
      <div>
        <p class="kicker">Layer Details</p>
        <h2>${escapeHtml(layer.name)}</h2>
        <small>${escapeHtml(slot.label)} · ${layerAssets.length} uploaded item images</small>
      </div>
      <div class="workspace-actions">
        <button class="secondary" data-move-layer="up">Move front</button>
        <button class="secondary" data-move-layer="down">Move behind</button>
        <button class="secondary" data-open-layer-part="${slot.key}">Edit item images</button>
      </div>
    </div>
    <div class="part-detail-grid">
      <label>Layer name<input data-layer-field="name" value="${escapeHtml(layer.name)}" /></label>
      <label>Anchor X<input data-layer-field="x" type="number" value="${layer.x ?? 0}" /></label>
      <label>Anchor Y<input data-layer-field="y" type="number" value="${layer.y ?? 0}" /></label>
      <label>Opacity<input data-layer-field="opacity" type="number" min="0" max="100" value="${layer.opacity ?? 100}" /></label>
      <label>Blend mode<select data-layer-field="blendMode">
        <option value="normal" ${layer.blendMode === 'normal' ? 'selected' : ''}>Normal</option>
        <option value="multiply" ${layer.blendMode === 'multiply' ? 'selected' : ''}>Multiply</option>
        <option value="screen" ${layer.blendMode === 'screen' ? 'selected' : ''}>Screen</option>
        <option value="overlay" ${layer.blendMode === 'overlay' ? 'selected' : ''}>Overlay</option>
      </select></label>
      <div>
        <strong>Composition position</strong>
        <span>#${allCreatorLayers().findIndex((candidate) => candidate.key === selected.key) + 1} of ${allCreatorLayers().length}</span>
      </div>
      <div>
        <strong>Walrus readiness</strong>
        <span>${layerAssets.length ? `${layerAssets.length} local files ready` : 'Upload item images in Parts'}</span>
      </div>
    </div>
  `;

  document.querySelectorAll('[data-layer-field]').forEach((input) => {
    input.addEventListener('change', () => updateLayerField(selected.key, input.dataset.layerField, input.value));
  });

  document.querySelectorAll('[data-move-layer]').forEach((button) => {
    button.addEventListener('click', () => moveLayer(selected.key, button.dataset.moveLayer));
  });

  document.querySelectorAll('[data-open-layer-part]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedSlot = button.dataset.openLayerPart;
      state.selectedItem = state.visual[state.selectedSlot] || slotItems(state.selectedSlot)[0]?.id || '';
      state.partSubView = 'items';
      setEditorPanel('parts');
      renderCreatorDetails();
    });
  });
}

function updateLayerField(layerKey, field, value) {
  const [partKey, layerId] = layerKey.split(':');
  const slot = allSlots().find((candidate) => candidate.key === partKey);
  const layer = slot && creatorLayers(slot).find((candidate) => candidate.id === layerId);
  if (!layer) return;
  layer[field] = ['x', 'y', 'opacity'].includes(field) ? Number(value || 0) : value;
  invalidateMakerUpload();
  renderCreatorDetails();
}

function moveLayer(layerKey, direction) {
  allCreatorLayers();
  const order = [...state.layerOrder];
  const index = order.indexOf(layerKey);
  if (index === -1) return;
  const target = direction === 'up' ? index + 1 : index - 1;
  if (target < 0 || target >= order.length) return;
  [order[index], order[target]] = [order[target], order[index]];
  state.layerOrder = order;
  invalidateMakerUpload();
  renderAll();
}

function renderCreatorCanvas() {
  if (!$('creatorCanvasAssets')) return;
  const images = allCreatorLayers().flatMap((layer) => {
    const itemId = state.visual[layer.partKey] || slotItems(layer.partKey)[0]?.id;
    const item = slotItems(layer.partKey).find((candidate) => candidate.id === itemId);
    const assetEntry = Object.entries(item?.images || {}).find(([key, asset]) => key.startsWith(`${layer.id}:`) && asset?.url);
    if (!assetEntry) return [];
    return [{ layer, asset: assetEntry[1] }];
  });
  $('creatorCanvasAssets').innerHTML = images.map(({ layer, asset }) => `
    <img src="${asset.url}" alt="${escapeHtml(layer.partLabel)} ${escapeHtml(layer.name)}" style="--layer-x:${layer.x || 0};--layer-y:${layer.y || 0};opacity:${(layer.opacity ?? 100) / 100};mix-blend-mode:${layer.blendMode || 'normal'}" />
  `).join('');
  $('creatorCanvasEmpty').hidden = images.length > 0;
  if ($('canvasAssetCount')) $('canvasAssetCount').textContent = `${images.length} image${images.length === 1 ? '' : 's'}`;
}

function openMakerModal() {
  if (!state.walletConnected) {
    openAccountPanel();
    return;
  }
  $('makerRegistrationModal').classList.add('active');
  $('makerRegistrationModal').setAttribute('aria-hidden', 'false');
  $('newMakerName').focus();
}

function closeMakerModal() {
  $('makerRegistrationModal').classList.remove('active');
  $('makerRegistrationModal').setAttribute('aria-hidden', 'true');
}

function openPartModal() {
  if (!state.walletConnected) {
    openAccountPanel();
    return;
  }
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
  if ($('creatorWalletGate')) $('creatorWalletGate').hidden = state.walletConnected;
  if ($('creatorConsole')) $('creatorConsole').hidden = !state.walletConnected;
  if ($('backToCreatorPreview')) $('backToCreatorPreview').hidden = !state.previewingMaker;
}

function publishReadiness() {
  if (runtimeConfig.packageId.includes('TODO')) return 'Publish the Move package and set packageId in config.js.';
  if (!state.walletConnected) return 'Connect a Sui wallet to sign publication.';
  if (!$('creatorTemplateName').value.trim()) return 'Add a maker name in Settings.';
  const issue = makerPublicationIssues()[0];
  if (issue) return issue;
  return 'Prepare one Walrus quilt, register and upload it, certify it, then publish the maker on Sui Mainnet.';
}

function renderPublishAction() {
  if (!$('publishMakerOnchain')) return;
  const baseReady = !runtimeConfig.packageId.includes('TODO') && state.walletConnected && itemLayerAssets().length > 0;
  $('prepareMakerUpload').disabled = state.publishing || !baseReady || state.makerUploadStage !== 'idle';
  $('registerMakerUpload').disabled = state.publishing || !state.walletConnected || !['encoded', 'registered'].includes(state.makerUploadStage);
  $('registerMakerUpload').textContent = state.makerUploadStage === 'registered' ? '2. Retry upload' : '2. Register & upload';
  $('certifyMakerUpload').disabled = state.publishing || !state.walletConnected || state.makerUploadStage !== 'uploaded';
  $('publishMakerOnchain').disabled = state.publishing || !state.walletConnected || state.makerUploadStage !== 'certified';
  $('publishMakerOnchain').textContent = state.publishing ? 'Publishing…' : state.publishDigest ? 'Published' : '4. Publish maker';
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
      <article class="chain-status-card ${escapeHtml(status)}">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
        <small>${escapeHtml(note)}</small>
      </article>
    `).join('');
  }

  if ($('publishRuntimeCard')) {
    $('publishRuntimeCard').innerHTML = `
      <div>
        <span>Network</span>
        <strong>${escapeHtml(runtimeConfig.network)}</strong>
      </div>
      <div>
        <span>Package</span>
        <strong>${escapeHtml(runtimeConfig.packageId.includes('TODO') ? 'Publish package first' : shortAddress(runtimeConfig.packageId))}</strong>
      </div>
      <div>
        <span>Walrus</span>
        <strong>${runtimeConfig.walrusUploadRelayUrl ? 'Mainnet Upload Relay ready' : 'Configure upload relay'}</strong>
      </div>
      <div>
        <span>Signer</span>
        <strong>${escapeHtml(state.walletConnected ? shortAddress(state.walletAddress) || 'Connected' : 'Connect wallet')}</strong>
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

async function prepareMakerUpload() {
  state.publishing = true;
  state.publishDigest = '';
  state.publishStatus = 'Encoding PNG layers and manifest into one Walrus quilt…';
  renderPublishAction();
  try {
    syncCreatorAssets();
    const issues = makerPublicationIssues();
    if (issues.length) throw new Error(issues[0]);
    state.pendingMakerAssets = publishableAssets();
    state.pendingMakerAssets.forEach((asset) => {
      if (!asset.file) throw new Error(`${asset.name} is no longer available. Select the PNG files again.`);
    });
    state.pendingMakerManifestJson = JSON.stringify(creatorUploadManifest());
    const manifestBlob = new Blob([state.pendingMakerManifestJson], { type: 'application/json' });
    const entries = [
      ...state.pendingMakerAssets.map((asset) => ({ blob: asset.file, identifier: asset.identifier, kind: asset.kind })),
      { blob: manifestBlob, identifier: 'animacraft-manifest.json', kind: 'maker-manifest' },
    ];
    state.makerUploadSession = await prepareWalrusUpload(entries);
    state.makerUploadStage = 'encoded';
    state.publishStatus = 'Quilt encoded. Register it on Walrus Mainnet with your wallet.';
  } catch (error) {
    state.publishStatus = error.message || 'Could not prepare the maker quilt.';
  } finally {
    state.publishing = false;
    renderAll();
  }
}

async function registerMakerUpload() {
  state.publishing = true;
  state.publishStatus = 'Waiting for the Walrus registration signature, then uploading through Mainnet relay…';
  renderPublishAction();
  try {
    await registerAndUploadWalrus(state.makerUploadSession);
    state.makerUploadStage = 'uploaded';
    state.publishStatus = 'Quilt uploaded. Certify availability with one more wallet signature.';
  } catch (error) {
    state.makerUploadStage = state.makerUploadSession?.stage || state.makerUploadStage;
    state.publishStatus = error.message || 'Walrus registration or upload failed.';
  } finally {
    state.publishing = false;
    renderAll();
  }
}

async function certifyMakerUpload() {
  state.publishing = true;
  state.publishStatus = 'Waiting for the Walrus certification signature…';
  renderPublishAction();
  try {
    await certifyWalrusUpload(state.makerUploadSession);
    if (state.makerUploadSession.files.length !== state.pendingMakerAssets.length + 1) {
      throw new Error('Walrus returned an unexpected number of quilt files.');
    }
    state.pendingMakerAssets.forEach((asset, index) => {
      asset.patchId = state.makerUploadSession.files[index].id;
      asset.blobId = state.makerUploadSession.files[index].blobId;
    });
    state.makerManifestPatchId = state.makerUploadSession.files[state.pendingMakerAssets.length].id;
    state.makerUploadStage = 'certified';
    state.publishStatus = 'Walrus quilt certified. Publish the indexed OCMaker object on Sui Mainnet.';
  } catch (error) {
    state.publishStatus = error.message || 'Walrus certification failed.';
  } finally {
    state.publishing = false;
    renderAll();
  }
}

async function publishCurrentMaker() {
  if (state.publishing || state.makerUploadStage !== 'certified') return;
  state.publishing = true;
  state.publishStatus = 'Waiting for your Sui Mainnet publication signature…';
  renderPublishAction();
  try {
    if (JSON.stringify(creatorUploadManifest()) !== state.pendingMakerManifestJson) {
      state.makerUploadSession = null;
      state.makerUploadStage = 'idle';
      state.makerManifestPatchId = '';
      state.pendingMakerManifestJson = '';
      state.pendingMakerAssets.forEach((asset) => {
        asset.patchId = '';
        asset.blobId = '';
      });
      throw new Error('The maker changed after upload. Prepare a new quilt before publishing.');
    }
    const layerAssets = state.pendingMakerAssets.filter((asset) => asset.kind === 'item-layer');
    const assetSlots = [...new Set(layerAssets.map((asset) => asset.slot))];
    const makerParts = assetSlots.map((key, index) => {
      const slot = allSlots().find((candidate) => candidate.key === key);
      const configuredOrder = allSlots().findIndex((candidate) => candidate.key === key);
      return {
        key,
        label: slot?.label || key,
        kind: slot?.kind || 'standard',
        renderOrder: configuredOrder >= 0 ? configuredOrder : index,
        menuVisible: slot?.menuVisible !== false,
        required: slot?.allowRemove === false,
      };
    });
    const makerItems = assetSlots.flatMap((partKey) => slotItems(partKey).filter((item) => item.visibility !== 'private').flatMap((item) => {
      const itemAssets = layerAssets.filter((asset) => asset.slot === partKey && asset.itemId === item.id);
      if (!itemAssets.length) return [];
      const icon = state.pendingMakerAssets.find((asset) => asset.kind === 'item-icon' && asset.slot === partKey && asset.itemId === item.id);
      return [{
        partKey,
        itemKey: item.id,
        label: item.label,
        blobId: itemAssets[0].patchId,
        iconBlobId: icon?.patchId || '',
        gateKind: 0,
      }];
    }));
    const makerRules = state.rules.filter((rule) => assetSlots.includes(rule.leftPartKey) && assetSlots.includes(rule.rightPartKey));
    if (makerRules.length !== state.rules.length) throw new Error('Every rule must reference a part with uploaded PNG items.');

    const transaction = await publishMaker({
      creator: {
        displayName: $('creatorName').value.trim(),
        bio: `${$('creatorWorld').value.trim()} OC maker creator`,
        avatarUrl: '',
      },
      maker: {
        name: $('creatorTemplateName').value.trim(),
        description: activeTemplate().summary,
        coverUrl: walrusFileUrl(state.pendingMakerAssets[0]?.patchId),
        license: $('creatorLicense').value,
        royaltyBps: Number($('creatorRoyalty').value || 0),
      },
      manifestBlobId: state.makerManifestPatchId,
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

async function prepareOcUpload() {
  state.minting = true;
  state.mintDigest = '';
  state.mintStatus = 'Rendering the OC and encoding one Walrus quilt…';
  renderMintAction();
  try {
    const oc = ocPackage();
    const image = await renderOcImageBlob();
    const profile = new Blob([JSON.stringify(oc)], { type: 'application/json' });
    const recipeJson = JSON.stringify(oc.recipe);
    const recipeBytes = new TextEncoder().encode(recipeJson);
    state.pendingOcPackage = oc;
    state.pendingOcRecipeJson = recipeJson;
    state.pendingOcRecipeHash = new Uint8Array(await crypto.subtle.digest('SHA-256', recipeBytes));
    state.ocUploadSession = await prepareWalrusUpload([
      { blob: image, identifier: 'animacraft-oc.png', kind: 'oc-image' },
      { blob: profile, identifier: 'animacraft-oc.json', kind: 'oc-profile' },
    ]);
    state.ocUploadStage = 'encoded';
    state.mintStatus = 'OC quilt encoded. Register it on Walrus Mainnet.';
  } catch (error) {
    state.mintStatus = error.message || 'Could not prepare the OC quilt.';
  } finally {
    state.minting = false;
    renderMintAction();
  }
}

async function registerOcUpload() {
  state.minting = true;
  state.mintStatus = 'Waiting for registration signature, then uploading the OC quilt…';
  renderMintAction();
  try {
    await registerAndUploadWalrus(state.ocUploadSession);
    state.ocUploadStage = 'uploaded';
    state.mintStatus = 'OC quilt uploaded. Certify it with one more signature.';
  } catch (error) {
    state.ocUploadStage = state.ocUploadSession?.stage || state.ocUploadStage;
    state.mintStatus = error.message || 'OC registration or upload failed.';
  } finally {
    state.minting = false;
    renderMintAction();
  }
}

async function certifyOcUpload() {
  state.minting = true;
  state.mintStatus = 'Waiting for Walrus certification signature…';
  renderMintAction();
  try {
    await certifyWalrusUpload(state.ocUploadSession);
    if (state.ocUploadSession.files.length !== 2) throw new Error('Walrus returned an unexpected OC quilt result.');
    state.ocImagePatchId = state.ocUploadSession.files[0].id;
    state.ocProfilePatchId = state.ocUploadSession.files[1].id;
    state.ocUploadStage = 'certified';
    state.mintStatus = 'OC files certified. Mint the OCCharacter object on Sui Mainnet.';
  } catch (error) {
    state.mintStatus = error.message || 'OC certification failed.';
  } finally {
    state.minting = false;
    renderMintAction();
  }
}

async function mintCurrentOc() {
  if (state.minting || state.ocUploadStage !== 'certified') return;
  state.minting = true;
  state.mintStatus = 'Waiting for your Sui Mainnet mint signature…';
  renderMintAction();
  try {
    const currentRecipeJson = JSON.stringify(ocPackage().recipe);
    if (currentRecipeJson !== state.pendingOcRecipeJson) {
      state.ocUploadSession = null;
      state.ocUploadStage = 'idle';
      state.ocImagePatchId = '';
      state.ocProfilePatchId = '';
      throw new Error('The OC changed after upload. Prepare a new mint quilt.');
    }
    const oc = state.pendingOcPackage;
    const transaction = await mintCharacter({
      makerId: activeMakerObjectId(),
      name: oc.profile.name,
      profileBlobId: state.ocProfilePatchId,
      imageBlobId: state.ocImagePatchId,
      imageUrl: walrusFileUrl(state.ocImagePatchId),
      recipeHash: state.pendingOcRecipeHash,
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

function restoreMakerDraft(templateId = state.templateId) {
  const storageKey = makerDraftStorageKey(templateId);
  const raw = localStorage.getItem(storageKey)
    || (templateId === state.templateId ? localStorage.getItem('animacraft-maker-draft-v1') : null);
  loadedMakerDrafts.add(storageKey);
  if (!raw) return;
  try {
    const draft = JSON.parse(raw);
    if (draft.visual) state.visual = draft.visual;
    if (Array.isArray(draft.rules)) state.rules = draft.rules;
    if (Array.isArray(draft.paletteLinks)) state.paletteLinks = draft.paletteLinks;
    if (Array.isArray(draft.manifest?.parts)) {
      state.layerOrder = [];
      draft.manifest.parts.forEach((savedPart) => {
        let slot = allSlots().find((candidate) => candidate.key === savedPart.key);
        if (!slot) {
          slot = {
            key: savedPart.key,
            label: savedPart.label,
            icon: savedPart.label.slice(0, 2).toUpperCase(),
            colorKey: savedPart.key,
            description: 'Restored creator Part',
          };
          state.makerSlots.push(slot);
        }
        Object.assign(slot, {
          label: savedPart.label,
          kind: savedPart.kind,
          menuVisible: savedPart.menuVisible,
          allowRemove: savedPart.allowRemove,
          defaultItemId: savedPart.defaultItemId,
          x: savedPart.anchor?.x || 0,
          y: savedPart.anchor?.y || 0,
          rightX: savedPart.anchor?.rightX || 0,
          layers: (savedPart.layers || []).map(({ id, name, x, y, opacity, blendMode }) => ({ id, name, x, y, opacity, blendMode })),
          colors: savedPart.colors || [],
          allowMoveX: savedPart.controls?.moveX,
          allowMoveY: savedPart.controls?.moveY,
          allowScale: savedPart.controls?.scale,
          allowRotate: savedPart.controls?.rotate,
          allowSpacing: savedPart.controls?.pairedSpacing,
          spacingStep: savedPart.controls?.spacingStep || 0,
          spacingSteps: savedPart.controls?.spacingSteps || 0,
        });
        if (!state.slotOrder.includes(slot.key)) state.slotOrder.push(slot.key);
        state.makerParts[slot.key] = (savedPart.items || []).map((item) => ({
          id: item.id,
          label: item.label,
          displayOrder: item.displayOrder,
          visibility: item.visibility,
          images: {},
          iconAsset: null,
        }));
        savedPart.layers?.forEach((layer) => {
          state.layerOrder[layer.renderOrder] = creatorLayerKey(slot.key, layer.id);
        });
      });
      state.layerOrder = state.layerOrder.filter(Boolean);
    }
    const template = draft.manifest?.template;
    if (template) {
      if (template.canvas?.width && template.canvas?.height) {
        state.makerCanvas = { width: Number(template.canvas.width), height: Number(template.canvas.height) };
      }
      const currentTemplate = activeTemplate();
      currentTemplate.name = template.name || currentTemplate.name;
      currentTemplate.creator = template.creator || currentTemplate.creator;
      currentTemplate.style = template.style || currentTemplate.style;
      currentTemplate.license = creatorLicenseLabels?.[template.license] || template.license || currentTemplate.license;
      currentTemplate.royaltyBps = template.royaltyBps ?? currentTemplate.royaltyBps;
      $('creatorTemplateName').value = template.name || $('creatorTemplateName').value;
      $('creatorName').value = template.creator || $('creatorName').value;
      $('creatorWorld').value = template.style || $('creatorWorld').value;
      $('creatorLicense').value = template.license || $('creatorLicense').value;
      $('creatorRoyalty').value = template.royaltyBps ?? $('creatorRoyalty').value;
    }
    syncActiveMakerModelRefs();
  } catch (error) {
    console.warn('Ignored an unreadable local maker draft.', error);
  }
}

function renderAll() {
  renderTemplates();
  renderSlots();
  renderParts();
  renderSwatches();
  renderAvatar();
  renderRecipe();
  renderChecklist();
  renderCreatorValidation();
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
  syncActiveMakerModelRefs();
}

document.querySelectorAll('[data-page]').forEach((button) => {
  button.addEventListener('click', () => {
    if ($('accountPanel')?.contains(button)) closeAccountPanel();
    if (button.dataset.page === 'make') state.previewingMaker = false;
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
$('creatorGateWalletButton')?.addEventListener('click', toggleWallet);
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
    const target = button.hasAttribute('data-focus-composition') ? $('compositionOrder') : document.querySelector('.maker-detail-main');
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

$('playMakerPreview')?.addEventListener('click', () => {
  state.previewingMaker = true;
  setPage('make');
  renderAll();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

$('backToCreatorPreview')?.addEventListener('click', () => {
  state.previewingMaker = false;
  state.creatorView = 'edit';
  setPage('creator');
  renderAll();
  focusCreatorTop();
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
  const slot = activeSlot();
  if (!slot) return;
  applyPaletteColor(slot, event.target.value);
  renderAll();
});

['profileName', 'profileWorld', 'profileDescription', 'profileTags'].forEach((id) => {
  $(id).addEventListener('input', renderAll);
});

const creatorLicenseLabels = {
  'personal-use': 'Personal use',
  'free-remix': 'Free remix',
  'paid-commercial': 'Paid commercial',
  'exclusive-commission': 'Exclusive commission',
};

['creatorTemplateName', 'creatorName', 'creatorWorld', 'creatorLicense', 'creatorRoyalty'].forEach((id) => {
  $(id).addEventListener('input', () => {
    const template = activeTemplate();
    if (id === 'creatorTemplateName') template.name = $('creatorTemplateName').value;
    else if (id === 'creatorName') template.creator = $('creatorName').value;
    else if (id === 'creatorWorld') template.style = $('creatorWorld').value;
    else if (id === 'creatorLicense') template.license = creatorLicenseLabels[$('creatorLicense').value] || 'Personal use';
    else if (id === 'creatorRoyalty') template.royaltyBps = Number($('creatorRoyalty').value || 0);
    invalidateMakerUpload();
    renderAll();
  });
});

$('prepareMakerUpload')?.addEventListener('click', prepareMakerUpload);
$('registerMakerUpload')?.addEventListener('click', registerMakerUpload);
$('certifyMakerUpload')?.addEventListener('click', certifyMakerUpload);
$('publishMakerOnchain')?.addEventListener('click', publishCurrentMaker);

$('addSelectionRule')?.addEventListener('click', () => {
  const leftPartKey = $('ruleLeftPart').value;
  const leftItemKey = $('ruleLeftItem').value;
  const rightPartKey = $('ruleRightPart').value;
  const rightItemKey = $('ruleRightItem').value;
  if (!leftPartKey || !rightPartKey || leftPartKey === rightPartKey) {
    state.publishStatus = 'Choose two different parts for a selection rule.';
    renderPublishAction();
    return;
  }
  const duplicate = state.rules.some((rule) =>
    (rule.leftPartKey === leftPartKey && rule.leftItemKey === leftItemKey && rule.rightPartKey === rightPartKey && rule.rightItemKey === rightItemKey)
    || (rule.leftPartKey === rightPartKey && rule.leftItemKey === rightItemKey && rule.rightPartKey === leftPartKey && rule.rightItemKey === leftItemKey));
  if (!duplicate) {
    state.rules.push({ leftPartKey, leftItemKey, rightPartKey, rightItemKey });
    invalidateMakerUpload();
  }
  renderAll();
});

['ruleLeftPart', 'ruleRightPart'].forEach((id) => {
  $(id)?.addEventListener('change', () => {
    renderRuleItemOptions(id === 'ruleLeftPart' ? 'ruleLeftItem' : 'ruleRightItem', $(id).value);
  });
});

$('addPaletteLink')?.addEventListener('click', () => {
  const primaryPartKey = $('palettePrimaryPart').value;
  const linkedPartKey = $('paletteLinkedPart').value;
  if (!primaryPartKey || !linkedPartKey || primaryPartKey === linkedPartKey) return;
  const duplicate = state.paletteLinks.some((link) =>
    (link.primaryPartKey === primaryPartKey && link.linkedPartKey === linkedPartKey)
    || (link.primaryPartKey === linkedPartKey && link.linkedPartKey === primaryPartKey));
  if (!duplicate) {
    state.paletteLinks.push({ primaryPartKey, linkedPartKey });
    invalidateMakerUpload();
  }
  renderAll();
});

$('saveMakerDraft')?.addEventListener('click', () => {
  const draft = {
    templateId: state.templateId,
    savedAt: new Date().toISOString(),
    manifest: creatorManifest(),
    visual: state.visual,
    rules: state.rules,
    paletteLinks: state.paletteLinks,
  };
  localStorage.setItem(makerDraftStorageKey(), JSON.stringify(draft));
  $('saveMakerDraft').textContent = 'Saved · reselect files after reload';
});

$('downloadManifest').addEventListener('click', () => {
  download(`${slug($('creatorTemplateName').value)}-manifest.json`, JSON.stringify(creatorManifest(), null, 2));
});

$('downloadPackage').addEventListener('click', () => {
  download(`${slug($('profileName').value)}-oc-package.json`, JSON.stringify(ocPackage(), null, 2));
});

$('prepareOcUpload')?.addEventListener('click', prepareOcUpload);
$('registerOcUpload')?.addEventListener('click', registerOcUpload);
$('certifyOcUpload')?.addEventListener('click', certifyOcUpload);
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
  if (!state.walletConnected) {
    closeMakerModal();
    openAccountPanel();
    return;
  }
  const name = $('newMakerName').value.trim() || 'Untitled OC Maker';
  const canvas = document.querySelector('[data-canvas-choice].active')?.dataset.canvasChoice || '1:1';
  const canvasSize = canvas === '9:16' ? { width: 1080, height: 1920 } : { width: 1024, height: 1024 };
  const makerType = document.querySelector('[data-maker-type].active')?.dataset.makerType || 'Free combine';
  const id = `${slug(name)}-${Date.now().toString(36)}`;
  templates.unshift({
    id,
    source: 'local',
    name,
    category: 'daily',
    creator: $('creatorName').value || 'xiaopai',
    style: canvas,
    license: 'Personal use',
    royaltyBps: 300,
    price: 'Draft',
    accent: '#27c5c8',
    secondary: '#f0a23a',
    summary: `${makerType} OC Maker draft. Add Parts and item images in Character Maker.`,
    licenseNote: 'Draft maker. Configure release and publication before public use.',
  });
  activateMakerModel(id, { empty: true, canvas: canvasSize });
  syncTemplateFields();
  state.creatorView = 'edit';
  state.editorPanel = 'parts';
  $('newMakerName').value = '';
  closeMakerModal();
  renderAll();
  focusCreatorTop();
});

$('registerPart').addEventListener('click', () => {
  if (!state.walletConnected) {
    closePartModal();
    openAccountPanel();
    return;
  }
  const label = $('newPartName').value.trim() || 'New part';
  const key = `${slug(label)}-${Date.now().toString(36)}`;
  const kind = document.querySelector('[data-new-part-type].active')?.dataset.newPartType || 'standard';
  const itemLabel = $('newPartItemName').value.trim() || 'Normal';
  const layerName = $('newPartLayerName').value.trim() || 'Normal';
  const menuVisible = $('newPartMenuVisible').value === 'visible';
  const initialLayers = kind === 'left-right-pair'
    ? [{ id: 'left', name: 'Left', x: 0, y: 0, opacity: 100, blendMode: 'normal' }, { id: 'right', name: 'Right', x: 0, y: 0, opacity: 100, blendMode: 'normal' }]
    : [{ id: 'normal', name: layerName, x: 0, y: 0, opacity: 100, blendMode: 'normal' }];
  state.makerSlots.push({
    key,
    label,
    icon: label.slice(0, 2).toUpperCase(),
    colorKey: key,
    description: `${kind} part created in Character Maker`,
    kind,
    layerName,
    menuVisible,
    x: 0,
    y: 0,
    layers: initialLayers,
    colors: [{ id: 'default', name: 'Default', value: '#f0a23a' }],
  });
  state.slotOrder.push(key);
  state.layerOrder.push(...initialLayers.map((layer) => creatorLayerKey(key, layer.id)));
  state.makerParts[key] = [{ id: 'normal', label: itemLabel, displayOrder: 1, visibility: 'public', images: {}, iconAsset: null }];
  state.visual[key] = 'normal';
  state.visual.palette[key] = '#f0a23a';
  state.selectedSlot = key;
  state.selectedLayer = creatorLayerKey(key, initialLayers[0].id);
  state.selectedItem = 'normal';
  state.partSubView = 'items';
  invalidateMakerUpload();
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

syncTemplateFields();
restoreMakerDraft();
renderAll();
setPage(location.hash.replace('#', '') || 'templates');
