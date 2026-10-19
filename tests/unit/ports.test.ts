import { test } from 'vitest';
import assert from 'node:assert/strict';
import { makeCoreFixture } from '../fixtures/project.ts';
import { resolvePort } from '../../src/adapters/maxgraph/ports.ts';
test('port resolution includes nested local spaces and stable group port mappings', () => {
  const d = makeCoreFixture();
  d.entities.group = {
    id: 'group',
    kind: 'group',
    parentId: null,
    name: 'g',
    size: { width: 500, height: 300 },
    presentation: { position: { x: 100, y: 200 } },
    ports: { out: { entityId: 'node-a', portId: 'out' } },
  };
  d.entities['node-a'].parentId = 'group';
  assert.deepEqual(resolvePort(d, 'group', 'out'), { ok: true, value: { x: 300, y: 390 } });
});
test('missing and recursive ports fail instead of guessing anchor', () => {
  const d = makeCoreFixture();
  assert.equal(resolvePort(d, 'node-a', 'missing').ok, false);
  const a = d.entities['node-a'];
  if (a.kind !== 'edge') a.ports.out = { entityId: 'node-a', portId: 'out' };
  assert.equal(resolvePort(d, 'node-a', 'out').ok, false);
});
