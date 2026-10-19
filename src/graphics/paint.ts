import type { AbstractCanvas2D } from '@maxgraph/core';
import type { Primitive, Bounds } from './primitives.ts';
import type { AssetMap, NodeEntity } from '../core/document/types.ts';
import { contrastTextColor } from './block-geometry.ts';
export const drawingFont = 'Inter, Noto Sans SC, sans-serif';
export function paintPrimitives(
  c: AbstractCanvas2D,
  primitives: Primitive[],
  assets: AssetMap,
): void {
  for (const p of primitives) {
    c.save();
    c.setAlpha(p.opacity ?? 1);
    c.setStrokeWidth('strokeWidth' in p ? (p.strokeWidth ?? 1.2) : 1.2);
    if (p.kind === 'text') {
      c.setFontFamily(drawingFont);
      c.setFontSize(p.fontSize);
      c.setFontColor(p.color);
      c.text(
        p.x + p.width / 2,
        p.y + p.height / 2,
        p.width,
        p.height,
        p.text,
        'center',
        'middle',
        false,
        '',
        'visible',
        false,
        0,
        'ltr',
      );
    } else if (p.kind === 'image') {
      const asset = assets[p.assetId];
      if (asset) c.image(p.x, p.y, p.width, p.height, asset.data, false, false, false);
    } else {
      c.setFillColor(p.fill);
      c.setStrokeColor(p.strokeWidth === 0 ? null : p.stroke);
      if (p.kind === 'rect') c.rect(p.x, p.y, p.width, p.height);
      else if (p.kind === 'ellipse') c.ellipse(p.x, p.y, p.width, p.height);
      else if (p.kind === 'polygon') {
        c.begin();
        p.points.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)));
        c.close();
      }
      c.fillAndStroke();
    }
    c.restore();
  }
}
export function nodeVisual(node: NodeEntity): { primitives: Primitive[]; bounds: Bounds } {
  let primitives = structuredClone(node.primitives),
    bounds = { ...node.bounds };
  const appearance = node.presentation;
  const front = [...primitives].reverse().find((p) => p.kind === 'rect' || p.kind === 'ellipse');
  const baseFill =
    front && 'fill' in front ? front.fill : primitives.find((p) => 'fill' in p)?.fill;
  primitives = primitives.map((p) => {
    if (appearance.opacityOverride !== undefined) p.opacity = appearance.opacityOverride;
    if ('fill' in p) {
      if (appearance.fillOverride)
        p.fill = baseFill
          ? recolorShade(p.fill, baseFill, appearance.fillOverride)
          : appearance.fillOverride;
      if (appearance.strokeOverride) p.stroke = appearance.strokeOverride;
      if (appearance.strokeWidthOverride !== undefined)
        p.strokeWidth = appearance.strokeWidthOverride;
    } else if (p.kind === 'text') {
      if (appearance.textOverride) p.color = appearance.textOverride;
      else if (
        appearance.fillOverride &&
        p.x >= 0 &&
        p.y >= 0 &&
        p.x + p.width <= node.size.width &&
        p.y + p.height <= node.size.height
      )
        p.color = contrastTextColor(appearance.fillOverride);
    }
    return p;
  });
  if (node.presentation.labelOverride !== undefined) {
    primitives = primitives.filter((p) => p.kind !== 'text');
    const lines = node.presentation.labelOverride.split('\n');
    const width =
      Math.max(
        node.size.width,
        ...lines.map((x) =>
          Array.from(x).reduce((w, c) => w + (/[^\x00-\x7f]/.test(c) ? 14 : 8), 0),
        ),
      ) + 8;
    const x = (node.size.width - width) / 2,
      y = node.size.height + 10;
    lines.forEach((text, i) =>
      primitives.push({
        kind: 'text',
        text,
        x,
        y: y + i * 20,
        width,
        height: 20,
        fontSize: 14,
        color: appearance.textOverride ?? '#26333d',
        ...(appearance.opacityOverride !== undefined
          ? { opacity: appearance.opacityOverride }
          : {}),
      }),
    );
    const right = Math.max(bounds.x + bounds.width, x + width),
      bottom = Math.max(bounds.y + bounds.height, y + lines.length * 20);
    bounds.x = Math.min(bounds.x, x);
    bounds.width = right - bounds.x;
    bounds.height = bottom - bounds.y;
  }
  return { primitives, bounds };
}

/** Keep a face's light/dark offset when replacing its front-face color. */
function recolorShade(color: string, base: string, replacement: string): string {
  const channel = (value: string, start: number) => parseInt(value.slice(start, start + 2), 16);
  const offsets = [1, 3, 5]
    .flatMap((start) => {
      const original = channel(base, start),
        value = channel(color, start);
      const denominator = value >= original ? 255 - original : original;
      return denominator ? [(value - original) / denominator] : [];
    })
    .sort((a, b) => a - b);
  const amount = offsets[Math.floor(offsets.length / 2)] ?? 0;
  return `#${[1, 3, 5]
    .map((start) => {
      const value = channel(replacement, start);
      return Math.round(value + (amount >= 0 ? 255 - value : value) * amount)
        .toString(16)
        .padStart(2, '0');
    })
    .join('')}`;
}
