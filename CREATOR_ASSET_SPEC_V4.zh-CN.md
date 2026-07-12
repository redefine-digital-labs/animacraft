# Animacraft Maker v4 创作者素材交付规范

版本：4.0
状态：Creator Studio P0/P1 实施基线
适用对象：画师、美术外包、Maker 设计师、技术美术、内容审核人员

这份规范解决一个核心问题：**每张素材单独看都能用，但组合后仍然不像同一个角色。**

Animacraft 不引入骨骼、人体关键点或复杂 Rig。组合稳定性依靠三件事：

1. 全 Maker 共用一个固定 Canvas 坐标系；
2. 创作者在 Creator Studio 内确定位置、等比缩放和层位绑定；
3. 玩家只选择 Item、Variant 和颜色，不移动素材。

Angie 的 Astral Courier 只用于暴露复杂组合问题，是负向压力样本，不是合格美术或视觉标准答案。

---

## 1. 交付对象与术语

| 名称 | 含义 | 例子 |
|---|---|---|
| Maker | 玩家可以使用的完整角色模板 | Astral Courier |
| Part | 玩家菜单中的部位分类 | Hair、Outfit、Eyes |
| Item | 玩家一次点击选择的完整选项 | Moonlit Wolf Cut |
| Variant | 同一 Item 内的方向、花纹或款式变化 | Left、Right、Pattern A |
| LayerBinding | Variant 实际绘制的一张素材及其层位、位置和混色设置 | Hair Front PNG → `hair-front` |
| LayerTrack | 全 Maker 共用的全局渲染层位 | `hair-back`、`hair-front` |
| ColorChannel | 多层联动的颜色通道 | `hair-color` 同时控制前发和后发 |
| Recipe | 玩家选择结果 | Hair=A、Outfit=B、Color=Violet |
| ExpansionPack | 已发布 Maker 的附加素材包 | Season 1 Hairstyles |

一个 Item 可以绑定多张 Layer：

```text
Item: moonlit-wolf
└── Variant: default
    ├── moonlit-wolf__hair-back.png  → hair-back
    ├── moonlit-wolf__hair-front.png → hair-front
    └── moonlit-wolf__highlight.png  → hair-highlight
```

玩家点击一次 `moonlit-wolf`，三张素材必须一起切换。

---

## 2. 标准交付包

每个 Maker 使用一个独立目录：

```text
maker-id/
├── master/
│   ├── maker-id.psd
│   └── reference-default.png
├── runtime/
│   ├── background/
│   │   └── moon-portal/default/background.png
│   ├── base/
│   │   └── porcelain/default/body-base.png
│   └── hair/
│       └── moonlit-wolf/default/
│           ├── hair-back.png
│           └── hair-front.png
├── thumbnails/
│   ├── parts/hair.png
│   └── items/hair/moonlit-wolf.png
├── cover/
│   └── default-cover.png
├── mapping.csv
├── rights.json
└── README.zh-CN.md
```

不得只交付一批无法对应 Part、Item、Variant 和 LayerTrack 的散图。

### `mapping.csv` 必填列

```csv
part_id,item_id,variant_id,layer_track_id,file,required,default_item,blend_mode,color_channel_id,thumbnail
hair,moonlit-wolf,default,hair-back,runtime/hair/moonlit-wolf/default/hair-back.png,false,true,normal,hair-color,thumbnails/items/hair/moonlit-wolf.png
hair,moonlit-wolf,default,hair-front,runtime/hair/moonlit-wolf/default/hair-front.png,false,true,normal,hair-color,thumbnails/items/hair/moonlit-wolf.png
```

`part_id + item_id + variant_id + layer_track_id` 必须唯一。

---

## 3. Canvas 和坐标系

### 3.1 Canvas 是合同字段

- 坐标原点：左上角 `(0, 0)`。
- X 轴向右增加，Y 轴向下增加。
- 单位：Canvas 像素。
- 推荐人像 Maker：`1024 × 1024`。
- 高细节 Maker 可使用 `2048 × 2048`，但必须在正式绘制前确定并通过性能预算。
- 宽高必须为整数，Maker 开始制作后不得随意改变。
- 同一 Maker 的所有 runtime PNG 必须与 Maker Canvas 完全相同。

Master PSD、Creator Studio Canvas 和导出 PNG 应当 1:1 使用相同尺寸。不要在 2048 PSD 中随意导出 1024 素材，再依赖编辑器猜测缩放。

### 3.2 标准发布坐标

画师交付的标准 runtime PNG 使用：

```json
{
  "x": 0,
  "y": 0,
  "scale": 1,
  "rotation": 0
}
```

PNG 内容可以只占 Canvas 的一部分，但文件本身必须保留完整透明 Canvas。

Creator Studio 也允许导入裁切小图，并让创作者通过拖动、等比缩放确定 `x / y / scale`。发布时会把经确认的 transform 与源图一起写入 Maker，不会自动裁切、拉伸或覆盖源素材；玩家端只读取这组固定绑定，不开放移动。正式画师交付仍优先使用完整 Canvas PNG，这样最容易审查和跨 Item 对齐。

### 3.3 不使用人体 Rig，但必须使用组合参考

本规范不要求人体骨架、关节点或统一脸型。PSD 中必须保留以下非导出参考层：

- Canvas 边界；
- Maker 的 Default Recipe 合成图；
- 当前 Maker 创作者选定的构图中心线；
- 至少一组“Base + Outfit + Hair + Expression”完整组合参考。

这些参考只服务于这个 Maker，不是跨 Maker 的人体模板。

### 3.4 对齐判定

相同尺寸不代表对齐。验收会比较每个 Item 的可见 Alpha Bounds：

- Base/肤色变体不应让头部、肩线整体漂移；
- Outfit 领口必须与该 Maker 的 Base 对齐；
- Expression 必须位于该 Maker 的脸部区域；
- Hair Front、Hair Back 必须同时适配 Default Base；
- 只有造型本身需要时，轮廓中心才可以明显改变。

自动检测只报告可疑位移，最终由创作者进行叠加检查，工具不会自动“修正人体”。

---

## 4. PSD / PSB 制作规范

### 4.1 文档设置

- 尺寸与 Maker Canvas 完全一致；
- 色彩空间：sRGB IEC61966-2.1；
- 8 bit/channel；
- 背景透明；
- 不使用会改变导出尺寸的 Trim、画板裁切或 Export Bounds；
- 所有智能对象和链接素材必须随包交付或栅格化；
- 字体仅允许出现在封面/缩略图，不得意外进入 runtime Layer；
- Guides 与参考层放在 `00_GUIDES_DO_NOT_EXPORT` 中。

### 4.2 推荐图层结构

```text
00_GUIDES_DO_NOT_EXPORT
05_DEFAULT_REFERENCE_DO_NOT_EXPORT
10_BACKGROUND
20_BACK_ACCESSORY
30_HAIR_BACK
40_BODY_BASE
50_OUTFIT_BACK
60_EXPRESSION
70_OUTFIT_FRONT
80_HAIR_FRONT
90_FACE_ACCESSORY
95_FOREGROUND
```

组序号仅帮助 PSD 阅读；最终遮挡关系以 Maker 的全局 LayerTrack 顺序为准。

每个可选素材组命名：

```text
part-id__item-id__variant-id__layer-track-id
```

例如：

```text
hair__moonlit-wolf__default__hair-back
hair__moonlit-wolf__default__hair-front
```

### 4.3 必须拆层的情况

出现以下任一遮挡需求时，必须拆成多个 LayerBinding：

- 长发需要一部分在身体后、一部分在脸前；
- 外套需要身体后摆和胸前领口分别遮挡；
- 帽子需要位于后发之前、前发之后；
- 耳环一部分被头发遮挡；
- 手持物需要在身体前后穿插；
- 特效既有背景光，又有前景粒子。

不能用一张“看起来完整”的 Hair 或 Outfit PNG 代替所有前后关系。单张复合图只适合没有跨部位遮挡需求的素材。

### 4.4 不允许的源文件状态

- 每个肤色是从不同构图独立生成，头肩位置不一致；
- 每件衣服有自己的身体或脖子底图；
- Expression 带着皮肤、头发或背景；
- Hair PNG 烘焙了脸、耳朵或衣服；
- 为了“None”制作一张空白 PNG；
- 不同 Item 使用不同 Canvas 尺寸；
- 使用屏幕截图代替透明源图；
- 只提供合成封面，没有可独立组合的 Layer。

---

## 5. 全局 LayerTrack 规划

LayerTrack 是 Maker 全局资源，不属于某一个 Part。推荐人像初始层位：

| 建议顺序 | LayerTrack ID | 典型内容 |
|---:|---|---|
| 0 | `background` | 背景 |
| 10 | `back-effect` | 背景粒子、光环后层 |
| 20 | `back-accessory` | 背包、后侧饰品 |
| 30 | `hair-back` | 后发 |
| 40 | `body-base` | 身体、皮肤基础 |
| 50 | `outfit-back` | 衣服后摆 |
| 60 | `expression` | 五官、表情 |
| 70 | `outfit-front` | 领口、胸前服装 |
| 80 | `hair-front` | 刘海、前发 |
| 90 | `face-accessory` | 眼镜、面罩 |
| 100 | `front-accessory` | 耳环、发夹、手持物 |
| 110 | `foreground` | 前景特效 |

实际 Maker 可以新增、删除和拖动排序，不要求机械复制这张表。必须避免大量不同作用的素材挤在同一层位，否则 Item 之间的遮挡结果会不稳定。

Part 菜单顺序、Item 展示顺序和 LayerTrack 渲染顺序是三套独立顺序，不能混用。

---

## 6. Item、Variant、可选状态和条件

### 6.1 Item 与 Variant

使用 Item 表达玩家认为“一次选择”的完整内容；使用 Variant 表达同一内容内部的样式：

- `Item: sailor-uniform`；
- `Variant: plain / striped / left-facing`。

不要把前发和后发做成两个玩家 Item。它们是同一 Item 下的两个 LayerBinding。

### 6.2 Required 和 Default

- `required=true` 的 Part 必须有 `defaultItemId`；
- 每个可发布 Item 必须有 `defaultVariantId`；
- 可选 Part 可以没有默认 Item，Recipe 中缺少该 Part 即表示 `None`；
- 不得通过全透明 PNG Item 模拟 `None`；
- Default Recipe 必须能独立生成一张完整、可展示的角色图。

### 6.3 Parent、visibleWhen、requires、excludes

画师无需手写规则 JSON，但必须在 `mapping.csv` 或 README 中说明组合限制：

- `parentPartId`：父 Part 未选择时，子 Part 不显示；
- `visibleWhen`：满足条件时才显示某一 Part/Item/Layer；
- `requires`：选择本项必须同时选择目标项；
- `excludes`：本项不能与目标项同时使用。

所有限制必须可由 Item/Variant ID 表达，不接受“玩家自己看着别选错”的口头约定。

---

## 7. PNG 导出标准

每张 runtime 图片必须满足：

- PNG；
- 8-bit RGBA；
- non-interlaced；
- sRGB；
- 与 Maker Canvas 完全同宽高；
- 透明背景；
- 不执行 Trim / Crop to Content；
- Alpha 边缘无白边、黑边或背景残留；
- Canvas 外内容不得被静默裁切；
- 同一 Item 的多张 Layer 使用完全相同的坐标空间；
- 文件内容与命名映射一致。

性能建议：

- 单张 1024 PNG 通常控制在 2 MiB 内；
- 超过 8 MiB 的单张素材必须重新检查无效透明 RGB、噪点和压缩；
- 基础 Maker 建议控制在 150 MiB 内；
- 发布硬限制为最多 4,999 个资产文件，另需为 manifest 保留空间；
- 大型内容应拆分为 ExpansionPack，避免玩家首次加载所有 DLC。

### 7.1 文件名

所有公开 ID 使用：

```regex
^[a-zA-Z0-9_-]+$
```

推荐全部使用小写 kebab-case：

```text
moonlit-wolf
hair-front
warm-beige
```

路径中不得包含：

- 空格；
- 中文标点；
- `.` 或 `..` 路径段；
- 反斜线；
- 重复 ID；
- 仅大小写不同的文件名。

展示名称可以使用中文、日文或其他语言，ID 不随翻译变化。

---

## 8. 缩略图、Part 图标和封面

### 8.1 自动缩略图

Creator Studio 会根据 Alpha Bounds 自动裁透明边生成 UI 缩略图。自动裁切只用于缩略图显示，不得修改 runtime 源图。

### 8.2 独立缩略图

复杂、细小或全画布中不易识别的 Item 必须提供独立缩略图：

- Item 缩略图：`512 × 512` RGBA PNG；
- Part 图标：`256 × 256` RGBA PNG；
- 主体占画面约 75%–90%；
- 四周至少保留 8% 安全边距；
- 使用中性背景或透明背景；
- 不得展示实际 Item 中不存在的装饰；
- 不依赖难以本地化的小字。

### 8.3 封面

- 标准封面：`1024 × 1024`；
- 必须由 Default Recipe 通过正式共享 Renderer 生成；
- 可以增加边框、Maker 名称和作者信息，但角色主体必须来自真实 Recipe；
- 不允许用独立概念图冒充 Maker 实际可组合效果；
- 封面生成时的 MakerVersion、Recipe 和内容 Hash 必须可追溯。

---

## 9. ColorChannel、混色和像素模式

### 9.1 两种调色模式

`asset-map`：每个色板对应一张已经绘制好的 PNG。

```text
violet → hair-front-violet.png
silver → hair-front-silver.png
```

`gradient-map`：同一灰度/明度素材通过确定性渐变映射换色。每个色板至少提供 0 和 1 两个端点，Stop 严格递增。

Hair Front、Hair Back 和 Highlight 如需联动，必须绑定同一个 `hair-color` ColorChannel。不得让玩家换色后只改变半边头发。

### 9.2 混色模式

允许使用：

```text
normal, multiply, screen, overlay, darken, lighten,
color-dodge, color-burn, hard-light, soft-light,
difference, exclusion, hue, saturation, color,
luminosity, linear-dodge
```

混色必须在 Creator Studio 真实 Canvas 中验收。Photoshop 的混色结果不一定与浏览器 Canvas 在所有颜色上像素一致；不能只交 PSD 截图。

### 9.3 像素画模式

- Maker 统一选择 `smooth` 或 `pixelated`；
- `pixelated` 使用最近邻观察和输出，不改变源图；
- 像素素材不得混入半透明缩放边缘；
- 玩家不能单独改变某一个 Item 的缩放算法。

---

## 10. 权利、许可和 AI 披露

每个交付包必须包含 `rights.json`：

```json
{
  "creatorLegalNameOrStudio": "",
  "creatorDisplayName": "",
  "contact": "",
  "originalWork": true,
  "thirdPartyAssets": [],
  "licenseKind": "personal-use",
  "licenseNote": "",
  "commercialUseAllowed": false,
  "modificationAllowed": false,
  "aiAssisted": false,
  "aiTools": [],
  "aiProcessNote": "",
  "rightsStatement": "I have the right to publish and license every delivered asset."
}
```

要求：

- 作者保留其依法拥有的版权；
- 必须明确玩家可否商用、修改、二次发布和用于头像；
- 使用第三方笔刷、纹理、字体、模型或素材时列出名称与许可；
- 不得提交无授权的角色、品牌 Logo、游戏素材或同人拆件；
- 使用 AI 辅助时必须说明工具和流程，不得只写“原创”；
- AI 披露不能替代权利保证；
- 发布时许可、AI 声明和素材 Hash 会形成不可变版本快照；
- 更新许可必须创建新的 MakerVersion，不能静默改变旧 OC 的权利状态。

---

## 11. 自动验收

导入后必须通过以下检查：

### 文件和结构

- [ ] 所有 ID 安全、唯一；
- [ ] 所有 manifest 引用都存在；
- [ ] 每张 runtime PNG 是 8-bit non-interlaced RGBA；
- [ ] 每张 runtime PNG 尺寸等于 Canvas；
- [ ] SHA-256 已生成；
- [ ] Required Part 有 Default Item；
- [ ] Item 有 Default Variant；
- [ ] Variant 至少有一个 LayerBinding；
- [ ] LayerBinding 引用有效 LayerTrack 和 Asset；
- [ ] `asset-map` 覆盖 ColorChannel 的全部色板；
- [ ] Parent 不形成循环；
- [ ] visibleWhen/requires/excludes 不引用不存在的对象；
- [ ] ExpansionPack 引用正确的基础 MakerVersion；
- [ ] Default Recipe 可完整解析；
- [ ] 封面 Asset 存在。

### 发布阻断项

以下任一情况出现即拒绝发布：

- 缺文件、错尺寸、非 RGBA 或路径越界；
- Required Part 没有默认选项；
- `None` 在 Preview 与最终 PNG 结果不同；
- ColorChannel 缺少某个 Layer 的颜色素材；
- LayerTrack 或 Rule 引用不存在；
- Creator Preview、Player Preview、封面、最终输出使用不同渲染结果；
- 许可说明、作者声明或 AI 披露缺失；
- 封面无法由真实 Recipe 重现。

---

## 12. 人工组合验收

自动校验通过不代表美术组合通过。必须在真实 Player Editor 中完成：

- [ ] 每个 Base × 每个 Outfit 至少检查一次；
- [ ] 每个 Hair 检查前后层遮挡；
- [ ] 每个 Expression 在所有 Base 上检查位置；
- [ ] 每个脸部 Accessory 与 Hair Front 检查遮挡；
- [ ] 所有 ColorChannel 检查联动；
- [ ] 所有 blendMode 在亮、暗背景上检查；
- [ ] Optional Part 的 None 不加载空白占位素材；
- [ ] Undo/Redo 后画面完全恢复；
- [ ] 连续 100 次 Random 不产生无效组合；
- [ ] Default Recipe、Creator Preview、Player Preview、Cover 和 Final PNG 像素一致；
- [ ] 1024 输出和 UI 缩略图均可辨认；
- [ ] 手机/平板预览不因资源延迟短暂缺脸或缺衣服。

验收结论必须记录：

```text
Maker ID:
MakerVersion:
Canvas:
验收资产 Hash:
画师确认人:
Creator 确认人:
技术验收人:
已知限制:
结论: PASS / REWORK / REJECT
```

---

## 13. 更新和 ExpansionPack

- 已发布 MakerVersion 的图、坐标、LayerTrack 和许可快照不可原地覆盖；
- 修复对齐或替换素材时创建新 MakerVersion；
- 新版本必须标记 `compatible` 或 `breaking`，并填写 changelog；
- 旧 OC 固定引用创建时的 MakerVersion；
- ExpansionPack 可以增加 Part、Item、Variant、LayerTrack 和素材，但不能偷偷替换基础包内容；
- 大型扩展单独存储、按需加载，可以沿用既有经济逻辑；
- 画师交付扩展包时仍需提供独立 mapping、rights 和验收记录。

---

## 14. Angie Astral Courier 压力测试

本仓库提供导入器：

```bash
cd animacraft
node scripts/import-angie-v4.mjs \
  --source ../../angie-soulidity/releases/astral-courier \
  --portable \
  --output /tmp/astral-courier.stress.v4.json \
  --report /tmp/astral-courier.stress.report.json
```

如需把素材复制到本地 Vite 可访问目录：

```bash
node scripts/import-angie-v4.mjs \
  --copy-assets public/stress/astral-courier \
  --asset-base-url /stress/astral-courier \
  --output /tmp/astral-courier.stress.v4.json \
  --report /tmp/astral-courier.stress.report.json
```

导入器不会修改 Angie 源文件，并会：

- 把 v3 Part/Item/Layer×Color 矩阵迁移为 v4 Part/Item/Variant/LayerBinding；
- 计算每张 PNG 的尺寸、Alpha Bounds 和 SHA-256；
- 检查路径越界、缺文件、错尺寸和 PNG 格式；
- 标记透明 `none.png`；
- 标记复杂 Hair/Outfit 的单层复合风险；
- 报告同一 Part 内可见边界中心的可疑漂移；
- 把结果明确标记为 `negative-complex-stress-fixture` 和 `doNotPublish`。

当前 Astral Courier 样本的本地诊断包括：

- 26 个资产都为 1024×1024 RGBA，说明“文件同尺寸”不是充分条件；
- Base 选项的 Alpha Bounds 中心跨度约 `34.5px × 30px`；
- Outfit 约 `41px × 54px`；
- Hair 约 `65.5px × 85px`；
- Hair 和 Outfit 各只有一个复合 Layer，无法独立控制前后遮挡；
- `layers/accessory/none.png` 完全透明；
- 所有 Item 缺少独立缩略图；
- 独立 cover 无法证明来自共享 Renderer 的 Default Recipe。

这些数据用于验证编辑器能否发现和承载复杂问题，不能作为自动位移修复依据，也不能作为画师应模仿的标准素材。
