import { expect, it } from 'vitest';
import { createProject } from '../../src/core/document/codec.ts';
import { initialProjectView, workspaceSelection } from '../../src/app/project-view.ts';
import type { NodeEntity } from '../../src/core/document/types.ts';
const source: NodeEntity = {
  id: 'source',
  kind: 'node',
  parentId: null,
  name: 'source',
  semantic: { role: 'tensor-source' },
  figureState: 'visible',
  size: { width: 50, height: 50 },
  bounds: { x: 0, y: 0, width: 50, height: 50 },
  ports: {},
  primitives: [],
  presentation: { position: { x: 0, y: 0 } },
};
it('v3 reopening selects a visible drawing identity, and a structure-only project opens structure', () => {
  const doc = createProject('view', 3);
  doc.entities.source = source;
  expect(initialProjectView(doc)).toEqual({ workspace: 'generator', selection: ['source'] });
  const figure = {
    ...source,
    id: 'figure',
    semantic: undefined,
    figure: { role: 'representation' as const, semanticRef: 'source' },
  };
  doc.entities.figure = figure;
  expect(initialProjectView(doc)).toEqual({ workspace: 'drawing', selection: ['figure'] });
  expect(workspaceSelection(doc, ['source'], 'drawing')).toEqual(['figure']);
  expect(workspaceSelection(doc, ['figure'], 'generator')).toEqual(['source']);
  doc.entities.figure = { ...figure, figureState: 'hidden' };
  expect(initialProjectView(doc)).toEqual({ workspace: 'generator', selection: ['source'] });
});
it('v2 keeps the existing visible object selected', () => {
  const doc = createProject('legacy', 2);
  doc.entities.source = source;
  expect(initialProjectView(doc)).toEqual({ workspace: 'drawing', selection: ['source'] });
});
