export const DOCS_VERSION = '0.9.0';

export const DOCS_LOCALES = Object.freeze(['en', 'zh', 'ja', 'ko', 'vi']);

export const DOCS_CONTENT = {
  en: {
    ui: {
      searchPlaceholder: 'Search the Animacraft guide',
      noResults: 'No matching topics. Try a Part, Smart Color, Walrus, or Sui keyword.',
      updatedLabel: 'Documentation',
      readLabel: 'Read guide',
      previous: 'Previous',
      next: 'Next',
      allTopics: 'All topics',
      backToHome: 'Back to all guides',
      onThisPage: 'On this page',
    },
    categories: [
      { id: 'start', title: 'Start here', description: 'Understand Animacraft and choose the path for your role.' },
      { id: 'player', title: 'Make an OC', description: 'Choose artwork, color it, and prepare your OC package.' },
      { id: 'creator', title: 'Build a Maker', description: 'Prepare aligned artwork and author a production-ready Maker.' },
      { id: 'publish', title: 'Test and publish', description: 'Validate, store, publish, and manage immutable releases.' },
      { id: 'reference', title: 'Reference', description: 'Know what is local, on Walrus, on Sui, or still gated.' },
    ],
    articles: [
      {
        id: 'introduction',
        category: 'start',
        title: 'What is Animacraft?',
        summary: 'The creation layer for reusable character Makers and Soul-ready OCs.',
        sections: [
          {
            title: 'One Maker, many OCs',
            paragraphs: [
              'Animacraft is a backendless character Maker editor. Creators assemble reusable Part, Item, and Style choices from PNG artwork; players combine those choices into an OC.',
              'Walrus stores the immutable creative package and full Maker manifest. Sui records Maker provenance, ownership, publication state, economics, and the equivalent compiled Sui v2 rule projection.',
            ],
            bullets: [
              'Creator Studio authors and tests the Maker.',
              'Player Editor selects artwork, Smart Color presets, and Soul content.',
              'Soulidity is the canonical destination for the finished Soul; Animacraft does not mint a competing character token.',
            ],
          },
          {
            title: 'Current production boundary',
            paragraphs: [
              'Maker publication to Walrus and Sui Mainnet is available. The dedicated Canonical Soul Mainnet handoff remains fail-closed until the reviewed Soulidity adapter and shared fee objects are enabled.',
            ],
            note: 'Until that gate opens, describe Complete OC as preparing and preserving the OC package, not as proof that a canonical Soul was minted.',
          },
        ],
      },
      {
        id: 'player-quick-start',
        category: 'player',
        title: 'Player quick start',
        summary: 'Choose a verified Maker, make an OC, and export the result.',
        sections: [
          {
            title: 'Create your look',
            bullets: [
              'Connect the requested Sui wallet, choose a verified Maker, and open Make OC.',
              'Choose a Part across the top, then choose an Item card. If the Item has multiple Styles, choose the small Style variant.',
              'Use Palette only when the creator linked visible Styles to Smart Color channels.',
              'Use Undo, Redo, Random, Remove optional, and Reset to explore without losing control.',
              'Disabled or hidden choices are intentional results of the Maker Rules.',
            ],
          },
          {
            title: 'Finish the OC',
            bullets: [
              'Fill the OC name, world, description, and tags.',
              'Review or edit Personality & identity, Memory, and Skills inherited from the Maker.',
              'Standard PNG export never enlarges the Canvas and limits its longest edge to 1,024 px. Original-size export is offered only when the Canvas is at most 8,388,608 pixels.',
              'Transparent export removes only Parts explicitly marked as export-background; it is not subject cutout. JPEG, WebP, and custom-size export are not provided.',
              'Complete OC preserves the Recipe and Soul-ready content for the handoff flow.',
            ],
            note: 'The Canonical Soul Mainnet gate is currently disabled. A prepared OC is not yet a canonical Soul mint.',
          },
        ],
      },
      {
        id: 'creator-quick-start',
        category: 'creator',
        title: 'Creator quick start',
        summary: 'Build the smallest valid Maker and take it through Player test.',
        sections: [
          {
            title: 'Author the first playable version',
            bullets: [
              'Create a Maker draft and complete its title, description, cover, creator identity, canvas, and license snapshot.',
              'Add a Part, add an Item inside it, and upload the default Style PNG.',
              'Repeat for the minimum set of choices, then order the Layer Tracks from back to front.',
              'Add Smart Color and Rules only where the artwork needs them.',
              'Configure the default soul.md, memory.md, and SKILL.md content.',
            ],
          },
          {
            title: 'Prove it works before release',
            bullets: [
              'Save, open Player test, and try normal selection, Random, Reset, colors, and export.',
              'Run Preflight and resolve every blocking issue.',
              'Publish through Prepare Quilt, Register & upload, Certify Walrus, and Publish on Sui.',
            ],
            note: 'A local draft is editable. A published release is immutable; later edits must become a version draft and a new publication.',
          },
        ],
      },
      {
        id: 'data-model',
        category: 'creator',
        title: 'Maker data model',
        summary: 'Understand Maker → Part → Item → Style before importing artwork.',
        sections: [
          {
            title: 'The four authoring levels',
            bullets: [
              'Maker: the complete reusable template, metadata, canvas, rules, Soul defaults, and release settings.',
              'Part: a player menu category such as Background, Skin, Eyes, or Front Hair.',
              'Item: a clickable choice inside one Part, such as Long Hair.',
              'Style: the smallest render unit. One Style owns exactly one PNG and its transform, appearance, rules, locks, Layer Track, and optional Smart Color link.',
            ],
          },
          {
            title: 'Independent identity and ordering',
            paragraphs: [
              'Part menu order controls how players browse. Layer Track order controls only visual z-order. Reordering one must not silently reorder the other.',
            ],
            bullets: [
              'A new Item includes a Default Style.',
              'Duplicate creates new IDs and deep-copies the selected subtree.',
              'Required Parts need a valid selection; optional Parts may expose None / Remove.',
              'Names may change, but stable IDs preserve Recipes and version comparisons.',
            ],
          },
        ],
      },
      {
        id: 'artist-source-files',
        category: 'creator',
        title: 'Artist source-file specification',
        summary: 'Prepare one aligned master document so every exported Style fits.',
        sections: [
          {
            title: 'Build one master canvas',
            bullets: [
              'Use one PSD, CLIP, or KRA master with the final Maker width, height, origin, and sRGB color space.',
              'Keep reference guides in a non-export group and draw every alternative in its final position.',
              'A Style group may contain line, shade, and highlight sublayers in the art file; export the flattened group as one transparent PNG.',
              'Do not trim transparent margins when full-canvas alignment carries the position.',
            ],
          },
          {
            title: 'What the artist should deliver',
            bullets: [
              'The editable master source file, kept private unless the creator chooses otherwise.',
              'One transparent PNG per Style with stable Part__Item__Style naming.',
              'A default composite and a combination check sheet.',
              'For bulk import, use the part/item/style.png folder layout, then review every automatic mapping before confirming it.',
            ],
            note: 'Animacraft reads its own project ZIP schema, not a generic third-party manifest. Coordinates cannot repair different head proportions, camera angles, poses, or incompatible garment silhouettes.',
          },
        ],
      },
      {
        id: 'png-import',
        category: 'creator',
        title: 'PNG import and replacement',
        summary: 'Import aligned layers without confusing view zoom with asset scale.',
        sections: [
          {
            title: 'Current import behavior',
            bullets: [
              'A PNG whose dimensions exactly match the Maker canvas is imported 1:1 at X 0, Y 0, Scale 1, Rotation 0.',
              'A non-full-canvas PNG is currently proportionally reduced only when needed to fit, then centered on the canvas.',
              'Review every centered loose asset and adjust its position manually before publishing.',
              'Artwork must be a real PNG, no larger than 20 MB, no edge longer than 8,192 px, and no more than 16,777,216 pixels. Transparent-bound trimming never crops the source.',
            ],
          },
          {
            title: 'Batch mapping and replacement',
            bullets: [
              'Confirm each file-to-Part/Item/Style mapping before committing a batch.',
              'A canvas-dimension mismatch is a manual-review condition, not an importer hard error; a fully transparent public Style still fails release review.',
              'Replacing a PNG preserves its transform only when positionLocked is true. If unlocked, the new PNG receives its normal import X/Y/Scale/Rotation and positionConfirmed becomes false.',
              'Replacement still preserves Layer Track, Smart Color, Rules, lock state, and thumbnail choices.',
              'Use view zoom to inspect pixels; it must not change the stored Style scale.',
            ],
            note: 'For production art, full-canvas PNGs are the safest default because their transparent margin preserves the shared coordinate system.',
          },
        ],
      },
      {
        id: 'canvas-layer-tracks',
        category: 'creator',
        title: 'Canvas and Layer Tracks',
        summary: 'Position each Style and keep global drawing order predictable.',
        sections: [
          {
            title: 'Canvas controls',
            bullets: [
              'Select the exact Style before moving it; the breadcrumb should read Part › Item › Style.',
              'Drag to position and use numeric X, Y, uniform Scale, and Rotation for reproducible alignment.',
              'Use Show all, Dim others, and Solo current Style to inspect overlap.',
              'After approval, use the position lock or the full Style lock. There is no separate appearance-only lock.',
              'In pixel mode, use nearest-neighbor preview and integer positioning where the art requires it.',
            ],
          },
          {
            title: 'Back-to-front drawing',
            paragraphs: [
              'Layer Tracks define global render order from back to front. They do not move a PNG and do not change the player menu order.',
            ],
            bullets: [
              'Assign every public Style to a valid Track.',
              'Keep standard Part-linked Tracks synchronized when that matches the artwork model.',
              'Use separate Tracks for back hair, body, outfit, face details, front hair, and foreground when needed.',
              'Verify the same composite in Creator Canvas, Player test, thumbnail, export, and publication preview.',
            ],
          },
        ],
      },
      {
        id: 'smart-color',
        category: 'creator',
        title: 'Smart Color',
        summary: 'Link multiple Styles to creator-approved deterministic color presets.',
        sections: [
          {
            title: 'Create and link a channel',
            bullets: [
              'Create a Color Channel, give it a clear player-facing name, and add all approved presets.',
              'Choose the intended default preset instead of relying on a fallback color.',
              'Open each relevant Style and link it to the same channel.',
              'Use source artwork with useful luminance separation so gradient mapping keeps readable shading.',
            ],
          },
          {
            title: 'Player behavior and checks',
            bullets: [
              'Palette is active only when the current selection exposes a visible Style linked to a channel.',
              'Choosing one preset recolors all currently visible Styles linked to that channel together.',
              'The player cannot remove creator-authored linkage or create a preset the creator did not define.',
              'Each Style can link to at most one channel, and Palette shows only the channel in the current Style context.',
              'Test every preset across every linked Item, then confirm the default, thumbnail, exported PNG, Recipe, and publication projection agree.',
              'Sui v2 validates registered presets through hidden Part/Item choices; gradient stops and per-pixel recoloring remain in the Walrus manifest and browser Renderer.',
            ],
            note: 'A channel with missing presets or no public linked Style is incomplete and should be fixed before publication.',
          },
        ],
      },
      {
        id: 'rules',
        category: 'creator',
        title: 'Rules and Style visibility',
        summary: 'Author valid combinations without mixing selection logic with z-order.',
        sections: [
          {
            title: 'Combination Rules',
            bullets: [
              'requires makes a selected Part, Item, or Style depend on one or more targets.',
              'excludes prevents the owner and each target from being selected together; multiple targets are independent conflicts.',
              'requires + ALL requires every target. ANY is one grouped selector within the same Part, and Style targets in that group must also belong to the same Item.',
              'Target any Item in a Part for broad logic, or target an exact Item or Style for precise logic.',
              'Use Layer Tracks, not Rules, when the problem is only drawing order.',
            ],
          },
          {
            title: 'Style visibility and publication truth',
            bullets: [
              'Always visible renders whenever its Item and Style are selected.',
              'Selected and not-selected conditions show the exact Style only when the dependency state matches.',
              'Player availability, Renderer visibility, Random, and Preflight use the same canonical rule engine.',
              'The complete graph is stored in the Walrus manifest. Sui v2 must receive an equivalent compiled projection; publication fails closed when equivalence cannot be produced.',
            ],
            note: 'Unresolved legacy targets, hierarchy cycles, contradictions, no playable Recipe, or unreachable public content block publication until repaired.',
          },
        ],
      },
      {
        id: 'soul-configuration',
        category: 'creator',
        title: 'Soul Configuration',
        summary: 'Provide editable identity, memory, and skills defaults for each OC.',
        sections: [
          {
            title: 'Three Living Content files',
            bullets: [
              'soul.md defines Personality & identity: voice, values, boundaries, world, and continuity.',
              'memory.md defines the starting memories and context carried by the character.',
              'SKILL.md defines skills, operating guidance, and linked documentation.',
              'Creator defaults are stored with the Maker and shown in Player Editor as the OC setting card.',
            ],
          },
          {
            title: 'Player inheritance and handoff',
            bullets: [
              'The player can adapt the allowed text for this specific OC before completion.',
              'OC name, description, world, tags, selected artwork, and the three Living Content files are preserved together.',
              'The OC Walrus Quilt contains the reviewed PNG plus animacraft-oc.json; all three Living Content documents are embedded in that profile JSON.',
              'Only the downloadable Soulidity handoff ZIP splits the content back into separate files.',
              'Soulidity remains responsible for the canonical Soul and its living content after the reviewed integration is enabled.',
            ],
            note: 'The Canonical Soul Mainnet handoff is currently gated; configuration can be authored and packaged now without claiming a completed Soul mint.',
          },
        ],
      },
      {
        id: 'player-test-preflight',
        category: 'publish',
        title: 'Player test and Preflight',
        summary: 'Test the real player surface, then resolve every release blocker.',
        sections: [
          {
            title: 'Run a realistic player test',
            bullets: [
              'Open Player test from Creator Studio; do not rely only on the authoring canvas.',
              'Try every Part, Item, and Style plus None / Remove for optional Parts.',
              'Exercise every Smart Color preset, Rule boundary, Random, Reset, Undo, Redo, and final PNG export.',
              'Check both mobile and desktop layouts and reload once to confirm the local draft restores.',
            ],
          },
          {
            title: 'Read Preflight correctly',
            bullets: [
              'Blocking issues must be fixed before Prepare Quilt can publish a trustworthy release.',
              'Warnings require conscious review, especially alignment drift, unused channels, compatibility changes, and optional content.',
              'Inspect public-only output: drafts and hidden content must not leak into the release.',
              'Re-run Preflight after any artwork, Rule, Track, Soul, or Expansion Pack change.',
            ],
            note: 'A green authoring preview is not sufficient evidence; Player, Renderer, manifest, and Sui projection checks must agree.',
          },
        ],
      },
      {
        id: 'walrus-sui-publish',
        category: 'publish',
        title: 'Publish with Walrus and Sui',
        summary: 'Understand the four resumable Mainnet publication steps.',
        sections: [
          {
            title: 'The four steps',
            bullets: [
              'Prepare Quilt encodes the reviewed release and calculates the current storage quote.',
              'Register & upload signs the required payment and transfers the Quilt to Walrus.',
              'Certify Walrus confirms the storage result; object visibility may lag briefly after certification.',
              'Publish on Sui creates the immutable OCMaker release and its administration objects.',
            ],
          },
          {
            title: 'Costs, retries, and success',
            bullets: [
              'MIST is a SUI unit; FROST is a WAL unit. Your wallet shows Sui transaction gas separately.',
              'If the live quote changes, prepare a fresh quote and explicitly confirm the new amount.',
              'The displayed upload quote covers the relay tip plus WAL storage and write charges; it is not a complete Sui gas estimate.',
              'A network timeout or temporarily invisible certified Blob should resume from the saved checkpoint, not restart completed work.',
              'Publication is complete only after the Sui transaction succeeds and the new Maker is observable.',
            ],
            note: 'The configured 53 Walrus epochs are approximately two years. Immutable does not mean permanent: record the Blob objects and renew storage before retention expires.',
          },
        ],
      },
      {
        id: 'lifecycle-versions',
        category: 'publish',
        title: 'Lifecycle and version management',
        summary: 'Manage drafts and immutable chain releases without overwriting history.',
        sections: [
          {
            title: 'Lifecycle states',
            bullets: [
              'Draft is local and editable.',
              'Publishing and Recoverable indicate an active or resumable Walrus/Sui checkpoint.',
              'Active permits Base/Pack purchases and Complete authorization when the global Commerce v5 and Canonical Soul gates are also enabled.',
              'Paused blocks purchases and new authorizations while preserving entitlements, counts, existing OCs, and provenance.',
              'Sale pending means the paused release is listed on-chain and administration is locked until the seller cancels or a buyer completes the purchase.',
              'Archived removes a release from active use and keeps Sui state restorable; Walrus files remain available only within paid retention unless renewed.',
              'Version draft is a local editable version draft derived from a published snapshot.',
            ],
          },
          {
            title: 'Safe updates',
            bullets: [
              'Open Manage status from Creator Library or the lifecycle badge.',
              'Create a version draft, review compatibility, and publish it as a separate immutable OCMaker.',
              'Previous versions and Recipes remain independently identifiable.',
              'Commerce v5 administration requires the live epoch-bound MakerControlCapV5 owner.',
              'A new immutable publication receives its own MakerRootV5. Its sealed Style registry, purchases, quotas, and Recipes never move to a later release automatically.',
              'Before a Maker can be listed for sale it must be paused and its Maker Treasury must be emptied. Purchase changes the operator but preserves paid Base/Pack access for that release.',
              'Version relationships live in the manifest and client. Move currently has no successor link and does not automatically replace an older version.',
            ],
            note: 'Permanent retirement and atomic on-chain supersession remain protocol-locked until a reviewed upgrade defines their semantics.',
          },
        ],
      },
      {
        id: 'expansion-packs',
        category: 'publish',
        title: 'Expansion Packs',
        summary: 'Publish free or one-time-paid optional content inside one immutable Maker release.',
        sections: [
          {
            title: 'Access and Complete policies',
            bullets: [
              'Every Pack is embedded in one immutable Walrus Maker package and registered under that release’s MakerRootV5 on Sui.',
              'Choose FREE, ONE_TIME_PAID, or required core content. A paid wallet receives permanent access to that Pack on this release.',
              'Choose a separate Complete policy for the Pack: unlimited free, free quota then paid, paid every time, or free quota then blocked.',
              'A free Pack needs no claim transaction. A paid Pack must be purchased before any of its exact Styles can be used.',
            ],
          },
          {
            title: 'Immutable content boundary',
            bullets: [
              'A Pack cannot replace the base default Recipe or silently edit existing base content.',
              'New requires rules must trigger from Pack-owned content; excludes rules must involve Pack-owned content.',
              'Every exact Style is sealed as Base or one Pack product. Item-level Recipes cannot bypass a paid Style.',
              'Changing Pack artwork, membership, or rules requires a new Maker version; previous purchases remain bound to the previous release.',
            ],
            note: 'A Pack is an on-chain policy record inside one release Root, not a separately transferable Maker or nested Maker.',
          },
        ],
      },
      {
        id: 'commerce-rights',
        category: 'publish',
        title: 'Commerce, rights, and royalties',
        summary: 'Understand which choices are enforced by Sui before inviting paid creators and players.',
        sections: [
          {
            title: 'Rights origin and primary access',
            bullets: [
              'ONCHAIN_NATIVE declares that the Maker originates on-chain. LICENSE_WRAPPED declares that an existing traditional license is represented on-chain; off-chain disputes still follow that external license.',
              'Base access may be free or one-time paid. Base and every used Pack can add an independent Complete price, per-wallet free quota, or global cap.',
              'Primary creator charges split 90% to the current operator’s Maker Treasury and 10% to the Animacraft protocol. Sui gas, Walrus storage, and any fixed Complete protocol fee are shown separately.',
              'Payment, exact Style authorization, quota increment, and canonical Soul mint must succeed in one transaction or all changes roll back.',
              'Commerce v5 has no refund path: the wallet reviews the exact charge before signing, and a failed atomic transaction transfers nothing.',
            ],
          },
          {
            title: 'Ownership and resale',
            bullets: [
              'Maker resale requires Paused state and a zero Maker Treasury balance. Listing locks administration until cancellation or purchase.',
              'Default Maker resale is seller 92.5%, protocol 2.5%, and original Maker creator 5%. That original-creator percentage freezes when the exact Style registry is sealed, so neither it nor the original creator can be changed by a later operator.',
              'At first Soul mint, the Soul creator and Maker-source resale royalties are frozen. Defaults are 2.5% each and supported values are 0–5% in 0.5% steps.',
              'Soul resale always adds the fixed Soulidity protocol 2.5%. The frozen Soul-creator and Maker-source pool is capped at 10%, so the seller receives at least 87.5%.',
              'A later Soul holder cannot reduce those frozen royalties. Social actions, creator profiles, likes, collections, and the public marketplace continue in Soulidity.',
            ],
            note: 'Commerce v5 remains fail-closed in production until both package upgrades, shared objects, runtime IDs, and free/paid Mainnet evidence are verified.',
          },
        ],
      },
      {
        id: 'chain-truth',
        category: 'reference',
        title: 'What is local, on Walrus, and on Sui?',
        summary: 'Use precise language for drafts, files, protocol state, and Soul handoff.',
        sections: [
          {
            title: 'Where each truth lives',
            bullets: [
              'Browser IndexedDB: editable drafts, source blobs, revisions, local player state, and resumable checkpoints.',
              'Walrus: immutable Maker manifest, public free artwork, paid Style ciphertext, separate public covers/previews, protected final-OC ciphertext, Soul defaults, and the release package for the purchased retention period. Paid plaintext is never placed in a public Quilt; storage must be renewed before expiry.',
              'Sui: OCMaker provenance, per-release MakerRootV5 lifecycle, exact Style product registry, Base/Pack entitlements, Complete counts and charges, Treasuries, listings, and compiled rule projection.',
              'Soulidity: the only canonical finished Soul, Living Content lifecycle, identity, social and market behavior after integration.',
            ],
          },
          {
            title: 'When something is onchain',
            paragraphs: [
              'Saving locally is not publication. Walrus certification stores the release package, but the Maker is fully published only after the Sui publication transaction succeeds.',
              'Maker publication does not register a player Recipe. A non-droppable authorization is created and consumed only inside the same successful transaction that creates the canonical Soul.',
            ],
            note: 'Walrus immutability applies during retention, not forever without renewal. The Canonical Soul Mainnet route is currently disabled.',
          },
        ],
      },
      {
        id: 'troubleshooting',
        category: 'reference',
        title: 'Troubleshooting and recovery',
        summary: 'Recover drafts and publication checkpoints without making the problem worse.',
        sections: [
          {
            title: 'Draft and editor problems',
            bullets: [
              'Do not clear site data when a draft appears missing; verify the connected wallet and use the recovery tools first.',
              'If artwork is misplaced, compare PNG dimensions, the Style transform, and its Layer Track before re-uploading.',
              'If Palette is missing, confirm the active visible Style is linked to a public channel with presets.',
              'If Random finds no result, inspect required Parts, requires/excludes, Style visibility, and Expansion Pack compatibility.',
              'Export a project backup before invasive repair.',
            ],
          },
          {
            title: 'Publication problems',
            bullets: [
              'UPLOAD_QUOTE_CHANGED means the encoded Quilt or live price changed; prepare and approve a new quote.',
              'NETWORK_UNAVAILABLE or a timeout should retry the current saved step after checking wallet and network connectivity.',
              'A certified Blob may not be immediately queryable; resume certification so it polls the existing result.',
              'After successful publication, refresh discovery only after the Sui object becomes observable.',
              'Copy technical details before asking for support, but never share wallet secrets or recovery phrases.',
            ],
          },
        ],
      },
    ],
  },
  zh: {
    ui: {
      searchPlaceholder: '搜索 Animacraft 使用指南',
      noResults: '没有匹配的主题，请尝试搜索 Part、Smart Color、Walrus 或 Sui。',
      updatedLabel: '说明文档',
      readLabel: '阅读指南',
      previous: '上一篇',
      next: '下一篇',
      allTopics: '全部主题',
      backToHome: '返回全部指南',
      onThisPage: '本页内容',
    },
    categories: [
      { id: 'start', title: '从这里开始', description: '了解 Animacraft，并根据你的角色选择阅读路径。' },
      { id: 'player', title: '制作 OC', description: '选择素材、调整配色并准备你的 OC 包。' },
      { id: 'creator', title: '制作 Maker', description: '准备对齐素材并创作可正式使用的 Maker。' },
      { id: 'publish', title: '测试与发布', description: '验证、存储、发布和管理不可变版本。' },
      { id: 'reference', title: '参考资料', description: '分清哪些在本地、Walrus、Sui，哪些功能仍未开放。' },
    ],
    articles: [
      {
        id: 'introduction',
        category: 'start',
        title: 'Animacraft 是什么？',
        summary: '用于制作可复用角色 Maker 和 Soul-ready OC 的创作层。',
        sections: [
          {
            title: '一个 Maker，无数个 OC',
            paragraphs: [
              'Animacraft 是一个无后端的角色 Maker 编辑器。创作者用 PNG 素材组织可复用的 Part、Item 和 Style，玩家再把这些选项组合成自己的 OC。',
              'Walrus 保存不可变的创作包和完整 Maker manifest；Sui 记录 Maker 的来源、所有权、发布状态、经济配置，以及等价编译的 Sui v2 规则投影。',
            ],
            bullets: [
              'Creator Studio 用于制作和测试 Maker。',
              'Player Editor 用于选择素材、Smart Color 预设和 Soul 内容。',
              'Soulidity 是最终 Soul 的规范归宿；Animacraft 不会再铸造一个竞争性的角色 Token。',
            ],
          },
          {
            title: '当前生产边界',
            paragraphs: [
              'Maker 发布到 Walrus 和 Sui Mainnet 已可使用。专用的 Canonical Soul Mainnet 交接仍保持 fail-closed，直到经过审核的 Soulidity adapter 和共享费用对象正式启用。',
            ],
            note: '在该开关开启前，Complete OC 表示准备并保存 OC 包，不能作为已经铸造规范 Soul 的证明。',
          },
        ],
      },
      {
        id: 'player-quick-start',
        category: 'player',
        title: '玩家快速入门',
        summary: '选择已验证的 Maker，制作 OC，并导出最终结果。',
        sections: [
          {
            title: '制作外观',
            bullets: [
              '按页面要求连接 Sui 钱包，选择已验证的 Maker，然后打开 Make OC。',
              '先在顶部选择 Part，再选择 Item 卡片；如果 Item 有多个 Style，再选择较小的 Style 变体。',
              '只有创作者把当前可见 Style 连接到 Smart Color 通道时，Palette 才能使用。',
              '使用 Undo、Redo、Random、Remove optional 和 Reset 自由试错。',
              '无法点击或被隐藏的选项，通常是 Maker Rules 的预期结果。',
            ],
          },
          {
            title: '完成 OC',
            bullets: [
              '填写 OC 名称、世界、描述和标签。',
              '检查或编辑从 Maker 继承的 Personality & identity、Memory 和 Skills。',
              '标准 PNG 最长边不超过 1024 px，且绝不放大 Canvas；只有 Canvas 不超过 8,388,608 像素时才提供原始尺寸导出。',
              '透明导出只移除被明确标记为 export-background 的 Part，不是人物抠图；当前不提供 JPEG、WebP 或自定义尺寸。',
              'Complete OC 会保存 Recipe 和面向 Soul 的内容，供后续交接流程使用。',
            ],
            note: 'Canonical Soul Mainnet 开关目前未启用。准备完成的 OC 还不等于已铸造的规范 Soul。',
          },
        ],
      },
      {
        id: 'creator-quick-start',
        category: 'creator',
        title: '创作者快速入门',
        summary: '制作一个最小可用 Maker，并走通真实玩家试玩。',
        sections: [
          {
            title: '完成第一个可玩的版本',
            bullets: [
              '创建 Maker 草稿，填写标题、介绍、封面、创作者身份、画布和许可快照。',
              '添加一个 Part，在其中添加 Item，并为默认 Style 上传 PNG。',
              '完成最小选项集合后，按从后到前的顺序排列 Layer Tracks。',
              '只在素材确实需要时添加 Smart Color 和 Rules。',
              '配置默认的 soul.md、memory.md 和 SKILL.md。',
            ],
          },
          {
            title: '发布前证明它确实可用',
            bullets: [
              '保存并打开 Player test，测试正常选择、Random、Reset、调色和导出。',
              '运行 Preflight，解决每一个阻塞问题。',
              '依次完成 Prepare Quilt、Register & upload、Certify Walrus 和 Publish on Sui。',
            ],
            note: '本地草稿可以编辑；链上发布版本不可变。后续修改必须创建 version draft 并发布为新版本。',
          },
        ],
      },
      {
        id: 'data-model',
        category: 'creator',
        title: 'Maker 数据模型',
        summary: '导入素材前，先理解 Maker → Part → Item → Style。',
        sections: [
          {
            title: '四个创作层级',
            bullets: [
              'Maker：完整的可复用模板，包括元数据、画布、规则、Soul 默认内容和发布配置。',
              'Part：玩家菜单分类，例如 Background、Skin、Eyes 或 Front Hair。',
              'Item：一个 Part 内可点击的部件，例如 Long Hair。',
              'Style：最小渲染单元。一个 Style 只拥有一张 PNG，以及独立的变换、外观、规则、锁定、Layer Track 和可选 Smart Color 关联。',
            ],
          },
          {
            title: '独立身份与两种顺序',
            paragraphs: [
              'Part 菜单顺序控制玩家浏览顺序；Layer Track 顺序只控制视觉 z-order。调整其中一个，不应暗中改变另一个。',
            ],
            bullets: [
              '新建 Item 时会自带一个 Default Style。',
              'Duplicate 会生成新 ID，并对选中的子树进行完整深复制。',
              'Required Part 必须有有效选择；Optional Part 可以提供 None / Remove。',
              '名称可以修改，但稳定 ID 用于保护 Recipe 和版本比较。',
            ],
          },
        ],
      },
      {
        id: 'artist-source-files',
        category: 'creator',
        title: '画师本地源文件规范',
        summary: '使用一份统一对齐的主文档，让所有导出 Style 都能严丝合缝。',
        sections: [
          {
            title: '建立一个 Master Canvas',
            bullets: [
              '使用一份 PSD、CLIP 或 KRA 主文件，并固定 Maker 最终宽高、原点和 sRGB 色彩空间。',
              '把参考线放在不导出的组中，并让每个可替换素材都在最终位置绘制。',
              '源文件中的一个 Style 组可以包含线稿、阴影和高光子层；导入前把整个组扁平导出为一张透明 PNG。',
              '如果完整画布的透明留白承担坐标信息，就不要裁切透明边。',
            ],
          },
          {
            title: '画师应交付什么',
            bullets: [
              '可编辑的 Master 源文件；除非创作者主动选择，否则不要公开。',
              '每个 Style 一张透明 PNG，并使用稳定的 Part__Item__Style 文件名。',
              '一张默认组合图和一张多组合检查图。',
              '批量导入请使用 part/item/style.png 目录结构；系统自动映射后，必须逐项人工确认。',
            ],
            note: 'Animacraft 只读取自家的项目 ZIP schema，不读取通用第三方 manifest。坐标也无法修复不同头部比例、镜头角度、姿势或不兼容轮廓。',
          },
        ],
      },
      {
        id: 'png-import',
        category: 'creator',
        title: 'PNG 导入与替换',
        summary: '导入对齐图层，并分清观察缩放与素材缩放。',
        sections: [
          {
            title: '当前导入行为',
            bullets: [
              'PNG 尺寸与 Maker Canvas 完全一致时，会以 X 0、Y 0、Scale 1、Rotation 0 原样 1:1 导入。',
              '非完整画布 PNG 当前只会在超出画布时等比缩小，然后放到画布中央。',
              '所有居中的散件都必须人工确认并调整位置后再发布。',
              '素材必须是真实 PNG：不超过 20 MB、任一边不超过 8192 px、总像素不超过 16,777,216；透明边诊断不会裁剪源文件。',
            ],
          },
          {
            title: '批量映射与素材替换',
            bullets: [
              '批量提交前，逐项确认文件到 Part、Item、Style 的映射。',
              '画布尺寸不匹配只是人工复核条件，不是 importer 硬错误；但公开 Style 全透明仍会在发布检查中失败。',
              '只有 positionLocked=true 时，替换 PNG 才保留 transform；未锁定时会按新 PNG 导入规则重置 X/Y/Scale/Rotation，并将 positionConfirmed 设为 false。',
              '替换仍会保留 Layer Track、Smart Color、Rules、锁定状态和缩略图选择。',
              '使用视图缩放观察像素；它绝不能修改 Style 中保存的 scale。',
            ],
            note: '正式生产推荐使用完整画布 PNG，因为透明留白能够可靠保存统一坐标系。',
          },
        ],
      },
      {
        id: 'canvas-layer-tracks',
        category: 'creator',
        title: 'Canvas 与 Layer Tracks',
        summary: '精确定位每个 Style，并保持可预测的全局绘制顺序。',
        sections: [
          {
            title: 'Canvas 操作',
            bullets: [
              '移动前先选中准确的 Style；路径应显示为 Part › Item › Style。',
              '拖动进行定位，并用数值 X、Y、等比 Scale 和 Rotation 获得可复现的对齐。',
              '使用 Show all、Dim others 和 Solo current Style 检查遮挡。',
              '审核完成后可以锁定位置或锁定整个 Style；当前没有独立的“只锁外观”。',
              '像素画素材需要时，开启最近邻预览并使用整数坐标。',
            ],
          },
          {
            title: '从后到前绘制',
            paragraphs: [
              'Layer Tracks 定义全局从后到前的渲染顺序；它不会移动 PNG，也不会改变玩家菜单顺序。',
            ],
            bullets: [
              '每个公开 Style 都必须分配到有效 Track。',
              '符合素材模型时，让标准 Part 关联的 Track 保持同步。',
              '必要时为后发、身体、服装、脸部细节、前发和前景分别建 Track。',
              '在 Creator Canvas、Player test、缩略图、导出和发布预览中验证同一组合。',
            ],
          },
        ],
      },
      {
        id: 'smart-color',
        category: 'creator',
        title: 'Smart Color',
        summary: '把多个 Style 绑定到创作者批准的确定性颜色预设。',
        sections: [
          {
            title: '创建并关联颜色通道',
            bullets: [
              '创建 Color Channel，填写清晰的玩家名称，并加入所有允许的预设。',
              '明确选择默认预设，不要依赖系统回退颜色。',
              '打开每个相关 Style，把它们连接到同一个通道。',
              '源素材需要有清晰的明度层次，gradient mapping 才能保留可读的阴影。',
            ],
          },
          {
            title: '玩家表现与检查',
            bullets: [
              '只有当前选择暴露了连接到通道的可见 Style 时，Palette 才会亮起。',
              '选择一个预设会同步重着色当前所有连接到该通道的可见 Style。',
              '玩家不能解除创作者设定的绑定，也不能创建创作者没有定义的 preset。',
              '每个 Style 最多绑定一个 channel，Palette 只显示当前 Style 上下文中的 channel。',
              '测试每个预设与每个关联 Item，并确认默认值、缩略图、导出 PNG、Recipe 和发布投影一致。',
              'Sui v2 通过隐藏的 Part/Item 选择验证已注册预设；gradient stops 和逐像素着色只存在于 Walrus manifest 与浏览器 Renderer。',
            ],
            note: '缺少预设或没有公开关联 Style 的通道不完整，应在发布前修复。',
          },
        ],
      },
      {
        id: 'rules',
        category: 'creator',
        title: 'Rules 与 Style visibility',
        summary: '创建有效组合，不要把选择逻辑与图层顺序混在一起。',
        sections: [
          {
            title: '组合规则',
            bullets: [
              'requires 让一个被选中的 Part、Item 或 Style 依赖一个或多个目标。',
              'excludes 阻止规则拥有者与每个目标同时被选择；多个目标分别构成独立冲突。',
              '只有 requires + ALL 才表示所有目标都必须满足；ANY 是同一 Part 内的 grouped selector，其中的 Style 目标还必须属于同一 Item。',
              '需要广泛逻辑时选择某 Part 的 any Item；需要精确逻辑时选择具体 Item 或 Style。',
              '如果问题只是前后遮挡，请使用 Layer Tracks，而不是 Rules。',
            ],
          },
          {
            title: 'Style visibility 与发布真相',
            bullets: [
              'Always visible 表示 Item 和 Style 被选中时正常渲染。',
              'Selected 和 not-selected 条件只在依赖状态匹配时显示该准确 Style。',
              '玩家可用性、Renderer 可见性、Random 和 Preflight 使用同一套规范规则引擎。',
              '完整规则图保存在 Walrus manifest；Sui v2 必须保存等价的编译投影，无法生成等价投影时发布会 fail closed。',
            ],
            note: '未解决的旧规则目标、hierarchy cycle、规则矛盾、没有可玩 Recipe 或不可达的公开内容都会阻止发布。',
          },
        ],
      },
      {
        id: 'soul-configuration',
        category: 'creator',
        title: 'Soul Configuration',
        summary: '为每个 OC 提供可编辑的身份、记忆和技能默认内容。',
        sections: [
          {
            title: '三份 Living Content',
            bullets: [
              'soul.md 定义 Personality & identity，包括表达方式、价值观、边界、世界观和连续性。',
              'memory.md 定义角色开始时携带的记忆与背景。',
              'SKILL.md 定义技能、操作指导和关联文档。',
              '创作者默认内容与 Maker 一起保存，并在 Player Editor 中作为 OC 设定卡展示。',
            ],
          },
          {
            title: '玩家继承与交接',
            bullets: [
              '玩家可以在允许范围内，为这个具体 OC 调整文本。',
              'OC 名称、描述、世界、标签、所选素材和三份 Living Content 会一起保存。',
              'OC 的 Walrus Quilt 只包含审核后的 PNG 与 animacraft-oc.json；三份 Living Content 都嵌在这份 profile JSON 中。',
              '只有可下载的 Soulidity handoff ZIP 会把它们重新拆成独立文件。',
              '审核后的集成启用后，Soulidity 负责规范 Soul 和后续 Living Content。',
            ],
            note: 'Canonical Soul Mainnet 交接当前仍受开关限制；现在可以创作和打包配置，但不能声称已经完成 Soul 铸造。',
          },
        ],
      },
      {
        id: 'player-test-preflight',
        category: 'publish',
        title: 'Player test 与 Preflight',
        summary: '在真实玩家界面测试，然后解决所有发布阻塞项。',
        sections: [
          {
            title: '进行真实玩家测试',
            bullets: [
              '从 Creator Studio 打开 Player test，不要只看创作画布。',
              '测试每个 Part、Item、Style，以及 Optional Part 的 None / Remove。',
              '覆盖所有 Smart Color 预设、Rules 边界、Random、Reset、Undo、Redo 和最终 PNG 导出。',
              '检查移动端和桌面端布局，并刷新一次确认本地草稿可以恢复。',
            ],
          },
          {
            title: '正确理解 Preflight',
            bullets: [
              '所有 blocking issue 都必须解决，才能通过 Prepare Quilt 发布可信版本。',
              'warning 需要明确审核，尤其是对齐漂移、未使用通道、兼容性变化和可选内容。',
              '检查只包含公开内容的输出，草稿和隐藏素材不能泄漏进发布包。',
              '修改素材、Rules、Track、Soul 或 Expansion Pack 后，都要重新运行 Preflight。',
            ],
            note: '创作画布显示正常并不足够；Player、Renderer、manifest 和 Sui projection 必须一致。',
          },
        ],
      },
      {
        id: 'walrus-sui-publish',
        category: 'publish',
        title: '使用 Walrus 与 Sui 发布',
        summary: '理解四个可以恢复的 Mainnet 发布步骤。',
        sections: [
          {
            title: '四个步骤',
            bullets: [
              'Prepare Quilt 编码审核后的版本，并计算当前存储报价。',
              'Register & upload 签署所需付款并把 Quilt 上传到 Walrus。',
              'Certify Walrus 确认存储结果；认证后对象可能需要短暂时间才能查询到。',
              'Publish on Sui 创建不可变 OCMaker 版本及其管理对象。',
            ],
          },
          {
            title: '费用、重试与成功判断',
            bullets: [
              'MIST 是 SUI 的单位，FROST 是 WAL 的单位；钱包会单独显示 Sui 交易 gas。',
              '实时报价变化时，重新准备报价并明确确认新金额。',
              '页面显示的上传报价只包含 relay tip 与 WAL storage/write，不是完整的 Sui gas 估算。',
              '网络超时或已认证 Blob 暂时不可见时，应从保存的 checkpoint 恢复，而不是重做已完成步骤。',
              '只有 Sui 交易成功且新 Maker 对象可以读取，才算发布完成。',
            ],
            note: '当前 53 个 Walrus epoch 约为两年。不可变不等于永久：记录 Blob object，并在 retention 到期前续存。',
          },
        ],
      },
      {
        id: 'lifecycle-versions',
        category: 'publish',
        title: '生命周期与版本管理',
        summary: '管理草稿和不可变链上版本，而不覆盖历史。',
        sections: [
          {
            title: '生命周期状态',
            bullets: [
              'Draft 是本地可编辑草稿。',
              'Publishing 和 Recoverable 表示正在进行或可以恢复的 Walrus/Sui checkpoint。',
              'Active 表示当全局 Commerce v5 与 Canonical Soul 开关也开启时，允许 Base/Pack 购买和 Complete 授权。',
              'Paused 阻止购买和新授权，但保留既有权限、次数、OC 与来源记录。',
              'Sale pending 表示已暂停版本正在链上出售；卖家取消或买家完成购买前，所有管理操作都会锁定。',
              'Archived 让版本停止活跃使用并保留可恢复的 Sui 状态；Walrus 文件只在已付 retention 内可用，除非续存。',
              'Version draft 是从已发布快照派生的本地可编辑版本草稿。',
            ],
          },
          {
            title: '安全更新',
            bullets: [
              '从 Creator Library 的 Manage status 或生命周期标记进入管理。',
              '创建 version draft，检查兼容性，再把它发布为独立的不可变 OCMaker。',
              '旧版本和旧 Recipe 仍可被独立识别。',
              'Commerce v5 链上管理需要当前 epoch 对应的 MakerControlCapV5 持有者。',
              '每次新的不可变发布都会得到独立 MakerRootV5；封存的 Style 注册表、购买权限、次数和 Recipe 不会自动迁移到新版本。',
              'Maker 上架交易前必须先暂停并清空 Maker Treasury。购买会更换经营者，但该版本已有的 Base/Pack 购买权限保持有效。',
              '版本关系记录在 manifest 和客户端中；Move 当前没有 successor 关系，也不会自动替换旧版本。',
            ],
            note: '永久退役和原子化链上版本替代仍被协议锁定，必须等待经过审核的升级定义其语义。',
          },
        ],
      },
      {
        id: 'expansion-packs',
        category: 'publish',
        title: 'Expansion Packs',
        summary: '在一个不可变 Maker 版本中发布免费或一次付费的可选内容。',
        sections: [
          {
            title: '访问与 Complete 策略',
            bullets: [
              '每个 Pack 都嵌入一份不可变 Walrus Maker 包，并在 Sui 上登记到该版本的 MakerRootV5。',
              '可选择 FREE、ONE_TIME_PAID 或必需核心内容；付费钱包永久获得该 Pack 在此版本中的使用权。',
              'Pack 可独立设置 Complete：无限免费、免费次数后付费、每次付费或免费次数后禁止。',
              '免费 Pack 不需要领取交易；付费 Pack 必须购买后才能使用其中任何精确 Style。',
            ],
          },
          {
            title: '不可变内容边界',
            bullets: [
              'Pack 不能替换基础默认 Recipe，也不能暗中修改已有基础内容。',
              '新的 requires 规则必须由 Pack 内容触发；excludes 规则必须涉及 Pack 内容。',
              '每个精确 Style 都会封存为 Base 或某一个 Pack 产品，不能通过 Item 级 Recipe 绕过付费 Style。',
              '修改 Pack 素材、归属或规则必须发布新 Maker 版本；旧购买仍绑定旧版本。',
            ],
            note: 'Pack 是某个版本 Root 内的链上策略记录，不是可独立转让的 Maker，也不存在 Maker 套 Maker。',
          },
        ],
      },
      {
        id: 'commerce-rights',
        category: 'publish',
        title: '商业、权利与版税',
        summary: '邀请付费创作者和玩家之前，明确哪些规则由 Sui 强制执行。',
        sections: [
          {
            title: '权利来源与首次消费',
            bullets: [
              'ONCHAIN_NATIVE 声明 Maker 原生首发于链上；LICENSE_WRAPPED 声明把已有传统授权映射上链，链下争议仍以外部授权为准。',
              'Base 可以免费或一次付费；Base 与每个实际使用的 Pack 还可以分别设置 Complete 价格、每钱包免费次数或全局上限。',
              '首次内容费用按当前经营者 Maker Treasury 90%、Animacraft 协议 10% 分配；Sui gas、Walrus 存储和固定 Complete 协议费单独展示。',
              '付款、精确 Style 授权、次数递增与规范 Soul 铸造必须在同一笔交易全部成功，否则整体回滚。',
              'Commerce v5 不提供退款路径：钱包签名前会显示精确费用；原子交易失败时不会转移任何款项。',
            ],
          },
          {
            title: '所有权与二级交易',
            bullets: [
              'Maker 转售要求 Paused 且 Maker Treasury 余额为零；上架后管理权锁定，直到取消或购买完成。',
              'Maker 转售默认：卖家 92.5%、协议 2.5%、原始 Maker 创作者 5%；该原作者比例在精确 Style 注册表封存时冻结，后续经营者不能降低，原始创作者也不会随经营权变更。',
              'Soul 首次铸造时冻结 Soul 创作者与 Maker 来源版税，默认各 2.5%，支持 0–5%、每档 0.5%。',
              'Soul 二级交易固定另收 Soulidity 协议 2.5%；冻结的 Soul 创作者与 Maker 来源版税合计最多 10%，所以卖家最少获得 87.5%。',
              '后续 Soul 持有人不能降低冻结版税；作者主页、点赞、收藏与公开市场继续由 Soulidity 承接。',
            ],
            note: '在两个包升级、共享对象、运行时 ID 以及免费/付费主网证据全部验证前，Commerce v5 在生产环境保持 fail-closed。',
          },
        ],
      },
      {
        id: 'chain-truth',
        category: 'reference',
        title: '哪些在本地、Walrus 和 Sui？',
        summary: '准确描述草稿、文件、协议状态和 Soul 交接。',
        sections: [
          {
            title: '每一种真相存在哪里',
            bullets: [
              '浏览器 IndexedDB：可编辑草稿、源文件 blob、revision、本地玩家状态和可恢复 checkpoint。',
              'Walrus：在已购买 retention 内保存不可变 Maker manifest、公开免费素材、付费 Style 密文、独立公开封面/预览、受保护的最终 OC 密文、Soul 默认内容和发布包。付费明文绝不进入公开 Quilt；到期前必须续存。',
              'Sui：OCMaker 来源、每版本 MakerRootV5 生命周期、精确 Style 产品注册表、Base/Pack 权限、Complete 次数与费用、Treasury、上架状态和规则投影。',
              'Soulidity：集成后唯一规范的最终 Soul，以及 Living Content 生命周期、身份、社交和市场行为。',
            ],
          },
          {
            title: '什么时候才叫上链',
            paragraphs: [
              '本地保存不是发布。Walrus 认证表示发布包已经存储，但只有 Sui 发布交易成功后，Maker 才算完整发布。',
              '发布 Maker 不会注册玩家 Recipe；不可丢弃的授权只会在创建规范 Soul 的同一笔成功交易中创建并被消费。',
            ],
            note: 'Walrus 的不可变性只在 retention 期间成立，不续存就不是永久保存。Canonical Soul Mainnet 路径目前关闭。',
          },
        ],
      },
      {
        id: 'troubleshooting',
        category: 'reference',
        title: '故障排查与恢复',
        summary: '在不扩大问题的前提下恢复草稿和发布 checkpoint。',
        sections: [
          {
            title: '草稿与编辑器问题',
            bullets: [
              '草稿看似丢失时不要清除网站数据；先确认连接的钱包，再使用恢复工具。',
              '素材错位时，重新上传前先比较 PNG 尺寸、Style transform 和 Layer Track。',
              'Palette 没出现时，确认当前可见 Style 已连接到拥有预设的公开通道。',
              'Random 找不到结果时，检查 Required Part、requires/excludes、Style visibility 和 Expansion Pack 兼容性。',
              '进行侵入性修复前先导出项目备份。',
            ],
          },
          {
            title: '发布问题',
            bullets: [
              'UPLOAD_QUOTE_CHANGED 表示编码后的 Quilt 或实时价格发生变化；重新准备并批准新报价。',
              'NETWORK_UNAVAILABLE 或 timeout 应在检查钱包和网络后重试当前已保存步骤。',
              '已认证 Blob 可能暂时无法查询；恢复 certification，让系统轮询现有结果。',
              '发布成功后，等待 Sui 对象可读取再刷新发现列表。',
              '求助前复制 technical details，但绝不要分享钱包私钥或助记词。',
            ],
          },
        ],
      },
    ],
  },
  ja: {
    ui: {
      searchPlaceholder: 'Animacraft ガイドを検索',
      noResults: '一致するトピックがありません。Part、Smart Color、Walrus、Sui などで検索してください。',
      updatedLabel: 'ドキュメント',
      readLabel: 'ガイドを読む',
      previous: '前へ',
      next: '次へ',
      allTopics: 'すべてのトピック',
      backToHome: 'すべてのガイドに戻る',
      onThisPage: 'このページの内容',
    },
    categories: [
      { id: 'start', title: 'はじめに', description: 'Animacraft を理解し、自分の役割に合った読み方を選びます。' },
      { id: 'player', title: 'OC を作る', description: '素材と色を選び、OC パッケージを準備します。' },
      { id: 'creator', title: 'Maker を作る', description: '位置合わせ済みの素材から実用的な Maker を制作します。' },
      { id: 'publish', title: 'テストと公開', description: '検証、保存、公開、不変リリースの管理を行います。' },
      { id: 'reference', title: 'リファレンス', description: 'ローカル、Walrus、Sui、未開放機能の境界を確認します。' },
    ],
    articles: [
      {
        id: 'introduction',
        category: 'start',
        title: 'Animacraft とは？',
        summary: '再利用できるキャラクター Maker と Soul 対応 OC の制作レイヤーです。',
        sections: [
          {
            title: '一つの Maker から多くの OC',
            paragraphs: [
              'Animacraft はバックエンドを持たないキャラクター Maker エディターです。クリエイターは PNG を Part、Item、Style として整理し、プレイヤーはそれらを組み合わせて OC を作ります。',
              'Walrus は不変の制作パッケージと完全な Maker manifest を保存します。Sui は Maker の来歴、所有権、公開状態、経済設定、等価に compiled された Sui v2 ルール投影を記録します。',
            ],
            bullets: [
              'Creator Studio で Maker を制作・テストします。',
              'Player Editor で素材、Smart Color プリセット、Soul 内容を選びます。',
              '完成した Soul の正規の行き先は Soulidity であり、Animacraft は別のキャラクター Token を発行しません。',
            ],
          },
          {
            title: '現在の本番境界',
            paragraphs: [
              'Walrus と Sui Mainnet への Maker 公開は利用できます。専用の Canonical Soul Mainnet 引き渡しは、監査済み Soulidity adapter と共有手数料オブジェクトが有効になるまで fail-closed のままです。',
            ],
            note: 'ゲートが開くまでは、Complete OC は OC パッケージの準備と保存を意味し、正規 Soul の mint 完了を証明するものではありません。',
          },
        ],
      },
      {
        id: 'player-quick-start',
        category: 'player',
        title: 'プレイヤークイックスタート',
        summary: '検証済み Maker を選び、OC を作って結果を書き出します。',
        sections: [
          {
            title: '見た目を作る',
            bullets: [
              '画面の案内に従って Sui ウォレットを接続し、検証済み Maker から Make OC を開きます。',
              '上部で Part を選び、Item カードを選択します。Item に複数の Style がある場合は小さな Style バリエーションを選びます。',
              '現在表示中の Style が Smart Color チャンネルに接続されている場合だけ Palette を使用できます。',
              'Undo、Redo、Random、Remove optional、Reset で安全に試行できます。',
              '無効または非表示の選択肢は、通常 Maker Rules の意図した結果です。',
            ],
          },
          {
            title: 'OC を完成させる',
            bullets: [
              'OC 名、世界、説明、タグを入力します。',
              'Maker から継承した Personality & identity、Memory、Skills を確認・編集します。',
              '標準 PNG は Canvas を拡大せず、長辺を最大 1,024 px にします。原寸出力は Canvas が 8,388,608 pixel 以下の場合だけ利用できます。',
              '透明出力は export-background と明示された Part だけを除外し、人物の切り抜きは行いません。JPEG、WebP、任意サイズ出力には対応していません。',
              'Complete OC は Recipe と Soul 対応内容を引き渡し用に保存します。',
            ],
            note: 'Canonical Soul Mainnet ゲートは現在無効です。準備済み OC は、まだ正規 Soul の mint ではありません。',
          },
        ],
      },
      {
        id: 'creator-quick-start',
        category: 'creator',
        title: 'クリエイタークイックスタート',
        summary: '最小限の有効な Maker を作り、Player test まで通します。',
        sections: [
          {
            title: '最初のプレイ可能版を作る',
            bullets: [
              'Maker draft を作成し、タイトル、説明、カバー、作者情報、Canvas、ライセンスのスナップショットを設定します。',
              'Part を追加し、その中に Item を追加して Default Style の PNG をアップロードします。',
              '必要最小限の選択肢を作り、Layer Tracks を奥から手前へ並べます。',
              '素材に必要な場合だけ Smart Color と Rules を追加します。',
              'soul.md、memory.md、SKILL.md の初期内容を設定します。',
            ],
          },
          {
            title: '公開前に実用性を証明する',
            bullets: [
              '保存して Player test を開き、通常選択、Random、Reset、配色、書き出しを確認します。',
              'Preflight を実行し、すべてのブロッキング問題を解消します。',
              'Prepare Quilt、Register & upload、Certify Walrus、Publish on Sui の順に公開します。',
            ],
            note: 'ローカル draft は編集できます。公開済みリリースは不変なので、変更は version draft と新規公開で行います。',
          },
        ],
      },
      {
        id: 'data-model',
        category: 'creator',
        title: 'Maker データモデル',
        summary: '素材を読み込む前に Maker → Part → Item → Style を理解します。',
        sections: [
          {
            title: '四つの制作階層',
            bullets: [
              'Maker：メタデータ、Canvas、ルール、Soul 初期値、公開設定を含む再利用可能なテンプレート全体です。',
              'Part：Background、Skin、Eyes、Front Hair など、プレイヤーメニューの分類です。',
              'Item：Long Hair のように、一つの Part 内でクリックする部品です。',
              'Style：最小の描画単位です。一つの Style は一枚の PNG と、独立した変形、外観、ルール、ロック、Layer Track、任意の Smart Color 接続を持ちます。',
            ],
          },
          {
            title: '独立 ID と二種類の順序',
            paragraphs: [
              'Part のメニュー順は閲覧順を、Layer Track 順は視覚的な z-order だけを制御します。一方を変えても他方を暗黙に変えてはいけません。',
            ],
            bullets: [
              '新しい Item には Default Style が一つ作られます。',
              'Duplicate は新しい ID を発行し、選択した配下を完全に deep copy します。',
              'Required Part には有効な選択が必要で、Optional Part は None / Remove を提供できます。',
              '表示名は変更できますが、Recipe と版比較には安定 ID が使われます。',
            ],
          },
        ],
      },
      {
        id: 'artist-source-files',
        category: 'creator',
        title: 'アーティスト用ソースファイル仕様',
        summary: '一つの整列済みマスターデータから、すべての Style を正確に書き出します。',
        sections: [
          {
            title: '一つの Master Canvas を作る',
            bullets: [
              '最終 Maker と同じ幅、高さ、原点、sRGB 色空間を持つ PSD、CLIP、KRA のマスターを一つ使います。',
              '参照ガイドは非書き出しグループに置き、すべての差分を最終位置で描きます。',
              'ソース内の Style グループは線画、影、ハイライトの子レイヤーを持てますが、全体を一枚の透明 PNG に統合して書き出します。',
              '透明余白が位置情報を持つフル Canvas 素材では余白を切り取らないでください。',
            ],
          },
          {
            title: '納品すべき内容',
            bullets: [
              '編集可能なマスターソース。作者が選ばない限り公開しません。',
              'Style ごとの透明 PNG と、安定した Part__Item__Style ファイル名。',
              'デフォルト合成画像と組み合わせチェックシート。',
              '一括読み込みには part/item/style.png のフォルダー構成を使い、自動マッピング後に全項目を手動確認します。',
            ],
            note: 'Animacraft が読む ZIP は独自 project schema で、汎用 manifest は読みません。座標だけでは頭身、カメラ角度、ポーズ、服の輪郭の不一致も直せません。',
          },
        ],
      },
      {
        id: 'png-import',
        category: 'creator',
        title: 'PNG の読み込みと差し替え',
        summary: '整列素材を読み込み、表示ズームと素材スケールを分けて扱います。',
        sections: [
          {
            title: '現在の読み込み動作',
            bullets: [
              'PNG 寸法が Maker Canvas と完全一致する場合、X 0、Y 0、Scale 1、Rotation 0 で 1:1 読み込みされます。',
              'フル Canvas ではない PNG は、必要な場合だけ縦横比を保って縮小され、Canvas 中央に配置されます。',
              '中央配置された独立素材は、公開前に必ず手動で位置を確認・調整してください。',
              '実体が PNG で、20 MB 以下、各辺 8,192 px 以下、合計 16,777,216 pixel 以下である必要があります。透明領域の診断は元 PNG を切り取りません。',
            ],
          },
          {
            title: '一括マッピングと差し替え',
            bullets: [
              '一括確定前に、各ファイルから Part、Item、Style への割り当てを確認します。',
              'Canvas 寸法の不一致は手動確認事項で、importer の hard error ではありません。ただし公開 Style の完全透明画像はリリース検査に失敗します。',
              'PNG 差し替えで transform を保持するのは positionLocked=true の場合だけです。未ロックなら新 PNG の規則で X/Y/Scale/Rotation を設定し、positionConfirmed=false に戻します。',
              '差し替え後も Layer Track、Smart Color、Rules、ロック状態、サムネイル設定は維持します。',
              'ピクセル確認には表示ズームを使い、保存される Style scale を変えないでください。',
            ],
            note: '本番素材は透明余白で共通座標を保持できるフル Canvas PNG が最も安全です。',
          },
        ],
      },
      {
        id: 'canvas-layer-tracks',
        category: 'creator',
        title: 'Canvas と Layer Tracks',
        summary: 'Style を正確に配置し、全体の描画順を予測可能にします。',
        sections: [
          {
            title: 'Canvas 操作',
            bullets: [
              '移動前に正しい Style を選び、パンくずが Part › Item › Style になっていることを確認します。',
              'ドラッグで配置し、数値 X、Y、均等 Scale、Rotation で再現可能な調整を行います。',
              'Show all、Dim others、Solo current Style で重なりを点検します。',
              '承認後は position lock または Style 全体の lock を使います。appearance-only lock はありません。',
              'ピクセルアートでは必要に応じて nearest-neighbor 表示と整数座標を使います。',
            ],
          },
          {
            title: '奥から手前への描画',
            paragraphs: [
              'Layer Tracks は全体の描画順を奥から手前へ定義します。PNG の座標やプレイヤーメニュー順は変更しません。',
            ],
            bullets: [
              '公開する全 Style を有効な Track に割り当てます。',
              '作品構造に合う場合は標準 Part と連動する Track を同期します。',
              '必要なら後ろ髪、身体、服、顔パーツ、前髪、前景に分けます。',
              'Creator Canvas、Player test、サムネイル、書き出し、公開プレビューで同じ合成を確認します。',
            ],
          },
        ],
      },
      {
        id: 'smart-color',
        category: 'creator',
        title: 'Smart Color',
        summary: '複数 Style を作者承認済みの決定的な色プリセットに連動させます。',
        sections: [
          {
            title: 'チャンネルの作成と接続',
            bullets: [
              'Color Channel を作り、プレイヤーに分かる名前と許可する全プリセットを設定します。',
              'フォールバック色に頼らず、明示的にデフォルトプリセットを選びます。',
              '対象 Style をそれぞれ開き、同じチャンネルへ接続します。',
              'gradient mapping で陰影を保つため、元絵に有効な明度差を持たせます。',
            ],
          },
          {
            title: 'プレイヤー動作と確認',
            bullets: [
              '現在の選択に、チャンネル接続済みの可視 Style がある場合だけ Palette が有効になります。',
              '一つのプリセットを選ぶと、そのチャンネルに接続された現在可視の Style が一緒に再着色されます。',
              'プレイヤーは作者が設定した連動を解除したり、作者が定義していない preset を作ったりできません。',
              '一つの Style が接続できる channel は最大一つで、Palette は現在の Style context の channel だけを表示します。',
              '全プリセットを全対象 Item で試し、初期値、サムネイル、PNG、Recipe、公開投影が一致するか確認します。',
              'Sui v2 は hidden Part/Item 選択で登録プリセットを検証します。gradient stops と pixel 単位の着色は Walrus manifest と browser Renderer にだけ存在します。',
            ],
            note: 'プリセットがない、または公開された接続 Style がないチャンネルは未完成です。',
          },
        ],
      },
      {
        id: 'rules',
        category: 'creator',
        title: 'Rules と Style visibility',
        summary: '選択ロジックと z-order を混同せず、有効な組み合わせを定義します。',
        sections: [
          {
            title: '組み合わせ Rules',
            bullets: [
              'requires は、選択された Part、Item、Style に一つ以上の依存先を要求します。',
              'excludes は所有元と各対象の同時選択を禁止し、複数対象はそれぞれ独立した conflict になります。',
              '全対象を要求するのは requires + ALL です。ANY は同じ Part 内の grouped selector で、Style 対象はさらに同じ Item に属する必要があります。',
              '広い条件には Part の any Item、厳密な条件には特定 Item または Style を指定します。',
              '問題が描画順だけなら Rules ではなく Layer Tracks を使います。',
            ],
          },
          {
            title: 'Style visibility と公開時の正確な説明',
            bullets: [
              'Always visible は、その Item と Style が選ばれている間は通常描画します。',
              'Selected / not-selected 条件は、依存状態が一致したときだけ該当 Style を表示します。',
              'Player の可用性、Renderer の可視性、Random、Preflight は同じ canonical rule engine を使います。',
              '完全なルールグラフは Walrus manifest に保存します。Sui v2 には等価な compiled projection が必要で、等価性を生成できない場合は公開が fail closed します。',
            ],
            note: '未解決の旧ターゲット、hierarchy cycle、矛盾、playable Recipe がない状態、到達不能な公開内容は修正まで公開をブロックします。',
          },
        ],
      },
      {
        id: 'soul-configuration',
        category: 'creator',
        title: 'Soul Configuration',
        summary: '各 OC に編集可能な人格、記憶、スキルの初期値を提供します。',
        sections: [
          {
            title: '三つの Living Content ファイル',
            bullets: [
              'soul.md は Personality & identity、話し方、価値観、境界、世界、継続性を定義します。',
              'memory.md はキャラクターが最初に持つ記憶と文脈を定義します。',
              'SKILL.md はスキル、動作指示、関連ドキュメントを定義します。',
              '作者の初期値は Maker と一緒に保存され、Player Editor の OC 設定カードに表示されます。',
            ],
          },
          {
            title: 'プレイヤー継承と引き渡し',
            bullets: [
              'プレイヤーは許可範囲内で、その OC 向けに文章を調整できます。',
              'OC 名、説明、世界、タグ、選択素材、三つの Living Content は一緒に保存されます。',
              'OC の Walrus Quilt は確認済み PNG と animacraft-oc.json で構成され、三つの Living Content は profile JSON 内に埋め込まれます。',
              'ダウンロード可能な Soulidity handoff ZIP だけが、それらを個別ファイルに分解します。',
              '監査済み連携が有効になると、Soulidity が正規 Soul とその後の Living Content を担当します。',
            ],
            note: 'Canonical Soul Mainnet 引き渡しは現在ゲートされています。設定の制作とパッケージ化はできますが、Soul mint 完了とは表現できません。',
          },
        ],
      },
      {
        id: 'player-test-preflight',
        category: 'publish',
        title: 'Player test と Preflight',
        summary: '実際のプレイヤー画面で試し、公開ブロッカーをすべて解消します。',
        sections: [
          {
            title: '現実的な Player test',
            bullets: [
              'Creator Studio から Player test を開き、制作 Canvas だけで判断しないでください。',
              '全 Part、Item、Style と、Optional Part の None / Remove を試します。',
              '全 Smart Color、Rules 境界、Random、Reset、Undo、Redo、最終 PNG 書き出しを確認します。',
              'モバイルとデスクトップを確認し、一度再読み込みして draft 復元も試します。',
            ],
          },
          {
            title: 'Preflight の読み方',
            bullets: [
              'blocking issue は Prepare Quilt 前に必ず解消します。',
              'warning も、位置ずれ、未使用チャンネル、互換性変更、任意コンテンツを中心に意識して確認します。',
              '公開用出力を確認し、draft や hidden 素材が含まれないようにします。',
              '素材、Rules、Track、Soul、Expansion Pack の変更後は再実行します。',
            ],
            note: '制作プレビューが正常なだけでは不十分です。Player、Renderer、manifest、Sui projection が一致する必要があります。',
          },
        ],
      },
      {
        id: 'walrus-sui-publish',
        category: 'publish',
        title: 'Walrus と Sui で公開する',
        summary: '再開可能な Mainnet 公開の四段階を理解します。',
        sections: [
          {
            title: '四つのステップ',
            bullets: [
              'Prepare Quilt は確認済みリリースをエンコードし、現在の保存見積もりを計算します。',
              'Register & upload は必要な支払いを署名し、Quilt を Walrus へ送ります。',
              'Certify Walrus は保存結果を確定します。認証直後は object の可視化に少し遅延する場合があります。',
              'Publish on Sui は不変 OCMaker リリースと管理 object を作成します。',
            ],
          },
          {
            title: '費用、再試行、成功判定',
            bullets: [
              'MIST は SUI、FROST は WAL の単位です。Sui transaction gas はウォレットに別表示されます。',
              'ライブ見積もりが変わった場合は、新しい quote を作って金額を再確認します。',
              '表示される upload quote は relay tip と WAL storage/write だけを含み、完全な Sui gas 見積もりではありません。',
              'ネットワーク timeout や認証済み Blob の一時的な非表示は、保存 checkpoint から再開します。',
              'Sui transaction が成功し、新しい Maker が取得可能になって初めて公開完了です。',
            ],
            note: '53 Walrus epoch はおよそ 2 年です。不変は永久を意味しません。Blob object を記録し、retention 期限前に保存期間を更新してください。',
          },
        ],
      },
      {
        id: 'lifecycle-versions',
        category: 'publish',
        title: 'ライフサイクルとバージョン管理',
        summary: '履歴を上書きせず draft と不変 chain release を管理します。',
        sections: [
          {
            title: 'ライフサイクル状態',
            bullets: [
              'Draft はローカルで編集可能です。',
              'Publishing / Recoverable は進行中または再開可能な Walrus/Sui checkpoint です。',
              'Active は Commerce v5 と Canonical Soul の全体 gate も有効な場合に、Base/Pack 購入と Complete authorization を許可します。',
              'Paused は購入と新規 authorization を止め、既存 entitlement、回数、OC、来歴を保持します。',
              'Sale pending は停止中リリースが on-chain 出品され、取消または購入完了まで管理操作がロックされた状態です。',
              'Archived は復元可能な Sui 状態を保って利用を停止します。Walrus file は更新しない限り購入済み retention の期間内だけ利用できます。',
              'Version draft は公開済みスナップショットから派生した、ローカルで編集可能なバージョン草稿です。',
            ],
          },
          {
            title: '安全な更新',
            bullets: [
              'Creator Library の Manage status または lifecycle badge から管理画面を開きます。',
              'version draft を作り、互換性を確認して別の不変 OCMaker として公開します。',
              '旧バージョンと Recipe は引き続き個別に識別できます。',
              'Commerce v5 の chain 管理には現在の epoch に対応する MakerControlCapV5 所有者が必要です。',
              '新しい不変公開ごとに別の MakerRootV5 が作られます。封印済み Style registry、購入、回数、Recipe は新バージョンへ自動移行しません。',
              'Maker 出品前に Paused にし、Maker Treasury を空にする必要があります。購入で運営者が変わっても、そのリリースの Base/Pack 権利は維持されます。',
              'バージョン関係は manifest と client に記録されます。Move には現在 successor link がなく、旧版を自動置換しません。',
            ],
            note: '永久廃止と原子的な onchain supersession は、意味を定義する監査済み protocol upgrade までロックされています。',
          },
        ],
      },
      {
        id: 'expansion-packs',
        category: 'publish',
        title: 'Expansion Packs',
        summary: '一つの不変 Maker リリース内で無料または買い切りの任意コンテンツを公開します。',
        sections: [
          {
            title: 'アクセスと Complete policy',
            bullets: [
              '各 Pack は一つの不変 Walrus Maker package に含まれ、Sui 上でそのリリースの MakerRootV5 に登録されます。',
              'FREE、ONE_TIME_PAID、または必須 core content を選択します。購入済み wallet はその Pack を同じリリースで永久利用できます。',
              'Pack ごとに unlimited free、free quota then paid、paid every time、free quota then blocked の Complete policy を設定できます。',
              '無料 Pack に claim transaction は不要です。有料 Pack は、その exact Style を使う前に購入が必要です。',
            ],
          },
          {
            title: '不変コンテンツの境界',
            bullets: [
              'Pack はベース default Recipe の置換や、既存ベース内容の暗黙編集をできません。',
              '新しい requires は Pack 所有内容から発火し、excludes は Pack 所有内容を含む必要があります。',
              '各 exact Style は Base または一つの Pack product として封印され、Item-level Recipe で有料 Style を回避できません。',
              'Pack artwork、所属、rule の変更には新しい Maker version が必要で、以前の購入は以前のリリースに残ります。',
            ],
            note: 'Pack は一つの release Root 内の on-chain policy record であり、独立譲渡できる Maker や Maker の入れ子ではありません。',
          },
        ],
      },
      {
        id: 'commerce-rights',
        category: 'publish',
        title: 'Commerce、権利、ロイヤリティ',
        summary: '有料 Creator と Player を招く前に、Sui が強制する内容を確認します。',
        sections: [
          {
            title: '権利の由来と一次アクセス',
            bullets: [
              'ONCHAIN_NATIVE は Maker の on-chain 初出を宣言します。LICENSE_WRAPPED は既存の従来ライセンスを on-chain 表現し、off-chain 紛争は外部ライセンスに従います。',
              'Base は無料または買い切りです。Base と使用中の各 Pack には、個別の Complete 価格、wallet ごとの無料回数、全体上限を設定できます。',
              '一次 Creator 料金は現在の運営者の Maker Treasury 90%、Animacraft protocol 10% に分配されます。Sui gas、Walrus 保存、固定 Complete protocol fee は別表示です。',
              '支払い、exact Style authorization、回数更新、canonical Soul mint は一つの transaction ですべて成功しなければ全体が rollback します。',
              'Commerce v5 に refund 経路はありません。wallet は署名前に正確な金額を確認し、atomic transaction が失敗した場合は送金されません。',
            ],
          },
          {
            title: '所有権と二次流通',
            bullets: [
              'Maker 転売には Paused と Maker Treasury 残高 0 が必要です。出品後は取消または購入まで管理がロックされます。',
              'Maker 転売の既定値は seller 92.5%、protocol 2.5%、original Maker creator 5% です。この original-creator 比率は exact Style registry の seal 時に固定され、後の運営者は引き下げられず、original creator も変わりません。',
              '最初の Soul mint で Soul creator と Maker-source royalty を固定します。既定値は各 2.5%、0–5% を 0.5% 単位で選択できます。',
              'Soul 転売では Soulidity protocol 2.5% が常に加算されます。固定された Soul creator と Maker-source の合計は最大 10% なので、seller は最低 87.5% を受け取ります。',
              '後の Soul holder は固定 royalty を下げられません。creator profile、like、collection、公開 market は Soulidity が担当します。',
            ],
            note: '二つの package upgrade、shared object、runtime ID、無料/有料 Mainnet 証跡を検証するまで Commerce v5 は production で fail-closed です。',
          },
        ],
      },
      {
        id: 'chain-truth',
        category: 'reference',
        title: 'ローカル、Walrus、Sui のどこに何がある？',
        summary: 'draft、ファイル、protocol 状態、Soul 引き渡しを正確に説明します。',
        sections: [
          {
            title: 'それぞれの正本',
            bullets: [
              'ブラウザー IndexedDB：編集可能 draft、source blob、revision、ローカル player state、再開 checkpoint。',
              'Walrus：購入した retention 期間中の不変 Maker manifest、公開無料素材、有料 Style ciphertext、独立した公開 cover/preview、保護された最終 OC ciphertext、Soul 初期値、release package。有料 plaintext は公開 Quilt に入りません。期限前の更新が必要です。',
              'Sui：OCMaker 来歴、release ごとの MakerRootV5 lifecycle、exact Style product registry、Base/Pack entitlement、Complete 回数と料金、Treasury、listing、rule projection。',
              'Soulidity：連携後の唯一の正規 Soul と、Living Content、identity、social、market のライフサイクル。',
            ],
          },
          {
            title: 'いつ onchain と呼べるか',
            paragraphs: [
              'ローカル保存は公開ではありません。Walrus 認証はパッケージ保存を意味しますが、Sui 公開 transaction 成功後に Maker 公開が完了します。',
              'Maker 公開だけでは player Recipe は登録されません。non-droppable authorization は canonical Soul を作る同じ成功 transaction 内だけで作成・消費されます。',
            ],
            note: 'Walrus の不変性は retention 中に限られ、更新なしで永久には保存されません。Canonical Soul Mainnet route は現在無効です。',
          },
        ],
      },
      {
        id: 'troubleshooting',
        category: 'reference',
        title: 'トラブルシューティングと復旧',
        summary: '状況を悪化させず draft と公開 checkpoint を回復します。',
        sections: [
          {
            title: 'draft と editor の問題',
            bullets: [
              'draft が消えたように見えても site data を削除せず、接続 wallet と recovery tool を先に確認します。',
              '素材位置が違う場合、再アップロード前に PNG 寸法、Style transform、Layer Track を比較します。',
              'Palette がない場合、現在可視の Style がプリセット付き公開 channel に接続されているか確認します。',
              'Random が解を出せない場合、Required Part、requires/excludes、Style visibility、Expansion Pack compatibility を確認します。',
              '大きな修復前に project backup を書き出します。',
            ],
          },
          {
            title: '公開の問題',
            bullets: [
              'UPLOAD_QUOTE_CHANGED は Quilt またはライブ価格の変更です。新しい quote を準備して承認します。',
              'NETWORK_UNAVAILABLE / timeout は wallet と network を確認後、保存済みの現在ステップを再試行します。',
              '認証済み Blob がすぐ取得できない場合は certification を再開し、既存結果を照会します。',
              '成功後は Sui object が観測可能になってから discovery を更新します。',
              'サポート用に technical details をコピーできますが、秘密鍵や復旧フレーズは共有しないでください。',
            ],
          },
        ],
      },
    ],
  },
  ko: {
    ui: {
      searchPlaceholder: 'Animacraft 가이드 검색',
      noResults: '일치하는 주제가 없습니다. Part, Smart Color, Walrus 또는 Sui로 검색해 보세요.',
      updatedLabel: '문서',
      readLabel: '가이드 읽기',
      previous: '이전',
      next: '다음',
      allTopics: '모든 주제',
      backToHome: '모든 가이드로 돌아가기',
      onThisPage: '이 페이지의 내용',
    },
    categories: [
      { id: 'start', title: '시작하기', description: 'Animacraft를 이해하고 역할에 맞는 경로를 선택합니다.' },
      { id: 'player', title: 'OC 만들기', description: '아트와 색상을 선택하고 OC 패키지를 준비합니다.' },
      { id: 'creator', title: 'Maker 만들기', description: '정렬된 아트로 실제 사용 가능한 Maker를 제작합니다.' },
      { id: 'publish', title: '테스트와 게시', description: '검증, 저장, 게시 및 불변 릴리스를 관리합니다.' },
      { id: 'reference', title: '참고 자료', description: '로컬, Walrus, Sui 및 아직 잠긴 기능을 구분합니다.' },
    ],
    articles: [
      {
        id: 'introduction',
        category: 'start',
        title: 'Animacraft란?',
        summary: '재사용 가능한 캐릭터 Maker와 Soul용 OC를 만드는 제작 레이어입니다.',
        sections: [
          {
            title: '하나의 Maker, 다양한 OC',
            paragraphs: [
              'Animacraft는 백엔드 없는 캐릭터 Maker 편집기입니다. 크리에이터는 PNG를 Part, Item, Style 선택지로 구성하고, 플레이어는 이를 조합해 OC를 만듭니다.',
              'Walrus는 불변 제작 패키지와 전체 Maker manifest를 보관합니다. Sui는 Maker 출처, 소유권, 게시 상태, 경제 설정, 동등하게 compiled된 Sui v2 규칙 투영을 기록합니다.',
            ],
            bullets: [
              'Creator Studio에서 Maker를 제작하고 테스트합니다.',
              'Player Editor에서 아트, Smart Color 프리셋, Soul 콘텐츠를 선택합니다.',
              '완성된 Soul의 정식 목적지는 Soulidity이며 Animacraft는 경쟁하는 캐릭터 Token을 만들지 않습니다.',
            ],
          },
          {
            title: '현재 운영 범위',
            paragraphs: [
              'Walrus 및 Sui Mainnet으로 Maker를 게시할 수 있습니다. 전용 Canonical Soul Mainnet 전달은 검토된 Soulidity adapter와 공유 수수료 객체가 활성화될 때까지 fail-closed 상태입니다.',
            ],
            note: '게이트가 열리기 전 Complete OC는 OC 패키지를 준비하고 보존한다는 뜻이며, 정식 Soul mint 완료를 증명하지 않습니다.',
          },
        ],
      },
      {
        id: 'player-quick-start',
        category: 'player',
        title: '플레이어 빠른 시작',
        summary: '검증된 Maker를 골라 OC를 만들고 결과를 내보냅니다.',
        sections: [
          {
            title: '외형 만들기',
            bullets: [
              '화면이 요구하는 Sui 지갑을 연결하고 검증된 Maker에서 Make OC를 엽니다.',
              '상단에서 Part를 선택한 뒤 Item 카드를 고릅니다. 여러 Style이 있으면 작은 Style 변형을 선택합니다.',
              '현재 보이는 Style이 Smart Color 채널에 연결된 경우에만 Palette를 사용할 수 있습니다.',
              'Undo, Redo, Random, Remove optional, Reset으로 안전하게 시도합니다.',
              '비활성화되거나 숨겨진 선택지는 보통 Maker Rules의 의도된 결과입니다.',
            ],
          },
          {
            title: 'OC 완성하기',
            bullets: [
              'OC 이름, 세계, 설명, 태그를 입력합니다.',
              'Maker에서 상속한 Personality & identity, Memory, Skills를 확인하거나 수정합니다.',
              '표준 PNG는 Canvas를 확대하지 않으며 긴 변을 최대 1,024 px로 제한합니다. 원본 크기는 Canvas가 8,388,608 pixel 이하일 때만 제공됩니다.',
              '투명 내보내기는 export-background로 표시된 Part만 제거하며 인물 누끼 기능이 아닙니다. JPEG, WebP, 사용자 지정 크기는 제공하지 않습니다.',
              'Complete OC는 전달 흐름을 위해 Recipe와 Soul용 콘텐츠를 보존합니다.',
            ],
            note: 'Canonical Soul Mainnet 게이트는 현재 꺼져 있습니다. 준비된 OC가 곧 정식 Soul mint를 뜻하지는 않습니다.',
          },
        ],
      },
      {
        id: 'creator-quick-start',
        category: 'creator',
        title: '크리에이터 빠른 시작',
        summary: '최소 유효 Maker를 만들고 Player test까지 완료합니다.',
        sections: [
          {
            title: '첫 플레이 가능 버전 제작',
            bullets: [
              'Maker draft를 만들고 제목, 설명, 커버, 크리에이터 정보, Canvas, 라이선스 스냅샷을 설정합니다.',
              'Part를 추가하고 그 안에 Item을 만든 뒤 Default Style PNG를 업로드합니다.',
              '최소 선택지를 만든 후 Layer Tracks를 뒤에서 앞으로 정렬합니다.',
              '아트에 필요할 때만 Smart Color와 Rules를 추가합니다.',
              '기본 soul.md, memory.md, SKILL.md를 설정합니다.',
            ],
          },
          {
            title: '게시 전 실제 동작 증명',
            bullets: [
              '저장 후 Player test에서 일반 선택, Random, Reset, 색상, 내보내기를 시험합니다.',
              'Preflight를 실행하고 모든 차단 문제를 해결합니다.',
              'Prepare Quilt, Register & upload, Certify Walrus, Publish on Sui 순서로 게시합니다.',
            ],
            note: '로컬 draft는 편집할 수 있지만 게시 릴리스는 불변입니다. 이후 변경은 version draft와 새 게시가 필요합니다.',
          },
        ],
      },
      {
        id: 'data-model',
        category: 'creator',
        title: 'Maker 데이터 모델',
        summary: '아트를 가져오기 전에 Maker → Part → Item → Style을 이해합니다.',
        sections: [
          {
            title: '네 가지 제작 계층',
            bullets: [
              'Maker: 메타데이터, Canvas, 규칙, Soul 기본값, 게시 설정을 포함한 전체 재사용 템플릿입니다.',
              'Part: Background, Skin, Eyes, Front Hair 같은 플레이어 메뉴 분류입니다.',
              'Item: Long Hair처럼 한 Part 안에서 클릭하는 부품입니다.',
              'Style: 최소 렌더 단위입니다. 한 Style은 정확히 한 PNG와 독립 transform, 외형, 규칙, 잠금, Layer Track, 선택적 Smart Color 연결을 가집니다.',
            ],
          },
          {
            title: '독립 ID와 두 가지 순서',
            paragraphs: [
              'Part 메뉴 순서는 플레이어 탐색 순서를, Layer Track 순서는 시각적 z-order만 제어합니다. 한쪽 정렬이 다른 쪽을 몰래 바꾸면 안 됩니다.',
            ],
            bullets: [
              '새 Item에는 Default Style 하나가 자동 생성됩니다.',
              'Duplicate는 새 ID를 만들고 선택한 하위 트리를 완전히 deep copy합니다.',
              'Required Part는 유효한 선택이 필요하고 Optional Part는 None / Remove를 제공할 수 있습니다.',
              '표시 이름은 바꿀 수 있지만 Recipe와 버전 비교에는 안정 ID를 사용합니다.',
            ],
          },
        ],
      },
      {
        id: 'artist-source-files',
        category: 'creator',
        title: '아티스트 원본 파일 규격',
        summary: '정렬된 하나의 마스터 문서로 모든 Style을 정확히 맞춥니다.',
        sections: [
          {
            title: '하나의 Master Canvas 구성',
            bullets: [
              '최종 Maker와 같은 너비, 높이, 원점, sRGB 색공간을 가진 PSD, CLIP 또는 KRA 마스터를 사용합니다.',
              '가이드는 내보내지 않는 그룹에 두고 모든 대체 아트를 최종 위치에서 그립니다.',
              '원본의 Style 그룹에는 선화, 그림자, 하이라이트 하위 레이어가 있어도 되지만 전체를 한 장의 투명 PNG로 병합해 내보냅니다.',
              '전체 Canvas의 투명 여백이 위치를 보존한다면 여백을 잘라내지 않습니다.',
            ],
          },
          {
            title: '아티스트 납품물',
            bullets: [
              '편집 가능한 마스터 원본 파일. 크리에이터가 원하지 않으면 공개하지 않습니다.',
              'Style별 투명 PNG와 안정적인 Part__Item__Style 파일명.',
              '기본 합성 이미지와 조합 검사 시트.',
              '일괄 가져오기는 part/item/style.png 폴더 구조를 사용하고 자동 매핑 뒤 모든 항목을 수동 확인합니다.',
            ],
            note: 'Animacraft는 자체 project ZIP schema만 읽고 범용 manifest는 읽지 않습니다. 좌표로 머리 비율, 카메라 각도, 자세, 의상 실루엣 차이도 고칠 수 없습니다.',
          },
        ],
      },
      {
        id: 'png-import',
        category: 'creator',
        title: 'PNG 가져오기와 교체',
        summary: '정렬 레이어를 가져오고 보기 확대와 자산 배율을 분리합니다.',
        sections: [
          {
            title: '현재 가져오기 동작',
            bullets: [
              'PNG 크기가 Maker Canvas와 정확히 같으면 X 0, Y 0, Scale 1, Rotation 0으로 1:1 가져옵니다.',
              '전체 Canvas가 아닌 PNG는 필요한 경우에만 비율을 유지해 축소하고 Canvas 중앙에 배치합니다.',
              '중앙 배치된 개별 자산은 게시 전에 반드시 수동으로 위치를 확인하고 조정합니다.',
              '실제 PNG여야 하며 20 MB 이하, 각 변 8,192 px 이하, 총 16,777,216 pixel 이하여야 합니다. 투명 경계 진단은 원본을 자르지 않습니다.',
            ],
          },
          {
            title: '일괄 매핑과 교체',
            bullets: [
              '일괄 확정 전에 각 파일의 Part, Item, Style 매핑을 확인합니다.',
              'Canvas 크기 불일치는 수동 검토 조건이지 importer hard error는 아닙니다. 다만 완전 투명한 공개 Style은 릴리스 검사를 통과하지 못합니다.',
              'PNG 교체 시 positionLocked=true인 경우에만 transform을 보존합니다. 잠겨 있지 않으면 새 PNG 규칙으로 X/Y/Scale/Rotation을 설정하고 positionConfirmed=false가 됩니다.',
              '교체 후에도 Layer Track, Smart Color, Rules, 잠금 상태, 썸네일 선택은 유지합니다.',
              '픽셀 검사는 보기 확대를 사용하며 저장된 Style scale을 바꾸지 않습니다.',
            ],
            note: '운영 아트에는 투명 여백으로 공통 좌표를 보존하는 전체 Canvas PNG가 가장 안전합니다.',
          },
        ],
      },
      {
        id: 'canvas-layer-tracks',
        category: 'creator',
        title: 'Canvas와 Layer Tracks',
        summary: '각 Style을 배치하고 전역 렌더 순서를 예측 가능하게 유지합니다.',
        sections: [
          {
            title: 'Canvas 조작',
            bullets: [
              '이동 전에 정확한 Style을 선택하고 경로가 Part › Item › Style인지 확인합니다.',
              '드래그로 배치하고 숫자 X, Y, 균일 Scale, Rotation으로 재현 가능한 정렬을 만듭니다.',
              'Show all, Dim others, Solo current Style로 겹침을 점검합니다.',
              '승인 후 position lock 또는 full Style lock을 사용합니다. appearance-only lock은 없습니다.',
              '픽셀 아트는 필요할 때 nearest-neighbor 미리보기와 정수 좌표를 사용합니다.',
            ],
          },
          {
            title: '뒤에서 앞으로 그리기',
            paragraphs: [
              'Layer Tracks는 전역 렌더 순서를 뒤에서 앞으로 정의합니다. PNG 위치와 플레이어 메뉴 순서를 바꾸지는 않습니다.',
            ],
            bullets: [
              '모든 공개 Style을 유효한 Track에 배정합니다.',
              '아트 모델에 맞으면 표준 Part 연동 Track을 동기화합니다.',
              '필요하면 뒷머리, 몸, 옷, 얼굴 세부, 앞머리, 전경 Track을 분리합니다.',
              'Creator Canvas, Player test, 썸네일, 내보내기, 게시 미리보기에서 동일한 합성을 확인합니다.',
            ],
          },
        ],
      },
      {
        id: 'smart-color',
        category: 'creator',
        title: 'Smart Color',
        summary: '여러 Style을 크리에이터가 승인한 결정적 색상 프리셋에 연결합니다.',
        sections: [
          {
            title: '채널 생성과 연결',
            bullets: [
              'Color Channel을 만들고 플레이어가 이해할 이름과 승인된 모든 프리셋을 추가합니다.',
              '대체 색에 기대지 말고 기본 프리셋을 명시적으로 선택합니다.',
              '관련 Style을 각각 열어 같은 채널에 연결합니다.',
              'gradient mapping이 음영을 보존하도록 원본 아트에 유용한 명도 차이를 둡니다.',
            ],
          },
          {
            title: '플레이어 동작과 검사',
            bullets: [
              '현재 선택에 채널 연결된 보이는 Style이 있을 때만 Palette가 활성화됩니다.',
              '프리셋 하나를 고르면 그 채널에 연결된 현재 보이는 Style이 함께 다시 채색됩니다.',
              '플레이어는 크리에이터가 설정한 연결을 해제하거나 크리에이터가 정의하지 않은 preset을 만들 수 없습니다.',
              '각 Style은 최대 한 channel에만 연결할 수 있고 Palette에는 현재 Style context의 channel만 표시됩니다.',
              '모든 프리셋을 모든 연결 Item에서 테스트하고 기본값, 썸네일, PNG, Recipe, 게시 투영이 일치하는지 확인합니다.',
              'Sui v2는 hidden Part/Item 선택으로 등록 프리셋을 검증합니다. gradient stops와 pixel 단위 색칠은 Walrus manifest와 browser Renderer에만 있습니다.',
            ],
            note: '프리셋이 없거나 공개 연결 Style이 없는 채널은 불완전하므로 게시 전에 수정해야 합니다.',
          },
        ],
      },
      {
        id: 'rules',
        category: 'creator',
        title: 'Rules와 Style visibility',
        summary: '선택 논리와 z-order를 섞지 않고 유효 조합을 만듭니다.',
        sections: [
          {
            title: '조합 Rules',
            bullets: [
              'requires는 선택된 Part, Item 또는 Style이 하나 이상의 대상을 필요로 하게 합니다.',
              'excludes는 소유자와 각 대상의 동시 선택을 막으며 여러 대상은 각각 독립 conflict입니다.',
              '모든 대상을 요구하는 것은 requires + ALL입니다. ANY는 같은 Part 안의 grouped selector이며 Style 대상은 같은 Item에도 속해야 합니다.',
              '넓은 조건에는 Part의 any Item, 정밀한 조건에는 정확한 Item이나 Style을 대상으로 합니다.',
              '문제가 그리기 순서뿐이라면 Rules가 아니라 Layer Tracks를 사용합니다.',
            ],
          },
          {
            title: 'Style visibility와 게시 진실',
            bullets: [
              'Always visible은 해당 Item과 Style이 선택된 동안 정상 렌더합니다.',
              'Selected와 not-selected 조건은 의존 상태가 맞을 때만 정확한 Style을 표시합니다.',
              '플레이어 가용성, Renderer visibility, Random, Preflight는 같은 canonical rule engine을 사용합니다.',
              '전체 규칙 그래프는 Walrus manifest에 저장합니다. Sui v2에는 동등한 compiled projection이 필요하며, 동등성을 만들 수 없으면 게시가 fail closed됩니다.',
            ],
            note: '해결되지 않은 구형 대상, hierarchy cycle, 모순, playable Recipe 부재 또는 도달 불가능한 공개 콘텐츠는 수정 전까지 게시를 막습니다.',
          },
        ],
      },
      {
        id: 'soul-configuration',
        category: 'creator',
        title: 'Soul Configuration',
        summary: '각 OC에 편집 가능한 정체성, 기억, 기술 기본값을 제공합니다.',
        sections: [
          {
            title: '세 가지 Living Content 파일',
            bullets: [
              'soul.md는 Personality & identity, 말투, 가치, 경계, 세계, 연속성을 정의합니다.',
              'memory.md는 캐릭터의 시작 기억과 맥락을 정의합니다.',
              'SKILL.md는 기술, 운용 지침, 연결 문서를 정의합니다.',
              '크리에이터 기본값은 Maker와 함께 저장되고 Player Editor의 OC 설정 카드에 표시됩니다.',
            ],
          },
          {
            title: '플레이어 상속과 전달',
            bullets: [
              '플레이어는 허용 범위 안에서 이 OC에 맞게 문장을 수정할 수 있습니다.',
              'OC 이름, 설명, 세계, 태그, 선택 아트, 세 Living Content 파일을 함께 보존합니다.',
              'OC Walrus Quilt는 검토한 PNG와 animacraft-oc.json으로 구성되며 세 Living Content 문서는 profile JSON 안에 포함됩니다.',
              '다운로드 가능한 Soulidity handoff ZIP만 이 콘텐츠를 개별 파일로 다시 분리합니다.',
              '검토된 통합이 활성화되면 Soulidity가 정식 Soul과 이후 Living Content를 담당합니다.',
            ],
            note: 'Canonical Soul Mainnet 전달은 현재 잠겨 있습니다. 설정 제작과 패키징은 가능하지만 Soul mint 완료라고 주장할 수 없습니다.',
          },
        ],
      },
      {
        id: 'player-test-preflight',
        category: 'publish',
        title: 'Player test와 Preflight',
        summary: '실제 플레이어 화면을 테스트한 뒤 모든 릴리스 차단 문제를 해결합니다.',
        sections: [
          {
            title: '실제와 같은 Player test',
            bullets: [
              'Creator Studio에서 Player test를 열고 제작 Canvas만 보고 판단하지 않습니다.',
              '모든 Part, Item, Style과 Optional Part의 None / Remove를 시험합니다.',
              '모든 Smart Color, Rules 경계, Random, Reset, Undo, Redo, 최종 PNG 내보내기를 검사합니다.',
              '모바일과 데스크톱을 확인하고 한 번 새로고침해 draft 복원도 확인합니다.',
            ],
          },
          {
            title: 'Preflight 읽기',
            bullets: [
              'blocking issue는 Prepare Quilt 전에 모두 해결합니다.',
              'warning도 정렬 편차, 미사용 채널, 호환성 변경, 선택 콘텐츠를 중심으로 의식적으로 검토합니다.',
              '공개 전용 결과에 draft나 hidden 콘텐츠가 들어가지 않는지 확인합니다.',
              '아트, Rules, Track, Soul, Expansion Pack 변경 후 다시 실행합니다.',
            ],
            note: '제작 미리보기만 정상이어서는 부족합니다. Player, Renderer, manifest, Sui projection이 일치해야 합니다.',
          },
        ],
      },
      {
        id: 'walrus-sui-publish',
        category: 'publish',
        title: 'Walrus와 Sui로 게시하기',
        summary: '재개 가능한 Mainnet 게시의 네 단계를 이해합니다.',
        sections: [
          {
            title: '네 단계',
            bullets: [
              'Prepare Quilt는 검토한 릴리스를 인코딩하고 현재 저장 견적을 계산합니다.',
              'Register & upload는 필요한 결제에 서명하고 Quilt를 Walrus로 전송합니다.',
              'Certify Walrus는 저장 결과를 확정하며 인증 직후 객체 조회가 잠시 늦을 수 있습니다.',
              'Publish on Sui는 불변 OCMaker 릴리스와 관리 객체를 생성합니다.',
            ],
          },
          {
            title: '비용, 재시도, 성공',
            bullets: [
              'MIST는 SUI 단위, FROST는 WAL 단위이며 Sui transaction gas는 지갑에 별도로 표시됩니다.',
              '실시간 견적이 바뀌면 새 quote를 만들고 새 금액을 명시적으로 승인합니다.',
              '표시된 upload quote는 relay tip과 WAL storage/write만 포함하며 전체 Sui gas 견적이 아닙니다.',
              '네트워크 timeout이나 인증된 Blob의 일시적 비가시성은 저장 checkpoint에서 재개합니다.',
              'Sui transaction이 성공하고 새 Maker를 조회할 수 있어야 게시 완료입니다.',
            ],
            note: '53 Walrus epoch는 약 2년입니다. 불변은 영구를 뜻하지 않으므로 Blob object를 기록하고 retention 만료 전에 갱신하세요.',
          },
        ],
      },
      {
        id: 'lifecycle-versions',
        category: 'publish',
        title: '수명 주기와 버전 관리',
        summary: '기록을 덮어쓰지 않고 draft와 불변 chain release를 관리합니다.',
        sections: [
          {
            title: '수명 주기 상태',
            bullets: [
              'Draft는 로컬에서 편집할 수 있습니다.',
              'Publishing / Recoverable은 진행 중이거나 재개 가능한 Walrus/Sui checkpoint입니다.',
              'Active는 전역 Commerce v5와 Canonical Soul gate도 켜졌을 때 Base/Pack 구매와 Complete authorization을 허용합니다.',
              'Paused는 구매와 새 authorization을 막고 기존 entitlement, 횟수, OC, 출처를 보존합니다.',
              'Sale pending은 중단된 릴리스가 on-chain에 등록되어 취소 또는 구매 완료 전까지 관리가 잠긴 상태입니다.',
              'Archived는 복구 가능한 Sui 상태를 보존하며 사용을 중단합니다. Walrus 파일은 갱신하지 않으면 결제한 retention 기간에만 유지됩니다.',
              'Version draft는 게시된 스냅샷에서 파생한 로컬 편집 가능 버전 초안입니다.',
            ],
          },
          {
            title: '안전한 업데이트',
            bullets: [
              'Creator Library의 Manage status 또는 lifecycle badge에서 관리합니다.',
              'version draft를 만들고 호환성을 검토한 후 별도 불변 OCMaker로 게시합니다.',
              '이전 버전과 Recipe는 계속 독립적으로 식별됩니다.',
              'Commerce v5 chain 관리는 현재 epoch의 MakerControlCapV5 소유자가 수행해야 합니다.',
              '새 불변 게시마다 별도 MakerRootV5가 생성됩니다. 봉인된 Style registry, 구매 권한, 횟수, Recipe는 새 버전으로 자동 이동하지 않습니다.',
              'Maker 판매 등록 전 Paused 상태와 Maker Treasury 잔액 0이 필요합니다. 구매로 운영자가 바뀌어도 해당 릴리스의 Base/Pack 권한은 유지됩니다.',
              '버전 관계는 manifest와 client에 기록됩니다. Move에는 현재 successor link가 없고 구버전을 자동 교체하지 않습니다.',
            ],
            note: '영구 폐기와 원자적 onchain supersession은 의미를 정의할 검토된 protocol upgrade 전까지 잠겨 있습니다.',
          },
        ],
      },
      {
        id: 'expansion-packs',
        category: 'publish',
        title: 'Expansion Packs',
        summary: '하나의 불변 Maker 릴리스 안에서 무료 또는 일회성 유료 콘텐츠를 게시합니다.',
        sections: [
          {
            title: '접근 및 Complete 정책',
            bullets: [
              '각 Pack은 하나의 불변 Walrus Maker package에 포함되고 Sui에서 해당 릴리스의 MakerRootV5에 등록됩니다.',
              'FREE, ONE_TIME_PAID 또는 필수 core content를 선택합니다. 결제한 wallet은 그 Pack을 해당 릴리스에서 영구 사용합니다.',
              'Pack마다 unlimited free, free quota then paid, paid every time, free quota then blocked Complete 정책을 설정할 수 있습니다.',
              '무료 Pack은 claim transaction이 필요 없습니다. 유료 Pack의 exact Style은 구매 후 사용할 수 있습니다.',
            ],
          },
          {
            title: '불변 콘텐츠 경계',
            bullets: [
              'Pack은 기본 default Recipe를 교체하거나 기존 기본 콘텐츠를 몰래 수정할 수 없습니다.',
              '새 requires는 Pack 소유 콘텐츠에서 시작하고 excludes는 Pack 콘텐츠를 포함해야 합니다.',
              '모든 exact Style은 Base 또는 하나의 Pack product로 봉인되어 Item-level Recipe로 유료 Style을 우회할 수 없습니다.',
              'Pack artwork, 소속, rule을 바꾸려면 새 Maker version이 필요하며 이전 구매는 이전 릴리스에 유지됩니다.',
            ],
            note: 'Pack은 한 release Root 안의 on-chain policy record이며 독립 양도 Maker나 중첩 Maker가 아닙니다.',
          },
        ],
      },
      {
        id: 'commerce-rights',
        category: 'publish',
        title: 'Commerce, 권리와 로열티',
        summary: '유료 Creator와 Player를 초대하기 전에 Sui가 강제하는 규칙을 확인합니다.',
        sections: [
          {
            title: '권리 출처와 1차 접근',
            bullets: [
              'ONCHAIN_NATIVE는 Maker가 on-chain에서 처음 발행됐음을 선언합니다. LICENSE_WRAPPED는 기존 전통 라이선스를 on-chain에 표현하며 off-chain 분쟁은 외부 라이선스를 따릅니다.',
              'Base는 무료 또는 일회성 유료입니다. Base와 사용되는 각 Pack은 별도 Complete 가격, wallet별 무료 횟수, 전체 상한을 설정할 수 있습니다.',
              '1차 Creator 요금은 현재 운영자의 Maker Treasury 90%, Animacraft protocol 10%로 분배됩니다. Sui gas, Walrus 저장, 고정 Complete protocol fee는 별도로 표시합니다.',
              '결제, exact Style authorization, 횟수 증가, canonical Soul mint는 한 transaction에서 모두 성공해야 하며 실패하면 전체가 rollback됩니다.',
              'Commerce v5에는 환불 경로가 없습니다. wallet은 서명 전에 정확한 금액을 확인하며 atomic transaction이 실패하면 자금이 이동하지 않습니다.',
            ],
          },
          {
            title: '소유권과 재판매',
            bullets: [
              'Maker 재판매에는 Paused 상태와 Maker Treasury 잔액 0이 필요합니다. 등록 후에는 취소 또는 구매까지 관리가 잠깁니다.',
              '기본 Maker 재판매는 seller 92.5%, protocol 2.5%, original Maker creator 5%입니다. 이 original-creator 비율은 exact Style registry가 seal될 때 고정되어 이후 운영자가 낮출 수 없고 original creator도 바뀌지 않습니다.',
              '첫 Soul mint에서 Soul creator와 Maker-source royalty를 고정합니다. 기본은 각각 2.5%이며 0–5%를 0.5% 단위로 설정합니다.',
              'Soul 재판매에는 고정 Soulidity protocol 2.5%가 항상 추가됩니다. 동결된 Soul creator와 Maker-source 합계는 최대 10%이므로 seller는 최소 87.5%를 받습니다.',
              '이후 Soul holder는 고정 royalty를 낮출 수 없습니다. creator profile, like, collection, 공개 market은 Soulidity가 담당합니다.',
            ],
            note: '두 package upgrade, shared object, runtime ID, 무료/유료 Mainnet 증거를 모두 확인하기 전 Commerce v5는 production에서 fail-closed입니다.',
          },
        ],
      },
      {
        id: 'chain-truth',
        category: 'reference',
        title: '로컬, Walrus, Sui에는 무엇이 있나요?',
        summary: 'draft, 파일, protocol 상태, Soul 전달을 정확히 구분합니다.',
        sections: [
          {
            title: '각 진실이 저장되는 곳',
            bullets: [
              '브라우저 IndexedDB: 편집 draft, source blob, revision, 로컬 player state, 재개 checkpoint.',
              'Walrus: 구매한 retention 기간의 불변 Maker manifest, 공개 무료 이미지, 유료 Style ciphertext, 별도 공개 cover/preview, 보호된 최종 OC ciphertext, Soul 기본값, release package. 유료 plaintext는 공개 Quilt에 들어가지 않으며 만료 전 갱신해야 합니다.',
              'Sui: OCMaker 출처, 릴리스별 MakerRootV5 lifecycle, exact Style product registry, Base/Pack entitlement, Complete 횟수와 비용, Treasury, listing, rule projection.',
              'Soulidity: 통합 후 유일한 정식 Soul과 Living Content, identity, social, market 수명 주기.',
            ],
          },
          {
            title: '언제 onchain인가',
            paragraphs: [
              '로컬 저장은 게시가 아닙니다. Walrus 인증은 패키지 저장을 뜻하지만 Sui 게시 transaction이 성공해야 Maker 게시가 완료됩니다.',
              'Maker 게시만으로 player Recipe가 등록되지는 않습니다. non-droppable authorization은 canonical Soul을 만드는 동일한 성공 transaction 안에서만 생성되고 소비됩니다.',
            ],
            note: 'Walrus 불변성은 retention 기간에만 적용되며 갱신 없이 영구 보존되지 않습니다. Canonical Soul Mainnet route는 현재 꺼져 있습니다.',
          },
        ],
      },
      {
        id: 'troubleshooting',
        category: 'reference',
        title: '문제 해결과 복구',
        summary: '문제를 악화시키지 않고 draft와 게시 checkpoint를 복구합니다.',
        sections: [
          {
            title: 'draft와 편집기 문제',
            bullets: [
              'draft가 사라져 보여도 사이트 데이터를 지우지 말고 연결 지갑과 recovery tool을 먼저 확인합니다.',
              '아트 위치가 틀리면 재업로드 전에 PNG 크기, Style transform, Layer Track을 비교합니다.',
              'Palette가 없으면 현재 보이는 Style이 프리셋을 가진 공개 채널에 연결됐는지 확인합니다.',
              'Random 결과가 없으면 Required Part, requires/excludes, Style visibility, Expansion Pack 호환성을 확인합니다.',
              '큰 복구 전에 project backup을 내보냅니다.',
            ],
          },
          {
            title: '게시 문제',
            bullets: [
              'UPLOAD_QUOTE_CHANGED는 Quilt 또는 실시간 가격 변경이므로 새 quote를 준비하고 승인합니다.',
              'NETWORK_UNAVAILABLE / timeout은 지갑과 네트워크 확인 후 저장된 현재 단계를 재시도합니다.',
              '인증된 Blob이 바로 보이지 않으면 certification을 재개해 기존 결과를 조회합니다.',
              '게시 성공 후 Sui object가 관측 가능해진 다음 discovery를 새로고침합니다.',
              '지원 요청 전 technical details를 복사하되 지갑 비밀키나 복구 문구는 공유하지 않습니다.',
            ],
          },
        ],
      },
    ],
  },
  vi: {
    ui: {
      searchPlaceholder: 'Tìm trong hướng dẫn Animacraft',
      noResults: 'Không tìm thấy chủ đề phù hợp. Hãy thử Part, Smart Color, Walrus hoặc Sui.',
      updatedLabel: 'Tài liệu',
      readLabel: 'Đọc hướng dẫn',
      previous: 'Trước',
      next: 'Tiếp',
      allTopics: 'Tất cả chủ đề',
      backToHome: 'Quay lại tất cả hướng dẫn',
      onThisPage: 'Trong trang này',
    },
    categories: [
      { id: 'start', title: 'Bắt đầu tại đây', description: 'Hiểu Animacraft và chọn lộ trình phù hợp với vai trò của bạn.' },
      { id: 'player', title: 'Tạo OC', description: 'Chọn hình, phối màu và chuẩn bị gói OC.' },
      { id: 'creator', title: 'Tạo Maker', description: 'Chuẩn bị hình đã căn chỉnh và xây dựng Maker sẵn sàng sử dụng.' },
      { id: 'publish', title: 'Kiểm thử và xuất bản', description: 'Xác minh, lưu trữ, xuất bản và quản lý các bản phát hành bất biến.' },
      { id: 'reference', title: 'Tham khảo', description: 'Phân biệt dữ liệu cục bộ, Walrus, Sui và các tính năng còn bị khóa.' },
    ],
    articles: [
      {
        id: 'introduction',
        category: 'start',
        title: 'Animacraft là gì?',
        summary: 'Lớp sáng tạo dành cho Maker nhân vật tái sử dụng và OC sẵn sàng cho Soul.',
        sections: [
          {
            title: 'Một Maker, nhiều OC',
            paragraphs: [
              'Animacraft là trình biên tập Maker nhân vật không cần backend. Người sáng tạo tổ chức hình PNG thành các lựa chọn Part, Item và Style; người chơi kết hợp chúng thành một OC.',
              'Walrus lưu gói sáng tạo bất biến và Maker manifest đầy đủ. Sui ghi nguồn gốc, quyền sở hữu, trạng thái xuất bản, cấu hình kinh tế của Maker và bản chiếu quy tắc Sui v2 được biên dịch tương đương.',
            ],
            bullets: [
              'Creator Studio dùng để biên soạn và kiểm thử Maker.',
              'Player Editor dùng để chọn hình, bảng màu Smart Color và nội dung Soul.',
              'Soulidity là nơi chuẩn tắc của Soul hoàn chỉnh; Animacraft không mint thêm một Token nhân vật cạnh tranh.',
            ],
          },
          {
            title: 'Ranh giới production hiện tại',
            paragraphs: [
              'Đã có thể xuất bản Maker lên Walrus và Sui Mainnet. Luồng bàn giao Canonical Soul Mainnet chuyên dụng vẫn fail-closed cho tới khi Soulidity adapter đã duyệt và các đối tượng phí dùng chung được bật.',
            ],
            note: 'Trước khi cổng này mở, Complete OC chỉ có nghĩa là chuẩn bị và lưu gói OC, không chứng minh một Soul chuẩn tắc đã được mint.',
          },
        ],
      },
      {
        id: 'player-quick-start',
        category: 'player',
        title: 'Bắt đầu nhanh cho người chơi',
        summary: 'Chọn Maker đã xác minh, tạo OC và xuất kết quả.',
        sections: [
          {
            title: 'Tạo ngoại hình',
            bullets: [
              'Kết nối ví Sui khi giao diện yêu cầu, chọn Maker đã xác minh rồi mở Make OC.',
              'Chọn Part ở phía trên, sau đó chọn thẻ Item. Nếu Item có nhiều Style, chọn biến thể Style nhỏ bên trong.',
              'Palette chỉ hoạt động khi Style đang hiển thị đã được người sáng tạo liên kết với kênh Smart Color.',
              'Dùng Undo, Redo, Random, Remove optional và Reset để thử nghiệm an toàn.',
              'Lựa chọn bị vô hiệu hóa hoặc ẩn thường là kết quả có chủ đích của Maker Rules.',
            ],
          },
          {
            title: 'Hoàn tất OC',
            bullets: [
              'Điền tên OC, thế giới, mô tả và thẻ.',
              'Xem lại hoặc sửa Personality & identity, Memory và Skills kế thừa từ Maker.',
              'PNG chuẩn không phóng to Canvas và giới hạn cạnh dài nhất ở 1.024 px. Chỉ có xuất kích thước gốc khi Canvas không quá 8.388.608 pixel.',
              'Xuất nền trong suốt chỉ bỏ các Part được đánh dấu export-background, không phải tách nền nhân vật. Không hỗ trợ JPEG, WebP hay kích thước tùy chỉnh.',
              'Complete OC lưu Recipe và nội dung sẵn sàng cho Soul để dùng trong luồng bàn giao.',
            ],
            note: 'Cổng Canonical Soul Mainnet hiện đang tắt. Một OC đã chuẩn bị chưa đồng nghĩa với việc đã mint Soul chuẩn tắc.',
          },
        ],
      },
      {
        id: 'creator-quick-start',
        category: 'creator',
        title: 'Bắt đầu nhanh cho người sáng tạo',
        summary: 'Tạo Maker hợp lệ tối thiểu và chạy trọn Player test.',
        sections: [
          {
            title: 'Tạo phiên bản chơi được đầu tiên',
            bullets: [
              'Tạo Maker draft và hoàn thiện tiêu đề, mô tả, ảnh bìa, danh tính người sáng tạo, Canvas và bản chụp giấy phép.',
              'Thêm Part, thêm Item bên trong, rồi tải PNG cho Default Style.',
              'Sau khi có tập lựa chọn tối thiểu, sắp Layer Tracks từ sau ra trước.',
              'Chỉ thêm Smart Color và Rules khi hình ảnh thực sự cần.',
              'Thiết lập nội dung mặc định cho soul.md, memory.md và SKILL.md.',
            ],
          },
          {
            title: 'Chứng minh hoạt động trước khi phát hành',
            bullets: [
              'Lưu, mở Player test và thử chọn bình thường, Random, Reset, màu sắc và xuất hình.',
              'Chạy Preflight và xử lý mọi lỗi chặn.',
              'Xuất bản lần lượt qua Prepare Quilt, Register & upload, Certify Walrus và Publish on Sui.',
            ],
            note: 'Draft cục bộ có thể sửa. Bản phát hành đã xuất bản là bất biến; thay đổi sau đó phải thành version draft và một lần xuất bản mới.',
          },
        ],
      },
      {
        id: 'data-model',
        category: 'creator',
        title: 'Mô hình dữ liệu Maker',
        summary: 'Hiểu Maker → Part → Item → Style trước khi nhập hình.',
        sections: [
          {
            title: 'Bốn cấp biên soạn',
            bullets: [
              'Maker: toàn bộ mẫu tái sử dụng, gồm metadata, Canvas, quy tắc, mặc định Soul và cấu hình xuất bản.',
              'Part: danh mục trong menu người chơi, như Background, Skin, Eyes hoặc Front Hair.',
              'Item: bộ phận có thể nhấp trong một Part, ví dụ Long Hair.',
              'Style: đơn vị render nhỏ nhất. Một Style sở hữu đúng một PNG cùng transform, ngoại hình, quy tắc, khóa, Layer Track và liên kết Smart Color tùy chọn riêng.',
            ],
          },
          {
            title: 'Danh tính độc lập và hai loại thứ tự',
            paragraphs: [
              'Thứ tự menu Part điều khiển cách người chơi duyệt. Thứ tự Layer Track chỉ điều khiển z-order hình ảnh. Sắp xếp một bên không được âm thầm đổi bên kia.',
            ],
            bullets: [
              'Item mới luôn có một Default Style.',
              'Duplicate tạo ID mới và deep-copy toàn bộ cây con được chọn.',
              'Required Part cần lựa chọn hợp lệ; Optional Part có thể cung cấp None / Remove.',
              'Có thể đổi tên hiển thị, nhưng ID ổn định bảo vệ Recipe và việc so sánh phiên bản.',
            ],
          },
        ],
      },
      {
        id: 'artist-source-files',
        category: 'creator',
        title: 'Quy cách tệp nguồn cho họa sĩ',
        summary: 'Chuẩn bị một tài liệu master đã căn chỉnh để mọi Style xuất ra khớp nhau.',
        sections: [
          {
            title: 'Dùng một Master Canvas',
            bullets: [
              'Dùng một tệp master PSD, CLIP hoặc KRA có cùng chiều rộng, chiều cao, gốc tọa độ và không gian màu sRGB với Maker cuối.',
              'Đặt đường căn trong nhóm không xuất và vẽ mọi phương án ở đúng vị trí cuối.',
              'Nhóm Style trong tệp nguồn có thể có layer nét, bóng và sáng; hãy gộp cả nhóm thành một PNG trong suốt khi xuất.',
              'Không cắt lề trong suốt nếu Canvas đầy đủ đang mang thông tin vị trí.',
            ],
          },
          {
            title: 'Bàn giao từ họa sĩ',
            bullets: [
              'Tệp nguồn master có thể chỉnh sửa, giữ riêng tư trừ khi người sáng tạo chủ động công khai.',
              'Một PNG trong suốt cho mỗi Style với tên Part__Item__Style ổn định.',
              'Một ảnh ghép mặc định và một bảng kiểm tra nhiều tổ hợp.',
              'Khi nhập hàng loạt, dùng cấu trúc thư mục part/item/style.png rồi xác nhận thủ công mọi ánh xạ tự động.',
            ],
            note: 'Animacraft chỉ đọc project ZIP schema riêng, không đọc manifest chung của bên thứ ba. Tọa độ cũng không sửa được khác biệt tỷ lệ đầu, góc máy, tư thế hay đường nét trang phục.',
          },
        ],
      },
      {
        id: 'png-import',
        category: 'creator',
        title: 'Nhập và thay PNG',
        summary: 'Nhập layer đã căn chỉnh mà không nhầm zoom quan sát với scale tài sản.',
        sections: [
          {
            title: 'Hành vi nhập hiện tại',
            bullets: [
              'PNG có kích thước khớp chính xác Maker Canvas được nhập 1:1 tại X 0, Y 0, Scale 1, Rotation 0.',
              'PNG không phải toàn Canvas hiện được thu nhỏ theo tỷ lệ chỉ khi cần để vừa, rồi đặt giữa Canvas.',
              'Mọi tài sản rời được đặt giữa phải được kiểm tra và chỉnh vị trí thủ công trước khi xuất bản.',
              'Tệp phải là PNG thật, tối đa 20 MB, mỗi cạnh tối đa 8.192 px và tổng tối đa 16.777.216 pixel. Chẩn đoán biên trong suốt không cắt tệp nguồn.',
            ],
          },
          {
            title: 'Ánh xạ hàng loạt và thay thế',
            bullets: [
              'Xác nhận từng ánh xạ tệp sang Part, Item, Style trước khi chốt một lô.',
              'Kích thước khác Canvas là điều kiện cần xem thủ công, không phải importer hard error; nhưng Style công khai hoàn toàn trong suốt vẫn không qua kiểm tra phát hành.',
              'Thay PNG chỉ giữ transform khi positionLocked=true. Nếu chưa khóa, X/Y/Scale/Rotation được đặt lại theo quy tắc của PNG mới và positionConfirmed=false.',
              'Việc thay vẫn giữ Layer Track, Smart Color, Rules, trạng thái khóa và lựa chọn thumbnail.',
              'Dùng zoom khung nhìn để soi pixel; nó không được thay đổi Style scale đã lưu.',
            ],
            note: 'Với tài sản production, PNG toàn Canvas là lựa chọn an toàn nhất vì lề trong suốt giữ hệ tọa độ chung.',
          },
        ],
      },
      {
        id: 'canvas-layer-tracks',
        category: 'creator',
        title: 'Canvas và Layer Tracks',
        summary: 'Đặt chính xác từng Style và giữ thứ tự vẽ toàn cục ổn định.',
        sections: [
          {
            title: 'Điều khiển Canvas',
            bullets: [
              'Chọn đúng Style trước khi di chuyển; breadcrumb phải là Part › Item › Style.',
              'Kéo để đặt vị trí và dùng X, Y, Scale đồng đều, Rotation dạng số để căn chỉnh có thể tái lập.',
              'Dùng Show all, Dim others và Solo current Style để kiểm tra lớp chồng.',
              'Sau khi duyệt, dùng position lock hoặc full Style lock. Không có appearance-only lock riêng.',
              'Với pixel art, dùng xem trước nearest-neighbor và tọa độ nguyên khi cần.',
            ],
          },
          {
            title: 'Vẽ từ sau ra trước',
            paragraphs: [
              'Layer Tracks xác định thứ tự render toàn cục từ sau ra trước. Chúng không di chuyển PNG và không đổi thứ tự menu người chơi.',
            ],
            bullets: [
              'Gán mọi Style công khai vào một Track hợp lệ.',
              'Giữ các Track liên kết Part chuẩn đồng bộ khi phù hợp với mô hình hình ảnh.',
              'Tách Track cho tóc sau, cơ thể, trang phục, chi tiết mặt, tóc trước và tiền cảnh khi cần.',
              'Xác minh cùng một ảnh ghép trong Creator Canvas, Player test, thumbnail, bản xuất và xem trước xuất bản.',
            ],
          },
        ],
      },
      {
        id: 'smart-color',
        category: 'creator',
        title: 'Smart Color',
        summary: 'Liên kết nhiều Style với các màu cài sẵn xác định do người sáng tạo phê duyệt.',
        sections: [
          {
            title: 'Tạo và liên kết kênh',
            bullets: [
              'Tạo Color Channel, đặt tên rõ ràng cho người chơi và thêm mọi preset được phép.',
              'Chọn rõ preset mặc định thay vì dựa vào màu dự phòng.',
              'Mở từng Style liên quan và liên kết chúng vào cùng một kênh.',
              'Dùng hình nguồn có phân tách độ sáng tốt để gradient mapping giữ được bóng dễ đọc.',
            ],
          },
          {
            title: 'Hành vi người chơi và kiểm tra',
            bullets: [
              'Palette chỉ sáng khi lựa chọn hiện tại có Style đang thấy được liên kết với kênh.',
              'Chọn một preset sẽ tô lại cùng lúc mọi Style đang thấy được liên kết với kênh đó.',
              'Người chơi không thể gỡ liên kết do người sáng tạo thiết lập hoặc tạo preset mà người sáng tạo chưa định nghĩa.',
              'Mỗi Style chỉ được liên kết tối đa một channel và Palette chỉ hiện channel trong context của Style hiện tại.',
              'Thử mọi preset với mọi Item liên kết, rồi so khớp mặc định, thumbnail, PNG xuất, Recipe và bản chiếu xuất bản.',
              'Sui v2 xác minh preset đã đăng ký bằng lựa chọn Part/Item ẩn; gradient stops và tô màu từng pixel chỉ nằm trong Walrus manifest và browser Renderer.',
            ],
            note: 'Kênh thiếu preset hoặc không có Style công khai được liên kết là chưa hoàn chỉnh và phải sửa trước khi xuất bản.',
          },
        ],
      },
      {
        id: 'rules',
        category: 'creator',
        title: 'Rules và Style visibility',
        summary: 'Tạo tổ hợp hợp lệ mà không trộn logic lựa chọn với z-order.',
        sections: [
          {
            title: 'Rules tổ hợp',
            bullets: [
              'requires khiến Part, Item hoặc Style đã chọn phụ thuộc vào một hay nhiều mục tiêu.',
              'excludes ngăn chủ thể được chọn cùng từng mục tiêu; nhiều mục tiêu là các conflict độc lập.',
              'Chỉ requires + ALL mới yêu cầu mọi mục tiêu. ANY là grouped selector trong cùng một Part, và các mục tiêu Style còn phải thuộc cùng một Item.',
              'Dùng any Item của một Part cho logic rộng, hoặc Item/Style chính xác cho logic cụ thể.',
              'Nếu vấn đề chỉ là thứ tự vẽ, hãy dùng Layer Tracks thay vì Rules.',
            ],
          },
          {
            title: 'Style visibility và sự thật khi xuất bản',
            bullets: [
              'Always visible render bình thường khi Item và Style của nó được chọn.',
              'Điều kiện selected và not-selected chỉ hiện đúng Style khi trạng thái phụ thuộc khớp.',
              'Khả dụng phía người chơi, Renderer visibility, Random và Preflight dùng cùng canonical rule engine.',
              'Đồ thị đầy đủ nằm trong Walrus manifest. Sui v2 phải lưu bản compiled projection tương đương; xuất bản sẽ fail closed nếu không tạo được tính tương đương.',
            ],
            note: 'Mục tiêu cũ chưa giải quyết, hierarchy cycle, mâu thuẫn, không có Recipe chơi được hoặc nội dung công khai không thể đạt tới sẽ chặn xuất bản.',
          },
        ],
      },
      {
        id: 'soul-configuration',
        category: 'creator',
        title: 'Soul Configuration',
        summary: 'Cung cấp mặc định danh tính, ký ức và kỹ năng có thể sửa cho mỗi OC.',
        sections: [
          {
            title: 'Ba tệp Living Content',
            bullets: [
              'soul.md định nghĩa Personality & identity: giọng nói, giá trị, ranh giới, thế giới và tính liên tục.',
              'memory.md định nghĩa ký ức và bối cảnh ban đầu của nhân vật.',
              'SKILL.md định nghĩa kỹ năng, hướng dẫn vận hành và tài liệu liên kết.',
              'Mặc định của người sáng tạo được lưu cùng Maker và hiện trong Player Editor như thẻ thiết lập OC.',
            ],
          },
          {
            title: 'Kế thừa và bàn giao',
            bullets: [
              'Người chơi có thể điều chỉnh phần văn bản được phép cho OC cụ thể này.',
              'Tên, mô tả, thế giới, thẻ, hình đã chọn và ba tệp Living Content của OC được lưu cùng nhau.',
              'OC Walrus Quilt gồm PNG đã duyệt và animacraft-oc.json; cả ba Living Content được nhúng trong profile JSON này.',
              'Chỉ Soulidity handoff ZIP tải xuống mới tách nội dung thành các tệp riêng.',
              'Sau khi tích hợp đã duyệt được bật, Soulidity chịu trách nhiệm cho Soul chuẩn tắc và Living Content về sau.',
            ],
            note: 'Luồng Canonical Soul Mainnet hiện còn bị khóa; có thể biên soạn và đóng gói cấu hình nhưng không được tuyên bố đã mint Soul.',
          },
        ],
      },
      {
        id: 'player-test-preflight',
        category: 'publish',
        title: 'Player test và Preflight',
        summary: 'Kiểm thử giao diện người chơi thật rồi xử lý mọi lỗi chặn phát hành.',
        sections: [
          {
            title: 'Chạy Player test thực tế',
            bullets: [
              'Mở Player test từ Creator Studio; đừng chỉ dựa vào Canvas biên soạn.',
              'Thử mọi Part, Item, Style cùng None / Remove của Optional Part.',
              'Thử mọi Smart Color, biên Rules, Random, Reset, Undo, Redo và xuất PNG cuối.',
              'Kiểm tra bố cục mobile và desktop, đồng thời tải lại một lần để xác nhận draft cục bộ phục hồi.',
            ],
          },
          {
            title: 'Đọc Preflight đúng cách',
            bullets: [
              'Mọi blocking issue phải được sửa trước khi Prepare Quilt có thể xuất bản bản đáng tin cậy.',
              'Warning cần được xem xét có ý thức, nhất là lệch căn, kênh không dùng, thay đổi tương thích và nội dung tùy chọn.',
              'Kiểm tra đầu ra chỉ công khai: draft và nội dung hidden không được lọt vào bản phát hành.',
              'Chạy lại sau mọi thay đổi về hình, Rules, Track, Soul hoặc Expansion Pack.',
            ],
            note: 'Bản xem trước biên soạn màu xanh chưa đủ; Player, Renderer, manifest và Sui projection phải đồng nhất.',
          },
        ],
      },
      {
        id: 'walrus-sui-publish',
        category: 'publish',
        title: 'Xuất bản với Walrus và Sui',
        summary: 'Hiểu bốn bước xuất bản Mainnet có thể tiếp tục.',
        sections: [
          {
            title: 'Bốn bước',
            bullets: [
              'Prepare Quilt mã hóa bản phát hành đã duyệt và tính báo giá lưu trữ hiện tại.',
              'Register & upload ký khoản thanh toán cần thiết và chuyển Quilt lên Walrus.',
              'Certify Walrus xác nhận kết quả lưu trữ; object có thể chưa hiện ngay sau chứng nhận.',
              'Publish on Sui tạo bản phát hành OCMaker bất biến và các object quản trị.',
            ],
          },
          {
            title: 'Chi phí, thử lại và thành công',
            bullets: [
              'MIST là đơn vị SUI, FROST là đơn vị WAL; ví hiển thị gas transaction Sui riêng.',
              'Nếu báo giá trực tiếp đổi, hãy tạo báo giá mới và xác nhận rõ số tiền mới.',
              'Upload quote hiển thị chỉ gồm relay tip cùng WAL storage/write, không phải ước tính đầy đủ Sui gas.',
              'Timeout mạng hoặc Blob đã chứng nhận chưa hiển thị phải tiếp tục từ checkpoint đã lưu.',
              'Chỉ hoàn tất khi transaction Sui thành công và Maker mới có thể quan sát được.',
            ],
            note: '53 Walrus epoch hiện tương đương khoảng hai năm. Bất biến không có nghĩa là vĩnh viễn: ghi lại Blob object và gia hạn trước khi retention hết hạn.',
          },
        ],
      },
      {
        id: 'lifecycle-versions',
        category: 'publish',
        title: 'Vòng đời và quản lý phiên bản',
        summary: 'Quản lý draft và bản chain bất biến mà không ghi đè lịch sử.',
        sections: [
          {
            title: 'Các trạng thái vòng đời',
            bullets: [
              'Draft ở cục bộ và có thể chỉnh sửa.',
              'Publishing / Recoverable biểu thị checkpoint Walrus/Sui đang chạy hoặc có thể tiếp tục.',
              'Active cho phép mua Base/Pack và Complete authorization khi các gate Commerce v5 và Canonical Soul toàn cục cũng được bật.',
              'Paused chặn mua và authorization mới nhưng giữ entitlement, số lượt, OC và nguồn gốc hiện có.',
              'Sale pending nghĩa là release đang dừng đã được niêm yết on-chain và quản trị bị khóa cho đến khi hủy hoặc mua xong.',
              'Archived dừng sử dụng và giữ trạng thái Sui có thể khôi phục; tệp Walrus chỉ còn trong retention đã trả phí nếu không gia hạn.',
              'Version draft là bản nháp phiên bản cục bộ có thể sửa, được dẫn xuất từ snapshot đã xuất bản.',
            ],
          },
          {
            title: 'Cập nhật an toàn',
            bullets: [
              'Mở Manage status từ Creator Library hoặc lifecycle badge.',
              'Tạo version draft, kiểm tra tương thích rồi xuất thành OCMaker bất biến riêng.',
              'Các phiên bản và Recipe cũ vẫn được nhận diện độc lập.',
              'Quản trị Commerce v5 yêu cầu chủ MakerControlCapV5 của epoch hiện tại.',
              'Mỗi lần phát hành bất biến mới có một MakerRootV5 riêng. Style registry đã niêm phong, quyền mua, số lượt và Recipe không tự chuyển sang phiên bản mới.',
              'Trước khi niêm yết Maker phải Paused và Maker Treasury có số dư bằng 0. Việc mua đổi người vận hành nhưng giữ quyền Base/Pack đã mua cho release đó.',
              'Quan hệ phiên bản nằm trong manifest và client. Move hiện không có successor link và không tự thay bản cũ.',
            ],
            note: 'Loại bỏ vĩnh viễn và onchain supersession nguyên tử vẫn bị khóa giao thức cho đến khi một nâng cấp đã duyệt định nghĩa ngữ nghĩa.',
          },
        ],
      },
      {
        id: 'expansion-packs',
        category: 'publish',
        title: 'Expansion Packs',
        summary: 'Phát hành nội dung tùy chọn miễn phí hoặc trả một lần trong một Maker release bất biến.',
        sections: [
          {
            title: 'Quyền truy cập và chính sách Complete',
            bullets: [
              'Mỗi Pack nằm trong một Walrus Maker package bất biến và được đăng ký dưới MakerRootV5 của release đó trên Sui.',
              'Chọn FREE, ONE_TIME_PAID hoặc core content bắt buộc. Wallet đã trả tiền dùng Pack đó vĩnh viễn trên release này.',
              'Mỗi Pack có chính sách Complete riêng: miễn phí vô hạn, hết lượt miễn phí thì trả tiền, trả mỗi lần, hoặc hết lượt thì chặn.',
              'Pack miễn phí không cần transaction nhận quyền. Pack trả phí phải được mua trước khi dùng bất kỳ exact Style nào của nó.',
            ],
          },
          {
            title: 'Ranh giới nội dung bất biến',
            bullets: [
              'Pack không thể thay default Recipe cơ sở hoặc âm thầm sửa nội dung cơ sở hiện có.',
              'requires mới phải kích hoạt từ nội dung thuộc Pack; excludes phải liên quan nội dung thuộc Pack.',
              'Mỗi exact Style được niêm phong là Base hoặc product của một Pack; Recipe cấp Item không thể lách Style trả phí.',
              'Đổi artwork, thành viên hoặc rule của Pack cần Maker version mới; giao dịch cũ vẫn gắn với release cũ.',
            ],
            note: 'Pack là policy record on-chain bên trong một release Root, không phải Maker có thể chuyển nhượng riêng hay Maker lồng Maker.',
          },
        ],
      },
      {
        id: 'commerce-rights',
        category: 'publish',
        title: 'Thương mại, quyền và bản quyền',
        summary: 'Hiểu các quy tắc Sui bắt buộc trước khi mời Creator và Player trả phí.',
        sections: [
          {
            title: 'Nguồn quyền và truy cập ban đầu',
            bullets: [
              'ONCHAIN_NATIVE tuyên bố Maker phát hành đầu tiên on-chain. LICENSE_WRAPPED biểu diễn giấy phép truyền thống hiện có on-chain; tranh chấp off-chain vẫn theo giấy phép bên ngoài.',
              'Base có thể miễn phí hoặc trả một lần. Base và mỗi Pack được dùng có thể đặt giá Complete, lượt miễn phí theo wallet hoặc giới hạn tổng riêng.',
              'Phí Creator ban đầu chia 90% cho Maker Treasury của người vận hành hiện tại và 10% cho protocol Animacraft. Sui gas, lưu Walrus và phí protocol Complete cố định hiển thị riêng.',
              'Thanh toán, exact Style authorization, tăng lượt và canonical Soul mint phải cùng thành công trong một transaction, nếu không mọi thay đổi rollback.',
              'Commerce v5 không có đường hoàn tiền: wallet xem đúng số tiền trước khi ký, và transaction nguyên tử thất bại sẽ không chuyển tiền.',
            ],
          },
          {
            title: 'Sở hữu và bán lại',
            bullets: [
              'Bán lại Maker yêu cầu Paused và Maker Treasury bằng 0. Sau khi niêm yết, quản trị bị khóa đến khi hủy hoặc mua.',
              'Mặc định bán lại Maker: seller 92,5%, protocol 2,5%, original Maker creator 5%. Tỷ lệ original-creator được đóng băng khi exact Style registry được seal; người vận hành sau không thể giảm tỷ lệ và original creator không thay đổi.',
              'Lần Soul mint đầu tiên đóng băng royalty của Soul creator và Maker-source. Mặc định mỗi bên 2,5%, hỗ trợ 0–5% theo bước 0,5%.',
              'Bán lại Soul luôn cộng protocol Soulidity cố định 2,5%. Tổng Soul creator và Maker-source đã đóng băng tối đa 10%, nên seller nhận ít nhất 87,5%.',
              'Soul holder sau đó không thể hạ royalty đã đóng băng. Creator profile, like, collection và public market tiếp tục ở Soulidity.',
            ],
            note: 'Commerce v5 giữ fail-closed ở production cho đến khi xác minh hai package upgrade, shared object, runtime ID và bằng chứng Mainnet miễn phí/trả phí.',
          },
        ],
      },
      {
        id: 'chain-truth',
        category: 'reference',
        title: 'Dữ liệu nào ở cục bộ, Walrus và Sui?',
        summary: 'Dùng cách gọi chính xác cho draft, tệp, trạng thái giao thức và bàn giao Soul.',
        sections: [
          {
            title: 'Nguồn sự thật của từng phần',
            bullets: [
              'IndexedDB trình duyệt: draft có thể sửa, source blob, revision, trạng thái người chơi cục bộ và checkpoint tiếp tục.',
              'Walrus: Maker manifest bất biến, hình miễn phí công khai, ciphertext Style trả phí, cover/preview công khai riêng, ciphertext OC cuối được bảo vệ, mặc định Soul và release package trong retention đã mua. Plaintext trả phí không bao giờ vào Quilt công khai; phải gia hạn trước khi hết hạn.',
              'Sui: nguồn gốc OCMaker, lifecycle MakerRootV5 theo release, exact Style product registry, entitlement Base/Pack, số lượt và phí Complete, Treasury, listing và rule projection.',
              'Soulidity: Soul hoàn chỉnh chuẩn tắc duy nhất cùng vòng đời Living Content, identity, social và market sau tích hợp.',
            ],
          },
          {
            title: 'Khi nào là onchain',
            paragraphs: [
              'Lưu cục bộ không phải xuất bản. Chứng nhận Walrus nghĩa là gói đã được lưu, nhưng Maker chỉ xuất bản đầy đủ sau khi transaction Sui thành công.',
              'Xuất bản Maker không đăng ký Recipe của người chơi. non-droppable authorization chỉ được tạo và tiêu thụ trong cùng transaction thành công tạo canonical Soul.',
            ],
            note: 'Tính bất biến của Walrus chỉ áp dụng trong retention, không vĩnh viễn nếu không gia hạn. Tuyến Canonical Soul Mainnet hiện tắt.',
          },
        ],
      },
      {
        id: 'troubleshooting',
        category: 'reference',
        title: 'Khắc phục và phục hồi',
        summary: 'Phục hồi draft và checkpoint xuất bản mà không làm vấn đề nặng hơn.',
        sections: [
          {
            title: 'Vấn đề draft và editor',
            bullets: [
              'Đừng xóa dữ liệu trang khi draft có vẻ mất; kiểm tra ví đang kết nối và công cụ phục hồi trước.',
              'Nếu hình lệch, hãy so kích thước PNG, Style transform và Layer Track trước khi tải lại.',
              'Nếu thiếu Palette, xác nhận Style đang thấy đã liên kết với kênh công khai có preset.',
              'Nếu Random không có kết quả, kiểm tra Required Part, requires/excludes, Style visibility và tương thích Expansion Pack.',
              'Xuất project backup trước khi sửa chữa lớn.',
            ],
          },
          {
            title: 'Vấn đề xuất bản',
            bullets: [
              'UPLOAD_QUOTE_CHANGED nghĩa là Quilt mã hóa hoặc giá trực tiếp đã đổi; tạo và duyệt báo giá mới.',
              'NETWORK_UNAVAILABLE hoặc timeout cần thử lại bước đã lưu sau khi kiểm tra ví và mạng.',
              'Blob đã chứng nhận có thể chưa truy vấn được ngay; tiếp tục certification để hệ thống hỏi lại kết quả cũ.',
              'Sau khi xuất bản thành công, chỉ làm mới discovery khi Sui object đã quan sát được.',
              'Sao chép technical details trước khi xin hỗ trợ, nhưng không chia sẻ bí mật ví hay cụm từ khôi phục.',
            ],
          },
        ],
      },
    ],
  },
};
