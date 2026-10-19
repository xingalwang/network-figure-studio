# Residual 示例插件

这个目录同时验证两种公开插件入口：`example.residual` 生成组件，`example.distribute-x` 调整画布布局。

组件默认为两层 Conv、平面 ReLU、Add 及跳跃连接，输入/输出各三片特征图。每个子层有稳定局部键和参数槽位，可单独切换 2D/立体或改变角度。父参数更新保留子层显式覆盖与手工位置、标签、路径。

等距命令至少选择三个同父空间、未锁定的非连线实体；按中心点等分并固定首尾，一次撤销恢复。

接入点：`src/builtins/registry.ts`。公开接口：`src/plugins/sdk.ts`。完整说明见 `docs/plugin-development.md`；集成测试见 `tests/unit/residual-plugin.test.ts`。
