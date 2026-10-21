import { math as m, tensorSpace } from '../core/computation/formulas.ts';
import { shapeAxes, shapeDimension, spatialAxes } from '../core/computation/catalog.ts';
import type { FormulaLine, MathExpression, TensorShape } from '../core/computation/types.ts';
import type { Params } from '../core/document/types.ts';

const variable = m.identifier,
  n = m.number,
  op = m.operator;
const equals = (...items: MathExpression[]) => m.join(items, '=');
const indexed = (name: string, index: string | number) =>
  m.subscript(variable(name), typeof index === 'number' ? n(index) : variable(index));
const line = (label: string, expression: MathExpression, description?: string): FormulaLine => ({
  label,
  expression,
  ...(description ? { description } : {}),
});
const axesText = (shape: TensorShape) => `轴顺序：${shapeAxes(shapeDimension(shape)).join(' × ')}`;
export const tensorFormula = (symbol: string, shape: TensorShape): FormulaLine =>
  line('张量空间', tensorSpace(symbol, shape), axesText(shape));

/** Describes validated inference results; output sizes and parameter counts are never recomputed here. */
export function operationFormulas(
  kind: string,
  p: Readonly<Params>,
  inputs: readonly TensorShape[],
  output: TensorShape,
  parameterCount: number,
): FormulaLine[] {
  const dimension = shapeDimension(output),
    spatial = spatialAxes(dimension);
  const x = inputs.map((_, index) =>
    inputs.length === 1 ? variable('X') : indexed('X', index + 1),
  );
  let operation: MathExpression;
  if (kind.startsWith('conv') || kind.startsWith('pool')) {
    const name = m.subscript(
      variable(kind.startsWith('conv') ? 'Conv' : 'MaxPool', 'normal'),
      variable(`${dimension}D`, 'normal'),
    );
    operation = m.call(name, x);
  } else if (kind === 'concat')
    operation = m.call(m.subscript(variable('Concat', 'normal'), variable(String(p.axis))), x);
  else if (kind === 'add') operation = m.call('Add', x);
  else if (kind === 'relu') operation = m.call('ReLU', x);
  else
    operation = m.call(
      m.subscript(variable('Upsample', 'normal'), variable('nearest', 'normal')),
      x,
    );
  const formulas: FormulaLine[] = [
    ...inputs.map((shape, index) =>
      line(
        inputs.length === 1 ? '输入' : `输入 ${index + 1}`,
        tensorSpace(x[index], shape),
        axesText(shape),
      ),
    ),
    line('运算', equals(variable('Y'), operation)),
    line('输出', tensorSpace('Y', output), axesText(output)),
  ];
  if (kind.startsWith('conv') || kind.startsWith('pool')) {
    formulas.push(
      line(
        '窗口与步幅',
        m.row(
          variable('k'),
          op('='),
          m.fenced(
            m.join(
              spatial.map((axis) => n(Number(p[`kernel${axis}`]))),
              ',',
            ),
          ),
          op(','),
          variable('s'),
          op('='),
          m.fenced(
            m.join(
              spatial.map((axis) => n(Number(p[`stride${axis}`]))),
              ',',
            ),
          ),
        ),
        `空间轴：${spatial.join(' × ')}；${p.padding === 'same' ? 'Same' : 'Valid'} 填充。`,
      ),
    );
    for (const axis of spatial) {
      const input = n(inputs[0][axis]!),
        stride = n(Number(p[`stride${axis}`])),
        kernel = n(Number(p[`kernel${axis}`]));
      const expression =
        p.padding === 'same'
          ? m.fenced(m.fraction(input, stride), '⌈', '⌉')
          : m.row(
              m.fenced(m.fraction(m.row(input, op('−'), kernel), stride), '⌊', '⌋'),
              op('+'),
              n(1),
            );
      formulas.push(
        line(`${axis} 轴尺寸`, equals(indexed(axis, 'out'), expression, n(output[axis]!))),
      );
    }
  } else if (kind === 'upsample') {
    for (const axis of spatial)
      formulas.push(
        line(
          `${axis} 轴尺寸`,
          equals(
            indexed(axis, 'out'),
            m.row(n(inputs[0][axis]!), op('×'), n(Number(p[`scale${axis}`]))),
            n(output[axis]!),
          ),
        ),
      );
  } else if (kind === 'concat') {
    const axis = String(p.axis) as keyof TensorShape;
    formulas.push(
      line(
        `${axis} 轴尺寸`,
        equals(
          indexed(axis, 'out'),
          m.join(
            inputs.map((shape) => n(shape[axis]!)),
            '+',
          ),
          n(output[axis]!),
        ),
      ),
    );
  } else if (kind === 'add')
    formulas.push(line('逐元素相加', equals(variable('Y'), m.join(x, '+'))));
  else if (kind === 'relu')
    formulas.push(line('逐元素激活', equals(variable('Y'), m.call('max', [n(0), x[0]]))));
  if (kind.startsWith('conv')) {
    const kernels = spatial.map((axis) => indexed('k', axis));
    const symbolic = m.row(
      indexed('C', 'out'),
      m.fenced(m.row(indexed('C', 'in'), op('·'), m.join(kernels, '·'), op('+'), variable('b'))),
    );
    const substituted = m.row(
      n(output.C!),
      m.fenced(
        m.row(
          n(inputs[0].C!),
          op('×'),
          m.join(
            spatial.map((axis) => n(Number(p[`kernel${axis}`]))),
            '×',
          ),
          op('+'),
          n(p.bias ? 1 : 0),
        ),
      ),
    );
    formulas.push(
      line(
        '参数公式',
        equals(variable('P'), symbolic),
        'b 为每个输出通道的偏置项：启用为 1，关闭为 0；dilation = 1，groups = 1。',
      ),
    );
    formulas.push(line('参数代入', equals(variable('P'), substituted, n(parameterCount))));
  } else formulas.push(line('参数量', equals(variable('P'), n(parameterCount))));
  return formulas;
}
