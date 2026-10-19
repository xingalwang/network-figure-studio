import { structurePalette, type ViewTheme } from './view-theme.ts';
import type { NodeEntity, Point, Primitive, Bounds } from '../core/document/types.ts';
import { nodeVisual } from './paint.ts';

/** A view of a network node, never a second saved model. */
export function structureVisual(
  node: NodeEntity,
  theme: ViewTheme = 'dark',
): {
  bounds: Bounds;
  primitives: Primitive[];
  ports: Record<string, Point>;
} {
  const keys = Object.keys(node.ports),
    inputs = keys.filter((k) => !isOutput(k, node)),
    outputs = keys.filter((k) => isOutput(k, node));
  const width = 192,
    height = Math.max(92, 32 + Math.max(inputs.length, outputs.length) * 22);
  const ports: Record<string, Point> = {};
  for (const key of keys) {
    const right = isOutput(key, node),
      side = right ? outputs : inputs;
    ports[key] = {
      x: right ? width : 0,
      y: 40 + ((side.indexOf(key) + 1) * (height - 48)) / (side.length + 1),
    };
  }
  const figure = nodeVisual(node),
    fill = figure.primitives.find((p) => 'fill' in p);
  const accent = fill && 'fill' in fill ? fill.fill : '#9eb5c8';
  const source = node.generation?.source,
    params = source?.kind === 'local' ? source.params : {};
  const subtitle = params.units
    ? `${params.units} units`
    : params.channels
      ? `${params.channels} channels`
      : node.generation
        ? '参数化基元'
        : '绘图元素';
  const title = (node.presentation.labelOverride ?? node.name).split('\n')[0];
  const text = (
    value: string,
    x: number,
    y: number,
    w: number,
    h: number,
    fontSize: number,
    color: string,
  ): Primitive => ({ kind: 'text', text: value, x, y, width: w, height: h, fontSize, color });
  const primitives: Primitive[] = [
    {
      kind: 'rect',
      x: 0,
      y: 0,
      width,
      height,
      fill: structurePalette(theme).node,
      stroke: structurePalette(theme).border,
      strokeWidth: 1,
    },
    {
      kind: 'rect',
      x: 1,
      y: 1,
      width: 4,
      height: height - 2,
      fill: accent,
      stroke: accent,
      strokeWidth: 0,
    },
    text(title, 12, 9, width - 24, 22, 14, structurePalette(theme).text),
    text(subtitle, 12, 31, width - 24, 18, 11, structurePalette(theme).muted),
  ];
  for (const key of keys) {
    const p = ports[key];
    primitives.push(
      text(key, p.x === 0 ? 10 : width - 60, p.y - 7, 50, 14, 10, structurePalette(theme).muted),
    );
  }
  return { bounds: { x: 0, y: 0, width, height }, primitives, ports };
}
function isOutput(key: string, node: NodeEntity) {
  const port = node.ports[key];
  return (
    /^out(?:\d+)?$/.test(key) ||
    (!/^in(?:\d+)?$/.test(key) && 'x' in port && port.x >= node.size.width && port.y > 0)
  );
}
