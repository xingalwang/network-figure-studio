import { fail, type ProjectDocument, type Result } from './types.ts';
import { validateDocument } from './validate.ts';
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
export function createProject(title = '未命名架构图', schemaVersion: 1 | 2 = 1): ProjectDocument {
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
