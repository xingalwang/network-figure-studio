# 参与开发

## 先运行项目和检查

使用`.node-version`指定的Node.js版本，在包含`package.json`的工程根目录运行：

```bash
npm ci
npm run dev
```

提交前使用`npm run check`检查格式、模块边界、类型、单元和工具测试。可用`npm run format`统一格式；需要定位时分别运行`format:check`、`check:architecture`、`typecheck`、`test:unit`或`test:tools`。

首次浏览器环境运行`npx playwright install chromium`，Linux必要时使用`--with-deps`。`npm run verify`执行完整检查、浏览器测试和生产构建。构建会更新`dist/`；已有生产预览时，先使用`npm run build -- --outDir /path/to/candidate`旁路验证，不直接覆盖正在使用的构建。

浏览器测试使用Chromium，可用`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`指定路径。不要停止其他人正在使用的服务来腾出测试端口。

## 从改动类型找到入口

### 增加一种自由绘图基元

1. 以`examples/plugins/attention/`为实际示例，声明稳定ID、参数、图元和端口；仅从`src/plugins/sdk.ts`导入宿主能力。
2. 将定义加入`src/builtins/registry.ts`的注册数组。普通基元加入`primitives`，不要同时重复放入`generators`。
3. 补参数和连接单测，再在浏览器验证添加、回改、撤销、保存重开及导出。

详细合同见[插件接口](plugin-development.md)。基元外形不自动赋予张量计算语义。

### 修改工作站或属性面板

- `src/app/workbench/`组织功能分区，`src/workspaces/`保存具体编辑视图；视觉令牌在`src/app/theme/`。
- 工作站通过`src/app/editor/controller.ts`声明的状态与动作协作，完整编辑流程由`useEditor.ts`协调。不要在按钮中自行拼接模式切换、草稿确认和事务顺序。
- 共享编辑类型在`src/workspaces/shared/editor-model.ts`，参数草稿模型与hook分别在同目录的`parameter-drafts.ts`、`useParameterDraft.ts`。具体面板只负责自己的字段和展示。
- 草稿不写入工程或撤销。切换选择保留草稿，外部参数变化提示冲突，成功应用后才清理。

界面改动检查实际深浅主题和主要使用路径；交互缺陷先补可复现的浏览器测试。

### 增加一种宿主内置计算操作

依次检查`src/core/computation/`的类型、目录、纯规则与依赖传播，`src/builtins/tensors.ts`的参数及图元，`src/core/tensor-composition.ts`的创建规划，以及对应界面命令。外部分析调用通过`src/core/computation/index.ts`门面，不复制推导逻辑。

单测覆盖公式、缺失和非法输入、上下游传播；浏览器测试覆盖真实创建、回改与一次撤销。新增运算不是现有绘图插件的隐式权限，计算规则版本与参数格式必须明确。

## 保持这些约定

- 文档是唯一真源，修改通过编辑事务提交，保留对象ID、撤销与文件兼容。
- 真实张量尺寸与显示几何分开，未知或冲突不猜输出。
- 生成与绘图共用文档，更新不覆盖手工排版、样式、路径或隐藏状态。
- UI流程由编辑协调器拥有；核心计算与持久化不反向依赖工作站。
- 只抽取已经重复的职责，不为单次使用添加通用框架、额外状态库或万能表单。
- 代码使用现有TypeScript严格检查和Prettier配置。共享类型不放在某个具体视图中，公共函数说明实际输入、结果和失败条件。

## 整理可分发源码包

版本号只在`package.json`与锁文件根包中更新，界面从包元数据读取；同时更新`docs/CHANGELOG.md`。工程格式版本与插件API版本各自管理，不随应用补丁号自动改变。

```bash
npm run release:prepare -- --out ../release-0.1.1
```

输出目录的父目录需已存在，目标必须为空且位于开发工程之外。工具按白名单复制源码、测试、配置、资源、许可、工程样例和必要文档，打印完整清单；不执行Git操作、不安装依赖，也不覆盖旧版本。独立检查输出目录的清单、文档链接、构建与测试依赖，确认内容对应本版本后再发布。

不提交依赖、构建、缓存、个人配置、凭据、测试追踪、AI提示词、效果图或开发过程记录。

架构入口见[架构说明](architecture.md)，数据约定见[工程格式](project-format.md)。贡献采用[MIT](../LICENSE)，第三方材料须保留原许可并更新[第三方说明](THIRD_PARTY_NOTICES.md)。
