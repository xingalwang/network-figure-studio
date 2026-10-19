# 参与开发

使用 `.node-version` 指定的Node.js版本，运行 `npm ci` 安装锁定依赖。

提交前运行：

```bash
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

浏览器测试使用Chromium，可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指定路径。不要停止其他人正在使用的本地服务来腾出测试端口。

## 改动约定

- 文档是唯一真源，所有修改通过编辑事务提交，保留对象ID、撤销与文件兼容。
- 真实张量尺寸与显示几何分开，未知或冲突不猜输出。
- 生成与绘图共用文档，更新不覆盖手工排版、样式、路径或隐藏状态。
- 缺陷补复现测试；功能覆盖主要交互、失败路径与保存重开。界面改动检查实际渲染。
- 不提交依赖、构建、缓存、个人配置、测试追踪、AI提示词、效果图或开发过程记录。

入口：[架构](docs/architecture.md)、[工程格式](docs/project-format.md)、[插件接口](docs/plugin-development.md)。贡献采用 [MIT](LICENSE)，引入第三方材料时保留原许可并更新 [第三方说明](THIRD_PARTY_NOTICES.md)。
