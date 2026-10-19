import { buildBlockGeometry } from '../graphics/block-geometry.ts';
import { validateParams } from '../plugins/registry.ts';
import type {
  BlockAppearance,
  NodeEntity,
  ParamField,
  Params,
  Primitive,
  PrimitiveDefinition,
  ProjectDocument,
} from '../plugins/sdk.ts';

type LayerSpec = {
  name: string;
  label: string;
  category: string;
  width: number;
  height: number;
  fill: string;
  mode: BlockAppearance['mode'];
  stackCount: number;
};
const layerSpecs = {
  feature: {
    name: '特征图',
    label: 'Feature',
    category: '输入与输出',
    width: 72,
    height: 104,
    fill: '#8ccccc',
    mode: 'axonometric',
    stackCount: 3,
  },
  input: {
    name: '输入特征',
    label: 'Input',
    category: '输入与输出',
    width: 72,
    height: 104,
    fill: '#8ccccc',
    mode: 'axonometric',
    stackCount: 3,
  },
  output: {
    name: '输出特征',
    label: 'Output',
    category: '输入与输出',
    width: 72,
    height: 104,
    fill: '#8ccccc',
    mode: 'axonometric',
    stackCount: 3,
  },
  conv: {
    name: '卷积层',
    label: 'Conv 3×3',
    category: '网络层',
    width: 64,
    height: 112,
    fill: '#adc5ec',
    mode: 'axonometric',
    stackCount: 1,
  },
  pool: {
    name: '池化层',
    label: 'MaxPool 2×2',
    category: '网络层',
    width: 56,
    height: 88,
    fill: '#c7b5df',
    mode: 'axonometric',
    stackCount: 1,
  },
  linear: {
    name: '全连接层',
    label: 'Linear',
    category: '网络层',
    width: 56,
    height: 160,
    fill: '#b7c5e5',
    mode: 'flat',
    stackCount: 1,
  },
  relu: {
    name: '激活层',
    label: 'ReLU',
    category: '网络层',
    width: 30,
    height: 112,
    fill: '#edd7ac',
    mode: 'flat',
    stackCount: 1,
  },
  norm: {
    name: '归一化层',
    label: 'BatchNorm',
    category: '网络层',
    width: 36,
    height: 112,
    fill: '#cad9bd',
    mode: 'flat',
    stackCount: 1,
  },
  concat: {
    name: '拼接',
    label: 'Concat',
    category: '变换与合并',
    width: 48,
    height: 112,
    fill: '#e3bdc9',
    mode: 'flat',
    stackCount: 1,
  },
  add: {
    name: '逐元素相加',
    label: '+',
    category: '变换与合并',
    width: 42,
    height: 42,
    fill: '#bcd9c5',
    mode: 'flat',
    stackCount: 1,
  },
  upsample: {
    name: '上采样',
    label: 'Upsample',
    category: '变换与合并',
    width: 64,
    height: 112,
    fill: '#b8d7df',
    mode: 'axonometric',
    stackCount: 1,
  },
  flatten: {
    name: '展平',
    label: 'Flatten',
    category: '变换与合并',
    width: 28,
    height: 128,
    fill: '#e5c8ad',
    mode: 'flat',
    stackCount: 1,
  },
} satisfies Record<string, LayerSpec>;

type LayerKind = keyof typeof layerSpecs;
const numberField = (
  key: string,
  label: string,
  min: number,
  max: number,
  section: 'structure' | 'appearance' = 'structure',
  step = 1,
): ParamField => ({ key, label, type: 'number', min, max, step, section });
const enumField = (key: string, label: string, options: [string, string][]): ParamField => ({
  key,
  label,
  section: 'structure',
  type: 'enum',
  options: options.map(([value, label]) => ({ value, label })),
});
const appearanceFields: ParamField[] = [
  numberField('drawWidth', '图形宽度', 16, 800, 'appearance'),
  numberField('drawHeight', '图形高度', 16, 800, 'appearance'),
  {
    key: 'mode',
    label: '表现方式',
    section: 'appearance',
    type: 'enum',
    options: [
      { value: 'flat', label: '2D 平面' },
      { value: 'axonometric', label: '3D 立体' },
    ],
  },
  numberField('depth', '厚度', 0, 80, 'appearance'),
  numberField('stackCount', '叠层片数', 1, 16, 'appearance'),
  numberField('stackGap', '叠层偏移', 0, 24, 'appearance'),
  numberField('angleDeg', '投影角度', 0, 90, 'appearance'),
  { key: 'fillColor', label: '填色', section: 'appearance', type: 'color' },
  { key: 'borderColor', label: '边框颜色', section: 'appearance', type: 'color' },
  { key: 'textColor', label: '文字颜色', section: 'appearance', type: 'color' },
  numberField('strokeWidth', '边框宽度', 0, 12, 'appearance', 0.25),
  numberField('opacity', '不透明度', 0, 1, 'appearance', 0.05),
];
const activations: [string, string][] = [
  ['relu', 'ReLU'],
  ['gelu', 'GELU'],
  ['sigmoid', 'Sigmoid'],
  ['tanh', 'Tanh'],
  ['softmax', 'Softmax'],
  ['leaky-relu', 'Leaky ReLU'],
];
const normalizations: [string, string][] = [
  ['batch', 'BatchNorm'],
  ['layer', 'LayerNorm'],
  ['instance', 'InstanceNorm'],
  ['group', 'GroupNorm'],
];

function structure(kind: LayerKind): { fields: ParamField[]; defaults: Params } {
  const fields: ParamField[] = [
    { key: 'label', label: '标签', section: 'structure', type: 'text' },
    numberField('channels', '通道数', 1, 8192),
  ];
  const defaults: Params = { channels: 64 };
  if (
    [
      'feature',
      'input',
      'output',
      'conv',
      'pool',
      'norm',
      'concat',
      'upsample',
      'flatten',
    ].includes(kind)
  ) {
    fields.push(
      numberField('tensorWidth', '特征图宽度', 1, 65536),
      numberField('tensorHeight', '特征图高度', 1, 65536),
      { key: 'showDimensions', label: '显示张量尺寸', section: 'structure', type: 'boolean' },
    );
    Object.assign(defaults, { tensorWidth: 32, tensorHeight: 32, showDimensions: false });
  }
  if (kind === 'conv' || kind === 'pool') {
    fields.push(numberField('kernelSize', '核大小', 1, 31), numberField('stride', '步幅', 1, 16));
    Object.assign(defaults, {
      kernelSize: kind === 'conv' ? 3 : 2,
      stride: kind === 'conv' ? 1 : 2,
    });
  }
  if (kind === 'conv') {
    fields.push(numberField('padding', '填充', 0, 30));
    defaults.padding = 1;
  }
  if (kind === 'pool') {
    fields.push(
      enumField('poolType', '池化方式', [
        ['max', '最大池化'],
        ['avg', '平均池化'],
      ]),
    );
    defaults.poolType = 'max';
  }
  if (kind === 'linear') {
    fields.push(
      numberField('units', '神经元数量', 1, 65536),
      numberField('displayCount', '显示神经元数', 1, 16),
    );
    Object.assign(defaults, { units: 128, displayCount: 6 });
  }
  if (kind === 'relu') {
    fields.push(enumField('activation', '激活函数', activations));
    defaults.activation = 'relu';
  }
  if (kind === 'norm') {
    fields.push(
      enumField('normType', '归一化方式', normalizations),
      numberField('groups', '分组数', 1, 8192),
    );
    Object.assign(defaults, { normType: 'batch', groups: 8 });
  }
  if (kind === 'concat' || kind === 'add') {
    fields.push(numberField('inputCount', '输入数', 2, 8));
    defaults.inputCount = 2;
  }
  if (kind === 'concat') {
    fields.push(
      enumField('axis', '拼接维度', [
        ['channels', '通道'],
        ['width', '宽度'],
        ['height', '高度'],
      ]),
    );
    defaults.axis = 'channels';
  }
  if (kind === 'upsample') {
    fields.push(
      numberField('scaleFactor', '放大倍率', 1, 16),
      enumField('interpolation', '插值方式', [
        ['nearest', '最近邻'],
        ['bilinear', '双线性'],
        ['bicubic', '双三次'],
      ]),
    );
    Object.assign(defaults, { scaleFactor: 2, interpolation: 'nearest' });
  }
  return { fields, defaults };
}

const definitions = new Map<LayerKind, { fields: ParamField[]; defaults: Params }>(
  (Object.keys(layerSpecs) as LayerKind[]).map((kind) => {
    const spec = layerSpecs[kind],
      specific = structure(kind);
    return [
      kind,
      {
        fields: [...specific.fields, ...appearanceFields],
        defaults: {
          ...specific.defaults,
          label: spec.label,
          drawWidth: spec.width,
          drawHeight: spec.height,
          mode: spec.mode,
          depth: 24,
          stackCount: spec.stackCount,
          stackGap: 6,
          angleDeg: 30,
          fillColor: spec.fill,
          borderColor: '#374151',
          textColor: '#263238',
          strokeWidth: 1,
          opacity: 1,
        } satisfies Params,
      },
    ];
  }),
);

function layerLabel(kind: LayerKind, p: Params): string {
  const automatic = p.label === layerSpecs[kind].label;
  let title = String(p.label);
  if (automatic) {
    if (kind === 'conv') title = `Conv ${p.kernelSize}×${p.kernelSize}`;
    if (kind === 'pool')
      title = `${p.poolType === 'avg' ? 'Avg' : 'Max'}Pool ${p.kernelSize}×${p.kernelSize}`;
    if (kind === 'relu') title = activations.find(([key]) => key === p.activation)![1];
    if (kind === 'norm') title = normalizations.find(([key]) => key === p.normType)![1];
  }
  const lines = [title];
  if (['feature', 'input', 'output', 'conv'].includes(kind)) lines.push(`${p.channels} ch`);
  if (kind === 'conv' && (p.stride !== 1 || p.padding !== 1))
    lines.push(`s${p.stride} · p${p.padding}`);
  if (kind === 'pool') lines.push(`s${p.stride}`);
  if (kind === 'linear') lines.push(`${p.units} units`);
  if (kind === 'norm' && p.normType === 'group') lines.push(`${p.groups} groups`);
  if (kind === 'concat') lines.push(`${p.inputCount} inputs`, `axis ${p.axis}`);
  if (kind === 'upsample') lines.push(`×${p.scaleFactor}`, String(p.interpolation));
  if (kind === 'flatten')
    lines.push(`${Number(p.tensorWidth) * Number(p.tensorHeight) * Number(p.channels)} values`);
  if (p.showDimensions) lines.push(`${p.tensorWidth}×${p.tensorHeight}×${p.channels}`);
  return lines.join('\n');
}

function boundsOf(primitives: Primitive[]) {
  const points = primitives.flatMap((p) =>
    p.kind === 'polygon'
      ? p.points
      : [
          { x: p.x, y: p.y },
          { x: p.x + p.width, y: p.y + p.height },
        ],
  );
  const x = Math.min(...points.map((p) => p.x)),
    y = Math.min(...points.map((p) => p.y));
  return {
    x,
    y,
    width: Math.max(...points.map((p) => p.x)) - x,
    height: Math.max(...points.map((p) => p.y)) - y,
  };
}

/** A single node is a native vector primitive, never a composite-owned network. */
export function createLayerNode(
  kind: LayerKind,
  params: Params,
  theme: ProjectDocument['theme'],
): NodeEntity {
  const definition = definitions.get(kind)!;
  const merged: Params = {
    ...definition.defaults,
    fillColor: theme.nodeColor ?? definition.defaults.fillColor,
    borderColor: theme.borderColor ?? theme.lineColor,
    textColor: theme.textColor ?? definition.defaults.textColor,
    strokeWidth: theme.lineWidth ?? definition.defaults.strokeWidth,
    ...params,
  };
  const valid = validateParams(definition.fields, merged);
  if (!valid.ok) throw new Error(valid.error.message);
  const p = valid.value;
  const appearance: BlockAppearance = {
    mode: p.mode as BlockAppearance['mode'],
    depth: Number(p.depth),
    stackCount: Number(p.stackCount),
    stackGap: Number(p.stackGap),
    angleDeg: Number(p.angleDeg),
  };
  const size = { width: Number(p.drawWidth), height: Number(p.drawHeight) };
  const style = {
    fill: String(p.fillColor),
    stroke: String(p.borderColor),
    textColor: String(p.textColor),
    strokeWidth: Number(p.strokeWidth),
    opacity: Number(p.opacity),
  };
  const geometry = buildBlockGeometry(size, appearance, {
    ...style,
    label: layerLabel(kind, p),
    shape: kind === 'add' ? 'ellipse' : 'rect',
  });
  if (!geometry.ok) throw new Error(geometry.error.message);
  let primitives = geometry.value.primitives;
  if (kind === 'linear') {
    const count = Math.min(Number(p.units), Number(p.displayCount));
    const truncated = Number(p.units) > count;
    const rows = count + Number(truncated);
    const diameter = Math.min(size.width, size.height / (rows * 1.5 - 0.5));
    const ellipsisRow = Math.floor(count / 2);
    const neurons: Primitive[] = [];
    for (let i = 0; i < rows; i++) {
      const y = i * diameter * 1.5;
      if (truncated && i === ellipsisRow) {
        neurons.push({
          kind: 'text',
          text: '⋮',
          x: 0,
          y,
          width: size.width,
          height: diameter,
          fontSize: 13,
          color: style.textColor,
          opacity: style.opacity,
        });
        continue;
      }
      const neuron = buildBlockGeometry({ width: diameter, height: diameter }, appearance, {
        ...style,
        shape: 'ellipse',
      });
      if (!neuron.ok) throw new Error(neuron.error.message);
      const x = (size.width - diameter) / 2;
      neurons.push(
        ...neuron.value.primitives.map(
          (primitive): Primitive =>
            primitive.kind === 'polygon'
              ? {
                  ...primitive,
                  points: primitive.points.map((point) => ({ x: point.x + x, y: point.y + y })),
                }
              : { ...primitive, x: primitive.x + x, y: primitive.y + y },
        ),
      );
    }
    primitives = [...neurons, ...primitives.filter((primitive) => primitive.kind === 'text')];
  }
  const ports: NodeEntity['ports'] = {};
  if (kind === 'concat' || kind === 'add') {
    const count = Number(p.inputCount);
    for (let i = 0; i < count; i++) {
      ports[i === 0 ? 'in' : `in${i + 1}`] =
        kind === 'add'
          ? i === 0
            ? { x: 0, y: size.height / 2 }
            : {
                x: (size.width / 2) * (1 - Math.cos((Math.PI * i) / count)),
                y: (size.height / 2) * (1 + Math.sin((Math.PI * i) / count)),
              }
          : { x: 0, y: size.height * ((i + 1) / (count + 1)) };
    }
    ports.out = { x: size.width, y: size.height / 2 };
    if (kind === 'add') ports.skip = { x: size.width / 2, y: 0 };
  } else Object.assign(ports, geometry.value.ports);
  return {
    id: 'root',
    kind: 'node',
    parentId: null,
    name: String(p.label) || layerSpecs[kind].name,
    size,
    bounds: kind === 'linear' ? boundsOf(primitives) : geometry.value.bounds,
    primitives,
    ports,
    presentation: { position: { x: 0, y: 0 } },
  };
}

export const builtinPrimitives: PrimitiveDefinition[] = (
  Object.keys(layerSpecs) as LayerKind[]
).map((kind) => {
  const spec = layerSpecs[kind],
    definition = definitions.get(kind)!;
  return {
    id: `builtin.${kind}`,
    version: '1.0.0',
    paramSchemaVersion: 1,
    name: spec.name,
    category: spec.category,
    icon: kind,
    keywords: [kind, spec.label, spec.name],
    description: '自由连接的独立网络基元；张量参数、图形尺寸、投影与配色可分别调整。',
    defaults: structuredClone(definition.defaults),
    fields: structuredClone(definition.fields),
    generate(params, theme) {
      return { rootKey: 'root', entities: { root: createLayerNode(kind, params, theme) } };
    },
  };
});

/** Retained for existing generated-composite plugins and saved generator identities. */
export const layerGenerators = builtinPrimitives;
