# 架构图工作台

用于论文和汇报的深度学习网络架构绘图工具。本地浏览器运行，不需要账号或后端，不读取真实模型或执行训练。

## 启动

需要 Node.js 24.15.0 或更新版本。

```bash
npm ci
npm run dev
```

打开 http://127.0.0.1:5173 。生产构建：

```bash
npm run build
npm run start
```

生产地址为 http://127.0.0.1:4173 。两个地址的浏览器自动保存相互独立，使用工程文件转移数据。可选 Windows／WSL 启动方式见 [scripts/README.md](scripts/README.md)。

## 使用

1. 在生成工作区拖入2D或3D数据块，双击设置空间尺寸和通道。
2. 选择张量，通过旁边的“＋”或顶部命令添加卷积、池化、ReLU或最近邻上采样；Shift多选后可Concat或Add。
3. 查看尺寸推导、参数量和冲突原因，再用“加入图稿”进入绘图工作区调整表现。
4. 需要独立说明或同一结构的另一张图时，使用“独立标注”或“新增图稿表示”；旧工程会先询问是否创建v3副本。每个表示可分别修改显示宽高，张量块还可修改视觉厚度和投影角度。
5. 保存可编辑工程，或导出SVG／PNG。界面深浅主题不改变图稿背景。

更新图稿增量加入内容并同步必要端口，保留已有位置、显示大小、配色、路径和显式隐藏。真实张量尺寸与图形显示尺寸、视觉厚度分开；v3中同一计算对象可有多个独立图稿表示。

可通过“打开工程”加载 [2D卷积与上采样](examples/projects/tensor-2d-demo.nnfig.json)、[3D分支拼接](examples/projects/tensor-branch-demo.nnfig.json)或[Residual组合](examples/projects/residual-demo.nnfig.json)。另有[多表示与独立注解](examples/projects/figure-views-demo.nnfig.json)的v3最小样例。插件示例在`examples/plugins/`，其中[LeakyReLU](examples/plugins/leaky-relu/README.md)演示通过定义与注册增加算子。

## 0.2.0支持范围

- 2D／3D数据、Conv2D／3D、MaxPool2D／3D、ReLU、最近邻上采样、Concat与严格Add。
- 双主题、参数回改、撤销重做、浏览器自动保存、工程文件往返、矢量编辑及SVG／PNG导出。
- 卷积groups／dilation固定1；上采样使用各空间轴正整数倍率。缺信息或冲突时停止派生，不猜输出。
- 可信构建期算子注册、LeakyReLU示例；v1/v2继续读取编辑，新建默认v2，使用新图稿能力时显式创建v3副本。
- v3独立图稿表示、手工/派生注解来源，以及概括/详图关联和绘图分组的核心API；后两者尚无完整界面，计算模块封装也未形成完整产品功能。
- 尚未提供完整图片编辑、裁剪、图层、复制粘贴、自由成组界面或社区代码插件在线安装。

浏览器自动保存不等于工程文件落盘。SVG默认内嵌中文字体，文件较大；关闭字体内嵌后，查看设备需要安装相应字体。PNG支持指定像素尺寸及白色／透明背景。

## 开发

```bash
npm run check           # 格式、模块边界、类型、单元与工具测试
npx playwright install chromium
npm run verify          # 完整检查、浏览器回归及生产构建
```

0.2.0在既有工程上整理可扩展基座：通用依赖分析与具体算子分开，编辑动作按职责组织，v3分开计算和图稿身份。新算子从自己的生成器/规则定义注册，画布与存储复用通用合同。修改入口和对应验证见[贡献指南](docs/CONTRIBUTING.md)；可用`npm run format`统一格式。

Linux首次运行浏览器测试可能需要 `npx playwright install --with-deps chromium`。测试与构建由GitHub Actions执行。

文档：[架构](docs/architecture.md) · [工程格式](docs/project-format.md) · [插件接口](docs/plugin-development.md) · [贡献指南](docs/CONTRIBUTING.md) · [更新记录](docs/CHANGELOG.md)。

## 许可

项目代码采用 [MIT](LICENSE)。第三方依赖与字体保留各自许可，见 [THIRD_PARTY_NOTICES.md](docs/THIRD_PARTY_NOTICES.md)。
