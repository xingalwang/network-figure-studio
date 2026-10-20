# `.nnfig.json` 工程格式：v1/v2兼容与v3独立图稿

工程保存可编辑图元、参数声明和连接关系，不读取真实模型。v1为自由示意图；v2增加张量语义和两套布局；v3让计算对象与图稿表示分别拥有身份。应用版本0.2.0、工程schemaVersion和插件apiVersion独立管理。计算诊断不阻止保存导出，也不把旧尺寸标注重新解释成真实规格。

## 旧工程不原地升级

`decodeProject`接受`schemaVersion: 1 | 2 | 3`，按版本严格检查字段；v1/v2继续直接读取、编辑和保存，不自动迁移。v1 不允许 `semantic`、`compositionPosition`、`figureState`、`meaning` 这些新增计算字段。`createProject(title)` 的既有默认仍为 v1；新应用显式使用 `createProject(title, 2)`。

在 v1 工程首次添加张量时，应用调用 `migrateProjectV2(doc)` 建立计算副本，再通过项目生命周期切换。迁移是纯复制：新项目 ID、修订从 0 开始，标题、原实体 ID、图元、参数和排版保持不变；原来没有 `meaning` 的边标为 `annotation`。原工程和原文件不被副本覆盖；迁移函数本身不写文件、不替换当前项目，也不推测旧标注的计算含义。

使用独立标注或新增图稿表示时，应用先确认，再调用`migrateProjectV3(doc)`建立新ID、revision为0的v3副本，通过生命周期切换；取消确认不会添加元素或替换工程。迁移保留计算ID与参数，将既有图稿拆为独立表示并重接图稿端点，保留节点几何、样式、布局、隐藏状态、手工路线和未接完整的连线快照；未加入图稿的结构继续保持未放入。原工程与原文件保留，不做静默原地升级。

读写入口为`src/core/document/codec.ts`，格式校验在同目录`validate.ts`。未知schema、重复JSON属性、非法字段或悬空引用整份拒绝，不部分覆盖当前工程。原有三个v1/v2样例继续保留；新增[v3图稿样例](../examples/projects/figure-views-demo.nnfig.json)演示多表示和注解。

## 一份文档保存身份、参数与两种布局

顶层字段为 `schemaVersion`、`id`、`title`、`revision`、`entities`、`assets`、`dependencies`、`theme`、`page`。`entities` 是稳定 ID 到实体的映射；工作区之间传递可编辑对象，不传图片，也不维护第二份计算图。

实体分节点 `node`、组 `group`、连线 `edge`。`parentId: null` 表示世界空间，否则位置相对指定的父组。连线端点可引用稳定端口，或使用带 `spaceId` 的自由坐标；`route.spaceId` 与连线 `parentId` 一致。组端口可以映射到子实体端口。

节点保存尺寸、完整绘制边界、图元与端口。图元支持矩形、椭圆、多边形、纯文本，以及引用工程内嵌 PNG／JPEG 的图片；不允许 HTML、脚本或外部资源 URL。`assets` 使用带 MIME 的 data URL 携带图片。组本身不是实际绘制面。

v2 节点／组的 `presentation.compositionPosition` 是生成布局，`presentation.position` 是图稿排版。生成侧移动使用 `compositionMove`，只改前者；绘图侧的 `move` 只改后者并记录 `moved`。真实规格与两套坐标都无关。显示宽高、视觉厚度、投影角度也不参与尺寸推导。

## v2 的三个计算角色

节点可带 `semantic: { role }`，角色为：

- `tensor-source`：源数据块；真实声明在 `generation.source.params`，2D 使用 `N/H/W/C`，3D 使用 `N/D/H/W/C`，批量与通道分别设置。
- `operation`：计算作用区；保存卷积核、步幅、填充、输出通道等操作参数，不独立声明输出形状。
- `tensor-result`：结果数据块；真实形状来自产生它的操作，参数只保存外观，不另存可手填的输出 D/H/W/C。

  0.1 内置 ID 为 `tensor.source2d/result2d/conv2d/pool2d`、原有 `tensor.source3d/result3d/conv3d/pool3d`，以及 `tensor.relu`、`tensor.upsample`、`tensor.concat`、`tensor.add`（每项都使用 `tensor.` 前缀）。2D 输出没有 D 键，不以 D=1 冒充2D。ReLU／Upsample 的 dimension 来自创建时的输入；最近邻上采样以 scaleH／scaleW 及3D的 scaleD 保存逐轴倍率，结果无可手填规格。计算顺序是“张量 → 操作 → 结果张量”；操作作为小作用区绘制，不要求成为同等大小的运算方框。一个张量的 `out` 可流向多路；操作输入使用 `in`、`in2` 等，输出使用 `out`，结果张量的 `in` 接收产生操作。

v2 连线的可选 `meaning` 为 `dataflow` 或 `annotation`。只有显式 `dataflow` 参与静态分析；`annotation` 和未声明含义的边都是自由示意连接。画几条汇合线不会自动获得 Concat 或 Add 的计算语义。

`ParamField` 的数字字段可声明 `nullable: true`：此时 JSON `null` 表示待配置，不是 0、空字符串或默认猜测。没有该声明的旧数字字段仍拒绝 null。源的 D/H/W/C 允许正整数或 null，N 声明为正整数；缺失的计算参数产生待配置诊断，非法参数或不兼容的维度产生错误诊断。工程结构、端口引用和有限数值仍须通过格式校验。

## 分析报告是派生结果，不保存第二真源

`src/core/computation/index.ts`的`analyzeDocument(doc, computations)`是纯分析，返回`nodes[id]`。调用方显式传入`registry.computations`；默认空注册表将语义对象标为`unsupported`。每项包含 `state`（`ready`／`pending`／`error`／`unsupported`）、可用时的 `shape`、输入、参数量、公式代入步骤、解释和诊断。形状按实际存在的独立轴表示：2D为 `N/H/W/C`，3D为 `N/D/H/W/C`；错误不会沿用上一次成功输出。报告不写回工程、不进入撤销历史，修改上游后重新分析。

当前规则覆盖 Conv2D／3D、MaxPool2D／3D、ReLU、最近邻Upsample、Concat 与逐元素 Add：卷积 dilation／groups 固定为 1；Same 使用向上取整并解释实际补边，Valid 使用无填充公式；ReLU不改形状，最近邻Upsample的各空间轴倍率为正整数；Concat可沿实际存在的N/D/H/W/C轴，要求其余维度一致，混秩不可直接合并；Add 要求完整形状一致，不做隐式广播。缺少输入、未配置、冲突、循环分别诊断。源张量只提供输出，任何入站数据流（包括自环或接回 out）都会报错，并使下游停止派生；标注线不受这项计算规则限制。内置规则绑定生成器`version: '1.0.0'`、`paramSchemaVersion: 1`；可信构建期扩展通过`PluginDefinition.computations`注册自己的定义与版本。分析按生成器ID、版本、参数格式和角色精确匹配；其他版本为`unsupported`并向下游传播，不拿当前规则猜算。报告与规则函数不写入工程；文件只保存声明和已有绘图快照。

旧网络基元与其尺寸标注仍是自由示意图，不因外形相似就自动加入此分析。图元快照、手工样式和自由排版继续可用；推导不成功不等于工程文件损坏。

## 加入、更新、隐藏图稿分别处理

v2 实体的 `figureState` 可为 `unplaced`、`visible`、`hidden`。旧对象省略此字段时沿用原有可见行为。

`planPlaceTensorFigure(doc)` 只将未加入的内容设为 `visible`，首次用生成坐标初始化图稿位置；已有 `visible`、`hidden` 对象的位置、尺寸、配色、标签和手工路径不被重新排布。参数变化仍通过同一对象身份更新计算和自动规格。

`planHideTensorFigure(doc, ids)` 只隐藏显式选择的图稿对象，不删除计算结构，不连带修改关联边的状态。不可见端点使相关线在图稿中不绘制。`planRestoreTensorFigure(doc, ids)` 只恢复选中的 `hidden` 对象并保留表现，不把 `unplaced` 当成待恢复内容；单独隐藏过的边不会因为恢复节点而自动出现。再次“更新图稿”也不会补回隐藏对象。

上述加入／隐藏／恢复规划返回 `ResolvedOperation[]`。绘图删除统一使用 `planRemoveFromFigure(doc, ids)`，返回 `Result<ResolvedOperation[]>`：混选时隐藏计算及已跟踪图稿成员，普通对象沿用原删除闭包；受保护对象的父空间和连线端点也不能因关联删除而消失。锁定或残余计算引用冲突会拒绝整笔，不部分删除。宿主按当前修订一次提交，使用同一撤销栈。

## v3独立表示、注解与分组

v3继续使用同一`entities`映射和事务。计算节点保留`semantic`与`generation`，计算边仍以`meaning: 'dataflow'`参与分析；图稿对象用独立ID，不能同时带计算语义、生成绑定或dataflow含义。

`figure`包含：

| 字段                | 含义                                                                           |
| ------------------- | ------------------------------------------------------------------------------ |
| `role`              | `representation`表示计算对象，`annotation`独立注解，`decoration`图稿装饰       |
| `semanticRef?`      | 表示所关联的稳定计算ID；representation必需。节点对应计算节点，边对应dataflow边 |
| `view?`             | `summary`或`detail`，描述表示用途，不改变计算拓扑                              |
| `relatedFigureId?`  | 指向同一计算对象的另一表示，不能自引或形成循环                                 |
| `tensorProjection?` | `{ depth, angleDeg }`，仅图稿表示节点可保存的视觉投影参数                      |

一份计算对象可以拥有多个representation，各自保存位置、`size`、图元快照、端口、颜色覆盖与隐藏状态。节点`size.width/height`是显示宽高的权威值；带`tensorProjection`时，depth为0–200、angleDeg为0–80，均不参与计算。应用的显示编辑还限制宽高为24–1000，并一次同步图元、边界和同比端口；它不改计算源或其他表示。

独立标注是`figure.role: 'annotation'`的普通节点，`annotation`区分来源：

```ts
{ kind: 'manual', text: '编码器说明' }
{ kind: 'derived', semanticRef: tensorId, field: 'shape' }
// field也可为'name'或'parameters'
```

手工标注直接保存文本；派生标注只保存来源与字段，投影时读取最新名称、参数或分析形状，不保存第二份自动文本。来源必须存在且为计算节点。示例中的自动维度标注不会覆盖手工说明。

组可带`groupRole: 'drawing' | 'module'`。绘图组只组织图稿的相对坐标，计算模块不能带figure关系，计算子树也不能被间接纳入绘图组。`planGroupFigure`、`planSetFigureView`已提供可执行规划；计算模块封装、概括/详图和自由成组尚无完整界面，本版不把这些数据基础称为完整产品功能。

`core/figure/index.ts`的新增表示/注解、注解更新、视图关联和成组接口返回普通`put`事务，`graphics/figure-appearance.ts`提供显示参数规划；应用的`figure-actions.ts`负责完整提交与选择流程。新增表示和注解返回`Result<{ id, operations }>`，更新注解、视图关系与显示参数返回`Result<ResolvedOperation[]>`；绘图成组也返回新组ID和操作。所有内容复用保存、撤销和导出。

v3的`planPlaceTensorFigure`增量创建缺失表示与表示边；已有表示只同步必要端口，不重建手工几何。保留仍被图稿连线引用的旧端口，避免结构参数变化静默删除说明线。隐藏表示不删除计算，也不因再次更新复活；选择计算对象恢复时可找到其关联图稿，选择某一表示则只恢复该表示。

直接删除计算结构会把关联表示、派生注解和相连边纳入删除闭包；删除被另一表示引用的详图时会解除该关系。锁定相关对象时整笔拒绝。绘图侧仍通过`planRemoveFromFigure`区分隐藏已跟踪对象与删除独立自由内容，不将图稿删除误作计算删除。

## 参数绑定与自由拓扑仍各司其职

`generation` 保存生成器 ID、版本、`paramSchemaVersion`、参数来源和 `localKeys` 稳定键映射。普通网络基元同时注册在基元库与生成器表中，独立使用 `source.kind: 'local'`。读取有效参数和准备生成时，匹配生成器的默认值先补入，已保存字段优先；版本不匹配时暂停参数回改，不自动迁移插件参数。

旧托管组合的子层可使用 `source.kind: 'slot'`。有效参数由子生成器默认值、指定父参数、父级 `__slots[slotKey]` 依次覆盖。父组合仍拥有内部拓扑；自由删除、重接内部内容前需解除组合关联。解除时子层转存有效参数，继续独立可编辑。

普通独立基元之间的拓扑无需解除关联。连接模式生成的是普通边，不留下持续控制这些边的插件关系对象。2D／立体外观也不从绘制边界反算；平面模式保留立体配置，它们表示矢量示意图，不是真实三维场景。

## 手工样式覆盖优先于生成值

`presentation` 必含 `position`，还可保存 `moved`、`scale`、`labelOverride`、`fillOverride`、`strokeOverride`、`textOverride`、`opacityOverride`、`strokeWidthOverride`。这些样式字段在v1/v2/v3均可省略。重新生成保留既有表现，节点显示采用“生成图元 → 手工覆盖”；组配色应改实际子节点，组本身没有可见填充。

`nodeStyle` 按字段修改填色、边框、文字、透明度、线宽；null 删除对应覆盖，恢复生成值。旧 `fill` 操作继续可用。手动重着色保持立体各面明暗；显式文字色由用户决定。图元 `opacity` 范围为 0—1，几何面的 `strokeWidth` 非负，零线宽不绘制边框；省略时沿用原渲染默认值。

连线 `style` 包含 `color`、`width`、`dashed`、`arrow` 和可选 `opacity`。`styleOverrides` 只记录明确手改的字段，重新生成仅保留这些覆盖；旧文件只保存 `style` 时仍可读取，不推测哪些字段曾被手改。手工路径与标签继续保留；移除手改内容需要确认。

## 图稿主题、界面主题、保存与文件校验

界面浅／深主题保存在本机偏好 `nnfig.ui.theme`，不进入工程、revision或撤销。它只影响编辑器和结构投影，不影响下面的图稿主题与导出。

`theme` 必含 `fontFamily`、`lineColor`，可选 `nodeColor`、`textColor`、`borderColor`、`lineWidth`。它们为新内容提供默认值，不凭主题变更重写已有图元。整图配色通过一次显式事务更新节点、边、主题与背景，不顺带清除透明度或线宽。

`page` 保存正数宽高，`background` 支持 `'white'`、`'transparent'` 或 `#RRGGBB`。导出可另选这三种背景，编辑器深色主题不强迫论文黑底。颜色不接受带 alpha 的十六进制值，透明度独立保存。

所有数值须有限，图元尺寸为正。重复 JSON 属性、不匹配实体 ID、父空间循环、悬空端口、非法资源及越界样式会拒绝导入。`revision` 标记当前会话修订，撤销／重做也产生新修订；文件不携带历史栈。IndexedDB 自动保存与手动文件保存分别记录状态；触发下载不等于确认文件已落盘。
