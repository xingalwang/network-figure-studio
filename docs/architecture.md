# 0.2.0 架构与扩展入口

架构图工作台是本地优先的浏览器应用。模块组装构造张量、算子和数据流，图稿编辑调整论文呈现；两侧编辑同一份工程，真实计算与显示几何分别保存。

## 目录按职责划分

```text
src/
  app/
    App.tsx                 启动与项目生命周期订阅
    editor/
      controller.ts         显式状态与完整动作合同
      useEditor.ts          工作区、选择、确认、文件与画布协调
      entity-actions.ts     参数回改、版本检查、移除确认与标签事务
      figure-actions.ts     独立标注、表示与图稿显示参数的完整动作
    workbench/              菜单、命令带、模型区、画布、属性与计算摘要
    theme/                  界面令牌与本机主题偏好
    project-lifecycle.ts    恢复、写锁、工程切换与文件保存
    session.ts              生成预览与旧组合草稿
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
    shared/                 真实复用的编辑类型、参数草稿和属性组件
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

`controller.ts`显式声明`EditorOptions`、`EditorState`、`EditorActions`和`EditorController`；`useEditor`实现合同，Context只向工作站提供内部状态和动作，不作为插件SDK。

工作站调用`addTensor`、`beginOperation`、`createOperation`、`placeFigure`、`restoreFigure`、`addAnnotation`和`addRepresentation`等完整动作。模式切换、确认、事务、反馈与选择由协调器安排。`entity-actions.ts`集中参数和标签编辑：匹配原生成器版本，以原修订执行生成，必要时确认手改内容移除；确认期间出现新修订会使旧提案失效。`figure-actions.ts`集中图稿元素和显示参数编辑，`updateFigureAppearance`完成所选表示的显示参数提交；使用新版能力前通过生命周期确认并切换v3副本。面板可以复用这些动作，不必重排流程。

基础服务仍可传给低阶编辑器。单字段样式、连线和位置编辑继续通过已有store事务提交；本版没有将所有属性控件重写成一套命令框架。`GraphView`集中拥有maxGraph实例、订阅与清理。`workspaces/shared/parameter-drafts.ts`和`useParameterDraft.ts`统一逐对象参数草稿、基线、冲突与成功后的清理，不复制工程状态。

## 计算定义通过注册接入

调用链为：

1. `app/registry.ts`取得`builtins/registry.ts`组合的注册表；组合根注册内置插件与可信扩展示例。
2. `PluginDefinition.computations`与对应生成器一起交给`createPluginRegistry`。注册器检查唯一ID、生成器版本、参数格式、角色、输入/输出端口和结果张量定义。
3. 命令带与张量菜单读取注册表，通过`listAvailableOperations`匹配所选张量维数与输入数量；字段取自生成器，显示分组取自计算定义。
4. `appendTensorOperation`按定义准备参数和端口，一次事务创建操作、结果张量与数据流边。
5. `analyzeDocument(doc, registry.computations)`检查版本、依赖、秩、端口和回路，再调用具体规则；报告供面板、画布与导出使用。

`core/computation/definitions.ts`拥有`ComputationDefinition`合同；`registry.ts`负责精确版本解析与发现，`topology.ts`只读取显式数据流，`propagation.ts`负责通用依赖与诊断，`rules.ts`只保留通用数值辅助。具体内置定义在`builtins/computations.ts`，具体公式在`builtins/computation-rules.ts`。参数字段与生成片段的权威类型在`core/generation/types.ts`，通用参数验证在`parameters.ts`，SDK和旧注册入口保留重导出。

核心没有内置规则的隐藏全局注册。调用方显式传入同一`registry.computations`，包括分析、操作发现、张量视觉、画布和SVG/PNG导出；默认空注册表会将计算标为`unsupported`，不会猜用当前内置版本。普通示意基元没有注册计算定义时仍可绘图，不因外形相似获得计算能力。新增算子的实际入口见[LeakyReLU示例](../examples/plugins/leaky-relu/README.md)与[扩展说明](plugin-development.md)。

## 图稿表达与计算模块分开

`core/figure/`提供新增表示、独立手工/派生注解、概括/详图关联及绘图成组的规划。概括和详图是表示之间的关系，不增加数据流；`groupRole: 'drawing'`只组织图稿坐标，`groupRole: 'module'`用于区分计算模块，不能把计算子树装入绘图组。本版已有这些数据与核心API，尚无完整的概括/详图、计算模块封装或自由成组界面。

`graphics/figure-appearance.ts`规划所选表示的显示宽高、视觉厚度与投影角度修改；宽高以节点`size`为准，投影保存在`figure.tensorProjection`。`figureAppearance(doc, node)`读取显示值，`planUpdateFigureAppearance(doc, id, values)`返回一次事务的规划，`FigureRepresentationPanel`复用共享参数草稿模型。表示的显示编辑不会修改计算源、其他表示或真实N/D/H/W/C。独立标注与多表示有最小界面；自动注解在投影时读取分析报告，手工文本保持原文。样例见[独立表示与注解](../examples/projects/figure-views-demo.nnfig.json)。

## 依赖方向有可执行检查

`npm run check:architecture`解析源码和插件示例的静态、重导出、类型、动态及require导入，扫描TS/TSX、JS/JSX与模块扩展名；无法静态确定的模块路径会拒绝。

- `core`不依赖builtins、界面、画布适配器或持久化，也不加载插件运行层；必要插件合同只可使用类型导入。
- `core/computation`只依赖core，具体规则由调用方注入；`core/document/types.ts`仅通过类型导入共享`graphics/primitives`的值类型。
- 核心、持久化、插件和内置定义不依赖React或maxGraph；编辑协调层不导入具体工作区面板。
- 插件示例访问宿主只走`plugins/sdk.ts`，各示例不互相导入实现；只有`builtins/registry.ts`负责加载示例。
- `plugins/sdk.ts → builtins/layers.ts`保留旧几何助手兼容桥。`graphics/export.ts`复用画布渲染，`graphics/paint.ts`使用maxGraph绘制合同；这些既有桥接不代表所有层都可互相访问。

## 修改后的验证入口

格式、边界、类型、单元和工具测试由`npm run check`串联；浏览器回归与构建由`npm run verify`追加，CI使用同一入口。算法改动重点验证已知形状、参数量、错误和上下游传播；格式改动验证旧工程、样例、手工表现与保存重开；界面改动验证真实创建、参数回改、图稿编辑和SVG/PNG导出。运行中的预览构建须旁路保护，操作方法见[贡献指南](CONTRIBUTING.md)。
