# Pack 按 Soul 购买与发布交接

2026-11-17。Animacraft 基线为 3ad32ba400f457932be7b6908b2fc2e79162c459，分支为 codex/soul-bound-paid-pack。产品依据为《Soul-Pack-衣柜与交割》2026-11-17 决定。

## 范围与计划

- 实现精确兼容 Soul 的付费 Pack 购买、共享 Pass、显式历史迁移与重复请求门禁。
- 接续现有 Player Complete 成功入口，为回执里的同一 Soul 进入购买页。
- 保留旧类型布局和历史请求身份，免费与随 Maker 提供的资格沿原规则。
- 与合约主责串行集成真实衣柜 API，购买及迁移拒绝已冻结挂牌的衣柜。
- 验证真实原生创建后的购买与迁移、SDK BCS、拒绝路径、网页入口和构建，将精确候选交正式工程与发布。

## ABI

共享 `runtime_v8::SoulPackPassV1` 按顺序记录以下字段。

```text
id, version=1, protocol_config_id, soul_id, soul_state_id, release_id,
root_id, root_version, root_content_commitment, release_content_commitment,
buyer, paid_atomic, issued_at_ms, legacy_pass_id, commitment
```

地址和对象字段为 Address，版本、金额及时间为 u64，承诺为 vector<u8>，legacy_pass_id 为 Option<ID>。原购买人的 buyer 是收据数据。使用资格通过真实 SoulState 的当前 owner/epoch 证明核对。

- `purchase_soul_pack_pass_v1` 从已经验证原生绑定的 equipment 提取 Soul/State，核对 Maker、Release、registry、当前协议、两家 treasury、精确付款、审核价格和到期时间。
- Release UID 下的 `SoulPackAccessKeyV1 { soul_id } -> ID` 唯一指向共享 Pass。重复请求在收款前拒绝。
- equipment UID 下的 `SoulPackEntitlementsKeyV1 -> vector<SoulPackEntitlementV1>` 原子记录 `{release_id,pass_id}`，用于真实交割清单。
- `assert_soul_pack_pass_v1`、`select_soul_pack_style_v1`、`attach_soul_pack_definitions_v1` 使用事务内原生设备更新 guard。
- `assert_soul_pack_read_v1`、`prove_soul_pack_selection_v1` 与 `runtime_seal_v8::certify_protected_soul_pack_entitlement_v1` 在当前持有人证明下读回同一 Pass 和已安装的精确样式。
- `migrate_pack_pass_to_soul_v1` 消费持有人主动指定的原 PackPassV8，保留原 Pass ID、原购买人、原金额和原时间，发出新旧关联事件。迁移调用不接收付款 Coin。

原生包装文件位于共同合约候选的 `move/soulidity/sources/animacraft_pack_adapter_v1.move`。purchase、migrate、read 和 protected entitlement 各自取得 package-private native witness。购买与迁移共同拒绝原生已挂牌状态和衣柜已冻结状态。

## 旧入口门禁与历史兼容

新建 PackRegistry 直接使用 schema 9。既有 Maker 由持有人调用 enable_soul_pack_registry_v1，在新购买和发布写开关开启前将同一 registry 从 8 显式迁移到 9。该操作核对 Maker admin、准入 authority、精确谱系及 revision。付费准入仍可原子完成尚未迁移 registry 的 8→9，并追加 `SoulPackRegistryEnabledV1` 事件。原三条 seal/admission/active 事件顺序保持。当前 Runtime 接受 registry 8/9。

当前准入的付费 Release 附带 SoulPackPolicyKeyV1，active 为 5，paused 为 6。旧 callable 的 paid purchase/attach/proof 使用 active 2 校验，旧 resume 使用 paused 3 校验。旧准入使用 registry schema 8 校验，迁移后拒绝其新发行路径。

既有已准入 paid Release 2、旧 PackPassV8 布局、旧付款与请求继续按其原身份读回。新付费资格只接受 SoulPackPassV1。历史迁移由持有人明确选择目标 Soul。免费和随 Maker 提供的旧钱包资格保留。衣柜的付费资格索引只包含新购买和已明确迁移的历史付费 Pass。

新类型的 defining origin 应从本次升级后的 type-origin 表读取。旧 PackRelease 类型仍使用其原来源。正式页面的新写开关由工程沿精确新 ABI 开启。

## SDK 和 Player

`maker-v8-soul-pack.js` 提供 BCS、按 Release/Soul 动态字段发现的 reader、购买 builder 和创建后购买链接。reader 核对主网、父归属、动态字段身份、共享 Pass、不可变兼容字段和承诺。RPC 失败保持错误状态。

Player 公开发现可显示 active 5 的 Pack。当前配方的购买入口提示先创建或接收兼容 Soul。只有匹配当前草稿的已确认 Complete 才生成 `https://www.soulidity.ai/packs/<release>?soul=<receiptSoul>`。正式站工程实现独立 journal、签前审核与按原摘要恢复。

跨 SDK 正例在 `test/fixtures/soul-pack-v1.json`，包含 canonical BCS 和 commitment。VM 对同一承诺有独立断言。首次升级后的真实事件 envelope 需由具体模拟和主网回执核对。

## 真实对象

只读证据在 `output/soul-pack-evidence/mainnet-reference-readback.json`，官方 GraphQL checkpoint 为 346286882。

- Maker 为 0x44bc74f617009dbab724f2f4f0853516e43319a95d6dece60b389df8beb33608。
- Soul 为 0x4faab55b4c56fb59a384b5cb52c6a0fa838eaa03f3570ecb0f26252ffa54ee59。
- State 为 0xe0c48e62bead5e9f5bd4032a3350ab9421bfc579ec6d29247cc00d70da4addb6。
- Native Soul/State 的真实类型来源为 0x5e3e75de3e1f661ffcad9bd0d53f3ea97e2e48f0765d2b2d9532256806409bb9。
- 根 Kiosk 为 0x8ccce3a01f91385b7578d0fa5899b0b6cfe36ed3cb1e58324f57c09fd7834e92。
- PackRegistry 为 0x79f4f053d12c0ea4e9378382148cf23301f8474bf9190abea1dcacff1ea12023，当时 schema8/revision1/release_count0。
- Runtime UpgradeCap 为 0xc5d9248832ab8e633fec7a14ea4437d391285b1492a9dfca565ebd1b8cf7cbbf，由原 A 钱包持有，原 Runtime 0x3c2dede0657ddbfba3a7dc39db5782530e4ea9dab666ec4f7bbeb99c09a83710 为 v1/policy0。

同一 Soul 的托管容器链与原生 State 来源由发布、总控和合约主责的原始 GraphQL 证据共同固定。待发布的精确 Pack Release/Pass 对象将在授权持有人完成对应发布后产生。

## 验证与发布接续

精确运行记录在 `output/soul-pack-evidence`。本轮的源码、VM 与网页测试证据独立于主网真实收据。

先前全量 JS 首跑发现两项缺少显式配套源码路径，以及一次 Chromium OOPIF 保护探针超时。配套路径已指定并复跑。原始上层 Move harness 与旧 native ABI 的两处不匹配由合约主责修复并保留用例。本线新增 `npm run move:test:soul-pack -- --soulidity-root <paired-root> --sui <approved-binary>` 可重现本轮真实原生创建与购买回归。

正式发布需共同冻结完整前端、SDK、Runtime 与 Native 候选，校验旧类型兼容、type origins、真实 UpgradeCap 与精确升级模拟。升级和有价交易的具体费用随精确报文审核，签名由获授权持有人执行。官网写开关及两个真钱包验收由正式工程、发布和独立验收继续完成。

## 最终本地验收

- `npm run check` 通过。4593 项通过，0 项失败，10 项跳过，语法检查、构建、783 个交付源码文件和 8 个生产制品扫描均通过。
- 真实 P1 六参数 grant 谱系的完整上层 Move harness 202 项通过。Runtime 251 项通过。
- 单独 SDK 14 项、测试运行器 27 项通过。真实 Chromium 5 项通过，界面矩阵 36 个场景通过。
- Runtime SHA-256 为 `89ce3337fe5f434f6c431eb455133c5adbea909d2d0d5bd298b4a1c8c00921ea`。
- SDK SHA-256 为 `5a640fe615171730f7730b7343e9826882c449be59eecdffde515556b856174b`。

结构化记录在 `docs/SOUL_PACK_VERIFICATION.json`。完整日志、图和公共链只读证据在 `output/soul-pack-evidence/final`。正式域名切换、新升级回执、管理员 registry 迁移、Pack 发布和双真钱包验收由正式工程与发布主责接续。

## 受保护 Pack 的追加批准入口

`release_v8::seal_approve_equipped_soul_pack_v1` 已补齐。沿原 equipped Pack 顺序使用 23 个显式参数，Pass 使用 SoulPackPassV1。原生当前持有人证明在同一 entry 内取得并交给 Seal consume。精确 ABI 在 `docs/SOUL_PACK_SEAL_APPROVAL_V1.json`。Release 编译、202 项原生回归和一项专项入口回归通过。真实主网解密回执待升级部署后的独立验收。

## M01 交割后 Maker 资格复验

合约主责在冻结 Runtime 原字节尾部追加三个 test-only 用例。新持有人刷新为自己的 Maker Pass 后，原非资产化 Base 样式及读证明通过。沿用卖家 Pass 和未刷新旧选择的路径均拒绝。Runtime 254 项、原生回归 202 项通过。追加测试后的源码 SHA 为 `7e116bf9a52da12bb1b092566293a44517b4c2c98ad0c76531c9e50ba5d15cca`，冻结生产源码仍按本交接的 `89ce3337…00921ea` 识别。

Runtime 原 UpgradeCap 的严格模拟已成功，checksEnabled 为 true。该模拟净 gas 为 779562963 MIST，当前预算上限为 900000000 MIST，使用原钱包 address balance。待签摘要为 `3abybBsxmMa9yrmCnPkoakoH3wm6mXzcufgqjyiaeSL8`，记录时尚未签名或提交。精确报文、构建哈希和证据路径在结构化交接的 postHandoffM01 字段。

当前签名单采用 runtime-upgrade-900m-unsigned-review.json，BCS SHA-256 为 `0f1c05eeaeeb32f2dd38481995519986f3bb1f4d572f4794b638f091a66eeaa4`。本线独立解码确认预算 900000000 MIST、原钱包 sender 和三条升级命令。旧 1500000000 MIST 报文在结构化记录中标记为 superseded。
