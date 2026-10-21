import { createElement, type ReactNode } from 'react';
import type { MathExpression } from '../../core/computation/types.ts';
import './calculation-formulas.css';

/** Native MathML consumes notation values only; it does not parse HTML or evaluate expressions. */
function expressionNode(expression: MathExpression, key = 'expression'): ReactNode {
  const node = (name: string, children: ReactNode[], attributes = {}) =>
    createElement(name, { key, ...attributes }, ...children);
  switch (expression.kind) {
    case 'identifier':
      return node('mi', [expression.text], {
        mathvariant: expression.variant === 'double-struck' ? 'double-struck' : 'normal',
        style: { fontStyle: expression.variant === 'italic' ? 'italic' : 'normal' },
      });
    case 'number':
      return node('mn', [String(expression.value)]);
    case 'operator':
      return node('mo', [expression.text]);
    case 'row':
      return node(
        'mrow',
        expression.items.map((item, index) => expressionNode(item, `${key}-${index}`)),
      );
    case 'subscript':
    case 'superscript':
      return node(expression.kind === 'subscript' ? 'msub' : 'msup', [
        expressionNode(expression.base, `${key}-base`),
        expressionNode(expression.script, `${key}-script`),
      ]);
    case 'fraction':
      return node('mfrac', [
        expressionNode(expression.numerator, `${key}-numerator`),
        expressionNode(expression.denominator, `${key}-denominator`),
      ]);
    case 'fenced':
      return node('mrow', [
        createElement(
          'mo',
          { key: `${key}-left`, fence: 'true', stretchy: 'true' },
          expression.left,
        ),
        expressionNode(expression.expression, `${key}-value`),
        createElement(
          'mo',
          { key: `${key}-right`, fence: 'true', stretchy: 'true' },
          expression.right,
        ),
      ]);
  }
}

export function MathFormula({ expression, label }: { expression: MathExpression; label: string }) {
  return createElement(
    'math',
    { display: 'block', className: 'calculation-math', 'aria-label': label },
    expressionNode(expression),
  );
}
