import type { ComputationDefinition, RuleResult, TensorShape } from '../core/computation/index.ts';
import type { Params } from '../core/document/types.ts';
import { shapeAxes } from '../core/computation/catalog.ts';
import { full, positive } from '../core/computation/rules.ts';
import { applyOperationRule } from './computation-rules.ts';

const result = (
  state: RuleResult['state'],
  explanation: string,
  diagnostics: string[] = [],
): RuleResult => ({ state, explanation, diagnostics, steps: [] });
function sourceRule(dimension: 2 | 3, p: Readonly<Params>): RuleResult {
  const axes = shapeAxes(dimension);
  const shape = Object.fromEntries(
    axes.map((a) => [a, positive(p[a]) ? p[a] : null]),
  ) as TensorShape;
  const invalid = axes.filter((a) => p[a] !== null && p[a] !== undefined && !positive(p[a]));
  const value = result(
    invalid.length ? 'error' : full(shape) ? 'ready' : 'pending',
    '源张量声明真实数据规格；显示大小与厚度不参与计算。',
    invalid.map((a) => `${a} 必须是正整数或待配置。`),
  );
  if (!invalid.length) value.shape = shape;
  value.parameterCount = 0;
  value.steps = [
    `张量按 ${axes.join(' × ')} 表示：${axes.map((a) => shape[a] ?? '?').join(' × ')}`,
  ];
  if (value.state === 'pending')
    value.diagnostics.push(`待配置：${axes.filter((a) => shape[a] === null).join('、')}。`);
  return value;
}
function mergeValidation(p: Readonly<Params>): RuleResult | null {
  if (positive(p.inputCount) && p.inputCount >= 2 && p.inputCount <= 8) return null;
  const missing = p.inputCount === null || p.inputCount === undefined;
  return result(missing ? 'pending' : 'error', '合并需要明确的输入数。', [
    missing ? '待配置合并输入数。' : '合并输入数必须为 2 至 8 的整数。',
  ]);
}
function detail(kind: string, params: Readonly<Params>): string {
  const dimension = kind.endsWith('2d') || params.dimension === 2 ? 2 : 3;
  const axes = dimension === 2 ? ['H', 'W'] : ['D', 'H', 'W'];
  if (kind === 'upsample') return `×${axes.map((a) => params[`scale${a}`] ?? '?').join('×')}`;
  if (!kind.startsWith('conv') && !kind.startsWith('pool')) return '';
  const values = (prefix: string, power: boolean) => {
    const all = axes.map((a) => params[`${prefix}${a}`]);
    return all.every((v) => typeof v === 'number') && new Set(all).size === 1
      ? `${all[0]}${power ? (dimension === 2 ? '²' : '³') : ''}`
      : all.map((v) => v ?? '?').join('×');
  };
  return `k${values('kernel', true)} · s${values('stride', false)}`;
}

const sources: ComputationDefinition[] = ([2, 3] as const).flatMap((dimension) => [
  {
    generatorId: `tensor.source${dimension}d`,
    version: '1.0.0',
    paramSchemaVersion: 1,
    role: 'tensor-source' as const,
    kind: 'source',
    dimension: () => dimension,
    inputs: () => [],
    outputPort: 'out',
    infer: (p: Readonly<Params>) => sourceRule(dimension, p),
    presentation: {
      glyph: 'tensor',
      fieldGroups: [
        {
          keys: dimension === 2 ? ['H', 'W'] : ['D', 'H', 'W'],
          title: dimension === 2 ? '空间尺寸 · H × W' : '空间尺寸 · D × H × W',
        },
      ],
    },
  },
  {
    generatorId: `tensor.result${dimension}d`,
    version: '1.0.0',
    paramSchemaVersion: 1,
    role: 'tensor-result' as const,
    kind: 'result',
    dimension: () => dimension,
    inputs: () => [{ id: 'in', role: 'operation' as const }],
    outputPort: 'out',
    infer: (_p: Readonly<Params>, shapes: readonly TensorShape[]) => ({
      ...result('ready', '此块是产生操作的输出，真实规格由上游推导，不能单独填写。'),
      shape: structuredClone(shapes[0]),
      parameterCount: 0,
    }),
  },
]);
const operations = [
  ['conv2d', '卷积', '卷积与特征提取', 'convolution'],
  ['pool2d', '池化', '窗口聚合与下采样', 'pool'],
  ['conv3d', '卷积', '卷积与特征提取', 'convolution'],
  ['pool3d', '池化', '窗口聚合与下采样', 'pool'],
  ['relu', '激活', '逐元素激活 · 形状不变', 'activation'],
  ['upsample', '上采样', '按空间轴倍率扩展', 'upsample'],
  ['concat', '拼接', '沿选定轴保留各路数据', 'concat'],
  ['add', '相加', '完整形状一致，不启用广播', 'add'],
].map(([kind, label, hint, icon]): ComputationDefinition => {
  const merge = kind === 'concat' || kind === 'add';
  const dimension = kind.endsWith('2d') ? 2 : kind.endsWith('3d') ? 3 : null;
  return {
    generatorId: `tensor.${kind}`,
    kind,
    version: '1.0.0',
    paramSchemaVersion: 1,
    role: 'operation',
    dimension: (p) => dimension ?? (p.dimension === 2 || p.dimension === 3 ? p.dimension : null),
    inputs: (p) =>
      Array.from({ length: merge ? Number(p.inputCount) : 1 }, (_, i) => ({
        id: i === 0 ? 'in' : `in${i + 1}`,
        role: 'tensor',
      })),
    outputPort: 'out',
    validateParameters: merge ? mergeValidation : undefined,
    infer: (p, shapes) => applyOperationRule(kind, { ...p }, [...shapes]),
    operation: {
      label,
      hint,
      icon,
      category: merge ? '合并' : '运算',
      minInputs: merge ? 2 : 1,
      maxInputs: merge ? 8 : 1,
      dimensions: dimension ? [dimension] : [2, 3],
      prepareParams: (p, d, count) => ({
        ...p,
        ...(['relu', 'upsample'].includes(kind) ? { dimension: d } : {}),
        ...(merge ? { inputCount: count } : {}),
      }),
      resultGeneratorId: (d) => `tensor.result${d}d`,
    },
    presentation: {
      label: (p) =>
        kind.startsWith('conv')
          ? kind === 'conv2d'
            ? 'Conv2D'
            : 'Conv3D'
          : kind.startsWith('pool')
            ? kind === 'pool2d'
              ? 'Pool2D'
              : 'Pool3D'
            : kind === 'relu'
              ? 'ReLU'
              : kind === 'upsample'
                ? 'Upsample'
                : kind === 'concat'
                  ? `Concat · ${String(p.axis)}`
                  : 'Add',
      glyph: kind,
      detail: (p) => detail(kind, p),
      hiddenFields: ['dimension', 'inputCount'],
      fieldDimensions: { scaleD: 3 },
      fieldGroups: [
        {
          keys: dimension === 2 ? ['kernelH', 'kernelW'] : ['kernelD', 'kernelH', 'kernelW'],
          title: kind.startsWith('pool') ? '池化窗口' : '卷积核',
        },
        {
          keys: dimension === 2 ? ['strideH', 'strideW'] : ['strideD', 'strideH', 'strideW'],
          title: '步幅',
        },
      ],
    },
  };
});
export const builtinComputations: ComputationDefinition[] = [...sources, ...operations];
