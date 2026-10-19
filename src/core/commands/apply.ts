import {
  fail,
  ok,
  type ProjectDocument,
  type ResolvedOperation,
  type Result,
} from '../document/types.ts';
import { validateDocument } from '../document/validate.ts';
export function applyOperations(
  doc: ProjectDocument,
  operations: ResolvedOperation[],
): Result<ProjectDocument> {
  const next = structuredClone(doc);
  for (const op of operations) {
    if (op.kind === 'put') {
      next.entities[op.entity.id] = structuredClone(op.entity);
      continue;
    }
    if (op.kind === 'remove') {
      for (const id of op.ids) delete next.entities[id];
      continue;
    }
    if (op.kind === 'metadata') {
      if (op.title !== undefined) next.title = op.title;
      if (op.page) next.page = structuredClone(op.page);
      if (op.theme) next.theme = structuredClone(op.theme);
      continue;
    }
    if (op.kind === 'assets') {
      Object.assign(next.assets, op.assets);
      continue;
    }
    if (op.kind === 'dependencies') {
      Object.assign(next.dependencies, op.dependencies);
      continue;
    }
    const e = next.entities[op.id];
    if (!e) return fail('MISSING_ENTITY', '对象已不存在。', [op.id]);
    if (e.locked) return fail('LOCKED', '对象已锁定。', [op.id]);
    switch (op.kind) {
      case 'compositionMove':
        if (next.schemaVersion !== 2 || e.kind === 'edge')
          return fail('INVALID_OPERATION', '生成位置需要新版节点。');
        e.presentation.compositionPosition = { ...op.position };
        break;
      case 'move':
        if (e.kind === 'edge') return fail('INVALID_OPERATION', '连线不能作为节点移动。');
        e.presentation.position = { ...op.position };
        e.presentation.moved = true;
        break;
      case 'label':
        if (e.kind === 'edge') e.label = op.text ?? '';
        else if (op.text === null) delete e.presentation.labelOverride;
        else e.presentation.labelOverride = op.text;
        break;
      case 'fill':
        if (e.kind === 'edge') return fail('INVALID_OPERATION', '请选择模块。');
        if (op.color === null) delete e.presentation.fillOverride;
        else e.presentation.fillOverride = op.color;
        break;
      case 'nodeStyle': {
        if (e.kind !== 'node') return fail('INVALID_OPERATION', '请选择实际图元；组本身没有填色。');
        const fields = {
          fill: 'fillOverride',
          stroke: 'strokeOverride',
          text: 'textOverride',
          opacity: 'opacityOverride',
          strokeWidth: 'strokeWidthOverride',
        } as const;
        for (const key of Object.keys(op.style) as (keyof typeof fields)[]) {
          if (!Object.hasOwn(fields, key)) return fail('INVALID_OPERATION', '不支持的样式字段。');
          const value = op.style[key];
          if (value === null) delete e.presentation[fields[key]];
          else if (value !== undefined) Object.assign(e.presentation, { [fields[key]]: value });
        }
        break;
      }
      case 'route':
        if (e.kind !== 'edge') return fail('INVALID_OPERATION', '请选择连线。');
        e.route = structuredClone(op.route);
        e.parentId = op.route.spaceId;
        break;
      case 'reconnect':
        if (e.kind !== 'edge') return fail('INVALID_OPERATION', '请选择连线。');
        e[op.end] = structuredClone(op.endpoint);
        break;
      case 'edgeStyle':
        if (e.kind !== 'edge') return fail('INVALID_OPERATION', '请选择连线。');
        Object.assign(e.style, op.style);
        e.styleOverrides = { ...e.styleOverrides, ...structuredClone(op.style) };
        break;
      default:
        return fail('INVALID_OPERATION', '不支持的编辑操作。');
    }
  }
  const result = validateDocument(next);
  return result.ok ? ok(next) : result;
}
