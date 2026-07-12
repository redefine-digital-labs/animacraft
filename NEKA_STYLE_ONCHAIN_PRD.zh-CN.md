# Animacraft：捏咔式 OC 创作工具 + 链上创作者经济 PRD

## 1. 产品论点

Animacraft 应该成为一个类似捏咔 / Picrew 的 OC 创作工具。任何人都可以使用创作者制作的模板来生成原创角色，创作者也可以发布可复用的角色生成套件。这个产品应该从最基础的创作者素材开始，把整个 OC 生产链条链上化：源素材、模板清单、用户生成的 OC 成品、授权、付费访问、交易、转售和收益结算。面向用户的编辑器仍然要像一个轻松好用的 OC 工具；协议层则在背后执行模板所有权、素材所有权、使用权限、创作者收益、付费部件、来源证明和转售规则。

目标产品不是“带角色编辑器的 NFT 市场”。它是一个以捏咔式编辑器为入口的链上 OC 生产系统。

## 2. 对标调研

### 2.1 捏咔 / Picrew 的产品模式

核心模式是：

- 用户选择一个图片生成器 / 模板。
- 生成器提供脸、头发、眼睛、衣服、配饰、背景等部件分类。
- 用户组合部件和颜色，生成一张角色图片。
- 输出结果可以立即作为头像、OC 设定图、个人主页图片、跑团/角色扮演图片、同人作品素材或社交分享资产使用。
- 创作者上传部件，设置元数据，发布生成器，并定义使用条件。

Picrew 将自己描述为一个双边平台：用户可以使用 image maker 生成图片，创作者可以用自己的插画制作 image maker。其支持文档强调，创作者设置不需要编程知识，并且创作者可以发布一个供很多人使用的生成器。来源：[Picrew Support top page](https://support.picrew.me/en/)、[How to create an image maker](https://support.picrew.me/en/create_imagemaker)。

### 2.2 创作者工具结构

Picrew 的创作者功能列表可以作为功能需求的重要参考：

- 注册为创作者
- 创建新的 image maker
- 编辑 maker 名称 / 描述
- 添加 parts
- 配置 part 设置
- 排序 part 图标
- 添加颜色
- 添加图层
- 排序图层
- 添加 items
- 配置 item 设置
- 上传 item 图片 / 图标
- 设置 part 规则
- 设置 item 规则
- 关联不同 part 的颜色
- 发布 image maker / 修改发布范围

来源：[Picrew Function List](https://support.picrew.me/en/functions_top)。

### 2.3 安全、权利和审核

Picrew 的公开规则说明，一个创作者平台需要内置以下控制能力：

- 创作者 / 素材 / 图片的定义
- 敏感内容标记
- 禁止内容类别
- 第三方 IP 与二创处理
- 二创作品的水印 / 签名要求
- AI 生成图片的披露 / 标签
- 商用、非商用、个人使用的区分

来源：[Picrew Guidelines](https://support.picrew.me/en/picrewguidelines)、[Picrew Terms of Use](https://support.picrew.me/en/terms)。

## 3. Animacraft 产品定位

Animacraft 应该是一个独立的创作者产品，由三层构成：

1. OC 创作体验：快速、漂亮、有趣，并且不需要理解 Web3。
2. 创作者工作台：模板发布、图层管理、素材校验、定价、权限和创作者 onboarding。
3. 协议层：通过 Soulidity 合约注册并执行源素材、模板、OC 输出、授权、付费访问、授权 grant、交易和结算。

产品承诺：

> 让 OC 创作像捏咔一样简单，同时让 OC 生命周期中每一个有经济意义的对象和权限都可以在链上执行。

### 3.1 产品飞轮

产品循环是：

```text
强创作者发布高质量 OC 模板
  -> 玩家使用模板生成成品 OC
  -> 成品 OC 被使用、展示、授权、交易或委托
  -> 交易产生创作者 / 素材方 / 平台收益
  -> 更多创作者发布更好的模板和素材
  -> 模板库变得更有价值
```

只有当授权和收益关系能够脱离单一 Web2 数据库继续存在时，这个飞轮才真正成立。因此协议应该把素材、模板版本、OC 输出、授权、访问证明和交易记录在链上。

## 4. 基础设施论点：为什么 Sui + Walrus 适合

OC 创作者经济同时需要两类基础设施：

1. 对象级所有权、规则、权限、交易和结算。
2. 用于 PNG 图层、图标、manifest、渲染图和源文件等大型创意资产的持久存储。

Sui 和 Walrus 可以清晰地覆盖这个分工。

### 4.1 Sui 的职责

Sui 应该作为规则和所有权层。

它负责：

- 创作者身份和钱包所有权
- 素材资产记录
- 模板对象和模板版本
- 生成 OC 的所有权
- 授权证明
- 付费访问记录
- 商用授权购买证明
- 上架 / 购买 / 取消
- 创作者 royalty 和平台 fee 结算
- 来源证明引用
- grant 和作用域权限
- collection / drop 权益

为什么重要：

- OC 资产不只是文件；它们是带有所有权、权利和交易行为的对象。
- Sui 的对象模型天然适合映射素材、模板、OC、listing、访问证明和 grant。
- 规则可以在交易发生时被执行，而不是只依赖平台承诺。

### 4.2 Walrus 的职责

Walrus 应该作为内容层。

它负责：

- 源 PNG 图层
- icon / thumbnail 资产
- 模板 manifest
- 素材 manifest
- 规则配置
- 色板配置
- 渲染后的 OC 图片
- recipe JSON
- license snapshot JSON
- 必要时的大型创作者源文件

为什么重要：

- 创意资产太大、数量太多，不适合直接存进 Move 对象。
- 链上应该保存 object id、blob id、hash、版本和权限。
- Walrus 存实际内容，Sui 执行谁可以引用、交易、访问或更新这些内容。

### 4.3 Soulidity 的职责

Soulidity 应该成为建立在 Sui + Walrus 之上的 OC 协议层。

它需要连接：

- Sui 对象所有权
- Walrus 内容 blob
- typed content kinds
- 创作者 royalty 规则
- 付费访问规则
- 市场交易
- grants
- collection / drop 流程
- 从素材到模板再到生成 OC 的来源证明

关键产品洞察：

> 基础设施已经足够强。缺失的是一个 OC-specific protocol 和创作者工具，把文件、模板、权限和交易组织成一个完整生命周期。

### 4.4 最终架构

```text
Animacraft Editor
  - 浏览模板
  - 捏 OC
  - 创作者设置
  - 素材包校验

Soulidity OC Protocol
  - 素材注册
  - 模板注册
  - OC mint
  - 授权 / 访问证明
  - 市场 / royalty 结算

Sui
  - 对象所有权
  - 交易执行
  - 上架与支付
  - grant / access / royalty

Walrus
  - PNG 图层
  - manifests
  - 渲染图片
  - 源文件
```

## 5. 协议用户角色

Animacraft 有普通产品用户，但协议需要更精确的角色定义。一个钱包可以同时拥有多个角色。

### 5.1 访客

未登录用户，浏览模板和示例作品。

可以：

- 浏览公开模板
- 查看公开示例输出
- 查看可见的授权摘要
- 如果模板允许公开预览，则可以开始本地预览会话

不能：

- 注册素材
- 发布模板
- 保存链上 OC 输出
- 购买付费访问
- 交易资产

协议状态：

- 不需要拥有对象
- 读取公开索引数据和公开 content slots

### 5.2 OC Maker / 玩家

使用模板创建 OC 输出的钱包用户。

可以：

- 选择公开模板
- 选择免费部件
- 购买付费部件访问
- 创建 recipe
- 将生成的 OC mint 为 `Soul`
- 下载被允许的渲染输出
- 如果可用，购买商用授权

拥有 / 接收：

- `OCRecipe` content
- 生成的 `Soul`
- license snapshot / proof
- paid access entries
- 如已购买，则拥有 commercial license proof

不能：

- 编辑创作者源素材
- 修改模板规则
- 绕过付费部件
- mint 一个不符合模板规则的 OC recipe

协议执行：

- 根据模板版本校验 recipe
- 对锁定部件检查 paid access
- mint 时附加 license snapshot
- provenance 指向模板 / 素材版本

### 5.3 创作者 / 画师

提供原创素材和模板的艺术家或模板作者。

可以：

- 注册 creator profile
- 注册源素材
- 上传 content-addressed PNG / icon / manifest blobs
- 使用已注册素材组装模板
- 发布模板版本
- 配置免费 / 付费 / 商用权限
- 配置 paid part packs
- 接收 royalty 和销售收益
- 废弃素材或发布新版本

拥有 / 控制：

- creator profile
- `TemplateMaterial`
- `CreatorTemplate`
- `TemplateVersion` publish authority
- license policies
- paid access configuration
- creator royalty receiver

不能：

- 悄悄修改已经发布的不可变模板版本
- 撤销买家已经 mint 的 OC 所有权
- 移除链上 provenance
- 追溯修改已经绑定到 minted outputs 的 license snapshots

协议执行：

- 素材注册记录 creator address
- 模板版本快照冻结 material refs / rules / license
- creator royalty BPS 在 mint / listing 流程中被捕获
- paid access config 决定锁定素材访问

### 5.4 素材所有者

拥有已注册源素材的钱包。通常是创作者本人，但如果模板 / 素材权利未来可转让，该角色可能与创作者不同。

可以：

- 注册素材版本
- 将素材标记为 active / deprecated
- 授权模板使用素材
- 如果配置了素材级收益，则接收收益

拥有 / 控制：

- `TemplateMaterial`
- material content pointer / hash
- material usage policy

重要区别：

- 创作者署名和素材所有权不一定永远相同。协议应该同时保留两者。

### 5.5 模板发布者

被授权发布模板版本的钱包或组织。它可以是创作者、工作室，也可以是托管发布账号。

可以：

- 将素材组装成模板
- 发布不可变模板版本
- 设置模板可见性
- 提交模板审核
- 配置模板级付费访问

拥有 / 控制：

- template publish cap 或 admin authority
- publish state
- version history

不能：

- 未经素材 owner 许可使用素材
- 原地修改已发布版本

### 5.6 买家 / 收藏者

购买 OC 输出、商用权利、付费部件访问，或潜在模板权利的用户。

可以：

- 购买 premium part access
- 购买 commercial license
- 购买 / 转售 minted OC `Soul`
- 购买 collection / drop rights
- 持有 access proofs

拥有 / 接收：

- paid access entry
- license proof
- purchased `Soul`
- 如相关，则拥有 collection rights

协议执行：

- market listing / buy / cancel
- creator royalty 和 platform fee
- paid access 根据 ownership epoch / duration 判断有效性
- 通过 Kiosk / policy 执行转让规则

### 5.7 委托方 / 品牌合作方

为独占模板、活动型模板或 OC 委托提供资金的用户或组织。

可以：

- 资助创作者模板或 OC 委托
- 接收 exclusive license proof
- 接收 campaign / drop rights
- 如果支持，则共同拥有 collection / drop 收益

拥有 / 接收：

- commission agreement proof
- exclusive license proof
- branded collection / drop rights

协议需要：

- scoped grants
- collection-level royalty split
- private preview access
- campaign publish window

### 5.8 策展 / 审核方

负责公开市场质量和法律 / 安全响应的平台或 DAO 角色。

可以：

- 批准 / 拒绝公开模板展示
- 标记敏感内容
- 隐藏 / 暂停公开发现
- 响应侵权报告
- 维护模板广场索引

不能：

- 抹除不可变链上历史
- 在没有明确协议规则的情况下没收用户拥有的 OC

协议需要：

- 模板 / 公开索引的 review status
- 链下审核证据
- 状态变化事件日志
- 在法律必要场景下提供紧急暂停 / 隐藏能力

### 5.9 协议管理员 / 治理

维护协议配置。

可以：

- 配置 platform fee
- 必要时暂停市场
- 添加 / 更新 content kind descriptors
- 管理 registry settings
- 在治理规则下升级协议模块

拥有 / 控制：

- admin cap
- market config
- kind registry config
- fee recipient

风险：

- 该角色会影响经济流，因此必须最小化并保持透明。

### 5.10 Indexer / Renderer / Storage Operator

读取链上事件并提供 UX 关键数据的基础设施角色。

可以：

- 索引模板 / 素材 / OC 输出
- 渲染 recipe 图片
- 缓存缩略图
- 镜像 Walrus / blob 可用性
- 提供搜索和筛选

不能：

- 成为所有权、授权或支付状态的事实来源

协议需要：

- 为素材注册、模板发布、OC mint、access purchase、license purchase、listing、sale 和 revenue settlement 提供完整事件。

### 5.11 角色汇总矩阵

| 角色 | 核心目标 | 拥有 / 控制 | 关键协议动作 |
| --- | --- | --- | --- |
| Visitor | 发现模板 | 无 | public reads |
| OC Maker | 创建 OC | OC recipe、generated Soul、license snapshot | buy access、mint OC |
| Creator / Artist | 发布并获得收益 | materials、templates、policies | register material、publish template、configure paid access |
| Material Owner | 控制源资产 | material records | version / deprecate / grant material usage |
| Template Publisher | 发布可用 maker | template versions | assemble / publish template |
| Buyer / Collector | 购买资产 / 权利 | access proof、license proof、Soul | buy part pack、license、OC |
| Commissioner / Brand | 资助独占作品 | commission proof、collection rights | fund、receive exclusive license / drop |
| Curator / Moderator | 维护公开广场安全 | review state / index state | approve、hide、suspend discovery |
| Protocol Admin | 配置协议 | admin caps / config | fee、pause、registry config |
| Indexer / Renderer | 让链上状态可用 | cache / index only | render、index、search |

## 6. 核心产品模块

### 6.1 Template Plaza

目的：发现模板，而不是编辑。

需求：

- 模板卡片网格
- 风格分类筛选
- 创作者名称
- 封面图
- 示例作品
- 授权 badge
- 部件数量
- 使用次数
- start-making CTA

避免：

- 侧边详情面板
- 开发者 JSON
- 冗长的 Web3 解释
- 创作者 onboarding 内容

### 6.2 Make OC Editor

目的：主要的捏咔式创作界面。

需求：

- slot / category rail：背景、身体、脸、头发、眼睛、嘴、衣服、配饰
- 画布预览
- 当前 slot 的部件网格
- 颜色选择器 / palette groups
- variant 支持
- 在允许的情况下提供 remove / none 选项
- 简单保存 / 导出
- recipe capture 默认隐藏在详情中

高级捏咔 / Picrew 类需求：

- 部件顺序 / 图层顺序
- color link groups
- part rules：选择一个 item 可以隐藏 / 禁用另一个
- item rules：item 依赖和互斥
- randomize 只有在被明确设计为玩法功能时才保留，不能作为含糊的全局按钮
- 基于模板 recipes 生成 preview examples

### 6.3 Creator Setup

目的：创作者侧模板元数据。

需求：

- 模板名称
- 创作者名称 / 地址
- 描述
- tags / category
- 封面图
- 示例作品
- license preset
- commercial-use permission
- derivative-work permission
- AI-use permission
- 二创模板的 watermark / signature requirement
- creator royalty BPS
- platform fee estimate
- publish state：draft / private preview / public / suspended

### 6.4 Asset Pack Manager

目的：画师素材流水线。

需求：

- PNG 上传
- 透明背景校验
- canvas size 校验
- 文件命名规范校验
- slot mapping
- item mapping
- icon upload
- layer order preview
- missing slot warnings
- duplicate name warnings
- package export / import

推荐素材模型：

```json
{
  "templateId": "published-maker-id",
  "canvas": { "width": 1024, "height": 1024 },
  "slots": [
    {
      "key": "hairFront",
      "label": "Front Hair",
      "renderOrder": 40,
      "items": [
        {
          "id": "side",
          "label": "Side Bangs",
          "layers": ["hairFront_side_default.png"],
          "colorGroup": "hair",
          "rules": { "requires": [], "excludes": [] }
        }
      ]
    }
  ],
  "colorGroups": [
    { "key": "hair", "default": "#7c3aed", "linkedSlots": ["hairBack", "hairFront"] }
  ]
}
```

### 6.5 Guide / Onboarding

目的：帮助创作者发布第一个模板。

需求：

- “最小可用模板” checklist
- 示例 PSD / PNG package
- 命名规则
- 图层顺序指南
- 权利 / 授权解释
- 常见错误
- 发布审核 checklist

### 6.6 Advanced / Export

目的：开发者 / 协议桥接。

需求：

- recipe JSON
- creator manifest JSON
- OC package JSON
- 生成的 `oc.md`
- Walrus / content upload preview
- 未来的 contract transaction preview

这个模块不能作为默认界面。

## 7. 链上规则映射

Soulidity 已经具备很多有用的基础模块：

- `soul.move`：`Soul`、`SoulState`、creator、royalty BPS、provenance、state config、ownership epoch。
- `market.move`：mint / list / buy 流程、creator royalty、platform fee、基于 Kiosk 的 listing。
- `content.move`：`SoulContent`、typed content slots、版本管理、read modes、active bindings、Walrus blobs。
- `paid_access.move`：per-kind paid access configs 和 buyer entries。
- `collection.move`：分组和 collection rights。
- `grant.move`：scoped temporary grants。
- `kind_registry.move`：content kind descriptors 和规则。

### 7.1 全链上生命周期

目标架构不是“先做本地编辑器，之后可选 mint”。它是一个完整的链上资产生命周期，每个有意义的创作对象都应该有标准链上记录。

```text
Creator source material
  -> On-chain Material Asset / content blob
  -> On-chain Creator Template
  -> User OC Recipe
  -> Rendered OC Output
  -> License / access proof
  -> Trade / resale / paid access
  -> Revenue settlement and provenance
```

#### 阶段 A：源素材注册

最小链上单元应该是创作者素材，而不只是最终 OC。

例子：

- 头发 PNG 图层
- 眼睛 PNG 图层
- 衣服 PNG 图层
- 背景 PNG
- icon / thumbnail
- color palette config
- rule config
- layer order config

每个素材应该包含：

- creator address
- material hash / blob object id
- material kind
- slot key
- item id
- template association
- license policy snapshot
- version
- status：draft / active / deprecated / removed

实现方向：

- 二进制资产存在 Walrus blobs。
- 素材元数据和规则存在 typed `SoulContent` 或新的 template / material module。
- `kind_registry` 应定义 `template_material`、`template_manifest`、`template_rule_config`、`template_palette`、`template_cover` 等 kind。

#### 阶段 B：模板组装

模板是已注册素材和规则的链上组合。

模板对象应该证明：

- 谁创建了它
- 它包含哪些素材
- 哪些素材版本处于 active
- 有哪些 slots / items / colors / rules 是有效的
- 适用哪些授权和价格
- 哪些锁定 item 需要 paid pack

这意味着 template manifest 不只是一个可下载 JSON。它是后续 OC 创建的标准规则包。

#### 阶段 C：用户 OC 创建

当用户创建 OC 时，recipe 应引用：

- template id
- template version
- selected material ids / item ids
- color values
- rule validation result
- license snapshot
- creator royalty snapshot

渲染后的 OC 可以作为 `Soul` mint，并包含：

- `Soul.name` / `Soul.description` / image URL
- `SoulState.creator_royalty_bps`
- `SoulContent` entries：recipe、rendered image、license snapshot、source template reference
- `origin_ref` 或等价 provenance 指向模板

#### 阶段 D：授权

授权必须明确、机器可读。

例子：

- personal-use output
- public social sharing
- 单个生成 OC 的 commercial use
- 来自某模板的所有输出的 commercial use
- derivative template permission
- AI usage permission
- paid premium parts access

链上可以执行：

- 谁拥有哪个 OC
- 谁购买了哪个 access kind
- 哪些内容可读 / 可下载
- 哪个 commercial license 已被购买
- resale 和 royalty flows

链下审核仍然处理主观侵权、非法内容和 takedown。

#### 阶段 E：交易和结算

交易应该支持：

- template sale 或 subscription
- paid part pack purchase
- commercial license purchase
- OC resale
- collection sale
- creator royalty
- platform fee
- collection / brand collaboration 的 optional extra royalty

Soulidity 已经有 market listing、creator royalty、platform fee、collection listing 和 paid access primitives。Animacraft 应该把每个产品购买行为映射到这些 primitives，而不是发明不相关的支付路径。

### 7.2 建议链上对象层级

```text
CreatorProfile
  └─ CreatorTemplate
      ├─ TemplateMaterial[]
      ├─ TemplateManifest
      ├─ TemplateLicensePolicy
      ├─ PaidPartPack[]
      └─ TemplateVersion[]

OCSoul / GeneratedOC
  ├─ OCRecipe
  ├─ RenderedImage
  ├─ LicenseSnapshot
  ├─ SourceTemplateRef
  └─ Provenance / Parent refs
```

推荐拆分：

- `CreatorTemplate`：可转让或不可转让的模板根对象。
- `TemplateMaterial`：创作者拥有的注册素材条目。
- `TemplateVersion`：不可变的已发布版本快照。
- `TemplateLicensePolicy`：机器可读的权利和限制。
- `OCSoul`：基于模板生成并 mint 的用户角色。
- `PaidPartPack`：对 premium materials 的付费访问。

### 7.2.1 角色到对象所有权映射

| 对象 | 所有者 / 控制者 | 是否可转让 | 说明 |
| --- | --- | --- | --- |
| `CreatorProfile` | Creator / Artist | 通常否 | 身份和收款元数据。 |
| `TemplateMaterial` | Material Owner | 可选 | 源素材权利未来可能可转让。 |
| `MaterialVersion` | Material Owner | 否 | 不可变 content / hash 快照。 |
| `CreatorTemplate` | Creator 或 Template Publisher | 可配置 | 模板根对象；是否可转让是产品决策。 |
| `TemplateVersion` | Template Publisher | 否 | 不可变的已发布 maker version。 |
| `TemplateLicensePolicy` | Template Publisher / Creator | 对已发布版本而言否 | License snapshots 发布后不能变。 |
| `PaidPartPack` | Creator / Template Publisher | 否或受控 | 访问配置，不一定是可转让资产。 |
| `PaidAccessEntry` | Buyer / OC Maker | 否 | 买家可以使用 / 读取锁定 material kind 的证明。 |
| `CommercialLicenseProof` | Buyer / OC Maker / Commissioner | 通常否 | 可绑定到一个 OC 或模板访问。 |
| `OCRecipe` | OC Maker | mint 快照后否 | Recipe 一旦 mint 应不可变。 |
| `OCSoul` | OC owner | 是 | 主要可交易的生成角色。 |
| `SoulListing` | Seller / market flow | 不直接转让 | Listing 是生命周期对象。 |
| `SoulCollection` | Creator / brand / collector | 是 / 可配置 | 用于 drops、packs 或 campaigns。 |
| `SoulGrant` | Grant issuer / grantee scope | 否 | 临时作用域权限。 |

### 7.2.2 权限原则

- 只有模板发布者获得素材 owner 授权后，素材才能被用于模板。
- 模板版本会冻结生成 OC 时使用的素材版本、规则、价格和授权政策。
- 用户只有在 recipe 通过冻结模板版本规则校验后，才能 mint OC。
- 付费 item 只有在用户拥有所需 paid access proof 时才能被选择。
- 商用输出需要 commercial license proof，或模板默认授予商用权。
- 即使模板后续修改政策，已 mint 的 OC 也保留它 mint 时的 license snapshot。
- 转售必须保留 creator royalty 和 platform fee 规则。
- 审核方可以影响 discovery state，但不应该改写 ownership / provenance。

### 7.3 哪些必须链上，哪些可以链下

链上：

- 对象所有权
- creator address
- material / template / OC ids
- content hashes / blob ids
- version pointers
- license policy hashes / snapshots
- paid access records
- creator royalty BPS
- platform fee
- listing / buy / cancel
- provenance refs
- commercial license purchase proof

链下但内容寻址：

- PNG files
- 创作者选择发布时的 PSD / source files
- rendered images
- 大型 JSON manifests
- moderation evidence
- search indexes
- thumbnails / cache

仅链下：

- 人工审核决策
- 非法内容响应
- 客服
- 超出钱包所有权之外的创作者身份验证

### 7.4 当前 Soulidity 的适配性

当前 Soulidity 已经覆盖了很多后期需求：

- `Soul` 可以表示生成的 OC。
- `SoulState.creator_royalty_bps` 捕获 creator royalty。
- `SoulContent` 可以通过 Walrus blobs 存储 typed recipe / render / license content。
- `SoulState.config_ext` 可以存储小型 config blobs，例如 sprite / template config。
- `Market` 可以 mint、list、buy、cancel，并结算平台 / 创作者 fee flows。
- `PaidAccess` 可以用 kind 表示 premium parts 或 commercial-use access。
- `Collection` 可以对 OC 输出或模板衍生 drops 进行分组。
- `Grant` 可以支持临时 scoped usage、协作或 preview access。

缺口：

- 当前还没有专门为可复用 OC maker 设计的一等 template / material registry object。
- 现有 `Soul` 可以表示生成 OC，但如果用它表示每一个源素材，可能过重。
- Animacraft 可能需要一个新的模块，或明确的 content-kind 约定，来表示 `CreatorTemplate`、`TemplateMaterial` 和 `TemplateVersion`。

### 7.5 推荐合约路线

Phase 1：不新增 Move module，先用约定。

- 将 template manifest 注册为 `SoulContent`。
- 将生成 OC mint 为 `Soul`。
- 将 recipe / license / render 存为 typed content。
- 使用 `PaidAccess` 表示 paid packs。
- 使用 `Market` 表示 OC sale / resale。

Phase 2：新增 template registry。

- 新增 `template.move` module，包含 `CreatorTemplate`、`TemplateVersion`、`TemplateMaterial`。
- Template versions 成为不可变快照。
- 素材在模板发布前完成注册和版本化。
- OC mint 根据已发布模板版本校验 recipe。

Phase 3：完整创作者经济。

- 链上模板市场。
- 付费素材包。
- 商用授权购买。
- 二创模板 provenance。
- 基于事件的创作者收入 dashboard。

### 7.6 建议合约概念

当前 Soulidity 合约可以支持 minted OC packages，但 Animacraft 可能需要额外的模板级对象。

#### CreatorTemplate

表示一个可复用 image maker 模板。

字段：

- template_id
- creator
- name
- description
- cover_url
- license_policy_id
- asset_manifest_content_id
- creator_royalty_bps
- publish_state
- version

合约映射：

- 可以是新的 Move 对象；如果保持当前架构，也可以是特定 `Soul` / `SoulContent` kind。
- asset manifest 可以作为 typed content kind 存在 `content.move` 中。
- paid part packs 的定价可以使用 `paid_access.move`。

#### TemplateLicensePolicy

定义使用规则。

字段：

- personal_use_allowed
- noncommercial_share_allowed
- commercial_use_allowed
- derivative_allowed
- ai_training_allowed
- ai_prompt_allowed
- watermark_required
- attribution_required
- commercial_license_price

合约映射：

- policy metadata 存储为 content / config。
- 可执行的 paid access 和 ownership states 存储在链上。
- 主观违规仍然需要链下审核和 takedown 流程。

#### OCRecipe

表示用户选择的部件和色板。

字段：

- template_id
- template_version
- selected_items
- palette
- generated_image_url
- owner
- provenance_kind
- parent_oc_id optional

合约映射：

- 作为 `Soul` mint。
- recipe JSON 存为 `SoulContent`。
- 图片和素材包存为 Walrus blobs。
- derivative chain 通过 `origin_ref` 或显式 parent reference 表示。

#### PaidPartPack

表示可购买的模板内容，例如高级发型、服装、背景。

合约映射：

- `paid_access.move` 的 per-kind configs 可以建模 template parts 的付费访问。
- access entries 绑定 buyer、kind、price、duration 和 owner epoch。

## 8. 数据模型需求

### Material Asset

必需字段：

- schema version
- material id
- creator address
- source blob id / content hash
- slot key
- item id
- layer role：main / mask / icon / thumbnail / source
- canvas config
- license policy snapshot
- template ids allowed to use it
- status
- version

素材资产是链上系统的基础。模板应该引用已注册素材，而不是把上传的 PNG 文件当成匿名本地文件。

### Template Manifest

必需字段：

- schema version
- template id
- creator identity
- canvas config
- slots
- items
- layers
- color groups
- rules
- license policy
- pricing
- example recipes
- publish metadata
- material ids and material versions
- license policy id / snapshot
- paid access kind ids

### OC Package

必需字段：

- schema version
- package id
- source template id / version
- selected recipe
- rendered image URL / local export
- license snapshot
- creator royalty snapshot
- owner
- derivative / provenance refs
- material ids used
- template version id
- 如购买了 commercial / paid access，则记录 license proof id

### 需要的 Content Kinds

新增 / 定义 kind registry entries：

- material_asset
- material_source
- material_icon
- template_manifest
- template_asset_pack
- template_material_index
- template_license_policy
- template_cover
- template_example_recipe
- oc_recipe
- oc_rendered_image
- oc_license_snapshot
- commercial_license_proof

## 9. MVP 范围

### MVP 0：本地原型

- 模板卡片网格
- Make OC editor
- creator setup 内部页
- asset upload metadata parser
- recipe export
- creator manifest export

### MVP 1：链上素材注册

- creator wallet identity
- 将真实 PNG 上传到 content-addressed storage
- 注册 material asset records
- 注册前校验 canvas / layers
- 注册 material kind / slot / item metadata
- 对已注册素材进行版本化
- 标记素材 active / deprecated
- 索引 creator material library

### MVP 2：链上模板注册

- 从已注册素材组装模板
- 发布不可变 template version
- 存储 template manifest 和 license policy
- 配置 paid part packs
- 发布 private preview link
- public template page 读取 chain-backed template state
- template card grid 基于链上事件索引

### MVP 3：链上 OC Mint

- 用户从 template version 创建 OC recipe
- 根据 template manifest 校验 recipe
- 渲染图片并存储 content-addressed output
- 将生成 OC mint 为 `Soul`
- 将 recipe / render / license snapshot 存为 typed content
- 记录 template / material provenance
- 执行 creator royalty BPS

### MVP 4：链上经济

- paid template access
- paid part packs
- commercial license purchase
- resale / listing
- creator dashboard
- settlement / events indexing

## 10. 授权与交易矩阵

| 产品动作 | Actor | 链上对象 / 证明 | 支付路径 | 收益接收方 | 说明 |
| --- | --- | --- | --- | --- | --- |
| 注册素材 | Creator / Material Owner | `TemplateMaterial` / content kind | 无 | 无 | 建立 creator / source provenance。 |
| 发布模板 | Creator / Publisher | `CreatorTemplate` + `TemplateVersion` | optional listing fee | 如配置，则平台收取 | 模板引用已注册素材。 |
| 使用免费模板 | OC Maker | recipe + license snapshot | 无 | 无 | 输出仍可携带授权限制。 |
| 使用高级部件 | OC Maker / Buyer | `PaidAccess` entry by kind / pack | paid access purchase | creator / material owner + platform | 买家获得锁定 material kinds 的访问权。 |
| 购买商用授权 | Buyer / Commissioner | license proof object / content | paid access 或 license purchase | creator / material owner + platform | 可绑定到一个 OC 或模板访问。 |
| Mint 生成 OC | OC Maker | `Soul` + `SoulContent` | mint fee optional | 如配置，则平台 / creator | 存储 recipe / render / license / provenance。 |
| 转售 OC | Seller / Buyer | `SoulListing` | market buy flow | seller + creator royalty + platform | 保留 creator royalty 和 platform fee。 |
| 出售模板权利 | Creator / Buyer | template listing / right object | market buy flow | creator + platform | 后期可选功能，可能受限制。 |
| 授予协作访问 | Creator / Owner | `SoulGrant` / scoped grant | 无或付费 | 如付费，则 grant issuer | 用于团队、委托、review access。 |
| Collection / drop sale | Creator / Brand / Collector | `SoulCollection` | collection listing | collection owner + creators + platform | 用于 creator packs 或 branded drops。 |

## 11. 产品决策

### 隐藏协议复杂度，但不隐藏协议存在

编辑器不应该要求用户在制作 OC 前理解合约，但产品架构假设素材、模板、输出、授权和交易都有标准链上记录。UI 隐藏复杂度，但不能把链上注册当成可选的事后步骤。

### 模板页不应该像后台详情页

模板发现应该像浏览 image makers。点击卡片应开始创作，或打开一个视觉丰富的模板页。侧边详情面板会让产品显得像内部后台。

### 创作者功能必须是内部工作区

Creator Setup、Asset Pack、Guide 和 Advanced 都是编辑器子页。它们不应和主 Make 流程竞争。

### JSON 属于 Advanced

Recipe / manifest / package JSON 对协议开发是必要的，但除非用户进入 Advanced 模式，否则应该隐藏。

## 12. 待定问题

- 创作者模板本身是否应该是可转让资产，还是只有已发布 OC 输出可转让？
- paid part packs 应按模板、按创作者，还是按订阅购买？
- commercial license 应绑定到一个生成 OC，还是绑定到用户对模板的访问权？
- 涉及第三方 IP 时，二创作品应如何在链上表示？
- 多少审核可以链上化，多少必须是平台政策 / 链下审核？
- AI-training permissions 是否应作为显式链上标志？

## 13. 近期开发需求

1. 用真实图层渲染替换当前 CSS avatar demo。
2. 实现 material asset manifest format。
3. 实现 template manifest importer。
4. 实现 slot / item / layer ordering。
5. 实现 linked color groups。
6. 实现 part / item rules。
7. 添加 rendered image export。
8. 添加 draft persistence。
9. 添加 creator asset validation report。
10. 添加 template preview recipes。
11. 添加 on-chain material registration adapter spec。
12. 添加 template registry Move module design。
13. 添加 Soulidity adapter spec，用于 mint template-derived OC packages。
14. 添加 paid part pack 和 commercial license purchase flow spec。

## 14. 资料链接

- Neka: https://www.neka.cc/
- Picrew support top page: https://support.picrew.me/en/
- Picrew create image maker: https://support.picrew.me/en/create_imagemaker
- Picrew function list: https://support.picrew.me/en/functions_top
- Picrew guidelines: https://support.picrew.me/en/picrewguidelines
- Picrew terms: https://support.picrew.me/en/terms
- 本地 Soulidity 合约：`clawnews/move/soulidity/sources/`
