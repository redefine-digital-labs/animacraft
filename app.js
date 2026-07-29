import {
  configureMakerEconomics,
  explorerObjectUrl,
  explorerTransactionUrl,
  certifyWalrusUpload,
  findPublishedMakerByIntent,
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
  setWalletModalLocale,
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
import {
  canonicalOcPackageFingerprint,
  certifiedLivingContentSource,
  createPlayerCompletionSnapshot,
} from './oc-handoff.js';
import { responseBlobWithinLimit, responseBytesWithinLimit } from './remote-read.js';
import {
  assertSupportedMakerMintEconomics,
  assertSupportedMakerPaymentCoin,
  normalizeRuntimeConfig,
} from './runtime-config.js';
import { createMakerWorkspace } from './maker-workspace.js';
import { findMakerVersionDraftConflict } from './maker-version-lineage.js';
import { initializeMakerDraftStorage } from './maker-storage-initializer.js';
import {
  legacyRecoveryExportPayload,
  normalizeRecoveredMakerRecipe,
  prepareRecoveredMakerAssets,
  scanLegacyMakerDrafts,
} from './maker-legacy-recovery.js';
import { inspectPngAsset } from './maker-assets.js';
import {
  createCharacterMakerV4Starter,
  createMakerV4Document,
  isMakerV4Document,
  validateMakerV4Document,
} from './maker-v4.js';
import { evaluateRecipe } from './maker-rules.js';
import {
  assertMakerV4ProjectionV2SinglePublishBudget,
  buildMakerV4MoveSummaryV2,
  buildMakerV4OcPackage,
  buildMakerV4OcUploadEntries,
  buildMakerV4PublicationBundle,
  buildMakerV4PublicationManifest,
  compileMakerV4MoveProjectionV2,
  indexMakerV4UploadResults,
  MAKER_V4_PROJECTION_V2_AUXILIARY_IDENTIFIER,
  prepareMakerV4ProjectionV2Document,
} from './maker-publication-v4.js';
import { classifyChainUiError } from './chain-error-ui.js';

let makerStorageInitializationError = null;
try {
  await initializeMakerDraftStorage();
} catch (error) {
  makerStorageInitializationError = error;
  console.error('Maker draft storage initialization will retry on the next page load.', error);
}

const slots = [
  { key: 'background', label: 'Background', icon: 'BG', colorKey: 'background', description: 'Scene, mood, and backdrop' },
  { key: 'base', label: 'Skin & Base', icon: 'BA', colorKey: 'skin', description: 'The shared body and face foundation that every wearable aligns to' },
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
  base: [
    { id: 'porcelain', label: 'Porcelain' },
    { id: 'warm', label: 'Warm' },
    { id: 'deep', label: 'Deep' },
    { id: 'fantasy', label: 'Fantasy' },
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
    manifestUrl: '/makers/astral-courier/animacraft-maker-v5.json',
    name: 'Astral Courier · 星夜信使',
    category: 'daily',
    creator: 'Animacraft Atelier',
    style: 'Japanese cel-shaded celestial portrait',
    license: 'Personal use',
    royaltyBps: 300,
    price: 'Free creator pack',
    accent: '#6f63ff',
    secondary: '#43d7e8',
    summary: 'An AI-assisted complex editor stress fixture. Combination alignment is intentionally under review and it is not a visual gold standard.',
    licenseNote: 'Internal editor stress fixture. Soul minting stays disabled until a human artist realigns and signs off every required combination.',
    coverUrl: '/makers/astral-courier/cover.png',
    mintingEnabled: false,
  },
  {
    id: 'hanamori-spirit',
    source: 'creator-pack',
    manifestUrl: '/makers/hanamori-spirit/animacraft-maker-v5.json',
    name: 'Hanamori Spirit · 花守灵契',
    category: 'fantasy',
    creator: 'Animacraft Atelier',
    style: 'Japanese cel-shaded spirit-garden portrait',
    license: 'Personal use',
    royaltyBps: 300,
    price: 'Free creator pack',
    accent: '#d94f45',
    secondary: '#4caa83',
    summary: 'A more stable AI-assisted editor stress fixture that still requires human cleanup and combination review before release.',
    licenseNote: 'Internal editor stress fixture. Soul minting stays disabled until a human artist completes cleanup, combination review, and final rights sign-off.',
    coverUrl: '/makers/hanamori-spirit/cover.png',
    mintingEnabled: false,
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
const visualThemeRuntime = window.ANIMACRAFT_THEME;
const visualThemeIds = visualThemeRuntime?.THEME_IDS || ['auto', 'animacraft', 'soulidity'];
const storedVisualThemePreference = visualThemeRuntime?.readPreference?.();
let visualThemePreference = visualThemeIds.includes(storedVisualThemePreference)
  ? storedVisualThemePreference
  : 'auto';
const localUiTest = ['127.0.0.1', 'localhost'].includes(location.hostname)
  && new URLSearchParams(location.search).get('ui-test') === '1';

const chainActions = [
  {
    key: 'wallet',
    titleKey: 'chainActionWalletTitle',
    bodyKey: 'chainActionWalletCopy',
  },
  {
    key: 'walrus',
    titleKey: 'chainActionWalrusTitle',
    bodyKey: 'chainActionWalrusCopy',
  },
  {
    key: 'maker',
    titleKey: 'chainActionMakerTitle',
    bodyKey: 'chainActionMakerCopy',
  },
  {
    key: 'oc',
    titleKey: 'chainActionSoulTitle',
    bodyKey: 'chainActionSoulCopy',
  },
];

const i18n = {
  en: {
    brandTagline: 'The Fully Onchain Character Maker & Creator',
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
    noPublishedMakers: 'No Makers have been published yet',
    noPublishedMakersCopy: 'Animacraft only lists Makers discovered from Sui and restored from certified Walrus assets. Be the first creator to publish one.',
    createFirstMaker: 'Create the first Maker',
    myOcs: 'My Souls',
    myOcsCopy: 'Soulidity-owned characters',
    soulidityMySouls: 'My Souls',
    socialProfile: 'Social profile',
    community: 'Community',
    marketplace: 'Market',
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
    brandTagline: 'The Fully Onchain Character Maker & Creator',
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
    partsLabel: '部位',
    itemsLabel: '部件',
    royaltyPolicy: '版税政策',
    startMaking: '开始捏 OC',
    connectToMake: '连接钱包后开始',
    viewMaker: '查看模板',
    noMatchingMakers: '没有找到匹配的模板。',
    noPublishedMakers: '还没有 Maker 发布到链上',
    noPublishedMakersCopy: 'Animacraft 只展示从 Sui 发现并由 Walrus 认证素材恢复的 Maker。成为第一位发布者。',
    createFirstMaker: '创建第一个 Maker',
    myOcs: '我的 OC',
    myOcsCopy: '钱包拥有的角色',
    soulidityMySouls: '我的 Soul',
    socialProfile: '社交主页',
    community: '社区',
    marketplace: '市场',
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
    currentSlot: '当前部位',
    choosePart: '选择部位',
    livePreview: '实时预览',
    templateLicense: '模板授权',
    currentColor: '当前颜色',
  },
  ja: {
    brandTagline: 'The Fully Onchain Character Maker & Creator',
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
    noPublishedMakers: 'まだ Maker は公開されていません',
    noPublishedMakersCopy: 'Animacraft は Sui で検出され、認証済み Walrus 素材から復元された Maker のみを表示します。最初のクリエイターになりましょう。',
    createFirstMaker: '最初の Maker を作成',
    myOcs: 'マイ OC',
    myOcsCopy: 'ウォレット所有キャラクター',
    soulidityMySouls: 'マイ Soul',
    socialProfile: 'ソーシャルプロフィール',
    community: 'コミュニティ',
    marketplace: 'マーケット',
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
    brandTagline: 'The Fully Onchain Character Maker & Creator',
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
    noPublishedMakers: '아직 온체인에 공개된 Maker가 없습니다',
    noPublishedMakersCopy: 'Animacraft는 Sui에서 발견되고 인증된 Walrus 에셋으로 복원된 Maker만 표시합니다. 첫 번째 크리에이터가 되어 보세요.',
    createFirstMaker: '첫 Maker 만들기',
    myOcs: '내 OC',
    myOcsCopy: '지갑 소유 캐릭터',
    soulidityMySouls: '내 Soul',
    socialProfile: '소셜 프로필',
    community: '커뮤니티',
    marketplace: '마켓',
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
    brandTagline: 'The Fully Onchain Character Maker & Creator',
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
    filterFantasy: 'Kỳ ảo',
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
    noPublishedMakers: 'Chưa có Maker nào được phát hành on-chain',
    noPublishedMakersCopy: 'Animacraft chỉ hiển thị Maker được phát hiện từ Sui và khôi phục bằng tài sản Walrus đã chứng nhận. Hãy trở thành nhà sáng tạo đầu tiên.',
    createFirstMaker: 'Tạo Maker đầu tiên',
    myOcs: 'OC của tôi',
    myOcsCopy: 'Nhân vật thuộc sở hữu ví',
    soulidityMySouls: 'Soul của tôi',
    socialProfile: 'Hồ sơ xã hội',
    community: 'Cộng đồng',
    marketplace: 'Chợ giao dịch',
    creatorStudio: 'Xưởng sáng tạo',
    creatorStudioCopy: 'Tạo, thử nghiệm và xuất bản Character Maker trong một không gian thuộc ví.',
    newOcMaker: 'OC Maker mới',
    makerLibrary: 'Thư viện OC Maker',
    walletOwnedMakers: 'Maker thuộc sở hữu ví',
    preview: 'Xem trước',
    saveDraft: 'Lưu bản nháp',
    exportManifest: 'Bản kê khai',
    release: 'Xuất bản',
    makerTop: 'Tổng quan Maker',
    characterMaker: 'Trình tạo nhân vật',
    rules: 'Quy tắc',
    paletteRules: 'Quy tắc bảng màu',
    previewCheck: 'Kiểm tra xuất bản',
    onchainPublish: 'Xuất bản on-chain',
    settings: 'Cài đặt',
    recipeJson: 'JSON công thức',
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

const editorShellI18n = {
  en: {
    creatorWorkshop: 'Creator Workshop', library: 'Library', backLibraryShort: '← Library', backLibrary: 'Back to OC Maker Library', localDraft: 'Local draft', livingContent: 'Living Content', freeCombine: 'Free combine', starterWorkspace: 'Starter workspace', starterExample: 'Starter example', publishedOnSui: 'Published on Sui', published: 'Published', archived: 'Archived', savedLocally: 'Saved locally', savingLocally: 'Saving…', saveFailedStatus: 'Save failed', retryLocalSave: 'Retry local save', saveBrowserTitle: 'Save Maker metadata and PNG files in this browser.', packagePending: 'Package pending', characterStructure: 'Character structure', selectionLogic: 'Selection logic', qualityCheck: 'Quality check', publication: 'Publication', noItemImagesYet: 'No item images yet', itemImagesReady: '{count} item image(s) ready', compatibilityFallback: 'Compatibility and fallback behavior', playerFlowAssets: 'Player flow and required assets', walrusAndSui: 'Walrus storage and Sui object', notReady: 'Not ready', manage: 'Manage', edit: 'Edit', deleteDraft: 'Delete draft', noOwnedMakers: 'No wallet-owned Makers yet. Create an OC Maker to begin your first local draft.', versionDraft: 'Version draft', partsCount: '{count} Part(s)', rulesCount: '{count} Rule(s)', addFirstPart: 'Add the first Part', readyPreview: 'Ready to preview', incompleteItems: '{count} incomplete Item(s)',
  },
  zh: {
    creatorWorkshop: '创作者工作区', library: '模板库', backLibraryShort: '← 模板库', backLibrary: '返回 OC 模板库', localDraft: '本地草稿', livingContent: '生命内容', freeCombine: '自由组合', starterWorkspace: '初始工作区', starterExample: '示例模板', publishedOnSui: '已发布到 Sui', published: '已发布', archived: '已归档', savedLocally: '已保存到本地', savingLocally: '保存中…', saveFailedStatus: '保存失败', retryLocalSave: '重新保存到本地', saveBrowserTitle: '将 Maker 元数据和 PNG 文件保存到当前浏览器。', packagePending: '合约配置待完成', characterStructure: '角色结构', selectionLogic: '组合逻辑', qualityCheck: '质量检查', publication: '发布', noItemImagesYet: '还没有部件素材', itemImagesReady: '已有 {count} 张部件素材', compatibilityFallback: '兼容性与兜底行为', playerFlowAssets: '玩家流程与必需素材', walrusAndSui: 'Walrus 存储与 Sui 对象', notReady: '尚未就绪', manage: '管理', edit: '编辑', deleteDraft: '删除草稿', noOwnedMakers: '当前钱包还没有 Maker。创建一个 OC Maker，开始第一份本地草稿。', versionDraft: '新版本草稿', partsCount: '{count} 个部位', rulesCount: '{count} 条规则', addFirstPart: '添加第一个部位', readyPreview: '可以预览', incompleteItems: '{count} 个部件未完成',
  },
  ja: {
    creatorWorkshop: 'クリエイターワークショップ', library: 'ライブラリ', backLibraryShort: '← ライブラリ', backLibrary: 'OC Maker ライブラリへ戻る', localDraft: 'ローカル下書き', livingContent: 'リビングコンテンツ', freeCombine: '自由組み合わせ', starterWorkspace: '初期ワークスペース', starterExample: 'スターター例', publishedOnSui: 'Sui に公開済み', published: '公開済み', archived: 'アーカイブ済み', savedLocally: 'ローカル保存済み', savingLocally: '保存中…', saveFailedStatus: '保存失敗', retryLocalSave: 'ローカル保存を再試行', saveBrowserTitle: 'Maker のメタデータと PNG をこのブラウザに保存します。', packagePending: 'パッケージ設定待ち', characterStructure: 'キャラクター構造', selectionLogic: '組み合わせロジック', qualityCheck: '品質チェック', publication: '公開', noItemImagesYet: 'アイテム素材がありません', itemImagesReady: 'アイテム素材 {count} 枚準備済み', compatibilityFallback: '互換性とフォールバック', playerFlowAssets: 'プレイヤーフローと必須素材', walrusAndSui: 'Walrus ストレージと Sui オブジェクト', notReady: '未準備', manage: '管理', edit: '編集', deleteDraft: '下書きを削除', noOwnedMakers: 'このウォレットには Maker がありません。OC Maker を作成して最初の下書きを始めてください。', versionDraft: 'バージョン下書き', partsCount: 'パーツ {count}', rulesCount: 'ルール {count}', addFirstPart: '最初のパーツを追加', readyPreview: 'プレビュー可能', incompleteItems: '未完成アイテム {count}',
  },
  ko: {
    creatorWorkshop: '크리에이터 작업실', library: '라이브러리', backLibraryShort: '← 라이브러리', backLibrary: 'OC Maker 라이브러리로 돌아가기', localDraft: '로컬 초안', livingContent: '리빙 콘텐츠', freeCombine: '자유 조합', starterWorkspace: '초기 작업 공간', starterExample: '스타터 예시', publishedOnSui: 'Sui 게시 완료', published: '게시됨', archived: '보관됨', savedLocally: '로컬 저장됨', savingLocally: '저장 중…', saveFailedStatus: '저장 실패', retryLocalSave: '로컬 저장 다시 시도', saveBrowserTitle: 'Maker 메타데이터와 PNG 파일을 이 브라우저에 저장합니다.', packagePending: '패키지 설정 대기', characterStructure: '캐릭터 구조', selectionLogic: '조합 로직', qualityCheck: '품질 검사', publication: '게시', noItemImagesYet: '아이템 이미지 없음', itemImagesReady: '아이템 이미지 {count}개 준비됨', compatibilityFallback: '호환성과 대체 동작', playerFlowAssets: '플레이어 흐름과 필수 에셋', walrusAndSui: 'Walrus 저장소와 Sui 오브젝트', notReady: '준비되지 않음', manage: '관리', edit: '편집', deleteDraft: '초안 삭제', noOwnedMakers: '이 지갑에 Maker가 없습니다. OC Maker를 만들어 첫 로컬 초안을 시작하세요.', versionDraft: '버전 초안', partsCount: '파트 {count}개', rulesCount: '규칙 {count}개', addFirstPart: '첫 파트 추가', readyPreview: '미리보기 가능', incompleteItems: '미완성 아이템 {count}개',
  },
  vi: {
    creatorWorkshop: 'Xưởng sáng tạo', library: 'Thư viện', backLibraryShort: '← Thư viện', backLibrary: 'Quay lại thư viện OC Maker', localDraft: 'Bản nháp cục bộ', livingContent: 'Nội dung sống', freeCombine: 'Kết hợp tự do', starterWorkspace: 'Không gian khởi đầu', starterExample: 'Ví dụ khởi đầu', publishedOnSui: 'Đã đăng lên Sui', published: 'Đã đăng', archived: 'Đã lưu trữ', savedLocally: 'Đã lưu cục bộ', savingLocally: 'Đang lưu…', saveFailedStatus: 'Lưu thất bại', retryLocalSave: 'Thử lưu cục bộ lại', saveBrowserTitle: 'Lưu dữ liệu Maker và tệp PNG trong trình duyệt này.', packagePending: 'Chờ cấu hình gói', characterStructure: 'Cấu trúc nhân vật', selectionLogic: 'Logic kết hợp', qualityCheck: 'Kiểm tra chất lượng', publication: 'Xuất bản', noItemImagesYet: 'Chưa có hình Vật phẩm', itemImagesReady: 'Đã sẵn sàng {count} hình Vật phẩm', compatibilityFallback: 'Tương thích và hành vi dự phòng', playerFlowAssets: 'Luồng người chơi và tài nguyên bắt buộc', walrusAndSui: 'Lưu trữ Walrus và đối tượng Sui', notReady: 'Chưa sẵn sàng', manage: 'Quản lý', edit: 'Chỉnh sửa', deleteDraft: 'Xóa bản nháp', noOwnedMakers: 'Ví này chưa có Maker. Hãy tạo OC Maker để bắt đầu bản nháp đầu tiên.', versionDraft: 'Bản nháp phiên bản', partsCount: '{count} Bộ phận', rulesCount: '{count} quy tắc', addFirstPart: 'Thêm Bộ phận đầu tiên', readyPreview: 'Sẵn sàng xem trước', incompleteItems: '{count} Vật phẩm chưa hoàn tất',
  },
};

Object.entries(editorShellI18n).forEach(([locale, details]) => Object.assign(i18n[locale], details));

const editorDetailI18n = {
  en: {
    makerDescriptionDefault: 'Build the template from layered assets, then bind the Maker to license rules and on-chain provenance.', editMakerInfo: 'Edit Maker info', soulWorkspace: 'Soul workspace', livingContentCopy: 'Every OC includes Soulidity-ready defaults. Edit them only when this Maker needs a specific personality, memory, or skill.', defaultsReady: 'Defaults ready', downloadTemplate: 'Download template', defaultStatus: 'Default', soulCharacter: 'Soul Character', memory: 'Memory', skillsDocs: 'Skills & Docs', restoreDefault: 'Restore default', soulidityImport: 'Soulidity import', mintReadyStructure: 'Mint-ready structure', livingImportCopy: 'These files remain editable defaults inside the Maker. The final OC resolves its name, world, and description before Soulidity import.',
    onchainAssets: 'On-chain Assets', assetRegistry: 'Asset registry', walrusQuilt: 'Walrus quilt', walrusQuiltAssets: 'Layer PNGs, optional picker icons, cover, and the versioned Maker manifest', suiObjects: 'Sui objects', suiObjectsCopy: 'CreatorProfile, OCMaker, MakerTreasury, MakerAdminCap, recipe rules, policy snapshots, and ownership', revenueRoyalty: 'Revenue & royalty', revenueRoyaltyCopy: 'The Maker Treasury path is ready; paid mint and 0%-5% resale settlement activate with the reviewed Soulidity adapter.', publishThisMaker: 'Publish this Maker', publishPrereq: 'Resolve every Preflight issue, connect a wallet, and configure the Move package.', resumeSavedUpload: 'Resume saved upload', prepareStep: '1. Prepare', registerUploadStep: '2. Register & upload', retryUploadStep: '2. Retry upload', certifyStep: '3. Certify', publishMakerStep: '4. Publish Maker', publishingStatus: 'Publishing…', publishedMaker: 'Published Maker', publishedRecordCopy: 'Published records remain on Sui and certified Walrus assets remain available for their storage term.', archiveMaker: 'Archive Maker', restoreMaker: 'Restore Maker', publishSteps: 'Publish Steps', chainExecution: 'Chain execution', publicationRecord: 'Publication Record', immutableRecord: 'What becomes immutable', provenance: 'Provenance', provenanceCopy: 'Creator wallet, Maker object, package version, and publication transaction.', assetVersion: 'Asset version', assetVersionCopy: 'The certified Walrus manifest and every referenced layer image.', rulesRecord: 'Rules', rulesRecordCopy: 'Part, Item, Color, order, selection, palette, and BCS recipe-hash integrity enforced when a Soul is minted.',
    lifecycle: 'Lifecycle', draftLifecycleCopy: 'Draft content is stored locally and can still be edited or permanently deleted.', starterLifecycleCopy: 'This example is editable in the current browser. Save it as a new local Maker before production use.', publishedLifecycleCopy: 'The published Maker, rules, license, and certified Walrus manifest are immutable. Archive it to stop new Soul authorizations.', archivedLifecycleCopy: 'The historical record and existing Souls remain valid, but this Maker no longer accepts new Soul authorizations.', versionLifecycleCopy: 'Editing {current}. The previous Maker and existing OCs remain pinned to {previous}.', archivedMaker: 'Archived Maker', makerSettings: 'Maker Settings', ocMakerSettings: 'OC Maker settings', makerName: 'Maker name', makerDescription: 'Maker description', creatorLabel: 'Creator', styleWorld: 'Style / world', licenseType: 'License type', licenseNote: 'License note', mintingRevenue: 'Minting & revenue', allowSoulAuthorizations: 'Allow new Soul authorizations', chargeMintFee: 'Charge a mint fee after canonical activation', mintPriceUsdc: 'Mint price (USDC)', resaleRoyalty: 'Future Soulidity resale royalty', noRoyalty: 'No royalty', pilotEconomicsCopy: 'During the Maker-only pilot, paid mint stays off. After canonical activation, revenue settles into this Maker Treasury and only its MakerAdminCap holder can withdraw it.', treasuryAfterPublication: 'Treasury balance appears after publication.', treasuryBalance: 'Treasury balance: {amount} {symbol}', updateOnchainSettings: 'Update on-chain settings', withdrawRevenue: 'Withdraw revenue (USDC)', withdrawWallet: 'Withdraw to my wallet', publishingChecklist: 'Publishing checklist', rulesRevenue: 'Rules & Revenue', licenseRevenueRules: 'License and revenue rules', personalUseLabel: 'Personal use', personalUseCopy: 'Users can make icons, OC profiles, and non-commercial displays.', commercialPermission: 'Commercial permission', commercialPermissionCopy: 'Creators may publish a commercial-use policy copied into each finished OC.', royaltyPolicy: 'Royalty policy', royaltyPolicyCopy: 'The royalty tier is snapshotted at Soul mint and settled only by the reviewed Soulidity path.', onchainPolicy: 'On-chain Policy', releaseEnforces: 'What this release enforces', permissionScope: 'Permission scope', permissionScopeCopy: 'License kind records personal, remix, commercial, or exclusive permission.', attribution: 'Attribution', attributionCopy: 'Published Makers carry creator attribution into every Soul mint authorization.', recipeIntegrity: 'Recipe integrity', recipeIntegrityCopy: 'Required Parts, available Items, and combination rules are verified before authorization.', paidMintDisabled: 'Paid mint stays off until the canonical Soulidity adapter is deployed and verified.', restoringUpload: 'Restoring the saved Walrus upload checkpoint…',
    publishPackageFirst: 'Publish the Move package and set packageId in config.js.', connectPublishWallet: 'Connect a Sui wallet to sign publication.', addMakerName: 'Add a Maker name in Settings.', publishReadinessCopy: 'Prepare one Walrus quilt, register and upload it, certify it, then publish the Maker on Sui Mainnet.', publishedNetwork: 'Published on {network}.', viewTransaction: 'View transaction', encodingQuilt: 'Encoding PNG layers and manifest into one Walrus quilt…', quiltEncoded: 'Quilt encoded. Register it on Walrus Mainnet with your wallet.', prepareQuiltFailed: 'Could not prepare the Maker quilt.', registeringQuilt: 'Waiting for the Walrus registration signature, then uploading through Mainnet relay…', recoveredCertified: 'The recovered quilt was already certified. Continue with Sui Maker publication.', quiltUploaded: 'Quilt uploaded. Certify availability with one more wallet signature.', registrationFailed: 'Walrus registration or upload failed.', certifyingQuilt: 'Waiting for the Walrus certification signature…', quiltCertified: 'Walrus quilt certified. Publish the indexed OCMaker object on Sui Mainnet.', certificationFailed: 'Walrus certification failed.', waitingSuiPublish: 'Waiting for your Sui Mainnet publication signature…', makerChangedAfterUpload: 'The Maker changed after upload. Prepare a new quilt before publishing.',
  },
  zh: {
    makerDescriptionDefault: '用分层素材搭建模板，再绑定授权规则和链上来源。', editMakerInfo: '编辑 Maker 信息', soulWorkspace: 'Soul 工作区', livingContentCopy: '每个 OC 都包含 Soulidity 可用的默认内容。仅在此 Maker 需要特定性格、记忆或技能时修改。', defaultsReady: '默认内容已就绪', downloadTemplate: '下载模板', defaultStatus: '默认', soulCharacter: 'Soul 角色', memory: '记忆', skillsDocs: '技能与文档', restoreDefault: '恢复默认', soulidityImport: 'Soulidity 导入', mintReadyStructure: '可铸造结构', livingImportCopy: '这些文件作为可编辑默认内容保存在 Maker 中。最终 OC 会在导入 Soulidity 前写入名称、世界和说明。',
    onchainAssets: '链上资产', assetRegistry: '资产登记', walrusQuilt: 'Walrus Quilt', walrusQuiltAssets: '图层 PNG、可选选择器图标、封面和版本化 Maker Manifest', suiObjects: 'Sui 对象', suiObjectsCopy: 'CreatorProfile、OCMaker、MakerTreasury、MakerAdminCap、配方规则、政策快照和所有权', revenueRoyalty: '收入与版税', revenueRoyaltyCopy: 'Maker Treasury 路径已就绪；付费铸造和 0%-5% 二级版税将在 Soulidity 适配器审计启用后生效。', publishThisMaker: '发布此 Maker', publishPrereq: '解决全部发布检查问题，连接钱包并配置 Move 包。', resumeSavedUpload: '恢复保存的上传', prepareStep: '1. 准备', registerUploadStep: '2. 注册并上传', retryUploadStep: '2. 重试上传', certifyStep: '3. 认证', publishMakerStep: '4. 发布 Maker', publishingStatus: '发布中…', publishedMaker: '已发布 Maker', publishedRecordCopy: '发布记录保留在 Sui；认证的 Walrus 素材在存储期内保持可用。', archiveMaker: '归档 Maker', restoreMaker: '恢复 Maker', publishSteps: '发布步骤', chainExecution: '链上执行', publicationRecord: '发布记录', immutableRecord: '发布后不可变内容', provenance: '来源', provenanceCopy: '创作者钱包、Maker 对象、包版本和发布交易。', assetVersion: '素材版本', assetVersionCopy: '已认证的 Walrus Manifest 及其引用的所有图层图片。', rulesRecord: '规则', rulesRecordCopy: 'Part、Item、颜色、顺序、组合、色板和 BCS 配方哈希在 Soul 铸造时强制验证。',
    lifecycle: '生命周期', draftLifecycleCopy: '草稿保存在本地，仍可编辑或永久删除。', starterLifecycleCopy: '此示例可在当前浏览器编辑；用于生产前请保存为新的本地 Maker。', publishedLifecycleCopy: '已发布 Maker、规则、授权和认证 Walrus Manifest 不可变。归档可停止新的 Soul 授权。', archivedLifecycleCopy: '历史记录和现有 Soul 仍然有效，但此 Maker 不再接受新的 Soul 授权。', versionLifecycleCopy: '正在编辑 {current}。上一版本 Maker 和现有 OC 继续固定在 {previous}。', archivedMaker: '已归档 Maker', makerSettings: 'Maker 设置', ocMakerSettings: 'OC Maker 设置', makerName: 'Maker 名称', makerDescription: 'Maker 说明', creatorLabel: '创作者', styleWorld: '风格 / 世界', licenseType: '授权类型', licenseNote: '授权说明', mintingRevenue: '铸造与收入', allowSoulAuthorizations: '允许新的 Soul 授权', chargeMintFee: '正式链路启用后收取铸造费', mintPriceUsdc: '铸造价格（USDC）', resaleRoyalty: '未来 Soulidity 二级版税', noRoyalty: '不收版税', pilotEconomicsCopy: 'Maker 试运行阶段保持付费铸造关闭。正式链路启用后，收入进入此 Maker Treasury，只有 MakerAdminCap 持有者可提取。', treasuryAfterPublication: '发布后显示 Treasury 余额。', treasuryBalance: 'Treasury 余额：{amount} {symbol}', updateOnchainSettings: '更新链上设置', withdrawRevenue: '提取收入（USDC）', withdrawWallet: '提取到我的钱包', publishingChecklist: '发布清单', rulesRevenue: '规则与收入', licenseRevenueRules: '授权与收入规则', personalUseLabel: '个人使用', personalUseCopy: '用户可制作头像、OC 档案和非商业展示。', commercialPermission: '商业许可', commercialPermissionCopy: '创作者可发布商业使用政策，并写入每个成品 OC。', royaltyPolicy: '版税政策', royaltyPolicyCopy: '版税档位在 Soul 铸造时形成快照，仅由审计后的 Soulidity 路径结算。', onchainPolicy: '链上政策', releaseEnforces: '本版本强制执行', permissionScope: '许可范围', permissionScopeCopy: '授权类型记录个人、再创作、商业或独家许可。', attribution: '署名', attributionCopy: '已发布 Maker 会把创作者署名写入每次 Soul 铸造授权。', recipeIntegrity: '配方完整性', recipeIntegrityCopy: '必选 Part、可用 Item 和组合规则在授权前验证。', paidMintDisabled: '在 Soulidity 正式适配器完成部署和验证前，付费铸造保持关闭。', restoringUpload: '正在恢复保存的 Walrus 上传检查点…',
    publishPackageFirst: '请先发布 Move 包，并在 config.js 中设置 packageId。', connectPublishWallet: '连接 Sui 钱包以签名发布。', addMakerName: '请在设置中填写 Maker 名称。', publishReadinessCopy: '准备一个 Walrus Quilt，注册并上传、认证后，再把 Maker 发布到 Sui 主网。', publishedNetwork: '已发布到 {network}。', viewTransaction: '查看交易', encodingQuilt: '正在把 PNG 图层和 Manifest 编码为一个 Walrus Quilt…', quiltEncoded: 'Quilt 已编码。请用钱包在 Walrus 主网注册。', prepareQuiltFailed: '无法准备 Maker Quilt。', registeringQuilt: '等待 Walrus 注册签名，随后通过主网中继上传…', recoveredCertified: '恢复的 Quilt 已认证，可继续发布 Sui Maker。', quiltUploaded: 'Quilt 已上传。请再签名一次认证可用性。', registrationFailed: 'Walrus 注册或上传失败。', certifyingQuilt: '等待 Walrus 认证签名…', quiltCertified: 'Walrus Quilt 已认证。请在 Sui 主网发布索引 OCMaker 对象。', certificationFailed: 'Walrus 认证失败。', waitingSuiPublish: '等待你的 Sui 主网发布签名…', makerChangedAfterUpload: 'Maker 在上传后发生变化，请重新准备 Quilt 后发布。',
  },
  ja: {
    makerDescriptionDefault: 'レイヤー素材でテンプレートを作り、ライセンス規則とオンチェーン来歴を結び付けます。', editMakerInfo: 'Maker 情報を編集', soulWorkspace: 'Soul ワークスペース', livingContentCopy: '各 OC には Soulidity 対応の初期内容があります。この Maker 固有の性格、記憶、スキルが必要な場合だけ編集します。', defaultsReady: '初期内容準備済み', downloadTemplate: 'テンプレートをダウンロード', defaultStatus: '初期値', soulCharacter: 'Soul キャラクター', memory: 'メモリー', skillsDocs: 'スキルと文書', restoreDefault: '初期値に戻す', soulidityImport: 'Soulidity 取り込み', mintReadyStructure: 'Mint 対応構造', livingImportCopy: 'これらは Maker 内の編集可能な初期値です。最終 OC は Soulidity 取り込み前に名前、世界、説明を反映します。',
    onchainAssets: 'オンチェーン資産', assetRegistry: '資産登録', walrusQuilt: 'Walrus Quilt', walrusQuiltAssets: 'レイヤー PNG、任意アイコン、カバー、バージョン付き Maker Manifest', suiObjects: 'Sui オブジェクト', suiObjectsCopy: 'CreatorProfile、OCMaker、MakerTreasury、MakerAdminCap、レシピ規則、方針スナップショット、所有権', revenueRoyalty: '収益とロイヤリティ', revenueRoyaltyCopy: 'Maker Treasury 経路は準備済みです。課金 Mint と 0%-5% の二次ロイヤリティはレビュー済み Soulidity アダプターで有効になります。', publishThisMaker: 'この Maker を公開', publishPrereq: '公開チェックを解決し、ウォレット接続と Move パッケージ設定を完了してください。', resumeSavedUpload: '保存済みアップロードを再開', prepareStep: '1. 準備', registerUploadStep: '2. 登録とアップロード', retryUploadStep: '2. 再アップロード', certifyStep: '3. 認証', publishMakerStep: '4. Maker を公開', publishingStatus: '公開中…', publishedMaker: '公開済み Maker', publishedRecordCopy: '公開記録は Sui に残り、認証済み Walrus 素材は保存期間中利用できます。', archiveMaker: 'Maker をアーカイブ', restoreMaker: 'Maker を復元', publishSteps: '公開手順', chainExecution: 'チェーン実行', publicationRecord: '公開記録', immutableRecord: '変更不能になる内容', provenance: '来歴', provenanceCopy: '制作者ウォレット、Maker オブジェクト、パッケージ版、公開取引。', assetVersion: '素材バージョン', assetVersionCopy: '認証済み Walrus Manifest と参照される全レイヤー画像。', rulesRecord: 'ルール', rulesRecordCopy: 'Part、Item、色、順序、選択、パレット、BCS レシピハッシュを Soul Mint 時に検証します。',
    lifecycle: 'ライフサイクル', draftLifecycleCopy: '下書きはローカル保存され、編集または完全削除できます。', starterLifecycleCopy: 'この例は現在のブラウザで編集できます。本番利用前に新しいローカル Maker として保存してください。', publishedLifecycleCopy: '公開済み Maker、ルール、ライセンス、認証済み Walrus Manifest は不変です。アーカイブすると新しい Soul 認可を停止できます。', archivedLifecycleCopy: '履歴と既存 Soul は有効ですが、この Maker は新しい Soul 認可を受け付けません。', versionLifecycleCopy: '{current} を編集中です。以前の Maker と既存 OC は {previous} に固定されます。', archivedMaker: 'アーカイブ済み Maker', makerSettings: 'Maker 設定', ocMakerSettings: 'OC Maker 設定', makerName: 'Maker 名', makerDescription: 'Maker 説明', creatorLabel: '制作者', styleWorld: 'スタイル / 世界', licenseType: 'ライセンス種別', licenseNote: 'ライセンス説明', mintingRevenue: 'Mint と収益', allowSoulAuthorizations: '新しい Soul 認可を許可', chargeMintFee: '正式有効化後に Mint 料金を徴収', mintPriceUsdc: 'Mint 価格（USDC）', resaleRoyalty: '将来の Soulidity 二次ロイヤリティ', noRoyalty: 'ロイヤリティなし', pilotEconomicsCopy: 'Maker 試行中は課金 Mint を無効にします。正式有効化後、収益は Maker Treasury に入り、MakerAdminCap 保有者だけが引き出せます。', treasuryAfterPublication: '公開後に Treasury 残高を表示します。', treasuryBalance: 'Treasury 残高：{amount} {symbol}', updateOnchainSettings: 'オンチェーン設定を更新', withdrawRevenue: '収益を引き出す（USDC）', withdrawWallet: '自分のウォレットへ引き出す', publishingChecklist: '公開チェックリスト', rulesRevenue: 'ルールと収益', licenseRevenueRules: 'ライセンスと収益規則', personalUseLabel: '個人利用', personalUseCopy: 'アイコン、OC プロフィール、非商用表示に利用できます。', commercialPermission: '商用許可', commercialPermissionCopy: '制作者は完成 OC に記録される商用方針を公開できます。', royaltyPolicy: 'ロイヤリティ方針', royaltyPolicyCopy: 'ロイヤリティ段階は Soul Mint 時に固定され、レビュー済み Soulidity 経路だけで決済します。', onchainPolicy: 'オンチェーン方針', releaseEnforces: 'この版で強制される内容', permissionScope: '許可範囲', permissionScopeCopy: '個人、リミックス、商用、独占の許可種別を記録します。', attribution: '帰属表示', attributionCopy: '公開 Maker の制作者情報は Soul Mint 認可に引き継がれます。', recipeIntegrity: 'レシピ整合性', recipeIntegrityCopy: '必須 Part、利用可能 Item、組み合わせ規則を認可前に検証します。', paidMintDisabled: 'Soulidity アダプターの配備と検証が完了するまで課金 Mint は無効です。', restoringUpload: '保存済み Walrus アップロードを復元中…',
    publishPackageFirst: 'Move パッケージを公開し、config.js に packageId を設定してください。', connectPublishWallet: '公開署名用の Sui ウォレットを接続してください。', addMakerName: '設定で Maker 名を入力してください。', publishReadinessCopy: 'Walrus Quilt を準備、登録、アップロード、認証してから Sui Mainnet に公開します。', publishedNetwork: '{network} に公開済み。', viewTransaction: '取引を表示', encodingQuilt: 'PNG レイヤーと Manifest を Walrus Quilt に変換中…', quiltEncoded: 'Quilt の変換完了。ウォレットで Walrus Mainnet に登録してください。', prepareQuiltFailed: 'Maker Quilt を準備できませんでした。', registeringQuilt: 'Walrus 登録署名を待ち、Mainnet リレーへアップロードします…', recoveredCertified: '復元した Quilt は認証済みです。Sui Maker 公開へ進めます。', quiltUploaded: 'Quilt をアップロードしました。もう一度署名して可用性を認証してください。', registrationFailed: 'Walrus の登録またはアップロードに失敗しました。', certifyingQuilt: 'Walrus 認証署名を待っています…', quiltCertified: 'Walrus Quilt を認証しました。Sui Mainnet に OCMaker を公開してください。', certificationFailed: 'Walrus 認証に失敗しました。', waitingSuiPublish: 'Sui Mainnet 公開署名を待っています…', makerChangedAfterUpload: 'アップロード後に Maker が変更されました。新しい Quilt を準備してください。',
  },
  ko: {
    makerDescriptionDefault: '레이어 에셋으로 템플릿을 만든 뒤 라이선스 규칙과 온체인 출처를 연결합니다.', editMakerInfo: 'Maker 정보 편집', soulWorkspace: 'Soul 작업 공간', livingContentCopy: '모든 OC에는 Soulidity용 기본 콘텐츠가 있습니다. 이 Maker만의 성격, 기억, 기술이 필요할 때만 편집하세요.', defaultsReady: '기본 콘텐츠 준비됨', downloadTemplate: '템플릿 다운로드', defaultStatus: '기본값', soulCharacter: 'Soul 캐릭터', memory: '메모리', skillsDocs: '스킬과 문서', restoreDefault: '기본값 복원', soulidityImport: 'Soulidity 가져오기', mintReadyStructure: 'Mint 준비 구조', livingImportCopy: '이 파일은 Maker 안의 편집 가능한 기본값입니다. 최종 OC는 Soulidity 가져오기 전에 이름, 세계, 설명을 반영합니다.',
    onchainAssets: '온체인 에셋', assetRegistry: '에셋 등록', walrusQuilt: 'Walrus Quilt', walrusQuiltAssets: '레이어 PNG, 선택 아이콘, 커버, 버전 Maker Manifest', suiObjects: 'Sui 오브젝트', suiObjectsCopy: 'CreatorProfile, OCMaker, MakerTreasury, MakerAdminCap, 레시피 규칙, 정책 스냅샷, 소유권', revenueRoyalty: '수익과 로열티', revenueRoyaltyCopy: 'Maker Treasury 경로는 준비되었습니다. 유료 Mint와 0%-5% 재판매 로열티는 검토된 Soulidity 어댑터로 활성화됩니다.', publishThisMaker: '이 Maker 게시', publishPrereq: '게시 검사 문제를 해결하고 지갑과 Move 패키지를 설정하세요.', resumeSavedUpload: '저장된 업로드 재개', prepareStep: '1. 준비', registerUploadStep: '2. 등록 및 업로드', retryUploadStep: '2. 업로드 재시도', certifyStep: '3. 인증', publishMakerStep: '4. Maker 게시', publishingStatus: '게시 중…', publishedMaker: '게시된 Maker', publishedRecordCopy: '게시 기록은 Sui에 남고 인증된 Walrus 에셋은 보관 기간 동안 유지됩니다.', archiveMaker: 'Maker 보관', restoreMaker: 'Maker 복원', publishSteps: '게시 단계', chainExecution: '체인 실행', publicationRecord: '게시 기록', immutableRecord: '변경 불가 항목', provenance: '출처', provenanceCopy: '제작자 지갑, Maker 오브젝트, 패키지 버전, 게시 트랜잭션.', assetVersion: '에셋 버전', assetVersionCopy: '인증된 Walrus Manifest와 참조된 모든 레이어 이미지.', rulesRecord: '규칙', rulesRecordCopy: 'Part, Item, 색상, 순서, 선택, 팔레트, BCS 레시피 해시를 Soul Mint 때 검증합니다.',
    lifecycle: '수명 주기', draftLifecycleCopy: '초안은 로컬에 저장되며 편집하거나 영구 삭제할 수 있습니다.', starterLifecycleCopy: '이 예시는 현재 브라우저에서 편집할 수 있습니다. 프로덕션 사용 전에 새 로컬 Maker로 저장하세요.', publishedLifecycleCopy: '게시된 Maker, 규칙, 라이선스, 인증된 Walrus Manifest는 변경할 수 없습니다. 보관하면 새 Soul 승인이 중지됩니다.', archivedLifecycleCopy: '기록과 기존 Soul은 유효하지만 새 Soul 승인은 받지 않습니다.', versionLifecycleCopy: '{current} 편집 중. 이전 Maker와 기존 OC는 {previous}에 고정됩니다.', archivedMaker: '보관된 Maker', makerSettings: 'Maker 설정', ocMakerSettings: 'OC Maker 설정', makerName: 'Maker 이름', makerDescription: 'Maker 설명', creatorLabel: '제작자', styleWorld: '스타일 / 세계', licenseType: '라이선스 유형', licenseNote: '라이선스 설명', mintingRevenue: 'Mint와 수익', allowSoulAuthorizations: '새 Soul 승인 허용', chargeMintFee: '정식 활성화 후 Mint 수수료 부과', mintPriceUsdc: 'Mint 가격(USDC)', resaleRoyalty: '향후 Soulidity 재판매 로열티', noRoyalty: '로열티 없음', pilotEconomicsCopy: 'Maker 시험 기간에는 유료 Mint를 끕니다. 정식 활성화 후 수익은 Maker Treasury에 들어가며 MakerAdminCap 보유자만 인출할 수 있습니다.', treasuryAfterPublication: '게시 후 Treasury 잔액이 표시됩니다.', treasuryBalance: 'Treasury 잔액: {amount} {symbol}', updateOnchainSettings: '온체인 설정 업데이트', withdrawRevenue: '수익 인출(USDC)', withdrawWallet: '내 지갑으로 인출', publishingChecklist: '게시 체크리스트', rulesRevenue: '규칙과 수익', licenseRevenueRules: '라이선스와 수익 규칙', personalUseLabel: '개인 사용', personalUseCopy: '아이콘, OC 프로필, 비상업 표시를 만들 수 있습니다.', commercialPermission: '상업 허가', commercialPermissionCopy: '제작자는 완성 OC에 기록되는 상업 사용 정책을 게시할 수 있습니다.', royaltyPolicy: '로열티 정책', royaltyPolicyCopy: '로열티 단계는 Soul Mint 시 고정되며 검토된 Soulidity 경로에서만 정산됩니다.', onchainPolicy: '온체인 정책', releaseEnforces: '이 버전이 강제하는 항목', permissionScope: '허가 범위', permissionScopeCopy: '개인, 리믹스, 상업, 독점 허가 유형을 기록합니다.', attribution: '출처 표시', attributionCopy: '게시된 Maker의 제작자 정보는 모든 Soul Mint 승인에 포함됩니다.', recipeIntegrity: '레시피 무결성', recipeIntegrityCopy: '필수 Part, 사용 가능한 Item, 조합 규칙을 승인 전에 검증합니다.', paidMintDisabled: 'Soulidity 어댑터 배포와 검증 전에는 유료 Mint를 사용할 수 없습니다.', restoringUpload: '저장된 Walrus 업로드 체크포인트 복원 중…',
    publishPackageFirst: 'Move 패키지를 게시하고 config.js에 packageId를 설정하세요.', connectPublishWallet: '게시 서명을 위해 Sui 지갑을 연결하세요.', addMakerName: '설정에서 Maker 이름을 입력하세요.', publishReadinessCopy: 'Walrus Quilt를 준비, 등록, 업로드, 인증한 뒤 Sui Mainnet에 게시하세요.', publishedNetwork: '{network}에 게시됨.', viewTransaction: '트랜잭션 보기', encodingQuilt: 'PNG 레이어와 Manifest를 Walrus Quilt로 인코딩 중…', quiltEncoded: 'Quilt 인코딩 완료. 지갑으로 Walrus Mainnet에 등록하세요.', prepareQuiltFailed: 'Maker Quilt를 준비하지 못했습니다.', registeringQuilt: 'Walrus 등록 서명을 기다린 뒤 Mainnet 릴레이로 업로드합니다…', recoveredCertified: '복구한 Quilt가 이미 인증되었습니다. Sui Maker 게시를 계속하세요.', quiltUploaded: 'Quilt 업로드 완료. 한 번 더 서명해 사용 가능성을 인증하세요.', registrationFailed: 'Walrus 등록 또는 업로드 실패.', certifyingQuilt: 'Walrus 인증 서명을 기다리는 중…', quiltCertified: 'Walrus Quilt 인증 완료. Sui Mainnet에 OCMaker를 게시하세요.', certificationFailed: 'Walrus 인증 실패.', waitingSuiPublish: 'Sui Mainnet 게시 서명을 기다리는 중…', makerChangedAfterUpload: '업로드 후 Maker가 변경되었습니다. 새 Quilt를 준비하세요.',
  },
  vi: {
    makerDescriptionDefault: 'Xây mẫu từ tài nguyên nhiều lớp rồi liên kết quy tắc giấy phép và nguồn gốc on-chain.', editMakerInfo: 'Sửa thông tin Maker', soulWorkspace: 'Không gian Soul', livingContentCopy: 'Mỗi OC có nội dung mặc định dùng được với Soulidity. Chỉ sửa khi Maker cần tính cách, ký ức hoặc kỹ năng riêng.', defaultsReady: 'Mặc định đã sẵn sàng', downloadTemplate: 'Tải mẫu', defaultStatus: 'Mặc định', soulCharacter: 'Nhân vật Soul', memory: 'Ký ức', skillsDocs: 'Kỹ năng & Tài liệu', restoreDefault: 'Khôi phục mặc định', soulidityImport: 'Nhập vào Soulidity', mintReadyStructure: 'Cấu trúc sẵn sàng Mint', livingImportCopy: 'Các tệp là mặc định có thể sửa trong Maker. OC cuối sẽ điền tên, thế giới và mô tả trước khi nhập vào Soulidity.',
    onchainAssets: 'Tài sản on-chain', assetRegistry: 'Đăng ký tài sản', walrusQuilt: 'Walrus Quilt', walrusQuiltAssets: 'PNG lớp, biểu tượng tùy chọn, ảnh bìa và Maker Manifest theo phiên bản', suiObjects: 'Đối tượng Sui', suiObjectsCopy: 'CreatorProfile, OCMaker, MakerTreasury, MakerAdminCap, quy tắc công thức, ảnh chụp chính sách và quyền sở hữu', revenueRoyalty: 'Doanh thu & bản quyền', revenueRoyaltyCopy: 'Đường Maker Treasury đã sẵn sàng; Mint trả phí và bản quyền 0%-5% được bật với bộ điều hợp Soulidity đã duyệt.', publishThisMaker: 'Đăng Maker này', publishPrereq: 'Giải quyết mọi lỗi kiểm tra, kết nối ví và cấu hình gói Move.', resumeSavedUpload: 'Tiếp tục bản tải đã lưu', prepareStep: '1. Chuẩn bị', registerUploadStep: '2. Đăng ký & tải lên', retryUploadStep: '2. Thử tải lại', certifyStep: '3. Chứng nhận', publishMakerStep: '4. Đăng Maker', publishingStatus: 'Đang đăng…', publishedMaker: 'Maker đã đăng', publishedRecordCopy: 'Bản ghi nằm trên Sui và tài nguyên Walrus đã chứng nhận còn dùng được trong thời hạn lưu.', archiveMaker: 'Lưu trữ Maker', restoreMaker: 'Khôi phục Maker', publishSteps: 'Các bước đăng', chainExecution: 'Thực thi on-chain', publicationRecord: 'Bản ghi xuất bản', immutableRecord: 'Nội dung trở thành bất biến', provenance: 'Nguồn gốc', provenanceCopy: 'Ví tác giả, đối tượng Maker, phiên bản gói và giao dịch đăng.', assetVersion: 'Phiên bản tài nguyên', assetVersionCopy: 'Walrus Manifest đã chứng nhận và mọi ảnh lớp được tham chiếu.', rulesRecord: 'Quy tắc', rulesRecordCopy: 'Part, Item, màu, thứ tự, lựa chọn, bảng màu và hàm băm công thức BCS được kiểm tra khi Mint Soul.',
    lifecycle: 'Vòng đời', draftLifecycleCopy: 'Bản nháp lưu cục bộ, vẫn có thể sửa hoặc xóa vĩnh viễn.', starterLifecycleCopy: 'Ví dụ này có thể sửa trong trình duyệt hiện tại. Hãy lưu thành Maker cục bộ mới trước khi dùng thật.', publishedLifecycleCopy: 'Maker, quy tắc, giấy phép và Walrus Manifest đã đăng là bất biến. Lưu trữ Maker để dừng phê duyệt Soul mới.', archivedLifecycleCopy: 'Lịch sử và Soul hiện có vẫn hợp lệ, nhưng Maker không nhận phê duyệt Soul mới.', versionLifecycleCopy: 'Đang sửa {current}. Maker trước và OC hiện có vẫn ghim ở {previous}.', archivedMaker: 'Maker đã lưu trữ', makerSettings: 'Cài đặt Maker', ocMakerSettings: 'Cài đặt OC Maker', makerName: 'Tên Maker', makerDescription: 'Mô tả Maker', creatorLabel: 'Tác giả', styleWorld: 'Phong cách / thế giới', licenseType: 'Loại giấy phép', licenseNote: 'Ghi chú giấy phép', mintingRevenue: 'Mint & doanh thu', allowSoulAuthorizations: 'Cho phép phê duyệt Soul mới', chargeMintFee: 'Thu phí Mint sau khi kích hoạt chính thức', mintPriceUsdc: 'Giá Mint (USDC)', resaleRoyalty: 'Bản quyền bán lại Soulidity tương lai', noRoyalty: 'Không bản quyền', pilotEconomicsCopy: 'Trong giai đoạn thử Maker, Mint trả phí bị tắt. Sau khi kích hoạt, doanh thu vào Maker Treasury và chỉ chủ MakerAdminCap được rút.', treasuryAfterPublication: 'Số dư Treasury xuất hiện sau khi đăng.', treasuryBalance: 'Số dư Treasury: {amount} {symbol}', updateOnchainSettings: 'Cập nhật cài đặt on-chain', withdrawRevenue: 'Rút doanh thu (USDC)', withdrawWallet: 'Rút về ví của tôi', publishingChecklist: 'Danh sách kiểm tra đăng', rulesRevenue: 'Quy tắc & Doanh thu', licenseRevenueRules: 'Quy tắc giấy phép và doanh thu', personalUseLabel: 'Dùng cá nhân', personalUseCopy: 'Người dùng có thể tạo biểu tượng, hồ sơ OC và hiển thị phi thương mại.', commercialPermission: 'Cho phép thương mại', commercialPermissionCopy: 'Tác giả có thể đăng chính sách thương mại được ghi vào mỗi OC hoàn chỉnh.', royaltyPolicy: 'Chính sách bản quyền', royaltyPolicyCopy: 'Bậc bản quyền được chụp khi Mint Soul và chỉ thanh toán qua Soulidity đã duyệt.', onchainPolicy: 'Chính sách on-chain', releaseEnforces: 'Bản này thực thi', permissionScope: 'Phạm vi quyền', permissionScopeCopy: 'Loại giấy phép ghi quyền cá nhân, phối lại, thương mại hoặc độc quyền.', attribution: 'Ghi công', attributionCopy: 'Maker đã đăng mang ghi công tác giả vào mọi phê duyệt Mint Soul.', recipeIntegrity: 'Toàn vẹn công thức', recipeIntegrityCopy: 'Part bắt buộc, Item khả dụng và quy tắc kết hợp được kiểm tra trước khi phê duyệt.', paidMintDisabled: 'Mint trả phí vẫn tắt cho đến khi bộ điều hợp Soulidity được triển khai và xác minh.', restoringUpload: 'Đang khôi phục điểm kiểm tra tải Walrus đã lưu…',
    publishPackageFirst: 'Đăng gói Move và đặt packageId trong config.js.', connectPublishWallet: 'Kết nối ví Sui để ký xuất bản.', addMakerName: 'Thêm tên Maker trong Cài đặt.', publishReadinessCopy: 'Chuẩn bị Walrus Quilt, đăng ký, tải lên, chứng nhận rồi đăng Maker lên Sui Mainnet.', publishedNetwork: 'Đã đăng trên {network}.', viewTransaction: 'Xem giao dịch', encodingQuilt: 'Đang mã hóa lớp PNG và Manifest thành Walrus Quilt…', quiltEncoded: 'Quilt đã mã hóa. Đăng ký trên Walrus Mainnet bằng ví.', prepareQuiltFailed: 'Không thể chuẩn bị Maker Quilt.', registeringQuilt: 'Đang chờ chữ ký đăng ký Walrus rồi tải qua relay Mainnet…', recoveredCertified: 'Quilt khôi phục đã được chứng nhận. Tiếp tục đăng Sui Maker.', quiltUploaded: 'Quilt đã tải lên. Ký thêm lần nữa để chứng nhận.', registrationFailed: 'Đăng ký hoặc tải Walrus thất bại.', certifyingQuilt: 'Đang chờ chữ ký chứng nhận Walrus…', quiltCertified: 'Walrus Quilt đã chứng nhận. Đăng OCMaker lên Sui Mainnet.', certificationFailed: 'Chứng nhận Walrus thất bại.', waitingSuiPublish: 'Đang chờ chữ ký đăng Sui Mainnet…', makerChangedAfterUpload: 'Maker đã thay đổi sau khi tải. Hãy chuẩn bị Quilt mới.',
  },
};

Object.entries(editorDetailI18n).forEach(([locale, details]) => Object.assign(i18n[locale], details));
i18n.zh.rulesRecordCopy = '部位、部件、颜色、顺序、组合、色板和 BCS 配方哈希在 Soul 铸造时强制验证。';
i18n.zh.recipeIntegrityCopy = '必选部位、可用部件和组合规则在授权前验证。';

const makerLifecycleStatusI18n = {
  en: {
    makerLifecycleDraft: 'Draft',
    makerLifecycleStarter: 'Starter',
    makerLifecyclePublishing: 'Publishing',
    makerLifecycleRecoverable: 'Recoverable',
    makerLifecycleActive: 'Active',
    makerLifecyclePaused: 'Paused',
    makerLifecycleArchived: 'Archived',
    makerLifecycleVersionDraft: 'Version draft',
    publishingLifecycleCopy: 'A release operation is in progress. Signed checkpoints remain saved until Sui and Walrus state are confirmed.',
    recoverableLifecycleCopy: 'A saved publication checkpoint or submitted transaction needs review. Resume or review it before requesting another signature.',
    activeLifecycleCopy: 'This published Maker is active and accepts new Soul authorizations. Its released content remains immutable.',
    pausedLifecycleCopy: 'New Soul authorizations are paused by the on-chain settings. Existing OCs and records remain valid; the MakerAdminCap holder can resume them.',
    retirementProtocolUpgrade: 'Permanent retirement and on-chain supersession are not available in this protocol version. They require a reviewed protocol upgrade; use reversible Archive instead.',
    makerAuthorityChecking: 'Revalidating the Maker and current MakerAdminCap owner on Sui…',
    makerAuthorityChanged: 'This wallet no longer owns the MakerAdminCap linked to this Maker, or the on-chain linkage changed. Refresh the library before trying again.',
    makerContextChanged: 'The active Maker or wallet changed while its authority was checked. No signature was requested.',
    makerStateReadbackPending: 'Transaction {digest} was submitted, but fresh on-chain state could not yet be confirmed. Refresh before another action.',
  },
  zh: {
    makerLifecycleDraft: '草稿',
    makerLifecycleStarter: '示例',
    makerLifecyclePublishing: '发布中',
    makerLifecycleRecoverable: '可恢复',
    makerLifecycleActive: '使用中',
    makerLifecyclePaused: '已暂停',
    makerLifecycleArchived: '已归档',
    makerLifecycleVersionDraft: '新版本草稿',
    publishingLifecycleCopy: '发布操作正在进行。Sui 与 Walrus 状态确认前，已签名的检查点会继续安全保留。',
    recoverableLifecycleCopy: '检测到需要检查的发布检查点或已提交交易。请先恢复或检查，再请求新的签名。',
    activeLifecycleCopy: '此已发布 Maker 正在使用并接受新的 Soul 授权；已发布内容仍保持不可变。',
    pausedLifecycleCopy: '链上设置已暂停新的 Soul 授权。现有 OC 与记录仍然有效；MakerAdminCap 持有者可以恢复。',
    retirementProtocolUpgrade: '此协议版本尚不支持永久退役或链上“已取代”状态；这些能力需要经过审核的协议升级。当前请使用可恢复的“归档”。',
    makerAuthorityChecking: '正在 Sui 上重新确认 Maker 状态和当前 MakerAdminCap 持有者…',
    makerAuthorityChanged: '当前钱包已不再持有此 Maker 关联的 MakerAdminCap，或链上绑定关系已经变化。请刷新模板库后重试。',
    makerContextChanged: '检查管理权限时，当前 Maker 或钱包发生了变化，因此没有请求签名。',
    makerStateReadbackPending: '交易 {digest} 已提交，但暂时无法确认最新链上状态。请先刷新，再执行下一项操作。',
  },
  ja: {
    makerLifecycleDraft: '下書き',
    makerLifecycleStarter: 'スターター',
    makerLifecyclePublishing: '公開処理中',
    makerLifecycleRecoverable: '復旧可能',
    makerLifecycleActive: '有効',
    makerLifecyclePaused: '一時停止',
    makerLifecycleArchived: 'アーカイブ済み',
    makerLifecycleVersionDraft: 'バージョン下書き',
    publishingLifecycleCopy: '公開処理を実行中です。Sui と Walrus の状態が確認されるまで署名済みチェックポイントを保持します。',
    recoverableLifecycleCopy: '保存済み公開チェックポイントまたは送信済み取引の確認が必要です。新しい署名の前に復旧または確認してください。',
    activeLifecycleCopy: 'この公開済み Maker は有効で、新しい Soul 認可を受け付けています。公開内容は不変のままです。',
    pausedLifecycleCopy: 'オンチェーン設定により新しい Soul 認可を一時停止しています。既存 OC と記録は有効で、MakerAdminCap 保有者が再開できます。',
    retirementProtocolUpgrade: 'このプロトコル版では完全廃止やオンチェーンの後継指定を利用できません。レビュー済みのプロトコル更新が必要なため、現時点では復元可能なアーカイブを使用してください。',
    makerAuthorityChecking: 'Sui 上の Maker 状態と現在の MakerAdminCap 所有者を再確認中…',
    makerAuthorityChanged: 'このウォレットは Maker に紐づく MakerAdminCap を所有していないか、オンチェーン連携が変更されました。ライブラリを更新してから再試行してください。',
    makerContextChanged: '権限確認中に Maker またはウォレットが変わったため、署名は要求されませんでした。',
    makerStateReadbackPending: '取引 {digest} は送信されましたが、最新のオンチェーン状態をまだ確認できません。次の操作前に更新してください。',
  },
  ko: {
    makerLifecycleDraft: '초안',
    makerLifecycleStarter: '시작 예시',
    makerLifecyclePublishing: '게시 처리 중',
    makerLifecycleRecoverable: '복구 가능',
    makerLifecycleActive: '활성',
    makerLifecyclePaused: '일시 중지',
    makerLifecycleArchived: '보관됨',
    makerLifecycleVersionDraft: '버전 초안',
    publishingLifecycleCopy: '게시 작업이 진행 중입니다. Sui와 Walrus 상태가 확인될 때까지 서명된 체크포인트를 보관합니다.',
    recoverableLifecycleCopy: '저장된 게시 체크포인트 또는 제출된 트랜잭션을 확인해야 합니다. 새 서명 전에 복구하거나 검토하세요.',
    activeLifecycleCopy: '게시된 Maker가 활성 상태이며 새 Soul 승인을 받습니다. 게시된 콘텐츠는 변경되지 않습니다.',
    pausedLifecycleCopy: '온체인 설정으로 새 Soul 승인이 일시 중지되었습니다. 기존 OC와 기록은 유효하며 MakerAdminCap 보유자가 다시 시작할 수 있습니다.',
    retirementProtocolUpgrade: '이 프로토콜 버전은 영구 폐기 또는 온체인 대체 상태를 지원하지 않습니다. 검토된 프로토콜 업그레이드가 필요하므로 현재는 복원 가능한 보관 기능을 사용하세요.',
    makerAuthorityChecking: 'Sui에서 Maker 상태와 현재 MakerAdminCap 소유자를 다시 확인하는 중…',
    makerAuthorityChanged: '이 지갑이 더 이상 Maker에 연결된 MakerAdminCap을 소유하지 않거나 온체인 연결이 변경되었습니다. 라이브러리를 새로고침한 뒤 다시 시도하세요.',
    makerContextChanged: '권한 확인 중 Maker 또는 지갑이 변경되어 서명을 요청하지 않았습니다.',
    makerStateReadbackPending: '트랜잭션 {digest}이 제출되었지만 최신 온체인 상태를 아직 확인하지 못했습니다. 다음 작업 전에 새로고침하세요.',
  },
  vi: {
    makerLifecycleDraft: 'Bản nháp',
    makerLifecycleStarter: 'Mẫu khởi đầu',
    makerLifecyclePublishing: 'Đang đăng',
    makerLifecycleRecoverable: 'Có thể khôi phục',
    makerLifecycleActive: 'Đang hoạt động',
    makerLifecyclePaused: 'Đã tạm dừng',
    makerLifecycleArchived: 'Đã lưu trữ',
    makerLifecycleVersionDraft: 'Bản nháp phiên bản',
    publishingLifecycleCopy: 'Quy trình đăng đang chạy. Các điểm kiểm tra đã ký được giữ lại đến khi xác nhận trạng thái Sui và Walrus.',
    recoverableLifecycleCopy: 'Một điểm kiểm tra đã lưu hoặc giao dịch đã gửi cần được xem xét. Hãy khôi phục hoặc kiểm tra trước khi yêu cầu chữ ký mới.',
    activeLifecycleCopy: 'Maker đã đăng này đang hoạt động và nhận phê duyệt Soul mới. Nội dung đã phát hành vẫn bất biến.',
    pausedLifecycleCopy: 'Cài đặt on-chain đã tạm dừng phê duyệt Soul mới. OC và bản ghi hiện có vẫn hợp lệ; chủ MakerAdminCap có thể tiếp tục.',
    retirementProtocolUpgrade: 'Phiên bản giao thức này chưa hỗ trợ ngừng vĩnh viễn hoặc đánh dấu bị thay thế on-chain. Các trạng thái đó cần một nâng cấp giao thức đã duyệt; hiện hãy dùng Lưu trữ có thể khôi phục.',
    makerAuthorityChecking: 'Đang xác minh lại trạng thái Maker và chủ MakerAdminCap hiện tại trên Sui…',
    makerAuthorityChanged: 'Ví này không còn sở hữu MakerAdminCap liên kết với Maker, hoặc liên kết on-chain đã đổi. Hãy làm mới thư viện rồi thử lại.',
    makerContextChanged: 'Maker hoặc ví đang hoạt động đã đổi trong lúc kiểm tra quyền nên không yêu cầu chữ ký.',
    makerStateReadbackPending: 'Giao dịch {digest} đã gửi nhưng chưa thể xác nhận trạng thái on-chain mới nhất. Hãy làm mới trước thao tác tiếp theo.',
  },
};

Object.entries(makerLifecycleStatusI18n).forEach(([locale, details]) => Object.assign(i18n[locale], details));

const makerLifecycleManagerI18n = {
  en: {
    makerLifecycleManagerKicker: 'Maker control',
    makerLifecycleManagerTitle: 'Lifecycle & on-chain status',
    makerLifecycleManagerCopy: 'Review the editable workspace and its published chain version before choosing an action.',
    makerLifecycleManagerClose: 'Close lifecycle manager',
    makerLifecycleManagerOpenEditor: 'Open editor',
    makerLifecycleManagerInspectEditor: 'Inspect published version',
    makerLifecycleManage: 'Manage status',
    makerLifecycleWorkingVersion: 'Working version',
    makerLifecyclePublishedVersion: 'Published chain version',
    makerLifecycleVersionHistoryTitle: 'Published version history',
    makerLifecycleVersionHistoryCopy: 'Every immutable OCMaker under this stable Maker root remains independently manageable.',
    makerLifecycleVersionCurrent: 'Current',
    makerLifecycleVersionPrevious: 'Previous',
    makerLifecycleVersionHistoryEmpty: 'No published version history is available yet.',
    makerLifecycleVersionHistoryNoAuthority: 'The connected wallet does not currently expose a matching MakerAdminCap for this object.',
    makerLifecycleNoPublishedVersion: 'No version has been published on Sui yet.',
    makerLifecycleLocalScope: 'Local workspace',
    makerLifecycleChainScope: 'Sui Mainnet',
    makerLifecycleVersion: 'Version',
    makerLifecycleObject: 'Maker object',
    makerLifecycleAuthority: 'Management authority',
    makerLifecycleAuthorityReady: 'MakerAdminCap available',
    makerLifecycleAuthorityUnavailable: 'Connect the owner wallet and refresh the library to manage this chain version.',
    makerLifecycleActionContinue: 'Continue editing',
    makerLifecycleActionRelease: 'Open release progress',
    makerLifecycleActionPublishVersion: 'Review & publish version',
    makerLifecycleActionStartVersion: 'Create next version',
    makerLifecycleActionDiscardVersion: 'Discard version draft',
    makerLifecycleActionPause: 'Pause new Soul authorizations',
    makerLifecycleActionResume: 'Resume new Soul authorizations',
    makerLifecycleActionResumeFree: 'Resume as free',
    makerLifecycleActionArchive: 'Archive chain version',
    makerLifecycleActionRestore: 'Restore chain version',
    makerLifecycleActionDeleteDraft: 'Delete local draft',
    makerLifecycleDraftActionCopy: 'This draft only exists in the current wallet workspace. Continue editing or delete its local record.',
    makerLifecyclePublishingActionCopy: 'A release is currently running. Reopen the saved progress without starting a second transaction.',
    makerLifecycleRecoverableActionCopy: 'A Walrus checkpoint or submitted Sui transaction is saved. Resume or review it before publishing again.',
    makerLifecycleActiveActionCopy: 'This immutable chain version is public and currently accepts new Soul authorizations.',
    makerLifecyclePausedActionCopy: 'This chain version remains public, but new Soul authorizations are disabled.',
    makerLifecycleArchivedActionCopy: 'This chain version is hidden from discovery and blocks new Soul authorizations. Existing records remain valid.',
    makerLifecycleVersionDraftActionCopy: 'The working version is editable. Its previously published chain version remains independently manageable below.',
    makerLifecycleStartVersionCopy: 'Create an editable local successor from the published version. Nothing changes on-chain until you publish it.',
    makerLifecycleDiscardVersionTitle: 'Discard this version draft?',
    makerLifecycleDiscardVersionCopy: 'The working version will return to the last published document. Its Sui object, Walrus assets, and existing OCs are not changed.',
    makerLifecycleDiscardVersionConfirm: 'Discard version draft',
    makerLifecyclePauseTitle: 'Pause new Soul authorizations?',
    makerLifecyclePauseCopy: 'Players may still inspect and try this Maker, while new Soul authorizations are blocked until you resume them. The current mint fee and royalty settings are saved before the transaction.',
    makerLifecyclePauseConfirm: 'Pause authorizations',
    makerLifecycleResumeTitle: 'Resume new Soul authorizations?',
    makerLifecycleResumeCopy: 'The saved pre-pause mint fee and royalty settings will be restored after current chain authority is revalidated.',
    makerLifecycleResumeFreeCopy: 'No pre-pause economics snapshot is available. Resuming will enable free Soul authorizations and keep the current royalty.',
    makerLifecycleResumeConfirm: 'Resume authorizations',
    makerLifecycleResumeFreeConfirm: 'Resume as free',
    makerLifecycleEconomicsSnapshotSaveFailed: 'The current Maker economics could not be saved safely. No Sui signature was requested.',
    makerLifecyclePermanentRetirementTitle: 'Permanent retirement is protocol-locked',
    makerLifecyclePermanentRetirementCopy: 'Permanent retirement and on-chain supersession require a reviewed protocol upgrade. Use reversible Archive for this release.',
    makerLifecycleVersionWarning: 'Publishing a version draft creates a separate immutable OCMaker. The previous chain version remains until you archive it manually.',
    makerLifecycleNoAuthority: 'This wallet cannot manage the published version because its MakerAdminCap is unavailable.',
    makerLifecycleStatusReady: 'Choose an action for this Maker.',
    makerLifecycleChainVersionImmutable: 'Published content and rules are immutable.',
    makerLifecycleExistingOcSafe: 'Existing OCs and provenance remain valid.',
    makerLifecycleNewVersionSeparate: 'New releases create a separate chain object.',
    makerLifecycleActionUnavailable: 'This action is unavailable until the current operation finishes.',
    makerLifecycleVersionStarted: 'The next version draft is ready.',
    makerLifecycleVersionDiscarded: 'The version draft was discarded and the last published version was restored locally.',
  },
  zh: {
    makerLifecycleManagerKicker: 'Maker 管理',
    makerLifecycleManagerTitle: '生命周期与链上状态',
    makerLifecycleManagerCopy: '操作前先分别确认可编辑工作版本和已经发布的链上版本。',
    makerLifecycleManagerClose: '关闭生命周期管理',
    makerLifecycleManagerOpenEditor: '打开编辑器',
    makerLifecycleManagerInspectEditor: '查看已发布版本',
    makerLifecycleManage: '管理状态',
    makerLifecycleWorkingVersion: '当前工作版本',
    makerLifecyclePublishedVersion: '已发布链上版本',
    makerLifecycleVersionHistoryTitle: '已发布版本历史',
    makerLifecycleVersionHistoryCopy: '同一稳定 Maker 根下的每个不可变 OCMaker 都可以独立管理。',
    makerLifecycleVersionCurrent: '当前版本',
    makerLifecycleVersionPrevious: '历史版本',
    makerLifecycleVersionHistoryEmpty: '尚无可用的已发布版本历史。',
    makerLifecycleVersionHistoryNoAuthority: '当前连接的钱包没有提供与此对象匹配的 MakerAdminCap。',
    makerLifecycleNoPublishedVersion: '尚未在 Sui 上发布任何版本。',
    makerLifecycleLocalScope: '本地工作区',
    makerLifecycleChainScope: 'Sui 主网',
    makerLifecycleVersion: '版本',
    makerLifecycleObject: 'Maker 对象',
    makerLifecycleAuthority: '管理权限',
    makerLifecycleAuthorityReady: 'MakerAdminCap 可用',
    makerLifecycleAuthorityUnavailable: '请连接持有者钱包并刷新模板库，才能管理这个链上版本。',
    makerLifecycleActionContinue: '继续编辑',
    makerLifecycleActionRelease: '打开发布进度',
    makerLifecycleActionPublishVersion: '审核并发布版本',
    makerLifecycleActionStartVersion: '创建下一版本',
    makerLifecycleActionDiscardVersion: '放弃版本草稿',
    makerLifecycleActionPause: '暂停新的 Soul 授权',
    makerLifecycleActionResume: '恢复新的 Soul 授权',
    makerLifecycleActionResumeFree: '按免费授权恢复',
    makerLifecycleActionArchive: '归档链上版本',
    makerLifecycleActionRestore: '恢复链上版本',
    makerLifecycleActionDeleteDraft: '删除本地草稿',
    makerLifecycleDraftActionCopy: '此草稿只存在于当前钱包的本地工作区中，可以继续编辑或删除本地记录。',
    makerLifecyclePublishingActionCopy: '发布流程正在执行。重新打开已保存进度，不会发起第二笔交易。',
    makerLifecycleRecoverableActionCopy: '已保存 Walrus 检查点或已提交的 Sui 交易。再次发布前请先恢复或检查。',
    makerLifecycleActiveActionCopy: '这个不可变的链上版本已公开，并正在接受新的 Soul 授权。',
    makerLifecyclePausedActionCopy: '这个链上版本仍可查看，但已停止新的 Soul 授权。',
    makerLifecycleArchivedActionCopy: '这个链上版本已从发现页隐藏，并阻止新的 Soul 授权；现有记录仍然有效。',
    makerLifecycleVersionDraftActionCopy: '当前工作版本可以编辑；它之前的已发布链上版本仍可在下方独立管理。',
    makerLifecycleStartVersionCopy: '从已发布版本创建可编辑的本地后继版本；发布前不会改变任何链上状态。',
    makerLifecycleDiscardVersionTitle: '放弃这个版本草稿？',
    makerLifecycleDiscardVersionCopy: '当前工作版本会恢复为最后一次发布的文档；Sui 对象、Walrus 素材和现有 OC 都不会改变。',
    makerLifecycleDiscardVersionConfirm: '放弃版本草稿',
    makerLifecyclePauseTitle: '暂停新的 Soul 授权？',
    makerLifecyclePauseCopy: '玩家仍可查看和试玩此 Maker，但在你恢复之前不能产生新的 Soul 授权。发起交易前会先保存当前铸造费用与版税设置。',
    makerLifecyclePauseConfirm: '暂停授权',
    makerLifecycleResumeTitle: '恢复新的 Soul 授权？',
    makerLifecycleResumeCopy: '重新确认当前链上权限后，会恢复暂停前保存的铸造费用与版税设置。',
    makerLifecycleResumeFreeCopy: '没有找到暂停前的经济参数快照。恢复后将启用免费 Soul 授权，并保留当前版税。',
    makerLifecycleResumeConfirm: '恢复授权',
    makerLifecycleResumeFreeConfirm: '按免费授权恢复',
    makerLifecycleEconomicsSnapshotSaveFailed: '无法安全保存当前 Maker 的经济参数，因此没有请求 Sui 签名。',
    makerLifecyclePermanentRetirementTitle: '永久退役仍受协议限制',
    makerLifecyclePermanentRetirementCopy: '永久退役和链上版本取代关系需要经过审核的协议升级。本版本请使用可恢复的“归档”。',
    makerLifecycleVersionWarning: '发布版本草稿会创建独立且不可变的新 OCMaker；旧链上版本会继续存在，直到你手动归档。',
    makerLifecycleNoAuthority: '当前钱包没有可用的 MakerAdminCap，因此不能管理这个已发布版本。',
    makerLifecycleStatusReady: '请选择这个 Maker 的管理操作。',
    makerLifecycleChainVersionImmutable: '已发布内容和规则不可修改。',
    makerLifecycleExistingOcSafe: '现有 OC 与来源记录继续有效。',
    makerLifecycleNewVersionSeparate: '新版本会创建独立链上对象。',
    makerLifecycleActionUnavailable: '当前操作完成前，此操作暂不可用。',
    makerLifecycleVersionStarted: '下一版本草稿已创建。',
    makerLifecycleVersionDiscarded: '版本草稿已放弃，并已在本地恢复最后发布版本。',
  },
  ja: {
    makerLifecycleManagerKicker: 'Maker 管理',
    makerLifecycleManagerTitle: 'ライフサイクルとオンチェーン状態',
    makerLifecycleManagerCopy: '操作前に、編集可能な作業版と公開済みチェーン版をそれぞれ確認します。',
    makerLifecycleManagerClose: 'ライフサイクル管理を閉じる',
    makerLifecycleManagerOpenEditor: 'エディターを開く',
    makerLifecycleManagerInspectEditor: '公開済み版を確認',
    makerLifecycleManage: '状態を管理',
    makerLifecycleWorkingVersion: '作業中バージョン',
    makerLifecyclePublishedVersion: '公開済みチェーン版',
    makerLifecycleVersionHistoryTitle: '公開済みバージョン履歴',
    makerLifecycleVersionHistoryCopy: '同じ安定 Maker ルートに属する各不変 OCMaker を個別に管理できます。',
    makerLifecycleVersionCurrent: '現在',
    makerLifecycleVersionPrevious: '以前',
    makerLifecycleVersionHistoryEmpty: '公開済みバージョン履歴はまだありません。',
    makerLifecycleVersionHistoryNoAuthority: '接続中のウォレットに、このオブジェクトと一致する MakerAdminCap がありません。',
    makerLifecycleNoPublishedVersion: 'Sui にはまだ公開されていません。',
    makerLifecycleLocalScope: 'ローカルワークスペース',
    makerLifecycleChainScope: 'Sui Mainnet',
    makerLifecycleVersion: 'バージョン',
    makerLifecycleObject: 'Maker オブジェクト',
    makerLifecycleAuthority: '管理権限',
    makerLifecycleAuthorityReady: 'MakerAdminCap 利用可能',
    makerLifecycleAuthorityUnavailable: '所有者ウォレットを接続し、ライブラリを更新すると管理できます。',
    makerLifecycleActionContinue: '編集を続ける',
    makerLifecycleActionRelease: '公開進捗を開く',
    makerLifecycleActionPublishVersion: '確認してバージョンを公開',
    makerLifecycleActionStartVersion: '次のバージョンを作成',
    makerLifecycleActionDiscardVersion: 'バージョン下書きを破棄',
    makerLifecycleActionPause: '新しい Soul 認可を停止',
    makerLifecycleActionResume: '新しい Soul 認可を再開',
    makerLifecycleActionResumeFree: '無料認可として再開',
    makerLifecycleActionArchive: 'チェーン版をアーカイブ',
    makerLifecycleActionRestore: 'チェーン版を復元',
    makerLifecycleActionDeleteDraft: 'ローカル下書きを削除',
    makerLifecycleDraftActionCopy: 'この下書きは現在のウォレットのローカル領域だけにあります。編集継続または削除ができます。',
    makerLifecyclePublishingActionCopy: '公開処理中です。二重送信せず保存済み進捗を再表示します。',
    makerLifecycleRecoverableActionCopy: 'Walrus チェックポイントまたは送信済み Sui 取引があります。再公開前に復旧または確認してください。',
    makerLifecycleActiveActionCopy: 'この不変のチェーン版は公開中で、新しい Soul 認可を受け付けています。',
    makerLifecyclePausedActionCopy: 'このチェーン版は閲覧できますが、新しい Soul 認可は停止中です。',
    makerLifecycleArchivedActionCopy: 'このチェーン版は一覧から隠れ、新しい Soul 認可を停止しています。既存記録は有効です。',
    makerLifecycleVersionDraftActionCopy: '作業中バージョンは編集可能です。以前の公開済みチェーン版は下で個別に管理できます。',
    makerLifecycleStartVersionCopy: '公開済み版から編集可能な後継下書きを作ります。公開するまでチェーン状態は変わりません。',
    makerLifecycleDiscardVersionTitle: 'このバージョン下書きを破棄しますか？',
    makerLifecycleDiscardVersionCopy: '作業版を最後の公開文書へ戻します。Sui オブジェクト、Walrus 素材、既存 OC は変わりません。',
    makerLifecycleDiscardVersionConfirm: 'バージョン下書きを破棄',
    makerLifecyclePauseTitle: '新しい Soul 認可を停止しますか？',
    makerLifecyclePauseCopy: '閲覧と試用はできますが、再開するまで新しい Soul 認可は作成できません。取引前に現在のミント料金とロイヤリティ設定を保存します。',
    makerLifecyclePauseConfirm: '認可を停止',
    makerLifecycleResumeTitle: '新しい Soul 認可を再開しますか？',
    makerLifecycleResumeCopy: '現在のチェーン権限を再確認した後、停止前に保存したミント料金とロイヤリティ設定を復元します。',
    makerLifecycleResumeFreeCopy: '停止前の経済設定スナップショットがありません。無料の Soul 認可として再開し、現在のロイヤリティを維持します。',
    makerLifecycleResumeConfirm: '認可を再開',
    makerLifecycleResumeFreeConfirm: '無料認可として再開',
    makerLifecycleEconomicsSnapshotSaveFailed: '現在の Maker 経済設定を安全に保存できなかったため、Sui 署名は要求されませんでした。',
    makerLifecyclePermanentRetirementTitle: '完全廃止はプロトコル制限中',
    makerLifecyclePermanentRetirementCopy: '完全廃止とオンチェーン後継指定にはレビュー済み更新が必要です。現版では復元可能なアーカイブを使います。',
    makerLifecycleVersionWarning: 'バージョン下書きの公開は別の不変 OCMaker を作成します。旧版は手動でアーカイブするまで残ります。',
    makerLifecycleNoAuthority: 'このウォレットでは MakerAdminCap を利用できないため、公開版を管理できません。',
    makerLifecycleStatusReady: 'この Maker の操作を選択してください。',
    makerLifecycleChainVersionImmutable: '公開済み内容と規則は不変です。',
    makerLifecycleExistingOcSafe: '既存 OC と来歴は有効です。',
    makerLifecycleNewVersionSeparate: '新しい公開は別のチェーンオブジェクトです。',
    makerLifecycleActionUnavailable: '現在の処理が終わるまで利用できません。',
    makerLifecycleVersionStarted: '次のバージョン下書きを作成しました。',
    makerLifecycleVersionDiscarded: 'バージョン下書きを破棄し、最後の公開版をローカルへ戻しました。',
  },
  ko: {
    makerLifecycleManagerKicker: 'Maker 관리',
    makerLifecycleManagerTitle: '수명 주기 및 온체인 상태',
    makerLifecycleManagerCopy: '작업하기 전에 편집 가능한 작업 버전과 게시된 체인 버전을 각각 확인하세요.',
    makerLifecycleManagerClose: '수명 주기 관리자 닫기',
    makerLifecycleManagerOpenEditor: '편집기 열기',
    makerLifecycleManagerInspectEditor: '게시 버전 확인',
    makerLifecycleManage: '상태 관리',
    makerLifecycleWorkingVersion: '작업 버전',
    makerLifecyclePublishedVersion: '게시된 체인 버전',
    makerLifecycleVersionHistoryTitle: '게시 버전 기록',
    makerLifecycleVersionHistoryCopy: '같은 안정 Maker 루트의 모든 불변 OCMaker를 각각 관리할 수 있습니다.',
    makerLifecycleVersionCurrent: '현재',
    makerLifecycleVersionPrevious: '이전',
    makerLifecycleVersionHistoryEmpty: '아직 게시 버전 기록이 없습니다.',
    makerLifecycleVersionHistoryNoAuthority: '연결된 지갑에 이 객체와 일치하는 MakerAdminCap이 없습니다.',
    makerLifecycleNoPublishedVersion: '아직 Sui에 게시된 버전이 없습니다.',
    makerLifecycleLocalScope: '로컬 작업 공간',
    makerLifecycleChainScope: 'Sui Mainnet',
    makerLifecycleVersion: '버전',
    makerLifecycleObject: 'Maker 객체',
    makerLifecycleAuthority: '관리 권한',
    makerLifecycleAuthorityReady: 'MakerAdminCap 사용 가능',
    makerLifecycleAuthorityUnavailable: '소유자 지갑을 연결하고 라이브러리를 새로고침해 관리하세요.',
    makerLifecycleActionContinue: '계속 편집',
    makerLifecycleActionRelease: '게시 진행 상황 열기',
    makerLifecycleActionPublishVersion: '검토 후 버전 게시',
    makerLifecycleActionStartVersion: '다음 버전 만들기',
    makerLifecycleActionDiscardVersion: '버전 초안 폐기',
    makerLifecycleActionPause: '새 Soul 승인 일시 중지',
    makerLifecycleActionResume: '새 Soul 승인 재개',
    makerLifecycleActionResumeFree: '무료 승인으로 재개',
    makerLifecycleActionArchive: '체인 버전 보관',
    makerLifecycleActionRestore: '체인 버전 복원',
    makerLifecycleActionDeleteDraft: '로컬 초안 삭제',
    makerLifecycleDraftActionCopy: '이 초안은 현재 지갑의 로컬 작업 공간에만 있습니다. 계속 편집하거나 삭제할 수 있습니다.',
    makerLifecyclePublishingActionCopy: '게시 작업이 진행 중입니다. 두 번째 거래 없이 저장된 진행 상황을 다시 엽니다.',
    makerLifecycleRecoverableActionCopy: 'Walrus 체크포인트 또는 제출된 Sui 거래가 저장되어 있습니다. 다시 게시하기 전에 복구하거나 검토하세요.',
    makerLifecycleActiveActionCopy: '이 불변 체인 버전은 공개되어 있으며 새 Soul 승인을 받습니다.',
    makerLifecyclePausedActionCopy: '이 체인 버전은 공개 상태지만 새 Soul 승인은 중지되었습니다.',
    makerLifecycleArchivedActionCopy: '이 체인 버전은 검색에서 숨겨지고 새 Soul 승인을 차단합니다. 기존 기록은 유효합니다.',
    makerLifecycleVersionDraftActionCopy: '작업 버전은 편집 가능하며 이전 게시 체인 버전은 아래에서 별도로 관리할 수 있습니다.',
    makerLifecycleStartVersionCopy: '게시 버전에서 편집 가능한 후속 초안을 만듭니다. 게시 전에는 온체인 상태가 바뀌지 않습니다.',
    makerLifecycleDiscardVersionTitle: '이 버전 초안을 폐기할까요?',
    makerLifecycleDiscardVersionCopy: '작업 버전을 마지막 게시 문서로 되돌립니다. Sui 객체, Walrus 자산, 기존 OC는 바뀌지 않습니다.',
    makerLifecycleDiscardVersionConfirm: '버전 초안 폐기',
    makerLifecyclePauseTitle: '새 Soul 승인을 일시 중지할까요?',
    makerLifecyclePauseCopy: '플레이어는 계속 보고 체험할 수 있지만 재개 전까지 새 Soul 승인은 만들 수 없습니다. 거래 전에 현재 민팅 수수료와 로열티 설정을 저장합니다.',
    makerLifecyclePauseConfirm: '승인 일시 중지',
    makerLifecycleResumeTitle: '새 Soul 승인을 재개할까요?',
    makerLifecycleResumeCopy: '현재 체인 권한을 다시 확인한 뒤 일시 중지 전에 저장한 민팅 수수료와 로열티 설정을 복원합니다.',
    makerLifecycleResumeFreeCopy: '일시 중지 전 경제 설정 스냅샷이 없습니다. 무료 Soul 승인으로 재개하고 현재 로열티를 유지합니다.',
    makerLifecycleResumeConfirm: '승인 재개',
    makerLifecycleResumeFreeConfirm: '무료 승인으로 재개',
    makerLifecycleEconomicsSnapshotSaveFailed: '현재 Maker 경제 설정을 안전하게 저장하지 못해 Sui 서명을 요청하지 않았습니다.',
    makerLifecyclePermanentRetirementTitle: '영구 폐기는 프로토콜에서 잠겨 있음',
    makerLifecyclePermanentRetirementCopy: '영구 폐기와 온체인 대체 표시는 검토된 업그레이드가 필요합니다. 현재는 복원 가능한 보관을 사용하세요.',
    makerLifecycleVersionWarning: '버전 초안을 게시하면 별도의 불변 OCMaker가 생성됩니다. 이전 버전은 직접 보관할 때까지 남습니다.',
    makerLifecycleNoAuthority: '이 지갑에는 사용할 수 있는 MakerAdminCap이 없어 게시 버전을 관리할 수 없습니다.',
    makerLifecycleStatusReady: '이 Maker에 적용할 작업을 선택하세요.',
    makerLifecycleChainVersionImmutable: '게시된 콘텐츠와 규칙은 변경되지 않습니다.',
    makerLifecycleExistingOcSafe: '기존 OC와 출처는 계속 유효합니다.',
    makerLifecycleNewVersionSeparate: '새 릴리스는 별도의 체인 객체를 만듭니다.',
    makerLifecycleActionUnavailable: '현재 작업이 끝날 때까지 사용할 수 없습니다.',
    makerLifecycleVersionStarted: '다음 버전 초안이 준비되었습니다.',
    makerLifecycleVersionDiscarded: '버전 초안을 폐기하고 마지막 게시 버전을 로컬에 복원했습니다.',
  },
  vi: {
    makerLifecycleManagerKicker: 'Quản lý Maker',
    makerLifecycleManagerTitle: 'Vòng đời & trạng thái on-chain',
    makerLifecycleManagerCopy: 'Kiểm tra riêng phiên bản đang sửa và phiên bản đã đăng on-chain trước khi thao tác.',
    makerLifecycleManagerClose: 'Đóng quản lý vòng đời',
    makerLifecycleManagerOpenEditor: 'Mở trình chỉnh sửa',
    makerLifecycleManagerInspectEditor: 'Xem phiên bản đã đăng',
    makerLifecycleManage: 'Quản lý trạng thái',
    makerLifecycleWorkingVersion: 'Phiên bản đang làm',
    makerLifecyclePublishedVersion: 'Phiên bản đã đăng on-chain',
    makerLifecycleVersionHistoryTitle: 'Lịch sử phiên bản đã đăng',
    makerLifecycleVersionHistoryCopy: 'Mỗi OCMaker bất biến trong cùng gốc Maker ổn định đều có thể được quản lý riêng.',
    makerLifecycleVersionCurrent: 'Hiện tại',
    makerLifecycleVersionPrevious: 'Trước đây',
    makerLifecycleVersionHistoryEmpty: 'Chưa có lịch sử phiên bản đã đăng.',
    makerLifecycleVersionHistoryNoAuthority: 'Ví đang kết nối không có MakerAdminCap khớp với đối tượng này.',
    makerLifecycleNoPublishedVersion: 'Chưa có phiên bản nào được đăng lên Sui.',
    makerLifecycleLocalScope: 'Không gian cục bộ',
    makerLifecycleChainScope: 'Sui Mainnet',
    makerLifecycleVersion: 'Phiên bản',
    makerLifecycleObject: 'Đối tượng Maker',
    makerLifecycleAuthority: 'Quyền quản lý',
    makerLifecycleAuthorityReady: 'Có MakerAdminCap',
    makerLifecycleAuthorityUnavailable: 'Kết nối ví chủ sở hữu và làm mới thư viện để quản lý phiên bản này.',
    makerLifecycleActionContinue: 'Tiếp tục chỉnh sửa',
    makerLifecycleActionRelease: 'Mở tiến trình đăng',
    makerLifecycleActionPublishVersion: 'Xem lại & đăng phiên bản',
    makerLifecycleActionStartVersion: 'Tạo phiên bản tiếp theo',
    makerLifecycleActionDiscardVersion: 'Bỏ bản nháp phiên bản',
    makerLifecycleActionPause: 'Tạm dừng phê duyệt Soul mới',
    makerLifecycleActionResume: 'Tiếp tục phê duyệt Soul mới',
    makerLifecycleActionResumeFree: 'Tiếp tục miễn phí',
    makerLifecycleActionArchive: 'Lưu trữ phiên bản on-chain',
    makerLifecycleActionRestore: 'Khôi phục phiên bản on-chain',
    makerLifecycleActionDeleteDraft: 'Xóa bản nháp cục bộ',
    makerLifecycleDraftActionCopy: 'Bản nháp này chỉ có trong không gian cục bộ của ví hiện tại. Bạn có thể sửa tiếp hoặc xóa.',
    makerLifecyclePublishingActionCopy: 'Quy trình đăng đang chạy. Mở lại tiến trình đã lưu mà không tạo giao dịch thứ hai.',
    makerLifecycleRecoverableActionCopy: 'Có điểm kiểm tra Walrus hoặc giao dịch Sui đã gửi. Hãy khôi phục hoặc xem lại trước khi đăng lại.',
    makerLifecycleActiveActionCopy: 'Phiên bản on-chain bất biến này đang công khai và nhận phê duyệt Soul mới.',
    makerLifecyclePausedActionCopy: 'Phiên bản này vẫn công khai nhưng không nhận phê duyệt Soul mới.',
    makerLifecycleArchivedActionCopy: 'Phiên bản này bị ẩn khỏi khám phá và chặn phê duyệt Soul mới. Bản ghi cũ vẫn hợp lệ.',
    makerLifecycleVersionDraftActionCopy: 'Phiên bản đang làm có thể sửa; phiên bản on-chain trước đó vẫn được quản lý riêng bên dưới.',
    makerLifecycleStartVersionCopy: 'Tạo bản kế nhiệm cục bộ có thể sửa từ phiên bản đã đăng. On-chain không đổi cho đến khi bạn đăng.',
    makerLifecycleDiscardVersionTitle: 'Bỏ bản nháp phiên bản này?',
    makerLifecycleDiscardVersionCopy: 'Phiên bản đang làm sẽ trở về tài liệu đã đăng gần nhất. Đối tượng Sui, tài nguyên Walrus và OC hiện có không đổi.',
    makerLifecycleDiscardVersionConfirm: 'Bỏ bản nháp phiên bản',
    makerLifecyclePauseTitle: 'Tạm dừng phê duyệt Soul mới?',
    makerLifecyclePauseCopy: 'Người chơi vẫn xem và thử được, nhưng không thể tạo phê duyệt Soul mới cho đến khi tiếp tục. Phí mint và tiền bản quyền hiện tại được lưu trước giao dịch.',
    makerLifecyclePauseConfirm: 'Tạm dừng phê duyệt',
    makerLifecycleResumeTitle: 'Tiếp tục phê duyệt Soul mới?',
    makerLifecycleResumeCopy: 'Sau khi xác minh lại quyền on-chain hiện tại, phí mint và tiền bản quyền đã lưu trước khi tạm dừng sẽ được khôi phục.',
    makerLifecycleResumeFreeCopy: 'Không có ảnh chụp cấu hình kinh tế trước khi tạm dừng. Maker sẽ tiếp tục với phê duyệt Soul miễn phí và giữ tiền bản quyền hiện tại.',
    makerLifecycleResumeConfirm: 'Tiếp tục phê duyệt',
    makerLifecycleResumeFreeConfirm: 'Tiếp tục miễn phí',
    makerLifecycleEconomicsSnapshotSaveFailed: 'Không thể lưu an toàn cấu hình kinh tế hiện tại của Maker nên không yêu cầu chữ ký Sui.',
    makerLifecyclePermanentRetirementTitle: 'Ngừng vĩnh viễn bị khóa bởi giao thức',
    makerLifecyclePermanentRetirementCopy: 'Ngừng vĩnh viễn và thay thế on-chain cần nâng cấp giao thức đã duyệt. Hiện hãy dùng Lưu trữ có thể khôi phục.',
    makerLifecycleVersionWarning: 'Đăng bản nháp phiên bản tạo một OCMaker bất biến riêng. Phiên bản cũ còn tồn tại đến khi bạn tự lưu trữ.',
    makerLifecycleNoAuthority: 'Ví này không có MakerAdminCap nên không thể quản lý phiên bản đã đăng.',
    makerLifecycleStatusReady: 'Chọn một thao tác cho Maker này.',
    makerLifecycleChainVersionImmutable: 'Nội dung và quy tắc đã đăng là bất biến.',
    makerLifecycleExistingOcSafe: 'OC và nguồn gốc hiện có vẫn hợp lệ.',
    makerLifecycleNewVersionSeparate: 'Bản phát hành mới tạo đối tượng on-chain riêng.',
    makerLifecycleActionUnavailable: 'Thao tác chưa dùng được cho đến khi quy trình hiện tại hoàn tất.',
    makerLifecycleVersionStarted: 'Bản nháp phiên bản tiếp theo đã sẵn sàng.',
    makerLifecycleVersionDiscarded: 'Đã bỏ bản nháp và khôi phục phiên bản đã đăng gần nhất ở cục bộ.',
  },
};

Object.entries(makerLifecycleManagerI18n).forEach(([locale, details]) => Object.assign(i18n[locale], details));

const licenseOptionI18n = {
  en: { licensePersonal: 'Personal use', licenseRemix: 'Free remix', licenseCommercial: 'Paid commercial', licenseExclusive: 'Exclusive commission' },
  zh: { licensePersonal: '个人使用', licenseRemix: '允许免费再创作', licenseCommercial: '付费商业使用', licenseExclusive: '独家委托' },
  ja: { licensePersonal: '個人利用', licenseRemix: '無料リミックス', licenseCommercial: '有料商用', licenseExclusive: '独占コミッション' },
  ko: { licensePersonal: '개인 사용', licenseRemix: '무료 리믹스', licenseCommercial: '유료 상업 사용', licenseExclusive: '독점 커미션' },
  vi: { licensePersonal: 'Dùng cá nhân', licenseRemix: 'Phối lại miễn phí', licenseCommercial: 'Thương mại trả phí', licenseExclusive: 'Đặt hàng độc quyền' },
};

Object.entries(licenseOptionI18n).forEach(([locale, details]) => Object.assign(i18n[locale], details));

const livingStatusI18n = {
  en: { customizedStatus: 'Customized', customizedCount: '{count} customized', byteCount: '{count} bytes' },
  zh: { customizedStatus: '已自定义', customizedCount: '已自定义 {count} 项', byteCount: '{count} 字节' },
  ja: { customizedStatus: 'カスタマイズ済み', customizedCount: '{count} 件カスタマイズ済み', byteCount: '{count} バイト' },
  ko: { customizedStatus: '사용자 지정', customizedCount: '{count}개 사용자 지정', byteCount: '{count}바이트' },
  vi: { customizedStatus: 'Đã tùy chỉnh', customizedCount: 'Đã tùy chỉnh {count}', byteCount: '{count} byte' },
};

Object.entries(livingStatusI18n).forEach(([locale, details]) => Object.assign(i18n[locale], details));

const draftRecoveryI18n = {
  en: {
    draftRecovery: 'Draft Recovery',
    draftRecoveryTitle: 'Draft Recovery Center',
    draftRecoveryKicker: 'Local safety',
    draftRecoveryIntro: 'Animacraft scans current and legacy browser storage without deleting or changing it. Export any discovery first, or restore a compatible Maker as a new independent copy.',
    draftRecoveryScan: 'Scan again',
    draftRecoveryDone: 'Done',
    draftRecoveryScanning: 'Scanning current and legacy browser storage…',
    draftRecoveryEmpty: 'No Maker draft records were found in this browser.',
    draftRecoveryFound: '{count} draft record(s) found. Source data remains untouched.',
    draftRecoveryExport: 'Export backup',
    draftRecoveryRestore: 'Restore as copy',
    draftRecoveryRestoring: 'Restoring…',
    draftRecoveryUnsupported: 'Raw backup only; this older format cannot be migrated automatically.',
    draftRecoveryComplete: 'Recovered “{name}” as a new independent Maker.',
    draftRecoveryFailed: 'The selected draft could not be recovered safely.',
    draftRecoveryCurrent: 'Current v6 workspace',
    draftRecoveryWorkspaceV4: 'Legacy Workspace v4',
    draftRecoveryCreatorDrafts: 'Legacy Creator draft',
    draftRecoveryLocalDraft: 'Legacy local draft',
    draftRecoveryLocalIndex: 'Legacy Maker index',
    draftRecoveryUnknownWallet: 'Unknown wallet',
    draftRecoveryAssets: '{count} asset(s)',
    draftRecoveryRevision: 'revision {revision}',
  },
  zh: {
    draftRecovery: '草稿恢复',
    draftRecoveryTitle: '草稿恢复中心',
    draftRecoveryKicker: '本地数据安全',
    draftRecoveryIntro: 'Animacraft 会以只读方式扫描新版和旧版浏览器存储，绝不删除或修改源数据。你可以先导出任何记录，再把兼容的 Maker 恢复为全新的独立副本。',
    draftRecoveryScan: '重新扫描',
    draftRecoveryDone: '完成',
    draftRecoveryScanning: '正在扫描新版与旧版浏览器存储…',
    draftRecoveryEmpty: '此浏览器中没有发现 Maker 草稿记录。',
    draftRecoveryFound: '发现 {count} 条草稿记录，所有源数据均保持不变。',
    draftRecoveryExport: '导出备份',
    draftRecoveryRestore: '恢复为副本',
    draftRecoveryRestoring: '正在恢复…',
    draftRecoveryUnsupported: '只能导出原始备份；这个旧格式无法安全地自动迁移。',
    draftRecoveryComplete: '已把“{name}”恢复为新的独立 Maker。',
    draftRecoveryFailed: '无法安全恢复所选草稿。',
    draftRecoveryCurrent: '当前 v6 工作区',
    draftRecoveryWorkspaceV4: '旧版 Workspace v4',
    draftRecoveryCreatorDrafts: '旧版 Creator 草稿',
    draftRecoveryLocalDraft: '旧版本地草稿',
    draftRecoveryLocalIndex: '旧版 Maker 索引',
    draftRecoveryUnknownWallet: '未知钱包',
    draftRecoveryAssets: '{count} 个素材',
    draftRecoveryRevision: '修订版 {revision}',
  },
  ja: {
    draftRecovery: '下書き復旧',
    draftRecoveryTitle: '下書き復旧センター',
    draftRecoveryKicker: 'ローカル保護',
    draftRecoveryIntro: '現在と旧版のブラウザ保存領域を読み取り専用で検査します。元データは削除・変更されません。記録を先に書き出し、対応 Maker は独立コピーとして復旧できます。',
    draftRecoveryScan: '再スキャン',
    draftRecoveryDone: '完了',
    draftRecoveryScanning: '現在と旧版の保存領域をスキャン中…',
    draftRecoveryEmpty: 'このブラウザに Maker 下書きは見つかりませんでした。',
    draftRecoveryFound: '{count} 件の記録を発見しました。元データは変更されません。',
    draftRecoveryExport: 'バックアップを書き出す',
    draftRecoveryRestore: 'コピーとして復旧',
    draftRecoveryRestoring: '復旧中…',
    draftRecoveryUnsupported: '元データの書き出しのみ可能です。この旧形式は自動移行できません。',
    draftRecoveryComplete: '「{name}」を新しい独立 Maker として復旧しました。',
    draftRecoveryFailed: '選択した下書きを安全に復旧できませんでした。',
    draftRecoveryCurrent: '現在の v6 ワークスペース',
    draftRecoveryWorkspaceV4: '旧 Workspace v4',
    draftRecoveryCreatorDrafts: '旧 Creator 下書き',
    draftRecoveryLocalDraft: '旧ローカル下書き',
    draftRecoveryLocalIndex: '旧 Maker インデックス',
    draftRecoveryUnknownWallet: '不明なウォレット',
    draftRecoveryAssets: '{count} 個の素材',
    draftRecoveryRevision: 'リビジョン {revision}',
  },
  ko: {
    draftRecovery: '초안 복구',
    draftRecoveryTitle: '초안 복구 센터',
    draftRecoveryKicker: '로컬 데이터 보호',
    draftRecoveryIntro: '현재 및 이전 브라우저 저장소를 읽기 전용으로 검사합니다. 원본은 삭제하거나 변경하지 않습니다. 먼저 백업을 내보내고 호환 Maker를 독립 복사본으로 복구할 수 있습니다.',
    draftRecoveryScan: '다시 검사',
    draftRecoveryDone: '완료',
    draftRecoveryScanning: '현재 및 이전 브라우저 저장소 검사 중…',
    draftRecoveryEmpty: '이 브라우저에서 Maker 초안을 찾지 못했습니다.',
    draftRecoveryFound: '{count}개 기록을 찾았습니다. 원본 데이터는 그대로 유지됩니다.',
    draftRecoveryExport: '백업 내보내기',
    draftRecoveryRestore: '복사본으로 복구',
    draftRecoveryRestoring: '복구 중…',
    draftRecoveryUnsupported: '원본 백업만 가능합니다. 이 이전 형식은 자동 이전할 수 없습니다.',
    draftRecoveryComplete: '“{name}”을 새 독립 Maker로 복구했습니다.',
    draftRecoveryFailed: '선택한 초안을 안전하게 복구하지 못했습니다.',
    draftRecoveryCurrent: '현재 v6 작업 공간',
    draftRecoveryWorkspaceV4: '이전 Workspace v4',
    draftRecoveryCreatorDrafts: '이전 Creator 초안',
    draftRecoveryLocalDraft: '이전 로컬 초안',
    draftRecoveryLocalIndex: '이전 Maker 인덱스',
    draftRecoveryUnknownWallet: '알 수 없는 지갑',
    draftRecoveryAssets: '소재 {count}개',
    draftRecoveryRevision: '리비전 {revision}',
  },
  vi: {
    draftRecovery: 'Khôi phục bản nháp',
    draftRecoveryTitle: 'Trung tâm khôi phục bản nháp',
    draftRecoveryKicker: 'An toàn dữ liệu cục bộ',
    draftRecoveryIntro: 'Animacraft quét bộ nhớ trình duyệt hiện tại và cũ ở chế độ chỉ đọc, không xóa hay thay đổi dữ liệu nguồn. Bạn có thể xuất bản sao lưu trước hoặc khôi phục Maker tương thích thành một bản sao độc lập.',
    draftRecoveryScan: 'Quét lại',
    draftRecoveryDone: 'Xong',
    draftRecoveryScanning: 'Đang quét bộ nhớ trình duyệt hiện tại và cũ…',
    draftRecoveryEmpty: 'Không tìm thấy bản nháp Maker trong trình duyệt này.',
    draftRecoveryFound: 'Đã tìm thấy {count} bản ghi. Dữ liệu nguồn không bị thay đổi.',
    draftRecoveryExport: 'Xuất bản sao lưu',
    draftRecoveryRestore: 'Khôi phục thành bản sao',
    draftRecoveryRestoring: 'Đang khôi phục…',
    draftRecoveryUnsupported: 'Chỉ có thể xuất bản sao lưu thô; định dạng cũ này không thể tự động di chuyển.',
    draftRecoveryComplete: 'Đã khôi phục “{name}” thành một Maker độc lập mới.',
    draftRecoveryFailed: 'Không thể khôi phục an toàn bản nháp đã chọn.',
    draftRecoveryCurrent: 'Workspace v6 hiện tại',
    draftRecoveryWorkspaceV4: 'Workspace v4 cũ',
    draftRecoveryCreatorDrafts: 'Bản nháp Creator cũ',
    draftRecoveryLocalDraft: 'Bản nháp cục bộ cũ',
    draftRecoveryLocalIndex: 'Chỉ mục Maker cũ',
    draftRecoveryUnknownWallet: 'Ví không xác định',
    draftRecoveryAssets: '{count} tài nguyên',
    draftRecoveryRevision: 'bản sửa đổi {revision}',
  },
};

Object.entries(draftRecoveryI18n).forEach(([locale, details]) => Object.assign(i18n[locale], details));

const productionRuntimeI18n = {
  en: {
    walletConnectedAs: 'Wallet connected: {address}',
    walletDisconnected: 'Wallet not connected',
    creatorProfileAfterFirstPublish: 'Creator profile appears after the first Maker publication',
    creatorProfileObject: 'Creator profile {address}',
    creatorProfileCreatedOnPublish: 'Creator profile will be created on first publication',
    accountGuest: 'Animacraft user',
    continueMakerSession: 'Continue the selected Maker session',
    choosePublishedMaker: 'Choose a published Maker from Templates first',
    openExactPlayer: 'Open the exact player editor',
    uploadStyleBeforePreview: 'Upload at least one Style PNG before previewing',
    treasuryLoadingSui: 'Loading Treasury balance from Sui…',
    treasuryUnavailable: 'The linked Maker Treasury could not be loaded.',
    syncingMakers: 'Syncing Makers…',
    refreshMakers: 'Refresh Makers',
    networkLabel: 'Network',
    packageLabel: 'Package',
    walrusLabel: 'Walrus',
    signerLabel: 'Signer',
    publishPackageFirstShort: 'Publish package first',
    epochRetention: '{count}-epoch retention',
    configureUploadRelay: 'Configure upload relay',
    signerConnected: 'Connected',
    signerConnectWallet: 'Connect wallet',
    movePackageMissing: 'The Move package is not configured yet.',
    previewMintLocked: 'This template is a preview. Minting unlocks after its published Sui Maker and Walrus manifest are loaded.',
    makerMintClosed: 'This Maker is not accepting new Soul authorizations.',
    paidTreasuryMissing: 'This paid Maker is missing its on-chain Treasury reference.',
    connectMintWallet: 'Connect a Sui wallet to mint this OC.',
    soulidityPackageMissing: 'Configure the Soulidity package before enabling canonical Soul minting.',
    canonicalMintGateClosed: 'Canonical Soul minting is unavailable until the reviewed Soulidity adapter release gate is enabled.',
    mintNextStep: 'Prepare and certify the OC package, then continue to Soulidity for the canonical Soul mint.',
    retryUpload: 'Retry upload',
    registerUpload: 'Register & upload',
    preparingHandoff: 'Preparing handoff…',
    ocRenderingQuilt: 'Rendering the OC and encoding one Walrus quilt…',
    ocQuiltEncoded: 'OC quilt encoded. Register it on Walrus Mainnet.',
    ocQuiltPrepareFailed: 'Could not prepare the OC quilt.',
    completeOcBeforePublishing: 'Complete this OC again before publishing so its latest profile, recipe, and Soul documents are frozen into the release.',
    ocWaitingUpload: 'Waiting for the registration signature, then uploading the OC quilt…',
    ocUnexpectedQuilt: 'Walrus returned an unexpected OC quilt result.',
    ocRecoveredCertified: 'The recovered OC quilt is certified. Continue to Soulidity for the canonical mint.',
    ocUploadedCertify: 'OC quilt uploaded. Certify it with one more signature.',
    ocUploadFailed: 'OC registration or upload failed.',
    ocWaitingCertification: 'Waiting for the Walrus certification signature…',
    ocFilesCertified: 'OC files certified. Continue to Soulidity for the canonical Soul mint.',
    ocCertificationFailed: 'OC certification failed.',
    transparentStylePng: '{name} contains no visible pixels. Use an optional Part for “None” instead of an empty PNG.',
    pngVerificationFailed: 'Could not verify every published Style PNG. Re-import the affected PNG and try again.',
    soulHandoffPreparing: 'Preparing the canonical Soulidity handoff…',
    canonicalMintDisabled: 'Canonical Soul minting is not activated for this release.',
    ocChangedAfterUpload: 'The OC profile or recipe changed after upload. Prepare a new mint quilt.',
    soulHandoffComplete: 'Soulidity opened and the recovery handoff was downloaded. The integration creates one canonical Soul.',
    soulHandoffFailed: 'Soulidity handoff failed.',
    restoringOcUpload: 'Restoring the saved OC upload checkpoint…',
    makerAssetUnavailable: '{name} is no longer available. Select the PNG files again.',
    unexpectedMakerQuilt: 'Walrus returned an unexpected number of Maker quilt files.',
    expansionNoLongerCompatible: 'An embedded Expansion Pack is no longer compatible with this Maker version.',
    ruleAssetMismatch: 'Every rule must reference a Part with uploaded PNG Items.',
    makerPublishedPartial: 'Published. The versioned Walrus manifest keeps the full Maker graph, while Sui stores its complete v2 authorization and color projection for recipe verification.',
    makerPublishedIndexing: 'Published on Sui. The object ID is still indexing, so this browser is retaining the recovery draft.',
    archiveWaiting: 'Waiting for your Sui signature to archive this Maker…',
    restoreWaiting: 'Waiting for your Sui signature to restore this Maker…',
    archivedOnNetwork: 'Archived on {network}: {digest}',
    restoredOnNetwork: 'Restored on {network}: {digest}',
    archiveMakerFailed: 'Could not archive this Maker.',
    restoreMakerFailed: 'Could not restore this Maker.',
    makerRestoredAt: 'Maker workspace restored · {time}',
    makerRestored: 'Maker workspace restored',
    makerVersionChanged: 'Maker version changed. Prepare a fresh Walrus quilt before publication.',
    makerAutosaved: 'Maker autosaved',
    makerSaved: 'Maker saved',
    makerWorkspaceRestoreFailed: 'The Maker workspace could not be restored.',
    currentRulesInvalid: 'The current Maker rules could not produce a valid OC.',
    creatorAssetImportFailed: 'The selected Maker asset could not be imported.',
    ocDraftLocalFailed: 'The OC draft could not be saved locally.',
    makerSettingsFirstPublish: 'These settings will be included when this Maker is first published.',
    makerAdminOwnerRequired: 'Connect the wallet that currently owns this MakerAdminCap.',
    paidMintReleaseGated: 'Paid mint remains release-gated. Disable the fee before updating this Maker.',
    validMintPriceRequired: 'Enter a valid {symbol} mint price.',
    adminSignatureWaiting: 'Waiting for the MakerAdminCap owner signature…',
    onchainSettingsUpdated: 'On-chain settings updated: {digest}',
    onchainSettingsFailed: 'The on-chain settings update failed.',
    makerTreasuryRequired: 'A published Maker, its Treasury, and its MakerAdminCap are required.',
    validWithdrawalRequired: 'Enter a valid {symbol} withdrawal amount.',
    revenueWithdrawn: '{amount} {symbol} withdrawn: {digest}',
    treasuryWithdrawalFailed: 'The Treasury withdrawal failed.',
  },
  zh: {
    walletConnectedAs: '钱包已连接：{address}', walletDisconnected: '钱包未连接', creatorProfileAfterFirstPublish: '首次发布 Maker 后会显示创作者资料', creatorProfileObject: '创作者资料 {address}', creatorProfileCreatedOnPublish: '首次发布时会创建创作者资料', accountGuest: 'Animacraft 用户', continueMakerSession: '继续当前选中的 Maker 会话', choosePublishedMaker: '请先从模板广场选择已发布的 Maker', openExactPlayer: '打开真实玩家编辑器', uploadStyleBeforePreview: '请至少上传一个样式 PNG 后再预览',
    treasuryLoadingSui: '正在从 Sui 读取 Treasury 余额…', treasuryUnavailable: '无法读取关联的 Maker Treasury。', syncingMakers: '正在同步 Maker…', refreshMakers: '刷新 Maker', networkLabel: '网络', packageLabel: '合约包', walrusLabel: 'Walrus', signerLabel: '签名钱包', publishPackageFirstShort: '请先发布合约包', epochRetention: '保留 {count} 个 epoch', configureUploadRelay: '请配置上传中继', signerConnected: '已连接', signerConnectWallet: '连接钱包',
    movePackageMissing: '尚未配置 Move 合约包。', previewMintLocked: '此模板仍是预览；载入已发布的 Sui Maker 和 Walrus 清单后才能铸造。', makerMintClosed: '此 Maker 当前不接受新的 Soul 授权。', paidTreasuryMissing: '此付费 Maker 缺少链上 Treasury 引用。', connectMintWallet: '请连接 Sui 钱包后铸造此 OC。', soulidityPackageMissing: '请先配置 Soulidity 合约包，再启用规范 Soul 铸造。', canonicalMintGateClosed: '经审核的 Soulidity 适配器发布开关尚未启用，当前不能铸造规范 Soul。', mintNextStep: '请准备并认证 OC 包，然后前往 Soulidity 铸造唯一的规范 Soul。', retryUpload: '重试上传', registerUpload: '注册并上传', preparingHandoff: '正在准备交接…',
    ocRenderingQuilt: '正在渲染 OC 并编码为一个 Walrus Quilt…', ocQuiltEncoded: 'OC Quilt 已编码，请在 Walrus 主网上注册。', ocQuiltPrepareFailed: '无法准备 OC Quilt。', completeOcBeforePublishing: '请重新点击“完成 OC”，把最新的角色资料、组合配方与 Soul 文档冻结后再发布。', ocWaitingUpload: '正在等待注册签名，随后上传 OC Quilt…', ocUnexpectedQuilt: 'Walrus 返回的 OC Quilt 文件数量不正确。', ocRecoveredCertified: '恢复的 OC Quilt 已认证，可前往 Soulidity 进行规范铸造。', ocUploadedCertify: 'OC Quilt 已上传，请再签名一次完成认证。', ocUploadFailed: 'OC 注册或上传失败。', ocWaitingCertification: '正在等待 Walrus 认证签名…', ocFilesCertified: 'OC 文件已认证，可前往 Soulidity 铸造规范 Soul。', ocCertificationFailed: 'OC 认证失败。', transparentStylePng: '素材「{name}」没有任何可见像素。请用“可选部位”的未选择状态表示“无”，不要上传空 PNG。', pngVerificationFailed: '无法复检所有待发布的样式 PNG，请重新导入有问题的 PNG 后重试。', soulHandoffPreparing: '正在准备规范 Soulidity 交接…', canonicalMintDisabled: '此版本尚未启用规范 Soul 铸造。', ocChangedAfterUpload: '上传后 OC 资料或配方已变更，请重新准备铸造 Quilt。', soulHandoffComplete: '已打开 Soulidity 并下载恢复交接包；该集成只创建一个规范 Soul。', soulHandoffFailed: 'Soulidity 交接失败。', restoringOcUpload: '正在恢复已保存的 OC 上传检查点…',
    makerAssetUnavailable: '素材「{name}」已不可用，请重新选择 PNG。', unexpectedMakerQuilt: 'Walrus 返回的 Maker Quilt 文件数量不正确。', expansionNoLongerCompatible: '内嵌扩展包已不再兼容当前 Maker 版本。', ruleAssetMismatch: '每条规则都必须引用已有 PNG 部件的部位。', makerPublishedPartial: '已发布。版本化 Walrus 清单保存完整 Maker 图；Sui 保存完整的 v2 授权与颜色投影，用于验证配方。', makerPublishedIndexing: '已发布到 Sui。对象 ID 仍在建立索引，浏览器会暂时保留恢复草稿。', archiveWaiting: '正在等待你的 Sui 签名以归档此 Maker…', restoreWaiting: '正在等待你的 Sui 签名以恢复此 Maker…', archivedOnNetwork: '已在 {network} 归档：{digest}', restoredOnNetwork: '已在 {network} 恢复：{digest}', archiveMakerFailed: '无法归档此 Maker。', restoreMakerFailed: '无法恢复此 Maker。',
    makerRestoredAt: 'Maker 工作区已恢复 · {time}', makerRestored: 'Maker 工作区已恢复', makerVersionChanged: 'Maker 版本已变更，发布前请重新准备 Walrus Quilt。', makerAutosaved: 'Maker 已自动保存', makerSaved: 'Maker 已保存', makerWorkspaceRestoreFailed: '无法恢复 Maker 工作区。', currentRulesInvalid: '当前 Maker 规则无法生成有效 OC。', creatorAssetImportFailed: '无法导入所选 Maker 素材。', ocDraftLocalFailed: '无法在本地保存 OC 草稿。',
    makerSettingsFirstPublish: '这些设置会在首次发布 Maker 时写入。', makerAdminOwnerRequired: '请连接当前持有 MakerAdminCap 的钱包。', paidMintReleaseGated: '付费铸造仍受发布开关限制，请先关闭费用再更新。', validMintPriceRequired: '请输入有效的 {symbol} 铸造价格。', adminSignatureWaiting: '正在等待 MakerAdminCap 持有者签名…', onchainSettingsUpdated: '链上设置已更新：{digest}', onchainSettingsFailed: '链上设置更新失败。', makerTreasuryRequired: '需要已发布的 Maker、Treasury 和 MakerAdminCap。', validWithdrawalRequired: '请输入有效的 {symbol} 提现金额。', revenueWithdrawn: '已提取 {amount} {symbol}：{digest}', treasuryWithdrawalFailed: 'Treasury 提现失败。',
  },
  ja: {
    walletConnectedAs: 'ウォレット接続済み：{address}', walletDisconnected: 'ウォレット未接続', creatorProfileAfterFirstPublish: 'Maker の初回公開後にクリエイタープロフィールが表示されます', creatorProfileObject: 'クリエイタープロフィール {address}', creatorProfileCreatedOnPublish: '初回公開時にクリエイタープロフィールが作成されます', accountGuest: 'Animacraft ユーザー', continueMakerSession: '選択中の Maker セッションを続ける', choosePublishedMaker: '先にテンプレートから公開済み Maker を選択してください', openExactPlayer: '実際のプレイヤーエディターを開く', uploadStyleBeforePreview: 'プレビュー前にスタイル PNG を1枚以上追加してください',
    treasuryLoadingSui: 'Sui から Treasury 残高を読み込み中…', treasuryUnavailable: '関連付けられた Maker Treasury を読み込めません。', syncingMakers: 'Maker を同期中…', refreshMakers: 'Maker を更新', networkLabel: 'ネットワーク', packageLabel: 'パッケージ', walrusLabel: 'Walrus', signerLabel: '署名者', publishPackageFirstShort: '先にパッケージを公開', epochRetention: '{count} epoch 保持', configureUploadRelay: 'アップロードリレーを設定', signerConnected: '接続済み', signerConnectWallet: 'ウォレット接続',
    movePackageMissing: 'Move パッケージが未設定です。', previewMintLocked: 'このテンプレートはプレビューです。公開済み Sui Maker と Walrus マニフェストの読み込み後にミントできます。', makerMintClosed: 'この Maker は新しい Soul 承認を受け付けていません。', paidTreasuryMissing: 'この有料 Maker にはオンチェーン Treasury の参照がありません。', connectMintWallet: 'この OC をミントするには Sui ウォレットを接続してください。', soulidityPackageMissing: '正規 Soul ミントを有効にする前に Soulidity パッケージを設定してください。', canonicalMintGateClosed: '審査済み Soulidity アダプターの公開ゲートが有効になるまで正規 Soul はミントできません。', mintNextStep: 'OC パッケージを準備・認証し、Soulidity で正規 Soul をミントしてください。', retryUpload: 'アップロード再試行', registerUpload: '登録してアップロード', preparingHandoff: '連携を準備中…',
    ocRenderingQuilt: 'OC を描画し、1つの Walrus Quilt にエンコード中…', ocQuiltEncoded: 'OC Quilt をエンコードしました。Walrus Mainnet に登録してください。', ocQuiltPrepareFailed: 'OC Quilt を準備できませんでした。', completeOcBeforePublishing: '最新のプロフィール、レシピ、Soul 文書を固定するため、公開前にもう一度「OC を完成」を実行してください。', ocWaitingUpload: '登録署名を待機し、その後 OC Quilt をアップロードします…', ocUnexpectedQuilt: 'Walrus から予期しない OC Quilt 結果が返されました。', ocRecoveredCertified: '復旧した OC Quilt は認証済みです。Soulidity で正規ミントを続けてください。', ocUploadedCertify: 'OC Quilt をアップロードしました。もう一度署名して認証してください。', ocUploadFailed: 'OC の登録またはアップロードに失敗しました。', ocWaitingCertification: 'Walrus の認証署名を待機中…', ocFilesCertified: 'OC ファイルを認証しました。Soulidity で正規 Soul をミントしてください。', ocCertificationFailed: 'OC の認証に失敗しました。', transparentStylePng: '素材「{name}」に表示可能なピクセルがありません。「なし」は空 PNG ではなく任意パーツの未選択状態で表現してください。', pngVerificationFailed: '公開する全スタイル PNG を再検証できませんでした。該当 PNG を読み込み直して再試行してください。', soulHandoffPreparing: '正規 Soulidity 連携を準備中…', canonicalMintDisabled: 'このリリースでは正規 Soul ミントが有効ではありません。', ocChangedAfterUpload: 'アップロード後に OC プロフィールまたはレシピが変更されました。新しい Quilt を準備してください。', soulHandoffComplete: 'Soulidity を開き、復旧用連携パッケージをダウンロードしました。この連携は正規 Soul を1つだけ作成します。', soulHandoffFailed: 'Soulidity 連携に失敗しました。', restoringOcUpload: '保存済み OC アップロードのチェックポイントを復元中…',
    makerAssetUnavailable: '素材「{name}」は利用できません。PNG を選び直してください。', unexpectedMakerQuilt: 'Walrus から予期しない数の Maker Quilt ファイルが返されました。', expansionNoLongerCompatible: '埋め込み拡張パックは現在の Maker バージョンと互換性がありません。', ruleAssetMismatch: 'すべてのルールは PNG アイテムを持つパーツを参照する必要があります。', makerPublishedPartial: '公開しました。バージョン付き Walrus マニフェストが完全な Maker グラフを保持し、Sui はレシピ検証用の完全な v2 認可・色投影を保存します。', makerPublishedIndexing: 'Sui に公開しました。オブジェクト ID の索引中は復旧下書きをブラウザに保持します。', archiveWaiting: 'この Maker をアーカイブする Sui 署名を待機中…', restoreWaiting: 'この Maker を復元する Sui 署名を待機中…', archivedOnNetwork: '{network} でアーカイブ済み：{digest}', restoredOnNetwork: '{network} で復元済み：{digest}', archiveMakerFailed: 'この Maker をアーカイブできませんでした。', restoreMakerFailed: 'この Maker を復元できませんでした。',
    makerRestoredAt: 'Maker ワークスペースを復元しました · {time}', makerRestored: 'Maker ワークスペースを復元しました', makerVersionChanged: 'Maker バージョンが変更されました。公開前に新しい Walrus Quilt を準備してください。', makerAutosaved: 'Maker を自動保存しました', makerSaved: 'Maker を保存しました', makerWorkspaceRestoreFailed: 'Maker ワークスペースを復元できませんでした。', currentRulesInvalid: '現在の Maker ルールでは有効な OC を作成できません。', creatorAssetImportFailed: '選択した Maker 素材を読み込めませんでした。', ocDraftLocalFailed: 'OC 下書きをローカル保存できませんでした。',
    makerSettingsFirstPublish: 'この設定は Maker の初回公開時に反映されます。', makerAdminOwnerRequired: '現在 MakerAdminCap を所有するウォレットを接続してください。', paidMintReleaseGated: '有料ミントは公開ゲートで制限中です。更新前に料金を無効にしてください。', validMintPriceRequired: '有効な {symbol} ミント価格を入力してください。', adminSignatureWaiting: 'MakerAdminCap 所有者の署名を待機中…', onchainSettingsUpdated: 'オンチェーン設定を更新しました：{digest}', onchainSettingsFailed: 'オンチェーン設定の更新に失敗しました。', makerTreasuryRequired: '公開済み Maker、Treasury、MakerAdminCap が必要です。', validWithdrawalRequired: '有効な {symbol} 出金額を入力してください。', revenueWithdrawn: '{amount} {symbol} を出金しました：{digest}', treasuryWithdrawalFailed: 'Treasury からの出金に失敗しました。',
  },
  ko: {
    walletConnectedAs: '지갑 연결됨: {address}', walletDisconnected: '지갑 연결 안 됨', creatorProfileAfterFirstPublish: 'Maker를 처음 게시하면 크리에이터 프로필이 표시됩니다', creatorProfileObject: '크리에이터 프로필 {address}', creatorProfileCreatedOnPublish: '처음 게시할 때 크리에이터 프로필이 생성됩니다', accountGuest: 'Animacraft 사용자', continueMakerSession: '선택한 Maker 세션 계속', choosePublishedMaker: '먼저 템플릿에서 게시된 Maker를 선택하세요', openExactPlayer: '실제 플레이어 편집기 열기', uploadStyleBeforePreview: '미리보기 전에 스타일 PNG를 하나 이상 업로드하세요',
    treasuryLoadingSui: 'Sui에서 Treasury 잔액 불러오는 중…', treasuryUnavailable: '연결된 Maker Treasury를 불러올 수 없습니다.', syncingMakers: 'Maker 동기화 중…', refreshMakers: 'Maker 새로고침', networkLabel: '네트워크', packageLabel: '패키지', walrusLabel: 'Walrus', signerLabel: '서명자', publishPackageFirstShort: '먼저 패키지 게시', epochRetention: '{count} epoch 보관', configureUploadRelay: '업로드 릴레이 설정', signerConnected: '연결됨', signerConnectWallet: '지갑 연결',
    movePackageMissing: 'Move 패키지가 설정되지 않았습니다.', previewMintLocked: '이 템플릿은 미리보기입니다. 게시된 Sui Maker와 Walrus 매니페스트를 불러오면 민팅할 수 있습니다.', makerMintClosed: '이 Maker는 새 Soul 승인을 받지 않습니다.', paidTreasuryMissing: '유료 Maker에 온체인 Treasury 참조가 없습니다.', connectMintWallet: '이 OC를 민팅하려면 Sui 지갑을 연결하세요.', soulidityPackageMissing: '정식 Soul 민팅을 활성화하기 전에 Soulidity 패키지를 설정하세요.', canonicalMintGateClosed: '검토된 Soulidity 어댑터 릴리스 게이트가 활성화될 때까지 정식 Soul을 민팅할 수 없습니다.', mintNextStep: 'OC 패키지를 준비하고 인증한 뒤 Soulidity에서 정식 Soul을 민팅하세요.', retryUpload: '업로드 재시도', registerUpload: '등록 및 업로드', preparingHandoff: '연동 준비 중…',
    ocRenderingQuilt: 'OC를 렌더링하고 하나의 Walrus Quilt로 인코딩 중…', ocQuiltEncoded: 'OC Quilt 인코딩 완료. Walrus Mainnet에 등록하세요.', ocQuiltPrepareFailed: 'OC Quilt를 준비하지 못했습니다.', completeOcBeforePublishing: '최신 프로필, 레시피와 Soul 문서를 고정하려면 게시 전에 “OC 완성”을 다시 실행하세요.', ocWaitingUpload: '등록 서명을 기다린 뒤 OC Quilt를 업로드합니다…', ocUnexpectedQuilt: 'Walrus가 예상하지 못한 OC Quilt 결과를 반환했습니다.', ocRecoveredCertified: '복구된 OC Quilt가 인증되었습니다. Soulidity에서 정식 민팅을 계속하세요.', ocUploadedCertify: 'OC Quilt 업로드 완료. 한 번 더 서명해 인증하세요.', ocUploadFailed: 'OC 등록 또는 업로드에 실패했습니다.', ocWaitingCertification: 'Walrus 인증 서명을 기다리는 중…', ocFilesCertified: 'OC 파일 인증 완료. Soulidity에서 정식 Soul을 민팅하세요.', ocCertificationFailed: 'OC 인증에 실패했습니다.', transparentStylePng: '에셋 “{name}”에 보이는 픽셀이 없습니다. 빈 PNG 대신 선택 파트의 미선택 상태로 “없음”을 표현하세요.', pngVerificationFailed: '게시할 모든 스타일 PNG를 다시 확인하지 못했습니다. 문제가 있는 PNG를 다시 가져온 뒤 재시도하세요.', soulHandoffPreparing: '정식 Soulidity 연동 준비 중…', canonicalMintDisabled: '이 릴리스에서는 정식 Soul 민팅이 활성화되지 않았습니다.', ocChangedAfterUpload: '업로드 후 OC 프로필 또는 레시피가 변경되었습니다. 새 Quilt를 준비하세요.', soulHandoffComplete: 'Soulidity를 열고 복구 연동 패키지를 다운로드했습니다. 이 연동은 정식 Soul 하나만 생성합니다.', soulHandoffFailed: 'Soulidity 연동에 실패했습니다.', restoringOcUpload: '저장된 OC 업로드 체크포인트 복원 중…',
    makerAssetUnavailable: '에셋 “{name}”을(를) 더 이상 사용할 수 없습니다. PNG를 다시 선택하세요.', unexpectedMakerQuilt: 'Walrus가 예상하지 못한 수의 Maker Quilt 파일을 반환했습니다.', expansionNoLongerCompatible: '포함된 확장 팩이 현재 Maker 버전과 더 이상 호환되지 않습니다.', ruleAssetMismatch: '모든 규칙은 PNG 아이템이 업로드된 파트를 참조해야 합니다.', makerPublishedPartial: '게시되었습니다. 버전이 지정된 Walrus 매니페스트는 전체 Maker 그래프를 보관하고 Sui는 레시피 검증용 완전한 v2 승인 및 색상 투영을 저장합니다.', makerPublishedIndexing: 'Sui에 게시되었습니다. 오브젝트 ID 인덱싱 중에는 복구 초안을 브라우저에 유지합니다.', archiveWaiting: '이 Maker를 보관하기 위한 Sui 서명을 기다리는 중…', restoreWaiting: '이 Maker를 복원하기 위한 Sui 서명을 기다리는 중…', archivedOnNetwork: '{network}에 보관됨: {digest}', restoredOnNetwork: '{network}에 복원됨: {digest}', archiveMakerFailed: '이 Maker를 보관하지 못했습니다.', restoreMakerFailed: '이 Maker를 복원하지 못했습니다.',
    makerRestoredAt: 'Maker 작업 공간 복원됨 · {time}', makerRestored: 'Maker 작업 공간 복원됨', makerVersionChanged: 'Maker 버전이 변경되었습니다. 게시 전에 새 Walrus Quilt를 준비하세요.', makerAutosaved: 'Maker 자동 저장됨', makerSaved: 'Maker 저장됨', makerWorkspaceRestoreFailed: 'Maker 작업 공간을 복원하지 못했습니다.', currentRulesInvalid: '현재 Maker 규칙으로 유효한 OC를 만들 수 없습니다.', creatorAssetImportFailed: '선택한 Maker 에셋을 가져오지 못했습니다.', ocDraftLocalFailed: 'OC 초안을 로컬에 저장하지 못했습니다.',
    makerSettingsFirstPublish: '이 설정은 Maker를 처음 게시할 때 반영됩니다.', makerAdminOwnerRequired: '현재 MakerAdminCap을 소유한 지갑을 연결하세요.', paidMintReleaseGated: '유료 민팅은 릴리스 게이트로 제한됩니다. 업데이트 전에 수수료를 끄세요.', validMintPriceRequired: '유효한 {symbol} 민팅 가격을 입력하세요.', adminSignatureWaiting: 'MakerAdminCap 소유자 서명을 기다리는 중…', onchainSettingsUpdated: '온체인 설정 업데이트됨: {digest}', onchainSettingsFailed: '온체인 설정 업데이트에 실패했습니다.', makerTreasuryRequired: '게시된 Maker, Treasury, MakerAdminCap이 필요합니다.', validWithdrawalRequired: '유효한 {symbol} 인출 금액을 입력하세요.', revenueWithdrawn: '{amount} {symbol} 인출됨: {digest}', treasuryWithdrawalFailed: 'Treasury 인출에 실패했습니다.',
  },
  vi: {
    walletConnectedAs: 'Đã kết nối ví: {address}', walletDisconnected: 'Chưa kết nối ví', creatorProfileAfterFirstPublish: 'Hồ sơ tác giả xuất hiện sau lần đăng Maker đầu tiên', creatorProfileObject: 'Hồ sơ tác giả {address}', creatorProfileCreatedOnPublish: 'Hồ sơ tác giả sẽ được tạo ở lần đăng đầu tiên', accountGuest: 'Người dùng Animacraft', continueMakerSession: 'Tiếp tục phiên Maker đã chọn', choosePublishedMaker: 'Hãy chọn một Maker đã đăng trong Mẫu trước', openExactPlayer: 'Mở đúng trình chỉnh sửa người chơi', uploadStyleBeforePreview: 'Tải lên ít nhất một PNG Kiểu trước khi xem thử',
    treasuryLoadingSui: 'Đang tải số dư Treasury từ Sui…', treasuryUnavailable: 'Không thể tải Maker Treasury đã liên kết.', syncingMakers: 'Đang đồng bộ Maker…', refreshMakers: 'Làm mới Maker', networkLabel: 'Mạng', packageLabel: 'Gói', walrusLabel: 'Walrus', signerLabel: 'Ví ký', publishPackageFirstShort: 'Đăng gói trước', epochRetention: 'Lưu {count} epoch', configureUploadRelay: 'Cấu hình relay tải lên', signerConnected: 'Đã kết nối', signerConnectWallet: 'Kết nối ví',
    movePackageMissing: 'Chưa cấu hình gói Move.', previewMintLocked: 'Mẫu này đang ở chế độ xem trước. Có thể mint sau khi tải Maker Sui đã đăng và Manifest Walrus.', makerMintClosed: 'Maker này không nhận thêm phê duyệt Soul.', paidTreasuryMissing: 'Maker trả phí này thiếu tham chiếu Treasury on-chain.', connectMintWallet: 'Kết nối ví Sui để mint OC này.', soulidityPackageMissing: 'Cấu hình gói Soulidity trước khi bật mint Soul chuẩn.', canonicalMintGateClosed: 'Chưa thể mint Soul chuẩn cho đến khi bật cổng phát hành của bộ điều hợp Soulidity đã duyệt.', mintNextStep: 'Chuẩn bị và chứng nhận gói OC, rồi tiếp tục tới Soulidity để mint Soul chuẩn.', retryUpload: 'Thử tải lại', registerUpload: 'Đăng ký & tải lên', preparingHandoff: 'Đang chuẩn bị chuyển giao…',
    ocRenderingQuilt: 'Đang kết xuất OC và mã hóa thành một Walrus Quilt…', ocQuiltEncoded: 'Đã mã hóa OC Quilt. Hãy đăng ký trên Walrus Mainnet.', ocQuiltPrepareFailed: 'Không thể chuẩn bị OC Quilt.', completeOcBeforePublishing: 'Hãy hoàn tất OC lại trước khi đăng để cố định hồ sơ, công thức và tài liệu Soul mới nhất.', ocWaitingUpload: 'Đang chờ chữ ký đăng ký rồi tải OC Quilt lên…', ocUnexpectedQuilt: 'Walrus trả về kết quả OC Quilt không đúng.', ocRecoveredCertified: 'OC Quilt khôi phục đã được chứng nhận. Tiếp tục tới Soulidity để mint chuẩn.', ocUploadedCertify: 'OC Quilt đã tải lên. Ký thêm một lần để chứng nhận.', ocUploadFailed: 'Đăng ký hoặc tải OC thất bại.', ocWaitingCertification: 'Đang chờ chữ ký chứng nhận Walrus…', ocFilesCertified: 'Tệp OC đã chứng nhận. Tiếp tục tới Soulidity để mint Soul chuẩn.', ocCertificationFailed: 'Chứng nhận OC thất bại.', transparentStylePng: 'Tài nguyên “{name}” không có pixel nào hiển thị. Hãy dùng trạng thái không chọn của Bộ phận tùy chọn cho “Không có”, thay vì PNG rỗng.', pngVerificationFailed: 'Không thể xác minh lại mọi PNG Kiểu sẽ đăng. Hãy nhập lại PNG bị lỗi rồi thử lại.', soulHandoffPreparing: 'Đang chuẩn bị chuyển giao Soulidity chuẩn…', canonicalMintDisabled: 'Bản phát hành này chưa bật mint Soul chuẩn.', ocChangedAfterUpload: 'Hồ sơ hoặc công thức OC đã đổi sau khi tải lên. Hãy chuẩn bị Quilt mới.', soulHandoffComplete: 'Đã mở Soulidity và tải gói chuyển giao khôi phục. Tích hợp này chỉ tạo một Soul chuẩn.', soulHandoffFailed: 'Chuyển giao Soulidity thất bại.', restoringOcUpload: 'Đang khôi phục điểm kiểm tra tải OC đã lưu…',
    makerAssetUnavailable: 'Tài nguyên “{name}” không còn khả dụng. Hãy chọn lại PNG.', unexpectedMakerQuilt: 'Walrus trả về số lượng tệp Maker Quilt không đúng.', expansionNoLongerCompatible: 'Gói mở rộng nhúng không còn tương thích với phiên bản Maker này.', ruleAssetMismatch: 'Mỗi quy tắc phải tham chiếu Bộ phận có Vật phẩm PNG đã tải lên.', makerPublishedPartial: 'Đã đăng. Manifest Walrus theo phiên bản giữ toàn bộ đồ thị Maker; Sui lưu phép chiếu quyền và màu v2 đầy đủ để xác minh công thức.', makerPublishedIndexing: 'Đã đăng lên Sui. ID đối tượng đang được lập chỉ mục nên trình duyệt vẫn giữ bản nháp khôi phục.', archiveWaiting: 'Đang chờ chữ ký Sui để lưu trữ Maker này…', restoreWaiting: 'Đang chờ chữ ký Sui để khôi phục Maker này…', archivedOnNetwork: 'Đã lưu trữ trên {network}: {digest}', restoredOnNetwork: 'Đã khôi phục trên {network}: {digest}', archiveMakerFailed: 'Không thể lưu trữ Maker này.', restoreMakerFailed: 'Không thể khôi phục Maker này.',
    makerRestoredAt: 'Đã khôi phục không gian Maker · {time}', makerRestored: 'Đã khôi phục không gian Maker', makerVersionChanged: 'Phiên bản Maker đã đổi. Hãy chuẩn bị Walrus Quilt mới trước khi đăng.', makerAutosaved: 'Maker đã tự lưu', makerSaved: 'Maker đã lưu', makerWorkspaceRestoreFailed: 'Không thể khôi phục không gian Maker.', currentRulesInvalid: 'Quy tắc Maker hiện tại không thể tạo OC hợp lệ.', creatorAssetImportFailed: 'Không thể nhập tài nguyên Maker đã chọn.', ocDraftLocalFailed: 'Không thể lưu cục bộ bản nháp OC.',
    makerSettingsFirstPublish: 'Các cài đặt này sẽ được ghi khi Maker được đăng lần đầu.', makerAdminOwnerRequired: 'Kết nối ví hiện đang sở hữu MakerAdminCap.', paidMintReleaseGated: 'Mint trả phí vẫn bị khóa theo bản phát hành. Hãy tắt phí trước khi cập nhật.', validMintPriceRequired: 'Nhập giá mint {symbol} hợp lệ.', adminSignatureWaiting: 'Đang chờ chữ ký của chủ MakerAdminCap…', onchainSettingsUpdated: 'Đã cập nhật cài đặt on-chain: {digest}', onchainSettingsFailed: 'Cập nhật cài đặt on-chain thất bại.', makerTreasuryRequired: 'Cần Maker đã đăng, Treasury và MakerAdminCap.', validWithdrawalRequired: 'Nhập số tiền rút {symbol} hợp lệ.', revenueWithdrawn: 'Đã rút {amount} {symbol}: {digest}', treasuryWithdrawalFailed: 'Rút tiền từ Treasury thất bại.',
  },
};

Object.entries(productionRuntimeI18n).forEach(([locale, details]) => Object.assign(i18n[locale], details));

const archiveConfirmationI18n = {
  en: {
    archiveMakerTitle: 'Archive published Maker?',
    archiveMakerCopy: 'New Soul authorizations will be blocked on Sui. Existing Souls, license snapshots, provenance, and Walrus records remain intact. You can restore the Maker later.',
    archiveMakerConfirm: 'Archive Maker',
  },
  zh: {
    archiveMakerTitle: '归档已发布的 Maker？',
    archiveMakerCopy: 'Sui 将停止新的 Soul 授权；现有 Soul、授权快照、来源记录和 Walrus 数据均保持有效，之后仍可恢复此 Maker。',
    archiveMakerConfirm: '归档 Maker',
  },
  ja: {
    archiveMakerTitle: '公開済み Maker をアーカイブしますか？',
    archiveMakerCopy: 'Sui 上の新しい Soul 承認を停止します。既存 Soul、ライセンスのスナップショット、来歴、Walrus 記録は維持され、後から Maker を復元できます。',
    archiveMakerConfirm: 'Maker をアーカイブ',
  },
  ko: {
    archiveMakerTitle: '게시된 Maker를 보관할까요?',
    archiveMakerCopy: 'Sui의 새 Soul 승인이 중지됩니다. 기존 Soul, 라이선스 스냅샷, 출처, Walrus 기록은 유지되며 나중에 Maker를 복원할 수 있습니다.',
    archiveMakerConfirm: 'Maker 보관',
  },
  vi: {
    archiveMakerTitle: 'Lưu trữ Maker đã đăng?',
    archiveMakerCopy: 'Sui sẽ chặn phê duyệt Soul mới. Soul hiện có, ảnh chụp giấy phép, nguồn gốc và bản ghi Walrus vẫn nguyên vẹn; bạn có thể khôi phục Maker sau.',
    archiveMakerConfirm: 'Lưu trữ Maker',
  },
};

Object.entries(archiveConfirmationI18n).forEach(([locale, details]) => Object.assign(i18n[locale], details));

const productionSurfaceI18n = {
  en: {
    walletConnectionFailed: 'Wallet connection failed.',
    chainNetworkNote: 'Sui network used by wallet transactions.',
    chainWalletLabel: 'Wallet',
    chainWalletNotConnected: 'Not connected',
    chainWalletReady: 'Ready to sign Creator and OC transactions.',
    chainWalletNeedConnect: 'Connect before publishing or minting.',
    chainPackageDraft: 'Draft package ID',
    chainPackageReady: 'Move package can be called from programmable transactions.',
    chainPackageNeedPublish: 'Publish the Move package, then configure its package ID.',
    walrusConfigured: '{network} upload configured',
    endpointMissing: 'Missing endpoint',
    walrusAssetNote: 'Assets are uploaded before their blob IDs are committed to the Maker transaction.',
    discoveryLabel: 'Discovery',
    discoverySyncing: 'Syncing Makers',
    chainDerived: 'Chain-derived',
    waiting: 'Waiting',
    discoveryReadyNote: 'Published Makers are discovered from Sui events and restored from certified Walrus manifests.',
    discoverySetupNote: 'Configure the published package ID to enable the public on-chain Maker gallery.',
    finishedCharactersSoulidity: 'Finished characters are Soulidity Souls, not duplicate Animacraft tokens.',
    soulidityOwnsCharacterData: 'Your minted characters, Living Content, social identity, and marketplace activity live in Soulidity.',
    noPartsYet: 'No Parts yet',
    createFirstPartInMaker: 'Create the first Part in Character Maker.',
    noneOption: 'None',
    removeThisPart: 'Remove this Part',
    unavailableSelection: 'Unavailable while minting or with the current selection',
    useColor: 'Use {color}',
    anyItemInPart: 'Any Item in this Part',
    cannotCombineWithLabel: 'cannot combine with',
    sharesPaletteWith: 'shares palette with',
    removeRule: 'Remove rule',
    removePaletteLink: 'Remove palette link',
    noSelectionRules: 'No selection rules yet.',
    noLinkedPalettes: 'No linked palettes yet.',
  },
  zh: {
    walletConnectionFailed: '钱包连接失败。', chainNetworkNote: '钱包交易使用的 Sui 网络。', chainWalletLabel: '钱包', chainWalletNotConnected: '未连接', chainWalletReady: '可以签署创作者与 OC 交易。', chainWalletNeedConnect: '发布或铸造前请先连接。', chainPackageDraft: '草稿合约包 ID', chainPackageReady: 'Move 合约包可以在可编程交易中调用。', chainPackageNeedPublish: '请发布 Move 合约包并配置其 package ID。', walrusConfigured: '已配置 {network} 上传', endpointMissing: '缺少端点', walrusAssetNote: '素材先上传，随后才把 Blob ID 写入 Maker 交易。', discoveryLabel: '链上发现', discoverySyncing: '正在同步 Maker', chainDerived: '来自链上', waiting: '等待中', discoveryReadyNote: '通过 Sui 事件发现已发布 Maker，并从认证的 Walrus 清单恢复。', discoverySetupNote: '请配置已发布的合约包 ID，以启用公开链上 Maker 广场。', finishedCharactersSoulidity: '完成的角色是 Soulidity Soul，不会在 Animacraft 重复铸造代币。', soulidityOwnsCharacterData: '你铸造的角色、生命内容、社交身份与市场活动都保存在 Soulidity。', noPartsYet: '还没有部位', createFirstPartInMaker: '请先在角色创建器中创建第一个部位。', noneOption: '无', removeThisPart: '移除此部位', unavailableSelection: '铸造期间或与当前选择冲突时不可用', useColor: '使用颜色 {color}', anyItemInPart: '此部位中的任意部件', cannotCombineWithLabel: '不能同时选择', sharesPaletteWith: '联动配色', removeRule: '删除规则', removePaletteLink: '删除联动配色', noSelectionRules: '还没有组合规则。', noLinkedPalettes: '还没有联动配色。',
  },
  ja: {
    walletConnectionFailed: 'ウォレット接続に失敗しました。', chainNetworkNote: 'ウォレット取引で使用する Sui ネットワークです。', chainWalletLabel: 'ウォレット', chainWalletNotConnected: '未接続', chainWalletReady: '制作・OC 取引に署名できます。', chainWalletNeedConnect: '公開またはミント前に接続してください。', chainPackageDraft: '下書きパッケージ ID', chainPackageReady: 'Move パッケージをプログラマブル取引から呼び出せます。', chainPackageNeedPublish: 'Move パッケージを公開し、package ID を設定してください。', walrusConfigured: '{network} アップロード設定済み', endpointMissing: 'エンドポイント未設定', walrusAssetNote: '素材を先にアップロードし、Blob ID を Maker 取引へ記録します。', discoveryLabel: '検出', discoverySyncing: 'Maker を同期中', chainDerived: 'オンチェーン由来', waiting: '待機中', discoveryReadyNote: 'Sui イベントから公開 Maker を検出し、認証済み Walrus マニフェストから復元します。', discoverySetupNote: '公開パッケージ ID を設定してオンチェーン Maker 広場を有効にしてください。', finishedCharactersSoulidity: '完成キャラクターは Soulidity Soul であり、Animacraft で重複トークンを発行しません。', soulidityOwnsCharacterData: 'ミントしたキャラクター、Living Content、ソーシャル ID、マーケット活動は Soulidity に保存されます。', noPartsYet: 'パーツがありません', createFirstPartInMaker: 'キャラクターメーカーで最初のパーツを作成してください。', noneOption: 'なし', removeThisPart: 'このパーツを外す', unavailableSelection: 'ミント中または現在の選択との競合により利用不可', useColor: '{color} を使用', anyItemInPart: 'このパーツの任意アイテム', cannotCombineWithLabel: '同時選択不可', sharesPaletteWith: 'パレットを共有', removeRule: 'ルールを削除', removePaletteLink: 'パレット連携を削除', noSelectionRules: '選択ルールはありません。', noLinkedPalettes: '連携パレットはありません。',
  },
  ko: {
    walletConnectionFailed: '지갑 연결에 실패했습니다.', chainNetworkNote: '지갑 트랜잭션에 사용하는 Sui 네트워크입니다.', chainWalletLabel: '지갑', chainWalletNotConnected: '연결 안 됨', chainWalletReady: '크리에이터 및 OC 트랜잭션에 서명할 수 있습니다.', chainWalletNeedConnect: '게시 또는 민팅 전에 연결하세요.', chainPackageDraft: '초안 패키지 ID', chainPackageReady: 'Move 패키지를 프로그래머블 트랜잭션에서 호출할 수 있습니다.', chainPackageNeedPublish: 'Move 패키지를 게시하고 package ID를 설정하세요.', walrusConfigured: '{network} 업로드 설정됨', endpointMissing: '엔드포인트 없음', walrusAssetNote: '에셋을 먼저 업로드한 뒤 Blob ID를 Maker 트랜잭션에 기록합니다.', discoveryLabel: '검색', discoverySyncing: 'Maker 동기화 중', chainDerived: '온체인 기반', waiting: '대기 중', discoveryReadyNote: 'Sui 이벤트에서 게시된 Maker를 찾고 인증된 Walrus 매니페스트에서 복원합니다.', discoverySetupNote: '게시된 패키지 ID를 설정해 공개 온체인 Maker 갤러리를 활성화하세요.', finishedCharactersSoulidity: '완성 캐릭터는 Soulidity Soul이며 Animacraft 토큰으로 중복 민팅되지 않습니다.', soulidityOwnsCharacterData: '민팅한 캐릭터, Living Content, 소셜 정체성과 마켓 활동은 Soulidity에 보관됩니다.', noPartsYet: '파트 없음', createFirstPartInMaker: '캐릭터 메이커에서 첫 파트를 만드세요.', noneOption: '없음', removeThisPart: '이 파트 제거', unavailableSelection: '민팅 중이거나 현재 선택과 충돌하여 사용할 수 없음', useColor: '{color} 사용', anyItemInPart: '이 파트의 모든 아이템', cannotCombineWithLabel: '함께 선택 불가', sharesPaletteWith: '팔레트 공유', removeRule: '규칙 삭제', removePaletteLink: '팔레트 연결 삭제', noSelectionRules: '선택 규칙이 없습니다.', noLinkedPalettes: '연결된 팔레트가 없습니다.',
  },
  vi: {
    walletConnectionFailed: 'Kết nối ví thất bại.', chainNetworkNote: 'Mạng Sui dùng cho giao dịch của ví.', chainWalletLabel: 'Ví', chainWalletNotConnected: 'Chưa kết nối', chainWalletReady: 'Sẵn sàng ký giao dịch tác giả và OC.', chainWalletNeedConnect: 'Kết nối trước khi đăng hoặc mint.', chainPackageDraft: 'ID gói nháp', chainPackageReady: 'Có thể gọi gói Move từ giao dịch lập trình.', chainPackageNeedPublish: 'Đăng gói Move rồi cấu hình package ID.', walrusConfigured: 'Đã cấu hình tải lên {network}', endpointMissing: 'Thiếu endpoint', walrusAssetNote: 'Tài nguyên được tải lên trước khi ghi Blob ID vào giao dịch Maker.', discoveryLabel: 'Khám phá', discoverySyncing: 'Đang đồng bộ Maker', chainDerived: 'Từ on-chain', waiting: 'Đang chờ', discoveryReadyNote: 'Maker đã đăng được tìm từ sự kiện Sui và khôi phục từ Manifest Walrus đã chứng nhận.', discoverySetupNote: 'Cấu hình ID gói đã đăng để bật thư viện Maker on-chain công khai.', finishedCharactersSoulidity: 'Nhân vật hoàn tất là Soul của Soulidity, không phải token Animacraft trùng lặp.', soulidityOwnsCharacterData: 'Nhân vật đã mint, Living Content, danh tính xã hội và hoạt động thị trường nằm trong Soulidity.', noPartsYet: 'Chưa có Bộ phận', createFirstPartInMaker: 'Tạo Bộ phận đầu tiên trong Trình tạo nhân vật.', noneOption: 'Không', removeThisPart: 'Gỡ Bộ phận này', unavailableSelection: 'Không khả dụng khi đang mint hoặc với lựa chọn hiện tại', useColor: 'Dùng màu {color}', anyItemInPart: 'Vật phẩm bất kỳ trong Bộ phận này', cannotCombineWithLabel: 'không thể chọn cùng', sharesPaletteWith: 'dùng chung bảng màu', removeRule: 'Xóa quy tắc', removePaletteLink: 'Xóa liên kết bảng màu', noSelectionRules: 'Chưa có quy tắc lựa chọn.', noLinkedPalettes: 'Chưa có bảng màu liên kết.',
  },
};

Object.entries(productionSurfaceI18n).forEach(([locale, details]) => Object.assign(i18n[locale], details));

const productionErrorI18n = {
  en: {
    makerDiscoveryFailed: 'Could not load on-chain Makers.',
    makerVerificationFailed: '{count} on-chain Maker(s) could not be verified and loaded.',
    localLibraryRebuildFailed: 'The local Maker library could not be rebuilt.',
    localAssetsRestored: '{count} local asset(s) restored',
    localAssetsRestoreFailed: 'Local PNG assets could not be restored.',
    localAssetsSaved: '{count} local asset(s) saved in this browser',
    localDraftSaveFailed: 'The draft could not be saved locally.',
    makerDraftOwnerWalletRequired: 'Connect the wallet that owns this Maker draft before saving it.',
    unsavedDraftChanges: 'Unsaved changes',
    localPngSaveFailed: 'Could not save PNG assets in this browser.',
    requestedActionFailed: 'The requested action could not be completed.',
    certificationSyncing: 'Walrus certification succeeded. Waiting for the certified Blob state to sync…',
    ocCertificationSyncing: 'OC certification succeeded. Waiting for the certified Blob state to sync…',
  },
  zh: {
    makerDiscoveryFailed: '无法载入链上 Maker。',
    makerVerificationFailed: '有 {count} 个链上 Maker 未能通过验证并载入。',
    localLibraryRebuildFailed: '无法重建本地 Maker 模板库。',
    localAssetsRestored: '已恢复 {count} 个本地素材',
    localAssetsRestoreFailed: '无法恢复本地 PNG 素材。',
    localAssetsSaved: '已在此浏览器保存 {count} 个本地素材',
    localDraftSaveFailed: '无法在本地保存草稿。',
    makerDraftOwnerWalletRequired: '请连接拥有此 Maker 草稿的钱包后再保存。',
    unsavedDraftChanges: '有未保存的更改',
    localPngSaveFailed: '无法在此浏览器保存 PNG 素材。',
    requestedActionFailed: '无法完成所请求的操作。',
    certificationSyncing: 'Walrus 认证交易已成功，正在等待已认证 Blob 状态同步…',
    ocCertificationSyncing: 'OC 认证交易已成功，正在等待已认证 Blob 状态同步…',
  },
  ja: {
    makerDiscoveryFailed: 'オンチェーン Maker を読み込めませんでした。',
    makerVerificationFailed: '{count} 件のオンチェーン Maker を検証・読み込みできませんでした。',
    localLibraryRebuildFailed: 'ローカル Maker ライブラリを再構築できませんでした。',
    localAssetsRestored: 'ローカル素材 {count} 件を復元しました',
    localAssetsRestoreFailed: 'ローカル PNG 素材を復元できませんでした。',
    localAssetsSaved: 'このブラウザにローカル素材 {count} 件を保存しました',
    localDraftSaveFailed: '下書きをローカル保存できませんでした。',
    makerDraftOwnerWalletRequired: 'この Maker 下書きを所有するウォレットを接続してから保存してください。',
    unsavedDraftChanges: '未保存の変更があります',
    localPngSaveFailed: 'このブラウザに PNG 素材を保存できませんでした。',
    requestedActionFailed: '要求された操作を完了できませんでした。',
    certificationSyncing: 'Walrus の認証取引は成功しました。認証済み Blob 状態の同期を待っています…',
    ocCertificationSyncing: 'OC の認証取引は成功しました。認証済み Blob 状態の同期を待っています…',
  },
  ko: {
    makerDiscoveryFailed: '온체인 Maker를 불러오지 못했습니다.',
    makerVerificationFailed: '온체인 Maker {count}개를 검증하고 불러오지 못했습니다.',
    localLibraryRebuildFailed: '로컬 Maker 라이브러리를 다시 만들지 못했습니다.',
    localAssetsRestored: '로컬 에셋 {count}개 복원됨',
    localAssetsRestoreFailed: '로컬 PNG 에셋을 복원하지 못했습니다.',
    localAssetsSaved: '이 브라우저에 로컬 에셋 {count}개 저장됨',
    localDraftSaveFailed: '초안을 로컬에 저장하지 못했습니다.',
    makerDraftOwnerWalletRequired: '이 Maker 초안을 소유한 지갑을 연결한 뒤 저장하세요.',
    unsavedDraftChanges: '저장하지 않은 변경 사항',
    localPngSaveFailed: '이 브라우저에 PNG 에셋을 저장하지 못했습니다.',
    requestedActionFailed: '요청한 작업을 완료하지 못했습니다.',
    certificationSyncing: 'Walrus 인증 거래가 성공했습니다. 인증된 Blob 상태 동기화를 기다리는 중…',
    ocCertificationSyncing: 'OC 인증 거래가 성공했습니다. 인증된 Blob 상태 동기화를 기다리는 중…',
  },
  vi: {
    makerDiscoveryFailed: 'Không thể tải Maker on-chain.',
    makerVerificationFailed: 'Không thể xác minh và tải {count} Maker on-chain.',
    localLibraryRebuildFailed: 'Không thể dựng lại thư viện Maker cục bộ.',
    localAssetsRestored: 'Đã khôi phục {count} tài nguyên cục bộ',
    localAssetsRestoreFailed: 'Không thể khôi phục tài nguyên PNG cục bộ.',
    localAssetsSaved: 'Đã lưu {count} tài nguyên cục bộ trong trình duyệt này',
    localDraftSaveFailed: 'Không thể lưu bản nháp cục bộ.',
    makerDraftOwnerWalletRequired: 'Hãy kết nối ví sở hữu bản nháp Maker này trước khi lưu.',
    unsavedDraftChanges: 'Có thay đổi chưa lưu',
    localPngSaveFailed: 'Không thể lưu tài nguyên PNG trong trình duyệt này.',
    requestedActionFailed: 'Không thể hoàn tất thao tác được yêu cầu.',
    certificationSyncing: 'Giao dịch chứng nhận Walrus đã thành công. Đang chờ đồng bộ trạng thái Blob đã chứng nhận…',
    ocCertificationSyncing: 'Giao dịch chứng nhận OC đã thành công. Đang chờ đồng bộ trạng thái Blob đã chứng nhận…',
  },
};

Object.entries(productionErrorI18n).forEach(([locale, details]) => Object.assign(i18n[locale], details));

// Final production terminology pass. These labels appear across legacy shells,
// Creator Studio, Player Editor, recovery, and publication surfaces.
const productionTerminologyI18n = {
  en: {
    walletFirstCopy: 'After connecting, you can use My OCs, creator tools, draft saving, publication, and minting.',
    myPageCopy: 'Your work and on-chain OCs',
    templateHero: 'Choose an artist-made template, then make your OC',
    templateHeroCopy: 'Choose a Maker, combine Parts, and save the character with its recipe, license snapshot, provenance, and on-chain record.',
    searchPlaceholder: 'Search style, creator, license…',
    filterFantasy: 'Fantasy',
    filterDaily: 'Daily icon',
    sourceOnchain: 'On-chain Maker',
    noPublishedMakers: 'No Makers have been published on-chain yet',
    creatorStudio: 'Creator Studio',
    creatorStudioCopy: 'Create, test, and publish a Character Maker in one wallet workspace.',
    partsLabel: 'Parts',
    itemsLabel: 'Items',
    currentSlot: 'Current Part',
    choosePart: 'Choose a Part',
    exportManifest: 'Manifest',
    characterMaker: 'Character Maker',
    recipeJson: 'Recipe JSON',
    onchainPublish: 'On-chain Publish',
    royaltyPolicy: 'Royalty policy',
    rulesRecordCopy: 'Part, Item, color, order, selection, palette, and BCS recipe-hash integrity are enforced when a Soul is minted.',
    recipeIntegrityCopy: 'Required Parts, available Items, and combination rules are verified before authorization.',
    livingContent: 'Living Content',
    draftRecoveryWorkspaceV4: 'Legacy Workspace v4',
    draftRecoveryCreatorDrafts: 'Legacy Creator drafts',
    soulidityOwnsCharacterData: 'Your minted characters, Living Content, social identity, and marketplace activity live in Soulidity.',
  },
  zh: {
    walletFirstCopy: '连接后即可使用“我的 OC”、创作工具、草稿保存、发布与铸造。',
    myPageCopy: '你的作品与链上 OC',
    templateHero: '选择画师制作的模板，创作你的 OC',
    templateHeroCopy: '选择 Maker、组合部位，并连同配方、授权快照、来源与链上记录一起保存角色。',
    searchPlaceholder: '搜索风格、创作者或授权…',
    filterFantasy: '奇幻',
    filterDaily: '日常头像',
    sourceOnchain: '链上 Maker',
    noPublishedMakers: '链上还没有已发布的 Maker',
    creatorStudio: '创作者工作室',
    creatorStudioCopy: '在同一个钱包工作区中创建、试玩并发布角色 Maker。',
    partsLabel: '部位',
    itemsLabel: '部件',
    currentSlot: '当前部位',
    choosePart: '选择部位',
    exportManifest: '清单',
    characterMaker: '角色创建器',
    recipeJson: '配方 JSON',
    onchainPublish: '链上发布',
    royaltyPolicy: '版税政策',
    rulesRecordCopy: '部位、部件、颜色、顺序、组合、色板和 BCS 配方哈希在 Soul 铸造时强制验证。',
    recipeIntegrityCopy: '必选部位、可用部件和组合规则在授权前验证。',
    livingContent: '生命内容',
    draftRecoveryWorkspaceV4: '旧版工作区 v4',
    draftRecoveryCreatorDrafts: '旧版创作者草稿',
    soulidityOwnsCharacterData: '你铸造的角色、生命内容、社交身份与市场活动都保存在 Soulidity。',
  },
  ja: {
    walletFirstCopy: '接続後、マイ OC、制作ツール、下書き保存、公開、ミントを利用できます。',
    myPageCopy: '作品とオンチェーン OC',
    templateHero: 'アーティスト制作のテンプレートを選び、OC を作る',
    templateHeroCopy: 'Maker を選び、パーツを組み合わせ、レシピ、ライセンスのスナップショット、来歴、オンチェーン記録と共にキャラクターを保存します。',
    searchPlaceholder: 'スタイル、制作者、ライセンスを検索…',
    filterFantasy: 'ファンタジー',
    filterDaily: '日常アイコン',
    sourceOnchain: 'オンチェーン Maker',
    noPublishedMakers: 'オンチェーンに公開された Maker はまだありません',
    creatorStudio: 'クリエイタースタジオ',
    creatorStudioCopy: '1つのウォレット作業領域でキャラクターメーカーを作成、テスト、公開します。',
    partsLabel: 'パーツ',
    itemsLabel: 'アイテム',
    currentSlot: '現在のパーツ',
    choosePart: 'パーツを選択',
    exportManifest: 'マニフェスト',
    characterMaker: 'キャラクターメーカー',
    recipeJson: 'レシピ JSON',
    onchainPublish: 'オンチェーン公開',
    royaltyPolicy: 'ロイヤリティ方針',
    rulesRecordCopy: 'パーツ、アイテム、色、順序、選択、パレット、BCS レシピハッシュを Soul のミント時に検証します。',
    recipeIntegrityCopy: '必須パーツ、利用可能なアイテム、組み合わせ規則を認可前に検証します。',
    livingContent: 'リビングコンテンツ',
    draftRecoveryWorkspaceV4: '旧ワークスペース v4',
    draftRecoveryCreatorDrafts: '旧制作者下書き',
    soulidityOwnsCharacterData: 'ミントしたキャラクター、リビングコンテンツ、ソーシャル ID、マーケット活動は Soulidity に保存されます。',
  },
  ko: {
    walletFirstCopy: '지갑을 연결하면 내 OC, 창작 도구, 초안 저장, 게시, 민팅을 사용할 수 있습니다.',
    myPageCopy: '작품과 온체인 OC',
    templateHero: '작가가 만든 템플릿을 고르고 OC를 만드세요',
    templateHeroCopy: 'Maker를 선택하고 파트를 조합한 뒤 레시피, 라이선스 스냅샷, 출처, 온체인 기록과 함께 캐릭터를 저장합니다.',
    searchPlaceholder: '스타일, 제작자, 라이선스 검색…',
    filterFantasy: '판타지',
    filterDaily: '데일리 아이콘',
    sourceOnchain: '온체인 Maker',
    noPublishedMakers: '아직 온체인에 게시된 Maker가 없습니다',
    creatorStudio: '크리에이터 스튜디오',
    creatorStudioCopy: '하나의 지갑 작업공간에서 캐릭터 메이커를 만들고 테스트하고 게시합니다.',
    partsLabel: '파트',
    itemsLabel: '아이템',
    currentSlot: '현재 파트',
    choosePart: '파트 선택',
    exportManifest: '매니페스트',
    characterMaker: '캐릭터 메이커',
    recipeJson: '레시피 JSON',
    onchainPublish: '온체인 게시',
    royaltyPolicy: '로열티 정책',
    rulesRecordCopy: '파트, 아이템, 색상, 순서, 선택, 팔레트, BCS 레시피 해시를 Soul 민팅 시 검증합니다.',
    recipeIntegrityCopy: '필수 파트, 사용 가능한 아이템, 조합 규칙을 승인 전에 검증합니다.',
    livingContent: '리빙 콘텐츠',
    draftRecoveryWorkspaceV4: '이전 작업공간 v4',
    draftRecoveryCreatorDrafts: '이전 제작자 초안',
    soulidityOwnsCharacterData: '민팅한 캐릭터, 리빙 콘텐츠, 소셜 정체성과 마켓 활동은 Soulidity에 보관됩니다.',
  },
  vi: {
    walletFirstCopy: 'Sau khi kết nối ví, bạn có thể dùng OC của tôi, công cụ sáng tạo, lưu bản nháp, đăng và đúc.',
    myPageCopy: 'Tác phẩm và OC trên chuỗi',
    templateHero: 'Chọn mẫu của họa sĩ rồi tạo OC của bạn',
    templateHeroCopy: 'Chọn Maker, ghép các Bộ phận và lưu nhân vật cùng công thức, bản chụp giấy phép, nguồn gốc và bản ghi trên chuỗi.',
    searchPlaceholder: 'Tìm phong cách, tác giả hoặc giấy phép…',
    filterFantasy: 'Giả tưởng',
    filterDaily: 'Biểu tượng hằng ngày',
    sourceOnchain: 'Maker trên chuỗi',
    noPublishedMakers: 'Chưa có Maker nào được đăng trên chuỗi',
    creatorStudio: 'Xưởng sáng tạo',
    creatorStudioCopy: 'Tạo, thử nghiệm và đăng Trình tạo nhân vật trong một không gian làm việc của ví.',
    partsLabel: 'Bộ phận',
    itemsLabel: 'Vật phẩm',
    currentSlot: 'Bộ phận hiện tại',
    choosePart: 'Chọn Bộ phận',
    exportManifest: 'Bản kê khai',
    characterMaker: 'Trình tạo nhân vật',
    recipeJson: 'JSON công thức',
    onchainPublish: 'Đăng trên chuỗi',
    royaltyPolicy: 'Chính sách tiền bản quyền',
    rulesRecordCopy: 'Bộ phận, Vật phẩm, màu, thứ tự, lựa chọn, bảng màu và hàm băm công thức BCS được kiểm tra khi đúc Soul.',
    recipeIntegrityCopy: 'Bộ phận bắt buộc, Vật phẩm khả dụng và quy tắc kết hợp được kiểm tra trước khi phê duyệt.',
    livingContent: 'Nội dung sống',
    draftRecoveryWorkspaceV4: 'Không gian làm việc v4 cũ',
    draftRecoveryCreatorDrafts: 'Bản nháp tác giả cũ',
    soulidityOwnsCharacterData: 'Nhân vật đã đúc, Nội dung sống, danh tính xã hội và hoạt động thị trường nằm trong Soulidity.',
  },
};

Object.entries(productionTerminologyI18n).forEach(([locale, details]) => Object.assign(i18n[locale], details));

const productionPublicationRecoveryI18n = {
  en: {
    publicationIntentSaving: 'Saving the publication intent…',
    publicationIntentSaveFailed: 'The publication intent could not be saved safely. No wallet signature was requested.',
    publicationAlreadyRecovered: 'This Quilt was already published. The existing on-chain Maker was recovered without requesting another signature.',
    publicationSubmittedRecovering: 'The transaction was submitted. Recovering the on-chain Maker object…',
    makerPublicationFailed: 'Maker publication on Sui failed.',
    publicationPendingReview: 'An unresolved on-chain publication is still being recovered. Duplicate signatures are blocked.',
    reviewPendingPublication: 'Review pending publication',
    clearPendingPublicationTitle: 'Clear pending publication?',
    clearPendingPublicationMessage: 'Only clear this recovery record after confirming that the wallet rejected the request or that no transaction exists on-chain. Clearing it allows a new publication signature.',
    clearPendingPublicationConfirm: 'Clear and retry',
    discardUploadRecoveryTitle: 'Archive the old upload and prepare again?',
    discardMakerUploadRecoveryMessage: 'The current Maker no longer matches this saved Walrus upload. Animacraft will preserve a lightweight audit record, remove the obsolete local checkpoint, and let you prepare a new upload. This does not cancel any transaction already submitted.',
    discardOcUploadRecoveryMessage: 'The current OC no longer matches this saved Walrus upload. Animacraft will preserve a lightweight audit record, remove the obsolete local checkpoint, and let you prepare a new upload. This does not cancel any transaction already submitted.',
    discardUploadRecoveryConfirm: 'Archive and prepare again',
    uploadRecoveryDiscarded: 'The old upload was archived. Prepare a new upload from the current work.',
    makerIndexResolving: 'Published transaction found. Resolving the OCMaker object ID from Sui indexing…',
    makerIndexObjectMissing: 'The publication transaction is indexed, but its OCMaker object was not found.',
    makerIndexUnavailable: 'The OCMaker object ID is not available yet.',
    makerIndexRecoveryRetained: '{error} The recovery draft remains in this browser.',
    makerRecoveryDraftChanged: 'The draft changed after this Walrus checkpoint. Prepare a new upload from the current assets.',
    makerRecoveryCoverMissing: 'The saved Maker cover is missing from upload recovery.',
    makerRecoveryGraphMismatch: 'The Maker release graph no longer matches this Walrus checkpoint.',
    makerRecoveryAssetMissing: '{name} is missing from the local draft asset store.',
    makerRecoveryCertifiedMismatch: 'The certified Walrus Quilt no longer matches this Maker asset set.',
    makerRecoveryEncoded: 'Saved Walrus Quilt restored. Register and upload it with the same wallet.',
    makerRecoveryRegistered: 'Paid Walrus registration restored. Retry the relay upload without registering again.',
    makerRecoveryUploaded: 'Uploaded Walrus Quilt restored. Continue with certification.',
    makerRecoveryCertified: 'Certified Walrus Quilt restored. Continue with Sui Maker publication.',
    makerRecoveryRestored: 'Saved Walrus upload restored.',
    makerRecoveryFailed: 'Could not restore the saved Walrus upload.',
    ocFilesMissing: 'The rendered OC files are missing.',
    ocRecoveryMismatch: 'The current OC no longer matches the saved mint upload. Prepare a new OC Quilt.',
    ocRecoveryCertifiedMismatch: 'The certified OC Quilt no longer contains exactly two files.',
    ocRecoveryEncoded: 'Saved OC Quilt restored. Register and upload it with the same wallet.',
    ocRecoveryRegistered: 'Paid OC registration restored. Retry upload without registering again.',
    ocRecoveryUploaded: 'Uploaded OC Quilt restored. Continue with certification.',
    ocRecoveryCertified: 'Certified OC files restored. Continue with the Soulidity handoff.',
    ocRecoveryRestored: 'Saved OC upload restored.',
    ocRecoveryFailed: 'Could not restore the saved OC upload.',
    selectionRuleLimit: 'A Maker cannot contain more than {count} selection rules.',
    chooseDifferentRuleParts: 'Choose two different Parts for a selection rule.',
    makerPartLimit: 'A Maker cannot contain more than {count} Parts.',
    archivedMakerImmutable: 'This Maker is archived on Sui. Restore it before creating new OCs; its published version remains immutable.',
    publishedMakerImmutable: 'Published Makers are immutable. Create a new version to change Parts, Items, Layers, rules, or assets.',
  },
  zh: {
    publicationIntentSaving: '正在保存发布意图…',
    publicationIntentSaveFailed: '无法安全保存发布意图，未请求钱包签名。',
    publicationAlreadyRecovered: '检测到同一 Quilt 已发布；已恢复现有链上 Maker，未重复请求签名。',
    publicationSubmittedRecovering: '交易已提交，正在恢复链上 Maker 对象…',
    makerPublicationFailed: 'Maker 链上发布失败。',
    publicationPendingReview: '仍有一笔未确认的链上发布正在恢复中；为避免重复交易，已阻止再次签名。',
    reviewPendingPublication: '检查未决发布',
    clearPendingPublicationTitle: '清除未决发布记录？',
    clearPendingPublicationMessage: '只有在确认钱包已拒绝请求，或确认链上不存在该交易后，才可清除此恢复记录。清除后将允许重新请求发布签名。',
    clearPendingPublicationConfirm: '清除并重试',
    discardUploadRecoveryTitle: '归档旧上传并重新准备？',
    discardMakerUploadRecoveryMessage: '当前 Maker 已与这份 Walrus 上传不一致。Animacraft 会保留一条轻量审计记录、删除已过期的本地检查点，并允许你从当前内容重新准备。此操作不会取消已经提交的交易。',
    discardOcUploadRecoveryMessage: '当前 OC 已与这份 Walrus 上传不一致。Animacraft 会保留一条轻量审计记录、删除已过期的本地检查点，并允许你从当前内容重新准备。此操作不会取消已经提交的交易。',
    discardUploadRecoveryConfirm: '归档并重新准备',
    uploadRecoveryDiscarded: '旧上传已归档，请从当前内容重新准备上传。',
    makerIndexResolving: '已找到发布交易，正在等待 Sui 索引解析 OCMaker 对象 ID…',
    makerIndexObjectMissing: '发布交易已被索引，但未找到其中的 OCMaker 对象。',
    makerIndexUnavailable: 'OCMaker 对象 ID 暂时不可用。',
    makerIndexRecoveryRetained: '{error} 恢复草稿仍保留在此浏览器中。',
    makerRecoveryDraftChanged: '此 Walrus 检查点创建后草稿已变更，请用当前素材重新准备上传。',
    makerRecoveryCoverMissing: '上传恢复记录缺少已保存的 Maker 封面。',
    makerRecoveryGraphMismatch: 'Maker 发布图已不再与此 Walrus 检查点一致。',
    makerRecoveryAssetMissing: '本地草稿素材库中缺少「{name}」。',
    makerRecoveryCertifiedMismatch: '已认证的 Walrus Quilt 与当前 Maker 素材集不一致。',
    makerRecoveryEncoded: '已恢复保存的 Walrus Quilt，请使用同一钱包注册并上传。',
    makerRecoveryRegistered: '已恢复付费的 Walrus 注册；无需再次注册，可重试中继上传。',
    makerRecoveryUploaded: '已恢复上传完成的 Walrus Quilt，请继续认证。',
    makerRecoveryCertified: '已恢复认证完成的 Walrus Quilt，请继续发布 Sui Maker。',
    makerRecoveryRestored: '已恢复保存的 Walrus 上传。',
    makerRecoveryFailed: '无法恢复保存的 Walrus 上传。',
    ocFilesMissing: '缺少已渲染的 OC 文件。',
    ocRecoveryMismatch: '当前 OC 与保存的铸造上传不一致，请重新准备 OC Quilt。',
    ocRecoveryCertifiedMismatch: '已认证的 OC Quilt 不再恰好包含两个文件。',
    ocRecoveryEncoded: '已恢复保存的 OC Quilt，请使用同一钱包注册并上传。',
    ocRecoveryRegistered: '已恢复付费的 OC 注册；无需再次注册，可重试上传。',
    ocRecoveryUploaded: '已恢复上传完成的 OC Quilt，请继续认证。',
    ocRecoveryCertified: '已恢复认证完成的 OC 文件，请继续 Soulidity 交接。',
    ocRecoveryRestored: '已恢复保存的 OC 上传。',
    ocRecoveryFailed: '无法恢复保存的 OC 上传。',
    selectionRuleLimit: '一个 Maker 最多可包含 {count} 条组合规则。',
    chooseDifferentRuleParts: '请选择两个不同的部位来建立组合规则。',
    makerPartLimit: '一个 Maker 最多可包含 {count} 个部位。',
    archivedMakerImmutable: '此 Maker 已在 Sui 上归档。恢复后才能继续创建新 OC；已发布版本仍不可变更。',
    publishedMakerImmutable: '已发布的 Maker 不可变更。若要修改部位、部件、图层、规则或素材，请创建新版本。',
  },
  ja: {
    publicationIntentSaving: '公開意図を保存中…',
    publicationIntentSaveFailed: '公開意図を安全に保存できませんでした。ウォレット署名は要求していません。',
    publicationAlreadyRecovered: '同じ Quilt は公開済みです。追加署名を求めず、既存のオンチェーン Maker を復元しました。',
    publicationSubmittedRecovering: '取引を送信しました。オンチェーン Maker オブジェクトを復元中…',
    makerPublicationFailed: 'Maker のオンチェーン公開に失敗しました。',
    publicationPendingReview: '未確定のオンチェーン公開を復旧中です。重複取引を防ぐため、追加署名は無効になっています。',
    reviewPendingPublication: '保留中の公開を確認',
    clearPendingPublicationTitle: '保留中の公開記録を消去しますか？',
    clearPendingPublicationMessage: 'ウォレットが要求を拒否したか、オンチェーンに取引が存在しないことを確認した場合に限り、この復旧記録を消去してください。消去後は新しい公開署名を要求できます。',
    clearPendingPublicationConfirm: '消去して再試行',
    discardUploadRecoveryTitle: '古いアップロードを保存して準備し直しますか？',
    discardMakerUploadRecoveryMessage: '現在の Maker は保存済み Walrus アップロードと一致しません。Animacraft は軽量な監査記録を保持し、古いローカルチェックポイントを削除して、現在の内容から再準備できるようにします。送信済み取引は取り消されません。',
    discardOcUploadRecoveryMessage: '現在の OC は保存済み Walrus アップロードと一致しません。Animacraft は軽量な監査記録を保持し、古いローカルチェックポイントを削除して、現在の内容から再準備できるようにします。送信済み取引は取り消されません。',
    discardUploadRecoveryConfirm: '保存して準備し直す',
    uploadRecoveryDiscarded: '古いアップロードを保存しました。現在の内容から新しく準備してください。',
    makerIndexResolving: '公開取引を確認しました。Sui の索引から OCMaker オブジェクト ID を解決中…',
    makerIndexObjectMissing: '公開取引は索引済みですが、OCMaker オブジェクトが見つかりません。',
    makerIndexUnavailable: 'OCMaker オブジェクト ID はまだ利用できません。',
    makerIndexRecoveryRetained: '{error} 復旧下書きはこのブラウザに保持されています。',
    makerRecoveryDraftChanged: 'この Walrus チェックポイント作成後に下書きが変更されました。現在の素材から新しいアップロードを準備してください。',
    makerRecoveryCoverMissing: 'アップロード復旧記録に保存済み Maker カバーがありません。',
    makerRecoveryGraphMismatch: 'Maker 公開グラフがこの Walrus チェックポイントと一致しません。',
    makerRecoveryAssetMissing: 'ローカル下書き素材ストアに「{name}」がありません。',
    makerRecoveryCertifiedMismatch: '認証済み Walrus Quilt が現在の Maker 素材セットと一致しません。',
    makerRecoveryEncoded: '保存済み Walrus Quilt を復元しました。同じウォレットで登録・アップロードしてください。',
    makerRecoveryRegistered: '支払い済み Walrus 登録を復元しました。再登録せずリレーアップロードを再試行できます。',
    makerRecoveryUploaded: 'アップロード済み Walrus Quilt を復元しました。認証を続けてください。',
    makerRecoveryCertified: '認証済み Walrus Quilt を復元しました。Sui Maker の公開を続けてください。',
    makerRecoveryRestored: '保存済み Walrus アップロードを復元しました。',
    makerRecoveryFailed: '保存済み Walrus アップロードを復元できませんでした。',
    ocFilesMissing: '描画済み OC ファイルがありません。',
    ocRecoveryMismatch: '現在の OC が保存済み Mint アップロードと一致しません。新しい OC Quilt を準備してください。',
    ocRecoveryCertifiedMismatch: '認証済み OC Quilt に正確に2ファイルが含まれていません。',
    ocRecoveryEncoded: '保存済み OC Quilt を復元しました。同じウォレットで登録・アップロードしてください。',
    ocRecoveryRegistered: '支払い済み OC 登録を復元しました。再登録せずアップロードを再試行できます。',
    ocRecoveryUploaded: 'アップロード済み OC Quilt を復元しました。認証を続けてください。',
    ocRecoveryCertified: '認証済み OC ファイルを復元しました。Soulidity 連携を続けてください。',
    ocRecoveryRestored: '保存済み OC アップロードを復元しました。',
    ocRecoveryFailed: '保存済み OC アップロードを復元できませんでした。',
    selectionRuleLimit: '1つの Maker に設定できる組み合わせルールは {count} 件までです。',
    chooseDifferentRuleParts: '組み合わせルールには異なる2つのパーツを選択してください。',
    makerPartLimit: '1つの Maker に追加できるパーツは {count} 個までです。',
    archivedMakerImmutable: 'この Maker は Sui でアーカイブされています。新しい OC を作る前に復元してください。公開済みバージョンは引き続き変更できません。',
    publishedMakerImmutable: '公開済み Maker は変更できません。パーツ、アイテム、レイヤー、ルール、素材を変更するには新しいバージョンを作成してください。',
  },
  ko: {
    publicationIntentSaving: '게시 의도 저장 중…',
    publicationIntentSaveFailed: '게시 의도를 안전하게 저장하지 못했습니다. 지갑 서명은 요청하지 않았습니다.',
    publicationAlreadyRecovered: '동일한 Quilt가 이미 게시되어 있습니다. 추가 서명 없이 기존 온체인 Maker를 복구했습니다.',
    publicationSubmittedRecovering: '트랜잭션이 제출되었습니다. 온체인 Maker 오브젝트 복구 중…',
    makerPublicationFailed: 'Maker 온체인 게시에 실패했습니다.',
    publicationPendingReview: '확정되지 않은 온체인 게시를 복구 중입니다. 중복 트랜잭션을 막기 위해 추가 서명이 차단되었습니다.',
    reviewPendingPublication: '대기 중인 게시 확인',
    clearPendingPublicationTitle: '대기 중인 게시 기록을 지울까요?',
    clearPendingPublicationMessage: '지갑이 요청을 거절했거나 온체인에 트랜잭션이 없음을 확인한 경우에만 이 복구 기록을 지우세요. 기록을 지우면 새 게시 서명을 요청할 수 있습니다.',
    clearPendingPublicationConfirm: '지우고 다시 시도',
    discardUploadRecoveryTitle: '이전 업로드를 보관하고 다시 준비할까요?',
    discardMakerUploadRecoveryMessage: '현재 Maker가 저장된 Walrus 업로드와 일치하지 않습니다. Animacraft가 가벼운 감사 기록을 보관하고 오래된 로컬 체크포인트를 삭제한 뒤 현재 작업으로 새 업로드를 준비할 수 있게 합니다. 이미 제출된 트랜잭션은 취소되지 않습니다.',
    discardOcUploadRecoveryMessage: '현재 OC가 저장된 Walrus 업로드와 일치하지 않습니다. Animacraft가 가벼운 감사 기록을 보관하고 오래된 로컬 체크포인트를 삭제한 뒤 현재 작업으로 새 업로드를 준비할 수 있게 합니다. 이미 제출된 트랜잭션은 취소되지 않습니다.',
    discardUploadRecoveryConfirm: '보관하고 다시 준비',
    uploadRecoveryDiscarded: '이전 업로드를 보관했습니다. 현재 작업으로 새 업로드를 준비하세요.',
    makerIndexResolving: '게시 트랜잭션을 찾았습니다. Sui 인덱스에서 OCMaker 오브젝트 ID를 확인하는 중…',
    makerIndexObjectMissing: '게시 트랜잭션은 인덱싱되었지만 OCMaker 오브젝트를 찾지 못했습니다.',
    makerIndexUnavailable: 'OCMaker 오브젝트 ID를 아직 사용할 수 없습니다.',
    makerIndexRecoveryRetained: '{error} 복구 초안은 이 브라우저에 유지됩니다.',
    makerRecoveryDraftChanged: '이 Walrus 체크포인트 이후 초안이 변경되었습니다. 현재 에셋으로 새 업로드를 준비하세요.',
    makerRecoveryCoverMissing: '업로드 복구 기록에 저장된 Maker 커버가 없습니다.',
    makerRecoveryGraphMismatch: 'Maker 게시 그래프가 이 Walrus 체크포인트와 일치하지 않습니다.',
    makerRecoveryAssetMissing: '로컬 초안 에셋 저장소에 「{name}」이(가) 없습니다.',
    makerRecoveryCertifiedMismatch: '인증된 Walrus Quilt가 현재 Maker 에셋 세트와 일치하지 않습니다.',
    makerRecoveryEncoded: '저장된 Walrus Quilt를 복구했습니다. 같은 지갑으로 등록하고 업로드하세요.',
    makerRecoveryRegistered: '결제된 Walrus 등록을 복구했습니다. 다시 등록하지 않고 릴레이 업로드를 재시도하세요.',
    makerRecoveryUploaded: '업로드된 Walrus Quilt를 복구했습니다. 인증을 계속하세요.',
    makerRecoveryCertified: '인증된 Walrus Quilt를 복구했습니다. Sui Maker 게시를 계속하세요.',
    makerRecoveryRestored: '저장된 Walrus 업로드를 복구했습니다.',
    makerRecoveryFailed: '저장된 Walrus 업로드를 복구하지 못했습니다.',
    ocFilesMissing: '렌더링된 OC 파일이 없습니다.',
    ocRecoveryMismatch: '현재 OC가 저장된 Mint 업로드와 일치하지 않습니다. 새 OC Quilt를 준비하세요.',
    ocRecoveryCertifiedMismatch: '인증된 OC Quilt에 정확히 두 파일이 들어 있지 않습니다.',
    ocRecoveryEncoded: '저장된 OC Quilt를 복구했습니다. 같은 지갑으로 등록하고 업로드하세요.',
    ocRecoveryRegistered: '결제된 OC 등록을 복구했습니다. 다시 등록하지 않고 업로드를 재시도하세요.',
    ocRecoveryUploaded: '업로드된 OC Quilt를 복구했습니다. 인증을 계속하세요.',
    ocRecoveryCertified: '인증된 OC 파일을 복구했습니다. Soulidity 연동을 계속하세요.',
    ocRecoveryRestored: '저장된 OC 업로드를 복구했습니다.',
    ocRecoveryFailed: '저장된 OC 업로드를 복구하지 못했습니다.',
    selectionRuleLimit: 'Maker에는 조합 규칙을 최대 {count}개까지 추가할 수 있습니다.',
    chooseDifferentRuleParts: '조합 규칙에 서로 다른 두 파트를 선택하세요.',
    makerPartLimit: 'Maker에는 파트를 최대 {count}개까지 추가할 수 있습니다.',
    archivedMakerImmutable: '이 Maker는 Sui에서 보관 처리되었습니다. 새 OC를 만들기 전에 복원하세요. 게시된 버전은 계속 변경할 수 없습니다.',
    publishedMakerImmutable: '게시된 Maker는 변경할 수 없습니다. 파트, 아이템, 레이어, 규칙 또는 에셋을 바꾸려면 새 버전을 만드세요.',
  },
  vi: {
    publicationIntentSaving: 'Đang lưu ý định đăng…',
    publicationIntentSaveFailed: 'Không thể lưu an toàn ý định đăng. Chưa yêu cầu chữ ký ví.',
    publicationAlreadyRecovered: 'Phát hiện Quilt này đã được đăng. Đã khôi phục Maker hiện có trên chuỗi mà không yêu cầu ký lại.',
    publicationSubmittedRecovering: 'Giao dịch đã được gửi. Đang khôi phục đối tượng Maker trên chuỗi…',
    makerPublicationFailed: 'Đăng Maker trên chuỗi thất bại.',
    publicationPendingReview: 'Một lượt đăng trên chuỗi chưa xác nhận vẫn đang được khôi phục. Chữ ký trùng lặp đã bị chặn.',
    reviewPendingPublication: 'Kiểm tra lượt đăng đang chờ',
    clearPendingPublicationTitle: 'Xóa bản ghi đăng đang chờ?',
    clearPendingPublicationMessage: 'Chỉ xóa bản ghi khôi phục này sau khi xác nhận ví đã từ chối yêu cầu hoặc không có giao dịch trên chuỗi. Sau khi xóa, có thể yêu cầu chữ ký đăng mới.',
    clearPendingPublicationConfirm: 'Xóa và thử lại',
    discardUploadRecoveryTitle: 'Lưu lượt tải cũ và chuẩn bị lại?',
    discardMakerUploadRecoveryMessage: 'Maker hiện tại không còn khớp lượt tải Walrus đã lưu. Animacraft sẽ giữ một bản ghi kiểm toán gọn nhẹ, xóa điểm kiểm tra cục bộ đã cũ và cho phép chuẩn bị lượt tải mới từ nội dung hiện tại. Thao tác này không hủy giao dịch đã gửi.',
    discardOcUploadRecoveryMessage: 'OC hiện tại không còn khớp lượt tải Walrus đã lưu. Animacraft sẽ giữ một bản ghi kiểm toán gọn nhẹ, xóa điểm kiểm tra cục bộ đã cũ và cho phép chuẩn bị lượt tải mới từ nội dung hiện tại. Thao tác này không hủy giao dịch đã gửi.',
    discardUploadRecoveryConfirm: 'Lưu và chuẩn bị lại',
    uploadRecoveryDiscarded: 'Lượt tải cũ đã được lưu. Hãy chuẩn bị lượt tải mới từ nội dung hiện tại.',
    makerIndexResolving: 'Đã tìm thấy giao dịch đăng. Đang lấy ID đối tượng OCMaker từ chỉ mục Sui…',
    makerIndexObjectMissing: 'Giao dịch đăng đã được lập chỉ mục nhưng không tìm thấy đối tượng OCMaker.',
    makerIndexUnavailable: 'ID đối tượng OCMaker chưa khả dụng.',
    makerIndexRecoveryRetained: '{error} Bản nháp khôi phục vẫn được giữ trong trình duyệt này.',
    makerRecoveryDraftChanged: 'Bản nháp đã thay đổi sau điểm kiểm tra Walrus này. Hãy chuẩn bị lượt tải mới từ tài nguyên hiện tại.',
    makerRecoveryCoverMissing: 'Bản ghi khôi phục tải lên thiếu ảnh bìa Maker đã lưu.',
    makerRecoveryGraphMismatch: 'Đồ thị phát hành Maker không còn khớp điểm kiểm tra Walrus này.',
    makerRecoveryAssetMissing: 'Kho tài nguyên bản nháp cục bộ thiếu “{name}”.',
    makerRecoveryCertifiedMismatch: 'Walrus Quilt đã chứng nhận không khớp bộ tài nguyên Maker hiện tại.',
    makerRecoveryEncoded: 'Đã khôi phục Walrus Quilt đã lưu. Hãy đăng ký và tải lên bằng cùng ví.',
    makerRecoveryRegistered: 'Đã khôi phục đăng ký Walrus đã trả phí. Thử lại tải qua relay mà không đăng ký lần nữa.',
    makerRecoveryUploaded: 'Đã khôi phục Walrus Quilt đã tải lên. Tiếp tục chứng nhận.',
    makerRecoveryCertified: 'Đã khôi phục Walrus Quilt đã chứng nhận. Tiếp tục đăng Sui Maker.',
    makerRecoveryRestored: 'Đã khôi phục lượt tải Walrus đã lưu.',
    makerRecoveryFailed: 'Không thể khôi phục lượt tải Walrus đã lưu.',
    ocFilesMissing: 'Thiếu các tệp OC đã kết xuất.',
    ocRecoveryMismatch: 'OC hiện tại không khớp lượt tải mint đã lưu. Hãy chuẩn bị OC Quilt mới.',
    ocRecoveryCertifiedMismatch: 'OC Quilt đã chứng nhận không còn chứa đúng hai tệp.',
    ocRecoveryEncoded: 'Đã khôi phục OC Quilt đã lưu. Hãy đăng ký và tải lên bằng cùng ví.',
    ocRecoveryRegistered: 'Đã khôi phục đăng ký OC đã trả phí. Thử tải lại mà không đăng ký lần nữa.',
    ocRecoveryUploaded: 'Đã khôi phục OC Quilt đã tải lên. Tiếp tục chứng nhận.',
    ocRecoveryCertified: 'Đã khôi phục các tệp OC đã chứng nhận. Tiếp tục bàn giao sang Soulidity.',
    ocRecoveryRestored: 'Đã khôi phục lượt tải OC đã lưu.',
    ocRecoveryFailed: 'Không thể khôi phục lượt tải OC đã lưu.',
    selectionRuleLimit: 'Một Maker không thể có quá {count} quy tắc kết hợp.',
    chooseDifferentRuleParts: 'Chọn hai Bộ phận khác nhau cho quy tắc kết hợp.',
    makerPartLimit: 'Một Maker không thể có quá {count} Bộ phận.',
    archivedMakerImmutable: 'Maker này đã được lưu trữ trên Sui. Hãy khôi phục trước khi tạo OC mới; phiên bản đã đăng vẫn bất biến.',
    publishedMakerImmutable: 'Maker đã đăng là bất biến. Hãy tạo phiên bản mới để thay đổi Bộ phận, Vật phẩm, lớp, quy tắc hoặc tài nguyên.',
  },
};

Object.entries(productionPublicationRecoveryI18n).forEach(([locale, details]) => Object.assign(i18n[locale], details));

const staticProductionPageI18n = {
  en: {
    mainNavAria: 'Animacraft sections',
    closeAccountMenu: 'Close account menu',
    accountLanguageAria: 'Account language',
    soulidityLinksAria: 'Soulidity account and social links',
    templateFiltersAria: 'Template filters',
    platformMetricsAria: 'Platform metrics',
    networkStatusAria: 'Animacraft network status',
    livingDocumentsAria: 'Living Content documents',
    livingMarkdownAria: 'Living Content Markdown editor',
    characterPreviewAria: 'Character preview',
    colorSwatchesAria: 'Color swatches',
    layeredOcPreviewAria: 'Layered OC preview',
    onchainNetworkKicker: 'On-chain Network',
    backendlessRuntimeTitle: 'Backendless Sui + Walrus runtime',
    templatePlazaBack: '← Template Plaza',
    collectionSoulidityCopy: 'Finished characters, Living Content, social identity, and marketplace ownership are managed by Soulidity.',
    openMySouls: 'Open My Souls',
    creatorWalletGateTitle: 'Connect a Sui wallet to create OC Makers',
    creatorWalletGateCopy: 'Your wallet owns drafts, signs Walrus storage transactions, and becomes the creator of each published Maker.',
    close: 'Close',
    cancel: 'Cancel',
    newMakerRegistration: 'OC Maker Registration',
    newMakerNameLabel: 'OC Maker Name',
    newMakerNamePlaceholder: 'Example: Starlit Daily OC',
    canvasSize: 'Canvas size',
    startingStructure: 'Starting structure',
    characterStarter: 'Character starter',
    characterStarterCopy: 'Eight production-ready Parts, each with a default Item and Style, plus a complete layer order.',
    blankCanvas: 'Blank canvas',
    blankCanvasCopy: 'Begin without Parts and define the full Maker structure yourself.',
    createOcMaker: 'Create OC Maker',
    byCreator: 'by {creator}',
    templateSamplesAria: '{name} samples',
    archived: 'Archived',
    viewSuiMaker: 'View Sui Maker',
    openWalrusManifest: 'Open Walrus manifest',
    openMakerManifest: 'Open Maker manifest',
    makerCoverAlt: '{name} cover',
    makerPreviewAlt: '{name} preview',
    deleteLocalDraftTitle: 'Delete local draft?',
    deleteLocalDraftCopy: '“{name}” and its local Parts, Items, Styles, PNG references, and recovery checkpoints will be permanently removed from this browser.',
    deleteLocalDraft: 'Delete draft',
  },
  zh: {
    mainNavAria: 'Animacraft 导航',
    closeAccountMenu: '关闭账户菜单',
    accountLanguageAria: '账户语言',
    soulidityLinksAria: 'Soulidity 账户与社交链接',
    templateFiltersAria: '模板筛选',
    platformMetricsAria: '平台数据',
    networkStatusAria: 'Animacraft 网络状态',
    livingDocumentsAria: '生命内容文档',
    livingMarkdownAria: '生命内容 Markdown 编辑器',
    characterPreviewAria: '角色预览',
    colorSwatchesAria: '配色选项',
    layeredOcPreviewAria: 'OC 分层预览',
    onchainNetworkKicker: '链上网络',
    backendlessRuntimeTitle: '无后端的 Sui + Walrus 运行环境',
    templatePlazaBack: '← 返回模板广场',
    collectionSoulidityCopy: '完成的角色、生命内容、社交身份与市场所有权均由 Soulidity 管理。',
    openMySouls: '打开我的 Soul',
    creatorWalletGateTitle: '连接 Sui 钱包后创建 OC Maker',
    creatorWalletGateCopy: '你的钱包拥有草稿、签署 Walrus 存储交易，并成为每个已发布 Maker 的创作者。',
    close: '关闭',
    cancel: '取消',
    newMakerRegistration: '创建 OC Maker',
    newMakerNameLabel: 'OC Maker 名称',
    newMakerNamePlaceholder: '例如：星光日常 OC',
    canvasSize: '画布尺寸',
    startingStructure: '初始结构',
    characterStarter: '角色起始模板',
    characterStarterCopy: '包含八个可用于生产的部位；每个部位都有默认部件与样式，并带有完整的叠放顺序。',
    blankCanvas: '空白画布',
    blankCanvasCopy: '从没有部位的空白结构开始，自行定义完整 Maker。',
    createOcMaker: '创建 OC Maker',
    byCreator: '创作者：{creator}',
    templateSamplesAria: '{name} 示例',
    archived: '已归档',
    viewSuiMaker: '查看 Sui Maker',
    openWalrusManifest: '打开 Walrus 清单',
    openMakerManifest: '打开 Maker 清单',
    makerCoverAlt: '{name} 封面',
    makerPreviewAlt: '{name} 预览',
    deleteLocalDraftTitle: '删除本地草稿？',
    deleteLocalDraftCopy: '“{name}”及其本地部位、部件、样式、PNG 引用和恢复检查点将从此浏览器永久删除。',
    deleteLocalDraft: '删除草稿',
  },
  ja: {
    mainNavAria: 'Animacraft セクション',
    closeAccountMenu: 'アカウントメニューを閉じる',
    accountLanguageAria: 'アカウントの言語',
    soulidityLinksAria: 'Soulidity アカウントとソーシャルリンク',
    templateFiltersAria: 'テンプレート絞り込み',
    platformMetricsAria: 'プラットフォーム指標',
    networkStatusAria: 'Animacraft ネットワーク状態',
    livingDocumentsAria: 'リビングコンテンツ文書',
    livingMarkdownAria: 'リビングコンテンツ Markdown エディター',
    characterPreviewAria: 'キャラクタープレビュー',
    colorSwatchesAria: 'カラースウォッチ',
    layeredOcPreviewAria: 'OC レイヤープレビュー',
    onchainNetworkKicker: 'オンチェーンネットワーク',
    backendlessRuntimeTitle: 'バックエンド不要の Sui + Walrus ランタイム',
    templatePlazaBack: '← テンプレート広場へ戻る',
    collectionSoulidityCopy: '完成キャラクター、リビングコンテンツ、ソーシャル ID、マーケット所有権は Soulidity で管理されます。',
    openMySouls: 'マイ Soul を開く',
    creatorWalletGateTitle: 'Sui ウォレットを接続して OC Maker を作成',
    creatorWalletGateCopy: 'ウォレットが下書きを所有し、Walrus 保存取引に署名して、公開する各 Maker の制作者になります。',
    close: '閉じる',
    cancel: 'キャンセル',
    newMakerRegistration: 'OC Maker の作成',
    newMakerNameLabel: 'OC Maker 名',
    newMakerNamePlaceholder: '例：星明かりの日常 OC',
    canvasSize: 'キャンバスサイズ',
    startingStructure: '初期構成',
    characterStarter: 'キャラクター用スターター',
    characterStarterCopy: '制作向けの8パーツを用意し、各パーツに初期アイテムとスタイル、完全な描画順を設定します。',
    blankCanvas: '空のキャンバス',
    blankCanvasCopy: 'パーツのない状態から Maker 全体の構造を定義します。',
    createOcMaker: 'OC Maker を作成',
    byCreator: '制作者：{creator}',
    templateSamplesAria: '{name} のサンプル',
    archived: 'アーカイブ済み',
    viewSuiMaker: 'Sui Maker を表示',
    openWalrusManifest: 'Walrus マニフェストを開く',
    openMakerManifest: 'Maker マニフェストを開く',
    makerCoverAlt: '{name} のカバー',
    makerPreviewAlt: '{name} のプレビュー',
    deleteLocalDraftTitle: 'ローカル下書きを削除しますか？',
    deleteLocalDraftCopy: '「{name}」とローカルのパーツ、アイテム、スタイル、PNG 参照、復旧チェックポイントをこのブラウザから完全に削除します。',
    deleteLocalDraft: '下書きを削除',
  },
  ko: {
    mainNavAria: 'Animacraft 섹션',
    closeAccountMenu: '계정 메뉴 닫기',
    accountLanguageAria: '계정 언어',
    soulidityLinksAria: 'Soulidity 계정 및 소셜 링크',
    templateFiltersAria: '템플릿 필터',
    platformMetricsAria: '플랫폼 지표',
    networkStatusAria: 'Animacraft 네트워크 상태',
    livingDocumentsAria: '리빙 콘텐츠 문서',
    livingMarkdownAria: '리빙 콘텐츠 Markdown 편집기',
    characterPreviewAria: '캐릭터 미리보기',
    colorSwatchesAria: '색상 견본',
    layeredOcPreviewAria: 'OC 레이어 미리보기',
    onchainNetworkKicker: '온체인 네트워크',
    backendlessRuntimeTitle: '백엔드 없는 Sui + Walrus 런타임',
    templatePlazaBack: '← 템플릿 광장으로',
    collectionSoulidityCopy: '완성 캐릭터, 리빙 콘텐츠, 소셜 정체성, 마켓 소유권은 Soulidity에서 관리됩니다.',
    openMySouls: '내 Soul 열기',
    creatorWalletGateTitle: 'Sui 지갑을 연결해 OC Maker 만들기',
    creatorWalletGateCopy: '지갑이 초안을 소유하고 Walrus 저장 트랜잭션에 서명하며 게시된 각 Maker의 제작자가 됩니다.',
    close: '닫기',
    cancel: '취소',
    newMakerRegistration: 'OC Maker 만들기',
    newMakerNameLabel: 'OC Maker 이름',
    newMakerNamePlaceholder: '예: 별빛 데일리 OC',
    canvasSize: '캔버스 크기',
    startingStructure: '초기 구조',
    characterStarter: '캐릭터 스타터',
    characterStarterCopy: '프로덕션용 파트 8개와 각 파트의 기본 아이템 및 스타일, 완전한 그리기 순서를 제공합니다.',
    blankCanvas: '빈 캔버스',
    blankCanvasCopy: '파트 없이 시작해 전체 Maker 구조를 직접 정의합니다.',
    createOcMaker: 'OC Maker 만들기',
    byCreator: '제작자: {creator}',
    templateSamplesAria: '{name} 샘플',
    archived: '보관됨',
    viewSuiMaker: 'Sui Maker 보기',
    openWalrusManifest: 'Walrus 매니페스트 열기',
    openMakerManifest: 'Maker 매니페스트 열기',
    makerCoverAlt: '{name} 커버',
    makerPreviewAlt: '{name} 미리보기',
    deleteLocalDraftTitle: '로컬 초안을 삭제할까요?',
    deleteLocalDraftCopy: '“{name}”과 로컬 파트, 아이템, 스타일, PNG 참조, 복구 체크포인트가 이 브라우저에서 영구 삭제됩니다.',
    deleteLocalDraft: '초안 삭제',
  },
  vi: {
    mainNavAria: 'Các mục Animacraft',
    closeAccountMenu: 'Đóng trình đơn tài khoản',
    accountLanguageAria: 'Ngôn ngữ tài khoản',
    soulidityLinksAria: 'Tài khoản Soulidity và liên kết xã hội',
    templateFiltersAria: 'Bộ lọc mẫu',
    platformMetricsAria: 'Chỉ số nền tảng',
    networkStatusAria: 'Trạng thái mạng Animacraft',
    livingDocumentsAria: 'Tài liệu Nội dung sống',
    livingMarkdownAria: 'Trình sửa Markdown cho Nội dung sống',
    characterPreviewAria: 'Xem trước nhân vật',
    colorSwatchesAria: 'Bảng màu',
    layeredOcPreviewAria: 'Xem trước các lớp OC',
    onchainNetworkKicker: 'Mạng trên chuỗi',
    backendlessRuntimeTitle: 'Môi trường Sui + Walrus không cần máy chủ',
    templatePlazaBack: '← Về Quảng trường mẫu',
    collectionSoulidityCopy: 'Nhân vật hoàn tất, Nội dung sống, danh tính xã hội và quyền sở hữu thị trường được quản lý bởi Soulidity.',
    openMySouls: 'Mở Soul của tôi',
    creatorWalletGateTitle: 'Kết nối ví Sui để tạo OC Maker',
    creatorWalletGateCopy: 'Ví của bạn sở hữu bản nháp, ký giao dịch lưu trữ Walrus và trở thành tác giả của mỗi Maker đã đăng.',
    close: 'Đóng',
    cancel: 'Hủy',
    newMakerRegistration: 'Tạo OC Maker',
    newMakerNameLabel: 'Tên OC Maker',
    newMakerNamePlaceholder: 'Ví dụ: OC thường ngày ánh sao',
    canvasSize: 'Kích thước khung vẽ',
    startingStructure: 'Cấu trúc ban đầu',
    characterStarter: 'Mẫu khởi đầu nhân vật',
    characterStarterCopy: 'Gồm tám Bộ phận dùng được cho sản xuất; mỗi Bộ phận có Vật phẩm và Kiểu mặc định cùng thứ tự vẽ hoàn chỉnh.',
    blankCanvas: 'Khung vẽ trống',
    blankCanvasCopy: 'Bắt đầu không có Bộ phận và tự xác định toàn bộ cấu trúc Maker.',
    createOcMaker: 'Tạo OC Maker',
    byCreator: 'tác giả: {creator}',
    templateSamplesAria: 'Mẫu minh họa của {name}',
    archived: 'Đã lưu trữ',
    viewSuiMaker: 'Xem Sui Maker',
    openWalrusManifest: 'Mở bản kê khai Walrus',
    openMakerManifest: 'Mở bản kê khai Maker',
    makerCoverAlt: 'Ảnh bìa {name}',
    makerPreviewAlt: 'Xem trước {name}',
    deleteLocalDraftTitle: 'Xóa bản nháp cục bộ?',
    deleteLocalDraftCopy: '“{name}” cùng Bộ phận, Vật phẩm, Kiểu, tham chiếu PNG và điểm khôi phục cục bộ sẽ bị xóa vĩnh viễn khỏi trình duyệt này.',
    deleteLocalDraft: 'Xóa bản nháp',
  },
};

Object.entries(staticProductionPageI18n).forEach(([locale, details]) => Object.assign(i18n[locale], details));

const docsPageI18n = {
  en: {
    docsTitle: 'The Animacraft Handbook',
    docsIntro: 'Choose a player, creator, publication, or reference path. Every guide follows the current production Maker → OC workflow and clearly labels the still-gated Canonical Soul boundary.',
    docsNoSignerTitle: 'No backend signer',
    docsNoSignerCopy: 'Creators and players sign their own transactions. Public reads use Sui GraphQL, while every core write belongs to Sui objects and wallet PTBs.',
    docsWalrusAssetsTitle: 'Walrus as the asset layer',
    docsWalrusAssetsCopy: 'Style PNGs, picker icons, Maker manifests, finished OC images, and profile JSON resolve from browser-certified Walrus Quilts. Sui records bounded Quilt and patch locators.',
    docsOpenSourceTitle: 'Open-source releases',
    docsOpenSourceCopy: 'Production changes land through pull requests, CI checks, and CODEOWNERS review before shipping to Vercel.',
    docsArchitectureKicker: 'Production Architecture',
    docsArchitectureTitle: 'Creator to player without a backend database',
    docsArchitectureCopy: 'Wallets sign core writes, Walrus stores the complete versioned package, and Sui records Maker ownership, lifecycle, economics, and an equivalent rule projection. Published Maker events drive the public gallery without an Animacraft database.',
    docsCreatorGuide: 'Creator Guide',
    docsBuildMakerTitle: 'Build one Character Maker',
    docsHierarchyToken: 'Maker → Part → Item → Style → PNG',
    docsStep1Title: 'Library & Maker Overview',
    docsStep1Copy: 'Create or open a Maker in the library, then review its structure, files, rules, and release readiness.',
    docsStep2Title: 'Character Maker',
    docsStep2Copy: 'Work in one studio: Part is a player menu category, Item is one clickable choice, and each Style directly owns one PNG plus its position and render settings.',
    docsStep3Title: 'Layer Tracks',
    docsStep3Copy: 'Arrange the global back-to-front render order, then position, scale, rotate, blend, hide, solo, and confirm each Style PNG on the shared canvas.',
    docsStep4Title: 'Smart Color & Rules',
    docsStep4Copy: 'Create deterministic linked-color channels and enforce Item or Style requirements, exclusions, visibility conditions, and valid random combinations.',
    docsStep5Title: 'Player Test & Preflight',
    docsStep5Copy: 'Use the exact player renderer, then resolve every missing asset, unconfirmed position, invalid default, rule conflict, and compatibility issue.',
    docsStep6Title: 'On-chain Publish',
    docsStep6Copy: 'Prepare one Walrus Quilt, register and upload it, certify availability, then publish and share the OCMaker on Sui. Interrupted stages can resume locally.',
    docsDataModelKicker: 'Maker Data Model',
    docsDataModelTitle: 'Where each setting belongs',
    docsPartTerm: 'Part',
    docsPartCopy: 'One player menu category with required or optional behavior, an icon, a default Item, and selection rules.',
    docsItemStyleTerm: 'Item & Style',
    docsItemStyleCopy: 'Item is one player click. Style is the required visual choice under that Item; both can carry requirements and exclusions.',
    docsLayerTrackTerm: 'Layer Track',
    docsLayerTrackCopy: 'A global back-to-front render lane shared across Parts. Player menu order never changes visual z-order.',
    docsStylePngTerm: 'Style PNG',
    docsStylePngCopy: 'One Style directly owns one PNG with its own transform, opacity, blend mode, visibility, locking, and optional Smart Color. The separate Layer Tracks panel only controls global back-to-front order.',
    docsColorChannelTerm: 'Smart Color Channel',
    docsColorChannelCopy: 'A deterministic gradient-map palette shared by Styles that recolor their PNGs together.',
    docsOcMakerCopy: 'The shared Sui object binds the original creator, Quilt Blob ID, public Parts, Items, colors, rules, mint economics, license policy, and archive state.',
    docsTreasuryCopy: 'A shared coin-typed vault receives exact native-USDC mint fees and records collection and withdrawal totals.',
    docsAdminCapCopy: 'The transferable management right controls economics, withdrawals, and lifecycle. Cap ownership stays separate from original art provenance.',
    docsProtocolBoundary: 'Protocol Boundary',
    docsBoundaryTitle: 'One Maker, one canonical Soul',
    docsAnimacraftCopy: 'Publishes the shared Maker, USDC Treasury, transferable AdminCap, immutable recipe rules, and a one-PTB Soul mint authorization. It does not mint a finished character token.',
    docsSoulidityCopy: 'Consumes the authorization, creates the only Soul, binds mandatory Soul Character and Memory Blobs, locks ownership in a personal Kiosk, and handles social and marketplace activity.',
    docsHandoffTitle: 'Dedicated handoff',
    docsHandoffCopy: 'The certified OC profile opens Soulidity’s Animacraft integration route. The downloaded handoff archive is recovery material, not a second mint path.',
    docsAdapterTitle: 'Canonical adapter',
    docsAdapterCopy: 'Free and paid Maker authorization, verified provenance, Maker resale royalty, and Soul minting use the reviewed cross-package path after its Mainnet release gate is enabled.',
    docsLifecycleKicker: 'Maker Lifecycle',
    docsLifecycleTitle: 'Delete locally, archive on-chain',
    docsLocalDraftTitle: 'Local draft',
    docsLocalDraftCopy: 'IndexedDB stores wallet-scoped structure, source files, and upload checkpoints. Maker, Part, Item, Style, and Smart Color records can be permanently deleted before publication.',
    docsPublishedMakerTitle: 'Published Maker',
    docsPublishedMakerCopy: 'Publication locks art, rules, and the previously certified Walrus manifest locator. The Cap holder can only change future mint economics and archive state.',
    docsArchivedMakerTitle: 'Archived Maker',
    docsArchivedMakerCopy: 'The creator can archive or restore a published Maker with a wallet signature. Archive blocks new Soul authorizations while preserving existing Souls, rights snapshots, and provenance.',
    docsWalrusRetentionTitle: 'Walrus retention',
    docsWalrusRetentionCopy: 'Production uploads request 53 Mainnet epochs, currently about two years. Removing a local reference does not erase certified storage, but retention must be extended before expiry.',
    chainActionWalletTitle: 'Wallet',
    chainActionWalletCopy: 'Connect a Sui wallet. Creators and players sign every write themselves.',
    chainActionWalrusTitle: 'Walrus assets',
    chainActionWalrusCopy: 'Stage Style PNGs, picker icons, Maker manifests, finished OC images, and profile JSON as Quilt patches.',
    chainActionMakerTitle: 'OCMaker object',
    chainActionMakerCopy: 'Publish Maker provenance, public choice identities, economics, lifecycle state, and an equivalent compiled rule and color projection on Sui.',
    chainActionSoulTitle: 'Soulidity handoff · gated',
    chainActionSoulCopy: 'After the Canonical Soul Mainnet gate opens, Animacraft authorization and Living Content can enter Soulidity’s only finished-Soul mint path.',
    docsProtocolStep1Title: 'Style Assets',
    docsProtocolStep1Copy: 'Creators upload Style PNGs with their transforms and global Layer Track order to Walrus.',
    docsProtocolStep2Title: 'Maker Contract',
    docsProtocolStep2Copy: 'A Maker links immutable art and rules to a transferable AdminCap and a native-USDC Treasury.',
    docsProtocolStep3Title: 'OC Recipe',
    docsProtocolStep3Copy: 'An OC recipe pins one Maker version and records its Parts, Items, Styles, Smart Color choices, valid rules, and license snapshot.',
    docsProtocolStep4Title: 'Living Content',
    docsProtocolStep4Copy: 'Soul Character, Memory, and Skills & Docs resolve from editable Maker defaults.',
    docsProtocolStep5Title: 'Canonical Soul · gated',
    docsProtocolStep5Copy: 'The reviewed Soulidity adapter will consume Maker authorization and mint the only finished character object after the Mainnet gate is enabled.',
    docsProtocolStep6Title: 'Community after activation',
    docsProtocolStep6Copy: 'Social and secondary-market activity belongs to Soulidity and begins only after the reviewed integration is activated.',
  },
  zh: {
    docsTitle: 'Animacraft 使用手册',
    docsIntro: '按玩家、创作者、发布或参考路径阅读。每篇指南都遵循当前生产版本真实可用的 Maker → OC 流程，并明确标记尚未开启的规范 Soul 边界。',
    docsNoSignerTitle: '没有后端代签',
    docsNoSignerCopy: '创作者与玩家自行签署交易。公开读取使用 Sui GraphQL，所有核心写入都归属于 Sui 对象与钱包 PTB。',
    docsWalrusAssetsTitle: 'Walrus 作为素材层',
    docsWalrusAssetsCopy: '样式 PNG、选择器图标、Maker 清单、成品 OC 图片和资料 JSON 均从浏览器认证的 Walrus Quilt 读取；Sui 记录有边界的 Quilt 与补丁定位信息。',
    docsOpenSourceTitle: '开源发布流程',
    docsOpenSourceCopy: '生产变更通过 Pull Request、CI 检查和 CODEOWNERS 审核后，才会部署到 Vercel。',
    docsArchitectureKicker: '生产架构',
    docsArchitectureTitle: '无需后端数据库，连接创作者与玩家',
    docsArchitectureCopy: '钱包签署核心写入，Walrus 保存完整的版本化发布包，Sui 记录 Maker 所有权、生命周期、经济参数及等价规则投影。已发布 Maker 的事件直接驱动公开广场，不依赖 Animacraft 数据库。',
    docsCreatorGuide: '创作者指南',
    docsBuildMakerTitle: '创建一个角色 Maker',
    docsHierarchyToken: 'Maker → 部位 → 部件 → 样式 → PNG',
    docsStep1Title: 'Maker 库与概览',
    docsStep1Copy: '在 Maker 库中新建或打开 Maker，然后检查结构、文件、规则与发布准备状态。',
    docsStep2Title: '角色 Maker',
    docsStep2Copy: '在同一个工作室中完成创作：部位是玩家菜单分类，部件是可点击选项，每个样式直接拥有一张 PNG 及其位置和渲染设置。',
    docsStep3Title: '叠放顺序',
    docsStep3Copy: '设置全局从后到前的绘制顺序，再在共享画布上定位、缩放、旋转、混合、隐藏、独显并确认每张样式 PNG。',
    docsStep4Title: '联动配色与组合规则',
    docsStep4Copy: '创建确定性的联动配色通道，并强制执行部件或样式的依赖、排除、显示条件与有效随机组合。',
    docsStep5Title: '玩家试玩与发布检查',
    docsStep5Copy: '使用真实玩家 Renderer 试玩，再解决缺少素材、位置未确认、默认值无效、规则冲突和版本兼容问题。',
    docsStep6Title: '链上发布',
    docsStep6Copy: '准备一个 Walrus Quilt，完成注册、上传和可用性认证，再把 OCMaker 发布到 Sui 并分享；中断的阶段可以在本地恢复。',
    docsDataModelKicker: 'Maker 数据模型',
    docsDataModelTitle: '每项设置所属的位置',
    docsPartTerm: '部位',
    docsPartCopy: '一个玩家菜单分类，包含必选或可选行为、图标、默认部件与组合规则。',
    docsItemStyleTerm: '部件与样式',
    docsItemStyleCopy: '部件是玩家的一次点击选择；样式是该部件下必选的视觉方案。两者都可以带有依赖与排除规则。',
    docsLayerTrackTerm: '叠放顺序',
    docsLayerTrackCopy: '所有部位共享的全局后到前绘制通道。玩家菜单顺序绝不会改变视觉层级。',
    docsStylePngTerm: '样式 PNG',
    docsStylePngCopy: '一个样式直接拥有一张 PNG，并独立拥有坐标变换、透明度、混合模式、显示条件、锁定和可选联动配色。独立的图层轨道面板只控制全局前后叠放顺序。',
    docsColorChannelTerm: '联动配色通道',
    docsColorChannelCopy: '由多个样式共享的确定性渐变映射色板，使各自 PNG 同步换色。',
    docsOcMakerCopy: '该 Sui 共享对象绑定原始创作者、Quilt Blob ID、公开部位、部件、颜色、规则、铸造经济、授权政策与归档状态。',
    docsTreasuryCopy: '按币种定义的共享资金库接收精确的原生 USDC 铸造费，并记录收入与提现总额。',
    docsAdminCapCopy: '可转让的管理权控制经济参数、提现与生命周期；其所有权与原画来源相互独立。',
    docsProtocolBoundary: '协议边界',
    docsBoundaryTitle: '一个 Maker，一个规范 Soul',
    docsAnimacraftCopy: '发布共享 Maker、USDC 资金库、可转让 AdminCap、不可变配方规则，以及在一个 PTB 中完成的 Soul 铸造授权；它不重复铸造成品角色代币。',
    docsSoulidityCopy: '消费该授权，创建唯一 Soul，绑定必需的 Soul Character 与 Memory Blob，把所有权锁入个人 Kiosk，并负责社交与市场活动。',
    docsHandoffTitle: '专用交接',
    docsHandoffCopy: '认证后的 OC 资料会打开 Soulidity 的 Animacraft 集成路径。下载的交接压缩包只是恢复资料，不是第二条铸造路径。',
    docsAdapterTitle: '规范适配器',
    docsAdapterCopy: '主网发布开关启用后，免费与付费 Maker 授权、来源验证、Maker 二级版税和 Soul 铸造都通过经审核的跨包路径执行。',
    docsLifecycleKicker: 'Maker 生命周期',
    docsLifecycleTitle: '本地删除，链上归档',
    docsLocalDraftTitle: '本地草稿',
    docsLocalDraftCopy: 'IndexedDB 保存钱包作用域内的结构、源文件与上传检查点。发布前可永久删除 Maker、部位、部件、样式与联动配色记录。',
    docsPublishedMakerTitle: '已发布 Maker',
    docsPublishedMakerCopy: '发布后会锁定原画、规则和此前认证的 Walrus 清单定位信息。AdminCap 持有者只能修改未来铸造经济参数与归档状态。',
    docsArchivedMakerTitle: '已归档 Maker',
    docsArchivedMakerCopy: '创作者可通过钱包签名归档或恢复已发布 Maker。归档会阻止新的 Soul 授权，同时保留现有 Soul、权利快照和来源记录。',
    docsWalrusRetentionTitle: 'Walrus 保存期',
    docsWalrusRetentionCopy: '生产上传请求 53 个主网纪元，目前约为两年。删除本地引用不会抹除已认证存储，但必须在到期前续期。',
    chainActionWalletTitle: '钱包',
    chainActionWalletCopy: '连接 Sui 钱包；创作者和玩家自行签署每一笔写入。',
    chainActionWalrusTitle: 'Walrus 素材',
    chainActionWalrusCopy: '把样式 PNG、选择器图标、Maker 清单、成品 OC 图片和资料 JSON 作为 Quilt 补丁暂存。',
    chainActionMakerTitle: 'OCMaker 对象',
    chainActionMakerCopy: '在 Sui 发布 Maker 来源、公开选择标识、经济参数、生命周期状态，以及等价编译的规则与颜色投影。',
    chainActionSoulTitle: 'Soulidity 交接 · 尚未开启',
    chainActionSoulCopy: '规范 Soul 主网开关开启后，Animacraft 授权与生命内容才会进入 Soulidity 唯一的成品 Soul 铸造路径。',
    docsProtocolStep1Title: '样式素材',
    docsProtocolStep1Copy: '创作者把样式 PNG、坐标变换和全局叠放顺序上传到 Walrus。',
    docsProtocolStep2Title: 'Maker 合约',
    docsProtocolStep2Copy: 'Maker 把不可变原画与规则绑定到可转让 AdminCap 和原生 USDC 资金库。',
    docsProtocolStep3Title: 'OC 配方',
    docsProtocolStep3Copy: 'OC 配方固定到一个 Maker 版本，并记录其部位、部件、样式、联动配色选择、有效规则和授权快照。',
    docsProtocolStep4Title: '生命内容',
    docsProtocolStep4Copy: 'Soul Character、记忆以及技能与文档从 Maker 的可编辑默认内容解析。',
    docsProtocolStep5Title: '规范 Soul · 尚未开启',
    docsProtocolStep5Copy: '主网开关启用后，经审核的 Soulidity 适配器才会消费 Maker 授权并铸造唯一的成品角色对象。',
    docsProtocolStep6Title: '启用后的社区',
    docsProtocolStep6Copy: '社交和二级市场活动属于 Soulidity，并只在经审核的集成启用后开始。',
  },
  ja: {
    docsTitle: 'Animacraft ハンドブック',
    docsIntro: 'プレイヤー、制作者、公開、リファレンスの経路から選べます。各ガイドは現行本番版の Maker → OC フローに沿い、未有効の Canonical Soul 境界を明示します。',
    docsNoSignerTitle: 'バックエンド署名者なし',
    docsNoSignerCopy: '制作者とプレイヤーが自分の取引に署名します。公開読み取りは Sui GraphQL を使用し、主要な書き込みは Sui オブジェクトとウォレット PTB に属します。',
    docsWalrusAssetsTitle: '素材レイヤーとしての Walrus',
    docsWalrusAssetsCopy: 'スタイル PNG、選択アイコン、Maker マニフェスト、完成 OC 画像、プロフィール JSON は、ブラウザで認証した Walrus Quilt から取得します。Sui は制限付きの Quilt とパッチ位置を記録します。',
    docsOpenSourceTitle: 'オープンソースのリリース',
    docsOpenSourceCopy: '本番変更は Pull Request、CI、CODEOWNERS のレビューを通過してから Vercel へ配備されます。',
    docsArchitectureKicker: '本番アーキテクチャ',
    docsArchitectureTitle: 'バックエンド DB なしで制作者からプレイヤーへ',
    docsArchitectureCopy: 'ウォレットが主要な書き込みに署名し、Walrus が完全なバージョン付き公開パッケージを保存し、Sui が Maker の所有権、ライフサイクル、経済設定、等価なルール投影を記録します。公開 Maker イベントが Animacraft DB なしで公開広場を構成します。',
    docsCreatorGuide: '制作者ガイド',
    docsBuildMakerTitle: 'キャラクター Maker を作る',
    docsHierarchyToken: 'Maker → パーツ → アイテム → スタイル → PNG',
    docsStep1Title: 'ライブラリと Maker 概要',
    docsStep1Copy: 'ライブラリで Maker を新規作成または開き、構造、ファイル、ルール、公開準備を確認します。',
    docsStep2Title: 'キャラクター Maker',
    docsStep2Copy: '1つのスタジオで制作します。パーツはプレイヤーメニュー分類、アイテムはクリックする選択肢で、各スタイルが PNG 1枚と位置・描画設定を直接所有します。',
    docsStep3Title: 'レイヤートラック',
    docsStep3Copy: '全体の奥から手前への描画順を設定し、共有キャンバス上で各スタイル PNG の位置、拡大縮小、回転、合成、非表示、単独表示、確定を行います。',
    docsStep4Title: 'スマートカラーとルール',
    docsStep4Copy: '決定的な連動カラーチャンネルを作成し、アイテムやスタイルの必須、除外、表示条件、有効なランダム組み合わせを適用します。',
    docsStep5Title: 'プレイヤーテストと公開前チェック',
    docsStep5Copy: '実際のプレイヤーレンダラーで試し、素材不足、未確定位置、無効な初期値、ルール競合、互換性の問題をすべて解決します。',
    docsStep6Title: 'オンチェーン公開',
    docsStep6Copy: 'Walrus Quilt を1つ準備し、登録、アップロード、可用性認証を行って OCMaker を Sui に公開・共有します。中断した段階はローカルから再開できます。',
    docsDataModelKicker: 'Maker データモデル',
    docsDataModelTitle: '各設定が属する場所',
    docsPartTerm: 'パーツ',
    docsPartCopy: '必須または任意の動作、アイコン、初期アイテム、選択ルールを持つプレイヤーメニュー分類です。',
    docsItemStyleTerm: 'アイテムとスタイル',
    docsItemStyleCopy: 'アイテムはプレイヤーがクリックする選択肢です。スタイルはその下で必須の見た目で、どちらにも必須・除外ルールを設定できます。',
    docsLayerTrackTerm: 'レイヤートラック',
    docsLayerTrackCopy: '複数パーツで共有する全体の奥から手前への描画レーンです。プレイヤーメニュー順は視覚的な前後関係を変えません。',
    docsStylePngTerm: 'スタイル PNG',
    docsStylePngCopy: '1つのスタイルが PNG 1枚を直接所有し、変形、透明度、合成モード、表示条件、ロック、任意のスマートカラーを個別に持ちます。別のレイヤートラック画面は全体の奥から手前への順序だけを制御します。',
    docsColorChannelTerm: 'スマートカラーチャンネル',
    docsColorChannelCopy: '複数スタイルで共有する決定的なグラデーションマップで、各 PNG を同時に色替えします。',
    docsOcMakerCopy: 'この Sui 共有オブジェクトは、原制作者、Quilt Blob ID、公開パーツ、アイテム、色、ルール、ミント経済、ライセンス方針、アーカイブ状態を結びます。',
    docsTreasuryCopy: 'コイン型付き共有金庫が正確なネイティブ USDC ミント料金を受け取り、徴収・引き出し総額を記録します。',
    docsAdminCapCopy: '譲渡可能な管理権で経済、引き出し、ライフサイクルを制御します。Cap 所有権は原画の来歴と分離されています。',
    docsProtocolBoundary: 'プロトコル境界',
    docsBoundaryTitle: '1つの Maker、1つの正規 Soul',
    docsAnimacraftCopy: '共有 Maker、USDC 金庫、譲渡可能な AdminCap、不変レシピ規則、1つの PTB による Soul ミント認可を公開します。完成キャラクタートークンは発行しません。',
    docsSoulidityCopy: '認可を消費して唯一の Soul を作成し、必須の Soul Character と Memory Blob を結び、個人 Kiosk に所有権を固定し、ソーシャルとマーケット活動を扱います。',
    docsHandoffTitle: '専用連携',
    docsHandoffCopy: '認証済み OC プロフィールから Soulidity の Animacraft 連携経路を開きます。ダウンロードする連携アーカイブは復旧資料で、別のミント経路ではありません。',
    docsAdapterTitle: '正規アダプター',
    docsAdapterCopy: 'メインネット公開ゲートの有効化後、無料・有料 Maker 認可、検証済み来歴、Maker 二次ロイヤリティ、Soul ミントを審査済みのパッケージ間経路で実行します。',
    docsLifecycleKicker: 'Maker ライフサイクル',
    docsLifecycleTitle: 'ローカルで削除、オンチェーンでアーカイブ',
    docsLocalDraftTitle: 'ローカル下書き',
    docsLocalDraftCopy: 'IndexedDB がウォレット単位の構造、元ファイル、アップロードチェックポイントを保存します。公開前は Maker、パーツ、アイテム、スタイル、スマートカラー記録を完全削除できます。',
    docsPublishedMakerTitle: '公開済み Maker',
    docsPublishedMakerCopy: '公開すると原画、ルール、認証済み Walrus マニフェスト位置が固定されます。Cap 保有者が変更できるのは将来のミント経済とアーカイブ状態だけです。',
    docsArchivedMakerTitle: 'アーカイブ済み Maker',
    docsArchivedMakerCopy: '制作者はウォレット署名で公開 Maker をアーカイブまたは復元できます。アーカイブは新しい Soul 認可を止め、既存 Soul、権利スナップショット、来歴を保持します。',
    docsWalrusRetentionTitle: 'Walrus 保存期間',
    docsWalrusRetentionCopy: '本番アップロードはメインネット 53 エポック、現在およそ2年間を要求します。ローカル参照を消しても認証済み保存は消えませんが、期限前に延長が必要です。',
    chainActionWalletTitle: 'ウォレット',
    chainActionWalletCopy: 'Sui ウォレットを接続します。制作者とプレイヤーがすべての書き込みに自分で署名します。',
    chainActionWalrusTitle: 'Walrus 素材',
    chainActionWalrusCopy: 'スタイル PNG、選択アイコン、Maker マニフェスト、完成 OC 画像、プロフィール JSON を Quilt パッチとして準備します。',
    chainActionMakerTitle: 'OCMaker オブジェクト',
    chainActionMakerCopy: 'Maker の来歴、公開選択 ID、経済設定、ライフサイクル状態、等価にコンパイルされたルールとカラー投影を Sui に公開します。',
    chainActionSoulTitle: 'Soulidity 連携 · 未有効',
    chainActionSoulCopy: 'Canonical Soul Mainnet ゲートの有効化後にのみ、Animacraft 認可とリビングコンテンツが Soulidity の唯一の完成 Soul ミント経路へ進みます。',
    docsProtocolStep1Title: 'スタイル素材',
    docsProtocolStep1Copy: '制作者がスタイル PNG、その変形、全体レイヤートラック順を Walrus へアップロードします。',
    docsProtocolStep2Title: 'Maker コントラクト',
    docsProtocolStep2Copy: 'Maker は不変の原画とルールを譲渡可能な AdminCap とネイティブ USDC 金庫に結び付けます。',
    docsProtocolStep3Title: 'OC レシピ',
    docsProtocolStep3Copy: 'OC レシピは1つの Maker バージョンに固定され、パーツ、アイテム、スタイル、スマートカラー選択、有効なルール、ライセンスのスナップショットを記録します。',
    docsProtocolStep4Title: 'リビングコンテンツ',
    docsProtocolStep4Copy: 'Soul Character、メモリー、スキルと文書は Maker の編集可能な初期内容から解決されます。',
    docsProtocolStep5Title: '正規 Soul · 未有効',
    docsProtocolStep5Copy: 'Mainnet ゲートの有効化後、審査済み Soulidity アダプターが Maker 認可を消費し、唯一の完成キャラクターオブジェクトをミントします。',
    docsProtocolStep6Title: '有効化後のコミュニティ',
    docsProtocolStep6Copy: 'ソーシャルと二次市場の活動は Soulidity が担当し、審査済み連携の有効化後にのみ始まります。',
  },
  ko: {
    docsTitle: 'Animacraft 사용 설명서',
    docsIntro: '플레이어, 제작자, 게시 또는 참고 경로를 선택하세요. 모든 가이드는 현재 프로덕션 Maker → OC 흐름을 따르고 아직 비활성인 Canonical Soul 경계를 명확히 표시합니다.',
    docsNoSignerTitle: '백엔드 서명자 없음',
    docsNoSignerCopy: '제작자와 플레이어가 자신의 트랜잭션에 직접 서명합니다. 공개 읽기는 Sui GraphQL을 사용하고, 핵심 쓰기는 Sui 오브젝트와 지갑 PTB에 속합니다.',
    docsWalrusAssetsTitle: '에셋 레이어로서의 Walrus',
    docsWalrusAssetsCopy: '스타일 PNG, 선택 아이콘, Maker 매니페스트, 완성 OC 이미지, 프로필 JSON은 브라우저가 인증한 Walrus Quilt에서 가져옵니다. Sui는 제한된 Quilt 및 패치 위치를 기록합니다.',
    docsOpenSourceTitle: '오픈 소스 릴리스',
    docsOpenSourceCopy: '프로덕션 변경은 Pull Request, CI 검사, CODEOWNERS 검토를 거친 뒤 Vercel에 배포됩니다.',
    docsArchitectureKicker: '프로덕션 아키텍처',
    docsArchitectureTitle: '백엔드 데이터베이스 없이 제작자에서 플레이어까지',
    docsArchitectureCopy: '지갑이 핵심 쓰기에 서명하고 Walrus가 완전한 버전형 게시 패키지를 저장하며 Sui가 Maker 소유권, 수명 주기, 경제 설정과 동등한 규칙 투영을 기록합니다. 게시된 Maker 이벤트가 Animacraft 데이터베이스 없이 공개 갤러리를 구성합니다.',
    docsCreatorGuide: '제작자 가이드',
    docsBuildMakerTitle: '캐릭터 Maker 만들기',
    docsHierarchyToken: 'Maker → 파트 → 아이템 → 스타일 → PNG',
    docsStep1Title: '라이브러리와 Maker 개요',
    docsStep1Copy: '라이브러리에서 Maker를 만들거나 열고 구조, 파일, 규칙, 게시 준비 상태를 검토합니다.',
    docsStep2Title: '캐릭터 Maker',
    docsStep2Copy: '하나의 스튜디오에서 제작합니다. 파트는 플레이어 메뉴 분류, 아이템은 클릭 선택지이며 각 스타일은 PNG 한 장과 위치 및 렌더 설정을 직접 소유합니다.',
    docsStep3Title: '레이어 트랙',
    docsStep3Copy: '전체 뒤에서 앞으로의 그리기 순서를 정하고 공유 캔버스에서 각 스타일 PNG의 위치, 크기, 회전, 혼합, 숨김, 단독 표시, 확정을 처리합니다.',
    docsStep4Title: '스마트 컬러와 규칙',
    docsStep4Copy: '결정형 연동 색상 채널을 만들고 아이템 또는 스타일의 필수, 제외, 표시 조건과 유효한 무작위 조합을 적용합니다.',
    docsStep5Title: '플레이어 테스트와 게시 검사',
    docsStep5Copy: '실제 플레이어 렌더러로 시험하고 누락 에셋, 미확정 위치, 잘못된 기본값, 규칙 충돌, 호환성 문제를 모두 해결합니다.',
    docsStep6Title: '온체인 게시',
    docsStep6Copy: 'Walrus Quilt 하나를 준비해 등록, 업로드, 가용성 인증 후 OCMaker를 Sui에 게시하고 공유합니다. 중단된 단계는 로컬에서 재개할 수 있습니다.',
    docsDataModelKicker: 'Maker 데이터 모델',
    docsDataModelTitle: '각 설정이 속하는 위치',
    docsPartTerm: '파트',
    docsPartCopy: '필수 또는 선택 동작, 아이콘, 기본 아이템, 선택 규칙을 가진 플레이어 메뉴 분류입니다.',
    docsItemStyleTerm: '아이템과 스타일',
    docsItemStyleCopy: '아이템은 플레이어가 클릭하는 선택지입니다. 스타일은 그 아래의 필수 시각 선택이며 둘 다 필수 및 제외 규칙을 가질 수 있습니다.',
    docsLayerTrackTerm: '레이어 트랙',
    docsLayerTrackCopy: '여러 파트가 공유하는 전체 뒤에서 앞으로의 렌더 레인입니다. 플레이어 메뉴 순서는 시각적 z축을 바꾸지 않습니다.',
    docsStylePngTerm: '스타일 PNG',
    docsStylePngCopy: '스타일 하나가 PNG 한 장을 직접 소유하고 변형, 투명도, 혼합 모드, 표시 조건, 잠금, 선택적 스마트 컬러를 독립적으로 가집니다. 별도의 레이어 트랙 화면은 전체 뒤에서 앞으로의 순서만 제어합니다.',
    docsColorChannelTerm: '스마트 컬러 채널',
    docsColorChannelCopy: '여러 스타일이 공유하는 결정형 그라디언트 맵 팔레트로 각 PNG의 색을 함께 바꿉니다.',
    docsOcMakerCopy: '이 Sui 공유 오브젝트는 원 제작자, Quilt Blob ID, 공개 파트, 아이템, 색상, 규칙, 민팅 경제, 라이선스 정책, 보관 상태를 연결합니다.',
    docsTreasuryCopy: '코인 유형 공유 금고가 정확한 네이티브 USDC 민팅 수수료를 받고 수금 및 인출 총액을 기록합니다.',
    docsAdminCapCopy: '양도 가능한 관리 권한이 경제, 인출, 수명 주기를 제어합니다. Cap 소유권은 원본 아트 출처와 분리됩니다.',
    docsProtocolBoundary: '프로토콜 경계',
    docsBoundaryTitle: 'Maker 하나, 정식 Soul 하나',
    docsAnimacraftCopy: '공유 Maker, USDC 금고, 양도 가능한 AdminCap, 불변 레시피 규칙, 단일 PTB Soul 민팅 승인을 게시합니다. 완성 캐릭터 토큰은 민팅하지 않습니다.',
    docsSoulidityCopy: '승인을 사용해 유일한 Soul을 만들고 필수 Soul Character 및 Memory Blob을 연결하며 개인 Kiosk에 소유권을 잠그고 소셜 및 마켓 활동을 처리합니다.',
    docsHandoffTitle: '전용 연동',
    docsHandoffCopy: '인증된 OC 프로필이 Soulidity의 Animacraft 연동 경로를 엽니다. 다운로드한 연동 아카이브는 복구 자료이며 두 번째 민팅 경로가 아닙니다.',
    docsAdapterTitle: '정식 어댑터',
    docsAdapterCopy: '메인넷 릴리스 게이트가 활성화되면 무료·유료 Maker 승인, 검증된 출처, Maker 재판매 로열티, Soul 민팅이 검토된 패키지 간 경로에서 실행됩니다.',
    docsLifecycleKicker: 'Maker 수명 주기',
    docsLifecycleTitle: '로컬에서는 삭제, 온체인에서는 보관',
    docsLocalDraftTitle: '로컬 초안',
    docsLocalDraftCopy: 'IndexedDB가 지갑 범위의 구조, 원본 파일, 업로드 체크포인트를 저장합니다. 게시 전에는 Maker, 파트, 아이템, 스타일, 스마트 컬러 기록을 영구 삭제할 수 있습니다.',
    docsPublishedMakerTitle: '게시된 Maker',
    docsPublishedMakerCopy: '게시하면 아트, 규칙, 인증된 Walrus 매니페스트 위치가 잠깁니다. Cap 소유자는 향후 민팅 경제와 보관 상태만 변경할 수 있습니다.',
    docsArchivedMakerTitle: '보관된 Maker',
    docsArchivedMakerCopy: '제작자는 지갑 서명으로 게시된 Maker를 보관하거나 복원할 수 있습니다. 보관은 새 Soul 승인을 막고 기존 Soul, 권리 스냅샷, 출처를 유지합니다.',
    docsWalrusRetentionTitle: 'Walrus 보관 기간',
    docsWalrusRetentionCopy: '프로덕션 업로드는 메인넷 53에포크, 현재 약 2년을 요청합니다. 로컬 참조를 지워도 인증 저장소는 삭제되지 않지만 만료 전에 기간을 연장해야 합니다.',
    chainActionWalletTitle: '지갑',
    chainActionWalletCopy: 'Sui 지갑을 연결합니다. 제작자와 플레이어가 모든 쓰기에 직접 서명합니다.',
    chainActionWalrusTitle: 'Walrus 에셋',
    chainActionWalrusCopy: '스타일 PNG, 선택 아이콘, Maker 매니페스트, 완성 OC 이미지, 프로필 JSON을 Quilt 패치로 준비합니다.',
    chainActionMakerTitle: 'OCMaker 오브젝트',
    chainActionMakerCopy: 'Maker 출처, 공개 선택 ID, 경제 설정, 수명 주기 상태와 동등하게 컴파일된 규칙·색상 투영을 Sui에 게시합니다.',
    chainActionSoulTitle: 'Soulidity 연동 · 비활성',
    chainActionSoulCopy: 'Canonical Soul Mainnet 게이트가 열린 뒤에만 Animacraft 승인과 리빙 콘텐츠가 Soulidity의 유일한 완성 Soul 민팅 경로로 이동합니다.',
    docsProtocolStep1Title: '스타일 에셋',
    docsProtocolStep1Copy: '제작자가 스타일 PNG, 변형, 전체 레이어 트랙 순서를 Walrus에 업로드합니다.',
    docsProtocolStep2Title: 'Maker 컨트랙트',
    docsProtocolStep2Copy: 'Maker는 불변 아트와 규칙을 양도 가능한 AdminCap 및 네이티브 USDC 금고에 연결합니다.',
    docsProtocolStep3Title: 'OC 레시피',
    docsProtocolStep3Copy: 'OC 레시피는 Maker 버전 하나에 고정되고 파트, 아이템, 스타일, 스마트 컬러 선택, 유효한 규칙, 라이선스 스냅샷을 기록합니다.',
    docsProtocolStep4Title: '리빙 콘텐츠',
    docsProtocolStep4Copy: 'Soul Character, 메모리, 스킬과 문서는 편집 가능한 Maker 기본값에서 결정됩니다.',
    docsProtocolStep5Title: '정식 Soul · 비활성',
    docsProtocolStep5Copy: 'Mainnet 게이트가 활성화된 뒤 검토된 Soulidity 어댑터가 Maker 승인을 사용해 유일한 완성 캐릭터 오브젝트를 민팅합니다.',
    docsProtocolStep6Title: '활성화 이후 커뮤니티',
    docsProtocolStep6Copy: '소셜과 2차 시장 활동은 Soulidity가 담당하며 검토된 연동이 활성화된 뒤에만 시작됩니다.',
  },
  vi: {
    docsTitle: 'Cẩm nang Animacraft',
    docsIntro: 'Chọn lộ trình dành cho người chơi, tác giả, phát hành hoặc tham khảo. Mỗi hướng dẫn bám sát quy trình Maker → OC hiện có và ghi rõ ranh giới Canonical Soul vẫn đang khóa.',
    docsNoSignerTitle: 'Không có bên ký ở máy chủ',
    docsNoSignerCopy: 'Tác giả và người chơi tự ký giao dịch. Dữ liệu công khai được đọc qua Sui GraphQL, còn mọi ghi chép cốt lõi thuộc về đối tượng Sui và PTB của ví.',
    docsWalrusAssetsTitle: 'Walrus làm lớp tài nguyên',
    docsWalrusAssetsCopy: 'PNG của Kiểu, biểu tượng lựa chọn, bản kê khai Maker, ảnh OC hoàn tất và JSON hồ sơ được lấy từ Walrus Quilt do trình duyệt chứng nhận. Sui ghi vị trí Quilt và bản vá có giới hạn.',
    docsOpenSourceTitle: 'Phát hành mã nguồn mở',
    docsOpenSourceCopy: 'Thay đổi sản xuất phải qua Pull Request, kiểm tra CI và duyệt CODEOWNERS trước khi triển khai lên Vercel.',
    docsArchitectureKicker: 'Kiến trúc sản xuất',
    docsArchitectureTitle: 'Từ tác giả đến người chơi mà không cần cơ sở dữ liệu máy chủ',
    docsArchitectureCopy: 'Ví ký các ghi chép cốt lõi, Walrus lưu gói phát hành có phiên bản đầy đủ, còn Sui ghi quyền sở hữu, vòng đời, kinh tế và phép chiếu quy tắc tương đương của Maker. Sự kiện Maker đã đăng tạo thư viện công khai mà không cần cơ sở dữ liệu Animacraft.',
    docsCreatorGuide: 'Hướng dẫn tác giả',
    docsBuildMakerTitle: 'Tạo một Maker nhân vật',
    docsHierarchyToken: 'Maker → Bộ phận → Vật phẩm → Kiểu → PNG',
    docsStep1Title: 'Thư viện và tổng quan Maker',
    docsStep1Copy: 'Tạo hoặc mở Maker trong thư viện rồi xem lại cấu trúc, tệp, quy tắc và mức sẵn sàng để đăng.',
    docsStep2Title: 'Maker nhân vật',
    docsStep2Copy: 'Làm việc trong một xưởng: Bộ phận là nhóm trong trình đơn người chơi, Vật phẩm là một lựa chọn có thể nhấn, và mỗi Kiểu trực tiếp sở hữu một PNG cùng vị trí và thiết lập kết xuất.',
    docsStep3Title: 'Thứ tự lớp',
    docsStep3Copy: 'Sắp xếp thứ tự vẽ toàn cục từ sau ra trước, rồi đặt vị trí, đổi tỷ lệ, xoay, hòa trộn, ẩn, chỉ hiện và xác nhận từng PNG của Kiểu trên khung vẽ chung.',
    docsStep4Title: 'Màu liên kết và quy tắc',
    docsStep4Copy: 'Tạo kênh màu liên kết xác định và thực thi điều kiện bắt buộc, loại trừ, hiển thị cùng tổ hợp ngẫu nhiên hợp lệ cho Vật phẩm hoặc Kiểu.',
    docsStep5Title: 'Thử với người chơi và kiểm tra trước khi đăng',
    docsStep5Copy: 'Dùng đúng bộ kết xuất người chơi rồi xử lý mọi tài nguyên thiếu, vị trí chưa xác nhận, mặc định không hợp lệ, xung đột quy tắc và vấn đề tương thích.',
    docsStep6Title: 'Đăng trên chuỗi',
    docsStep6Copy: 'Chuẩn bị một Walrus Quilt, đăng ký, tải lên, chứng nhận khả dụng rồi đăng và chia sẻ OCMaker trên Sui. Giai đoạn bị gián đoạn có thể tiếp tục cục bộ.',
    docsDataModelKicker: 'Mô hình dữ liệu Maker',
    docsDataModelTitle: 'Mỗi thiết lập thuộc về đâu',
    docsPartTerm: 'Bộ phận',
    docsPartCopy: 'Một nhóm trong trình đơn người chơi, có hành vi bắt buộc hoặc tùy chọn, biểu tượng, Vật phẩm mặc định và quy tắc lựa chọn.',
    docsItemStyleTerm: 'Vật phẩm và Kiểu',
    docsItemStyleCopy: 'Vật phẩm là một lần nhấn của người chơi. Kiểu là lựa chọn hình ảnh bắt buộc bên dưới Vật phẩm; cả hai có thể có điều kiện bắt buộc và loại trừ.',
    docsLayerTrackTerm: 'Thứ tự lớp',
    docsLayerTrackCopy: 'Một luồng vẽ toàn cục từ sau ra trước được các Bộ phận dùng chung. Thứ tự trình đơn người chơi không bao giờ đổi thứ tự hiển thị.',
    docsStylePngTerm: 'PNG của Kiểu',
    docsStylePngCopy: 'Mỗi Kiểu trực tiếp sở hữu một PNG cùng biến đổi, độ mờ, chế độ hòa trộn, điều kiện hiển thị, khóa và Màu liên kết riêng. Bảng Thứ tự lớp tách biệt chỉ điều khiển thứ tự vẽ toàn cục từ sau ra trước.',
    docsColorChannelTerm: 'Kênh Màu liên kết',
    docsColorChannelCopy: 'Bảng màu ánh xạ chuyển sắc xác định được các Kiểu dùng chung để đổi màu PNG đồng thời.',
    docsOcMakerCopy: 'Đối tượng Sui dùng chung liên kết tác giả gốc, Quilt Blob ID, Bộ phận, Vật phẩm, màu, quy tắc, kinh tế đúc, chính sách giấy phép và trạng thái lưu trữ.',
    docsTreasuryCopy: 'Kho dùng chung theo loại coin nhận đúng phí đúc USDC gốc và ghi tổng số đã thu cùng đã rút.',
    docsAdminCapCopy: 'Quyền quản lý có thể chuyển nhượng kiểm soát kinh tế, rút tiền và vòng đời. Quyền sở hữu Cap tách biệt với nguồn gốc tác phẩm.',
    docsProtocolBoundary: 'Ranh giới giao thức',
    docsBoundaryTitle: 'Một Maker, một Soul chuẩn',
    docsAnimacraftCopy: 'Đăng Maker dùng chung, kho USDC, AdminCap có thể chuyển nhượng, quy tắc công thức bất biến và quyền đúc Soul trong một PTB. Animacraft không đúc token nhân vật hoàn tất.',
    docsSoulidityCopy: 'Dùng quyền đó để tạo Soul duy nhất, liên kết Soul Character và Memory Blob bắt buộc, khóa quyền sở hữu trong Kiosk cá nhân, đồng thời xử lý hoạt động xã hội và thị trường.',
    docsHandoffTitle: 'Chuyển giao chuyên dụng',
    docsHandoffCopy: 'Hồ sơ OC đã chứng nhận mở tuyến tích hợp Animacraft của Soulidity. Gói chuyển giao tải xuống chỉ là tài liệu khôi phục, không phải đường đúc thứ hai.',
    docsAdapterTitle: 'Bộ điều hợp chuẩn',
    docsAdapterCopy: 'Sau khi cổng phát hành Mainnet được bật, quyền Maker miễn phí hoặc trả phí, nguồn gốc đã xác minh, tiền bản quyền bán lại Maker và việc đúc Soul đều chạy qua tuyến liên gói đã duyệt.',
    docsLifecycleKicker: 'Vòng đời Maker',
    docsLifecycleTitle: 'Xóa cục bộ, lưu trữ trên chuỗi',
    docsLocalDraftTitle: 'Bản nháp cục bộ',
    docsLocalDraftCopy: 'IndexedDB lưu cấu trúc theo ví, tệp nguồn và điểm kiểm tra tải lên. Trước khi đăng, có thể xóa vĩnh viễn bản ghi Maker, Bộ phận, Vật phẩm, Kiểu và Màu liên kết.',
    docsPublishedMakerTitle: 'Maker đã đăng',
    docsPublishedMakerCopy: 'Việc đăng khóa tác phẩm, quy tắc và vị trí bản kê khai Walrus đã chứng nhận. Chủ Cap chỉ có thể đổi kinh tế đúc trong tương lai và trạng thái lưu trữ.',
    docsArchivedMakerTitle: 'Maker đã lưu trữ',
    docsArchivedMakerCopy: 'Tác giả có thể lưu trữ hoặc khôi phục Maker đã đăng bằng chữ ký ví. Lưu trữ chặn quyền Soul mới nhưng giữ Soul hiện có, ảnh chụp quyền và nguồn gốc.',
    docsWalrusRetentionTitle: 'Thời hạn Walrus',
    docsWalrusRetentionCopy: 'Tải lên sản xuất yêu cầu 53 epoch Mainnet, hiện khoảng hai năm. Xóa tham chiếu cục bộ không xóa lưu trữ đã chứng nhận, nhưng phải gia hạn trước khi hết hạn.',
    chainActionWalletTitle: 'Ví',
    chainActionWalletCopy: 'Kết nối ví Sui. Tác giả và người chơi tự ký mọi ghi chép.',
    chainActionWalrusTitle: 'Tài nguyên Walrus',
    chainActionWalrusCopy: 'Chuẩn bị PNG của Kiểu, biểu tượng lựa chọn, bản kê khai Maker, ảnh OC hoàn tất và JSON hồ sơ dưới dạng bản vá Quilt.',
    chainActionMakerTitle: 'Đối tượng OCMaker',
    chainActionMakerCopy: 'Đăng nguồn gốc Maker, ID lựa chọn công khai, kinh tế, trạng thái vòng đời cùng phép chiếu quy tắc và màu được biên dịch tương đương trên Sui.',
    chainActionSoulTitle: 'Bàn giao Soulidity · đang khóa',
    chainActionSoulCopy: 'Chỉ sau khi cổng Canonical Soul Mainnet mở, quyền Animacraft và Nội dung sống mới đi vào tuyến đúc Soul hoàn tất duy nhất của Soulidity.',
    docsProtocolStep1Title: 'Tài nguyên Kiểu',
    docsProtocolStep1Copy: 'Tác giả tải PNG của Kiểu cùng biến đổi và thứ tự lớp toàn cục lên Walrus.',
    docsProtocolStep2Title: 'Hợp đồng Maker',
    docsProtocolStep2Copy: 'Maker liên kết tác phẩm và quy tắc bất biến với AdminCap có thể chuyển nhượng cùng kho USDC gốc.',
    docsProtocolStep3Title: 'Công thức OC',
    docsProtocolStep3Copy: 'Công thức OC được ghim vào một phiên bản Maker và ghi Bộ phận, Vật phẩm, Kiểu, lựa chọn Màu liên kết, quy tắc hợp lệ cùng ảnh chụp giấy phép.',
    docsProtocolStep4Title: 'Nội dung sống',
    docsProtocolStep4Copy: 'Soul Character, Ký ức, Kỹ năng và Tài liệu được xác định từ mặc định Maker có thể sửa.',
    docsProtocolStep5Title: 'Soul chuẩn · đang khóa',
    docsProtocolStep5Copy: 'Sau khi cổng Mainnet bật, bộ chuyển tiếp Soulidity đã duyệt mới dùng quyền Maker để đúc đối tượng nhân vật hoàn tất duy nhất.',
    docsProtocolStep6Title: 'Cộng đồng sau khi kích hoạt',
    docsProtocolStep6Copy: 'Hoạt động xã hội và thị trường thứ cấp thuộc Soulidity và chỉ bắt đầu sau khi tích hợp đã duyệt được kích hoạt.',
  },
};

Object.entries(docsPageI18n).forEach(([locale, details]) => Object.assign(i18n[locale], details));

const draftRecoveryProductionI18n = {
  en: {
    draftRecoveryUnknownMaker: 'Unknown Maker draft',
    draftRecoveryUnknownTime: 'Unknown time',
    draftRecoveryUnknownRevision: 'Revision unknown',
    draftRecoveryMetrics: '{parts} Parts / {items} Items / {styles} Styles',
    draftRecoveryCurrentScanFailed: 'The current Maker workspace could not be scanned.',
    draftRecoveryLegacyScanFailed: 'Legacy browser storage could not be scanned.',
    draftRecoveryBackupExported: '“{name}” backup exported.',
    draftRecoveryIssueInvalidJson: 'The legacy value is not valid JSON. Only its raw backup can be exported.',
    draftRecoveryIssueIndexOnly: 'This is only a Maker list entry and does not contain an editor document.',
    draftRecoveryIssueIncompatible: 'This legacy Maker document cannot be restored automatically without losing data.',
    draftRecoveryIssueOrphanedAssets: 'Local PNG assets were found without a compatible Maker document.',
    draftRecoveryIssueMissingDocument: 'No compatible Maker document was found in this record.',
    draftRecoveryIssueScanFailed: 'This legacy source could not be read. Its other data was not modified.',
    draftRecoveryIssueUnknown: 'This record cannot be restored automatically. Export its backup before making changes.',
    draftRecoveryCopyName: '{name} · Recovered',
    draftRecoveryChangelog: 'Recovered from a preserved local browser draft.',
    draftRecoveryV6Missing: 'The selected v6 Maker draft is no longer available.',
    draftRecoveryConnectOwnerWallet: 'Connect the wallet that will own the recovered Maker copy.',
    draftRecoverySaveCurrentFirst: 'Save the current Maker before recovering another draft.',
    draftRecoveryWalletChanged: 'The connected wallet changed during recovery.',
    draftRecoveryWalletChangedAfterSave: 'The connected wallet changed while the recovered copy was being saved. Reconnect the original destination wallet to find it in Draft Recovery.',
    draftRecoveryIdentityFailed: 'The recovered Maker identity failed read-back verification.',
  },
  zh: {
    draftRecoveryUnknownMaker: '未知 Maker 草稿',
    draftRecoveryUnknownTime: '保存时间未知',
    draftRecoveryUnknownRevision: '版本号未知',
    draftRecoveryMetrics: '{parts} 个部位 / {items} 个部件 / {styles} 个样式',
    draftRecoveryCurrentScanFailed: '无法扫描当前 Maker 工作区。',
    draftRecoveryLegacyScanFailed: '无法扫描旧版浏览器存储。',
    draftRecoveryBackupExported: '已导出“{name}”的备份。',
    draftRecoveryIssueInvalidJson: '旧版数据不是有效 JSON，只能导出原始备份。',
    draftRecoveryIssueIndexOnly: '此记录只是 Maker 列表索引，不包含编辑器文档。',
    draftRecoveryIssueIncompatible: '此旧版 Maker 文档无法在不丢失数据的情况下自动恢复。',
    draftRecoveryIssueOrphanedAssets: '发现了本地 PNG 素材，但没有兼容的 Maker 文档。',
    draftRecoveryIssueMissingDocument: '此记录中没有兼容的 Maker 文档。',
    draftRecoveryIssueScanFailed: '无法读取此旧版数据源；其中其他数据未被修改。',
    draftRecoveryIssueUnknown: '此记录无法自动恢复，请在进行更改前先导出备份。',
    draftRecoveryCopyName: '{name} · 已恢复',
    draftRecoveryChangelog: '从浏览器中保留的本地草稿恢复。',
    draftRecoveryV6Missing: '所选的 v6 Maker 草稿已无法读取。',
    draftRecoveryConnectOwnerWallet: '请连接将拥有恢复后 Maker 副本的钱包。',
    draftRecoverySaveCurrentFirst: '恢复其他草稿前，请先保存当前 Maker。',
    draftRecoveryWalletChanged: '恢复过程中连接的钱包发生了变化。',
    draftRecoveryWalletChangedAfterSave: '保存恢复副本时连接的钱包发生了变化。请重新连接原目标钱包，再到草稿恢复中心查找。',
    draftRecoveryIdentityFailed: '恢复后的 Maker 身份未通过保存后读回验证。',
  },
  ja: {
    draftRecoveryUnknownMaker: '不明な Maker 下書き',
    draftRecoveryUnknownTime: '保存時刻不明',
    draftRecoveryUnknownRevision: 'リビジョン不明',
    draftRecoveryMetrics: 'パーツ {parts} / アイテム {items} / スタイル {styles}',
    draftRecoveryCurrentScanFailed: '現在の Maker ワークスペースをスキャンできませんでした。',
    draftRecoveryLegacyScanFailed: '旧ブラウザ保存領域をスキャンできませんでした。',
    draftRecoveryBackupExported: '「{name}」のバックアップを書き出しました。',
    draftRecoveryIssueInvalidJson: '旧データは有効な JSON ではありません。生のバックアップのみ書き出せます。',
    draftRecoveryIssueIndexOnly: 'これは Maker 一覧の索引だけで、エディター文書を含みません。',
    draftRecoveryIssueIncompatible: 'この旧 Maker 文書は、データを失わずに自動復元できません。',
    draftRecoveryIssueOrphanedAssets: '互換 Maker 文書のないローカル PNG 素材が見つかりました。',
    draftRecoveryIssueMissingDocument: 'この記録に互換 Maker 文書がありません。',
    draftRecoveryIssueScanFailed: 'この旧データ元を読み込めませんでした。他のデータは変更していません。',
    draftRecoveryIssueUnknown: 'この記録は自動復元できません。変更前にバックアップを書き出してください。',
    draftRecoveryCopyName: '{name} · 復旧済み',
    draftRecoveryChangelog: 'ブラウザに保存されていたローカル下書きから復旧しました。',
    draftRecoveryV6Missing: '選択した v6 Maker 下書きは利用できなくなりました。',
    draftRecoveryConnectOwnerWallet: '復旧する Maker コピーを所有するウォレットを接続してください。',
    draftRecoverySaveCurrentFirst: '別の下書きを復旧する前に、現在の Maker を保存してください。',
    draftRecoveryWalletChanged: '復旧中に接続ウォレットが変更されました。',
    draftRecoveryWalletChangedAfterSave: '復旧コピーの保存中に接続ウォレットが変更されました。元の保存先ウォレットを再接続し、下書き復旧センターで確認してください。',
    draftRecoveryIdentityFailed: '復旧した Maker の識別情報が保存後の読み戻し検証に失敗しました。',
  },
  ko: {
    draftRecoveryUnknownMaker: '알 수 없는 Maker 초안',
    draftRecoveryUnknownTime: '저장 시간 알 수 없음',
    draftRecoveryUnknownRevision: '리비전 알 수 없음',
    draftRecoveryMetrics: '파트 {parts} / 아이템 {items} / 스타일 {styles}',
    draftRecoveryCurrentScanFailed: '현재 Maker 작업공간을 스캔하지 못했습니다.',
    draftRecoveryLegacyScanFailed: '이전 브라우저 저장소를 스캔하지 못했습니다.',
    draftRecoveryBackupExported: '“{name}” 백업을 내보냈습니다.',
    draftRecoveryIssueInvalidJson: '이전 값이 유효한 JSON이 아닙니다. 원시 백업만 내보낼 수 있습니다.',
    draftRecoveryIssueIndexOnly: 'Maker 목록 인덱스만 있으며 편집기 문서가 없습니다.',
    draftRecoveryIssueIncompatible: '이전 Maker 문서는 데이터 손실 없이 자동 복원할 수 없습니다.',
    draftRecoveryIssueOrphanedAssets: '호환 Maker 문서 없이 로컬 PNG 에셋만 발견되었습니다.',
    draftRecoveryIssueMissingDocument: '이 기록에서 호환 Maker 문서를 찾지 못했습니다.',
    draftRecoveryIssueScanFailed: '이전 데이터 소스를 읽지 못했습니다. 다른 데이터는 수정하지 않았습니다.',
    draftRecoveryIssueUnknown: '이 기록은 자동 복원할 수 없습니다. 변경하기 전에 백업을 내보내세요.',
    draftRecoveryCopyName: '{name} · 복구됨',
    draftRecoveryChangelog: '브라우저에 보존된 로컬 초안에서 복구했습니다.',
    draftRecoveryV6Missing: '선택한 v6 Maker 초안을 더 이상 사용할 수 없습니다.',
    draftRecoveryConnectOwnerWallet: '복구한 Maker 복사본을 소유할 지갑을 연결하세요.',
    draftRecoverySaveCurrentFirst: '다른 초안을 복구하기 전에 현재 Maker를 저장하세요.',
    draftRecoveryWalletChanged: '복구 중 연결된 지갑이 변경되었습니다.',
    draftRecoveryWalletChangedAfterSave: '복구 복사본을 저장하는 동안 연결된 지갑이 변경되었습니다. 원래 대상 지갑을 다시 연결한 뒤 초안 복구 센터에서 확인하세요.',
    draftRecoveryIdentityFailed: '복구한 Maker의 식별 정보가 저장 후 재확인에 실패했습니다.',
  },
  vi: {
    draftRecoveryUnknownMaker: 'Bản nháp Maker không xác định',
    draftRecoveryUnknownTime: 'Không rõ thời gian lưu',
    draftRecoveryUnknownRevision: 'Không rõ bản sửa đổi',
    draftRecoveryMetrics: '{parts} Bộ phận / {items} Vật phẩm / {styles} Kiểu',
    draftRecoveryCurrentScanFailed: 'Không thể quét không gian Maker hiện tại.',
    draftRecoveryLegacyScanFailed: 'Không thể quét bộ nhớ trình duyệt cũ.',
    draftRecoveryBackupExported: 'Đã xuất bản sao lưu “{name}”.',
    draftRecoveryIssueInvalidJson: 'Giá trị cũ không phải JSON hợp lệ. Chỉ có thể xuất bản sao lưu thô.',
    draftRecoveryIssueIndexOnly: 'Đây chỉ là mục trong danh sách Maker và không có tài liệu trình sửa.',
    draftRecoveryIssueIncompatible: 'Không thể tự động khôi phục tài liệu Maker cũ này mà không mất dữ liệu.',
    draftRecoveryIssueOrphanedAssets: 'Đã tìm thấy tài nguyên PNG cục bộ nhưng không có tài liệu Maker tương thích.',
    draftRecoveryIssueMissingDocument: 'Không tìm thấy tài liệu Maker tương thích trong bản ghi này.',
    draftRecoveryIssueScanFailed: 'Không thể đọc nguồn dữ liệu cũ này. Dữ liệu khác không bị thay đổi.',
    draftRecoveryIssueUnknown: 'Không thể tự động khôi phục bản ghi này. Hãy xuất bản sao lưu trước khi thay đổi.',
    draftRecoveryCopyName: '{name} · Đã khôi phục',
    draftRecoveryChangelog: 'Được khôi phục từ bản nháp cục bộ còn lưu trong trình duyệt.',
    draftRecoveryV6Missing: 'Bản nháp Maker v6 đã chọn không còn khả dụng.',
    draftRecoveryConnectOwnerWallet: 'Hãy kết nối ví sẽ sở hữu bản sao Maker được khôi phục.',
    draftRecoverySaveCurrentFirst: 'Hãy lưu Maker hiện tại trước khi khôi phục bản nháp khác.',
    draftRecoveryWalletChanged: 'Ví đang kết nối đã thay đổi trong khi khôi phục.',
    draftRecoveryWalletChangedAfterSave: 'Ví đang kết nối đã thay đổi trong khi lưu bản sao khôi phục. Hãy kết nối lại ví đích ban đầu rồi tìm bản sao trong Trung tâm khôi phục bản nháp.',
    draftRecoveryIdentityFailed: 'Danh tính Maker được khôi phục không vượt qua bước xác minh đọc lại sau khi lưu.',
  },
};

Object.entries(draftRecoveryProductionI18n).forEach(([locale, details]) => Object.assign(i18n[locale], details));

const visualThemeI18n = {
  en: {
    visualThemeLabel: 'Visual theme',
    themeButtonAria: 'Choose visual theme',
    themeAuto: 'Automatic',
    themeAutoCopy: 'Use Animacraft by default',
    themeAnimacraft: 'Animacraft',
    themeAnimacraftCopy: 'Light maker workspace',
    themeSoulidity: 'Soulidity',
    themeSoulidityCopy: 'Dark Soulidity workspace',
  },
  zh: {
    visualThemeLabel: '视觉主题',
    themeButtonAria: '选择视觉主题',
    themeAuto: '自动',
    themeAutoCopy: '默认使用 Animacraft',
    themeAnimacraft: 'Animacraft',
    themeAnimacraftCopy: '浅色 Maker 创作空间',
    themeSoulidity: 'Soulidity',
    themeSoulidityCopy: '深色 Soulidity 创作空间',
  },
  ja: {
    visualThemeLabel: '表示テーマ',
    themeButtonAria: '表示テーマを選択',
    themeAuto: '自動',
    themeAutoCopy: 'デフォルトでは Animacraft を使用',
    themeAnimacraft: 'Animacraft',
    themeAnimacraftCopy: '明るい Maker ワークスペース',
    themeSoulidity: 'Soulidity',
    themeSoulidityCopy: '暗い Soulidity ワークスペース',
  },
  ko: {
    visualThemeLabel: '화면 테마',
    themeButtonAria: '화면 테마 선택',
    themeAuto: '자동',
    themeAutoCopy: '기본값으로 Animacraft 사용',
    themeAnimacraft: 'Animacraft',
    themeAnimacraftCopy: '밝은 Maker 작업 공간',
    themeSoulidity: 'Soulidity',
    themeSoulidityCopy: '어두운 Soulidity 작업 공간',
  },
  vi: {
    visualThemeLabel: 'Giao diện hiển thị',
    themeButtonAria: 'Chọn giao diện hiển thị',
    themeAuto: 'Tự động',
    themeAutoCopy: 'Mặc định dùng Animacraft',
    themeAnimacraft: 'Animacraft',
    themeAnimacraftCopy: 'Không gian Maker nền sáng',
    themeSoulidity: 'Soulidity',
    themeSoulidityCopy: 'Không gian Soulidity nền tối',
  },
};

Object.entries(visualThemeI18n).forEach(([locale, details]) => Object.assign(i18n[locale], details));

const makerLifecycleConflictI18n = {
  en: {
    makerVersionDraftConflict: 'A newer on-chain version {version} was published from {parent} in another session. Discard this local draft, sync the latest chain version, then start a new version before publishing.',
    makerVersionLineageFork: 'This Maker has multiple on-chain successors ({versions}) from parent {parent}. Creating or publishing another version is locked until the lineage fork is resolved by a protocol upgrade.',
  },
  zh: {
    makerVersionDraftConflict: '另一个会话已从 {parent} 发布了更新的链上版本 {version}。请先丢弃此本地版本草稿、同步最新链上版本，再创建新版本后发布。',
    makerVersionLineageFork: '此 Maker 已从父版本 {parent} 产生多个链上后继版本（{versions}）。在协议升级解决这条分叉之前，系统将锁定继续创建或发布版本。',
  },
  ja: {
    makerVersionDraftConflict: '別のセッションで {parent} から新しいオンチェーン版 {version} が公開されました。このローカル下書きを破棄し、最新のチェーン版を同期してから新しい版を作成してください。',
    makerVersionLineageFork: 'この Maker では親バージョン {parent} から複数のオンチェーン後継版（{versions}）が公開されています。プロトコル更新で分岐が解決されるまで、新しい版の作成と公開はロックされます。',
  },
  ko: {
    makerVersionDraftConflict: '다른 세션에서 {parent} 기반의 더 최신 온체인 버전 {version}이 게시되었습니다. 이 로컬 버전 초안을 폐기하고 최신 체인 버전을 동기화한 뒤 새 버전을 만들어 게시하세요.',
    makerVersionLineageFork: '이 Maker는 상위 버전 {parent}에서 여러 온체인 후속 버전({versions})이 생성되었습니다. 프로토콜 업그레이드로 분기가 해결될 때까지 새 버전 생성과 게시가 잠깁니다.',
  },
  vi: {
    makerVersionDraftConflict: 'Một phiên khác đã đăng phiên bản on-chain mới hơn {version} từ {parent}. Hãy bỏ bản nháp cục bộ này, đồng bộ phiên bản mới nhất rồi tạo phiên bản mới trước khi đăng.',
    makerVersionLineageFork: 'Maker này có nhiều phiên bản kế nhiệm on-chain ({versions}) từ phiên bản cha {parent}. Việc tạo hoặc đăng phiên bản mới bị khóa cho đến khi nâng cấp giao thức giải quyết nhánh rẽ.',
  },
};

Object.entries(makerLifecycleConflictI18n).forEach(([locale, details]) => Object.assign(i18n[locale], details));

const requiredLocaleKeys = Object.keys(i18n.en);
Object.entries(i18n).forEach(([locale, dictionary]) => {
  const missing = requiredLocaleKeys.filter((key) => !Object.hasOwn(dictionary, key));
  if (missing.length) throw new Error(`Locale ${locale} is missing: ${missing.join(', ')}`);
});

const protocolSteps = [
  ['01', 'docsProtocolStep1Title', 'docsProtocolStep1Copy'],
  ['02', 'docsProtocolStep2Title', 'docsProtocolStep2Copy'],
  ['03', 'docsProtocolStep3Title', 'docsProtocolStep3Copy'],
  ['04', 'docsProtocolStep4Title', 'docsProtocolStep4Copy'],
  ['05', 'docsProtocolStep5Title', 'docsProtocolStep5Copy'],
  ['06', 'docsProtocolStep6Title', 'docsProtocolStep6Copy'],
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
    base: 'porcelain',
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
  makerDocumentV4: null,
  makerRecipeV4: null,
  makerRuntimeAssetsV4: new Map(),
  publishedMakerDocumentV4: null,
  publishedMakerRecipeV4: null,
  publishedMakerVersions: [],
  playerRecipeV4: null,
  playerProfileV4: null,
  playerRuntimeDocumentV4: null,
  playerCompletionSnapshotV4: null,
  livingContent: createDefaultLivingContent(),
  livingDocument: 'soulMd',
  walletConnected: false,
  walletAddress: '',
  walletProvider: null,
  walletStatus: 'disconnected',
  publishing: false,
  makerReleaseInFlight: false,
  makerLifecycleActionBusy: false,
  publishStatus: '',
  publishStatusI18n: null,
  publishDigest: '',
  makerPublishError: null,
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
  pendingMakerV4Bundle: null,
  makerPublicationIntent: null,
  minting: false,
  mintStatus: '',
  mintDigest: '',
  ocPublishError: null,
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
  draftRecoveryStatus: 'idle',
  draftRecoveryRecords: [],
  draftRecoveryError: '',
  draftRecoveryMessage: '',
  draftRecoveryBusyId: '',
  locale: Object.hasOwn(i18n, localStorage.getItem('animacraft-locale') || '') ? localStorage.getItem('animacraft-locale') : 'en',
};

if (makerStorageInitializationError) {
  state.draftSaveStatus = 'error';
  state.draftSaveMessage = makerStorageInitializationError.message
    || 'Close other Animacraft tabs and reload once to initialize Maker draft storage.';
}

const makerModels = new Map();
const loadedMakerDrafts = new Set();
const loadedLocalMakerIndexes = new Set();
const loadedStableMakerIndexes = new Set();
const loadedMakerAssetDrafts = new Set();
const loadedMakerUploadRecoveries = new Set();
const loadedOcUploadRecoveries = new Set();
const localMakerCoverObjectUrls = new Map();
const localMakerCoverRestoreTokens = new Map();
let pendingConfirmation = null;
let confirmationReturnFocus = null;
let confirmationSuspendedLifecycle = false;
let makerLifecycleManagerReturnFocus = null;
let makerLifecycleManagerSyncRequestId = 0;
let makerWorkspaceLifecycleOperationId = 0;
let makerAutosaveTimer = null;
let makerWorkspace = null;
let draftRecoveryRequestId = 0;
let makerPublicationRecoveryTimer = null;
let makerUploadRestoreRequestId = 0;
let ocUploadRestoreRequestId = 0;
let makerChainOperationId = 0;
let ocChainOperationId = 0;
let treasuryBalanceRequestId = 0;
let chainMakerLoadRequestId = 0;
const makerUploadRestoreRequests = new Map();
const ocUploadRestoreRequests = new Map();

function makerDraftStorageKey(
  templateId = state.templateId,
  walletAddress = state.walletAddress,
) {
  return `animacraft-maker-draft-v2:${walletAddress || 'local'}:${templateId}`;
}

function makerAssetStorageKey(
  templateId = state.templateId,
  walletAddress = state.walletAddress,
) {
  return `${walletAddress || 'local'}:${templateId}`;
}

function ocUploadStorageKey(templateId = state.templateId) {
  const template = templates.find((candidate) => candidate.id === templateId);
  return `${state.walletAddress || 'local'}:oc:${template?.objectId || runtimeConfig.featuredMakers?.[templateId] || templateId}`;
}

function beginMakerChainOperation({ bindMakerObject = false } = {}) {
  return Object.freeze({
    id: ++makerChainOperationId,
    recoveryKey: makerAssetStorageKey(),
    templateId: state.templateId,
    walletAddress: state.walletAddress,
    makerObjectId: bindMakerObject ? suiJsonId(state.makerObjectId) : '',
  });
}

function makerChainOperationIsActive(operation) {
  return Boolean(
    operation
    && operation.id === makerChainOperationId
    && operation.templateId === state.templateId
    && operation.walletAddress === state.walletAddress
    && operation.recoveryKey === makerAssetStorageKey()
    && (
      !operation.makerObjectId
      || comparableSuiId(operation.makerObjectId) === comparableSuiId(state.makerObjectId)
    ),
  );
}

function beginPublishedMakerVersionOperation(makerObjectId) {
  const targetMakerObjectId = suiJsonId(makerObjectId);
  const template = activeTemplate();
  const document = currentMakerV4Source();
  return Object.freeze({
    id: ++makerChainOperationId,
    templateId: state.templateId,
    walletAddress: state.walletAddress,
    recoveryKey: makerAssetStorageKey(),
    rootMakerId: document?.version?.rootMakerId || template?.id || state.templateId,
    targetMakerObjectId,
  });
}

function publishedMakerVersionOperationIsActive(operation) {
  const activeRootMakerId = currentMakerV4Source()?.version?.rootMakerId
    || activeTemplate()?.id
    || state.templateId;
  if (
    !operation
    || operation.id !== makerChainOperationId
    || operation.templateId !== state.templateId
    || operation.walletAddress !== state.walletAddress
    || operation.recoveryKey !== makerAssetStorageKey()
    || operation.rootMakerId !== activeRootMakerId
  ) return false;
  return publishedMakerVersionHistory().some((entry) => (
    comparableSuiId(entry.makerObjectId)
    === comparableSuiId(operation.targetMakerObjectId)
  ));
}

function invalidateChainMakerDiscovery() {
  chainMakerLoadRequestId += 1;
  state.chainMakersLoading = false;
  state.chainMakersLoadedFor = '';
  state.chainMakerLoadError = '';
}

function reloadChainMakerDiscoveryAfterOperation(operation) {
  if (
    !operation
    || !state.walletConnected
    || operation.walletAddress !== state.walletAddress
  ) return;
  state.chainMakersLoadedFor = '';
  void loadChainMakers(operation.walletAddress);
}

function captureMakerWorkspaceOperation() {
  const document = currentMakerV4Source();
  const rootMakerId = document?.version?.rootMakerId
    || activeTemplate()?.id
    || state.templateId;
  return Object.freeze({
    templateId: state.templateId,
    walletAddress: state.walletAddress,
    makerKey: `${state.walletAddress || 'wallet'}:${rootMakerId}`,
  });
}

function makerWorkspaceOperationIsActive(operation) {
  return Boolean(
    operation
    && operation.templateId === state.templateId
    && operation.walletAddress === state.walletAddress
    && operation.makerKey === makerWorkspace?.makerKey
  );
}

function beginOcChainOperation() {
  return Object.freeze({
    id: ++ocChainOperationId,
    recoveryKey: ocUploadStorageKey(),
    templateId: state.templateId,
    walletAddress: state.walletAddress,
  });
}

function ocChainOperationIsActive(operation) {
  return Boolean(
    operation
    && operation.id === ocChainOperationId
    && operation.templateId === state.templateId
    && operation.walletAddress === state.walletAddress
    && operation.recoveryKey === ocUploadStorageKey(),
  );
}

function defaultMakerVisual() {
  return structuredClone({
    background: 'dawn',
    base: 'porcelain',
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
    makerDocumentV4: null,
    makerRecipeV4: null,
    makerRuntimeAssetsV4: new Map(),
    publishedMakerDocumentV4: null,
    publishedMakerRecipeV4: null,
    publishedMakerVersions: [],
    publishDigest: '',
    publishStatus: '',
    makerObjectId: '',
    makerTreasuryObjectId: '',
    makerAdminCapObjectId: '',
    makerArchived: false,
    pausedEconomics: null,
    makerPublicationIntent: null,
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
    makerDocumentV4: state.makerDocumentV4,
    makerRecipeV4: state.makerRecipeV4,
    makerRuntimeAssetsV4: state.makerRuntimeAssetsV4,
    publishedMakerDocumentV4: state.publishedMakerDocumentV4,
    publishedMakerRecipeV4: state.publishedMakerRecipeV4,
    publishedMakerVersions: state.publishedMakerVersions,
    publishDigest: state.publishDigest,
    publishStatus: state.publishStatus,
    publishStatusI18n: state.publishStatusI18n,
    makerObjectId: state.makerObjectId,
    makerTreasuryObjectId: state.makerTreasuryObjectId,
    makerAdminCapObjectId: state.makerAdminCapObjectId,
    makerArchived: state.makerArchived,
    pausedEconomics: activeTemplate()?.pausedEconomics || null,
    makerPublicationIntent: state.makerPublicationIntent,
  });
}

function resetOcUploadState() {
  ocUploadRestoreRequestId += 1;
  ocChainOperationId += 1;
  state.minting = false;
  state.mintStatus = '';
  state.mintDigest = '';
  state.ocPublishError = null;
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

function resetMakerUploadMemoryState({ clearPublicationIntent = true } = {}) {
  makerUploadRestoreRequestId += 1;
  makerChainOperationId += 1;
  makerWorkspaceLifecycleOperationId += 1;
  treasuryBalanceRequestId += 1;
  state.treasuryBalanceLoading = false;
  if (makerPublicationRecoveryTimer) {
    clearTimeout(makerPublicationRecoveryTimer);
    makerPublicationRecoveryTimer = null;
  }
  state.publishing = false;
  state.makerReleaseInFlight = false;
  state.makerLifecycleActionBusy = false;
  state.makerUploadSession = null;
  state.pendingMakerAssets = [];
  state.makerUploadStage = 'idle';
  state.makerQuiltId = '';
  state.pendingMakerCoverBlob = null;
  state.hasMakerUploadRecovery = false;
  state.pendingMakerManifestJson = '';
  state.pendingMakerV4Bundle = null;
  if (clearPublicationIntent) state.makerPublicationIntent = null;
  clearMakerPublishError();
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
  state.makerDocumentV4 = model.makerDocumentV4 || null;
  state.makerRecipeV4 = model.makerRecipeV4 || null;
  state.makerRuntimeAssetsV4 = model.makerRuntimeAssetsV4 instanceof Map ? model.makerRuntimeAssetsV4 : new Map();
  state.publishedMakerDocumentV4 = model.publishedMakerDocumentV4 || (model.makerDocumentV4?.version?.createdAt ? model.makerDocumentV4 : null);
  state.publishedMakerRecipeV4 = model.publishedMakerRecipeV4
    || state.publishedMakerDocumentV4?.defaultRecipe
    || null;
  state.publishedMakerVersions = Array.isArray(model.publishedMakerVersions)
    ? structuredClone(model.publishedMakerVersions)
    : [];
  state.playerRecipeV4 = null;
  state.playerProfileV4 = null;
  state.playerRuntimeDocumentV4 = null;
  state.playerCompletionSnapshotV4 = null;
  state.publishDigest = model.publishDigest;
  state.publishStatus = model.publishStatus;
  state.publishStatusI18n = model.publishStatusI18n || null;
  state.makerPublishError = null;
  state.makerObjectId = model.makerObjectId || '';
  state.makerTreasuryObjectId = model.makerTreasuryObjectId || '';
  state.makerAdminCapObjectId = model.makerAdminCapObjectId || '';
  if (state.makerTreasuryObjectId !== state.treasuryBalanceLoadedFor) state.treasuryBalanceLoadedFor = '';
  state.makerArchived = Boolean(model.makerArchived);
  if (activeTemplate()) activeTemplate().pausedEconomics = model.pausedEconomics || null;
  resetMakerUploadMemoryState({ clearPublicationIntent: false });
  state.makerPublicationIntent = model.makerPublicationIntent || null;
  state.selectedSlot = state.slotOrder[0] || '';
  state.selectedItem = state.selectedSlot ? state.visual[state.selectedSlot] || slotItems(state.selectedSlot)[0]?.id || '' : '';
  const firstLayer = state.selectedSlot ? creatorLayers(allSlots()[0])[0] : null;
  state.selectedLayer = firstLayer ? creatorLayerKey(state.selectedSlot, firstLayer.id) : '';
  state.partSubView = 'items';
}

function activateMakerModel(templateId, options = {}) {
  if (
    (state.publishing || state.makerLifecycleActionBusy || state.minting)
    && templateId !== state.templateId
  ) {
    if (state.publishing) state.publishStatus = t('publishingStatus');
    if (state.minting) state.mintStatus = t('preparingHandoff');
    renderAll();
    return false;
  }
  if (makerAutosaveTimer) {
    clearTimeout(makerAutosaveTimer);
    makerAutosaveTimer = null;
    saveCurrentMakerDraft({ silent: true });
  }
  syncActiveMakerModelRefs();
  if (!makerModels.has(templateId)) makerModels.set(templateId, createMakerModel(options));
  const model = makerModels.get(templateId);
  applyMakerModelToState(templateId, model);
  if (state.walletConnected) {
    const draftKey = makerDraftStorageKey(templateId);
    const draftAlreadyLoaded = loadedMakerDrafts.has(draftKey);
    if (!draftAlreadyLoaded) restoreMakerDraft(templateId);
    if (draftAlreadyLoaded || isMakerV4Document(model.makerDocumentV4)) {
      setTimeout(() => restoreMakerUploadRecovery(templateId, { force: true }), 0);
    }
    if (state.page === 'make') {
      setTimeout(() => restoreOcUploadRecovery(templateId, { force: true }), 0);
    }
  }
  return true;
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
  makerDocumentV4: state.makerDocumentV4,
  makerRecipeV4: state.makerRecipeV4,
  makerRuntimeAssetsV4: state.makerRuntimeAssetsV4,
  publishedMakerDocumentV4: state.publishedMakerDocumentV4,
  publishedMakerRecipeV4: state.publishedMakerRecipeV4,
  publishedMakerVersions: state.publishedMakerVersions,
  publishDigest: state.publishDigest,
  publishStatus: state.publishStatus,
  publishStatusI18n: state.publishStatusI18n,
  makerObjectId: state.makerObjectId,
  makerTreasuryObjectId: state.makerTreasuryObjectId,
  makerAdminCapObjectId: state.makerAdminCapObjectId,
  makerArchived: state.makerArchived,
  pausedEconomics: activeTemplate()?.pausedEconomics || null,
  makerPublicationIntent: state.makerPublicationIntent,
});

function $(id) {
  return document.getElementById(id);
}

function t(key, variables = {}) {
  const template = (i18n[state.locale] && i18n[state.locale][key]) || i18n.en[key] || key;
  return Object.entries(variables).reduce(
    (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
    template,
  );
}

function setLocalizedPublishStatus(key, variables = {}) {
  const normalizedVariables = { ...variables };
  const rendered = t(key, normalizedVariables);
  state.publishStatus = rendered;
  state.publishStatusI18n = {
    key,
    variables: normalizedVariables,
    rendered,
  };
  return rendered;
}

function setLocale(locale) {
  state.locale = i18n[locale] ? locale : 'en';
  localStorage.setItem('animacraft-locale', state.locale);
  document.documentElement.lang = state.locale === 'zh' ? 'zh-CN' : state.locale;
  setWalletModalLocale(state.locale);
  if (
    state.publishStatusI18n
    && state.publishStatusI18n.rendered === state.publishStatus
  ) {
    const rendered = t(
      state.publishStatusI18n.key,
      state.publishStatusI18n.variables,
    );
    state.publishStatus = rendered;
    state.publishStatusI18n.rendered = rendered;
  }
  renderAll();
}

function renderThemeControl() {
  const normalized = visualThemeIds.includes(visualThemePreference) ? visualThemePreference : 'auto';
  const themeButton = $('themeButton');
  if (themeButton) themeButton.dataset.themePreference = normalized;
  document.querySelectorAll('[data-theme-option]').forEach((button) => {
    const selected = button.dataset.themeOption === normalized;
    button.setAttribute('aria-checked', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
}

function setVisualThemePreference(preference) {
  const normalized = visualThemeIds.includes(preference) ? preference : 'auto';
  visualThemePreference = visualThemeRuntime?.setPreference?.(normalized) || normalized;
  if (!visualThemeRuntime) {
    document.documentElement.setAttribute(
      'data-theme',
      normalized === 'soulidity' ? 'soulidity' : 'animacraft',
    );
  }
  renderThemeControl();
}

function syncVisualThemePreference() {
  const persisted = visualThemeRuntime?.readPreference?.();
  const normalized = visualThemeIds.includes(persisted) ? persisted : 'auto';
  visualThemePreference = normalized;
  visualThemeRuntime?.applyPreference?.(normalized);
  renderThemeControl();
}

function renderI18n() {
  document.documentElement.lang = state.locale === 'zh' ? 'zh-CN' : state.locale;
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
    node.setAttribute('placeholder', t(node.dataset.i18nPlaceholder));
  });
  document.querySelectorAll('[data-i18n-title]').forEach((node) => {
    node.setAttribute('title', t(node.dataset.i18nTitle));
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((node) => {
    node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel));
  });
  ['accountLanguage'].forEach((id) => {
    if ($(id)) $(id).value = state.locale;
  });
  renderThemeControl();
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

function makerHasPendingV4Version() {
  return isMakerV4Document(state.makerDocumentV4)
    && isMakerV4Document(state.publishedMakerDocumentV4)
    && state.makerDocumentV4.version.versionId !== state.publishedMakerDocumentV4.version.versionId;
}

function makerModelHasPendingV4Version(model) {
  return isMakerV4Document(model?.makerDocumentV4)
    && isMakerV4Document(model?.publishedMakerDocumentV4)
    && model.makerDocumentV4.version.versionId !== model.publishedMakerDocumentV4.version.versionId;
}

function makerVersionDraftConflict(template = activeTemplate()) {
  const model = template ? makerModels.get(template.id) : null;
  const isActive = Boolean(template && template.id === state.templateId);
  const workingDocument = isActive
    ? state.makerDocumentV4
    : model?.makerDocumentV4;
  const publishedDocument = isActive
    ? state.publishedMakerDocumentV4
    : model?.publishedMakerDocumentV4;
  if (!isMakerV4Document(workingDocument) || !isMakerV4Document(publishedDocument)) {
    return null;
  }
  return findMakerVersionDraftConflict({
    workingDocument,
    publishedDocument,
    publishedVersions: publishedMakerVersionHistory(template),
    currentMakerObjectId: isActive
      ? state.makerObjectId || template?.objectId
      : model?.makerObjectId || template?.objectId,
  });
}

function directPublishedMakerSuccessor(
  document = state.publishedMakerDocumentV4,
  template = activeTemplate(),
) {
  const currentVersionId = String(document?.version?.versionId || '');
  if (!currentVersionId) return null;
  return publishedMakerVersionHistory(template)
    .filter((version) => (
      String(version.parentVersionId || '') === currentVersionId
      && String(version.versionId || '') !== currentVersionId
    ))
    .sort((left, right) => (
      Number(right.versionNumber || 0) - Number(left.versionNumber || 0)
      || Number(right.profileOrder ?? -1) - Number(left.profileOrder ?? -1)
    ))[0] || null;
}

function makerPublishedLineageFork(template = activeTemplate()) {
  const versionsByParent = new Map();
  publishedMakerVersionHistory(template).forEach((version) => {
    const parentVersionId = String(version.parentVersionId || '');
    const versionId = String(version.versionId || '');
    const makerObjectId = comparableSuiId(version.makerObjectId);
    if (!parentVersionId || !versionId || !makerObjectId) return;
    const siblings = versionsByParent.get(parentVersionId) || new Map();
    siblings.set(`${versionId}:${makerObjectId}`, version);
    versionsByParent.set(parentVersionId, siblings);
  });
  return [...versionsByParent.entries()]
    .map(([parentVersionId, siblings]) => ({
      parentVersionId,
      versions: [...siblings.values()].sort((left, right) => (
        Number(right.versionNumber || 0) - Number(left.versionNumber || 0)
        || String(right.versionId || '').localeCompare(
          String(left.versionId || ''),
          undefined,
          { numeric: true },
        )
        || comparableSuiId(right.makerObjectId).localeCompare(
          comparableSuiId(left.makerObjectId),
        )
      )),
    }))
    .filter((fork) => fork.versions.length > 1)
    .sort((left, right) => (
      left.parentVersionId.localeCompare(right.parentVersionId)
    ))[0] || null;
}

function makerVersionDraftConflictMessage(
  conflict = makerVersionDraftConflict(),
  document = currentMakerV4Source(),
) {
  if (!conflict) return '';
  return t('makerVersionDraftConflict', {
    version: conflict.versionId || '—',
    parent: document?.version?.parentVersionId || '—',
  });
}

function makerVersionLineageForkMessage(fork = makerPublishedLineageFork()) {
  if (!fork) return '';
  return t('makerVersionLineageFork', {
    parent: fork.parentVersionId,
    versions: fork.versions.map((version) => version.versionId).join(', '),
  });
}

function makerLifecycleDescriptor(template = activeTemplate()) {
  const model = template ? makerModels.get(template.id) : null;
  const isActive = Boolean(template && template.id === state.templateId);
  const published = template?.source === 'chain' || Boolean(
    isActive
      ? state.publishDigest || state.makerObjectId
      : model?.publishDigest || model?.makerObjectId,
  );
  const versionDraft = isActive
    ? makerHasPendingV4Version()
    : makerModelHasPendingV4Version(model);
  const versionConflict = versionDraft
    ? makerVersionDraftConflict(template)
    : null;
  const lineageFork = published
    ? makerPublishedLineageFork(template)
    : null;
  const archived = published && Boolean(isActive ? state.makerArchived : model?.makerArchived);
  const mintingEnabled = template?.mintingEnabled !== false;
  const hasActivePublicationCheckpoint = isActive && (
    state.makerUploadStage !== 'idle'
    || state.hasMakerUploadRecovery
    || makerPublicationRecoveryPending()
  );
  const hasStoredPublicationIntent = Boolean(
    isActive ? state.makerPublicationIntent : model?.makerPublicationIntent,
  );
  const publicationInFlight = isActive && state.makerReleaseInFlight;

  let id = template?.source === 'local' ? 'draft' : 'starter';
  if (publicationInFlight) id = 'publishing';
  else if (hasActivePublicationCheckpoint || hasStoredPublicationIntent) id = 'recoverable';
  else if (versionDraft) id = 'version-draft';
  else if (archived) id = 'archived';
  else if (published && !mintingEnabled) id = 'paused';
  else if (published) id = 'active';

  const details = {
    draft: ['makerLifecycleDraft', 'draftLifecycleCopy'],
    starter: ['makerLifecycleStarter', 'starterLifecycleCopy'],
    publishing: ['makerLifecyclePublishing', 'publishingLifecycleCopy'],
    recoverable: ['makerLifecycleRecoverable', 'recoverableLifecycleCopy'],
    active: ['makerLifecycleActive', 'activeLifecycleCopy'],
    paused: ['makerLifecyclePaused', 'pausedLifecycleCopy'],
    archived: ['makerLifecycleArchived', 'archivedLifecycleCopy'],
    'version-draft': ['makerLifecycleVersionDraft', 'versionLifecycleCopy'],
  }[id];
  const copyVariables = id === 'version-draft'
    ? {
        current: (isActive ? state.makerDocumentV4 : model?.makerDocumentV4)?.version?.versionId || 'current',
        previous: (isActive ? state.publishedMakerDocumentV4 : model?.publishedMakerDocumentV4)?.version?.versionId || 'previous',
      }
    : {};
  return {
    id,
    badgeClass: id,
    labelKey: details[0],
    copyKey: details[1],
    copyVariables,
    published,
    versionDraft,
    versionConflict,
    lineageFork,
    archived,
    mintingEnabled,
  };
}

function ensureMakerEditable() {
  if (makerPublicationRecoveryPending()) {
    state.publishStatus = t('publicationPendingReview');
    renderPublishAction();
    return false;
  }
  if (!makerIsPublished() || makerHasPendingV4Version()) return true;
  state.publishStatus = makerPublishedLineageFork()
    ? makerVersionLineageForkMessage()
    : state.makerArchived
      ? t('archivedMakerImmutable')
      : t('makerLifecycleStartVersionCopy');
  renderPublishAction();
  return false;
}

function localMakerIndexKey(address = state.walletAddress) {
  return `animacraft-local-makers-v6:${address || 'local'}`;
}

function stableMakerCoverUrl(value) {
  const candidate = String(value || '').trim();
  if (!candidate || candidate.startsWith('blob:')) return '';
  return safeExternalUrl(candidate);
}

function normalizedMakerUpdatedAtMs(value) {
  const candidate = String(value ?? '').trim();
  if (!/^\d+$/.test(candidate)) return '';
  try {
    const normalized = BigInt(candidate);
    return normalized > 0n ? normalized.toString() : '';
  } catch {
    return '';
  }
}

function walletAddressesMatch(left, right) {
  const normalizedLeft = String(left || '').trim().toLowerCase();
  const normalizedRight = String(right || '').trim().toLowerCase();
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function templateIsOwnedByWallet(
  template = activeTemplate(),
  walletAddress = state.walletAddress,
) {
  if (!template || !walletAddressesMatch(template.owner, walletAddress)) return false;
  return template.source === 'chain'
    ? template.owned === true
    : template.source === 'local';
}

function normalizedPausedEconomicsMutationWitness(value) {
  if (!value || typeof value !== 'object') return null;
  const digest = String(value.digest || '').trim().slice(0, 256);
  const kind = ['pause', 'archive', 'restore'].includes(value.kind)
    ? value.kind
    : '';
  const createdAt = String(value.createdAt || '');
  if (!digest || !kind || !createdAt || !Number.isFinite(Date.parse(createdAt))) {
    return null;
  }
  return {
    digest,
    kind,
    expectedMintingEnabled: Boolean(value.expectedMintingEnabled),
    expectedArchived: typeof value.expectedArchived === 'boolean'
      ? value.expectedArchived
      : null,
    createdAt,
  };
}

function normalizedWorkspacePausedEconomics(value, makerObjectId = '') {
  if (!value || typeof value !== 'object') return null;
  const pausedMakerObjectId = suiJsonId(value.makerObjectId);
  const expectedMakerObjectId = suiJsonId(makerObjectId);
  if (
    !pausedMakerObjectId
    || (expectedMakerObjectId && comparableSuiId(pausedMakerObjectId) !== comparableSuiId(expectedMakerObjectId))
  ) return null;
  const capturedAt = String(value.capturedAt || '');
  if (!capturedAt || !Number.isFinite(Date.parse(capturedAt))) return null;
  return {
    makerObjectId: pausedMakerObjectId,
    mintFeeEnabled: Boolean(value.mintFeeEnabled),
    mintPriceAtomic: Math.max(0, Math.floor(Number(value.mintPriceAtomic || 0))),
    royaltyBps: Math.max(0, Math.min(10_000, Math.floor(Number(value.royaltyBps || 0)))),
    makerUpdatedAtMs: normalizedMakerUpdatedAtMs(value.makerUpdatedAtMs),
    pendingMutation: normalizedPausedEconomicsMutationWitness(
      value.pendingMutation,
    ),
    capturedAt,
  };
}

function pausedEconomicsForLiveMaker(value, {
  makerObjectId = '',
  mintingEnabled = true,
  makerUpdatedAtMs = '',
  makerArchived = null,
  makerPreviousTransaction = '',
} = {}) {
  const snapshot = normalizedWorkspacePausedEconomics(value, makerObjectId);
  if (!snapshot) return null;
  const liveTimestamp = normalizedMakerUpdatedAtMs(makerUpdatedAtMs);
  const witness = snapshot.pendingMutation;
  if (witness) {
    const expectedStateVisible = (
      mintingEnabled === witness.expectedMintingEnabled
      && (
        witness.expectedArchived === null
        || Boolean(makerArchived) === witness.expectedArchived
      )
    );
    const witnessTransactionVisible = Boolean(
      makerPreviousTransaction
      && String(makerPreviousTransaction) === witness.digest,
    );
    if (witnessTransactionVisible && expectedStateVisible) {
      return liveTimestamp
        ? {
            ...snapshot,
            makerUpdatedAtMs: liveTimestamp,
            pendingMutation: null,
          }
        : snapshot;
    }
    // A bounded read immediately after broadcast may still return the exact
    // pre-mutation object. Keep the witness only while its chain timestamp is
    // unchanged. Any unrelated later transaction invalidates the snapshot.
    if (
      liveTimestamp
      && snapshot.makerUpdatedAtMs
      && liveTimestamp === snapshot.makerUpdatedAtMs
    ) return snapshot;
    return null;
  }
  if (mintingEnabled) return null;
  return (
    liveTimestamp
    && snapshot.makerUpdatedAtMs
    && snapshot.makerUpdatedAtMs === liveTimestamp
  )
    ? snapshot
    : null;
}

function pausedEconomicsWithMutationWitness(value, {
  digest = '',
  kind = '',
  expectedMintingEnabled = false,
  expectedArchived = null,
} = {}) {
  const snapshot = normalizedWorkspacePausedEconomics(value);
  const pendingMutation = normalizedPausedEconomicsMutationWitness({
    digest,
    kind,
    expectedMintingEnabled,
    expectedArchived,
    createdAt: new Date().toISOString(),
  });
  return snapshot && pendingMutation
    ? {
        ...snapshot,
        pendingMutation,
      }
    : snapshot;
}

function pausedEconomicsWithRecoveredLocalWitness(
  durableValue,
  localValue,
  makerObjectId = '',
) {
  const durable = normalizedWorkspacePausedEconomics(
    durableValue,
    makerObjectId,
  );
  // An explicit durable null is the Resume tombstone and must never be
  // resurrected from localStorage.
  if (!durable) return null;
  if (durable.pendingMutation) return durable;
  const local = normalizedWorkspacePausedEconomics(localValue, makerObjectId);
  if (!local?.pendingMutation) return durable;
  const sameSnapshot = (
    comparableSuiId(local.makerObjectId) === comparableSuiId(durable.makerObjectId)
    && local.mintFeeEnabled === durable.mintFeeEnabled
    && local.mintPriceAtomic === durable.mintPriceAtomic
    && local.royaltyBps === durable.royaltyBps
    && local.makerUpdatedAtMs === durable.makerUpdatedAtMs
    && local.capturedAt === durable.capturedAt
  );
  return sameSnapshot
    ? {
        ...durable,
        pendingMutation: local.pendingMutation,
      }
    : durable;
}

function activePausedEconomicsSnapshot() {
  return normalizedWorkspacePausedEconomics(
    activeTemplate()?.pausedEconomics,
    state.makerObjectId || activeTemplate()?.objectId,
  );
}

function setActivePausedEconomicsSnapshot(value) {
  const template = activeTemplate();
  if (!template) return null;
  const makerObjectId = state.makerObjectId || template.objectId;
  const snapshot = normalizedWorkspacePausedEconomics(value, makerObjectId);
  template.pausedEconomics = snapshot;
  const model = makerModels.get(template.id);
  if (model) model.pausedEconomics = snapshot;
  syncActiveMakerModelRefs();
  persistLocalMakerIndex(template.owner || state.walletAddress);
  return snapshot;
}

async function persistActiveMakerLifecycleBinding({ required = false } = {}) {
  syncActiveMakerModelRefs();
  persistLocalMakerIndex(activeTemplate()?.owner || state.walletAddress);
  try {
    const result = await saveCurrentMakerDraft({
      silent: true,
      forceWorkspace: true,
    });
    if (result?.confirmed) return true;
  } catch (error) {
    console.warn('Maker lifecycle Workspace persistence failed.', error);
  }
  state.draftSaveStatus = 'error';
  state.draftSaveMessage = t('localDraftSaveFailed');
  if (required) {
    throw makerAuthorityError(
      'MAKER_ECONOMICS_SNAPSHOT_SAVE_FAILED',
      'makerLifecycleEconomicsSnapshotSaveFailed',
    );
  }
  return false;
}

function normalizedPublishedMakerVersion(value, {
  rootMakerId = '',
} = {}) {
  if (!value || typeof value !== 'object') return null;
  const makerObjectId = suiJsonId(value.makerObjectId);
  const versionId = safeDraftText(value.versionId, '', 128);
  const recordRootMakerId = safeDraftText(
    value.rootMakerId || rootMakerId,
    '',
    128,
  );
  if (
    !makerObjectId
    || !versionId
    || !recordRootMakerId
    || (rootMakerId && recordRootMakerId !== rootMakerId)
  ) return null;
  const normalized = {
    rootMakerId: recordRootMakerId,
    versionId,
    parentVersionId: safeDraftText(value.parentVersionId, '', 128),
    versionNumber: Math.max(0, Math.floor(Number(value.versionNumber || 0))),
    profileOrder: Math.max(-1, Math.floor(Number(value.profileOrder ?? -1))),
    makerObjectId,
    makerTreasuryObjectId: suiJsonId(value.makerTreasuryObjectId),
    publishDigest: safeDraftText(value.publishDigest, '', 256),
    archived: Boolean(value.archived),
    mintingEnabled: value.mintingEnabled !== false,
    mintFeeEnabled: Boolean(value.mintFeeEnabled),
    mintPriceAtomic: Math.max(0, Math.floor(Number(value.mintPriceAtomic || 0))),
    royaltyBps: Math.max(0, Math.min(10_000, Math.floor(Number(value.royaltyBps || 0)))),
    current: Boolean(value.current),
  };
  if (Object.prototype.hasOwnProperty.call(value, 'makerAdminCapObjectId')) {
    normalized.makerAdminCapObjectId = suiJsonId(value.makerAdminCapObjectId);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'makerUpdatedAtMs')) {
    normalized.makerUpdatedAtMs = normalizedMakerUpdatedAtMs(
      value.makerUpdatedAtMs,
    );
  }
  if (Object.prototype.hasOwnProperty.call(value, 'makerPreviousTransaction')) {
    normalized.makerPreviousTransaction = safeDraftText(
      value.makerPreviousTransaction,
      '',
      256,
    );
  }
  // A chain discovery record cannot reconstruct the local pre-pause economics
  // snapshot. Preserve an existing snapshot when the field is absent, while
  // still allowing an explicit null after Resume to clear it.
  if (Object.prototype.hasOwnProperty.call(value, 'pausedEconomics')) {
    normalized.pausedEconomics = normalizedWorkspacePausedEconomics(
      value.pausedEconomics,
      makerObjectId,
    );
  }
  return normalized;
}

function mergePublishedMakerVersions(
  sources,
  {
    rootMakerId = '',
    currentMakerObjectId = '',
  } = {},
) {
  const byObjectId = new Map();
  (Array.isArray(sources) ? sources : [sources]).flat().forEach((value) => {
    const normalized = normalizedPublishedMakerVersion(value, { rootMakerId });
    if (!normalized) return;
    const key = comparableSuiId(normalized.makerObjectId);
    const previous = byObjectId.get(key);
    const updatesPausedEconomics = Object.prototype.hasOwnProperty.call(
      normalized,
      'pausedEconomics',
    );
    if (!previous) {
      byObjectId.set(key, normalized);
      return;
    }
    const updatesAdminCap = Object.prototype.hasOwnProperty.call(
      normalized,
      'makerAdminCapObjectId',
    );
    const updatesMakerTimestamp = Object.prototype.hasOwnProperty.call(
      normalized,
      'makerUpdatedAtMs',
    );
    const updatesPreviousTransaction = Object.prototype.hasOwnProperty.call(
      normalized,
      'makerPreviousTransaction',
    );
    const merged = {
      ...previous,
      ...normalized,
      makerTreasuryObjectId: normalized.makerTreasuryObjectId
        || previous.makerTreasuryObjectId,
      makerAdminCapObjectId: updatesAdminCap
        ? normalized.makerAdminCapObjectId
        : previous.makerAdminCapObjectId,
      publishDigest: normalized.publishDigest || previous.publishDigest,
      makerPreviousTransaction: updatesPreviousTransaction
        ? normalized.makerPreviousTransaction
        : previous.makerPreviousTransaction,
      profileOrder: normalized.profileOrder >= 0
        ? normalized.profileOrder
        : previous.profileOrder,
    };
    if (updatesMakerTimestamp) {
      merged.makerUpdatedAtMs = normalized.makerUpdatedAtMs;
    } else if (Object.prototype.hasOwnProperty.call(previous, 'makerUpdatedAtMs')) {
      merged.makerUpdatedAtMs = previous.makerUpdatedAtMs;
    } else {
      delete merged.makerUpdatedAtMs;
    }
    if (updatesPausedEconomics) {
      merged.pausedEconomics = normalized.pausedEconomics
        ? pausedEconomicsWithRecoveredLocalWitness(
            normalized.pausedEconomics,
            previous.pausedEconomics,
            normalized.makerObjectId,
          )
        : null;
    } else if (updatesMakerTimestamp) {
      merged.pausedEconomics = pausedEconomicsForLiveMaker(
        previous.pausedEconomics,
        {
          makerObjectId: normalized.makerObjectId,
          mintingEnabled: normalized.mintingEnabled,
          makerUpdatedAtMs: normalized.makerUpdatedAtMs,
          makerArchived: normalized.archived,
          makerPreviousTransaction: normalized.makerPreviousTransaction,
        },
      );
    } else if (Object.prototype.hasOwnProperty.call(previous, 'pausedEconomics')) {
      merged.pausedEconomics = previous.pausedEconomics;
    } else {
      delete merged.pausedEconomics;
    }
    byObjectId.set(key, merged);
  });
  const currentId = comparableSuiId(currentMakerObjectId);
  return [...byObjectId.values()]
    .map((entry) => ({
      ...entry,
      current: currentId
        ? comparableSuiId(entry.makerObjectId) === currentId
        : entry.current,
    }))
    .sort((left, right) => (
      Number(right.current) - Number(left.current)
      || Number(right.versionNumber || 0) - Number(left.versionNumber || 0)
      || right.versionId.localeCompare(left.versionId, undefined, { numeric: true })
    ))
    .slice(0, 100);
}

function currentPublishedMakerVersionRecord({
  template = activeTemplate(),
  model = makerModels.get(template?.id),
} = {}) {
  const makerObjectId = suiJsonId(
    template?.id === state.templateId
      ? state.makerObjectId || template?.objectId
      : model?.makerObjectId || template?.objectId,
  );
  if (!makerObjectId) return null;
  const publishedDocument = template?.id === state.templateId
    ? state.publishedMakerDocumentV4
    : model?.publishedMakerDocumentV4;
  const rootMakerId = safeDraftText(
    publishedDocument?.version?.rootMakerId || template?.id,
    '',
    128,
  );
  const versionId = safeDraftText(
    publishedDocument?.version?.versionId
      || model?.makerDocumentV4?.version?.versionId
      || template?.id,
    '',
    128,
  );
  if (!rootMakerId || !versionId) return null;
  return normalizedPublishedMakerVersion({
    rootMakerId,
    versionId,
    parentVersionId: publishedDocument?.version?.parentVersionId || '',
    versionNumber: publishedDocument?.version?.number || 0,
    makerObjectId,
    makerTreasuryObjectId: template?.id === state.templateId
      ? state.makerTreasuryObjectId || template?.treasuryId
      : model?.makerTreasuryObjectId || template?.treasuryId,
    makerAdminCapObjectId: template?.id === state.templateId
      ? state.makerAdminCapObjectId || template?.adminCapId
      : model?.makerAdminCapObjectId || template?.adminCapId,
    publishDigest: template?.id === state.templateId
      ? state.publishDigest
      : model?.publishDigest,
    archived: template?.id === state.templateId
      ? state.makerArchived
      : model?.makerArchived,
    mintingEnabled: template?.mintingEnabled !== false,
    mintFeeEnabled: Boolean(template?.mintFeeEnabled),
    mintPriceAtomic: Number(template?.mintPriceAtomic || 0),
    royaltyBps: Number(template?.royaltyBps || 0),
    current: true,
    pausedEconomics: normalizedWorkspacePausedEconomics(
      template?.pausedEconomics,
      makerObjectId,
    ),
  }, { rootMakerId });
}

function publishedMakerVersionHistory(template = activeTemplate()) {
  const model = makerModels.get(template?.id);
  const rootMakerId = safeDraftText(
    model?.makerDocumentV4?.version?.rootMakerId
      || model?.publishedMakerDocumentV4?.version?.rootMakerId
      || template?.id,
    '',
    128,
  );
  const current = currentPublishedMakerVersionRecord({ template, model });
  const currentMakerObjectId = current?.makerObjectId
    || model?.makerObjectId
    || template?.objectId
    || '';
  return mergePublishedMakerVersions([
    template?.publishedVersions || [],
    model?.publishedMakerVersions || [],
    template?.id === state.templateId ? state.publishedMakerVersions : [],
    current,
  ], {
    rootMakerId,
    currentMakerObjectId,
  });
}

function setPublishedMakerVersionHistory(template, versions) {
  if (!template) return [];
  const model = makerModels.get(template.id);
  const rootMakerId = safeDraftText(
    model?.makerDocumentV4?.version?.rootMakerId
      || model?.publishedMakerDocumentV4?.version?.rootMakerId
      || template.id,
    '',
    128,
  );
  const currentObjectId = suiJsonId(
    template.id === state.templateId
      ? state.makerObjectId || template.objectId
      : model?.makerObjectId || template.objectId,
  );
  const normalized = mergePublishedMakerVersions(versions, {
    rootMakerId,
    currentMakerObjectId: currentObjectId,
  });
  template.publishedVersions = normalized;
  if (model) model.publishedMakerVersions = structuredClone(normalized);
  if (template.id === state.templateId) {
    state.publishedMakerVersions = structuredClone(normalized);
  }
  return normalized;
}

function discoveredMakerVersionSupersedesCurrent({
  bindingPinned = false,
  hasLocalVersionDraft = false,
  currentVersionNumber = 0,
  currentVersionId = '',
  currentProfileOrder = -1,
  incomingVersionNumber = 0,
  incomingParentVersionId = '',
  incomingProfileOrder = -1,
} = {}) {
  if (bindingPinned) {
    return !hasLocalVersionDraft
      && Number(incomingVersionNumber || 0) > Number(currentVersionNumber || 0)
      && Boolean(
        incomingParentVersionId
        && incomingParentVersionId === currentVersionId,
      );
  }
  return Number(incomingVersionNumber || 0) > Number(currentVersionNumber || 0)
    || Boolean(
      incomingParentVersionId
      && incomingParentVersionId === currentVersionId,
    )
    || (
      Number(incomingVersionNumber || 0) === Number(currentVersionNumber || 0)
      && Number(incomingProfileOrder ?? -1) > Number(currentProfileOrder ?? -1)
    );
}

function normalizedWorkspaceChainBinding(metadata, {
  owner = '',
  rootMakerId = '',
} = {}) {
  const value = metadata?.chainBinding;
  if (!value || typeof value !== 'object') return null;
  const bindingRootMakerId = safeDraftText(value.rootMakerId, '', 128);
  const bindingOwner = String(value.ownerWallet || '').trim();
  if (
    !bindingRootMakerId
    || (rootMakerId && bindingRootMakerId !== rootMakerId)
    || (owner && bindingOwner.toLowerCase() !== String(owner).trim().toLowerCase())
  ) return null;
  const makerObjectId = suiJsonId(value.makerObjectId);
  if (!makerObjectId) return null;
  return {
    schema: 'animacraft.chain-binding.v1',
    rootMakerId: bindingRootMakerId,
    ownerWallet: bindingOwner,
    makerObjectId,
    makerTreasuryObjectId: suiJsonId(value.makerTreasuryObjectId),
    makerAdminCapObjectId: suiJsonId(value.makerAdminCapObjectId),
    publishDigest: safeDraftText(value.publishDigest, '', 256),
    archived: Boolean(value.archived),
    mintingEnabled: value.mintingEnabled !== false,
    mintFeeEnabled: Boolean(value.mintFeeEnabled),
    mintPriceAtomic: Math.max(0, Math.floor(Number(value.mintPriceAtomic || 0))),
    royaltyBps: Math.max(0, Math.min(10_000, Math.floor(Number(value.royaltyBps || 0)))),
    pausedEconomics: normalizedWorkspacePausedEconomics(
      value.pausedEconomics,
      makerObjectId,
    ),
    publishedVersions: mergePublishedMakerVersions(
      value.publishedVersions || [],
      {
        rootMakerId: bindingRootMakerId,
        currentMakerObjectId: makerObjectId,
      },
    ),
  };
}

function normalizedWorkspacePublishedSnapshot(metadata, rootMakerId = '') {
  const value = metadata?.publishedSnapshot;
  const document = value?.document;
  if (
    !isMakerV4Document(document)
    || (rootMakerId && document.version.rootMakerId !== rootMakerId)
  ) return null;
  return {
    document: structuredClone(document),
    recipe: cloneV4Recipe(value.recipe || document.defaultRecipe),
  };
}

function currentWorkspaceChainBinding(document = currentMakerV4Source()) {
  const template = activeTemplate();
  if (!templateIsOwnedByWallet(template)) return null;
  const makerObjectId = suiJsonId(state.makerObjectId || template?.objectId);
  if (!makerObjectId || !document?.version?.rootMakerId || !state.walletAddress) return null;
  const currentVersion = currentPublishedMakerVersionRecord({
    template,
    model: makerModels.get(template?.id),
  });
  const publishedVersions = mergePublishedMakerVersions([
    publishedMakerVersionHistory(template),
    currentVersion,
  ], {
    rootMakerId: document.version.rootMakerId,
    currentMakerObjectId: makerObjectId,
  });
  return {
    schema: 'animacraft.chain-binding.v1',
    rootMakerId: document.version.rootMakerId,
    ownerWallet: state.walletAddress,
    makerObjectId,
    makerTreasuryObjectId: suiJsonId(state.makerTreasuryObjectId || template?.treasuryId),
    makerAdminCapObjectId: suiJsonId(state.makerAdminCapObjectId || template?.adminCapId),
    publishDigest: String(state.publishDigest || ''),
    archived: Boolean(state.makerArchived),
    mintingEnabled: template?.mintingEnabled !== false,
    mintFeeEnabled: Boolean(template?.mintFeeEnabled),
    mintPriceAtomic: Number(template?.mintPriceAtomic || 0),
    royaltyBps: Number(template?.royaltyBps || 0),
    pausedEconomics: normalizedWorkspacePausedEconomics(
      template?.pausedEconomics,
      makerObjectId,
    ),
    publishedVersions,
  };
}

function revokeLocalMakerCoverObjectUrl(templateId, { clearTemplate = true } = {}) {
  const normalizedTemplateId = String(templateId || '');
  const entry = localMakerCoverObjectUrls.get(normalizedTemplateId);
  if (!entry) return;
  localMakerCoverObjectUrls.delete(normalizedTemplateId);
  URL.revokeObjectURL(entry.url);
  if (!clearTemplate) return;
  const template = templates.find((candidate) => candidate.id === normalizedTemplateId);
  if (template?.coverUrl === entry.url) template.coverUrl = '';
}

function localMakerCoverObjectUrl(template, coverAssetId, blob) {
  if (!template || !blob || typeof blob.arrayBuffer !== 'function') return '';
  const assetId = String(coverAssetId || '');
  const existing = localMakerCoverObjectUrls.get(template.id);
  if (existing?.assetId === assetId && existing.blob === blob) return existing.url;
  revokeLocalMakerCoverObjectUrl(template.id);
  const url = URL.createObjectURL(blob);
  localMakerCoverObjectUrls.set(template.id, { assetId, blob, url });
  template.coverUrl = url;
  return url;
}

function persistLocalMakerIndex(address = state.walletAddress) {
  const owner = String(address || '').trim();
  if (!owner) return;
  const records = templates.filter((template) => (
    template.owner === owner
    && (template.source === 'local' || suiJsonId(template.objectId))
  )).map((template) => {
    const model = makerModels.get(template.id);
    const makerObjectId = suiJsonId(template.objectId || model?.makerObjectId);
    return {
    id: template.id,
    source: makerObjectId ? 'chain' : 'local',
    owner,
    objectId: makerObjectId,
    treasuryId: suiJsonId(template.treasuryId || model?.makerTreasuryObjectId),
    adminCapId: suiJsonId(template.adminCapId || model?.makerAdminCapObjectId),
    publishDigest: safeDraftText(model?.publishDigest, '', 256),
    archived: Boolean(model?.makerArchived),
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
    coverUrl: stableMakerCoverUrl(template.coverUrl),
    pausedEconomics: normalizedWorkspacePausedEconomics(
      template.pausedEconomics,
      makerObjectId,
    ),
    publishedVersions: publishedMakerVersionHistory(template),
  };
  });
  try {
    localStorage.setItem(localMakerIndexKey(owner), JSON.stringify(records));
    return true;
  } catch (error) {
    // The local index is only a discoverability cache. A quota or browser
    // privacy failure must never prevent the authoritative Workspace/IndexedDB
    // revision (including lifecycle mutation witnesses) from being saved.
    console.warn('Could not update the local Maker index.', error);
    return false;
  }
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
      const objectId = suiJsonId(record.objectId);
      templates.unshift({
        id,
        source: objectId ? 'chain' : 'local',
        owner: address,
        owned: Boolean(objectId),
        objectId,
        treasuryId: suiJsonId(record.treasuryId),
        adminCapId: suiJsonId(record.adminCapId),
        pausedEconomics: normalizedWorkspacePausedEconomics(
          record.pausedEconomics,
          objectId,
        ),
        chainBindingPinned: Boolean(objectId),
        publishedVersions: mergePublishedMakerVersions(
          record.publishedVersions || [],
          {
            rootMakerId: id,
            currentMakerObjectId: objectId,
          },
        ),
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
        coverUrl: stableMakerCoverUrl(record.coverUrl),
      });
      if (objectId) {
        const model = createMakerModel({ empty: true });
        Object.assign(model, {
          publishDigest: safeDraftText(record.publishDigest, '', 256),
          makerObjectId: objectId,
          makerTreasuryObjectId: suiJsonId(record.treasuryId),
          makerAdminCapObjectId: suiJsonId(record.adminCapId),
          makerArchived: Boolean(record.archived),
          pausedEconomics: normalizedWorkspacePausedEconomics(
            record.pausedEconomics,
            objectId,
          ),
          publishedMakerVersions: mergePublishedMakerVersions(
            record.publishedVersions || [],
            {
              rootMakerId: id,
              currentMakerObjectId: objectId,
            },
          ),
        });
        makerModels.set(id, model);
      }
    });
  } catch (error) {
    console.warn('Ignored an unreadable local Maker index.', error);
  }
}

async function restoreLocalMakerCoverFromV6(record, owner) {
  const makerId = safeDraftText(
    record?.metadata?.rootMakerId || record?.document?.version?.rootMakerId,
    '',
    128,
  );
  const makerKey = String(record?.makerKey || '');
  const template = templates.find((candidate) => (
    candidate.id === makerId
    && candidate.owner === owner
  ));
  if (!template || !makerKey || !makerWorkspace) return false;
  const token = Symbol(makerKey);
  localMakerCoverRestoreTokens.set(makerId, token);
  try {
    const loaded = await makerWorkspace.loadDraftProject(makerKey);
    if (
      localMakerCoverRestoreTokens.get(makerId) !== token
      || !loaded?.document
      || loaded.document.version?.rootMakerId !== makerId
    ) return false;
    const currentTemplate = templates.find((candidate) => (
      candidate.id === makerId
      && candidate.owner === owner
    ));
    if (!currentTemplate) return false;
    const assets = new Map((loaded.assets || []).map((asset) => [
      String(asset.assetId || asset.id || ''),
      asset,
    ]).filter(([assetId]) => assetId));
    makerV4WorkspaceCoverUrl(loaded.document, assets, currentTemplate);
    if (localMakerCoverRestoreTokens.get(makerId) !== token) return false;
    renderImageMakerList();
    return true;
  } catch (error) {
    console.warn(`Could not restore the local Maker cover for ${makerId}.`, error);
    return false;
  } finally {
    if (localMakerCoverRestoreTokens.get(makerId) === token) {
      localMakerCoverRestoreTokens.delete(makerId);
    }
  }
}

async function restoreLocalMakerCoversFromV6(records, owner) {
  for (const record of records) {
    if (String(owner || '') !== String(state.walletAddress || '')) return;
    await restoreLocalMakerCoverFromV6(record, owner);
  }
}

async function recoverStableMakerIndex(address = state.walletAddress) {
  const owner = String(address || '').trim();
  if (!owner || !makerWorkspace || loadedStableMakerIndexes.has(owner)) return;
  loadedStableMakerIndexes.add(owner);
  try {
    const records = await makerWorkspace.listDraftProjects({ walletAddress: owner });
    if (owner !== state.walletAddress) return;
    records.slice().reverse().forEach((record) => {
      const document = record?.document;
      const id = safeDraftText(
        record?.metadata?.rootMakerId || document?.version?.rootMakerId,
        '',
        128,
      );
      if (!isSafeKey(id)) return;
      const chainBinding = normalizedWorkspaceChainBinding(record?.metadata, {
        owner,
        rootMakerId: id,
      });
      const publishedSnapshot = normalizedWorkspacePublishedSnapshot(
        record?.metadata,
        id,
      );
      let template = templates.find((candidate) => candidate.id === id) || null;
      const objectDuplicate = chainBinding
        ? templates.find((candidate) => (
            candidate.id !== id
            && comparableSuiId(candidate.objectId) === comparableSuiId(chainBinding.makerObjectId)
          ))
        : null;
      if (!template && objectDuplicate) {
        const previousId = objectDuplicate.id;
        objectDuplicate.id = id;
        template = objectDuplicate;
        const duplicateModel = makerModels.get(previousId);
        if (duplicateModel && !makerModels.has(id)) makerModels.set(id, duplicateModel);
        makerModels.delete(previousId);
        if (state.templateId === previousId) state.templateId = id;
      } else if (template && objectDuplicate) {
        const duplicateIndex = templates.indexOf(objectDuplicate);
        if (duplicateIndex >= 0) templates.splice(duplicateIndex, 1);
        makerModels.delete(objectDuplicate.id);
      }
      if (!template) {
        template = {
          id,
          source: chainBinding ? 'chain' : 'local',
          owner,
          owned: Boolean(chainBinding),
          objectId: chainBinding?.makerObjectId || '',
          treasuryId: chainBinding?.makerTreasuryObjectId || '',
          adminCapId: chainBinding?.makerAdminCapObjectId || '',
          name: safeDraftText(document?.metadata?.name, 'Untitled OC Maker', 128),
          category: 'daily',
          creator: safeDraftText(document?.metadata?.creator, shortAddress(owner) || 'Creator', 128),
          style: safeDraftText(document?.metadata?.style, 'OC Maker', 128),
          license: creatorLicenseLabels[document?.metadata?.license?.kind] || 'Personal use',
          royaltyBps: Number(document?.publication?.royaltyBps || 0),
          mintingEnabled: document?.publication?.mintingEnabled !== false,
          mintFeeEnabled: Boolean(document?.publication?.mintFeeEnabled),
          mintPriceAtomic: Number(document?.publication?.mintPriceAtomic || 0),
          price: 'Draft',
          accent: '#27c5c8',
          secondary: '#f0a23a',
          summary: safeDraftText(document?.metadata?.summary, 'Character Maker draft.', 2_000),
          licenseNote: safeDraftText(document?.metadata?.license?.note, 'Draft maker.', 2_000),
          coverUrl: '',
          pausedEconomics: chainBinding?.pausedEconomics || null,
          publishedVersions: chainBinding?.publishedVersions || [],
          chainBindingPinned: Boolean(chainBinding),
        };
        templates.unshift(template);
      } else {
        const recoveredPausedEconomics = chainBinding
          ? pausedEconomicsWithRecoveredLocalWitness(
              chainBinding.pausedEconomics,
              template.pausedEconomics,
              chainBinding.makerObjectId,
            )
          : template.pausedEconomics || null;
        Object.assign(template, {
          owner,
          source: chainBinding ? 'chain' : template.source,
          owned: chainBinding ? true : template.owned,
          objectId: chainBinding?.makerObjectId || template.objectId || '',
          treasuryId: chainBinding?.makerTreasuryObjectId || template.treasuryId || '',
          // A durable Workspace binding is authoritative even when a value was
          // deliberately cleared. Do not resurrect a stale local AdminCap or a
          // pre-Resume economics snapshot with truthy fallback semantics.
          adminCapId: chainBinding
            ? chainBinding.makerAdminCapObjectId
            : template.adminCapId || '',
          pausedEconomics: chainBinding
            ? recoveredPausedEconomics
            : template.pausedEconomics || null,
          publishedVersions: mergePublishedMakerVersions([
            template.publishedVersions || [],
            chainBinding?.publishedVersions || [],
          ], {
            rootMakerId: id,
            currentMakerObjectId: chainBinding?.makerObjectId || template.objectId || '',
          }),
          chainBindingPinned: Boolean(chainBinding) || template.chainBindingPinned,
        });
      }
      if (chainBinding) {
        Object.assign(template, {
          mintingEnabled: chainBinding.mintingEnabled,
          mintFeeEnabled: chainBinding.mintFeeEnabled,
          mintPriceAtomic: chainBinding.mintPriceAtomic,
          royaltyBps: chainBinding.royaltyBps,
        });
      }
      const model = makerModels.get(id) || createMakerModel({
        empty: true,
        canvas: document?.canvas,
      });
      Object.assign(model, {
        makerDocumentV4: isMakerV4Document(document) ? structuredClone(document) : model.makerDocumentV4,
        makerRecipeV4: isMakerV4Document(document)
          ? cloneV4Recipe(record?.metadata?.recipe || document.defaultRecipe)
          : model.makerRecipeV4,
        publishedMakerDocumentV4: publishedSnapshot?.document
          || model.publishedMakerDocumentV4,
        publishedMakerRecipeV4: publishedSnapshot?.recipe
          || model.publishedMakerRecipeV4,
        publishDigest: chainBinding?.publishDigest || model.publishDigest || '',
        makerObjectId: chainBinding?.makerObjectId || model.makerObjectId || '',
        makerTreasuryObjectId: chainBinding?.makerTreasuryObjectId
          || model.makerTreasuryObjectId
          || '',
        makerAdminCapObjectId: chainBinding
          ? chainBinding.makerAdminCapObjectId
          : model.makerAdminCapObjectId || '',
        makerArchived: chainBinding?.archived ?? model.makerArchived,
        pausedEconomics: chainBinding
          ? template.pausedEconomics
          : model.pausedEconomics || null,
        publishedMakerVersions: mergePublishedMakerVersions([
          model.publishedMakerVersions || [],
          chainBinding?.publishedVersions || [],
        ], {
          rootMakerId: id,
          currentMakerObjectId: chainBinding?.makerObjectId || model.makerObjectId || '',
        }),
      });
      makerModels.set(id, model);
    });
    persistLocalMakerIndex();
    renderAll();
    void restoreLocalMakerCoversFromV6(records, owner);
  } catch (error) {
    loadedStableMakerIndexes.delete(owner);
    state.draftSaveStatus = 'error';
      state.draftSaveMessage = state.locale === 'en' && error?.message
        ? error.message
        : t('localLibraryRebuildFailed');
    renderMakerLifecycle();
  }
}

function currentDraftRecoveryRecord(record) {
  const document = record?.document || null;
  const revision = Number.isSafeInteger(record?.metadata?.draftRevision)
    ? record.metadata.draftRevision
    : null;
  const makerKey = String(record?.makerKey || '');
  const recoverable = isMakerV4Document(document);
  return {
    id: `current-v6:${encodeURIComponent(makerKey)}:${revision ?? 'unknown'}`,
    source: 'workspace-v6',
    makerKey,
    makerId: String(record?.metadata?.rootMakerId || document?.version?.rootMakerId || ''),
    walletAddress: String(record?.metadata?.walletAddress || ''),
    savedAt: Number.isFinite(record?.savedAt) ? record.savedAt : null,
    revision,
    document: recoverable ? structuredClone(document) : null,
    recipe: recoverable
      ? structuredClone(record?.metadata?.recipe || document.defaultRecipe)
      : null,
    assets: [],
    assetCount: Array.isArray(document?.assets) ? document.assets.length : 0,
    raw: {
      databaseName: 'animacraft-maker-workspace-v6',
      projectRecord: structuredClone(record),
      assetsLoadedOnDemand: true,
    },
    recoverable,
    status: recoverable ? 'recoverable' : 'raw-only',
    issues: recoverable ? [] : [{
      code: 'maker-document-missing',
      message: 'The v6 record does not contain a compatible animacraft.maker.v5 document.',
    }],
    sourceKey: makerKey,
  };
}

function draftRecoverySourceLabel(source) {
  return {
    'workspace-v6': t('draftRecoveryCurrent'),
    'workspace-v4': t('draftRecoveryWorkspaceV4'),
    'creator-drafts': t('draftRecoveryCreatorDrafts'),
    'local-storage-draft': t('draftRecoveryLocalDraft'),
    'local-storage-index': t('draftRecoveryLocalIndex'),
  }[source] || source || t('draftRecoveryLocalDraft');
}

function draftRecoveryIssueText(entry) {
  const key = {
    'invalid-json': 'draftRecoveryIssueInvalidJson',
    'index-entry-only': 'draftRecoveryIssueIndexOnly',
    'legacy-document-incompatible': 'draftRecoveryIssueIncompatible',
    'orphaned-assets': 'draftRecoveryIssueOrphanedAssets',
    'maker-document-missing': 'draftRecoveryIssueMissingDocument',
    'source-scan-failed': 'draftRecoveryIssueScanFailed',
  }[entry?.code];
  if (key) return t(key);
  if (state.locale === 'en' && entry?.message) return entry.message;
  return t('draftRecoveryIssueUnknown');
}

function draftRecoveryName(record) {
  return safeDraftText(
    record?.document?.metadata?.name
      || record?.raw?.indexRecord?.name
      || record?.raw?.projectRecord?.document?.metadata?.name
      || record?.makerId
      || record?.makerKey,
    t('draftRecoveryUnknownMaker'),
    128,
  );
}

function draftRecoveryMetrics(record) {
  const parts = Array.isArray(record?.document?.parts) ? record.document.parts : [];
  return {
    parts: parts.length,
    items: parts.reduce((total, part) => total + (Array.isArray(part?.items) ? part.items.length : 0), 0),
    styles: parts.reduce((total, part) => total + (part?.items || []).reduce(
      (itemTotal, item) => itemTotal + (Array.isArray(item?.styles) ? item.styles.length : 0),
      0,
    ), 0),
  };
}

function formatDraftRecoveryTime(value) {
  if (!Number.isFinite(value)) return t('draftRecoveryUnknownTime');
  return new Date(value).toLocaleString({
    en: 'en-US',
    zh: 'zh-CN',
    ja: 'ja-JP',
    ko: 'ko-KR',
    vi: 'vi-VN',
  }[state.locale] || 'en-US');
}

function renderDraftRecoveryCenter() {
  if (!$('draftRecoveryModal')) return;
  $('openDraftRecovery').textContent = t('draftRecovery');
  $('draftRecoveryTitle').textContent = t('draftRecoveryTitle');
  $('draftRecoveryModal').querySelector('.kicker').textContent = t('draftRecoveryKicker');
  $('draftRecoveryIntro').textContent = t('draftRecoveryIntro');
  $('rescanDraftRecovery').textContent = t('draftRecoveryScan');
  $('draftRecoveryModal').querySelector('[data-close-draft-recovery].primary').textContent = t('draftRecoveryDone');

  const status = $('draftRecoveryStatus');
  status.classList.toggle('error', Boolean(state.draftRecoveryError));
  if (state.draftRecoveryStatus === 'loading') status.textContent = t('draftRecoveryScanning');
  else if (state.draftRecoveryError) status.textContent = state.draftRecoveryError;
  else if (state.draftRecoveryMessage) status.textContent = state.draftRecoveryMessage;
  else if (state.draftRecoveryStatus === 'ready') {
    status.textContent = state.draftRecoveryRecords.length
      ? t('draftRecoveryFound', { count: state.draftRecoveryRecords.length })
      : t('draftRecoveryEmpty');
  } else status.textContent = '';

  $('draftRecoveryList').innerHTML = state.draftRecoveryRecords.map((record) => {
    const metrics = draftRecoveryMetrics(record);
    const wallet = record.walletAddress
      ? shortAddress(record.walletAddress)
      : t('draftRecoveryUnknownWallet');
    const revision = Number.isSafeInteger(record.revision)
      ? t('draftRecoveryRevision', { revision: record.revision })
      : t('draftRecoveryUnknownRevision');
    const assetCount = Number.isInteger(record.assetCount)
      ? record.assetCount
      : Array.isArray(record.assets) ? record.assets.length : 0;
    const crossWallet = record.walletAddress
      && state.walletAddress
      && record.walletAddress !== state.walletAddress
      ? ` · ${shortAddress(record.walletAddress)} → ${shortAddress(state.walletAddress)}`
      : '';
    const issues = (record.issues || []).map(draftRecoveryIssueText).filter(Boolean);
    const busy = state.draftRecoveryBusyId === record.id;
    return `
      <article class="draft-recovery-card">
        <div>
          <h3>${escapeHtml(draftRecoveryName(record))}</h3>
          <p class="draft-recovery-meta">
            ${escapeHtml(draftRecoverySourceLabel(record.source))} ·
            ${escapeHtml(wallet)}${escapeHtml(crossWallet)} ·
            ${escapeHtml(formatDraftRecoveryTime(record.savedAt))} ·
            ${escapeHtml(revision)} ·
            ${escapeHtml(t('draftRecoveryAssets', { count: assetCount }))} ·
            ${escapeHtml(t('draftRecoveryMetrics', metrics))}
          </p>
          ${issues.length
            ? `<p class="draft-recovery-issue">${escapeHtml(issues.join(' '))}</p>`
            : !record.recoverable
              ? `<p class="draft-recovery-issue">${escapeHtml(t('draftRecoveryUnsupported'))}</p>`
              : ''}
        </div>
        <div class="draft-recovery-actions">
          <button class="secondary" type="button" data-recovery-action="export" data-recovery-id="${escapeHtml(record.id)}" ${busy ? 'disabled' : ''}>
            ${escapeHtml(t('draftRecoveryExport'))}
          </button>
          <button class="primary" type="button" data-recovery-action="restore" data-recovery-id="${escapeHtml(record.id)}" ${!record.recoverable || busy ? 'disabled' : ''}>
            ${escapeHtml(t(busy ? 'draftRecoveryRestoring' : 'draftRecoveryRestore'))}
          </button>
        </div>
      </article>
    `;
  }).join('');
}

async function refreshDraftRecoveryCenter() {
  const requestId = ++draftRecoveryRequestId;
  const requestedWallet = state.walletAddress;
  state.draftRecoveryStatus = 'loading';
  state.draftRecoveryError = '';
  state.draftRecoveryMessage = '';
  state.draftRecoveryBusyId = '';
  state.draftRecoveryRecords = [];
  renderDraftRecoveryCenter();

  const [currentResult, legacyResult] = await Promise.allSettled([
    makerWorkspace?.listDraftProjects({}) || Promise.resolve([]),
    scanLegacyMakerDrafts(),
  ]);
  if (
    requestId !== draftRecoveryRequestId
    || requestedWallet !== state.walletAddress
    || !$('draftRecoveryModal').classList.contains('active')
  ) return;

  const currentRecords = currentResult.status === 'fulfilled'
    ? currentResult.value.map(currentDraftRecoveryRecord)
    : [];
  const legacyRecords = legacyResult.status === 'fulfilled' ? legacyResult.value : [];
  state.draftRecoveryRecords = [...currentRecords, ...legacyRecords].sort((left, right) => (
    Number(right.savedAt ?? -1) - Number(left.savedAt ?? -1)
    || left.id.localeCompare(right.id)
  ));
  const errors = [
    currentResult.status === 'rejected'
      ? t('draftRecoveryCurrentScanFailed')
      : '',
    legacyResult.status === 'rejected'
      ? t('draftRecoveryLegacyScanFailed')
      : '',
  ].filter(Boolean);
  state.draftRecoveryError = errors.join(' ');
  state.draftRecoveryStatus = 'ready';
  renderDraftRecoveryCenter();
}

function openDraftRecoveryCenter() {
  $('draftRecoveryModal').classList.add('active');
  $('draftRecoveryModal').setAttribute('aria-hidden', 'false');
  $('draftRecoveryTitle').focus?.();
  void refreshDraftRecoveryCenter();
}

function closeDraftRecoveryCenter() {
  draftRecoveryRequestId += 1;
  state.draftRecoveryRecords = [];
  state.draftRecoveryStatus = 'idle';
  state.draftRecoveryError = '';
  state.draftRecoveryMessage = '';
  state.draftRecoveryBusyId = '';
  $('draftRecoveryList').replaceChildren();
  $('draftRecoveryModal').classList.remove('active');
  $('draftRecoveryModal').setAttribute('aria-hidden', 'true');
}

function draftRecoveryRecord(recordId) {
  return state.draftRecoveryRecords.find((record) => record.id === recordId) || null;
}

async function materializeDraftRecoveryRecord(record) {
  if (record.source !== 'workspace-v6') return record;
  const loaded = await makerWorkspace.loadDraftProject(record.makerKey);
  if (!loaded?.document) throw new Error(t('draftRecoveryV6Missing'));
  return {
    ...record,
    document: loaded.document,
    recipe: loaded.recipe || loaded.document.defaultRecipe,
    assets: loaded.assets || [],
    assetCount: (loaded.assets || []).length,
    raw: {
      ...record.raw,
      project: loaded,
    },
  };
}

function recoveredMakerId(record) {
  const base = slug(`${draftRecoveryName(record)}-recovered`).slice(0, 70) || 'recovered-maker';
  const random = globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 12)
    || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return `${base}-${random}`.slice(0, 96);
}

function rebaseRecoveredExpansionIdentities(document, makerId) {
  document.expansionPacks = (document.expansionPacks || []).map((pack) => ({
    ...pack,
    baseMakerId: makerId,
    baseMakerVersion: 1,
  }));
  if (Array.isArray(document.extensions?.expansionDrafts)) {
    document.extensions.expansionDrafts = document.extensions.expansionDrafts.map((pack) => ({
      ...pack,
      baseMakerId: makerId,
      baseVersion: '1',
      baseVersionRange: undefined,
      baseManifestHash: undefined,
      compatibility: pack.compatibility ? {
        ...pack.compatibility,
        baseVersion: '1',
        baseVersionRange: undefined,
        baseManifestHash: undefined,
      } : pack.compatibility,
    }));
  }
}

function recoveredMakerDocument(record, makerId, ownerWallet) {
  if (!isMakerV4Document(record.document)) {
    throw new Error(t('draftRecoveryUnsupported'));
  }
  const document = structuredClone(record.document);
  document.metadata.id = makerId;
  document.metadata.name = utf8Truncate(t('draftRecoveryCopyName', {
    name: draftRecoveryName(record),
  }), 128);
  document.metadata.creator = shortAddress(ownerWallet) || document.metadata.creator;
  document.version = {
    rootMakerId: makerId,
    versionId: `${makerId}-v1`.slice(0, 128),
    number: 1,
    parentVersionId: null,
    compatibility: 'initial',
    compatibleFrom: 1,
    createdAt: null,
    changelog: t('draftRecoveryChangelog'),
  };
  document.runtime = {};
  document.extensions ||= {};
  rebaseRecoveredExpansionIdentities(document, makerId);
  validateMakerV4Document(document, { mode: 'draft' });
  return document;
}

function recoveredTemplate(document, makerId, ownerWallet) {
  return {
    id: makerId,
    source: 'local',
    owner: ownerWallet,
    name: document.metadata.name,
    category: 'daily',
    creator: document.metadata.creator || shortAddress(ownerWallet) || 'Creator',
    style: document.metadata.style || 'OC Maker',
    license: creatorLicenseLabels[document.metadata.license?.kind] || 'Personal use',
    royaltyBps: Number(document.publication?.royaltyBps || 0),
    mintingEnabled: document.publication?.mintingEnabled !== false,
    mintFeeEnabled: Boolean(document.publication?.mintFeeEnabled),
    mintPriceAtomic: Number(document.publication?.mintPriceAtomic || 0),
    price: 'Draft',
    accent: '#27c5c8',
    secondary: '#f0a23a',
    summary: safeDraftText(document.metadata.summary, 'Recovered Character Maker draft.', 2_000),
    licenseNote: safeDraftText(document.metadata.license?.note, 'Recovered local draft.', 2_000),
  };
}

async function exportDraftRecoveryRecord(record) {
  const materialized = await materializeDraftRecoveryRecord(record);
  const payload = await legacyRecoveryExportPayload(materialized);
  download(
    `${slug(draftRecoveryName(record)) || 'maker'}-recovery.json`,
    JSON.stringify(payload, null, 2),
  );
}

async function restoreDraftRecoveryRecord(record) {
  if (!record?.recoverable) throw new Error(t('draftRecoveryUnsupported'));
  if (!state.walletConnected || !state.walletAddress) {
    throw new Error(t('draftRecoveryConnectOwnerWallet'));
  }
  const flushed = await makerWorkspace.flushPendingChanges({ reason: 'recover-draft-copy' });
  if (!flushed.saved) throw new Error(t('draftRecoverySaveCurrentFirst'));

  const requestedWallet = state.walletAddress;
  const materialized = await materializeDraftRecoveryRecord(record);
  if (requestedWallet !== state.walletAddress) throw new Error(t('draftRecoveryWalletChanged'));
  const makerId = recoveredMakerId(materialized);
  const document = recoveredMakerDocument(materialized, makerId, requestedWallet);
  const recipe = normalizeRecoveredMakerRecipe(document, materialized.recipe);
  const assets = prepareRecoveredMakerAssets(document, materialized.assets);
  const makerKey = `${requestedWallet}:${makerId}`;
  const verified = await makerWorkspace.commitRecoveredDraftCopy({
    makerKey,
    document,
    recipe,
    assets,
    metadata: {
      walletAddress: requestedWallet,
      recoveredFromSource: materialized.source,
      recoveredFromMakerKey: materialized.makerKey,
      recoveredAt: Date.now(),
    },
  });
  if (requestedWallet !== state.walletAddress) {
    throw new Error(t('draftRecoveryWalletChangedAfterSave'));
  }
  if (
    verified.document?.version?.rootMakerId !== makerId
    || verified.revision !== 0
  ) {
    throw new Error(t('draftRecoveryIdentityFailed'));
  }

  const template = recoveredTemplate(document, makerId, requestedWallet);
  const model = makerModelFromV4Manifest(document, () => '');
  // The adapter normally removes a published cover from an editable copy.
  // Recovery is a full backup operation, so retain the exact recovered document.
  model.makerDocumentV4 = structuredClone(document);
  model.makerRecipeV4 = structuredClone(recipe);
  model.makerRuntimeAssetsV4 = new Map(assets.map((asset) => [asset.assetId, asset]));
  model.assets = [];
  templates.unshift(template);
  makerModels.set(makerId, model);
  persistLocalMakerIndex(requestedWallet);

  closeDraftRecoveryCenter();
  activateMakerModel(makerId);
  syncTemplateFields();
  state.creatorView = 'edit';
  state.editorPanel = 'parts';
  state.draftSaveStatus = 'saved';
  state.draftSaveMessage = t('draftRecoveryComplete', { name: document.metadata.name });
  renderAll();
  focusCreatorTop();
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

function validateAnyMakerManifest(manifest) {
  return isMakerV4Document(manifest)
    ? validateMakerV4Document(manifest, { mode: 'publish' })
    : validateMakerManifest(manifest);
}

function makerModelFromV4Manifest(document, resolveAssetUrl, object = {}) {
  const descriptorById = new Map((document.assets || []).map((asset) => [asset.id, asset]));
  const trackById = new Map((document.layerTracks || []).map((track) => [track.id, track]));
  const channelById = new Map((document.colorChannels || []).map((channel) => [channel.id, channel]));
  const visual = defaultMakerVisual();
  const modelParts = {};
  const modelSlots = (document.parts || []).map((part) => {
    // Draft Parts are allowed to be empty. Keep the legacy preview adapter
    // resilient while Creator Studio is constructing the first Item/Style.
    const items = Array.isArray(part.items) ? part.items : [];
    const styles = items.flatMap((item) => item.styles || []);
    const trackIds = [...new Set(styles.map((style) => style.layerTrackId).filter(Boolean))];
    const channel = channelById.get(styles.find((style) => style.colorChannelId)?.colorChannelId);
    const colors = channel?.swatches?.length
      ? channel.swatches.map((swatch) => ({ id: swatch.id, name: swatch.name, value: swatch.hintColor }))
      : [{ id: 'default', name: 'Default', value: '#7b5cff' }];
    const layers = trackIds.map((trackId) => {
      const style = styles.find((candidate) => candidate.layerTrackId === trackId);
      const track = trackById.get(trackId);
      return {
        id: trackId,
        name: track?.name || trackId,
        x: Number(style?.transform?.x || 0),
        y: Number(style?.transform?.y || 0),
        opacity: Math.round(Number(style?.opacity ?? 1) * 100),
        blendMode: style?.blendMode || 'normal',
        renderOrder: Number(track?.order || 0),
      };
    });
    const flattened = items.flatMap((item) => (item.styles || []).map((style, styleIndex) => {
      const itemId = (item.styles || []).length > 1 ? `${item.id}--${style.id}` : item.id;
      const images = {};
      const styleChannel = channelById.get(style.colorChannelId);
      const mappings = (styleChannel?.swatches || colors).map((swatch) => ({
        swatchId: swatch.id,
        assetId: style.assetId,
      }));
      if (!mappings.length && style.assetId) mappings.push({ swatchId: 'default', assetId: style.assetId });
      mappings.forEach((mapping) => {
        const descriptor = descriptorById.get(mapping.assetId);
        if (!descriptor?.identifier || !style.layerTrackId) return;
        images[assetCellKey(style.layerTrackId, mapping.swatchId || 'default')] = {
          identifier: descriptor.identifier,
          url: resolveAssetUrl(descriptor.identifier),
          remote: true,
        };
      });
      const thumbnail = descriptorById.get(item.thumbnailAssetId);
      return {
        id: itemId,
        label: (item.styles || []).length > 1 ? `${item.name} · ${style.name}` : item.name,
        displayOrder: Number(item.displayOrder || 0) + styleIndex + 1,
        visibility: 'public',
        images,
        iconAsset: thumbnail?.identifier ? { identifier: thumbnail.identifier, url: resolveAssetUrl(thumbnail.identifier), remote: true } : null,
        v4ItemId: item.id,
        v4StyleId: style.id,
      };
    }));
    modelParts[part.id] = flattened;
    const defaultItem = items.find((item) => item.id === part.defaultItemId) || items[0];
    const defaultItemId = defaultItem?.styles?.length > 1
      ? `${defaultItem.id}--${defaultItem.defaultStyleId || defaultItem.styles[0]?.id}`
      : defaultItem?.id || '';
    visual[part.id] = defaultItemId;
    visual.palette[part.id] = colors.find((color) => color.id === channel?.defaultSwatchId)?.value || colors[0].value;
    const icon = descriptorById.get(part.iconAssetId);
    return {
      key: part.id,
      label: part.name,
      icon: part.name.slice(0, 2).toUpperCase(),
      colorKey: part.id,
      description: 'Animacraft Maker v5 Part',
      kind: part.required ? 'last-bastion' : 'standard',
      menuVisible: part.menuVisible !== false,
      allowRemove: !part.required,
      defaultItemId,
      layers: layers.length ? layers : [{ id: `track-${part.id}`, name: part.name, x: 0, y: 0, opacity: 100, blendMode: 'normal', renderOrder: 0 }],
      colors,
      iconAsset: icon?.identifier ? { identifier: icon.identifier, url: resolveAssetUrl(icon.identifier), remote: true } : null,
    };
  });
  const layerOrder = (document.layerTracks || []).slice().sort((left, right) => left.order - right.order).flatMap((track) => modelSlots.filter((slot) => slot.layers.some((layer) => layer.id === track.id)).map((slot) => creatorLayerKey(slot.key, track.id)));
  const fields = suiObjectFields(object);
  const runtimeAssets = (document.assets || []).filter((asset) => asset.identifier).map((asset) => ({
    ...asset,
    assetId: asset.id,
    url: resolveAssetUrl(asset.identifier),
    remote: true,
  }));
  const editableDocument = structuredClone(document);
  return {
    canvas: { width: document.canvas.width, height: document.canvas.height },
    slots: modelSlots,
    parts: modelParts,
    slotOrder: modelSlots.map((slot) => slot.key),
    layerOrder,
    visual,
    rules: [],
    paletteLinks: [],
    livingContent: normalizeLivingContent(document.livingContent, document.metadata),
    assets: runtimeAssets,
    makerDocumentV4: editableDocument,
    makerRecipeV4: cloneV4Recipe(editableDocument.defaultRecipe),
    makerRuntimeAssetsV4: new Map(runtimeAssets.map((asset) => [asset.assetId, asset])),
    publishedMakerDocumentV4: object.objectId ? structuredClone(editableDocument) : null,
    publishedMakerRecipeV4: object.objectId
      ? cloneV4Recipe(editableDocument.defaultRecipe)
      : null,
    publishDigest: object.previousTransaction || '',
    publishStatus: '',
    makerObjectId: object.objectId || '',
    makerTreasuryObjectId: object.treasuryId || suiJsonId(suiField(fields, 'treasury_id', 'treasuryId')),
    makerAdminCapObjectId: object.adminCapId || '',
    makerArchived: [true, 'true', 1, '1'].includes(suiField(fields, 'archived')),
  };
}

function cloneV4Recipe(recipe) {
  return structuredClone(recipe || { selections: [], colors: [] });
}

function makerModelFromManifest(manifest, resolveAssetUrl, object = {}) {
  if (isMakerV4Document(manifest)) return makerModelFromV4Manifest(manifest, resolveAssetUrl, object);
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
  if (!localUiTest) return;
  if (bundledMakersLoaded) return;
  bundledMakersLoaded = true;
  const creatorPacks = templates.filter((template) => template.source === 'creator-pack');
  const results = await Promise.allSettled(creatorPacks.map(async (template) => {
    const response = await fetch(template.manifestUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${template.name} manifest returned ${response.status}.`);
    const manifest = await response.json();
    validateAnyMakerManifest(manifest);
    const model = makerModelFromManifest(manifest, (identifier) => bundledAssetUrl(template.id, identifier));
    makerModels.set(template.id, model);
    const manifestMetadata = isMakerV4Document(manifest) ? manifest.metadata : manifest.template;
    Object.assign(template, {
      name: manifestMetadata.name,
      creator: manifestMetadata.creator,
      style: manifestMetadata.style,
      summary: manifestMetadata.summary,
      license: makerLicenseLabel({ licenseKind: ['personal-use', 'free-remix', 'paid-commercial', 'exclusive-commission'].indexOf(manifestMetadata.license?.kind || manifestMetadata.license) }),
      licenseNote: manifestMetadata.license?.note || manifestMetadata.licenseNote,
      royaltyBps: Number((isMakerV4Document(manifest) ? manifest.publication?.royaltyBps : manifestMetadata.royaltyBps) || 0),
      mintingEnabled: (isMakerV4Document(manifest) ? manifest.publication?.mintingEnabled : manifestMetadata.mintingEnabled) !== false,
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

async function hydrateChainMaker(object, {
  guard = () => true,
} = {}) {
  if (!guard()) return false;
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
  const liveMakerUpdatedAtMs = normalizedMakerUpdatedAtMs(
    suiField(fields, 'updated_at_ms', 'updatedAtMs'),
  );
  const liveMakerArchived = [true, 'true', 1, '1'].includes(
    suiField(fields, 'archived'),
  );
  const liveMakerPreviousTransaction = String(
    object.previousTransaction || '',
  );
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
  validateAnyMakerManifest(manifest);
  if (!guard()) return false;
  const featuredKey = Object.entries(runtimeConfig.featuredMakers || {}).find(([, objectId]) => objectId === object.objectId)?.[0];
  const stableRootMakerId = isMakerV4Document(manifest)
    ? safeDraftText(manifest.version?.rootMakerId, '', 128)
    : '';
  const recoveredByObject = templates.find((candidate) => (
    comparableSuiId(candidate.objectId) === comparableSuiId(object.objectId)
  ));
  const belongsToActiveCreatorLineage = Boolean(
    object.owned || object.profilePublished,
  );
  const stableRootTemplate = belongsToActiveCreatorLineage && stableRootMakerId
    ? templates.find((candidate) => (
        candidate.id === stableRootMakerId
        && candidate.owner
        && String(candidate.owner).toLowerCase() === String(state.walletAddress).toLowerCase()
      ))
    : null;
  const policy = suiField(fields, 'policy') || {};
  const publicationData = isMakerV4Document(manifest)
    ? manifest.publication || {}
    : manifest.template || {};
  const chainVersionRecord = stableRootMakerId && isMakerV4Document(manifest)
    ? normalizedPublishedMakerVersion({
        rootMakerId: stableRootMakerId,
        versionId: manifest.version.versionId,
        parentVersionId: manifest.version.parentVersionId || '',
        versionNumber: manifest.version.number,
        profileOrder: object.profileOrder,
        makerObjectId: object.objectId,
        makerTreasuryObjectId: object.treasuryId
          || suiJsonId(suiField(fields, 'treasury_id', 'treasuryId')),
        makerAdminCapObjectId: object.adminCapId || '',
        publishDigest: object.previousTransaction || '',
        makerPreviousTransaction: liveMakerPreviousTransaction,
        makerUpdatedAtMs: liveMakerUpdatedAtMs,
        archived: liveMakerArchived,
        mintingEnabled: economics.mintingEnabled,
        mintFeeEnabled: economics.mintFeeEnabled,
        mintPriceAtomic: economics.mintPriceAtomic,
        royaltyBps: Number(
          suiField(policy.fields || policy, 'royalty_bps', 'royaltyBps')
          || publicationData.royaltyBps
          || 0,
        ),
        current: stableRootTemplate
          ? comparableSuiId(stableRootTemplate.objectId) === comparableSuiId(object.objectId)
          : true,
      }, { rootMakerId: stableRootMakerId })
    : null;
  const stableRootModel = stableRootTemplate
    ? makerModels.get(stableRootTemplate.id)
    : null;
  const stableCurrentDocument = stableRootModel?.publishedMakerDocumentV4
    || stableRootModel?.makerDocumentV4
    || null;
  const stableCurrentVersionNumber = Number(
    stableCurrentDocument?.version?.number || 0,
  );
  const stableCurrentVersionId = String(
    stableCurrentDocument?.version?.versionId || '',
  );
  const stableCurrentProfileOrder = Number(
    stableRootTemplate
      ? publishedMakerVersionHistory(stableRootTemplate)
        .find((entry) => entry.current)?.profileOrder ?? -1
      : -1,
  );
  const incomingVersionNumber = Number(manifest?.version?.number || 0);
  const incomingSupersedesCurrent = discoveredMakerVersionSupersedesCurrent({
    bindingPinned: Boolean(stableRootTemplate?.chainBindingPinned),
    hasLocalVersionDraft: makerModelHasPendingV4Version(stableRootModel),
    currentVersionNumber: stableCurrentVersionNumber,
    currentVersionId: stableCurrentVersionId,
    currentProfileOrder: stableCurrentProfileOrder,
    incomingVersionNumber,
    incomingParentVersionId: manifest?.version?.parentVersionId || '',
    incomingProfileOrder: Number(object.profileOrder ?? -1),
  });
  const keepPersistedOrNewerCurrent = !incomingSupersedesCurrent;
  if (
    stableRootTemplate?.objectId
    && comparableSuiId(stableRootTemplate.objectId) !== comparableSuiId(object.objectId)
    && (keepPersistedOrNewerCurrent || !object.owned)
  ) {
    // A stable Workspace root owns one Library card. Older immutable objects
    // remain independently manageable through that card's version history.
    // CreatorProfile entries whose AdminCap was transferred remain immutable
    // lineage witnesses, but must never impersonate current control.
    if (chainVersionRecord) {
      setPublishedMakerVersionHistory(stableRootTemplate, [
        ...publishedMakerVersionHistory(stableRootTemplate),
        chainVersionRecord,
      ]);
      persistLocalMakerIndex(stableRootTemplate.owner || state.walletAddress);
    }
    return true;
  }
  const recoveredByStableRoot = stableRootTemplate;
  const recoveredTemplate = recoveredByObject || recoveredByStableRoot;
  const id = recoveredTemplate?.id
    || (belongsToActiveCreatorLineage && stableRootMakerId ? stableRootMakerId : '')
    || featuredKey
    || `chain-${object.objectId}`;
  const templateData = isMakerV4Document(manifest) ? manifest.metadata || {} : manifest.template || {};
  const resolvedPublicationData = isMakerV4Document(manifest) ? publicationData : templateData;
  const coverDescriptor = isMakerV4Document(manifest)
    ? manifest.assets?.find((asset) => asset.id === templateData.coverAssetId)
    : null;
  const template = templates.find((candidate) => candidate.id === id) || {
    id,
    category: 'daily',
    accent: '#27c5c8',
    secondary: '#f0a23a',
    chainBindingPinned: false,
  };
  Object.assign(template, {
    source: 'chain',
    owned: Boolean(object.owned),
    owner: object.owned
      ? state.walletAddress
      : template.owner || (object.profilePublished ? state.walletAddress : ''),
    objectId: object.objectId,
    quiltId,
    name: String(suiField(fields, 'name') || templateData.name || 'On-chain OC Maker'),
    // The Move field is the immutable publisher address. The human-facing
    // creator display name belongs to the signed Walrus Maker metadata.
    creator: String(templateData.creator || suiField(fields, 'creator') || 'Sui creator'),
    creatorWallet: String(suiField(fields, 'creator') || ''),
    style: String(templateData.style || 'OC Maker'),
    license: makerLicenseLabel(policy),
    royaltyBps: Number(suiField(policy.fields || policy, 'royalty_bps', 'royaltyBps') || resolvedPublicationData.royaltyBps || 0),
    mintingEnabled: economics.mintingEnabled,
    mintFeeEnabled: economics.mintFeeEnabled,
    mintPriceAtomic: economics.mintPriceAtomic,
    treasuryId: object.treasuryId || suiJsonId(suiField(fields, 'treasury_id', 'treasuryId')),
    adminCapId: object.adminCapId || '',
    pausedEconomics: pausedEconomicsForLiveMaker(
      template.pausedEconomics,
      {
        makerObjectId: object.objectId,
        mintingEnabled: economics.mintingEnabled,
        makerUpdatedAtMs: liveMakerUpdatedAtMs,
        makerArchived: liveMakerArchived,
        makerPreviousTransaction: liveMakerPreviousTransaction,
      },
    ),
    price: economics.mintPriceAtomic > 0
      ? `${(economics.mintPriceAtomic / (10 ** runtimeConfig.paymentCoinDecimals)).toLocaleString()} ${runtimeConfig.paymentCoinSymbol}`
      : 'Free mint',
    summary: String(suiField(fields, 'description') || 'Published Animacraft Character Maker.'),
    licenseNote: String(templateData.license?.note || templateData.licenseNote || 'License and royalty policy are read from the published Sui OCMaker.'),
    coverUrl: safeExternalUrl(
      suiField(fields, 'cover_url', 'coverUrl')
      || templateData.coverUrl
      || (coverDescriptor?.identifier ? walrusQuiltFileUrl(quiltId, coverDescriptor.identifier) : '')
      || (templateData.coverIdentifier ? walrusQuiltFileUrl(quiltId, templateData.coverIdentifier) : ''),
    ),
  });
  if (!templates.includes(template)) templates.unshift(template);
  if (chainVersionRecord) {
    setPublishedMakerVersionHistory(template, [
      ...publishedMakerVersionHistory(template),
      chainVersionRecord,
    ]);
  }
  const chainModel = makerModelFromManifest(
    manifest,
    (identifier) => walrusQuiltFileUrl(quiltId, identifier),
    object,
  );
  const recoveredModel = makerModels.get(id);
  const recoveredDocument = recoveredModel?.makerDocumentV4;
  const chainDocument = chainModel.publishedMakerDocumentV4;
  const isSuccessorDraft = Boolean(
    object.owned
    && templateIsOwnedByWallet(template)
    && isMakerV4Document(recoveredDocument)
    && isMakerV4Document(chainDocument)
    && recoveredDocument.version.rootMakerId === chainDocument.version.rootMakerId
    && recoveredDocument.version.versionId !== chainDocument.version.versionId
    && (
      recoveredDocument.version.parentVersionId === chainDocument.version.versionId
      || Number(recoveredDocument.version.number || 0) > Number(chainDocument.version.number || 0)
    )
  );
  const model = isSuccessorDraft
    ? {
        ...chainModel,
        makerDocumentV4: recoveredDocument,
        makerRecipeV4: recoveredModel.makerRecipeV4
          || cloneV4Recipe(recoveredDocument.defaultRecipe),
        makerRuntimeAssetsV4: recoveredModel.makerRuntimeAssetsV4 instanceof Map
          ? recoveredModel.makerRuntimeAssetsV4
          : new Map(),
        publishedMakerDocumentV4: chainDocument,
        publishedMakerRecipeV4: chainModel.publishedMakerRecipeV4
          || cloneV4Recipe(chainDocument.defaultRecipe),
        pausedEconomics: template.pausedEconomics || null,
        publishedMakerVersions: mergePublishedMakerVersions([
          recoveredModel.publishedMakerVersions || [],
          template.publishedVersions || [],
          chainVersionRecord,
        ], {
          rootMakerId: stableRootMakerId || id,
          currentMakerObjectId: object.objectId,
        }),
      }
    : {
        ...chainModel,
        pausedEconomics: template.pausedEconomics || null,
        publishedMakerVersions: mergePublishedMakerVersions([
          recoveredModel?.publishedMakerVersions || [],
          template.publishedVersions || [],
          chainVersionRecord,
        ], {
          rootMakerId: stableRootMakerId || id,
          currentMakerObjectId: object.objectId,
        }),
  };
  makerModels.set(id, model);
  setPublishedMakerVersionHistory(template, model.publishedMakerVersions);
  if (object.owned && template.owner) persistLocalMakerIndex(template.owner);
  if (
    state.templateId === id
    && !state.publishing
    && !state.makerLifecycleActionBusy
    && guard()
  ) {
    applyMakerModelToState(id, model);
  }
  return true;
}

async function reconcileOwnedMakerSuccessors(objects, {
  guard = () => true,
} = {}) {
  const objectsById = new Map(
    (objects || [])
      .filter((object) => object?.owned && object.objectId)
      .map((object) => [comparableSuiId(object.objectId), object]),
  );
  for (let pass = 0; pass < objectsById.size && guard(); pass += 1) {
    let advanced = false;
    const ownedTemplates = templates.filter((template) => (
      template.owned
      && template.owner
      && walletAddressesMatch(template.owner, state.walletAddress)
    ));
    for (const template of ownedTemplates) {
      if (!guard()) return;
      const model = makerModels.get(template.id);
      if (makerModelHasPendingV4Version(model)) continue;
      const publishedDocument = model?.publishedMakerDocumentV4
        || model?.makerDocumentV4;
      const currentVersionId = String(
        publishedDocument?.version?.versionId || '',
      );
      if (!currentVersionId) continue;
      const successor = publishedMakerVersionHistory(template)
        .filter((version) => (
          version.parentVersionId === currentVersionId
          && comparableSuiId(version.makerObjectId)
            !== comparableSuiId(template.objectId)
        ))
        .sort((left, right) => (
          Number(right.versionNumber || 0) - Number(left.versionNumber || 0)
          || Number(right.profileOrder ?? -1) - Number(left.profileOrder ?? -1)
        ))[0];
      const successorObject = successor
        ? objectsById.get(comparableSuiId(successor.makerObjectId))
        : null;
      if (!successorObject) continue;
      const previousObjectId = comparableSuiId(template.objectId);
      try {
        await hydrateChainMaker(successorObject, { guard });
      } catch (error) {
        console.warn(
          `Could not reconcile Maker successor ${successor.versionId}.`,
          error,
        );
        continue;
      }
      if (!guard()) return;
      if (comparableSuiId(template.objectId) !== previousObjectId) {
        advanced = true;
      }
    }
    if (!advanced) break;
  }
}

async function refreshOwnedMakerVersionLineage({
  walletAddress = state.walletAddress,
  requiredMakerObjectId = state.makerObjectId,
  guard = () => true,
} = {}) {
  const owner = String(walletAddress || '');
  if (!owner || !packageConfigured() || !guard()) {
    throw makerAuthorityError('MAKER_CONTEXT_CHANGED', 'makerContextChanged');
  }
  let adminCaps;
  let profiles;
  try {
    [adminCaps, profiles] = await Promise.all([
      listOwnedMakerAdminCaps(owner),
      listOwnedCreatorProfiles(owner),
    ]);
  } catch (error) {
    throw makerAuthorityError('MAKER_VERSION_DISCOVERY_FAILED', 'makerDiscoveryFailed');
  }
  if (!guard()) {
    throw makerAuthorityError('MAKER_CONTEXT_CHANGED', 'makerContextChanged');
  }
  const capsByMaker = new Map(adminCaps.map((cap) => {
    const fields = suiObjectFields(cap);
    const makerId = suiJsonId(suiField(fields, 'maker_id', 'makerId'));
    return [comparableSuiId(makerId), {
      makerId,
      adminCapId: cap.objectId,
      treasuryId: suiJsonId(suiField(fields, 'treasury_id', 'treasuryId')),
    }];
  }).filter(([makerId]) => makerId));
  const profileMakerIds = profiles.flatMap(creatorProfileMakerIds);
  const profileOrderByMaker = new Map();
  profileMakerIds.forEach((makerId, profileOrder) => {
    const comparableId = comparableSuiId(makerId);
    if (comparableId && !profileOrderByMaker.has(comparableId)) {
      profileOrderByMaker.set(comparableId, profileOrder);
    }
  });
  const requiredId = comparableSuiId(requiredMakerObjectId);
  if (requiredId && !capsByMaker.has(requiredId)) {
    throw makerAuthorityError('MAKER_ADMIN_CAP_NOT_OWNED', 'makerAuthorityChanged');
  }
  const makerIdsByComparable = new Map();
  capsByMaker.forEach((authority, comparableId) => {
    makerIdsByComparable.set(comparableId, authority.makerId);
  });
  profileMakerIds.forEach((makerId) => {
    const comparableId = comparableSuiId(makerId);
    if (comparableId && !makerIdsByComparable.has(comparableId)) {
      makerIdsByComparable.set(comparableId, makerId);
    }
  });
  const makerIds = [...makerIdsByComparable.values()];
  let makers;
  try {
    makers = makerIds.length
      ? await getMakerObjects(makerIds, { expectedStructName: 'OCMaker' })
      : [];
  } catch (error) {
    throw makerAuthorityError('MAKER_VERSION_DISCOVERY_FAILED', 'makerDiscoveryFailed');
  }
  if (!guard()) {
    throw makerAuthorityError('MAKER_CONTEXT_CHANGED', 'makerContextChanged');
  }
  const returnedIds = new Set(makers.map((maker) => comparableSuiId(maker.objectId)));
  if (makerIds.some((makerId) => !returnedIds.has(comparableSuiId(makerId)))) {
    throw makerAuthorityError('MAKER_VERSION_DISCOVERY_FAILED', 'makerDiscoveryFailed');
  }
  const lineageMakers = makers.map((maker) => {
    const comparableId = comparableSuiId(maker.objectId);
    const authority = capsByMaker.get(comparableId);
    const profileOrder = profileOrderByMaker.get(comparableId);
    return {
      ...maker,
      ...(authority || {}),
      owned: Boolean(authority),
      profilePublished: profileOrder !== undefined,
      profileOrder: profileOrder ?? -1,
    };
  });
  const hydrated = await Promise.allSettled(
    lineageMakers.map((maker) => hydrateChainMaker(maker, { guard })),
  );
  if (!guard()) {
    throw makerAuthorityError('MAKER_CONTEXT_CHANGED', 'makerContextChanged');
  }
  const failures = hydrated.filter((result) => result.status === 'rejected');
  if (failures.length) {
    const error = new Error(t('makerVerificationFailed', { count: failures.length }));
    error.code = 'MAKER_VERSION_DISCOVERY_FAILED';
    throw error;
  }
  await reconcileOwnedMakerSuccessors(lineageMakers, { guard });
  if (!guard()) {
    throw makerAuthorityError('MAKER_CONTEXT_CHANGED', 'makerContextChanged');
  }
  return true;
}

async function loadChainMakers(owner = state.walletAddress) {
  const loadKey = owner || 'public';
  if (!packageConfigured() || state.chainMakersLoadedFor === loadKey) return;
  const requestId = ++chainMakerLoadRequestId;
  const requestedOwner = String(owner || '');
  const isActiveRequest = () => (
    requestId === chainMakerLoadRequestId
    && requestedOwner === String(state.walletAddress || '')
  );
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
    if (!isActiveRequest()) return;
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
    ], { expectedStructName: 'OCMaker' });
    const byId = new Map(discovered.map((object) => {
      const authority = capsByMaker.get(object.objectId) || {};
      const makerFields = suiObjectFields(object);
      return [object.objectId, {
        ...object,
        ...authority,
        profileOrder: profileMakerIds.findIndex((makerId) => (
          comparableSuiId(makerId) === comparableSuiId(object.objectId)
        )),
        treasuryId: authority.treasuryId || suiJsonId(suiField(makerFields, 'treasury_id', 'treasuryId')),
        owned: ownedIds.has(object.objectId),
      }];
    }));
    const results = await Promise.allSettled(
      [...byId.values()].map((object) => hydrateChainMaker(object, {
        guard: isActiveRequest,
      })),
    );
    if (!isActiveRequest()) return;
    await reconcileOwnedMakerSuccessors([...byId.values()], {
      guard: isActiveRequest,
    });
    if (!isActiveRequest()) return;
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length) state.chainMakerLoadError = t('makerVerificationFailed', { count: failures.length });
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
    if (!isActiveRequest()) return;
    state.chainMakerLoadError = state.locale === 'en' && error?.message
      ? error.message
      : t('makerDiscoveryFailed');
    state.chainMakersLoadedFor = '';
  }
  if (!isActiveRequest()) return;
  state.chainMakersLoading = false;
  renderAll();
  if (state.page === 'make') restoreOcUploadRecovery(state.templateId, { force: true });
}

function renderOwnedCharacters() {
  if (!$('ownedCharacterGrid')) return;
  if ($('ownedCharacterStatus')) $('ownedCharacterStatus').textContent = t('finishedCharactersSoulidity');
  const mySoulsUrl = soulidityAppLink('/my-souls');
  const profileUrl = soulidityAppLink('/profile');
  const communityUrl = soulidityAppLink('/community');
  const marketUrl = soulidityAppLink('/market');
  $('ownedCharacterGrid').innerHTML = `
    <div class="empty-state">
      ${escapeHtml(t('soulidityOwnsCharacterData'))}
      <div class="owned-oc-links">
        <a href="${escapeHtml(mySoulsUrl)}" target="_blank" rel="noreferrer">${escapeHtml(t('soulidityMySouls'))}</a>
        <a href="${escapeHtml(profileUrl)}" target="_blank" rel="noreferrer">${escapeHtml(t('socialProfile'))}</a>
        <a href="${escapeHtml(communityUrl)}" target="_blank" rel="noreferrer">${escapeHtml(t('community'))}</a>
        <a href="${escapeHtml(marketUrl)}" target="_blank" rel="noreferrer">${escapeHtml(t('marketplace'))}</a>
      </div>
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
  const requestId = ++treasuryBalanceRequestId;
  const templateId = state.templateId;
  const walletAddress = state.walletAddress;
  const isActiveRequest = () => (
    requestId === treasuryBalanceRequestId
    && templateId === state.templateId
    && walletAddress === state.walletAddress
    && treasuryId === (activeTemplate()?.treasuryId || state.makerTreasuryObjectId)
  );
  state.treasuryBalanceLoading = true;
  if ($('makerTreasuryBalance')) $('makerTreasuryBalance').textContent = t('treasuryLoadingSui');
  try {
    const [treasury] = await getMakerObjects(
      [treasuryId],
      { expectedStructName: 'MakerTreasury', generic: true },
    );
    if (!treasury) throw new Error(t('treasuryUnavailable'));
    if (!isActiveRequest()) return;
    const fields = suiObjectFields(treasury);
    const revenue = suiField(fields, 'revenue') || {};
    const revenueFields = revenue.fields && typeof revenue.fields === 'object' ? revenue.fields : revenue;
    const balanceAtomic = Number(suiField(revenueFields, 'value') || 0);
    activeTemplate().treasuryBalanceAtomic = Number.isSafeInteger(balanceAtomic) ? balanceAtomic : 0;
    state.treasuryBalanceLoadedFor = treasuryId;
  } catch (error) {
    if (isActiveRequest()) {
      activeTemplate().treasuryBalanceError = error.message || 'Treasury balance unavailable.';
      state.treasuryBalanceLoadedFor = '';
    }
  } finally {
    if (requestId === treasuryBalanceRequestId) {
      state.treasuryBalanceLoading = false;
      if (isActiveRequest()) renderMakerLifecycle();
    }
  }
}

function comparableSuiId(value) {
  const id = suiJsonId(value).toLowerCase();
  if (!id) return '';
  return `0x${id.slice(2).padStart(64, '0')}`;
}

function suiBoolean(value, fallback = false) {
  if ([true, 'true', 1, '1'].includes(value)) return true;
  if ([false, 'false', 0, '0'].includes(value)) return false;
  return fallback;
}

function makerAuthorityError(code, messageKey) {
  const error = new Error(t(messageKey));
  error.code = code;
  return error;
}

async function refreshMakerLifecycleAuthority(operation, {
  preserveKnownAuthority = false,
} = {}) {
  const makerObjectId = state.makerObjectId;
  const walletAddress = state.walletAddress;
  if (!makerObjectId || !walletAddress || !makerChainOperationIsActive(operation)) {
    throw makerAuthorityError('MAKER_CONTEXT_CHANGED', 'makerContextChanged');
  }
  const [makers, adminCaps] = await Promise.all([
    getMakerObjects([makerObjectId], { expectedStructName: 'OCMaker' }),
    listOwnedMakerAdminCaps(walletAddress),
  ]);
  if (!makerChainOperationIsActive(operation)) {
    throw makerAuthorityError('MAKER_CONTEXT_CHANGED', 'makerContextChanged');
  }
  const maker = makers.find((candidate) => (
    comparableSuiId(candidate.objectId) === comparableSuiId(makerObjectId)
  ));
  const fields = suiObjectFields(maker);
  const linkedAdminCapId = comparableSuiId(suiField(fields, 'admin_cap_id', 'adminCapId'));
  const linkedTreasuryId = comparableSuiId(suiField(fields, 'treasury_id', 'treasuryId'));
  const adminCap = adminCaps.find((candidate) => {
    const capFields = suiObjectFields(candidate);
    return comparableSuiId(candidate.objectId) === linkedAdminCapId
      && comparableSuiId(suiField(capFields, 'maker_id', 'makerId')) === comparableSuiId(makerObjectId)
      && comparableSuiId(suiField(capFields, 'treasury_id', 'treasuryId')) === linkedTreasuryId;
  });
  const makerIsChainPublished = suiBoolean(suiField(fields, 'published'), false);
  if (!maker || !makerIsChainPublished || !linkedAdminCapId || !linkedTreasuryId || !adminCap) {
    if (!preserveKnownAuthority) {
      state.makerAdminCapObjectId = '';
      if (activeTemplate()) activeTemplate().adminCapId = '';
      syncActiveMakerModelRefs();
    }
    throw makerAuthorityError(
      preserveKnownAuthority ? 'MAKER_AUTHORITY_NOT_VISIBLE' : 'MAKER_ADMIN_CAP_NOT_OWNED',
      preserveKnownAuthority ? 'makerStateReadbackPending' : 'makerAuthorityChanged',
    );
  }

  const policy = suiField(fields, 'policy') || {};
  const economics = assertSupportedMakerMintEconomics({
    mintingEnabled: suiBoolean(suiField(fields, 'minting_enabled', 'mintingEnabled'), true),
    mintFeeEnabled: suiBoolean(suiField(fields, 'mint_fee_enabled', 'mintFeeEnabled'), false),
    mintPriceAtomic: suiField(fields, 'mint_price_atomic', 'mintPriceAtomic') || 0,
  });
  const archived = suiBoolean(suiField(fields, 'archived'), false);
  const royaltyBps = Number(suiField(policy.fields || policy, 'royalty_bps', 'royaltyBps') || 0);
  const makerUpdatedAtMs = normalizedMakerUpdatedAtMs(
    suiField(fields, 'updated_at_ms', 'updatedAtMs'),
  );
  const makerPreviousTransaction = String(
    maker.previousTransaction || '',
  );
  state.makerObjectId = maker.objectId;
  state.makerTreasuryObjectId = suiJsonId(suiField(fields, 'treasury_id', 'treasuryId'));
  state.makerAdminCapObjectId = adminCap.objectId;
  state.makerArchived = archived;
  Object.assign(activeTemplate(), {
    source: 'chain',
    owned: true,
    objectId: maker.objectId,
    treasuryId: state.makerTreasuryObjectId,
    adminCapId: adminCap.objectId,
    mintingEnabled: economics.mintingEnabled,
    mintFeeEnabled: economics.mintFeeEnabled,
    mintPriceAtomic: economics.mintPriceAtomic,
    royaltyBps,
    price: economics.mintPriceAtomic > 0
      ? `${atomicCoinToDecimal(economics.mintPriceAtomic)} ${runtimeConfig.paymentCoinSymbol}`
      : 'Free mint',
  });
  setActivePausedEconomicsSnapshot(pausedEconomicsForLiveMaker(
    activePausedEconomicsSnapshot(),
    {
      makerObjectId: maker.objectId,
      mintingEnabled: economics.mintingEnabled,
      makerUpdatedAtMs,
      makerArchived: archived,
      makerPreviousTransaction,
    },
  ));
  syncActiveMakerModelRefs();
  const authority = {
    makerObjectId: maker.objectId,
    makerTreasuryObjectId: state.makerTreasuryObjectId,
    makerAdminCapObjectId: adminCap.objectId,
    makerUpdatedAtMs,
    makerPreviousTransaction,
    archived,
    mintingEnabled: economics.mintingEnabled,
    mintFeeEnabled: economics.mintFeeEnabled,
    mintPriceAtomic: economics.mintPriceAtomic,
    royaltyBps,
  };
  updatePublishedMakerVersionRecord(maker.objectId, authority);
  return authority;
}

async function refreshMakerLifecycleAuthorityAfterWrite(operation, {
  matches = () => true,
} = {}) {
  const delays = [0, 250, 600, 1_200, 2_400];
  let lastError = null;
  for (const delayMs of delays) {
    if (delayMs) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    if (!makerChainOperationIsActive(operation)) {
      throw makerAuthorityError('MAKER_CONTEXT_CHANGED', 'makerContextChanged');
    }
    try {
      const result = await refreshMakerLifecycleAuthority(operation, {
        preserveKnownAuthority: true,
      });
      if (matches(result)) return result;
      lastError = makerAuthorityError(
        'MAKER_STATE_NOT_CONFIRMED',
        'makerAuthorityChanged',
      );
    } catch (error) {
      if (error?.code === 'MAKER_CONTEXT_CHANGED') throw error;
      lastError = error;
    }
  }
  throw lastError || makerAuthorityError(
    'MAKER_AUTHORITY_NOT_VISIBLE',
    'makerAuthorityChanged',
  );
}

function updatePublishedMakerVersionRecord(makerObjectId, patch = {}) {
  const template = activeTemplate();
  const history = publishedMakerVersionHistory(template);
  const targetId = comparableSuiId(makerObjectId);
  const target = history.find((entry) => (
    comparableSuiId(entry.makerObjectId) === targetId
  ));
  if (!target) return null;
  const next = normalizedPublishedMakerVersion({
    ...target,
    ...patch,
    makerObjectId: target.makerObjectId,
    rootMakerId: target.rootMakerId,
    versionId: target.versionId,
  }, { rootMakerId: target.rootMakerId });
  if (!next) return null;
  setPublishedMakerVersionHistory(template, [
    ...history.filter((entry) => comparableSuiId(entry.makerObjectId) !== targetId),
    next,
  ]);
  persistLocalMakerIndex(template.owner || state.walletAddress);
  return next;
}

async function refreshPublishedMakerVersionAuthority(operation, {
  preserveKnownAuthority = false,
} = {}) {
  const makerObjectId = suiJsonId(operation?.targetMakerObjectId);
  const walletAddress = state.walletAddress;
  if (
    !makerObjectId
    || !walletAddress
    || !publishedMakerVersionOperationIsActive(operation)
  ) {
    throw makerAuthorityError('MAKER_CONTEXT_CHANGED', 'makerContextChanged');
  }
  const [makers, adminCaps] = await Promise.all([
    getMakerObjects([makerObjectId], { expectedStructName: 'OCMaker' }),
    listOwnedMakerAdminCaps(walletAddress),
  ]);
  if (!publishedMakerVersionOperationIsActive(operation)) {
    throw makerAuthorityError('MAKER_CONTEXT_CHANGED', 'makerContextChanged');
  }
  const maker = makers.find((candidate) => (
    comparableSuiId(candidate.objectId) === comparableSuiId(makerObjectId)
  ));
  const fields = suiObjectFields(maker);
  const linkedAdminCapId = comparableSuiId(
    suiField(fields, 'admin_cap_id', 'adminCapId'),
  );
  const linkedTreasuryId = comparableSuiId(
    suiField(fields, 'treasury_id', 'treasuryId'),
  );
  const adminCap = adminCaps.find((candidate) => {
    const capFields = suiObjectFields(candidate);
    return comparableSuiId(candidate.objectId) === linkedAdminCapId
      && comparableSuiId(suiField(capFields, 'maker_id', 'makerId'))
        === comparableSuiId(makerObjectId)
      && comparableSuiId(suiField(capFields, 'treasury_id', 'treasuryId'))
        === linkedTreasuryId;
  });
  if (
    !maker
    || !suiBoolean(suiField(fields, 'published'), false)
    || !linkedAdminCapId
    || !linkedTreasuryId
    || !adminCap
  ) {
    if (!preserveKnownAuthority) {
      updatePublishedMakerVersionRecord(makerObjectId, {
        makerAdminCapObjectId: '',
      });
    }
    throw makerAuthorityError(
      preserveKnownAuthority ? 'MAKER_AUTHORITY_NOT_VISIBLE' : 'MAKER_ADMIN_CAP_NOT_OWNED',
      preserveKnownAuthority ? 'makerStateReadbackPending' : 'makerAuthorityChanged',
    );
  }
  const policy = suiField(fields, 'policy') || {};
  const economics = assertSupportedMakerMintEconomics({
    mintingEnabled: suiBoolean(
      suiField(fields, 'minting_enabled', 'mintingEnabled'),
      true,
    ),
    mintFeeEnabled: suiBoolean(
      suiField(fields, 'mint_fee_enabled', 'mintFeeEnabled'),
      false,
    ),
    mintPriceAtomic: suiField(fields, 'mint_price_atomic', 'mintPriceAtomic') || 0,
  });
  const archived = suiBoolean(suiField(fields, 'archived'), false);
  const makerPreviousTransaction = String(
    maker.previousTransaction || '',
  );
  const existing = publishedMakerVersionHistory().find((entry) => (
    comparableSuiId(entry.makerObjectId) === comparableSuiId(makerObjectId)
  ));
  const makerUpdatedAtMs = normalizedMakerUpdatedAtMs(
    suiField(fields, 'updated_at_ms', 'updatedAtMs'),
  );
  const result = {
    makerObjectId: maker.objectId,
    makerTreasuryObjectId: suiJsonId(
      suiField(fields, 'treasury_id', 'treasuryId'),
    ),
    makerAdminCapObjectId: adminCap.objectId,
    makerUpdatedAtMs,
    makerPreviousTransaction,
    archived,
    mintingEnabled: economics.mintingEnabled,
    mintFeeEnabled: economics.mintFeeEnabled,
    mintPriceAtomic: economics.mintPriceAtomic,
    royaltyBps: Number(
      suiField(policy.fields || policy, 'royalty_bps', 'royaltyBps') || 0,
    ),
    pausedEconomics: pausedEconomicsForLiveMaker(
      existing?.pausedEconomics,
      {
        makerObjectId: maker.objectId,
        mintingEnabled: economics.mintingEnabled,
        makerUpdatedAtMs,
        makerArchived: archived,
        makerPreviousTransaction,
      },
    ),
  };
  updatePublishedMakerVersionRecord(makerObjectId, result);
  return result;
}

async function refreshPublishedMakerVersionAuthorityAfterWrite(operation, {
  matches = () => true,
} = {}) {
  const delays = [0, 250, 600, 1_200, 2_400];
  let lastError = null;
  for (const delayMs of delays) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (!publishedMakerVersionOperationIsActive(operation)) {
      throw makerAuthorityError('MAKER_CONTEXT_CHANGED', 'makerContextChanged');
    }
    try {
      const result = await refreshPublishedMakerVersionAuthority(operation, {
        preserveKnownAuthority: true,
      });
      if (matches(result)) return result;
      lastError = makerAuthorityError(
        'MAKER_STATE_NOT_CONFIRMED',
        'makerAuthorityChanged',
      );
    } catch (error) {
      if (error?.code === 'MAKER_CONTEXT_CHANGED') throw error;
      lastError = error;
    }
  }
  throw lastError || makerAuthorityError(
    'MAKER_AUTHORITY_NOT_VISIBLE',
    'makerAuthorityChanged',
  );
}

async function recoverPublishedMakerIndex() {
  const digest = state.publishDigest;
  if (!digest || state.makerObjectId || !packageConfigured() || state.recoveringMakerDigest === digest) return;
  state.recoveringMakerDigest = digest;
  state.publishStatus = t('makerIndexResolving');
  renderAll();
  try {
    const indexed = await resolvePublishedMakerObjects(digest);
    const makerObjectId = indexed.makerObjectId;
    if (!makerObjectId) throw new Error(t('makerIndexObjectMissing'));
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
    setPublishedMakerVersionHistory(activeTemplate(), [
      ...publishedMakerVersionHistory(activeTemplate()),
      currentPublishedMakerVersionRecord(),
    ]);
    syncActiveMakerModelRefs();
    await saveCurrentMakerDraft({ silent: true, forceWorkspace: true });
    persistLocalMakerIndex();
    state.chainMakersLoadedFor = '';
    await loadChainMakers(state.walletAddress);
  } catch (error) {
    state.publishStatus = t('makerIndexRecoveryRetained', {
      error: state.locale === 'en' && error?.message ? error.message : t('makerIndexUnavailable'),
    });
  } finally {
    if (state.recoveringMakerDigest === digest) state.recoveringMakerDigest = '';
    renderAll();
  }
}

async function finalizeMakerPublication(transaction, makerPayload = null, {
  recovered = false,
  guard = () => true,
} = {}) {
  if (!guard()) return false;
  clearMakerPublishError();
  state.publishDigest = String(transaction?.digest || state.makerPublicationIntent?.digest || '');
  state.makerObjectId = String(transaction?.makerObjectId || '');
  state.makerTreasuryObjectId = String(transaction?.makerTreasuryObjectId || '');
  state.makerAdminCapObjectId = String(transaction?.makerAdminCapObjectId || '');
  state.creatorProfileObjectId = String(
    transaction?.creatorProfileObjectId || state.creatorProfileObjectId || '',
  );
  state.makerArchived = false;
  state.makerPublicationIntent = normalizedMakerPublicationIntent({
    ...(state.makerPublicationIntent || {}),
    creator: state.walletAddress,
    manifestBlobId: state.makerQuiltId,
    status: state.makerObjectId ? 'recovered' : 'submitted',
    digest: state.publishDigest,
  });
  state.publishStatus = state.makerObjectId
    ? recovered ? t('publicationAlreadyRecovered') : ''
    : t('makerPublishedIndexing');
  const uploadedMakerDocument = state.pendingMakerV4Bundle?.manifest;
  if (isMakerV4Document(uploadedMakerDocument)) {
    state.publishedMakerDocumentV4 = structuredClone(uploadedMakerDocument);
    state.publishedMakerRecipeV4 = cloneV4Recipe(uploadedMakerDocument.defaultRecipe);
  } else if (isMakerV4Document(state.makerDocumentV4)) {
    // Legacy publication paths do not produce a v5 bundle. Keep this fallback
    // isolated from the normal v5 path, whose immutable uploaded Manifest is
    // the only safe publication snapshot.
    state.publishedMakerDocumentV4 = structuredClone(state.makerDocumentV4);
    state.publishedMakerRecipeV4 = cloneV4Recipe(
      state.makerRecipeV4 || state.makerDocumentV4.defaultRecipe,
    );
  }
  Object.assign(activeTemplate(), {
    source: state.makerObjectId ? 'chain' : 'local',
    owned: true,
    objectId: state.makerObjectId,
    treasuryId: state.makerTreasuryObjectId,
    adminCapId: state.makerAdminCapObjectId,
    coverUrl: makerPayload?.coverUrl || activeTemplate().coverUrl || '',
    mintingEnabled: $('creatorMintingEnabled').checked,
    mintFeeEnabled: $('creatorMintFeeEnabled').checked,
    mintPriceAtomic: $('creatorMintFeeEnabled').checked
      ? decimalCoinToAtomic($('creatorMintPrice').value)
      : 0,
    quiltId: state.makerQuiltId,
    price: $('creatorMintFeeEnabled').checked
      ? `${$('creatorMintPrice').value} ${runtimeConfig.paymentCoinSymbol}`
      : state.makerObjectId ? 'Free mint' : 'Indexing',
  });
  if (state.makerObjectId) {
    setPublishedMakerVersionHistory(activeTemplate(), [
      ...publishedMakerVersionHistory(activeTemplate()),
      currentPublishedMakerVersionRecord(),
    ]);
  }
  syncActiveMakerModelRefs();
  persistLocalMakerIndex();
  let saved = false;
  try {
    const saveResult = await saveCurrentMakerDraft({
      silent: true,
      forceWorkspace: true,
    });
    saved = saveResult?.confirmed === true;
    if (!saved) {
      throw new Error('The published Maker state has not been confirmed in local storage yet.');
    }
  } catch (error) {
    console.warn('The Maker is published, but its local publication state could not be saved yet.', error);
    state.publishStatus = state.locale === 'en' && error?.message
      ? `${state.publishStatus || t('publicationAlreadyRecovered')} ${error.message}`.trim()
      : state.publishStatus || t('publicationAlreadyRecovered');
  }
  if (!guard()) return false;
  if (state.makerObjectId && saved) {
    await clearMakerUploadRecovery();
    if (!guard()) return false;
    state.chainMakersLoadedFor = '';
    await loadChainMakers(state.walletAddress);
  } else if (!state.makerObjectId && state.publishDigest) {
    setTimeout(recoverPublishedMakerIndex, 4_000);
  }
  if (guard() && state.makerTreasuryObjectId) loadActiveTreasuryBalance({ force: true });
  return true;
}

async function recoverMakerPublicationIntent({
  scheduleRetry = false,
  guard = () => true,
} = {}) {
  if (!guard()) return null;
  const intent = normalizedMakerPublicationIntent(state.makerPublicationIntent);
  if (!intent
    || intent.creator.toLowerCase() !== String(state.walletAddress || '').toLowerCase()
    || intent.manifestBlobId !== String(state.makerQuiltId || '')) {
    return null;
  }
  state.publishStatus = intent.digest
    ? t('publicationSubmittedRecovering')
    : t('publicationPendingReview');
  renderPublishAction();
  let match = await findPublishedMakerByIntent({
    creator: intent.creator,
    manifestBlobId: intent.manifestBlobId,
    limit: 500,
  });
  if (!guard()) return null;
  if (!match && intent.digest) {
    try {
      const indexed = await resolvePublishedMakerObjects(intent.digest, 12_000);
      if (!guard()) return null;
      if (indexed.makerObjectId) match = { ...indexed, digest: intent.digest };
    } catch (error) {
      console.warn('Submitted Maker publication is not indexed yet.', error);
    }
  }
  if (!match) {
    if (scheduleRetry && guard() && !makerPublicationRecoveryTimer) {
      makerPublicationRecoveryTimer = setTimeout(() => {
        makerPublicationRecoveryTimer = null;
        recoverMakerPublicationIntent({ guard }).catch((error) => {
          console.warn('Maker publication recovery retry failed.', error);
        }).finally(renderAll);
      }, 10_000);
    }
    return null;
  }
  let indexed = {};
  if (match.digest) {
    try {
      indexed = await resolvePublishedMakerObjects(match.digest, 20_000);
      if (!guard()) return null;
    } catch (error) {
      console.warn('Recovered the Maker event before all created objects were indexed.', error);
    }
  }
  const transaction = {
    ...indexed,
    ...match,
    makerObjectId: indexed.makerObjectId || match.makerObjectId,
    digest: match.digest || intent.digest,
  };
  if (!guard()) return null;
  await finalizeMakerPublication(transaction, null, { recovered: true, guard });
  return transaction;
}

function openConfirmation({ title, message, confirmLabel = 'Delete', action }) {
  const confirmationModal = $('confirmActionModal');
  const lifecycleModal = $('makerLifecycleManagerModal');
  confirmationReturnFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  confirmationSuspendedLifecycle = Boolean(lifecycleModal?.classList.contains('active'));
  if (confirmationSuspendedLifecycle) {
    lifecycleModal.inert = true;
    lifecycleModal.setAttribute('aria-hidden', 'true');
    $('makerLifecycleManagerDialog')?.setAttribute('aria-modal', 'false');
  }
  pendingConfirmation = action;
  $('confirmActionTitle').textContent = title;
  $('confirmActionMessage').textContent = message;
  $('confirmActionButton').textContent = confirmLabel;
  confirmationModal.classList.add('active');
  confirmationModal.setAttribute('aria-hidden', 'false');
  $('confirmActionButton').focus();
}

function closeConfirmation() {
  const returnFocus = confirmationReturnFocus;
  const restoreLifecycle = confirmationSuspendedLifecycle;
  pendingConfirmation = null;
  confirmationReturnFocus = null;
  confirmationSuspendedLifecycle = false;
  $('confirmActionModal').classList.remove('active');
  $('confirmActionModal').setAttribute('aria-hidden', 'true');
  if (restoreLifecycle) {
    const lifecycleModal = $('makerLifecycleManagerModal');
    lifecycleModal.inert = false;
    lifecycleModal.removeAttribute('inert');
    lifecycleModal.setAttribute(
      'aria-hidden',
      lifecycleModal.classList.contains('active') ? 'false' : 'true',
    );
    $('makerLifecycleManagerDialog')?.setAttribute('aria-modal', 'true');
  }
  if (
    returnFocus?.isConnected
    && !returnFocus.closest('[inert]')
    && !returnFocus.disabled
  ) {
    returnFocus.focus();
  } else if (restoreLifecycle && $('makerLifecycleManagerModal')?.classList.contains('active')) {
    $('makerLifecycleManagerModal')
      .querySelector('[data-close-maker-lifecycle]')
      ?.focus();
  }
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
    state.draftSaveMessage = t('localAssetsRestored', { count: records.length });
    await restoreMakerUploadRecovery(templateId);
    renderAll();
  } catch (error) {
    loadedMakerAssetDrafts.delete(assetStorageKey);
    state.draftSaveStatus = 'error';
    state.draftSaveMessage = state.locale === 'en' && error?.message
      ? error.message
      : t('localAssetsRestoreFailed');
    renderMakerLifecycle();
  }
}

async function saveCurrentMakerDraft({
  silent = false,
  forceWorkspace = false,
} = {}) {
  if (!state.walletConnected || !state.walletAddress) {
    if (silent) return null;
    throw new Error(t('makerDraftOwnerWalletRequired'));
  }
  if (!templateIsOwnedByWallet()) {
    if (silent) return null;
    throw new Error(t('makerLifecycleNoAuthority'));
  }
  if (isMakerV4Document(state.makerDocumentV4) && makerWorkspace) {
    await syncMakerWorkspaceContext();
    const result = await makerWorkspace.save({
      automatic: silent,
      force: forceWorkspace,
    });
    if (!result && !silent) {
      throw new Error(makerWorkspace.store?.getState().saveMessage || t('localDraftSaveFailed'));
    }
    return result;
  }
  syncCreatorAssets();
  const templateId = state.templateId;
  const storageKey = makerDraftStorageKey(templateId);
  const assetStorageKey = makerAssetStorageKey(templateId);
  const draft = {
    templateId,
    savedAt: new Date().toISOString(),
    manifest: creatorManifest(),
    makerRecipeV4: isMakerV4Document(state.makerDocumentV4) ? cloneV4Recipe(state.makerRecipeV4 || state.makerDocumentV4.defaultRecipe) : null,
    publishedMakerDocumentV4: isMakerV4Document(state.publishedMakerDocumentV4) ? structuredClone(state.publishedMakerDocumentV4) : null,
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
  let confirmed = false;
  if (!silent) renderMakerLifecycle();
  try {
    const records = makerAssetRecords();
    await saveMakerDraftRecord(storageKey, draft);
    await replaceMakerAssets(assetStorageKey, records);
    localStorage.removeItem(storageKey);
    persistLocalMakerIndex();
    loadedMakerAssetDrafts.add(assetStorageKey);
    confirmed = true;
    if (state.templateId === templateId) {
      state.draftSaveStatus = 'saved';
    state.draftSaveMessage = t('localAssetsSaved', { count: records.length });
    }
  } catch (error) {
    if (state.templateId === templateId) {
      state.draftSaveStatus = 'error';
    state.draftSaveMessage = state.locale === 'en' && error?.message
      ? error.message
      : t('localDraftSaveFailed');
    }
    if (!silent) throw error;
  } finally {
    if (state.templateId === templateId) renderMakerLifecycle();
  }
  return { ...draft, confirmed };
}

function scheduleMakerAutosave() {
  if (!state.walletConnected || makerIsPublished()) return;
  if (isMakerV4Document(state.makerDocumentV4)) return;
  const templateId = state.templateId;
  clearTimeout(makerAutosaveTimer);
  state.draftSaveStatus = 'dirty';
    state.draftSaveMessage = t('unsavedDraftChanges');
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
  if (makerIsPublished() && !makerHasPendingV4Version()) return;
  if (makerPublicationRecoveryPending()) {
    state.publishStatus = t('publicationPendingReview');
    renderPublishAction();
    return false;
  }
  if (makerPublicationRecoveryTimer) {
    clearTimeout(makerPublicationRecoveryTimer);
    makerPublicationRecoveryTimer = null;
  }
  makerUploadRestoreRequestId += 1;
  const staleSession = state.makerUploadSession;
  const recoveryKey = makerAssetStorageKey();
  state.makerUploadSession = null;
  state.pendingMakerAssets = [];
  state.makerUploadStage = 'idle';
  state.makerQuiltId = '';
  state.pendingMakerCoverBlob = null;
  state.pendingMakerManifestJson = '';
  state.pendingMakerV4Bundle = null;
  state.makerPublicationIntent = null;
  state.publishDigest = '';
  state.publishStatus = message;
  clearMakerPublishError();
  loadedMakerUploadRecoveries.delete(recoveryKey);
  withBrowserUploadLock(recoveryKey, async () => {
    const recovery = await loadMakerUploadRecovery(recoveryKey);
    if (
      staleSession?.uploadSessionId
      && recovery?.uploadSessionId
      && recovery.uploadSessionId !== staleSession.uploadSessionId
    ) return;
    await deleteMakerUploadRecovery(recoveryKey, {
      expectedRevision: recovery?.recoveryRevision,
      uploadSessionId: recovery?.uploadSessionId,
    });
  }).catch((error) => console.warn('Could not clear stale Walrus recovery data.', error));
  scheduleMakerAutosave();
  return true;
}

function normalizedMakerPublicationIntent(value) {
  if (!value || typeof value !== 'object') return null;
  const creator = String(value.creator || '').trim();
  const manifestBlobId = String(value.manifestBlobId || '').trim();
  if (!creator || !manifestBlobId) return null;
  return {
    creator,
    manifestBlobId,
    createdAt: String(value.createdAt || new Date().toISOString()),
    status: ['awaiting-signature', 'submitted', 'recovered'].includes(value.status)
      ? value.status
      : 'awaiting-signature',
    digest: String(value.digest || ''),
  };
}

function sameMakerPublicationIntent(left, right) {
  const a = normalizedMakerPublicationIntent(left);
  const b = normalizedMakerPublicationIntent(right);
  return Boolean(
    a
    && b
    && a.creator.toLowerCase() === b.creator.toLowerCase()
    && a.manifestBlobId === b.manifestBlobId
    && a.status === b.status
    && a.digest === b.digest,
  );
}

function makerPublicationRecoveryPending() {
  const intent = normalizedMakerPublicationIntent(state.makerPublicationIntent);
  return Boolean(
    intent
      && intent.creator.toLowerCase() === String(state.walletAddress || '').toLowerCase(),
  );
}

function clearMakerPublishError() {
  state.makerPublishError = null;
}

function recordMakerPublishError(error, action, fallbackKey = 'makerPublicationFailed') {
  const classified = classifyChainUiError(error, { action });
  state.makerPublishError = classified;
  state.publishStatus = t(fallbackKey);
  return classified;
}

function clearOcPublishError() {
  state.ocPublishError = null;
}

function recordOcPublishError(error, action, fallbackKey = 'ocUploadFailed') {
  const classified = classifyChainUiError(error, { action });
  state.ocPublishError = classified;
  state.mintStatus = t(fallbackKey);
  return classified;
}

function restoredCertificationVisibilityError(certifyDigest) {
  return classifyChainUiError({
    code: 'WALRUS_CERTIFICATION_NOT_VISIBLE',
    message: `Walrus certification ${String(certifyDigest || '(confirmed transaction)')} is confirmed. Refreshing its certified Blob state will only query Sui.`,
  }, { action: 'certify' });
}

function uploadRecoveryMismatch(message) {
  const error = new Error(`UPLOAD_RECOVERY_MISMATCH: ${message}`);
  error.code = 'UPLOAD_RECOVERY_MISMATCH';
  return error;
}

const uploadStageRank = Object.freeze({
  idle: 0,
  encoded: 1,
  'register-pending': 2,
  registered: 3,
  uploaded: 4,
  'certify-pending': 5,
  certified: 6,
});

function uploadStageIsAhead(recovery, session, localStage) {
  if (!recovery) return false;
  const recoveryStage = String(recovery.stage || recovery.checkpoint?.step || 'idle');
  const sessionStage = String(session?.stage || localStage || 'idle');
  const recoveryRank = uploadStageRank[recoveryStage] ?? -1;
  const sessionRank = uploadStageRank[sessionStage] ?? -1;
  if (recoveryRank !== sessionRank) return recoveryRank > sessionRank;
  const pendingRegisterDigest = String(recovery.pendingRegisterTransaction?.digest || '');
  const sessionRegisterDigest = String(session?.pendingRegisterTransaction?.digest || '');
  if (pendingRegisterDigest && !sessionRegisterDigest) return true;
  const pendingCertifyDigest = String(recovery.pendingCertifyTransaction?.digest || '');
  const sessionCertifyDigest = String(session?.pendingCertifyTransaction?.digest || '');
  if (pendingCertifyDigest && !sessionCertifyDigest) return true;
  if (
    String(recovery.uploadSessionId || '') === String(session?.uploadSessionId || '')
    && Number(recovery.recoveryRevision || 0) > Number(session?.recoveryRevision || 0)
  ) return true;
  return Number(recovery.savedAt || 0) > Number(session?.recoverySavedAt || 0);
}

async function withBrowserUploadLock(recoveryKey, callback) {
  const lockName = `animacraft-upload:${String(recoveryKey || 'unknown')}`;
  if (globalThis.navigator?.locks?.request) {
    return globalThis.navigator.locks.request(lockName, { mode: 'exclusive' }, callback);
  }
  return callback();
}

function uploadRecoveryQuote(session) {
  return {
    relayTipMist: session?.relayTipMist == null ? null : String(session.relayTipMist),
    relayTipQuotedAt: String(session?.relayTipQuotedAt || ''),
    walrusStorageCostFrost: session?.walrusStorageCostFrost == null
      ? null
      : String(session.walrusStorageCostFrost),
    walrusWriteCostFrost: session?.walrusWriteCostFrost == null
      ? null
      : String(session.walrusWriteCostFrost),
    walrusTotalCostFrost: session?.walrusTotalCostFrost == null
      ? null
      : String(session.walrusTotalCostFrost),
    walletSuiBalanceMist: session?.walletSuiBalanceMist == null
      ? null
      : String(session.walletSuiBalanceMist),
    walletWalBalanceFrost: session?.walletWalBalanceFrost == null
      ? null
      : String(session.walletWalBalanceFrost),
  };
}

function uploadRecoveryTransactions(session) {
  return {
    pendingRegisterTransaction: session?.pendingRegisterTransaction
      ? structuredClone(session.pendingRegisterTransaction)
      : null,
    pendingCertifyTransaction: session?.pendingCertifyTransaction
      ? structuredClone(session.pendingCertifyTransaction)
      : null,
  };
}

async function saveVerifiedUploadRecovery(recoveryKey, record) {
  const expectedRevision = Number(record.recoveryRevision || 0);
  await saveMakerUploadRecovery(recoveryKey, record, { expectedRevision });
  const verified = await loadMakerUploadRecovery(recoveryKey);
  const expectedStage = String(record.stage || record.checkpoint?.step || '');
  const actualStage = String(verified?.stage || verified?.checkpoint?.step || '');
  const matchesField = (field) => String(verified?.[field] ?? '') === String(record[field] ?? '');
  const matchesPendingTransaction = (field) => {
    const expected = record[field];
    const actual = verified?.[field];
    if (!expected) return !actual;
    return Boolean(
      actual
      && String(actual.digest || '') === String(expected.digest || '')
      && String(actual.bytes || '') === String(expected.bytes || '')
      && String(actual.signature || '') === String(expected.signature || '')
      && String(actual.lastBroadcastAt || '') === String(expected.lastBroadcastAt || '')
      && Number(actual.broadcastAttempts || 0) === Number(expected.broadcastAttempts || 0),
    );
  };
  const quoteAndBalanceFields = [
    'relayTipMist',
    'relayTipQuotedAt',
    'walrusStorageCostFrost',
    'walrusWriteCostFrost',
    'walrusTotalCostFrost',
    'walletSuiBalanceMist',
    'walletWalBalanceFrost',
  ];
  const checkpointIdentityFields = ['step', 'blobId', 'blobObjectId', 'txDigest', 'nonce'];
  const checkpointMatches = checkpointIdentityFields.every((field) => (
    String(verified?.checkpoint?.[field] ?? '') === String(record.checkpoint?.[field] ?? '')
  ));
  if (!verified
    || actualStage !== expectedStage
    || String(verified.uploadSessionId || '') !== String(record.uploadSessionId || '')
    || Number(verified.recoveryRevision || 0) !== expectedRevision + 1
    || !matchesField('owner')
    || !matchesField('quiltBlobId')
    || !matchesField('kind')
    || !matchesField('manifestJson')
    || !matchesField('fingerprint')
    || !matchesField('recipeJson')
    || JSON.stringify(verified.files || []) !== JSON.stringify(record.files || [])
    || !checkpointMatches
    || !matchesField('registerDigest')
    || !matchesField('certifyDigest')
    || !quoteAndBalanceFields.every(matchesField)
    || !matchesPendingTransaction('pendingRegisterTransaction')
    || !matchesPendingTransaction('pendingCertifyTransaction')) {
    throw new Error('The local upload checkpoint could not be verified. No new chain step was started.');
  }
  return verified;
}

function captureMakerUploadPersistenceContext(session = state.makerUploadSession) {
  if (!session?.checkpoint || !state.pendingMakerCoverBlob || !state.pendingMakerManifestJson) return null;
  return Object.freeze({
    recoveryKey: makerAssetStorageKey(),
    templateId: state.templateId,
    coverBlob: state.pendingMakerCoverBlob,
    manifestJson: state.pendingMakerManifestJson,
    publicationIntent: normalizedMakerPublicationIntent(state.makerPublicationIntent),
    quiltBlobId: state.makerQuiltId || session.quiltBlobId || '',
  });
}

function makerUploadContextWithPublicationIntent(context, publicationIntent) {
  if (!context) return null;
  return Object.freeze({
    ...context,
    publicationIntent: normalizedMakerPublicationIntent(publicationIntent),
  });
}

function makerUploadContextIsActive(session, context) {
  return Boolean(
    session
    && context
    && state.makerUploadSession === session
    && state.templateId === context.templateId
    && makerAssetStorageKey() === context.recoveryKey,
  );
}

async function persistMakerUploadRecovery(
  session = state.makerUploadSession,
  context = captureMakerUploadPersistenceContext(session),
) {
  if (!session?.checkpoint || !context) {
    throw new Error('The Maker upload checkpoint has no stable persistence context.');
  }
  const active = makerUploadContextIsActive(session, context);
  const stage = session.stage || (active ? state.makerUploadStage : session.checkpoint.step);
  const verified = await saveVerifiedUploadRecovery(context.recoveryKey, {
    owner: session.owner,
    uploadSessionId: session.uploadSessionId || '',
    recoveryRevision: Number(session.recoveryRevision || 0),
    stage,
    checkpoint: session.checkpoint,
    registerDigest: session.registerDigest || '',
    certifyDigest: session.certifyDigest || '',
    ...uploadRecoveryQuote(session),
    ...uploadRecoveryTransactions(session),
    quiltBlobId: context.quiltBlobId || session.quiltBlobId || '',
    files: (session.files || []).map(({ id, blobId }) => ({ id, blobId })),
    manifestJson: context.manifestJson,
    coverBlob: context.coverBlob,
    publicationIntent: normalizedMakerPublicationIntent(context.publicationIntent),
  });
  session.recoveryRevision = Number(verified.recoveryRevision || session.recoveryRevision || 0);
  session.recoverySavedAt = Number(verified.savedAt || Date.now());
  if (active) {
    state.makerUploadStage = stage;
    state.hasMakerUploadRecovery = true;
    loadedMakerUploadRecoveries.add(context.recoveryKey);
  }
  return verified;
}

function makerUploadCheckpointHandler(session, context) {
  return async (checkpointSession) => {
    if (checkpointSession !== session) throw new Error('Walrus returned a different Maker upload session.');
    await persistMakerUploadRecovery(checkpointSession, context);
    if (!makerUploadContextIsActive(checkpointSession, context)) {
      throw new Error('The active Maker changed. The signed upload checkpoint was saved, and no later chain step was started.');
    }
    state.makerUploadStage = checkpointSession.stage;
    renderPublishAction();
  };
}

async function clearMakerUploadRecovery(
  templateId = state.templateId,
  walletAddress = state.walletAddress,
) {
  const recoveryKey = makerAssetStorageKey(templateId, walletAddress);
  loadedMakerUploadRecoveries.delete(recoveryKey);
  const recovery = await loadMakerUploadRecovery(recoveryKey);
  const deleted = !recovery || await deleteMakerUploadRecovery(recoveryKey, {
    expectedRevision: recovery.recoveryRevision,
    uploadSessionId: recovery.uploadSessionId,
  });
  if (
    deleted
    && state.templateId === templateId
    && state.walletAddress === walletAddress
    && makerAssetStorageKey(templateId, walletAddress) === recoveryKey
  ) {
    state.hasMakerUploadRecovery = false;
    state.makerPublicationIntent = null;
  }
  return deleted;
}

async function archiveAndDeleteUploadRecovery(recoveryKey, expectedRecovery) {
  return withBrowserUploadLock(recoveryKey, async () => {
    const recovery = await loadMakerUploadRecovery(recoveryKey);
    if (!recovery) return { deleted: true, archivedKey: '' };
    if (
      Number(recovery.recoveryRevision || 0) !== Number(expectedRecovery?.recoveryRevision || 0)
      || String(recovery.uploadSessionId || '') !== String(expectedRecovery?.uploadSessionId || '')
    ) {
      return { deleted: false, archivedKey: '' };
    }
    const deleted = await deleteMakerUploadRecovery(recoveryKey, {
      expectedRevision: recovery.recoveryRevision,
      uploadSessionId: recovery.uploadSessionId,
    });
    if (deleted) {
      const auditKey = 'animacraft-abandoned-upload-audit-v1';
      let history = [];
      try {
        history = JSON.parse(localStorage.getItem(auditKey) || '[]');
      } catch {
        history = [];
      }
      const entry = {
        archivedAt: new Date().toISOString(),
        archivedFrom: recoveryKey,
        owner: String(recovery.owner || ''),
        uploadSessionId: String(recovery.uploadSessionId || ''),
        recoveryRevision: Number(recovery.recoveryRevision || 0),
        stage: String(recovery.stage || recovery.checkpoint?.step || ''),
        quiltBlobId: String(recovery.quiltBlobId || ''),
        registerDigest: String(recovery.registerDigest || ''),
        certifyDigest: String(recovery.certifyDigest || ''),
        publicationDigest: String(recovery.publicationIntent?.digest || ''),
      };
      localStorage.setItem(auditKey, JSON.stringify([entry, ...history].slice(0, 10)));
    }
    return { deleted };
  });
}

async function requestDiscardMakerUploadRecovery() {
  const recoveryKey = makerAssetStorageKey();
  const templateId = state.templateId;
  const recovery = await loadMakerUploadRecovery(recoveryKey);
  if (!recovery) {
    loadedMakerUploadRecoveries.delete(recoveryKey);
    resetMakerUploadMemoryState();
    renderAll();
    return;
  }
  openConfirmation({
    title: t('discardUploadRecoveryTitle'),
    message: t('discardMakerUploadRecoveryMessage'),
    confirmLabel: t('discardUploadRecoveryConfirm'),
    action: async () => {
      const isActive = () => (
        state.templateId === templateId
        && makerAssetStorageKey(templateId) === recoveryKey
      );
      if (!isActive()) return;
      let deleted;
      try {
        ({ deleted } = await archiveAndDeleteUploadRecovery(recoveryKey, recovery));
      } catch (error) {
        if (isActive()) throw error;
        console.warn('The obsolete Maker upload could not be discarded after context changed.', error);
        return;
      }
      if (!deleted) {
        if (isActive()) {
          loadedMakerUploadRecoveries.delete(recoveryKey);
          await restoreMakerUploadRecovery(templateId, { force: true });
        }
        return;
      }
      loadedMakerUploadRecoveries.delete(recoveryKey);
      if (isActive()) {
        resetMakerUploadMemoryState();
        state.publishStatus = t('uploadRecoveryDiscarded');
        renderAll();
      }
    },
  });
}

async function syncLatestMakerUploadRecovery() {
  const recoveryKey = makerAssetStorageKey();
  const recovery = await loadMakerUploadRecovery(recoveryKey);
  if (!uploadStageIsAhead(recovery, state.makerUploadSession, state.makerUploadStage)) return false;
  await restoreMakerUploadRecovery(state.templateId, { force: true });
  return true;
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

function soulidityAppLink(pathname, params = {}, { includeWallet = true } = {}) {
  const base = safeExternalUrl(runtimeConfig.soulidityAppUrl);
  if (!base) return '#';
  const url = new URL(base);
  url.pathname = pathname;
  url.hash = '';
  url.search = '';
  url.searchParams.set('source', 'animacraft');
  if (includeWallet && state.walletConnected && state.walletAddress) {
    url.searchParams.set('wallet', state.walletAddress);
  }
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) url.searchParams.set(key, String(value));
  });
  return url.href;
}

function utf8Length(value) {
  return new TextEncoder().encode(String(value || '')).length;
}

function utf8Truncate(value, maximumBytes) {
  let result = '';
  for (const character of String(value || '')) {
    if (utf8Length(result + character) > maximumBytes) break;
    result += character;
  }
  return result;
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
  return [runtimeConfig.callablePackageId, runtimeConfig.originalPackageId].every((packageId) => (
    /^0x[0-9a-f]+$/i.test(String(packageId || '').trim()) && !packageId.includes('TODO')
  ));
}

async function connectSuiWallet() {
  try {
    await openWalletSelector();
  } catch (error) {
    state.publishStatus = state.locale === 'en' && error?.message
      ? error.message
      : t('walletConnectionFailed');
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
    [t('networkLabel'), runtimeConfig.network, t('chainNetworkNote'), 'ready'],
    [t('chainWalletLabel'), walletReady ? shortAddress(state.walletAddress) || t('signerConnected') : t('chainWalletNotConnected'), walletReady ? t('chainWalletReady') : t('chainWalletNeedConnect'), walletReady ? 'ready' : 'wait'],
    [t('packageLabel'), packageReady ? shortAddress(runtimeConfig.callablePackageId) : t('chainPackageDraft'), packageReady ? t('chainPackageReady') : t('chainPackageNeedPublish'), packageReady ? 'ready' : 'wait'],
    [t('walrusLabel'), walrusReady ? t('walrusConfigured', { network: runtimeConfig.network }) : t('endpointMissing'), t('walrusAssetNote'), walrusReady ? 'ready' : 'wait'],
    [t('discoveryLabel'), state.chainMakersLoading ? t('discoverySyncing') : state.chainMakerLoadError || (discoveryReady ? t('chainDerived') : t('waiting')), discoveryReady ? t('discoveryReadyNote') : t('discoverySetupNote'), discoveryReady ? 'ready' : 'wait'],
  ];
}

function filteredTemplates() {
  const query = state.search.trim().toLowerCase();
  return templates.filter((template) => {
    if (template.source === 'local') return false;
    if (template.source !== 'chain' && !(localUiTest && template.source === 'creator-pack')) return false;
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

function canOpenPlayer(template = activeTemplate()) {
  if (!template) return false;
  if (template.source === 'chain') return !makerModels.get(template.id)?.makerArchived;
  if (localUiTest && template.source === 'creator-pack') return makerModels.has(template.id);
  return Boolean(state.previewingMaker && template.source === 'local' && makerModels.has(template.id));
}

function makerHasRenderableAssets() {
  if (state.makerRuntimeAssetsV4 instanceof Map && state.makerRuntimeAssetsV4.size > 0) return true;
  return state.assets.some((asset) => Boolean(asset?.blob || asset?.file || asset?.url));
}

function setPage(page) {
  const previousPage = state.page;
  const requestedPage = page === 'editor' ? 'make' : page === 'protocol' ? 'docs' : page;
  if ((state.publishing || state.minting) && requestedPage !== previousPage) {
    if (state.publishing) state.publishStatus = t('publishingStatus');
    if (state.minting) state.mintStatus = t('preparingHandoff');
    renderAll();
    return false;
  }
  const walletAllowedPage = !state.walletConnected && !['templates', 'template', 'docs'].includes(requestedPage) ? 'templates' : requestedPage;
  state.page = walletAllowedPage === 'make' && !canOpenPlayer() ? 'templates' : walletAllowedPage;
  if (state.page === 'make') {
    if (previousPage !== 'make' && $('legacyPlayerEditor')) {
      $('legacyPlayerEditor').hidden = true;
      $('legacyPlayerEditor').classList.remove('handoff-only');
    }
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
  if (state.page === 'make') setTimeout(() => restoreOcUploadRecovery(state.templateId, { force: true }), 0);
  if (state.page === 'collection') setTimeout(() => loadOwnedCharacters(), 0);
  if (state.page === 'docs') void renderDocsHandbook();
  return true;
}

function setCreatorView(view) {
  state.creatorView = view;
  if (view === 'edit' && ['top', 'rules', 'palette', 'preview'].includes(state.editorPanel)) state.editorPanel = 'parts';
  document.querySelector('.maker-list-panel')?.classList.toggle('editing', state.creatorView === 'edit');
  document.querySelectorAll('[data-creator-view]').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.creatorView === state.creatorView);
  });
  if ($('editingMakerTitle')) $('editingMakerTitle').textContent = activeTemplate().name;
  setEditorPanel(state.editorPanel || 'top');
}

function setEditorPanel(panel) {
  state.editorPanel = panel;
  document.querySelector('.creator-view[data-creator-view="edit"]')
    ?.classList.toggle('v4-parts-active', state.editorPanel === 'parts');
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
    living: t('livingContent'),
    preview: t('previewCheck'),
    publish: t('onchainPublish'),
    settings: t('settings'),
  };
  if ($('editingPanelKicker')) $('editingPanelKicker').textContent = labels[state.editorPanel] || t('characterMaker');
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
  const publicMakerCount = templates.filter((template) => template.source === 'chain' && !makerModels.get(template.id)?.makerArchived).length;
  if ($('publicMakerCount')) $('publicMakerCount').textContent = String(publicMakerCount);
  $('templateGrid').innerHTML = list.length ? list.map((template) => {
    const metrics = templateModelMetrics(template);
    const sourceLabel = templateSourceLabel(template);
    return `
    <article class="template-card ${template.id === state.templateId ? 'active' : ''}" data-template="${escapeHtml(template.id)}">
      <div class="template-cover" style="--accent:${safeCssColor(template.accent)}; --secondary:${safeCssColor(template.secondary, '#f0a23a')};">
        ${template.coverUrl
          ? `<img class="template-cover-image" src="${escapeHtml(template.coverUrl)}" alt="${escapeHtml(t('makerPreviewAlt', { name: template.name }))}" loading="lazy" />`
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
        <p class="creator-line">${escapeHtml(t('byCreator', { creator: template.creator }))}</p>
        <p>${escapeHtml(template.summary)}</p>
        <div class="sample-strip" aria-label="${escapeHtml(t('templateSamplesAria', { name: template.name }))}">
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
  }).join('') : publicMakerCount === 0 ? `
    <section class="empty-state plaza-empty-state">
      <span class="empty-state-mark" aria-hidden="true">＋</span>
      <h2>${t('noPublishedMakers')}</h2>
      <p>${t('noPublishedMakersCopy')}</p>
      <button class="primary" type="button" data-create-first-maker>${t('createFirstMaker')}</button>
    </section>
  ` : `<div class="empty-state">${t('noMatchingMakers')}</div>`;

  document.querySelector('[data-create-first-maker]')?.addEventListener('click', async () => {
    if (!state.walletConnected) {
      state.pendingWalletPage = 'creator';
      await connectSuiWallet();
      return;
    }
    setPage('creator');
    renderAll();
    openMakerModal();
  });

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
  if (!template || template.source === 'local' || (template.source !== 'chain' && !(localUiTest && template.source === 'creator-pack'))) return;
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
          ? `<img class="template-cover-image" src="${escapeHtml(template.coverUrl)}" alt="${escapeHtml(t('makerPreviewAlt', { name: template.name }))}" />`
          : `<div class="cover-face"><span class="cover-hair"></span><span class="cover-eye left"></span><span class="cover-eye right"></span><span class="cover-mouth"></span></div>`}
        <span class="cover-style">${escapeHtml(template.style)}</span>
      </div>
    </div>
    <div class="template-detail-copy">
      <div class="badge-row">
        <span>${templateSourceLabel(template)}</span>
        <span>${escapeHtml(template.license)}</span>
        ${archived ? `<span>${escapeHtml(t('archived'))}</span>` : ''}
      </div>
      <h1>${escapeHtml(template.name)}</h1>
      <p class="creator-line">${escapeHtml(t('byCreator', { creator: template.creator }))}</p>
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
        ${template.objectId ? `<a href="${escapeHtml(explorerObjectUrl(template.objectId))}" target="_blank" rel="noreferrer">${escapeHtml(t('viewSuiMaker'))}</a>` : ''}
        ${manifestUrl ? `<a href="${escapeHtml(manifestUrl)}" target="_blank" rel="noreferrer">${escapeHtml(t(template.quiltId ? 'openWalrusManifest' : 'openMakerManifest'))}</a>` : ''}
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
      document.querySelector('.parts-panel')?.scrollTo({ top: 0 });
    });
  });
}

function renderParts() {
  const slot = activeSlot();
  if (!slot) {
    $('slotTitle').textContent = t('noPartsYet');
    $('slotDescription').textContent = t('createFirstPartInMaker');
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
      <strong>${escapeHtml(t('noneOption'))}</strong>
      <small>${escapeHtml(t('removeThisPart'))}</small>
    </button>
  ` : '';
  $('partGrid').innerHTML = removeOption + publicItems.map((part, index) => {
    const pickerAsset = itemPickerAsset(slot, part);
    return `
      <button class="part-card ${state.visual[slot.key] === part.id ? 'active' : ''}" data-part="${escapeHtml(part.id)}" ${state.minting || selectionWouldBreakRule(slot.key, part.id) ? `disabled title="${escapeHtml(t('unavailableSelection'))}"` : ''}>
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
      <button class="swatch ${state.visual.palette[slot.colorKey] === value ? 'active' : ''}" data-swatch="${escapeHtml(color)}" style="background:${color}" aria-label="${escapeHtml(t('useColor', { color }))}" ${state.minting ? 'disabled' : ''}></button>
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

function makerV4AssetDescriptor(documentV4, assetId) {
  const normalizedAssetId = String(assetId || '');
  return normalizedAssetId
    ? (documentV4?.assets || []).find((asset) => String(asset.id || '') === normalizedAssetId) || null
    : null;
}

function makerV4RuntimeAssetRecord(assetId) {
  const normalizedAssetId = String(assetId || '');
  return normalizedAssetId
    ? currentV4RuntimeAssets().find((record) => (
        String(record?.assetId || record?.id || '') === normalizedAssetId
      )) || null
    : null;
}

function makerV4RuntimeAssetSource(record) {
  const source = record?.blob || record?.file;
  return source && typeof source.arrayBuffer === 'function' ? source : null;
}

function makerV4HasUsableCover(documentV4) {
  const coverAssetId = String(documentV4?.metadata?.coverAssetId || '');
  const descriptor = makerV4AssetDescriptor(documentV4, coverAssetId);
  if (!descriptor || !descriptor.identifier || !String(descriptor.mediaType || '').startsWith('image/')) return false;
  const record = makerV4RuntimeAssetRecord(coverAssetId);
  if (makerV4RuntimeAssetSource(record)) return true;
  if (record?.url || descriptor.url || descriptor.legacy?.url) return true;
  return Boolean(activeTemplate()?.quiltId && descriptor.identifier);
}

function makerV4ReleaseCoverIsGenerated(documentV4) {
  const descriptor = makerV4AssetDescriptor(documentV4, documentV4?.metadata?.coverAssetId);
  return descriptor?.source === 'generated-release';
}

function makerV4ReleaseCoverBlob(documentV4, runtimeAssets) {
  const record = runtimeAssets?.get?.(String(documentV4?.metadata?.coverAssetId || ''));
  return makerV4RuntimeAssetSource(record);
}

function makerV4DocumentForRelease({ includeGeneratedCover = false, sourceDocument = state.makerDocumentV4 } = {}) {
  if (!isMakerV4Document(sourceDocument)) return null;
  const documentV4 = structuredClone(sourceDocument);
  // MakerDocument is the canonical source for public metadata. The legacy
  // shell inputs are only a compatibility projection and may lag behind the
  // Creator Workspace after a restore or an autosaved Maker Info edit.
  documentV4.publication = {
    ...documentV4.publication,
    royaltyBps: Number($('creatorRoyalty')?.value || 0),
    mintingEnabled: $('creatorMintingEnabled')?.checked !== false,
    mintFeeEnabled: Boolean($('creatorMintFeeEnabled')?.checked),
    mintPriceAtomic: $('creatorMintFeeEnabled')?.checked ? decimalCoinToAtomic($('creatorMintPrice')?.value) || 0 : 0,
    paymentCoinType: runtimeConfig.paymentCoinType,
    paymentCoinSymbol: runtimeConfig.paymentCoinSymbol,
    storage: 'walrus',
    chain: 'sui',
  };
  documentV4.runtime = {
    network: runtimeConfig.network,
    packageId: runtimeConfig.callablePackageId,
    callablePackageId: runtimeConfig.callablePackageId,
    originalPackageId: runtimeConfig.originalPackageId,
    assetAddressing: 'walrus-quilt-id+identifier',
  };
  documentV4.livingContent = normalizeLivingContent(documentV4.livingContent, documentV4.metadata);
  if (!includeGeneratedCover) return documentV4;
  if (makerV4HasUsableCover(documentV4)) return documentV4;

  const usedIds = new Set(documentV4.assets.map((asset) => asset.id));
  const usedIdentifiers = new Set(documentV4.assets.map((asset) => asset.identifier).filter(Boolean));
  let coverAssetId = 'maker-release-cover';
  let suffix = 2;
  while (usedIds.has(coverAssetId)) {
    coverAssetId = `maker-release-cover-${suffix}`;
    suffix += 1;
  }
  let identifier = 'maker-cover.png';
  suffix = 2;
  while (usedIdentifiers.has(identifier)) {
    identifier = `maker-cover-${suffix}.png`;
    suffix += 1;
  }
  documentV4.assets.push({
    id: coverAssetId,
    identifier,
    kind: 'maker-cover',
    mediaType: 'image/png',
    width: documentV4.canvas.width,
    height: documentV4.canvas.height,
    source: 'generated-release',
  });
  documentV4.metadata.coverAssetId = coverAssetId;
  return documentV4;
}

async function makerV4RuntimeAssetsForRelease(documentV4, providedCoverBlob = null) {
  const projectionDocument = prepareMakerV4ProjectionV2Document(documentV4);
  const runtimeAssets = new Map();
  currentV4RuntimeAssets().forEach((record) => {
    const assetId = String(record.assetId || record.id || '');
    if (assetId) runtimeAssets.set(assetId, record);
  });
  const coverAssetId = String(documentV4.metadata.coverAssetId || '');
  const coverDescriptor = makerV4AssetDescriptor(documentV4, coverAssetId);
  if (providedCoverBlob) {
    const existingCover = runtimeAssets.get(coverAssetId);
    runtimeAssets.set(coverAssetId, {
      ...existingCover,
      assetId: coverAssetId,
      blob: providedCoverBlob,
      file: providedCoverBlob,
      fileName: coverDescriptor?.identifier || existingCover?.fileName || 'maker-cover.png',
    });
  }
  for (const descriptor of projectionDocument.assets) {
    if (runtimeAssets.get(descriptor.id)?.blob || runtimeAssets.get(descriptor.id)?.file) continue;
    const record = runtimeAssets.get(descriptor.id);
    const url = record?.url
      || descriptor.url
      || descriptor.legacy?.url
      || (activeTemplate()?.quiltId && descriptor.identifier ? walrusQuiltFileUrl(activeTemplate().quiltId, descriptor.identifier) : '');
    if (!url) continue;
    const response = await fetchWalrusWithBackoff(url);
    if (!response.ok) throw new Error(`Could not reload ${descriptor.identifier} for this Maker version (${response.status}).`);
    const blob = await responseBlobWithinLimit(response, 20 * 1024 * 1024, `Maker asset ${descriptor.identifier}`);
    runtimeAssets.set(descriptor.id, { ...record, assetId: descriptor.id, blob, file: blob, url });
  }
  if (!coverDescriptor || !makerV4ReleaseCoverBlob(documentV4, runtimeAssets)) {
    throw new Error('The Maker cover has no readable image source. Re-upload the cover or generate a new release cover.');
  }
  const descriptorById = new Map(
    projectionDocument.assets.map((descriptor) => [String(descriptor.id || ''), descriptor]),
  );
  const styleAssetIds = new Set(projectionDocument.parts.flatMap((part) => (
    (part.items || []).flatMap((item) => (
      (item.styles || []).map((style) => String(style.assetId || '')).filter(Boolean)
    ))
  )));
  for (const assetId of styleAssetIds) {
    const descriptor = descriptorById.get(assetId);
    const record = runtimeAssets.get(assetId);
    const source = record?.file || record?.blob;
    if (!descriptor || !source) continue;
    const name = descriptor.identifier || record.fileName || `${assetId}.png`;
    const file = source instanceof File
      && String(source.type || '').toLowerCase() === 'image/png'
      ? source
      : new File([source], name, { type: 'image/png' });
    let inspection;
    try {
      inspection = await inspectPngAsset(file, projectionDocument.canvas);
    } catch (error) {
      throw new Error(`${t('pngVerificationFailed')} ${name}: ${error.message || ''}`.trim());
    }
    if (!inspection.alphaAnalyzed) throw new Error(`${t('pngVerificationFailed')} ${name}`);
    if (inspection.hasVisiblePixels === false) {
      throw new Error(t('transparentStylePng', { name }));
    }
  }
  return runtimeAssets;
}

const MAKER_PROJECTION_AUXILIARY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==';

function makerProjectionAuxiliaryPngBlob() {
  const bytes = Uint8Array.from(atob(MAKER_PROJECTION_AUXILIARY_PNG_BASE64), (character) => (
    character.charCodeAt(0)
  ));
  return new Blob([bytes], { type: 'image/png' });
}

function makerV4PublicExtensions(documentV4) {
  const expansionDrafts = structuredClone(documentV4.extensions?.expansionDrafts || []);
  return expansionDrafts.length
    ? { expansionRuntime: 'embedded-v1', expansionDrafts }
    : {};
}

function creatorManifest() {
  const documentV4 = makerV4DocumentForRelease();
  if (documentV4) return documentV4;
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
      packageId: runtimeConfig.callablePackageId,
      callablePackageId: runtimeConfig.callablePackageId,
      originalPackageId: runtimeConfig.originalPackageId,
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
  const documentV4 = makerV4DocumentForRelease({ includeGeneratedCover: true });
  if (documentV4) {
    return buildMakerV4PublicationManifest(documentV4, {
      previousDocument: isMakerV4Document(state.publishedMakerDocumentV4) ? state.publishedMakerDocumentV4 : null,
      publicExtensions: makerV4PublicExtensions(documentV4),
    });
  }
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
  if (state.pendingMakerV4Bundle?.entries?.length) return state.pendingMakerV4Bundle.entries;
  const manifestBlob = new Blob([state.pendingMakerManifestJson], { type: 'application/json' });
  return [
    ...state.pendingMakerAssets.map((asset) => ({ blob: asset.file, identifier: asset.identifier, kind: asset.kind })),
    { blob: manifestBlob, identifier: 'animacraft-manifest.json', kind: 'maker-manifest' },
  ];
}

function currentMakerV4OcBundle({
  createdAt = new Date().toISOString(),
  integrity = null,
  requireCompletion = false,
} = {}) {
  if (!isMakerV4Document(state.makerDocumentV4)) return null;
  // Provenance must always reference the complete immutable Maker manifest.
  // Player runtime documents intentionally omit disabled ExpansionPacks.
  const documentV4 = structuredClone(state.makerDocumentV4);
  const completion = state.playerCompletionSnapshotV4?.makerVersionId === documentV4.version.versionId
    ? state.playerCompletionSnapshotV4
    : null;
  if (requireCompletion && !completion) {
    const error = new Error(t('completeOcBeforePublishing'));
    error.code = 'OC_COMPLETION_REQUIRED';
    throw error;
  }
  const sourceProfile = completion?.profile || v4ProfileFromLegacy();
  const profile = {
    name: sourceProfile.name || 'Untitled OC',
    world: sourceProfile.world || documentV4.metadata.style,
    description: sourceProfile.description || '',
    tags: Array.isArray(sourceProfile.tags) ? [...sourceProfile.tags] : splitList(sourceProfile.tags),
  };
  const livingContent = soulidityContentManifest(
    completion?.livingContent || documentV4.livingContent,
    {
      maker: documentV4.metadata,
      makerId: activeMakerObjectId(),
      profile,
    },
  );
  return buildMakerV4OcPackage({
    document: documentV4,
    recipe: completion?.recipe || state.playerRecipeV4 || state.makerRecipeV4 || documentV4.defaultRecipe,
    profile,
    livingContent,
    makerObjectId: activeMakerObjectId(),
    manifestBlobId: activeTemplate()?.quiltId || state.makerQuiltId || '',
    createdAt,
    integrity,
  });
}

function ocPackage() {
  if (isMakerV4Document(state.makerDocumentV4)
    && activeTemplate()?.source === 'chain'
    && !makerHasPendingV4Version()) {
    return currentMakerV4OcBundle().package;
  }
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
      packageId: runtimeConfig.callablePackageId,
      callablePackageId: runtimeConfig.callablePackageId,
      originalPackageId: runtimeConfig.originalPackageId,
      materialStorage: 'Walrus blob ids',
      templateObject: 'Animacraft OCMaker object',
      soulObject: 'Soulidity Soul object',
      makerAuthorization: 'Animacraft validates the recipe and optional Maker fee before Soulidity consumes the mint authorization',
      policy: 'Soulidity mints and trades the only finished character object; Animacraft does not create a parallel OC token',
      walletSigner: state.walletAddress || 'not-connected',
    },
  };
}

function ocFingerprint(oc = state.pendingOcPackage || ocPackage()) {
  return canonicalOcPackageFingerprint(oc);
}

function ocUploadEntries() {
  if (!state.pendingOcImageBlob || !state.pendingOcProfileBlob) throw new Error(t('ocFilesMissing'));
  return [
    { blob: state.pendingOcImageBlob, identifier: 'animacraft-oc.png', kind: 'oc-image' },
    { blob: state.pendingOcProfileBlob, identifier: 'animacraft-oc.json', kind: 'oc-profile' },
  ];
}

function captureOcUploadPersistenceContext(session = state.ocUploadSession) {
  if (!session?.checkpoint || !state.pendingOcImageBlob || !state.pendingOcProfileBlob || !state.pendingOcPackage) return null;
  return Object.freeze({
    recoveryKey: ocUploadStorageKey(),
    templateId: state.templateId,
    imageBlob: state.pendingOcImageBlob,
    profileBlob: state.pendingOcProfileBlob,
    ocPackage: structuredClone(state.pendingOcPackage),
    recipeHash: state.pendingOcRecipeHash instanceof Uint8Array
      ? new Uint8Array(state.pendingOcRecipeHash)
      : state.pendingOcRecipeHash,
    recipeJson: state.pendingOcRecipeJson,
    fingerprint: state.pendingOcFingerprint,
  });
}

function ocUploadContextIsActive(session, context) {
  return Boolean(
    session
    && context
    && state.ocUploadSession === session
    && state.templateId === context.templateId
    && ocUploadStorageKey() === context.recoveryKey,
  );
}

async function persistOcUploadRecovery(
  session = state.ocUploadSession,
  context = captureOcUploadPersistenceContext(session),
) {
  if (!session?.checkpoint || !context) {
    throw new Error('The OC upload checkpoint has no stable persistence context.');
  }
  const active = ocUploadContextIsActive(session, context);
  const stage = session.stage || (active ? state.ocUploadStage : session.checkpoint.step);
  const verified = await saveVerifiedUploadRecovery(context.recoveryKey, {
    kind: 'oc-mint',
    owner: session.owner,
    uploadSessionId: session.uploadSessionId || '',
    recoveryRevision: Number(session.recoveryRevision || 0),
    stage,
    checkpoint: session.checkpoint,
    registerDigest: session.registerDigest || '',
    certifyDigest: session.certifyDigest || '',
    ...uploadRecoveryQuote(session),
    ...uploadRecoveryTransactions(session),
    quiltBlobId: session.quiltBlobId || '',
    files: (session.files || []).map(({ id, blobId }) => ({ id, blobId })),
    imageBlob: context.imageBlob,
    profileBlob: context.profileBlob,
    ocPackage: context.ocPackage,
    recipeHash: context.recipeHash,
    recipeJson: context.recipeJson,
    fingerprint: context.fingerprint,
  });
  session.recoveryRevision = Number(verified.recoveryRevision || session.recoveryRevision || 0);
  session.recoverySavedAt = Number(verified.savedAt || Date.now());
  if (active) {
    state.ocUploadStage = stage;
    state.hasOcUploadRecovery = true;
    loadedOcUploadRecoveries.add(context.recoveryKey);
  }
  return verified;
}

function ocUploadCheckpointHandler(session, context) {
  return async (checkpointSession) => {
    if (checkpointSession !== session) throw new Error('Walrus returned a different OC upload session.');
    await persistOcUploadRecovery(checkpointSession, context);
    if (!ocUploadContextIsActive(checkpointSession, context)) {
      throw new Error('The active Maker changed. The signed OC checkpoint was saved, and no later chain step was started.');
    }
    state.ocUploadStage = checkpointSession.stage;
    renderMintAction();
  };
}

async function clearOcUploadRecovery(templateId = state.templateId) {
  const recoveryKey = ocUploadStorageKey(templateId);
  loadedOcUploadRecoveries.delete(recoveryKey);
  const recovery = await loadMakerUploadRecovery(recoveryKey);
  const deleted = !recovery || await deleteMakerUploadRecovery(recoveryKey, {
    expectedRevision: recovery.recoveryRevision,
    uploadSessionId: recovery.uploadSessionId,
  });
  if (
    deleted
    && state.templateId === templateId
    && ocUploadStorageKey(templateId) === recoveryKey
  ) state.hasOcUploadRecovery = false;
  return deleted;
}

async function requestDiscardOcUploadRecovery() {
  const recoveryKey = ocUploadStorageKey();
  const templateId = state.templateId;
  const recovery = await loadMakerUploadRecovery(recoveryKey);
  if (!recovery) {
    loadedOcUploadRecoveries.delete(recoveryKey);
    resetOcUploadState();
    renderAll();
    return;
  }
  openConfirmation({
    title: t('discardUploadRecoveryTitle'),
    message: t('discardOcUploadRecoveryMessage'),
    confirmLabel: t('discardUploadRecoveryConfirm'),
    action: async () => {
      const isActive = () => (
        state.templateId === templateId
        && ocUploadStorageKey(templateId) === recoveryKey
      );
      if (!isActive()) return;
      let deleted;
      try {
        ({ deleted } = await archiveAndDeleteUploadRecovery(recoveryKey, recovery));
      } catch (error) {
        if (isActive()) throw error;
        console.warn('The obsolete OC upload could not be discarded after context changed.', error);
        return;
      }
      if (!deleted) {
        if (isActive()) {
          loadedOcUploadRecoveries.delete(recoveryKey);
          await restoreOcUploadRecovery(templateId, { force: true });
        }
        return;
      }
      loadedOcUploadRecoveries.delete(recoveryKey);
      if (isActive()) {
        resetOcUploadState();
        state.mintStatus = t('uploadRecoveryDiscarded');
        renderAll();
      }
    },
  });
}

async function syncLatestOcUploadRecovery() {
  const recoveryKey = ocUploadStorageKey();
  const recovery = await loadMakerUploadRecovery(recoveryKey);
  if (!uploadStageIsAhead(recovery, state.ocUploadSession, state.ocUploadStage)) return false;
  await restoreOcUploadRecovery(state.templateId, { force: true });
  return true;
}

function invalidateOcUpload(message = 'The OC changed. Prepare a new mint upload.') {
  if (state.minting) return;
  ocUploadRestoreRequestId += 1;
  const hadPreparedUpload = state.ocUploadStage !== 'idle' || state.hasOcUploadRecovery || state.mintDigest;
  const recoveryKey = ocUploadStorageKey();
  const staleSession = state.ocUploadSession;
  resetOcUploadState();
  if (hadPreparedUpload) state.mintStatus = message;
  loadedOcUploadRecoveries.delete(recoveryKey);
  withBrowserUploadLock(recoveryKey, async () => {
    const recovery = await loadMakerUploadRecovery(recoveryKey);
    if (
      staleSession?.uploadSessionId
      && recovery?.uploadSessionId
      && recovery.uploadSessionId !== staleSession.uploadSessionId
    ) return;
    await deleteMakerUploadRecovery(recoveryKey, {
      expectedRevision: recovery?.recoveryRevision,
      uploadSessionId: recovery?.uploadSessionId,
    });
  }).catch((error) => console.warn('Could not clear stale OC upload recovery.', error));
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
  select.innerHTML = `<option value="">${escapeHtml(t('anyItemInPart'))}</option>${items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`).join('')}`;
  select.value = items.some((item) => item.id === preferredValue) ? preferredValue : '';
  select.disabled = items.length === 0;
}

function makerPublicationIssues() {
  if (isMakerV4Document(state.makerDocumentV4)) {
    const issues = (makerWorkspace?.getPublicationIssues?.() || []).map((issue) => issue.message || String(issue));
    const lineageFork = makerPublishedLineageFork();
    if (lineageFork) {
      issues.unshift(makerVersionLineageForkMessage(lineageFork));
    }
    const versionConflict = makerVersionDraftConflict();
    if (versionConflict) {
      issues.unshift(makerVersionDraftConflictMessage(
        versionConflict,
        state.makerDocumentV4,
      ));
    }
    try {
      creatorUploadManifest();
    } catch (error) {
      issues.push(error.message || 'The Maker v5 publication manifest is invalid.');
    }
    return [...new Set(issues)];
  }
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
    validateAnyMakerManifest(creatorUploadManifest());
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
    [missingCells === 0, missingCells ? `${missingCells} required Style PNG references are still empty.` : 'Every public Item has all required Style PNG images.'],
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
          <b>${escapeHtml(t('cannotCombineWithLabel'))}</b>
          <span>${escapeHtml(selectionRuleSideLabel(rule.rightPartKey, rule.rightItemKey))}</span>
          <button type="button" data-remove-rule="${index}" aria-label="${escapeHtml(t('removeRule'))}">×</button>
        </div>
      `).join('')
    : `<p>${escapeHtml(t('noSelectionRules'))}</p>`;
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
          <b>${escapeHtml(t('sharesPaletteWith'))}</b>
          <span>${escapeHtml(allSlots().find((slot) => slot.key === link.linkedPartKey)?.label || link.linkedPartKey)}</span>
          <button type="button" data-remove-palette-link="${index}" aria-label="${escapeHtml(t('removePaletteLink'))}">×</button>
        </div>
      `).join('')
    : `<p>${escapeHtml(t('noLinkedPalettes'))}</p>`;
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
  soulMd: { titleKey: 'soulCharacter', kind: 'SOUL_DOC · soul', filename: 'soul.md' },
  memoryMd: { titleKey: 'memory', kind: 'MEMORY · default', filename: 'memory.md' },
  skillMd: { titleKey: 'skillsDocs', kind: 'SKILL · SKILL.md', filename: 'skills.zip / SKILL.md' },
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
  const documentV4 = currentMakerV4Source();
  if (documentV4) {
    state.livingContent = normalizeLivingContent(documentV4.livingContent, documentV4.metadata);
    return;
  }
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
  $('livingDocumentTitle').textContent = t(meta.titleKey);
  $('livingDocumentFilename').textContent = meta.filename;
  $('livingDocumentSize').textContent = t('byteCount', { count: new TextEncoder().encode(source).length.toLocaleString() });
  if ($('livingDocumentSource').value !== source) $('livingDocumentSource').value = source;
  const livingLocked = makerIsPublished() && !makerHasPendingV4Version();
  $('livingDocumentSource').disabled = livingLocked;
  $('restoreLivingDefault').disabled = livingLocked || !state.livingContent.customized[state.livingDocument];
  const customizedCount = Object.values(state.livingContent.customized).filter(Boolean).length;
  $('livingContentStatus').textContent = customizedCount ? t('customizedCount', { count: customizedCount }) : t('defaultsReady');
  $('livingSoulState').textContent = state.livingContent.customized.soulMd ? t('customizedStatus') : t('defaultStatus');
  $('livingMemoryState').textContent = state.livingContent.customized.memoryMd ? t('customizedStatus') : t('defaultStatus');
  $('livingSkillState').textContent = state.livingContent.customized.skillMd ? t('customizedStatus') : t('defaultStatus');
}

function renderPackage() {
  try {
    $('packagePreview').textContent = JSON.stringify(ocPackage(), null, 2);
  } catch (error) {
    $('packagePreview').textContent = JSON.stringify({ status: 'draft', issue: error.message || 'OC package is not ready.' }, null, 2);
  }
}

function ocRecipeIssues() {
  const issues = [];
  const profileName = $('profileName').value.trim();
  if (!profileName) issues.push('Name this OC before preparing its mint.');
  if (utf8Length(profileName) > 128) issues.push('OC name cannot exceed 128 UTF-8 bytes.');
  if (utf8Length($('profileWorld').value) > 128) issues.push('OC world cannot exceed 128 UTF-8 bytes.');
  if (utf8Length($('profileDescription').value) > 2_000) issues.push('OC description cannot exceed 2,000 UTF-8 bytes.');
  if (utf8Length($('profileTags').value) > 1_000) issues.push('OC tags cannot exceed 1,000 UTF-8 bytes.');
  if (isMakerV4Document(state.makerDocumentV4)) {
    if (makerHasPendingV4Version()) issues.push('Publish this Maker version before using it to mint a Soul. Player test remains available.');
    const recipeDocument = isMakerV4Document(state.playerRuntimeDocumentV4)
      && state.playerRuntimeDocumentV4.version.versionId === state.makerDocumentV4.version.versionId
      ? state.playerRuntimeDocumentV4
      : state.makerDocumentV4;
    const recipe = state.playerRecipeV4 || state.makerRecipeV4 || recipeDocument.defaultRecipe;
    if (!recipe?.selections?.length) issues.push('Choose at least one Item for this OC.');
    const evaluated = evaluateRecipe(recipeDocument, recipe);
    evaluated.violations.forEach((violation) => {
      const part = recipeDocument.parts.find((candidate) => candidate.id === violation.partId || candidate.id === violation.trigger?.partId);
      issues.push(`${part?.name || violation.partId || 'The current OC'}: ${String(violation.code || 'invalid selection').replaceAll('-', ' ')}.`);
    });
    if (state.makerArchived) issues.push('This Maker is archived and does not accept new Soul authorizations.');
    return [...new Set(issues)];
  }
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
  if (!packageConfigured()) return t('movePackageMissing');
  if (activeTemplate()?.source !== 'chain' || !activeMakerObjectId()) return t('previewMintLocked');
  if (activeTemplate().mintingEnabled === false || makerModels.get(activeTemplate().id)?.makerArchived) return t('makerMintClosed');
  if (activeTemplate().mintFeeEnabled && !activeTemplate().treasuryId && !state.makerTreasuryObjectId) return t('paidTreasuryMissing');
  if (!state.walletConnected) return t('connectMintWallet');
  if (!/^0x[0-9a-f]+$/i.test(String(runtimeConfig.soulidityPackageId || '')) || String(runtimeConfig.soulidityPackageId).includes('TODO')) {
    return t('soulidityPackageMissing');
  }
  if (!canonicalSoulMintEnabled) return t('canonicalMintGateClosed');
  const issue = ocRecipeIssues()[0];
  if (issue) return issue;
  return t('mintNextStep');
}

function renderMintAction() {
  if (!$('mintOcOnchain')) return;
  const mintOpen = activeTemplate()?.mintingEnabled !== false && !makerModels.get(activeTemplate()?.id)?.makerArchived;
  const treasuryReady = !activeTemplate()?.mintFeeEnabled || Boolean(activeTemplate()?.treasuryId || state.makerTreasuryObjectId);
  const soulidityReady = /^0x[0-9a-f]+$/i.test(String(runtimeConfig.soulidityPackageId || '')) && !String(runtimeConfig.soulidityPackageId).includes('TODO');
  const adapterReady = canonicalSoulMintEnabled;
  const baseReady = packageConfigured() && soulidityReady && activeTemplate()?.source === 'chain' && Boolean(activeMakerObjectId()) && state.walletConnected && mintOpen && treasuryReady && adapterReady && ocRecipeIssues().length === 0;
  const chainMakerReady = activeTemplate()?.source === 'chain' && Boolean(activeMakerObjectId());
  const failedAction = String(state.ocPublishError?.action || '');
  const canRetryPrepareCheckpoint = failedAction === 'prepare' && Boolean(state.ocUploadSession?.checkpoint);
  const canRetryRegisterCheckpoint = failedAction === 'register'
    && ['uploaded', 'certified'].includes(state.ocUploadStage);
  const canRetryCertifyCheckpoint = failedAction === 'certify'
    && state.ocUploadStage === 'certified';
  $('resumeOcUpload').hidden = !chainMakerReady || !state.hasOcUploadRecovery || state.ocUploadStage !== 'idle';
  $('prepareOcUpload').hidden = !chainMakerReady || state.ocUploadStage !== 'idle' || state.hasOcUploadRecovery;
  $('registerOcUpload').hidden = !['encoded', 'register-pending', 'registered'].includes(state.ocUploadStage);
  $('certifyOcUpload').hidden = !['uploaded', 'certify-pending'].includes(state.ocUploadStage);
  $('mintOcOnchain').hidden = state.ocUploadStage !== 'certified';
  $('resumeOcUpload').disabled = state.minting || !state.walletConnected || activeTemplate()?.source !== 'chain' || !state.hasOcUploadRecovery;
  $('prepareOcUpload').disabled = state.minting || !baseReady || state.ocUploadStage !== 'idle';
  $('registerOcUpload').disabled = state.minting || !adapterReady || !state.walletConnected || !['encoded', 'register-pending', 'registered'].includes(state.ocUploadStage);
  $('registerOcUpload').textContent = state.ocUploadStage === 'registered' ? t('retryUpload') : t('registerUpload');
  $('certifyOcUpload').disabled = state.minting || !adapterReady || !state.walletConnected || !['uploaded', 'certify-pending'].includes(state.ocUploadStage);
  $('mintOcOnchain').disabled = state.minting || !baseReady || state.ocUploadStage !== 'certified';
  $('mintOcOnchain').textContent = state.minting ? t('preparingHandoff') : t('mintOc');
  $('mintOcStatus').textContent = state.mintStatus || mintReadiness();
  ['profileName', 'profileWorld', 'profileDescription', 'profileTags'].forEach((id) => {
    if ($(id)) $(id).disabled = state.minting;
  });
  makerWorkspace?.setPlayerPublishState?.({
    stage: state.ocUploadStage,
    status: state.mintStatus || mintReadiness(),
    busy: state.minting,
    digest: state.mintDigest,
    error: state.ocPublishError,
    relayTipMist: state.ocUploadSession?.relayTipMist == null
      ? null
      : String(state.ocUploadSession.relayTipMist),
    relayTipQuotedAt: String(state.ocUploadSession?.relayTipQuotedAt || ''),
    walrusStorageCostFrost: state.ocUploadSession?.walrusStorageCostFrost == null
      ? null
      : String(state.ocUploadSession.walrusStorageCostFrost),
    walrusWriteCostFrost: state.ocUploadSession?.walrusWriteCostFrost == null
      ? null
      : String(state.ocUploadSession.walrusWriteCostFrost),
    walrusTotalCostFrost: state.ocUploadSession?.walrusTotalCostFrost == null
      ? null
      : String(state.ocUploadSession.walrusTotalCostFrost),
    actions: {
      resume: !state.minting && chainMakerReady && state.hasOcUploadRecovery && state.ocUploadStage === 'idle',
      discard: !state.minting
        && state.hasOcUploadRecovery
        && state.ocUploadStage === 'idle'
        && failedAction === 'resume',
      prepare: !state.minting && adapterReady && (
        (baseReady && state.ocUploadStage === 'idle' && !state.hasOcUploadRecovery)
        || canRetryPrepareCheckpoint
      ),
      register: !state.minting && adapterReady && state.walletConnected && (
        ['encoded', 'register-pending', 'registered'].includes(state.ocUploadStage)
        || canRetryRegisterCheckpoint
      ),
      certify: !state.minting && adapterReady && state.walletConnected && (
        ['uploaded', 'certify-pending'].includes(state.ocUploadStage)
        || canRetryCertifyCheckpoint
      ),
      publish: !state.minting && adapterReady && state.walletConnected && state.ocUploadStage === 'certified',
    },
  });
}

async function renderOcImageBlob(recipeOverride = null) {
  if (isMakerV4Document(state.makerDocumentV4) && makerWorkspace?.renderRecipeToBlob) {
    const recipe = recipeOverride || state.playerRecipeV4 || state.makerRecipeV4 || state.makerDocumentV4.defaultRecipe;
    return makerWorkspace.renderRecipeToBlob(recipe);
  }
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
  if (loadedMakerUploadRecoveries.has(recoveryKey) || (makerIsPublished() && !makerHasPendingV4Version())) return;
  const requestId = ++makerUploadRestoreRequestId;
  const requestToken = Symbol(recoveryKey);
  makerUploadRestoreRequests.set(recoveryKey, requestToken);
  const ownsRequest = () => makerUploadRestoreRequests.get(recoveryKey) === requestToken;
  const isCurrentRequest = () => (
    ownsRequest()
    &&
    requestId === makerUploadRestoreRequestId
    && state.templateId === templateId
    && makerAssetStorageKey(templateId) === recoveryKey
  );
  clearMakerPublishError();
  loadedMakerUploadRecoveries.add(recoveryKey);
  try {
    const recovery = await loadMakerUploadRecovery(recoveryKey);
    if (!isCurrentRequest()) return;
    state.hasMakerUploadRecovery = Boolean(recovery);
    if (!recovery) return;
    syncCreatorAssets();
    if (JSON.stringify(creatorUploadManifest()) !== recovery.manifestJson) {
      throw uploadRecoveryMismatch(t('makerRecoveryDraftChanged'));
    }
    if (!recovery.coverBlob) throw new Error(t('makerRecoveryCoverMissing'));
    let pendingBundle = null;
    let pendingAssets;
    if (isMakerV4Document(state.makerDocumentV4)) {
      const documentV4 = makerV4DocumentForRelease({ includeGeneratedCover: true });
      const projection = compileMakerV4MoveProjectionV2(documentV4);
      assertMakerV4ProjectionV2SinglePublishBudget(projection);
      const runtimeAssets = await makerV4RuntimeAssetsForRelease(documentV4, recovery.coverBlob);
      if (!isCurrentRequest()) return;
      pendingBundle = buildMakerV4PublicationBundle(documentV4, runtimeAssets, {
        previousDocument: isMakerV4Document(state.publishedMakerDocumentV4) ? state.publishedMakerDocumentV4 : null,
        publicExtensions: makerV4PublicExtensions(documentV4),
        projectionAuxiliaryBlob: makerProjectionAuxiliaryPngBlob(),
      });
      if (pendingBundle.manifestJson !== recovery.manifestJson) {
        throw uploadRecoveryMismatch(t('makerRecoveryGraphMismatch'));
      }
      pendingAssets = pendingBundle.assetEntries.map((entry) => ({
        assetId: entry.assetId,
        file: entry.blob,
        blob: entry.blob,
        name: entry.identifier,
        size: entry.blob?.size || 0,
        type: entry.blob?.type || 'application/octet-stream',
        kind: entry.kind,
        identifier: entry.identifier,
        projectionOnly: entry.projectionOnly === true,
        renderAsset: entry.renderAsset !== false,
        patchId: '',
        blobId: '',
      }));
    } else {
      pendingAssets = [...publishableAssets(), makerCoverAsset(recovery.coverBlob)];
    }
    pendingAssets.forEach((asset) => {
      if (!asset.file) throw new Error(t('makerRecoveryAssetMissing', { name: asset.name }));
    });
    const uploadEntries = pendingBundle?.entries?.length
      ? pendingBundle.entries
      : [
        ...pendingAssets.map((asset) => ({ blob: asset.file, identifier: asset.identifier, kind: asset.kind })),
        {
          blob: new Blob([recovery.manifestJson], { type: 'application/json' }),
          identifier: 'animacraft-manifest.json',
          kind: 'maker-manifest',
        },
      ];
    const uploadSession = await resumeWalrusUpload(uploadEntries, recovery);
    if (!isCurrentRequest()) return;
    uploadSession.recoverySavedAt = Number(recovery.savedAt || 0);
    const uploadStage = uploadSession.stage;
    if (uploadStage === 'certified') {
      if (uploadSession.files.length !== pendingAssets.length + 1) {
        throw new Error(t('makerRecoveryCertifiedMismatch'));
      }
      pendingAssets.forEach((asset, index) => {
        asset.patchId = uploadSession.files[index].id;
        asset.blobId = uploadSession.files[index].blobId;
      });
    }
    state.pendingMakerCoverBlob = recovery.coverBlob;
    state.pendingMakerV4Bundle = pendingBundle;
    state.pendingMakerAssets = pendingAssets;
    state.pendingMakerManifestJson = recovery.manifestJson;
    state.makerPublicationIntent = normalizedMakerPublicationIntent(recovery.publicationIntent);
    state.makerUploadSession = uploadSession;
    state.makerUploadStage = uploadStage;
    state.makerQuiltId = recovery.quiltBlobId || uploadSession.quiltBlobId;
    const certificationStateSyncing = uploadStage === 'uploaded' && Boolean(uploadSession.certifyDigest);
    if (certificationStateSyncing) {
      state.makerPublishError = restoredCertificationVisibilityError(uploadSession.certifyDigest);
      state.publishStatus = t('certificationSyncing');
    } else {
      state.publishStatus = {
        encoded: t('makerRecoveryEncoded'),
        registered: t('makerRecoveryRegistered'),
        uploaded: t('makerRecoveryUploaded'),
        certified: t('makerRecoveryCertified'),
      }[uploadStage] || t('makerRecoveryRestored');
    }
    if (state.makerPublicationIntent && isCurrentRequest()) {
      try {
        await recoverMakerPublicationIntent({
          scheduleRetry: true,
          guard: isCurrentRequest,
        });
      } catch (error) {
        if (isCurrentRequest()) {
          recordMakerPublishError(error, 'review', 'publicationSubmittedRecovering');
        }
      }
    }
  } catch (error) {
    if (!isCurrentRequest()) return;
    state.makerUploadSession = null;
    state.pendingMakerAssets = [];
    state.pendingMakerCoverBlob = null;
    state.pendingMakerManifestJson = '';
    state.pendingMakerV4Bundle = null;
    state.makerUploadStage = 'idle';
    recordMakerPublishError(error, 'resume', 'makerRecoveryFailed');
  } finally {
    const current = isCurrentRequest();
    if (ownsRequest()) {
      makerUploadRestoreRequests.delete(recoveryKey);
      if (!current) loadedMakerUploadRecoveries.delete(recoveryKey);
    }
    if (current) renderAll();
  }
}

async function restoreOcUploadRecovery(templateId = state.templateId, { force = false } = {}) {
  if (!state.walletConnected || activeTemplate()?.source !== 'chain' || !activeMakerObjectId() || state.templateId !== templateId) return;
  const recoveryKey = ocUploadStorageKey(templateId);
  if (force) loadedOcUploadRecoveries.delete(recoveryKey);
  if (loadedOcUploadRecoveries.has(recoveryKey) || state.mintDigest) return;
  const requestId = ++ocUploadRestoreRequestId;
  const requestToken = Symbol(recoveryKey);
  ocUploadRestoreRequests.set(recoveryKey, requestToken);
  const ownsRequest = () => ocUploadRestoreRequests.get(recoveryKey) === requestToken;
  const isCurrentRequest = () => (
    ownsRequest()
    &&
    requestId === ocUploadRestoreRequestId
    && state.templateId === templateId
    && ocUploadStorageKey(templateId) === recoveryKey
  );
  clearOcPublishError();
  loadedOcUploadRecoveries.add(recoveryKey);
  try {
    const recovery = await loadMakerUploadRecovery(recoveryKey);
    if (!isCurrentRequest()) return;
    state.hasOcUploadRecovery = Boolean(recovery);
    if (!recovery || recovery.kind !== 'oc-mint') return;
    if (ocFingerprint(recovery.ocPackage) !== recovery.fingerprint) {
      throw uploadRecoveryMismatch(t('ocRecoveryMismatch'));
    }
    const recipeHash = recovery.recipeHash instanceof Uint8Array
      ? recovery.recipeHash
      : new Uint8Array(recovery.recipeHash || []);
    const uploadSession = await resumeWalrusUpload([
      { blob: recovery.imageBlob, identifier: 'animacraft-oc.png', kind: 'oc-image' },
      { blob: recovery.profileBlob, identifier: 'animacraft-oc.json', kind: 'oc-profile' },
    ], recovery);
    if (!isCurrentRequest()) return;
    uploadSession.recoverySavedAt = Number(recovery.savedAt || 0);
    const uploadStage = uploadSession.stage;
    let imagePatchId = '';
    let profilePatchId = '';
    if (uploadStage === 'certified') {
      if (uploadSession.files.length !== 2) throw new Error(t('ocRecoveryCertifiedMismatch'));
      imagePatchId = uploadSession.files[0].id;
      profilePatchId = uploadSession.files[1].id;
    }
    state.pendingOcImageBlob = recovery.imageBlob;
    state.pendingOcProfileBlob = recovery.profileBlob;
    state.pendingOcPackage = recovery.ocPackage;
    state.pendingOcRecipeHash = recipeHash;
    state.pendingOcRecipeJson = recovery.recipeJson;
    state.pendingOcFingerprint = recovery.fingerprint;
    state.ocUploadSession = uploadSession;
    state.ocUploadStage = uploadStage;
    state.ocImagePatchId = imagePatchId;
    state.ocProfilePatchId = profilePatchId;
    const certificationStateSyncing = uploadStage === 'uploaded' && Boolean(uploadSession.certifyDigest);
    if (certificationStateSyncing) {
      state.ocPublishError = restoredCertificationVisibilityError(uploadSession.certifyDigest);
      state.mintStatus = t('ocCertificationSyncing');
    } else {
      state.mintStatus = {
        encoded: t('ocRecoveryEncoded'),
        registered: t('ocRecoveryRegistered'),
        uploaded: t('ocRecoveryUploaded'),
        certified: t('ocRecoveryCertified'),
      }[uploadStage] || t('ocRecoveryRestored');
    }
  } catch (error) {
    if (!isCurrentRequest()) return;
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
    recordOcPublishError(error, 'resume', 'ocRecoveryFailed');
  } finally {
    const current = isCurrentRequest();
    if (ownsRequest()) {
      ocUploadRestoreRequests.delete(recoveryKey);
      if (!current) loadedOcUploadRecoveries.delete(recoveryKey);
    }
    if (current) renderAll();
  }
}

async function resumeMakerUploadRecovery() {
  if (state.publishing) return;
  const operation = beginMakerChainOperation();
  clearMakerPublishError();
  state.publishing = true;
  state.makerReleaseInFlight = true;
  state.publishStatus = t('restoringUpload');
  renderAll();
  try {
    await restoreMakerUploadRecovery(operation.templateId, { force: true });
  } finally {
    if (makerChainOperationIsActive(operation)) {
      state.publishing = false;
      state.makerReleaseInFlight = false;
      renderAll();
    }
  }
}

async function resumeOcUploadRecovery() {
  if (state.minting) return;
  const operation = beginOcChainOperation();
  clearOcPublishError();
  state.minting = true;
  state.mintStatus = t('restoringOcUpload');
  renderAll();
  try {
    await restoreOcUploadRecovery(operation.templateId, { force: true });
  } finally {
    if (ocChainOperationIsActive(operation)) {
      state.minting = false;
      renderAll();
    }
  }
}

function renderImageMakerList() {
  const creatorTemplates = templates.filter((template) =>
    (template.source === 'local' && template.owner === state.walletAddress)
    || (template.source === 'chain' && template.owned)
    || (localUiTest && template.source === 'creator-pack' && makerModels.has(template.id)));
  $('imageMakerList').innerHTML = `
    ${creatorTemplates.length ? creatorTemplates.map((template) => {
      const model = makerModels.get(template.id);
      const lifecycle = makerLifecycleDescriptor(template);
      const published = lifecycle.published;
      const lifecycleLabel = t(lifecycle.labelKey);
      const canvasLabel = model?.canvas?.width === model?.canvas?.height ? '1:1' : '9:16';
      return `
        <article class="creator-maker-card ${template.id === state.templateId ? 'active' : ''}" data-maker="${escapeHtml(template.id)}" style="--accent:${safeCssColor(template.accent)}; --secondary:${safeCssColor(template.secondary, '#f0a23a')};">
          <div class="maker-cover-mini">
            ${template.coverUrl ? `<img src="${escapeHtml(template.coverUrl)}" alt="${escapeHtml(t('makerCoverAlt', { name: template.name }))}" />` : '<span class="mini-face"></span>'}
          </div>
          <div class="maker-card-body">
            <div class="maker-tags">
              <span class="maker-card-lifecycle ${escapeHtml(lifecycle.badgeClass)}">${escapeHtml(lifecycleLabel)}</span>
              <span>${canvasLabel}</span>
              <span>${t('freeCombine')}</span>
            </div>
            <h2>${escapeHtml(template.name)}</h2>
            <p>${escapeHtml(template.summary)}</p>
          </div>
          <div class="maker-card-actions">
            <button class="secondary" data-preview-maker="${escapeHtml(template.id)}">${t('preview')}</button>
            ${template.source === 'local' && !published ? `<button class="icon-button danger-icon" data-delete-maker="${escapeHtml(template.id)}" title="${t('deleteDraft')}" aria-label="${t('deleteDraft')}: ${escapeHtml(template.name)}">×</button>` : ''}
            <button class="secondary" data-manage-lifecycle="${escapeHtml(template.id)}">${t('makerLifecycleManage')}</button>
            <button class="primary" data-edit-maker="${escapeHtml(template.id)}">${t('edit')}</button>
          </div>
        </article>
      `;
    }).join('') : `<div class="empty-state">${t('noOwnedMakers')}</div>`}
  `;

  document.querySelectorAll('[data-preview-maker], [data-open-maker]').forEach((button) => {
    button.addEventListener('click', () => {
      activateMakerModel(button.dataset.previewMaker || button.dataset.openMaker);
      syncTemplateFields();
      state.previewingMaker = true;
      setPage('make');
      renderAll();
    });
  });

  document.querySelectorAll('[data-edit-maker]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.editMaker) activateMakerModel(button.dataset.editMaker);
      syncTemplateFields();
      state.editorPanel = 'parts';
      setCreatorView('edit');
      renderAll();
      loadActiveTreasuryBalance();
      focusCreatorTop();
    });
  });

  document.querySelectorAll('[data-delete-maker]').forEach((button) => {
    button.addEventListener('click', () => requestDeleteMaker(button.dataset.deleteMaker));
  });

  document.querySelectorAll('[data-manage-lifecycle]').forEach((button) => {
    button.addEventListener('click', () => openMakerLifecycleManager(button.dataset.manageLifecycle));
  });
}

function requestDeleteMaker(templateId = state.templateId) {
  const template = templates.find((candidate) => candidate.id === templateId);
  const model = makerModels.get(templateId);
  if (!template || template.source !== 'local' || model?.publishDigest || model?.makerObjectId) return;
  const owner = String(template.owner || state.walletAddress || '');
  const workspaceKey = `${owner || 'wallet'}:${templateId}`;
  const draftStorageKey = makerDraftStorageKey(templateId, owner);
  const assetStorageKey = makerAssetStorageKey(templateId, owner);
  openConfirmation({
    title: t('deleteLocalDraftTitle'),
    message: t('deleteLocalDraftCopy', { name: template.name }),
    confirmLabel: t('deleteLocalDraft'),
    action: async () => {
      const currentTemplate = templates.find((candidate) => candidate.id === templateId);
      const currentModel = makerModels.get(templateId);
      if (
        !currentTemplate
        || currentTemplate.source !== 'local'
        || String(currentTemplate.owner || '') !== owner
        || currentModel?.publishDigest
        || currentModel?.makerObjectId
      ) return;
      const wasActive = state.templateId === templateId;
      await makerWorkspace?.deleteDraftProject?.(workspaceKey);
      revokeMakerObjectUrls(currentModel);
      localMakerCoverRestoreTokens.delete(templateId);
      revokeLocalMakerCoverObjectUrl(templateId);
      localStorage.removeItem(draftStorageKey);
      loadedMakerDrafts.delete(draftStorageKey);
      loadedMakerAssetDrafts.delete(assetStorageKey);
      await deleteMakerDraftRecord(draftStorageKey);
      await deleteMakerAssets(assetStorageKey);
      await clearMakerUploadRecovery(templateId, owner);
      makerModels.delete(templateId);
      const templateIndex = templates.findIndex((candidate) => candidate.id === templateId);
      if (templateIndex >= 0) templates.splice(templateIndex, 1);
      persistLocalMakerIndex(owner);
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
  const lifecycle = makerLifecycleDescriptor();
  const releaseLocked = ['publishing', 'recoverable'].includes(lifecycle.id);
  const locked = releaseLocked || (lifecycle.published && !lifecycle.versionDraft);
  const chainManageable = !releaseLocked
    && lifecycle.published
    && Boolean(state.makerObjectId);
  const economicsManageable = chainManageable && !lifecycle.versionDraft;
  const title = t(lifecycle.labelKey);
  const copy = lifecycle.lineageFork
    ? makerVersionLineageForkMessage(lifecycle.lineageFork)
    : lifecycle.versionConflict
      ? makerVersionDraftConflictMessage(lifecycle.versionConflict)
      : t(lifecycle.copyKey, lifecycle.copyVariables);
  if ($('makerLifecycleBadge')) {
    $('makerLifecycleBadge').textContent = title;
    $('makerLifecycleBadge').className = `maker-lifecycle-badge ${lifecycle.badgeClass}`;
  }
  if ($('makerLifecycleTitle')) $('makerLifecycleTitle').textContent = title;
  if ($('makerLifecycleCopy')) $('makerLifecycleCopy').textContent = copy;
  if ($('deleteMakerDraft')) {
    $('deleteMakerDraft').hidden = lifecycle.id !== 'draft';
    $('deleteMakerDraft').disabled = lifecycle.id !== 'draft';
  }
  if ($('makerRetirementNotice')) $('makerRetirementNotice').hidden = !chainManageable;
  if ($('makerLifecycleAction')) $('makerLifecycleAction').hidden = !chainManageable;
  if ($('makerLifecycleActionTitle')) $('makerLifecycleActionTitle').textContent = title;
  if ($('makerLifecycleActionCopy')) $('makerLifecycleActionCopy').textContent = state.publishStatus || copy;
  if ($('archiveMakerOnchain')) {
    $('archiveMakerOnchain').textContent = lifecycle.archived ? t('restoreMaker') : t('archiveMaker');
    $('archiveMakerOnchain').className = lifecycle.archived ? 'secondary' : 'danger-button';
    $('archiveMakerOnchain').disabled = !chainManageable
      || !state.makerAdminCapObjectId
      || !state.walletConnected
      || state.publishing
      || state.makerLifecycleActionBusy;
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
  if ($('updateMakerEconomics')) $('updateMakerEconomics').disabled = !economicsManageable
    || !state.makerAdminCapObjectId
    || !state.walletConnected
    || state.publishing
    || state.makerLifecycleActionBusy;
  if ($('withdrawMakerRevenue')) $('withdrawMakerRevenue').disabled = !chainManageable
    || !state.makerAdminCapObjectId
    || !state.makerTreasuryObjectId
    || !state.walletConnected
    || state.publishing
    || state.makerLifecycleActionBusy;
  if ($('makerTreasuryBalance')) {
    const template = activeTemplate();
    $('makerTreasuryBalance').textContent = locked && state.makerTreasuryObjectId
      ? template.treasuryBalanceError || t('treasuryBalance', { amount: atomicCoinToDecimal(template.treasuryBalanceAtomic || 0), symbol: runtimeConfig.paymentCoinSymbol })
      : t('treasuryAfterPublication');
  }
  if ($('saveMakerDraft')) {
    const saveLabels = {
      idle: t('saveDraft'),
      dirty: t('saveDraft'),
      saving: t('savingLocally'),
      saved: t('savedLocally'),
      error: t('retryLocalSave'),
    };
    $('saveMakerDraft').textContent = saveLabels[state.draftSaveStatus] || t('saveDraft');
    $('saveMakerDraft').title = state.draftSaveMessage || t('saveBrowserTitle');
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
  renderMakerLifecycleManager();
}

function lifecycleFact(label, value) {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || '—')}</dd></div>`;
}

function lifecycleActionButton(action, label, copy, {
  tone = '',
  disabled = false,
} = {}) {
  const unavailable = disabled ? ` title="${escapeHtml(t('makerLifecycleActionUnavailable'))}"` : '';
  const toneAttribute = tone ? ` data-tone="${escapeHtml(tone)}"` : '';
  return `
    <button class="maker-lifecycle-manager-action" type="button" data-lifecycle-action="${escapeHtml(action)}"${toneAttribute} ${disabled ? 'disabled aria-disabled="true"' : ''}${unavailable}>
      <strong>${escapeHtml(label)}</strong>
      <small>${escapeHtml(copy)}</small>
    </button>
  `;
}

function makerLifecycleVersionTargetLabel(version) {
  return [
    `${t('makerLifecycleVersion')} ${version?.versionId || '—'}`,
    `${t('makerLifecycleObject')} ${shortAddress(version?.makerObjectId || '') || '—'}`,
  ].join(' · ');
}

function makerLifecycleVersionActionLabel(actionLabel, version) {
  return `${actionLabel} · ${makerLifecycleVersionTargetLabel(version)}`;
}

function renderMakerLifecycleManager() {
  const modal = $('makerLifecycleManagerModal');
  if (!modal) return;
  const focusedElement = document.activeElement;
  const modalWasActive = modal.classList.contains('active');
  const focusedInsideModal = modalWasActive && modal.contains(focusedElement);
  const focusedLifecycleAction = focusedInsideModal
    ? focusedElement?.closest?.('[data-lifecycle-action]')?.dataset?.lifecycleAction || ''
    : '';
  const template = activeTemplate();
  const lifecycle = makerLifecycleDescriptor(template);
  const workingDocument = isMakerV4Document(state.makerDocumentV4) ? state.makerDocumentV4 : null;
  const publishedDocument = isMakerV4Document(state.publishedMakerDocumentV4)
    ? state.publishedMakerDocumentV4
    : null;
  const title = t(lifecycle.labelKey);
  const actionCopyKey = {
    draft: 'makerLifecycleDraftActionCopy',
    starter: 'makerLifecycleDraftActionCopy',
    publishing: 'makerLifecyclePublishingActionCopy',
    recoverable: 'makerLifecycleRecoverableActionCopy',
    active: 'makerLifecycleActiveActionCopy',
    paused: 'makerLifecyclePausedActionCopy',
    archived: 'makerLifecycleArchivedActionCopy',
    'version-draft': 'makerLifecycleVersionDraftActionCopy',
  }[lifecycle.id];
  const actionCopy = lifecycle.lineageFork
    ? makerVersionLineageForkMessage(lifecycle.lineageFork)
    : lifecycle.versionConflict
      ? makerVersionDraftConflictMessage(lifecycle.versionConflict, workingDocument)
      : t(actionCopyKey);
  const publishedObjectId = state.makerObjectId || template?.objectId || '';
  const hasAuthority = Boolean(
    state.walletConnected
    && state.makerAdminCapObjectId
    && publishedObjectId,
  );
  const releaseLocked = ['publishing', 'recoverable'].includes(lifecycle.id);
  const operationBusy = state.publishing || state.makerLifecycleActionBusy;
  const chainActionDisabled = operationBusy || releaseLocked || !hasAuthority;
  const pausedEconomics = lifecycle.mintingEnabled
    ? null
    : activePausedEconomicsSnapshot();

  if ($('makerLifecycleManagerTitle')) $('makerLifecycleManagerTitle').textContent = t('makerLifecycleManagerTitle');
  if ($('makerLifecycleManagerCopy')) $('makerLifecycleManagerCopy').textContent = t('makerLifecycleManagerCopy');
  if ($('makerLifecycleManagerBadge')) {
    $('makerLifecycleManagerBadge').textContent = title;
    $('makerLifecycleManagerBadge').className = `maker-lifecycle-manager-badge ${lifecycle.badgeClass}`;
    $('makerLifecycleManagerBadge').dataset.state = lifecycle.id;
  }
  if ($('makerLifecycleManagerName')) $('makerLifecycleManagerName').textContent = template?.name || 'Maker';
  if ($('makerLifecycleManagerScope')) {
    $('makerLifecycleManagerScope').textContent = lifecycle.published
      ? `${t('makerLifecycleLocalScope')} + ${t('makerLifecycleChainScope')}`
      : t('makerLifecycleLocalScope');
  }
  if ($('makerLifecycleManagerFacts')) {
    $('makerLifecycleManagerFacts').innerHTML = [
      lifecycleFact(t('lifecycle'), title),
      lifecycleFact(
        t('makerLifecycleAuthority'),
        lifecycle.published
          ? hasAuthority ? t('makerLifecycleAuthorityReady') : t('makerLifecycleAuthorityUnavailable')
          : t('makerLifecycleLocalScope'),
      ),
      lifecycleFact(t('makerLifecycleVersion'), workingDocument?.version?.versionId || '—'),
      lifecycleFact(t('makerLifecycleObject'), publishedObjectId ? shortAddress(publishedObjectId) : '—'),
    ].join('');
  }

  if ($('lifecycleWorkingVersionCard')) {
    $('lifecycleWorkingVersionCard').innerHTML = `
      <h3>${escapeHtml(t('makerLifecycleWorkingVersion'))}</h3>
      <p>${escapeHtml(actionCopy)}</p>
      <dl>
        <div><dt>${escapeHtml(t('makerLifecycleVersion'))}</dt><dd>${escapeHtml(workingDocument?.version?.versionId || '—')}</dd></div>
        <div><dt>${escapeHtml(t('makerLifecycleLocalScope'))}</dt><dd>${escapeHtml(lifecycle.versionDraft ? t('makerLifecycleVersionDraft') : title)}</dd></div>
      </dl>
    `;
  }
  if ($('lifecyclePublishedVersionCard')) {
    if (lifecycle.published) {
      const objectValue = publishedObjectId
        ? `<a href="${escapeHtml(explorerObjectUrl(publishedObjectId))}" target="_blank" rel="noreferrer">${escapeHtml(shortAddress(publishedObjectId))}</a>`
        : '—';
      $('lifecyclePublishedVersionCard').innerHTML = `
        <h3>${escapeHtml(t('makerLifecyclePublishedVersion'))}</h3>
        <p>${escapeHtml(t('makerLifecycleChainVersionImmutable'))} ${escapeHtml(t('makerLifecycleExistingOcSafe'))}</p>
        <dl>
          <div><dt>${escapeHtml(t('makerLifecycleVersion'))}</dt><dd>${escapeHtml(publishedDocument?.version?.versionId || workingDocument?.version?.versionId || '—')}</dd></div>
          <div><dt>${escapeHtml(t('makerLifecycleObject'))}</dt><dd>${objectValue}</dd></div>
          <div><dt>${escapeHtml(t('makerLifecycleAuthority'))}</dt><dd>${escapeHtml(hasAuthority ? t('makerLifecycleAuthorityReady') : t('makerLifecycleNoAuthority'))}</dd></div>
        </dl>
      `;
    } else {
      $('lifecyclePublishedVersionCard').innerHTML = `
        <h3>${escapeHtml(t('makerLifecyclePublishedVersion'))}</h3>
        <p>${escapeHtml(t('makerLifecycleNoPublishedVersion'))}</p>
      `;
    }
  }
  if ($('makerLifecycleVersionHistory')) {
    const versions = lifecycle.published
      ? publishedMakerVersionHistory(template)
      : [];
    $('makerLifecycleVersionHistory').innerHTML = versions.length
      ? versions.map((version) => {
          const versionState = version.archived
            ? 'archived'
            : version.mintingEnabled
              ? 'active'
              : 'paused';
          const versionStateLabel = t({
            active: 'makerLifecycleActive',
            paused: 'makerLifecyclePaused',
            archived: 'makerLifecycleArchived',
          }[versionState]);
          const authorityReady = Boolean(
            state.walletConnected
            && version.makerAdminCapObjectId,
          );
          const canAttemptAuthority = Boolean(
            state.walletConnected
            && template?.owned,
          );
          const disabled = operationBusy || releaseLocked || !canAttemptAuthority;
          const target = escapeHtml(version.makerObjectId);
          const resumeWithoutSnapshot = !version.mintingEnabled
            && !version.pausedEconomics;
          const restoreLabel = t('makerLifecycleActionRestore');
          const pauseOrResumeLabel = t(
            version.mintingEnabled
              ? 'makerLifecycleActionPause'
              : resumeWithoutSnapshot
                ? 'makerLifecycleActionResumeFree'
                : 'makerLifecycleActionResume',
          );
          const archiveLabel = t('makerLifecycleActionArchive');
          const buttons = version.archived
            ? `
                <button type="button" data-lifecycle-action="history-restore:${target}" aria-label="${escapeHtml(makerLifecycleVersionActionLabel(restoreLabel, version))}" ${disabled ? 'disabled aria-disabled="true"' : ''}>
                  ${escapeHtml(restoreLabel)}
                </button>
              `
            : `
                <button type="button" data-lifecycle-action="${version.mintingEnabled ? 'history-pause' : 'history-resume'}:${target}" aria-label="${escapeHtml(makerLifecycleVersionActionLabel(pauseOrResumeLabel, version))}" ${disabled ? 'disabled aria-disabled="true"' : ''}>
                  ${escapeHtml(pauseOrResumeLabel)}
                </button>
                <button class="danger" type="button" data-lifecycle-action="history-archive:${target}" aria-label="${escapeHtml(makerLifecycleVersionActionLabel(archiveLabel, version))}" ${disabled ? 'disabled aria-disabled="true"' : ''}>
                  ${escapeHtml(archiveLabel)}
                </button>
              `;
          return `
            <article class="maker-lifecycle-version-history-item ${version.current ? 'is-current' : ''}" data-maker-version-object="${target}">
              <div class="maker-lifecycle-version-history-identity">
                <strong>${escapeHtml(version.versionId)}</strong>
                <small>${escapeHtml(shortAddress(version.makerObjectId))}</small>
              </div>
              <div class="maker-lifecycle-version-history-meta">
                <span>${escapeHtml(t(version.current ? 'makerLifecycleVersionCurrent' : 'makerLifecycleVersionPrevious'))}</span>
                <span class="is-${escapeHtml(versionState)}">${escapeHtml(versionStateLabel)}</span>
                <span>${escapeHtml(
                  authorityReady
                    ? t('makerLifecycleAuthorityReady')
                    : t('makerLifecycleVersionHistoryNoAuthority'),
                )}</span>
              </div>
              <div class="maker-lifecycle-version-history-actions">
                <a href="${escapeHtml(explorerObjectUrl(version.makerObjectId))}" target="_blank" rel="noreferrer">${escapeHtml(t('viewSuiMaker'))}</a>
                ${buttons}
              </div>
            </article>
          `;
        }).join('')
      : `<div class="maker-lifecycle-version-history-empty">${escapeHtml(t('makerLifecycleVersionHistoryEmpty'))}</div>`;
  }

  const actions = [];
  if (['publishing', 'recoverable'].includes(lifecycle.id)) {
    actions.push(lifecycleActionButton(
      'open-release',
      t('makerLifecycleActionRelease'),
      t(lifecycle.id === 'publishing' ? 'makerLifecyclePublishingActionCopy' : 'makerLifecycleRecoverableActionCopy'),
      { tone: 'primary' },
    ));
  }
  if (
    lifecycle.published
    && !lifecycle.versionDraft
    && !releaseLocked
    && workingDocument
  ) {
    actions.push(lifecycleActionButton(
      'start-version',
      t('makerLifecycleActionStartVersion'),
      lifecycle.lineageFork
        ? makerVersionLineageForkMessage(lifecycle.lineageFork)
        : t('makerLifecycleStartVersionCopy'),
      {
        tone: 'primary',
        disabled: operationBusy || Boolean(lifecycle.lineageFork),
      },
    ));
  }
  if (lifecycle.versionDraft) {
    actions.push(lifecycleActionButton(
      'open-release',
      t('makerLifecycleActionPublishVersion'),
      lifecycle.lineageFork
        ? makerVersionLineageForkMessage(lifecycle.lineageFork)
        : lifecycle.versionConflict
          ? makerVersionDraftConflictMessage(lifecycle.versionConflict, workingDocument)
          : t('makerLifecycleVersionWarning'),
      {
        tone: 'primary',
        disabled: operationBusy
          || Boolean(lifecycle.versionConflict)
          || Boolean(lifecycle.lineageFork),
      },
    ));
    actions.push(lifecycleActionButton(
      'discard-version',
      t('makerLifecycleActionDiscardVersion'),
      t('makerLifecycleDiscardVersionCopy'),
      { tone: 'danger', disabled: operationBusy },
    ));
  }
  if (lifecycle.published) {
    if (lifecycle.archived) {
      actions.push(lifecycleActionButton(
        'restore-chain',
        t('makerLifecycleActionRestore'),
        t('archivedLifecycleCopy'),
        { disabled: chainActionDisabled },
      ));
    } else {
      const resumingWithoutSnapshot = !lifecycle.mintingEnabled && !pausedEconomics;
      actions.push(lifecycleActionButton(
        lifecycle.mintingEnabled ? 'pause-authorizations' : 'resume-authorizations',
        t(
          lifecycle.mintingEnabled
            ? 'makerLifecycleActionPause'
            : resumingWithoutSnapshot
              ? 'makerLifecycleActionResumeFree'
              : 'makerLifecycleActionResume',
        ),
        t(
          lifecycle.mintingEnabled
            ? 'makerLifecyclePauseCopy'
            : resumingWithoutSnapshot
              ? 'makerLifecycleResumeFreeCopy'
              : 'makerLifecycleResumeCopy',
        ),
        { disabled: chainActionDisabled },
      ));
      actions.push(lifecycleActionButton(
        'archive-chain',
        t('makerLifecycleActionArchive'),
        t('archiveMakerCopy'),
        { tone: 'danger', disabled: chainActionDisabled },
      ));
    }
  } else if (template?.source === 'local') {
    actions.push(lifecycleActionButton(
      'delete-draft',
      t('makerLifecycleActionDeleteDraft'),
      t('deleteLocalDraftCopy', { name: template.name }),
      { tone: 'danger', disabled: operationBusy },
    ));
  }
  if ($('makerLifecycleManagerActions')) $('makerLifecycleManagerActions').innerHTML = actions.join('');
  const footerEditorAction = modal.querySelector('.maker-lifecycle-manager-footer [data-lifecycle-action="open-editor"]');
  if (footerEditorAction) {
    footerEditorAction.disabled = operationBusy || releaseLocked;
    footerEditorAction.setAttribute('aria-disabled', String(footerEditorAction.disabled));
    footerEditorAction.textContent = t(
      releaseLocked
        ? 'makerLifecycleManagerOpenEditor'
        : lifecycle.published && !lifecycle.versionDraft
          ? 'makerLifecycleManagerInspectEditor'
          : 'makerLifecycleActionContinue',
    );
  }

  if ($('makerLifecyclePermanentRetirement')) {
    $('makerLifecyclePermanentRetirement').hidden = !lifecycle.published;
  }
  if ($('makerLifecycleManagerNotice')) {
    const notice = lifecycle.lineageFork
      ? makerVersionLineageForkMessage(lifecycle.lineageFork)
      : lifecycle.versionDraft
        ? t('makerLifecycleVersionWarning')
        : lifecycle.published && !hasAuthority
          ? t('makerLifecycleNoAuthority')
          : '';
    $('makerLifecycleManagerNotice').hidden = !notice;
    $('makerLifecycleManagerNotice').textContent = notice;
  }
  if ($('makerLifecycleManagerStatus')) {
    $('makerLifecycleManagerStatus').textContent = state.publishStatus || t('makerLifecycleStatusReady');
  }
  if (
    focusedInsideModal
    && !$('confirmActionModal')?.classList.contains('active')
    && !modal.contains(document.activeElement)
  ) {
    const replacement = focusedLifecycleAction
      ? Array.from(modal.querySelectorAll('[data-lifecycle-action]')).find((button) => (
          button.dataset.lifecycleAction === focusedLifecycleAction
          && !button.disabled
        ))
      : null;
    (replacement || $('makerLifecycleManagerStatus') || modal.querySelector('[data-close-maker-lifecycle]'))
      ?.focus({ preventScroll: true });
  }
}

function openMakerLifecycleManager(templateId = state.templateId) {
  const requestedTemplateId = String(templateId || state.templateId);
  if (requestedTemplateId !== state.templateId && !activateMakerModel(requestedTemplateId)) return;
  syncTemplateFields();
  const requestId = ++makerLifecycleManagerSyncRequestId;
  const requestedWallet = state.walletAddress;
  makerLifecycleManagerReturnFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  renderMakerLifecycleManager();
  $('makerLifecycleManagerModal')?.classList.add('active');
  if ($('makerLifecycleManagerModal')) {
    $('makerLifecycleManagerModal').inert = false;
    $('makerLifecycleManagerModal').removeAttribute('inert');
  }
  $('makerLifecycleManagerModal')?.setAttribute('aria-hidden', 'false');
  $('makerLifecycleManagerDialog')?.setAttribute('aria-modal', 'true');
  $('makerLifecycleManagerModal')
    ?.querySelector('[data-close-maker-lifecycle]')
    ?.focus();
  void syncMakerWorkspaceContext().catch((error) => {
    if (
      requestId !== makerLifecycleManagerSyncRequestId
      || requestedTemplateId !== state.templateId
      || requestedWallet !== state.walletAddress
      || !$('makerLifecycleManagerModal')?.classList.contains('active')
    ) return;
    state.publishStatusI18n = null;
    state.publishStatus = state.locale === 'en' && error?.message
      ? error.message
      : t('makerWorkspaceRestoreFailed');
    renderMakerLifecycleManager();
  });
  void loadActiveTreasuryBalance();
}

function closeMakerLifecycleManager({ restoreFocus = true } = {}) {
  makerLifecycleManagerSyncRequestId += 1;
  $('makerLifecycleManagerModal')?.classList.remove('active');
  if ($('makerLifecycleManagerModal')) {
    $('makerLifecycleManagerModal').inert = false;
    $('makerLifecycleManagerModal').removeAttribute('inert');
  }
  $('makerLifecycleManagerModal')?.setAttribute('aria-hidden', 'true');
  $('makerLifecycleManagerDialog')?.setAttribute('aria-modal', 'true');
  if (restoreFocus && makerLifecycleManagerReturnFocus?.isConnected) {
    makerLifecycleManagerReturnFocus.focus();
  } else if (restoreFocus) {
    const replacement = Array.from(document.querySelectorAll('[data-manage-lifecycle]'))
      .find((button) => (
        button.dataset.manageLifecycle === state.templateId
        && button.offsetParent !== null
      ))
      || Array.from(document.querySelectorAll('[data-action="manage-lifecycle"]'))
        .find((button) => button.offsetParent !== null);
    replacement?.focus();
  }
  makerLifecycleManagerReturnFocus = null;
}

function openMakerEditorFromLifecycle() {
  closeMakerLifecycleManager({ restoreFocus: false });
  state.editorPanel = 'parts';
  setCreatorView('edit');
  renderAll();
  void loadActiveTreasuryBalance();
  focusCreatorTop();
}

async function openMakerReleaseFromLifecycle() {
  const operation = captureMakerWorkspaceOperation();
  closeMakerLifecycleManager({ restoreFocus: false });
  state.editorPanel = 'parts';
  setCreatorView('edit');
  renderAll();
  await syncMakerWorkspaceContext();
  if (!makerWorkspaceOperationIsActive(operation)) return false;
  makerWorkspace?.openCreatorReleaseManager?.();
  return true;
}

function applyRefreshedOwnedMakerModel() {
  const template = activeTemplate();
  const model = template ? makerModels.get(template.id) : null;
  const refreshedDocument = model?.publishedMakerDocumentV4
    || model?.makerDocumentV4;
  const currentRootMakerId = currentMakerV4Source()?.version?.rootMakerId
    || state.publishedMakerDocumentV4?.version?.rootMakerId;
  if (
    !templateIsOwnedByWallet(template)
    || makerModelHasPendingV4Version(model)
    || !isMakerV4Document(refreshedDocument)
    || (
      currentRootMakerId
      && refreshedDocument.version.rootMakerId !== currentRootMakerId
    )
  ) return false;
  applyMakerModelToState(template.id, model);
  syncTemplateFields();
  return true;
}

async function rebindRefreshedOwnedMakerWorkspace({
  guard = () => true,
} = {}) {
  if (!guard() || !applyRefreshedOwnedMakerModel()) {
    throw makerAuthorityError('MAKER_VERSION_REBIND_FAILED', 'makerDiscoveryFailed');
  }
  await syncMakerWorkspaceContext({ replaceDocument: true });
  if (!guard()) {
    throw makerAuthorityError('MAKER_CONTEXT_CHANGED', 'makerContextChanged');
  }
  const expectedDocument = state.publishedMakerDocumentV4;
  const reboundDocument = makerWorkspace?.getDocument?.();
  const reboundAssets = makerWorkspace?.getPlayerSnapshot?.().assets;
  const versionMatches = Boolean(
    isMakerV4Document(expectedDocument)
    && isMakerV4Document(reboundDocument)
    && reboundDocument.version.rootMakerId === expectedDocument.version.rootMakerId
    && reboundDocument.version.versionId === expectedDocument.version.versionId,
  );
  const assetsMatch = Boolean(
    reboundAssets instanceof Map
    && (expectedDocument?.assets || []).every((asset) => reboundAssets.has(asset.id)),
  );
  if (!versionMatches || !assetsMatch) {
    throw makerAuthorityError('MAKER_VERSION_REBIND_FAILED', 'makerDiscoveryFailed');
  }
  const saved = await makerWorkspace?.save?.({
    automatic: false,
    force: true,
  });
  if (!guard()) {
    throw makerAuthorityError('MAKER_CONTEXT_CHANGED', 'makerContextChanged');
  }
  if (!saved?.confirmed) {
    throw makerAuthorityError(
      'MAKER_VERSION_REBIND_SAVE_FAILED',
      'localDraftSaveFailed',
    );
  }
  return true;
}

async function beginMakerVersionDraft() {
  if (
    state.publishing
    || state.makerLifecycleActionBusy
    || !makerIsPublished()
    || makerHasPendingV4Version()
    || !isMakerV4Document(state.makerDocumentV4)
  ) return false;
  const operation = captureMakerWorkspaceOperation();
  const lifecycleOperationId = ++makerWorkspaceLifecycleOperationId;
  state.makerLifecycleActionBusy = true;
  renderAll();
  try {
    const operationIsActive = () => (
      lifecycleOperationId === makerWorkspaceLifecycleOperationId
      && makerWorkspaceOperationIsActive(operation)
    );
    await refreshOwnedMakerVersionLineage({
      walletAddress: operation.walletAddress,
      requiredMakerObjectId: state.makerObjectId || activeTemplate()?.objectId,
      guard: operationIsActive,
    });
    if (!operationIsActive()) return false;
    await rebindRefreshedOwnedMakerWorkspace({ guard: operationIsActive });
    if (!operationIsActive()) return false;
    const lineageFork = makerPublishedLineageFork();
    if (lineageFork) {
      state.publishStatusI18n = null;
      state.publishStatus = makerVersionLineageForkMessage(lineageFork);
      return false;
    }
    const knownSuccessor = directPublishedMakerSuccessor();
    if (knownSuccessor) {
      state.publishStatusI18n = null;
      state.publishStatus = makerVersionDraftConflictMessage(
        knownSuccessor,
        {
          version: {
            parentVersionId: state.publishedMakerDocumentV4?.version?.versionId || '—',
          },
        },
      );
      return false;
    }
    const started = makerWorkspace?.beginNextVersion?.() === true;
    if (!started) return false;
    const saved = await makerWorkspace?.save?.({ automatic: false });
    if (
      !saved?.confirmed
      || !operationIsActive()
    ) return false;
    setLocalizedPublishStatus('makerLifecycleVersionStarted');
    return true;
  } finally {
    if (lifecycleOperationId === makerWorkspaceLifecycleOperationId) {
      state.makerLifecycleActionBusy = false;
      renderAll();
    }
  }
}

async function discardMakerVersionDraft() {
  if (
    state.publishing
    || state.makerLifecycleActionBusy
    || !makerHasPendingV4Version()
  ) return false;
  const operation = captureMakerWorkspaceOperation();
  const lifecycleOperationId = ++makerWorkspaceLifecycleOperationId;
  state.makerLifecycleActionBusy = true;
  renderAll();
  try {
    await syncMakerWorkspaceContext();
    if (
      lifecycleOperationId !== makerWorkspaceLifecycleOperationId
      || !makerWorkspaceOperationIsActive(operation)
    ) return false;
    const discarded = await makerWorkspace?.discardVersionDraft?.();
    if (
      !discarded
      || lifecycleOperationId !== makerWorkspaceLifecycleOperationId
      || !makerWorkspaceOperationIsActive(operation)
    ) return false;
    const operationIsActive = () => (
      lifecycleOperationId === makerWorkspaceLifecycleOperationId
      && makerWorkspaceOperationIsActive(operation)
    );
    await refreshOwnedMakerVersionLineage({
      walletAddress: operation.walletAddress,
      requiredMakerObjectId: state.makerObjectId || activeTemplate()?.objectId,
      guard: operationIsActive,
    });
    if (!operationIsActive()) return false;
    await rebindRefreshedOwnedMakerWorkspace({ guard: operationIsActive });
    if (!operationIsActive()) return false;
    const lineageFork = makerPublishedLineageFork();
    if (lineageFork) {
      state.publishStatusI18n = null;
      state.publishStatus = makerVersionLineageForkMessage(lineageFork);
    } else {
      setLocalizedPublishStatus('makerLifecycleVersionDiscarded');
    }
    return true;
  } finally {
    if (lifecycleOperationId === makerWorkspaceLifecycleOperationId) {
      state.makerLifecycleActionBusy = false;
      renderAll();
    }
  }
}

async function handleMakerLifecycleAction(action) {
  if (!action) return;
  const historySeparator = action.indexOf(':');
  if (historySeparator > 0 && action.startsWith('history-')) {
    const historyAction = action.slice(0, historySeparator);
    const makerObjectId = suiJsonId(action.slice(historySeparator + 1));
    const version = publishedMakerVersionHistory().find((entry) => (
      comparableSuiId(entry.makerObjectId) === comparableSuiId(makerObjectId)
    ));
    if (!makerObjectId || !version) return;
    const targetLabel = makerLifecycleVersionTargetLabel(version);
    if (historyAction === 'history-pause') {
      openConfirmation({
        title: `${t('makerLifecyclePauseTitle')} ${version.versionId}`,
        message: `${targetLabel}. ${t('makerLifecyclePauseCopy')}`,
        confirmLabel: t('makerLifecyclePauseConfirm'),
        action: () => updateHistoricalMakerAuthorizationState(makerObjectId, false),
      });
      return;
    }
    if (historyAction === 'history-resume') {
      const hasPausedEconomics = Boolean(version.pausedEconomics);
      openConfirmation({
        title: `${t('makerLifecycleResumeTitle')} ${version.versionId}`,
        message: `${targetLabel}. ${t(
          hasPausedEconomics
            ? 'makerLifecycleResumeCopy'
            : 'makerLifecycleResumeFreeCopy',
        )}`,
        confirmLabel: t(
          hasPausedEconomics
            ? 'makerLifecycleResumeConfirm'
            : 'makerLifecycleResumeFreeConfirm',
        ),
        action: () => updateHistoricalMakerAuthorizationState(makerObjectId, true),
      });
      return;
    }
    if (historyAction === 'history-archive') {
      openConfirmation({
        title: `${t('archiveMakerTitle')} ${version.versionId}`,
        message: `${targetLabel}. ${t('archiveMakerCopy')}`,
        confirmLabel: t('archiveMakerConfirm'),
        action: () => updateHistoricalMakerArchiveState(makerObjectId, true),
      });
      return;
    }
    if (historyAction === 'history-restore') {
      openConfirmation({
        title: `${t('makerLifecycleActionRestore')}? ${version.versionId}`,
        message: `${targetLabel}. ${t('archivedLifecycleCopy')}`,
        confirmLabel: t('makerLifecycleActionRestore'),
        action: () => updateHistoricalMakerArchiveState(makerObjectId, false),
      });
      return;
    }
  }
  if (action === 'open-editor') {
    openMakerEditorFromLifecycle();
    return;
  }
  if (action === 'open-release') {
    try {
      await openMakerReleaseFromLifecycle();
    } catch (error) {
      state.publishStatusI18n = null;
      state.publishStatus = state.locale === 'en' && error?.message
        ? error.message
        : t('requestedActionFailed');
      renderAll();
    }
    return;
  }
  if (action === 'start-version') {
    try {
      await beginMakerVersionDraft();
    } catch (error) {
      state.publishStatusI18n = null;
      state.publishStatus = state.locale === 'en' && error?.message
        ? error.message
        : t('requestedActionFailed');
      renderAll();
    }
    return;
  }
  if (action === 'discard-version') {
    openConfirmation({
      title: t('makerLifecycleDiscardVersionTitle'),
      message: t('makerLifecycleDiscardVersionCopy'),
      confirmLabel: t('makerLifecycleDiscardVersionConfirm'),
      action: discardMakerVersionDraft,
    });
    return;
  }
  if (action === 'pause-authorizations') {
    openConfirmation({
      title: t('makerLifecyclePauseTitle'),
      message: t('makerLifecyclePauseCopy'),
      confirmLabel: t('makerLifecyclePauseConfirm'),
      action: () => updateMakerSoulAuthorizationState(false),
    });
    return;
  }
  if (action === 'resume-authorizations') {
    const hasPausedEconomics = Boolean(activePausedEconomicsSnapshot());
    openConfirmation({
      title: t('makerLifecycleResumeTitle'),
      message: t(
        hasPausedEconomics
          ? 'makerLifecycleResumeCopy'
          : 'makerLifecycleResumeFreeCopy',
      ),
      confirmLabel: t(
        hasPausedEconomics
          ? 'makerLifecycleResumeConfirm'
          : 'makerLifecycleResumeFreeConfirm',
      ),
      action: () => updateMakerSoulAuthorizationState(true),
    });
    return;
  }
  if (action === 'archive-chain') {
    openConfirmation({
      title: t('archiveMakerTitle'),
      message: t('archiveMakerCopy'),
      confirmLabel: t('archiveMakerConfirm'),
      action: () => updateMakerArchiveState(true),
    });
    return;
  }
  if (action === 'restore-chain') {
    await updateMakerArchiveState(false);
    return;
  }
  if (action === 'delete-draft') {
    closeMakerLifecycleManager();
    requestDeleteMaker();
  }
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
  const lifecycle = makerLifecycleDescriptor(template);
  const displayedLifecycleLabel = t(lifecycle.labelKey);
  $('detailMakerTitle').textContent = template.name;
  $('editingMakerTitle').textContent = template.name;
  $('editingMakerTitle').title = template.name;
  $('detailDescription').textContent = template.summary || 'Build the template from layered assets, then bind the maker to license rules and on-chain provenance.';
  $('layerCount').textContent = compositionLayers.length;
  const publicItems = allSlots().flatMap((slot) => slotItems(slot.key).filter((item) => item.visibility !== 'private').map((item) => ({ slot, item })));
  const incompleteItems = publicItems.filter(({ slot, item }) => creatorLayers(slot).some((layer) => creatorColors(slot).some((color) => !assetReady(item.images?.[assetCellKey(layer.id, color.id)]))));
  if ($('makerTopPartSummary')) $('makerTopPartSummary').textContent = t('partsCount', { count: allSlots().length });
  if ($('makerTopAssetSummary')) $('makerTopAssetSummary').textContent = itemLayerAssets().length ? t('itemImagesReady', { count: itemLayerAssets().length }) : t('noItemImagesYet');
  if ($('makerTopRuleSummary')) $('makerTopRuleSummary').textContent = t('rulesCount', { count: state.rules.length });
  if ($('makerTopReadiness')) {
    $('makerTopReadiness').textContent = !allSlots().length
      ? t('addFirstPart')
      : incompleteItems.length === 0 ? t('readyPreview') : t('incompleteItems', { count: incompleteItems.length });
  }
  if ($('makerTopChainState')) {
    $('makerTopChainState').textContent = lifecycle.published || ['publishing', 'recoverable'].includes(lifecycle.id)
      ? displayedLifecycleLabel
      : !packageConfigured() ? t('packagePending') : displayedLifecycleLabel;
  }
  const canvasRatio = state.makerCanvas.width === state.makerCanvas.height ? '1:1' : '9:16';
  if ($('makerTopLifecycleTag')) $('makerTopLifecycleTag').textContent = displayedLifecycleLabel;
  if ($('makerWorkspaceLifecycleTag')) $('makerWorkspaceLifecycleTag').textContent = displayedLifecycleLabel;
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
        message: `“${item.label}” and all of its local Style PNG references will be removed from this draft.`,
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

function themeMenuIsOpen() {
  return $('themeMenu')?.classList.contains('active') === true;
}

function openThemeMenu() {
  if (!$('themeMenu') || !$('themeButton')) return;
  if ($('accountPanel')?.classList.contains('active')) closeAccountPanel();
  $('themeMenu').hidden = false;
  $('themeMenu').classList.add('active');
  $('themeMenu').setAttribute('aria-hidden', 'false');
  $('themeButton').setAttribute('aria-expanded', 'true');
  const selected = $('themeMenu').querySelector('[role="menuitemradio"][aria-checked="true"]')
    || $('themeMenu').querySelector('[role="menuitemradio"]');
  selected?.focus({ preventScroll: true });
}

function closeThemeMenu({ returnFocus = true } = {}) {
  if (!$('themeMenu') || !$('themeButton')) return;
  const wasOpen = themeMenuIsOpen();
  $('themeMenu').classList.remove('active');
  $('themeMenu').setAttribute('aria-hidden', 'true');
  $('themeMenu').hidden = true;
  $('themeButton').setAttribute('aria-expanded', 'false');
  if (wasOpen && returnFocus) $('themeButton').focus({ preventScroll: true });
}

function openAccountPanel() {
  closeThemeMenu({ returnFocus: false });
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
  if (state.publishing || state.minting) {
    if (state.publishing) state.publishStatus = t('publishingStatus');
    if (state.minting) state.mintStatus = t('preparingHandoff');
    renderAll();
    return;
  }
  connectSuiWallet();
}

function renderWalletState() {
  $('walletButton').classList.toggle('connected', state.walletConnected);
  const walletLabel = $('walletButton').querySelector('[data-i18n="walletConnect"]');
  const displayAddress = shortAddress(state.walletAddress);
  if (walletLabel) walletLabel.textContent = state.walletConnected ? displayAddress : t('walletConnect');
  $('panelWalletButton').textContent = state.walletConnected
    ? t('walletConnectedAs', { address: displayAddress })
    : t('connectSuiWallet');
  $('walletSummary').textContent = state.walletConnected
    ? `${state.walletProvider || 'Sui wallet'} · ${runtimeConfig.network}`
    : t('walletDisconnected');
  if ($('profileSummary')) {
    $('profileSummary').textContent = !state.walletConnected
      ? t('creatorProfileAfterFirstPublish')
      : state.creatorProfileObjectId
        ? t('creatorProfileObject', { address: shortAddress(state.creatorProfileObjectId) })
        : t('creatorProfileCreatedOnPublish');
  }
  if ($('accountIdentity')) $('accountIdentity').textContent = state.walletConnected
    ? shortAddress(state.walletAddress)
    : t('accountGuest');
  $('walletFirstCard').classList.toggle('connected', state.walletConnected);
  document.querySelector('.account-grid').classList.toggle('locked', !state.walletConnected);
  document.querySelectorAll('.account-grid [data-page]').forEach((button) => {
    button.disabled = !state.walletConnected || (button.dataset.page === 'make' && !canOpenPlayer());
  });
  if ($('accountMakeOc')) {
    $('accountMakeOc').title = canOpenPlayer()
      ? t('continueMakerSession')
      : t('choosePublishedMaker');
  }
  if ($('playMakerPreview')) {
    const source = activeTemplate()?.source;
    const previewReady = source === 'chain'
      || (source === 'local' && makerHasRenderableAssets())
      || (localUiTest && source === 'creator-pack' && makerHasRenderableAssets());
    $('playMakerPreview').disabled = !previewReady;
    $('playMakerPreview').title = previewReady ? t('openExactPlayer') : t('uploadStyleBeforePreview');
  }
  const soulidityLinks = {
    soulidityMySoulsLink: '/my-souls',
    soulidityProfileLink: '/profile',
    soulidityCommunityLink: '/community',
    soulidityMarketLink: '/market',
  };
  Object.entries(soulidityLinks).forEach(([id, path]) => {
    const link = $(id);
    if (link) link.href = soulidityAppLink(path);
  });
  document.querySelectorAll('[data-soulidity-auth]').forEach((link) => {
    link.setAttribute('aria-disabled', String(!state.walletConnected));
  });
  if (!state.walletConnected) closeAccountPanel();
  if ($('creatorWalletGate')) $('creatorWalletGate').hidden = state.walletConnected;
  if ($('creatorConsole')) $('creatorConsole').hidden = !state.walletConnected;
  if ($('backToCreatorPreview')) $('backToCreatorPreview').hidden = !state.previewingMaker;
}

function publishReadiness() {
  if (!packageConfigured()) return t('publishPackageFirst');
  if (!state.walletConnected) return t('connectPublishWallet');
  if (!$('creatorTemplateName').value.trim()) return t('addMakerName');
  const issue = makerPublicationIssues()[0];
  if (issue) return issue;
  return t('publishReadinessCopy');
}

function renderPublishAction() {
  const locked = makerIsPublished() && !makerHasPendingV4Version();
  const versionDraftConflict = makerVersionDraftConflict();
  const lineageFork = makerPublishedLineageFork();
  const hasMakerAssets = isMakerV4Document(state.makerDocumentV4)
    ? state.makerDocumentV4.parts.some((part) => part.items.some((item) => (item.styles || []).some((style) => style.assetId)))
    : itemLayerAssets().length > 0;
  const publicationRecoveryPending = makerPublicationRecoveryPending();
  const baseReady = !locked && packageConfigured() && state.walletConnected && hasMakerAssets;
  const failedAction = String(state.makerPublishError?.action || '');
  const canRetryPrepareCheckpoint = failedAction === 'prepare' && Boolean(state.makerUploadSession?.checkpoint);
  const canRetryRegisterCheckpoint = failedAction === 'register'
    && ['uploaded', 'certified'].includes(state.makerUploadStage);
  const canRetryCertifyCheckpoint = failedAction === 'certify'
    && state.makerUploadStage === 'certified';
  makerWorkspace?.setCreatorPublishState?.({
    stage: state.makerUploadStage,
    status: state.publishStatus || publishReadiness(),
    busy: state.publishing,
    digest: state.publishDigest,
    error: state.makerPublishError,
    relayTipMist: state.makerUploadSession?.relayTipMist == null
      ? null
      : String(state.makerUploadSession.relayTipMist),
    relayTipQuotedAt: String(state.makerUploadSession?.relayTipQuotedAt || ''),
    walrusStorageCostFrost: state.makerUploadSession?.walrusStorageCostFrost == null
      ? null
      : String(state.makerUploadSession.walrusStorageCostFrost),
    walrusWriteCostFrost: state.makerUploadSession?.walrusWriteCostFrost == null
      ? null
      : String(state.makerUploadSession.walrusWriteCostFrost),
    walrusTotalCostFrost: state.makerUploadSession?.walrusTotalCostFrost == null
      ? null
      : String(state.makerUploadSession.walrusTotalCostFrost),
    actions: {
      resume: !locked
        && !state.publishing
        && state.walletConnected
        && state.hasMakerUploadRecovery
        && (!state.makerUploadSession || state.makerUploadStage === 'idle'),
      discard: !locked
        && !state.publishing
        && state.hasMakerUploadRecovery
        && state.makerUploadStage === 'idle'
        && failedAction === 'resume',
      prepare: !state.publishing && (
        (baseReady && state.makerUploadStage === 'idle' && !state.hasMakerUploadRecovery)
        || canRetryPrepareCheckpoint
      ),
      register: !state.publishing && state.walletConnected && (
        ['encoded', 'register-pending', 'registered'].includes(state.makerUploadStage)
        || canRetryRegisterCheckpoint
      ),
      certify: !state.publishing && state.walletConnected && (
        ['uploaded', 'certify-pending'].includes(state.makerUploadStage)
        || canRetryCertifyCheckpoint
      ),
      publish: !locked
        && !versionDraftConflict
        && !lineageFork
        && !state.publishing
        && !publicationRecoveryPending
        && state.walletConnected
        && state.makerUploadStage === 'certified',
      review: !state.publishing && publicationRecoveryPending,
    },
  });
}

function renderChainStatus() {
  if ($('refreshMakers')) {
    $('refreshMakers').disabled = state.chainMakersLoading || !packageConfigured();
    $('refreshMakers').textContent = state.chainMakersLoading ? t('syncingMakers') : t('refreshMakers');
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
        <span>${escapeHtml(t('networkLabel'))}</span>
        <strong>${escapeHtml(runtimeConfig.network)}</strong>
      </div>
      <div>
        <span>${escapeHtml(t('packageLabel'))}</span>
        <strong>${escapeHtml(!packageConfigured() ? t('publishPackageFirstShort') : shortAddress(runtimeConfig.callablePackageId))}</strong>
      </div>
      <div>
        <span>${escapeHtml(t('walrusLabel'))}</span>
        <strong>${escapeHtml(runtimeConfig.walrusUploadRelayUrl
          ? t('epochRetention', { count: Number(runtimeConfig.walrusEpochs || 53) })
          : t('configureUploadRelay'))}</strong>
      </div>
      <div>
        <span>${escapeHtml(t('signerLabel'))}</span>
        <strong>${escapeHtml(state.walletConnected
          ? shortAddress(state.walletAddress) || t('signerConnected')
          : t('signerConnectWallet'))}</strong>
      </div>
    `;
  }
  renderPublishAction();
}

function renderProtocol() {
  $('protocolSteps').innerHTML = protocolSteps.map(([number, titleKey, bodyKey]) => `
    <article class="protocol-card">
      <span>${number}</span>
      <h2>${escapeHtml(t(titleKey))}</h2>
      <p>${escapeHtml(t(bodyKey))}</p>
    </article>
  `).join('');
}

let docsCenter = null;
let docsCenterInitializationPromise = null;
let docsCenterInitializationFailed = false;

async function renderDocsHandbook() {
  const root = $('docsHandbook');
  if (!root || docsCenterInitializationFailed) return;
  if (!docsCenter && state.page !== 'docs') return;
  try {
    if (!docsCenter) {
      docsCenter = await (docsCenterInitializationPromise ||= import('./docs-center.js')
        .then(({ createDocsCenter }) => createDocsCenter(root)));
      if (!root.isConnected) return;
    }
    docsCenter.render(state.locale);
  } catch (error) {
    docsCenterInitializationFailed = true;
    root.replaceChildren();
    const fallback = document.createElement('section');
    fallback.className = 'docs-empty protocol-card';
    const title = document.createElement('h2');
    title.textContent = t('docsTitle');
    const copy = document.createElement('p');
    copy.textContent = t('docsIntro');
    fallback.append(title, copy);
    root.append(fallback);
    console.error('The Docs handbook could not be initialized.', error);
  }
}

function renderChainActions() {
  document.querySelectorAll('[data-chain-action-list]').forEach((node) => {
    node.innerHTML = chainActions.map((action, index) => `
      <div>
        <span>${String(index + 1).padStart(2, '0')}</span>
        <strong>${escapeHtml(t(action.titleKey))}</strong>
        <small>${escapeHtml(t(action.bodyKey))}</small>
      </div>
    `).join('');
  });
}

async function prepareMakerUpload() {
  if (state.publishing) return;
  const operation = beginMakerChainOperation();
  clearMakerPublishError();
  state.publishing = true;
  state.makerReleaseInFlight = true;
  state.publishDigest = '';
  state.publishStatus = t('encodingQuilt');
  renderPublishAction();
  try {
    await withBrowserUploadLock(operation.recoveryKey, async () => {
      const restoredNewer = await syncLatestMakerUploadRecovery();
      if (!makerChainOperationIsActive(operation)) return;
      if (restoredNewer && state.makerUploadStage !== 'idle') return;
      if (state.makerUploadSession?.checkpoint && state.makerUploadStage !== 'idle') {
        await persistMakerUploadRecovery();
        if (!makerChainOperationIsActive(operation)) return;
        state.publishStatus = t('makerRecoveryRestored');
        return;
      }
      syncCreatorAssets();
      const issues = makerPublicationIssues();
      if (issues.length) throw new Error(issues[0]);
      const documentV4 = isMakerV4Document(state.makerDocumentV4)
        ? makerV4DocumentForRelease({ includeGeneratedCover: true })
        : null;
      if (documentV4) {
        const projection = compileMakerV4MoveProjectionV2(documentV4);
        assertMakerV4ProjectionV2SinglePublishBudget(projection);
      }
      if (documentV4) {
        const generatedCoverBlob = makerV4ReleaseCoverIsGenerated(documentV4)
          ? await renderOcImageBlob(state.makerDocumentV4?.defaultRecipe || null)
          : null;
        if (!makerChainOperationIsActive(operation)) return;
        const runtimeAssets = await makerV4RuntimeAssetsForRelease(documentV4, generatedCoverBlob);
        if (!makerChainOperationIsActive(operation)) return;
        const coverBlob = makerV4ReleaseCoverBlob(documentV4, runtimeAssets);
        if (!coverBlob) throw new Error(t('makerRecoveryCoverMissing'));
        state.pendingMakerCoverBlob = coverBlob;
        const bundle = buildMakerV4PublicationBundle(documentV4, runtimeAssets, {
          previousDocument: isMakerV4Document(state.publishedMakerDocumentV4) ? state.publishedMakerDocumentV4 : null,
          publicExtensions: makerV4PublicExtensions(documentV4),
          projectionAuxiliaryBlob: makerProjectionAuxiliaryPngBlob(),
        });
        state.pendingMakerV4Bundle = bundle;
        state.pendingMakerAssets = bundle.assetEntries.map((entry) => ({
          assetId: entry.assetId,
          file: entry.blob,
          blob: entry.blob,
          name: entry.identifier,
          size: entry.blob?.size || 0,
          type: entry.blob?.type || 'application/octet-stream',
          kind: entry.kind,
          identifier: entry.identifier,
          projectionOnly: entry.projectionOnly === true,
          renderAsset: entry.renderAsset !== false,
          patchId: '',
          blobId: '',
        }));
        state.pendingMakerManifestJson = bundle.manifestJson;
      } else {
        const coverBlob = await renderOcImageBlob(null);
        if (!makerChainOperationIsActive(operation)) return;
        state.pendingMakerCoverBlob = coverBlob;
        state.pendingMakerV4Bundle = null;
        state.pendingMakerAssets = [
          ...publishableAssets(),
          makerCoverAsset(coverBlob),
        ];
        state.pendingMakerManifestJson = JSON.stringify(creatorUploadManifest());
      }
      state.pendingMakerAssets.forEach((asset) => {
        if (!asset.file) throw new Error(t('makerAssetUnavailable', { name: asset.name }));
      });
      const uploadSession = await prepareWalrusUpload(makerUploadEntries());
      if (!makerChainOperationIsActive(operation)) return;
      state.makerUploadSession = uploadSession;
      state.makerQuiltId = uploadSession.quiltBlobId;
      state.makerUploadStage = uploadSession.stage;
      state.publishStatus = t('quiltEncoded');
      await persistMakerUploadRecovery();
    });
  } catch (error) {
    if (makerChainOperationIsActive(operation)) {
      recordMakerPublishError(error, 'prepare', 'prepareQuiltFailed');
    }
  } finally {
    if (makerChainOperationIsActive(operation)) {
      state.publishing = false;
      state.makerReleaseInFlight = false;
      renderAll();
    }
  }
}

async function registerMakerUpload() {
  if (state.publishing) return;
  const operation = beginMakerChainOperation();
  const retryingAdvancedCheckpoint = state.makerPublishError?.action === 'register'
    && ['uploaded', 'certified'].includes(state.makerUploadStage);
  clearMakerPublishError();
  state.publishing = true;
  state.makerReleaseInFlight = true;
  state.publishStatus = t('registeringQuilt');
  renderPublishAction();
  try {
    await withBrowserUploadLock(operation.recoveryKey, async () => {
      await syncLatestMakerUploadRecovery();
      if (!makerChainOperationIsActive(operation)) return;
      if (![
        'encoded',
        'register-pending',
        'registered',
        ...(retryingAdvancedCheckpoint ? ['uploaded', 'certified'] : []),
      ].includes(state.makerUploadSession?.stage)) return;
      const session = state.makerUploadSession;
      const persistenceContext = captureMakerUploadPersistenceContext(session);
      await registerAndUploadWalrus(session, {
        onCheckpoint: makerUploadCheckpointHandler(session, persistenceContext),
      });
      await persistMakerUploadRecovery(session, persistenceContext);
      if (!makerChainOperationIsActive(operation)) return;
      state.makerUploadStage = session.stage;
      if (state.makerUploadStage === 'certified') {
        if (session.files.length !== state.pendingMakerAssets.length + 1) throw new Error(t('unexpectedMakerQuilt'));
        state.pendingMakerAssets.forEach((asset, index) => {
          asset.patchId = session.files[index].id;
          asset.blobId = session.files[index].blobId;
        });
        state.makerQuiltId = session.files[0]?.blobId || state.makerQuiltId;
        state.publishStatus = t('recoveredCertified');
      } else {
        state.publishStatus = t('quiltUploaded');
      }
    });
  } catch (error) {
    if (makerChainOperationIsActive(operation)) {
      state.makerUploadStage = state.makerUploadSession?.stage || state.makerUploadStage;
      recordMakerPublishError(error, 'register', 'registrationFailed');
    }
  } finally {
    if (makerChainOperationIsActive(operation)) {
      state.publishing = false;
      state.makerReleaseInFlight = false;
      renderAll();
    }
  }
}

async function certifyMakerUpload() {
  if (state.publishing) return;
  const operation = beginMakerChainOperation();
  const recheckingCertificationVisibility = state.makerPublishError?.code === 'WALRUS_CERTIFICATION_NOT_VISIBLE';
  const retryingCertifiedCheckpoint = state.makerPublishError?.action === 'certify'
    && state.makerUploadStage === 'certified';
  clearMakerPublishError();
  state.publishing = true;
  state.makerReleaseInFlight = true;
  state.publishStatus = t(recheckingCertificationVisibility ? 'certificationSyncing' : 'certifyingQuilt');
  renderPublishAction();
  try {
    await withBrowserUploadLock(operation.recoveryKey, async () => {
      await syncLatestMakerUploadRecovery();
      if (!makerChainOperationIsActive(operation)) return;
      if (![
        'uploaded',
        'certify-pending',
        ...(retryingCertifiedCheckpoint ? ['certified'] : []),
      ].includes(state.makerUploadSession?.stage)) return;
      const session = state.makerUploadSession;
      const persistenceContext = captureMakerUploadPersistenceContext(session);
      await certifyWalrusUpload(session, {
        onCheckpoint: makerUploadCheckpointHandler(session, persistenceContext),
      });
      await persistMakerUploadRecovery(session, persistenceContext);
      if (!makerChainOperationIsActive(operation)) return;
      if (session.files.length !== state.pendingMakerAssets.length + 1) {
        throw new Error(t('unexpectedMakerQuilt'));
      }
      state.pendingMakerAssets.forEach((asset, index) => {
        asset.patchId = session.files[index].id;
        asset.blobId = session.files[index].blobId;
      });
      state.makerQuiltId = session.files[0]?.blobId || state.makerQuiltId;
      state.makerUploadStage = 'certified';
      state.publishStatus = t('quiltCertified');
    });
  } catch (error) {
    if (makerChainOperationIsActive(operation)) {
      const classified = recordMakerPublishError(error, 'certify', 'certificationFailed');
      if (classified.code === 'WALRUS_CERTIFICATION_NOT_VISIBLE') {
        state.publishStatus = t('certificationSyncing');
      }
    }
  } finally {
    if (makerChainOperationIsActive(operation)) {
      state.publishing = false;
      state.makerReleaseInFlight = false;
      renderAll();
    }
  }
}

async function assertMakerPublicationStillValid(operation, {
  guard = () => makerChainOperationIsActive(operation),
} = {}) {
  if (!guard()) {
    throw makerAuthorityError('MAKER_CONTEXT_CHANGED', 'makerContextChanged');
  }
  if (makerHasPendingV4Version()) {
    await refreshOwnedMakerVersionLineage({
      walletAddress: operation.walletAddress,
      requiredMakerObjectId: state.makerObjectId || activeTemplate()?.objectId,
      guard,
    });
  }
  if (!guard()) {
    throw makerAuthorityError('MAKER_CONTEXT_CHANGED', 'makerContextChanged');
  }
  const issues = makerPublicationIssues();
  if (!issues.length) return true;
  const error = new Error(issues[0]);
  error.code = makerVersionDraftConflict()
    ? 'MAKER_VERSION_DRAFT_CONFLICT'
    : 'MAKER_PREFLIGHT_FAILED';
  throw error;
}

async function publishCurrentMaker() {
  if (state.publishing || state.makerUploadStage !== 'certified') return;
  const operation = beginMakerChainOperation();
  clearMakerPublishError();
  let publicationSignatureRequested = false;
  let publicationSession = null;
  let publicationContext = null;
  let publicationIntent = null;
  let submissionCheckpointSaved = false;
  const publicationContextIsActive = () => (
    makerChainOperationIsActive(operation)
    && (!publicationSession || makerUploadContextIsActive(publicationSession, publicationContext))
  );
  const persistPublicationIntent = async (nextIntent) => {
    publicationIntent = normalizedMakerPublicationIntent(nextIntent);
    if (!publicationSession || !publicationContext) {
      throw new Error('The Maker publication has no stable upload checkpoint context.');
    }
    publicationContext = makerUploadContextWithPublicationIntent(
      publicationContext,
      publicationIntent,
    );
    const verified = await persistMakerUploadRecovery(publicationSession, publicationContext);
    if (publicationContextIsActive()) {
      state.makerPublicationIntent = publicationIntent;
    }
    return verified;
  };
  state.publishing = true;
  state.makerReleaseInFlight = true;
  state.publishStatus = t('waitingSuiPublish');
  renderPublishAction();
  try {
    await withBrowserUploadLock(operation.recoveryKey, async () => {
    await syncLatestMakerUploadRecovery();
    if (!makerChainOperationIsActive(operation)) return;
    if (state.makerUploadStage !== 'certified' || !state.makerUploadSession) {
      throw new Error(t('makerRecoveryFailed'));
    }
    publicationSession = state.makerUploadSession;
    publicationContext = captureMakerUploadPersistenceContext(publicationSession);
    if (!publicationContext || !publicationContextIsActive()) {
      throw new Error('The active Maker changed before publication could start.');
    }
    if (JSON.stringify(creatorUploadManifest()) !== state.pendingMakerManifestJson) {
      state.makerUploadSession = null;
      state.makerUploadStage = 'idle';
      state.makerQuiltId = '';
      state.pendingMakerManifestJson = '';
      state.pendingMakerV4Bundle = null;
      state.pendingMakerAssets.forEach((asset) => {
        asset.patchId = '';
        asset.blobId = '';
      });
      throw new Error(t('makerChangedAfterUpload'));
    }
    const pendingIntent = normalizedMakerPublicationIntent(state.makerPublicationIntent);
    publicationIntent = pendingIntent;
    const pendingPublicationForWallet = pendingIntent
      && pendingIntent.creator.toLowerCase() === String(operation.walletAddress || '').toLowerCase();
    if (pendingPublicationForWallet) {
      const recovered = await recoverMakerPublicationIntent({
        scheduleRetry: true,
        guard: publicationContextIsActive,
      });
      if (!publicationContextIsActive()) return;
      if (recovered) return;
      state.publishStatus = pendingIntent.digest
        ? t('publicationSubmittedRecovering')
        : t('publicationPendingReview');
      return;
    }
    const alreadyPublished = await findPublishedMakerByIntent({
      creator: operation.walletAddress,
      manifestBlobId: publicationContext.quiltBlobId,
      limit: 500,
    });
    if (!publicationContextIsActive()) return;
    if (alreadyPublished) {
      let indexed = {};
      if (alreadyPublished.digest) {
        indexed = await resolvePublishedMakerObjects(alreadyPublished.digest, 20_000);
      }
      await finalizeMakerPublication({
        ...alreadyPublished,
        ...indexed,
        digest: alreadyPublished.digest || indexed.digest || '',
      }, null, {
        recovered: true,
        guard: publicationContextIsActive,
      });
      return;
    }
    let makerParts;
    let makerItems;
    let makerRules;
    let makerPaletteLinks;
    let makerPayload;
    let creatorDisplayName = $('creatorName').value.trim();
    let creatorBio = `${$('creatorWorld').value.trim()} OC maker creator`;
    if (isMakerV4Document(state.makerDocumentV4)) {
      const publishedManifest = JSON.parse(state.pendingMakerManifestJson);
      const uploadEntries = state.pendingMakerV4Bundle?.entries || makerUploadEntries();
      const locations = indexMakerV4UploadResults(uploadEntries, publicationSession.files);
      const coverLocation = locations.get(publishedManifest.metadata.coverAssetId);
      const auxiliaryLocation = state.pendingMakerAssets.find((asset) => (
        asset.identifier === MAKER_V4_PROJECTION_V2_AUXILIARY_IDENTIFIER
      ));
      const summary = buildMakerV4MoveSummaryV2(publishedManifest, {
        assetLocations: locations,
        auxiliaryLocation,
        coverUrl: walrusFileUrl(coverLocation?.id || coverLocation?.patchId || ''),
        previousDocument: isMakerV4Document(state.publishedMakerDocumentV4) ? state.publishedMakerDocumentV4 : null,
      });
      makerParts = summary.parts;
      makerItems = summary.items;
      makerRules = summary.rules;
      makerPaletteLinks = summary.paletteLinks;
      makerPayload = summary.maker;
      creatorDisplayName = publishedManifest.metadata.creator;
      creatorBio = `${publishedManifest.metadata.style} OC maker creator`;
    } else {
      const layerAssets = state.pendingMakerAssets.filter((asset) => asset.kind === 'item-layer');
      const assetSlots = [...new Set(layerAssets.map((asset) => asset.slot))];
      makerParts = assetSlots.map((key, index) => {
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
      makerItems = assetSlots.flatMap((partKey) => slotItems(partKey).filter((item) => item.visibility !== 'private').flatMap((item) => {
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
      makerRules = state.rules.filter((rule) => assetSlots.includes(rule.leftPartKey) && assetSlots.includes(rule.rightPartKey));
      if (makerRules.length !== state.rules.length) throw new Error(t('ruleAssetMismatch'));
      makerPaletteLinks = state.paletteLinks;
      makerPayload = {
        name: $('creatorTemplateName').value.trim(),
        description: activeTemplate().summary,
        coverUrl: walrusFileUrl(state.pendingMakerAssets.find((asset) => asset.kind === 'maker-cover')?.patchId),
        license: $('creatorLicense').value,
        royaltyBps: Number($('creatorRoyalty').value || 0),
        mintingEnabled: $('creatorMintingEnabled').checked,
        mintFeeEnabled: $('creatorMintFeeEnabled').checked,
        mintPriceAtomic: $('creatorMintFeeEnabled').checked ? decimalCoinToAtomic($('creatorMintPrice').value) : 0,
      };
    }

    await assertMakerPublicationStillValid(operation, {
      guard: publicationContextIsActive,
    });
    if (!publicationContextIsActive()) return;
    state.publishStatus = t('publicationIntentSaving');
    publicationIntent = {
      creator: operation.walletAddress,
      manifestBlobId: publicationContext.quiltBlobId,
      createdAt: new Date().toISOString(),
      status: 'awaiting-signature',
      digest: '',
    };
    state.makerPublicationIntent = publicationIntent;
    await persistPublicationIntent(publicationIntent);
    if (!publicationContextIsActive()) {
      await persistPublicationIntent(null);
      return;
    }
    if (makerPublicationRecoveryTimer) {
      clearTimeout(makerPublicationRecoveryTimer);
      makerPublicationRecoveryTimer = null;
    }
    publicationSignatureRequested = true;
    state.publishStatus = t('waitingSuiPublish');
    renderPublishAction();
    const transaction = await publishMaker({
      creator: {
        profileId: state.creatorProfileObjectId,
        displayName: creatorDisplayName,
        bio: creatorBio,
        avatarUrl: '',
      },
      maker: makerPayload,
      manifestBlobId: publicationContext.quiltBlobId,
      parts: makerParts,
      items: makerItems,
      rules: makerRules,
      paletteLinks: makerPaletteLinks,
      onSubmitted: async ({ digest }) => {
        publicationIntent = {
          ...publicationIntent,
          status: 'submitted',
          digest,
        };
        await persistPublicationIntent(publicationIntent);
        submissionCheckpointSaved = true;
        if (publicationContextIsActive()) {
          state.publishStatus = t('publicationSubmittedRecovering');
          renderPublishAction();
        }
      },
    });
    if (!submissionCheckpointSaved && transaction?.digest) {
      publicationIntent = {
        ...publicationIntent,
        status: 'submitted',
        digest: transaction.digest,
      };
      await persistPublicationIntent(publicationIntent);
      submissionCheckpointSaved = true;
    }
    if (!publicationContextIsActive()) return;
    await finalizeMakerPublication(transaction, makerPayload, {
      guard: publicationContextIsActive,
    });
    });
  } catch (error) {
    console.error('Maker publication failed', error);
    const active = publicationContextIsActive();
    const classifiedError = active
      ? recordMakerPublishError(error, 'onchain', 'makerPublicationFailed')
      : classifyChainUiError(error, { action: 'onchain' });
    const knownPreSubmissionFailure = new Set([
      'TIP_TOO_HIGH',
      'UPLOAD_QUOTE_CHANGED',
      'WALLET_REJECTED',
      'INSUFFICIENT_GAS',
      'INSUFFICIENT_SUI_BALANCE',
    ]).has(classifiedError.code);
    const currentIntent = normalizedMakerPublicationIntent(publicationIntent);
    const clearUnsignedIntent = Boolean(
      currentIntent
      && !currentIntent.digest
      && currentIntent.status === 'awaiting-signature'
      && (!publicationSignatureRequested || knownPreSubmissionFailure),
    );
    let intentPersisted = !publicationSession || !publicationContext;
    if (publicationSession?.checkpoint && publicationContext) {
      try {
        await withBrowserUploadLock(operation.recoveryKey, async () => {
          const durable = await loadMakerUploadRecovery(operation.recoveryKey);
          if (
            !durable
            || durable.uploadSessionId !== publicationSession.uploadSessionId
            || Number(durable.recoveryRevision || 0) !== Number(publicationSession.recoveryRevision || 0)
          ) return;
          await persistPublicationIntent(clearUnsignedIntent ? null : currentIntent);
          intentPersisted = true;
        });
      } catch (persistError) {
        console.warn('Could not update the failed publication intent checkpoint.', persistError);
      }
    }
    if (publicationContextIsActive()) {
      if (clearUnsignedIntent && intentPersisted) {
        state.makerPublicationIntent = null;
      } else if (currentIntent) {
        state.makerPublicationIntent = currentIntent;
        state.publishStatus = t('publicationPendingReview');
      }
    }
  } finally {
    if (makerChainOperationIsActive(operation)) {
      state.publishing = false;
      state.makerReleaseInFlight = false;
      renderAll();
    }
  }
}

async function reviewPendingMakerPublication() {
  if (state.publishing || !normalizedMakerPublicationIntent(state.makerPublicationIntent)) return;
  const operation = beginMakerChainOperation();
  clearMakerPublishError();
  state.publishing = true;
  state.makerReleaseInFlight = true;
  renderAll();
  try {
    let review = null;
    const recovered = await withBrowserUploadLock(operation.recoveryKey, async () => {
      await syncLatestMakerUploadRecovery();
      if (!makerChainOperationIsActive(operation)) return null;
      const session = state.makerUploadSession;
      const context = captureMakerUploadPersistenceContext(session);
      const intent = normalizedMakerPublicationIntent(state.makerPublicationIntent);
      if (!session?.checkpoint || !context || !intent) return null;
      const guard = () => (
        makerChainOperationIsActive(operation)
        && makerUploadContextIsActive(session, context)
      );
      review = Object.freeze({
        session,
        context,
        intent,
        guard,
      });
      return recoverMakerPublicationIntent({ scheduleRetry: true, guard });
    });
    if (recovered || !review || !review.guard()) return;
    openConfirmation({
      title: t('clearPendingPublicationTitle'),
      message: t('clearPendingPublicationMessage'),
      confirmLabel: t('clearPendingPublicationConfirm'),
      action: async () => {
        if (!review.guard()) return;
        try {
          await withBrowserUploadLock(operation.recoveryKey, async () => {
            const recovery = await loadMakerUploadRecovery(operation.recoveryKey);
            if (
              !review.guard()
              || !recovery
              || recovery.uploadSessionId !== review.session.uploadSessionId
              || !sameMakerPublicationIntent(recovery.publicationIntent, review.intent)
            ) return;
            const verified = await saveVerifiedUploadRecovery(operation.recoveryKey, {
              ...recovery,
              recoveryRevision: Number(recovery.recoveryRevision || 0),
              publicationIntent: null,
            });
            if (!review.guard()) return;
            review.session.recoveryRevision = Number(verified.recoveryRevision || 0);
            if (makerPublicationRecoveryTimer) {
              clearTimeout(makerPublicationRecoveryTimer);
              makerPublicationRecoveryTimer = null;
            }
            state.makerPublicationIntent = null;
            state.publishStatus = '';
            clearMakerPublishError();
          });
        } catch (error) {
          if (review.guard()) throw error;
          console.warn('Pending Maker publication review stopped after context changed.', error);
          return;
        }
        if (review.guard()) {
          syncActiveMakerModelRefs();
          renderAll();
        }
      },
    });
  } catch (error) {
    if (makerChainOperationIsActive(operation)) {
      recordMakerPublishError(error, 'review', 'makerPublicationFailed');
    }
  } finally {
    if (makerChainOperationIsActive(operation)) {
      state.publishing = false;
      state.makerReleaseInFlight = false;
      renderAll();
    }
  }
}

async function updateMakerArchiveState(archived) {
  if (
    state.publishing
    || state.makerLifecycleActionBusy
    || !state.makerObjectId
    || !makerIsPublished()
  ) return;
  const operation = beginMakerChainOperation({ bindMakerObject: true });
  invalidateChainMakerDiscovery();
  let transaction = null;
  state.makerLifecycleActionBusy = true;
  setLocalizedPublishStatus('makerAuthorityChecking');
  renderAll();
  try {
    const authority = await refreshMakerLifecycleAuthority(operation);
    if (!makerChainOperationIsActive(operation)) return;
    if (authority.archived === archived) {
      setLocalizedPublishStatus(
        archived
          ? 'makerLifecycleArchived'
          : authority.mintingEnabled
            ? 'makerLifecycleActive'
            : 'makerLifecyclePaused',
      );
      syncTemplateFields();
      persistLocalMakerIndex();
      await persistActiveMakerLifecycleBinding();
      return;
    }
    setLocalizedPublishStatus(archived ? 'archiveWaiting' : 'restoreWaiting');
    renderAll();
    transaction = await setMakerArchived(
      authority.makerObjectId,
      authority.makerAdminCapObjectId,
      archived,
    );
    if (!makerChainOperationIsActive(operation)) return;
    const pausedEconomics = activePausedEconomicsSnapshot();
    if (pausedEconomics) {
      setActivePausedEconomicsSnapshot(pausedEconomicsWithMutationWitness(
        pausedEconomics,
        {
          digest: transaction.digest,
          kind: archived ? 'archive' : 'restore',
          expectedMintingEnabled: false,
          expectedArchived: archived,
        },
      ));
      await persistActiveMakerLifecycleBinding({ required: true });
      if (!makerChainOperationIsActive(operation)) return;
    }
    let confirmed;
    try {
      confirmed = await refreshMakerLifecycleAuthorityAfterWrite(operation, {
        matches: (candidate) => candidate.archived === archived,
      });
    } catch (error) {
      if (!makerChainOperationIsActive(operation)) return;
      setLocalizedPublishStatus('makerStateReadbackPending', { digest: transaction.digest });
      return;
    }
    if (confirmed.archived !== archived) {
      setLocalizedPublishStatus('makerStateReadbackPending', { digest: transaction.digest });
      return;
    }
    setLocalizedPublishStatus(archived ? 'archivedOnNetwork' : 'restoredOnNetwork', {
      network: runtimeConfig.network,
      digest: transaction.digest,
    });
    syncTemplateFields();
    persistLocalMakerIndex();
    await persistActiveMakerLifecycleBinding();
  } catch (error) {
    if (makerChainOperationIsActive(operation)) {
      state.publishStatusI18n = null;
      state.publishStatus = ['MAKER_CONTEXT_CHANGED', 'MAKER_ADMIN_CAP_NOT_OWNED'].includes(error?.code)
        ? error.message
        : state.locale === 'en' && error?.message
          ? error.message
          : t(archived ? 'archiveMakerFailed' : 'restoreMakerFailed');
    }
  } finally {
    if (makerChainOperationIsActive(operation)) {
      state.makerLifecycleActionBusy = false;
      reloadChainMakerDiscoveryAfterOperation(operation);
      renderAll();
    }
  }
}

async function updateMakerSoulAuthorizationState(mintingEnabled) {
  if (
    state.publishing
    || state.makerLifecycleActionBusy
    || !state.makerObjectId
    || !makerIsPublished()
  ) return false;
  const operation = beginMakerChainOperation({ bindMakerObject: true });
  invalidateChainMakerDiscovery();
  let transaction = null;
  state.makerLifecycleActionBusy = true;
  setLocalizedPublishStatus('makerAuthorityChecking');
  if ($('makerEconomicsStatus')) $('makerEconomicsStatus').textContent = state.publishStatus;
  renderAll();
  try {
    const authority = await refreshMakerLifecycleAuthority(operation);
    if (!makerChainOperationIsActive(operation)) return false;
    if (authority.mintingEnabled === mintingEnabled) {
      const pendingPause = mintingEnabled
        ? activePausedEconomicsSnapshot()?.pendingMutation
        : null;
      if (pendingPause?.expectedMintingEnabled === false) {
        setLocalizedPublishStatus('makerStateReadbackPending', {
          digest: pendingPause.digest,
        });
        return false;
      }
      if (mintingEnabled && activePausedEconomicsSnapshot()) {
        setActivePausedEconomicsSnapshot(null);
      }
      setLocalizedPublishStatus(mintingEnabled ? 'makerLifecycleActive' : 'makerLifecyclePaused');
      syncTemplateFields();
      persistLocalMakerIndex();
      await persistActiveMakerLifecycleBinding();
      return true;
    }
    let pausedEconomics = mintingEnabled
      ? activePausedEconomicsSnapshot()
      : null;
    if (!mintingEnabled) {
      pausedEconomics = setActivePausedEconomicsSnapshot({
        makerObjectId: authority.makerObjectId,
        mintFeeEnabled: authority.mintFeeEnabled,
        mintPriceAtomic: authority.mintPriceAtomic,
        royaltyBps: authority.royaltyBps,
        makerUpdatedAtMs: authority.makerUpdatedAtMs,
        capturedAt: new Date().toISOString(),
      });
      await persistActiveMakerLifecycleBinding({ required: true });
      if (!makerChainOperationIsActive(operation)) return false;
      if (!pausedEconomics) {
        throw makerAuthorityError(
          'MAKER_ECONOMICS_SNAPSHOT_SAVE_FAILED',
          'makerLifecycleEconomicsSnapshotSaveFailed',
        );
      }
    }
    const mintFeeEnabled = mintingEnabled
      ? Boolean(pausedEconomics?.mintFeeEnabled)
      : false;
    const mintPriceAtomic = mintingEnabled
      ? Number(pausedEconomics?.mintPriceAtomic || 0)
      : 0;
    // Pausing never clears royalty on-chain. Resume only restores the fee
    // fields; the freshly read chain royalty remains authoritative in case it
    // was deliberately changed while the Maker was paused.
    const royaltyBps = authority.royaltyBps;
    setLocalizedPublishStatus('adminSignatureWaiting');
    if ($('makerEconomicsStatus')) $('makerEconomicsStatus').textContent = state.publishStatus;
    renderMakerLifecycleManager();
    transaction = await configureMakerEconomics({
      makerId: authority.makerObjectId,
      adminCapId: authority.makerAdminCapObjectId,
      mintingEnabled,
      mintFeeEnabled,
      mintPriceAtomic,
      royaltyBps,
    });
    if (!makerChainOperationIsActive(operation)) return false;
    if (!mintingEnabled) {
      pausedEconomics = pausedEconomicsWithMutationWitness(
        pausedEconomics,
        {
          digest: transaction.digest,
          kind: 'pause',
          expectedMintingEnabled: false,
          expectedArchived: authority.archived,
        },
      );
      setActivePausedEconomicsSnapshot(pausedEconomics);
      await persistActiveMakerLifecycleBinding({ required: true });
      if (!makerChainOperationIsActive(operation)) return false;
    }
    let confirmed;
    try {
      confirmed = await refreshMakerLifecycleAuthorityAfterWrite(operation, {
        matches: (candidate) => (
          candidate.mintingEnabled === mintingEnabled
          && candidate.mintFeeEnabled === mintFeeEnabled
          && Number(candidate.mintPriceAtomic || 0) === Number(mintPriceAtomic || 0)
          && Number(candidate.royaltyBps || 0) === Number(royaltyBps || 0)
        ),
      });
    } catch (error) {
      if (!makerChainOperationIsActive(operation)) return false;
      setLocalizedPublishStatus('makerStateReadbackPending', { digest: transaction.digest });
      return false;
    }
    if (
      confirmed.mintingEnabled !== mintingEnabled
      || confirmed.mintFeeEnabled !== mintFeeEnabled
      || Number(confirmed.mintPriceAtomic || 0) !== Number(mintPriceAtomic || 0)
      || Number(confirmed.royaltyBps || 0) !== Number(royaltyBps || 0)
    ) {
      setLocalizedPublishStatus('makerStateReadbackPending', { digest: transaction.digest });
      return false;
    }
    if (mintingEnabled) {
      setActivePausedEconomicsSnapshot(null);
    } else {
      pausedEconomics = {
        ...pausedEconomics,
        makerUpdatedAtMs: confirmed.makerUpdatedAtMs,
        pendingMutation: null,
      };
      setActivePausedEconomicsSnapshot(pausedEconomics);
    }
    setLocalizedPublishStatus('onchainSettingsUpdated', { digest: transaction.digest });
    syncTemplateFields();
    persistLocalMakerIndex();
    await persistActiveMakerLifecycleBinding();
    return true;
  } catch (error) {
    if (makerChainOperationIsActive(operation)) {
      state.publishStatusI18n = null;
      state.publishStatus = [
        'MAKER_CONTEXT_CHANGED',
        'MAKER_ADMIN_CAP_NOT_OWNED',
        'MAKER_ECONOMICS_SNAPSHOT_SAVE_FAILED',
      ].includes(error?.code)
        ? error.message
        : state.locale === 'en' && error?.message
          ? error.message
          : t('onchainSettingsFailed');
    }
    return false;
  } finally {
    if (makerChainOperationIsActive(operation)) {
      state.makerLifecycleActionBusy = false;
      reloadChainMakerDiscoveryAfterOperation(operation);
      if ($('makerEconomicsStatus')) $('makerEconomicsStatus').textContent = state.publishStatus;
      renderAll();
    }
  }
}

async function updateHistoricalMakerArchiveState(makerObjectId, archived) {
  if (
    state.publishing
    || state.makerLifecycleActionBusy
    || !makerObjectId
    || !makerIsPublished()
  ) return false;
  if (comparableSuiId(makerObjectId) === comparableSuiId(state.makerObjectId)) {
    await updateMakerArchiveState(archived);
    return true;
  }
  const operation = beginPublishedMakerVersionOperation(makerObjectId);
  invalidateChainMakerDiscovery();
  let transaction = null;
  state.makerLifecycleActionBusy = true;
  setLocalizedPublishStatus('makerAuthorityChecking');
  renderAll();
  try {
    const authority = await refreshPublishedMakerVersionAuthority(operation);
    if (!publishedMakerVersionOperationIsActive(operation)) return false;
    if (authority.archived === archived) {
      setLocalizedPublishStatus(
        archived
          ? 'makerLifecycleArchived'
          : authority.mintingEnabled
            ? 'makerLifecycleActive'
            : 'makerLifecyclePaused',
      );
      await persistActiveMakerLifecycleBinding();
      return true;
    }
    setLocalizedPublishStatus(archived ? 'archiveWaiting' : 'restoreWaiting');
    renderMakerLifecycleManager();
    transaction = await setMakerArchived(
      authority.makerObjectId,
      authority.makerAdminCapObjectId,
      archived,
    );
    if (!publishedMakerVersionOperationIsActive(operation)) return false;
    const existing = publishedMakerVersionHistory().find((entry) => (
      comparableSuiId(entry.makerObjectId) === comparableSuiId(makerObjectId)
    ));
    const pausedEconomics = normalizedWorkspacePausedEconomics(
      existing?.pausedEconomics,
      authority.makerObjectId,
    );
    if (pausedEconomics) {
      updatePublishedMakerVersionRecord(makerObjectId, {
        pausedEconomics: pausedEconomicsWithMutationWitness(
          pausedEconomics,
          {
            digest: transaction.digest,
            kind: archived ? 'archive' : 'restore',
            expectedMintingEnabled: false,
            expectedArchived: archived,
          },
        ),
      });
      await persistActiveMakerLifecycleBinding({ required: true });
      if (!publishedMakerVersionOperationIsActive(operation)) return false;
    }
    try {
      await refreshPublishedMakerVersionAuthorityAfterWrite(operation, {
        matches: (candidate) => candidate.archived === archived,
      });
    } catch {
      if (!publishedMakerVersionOperationIsActive(operation)) return false;
      setLocalizedPublishStatus('makerStateReadbackPending', {
        digest: transaction.digest,
      });
      return false;
    }
    setLocalizedPublishStatus(archived ? 'archivedOnNetwork' : 'restoredOnNetwork', {
      network: runtimeConfig.network,
      digest: transaction.digest,
    });
    await persistActiveMakerLifecycleBinding();
    return true;
  } catch (error) {
    if (publishedMakerVersionOperationIsActive(operation)) {
      state.publishStatusI18n = null;
      state.publishStatus = ['MAKER_CONTEXT_CHANGED', 'MAKER_ADMIN_CAP_NOT_OWNED'].includes(error?.code)
        ? error.message
        : state.locale === 'en' && error?.message
          ? error.message
          : t(archived ? 'archiveMakerFailed' : 'restoreMakerFailed');
    }
    return false;
  } finally {
    if (publishedMakerVersionOperationIsActive(operation)) {
      state.makerLifecycleActionBusy = false;
      reloadChainMakerDiscoveryAfterOperation(operation);
      renderAll();
    }
  }
}

async function updateHistoricalMakerAuthorizationState(makerObjectId, mintingEnabled) {
  if (
    state.publishing
    || state.makerLifecycleActionBusy
    || !makerObjectId
    || !makerIsPublished()
  ) return false;
  if (comparableSuiId(makerObjectId) === comparableSuiId(state.makerObjectId)) {
    return updateMakerSoulAuthorizationState(mintingEnabled);
  }
  const operation = beginPublishedMakerVersionOperation(makerObjectId);
  invalidateChainMakerDiscovery();
  let transaction = null;
  state.makerLifecycleActionBusy = true;
  setLocalizedPublishStatus('makerAuthorityChecking');
  renderAll();
  try {
    const authority = await refreshPublishedMakerVersionAuthority(operation);
    if (!publishedMakerVersionOperationIsActive(operation)) return false;
    const existing = publishedMakerVersionHistory().find((entry) => (
      comparableSuiId(entry.makerObjectId) === comparableSuiId(makerObjectId)
    ));
    if (authority.mintingEnabled === mintingEnabled) {
      const pendingPause = mintingEnabled
        ? normalizedWorkspacePausedEconomics(
            existing?.pausedEconomics,
            authority.makerObjectId,
          )?.pendingMutation
        : null;
      if (pendingPause?.expectedMintingEnabled === false) {
        setLocalizedPublishStatus('makerStateReadbackPending', {
          digest: pendingPause.digest,
        });
        return false;
      }
      if (mintingEnabled) {
        updatePublishedMakerVersionRecord(makerObjectId, {
          ...authority,
          pausedEconomics: null,
        });
      }
      setLocalizedPublishStatus(
        mintingEnabled ? 'makerLifecycleActive' : 'makerLifecyclePaused',
      );
      await persistActiveMakerLifecycleBinding();
      return true;
    }
    let pausedEconomics = mintingEnabled
      ? normalizedWorkspacePausedEconomics(
          existing?.pausedEconomics,
          authority.makerObjectId,
        )
      : null;
    if (!mintingEnabled) {
      pausedEconomics = normalizedWorkspacePausedEconomics({
        makerObjectId: authority.makerObjectId,
        mintFeeEnabled: authority.mintFeeEnabled,
        mintPriceAtomic: authority.mintPriceAtomic,
        royaltyBps: authority.royaltyBps,
        makerUpdatedAtMs: authority.makerUpdatedAtMs,
        capturedAt: new Date().toISOString(),
      }, authority.makerObjectId);
      updatePublishedMakerVersionRecord(makerObjectId, {
        ...authority,
        pausedEconomics,
      });
      await persistActiveMakerLifecycleBinding({ required: true });
      if (!publishedMakerVersionOperationIsActive(operation)) return false;
    }
    const mintFeeEnabled = mintingEnabled
      ? Boolean(pausedEconomics?.mintFeeEnabled)
      : false;
    const mintPriceAtomic = mintingEnabled
      ? Number(pausedEconomics?.mintPriceAtomic || 0)
      : 0;
    const royaltyBps = authority.royaltyBps;
    setLocalizedPublishStatus('adminSignatureWaiting');
    renderMakerLifecycleManager();
    transaction = await configureMakerEconomics({
      makerId: authority.makerObjectId,
      adminCapId: authority.makerAdminCapObjectId,
      mintingEnabled,
      mintFeeEnabled,
      mintPriceAtomic,
      royaltyBps,
    });
    if (!publishedMakerVersionOperationIsActive(operation)) return false;
    if (!mintingEnabled) {
      pausedEconomics = pausedEconomicsWithMutationWitness(
        pausedEconomics,
        {
          digest: transaction.digest,
          kind: 'pause',
          expectedMintingEnabled: false,
          expectedArchived: authority.archived,
        },
      );
      updatePublishedMakerVersionRecord(makerObjectId, {
        pausedEconomics,
      });
      await persistActiveMakerLifecycleBinding({ required: true });
      if (!publishedMakerVersionOperationIsActive(operation)) return false;
    }
    let confirmed;
    try {
      confirmed = await refreshPublishedMakerVersionAuthorityAfterWrite(operation, {
        matches: (candidate) => (
          candidate.mintingEnabled === mintingEnabled
          && candidate.mintFeeEnabled === mintFeeEnabled
          && Number(candidate.mintPriceAtomic || 0) === Number(mintPriceAtomic || 0)
          && Number(candidate.royaltyBps || 0) === Number(royaltyBps || 0)
        ),
      });
    } catch {
      if (!publishedMakerVersionOperationIsActive(operation)) return false;
      setLocalizedPublishStatus('makerStateReadbackPending', {
        digest: transaction.digest,
      });
      return false;
    }
    updatePublishedMakerVersionRecord(makerObjectId, {
      ...confirmed,
      pausedEconomics: mintingEnabled
        ? null
        : {
            ...pausedEconomics,
            makerUpdatedAtMs: confirmed.makerUpdatedAtMs,
            pendingMutation: null,
          },
    });
    setLocalizedPublishStatus('onchainSettingsUpdated', {
      digest: transaction.digest,
    });
    await persistActiveMakerLifecycleBinding();
    return true;
  } catch (error) {
    if (publishedMakerVersionOperationIsActive(operation)) {
      state.publishStatusI18n = null;
      state.publishStatus = [
        'MAKER_CONTEXT_CHANGED',
        'MAKER_ADMIN_CAP_NOT_OWNED',
        'MAKER_ECONOMICS_SNAPSHOT_SAVE_FAILED',
      ].includes(error?.code)
        ? error.message
        : state.locale === 'en' && error?.message
          ? error.message
          : t('onchainSettingsFailed');
    }
    return false;
  } finally {
    if (publishedMakerVersionOperationIsActive(operation)) {
      state.makerLifecycleActionBusy = false;
      reloadChainMakerDiscoveryAfterOperation(operation);
      renderAll();
    }
  }
}

async function prepareOcUpload() {
  if (state.minting) return;
  if (!canonicalSoulMintEnabled) {
    state.mintStatus = t('canonicalMintGateClosed');
    renderMintAction();
    return;
  }
  const operation = beginOcChainOperation();
  clearOcPublishError();
  state.minting = true;
  state.mintDigest = '';
  state.mintStatus = t('ocRenderingQuilt');
  renderMintAction();
  try {
    await withBrowserUploadLock(operation.recoveryKey, async () => {
      const restoredNewer = await syncLatestOcUploadRecovery();
      if (!ocChainOperationIsActive(operation)) return;
      if (restoredNewer && state.ocUploadStage !== 'idle') return;
      if (state.ocUploadSession?.checkpoint && state.ocUploadStage !== 'idle') {
        await persistOcUploadRecovery();
        if (!ocChainOperationIsActive(operation)) return;
        state.mintStatus = t('ocRecoveryRestored');
        return;
      }
      const issues = ocRecipeIssues();
      if (issues.length) throw new Error(issues[0]);
      const useV4 = isMakerV4Document(state.makerDocumentV4);
      const completion = useV4
        && state.playerCompletionSnapshotV4?.makerVersionId === state.makerDocumentV4.version.versionId
        ? state.playerCompletionSnapshotV4
        : null;
      if (
        useV4
        && (
          !completion?.imageBlob
          || completion.imageBlob.type !== 'image/png'
          || completion.imageBlob.size <= 0
        )
      ) {
        const error = new Error(t('completeOcBeforePublishing'));
        error.code = 'OC_COMPLETION_REQUIRED';
        throw error;
      }
      // For Maker v5, upload the exact PNG reviewed in the final Player
      // preview. Re-rendering here could silently change size or transparency.
      const image = useV4 ? completion.imageBlob : await renderOcImageBlob();
      if (!ocChainOperationIsActive(operation)) return;
      const createdAt = new Date().toISOString();
      let oc;
      let recipeJson;
      let chainRecipe;
      let v4Bundle = null;
      if (useV4) {
        v4Bundle = currentMakerV4OcBundle({ createdAt, requireCompletion: true });
        chainRecipe = v4Bundle.suiRecipe;
        recipeJson = v4Bundle.fullRecipeJson;
      } else {
        oc = ocPackage();
        recipeJson = JSON.stringify(oc.recipe);
        chainRecipe = oc.recipe.map((slot) => ({
          partKey: slot.slot,
          itemKey: slot.part,
          colorHex: slot.color,
          renderOrder: slot.renderOrder,
        }));
      }
      const recipeHash = await hashRecipe(chainRecipe);
      if (!ocChainOperationIsActive(operation)) return;
      const integrity = {
        recipeEncoding: 'BCS vector<RecipeSlot>',
        recipeHashAlgorithm: 'SHA-256',
        recipeHash: bytesToHex(recipeHash),
      };
      let profile;
      if (useV4) {
        v4Bundle = currentMakerV4OcBundle({ createdAt, integrity, requireCompletion: true });
        oc = v4Bundle.package;
        recipeJson = v4Bundle.fullRecipeJson;
        const entries = buildMakerV4OcUploadEntries(image, v4Bundle);
        profile = entries[1].blob;
      } else {
        oc.integrity = integrity;
        profile = new Blob([JSON.stringify(oc)], { type: 'application/json' });
      }
      state.pendingOcPackage = oc;
      state.pendingOcImageBlob = image;
      state.pendingOcProfileBlob = profile;
      state.pendingOcRecipeJson = recipeJson;
      state.pendingOcRecipeHash = recipeHash;
      state.pendingOcFingerprint = ocFingerprint(oc);
      const uploadSession = await prepareWalrusUpload(ocUploadEntries());
      if (!ocChainOperationIsActive(operation)) return;
      state.ocUploadSession = uploadSession;
      state.ocUploadStage = uploadSession.stage;
      state.mintStatus = t('ocQuiltEncoded');
      await persistOcUploadRecovery();
    });
  } catch (error) {
    if (ocChainOperationIsActive(operation)) {
      recordOcPublishError(error, 'prepare', 'ocQuiltPrepareFailed');
    }
  } finally {
    if (ocChainOperationIsActive(operation)) {
      state.minting = false;
      renderMintAction();
    }
  }
}

async function registerOcUpload() {
  if (state.minting) return;
  if (!canonicalSoulMintEnabled) {
    state.mintStatus = t('canonicalMintGateClosed');
    renderMintAction();
    return;
  }
  const operation = beginOcChainOperation();
  const retryingAdvancedCheckpoint = state.ocPublishError?.action === 'register'
    && ['uploaded', 'certified'].includes(state.ocUploadStage);
  clearOcPublishError();
  state.minting = true;
  state.mintStatus = t('ocWaitingUpload');
  renderMintAction();
  try {
    await withBrowserUploadLock(operation.recoveryKey, async () => {
      await syncLatestOcUploadRecovery();
      if (!ocChainOperationIsActive(operation)) return;
      if (![
        'encoded',
        'register-pending',
        'registered',
        ...(retryingAdvancedCheckpoint ? ['uploaded', 'certified'] : []),
      ].includes(state.ocUploadSession?.stage)) return;
      const session = state.ocUploadSession;
      const persistenceContext = captureOcUploadPersistenceContext(session);
      await registerAndUploadWalrus(session, {
        onCheckpoint: ocUploadCheckpointHandler(session, persistenceContext),
      });
      await persistOcUploadRecovery(session, persistenceContext);
      if (!ocChainOperationIsActive(operation)) return;
      state.ocUploadStage = session.stage;
      if (state.ocUploadStage === 'certified') {
        if (session.files.length !== 2) throw new Error(t('ocUnexpectedQuilt'));
        state.ocImagePatchId = session.files[0].id;
        state.ocProfilePatchId = session.files[1].id;
        state.mintStatus = t('ocRecoveredCertified');
      } else {
        state.mintStatus = t('ocUploadedCertify');
      }
    });
  } catch (error) {
    if (ocChainOperationIsActive(operation)) {
      state.ocUploadStage = state.ocUploadSession?.stage || state.ocUploadStage;
      recordOcPublishError(error, 'register', 'ocUploadFailed');
    }
  } finally {
    if (ocChainOperationIsActive(operation)) {
      state.minting = false;
      renderMintAction();
    }
  }
}

async function certifyOcUpload() {
  if (state.minting) return;
  if (!canonicalSoulMintEnabled) {
    state.mintStatus = t('canonicalMintGateClosed');
    renderMintAction();
    return;
  }
  const operation = beginOcChainOperation();
  const recheckingCertificationVisibility = state.ocPublishError?.code === 'WALRUS_CERTIFICATION_NOT_VISIBLE';
  const retryingCertifiedCheckpoint = state.ocPublishError?.action === 'certify'
    && state.ocUploadStage === 'certified';
  clearOcPublishError();
  state.minting = true;
  state.mintStatus = t(recheckingCertificationVisibility ? 'ocCertificationSyncing' : 'ocWaitingCertification');
  renderMintAction();
  try {
    await withBrowserUploadLock(operation.recoveryKey, async () => {
      await syncLatestOcUploadRecovery();
      if (!ocChainOperationIsActive(operation)) return;
      if (![
        'uploaded',
        'certify-pending',
        ...(retryingCertifiedCheckpoint ? ['certified'] : []),
      ].includes(state.ocUploadSession?.stage)) return;
      const session = state.ocUploadSession;
      const persistenceContext = captureOcUploadPersistenceContext(session);
      await certifyWalrusUpload(session, {
        onCheckpoint: ocUploadCheckpointHandler(session, persistenceContext),
      });
      await persistOcUploadRecovery(session, persistenceContext);
      if (!ocChainOperationIsActive(operation)) return;
      if (session.files.length !== 2) throw new Error(t('ocUnexpectedQuilt'));
      state.ocImagePatchId = session.files[0].id;
      state.ocProfilePatchId = session.files[1].id;
      state.ocUploadStage = 'certified';
      state.mintStatus = t('ocFilesCertified');
    });
  } catch (error) {
    if (ocChainOperationIsActive(operation)) {
      const classified = recordOcPublishError(error, 'certify', 'ocCertificationFailed');
      if (classified.code === 'WALRUS_CERTIFICATION_NOT_VISIBLE') {
        state.mintStatus = t('ocCertificationSyncing');
      }
    }
  } finally {
    if (ocChainOperationIsActive(operation)) {
      state.minting = false;
      renderMintAction();
    }
  }
}

async function mintCurrentOc() {
  if (state.minting || state.ocUploadStage !== 'certified') return;
  clearOcPublishError();
  state.minting = true;
  state.mintStatus = t('soulHandoffPreparing');
  renderMintAction();
  try {
    if (!canonicalSoulMintEnabled) throw new Error(t('canonicalMintDisabled'));
    if (
      !state.pendingOcPackage
      || ocFingerprint(state.pendingOcPackage) !== state.pendingOcFingerprint
    ) {
      state.ocUploadSession = null;
      state.ocUploadStage = 'idle';
      state.ocImagePatchId = '';
      state.ocProfilePatchId = '';
      await clearOcUploadRecovery();
      throw new Error(t('ocChangedAfterUpload'));
    }
    const oc = state.pendingOcPackage;
    const certifiedLivingContent = certifiedLivingContentSource(oc);
    const certifiedMakerId = oc.maker?.makerObjectId || activeMakerObjectId();
    const certifiedRecipeHash = String(oc.integrity?.recipeHash || bytesToHex(state.pendingOcRecipeHash));
    if (certifiedRecipeHash !== bytesToHex(state.pendingOcRecipeHash)) {
      throw new Error(t('ocChangedAfterUpload'));
    }
    const imageUrl = walrusFileUrl(state.ocImagePatchId);
    const profileUrl = walrusFileUrl(state.ocProfilePatchId);
    const handoffUrl = soulidityAppLink(runtimeConfig.soulidityIntegrationPath, {
      maker: certifiedMakerId,
      profile: profileUrl,
      image: imageUrl,
      profileBlob: state.ocProfilePatchId,
      imageBlob: state.ocImagePatchId,
      recipeHash: certifiedRecipeHash,
    });
    window.open(handoffUrl, '_blank', 'noopener,noreferrer');

    const importJson = createSoulidityImportJson(certifiedLivingContent, {
      maker: oc.maker || activeTemplate(),
      makerId: certifiedMakerId,
      profile: oc.profile,
      imageUrl,
      profileUrl,
      recipeHash: certifiedRecipeHash,
    });
    const imageBytes = new Uint8Array(await state.pendingOcImageBlob.arrayBuffer());
    const { bytes } = createSoulidityImportBundle(certifiedLivingContent, {
      maker: oc.maker || activeTemplate(),
      makerId: certifiedMakerId,
      profile: oc.profile,
      imageUrl,
      profileUrl,
      recipeHash: certifiedRecipeHash,
      importJson,
      imageBytes,
    });
    download(`${slug(oc.profile.name)}-animacraft-soul-handoff.zip`, bytes, 'application/zip');
    state.mintStatus = t('soulHandoffComplete');
  } catch (error) {
    console.error('Soulidity handoff failed', error);
    recordOcPublishError(error, 'onchain', 'soulHandoffFailed');
  } finally {
    state.minting = false;
    renderMintAction();
  }
}

async function restoreMakerDraft(templateId = state.templateId) {
  const requestedTemplate = templates.find((template) => template.id === templateId);
  if (requestedTemplate?.source === 'local' || isMakerV4Document(makerModels.get(templateId)?.makerDocumentV4)) {
    return;
  }
  const storageKey = makerDraftStorageKey(templateId);
  loadedMakerDrafts.add(storageKey);
  try {
    let draft = await loadMakerDraftRecord(storageKey);
    if (!draft) {
      const raw = localStorage.getItem(storageKey)
        // The unscoped v1 key belonged only to the original Daily starter.
        // Never import it into a newly-created wallet draft just because that
        // draft happens to be the active template during asynchronous restore.
        || (templateId === 'daily-starlit' ? localStorage.getItem('animacraft-maker-draft-v1') : null);
      if (!raw) return;
      draft = JSON.parse(raw);
      await saveMakerDraftRecord(storageKey, draft);
      localStorage.removeItem(storageKey);
      if (templateId === state.templateId) localStorage.removeItem('animacraft-maker-draft-v1');
    }
    if (state.templateId !== templateId || (draft.templateId && draft.templateId !== templateId)) return;
    // Maker v5 has one authoritative repository. Never let the legacy shell
    // restore an older v5 snapshot over the Workspace draft.
    if (isMakerV4Document(draft.manifest)) return;
    let restoredV4 = false;
    if (!restoredV4 && draft.visual && typeof draft.visual === 'object') {
      const restoredVisual = structuredClone(draft.visual);
      restoredVisual.palette = Object.fromEntries(Object.entries(restoredVisual.palette || {}).map(([key, value]) => [key, safeCssColor(value)]));
      state.visual = restoredVisual;
    }
    if (!restoredV4 && Array.isArray(draft.rules)) state.rules = draft.rules.slice(0, MAX_MAKER_RULES).filter((rule) => rule && typeof rule === 'object');
    if (!restoredV4 && Array.isArray(draft.paletteLinks)) state.paletteLinks = draft.paletteLinks.slice(0, MAX_MAKER_RULES).filter((link) => link && typeof link === 'object');
    if (!restoredV4 && Array.isArray(draft.manifest?.parts)) {
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

function currentMakerV4Source() {
  return isMakerV4Document(state.makerDocumentV4) ? state.makerDocumentV4 : null;
}

function currentV4RuntimeAssets() {
  const assets = [];
  if (state.makerRuntimeAssetsV4 instanceof Map) assets.push(...state.makerRuntimeAssetsV4.values());
  state.assets.forEach((asset) => assets.push({
    ...asset,
    assetId: asset.assetId || asset.id || asset.identifier,
    blob: asset.blob || asset.file,
  }));
  return assets.filter((asset, index) => {
    const key = asset.assetId || asset.identifier || asset.id;
    return key && assets.findIndex((candidate) => (candidate.assetId || candidate.identifier || candidate.id) === key) === index;
  });
}

function v4ProfileFromLegacy() {
  return state.playerProfileV4 || {
    name: $('profileName')?.value || 'Untitled OC',
    world: $('profileWorld')?.value || activeTemplate().style || '',
    description: $('profileDescription')?.value || '',
    tags: $('profileTags')?.value || '',
  };
}

function syncLegacyVisualFromV4(document, recipe) {
  if (!document || !recipe) return;
  const selections = new Map((recipe.selections || []).map((selection) => [selection.partId, selection]));
  document.parts.forEach((part) => {
    const selection = selections.get(part.id);
    if (!selection) {
      state.visual[part.id] = '';
      return;
    }
    const flattenedId = `${selection.itemId}--${selection.styleId}`;
    state.visual[part.id] = slotItems(part.id).some((item) => item.id === flattenedId)
      ? flattenedId
      : selection.itemId;
  });
  (recipe.colors || []).forEach((selection) => {
    const channel = document.colorChannels.find((candidate) => candidate.id === selection.channelId);
    const swatch = channel?.swatches.find((candidate) => candidate.id === selection.swatchId);
    const linkedParts = document.parts.filter((part) => part.items.some((item) => (item.styles || []).some((style) => style.colorChannelId === channel?.id)));
    linkedParts.forEach((part) => {
      const legacySlot = allSlots().find((slot) => slot.key === part.id);
      state.visual.palette[legacySlot?.colorKey || part.id] = swatch?.hintColor || '#7b5cff';
    });
  });
}

function makerV4WorkspaceCoverUrl(document, assets, template = null) {
  const coverAssetId = String(document?.metadata?.coverAssetId || '');
  if (!coverAssetId) {
    if (template) revokeLocalMakerCoverObjectUrl(template.id);
    return '';
  }
  const runtimeAssets = assets instanceof Map ? assets : new Map();
  const record = runtimeAssets.get(coverAssetId);
  const descriptor = makerV4AssetDescriptor(document, coverAssetId);
  const blob = makerV4RuntimeAssetSource(record);
  if (blob && template) return localMakerCoverObjectUrl(template, coverAssetId, blob);
  const stableUrl = stableMakerCoverUrl(
    record?.url
    || record?.thumbnailUrl
    || descriptor?.url
    || descriptor?.legacy?.url
    || '',
  );
  if (template) {
    const existing = localMakerCoverObjectUrls.get(template.id);
    if (!stableUrl && existing?.assetId === coverAssetId) return existing.url;
    revokeLocalMakerCoverObjectUrl(template.id);
    template.coverUrl = stableUrl;
  }
  return stableUrl;
}

function makerV4WorkspaceLicenseLabel(kind, fallback = 'Personal use') {
  return {
    'personal-use': 'Personal use',
    'free-remix': 'Free remix',
    'paid-commercial': 'Paid commercial',
    'exclusive-commission': 'Exclusive commission',
  }[kind] || fallback;
}

function applyWorkspacePersistenceBinding({
  template,
  model,
  metadata,
  rootMakerId,
  active = false,
}) {
  const chainBinding = normalizedWorkspaceChainBinding(metadata, {
    owner: state.walletAddress,
    rootMakerId,
  });
  const publishedSnapshot = normalizedWorkspacePublishedSnapshot(
    metadata,
    rootMakerId,
  );
  if (publishedSnapshot && model) {
    model.publishedMakerDocumentV4 = publishedSnapshot.document;
    model.publishedMakerRecipeV4 = publishedSnapshot.recipe;
  }
  if (chainBinding && template && model) {
    Object.assign(template, {
      source: 'chain',
      owner: template.owner || state.walletAddress,
      owned: true,
      objectId: chainBinding.makerObjectId,
      treasuryId: chainBinding.makerTreasuryObjectId,
      adminCapId: chainBinding.makerAdminCapObjectId,
      mintingEnabled: chainBinding.mintingEnabled,
      mintFeeEnabled: chainBinding.mintFeeEnabled,
      mintPriceAtomic: chainBinding.mintPriceAtomic,
      royaltyBps: chainBinding.royaltyBps,
      pausedEconomics: chainBinding.pausedEconomics,
      publishedVersions: chainBinding.publishedVersions,
      chainBindingPinned: true,
    });
    Object.assign(model, {
      publishDigest: chainBinding.publishDigest,
      makerObjectId: chainBinding.makerObjectId,
      makerTreasuryObjectId: chainBinding.makerTreasuryObjectId,
      makerAdminCapObjectId: chainBinding.makerAdminCapObjectId,
      makerArchived: chainBinding.archived,
      pausedEconomics: chainBinding.pausedEconomics,
      publishedMakerVersions: chainBinding.publishedVersions,
    });
  }
  if (active) {
    if (publishedSnapshot) {
      state.publishedMakerDocumentV4 = publishedSnapshot.document;
      state.publishedMakerRecipeV4 = publishedSnapshot.recipe;
    }
    if (chainBinding) {
      state.publishDigest = chainBinding.publishDigest;
      state.makerObjectId = chainBinding.makerObjectId;
      state.makerTreasuryObjectId = chainBinding.makerTreasuryObjectId;
      state.makerAdminCapObjectId = chainBinding.makerAdminCapObjectId;
      state.makerArchived = chainBinding.archived;
      state.publishedMakerVersions = structuredClone(chainBinding.publishedVersions || []);
    }
  }
  return { chainBinding, publishedSnapshot };
}

function syncV4WorkspaceState({
  makerKey = '',
  document,
  recipe,
  assets,
  profile = null,
  metadata = null,
}) {
  const rootMakerId = String(document?.version?.rootMakerId || '');
  const persistedBinding = normalizedWorkspaceChainBinding(metadata, {
    owner: state.walletAddress,
    rootMakerId,
  });
  const targetTemplate = templates.find((template) => (
    template.id === rootMakerId
    || template.objectId === rootMakerId
    || (
      persistedBinding
      && comparableSuiId(template.objectId) === comparableSuiId(persistedBinding.makerObjectId)
    )
  )) || null;
  const activeRootMakerId = currentMakerV4Source()?.version?.rootMakerId
    || activeTemplate()?.id
    || state.templateId;
  const activeMakerKey = `${state.walletAddress || 'wallet'}:${activeRootMakerId}`;
  const belongsToActiveMaker = makerKey
    ? makerKey === activeMakerKey
    : Boolean(targetTemplate && targetTemplate.id === state.templateId);

  if (!belongsToActiveMaker) {
    const targetModel = targetTemplate ? makerModels.get(targetTemplate.id) : null;
    if (!targetTemplate || !targetModel) return false;
    localMakerCoverRestoreTokens.delete(targetTemplate.id);
    const coverUrl = makerV4WorkspaceCoverUrl(document, assets, targetTemplate);
    if (document?.metadata) {
      Object.assign(targetTemplate, {
        name: document.metadata.name,
        summary: document.metadata.summary,
        creator: document.metadata.creator,
        style: document.metadata.style,
        license: makerV4WorkspaceLicenseLabel(document.metadata.license?.kind, targetTemplate.license),
        licenseNote: document.metadata.license?.note ?? targetTemplate.licenseNote,
        coverUrl,
      });
      const targetPublished = targetTemplate.source === 'chain'
        || Boolean(targetModel.publishDigest || targetModel.makerObjectId);
      if (!targetPublished) {
        Object.assign(targetTemplate, {
          royaltyBps: document.publication?.royaltyBps ?? targetTemplate.royaltyBps,
          mintingEnabled: document.publication?.mintingEnabled ?? targetTemplate.mintingEnabled,
          mintFeeEnabled: document.publication?.mintFeeEnabled ?? targetTemplate.mintFeeEnabled,
          mintPriceAtomic: document.publication?.mintPriceAtomic ?? targetTemplate.mintPriceAtomic,
        });
      }
    }
    Object.assign(targetModel, {
      makerDocumentV4: document,
      makerRecipeV4: recipe,
      makerRuntimeAssetsV4: assets instanceof Map ? assets : new Map(),
      canvas: document?.canvas
        ? { width: document.canvas.width, height: document.canvas.height }
        : targetModel.canvas,
      livingContent: document
        ? normalizeLivingContent(document.livingContent, document.metadata)
        : targetModel.livingContent,
    });
    applyWorkspacePersistenceBinding({
      template: targetTemplate,
      model: targetModel,
      metadata,
      rootMakerId,
    });
    if (targetTemplate.owner) persistLocalMakerIndex(targetTemplate.owner);
    return false;
  }

  state.makerDocumentV4 = document;
  state.makerRecipeV4 = recipe;
  state.makerRuntimeAssetsV4 = assets instanceof Map ? assets : new Map();
  if (state.playerRuntimeDocumentV4?.version?.versionId !== document?.version?.versionId) state.playerRuntimeDocumentV4 = null;
  if (profile) state.playerProfileV4 = { ...profile };
  const template = activeTemplate();
  localMakerCoverRestoreTokens.delete(template.id);
  const coverUrl = makerV4WorkspaceCoverUrl(document, assets, template);
  if (document?.metadata) {
    Object.assign(template, {
      name: document.metadata.name,
      summary: document.metadata.summary,
      creator: document.metadata.creator,
      style: document.metadata.style,
      license: makerV4WorkspaceLicenseLabel(document.metadata.license?.kind, template.license),
      licenseNote: document.metadata.license?.note ?? template.licenseNote,
      coverUrl,
    });
    if (!makerIsPublished()) {
      Object.assign(template, {
        royaltyBps: document.publication?.royaltyBps ?? template.royaltyBps,
        mintingEnabled: document.publication?.mintingEnabled ?? template.mintingEnabled,
        mintFeeEnabled: document.publication?.mintFeeEnabled ?? template.mintFeeEnabled,
        mintPriceAtomic: document.publication?.mintPriceAtomic ?? template.mintPriceAtomic,
      });
    }
    state.makerCanvas = { width: document.canvas.width, height: document.canvas.height };
    state.livingContent = normalizeLivingContent(document.livingContent, document.metadata);
    syncTemplateFields();
  }
  applyWorkspacePersistenceBinding({
    template,
    model: makerModels.get(template.id),
    metadata,
    rootMakerId,
    active: true,
  });
  syncLegacyVisualFromV4(document, recipe);
  syncActiveMakerModelRefs();
  persistLocalMakerIndex();
  return true;
}

function syncPlayerV4State({
  document,
  recipe,
  profile,
  livingContent = null,
  imageBlob = null,
  imageExport = null,
}, { completed = false } = {}) {
  state.playerRuntimeDocumentV4 = document;
  state.playerRecipeV4 = recipe;
  state.playerProfileV4 = { ...profile };
  state.playerCompletionSnapshotV4 = completed
    ? createPlayerCompletionSnapshot({
        document,
        recipe,
        profile,
        livingContent,
        imageBlob,
        imageExport,
      })
    : null;
  syncLegacyVisualFromV4(document, recipe);
  if ($('profileName')) $('profileName').value = profile.name || 'Untitled OC';
  if ($('profileWorld')) $('profileWorld').value = profile.world || '';
  if ($('profileDescription')) $('profileDescription').value = profile.description || '';
  if ($('profileTags')) $('profileTags').value = profile.tags || '';
  invalidateOcUpload();
}

function syncMakerWorkspaceContext({ replaceDocument = false } = {}) {
  if (!makerWorkspace) return Promise.resolve();
  const template = activeTemplate();
  const workingDocument = currentMakerV4Source();
  if (!workingDocument && template?.source !== 'local') {
    return makerWorkspace.setContext({ makerKey: '' });
  }
  const lifecycle = makerLifecycleDescriptor(template);
  const creatorPersistenceEnabled = templateIsOwnedByWallet(template);
  // A non-owner may play the immutable published Maker, but must never receive
  // another wallet's unpublished successor document in a Creator workspace.
  const document = creatorPersistenceEnabled
    ? workingDocument
    : isMakerV4Document(state.publishedMakerDocumentV4)
      ? state.publishedMakerDocumentV4
      : workingDocument;
  const recipe = creatorPersistenceEnabled
    ? state.makerRecipeV4 || document?.defaultRecipe
    : state.publishedMakerRecipeV4 || document?.defaultRecipe;
  const rootMakerId = document?.version?.rootMakerId || template.id || state.templateId;
  const makerKey = creatorPersistenceEnabled
    ? `${state.walletAddress}:${rootMakerId}`
    : `public:${rootMakerId}:${suiJsonId(template?.objectId) || document?.version?.versionId || 'draft'}`;
  return makerWorkspace.setContext({
    makerKey,
    walletAddress: state.walletAddress,
    creatorPersistenceEnabled,
    replaceDocument: creatorPersistenceEnabled && replaceDocument,
    name: template.name,
    creator: template.creator,
    rootMakerId,
    document,
    recipe,
    playerRecipe: state.playerRecipeV4 || document?.defaultRecipe,
    profile: v4ProfileFromLegacy(),
    assets: currentV4RuntimeAssets(),
    publishedDocument: state.publishedMakerDocumentV4,
    publishedRecipe: state.publishedMakerRecipeV4
      || state.publishedMakerDocumentV4?.defaultRecipe
      || null,
    chainBinding: creatorPersistenceEnabled
      ? currentWorkspaceChainBinding(document)
      : null,
    versionId: document?.version?.versionId,
    isPublished: makerIsPublished(),
    creatorPreview: state.previewingMaker,
    lifecycle: {
      id: lifecycle.id,
      label: t(lifecycle.labelKey),
      badgeClass: lifecycle.badgeClass,
      manageLabel: t('makerLifecycleManage'),
    },
    externalPublicationIssues: [
      ...(lifecycle.lineageFork
        ? [{
            code: 'external_version_lineage_fork',
            path: 'version.parentVersionId',
            message: makerVersionLineageForkMessage(lifecycle.lineageFork),
          }]
        : []),
      ...(lifecycle.versionConflict
        ? [{
          code: 'external_version_draft_conflict',
          path: 'version.parentVersionId',
          message: makerVersionDraftConflictMessage(
            lifecycle.versionConflict,
            document,
          ),
        }]
        : []),
    ],
  });
}

function renderAll() {
  makerWorkspace?.setLocale(state.locale, { render: false });
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
  renderDraftRecoveryCenter();
  renderCreatorDetails();
  void renderDocsHandbook();
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
  void syncMakerWorkspaceContext().catch((error) => {
    state.draftSaveStatus = 'error';
    state.draftSaveMessage = state.locale === 'en' && error?.message
      ? error.message
      : t('makerWorkspaceRestoreFailed');
    console.error('Maker workspace context failed.', error);
  });
}

document.querySelectorAll('[data-page]').forEach((button) => {
  button.addEventListener('click', () => {
    if ($('accountPanel')?.contains(button)) closeAccountPanel();
    if (button.dataset.page === 'make') {
      state.previewingMaker = false;
      makerWorkspace?.setPlayerCreatorPreview?.(false);
    }
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

$('themeButton')?.addEventListener('click', () => {
  if (themeMenuIsOpen()) closeThemeMenu();
  else openThemeMenu();
});

$('themeButton')?.addEventListener('keydown', (event) => {
  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
  event.preventDefault();
  openThemeMenu();
});

$('themeMenu')?.addEventListener('click', (event) => {
  const option = event.target.closest('[data-theme-option]');
  if (!option) return;
  setVisualThemePreference(option.dataset.themeOption);
  closeThemeMenu();
});

$('themeMenu')?.addEventListener('keydown', (event) => {
  const options = [...$('themeMenu').querySelectorAll('[role="menuitemradio"]')];
  if (!options.length) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closeThemeMenu();
    return;
  }
  if (event.key === 'Tab') {
    closeThemeMenu({ returnFocus: false });
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const currentIndex = Math.max(0, options.indexOf(document.activeElement));
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? options.length - 1
      : event.key === 'ArrowDown'
        ? (currentIndex + 1) % options.length
        : (currentIndex - 1 + options.length) % options.length;
  options[nextIndex].focus({ preventScroll: true });
});

document.addEventListener('click', (event) => {
  if (!themeMenuIsOpen() || event.target.closest('.theme-control')) return;
  closeThemeMenu();
});

window.addEventListener('focus', syncVisualThemePreference);
window.addEventListener('pageshow', syncVisualThemePreference);

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
  if (state.publishing || state.minting) {
    renderAll();
    return;
  }
  setCreatorView('list');
  renderAll();
  focusCreatorTop();
});

document.querySelectorAll('[data-editor-panel-button]').forEach((button) => {
  button.addEventListener('click', () => {
    setEditorPanel(button.dataset.editorPanelButton);
    if (button.dataset.makerWorkspaceTab) makerWorkspace?.openCreatorTab?.(button.dataset.makerWorkspaceTab);
    if (button.hasAttribute('data-focus-composition')) {
      $('compositionOrder')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
});

document.querySelectorAll('[data-open-maker-release]').forEach((button) => {
  button.addEventListener('click', () => {
    setEditorPanel('parts');
    makerWorkspace?.openCreatorPublication?.();
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
  makerWorkspace?.updateMakerSettings?.({ livingContent: state.livingContent });
  invalidateMakerUpload();
  scheduleMakerAutosave();
  renderLivingContent();
});

$('restoreLivingDefault')?.addEventListener('click', () => {
  if (!ensureMakerEditable()) return;
  const defaults = createDefaultLivingContent(livingMakerContext());
  state.livingContent[state.livingDocument] = defaults[state.livingDocument];
  state.livingContent.customized[state.livingDocument] = false;
  makerWorkspace?.updateMakerSettings?.({ livingContent: state.livingContent });
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

$('openDraftRecovery')?.addEventListener('click', openDraftRecoveryCenter);

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
    const pendingOnchainEconomics = economicsField && makerIsPublished() && !makerHasPendingV4Version();
    if (id === 'creatorTemplateName') template.name = $('creatorTemplateName').value;
    else if (id === 'creatorDescription') template.summary = $('creatorDescription').value;
    else if (id === 'creatorName') template.creator = $('creatorName').value;
    else if (id === 'creatorWorld') template.style = $('creatorWorld').value;
    else if (id === 'creatorLicense') template.license = creatorLicenseLabels[$('creatorLicense').value] || 'Personal use';
    else if (id === 'creatorLicenseNote') template.licenseNote = $('creatorLicenseNote').value;
    else if (id === 'creatorRoyalty' && !pendingOnchainEconomics) template.royaltyBps = Number($('creatorRoyalty').value || 0);
    else if (id === 'creatorMintingEnabled') {
      if (!pendingOnchainEconomics) template.mintingEnabled = $('creatorMintingEnabled').checked;
      if (!$('creatorMintingEnabled').checked) {
        if (!pendingOnchainEconomics) template.mintFeeEnabled = false;
        $('creatorMintFeeEnabled').checked = false;
      }
    } else if (id === 'creatorMintFeeEnabled') {
      if ($('creatorMintFeeEnabled').checked && !canonicalSoulMintEnabled) {
        $('creatorMintFeeEnabled').checked = false;
        if (!pendingOnchainEconomics) template.mintFeeEnabled = false;
        state.publishStatus = t('paidMintDisabled');
      } else if (!pendingOnchainEconomics) {
        template.mintFeeEnabled = $('creatorMintFeeEnabled').checked;
      }
      $('creatorMintPrice').disabled = !canonicalSoulMintEnabled || !$('creatorMintFeeEnabled').checked;
    } else if (id === 'creatorMintPrice' && !pendingOnchainEconomics) {
      template.mintPriceAtomic = decimalCoinToAtomic($('creatorMintPrice').value) || 0;
    }
    if (!makerIsPublished() || makerHasPendingV4Version() || !economicsField) {
      makerWorkspace?.updateMakerSettings?.({
        name: $('creatorTemplateName').value,
        summary: $('creatorDescription').value,
        creator: $('creatorName').value,
        style: $('creatorWorld').value,
        licenseKind: $('creatorLicense').value,
        licenseNote: $('creatorLicenseNote').value,
        royaltyBps: Number($('creatorRoyalty').value || 0),
        mintingEnabled: $('creatorMintingEnabled').checked,
        mintFeeEnabled: $('creatorMintFeeEnabled').checked,
        mintPriceAtomic: $('creatorMintFeeEnabled').checked ? decimalCoinToAtomic($('creatorMintPrice').value) || 0 : 0,
        paymentCoinType: runtimeConfig.paymentCoinType,
        paymentCoinSymbol: runtimeConfig.paymentCoinSymbol,
      });
    }
    if (['creatorTemplateName', 'creatorDescription', 'creatorName', 'creatorWorld'].includes(id)) refreshLivingDefaults();
    if (!makerIsPublished() || makerHasPendingV4Version()) invalidateMakerUpload();
    if (!makerIsPublished()) scheduleMakerAutosave();
    persistLocalMakerIndex();
    renderAll();
  });
});

$('archiveMakerOnchain')?.addEventListener('click', () => {
  if (state.makerArchived) {
    updateMakerArchiveState(false);
    return;
  }
  openConfirmation({
    title: t('archiveMakerTitle'),
    message: t('archiveMakerCopy'),
    confirmLabel: t('archiveMakerConfirm'),
    action: () => updateMakerArchiveState(true),
  });
});
$('updateMakerEconomics')?.addEventListener('click', async () => {
  if (!makerIsPublished() || !state.makerObjectId) {
    $('makerEconomicsStatus').textContent = t('makerSettingsFirstPublish');
    return;
  }
  let mintPriceAtomic = $('creatorMintFeeEnabled').checked ? decimalCoinToAtomic($('creatorMintPrice').value) : 0;
  const royaltyBps = Number($('creatorRoyalty').value || 0);
  if ($('creatorMintFeeEnabled').checked && !canonicalSoulMintEnabled) {
    $('makerEconomicsStatus').textContent = t('paidMintReleaseGated');
    return;
  }
  if ($('creatorMintFeeEnabled').checked && !mintPriceAtomic) {
    $('makerEconomicsStatus').textContent = t('validMintPriceRequired', {
      symbol: runtimeConfig.paymentCoinSymbol,
    });
    return;
  }
  const operation = beginMakerChainOperation({ bindMakerObject: true });
  invalidateChainMakerDiscovery();
  const mintingEnabled = $('creatorMintingEnabled').checked;
  let mintFeeEnabled = $('creatorMintFeeEnabled').checked;
  let transaction = null;
  state.publishing = true;
  $('makerEconomicsStatus').textContent = t('makerAuthorityChecking');
  renderAll();
  try {
    const authority = await refreshMakerLifecycleAuthority(operation);
    if (!makerChainOperationIsActive(operation)) return;
    const pendingPause = mintingEnabled
      ? activePausedEconomicsSnapshot()?.pendingMutation
      : null;
    if (
      mintingEnabled
      && authority.mintingEnabled
      && pendingPause?.expectedMintingEnabled === false
    ) {
      $('makerEconomicsStatus').textContent = t('makerStateReadbackPending', {
        digest: pendingPause.digest,
      });
      return;
    }
    if (authority.mintingEnabled && !mintingEnabled) {
      setActivePausedEconomicsSnapshot({
        makerObjectId: authority.makerObjectId,
        mintFeeEnabled: authority.mintFeeEnabled,
        mintPriceAtomic: authority.mintPriceAtomic,
        royaltyBps: authority.royaltyBps,
        makerUpdatedAtMs: authority.makerUpdatedAtMs,
        capturedAt: new Date().toISOString(),
      });
      await persistActiveMakerLifecycleBinding({ required: true });
      if (!makerChainOperationIsActive(operation)) return;
      mintFeeEnabled = false;
      mintPriceAtomic = 0;
    } else if (!authority.mintingEnabled && mintingEnabled) {
      const pausedEconomics = activePausedEconomicsSnapshot();
      if (pausedEconomics) {
        mintFeeEnabled = pausedEconomics.mintFeeEnabled;
        mintPriceAtomic = pausedEconomics.mintPriceAtomic;
      }
    }
    $('makerEconomicsStatus').textContent = t('adminSignatureWaiting');
    transaction = await configureMakerEconomics({
      makerId: authority.makerObjectId,
      adminCapId: authority.makerAdminCapObjectId,
      mintingEnabled,
      mintFeeEnabled,
      mintPriceAtomic,
      royaltyBps,
    });
    if (!makerChainOperationIsActive(operation)) return;
    if (!mintingEnabled) {
      const pausedEconomics = pausedEconomicsWithMutationWitness(
        activePausedEconomicsSnapshot(),
        {
          digest: transaction.digest,
          kind: 'pause',
          expectedMintingEnabled: false,
          expectedArchived: authority.archived,
        },
      );
      setActivePausedEconomicsSnapshot(pausedEconomics);
      await persistActiveMakerLifecycleBinding({ required: true });
      if (!makerChainOperationIsActive(operation)) return;
    }
    let confirmed;
    try {
      confirmed = await refreshMakerLifecycleAuthorityAfterWrite(operation, {
        matches: (candidate) => (
          candidate.mintingEnabled === mintingEnabled
          && candidate.mintFeeEnabled === mintFeeEnabled
          && Number(candidate.mintPriceAtomic || 0) === Number(mintPriceAtomic || 0)
          && Number(candidate.royaltyBps || 0) === Number(royaltyBps || 0)
        ),
      });
    } catch (error) {
      if (!makerChainOperationIsActive(operation)) return;
      $('makerEconomicsStatus').textContent = t('makerStateReadbackPending', { digest: transaction.digest });
      return;
    }
    if (
      confirmed.mintingEnabled !== mintingEnabled
      || confirmed.mintFeeEnabled !== mintFeeEnabled
      || Number(confirmed.mintPriceAtomic || 0) !== Number(mintPriceAtomic || 0)
      || confirmed.royaltyBps !== royaltyBps
    ) {
      $('makerEconomicsStatus').textContent = t('makerStateReadbackPending', { digest: transaction.digest });
      return;
    }
    activeTemplate().price = mintPriceAtomic
      ? `${atomicCoinToDecimal(mintPriceAtomic)} ${runtimeConfig.paymentCoinSymbol}`
      : 'Free mint';
    if (mintingEnabled) {
      setActivePausedEconomicsSnapshot(null);
    } else {
      const pausedEconomics = activePausedEconomicsSnapshot();
      if (pausedEconomics) {
        setActivePausedEconomicsSnapshot({
          ...pausedEconomics,
          royaltyBps,
          makerUpdatedAtMs: confirmed.makerUpdatedAtMs,
          pendingMutation: null,
        });
      }
    }
    syncTemplateFields();
    persistLocalMakerIndex();
    $('makerEconomicsStatus').textContent = t('onchainSettingsUpdated', { digest: transaction.digest });
    await persistActiveMakerLifecycleBinding();
  } catch (error) {
    if (makerChainOperationIsActive(operation)) {
      $('makerEconomicsStatus').textContent = [
        'MAKER_CONTEXT_CHANGED',
        'MAKER_ADMIN_CAP_NOT_OWNED',
        'MAKER_ECONOMICS_SNAPSHOT_SAVE_FAILED',
      ].includes(error?.code)
        ? error.message
        : state.locale === 'en' && error?.message
          ? error.message
          : t('onchainSettingsFailed');
    }
  } finally {
    if (makerChainOperationIsActive(operation)) {
      state.publishing = false;
      reloadChainMakerDiscoveryAfterOperation(operation);
      renderAll();
    }
  }
});
$('withdrawMakerRevenue')?.addEventListener('click', async () => {
  const amountAtomic = decimalCoinToAtomic($('creatorWithdrawAmount').value);
  if (!makerIsPublished() || !state.makerObjectId) {
    $('makerEconomicsStatus').textContent = t('makerTreasuryRequired');
    return;
  }
  if (!amountAtomic) {
    $('makerEconomicsStatus').textContent = t('validWithdrawalRequired', {
      symbol: runtimeConfig.paymentCoinSymbol,
    });
    return;
  }
  const operation = beginMakerChainOperation({ bindMakerObject: true });
  const recipient = state.walletAddress;
  const amountLabel = $('creatorWithdrawAmount').value;
  state.publishing = true;
  $('makerEconomicsStatus').textContent = t('makerAuthorityChecking');
  renderAll();
  try {
    const authority = await refreshMakerLifecycleAuthority(operation);
    if (!makerChainOperationIsActive(operation)) return;
    $('makerEconomicsStatus').textContent = t('adminSignatureWaiting');
    const transaction = await withdrawMakerRevenue({
      makerId: authority.makerObjectId,
      treasuryId: authority.makerTreasuryObjectId,
      adminCapId: authority.makerAdminCapObjectId,
      amountAtomic,
      recipient,
    });
    if (!makerChainOperationIsActive(operation)) return;
    $('makerEconomicsStatus').textContent = t('revenueWithdrawn', {
      amount: amountLabel,
      symbol: runtimeConfig.paymentCoinSymbol,
      digest: transaction.digest,
    });
    await loadActiveTreasuryBalance({ force: true });
  } catch (error) {
    if (makerChainOperationIsActive(operation)) {
      $('makerEconomicsStatus').textContent = ['MAKER_CONTEXT_CHANGED', 'MAKER_ADMIN_CAP_NOT_OWNED'].includes(error?.code)
        ? error.message
        : state.locale === 'en' && error?.message
          ? error.message
          : t('treasuryWithdrawalFailed');
    }
  } finally {
    if (makerChainOperationIsActive(operation)) {
      state.publishing = false;
      renderAll();
    }
  }
});
$('deleteMakerDraft')?.addEventListener('click', () => requestDeleteMaker());

$('addSelectionRule')?.addEventListener('click', () => {
  if (!ensureMakerEditable()) return;
  if (state.rules.length >= MAX_MAKER_RULES) {
    state.publishStatus = t('selectionRuleLimit', { count: MAX_MAKER_RULES });
    renderPublishAction();
    return;
  }
  const leftPartKey = $('ruleLeftPart').value;
  const leftItemKey = $('ruleLeftItem').value;
  const rightPartKey = $('ruleRightPart').value;
  const rightItemKey = $('ruleRightItem').value;
  if (!leftPartKey || !rightPartKey || leftPartKey === rightPartKey) {
    state.publishStatus = t('chooseDifferentRuleParts');
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
    state.draftSaveMessage = state.locale === 'en' && error?.message
      ? error.message
      : t('localPngSaveFailed');
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
$('resumeOcUpload')?.addEventListener('click', resumeOcUploadRecovery);
$('registerOcUpload')?.addEventListener('click', registerOcUpload);
$('certifyOcUpload')?.addEventListener('click', certifyOcUpload);
$('mintOcOnchain')?.addEventListener('click', mintCurrentOc);
$('refreshOwnedCharacters')?.addEventListener('click', () => {
  window.open(soulidityAppLink('/my-souls'), '_blank', 'noopener,noreferrer');
});
document.querySelectorAll('[data-soulidity-auth]').forEach((link) => {
  link.addEventListener('click', (event) => {
    if (state.walletConnected) return;
    event.preventDefault();
    openAccountPanel();
    connectSuiWallet();
  });
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

document.querySelectorAll('[data-close-draft-recovery]').forEach((button) => {
  button.addEventListener('click', closeDraftRecoveryCenter);
});

document.querySelectorAll('[data-close-maker-lifecycle]').forEach((button) => {
  button.addEventListener('click', () => closeMakerLifecycleManager());
});

$('makerLifecycleManagerModal')?.addEventListener('click', (event) => {
  if (event.target === $('makerLifecycleManagerModal')) {
    closeMakerLifecycleManager();
    return;
  }
  const actionButton = event.target.closest('[data-lifecycle-action]');
  if (!actionButton || actionButton.disabled) return;
  actionButton.focus();
  void handleMakerLifecycleAction(actionButton.dataset.lifecycleAction);
});

$('makerLifecycleManagerModal')?.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab') return;
  const focusable = Array.from(
    $('makerLifecycleManagerModal').querySelectorAll(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((node) => node.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!$('makerLifecycleManagerModal').contains(document.activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

document.addEventListener('focusin', (event) => {
  const lifecycleModal = $('makerLifecycleManagerModal');
  if (
    !lifecycleModal?.classList.contains('active')
    || $('confirmActionModal')?.classList.contains('active')
    || lifecycleModal.contains(event.target)
  ) return;
  ($('makerLifecycleManagerStatus') || lifecycleModal.querySelector('[data-close-maker-lifecycle]'))
    ?.focus({ preventScroll: true });
});

$('rescanDraftRecovery')?.addEventListener('click', () => {
  void refreshDraftRecoveryCenter();
});

$('draftRecoveryModal')?.addEventListener('click', (event) => {
  if (event.target === $('draftRecoveryModal')) closeDraftRecoveryCenter();
});

$('draftRecoveryList')?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-recovery-action]');
  if (!button || button.disabled || state.draftRecoveryBusyId) return;
  const record = draftRecoveryRecord(button.dataset.recoveryId);
  if (!record) return;
  state.draftRecoveryBusyId = record.id;
  state.draftRecoveryError = '';
  state.draftRecoveryMessage = '';
  renderDraftRecoveryCenter();
  try {
    if (button.dataset.recoveryAction === 'export') {
      await exportDraftRecoveryRecord(record);
      state.draftRecoveryMessage = t('draftRecoveryBackupExported', { name: draftRecoveryName(record) });
    } else if (button.dataset.recoveryAction === 'restore') {
      await restoreDraftRecoveryRecord(record);
    }
  } catch (error) {
    state.draftRecoveryError = state.locale === 'en' && error?.message
      ? error.message
      : t('draftRecoveryFailed');
  } finally {
    state.draftRecoveryBusyId = '';
    if ($('draftRecoveryModal').classList.contains('active')) renderDraftRecoveryCenter();
  }
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

$('confirmActionModal').addEventListener('keydown', (event) => {
  if (event.key !== 'Tab') return;
  const focusable = Array.from(
    $('confirmActionModal').querySelectorAll(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((node) => node.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

$('confirmActionButton').addEventListener('click', async () => {
  const action = pendingConfirmation;
  closeConfirmation();
  if (!action) return;
  try {
    await action();
  } catch (error) {
    state.publishStatus = state.locale === 'en' && error?.message
      ? error.message
      : t('requestedActionFailed');
    renderAll();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (themeMenuIsOpen()) closeThemeMenu();
  else if ($('draftRecoveryModal').classList.contains('active')) closeDraftRecoveryCenter();
  else if ($('confirmActionModal').classList.contains('active')) closeConfirmation();
  else if ($('makerLifecycleManagerModal')?.classList.contains('active')) closeMakerLifecycleManager();
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
    summary: 'Character Maker draft. Upload aligned PNG artwork, test every combination, then publish the immutable version to Sui and Walrus.',
    licenseNote: 'Personal use only. Credit the creator when the OC is shared publicly.',
  });
  persistLocalMakerIndex();
  const documentV4 = makerStart === 'character'
    ? createCharacterMakerV4Starter({
        makerId: id,
        name,
        creator: shortAddress(state.walletAddress) || 'Creator',
        width: canvasSize.width,
        height: canvasSize.height,
      })
    : createMakerV4Document({
        makerId: id,
        name,
        creator: shortAddress(state.walletAddress) || 'Creator',
        width: canvasSize.width,
        height: canvasSize.height,
      });
  documentV4.metadata.summary = 'Character Maker draft. Upload aligned PNG artwork, test every combination, then publish the immutable version to Sui and Walrus.';
  documentV4.metadata.style = canvas;
  documentV4.metadata.license.note = 'Personal use only. Credit the creator when the OC is shared publicly.';
  documentV4.publication.royaltyBps = 300;
  documentV4.livingContent = createDefaultLivingContent();
  validateMakerV4Document(documentV4, { mode: 'draft' });
  const model = makerModelFromV4Manifest(documentV4, () => '');
  model.makerRuntimeAssetsV4 = new Map();
  model.assets = [];
  makerModels.set(id, model);
  activateMakerModel(id);
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
    state.publishStatus = t('makerPartLimit', { count: MAX_MAKER_PARTS });
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
  const makerInFlight = state.publishing
    || state.makerLifecycleActionBusy
    || ['registered', 'uploaded', 'certified'].includes(state.makerUploadStage);
  const ocInFlight = state.minting || ['registered', 'uploaded', 'certified'].includes(state.ocUploadStage);
  const makerDraftDirty = makerWorkspace?.hasUnsavedChanges?.() === true;
  if (!makerInFlight && !ocInFlight && !makerDraftDirty) return;
  void makerWorkspace?.flushPendingChanges?.({ reason: 'beforeunload' });
  event.preventDefault();
  event.returnValue = '';
});

window.addEventListener('pagehide', () => {
  void makerWorkspace?.flushPendingChanges?.({ reason: 'pagehide' });
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    void makerWorkspace?.flushPendingChanges?.({ reason: 'visibility-hidden' });
  }
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

makerWorkspace = createMakerWorkspace({
  creatorRoot: $('makerV4CreatorMount'),
  playerRoot: $('makerV4PlayerMount'),
  locale: state.locale,
  callbacks: {
    canMutateDocument() {
      return !makerPublicationRecoveryPending();
    },
    documentMutationBlockedMessage() {
      return t('publicationPendingReview');
    },
    onRestored(payload) {
      if (!syncV4WorkspaceState(payload)) return;
      state.draftSaveStatus = 'saved';
      state.draftSaveMessage = payload.savedAt
        ? t('makerRestoredAt', { time: new Date(payload.savedAt).toLocaleTimeString(state.locale) })
        : t('makerRestored');
      void restoreMakerUploadRecovery(state.templateId, { force: true });
    },
    onDocumentChange(payload) {
      if (!syncV4WorkspaceState(payload)) return;
      if (makerHasPendingV4Version()) invalidateMakerUpload(t('makerVersionChanged'));
    },
    onSaved(payload) {
      if (!syncV4WorkspaceState(payload)) return;
      state.draftSaveStatus = 'saved';
      state.draftSaveMessage = payload.automatic ? t('makerAutosaved') : t('makerSaved');
    },
    onManageLifecycle() {
      openMakerLifecycleManager();
    },
    onBackToLibrary() {
      if (state.publishing || state.minting) {
        renderAll();
        return;
      }
      setCreatorView('list');
      renderAll();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    onOpenPlayer(payload) {
      if (state.publishing || state.minting) {
        renderAll();
        return;
      }
      syncV4WorkspaceState(payload);
      state.previewingMaker = true;
      if ($('legacyPlayerEditor')) $('legacyPlayerEditor').hidden = true;
      setPage('make');
      renderAll();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    getPlayerExternalLinks({ document }) {
      const template = activeTemplate();
      const makerId = template?.source === 'chain' ? String(template.objectId || '') : '';
      const versionId = String(document?.version?.versionId || '');
      const sourceParams = {
        maker: makerId,
        makerVersion: versionId,
        creatorWallet: template?.creatorWallet || '',
      };
      return {
        baseUrl: safeExternalUrl(runtimeConfig.appUrl || location.origin),
        makerId,
        // Social writes remain on Soulidity's own origin so its session and
        // CSRF boundary stay authoritative. Animacraft only supplies immutable
        // Maker provenance as route context.
        communityUrl: soulidityAppLink('/community', sourceParams, { includeWallet: false }),
      };
    },
    onPublish(payload) {
      syncV4WorkspaceState(payload);
      if (state.makerUploadStage === 'idle' && !state.publishing) prepareMakerUpload();
    },
    async onCreatorPublishAction(action) {
      if (action === 'prepare') await prepareMakerUpload();
      else if (action === 'register') await registerMakerUpload();
      else if (action === 'certify') await certifyMakerUpload();
      else if (action === 'onchain') await publishCurrentMaker();
      else if (action === 'review') await reviewPendingMakerPublication();
      else if (action === 'discard') await requestDiscardMakerUploadRecovery();
      else if (action === 'resume') await resumeMakerUploadRecovery();
    },
    onPlayerRecipeChange(payload) {
      syncPlayerV4State(payload);
    },
    onCompleteOc(payload) {
      syncPlayerV4State(payload, { completed: true });
      if (state.previewingMaker && activeTemplate()?.source === 'local') {
        state.previewingMaker = false;
        state.creatorView = 'edit';
        setPage('creator');
        renderAll();
        focusCreatorTop();
        return;
      }
      renderMintAction();
      if (
        canonicalSoulMintEnabled
        && state.ocUploadStage === 'idle'
        && activeTemplate()?.source === 'chain'
        && !makerHasPendingV4Version()
        && !state.minting
      ) prepareOcUpload();
    },
    async onPlayerPublishAction(action) {
      if (action === 'prepare') await prepareOcUpload();
      else if (action === 'register') await registerOcUpload();
      else if (action === 'certify') await certifyOcUpload();
      else if (action === 'onchain') await mintCurrentOc();
      else if (action === 'discard') await requestDiscardOcUploadRecovery();
      else if (action === 'resume') await resumeOcUploadRecovery();
    },
    onPlayerError(error) {
      state.mintStatus = state.locale === 'en' && error?.message ? error.message : t('currentRulesInvalid');
      renderMintAction();
    },
    onCreatorError(error) {
      state.publishStatus = state.locale === 'en' && error?.message ? error.message : t('creatorAssetImportFailed');
      renderPublishAction();
    },
    onPlayerSaveError(error) {
      state.mintStatus = state.locale === 'en' && error?.message ? error.message : t('ocDraftLocalFailed');
      renderMintAction();
    },
  },
});

function activatePublishedMakerForPlayer(templateId) {
  const template = templates.find((candidate) => candidate.id === templateId);
  const model = makerModels.get(templateId);
  if (!template || template.source !== 'chain' || !model || model.makerArchived) return false;
  const publishedDocument = isMakerV4Document(model.publishedMakerDocumentV4)
    ? model.publishedMakerDocumentV4
    : isMakerV4Document(model.makerDocumentV4)
      && model.makerDocumentV4.version?.createdAt
      ? model.makerDocumentV4
      : null;
  if (!publishedDocument) return false;
  const publishedRecipe = model.publishedMakerRecipeV4
    || publishedDocument.defaultRecipe;
  const publicModel = {
    ...model,
    makerDocumentV4: structuredClone(publishedDocument),
    makerRecipeV4: cloneV4Recipe(publishedRecipe),
    publishedMakerDocumentV4: structuredClone(publishedDocument),
    publishedMakerRecipeV4: cloneV4Recipe(publishedRecipe),
    makerAdminCapObjectId: '',
    makerPublicationIntent: null,
  };
  template.owned = false;
  template.adminCapId = '';
  makerModels.set(templateId, publicModel);
  applyMakerModelToState(templateId, publicModel);
  return true;
}

async function flushActiveMakerBeforeWalletChange(previousWalletAddress) {
  if (!previousWalletAddress) return;
  if (makerAutosaveTimer) {
    clearTimeout(makerAutosaveTimer);
    makerAutosaveTimer = null;
  }
  syncActiveMakerModelRefs();
  try {
    if (isMakerV4Document(state.makerDocumentV4) && makerWorkspace) {
      const flushed = await makerWorkspace.flushPendingChanges({
        reason: 'wallet-change',
      });
      if (flushed?.saved === false) {
        throw new Error(makerWorkspace.store?.getState().saveMessage || t('localDraftSaveFailed'));
      }
    } else if (templateIsOwnedByWallet(activeTemplate(), previousWalletAddress)) {
      await saveCurrentMakerDraft({ silent: true });
    }
  } catch (error) {
    // The v6 write-ahead log remains scoped to the previous wallet and can be
    // recovered later. Never continue an old timer under the next wallet.
    state.draftSaveStatus = 'error';
    state.draftSaveMessage = state.locale === 'en' && error?.message
      ? error.message
      : t('localDraftSaveFailed');
    console.error('Maker wallet-change flush failed.', error);
  }
}

async function applyWalletConnection(connection) {
  if (localUiTest) connection = {
    connected: true,
    address: '0xc0dec0dec0dec0dec0dec0dec0dec0dec0dec0dec0dec0dec0dec0dec0de',
    provider: 'Local UI test',
    status: 'connected',
  };
  const previousWalletAddress = state.walletAddress;
  const walletChanged = previousWalletAddress !== connection.address;
  if (walletChanged) {
    await flushActiveMakerBeforeWalletChange(previousWalletAddress);
    chainMakerLoadRequestId += 1;
    state.chainMakersLoading = false;
    state.chainMakersLoadedFor = '';
    state.chainMakerLoadError = '';
    templates
      .filter((template) => template.source === 'local' && template.owner === previousWalletAddress)
      .forEach((template) => {
        localMakerCoverRestoreTokens.delete(template.id);
        revokeLocalMakerCoverObjectUrl(template.id);
      });
    if (previousWalletAddress) loadedStableMakerIndexes.delete(previousWalletAddress);
    resetMakerUploadMemoryState();
    const activeModel = makerModels.get(state.templateId);
    if (activeModel) activeModel.makerPublicationIntent = null;
    resetOcUploadState();
    state.ownedCharacters = [];
    state.ownedCharactersLoadedFor = '';
    state.ownedCharactersError = '';
    templates.filter((template) => template.source === 'chain').forEach((template) => { template.owned = false; });
  }
  state.walletConnected = connection.connected;
  state.walletAddress = connection.address;
  state.walletProvider = connection.provider;
  state.walletStatus = connection.status;
  if (walletChanged) {
    const currentTemplate = activeTemplate();
    if (
      currentTemplate?.owner
      && !templateIsOwnedByWallet(currentTemplate, connection.address)
    ) {
      const keptPublishedPlayer = (
        state.page === 'make'
        && activatePublishedMakerForPlayer(currentTemplate.id)
      );
      if (!keptPublishedPlayer) {
        const starter = templates.find((template) => template.source === 'starter')
          || templates[0];
        if (!makerModels.has(starter.id)) makerModels.set(starter.id, createMakerModel());
        applyMakerModelToState(starter.id, makerModels.get(starter.id));
      }
      syncTemplateFields();
    }
  }
  if (!connection.connected || walletChanged) state.creatorProfileObjectId = '';
  if (connection.connected) {
    loadLocalMakerIndex(connection.address);
    void recoverStableMakerIndex(connection.address).finally(() => {
      if (
        state.walletConnected
        && String(state.walletAddress) === String(connection.address)
      ) loadChainMakers(connection.address);
    });
    restoreMakerDraft(state.templateId);
    loadOwnedCharacters();
    let pendingWalletTemplateReady = !state.pendingWalletTemplateId;
    if (state.pendingWalletTemplateId) {
      const pendingTemplate = templates.find((template) => (
        template.id === state.pendingWalletTemplateId
      ));
      const pendingOwnedByWallet = templateIsOwnedByWallet(
        pendingTemplate,
        connection.address,
      );
      const openedPublishedPlayer = Boolean(
        pendingTemplate
        && !pendingOwnedByWallet
        && state.pendingWalletPage === 'make'
        && activatePublishedMakerForPlayer(pendingTemplate.id)
      );
      if (openedPublishedPlayer) {
        pendingWalletTemplateReady = true;
        syncTemplateFields();
      } else if (
        pendingTemplate
        && (
          pendingOwnedByWallet
          || (pendingTemplate.source !== 'chain' && !pendingTemplate.owner)
        )
      ) {
        pendingWalletTemplateReady = activateMakerModel(state.pendingWalletTemplateId);
        if (pendingWalletTemplateReady) syncTemplateFields();
      }
    }
    if (state.pendingWalletPage && pendingWalletTemplateReady) {
      setPage(state.pendingWalletPage);
    }
    state.pendingWalletPage = '';
    state.pendingWalletTemplateId = '';
  } else if (!['templates', 'template', 'docs'].includes(state.page)) {
    setPage('templates');
  }
  renderAll();
}

let walletConnectionApplyQueue = Promise.resolve();
initializeChain(runtimeConfig, (connection) => {
  walletConnectionApplyQueue = walletConnectionApplyQueue
    .catch(() => {})
    .then(() => applyWalletConnection(connection))
    .catch((error) => {
      state.walletStatus = 'error';
      state.draftSaveStatus = 'error';
      state.draftSaveMessage = state.locale === 'en' && error?.message
        ? error.message
        : t('requestedActionFailed');
      console.error('Wallet connection transition failed.', error);
      renderAll();
    });
});
setWalletModalLocale(state.locale);

syncTemplateFields();
renderAll();
setPage(initialPage);
loadBundledMakers();
loadChainMakers();
