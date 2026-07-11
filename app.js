import {
  configureMakerEconomics,
  explorerObjectUrl,
  explorerTransactionUrl,
  certifyWalrusUpload,
  getMakerObjects,
  hashRecipe,
  initializeChain,
  listOwnedCreatorProfiles,
  listOwnedMakerAdminCaps,
  listOwnedMakers,
  listPublishedMakerIds,
  openWalletSelector,
  prepareWalrusUpload,
  publishMaker,
  registerAndUploadWalrus,
  resolvePublishedMakerObjects,
  resumeWalrusUpload,
  setMakerArchived,
  walrusFileUrl,
  walrusQuiltFileUrl,
  withdrawMakerRevenue,
} from './chain-runtime.js';
import {
  deleteMakerAssets,
  deleteMakerDraftRecord,
  deleteMakerUploadRecovery,
  loadMakerAssets,
  loadMakerDraftRecord,
  loadMakerUploadRecovery,
  replaceMakerAssets,
  saveMakerDraftRecord,
  saveMakerUploadRecovery,
} from './draft-store.js';
import { validateRemoteMakerManifest as validateMakerManifest } from './manifest-validation.js';
import {
  createDefaultLivingContent,
  createSoulidityImportBundle,
  createSoulidityImportJson,
  normalizeLivingContent,
  soulidityContentManifest,
  validateLivingContent,
} from './living-content.js';
import { responseBlobWithinLimit, responseBytesWithinLimit } from './remote-read.js';
import {
  assertSupportedMakerMintEconomics,
  assertSupportedMakerPaymentCoin,
  normalizeRuntimeConfig,
} from './runtime-config.js';

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
    id: 'astral-courier',
    source: 'creator-pack',
    manifestUrl: '/makers/astral-courier/animacraft-manifest.json',
    name: 'Astral Courier · 星夜信使',
    category: 'daily',
    creator: 'Animacraft Atelier',
    style: 'Japanese cel-shaded celestial portrait',
    license: 'Personal use',
    royaltyBps: 300,
    price: 'Free creator pack',
    accent: '#6f63ff',
    secondary: '#43d7e8',
    summary: 'A premium cel-shaded celestial courier maker with four skin tones, hairstyles, expressions, outfits, backgrounds, and five accessories.',
    licenseNote: 'Free personal Soul mint and avatar use with Maker provenance retained. Commercial use and resale rights follow the published on-chain policy. AI-assisted original art is disclosed in the creator pack.',
    coverUrl: '/makers/astral-courier/cover.png',
    mintingEnabled: true,
  },
  {
    id: 'hanamori-spirit',
    source: 'creator-pack',
    manifestUrl: '/makers/hanamori-spirit/animacraft-manifest.json',
    name: 'Hanamori Spirit · 花守灵契',
    category: 'fantasy',
    creator: 'Animacraft Atelier',
    style: 'Japanese cel-shaded spirit-garden portrait',
    license: 'Personal use',
    royaltyBps: 300,
    price: 'Free creator pack',
    accent: '#d94f45',
    secondary: '#4caa83',
    summary: 'A refined cel-shaded spirit-garden maker with four skin tones, hairstyles, expressions, ceremonial fantasy outfits, backgrounds, and five ornaments.',
    licenseNote: 'Free personal Soul mint and avatar use with Maker provenance retained. Commercial use and resale rights follow the published on-chain policy. AI-assisted original art is disclosed in the creator pack.',
    coverUrl: '/makers/hanamori-spirit/cover.png',
    mintingEnabled: true,
  },
  {
    id: 'daily-starlit',
    source: 'starter',
    name: 'Starlit Daily OC',
    category: 'daily',
    creator: 'Animacraft Lab',
    style: 'Daily icon',
    license: 'Personal use',
    royaltyBps: 300,
    price: 'Starter example',
    accent: '#7b5cff',
    secondary: '#2db7a3',
    summary: 'A daily OC maker for profile icons, character sheets, and lightweight original characters.',
    licenseNote: 'Generate personal icons and OC profiles. Commercial use requires separate creator permission.',
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
    price: 'Starter example',
    accent: '#2db7a3',
    secondary: '#f0a23a',
    summary: 'A fantasy-friendly maker for spirits, familiars, story characters, and worldbuilding.',
    licenseNote: 'Commercial use is allowed. The published Maker may separately charge an exact native-USDC mint fee.',
  },
  {
    id: 'chibi-idol',
    source: 'starter',
    name: 'Chibi Idol Maker',
    category: 'chibi',
    creator: 'Stage Mint',
    style: 'Chibi idol',
    license: 'Personal use',
    royaltyBps: 200,
    price: 'Starter example',
    accent: '#f06f8f',
    secondary: '#f0a23a',
    summary: 'A quick chibi maker for stage characters, fan OCs, and small profile images.',
    licenseNote: 'Personal use by default. Commercial use requires separate creator permission.',
  },
];

const swatches = ['#7b5cff', '#2db7a3', '#f06f8f', '#f0a23a', '#335c81', '#7d5a50', '#24202b', '#f1c9b1'];
const MAX_MAKER_PARTS = 750;
const MAX_MAKER_ITEMS = 5_000;
const MAX_MAKER_RULES = 1_000;
const MAX_SINGLE_PUBLISH_RECORDS = 450;
const MAX_ITEMS_PER_PART = 100;
const MAX_LAYERS_PER_PART = 32;
const MAX_COLORS_PER_PART = 32;

const suppliedConfig = window.ANIMACRAFT_CONFIG || {};
const runtimeConfig = normalizeRuntimeConfig(suppliedConfig, location.origin);
const canonicalSoulMintEnabled = runtimeConfig.canonicalSoulMintEnabled === true;
const localUiTest = ['127.0.0.1', 'localhost'].includes(location.hostname)
  && new URLSearchParams(location.search).get('ui-test') === '1';

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
    body: 'Register creator profile, public Parts, Items, Colors, selection and palette rules, archive state, and license policy on Sui.',
  },
  {
    key: 'oc',
    title: 'Soulidity mint',
    body: 'Animacraft validates the Maker recipe and hands Living Content to Soulidity, which mints the only finished Soul object.',
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
    walletFirstCopy: 'My Souls, creator tools, draft storage, publishing, and Soulidity minting unlock after wallet connection.',
    connectSuiWallet: 'Connect Sui wallet',
    myPageCopy: 'Works and on-chain OCs',
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
    publicMakers: 'public Makers',
    mainnetObjects: 'Mainnet objects',
    assetQuilts: 'asset quilts',
    sourceOnchain: 'On-chain Maker',
    sourceStarter: 'Starter example',
    sourceCreatorPack: 'Creator pack',
    partsLabel: 'Parts',
    itemsLabel: 'Items',
    royaltyPolicy: 'royalty policy',
    startMaking: 'Start making',
    connectToMake: 'Connect to make',
    viewMaker: 'View Maker',
    noMatchingMakers: 'No matching Makers found.',
    myOcs: 'My Souls',
    myOcsCopy: 'Soulidity-owned characters',
    creatorStudio: 'Creator Studio',
    creatorStudioCopy: 'Create, test, and publish Character Makers from one wallet-owned workspace.',
    newOcMaker: 'New OC Maker',
    makerLibrary: 'OC Maker Library',
    walletOwnedMakers: 'Wallet-owned Makers',
    preview: 'Preview',
    saveDraft: 'Save draft',
    exportManifest: 'Manifest',
    release: 'Release',
    makerTop: 'Maker Top',
    characterMaker: 'Character Maker',
    rules: 'Rules',
    paletteRules: 'Palette Rules',
    previewCheck: 'Preview Check',
    onchainPublish: 'On-chain Publish',
    settings: 'Settings',
    recipeJson: 'Recipe JSON',
    saveOcPackage: 'Save OC Package',
    prepareMint: 'Prepare Soul handoff',
    mintOc: 'Continue to Soulidity',
    currentSlot: 'Current Part',
    choosePart: 'Choose a Part',
    livePreview: 'Live Preview',
    templateLicense: 'Template License',
    currentColor: 'Current color',
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
    walletFirstCopy: '连接钱包后可使用我的 Soul、创作者工具、草稿保存、发布并进入 Soulidity 铸造。',
    connectSuiWallet: '连接 Sui 钱包',
    myPageCopy: '作品与链上 OC',
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
    publicMakers: '个公开模板',
    mainnetObjects: '主网对象',
    assetQuilts: '素材 Quilt',
    sourceOnchain: '链上模板',
    sourceStarter: '示例模板',
    sourceCreatorPack: '创作者模板',
    partsLabel: '部件',
    itemsLabel: '选项',
    royaltyPolicy: '版税政策',
    startMaking: '开始捏 OC',
    connectToMake: '连接钱包后开始',
    viewMaker: '查看模板',
    noMatchingMakers: '没有找到匹配的模板。',
    myOcs: '我的 OC',
    myOcsCopy: '钱包拥有的角色',
    creatorStudio: '创作者工作台',
    creatorStudioCopy: '在一个钱包工作区中创建、测试并发布角色模板。',
    newOcMaker: '新建 OC 模板',
    makerLibrary: 'OC 模板库',
    walletOwnedMakers: '钱包拥有的模板',
    preview: '预览',
    saveDraft: '保存草稿',
    exportManifest: '清单',
    release: '发布',
    makerTop: '模板概览',
    characterMaker: '角色创建器',
    rules: '组合规则',
    paletteRules: '配色规则',
    previewCheck: '发布检查',
    onchainPublish: '链上发布',
    settings: '设置',
    recipeJson: '配方 JSON',
    saveOcPackage: '保存 OC 包',
    prepareMint: '准备 Soul 交接包',
    mintOc: '前往 Soulidity',
    currentSlot: '当前部件',
    choosePart: '选择部件',
    livePreview: '实时预览',
    templateLicense: '模板授权',
    currentColor: '当前颜色',
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
    walletFirstCopy: '接続後、マイ OC、作成ツール、下書き保存、公開、ミントを利用できます。',
    connectSuiWallet: 'Sui ウォレット接続',
    myPageCopy: '作品とオンチェーン OC',
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
    publicMakers: '公開メーカー',
    mainnetObjects: 'メインネットオブジェクト',
    assetQuilts: 'アセット Quilt',
    sourceOnchain: 'オンチェーンメーカー',
    sourceStarter: 'スターター例',
    sourceCreatorPack: 'クリエイターパック',
    partsLabel: 'パーツ',
    itemsLabel: 'アイテム',
    royaltyPolicy: 'ロイヤリティ方針',
    startMaking: 'OC を作る',
    connectToMake: '接続して作る',
    viewMaker: 'メーカーを見る',
    noMatchingMakers: '一致するメーカーがありません。',
    myOcs: 'マイ OC',
    myOcsCopy: 'ウォレット所有キャラクター',
    creatorStudio: 'クリエイタースタジオ',
    creatorStudioCopy: '一つのウォレットワークスペースで Character Maker を作成、テスト、公開します。',
    newOcMaker: '新しい OC メーカー',
    makerLibrary: 'OC メーカーライブラリ',
    walletOwnedMakers: 'ウォレット所有メーカー',
    preview: 'プレビュー',
    saveDraft: '下書き保存',
    exportManifest: 'マニフェスト',
    release: '公開',
    makerTop: 'メーカー概要',
    characterMaker: 'キャラクターメーカー',
    rules: 'ルール',
    paletteRules: 'パレットルール',
    previewCheck: '公開チェック',
    onchainPublish: 'オンチェーン公開',
    settings: '設定',
    recipeJson: 'レシピ JSON',
    saveOcPackage: 'OC パッケージ保存',
    prepareMint: 'Soul 連携を準備',
    mintOc: 'Soulidity に進む',
    currentSlot: '現在のパーツ',
    choosePart: 'パーツを選択',
    livePreview: 'ライブプレビュー',
    templateLicense: 'テンプレートライセンス',
    currentColor: '現在の色',
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
    walletFirstCopy: '지갑을 연결하면 내 OC, 창작 도구, 초안 저장, 게시, 민팅을 사용할 수 있습니다.',
    connectSuiWallet: 'Sui 지갑 연결',
    myPageCopy: '작품과 온체인 OC',
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
    publicMakers: '공개 메이커',
    mainnetObjects: '메인넷 오브젝트',
    assetQuilts: '에셋 Quilt',
    sourceOnchain: '온체인 메이커',
    sourceStarter: '스타터 예시',
    sourceCreatorPack: '크리에이터 팩',
    partsLabel: '파트',
    itemsLabel: '아이템',
    royaltyPolicy: '로열티 정책',
    startMaking: 'OC 만들기',
    connectToMake: '연결하고 만들기',
    viewMaker: '메이커 보기',
    noMatchingMakers: '일치하는 메이커가 없습니다.',
    myOcs: '내 OC',
    myOcsCopy: '지갑 소유 캐릭터',
    creatorStudio: '크리에이터 스튜디오',
    creatorStudioCopy: '하나의 지갑 작업공간에서 Character Maker를 만들고 테스트하고 게시합니다.',
    newOcMaker: '새 OC 메이커',
    makerLibrary: 'OC 메이커 라이브러리',
    walletOwnedMakers: '지갑 소유 메이커',
    preview: '미리보기',
    saveDraft: '초안 저장',
    exportManifest: '매니페스트',
    release: '게시',
    makerTop: '메이커 개요',
    characterMaker: '캐릭터 메이커',
    rules: '규칙',
    paletteRules: '팔레트 규칙',
    previewCheck: '게시 검사',
    onchainPublish: '온체인 게시',
    settings: '설정',
    recipeJson: '레시피 JSON',
    saveOcPackage: 'OC 패키지 저장',
    prepareMint: 'Soul 연동 준비',
    mintOc: 'Soulidity로 계속',
    currentSlot: '현재 파트',
    choosePart: '파트 선택',
    livePreview: '실시간 미리보기',
    templateLicense: '템플릿 라이선스',
    currentColor: '현재 색상',
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
    walletFirstCopy: 'Sau khi kết nối ví, bạn có thể dùng OC của tôi, công cụ creator, lưu bản nháp, xuất bản và mint.',
    connectSuiWallet: 'Kết nối ví Sui',
    myPageCopy: 'Tác phẩm và OC on-chain',
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
    publicMakers: 'Maker công khai',
    mainnetObjects: 'Đối tượng Mainnet',
    assetQuilts: 'Quilt tài nguyên',
    sourceOnchain: 'Maker on-chain',
    sourceStarter: 'Ví dụ khởi đầu',
    sourceCreatorPack: 'Gói nhà sáng tạo',
    partsLabel: 'Part',
    itemsLabel: 'Item',
    royaltyPolicy: 'chính sách royalty',
    startMaking: 'Bắt đầu tạo OC',
    connectToMake: 'Kết nối để tạo',
    viewMaker: 'Xem Maker',
    noMatchingMakers: 'Không tìm thấy Maker phù hợp.',
    myOcs: 'OC của tôi',
    myOcsCopy: 'Nhân vật thuộc sở hữu ví',
    creatorStudio: 'Creator Studio',
    creatorStudioCopy: 'Tạo, thử nghiệm và xuất bản Character Maker trong một không gian thuộc ví.',
    newOcMaker: 'OC Maker mới',
    makerLibrary: 'Thư viện OC Maker',
    walletOwnedMakers: 'Maker thuộc sở hữu ví',
    preview: 'Xem trước',
    saveDraft: 'Lưu bản nháp',
    exportManifest: 'Manifest',
    release: 'Xuất bản',
    makerTop: 'Tổng quan Maker',
    characterMaker: 'Character Maker',
    rules: 'Quy tắc',
    paletteRules: 'Quy tắc bảng màu',
    previewCheck: 'Kiểm tra xuất bản',
    onchainPublish: 'Xuất bản on-chain',
    settings: 'Cài đặt',
    recipeJson: 'Recipe JSON',
    saveOcPackage: 'Lưu gói OC',
    prepareMint: 'Chuẩn bị chuyển sang Soul',
    mintOc: 'Tiếp tục tới Soulidity',
    currentSlot: 'Part hiện tại',
    choosePart: 'Chọn Part',
    livePreview: 'Xem trước trực tiếp',
    templateLicense: 'Giấy phép mẫu',
    currentColor: 'Màu hiện tại',
  },
};

const requiredLocaleKeys = Object.keys(i18n.en);
Object.entries(i18n).forEach(([locale, dictionary]) => {
  const missing = requiredLocaleKeys.filter((key) => !Object.hasOwn(dictionary, key));
  if (missing.length) throw new Error(`Locale ${locale} is missing: ${missing.join(', ')}`);
});

const protocolSteps = [
  ['01', 'Material Layers', 'Creators upload transparent PNGs, anchors, order, and slot metadata to Walrus.'],
  ['02', 'Template Contract', 'A Maker links immutable art and rules to a transferable AdminCap and a native-USDC Treasury.'],
  ['03', 'OC Recipe', 'A user-made OC becomes a recipe that references templates, parts, colors, and license snapshots.'],
  ['04', 'Living Content', 'Soul Character, Memory, and Skills & Docs are resolved from editable Maker defaults.'],
  ['05', 'Canonical Soul', 'Soulidity consumes the Maker authorization and mints the only finished character object.'],
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
  livingContent: createDefaultLivingContent(),
  livingDocument: 'soulMd',
  walletConnected: false,
  walletAddress: '',
  walletProvider: null,
  walletStatus: 'disconnected',
  publishing: false,
  publishStatus: '',
  publishDigest: '',
  makerObjectId: '',
  makerTreasuryObjectId: '',
  makerAdminCapObjectId: '',
  treasuryBalanceLoadedFor: '',
  treasuryBalanceLoading: false,
  makerArchived: false,
  makerUploadSession: null,
  pendingMakerAssets: [],
  makerUploadStage: 'idle',
  makerQuiltId: '',
  pendingMakerCoverBlob: null,
  hasMakerUploadRecovery: false,
  pendingMakerManifestJson: '',
  minting: false,
  mintStatus: '',
  mintDigest: '',
  mintObjectId: '',
  ocUploadSession: null,
  ocUploadStage: 'idle',
  hasOcUploadRecovery: false,
  ocImagePatchId: '',
  ocProfilePatchId: '',
  pendingOcImageBlob: null,
  pendingOcProfileBlob: null,
  pendingOcPackage: null,
  pendingOcRecipeHash: null,
  pendingOcRecipeJson: '',
  pendingOcFingerprint: '',
  previewingMaker: false,
  pendingWalletPage: '',
  pendingWalletTemplateId: '',
  routeMakerReference: '',
  chainMakersLoadedFor: '',
  chainMakersLoading: false,
  chainMakerLoadError: '',
  recoveringMakerDigest: '',
  creatorProfileObjectId: '',
  ownedCharacters: [],
  ownedCharactersLoading: false,
  ownedCharactersError: '',
  ownedCharactersLoadedFor: '',
  draftSaveStatus: 'idle',
  draftSaveMessage: '',
  locale: Object.hasOwn(i18n, localStorage.getItem('animacraft-locale') || '') ? localStorage.getItem('animacraft-locale') : 'en',
};

const makerModels = new Map();
const loadedMakerDrafts = new Set();
const loadedLocalMakerIndexes = new Set();
const loadedMakerAssetDrafts = new Set();
const loadedMakerUploadRecoveries = new Set();
const loadedOcUploadRecoveries = new Set();
let pendingConfirmation = null;
let makerAutosaveTimer = null;

function makerDraftStorageKey(templateId = state.templateId) {
  return `animacraft-maker-draft-v2:${state.walletAddress || 'local'}:${templateId}`;
}

function makerAssetStorageKey(templateId = state.templateId) {
  return `${state.walletAddress || 'local'}:${templateId}`;
}

function ocUploadStorageKey(templateId = state.templateId) {
  const template = templates.find((candidate) => candidate.id === templateId);
  return `${state.walletAddress || 'local'}:oc:${template?.objectId || runtimeConfig.featuredMakers?.[templateId] || templateId}`;
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

function createMakerModel({ empty = false, starter = false, canvas = { width: 1024, height: 1024 } } = {}) {
  const modelSlots = empty ? [] : structuredClone(slots);
  const modelParts = starter
    ? Object.fromEntries(slots.map((slot) => [slot.key, [{ id: 'normal', label: 'Normal', displayOrder: 1, visibility: 'public', images: {}, iconAsset: null }]]))
    : empty ? {} : structuredClone(parts);
  const visual = defaultMakerVisual();
  if (starter) modelSlots.forEach((slot) => { visual[slot.key] = 'normal'; });
  return {
    canvas: { ...canvas },
    slots: modelSlots,
    parts: modelParts,
    slotOrder: modelSlots.map((slot) => slot.key),
    layerOrder: [],
    visual,
    rules: [],
    paletteLinks: empty ? [] : [{ primaryPartKey: 'hairBack', linkedPartKey: 'hairFront' }],
    livingContent: createDefaultLivingContent(),
    assets: [],
    publishDigest: '',
    publishStatus: '',
    makerObjectId: '',
    makerTreasuryObjectId: '',
    makerAdminCapObjectId: '',
    makerArchived: false,
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
    livingContent: state.livingContent,
    assets: state.assets,
    publishDigest: state.publishDigest,
    publishStatus: state.publishStatus,
    makerObjectId: state.makerObjectId,
    makerTreasuryObjectId: state.makerTreasuryObjectId,
    makerAdminCapObjectId: state.makerAdminCapObjectId,
    makerArchived: state.makerArchived,
  });
}

function resetOcUploadState() {
  state.minting = false;
  state.mintStatus = '';
  state.mintDigest = '';
  state.mintObjectId = '';
  state.ocUploadSession = null;
  state.ocUploadStage = 'idle';
  state.hasOcUploadRecovery = false;
  state.ocImagePatchId = '';
  state.ocProfilePatchId = '';
  state.pendingOcImageBlob = null;
  state.pendingOcProfileBlob = null;
  state.pendingOcPackage = null;
  state.pendingOcRecipeHash = null;
  state.pendingOcRecipeJson = '';
  state.pendingOcFingerprint = '';
}

function applyMakerModelToState(templateId, model) {
  const previousTemplateId = state.templateId;
  state.templateId = templateId;
  if (previousTemplateId !== templateId) resetOcUploadState();
  state.makerCanvas = model.canvas;
  state.makerSlots = model.slots;
  state.makerParts = model.parts;
  state.slotOrder = model.slotOrder;
  state.layerOrder = model.layerOrder;
  state.visual = model.visual;
  state.rules = model.rules;
  state.paletteLinks = model.paletteLinks;
  state.livingContent = normalizeLivingContent(model.livingContent, activeTemplate());
  state.assets = model.assets;
  state.publishDigest = model.publishDigest;
  state.publishStatus = model.publishStatus;
  state.makerObjectId = model.makerObjectId || '';
  state.makerTreasuryObjectId = model.makerTreasuryObjectId || '';
  state.makerAdminCapObjectId = model.makerAdminCapObjectId || '';
  if (state.makerTreasuryObjectId !== state.treasuryBalanceLoadedFor) state.treasuryBalanceLoadedFor = '';
  state.makerArchived = Boolean(model.makerArchived);
  state.makerUploadSession = null;
  state.pendingMakerAssets = [];
  state.makerUploadStage = 'idle';
  state.makerQuiltId = '';
  state.pendingMakerCoverBlob = null;
  state.hasMakerUploadRecovery = false;
  state.pendingMakerManifestJson = '';
  state.selectedSlot = state.slotOrder[0] || '';
  state.selectedItem = state.selectedSlot ? state.visual[state.selectedSlot] || slotItems(state.selectedSlot)[0]?.id || '' : '';
  const firstLayer = state.selectedSlot ? creatorLayers(allSlots()[0])[0] : null;
  state.selectedLayer = firstLayer ? creatorLayerKey(state.selectedSlot, firstLayer.id) : '';
  state.partSubView = 'items';
}

function activateMakerModel(templateId, options = {}) {
  if (makerAutosaveTimer) {
    clearTimeout(makerAutosaveTimer);
    makerAutosaveTimer = null;
    saveCurrentMakerDraft({ silent: true });
  }
  syncActiveMakerModelRefs();
  if (!makerModels.has(templateId)) makerModels.set(templateId, createMakerModel(options));
  const model = makerModels.get(templateId);
  applyMakerModelToState(templateId, model);
  if (state.walletConnected && !loadedMakerDrafts.has(makerDraftStorageKey(templateId))) restoreMakerDraft(templateId);
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
  livingContent: state.livingContent,
  assets: state.assets,
  publishDigest: state.publishDigest,
  publishStatus: state.publishStatus,
  makerObjectId: state.makerObjectId,
  makerTreasuryObjectId: state.makerTreasuryObjectId,
  makerAdminCapObjectId: state.makerAdminCapObjectId,
  makerArchived: state.makerArchived,
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
  renderAll();
}

function renderI18n() {
  document.documentElement.lang = state.locale === 'zh' ? 'zh-CN' : state.locale;
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

function makerIsPublished() {
  return Boolean(state.publishDigest || state.makerObjectId || activeTemplate()?.source === 'chain');
}

function makerLifecycle() {
  if (makerIsPublished()) return state.makerArchived ? 'archived' : 'published';
  return activeTemplate()?.source === 'local' ? 'draft' : 'starter';
}

function ensureMakerEditable() {
  if (!makerIsPublished()) return true;
  state.publishStatus = state.makerArchived
    ? 'This Maker is archived on Sui. Restore it before creating new OCs; its published version remains immutable.'
    : 'Published Makers are immutable. Create a new version to change Parts, Items, Layers, rules, or assets.';
  renderPublishAction();
  return false;
}

function localMakerIndexKey(address = state.walletAddress) {
  return `animacraft-local-makers-v1:${address || 'local'}`;
}

function persistLocalMakerIndex() {
  if (!state.walletAddress) return;
  const records = templates.filter((template) => template.source === 'local' && template.owner === state.walletAddress).map((template) => ({
    id: template.id,
    source: 'local',
    owner: state.walletAddress,
    name: template.name,
    category: template.category,
    creator: template.creator,
    style: template.style,
    license: template.license,
    royaltyBps: template.royaltyBps,
    mintingEnabled: template.mintingEnabled !== false,
    mintFeeEnabled: Boolean(template.mintFeeEnabled),
    mintPriceAtomic: Number(template.mintPriceAtomic || 0),
    price: template.price,
    accent: template.accent,
    secondary: template.secondary,
    summary: template.summary,
    licenseNote: template.licenseNote,
  }));
  localStorage.setItem(localMakerIndexKey(), JSON.stringify(records));
}

function loadLocalMakerIndex(address = state.walletAddress) {
  const key = localMakerIndexKey(address);
  if (!address || loadedLocalMakerIndexes.has(key)) return;
  loadedLocalMakerIndexes.add(key);
  try {
    const records = JSON.parse(localStorage.getItem(key) || '[]');
    if (!Array.isArray(records)) return;
    records.slice().reverse().forEach((record) => {
      const id = safeDraftText(record?.id, '', 128);
      if (!isSafeKey(id) || templates.some((template) => template.id === id)) return;
      templates.unshift({
        id,
        source: 'local',
        owner: address,
        name: safeDraftText(record.name, 'Untitled OC Maker', 128),
        category: ['daily', 'fantasy', 'chibi'].includes(record.category) ? record.category : 'daily',
        creator: safeDraftText(record.creator, shortAddress(address) || 'Creator', 128),
        style: safeDraftText(record.style, 'OC Maker', 128),
        license: ['Personal use', 'Free remix', 'Paid commercial', 'Exclusive commission'].includes(record.license) ? record.license : 'Personal use',
        royaltyBps: [0, 100, 200, 300, 400, 500].includes(Number(record.royaltyBps)) ? Number(record.royaltyBps) : 0,
        mintingEnabled: record.mintingEnabled !== false,
        mintFeeEnabled: Boolean(record.mintFeeEnabled),
        mintPriceAtomic: Number(record.mintPriceAtomic || 0),
        price: 'Draft',
        accent: safeCssColor(record.accent),
        secondary: safeCssColor(record.secondary, '#f0a23a'),
        summary: safeDraftText(record.summary, 'Character Maker draft.', 2_000),
        licenseNote: safeDraftText(record.licenseNote, 'Draft maker.', 2_000),
      });
    });
  } catch (error) {
    console.warn('Ignored an unreadable local Maker index.', error);
  }
}

function suiObjectFields(object) {
  const json = object?.json || {};
  return json.fields && typeof json.fields === 'object' ? json.fields : json;
}

function suiField(fields, ...names) {
  for (const name of names) {
    if (fields?.[name] !== undefined) return fields[name];
  }
  return undefined;
}

function suiJsonId(value) {
  if (typeof value === 'string') return /^0x[0-9a-f]+$/i.test(value.trim()) ? value.trim() : '';
  if (Array.isArray(value)) return value.map(suiJsonId).find(Boolean) || '';
  if (!value || typeof value !== 'object') return '';
  return suiJsonId(value.id || value.bytes || value.address || value.fields || value.vec || value.some);
}

function creatorProfileMakerIds(profile) {
  const fields = suiObjectFields(profile);
  const values = suiField(fields, 'maker_ids', 'makerIds');
  return Array.isArray(values) ? values.map(suiJsonId).filter(Boolean) : [];
}

function makerLicenseLabel(policy = {}) {
  const kind = Number(suiField(policy.fields || policy, 'license_kind', 'licenseKind') || 0);
  return ['Personal use', 'Free remix', 'Paid commercial', 'Exclusive commission'][kind] || 'Personal use';
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWalrusWithBackoff(url, options = {}, attempts = 4) {
  const retryableStatuses = new Set([404, 408, 429, 500, 502, 503, 504]);
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, options);
      if (response.ok || !retryableStatuses.has(response.status) || attempt === attempts - 1) return response;
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** attempt)));
  }
  throw lastError || new Error('Walrus did not return a readable response.');
}

function makerModelFromManifest(manifest, resolveAssetUrl, object = {}) {
  const savedParts = Array.isArray(manifest?.parts) ? manifest.parts : [];
  const visual = defaultMakerVisual();
  const modelParts = {};
  const modelSlots = savedParts.map((part) => {
    const colors = Array.isArray(part.colors) && part.colors.length
      ? part.colors.map((color) => ({ ...color }))
      : [{ id: 'default', name: 'Default', value: '#7b5cff' }];
    const layers = Array.isArray(part.layers) && part.layers.length
      ? part.layers.map((layer) => ({
          id: layer.id,
          name: layer.name || layer.id,
          x: Number(layer.x || 0),
          y: Number(layer.y || 0),
          opacity: Number(layer.opacity ?? 100),
          blendMode: layer.blendMode || 'normal',
          renderOrder: Number(layer.renderOrder || 0),
        }))
      : [{ id: 'normal', name: 'Normal', x: 0, y: 0, opacity: 100, blendMode: 'normal', renderOrder: 0 }];
    const colorKey = part.key;
    const slot = {
      key: part.key,
      label: part.label || part.key,
      icon: String(part.label || part.key).slice(0, 2).toUpperCase(),
      colorKey,
      description: 'Animacraft Maker Part',
      kind: part.kind || 'standard',
      menuVisible: part.menuVisible !== false,
      allowRemove: part.allowRemove !== false,
      defaultItemId: part.defaultItemId || part.items?.[0]?.id || '',
      x: Number(part.anchor?.x || 0),
      y: Number(part.anchor?.y || 0),
      rightX: Number(part.anchor?.rightX || 0),
      layers,
      colors,
      iconAsset: part.iconIdentifier ? {
        identifier: part.iconIdentifier,
        url: resolveAssetUrl(part.iconIdentifier),
        remote: true,
      } : null,
    };
    modelParts[part.key] = (part.items || []).map((item, index) => {
      const images = {};
      (item.images || []).forEach((image) => {
        if (!image.identifier) return;
        images[assetCellKey(image.layerId, image.colorId)] = {
          identifier: image.identifier,
          url: resolveAssetUrl(image.identifier),
          remote: true,
        };
      });
      return {
        id: item.id,
        label: item.label || item.id,
        displayOrder: Number(item.displayOrder || index + 1),
        visibility: item.visibility || 'public',
        images,
        iconAsset: item.iconIdentifier ? {
          identifier: item.iconIdentifier,
          url: resolveAssetUrl(item.iconIdentifier),
          remote: true,
        } : null,
      };
    });
    visual[part.key] = slot.defaultItemId || modelParts[part.key][0]?.id || '';
    visual.palette[colorKey] = colors[0].value;
    return slot;
  });
  const layerOrder = modelSlots.flatMap((slot) => slot.layers.map((layer) => ({
    key: creatorLayerKey(slot.key, layer.id),
    renderOrder: layer.renderOrder,
  }))).sort((left, right) => left.renderOrder - right.renderOrder).map((layer) => layer.key);
  const fields = suiObjectFields(object);
  return {
    canvas: {
      width: Number(manifest?.template?.canvas?.width || 1024),
      height: Number(manifest?.template?.canvas?.height || 1024),
    },
    slots: modelSlots,
    parts: modelParts,
    slotOrder: modelSlots.map((slot) => slot.key),
    layerOrder,
    visual,
    rules: Array.isArray(manifest?.rules) ? manifest.rules : [],
    paletteLinks: Array.isArray(manifest?.paletteLinks) ? manifest.paletteLinks : [],
    livingContent: normalizeLivingContent(manifest?.livingContent, manifest?.template),
    assets: (manifest?.assets || []).filter((asset) => asset.identifier).map((asset) => ({
      ...asset,
      url: resolveAssetUrl(asset.identifier),
      remote: true,
    })),
    publishDigest: object.previousTransaction || '',
    publishStatus: '',
    makerObjectId: object.objectId || '',
    makerTreasuryObjectId: object.treasuryId || suiJsonId(suiField(fields, 'treasury_id', 'treasuryId')),
    makerAdminCapObjectId: object.adminCapId || '',
    makerArchived: [true, 'true', 1, '1'].includes(suiField(fields, 'archived')),
  };
}

let bundledMakersLoaded = false;

function bundledAssetUrl(makerId, identifier) {
  const segments = String(identifier || '').split('/').filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === '.' || segment === '..' || !/^[a-zA-Z0-9._-]+$/.test(segment))) {
    throw new Error('Bundled Maker contains an unsafe asset identifier.');
  }
  const safePath = segments.map(encodeURIComponent).join('/');
  return `/makers/${encodeURIComponent(makerId)}/${safePath}`;
}

async function loadBundledMakers() {
  if (bundledMakersLoaded) return;
  bundledMakersLoaded = true;
  const creatorPacks = templates.filter((template) => template.source === 'creator-pack');
  const results = await Promise.allSettled(creatorPacks.map(async (template) => {
    const response = await fetch(template.manifestUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${template.name} manifest returned ${response.status}.`);
    const manifest = await response.json();
    validateMakerManifest(manifest);
    const model = makerModelFromManifest(manifest, (identifier) => bundledAssetUrl(template.id, identifier));
    makerModels.set(template.id, model);
    Object.assign(template, {
      name: manifest.template.name,
      creator: manifest.template.creator,
      style: manifest.template.style,
      summary: manifest.template.summary,
      license: makerLicenseLabel({ licenseKind: ['personal-use', 'free-remix', 'paid-commercial', 'exclusive-commission'].indexOf(manifest.template.license) }),
      licenseNote: manifest.template.licenseNote,
      royaltyBps: Number(manifest.template.royaltyBps || 0),
      mintingEnabled: manifest.template.mintingEnabled !== false,
    });
    if (state.templateId === template.id) applyMakerModelToState(template.id, model);
    return template.id;
  }));
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      creatorPacks[index].loadError = result.reason?.message || 'Bundled Maker could not be loaded.';
      console.error('Bundled Maker load failed', result.reason);
    }
  });
  bundledMakersLoaded = results.every((result) => result.status === 'fulfilled');
  const routed = templates.find((template) => template.id === state.routeMakerReference && makerModels.has(template.id));
  if (routed) {
    state.routeMakerReference = '';
    activateMakerModel(routed.id);
    syncTemplateFields();
    setPage('template');
  }
  renderAll();
}

async function hydrateChainMaker(object) {
  const fields = suiObjectFields(object);
  assertSupportedMakerPaymentCoin(
    suiField(fields, 'payment_coin_type', 'paymentCoinType'),
    runtimeConfig.paymentCoinType,
  );
  const economics = assertSupportedMakerMintEconomics({
    mintingEnabled: ![false, 'false', 0, '0'].includes(suiField(fields, 'minting_enabled', 'mintingEnabled')),
    mintFeeEnabled: [true, 'true', 1, '1'].includes(suiField(fields, 'mint_fee_enabled', 'mintFeeEnabled')),
    mintPriceAtomic: suiField(fields, 'mint_price_atomic', 'mintPriceAtomic') || 0,
  });
  const quiltId = String(suiField(fields, 'manifest_blob_id', 'manifestBlobId') || '');
  if (!quiltId) throw new Error(`OCMaker ${shortAddress(object.objectId)} has no Walrus Quilt ID.`);
  const response = await fetchWalrusWithBackoff(walrusQuiltFileUrl(quiltId, 'animacraft-manifest.json'));
  if (!response.ok) throw new Error(`Could not load Maker manifest (${response.status}).`);
  const manifestBytes = await responseBytesWithinLimit(response, 10 * 1024 * 1024, 'The Maker manifest');
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch {
    throw new Error('The Maker manifest is not valid JSON.');
  }
  validateMakerManifest(manifest);
  const featuredKey = Object.entries(runtimeConfig.featuredMakers || {}).find(([, objectId]) => objectId === object.objectId)?.[0];
  const recoveredTemplate = templates.find((candidate) => candidate.objectId === object.objectId);
  const id = featuredKey || recoveredTemplate?.id || `chain-${object.objectId}`;
  const policy = suiField(fields, 'policy') || {};
  const templateData = manifest.template || {};
  const template = templates.find((candidate) => candidate.id === id) || {
    id,
    category: 'daily',
    accent: '#27c5c8',
    secondary: '#f0a23a',
  };
  Object.assign(template, {
    source: 'chain',
    owned: Boolean(object.owned),
    objectId: object.objectId,
    quiltId,
    name: String(suiField(fields, 'name') || templateData.name || 'On-chain OC Maker'),
    creator: String(suiField(fields, 'creator') || templateData.creator || 'Sui creator'),
    style: String(templateData.style || 'OC Maker'),
    license: makerLicenseLabel(policy),
    royaltyBps: Number(suiField(policy.fields || policy, 'royalty_bps', 'royaltyBps') || templateData.royaltyBps || 0),
    mintingEnabled: economics.mintingEnabled,
    mintFeeEnabled: economics.mintFeeEnabled,
    mintPriceAtomic: economics.mintPriceAtomic,
    treasuryId: object.treasuryId || suiJsonId(suiField(fields, 'treasury_id', 'treasuryId')),
    adminCapId: object.adminCapId || '',
    price: economics.mintPriceAtomic > 0
      ? `${(economics.mintPriceAtomic / (10 ** runtimeConfig.paymentCoinDecimals)).toLocaleString()} ${runtimeConfig.paymentCoinSymbol}`
      : 'Free mint',
    summary: String(suiField(fields, 'description') || 'Published Animacraft Character Maker.'),
    licenseNote: String(templateData.licenseNote || 'License and royalty policy are read from the published Sui OCMaker.'),
    coverUrl: safeExternalUrl(
      suiField(fields, 'cover_url', 'coverUrl')
      || templateData.coverUrl
      || (templateData.coverIdentifier ? walrusQuiltFileUrl(quiltId, templateData.coverIdentifier) : ''),
    ),
  });
  if (!templates.includes(template)) templates.unshift(template);
  const model = makerModelFromManifest(manifest, (identifier) => walrusQuiltFileUrl(quiltId, identifier), object);
  makerModels.set(id, model);
  if (state.templateId === id) applyMakerModelToState(id, model);
}

async function loadChainMakers(owner = state.walletAddress) {
  const loadKey = owner || 'public';
  if (!packageConfigured() || state.chainMakersLoadedFor === loadKey) return;
  state.chainMakersLoadedFor = loadKey;
  state.chainMakersLoading = true;
  state.chainMakerLoadError = '';
  try {
    const featuredIds = Object.values(runtimeConfig.featuredMakers || {});
    let discoveryWarning = '';
    const [legacyOwned, profiles, adminCaps, publishedIds] = await Promise.all([
      owner ? listOwnedMakers(owner) : Promise.resolve([]),
      owner ? listOwnedCreatorProfiles(owner) : Promise.resolve([]),
      owner ? listOwnedMakerAdminCaps(owner) : Promise.resolve([]),
      listPublishedMakerIds().catch((error) => {
        discoveryWarning = error.message || 'Sui GraphQL Maker discovery is temporarily unavailable.';
        return [];
      }),
    ]);
    if (owner) state.creatorProfileObjectId = profiles[0]?.objectId || '';
    const profileMakerIds = profiles.flatMap(creatorProfileMakerIds);
    const capsByMaker = new Map(adminCaps.map((cap) => {
      const fields = suiObjectFields(cap);
      return [suiJsonId(suiField(fields, 'maker_id', 'makerId')), {
        adminCapId: cap.objectId,
        treasuryId: suiJsonId(suiField(fields, 'treasury_id', 'treasuryId')),
      }];
    }).filter(([makerId]) => makerId));
    const ownedIds = new Set([...legacyOwned.map((object) => object.objectId), ...capsByMaker.keys()]);
    const discovered = await getMakerObjects([
      ...featuredIds,
      ...publishedIds,
      ...profileMakerIds,
      ...legacyOwned.map((object) => object.objectId),
      ...(/^0x[0-9a-f]+$/i.test(state.routeMakerReference) ? [state.routeMakerReference] : []),
    ]);
    const byId = new Map(discovered.map((object) => {
      const authority = capsByMaker.get(object.objectId) || {};
      const makerFields = suiObjectFields(object);
      return [object.objectId, {
        ...object,
        ...authority,
        treasuryId: authority.treasuryId || suiJsonId(suiField(makerFields, 'treasury_id', 'treasuryId')),
        owned: ownedIds.has(object.objectId),
      }];
    }));
    const results = await Promise.allSettled([...byId.values()].map(hydrateChainMaker));
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length) state.chainMakerLoadError = `${failures.length} on-chain Maker${failures.length === 1 ? '' : 's'} could not be verified and loaded.`;
    else if (discoveryWarning) state.chainMakerLoadError = discoveryWarning;
    if (state.routeMakerReference) {
      const target = templates.find((template) => template.id === state.routeMakerReference || template.objectId === state.routeMakerReference);
      if (target) {
        state.routeMakerReference = '';
        activateMakerModel(target.id);
        syncTemplateFields();
        setPage('template');
      }
    }
  } catch (error) {
    state.chainMakerLoadError = error.message || 'Could not load on-chain Makers.';
    state.chainMakersLoadedFor = '';
  }
  state.chainMakersLoading = false;
  renderAll();
  if (state.page === 'make') restoreOcUploadRecovery(state.templateId);
}

function renderOwnedCharacters() {
  if (!$('ownedCharacterGrid')) return;
  if ($('ownedCharacterStatus')) $('ownedCharacterStatus').textContent = 'Finished characters are Soulidity Souls, not duplicate Animacraft tokens.';
  const soulidityUrl = safeExternalUrl(runtimeConfig.soulidityAppUrl) || '#';
  $('ownedCharacterGrid').innerHTML = `
    <div class="empty-state">
      Your minted characters, Living Content, social identity, and marketplace activity live in Soulidity.
      <a href="${escapeHtml(soulidityUrl)}" target="_blank" rel="noreferrer">Open Soulidity</a>
    </div>`;
}

async function loadOwnedCharacters({ force = false } = {}) {
  const owner = state.walletAddress;
  if (!owner || state.ownedCharactersLoading) return;
  if (!force && state.ownedCharactersLoadedFor === owner) return;
  state.ownedCharacters = [];
  state.ownedCharactersLoadedFor = owner;
  renderOwnedCharacters();
}

async function loadActiveTreasuryBalance({ force = false } = {}) {
  const treasuryId = activeTemplate()?.treasuryId || state.makerTreasuryObjectId;
  if (!treasuryId || state.treasuryBalanceLoading || (!force && state.treasuryBalanceLoadedFor === treasuryId)) return;
  state.treasuryBalanceLoading = true;
  if ($('makerTreasuryBalance')) $('makerTreasuryBalance').textContent = 'Loading Treasury balance from Sui…';
  try {
    const [treasury] = await getMakerObjects([treasuryId]);
    if (!treasury) throw new Error('The linked MakerTreasury could not be loaded.');
    const fields = suiObjectFields(treasury);
    const revenue = suiField(fields, 'revenue') || {};
    const revenueFields = revenue.fields && typeof revenue.fields === 'object' ? revenue.fields : revenue;
    const balanceAtomic = Number(suiField(revenueFields, 'value') || 0);
    activeTemplate().treasuryBalanceAtomic = Number.isSafeInteger(balanceAtomic) ? balanceAtomic : 0;
    state.treasuryBalanceLoadedFor = treasuryId;
  } catch (error) {
    activeTemplate().treasuryBalanceError = error.message || 'Treasury balance unavailable.';
    state.treasuryBalanceLoadedFor = '';
  } finally {
    state.treasuryBalanceLoading = false;
    renderMakerLifecycle();
  }
}

async function recoverPublishedMakerIndex() {
  const digest = state.publishDigest;
  if (!digest || state.makerObjectId || !packageConfigured() || state.recoveringMakerDigest === digest) return;
  state.recoveringMakerDigest = digest;
  state.publishStatus = 'Published transaction found. Resolving the OCMaker object id from Sui indexing…';
  renderAll();
  try {
    const indexed = await resolvePublishedMakerObjects(digest);
    const makerObjectId = indexed.makerObjectId;
    if (!makerObjectId) throw new Error('The publication transaction is indexed, but its OCMaker object was not found.');
    if (state.publishDigest !== digest) return;
    state.makerObjectId = makerObjectId;
    state.makerTreasuryObjectId = indexed.makerTreasuryObjectId || state.makerTreasuryObjectId;
    state.makerAdminCapObjectId = indexed.makerAdminCapObjectId || state.makerAdminCapObjectId;
    state.creatorProfileObjectId = indexed.creatorProfileObjectId || state.creatorProfileObjectId;
    state.publishStatus = '';
    Object.assign(activeTemplate(), {
      source: 'chain',
      objectId: makerObjectId,
      treasuryId: state.makerTreasuryObjectId,
      adminCapId: state.makerAdminCapObjectId,
      quiltId: state.makerQuiltId || activeTemplate().quiltId || '',
      price: activeTemplate().mintFeeEnabled ? `${atomicCoinToDecimal(activeTemplate().mintPriceAtomic)} ${runtimeConfig.paymentCoinSymbol}` : 'Free mint',
    });
    syncActiveMakerModelRefs();
    await saveCurrentMakerDraft({ silent: true });
    persistLocalMakerIndex();
    state.chainMakersLoadedFor = '';
    await loadChainMakers(state.walletAddress);
  } catch (error) {
    state.publishStatus = `${error.message || 'The OCMaker object id is not available yet'} The recovery draft remains in this browser.`;
  } finally {
    if (state.recoveringMakerDigest === digest) state.recoveringMakerDigest = '';
    renderAll();
  }
}

function openConfirmation({ title, message, confirmLabel = 'Delete', action }) {
  pendingConfirmation = action;
  $('confirmActionTitle').textContent = title;
  $('confirmActionMessage').textContent = message;
  $('confirmActionButton').textContent = confirmLabel;
  $('confirmActionModal').classList.add('active');
  $('confirmActionModal').setAttribute('aria-hidden', 'false');
  $('confirmActionButton').focus();
}

function closeConfirmation() {
  pendingConfirmation = null;
  $('confirmActionModal').classList.remove('active');
  $('confirmActionModal').setAttribute('aria-hidden', 'true');
}

function revokeMakerObjectUrls(model = makerModels.get(state.templateId)) {
  Object.values(model?.parts || {}).flat().forEach((item) => {
    if (item.iconAsset?.url) URL.revokeObjectURL(item.iconAsset.url);
    Object.values(item.images || {}).forEach((asset) => asset?.url && URL.revokeObjectURL(asset.url));
  });
  (model?.slots || []).forEach((slot) => {
    if (slot.iconAsset?.url) URL.revokeObjectURL(slot.iconAsset.url);
  });
}

function makerAssetRecordKey(kind, slot = '', itemId = '', layerId = '', colorId = '') {
  return [kind, slot, itemId, layerId, colorId].map((value) => encodeURIComponent(String(value || ''))).join('|');
}

function makerAssetRecords() {
  return allSlots().flatMap((slot) => {
    const records = [];
    if (slot.iconAsset?.file) {
      records.push({
        assetKey: makerAssetRecordKey('part-icon', slot.key),
        kind: 'part-icon',
        slot: slot.key,
        blob: slot.iconAsset.file,
        fileName: slot.iconAsset.file.name,
        fileType: slot.iconAsset.file.type,
        lastModified: slot.iconAsset.file.lastModified || Date.now(),
        width: slot.iconAsset.width || 0,
        height: slot.iconAsset.height || 0,
      });
    }
    slotItems(slot.key).forEach((item) => {
      if (item.iconAsset?.file) {
        records.push({
          assetKey: makerAssetRecordKey('item-icon', slot.key, item.id),
          kind: 'item-icon',
          slot: slot.key,
          itemId: item.id,
          blob: item.iconAsset.file,
          fileName: item.iconAsset.file.name,
          fileType: item.iconAsset.file.type,
          lastModified: item.iconAsset.file.lastModified || Date.now(),
          width: item.iconAsset.width || 0,
          height: item.iconAsset.height || 0,
        });
      }
      Object.entries(item.images || {}).forEach(([cellKey, asset]) => {
        if (!asset?.file) return;
        const [layerId, colorId] = cellKey.split(':');
        records.push({
          assetKey: makerAssetRecordKey('item-layer', slot.key, item.id, layerId, colorId),
          kind: 'item-layer',
          slot: slot.key,
          itemId: item.id,
          layerId,
          colorId,
          blob: asset.file,
          fileName: asset.file.name,
          fileType: asset.file.type,
          lastModified: asset.file.lastModified || Date.now(),
          width: asset.width || 0,
          height: asset.height || 0,
          warning: asset.warning || '',
        });
      });
    });
    return records;
  });
}

function storedAsset(record) {
  const file = record.blob instanceof File
    ? record.blob
    : new File([record.blob], record.fileName || 'asset.png', {
        type: record.fileType || record.blob?.type || 'application/octet-stream',
        lastModified: record.lastModified || Date.now(),
      });
  return {
    file,
    url: URL.createObjectURL(file),
    width: Number(record.width || 0),
    height: Number(record.height || 0),
    warning: record.warning || '',
    restored: true,
  };
}

async function restoreMakerAssets(templateId = state.templateId) {
  const assetStorageKey = makerAssetStorageKey(templateId);
  if (loadedMakerAssetDrafts.has(assetStorageKey) || activeTemplate()?.source === 'chain') return;
  loadedMakerAssetDrafts.add(assetStorageKey);
  try {
    const records = await loadMakerAssets(assetStorageKey);
    if (state.templateId !== templateId) {
      if (state.templateId !== templateId) loadedMakerAssetDrafts.delete(assetStorageKey);
      return;
    }
    if (!records.length) {
      await restoreMakerUploadRecovery(templateId);
      return;
    }
    records.forEach((record) => {
      const slot = allSlots().find((candidate) => candidate.key === record.slot);
      if (!slot || !record.blob) return;
      const asset = storedAsset(record);
      if (record.kind === 'part-icon') {
        if (slot.iconAsset?.url) URL.revokeObjectURL(slot.iconAsset.url);
        slot.iconAsset = asset;
        return;
      }
      const item = slotItems(slot.key).find((candidate) => candidate.id === record.itemId);
      if (!item) {
        URL.revokeObjectURL(asset.url);
        return;
      }
      if (record.kind === 'item-icon') {
        if (item.iconAsset?.url) URL.revokeObjectURL(item.iconAsset.url);
        item.iconAsset = asset;
        return;
      }
      if (record.kind === 'item-layer') {
        const cellKey = assetCellKey(record.layerId, record.colorId);
        if (item.images?.[cellKey]?.url) URL.revokeObjectURL(item.images[cellKey].url);
        item.images ||= {};
        item.images[cellKey] = asset;
      }
    });
    syncCreatorAssets();
    syncActiveMakerModelRefs();
    state.draftSaveStatus = 'saved';
    state.draftSaveMessage = `${records.length} local asset${records.length === 1 ? '' : 's'} restored`;
    await restoreMakerUploadRecovery(templateId);
    renderAll();
  } catch (error) {
    loadedMakerAssetDrafts.delete(assetStorageKey);
    state.draftSaveStatus = 'error';
    state.draftSaveMessage = error.message || 'Local PNG assets could not be restored.';
    renderMakerLifecycle();
  }
}

async function saveCurrentMakerDraft({ silent = false } = {}) {
  if (!state.walletConnected || !state.walletAddress) {
    if (silent) return null;
    throw new Error('Connect the wallet that owns this draft before saving it.');
  }
  syncCreatorAssets();
  const templateId = state.templateId;
  const storageKey = makerDraftStorageKey(templateId);
  const assetStorageKey = makerAssetStorageKey(templateId);
  const draft = {
    templateId,
    savedAt: new Date().toISOString(),
    manifest: creatorManifest(),
    visual: state.visual,
    rules: state.rules,
    paletteLinks: state.paletteLinks,
    chain: {
      publishDigest: state.publishDigest,
      makerObjectId: state.makerObjectId,
      makerTreasuryObjectId: state.makerTreasuryObjectId,
      makerAdminCapObjectId: state.makerAdminCapObjectId,
      archived: state.makerArchived,
    },
  };
  state.draftSaveStatus = 'saving';
  state.draftSaveMessage = '';
  if (!silent) renderMakerLifecycle();
  try {
    const records = makerAssetRecords();
    await saveMakerDraftRecord(storageKey, draft);
    await replaceMakerAssets(assetStorageKey, records);
    localStorage.removeItem(storageKey);
    persistLocalMakerIndex();
    loadedMakerAssetDrafts.add(assetStorageKey);
    if (state.templateId === templateId) {
      state.draftSaveStatus = 'saved';
      state.draftSaveMessage = `${records.length} local asset${records.length === 1 ? '' : 's'} saved in this browser`;
    }
  } catch (error) {
    if (state.templateId === templateId) {
      state.draftSaveStatus = 'error';
      state.draftSaveMessage = error.message || 'The draft could not be saved locally.';
    }
    if (!silent) throw error;
  } finally {
    if (state.templateId === templateId) renderMakerLifecycle();
  }
  return draft;
}

function scheduleMakerAutosave() {
  if (!state.walletConnected || makerIsPublished()) return;
  const templateId = state.templateId;
  clearTimeout(makerAutosaveTimer);
  state.draftSaveStatus = 'dirty';
  state.draftSaveMessage = 'Unsaved changes';
  makerAutosaveTimer = setTimeout(() => {
    if (state.templateId !== templateId || makerIsPublished()) return;
    saveCurrentMakerDraft({ silent: true });
  }, 900);
}

function activeMakerObjectId() {
  return activeTemplate()?.objectId || runtimeConfig.featuredMakers?.[activeTemplate().id] || '';
}

function assetReady(asset) {
  return Boolean(asset?.file || asset?.url || asset?.patchId);
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
  if (slot.kind === 'last-bastion') slot.allowRemove = false;
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

function selectedColorRecord(slot) {
  const colors = creatorColors(slot);
  const selected = String(state.visual.palette[slot.colorKey] || '').toLowerCase();
  return colors.find((color) => String(color.value || '').toLowerCase() === selected) || colors[0] || null;
}

function itemLayerAsset(slot, item, layer) {
  const color = selectedColorRecord(slot);
  return color ? item?.images?.[assetCellKey(layer.id, color.id)] : null;
}

function itemPickerAsset(slot, item) {
  if (item?.iconAsset?.url) return item.iconAsset;
  for (const layer of creatorLayers(slot)) {
    const asset = itemLayerAsset(slot, item, layer);
    if (asset?.url) return asset;
  }
  return Object.values(item?.images || {}).find((asset) => asset?.url) || null;
}

function layerInlineStyle(layer) {
  const x = Number.isFinite(Number(layer.x)) ? Number(layer.x) : 0;
  const y = Number.isFinite(Number(layer.y)) ? Number(layer.y) : 0;
  const xPercent = (x / Math.max(1, state.makerCanvas.width)) * 100;
  const yPercent = (y / Math.max(1, state.makerCanvas.height)) * 100;
  const opacity = Math.min(100, Math.max(0, Number(layer.opacity ?? 100))) / 100;
  const blendMode = ['normal', 'multiply', 'screen', 'overlay'].includes(layer.blendMode) ? layer.blendMode : 'normal';
  return `--layer-x:${xPercent.toFixed(4)}%;--layer-y:${yPercent.toFixed(4)}%;opacity:${opacity};mix-blend-mode:${blendMode}`;
}

function uploadedAssetCount(slot) {
  return slotItems(slot.key).reduce((count, item) => count + Object.values(item.images || {}).filter(assetReady).length, 0);
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
  if (makerIsPublished()) return;
  state.makerUploadSession = null;
  state.pendingMakerAssets = [];
  state.makerUploadStage = 'idle';
  state.makerQuiltId = '';
  state.pendingMakerCoverBlob = null;
  state.pendingMakerManifestJson = '';
  state.publishDigest = '';
  state.publishStatus = message;
  const recoveryKey = makerAssetStorageKey();
  loadedMakerUploadRecoveries.delete(recoveryKey);
  deleteMakerUploadRecovery(recoveryKey).catch((error) => console.warn('Could not clear stale Walrus recovery data.', error));
  scheduleMakerAutosave();
}

async function persistMakerUploadRecovery() {
  const session = state.makerUploadSession;
  if (!session?.checkpoint || !state.pendingMakerCoverBlob || !state.pendingMakerManifestJson) return;
  const recoveryKey = makerAssetStorageKey();
  await saveMakerUploadRecovery(recoveryKey, {
    owner: session.owner,
    stage: state.makerUploadStage,
    checkpoint: session.checkpoint,
    registerDigest: session.registerDigest || '',
    certifyDigest: session.certifyDigest || '',
    quiltBlobId: state.makerQuiltId || session.quiltBlobId || '',
    files: (session.files || []).map(({ id, blobId }) => ({ id, blobId })),
    manifestJson: state.pendingMakerManifestJson,
    coverBlob: state.pendingMakerCoverBlob,
  });
  state.hasMakerUploadRecovery = true;
  loadedMakerUploadRecoveries.add(recoveryKey);
}

async function clearMakerUploadRecovery(templateId = state.templateId) {
  const recoveryKey = makerAssetStorageKey(templateId);
  loadedMakerUploadRecoveries.delete(recoveryKey);
  await deleteMakerUploadRecovery(recoveryKey);
  if (state.templateId === templateId) state.hasMakerUploadRecovery = false;
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
  const targetRatio = state.makerCanvas.width / state.makerCanvas.height;
  const imageRatio = bitmap.width / bitmap.height;
  if (Math.abs(targetRatio - imageRatio) > 0.005) {
    const expected = `${state.makerCanvas.width}:${state.makerCanvas.height}`;
    bitmap.close();
    throw new Error(`Item images must match this Maker's ${expected} canvas ratio.`);
  }
  const asset = {
    file,
    url: URL.createObjectURL(file),
    width: bitmap.width,
    height: bitmap.height,
    warning: bitmap.width < state.makerCanvas.width || bitmap.height < state.makerCanvas.height
      ? `Below the recommended ${state.makerCanvas.width} × ${state.makerCanvas.height} px.`
      : '',
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

function isSafeKey(value) {
  return /^[a-zA-Z0-9_-]+$/.test(String(value || ''));
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

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || ''), location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function utf8Length(value) {
  return new TextEncoder().encode(String(value || '')).length;
}

function bytesToHex(bytes) {
  return `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function safeCssColor(value, fallback = '#27c5c8') {
  const color = String(value || '').trim();
  return /^(#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([\d\s.,%+-]+\))$/i.test(color) ? color : fallback;
}

function finiteNumber(value, fallback = 0, minimum = -Infinity, maximum = Infinity) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function decimalCoinToAtomic(value, decimals = runtimeConfig.paymentCoinDecimals) {
  const text = String(value ?? '').trim();
  const scale = Number(decimals);
  if (!Number.isInteger(scale) || scale < 0 || scale > 18 || !/^\d+(?:\.\d+)?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > scale) return null;
  const atomic = (BigInt(whole) * (10n ** BigInt(scale))) + BigInt((fraction || '').padEnd(scale, '0') || '0');
  return atomic <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(atomic) : null;
}

function atomicCoinToDecimal(value, decimals = runtimeConfig.paymentCoinDecimals) {
  const scale = 10 ** Number(decimals || 0);
  return Number(value || 0) / scale;
}

function safeDraftText(value, fallback = '', maxLength = 2_000) {
  return String(value ?? fallback).slice(0, maxLength);
}

function splitList(value) {
  return String(value).split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
}

function download(name, content, type = 'application/json') {
  const contentType = /^(text\/|application\/(json|javascript|xml))/.test(type) ? `${type};charset=utf-8` : type;
  const blob = new Blob([content], { type: contentType });
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

function packageConfigured() {
  return /^0x[0-9a-f]+$/i.test(String(runtimeConfig.packageId || '').trim()) && !runtimeConfig.packageId.includes('TODO');
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
  const packageReady = packageConfigured();
  const walrusReady = Boolean(runtimeConfig.walrusUploadRelayUrl && runtimeConfig.walrusAggregatorUrl);
  const discoveryKey = state.walletAddress || 'public';
  const discoveryReady = packageReady && !state.chainMakersLoading && !state.chainMakerLoadError && state.chainMakersLoadedFor === discoveryKey;
  return [
    ['Network', runtimeConfig.network, 'Sui network used by wallet transactions.', 'ready'],
    ['Wallet', walletReady ? shortAddress(state.walletAddress) || 'Connected' : 'Not connected', walletReady ? 'Ready to sign creator and OC transactions.' : 'Connect before publishing or minting.', walletReady ? 'ready' : 'wait'],
    ['Package', packageReady ? shortAddress(runtimeConfig.packageId) : 'Draft package id', packageReady ? 'Move package can be called from PTBs.' : 'Publish Move package, then set packageId in config.js.', packageReady ? 'ready' : 'wait'],
    ['Walrus', walrusReady ? `${runtimeConfig.network} upload configured` : 'Missing endpoint', 'Assets are uploaded before their blob ids are committed to the maker transaction.', walrusReady ? 'ready' : 'wait'],
    ['Discovery', state.chainMakersLoading ? 'Syncing Makers' : state.chainMakerLoadError || (discoveryReady ? 'Chain-derived' : 'Waiting'), discoveryReady ? 'Published Makers are discovered from Sui events and hydrated from certified Walrus manifests.' : 'Set the published package id to enable the public on-chain Maker gallery.', discoveryReady ? 'ready' : 'wait'],
  ];
}

function filteredTemplates() {
  const query = state.search.trim().toLowerCase();
  return templates.filter((template) => {
    if (template.source === 'local') return false;
    if (template.source === 'chain' && makerModels.get(template.id)?.makerArchived) return false;
    const matchesFilter = state.filter === 'all' || template.category === state.filter;
    const haystack = `${template.name} ${template.creator} ${template.style} ${template.license} ${template.summary}`.toLowerCase();
    return matchesFilter && (!query || haystack.includes(query));
  });
}

function templateSourceLabel(template) {
  if (template.source === 'chain') return t('sourceOnchain');
  if (template.source === 'creator-pack') return t('sourceCreatorPack');
  return t('sourceStarter');
}

function templateModelMetrics(template) {
  const model = makerModels.get(template.id);
  return {
    parts: model?.slots?.length ?? slots.length,
    items: model?.parts
      ? Object.values(model.parts).reduce((total, items) => total + items.length, 0)
      : Object.values(parts).reduce((total, items) => total + items.length, 0),
  };
}

function setPage(page) {
  const previousPage = state.page;
  const requestedPage = page === 'editor' ? 'make' : page === 'protocol' ? 'docs' : page;
  state.page = !state.walletConnected && !['templates', 'template', 'docs'].includes(requestedPage) ? 'templates' : requestedPage;
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
  const onDeepLink = /^\/(maker|oc)\//.test(location.pathname);
  history.replaceState(null, '', onDeepLink && state.page !== 'template' ? `/#${state.page}` : `#${state.page}`);
  closeAccountPanel();
  if (state.page !== previousPage) window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  if (state.page === 'make') setTimeout(() => restoreOcUploadRecovery(state.templateId), 0);
  if (state.page === 'collection') setTimeout(() => loadOwnedCharacters(), 0);
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
    top: t('makerTop'),
    parts: t('characterMaker'),
    rules: t('rules'),
    palette: t('paletteRules'),
    living: 'Living Content',
    preview: t('previewCheck'),
    publish: t('onchainPublish'),
    settings: t('settings'),
  };
  if ($('editingPanelKicker')) $('editingPanelKicker').textContent = labels[state.editorPanel] || 'Character Maker';
}

function focusCreatorTop() {
  document.querySelector('.maker-list-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function syncTemplateFields() {
  const template = activeTemplate();
  $('creatorTemplateName').value = template.name;
  $('creatorDescription').value = template.summary || '';
  $('creatorName').value = template.creator;
  $('creatorWorld').value = template.style;
  $('creatorRoyalty').value = template.royaltyBps;
  $('creatorMintingEnabled').checked = template.mintingEnabled !== false;
  $('creatorMintFeeEnabled').checked = Boolean(template.mintFeeEnabled);
  $('creatorMintPrice').value = template.mintPriceAtomic
    ? String(atomicCoinToDecimal(template.mintPriceAtomic))
    : String(template.mintPrice || 1);
  $('creatorMintPrice').disabled = !canonicalSoulMintEnabled || !template.mintFeeEnabled;
  $('creatorLicense').value = Object.entries({
    'personal-use': 'Personal use',
    'free-remix': 'Free remix',
    'paid-commercial': 'Paid commercial',
    'exclusive-commission': 'Exclusive commission',
  }).find(([, label]) => label === template.license)?.[0] || 'personal-use';
  $('creatorLicenseNote').value = template.licenseNote || '';
  $('profileWorld').value = template.style;
  $('templateTitle').textContent = template.name;
  $('avatarTemplate').textContent = template.name;
  $('licenseTitle').textContent = template.license;
  $('licenseDescription').textContent = template.licenseNote;
}

function renderTemplates() {
  const list = filteredTemplates();
  const publicMakerCount = templates.filter((template) => template.source !== 'local' && !(template.source === 'chain' && makerModels.get(template.id)?.makerArchived)).length;
  if ($('publicMakerCount')) $('publicMakerCount').textContent = String(publicMakerCount);
  $('templateGrid').innerHTML = list.length ? list.map((template) => {
    const metrics = templateModelMetrics(template);
    const sourceLabel = templateSourceLabel(template);
    return `
    <article class="template-card ${template.id === state.templateId ? 'active' : ''}" data-template="${escapeHtml(template.id)}">
      <div class="template-cover" style="--accent:${safeCssColor(template.accent)}; --secondary:${safeCssColor(template.secondary, '#f0a23a')};">
        ${template.coverUrl
          ? `<img class="template-cover-image" src="${escapeHtml(template.coverUrl)}" alt="${escapeHtml(template.name)} preview" loading="lazy" />`
          : `<div class="cover-face">
              <span class="cover-hair"></span>
              <span class="cover-eye left"></span>
              <span class="cover-eye right"></span>
              <span class="cover-mouth"></span>
            </div>`}
        <span class="cover-style">${escapeHtml(template.style)}</span>
      </div>
      <div class="template-body">
        <div class="badge-row">
          <span>${sourceLabel}</span>
          <span>${escapeHtml(template.license)}</span>
          <span>${metrics.parts} ${t('partsLabel')}</span>
          <span>${metrics.items} ${t('itemsLabel')}</span>
        </div>
        <h2>${escapeHtml(template.name)}</h2>
        <p class="creator-line">by ${escapeHtml(template.creator)}</p>
        <p>${escapeHtml(template.summary)}</p>
        <div class="sample-strip" aria-label="${escapeHtml(template.name)} samples">
          ${[1, 2, 3, 4].map((item) => `<span style="--tilt:${item * 3}deg; --accent:${safeCssColor(template.accent)}; --secondary:${safeCssColor(template.secondary, '#f0a23a')};"></span>`).join('')}
        </div>
        <div class="template-footer">
          <span>${Number(template.royaltyBps || 0) / 100}% ${t('royaltyPolicy')}</span>
          <div class="template-card-actions">
            <button class="secondary" type="button" data-view-template="${escapeHtml(template.id)}">${t('viewMaker')}</button>
            <button class="primary" data-use-template="${escapeHtml(template.id)}">${state.walletConnected ? t('startMaking') : t('connectToMake')}</button>
          </div>
        </div>
      </div>
    </article>
  `;
  }).join('') : `<div class="empty-state">${t('noMatchingMakers')}</div>`;

  document.querySelectorAll('.template-card').forEach((card) => {
    card.addEventListener('click', (event) => {
      if (event.target.closest('[data-use-template]')) return;
      openTemplateDetail(card.dataset.template);
    });
  });

  document.querySelectorAll('[data-view-template]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      openTemplateDetail(button.dataset.viewTemplate);
    });
  });

  document.querySelectorAll('[data-use-template]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!state.walletConnected) {
        state.pendingWalletPage = 'make';
        state.pendingWalletTemplateId = button.dataset.useTemplate;
        connectSuiWallet();
        return;
      }
      activateMakerModel(button.dataset.useTemplate);
      syncTemplateFields();
      state.previewingMaker = false;
      setPage('make');
      renderAll();
    });
  });
}

function openTemplateDetail(templateId, { updatePath = true } = {}) {
  const template = templates.find((candidate) => candidate.id === templateId);
  if (!template || template.source === 'local') return;
  activateMakerModel(template.id);
  syncTemplateFields();
  if (updatePath) {
    const reference = template.objectId || template.id;
    history.pushState(null, '', `/maker/${encodeURIComponent(reference)}#template`);
  }
  setPage('template');
  renderAll();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderTemplateDetail() {
  if (!$('templateDetail')) return;
  const template = activeTemplate();
  const model = makerModels.get(template.id);
  const metrics = templateModelMetrics(template);
  const archived = Boolean(model?.makerArchived);
  const manifestUrl = template.quiltId
    ? walrusQuiltFileUrl(template.quiltId, 'animacraft-manifest.json')
    : template.manifestUrl || '';
  const partLabels = (model?.slots || slots).slice(0, 12).map((slot) => slot.label);
  $('templateDetail').innerHTML = `
    <div class="template-detail-media" style="--accent:${safeCssColor(template.accent)}; --secondary:${safeCssColor(template.secondary, '#f0a23a')};">
      <div class="template-cover">
        ${template.coverUrl
          ? `<img class="template-cover-image" src="${escapeHtml(template.coverUrl)}" alt="${escapeHtml(template.name)} preview" />`
          : `<div class="cover-face"><span class="cover-hair"></span><span class="cover-eye left"></span><span class="cover-eye right"></span><span class="cover-mouth"></span></div>`}
        <span class="cover-style">${escapeHtml(template.style)}</span>
      </div>
    </div>
    <div class="template-detail-copy">
      <div class="badge-row">
        <span>${templateSourceLabel(template)}</span>
        <span>${escapeHtml(template.license)}</span>
        ${archived ? '<span>Archived</span>' : ''}
      </div>
      <h1>${escapeHtml(template.name)}</h1>
      <p class="creator-line">by ${escapeHtml(template.creator)}</p>
      <p class="template-detail-summary">${escapeHtml(template.summary)}</p>
      <div class="template-detail-metrics">
        <div><strong>${metrics.parts}</strong><span>${t('partsLabel')}</span></div>
        <div><strong>${metrics.items}</strong><span>${t('itemsLabel')}</span></div>
        <div><strong>${Number(template.royaltyBps || 0) / 100}%</strong><span>${t('royaltyPolicy')}</span></div>
      </div>
      <div class="badge-row">${partLabels.map((label) => `<span>${escapeHtml(label)}</span>`).join('')}</div>
      <div class="template-detail-license"><strong>${escapeHtml(template.license)}</strong><p>${escapeHtml(template.licenseNote)}</p></div>
      <div class="template-detail-actions">
        <button class="primary" type="button" data-detail-start ${archived ? 'disabled' : ''}>${state.walletConnected ? t('startMaking') : t('connectToMake')}</button>
      </div>
      <div class="template-detail-links">
        ${template.objectId ? `<a href="${escapeHtml(explorerObjectUrl(template.objectId))}" target="_blank" rel="noreferrer">View Sui Maker</a>` : ''}
        ${manifestUrl ? `<a href="${escapeHtml(manifestUrl)}" target="_blank" rel="noreferrer">${template.quiltId ? 'Open Walrus manifest' : 'Open Maker manifest'}</a>` : ''}
      </div>
    </div>
  `;
  document.querySelector('[data-detail-start]')?.addEventListener('click', () => {
    if (!state.walletConnected) {
      state.pendingWalletPage = 'make';
      state.pendingWalletTemplateId = template.id;
      connectSuiWallet();
      return;
    }
    state.previewingMaker = false;
    setPage('make');
    renderAll();
  });
}

function renderSlots() {
  $('slotRail').innerHTML = playableSlots().map((slot) => `
    <button class="slot-btn ${slot.key === state.selectedSlot ? 'active' : ''}" data-slot="${escapeHtml(slot.key)}">
      <span>${slot.iconAsset?.url ? `<img src="${escapeHtml(slot.iconAsset.url)}" alt="" />` : escapeHtml(slot.icon)}</span>
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
    <button class="part-card ${state.visual[slot.key] ? '' : 'active'}" data-part="" ${state.minting ? 'disabled' : ''}>
      <span class="part-thumb empty-thumb">×</span>
      <strong>None</strong>
      <small>Remove this Part</small>
    </button>
  ` : '';
  $('partGrid').innerHTML = removeOption + publicItems.map((part, index) => {
    const pickerAsset = itemPickerAsset(slot, part);
    return `
      <button class="part-card ${state.visual[slot.key] === part.id ? 'active' : ''}" data-part="${escapeHtml(part.id)}" ${state.minting || selectionWouldBreakRule(slot.key, part.id) ? 'disabled title="Unavailable while minting or with the current selection"' : ''}>
        <span class="part-thumb ${pickerAsset?.url ? 'has-image' : ''}" style="--accent:${safeCssColor(state.visual.palette[slot.colorKey])}; --index:${index};">${pickerAsset?.url ? `<img src="${escapeHtml(pickerAsset.url)}" alt="" />` : ''}</span>
        <strong>${escapeHtml(part.label)}</strong>
        <small>${escapeHtml(slot.key)}/${escapeHtml(part.id)}</small>
      </button>
    `;
  }).join('');

  document.querySelectorAll('[data-part]').forEach((button) => {
    button.addEventListener('click', () => {
      invalidateOcUpload();
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
  $('swatchGrid').innerHTML = choices.map((value) => {
    const color = safeCssColor(value);
    return `
      <button class="swatch ${state.visual.palette[slot.colorKey] === value ? 'active' : ''}" data-swatch="${escapeHtml(color)}" style="background:${color}" aria-label="Use ${escapeHtml(color)}" ${state.minting ? 'disabled' : ''}></button>
    `;
  }).join('');
  document.querySelectorAll('[data-swatch]').forEach((button) => {
    button.addEventListener('click', () => {
      invalidateOcUpload();
      applyPaletteColor(slot, button.dataset.swatch);
      renderAll();
    });
  });
}

function applyPaletteColor(slot, color) {
  if (uploadedAssetCount(slot) === 0) {
    const queue = [slot];
    const visited = new Set();
    while (queue.length) {
      const current = queue.shift();
      if (!current || visited.has(current.key)) continue;
      visited.add(current.key);
      current.colorKey ||= current.key;
      state.visual.palette[current.colorKey] = uploadedAssetCount(current) > 0
        ? safeCssColor(creatorColors(current)[0]?.value)
        : safeCssColor(color);
      state.paletteLinks
        .filter((link) => link.primaryPartKey === current.key || link.linkedPartKey === current.key)
        .forEach((link) => {
          const linkedKey = link.primaryPartKey === current.key ? link.linkedPartKey : link.primaryPartKey;
          const linkedSlot = allSlots().find((candidate) => candidate.key === linkedKey);
          if (linkedSlot && !visited.has(linkedKey)) queue.push(linkedSlot);
        });
    }
    return;
  }
  const sourceColors = creatorColors(slot);
  const sourceIndex = Math.max(0, sourceColors.findIndex((candidate) => candidate.value === color));
  const queue = [{ slot, sourceColor: sourceColors[sourceIndex] || { id: '', value: color }, sourceIndex }];
  const visited = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (!current?.slot || visited.has(current.slot.key)) continue;
    visited.add(current.slot.key);
    const currentColors = creatorColors(current.slot);
    const mapped = uploadedAssetCount(current.slot) === 0
      ? current.sourceColor
      : currentColors.find((candidate) => String(candidate.value || '').toLowerCase() === String(current.sourceColor.value || '').toLowerCase())
        || currentColors.find((candidate) => candidate.id === current.sourceColor.id)
        || currentColors[current.sourceIndex]
        || currentColors[0]
        || current.sourceColor;
    state.visual.palette[current.slot.colorKey] = safeCssColor(mapped.value, safeCssColor(color));
    state.paletteLinks
      .filter((link) => link.primaryPartKey === current.slot.key || link.linkedPartKey === current.slot.key)
      .forEach((link) => {
        const linkedKey = link.primaryPartKey === current.slot.key ? link.linkedPartKey : link.primaryPartKey;
        const linkedSlot = allSlots().find((candidate) => candidate.key === linkedKey);
        if (linkedSlot && !visited.has(linkedKey)) queue.push({ slot: linkedSlot, sourceColor: mapped, sourceIndex: current.sourceIndex });
      });
  }
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
    const asset = itemLayerAsset(slot, item, layer);
    return asset?.url ? [{ layer, asset }] : [];
  });
  $('playerLayerAssets').innerHTML = images.map(({ layer, asset }) => `
    <img src="${escapeHtml(asset.url)}" alt="${escapeHtml(layer.partLabel)} ${escapeHtml(layer.name)}" style="${layerInlineStyle(layer)}" />
  `).join('');
  $('avatar').classList.toggle('has-layer-assets', images.length > 0);
}

function renderRecipe() {
  $('recipeList').innerHTML = playableSlots().map((slot) => {
    const selected = slotItems(slot.key).find((part) => part.id === state.visual[slot.key]);
    return `<button data-slot="${escapeHtml(slot.key)}">${escapeHtml(slot.label)}: ${escapeHtml(selected ? selected.label : 'None')}</button>`;
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
    schemaVersion: 'animacraft.creator-template.v3',
    template: {
      id: slug($('creatorTemplateName').value),
      name: $('creatorTemplateName').value,
      summary: $('creatorDescription').value,
      creator: $('creatorName').value,
      style: $('creatorWorld').value,
      license: $('creatorLicense').value,
      licenseNote: $('creatorLicenseNote').value,
      royaltyBps: Number($('creatorRoyalty').value || 0),
      mintingEnabled: $('creatorMintingEnabled').checked,
      mintFeeEnabled: $('creatorMintFeeEnabled').checked,
      mintPriceAtomic: $('creatorMintFeeEnabled').checked ? decimalCoinToAtomic($('creatorMintPrice').value) : 0,
      paymentCoinType: runtimeConfig.paymentCoinType,
      paymentCoinSymbol: runtimeConfig.paymentCoinSymbol,
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
      assetAddressing: 'walrus-quilt-id+identifier',
      manifestIdentifier: 'animacraft-manifest.json',
    },
    parts: allSlots().map((slot) => ({
      key: slot.key,
      label: slot.label,
      kind: slot.kind,
      menuVisible: slot.menuVisible !== false,
      allowRemove: slot.allowRemove !== false,
      defaultItemId: slot.defaultItemId || slotItems(slot.key)[0]?.id || '',
      iconIdentifier: slot.iconAsset?.identifier || (slot.iconAsset?.file ? `${slug(slot.key)}-part-icon.${slot.iconAsset.file.type === 'image/jpeg' ? 'jpg' : 'png'}` : ''),
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
        iconIdentifier: item.iconAsset?.identifier || (item.iconAsset?.file ? `${slug(slot.key)}-${slug(item.id)}-icon.${item.iconAsset.file.type === 'image/jpeg' ? 'jpg' : 'png'}` : ''),
        images: Object.keys(item.images || {}).filter((key) => assetReady(item.images[key])).map((key) => {
          const [layerId, colorId] = key.split(':');
          return { layerId, colorId, identifier: item.images[key].identifier || `${slug(slot.key)}-${slug(item.id)}-${slug(layerId)}-${slug(colorId)}.png` };
        }),
      })),
    })),
    rules: state.rules,
    paletteLinks: state.paletteLinks,
    livingContent: normalizeLivingContent(state.livingContent, activeTemplate()),
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
  manifest.template.coverIdentifier = 'maker-cover.png';
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
  manifest.assets.push({
    name: 'maker-cover.png',
    size: 0,
    type: 'image/png',
    kind: 'maker-cover',
    slot: '',
    partId: '',
    itemId: '',
    layerId: '',
    colorId: '',
    identifier: 'maker-cover.png',
    patchId: '',
    blobId: '',
  });
  return manifest;
}

function publishableAssets() {
  return state.assets.filter((asset) => {
    if (!asset.itemId) return true;
    return slotItems(asset.slot).some((item) => item.id === asset.itemId && item.visibility !== 'private');
  });
}

function makerCoverAsset(coverBlob) {
  const coverFile = new File([coverBlob], 'maker-cover.png', { type: 'image/png', lastModified: Date.now() });
  return {
    file: coverFile,
    name: coverFile.name,
    size: coverFile.size,
    type: coverFile.type,
    kind: 'maker-cover',
    slot: '',
    partId: '',
    itemId: '',
    layerId: '',
    colorId: '',
    identifier: 'maker-cover.png',
  };
}

function makerUploadEntries() {
  const manifestBlob = new Blob([state.pendingMakerManifestJson], { type: 'application/json' });
  return [
    ...state.pendingMakerAssets.map((asset) => ({ blob: asset.file, identifier: asset.identifier, kind: asset.kind })),
    { blob: manifestBlob, identifier: 'animacraft-manifest.json', kind: 'maker-manifest' },
  ];
}

function ocPackage() {
  const profile = {
    name: $('profileName').value || 'Untitled OC',
    world: $('profileWorld').value || activeTemplate().style,
    description: $('profileDescription').value,
    tags: splitList($('profileTags').value),
  };
  const livingContent = soulidityContentManifest(state.livingContent, {
    maker: activeTemplate(),
    makerId: activeMakerObjectId(),
    profile,
  });
  return {
    schemaVersion: 'animacraft.oc-package.v1',
    createdAt: new Date().toISOString(),
    template: {
      id: activeTemplate().id,
      name: activeTemplate().name,
      creator: activeTemplate().creator,
      license: activeTemplate().license,
      licenseNote: activeTemplate().licenseNote,
      royaltyBps: activeTemplate().royaltyBps,
    },
    profile,
    livingContent,
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
      soulObject: 'Soulidity Soul object',
      makerAuthorization: 'Animacraft validates the recipe and optional Maker fee before Soulidity consumes the mint authorization',
      policy: 'Soulidity mints and trades the only finished character object; Animacraft does not create a parallel OC token',
      walletSigner: state.walletAddress || 'not-connected',
    },
  };
}

function ocFingerprint(oc = ocPackage()) {
  return JSON.stringify({
    makerId: activeMakerObjectId(),
    profile: oc.profile,
    recipe: oc.recipe,
  });
}

function ocUploadEntries() {
  if (!state.pendingOcImageBlob || !state.pendingOcProfileBlob) throw new Error('The rendered OC files are missing.');
  return [
    { blob: state.pendingOcImageBlob, identifier: 'animacraft-oc.png', kind: 'oc-image' },
    { blob: state.pendingOcProfileBlob, identifier: 'animacraft-oc.json', kind: 'oc-profile' },
  ];
}

async function persistOcUploadRecovery() {
  const session = state.ocUploadSession;
  if (!session?.checkpoint || !state.pendingOcImageBlob || !state.pendingOcProfileBlob || !state.pendingOcPackage) return;
  const recoveryKey = ocUploadStorageKey();
  await saveMakerUploadRecovery(recoveryKey, {
    kind: 'oc-mint',
    owner: session.owner,
    stage: state.ocUploadStage,
    checkpoint: session.checkpoint,
    registerDigest: session.registerDigest || '',
    certifyDigest: session.certifyDigest || '',
    quiltBlobId: session.quiltBlobId || '',
    files: (session.files || []).map(({ id, blobId }) => ({ id, blobId })),
    imageBlob: state.pendingOcImageBlob,
    profileBlob: state.pendingOcProfileBlob,
    ocPackage: state.pendingOcPackage,
    recipeHash: state.pendingOcRecipeHash,
    recipeJson: state.pendingOcRecipeJson,
    fingerprint: state.pendingOcFingerprint,
  });
  state.hasOcUploadRecovery = true;
  loadedOcUploadRecoveries.add(recoveryKey);
}

async function clearOcUploadRecovery(templateId = state.templateId) {
  const recoveryKey = ocUploadStorageKey(templateId);
  loadedOcUploadRecoveries.delete(recoveryKey);
  await deleteMakerUploadRecovery(recoveryKey);
  if (state.templateId === templateId) state.hasOcUploadRecovery = false;
}

function invalidateOcUpload(message = 'The OC changed. Prepare a new mint upload.') {
  if (state.minting) return;
  const hadPreparedUpload = state.ocUploadStage !== 'idle' || state.hasOcUploadRecovery || state.mintDigest;
  const recoveryKey = ocUploadStorageKey();
  resetOcUploadState();
  if (hadPreparedUpload) state.mintStatus = message;
  loadedOcUploadRecoveries.delete(recoveryKey);
  deleteMakerUploadRecovery(recoveryKey).catch((error) => console.warn('Could not clear stale OC upload recovery.', error));
}

function renderChecklist() {
  const publicItems = allSlots().flatMap((slot) => slotItems(slot.key).filter((item) => item.visibility !== 'private').map((item) => ({ slot, item })));
  const missingCells = publicItems.reduce((total, { slot, item }) => total + creatorLayers(slot).reduce(
    (layerTotal, layer) => layerTotal + creatorColors(slot).filter((color) => !assetReady(item.images?.[assetCellKey(layer.id, color.id)])).length,
    0,
  ), 0);
  let livingContentReady = true;
  try {
    validateLivingContent(state.livingContent);
  } catch {
    livingContentReady = false;
  }
  const checks = [
    ['Maker metadata', Boolean($('creatorTemplateName').value.trim() && $('creatorDescription').value.trim() && $('creatorName').value.trim())],
    ['Parts and Items', allSlots().length > 0 && publicItems.length > 0],
    ['Item image matrix', publicItems.length > 0 && missingCells === 0],
    ['Rules and palettes', state.rules.every((rule) => !selectionRuleIssue(rule)) && state.paletteLinks.every((link) => !paletteLinkIssue(link))],
    ['Living Content', livingContentReady],
    ['Publication policy', Boolean($('creatorLicenseNote').value.trim()) && Number.isInteger(Number($('creatorRoyalty').value)) && Number($('creatorRoyalty').value) >= 0 && Number($('creatorRoyalty').value) <= 10_000],
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
  if (!rule.leftPartKey || !rule.rightPartKey || rule.leftPartKey === rule.rightPartKey) {
    return 'A selection rule must connect two different Parts.';
  }
  for (const [partKey, itemKey] of [[rule.leftPartKey, rule.leftItemKey], [rule.rightPartKey, rule.rightItemKey]]) {
    const slot = allSlots().find((candidate) => candidate.key === partKey);
    if (!slot) return 'A selection rule references a missing Part.';
    if (slot.kind === 'last-bastion') return 'Last bastion Parts cannot be targeted by selection rules.';
    if (itemKey) {
      const item = slotItems(partKey).find((candidate) => candidate.id === itemKey);
      if (!item || item.visibility === 'private') return 'A selection rule references a missing or private Item.';
    }
  }
  return '';
}

function paletteLinkIssue(link) {
  if (!link.primaryPartKey || !link.linkedPartKey || link.primaryPartKey === link.linkedPartKey) {
    return 'A palette link must connect two different Parts.';
  }
  if (!allSlots().some((slot) => slot.key === link.primaryPartKey) || !allSlots().some((slot) => slot.key === link.linkedPartKey)) {
    return 'A palette link references a missing Part.';
  }
  const primary = allSlots().find((slot) => slot.key === link.primaryPartKey);
  const linked = allSlots().find((slot) => slot.key === link.linkedPartKey);
  const primaryColors = creatorColors(primary).map((color) => String(color.value || '').toLowerCase()).sort();
  const linkedColors = creatorColors(linked).map((color) => String(color.value || '').toLowerCase()).sort();
  if (JSON.stringify(primaryColors) !== JSON.stringify(linkedColors)) {
    return 'Linked Parts must publish the same exact color set so the palette rule can be enforced on Sui.';
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
  const publicItems = makerParts.flatMap((slot) => slotItems(slot.key).filter((item) => item.visibility !== 'private'));
  const assetIdentifiers = publishableAssets().map((asset) => String(asset.identifier || ''));
  if (!makerParts.length) issues.push('Add at least one Part.');
  if (makerParts.length > MAX_MAKER_PARTS) issues.push(`A Maker cannot contain more than ${MAX_MAKER_PARTS} Parts.`);
  if (publicItems.length > MAX_MAKER_ITEMS) issues.push(`A Maker cannot contain more than ${MAX_MAKER_ITEMS} published Items.`);
  if (state.rules.length > MAX_MAKER_RULES) issues.push(`A Maker cannot contain more than ${MAX_MAKER_RULES} selection rules.`);
  const colorCount = makerParts.reduce((total, slot) => total + creatorColors(slot).length, 0);
  const publishRecordCount = makerParts.length + publicItems.length + colorCount + state.rules.length + state.paletteLinks.length;
  if (publishRecordCount > MAX_SINGLE_PUBLISH_RECORDS) {
    issues.push(`This launch publisher supports up to ${MAX_SINGLE_PUBLISH_RECORDS} on-chain Part, Item, Color, Rule, and palette records per release.`);
  }
  if (publishableAssets().length + 2 > 5_000) issues.push('A Maker release cannot exceed 5,000 Walrus files including its cover and manifest.');
  if (assetIdentifiers.some((identifier) => !identifier || utf8Length(identifier) > 512) || new Set(assetIdentifiers).size !== assetIdentifiers.length) {
    issues.push('Published Walrus asset identifiers must be present, unique, and at most 512 UTF-8 bytes. Rename duplicate Part, Item, Layer, or Color IDs.');
  }
  if (new Set(makerParts.map((slot) => slot.key)).size !== makerParts.length) issues.push('Part keys must be unique.');
  if (makerParts.length && !makerParts.some((slot) => slot.menuVisible !== false)) issues.push('At least one Part must be visible in the player menu.');
  if (!$('creatorTemplateName').value.trim()) issues.push('Add a Maker name.');
  if (!$('creatorDescription').value.trim()) issues.push('Add a Maker description.');
  if (!$('creatorName').value.trim()) issues.push('Add a creator name.');
  if (utf8Length($('creatorTemplateName').value) > 128) issues.push('Maker name cannot exceed 128 UTF-8 bytes.');
  if (utf8Length($('creatorDescription').value) > 2_000) issues.push('Maker description cannot exceed 2,000 UTF-8 bytes.');
  if (utf8Length($('creatorName').value) > 128) issues.push('Creator name cannot exceed 128 UTF-8 bytes.');
  if (!$('creatorLicenseNote').value.trim()) issues.push('Add a public license note for users.');
  if (utf8Length($('creatorLicenseNote').value) > 2_000) issues.push('License note cannot exceed 2,000 UTF-8 bytes.');
  makerParts.forEach((slot) => {
    const items = slotItems(slot.key);
    const layers = creatorLayers(slot);
    const colors = creatorColors(slot);
    if (!items.length) issues.push(`${slot.label} needs at least one Item.`);
    if (items.length && !items.some((item) => item.visibility !== 'private')) issues.push(`${slot.label} needs at least one published Item.`);
    if (!layers.length) issues.push(`${slot.label} needs at least one Layer.`);
    if (!colors.length) issues.push(`${slot.label} needs at least one Color.`);
    if (items.length > MAX_ITEMS_PER_PART) issues.push(`${slot.label} cannot contain more than ${MAX_ITEMS_PER_PART} Items in this release.`);
    if (layers.length > MAX_LAYERS_PER_PART) issues.push(`${slot.label} cannot contain more than ${MAX_LAYERS_PER_PART} Layers.`);
    if (colors.length > MAX_COLORS_PER_PART) issues.push(`${slot.label} cannot contain more than ${MAX_COLORS_PER_PART} Colors.`);
    if (!isSafeKey(slot.key) || utf8Length(slot.key) > 128 || utf8Length(slot.label) > 128) issues.push(`${slot.label} needs a URL-safe key and a label no longer than 128 UTF-8 bytes.`);
    if (slot.kind === 'last-bastion' && slot.allowRemove !== false) issues.push(`${slot.label} must remain required because it is a last bastion Part.`);
    if (new Set(items.map((item) => item.id)).size !== items.length) issues.push(`${slot.label} contains duplicate Item IDs.`);
    if (new Set(layers.map((layer) => layer.id)).size !== layers.length) issues.push(`${slot.label} contains duplicate Layer IDs.`);
    if (new Set(colors.map((color) => color.id)).size !== colors.length) issues.push(`${slot.label} contains duplicate Color IDs.`);
    if (new Set(colors.map((color) => String(color.value || '').toLowerCase())).size !== colors.length) issues.push(`${slot.label} contains duplicate Color values.`);
    layers.forEach((layer) => {
      if (!isSafeKey(layer.id) || utf8Length(layer.id) > 128 || utf8Length(layer.name) > 128) issues.push(`${slot.label} / ${layer.name} needs a safe ID and a name no longer than 128 UTF-8 bytes.`);
      if (!Number.isFinite(Number(layer.x)) || !Number.isFinite(Number(layer.y))) issues.push(`${slot.label} / ${layer.name} has invalid coordinates.`);
      if (!Number.isFinite(Number(layer.opacity)) || Number(layer.opacity) < 0 || Number(layer.opacity) > 100) issues.push(`${slot.label} / ${layer.name} needs opacity from 0 to 100.`);
    });
    colors.forEach((color) => {
      if (!isSafeKey(color.id) || utf8Length(color.id) > 128 || utf8Length(color.name) > 128) issues.push(`${slot.label} / ${color.name} needs a safe ID and a name no longer than 128 UTF-8 bytes.`);
      if (!/^#[0-9a-f]{6}$/i.test(String(color.value || ''))) issues.push(`${slot.label} / ${color.name} needs a six-digit hex color.`);
    });
    items.filter((item) => item.visibility !== 'private').forEach((item) => {
      if (!isSafeKey(item.id) || utf8Length(item.id) > 128 || utf8Length(item.label) > 128) issues.push(`${slot.label} / ${item.label} needs a safe ID and a label no longer than 128 UTF-8 bytes.`);
      const missingCells = layers.flatMap((layer) => colors.filter((color) => !assetReady(item.images?.[assetCellKey(layer.id, color.id)])));
      if (missingCells.length) issues.push(`${slot.label} / ${item.label} needs ${missingCells.length} more PNG image${missingCells.length === 1 ? '' : 's'}.`);
      Object.values(item.images || {}).filter(assetReady).forEach((asset) => {
        if (!asset.width || !asset.height) return;
        const expectedRatio = state.makerCanvas.width / state.makerCanvas.height;
        if (Math.abs((asset.width / asset.height) - expectedRatio) > 0.005) issues.push(`${slot.label} / ${item.label} contains an image with the wrong canvas ratio.`);
      });
    });
  });
  state.rules.forEach((rule) => {
    const issue = selectionRuleIssue(rule);
    if (issue) issues.push(issue);
  });
  state.paletteLinks.forEach((link) => {
    const issue = paletteLinkIssue(link);
    if (issue) issues.push(issue);
  });
  const royaltyBps = Number($('creatorRoyalty').value || 0);
  if (![0, 100, 200, 300, 400, 500].includes(royaltyBps)) issues.push('Soulidity resale royalty must be off or one of the 1% to 5% tiers.');
  const mintFeeEnabled = $('creatorMintFeeEnabled').checked;
  const mintPriceAtomic = decimalCoinToAtomic($('creatorMintPrice').value);
  if (!$('creatorMintingEnabled').checked && mintFeeEnabled) issues.push('Turn on OC minting before enabling a mint fee.');
  if (mintFeeEnabled && !canonicalSoulMintEnabled) issues.push('Paid mint is release-gated until the canonical Soulidity adapter is deployed and verified.');
  if (mintFeeEnabled && (!mintPriceAtomic || mintPriceAtomic <= 0)) issues.push(`Enter a positive ${runtimeConfig.paymentCoinSymbol} mint price with no more than ${runtimeConfig.paymentCoinDecimals} decimal places.`);
  try {
    validateMakerManifest(creatorUploadManifest());
  } catch (error) {
    issues.push(error.message || 'The public Maker manifest is invalid.');
  }
  return [...new Set(issues)];
}

function renderCreatorValidation() {
  if (!$('creatorValidationList')) return;
  const structuredParts = allSlots().filter((slot) => ['standard', 'left-right-pair', 'last-bastion'].includes(ensureSlotStructure(slot).kind));
  const visibleParts = structuredParts.filter((slot) => slot.menuVisible !== false);
  const publicItems = structuredParts.flatMap((slot) => slotItems(slot.key).filter((item) => item.visibility !== 'private').map((item) => ({ slot, item })));
  const missingCells = publicItems.reduce((total, { slot, item }) => total + creatorLayers(slot).reduce((layerTotal, layer) => layerTotal + creatorColors(slot).filter((color) => !assetReady(item.images?.[assetCellKey(layer.id, color.id)])).length, 0), 0);
  const invalidRules = state.rules.filter((rule) => selectionRuleIssue(rule));
  const invalidPaletteLinks = state.paletteLinks.filter((link) => paletteLinkIssue(link));
  const colorCount = structuredParts.reduce((total, slot) => total + creatorColors(slot).length, 0);
  const publishRecordCount = structuredParts.length + publicItems.length + colorCount + state.rules.length + state.paletteLinks.length;
  const checks = [
    [structuredParts.length > 0, 'At least one valid Part is registered.'],
    [visibleParts.length > 0, 'At least one Part is visible in the player menu.'],
    [missingCells === 0, missingCells ? `${missingCells} required Layer × Color PNG cells are still empty.` : 'Every public Item has all required PNG images.'],
    [invalidRules.length === 0, invalidRules.length ? `${invalidRules.length} rules reference unavailable Parts or Items.` : 'All selection rules reference available Parts and Items.'],
    [invalidPaletteLinks.length === 0, invalidPaletteLinks.length ? `${invalidPaletteLinks.length} palette links reference unavailable Parts.` : 'All linked palettes reference available Parts.'],
    [publishRecordCount <= MAX_SINGLE_PUBLISH_RECORDS, publishRecordCount <= MAX_SINGLE_PUBLISH_RECORDS ? `${publishRecordCount}/${MAX_SINGLE_PUBLISH_RECORDS} on-chain Part, Item, Color, Rule, and palette records fit the launch publisher.` : `${publishRecordCount} records exceed this launch publisher's ${MAX_SINGLE_PUBLISH_RECORDS}-record limit.`],
    [itemLayerAssets().length > 0, itemLayerAssets().length ? `${itemLayerAssets().length} item images are ready for the Walrus quilt.` : 'Upload at least one Item image before release.'],
  ];
  $('creatorValidationList').innerHTML = checks.map(([done, label]) => `<li class="${done ? 'ok' : 'warn'}">${escapeHtml(label)}</li>`).join('');
}

function renderRules() {
  if (!$('ruleLeftPart') || !$('ruleRightPart') || !$('ruleLeftItem') || !$('ruleRightItem')) return;
  const ruleParts = allSlots().filter((slot) => slot.kind !== 'last-bastion');
  const options = ruleParts.map((slot) => `<option value="${escapeHtml(slot.key)}">${escapeHtml(slot.label)}</option>`).join('');
  const previousLeft = $('ruleLeftPart').value;
  const previousRight = $('ruleRightPart').value;
  const previousLeftItem = $('ruleLeftItem').value;
  const previousRightItem = $('ruleRightItem').value;
  $('ruleLeftPart').innerHTML = options;
  $('ruleRightPart').innerHTML = options;
  $('ruleLeftPart').value = ruleParts.some((slot) => slot.key === previousLeft) ? previousLeft : ruleParts[0]?.key || '';
  $('ruleRightPart').value = ruleParts.some((slot) => slot.key === previousRight) ? previousRight : ruleParts[1]?.key || ruleParts[0]?.key || '';
  renderRuleItemOptions('ruleLeftItem', $('ruleLeftPart').value, previousLeftItem);
  renderRuleItemOptions('ruleRightItem', $('ruleRightPart').value, previousRightItem);
  if ($('addSelectionRule')) $('addSelectionRule').disabled = makerIsPublished() || ruleParts.length < 2;
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
      if (!ensureMakerEditable()) return;
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
      if (!ensureMakerEditable()) return;
      state.paletteLinks.splice(Number(button.dataset.removePaletteLink), 1);
      invalidateMakerUpload();
      renderAll();
    });
  });
}

const livingDocumentMeta = Object.freeze({
  soulMd: { title: 'Soul Character', kind: 'SOUL_DOC · soul', filename: 'soul.md' },
  memoryMd: { title: 'Memory', kind: 'MEMORY · default', filename: 'memory.md' },
  skillMd: { title: 'Skills & Docs', kind: 'SKILL · SKILL.md', filename: 'skills.zip / SKILL.md' },
});

function livingMakerContext() {
  const template = activeTemplate();
  return {
    name: $('creatorTemplateName')?.value || template.name,
    description: $('creatorDescription')?.value || template.summary,
    creator: $('creatorName')?.value || template.creator,
    style: $('creatorWorld')?.value || template.style,
  };
}

function refreshLivingDefaults() {
  const defaults = createDefaultLivingContent(livingMakerContext());
  state.livingContent = normalizeLivingContent(state.livingContent, livingMakerContext());
  Object.keys(livingDocumentMeta).forEach((key) => {
    if (!state.livingContent.customized[key]) state.livingContent[key] = defaults[key];
  });
}

function renderLivingContent() {
  if (!$('livingDocumentSource')) return;
  refreshLivingDefaults();
  if (!livingDocumentMeta[state.livingDocument]) state.livingDocument = 'soulMd';
  const meta = livingDocumentMeta[state.livingDocument];
  const source = state.livingContent[state.livingDocument];
  document.querySelectorAll('[data-living-document]').forEach((button) => {
    button.classList.toggle('active', button.dataset.livingDocument === state.livingDocument);
  });
  $('livingDocumentKind').textContent = meta.kind;
  $('livingDocumentTitle').textContent = meta.title;
  $('livingDocumentFilename').textContent = meta.filename;
  $('livingDocumentSize').textContent = `${new TextEncoder().encode(source).length.toLocaleString()} bytes`;
  if ($('livingDocumentSource').value !== source) $('livingDocumentSource').value = source;
  $('livingDocumentSource').disabled = makerIsPublished();
  $('restoreLivingDefault').disabled = makerIsPublished() || !state.livingContent.customized[state.livingDocument];
  const customizedCount = Object.values(state.livingContent.customized).filter(Boolean).length;
  $('livingContentStatus').textContent = customizedCount ? `${customizedCount} customized` : 'Defaults ready';
  $('livingSoulState').textContent = state.livingContent.customized.soulMd ? 'Customized' : 'Default';
  $('livingMemoryState').textContent = state.livingContent.customized.memoryMd ? 'Customized' : 'Default';
  $('livingSkillState').textContent = state.livingContent.customized.skillMd ? 'Customized' : 'Default';
}

function renderPackage() {
  $('packagePreview').textContent = JSON.stringify(ocPackage(), null, 2);
}

function ocRecipeIssues() {
  const issues = [];
  const profileName = $('profileName').value.trim();
  if (!profileName) issues.push('Name this OC before preparing its mint.');
  if (utf8Length(profileName) > 128) issues.push('OC name cannot exceed 128 UTF-8 bytes.');
  if (utf8Length($('profileWorld').value) > 128) issues.push('OC world cannot exceed 128 UTF-8 bytes.');
  if (utf8Length($('profileDescription').value) > 2_000) issues.push('OC description cannot exceed 2,000 UTF-8 bytes.');
  if (utf8Length($('profileTags').value) > 1_000) issues.push('OC tags cannot exceed 1,000 UTF-8 bytes.');
  const recipe = ocPackage().recipe;
  if (!recipe.length) issues.push('Choose at least one Item for this OC.');
  allSlots().forEach((slot) => {
    const selectedItem = state.visual[slot.key];
    if (slot.allowRemove === false && !selectedItem) issues.push(`${slot.label} is required.`);
    if (selectedItem && !slotItems(slot.key).some((item) => item.id === selectedItem && item.visibility !== 'private')) {
      issues.push(`${slot.label} has an unavailable Item selection.`);
    }
    const selectedColor = String(state.visual.palette[slot.colorKey] || '').toLowerCase();
    if (selectedItem && !creatorColors(slot).some((color) => String(color.value || '').toLowerCase() === selectedColor)) {
      issues.push(`${slot.label} has an unavailable Color selection.`);
    }
  });
  state.rules.forEach((rule) => {
    const leftItem = state.visual[rule.leftPartKey];
    const rightItem = state.visual[rule.rightPartKey];
    const leftSelected = Boolean(leftItem) && (!rule.leftItemKey || leftItem === rule.leftItemKey);
    const rightSelected = Boolean(rightItem) && (!rule.rightItemKey || rightItem === rule.rightItemKey);
    if (leftSelected && rightSelected) issues.push('The current Item combination violates a Maker selection rule.');
  });
  state.paletteLinks.forEach((link) => {
    const left = allSlots().find((slot) => slot.key === link.primaryPartKey);
    const right = allSlots().find((slot) => slot.key === link.linkedPartKey);
    if (!left || !right || !state.visual[left.key] || !state.visual[right.key]) return;
    if (String(state.visual.palette[left.colorKey] || '').toLowerCase() !== String(state.visual.palette[right.colorKey] || '').toLowerCase()) {
      issues.push(`${left.label} and ${right.label} must use the same linked palette color.`);
    }
  });
  if (state.makerArchived) issues.push('This Maker is archived and does not accept new Soul authorizations.');
  return [...new Set(issues)];
}

function mintReadiness() {
  if (!packageConfigured()) return 'The Move package is not configured yet.';
  if (activeTemplate()?.source !== 'chain' || !activeMakerObjectId()) return 'This template is a preview. Minting unlocks after its published Sui Maker and Walrus manifest are loaded.';
  if (activeTemplate().mintingEnabled === false || makerModels.get(activeTemplate().id)?.makerArchived) return 'This Maker is not accepting new Soul authorizations.';
  if (activeTemplate().mintFeeEnabled && !activeTemplate().treasuryId && !state.makerTreasuryObjectId) return 'This paid Maker is missing its on-chain Treasury reference.';
  if (!state.walletConnected) return 'Connect a Sui wallet to mint this OC.';
  if (!/^0x[0-9a-f]+$/i.test(String(runtimeConfig.soulidityPackageId || '')) || String(runtimeConfig.soulidityPackageId).includes('TODO')) {
    return 'Configure the Soulidity package before enabling canonical Soul minting.';
  }
  if (activeTemplate().mintFeeEnabled) return 'Paid Maker minting waits for the audited Soulidity authorization adapter. Free Makers can use the import handoff now.';
  const issue = ocRecipeIssues()[0];
  if (issue) return issue;
  return 'Prepare and certify the OC package, then continue to Soulidity for the canonical Soul mint.';
}

function renderMintAction() {
  if (!$('mintOcOnchain')) return;
  const mintOpen = activeTemplate()?.mintingEnabled !== false && !makerModels.get(activeTemplate()?.id)?.makerArchived;
  const treasuryReady = !activeTemplate()?.mintFeeEnabled || Boolean(activeTemplate()?.treasuryId || state.makerTreasuryObjectId);
  const soulidityReady = /^0x[0-9a-f]+$/i.test(String(runtimeConfig.soulidityPackageId || '')) && !String(runtimeConfig.soulidityPackageId).includes('TODO');
  const baseReady = packageConfigured() && soulidityReady && activeTemplate()?.source === 'chain' && Boolean(activeMakerObjectId()) && state.walletConnected && mintOpen && treasuryReady && !activeTemplate()?.mintFeeEnabled && ocRecipeIssues().length === 0;
  const chainMakerReady = activeTemplate()?.source === 'chain' && Boolean(activeMakerObjectId());
  $('resumeOcUpload').hidden = !chainMakerReady || !state.hasOcUploadRecovery || state.ocUploadStage !== 'idle';
  $('prepareOcUpload').hidden = !chainMakerReady || state.ocUploadStage !== 'idle' || state.hasOcUploadRecovery;
  $('registerOcUpload').hidden = !['encoded', 'registered'].includes(state.ocUploadStage);
  $('certifyOcUpload').hidden = state.ocUploadStage !== 'uploaded';
  $('mintOcOnchain').hidden = state.ocUploadStage !== 'certified';
  $('resumeOcUpload').disabled = state.minting || !state.walletConnected || activeTemplate()?.source !== 'chain' || !state.hasOcUploadRecovery;
  $('prepareOcUpload').disabled = state.minting || !baseReady || state.ocUploadStage !== 'idle';
  $('registerOcUpload').disabled = state.minting || !state.walletConnected || !['encoded', 'registered'].includes(state.ocUploadStage);
  $('registerOcUpload').textContent = state.ocUploadStage === 'registered' ? 'Retry upload' : 'Register & upload';
  $('certifyOcUpload').disabled = state.minting || !state.walletConnected || state.ocUploadStage !== 'uploaded';
  $('mintOcOnchain').disabled = state.minting || !state.walletConnected || state.ocUploadStage !== 'certified';
  $('mintOcOnchain').textContent = state.minting ? 'Preparing handoff…' : 'Continue to Soulidity';
  $('mintOcStatus').textContent = state.mintStatus || mintReadiness();
  ['profileName', 'profileWorld', 'profileDescription', 'profileTags'].forEach((id) => {
    if ($(id)) $(id).disabled = state.minting;
  });
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
      let source = asset.file;
      if (!source && asset.url) {
        const response = await fetchWalrusWithBackoff(asset.url);
        if (!response.ok) throw new Error(`Could not load a published Maker layer (${response.status}).`);
        source = await responseBlobWithinLimit(response, 20 * 1024 * 1024, 'A published Maker layer');
      }
      if (!source) throw new Error('A selected Maker layer has no readable image source.');
      const bitmap = await createImageBitmap(source);
      const expectedRatio = state.makerCanvas.width / state.makerCanvas.height;
      if (bitmap.width > 8192 || bitmap.height > 8192 || Math.abs((bitmap.width / bitmap.height) - expectedRatio) > 0.005) {
        bitmap.close();
        throw new Error('A published Maker layer exceeds image limits or does not match the Maker canvas ratio.');
      }
      context.globalAlpha = (layer.opacity ?? 100) / 100;
      context.globalCompositeOperation = ['normal', 'multiply', 'screen', 'overlay'].includes(layer.blendMode)
        ? (layer.blendMode === 'normal' ? 'source-over' : layer.blendMode)
        : 'source-over';
      context.drawImage(bitmap, layer.x || 0, layer.y || 0, canvas.width, canvas.height);
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

async function restoreMakerUploadRecovery(templateId = state.templateId, { force = false } = {}) {
  const recoveryKey = makerAssetStorageKey(templateId);
  if (force) loadedMakerUploadRecoveries.delete(recoveryKey);
  if (loadedMakerUploadRecoveries.has(recoveryKey) || makerIsPublished()) return;
  loadedMakerUploadRecoveries.add(recoveryKey);
  try {
    const recovery = await loadMakerUploadRecovery(recoveryKey);
    state.hasMakerUploadRecovery = Boolean(recovery);
    if (!recovery || state.templateId !== templateId) return;
    syncCreatorAssets();
    if (JSON.stringify(creatorUploadManifest()) !== recovery.manifestJson) {
      await clearMakerUploadRecovery(templateId);
      throw new Error('The draft changed after this Walrus checkpoint. Prepare a new upload from the current assets.');
    }
    if (!recovery.coverBlob) throw new Error('The saved Maker cover is missing from upload recovery.');
    state.pendingMakerCoverBlob = recovery.coverBlob;
    state.pendingMakerAssets = [...publishableAssets(), makerCoverAsset(recovery.coverBlob)];
    state.pendingMakerAssets.forEach((asset) => {
      if (!asset.file) throw new Error(`${asset.name} is missing from the local draft asset store.`);
    });
    state.pendingMakerManifestJson = recovery.manifestJson;
    state.makerUploadSession = await resumeWalrusUpload(makerUploadEntries(), recovery);
    state.makerUploadStage = state.makerUploadSession.stage;
    state.makerQuiltId = recovery.quiltBlobId || state.makerUploadSession.quiltBlobId;
    if (state.makerUploadStage === 'certified') {
      if (state.makerUploadSession.files.length !== state.pendingMakerAssets.length + 1) {
        throw new Error('The certified Walrus quilt no longer matches this Maker asset set.');
      }
      state.pendingMakerAssets.forEach((asset, index) => {
        asset.patchId = state.makerUploadSession.files[index].id;
        asset.blobId = state.makerUploadSession.files[index].blobId;
      });
    }
    state.publishStatus = {
      encoded: 'Saved Walrus quilt restored. Register and upload it with the same wallet.',
      registered: 'Paid Walrus registration restored. Retry the relay upload without registering again.',
      uploaded: 'Uploaded Walrus quilt restored. Continue with certification.',
      certified: 'Certified Walrus quilt restored. Continue with Sui Maker publication.',
    }[state.makerUploadStage] || 'Saved Walrus upload restored.';
  } catch (error) {
    state.makerUploadSession = null;
    state.pendingMakerAssets = [];
    state.pendingMakerCoverBlob = null;
    state.pendingMakerManifestJson = '';
    state.makerUploadStage = 'idle';
    state.publishStatus = error.message || 'Could not restore the saved Walrus upload.';
  } finally {
    renderAll();
  }
}

async function restoreOcUploadRecovery(templateId = state.templateId, { force = false } = {}) {
  if (!state.walletConnected || activeTemplate()?.source !== 'chain' || !activeMakerObjectId() || state.templateId !== templateId) return;
  const recoveryKey = ocUploadStorageKey(templateId);
  if (force) loadedOcUploadRecoveries.delete(recoveryKey);
  if (loadedOcUploadRecoveries.has(recoveryKey) || state.mintDigest) return;
  loadedOcUploadRecoveries.add(recoveryKey);
  try {
    const recovery = await loadMakerUploadRecovery(recoveryKey);
    state.hasOcUploadRecovery = Boolean(recovery);
    if (!recovery || recovery.kind !== 'oc-mint' || state.templateId !== templateId) return;
    if (ocFingerprint() !== recovery.fingerprint) {
      await clearOcUploadRecovery(templateId);
      throw new Error('The current OC no longer matches the saved mint upload. Prepare a new OC quilt.');
    }
    state.pendingOcImageBlob = recovery.imageBlob;
    state.pendingOcProfileBlob = recovery.profileBlob;
    state.pendingOcPackage = recovery.ocPackage;
    state.pendingOcRecipeHash = recovery.recipeHash instanceof Uint8Array
      ? recovery.recipeHash
      : new Uint8Array(recovery.recipeHash || []);
    state.pendingOcRecipeJson = recovery.recipeJson;
    state.pendingOcFingerprint = recovery.fingerprint;
    state.ocUploadSession = await resumeWalrusUpload(ocUploadEntries(), recovery);
    state.ocUploadStage = state.ocUploadSession.stage;
    if (state.ocUploadStage === 'certified') {
      if (state.ocUploadSession.files.length !== 2) throw new Error('The certified OC quilt no longer contains exactly two files.');
      state.ocImagePatchId = state.ocUploadSession.files[0].id;
      state.ocProfilePatchId = state.ocUploadSession.files[1].id;
    }
    state.mintStatus = {
      encoded: 'Saved OC quilt restored. Register and upload it with the same wallet.',
      registered: 'Paid OC registration restored. Retry upload without registering again.',
      uploaded: 'Uploaded OC quilt restored. Continue with certification.',
      certified: 'Certified OC files restored. Continue with the Sui mint.',
    }[state.ocUploadStage] || 'Saved OC upload restored.';
  } catch (error) {
    state.ocUploadSession = null;
    state.ocUploadStage = 'idle';
    state.ocImagePatchId = '';
    state.ocProfilePatchId = '';
    state.pendingOcImageBlob = null;
    state.pendingOcProfileBlob = null;
    state.pendingOcPackage = null;
    state.pendingOcRecipeHash = null;
    state.pendingOcRecipeJson = '';
    state.pendingOcFingerprint = '';
    state.mintStatus = error.message || 'Could not restore the saved OC upload.';
  } finally {
    renderAll();
  }
}

function renderImageMakerList() {
  const creatorTemplates = templates.filter((template) =>
    (template.source === 'local' && template.owner === state.walletAddress)
    || (template.source === 'chain' && template.owned));
  $('imageMakerList').innerHTML = `
    ${creatorTemplates.length ? creatorTemplates.map((template) => {
      const model = makerModels.get(template.id);
      const published = template.source === 'chain' || Boolean(model?.publishDigest || model?.makerObjectId);
      const archived = published && Boolean(model?.makerArchived);
      const lifecycleLabel = archived ? 'Archived' : published ? 'Published on Sui' : template.source === 'local' ? 'Local draft' : 'Starter example';
      const canvasLabel = model?.canvas?.width === model?.canvas?.height ? '1:1' : '9:16';
      return `
        <article class="creator-maker-card ${template.id === state.templateId ? 'active' : ''}" data-maker="${escapeHtml(template.id)}" style="--accent:${safeCssColor(template.accent)}; --secondary:${safeCssColor(template.secondary, '#f0a23a')};">
          <div class="maker-cover-mini">
            ${template.coverUrl ? `<img src="${escapeHtml(template.coverUrl)}" alt="${escapeHtml(template.name)} cover" />` : '<span class="mini-face"></span>'}
          </div>
          <div class="maker-card-body">
            <div class="maker-tags">
              <span>${lifecycleLabel}</span>
              <span>${canvasLabel}</span>
              <span>Free combine</span>
            </div>
            <h2>${escapeHtml(template.name)}</h2>
            <p>${escapeHtml(template.summary)}</p>
          </div>
          <div class="maker-card-actions">
            <button class="secondary" data-preview-maker="${escapeHtml(template.id)}">${t('preview')}</button>
            ${template.source === 'local' && !published ? `<button class="icon-button danger-icon" data-delete-maker="${escapeHtml(template.id)}" title="Delete draft" aria-label="Delete ${escapeHtml(template.name)}">×</button>` : ''}
            <button class="primary" data-edit-maker="${escapeHtml(template.id)}">${published ? 'Manage' : 'Edit'}</button>
          </div>
        </article>
      `;
    }).join('') : '<div class="empty-state">No wallet-owned Makers yet. Create an OC Maker to begin your first local draft.</div>'}
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
      loadActiveTreasuryBalance();
      focusCreatorTop();
    });
  });

  document.querySelectorAll('[data-delete-maker]').forEach((button) => {
    button.addEventListener('click', () => requestDeleteMaker(button.dataset.deleteMaker));
  });
}

function requestDeleteMaker(templateId = state.templateId) {
  const template = templates.find((candidate) => candidate.id === templateId);
  const model = makerModels.get(templateId);
  if (!template || template.source !== 'local' || model?.publishDigest || model?.makerObjectId) return;
  openConfirmation({
    title: 'Delete local draft?',
    message: `“${template.name}” and its local Part, Item, Layer, and file references will be permanently removed from this browser.`,
    confirmLabel: 'Delete draft',
    action: async () => {
      const wasActive = state.templateId === templateId;
      const assetStorageKey = makerAssetStorageKey(templateId);
      revokeMakerObjectUrls(model);
      localStorage.removeItem(makerDraftStorageKey(templateId));
      loadedMakerDrafts.delete(makerDraftStorageKey(templateId));
      loadedMakerAssetDrafts.delete(assetStorageKey);
      await deleteMakerDraftRecord(makerDraftStorageKey(templateId));
      await deleteMakerAssets(assetStorageKey);
      await clearMakerUploadRecovery(templateId);
      makerModels.delete(templateId);
      const templateIndex = templates.findIndex((candidate) => candidate.id === templateId);
      if (templateIndex >= 0) templates.splice(templateIndex, 1);
      persistLocalMakerIndex();
      const fallback = wasActive ? templates[0] : activeTemplate();
      if (wasActive && fallback) {
        activateMakerModel(fallback.id);
        syncTemplateFields();
      }
      state.creatorView = 'list';
      state.editorPanel = 'top';
      renderAll();
      focusCreatorTop();
    },
  });
}

function renderMakerLifecycle() {
  const lifecycle = makerLifecycle();
  const locked = makerIsPublished();
  const labels = {
    starter: ['Starter workspace', 'This example is editable in the current browser. Save it as a new local Maker before production use.'],
    draft: ['Local draft', 'This draft is stored for the connected wallet in this browser and may be edited or permanently deleted.'],
    published: ['Published on Sui', 'The published Maker, rules, license, and certified Walrus manifest are immutable. Archive it to stop new Soul authorizations.'],
    archived: ['Archived on Sui', 'The historical record and existing Souls remain valid, but this Maker no longer accepts new Soul authorizations.'],
  };
  const [title, copy] = labels[lifecycle];
  if ($('makerLifecycleBadge')) {
    $('makerLifecycleBadge').textContent = title;
    $('makerLifecycleBadge').className = `maker-lifecycle-badge ${lifecycle}`;
  }
  if ($('makerLifecycleTitle')) $('makerLifecycleTitle').textContent = title;
  if ($('makerLifecycleCopy')) $('makerLifecycleCopy').textContent = copy;
  if ($('deleteMakerDraft')) {
    $('deleteMakerDraft').hidden = lifecycle !== 'draft';
    $('deleteMakerDraft').disabled = lifecycle !== 'draft';
  }
  if ($('makerLifecycleAction')) $('makerLifecycleAction').hidden = !locked;
  if ($('makerLifecycleActionTitle')) $('makerLifecycleActionTitle').textContent = lifecycle === 'archived' ? 'Archived maker' : 'Published maker';
  if ($('makerLifecycleActionCopy')) $('makerLifecycleActionCopy').textContent = state.publishStatus || copy;
  if ($('archiveMakerOnchain')) {
    $('archiveMakerOnchain').textContent = lifecycle === 'archived' ? 'Restore maker' : 'Archive maker';
    $('archiveMakerOnchain').className = lifecycle === 'archived' ? 'secondary' : 'danger-button';
    $('archiveMakerOnchain').disabled = !state.makerObjectId || !state.makerAdminCapObjectId || state.publishing;
  }

  ['creatorTemplateName', 'creatorDescription', 'creatorName', 'creatorWorld', 'creatorLicense', 'creatorLicenseNote'].forEach((id) => {
    if ($(id)) $(id).disabled = locked;
  });
  const canManageEconomics = !locked || Boolean(state.makerAdminCapObjectId);
  ['creatorMintingEnabled', 'creatorRoyalty'].forEach((id) => {
    if ($(id)) $(id).disabled = !canManageEconomics;
  });
  const canChangeMintFee = canManageEconomics
    && (canonicalSoulMintEnabled || $('creatorMintFeeEnabled').checked);
  if ($('creatorMintFeeEnabled')) $('creatorMintFeeEnabled').disabled = !canChangeMintFee;
  if ($('creatorMintPrice')) {
    $('creatorMintPrice').disabled = !canManageEconomics
      || !canonicalSoulMintEnabled
      || !$('creatorMintFeeEnabled').checked;
  }
  if ($('updateMakerEconomics')) $('updateMakerEconomics').disabled = !locked || !state.makerAdminCapObjectId || state.publishing;
  if ($('withdrawMakerRevenue')) $('withdrawMakerRevenue').disabled = !locked || !state.makerAdminCapObjectId || !state.makerTreasuryObjectId || state.publishing;
  if ($('makerTreasuryBalance')) {
    const template = activeTemplate();
    $('makerTreasuryBalance').textContent = locked && state.makerTreasuryObjectId
      ? template.treasuryBalanceError || `Treasury balance: ${atomicCoinToDecimal(template.treasuryBalanceAtomic || 0)} ${runtimeConfig.paymentCoinSymbol}`
      : 'Treasury balance appears after publication.';
  }
  if ($('saveMakerDraft')) {
    const saveLabels = {
      idle: t('saveDraft'),
      dirty: t('saveDraft'),
      saving: 'Saving locally…',
      saved: 'Saved locally',
      error: 'Retry local save',
    };
    $('saveMakerDraft').textContent = saveLabels[state.draftSaveStatus] || t('saveDraft');
    $('saveMakerDraft').title = state.draftSaveMessage || 'Save Maker metadata and PNG files in this browser.';
    $('saveMakerDraft').disabled = locked || state.draftSaveStatus === 'saving';
  }
  document.querySelectorAll('[data-open-part-modal], [data-add-item], [data-delete-item], [data-delete-part], [data-add-layer], [data-delete-layer], [data-add-color], [data-delete-color], [data-move-layer], [data-remove-rule], [data-remove-palette-link], #addSelectionRule, #addPaletteLink').forEach((control) => {
    control.disabled = locked;
  });
  if ($('addSelectionRule')) $('addSelectionRule').disabled = locked || allSlots().filter((slot) => slot.kind !== 'last-bastion').length < 2;
  if ($('addPaletteLink')) $('addPaletteLink').disabled = locked || allSlots().length < 2;
  document.querySelectorAll('#partWorkspace input, #partWorkspace select, #layerDetailsPanel input, #layerDetailsPanel select').forEach((control) => {
    control.disabled = locked;
  });
}

function requestDeletePart(slotKey) {
  if (!ensureMakerEditable()) return;
  const slot = allSlots().find((candidate) => candidate.key === slotKey);
  if (!slot) return;
  openConfirmation({
    title: 'Delete Part?',
    message: `“${slot.label}” and all of its Items, Layers, Colors, local PNG references, selection rules, and palette links will be removed from this draft.`,
    confirmLabel: 'Delete Part',
    action: () => {
      if (slot.iconAsset?.url) URL.revokeObjectURL(slot.iconAsset.url);
      slotItems(slot.key).forEach((item) => {
        if (item.iconAsset?.url) URL.revokeObjectURL(item.iconAsset.url);
        Object.values(item.images || {}).forEach((asset) => asset?.url && URL.revokeObjectURL(asset.url));
      });
      state.makerSlots = state.makerSlots.filter((candidate) => candidate.key !== slot.key);
      state.slotOrder = state.slotOrder.filter((key) => key !== slot.key);
      state.layerOrder = state.layerOrder.filter((key) => !key.startsWith(`${slot.key}:`));
      delete state.makerParts[slot.key];
      delete state.visual[slot.key];
      delete state.visual.palette[slot.colorKey];
      state.rules = state.rules.filter((rule) => rule.leftPartKey !== slot.key && rule.rightPartKey !== slot.key);
      state.paletteLinks = state.paletteLinks.filter((link) => link.primaryPartKey !== slot.key && link.linkedPartKey !== slot.key);
      state.selectedSlot = state.slotOrder[0] || '';
      state.selectedItem = state.selectedSlot ? slotItems(state.selectedSlot)[0]?.id || '' : '';
      const firstLayer = allCreatorLayers()[0];
      state.selectedLayer = firstLayer?.key || '';
      syncCreatorAssets();
      invalidateMakerUpload('Part deleted. Prepare a new Walrus quilt before publishing.');
      renderAll();
    },
  });
}

function renderCreatorDetails() {
  const template = activeTemplate();
  allSlots().forEach(ensureSlotStructure);
  const compositionLayers = allCreatorLayers();
  const lifecycle = makerLifecycle();
  const lifecycleLabel = {
    starter: 'Starter workspace',
    draft: 'Local draft',
    published: 'Published',
    archived: 'Archived',
  }[lifecycle] || 'Local draft';
  $('detailMakerTitle').textContent = template.name;
  $('editingMakerTitle').textContent = template.name;
  $('editingMakerTitle').title = template.name;
  $('detailDescription').textContent = template.summary || 'Build the template from layered assets, then bind the maker to license rules and on-chain provenance.';
  $('layerCount').textContent = compositionLayers.length;
  const publicItems = allSlots().flatMap((slot) => slotItems(slot.key).filter((item) => item.visibility !== 'private').map((item) => ({ slot, item })));
  const incompleteItems = publicItems.filter(({ slot, item }) => creatorLayers(slot).some((layer) => creatorColors(slot).some((color) => !assetReady(item.images?.[assetCellKey(layer.id, color.id)]))));
  if ($('makerTopPartSummary')) $('makerTopPartSummary').textContent = `${allSlots().length} Part${allSlots().length === 1 ? '' : 's'}`;
  if ($('makerTopAssetSummary')) $('makerTopAssetSummary').textContent = itemLayerAssets().length ? `${itemLayerAssets().length} item images ready` : 'No item images yet';
  if ($('makerTopRuleSummary')) $('makerTopRuleSummary').textContent = `${state.rules.length} Rule${state.rules.length === 1 ? '' : 's'}`;
  if ($('makerTopReadiness')) {
    $('makerTopReadiness').textContent = !allSlots().length
      ? 'Add the first Part'
      : incompleteItems.length === 0 ? 'Ready to preview' : `${incompleteItems.length} incomplete Item${incompleteItems.length === 1 ? '' : 's'}`;
  }
  if ($('makerTopChainState')) $('makerTopChainState').textContent = state.publishDigest ? 'Published' : !packageConfigured() ? 'Package pending' : 'Local draft';
  const canvasRatio = state.makerCanvas.width === state.makerCanvas.height ? '1:1' : '9:16';
  if ($('makerTopLifecycleTag')) $('makerTopLifecycleTag').textContent = lifecycleLabel;
  if ($('makerWorkspaceLifecycleTag')) $('makerWorkspaceLifecycleTag').textContent = lifecycleLabel;
  if ($('makerTopCanvasTag')) $('makerTopCanvasTag').textContent = canvasRatio;
  if ($('makerCanvasTag')) $('makerCanvasTag').textContent = canvasRatio;
  if ($('canvasSizeLabel')) $('canvasSizeLabel').textContent = `${state.makerCanvas.width} × ${state.makerCanvas.height}`;
  if ($('creatorCanvasStage')) $('creatorCanvasStage').style.aspectRatio = `${state.makerCanvas.width} / ${state.makerCanvas.height}`;

  $('creatorPartsList').innerHTML = allSlots().map((slot, index) => `
    <button class="creator-part-row ${state.selectedSlot === slot.key ? 'active' : ''}" data-slot="${escapeHtml(slot.key)}">
      <span>${String(index + 1).padStart(2, '0')}</span>
      <strong>${escapeHtml(slot.label)}</strong>
      <small>${slotItems(slot.key).length} items · ${creatorLayers(slot).length} layers · ${uploadedAssetCount(slot)} files</small>
    </button>
  `).join('');

  $('creatorLayerList').innerHTML = compositionLayers.map((layer, index) => `
    <button class="layer-row ${state.selectedLayer === layer.key ? 'active' : ''}" data-layer-key="${escapeHtml(layer.key)}">
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
      <span class="item-row-copy"><strong>${escapeHtml(item.label)}</strong><small>${Object.values(item.images || {}).filter(assetReady).length}/${totalCells} images · ${escapeHtml(item.visibility)}</small></span>
      <span class="item-row-thumb">${item.iconAsset?.url ? `<img src="${escapeHtml(item.iconAsset.url)}" alt="" />` : String(index + 1).padStart(2, '0')}</span>
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
          <button class="secondary" data-select-layer-from-part="${escapeHtml(creatorLayerKey(slot.key, layers[0].id))}">Composition order</button>
          <button class="danger-button" data-delete-part="${escapeHtml(slot.key)}">Delete Part</button>
        </div>
      </div>
      ${tabs}
      <div class="part-detail-grid">
        <label>Part name<input data-part-field="label" value="${slotLabel}" maxlength="128" /></label>
        <label>Part type<select data-part-field="kind" disabled>
          <option value="standard" ${slot.kind === 'standard' || !slot.kind ? 'selected' : ''}>Standard part</option>
          <option value="left-right-pair" ${slot.kind === 'left-right-pair' ? 'selected' : ''}>Left-right paired part</option>
          <option value="last-bastion" ${slot.kind === 'last-bastion' ? 'selected' : ''}>Last bastion part</option>
        </select></label>
        <label>Menu visibility<select data-part-field="menuVisible">
          <option value="visible" ${slot.menuVisible !== false ? 'selected' : ''}>Visible in menu</option>
          <option value="hidden" ${slot.menuVisible === false ? 'selected' : ''}>Hidden fixed layer</option>
        </select></label>
        <label>Remove option<select data-part-field="allowRemove" ${slot.kind === 'last-bastion' ? 'disabled' : ''}>
          <option value="yes" ${slot.allowRemove !== false ? 'selected' : ''}>User may remove</option>
          <option value="no" ${slot.allowRemove === false ? 'selected' : ''}>Always selected</option>
        </select></label>
        <label>Default item<select data-part-field="defaultItemId">${items.map((item) => `<option value="${escapeHtml(item.id)}" ${slot.defaultItemId === item.id || (!slot.defaultItemId && item === items[0]) ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}</select></label>
        <label>Part menu icon<input data-part-icon type="file" accept="image/png,image/jpeg" /></label>
        <div><strong>Icon status</strong><span>${slot.iconAsset ? `${slot.iconAsset.width} × ${slot.iconAsset.height}` : 'No custom icon'}</span></div>
        <div><strong>Type lock</strong><span>Part type is immutable after creation so its layer contract stays stable.</span></div>
        <div><strong>Position</strong><span>Adjust each owned Layer in Composition Order so preview and exported PNG use the same coordinates.</span></div>
        ${slot.kind === 'last-bastion' ? '<div><strong>Fallback behavior</strong><span>This required Part cannot be targeted by selection rules.</span></div>' : ''}
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
              <input data-inline-layer-name="${escapeHtml(layer.id)}" value="${escapeHtml(layer.name)}" maxlength="128" aria-label="Layer name" />
              <small>Global #${allCreatorLayers().findIndex((candidate) => candidate.key === creatorLayerKey(slot.key, layer.id)) + 1}</small>
              ${slot.kind === 'standard' && layers.length > 1 ? `<button class="icon-command" data-delete-layer="${escapeHtml(layer.id)}" title="Delete layer" aria-label="Delete layer">×</button>` : ''}
            </div>
          `).join('')}</div>
        </section>
        <section>
          <div class="builder-title"><strong>Colors</strong><span>${colors.length}</span></div>
          <div class="builder-list">${colors.map((color) => `
            <div class="builder-row color-builder-row">
              <input type="color" data-color-value="${escapeHtml(color.id)}" value="${escapeHtml(color.value)}" aria-label="${escapeHtml(color.name)} color" />
              <input data-color-name="${escapeHtml(color.id)}" value="${escapeHtml(color.name)}" maxlength="128" aria-label="Color name" />
              <small>${escapeHtml(color.id)}</small>
              ${colors.length > 1 ? `<button class="icon-command" data-delete-color="${escapeHtml(color.id)}" title="Delete color" aria-label="Delete ${escapeHtml(color.name)} color">×</button>` : ''}
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
            <label class="asset-upload-cell ${assetReady(asset) ? 'complete' : ''}">
              <input type="file" accept="image/png" data-upload-item-image data-item-id="${escapeHtml(selectedItem.id)}" data-layer-id="${escapeHtml(layer.id)}" data-color-id="${escapeHtml(color.id)}" />
              <span class="asset-cell-preview">${asset?.url ? `<img src="${escapeHtml(asset.url)}" alt="" />` : '<b>+</b>'}</span>
              <span class="asset-cell-copy"><strong>${escapeHtml(color.name)}</strong><small>${assetReady(asset) ? (asset.width && asset.height ? `${asset.width} × ${asset.height}` : 'Stored on Walrus') : 'Upload PNG'}</small></span>
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
            <button class="danger-button" data-delete-item="${escapeHtml(selectedItem.id)}">Delete item</button>
          </div>
          <div class="item-setting-row">
            <label>Item name<input data-item-field="label" value="${escapeHtml(selectedItem.label)}" maxlength="128" /></label>
            <label>Publication<select data-item-field="visibility">
              <option value="public" ${selectedItem.visibility === 'public' ? 'selected' : ''}>Include in published Maker</option>
              <option value="private" ${selectedItem.visibility === 'private' ? 'selected' : ''}>Draft only</option>
            </select></label>
            <label>Display order<input data-item-field="displayOrder" type="number" min="1" value="${selectedItem.displayOrder}" /></label>
            <label>Picker icon<input type="file" accept="image/png,image/jpeg" data-upload-item-icon="${escapeHtml(selectedItem.id)}" /></label>
          </div>
          <div class="asset-matrix-head"><div><strong>Item images</strong><span>${Object.values(selectedItem.images || {}).filter(assetReady).length}/${totalCells} cells complete</span></div><button class="secondary" data-part-subview="layers">Edit layers & colors</button></div>
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
    input.addEventListener('change', () => {
      if (!ensureMakerEditable()) return;
      updatePartField(slot.key, input.dataset.partField, input.value);
    });
  });

  document.querySelector('[data-delete-part]')?.addEventListener('click', () => requestDeletePart(slot.key));

  document.querySelector('[data-part-icon]')?.addEventListener('change', async (event) => {
    if (!ensureMakerEditable()) return;
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
      if (!ensureMakerEditable()) return;
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
      if (!ensureMakerEditable()) return;
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
      if (!ensureMakerEditable()) return;
      if (!selectedItem) return;
      if (input.dataset.itemField === 'displayOrder') selectedItem.displayOrder = Math.max(1, Math.floor(Number(input.value || 1)));
      else if (input.dataset.itemField === 'visibility') selectedItem.visibility = input.value === 'private' ? 'private' : 'public';
      else if (input.value.trim()) selectedItem.label = input.value.trim();
      invalidateMakerUpload();
      renderCreatorDetails();
    });
  });

  document.querySelectorAll('[data-add-item]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!ensureMakerEditable()) return;
      if (slotItems(slot.key).length >= MAX_ITEMS_PER_PART) {
        slot.assetMessage = `This release supports up to ${MAX_ITEMS_PER_PART} Items per Part.`;
        renderCreatorDetails();
        return;
      }
      let next = slotItems(slot.key).length + 1;
      while (slotItems(slot.key).some((item) => item.id === `item-${next}`)) next += 1;
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
      if (index < 0 || !ensureMakerEditable()) return;
      const item = items[index];
      openConfirmation({
        title: 'Delete Item?',
        message: `“${item.label}” and all of its local Layer × Color PNG references will be removed from this draft.`,
        confirmLabel: 'Delete item',
        action: () => {
          if (item.iconAsset?.url) URL.revokeObjectURL(item.iconAsset.url);
          Object.values(item.images || {}).forEach((asset) => asset?.url && URL.revokeObjectURL(asset.url));
          items.splice(index, 1);
          state.rules = state.rules.filter((rule) => !(
            (rule.leftPartKey === slot.key && rule.leftItemKey === item.id)
            || (rule.rightPartKey === slot.key && rule.rightItemKey === item.id)
          ));
          state.selectedItem = items[Math.min(index, items.length - 1)]?.id || '';
          state.visual[slot.key] = state.selectedItem;
          if (slot.defaultItemId === item.id) slot.defaultItemId = state.selectedItem;
          syncCreatorAssets();
          invalidateMakerUpload('Item deleted. Prepare a new Walrus quilt before publishing.');
          renderAll();
        },
      });
    });
  });

  document.querySelector('[data-add-layer]')?.addEventListener('click', () => {
    if (slot.kind !== 'standard' || !ensureMakerEditable()) return;
    if (layers.length >= MAX_LAYERS_PER_PART) {
      slot.assetMessage = `A Part cannot contain more than ${MAX_LAYERS_PER_PART} Layers.`;
      renderCreatorDetails();
      return;
    }
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
      if (slot.kind !== 'standard' || layers.length <= 1 || !ensureMakerEditable()) return;
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
      if (!ensureMakerEditable()) return;
      const layer = layers.find((candidate) => candidate.id === input.dataset.inlineLayerName);
      if (layer) layer.name = input.value.trim() || layer.name;
      invalidateMakerUpload();
      renderCreatorDetails();
    });
  });

  document.querySelector('[data-add-color]')?.addEventListener('click', () => {
    if (!ensureMakerEditable()) return;
    if (colors.length >= MAX_COLORS_PER_PART) {
      slot.assetMessage = `A Part cannot contain more than ${MAX_COLORS_PER_PART} Colors.`;
      renderCreatorDetails();
      return;
    }
    const next = colors.length + 1;
    colors.push({ id: `color-${next}-${Date.now().toString(36)}`, name: `Color ${next}`, value: swatches[(next - 1) % swatches.length] });
    invalidateMakerUpload();
    renderCreatorDetails();
  });

  document.querySelectorAll('[data-color-name], [data-color-value]').forEach((input) => {
    input.addEventListener('change', () => {
      if (!ensureMakerEditable()) return;
      const colorId = input.dataset.colorName || input.dataset.colorValue;
      const color = colors.find((candidate) => candidate.id === colorId);
      if (!color) return;
      if (input.dataset.colorName) color.name = input.value.trim() || color.name;
      else color.value = input.value;
      invalidateMakerUpload();
      renderCreatorDetails();
    });
  });

  document.querySelectorAll('[data-delete-color]').forEach((button) => {
    button.addEventListener('click', () => {
      if (colors.length <= 1 || !ensureMakerEditable()) return;
      const color = colors.find((candidate) => candidate.id === button.dataset.deleteColor);
      if (!color) return;
      openConfirmation({
        title: 'Delete Color?',
        message: `“${color.name}” and its PNG cell in every Item and Layer of “${slot.label}” will be removed from this draft.`,
        confirmLabel: 'Delete color',
        action: () => {
          const colorIndex = colors.findIndex((candidate) => candidate.id === color.id);
          colors.splice(colorIndex, 1);
          items.forEach((item) => Object.keys(item.images || {}).forEach((key) => {
            if (key.endsWith(`:${color.id}`)) {
              if (item.images[key]?.url) URL.revokeObjectURL(item.images[key].url);
              delete item.images[key];
            }
          }));
          if (state.visual.palette[slot.colorKey] === color.value) state.visual.palette[slot.colorKey] = colors[0].value;
          syncCreatorAssets();
          invalidateMakerUpload('Color deleted. Prepare a new Walrus quilt before publishing.');
          renderCreatorDetails();
        },
      });
    });
  });
}

function updatePartField(slotKey, field, value) {
  if (!ensureMakerEditable()) return;
  const slot = allSlots().find((item) => item.key === slotKey);
  if (!slot) return;
  if (field === 'menuVisible') slot.menuVisible = value !== 'hidden';
  else if (field === 'allowRemove') slot.allowRemove = value === 'yes';
  else if (field === 'defaultItemId' && slotItems(slot.key).some((item) => item.id === value)) slot.defaultItemId = value;
  else if (field === 'label' && value.trim()) slot.label = value.trim();
  if (slot.kind === 'last-bastion') slot.allowRemove = false;
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
  const layerAssets = slotItems(slot.key).flatMap((item) => Object.entries(item.images || {}).filter(([key, asset]) => key.startsWith(`${layer.id}:`) && assetReady(asset)));
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
        <button class="secondary" data-open-layer-part="${escapeHtml(slot.key)}">Edit item images</button>
      </div>
    </div>
    <div class="part-detail-grid">
      <label>Layer name<input data-layer-field="name" value="${escapeHtml(layer.name)}" maxlength="128" /></label>
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
  if (!ensureMakerEditable()) return;
  const [partKey, layerId] = layerKey.split(':');
  const slot = allSlots().find((candidate) => candidate.key === partKey);
  const layer = slot && creatorLayers(slot).find((candidate) => candidate.id === layerId);
  if (!layer) return;
  if (field === 'x') layer.x = Math.min(state.makerCanvas.width, Math.max(-state.makerCanvas.width, Number(value || 0)));
  else if (field === 'y') layer.y = Math.min(state.makerCanvas.height, Math.max(-state.makerCanvas.height, Number(value || 0)));
  else if (field === 'opacity') layer.opacity = Math.min(100, Math.max(0, Number(value || 0)));
  else if (field === 'blendMode') layer.blendMode = ['normal', 'multiply', 'screen', 'overlay'].includes(value) ? value : 'normal';
  else layer.name = String(value || '').trim() || layer.name;
  invalidateMakerUpload();
  renderCreatorDetails();
}

function moveLayer(layerKey, direction) {
  if (!ensureMakerEditable()) return;
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
    const slot = allSlots().find((candidate) => candidate.key === layer.partKey);
    const asset = slot && itemLayerAsset(slot, item, layer);
    return asset?.url ? [{ layer, asset }] : [];
  });
  $('creatorCanvasAssets').innerHTML = images.map(({ layer, asset }) => `
    <img src="${escapeHtml(asset.url)}" alt="${escapeHtml(layer.partLabel)} ${escapeHtml(layer.name)}" style="${layerInlineStyle(layer)}" />
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
  if (!ensureMakerEditable()) return;
  if (!state.walletConnected) {
    openAccountPanel();
    return;
  }
  document.querySelectorAll('[data-new-part-type]').forEach((button) => {
    button.classList.toggle('active', button.dataset.newPartType === 'standard');
  });
  $('newPartMenuVisible').disabled = false;
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
  if ($('profileSummary')) {
    $('profileSummary').textContent = !state.walletConnected
      ? 'Creator profile appears after first Maker publication'
      : state.creatorProfileObjectId ? `Creator profile ${shortAddress(state.creatorProfileObjectId)}` : 'Creator profile will be created on first publication';
  }
  if ($('accountIdentity')) $('accountIdentity').textContent = state.walletConnected ? shortAddress(state.walletAddress) : 'Animacraft user';
  $('walletFirstCard').classList.toggle('connected', state.walletConnected);
  document.querySelector('.account-grid').classList.toggle('locked', !state.walletConnected);
  document.querySelectorAll('.account-grid [data-page]').forEach((button) => {
    button.disabled = !state.walletConnected;
  });
  if (!state.walletConnected) closeAccountPanel();
  if ($('creatorWalletGate')) $('creatorWalletGate').hidden = state.walletConnected;
  if ($('creatorConsole')) $('creatorConsole').hidden = !state.walletConnected;
  if ($('backToCreatorPreview')) $('backToCreatorPreview').hidden = !state.previewingMaker;
}

function publishReadiness() {
  if (!packageConfigured()) return 'Publish the Move package and set packageId in config.js.';
  if (!state.walletConnected) return 'Connect a Sui wallet to sign publication.';
  if (!$('creatorTemplateName').value.trim()) return 'Add a maker name in Settings.';
  const issue = makerPublicationIssues()[0];
  if (issue) return issue;
  return 'Prepare one Walrus quilt, register and upload it, certify it, then publish the maker on Sui Mainnet.';
}

function renderPublishAction() {
  if (!$('publishMakerOnchain')) return;
  const locked = makerIsPublished();
  const baseReady = !locked && packageConfigured() && state.walletConnected && itemLayerAssets().length > 0;
  $('resumeMakerUpload').disabled = locked || state.publishing || !state.walletConnected || !state.hasMakerUploadRecovery;
  $('prepareMakerUpload').disabled = state.publishing || !baseReady || state.makerUploadStage !== 'idle';
  $('registerMakerUpload').disabled = state.publishing || !state.walletConnected || !['encoded', 'registered'].includes(state.makerUploadStage);
  $('registerMakerUpload').textContent = state.makerUploadStage === 'registered' ? '2. Retry upload' : '2. Register & upload';
  $('certifyMakerUpload').disabled = state.publishing || !state.walletConnected || state.makerUploadStage !== 'uploaded';
  $('publishMakerOnchain').disabled = locked || state.publishing || !state.walletConnected || state.makerUploadStage !== 'certified';
  $('publishMakerOnchain').textContent = state.publishing ? 'Publishing…' : state.publishDigest ? 'Published' : '4. Publish maker';
  $('makerPublishAction').classList.toggle('success', Boolean(state.publishDigest));
  $('makerPublishAction').classList.toggle('busy', state.publishing);
  if (state.publishDigest) {
    $('makerPublishStatus').innerHTML = `Published on ${escapeHtml(runtimeConfig.network)}. <a href="${escapeHtml(explorerTransactionUrl(state.publishDigest))}" target="_blank" rel="noreferrer">View transaction</a>`;
  } else {
    $('makerPublishStatus').textContent = state.publishStatus || publishReadiness();
  }
}

function renderChainStatus() {
  if ($('refreshMakers')) {
    $('refreshMakers').disabled = state.chainMakersLoading || !packageConfigured();
    $('refreshMakers').textContent = state.chainMakersLoading ? 'Syncing Makers…' : 'Refresh Makers';
  }
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
        <strong>${escapeHtml(!packageConfigured() ? 'Publish package first' : shortAddress(runtimeConfig.packageId))}</strong>
      </div>
      <div>
        <span>Walrus</span>
        <strong>${runtimeConfig.walrusUploadRelayUrl ? `${Number(runtimeConfig.walrusEpochs || 53)} epoch retention` : 'Configure upload relay'}</strong>
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
    const coverBlob = await renderOcImageBlob();
    state.pendingMakerCoverBlob = coverBlob;
    state.pendingMakerAssets = [
      ...publishableAssets(),
      makerCoverAsset(coverBlob),
    ];
    state.pendingMakerAssets.forEach((asset) => {
      if (!asset.file) throw new Error(`${asset.name} is no longer available. Select the PNG files again.`);
    });
    state.pendingMakerManifestJson = JSON.stringify(creatorUploadManifest());
    state.makerUploadSession = await prepareWalrusUpload(makerUploadEntries());
    state.makerQuiltId = state.makerUploadSession.quiltBlobId;
    state.makerUploadStage = 'encoded';
    state.publishStatus = 'Quilt encoded. Register it on Walrus Mainnet with your wallet.';
    await persistMakerUploadRecovery();
  } catch (error) {
    state.publishStatus = error.message || 'Could not prepare the maker quilt.';
  } finally {
    if (state.makerUploadSession?.checkpoint) {
      persistMakerUploadRecovery().catch((error) => console.warn('Could not save Walrus upload recovery.', error));
    }
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
    state.makerUploadStage = state.makerUploadSession.stage;
    if (state.makerUploadStage === 'certified') {
      if (state.makerUploadSession.files.length !== state.pendingMakerAssets.length + 1) throw new Error('Walrus returned an unexpected number of quilt files.');
      state.pendingMakerAssets.forEach((asset, index) => {
        asset.patchId = state.makerUploadSession.files[index].id;
        asset.blobId = state.makerUploadSession.files[index].blobId;
      });
      state.makerQuiltId = state.makerUploadSession.files[0]?.blobId || state.makerQuiltId;
      state.publishStatus = 'The recovered quilt was already certified. Continue with Sui Maker publication.';
    } else {
      state.publishStatus = 'Quilt uploaded. Certify availability with one more wallet signature.';
    }
  } catch (error) {
    state.makerUploadStage = state.makerUploadSession?.stage || state.makerUploadStage;
    state.publishStatus = error.message || 'Walrus registration or upload failed.';
  } finally {
    if (state.makerUploadSession?.checkpoint) {
      persistMakerUploadRecovery().catch((error) => console.warn('Could not save Walrus upload recovery.', error));
    }
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
    state.makerQuiltId = state.makerUploadSession.files[0]?.blobId || state.makerQuiltId;
    state.makerUploadStage = 'certified';
    state.publishStatus = 'Walrus quilt certified. Publish the indexed OCMaker object on Sui Mainnet.';
  } catch (error) {
    state.publishStatus = error.message || 'Walrus certification failed.';
  } finally {
    if (state.makerUploadSession?.checkpoint) {
      persistMakerUploadRecovery().catch((error) => console.warn('Could not save Walrus upload recovery.', error));
    }
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
      state.makerQuiltId = '';
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
        colors: creatorColors(slot).map((color) => color.value),
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
        profileId: state.creatorProfileObjectId,
        displayName: $('creatorName').value.trim(),
        bio: `${$('creatorWorld').value.trim()} OC maker creator`,
        avatarUrl: '',
      },
      maker: {
        name: $('creatorTemplateName').value.trim(),
        description: activeTemplate().summary,
        coverUrl: walrusFileUrl(state.pendingMakerAssets.find((asset) => asset.kind === 'maker-cover')?.patchId),
        license: $('creatorLicense').value,
        royaltyBps: Number($('creatorRoyalty').value || 0),
        mintingEnabled: $('creatorMintingEnabled').checked,
        mintFeeEnabled: $('creatorMintFeeEnabled').checked,
        mintPriceAtomic: $('creatorMintFeeEnabled').checked ? decimalCoinToAtomic($('creatorMintPrice').value) : 0,
      },
      manifestBlobId: state.makerQuiltId,
      parts: makerParts,
      items: makerItems,
      rules: makerRules,
      paletteLinks: state.paletteLinks,
    });
    state.publishDigest = transaction.digest;
    state.makerObjectId = transaction.makerObjectId || '';
    state.makerTreasuryObjectId = transaction.makerTreasuryObjectId || '';
    state.makerAdminCapObjectId = transaction.makerAdminCapObjectId || '';
    state.creatorProfileObjectId = transaction.creatorProfileObjectId || state.creatorProfileObjectId;
    state.makerArchived = false;
    state.publishStatus = state.makerObjectId
      ? ''
      : 'Published on Sui. The object id is still indexing, so this browser is retaining the recovery draft.';
    Object.assign(activeTemplate(), {
      source: state.makerObjectId ? 'chain' : 'local',
      owned: true,
      objectId: state.makerObjectId,
      treasuryId: state.makerTreasuryObjectId,
      adminCapId: state.makerAdminCapObjectId,
      mintingEnabled: $('creatorMintingEnabled').checked,
      mintFeeEnabled: $('creatorMintFeeEnabled').checked,
      mintPriceAtomic: $('creatorMintFeeEnabled').checked ? decimalCoinToAtomic($('creatorMintPrice').value) : 0,
      quiltId: state.makerQuiltId,
      price: $('creatorMintFeeEnabled').checked
        ? `${$('creatorMintPrice').value} ${runtimeConfig.paymentCoinSymbol}`
        : state.makerObjectId ? 'Free mint' : 'Indexing',
    });
    await saveCurrentMakerDraft();
    loadActiveTreasuryBalance({ force: true });
    clearMakerUploadRecovery().catch((error) => console.warn('Could not clear completed Walrus recovery data.', error));
    if (!state.makerObjectId) setTimeout(recoverPublishedMakerIndex, 4_000);
  } catch (error) {
    console.error('Maker publication failed', error);
    state.publishStatus = error.message || 'Maker publication failed.';
  } finally {
    state.publishing = false;
    renderAll();
  }
}

async function updateMakerArchiveState(archived) {
  if (state.publishing || !state.makerObjectId || !makerIsPublished()) return;
  state.publishing = true;
  state.publishStatus = archived
    ? 'Waiting for your Sui signature to archive this Maker…'
    : 'Waiting for your Sui signature to restore this Maker…';
  renderAll();
  try {
    const transaction = await setMakerArchived(state.makerObjectId, state.makerAdminCapObjectId, archived);
    state.makerArchived = archived;
    state.publishStatus = `${archived ? 'Archived' : 'Restored'} on ${runtimeConfig.network}: ${transaction.digest}`;
    await saveCurrentMakerDraft();
  } catch (error) {
    state.publishStatus = error.message || `Could not ${archived ? 'archive' : 'restore'} this Maker.`;
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
    const issues = ocRecipeIssues();
    if (issues.length) throw new Error(issues[0]);
    const oc = ocPackage();
    const image = await renderOcImageBlob();
    const recipeJson = JSON.stringify(oc.recipe);
    const chainRecipe = oc.recipe.map((slot) => ({
      partKey: slot.slot,
      itemKey: slot.part,
      colorHex: slot.color,
      renderOrder: slot.renderOrder,
    }));
    const recipeHash = await hashRecipe(chainRecipe);
    oc.integrity = {
      recipeEncoding: 'BCS vector<RecipeSlot>',
      recipeHashAlgorithm: 'SHA-256',
      recipeHash: bytesToHex(recipeHash),
    };
    const profile = new Blob([JSON.stringify(oc)], { type: 'application/json' });
    state.pendingOcPackage = oc;
    state.pendingOcImageBlob = image;
    state.pendingOcProfileBlob = profile;
    state.pendingOcRecipeJson = recipeJson;
    state.pendingOcRecipeHash = recipeHash;
    state.pendingOcFingerprint = ocFingerprint(oc);
    state.ocUploadSession = await prepareWalrusUpload(ocUploadEntries());
    state.ocUploadStage = 'encoded';
    state.mintStatus = 'OC quilt encoded. Register it on Walrus Mainnet.';
    await persistOcUploadRecovery();
  } catch (error) {
    state.mintStatus = error.message || 'Could not prepare the OC quilt.';
  } finally {
    if (state.ocUploadSession?.checkpoint) {
      persistOcUploadRecovery().catch((error) => console.warn('Could not save OC upload recovery.', error));
    }
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
    state.ocUploadStage = state.ocUploadSession.stage;
    if (state.ocUploadStage === 'certified') {
      if (state.ocUploadSession.files.length !== 2) throw new Error('Walrus returned an unexpected OC quilt result.');
      state.ocImagePatchId = state.ocUploadSession.files[0].id;
      state.ocProfilePatchId = state.ocUploadSession.files[1].id;
      state.mintStatus = 'The recovered OC quilt is certified. Continue to Soulidity for the canonical mint.';
    } else {
      state.mintStatus = 'OC quilt uploaded. Certify it with one more signature.';
    }
  } catch (error) {
    state.ocUploadStage = state.ocUploadSession?.stage || state.ocUploadStage;
    state.mintStatus = error.message || 'OC registration or upload failed.';
  } finally {
    if (state.ocUploadSession?.checkpoint) {
      persistOcUploadRecovery().catch((error) => console.warn('Could not save OC upload recovery.', error));
    }
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
    state.mintStatus = 'OC files certified. Continue to Soulidity for the canonical Soul mint.';
  } catch (error) {
    state.mintStatus = error.message || 'OC certification failed.';
  } finally {
    if (state.ocUploadSession?.checkpoint) {
      persistOcUploadRecovery().catch((error) => console.warn('Could not save OC upload recovery.', error));
    }
    state.minting = false;
    renderMintAction();
  }
}

async function mintCurrentOc() {
  if (state.minting || state.ocUploadStage !== 'certified') return;
  state.minting = true;
  state.mintStatus = 'Preparing the Soulidity import package…';
  renderMintAction();
  try {
    if (ocFingerprint() !== state.pendingOcFingerprint) {
      state.ocUploadSession = null;
      state.ocUploadStage = 'idle';
      state.ocImagePatchId = '';
      state.ocProfilePatchId = '';
      await clearOcUploadRecovery();
      throw new Error('The OC profile or recipe changed after upload. Prepare a new mint quilt.');
    }
    if (activeTemplate().mintFeeEnabled) throw new Error('Paid Maker minting requires the Soulidity authorization adapter and cannot use the file handoff.');
    const oc = state.pendingOcPackage;
    const imageUrl = walrusFileUrl(state.ocImagePatchId);
    const profileUrl = walrusFileUrl(state.ocProfilePatchId);
    const handoffUrl = new URL('/import', runtimeConfig.soulidityAppUrl);
    handoffUrl.searchParams.set('source', 'animacraft');
    handoffUrl.searchParams.set('maker', activeMakerObjectId());
    handoffUrl.searchParams.set('profile', profileUrl);
    handoffUrl.searchParams.set('image', imageUrl);
    window.open(handoffUrl.toString(), '_blank', 'noopener,noreferrer');

    const importJson = createSoulidityImportJson(state.livingContent, {
      maker: activeTemplate(),
      makerId: activeMakerObjectId(),
      profile: oc.profile,
      imageUrl,
      profileUrl,
      recipeHash: bytesToHex(state.pendingOcRecipeHash),
    });
    const imageBytes = new Uint8Array(await state.pendingOcImageBlob.arrayBuffer());
    const { bytes } = createSoulidityImportBundle(state.livingContent, {
      maker: activeTemplate(),
      makerId: activeMakerObjectId(),
      profile: oc.profile,
      imageUrl,
      profileUrl,
      recipeHash: bytesToHex(state.pendingOcRecipeHash),
      importJson,
      imageBytes,
    });
    download(`${slug(oc.profile.name)}-soulidity-import-kit.zip`, bytes, 'application/zip');
    state.mintStatus = 'Soulidity opened and the Import Kit was downloaded. Extract it, upload 00-profile.json, then add its cover, Soul Character, Memory, and Skills files to complete the single Soul mint.';
  } catch (error) {
    console.error('Soulidity handoff failed', error);
    state.mintStatus = error.message || 'Soulidity handoff failed.';
  } finally {
    state.minting = false;
    renderMintAction();
  }
}

async function restoreMakerDraft(templateId = state.templateId) {
  const storageKey = makerDraftStorageKey(templateId);
  loadedMakerDrafts.add(storageKey);
  try {
    let draft = await loadMakerDraftRecord(storageKey);
    if (!draft) {
      const raw = localStorage.getItem(storageKey)
        || (templateId === state.templateId ? localStorage.getItem('animacraft-maker-draft-v1') : null);
      if (!raw) return;
      draft = JSON.parse(raw);
      await saveMakerDraftRecord(storageKey, draft);
      localStorage.removeItem(storageKey);
      if (templateId === state.templateId) localStorage.removeItem('animacraft-maker-draft-v1');
    }
    if (state.templateId !== templateId || (draft.templateId && draft.templateId !== templateId)) return;
    if (draft.visual && typeof draft.visual === 'object') {
      const restoredVisual = structuredClone(draft.visual);
      restoredVisual.palette = Object.fromEntries(Object.entries(restoredVisual.palette || {}).map(([key, value]) => [key, safeCssColor(value)]));
      state.visual = restoredVisual;
    }
    if (Array.isArray(draft.rules)) state.rules = draft.rules.slice(0, MAX_MAKER_RULES).filter((rule) => rule && typeof rule === 'object');
    if (Array.isArray(draft.paletteLinks)) state.paletteLinks = draft.paletteLinks.slice(0, MAX_MAKER_RULES).filter((link) => link && typeof link === 'object');
    if (Array.isArray(draft.manifest?.parts)) {
      state.makerSlots = [];
      state.makerParts = {};
      state.slotOrder = [];
      state.layerOrder = [];
      const restoredPartKeys = new Set();
      draft.manifest.parts.slice(0, MAX_MAKER_PARTS).forEach((savedPart) => {
        const partKey = safeDraftText(savedPart?.key, '', 128);
        if (!isSafeKey(partKey) || restoredPartKeys.has(partKey)) return;
        restoredPartKeys.add(partKey);
        const partLabel = safeDraftText(savedPart?.label, partKey, 128) || partKey;
        const kind = ['standard', 'left-right-pair', 'last-bastion'].includes(savedPart.kind) ? savedPart.kind : 'standard';
        const layers = (Array.isArray(savedPart.layers) ? savedPart.layers : []).slice(0, MAX_LAYERS_PER_PART).filter((layer, index, list) => {
          const id = safeDraftText(layer?.id, '', 128);
          return isSafeKey(id) && list.findIndex((candidate) => candidate?.id === layer.id) === index;
        }).map((layer, index) => ({
          id: safeDraftText(layer.id, `layer-${index + 1}`, 128),
          name: safeDraftText(layer.name, `Layer ${index + 1}`, 128),
          x: finiteNumber(layer.x, 0, -8_192, 8_192),
          y: finiteNumber(layer.y, 0, -8_192, 8_192),
          opacity: finiteNumber(layer.opacity, 100, 0, 100),
          blendMode: ['normal', 'multiply', 'screen', 'overlay'].includes(layer.blendMode) ? layer.blendMode : 'normal',
          renderOrder: Math.max(0, Math.floor(finiteNumber(layer.renderOrder, index, 0, MAX_MAKER_PARTS * MAX_LAYERS_PER_PART))),
        }));
        const colors = (Array.isArray(savedPart.colors) ? savedPart.colors : []).slice(0, MAX_COLORS_PER_PART).filter((color, index, list) => {
          const id = safeDraftText(color?.id, '', 128);
          return isSafeKey(id) && /^#[0-9a-f]{6}$/i.test(String(color?.value || '')) && list.findIndex((candidate) => candidate?.id === color.id) === index;
        }).map((color, index) => ({
          id: safeDraftText(color.id, `color-${index + 1}`, 128),
          name: safeDraftText(color.name, `Color ${index + 1}`, 128),
          value: safeCssColor(color.value),
        }));
        const slot = {
          key: partKey,
          label: partLabel,
          icon: partLabel.slice(0, 2).toUpperCase(),
          colorKey: partKey,
          description: 'Restored creator Part',
        };
        state.makerSlots.push(slot);
        Object.assign(slot, {
          kind,
          menuVisible: savedPart.menuVisible !== false,
          allowRemove: kind === 'last-bastion' ? false : savedPart.allowRemove !== false,
          defaultItemId: safeDraftText(savedPart.defaultItemId, '', 128),
          layers: layers.length ? layers : [{ id: 'normal', name: 'Normal', x: 0, y: 0, opacity: 100, blendMode: 'normal', renderOrder: state.layerOrder.length }],
          colors: colors.length ? colors : [{ id: 'default', name: 'Default', value: '#7b5cff' }],
        });
        if (!state.slotOrder.includes(slot.key)) state.slotOrder.push(slot.key);
        const restoredItemIds = new Set();
        state.makerParts[slot.key] = (Array.isArray(savedPart.items) ? savedPart.items : []).slice(0, MAX_ITEMS_PER_PART).filter((item) => {
          const id = safeDraftText(item?.id, '', 128);
          if (!isSafeKey(id) || restoredItemIds.has(id)) return false;
          restoredItemIds.add(id);
          return true;
        }).map((item, index) => ({
          id: safeDraftText(item.id, `item-${index + 1}`, 128),
          label: safeDraftText(item.label, `Item ${index + 1}`, 128),
          displayOrder: Math.max(1, Math.floor(finiteNumber(item.displayOrder, index + 1, 1, 10_000))),
          visibility: item.visibility === 'private' ? 'private' : 'public',
          images: {},
          iconAsset: null,
        }));
        slot.layers.forEach((layer) => {
          state.layerOrder[layer.renderOrder] = creatorLayerKey(slot.key, layer.id);
        });
      });
      state.layerOrder = state.layerOrder.filter(Boolean);
    }
    const template = draft.manifest?.template;
    if (template) {
      if (template.canvas?.width && template.canvas?.height) {
        state.makerCanvas = {
          width: Math.round(finiteNumber(template.canvas.width, 1024, 256, 8_192)),
          height: Math.round(finiteNumber(template.canvas.height, 1024, 256, 8_192)),
        };
      }
      const currentTemplate = activeTemplate();
      currentTemplate.name = safeDraftText(template.name, currentTemplate.name, 128) || currentTemplate.name;
      currentTemplate.summary = safeDraftText(template.summary, currentTemplate.summary, 2_000);
      currentTemplate.creator = safeDraftText(template.creator, currentTemplate.creator, 128) || currentTemplate.creator;
      currentTemplate.style = safeDraftText(template.style, currentTemplate.style, 128) || currentTemplate.style;
      currentTemplate.license = creatorLicenseLabels?.[template.license] || currentTemplate.license;
      currentTemplate.licenseNote = safeDraftText(template.licenseNote, currentTemplate.licenseNote, 2_000);
      currentTemplate.royaltyBps = [0, 100, 200, 300, 400, 500].includes(Number(template.royaltyBps))
        ? Number(template.royaltyBps)
        : 0;
      currentTemplate.mintingEnabled = template.mintingEnabled !== false;
      currentTemplate.mintFeeEnabled = Boolean(template.mintFeeEnabled);
      currentTemplate.mintPriceAtomic = Number(template.mintPriceAtomic || 0);
      $('creatorTemplateName').value = currentTemplate.name;
      $('creatorDescription').value = currentTemplate.summary;
      $('creatorName').value = currentTemplate.creator;
      $('creatorWorld').value = currentTemplate.style;
      $('creatorLicense').value = Object.entries(creatorLicenseLabels).find(([, label]) => label === currentTemplate.license)?.[0] || 'personal-use';
      $('creatorLicenseNote').value = currentTemplate.licenseNote;
      $('creatorRoyalty').value = currentTemplate.royaltyBps;
      $('creatorMintingEnabled').checked = currentTemplate.mintingEnabled;
      $('creatorMintFeeEnabled').checked = currentTemplate.mintFeeEnabled;
      $('creatorMintPrice').value = currentTemplate.mintPriceAtomic
        ? String(atomicCoinToDecimal(currentTemplate.mintPriceAtomic))
        : '1';
      $('creatorMintPrice').disabled = !currentTemplate.mintFeeEnabled;
    }
    if (draft.chain) {
      state.publishDigest = String(draft.chain.publishDigest || '');
      state.makerObjectId = String(draft.chain.makerObjectId || '');
      state.makerTreasuryObjectId = String(draft.chain.makerTreasuryObjectId || '');
      state.makerAdminCapObjectId = String(draft.chain.makerAdminCapObjectId || '');
      state.makerArchived = Boolean(draft.chain.archived);
    }
    state.livingContent = normalizeLivingContent(draft.manifest?.livingContent, activeTemplate());
    syncActiveMakerModelRefs();
    await restoreMakerAssets(templateId);
    recoverPublishedMakerIndex();
    renderAll();
  } catch (error) {
    loadedMakerDrafts.delete(storageKey);
    console.warn('Ignored an unreadable local maker draft.', error);
  }
}

function renderAll() {
  renderTemplates();
  renderTemplateDetail();
  renderSlots();
  renderParts();
  renderSwatches();
  renderAvatar();
  renderRecipe();
  renderChecklist();
  renderCreatorValidation();
  renderRules();
  renderPaletteLinks();
  renderLivingContent();
  renderPackage();
  renderImageMakerList();
  renderCreatorDetails();
  renderProtocol();
  renderChainStatus();
  renderChainActions();
  renderMintAction();
  renderOwnedCharacters();
  renderI18n();
  renderWalletState();
  setCreatorView(state.creatorView);
  setEditorPanel(state.editorPanel);
  renderMakerLifecycle();
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
$('templateDetailBack')?.addEventListener('click', () => {
  setPage('templates');
  renderAll();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
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
    if (button.hasAttribute('data-focus-composition')) {
      $('compositionOrder')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
});

document.querySelectorAll('[data-living-document]').forEach((button) => {
  button.addEventListener('click', () => {
    state.livingDocument = button.dataset.livingDocument;
    renderLivingContent();
  });
});

$('livingDocumentSource')?.addEventListener('input', (event) => {
  if (!ensureMakerEditable()) return;
  const key = state.livingDocument;
  state.livingContent[key] = event.target.value;
  state.livingContent.customized[key] = true;
  try {
    validateLivingContent(state.livingContent);
    event.target.setCustomValidity('');
  } catch (error) {
    event.target.setCustomValidity(error.message);
  }
  invalidateMakerUpload();
  scheduleMakerAutosave();
  renderLivingContent();
});

$('restoreLivingDefault')?.addEventListener('click', () => {
  if (!ensureMakerEditable()) return;
  const defaults = createDefaultLivingContent(livingMakerContext());
  state.livingContent[state.livingDocument] = defaults[state.livingDocument];
  state.livingContent.customized[state.livingDocument] = false;
  invalidateMakerUpload();
  scheduleMakerAutosave();
  renderLivingContent();
});

$('downloadLivingTemplate')?.addEventListener('click', () => {
  const { bytes } = createSoulidityImportBundle(state.livingContent, {
    maker: livingMakerContext(),
    makerId: activeMakerObjectId(),
    profile: {
      name: '{{OC_NAME}}',
      world: '{{OC_WORLD}}',
      description: '{{OC_DESCRIPTION}}',
    },
  });
  download(`${slug($('creatorTemplateName').value)}-living-content.zip`, bytes, 'application/zip');
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
  invalidateOcUpload();
  applyPaletteColor(slot, event.target.value);
  renderAll();
});

['profileName', 'profileWorld', 'profileDescription', 'profileTags'].forEach((id) => {
  $(id).addEventListener('input', () => {
    invalidateOcUpload();
    renderAll();
  });
});

const creatorLicenseLabels = {
  'personal-use': 'Personal use',
  'free-remix': 'Free remix',
  'paid-commercial': 'Paid commercial',
  'exclusive-commission': 'Exclusive commission',
};

['creatorTemplateName', 'creatorDescription', 'creatorName', 'creatorWorld', 'creatorLicense', 'creatorLicenseNote', 'creatorRoyalty', 'creatorMintingEnabled', 'creatorMintFeeEnabled', 'creatorMintPrice'].forEach((id) => {
  $(id).addEventListener('input', () => {
    const economicsField = ['creatorRoyalty', 'creatorMintingEnabled', 'creatorMintFeeEnabled', 'creatorMintPrice'].includes(id);
    if (!economicsField && !ensureMakerEditable()) return;
    const template = activeTemplate();
    if (id === 'creatorTemplateName') template.name = $('creatorTemplateName').value;
    else if (id === 'creatorDescription') template.summary = $('creatorDescription').value;
    else if (id === 'creatorName') template.creator = $('creatorName').value;
    else if (id === 'creatorWorld') template.style = $('creatorWorld').value;
    else if (id === 'creatorLicense') template.license = creatorLicenseLabels[$('creatorLicense').value] || 'Personal use';
    else if (id === 'creatorLicenseNote') template.licenseNote = $('creatorLicenseNote').value;
    else if (id === 'creatorRoyalty') template.royaltyBps = Number($('creatorRoyalty').value || 0);
    else if (id === 'creatorMintingEnabled') {
      template.mintingEnabled = $('creatorMintingEnabled').checked;
      if (!template.mintingEnabled) {
        template.mintFeeEnabled = false;
        $('creatorMintFeeEnabled').checked = false;
      }
    } else if (id === 'creatorMintFeeEnabled') {
      if ($('creatorMintFeeEnabled').checked && !canonicalSoulMintEnabled) {
        $('creatorMintFeeEnabled').checked = false;
        template.mintFeeEnabled = false;
        state.publishStatus = 'Paid mint stays off until the canonical Soulidity adapter is deployed and verified.';
      } else {
        template.mintFeeEnabled = $('creatorMintFeeEnabled').checked;
      }
      $('creatorMintPrice').disabled = !canonicalSoulMintEnabled || !template.mintFeeEnabled;
    } else if (id === 'creatorMintPrice') {
      template.mintPriceAtomic = decimalCoinToAtomic($('creatorMintPrice').value) || 0;
    }
    if (['creatorTemplateName', 'creatorDescription', 'creatorName', 'creatorWorld'].includes(id)) refreshLivingDefaults();
    if (!makerIsPublished()) invalidateMakerUpload();
    if (!makerIsPublished()) scheduleMakerAutosave();
    persistLocalMakerIndex();
    renderAll();
  });
});

$('prepareMakerUpload')?.addEventListener('click', prepareMakerUpload);
$('resumeMakerUpload')?.addEventListener('click', async () => {
  state.publishing = true;
  state.publishStatus = 'Restoring the saved Walrus upload checkpoint…';
  renderAll();
  await restoreMakerUploadRecovery(state.templateId, { force: true });
  state.publishing = false;
  renderAll();
});
$('registerMakerUpload')?.addEventListener('click', registerMakerUpload);
$('certifyMakerUpload')?.addEventListener('click', certifyMakerUpload);
$('publishMakerOnchain')?.addEventListener('click', publishCurrentMaker);
$('archiveMakerOnchain')?.addEventListener('click', () => {
  if (state.makerArchived) {
    updateMakerArchiveState(false);
    return;
  }
  openConfirmation({
    title: 'Archive published Maker?',
    message: 'New Soul authorizations will be blocked on Sui. Existing Soul ownership, license snapshots, provenance, and Walrus records remain intact. You can restore the Maker later.',
    confirmLabel: 'Archive maker',
    action: () => updateMakerArchiveState(true),
  });
});
$('updateMakerEconomics')?.addEventListener('click', async () => {
  if (!makerIsPublished()) {
    $('makerEconomicsStatus').textContent = 'These settings will be included when this Maker is first published.';
    return;
  }
  if (!state.makerAdminCapObjectId) {
    $('makerEconomicsStatus').textContent = 'Connect the wallet that currently owns this MakerAdminCap.';
    return;
  }
  const mintPriceAtomic = $('creatorMintFeeEnabled').checked ? decimalCoinToAtomic($('creatorMintPrice').value) : 0;
  const royaltyBps = Number($('creatorRoyalty').value || 0);
  if ($('creatorMintFeeEnabled').checked && !canonicalSoulMintEnabled) {
    $('makerEconomicsStatus').textContent = 'Paid mint remains release-gated. Disable the fee before updating this Maker.';
    return;
  }
  if ($('creatorMintFeeEnabled').checked && !mintPriceAtomic) {
    $('makerEconomicsStatus').textContent = `Enter a valid ${runtimeConfig.paymentCoinSymbol} mint price.`;
    return;
  }
  state.publishing = true;
  $('makerEconomicsStatus').textContent = 'Waiting for the MakerAdminCap owner signature…';
  try {
    const transaction = await configureMakerEconomics({
      makerId: state.makerObjectId,
      adminCapId: state.makerAdminCapObjectId,
      mintingEnabled: $('creatorMintingEnabled').checked,
      mintFeeEnabled: $('creatorMintFeeEnabled').checked,
      mintPriceAtomic,
      royaltyBps,
    });
    Object.assign(activeTemplate(), {
      mintingEnabled: $('creatorMintingEnabled').checked,
      mintFeeEnabled: $('creatorMintFeeEnabled').checked,
      mintPriceAtomic,
      royaltyBps,
      price: mintPriceAtomic ? `${$('creatorMintPrice').value} ${runtimeConfig.paymentCoinSymbol}` : 'Free mint',
    });
    $('makerEconomicsStatus').textContent = `On-chain settings updated: ${transaction.digest}`;
    await saveCurrentMakerDraft({ silent: true });
  } catch (error) {
    $('makerEconomicsStatus').textContent = error.message || 'The on-chain settings update failed.';
  } finally {
    state.publishing = false;
    renderAll();
  }
});
$('withdrawMakerRevenue')?.addEventListener('click', async () => {
  const amountAtomic = decimalCoinToAtomic($('creatorWithdrawAmount').value);
  if (!makerIsPublished() || !state.makerTreasuryObjectId || !state.makerAdminCapObjectId) {
    $('makerEconomicsStatus').textContent = 'A published Maker, its Treasury, and its MakerAdminCap are required.';
    return;
  }
  if (!amountAtomic) {
    $('makerEconomicsStatus').textContent = `Enter a valid ${runtimeConfig.paymentCoinSymbol} withdrawal amount.`;
    return;
  }
  state.publishing = true;
  $('makerEconomicsStatus').textContent = 'Waiting for the MakerAdminCap owner signature…';
  try {
    const transaction = await withdrawMakerRevenue({
      makerId: state.makerObjectId,
      treasuryId: state.makerTreasuryObjectId,
      adminCapId: state.makerAdminCapObjectId,
      amountAtomic,
      recipient: state.walletAddress,
    });
    $('makerEconomicsStatus').textContent = `${$('creatorWithdrawAmount').value} ${runtimeConfig.paymentCoinSymbol} withdrawn: ${transaction.digest}`;
    await loadActiveTreasuryBalance({ force: true });
  } catch (error) {
    $('makerEconomicsStatus').textContent = error.message || 'The Treasury withdrawal failed.';
  } finally {
    state.publishing = false;
    renderAll();
  }
});
$('deleteMakerDraft')?.addEventListener('click', () => requestDeleteMaker());

$('addSelectionRule')?.addEventListener('click', () => {
  if (!ensureMakerEditable()) return;
  if (state.rules.length >= MAX_MAKER_RULES) {
    state.publishStatus = `A Maker cannot contain more than ${MAX_MAKER_RULES} selection rules.`;
    renderPublishAction();
    return;
  }
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
  if (!ensureMakerEditable()) return;
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

$('saveMakerDraft')?.addEventListener('click', async () => {
  if (!ensureMakerEditable()) return;
  try {
    await saveCurrentMakerDraft();
  } catch (error) {
    state.draftSaveStatus = 'error';
    state.draftSaveMessage = error.message || 'Could not save PNG assets in this browser.';
    renderMakerLifecycle();
  }
});

$('downloadManifest').addEventListener('click', () => {
  download(`${slug($('creatorTemplateName').value)}-manifest.json`, JSON.stringify(creatorManifest(), null, 2));
});

$('downloadPackage').addEventListener('click', () => {
  download(`${slug($('profileName').value)}-oc-package.json`, JSON.stringify(ocPackage(), null, 2));
});

$('prepareOcUpload')?.addEventListener('click', prepareOcUpload);
$('resumeOcUpload')?.addEventListener('click', async () => {
  state.minting = true;
  state.mintStatus = 'Restoring the saved OC upload checkpoint…';
  renderAll();
  await restoreOcUploadRecovery(state.templateId, { force: true });
  state.minting = false;
  renderAll();
});
$('registerOcUpload')?.addEventListener('click', registerOcUpload);
$('certifyOcUpload')?.addEventListener('click', certifyOcUpload);
$('mintOcOnchain')?.addEventListener('click', mintCurrentOc);
$('refreshOwnedCharacters')?.addEventListener('click', () => {
  window.open(runtimeConfig.soulidityAppUrl, '_blank', 'noopener,noreferrer');
});
$('refreshMakers')?.addEventListener('click', () => {
  state.chainMakersLoadedFor = '';
  state.chainMakerLoadError = '';
  loadBundledMakers();
  loadChainMakers(state.walletAddress);
});

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

document.querySelectorAll('[data-maker-start]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-maker-start]').forEach((item) => item.classList.toggle('active', item === button));
  });
});

document.querySelectorAll('[data-new-part-type]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-new-part-type]').forEach((item) => item.classList.toggle('active', item === button));
    const isLastBastion = button.dataset.newPartType === 'last-bastion';
    $('newPartMenuVisible').disabled = isLastBastion;
    if (isLastBastion) $('newPartMenuVisible').value = 'visible';
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

document.querySelectorAll('[data-close-confirm-modal]').forEach((button) => {
  button.addEventListener('click', closeConfirmation);
});

$('confirmActionModal').addEventListener('click', (event) => {
  if (event.target === $('confirmActionModal')) closeConfirmation();
});

$('confirmActionButton').addEventListener('click', async () => {
  const action = pendingConfirmation;
  closeConfirmation();
  if (!action) return;
  try {
    await action();
  } catch (error) {
    state.publishStatus = error.message || 'The requested action could not be completed.';
    renderAll();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if ($('confirmActionModal').classList.contains('active')) closeConfirmation();
  else if ($('partRegistrationModal').classList.contains('active')) closePartModal();
  else if ($('makerRegistrationModal').classList.contains('active')) closeMakerModal();
  else if ($('accountPanel').classList.contains('active')) closeAccountPanel();
});

$('registerMaker').addEventListener('click', async () => {
  if (!state.walletConnected) {
    closeMakerModal();
    openAccountPanel();
    return;
  }
  const name = $('newMakerName').value.trim() || 'Untitled OC Maker';
  const canvas = document.querySelector('[data-canvas-choice].active')?.dataset.canvasChoice || '1:1';
  const canvasSize = canvas === '9:16' ? { width: 1080, height: 1920 } : { width: 1024, height: 1024 };
  const makerStart = document.querySelector('[data-maker-start].active')?.dataset.makerStart || 'character';
  const id = `${slug(name).slice(0, 96)}-${Date.now().toString(36)}`;
  templates.unshift({
    id,
    source: 'local',
    owner: state.walletAddress,
    name,
    category: 'daily',
    creator: shortAddress(state.walletAddress) || 'Creator',
    style: canvas,
    license: 'Personal use',
    royaltyBps: 300,
    mintingEnabled: true,
    mintFeeEnabled: false,
    mintPriceAtomic: 0,
    mintPrice: 1,
    price: 'Draft',
    accent: '#27c5c8',
    secondary: '#f0a23a',
    summary: 'Character Maker draft. Add Parts, Items, Layers, Colors, and aligned PNG images.',
    licenseNote: 'Personal use only. Credit the creator when the OC is shared publicly.',
  });
  persistLocalMakerIndex();
  activateMakerModel(id, { empty: makerStart === 'blank', starter: makerStart === 'character', canvas: canvasSize });
  syncTemplateFields();
  await saveCurrentMakerDraft({ silent: true });
  state.creatorView = 'edit';
  state.editorPanel = 'parts';
  $('newMakerName').value = '';
  closeMakerModal();
  renderAll();
  focusCreatorTop();
});

$('registerPart').addEventListener('click', () => {
  if (!ensureMakerEditable()) {
    closePartModal();
    return;
  }
  if (!state.walletConnected) {
    closePartModal();
    openAccountPanel();
    return;
  }
  if (allSlots().length >= MAX_MAKER_PARTS) {
    closePartModal();
    state.publishStatus = `A Maker cannot contain more than ${MAX_MAKER_PARTS} Parts.`;
    renderAll();
    return;
  }
  const label = $('newPartName').value.trim() || 'New part';
  const key = `${slug(label).slice(0, 96)}-${Date.now().toString(36)}`;
  const kind = document.querySelector('[data-new-part-type].active')?.dataset.newPartType || 'standard';
  const itemLabel = $('newPartItemName').value.trim() || 'Normal';
  const layerName = $('newPartLayerName').value.trim() || 'Normal';
  const menuVisible = kind === 'last-bastion' || $('newPartMenuVisible').value === 'visible';
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
    allowRemove: kind !== 'last-bastion',
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
  if (['templates', 'template', 'make', 'collection', 'creator', 'docs', 'protocol', 'editor'].includes(page)) setPage(page);
});

window.addEventListener('popstate', () => {
  const makerMatch = location.pathname.match(/\/maker\/([^/]+)$/);
  if (makerMatch) {
    try {
      const reference = decodeURIComponent(makerMatch[1]);
      const template = templates.find((candidate) => candidate.id === reference || candidate.objectId === reference);
      if (template) {
        openTemplateDetail(template.id, { updatePath: false });
        return;
      }
      state.routeMakerReference = reference;
      state.chainMakersLoadedFor = '';
      loadChainMakers(state.walletAddress);
      return;
    } catch {
      state.routeMakerReference = '';
    }
  }
  const page = location.hash.replace('#', '') || 'templates';
  setPage(['templates', 'template', 'make', 'collection', 'creator', 'docs'].includes(page) ? page : 'templates');
  renderAll();
});

window.addEventListener('beforeunload', (event) => {
  const makerInFlight = state.publishing || ['registered', 'uploaded', 'certified'].includes(state.makerUploadStage);
  const ocInFlight = state.minting || ['registered', 'uploaded', 'certified'].includes(state.ocUploadStage);
  if (!makerInFlight && !ocInFlight) return;
  event.preventDefault();
  event.returnValue = '';
});

let initialPage = location.hash.replace('#', '') || 'templates';
const directMakerMatch = location.pathname.match(/\/maker\/([^/]+)$/);
if (directMakerMatch) {
  try {
    const reference = decodeURIComponent(directMakerMatch[1]);
    const knownTemplate = templates.find((template) => template.id === reference || template.objectId === reference);
    if (knownTemplate) {
      activateMakerModel(knownTemplate.id);
      state.routeMakerReference = '';
      initialPage = 'template';
    } else {
      state.routeMakerReference = reference;
      initialPage = 'templates';
    }
  } catch {
    state.routeMakerReference = '';
  }
}

initializeChain(runtimeConfig, (connection) => {
  if (localUiTest) connection = {
    connected: true,
    address: '0xc0dec0dec0dec0dec0dec0dec0dec0dec0dec0dec0dec0dec0dec0dec0de',
    provider: 'Local UI test',
    status: 'connected',
  };
  const previousWalletAddress = state.walletAddress;
  const walletChanged = previousWalletAddress !== connection.address;
  if (walletChanged) {
    resetOcUploadState();
    state.ownedCharacters = [];
    state.ownedCharactersLoadedFor = '';
    state.ownedCharactersError = '';
    templates.filter((template) => template.source === 'chain').forEach((template) => { template.owned = false; });
    const currentTemplate = activeTemplate();
    if (currentTemplate?.source === 'local' && currentTemplate.owner && currentTemplate.owner !== connection.address) {
      activateMakerModel(templates.find((template) => template.source === 'starter')?.id || templates[0].id);
      syncTemplateFields();
    }
  }
  state.walletConnected = connection.connected;
  state.walletAddress = connection.address;
  state.walletProvider = connection.provider;
  state.walletStatus = connection.status;
  if (!connection.connected || walletChanged) state.creatorProfileObjectId = '';
  if (connection.connected) {
    loadLocalMakerIndex(connection.address);
    restoreMakerDraft(state.templateId);
    loadChainMakers(connection.address);
    loadOwnedCharacters();
    if (state.pendingWalletTemplateId) {
      activateMakerModel(state.pendingWalletTemplateId);
      syncTemplateFields();
    }
    if (state.pendingWalletPage) setPage(state.pendingWalletPage);
    state.pendingWalletPage = '';
    state.pendingWalletTemplateId = '';
  } else if (!['templates', 'template', 'docs'].includes(state.page)) {
    setPage('templates');
  }
  renderAll();
});

syncTemplateFields();
renderAll();
setPage(initialPage);
loadBundledMakers();
loadChainMakers();
