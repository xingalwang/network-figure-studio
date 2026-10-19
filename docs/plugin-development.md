# 扩展网络基元与连接方式

插件的主要工作是增加**可独立编辑的示意图基元**和**可复用的连接模式**。原有卷积、池化、全连接、拼接等基元与普通分支继续用于自由绘图；张量优先工作区另外使用“源张量 → 操作 → 结果张量”的静态计算结构。不要把一个外形类似卷积层的基元，当成已经具备 Conv3D 推导规则的计算节点，也不要为了增加一种层就锁住整张网络。

两类扩展都使用宿主的工程文档与撤销栈。当前插件随应用源码构建，适合共同开发和分享代码；没有社区代码在线安装、插件市场或第三方代码沙箱。

## 从 Attention 示例开始

`examples/plugins/attention/` 仅导入 `src/plugins/sdk.ts` 的公开接口，提供：

- `example.attention-gate`：带 `in`、`gate`、`out` 端口的注意力门基元，可修改通道数、头数、尺寸、2D／立体表现和颜色。
- `example.parallel-branches`：依次选择入口、支路一、支路二、合并节点，一次创建四条普通连线，不改变节点位置。

`index.ts` 将两者声明在 `PluginDefinition.primitives` 和 `connectionPatterns` 中。该示例已加入 `src/builtins/registry.ts` 的 `createBuiltinRegistry()`。

新插件也采用这个结构，再把插件定义加入同一注册数组，重新构建后生效。清单使用唯一 `id`、语义版本和 `apiVersion: 1`。依赖声明使用固定版本；注册器拒绝缺依赖、版本不符、依赖循环和重复入口 ID。

## 基元返回图形与稳定端口

`PrimitiveDefinition` 继承参数生成能力，并增加必需的 `category`、可选的 `icon`、`keywords`。参数字段支持数字、文本、开关、枚举、六位十六进制颜色和列表；结构与外观字段分别使用 `section: 'structure' | 'appearance'`。数字字段可选 `nullable: true`，允许 JSON `null` 表示待配置；未声明的数字字段仍拒绝 null，空字符串也不是合法数值。通用绘图基元是否以及如何显示未配置值，由该基元定义；宿主不会替它猜测计算结果。

```ts
export const attentionPlugin: PluginDefinition = {
  manifest,
  primitives: [attentionGatePrimitive],
  connectionPatterns: [parallelBranchesPattern],
};
```

基元会同时注册到 `registry.primitives` 与 `registry.generators`：前者供基元库发现，后者负责生成绑定和参数回改。**同一基元不要再放入 `generators` 数组**，否则 ID 重复。

`generate(params, theme, previousLocalKeys?)` 返回 `GraphFragment`，也可异步。片段包含 `rootKey` 与按稳定局部键索引的 `entities`。每个实体的 `id` 必须等于局部键，内部引用也使用这些键；宿主负责转换为工程 ID。根必须是节点或组，不能是连线。一个普通网络基元通常返回单个根节点，端口坐标相对节点前脸原点。

稳定键代表语义位置，不要用会随重排变化的数组序号冒充它。端口名同样应保持稳定，例如 `in`、`in2`、`out`、`gate`。减少输入数量而移除仍被使用的端口时，宿主会拒绝回改，要求用户先调整外部连接。

### 复用矢量几何，而不是访问画布

SDK 导出 `buildBlockGeometry`、`createLayerNode` 和 `layerGenerators`。前者接收尺寸、立体表现，以及可选 `fill`、`stroke`、`textColor`、`strokeWidth`、`opacity`、`label`、`shape`。线宽可为零，透明度为 0—1。立体也是矢量图元，深度、叠层偏移和投影角度决定完整边界，前脸原点及端口不会因此移动。

插件也可直接返回矩形、椭圆、多边形、纯文本或引用工程内嵌图片的受限图元，不返回 HTML、脚本或 maxGraph 对象。图元的 `opacity` 可选，几何面的 `strokeWidth` 可选。生成函数需要自行使用主题或显式颜色参数。

新增基元时，宿主会把图稿主题填入约定的 `fillColor`、`borderColor`、`textColor`、`strokeWidth` 参数（仅当基元声明了对应默认参数）。自定义命名的参数不会自动获得这种映射。已有实例继续以已保存参数和手工覆盖为准。

## 连接模式只描述要连接什么

`ConnectionPatternDefinition` 声明 ID、版本、字段、默认值，以及：

```ts
isAvailable(doc, selection): boolean
connect(doc, selection, params): ConnectionSpec[] | Promise<ConnectionSpec[]>
```

选择顺序有意义。`ConnectionSpec` 的端点必须引用**本次选择集中的实体和现有端口**；不接受自由坐标端点，也不能偷偷连接未选择的节点。它可以提供标签、部分连线样式，以及可选路径：

```ts
{
  source: { entityId: entryId, portId: 'out' },
  target: { entityId: branchId, portId: 'in' },
  route: {
    kind: 'orthogonal',
    points: [{ x: 320, y: 140 }], // 工程世界坐标，不是某个组的局部坐标
  },
  style: { color: '#5a8390', width: 1.5, opacity: 0.8 },
}
```

由 `executeConnectionPattern` 调用并提交。宿主检查只读状态、参数、选择范围、重复选择、锁定对象、端口存在性，以及已有或本批次中重复的同向端口连接。宿主分配 ID，把结果转成 `parentId: null`、`route.spaceId: null` 的普通 `edge`，一次事务应用，任一失败均不部分创建。非空控制点形成手工路径，空控制点保留自动路径；未提供样式时使用图稿默认线色和线宽。

结果没有隐藏的“并行关系对象”，也没有持续接管网络的生成关联。创建后，每条线都可以单独改端点、路径、颜色、标签和删除，一次撤销可撤掉整次连接。插件没有通过此接口移动节点、修改参数、添加基元或修改选择范围外内容的权限；布局应交给用户的显式整理操作或相应画布命令。

普通示意图分支无需插件，核心已有串联、分支、合并连线模式；这些模式只画连接，不检查张量形状。示例“双路并行”封装了选择顺序与端口规则。需要静态推导拼接或逐元素相加时，张量工作区必须建立对应的 Concat／Add 操作与结果块，不能用几条汇合线替代计算关系。

## 张量计算是宿主内置能力，不是现有插件的隐式权限

当前 `PluginDefinition` 没有计算规则注册字段。分析器 `src/core/computation/index.ts` 是导出门面，规则目录、纯计算和依赖传播分开。0.1内置2D／3D源与结果、Conv2D／3D、MaxPool2D／3D、ReLU、最近邻Upsample、Concat和Add；任意自定义算子的规则插件接口尚未开放，增加普通 `PrimitiveDefinition` 不会自动获得这些能力。已知 ID 也必须匹配生成器版本 `1.0.0` 与参数格式版本 `1`，其他版本输出 `unsupported`；下游同步标记规则不可用，不伪造尺寸。

内置计算对象仍使用普通 `NodeEntity`／`EdgeEntity`，没有另一份计算图。v2 的 `NodeEntity.semantic.role` 区分 `tensor-source`、`operation`、`tensor-result`；`EdgeEntity.meaning: 'dataflow'` 才参与推导。普通插件连接没有这个字段，继续是示意线。不要借用内置生成器 ID 为自定义规则伪装计算语义。

源张量按2D声明 `N/H/W/C` 或按3D声明 `N/D/H/W/C`，2D没有D键；结果块只保存外观，真实输出由输入与操作参数派生。Conv3D 的 dilation／groups 固定 1；ReLU不改形状；最近邻Upsample使用各空间轴正整数倍率；Concat沿实际存在的N/D/H/W/C并检查其他维度及秩；Add 要求完整形状一致，不广播。`analyzeDocument(doc)` 返回只读派生报告（状态、形状、输入、参数量、公式、解释、诊断），不修改文档，不持久化第二份输出规格，也不进入撤销栈。缺信息与错误不会阻止原有自由绘图、保存和导出。

宿主的创建入口位于 `src/core/tensor-composition.ts`，并非 `sdk.ts` 已授予第三方插件的新权限：

```ts
addTensorSource(store, registry, position?, dimension = 3)
// Promise<Result<string>>：新源块 ID，规格最初待配置。

appendTensorOperation(store, registry, sourceIds, kind, params?)
// kind: 'conv2d' | 'pool2d' | 'conv3d' | 'pool3d' | 'relu' | 'upsample' | 'concat' | 'add'
// Promise<Result<{ operationId, resultId }>>：操作、结果和数据流边一次创建、一次撤销。

planPlaceTensorFigure(doc)
planHideTensorFigure(doc, ids)
planRestoreTensorFigure(doc, ids)
// ResolvedOperation[]：由宿主校验当前修订后提交。

planRemoveFromFigure(doc, ids)
// Result<ResolvedOperation[]>：混选时保留计算；普通内容沿用原删除规划。
```

单输入操作选一个数据块；合并选 2—8 个不同数据块。新增内容先处于 `figureState: 'unplaced'`，生成位置保存在 `presentation.compositionPosition`。首次加入图稿初始化 `presentation.position`；更新只加入新内容，不重排已加入或隐藏对象。隐藏仅改变显式对象的图稿状态，关联线按端点有效可见性绘制；恢复保留原位置、样式和手工路径，不自动恢复单独藏过的边。绘图删除统一使用 `planRemoveFromFigure`，不能因混选普通图元就物理删除张量或数据流；关联父空间和端点也须保留，锁定或引用冲突整笔拒绝。

`tensorDimension(entity)`返回内置对象的空间维数（无维度声明时null），供宿主匹配操作；这不是绘图外观。`producerOf(doc, tensorId)`用于从结果块找到产生操作，`tensorKind(entity)` 区分当前内置对象。`migrateProjectV2(doc)` 在 `src/core/document/codec.ts` 显式建立新 ID 的计算副本：v1 原实体和参数不改义，旧边标记为 `annotation`；生命周期切换、锁与保存仍由宿主管理。格式细节见同目录 `project-format.md`。

## 兼容入口仍可使用

`PluginDefinition.generators` 保留旧组合生成入口，`commands` 保留选择集编辑命令。`examples/plugins/residual/` 验证这两种兼容能力：残差组合与等距排布，不是新版生成工作区的主入口。

生成片段更新时，宿主保留稳定 ID、手工位置、标签、节点样式覆盖及手工路径。连线只保留 `styleOverrides` 中明确手改的字段，其他样式采用新生成值；旧工程中仅有 `style` 的边仍可读取，但不会被臆断为“所有字段均手改”。移除手工编辑过的内容需要确认。

旧组合的独立实例在 `generation.source.kind = 'local'` 保存参数；受父生成器管理的子层使用 `kind = 'slot'`，记录 `ownerId`、`slotKey` 和继承字段。有效子参数依次由基础默认值、指定父字段和父参数的 `__slots[slotKey]` 覆盖组成。子层只把实际变化写入覆盖；只改平面／立体不会冻结继承的通道数。解除旧组合关联时，子层转存当前有效参数，并保留各自的参数能力。

新建普通基元之间的拓扑可直接增删连接，不需要解除关联。旧托管组合内部的自由编辑仍应先解除组合生成关联，或从组合公开端口连接。

`CanvasCommand.run(readonlySnapshot, selection, params)` 返回带 `baseRevision` 的 `EditProposal`。当前命令权限为 `move`、`label`、`fill`、`edgeStyle`；`executePluginCommand` 只接受作用于选择集内实体的已声明操作。新增的宿主 `nodeStyle` 操作不自动授予旧命令插件。不要直接改文档、访问画布内部或另建撤销历史。

## 验证插件的实际使用

至少验证：基元参数更新后 ID／端口稳定；手工覆盖保留；非法参数与移除已连接端口被拒绝；连接模式不越出选择集，重复连接不部分提交；一次应用对应一次撤销。再在真实浏览器完成添加、连接、参数回改、保存重开、SVG／PNG 导出。

工程修订已变化、只读、生成超时、生成器缺失或版本不符时，旧异步结果不能覆盖新状态。生成超时只使结果失效；构建期可信代码仍在同一线程执行，不能用它隔离任意第三方代码。当前具备上述内置算子的静态形状分析；没有模型执行、训练、真实三维相机、通用计算规则插件或任意代码在线安装能力。
