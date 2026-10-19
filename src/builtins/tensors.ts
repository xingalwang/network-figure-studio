import { buildBlockGeometry } from '../graphics/block-geometry.ts';
import type { GeneratorDefinition, ParamField } from '../plugins/sdk.ts';
import type { NodeEntity, Params } from '../core/document/types.ts';

const integer = (
  key: string,
  label: string,
  nullable = true,
): Extract<ParamField, { type: 'number' }> => ({
  key,
  label,
  type: 'number',
  min: 1,
  max: 1000000,
  step: 1,
  nullable,
});
const appearanceFields: ParamField[] = [
  {
    key: 'drawWidth',
    label: '显示宽度 px',
    type: 'number',
    min: 24,
    max: 1000,
    section: 'appearance',
  },
  {
    key: 'drawHeight',
    label: '显示高度 px',
    type: 'number',
    min: 24,
    max: 1000,
    section: 'appearance',
  },
  { key: 'depth', label: '视觉厚度 px', type: 'number', min: 0, max: 200, section: 'appearance' },
  { key: 'angleDeg', label: '投影角度 °', type: 'number', min: 0, max: 80, section: 'appearance' },
  { key: 'fillColor', label: '块颜色', type: 'color', section: 'appearance' },
];
const appearanceDefaults: Params = {
  drawWidth: 112,
  drawHeight: 112,
  depth: 26,
  angleDeg: 30,
  fillColor: '#a9cad9',
};
const kernelFields = ['D', 'H', 'W'].map((a) => integer(`kernel${a}`, `卷积核 ${a}`));
const strideFields = ['D', 'H', 'W'].map((a) => integer(`stride${a}`, `步幅 ${a}`));
const paddingField: ParamField = {
  key: 'padding',
  label: '填充方式',
  type: 'enum',
  options: [
    { value: 'same', label: 'Same（保持／向上取整）' },
    { value: 'valid', label: 'Valid（无填充）' },
  ],
};
function definition(
  id: string,
  name: string,
  fields: ParamField[],
  defaults: Params,
  role: NonNullable<NodeEntity['semantic']>['role'],
): GeneratorDefinition {
  return {
    id,
    version: '1.0.0',
    paramSchemaVersion: 1,
    name,
    description:
      role === 'operation' ? '静态计算操作；输出由输入张量推导。' : '真实张量规格与视觉尺寸独立。',
    fields,
    defaults,
    generate(params) {
      const operation = role === 'operation',
        width = operation ? 52 : Number(params.drawWidth),
        height = operation ? 36 : Number(params.drawHeight);
      const geometry = buildBlockGeometry(
        { width, height },
        {
          mode: operation ? 'flat' : 'axonometric',
          depth: operation ? 0 : Number(params.depth),
          stackCount: 1,
          stackGap: 0,
          angleDeg: operation ? 0 : Number(params.angleDeg),
        },
        {
          fill: operation ? '#d4b5b2' : String(params.fillColor),
          stroke: '#637486',
          label: operation
            ? id === 'tensor.concat'
              ? 'Concat'
              : id === 'tensor.add'
                ? '+'
                : id.startsWith('tensor.conv')
                  ? 'Conv'
                  : id === 'tensor.relu'
                    ? 'ReLU'
                    : id === 'tensor.upsample'
                      ? 'Up'
                      : 'Pool'
            : '',
          textColor: '#263544',
        },
      );
      if (!geometry.ok) throw Error(geometry.error.message);
      const count =
        operation && ['tensor.concat', 'tensor.add'].includes(id) ? Number(params.inputCount) : 1;
      const ports: NodeEntity['ports'] = { out: { x: width, y: height / 2 } };
      if (role !== 'tensor-source')
        for (let i = 0; i < count; i++)
          ports[i === 0 ? 'in' : `in${i + 1}`] = { x: 0, y: (height * (i + 1)) / (count + 1) };
      const node: NodeEntity = {
        id: 'root',
        kind: 'node',
        parentId: null,
        name,
        semantic: { role },
        figureState: 'unplaced',
        size: { width, height },
        bounds: geometry.value.bounds,
        primitives: geometry.value.primitives,
        ports,
        presentation: { position: { x: 0, y: 0 }, compositionPosition: { x: 0, y: 0 } },
      };
      return { rootKey: 'root', entities: { root: node } };
    },
  };
}
export const tensorGenerators: GeneratorDefinition[] = [
  definition(
    'tensor.source2d',
    '2D 数据张量',
    [
      integer('N', '批量 N', false),
      integer('H', '高度 H'),
      integer('W', '宽度 W'),
      integer('C', '通道 C'),
      ...appearanceFields,
    ],
    { N: 1, H: null, W: null, C: 1, ...appearanceDefaults },
    'tensor-source',
  ),
  definition(
    'tensor.result2d',
    '2D 结果张量',
    appearanceFields,
    appearanceDefaults,
    'tensor-result',
  ),
  definition(
    'tensor.conv2d',
    'Conv2D',
    [
      integer('outChannels', '输出通道'),
      ...kernelFields.filter((f) => f.key !== 'kernelD'),
      ...strideFields.filter((f) => f.key !== 'strideD'),
      paddingField,
      { key: 'bias', label: '使用偏置', type: 'boolean' },
    ],
    {
      outChannels: 16,
      kernelH: 3,
      kernelW: 3,
      strideH: 1,
      strideW: 1,
      padding: 'same',
      bias: true,
    },
    'operation',
  ),
  definition(
    'tensor.pool2d',
    'MaxPool2D',
    [
      ...kernelFields
        .filter((f) => f.key !== 'kernelD')
        .map((f) => ({ ...f, label: f.label.replace('卷积核', '池化窗口') })),
      ...strideFields.filter((f) => f.key !== 'strideD'),
      paddingField,
    ],
    { kernelH: 2, kernelW: 2, strideH: 2, strideW: 2, padding: 'valid' },
    'operation',
  ),
  definition(
    'tensor.relu',
    'ReLU',
    [{ key: 'dimension', label: '空间维数', type: 'number', min: 2, max: 3, step: 1 }],
    { dimension: 3 },
    'operation',
  ),
  definition(
    'tensor.upsample',
    '最近邻上采样',
    [
      { key: 'dimension', label: '空间维数', type: 'number', min: 2, max: 3, step: 1 },
      ...['D', 'H', 'W'].map((a) => integer(`scale${a}`, `最近邻倍率 ${a}`)),
    ],
    { dimension: 3, scaleD: 2, scaleH: 2, scaleW: 2 },
    'operation',
  ),
  definition(
    'tensor.source3d',
    '3D 数据张量',
    [
      integer('N', '批量 N', false),
      integer('D', '深度 D'),
      integer('H', '高度 H'),
      integer('W', '宽度 W'),
      integer('C', '通道 C'),
      ...appearanceFields,
    ],
    { N: 1, D: null, H: null, W: null, C: 1, ...appearanceDefaults },
    'tensor-source',
  ),
  definition('tensor.result3d', '结果张量', appearanceFields, appearanceDefaults, 'tensor-result'),
  definition(
    'tensor.conv3d',
    'Conv3D',
    [
      integer('outChannels', '输出通道'),
      ...kernelFields,
      ...strideFields,
      paddingField,
      { key: 'bias', label: '使用偏置', type: 'boolean' },
    ],
    {
      outChannels: 16,
      kernelD: 3,
      kernelH: 3,
      kernelW: 3,
      strideD: 1,
      strideH: 1,
      strideW: 1,
      padding: 'same',
      bias: true,
    },
    'operation',
  ),
  definition(
    'tensor.pool3d',
    'MaxPool3D',
    [
      ...kernelFields.map((f) => ({ ...f, label: f.label.replace('卷积核', '池化窗口') })),
      ...strideFields,
      paddingField,
    ],
    { kernelD: 2, kernelH: 2, kernelW: 2, strideD: 2, strideH: 2, strideW: 2, padding: 'valid' },
    'operation',
  ),
  definition(
    'tensor.concat',
    'Concat',
    [
      {
        key: 'axis',
        label: '拼接维度',
        type: 'enum',
        options: ['N', 'D', 'H', 'W', 'C'].map((value) => ({ value, label: value })),
      },
      { ...integer('inputCount', '输入数', false), min: 2, max: 8 },
    ],
    { axis: 'C', inputCount: 2 },
    'operation',
  ),
  definition(
    'tensor.add',
    '逐元素相加',
    [{ ...integer('inputCount', '输入数', false), min: 2, max: 8 }],
    { inputCount: 2 },
    'operation',
  ),
];
