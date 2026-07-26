# Animacraft Maker v5 创作者与画师素材规范

本文是社区 Maker 创作者、画师和 Animacraft 编辑器实现共同遵循的唯一 v5 规范。

## 1. 最终层级

```text
Maker（模板）
└── Part（部位 / 玩家菜单分类，例如“头发”）
    └── Item（部件 / 玩家一次点击的选项，例如“黑色长发”）
        └── Style（样式 / 该部件的一种外观，例如“黑色挑蓝”）
            └── 唯一 PNG 及其全部显示参数
```

Style 已经是最小的可渲染单位。Style 下方没有 Layer、LayerBinding 或 Empty LayerBinding。

每个 Style 直接拥有：

- 一张透明 PNG；
- 一个全局 Layer Track；
- `x / y / scale / rotation`；
- 不透明度与混合模式；
- 位置确认、位置锁定和完整 Style 锁定；
- 可选的 Color Channel；
- `requires / excludes / visibleWhen` 条件。

Item 永远保留 `Styles` 列表和 `+ Style`。不设置“是否开启 Style”的开关。玩家选择 Item 后，若该 Item 有多个 Style，再选择其中一个 Style。

## 2. Part、Item、Style 的职责

### Part：玩家菜单分类

Part 回答“玩家现在在捏哪个部位”。例如：

- 后发；
- 皮肤与身体；
- 服装；
- 眼睛；
- 前发；
- 配饰。

Part 不是图片，也不是共享坐标容器。切换当前编辑 Part 不应隐藏其他已启用 Part；画布应持续显示完整角色。

### Item：玩家的一次选择

Item 回答“玩家点击了哪个部件”。同一 Part 通常同时只选择一个 Item。例如：

- Part：前发；
- Item：齐刘海、侧分刘海、无刘海。

Item 自己不保存 PNG 和坐标。它负责名称、缩略图、顺序、公开状态、默认 Style 和组合条件。

### Style：唯一可渲染 PNG

Style 回答“这个 Item 用哪一种具体外观绘制”。例如：

- Item：黑色长发；
- Style：纯黑、蓝色挑染、紫色挑染。

每个 Style 只对应一张 PNG。选择、移动、缩放、变色或锁定一个 Style，不得改变同一 Item 或其他 Part 中的任何 Style。

## 3. 多层遮挡如何处理

一个 Style 不再同时控制前发、后发、高光等多张图片。

如果一个造型需要跨越身体前后，必须按遮挡职责拆成多个 Part，例如：

```text
Back Hair Part  → 后发 PNG → body 下方的 Track
Front Hair Part → 前发 PNG → face 上方的 Track
```

可使用 `requires / excludes` 让对应的前发与后发保持合理组合。不要把多张同时显示的 PNG 塞回一个 Style。

这种拆分让玩家的选择与每张图片的坐标都可预测，也避免复制或调整一层时整组素材一起移动。

## 4. 统一坐标系

- Maker Canvas 是唯一坐标系。
- 原点 `(0, 0)` 位于画布左上角。
- `x` 向右增加，`y` 向下增加。
- `scale = 1` 表示 PNG 原始尺寸。
- `rotation = 0` 表示不旋转。
- Style 的 `x / y` 表示 PNG 在 Maker Canvas 中绘制时的左上角位置。
- 负数坐标合法：它表示 PNG 的一部分位于画布之外。编辑器必须继续显示边界和数值，不能把负数自动改成零。

Layer Track 只负责全局 z-order，不保存或继承坐标。切换 Track 不应改变 Style 的位置。

## 5. PNG 导入行为

### 全画布 PNG

当 PNG 尺寸与 Maker Canvas 完全一致时：

```text
x = 0
y = 0
scale = 1
```

### 裁切 PNG

当 PNG 小于画布或包含不对称透明留白时，编辑器读取非透明像素边界，并把“可见内容”自动居中到画布。源 PNG 不被裁切或改写。

导入后创作者应：

1. 在完整角色预览中确认位置；
2. 必要时拖动或等比缩放；
3. 点击“确认位置”；
4. 锁定位置，防止误触。

自动生成的缩略图可以裁透明边，但运行时源 PNG 必须保持原样。创作者也可以上传独立缩略图。

## 6. 锁定语义

- **位置锁定**：禁止画布拖动、缩放、旋转及坐标输入修改；仍可修改名称、颜色和规则。
- **Style 锁定**：禁止修改该 Style 的 PNG、Track、坐标、颜色、混合模式和规则。
- **Track 锁定**：禁止调整该 Track 的全局排序；它不锁定或改变任何 Style 坐标。

锁定必须真实阻止写入，而不只是显示一个图标。

## 7. 复制与独立性

复制 Part、Item 或 Style 时：

- 深拷贝全部语义参数；
- 为复制体及其所有子对象生成新 ID；
- 重写复制体内部的默认引用与自身条件引用；
- 保留对外部 Part 的规则引用；
- 不共享 JavaScript 对象、选中状态或 UI 缓存键。

因此，复制后只替换 PNG 就可以得到一个位置和规则完全相同的新 Style；随后移动复制体不会影响原件。

## 8. 颜色

Style 可不使用 Color Channel，也可使用 **Gradient Map**：同一张 PNG 根据色板映射颜色。

不支持在一个 Style 内按色板切换多张 PNG。需要另一张手绘 PNG 的颜色或花纹时，必须新建 Style。

Color Channel 可以被多个 Style 共用，以实现头发前后层联动变色。编辑器预览、玩家试玩和最终导出必须使用同一 Renderer，保证颜色结果一致。

不需要变色的 Style 应将 Color Channel 留空，不得默认继承上一个 Style 的颜色设置。

## 9. 批量导入建议

推荐目录：

```text
part-id/
  item-id/
    style-id.png
```

示例：

```text
front-hair/
  long-hair/
    pure-black.png
    blue-streak.png
```

批量导入必须先显示映射确认表。每一行至少确认：

- Part；
- Item；
- Style；
- Layer Track；
- 文件名。

未映射、重复映射或引用不存在对象的行不得静默导入。

## 10. 画师交付要求

画师开始批量绘制前，应先提交一个“小型垂直样例”：

- 1 个身体或皮肤；
- 1 套服装；
- 1 组前发与后发；
- 1 个表情；
- 1 个前景配饰；
- 1 个背景；
- 至少两个 Style 或颜色。

验收通过后再扩充全部素材。每个文件应满足：

- PNG，透明背景；
- 清晰标注所属 Part、Item、Style；
- 使用同一 Maker Canvas 和角色基准；
- 不在不同素材中改变角色整体比例或镜头；
- 不把预览背景烘焙进身体、服装或头发 PNG；
- 没有无意义的全透明占位 PNG；
- 人工确认极端组合仍能构成完整角色。

如需要前后遮挡，应在交付清单中明确拆分为不同 Part，而不是交付一张无法正确排序的合成图。

## 11. Angie 素材的定位

Angie / Astral Courier 素材可以用于复杂度压力测试，但不是视觉金标准：

- 它是 AI 辅助生成素材；
- 多个 Item 的可见边界、身体比例和中心可能不一致；
- 部分图层是扁平合成图，无法仅靠元数据修复内部遮挡；
- 没有原始 PSD/PSB 时，编辑器只能诊断，不能推断画师意图。

因此：

- 用 Angie 验证导入、拖动、缩放、排序、锁定、缩略图和组合压力；
- 不用它证明所有组合在美术上合格；
- 邀请真人画师前，按本规范制作并验收垂直样例。

## 12. 玩家端与发布边界

玩家端只提供：

- 点击 Part；
- 点击 Item；
- 在 Item 下选择 Style；
- 选择允许的颜色；
- Random、Undo/Redo、本地保存和导出。

玩家不能移动 Maker 素材。创作者确定的位置就是模板规则。

Creator Studio 可在连接钱包后进入。所有本地编辑、试玩和保存都先作用于草稿；只有最终发布时，才把同一个 v5 Maker manifest、素材与版本信息接入 Walrus 和 Sui。发布前必须通过：

- v5 数据结构校验；
- 每个公开 Item 至少有一个有效 Style；
- 默认 Item / Style 与默认 Recipe 完整；
- 所有 Style 都引用有效 PNG 和 Track；
- 已确认位置；
- Renderer 可完整生成默认 OC；
- Walrus 文件映射和 Sui 摘要投影一致。
