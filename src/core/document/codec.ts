import { fail, type Endpoint, type ProjectDocument, type Result } from './types.ts';
import { validateDocument } from './validate.ts';
import { representationOf } from '../figure/index.ts';
export function decodeProject(text: string): Result<ProjectDocument> {
  try {
    assertUniqueKeys(text);
    return validateDocument(JSON.parse(text));
  } catch {
    return fail('INVALID_JSON', '无法读取此工程文件，请检查文件是否完整。');
  }
}
export function encodeProject(doc: ProjectDocument): string {
  const r = validateDocument(doc);
  if (!r.ok) throw new Error(r.error.message);
  return JSON.stringify(doc, null, 2);
}
export function createProject(
  title = '未命名架构图',
  schemaVersion: 1 | 2 | 3 = 1,
): ProjectDocument {
  return {
    schemaVersion,
    id: crypto.randomUUID(),
    title,
    revision: 0,
    entities: {},
    assets: {},
    dependencies: {},
    theme: { fontFamily: 'Inter, Noto Sans SC, sans-serif', lineColor: '#374151' },
    page: { width: 1200, height: 700, background: 'white' },
  };
}

// JSON.parse discards repeated properties. Reject them before an entity can disappear.
function assertUniqueKeys(text: string): void {
  const stack: { object: boolean; expectKey: boolean; keys: Set<string> }[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i],
      current = stack.at(-1);
    if (char === '"') {
      const start = i;
      for (i++; i < text.length; i++) {
        if (text[i] === '\\') {
          i++;
          continue;
        }
        if (text[i] === '"') break;
      }
      if (current?.object && current.expectKey) {
        const key = JSON.parse(text.slice(start, i + 1));
        if (current.keys.has(key)) throw Error('Duplicate JSON property');
        current.keys.add(key);
        current.expectKey = false;
      }
    } else if (char === '{' || char === '[')
      stack.push({ object: char === '{', expectKey: char === '{', keys: new Set() });
    else if (char === '}' || char === ']') stack.pop();
    else if (char === ',' && current?.object) current.expectKey = true;
  }
}

/** Explicit copy upgrade: legacy diagrams retain their original file and semantics. */
export function migrateProjectV2(doc: ProjectDocument): ProjectDocument {
  const copy = structuredClone(doc);
  copy.schemaVersion = 2;
  copy.id = crypto.randomUUID();
  copy.revision = 0;
  for (const entity of Object.values(copy.entities))
    if (entity.kind === 'edge' && entity.meaning === undefined) entity.meaning = 'annotation';
  return copy;
}

/** Explicit copy migration retains computation IDs and gives every drawing its own identity. */
export function migrateProjectV3(doc: ProjectDocument): ProjectDocument {
  const copy = structuredClone(doc);
  copy.schemaVersion = 3;
  copy.id = crypto.randomUUID();
  copy.revision = 0;
  if (doc.schemaVersion === 3) return copy;
  const representations = new Map<string, string>();
  for (const entity of Object.values(doc.entities)) {
    if (entity.kind !== 'node' || !entity.semantic || entity.figureState === 'unplaced') continue;
    const id = crypto.randomUUID();
    representations.set(entity.id, id);
    copy.entities[id] = representationOf(entity, id);
  }
  const drawingEndpoint = (endpoint: Endpoint): Endpoint => {
    if (endpoint.kind === 'free') return endpoint;
    return { ...endpoint, entityId: representations.get(endpoint.entityId) ?? endpoint.entityId };
  };
  for (const entity of Object.values(doc.entities)) {
    if (entity.kind !== 'edge') continue;
    const current = copy.entities[entity.id];
    if (current.kind !== 'edge') continue;
    if (doc.schemaVersion === 1 && entity.meaning === undefined) current.meaning = 'annotation';
    if (entity.meaning !== 'dataflow') {
      current.source = drawingEndpoint(current.source);
      current.target = drawingEndpoint(current.target);
      continue;
    }
    if (entity.figureState === 'unplaced') continue;
    const id = crypto.randomUUID(),
      edge = structuredClone(entity);
    delete edge.generation;
    edge.id = id;
    edge.meaning = 'annotation';
    edge.figure = { role: 'representation', semanticRef: entity.id };
    edge.source = drawingEndpoint(edge.source);
    edge.target = drawingEndpoint(edge.target);
    copy.entities[id] = edge;
  }
  return copy;
}
