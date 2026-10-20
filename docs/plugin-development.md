# 扩展基元、连接与静态计算

插件的主要工作是增加**可独立编辑的示意图基元**和**可复用的连接模式**。原有卷积、池化、全连接、拼接等基元与普通分支继续用于自由绘图；张量优先工作区另外使用“源张量 → 操作 → 结果张量”的静态计算结构。不要把一个外形类似卷积层的基元，当成已经具备 Conv3D 推导规则的计算节点，也不要为了增加一种层就锁住整张网络。

这些能力使用同一工程文档与撤销栈。0.2.0通过可选的`PluginDefinition.computations`支持静态计算扩展，插件清单仍为`apiVersion: 1`。扩展只在可信源码中注册、随应用构建；没有社区代码在线安装、插件市场、云服务或第三方代码沙箱。

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

## 新增算子：生成器与计算定义一起注册

实际示例见[LeakyReLU](../examples/plugins/leaky-relu/README.md)。它仅导入公开SDK，在自己的`index.ts`集中声明生成器、计算定义和插件：

```ts
export const leakyReluPlugin: PluginDefinition = {
  manifest: {
    id: 'example.leaky-relu',
    name: 'LeakyReLU 计算示例',
    version: '1.0.0',
    apiVersion: 1,
    dependencies: { builtin: '1.0.0' },
  },
  generators: [leakyReluGenerator],
  computations: [leakyReluComputation],
};
```

将插件加入`src/builtins/registry.ts`的注册数组即可接入宿主。示例已注册；新增类似算子无需修改工程编解码、画布核心或为它新增工作区分支。当前注册表每个生成器ID只注册一个明确版本，不是多版本规则动态装载器。

`GeneratorDefinition`负责参数字段、默认值和可编辑图元。生成的节点声明`semantic.role`，并提供计算定义实际使用的端口。`ComputationDefinition`负责：

| 字段                                                   | 职责                                                   |
| ------------------------------------------------------ | ------------------------------------------------------ |
| `generatorId`、`version`、`paramSchemaVersion`、`role` | 精确匹配工程绑定；角色为源、操作或结果                 |
| `dimension(params)`                                    | 声明2D、3D或尚无维度；不读取显示大小                   |
| `inputs(params)`、`outputPort`                         | 稳定输入端口与上游角色，以及输出端口身份               |
| `validateParameters?(params)`                          | 可选前置诊断；返回null继续，返回报告则停止本步推导     |
| `infer(params, shapes)`                                | 同步纯规则，返回状态、输出形状、参数量、公式与诊断     |
| `operation`                                            | 菜单名称/提示、输入数量与维数、参数准备、结果生成器    |
| `presentation`                                         | 可选字形、标签/详情与字段分组/维度筛选，供通用界面投影 |

源的输入为空；操作输入张量；结果接收一个操作输出。端口ID由定义声明，输出无需依赖固定`out`命名。可选`kind`保留内置调用别名；新扩展直接使用`generatorId`，别名不得歧义。输出结果生成器也须注册对应维数的`tensor-result`计算定义。

注册器拒绝重复定义、生成器/参数版本不符、非法角色、端口和结果生成器。参数字段的权威类型在`core/generation/types.ts`，通用字段验证在`parameters.ts`，SDK和`plugins/registry.ts`保留兼容重导出；插件本身只从SDK取得合同。

## 从定义到参数编辑与诊断

命令带与张量旁的“＋”通过`listAvailableOperations(doc, sourceIds, registry.computations)`发现操作；输入数量、维数与精确绑定版本决定可用性。参数面板使用生成器字段，计算定义的`presentation`控制通用分组。无需为单个算子复制菜单、表单或诊断组件。

`appendTensorOperation(store, registry, sourceIds, generatorId, params?)`按定义的`prepareParams`、输入/输出端口和`resultGeneratorId`，一次创建操作、结果与数据流边；一次撤销对应整次创建。参数回改经编辑动作进入原有生成事务，保留稳定ID与手工表现。

宿主显式调用：

```ts
analyzeDocument(doc, registry.computations);
tensorDimension(entity, registry.computations);
tensorKind(entity, registry.computations);
```

画布和`exportSvg`/`exportPng`也接收同一计算注册表。核心默认注册表为空；省略或传入空表时，语义对象为`unsupported`，不会暗中注册内置规则。规则必须同时匹配生成器ID、版本、参数格式和角色；相同ID的其他版本也不套用当前规则。未知规则向下游传播为不可用，图元快照仍可编辑和导出。

`RuleResult`包含`ready`、`pending`、`error`或`unsupported`状态，以及解释、步骤、诊断和可用时的shape/parameterCount。2D形状为N/H/W/C，3D为N/D/H/W/C；结果块不持久化第二份可手填输出规格。通用传播层检查端口、输入角色、回路、秩和上游状态；规则收到参数与形状的分离副本，异常或无效就绪结果变为诊断。缺参数返回`pending`，非法参数或轴冲突返回`error`，不要猜测输出。

内置Conv、MaxPool、ReLU、最近邻Upsample、Concat和严格Add使用同一注册合同。具体定义在`builtins/computations.ts`，公式在`builtins/computation-rules.ts`；通用传播层没有按这些名字分派的算子特例。普通`PrimitiveDefinition`仍只提供绘图能力，不会自动获得计算权限。

## 图稿元素复用文档事务

v3的计算对象与图稿对象分别拥有身份，`figure.semanticRef`把表示关联到计算对象。多表示、独立注解与绘图组使用普通实体、`put`/`remove`等原有操作，因此共用校验、保存、撤销和导出，不需给存储或画布各建一套对象表。

`core/figure/index.ts`提供`planAddFigureRepresentation`、`planAddFigureAnnotation`、`planUpdateFigureAnnotation`、`planSetFigureView`与`planGroupFigure`。规划返回普通事务内容，由宿主以当前修订提交。手工文本和自动注解分开保存；自动注解只记录来源与字段，显示时读取最新分析。概括/详图关联与绘图成组目前提供数据和核心API，没有完整产品界面，也不等同于计算模块封装。

图稿显示几何由`graphics/figure-appearance.ts`处理，不作为计算规则参数；应用通过完整编辑动作接入面板。新增图稿类型可先沿用受限图元或已有figure角色；需要新持久化字段时，必须同步明确格式合同与兼容策略，不能任意写入未声明字段。新图稿元素没有赋予插件任意修改宿主的权限。

v1/v2继续读取编辑，新建默认v2；使用独立标注或新增图稿表示时，应用先确认创建v3副本。迁移保留旧工程、稳定计算ID、样式、路径、隐藏与手工布局。字段和迁移规则见[工程格式](project-format.md)。

## 兼容入口仍可使用

`PluginDefinition.generators` 保留旧组合生成入口，`commands` 保留选择集编辑命令。`examples/plugins/residual/` 验证这两种兼容能力：残差组合与等距排布，不是新版生成工作区的主入口。

生成片段更新时，宿主保留稳定 ID、手工位置、标签、节点样式覆盖及手工路径。连线只保留 `styleOverrides` 中明确手改的字段，其他样式采用新生成值；旧工程中仅有 `style` 的边仍可读取，但不会被臆断为“所有字段均手改”。移除手工编辑过的内容需要确认。

旧组合的独立实例在 `generation.source.kind = 'local'` 保存参数；受父生成器管理的子层使用 `kind = 'slot'`，记录 `ownerId`、`slotKey` 和继承字段。有效子参数依次由基础默认值、指定父字段和父参数的 `__slots[slotKey]` 覆盖组成。子层只把实际变化写入覆盖；只改平面／立体不会冻结继承的通道数。解除旧组合关联时，子层转存当前有效参数，并保留各自的参数能力。

新建普通基元之间的拓扑可直接增删连接，不需要解除关联。旧托管组合内部的自由编辑仍应先解除组合生成关联，或从组合公开端口连接。

`CanvasCommand.run(readonlySnapshot, selection, params)` 返回带 `baseRevision` 的 `EditProposal`。当前命令权限为 `move`、`label`、`fill`、`edgeStyle`；`executePluginCommand` 只接受作用于选择集内实体的已声明操作。新增的宿主 `nodeStyle` 操作不自动授予旧命令插件。不要直接改文档、访问画布内部或另建撤销历史。

## 验证插件的实际使用

计算扩展另验证：注册发现、参数编辑、已知输出、缺失/非法参数、规则版本不符、空注册表、上下游传播及创建撤销；参见`tests/unit/computation-extensions.test.ts`与`tests/e2e/architecture-foundation.spec.ts`。

图稿扩展验证：独立身份、保存重开、撤销、导出与手工表现；参见`tests/unit/figure-v3.test.ts`。

基元至少验证：参数更新后 ID／端口稳定；手工覆盖保留；非法参数与移除已连接端口被拒绝；连接模式不越出选择集，重复连接不部分提交；一次应用对应一次撤销。再在真实浏览器完成添加、连接、参数回改、保存重开、SVG／PNG 导出。

工程修订已变化、只读、生成超时、生成器缺失或版本不符时，旧异步结果不能覆盖新状态。生成超时只使结果失效；构建期可信代码仍在同一线程执行，不能用它隔离任意第三方代码。计算扩展同样是可信构建期同步代码，不是运行时安全沙箱；没有真实模型执行、训练、真实三维相机或任意代码在线安装能力。
