# Network Figure Studio · 架构图工作台

**搭建深度学习网络，理清张量尺寸，画出用于论文和汇报的架构图。**

一个在本地浏览器运行的可视化工作台：在组装区规划数据流、查看尺寸推导与数学公式，再到图稿区调整布局、配色和标注，导出 SVG 或 PNG。无需账号，无需后端。

[English](README.en.md) · [快速开始](#快速开始) · [可编辑样例](#从一个样例开始) · [使用手册](docs/user-guide.md) · [反馈问题](https://github.com/xingalwang/network-figure-studio/issues)

[![CI](https://github.com/xingalwang/network-figure-studio/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/xingalwang/network-figure-studio/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-0.3.0-2563eb)](https://github.com/xingalwang/network-figure-studio/tree/v0.3.0)
[![License: MIT](https://img.shields.io/badge/License-MIT-16a34a.svg)](LICENSE)

![架构图工作台 v0.3.0 实际运行界面：3D 张量分支与拼接](docs/images/workbench.png)

_v0.3.0 实际运行截图，打开仓库内的「张量分支与拼接」可编辑工程。_

## 从网络想法到论文图

画网络图时，经常要来回核对：卷积后的尺寸是多少？两条分支能不能拼接？为了排版把块画小一点，会不会改动数据规格？

架构图工作台把这些工作放在同一工程里：

| 你要做的事     | 工作台提供的能力                                                           |
| -------------- | -------------------------------------------------------------------------- |
| 理清网络结构   | 添加 2D／3D 数据、卷积、池化、激活与分支操作，组织可视化数据流             |
| 检查尺寸与参数 | 查看支持算子的输出尺寸、参数量、数学公式和诊断；冲突时定位具体对象         |
| 调整论文图     | 独立调整图形显示尺寸、视觉厚度、投影角度、颜色与文字，真实张量规格单独保存 |
| 交付并继续修改 | 导出 SVG／PNG，保存可编辑工程；提供撤销重做、浏览器自动保存和深浅主题      |

它适合研究生、研究人员和教师规划 CNN、解释张量变化，以及制作论文、课件和技术汇报中的网络示意图。

例如，配置一条简单的 2D 链路后，可以逐步检查规格（下列数字按 **H × W × C** 表示）：

```text
输入             Conv2D             ReLU              MaxPool2D
64 × 64 × 3  →  64 × 64 × 16  →  64 × 64 × 16  →  32 × 32 × 16
```

这里使用 3 × 3 卷积、步幅 1、same 填充、16 个输出通道，以及 2 × 2 池化、步幅 2、valid 填充。图形大小可以另行调整。

## 快速开始

需要 [Node.js](https://nodejs.org/) **24.15.0 或更新版本**。

```bash
git clone https://github.com/xingalwang/network-figure-studio.git
cd network-figure-studio
npm ci
npm run dev
```

打开 [http://127.0.0.1:5173](http://127.0.0.1:5173/)，选择功能模块，然后新建工程或打开下面的样例。界面当前为中文，英文说明见 [English README](README.en.md)。

也可以[下载源码 ZIP](https://github.com/xingalwang/network-figure-studio/archive/refs/heads/main.zip)，解压后在项目目录运行 `npm ci` 和 `npm run dev`。

生产构建与本地预览：

```bash
npm run build
npm run start
```

预览地址为 [http://127.0.0.1:4173](http://127.0.0.1:4173/)。5173 与 4173 的浏览器自动保存相互独立；切换地址或设备时，用工程文件转移。可选 Windows／WSL 入口见 [启动说明](scripts/README.md)。

## 从一个样例开始

点击文件链接后，使用 GitHub 的 **Download raw file** 下载 `.nnfig.json` 文件；在工作台选择「打开工程」。通过 Git 或 ZIP 下载项目时，直接打开本地 `examples/projects/` 下的文件即可。

| 可编辑工程                                                         | 可以探索什么                                             |
| ------------------------------------------------------------------ | -------------------------------------------------------- |
| [2D 卷积与上采样](examples/projects/tensor-2d-demo.nnfig.json)     | 观察卷积、池化与上采样如何改变特征图尺寸                 |
| [3D 分支与拼接](examples/projects/tensor-branch-demo.nnfig.json)   | 检查分支数据流、通道拼接和尺寸兼容性；首页截图对应此工程 |
| [Residual 组合](examples/projects/residual-demo.nnfig.json)        | 修改一个已有残差组合，理解组合预览与连接                 |
| [多表示与独立注解](examples/projects/figure-views-demo.nnfig.json) | 尝试 v3 图稿表示与注解；每个表示分别调整外观             |

第一次建议从「2D 卷积与上采样」开始：选中一个运算，修改右侧参数，点击「构建」，观察尺寸与诊断；再通过「加入图稿」调整排版，导出 SVG 或 PNG。

## 当前支持范围

本介绍对应 **v0.3.0**，可用能力以此版本为准：

- **数据与运算**：2D／3D 数据、Conv2D／3D、MaxPool2D／3D、ReLU、最近邻上采样、Concat 和严格 Add。
- **图稿与导出**：矢量编辑、独立图稿表示、SVG／PNG 导出；PNG 支持指定像素尺寸和白色／透明背景。
- **本地工程**：浏览器自动保存、工程文件保存与重开、撤销重做；旧 v1／v2 工程继续读取编辑，使用新图稿能力时显式创建 v3 副本。
- **开发扩展**：可信构建期插件注册；[LeakyReLU 示例](examples/plugins/leaky-relu/README.md)展示如何增加算子。

这是静态网络设计和绘图工具，不读取 PyTorch／TensorFlow 模型，也不执行推理或训练。当前卷积的 groups／dilation 固定为 1，上采样采用各空间轴正整数倍率；缺少信息或尺寸冲突时会提示原因。完整图片编辑、裁剪、图层、复制粘贴及自由成组界面尚未提供。

浏览器自动保存不能代替下载工程文件。SVG 默认保留可编辑文字，跨设备打开时需要相应字体；字体回退、可选内嵌和更多操作细节见 [使用手册](docs/user-guide.md)。

## 参与改进

欢迎提交 [Issue](https://github.com/xingalwang/network-figure-studio/issues)，分享你需要画的网络、遇到的尺寸问题，或希望支持的算子。报告问题时附上操作步骤与可公开的最小工程，有助于复现。

如果这个工具帮你理清了网络或省下了画图时间，欢迎点个 **Star**，方便以后找到它。也欢迎通过 PR 改进文档、修复问题或增加插件。

开发检查：

```bash
npm run check
npx playwright install chromium
npm run verify
```

`check` 包含格式、模块边界、类型、单元与工具测试；`verify` 还包含浏览器检查与生产构建。Linux 浏览器依赖说明见 [贡献指南](docs/CONTRIBUTING.md)。

文档：[使用手册](docs/user-guide.md) · [架构](docs/architecture.md) · [工程格式](docs/project-format.md) · [插件开发](docs/plugin-development.md) · [贡献指南](docs/CONTRIBUTING.md) · [更新记录](docs/CHANGELOG.md)。

## 许可

项目代码采用 [MIT](LICENSE) 许可。第三方依赖与字体保留各自许可，见 [第三方声明](docs/THIRD_PARTY_NOTICES.md)。
