import { fail, ok, type ProjectDocument, type Result, type Endpoint, type Port } from './types.ts';
const record = (v: unknown): v is Record<string, any> =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string';
const id = (v: unknown): v is string =>
  str(v) && /^[\w:./-]+$/.test(v) && !['__proto__', 'constructor', 'prototype'].includes(v);
const keys = (v: Record<string, any>, allowed: string[]) =>
  Object.keys(v).every((k) => allowed.includes(k));
const point = (v: unknown): boolean => record(v) && keys(v, ['x', 'y']) && num(v.x) && num(v.y);
const size = (v: unknown): boolean =>
  record(v) &&
  keys(v, ['width', 'height']) &&
  num(v.width) &&
  num(v.height) &&
  v.width > 0 &&
  v.height > 0;
const bounds = (v: unknown): boolean =>
  record(v) &&
  keys(v, ['x', 'y', 'width', 'height']) &&
  num(v.x) &&
  num(v.y) &&
  num(v.width) &&
  num(v.height) &&
  v.width > 0 &&
  v.height > 0;
export const validColor = (v: unknown): v is string => str(v) && /^#[0-9a-f]{6}$/i.test(v);
const opacity = (v: unknown) => num(v) && v >= 0 && v <= 1;
const nonnegative = (v: unknown) => num(v) && v >= 0;
const optional = (v: unknown, validate: (value: unknown) => boolean) =>
  v === undefined || validate(v);
function edgeStyle(v: unknown, partial = false): boolean {
  if (!record(v) || !keys(v, ['color', 'width', 'dashed', 'arrow', 'opacity'])) return false;
  return (
    (partial ? optional(v.color, validColor) : validColor(v.color)) &&
    (partial ? optional(v.width, nonnegative) : nonnegative(v.width)) &&
    (partial ? optional(v.dashed, (x) => typeof x === 'boolean') : typeof v.dashed === 'boolean') &&
    (partial ? optional(v.arrow, (x) => typeof x === 'boolean') : typeof v.arrow === 'boolean') &&
    optional(v.opacity, opacity)
  );
}
function json(v: unknown, depth = 0): boolean {
  return (
    depth <= 40 &&
    (v === null ||
      str(v) ||
      typeof v === 'boolean' ||
      num(v) ||
      (Array.isArray(v)
        ? v.every((x) => json(x, depth + 1))
        : record(v) &&
          Object.entries(v).every(
            ([k, x]) =>
              !['__proto__', 'constructor', 'prototype'].includes(k) && json(x, depth + 1),
          )))
  );
}
function primitive(p: unknown): boolean {
  if (!record(p)) return false;
  if (!optional(p.opacity, opacity)) return false;
  const base = ['kind', 'x', 'y', 'width', 'height', 'opacity'];
  if (p.kind === 'polygon')
    return (
      keys(p, ['kind', 'points', 'fill', 'stroke', 'opacity', 'strokeWidth']) &&
      Array.isArray(p.points) &&
      p.points.length >= 3 &&
      p.points.every(point) &&
      validColor(p.fill) &&
      validColor(p.stroke) &&
      optional(p.strokeWidth, nonnegative)
    );
  if (!bounds({ x: p.x, y: p.y, width: p.width, height: p.height })) return false;
  if (p.kind === 'rect' || p.kind === 'ellipse')
    return (
      keys(p, [...base, 'fill', 'stroke', 'strokeWidth']) &&
      validColor(p.fill) &&
      validColor(p.stroke) &&
      optional(p.strokeWidth, nonnegative)
    );
  if (p.kind === 'text')
    return (
      keys(p, [...base, 'text', 'fontSize', 'color']) &&
      str(p.text) &&
      num(p.fontSize) &&
      p.fontSize > 0 &&
      validColor(p.color)
    );
  return p.kind === 'image' && keys(p, [...base, 'assetId']) && id(p.assetId);
}
function binding(g: unknown): boolean {
  if (
    !record(g) ||
    !keys(g, ['generatorId', 'version', 'paramSchemaVersion', 'source', 'localKeys']) ||
    !id(g.generatorId) ||
    !str(g.version) ||
    !Number.isInteger(g.paramSchemaVersion) ||
    g.paramSchemaVersion < 1 ||
    !record(g.localKeys) ||
    !Object.entries(g.localKeys).every(([k, v]) => id(k) && id(v)) ||
    !record(g.source)
  )
    return false;
  const s = g.source;
  return s.kind === 'local'
    ? keys(s, ['kind', 'params']) && record(s.params) && json(s.params)
    : s.kind === 'slot' &&
        keys(s, ['kind', 'ownerId', 'slotKey', 'inherit']) &&
        id(s.ownerId) &&
        id(s.slotKey) &&
        Array.isArray(s.inherit) &&
        s.inherit.every(id);
}
function endpoint(e: unknown): boolean {
  if (!record(e)) return false;
  return e.kind === 'port'
    ? keys(e, ['kind', 'entityId', 'portId']) && id(e.entityId) && id(e.portId)
    : e.kind === 'free' &&
        keys(e, ['kind', 'spaceId', 'point']) &&
        (e.spaceId === null || id(e.spaceId)) &&
        point(e.point);
}
export function validateDocument(input: unknown): Result<ProjectDocument> {
  const bad = () => fail('INVALID_PROJECT', '工程格式、数值或对象引用无效；当前项目未改变。');
  if (
    !record(input) ||
    !keys(input, [
      'schemaVersion',
      'id',
      'title',
      'revision',
      'entities',
      'assets',
      'dependencies',
      'theme',
      'page',
    ]) ||
    ![1, 2].includes(input.schemaVersion) ||
    !id(input.id) ||
    !str(input.title) ||
    !Number.isInteger(input.revision) ||
    input.revision < 0 ||
    !record(input.entities) ||
    !record(input.assets) ||
    !record(input.dependencies)
  )
    return bad();
  if (
    !record(input.theme) ||
    !keys(input.theme, [
      'fontFamily',
      'lineColor',
      'nodeColor',
      'textColor',
      'borderColor',
      'lineWidth',
    ]) ||
    !str(input.theme.fontFamily) ||
    !/^[\w\s,.'-]+$/.test(input.theme.fontFamily) ||
    !validColor(input.theme.lineColor) ||
    ![input.theme.nodeColor, input.theme.textColor, input.theme.borderColor].every((v) =>
      optional(v, validColor),
    ) ||
    !optional(input.theme.lineWidth, nonnegative)
  )
    return bad();
  if (
    !record(input.page) ||
    !keys(input.page, ['width', 'height', 'background']) ||
    !size({ width: input.page.width, height: input.page.height }) ||
    (!['white', 'transparent'].includes(input.page.background) &&
      !validColor(input.page.background))
  )
    return bad();
  if (!Object.entries(input.dependencies).every(([k, v]) => id(k) && str(v))) return bad();
  for (const [key, a] of Object.entries(input.assets))
    if (
      !id(key) ||
      !record(a) ||
      !keys(a, ['mime', 'data', 'width', 'height']) ||
      !['image/png', 'image/jpeg'].includes(a.mime) ||
      !size({ width: a.width, height: a.height }) ||
      !str(a.data) ||
      !a.data.startsWith(`data:${a.mime};base64,`) ||
      !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(a.data)
    )
      return bad();
  const v2 = input.schemaVersion === 2;
  const base = [
    'id',
    'kind',
    'parentId',
    'name',
    'generation',
    'locked',
    ...(v2 ? ['figureState'] : []),
  ];
  for (const [key, e] of Object.entries(input.entities)) {
    if (
      !record(e) ||
      !id(key) ||
      key !== e.id ||
      !str(e.name) ||
      (e.parentId !== null && !id(e.parentId)) ||
      (e.locked !== undefined && typeof e.locked !== 'boolean') ||
      (e.generation !== undefined && !binding(e.generation)) ||
      (e.figureState !== undefined && !['unplaced', 'visible', 'hidden'].includes(e.figureState))
    )
      return bad();
    if (e.kind === 'edge') {
      if (
        !keys(e, [
          ...base,
          'source',
          'target',
          'route',
          'style',
          'styleOverrides',
          'label',
          ...(v2 ? ['meaning'] : []),
        ]) ||
        (e.meaning !== undefined && !['dataflow', 'annotation'].includes(e.meaning)) ||
        !endpoint(e.source) ||
        !endpoint(e.target) ||
        !record(e.route) ||
        !keys(e.route, ['kind', 'mode', 'points', 'spaceId']) ||
        !['straight', 'orthogonal', 'curve'].includes(e.route.kind) ||
        !['auto', 'manual'].includes(e.route.mode) ||
        !Array.isArray(e.route.points) ||
        !e.route.points.every(point) ||
        e.route.spaceId !== e.parentId ||
        !edgeStyle(e.style) ||
        !optional(e.styleOverrides, (v) => edgeStyle(v, true)) ||
        (e.label !== undefined && !str(e.label))
      )
        return bad();
    } else {
      if (
        !['node', 'group'].includes(e.kind) ||
        !keys(e, [
          ...base,
          'size',
          'presentation',
          'ports',
          ...(e.kind === 'node' ? ['bounds', 'primitives', ...(v2 ? ['semantic'] : [])] : []),
        ]) ||
        !size(e.size) ||
        !record(e.presentation) ||
        !keys(e.presentation, [
          'position',
          'labelOverride',
          'fillOverride',
          'strokeOverride',
          'textOverride',
          'opacityOverride',
          'strokeWidthOverride',
          'moved',
          'scale',
          ...(v2 ? ['compositionPosition'] : []),
        ]) ||
        !point(e.presentation.position) ||
        !record(e.ports)
      )
        return bad();
      if (
        e.semantic !== undefined &&
        (!record(e.semantic) ||
          !keys(e.semantic, ['role']) ||
          !['tensor-source', 'tensor-result', 'operation'].includes(e.semantic.role))
      )
        return bad();
      const p = e.presentation;
      if (
        !optional(p.compositionPosition, point) ||
        (p.labelOverride !== undefined && !str(p.labelOverride)) ||
        (p.fillOverride !== undefined && !validColor(p.fillOverride)) ||
        !optional(p.strokeOverride, validColor) ||
        !optional(p.textOverride, validColor) ||
        !optional(p.opacityOverride, opacity) ||
        !optional(p.strokeWidthOverride, nonnegative) ||
        (p.moved !== undefined && typeof p.moved !== 'boolean') ||
        (p.scale !== undefined && (!num(p.scale) || p.scale <= 0))
      )
        return bad();
      if (
        !Object.entries(e.ports).every(
          ([k, p]) =>
            id(k) &&
            (point(p) ||
              (record(p) && keys(p, ['entityId', 'portId']) && id(p.entityId) && id(p.portId))),
        )
      )
        return bad();
      if (
        e.kind === 'node' &&
        (!bounds(e.bounds) || !Array.isArray(e.primitives) || !e.primitives.every(primitive))
      )
        return bad();
      if (
        e.kind === 'node' &&
        e.primitives.some((p: any) => p.kind === 'image' && !Object.hasOwn(input.assets, p.assetId))
      )
        return bad();
    }
  }
  const doc = input as ProjectDocument,
    entities = doc.entities;
  const space = (x: string | null) =>
    x === null || (Object.hasOwn(entities, x) && entities[x].kind === 'group');
  const port = (entityId: string, portId: string, seen = new Set<string>()): boolean => {
    const e = entities[entityId],
      key = `${entityId}:${portId}`;
    if (
      !Object.hasOwn(entities, entityId) ||
      !e ||
      e.kind === 'edge' ||
      !Object.hasOwn(e.ports, portId) ||
      seen.has(key)
    )
      return false;
    seen.add(key);
    const p: Port = e.ports[portId];
    return 'entityId' in p ? port(p.entityId, p.portId, seen) : true;
  };
  const end = (x: Endpoint) => (x.kind === 'port' ? port(x.entityId, x.portId) : space(x.spaceId));
  for (const e of Object.values(entities)) {
    if (!space(e.parentId)) return bad();
    const seen = new Set([e.id]);
    let p = e.parentId;
    while (p !== null) {
      if (seen.has(p)) return bad();
      seen.add(p);
      p = entities[p].parentId;
    }
    if (e.kind === 'edge' && (!end(e.source) || !end(e.target))) return bad();
    if (e.kind !== 'edge' && !Object.keys(e.ports).every((k) => port(e.id, k))) return bad();
    if (e.generation) {
      const mapped = Object.values(e.generation.localKeys);
      if (!mapped.includes(e.id) || new Set(mapped).size !== mapped.length) return bad();
      const belongs = (childId: string, ownerId: string) => {
        let current: string | null = childId;
        const visited = new Set<string>();
        while (current !== null) {
          if (current === ownerId) return true;
          if (visited.has(current) || !Object.hasOwn(entities, current)) return false;
          visited.add(current);
          current = entities[current].parentId;
        }
        return false;
      };
      if (!mapped.every((x) => Object.hasOwn(entities, x) && belongs(x, e.id))) return bad();
      const s = e.generation.source;
      if (
        s.kind === 'slot' &&
        (!Object.hasOwn(entities, s.ownerId) ||
          entities[s.ownerId].generation?.source.kind !== 'local' ||
          s.ownerId === e.id ||
          !belongs(e.id, s.ownerId))
      )
        return bad();
    }
  }
  return ok(doc);
}
