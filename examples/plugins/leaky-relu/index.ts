import {
  buildBlockGeometry,
  math,
  tensorSpace,
  type ComputationDefinition,
  type GeneratorDefinition,
  type NodeEntity,
  type PluginDefinition,
} from '../../../src/plugins/sdk.ts';

export const leakyReluGenerator: GeneratorDefinition = {
  id: 'example.leaky-relu',
  version: '1.0.0',
  paramSchemaVersion: 1,
  name: 'LeakyReLU',
  description: '逐元素保留正值，并按 alpha 缩放负值。',
  fields: [
    {
      key: 'alpha',
      label: '负半轴斜率 alpha',
      type: 'number',
      min: 0,
      max: 1,
      step: 0.01,
      nullable: true,
    },
    { key: 'dimension', label: '空间维数', type: 'number', min: 2, max: 3, step: 1 },
  ],
  defaults: { alpha: 0.1, dimension: 3 },
  generate() {
    const geometry = buildBlockGeometry(
      { width: 52, height: 36 },
      { mode: 'flat', depth: 0, stackCount: 1, stackGap: 0, angleDeg: 0 },
      { fill: '#d4b5b2', stroke: '#637486', label: 'LeakyReLU', textColor: '#263544' },
    );
    if (!geometry.ok) throw Error(geometry.error.message);
    const node: NodeEntity = {
      id: 'root',
      parentId: null,
      kind: 'node',
      name: 'LeakyReLU',
      semantic: { role: 'operation' },
      figureState: 'unplaced',
      size: { width: 52, height: 36 },
      bounds: geometry.value.bounds,
      primitives: geometry.value.primitives,
      ports: { in: { x: 0, y: 18 }, out: { x: 52, y: 18 } },
      presentation: { position: { x: 0, y: 0 }, compositionPosition: { x: 0, y: 0 } },
    };
    return { rootKey: 'root', entities: { root: node } };
  },
};
export const leakyReluComputation: ComputationDefinition = {
  generatorId: leakyReluGenerator.id,
  version: '1.0.0',
  paramSchemaVersion: 1,
  role: 'operation',
  dimension: (p) => (p.dimension === 2 || p.dimension === 3 ? p.dimension : null),
  inputs: () => [{ id: 'in', role: 'tensor' }],
  outputPort: 'out',
  infer(p, shapes) {
    const base = {
      steps: [],
      explanation: '逐元素计算 max(x, alpha × x)，真实形状保持不变。',
      diagnostics: [],
    };
    if (p.alpha === null || p.alpha === undefined)
      return { ...base, state: 'pending', diagnostics: ['待配置 alpha。'] };
    if (typeof p.alpha !== 'number' || !Number.isFinite(p.alpha) || p.alpha < 0 || p.alpha > 1)
      return { ...base, state: 'error', diagnostics: ['alpha 必须为 0 至 1 的有限数值。'] };
    return {
      ...base,
      state: 'ready',
      shape: { ...shapes[0] },
      parameterCount: 0,
      formulas: [
        { label: '输入', expression: tensorSpace('X', shapes[0]) },
        {
          label: '运算',
          expression: math.join(
            [math.identifier('Y'), math.call('LeakyReLU', [math.identifier('X')])],
            '=',
          ),
        },
        {
          label: '逐元素激活',
          expression: math.join(
            [
              math.identifier('Y'),
              math.call('max', [
                math.identifier('X'),
                math.row(math.number(p.alpha), math.operator('·'), math.identifier('X')),
              ]),
            ],
            '=',
          ),
        },
        { label: '输出', expression: tensorSpace('Y', shapes[0]) },
        { label: '参数量', expression: math.join([math.identifier('P'), math.number(0)], '=') },
      ],
      steps: [`y = max(x, ${p.alpha} × x)；N、空间尺寸和 C 保持不变；参数量 = 0。`],
    };
  },
  operation: {
    label: 'LeakyReLU',
    hint: '带可配置负半轴斜率的激活',
    icon: 'activation',
    category: '运算',
    minInputs: 1,
    maxInputs: 1,
    dimensions: [2, 3],
    prepareParams: (p, dimension) => ({ ...p, dimension }),
    resultGeneratorId: (d) => `tensor.result${d}d`,
  },
  presentation: {
    glyph: 'relu',
    detail: (p) => `alpha = ${p.alpha ?? '?'}`,
    hiddenFields: ['dimension'],
  },
};
export const leakyReluPlugin: PluginDefinition = {
  manifest: {
    id: 'example.leaky-relu',
    name: 'LeakyReLU 计算示例',
    version: '1.0.0',
    apiVersion: 1,
    dependencies: { builtin: '1.0.0' },
  },
  generators: [leakyReluGenerator],
  computations: [leakyReluComputation],
};
