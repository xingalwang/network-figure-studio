import {
  fail,
  ok,
  type ProjectDocument,
  type ResolvedOperation,
  type Result,
} from '../document/types.ts';
import { validColor } from '../document/validate.ts';

export type FigurePalette = {
  id: string;
  name: string;
  fill: string;
  stroke: string;
  text: string;
  line: string;
  background: ProjectDocument['page']['background'];
};

export const figurePalettes: readonly FigurePalette[] = [
  {
    id: 'neutral',
    name: '克制中性',
    fill: '#d5dde5',
    stroke: '#52606d',
    text: '#24303d',
    line: '#647181',
    background: '#ffffff',
  },
  {
    id: 'sea-salt',
    name: '海盐蓝',
    fill: '#abd5dc',
    stroke: '#447480',
    text: '#173c46',
    line: '#5a8390',
    background: '#ffffff',
  },
  {
    id: 'warm-gray',
    name: '暖灰',
    fill: '#ded3c4',
    stroke: '#86735d',
    text: '#40372d',
    line: '#887967',
    background: '#faf8f4',
  },
  {
    id: 'monochrome',
    name: '黑白',
    fill: '#ffffff',
    stroke: '#27272a',
    text: '#18181b',
    line: '#3f3f46',
    background: '#ffffff',
  },
];

export function planApplyPalette(
  doc: ProjectDocument,
  palette: FigurePalette,
): Result<ResolvedOperation[]> {
  if (
    !palette ||
    ![palette.fill, palette.stroke, palette.text, palette.line].every(validColor) ||
    (!['white', 'transparent'].includes(palette.background) && !validColor(palette.background))
  )
    return fail('INVALID_PALETTE', '配色需使用六位十六进制颜色。');
  const painted = Object.values(doc.entities).filter((entity) => entity.kind !== 'group');
  const locked = painted.filter((entity) => entity.locked).map((entity) => entity.id);
  if (locked.length) return fail('LOCKED', '请先解锁图元，再应用整图配色。', locked);
  return ok([
    ...painted.map(
      (entity): ResolvedOperation =>
        entity.kind === 'node'
          ? {
              kind: 'nodeStyle',
              id: entity.id,
              style: { fill: palette.fill, stroke: palette.stroke, text: palette.text },
            }
          : { kind: 'edgeStyle', id: entity.id, style: { color: palette.line } },
    ),
    {
      kind: 'metadata',
      theme: {
        ...doc.theme,
        nodeColor: palette.fill,
        borderColor: palette.stroke,
        textColor: palette.text,
        lineColor: palette.line,
      },
      page: { ...doc.page, background: palette.background },
    },
  ]);
}
