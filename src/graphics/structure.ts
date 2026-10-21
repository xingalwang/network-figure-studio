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
  caption?: string;
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
  ];
  return {
    bounds: { x: 0, y: 0, width, height },
    primitives,
    ports,
    caption: (node.presentation.labelOverride ?? node.name).replace(/\s+/g, ' ').trim(),
  };
}
function isOutput(key: string, node: NodeEntity) {
  const port = node.ports[key];
  return (
    /^out(?:\d+)?$/.test(key) ||
    (!/^in(?:\d+)?$/.test(key) && 'x' in port && port.x >= node.size.width && port.y > 0)
  );
}
