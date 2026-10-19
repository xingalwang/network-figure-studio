import { fail, ok, type Result } from '../core/document/types.ts';
import type { BlockAppearance, BlockGeometry, Bounds, Point, Primitive } from './primitives.ts';

export type BlockOptions = {
  fill?: string;
  stroke?: string;
  textColor?: string;
  opacity?: number;
  strokeWidth?: number;
  label?: string;
  shape?: 'rect' | 'ellipse';
};

function shade(color: string, amount: number): string {
  const channels = [1, 3, 5].map((start) => {
    const value = parseInt(color.slice(start, start + 2), 16);
    return Math.round(value + (amount > 0 ? 255 - value : value) * amount)
      .toString(16)
      .padStart(2, '0');
  });
  return `#${channels.join('')}`;
}

export function contrastTextColor(fill: string): string {
  const linear = [1, 3, 5].map((start) => {
    const value = parseInt(fill.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  return luminance < 0.179 ? '#ffffff' : '#000000';
}

function labelPrimitives(
  label: string,
  width: number,
  height: number,
  fill: string,
  textColor?: string,
): Primitive[] {
  if (!label.trim()) return [];
  const fontSize = 13,
    lineHeight = 18,
    padding = 8;
  const paragraphs = label.replace(/\r\n?/g, '\n').split('\n');
  // One em per Unicode code point is deliberately conservative and needs no DOM/font lookup.
  const textWidth = (text: string) => Math.max(1, Array.from(text).length) * fontSize + padding;
  const inside =
    paragraphs.length === 1 &&
    textWidth(label) <= width - padding * 2 &&
    lineHeight <= height - padding * 2;
  const columns = Math.max(1, Math.floor((Math.max(width, 160) - padding * 2) / fontSize));
  const lines = inside
    ? paragraphs
    : paragraphs.flatMap((paragraph) => {
        const characters = Array.from(paragraph),
          wrapped: string[] = [];
        for (let i = 0; i < characters.length; i += columns)
          wrapped.push(characters.slice(i, i + columns).join(''));
        return wrapped.length ? wrapped : [''];
      });
  const labelWidth = Math.max(...lines.map(textWidth));
  const color = textColor ?? (inside ? contrastTextColor(fill) : '#263238');
  return lines.map((text, i) => ({
    kind: 'text',
    text,
    fontSize,
    color,
    x: (width - labelWidth) / 2,
    y: inside ? (height - lineHeight) / 2 : height + padding + i * lineHeight,
    width: labelWidth,
    height: lineHeight,
  }));
}

function enclosingBounds(primitives: Primitive[]): Bounds {
  const points = primitives.flatMap((p) =>
    p.kind === 'polygon'
      ? p.points
      : [
          { x: p.x, y: p.y },
          { x: p.x + p.width, y: p.y + p.height },
        ],
  );
  const x = Math.min(...points.map((p) => p.x));
  const y = Math.min(...points.map((p) => p.y));
  return {
    x,
    y,
    width: Math.max(...points.map((p) => p.x)) - x,
    height: Math.max(...points.map((p) => p.y)) - y,
  };
}

// The swept ellipse uses the same restricted polygon primitive as rectangular sides.
function ellipseSide(
  x: number,
  y: number,
  width: number,
  height: number,
  dx: number,
  dy: number,
): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < 32; i++) {
    const angle = (i * Math.PI) / 16;
    const point = {
      x: x + width * ((1 + Math.cos(angle)) / 2),
      y: y + height * ((1 + Math.sin(angle)) / 2),
    };
    points.push(point, { x: point.x + dx, y: point.y - dy });
  }
  points.sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a: Point, b: Point, c: Point) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = (sorted: Point[]) => {
    const hull: Point[] = [];
    for (const point of sorted) {
      while (hull.length > 1 && cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 0)
        hull.pop();
      hull.push(point);
    }
    return hull.slice(0, -1);
  };
  return [...half(points), ...half([...points].reverse())];
}

export function buildBlockGeometry(
  size: { width: number; height: number },
  appearance: BlockAppearance,
  options: BlockOptions = {},
): Result<BlockGeometry> {
  const { width, height } = size;
  const { mode, depth, stackCount, stackGap, angleDeg } = appearance;
  const invalid = () =>
    fail('INVALID_BLOCK_GEOMETRY', '组件尺寸、厚度、叠层偏移、片数或投影角度无效。');
  if (
    ![width, height, depth, stackCount, stackGap, angleDeg].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    depth < 0 ||
    stackGap < 0 ||
    !Number.isInteger(stackCount) ||
    stackCount < 1 ||
    stackCount > 16 ||
    angleDeg < 0 ||
    angleDeg > 90 ||
    !['flat', 'axonometric'].includes(mode)
  )
    return invalid();

  const fill = options.fill ?? '#90c9c9',
    stroke = options.stroke ?? '#374151';
  const shape = options.shape ?? 'rect';
  if (
    ![fill, stroke].every((color) => /^#[0-9a-f]{6}$/i.test(color)) ||
    (options.textColor !== undefined && !/^#[0-9a-f]{6}$/i.test(options.textColor)) ||
    (options.opacity !== undefined &&
      (!Number.isFinite(options.opacity) || options.opacity < 0 || options.opacity > 1)) ||
    (options.strokeWidth !== undefined &&
      (!Number.isFinite(options.strokeWidth) || options.strokeWidth < 0)) ||
    !['rect', 'ellipse'].includes(shape) ||
    (options.label !== undefined && typeof options.label !== 'string')
  ) {
    return fail(
      'INVALID_BLOCK_GEOMETRY',
      '组件颜色必须为六位十六进制色值，形状与标签必须符合图元格式。',
    );
  }
  const primitives: Primitive[] = [];
  const count = mode === 'flat' ? 1 : stackCount;
  const radians = (angleDeg * Math.PI) / 180;
  const cos = angleDeg === 90 ? 0 : Math.cos(radians);
  const sin = angleDeg === 0 ? 0 : Math.sin(radians);
  const dx = mode === 'flat' ? 0 : depth * cos;
  const dy = mode === 'flat' ? 0 : depth * sin;
  const extent = mode === 'flat' ? 0 : depth + (count - 1) * stackGap;
  if (![extent, width + extent * cos, height + extent * sin].every(Number.isFinite))
    return invalid();

  // Back-to-front order; stackGap is each sheet's offset, not its clear separation.
  for (let i = count - 1; i >= 0; i--) {
    const x = i * stackGap * cos,
      y = -(i * stackGap * sin) || 0;
    if (shape === 'ellipse' && (dx > 0 || dy > 0)) {
      primitives.push({
        kind: 'polygon',
        points: ellipseSide(x, y, width, height, dx, dy),
        fill: shade(fill, -0.18),
        stroke,
      });
    } else if (shape === 'rect') {
      if (dy > 0)
        primitives.push({
          kind: 'polygon',
          points: [
            { x, y },
            { x: x + width, y },
            { x: x + width + dx, y: y - dy },
            { x: x + dx, y: y - dy },
          ],
          fill: shade(fill, 0.18),
          stroke,
        });
      if (dx > 0)
        primitives.push({
          kind: 'polygon',
          points: [
            { x: x + width, y },
            { x: x + width, y: y + height },
            { x: x + width + dx, y: y + height - dy },
            { x: x + width + dx, y: y - dy },
          ],
          fill: shade(fill, -0.18),
          stroke,
        });
    }
    primitives.push({ kind: shape, x, y, width, height, fill, stroke });
  }
  if (options.label !== undefined)
    primitives.push(...labelPrimitives(options.label, width, height, fill, options.textColor));

  for (const primitive of primitives) {
    if (options.opacity !== undefined) primitive.opacity = options.opacity;
    if ('stroke' in primitive && options.strokeWidth !== undefined)
      primitive.strokeWidth = options.strokeWidth;
  }

  return ok({
    primitives,
    ports: { in: { x: 0, y: height / 2 }, out: { x: width, y: height / 2 } },
    bounds: enclosingBounds(primitives),
  });
}
