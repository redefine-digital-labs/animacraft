# Animacraft 协议与 Character Maker 使用教程

版本：0.4 邀请创作者候选版

适用对象：真人画师、Maker 制作者、测试玩家、审核与运营人员

产品理念：**The Fully onchain Character Maker & Creator.**

> 本文是邀请真人创作者测试时的主教程。美术文件的尺寸、拆层、命名和交付要求另见 [Maker v4 创作者素材交付规范](./CREATOR_ASSET_SPEC_V4.zh-CN.md)。当前 Creator Studio 的布局以 [PR #15 UI 基线](./UI_BASELINE.md) 为准，后续只细化既有功能，不随意改变整体布局。

## 1. Animacraft 是什么

Animacraft 是一个不依赖应用后端的 Character Maker 编辑器：

1. 画师把分层 PNG 制作为可复用的 Character Maker；
2. 素材、Maker Manifest 和 Living Content 存入 Walrus；
3. Maker 的来源、组合规则、授权、收费和管理权写入 Sui；
4. 玩家选择 Maker 中的部件，生成自己的 OC 配方与合成图；
5. 玩家进入 Soulidity，由 Soulidity 完成唯一一次正式 Soul 铸造、社交、交易和持续养成。

Animacraft 不再额外铸造一份“成品角色 NFT”。它只负责编辑、发布 Maker、验证 OC 配方，并向 Soulidity 提供不可绕过的 `SoulMintAuthorization`。Soulidity 才是成品 Soul 的唯一资产层。

## 2. 协议里的角色

| 角色 | 能做什么 | 需要什么 |
|---|---|---|
| 浏览者 | 浏览 Template Plaza 和公开文档 | 不需要钱包 |
| Maker 创作者 | 创建草稿、上传素材、测试、发布 Maker | Sui 钱包与 SUI/WAL 存储费用 |
| Maker 管理者 | 修改未来收费、提取收入、归档/恢复 Maker | 当前 `MakerAdminCap` |
| 玩家 | 使用已发布 Maker 组合 OC | Sui 钱包；收费 Maker 还需要原生 USDC |
| Soul 持有者 | 在 Soulidity 管理、社交、交易与养成 | Soulidity 中的 Soul/Kiosk 所有权 |
| 协议治理者 | 管理协议费用对象和升级权限 | 多签或明确托管的协议 Cap |

原始画师身份与当前管理权是两件事。创作者来源会永久记录；`MakerAdminCap` 可以转移，因此 Maker 可以在 Soulidity 中作为可管理的经营资产交易。

## 3. 一个 Maker 的链上三对象

正式发布一个付费能力完整的 Maker 时，协议创建三类关联对象：

### 3.1 `OCMaker`

- 共享对象，供玩家读取和请求 Soul 铸造授权；
- 记录原始创作者、Walrus Manifest、公开 Part/Item/Color、规则、授权和生命周期；
- 发布后素材与组合规则不可被静默替换；
- 修改内容会创建后续 Maker 版本，旧 OC 继续固定在原版本。

### 3.2 `MakerTreasury<USDC>`

- Maker 专属的共享金库；
- 接收 Maker 应得的付费授权收入和二级交易版税；
- 记录累计收入、版税收入和累计提取；
- 只有匹配的 `MakerAdminCap` 持有者可以提取。

### 3.3 `MakerAdminCap`

- Maker 的可转移管理权；
- 控制未来是否开放铸造、USDC 价格、版税档位和归档状态；
- 可以提取匹配 Treasury 的收入；
- Cap 丢失等于失去管理权限，不能把它当作普通测试对象随意转账。

## 4. 收费与授权边界

- Maker 可以免费，也可以按原生 USDC 设置固定铸造授权价格。
- 协议 v4 的付费 Maker-to-Soul 主协议分成上限为 50%，当前规范默认 50%；其余进入 Maker Treasury。
- Soulidity 二级交易平台手续费独立为 2.5%。
- Maker 版税独立选择 0%、1%、2%、3%、4% 或 5%，由 Soulidity 的 Animacraft 交易路径结算到 Maker Treasury。
- 版税、协议费和 Maker 收入必须由 Move 交易强制结算，网页文字本身不构成可执行结算。

当前主网已有原协议包，但 v4 费用升级、协议共享费用对象和 Soulidity 适配器仍必须完成单独审计、部署与双钱包验收。完成前应保持收费 Soul 铸造入口关闭。

## 5. 开始前准备

### 5.1 钱包

使用专门的创作者地址，不要把助记词、私钥或 keystore 发给任何人。地址需要：

- 少量 SUI：支付 Sui 交易 Gas；
- 足够的 WAL/SUI：支付 Walrus 存储；
- 需要测试付费 Maker 时准备原生 USDC；
- 主网发布前先用小素材 Maker 完整走通一次。

### 5.2 素材

- 推荐 Canvas：`1024 × 1024`；
- 正式 runtime 素材使用透明 PNG；
- 最稳妥的是每张 PNG 保持完整 Canvas、坐标 `(0,0)`；
- 裁切小图也可使用，但必须在 Canvas 上定位并点击“确认位置”；
- 图标和缩略图可使用 PNG/JPEG，最大 5 MB；
- 原画工程、导出 PNG、命名映射和授权凭证由创作者另行备份。

### 5.3 浏览器存储

草稿和本地素材保存在当前浏览器的 IndexedDB 中，不是云端账号存储：

- 正常刷新和重新打开同一浏览器可恢复；
- 无痕模式、清理站点数据、换电脑不会自动同步；
- 发布前保留源文件和 Manifest 导出；
- 中断 Walrus 上传后，用同一钱包和同一浏览器恢复检查点。

## 6. Creator Studio 完整流程

### 6.1 创建 Maker

1. 打开 Animacraft，未连接钱包时可以浏览 Template Plaza。
2. 点击连接钱包，再进入 **MyPage**。
3. 打开 Maker Library，选择创建新的 OC Maker。
4. 填写 Maker 名称和 Canvas；首次真实测试建议 `1024 × 1024`。
5. 创建后进入同一个 Creator Studio 工作面。

页面上方保留五个产品区：

- **模板概览**：Maker 状态和发布准备度；
- **角色创建器**：核心 Part、Item、Style 与 Layer 编辑器；
- **Living Content**：Soul Character、Memory、Skills & Docs 默认内容；
- **链上发布**：Walrus 和 Sui 四阶段发布；
- **设置**：Maker 元数据、授权和经济参数。

### 6.2 理解数据结构

```text
Maker
├── Part：玩家菜单分类，例如 Hair
│   ├── Item：玩家的一次选择，例如 Long Hair
│   │   └── Style：该 Item 的可选款式，例如 Left / Pattern A
│   │       └── LayerBinding：一张 PNG 在一个 LayerTrack 上的显示设置
├── LayerTrack：全 Maker 共用的后到前渲染顺序
├── ColorChannel：多个 LayerBinding 共用的联动颜色
├── Rules：requires / excludes / 条件显隐
└── ExpansionPack：固定到 Maker 版本的增量内容
```

**Part 不等于图层。** Part 是玩家菜单；一个 Item 可以同时控制后发、前发、高光等多个 LayerBinding。所有 Part 共用 LayerTrack，因此玩家菜单顺序不会改变遮挡关系。

## 7. 角色创建器逐项教程

### 7.1 部件与选项

左栏显示 Parts，中间显示实时 Canvas 和当前 Part 的 Items，右栏是 Inspector。

创建顺序建议：

1. 新建或选择 Part；
2. 设置名称、必选/可选、父 Part 和默认 Item；
3. 新建 Item；
4. 需要同一 Item 的款式变化时添加 Style；
5. 给 Style 添加或批量导入 PNG LayerBinding；
6. 在 Canvas 中定位；
7. 设置 LayerTrack、混合模式、透明度、联动配色和条件显隐；
8. 设置当前默认组合并进入玩家测试。

可选 Part 在玩家端会出现明确的“None/移除”。选择 None 时不会偷偷回退到默认素材。

### 7.2 上传一张图层 PNG

1. 选中 Part、Item 和 Style；
2. 在 Inspector 中点击“上传图层 PNG”；
3. 完整 Canvas PNG 会默认使用 `(0,0)` 和 `scale=1`；
4. 裁切小图会进入待定位状态；
5. 直接在 Canvas 上拖动，或输入 X、Y、缩放和旋转；
6. 完成后点击“确认位置”。

确认位置后，坐标与缩放控制会自动收起，减少 Inspector 长度。需要继续调整时点击“调整位置”重新展开。任何新的拖动、坐标或缩放修改都会重新标记为“待确认”，发布检查会阻止未确认的裁切素材。

玩家端永远不能移动创作者已经确认的位置。

### 7.3 批量导入

1. 在当前 Part 中点击“批量导入”；
2. 一次选择多张 PNG；
3. 系统只先检查文件，不会立刻写入结构；
4. 在映射确认窗口检查 PNG 对应的 Item、Style 和 LayerTrack；
5. 文件名匹配不正确时手动修改；
6. 确认后再写入 Maker；
7. 逐张检查裁切素材的位置和遮挡。

批量导入不是自动美术对齐工具。它只减少重复建结构，不能修复源素材内部漂移。

### 7.4 图层轨道

“图层轨道”打开一个工具面板，管理全 Maker 的渲染顺序：

- 列表下方是后层，上方是前层；
- Hair Back、Body、Outfit、Expression、Hair Front 等应使用不同轨道；
- 删除仍被 LayerBinding 使用的轨道会被阻止；
- Item 或 Part 的展示顺序不会替代 LayerTrack。

### 7.5 联动配色

联动配色有两种模式：

- **渐变映射**：保留源图明暗，用暗部/中间色/亮部重新着色；
- **独立素材**：每个色板为相关 LayerBinding 指定一套独立 PNG。

同一头发的前发、后发和高光应绑定同一个 ColorChannel。预览、玩家端和最终导出使用同一颜色解析逻辑。

### 7.6 组合规则

- `requires`：选择 A 时必须同时选择 B；
- `excludes`：A 与 B 不能同时出现；
- Part 级规则影响整个 Part；
- Item/Style 级规则只影响具体选择；
- 父 Part 可以控制子 Part 是否显示；
- LayerBinding 还可按某个 Part 是否被选择来条件显隐。

规则不是提示文字。玩家选择、随机组合、默认配方和发布检查都会执行同一规则引擎。Move 暂时不能完整表达的 v4 规则会在 Manifest 中标记 `partial`，不会静默丢失。

### 7.7 扩展包

ExpansionPack 用来给已发布 Maker 增加命名空间隔离的内容，不修改原 Maker：

- 每个扩展包固定兼容的 Maker 版本；
- 可以把当前 Item 复制到扩展包草稿；
- 创作者可在 Player Test 中启用/停用预览；
- 不兼容版本必须明确显示，不能强行套用。

### 7.8 发布检查

发布检查至少验证：

- Part、Item、Style、LayerTrack 引用有效；
- 必选 Part 有有效默认值；
- PNG 本地或远程素材存在；
- 裁切 LayerBinding 已确认位置；
- 默认 Recipe 可通过规则并完成渲染；
- requires/excludes 不自相矛盾；
- ColorChannel 和 ExpansionPack 引用有效；
- 发布版本兼容性已经确认。

点击问题条目的“打开”会定位对应内容。不要绕过红色阻断项发布。

## 8. 编辑器稳定操作说明

- **保存**：将 Maker v4 文档与 PNG Blob 写入当前浏览器；顶部状态显示保存中、已保存或失败。
- **撤销/重做**：结构、字段和变换操作进入同一命令历史；不可用时按钮会禁用并说明原因。
- **工具切换**：Layer Tracks、联动配色、组合规则、扩展包和发布检查打开为边界明确的工具层；关闭后保留当前 Part、Item、Layer 和滚动位置。
- **焦点保护**：点击按钮前会提交正在编辑的文字；重渲染应保留输入焦点、选区和面板滚动位置。
- **玩家测试**：至少有一张真实 PNG 后才启用；Creator Studio 草稿测试不等于已发布 Maker。
- **删除**：本地未发布的 Maker、Part、Item、Style 和 LayerBinding 可删除；发布后不删除链上历史，只能新建版本或归档。

## 9. Living Content

每个 Maker 默认包含 Soulidity 所需的三类内容：

- `soul.md`：Soul Character；
- `memory.md`：初始 Memory；
- `SKILL.md` / skills 包：Skills & Docs。

只制作 OC 外观的画师可以保留默认内容。想设计 Soul 性格、世界观和初始能力的创作者可以直接编辑。玩家完成 OC 时，这些默认内容连同玩家资料一起形成交接包，但最终由 Soulidity 写入唯一 Soul。

## 10. 设置与发布前经济参数

在设置中确认：

- Maker 名称、说明、创作者名、风格/世界；
- 授权类型与补充说明；
- 是否允许未来 Soul 铸造；
- 是否收费、原生 USDC 原子单位价格；
- 二级交易版税档位；
- Canvas 和版本信息。

第一批邀请创作者建议先发布免费 Maker。收费入口只有在 v4 协议费用对象和 Soulidity 适配器完成主网验收后才启用。

## 11. Walrus + Sui 四阶段发布

### 阶段 1：Prepare

- 冻结当前发布快照；
- 验证 Maker v4、素材索引、Living Content 和兼容投影；
- 生成一个 Walrus Quilt；
- 建立本地恢复检查点。

### 阶段 2：Register & upload

- 钱包签名注册 Walrus Blob；
- 上传 PNG、缩略图、封面和 Manifest；
- 中断后可从保存的检查点重试。

### 阶段 3：Certify

- 钱包签名认证 Walrus 可用性；
- 获得可被 Sui Maker 引用的 Quilt Blob ID；
- 未认证素材不能进入正式发布。

### 阶段 4：Publish Maker

- 在 Sui 创建并发布 Maker 相关对象；
- 记录 Manifest 定位、规则投影和授权政策；
- 返回交易摘要及 Maker/Treasury/Cap 对象 ID；
- 发布后修改会进入下一版本，不覆盖旧版本。

发布过程中不要切换钱包、清理浏览器数据或继续修改 Maker。修改后旧检查点会失效，需要重新 Prepare。

## 12. 玩家如何使用 Maker

1. 未连接钱包时浏览 Template Plaza；
2. 选择一个真实的链上 Maker；
3. 连接玩家钱包并进入 Player Editor；
4. 按 Part 选择 Item、Style 和颜色；
5. 使用随机、移除可选项、重置、撤销和重做；
6. 规则冲突必须解决后才能完成；
7. 填写 OC 名称和世界；
8. 生成完整 Recipe、合成 PNG 和 Living Content 包；
9. 进入 Soulidity 的专用 Animacraft 路径；
10. 在同一 PTB 中消费授权并铸造唯一 Soul。

生产 Template Plaza 只显示从 Sui 发现、并能从认证 Walrus Manifest 恢复的 Maker。没有任何真实已发布 Maker 时应显示空状态，不能用假数据伪装可玩内容。

## 13. 真人双钱包主网验收

### 创作者钱包 A

- [ ] 创建 `1024 × 1024` 小型 Maker；
- [ ] 至少 3 个 Part、每个 Part 至少 2 个 Item；
- [ ] 包含一个多 Layer Item 和一个可选 Part；
- [ ] 上传真实 PNG 并确认裁切素材位置；
- [ ] 配置一个 ColorChannel 和一条 excludes 规则；
- [ ] Player Test 中组合、None、随机、撤销/重做均正常；
- [ ] 关闭并重开浏览器后草稿和 PNG 可恢复；
- [ ] 四阶段发布成功并记录交易、Maker、Treasury、Cap、Quilt ID。

### 玩家钱包 B

- [ ] 未连接时可以看到该 Maker；
- [ ] 连接后才能进入实际 Player Editor 和签名流程；
- [ ] 选择结果、图层位置、颜色和 Creator Test 一致；
- [ ] 可选 None 不回退默认素材；
- [ ] 完成后 Recipe 和渲染 PNG 可恢复；
- [ ] 免费授权成功；
- [ ] Soulidity 适配器启用后，授权与 Soul 铸造在同一 PTB 完成；
- [ ] Soul 出现在 Soulidity 个人页、Kiosk 和社交系统。

### 管理与交易

- [ ] 非 Cap 钱包不能修改 Maker 或提取 Treasury；
- [ ] Cap 钱包可归档/恢复 Maker；
- [ ] 归档后新授权失败，旧 Soul 仍有效；
- [ ] Cap 转移后新持有者取得管理和提取权；
- [ ] 免费、付费、Maker 收入、协议收入、2.5% 二级费和 0%-5% 版税分别核对；
- [ ] Explorer 交易与 UI 显示一致。

## 14. 常见问题

### 点击后界面跳动或回到顶部

记录操作前后的页面、Part/Item/Style、浏览器尺寸和语言。当前编辑器应保持工具面板、Inspector 和 Items 的滚动位置，并在重渲染后恢复输入焦点。

### 确认位置后仍显示坐标区

确认后应自动收起，并显示“调整位置”。若再次拖动或修改变换，状态会重新变为待确认。

### PNG 上传后人物错位

检查源 PNG 是否使用同一 Canvas、Alpha 内容内部是否漂移、LayerTrack 是否正确。编辑器不会自动修复画师素材内部构图变化。

### Player Test 按钮不可用

至少需要一个真实可解析的 PNG LayerBinding。占位资产不算可玩内容。

### 发布按钮不可用

依次检查钱包、运行配置、发布检查、Walrus 阶段和是否已经发布。按钮禁用必须有可见原因。

### 发布后能否删除

不能删除链上历史和已认证的 Walrus 引用。可以归档 Maker，或创建新版本。Walrus 保留期结束前需要续存。

## 15. 当前生产状态

截至本候选版：

- Creator Studio 与 Player Editor 已共用 Maker v4、规则引擎和 Renderer；
- 本地草稿、自动保存、Undo/Redo、批量导入、定位、LayerTrack、ColorChannel、规则、扩展包和发布检查已实现并有自动测试；
- Creator Studio 主工作面支持英语、简体中文、日语、韩语和越南语；
- Sui 原协议包已发布并记录；
- 生产公开列表只接受真实链上 Maker；
- **尚未完成一位真人创作者钱包 + 第二玩家钱包的完整主网签名验收**；
- **v4 协议费用升级、费用共享对象和 Soulidity 适配器启用前，收费 Soul 铸造保持关闭**。

因此本版本适合邀请创作者进行严格试用和首个小型真实 Maker 发布验收，但不能把尚未留下主网交易证据的流程宣传为已经完成。

## 16. 测试反馈模板

提交问题时请附：

```text
页面：Creator Studio / Player Editor / On-chain Publish
钱包角色：创作者 A / 玩家 B
语言：中文 / English / 日本語 / 한국어 / Tiếng Việt
Maker / Part / Item / Style：
操作步骤：
预期结果：
实际结果：
是否刷新后复现：
浏览器与窗口尺寸：
截图或录屏：
交易摘要 / 对象 ID（如有）：
```

涉及钱包签名、对象权限、费用或发布不可恢复状态的问题按 P0 处理；素材映射、玩家无法组合、预览与最终导出不一致按 P0 处理；翻译、溢出和局部交互不稳定按 P1 处理。
