# LeakyReLU 静态计算扩展示例

本示例在一个`index.ts`中声明生成器、计算定义和插件，只从`src/plugins/sdk.ts`取得宿主能力；它演示0.2.0的可信构建期算子入口，不执行真实模型。

## 接入位置

- `leakyReluGenerator`定义`alpha`、空间维数、节点图元和稳定`in`/`out`端口。
- `leakyReluComputation`声明相同生成器版本和参数格式，给出输入/输出、维数、纯规则、诊断与操作发现元数据。
- `leakyReluPlugin`把两者放入`generators`和`computations`，清单保持`apiVersion: 1`，依赖内置结果张量定义`builtin@1.0.0`。
- `src/builtins/registry.ts`已注册本插件。类似新算子主要修改自己的定义与注册入口，无需修改工程编解码或画布核心。

UI从注册表发现LeakyReLU，复用参数表与诊断；创建服务一次加入操作、结果和数据流，一次撤销可全部移除。`presentation.glyph: 'relu'`复用激活字形，标签仍为LeakyReLU，详情显示alpha。

## 参数与结果

`alpha`范围为0–1，默认0.1，允许`null`表示待配置。规则为`y = max(x, alpha × x)`，2D/3D形状与输入一致，学习参数量为0。缺alpha返回`pending`；非法值返回`error`，下游不沿用旧成功形状。生成器版本为`1.0.0`，参数格式为1；未知版本不使用本规则。

宿主显式使用`registry.computations`进行分析、可用操作发现、画布投影和SVG/PNG导出；空注册表将对象标为`unsupported`。示例规则接收参数和形状副本，不拥有store或画布。

## 相关验证

在工程目录按需要运行：

```bash
npx vitest run tests/unit/computation-extensions.test.ts
npx playwright test tests/e2e/architecture-foundation.spec.ts
npm run check:architecture
```

验证注册发现、参数回改、形状/诊断传播、规则版本、空注册表、创建撤销和实际浏览器导出。通用开发入口见[扩展说明](../../../docs/plugin-development.md)，工程合同见[格式说明](../../../docs/project-format.md)。

所有扩展都随可信源码构建；没有在线第三方代码安装、安全沙箱或训练能力。
