# 0.3.0 架构与工作台

架构图工作台是本地优先的浏览器应用。模块组装构造张量、算子和数据流，图稿编辑调整论文呈现；两侧编辑同一份工程，真实计算与显示几何分别保存。

## 目录按职责划分

```text
src/
  app/
    Startup.tsx             字体启动反馈与失败恢复，不卸载工程
    App.tsx                 工程生命周期订阅与引导状态
    editor/
      controller.ts         显式状态与完整动作合同
      useEditor.ts          组合状态、派生预览与完整编辑动作
      project-actions.ts    文件、新建、迁移与工程切换
      workspace-actions.ts  组装、图稿与旧组合完整动作
      operation-draft.ts    运算参数、异步预览与创建
      capabilities.ts       模块库／工具栏／块旁菜单能力判定
      entity-actions.ts     参数回改、版本检查、移除确认与标签事务
      figure-actions.ts     独立标注、表示与图稿显示参数的完整动作
    workbench/              菜单、命令带、模型区、画布、属性与计算摘要
    theme/                  界面令牌与本机主题偏好
    project-lifecycle.ts    恢复、写锁、工程切换与文件保存
    session.ts              生成预览与旧组合草稿
  ui/                       无业务状态的基础控件与统一控件样式
  core/
    document/               工程类型、严格校验、v1/v2/v3编解码与显式复制迁移
    commands/               原子事务、修订检查、只读保护与统一撤销
    computation/            计算合同、规则解析、依赖分析与诊断传播
    figure/                 表示、注解来源、概括/详图关联和绘图成组规划
    generation/             参数合同与验证、稳定标识合并、草稿冲突
    tensor-composition.ts   源块/运算创建、结构到图稿的增量规划
    composition.ts          自由基元删除与按工作区布局的规划
  builtins/                 内置算子定义、数值规则、基元及注册组合根
  graphics/                 几何、图稿显示参数、视觉投影与SVG/PNG导出
  adapters/maxgraph/        文档投影、画布生命周期与手势到事务的转换
  persistence/              IndexedDB、自动保存、工程文件与跨标签写锁
  plugins/                  公开SDK、可信构建期注册与受限提案执行
  workspaces/
    generator/              张量、运算和自由基元的具体编辑视图
    drawing/                图稿、独立标注和显示几何的具体编辑视图
    shared/                 共用画布宿主、字段呈现和属性组件
```

`examples/plugins/`是公开SDK的实际消费者；`examples/projects/`保存可编辑工程。测试归入`tests/unit/`与`tests/e2e/`，运行资源归入`public/`，工程工具归入`scripts/`，正式文档归入`docs/`。完整npm工程可以独立安装和运行。

## 一份权威文档，三类状态

| 状态                                      | 拥有者                        | 保存与撤销                 |
| ----------------------------------------- | ----------------------------- | -------------------------- |
| 工程对象、参数、连接、图稿几何/样式与布局 | `DocumentStore`               | 工程文件持久化；按事务撤销 |
| 形状、参数量、依赖和诊断                  | `analyzeDocument`派生报告     | 不持久化，不进入历史       |
| 选择、模式、草稿、视口、界面主题          | session、编辑协调器和局部视图 | 不作为第二份工程保存       |

工程修改提交带`baseRevision`的提案，统一处理旧修订、只读和撤销。maxGraph模型是投影，不能反写为另一份权威文档。主题存于本机localStorage的`nnfig.ui.theme`，不改变工程revision或撤销；图稿主题与导出背景独立保存。

v2保留原有对象同时承担计算与绘制的合同。v3中，计算节点保留稳定语义ID，图稿表示拥有自己的ID，并通过`figure.semanticRef`指向计算对象；同一计算对象可以拥有多个表示。图稿对象不携带计算语义或生成绑定。结构更新只补充必要表示、连接和端口合同，保留已编辑的几何、位置、样式、路径和显式隐藏状态。格式细节见[工程格式](project-format.md)。

## 编辑协调各有入口

`controller.ts`显式声明`EditorOptions`、`EditorState`、`EditorActions`和`EditorController`；`useEditor`组合合同，复杂流程分别落在`project-actions.ts`、`workspace-actions.ts`、`operation-draft.ts`等少量职责模块；参数草稿和编辑请求模型也归编辑层，Context只向工作站提供内部状态和动作，不作为插件SDK。

工作站调用`addTensor`、`beginOperation`、`createOperation`、`placeFigure`、`restoreFigure`、`addAnnotation`和`addRepresentation`等完整动作。模式切换、确认、事务、反馈与选择由协调器安排。`entity-actions.ts`集中参数和标签编辑：匹配原生成器版本，以原修订执行生成，必要时确认手改内容移除；确认期间出现新修订会使旧提案失效。`figure-actions.ts`集中图稿元素和显示参数编辑，`updateFigureAppearance`完成所选表示的显示参数提交；使用新版能力前通过生命周期确认并切换v3副本。面板可以复用这些动作，不必重排流程。运算草稿保留在编辑层，切换图稿或引导页不丢失；表单只在组装侧展示，最终创建再次验证实际工作区和能力。

基础服务仍可传给低阶编辑器。单字段样式、连线和位置编辑继续通过已有store事务提交；本版没有将所有属性控件重写成一套命令框架。`workspaces/shared/GraphView.tsx`是两侧共用的宿主，集中拥有适配器实例、订阅与清理；外部视图和协调层使用`getViewport/setViewport/getScale/onScale`等接口，底层maxGraph事件、预览自动适配和ResizeObserver留在适配器。`app/editor/parameter-drafts.ts`和`useParameterDraft.ts`统一逐对象参数草稿、基线、冲突与成功后的清理，不复制工程状态。

顶部“构建”调用`build-actions.ts`，按字段的`section`统一准备全部结构草稿，最终一次提交、一次撤销；“应用外观”只提交对应对象的外观字段。图稿几何与注解草稿不参与结构构建。“更新图稿”仍是独立动作。`previewDoc/previewReport`仅供组装侧实时投影，正式工程与图稿使用已提交文档。画布滚轮由maxGraph适配器处理，围绕鼠标缩放并通知协调层更新比例；视口变化不进入工程历史，面板滚动不受影响。

`app/home/WelcomePage.tsx`提供引导页，`App`保留其可见状态。生命周期仍恢复当前本地工程并管理写锁；引导页覆盖在保持挂载的编辑器之上，工作台设为`inert`且全局编辑快捷键暂停，参数草稿、运算表单和视口不被重建。新建／导入共用完整编辑动作及唯一文件输入；`switchProject`返回是否真正切换成功，拒绝确认或保存失败时留在当前页面。顶栏负责工程信息与保存，第二栏负责通用操作，底部独立输出诊断和摘要。

普通组装只使用`AssemblyCanvas`，张量与自由基元共用拖放、选择、双击、运算入口和视口。`CanvasWorkspace`中的旧组合分支仅承载独立预览／放置，并提供返回入口。选择工具不创建端口连接，连线工具仅按现有自由说明线合同工作；计算数据流通过注册运算动作创建。

`app/modules/catalog.ts`从各注册插件的能力声明推导模块组与条目；界面将数据基元、运算、绘图基元、连接方式和组合呈现为功能模块，技术插件合同不改。`preferences.tsx`保存本机工具选择，`ModuleLibrary.tsx`复用完整编辑动作；取消模块选择只过滤新增工具、块旁菜单与合并入口，完整注册表继续解释旧工程。模块库、工具栏、块旁菜单及最终动作共同使用`capabilities.ts`判断可用性和原因。连接模板经`connection-actions.ts`校验当前可见端点后提交，不能把计算节点接成不可见说明线。现有创建动作支持内置2D／3D数据源，其他自定义数据源尚无通用创建入口，不在模块库假装可用。

## 计算定义通过注册接入

调用链为：

1. `app/registry.ts`取得`builtins/registry.ts`组合的注册表；组合根注册内置插件与可信扩展示例。
2. `PluginDefinition.computations`与对应生成器一起交给`createPluginRegistry`。注册器检查唯一ID、生成器版本、参数格式、角色、输入/输出端口和结果张量定义。
3. 命令带与张量菜单读取注册表，通过`listAvailableOperations`匹配所选张量维数与输入数量；字段取自生成器，显示分组取自计算定义。
4. `appendTensorOperation`按定义准备参数和端口，一次事务创建操作、结果张量与数据流边。
5. `analyzeDocument(doc, registry.computations)`检查版本、依赖、秩、端口和回路，再调用具体规则；报告供面板、画布与导出使用。

`core/computation/definitions.ts`拥有`ComputationDefinition`合同；`registry.ts`负责精确版本解析与发现，`topology.ts`只读取显式数据流，`propagation.ts`负责通用依赖与诊断，`rules.ts`只保留通用数值辅助。具体内置定义在`builtins/computations.ts`，具体公式在`builtins/computation-rules.ts`。参数字段与生成片段的权威类型在`core/generation/types.ts`，通用参数验证在`parameters.ts`，SDK和旧注册入口保留重导出。

分析报告可带`formulas: FormulaLine[]`值对象。`core/computation/formulas.ts`提供纯记号构造与校验，`builtins/computation-formulas.ts`使用既有推导结果描述内置公式；`workspaces/generator/MathFormula.tsx`仅把记号渲染为原生MathML，不再次推导。公式不保存进工程；缺参、冲突或未知规则不沿用旧结果。变量斜体，函数、数字及运算符正体，使用统一字体栈及必要数学符号后备。

核心没有内置规则的隐藏全局注册。调用方显式传入同一`registry.computations`，包括分析、操作发现、张量视觉、画布和SVG/PNG导出；默认空注册表会将计算标为`unsupported`，不会猜用当前内置版本。普通示意基元没有注册计算定义时仍可绘图，不因外形相似获得计算能力。新增算子的实际入口见[LeakyReLU示例](../examples/plugins/leaky-relu/README.md)与[扩展说明](plugin-development.md)。

## 图稿表达与计算模块分开

`core/figure/`提供新增表示、独立手工/派生注解、概括/详图关联及绘图成组的规划。概括和详图是表示之间的关系，不增加数据流；`groupRole: 'drawing'`只组织图稿坐标，`groupRole: 'module'`用于区分计算模块，不能把计算子树装入绘图组。本版已有这些数据与核心API，尚无完整的概括/详图、计算模块封装或自由成组界面。

`graphics/figure-appearance.ts`规划所选表示的显示宽高、视觉厚度与投影角度修改；宽高以节点`size`为准，投影保存在`figure.tensorProjection`。`figureAppearance(doc, node)`读取显示值，`planUpdateFigureAppearance(doc, id, values)`返回一次事务的规划，`FigureRepresentationPanel`复用共享参数草稿模型。表示的显示编辑不会修改计算源、其他表示或真实N/D/H/W/C。独立标注与多表示有最小界面；自动注解在投影时读取分析报告，手工文本保持原文。样例见[独立表示与注解](../examples/projects/figure-views-demo.nnfig.json)。

`graphics/tensor-grid.ts`负责张量网格与图稿快照：2D 三轴映射为 W/H/C，3D 为 W/H/D，N 与 3D 的 C 在右侧信息及图稿标注中表达。组装的自动模式从结构草稿的派生 shape 实时投影，默认共用 2 px/单位，整体及各轴倍率乘实际尺寸；长度超过 128 px 后连续压缩至 192 px 上限，每轴最多 12 格，组装侧的压缩说明放在右栏。显式手工模式保留保存的边长，仍按当前 shape 绘制有限网格；旧文件缺显示模式时保留原几何，未知尺寸只作占位并在右栏说明。显示模式和倍率属于生成参数的 appearance 字段，结构构建不提交它们。新图稿通过 `finalizeTensorFigure` 将网格固化到已有 `size/primitives/bounds/ports`，不新增工程格式字段或重复保存真实规格；已有图稿保持手工几何，结构变化只更新真实标注。v2 的结构构建通过 `preserveTensorFigureSnapshots` 保留共享对象的图稿快照，手工调整尺寸、厚度或角度仍保留网格。

组装投影的`primitives/bounds`只包含图形，`caption`是可选的单行名称元数据，不保存进工程。maxGraph适配器仅在节点或组被选中时显示12px外部名称；选择变化只重绘有关文字，不重建节点、不改变端口、视口或工程历史。完整规格、状态、显示比例及运算参数归右侧信息栏。图稿投影继续使用原有标签与手工几何，不套用组装名称的显示规则。

## 依赖方向有可执行检查

`npm run check:architecture`解析源码和插件示例的静态、重导出、类型、动态及require导入，扫描TS/TSX、JS/JSX与模块扩展名；无法静态确定的模块路径会拒绝。

- `core`不依赖builtins、界面、画布适配器或持久化，也不加载插件运行层；必要插件合同只可使用类型导入。
- `core/computation`只依赖core，具体规则由调用方注入；`core/document/types.ts`仅通过类型导入共享`graphics/primitives`的值类型。
- 核心、持久化、插件和内置定义不依赖React或maxGraph；编辑协调层不导入工作区，工作区不运行临时store或完整生成／分析流程。
- `ui`不依赖业务模块；共享工作区不反向引用具体工作区，组装不引用图稿视图。
- 插件示例访问宿主只走`plugins/sdk.ts`，各示例不互相导入实现；只有`builtins/registry.ts`负责加载示例。
- `plugins/sdk.ts → builtins/layers.ts`保留旧几何助手兼容桥。`graphics/export.ts`复用画布渲染，`graphics/paint.ts`使用maxGraph绘制合同；这些既有桥接不代表所有层都可互相访问。

## 字体策略与导出

`graphics/typography.ts`是字体栈唯一来源：Times New Roman、SimSun、Noto Sans SC、serif。启动时初始化CSS变量，画布直接使用同一常量；Windows浏览器使用系统字体，缺少SimSun时加载既有OFL中文回退。SVG默认只引用字体，PNG用相同字体栈绘制H/田参考字形，并检查实际栅格像素就绪；内部栅格SVG仅在需要时携带OFL回退字体。不会把Windows字体复制到资源、源码或发布包。`Startup`在大字体下载前立即给出可见等待，字形就绪后再挂载画布；失败时使用已就绪的浏览器回退并提示重试，保留工程访问，重试不卸载编辑器。SVG／PNG仍执行严格字体准备与字形检查。

显式选择SVG内嵌时，在下载点击调用栈中请求Local Font Access。字体字节仅留在本次内存和用户输出文件中，检查OS/2嵌入限制并保留字体版权/许可记录；仅预览打印或位图嵌入权限不足以生成可编辑SVG。拒绝、缺字体或API不可用会明确报错，不偷偷切换为其他内嵌字体。界面预览和PNG不请求该权限。

## 修改后的验证入口

格式、边界、类型、单元和工具测试由`npm run check`串联；浏览器回归与构建由`npm run verify`追加，CI使用同一入口。算法改动重点验证已知形状、参数量、错误和上下游传播；格式改动验证旧工程、样例、手工表现与保存重开；界面改动验证真实创建、参数回改、图稿编辑和SVG/PNG导出。运行中的预览构建须旁路保护，操作方法见[贡献指南](CONTRIBUTING.md)。

## 工作台视觉与本机布局

`app/theme/tokens.css`维护深浅主题颜色与尺寸令牌：正文13px、辅助12px、标题14px、行高20px、控件28px、圆角3px、间距4/8/12/16px。字体继续来自`graphics/typography.ts`。`ui/controls.css`负责按钮、图标按钮、字段、页签等控件及悬停／焦点／禁用／错误状态，`app/styles.css`保留全局基础和功能布局，`workbench.css`负责六区工作台与分隔条；功能样式只处理自身内容，不反复覆盖基础控件。

顶部工程与文件操作、第二栏通用／工作区／跨区工具、左模块／结构、中画布、右对象属性／图稿页面、底部诊断／摘要。构建显示待提交数量，更新图稿为独立动作。底部无诊断默认紧凑，出现问题默认展开；用户主动收折／展开优先。`workbench/layout.tsx`以本机`nnfig.workbench-layout.v1`保存有界侧栏宽度、底部高度和展开偏好；分隔条支持拖动、方向键和双击复位，窗口缩小时重新约束中央空间。界面令牌只影响应用外壳，不改工程主题、画布图元或导出。
