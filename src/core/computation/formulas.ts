import { shapeAxes, shapeDimension } from './catalog.ts';
import type { MathExpression, TensorShape } from './types.ts';

const identifier = (
  text: string,
  variant?: Extract<MathExpression, { kind: 'identifier' }>['variant'],
): MathExpression => ({
  kind: 'identifier',
  text,
  variant: variant ?? ([...text].length === 1 ? 'italic' : 'normal'),
});
const number = (value: number): MathExpression => ({ kind: 'number', value });
const operator = (text: string): MathExpression => ({ kind: 'operator', text });
const row = (...items: MathExpression[]): MathExpression => ({ kind: 'row', items });
const join = (items: MathExpression[], separator: string): MathExpression =>
  row(...items.flatMap((item, index) => (index ? [operator(separator), item] : [item])));
const fenced = (expression: MathExpression, left = '(', right = ')'): MathExpression => ({
  kind: 'fenced',
  expression,
  left,
  right,
});
/** Value-only constructors shared by builtins and trusted build-time extensions. */
export const math = {
  identifier,
  number,
  operator,
  row,
  join,
  fenced,
  subscript: (base: MathExpression, script: MathExpression): MathExpression => ({
    kind: 'subscript',
    base,
    script,
  }),
  superscript: (base: MathExpression, script: MathExpression): MathExpression => ({
    kind: 'superscript',
    base,
    script,
  }),
  fraction: (numerator: MathExpression, denominator: MathExpression): MathExpression => ({
    kind: 'fraction',
    numerator,
    denominator,
  }),
  call: (name: string | MathExpression, args: MathExpression[]): MathExpression =>
    row(typeof name === 'string' ? identifier(name, 'normal') : name, fenced(join(args, ','))),
};

export function tensorSpace(symbol: string | MathExpression, shape: TensorShape): MathExpression {
  return row(
    typeof symbol === 'string' ? identifier(symbol) : symbol,
    operator('∈'),
    math.superscript(
      identifier('ℝ', 'normal'),
      join(
        shapeAxes(shapeDimension(shape)).map((axis) =>
          shape[axis] === null || shape[axis] === undefined ? operator('?') : number(shape[axis]!),
        ),
        '×',
      ),
    ),
  );
}

/** Reject malformed extension notation before it can reach a renderer. */
export function isMathExpression(value: unknown, depth = 0): value is MathExpression {
  if (!value || typeof value !== 'object' || depth > 32) return false;
  const expression = value as MathExpression;
  const nested = (item: unknown) => isMathExpression(item, depth + 1);
  switch (expression.kind) {
    case 'identifier':
      return (
        typeof expression.text === 'string' &&
        ['normal', 'italic', 'double-struck'].includes(expression.variant)
      );
    case 'number':
      return typeof expression.value === 'number' && Number.isFinite(expression.value);
    case 'operator':
      return typeof expression.text === 'string';
    case 'row':
      return (
        Array.isArray(expression.items) &&
        expression.items.length <= 128 &&
        expression.items.every(nested)
      );
    case 'subscript':
    case 'superscript':
      return nested(expression.base) && nested(expression.script);
    case 'fraction':
      return nested(expression.numerator) && nested(expression.denominator);
    case 'fenced':
      return (
        typeof expression.left === 'string' &&
        typeof expression.right === 'string' &&
        nested(expression.expression)
      );
    default:
      return false;
  }
}
