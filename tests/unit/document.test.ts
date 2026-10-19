import { describe, it, test } from 'vitest';
import assert from 'node:assert/strict';
import { validateDocument } from '../../src/core/document/validate.ts';
import { decodeProject, encodeProject } from '../../src/core/document/codec.ts';
import { makeCoreFixture } from '../fixtures/project.ts';
describe('portable project contract', () => {
  it('round trips full editable data', () => {
    const doc = makeCoreFixture();
    assert.deepEqual(decodeProject(encodeProject(doc)), { ok: true, value: doc });
  });
  for (const kind of ['version', 'id', 'port', 'nan', 'cycle', 'script', 'unknown', 'resource'])
    it(`rejects ${kind} without guessing`, () => {
      const doc: any = makeCoreFixture();
      if (kind === 'version') doc.schemaVersion = 999;
      if (kind === 'id') doc.entities['node-b'].id = 'node-a';
      if (kind === 'port') doc.entities.edge.target.portId = 'missing';
      if (kind === 'nan') doc.entities['node-a'].presentation.position.x = NaN;
      if (kind === 'cycle') doc.entities['node-a'].parentId = 'node-a';
      if (kind === 'script') doc.entities['node-a'].primitives = [{ kind: 'script', text: 'bad' }];
      if (kind === 'unknown') doc.unknownField = 1;
      if (kind === 'resource')
        doc.assets.x = {
          mime: 'image/png',
          data: 'https://example.com/x.png',
          width: 1,
          height: 1,
        };
      assert.equal(validateDocument(doc).ok, false);
    });
  it('rejects malformed JSON', () => assert.equal(decodeProject('{').ok, false));
});

test('JSON with duplicate object identifiers is rejected before parse can discard an entry', () => {
  const fixture = makeCoreFixture();
  const node = JSON.stringify(fixture.entities['node-a']);
  const text = JSON.stringify(fixture).replace('"entities":{', `"entities":{"node-a":${node},`);
  assert.equal(decodeProject(text).ok, false);
});
test('duplicate-looking quoted text is content, not a second JSON property', () => {
  const d = makeCoreFixture();
  d.title = '示意图 {"x":1,"x":2}';
  const result = decodeProject(encodeProject(d));
  assert.ok(result.ok);
  if (result.ok) assert.equal(result.value.title, d.title);
});
