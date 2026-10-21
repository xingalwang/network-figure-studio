# 参与开发

## 运行项目

使用`.node-version`指定的Node.js版本，在包含`package.json`的工程目录运行：

```bash
npm ci
npm run dev
```

`npm run check`串联格式、模块边界、类型、单元和工具测试；定位问题时可分别运行`format:check`、`check:architecture`、`typecheck`、`test:unit`或`test:tools`。`npm run format`统一格式。

首次浏览器环境运行`npx playwright install chromium`，Linux必要时使用`--with-deps`。`npm run verify`追加浏览器测试和生产构建。构建会更新`dist/`；已有生产预览时先使用`npm run build -- --outDir /path/to/candidate`旁路验证，不覆盖正在提供服务的构建。浏览器测试使用Chromium，可用`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`指定路径；不要停止他人的服务来腾出端口。

## 按改动找到入口

| 改动             | 归属与接入                                                                                     | 重点验证                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 新增自由绘图基元 | 自己的`examples/plugins/<name>/`；SDK声明参数/图元/端口，加入`primitives`                      | 稳定ID、参数回改、端口、撤销、保存和导出                     |
| 新增静态算子     | 生成器与`ComputationDefinition`放在能力自己的模块，加入插件`generators`/`computations`与组合根 | 注册发现、已知结果、缺参/错误/未知版本、上下游传播、原子创建 |
| 新增图稿元素     | `core/figure/`规划普通文档操作，视觉放`graphics/`，界面消费完整编辑动作                        | 格式、保存重开、撤销、导出、手工表现不被覆盖                 |
| 修改面板或工作区 | `workspaces/`具体交互，`app/workbench/`分区，`app/editor/`业务协调                             | 草稿、确认、取消、选择和实际浏览器路径                       |
| 修改格式或迁移   | `core/document/`类型、校验和codec一起修改                                                      | v1/v2/当前格式、旧样例、非法/悬空引用及表现保真              |
| 修改边界或工具   | `scripts/`及对应工具测试                                                                       | 正反例与实际源码扫描                                         |

修改相关路径后运行相应验证；交付前执行项目检查。无新变化或失败不重复扩大验证。实际浏览器中的效果不能由纯类型检查代替。常用定向入口：

```bash
npx vitest run tests/unit/computation-extensions.test.ts
npx vitest run tests/unit/figure-v3.test.ts
npx vitest run tests/unit/editor-entity-actions.test.ts tests/unit/editor-figure-actions.test.ts
npx playwright test tests/e2e/architecture-foundation.spec.ts tests/e2e/figure-projection.spec.ts
npx playwright test tests/e2e/assembly-interactions.spec.ts tests/e2e/workbench-layout.spec.ts
npx vitest run tests/unit/typography.test.ts
npx playwright test tests/e2e/export.spec.ts
node --test scripts/check-architecture.test.mjs
```

## 扩展具体能力

自由绘图基元以[Attention示例](../examples/plugins/attention/README.md)为起点。只从`src/plugins/sdk.ts`使用宿主能力；`PrimitiveDefinition`同时注册到基元表和生成器表，不重复放入`generators`。

计算扩展以[LeakyReLU示例](../examples/plugins/leaky-relu/README.md)为起点。定义参数与生成片段、精确版本、输入/输出端口、维数、纯规则、诊断和操作发现元数据，再加入`builtins/registry.ts`组合根。核心分析不新增按算子名称分派的特例，存储与画布不为单个算子增加分支。宿主调用`analyzeDocument`、操作发现、画布与导出时显式传入`registry.computations`；默认空表会报告`unsupported`。

参数合同与校验分别以`core/generation/types.ts`、`parameters.ts`为权威；计算合同以`core/computation/definitions.ts`为权威。SDK保留公开重导出。API版本仍为1，`computations`为可选能力；这只适用于可信构建期源码，不提供任意第三方代码隔离或在线安装。

图稿数据与核心API见[工程格式](project-format.md)。`figure-views-demo.nnfig.json`示例覆盖多表示、注解和视图关系；概括/详图、绘图成组与计算模块尚无整套界面，不在文档中冒称已实现。显示几何修改经`graphics/figure-appearance.ts`规划，再交应用动作提交，不能反写真实张量尺寸。

## 面板复用完整编辑动作

`app/editor/controller.ts`显式声明状态与动作。`useEditor.ts`协调工作区、生命周期与基础服务；`entity-actions.ts`负责参数、标签、精确版本和必要的内容移除确认；`figure-actions.ts`负责独立标注、图稿表示与显示参数的提交和选择。`project-actions.ts`集中文件／迁移／新建切换，`workspace-actions.ts`集中组装、图稿和旧组合动作；`capabilities.ts`统一模块库、工具栏与块旁菜单的可用性。按钮调用完整动作，不自行拼接迁移、模式切换、确认与事务顺序。

`workspaces/shared/GraphView.tsx`是两工作区共同宿主，视口、缩放及事件经适配器接口访问。`ui/`只提供无业务依赖的控件，字段解释由`workspaces/shared/ParameterField.tsx`共用，轴分组留在`TensorFields`。低阶样式、位置和连线控件继续通过现有store事务编辑，不另建状态或撤销历史。共享编辑类型、参数草稿和草稿hook在`app/editor/model.ts`、`parameter-drafts.ts`、`useParameterDraft.ts`；`operation-draft.ts`拥有运算参数、异步预览与提交，具体面板只负责字段和展示。草稿不写工程或撤销；成功应用后清理，外部参数变化显示冲突。

## 保持不变量

- 文档是唯一真源；稳定对象ID、原子事务、修订检查、撤销与文件兼容不能因画布投影改变。
- 真实N/D/H/W/C与显示宽高、厚度、投影分开；未知、缺失或冲突不猜输出。
- v3计算与图稿分别拥有身份；更新保留手工排版、样式、路径和隐藏，同一计算可有多个表示。
- 计算模块与绘图组分工明确，派生信息与手工注解分清来源。
- `npm run check:architecture`保护依赖方向、SDK和组合根；不要通过类型导入、动态路径或挪文件绕过约束。
- 沿用TypeScript严格检查和Prettier；只为真实复用抽取共享职责，不堆积万能工具或另造框架。

## 字体与平台验证

字体栈只在`graphics/typography.ts`定义，由启动代码注入CSS并由画布/导出共用。优先使用本机Times New Roman与SimSun；Noto Sans SC是显式中文回退，保留原OFL许可。不将Windows字体复制为Web Font，也不为读取字体添加本地服务。

SVG默认保留系统字体引用。可选内嵌必须由用户下载点击触发本机字体授权，并检查字体嵌入权限；普通引用SVG和PNG不依赖此权限。PNG以当前字体栈的真实字形像素检查就绪，避免只凭Image.decode或document.fonts.check声称字体正确。Linux无目标字体时只验证回退；目标字体效果须在安装它们的Windows原生浏览器中验证，不能用Linux截图替代。

## 整理可分发源码包

应用版本在`package.json`和锁文件根包中保持一致，界面从包元数据读取；同步更新`docs/CHANGELOG.md`。工程格式版本与插件API版本独立管理。

```bash
npm run release:prepare -- --out ../release-0.3.0
```

目标父目录需已存在，目标为空且位于开发工程之外。工具按白名单复制源码、测试、配置、资源、许可、工程样例和必要文档，打印完整清单；不执行Git操作、不安装依赖，也不覆盖旧版本。检查实际输出清单、文档链接及运行/验证依赖，确认对应本版后再发布。

不提交依赖、构建、缓存、个人配置、凭据、测试追踪、AI提示词、效果图或过程记录。

入口：[架构](architecture.md) · [工程格式](project-format.md) · [扩展说明](plugin-development.md)。贡献采用[MIT](../LICENSE)，第三方材料保留原许可并更新[第三方说明](THIRD_PARTY_NOTICES.md)。
