import type { Params } from '../core/document/types.ts';
import type { TensorKind, TensorShape } from '../core/computation/types.ts';
import type { RuleResult } from '../core/computation/definitions.ts';
import { positive } from '../core/computation/rules.ts';
import { shapeAxes, spatialAxes, shapeDimension } from '../core/computation/catalog.ts';
const product = (values: number[]) => values.reduce((a, b) => a * b, 1);
const error = (diagnostics: string[]): RuleResult => ({
  state: 'error',
  steps: [],
  explanation: '输入规格或参数冲突。',
  diagnostics,
});
function requiredParameters(p: Params, keys: string[]): RuleResult | null {
  const missing = keys.filter((key) => p[key] === null || p[key] === undefined);
  const invalid = keys.filter(
    (key) => p[key] !== null && p[key] !== undefined && !positive(p[key]),
  );
  if (invalid.length) return error([`参数 ${invalid.join('、')} 必须是正整数。`]);
  if (missing.length)
    return {
      state: 'pending',
      steps: [],
      explanation: '等待参数配置。',
      diagnostics: [`待配置参数：${missing.join('、')}。`],
    };
  return null;
}
export function applyOperationRule(
  kind: Exclude<TensorKind, 'source' | 'result'>,
  p: Params,
  shapes: TensorShape[],
): RuleResult {
  const dimension = shapeDimension(shapes[0]),
    dimensions = shapeAxes(dimension),
    spatial = spatialAxes(dimension);
  if (shapes.some((shape) => shapeDimension(shape) !== dimension))
    return error(['输入张量秩不一致：2D（N/H/W/C）与 3D（N/D/H/W/C）不能直接合并。']);
  if ((kind.endsWith('2d') && dimension !== 2) || (kind.endsWith('3d') && dimension !== 3))
    return error([`${kind} 不能接收 ${dimension}D 张量，输入秩不一致。`]);
  if ((kind === 'relu' || kind === 'upsample') && p.dimension !== dimension)
    return error([`操作维度 ${String(p.dimension)}D 与输入 ${dimension}D 秩不一致。`]);
  const input = shapes[0],
    shape = { ...input },
    steps: string[] = [],
    diagnostics: string[] = [];
  let parameterCount = 0,
    explanation = '';
  if (kind === 'conv2d' || kind === 'conv3d' || kind === 'pool2d' || kind === 'pool3d') {
    const conv = kind.startsWith('conv');
    const required = [
      ...spatial.map((a) => `kernel${a}`),
      ...spatial.map((a) => `stride${a}`),
      ...(conv ? ['outChannels'] : []),
    ];
    const validation = requiredParameters(p, required);
    if (validation) return validation;
    if (!['same', 'valid'].includes(String(p.padding)) || (conv && typeof p.bias !== 'boolean'))
      return error(['填充方式必须为 Same 或 Valid，卷积偏置必须为布尔值。']);
    shape.C = conv ? Number(p.outChannels) : input.C;
    for (const axis of spatial) {
      const n = input[axis]!,
        k = Number(p[`kernel${axis}`]),
        s = Number(p[`stride${axis}`]);
      const size = p.padding === 'same' ? Math.ceil(n / s) : Math.floor((n - k) / s) + 1;
      shape[axis] = size;
      steps.push(
        `${axis}: ${p.padding === 'same' ? `ceil(${n} / ${s})` : `floor((${n} − ${k}) / ${s}) + 1`} = ${size}`,
      );
      if (p.padding === 'same') {
        const total = Math.max((size - 1) * s + k - n, 0),
          before = Math.floor(total / 2),
          after = total - before;
        steps.push(
          `${axis} 补边：前 ${before}，后 ${after}；floor((${n} + ${before} + ${after} − ${k}) / ${s}) + 1 = ${size}`,
        );
      }
      if (size <= 0)
        diagnostics.push(`${axis} 输入 ${n} 小于窗口 ${k}，Valid 输出为 ${size}，不是有效张量。`);
    }
    parameterCount = conv
      ? Number(p.outChannels) *
        (input.C! * product(spatial.map((a) => Number(p[`kernel${a}`]))) + (p.bias ? 1 : 0))
      : 0;
    if (conv)
      steps.push(
        `参数量: ${p.outChannels} × (${input.C} × ${spatial.map((a) => p[`kernel${a}`]).join(' × ')} + ${p.bias ? 1 : 0}) = ${parameterCount}`,
      );
    else steps.push('池化只聚合局部数值，没有可训练参数，参数量 = 0。');
    explanation = conv
      ? `每个输出通道用独立的 ${dimension}D 卷积核汇集所有输入通道。dilation = 1，groups = 1；${p.padding === 'same' ? 'Same 在每个空间轴补齐所需边界，输出取 ceil(输入 / 步幅)。' : 'Valid 不补边，输出取 floor((输入 − 卷积核) / 步幅) + 1。'}`
      : '每个通道分别对局部窗口取最大值，只改变空间尺寸，不改变通道数。';
  } else if (kind === 'relu') {
    steps.push('逐元素计算 max(0, x)，N、空间尺寸与 C 均不变；参数量 = 0。');
    explanation = 'ReLU 将负值置零，非负值保持不变，不改变张量形状。';
  } else if (kind === 'upsample') {
    const validation = requiredParameters(
      p,
      spatial.map((axis) => `scale${axis}`),
    );
    if (validation) return validation;
    for (const axis of spatial) {
      const scale = Number(p[`scale${axis}`]);
      shape[axis] = input[axis]! * scale;
      steps.push(`${axis}: ${input[axis]} × ${scale} = ${shape[axis]}`);
    }
    steps.push('N 与 C 保持不变；参数量 = 0。');
    explanation = '最近邻上采样按各空间轴的正整数倍率复制邻近输入值；不改变批量与通道。';
  } else {
    const axis = String(p.axis) as keyof TensorShape;
    if (kind === 'concat' && !dimensions.includes(axis))
      return error([
        `${dimension}D 张量不存在 ${axis} 轴；请选择 ${dimensions.join('、')} 作为拼接维度。`,
      ]);
    const check = dimensions.filter((d) => kind === 'add' || d !== axis);
    for (const d of check)
      if (shapes.some((s) => s[d] !== input[d]))
        diagnostics.push(
          `${d} 维度不兼容：${shapes.map((s) => s[d]).join(' 与 ')}；${kind === 'concat' ? `沿 ${axis} 拼接时其余维度必须一致` : '逐元素相加要求完整形状一致，不启用广播'}。`,
        );
    if (kind === 'concat') shape[axis] = shapes.reduce((n, s) => n + s[axis]!, 0);
    steps.push(
      ...(kind === 'concat'
        ? [
            `${axis}: ${shapes.map((s) => s[axis]).join(' + ')} = ${shape[axis]}`,
            `其余维度 ${check.join('、')} 保持一致。`,
          ]
        : [
            `${dimensions.join('、')} 全部一致，输出形状保持不变。`,
            '对应位置的数值逐元素相加；参数量 = 0。',
          ]),
    );
    explanation =
      kind === 'concat'
        ? '拼接保留各路数据，沿选定维度顺次排列，不做求和；参数量为 0。'
        : '将完整形状相同的张量按对应位置求和；不暗中广播、不改变形状。';
  }
  if (
    !Number.isSafeInteger(parameterCount) ||
    dimensions.some((d) => !Number.isSafeInteger(shape[d]))
  )
    diagnostics.push('计算结果超出可精确表示的整数范围。');
  return {
    state: diagnostics.length ? 'error' : 'ready',
    ...(diagnostics.length ? {} : { shape }),
    parameterCount: diagnostics.length ? undefined : parameterCount,
    steps,
    diagnostics,
    explanation,
  };
}
