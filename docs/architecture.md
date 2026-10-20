# 0.1.1 架构与扩展入口

架构图工作台是本地优先的浏览器应用。生成工作区构造张量与运算，绘图工作区编辑论文呈现；两侧通过稳定ID编辑同一份工程，不互相导入位图。

## 目录按职责划分

```text
src/
  app/
    App.tsx                 应用启动与项目生命周期订阅
    editor/                 显式状态／动作合同，以及选择、模式、文件与画布协调
    workbench/              标题菜单、命令带、模型区、画布、属性、计算摘要
    theme/                  界面令牌与本机主题偏好
    project-lifecycle.ts    恢复、写锁、项目切换及文件保存生命周期
    session.ts              生成预览与旧组合实例草稿
  core/
    document/               工程类型、校验与v1/v2编解码
    commands/               原子编辑、只读保护与统一撤销
    computation/            静态依赖分析与纯计算规则
    generation/             参数生成、稳定标识合并及草稿冲突
    tensor-composition.ts   源块与下一步运算的原子创建、图稿成员管理
    composition.ts          自由示意基元的连接、删除与布局规划
  builtins/                 内置数据、运算、自由示意基元与注册
  graphics/                 矢量几何、两工作区投影、SVG/PNG导出
  adapters/maxgraph/        文档到交互画布的投影与手势转换
  persistence/              IndexedDB、自动保存、文件与跨标签写锁
  plugins/                  公开SDK、注册及受限提案执行
  workspaces/
    drawing/                自由图元属性与绘图视图
    generator/              张量、运算与基元编辑视图
    shared/                 共享编辑模型、参数草稿及复用属性组件
```

`examples/plugins/`是公开SDK的实际消费者，`tests/unit/`检验纯逻辑与事务，`tests/e2e/`用真实Chromium检验交互、文件及导出。开发调试入口不进入生产包。

## 一个文档，三种不同的状态

**工程状态**由DocumentStore唯一拥有。参数、对象ID、连接、图稿样式与两份布局都通过有基准修订号的提案提交。画布事件、界面按钮、内置操作和插件不应绕过该入口；maxGraph模型只是投影，不能成为另一份工程。

**分析报告**是工程的派生结果，不持久化、不加入撤销。源块声明真实形状，操作保存计算参数，结果块没有可手填的输出形状。图稿移除与删除计算结构不同；隐藏图稿不删除计算对象，也不会被更新自动补回。

**界面状态**包括当前选择、预览草稿、视口和主题。主题以`nnfig.ui.theme`保存于本机localStorage，读写失败时本次会话仍可切换；不写入工程，不改变revision。结构投影通过显式ViewTheme参数获得可读配色，导出始终使用工程图稿颜色和背景，不读取界面主题。

工作站Context仅服务内部组件，不是第三方插件接口。App负责生命周期，编辑协调器协调现有服务，各分区视图只消费需要的状态与行动；不为每一页另建存储或历史。

## 编辑接口稳定，视图不拥有流程

`app/editor/controller.ts`显式声明`EditorOptions`、`EditorState`、`EditorActions`和`EditorController`。`useEditor`实现合同，工作站Context消费该合同，不从hook返回值推导接口。改变内部实现不应顺带向所有面板暴露新setter。

工作站调用`addTensor`、`beginOperation`、`enterBuild`、`restoreFigure`等完整动作；模式确认、事务、选择、反馈与定位由协调器安排。`store`、`session`等现有服务继续传给具体编辑器，不另建状态副本；工作站不靠排列原始setter完成业务流程。`GraphView`继续集中管理maxGraph实例及订阅清理。

共享`TensorOperationDraft`、`EditRequest`定义在`workspaces/shared/editor-model.ts`。`parameter-drafts.ts`拥有逐对象缓存、基线比较、冲突和应用后的清理，`useParameterDraft.ts`将它接入React生命周期。普通基元和张量属性面板使用同一模型，但各自拥有字段与计算展示。

## 模块边界由检查保护

`npm run check:architecture`检查TS／TSX源码与插件示例中的字面量导入、重导出、动态导入和类型导入。约束基于当前分层：

- `core`不依赖界面、画布适配器或持久化；核心、内置定义、插件和持久化不依赖React或maxGraph。
- `persistence`、`plugins`、`builtins`不反向访问工作站；编辑协调层不导入具体生成／绘图面板。
- 插件示例访问宿主时只走`plugins/sdk.ts`，不依赖内部文件。
- `graphics/export.ts`通过画布适配器复用渲染，`graphics/paint.ts`使用maxGraph绘制合同；这是现有渲染桥接，不把整个graphics目录假设成纯几何库。

格式、边界、类型与单元／工具测试组合为`npm run check`；浏览器回归和构建另由`npm run verify`串联。CI运行同一组检查。修改边界规则时同时修改检查测试与本节，不以移动文件绕过约束。

## 静态计算按依赖传播

`computation/index.ts`保留稳定导出门面。内部`types.ts`定义真实轴和报告，`catalog.ts`识别受支持的生成器与空间维数，`topology.ts`读取显式数据流，`rules.ts`完成纯数值计算，`propagation.ts`检查角色、输入、版本、回路并传播结果或诊断。

2D形状为N/H/W/C，没有D键；3D为N/D/H/W/C。Conv、MaxPool按维度匹配；ReLU不改形状；最近邻上采样使用各空间轴正整数倍率；Concat要求其他轴一致，Add要求完整形状一致。缺信息、冲突、回路和未知版本不沿用成功输出。自由示意线不参与计算。

增加宿主运算时，同步补目录类型、生成器字段、创建规划、纯规则、图元与界面入口，再测试公式、错误输入、上下游传播及真实创建路径。当前尚未开放通用计算规则插件，普通绘图插件不会因外形相似就被猜成计算算子。

## 保留既有合同

v1自由图仍按原合同读取；使用张量时创建v2副本，不覆盖原工程。旧托管Residual组合继续用槽位与稳定局部键生成；解除组合关联后才自由改内部拓扑。离开未应用的组合草稿进入张量命令时先确认，取消不能后台创建不可见对象。

生成坐标只写`compositionPosition`，图稿位置只写`position`。新增对象增量入图，不自动重排手工图稿；用户改过的颜色、标签、路径和隐藏状态必须保留。源尺寸与运算参数不能被图形拉伸、投影或主题切换反写。
