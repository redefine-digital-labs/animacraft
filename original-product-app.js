import {
  assertMakerV8Document,
} from './maker-v8-document.js';
import {
  MAKER_V8_APPROVED_CREATOR_TABS,
  projectMakerV8WorkspaceView,
  renderApprovedMakerV8Workspace,
} from './maker-workspace-v8-view.js';
import {
  projectMakerV8PlayerView,
  renderApprovedMakerV8Player,
} from './maker-player-v8-view.js';
import { createDocsCenter } from './docs-center.js';
import { makerV8PlayerPart, makerV8PlayerPartUiKey, makerV8PlayerColor } from './maker-v8-player-definition-resolution.js';
import { makerV8PlayerColorEntry, makerV8PlayerColorControlKey, makerV8PlayerColorKey } from './maker-v8-player-colors.js';
import { makerWorkspaceText } from './maker-workspace-i18n.js';
import { renderMakerEditorShell } from './maker-editor-shell.js';
import { createMakerPartListModel, renderMakerPartList } from './maker-definition-editor.js';
import { renderSharedRuleTargetTree, renderDefinitionCombinationRuleControl } from './maker-definition-rule-control.js';
import { packAuthoringDocument, preparePackStructure, preparePackEdits } from './maker-v8-pack-authoring.js';
import { toBase64 } from '@mysten/sui/utils';
import { assertMakerV8EnabledPackReleaseIds } from './maker-v8-player-pack-preferences.js';
import { createMakerV8LocalPlayerControls } from './maker-v8-local-player-controls.js';
import { exactMakerV8ExportOptions, makerV8ExportSizes, MAKER_V8_BLEND_MODES } from './maker-v8-render-core.js';
import { DOCS_CONTENT, DOCS_LOCALES } from './docs-center-content.js';
import { decodeMakerV8ProjectZip, MAKER_V8_PROJECT_ZIP_MAX_BYTES } from './maker-v8-project-zip.js';
import { makerV8RuleFromBuilder } from './maker-v8-rules.js';
import { makerV8VisibilityEditorModel, makerV8VisibilityFromBuilder } from './maker-v8-visibility.js';
import { createDefaultMakerV8LivingContentV8, MAKER_V8_LIVING_CONTENT_KEYS } from './maker-v8-living-content.js';
import { prepareCreatorStylePng, pngDimensions } from './maker-v8-creator-image.js';
import { createMakerV8ComposableArtworkStore } from './maker-v8-composable-artwork-store.js';
import { prepareCreatorCover, MAKER_V8_CREATOR_COVER_MAX_BYTES } from './maker-v8-creator-cover.js';
import { prepareCreatorStructure } from './maker-v8-creator-structure.js';
import { prepareCreatorTrackChange, creatorTrackState } from './maker-v8-creator-tracks.js';
import { prepareCreatorColorChange } from './maker-v8-creator-colors.js';
import { CREATOR_STYLE_VALUE_ACTIONS, creatorStyleEditorState, exactCreatorTransform, prepareCreatorStyleChange } from './maker-v8-creator-style.js';

/**
 * Fresh-v8 behavior adapter for the approved Animacraft document.
 *
 * This module deliberately owns no product layout. The header, pages, account
 * panel, lifecycle manager, Creator mount, and Player mount must already exist
 * in the approved index.html. Both mounts use only the approved aac90dbc
 * projections; this adapter supplies Fresh-v8 state and capabilities.
 */

export const ORIGINAL_PRODUCT_PAGES = Object.freeze([
  'templates',
  'template',
  'make',
  'creator',
  'docs',
]);

export const ORIGINAL_CREATOR_TABS = MAKER_V8_APPROVED_CREATOR_TABS;

const THEME_IDS = Object.freeze(['auto', 'animacraft', 'soulidity']);
const PROTECTED_PAGES = new Set(['make', 'creator']);
const EXACT_ADDRESS = /^0x[0-9a-f]{64}$/;
const ZERO_ADDRESS = `0x${'0'.repeat(64)}`;
const EXACT_OBJECT_ID = /^0x[0-9a-f]{64}$/;
const PLAYER_SESSION_SCHEMA = 'animacraft.maker-v8-player-session.v1';
const PLAYER_RENDER_SCHEMA = 'animacraft.maker-v8-player-render.v1';
const PLAYER_PROJECT_SCHEMA = 'animacraft.local-player-project.v8';
const PLAYER_PROJECT_STORE_SCHEMA = 'animacraft.maker-v8-player-project-store.v1';
const PLAYER_PROJECT_STORAGE_PREFIX = 'animacraft:maker-v8-player-project:v1';
const EXACT_SHA256 = /^[0-9a-f]{64}$/;
const ORIGINAL_LOCALE_STORAGE_KEY = 'animacraft-locale';
let playerWriterSequence = 0;
// Exact global-surface donor copy from aac90dbc:app.js. Creator-local copy stays
// with the approved Creator renderer and is intentionally not duplicated here.
const ORIGINAL_GLOBAL_I18N = Object.freeze({
  en: Object.freeze({
    brandTagline: 'The Fully Onchain Character Maker & Creator',
    mainNavAria: 'Animacraft sections', navTemplates: 'Templates', navDocs: 'Docs',
    walletConnect: 'Connect wallet', walletConnected: 'Wallet connected',
    walletConnectedAs: 'Wallet connected: {address}', connectSuiWallet: 'Connect Sui wallet',
    themeButtonAria: 'Choose visual theme', visualThemeLabel: 'Visual theme',
    themeAuto: 'Automatic', themeAutoCopy: 'Use Animacraft by default',
    themeAnimacraft: 'Animacraft', themeAnimacraftCopy: 'Light maker workspace',
    themeSoulidity: 'Soulidity', themeSoulidityCopy: 'Dark Soulidity workspace',
    myPage: 'MyPage', closeAccountMenu: 'Close account menu',
    accountLanguageAria: 'Account language', languageLabel: 'Language',
    walletFirstTitle: 'Connect your wallet first',
    walletFirstCopy: 'My Souls, creator tools, draft storage, publishing, and Soulidity minting unlock after wallet connection.',
    createMaker: 'Create maker', createMakerCopy: 'Publish an OC template',
    makeOc: 'Make OC', makeOcCopy: 'Continue current OC',
    soulidityLinksAria: 'Soulidity account and social links', soulidityMySouls: 'My Souls',
    socialProfile: 'Social profile', community: 'Community', marketplace: 'Market',
    browseTemplates: 'Browse templates', browseTemplatesCopy: 'Find a maker to play',
    docsCopy: 'Protocol and licensing', templatePlaza: 'Template Plaza',
    templateHero: 'Choose an artist-made template, then make your OC',
    templateHeroCopy: 'Choose a Maker, combine Parts, and save the character with its recipe, license snapshot, provenance, and on-chain record.',
    platformMetricsAria: 'Platform metrics', publicMakers: 'public Makers',
    mainnetObjects: 'Mainnet objects', assetQuilts: 'asset quilts', search: 'Search',
    searchPlaceholder: 'Search style, creator, license…', templateFiltersAria: 'Template filters',
    filterAll: 'All', filterDaily: 'Daily icon', filterFantasy: 'Fantasy', filterChibi: 'Chibi',
    networkStatusAria: 'Animacraft network status', onchainNetworkKicker: 'On-chain Network',
    backendlessRuntimeTitle: 'Backendless Sui + Walrus runtime',
    refreshMakers: 'Refresh Makers', syncingMakers: 'Syncing Makers…',
    templatePlazaBack: '← Template Plaza', sourceOnchain: 'On-chain Maker',
    partsLabel: 'Parts', itemsLabel: 'Items', royaltyPolicy: 'Royalty policy',
    viewMaker: 'View Maker', startMaking: 'Start making', connectToMake: 'Connect to make',
    noMatchingMakers: 'No matching Makers found.',
    noPublishedMakers: 'No Makers have been published on-chain yet',
    noPublishedMakersCopy: 'Animacraft only lists Makers discovered from Sui and restored from certified Walrus assets. Be the first creator to publish one.',
    createFirstMaker: 'Create the first Maker', byCreator: 'by {creator}',
    templateSamplesAria: '{name} samples', makerPreviewAlt: '{name} preview',
    noPublishedMakerCover: 'No published cover',
    docsTitle: 'The Animacraft Handbook',
    docsIntro: 'Choose a player, creator, publication, or reference path. Every guide follows the current production Maker → OC workflow and clearly labels the still-gated Canonical Soul boundary.',
    docsArchitectureKicker: 'Production Architecture',
    docsArchitectureTitle: 'Creator to player without a backend database',
    docsArchitectureCopy: 'Wallets sign core writes, Walrus stores the complete versioned package, and Sui records Maker ownership, lifecycle, economics, and an equivalent rule projection. Published Maker events drive the public gallery without an Animacraft database.',
    walletDisconnected: 'Wallet not connected', accountGuest: 'Animacraft user',
    continueMakerSession: 'Continue the selected Maker session',
    choosePublishedMaker: 'Choose a published Maker from Templates first',
    networkLabel: 'Network', chainNetworkNote: 'Sui network used by wallet transactions.',
    chainWalletLabel: 'Wallet', chainWalletNotConnected: 'Not connected',
    chainWalletReady: 'Ready to sign Creator and OC transactions.',
    chainWalletNeedConnect: 'Connect before publishing or minting.',
    discoveryLabel: 'Discovery', discoverySyncing: 'Syncing Makers',
    chainDerived: 'Chain-derived', waiting: 'Waiting',
    discoveryReadyNote: 'Published Makers are discovered from Sui events and restored from certified Walrus manifests.',
    discoverySetupNote: 'Configure the published package ID to enable the public on-chain Maker gallery.',
  }),
  zh: Object.freeze({
    brandTagline: 'The Fully Onchain Character Maker & Creator',
    mainNavAria: 'Animacraft 导航', navTemplates: '模板广场', navDocs: '文档',
    walletConnect: '连接钱包', walletConnected: '钱包已连接',
    walletConnectedAs: '钱包已连接：{address}', connectSuiWallet: '连接 Sui 钱包',
    themeButtonAria: '选择视觉主题', visualThemeLabel: '视觉主题',
    themeAuto: '自动', themeAutoCopy: '默认使用 Animacraft',
    themeAnimacraft: 'Animacraft', themeAnimacraftCopy: '浅色 Maker 创作空间',
    themeSoulidity: 'Soulidity', themeSoulidityCopy: '深色 Soulidity 创作空间',
    myPage: '我的页面', closeAccountMenu: '关闭账户菜单',
    accountLanguageAria: '账户语言', languageLabel: '语言',
    walletFirstTitle: '请先连接钱包',
    walletFirstCopy: '连接钱包后可使用我的 Soul、创作者工具、草稿保存、发布并进入 Soulidity 铸造。',
    createMaker: '创建模板', createMakerCopy: '发布 OC 模板',
    makeOc: '捏 OC', makeOcCopy: '继续当前 OC',
    soulidityLinksAria: 'Soulidity 账户与社交链接', soulidityMySouls: '我的 Soul',
    socialProfile: '社交主页', community: '社区', marketplace: '市场',
    browseTemplates: '浏览模板', browseTemplatesCopy: '找一个喜欢的模板开始捏',
    docsCopy: '协议与授权', templatePlaza: '模板广场',
    templateHero: '选择画师制作的模板，创作你的 OC',
    templateHeroCopy: '选择 Maker、组合部位，并连同配方、授权快照、来源与链上记录一起保存角色。',
    platformMetricsAria: '平台数据', publicMakers: '个公开模板',
    mainnetObjects: '主网对象', assetQuilts: '素材 Quilt', search: '搜索',
    searchPlaceholder: '搜索风格、创作者或授权…', templateFiltersAria: '模板筛选',
    filterAll: '全部', filterDaily: '日常头像', filterFantasy: '奇幻', filterChibi: 'Q版',
    networkStatusAria: 'Animacraft 网络状态', onchainNetworkKicker: '链上网络',
    backendlessRuntimeTitle: '无后端的 Sui + Walrus 运行环境',
    refreshMakers: '刷新 Maker', syncingMakers: '正在同步 Maker…',
    templatePlazaBack: '← 返回模板广场', sourceOnchain: '链上 Maker',
    partsLabel: '部位', itemsLabel: '部件', royaltyPolicy: '版税政策',
    viewMaker: '查看模板', startMaking: '开始捏 OC', connectToMake: '连接钱包后开始',
    noMatchingMakers: '没有找到匹配的模板。', noPublishedMakers: '链上还没有已发布的 Maker',
    noPublishedMakersCopy: 'Animacraft 只展示从 Sui 发现并由 Walrus 认证素材恢复的 Maker。成为第一位发布者。',
    createFirstMaker: '创建第一个 Maker', byCreator: '创作者：{creator}',
    templateSamplesAria: '{name} 示例', makerPreviewAlt: '{name} 预览',
    noPublishedMakerCover: '此版本未发布封面', docsTitle: 'Animacraft 使用手册',
    docsIntro: '按玩家、创作者、发布或参考路径阅读。每篇指南都遵循当前生产版本真实可用的 Maker → OC 流程，并明确标记尚未开启的规范 Soul 边界。',
    docsArchitectureKicker: '生产架构', docsArchitectureTitle: '无需后端数据库，连接创作者与玩家',
    docsArchitectureCopy: '钱包签署核心写入，Walrus 保存完整的版本化发布包，Sui 记录 Maker 所有权、生命周期、经济参数及等价规则投影。已发布 Maker 的事件直接驱动公开广场，不依赖 Animacraft 数据库。',
    walletDisconnected: '钱包未连接', accountGuest: 'Animacraft 用户',
    continueMakerSession: '继续当前选中的 Maker 会话', choosePublishedMaker: '请先从模板广场选择已发布的 Maker',
    networkLabel: '网络', chainNetworkNote: '钱包交易使用的 Sui 网络。',
    chainWalletLabel: '钱包', chainWalletNotConnected: '未连接',
    chainWalletReady: '可以签署创作者与 OC 交易。', chainWalletNeedConnect: '发布或铸造前请先连接。',
    discoveryLabel: '链上发现', discoverySyncing: '正在同步 Maker', chainDerived: '来自链上', waiting: '等待中',
    discoveryReadyNote: '通过 Sui 事件发现已发布 Maker，并从认证的 Walrus 清单恢复。',
    discoverySetupNote: '请配置已发布的合约包 ID，以启用公开链上 Maker 广场。',
  }),
  ja: Object.freeze({
    brandTagline: 'The Fully Onchain Character Maker & Creator',
    mainNavAria: 'Animacraft セクション', navTemplates: 'テンプレート', navDocs: 'ドキュメント',
    walletConnect: 'ウォレット接続', walletConnected: '接続済み',
    walletConnectedAs: 'ウォレット接続済み：{address}', connectSuiWallet: 'Sui ウォレット接続',
    themeButtonAria: '表示テーマを選択', visualThemeLabel: '表示テーマ',
    themeAuto: '自動', themeAutoCopy: 'デフォルトでは Animacraft を使用',
    themeAnimacraft: 'Animacraft', themeAnimacraftCopy: '明るい Maker ワークスペース',
    themeSoulidity: 'Soulidity', themeSoulidityCopy: '暗い Soulidity ワークスペース',
    myPage: 'マイページ', closeAccountMenu: 'アカウントメニューを閉じる',
    accountLanguageAria: 'アカウントの言語', languageLabel: '言語',
    walletFirstTitle: '先にウォレットを接続してください',
    walletFirstCopy: '接続後、マイ OC、制作ツール、下書き保存、公開、ミントを利用できます。',
    createMaker: 'メーカー作成', createMakerCopy: 'OC テンプレートを公開',
    makeOc: 'OC を作る', makeOcCopy: '現在の OC を続ける',
    soulidityLinksAria: 'Soulidity アカウントとソーシャルリンク', soulidityMySouls: 'マイ Soul',
    socialProfile: 'ソーシャルプロフィール', community: 'コミュニティ', marketplace: 'マーケット',
    browseTemplates: 'テンプレートを見る', browseTemplatesCopy: '遊ぶメーカーを探す',
    docsCopy: 'プロトコルとライセンス', templatePlaza: 'テンプレート広場',
    templateHero: 'アーティスト制作のテンプレートを選び、OC を作る',
    templateHeroCopy: 'Maker を選び、パーツを組み合わせ、レシピ、ライセンスのスナップショット、来歴、オンチェーン記録と共にキャラクターを保存します。',
    platformMetricsAria: 'プラットフォーム指標', publicMakers: '公開メーカー',
    mainnetObjects: 'メインネットオブジェクト', assetQuilts: 'アセット Quilt', search: '検索',
    searchPlaceholder: 'スタイル、制作者、ライセンスを検索…', templateFiltersAria: 'テンプレート絞り込み',
    filterAll: 'すべて', filterDaily: '日常アイコン', filterFantasy: 'ファンタジー', filterChibi: 'ちび',
    networkStatusAria: 'Animacraft ネットワーク状態', onchainNetworkKicker: 'オンチェーンネットワーク',
    backendlessRuntimeTitle: 'バックエンド不要の Sui + Walrus ランタイム',
    refreshMakers: 'Maker を更新', syncingMakers: 'Maker を同期中…',
    templatePlazaBack: '← テンプレート広場へ戻る', sourceOnchain: 'オンチェーン Maker',
    partsLabel: 'パーツ', itemsLabel: 'アイテム', royaltyPolicy: 'ロイヤリティ方針',
    viewMaker: 'メーカーを見る', startMaking: 'OC を作る', connectToMake: '接続して作る',
    noMatchingMakers: '一致するメーカーがありません。',
    noPublishedMakers: 'オンチェーンに公開された Maker はまだありません',
    noPublishedMakersCopy: 'Animacraft は Sui で検出され、認証済み Walrus 素材から復元された Maker のみを表示します。最初のクリエイターになりましょう。',
    createFirstMaker: '最初の Maker を作成', byCreator: '制作者：{creator}',
    templateSamplesAria: '{name} のサンプル', makerPreviewAlt: '{name} のプレビュー',
    noPublishedMakerCover: '公開済みカバーなし', docsTitle: 'Animacraft ハンドブック',
    docsIntro: 'プレイヤー、制作者、公開、リファレンスの経路から選べます。各ガイドは現行本番版の Maker → OC フローに沿い、未有効の Canonical Soul 境界を明示します。',
    docsArchitectureKicker: '本番アーキテクチャ',
    docsArchitectureTitle: 'バックエンド DB なしで制作者からプレイヤーへ',
    docsArchitectureCopy: 'ウォレットが主要な書き込みに署名し、Walrus が完全なバージョン付き公開パッケージを保存し、Sui が Maker の所有権、ライフサイクル、経済設定、等価なルール投影を記録します。公開 Maker イベントが Animacraft DB なしで公開広場を構成します。',
    walletDisconnected: 'ウォレット未接続', accountGuest: 'Animacraft ユーザー',
    continueMakerSession: '選択中の Maker セッションを続ける', choosePublishedMaker: '先にテンプレートから公開済み Maker を選択してください',
    networkLabel: 'ネットワーク', chainNetworkNote: 'ウォレット取引で使用する Sui ネットワークです。',
    chainWalletLabel: 'ウォレット', chainWalletNotConnected: '未接続',
    chainWalletReady: '制作・OC 取引に署名できます。', chainWalletNeedConnect: '公開またはミント前に接続してください。',
    discoveryLabel: '検出', discoverySyncing: 'Maker を同期中', chainDerived: 'オンチェーン由来', waiting: '待機中',
    discoveryReadyNote: 'Sui イベントから公開 Maker を検出し、認証済み Walrus マニフェストから復元します。',
    discoverySetupNote: '公開パッケージ ID を設定してオンチェーン Maker 広場を有効にしてください。',
  }),
  ko: Object.freeze({
    brandTagline: 'The Fully Onchain Character Maker & Creator',
    mainNavAria: 'Animacraft 섹션', navTemplates: '템플릿', navDocs: '문서',
    walletConnect: '지갑 연결', walletConnected: '지갑 연결됨',
    walletConnectedAs: '지갑 연결됨: {address}', connectSuiWallet: 'Sui 지갑 연결',
    themeButtonAria: '화면 테마 선택', visualThemeLabel: '화면 테마',
    themeAuto: '자동', themeAutoCopy: '기본값으로 Animacraft 사용',
    themeAnimacraft: 'Animacraft', themeAnimacraftCopy: '밝은 Maker 작업 공간',
    themeSoulidity: 'Soulidity', themeSoulidityCopy: '어두운 Soulidity 작업 공간',
    myPage: '마이페이지', closeAccountMenu: '계정 메뉴 닫기',
    accountLanguageAria: '계정 언어', languageLabel: '언어',
    walletFirstTitle: '먼저 지갑을 연결하세요',
    walletFirstCopy: '지갑을 연결하면 내 OC, 창작 도구, 초안 저장, 게시, 민팅을 사용할 수 있습니다.',
    createMaker: '메이커 만들기',
    createMakerCopy: 'OC 템플릿 게시', makeOc: 'OC 만들기', makeOcCopy: '현재 OC 이어가기',
    soulidityLinksAria: 'Soulidity 계정 및 소셜 링크', soulidityMySouls: '내 Soul',
    socialProfile: '소셜 프로필', community: '커뮤니티', marketplace: '마켓',
    browseTemplates: '템플릿 둘러보기', browseTemplatesCopy: '사용할 메이커 찾기',
    docsCopy: '프로토콜과 라이선스', templatePlaza: '템플릿 광장',
    templateHero: '작가가 만든 템플릿을 고르고 OC를 만드세요',
    templateHeroCopy: 'Maker를 선택하고 파트를 조합한 뒤 레시피, 라이선스 스냅샷, 출처, 온체인 기록과 함께 캐릭터를 저장합니다.',
    platformMetricsAria: '플랫폼 지표', publicMakers: '공개 메이커',
    mainnetObjects: '메인넷 오브젝트', assetQuilts: '에셋 Quilt', search: '검색',
    searchPlaceholder: '스타일, 제작자, 라이선스 검색…', templateFiltersAria: '템플릿 필터',
    filterAll: '전체', filterDaily: '데일리 아이콘', filterFantasy: '판타지', filterChibi: '치비',
    networkStatusAria: 'Animacraft 네트워크 상태', onchainNetworkKicker: '온체인 네트워크',
    backendlessRuntimeTitle: '백엔드 없는 Sui + Walrus 런타임',
    refreshMakers: 'Maker 새로고침', syncingMakers: 'Maker 동기화 중…',
    templatePlazaBack: '← 템플릿 광장으로', sourceOnchain: '온체인 Maker',
    partsLabel: '파트', itemsLabel: '아이템', royaltyPolicy: '로열티 정책',
    viewMaker: '메이커 보기', startMaking: 'OC 만들기', connectToMake: '연결하고 만들기',
    noMatchingMakers: '일치하는 메이커가 없습니다.',
    noPublishedMakers: '아직 온체인에 게시된 Maker가 없습니다',
    noPublishedMakersCopy: 'Animacraft는 Sui에서 발견되고 인증된 Walrus 에셋으로 복원된 Maker만 표시합니다. 첫 번째 크리에이터가 되어 보세요.',
    createFirstMaker: '첫 Maker 만들기', byCreator: '제작자: {creator}',
    templateSamplesAria: '{name} 샘플', makerPreviewAlt: '{name} 미리보기',
    noPublishedMakerCover: '게시된 커버 없음', docsTitle: 'Animacraft 사용 설명서',
    docsIntro: '플레이어, 제작자, 게시 또는 참고 경로를 선택하세요. 모든 가이드는 현재 프로덕션 Maker → OC 흐름을 따르고 아직 비활성인 Canonical Soul 경계를 명확히 표시합니다.',
    docsArchitectureKicker: '프로덕션 아키텍처',
    docsArchitectureTitle: '백엔드 데이터베이스 없이 제작자에서 플레이어까지',
    docsArchitectureCopy: '지갑이 핵심 쓰기에 서명하고 Walrus가 완전한 버전형 게시 패키지를 저장하며 Sui가 Maker 소유권, 수명 주기, 경제 설정과 동등한 규칙 투영을 기록합니다. 게시된 Maker 이벤트가 Animacraft 데이터베이스 없이 공개 갤러리를 구성합니다.',
    walletDisconnected: '지갑 연결 안 됨', accountGuest: 'Animacraft 사용자',
    continueMakerSession: '선택한 Maker 세션 계속', choosePublishedMaker: '먼저 템플릿에서 게시된 Maker를 선택하세요',
    networkLabel: '네트워크', chainNetworkNote: '지갑 트랜잭션에 사용하는 Sui 네트워크입니다.',
    chainWalletLabel: '지갑', chainWalletNotConnected: '연결 안 됨',
    chainWalletReady: '크리에이터 및 OC 트랜잭션에 서명할 수 있습니다.', chainWalletNeedConnect: '게시 또는 민팅 전에 연결하세요.',
    discoveryLabel: '검색', discoverySyncing: 'Maker 동기화 중', chainDerived: '온체인 기반', waiting: '대기 중',
    discoveryReadyNote: 'Sui 이벤트에서 게시된 Maker를 찾고 인증된 Walrus 매니페스트에서 복원합니다.',
    discoverySetupNote: '게시된 패키지 ID를 설정해 공개 온체인 Maker 갤러리를 활성화하세요.',
  }),
  vi: Object.freeze({
    brandTagline: 'The Fully Onchain Character Maker & Creator',
    mainNavAria: 'Các mục Animacraft', navTemplates: 'Mẫu', navDocs: 'Tài liệu',
    walletConnect: 'Kết nối ví', walletConnected: 'Đã kết nối ví',
    walletConnectedAs: 'Đã kết nối ví: {address}', connectSuiWallet: 'Kết nối ví Sui',
    themeButtonAria: 'Chọn giao diện hiển thị', visualThemeLabel: 'Giao diện hiển thị',
    themeAuto: 'Tự động', themeAutoCopy: 'Mặc định dùng Animacraft',
    themeAnimacraft: 'Animacraft', themeAnimacraftCopy: 'Không gian Maker nền sáng',
    themeSoulidity: 'Soulidity', themeSoulidityCopy: 'Không gian Soulidity nền tối',
    myPage: 'Trang của tôi', closeAccountMenu: 'Đóng trình đơn tài khoản',
    accountLanguageAria: 'Ngôn ngữ tài khoản', languageLabel: 'Ngôn ngữ',
    walletFirstTitle: 'Kết nối ví trước',
    walletFirstCopy: 'Sau khi kết nối ví, bạn có thể dùng OC của tôi, công cụ creator, lưu bản nháp, xuất bản và mint.',
    createMaker: 'Tạo maker', createMakerCopy: 'Xuất bản mẫu OC',
    makeOc: 'Tạo OC', makeOcCopy: 'Tiếp tục OC hiện tại',
    soulidityLinksAria: 'Tài khoản Soulidity và liên kết xã hội', soulidityMySouls: 'Soul của tôi',
    socialProfile: 'Hồ sơ xã hội', community: 'Cộng đồng', marketplace: 'Chợ giao dịch',
    browseTemplates: 'Duyệt mẫu', browseTemplatesCopy: 'Tìm maker để bắt đầu',
    docsCopy: 'Giao thức và cấp quyền', templatePlaza: 'Quảng trường mẫu',
    templateHero: 'Chọn mẫu của họa sĩ rồi tạo OC của bạn',
    templateHeroCopy: 'Chọn Maker, ghép các Bộ phận và lưu nhân vật cùng công thức, bản chụp giấy phép, nguồn gốc và bản ghi trên chuỗi.',
    platformMetricsAria: 'Chỉ số nền tảng', publicMakers: 'Maker công khai',
    mainnetObjects: 'Đối tượng Mainnet', assetQuilts: 'Quilt tài nguyên', search: 'Tìm kiếm',
    searchPlaceholder: 'Tìm phong cách, tác giả hoặc giấy phép…', templateFiltersAria: 'Bộ lọc mẫu',
    filterAll: 'Tất cả', filterDaily: 'Biểu tượng hằng ngày', filterFantasy: 'Giả tưởng', filterChibi: 'Chibi',
    networkStatusAria: 'Trạng thái mạng Animacraft', onchainNetworkKicker: 'Mạng trên chuỗi',
    backendlessRuntimeTitle: 'Môi trường Sui + Walrus không cần máy chủ',
    refreshMakers: 'Làm mới Maker', syncingMakers: 'Đang đồng bộ Maker…',
    templatePlazaBack: '← Về Quảng trường mẫu', sourceOnchain: 'Maker trên chuỗi',
    partsLabel: 'Bộ phận', itemsLabel: 'Vật phẩm', royaltyPolicy: 'Chính sách tiền bản quyền',
    viewMaker: 'Xem Maker', startMaking: 'Bắt đầu tạo OC', connectToMake: 'Kết nối để tạo',
    noMatchingMakers: 'Không tìm thấy Maker phù hợp.',
    noPublishedMakers: 'Chưa có Maker nào được đăng trên chuỗi',
    noPublishedMakersCopy: 'Animacraft chỉ hiển thị Maker được phát hiện từ Sui và khôi phục bằng tài sản Walrus đã chứng nhận. Hãy trở thành nhà sáng tạo đầu tiên.',
    createFirstMaker: 'Tạo Maker đầu tiên', byCreator: 'tác giả: {creator}',
    templateSamplesAria: 'Mẫu minh họa của {name}', makerPreviewAlt: 'Xem trước {name}',
    noPublishedMakerCover: 'Chưa có ảnh bìa đã đăng', docsTitle: 'Cẩm nang Animacraft',
    docsIntro: 'Chọn lộ trình dành cho người chơi, tác giả, phát hành hoặc tham khảo. Mỗi hướng dẫn bám sát quy trình Maker → OC hiện có và ghi rõ ranh giới Canonical Soul vẫn đang khóa.',
    docsArchitectureKicker: 'Kiến trúc sản xuất',
    docsArchitectureTitle: 'Từ tác giả đến người chơi mà không cần cơ sở dữ liệu máy chủ',
    docsArchitectureCopy: 'Ví ký các ghi chép cốt lõi, Walrus lưu gói phát hành có phiên bản đầy đủ, còn Sui ghi quyền sở hữu, vòng đời, kinh tế và phép chiếu quy tắc tương đương của Maker. Sự kiện Maker đã đăng tạo thư viện công khai mà không cần cơ sở dữ liệu Animacraft.',
    walletDisconnected: 'Chưa kết nối ví', accountGuest: 'Người dùng Animacraft',
    continueMakerSession: 'Tiếp tục phiên Maker đã chọn', choosePublishedMaker: 'Hãy chọn một Maker đã đăng trong Mẫu trước',
    networkLabel: 'Mạng', chainNetworkNote: 'Mạng Sui dùng cho giao dịch của ví.',
    chainWalletLabel: 'Ví', chainWalletNotConnected: 'Chưa kết nối',
    chainWalletReady: 'Sẵn sàng ký giao dịch tác giả và OC.', chainWalletNeedConnect: 'Kết nối trước khi đăng hoặc mint.',
    discoveryLabel: 'Khám phá', discoverySyncing: 'Đang đồng bộ Maker', chainDerived: 'Từ on-chain', waiting: 'Đang chờ',
    discoveryReadyNote: 'Maker đã đăng được tìm từ sự kiện Sui và khôi phục từ Manifest Walrus đã chứng nhận.',
    discoverySetupNote: 'Cấu hình ID gói đã đăng để bật thư viện Maker on-chain công khai.',
  }),
});
const PROTOCOL_ARTICLE_IDS = Object.freeze([
  'introduction',
  'creator-quick-start',
  'player-quick-start',
  'player-test-preflight',
  'walrus-sui-publish',
  'chain-truth',
]);

const DRAFT_DELETE_COPY = Object.freeze({
  en: { action: 'Delete local draft', confirm: 'Permanently delete', cancel: 'Cancel',
    warning: 'Permanently delete “{name}” from this browser? Its local assets and version history will also be deleted. Export Project ZIP first if you need a backup. Published on-chain assets are not deleted.',
    busy: 'Finish or retry the current save before deleting.', deleting: 'Deleting local draft…', stale: 'The draft or wallet changed. Reopen Manage and review the current draft.' },
  zh: { action: '删除本地草稿', confirm: '永久删除', cancel: '取消',
    warning: '永久删除此浏览器中的“{name}”？本地素材和版本历史也会删除。如需备份，请先导出 Project ZIP。不会删除已发布的链上资产。',
    busy: '请先完成或重试当前保存，再删除。', deleting: '正在删除本地草稿…', stale: '草稿或钱包已变化，请重新打开管理并核对当前草稿。' },
  ja: { action: 'ローカル下書きを削除', confirm: '完全に削除', cancel: 'キャンセル',
    warning: 'このブラウザの「{name}」を完全に削除しますか？ローカル素材と履歴も削除されます。必要なら先に Project ZIP を書き出してください。公開済みのオンチェーン資産は削除されません。',
    busy: '先に保存を完了または再試行してください。', deleting: '下書きを削除中…', stale: '下書きまたはウォレットが変わりました。管理を開き直してください。' },
  ko: { action: '로컬 초안 삭제', confirm: '영구 삭제', cancel: '취소',
    warning: '이 브라우저의 “{name}”을 영구 삭제할까요? 로컬 자료와 버전 기록도 삭제됩니다. 백업이 필요하면 먼저 Project ZIP을 내보내세요. 게시된 온체인 자산은 삭제되지 않습니다.',
    busy: '먼저 저장을 완료하거나 재시도하세요.', deleting: '로컬 초안 삭제 중…', stale: '초안 또는 지갑이 변경되었습니다. 관리를 다시 열어 확인하세요.' },
  vi: { action: 'Xóa bản nháp cục bộ', confirm: 'Xóa vĩnh viễn', cancel: 'Hủy',
    warning: 'Xóa vĩnh viễn “{name}” khỏi trình duyệt này? Tài nguyên cục bộ và lịch sử phiên bản cũng bị xóa. Hãy xuất Project ZIP trước nếu cần sao lưu. Tài sản đã đăng on-chain không bị xóa.',
    busy: 'Hoàn tất hoặc thử lưu lại trước khi xóa.', deleting: 'Đang xóa bản nháp…', stale: 'Bản nháp hoặc ví đã thay đổi. Mở lại phần quản lý để kiểm tra.' },
});

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function shortAddress(value) {
  const address = String(value || '');
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '';
}

function exactDraftRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('An exact Maker v8 draft record is required.');
  }
  if (typeof value.draftId !== 'string' || !value.draftId) {
    throw new TypeError('Maker v8 draftId is required.');
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) {
    throw new TypeError('Maker v8 draft revision must be a positive integer.');
  }
  assertMakerV8Document(value.document, { mode: 'draft' });
  return value;
}

function exactPlayerSession(value, expectedRootId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('An exact Fresh-v8 Player session is required.');
  }
  const rootId = String(expectedRootId || '').toLowerCase();
  const contentCommitment = value?.player?.evidence?.contentCommitment;
  const makerVersion = String(value?.player?.makerVersion ?? '');
  if (!EXACT_OBJECT_ID.test(rootId)
    || value.schemaVersion !== PLAYER_SESSION_SCHEMA
    || value.status !== 'READY'
    || value.rootId !== rootId
    || value.player?.rootId !== rootId
    || value.player?.evidence?.rootId !== rootId
    || !value.player?.document
    || !value.recipe
    || value.recipe.rootId !== rootId
    || String(value.recipe.makerVersion ?? '') !== makerVersion
    || value.recipe.rootContentCommitment !== contentCommitment
    || !Array.isArray(value.recipe.selections)
    || !value.loadout
    || value.loadout.rootId !== rootId
    || String(value.loadout.makerVersion ?? '') !== makerVersion
    || value.loadout.rootContentCommitment !== contentCommitment
    || !Array.isArray(value.loadout.selections)
    || typeof contentCommitment !== 'string'
    || !contentCommitment
    || !value.execution
    || typeof value.execution !== 'object') {
    throw new TypeError('Fresh-v8 Player session does not match the selected certified Maker Root.');
  }
  return value;
}

function creatorCapabilities({ publication = false, versionHistory = false, localPlayer = false, projectExport = false, projectImport = false, styleAsset = false, recoveryCopy = false, importing = false, packCreate = false, packOpen = false } = {}) {
  if (importing) return { default: false, controls: {} };
  const enabled = [
    'creator-tab', 'close-tool', 'review-preflight', 'run-preflight', 'back-library', 'select-part', 'select-item',
    'select-style', 'toggle-part-preview', 'move-part', 'set-preview-mode',
    'show-all-parts', 'show-current-part', 'canvas-zoom', 'toggle-pixel',
    'undo', 'redo', 'save', 'manage-lifecycle', 'part-name', 'part-required',
    'part-visible', 'part-export-background', 'part-default', 'set-default-style', 'item-name', 'style-name', 'maker-name', 'maker-summary',
    'maker-license-kind', 'maker-license-note', 'maker-creator', 'maker-style',
    'select-track', 'select-style-binding', 'add-track', 'track-name', 'toggle-track-lock',
    'move-track', 'delete-track', 'assign-style-track', 'sync-linked-track-order',
    'stage-composable-item', 'read-composable-item-operations', 'continue-composable-item',
    'admission-product-id', 'review-composable-admission', 'stage-composable-admission',
    'review-composable-product', 'product-control-recipient',
    'select-channel', 'add-channel', 'delete-channel', 'channel-name', 'channel-default-swatch',
    'add-swatch', 'delete-swatch', 'swatch-name', 'swatch-hint', 'swatch-mid', 'swatch-stop', 'style-channel',
    'rule-owner-choice', 'rule-type-choice', 'rule-match-choice', 'rule-target-choice',
    'rule-owner-search', 'rule-target-search', 'add-rule', 'delete-rule', 'edit-selection-rules',
    'rules-editor-intent', 'edit-style-visibility', 'clear-style-visibility', 'apply-style-visibility',
    'visibility-match-choice', 'visibility-polarity-choice', 'visibility-target-choice', 'visibility-target-search',
    'select-soul-document', 'soul-document-content', 'reset-soul-document', 'reset-all-soul',
    'composable-mode', 'wardrobe-part-mode', 'part-capacity',
    'third-party-admission', 'item-assetization', 'refresh-composable-products', 'refresh-composable-makers', 'inspect-composable-maker', 'select-composable-part', 'composable-artwork', 'composable-product-setting', 'save-composable-settings', 'prepare-composable-storage', 'read-composable-upload-history',
    'review-composable-item', 'create-composable-product', 'recover-composable-product', 'review-composable-upload', 'continue-composable-upload', ...CREATOR_STYLE_VALUE_ACTIONS, 'edit-position', 'confirm-position',
  ];
  if (versionHistory) enabled.push(
    'open-version-history', 'retry-version-history', 'close-version-history',
    'restore-checkpoint',
  );
  if (publication) enabled.push('publish');
  if (localPlayer) enabled.push('open-player');
  if (packCreate) enabled.push('add-expansion');
  if (packOpen) enabled.push('open-expansion-pack-studio');
  if (projectExport) enabled.push('export-project');
  if (projectImport) enabled.push('import-project');
  if (recoveryCopy) enabled.push('save-recovery-copy');
  if (styleAsset) enabled.push('style-asset', 'maker-cover', 'remove-maker-cover', 'add-part', 'add-item', 'add-style',
    'copy-part', 'copy-item', 'copy-style', 'delete-part', 'delete-item', 'delete-style');
  return {
    default: false,
    controls: Object.fromEntries(enabled.map((action) => [action, true])),
  };
}

function playerCapabilities({
  recipe = false,
  reset = false,
  render = false,
  exportSettings = false,
  complete = false,
  recovery = false,
  packAcquire = false,
  session = null,
} = {}) {
  const enabled = [
    'player-part', 'player-palette', 'player-close-palette', 'player-info',
    'close-player-info', 'close-player-info-backdrop',
    'player-profile-name', 'player-profile-world', 'player-profile-description',
    'player-profile-tags', 'player-soul-document', 'player-reset-soul-document',
    'player-reset-all-soul', 'player-export', 'player-retry-save',
  ];
  if (reset) enabled.push('player-reset');
  if (render) enabled.push(
    'player-preview-export', 'close-player-export', 'close-player-export-backdrop',
    'player-export-retry', 'player-export-recipe', 'player-download-png',
  );
  if (exportSettings) enabled.push('player-export-size', 'player-export-background');
  if (complete) enabled.push('player-complete', 'player-confirm-complete',
    'player-confirm-journey-step', 'player-cancel-journey-step',
    'player-export-envelope-recovery', 'player-import-envelope-recovery', 'player-clear-envelope-recovery',
    'player-start-new-completion', 'player-open-completed-soul');
  if (recovery) enabled.push('player-select-recovery', 'player-export-recovery');
  if (packAcquire) enabled.push('player-acquire-expansion-v8', 'player-confirm-pack-v8',
    'player-cancel-pack-v8', 'player-recover-pack-v8');
  const controls = Object.fromEntries(enabled.map((action) => [action, true]));
  if (recipe && session?.player?.document) {
    for (const output of session.player.document.outputs || []) {
      controls[`player-output:${output.key}`] = true;
    }
    for (const part of session.player.document.parts || []) {
      if (part.required !== true && part.kind !== 'LAST_BASTION') {
        controls[`player-none:${part.key}`] = true;
      }
      for (const item of part.items || []) {
        for (const style of item.styles || []) {
          const choiceId = `base:${part.key}:${item.key}:${style.key}`;
          controls[`player-item:${choiceId}`] = true;
          controls[`player-style:${choiceId}`] = true;
        }
      }
    }
    for (const choice of [
      ...(session.player.contextualChoices?.packStyles || []),
      ...(session.player.contextualChoices?.externalStyles || []),
    ]) {
      const part = makerV8PlayerPart(session.player, choice)?.definition;
      if (!Number.isSafeInteger(part?.capacity) || part.capacity < 1) continue;
      if (part.required !== true && part.kind !== 'LAST_BASTION') {
        controls[`player-none:${makerV8PlayerPartUiKey(session.player, choice)}`] = true;
      }
      const channel = makerV8PlayerColor(session.player, choice)?.definition;
      for (const swatch of channel?.swatches ?? []) {
        controls[`player-color:${makerV8PlayerColorControlKey(makerV8PlayerColorEntry(session.player, choice, swatch.key))}`] = true;
      }
      const choiceId = String(
        choice.id
        || `${choice.source || 'BASE'}:${choice.partKey || ''}:${choice.itemKey || ''}:${choice.styleKey || ''}`,
      );
      controls[`player-item:${choiceId}`] = true;
      controls[`player-style:${choiceId}`] = true;
      if (choice.source === 'PACK' && choice.access?.accessible === true && choice.access?.canEquip === true) {
        controls[`player-expansion-v8:${choice.releaseId}`] = true;
      }
    }
    for (const channel of session.player.document.colors || []) {
      for (const swatch of channel.swatches || []) {
        controls[`player-color:${channel.key}:${swatch.key}`] = true;
      }
    }
  }
  return {
    default: false,
    controls,
  };
}

function connectionAccount(value) {
  if (!value || typeof value !== 'object') return null;
  return value.account && typeof value.account === 'object' ? value.account : value;
}

export function normalizeOriginalWalletConnection(value) {
  const account = connectionAccount(value);
  const address = String(account?.address || value?.address || '').toLowerCase();
  if (!EXACT_ADDRESS.test(address) || address === ZERO_ADDRESS) {
    return Object.freeze({ connected: false, address: null, network: null, provider: null });
  }
  const chains = Array.isArray(account?.chains)
    ? account.chains.map((chain) => String(chain).toLowerCase())
    : [];
  if (!chains.includes('sui:mainnet')) {
    return Object.freeze({ connected: false, address: null, network: null, provider: null });
  }
  return Object.freeze({
    connected: true,
    address,
    network: 'mainnet',
    provider: String(value?.wallet?.name || value?.provider || 'Sui wallet'),
  });
}

function selectedRecords(document, state) {
  const part = document.parts.find((row) => row.key === state.selectedPartKey)
    || document.parts[0]
    || null;
  const recipeSelection = document.defaultRecipe.selections.find(row => row.partKey === part?.key);
  const item = part?.items.find((row) => row.key === state.selectedItemKey)
    || part?.items.find((row) => row.key === recipeSelection?.itemKey)
    || part?.items[0]
    || null;
  const style = item?.styles.find((row) => row.key === state.selectedStyleKey)
    || item?.styles.find((row) => item.key === recipeSelection?.itemKey && row.key === recipeSelection.styleKey)
    || item?.styles.find((row) => row.key === item.defaultStyleKey)
    || item?.styles[0]
    || null;
  return { part, item, style };
}

function normalizeSelection(document, state) {
  const selected = selectedRecords(document, state);
  state.selectedPartKey = selected.part?.key || '';
  state.selectedItemKey = selected.item?.key || '';
  state.selectedStyleKey = selected.style?.key || '';
  return selected;
}

export function renderOriginalCreatorWorkspace(
  recordValue,
  stateValue = {},
  capabilitiesValue = {},
) {
  const record = exactDraftRecord(recordValue);
  const state = {
    ...stateValue,
    draftId: record.draftId,
    revision: record.revision,
    savedAt: record.updatedAt,
    lifecycle: stateValue.lifecycle || {
      label: 'Draft',
      manageLabel: 'Manage status',
      badgeClass: 'draft',
    },
  };
  return renderApprovedMakerV8Workspace(
    projectMakerV8WorkspaceView(record.document, state, capabilitiesValue),
  );
}

function requiredMethod(value, name, label) {
  if (typeof value?.[name] !== 'function') {
    throw new TypeError(`${label}.${name} is required.`);
  }
  return value[name].bind(value);
}

function optionalMethod(value, name) {
  return typeof value?.[name] === 'function' ? value[name].bind(value) : null;
}

function makerReferenceFromLocation(win) {
  const match = String(win?.location?.pathname || '').match(/\/maker\/([^/]+)$/);
  if (!match) return '';
  try {
    const reference = decodeURIComponent(match[1]).toLowerCase();
    return EXACT_OBJECT_ID.test(reference) ? reference : '';
  } catch {
    return '';
  }
}

function pageFromLocation(win) {
  if (makerReferenceFromLocation(win)) return 'template';
  const hash = String(win?.location?.hash || '').replace(/^#/, '').split('/')[0];
  return ORIGINAL_PRODUCT_PAGES.includes(hash) ? hash : 'templates';
}

function safeConfiguredExternalUrl(win, value) {
  const configured = String(value || '').trim();
  if (!configured) return '';
  try {
    const url = new URL(configured, win?.location?.origin);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function configuredSoulidityAppUrl(win) {
  const candidates = [
    win?.ANIMACRAFT_CONFIG,
    win?.SoulidityMakerV8,
    win?.SoulidityV8Execution,
  ];
  const configured = candidates.find((candidate) => (
    candidate && typeof candidate === 'object' && Object.hasOwn(candidate, 'soulidityAppUrl')
  ));
  return safeConfiguredExternalUrl(win, configured?.soulidityAppUrl);
}

function normalizedOriginalLocale(value) {
  const locale = String(value || '').toLowerCase().split('-')[0];
  return DOCS_LOCALES.includes(locale) ? locale : 'en';
}

function initialOriginalLocale(win, doc) {
  try {
    const stored = win?.localStorage?.getItem?.(ORIGINAL_LOCALE_STORAGE_KEY);
    if (DOCS_LOCALES.includes(stored)) return stored;
  } catch {
    // Browsing remains available when storage is blocked.
  }
  const documentLocale = String(doc?.documentElement?.lang || '').split('-')[0];
  return normalizedOriginalLocale(documentLocale || win?.navigator?.language || 'en');
}

function formattedMessage(template, variables = {}) {
  return Object.entries(variables).reduce(
    (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
    String(template || ''),
  );
}

function originalMessage(locale, key, fallback = key, variables = {}) {
  const normalized = normalizedOriginalLocale(locale);
  const translated = ORIGINAL_GLOBAL_I18N[normalized]?.[key]
    ?? ORIGINAL_GLOBAL_I18N.en[key]
    ?? fallback;
  return formattedMessage(translated, variables);
}

function safeCssColor(value, fallback) {
  const candidate = String(value || '');
  return /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(candidate) ? candidate : fallback;
}

function publicTemplateId(value) {
  return String(value?.rootId || value?.id || value?.objectId || '').toLowerCase();
}

function publicTemplateDocument(value) {
  const candidates = [
    value?.document,
    value?.makerDocument,
    value?.manifest?.document,
    value?.manifest?.maker,
  ];
  return candidates.find((candidate) => candidate && typeof candidate === 'object') || null;
}

function publicTemplateParts(value) {
  const document = publicTemplateDocument(value);
  if (Array.isArray(value?.parts)) return value.parts;
  if (Array.isArray(document?.parts)) return document.parts;
  if (Array.isArray(value?.player?.parts)) return value.player.parts;
  return [];
}

function publicTemplateMetrics(value) {
  const document = publicTemplateDocument(value);
  const parts = Array.isArray(document?.parts) ? document.parts : [];
  const countedItems = parts.reduce((total, part) => (
    total + (Array.isArray(part?.items) ? part.items.length : 0)
  ), 0);
  const partCount = Number(
    value?.counts?.parts
    ?? value?.partCount
    ?? value?.metrics?.parts
    ?? parts.length,
  );
  return {
    parts: Number.isSafeInteger(partCount) && partCount >= 0 ? partCount : parts.length,
    items: countedItems,
  };
}

function publicTemplateLicense(value) {
  const document = publicTemplateDocument(value);
  return String(
    document?.metadata?.license?.kind
    || value?.license?.label
    || value?.license?.kind
    || value?.license
    || value?.licenseKind
    || document?.commerce?.license?.label
    || document?.commerce?.license?.kind
    || 'Creator terms',
  );
}

function publicTemplateRecord(value) {
  const document = publicTemplateDocument(value);
  const metadata = document?.metadata || {};
  const creator = value?.creator && typeof value.creator === 'object'
    ? value.creator.name || value.creator.address
    : value?.creator;
  const style = String(
    value?.style
    || value?.categoryLabel
    || metadata.style
    || metadata.world
    || 'On-chain Maker',
  );
  const categorySource = String(value?.category || style).toLowerCase();
  const category = ['daily', 'fantasy', 'chibi'].find((candidate) => (
    categorySource.includes(candidate)
  )) || 'all';
  const id = publicTemplateId(value);
  const parts = publicTemplateParts(value);
  return Object.freeze({
    id,
    makerId: id,
    title: String(value?.title || value?.name || metadata.name || 'Untitled Maker'),
    summary: String(value?.summary || value?.description || metadata.summary || ''),
    creator: String(
      value?.creatorName
      || metadata.creator
      || value?.creatorAddress
      || creator
      || value?.ownerAddress
      || value?.controlAddress
      || 'On-chain creator',
    ),
    style,
    category,
    license: publicTemplateLicense(value),
    licenseNote: String(
      document?.metadata?.license?.note
      || value?.license?.note
      || value?.licenseNote
      || document?.commerce?.license?.note
      || 'The certified Maker release defines the exact usage terms.',
    ),
    royaltyBps: Number(
      document?.commerce?.makerResaleRoyaltyBps
      ?? value?.makerResaleRoyaltyBps
      ?? value?.royaltyBps
      ?? 0,
    ),
    lifecycle: String(value?.lifecycle || value?.status || 'ACTIVE').toUpperCase(),
    accent: safeCssColor(value?.accent || metadata.accent, '#7b5cff'),
    secondary: safeCssColor(value?.secondary || metadata.secondary, '#f0a23a'),
    partLabels: parts.slice(0, 12).map((part) => String(part?.label || part?.name || part?.key || 'Part')),
    metrics: publicTemplateMetrics(value),
    raw: value,
  });
}

function certifiedAssets(value) {
  const candidates = [
    value?.certifiedAssets,
    value?.assets,
    value?.manifest?.certifiedAssets,
    value?.manifest?.assets,
  ];
  return candidates.find(Array.isArray) || [];
}

function isCertifiedAssetDescriptor(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof value.assetId === 'string'
    && typeof value.blobId === 'string'
    && typeof value.mediaType === 'string'
    && Number.isSafeInteger(value.byteLength)
    && typeof value.sha256 === 'string',
  );
}

function certifiedCoverAsset(value) {
  const direct = [
    value?.coverAsset,
    value?.cover?.asset,
    value?.manifest?.coverAsset,
    value?.document?.metadata?.coverAsset,
  ].find(isCertifiedAssetDescriptor);
  if (direct) return direct;
  const document = publicTemplateDocument(value);
  const wantedIds = new Set([
    value?.coverAssetId,
    value?.cover?.assetId,
    value?.manifest?.coverAssetId,
    document?.metadata?.coverAssetId,
  ].filter((candidate) => typeof candidate === 'string' && candidate));
  const assets = certifiedAssets(value).filter(isCertifiedAssetDescriptor);
  return assets.find((asset) => wantedIds.has(asset.assetId))
    || assets.find((asset) => String(asset.kind || '').toLowerCase() === 'cover')
    || assets.find((asset) => /(?:^|[-_])cover(?:[-_]|$)/i.test(asset.assetId))
    || null;
}

export function createOriginalProductApp({
  bridge,
  walletUi,
  win = globalThis.window,
  doc = globalThis.document,
  docsCenterFactory = createDocsCenter,
} = {}) {
  if (!win || !doc) throw new TypeError('The approved browser window and document are required.');
  const openWalletSelector = requiredMethod(walletUi, 'openWalletSelector', 'walletUi');
  const disconnectWallet = requiredMethod(walletUi, 'disconnect', 'walletUi');
  const getConnection = requiredMethod(walletUi, 'getConnection', 'walletUi');
  const setWalletLocale = requiredMethod(walletUi, 'setLocale', 'walletUi');
  const bridgeReady = requiredMethod(bridge, 'ready', 'bridge');
  const bridgeSubscribe = requiredMethod(bridge, 'subscribe', 'bridge');
  const listTemplates = requiredMethod(bridge, 'listTemplates', 'bridge');
  const getTemplate = requiredMethod(bridge, 'getTemplate', 'bridge');
  const loadCertifiedAsset = requiredMethod(bridge, 'loadCertifiedAsset', 'bridge');
  const openPlayerSession = requiredMethod(bridge, 'openPlayerSession', 'bridge');
  const createDraft = requiredMethod(bridge, 'createDraft', 'bridge');
  const listDrafts = requiredMethod(bridge, 'listDrafts', 'bridge');
  const getDraft = requiredMethod(bridge, 'getDraft', 'bridge');
  const createPackDraft = optionalMethod(bridge, 'createPackDraft');
  const listPackDrafts = optionalMethod(bridge, 'listPackDrafts');
  const listComposableProducts = optionalMethod(bridge, 'listComposableProducts');
  const reviewComposableItem = optionalMethod(bridge, 'reviewComposableItem');
  const reviewComposableProduct = optionalMethod(bridge, 'reviewComposableProduct');
  const reviewComposableAdmission = optionalMethod(bridge, 'reviewComposableAdmission');
  const stageComposableOperation = optionalMethod(bridge, 'stageComposableOperation');
  const listComposableOperations = optionalMethod(bridge, 'listComposableOperations');
  const continueComposableOperation = optionalMethod(bridge, 'continueComposableOperation');
  const listComposableMakers = optionalMethod(bridge, 'listComposableMakers');
  const getComposableMaker = optionalMethod(bridge, 'getComposableMaker');
  const prepareComposableStorage = optionalMethod(bridge, 'prepareComposableStorage');
  const listComposableUploads = optionalMethod(bridge, 'listComposableUploads');
  const advanceComposableUpload = optionalMethod(bridge, 'advanceComposableUpload');
  const reviewComposableUpload = optionalMethod(bridge, 'reviewComposableUpload');
  const createComposableUploadProduct = optionalMethod(bridge, 'createComposableUploadProduct');
  const recoverComposableAction = optionalMethod(bridge, 'recoverComposableAction');
  const composableArtworkStore = createMakerV8ComposableArtworkStore(win.indexedDB || globalThis.indexedDB);
  const loadPackDraft = optionalMethod(bridge, 'loadPackDraft');
  const savePackDraft = optionalMethod(bridge, 'savePackDraft');
  const bindPackParent = optionalMethod(bridge, 'bindPackParent');
  const renderPackPreview = optionalMethod(bridge, 'renderPackPreview');
  const upsertPackAsset = optionalMethod(bridge, 'upsertPackAsset');
  let packAssetFlight = null;
  let packSaveFlight = null;
  let creatorPackRequest = 0;
  let creatorPackFlight = null;
  const deleteDraft = optionalMethod(bridge, 'deleteDraft');
  const dispatchDraftCommand = requiredMethod(bridge, 'dispatchDraftCommand', 'bridge');
  const replaceDraftDocument = requiredMethod(bridge, 'replaceDraftDocument', 'bridge');
  const dispatchDraftTransaction = optionalMethod(bridge, 'dispatchDraftTransaction');
  const replaceDraftSnapshot = optionalMethod(bridge, 'replaceDraftSnapshot');
  const listDraftVersions = optionalMethod(bridge, 'listDraftVersions');
  const listMakerLineage = optionalMethod(bridge, 'listMakerLineage');
  const createSuccessorDraft = optionalMethod(bridge, 'createSuccessorDraft');
  const restoreDraftVersion = optionalMethod(bridge, 'restoreDraftVersion');
  const getPlayerSnapshot = optionalMethod(bridge, 'getPlayerSnapshot');
  const updatePlayerRecipe = optionalMethod(bridge, 'updatePlayerRecipe');
  const resetPlayerRecipe = optionalMethod(bridge, 'resetPlayerRecipe');
  const renderPlayerPreview = optionalMethod(bridge, 'renderPlayerPreview');
  const renderPlayerExport = optionalMethod(bridge, 'renderPlayerExport');
  const renderDraftPreview = optionalMethod(bridge, 'renderDraftPreview');
  const openLocalPlayer = optionalMethod(bridge, 'openLocalPlayer');
  const exportProjectZip = optionalMethod(bridge, 'exportProjectZip');
  const replaceDraftFromProjectZip = optionalMethod(bridge, 'replaceDraftFromProjectZip');
  const completePlayerJourney = optionalMethod(bridge, 'completePlayerJourney');
  const preparePlayerAction = optionalMethod(bridge, 'preparePlayerAction');
  const executePlayerAction = optionalMethod(bridge, 'executePlayerAction');
  const recoverPlayerAction = optionalMethod(bridge, 'recoverPlayerAction');
  const getPendingPlayerAction = optionalMethod(bridge, 'getPendingPlayerAction');
  const openPlayerReception = optionalMethod(bridge, 'openPlayerReception');
  const exportPlayerEnvelopeRecovery = optionalMethod(bridge, 'exportPlayerEnvelopeRecovery');
  // Separate from playerUi/project autosave and diagnostic snapshots. Signed
  // envelope recovery is exported only through an explicit local download.
  const envelopeRecoveryByScope = new Map();
  let envelopeRecoveryStageGeneration = 0;
  let envelopeRecoveryScopeKey = '';
  const prepareLifecycleAction = optionalMethod(bridge, 'prepareLifecycleAction');
  const prepareMakerPublication = optionalMethod(bridge, 'prepareMakerPublication');
  const inspectMakerPublication = optionalMethod(bridge, 'inspectMakerPublication');
  const signMakerPublication = optionalMethod(bridge, 'signMakerPublication');
  const continueMakerPublication = optionalMethod(bridge, 'continueMakerPublication');
  const cancelMakerPublicationReview = optionalMethod(bridge, 'cancelMakerPublicationReview');
  const getPublishedMaker = optionalMethod(bridge, 'getPublishedMaker');
  const publishedMakers = new Map();
  let publicationFlight = null;
  let publicationGeneration = 0;
  let chainVersionFlight = null;
  let archiveReview = null;
  const requestLifecycleSignature = optionalMethod(bridge, 'requestLifecycleSignature');
  const recoverLifecycleAction = optionalMethod(bridge, 'recoverLifecycleAction');
  const cleanups = [];
  const mount = doc.getElementById('makerV4CreatorMount');
  const playerMount = doc.getElementById('makerV4PlayerMount');
  const localizedBaselines = new WeakMap();
  let creatorComposition = null;
  let playerComposition = null;
  let creatorRetryFlight = null;
  let creatorRecoveryFlight = null;
  const recoverDraftCopy = optionalMethod(bridge, 'recoverDraftCopy');
  let packAcquisitionFlight = null;
  let playerConfirmation = null;
  let playerConfirmationSequence = 0;
  let startupCreatorRoute = pageFromLocation(win) === 'creator';
  let creatorDeleteIntent = null;
  let creatorDeleteFlight = null;
  const deletedDraftReadEpochs = new Map();
  let creatorAssetFlight = null;
  let creatorConnectionGeneration = 0;
  let libraryPreviewFlight = null;
  let creatorStructureRequest = 0;
  let creatorPendingStructureSelection = null;
  let creatorPositionGesture = null;
  let creatorSpacePressed = false;
  const creatorBufferedInputActions = new Set([
    'style-x', 'style-y', 'style-scale', 'style-rotation',
    'maker-name', 'maker-summary', 'maker-license-note', 'maker-creator', 'maker-style', 'part-name', 'item-name', 'style-name', 'track-name',
    'channel-name', 'swatch-name',
  ]);
  let creatorInputSession = null;
  let creatorSortDrag = null;
  let creatorInputPointerHandoff = null;
  let creatorRenderDeferredForInput = false;
  let creatorTransientRenderFlight = null;
  let creatorTransientRenderQueued = false;
  const state = {
    destroyed: false,
    playerRecovery: null,
    playerRecipeNeedsSave: false,
    localPlayer: null,
    localPlayerRequest: 0,
    localNavigationRequest: 0,
    localPlayerDrains: new Set(),
    route: pageFromLocation(win),
    locale: initialOriginalLocale(win, doc),
    connection: normalizeOriginalWalletConnection(null),
    bridgeState: null,
    templatesStatus: 'loading',
    templates: [],
    templatesError: '',
    templateRefresh: 0,
    templateDetails: new Map(),
    templateCoverUrls: new Map(),
    filter: 'all',
    search: '',
    templateId: makerReferenceFromLocation(win),
    templateDetailStatus: 'idle',
    templateDetail: null,
    templateDetailError: '',
    templateDetailCoverUrl: '',
    templateDetailRequest: 0,
    playerSession: null,
    playerStatus: 'idle',
    playerError: '',
    playerRequest: 0,
    playerMutationRequest: 0,
    playerMutationQueue: Promise.resolve(),
    playerRecipeMutationTicket: 0,
    playerRecipeMutationPending: 0,
    playerRenderRequest: 0,
    playerProjectGeneration: 0,
    playerProjectSaveQueue: Promise.resolve(),
    playerProjectSaveTail: null,
    playerPendingProjectSave: null,
    playerProjectStorageKey: '',
    playerProjectBaseRevision: null,
    playerProjectBaseHash: '',
    playerProjectBaseWriterId: '',
    playerCompletionFlight: null,
    playerWriterId: `player-${Date.now().toString(36)}-${(++playerWriterSequence).toString(36)}`,
    playerPendingRootId: '',
    playerAssetUrls: {},
    playerRenderRecord: null,
    playerExportRecord: null,
    playerExportRequest: 0,
    playerExportUrl: '',
    playerUi: null,
    docsCenter: null,
    drafts: [],
    draftsStatus: 'loading',
    draftsError: '',
    draftListRequest: 0,
    draftOpenRequest: 0,
    draftRecoveryRequest: 0,
    record: null,
    draftAssets: [],
    draftAssetUrls: {},
    draftCoverUrls: new Map(),
    creatorRenderRequest: 0,
    creatorRenderRecord: null,
    creatorRenderIdentity: '',
    creatorDraftGeneration: 0,
    creatorPersistIntent: 0,
    creatorPersistQueue: Promise.resolve(),
    creatorPendingSave: null,
    creatorIntentDocument: null,
    creatorPersistPending: 0,
    creatorPersistBlocked: false,
    previewStatus: '',
    projectExportPending: false,
    projectImportPending: false,
    creatorTab: 'structure',
    selectedPartKey: '',
    selectedItemKey: '',
    selectedStyleKey: '',
    selectedTrackKey: '',
    selectedColorKey: '',
    creatorOpenGradients: new Set(),
    editingPositionStyleKey: '',
    creatorStylePreview: null,
    ruleEditor: null,
    hiddenPartKeys: new Set(),
    previewMode: 'all',
    zoom: 1,
    undo: [],
    redo: [],
    saveState: 'saved',
    versionHistoryOpen: false,
    versionHistoryRequest: 0,
    versionHistoryStatus: 'idle',
    versionEntries: [],
    versionHistoryError: '',
    versionHistoryMessage: '',
    chainVersions: [],
    chainVersionStatus: '',
    chainVersionReview: null,
  };

  const byId = (id) => doc.getElementById(id);
  const listen = (target, type, listener, options) => {
    if (!target?.addEventListener) return;
    target.addEventListener(type, listener, options);
    cleanups.push(() => target.removeEventListener?.(type, listener, options));
  };

  const t = (key, fallback = key, variables = {}) => (
    originalMessage(state.locale, key, fallback, variables)
  );

  function canonicalJson(value) {
    const normalize = (candidate) => {
      if (Array.isArray(candidate)) return candidate.map(normalize);
      if (candidate && typeof candidate === 'object') {
        return Object.fromEntries(Object.keys(candidate).sort().flatMap((key) => (
          candidate[key] === undefined ? [] : [[key, normalize(candidate[key])]]
        )));
      }
      return candidate;
    };
    return JSON.stringify(normalize(value));
  }

  async function sha256Hex(value) {
    const cryptoApi = win.crypto || globalThis.crypto;
    const Encoder = win.TextEncoder || globalThis.TextEncoder;
    if (typeof cryptoApi?.subtle?.digest !== 'function' || typeof Encoder !== 'function') {
      throw new TypeError('Exact SHA-256 project evidence is unavailable.');
    }
    const bytes = new Encoder().encode(typeof value === 'string' ? value : canonicalJson(value));
    const digest = new Uint8Array(await cryptoApi.subtle.digest('SHA-256', bytes));
    return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function downloadAnchor(url, filename) {
    const anchor = doc.createElement?.('a');
    if (!anchor || typeof anchor.click !== 'function') {
      throw new TypeError('Browser downloads are unavailable.');
    }
    anchor.href = url;
    anchor.download = String(filename || 'animacraft-download');
    anchor.rel = 'noopener';
    anchor.hidden = true;
    doc.body?.appendChild?.(anchor);
    try { anchor.click(); }
    finally { anchor.remove?.(); }
    return url;
  }

  function safeDownloadName(value, fallback) {
    const normalized = String(value || '').trim().toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return normalized || fallback;
  }

  function downloadJson(value, filename = 'animacraft-recipe.json') {
    return downloadJsonText(JSON.stringify(value, null, 2), filename);
  }

  function downloadJsonText(serialized, filename) {
    const urls = browserObjectUrls();
    const BlobType = win.Blob || globalThis.Blob;
    if (!urls || typeof BlobType !== 'function') {
      throw new TypeError('Browser JSON downloads are unavailable.');
    }
    const url = urls.createObjectURL(new BlobType(
      [serialized],
      { type: 'application/json;charset=utf-8' },
    ));
    try {
      return downloadAnchor(url, filename);
    } finally {
      queueMicrotask(() => revokeObjectUrl(url));
    }
  }

  function decodeCanonicalBase64(value, label = 'render bytes') {
    if (typeof value !== 'string' || !value || value.length % 4 !== 0
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
      throw new TypeError(`${label} are not canonical Base64.`);
    }
    const decode = win.atob || globalThis.atob;
    const encode = win.btoa || globalThis.btoa;
    if (typeof decode !== 'function' || typeof encode !== 'function') {
      throw new TypeError('Canonical image decoding is unavailable.');
    }
    const binary = decode(value);
    if (encode(binary) !== value) throw new TypeError(`${label} are not canonical Base64.`);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  function exactCanonicalPng(value) {
    const width = value?.width;
    const height = value?.height;
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || value.schemaVersion !== PLAYER_RENDER_SCHEMA
      || value.mediaType !== 'image/png'
      || !Number.isSafeInteger(width) || width < 1 || width > 16_384
      || !Number.isSafeInteger(height) || height < 1 || height > 16_384
      || !Number.isSafeInteger(value.byteLength) || value.byteLength < 8
      || !EXACT_SHA256.test(value.sha256 || '')) {
      throw new TypeError('Fresh-v8 preview did not return one exact canonical PNG record.');
    }
    const bytes = decodeCanonicalBase64(value.bytesBase64, 'Fresh-v8 preview bytes');
    if (bytes.length !== value.byteLength
      || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) {
      throw new TypeError('Fresh-v8 preview PNG evidence is invalid.');
    }
    return Object.freeze({ ...structuredClone(value), bytes });
  }

  function browserObjectUrls() {
    const api = win.URL || globalThis.URL;
    return api && typeof api.createObjectURL === 'function'
      && typeof api.revokeObjectURL === 'function' ? api : null;
  }

  function pngBlob(record) {
    const BlobType = win.Blob || globalThis.Blob;
    if (typeof BlobType !== 'function') throw new TypeError('Browser image blobs are unavailable.');
    return new BlobType([record.bytes], { type: 'image/png' });
  }

  function revokeObjectUrl(value) {
    if (!value) return;
    try { browserObjectUrls()?.revokeObjectURL(value); } catch { /* Already released. */ }
  }

  function releasePlayerExportUrl({ clearRecord = true } = {}) {
    if (clearRecord) {
      state.playerExportRequest += 1;
      state.playerExportRecord = null;
    }
    revokeObjectUrl(state.playerExportUrl);
    state.playerExportUrl = '';
    if (state.playerUi?.export) state.playerUi.export.previewUrl = '';
  }

  function releaseDraftAssetUrls() {
    Object.values(state.draftAssetUrls).forEach(revokeObjectUrl);
    state.draftAssetUrls = {};
  }

  function releaseDraftCoverUrls() {
    for (const entry of state.draftCoverUrls.values()) revokeObjectUrl(entry.url);
    state.draftCoverUrls.clear();
  }

  function installDraftCover(record, assets) {
    const previous = state.draftCoverUrls.get(record.draftId);
    revokeObjectUrl(previous?.url);
    state.draftCoverUrls.delete(record.draftId);
    const coverId = record.document.metadata.coverAssetId;
    if (!coverId) return;
    const asset = assets?.find(row => row.assetId === coverId);
    const descriptor = record.document.assets.find(row => row.id === coverId);
    const urls = browserObjectUrls(), BlobType = win.Blob || globalThis.Blob;
    if (!urls || !asset || !descriptor || !['image/png', 'image/jpeg'].includes(asset.mediaType)
      || asset.mediaType !== descriptor.mediaType || asset.byteLength !== descriptor.byteLength) return;
    try {
      const bytes = decodeCanonicalBase64(asset.bytesBase64, 'Maker cover bytes');
      if (bytes.length !== descriptor.byteLength) return;
      state.draftCoverUrls.set(record.draftId, { revision: record.revision,
        url: urls.createObjectURL(new BlobType([bytes], { type: asset.mediaType })) });
    } catch { /* A missing cover preview never changes the saved draft. */ }
  }

  function installDraftAssets(assets) {
    releaseDraftAssetUrls();
    state.draftAssets = Array.isArray(assets) ? structuredClone(assets) : [];
    const urls = browserObjectUrls();
    const BlobType = win.Blob || globalThis.Blob;
    if (!urls || typeof BlobType !== 'function') return;
    for (const asset of state.draftAssets) {
      try {
        if (!asset || !['image/png', 'image/jpeg'].includes(asset.mediaType)) continue;
        const bytes = decodeCanonicalBase64(asset.bytesBase64, 'Maker draft asset bytes');
        if (bytes.length !== asset.byteLength) continue;
        state.draftAssetUrls[asset.assetId] = urls.createObjectURL(
          new BlobType([bytes], { type: asset.mediaType }),
        );
      } catch {
        // The canonical bridge renderer remains fail-closed for invalid draft assets.
      }
    }
    if (state.record) { installDraftCover(state.record, state.draftAssets); renderCreatorLibrary(); }
  }

  async function drawCanonicalPng(canvasId, recordValue, current) {
    const record = recordValue?.bytes ? recordValue : exactCanonicalPng(recordValue);
    const canvas = byId(canvasId);
    const context = canvas?.getContext?.('2d');
    const urls = browserObjectUrls();
    const ImageType = win.Image || globalThis.Image;
    if (!canvas || !context || !urls || typeof ImageType !== 'function') {
      throw new TypeError('The approved preview canvas is unavailable.');
    }
    const url = urls.createObjectURL(pngBlob(record));
    try {
      const image = new ImageType();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new TypeError('The canonical PNG could not be decoded.'));
        image.src = url;
      });
      if (!current() || byId(canvasId) !== canvas) return false;
      canvas.width = record.width;
      canvas.height = record.height;
      context.clearRect?.(0, 0, record.width, record.height);
      context.drawImage(image, 0, 0, record.width, record.height);
      return true;
    } finally {
      revokeObjectUrl(url);
    }
  }

  function localizedBaseline(node, kind, read) {
    let record = localizedBaselines.get(node);
    if (!record) {
      record = {};
      localizedBaselines.set(node, record);
    }
    if (!Object.hasOwn(record, kind)) record[kind] = read();
    return record[kind];
  }

  function renderI18n() {
    doc.documentElement.lang = state.locale === 'zh' ? 'zh-CN' : state.locale;
    doc.querySelectorAll?.('[data-i18n]').forEach((node) => {
      const fallback = localizedBaseline(node, 'text', () => node.textContent);
      node.textContent = t(node.dataset.i18n, fallback);
    });
    doc.querySelectorAll?.('[data-i18n-placeholder]').forEach((node) => {
      const fallback = localizedBaseline(node, 'placeholder', () => node.getAttribute?.('placeholder') || '');
      node.setAttribute?.('placeholder', t(node.dataset.i18nPlaceholder, fallback));
    });
    doc.querySelectorAll?.('[data-i18n-title]').forEach((node) => {
      const fallback = localizedBaseline(node, 'title', () => node.getAttribute?.('title') || '');
      node.setAttribute?.('title', t(node.dataset.i18nTitle, fallback));
    });
    doc.querySelectorAll?.('[data-i18n-aria-label]').forEach((node) => {
      const fallback = localizedBaseline(node, 'ariaLabel', () => node.getAttribute?.('aria-label') || '');
      node.setAttribute?.('aria-label', t(node.dataset.i18nAriaLabel, fallback));
    });
    if (byId('accountLanguage')) byId('accountLanguage').value = state.locale;
  }

  function renderProtocol() {
    const root = byId('protocolSteps');
    if (!root) return;
    const content = DOCS_CONTENT[state.locale] || DOCS_CONTENT.en;
    const articles = new Map(content.articles.map((article) => [article.id, article]));
    root.innerHTML = PROTOCOL_ARTICLE_IDS.map((articleId, index) => {
      const article = articles.get(articleId);
      if (!article) return '';
      return `
        <article class="protocol-card">
          <span>${String(index + 1).padStart(2, '0')}</span>
          <h2>${escapeHtml(article.title)}</h2>
          <p>${escapeHtml(article.summary)}</p>
        </article>`;
    }).join('');
  }

  function renderDocsHandbook() {
    const root = byId('docsHandbook');
    if (!root) return;
    try {
      state.docsCenter ||= docsCenterFactory(root);
      state.docsCenter.render(state.locale);
    } catch (error) {
      root.innerHTML = `
        <section class="docs-empty protocol-card" role="status">
          <h2>${escapeHtml(t('docsTitle', 'The Animacraft Handbook'))}</h2>
          <p>${escapeHtml(error?.message || t('docsIntro', 'The handbook is unavailable right now.'))}</p>
        </section>`;
    }
  }

  function templateCoverPlaceholder(template, { hidden = false } = {}) {
    return `<div class="published-cover-placeholder" data-maker-cover-fallback${hidden ? ' hidden' : ''}>
      <strong>Maker</strong>
      <span>${escapeHtml(t('noPublishedMakerCover', 'No published Maker cover'))}</span>
    </div>`;
  }

  function templateCoverMarkup(template, coverUrl, { lazy = false } = {}) {
    if (!coverUrl) return templateCoverPlaceholder(template);
    return `<img class="template-cover-image" data-maker-cover-image src="${escapeHtml(coverUrl)}" alt="${escapeHtml(t('makerPreviewAlt', '{name} preview', { name: template.title }))}"${lazy ? ' loading="lazy"' : ''} />
      ${templateCoverPlaceholder(template, { hidden: true })}`;
  }

  function bindTemplateCoverImageFallbacks(container) {
    container?.querySelectorAll?.('[data-maker-cover-image]').forEach((image) => {
      image.addEventListener?.('error', () => {
        image.hidden = true;
        const fallback = image.nextElementSibling;
        if (fallback?.matches?.('[data-maker-cover-fallback]')) fallback.hidden = false;
      }, { once: true });
    });
  }

  function filteredTemplates() {
    const query = state.search.trim().toLocaleLowerCase();
    return state.templates.filter((template) => {
      const matchesFilter = state.filter === 'all' || template.category === state.filter;
      const haystack = [
        template.title,
        template.creator,
        template.style,
        template.license,
        template.summary,
      ].join(' ').toLocaleLowerCase();
      return matchesFilter && (!query || haystack.includes(query));
    });
  }

  function renderTemplateCards() {
    const root = byId('templateGrid');
    if (!root) return;
    if (byId('publicMakerCount')) {
      byId('publicMakerCount').textContent = String(state.templates.length);
    }
    if (state.templatesStatus === 'loading') {
      root.innerHTML = `
        <section class="empty-state plaza-empty-state" role="status">
          <span class="empty-state-mark" aria-hidden="true">◎</span>
          <h2>${escapeHtml(t('syncingMakers', 'Loading certified Makers…'))}</h2>
          <p>${escapeHtml(t('bridgeReady', 'Reading the public Fresh-v8 catalog.'))}</p>
        </section>`;
      return;
    }
    if (state.templatesStatus === 'error') {
      root.innerHTML = `
        <section class="empty-state plaza-empty-state" role="status">
          <span class="empty-state-mark" aria-hidden="true">!</span>
          <h2>${escapeHtml(t('unavailable', 'Template Plaza is unavailable'))}</h2>
          <p>${escapeHtml(state.templatesError || 'The certified Maker catalog could not be read.')}</p>
        </section>`;
      return;
    }
    const templates = filteredTemplates();
    if (!templates.length) {
      root.innerHTML = state.templates.length ? `
        <div class="empty-state">${escapeHtml(t('noMatchingMakers', 'No matching Makers'))}</div>` : `
        <section class="empty-state plaza-empty-state">
          <span class="empty-state-mark" aria-hidden="true">＋</span>
          <h2>${escapeHtml(t('noPublishedMakers', 'No published Makers yet'))}</h2>
          <p>${escapeHtml(t('noPublishedMakersCopy', 'Certified on-chain Makers will appear here after activation.'))}</p>
          <button class="primary" type="button" data-create-first-maker>${escapeHtml(t('createFirstMaker', 'Create first Maker'))}</button>
        </section>`;
      return;
    }
    root.innerHTML = templates.map((template) => {
      const coverUrl = state.templateCoverUrls.get(template.id) || '';
      const royalty = Number.isFinite(template.royaltyBps) ? template.royaltyBps / 100 : 0;
      return `
        <article class="template-card ${template.id === state.templateId ? 'active' : ''}" data-template="${escapeHtml(template.id)}" data-commerce-state="${escapeHtml(template.lifecycle.toLowerCase())}">
          <div class="template-cover" style="--accent:${template.accent}; --secondary:${template.secondary};">
            ${templateCoverMarkup(template, coverUrl, { lazy: true })}
            <span class="cover-style">${escapeHtml(template.style)}</span>
          </div>
          <div class="template-body">
            <div class="badge-row">
              <span>${escapeHtml(t('sourceOnchain', 'On-chain Maker'))}</span>
              <span>${escapeHtml(template.license)}</span>
              <span>${template.metrics.parts} ${escapeHtml(t('partsLabel', 'Parts'))}</span>
              <span>${template.metrics.items} ${escapeHtml(t('itemsLabel', 'Items'))}</span>
              <span>${escapeHtml(template.lifecycle)}</span>
            </div>
            <h2>${escapeHtml(template.title)}</h2>
            <p class="creator-line">${escapeHtml(t('byCreator', 'by {creator}', { creator: template.creator }))}</p>
            <p>${escapeHtml(template.summary)}</p>
            <div class="sample-strip" aria-label="${escapeHtml(t('templateSamplesAria', '{name} samples', { name: template.title }))}">
              ${[1, 2, 3, 4].map((item) => `<span style="--tilt:${item * 3}deg; --accent:${template.accent}; --secondary:${template.secondary};"></span>`).join('')}
            </div>
            <div class="template-footer">
              <span>${royalty}% ${escapeHtml(t('royaltyPolicy', 'royalty'))}</span>
              <div class="template-card-actions">
                <button class="secondary" type="button" data-view-template="${escapeHtml(template.id)}">${escapeHtml(t('viewMaker', 'View Maker'))}</button>
                <button class="primary" type="button" data-use-template="${escapeHtml(template.id)}">${escapeHtml(state.connection.connected ? t('startMaking', 'Make this OC') : t('connectToMake', 'Connect to make'))}</button>
              </div>
            </div>
          </div>
        </article>`;
    }).join('');
    bindTemplateCoverImageFallbacks(root);
  }

  function selectedTemplate() {
    return state.templates.find((template) => template.id === state.templateId) || null;
  }

  function closeLocalPlayer() {
    state.localPlayerRequest += 1;
    const draining = state.localPlayer?.dispose();
    if (draining) {
      const observed = Promise.resolve(draining).catch(() => null);
      state.localPlayerDrains.add(observed);
      void observed.finally(() => state.localPlayerDrains.delete(observed));
    }
    state.localPlayer = null;
    if (byId('backToCreatorPreview')) byId('backToCreatorPreview').hidden = true;
  }

  async function startLocalPlayer() {
    if (!openLocalPlayer || !state.record || !state.connection.connected || state.playerCompletionFlight) {
      throw new TypeError('Local Player requires a saved Creator draft and no pending completion.');
    }
    closeLocalPlayer();
    const request = state.localPlayerRequest;
    const generation = state.creatorDraftGeneration;
    const draftId = state.record.draftId;
    const current = () => !state.destroyed && request === state.localPlayerRequest
      && generation === state.creatorDraftGeneration && state.record?.draftId === draftId;
    let handle;
    try {
      await state.creatorPersistQueue;
      if (!current()) return null;
      // Captured jobs outlive the old model. Restore only after those writes
      // settle, otherwise reopening can acknowledge a checkpoint they replace.
      await Promise.all([...state.localPlayerDrains]);
      if (!current()) return null;
      if (state.creatorPersistBlocked || state.creatorPendingSave || state.creatorPersistPending > 0) {
        throw new TypeError('Save the current Creator changes before Player Test.');
      }
      const revision = state.record.revision;
      handle = await openLocalPlayer({ draftId, expectedRevision: revision });
      if (!current() || state.record.revision !== revision) { handle.dispose(); return null; }
      const assets = await handle.getAssets();
      if (!current() || state.record.revision !== revision) { handle.dispose(); return null; }
      installDraftAssets(assets);
      clearPlayerSession();
      const controls = createMakerV8LocalPlayerControls({
        session: handle, locale: state.locale, assetUrls: state.draftAssetUrls,
        recipeExport: browserObjectUrls() ? (serialized) => {
          const snapshot = handle.getSnapshot();
          const name = safeDownloadName(snapshot.profile.name || snapshot.document.metadata.name, 'animacraft-local');
          return downloadJsonText(serialized, `${name}-local-recipe.json`);
        } : null,
        pngExport: browserObjectUrls() ? {
          createUrl: (png) => browserObjectUrls().createObjectURL(pngBlob(exactCanonicalPng(png))),
          revokeUrl: revokeObjectUrl,
          download: (url) => {
            const snapshot = handle.getSnapshot();
            return downloadAnchor(url, `${safeDownloadName(snapshot.profile.name || snapshot.document.metadata.name, 'animacraft-local')}.png`);
          },
        } : null,
        onChange: () => { if (current() && state.localPlayer === controls) renderPlayer(); },
      });
      state.localPlayer = controls;
      await controls.initialize();
      if (!current()) { controls.dispose(); return null; }
      if (byId('backToCreatorPreview')) byId('backToCreatorPreview').hidden = false;
      navigate('make');
      renderPlayer({ focusInfo: true });
      renderConnection();
      await controls.refresh();
      return current() ? controls.getView() : null;
    } catch (error) {
      handle?.dispose();
      if (!current()) return null;
      closeLocalPlayer();
      state.previewStatus = String(error?.message || 'Local Player could not open.');
      showCreatorEditor();
      navigate('creator');
      renderCreator();
      throw error;
    }
  }

  function canOpenPlayer(template = selectedTemplate()) {
    if (state.localPlayer) {
      try { return state.localPlayer.getView().mode === 'LOCAL_DRAFT'; } catch { return false; }
    }
    return Boolean(
      template
      && template.lifecycle === 'ACTIVE'
      && state.playerStatus === 'ready'
      && state.playerSession?.status === 'READY'
      && state.playerSession?.rootId === template.id
      && state.playerSession?.player?.rootId === template.id
      && state.templateId === template.id
    );
  }

  function soulidityAppLink(pathname, { includeWallet = true } = {}) {
    const base = configuredSoulidityAppUrl(win);
    if (!base) return '';
    const url = new URL(base);
    url.pathname = pathname;
    url.hash = '';
    url.search = '';
    url.searchParams.set('source', 'animacraft');
    url.searchParams.set('lang', state.locale);
    if (includeWallet && state.connection.connected && state.connection.address) {
      url.searchParams.set('wallet', state.connection.address);
    }
    return url.href;
  }

  function renderSoulidityLinks() {
    const configured = Boolean(configuredSoulidityAppUrl(win));
    const links = [
      ['soulidityMySoulsLink', '/my-souls', true],
      ['soulidityProfileLink', '/profile', true],
      ['soulidityCommunityLink', '/community', false],
      ['soulidityMarketLink', '/market', false],
    ];
    links.forEach(([id, pathname, requiresAccount]) => {
      const link = byId(id);
      if (!link) return;
      const disabled = !configured || (requiresAccount && !state.connection.connected);
      const href = !disabled
        ? soulidityAppLink(pathname)
        : '';
      link.setAttribute('href', href || '#');
      link.setAttribute('aria-disabled', String(disabled));
    });
  }

  function renderTemplateDetail() {
    const root = byId('templateDetail');
    if (!root) return;
    if (state.templateDetailStatus === 'loading') {
      root.innerHTML = `
        <section class="empty-state" role="status">
          <h2>${escapeHtml(t('syncingMakers', 'Loading certified Maker…'))}</h2>
        </section>`;
      return;
    }
    if (state.templateDetailStatus === 'error') {
      root.innerHTML = `
        <section class="empty-state" role="status">
          <h2>${escapeHtml(t('unavailable', 'Maker unavailable'))}</h2>
          <p>${escapeHtml(state.templateDetailError || 'The certified Maker could not be read.')}</p>
        </section>`;
      return;
    }
    const listed = selectedTemplate();
    if (!listed || !state.templateDetail) {
      root.innerHTML = '';
      return;
    }
    const template = publicTemplateRecord({ ...listed.raw, ...state.templateDetail });
    const coverUrl = state.templateDetailCoverUrl
      || state.templateCoverUrls.get(listed.id)
      || '';
    const royalty = Number.isFinite(template.royaltyBps) ? template.royaltyBps / 100 : 0;
    root.innerHTML = `
      <div class="template-detail-media" style="--accent:${template.accent}; --secondary:${template.secondary};">
        <div class="template-cover">
          ${templateCoverMarkup(template, coverUrl)}
          <span class="cover-style">${escapeHtml(template.style)}</span>
        </div>
      </div>
      <div class="template-detail-copy">
        <div class="badge-row">
          <span>${escapeHtml(t('sourceOnchain', 'On-chain Maker'))}</span>
          <span>${escapeHtml(template.license)}</span>
          <span>${escapeHtml(template.lifecycle)}</span>
        </div>
        <h1>${escapeHtml(template.title)}</h1>
        <p class="creator-line">${escapeHtml(t('byCreator', 'by {creator}', { creator: template.creator }))}</p>
        <p class="template-detail-summary">${escapeHtml(template.summary)}</p>
        <div class="template-detail-metrics">
          <div><strong>${template.metrics.parts}</strong><span>${escapeHtml(t('partsLabel', 'Parts'))}</span></div>
          <div><strong>${template.metrics.items}</strong><span>${escapeHtml(t('itemsLabel', 'Items'))}</span></div>
          <div><strong>${royalty}%</strong><span>${escapeHtml(t('royaltyPolicy', 'Royalty policy'))}</span></div>
        </div>
        <div class="badge-row">${template.partLabels.map((label) => `<span>${escapeHtml(label)}</span>`).join('')}</div>
        <div class="template-detail-license"><strong>${escapeHtml(template.license)}</strong><p>${escapeHtml(template.licenseNote)}</p></div>
        <div class="template-detail-actions">
          <button class="primary" type="button" data-detail-start>${escapeHtml(state.connection.connected ? t('startMaking', 'Make this OC') : t('connectToMake', 'Connect to make'))}</button>
        </div>
      </div>`;
    bindTemplateCoverImageFallbacks(root);
  }

  function renderBridgeState() {
    const refresh = byId('refreshMakers');
    if (refresh) {
      refresh.disabled = state.templatesStatus === 'loading';
      refresh.textContent = state.templatesStatus === 'loading'
        ? t('syncingMakers', 'Loading Makers…')
        : t('refreshMakers', 'Refresh Makers');
    }
    const root = byId('chainStatusGrid');
    if (!root) return;
    const runtime = state.bridgeState?.runtime || {};
    const status = String(runtime.status || 'STARTING');
    const statusClass = status === 'READY' ? 'ready' : status === 'ERROR' ? 'error' : 'pending';
    const walletReady = state.connection.connected;
    const discoveryReady = state.templatesStatus === 'ready';
    root.innerHTML = [
      [t('networkLabel', 'Network'), 'mainnet', runtime.issue?.message || t('chainNetworkNote', 'Sui network used by wallet transactions.'), statusClass],
      [
        t('chainWalletLabel', 'Wallet'),
        walletReady ? shortAddress(state.connection.address) : t('chainWalletNotConnected', 'Not connected'),
        walletReady ? t('chainWalletReady', 'Ready to sign Creator and OC transactions.') : t('chainWalletNeedConnect', 'Connect before publishing or minting.'),
        walletReady ? 'ready' : 'pending',
      ],
      [
        t('discoveryLabel', 'Discovery'),
        state.templatesStatus === 'loading'
          ? t('discoverySyncing', 'Syncing Makers')
          : state.templatesError || (discoveryReady ? t('chainDerived', 'Chain-derived') : t('waiting', 'Waiting')),
        discoveryReady
          ? t('discoveryReadyNote', 'Published Makers are discovered from Sui events and restored from certified Walrus manifests.')
          : t('discoverySetupNote', 'Configure the published package ID to enable the public on-chain Maker gallery.'),
        state.templatesStatus === 'error' ? 'error' : discoveryReady ? 'ready' : 'pending',
      ],
    ].map(([label, value, note, cardStatus]) => `
      <article class="chain-status-card ${escapeHtml(cardStatus)}">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
        <small>${escapeHtml(note)}</small>
      </article>`).join('');
  }

  async function loadTemplateCover(template, request) {
    const asset = certifiedCoverAsset(template.raw);
    if (!asset) return null;
    try {
      const loaded = await loadCertifiedAsset({ asset });
      if (state.destroyed || request !== state.templateRefresh) return null;
      state.templateCoverUrls.set(template.id, loaded.dataUrl);
      return loaded.dataUrl;
    } catch {
      return null;
    }
  }

  async function refreshTemplates() {
    const request = ++state.templateRefresh;
    state.templatesStatus = 'loading';
    state.templatesError = '';
    renderTemplateCards();
    renderBridgeState();
    let result;
    try {
      result = await listTemplates();
    } catch (error) {
      result = { status: 'ERROR', makers: [], diagnostics: [error] };
    }
    if (state.destroyed || request !== state.templateRefresh) return state.templates;
    const makers = Array.isArray(result?.makers) ? result.makers : [];
    const hydrated = await Promise.all(makers.map(async (maker) => {
      const rootId = publicTemplateId(maker);
      if (!EXACT_OBJECT_ID.test(rootId)) return { maker: null, detail: null, error: null };
      if (publicTemplateDocument(maker)) return { maker, detail: null, error: null };
      try {
        const detail = await getTemplate({ makerId: rootId });
        if (publicTemplateId(detail) !== rootId || !publicTemplateDocument(detail)) {
          throw new TypeError('Certified Maker detail does not bind its exact v8 document.');
        }
        return { maker: { ...maker, ...detail }, detail, error: null };
      } catch (error) {
        return { maker: null, detail: null, error };
      }
    }));
    if (state.destroyed || request !== state.templateRefresh) return state.templates;
    state.templates = hydrated.flatMap(({ maker }) => (
      maker ? [publicTemplateRecord(maker)] : []
    ));
    hydrated.forEach(({ maker, detail }) => {
      if (maker && detail) state.templateDetails.set(publicTemplateId(maker), detail);
    });
    const listedIds = new Set(state.templates.map((template) => template.id));
    for (const templateId of state.templateCoverUrls.keys()) {
      if (!listedIds.has(templateId)) state.templateCoverUrls.delete(templateId);
    }
    for (const templateId of state.templateDetails.keys()) {
      if (!listedIds.has(templateId)) state.templateDetails.delete(templateId);
    }
    const hydrationError = hydrated.find((entry) => entry.error)?.error;
    state.templatesStatus = result?.status === 'ERROR'
      || (makers.length > 0 && state.templates.length === 0) ? 'error' : 'ready';
    state.templatesError = result?.diagnostics?.[0]?.message
      || String(hydrationError?.message || '');
    const selectedStillListed = listedIds.has(state.templateId);
    if ((state.playerPendingRootId && !listedIds.has(state.playerPendingRootId))
      || (state.playerSession && !listedIds.has(state.playerSession.rootId))) {
      clearPlayerSession();
    }
    if (state.templateId && !selectedStillListed && state.route === 'template') {
      state.templateDetailRequest += 1;
      state.templateDetail = null;
      state.templateDetailCoverUrl = '';
      state.templateDetailStatus = 'error';
      state.templateDetailError = 'The requested certified Maker is not available.';
      renderTemplateDetail();
    } else if (!state.templateId || !selectedStillListed) {
      state.templateId = state.templates[0]?.id || '';
    }
    renderTemplateCards();
    renderBridgeState();
    renderConnection();
    if (state.templatesStatus === 'ready') {
      await Promise.all(state.templates.map((template) => loadTemplateCover(template, request)));
      if (!state.destroyed && request === state.templateRefresh) renderTemplateCards();
    }
    return state.templates;
  }

  async function openTemplateDetail(templateId, { updatePath = true } = {}) {
    const id = String(templateId || '').toLowerCase();
    const listed = state.templates.find((template) => template.id === id);
    if (!listed) return null;
    if ((state.playerPendingRootId && state.playerPendingRootId !== listed.id)
      || (state.playerSession?.rootId && state.playerSession.rootId !== listed.id)) {
      clearPlayerSession();
    }
    const request = ++state.templateDetailRequest;
    state.templateId = listed.id;
    state.templateDetailStatus = 'loading';
    state.templateDetail = null;
    state.templateDetailError = '';
    state.templateDetailCoverUrl = state.templateCoverUrls.get(listed.id) || '';
    if (updatePath && win.history?.pushState) {
      win.history.pushState(null, '', `/maker/${encodeURIComponent(listed.makerId)}#template`);
    }
    navigate('template', { replace: false });
    renderTemplateCards();
    renderTemplateDetail();
    try {
      const detail = state.templateDetails.get(listed.id)
        || await getTemplate({ makerId: listed.makerId });
      if (state.destroyed || request !== state.templateDetailRequest) return null;
      if (publicTemplateId(detail) !== listed.id || !publicTemplateDocument(detail)) {
        throw new TypeError('Certified Maker detail does not bind its exact v8 document.');
      }
      state.templateDetails.set(listed.id, detail);
      state.templateDetail = detail;
      const asset = certifiedCoverAsset(detail) || certifiedCoverAsset(listed.raw);
      if (asset) {
        try {
          const loaded = await loadCertifiedAsset({ asset });
          if (state.destroyed || request !== state.templateDetailRequest) return null;
          state.templateDetailCoverUrl = loaded.dataUrl;
          state.templateCoverUrls.set(listed.id, loaded.dataUrl);
        } catch {
          // The existing published-cover placeholder remains the fail-closed asset state.
        }
      }
      state.templateDetailStatus = 'ready';
      renderConnection();
      return detail;
    } catch (error) {
      if (state.destroyed || request !== state.templateDetailRequest) return null;
      state.templateDetailStatus = 'error';
      state.templateDetailError = String(error?.message || 'The certified Maker could not be read.');
      renderConnection();
      return null;
    }
  }

  function setLocale(locale, { persist = true } = {}) {
    state.locale = normalizedOriginalLocale(locale);
    if (persist) {
      try {
        win.localStorage?.setItem?.(ORIGINAL_LOCALE_STORAGE_KEY, state.locale);
      } catch {
        // A blocked preference store never blocks public browsing.
      }
    }
    setWalletLocale(state.locale);
    if (state.localPlayer) {
      try { state.localPlayer.setLocale(state.locale); } catch { renderPlayer(); }
    }
    renderI18n();
    renderTheme();
    renderConnection();
    renderTemplateCards();
    renderTemplateDetail();
    renderProtocol();
    renderBridgeState();
    if (state.docsCenter || state.route === 'docs') renderDocsHandbook();
    return state.locale;
  }

  function snapshotCreatorState() {
    return {
      ...state,
      publicationReview: state.publicationHidden ? null : state.publicationReview,
      ...(publishedMaker(state.record) ? { lifecycle: { label: publicationLabel(state.record),
        manageLabel: publicationLabel(state.record), badgeClass: 'active' } } : {}),
      publicationSigningEnabled: state.bridgeState?.publication?.signingEnabled === true
        && state.bridgeState?.publication?.broadcastEnabled === true,
      publicationBroadcastEnabled: state.bridgeState?.publication?.signingEnabled === true
        && state.bridgeState?.publication?.broadcastEnabled === true,
      composableInventory: state.composableInventory?.address === state.connection.address
        ? state.composableInventory : null,
      composableOperations: state.composableOperations?.address === state.connection.address
        ? state.composableOperations : null,
      composableTargets: state.composableTargets?.address === state.connection.address
        ? state.composableTargets : null,
      composableAdmission: state.composableAdmission?.address === state.connection.address
        && state.composableAdmission?.rootId === state.composableTargets?.target?.rootId ? state.composableAdmission : null,
      composableArtwork: state.composableArtwork?.binding.address === state.connection.address
        ? state.composableArtwork : null,
      composableUploadHistory: state.composableUploadHistory?.address === state.connection.address
        ? state.composableUploadHistory : null,
      composableUploadWriteEnabled: Boolean(advanceComposableUpload && state.bridgeState?.publication?.signingEnabled
        && state.bridgeState?.publication?.broadcastEnabled),
      creatorRecoveryAvailable: Boolean(recoverDraftCopy && state.creatorPendingSave),
      ...(creatorUncommittedInput() && state.saveState === 'saved'
        ? { saveState: 'dirty', saveLabel: makerWorkspaceText(state.locale, 'unsavedChanges') } : {}),
      assetUrls: state.draftAssetUrls,
      assets: state.draftAssets,
      canUndo: state.undo.length > 0,
      canRedo: state.redo.length > 0,
    };
  }

  function creatorLockedStyleKeys(document = state.record?.document) {
    const keys = new Set(state.styleLockedKeys || []);
    for (const part of document?.parts || []) for (const item of part.items) for (const style of item.styles) {
      if (creatorStyleEditorState(style).styleLocked) keys.add(`${part.key}/${item.key}/${style.key}`);
    }
    return keys;
  }

  function cancelCreatorStyleInteraction({ redraw = false } = {}) {
    const gesture = creatorPositionGesture;
    const hadPreview = Boolean(state.creatorStylePreview);
    creatorPositionGesture = null;
    state.creatorStylePreview = null;
    creatorTransientRenderQueued = false;
    if (gesture) {
      try { gesture.canvas.releasePointerCapture?.(gesture.pointerId); } catch {}
      gesture.canvas.classList?.remove('dragging');
    }
    if (gesture || hadPreview) {
      state.creatorRenderRequest += 1;
      if (redraw && creatorEditorVisible()) void requestCreatorPreview();
    }
  }

  function queueCreatorTransientPreview() {
    creatorTransientRenderQueued = true;
    if (creatorTransientRenderFlight) return creatorTransientRenderFlight;
    const run = async () => {
      while (creatorTransientRenderQueued && state.creatorStylePreview && !state.destroyed) {
        creatorTransientRenderQueued = false;
        await requestCreatorPreview({ transient: true });
      }
    };
    creatorTransientRenderFlight = run().finally(() => { creatorTransientRenderFlight = null; });
    return creatorTransientRenderFlight;
  }

  function setCreatorPreviewStatus(message) {
    state.previewStatus = message;
    const status = byId('v4CreatorRenderStatus');
    if (status) status.textContent = message;
  }

  function creatorStyleSelection() {
    const { part, item, style } = selectedRecords(state.creatorIntentDocument || state.record.document, state);
    return part && item && style ? { partKey: part.key, itemKey: item.key, styleKey: style.key } : null;
  }

  async function commitCreatorStyle(action, value, selection = creatorStyleSelection(), transform) {
    if (!selection || !state.record || !state.connection.connected || creatorDeleteFlight || creatorAssetFlight || state.projectImportPending) return;
    const generation = state.creatorDraftGeneration, draftId = state.record.draftId;
    try {
      const prepared = prepareCreatorStyleChange({ document: state.creatorIntentDocument || state.record.document,
        ...selection, action, value, transform });
      if (action === 'confirm-position' || ['style-locked', 'style-position-locked'].includes(action)) {
        state.editingPositionStyleKey = '';
      } else if (action.startsWith('style-') && !['style-opacity', 'style-blend'].includes(action)) {
        state.editingPositionStyleKey = `${selection.partKey}/${selection.itemKey}/${selection.styleKey}`;
      }
      if (!prepared.changed) {
        clearCreatorValidationError();
        renderCreator(); return true;
      }
      await persistReplacement(prepared.document);
      return true;
    } catch (error) {
      if (creatorDraftCurrent(generation, draftId)) {
        state.saveState = 'error'; state.saveLabel = String(error?.message || 'Style edit could not be saved.');
        renderCreator();
      }
      return false;
    }
  }

  function previewCreatorScale(control) {
    if (!state.record || !state.connection.connected || state.creatorPersistPending || state.creatorPersistBlocked
      || creatorAssetFlight || state.projectImportPending || creatorDeleteFlight) return;
    const { style } = selectedRecords(state.record.document, state);
    if (!style?.assetId || creatorStyleEditorState(style).positionLocked) return;
    try {
      const selection = creatorStyleSelection();
      const prepared = prepareCreatorStyleChange({ document: state.record.document, ...selection,
        action: 'style-scale-preview', value: control.value });
      const transform = prepared.document.parts.find(row => row.key === selection.partKey).items.find(row => row.key === selection.itemKey)
        .styles.find(row => row.key === selection.styleKey).transform;
      state.creatorStylePreview = { ...selection, expectedRevision: state.record.revision, transform };
      void queueCreatorTransientPreview();
    } catch (error) {
      state.creatorRenderRequest += 1;
      creatorTransientRenderQueued = false;
      setCreatorPreviewStatus(String(error?.message || 'Style preview failed.'));
    }
  }

  function beginCreatorPositionGesture(event) {
    const canvas = byId('makerV4CreatorCanvas');
    if (event.target !== canvas || event.button !== 0 || creatorSpacePressed || !state.record || !state.connection.connected
      || !creatorEditorVisible() || state.creatorPersistPending || state.creatorPersistBlocked || creatorAssetFlight
      || state.projectImportPending || creatorDeleteFlight) return;
    const { style } = selectedRecords(state.record.document, state), selection = creatorStyleSelection();
    if (!style?.assetId || creatorStyleEditorState(style).positionLocked || !selection
      || (creatorStyleEditorState(style).positionConfirmed
        && state.editingPositionStyleKey !== `${selection.partKey}/${selection.itemKey}/${selection.styleKey}`)) return;
    const rect = canvas.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0 || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    cancelCreatorStyleInteraction();
    creatorPositionGesture = { canvas, pointerId: event.pointerId, selection,
      draftId: state.record.draftId, generation: state.creatorDraftGeneration, revision: state.record.revision,
      connection: creatorConnectionGeneration, navigation: state.localNavigationRequest,
      startX: event.clientX, startY: event.clientY, transform: structuredClone(style.transform),
      ratioX: state.record.document.canvas.width / rect.width, ratioY: state.record.document.canvas.height / rect.height,
      pixel: state.record.document.canvas.pixelMode === 'pixelated' };
    try { canvas.setPointerCapture?.(event.pointerId); } catch { creatorPositionGesture = null; return; }
    canvas.classList?.add('dragging'); event.preventDefault?.();
  }

  function creatorPositionGestureCurrent(gesture) {
    const selection = state.record && creatorStyleSelection();
    return gesture && creatorDraftCurrent(gesture.generation, gesture.draftId)
      && gesture.revision === state.record.revision && gesture.connection === creatorConnectionGeneration
      && gesture.navigation === state.localNavigationRequest && creatorEditorVisible()
      && byId('makerV4CreatorCanvas') === gesture.canvas && !state.creatorPersistPending && !state.creatorPersistBlocked
      && selection?.partKey === gesture.selection.partKey && selection?.itemKey === gesture.selection.itemKey
      && selection?.styleKey === gesture.selection.styleKey;
  }

  function moveCreatorPositionGesture(event) {
    const gesture = creatorPositionGesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (!creatorPositionGestureCurrent(gesture)) { cancelCreatorStyleInteraction(); return; }
    const precision = gesture.pixel ? 1 : 10;
    try {
      const transform = exactCreatorTransform({ ...gesture.transform,
        x: Math.round((gesture.transform.x + (event.clientX - gesture.startX) * gesture.ratioX) * precision) / precision,
        y: Math.round((gesture.transform.y + (event.clientY - gesture.startY) * gesture.ratioY) * precision) / precision });
      state.creatorStylePreview = { ...gesture.selection, expectedRevision: gesture.revision, transform };
      void queueCreatorTransientPreview(); event.preventDefault?.();
    } catch (error) {
      state.creatorRenderRequest += 1;
      creatorTransientRenderQueued = false;
      setCreatorPreviewStatus(String(error?.message || 'Position exceeds the canvas bounds.'));
    }
  }

  function finishCreatorPositionGesture(event) {
    const gesture = creatorPositionGesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const current = creatorPositionGestureCurrent(gesture), preview = state.creatorStylePreview;
    cancelCreatorStyleInteraction();
    if (!current || !preview || JSON.stringify(preview.transform) === JSON.stringify(gesture.transform)) {
      if (current) void requestCreatorPreview();
      return;
    }
    void commitCreatorStyle('style-drag', undefined, gesture.selection, preview.transform);
  }

  function creatorRenderIdentity() {
    return state.record ? `${state.record.draftId}:${state.record.revision}:${state.selectedPartKey}:${state.selectedItemKey}:${state.selectedStyleKey}:${JSON.stringify(state.creatorStylePreview)}` : '';
  }

  function creatorPreviewRecipe() {
    const recipe = structuredClone(state.record.document.defaultRecipe);
    const { part, item, style } = selectedRecords(state.record.document, state);
    if (part && item && style) {
      recipe.selections = recipe.selections.filter(selection => selection.partKey !== part.key);
      recipe.selections.push({ partKey: part.key, itemKey: item.key, styleKey: style.key });
    }
    return recipe;
  }

  function creatorEditorVisible() {
    return Boolean(state.route === 'creator' && state.record
      && doc.querySelector?.('.creator-view[data-creator-view="edit"]')
        ?.classList?.contains('active'));
  }

  function creatorOverlayFocusAllowed() {
    return creatorEditorVisible()
      && !byId('makerLifecycleManagerModal')?.classList?.contains('active')
      && !doc.querySelector?.('dialog[open]')
      && !byId('suiWalletModal')?.shadowRoot?.querySelector?.('dialog[open]');
  }

  function renderCreator({ focusTool = false, focusVersion = false, drawPreview = true } = {}) {
    if (!mount || !state.record) return;
    if (state.packEditor && currentPackEditor(state.packEditor)) {
      renderPackEditor(); return;
    }
    if (creatorRuleEventCurrent()) creatorVisibilityEditor();
    const colorDocument = state.creatorIntentDocument || state.record.document;
    const gradientKeys = new Set(colorDocument.colors.flatMap(channel => channel.swatches.map(swatch => JSON.stringify([channel.key, swatch.key]))));
    state.creatorOpenGradients = new Set([...state.creatorOpenGradients].filter(key => gradientKeys.has(key)));
    if (creatorComposition && doc.activeElement === creatorComposition && mount.contains?.(creatorComposition)) return;
    const active = doc.activeElement;
    const inputSession = creatorInputSession;
    const pointerHandoff = creatorInputPointerHandoff;
    if (!focusTool && !focusVersion && !state.versionHistoryOpen && !creatorRecoveryFlight
      && creatorOverlayFocusAllowed() && (
        (inputSession?.control === active && mount.contains?.(active)
          && inputSession.generation === state.creatorDraftGeneration
          && inputSession.tab === state.creatorTab
          && inputSession.selection === JSON.stringify(creatorStyleSelection()))
        || (pointerHandoff && mount.contains?.(pointerHandoff.control)
          && pointerHandoff.generation === state.creatorDraftGeneration
          && pointerHandoff.tab === state.creatorTab
          && pointerHandoff.selection === JSON.stringify(creatorStyleSelection())))) {
      // Keep the native text/number input alive while a previous field's async save
      // acknowledges. Replacing it would blur/commit a half-typed next value.
      creatorRenderDeferredForInput = true;
      const save = projectMakerV8WorkspaceView(state.record.document,
        { ...snapshotCreatorState(), savedAt: state.record.updatedAt }).save;
      const indicator = mount.querySelector?.('.v4-save-indicator');
      if (indicator) {
        indicator.className = `v4-save-indicator ${save.phase}`;
        indicator.setAttribute('data-save-phase', save.phase);
        const label = indicator.querySelector?.('span');
        if (label) label.textContent = save.label;
      }
      return;
    }
    creatorRenderDeferredForInput = false;
    const action = mount.contains?.(active) ? active?.dataset?.action : null;
    const styleFocus = CREATOR_STYLE_VALUE_ACTIONS.includes(action) ? action : null;
    const capacityFocus = action === 'part-capacity'
      ? { key: active.dataset.partId, value: active.value, start: active.selectionStart, end: active.selectionEnd } : null;
    const soulFocus = action === 'soul-document-content'
      && MAKER_V8_LIVING_CONTENT_KEYS.includes(active.dataset.soulKey)
      ? { key: active.dataset.soulKey, start: active.selectionStart, end: active.selectionEnd,
        direction: active.selectionDirection, scrollTop: active.scrollTop } : null;
    const focusSelector = ['close-tool', 'close-version-history', 'open-version-history'].includes(action)
      ? `[data-action="${action}"]`
      : action === 'creator-tab' && ORIGINAL_CREATOR_TABS.some((tab) => tab.id === active.dataset.tab)
        ? `[data-action="creator-tab"][data-tab="${active.dataset.tab}"]` : null;
    mount.innerHTML = renderOriginalCreatorWorkspace(
      state.creatorTab === 'validate' && state.creatorIntentDocument
        ? { ...state.record, document: state.creatorIntentDocument } : state.record,
      snapshotCreatorState(),
      creatorCapabilities({
        publication: Boolean(prepareMakerPublication && inspectMakerPublication && signMakerPublication
          && continueMakerPublication && state.connection.connected),
        versionHistory: Boolean(listDraftVersions && restoreDraftVersion),
        packCreate: Boolean(createPackDraft && listPackDrafts && !creatorPackFlight && state.connection.connected),
        packOpen: Boolean(loadPackDraft && savePackDraft && !creatorPackFlight && state.connection.connected),
        localPlayer: Boolean(openLocalPlayer && state.connection.connected && !state.playerCompletionFlight),
        projectExport: Boolean(exportProjectZip && browserObjectUrls() && !state.projectExportPending),
        projectImport: Boolean(replaceDraftFromProjectZip && !state.projectImportPending),
        styleAsset: Boolean(dispatchDraftTransaction && replaceDraftSnapshot),
        recoveryCopy: Boolean(recoverDraftCopy && state.creatorPendingSave),
        importing: state.projectImportPending || Boolean(creatorAssetFlight) || Boolean(creatorRecoveryFlight),
      }),
    );
    filterCreatorRuleSearch();
    if (focusTool && state.creatorTab !== 'structure' && !state.versionHistoryOpen
      && creatorOverlayFocusAllowed()) {
      mount.querySelector?.('.v4-tool-modal-backdrop [data-action="close-tool"]')
        ?.focus?.({ preventScroll: true });
    }
    if (focusVersion && state.versionHistoryOpen && creatorOverlayFocusAllowed()) {
      mount.querySelector?.('.v4-version-history-dialog button[data-action="close-version-history"]')
        ?.focus?.({ preventScroll: true });
    } else if (!focusTool && focusSelector && creatorOverlayFocusAllowed()) {
      mount.querySelector?.(focusSelector)?.focus?.({ preventScroll: true });
    } else if (!focusTool && capacityFocus && creatorOverlayFocusAllowed()) {
      const editor = [...(mount.querySelectorAll?.('[data-action="part-capacity"]') || [])]
        .find(input => input.dataset.partId === capacityFocus.key);
      if (editor) {
        editor.value = capacityFocus.value;
        editor.focus?.({ preventScroll: true });
        // Native number inputs do not expose text selection APIs.
        if (Number.isInteger(capacityFocus.start) && Number.isInteger(capacityFocus.end)) {
          try { editor.setSelectionRange?.(capacityFocus.start, capacityFocus.end); } catch {}
        }
      }
    } else if (!focusTool && styleFocus && creatorOverlayFocusAllowed()) {
      mount.querySelector?.(`[data-action="${styleFocus}"]`)?.focus?.({ preventScroll: true });
    } else if (!focusTool && soulFocus && creatorOverlayFocusAllowed()) {
      const editor = mount.querySelector?.(`[data-action="soul-document-content"][data-soul-key="${soulFocus.key}"]`);
      editor?.focus?.({ preventScroll: true });
      editor?.setSelectionRange?.(soulFocus.start, soulFocus.end, soulFocus.direction);
      if (editor) editor.scrollTop = soulFocus.scrollTop;
    }
    if (drawPreview && state.creatorRenderRecord
      && state.creatorRenderIdentity === creatorRenderIdentity()) {
      const request = state.creatorRenderRequest;
      void drawCanonicalPng('makerV4CreatorCanvas', state.creatorRenderRecord, () => (
        !state.destroyed
        && request === state.creatorRenderRequest
        && state.creatorRenderIdentity === creatorRenderIdentity()
      )).catch(() => {});
    }
  }

  async function requestCreatorPreview({ transient = false } = {}) {
    if (!state.record || !renderDraftPreview) return null;
    const request = ++state.creatorRenderRequest;
    const identity = creatorRenderIdentity();
    const draftId = state.record.draftId;
    state.creatorRenderRecord = null;
    state.creatorRenderIdentity = '';
    setCreatorPreviewStatus(t('loading', 'Loading…'));
    if (!transient) renderCreator({ drawPreview: false });
    try {
      const record = exactCanonicalPng(await renderDraftPreview({ draftId, recipe: creatorPreviewRecipe(),
        ...(state.creatorStylePreview ? { stylePreview: structuredClone(state.creatorStylePreview) } : {}) }));
      if (state.destroyed || request !== state.creatorRenderRequest
        || identity !== creatorRenderIdentity()) return null;
      state.creatorRenderRecord = record;
      state.creatorRenderIdentity = identity;
      const pendingPngs = state.record.document.parts.flatMap(part => part.items)
        .flatMap(item => item.styles).filter(style => style.assetId === null).length;
      const pendingTracks = state.record.document.parts.flatMap(part => part.items)
        .flatMap(item => item.styles).filter(style => style.trackKey === null).length;
      setCreatorPreviewStatus(`Preview ready.${pendingPngs ? ` ${pendingPngs} Style(s) waiting for PNG.` : ''}${pendingTracks ? ` ${pendingTracks} Style(s) waiting for Layer Track.` : ''}`);
      if (!transient) renderCreator({ drawPreview: false });
      await drawCanonicalPng('makerV4CreatorCanvas', record, () => (
        !state.destroyed
        && request === state.creatorRenderRequest
        && identity === creatorRenderIdentity()
      ));
      return record;
    } catch (error) {
      if (state.destroyed || request !== state.creatorRenderRequest
        || identity !== creatorRenderIdentity()) return null;
      state.creatorRenderRecord = null;
      state.creatorRenderIdentity = '';
      setCreatorPreviewStatus(String(error?.message || 'Maker preview failed.'));
      if (!transient) renderCreator({ drawPreview: false });
      return null;
    }
  }

  function projectedPlayerView() {
    if (state.localPlayer) return state.localPlayer.getView();
    if (!state.playerSession || !state.playerUi) return null;
    const recoveryBranches = state.playerUi.recoveryBranches.map((branch) => ({
      ...branch,
      // The approved donor view keeps its existing data-writer-id attribute.
      // Its value is the exact branch identity, never the non-unique writer id.
      writerId: branch.branchId,
    }));
    return projectMakerV8PlayerView(state.playerSession, {
      ...state.playerUi,
      envelopeRecoveryAvailable: envelopeRecoveryByScope.has(envelopeRecoveryScope()),
      recoveryBranches,
      selectedRecoveryWriterId: state.playerUi.selectedRecoveryBranchId,
      completionIssues: [...new Set([
        ...(state.playerUi.completionIssues || []),
        ...playerExecutionIssues(),
      ])],
      locale: state.locale,
      assetUrls: state.playerAssetUrls,
    }, playerCapabilities({
      recipe: Boolean(getPlayerSnapshot && updatePlayerRecipe),
      reset: Boolean(getPlayerSnapshot && resetPlayerRecipe),
      render: Boolean(renderPlayerPreview && renderPlayerExport),
      exportSettings: Boolean(renderPlayerExport && !state.playerCompletionFlight),
      complete: Boolean(completePlayerJourney && nativeCompletionConfigured()),
      recovery: Boolean(state.playerUi?.recoveryBranches?.length),
      packAcquire: Boolean(preparePlayerAction && executePlayerAction && recoverPlayerAction && getPlayerSnapshot),
      session: state.playerSession,
    }));
  }

  function applyPlayerStatusOverrides() {
    const completion = state.playerUi?.completionStatus;
    const node = byId('v4PlayerCompletionStatus');
    if (node && completion?.message) {
      node.textContent = completion.message;
      node.dataset.state = completion.state || 'blocked';
      node.setAttribute?.('data-state', completion.state || 'blocked');
    }
  }

  function renderPlayer({ focusInfo = false, drawPreview = true } = {}) {
    if (!playerMount) return;
    if (playerComposition && doc.activeElement === playerComposition && playerMount.contains?.(playerComposition)) return;
    const active = doc.activeElement;
    const textAction = playerMount.contains?.(active) ? active?.dataset?.action : '';
    const localTextFocus = state.localPlayer
      && (['player-profile-name', 'player-profile-world', 'player-profile-description', 'player-profile-tags'].includes(textAction)
        || (textAction === 'player-soul-document' && MAKER_V8_LIVING_CONTENT_KEYS.includes(active.dataset.soulKey)))
      ? { action: textAction, key: active.dataset.soulKey, start: active.selectionStart, end: active.selectionEnd,
        direction: active.selectionDirection, scrollTop: active.scrollTop } : null;
    const soulPanels = state.localPlayer ? Array.from(playerMount.querySelectorAll?.('details.v4-player-soul-card, details[data-player-soul-wrapper]') || [])
      .map(panel => ({ key: panel.dataset.playerSoulWrapper || '', open: panel.open })) : [];
    let view;
    try { view = projectedPlayerView(); } catch (error) {
      if (!state.localPlayer) throw error;
      closeLocalPlayer();
      playerMount.innerHTML = '';
      state.previewStatus = String(error?.message || 'Local Player is no longer available.');
      showCreatorEditor();
      if (state.route === 'make') navigate('creator');
      renderCreator();
      return;
    }
    playerMount.innerHTML = view ? renderApprovedMakerV8Player(view) : '';
    const recovery = !view && state.playerRecovery?.request === state.playerRequest
      && state.playerRecovery?.walletAddress === state.connection.address
      ? state.playerRecovery : null;
    if (recovery) {
      const record = recovery.record;
      playerMount.innerHTML = `<section class="v4-player-expansions" role="status">
        <h2>${escapeHtml(makerWorkspaceText(state.locale, 'playerPackRecover'))}</h2>
        <p>${escapeHtml(state.playerError)}</p><p>${escapeHtml(record.rootId)}</p>
        <p>${escapeHtml(record.transactionDigest || record.actionId)}</p>
        <p>${escapeHtml(record.status)}</p><p>${escapeHtml(recovery.error || '')}</p>
        ${['FINALIZED_SUCCESS', 'FINALIZED_FAILURE', 'EXPIRED_NOT_FOUND'].includes(record.status) ? ''
          : `<button type="button" data-action="player-recover-pack-v8" data-action-id="${escapeHtml(record.actionId)}" ${recovery.pending ? 'disabled' : ''}>${escapeHtml(makerWorkspaceText(state.locale, 'playerPackRecover'))}</button>`}
      </section>`;
    }
    for (const panel of soulPanels) {
      const node = playerMount.querySelector?.(panel.key
        ? `details[data-player-soul-wrapper="${panel.key}"]` : 'details.v4-player-soul-card');
      if (node) node.open = panel.open;
    }
    if (localTextFocus && !focusInfo) {
      const node = playerMount.querySelector?.(`[data-action="${localTextFocus.action}"]${localTextFocus.key ? `[data-soul-key="${localTextFocus.key}"]` : ''}`);
      node?.focus?.({ preventScroll: true });
      node?.setSelectionRange?.(localTextFocus.start, localTextFocus.end, localTextFocus.direction);
      if (node) node.scrollTop = localTextFocus.scrollTop;
    }
    if (focusInfo && view?.introOpen) {
      playerMount.querySelector?.('#makerPlayerInfoDialog')?.focus?.({ preventScroll: true });
    }
    applyPlayerStatusOverrides();
    if (state.localPlayer) {
      const controls = state.localPlayer;
      const rendered = controls.getRenderRecord();
      if (drawPreview && rendered) void drawCanonicalPng('makerV4PlayerCanvas', rendered, () => (
        !state.destroyed && state.localPlayer === controls && controls.getRenderRecord() === rendered
      )).catch(() => {});
      return;
    }
    if (drawPreview && state.playerRenderRecord && state.playerSession) {
      const request = state.playerRenderRequest;
      const rootId = state.playerSession.rootId;
      void drawCanonicalPng('makerV4PlayerCanvas', state.playerRenderRecord, () => (
        playerMutationCurrent(state.playerRequest, state.playerMutationRequest, rootId)
        && request === state.playerRenderRequest
      )).catch(() => {});
    }
  }

  function playerExecutionIssues() {
    const issues = state.playerSession?.execution?.writeEnabled === true
      ? [] : [String(state.playerSession?.execution?.disabledReason || '')].filter(Boolean);
    if (!nativeCompletionConfigured()) {
      issues.push('Native completion service is not configured for this release.');
    }
    return issues;
  }

  function nativeCompletionConfigured() {
    return state.bridgeState?.capabilities?.nativeCompletionConfigured === true;
  }

  function presentPlayerError(error, fallback = 'Player operation failed.', { recipeInvalid = false } = {}) {
    if (!state.playerUi) return;
    const message = String(error?.message || fallback);
    if (recipeInvalid) state.playerUi.recipeValid = false;
    state.playerUi.render = { state: 'error', message };
    state.playerUi.playerTest = { state: 'error', message };
    state.playerUi.completionIssues = [message];
    state.playerUi.completionStatus = { state: 'blocked', message };
    renderPlayer({ drawPreview: false });
  }

  function playerProjectCurrent(generation, request, mutation, rootId) {
    return generation === state.playerProjectGeneration
      && playerMutationCurrent(request, mutation, rootId);
  }

  function invalidatePlayerProject({ markDirty = true, preservePreview = false } = {}) {
    if (!state.playerUi) return state.playerProjectGeneration;
    cancelPlayerCompletion();
    state.playerProjectGeneration += 1;
    if (!preservePreview) {
      state.playerRenderRequest += 1;
      state.playerRenderRecord = null;
    }
    releasePlayerExportUrl();
    state.playerUi.export.completionConfirmed = false;
    state.playerUi.completedSoul = null;
    state.playerUi.export.state = state.playerUi.export.open ? 'idle' : state.playerUi.export.state;
    if (!preservePreview) state.playerUi.render = { state: 'pending', message: '' };
    state.playerUi.playerTest = { state: 'ready', message: '' };
    state.playerUi.completionIssues = [];
    state.playerUi.completionStatus = null;
    if (markDirty) state.playerUi.save = { state: 'dirty', savedAt: '', error: '' };
    return state.playerProjectGeneration;
  }

  async function requestPlayerCanonicalPreview() {
    if (!state.playerSession || !state.playerUi || !renderPlayerPreview) return null;
    const request = ++state.playerRenderRequest;
    const playerRequest = state.playerRequest;
    const mutation = state.playerMutationRequest;
    const projectGeneration = state.playerProjectGeneration;
    const rootId = state.playerSession.rootId;
    state.playerRenderRecord = null;
    state.playerUi.render = { state: 'pending', message: t('loading', 'Loading…') };
    state.playerUi.playerTest = { state: 'ready', message: '' };
    state.playerUi.completionStatus = null;
    renderPlayer({ drawPreview: false });
    try {
      const record = exactCanonicalPng(await renderPlayerPreview({ rootId }));
      if (!playerProjectCurrent(projectGeneration, playerRequest, mutation, rootId)
        || request !== state.playerRenderRequest) return null;
      state.playerRenderRecord = record;
      state.playerUi.recipeValid = true;
      state.playerUi.render = { state: 'ready', message: 'Preview ready.' };
      state.playerUi.playerTest = { state: 'ready', message: '' };
      state.playerUi.completionIssues = [];
      state.playerUi.completionStatus = null;
      renderPlayer({ drawPreview: false });
      await drawCanonicalPng('makerV4PlayerCanvas', record, () => (
        playerProjectCurrent(projectGeneration, playerRequest, mutation, rootId)
        && request === state.playerRenderRequest
      ));
      return record;
    } catch (error) {
      if (!playerProjectCurrent(projectGeneration, playerRequest, mutation, rootId)
        || request !== state.playerRenderRequest) return null;
      state.playerRenderRecord = null;
      presentPlayerError(error, 'Player preview failed.');
      return null;
    }
  }

  function clearPlayerSession() {
    cancelPlayerCompletion();
    state.playerRecovery = null;
    state.playerRecipeNeedsSave = false;
    state.playerRequest += 1;
    state.playerMutationRequest += 1;
    state.playerRecipeMutationTicket += 1;
    state.playerRecipeMutationPending = 0;
    state.playerRenderRequest += 1;
    state.playerProjectGeneration += 1;
    state.playerMutationQueue = Promise.resolve();
    state.playerProjectSaveQueue = Promise.resolve();
    state.playerProjectSaveTail = null;
    state.playerPendingProjectSave = null;
    state.playerProjectStorageKey = '';
    state.playerProjectBaseRevision = null;
    state.playerProjectBaseHash = '';
    state.playerProjectBaseWriterId = '';
    releasePlayerExportUrl();
    state.playerPendingRootId = '';
    state.playerSession = null;
    state.playerUi = null;
    state.playerAssetUrls = {};
    state.playerRenderRecord = null;
    state.playerStatus = 'idle';
    state.playerError = '';
    renderPlayer();
  }

  async function certifiedPlayerAssetUrls(session) {
    const assets = Array.isArray(session.player?.certifiedAssets)
      ? session.player.certifiedAssets : [];
    const loaded = await Promise.all(assets.map(async (asset) => {
      const result = await loadCertifiedAsset({ asset });
      return [asset.assetId, String(result?.dataUrl || '')];
    }));
    return Object.fromEntries(loaded.filter(([, url]) => url));
  }

  function initialPlayerUi(session) {
    const selectedPartKey = session.player.document.parts
      .find((part) => part.visible === true)?.key || '';
    return {
      selectedPartKey,
      enabledPackReleaseIds: [],
      pickerPanel: 'parts',
      introOpen: true,
      recipeValid: true,
      completionIssues: session.execution.writeEnabled === true
        ? [] : [String(session.execution.disabledReason || '')].filter(Boolean),
      completionStatus: null,
      render: {
        state: 'pending',
        message: '',
      },
      playerTest: {
        state: 'ready',
        message: '',
      },
      save: { state: 'idle', savedAt: '', error: '' },
      profile: { name: '', world: '', description: '', tags: '' },
      soul: { defaults: {}, documents: {} },
      export: {
        open: false,
        state: 'idle',
        error: '',
        previewUrl: '',
        sizeMode: 'standard',
        transparent: false,
        ...makerV8ExportSizes(session.player.document.canvas),
        completionConfirmed: false,
        shareUrl: '',
        shareState: '',
      },
      recoveryBranches: [],
      selectedRecoveryBranchId: '',
    };
  }

  async function startPlayerSession(rootId) {
    closeLocalPlayer();
    const selectedRootId = String(rootId || '').toLowerCase();
    const template = state.templates.find((candidate) => candidate.id === selectedRootId);
    if (!template || template.lifecycle !== 'ACTIVE') {
      throw new TypeError('Choose one ACTIVE certified Maker before opening Player.');
    }
    cancelPlayerCompletion();
    const request = ++state.playerRequest;
    const expectedWalletAddress = state.connection.address;
    state.playerRecovery = null;
    state.playerRecipeNeedsSave = false;
    state.playerMutationRequest += 1;
    state.playerRecipeMutationTicket += 1;
    state.playerRecipeMutationPending = 0;
    state.playerRenderRequest += 1;
    state.playerProjectGeneration += 1;
    state.playerMutationQueue = Promise.resolve();
    state.playerProjectSaveQueue = Promise.resolve();
    state.playerProjectSaveTail = null;
    state.playerPendingProjectSave = null;
    state.playerProjectStorageKey = '';
    state.playerProjectBaseRevision = null;
    state.playerProjectBaseHash = '';
    state.playerProjectBaseWriterId = '';
    releasePlayerExportUrl();
    state.playerPendingRootId = selectedRootId;
    state.playerStatus = 'loading';
    state.playerError = '';
    state.playerSession = null;
    state.playerUi = null;
    state.playerAssetUrls = {};
    state.playerRenderRecord = null;
    renderPlayer();
    renderConnection();
    try {
      if (getPendingPlayerAction) {
        const pending = await getPendingPlayerAction({ rootId: selectedRootId });
        if (state.destroyed || request !== state.playerRequest
          || state.connection.address !== expectedWalletAddress) return null;
        if (pending?.action === 'acquirePackAccess') {
          if (pending.rootId !== selectedRootId || !EXACT_OBJECT_ID.test(pending.packEntryQuote?.releaseId || '')) {
            throw new TypeError('Pending Pack recovery does not match this Player.');
          }
          state.playerRecovery = { record: pending, walletAddress: expectedWalletAddress, request };
        }
      }
      const session = exactPlayerSession(
        await openPlayerSession({ rootId: selectedRootId }),
        selectedRootId,
      );
      if (state.destroyed || request !== state.playerRequest) return null;
      const assetUrls = await certifiedPlayerAssetUrls(session);
      if (state.destroyed || request !== state.playerRequest) return null;
      state.playerPendingRootId = '';
      state.templateId = selectedRootId;
      state.playerSession = session;
      state.playerAssetUrls = assetUrls;
      state.playerUi = initialPlayerUi(session);
      state.playerStatus = 'ready';
      await restorePersistentPlayerProject();
      if (state.destroyed || request !== state.playerRequest
        || state.playerSession?.rootId !== selectedRootId) return null;
      if (state.playerRecovery) {
        const pending = state.playerRecovery.record;
        state.playerUi.packAcquisition = { releaseId: pending.packEntryQuote.releaseId,
          record: pending, pending: false };
        state.playerRecovery = null;
      }
      renderPlayer({ focusInfo: true });
      navigate('make');
      renderConnection();
      await requestPlayerCanonicalPreview();
      if (state.destroyed || request !== state.playerRequest
        || state.playerSession?.rootId !== selectedRootId) return null;
      if (state.playerRenderRecord) await requestPlayerExportRender();
      if (state.destroyed || request !== state.playerRequest
        || state.playerSession?.rootId !== selectedRootId) return null;
      return session;
    } catch (error) {
      if (state.destroyed || request !== state.playerRequest) return null;
      state.playerPendingRootId = '';
      state.playerStatus = 'error';
      state.playerError = String(error?.message || 'The selected certified Maker cannot open in Player.');
      state.playerSession = null;
      state.playerUi = null;
      state.playerAssetUrls = {};
      state.playerRenderRecord = null;
      if (state.playerRecovery) navigate('make');
      renderPlayer();
      if (state.route === 'template') {
        state.templateDetailStatus = 'error';
        state.templateDetailError = state.playerError;
        renderTemplateDetail();
      }
      renderConnection();
      throw error;
    }
  }

  function exactSelectionFromChoice(choice) {
    return {
      source: choice.source,
      partKey: choice.partKey,
      itemKey: choice.itemKey,
      styleKey: choice.styleKey,
      trackKey: choice.trackKey,
      colorChannelKey: choice.colorChannelKey ?? null,
      defaultSwatchKey: choice.defaultSwatchKey ?? null,
      releaseId: choice.releaseId ?? null,
      semanticPackId: choice.semanticPackId ?? null,
      externalProductId: choice.externalProductId ?? null,
      ownedExternalItemId: choice.ownedExternalItemId ?? null,
    };
  }

  function playerSelectionIdentity(selection) {
    return [
      selection?.source || 'BASE',
      selection?.partKey,
      selection?.itemKey,
      selection?.styleKey,
      selection?.releaseId,
      selection?.semanticPackId,
      selection?.externalProductId,
      selection?.ownedExternalItemId,
    ].map((value) => String(value ?? '')).join(':');
  }

  function samePlayerItem(left, right) {
    return [
      'source', 'partKey', 'itemKey', 'releaseId', 'semanticPackId',
      'externalProductId', 'ownedExternalItemId',
    ].every((field) => String(left?.[field] ?? '') === String(right?.[field] ?? ''));
  }

  function nextPlayerSelections(action, choice) {
    const player = state.playerSession.player;
    const documentPart = makerV8PlayerPart(player, choice)?.definition;
    const partUiKey = makerV8PlayerPartUiKey(player, choice);
    const capacity = documentPart?.capacity;
    if (!Number.isSafeInteger(capacity) || capacity < 1) return null;
    const selections = structuredClone(state.playerSession.recipe.selections);
    const partIndexes = selections.flatMap((selection, index) => (
      makerV8PlayerPartUiKey(player, selection) === partUiKey ? [index] : []
    ));
    const exactIdentity = playerSelectionIdentity(choice);
    const exactIndex = selections.findIndex((selection) => (
      playerSelectionIdentity(selection) === exactIdentity
    ));
    if (exactIndex >= 0) {
      if ((documentPart.required === true || documentPart.kind === 'LAST_BASTION') && partIndexes.length === 1) return null;
      selections.splice(exactIndex, 1);
      return selections;
    }
    if (choice.contextual && choice.access?.canEquip !== true) {
      throw new TypeError(choice.access?.reason || 'The selected component is no longer eligible.');
    }
    const itemIndex = selections.findIndex((selection) => samePlayerItem(selection, choice));
    if (itemIndex >= 0) {
      selections[itemIndex] = exactSelectionFromChoice(choice);
      return selections;
    }
    if (partIndexes.length >= capacity) {
      if (capacity === 1 && partIndexes.length === 1) {
        selections[partIndexes[0]] = exactSelectionFromChoice(choice);
        return selections;
      }
      return null;
    }
    selections.push(exactSelectionFromChoice(choice));
    return selections;
  }

  function playerMutationCurrent(request, mutation, rootId) {
    return !state.destroyed
      && request === state.playerRequest
      && mutation === state.playerMutationRequest
      && state.playerSession?.rootId === rootId
      && Boolean(state.playerUi);
  }

  function mergeExactPlayerSnapshot(snapshot, rootId) {
    const current = state.playerSession;
    const incomingPlayer = snapshot?.player;
    let player = current.player;
    if (incomingPlayer && typeof incomingPlayer === 'object') {
      player = { ...current.player, ...incomingPlayer };
      if (!Object.prototype.hasOwnProperty.call(incomingPlayer, 'contextualChoices')) {
        player.contextualChoices = current.player.contextualChoices;
      }
    }
    state.playerSession = exactPlayerSession({
      ...current,
      player,
      recipe: snapshot?.recipe,
      loadout: snapshot?.loadout,
      execution: snapshot?.execution || current.execution,
    }, rootId);
    return state.playerSession;
  }

  async function latestRenderedPlayerProject({ ticket, request, mutation, rootId }) {
    while (playerMutationCurrent(request, mutation, rootId)
      && ticket === state.playerRecipeMutationTicket) {
      if (!renderPlayerPreview) {
        const error = new TypeError('Canonical Player preview is unavailable for this project revision.');
        presentPlayerError(error, error.message);
        throw error;
      }
      const generation = state.playerProjectGeneration;
      const record = await requestPlayerCanonicalPreview();
      if (!playerMutationCurrent(request, mutation, rootId)
        || ticket !== state.playerRecipeMutationTicket) return null;
      if (generation !== state.playerProjectGeneration) continue;
      if (!record || state.playerUi.render.state !== 'ready') {
        throw new TypeError(
          state.playerUi.render.message || 'Canonical Player preview failed for this project revision.',
        );
      }
      // Recipe durability must not depend on a cancellable export dialog.
      // The final-image field stays null until selected export pixels exist;
      // the main preview is not a substitute for a completion image.
      return { generation, snapshot: playerProjectSnapshot() };
    }
    return null;
  }

  async function persistLatestPlayerRecipe({ ticket, request, mutation, rootId }) {
    while (playerMutationCurrent(request, mutation, rootId)
      && ticket === state.playerRecipeMutationTicket && state.playerRecipeNeedsSave) {
      const durable = await latestRenderedPlayerProject({ ticket, request, mutation, rootId });
      if (!durable || !playerMutationCurrent(request, mutation, rootId)
        || ticket !== state.playerRecipeMutationTicket) return null;
      const saved = await queuePlayerProjectSave({
        snapshot: durable.snapshot, generation: durable.generation, requireCurrentGeneration: true,
      });
      if (!playerMutationCurrent(request, mutation, rootId)
        || ticket !== state.playerRecipeMutationTicket) return null;
      if (saved && durable.generation === state.playerProjectGeneration) {
        state.playerRecipeNeedsSave = false;
        return state.playerSession;
      }
    }
    return null;
  }

  function queuePlayerRecipeMutation(mutate, { after, afterCommit } = {}) {
    if (!state.playerSession || !state.playerUi || !getPlayerSnapshot) {
      return Promise.resolve(null);
    }
    invalidatePlayerProject();
    const request = state.playerRequest;
    const mutation = state.playerMutationRequest;
    const rootId = state.playerSession.rootId;
    const ticket = ++state.playerRecipeMutationTicket;
    state.playerRecipeMutationPending += 1;
    const run = async () => {
      if (!playerMutationCurrent(request, mutation, rootId)) return null;
      const previousSession = structuredClone(state.playerSession);
      let controllerCommitted = false;
      try {
        const before = await getPlayerSnapshot();
        if (!playerMutationCurrent(request, mutation, rootId)) return null;
        mergeExactPlayerSnapshot(before, rootId);
        const changed = await mutate();
        if (!playerMutationCurrent(request, mutation, rootId)) return null;
        if (changed !== true) return persistLatestPlayerRecipe({ ticket, request, mutation, rootId });
        const snapshot = await getPlayerSnapshot();
        if (!playerMutationCurrent(request, mutation, rootId)) return null;
        mergeExactPlayerSnapshot(snapshot, rootId);
        controllerCommitted = true;
        afterCommit?.();
        state.playerRecipeNeedsSave = true;
        if (ticket !== state.playerRecipeMutationTicket) return state.playerSession;
        after?.();
        state.playerUi.recipeValid = true;
        state.playerUi.completionIssues = [];
        state.playerUi.completionStatus = null;
        return await persistLatestPlayerRecipe({ ticket, request, mutation, rootId });
      } catch (error) {
        if (!controllerCommitted && playerMutationCurrent(request, mutation, rootId)
          && ticket === state.playerRecipeMutationTicket) {
          state.playerSession = exactPlayerSession(previousSession, rootId);
          // A preceding successful edit may have yielded rendering/saving to
          // this newer ticket. Rejecting this edit must not lose that success.
          try { await persistLatestPlayerRecipe({ ticket, request, mutation, rootId }); }
          catch (saveError) {
            error = new AggregateError([error, saveError], `${error.message}; saving the previous edit failed: ${saveError.message}`);
          }
          if (!playerMutationCurrent(request, mutation, rootId)
            || ticket !== state.playerRecipeMutationTicket) throw error;
          presentPlayerError(error, 'The Player recipe could not be updated.', {
            recipeInvalid: true,
          });
        }
        throw error;
      } finally {
        state.playerRecipeMutationPending = Math.max(0, state.playerRecipeMutationPending - 1);
      }
    };
    const queued = state.playerMutationQueue.then(run, run);
    state.playerMutationQueue = queued.catch(() => null);
    return queued;
  }

  function applyPlayerRecipePatch(createPatch) {
    if (!updatePlayerRecipe) return Promise.resolve(null);
    return queuePlayerRecipeMutation(async () => {
      const patch = createPatch();
      if (!patch) return false;
      await updatePlayerRecipe(patch);
      return true;
    });
  }

  function playerProjectSnapshot() {
    return {
      schemaVersion: PLAYER_PROJECT_SCHEMA,
      enabledPackReleaseIds: [...assertMakerV8EnabledPackReleaseIds(
        state.playerUi?.enabledPackReleaseIds, state.playerSession?.recipe)],
      profile: structuredClone(state.playerUi?.profile || {}),
      soul: structuredClone(state.playerUi?.soul || {}),
      imageExport: exactMakerV8ExportOptions(state.playerSession?.player?.document?.canvas, {
        sizeMode: state.playerUi.export.sizeMode, transparent: state.playerUi.export.transparent,
      }),
      recipe: structuredClone(state.playerSession?.recipe || {}),
      loadout: structuredClone(state.playerSession?.loadout || {}),
      render: state.playerExportRecord ? {
        schemaVersion: state.playerExportRecord.schemaVersion,
        mediaType: state.playerExportRecord.mediaType,
        width: state.playerExportRecord.width,
        height: state.playerExportRecord.height,
        byteLength: state.playerExportRecord.byteLength,
        sha256: state.playerExportRecord.sha256,
      } : null,
    };
  }

  function playerProjectBinding() {
    const walletAddress = state.connection.address;
    const rootId = state.playerSession?.rootId;
    const rootContentCommitment = state.playerSession?.player?.evidence?.contentCommitment;
    if (!EXACT_ADDRESS.test(walletAddress || '') || !EXACT_OBJECT_ID.test(rootId || '')
      || !EXACT_SHA256.test(rootContentCommitment || '')) {
      throw new TypeError('The Player project is not bound to one exact wallet and certified Maker Root.');
    }
    return {
      walletAddress,
      rootId,
      rootContentCommitment,
      key: [PLAYER_PROJECT_STORAGE_PREFIX, walletAddress, rootId, rootContentCommitment].join(':'),
    };
  }

  function parseStoredPlayerProject(value, binding) {
    let record = value;
    if (typeof value === 'string') {
      try { record = JSON.parse(value); } catch { throw new TypeError('The saved Player project is not valid JSON.'); }
    }
    const revision = record?.revision;
    const baseRevision = record?.baseRevision;
    const project = record?.session;
    const recordKeys = record && typeof record === 'object'
      ? Object.keys(record).sort().join(',') : '';
    const projectKeys = project && typeof project === 'object'
      ? Object.keys(project).sort().join(',') : '';
    if (!record || typeof record !== 'object' || Array.isArray(record)
      || record.schemaVersion !== PLAYER_PROJECT_STORE_SCHEMA
      || recordKeys !== [
        'baseRevision', 'projectGeneration', 'projectHash', 'revision', 'rootContentCommitment',
        'rootId', 'schemaVersion', 'session', 'updatedAt', 'walletAddress', 'writerId',
      ].sort().join(',')
      || record.walletAddress !== binding.walletAddress
      || record.rootId !== binding.rootId
      || record.rootContentCommitment !== binding.rootContentCommitment
      || !Number.isSafeInteger(revision) || revision < 1
      || !(baseRevision === null || (Number.isSafeInteger(baseRevision) && baseRevision >= 1))
      || (revision === 1 ? baseRevision !== null : baseRevision !== revision - 1)
      || typeof record.writerId !== 'string' || !record.writerId
      || !Number.isSafeInteger(record.projectGeneration) || record.projectGeneration < 1
      || !Number.isSafeInteger(record.updatedAt) || record.updatedAt < 1
      || !EXACT_SHA256.test(record.projectHash || '')
      || !project || project.schemaVersion !== PLAYER_PROJECT_SCHEMA
      || projectKeys !== ['enabledPackReleaseIds', 'imageExport', 'loadout', 'profile', 'recipe', 'render', 'schemaVersion', 'soul'].join(',')
      || project.recipe?.rootId !== binding.rootId
      || project.recipe?.rootContentCommitment !== binding.rootContentCommitment
      || project.loadout?.rootId !== binding.rootId
      || project.loadout?.rootContentCommitment !== binding.rootContentCommitment) {
      throw new TypeError('The saved Player project does not match this exact wallet and certified Maker Root.');
    }
    assertMakerV8EnabledPackReleaseIds(project.enabledPackReleaseIds, project.recipe);
    const imageExport = exactMakerV8ExportOptions(state.playerSession.player.document.canvas, project.imageExport);
    if (canonicalJson(project.imageExport) !== canonicalJson(imageExport)) {
      throw new TypeError('The saved Player export options are not exact.');
    }
    return structuredClone(record);
  }

  function localProjectStorage() {
    const storage = win.localStorage;
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
      throw new TypeError('Durable Player project storage is unavailable.');
    }
    return storage;
  }

  function playerProjectBase(record = null) {
    return record ? Object.freeze({
      revision: record.revision,
      projectHash: record.projectHash,
      writerId: record.writerId,
    }) : Object.freeze({ revision: null, projectHash: '', writerId: '' });
  }

  function exactPlayerProjectBase(value) {
    const revision = value?.revision ?? null;
    const projectHash = String(value?.projectHash || '');
    const writerId = String(value?.writerId || '');
    if (revision === null) {
      if (projectHash || writerId) throw new TypeError('An empty Player project base must be exact.');
    } else if (!Number.isSafeInteger(revision) || revision < 1
      || !EXACT_SHA256.test(projectHash) || !writerId) {
      throw new TypeError('An exact acknowledged Player project base is required.');
    }
    return Object.freeze({ revision, projectHash, writerId });
  }

  function capturePlayerProjectOwner(baseOverride) {
    const binding = Object.freeze({ ...playerProjectBinding() });
    const base = exactPlayerProjectBase(baseOverride || {
      revision: state.playerProjectBaseRevision,
      projectHash: state.playerProjectBaseHash,
      writerId: state.playerProjectBaseWriterId,
    });
    return Object.freeze({
      request: state.playerRequest,
      mutation: state.playerMutationRequest,
      rootId: state.playerSession.rootId,
      binding,
      storage: localProjectStorage(),
      storageKey: binding.key,
      writerId: state.playerWriterId,
      base,
    });
  }

  function playerProjectOwnerCurrent(owner) {
    return Boolean(owner)
      && playerMutationCurrent(owner.request, owner.mutation, owner.rootId)
      && state.playerWriterId === owner.writerId
      && state.connection.address === owner.binding.walletAddress
      && state.playerSession?.player?.evidence?.contentCommitment
        === owner.binding.rootContentCommitment
      && state.playerProjectStorageKey === owner.storageKey;
  }

  function samePlayerProjectOwner(left, right) {
    return Boolean(left && right)
      && left.request === right.request
      && left.mutation === right.mutation
      && left.rootId === right.rootId
      && left.storage === right.storage
      && left.storageKey === right.storageKey
      && left.writerId === right.writerId;
  }

  function durablePlayerProjectMatchesBase(record, base) {
    if (base.revision === null) return record === null;
    return Boolean(record)
      && record.revision === base.revision
      && record.projectHash === base.projectHash
      && record.writerId === base.writerId;
  }

  function samePlayerProjectBase(left, right) {
    return left?.revision === right?.revision
      && left?.projectHash === right?.projectHash
      && left?.writerId === right?.writerId;
  }

  function removeStoredValue(storage, key) {
    if (typeof storage.removeItem === 'function') storage.removeItem(key);
    else storage.setItem(key, '');
  }

  function recoveryRecord(record) {
    return {
      branchId: `${record.writerId}:${record.revision}:${record.projectHash}`,
      schemaVersion: record.schemaVersion,
      writerId: record.writerId,
      revision: record.revision,
      baseRevision: record.baseRevision,
      projectHash: record.projectHash,
      session: structuredClone(record.session),
    };
  }

  function presentPlayerProjectConflict(records, message = 'Another tab saved a different Player project revision.') {
    if (!state.playerUi) return;
    const deduped = [...new Map(records.filter(Boolean).map((record) => {
      const branch = recoveryRecord(record);
      return [branch.branchId, branch];
    })).values()];
    state.playerUi.recoveryBranches = deduped;
    state.playerUi.selectedRecoveryBranchId = deduped[0]?.branchId || '';
    state.playerUi.completionStatus = { state: 'blocked', message };
    renderPlayer({ drawPreview: false });
  }

  async function storedWalRecords(storage, binding) {
    if (!Number.isSafeInteger(storage.length) || typeof storage.key !== 'function') return [];
    const prefix = `${binding.key}:wal:`;
    const records = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (typeof key !== 'string' || !key.startsWith(prefix)) continue;
      const value = storage.getItem(key);
      if (!value) continue;
      try {
        const record = parseStoredPlayerProject(value, binding);
        if (await sha256Hex(record.session) === record.projectHash) records.push(record);
      } catch { /* Invalid WALs never become recovery authority. */ }
    }
    return records;
  }

  async function restorePersistentPlayerProject() {
    if (!state.playerSession || !state.playerUi) return null;
    const request = state.playerRequest;
    const mutation = state.playerMutationRequest;
    const rootId = state.playerSession.rootId;
    let binding;
    let storage;
    try {
      binding = playerProjectBinding();
      storage = localProjectStorage();
      state.playerProjectStorageKey = binding.key;
      const raw = storage.getItem(binding.key);
      const walRecords = await storedWalRecords(storage, binding);
      if (!playerMutationCurrent(request, mutation, rootId)) return null;
      if (!raw) {
        state.playerProjectBaseRevision = null;
        state.playerProjectBaseHash = '';
        state.playerProjectBaseWriterId = '';
        if (walRecords.length) presentPlayerProjectConflict(walRecords, 'An interrupted Player project save can be recovered.');
        return null;
      }
      const record = parseStoredPlayerProject(raw, binding);
      if (await sha256Hex(record.session) !== record.projectHash) {
        throw new TypeError('The saved Player project hash does not match its exact content.');
      }
      if (!playerMutationCurrent(request, mutation, rootId)) return null;
      if (updatePlayerRecipe && getPlayerSnapshot) {
        await updatePlayerRecipe({
          selections: structuredClone(record.session.recipe.selections),
          colors: structuredClone(record.session.recipe.colors),
          outputKey: record.session.recipe.outputKey,
        });
        if (!playerMutationCurrent(request, mutation, rootId)) return null;
        mergeExactPlayerSnapshot(await getPlayerSnapshot(), rootId);
      }
      if (!playerMutationCurrent(request, mutation, rootId)) return null;
      state.playerProjectGeneration += 1;
      state.playerUi.profile = structuredClone(record.session.profile);
      state.playerUi.enabledPackReleaseIds = [...record.session.enabledPackReleaseIds];
      state.playerUi.soul = structuredClone(record.session.soul);
      Object.assign(state.playerUi.export, record.session.imageExport);
      state.playerUi.save = {
        state: 'saved',
        savedAt: new Date(record.updatedAt).toLocaleTimeString(),
        error: '',
      };
      state.playerProjectBaseRevision = record.revision;
      state.playerProjectBaseHash = record.projectHash;
      state.playerProjectBaseWriterId = record.writerId;
      if (walRecords.length) {
        presentPlayerProjectConflict(
          [record, ...walRecords],
          'An interrupted or competing Player project revision can be recovered.',
        );
      }
      return record;
    } catch (error) {
      if (playerMutationCurrent(request, mutation, rootId)) {
        const message = String(error?.message || 'The saved Player project could not be restored.');
        state.playerUi.completionIssues = [message];
        state.playerUi.completionStatus = { state: 'blocked', message };
      }
      return null;
    }
  }

  async function persistPlayerProjectSnapshot({
    snapshot,
    generation,
    owner,
    base,
    resolveConflict = false,
    requireCurrentGeneration = false,
  }) {
    const ownerCurrent = () => playerProjectOwnerCurrent(owner);
    const generationCurrent = () => (
      !requireCurrentGeneration || generation === state.playerProjectGeneration
    );
    const writeCurrent = () => ownerCurrent() && generationCurrent();
    if (!writeCurrent()) return null;
    const { binding, storage, storageKey } = owner;
    const projectHash = await sha256Hex(snapshot);
    if (!writeCurrent()) return null;
    const rawCurrent = storage.getItem(storageKey);
    const current = rawCurrent ? parseStoredPlayerProject(rawCurrent, binding) : null;
    if (current && await sha256Hex(current.session) !== current.projectHash) {
      throw new TypeError('The current durable Player project hash does not match its exact content.');
    }
    if (!writeCurrent()) return null;
    if (state.playerUi.recoveryBranches.length && resolveConflict !== true) {
      const error = new Error(
        'Another tab saved a different Player project revision. Export one recovery copy before continuing.',
      );
      error.code = 'PLAYER_PROJECT_CAS_CONFLICT';
      throw error;
    }
    if (!durablePlayerProjectMatchesBase(current, base)) {
      const pending = {
        schemaVersion: PLAYER_PROJECT_STORE_SCHEMA,
        ...binding,
        key: undefined,
        revision: (base.revision ?? 0) + 1,
        baseRevision: base.revision,
        writerId: owner.writerId,
        projectGeneration: generation,
        projectHash,
        updatedAt: Date.now(),
        session: structuredClone(snapshot),
      };
      presentPlayerProjectConflict(
        [current, pending],
        'Another tab saved a different Player project revision. Export one recovery copy before continuing.',
      );
      const error = new Error(
        'Another tab saved a different Player project revision. Export one recovery copy before continuing.',
      );
      error.code = 'PLAYER_PROJECT_CAS_CONFLICT';
      throw error;
    }
    const actualRevision = current?.revision ?? null;
    const record = {
      schemaVersion: PLAYER_PROJECT_STORE_SCHEMA,
      walletAddress: binding.walletAddress,
      rootId: binding.rootId,
      rootContentCommitment: binding.rootContentCommitment,
      revision: (actualRevision ?? 0) + 1,
      baseRevision: actualRevision,
      writerId: owner.writerId,
      projectGeneration: generation,
      projectHash,
      updatedAt: Date.now(),
      session: structuredClone(snapshot),
    };
    const serialized = JSON.stringify(record);
    const walKey = `${storageKey}:wal:${owner.writerId}`;
    if (!writeCurrent()) return null;
    storage.setItem(walKey, serialized);
    if (!writeCurrent()) {
      removeStoredValue(storage, walKey);
      return null;
    }
    storage.setItem(storageKey, serialized);
    const readback = storage.getItem(storageKey);
    const verified = parseStoredPlayerProject(readback, binding);
    if (verified.writerId !== record.writerId || verified.revision !== record.revision
      || verified.projectHash !== record.projectHash || readback !== serialized
      || await sha256Hex(verified.session) !== record.projectHash) {
      throw new TypeError('Durable Player project readback did not match the exact saved revision.');
    }
    if (storage.getItem(storageKey) !== readback) {
      throw new TypeError('Durable Player project changed during exact readback verification.');
    }
    removeStoredValue(storage, walKey);
    if (!ownerCurrent()) return record;
    state.playerProjectStorageKey = storageKey;
    state.playerProjectBaseRevision = record.revision;
    state.playerProjectBaseHash = record.projectHash;
    state.playerProjectBaseWriterId = record.writerId;
    if (generation === state.playerProjectGeneration) {
      state.playerPendingProjectSave = null;
      state.playerUi.recoveryBranches = [];
      state.playerUi.selectedRecoveryBranchId = '';
      state.playerUi.save = {
        state: 'saved',
        savedAt: new Date(record.updatedAt).toLocaleTimeString(),
        error: '',
      };
      renderPlayer();
    }
    return record;
  }

  function queuePlayerProjectSave({
    snapshot,
    generation,
    base,
    resolveConflict = false,
    requireCurrentGeneration = false,
    branchId = '',
  } = {}) {
    if (!state.playerSession || !state.playerUi) return Promise.resolve(null);
    const exactBranchId = String(branchId || '');
    if (exactBranchId && (state.playerUi.selectedRecoveryBranchId !== exactBranchId
      || !state.playerUi.recoveryBranches.some((branch) => branch.branchId === exactBranchId))) {
      return Promise.resolve(null);
    }
    const exactSnapshot = structuredClone(snapshot || playerProjectSnapshot());
    const exactGeneration = generation ?? state.playerProjectGeneration;
    const owner = capturePlayerProjectOwner(base);
    const predecessor = state.playerProjectSaveTail;
    const token = { owner, record: null };
    state.playerProjectSaveTail = token;
    if (exactGeneration === state.playerProjectGeneration) {
      state.playerUi.save = { state: 'saving', savedAt: '', error: '' };
      renderPlayer();
    }
    const run = async () => {
      let attemptedBase = owner.base;
      try {
        if (samePlayerProjectOwner(predecessor?.owner, owner) && predecessor.record
          && samePlayerProjectBase(predecessor.owner.base, owner.base)) {
          attemptedBase = playerProjectBase(predecessor.record);
        }
        const record = await persistPlayerProjectSnapshot({
          snapshot: exactSnapshot,
          generation: exactGeneration,
          owner,
          base: attemptedBase,
          resolveConflict,
          requireCurrentGeneration,
        });
        token.record = record;
        return record;
      } catch (error) {
        if (playerProjectOwnerCurrent(owner)) {
          const message = String(error?.message || 'Player project save failed.');
          const retryGeneration = state.playerProjectGeneration;
          const retrySnapshot = exactGeneration === retryGeneration
            ? exactSnapshot : playerProjectSnapshot();
          state.playerPendingProjectSave = {
            snapshot: structuredClone(retrySnapshot),
            generation: retryGeneration,
            base: attemptedBase,
            resolveConflict,
            requireCurrentGeneration,
            branchId: exactBranchId,
          };
          state.playerUi.save = { state: 'error', savedAt: '', error: message };
          state.playerUi.completionStatus = { state: 'blocked', message };
          renderPlayer({ drawPreview: false });
        }
        throw error;
      }
    };
    const queued = state.playerProjectSaveQueue.then(run, run);
    state.playerProjectSaveQueue = queued.catch(() => null);
    return queued;
  }

  function retryPendingPlayerProjectSave() {
    const pending = state.playerPendingProjectSave;
    if (!pending || pending.generation !== state.playerProjectGeneration) return Promise.resolve(null);
    return queuePlayerProjectSave(pending);
  }

  async function observePlayerProjectStorage(event) {
    if (!state.playerSession || !state.playerUi || !state.playerProjectStorageKey
      || event?.key !== state.playerProjectStorageKey || !event.newValue) return;
    try {
      const owner = capturePlayerProjectOwner();
      const currentValue = owner.storage.getItem(owner.storageKey);
      if (!currentValue || currentValue !== event.newValue) return;
      const foreign = parseStoredPlayerProject(currentValue, owner.binding);
      if (await sha256Hex(foreign.session) !== foreign.projectHash) return;
      if (!playerProjectOwnerCurrent(owner)
        || owner.storage.getItem(owner.storageKey) !== currentValue) return;
      const acknowledgedBase = exactPlayerProjectBase({
        revision: state.playerProjectBaseRevision,
        projectHash: state.playerProjectBaseHash,
        writerId: state.playerProjectBaseWriterId,
      });
      if (acknowledgedBase.revision !== null && foreign.revision < acknowledgedBase.revision) {
        return;
      }
      if (foreign.projectHash === acknowledgedBase.projectHash) {
        if (acknowledgedBase.revision === null || foreign.revision >= acknowledgedBase.revision) {
          state.playerProjectBaseRevision = foreign.revision;
          state.playerProjectBaseHash = foreign.projectHash;
          state.playerProjectBaseWriterId = foreign.writerId;
        }
        return;
      }
      const snapshot = playerProjectSnapshot();
      const localHash = await sha256Hex(snapshot);
      if (!playerProjectOwnerCurrent(owner)
        || owner.storage.getItem(owner.storageKey) !== currentValue
        || localHash === foreign.projectHash) return;
      const local = {
        schemaVersion: PLAYER_PROJECT_STORE_SCHEMA,
        walletAddress: owner.binding.walletAddress,
        rootId: owner.binding.rootId,
        rootContentCommitment: owner.binding.rootContentCommitment,
        revision: (acknowledgedBase.revision ?? 0) + 1,
        baseRevision: acknowledgedBase.revision,
        writerId: owner.writerId,
        projectGeneration: state.playerProjectGeneration,
        projectHash: localHash,
        updatedAt: Date.now(),
        session: snapshot,
      };
      presentPlayerProjectConflict(
        [foreign, local],
        'Another tab saved a different Player project revision. Export one recovery copy before continuing.',
      );
    } catch {
      // Invalid or unrelated storage events never become recovery authority.
    }
  }

  async function selectPlayerRecoveryBranch(branchId) {
    if (!state.playerSession || !state.playerUi || !updatePlayerRecipe || !getPlayerSnapshot) return null;
    const branch = state.playerUi.recoveryBranches.find((candidate) => (
      candidate.branchId === branchId
    ));
    if (!branch?.session) return null;
    const request = state.playerRequest;
    const mutation = state.playerMutationRequest;
    const rootId = state.playerSession.rootId;
    try {
      exactPlayerSession({
        ...state.playerSession,
        recipe: branch.session.recipe,
        loadout: branch.session.loadout,
      }, rootId);
      const generation = invalidatePlayerProject();
      state.playerUi.selectedRecoveryBranchId = branchId;
      await updatePlayerRecipe({
        selections: structuredClone(branch.session.recipe.selections),
        colors: structuredClone(branch.session.recipe.colors),
        outputKey: branch.session.recipe.outputKey,
      });
      if (!playerProjectCurrent(generation, request, mutation, rootId)) return null;
      mergeExactPlayerSnapshot(await getPlayerSnapshot(), rootId);
      if (!playerProjectCurrent(generation, request, mutation, rootId)) return null;
      state.playerUi.profile = structuredClone(branch.session.profile || {});
      state.playerUi.enabledPackReleaseIds = [...assertMakerV8EnabledPackReleaseIds(
        branch.session.enabledPackReleaseIds, branch.session.recipe)];
      state.playerUi.soul = structuredClone(branch.session.soul || { defaults: {}, documents: {} });
      Object.assign(state.playerUi.export, exactMakerV8ExportOptions(
        state.playerSession.player.document.canvas, branch.session.imageExport));
      if (!renderPlayerPreview || !await requestPlayerCanonicalPreview()) {
        throw new TypeError(
          state.playerUi.render.message || 'Canonical Player preview failed for the selected recovery copy.',
        );
      }
      if (!playerProjectCurrent(generation, request, mutation, rootId)) return null;
      if (!await requestPlayerExportRender()) throw new TypeError('The recovery copy final image could not be rendered.');
      if (!playerProjectCurrent(generation, request, mutation, rootId)) return null;
      const binding = playerProjectBinding();
      const storage = localProjectStorage();
      const currentRaw = storage.getItem(binding.key);
      const current = currentRaw ? parseStoredPlayerProject(currentRaw, binding) : null;
      if (current && await sha256Hex(current.session) !== current.projectHash) {
        throw new TypeError('The current durable Player project hash does not match its exact content.');
      }
      if (!playerProjectCurrent(generation, request, mutation, rootId)) return null;
      state.playerPendingProjectSave = {
        snapshot: playerProjectSnapshot(),
        generation,
        base: playerProjectBase(current),
        resolveConflict: true,
        branchId,
      };
      const message = 'Recovery copy selected. Review the preview, then retry the durable save.';
      state.playerUi.save = { state: 'error', savedAt: '', error: message };
      state.playerUi.completionStatus = { state: 'blocked', message };
      renderPlayer();
      return branch;
    } catch (error) {
      if (playerMutationCurrent(request, mutation, rootId)) {
        presentPlayerError(error, 'The selected Player recovery copy could not be restored.');
      }
      throw error;
    }
  }

  function createPersistentPlayerPreviewUrl() {
    releasePlayerExportUrl({ clearRecord: false });
    if (!state.playerExportRecord) return '';
    const urls = browserObjectUrls();
    if (!urls) return '';
    state.playerExportUrl = urls.createObjectURL(pngBlob(state.playerExportRecord));
    state.playerUi.export.previewUrl = state.playerExportUrl;
    return state.playerExportUrl;
  }

  function envelopeRecoveryScope() {
    const key = `${state.playerSession?.rootId ?? ''}/${state.connection.address ?? ''}`;
    if (key !== envelopeRecoveryScopeKey) {
      envelopeRecoveryScopeKey = key; envelopeRecoveryStageGeneration++;
    }
    return key;
  }

  function stageEnvelopeRecovery(serialized) {
    if (typeof serialized !== 'string' || new TextEncoder().encode(serialized).length > 2 * 1024 * 1024) {
      throw new TypeError('Envelope recovery must be a JSON file no larger than 2 MiB.');
    }
    const record = JSON.parse(serialized);
    if (record?.schema !== 'animacraft.native-envelope-operation.v1'
      || record.intent?.rootId !== state.playerSession?.rootId || record.intent?.signer !== state.connection.address) {
      throw new TypeError('Envelope recovery belongs to another Maker or wallet.');
    }
    // This is staging only. The operation verifies the full template, signature,
    // history and existing private journal before accepting an imported artifact.
    envelopeRecoveryByScope.set(envelopeRecoveryScope(), serialized);
    envelopeRecoveryStageGeneration++;
    state.playerUi.envelopeRecoveryAvailable = true;
  }

  async function refreshEnvelopeRecovery() {
    if (!exportPlayerEnvelopeRecovery || !state.playerSession || !state.playerUi) return;
    const key = envelopeRecoveryScope(); const rootId = state.playerSession.rootId;
    const stageGeneration = ++envelopeRecoveryStageGeneration; const projectGeneration = state.playerProjectGeneration;
    try {
      const serialized = await exportPlayerEnvelopeRecovery({ rootId });
      if (key !== envelopeRecoveryScope() || stageGeneration !== envelopeRecoveryStageGeneration
        || projectGeneration !== state.playerProjectGeneration || !state.playerUi) return;
      if (serialized) stageEnvelopeRecovery(serialized);
      state.playerUi.envelopeRecoveryAvailable = envelopeRecoveryByScope.has(key);
      renderPlayer({ drawPreview: false });
    } catch { /* Existing completion error remains visible; never clear recovery. */ }
  }

  async function importEnvelopeRecovery(control) {
    if (!state.playerSession || !state.playerUi || state.playerCompletionFlight || control.disabled) return;
    const file = control.files?.[0]; control.value = '';
    if (!file) return;
    const key = envelopeRecoveryScope(); const generation = state.playerProjectGeneration;
    const stageGeneration = ++envelopeRecoveryStageGeneration;
    try {
      if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > 2 * 1024 * 1024 || typeof file.text !== 'function') {
        throw new TypeError('Envelope recovery must be a JSON file no larger than 2 MiB.');
      }
      const serialized = await file.text();
      if (key !== envelopeRecoveryScope() || stageGeneration !== envelopeRecoveryStageGeneration
        || generation !== state.playerProjectGeneration || !state.playerUi || state.playerCompletionFlight) return;
      stageEnvelopeRecovery(serialized);
      state.playerUi.completionStatus = { state: 'blocked', message: makerWorkspaceText(state.locale, 'playerEnvelopeRecoveryCopy') };
      renderPlayer({ drawPreview: false });
    } catch (error) {
      if (key !== envelopeRecoveryScope() || stageGeneration !== envelopeRecoveryStageGeneration
        || generation !== state.playerProjectGeneration || !state.playerUi) return;
      state.playerUi.completionStatus = { state: 'blocked', message: String(error.message) };
      renderPlayer({ drawPreview: false });
    }
  }

  async function requestPlayerExportRender({ open = false } = {}) {
    if (!state.playerUi || !state.playerSession || !renderPlayerExport
      || (state.playerCompletionFlight && !state.playerCompletionFlight.abort.signal.aborted)) return null;
    const ui = state.playerUi;
    const generation = state.playerProjectGeneration;
    const playerRequest = state.playerRequest;
    const mutation = state.playerMutationRequest;
    const rootId = state.playerSession.rootId;
    const exportOptions = exactMakerV8ExportOptions(state.playerSession.player.document.canvas, {
      sizeMode: ui.export.sizeMode, transparent: ui.export.transparent,
    });
    releasePlayerExportUrl();
    const ticket = state.playerExportRequest;
    const current = () => state.playerUi === ui && ticket === state.playerExportRequest
      && playerProjectCurrent(generation, playerRequest, mutation, rootId);
    if (open) ui.export.open = true;
    ui.export.state = 'rendering';
    ui.export.error = '';
    ui.export.completionConfirmed = false;
    renderPlayer({ drawPreview: false });
    try {
      // Autosave owns the canonical render while applying a recipe. Export
      // shares that render lane, so it must wait rather than cancel the save.
      await state.playerMutationQueue;
      if (!current()) return null;
      // One certified render lane: main preview must finish before final export.
      if (!state.playerRenderRecord && !await requestPlayerCanonicalPreview()) {
        if (!current()) return null;
        throw new TypeError(ui.render.message || 'Player preview failed.');
      }
      if (!current()) return null;
      const record = exactCanonicalPng(await renderPlayerExport({ rootId, exportOptions }));
      if (!current()) return null;
      const target = makerV8ExportSizes(state.playerSession.player.document.canvas)[exportOptions.sizeMode];
      if (record.width !== target.width || record.height !== target.height || record.byteLength > 12 * 1024 * 1024) {
        throw new TypeError('Final PNG dimensions or byte size exceed the selected export limits.');
      }
      state.playerExportRecord = record;
      if (ui.completedSoul?.projectHash) {
        const hash = await sha256Hex(playerProjectSnapshot());
        if (!current()) return null;
        ui.completedSoul.matchesProject = hash === ui.completedSoul.projectHash;
        ui.export.completionConfirmed = ui.completedSoul.matchesProject;
      }
      if (ui.export.open) createPersistentPlayerPreviewUrl();
      ui.export.state = 'ready';
      ui.export.error = '';
      renderPlayer({ drawPreview: false });
      return record;
    } catch (error) {
      if (!current()) return null;
      releasePlayerExportUrl();
      ui.export.state = 'error';
      ui.export.error = String(error?.message || 'Final Player image failed.');
      renderPlayer({ drawPreview: false });
      return null;
    }
  }

  async function openPlayerExport() {
    if (!state.playerUi || !state.playerSession
      || (state.playerCompletionFlight && !state.playerCompletionFlight.abort.signal.aborted)) return null;
    void refreshEnvelopeRecovery();
    const generation = state.playerProjectGeneration;
    const record = await requestPlayerExportRender({ open: true });
    if (record && generation === state.playerProjectGeneration) {
      await savePlayerProjectAfterLocalEdit(generation);
    }
    return record;
  }

  async function updatePlayerExportOptions(action, control) {
    if (!state.playerUi?.export.open || state.playerCompletionFlight || !renderPlayerExport) return;
    const previous = { sizeMode: state.playerUi.export.sizeMode, transparent: state.playerUi.export.transparent };
    const next = { ...previous };
    if (action === 'player-export-size') next.sizeMode = control.dataset.sizeMode;
    else {
      if (!['true', 'false'].includes(control.dataset.transparent)) return;
      next.transparent = control.dataset.transparent === 'true';
    }
    const options = exactMakerV8ExportOptions(state.playerSession.player.document.canvas, next);
    if (options.sizeMode === previous.sizeMode && options.transparent === previous.transparent) return;
    const generation = invalidatePlayerProject({ preservePreview: true });
    Object.assign(state.playerUi.export, options);
    // Save selected intent even when rendering fails; only exact pixels unlock completion.
    void savePlayerProjectAfterLocalEdit(generation).catch(() => null);
    const record = await requestPlayerExportRender({ open: true });
    if (record && generation === state.playerProjectGeneration) await savePlayerProjectAfterLocalEdit(generation);
  }

  function closePlayerExport() {
    if (!state.playerUi) return;
    cancelPlayerCompletion();
    state.playerUi.export.open = false;
    state.playerUi.export.state = 'idle';
    state.playerUi.export.error = '';
    releasePlayerExportUrl();
    renderPlayer();
  }

  function openJsonExport(value) {
    const name = safeDownloadName(
      state.playerUi?.profile?.name || state.playerSession?.player?.makerKey,
      'animacraft-oc',
    );
    return downloadJson(value, `${name}-recipe.json`);
  }

  function settlePlayerConfirmation(confirmed, id = null) {
    const pending = playerConfirmation;
    if (!pending || (id !== null && pending.id !== id)) return false;
    playerConfirmation = null;
    if (state.playerUi?.completionConfirmation?.id === pending.id) {
      state.playerUi.completionConfirmation = null;
    }
    const approved = confirmed === true && pending.current();
    if (approved && pending.kind === 'NEW_COMPLETION' && state.playerUi) {
      // Subsequent cancellation/recovery belongs to the new attempt. Do not
      // leave the previous Soul's completion flag blocking ordinary retry.
      state.playerUi.completedSoul = null;
      state.playerUi.export.completionConfirmed = false;
    }
    pending.resolve(approved);
    return true;
  }

  function cancelPlayerCompletion() {
    if (state.playerCompletionFlight && state.playerUi) {
      state.playerUi.completionStatus = { state: 'blocked', message: makerWorkspaceText(state.locale, 'playerStepCancelCopy') };
    }
    state.playerCompletionFlight?.abort?.abort();
    settlePlayerConfirmation(false);
  }

  function requestPlayerCompletionConfirmation(step, current) {
    if (!current()) return Promise.resolve(false);
    if (playerConfirmation) throw new TypeError('A completion step is already awaiting confirmation.');
    if (step?.rootId !== state.playerSession.rootId || step.signer !== state.connection.address) {
      throw new TypeError('Completion confirmation belongs to another Maker or wallet.');
    }
    if (step.kind === 'COMPLETION_OVERVIEW') {
      const quote = step.overview;
      if (quote?.rootId !== step.rootId || quote.signer !== step.signer
        || !quote.recipeCommitment || !quote.completePaymentQuote?.paymentCoinType
        || quote.entryPaymentQuote?.paymentCoinType !== quote.completePaymentQuote.paymentCoinType
        || !/^(0|[1-9][0-9]*)$/.test(quote.totalBusinessAmountAtomic || '')) {
        throw new TypeError('An exact current completion overview is required.');
      }
    } else if (step.kind === 'NEW_COMPLETION') {
      if (!step.actionId || !step.transactionDigest || !EXACT_OBJECT_ID.test(step.soulId || '')) {
        throw new TypeError('The previous completed Soul must be exact before starting another.');
      }
    } else if (step.kind === 'NATIVE_ENVELOPES') {
      if (!EXACT_OBJECT_ID.test(step.soulId || '') || !EXACT_OBJECT_ID.test(step.stateId || '')
        || !/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(step.transactionDigest || '')
        || !/^[1-9][0-9]{0,19}$/.test(step.gasBudgetMist || '')
        || BigInt(step.gasBudgetMist) > 0xffffffffffffffffn
        || !Number.isInteger(step.envelopeCount) || step.envelopeCount < 1 || step.envelopeCount > 3) {
        throw new TypeError('An exact encrypted-content finalization transaction is required.');
      }
    } else if (step.kind === 'PLAYER_ACTION') {
      const record = step.record;
      if (record?.status !== 'PREPARED' || record.rootId !== step.rootId
        || record.action !== step.action || !record.actionId || !record.transactionDigest) {
        throw new TypeError('An exact prepared transaction is required for confirmation.');
      }
      const quote = step.action === 'completeOutput' ? record.completePaymentQuote
        : step.action === 'acquireMakerAccess' ? record.makerEntryQuote
          : step.action === 'acquirePackAccess' ? record.packEntryQuote : null;
      if (['completeOutput', 'acquireMakerAccess', 'acquirePackAccess'].includes(step.action)
        && (!quote || !quote.paymentCoinType)) {
        throw new TypeError('This transaction does not have an exact prepared price.');
      }
      if (!['completeOutput', 'acquireMakerAccess', 'acquirePackAccess',
        'acquireBaseItem', 'commitLoadout'].includes(step.action)) {
        throw new TypeError('Unknown completion transaction step.');
      }
    } else if (step.kind !== 'STORAGE_UPLOAD' || !['RENDER', 'NATIVE_CONTENT'].includes(step.purpose)
      || typeof step.uploadId !== 'string' || !step.uploadId
      || !Number.isSafeInteger(step.byteLength) || step.byteLength < 0
      || !/^[0-9a-f]{64}$/.test(step.byteSha256 || '')) {
      throw new TypeError('An exact content upload is required for confirmation.');
    }
    const id = String(++playerConfirmationSequence);
    const promise = new Promise(resolve => { playerConfirmation = { id, resolve, current, kind: step.kind }; });
    state.playerUi.completionConfirmation = { id, step: structuredClone(step) };
    state.playerUi.export.open = true;
    renderPlayer({ drawPreview: false });
    return promise;
  }

  function completeCurrentPlayerJourney({ startNew = false } = {}) {
    if (state.playerCompletionFlight) {
      return state.playerCompletionFlight.promise;
    }
    if (!completePlayerJourney || !state.playerSession || !state.playerUi
      || !state.playerExportRecord || state.playerUi.export.state !== 'ready') return Promise.resolve(null);
    if (startNew && !state.playerUi.completedSoul) return Promise.resolve(null);
    if (!startNew && state.playerUi.export.completionConfirmed === true) return Promise.resolve(null);
    const generation = state.playerProjectGeneration;
    const previousCompletion = startNew ? structuredClone(state.playerUi.completedSoul) : null;
    const flight = { abort: new AbortController() };
    const promise = (async () => {
      const playerRequest = state.playerRequest;
      const mutation = state.playerMutationRequest;
      const rootId = state.playerSession.rootId;
      try {
        // Preserve browser user activation before autosave/hash/network awaits.
        // The account popup does not mint or carry private project content.
        openPlayerReception?.({ rootId });
        await state.playerMutationQueue;
        if (!playerProjectCurrent(generation, playerRequest, mutation, rootId)) return null;
        if (!nativeCompletionConfigured()) {
          throw new TypeError('Native completion service is not configured for this release.');
        }
        const project = structuredClone(playerProjectSnapshot());
        const projectCanonical = canonicalJson(project);
        const projectHash = await sha256Hex(projectCanonical);
        if (!playerProjectCurrent(generation, playerRequest, mutation, rootId)
          || canonicalJson(playerProjectSnapshot()) !== projectCanonical) return null;
        await queuePlayerProjectSave({ snapshot: project, generation });
        if (!playerProjectCurrent(generation, playerRequest, mutation, rootId)
          || canonicalJson(playerProjectSnapshot()) !== projectCanonical) return null;
        state.playerUi.completionStatus = { state: 'pending', message: 'Completing character…' };
        renderPlayer();
        const result = await completePlayerJourney({
          rootId,
          projectHash,
          selections: structuredClone(project.recipe.selections),
          recipe: structuredClone(project.recipe),
          loadout: structuredClone(project.loadout),
          render: structuredClone(project.render),
          project,
        }, {
          signal: flight.abort.signal,
          recoveryJson: envelopeRecoveryByScope.get(envelopeRecoveryScope()),
          startNew,
          newCompletionFrom: previousCompletion ? { actionId: previousCompletion.actionId,
            soulId: previousCompletion.soulId, transactionDigest: previousCompletion.transactionDigest } : undefined,
          confirmStep: step => requestPlayerCompletionConfirmation(step, () => (
            !flight.abort.signal.aborted
            && playerProjectCurrent(generation, playerRequest, mutation, rootId)
            && state.route === 'make'
            && canonicalJson(playerProjectSnapshot()) === projectCanonical
          )),
        });
        if (flight.abort.signal.aborted || state.route !== 'make'
          || !playerProjectCurrent(generation, playerRequest, mutation, rootId)
          || canonicalJson(playerProjectSnapshot()) !== projectCanonical) return null;
        if (result?.status === 'HANDOFF_READY') {
          if (!result.actionId || !EXACT_OBJECT_ID.test(result.soulId || '') || !result.transactionDigest
            || !/^[0-9a-f]{64}$/.test(result.completedProjectHash || '')) {
            throw new TypeError('Completed Soul identity or project proof is missing.');
          }
          envelopeRecoveryByScope.delete(envelopeRecoveryScope());
          envelopeRecoveryStageGeneration++;
          state.playerUi.envelopeRecoveryAvailable = false;
          const handoffUrl = safeConfiguredExternalUrl(win, result.handoffUrl);
          const matchesProject = result.completedProjectHash === projectHash;
          state.playerUi.completionIssues = [];
          state.playerUi.completionStatus = {
            state: 'ready',
            message: matchesProject ? 'Character complete. Ready for Soulidity.'
              : makerWorkspaceText(state.locale, 'playerStepRecoveredOtherDraft'),
          };
          state.playerUi.export.completionConfirmed = matchesProject;
          state.playerUi.completedSoul = result.actionId && EXACT_OBJECT_ID.test(result.soulId || '') && result.transactionDigest
            ? { actionId: result.actionId, soulId: result.soulId, transactionDigest: result.transactionDigest,
              projectHash: result.completedProjectHash, handoffUrl, matchesProject } : null;
          renderPlayer();
          if (handoffUrl && result.recovered !== true) win.location?.assign?.(handoffUrl);
          return result;
        }
        if (result?.status === 'RECOVERY_REQUIRED') {
          const stage = String(result.stage || 'chain completion');
          const message = String(result.message || `Recovery required at ${stage}.`);
          state.playerUi.completionIssues = [message];
          state.playerUi.completionStatus = { state: 'blocked', message };
          renderPlayer();
          return result;
        }
        throw new TypeError('Player completion returned an unknown Fresh-v8 state.');
      } catch (error) {
        if (!playerProjectCurrent(generation, playerRequest, mutation, rootId)) return null;
        if (flight.abort.signal.aborted) return null;
        if (typeof error?.recoveryJson === 'string') stageEnvelopeRecovery(error.recoveryJson);
        const message = String(error?.message || 'Player completion failed.');
        state.playerUi.completionIssues = [message];
        state.playerUi.completionStatus = { state: 'blocked', message };
        renderPlayer();
        throw error;
      }
    })();
    flight.promise = promise.finally(() => {
      if (state.playerCompletionFlight === flight) {
        settlePlayerConfirmation(false);
        state.playerCompletionFlight = null;
        if (state.playerUi) renderPlayer({ drawPreview: false });
      }
    });
    state.playerCompletionFlight = flight;
    return flight.promise;
  }

  function savePlayerProjectAfterLocalEdit(generation) {
    if (state.playerRecipeMutationPending > 0) return state.playerMutationQueue;
    return queuePlayerProjectSave({ generation });
  }

  function updatePlayerProfile(control) {
    if (!state.playerUi || control?.disabled) return;
    const action = String(control.dataset.action || '');
    const profileKey = {
      'player-profile-name': 'name',
      'player-profile-world': 'world',
      'player-profile-description': 'description',
      'player-profile-tags': 'tags',
    }[action];
    if (profileKey) {
      const generation = invalidatePlayerProject();
      state.playerUi.profile[profileKey] = String(control.value || '');
      renderPlayer();
      return savePlayerProjectAfterLocalEdit(generation).catch(() => null);
    }
    if (action === 'player-soul-document') {
      const key = String(control.dataset.soulKey || '');
      if (!['soulMd', 'memoryMd', 'skillMd'].includes(key)) return;
      const generation = invalidatePlayerProject();
      state.playerUi.soul.documents[key] = String(control.value || '');
      renderPlayer();
      return savePlayerProjectAfterLocalEdit(generation).catch(() => null);
    }
  }

  async function acquirePlayerPack(action, control) {
    if (packAcquisitionFlight) return packAcquisitionFlight;
    if (!preparePlayerAction || !executePlayerAction || !recoverPlayerAction || !getPlayerSnapshot) return null;
    const ui = state.playerUi;
    const request = state.playerRequest;
    const mutation = state.playerMutationRequest;
    const rootId = state.playerSession.rootId;
    const walletAddress = state.connection.address;
    const current = () => playerMutationCurrent(request, mutation, rootId)
      && state.playerUi === ui && state.connection.address === walletAddress;
    const releaseId = String(control.dataset.releaseId || '');
    if (action === 'player-cancel-pack-v8') {
      // Dismiss only the prompt. The durable prepared/signed action is preserved.
      ui.packAcquisition = null;
      renderPlayer();
      return null;
    }
    const previous = ui.packAcquisition;
    if (action !== 'player-acquire-expansion-v8'
      && (!previous?.record || previous.releaseId !== releaseId
        || previous.record.actionId !== control.dataset.actionId)) return null;
    const work = (async () => {
      try {
        ui.packAcquisition = { releaseId, record: previous?.releaseId === releaseId ? previous.record : null, pending: true };
        renderPlayer({ drawPreview: false });
        await state.playerMutationQueue;
        if (!current()) return null;
        let record;
        if (action === 'player-confirm-pack-v8') {
          if (previous.record.status !== 'PREPARED' || !previous.record.packEntryQuote) return null;
          record = await executePlayerAction(previous.record.actionId);
        } else if (action === 'player-recover-pack-v8') {
          record = await recoverPlayerAction(previous.record.actionId, { replayIfNotFound: false });
        } else {
          const snapshot = await getPlayerSnapshot();
          if (!current()) return null;
          mergeExactPlayerSnapshot(snapshot, rootId);
          const choice = state.playerSession.player.contextualChoices?.packStyles
            ?.find(row => row.releaseId === releaseId);
          if (!choice) throw new TypeError('This Pack is no longer in the certified catalog.');
          if (choice.access?.accessible || choice.access?.canRetryRuntime) {
            ui.packAcquisition = null;
            renderPlayer();
            return null;
          }
          if (choice.access?.availableForAcquire !== true) {
            throw new TypeError(choice.access?.reason || 'This Pack cannot be acquired.');
          }
          record = await preparePlayerAction({ action: 'acquirePackAccess',
            input: { releaseId, semanticPackId: choice.semanticPackId } });
        }
        if (!current()) return null;
        if (record?.action !== 'acquirePackAccess' || record.rootId !== rootId
          || record.packEntryQuote?.releaseId !== releaseId
          || action !== 'player-acquire-expansion-v8' && record.actionId !== previous.record.actionId) {
          throw new TypeError('The prepared Pack transaction does not match this request.');
        }
        ui.packAcquisition = { releaseId, record, pending: false };
        if (record.status === 'FINALIZED_SUCCESS') {
          const snapshot = await getPlayerSnapshot();
          if (!current()) return null;
          mergeExactPlayerSnapshot(snapshot, rootId);
          const acquired = state.playerSession.player.contextualChoices?.packStyles
            ?.filter(choice => choice.releaseId === releaseId);
          if (acquired?.length && acquired.every(choice => choice.access?.accessible && choice.access?.canEquip)) {
            await queuePlayerRecipeMutation(async () => true, { afterCommit: () => {
              ui.enabledPackReleaseIds = [...new Set([...ui.enabledPackReleaseIds, releaseId])].sort();
            } });
            if (!current()) return null;
          }
        }
        renderPlayer();
        return record;
      } catch (error) {
        if (current()) {
          ui.packAcquisition = { ...ui.packAcquisition, pending: false,
            error: String(error?.message || 'Pack acquisition failed.') };
          renderPlayer({ drawPreview: false });
        }
        throw error;
      }
    })();
    packAcquisitionFlight = work;
    try { return await work; } finally {
      if (packAcquisitionFlight === work) packAcquisitionFlight = null;
    }
  }

  async function handlePlayerAction(action, control, eventTarget = control) {
    if (['player-confirm-journey-step', 'player-cancel-journey-step'].includes(action)) {
      if (control?.disabled || !playerConfirmation || control?.dataset.confirmationId !== playerConfirmation.id) return;
      if (action === 'player-cancel-journey-step') cancelPlayerCompletion();
      else settlePlayerConfirmation(true, control.dataset.confirmationId);
      if (state.playerUi) renderPlayer({ drawPreview: false });
      return;
    }
    if (['player-start-new-completion', 'player-open-completed-soul'].includes(action)) {
      if (control?.disabled || !state.playerUi?.completedSoul || !state.playerSession) return;
      if (control.dataset.completedActionId !== state.playerUi.completedSoul.actionId) return;
      if (action === 'player-start-new-completion') await completeCurrentPlayerJourney({ startNew: true });
      else {
        const url = safeConfiguredExternalUrl(win, state.playerUi.completedSoul.handoffUrl);
        if (url) win.location?.assign?.(url);
      }
      return;
    }
    if (action === 'player-recover-pack-v8' && !state.playerSession && state.playerRecovery) {
      const recovery = state.playerRecovery;
      const current = () => !state.destroyed && state.playerRecovery === recovery
        && recovery.request === state.playerRequest && recovery.walletAddress === state.connection.address;
      if (!recoverPlayerAction || control?.disabled || recovery.pending || !current()
        || control?.dataset.actionId !== recovery.record.actionId) return;
      recovery.pending = true;
      renderPlayer({ drawPreview: false });
      try {
        const record = await recoverPlayerAction(recovery.record.actionId, { replayIfNotFound: false });
        if (!current()) return;
        if (record?.actionId !== recovery.record.actionId || record.rootId !== recovery.record.rootId
          || record.action !== 'acquirePackAccess') throw new TypeError('Recovered Pack transaction identity changed.');
        recovery.record = record;
        recovery.error = '';
      } catch (error) {
        if (current()) recovery.error = String(error?.message || 'Transaction query failed.');
      } finally {
        if (current()) { recovery.pending = false; renderPlayer({ drawPreview: false }); }
      }
      return;
    }
    if (state.localPlayer) {
      if (control?.disabled || (action.endsWith('-backdrop') && eventTarget !== control)) return;
      if (action.startsWith('player-profile-') || action === 'player-soul-document') return;
      await state.localPlayer.dispatch(action, control?.dataset || {});
      return;
    }
    if (!state.playerSession || !state.playerUi || control?.disabled) return;
    if (action === 'player-import-envelope-recovery') return;
    if (action === 'player-clear-envelope-recovery') {
      if (state.playerCompletionFlight) return;
      // Clear only the staged file, never the private durable WAL or the
      // operation's verified emergency cache. A stale import must be removable.
      envelopeRecoveryByScope.delete(envelopeRecoveryScope()); envelopeRecoveryStageGeneration++;
      state.playerUi.envelopeRecoveryAvailable = false;
      renderPlayer({ drawPreview: false }); return;
    }
    if (action === 'player-export-envelope-recovery') {
      const serialized = envelopeRecoveryByScope.get(envelopeRecoveryScope());
      if (serialized) downloadJsonText(serialized, 'animacraft-envelope-recovery.json');
      return;
    }
    const view = projectedPlayerView();
    if (!view) return;
    if (['player-acquire-expansion-v8', 'player-confirm-pack-v8',
      'player-cancel-pack-v8', 'player-recover-pack-v8'].includes(action)) {
      await acquirePlayerPack(action, control);
    } else if (action === 'player-expansion-v8') {
      const releaseId = String(control.value || '');
      const enable = control.checked === true;
      let enabled;
      await queuePlayerRecipeMutation(async () => {
        const freshView = projectedPlayerView();
        const choices = freshView.contextualChoices.filter(choice => choice.source === 'PACK' && choice.releaseId === releaseId);
        if (!choices.length || choices.some(choice => !choice.access.accessible || !choice.access.canEquip)) {
          throw new TypeError('This Pack does not have current eligible access.');
        }
        enabled = [...new Set(enable ? [...state.playerUi.enabledPackReleaseIds, releaseId]
          : state.playerUi.enabledPackReleaseIds.filter(id => id !== releaseId))].sort();
        const selections = structuredClone(state.playerSession.recipe.selections)
          .filter(selection => enable || selection.source !== 'PACK' || selection.releaseId !== releaseId);
        if (!enable) {
          for (const part of state.playerSession.player.document.parts) {
            if (!(part.required || part.kind === 'LAST_BASTION') || selections.some(row => makerV8PlayerPartUiKey(state.playerSession.player, row) === part.key)) continue;
            for (const fallback of state.playerSession.player.document.defaultRecipe.selections.filter(row => row.partKey === part.key)) {
              const item = part.items.find(row => row.key === fallback.itemKey && row.status === 'PUBLIC');
              const style = item?.styles.find(row => row.key === fallback.styleKey);
              if (!style) throw new TypeError('The required Part has no certified default Style.');
              selections.push(exactSelectionFromChoice({ source: 'BASE', partKey: part.key,
                itemKey: item.key, styleKey: style.key, trackKey: style.trackKey,
                colorChannelKey: style.colorChannelKey, defaultSwatchKey: style.defaultSwatchKey }));
            }
          }
        }
        await updatePlayerRecipe({ selections });
        return true;
      }, { afterCommit: () => { state.playerUi.enabledPackReleaseIds = enabled; } });
    } else if (action === 'player-part') {
      state.playerUi.selectedPartKey = String(control.dataset.partId || '');
      state.playerUi.pickerPanel = 'parts';
      renderPlayer();
    } else if (action === 'player-palette') {
      state.playerUi.pickerPanel = 'colors';
      renderPlayer();
    } else if (action === 'player-close-palette') {
      state.playerUi.pickerPanel = 'parts';
      renderPlayer();
    } else if (action === 'player-info') {
      state.playerUi.introOpen = true;
      renderPlayer({ focusInfo: true });
    } else if (action === 'close-player-info' || action === 'close-player-info-backdrop') {
      if (action === 'close-player-info-backdrop' && eventTarget !== control) return;
      state.playerUi.introOpen = false;
      renderPlayer();
    } else if (action === 'player-reset' && resetPlayerRecipe && getPlayerSnapshot) {
      await queuePlayerRecipeMutation(async () => {
        await resetPlayerRecipe();
        return true;
      }, {
        after: () => { state.playerUi.pickerPanel = 'parts'; },
      });
    } else if (action === 'player-item' || action === 'player-style') {
      const choiceId = String(control.dataset.choiceId || '');
      await applyPlayerRecipePatch(() => {
        const freshView = projectedPlayerView();
        const choice = freshView?.parts.flatMap((part) => part.choices)
          .find((candidate) => candidate.id === choiceId);
        if (!choice) return null;
        const selections = nextPlayerSelections(action, choice);
        return selections ? { selections } : null;
      });
    } else if (action === 'player-none') {
      const partKey = String(control.dataset.partId || view.selectedPartKey || '');
      await applyPlayerRecipePatch(() => {
        const part = projectedPlayerView().parts
          .find((candidate) => candidate.key === partKey);
        if (!part || part.required === true || part.kind === 'LAST_BASTION') return null;
        return {
          selections: state.playerSession.recipe.selections
            .filter((selection) => makerV8PlayerPartUiKey(state.playerSession.player, selection) !== partKey),
        };
      });
    } else if (action === 'player-output') {
      const outputKey = String(control.dataset.outputKey || '');
      await applyPlayerRecipePatch(() => ({ outputKey }));
    } else if (action === 'player-color') {
      const channelKey = String(control.dataset.channelId || '');
      const swatchKey = String(control.dataset.swatchId || '');
      await applyPlayerRecipePatch(() => {
        const entry = { channelKey, swatchKey,
          ...(control.dataset.releaseId ? { releaseId: String(control.dataset.releaseId) } : {}) };
        const colors = state.playerSession.recipe.colors
          .filter((row) => makerV8PlayerColorKey(row) !== makerV8PlayerColorKey(entry));
        colors.push(entry);
        return { colors };
      });
    } else if (action === 'player-preview-export') {
      await openPlayerExport();
    } else if (action === 'player-export-retry') {
      await openPlayerExport();
    } else if (action === 'player-export-size' || action === 'player-export-background') {
      await updatePlayerExportOptions(action, control);
    } else if (action === 'close-player-export' || action === 'close-player-export-backdrop') {
      if (action === 'close-player-export-backdrop' && eventTarget !== control) return;
      closePlayerExport();
    } else if (action === 'player-export' || action === 'player-export-recipe') {
      const snapshot = playerProjectSnapshot();
      try {
        await queuePlayerProjectSave({
          snapshot,
          generation: state.playerProjectGeneration,
        });
      } catch {
        // The exact local download remains the recovery path for a failed durable save.
      }
      openJsonExport(snapshot);
    } else if (action === 'player-download-png' && state.playerExportUrl && state.playerExportRecord
      && state.playerUi.export.state === 'ready' && state.playerUi.completedSoul?.matchesProject
      && state.playerUi.export.completionConfirmed) {
      const name = safeDownloadName(
        state.playerUi.profile.name || state.playerSession.player.makerKey,
        'animacraft-oc',
      );
      downloadAnchor(state.playerExportUrl, `${name}.png`);
    } else if (action === 'player-complete') {
      await openPlayerExport();
    } else if (action === 'player-confirm-complete') {
      await completeCurrentPlayerJourney();
    } else if (action === 'player-retry-save') {
      await retryPendingPlayerProjectSave();
    } else if (action === 'player-reset-soul-document') {
      const key = String(control.dataset.soulKey || '');
      if (!['soulMd', 'memoryMd', 'skillMd'].includes(key)) return;
      const generation = invalidatePlayerProject();
      delete state.playerUi.soul.documents[key];
      renderPlayer();
      await savePlayerProjectAfterLocalEdit(generation);
    } else if (action === 'player-reset-all-soul') {
      const generation = invalidatePlayerProject();
      state.playerUi.soul.documents = {};
      renderPlayer();
      await savePlayerProjectAfterLocalEdit(generation);
    } else if (action === 'player-select-recovery') {
      const branchId = String(control.dataset.writerId || '');
      if (!state.playerUi.recoveryBranches.some((branch) => branch.branchId === branchId)) return;
      await selectPlayerRecoveryBranch(branchId);
    } else if (action === 'player-export-recovery') {
      if (!state.playerUi.recoveryBranches.length) return;
      const binding = playerProjectBinding();
      downloadJson({
        schemaVersion: 'animacraft.maker-v8-player-recovery-bundle.v1',
        walletAddress: binding.walletAddress,
        rootId: binding.rootId,
        rootContentCommitment: binding.rootContentCommitment,
        branches: structuredClone(state.playerUi.recoveryBranches),
      }, 'animacraft-player-recovery.json');
    }
  }

  function renderTheme() {
    const runtime = win.ANIMACRAFT_THEME;
    const preference = THEME_IDS.includes(runtime?.readPreference?.())
      ? runtime.readPreference() : 'auto';
    runtime?.applyPreference?.(preference);
    const button = byId('themeButton');
    if (button) button.dataset.themePreference = preference;
    doc.querySelectorAll?.('[data-theme-option]').forEach((option) => {
      const active = option.dataset.themeOption === preference;
      option.setAttribute('aria-checked', String(active));
      option.tabIndex = active ? 0 : -1;
    });
  }

  function themeMenuOpen() {
    return byId('themeMenu')?.classList?.contains('active') === true;
  }

  function closeTheme({ returnFocus = true } = {}) {
    const menu = byId('themeMenu');
    const button = byId('themeButton');
    if (!menu || !button) return;
    const open = themeMenuOpen();
    menu.classList.remove('active');
    menu.setAttribute('aria-hidden', 'true');
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (open && returnFocus) button.focus?.({ preventScroll: true });
  }

  function closeAccount() {
    const panel = byId('accountPanel');
    const button = byId('accountButton');
    panel?.classList?.remove('active');
    panel?.setAttribute?.('aria-hidden', 'true');
    button?.setAttribute?.('aria-expanded', 'false');
  }

  function openTheme() {
    const menu = byId('themeMenu');
    const button = byId('themeButton');
    if (!menu || !button) return;
    closeAccount();
    menu.hidden = false;
    menu.classList.add('active');
    menu.setAttribute('aria-hidden', 'false');
    button.setAttribute('aria-expanded', 'true');
    const selectedOption = menu.querySelector?.('[role="menuitemradio"][aria-checked="true"]')
      || menu.querySelector?.('[role="menuitemradio"]');
    selectedOption?.focus?.({ preventScroll: true });
  }

  function openAccount() {
    closeTheme({ returnFocus: false });
    const panel = byId('accountPanel');
    const button = byId('accountButton');
    panel?.classList?.add('active');
    panel?.setAttribute?.('aria-hidden', 'false');
    button?.setAttribute?.('aria-expanded', 'true');
  }

  function renderConnection() {
    const connection = state.connection;
    const label = byId('walletButton')?.querySelector?.('[data-i18n="walletConnect"]');
    byId('walletButton')?.classList?.toggle('connected', connection.connected);
    if (label) {
      label.textContent = connection.connected
        ? shortAddress(connection.address)
        : t('walletConnect', 'Connect wallet');
    }
    if (byId('panelWalletButton')) {
      byId('panelWalletButton').textContent = connection.connected
        ? t('walletConnectedAs', 'Wallet connected: {address}', { address: shortAddress(connection.address) })
        : t('connectSuiWallet', 'Connect Sui wallet');
    }
    if (byId('walletSummary')) {
      byId('walletSummary').textContent = connection.connected
        ? `${connection.provider} · ${connection.network || 'Sui'}`
        : t('walletDisconnected', 'Wallet not connected');
    }
    if (byId('accountIdentity')) {
      byId('accountIdentity').textContent = connection.connected
        ? shortAddress(connection.address) : t('accountGuest', 'Animacraft user');
    }
    byId('walletFirstCard')?.classList?.toggle('connected', connection.connected);
    doc.querySelector?.('.account-grid')?.classList?.toggle('locked', !connection.connected);
    doc.querySelectorAll?.('.account-grid [data-page]').forEach((button) => {
      button.disabled = !connection.connected
        || (button.dataset.page === 'make' && !canOpenPlayer());
    });
    if (byId('accountMakeOc')) {
      byId('accountMakeOc').title = canOpenPlayer()
        ? t('continueMakerSession', 'Continue the selected Maker session')
        : t('choosePublishedMaker', 'Choose a published Maker from Templates first');
    }
    renderSoulidityLinks();
    if (byId('creatorWalletGate')) byId('creatorWalletGate').hidden = connection.connected;
    if (byId('creatorConsole')) byId('creatorConsole').hidden = !connection.connected;
    if (!connection.connected && PROTECTED_PAGES.has(state.route)) {
      navigate('templates', { replace: !startupCreatorRoute, preserveStartupCreator: true });
    }
    renderTemplateCards();
    renderTemplateDetail();
    renderPlayer();
    renderBridgeState();
  }

  function refreshConnection(value = getConnection()) {
    if (state.destroyed) return state.connection;
    const next = normalizeOriginalWalletConnection(value);
    const wasLocal = Boolean(state.localPlayer);
    const walletChanged = state.connection.address !== next.address || state.connection.connected !== next.connected;
    const restartDraftRead = walletChanged && next.connected && state.draftListRequest > 0
      && (state.draftsStatus === 'loading' || state.drafts.some(row => row.document.metadata.coverAssetId));
    if (walletChanged) {
      invalidatePublicationReview();
      cancelCreatorStyleInteraction();
      creatorConnectionGeneration += 1;
      state.draftListRequest += 1;
      releaseDraftCoverUrls();
      if (creatorAssetFlight) creatorAssetFlight.invalidated = true;
      creatorDeleteIntent = null;
      renderDraftDeleteConfirmation();
      closeLocalPlayer();
    }
    if ((state.playerSession || state.playerPendingRootId || state.playerRecovery)
      && state.connection.address !== next.address) clearPlayerSession();
    state.connection = next;
    if (walletChanged) renderCreatorLibrary();
    // Auto-connect can invalidate the initial list before it has any rows. Its
    // replacement must not depend on an already-discovered cover existing.
    if (restartDraftRead) {
      void refreshDrafts();
    }
    if (wasLocal && walletChanged && state.route === 'make') navigate('creator');
    renderConnection();
    if (startupCreatorRoute && next.connected) navigate('creator');
    return state.connection;
  }

  function navigate(page, { replace = true, preserveStartupCreator = false } = {}) {
    invalidatePublicationReview();
    cancelCreatorStyleInteraction();
    if (!preserveStartupCreator) startupCreatorRoute = false;
    const navigation = ++state.localNavigationRequest;
    const requested = ORIGINAL_PRODUCT_PAGES.includes(page) ? page : 'templates';
    const walletAllowed = !state.connection.connected && PROTECTED_PAGES.has(requested)
      ? 'templates' : requested;
    const recoveryAvailable = state.playerRecovery?.request === state.playerRequest
      && state.playerRecovery?.walletAddress === state.connection.address;
    const next = walletAllowed === 'make' && !canOpenPlayer() && !recoveryAvailable
      ? 'templates' : walletAllowed;
    const previous = state.route;
    if (previous === 'creator' && next !== 'creator' && state.connection.connected && creatorHasPendingChanges()) {
      void finishCreatorChanges().then((saved) => {
        if (state.destroyed || navigation !== state.localNavigationRequest) return;
        if (saved) navigate(page, { replace });
        else win.history?.replaceState?.(null, '', '#creator');
      });
      return previous;
    }
    if (next !== 'make') cancelPlayerCompletion();
    if (previous === 'make' && next !== 'make' && state.localPlayer?.hasUnsavedChanges()) {
      const controls = state.localPlayer;
      void controls.flush().then(() => {
        if (!state.destroyed && state.localPlayer === controls && navigation === state.localNavigationRequest) navigate(page, { replace });
      }).catch(() => {
        if (!state.destroyed && state.localPlayer === controls && navigation === state.localNavigationRequest) win.history?.replaceState?.(null, '', '#make');
      });
      return previous;
    }
    // Also cancel an opening session before its asynchronous handle arrives.
    if (next !== 'make') closeLocalPlayer();
    state.route = next;
    if (libraryPreviewFlight) renderCreatorLibrary();
    if (previous === 'template' && next !== 'template') {
      if (state.playerPendingRootId) clearPlayerSession();
      state.templateDetailRequest += 1;
      state.templateDetail = null;
      state.templateDetailStatus = 'idle';
      state.templateDetailError = '';
      state.templateDetailCoverUrl = '';
    }
    doc.querySelectorAll?.('.page').forEach((section) => {
      section.classList.toggle('active', section.id === next);
    });
    doc.querySelectorAll?.('[data-page]').forEach((button) => {
      button.classList.toggle('active', button.dataset.page === next);
    });
    if (replace && win.history?.replaceState) {
      const onMakerDeepLink = Boolean(makerReferenceFromLocation(win));
      win.history.replaceState(null, '', onMakerDeepLink && next !== 'template'
        ? `/#${next}`
        : `#${next}`);
    }
    closeAccount();
    if (next === 'docs') renderDocsHandbook();
    win.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
    return next;
  }

  function syncBrowserLocation() {
    const makerId = makerReferenceFromLocation(win);
    if (!makerId) {
      navigate(pageFromLocation(win), { replace: false });
      return;
    }
    state.templateId = makerId;
    if (state.templates.some((template) => template.id === makerId)) {
      void openTemplateDetail(makerId, { updatePath: false });
      return;
    }
    state.templateDetailRequest += 1;
    state.templateDetail = null;
    state.templateDetailCoverUrl = '';
    state.templateDetailStatus = state.templatesStatus === 'loading' ? 'loading' : 'error';
    state.templateDetailError = state.templatesStatus === 'loading'
      ? '' : 'The requested certified Maker is not available.';
    navigate('template', { replace: false });
    renderTemplateCards();
    renderTemplateDetail();
  }

  function creatorDraftCanvasLabel(record) {
    const { width, height } = record.document.canvas;
    return width === height ? '1:1' : '9:16';
  }

  function renderCreatorLibrary() {
    const root = byId('imageMakerList');
    if (!root) return;
    if (state.draftsStatus === 'loading') {
      root.innerHTML = `<div class="empty-state">${escapeHtml(t('loading', 'Loading…'))}</div>`;
      return;
    }
    if (state.draftsStatus === 'error') {
      root.innerHTML = `<div class="empty-state">${escapeHtml(state.draftsError)}</div>`;
      return;
    }
    const errorMarkup = state.draftsError ? `<div class="empty-state" role="alert">${escapeHtml(state.draftsError)}</div>` : '';
    root.innerHTML = errorMarkup + (state.drafts.length ? state.drafts.map((record) => {
      const document = record.document;
      const published = publishedMaker(record);
      const active = record.draftId === state.record?.draftId;
      const cover = state.draftCoverUrls.get(record.draftId);
      const coverUrl = cover?.revision === record.revision ? cover.url : '';
      const previewPending = libraryPreviewFlight?.draftId === record.draftId && libraryPreviewCurrent();
      const previewDisabled = !openLocalPlayer || !state.connection.connected || state.playerCompletionFlight || previewPending;
      return `
        <article class="creator-maker-card ${active ? 'active' : ''}" data-maker="${escapeHtml(record.draftId)}" style="--accent:#27c5c8; --secondary:#f0a23a;">
          <div class="maker-cover-mini">${coverUrl ? `<img src="${escapeHtml(coverUrl)}" alt="${escapeHtml(document.metadata.name)}" />` : '<span class="mini-face"></span>'}</div>
          <div class="maker-card-body">
            <div class="maker-tags">
              <span class="maker-card-lifecycle ${published ? 'active' : 'draft'}">${escapeHtml(published ? publicationLabel(record) : record.draftId.startsWith('maker-recovery-')
    ? makerWorkspaceText(state.locale, 'localRecoveryCopy') : t('localDraft', 'Local draft'))}</span>
              <span>${escapeHtml(creatorDraftCanvasLabel(record))}</span>
              <span>${escapeHtml(t('freeCombine', 'Free combine'))}</span>
            </div>
            <h2>${escapeHtml(document.metadata.name)}</h2>
            ${published ? `<p style="overflow-wrap:anywhere">${escapeHtml(publicationLabel(record))}: ${escapeHtml(published.rootId)} · ${escapeHtml(published.makerVersion)}</p>` : ''}
            <p>${escapeHtml(document.metadata.summary)}</p>
            ${document.metadata.creator ? `<p>${escapeHtml(t('byCreator', 'by {creator}', { creator: document.metadata.creator }))}</p>` : ''}
            ${document.metadata.style ? `<p>${escapeHtml(document.metadata.style)}</p>` : ''}
          </div>
          <div class="maker-card-actions">
            <button class="secondary" type="button" data-preview-maker="${escapeHtml(record.draftId)}"${previewDisabled ? ` disabled aria-disabled="true" title="${escapeHtml(t('makerLifecycleActionUnavailable', 'This action is unavailable until the current operation finishes.'))}"` : ''}>${escapeHtml(previewPending ? t('loading', 'Loading…') : t('preview', 'Preview'))}</button>
            <button class="secondary" type="button" data-manage-lifecycle="${escapeHtml(record.draftId)}">${escapeHtml(t('makerLifecycleManage', 'Manage'))}</button>
            <button class="primary" type="button" data-edit-maker="${escapeHtml(record.draftId)}">${escapeHtml(t('edit', 'Edit'))}</button>
          </div>
        </article>`;
    }).join('') : `<div class="empty-state">${escapeHtml(t('noOwnedMakers', 'No wallet-owned Makers yet. Create an OC Maker to begin your first local draft.'))}</div>`);
  }

  function libraryPreviewCurrent(flight = libraryPreviewFlight) {
    return Boolean(flight && !state.destroyed && state.connection.connected && state.route === 'creator'
      && flight.connection === creatorConnectionGeneration && flight.request === state.draftOpenRequest
      && flight.navigation === state.localNavigationRequest);
  }

  async function previewLibraryDraft(draftId) {
    if (!openLocalPlayer || !state.connection.connected || state.route !== 'creator' || state.playerCompletionFlight) return null;
    if (libraryPreviewCurrent() && libraryPreviewFlight.draftId === draftId) return null;
    const opening = openDraft(draftId, { preserveLibraryOnError: true });
    const flight = { draftId, request: state.draftOpenRequest, navigation: state.localNavigationRequest,
      connection: creatorConnectionGeneration };
    libraryPreviewFlight = flight;
    state.draftsError = '';
    renderCreatorLibrary();
    try {
      const record = await opening;
      if (!libraryPreviewCurrent(flight) || record?.draftId !== draftId) return null;
      return await startLocalPlayer();
    } catch {
      // Draft reads retain the Library retry button; Player failures use the
      // existing Creator error region and toolbar retry.
      return null;
    } finally {
      if (libraryPreviewFlight === flight) {
        libraryPreviewFlight = null;
        if (!state.destroyed) renderCreatorLibrary();
      }
    }
  }

  async function refreshDrafts() {
    const request = ++state.draftListRequest;
    state.draftsStatus = 'loading';
    state.draftsError = '';
    renderCreatorLibrary();
    try {
      const rows = await listDrafts();
      if (state.destroyed || request !== state.draftListRequest) return state.drafts;
      if (!Array.isArray(rows)) throw new TypeError('Fresh-v8 draft storage returned an invalid list.');
      state.drafts = rows.map(exactDraftRecord)
        .sort((left, right) => right.updatedAt - left.updatedAt || left.draftId.localeCompare(right.draftId));
      state.draftsStatus = 'ready';
      renderCreatorLibrary();
      for (const record of state.drafts) void readPublishedMaker(record);
      for (const [draftId, entry] of state.draftCoverUrls) {
        if (!state.drafts.some(row => row.draftId === draftId && row.revision === entry.revision)) {
          revokeObjectUrl(entry.url); state.draftCoverUrls.delete(draftId);
        }
      }
      // Read only drafts with a cover; keep the list usable while images load.
      for (const record of state.drafts) {
        if (!record.document.metadata.coverAssetId || state.draftCoverUrls.has(record.draftId)) continue;
        try {
          const bundle = await getDraft({ draftId: record.draftId });
          if (state.destroyed || request !== state.draftListRequest) return state.drafts;
          if (bundle?.draft?.revision !== record.revision
            || !state.drafts.some(row => row.draftId === record.draftId && row.revision === record.revision)) continue;
          installDraftCover(record, bundle.assets);
          renderCreatorLibrary();
        } catch { /* Editing/retry remains available when a preview cannot load. */ }
      }
      return state.drafts;
    } catch (error) {
      if (state.destroyed || request !== state.draftListRequest) return state.drafts;
      state.drafts = [];
      state.draftsStatus = 'error';
      state.draftsError = String(error?.message || 'Fresh-v8 drafts are unavailable.');
      renderCreatorLibrary();
      return state.drafts;
    }
  }

  function openMakerRegistration() {
    const modal = byId('makerRegistrationModal');
    if (!modal || !state.connection.connected) return;
    clearMakerRegistrationError();
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    byId('newMakerName')?.focus?.({ preventScroll: true });
  }

  function closeMakerRegistration() {
    const modal = byId('makerRegistrationModal');
    modal?.classList?.remove('active');
    modal?.setAttribute?.('aria-hidden', 'true');
  }

  function clearMakerRegistrationError() {
    const input = byId('newMakerName');
    input?.setCustomValidity?.('');
    input?.setAttribute?.('aria-invalid', 'false');
  }

  function presentMakerRegistrationError(error) {
    const input = byId('newMakerName');
    if (!input) return;
    const message = String(error?.message || 'Maker draft creation failed.');
    input.setCustomValidity?.(message);
    input.setAttribute?.('aria-invalid', 'true');
    input.reportValidity?.();
    input.focus?.({ preventScroll: true });
  }

  async function registerMakerDraft() {
    if (!state.connection.connected) return null;
    const button = byId('registerMaker');
    if (button?.disabled) return null;
    const navigation = ++state.localNavigationRequest;
    if (creatorHasPendingChanges()) {
      const waitingRequest = ++state.draftOpenRequest;
      if (!await finishCreatorChanges() || waitingRequest !== state.draftOpenRequest
        || navigation !== state.localNavigationRequest) return null;
    }
    const name = String(byId('newMakerName')?.value || '').trim() || 'Untitled OC Maker';
    const canvasChoice = [...(doc.querySelectorAll?.('[data-canvas-choice]') || [])]
      .find((choice) => choice.classList?.contains('active'))?.dataset?.canvasChoice || '1:1';
    const canvas = canvasChoice === '9:16' ? '1080×1920' : '1024×1024';
    const startingStructure = [...(doc.querySelectorAll?.('[data-maker-start]') || [])]
      .find((choice) => choice.classList?.contains('active'))?.dataset?.makerStart || 'character';
    const request = ++state.draftOpenRequest;
    const generation = beginCreatorDraftGeneration();
    if (button) button.disabled = true;
    try {
      const createdRecord = exactDraftRecord(await createDraft({ name, canvas, startingStructure }));
      if (state.destroyed || request !== state.draftOpenRequest
        || navigation !== state.localNavigationRequest
        || generation !== state.creatorDraftGeneration) return null;
      const bundle = await getDraft({ draftId: createdRecord.draftId });
      if (state.destroyed || request !== state.draftOpenRequest
        || navigation !== state.localNavigationRequest
        || generation !== state.creatorDraftGeneration) return null;
      const created = exactDraftRecord(bundle?.draft || bundle);
      installCreatorRecord(created);
      installDraftAssets(bundle?.assets);
      state.undo = [];
      state.redo = [];
      state.creatorTab = 'structure';
      state.versionHistoryOpen = false;
      state.saveState = 'saved';
      normalizeSelection(created.document, state);
      if (byId('newMakerName')) byId('newMakerName').value = '';
      clearMakerRegistrationError();
      closeMakerRegistration();
      await refreshDrafts();
      showCreatorEditor();
      renderCreator();
      await requestCreatorPreview();
      return created;
    } catch (error) {
      if (!state.destroyed && request === state.draftOpenRequest) {
        presentMakerRegistrationError(error);
      }
      throw error;
    } finally {
      if (button) button.disabled = false;
    }
  }

  function renderDraftRecovery() {
    const status = byId('draftRecoveryStatus');
    const root = byId('draftRecoveryList');
    if (!status || !root) return;
    if (state.draftsStatus === 'loading') {
      status.textContent = t('draftRecoveryScanning', 'Scanning browser drafts…');
      root.innerHTML = '';
      return;
    }
    if (state.draftsStatus === 'error') {
      status.textContent = state.draftsError;
      root.innerHTML = '';
      return;
    }
    status.textContent = state.drafts.length
      ? t('draftRecoveryFound', '{count} recoverable draft(s) found.', { count: state.drafts.length })
      : t('draftRecoveryEmpty', 'No recoverable drafts were found.');
    root.innerHTML = state.drafts.map((record) => `
      <article class="draft-recovery-card">
        <div>
          <h3>${escapeHtml(record.document.metadata.name)}</h3>
          <p class="draft-recovery-meta">Fresh-v8 · ${escapeHtml(t('draftRecoveryRevision', 'Revision {revision}', { revision: record.revision }))}</p>
        </div>
        <div class="draft-recovery-actions">
          <button class="secondary" type="button" data-recovery-action="export" data-recovery-id="${escapeHtml(record.draftId)}" disabled aria-disabled="true">${escapeHtml(t('draftRecoveryExport', 'Export backup'))}</button>
          <button class="primary" type="button" data-recovery-action="restore" data-recovery-id="${escapeHtml(record.draftId)}">${escapeHtml(t('draftRecoveryRestore', 'Restore copy'))}</button>
        </div>
      </article>`).join('');
  }

  async function refreshDraftRecovery() {
    const request = ++state.draftRecoveryRequest;
    await refreshDrafts();
    if (state.destroyed || request !== state.draftRecoveryRequest) return;
    renderDraftRecovery();
  }

  function openDraftRecoveryCenter() {
    const modal = byId('draftRecoveryModal');
    if (!modal) return;
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    byId('draftRecoveryTitle')?.focus?.({ preventScroll: true });
    void refreshDraftRecovery();
  }

  function closeDraftRecoveryCenter() {
    state.draftRecoveryRequest += 1;
    const modal = byId('draftRecoveryModal');
    modal?.classList?.remove('active');
    modal?.setAttribute?.('aria-hidden', 'true');
    if (byId('draftRecoveryStatus')) byId('draftRecoveryStatus').textContent = '';
    if (byId('draftRecoveryList')) byId('draftRecoveryList').innerHTML = '';
  }

  function showCreatorEditor() {
    doc.querySelector?.('.maker-list-panel')?.classList?.add('editing');
    doc.querySelectorAll?.('[data-creator-view]').forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.creatorView === 'edit');
    });
    doc.querySelector?.('.creator-view[data-creator-view="edit"]')
      ?.classList?.add('v4-parts-active');
    doc.querySelectorAll?.('[data-editor-panel]').forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.editorPanel === 'parts');
    });
    doc.querySelectorAll?.('[data-editor-panel-button]').forEach((button) => {
      button.classList.toggle('active', button.dataset.editorPanelButton === 'parts');
    });
  }

  async function showCreatorLibrary() {
    cancelCreatorStyleInteraction();
    const navigation = ++state.localNavigationRequest;
    if (creatorHasPendingChanges() && !await finishCreatorChanges()) return;
    if (state.destroyed || navigation !== state.localNavigationRequest) return;
    doc.querySelector?.('.maker-list-panel')?.classList?.remove('editing');
    doc.querySelectorAll?.('[data-creator-view]').forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.creatorView === 'list');
    });
    renderCreatorLibrary();
  }

  function creatorUncommittedInput() {
    const input = creatorInputSession;
    return Boolean(input && input.generation === state.creatorDraftGeneration
      && input.tab === state.creatorTab && mount.contains?.(input.control)
      && String(input.control.value) !== input.submittedValue);
  }

  function creatorHasPendingChanges() {
    return Boolean(state.record && (state.packEditor?.dirty || packSaveFlight || packAssetFlight || creatorUncommittedInput() || state.creatorPersistPending > 0
      || state.creatorPendingSave || state.creatorPersistBlocked || state.saveState === 'error'));
  }

  function clearCreatorValidationError() {
    // A valid no-op can acknowledge a rejected edit; it must never erase a
    // failed durable write or claim its retry snapshot reached storage.
    if (state.saveState === 'error' && !state.creatorPersistBlocked
      && !state.creatorPendingSave && state.creatorPersistPending === 0) {
      state.saveState = 'saved'; state.saveLabel = '';
      renderCreator();
    }
  }

  async function submitCreatorInput(control) {
    const input = creatorInputSession?.control === control ? creatorInputSession : null;
    const generation = state.creatorDraftGeneration, draftId = state.record?.draftId;
    const value = String(control.value);
    if (input && input.submittedValue === value && state.saveState !== 'error') return;
    const previous = input?.submittedValue;
    if (input) input.submittedValue = value;
    try {
      if (await handleCreatorChange(control) === false) throw new Error(state.saveLabel || 'The Creator input is invalid.');
    }
    catch (error) {
      if (input) input.submittedValue = previous;
      if (creatorDraftCurrent(generation, draftId)) {
        state.saveState = 'error';
        state.saveLabel = String(error?.message || 'The Creator input is invalid.');
        renderCreator();
      }
      throw error;
    }
  }

  async function finishCreatorChanges() {
    const generation = state.creatorDraftGeneration;
    const connection = creatorConnectionGeneration;
    const current = () => !state.destroyed && generation === state.creatorDraftGeneration
      && connection === creatorConnectionGeneration;
    try {
      if (packAssetFlight && !await packAssetFlight) return false;
      if ((state.packEditor?.dirty || packSaveFlight) && !await saveCreatorPack()) return false;
      if (creatorUncommittedInput()) await submitCreatorInput(creatorInputSession.control);
      // The user may enqueue another field while the previous write settles.
      let queue;
      do { queue = state.creatorPersistQueue; await queue; }
      while (current() && queue !== state.creatorPersistQueue);
      if (!current()) return false;
      if (creatorHasPendingChanges()) {
        renderCreator();
        return false;
      }
      return true;
    } catch (error) {
      if (current()) {
        state.saveState = 'error';
        state.saveLabel = String(error?.message || 'Save the current Maker before leaving.');
        renderCreator();
      }
      return false;
    }
  }

  function beginCreatorDraftGeneration() {
    invalidatePublicationReview();
    state.packEditor = null;
    creatorPackRequest += 1;
    state.expansionPacks = [];
    state.expansionPacksStatus = 'ready';
    state.expansionPacksError = '';
    creatorSortDrag = null;
    state.makerCoverSaveState = 'idle';
    state.makerCoverSaveMessage = '';
    state.selectedTrackKey = '';
    state.selectedColorKey = '';
    state.creatorOpenGradients = new Set();
    cancelCreatorStyleInteraction();
    creatorInputSession = null;
    creatorInputPointerHandoff = null;
    state.editingPositionStyleKey = '';
    creatorPendingStructureSelection = null;
    creatorDeleteIntent = null;
    renderDraftDeleteConfirmation();
    closeLocalPlayer();
    state.creatorDraftGeneration += 1;
    state.creatorPersistIntent += 1;
    state.creatorPersistQueue = Promise.resolve();
    state.creatorPendingSave = null;
    state.creatorIntentDocument = null;
    state.creatorPersistPending = 0;
    state.creatorPersistBlocked = false;
    state.ruleEditor = null;
    state.saveState = 'saving';
    state.saveLabel = '';
    state.creatorRenderRequest += 1;
    return state.creatorDraftGeneration;
  }

  function installCreatorRecord(recordValue) {
    const record = exactDraftRecord(recordValue);
    state.record = record;
    state.creatorRecordGeneration = state.creatorDraftGeneration;
    state.creatorIntentDocument = structuredClone(record.document);
    updateSavedCreatorLibraryRecord(record);
    void readPublishedMaker(record);
    return record;
  }

  function updateSavedCreatorLibraryRecord(record) {
    // Use acknowledged persistence records, never the optimistic editor intent.
    const previous = state.drafts.find(row => row.draftId === record.draftId);
    const cover = state.draftCoverUrls.get(record.draftId);
    if (cover && previous && cover.revision === previous.revision
      && record.document.metadata.coverAssetId === previous.document.metadata.coverAssetId
      && JSON.stringify(record.document.assets) === JSON.stringify(previous.document.assets)) {
      cover.revision = record.revision;
    }
    state.drafts = [record, ...state.drafts.filter(row => row.draftId !== record.draftId)]
      .sort((left, right) => right.updatedAt - left.updatedAt || left.draftId.localeCompare(right.draftId));
    renderCreatorLibrary();
  }

  function creatorDraftCurrent(generation, draftId) {
    return !state.destroyed
      && generation === state.creatorDraftGeneration
      && state.record?.draftId === draftId;
  }

  function applyCreatorCommand(documentValue, command) {
    const document = structuredClone(documentValue);
    if (command?.type === 'canvas.set') document.canvas = structuredClone(command.canvas);
    else if (command?.type === 'metadata.set') document.metadata = structuredClone(command.metadata);
    else if (command?.type === 'livingContent.set') document.livingContent = structuredClone(command.livingContent);
    else if (command?.type === 'composition.set') document.composition = structuredClone(command.composition);
    else if (command?.type === 'part.upsert') {
      const index = document.parts.findIndex((part) => part.key === command.row?.key);
      if (index < 0) throw new TypeError('The selected Maker Part no longer exists.');
      document.parts[index] = structuredClone(command.row);
    } else if (command?.type === 'rule.upsert') {
      const index = document.rules.findIndex(rule => rule.key === command.row?.key);
      assertCreatorRuleOwnerUnlocked(document, command.row);
      if (index >= 0) assertCreatorRuleOwnerUnlocked(document, document.rules[index]);
      if (index < 0) document.rules.push(structuredClone(command.row));
      else document.rules[index] = structuredClone(command.row);
    } else if (command?.type === 'rule.remove') {
      if (!document.rules.some(rule => rule.key === command.key)) throw new TypeError('The selected rule no longer exists.');
      assertCreatorRuleOwnerUnlocked(document, document.rules.find(rule => rule.key === command.key));
      document.rules = document.rules.filter(rule => rule.key !== command.key);
    } else {
      throw new TypeError('The Creator edit is not an approved Fresh-v8 command.');
    }
    assertMakerV8Document(document, { mode: 'draft' });
    return document;
  }

  function queueCreatorWrite({ kind, payload, previous, targetDocument, remember = true }) {
    invalidatePublicationReview();
    if (!state.record) return Promise.resolve(null);
    cancelCreatorStyleInteraction();
    const generation = state.creatorDraftGeneration;
    const draftId = state.record.draftId;
    if (state.creatorPersistBlocked && state.creatorPendingSave
      && creatorDraftCurrent(state.creatorPendingSave.generation, state.creatorPendingSave.draftId)) {
      // Keep subsequent input in the same failed CAS snapshot. Only Save retries
      // that write; a later keystroke must not claim to be saving indefinitely.
      state.creatorPendingSave.document = structuredClone(targetDocument);
      state.creatorPersistIntent += 1;
      state.record = Object.freeze({ ...state.record, document: structuredClone(targetDocument) });
      state.saveState = 'error';
      renderCreator();
      return Promise.resolve(null);
    }
    const intent = ++state.creatorPersistIntent;
    state.creatorPersistPending += 1;
    state.saveState = 'saving';
    state.saveLabel = '';
    if (kind === 'command' && payload.type === 'livingContent.set') {
      state.record = Object.freeze({ ...state.record, document: structuredClone(targetDocument) });
    }
    renderCreator();
    const run = async () => {
      if (!creatorDraftCurrent(generation, draftId) || state.creatorPersistBlocked) return null;
      const expectedRevision = state.record.revision;
      try {
        const nextValue = kind === 'command'
          ? await dispatchDraftCommand({ draftId, expectedRevision, command: payload })
          : await replaceDraftDocument({ draftId, expectedRevision, document: payload });
        if (!creatorDraftCurrent(generation, draftId)) return null;
        const next = exactDraftRecord(nextValue);
        if (next.draftId !== draftId || next.revision <= expectedRevision) {
          throw new TypeError('Fresh-v8 draft persistence did not advance the exact draft revision.');
        }
        updateSavedCreatorLibraryRecord(next);
        if (remember) state.undo.push(structuredClone(previous));
        if (kind === 'command' || remember) state.redo = [];
        state.creatorPersistPending = Math.max(0, state.creatorPersistPending - 1);
        state.record = state.creatorPersistPending > 0
          ? Object.freeze({ ...next, document: structuredClone(state.creatorIntentDocument) })
          : next;
        if (state.creatorPersistPending === 0) {
          state.creatorIntentDocument = structuredClone(next.document);
          state.creatorPendingSave = null;
          state.saveState = 'saved';
          state.saveLabel = '';
        } else {
          state.saveState = 'saving';
        }
        if (state.creatorPersistPending === 0) selectSavedCreatorStructure();
        normalizeSelection(state.record.document, state);
        renderCreator();
        if (state.creatorPersistPending === 0) await requestCreatorPreview();
        return state.record;
      } catch (error) {
        if (creatorDraftCurrent(generation, draftId)) {
          state.creatorPersistBlocked = true;
          state.creatorPersistPending = 0;
          state.creatorPendingSave = {
            generation,
            draftId,
            expectedRevision,
            document: structuredClone(state.creatorIntentDocument || targetDocument),
            intent,
            historyDocument: remember ? structuredClone(previous) : null,
          };
          state.record = Object.freeze({ ...state.record, document: structuredClone(state.creatorPendingSave.document) });
          state.saveState = 'error';
          state.saveLabel = String(error?.message || 'Maker draft save failed.');
          renderCreator();
        }
        throw error;
      }
    };
    const queued = state.creatorPersistQueue.then(run);
    state.creatorPersistQueue = queued.catch(() => null);
    return queued;
  }

  function retryCreatorPendingSave() {
    const owner = `${state.creatorDraftGeneration}:${state.record?.draftId}`;
    if (creatorRetryFlight?.owner === owner) return creatorRetryFlight.promise;
    const flight = { owner, promise: runCreatorPendingSave() };
    creatorRetryFlight = flight;
    void flight.promise.finally(() => { if (creatorRetryFlight === flight) creatorRetryFlight = null; }).catch(() => {});
    return flight.promise;
  }

  async function saveCreatorRecoveryCopy() {
    if (!recoverDraftCopy || creatorRecoveryFlight || !state.connection.connected) return;
    const startedGeneration = state.creatorDraftGeneration, startedConnection = creatorConnectionGeneration;
    const navigation = ++state.localNavigationRequest;
    if (creatorUncommittedInput()) await submitCreatorInput(creatorInputSession.control);
    await state.creatorPersistQueue;
    if (creatorRecoveryFlight || state.destroyed || startedGeneration !== state.creatorDraftGeneration
      || startedConnection !== creatorConnectionGeneration || !state.connection.connected
      || navigation !== state.localNavigationRequest) return;
    const pending = state.creatorPendingSave;
    if (!pending || !creatorDraftCurrent(pending.generation, pending.draftId)) return;
    const document = structuredClone(pending.document), assets = structuredClone(state.draftAssets);
    const identity = JSON.stringify({ document, assets });
    if (pending.recoveryIdentity !== identity) {
      const crypto = win.crypto || globalThis.crypto;
      if (typeof crypto?.randomUUID !== 'function') throw new TypeError('Secure recovery identifiers are unavailable.');
      pending.recoveryId = `maker-recovery-${crypto.randomUUID()}`;
      pending.recoveryIdentity = identity;
    }
    const flight = { generation: pending.generation, connection: creatorConnectionGeneration,
      draftId: pending.draftId, intent: state.creatorPersistIntent,
      navigation };
    const current = () => creatorDraftCurrent(flight.generation, flight.draftId)
      && creatorConnectionGeneration === flight.connection && state.connection.connected
      && state.creatorPendingSave === pending && state.creatorPersistIntent === flight.intent
      && state.localNavigationRequest === flight.navigation;
    creatorRecoveryFlight = flight;
    state.saveState = 'saving'; state.saveLabel = makerWorkspaceText(state.locale, 'savingRecoveryCopy');
    renderCreator();
    try {
      const result = await recoverDraftCopy({ sourceDraftId: pending.draftId,
        draftId: pending.recoveryId, document, assets });
      if (!current()) return;
      const saved = exactDraftRecord(result?.draft);
      if (saved.draftId !== pending.recoveryId || JSON.stringify(saved.document) !== JSON.stringify(document)
        || !Array.isArray(result.assets)) throw new TypeError('Recovery copy did not acknowledge the exact local snapshot.');
      const assetContent = rows => rows.map(row => ({ assetId: row.assetId, kind: row.kind,
        mediaType: row.mediaType, byteLength: row.byteLength, sha256: row.sha256, bytesBase64: row.bytesBase64 }))
        .sort((left, right) => left.assetId.localeCompare(right.assetId));
      if (result.assets.some(row => row.draftId !== saved.draftId)
        || JSON.stringify(assetContent(result.assets)) !== JSON.stringify(assetContent(assets))) {
        throw new TypeError('Recovery copy did not acknowledge the exact local artwork.');
      }
      beginCreatorDraftGeneration();
      installCreatorRecord(saved); installDraftAssets(result.assets);
      state.undo = []; state.redo = [];
      state.saveState = 'saved'; state.saveLabel = ''; state.previewStatus = '';
      state.creatorTab = 'structure'; state.versionHistoryOpen = false;
      normalizeSelection(saved.document, state);
      showCreatorEditor();
      await refreshDrafts();
      if (state.record?.draftId === saved.draftId) await requestCreatorPreview();
    } catch (error) {
      if (current()) {
        state.saveState = 'error'; state.saveLabel = String(error?.message || 'Recovery copy could not be saved.');
      }
    } finally {
      if (creatorRecoveryFlight === flight) {
        creatorRecoveryFlight = null;
        if (creatorDraftCurrent(flight.generation, flight.draftId)
          && state.creatorPendingSave === pending && state.saveState === 'saving') {
          state.saveState = 'error'; state.saveLabel = makerWorkspaceText(state.locale, 'recoveryCopyRetry');
        }
      }
      if (!state.destroyed) renderCreator();
    }
  }

  async function runCreatorPendingSave() {
    const pending = state.creatorPendingSave;
    if (!pending || !creatorDraftCurrent(pending.generation, pending.draftId)) return state.record;
    const retryIntent = state.creatorPersistIntent;
    state.saveState = 'saving';
    state.saveLabel = '';
    renderCreator();
    try {
      const nextValue = await replaceDraftDocument({
        draftId: pending.draftId,
        expectedRevision: pending.expectedRevision,
        document: structuredClone(pending.document),
      });
      if (!creatorDraftCurrent(pending.generation, pending.draftId)
        || state.creatorPendingSave !== pending) return null;
      const next = exactDraftRecord(nextValue);
      if (next.draftId !== pending.draftId || next.revision <= pending.expectedRevision) {
        throw new TypeError('Fresh-v8 draft retry did not advance the exact draft revision.');
      }
      if (retryIntent !== state.creatorPersistIntent) {
        updateSavedCreatorLibraryRecord(next);
        state.record = Object.freeze({ ...next, document: structuredClone(pending.document) });
        state.creatorPendingSave = { ...pending, expectedRevision: next.revision };
        return runCreatorPendingSave();
      }
      installCreatorRecord(next);
      if (pending.historyDocument) {
        state.undo.push(structuredClone(pending.historyDocument));
        state.redo = [];
      }
      state.creatorPendingSave = null;
      state.creatorPersistBlocked = false;
      state.creatorPersistQueue = Promise.resolve();
      state.saveState = 'saved';
      state.saveLabel = '';
      normalizeSelection(state.record.document, state);
      selectSavedCreatorStructure();
      renderCreator();
      await requestCreatorPreview();
      return state.record;
    } catch (error) {
      if (creatorDraftCurrent(pending.generation, pending.draftId)) {
        state.saveState = 'error';
        state.saveLabel = String(error?.message || 'Maker draft retry failed.');
        renderCreator();
      }
      throw error;
    }
  }

  async function openDraft(draftId, { preserveLibraryOnError = false } = {}) {
    const deleteEpoch = deletedDraftReadEpochs.get(draftId) || 0;
    const navigation = ++state.localNavigationRequest;
    const request = ++state.draftOpenRequest;
    const connection = creatorConnectionGeneration;
    const current = () => !state.destroyed && request === state.draftOpenRequest
      && navigation === state.localNavigationRequest && connection === creatorConnectionGeneration;
    if (creatorHasPendingChanges() && !await finishCreatorChanges()) return null;
    if (!current()) return null;
    const generation = beginCreatorDraftGeneration();
    try {
      const result = await getDraft({ draftId });
      if (!current()
        || generation !== state.creatorDraftGeneration
        || deleteEpoch !== (deletedDraftReadEpochs.get(draftId) || 0)) return null;
      installCreatorRecord(result?.draft || result);
      installDraftAssets(result?.assets);
      state.draftsStatus = 'ready';
      state.draftsError = '';
      state.undo = [];
      state.redo = [];
      state.creatorTab = 'structure';
      state.versionHistoryOpen = false;
      state.saveState = 'saved';
      normalizeSelection(state.record.document, state);
      showCreatorEditor();
      renderCreator();
      await requestCreatorPreview();
      return current() && generation === state.creatorDraftGeneration ? state.record : null;
    } catch (error) {
      if (!current() || generation !== state.creatorDraftGeneration
        || deleteEpoch !== (deletedDraftReadEpochs.get(draftId) || 0)) return null;
      state.draftsStatus = preserveLibraryOnError ? 'ready' : 'error';
      state.draftsError = String(error?.message || 'Maker draft could not be opened.');
      renderCreatorLibrary();
      if (byId('draftRecoveryModal')?.classList?.contains('active')) renderDraftRecovery();
      throw error;
    }
  }

  async function persistCommand(command) {
    if (!state.record) return null;
    const previous = structuredClone(
      state.creatorIntentDocument || state.record.document,
    );
    const resolved = typeof command === 'function'
      ? command(structuredClone(previous)) : structuredClone(command);
    const targetDocument = applyCreatorCommand(previous, resolved);
    state.creatorIntentDocument = structuredClone(targetDocument);
    return queueCreatorWrite({
      kind: 'command',
      payload: structuredClone(resolved),
      previous,
      targetDocument,
    });
  }

  async function persistReplacement(document, { remember = true } = {}) {
    if (!state.record) return null;
    const previous = structuredClone(
      state.creatorIntentDocument || state.record.document,
    );
    const resolved = typeof document === 'function'
      ? document(structuredClone(previous)) : structuredClone(document);
    assertMakerV8Document(resolved, { mode: 'draft' });
    state.creatorIntentDocument = structuredClone(resolved);
    return queueCreatorWrite({
      kind: 'replacement',
      payload: structuredClone(resolved),
      previous,
      targetDocument: resolved,
      remember,
    });
  }

  async function undo() {
    const document = state.undo.pop();
    if (!document || !state.record) return state.record;
    if (document.type === 'asset-snapshot') {
      const redo = creatorAssetSnapshot();
      const generation = state.creatorDraftGeneration, draftId = state.record.draftId;
      try {
        const result = await restoreCreatorAssetSnapshot(document);
        if (!creatorDraftCurrent(generation, draftId)) return null;
        if (result) state.redo.unshift(redo);
        else state.undo.push(document);
        renderCreator();
        return result;
      } catch (error) { if (creatorDraftCurrent(generation, draftId)) state.undo.push(document); throw error; }
    }
    const redoDocument = structuredClone(state.record.document);
    try {
      const result = await persistReplacement(document, { remember: false });
      state.redo.unshift(redoDocument);
      renderCreator();
      return result;
    } catch (error) {
      state.undo.push(document);
      throw error;
    }
  }

  async function redo() {
    const document = state.redo.shift();
    if (!document || !state.record) return state.record;
    if (document.type === 'asset-snapshot') {
      const undo = creatorAssetSnapshot();
      const generation = state.creatorDraftGeneration, draftId = state.record.draftId;
      try {
        const result = await restoreCreatorAssetSnapshot(document);
        if (!creatorDraftCurrent(generation, draftId)) return null;
        if (result) state.undo.push(undo);
        else state.redo.unshift(document);
        renderCreator();
        return result;
      } catch (error) { if (creatorDraftCurrent(generation, draftId)) state.redo.unshift(document); throw error; }
    }
    const undoDocument = structuredClone(state.record.document);
    try {
      const result = await persistReplacement(document, { remember: false });
      state.undo.push(undoDocument);
      renderCreator();
      return result;
    } catch (error) {
      state.redo.unshift(document);
      throw error;
    }
  }

  async function loadVersionHistory() {
    if (!state.record || !listDraftVersions) return;
    const request = ++state.versionHistoryRequest;
    const generation = state.creatorDraftGeneration;
    const draftId = state.record.draftId;
    const current = () => request === state.versionHistoryRequest
      && state.versionHistoryOpen && creatorDraftCurrent(generation, draftId);
    state.versionHistoryStatus = 'loading';
    state.versionHistoryError = '';
    state.versionHistoryMessage = '';
    state.chainVersions = [];
    state.chainVersionStatus = makerWorkspaceText(state.locale, listMakerLineage ? 'chainLoading' : 'chainUnavailable');
    state.chainVersionReview = null; archiveReview = null;
    renderCreator({ focusVersion: true });
    try {
      const entries = await listDraftVersions({ draftId });
      if (!current()) return;
      state.versionEntries = Array.isArray(entries) ? entries : [];
      state.versionHistoryStatus = state.versionEntries.length ? 'ready' : 'empty';
      if (listMakerLineage) {
        const lineage = await listMakerLineage({ draftId });
        if (!current()) return;
        state.chainVersions = Array.isArray(lineage) ? lineage.map(row => ({ ...row,
          canManage: row.ownerAddress === state.connection.address && row.successorRootId === null,
        })) : [];
        state.chainVersionStatus = state.chainVersions.length ? '' : makerWorkspaceText(state.locale, 'chainEmpty');
      }
    } catch (error) {
      if (!current()) return;
      state.versionHistoryStatus = 'error';
      state.versionHistoryError = String(error?.message || 'Version history is unavailable.');
    }
    renderCreator({ focusVersion: true });
  }

  async function runChainVersionAction(action, control) {
    if (chainVersionFlight || control?.disabled || !state.versionHistoryOpen || !state.record
      || !state.connection.connected || state.route !== 'creator') return;
    const rootId = control?.dataset?.chainRoot;
    const row = state.chainVersions.find(value => value.rootId === rootId);
    if (!row?.canManage || !EXACT_OBJECT_ID.test(rootId || '')) return;
    const draftId = state.record.draftId, generation = state.creatorDraftGeneration;
    const connection = creatorConnectionGeneration, address = state.connection.address;
    const current = () => creatorDraftCurrent(generation, draftId) && state.versionHistoryOpen
      && creatorConnectionGeneration === connection && state.connection.address === address;
    const flight = {}; chainVersionFlight = flight;
    try {
      if (!await finishCreatorChanges() || !current()) return;
      const revision = state.record.revision;
      const stable = () => current() && state.record.revision === revision && !creatorHasPendingChanges();
      if (action === 'chain-archive-review') {
        if (!prepareLifecycleAction || !['ACTIVE', 'PAUSED'].includes(row.lifecycle)) return;
        archiveReview = null; state.chainVersionReview = null;
        state.chainVersionStatus = makerWorkspaceText(state.locale, 'chainPreparing');
        renderCreator();
        const prepared = await prepareLifecycleAction({ action: 'ARCHIVE', rootId, draftId, expectedRevision: revision });
        if (!stable()) return;
        if (prepared?.built?.action !== 'ARCHIVE' || prepared.built.descriptor?.sender !== address
          || !prepared.digest || !prepared.bytes) throw new TypeError('Archive review identity is invalid.');
        archiveReview = { prepared, rootId, draftId, revision, address, connection };
        state.chainVersionReview = { rootId, digest: prepared.digest };
        state.chainVersionStatus = makerWorkspaceText(state.locale, 'chainArchiveImpact');
      } else if (action === 'chain-archive-sign') {
        const review = archiveReview;
        if (!review || review.rootId !== rootId || review.draftId !== draftId || review.revision !== revision
          || review.address !== address || review.connection !== connection || !stable()
          || !state.bridgeState?.publication?.signingEnabled || !state.bridgeState?.publication?.broadcastEnabled) return;
        archiveReview = null; state.chainVersionReview = null;
        await requestLifecycleSignature(review.prepared);
        if (!current()) return;
        state.chainVersionStatus = makerWorkspaceText(state.locale, 'chainArchiveSaved');
      } else if (action === 'chain-archive-recover') {
        if (!recoverLifecycleAction) return;
        await recoverLifecycleAction({ action: 'ARCHIVE', rootId });
        if (!current()) return;
        await loadVersionHistory();
      } else {
        if (!createSuccessorDraft || row.lifecycle !== 'ARCHIVED') return;
        const bundle = await createSuccessorDraft({ draftId, expectedRevision: revision, previousRootId: rootId });
        if (!stable()) return;
        installCreatorRecord(exactDraftRecord(bundle.draft)); installDraftAssets(bundle.assets);
        state.undo = []; state.redo = []; state.saveState = 'saved'; state.versionHistoryOpen = false;
        state.chainVersions = []; archiveReview = null; state.chainVersionReview = null;
        invalidatePublicationReview();
        await requestCreatorPreview();
        state.status = makerWorkspaceText(state.locale, 'chainSuccessorReady');
      }
    } catch (error) {
      if (current()) { archiveReview = null; state.chainVersionReview = null;
        state.chainVersionStatus = String(error?.message || error); }
    } finally {
      if (chainVersionFlight === flight) chainVersionFlight = null;
      if (!state.destroyed) renderCreator();
    }
  }

  async function restoreVersion(revision) {
    if (!state.record || !restoreDraftVersion || !Number.isSafeInteger(revision)) return;
    state.versionHistoryRequest += 1;
    const generation = state.creatorDraftGeneration;
    const draftId = state.record.draftId;
    state.versionHistoryStatus = 'restoring';
    renderCreator();
    const run = async () => {
      if (!creatorDraftCurrent(generation, draftId)) return null;
      if (state.creatorPersistBlocked) {
        state.versionHistoryStatus = 'error';
        state.versionHistoryError = 'Save the current draft before restoring a version.';
        renderCreator({ focusVersion: true });
        return null;
      }
      try {
        const next = await restoreDraftVersion({
          draftId,
          expectedRevision: state.record.revision,
          revision,
        });
        if (!creatorDraftCurrent(generation, draftId)) return null;
        const restored = exactDraftRecord(next);
        const bundle = await getDraft({ draftId: restored.draftId });
        if (!creatorDraftCurrent(generation, draftId)) return null;
        installCreatorRecord(bundle?.draft || restored);
        installDraftAssets(bundle?.assets);
        state.undo = [];
        state.redo = [];
        state.saveState = 'saved';
        state.versionHistoryMessage = `Revision ${revision} restored.`;
        state.versionEntries = await listDraftVersions({ draftId });
        if (!creatorDraftCurrent(generation, draftId)) return null;
        state.versionHistoryStatus = 'ready';
        await requestCreatorPreview();
        renderCreator({ focusVersion: true });
        return state.record;
      } catch (error) {
        if (creatorDraftCurrent(generation, draftId)) {
          state.versionHistoryStatus = 'error';
          state.versionHistoryError = String(error?.message || 'Version restore failed.');
          renderCreator({ focusVersion: true });
        }
        return null;
      }
    };
    const queued = state.creatorPersistQueue.then(run);
    state.creatorPersistQueue = queued.catch(() => null);
    return queued;
  }

  function lifecycleActionMarkup(action, label) {
    if (action === 'archive' && listMakerLineage && prepareLifecycleAction && requestLifecycleSignature && recoverLifecycleAction) {
      return `<button class="maker-lifecycle-manager-action" type="button" data-lifecycle-action="chain-versions"><strong>${escapeHtml(label)}</strong><small>${escapeHtml(makerWorkspaceText(state.locale, 'chainArchiveImpact'))}</small></button>`;
    }
    const unavailable = t(
      'makerLifecycleDraftActionCopy',
      'This draft only exists in the current wallet workspace. Continue editing or delete its local record.',
    );
    return `<button class="maker-lifecycle-manager-action" type="button" data-lifecycle-action="${escapeHtml(action)}" disabled aria-disabled="true" title="${escapeHtml(unavailable)}"><strong>${escapeHtml(label)}</strong><small>${escapeHtml(unavailable)}</small></button>`;
  }

  function openLifecycleManager() {
    const modal = byId('makerLifecycleManagerModal');
    if (!modal) return;
    const document = state.record?.document;
    const published = publishedMaker(state.record);
    const controllerReady = Boolean(
      prepareLifecycleAction && requestLifecycleSignature && recoverLifecycleAction,
    );
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    creatorDeleteIntent = null;
    renderDraftDeleteConfirmation();
    const deleteButton = byId('deleteMakerDraft');
    if (deleteButton) {
      deleteButton.hidden = !deleteDraft || !state.record;
      deleteButton.disabled = Boolean(creatorDeleteFlight) || !state.connection.connected;
      deleteButton.textContent = (DRAFT_DELETE_COPY[state.locale] || DRAFT_DELETE_COPY.en).action;
    }
    if (byId('makerLifecycleManagerBadge')) byId('makerLifecycleManagerBadge').textContent = published
      ? publicationLabel(state.record) : 'Draft';
    if (byId('makerLifecycleManagerName')) byId('makerLifecycleManagerName').textContent = document?.metadata?.name || 'Maker';
    if (byId('makerLifecycleManagerScope')) byId('makerLifecycleManagerScope').textContent = 'Fresh-v8 working version';
    if (byId('lifecycleWorkingVersionCard')) {
      byId('lifecycleWorkingVersionCard').textContent = state.record
        ? `${state.record.draftId} · revision ${state.record.revision}` : 'No draft selected';
    }
    if (byId('lifecyclePublishedVersionCard')) {
      byId('lifecyclePublishedVersionCard').innerHTML = `<h3>${escapeHtml(t('makerLifecyclePublishedVersion', 'Published chain version'))}</h3><p style="overflow-wrap:anywhere">${published
        ? `${escapeHtml(published.rootId)} · ${escapeHtml(published.makerVersion)}`
        : escapeHtml(getPublishedMaker ? makerWorkspaceText(state.locale, 'publicationUnknown') : t('makerLifecycleNoPublishedVersion', 'No version has been published on Sui yet.'))}</p>`;
    }
    if (byId('makerLifecycleManagerActions')) {
      byId('makerLifecycleManagerActions').innerHTML = [
        lifecycleActionMarkup('pause', t('makerLifecycleActionPause', 'Pause new Soul authorizations')),
        lifecycleActionMarkup('resume', t('makerLifecycleActionResume', 'Resume new Soul authorizations')),
        lifecycleActionMarkup('archive', t('makerLifecycleActionArchive', 'Archive chain version')),
        lifecycleActionMarkup('withdraw', t('withdrawWallet', 'Withdraw to my wallet')),
      ].join('');
    }
    if (byId('makerLifecycleManagerStatus')) {
      byId('makerLifecycleManagerStatus').textContent = published
        ? publicationLabel(state.record) : getPublishedMaker
          ? makerWorkspaceText(state.locale, 'publicationUnknown') : controllerReady
        ? t('makerLifecycleNoPublishedVersion', 'No version has been published on Sui yet.')
        : t('makerLifecycleActionUnavailable', 'This action is unavailable until the current operation finishes.');
    }
    byId('makerLifecycleManagerDialog')?.focus?.({ preventScroll: true });
  }

  function closeLifecycleManager() {
    creatorDeleteIntent = null;
    renderDraftDeleteConfirmation();
    const modal = byId('makerLifecycleManagerModal');
    modal?.classList?.remove('active');
    modal?.setAttribute?.('aria-hidden', 'true');
    mount?.querySelector?.('[data-action="manage-lifecycle"]')?.focus?.({ preventScroll: true });
  }

  function renderDraftDeleteConfirmation() {
    const notice = byId('makerLifecycleManagerNotice');
    if (!notice) return;
    notice.hidden = !creatorDeleteIntent;
    const copy = DRAFT_DELETE_COPY[state.locale] || DRAFT_DELETE_COPY.en;
    notice.innerHTML = creatorDeleteIntent
      ? `<p>${escapeHtml(copy.warning.replace('{name}', creatorDeleteIntent.name))}</p><button type="button" class="secondary" data-lifecycle-action="cancel-delete-draft">${escapeHtml(copy.cancel)}</button><button type="button" class="danger-button" data-lifecycle-action="confirm-delete-draft">${escapeHtml(copy.confirm)}</button>` : '';
  }

  function requestDraftDeletion() {
    if (!deleteDraft || !state.record || creatorDeleteFlight || !state.connection.connected) return;
    const status = byId('makerLifecycleManagerStatus');
    const copy = DRAFT_DELETE_COPY[state.locale] || DRAFT_DELETE_COPY.en;
    if (state.creatorPersistPending || state.creatorPendingSave || state.projectImportPending || creatorAssetFlight) {
      if (status) status.textContent = copy.busy;
      return;
    }
    creatorDeleteIntent = Object.freeze({ draftId: state.record.draftId,
      expectedRevision: state.record.revision, generation: state.creatorDraftGeneration,
      wallet: state.connection.address, name: state.record.document.metadata.name });
    renderDraftDeleteConfirmation();
  }

  async function confirmDraftDeletion() {
    const intent = creatorDeleteIntent;
    if (!intent || !deleteDraft || creatorDeleteFlight) return;
    creatorDeleteIntent = null;
    renderDraftDeleteConfirmation();
    const status = byId('makerLifecycleManagerStatus');
    const copy = DRAFT_DELETE_COPY[state.locale] || DRAFT_DELETE_COPY.en;
    if (!creatorDraftCurrent(intent.generation, intent.draftId)
      || state.record.revision !== intent.expectedRevision
      || !state.connection.connected || state.connection.address !== intent.wallet
      || state.creatorPersistPending || state.creatorPendingSave || state.projectImportPending || creatorAssetFlight) {
      if (status) status.textContent = copy.stale;
      return;
    }
    creatorDeleteFlight = intent;
    const button = byId('deleteMakerDraft');
    if (button) button.disabled = true;
    if (status) status.textContent = copy.deleting;
    try {
      const deleted = await deleteDraft({ draftId: intent.draftId, expectedRevision: intent.expectedRevision });
      if (deleted !== true && deleted !== false) throw new TypeError('Draft deletion returned no persistence acknowledgement.');
      if (state.destroyed) return;
      deletedDraftReadEpochs.set(intent.draftId, (deletedDraftReadEpochs.get(intent.draftId) || 0) + 1);
      // A missing record is already deleted; never clear another selected draft.
      state.draftListRequest += 1;
      state.drafts = state.drafts.filter(row => row.draftId !== intent.draftId);
      state.draftsStatus = 'ready';
      state.draftsError = '';
      if (state.record?.draftId === intent.draftId) {
        beginCreatorDraftGeneration();
        state.record = null;
        state.undo = [];
        state.redo = [];
        installDraftAssets([]);
        closeLifecycleManager();
        showCreatorLibrary();
        renderCreator();
      } else renderCreatorLibrary();
    } catch (error) {
      if (creatorDraftCurrent(intent.generation, intent.draftId) && status) {
        status.textContent = String(error?.message || copy.stale);
      }
    } finally {
      creatorDeleteFlight = null;
      if (button) button.disabled = !state.connection.connected;
    }
  }

  async function movePart(partKey, direction) {
    return commitCreatorTrack('move-part', { partKey, direction });
  }

  async function commitCreatorTrack(action, input = {}) {
    if (!state.record || !state.connection.connected || creatorDeleteFlight || creatorAssetFlight
      || creatorRecoveryFlight || state.projectImportPending) return;
    const generation = state.creatorDraftGeneration, draftId = state.record.draftId;
    try {
      const prepared = prepareCreatorTrackChange({ document: state.creatorIntentDocument || state.record.document, action, ...input });
      if (!prepared.changed) { clearCreatorValidationError(); renderCreator(); return true; }
      if (Object.hasOwn(prepared, 'selectedTrackKey')) state.selectedTrackKey = prepared.selectedTrackKey || '';
      await persistReplacement(prepared.document);
      return true;
    } catch (error) {
      if (creatorDraftCurrent(generation, draftId)) {
        state.saveState = 'error'; state.saveLabel = String(error?.message || 'Layer Track could not be saved.');
        renderCreator();
      }
      return false;
    }
  }

  async function commitCreatorColor(action, control) {
    if (!state.record || !state.connection.connected || creatorDeleteFlight || creatorAssetFlight
      || creatorRecoveryFlight || state.projectImportPending) return;
    const generation = state.creatorDraftGeneration, draftId = state.record.draftId;
    const document = state.creatorIntentDocument || state.record.document;
    const selected = selectedRecords(document, state).style;
    const channelKey = String(control.dataset.channelId || (
      document.colors.some(row => row.key === state.selectedColorKey) ? state.selectedColorKey
        : selected?.colorChannelKey || document.colors[0]?.key || ''));
    try {
      const prepared = prepareCreatorColorChange({ document,
        action: action === 'style-channel' ? 'assign-style-color' : action,
        channelKey, swatchKey: String(control.dataset.swatchId || (action === 'channel-default-swatch' ? control.value : '')),
        ...(creatorStyleSelection() || {}), value: ['add-channel', 'add-swatch'].includes(action) ? undefined : String(control.value ?? ''),
        stopIndex: control.dataset.stopIndex === undefined ? undefined : Number(control.dataset.stopIndex),
      });
      if (!prepared.changed) { clearCreatorValidationError(); renderCreator(); return true; }
      if (Object.hasOwn(prepared, 'selectedColorKey')) state.selectedColorKey = prepared.selectedColorKey || '';
      await persistReplacement(prepared.document);
      return true;
    } catch (error) {
      if (creatorDraftCurrent(generation, draftId)) {
        state.saveState = 'error'; state.saveLabel = String(error?.message || 'Smart Color could not be saved.');
        renderCreator();
      }
      return false;
    }
  }

  function closeCreatorTool() {
    if (creatorUncommittedInput()) {
      const generation = state.creatorDraftGeneration, tab = state.creatorTab;
      void finishCreatorChanges().then(saved => {
        if (saved && generation === state.creatorDraftGeneration && tab === state.creatorTab) closeCreatorTool();
      });
      return;
    }
    state.creatorTab = 'structure';
    renderCreator();
    mount?.querySelector?.('[data-tab="structure"]')?.focus?.({ preventScroll: true });
  }

  function closeCreatorVersionHistory() {
    if (state.versionHistoryStatus === 'restoring') return;
    state.versionHistoryRequest += 1;
    state.versionHistoryOpen = false;
    renderCreator();
    const selector = state.creatorTab === 'structure'
      ? '[data-action="open-version-history"]'
      : '.v4-tool-modal-backdrop [data-action="close-tool"]';
    mount?.querySelector?.(selector)?.focus?.({ preventScroll: true });
  }

  async function exportCreatorProject() {
    if (!exportProjectZip || !state.record || state.projectExportPending) return;
    const generation = state.creatorDraftGeneration;
    const draftId = state.record.draftId;
    const current = () => creatorDraftCurrent(generation, draftId);
    state.projectExportPending = true;
    renderCreator();
    try {
      await state.creatorPersistQueue;
      if (!current()) return;
      if (state.creatorPersistBlocked || state.creatorPendingSave || state.creatorPersistPending > 0) {
        throw new TypeError('Save the current Creator changes before exporting Project ZIP.');
      }
      const revision = state.record.revision;
      const intent = state.creatorPersistIntent;
      const archive = await exportProjectZip({ makerId: draftId });
      if (!current() || state.record.revision !== revision) return;
      if (state.creatorPersistIntent !== intent || state.creatorPersistPending > 0 || state.creatorPendingSave || state.creatorPersistBlocked) {
        throw new TypeError('Creator changed during Project ZIP export. Save and export again.');
      }
      if (archive?.mediaType !== 'application/zip' || !Number.isSafeInteger(archive.byteLength)
        || archive.byteLength < 1 || archive.byteLength > MAKER_V8_PROJECT_ZIP_MAX_BYTES
        || typeof archive.bytesBase64 !== 'string' || archive.bytesBase64.length > Math.ceil(MAKER_V8_PROJECT_ZIP_MAX_BYTES / 3) * 4) {
        throw new TypeError('Project ZIP export is invalid.');
      }
      const bytes = decodeCanonicalBase64(archive.bytesBase64, 'Project ZIP');
      const bundle = decodeMakerV8ProjectZip(bytes);
      if (bytes.byteLength !== archive.byteLength || bundle?.draft?.draftId !== draftId || bundle.draft.revision !== revision) {
        throw new TypeError('Project ZIP does not match the current saved draft.');
      }
      const urls = browserObjectUrls();
      const BlobType = win.Blob || globalThis.Blob;
      const url = urls.createObjectURL(new BlobType([bytes], { type: 'application/zip' }));
      try { downloadAnchor(url, `${safeDownloadName(draftId, 'animacraft-project')}.animacraft.zip`); }
      finally {
        // Download navigation may consume the Blob after the click's microtasks.
        // Keep the one-shot archive alive for a bounded browser handoff window.
        const timer = (win.setTimeout || globalThis.setTimeout)(() => revokeObjectUrl(url), 60_000);
        timer?.unref?.();
      }
      state.previewStatus = '';
    } catch (error) {
      if (current()) state.previewStatus = String(error?.message || 'Project ZIP export failed.');
    } finally {
      state.projectExportPending = false;
      if (!state.destroyed) renderCreator();
    }
  }

  function creatorAssetSnapshot() {
    return { type: 'asset-snapshot', document: structuredClone(state.record.document),
      assets: structuredClone(state.draftAssets) };
  }

  async function addCreatorStructure(action) {
    if (!state.record || !state.connection.connected || creatorDeleteFlight) return;
    const generation = state.creatorDraftGeneration, draftId = state.record.draftId;
    const request = ++creatorStructureRequest;
    try {
      const prepared = prepareCreatorStructure({ document: state.creatorIntentDocument || state.record.document,
        action, partKey: state.selectedPartKey, itemKey: state.selectedItemKey });
      creatorPendingStructureSelection = { generation, draftId, request, selection: prepared.selection };
      const result = await persistReplacement(prepared.document);
      if (!result || !creatorDraftCurrent(generation, draftId) || request !== creatorStructureRequest) return;
      selectSavedCreatorStructure();
      renderCreator();
      await requestCreatorPreview();
    } catch (error) {
      if (creatorDraftCurrent(generation, draftId)) {
        state.previewStatus = String(error?.message || 'The new editor entry could not be saved.');
        renderCreator();
      }
    }
  }

  function selectSavedCreatorStructure() {
    const pending = creatorPendingStructureSelection;
    if (!pending) return;
    creatorPendingStructureSelection = null;
    if (pending.request !== creatorStructureRequest || !creatorDraftCurrent(pending.generation, pending.draftId)) return;
    state.selectedPartKey = pending.selection.partKey;
    state.selectedItemKey = pending.selection.itemKey;
    state.selectedStyleKey = pending.selection.styleKey;
    normalizeSelection(state.record.document, state);
  }

  async function mutateCreatorStructure(action, control) {
    if (!state.record || !state.connection.connected || creatorDeleteFlight || creatorAssetFlight
      || !replaceDraftSnapshot || state.projectImportPending) return;
    if (state.creatorPersistPending || state.creatorPendingSave || state.creatorPersistBlocked) {
      state.previewStatus = 'Save the current changes before copying or deleting an editor entry.';
      renderCreator();
      return;
    }
    const generation = state.creatorDraftGeneration, draftId = state.record.draftId;
    const previous = creatorAssetSnapshot();
    const selection = { partKey: state.selectedPartKey, itemKey: state.selectedItemKey, styleKey: state.selectedStyleKey };
    const partKey = String(control.dataset.partId || selection.partKey);
    const itemKey = String(control.dataset.itemId || selection.itemKey);
    const styleKey = String(control.dataset.styleId || selection.styleKey);
    try {
      const prepared = prepareCreatorStructure({ document: previous.document, action, partKey, itemKey,
        styleKey, selection, styleLockedKeys: creatorLockedStyleKeys() });
      if (action.startsWith('delete-')) {
        const part = previous.document.parts.find(row => row.key === partKey);
        const item = part?.items.find(row => row.key === itemKey);
        const style = item?.styles.find(row => row.key === styleKey);
        const kind = action.slice('delete-'.length);
        const row = kind === 'part' ? part : kind === 'item' ? item : style;
        const key = { part: 'deletePartConfirm', item: 'deleteItemConfirm', style: 'deleteStyleConfirm' }[kind];
        if (typeof win.confirm !== 'function') throw new TypeError('Browser deletion confirmation is unavailable.');
        if (!win.confirm(makerWorkspaceText(state.locale, key, { name: row.label }))) return;
      }
      const retained = new Set(prepared.document.assets.map(row => row.id));
      const next = await restoreCreatorAssetSnapshot({ document: prepared.document,
        assets: previous.assets.filter(row => retained.has(row.assetId)) }, { selection: prepared.selection });
      if (!next || !creatorDraftCurrent(generation, draftId)) return;
      state.undo.push(previous);
      state.redo = [];
      renderCreator();
    } catch (error) {
      if (creatorDraftCurrent(generation, draftId)) {
        state.previewStatus = String(error?.message || 'The editor entry could not be saved. Retry the action.');
        renderCreator();
      }
    }
  }

  function assetFlightCurrent(flight) {
    return creatorAssetFlight === flight && !flight.invalidated && creatorDraftCurrent(flight.generation, flight.draftId)
      && state.connection.connected && state.connection.address === flight.wallet;
  }

  function installCreatorAssetBundle(value, flight) {
    const next = exactDraftRecord(value?.draft);
    if (next.draftId !== flight.draftId || next.revision !== flight.expectedRevision + 1
      || !Array.isArray(value.assets)) throw new TypeError('Image save returned an invalid draft bundle.');
    installCreatorRecord(next);
    installDraftAssets(value.assets);
    state.saveState = 'saved'; state.saveLabel = ''; state.previewStatus = '';
    normalizeSelection(next.document, state);
    return next;
  }

  async function restoreCreatorAssetSnapshot(snapshot, { selection } = {}) {
    if (!replaceDraftSnapshot || creatorAssetFlight || creatorDeleteFlight || !state.connection.connected || state.projectImportPending
      || state.creatorPersistPending || state.creatorPendingSave || !state.record) return null;
    const flight = { generation: state.creatorDraftGeneration, draftId: state.record.draftId,
      expectedRevision: state.record.revision, wallet: state.connection.address };
    creatorAssetFlight = flight;
    state.saveState = 'saving'; renderCreator();
    try {
      const result = await replaceDraftSnapshot({ draftId: flight.draftId, expectedRevision: flight.expectedRevision,
        document: structuredClone(snapshot.document), assets: structuredClone(snapshot.assets) });
      if (!assetFlightCurrent(flight)) return null;
      const next = installCreatorAssetBundle(result, flight);
      if (selection) {
        state.selectedPartKey = selection.partKey;
        state.selectedItemKey = selection.itemKey;
        state.selectedStyleKey = selection.styleKey;
        normalizeSelection(next.document, state);
      }
      await requestCreatorPreview();
      // The bundle is already acknowledged. A later preview/wallet change
      // cannot turn that commit into a failed history operation; callers fence
      // their stacks by draft generation before recording Undo/Redo.
      return next;
    } catch (error) {
      if (assetFlightCurrent(flight)) { state.saveState = 'saved'; state.previewStatus = String(error?.message || 'Image history restore failed.'); }
      throw error;
    } finally {
      if (creatorAssetFlight === flight) creatorAssetFlight = null;
      if (!state.destroyed) renderCreator();
    }
  }

  async function decodeCreatorImage(bytes, expected) {
    const BlobType = win.Blob || globalThis.Blob;
    const blob = new BlobType([bytes], { type: expected.mediaType || 'image/png' });
    // JPEG EXIF orientation can rotate the decoded axes without changing the
    // source pixels. PNG dimensions remain exact; both JPEG orientations stay
    // within the already-checked side/pixel bounds.
    const matchingDimensions = (width, height) => (width === expected.width && height === expected.height)
      || (expected.mediaType === 'image/jpeg' && width === expected.height && height === expected.width);
    const bitmap = win.createImageBitmap || globalThis.createImageBitmap;
    if (bitmap) {
      const decoded = await bitmap(blob);
      try {
        if (!matchingDimensions(decoded.width, decoded.height)) throw new TypeError('Image dimensions do not match the decoded image.');
      } finally { decoded.close?.(); }
      return;
    }
    const ImageType = win.Image || globalThis.Image;
    const urls = browserObjectUrls();
    if (!ImageType || !urls) throw new TypeError('Browser image decoding is unavailable.');
    const url = urls.createObjectURL(blob);
    try {
      await new Promise((resolve, reject) => {
        const image = new ImageType();
        image.onload = () => matchingDimensions(image.naturalWidth, image.naturalHeight)
          ? resolve() : reject(new TypeError('Image dimensions do not match the decoded image.'));
        image.onerror = () => reject(new TypeError('The selected file is not a decodable image.'));
        image.src = url;
      });
    } finally { revokeObjectUrl(url); }
  }

  async function replaceCreatorImage(control, { cover = false, remove = false } = {}) {
    const file = remove ? null : control.files?.[0];
    control.value = '';
    if ((!file && !remove) || !dispatchDraftTransaction || !replaceDraftSnapshot || !state.record
      || creatorAssetFlight || creatorDeleteFlight || !state.connection.connected || state.projectImportPending) return;
    if (state.creatorPersistPending || state.creatorPendingSave) {
      state.previewStatus = 'Finish or retry the current save before replacing an image.';
      renderCreator(); return;
    }
    const flight = { generation: state.creatorDraftGeneration, draftId: state.record.draftId,
      expectedRevision: state.record.revision, wallet: state.connection.address,
      navigation: state.localNavigationRequest,
      partKey: state.selectedPartKey, itemKey: state.selectedItemKey, styleKey: state.selectedStyleKey };
    const previous = creatorAssetSnapshot();
    creatorAssetFlight = flight;
    if (cover) { state.makerCoverSaveState = 'processing'; state.makerCoverSaveMessage = ''; }
    state.saveState = 'saving'; state.previewStatus = ''; renderCreator();
    try {
      let bytes;
      if (!remove) {
        const mediaTypes = cover ? ['image/png', 'image/jpeg'] : ['image/png'];
        const limit = cover ? MAKER_V8_CREATOR_COVER_MAX_BYTES : 12 * 1024 * 1024;
        if (!Number.isSafeInteger(file.size) || file.size < (cover ? 4 : 33) || file.size > limit
          || (file.type && !mediaTypes.includes(file.type))) throw new TypeError(cover
          ? 'Choose a PNG or JPEG cover no larger than 5 MB.' : 'Choose a PNG image no larger than 12 MiB.');
        bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.length !== file.size) throw new TypeError('Image changed while reading.');
      }
      if (!assetFlightCurrent(flight)) return;
      const prepared = cover ? prepareCreatorCover({ document: previous.document, assets: previous.assets, bytes, remove })
        : prepareCreatorStylePng({ document: previous.document, assets: previous.assets,
        partKey: flight.partKey, itemKey: flight.itemKey, styleKey: flight.styleKey,
        styleLocked: creatorLockedStyleKeys().has(`${flight.partKey}/${flight.itemKey}/${flight.styleKey}`), bytes });
      if (cover && prepared.changed === false) { state.makerCoverSaveState = 'idle'; return; }
      if (!remove) {
        if (cover && file.type && file.type !== prepared.mediaType) throw new TypeError('Cover MIME type does not match the image bytes.');
        await decodeCreatorImage(bytes, prepared);
      }
      if (!assetFlightCurrent(flight) || state.record.revision !== flight.expectedRevision
        || state.route !== 'creator' || state.localNavigationRequest !== flight.navigation) return;
      const result = await dispatchDraftTransaction({ draftId: flight.draftId,
        expectedRevision: flight.expectedRevision, commands: prepared.commands,
        assetUpserts: prepared.assetUpserts, assetDeletes: prepared.assetDeletes || [] });
      if (!assetFlightCurrent(flight)) return;
      installCreatorAssetBundle(result, flight);
      state.undo.push(previous); state.redo = [];
      if (cover) state.makerCoverSaveState = 'saved';
      await requestCreatorPreview();
    } catch (error) {
      if (assetFlightCurrent(flight)) {
        state.previewStatus = String(error?.message || 'Image replacement failed. Choose the file again to retry.');
        if (cover) { state.makerCoverSaveState = 'error'; state.makerCoverSaveMessage = state.previewStatus; }
      }
    } finally {
      if (creatorAssetFlight === flight) {
        creatorAssetFlight = null;
        if (creatorDraftCurrent(flight.generation, flight.draftId)) {
          state.saveState = 'saved';
          if (cover && state.makerCoverSaveState === 'processing') state.makerCoverSaveState = 'idle';
        }
      }
      if (!state.destroyed) renderCreator();
    }
  }

  async function importCreatorProject(control) {
    const file = control.files?.[0];
    control.value = '';
    if (!file || !replaceDraftFromProjectZip || !state.record || state.projectImportPending) return;
    const generation = state.creatorDraftGeneration;
    const draftId = state.record.draftId;
    const connectionGeneration = creatorConnectionGeneration;
    const navigation = state.localNavigationRequest;
    // Returning to the same wallet/page must not revive a previously abandoned
    // file read. Once the atomic commit starts, its acknowledged result below
    // still updates the same draft even when the user navigates away.
    const current = () => creatorDraftCurrent(generation, draftId)
      && connectionGeneration === creatorConnectionGeneration && navigation === state.localNavigationRequest
      && state.connection.connected && state.route === 'creator' && creatorEditorVisible();
    state.projectImportPending = true;
    renderCreator();
    try {
      await state.creatorPersistQueue;
      if (!current()) return;
      if (state.creatorPersistBlocked || state.creatorPendingSave || state.creatorPersistPending > 0) {
        throw new TypeError('Save the current Creator changes before importing Project ZIP.');
      }
      if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAKER_V8_PROJECT_ZIP_MAX_BYTES || typeof file.arrayBuffer !== 'function') {
        throw new TypeError('Project ZIP must be a nonempty file no larger than 64 MiB.');
      }
      const expectedRevision = state.record.revision;
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!current()) return;
      if (state.record.revision !== expectedRevision || state.creatorPersistPending > 0 || state.creatorPendingSave || state.creatorPersistBlocked) {
        throw new TypeError('Creator changed while reading Project ZIP. Retry import after saving.');
      }
      if (bytes.byteLength !== file.size) throw new TypeError('Project ZIP file changed while reading.');
      decodeMakerV8ProjectZip(bytes);
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
      const encode = win.btoa || globalThis.btoa;
      const result = await replaceDraftFromProjectZip({ draftId, expectedRevision, bytesBase64: encode(binary) });
      if (!creatorDraftCurrent(generation, draftId)) return;
      const next = exactDraftRecord(result?.draft);
      if (next.draftId !== draftId || next.revision !== expectedRevision + 1) throw new TypeError('Imported draft identity or revision is invalid.');
      if (!Array.isArray(result.assets)) throw new TypeError('Imported draft assets are unavailable.');
      // The atomic transaction result is the acknowledged revision even if the
      // user navigated away during commit. Do not depend on a second disk read.
      beginCreatorDraftGeneration();
      installCreatorRecord(next);
      installDraftAssets(result.assets);
      state.drafts = [next, ...state.drafts.filter(row => row.draftId !== draftId)];
      state.undo = []; state.redo = [];
      state.hiddenPartKeys.clear();
      state.selectedPartKey = ''; state.selectedItemKey = ''; state.selectedStyleKey = '';
      state.creatorTab = 'structure'; state.versionHistoryOpen = false;
      state.saveState = 'saved'; state.previewStatus = '';
      state.creatorRenderRecord = null; state.creatorRenderIdentity = '';
      normalizeSelection(next.document, state);
      renderCreatorLibrary();
      if (creatorEditorVisible()) {
        renderCreator();
        await requestCreatorPreview();
      }
    } catch (error) {
      if (current()) state.previewStatus = String(error?.message || 'Project ZIP import failed.');
    } finally {
      state.projectImportPending = false;
      if (!state.destroyed) renderCreator();
    }
  }

  function creatorRuleEditor() {
    if (!state.ruleEditor) state.ruleEditor = {
      intent: 'availability', ownerQuery: '', targetQuery: '', error: '',
      builder: { ownerDefinition: [state.selectedPartKey, state.selectedItemKey, state.selectedStyleKey].filter(Boolean).join('::'), type: 'excludes', matchMode: 'all', definitions: [] },
    };
    return state.ruleEditor;
  }

  function creatorRuleEventCurrent() {
    return state.record && !state.destroyed
      && state.creatorRecordGeneration === state.creatorDraftGeneration;
  }

  function creatorVisibilitySubject() {
    const { part, item, style } = selectedRecords(state.creatorIntentDocument || state.record.document, state);
    const partKey = part?.key, itemKey = item?.key, styleKey = style?.key;
    return [partKey || '', itemKey || '', styleKey || ''].join('/');
  }

  function creatorVisibilityEventCurrent(control) {
    return creatorRuleEventCurrent() && state.connection.connected
      && Number(control?.dataset?.creatorGeneration) === state.creatorDraftGeneration
      && control.dataset.visibilityDraft === state.record.draftId
      && control.dataset.visibilitySubject === creatorVisibilitySubject();
  }

  function creatorVisibilityEditor() {
    const editor = creatorRuleEditor();
    const document = state.creatorIntentDocument || state.record.document;
    const { style } = selectedRecords(document, state);
    const subject = creatorVisibilitySubject();
    const snapshot = JSON.stringify(style?.visibleWhen ?? null);
    if (editor.visibilitySubject !== subject || editor.visibilitySnapshot !== snapshot) {
      editor.visibilitySubject = subject;
      editor.visibilitySnapshot = snapshot;
      editor.visibility = makerV8VisibilityEditorModel(style?.visibleWhen, { parts: document.parts });
      editor.visibilityQuery = ''; editor.visibilityError = '';
    }
    return editor;
  }

  async function commitCreatorVisibility(action, control) {
    if (!creatorVisibilityEventCurrent(control)) return;
    const editor = creatorVisibilityEditor();
    const selection = { ...creatorStyleSelection() };
    const builder = structuredClone(editor.visibility);
    const generation = state.creatorDraftGeneration, connection = creatorConnectionGeneration;
    const subject = editor.visibilitySubject;
    const current = () => creatorVisibilityEventCurrent(control) && generation === state.creatorDraftGeneration
      && connection === creatorConnectionGeneration && state.ruleEditor === editor && editor.visibilitySubject === subject;
    try {
      await persistReplacement(document => {
        const style = document.parts.find(row => row.key === selection.partKey)?.items.find(row => row.key === selection.itemKey)
          ?.styles.find(row => row.key === selection.styleKey);
        if (!style) throw new TypeError('The selected Maker Style no longer exists.');
        if (creatorLockedStyleKeys(document).has(subject)) throw new TypeError('Unlock the whole Style before editing its visibility.');
        style.visibleWhen = action === 'clear-style-visibility' ? null
          : makerV8VisibilityFromBuilder({ document, ...selection, ...builder });
        return document;
      });
      if (current()) editor.visibilityError = '';
    } catch (error) {
      if (current()) editor.visibilityError = String(error?.message || 'Visibility save failed.');
    }
    if (current()) renderCreator();
  }

  function assertCreatorRuleOwnerUnlocked(document, rule) {
    const owner = rule?.trigger;
    if (!owner?.styleKey || !['BASE', 'ANY'].includes(owner.source)) return;
    if (creatorLockedStyleKeys(document).has(`${owner.partKey}/${owner.itemKey}/${owner.styleKey}`)) {
      throw new TypeError('Unlock the whole Style before editing its rules.');
    }
  }

  function filterCreatorRuleSearch() {
    // Keep the original search inputs alive while typing; never change the
    // selected definition or discard checked targets just because they don't match.
    const query = value => String(value || '').trim().toLocaleLowerCase();
    const editor = state.ruleEditor;
    const ownerQuery = query(editor?.ownerQuery);
    const select = mount.querySelector?.('#v4RuleOwnerDefinition');
    let ownerCount = 0;
    for (const option of select?.querySelectorAll?.('[data-rule-owner-option]') || []) {
      const matches = !ownerQuery || query(option.dataset.ruleOwnerOption || option.textContent).includes(ownerQuery) || option.selected;
      option.hidden = !matches;
      option.disabled = option.dataset.ruleOwnerLocked === 'true' || !matches;
      if (matches) ownerCount += 1;
    }
    for (const group of select?.querySelectorAll?.('optgroup') || []) {
      group.hidden = ![...group.querySelectorAll('option')].some(option => !option.hidden);
    }
    const ownerLabel = mount.querySelector?.('[data-rule-owner-search-count]');
    if (ownerLabel) ownerLabel.textContent = makerWorkspaceText(state.locale, 'ruleSearchResultCount', { count: ownerCount });
    for (const [kind, search] of [['availability', editor?.targetQuery], ['visibility', editor?.visibilityQuery]]) {
      const tree = mount.querySelector?.(`[data-rule-target-tree="${kind}"]`);
      if (!tree) continue;
      const targetQuery = query(search); let count = 0;
      for (const group of tree.querySelectorAll('[data-rule-target-group]')) {
        let groupCount = 0;
        for (const row of group.querySelectorAll('[data-rule-search-record]')) {
          const matches = !targetQuery || query(row.dataset.ruleSearchRecord || row.textContent).includes(targetQuery) || row.querySelector?.('input')?.checked;
          row.hidden = !matches;
          if (matches) { groupCount += 1; count += 1; }
        }
        group.hidden = Boolean(targetQuery && !groupCount);
        if (targetQuery && groupCount) group.open = true;
      }
      const empty = tree.querySelector('[data-rule-search-empty]');
      if (empty) empty.hidden = count > 0;
      const label = tree.parentElement?.querySelector?.('[data-rule-search-count]');
      if (label) label.textContent = makerWorkspaceText(state.locale, 'ruleSearchResultCount', { count });
    }
  }

  async function setCreatorDefault(action, value = '') {
    if (!state.record || !state.connection.connected || creatorDeleteFlight) return;
    const generation = state.creatorDraftGeneration, draftId = state.record.draftId;
    const current = state.creatorIntentDocument || state.record.document;
    const { part, item, style } = selectedRecords(current, state);
    if (!part || (action === 'set-default-style' && !style)) return;
    if (action === 'set-default-style' && item.defaultStyleKey === style.key) { clearCreatorValidationError(); return; }
    if (action === 'part-default') {
      const first = current.defaultRecipe.selections.find(row => row.partKey === part.key);
      if ((!value && !first) || (first?.itemKey === value
        && first.styleKey === part.items.find(row => row.key === value)?.defaultStyleKey)) { clearCreatorValidationError(); return; }
    }
    try {
      await persistReplacement(document => {
        const targetPart = document.parts.find(row => row.key === part.key);
        if (action === 'part-default') {
          const rows = document.defaultRecipe.selections;
          const index = rows.findIndex(row => row.partKey === part.key);
          if (!value) {
            if (targetPart.required && targetPart.items.some(row => row.status === 'PUBLIC' && row.styles.length)) {
              throw new TypeError('A required Part needs a default Item. Clear Required before choosing None.');
            }
            document.defaultRecipe.selections = rows.filter(row => row.partKey !== part.key);
          } else {
            const targetItem = targetPart.items.find(row => row.key === value);
            if (!targetItem || targetItem.status !== 'PUBLIC' || !targetItem.defaultStyleKey) {
              throw new TypeError('Choose a public Item with a default Style.');
            }
            // The original single-item control edits the primary slot only.
            // Remaining capacity slots, recipe colors and other Parts stay intact.
            const selection = { partKey: part.key, itemKey: value, styleKey: targetItem.defaultStyleKey };
            if (index < 0) rows.push(selection);
            else rows[index] = { ...rows[index], ...selection };
          }
        } else {
          if (creatorLockedStyleKeys(document).has(`${part.key}/${item.key}/${style.key}`)) {
            throw new TypeError('Unlock the Style before changing its default.');
          }
          const targetItem = targetPart.items.find(row => row.key === item.key);
          targetItem.defaultStyleKey = style.key;
          for (const row of document.defaultRecipe.selections) {
            if (row.partKey === part.key && row.itemKey === item.key) row.styleKey = style.key;
          }
        }
        return document;
      });
    } catch (error) {
      if (creatorDraftCurrent(generation, draftId)) {
        state.saveState = 'error';
        state.saveLabel = String(error?.message || 'The default could not be saved.');
        renderCreator();
      }
    }
  }

  function currentPackEditor(editor) {
    return !state.destroyed && state.packEditor === editor && creatorDraftCurrent(editor.generation, editor.parentId)
      && creatorConnectionGeneration === editor.connection && state.connection.address === editor.address;
  }

  function renderPackEditor() {
    const editor = state.packEditor, row = editor.draft;
    const tr = key => makerWorkspaceText(state.locale, key);
    const parent = (row.document.authoringParent ?? row.document.bindings.parent).draft.document;
    const authored = packAuthoringDocument(row.document);
    const disabled = packSaveFlight || packAssetFlight ? ' disabled' : '';
    const economics = { ...packEconomicFields(row.document), ...editor.economics };
    const economicControl = (key, label, options) => `<label>${escapeHtml(label)}${options
      ? `<select data-action="pack-economics" data-field="${key}" aria-label="${escapeHtml(label)}"${disabled}>${options.map(([value, text]) => `<option value="${value}"${economics[key] === value ? ' selected' : ''}>${escapeHtml(text)}</option>`).join('')}</select>`
      : `<input type="text" inputmode="numeric" data-action="pack-economics" data-field="${key}" aria-label="${escapeHtml(label)}" value="${escapeHtml(economics[key])}"${disabled}>`}</label>`;
    const economicsHtml = `<h3>Pack access &amp; completion</h3><p>Entry grants access to this Pack; completion fees and limits are separate. Prices use atomic payment-token units.</p>
      ${economicControl('accessKind', 'Pack access', [['FREE','Free'],['PAID','Paid'],['INCLUDED_WITH_MAKER','Included with Maker access']])}
      ${economicControl('accessPriceAtomic', 'Entry price (atomic units)')}
      ${economicControl('completeMode', 'Pack completion', [['UNLIMITED_FREE','Free each time'],['FREE_QUOTA_THEN_PAID','Free quota, then paid'],['PAID_EVERY_TIME','Paid each time'],['FREE_QUOTA_THEN_BLOCK','Free quota, then blocked']])}
      ${economicControl('completePriceAtomic', 'Completion price (atomic units)')}
      ${economicControl('freeQuotaPerWallet', 'Free completions per wallet')}
      ${economicControl('totalCap', 'Total completion cap (0 = unlimited)')}
      <p>Free/included entry requires price 0. Free completion requires price 0; paid completion requires a positive price. Quota modes require a positive quota; other modes require 0. A nonzero total cap must cover the quota.</p>`;
    const boundRoot = row.document.bindings.root?.objectRef.objectId;
    const parentBindingHtml = boundRoot
      ? `<p>Published parent bound · v${escapeHtml(row.document.bindings.root.makerVersion)}</p><code>${escapeHtml(boundRoot)}</code><p>Pack publication is not enabled yet.</p>`
      : `<p>${escapeHtml(tr('packLocalParentBinding'))}</p><code>${escapeHtml(editor.parentId)}</code><label>Published Maker Root<input type="text" data-action="pack-parent-root" aria-label="Published Maker Root" placeholder="0x…" value="${escapeHtml(editor.parentRootInput || '')}"${disabled}></label><button type="button" data-action="bind-pack-parent"${disabled || (!bindPackParent ? ' disabled' : '')}>Verify and bind parent</button><p>Save edits first. Binding checks the exact published artwork and settings. It does not publish the Pack or sign a transaction.</p>`;
    const selectedPart = authored.parts.find(part => part.key === editor.partKey) || authored.parts[0];
    const selectedItem = selectedPart?.items.find(item => item.key === editor.itemKey) || selectedPart?.items[0];
    const packPartMoveAllowed = (partKey, direction) => {
      try {
        const prepared = preparePackStructure(row.document, { action: 'move-part', partKey, direction });
        return prepared.document.authoring.parts.some((part, index) => part.key !== authored.parts[index].key);
      } catch { return false; }
    };
    const partList = createMakerPartListModel(authored.parts.map(part => ({
      id: part.key, name: part.label, itemCount: part.items.length, required: part.required,
      readonly: parent.parts.some(inherited => inherited.key === part.key),
      draggable: !disabled && !editor.dirty,
      disabled: Boolean(packSaveFlight || packAssetFlight), capabilities: { select: true, preview: false,
        moveUp: packPartMoveAllowed(part.key, 'up'), moveDown: packPartMoveAllowed(part.key, 'down'), duplicate: false, delete: false },
      actions: { select: 'select-pack-part', preview: '', slot: '', move: 'pack-move-part', duplicate: '', delete: '' },
    })), { selectedId: selectedPart?.key });
    const inheritedItem = parent.parts.find(part => part.key === selectedPart?.key)?.items.find(item => item.key === selectedItem?.key);
    const tracks = `<h3>${escapeHtml(tr('layerTrack'))}</h3><button type="button" data-action="pack-add-track"${disabled}>Add Layer Track</button>${authored.tracks.map(track => {
      if (parent.tracks.some(row => row.key === track.key)) return `<p>${escapeHtml(track.label)} — read-only</p>`;
      const trackState = creatorTrackState(authored, track.key);
      const edit = { kind: 'track', field: 'track-name', trackKey: track.key };
      const pending = editor.edits?.[JSON.stringify(edit)];
      const action = (field, label, direction, blocked = false) => `<button type="button" data-action="pack-track-action" data-pack-edit="${escapeHtml(JSON.stringify({ kind: 'track', field, trackKey: track.key, ...(direction ? { direction } : {}) }))}"${disabled || (blocked ? ' disabled' : '')}>${escapeHtml(label)}</button>`;
      const canMove = direction => {
        try { preparePackEdits(row.document, [{ kind: 'track', field: 'move-track', trackKey: track.key, direction }]); return true; }
        catch { return false; }
      };
      return `<section><input aria-label="Track name: ${escapeHtml(track.key)}" data-action="pack-property" data-pack-edit="${escapeHtml(JSON.stringify(edit))}" value="${escapeHtml(pending ? pending.value : track.label)}"${disabled || (!trackState.canRename ? ' disabled' : '')}>
        ${action('toggle-track-lock', `${track.locked ? 'Unlock' : 'Lock'} track: ${track.label}`)}
        ${action('move-track', `Move back: ${track.label}`, 'up', !trackState.canMoveBack || !canMove('up'))}
        ${action('move-track', `Move front: ${track.label}`, 'down', !trackState.canMoveFront || !canMove('down'))}</section>`;
    }).join('')}`;
    const ownedStyles = selectedItem?.styles.filter(style => !inheritedItem?.styles.some(inherited => inherited.key === style.key)) || [];
    const ruleControl = (definition, ownerType) => renderDefinitionCombinationRuleControl({ definition, ownerType,
      count: authored.rules.filter(rule => [rule.trigger.partKey, rule.trigger.itemKey, rule.trigger.styleKey].filter(Boolean).join('::') === definition).length,
      action: 'pack-edit-rules', actionLabel: 'Add Rule', disabled: Boolean(disabled) });
    const propertyInput = (kind, field, value, label, styleKey = '', type = 'text') => {
      const edit = { kind, field, partKey: selectedPart.key, itemKey: kind === 'part' ? '' : selectedItem.key, styleKey };
      const pending = editor.edits?.[JSON.stringify(edit)];
      if (field === 'assign-style-track' || field === 'assign-style-color') {
        const options = field === 'assign-style-track' ? authored.tracks : [{ key: '', label: tr('noSmartColor') }, ...authored.colors];
        return `<label>${escapeHtml(label)}<select data-action="pack-property" data-pack-edit="${escapeHtml(JSON.stringify(edit))}" aria-label="${escapeHtml(label)}"${disabled}>${options.map(row => `<option value="${escapeHtml(row.key)}"${row.key === (pending ? pending.value : value || '') ? ' selected' : ''}>${escapeHtml(row.label)}</option>`).join('')}</select></label>`;
      }
      if (field === 'style-blend') return `<label>${escapeHtml(label)}<select data-action="pack-property" data-pack-edit="${escapeHtml(JSON.stringify(edit))}" aria-label="${escapeHtml(label)}"${disabled}>${MAKER_V8_BLEND_MODES.map(mode => `<option value="${mode}"${mode === (pending ? pending.value : value) ? ' selected' : ''}>${escapeHtml(mode)}</option>`).join('')}</select></label>`;
      return `<label>${escapeHtml(label)}<input type="${type}"${type === 'number' ? ' step="any"' : ''} data-action="pack-property" data-pack-edit="${escapeHtml(JSON.stringify(edit))}" aria-label="${escapeHtml(label)}" value="${escapeHtml(pending ? pending.value : value)}"${disabled}></label>`;
    };
    const names = selectedItem ? `${parent.parts.some(part => part.key === selectedPart.key) ? '' : propertyInput('part', 'label', selectedPart.label, 'Part name')}
      ${parent.parts.some(part => part.key === selectedPart.key) ? '' : ruleControl(selectedPart.key, 'part')}
      ${inheritedItem ? '' : propertyInput('item', 'label', selectedItem.label, 'Item name') + ruleControl(`${selectedPart.key}::${selectedItem.key}`, 'item')}` : '';
    const colorInput = (edit, value, label, type = 'text') => {
      const key = JSON.stringify({ kind: 'color', ...edit });
      const pending = editor.edits?.[key];
      const shown = pending ? pending.value : value;
      return `<label>${escapeHtml(label)}<input type="${type}" data-action="pack-property" data-pack-edit="${escapeHtml(key)}" aria-label="${escapeHtml(label)}" value="${escapeHtml(type === 'color' ? shown.slice(0, 7) : shown)}"${disabled}></label>`;
    };
    const colors = authored.colors.filter(channel => !parent.colors.some(row => row.key === channel.key)).map(channel => {
      const edit = { kind: 'color', field: 'channel-default-swatch', channelKey: channel.key };
      const key = JSON.stringify(edit), pending = editor.edits?.[key];
      return `<section class="v4-color-detail"><h3>${escapeHtml(tr('smartColor'))} · ${escapeHtml(channel.label)}</h3>
        ${colorInput({ field: 'channel-name', channelKey: channel.key }, channel.label, `Channel name: ${channel.key}`)}
        <label>${escapeHtml(tr('defaultColor'))}<select data-action="pack-property" data-pack-edit="${escapeHtml(key)}" aria-label="Default preset: ${escapeHtml(channel.key)}"${disabled}>${channel.swatches.map(swatch => `<option value="${escapeHtml(swatch.key)}"${swatch.key === (pending ? pending.value : channel.defaultSwatchKey) ? ' selected' : ''}>${escapeHtml(swatch.label)}</option>`).join('')}</select></label>
        <div class="v4-swatch-list">${channel.swatches.map(swatch => `<div class="v4-swatch-editor">
          ${colorInput({ field: 'swatch-name', channelKey: channel.key, swatchKey: swatch.key }, swatch.label, `Preset name: ${channel.key}/${swatch.key}`)}
          ${colorInput({ field: 'swatch-hint', channelKey: channel.key, swatchKey: swatch.key }, swatch.rgba, `${tr('primaryColor')}: ${channel.key}/${swatch.key}`, 'color')}
          <details class="v4-swatch-gradient"><summary>${escapeHtml(tr('advancedGradient'))}</summary><div>${swatch.stops.map((stop, index) => colorInput({ field: 'swatch-stop', channelKey: channel.key, swatchKey: swatch.key, stopIndex: index }, stop.rgba, `Gradient ${index}: ${channel.key}/${swatch.key}`, 'color')).join('')}</div></details>
        </div>`).join('')}</div><button type="button" data-action="pack-add-swatch" data-pack-edit="${escapeHtml(JSON.stringify({ kind: 'color', field: 'add-swatch', channelKey: channel.key }))}"${disabled}>${escapeHtml(tr('colorPreset'))}</button></section>`;
    }).join('');
    const visibility = editor.visibilityEditor;
    const ruleEditor = editor.combinationEditor;
    const ruleHtml = ruleEditor ? `<section class="v4-rule-editor"><h3>${escapeHtml(tr('rules'))} · ${escapeHtml(ruleEditor.builder.ownerDefinition)}</h3>
      <select data-action="pack-rule-type" aria-label="Rule type"${disabled}><option value="requires"${ruleEditor.builder.type === 'requires' ? ' selected' : ''}>Require</option><option value="excludes"${ruleEditor.builder.type === 'excludes' ? ' selected' : ''}>Exclude</option></select>
      <select data-action="pack-rule-match" aria-label="Rule match"${disabled || (ruleEditor.builder.type === 'excludes' ? ' disabled' : '')}><option value="all"${ruleEditor.builder.matchMode === 'all' ? ' selected' : ''}>All</option><option value="any"${ruleEditor.builder.matchMode === 'any' ? ' selected' : ''}>Any</option></select>
      ${renderSharedRuleTargetTree({ kind: 'availability', groups: authored.parts.filter(part => part.key !== ruleEditor.builder.ownerDefinition.split('::')[0]).map(part => ({ label: part.label, open: true,
        records: [{ label: part.label, kind: 'part', value: part.key }, ...part.items.flatMap(item => [{ label: item.label, kind: 'item', value: `${part.key}::${item.key}` }, ...item.styles.map(style => ({ label: style.label, kind: 'style', value: `${part.key}::${item.key}::${style.key}` }))])]
          .map(row => ({ ...row, action: 'pack-rule-target', checked: ruleEditor.builder.definitions.includes(row.value), disabled: Boolean(disabled) })),
      })) })}<button type="button" data-action="pack-rule-save"${disabled}>${escapeHtml(tr('save'))}</button><button type="button" data-action="pack-rule-cancel"${disabled}>${escapeHtml(tr('cancel'))}</button></section>` : '';
    const ruleList = authored.rules.slice(parent.rules.length).map(rule => {
      const removing = Boolean(editor.ruleRemovalUndo?.[rule.key]);
      return `<div class="v4-rule-summary-row"><strong>${escapeHtml(rule.kind)} · ${escapeHtml([rule.trigger.partKey,rule.trigger.itemKey,rule.trigger.styleKey].filter(Boolean).join(' / '))}</strong>
        ${removing ? `<span role="status">Pending removal — not saved</span><button type="button" data-action="pack-undo-remove-rule" data-rule-key="${escapeHtml(rule.key)}"${disabled}>Undo removal</button>`
          : `<button type="button" data-action="pack-open-rule" data-rule-key="${escapeHtml(rule.key)}"${disabled}>${escapeHtml(tr('editCombinationRules'))}</button><button type="button" data-action="pack-remove-rule" data-rule-key="${escapeHtml(rule.key)}"${disabled}>Remove rule</button>`}</div>`;
    }).join('') + (Object.keys(editor.ruleRemovalUndo || {}).length ? `<p>Confirm permanently removing the marked rules from this Pack. Undo is available before confirmation.</p><button type="button" data-action="pack-confirm-rule-removal"${disabled}>Confirm pending rule removals</button>` : '');
    const visibilityHtml = visibility ? `<section class="v4-rule-editor"><h3>${escapeHtml(tr('showThisStyle'))} · ${escapeHtml(visibility.styleKey)}</h3>
      ${visibility.advanced ? '<p>This existing complex condition is preserved; editing it requires the advanced editor.</p>' : `<label>${escapeHtml(tr('rules'))}<select data-action="pack-visibility-logic" aria-label="Visibility match"${disabled}><option value="all"${visibility.logic === 'all' ? ' selected' : ''}>All</option><option value="any"${visibility.logic === 'any' ? ' selected' : ''}>Any</option></select></label><select data-action="pack-visibility-polarity" aria-label="Visibility condition"${disabled}><option value="selected"${visibility.polarity === 'selected' ? ' selected' : ''}>Selected</option><option value="not-selected"${visibility.polarity === 'not-selected' ? ' selected' : ''}>Not selected</option></select>
      ${renderSharedRuleTargetTree({ kind: 'visibility', groups: authored.parts.map(part => ({ label: part.label, open: true,
        records: [{ kind: 'part', label: part.label, value: part.key, disabled: part.required, disabledReason: part.required ? 'A required whole Part is always selected. Choose an Item or Style.' : '' }, ...part.items.flatMap(item => [
          { kind: 'item', label: item.label, value: `${part.key}::${item.key}` },
          ...item.styles.map(style => ({ kind: 'style', label: style.label, value: `${part.key}::${item.key}::${style.key}` })),
        ])].map(record => ({ ...record, action: 'pack-visibility-target', checked: visibility.definitions.includes(record.value), disabled: record.disabled || Boolean(disabled) })),
      })) })}<button type="button" data-action="pack-visibility-apply"${disabled}>${escapeHtml(tr('save'))}</button><button type="button" data-action="pack-visibility-clear"${disabled}>${escapeHtml(tr('alwaysVisible'))}</button>`}</section>` : '';
    const artwork = selectedItem ? `<h3>${escapeHtml(tr('partsItems'))}</h3>
      <div class="v4-item-tabs">${selectedPart.items.map(item => `<button type="button" data-action="select-pack-item" data-item-key="${escapeHtml(item.key)}" aria-pressed="${item.key === selectedItem.key}"${disabled}>${escapeHtml(item.label)}</button>`).join('')}</div>
      <button type="button" data-action="pack-add-item"${disabled}>${escapeHtml(tr('addItem'))}</button><button type="button" data-action="pack-add-style"${disabled}>${escapeHtml(tr('addStyle'))}</button>
      <button type="button" data-action="pack-add-channel"${disabled}>${escapeHtml(tr('addChannel'))}</button>
      <p>${escapeHtml(tr(inheritedItem ? 'packParentItem' : 'packOverlay'))}: ${escapeHtml(selectedItem.label)}</p>
      ${names}
      <label class="v4-file-button wide">＋ ${escapeHtml(tr('uploadStylePng'))}<input type="file" accept="image/png,.png" data-action="pack-style-png"${disabled || (!upsertPackAsset ? ' disabled' : '')}></label>
      ${ownedStyles.map(style => `<div class="v4-style-card"><strong>${escapeHtml(style.label)}</strong><p>${escapeHtml(style.trackKey || '')}</p>
        <button type="button" data-action="pack-copy-style" data-style-key="${escapeHtml(style.key)}"${disabled}>Copy Style: ${escapeHtml(style.label)}</button>
        <button type="button" data-action="pack-preview-style" data-style-key="${escapeHtml(style.key)}"${disabled}>${escapeHtml(t('preview', 'Preview'))}: ${escapeHtml(style.label)}</button>
        <button type="button" data-action="pack-edit-visibility" data-style-key="${escapeHtml(style.key)}"${disabled}>${escapeHtml(tr('showThisStyle'))}: ${escapeHtml(style.label)}</button>
        ${ruleControl(`${selectedPart.key}::${selectedItem.key}::${style.key}`, 'style')}
        ${propertyInput('style', 'label', style.label, `Style name: ${style.key}`, style.key)}
        <div class="v4-number-grid">${[['x','X'], ['y','Y'], ['scale',tr('scale')], ['rotation',tr('rotate')]].map(([field,label]) => propertyInput('style', `style-${field}`, style.transform[field], `${label}: ${style.key}`, style.key, 'number')).join('')}
        ${propertyInput('style', 'style-opacity', style.opacity * 100, `${tr('opacity')} (%): ${style.key}`, style.key, 'number')}</div>
        ${propertyInput('style', 'style-blend', style.blendMode, `${tr('blendMode')}: ${style.key}`, style.key)}
        ${propertyInput('style', 'assign-style-track', style.trackKey, `${tr('layerTrack')}: ${style.key}`, style.key)}
        ${propertyInput('style', 'assign-style-color', style.colorChannelKey, `${tr('smartColor')}: ${style.key}`, style.key)}
        <label class="v4-file-button wide">${escapeHtml(tr(style.assetId ? 'replaceStylePng' : 'uploadStylePng'))}<input type="file" accept="image/png,.png" data-action="pack-style-png" data-style-key="${escapeHtml(style.key)}"${disabled}></label></div>`).join('')}` : '';
    mount.innerHTML = renderMakerEditorShell({
      instanceId: 'expansion-pack', idPrefix: 'expansionPack', workspaceId: 'expansionPackToolPanel',
      className: 'expansion-pack-workspace',
      shellAttributes: 'data-expansion-pack-workspace data-scroll-owner="host" data-nested-scroll="false"',
      title: { eyebrow: tr('packStudio'), contentHtml: `<input class="v4-pack-title-input" type="text" data-action="pack-name" aria-label="${escapeHtml(tr('packName'))}" value="${escapeHtml(editor.name)}"${disabled}><span class="v4-version-badge">${escapeHtml(row.draftId)}</span>` },
      save: { phase: editor.error ? 'error' : packSaveFlight || packAssetFlight ? 'saving' : editor.dirty ? 'dirty' : 'saved',
        label: editor.error || (packSaveFlight || packAssetFlight ? tr('saving') : editor.dirty ? tr('packUnsaved') : tr('packSaved')) },
      actionsHtml: `<button type="button" data-action="request-back-to-maker"${disabled}>← ${escapeHtml(tr('packBackToProjects'))}</button><button type="button" data-action="save-pack"${disabled}>${escapeHtml(tr('save'))}</button>`,
      noticesHtml: `<div class="v4-pack-boundary-note" role="status">${escapeHtml(tr('packStudioBindingCopy'))}</div>`,
      leftLabel: tr('partsItems'),
      leftHtml: `<h3>${escapeHtml(tr('partsItems'))}</h3><button type="button" data-action="pack-add-part"${disabled}>＋ ${escapeHtml(tr('addPartAria'))}</button>${renderMakerPartList(partList)}`,
      centerHtml: `<div class="v4-canvas-toolbar"><div><strong>${escapeHtml(tr('packMergedPreview'))}</strong><span id="expansionPackRenderStatus" role="status">${escapeHtml(editor.previewStatus || '')}</span></div><div class="v4-canvas-tools"><button type="button" data-action="pack-preview"${editor.previewPending || !renderPackPreview ? ' disabled' : ''}>${escapeHtml(tr('packRefreshPreview'))}</button><span class="v4-version-badge">${parent.canvas.width}×${parent.canvas.height}</span></div></div><div class="v4-canvas-viewport"><div class="v4-canvas-ruler"><span>0,0</span><span>${parent.canvas.width},${parent.canvas.height}</span></div><canvas id="expansionPackPreviewCanvas" class="v4-runtime-canvas" data-expansion-pack-preview-canvas width="${parent.canvas.width}" height="${parent.canvas.height}" aria-label="${escapeHtml(tr('packMergedPreview'))}"></canvas></div><p>${escapeHtml(tr('packInheritanceSummary'))}</p>`,
      rightHtml: `${selectedPart && !parent.parts.some(part => part.key === selectedPart.key) ? `<button type="button" data-action="pack-copy-part"${disabled}>Copy Part</button>` : ''}${selectedItem && !inheritedItem ? `<button type="button" data-action="pack-copy-item"${disabled}>Copy Item</button>` : ''}${artwork}${ruleList}${ruleHtml}${visibilityHtml}${colors}${tracks}${economicsHtml}<h3>${escapeHtml(tr('packBindingKind'))}</h3>${parentBindingHtml}<p>${escapeHtml(makerWorkspaceText(state.locale, 'packSavedRevision', { revision: row.revision }))}</p>`,
    });
    const rendered = editor.previewRecord;
    if (rendered) void drawCanonicalPng('expansionPackPreviewCanvas', rendered,
      () => currentPackEditor(editor) && editor.previewRecord === rendered).catch(error => {
      if (currentPackEditor(editor)) {
        editor.previewStatus = String(error.message);
        const status = byId('expansionPackRenderStatus');
        if (status) status.textContent = editor.previewStatus;
      }
    });
  }

  async function requestPackPreview() {
    const editor = state.packEditor;
    if (!editor || !currentPackEditor(editor) || !renderPackPreview) return;
    if (editor.dirty) { editor.previewStatus = 'Save the pending edits before refreshing the preview.'; renderCreator(); return; }
    const request = editor.previewRequest = (editor.previewRequest || 0) + 1;
    const revision = editor.draft.revision;
    const current = () => currentPackEditor(editor) && editor.previewRequest === request && editor.draft.revision === revision;
    const document = packAuthoringDocument(editor.draft.document);
    const part = document.parts.find(row => row.key === editor.partKey) || document.parts[0];
    const item = part?.items.find(row => row.key === editor.itemKey) || part?.items[0];
    const style = item?.styles.find(row => row.key === editor.styleKey)
      || item?.styles.find(row => row.key === item.defaultStyleKey) || item?.styles[0];
    const selection = style ? { partKey: part.key, itemKey: item.key, styleKey: style.key } : undefined;
    editor.previewPending = true; editor.previewRecord = null;
    editor.previewStatus = t('loading', 'Loading…'); renderCreator();
    try {
      const record = exactCanonicalPng(await renderPackPreview({ draftId: editor.draft.draftId, selection }));
      if (!current()) return;
      editor.previewRecord = record;
      const pending = document.parts
        .flatMap(part => part.items).flatMap(item => item.styles).filter(style => style.assetId === null).length;
      editor.previewStatus = `Merged preview ready: ${style?.label || 'default'}.${pending ? ` ${pending} Style(s) waiting for PNG.` : ''}`;
    } catch (error) {
      if (current()) editor.previewStatus = String(error?.message || 'Pack preview failed.');
    } finally {
      if (current()) { editor.previewPending = false; renderCreator(); }
    }
  }

  async function openCreatorPack(key) {
    if (!loadPackDraft || !savePackDraft || creatorPackFlight || !state.record
      || !state.expansionPacks?.some(row => row.key === key)) return;
    const generation = state.creatorDraftGeneration, parentId = state.record.draftId;
    const connection = creatorConnectionGeneration, address = state.connection.address;
    if (!await finishCreatorChanges()) return;
    const request = ++creatorPackRequest;
    try {
      const draft = await loadPackDraft(key);
      if (request !== creatorPackRequest || !creatorDraftCurrent(generation, parentId)
        || connection !== creatorConnectionGeneration || address !== state.connection.address) return;
      if (draft.document.author.address !== address
        || (draft.document.authoringParent ?? draft.document.bindings.parent)?.draft.draftId !== parentId) throw new Error('Pack parent or author changed.');
      state.packEditor = { draft, parentId, generation, connection, address,
        name: draft.document.metadata.name, dirty: false, error: '' };
      renderCreator();
      void requestPackPreview();
    } catch (error) {
      if (request === creatorPackRequest && creatorDraftCurrent(generation, parentId) && connection === creatorConnectionGeneration) {
        state.expansionPacksStatus = 'error'; state.expansionPacksError = String(error.message); renderCreator();
      }
    }
  }

  async function saveCreatorPack({ allowRuleRemoval = false } = {}) {
    if (packAssetFlight && !await packAssetFlight) return false;
    if (packSaveFlight) return packSaveFlight;
    const editor = state.packEditor;
    if (!editor || !currentPackEditor(editor)) return false;
    if (!editor.dirty) return true;
    if (!allowRuleRemoval && Object.values(editor.edits || {}).some(edit => edit.kind === 'rule' && edit.field === 'remove-rule')) {
      editor.error = 'Confirm the marked rule removals or undo them before saving or leaving.';
      renderCreator(); return false;
    }
    const run = async () => {
      try {
        const saved = await savePackDraft({ draftId: editor.draft.draftId,
          expectedRevision: editor.draft.revision, fields: { name: editor.name,
            ...editor.economics,
            ...(Object.keys(editor.edits || {}).length ? { edits: Object.values(editor.edits) } : {}) } });
        if (!currentPackEditor(editor)) return false;
        editor.draft = saved; editor.name = saved.document.metadata.name;
        editor.edits = {}; editor.economics = {}; editor.ruleRemovalUndo = {}; editor.dirty = false; editor.error = ''; return true;
      } catch (error) {
        if (currentPackEditor(editor)) editor.error = String(error?.message || makerWorkspaceText(state.locale, 'packSaveFailed'));
        return false;
      }
    };
    packSaveFlight = run(); renderCreator();
    try { return await packSaveFlight; }
    finally { packSaveFlight = null; if (currentPackEditor(editor)) { renderCreator(); if (!editor.dirty) void requestPackPreview(); } }
  }

  async function bindCreatorPackParent() {
    const editor = state.packEditor;
    if (!bindPackParent || !editor || !currentPackEditor(editor) || packSaveFlight || packAssetFlight
      || editor.draft.document.bindings.kind !== 'LOCAL_DRAFT') return;
    const rootId = String(editor.parentRootInput || '').trim().toLowerCase();
    if (editor.dirty || !/^0x[0-9a-f]{64}$/.test(rootId) || /^0x0+$/.test(rootId)) {
      editor.error = editor.dirty ? 'Save or undo Pack edits before binding the parent.' : 'Enter the complete published Maker Root ID (0x + 64 hex characters).';
      renderCreator(); return;
    }
    const run = async () => {
      try {
        const saved = await bindPackParent({ draftId: editor.draft.draftId,
          expectedRevision: editor.draft.revision, rootId });
        if (!currentPackEditor(editor)) return false;
        editor.draft = saved; editor.error = ''; return true;
      } catch (error) {
        if (currentPackEditor(editor)) editor.error = String(error?.message || 'Parent binding failed; the draft was not changed.');
        return false;
      }
    };
    packSaveFlight = run(); renderCreator();
    try { return await packSaveFlight; }
    finally { packSaveFlight = null; if (currentPackEditor(editor)) { renderCreator(); void requestPackPreview(); } }
  }

  function packEconomicFields(document) {
    return { accessKind: document.access.kind, accessPriceAtomic: document.access.priceAtomic,
      completeMode: document.completion.mode, completePriceAtomic: document.completion.priceAtomic,
      freeQuotaPerWallet: document.completion.freeQuotaPerWallet, totalCap: document.completion.totalCap };
  }

  function capturePackEconomics(control) {
    const editor = state.packEditor;
    if (!editor || !currentPackEditor(editor) || packSaveFlight || packAssetFlight) return;
    const original = packEconomicFields(editor.draft.document), key = control.dataset.field;
    if (!Object.hasOwn(original, key)) return;
    editor.economics ||= {};
    const value = String(control.value);
    if (value === original[key]) delete editor.economics[key]; else editor.economics[key] = value;
    editor.dirty = editor.name !== editor.draft.document.metadata.name
      || Object.keys(editor.edits || {}).length > 0 || Object.keys(editor.economics).length > 0;
    editor.error = '';
    const label = mount.querySelector?.('.v4-save-indicator span');
    if (label) label.textContent = makerWorkspaceText(state.locale, editor.dirty ? 'packUnsaved' : 'packSaved');
  }

  function capturePackProperty(control) {
    const editor = state.packEditor;
    if (!editor || !currentPackEditor(editor) || packSaveFlight || packAssetFlight) return;
    const key = control.dataset.packEdit;
    const edit = JSON.parse(key);
    editor.edits ||= {};
    editor.edits[key] = { ...edit, value: String(control.value) };
    editor.dirty = true; editor.error = '';
    const label = mount.querySelector?.('.v4-save-indicator span');
    if (label) label.textContent = makerWorkspaceText(state.locale, 'packUnsaved');
  }

  function capturePackVisibility({ clear = false } = {}) {
    const editor = state.packEditor, visibility = editor?.visibilityEditor;
    if (!visibility || visibility.advanced || !currentPackEditor(editor) || packSaveFlight || packAssetFlight) return;
    const { partKey, itemKey, styleKey, logic, polarity, definitions } = visibility;
    const edit = { kind: 'style', field: 'style-visibility', partKey, itemKey, styleKey };
    editor.edits ||= {};
    editor.edits[JSON.stringify(edit)] = { ...edit,
      value: clear ? null : { logic, polarity, definitions: [...definitions] } };
    if (clear) { visibility.definitions = []; visibility.logic = 'all'; visibility.polarity = 'selected'; }
    editor.dirty = true; editor.error = '';
  }

  function capturePackRule() {
    const editor = state.packEditor, rule = editor?.combinationEditor;
    if (!rule || !currentPackEditor(editor) || packSaveFlight || packAssetFlight) return;
    const edit = { kind: 'rule', field: 'upsert-rule', ruleKey: rule.key };
    editor.edits ||= {};
    editor.edits[JSON.stringify(edit)] = { ...edit, value: structuredClone(rule.builder) };
    editor.dirty = true; editor.error = '';
  }

  async function uploadPackStyle(control) {
    const file = control.files?.[0]; control.value = '';
    const editor = state.packEditor;
    if (!file || !editor || !currentPackEditor(editor) || !upsertPackAsset || packAssetFlight || packSaveFlight) return;
    const parent = (editor.draft.document.authoringParent ?? editor.draft.document.bindings.parent).draft.document;
    const authored = packAuthoringDocument(editor.draft.document);
    const part = authored.parts.find(row => row.key === editor.partKey) || authored.parts[0];
    const item = part?.items.find(row => row.key === editor.itemKey) || part?.items[0];
    if (!item) return;
    let existing = control.dataset.styleKey ? editor.draft.document.styles.find(row =>
      row.partKey === part.key && row.itemKey === item.key && row.styleKey === control.dataset.styleKey) : null;
    let pending = control.dataset.styleKey ? item.styles.find(style => style.key === control.dataset.styleKey) : null;
    if (control.dataset.styleKey && (!pending || parent.parts.find(row => row.key === part.key)?.items
      .find(row => row.key === item.key)?.styles.some(style => style.key === pending.key))) return;
    if (!await saveCreatorPack() || !currentPackEditor(editor) || packAssetFlight) return;
    // Saving pending edits may have changed Track/Color; replacement must use
    // the newly saved binding rather than the pre-save control snapshot.
    if (control.dataset.styleKey) {
      existing = editor.draft.document.styles.find(row => row.partKey === part.key && row.itemKey === item.key && row.styleKey === control.dataset.styleKey);
      pending = packAuthoringDocument(editor.draft.document).parts.find(row => row.key === part.key)?.items
        .find(row => row.key === item.key)?.styles.find(row => row.key === control.dataset.styleKey);
    }
    const run = async () => {
      try {
        if (!Number.isSafeInteger(file.size) || file.size < 33 || file.size > 12 * 1024 * 1024
          || (file.type && file.type !== 'image/png')) throw new TypeError('Choose a PNG image no larger than 12 MiB.');
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.length !== file.size) throw new TypeError('Image changed while reading.');
        await decodeCreatorImage(bytes, { ...pngDimensions(bytes), mediaType: 'image/png' });
        if (!currentPackEditor(editor)) return false;
        const styleKey = existing?.styleKey || pending?.key || `pack-style-${win.crypto.randomUUID()}`;
        const layerTrackKey = existing?.layerTrackKey || pending?.trackKey || item.styles.find(style => style.trackKey)?.trackKey;
        if (!layerTrackKey) throw new TypeError('Choose an Item with a Layer Track before adding Pack artwork.');
        const saved = await upsertPackAsset({ draftId: editor.draft.draftId, expectedRevision: editor.draft.revision,
          style: { partKey: part.key, itemKey: item.key, styleKey, layerTrackKey,
            colorChannelKey: existing?.colorChannelKey ?? pending?.colorChannelKey ?? null,
            defaultSwatchKey: existing?.defaultSwatchKey ?? pending?.defaultSwatchKey ?? null,
            protected: existing?.asset.protected ?? pending?.protected ?? false },
          asset: { assetId: existing?.asset.assetId || `pack-asset-${win.crypto.randomUUID()}`,
            mediaType: 'image/png', bytesBase64: toBase64(bytes) } });
        if (!currentPackEditor(editor)) return false;
        editor.draft = saved.draft; editor.error = ''; return true;
      } catch (error) {
        if (currentPackEditor(editor)) editor.error = String(error?.message || 'Pack artwork could not be saved. Choose the file again to retry.');
        return false;
      }
    };
    packAssetFlight = run(); renderCreator();
    try { return await packAssetFlight; }
    finally { packAssetFlight = null; if (currentPackEditor(editor)) { renderCreator(); void requestPackPreview(); } }
  }

  async function addPackStructure(action, styleKey, direction, move = {}) {
    const editor = state.packEditor;
    if (!editor || !currentPackEditor(editor) || packSaveFlight || packAssetFlight) return;
    if (!await saveCreatorPack() || !currentPackEditor(editor)) return;
    const document = packAuthoringDocument(editor.draft.document);
    const part = document.parts.find(row => row.key === editor.partKey) || document.parts[0];
    const item = part?.items.find(row => row.key === editor.itemKey) || part?.items[0];
    const structure = { action, partKey: move.partKey ?? part?.key, itemKey: item?.key, styleKey, direction,
      ...(move.targetKey === undefined ? {} : { targetKey: move.targetKey }) };
    const run = async () => {
      try {
        const prepared = preparePackStructure(editor.draft.document, structure);
        const saved = await savePackDraft({ draftId: editor.draft.draftId,
          expectedRevision: editor.draft.revision, fields: { structure } });
        if (!currentPackEditor(editor)) return false;
        editor.draft = saved; editor.partKey = prepared.selection.partKey; editor.itemKey = prepared.selection.itemKey; editor.styleKey = prepared.selection.styleKey;
        editor.error = ''; return true;
      } catch (error) {
        if (currentPackEditor(editor)) editor.error = String(error.message);
        return false;
      }
    };
    packSaveFlight = run(); renderCreator();
    try { return await packSaveFlight; }
    finally { packSaveFlight = null; if (currentPackEditor(editor)) { renderCreator(); void requestPackPreview(); } }
  }

  let composableInventoryRequest = 0;
  let composableTargetRequest = 0;
  let composableHistoryRequest = 0;
  async function loadComposableUploadHistory() {
    if (!state.connection.connected || !state.record) return;
    const address = state.connection.address, connection = creatorConnectionGeneration;
    const generation = state.creatorDraftGeneration, request = ++composableHistoryRequest;
    const current = () => request === composableHistoryRequest && connection === creatorConnectionGeneration && generation === state.creatorDraftGeneration;
    state.composableUploadHistory = { address, status: 'loading', rows: [] }; renderCreator();
    try {
      if (!listComposableUploads) throw new Error('Upload history is unavailable.');
      const result = await listComposableUploads();
      if (!current()) return;
      if (result.address !== address || !Array.isArray(result.rows)) throw new Error('Upload history wallet differs.');
      state.composableUploadHistory = { address, status: 'ready', rows: result.rows };
    } catch (error) {
      if (!current()) return;
      state.composableUploadHistory = { address, status: 'error', rows: [], error: String(error?.message || error) };
    }
    renderCreator();
  }
  async function continueComposableUpload(uploadId, action) {
    const history = state.composableUploadHistory;
    const handler = action === 'REVIEW' ? reviewComposableUpload : action === 'CREATE_PRODUCT'
      ? createComposableUploadProduct : action === 'RECOVER_PRODUCT' ? recoverComposableAction : advanceComposableUpload;
    if (history?.busy || history?.address !== state.connection.address || !handler) return;
    const row = history.rows.find(row => row.uploadId === uploadId);
    if (!row) return;
    const generation = state.creatorDraftGeneration, connection = creatorConnectionGeneration;
    state.composableUploadHistory = { ...history, busy: true }; renderCreator();
    try {
      if (action === 'CREATE_PRODUCT' || action === 'RECOVER_PRODUCT') {
        if (action === 'CREATE_PRODUCT') {
          if (!createComposableUploadProduct) throw new Error('Product creation is unavailable.');
          await createComposableUploadProduct({ uploadId });
        } else {
          if (!recoverComposableAction || !row.productAttempt?.ticket) throw new Error('Saved Product recovery ticket is unavailable.');
          await recoverComposableAction(row.productAttempt.ticket);
        }
        if (generation === state.creatorDraftGeneration && connection === creatorConnectionGeneration) await loadComposableUploadHistory();
        return;
      }
      if (action === 'REVIEW') {
        const request = await reviewComposableUpload({ uploadId });
        if (generation === state.creatorDraftGeneration && connection === creatorConnectionGeneration) {
          state.composableUploadHistory = { ...history, busy: false, actionError: '', productReview: request };
          renderCreator();
        }
        return;
      }
      await advanceComposableUpload({ uploadId, uploadRevision: row.uploadRevision, stage: row.stage, status: row.status, action });
      if (generation === state.creatorDraftGeneration && connection === creatorConnectionGeneration) await loadComposableUploadHistory();
    } catch (error) {
      if (generation === state.creatorDraftGeneration && connection === creatorConnectionGeneration) {
        // Rejection or a transport exception can occur after a durable state
        // change. Re-read it before offering another action; never restore the
        // pre-sign snapshot and imply that nothing was persisted.
        await loadComposableUploadHistory();
        if (generation !== state.creatorDraftGeneration || connection !== creatorConnectionGeneration) return;
        state.composableUploadHistory = { ...state.composableUploadHistory, busy: false, actionError: String(error?.message || error) };
        renderCreator();
      }
    }
  }
  let composableArtworkRequest = 0;
  async function selectComposablePart(partKey) {
    const target = state.composableTargets?.target;
    if (!target?.parts.some(part => part.key === partKey) || !state.connection.connected) return;
    const request = ++composableArtworkRequest, generation = state.creatorDraftGeneration;
    const connection = creatorConnectionGeneration;
    const binding = { address: state.connection.address, rootId: target.rootId,
      makerVersion: target.makerVersion, contentCommitment: target.contentCommitment, partKey };
    state.composableArtwork = { binding, status: 'loading', revision: 0 }; renderCreator();
    try {
      const saved = await composableArtworkStore.load(binding);
      if (request !== composableArtworkRequest || connection !== creatorConnectionGeneration || generation !== state.creatorDraftGeneration) return;
      state.composableArtwork = { binding, status: saved ? 'saved' : 'empty', revision: saved?.revision || 0, sha256: saved?.sha256 || '',
        settings: saved?.settings || { itemKey: '', styleKey: '', layerTrackKey: '', colorChannelKey: null, defaultSwatchKey: null, transferable: false } };
    } catch (error) {
      if (request !== composableArtworkRequest || connection !== creatorConnectionGeneration || generation !== state.creatorDraftGeneration) return;
      state.composableArtwork = { binding, status: 'error', revision: 0, error: String(error?.message || error) };
    }
    renderCreator();
  }
  async function saveComposableArtwork(control) {
    const file = control.files?.[0]; control.value = '';
    const prior = state.composableArtwork;
    if (!file || !prior || !['empty', 'saved'].includes(prior.status)) return;
    const request = ++composableArtworkRequest, connection = creatorConnectionGeneration;
    const generation = state.creatorDraftGeneration;
    const current = () => request === composableArtworkRequest && connection === creatorConnectionGeneration
      && generation === state.creatorDraftGeneration && prior.binding.address === state.connection.address;
    state.composableArtwork = { ...prior, status: 'saving' }; renderCreator();
    try {
      if (file.size > 12 * 1024 * 1024) throw new Error('PNG files must not exceed 12 MiB.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      await decodeCreatorImage(bytes, { ...pngDimensions(bytes), mediaType: 'image/png' });
      if (!current()) return;
      const saved = await composableArtworkStore.save({ binding: prior.binding, expectedRevision: prior.revision, bytes });
      if (!current()) return;
      state.composableArtwork = { ...prior, binding: prior.binding, status: 'saved', revision: saved.revision, sha256: saved.sha256, storage: null };
    } catch (error) {
      if (!current()) return;
      state.composableArtwork = { ...prior, status: 'error', error: String(error?.message || error) };
    }
    renderCreator();
  }

  function captureComposableSetting(control) {
    const art = state.composableArtwork, field = control.dataset.field;
    if (!art || art.status !== 'saved' || !art.settings) return;
    const settings = { ...art.settings };
    if (['itemKey', 'styleKey', 'layerTrackKey'].includes(field)) settings[field] = String(control.value);
    else if (field === 'transferable') settings.transferable = control.checked === true;
    else if (field === 'color') {
      try {
        const pair = JSON.parse(control.value);
        if (!Array.isArray(pair) || pair.length !== 2) return;
        [settings.colorChannelKey, settings.defaultSwatchKey] = pair;
      } catch { return; }
    } else return;
    state.composableArtwork = { ...art, settings, settingsDirty: true, storage: null };
    const status = mount.querySelector?.('[data-composable-artwork-status]');
    if (status) status.textContent = makerWorkspaceText(state.locale, 'unsavedChanges');
  }
  async function saveComposableSettings() {
    const prior = state.composableArtwork, target = state.composableTargets?.target;
    if (!prior || prior.status !== 'saved' || !target) return;
    const request = ++composableArtworkRequest, connection = creatorConnectionGeneration, generation = state.creatorDraftGeneration;
    const current = () => request === composableArtworkRequest && connection === creatorConnectionGeneration && generation === state.creatorDraftGeneration;
    state.composableArtwork = { ...prior, status: 'saving' }; renderCreator();
    try {
      const saved = await composableArtworkStore.saveSettings({ binding: prior.binding, expectedRevision: prior.revision, settings: prior.settings, target });
      if (!current()) return;
      state.composableArtwork = { ...prior, status: 'saved', revision: saved.revision, settings: saved.settings, settingsDirty: false, error: '', storage: null };
    } catch (error) {
      if (!current()) return;
      state.composableArtwork = { ...prior, status: 'error', error: String(error?.message || error) };
    }
    renderCreator();
  }

  async function prepareExternalArtworkStorage() {
    const prior = state.composableArtwork;
    if (!prior || prior.status !== 'saved' || prior.settingsDirty || !prepareComposableStorage) return;
    const request = ++composableArtworkRequest, connection = creatorConnectionGeneration, generation = state.creatorDraftGeneration;
    const current = () => request === composableArtworkRequest && connection === creatorConnectionGeneration && generation === state.creatorDraftGeneration;
    state.composableArtwork = { ...prior, status: 'saving', storage: null }; renderCreator();
    try {
      const storage = await prepareComposableStorage({ binding: prior.binding, expectedRevision: prior.revision });
      if (!current()) return;
      state.composableArtwork = { ...prior, status: 'saved', storage, error: '' };
    } catch (error) {
      if (!current()) return;
      state.composableArtwork = { ...prior, status: 'error', storage: null, error: String(error?.message || error) };
    }
    renderCreator();
  }

  async function loadComposableTargets(rootId = null) {
    if (!state.record || !state.connection.connected) return;
    const prior = state.composableTargets;
    if (rootId && !prior?.makers?.some(row => row.rootId === rootId)) return;
    const request = ++composableTargetRequest;
    composableArtworkRequest += 1; state.composableArtwork = null;
    const generation = state.creatorDraftGeneration, draftId = state.record.draftId;
    const connection = creatorConnectionGeneration, address = state.connection.address;
    const current = () => request === composableTargetRequest && creatorDraftCurrent(generation, draftId)
      && connection === creatorConnectionGeneration && address === state.connection.address;
    state.composableTargets = { address, status: 'loading', makers: rootId ? prior.makers : [], target: null };
    renderCreator();
    try {
      if (!listComposableMakers || !getComposableMaker) throw new Error('Published Maker discovery is unavailable.');
      const result = rootId ? await getComposableMaker({ rootId }) : await listComposableMakers();
      if (!current()) return;
      state.composableTargets = { address, status: 'ready', makers: rootId ? prior.makers : result, target: rootId ? result : null };
    } catch (error) {
      if (!current()) return;
      state.composableTargets = { address, status: 'error', makers: [], target: null, error: String(error?.message || error) };
    }
    if (current()) renderCreator();
  }

  async function reviewAdmission(action) {
    const target = state.composableTargets?.target, prior = state.composableAdmission;
    if (!target || !reviewComposableAdmission || prior?.busy || prior?.rootId !== target.rootId) return;
    const generation = state.creatorDraftGeneration, connection = creatorConnectionGeneration;
    const current = () => generation === state.creatorDraftGeneration && connection === creatorConnectionGeneration
      && state.composableTargets?.target?.rootId === target.rootId && state.composableAdmission?.productId === prior.productId;
    state.composableAdmission = { ...prior, busy: true, review: null, error: '' }; renderCreator();
    try {
      const review = await reviewComposableAdmission({ rootId: target.rootId, productId: prior.productId, action });
      if (current()) state.composableAdmission = { ...prior, busy: false, review, error: '' };
    } catch (cause) {
      if (current()) state.composableAdmission = { ...prior, busy: false, review: null, error: String(cause?.message || cause) };
    }
    if (current()) renderCreator();
  }

  async function itemOperation(action, requestId, mode) {
    if (!state.connection.connected || !state.record || state.composableOperations?.busy) return;
    const address = state.connection.address, generation = state.creatorDraftGeneration, connection = creatorConnectionGeneration;
    const current = () => generation === state.creatorDraftGeneration && connection === creatorConnectionGeneration;
    const savedRow = state.composableOperations?.rows?.find(row => row.request.requestId === requestId);
    if (action === 'continue' && mode === 'SIGN' && ['ARCHIVE_PRODUCT', 'TRANSFER_CONTROL'].includes(savedRow?.request.action)) {
      const request = savedRow.request;
      const copy = {
        en: ['Archive this Product? This cannot be resumed. Wallet signing and gas are required.', 'Transfer this Product’s control? You will lose its management rights. Wallet signing and gas are required.', 'Product', 'Recipient'],
        zh: ['确认归档此产品？归档后无法恢复。需要钱包签名并支付 Gas。', '确认转移此产品的控制权？你将失去管理权。需要钱包签名并支付 Gas。', '产品', '接收钱包'],
        ja: ['この製品をアーカイブしますか？再開できません。ウォレット署名とガス代が必要です。', 'この製品の管理権を移転しますか？管理権を失います。ウォレット署名とガス代が必要です。', '製品', '受取先'],
        ko: ['이 제품을 보관할까요? 다시 활성화할 수 없습니다. 지갑 서명과 가스비가 필요합니다.', '이 제품의 관리 권한을 이전할까요? 관리 권한을 잃게 됩니다. 지갑 서명과 가스비가 필요합니다.', '제품', '받는 지갑'],
        vi: ['Lưu trữ sản phẩm này? Không thể kích hoạt lại. Cần chữ ký ví và phí gas.', 'Chuyển quyền quản lý sản phẩm này? Bạn sẽ mất quyền quản lý. Cần chữ ký ví và phí gas.', 'Sản phẩm', 'Ví nhận'],
      }[state.locale] || ['Archive this Product? This cannot be resumed. Wallet signing and gas are required.', 'Transfer this Product’s control? You will lose its management rights. Wallet signing and gas are required.', 'Product', 'Recipient'];
      const warning = `${copy[request.action === 'ARCHIVE_PRODUCT' ? 0 : 1]}\n${copy[2]}: ${request.product.productId}${request.action === 'TRANSFER_CONTROL' ? `\n${copy[3]}: ${request.payload.recipient}` : ''}`;
      if (typeof win.confirm !== 'function' || !win.confirm(warning)) return;
    }
    state.composableOperations = { address, busy: true, rows: [] }; renderCreator();
    let error = '';
    try {
      if (action === 'stage' || action === 'stage-admission') {
        const request = action === 'stage-admission' ? state.composableAdmission?.review : state.composableInventory?.itemReview;
        if (!request || !stageComposableOperation) throw new Error('Review an Item operation first.');
        await stageComposableOperation(request);
        if (current()) state.composableInventory = { ...state.composableInventory, itemReview: null };
        if (current() && action === 'stage-admission') state.composableAdmission = { ...state.composableAdmission, review: null };
      } else if (action === 'continue') {
        if (!continueComposableOperation) throw new Error('Item execution is unavailable.');
        if (!savedRow) throw new Error('Read the saved operation before continuing.');
        await continueComposableOperation({ requestId, mode, action: savedRow.request.action });
      }
    } catch (cause) { error = String(cause?.message || cause); }
    if (!current()) return;
    try {
      if (!listComposableOperations) throw new Error('Item operation history is unavailable.');
      const result = await listComposableOperations();
      if (!current()) return;
      if (result.address !== address || !Array.isArray(result.rows)) throw new Error('Item operation wallet differs.');
      state.composableOperations = { address, status: 'ready', busy: false, rows: result.rows, error };
    } catch (cause) {
      if (!current()) return;
      state.composableOperations = { address, status: 'error', busy: false, rows: [], error: [error, String(cause?.message || cause)].filter(Boolean).join(' · ') };
    }
    renderCreator();
  }

  async function reviewControlledItem(productId, action = 'MINT_ITEM') {
    const inventory = state.composableInventory;
    const review = action === 'MINT_ITEM' ? reviewComposableItem : reviewComposableProduct;
    if (!review || inventory?.busy || inventory?.address !== state.connection.address) return;
    const generation = state.creatorDraftGeneration, connection = creatorConnectionGeneration;
    const current = () => generation === state.creatorDraftGeneration && connection === creatorConnectionGeneration;
    state.composableInventory = { ...inventory, busy: true, itemReview: null, actionError: '' }; renderCreator();
    try {
      const itemReview = await review({ productId, action, recipient: inventory.recipients?.[productId] });
      if (current()) state.composableInventory = { ...inventory, busy: false, itemReview, actionError: '' };
    } catch (error) {
      if (current()) state.composableInventory = { ...inventory, busy: false, itemReview: null, actionError: String(error?.message || error) };
    }
    if (current()) renderCreator();
  }

  async function loadComposableProducts() {
    if (!state.record || !state.connection.connected) return;
    const request = ++composableInventoryRequest;
    const generation = state.creatorDraftGeneration, draftId = state.record.draftId;
    const connection = creatorConnectionGeneration, address = state.connection.address;
    const current = () => request === composableInventoryRequest && creatorDraftCurrent(generation, draftId)
      && connection === creatorConnectionGeneration && address === state.connection.address;
    state.composableInventory = { address, status: 'loading', products: [] }; renderCreator();
    try {
      if (!listComposableProducts) throw new Error('External Product inventory is unavailable.');
      const result = await listComposableProducts();
      if (!current()) return;
      if (result.address !== address || !Array.isArray(result.products)) throw new Error('External Product inventory identity differs.');
      state.composableInventory = { address, status: 'ready', products: result.products };
    } catch (error) {
      if (!current()) return;
      state.composableInventory = { address, status: 'error', products: [], error: String(error?.message || error) };
    }
    if (current()) renderCreator();
  }

  async function loadCreatorPacks() {
    if (!listPackDrafts || !state.record || !state.connection.connected) return;
    const request = ++creatorPackRequest;
    const generation = state.creatorDraftGeneration, draftId = state.record.draftId;
    const connection = creatorConnectionGeneration, address = state.connection.address;
    const current = () => request === creatorPackRequest && creatorDraftCurrent(generation, draftId)
      && connection === creatorConnectionGeneration && address === state.connection.address;
    state.expansionPacksStatus = 'loading'; state.expansionPacksError = ''; renderCreator();
    try {
      const rows = await listPackDrafts();
      if (!current()) return;
      state.expansionPacks = rows.filter(row => row.document?.author?.address === address
        && (row.document.authoringParent ?? row.document.bindings?.parent)?.draft.draftId === draftId).map(row => ({
        key: row.draftId, packId: row.document.metadata.semanticPackId,
        name: row.document.metadata.name, namespace: row.document.metadata.semanticPackId,
        version: String((row.document.authoringParent ?? row.document.bindings.parent).draft.document.lineage.version),
        revision: row.revision, status: row.document.authoringParent ? 'Parent bound · Draft' : 'Draft', publishable: false,
        parentBindingIdentity: (row.document.authoringParent ?? row.document.bindings.parent).draftSha256,
      }));
      state.expansionPacksStatus = 'ready';
    } catch (error) {
      if (!current()) return;
      state.expansionPacksStatus = 'error';
      state.expansionPacksError = String(error?.message || makerWorkspaceText(state.locale, 'packLoadFailed'));
    }
    if (current()) renderCreator();
  }

  async function addCreatorPack() {
    if (!createPackDraft || creatorPackFlight || !state.record || !state.connection.connected) return;
    const generation = state.creatorDraftGeneration, draftId = state.record.draftId;
    const connection = creatorConnectionGeneration;
    const current = () => creatorDraftCurrent(generation, draftId) && connection === creatorConnectionGeneration;
    const flight = {}; creatorPackFlight = flight; renderCreator();
    try {
      if (!await finishCreatorChanges() || !current()) return;
      const key = `pack-${crypto.randomUUID()}`;
      await createPackDraft({ draftId: key, makerDraftId: draftId,
        metadata: { semanticPackId: key, name: makerWorkspaceText(state.locale, 'packDefaultName',
          { count: (state.expansionPacks?.length || 0) + 1 }) } });
      if (current()) await loadCreatorPacks();
    } catch (error) {
      if (current()) {
        state.expansionPacksStatus = 'error';
        state.expansionPacksError = String(error?.message || makerWorkspaceText(state.locale, 'packLoadFailed'));
      }
    } finally {
      if (creatorPackFlight === flight) creatorPackFlight = null;
      if (current()) renderCreator();
    }
  }

  function publishedMaker(record) {
    return record && publishedMakers.get(JSON.stringify([state.connection.address, record.draftId]));
  }
  function publicationLabel(record) {
    const published = publishedMaker(record);
    return published?.scope?.currentSavedRevision === record?.revision && published.scope.currentContentMatches === true
      || published?.scope?.draftRevision === record?.revision
      ? makerWorkspaceText(state.locale, 'publicationComplete')
      : makerWorkspaceText(state.locale, 'chainCurrentUnpublished');
  }

  async function readPublishedMaker(record) {
    if (!getPublishedMaker || !state.connection.connected) return;
    const address = state.connection.address, connection = creatorConnectionGeneration;
    try {
      const result = await getPublishedMaker({ draftId: record.draftId });
      if (state.destroyed || connection !== creatorConnectionGeneration || address !== state.connection.address) return;
      if (result?.complete !== true || !result.rootId || result.scope?.signerAddress !== address
        || result.scope?.draftId !== record.draftId || result.scope?.network !== 'mainnet') return;
      publishedMakers.set(JSON.stringify([address, record.draftId]), result);
      renderCreatorLibrary();
      if (state.record?.draftId === record.draftId) {
        renderCreator();
        if (byId('makerLifecycleManagerModal')?.classList?.contains('active')) openLifecycleManager();
      }
    } catch { /* Certification is unknown until a subsequent successful read. */ }
  }

  function invalidatePublicationReview() {
    publicationGeneration += 1;
    state.publicationReview = null;
    state.publicationHidden = false;
    // This only invalidates the local review token; durable attempts stay intact.
    cancelMakerPublicationReview?.();
  }

  function focusPublication(selector = '#makerCreatorPublishDialog') {
    if (!state.publicationHidden) byId('makerV4CreatorMount')?.querySelector?.(selector)?.focus?.({ preventScroll: true });
  }

  function closePublication(force = false) {
    if (publicationFlight && !force) {
      if (state.publicationReview) state.publicationReview = { ...state.publicationReview, closeConfirm: true };
      renderCreator(); focusPublication('[data-action="publication-keep-open"]');
      return;
    }
    if (publicationFlight) {
      // Hiding the dialog does not cancel a wallet/network request or discard
      // its outcome. Keep the same in-flight state available on reopening.
      state.publicationHidden = true;
      if (state.publicationReview) state.publicationReview = { ...state.publicationReview, closeConfirm: false };
    } else invalidatePublicationReview();
    renderCreator();
    byId('makerV4CreatorMount')?.querySelector?.('[data-action="publish"]')?.focus?.({ preventScroll: true });
  }

  function publicationErrorInfo(error, consequential) {
    const diagnostic = String(error?.message || error);
    const rawCode = String(error?.code || 'CHAIN_ACTION_FAILED');
    const text = `${rawCode} ${diagnostic}`;
    let code = rawCode;
    if (/reject|denied by user|user cancel/i.test(text)) code = 'WALLET_REJECTED';
    else if (/tip.*(?:high|maximum|exceed)|TIP_TOO_HIGH/i.test(text)) code = 'TIP_TOO_HIGH';
    else if (/insufficient.*wal\b/i.test(text)) code = 'INSUFFICIENT_WAL_BALANCE';
    else if (/insufficient.*(?:gas|sui)|INSUFFICIENT_GAS/i.test(text)) code = 'INSUFFICIENT_GAS';
    else if (/network|fetch failed|failed to fetch|unavailable|timeout/i.test(text)) code = 'NETWORK_UNAVAILABLE';
    else if (/pending|unknown.*(?:result|outcome)|OUTCOME_UNKNOWN/i.test(text)) code = 'TRANSACTION_OUTCOME_PENDING';
    return { code, message: diagnostic, diagnostic, recoveryOnly: consequential };
  }

  async function runPublicationReview(action, reviewId) {
    if (publicationFlight || !prepareMakerPublication || !inspectMakerPublication
      || !state.record || !state.connection.connected || state.route !== 'creator') return;
    const generation = state.creatorDraftGeneration, draftId = state.record.draftId;
    const connection = creatorConnectionGeneration, address = state.connection.address;
    const navigation = state.localNavigationRequest;
    const current = () => creatorDraftCurrent(generation, draftId)
      && connection === creatorConnectionGeneration && address === state.connection.address
      && navigation === state.localNavigationRequest && state.route === 'creator';
    const prior = state.publicationReview?.review;
    const consequential = action === 'publication-sign' || action === 'publication-continue';
    if (consequential && (state.publicationReview?.errorInfo || state.publicationHidden
      || !prior || prior.reviewId !== reviewId
      || (prior.scope.currentSavedRevision ?? prior.scope.draftRevision) !== state.record.revision
      || prior.nextAction !== (action === 'publication-sign' ? 'SIGN' : 'CONTINUE')
      || creatorHasPendingChanges())) return;
    if (consequential && !(state.bridgeState?.publication?.signingEnabled
      && state.bridgeState?.publication?.broadcastEnabled)) return;
    const flight = {}; publicationFlight = flight;
    let request = publicationGeneration;
    try {
      if (!consequential) {
        if (!await finishCreatorChanges() || !current()) return;
        request = publicationGeneration;
      }
      if (!current() || request !== publicationGeneration) return;
      const revision = state.record.revision;
      state.publicationHidden = false;
      state.publicationReview = { review: prior, busy: true, error: '', errorInfo: null, closeConfirm: false };
      renderCreator();
      focusPublication();
      const result = consequential
        ? await (action === 'publication-sign' ? signMakerPublication : continueMakerPublication)({ reviewId })
        : await (action === 'publication-refresh' ? inspectMakerPublication : prepareMakerPublication)({ draftId, expectedRevision: revision });
      if (!current() || request !== publicationGeneration || state.record.revision !== revision) return;
      if (result?.schemaVersion !== 'animacraft.maker-v8-publication-review.v1'
        || result.scope?.draftId !== draftId || (result.scope?.currentSavedRevision ?? result.scope?.draftRevision) !== revision
        || (result.scope.draftRevision !== revision && result.scope.publishingEarlierRevision !== true)
        || result.scope?.signerAddress !== address || result.scope?.network !== 'mainnet') {
        throw new TypeError(makerWorkspaceText(state.locale, 'publicationStale'));
      }
      state.publicationReview = { review: result, busy: false, error: '', errorInfo: null, closeConfirm: false };
      // Discovery uses certified Root readback. Never fabricate a local template.
      if (result.rootId && result.status === 'COMPLETE') {
        publishedMakers.set(JSON.stringify([address, draftId]), { complete: true, rootId: result.rootId,
          makerVersion: result.makerVersion, scope: result.scope });
        renderCreatorLibrary();
        void refreshTemplates().catch(() => {});
      }
    } catch (error) {
      if (current() && request === publicationGeneration) {
        state.publicationReview = { review: prior ? { ...prior, nextAction: null, reviewId: '' } : null,
          busy: false, error: String(error?.message || error),
          errorInfo: publicationErrorInfo(error, consequential), closeConfirm: false };
      }
    } finally {
      if (publicationFlight === flight) publicationFlight = null;
      if (current()) renderCreator();
    }
  }

  async function handleCreatorAction(action, control, eventTarget = control) {
    if (state.projectImportPending || creatorAssetFlight || creatorRecoveryFlight) return;
    if (action === 'publication-versions') {
      if (control?.disabled || !state.record) return;
      closePublication(); state.versionHistoryOpen = true; return loadVersionHistory();
    }
    if (['chain-archive-review', 'chain-archive-sign', 'chain-archive-recover', 'chain-successor'].includes(action)) {
      return runChainVersionAction(action, control);
    }
    if (action === 'publication-close') { closePublication(); return; }
    if (action === 'publication-force-close') { closePublication(true); return; }
    if (action === 'publication-keep-open') {
      if (state.publicationReview) state.publicationReview = { ...state.publicationReview, closeConfirm: false };
      renderCreator(); focusPublication(); return;
    }
    if (action === 'publication-copy-error') {
      const current = state.publicationReview;
      if (!current?.errorInfo?.diagnostic || state.publicationHidden) return;
      let copyState;
      try {
        if (!win?.navigator?.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await win.navigator.clipboard.writeText(current.errorInfo.diagnostic);
        copyState = 'copied';
      } catch { copyState = 'error'; }
      if (state.publicationReview === current) {
        state.publicationReview = { ...current, copyState };
        renderCreator(); focusPublication('[data-action="publication-copy-error"]');
      }
      return;
    }
    if (action === 'publication-open') {
      const review = state.publicationReview?.review;
      if (control?.disabled || !review || review.status !== 'COMPLETE' || !review.rootId
        || review.reviewId !== control.dataset.publicationReview || !state.connection.connected
        || review.scope.signerAddress !== state.connection.address || review.scope.draftId !== state.record?.draftId) return;
      return openTemplateDetail(review.rootId);
    }
    if (['publish', 'publication-refresh', 'publication-sign', 'publication-continue'].includes(action)) {
      if (control?.disabled) return;
      if (action === 'publish' && (control.dataset.reviewDraft !== state.record?.draftId
        || Number(control.dataset.creatorGeneration) !== state.creatorDraftGeneration)) return;
      if (action === 'publish' && publicationFlight && state.publicationReview) {
        state.publicationHidden = false;
        state.publicationReview = { ...state.publicationReview, closeConfirm: false };
        renderCreator(); focusPublication(); return;
      }
      return runPublicationReview(action, control?.dataset?.publicationReview);
    }
    if (action === 'review-preflight' || action === 'run-preflight') {
      if (control?.disabled || !creatorRuleEventCurrent() || !state.connection.connected || !creatorEditorVisible()
        || control.dataset.reviewDraft !== state.record.draftId
        || Number(control.dataset.creatorGeneration) !== state.creatorDraftGeneration) return;
      // Recompute from the current editor record (including pending intent).
      // Review is never a publish action and does not write or request a wallet.
      state.creatorTab = 'validate';
      renderCreator({ focusTool: true, drawPreview: false });
      return;
    }
    creatorSortDrag = null;
    cancelCreatorStyleInteraction({ redraw: true });
    if (action === 'open-player' && !control?.disabled) return startLocalPlayer();
    if (!state.record || control?.disabled) return;
    if (action === 'open-expansion-pack-studio') return openCreatorPack(String(control.dataset.packProjectKey || ''));
    if (action === 'pack-preview' || action === 'pack-preview-style') {
      if (action === 'pack-preview-style' && state.packEditor) state.packEditor.styleKey = control.dataset.styleKey;
      return requestPackPreview();
    }
    if (['pack-add-part', 'pack-add-item', 'pack-add-style', 'pack-add-channel', 'pack-add-track'].includes(action)) return addPackStructure(action.slice(5));
    if (['pack-copy-part', 'pack-copy-item', 'pack-copy-style'].includes(action)) return addPackStructure(action.slice(5), control.dataset.styleKey);
    if (action === 'pack-move-part') return addPackStructure('move-part', state.packEditor?.styleKey, control.dataset.direction);
    if (action === 'pack-track-action') {
      if (!await saveCreatorPack()) return;
      capturePackProperty(control); return saveCreatorPack();
    }
    if (action === 'pack-add-swatch') { capturePackProperty(control); return saveCreatorPack(); }
    if (action === 'pack-remove-rule' || action === 'pack-undo-remove-rule') {
      const editor = state.packEditor, ruleKey = control.dataset.ruleKey;
      if (!editor || !currentPackEditor(editor) || packSaveFlight || packAssetFlight) return;
      const document = packAuthoringDocument(editor.draft.document), parent = (editor.draft.document.authoringParent ?? editor.draft.document.bindings.parent).draft.document;
      if (!document.rules.some(rule => rule.key === ruleKey) || parent.rules.some(rule => rule.key === ruleKey)) return;
      const upsertKey = JSON.stringify({ kind: 'rule', field: 'upsert-rule', ruleKey });
      const remove = { kind: 'rule', field: 'remove-rule', ruleKey }, removeKey = JSON.stringify(remove);
      editor.edits ||= {}; editor.ruleRemovalUndo ||= {};
      if (action === 'pack-remove-rule') {
        if (editor.ruleRemovalUndo[ruleKey]) return;
        editor.ruleRemovalUndo[ruleKey] = { priorEdit: editor.edits[upsertKey] || null,
          priorEditor: editor.combinationEditor?.key === ruleKey ? structuredClone(editor.combinationEditor) : null };
        delete editor.edits[upsertKey]; editor.edits[removeKey] = remove;
        if (editor.combinationEditor?.key === ruleKey) editor.combinationEditor = null;
      } else {
        const undo = editor.ruleRemovalUndo[ruleKey]; if (!undo) return;
        delete editor.edits[removeKey];
        if (undo.priorEdit) editor.edits[upsertKey] = undo.priorEdit;
        if (undo.priorEditor) editor.combinationEditor = undo.priorEditor;
        delete editor.ruleRemovalUndo[ruleKey];
      }
      editor.dirty = editor.name !== editor.draft.document.metadata.name || Object.keys(editor.edits).length > 0
        || Object.keys(editor.economics || {}).length > 0;
      editor.error = ''; renderCreator(); return;
    }
    if (action === 'pack-confirm-rule-removal') return saveCreatorPack({ allowRuleRemoval: true });
    if (action === 'pack-edit-rules' || action === 'pack-open-rule') {
      const editor = state.packEditor;
      if (!editor || !currentPackEditor(editor) || packSaveFlight || packAssetFlight) return;
      const document = packAuthoringDocument(editor.draft.document);
      const rule = action === 'pack-open-rule' ? document.rules.find(row => row.key === control.dataset.ruleKey) : null;
      if (action === 'pack-open-rule' && !rule) return;
      if (rule && [rule.trigger, ...rule.targets].some(row => row.sourceKey !== null || row.source !== (row.itemKey === null ? 'ANY' : 'BASE'))) {
        editor.error = 'This scoped rule is preserved; editing requires the advanced rule editor.'; renderCreator(); return;
      }
      const key = rule?.key || `pack-rule-${win.crypto.randomUUID()}`;
      const pending = editor.edits?.[JSON.stringify({ kind: 'rule', field: 'upsert-rule', ruleKey: key })];
      editor.combinationEditor = { key, priorEdit: pending ? structuredClone(pending) : null, builder: pending?.value || (rule ? {
        ownerDefinition: [rule.trigger.partKey, rule.trigger.itemKey, rule.trigger.styleKey].filter(Boolean).join('::'),
        type: rule.kind === 'REQUIRE' ? 'requires' : 'excludes', matchMode: rule.targetMode.toLowerCase(),
        definitions: rule.targets.map(row => [row.partKey,row.itemKey,row.styleKey].filter(Boolean).join('::')),
      } : { ownerDefinition: control.dataset.ruleOwner, type: 'excludes', matchMode: 'any', definitions: [] }) };
      editor.visibilityEditor = null; renderCreator(); return;
    }
    if (action === 'pack-rule-cancel') {
      const editor = state.packEditor, rule = editor?.combinationEditor;
      if (!rule || !currentPackEditor(editor) || packSaveFlight || packAssetFlight) return;
      const key = JSON.stringify({ kind: 'rule', field: 'upsert-rule', ruleKey: rule.key });
      editor.edits ||= {};
      if (rule.priorEdit) editor.edits[key] = structuredClone(rule.priorEdit); else delete editor.edits[key];
      editor.combinationEditor = null;
      editor.dirty = editor.name !== editor.draft.document.metadata.name || Object.keys(editor.edits).length > 0
        || Object.keys(editor.economics || {}).length > 0;
      editor.error = ''; renderCreator(); return;
    }
    if (action === 'pack-rule-save') { capturePackRule(); return saveCreatorPack(); }
    if (action === 'pack-edit-visibility') {
      const editor = state.packEditor;
      if (!editor || !currentPackEditor(editor) || packSaveFlight || packAssetFlight) return;
      const document = packAuthoringDocument(editor.draft.document);
      const part = document.parts.find(row => row.key === editor.partKey) || document.parts[0];
      const item = part?.items.find(row => row.key === editor.itemKey) || part?.items[0];
      const style = item?.styles.find(row => row.key === control.dataset.styleKey);
      if (!style) return;
      const edit = { kind: 'style', field: 'style-visibility', partKey: part.key, itemKey: item.key, styleKey: style.key };
      const pending = editor.edits?.[JSON.stringify(edit)];
      editor.visibilityEditor = { partKey: part.key, itemKey: item.key, styleKey: style.key,
        ...(pending?.value || makerV8VisibilityEditorModel(pending ? null : style.visibleWhen, { parts: document.parts })) };
      editor.combinationEditor = null;
      renderCreator(); return;
    }
    if (action === 'pack-visibility-apply' || action === 'pack-visibility-clear') {
      capturePackVisibility({ clear: action === 'pack-visibility-clear' });
      return saveCreatorPack();
    }
    if (action === 'select-pack-part' || action === 'select-pack-item') {
      const editor = state.packEditor;
      if (!editor || !currentPackEditor(editor) || packSaveFlight || packAssetFlight) return;
      if (action === 'select-pack-part') { editor.partKey = control.dataset.partId; editor.itemKey = ''; }
      else editor.itemKey = control.dataset.itemKey;
      editor.styleKey = ''; renderCreator(); void requestPackPreview(); return;
    }
    if (action === 'save-pack') return saveCreatorPack();
    if (action === 'bind-pack-parent') return bindCreatorPackParent();
    if (action === 'request-back-to-maker') {
      const editor = state.packEditor;
      if (editor && await saveCreatorPack() && currentPackEditor(editor)) {
        state.packEditor = null; state.creatorTab = 'expansions'; await loadCreatorPacks();
      }
      return;
    }
    if (action === 'add-expansion') return addCreatorPack();
    if (action === 'apply-style-visibility' || action === 'clear-style-visibility') return commitCreatorVisibility(action, control);
    if (action === 'rules-editor-intent' || action === 'edit-style-visibility') {
      if (!creatorVisibilityEventCurrent(control)) return;
      const editor = creatorVisibilityEditor();
      editor.intent = action === 'edit-style-visibility' || control.dataset.intent === 'visibility' ? 'visibility' : 'availability';
      state.creatorTab = 'rules';
      renderCreator({ focusTool: true }); return;
    }
    if (action === 'remove-maker-cover') return replaceCreatorImage(control, { cover: true, remove: true });
    if (action === 'save-recovery-copy') return saveCreatorRecoveryCopy();
    if (action === 'select-channel') {
      const key = String(control.dataset.channelId || '');
      if ((state.creatorIntentDocument || state.record.document).colors.some(row => row.key === key)) state.selectedColorKey = key;
      renderCreator(); return;
    }
    if (['add-channel', 'delete-channel', 'add-swatch', 'delete-swatch'].includes(action)) {
      return commitCreatorColor(action, control);
    }
    if (action === 'select-track') {
      const key = String(control.dataset.trackId || '');
      if (state.record.document.tracks.some(track => track.key === key)) state.selectedTrackKey = key;
      renderCreator(); return;
    }
    if (action === 'select-style-binding') {
      const part = state.record.document.parts.find(row => row.key === control.dataset.partId);
      const item = part?.items.find(row => row.key === control.dataset.itemId);
      const style = item?.styles.find(row => row.key === control.dataset.styleId);
      if (!style) return;
      creatorStructureRequest += 1;
      state.selectedPartKey = part.key; state.selectedItemKey = item.key; state.selectedStyleKey = style.key;
      state.selectedTrackKey = style.trackKey || ''; state.creatorTab = 'structure';
      renderCreator(); await requestCreatorPreview(); return;
    }
    if (['add-track', 'toggle-track-lock', 'delete-track', 'move-track', 'sync-linked-track-order'].includes(action)) {
      return commitCreatorTrack(action, { trackKey: String(control.dataset.trackId || ''), direction: control.dataset.direction });
    }
    if (action === 'edit-position') {
      const selection = creatorStyleSelection(), { style } = selectedRecords(state.record.document, state);
      if (!style?.assetId || creatorStyleEditorState(style).positionLocked) return;
      state.editingPositionStyleKey = `${selection.partKey}/${selection.itemKey}/${selection.styleKey}`;
      renderCreator(); return;
    }
    if (action === 'confirm-position') return commitCreatorStyle(action);
    if (action === 'set-default-style') return setCreatorDefault(action);
    if (['copy-part', 'copy-item', 'copy-style', 'delete-part', 'delete-item', 'delete-style'].includes(action)) {
      return mutateCreatorStructure(action, control);
    }
    if (['add-part', 'add-item', 'add-style'].includes(action)) return addCreatorStructure(action);
    if (action === 'composable-mode') {
      const mode = String(control.dataset.mode || '');
      if (!['FIXED', 'COMPOSABLE'].includes(mode)) return;
      const current = state.creatorIntentDocument || state.record.document;
      if (current.composition.mode === mode) return;
      await persistReplacement(document => {
        const enabled = mode === 'COMPOSABLE';
        document.composition = { mode, thirdPartyAdmission: enabled ? 'OPEN' : 'DISABLED', itemAssetization: enabled };
        // A single validated CAS keeps FIXED drafts valid without deleting any
        // authored Items, Styles, assets, capacity or default recipe choices.
        if (!enabled) document.parts.forEach(part => { part.wardrobeMode = 'FIXED'; });
        return document;
      });
      return;
    }
    if (action === 'wardrobe-part-mode') {
      const mode = String(control.dataset.mode || '');
      const partKey = String(control.dataset.partId || '');
      const current = state.creatorIntentDocument || state.record.document;
      if (!['FIXED', 'SLOT'].includes(mode) || current.composition.mode !== 'COMPOSABLE') return;
      const part = current.parts.find(row => row.key === partKey);
      if (!part || part.wardrobeMode === mode) return;
      await persistCommand(document => ({ type: 'part.upsert', row: {
        ...document.parts.find(row => row.key === partKey), wardrobeMode: mode,
      } }));
      return;
    }
    if (action === 'select-soul-document') {
      const key = String(control.dataset.soulKey || '');
      if (!MAKER_V8_LIVING_CONTENT_KEYS.includes(key)) return;
      state.selectedSoulDocumentKey = key;
      renderCreator();
    } else if (action === 'reset-soul-document' || action === 'reset-all-soul') {
      const key = String(control.dataset.soulKey || '');
      if (action === 'reset-soul-document' && !MAKER_V8_LIVING_CONTENT_KEYS.includes(key)) return;
      await persistCommand(document => {
        const defaults = createDefaultMakerV8LivingContentV8(document.metadata);
        const livingContent = action === 'reset-all-soul' ? defaults : {
          ...document.livingContent, [key]: defaults[key],
          customized: { ...document.livingContent.customized, [key]: false },
        };
        return { type: 'livingContent.set', livingContent };
      });
    } else if (action === 'edit-selection-rules') {
      if (!creatorRuleEventCurrent()) return;
      const editor = creatorRuleEditor();
      editor.builder.ownerDefinition = String(control.dataset.ruleOwner || [state.selectedPartKey, state.selectedItemKey, state.selectedStyleKey].filter(Boolean).join('::'));
      editor.error = ''; state.creatorTab = 'rules';
      renderCreator({ focusTool: true });
    } else if (action === 'add-rule') {
      if (!creatorRuleEventCurrent()) return;
      const editor = creatorRuleEditor();
      const builder = structuredClone(editor.builder);
      const generation = state.creatorDraftGeneration;
      const connection = creatorConnectionGeneration;
      const current = () => creatorRuleEventCurrent() && generation === state.creatorDraftGeneration
        && connection === creatorConnectionGeneration && state.ruleEditor === editor;
      try {
        await persistCommand(document => {
          let ordinal = 1;
          while (document.rules.some(rule => rule.key === `rule-${ordinal}`)) ordinal += 1;
          const row = makerV8RuleFromBuilder({ ...builder, key: `rule-${ordinal}` });
          return { type: 'rule.upsert', row };
        });
        if (current()) editor.error = '';
      } catch (error) {
        if (current()) editor.error = String(error?.message || 'Rule save failed.');
      }
      renderCreator();
    } else if (action === 'delete-rule') {
      if (!creatorRuleEventCurrent()) return;
      const generation = state.creatorDraftGeneration, connection = creatorConnectionGeneration;
      const editor = creatorRuleEditor();
      try { await persistCommand({ type: 'rule.remove', key: String(control.dataset.ruleId || '') }); }
      catch (error) {
        if (creatorRuleEventCurrent() && generation === state.creatorDraftGeneration
          && connection === creatorConnectionGeneration && state.ruleEditor === editor) {
          editor.error = String(error?.message || 'Rule removal failed.'); renderCreator();
        }
      }
    } else if (action === 'export-project') {
      await exportCreatorProject();
    } else if (action === 'read-composable-upload-history') {
      await loadComposableUploadHistory();
    } else if (action === 'create-composable-product' || action === 'recover-composable-product') {
      await continueComposableUpload(String(control.dataset.uploadId || ''), action === 'create-composable-product' ? 'CREATE_PRODUCT' : 'RECOVER_PRODUCT');
    } else if (action === 'review-composable-upload') {
      await continueComposableUpload(String(control.dataset.uploadId || ''), 'REVIEW');
    } else if (action === 'continue-composable-upload') {
      await continueComposableUpload(String(control.dataset.uploadId || ''), String(control.dataset.uploadAction || ''));
    } else if (action === 'prepare-composable-storage') {
      await prepareExternalArtworkStorage();
    } else if (action === 'save-composable-settings') {
      await saveComposableSettings();
    } else if (action === 'select-composable-part') {
      await selectComposablePart(String(control.dataset.partKey || ''));
    } else if (action === 'refresh-composable-makers' || action === 'inspect-composable-maker') {
      await loadComposableTargets(action === 'inspect-composable-maker' ? String(control.dataset.rootId || '') : null);
    } else if (action === 'review-composable-admission') {
      await reviewAdmission(String(control.dataset.admissionAction || ''));
    } else if (action === 'stage-composable-admission') {
      await itemOperation('stage-admission');
    } else if (action === 'stage-composable-item' || action === 'read-composable-item-operations' || action === 'continue-composable-item') {
      await itemOperation(action === 'stage-composable-item' ? 'stage' : action === 'continue-composable-item' ? 'continue' : 'read', String(control.dataset.requestId || ''), String(control.dataset.mode || ''));
    } else if (action === 'review-composable-product') {
      await reviewControlledItem(String(control.dataset.productId || ''), String(control.dataset.productAction || ''));
    } else if (action === 'review-composable-item') {
      await reviewControlledItem(String(control.dataset.productId || ''));
    } else if (action === 'refresh-composable-products') {
      await loadComposableProducts();
    } else if (action === 'creator-tab') {
      state.creatorTab = String(control.dataset.tab || 'structure');
      renderCreator({ focusTool: state.creatorTab !== 'structure' });
      if (state.creatorTab === 'expansions') await loadCreatorPacks();
    } else if (action === 'close-tool' || action === 'close-tool-backdrop') {
      if (action === 'close-tool-backdrop' && eventTarget !== control) return;
      closeCreatorTool();
    } else if (action === 'select-part') {
      creatorStructureRequest += 1;
      state.selectedPartKey = String(control.dataset.partId || '');
      state.selectedItemKey = '';
      state.selectedStyleKey = '';
      normalizeSelection(state.record.document, state);
      renderCreator();
      await requestCreatorPreview();
    } else if (action === 'select-item') {
      creatorStructureRequest += 1;
      state.selectedItemKey = String(control.dataset.itemId || '');
      state.selectedStyleKey = state.record.document.parts.find(row => row.key === state.selectedPartKey)
        ?.items.find(row => row.key === state.selectedItemKey)?.defaultStyleKey || '';
      normalizeSelection(state.record.document, state);
      renderCreator();
      await requestCreatorPreview();
    } else if (action === 'select-style') {
      creatorStructureRequest += 1;
      state.selectedStyleKey = String(control.dataset.styleId || '');
      normalizeSelection(state.record.document, state);
      renderCreator();
      await requestCreatorPreview();
    } else if (action === 'toggle-part-preview') {
      const key = String(control.dataset.partId || '');
      if (state.hiddenPartKeys.has(key)) state.hiddenPartKeys.delete(key);
      else state.hiddenPartKeys.add(key);
      renderCreator();
    } else if (action === 'move-part') {
      await movePart(String(control.dataset.partId || ''), String(control.dataset.direction || ''));
    } else if (action === 'set-preview-mode') {
      state.previewMode = String(control.dataset.previewMode || 'all');
      renderCreator();
    } else if (action === 'show-all-parts') {
      state.hiddenPartKeys.clear();
      state.previewMode = 'all';
      renderCreator();
    } else if (action === 'show-current-part') {
      state.hiddenPartKeys = new Set(state.record.document.parts
        .map((part) => part.key)
        .filter((key) => key !== state.selectedPartKey));
      state.previewMode = 'solo';
      renderCreator();
    } else if (action === 'toggle-pixel') {
      await persistCommand((document) => {
        const canvas = structuredClone(document.canvas);
        canvas.pixelMode = canvas.pixelMode === 'pixelated' ? 'smooth' : 'pixelated';
        return { type: 'canvas.set', canvas };
      });
    } else if (action === 'undo') {
      await undo();
    } else if (action === 'redo') {
      await redo();
    } else if (action === 'save') {
      if (creatorUncommittedInput()) await submitCreatorInput(creatorInputSession.control);
      await retryCreatorPendingSave();
      if (!creatorUncommittedInput()) clearCreatorValidationError();
    } else if (action === 'open-version-history') {
      state.versionHistoryOpen = true;
      await loadVersionHistory();
    } else if (action === 'retry-version-history') {
      await loadVersionHistory();
    } else if (action === 'close-version-history' || action === 'close-version-history-backdrop') {
      if (action === 'close-version-history-backdrop' && eventTarget !== control) return;
      closeCreatorVersionHistory();
    } else if (action === 'restore-checkpoint') {
      await restoreVersion(Number(control.dataset.revision));
    } else if (action === 'manage-lifecycle') {
      openLifecycleManager();
    } else if (action === 'back-library') {
      await showCreatorLibrary();
    }
  }

  async function handleCreatorChange(control, { input = false } = {}) {
    if (!state.record || control?.disabled || state.projectImportPending || creatorAssetFlight || creatorRecoveryFlight) return;
    invalidatePublicationReview();
    const action = String(control.dataset.action || '');
    if (action === 'part-export-background') {
      if (input || !creatorRuleEventCurrent() || !state.connection.connected || !creatorEditorVisible()
        || control.dataset.reviewDraft !== state.record.draftId
        || control.dataset.creatorGeneration !== String(state.creatorDraftGeneration)
        || control.dataset.partId !== state.selectedPartKey) return;
    }
    if (['channel-name', 'channel-default-swatch', 'swatch-name', 'swatch-hint', 'swatch-mid', 'swatch-stop', 'style-channel'].includes(action)) {
      if (input) return;
      return commitCreatorColor(action, control);
    }
    if (['track-name', 'assign-style-track'].includes(action)) {
      if (input) return;
      return commitCreatorTrack(action, { ...(creatorStyleSelection() || {}), trackKey: control.dataset.trackId,
        value: String(control.value ?? '') });
    }
    if (CREATOR_STYLE_VALUE_ACTIONS.includes(action)) {
      if (input) { if (action === 'style-scale-preview') previewCreatorScale(control); return; }
      cancelCreatorStyleInteraction();
      return commitCreatorStyle(action, ['style-locked', 'style-position-locked'].includes(action) ? control.checked === true : control.value);
    }
    if (action === 'part-default') return setCreatorDefault(action, String(control.value || ''));
    if (action === 'style-asset') return replaceCreatorImage(control);
    if (action === 'maker-cover') return replaceCreatorImage(control, { cover: true });
    if (['part-capacity', 'third-party-admission', 'item-assetization'].includes(action)) {
      const value = String(control.value ?? '');
      const checked = control.checked === true;
      const partKey = String(control.dataset.partId || '');
      if (action === 'part-capacity') {
        const current = state.creatorIntentDocument || state.record.document;
        const capacity = Number(value);
        const valid = /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(capacity) && capacity <= 64;
        if (input && !valid) return;
        if (valid && current.parts.find(part => part.key === partKey)?.capacity === capacity) { clearCreatorValidationError(); return; }
      }
      try {
        await persistCommand(document => {
          if (action === 'part-capacity') {
            if (!/^[1-9][0-9]*$/.test(value)) throw new TypeError('Part capacity must be a whole number from 1 to 64.');
            const row = document.parts.find(part => part.key === partKey);
            if (!row) throw new TypeError('The selected Maker Part no longer exists.');
            return { type: 'part.upsert', row: { ...row, capacity: Number(value) } };
          }
          return { type: 'composition.set', composition: {
            ...document.composition,
            ...(action === 'third-party-admission' ? { thirdPartyAdmission: value } : { itemAssetization: checked }),
          } };
        });
      } catch (error) {
        state.saveState = 'error';
        state.saveLabel = String(error?.message || 'Invalid composition setting.');
        if (!input) renderCreator();
      }
      return;
    }
    if (action === 'soul-document-content') {
      const key = String(control.dataset.soulKey || '');
      if (!MAKER_V8_LIVING_CONTENT_KEYS.includes(key)) return;
      const markdown = String(control.value ?? '');
      const current = state.creatorIntentDocument || state.record.document;
      if (current.livingContent[key] === markdown) return;
      await persistCommand(document => ({ type: 'livingContent.set', livingContent: {
        ...document.livingContent, [key]: markdown,
        customized: { ...document.livingContent.customized, [key]: true },
      } }));
      return;
    }
    if (['rule-owner-choice', 'rule-type-choice', 'rule-match-choice', 'rule-target-choice', 'rule-owner-search', 'rule-target-search'].includes(action)) {
      if (!creatorRuleEventCurrent()) return;
      const editor = creatorRuleEditor();
      const value = String(control.value || '');
      if (action === 'rule-owner-choice') editor.builder.ownerDefinition = value;
      else if (action === 'rule-type-choice') editor.builder.type = value;
      else if (action === 'rule-match-choice') editor.builder.matchMode = value;
      else if (action === 'rule-owner-search') editor.ownerQuery = value;
      else if (action === 'rule-target-search') editor.targetQuery = value;
      else editor.builder.definitions = control.checked
        ? [...new Set([...editor.builder.definitions, value])]
        : editor.builder.definitions.filter(definition => definition !== value);
      editor.error = '';
      if (action === 'rule-owner-search' || action === 'rule-target-search') filterCreatorRuleSearch();
      else renderCreator();
      return;
    }
    if (['visibility-match-choice', 'visibility-polarity-choice', 'visibility-target-choice', 'visibility-target-search'].includes(action)) {
      if (!creatorVisibilityEventCurrent(control)) return;
      const editor = creatorVisibilityEditor();
      if (creatorLockedStyleKeys(state.creatorIntentDocument || state.record.document).has(editor.visibilitySubject)) return;
      const value = String(control.value || '');
      if (action === 'visibility-target-search') { editor.visibilityQuery = value; filterCreatorRuleSearch(); return; }
      if (action === 'visibility-match-choice') editor.visibility.logic = value;
      else if (action === 'visibility-polarity-choice') editor.visibility.polarity = value;
      else editor.visibility.definitions = control.checked
        ? [...new Set([...editor.visibility.definitions, value])]
        : editor.visibility.definitions.filter(definition => definition !== value);
      editor.visibility.advanced = false;
      editor.visibilityError = '';
      renderCreator(); return;
    }
    if (action === 'import-project') {
      await importCreatorProject(control);
      return;
    }
    if (action === 'canvas-zoom') {
      state.zoom = Math.min(2, Math.max(0.5, Number(control.value || 100) / 100));
      renderCreator();
      return;
    }
    if (['maker-name', 'maker-summary', 'maker-license-kind', 'maker-license-note', 'maker-creator', 'maker-style'].includes(action)) {
      const value = String(control.value || '');
      await persistCommand((document) => {
        const metadata = structuredClone(document.metadata);
        if (action === 'maker-name') metadata.name = value.trim() || metadata.name;
        else if (action === 'maker-summary') metadata.summary = value;
        else if (action === 'maker-creator' || action === 'maker-style') {
          const key = action === 'maker-creator' ? 'creator' : 'style';
          if (value) metadata[key] = value; else delete metadata[key];
        }
        else if (action === 'maker-license-kind') metadata.license.kind = value;
        else metadata.license.note = value;
        return { type: 'metadata.set', metadata };
      });
      return;
    }
    const selectedPartKey = state.selectedPartKey;
    const selectedItemKey = state.selectedItemKey;
    const selectedStyleKey = state.selectedStyleKey;
    const value = String(control.value || '');
    const checkedValue = control.checked === true;
    const { part } = selectedRecords(state.record.document, state);
    if (!part) return;
    if (!['part-name', 'part-required', 'part-visible', 'part-export-background', 'item-name', 'style-name'].includes(action)) return;
    await persistCommand((document) => {
      const currentPart = document.parts.find((candidate) => candidate.key === selectedPartKey);
      if (!currentPart) throw new TypeError('The selected Maker Part no longer exists.');
      const nextPart = structuredClone(currentPart);
      if (action === 'part-name') nextPart.label = value.trim() || currentPart.label;
      else if (action === 'part-required') nextPart.required = checkedValue;
      else if (action === 'part-visible') nextPart.visible = checkedValue;
      else if (action === 'part-export-background') nextPart.exportBackground = checkedValue;
      else if (action === 'item-name') {
        const target = nextPart.items.find((candidate) => candidate.key === selectedItemKey);
        if (!target) throw new TypeError('The selected Maker Item no longer exists.');
        target.label = value.trim() || target.label;
      } else {
        const targetItem = nextPart.items.find((candidate) => candidate.key === selectedItemKey);
        const targetStyle = targetItem?.styles.find((candidate) => candidate.key === selectedStyleKey);
        if (!targetStyle) throw new TypeError('The selected Maker Style no longer exists.');
        if (creatorStyleEditorState(targetStyle).styleLocked) throw new TypeError('Unlock the whole Style before editing it.');
        targetStyle.label = value.trim() || targetStyle.label;
      }
      return { type: 'part.upsert', row: nextPart };
    });
  }

  listen(byId('themeButton'), 'click', () => {
    if (themeMenuOpen()) closeTheme();
    else openTheme();
  });
  listen(byId('themeButton'), 'keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    openTheme();
  });
  listen(byId('themeMenu'), 'click', (event) => {
    const option = event.target?.closest?.('[data-theme-option]');
    if (!option) return;
    const preference = THEME_IDS.includes(option.dataset.themeOption)
      ? option.dataset.themeOption : 'auto';
    win.ANIMACRAFT_THEME?.setPreference?.(preference);
    renderTheme();
    closeTheme();
  });
  listen(byId('themeMenu'), 'keydown', (event) => {
    const options = [...(byId('themeMenu')?.querySelectorAll?.('[role="menuitemradio"]') || [])];
    if (event.key === 'Escape') {
      event.preventDefault();
      closeTheme();
      return;
    }
    if (event.key === 'Tab') {
      closeTheme({ returnFocus: false });
      return;
    }
    if (!options.length || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = Math.max(0, options.indexOf(doc.activeElement));
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? options.length - 1
        : event.key === 'ArrowDown' ? (current + 1) % options.length
          : (current - 1 + options.length) % options.length;
    options[next].focus?.({ preventScroll: true });
  });
  listen(byId('accountButton'), 'click', () => {
    if (byId('accountPanel')?.classList?.contains('active')) closeAccount();
    else openAccount();
  });
  listen(byId('closeAccountPanel'), 'click', closeAccount);
  listen(byId('accountLanguage'), 'change', (event) => {
    setLocale(event.target?.value);
  });
  for (const id of [
    'soulidityMySoulsLink',
    'soulidityProfileLink',
    'soulidityCommunityLink',
    'soulidityMarketLink',
  ]) {
    const link = byId(id);
    listen(link, 'click', (event) => {
      if (link?.getAttribute?.('aria-disabled') === 'true') event.preventDefault();
    });
  }
  listen(byId('templateDetailBack'), 'click', () => {
    navigate('templates');
    renderTemplateCards();
  });
  listen(byId('templateSearch'), 'input', (event) => {
    state.search = String(event.target?.value || '');
    renderTemplateCards();
  });
  doc.querySelectorAll?.('[data-filter]').forEach((button) => {
    listen(button, 'click', () => {
      state.filter = ['all', 'daily', 'fantasy', 'chibi'].includes(button.dataset.filter)
        ? button.dataset.filter : 'all';
      doc.querySelectorAll?.('[data-filter]').forEach((candidate) => {
        candidate.classList?.toggle('active', candidate === button);
      });
      renderTemplateCards();
    });
  });
  listen(byId('refreshMakers'), 'click', () => {
    void refreshTemplates();
  });
  listen(byId('imageMakerList'), 'click', (event) => {
    const preview = event.target?.closest?.('[data-preview-maker]');
    if (preview) {
      if (!preview.disabled) return previewLibraryDraft(String(preview.dataset.previewMaker || ''));
      return;
    }
    const edit = event.target?.closest?.('[data-edit-maker]');
    const manage = event.target?.closest?.('[data-manage-lifecycle]');
    const draftId = edit?.dataset?.editMaker || manage?.dataset?.manageLifecycle || '';
    if (!draftId) return;
    void openDraft(draftId).then((record) => {
      if (manage && record) openLifecycleManager();
    }).catch(() => {});
  });
  doc.querySelectorAll?.('[data-new-maker-panel]').forEach((button) => {
    listen(button, 'click', openMakerRegistration);
  });
  doc.querySelectorAll?.('[data-close-maker-modal]').forEach((button) => {
    listen(button, 'click', closeMakerRegistration);
  });
  doc.querySelectorAll?.('[data-canvas-choice]').forEach((button) => {
    listen(button, 'click', () => {
      doc.querySelectorAll?.('[data-canvas-choice]').forEach((candidate) => {
        candidate.classList?.toggle('active', candidate === button);
      });
    });
  });
  doc.querySelectorAll?.('[data-maker-start]').forEach((button) => {
    listen(button, 'click', () => {
      doc.querySelectorAll?.('[data-maker-start]').forEach((candidate) => {
        candidate.classList?.toggle('active', candidate === button);
      });
    });
  });
  listen(byId('registerMaker'), 'click', () => {
    void registerMakerDraft().catch(() => {});
  });
  listen(byId('newMakerName'), 'input', clearMakerRegistrationError);
  listen(byId('makerRegistrationModal'), 'click', (event) => {
    if (event.target === byId('makerRegistrationModal')) closeMakerRegistration();
  });
  listen(byId('openDraftRecovery'), 'click', openDraftRecoveryCenter);
  listen(byId('rescanDraftRecovery'), 'click', () => {
    void refreshDraftRecovery();
  });
  doc.querySelectorAll?.('[data-close-draft-recovery]').forEach((button) => {
    listen(button, 'click', closeDraftRecoveryCenter);
  });
  listen(byId('draftRecoveryModal'), 'click', (event) => {
    if (event.target === byId('draftRecoveryModal')) closeDraftRecoveryCenter();
  });
  listen(byId('draftRecoveryList'), 'click', (event) => {
    const button = event.target?.closest?.('[data-recovery-action]');
    if (!button || button.disabled || button.dataset.recoveryAction !== 'restore') return;
    void openDraft(String(button.dataset.recoveryId || '')).then((record) => {
      if (record) closeDraftRecoveryCenter();
    }).catch((error) => {
      if (byId('draftRecoveryStatus')) {
        byId('draftRecoveryStatus').textContent = String(error?.message || 'Draft recovery failed.');
      }
    });
  });
  listen(byId('backToMakerList'), 'click', showCreatorLibrary);
  listen(byId('templateGrid'), 'click', (event) => {
    const create = event.target?.closest?.('[data-create-first-maker]');
    if (create) {
      void (async () => {
        if (!state.connection.connected) {
          await openWalletSelector();
          refreshConnection();
        }
        if (state.connection.connected) navigate('creator');
      })().catch(() => {});
      return;
    }
    const use = event.target?.closest?.('[data-use-template]');
    const view = event.target?.closest?.('[data-view-template]');
    const card = event.target?.closest?.('.template-card');
    const templateId = use?.dataset.useTemplate
      || view?.dataset.viewTemplate
      || card?.dataset.template;
    if (!templateId) return;
    if (use) {
      event.stopPropagation?.();
      void (async () => {
        if (!state.connection.connected) {
          await openWalletSelector();
          refreshConnection();
        }
        if (!state.connection.connected) return;
        const detail = await openTemplateDetail(templateId);
        if (detail) await startPlayerSession(templateId);
      })().catch(() => {});
      return;
    }
    event.stopPropagation?.();
    void openTemplateDetail(templateId);
  });
  listen(byId('templateDetail'), 'click', (event) => {
    if (!event.target?.closest?.('[data-detail-start]')) return;
    void (async () => {
      if (!state.connection.connected) {
        await openWalletSelector();
        refreshConnection();
      }
      if (state.connection.connected && state.templateDetailStatus === 'ready') {
        await startPlayerSession(state.templateId);
      }
    })().catch(() => {});
  });
  for (const id of ['walletButton', 'panelWalletButton', 'creatorGateWalletButton']) {
    listen(byId(id), 'click', async () => {
      await openWalletSelector();
      refreshConnection();
    });
  }
  listen(doc, 'click', (event) => {
    if (themeMenuOpen() && !event.target?.closest?.('.theme-control')) closeTheme();
    const pageButton = event.target?.closest?.('[data-page]');
    if (pageButton && !pageButton.disabled) navigate(pageButton.dataset.page);
  });
  listen(doc, 'keydown', (event) => {
    if ((event.code === 'Space' || event.key === ' ') && !event.defaultPrevented
      && !event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) {
      creatorSpacePressed = true;
      if (creatorPositionGesture) cancelCreatorStyleInteraction({ redraw: true });
      return;
    }
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (creatorSortDrag) { creatorSortDrag = null; event.preventDefault(); return; }
    if (creatorPositionGesture || state.creatorStylePreview) {
      cancelCreatorStyleInteraction({ redraw: true }); event.preventDefault(); return;
    }
    const creatorVisible = creatorEditorVisible();
    // Follow the approved stacking order; one key must never dismiss both
    // a nested overlay and the surface beneath it.
    if (byId('makerLifecycleManagerModal')?.classList?.contains('active')) closeLifecycleManager();
    else if (creatorVisible && state.publicationReview && !state.publicationHidden) closePublication();
    else if (creatorVisible && state.versionHistoryOpen) closeCreatorVersionHistory();
    else if (creatorVisible && state.creatorTab !== 'structure') closeCreatorTool();
    else if (themeMenuOpen()) closeTheme();
    else if (byId('accountPanel')?.classList?.contains('active')) closeAccount();
    else if (byId('draftRecoveryModal')?.classList?.contains('active')) closeDraftRecoveryCenter();
    else if (byId('makerRegistrationModal')?.classList?.contains('active')) closeMakerRegistration();
    else return;
    event.preventDefault();
  });
  listen(doc, 'keyup', (event) => {
    if (event.code === 'Space' || event.key === ' ') creatorSpacePressed = false;
  });
  listen(win, 'blur', () => {
    creatorSortDrag = null;
    creatorSpacePressed = false;
    creatorInputPointerHandoff = null;
    cancelCreatorStyleInteraction({ redraw: true });
    if (creatorRenderDeferredForInput) renderCreator();
  });
  doc.querySelectorAll?.('[data-close-maker-lifecycle]').forEach((button) => {
    listen(button, 'click', closeLifecycleManager);
  });
  listen(byId('makerLifecycleManagerModal'), 'click', (event) => {
    if (event.target === byId('makerLifecycleManagerModal')) {
      closeLifecycleManager();
      return;
    }
    const control = event.target?.closest?.('[data-lifecycle-action]');
    if (!control || control.disabled || control.getAttribute?.('aria-disabled') === 'true') return;
    if (control.dataset.lifecycleAction === 'open-editor') {
      closeLifecycleManager();
      showCreatorEditor();
      renderCreator();
    } else if (control.dataset.lifecycleAction === 'delete-draft') {
      requestDraftDeletion();
    } else if (control.dataset.lifecycleAction === 'cancel-delete-draft') {
      creatorDeleteIntent = null;
      renderDraftDeleteConfirmation();
    } else if (control.dataset.lifecycleAction === 'confirm-delete-draft') {
      void confirmDraftDeletion();
    } else if (control.dataset.lifecycleAction === 'chain-versions') {
      closeLifecycleManager(); state.versionHistoryOpen = true; void loadVersionHistory();
    }
  });
  listen(mount, 'dragstart', (event) => {
    creatorSortDrag = null;
    if (!state.record || !state.connection.connected || state.projectImportPending || creatorAssetFlight
      || creatorRecoveryFlight || creatorDeleteFlight || state.creatorPersistPending || state.creatorPersistBlocked
      || event.target?.closest?.('button, input, select, textarea, a[href], [role="switch"]')) {
      event.preventDefault?.(); return;
    }
    const row = event.target?.closest?.('[data-drag-kind]');
    if (!row || !mount.contains?.(row) || !['part', 'track'].includes(row.dataset.dragKind)) {
      event.preventDefault?.(); return;
    }
    const kind = row.dataset.dragKind, key = row.dataset.dragId;
    if (state.packEditor) {
      const editor = state.packEditor;
      if (!currentPackEditor(editor) || kind !== 'part' || editor.dirty || packSaveFlight || packAssetFlight
        || (editor.draft.document.authoringParent ?? editor.draft.document.bindings.parent).draft.document.parts.some(part => part.key === key)) {
        event.preventDefault?.(); return;
      }
      creatorSortDrag = { kind, key, packEditor: editor, revision: editor.draft.revision };
      if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', key); }
      return;
    }
    if (kind === 'track' && creatorTrackState(state.record.document, key).orderLocked) {
      event.preventDefault?.(); return;
    }
    creatorSortDrag = { kind, key, generation: state.creatorDraftGeneration, draftId: state.record.draftId,
      tab: state.creatorTab, intent: state.creatorPersistIntent,
      connection: creatorConnectionGeneration, navigation: state.localNavigationRequest };
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', key);
    }
  });
  listen(mount, 'dragover', (event) => {
    const row = event.target?.closest?.('[data-drag-kind]');
    if (!creatorSortDrag || row?.dataset.dragKind !== creatorSortDrag.kind) return;
    event.preventDefault?.();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  });
  listen(mount, 'drop', (event) => {
    const drag = creatorSortDrag; creatorSortDrag = null;
    const row = event.target?.closest?.('[data-drag-kind]');
    if (!drag || !row || !mount.contains?.(row) || row.dataset.dragKind !== drag.kind) return;
    event.preventDefault?.();
    if (drag.packEditor || state.packEditor) {
      const editor = drag.packEditor;
      if (!editor || state.packEditor !== editor || !currentPackEditor(editor) || editor.dirty
        || packSaveFlight || packAssetFlight || editor.draft.revision !== drag.revision || row.dataset.dragId === drag.key) return;
      void addPackStructure('move-part', undefined, undefined, { partKey: drag.key, targetKey: row.dataset.dragId });
      return;
    }
    if (!creatorDraftCurrent(drag.generation, drag.draftId) || drag.tab !== state.creatorTab
      || drag.connection !== creatorConnectionGeneration || drag.navigation !== state.localNavigationRequest
      || drag.intent !== state.creatorPersistIntent || !creatorEditorVisible()) return;
    void commitCreatorTrack(`move-${drag.kind}`, {
      [drag.kind === 'part' ? 'partKey' : 'trackKey']: drag.key, targetKey: row.dataset.dragId,
    });
  });
  listen(mount, 'dragend', () => { creatorSortDrag = null; });
  listen(mount, 'click', (event) => {
    creatorInputPointerHandoff = null;
    const control = event.target?.closest?.('[data-action]');
    if (!control || !mount.contains?.(control)) return;
    void handleCreatorAction(String(control.dataset.action || ''), control, event.target).catch(() => {}).finally(() => {
      if (!state.destroyed && creatorRenderDeferredForInput) renderCreator();
    });
  });
  listen(mount, 'pointerdown', (event) => {
    const control = event.target?.closest?.('[data-action]');
    if (creatorInputSession && control && !control.disabled && event.button === 0) {
      creatorInputPointerHandoff = { control, pointerId: event.pointerId, generation: state.creatorDraftGeneration,
        tab: state.creatorTab,
        selection: JSON.stringify(creatorStyleSelection()) };
    }
    beginCreatorPositionGesture(event);
  });
  const cancelCreatorInputHandoff = () => {
    creatorInputPointerHandoff = null;
    if (creatorRenderDeferredForInput) renderCreator();
  };
  listen(doc, 'pointerup', (event) => {
    if (creatorInputPointerHandoff?.pointerId === event.pointerId
      && creatorInputPointerHandoff && !creatorInputPointerHandoff.control.contains?.(event.target)) cancelCreatorInputHandoff();
  });
  listen(doc, 'pointercancel', cancelCreatorInputHandoff);
  listen(mount, 'focusin', (event) => {
    const control = event.target;
    if (state.record && creatorBufferedInputActions.has(control?.dataset?.action)) {
      creatorInputSession = { control, generation: state.creatorDraftGeneration,
        tab: state.creatorTab, submittedValue: String(control.value),
        selection: JSON.stringify(creatorStyleSelection()) };
    }
  });
  listen(mount, 'toggle', (event) => {
    const details = event.target, key = details?.dataset?.creatorGradient;
    if (details?.tagName !== 'DETAILS' || !key || !mount.contains?.(details) || !state.record
      || Number(details.dataset.creatorGeneration) !== state.creatorDraftGeneration) return;
    // Disclosure state is local UI only, never part of the authored document.
    const document = state.creatorIntentDocument || state.record.document;
    if (!document.colors.some(channel => channel.swatches.some(swatch => JSON.stringify([channel.key, swatch.key]) === key))) return;
    if (details.open) state.creatorOpenGradients.add(key);
    else state.creatorOpenGradients.delete(key);
  }, true);
  listen(mount, 'focusout', (event) => {
    if (creatorInputSession?.control !== event.target) return;
    // Paste/autofill can update an input without a native change before blur.
    // Capture its value before releasing the session or closing its tool. An
    // already-submitted change is deduplicated by submittedValue.
    if (creatorUncommittedInput()) void submitCreatorInput(event.target).catch(() => {});
    creatorInputSession = null;
    // A pointer's focusout precedes its click. Keep that action target alive;
    // its click/change handler will flush after accepting the user intent.
    if (mount.contains?.(event.relatedTarget) && event.relatedTarget?.closest?.('[data-action]')) return;
    void Promise.resolve().then(() => {
      if (!state.destroyed && creatorRenderDeferredForInput) renderCreator();
    });
  });
  listen(mount, 'pointermove', moveCreatorPositionGesture);
  listen(mount, 'pointerup', finishCreatorPositionGesture);
  listen(mount, 'pointercancel', finishCreatorPositionGesture);
  listen(mount, 'lostpointercapture', (event) => {
    if (creatorPositionGesture?.pointerId === event.pointerId) cancelCreatorStyleInteraction({ redraw: true });
  });
  listen(mount, 'change', (event) => {
    const control = event.target?.closest?.('[data-action]');
    if (!control || !mount.contains?.(control)) return;
    if (control.dataset.action === 'composable-artwork') { void saveComposableArtwork(control); return; }
    if (control.dataset.action === 'composable-product-setting') { captureComposableSetting(control); return; }
    if (control.dataset.action === 'admission-product-id') {
      state.composableAdmission = { address: state.connection.address, rootId: state.composableTargets?.target?.rootId,
        productId: String(control.value || '').trim(), review: null, busy: false, error: '' }; renderCreator(); return;
    }
    if (control.dataset.action === 'product-control-recipient') {
      state.composableInventory = { ...state.composableInventory, itemReview: null,
        recipients: { ...state.composableInventory?.recipients, [control.dataset.productId]: String(control.value || '').trim() } }; renderCreator(); return;
    }
    if (control.dataset.action === 'pack-style-png') { void uploadPackStyle(control); return; }
    if (control.dataset.action === 'pack-property') { capturePackProperty(control); return; }
    if (control.dataset.action === 'pack-economics') { capturePackEconomics(control); return; }
    if (['pack-rule-target', 'pack-rule-type', 'pack-rule-match'].includes(control.dataset.action)) {
      const editor = state.packEditor, rule = editor?.combinationEditor;
      if (!rule || !currentPackEditor(editor) || packSaveFlight || packAssetFlight) return;
      if (control.dataset.action === 'pack-rule-target') rule.builder.definitions = control.checked
        ? [...new Set([...rule.builder.definitions, control.value])] : rule.builder.definitions.filter(value => value !== control.value);
      else if (control.dataset.action === 'pack-rule-type') {
        rule.builder.type = control.value; if (control.value === 'excludes') rule.builder.matchMode = 'any';
      } else rule.builder.matchMode = control.value;
      capturePackRule(); renderCreator(); return;
    }
    if (['pack-visibility-target', 'pack-visibility-logic', 'pack-visibility-polarity'].includes(control.dataset.action)) {
      const editor = state.packEditor, visibility = editor?.visibilityEditor;
      if (!visibility || visibility.advanced || !currentPackEditor(editor) || packSaveFlight || packAssetFlight) return;
      if (control.dataset.action === 'pack-visibility-target') visibility.definitions = control.checked
        ? [...new Set([...visibility.definitions, control.value])] : visibility.definitions.filter(value => value !== control.value);
      else visibility[control.dataset.action === 'pack-visibility-logic' ? 'logic' : 'polarity'] = control.value;
      capturePackVisibility(); renderCreator(); return;
    }
    void submitCreatorInput(control).catch(() => {});
  });
  listen(mount, 'input', (event) => {
    if (event.target?.dataset?.action === 'composable-product-setting') { captureComposableSetting(event.target); return; }
    if (event.target?.dataset?.action === 'pack-property') { capturePackProperty(event.target); return; }
    if (event.target?.dataset?.action === 'pack-economics') { capturePackEconomics(event.target); return; }
    if (event.target?.dataset?.action === 'pack-parent-root' && state.packEditor
      && currentPackEditor(state.packEditor) && !packSaveFlight && !packAssetFlight) {
      state.packEditor.parentRootInput = String(event.target.value);
    }
    if (event.target?.dataset?.action === 'pack-name' && state.packEditor
      && currentPackEditor(state.packEditor) && !packSaveFlight && !packAssetFlight) {
      state.packEditor.name = String(event.target.value);
      state.packEditor.dirty = state.packEditor.name !== state.packEditor.draft.document.metadata.name
        || Object.keys(state.packEditor.edits || {}).length > 0 || Object.keys(state.packEditor.economics || {}).length > 0;
      state.packEditor.error = '';
      const label = mount.querySelector?.('.v4-save-indicator span');
      if (label) label.textContent = makerWorkspaceText(state.locale, state.packEditor.dirty ? 'packUnsaved' : 'packSaved');
      return;
    }
    const control = event.target?.closest?.('[data-action]');
    if (creatorInputSession?.control === control) { renderCreator(); return; }
    if (event.isComposing || !control || !mount.contains?.(control)
      || !['rule-owner-search', 'rule-target-search', 'visibility-target-search', 'soul-document-content', 'part-capacity', 'style-scale-preview'].includes(control.dataset.action)) return;
    void handleCreatorChange(control, { input: true }).catch(() => {});
  });
  listen(mount, 'compositionstart', (event) => {
    if (event.target?.dataset?.action === 'soul-document-content' && mount.contains?.(event.target)) creatorComposition = event.target;
  });
  listen(mount, 'compositionend', (event) => {
    if (event.target !== creatorComposition) return;
    creatorComposition = null;
    void handleCreatorChange(event.target).finally(() => renderCreator()).catch(() => {});
  });
  listen(playerMount, 'click', (event) => {
    const control = event.target?.closest?.('[data-action]');
    if (!control || !playerMount.contains?.(control)) return;
    if (control.dataset.action === 'player-expansion-v8') return;
    return handlePlayerAction(String(control.dataset.action || ''), control, event.target).catch(() => {});
  });
  listen(playerMount, 'change', (event) => {
    const control = event.target?.closest?.('[data-action]');
    if (!control || !playerMount.contains?.(control)) return;
    if (!state.localPlayer && control.dataset.action === 'player-import-envelope-recovery') {
      return importEnvelopeRecovery(control);
    }
    if (!state.localPlayer && control.dataset.action === 'player-expansion-v8') {
      return handlePlayerAction('player-expansion-v8', control).catch(() => {});
    }
    if (state.localPlayer) {
      if (control.disabled) return;
      return state.localPlayer.dispatch(String(control.dataset.action || ''), {
        ...control.dataset, value: control.value,
      }).catch(() => {});
    }
    return updatePlayerProfile(control);
  });
  listen(playerMount, 'input', (event) => {
    if (!state.localPlayer || event.isComposing) return;
    const control = event.target?.closest?.('[data-action]');
    if (!control || control.disabled || !playerMount.contains?.(control)
      || !(control.dataset.action?.startsWith('player-profile-') || control.dataset.action === 'player-soul-document')) return;
    return state.localPlayer.dispatch(control.dataset.action, { ...control.dataset, value: control.value }).catch(() => {});
  });
  listen(playerMount, 'compositionstart', (event) => {
    const action = event.target?.dataset?.action;
    if (state.localPlayer && playerMount.contains?.(event.target)
      && (action?.startsWith('player-profile-') || action === 'player-soul-document')) playerComposition = event.target;
  });
  listen(playerMount, 'compositionend', (event) => {
    if (event.target !== playerComposition) return;
    playerComposition = null;
    const control = event.target;
    if (state.localPlayer && playerMount.contains?.(control)) {
      return state.localPlayer.dispatch(control.dataset.action, { ...control.dataset, value: control.value })
        .finally(() => renderPlayer()).catch(() => {});
    }
  });
  listen(byId('backToCreatorPreview'), 'click', async () => {
    if (!state.localPlayer) return;
    const controls = state.localPlayer;
    try { await controls.flush(); } catch { return; }
    if (state.localPlayer !== controls || state.destroyed) return;
    closeLocalPlayer();
    showCreatorEditor();
    navigate('creator');
    renderCreator();
    renderConnection();
  });
  listen(win, 'hashchange', syncBrowserLocation);
  listen(win, 'beforeunload', (event) => {
    if (!state.localPlayer?.hasUnsavedChanges() && !creatorHasPendingChanges()
      && !state.projectImportPending && !creatorAssetFlight) return;
    event.preventDefault?.();
    event.returnValue = '';
  });
  listen(win, 'popstate', syncBrowserLocation);
  listen(win, 'focus', renderTheme);
  listen(win, 'pageshow', renderTheme);
  listen(win, 'storage', (event) => {
    return observePlayerProjectStorage(event);
  });

  const walletSubscribe = optionalMethod(walletUi, 'subscribe');
  if (walletSubscribe) {
    const unsubscribe = walletSubscribe((next) => refreshConnection(next));
    if (typeof unsubscribe === 'function') cleanups.push(unsubscribe);
  }

  const unsubscribeBridge = bridgeSubscribe((next) => {
    if (state.destroyed) return;
    state.bridgeState = next && typeof next === 'object' ? next : null;
    const issue = state.bridgeState?.runtime?.issue;
    if (state.bridgeState?.runtime?.status === 'ERROR' && state.templatesStatus === 'loading') {
      state.templatesStatus = 'error';
      state.templatesError = String(issue?.message || 'The certified Fresh-v8 runtime is unavailable.');
      renderTemplateCards();
    }
    renderBridgeState();
    if (state.publicationReview) renderCreator();
  });
  if (typeof unsubscribeBridge === 'function') cleanups.push(unsubscribeBridge);

  const localReady = (async () => {
    renderTheme();
    refreshConnection();
    setLocale(state.locale, { persist: false });
    navigate(state.route, { replace: false, preserveStartupCreator: true });
    const generation = state.creatorDraftGeneration;
    const drafts = await refreshDrafts();
    if (state.destroyed) return null;
    if (!state.record && drafts.length && generation === state.creatorDraftGeneration) {
      installCreatorRecord(drafts[0]);
      normalizeSelection(state.record.document, state);
      renderCreator();
    }
    renderCreatorLibrary();
    return state.record;
  })();

  const remoteReady = (async () => {
    try {
      await bridgeReady();
    } catch (error) {
      if (state.destroyed) return;
      state.templatesStatus = 'error';
      state.templatesError = String(error?.message || 'The certified Fresh-v8 runtime is unavailable.');
      renderTemplateCards();
      renderBridgeState();
      return;
    }
    if (state.destroyed) return;
    await refreshTemplates();
    if (state.destroyed) return;
    if (state.route === 'template' && state.templateId) {
      await openTemplateDetail(state.templateId, { updatePath: false });
    }
  })();
  const ready = Promise.all([localReady, remoteReady])
    .then(() => state.destroyed ? null : state.record);

  return Object.freeze({
    ready,
    localReady,
    getState() {
      return Object.freeze({
        route: state.route,
        locale: state.locale,
        connection: state.connection,
        bridgeStatus: state.bridgeState?.runtime?.status || null,
        templatesStatus: state.templatesStatus,
        templateCount: state.templates.length,
        templateId: state.templateId || null,
        templateDetailStatus: state.templateDetailStatus,
        playerStatus: state.playerStatus,
        playerRootId: state.playerSession?.rootId || null,
        playerError: state.playerError || null,
        draftsStatus: state.draftsStatus,
        draftsError: state.draftsError || null,
        draftId: state.record?.draftId || null,
        revision: state.record?.revision || null,
        creatorTab: state.creatorTab,
      });
    },
    navigate,
    setLocale,
    refreshTemplates,
    openTemplate: openTemplateDetail,
    openPlayer: startPlayerSession,
    openLocalPlayer: startLocalPlayer,
    openDraft,
    refreshConnection,
    async disconnect() {
      await disconnectWallet();
      return refreshConnection();
    },
    destroy() {
      composableArtworkStore.close();
      if (state.destroyed) return Promise.allSettled([...state.localPlayerDrains]);
      cancelCreatorStyleInteraction();
      cancelPlayerCompletion();
      state.destroyed = true;
      closeLocalPlayer();
      state.templateRefresh += 1;
      state.templateDetailRequest += 1;
      state.playerRequest += 1;
      state.playerMutationRequest += 1;
      state.playerRecipeMutationTicket += 1;
      state.playerRecipeMutationPending = 0;
      state.playerRenderRequest += 1;
      state.playerProjectGeneration += 1;
      state.playerMutationQueue = Promise.resolve();
      state.playerProjectSaveQueue = Promise.resolve();
      state.playerProjectSaveTail = null;
      state.playerPendingProjectSave = null;
      state.playerProjectBaseRevision = null;
      state.playerProjectBaseHash = '';
      state.playerProjectBaseWriterId = '';
      state.playerCompletionFlight = null;
      state.playerPendingRootId = '';
      state.draftListRequest += 1;
      state.draftOpenRequest += 1;
      state.draftRecoveryRequest += 1;
      state.creatorRenderRequest += 1;
      state.creatorDraftGeneration += 1;
      state.creatorPersistQueue = Promise.resolve();
      state.creatorPendingSave = null;
      state.templateDetails.clear();
      state.templateCoverUrls.clear();
      state.templateDetailCoverUrl = '';
      state.playerSession = null;
      state.playerUi = null;
      state.playerAssetUrls = {};
      state.playerRenderRecord = null;
      state.creatorRenderRecord = null;
      state.creatorRenderIdentity = '';
      releasePlayerExportUrl();
      releaseDraftAssetUrls();
      releaseDraftCoverUrls();
      state.playerStatus = 'idle';
      state.playerError = '';
      cleanups.splice(0).reverse().forEach((cleanup) => {
        try { cleanup(); } catch { /* Local UI cleanup is best-effort. */ }
      });
      return Promise.allSettled([...state.localPlayerDrains]);
    },
  });
}
