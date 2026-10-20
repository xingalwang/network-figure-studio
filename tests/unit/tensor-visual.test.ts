import { describe, expect, test } from 'vitest';
import type { NodeEntity, Primitive } from '../../src/core/document/types.ts';
import type { AnalysisReport } from '../../src/core/computation/index.ts';
import { tensorVisual as renderTensorVisual } from '../../src/graphics/tensor-visual.ts';
import { createBuiltinRegistry } from '../../src/builtins/registry.ts';
const computations = createBuiltinRegistry().computations;
const tensorVisual = (
  doc: Parameters<typeof renderTensorVisual>[0],
  node: Parameters<typeof renderTensorVisual>[1],
  report: Parameters<typeof renderTensorVisual>[2],
  mode: Parameters<typeof renderTensorVisual>[3],
  theme?: Parameters<typeof renderTensorVisual>[4],
) => renderTensorVisual(doc, node, report, mode, theme, computations);
import { makeEmptyProject } from '../fixtures/project.ts';

function node(id = 'tensor.result3d'): NodeEntity {
  const operation = !id.endsWith('source3d') && !id.endsWith('result3d');
  return {
    id: 'subject',
    kind: 'node',
    parentId: null,
    name: operation ? 'Conv3D' : '特征张量',
    semantic: {
      role: operation ? 'operation' : id.endsWith('source3d') ? 'tensor-source' : 'tensor-result',
    },
    generation: {
      generatorId: id,
      version: '1.0.0',
      paramSchemaVersion: 1,
      source: {
        kind: 'local',
        params: {
          kernelD: 3,
          kernelH: 3,
          kernelW: 3,
          strideD: 1,
          strideH: 1,
          strideW: 1,
          padding: 'same',
          axis: 'C',
        },
      },
      localKeys: {},
    },
    size: { width: operation ? 76 : 108, height: operation ? 44 : 96 },
    bounds: { x: 0, y: 0, width: 130, height: 140 },
    presentation: { position: { x: 200, y: 200 } },
    ports: operation
      ? { in: { x: 0, y: 22 }, out: { x: 76, y: 22 } }
      : { in: { x: 0, y: 48 }, out: { x: 108, y: 48 } },
    primitives: [
      {
        kind: 'rect',
        x: 0,
        y: 0,
        width: operation ? 76 : 108,
        height: operation ? 44 : 96,
        fill: '#a6bdce',
        stroke: '#445769',
      },
      {
        kind: 'text',
        x: 0,
        y: 100,
        width: 150,
        height: 20,
        text: '旧缓存 32×32×32 C99',
        fontSize: 14,
        color: '#253342',
      },
    ],
  };
}
function report(
  state: 'ready' | 'pending' | 'error' | 'unsupported' = 'ready',
  C = 16,
): AnalysisReport {
  return {
    nodes: {
      subject: {
        state,
        shape: { N: 1, D: 128, H: 128, W: 128, C },
        inputs: [],
        steps: [],
        explanation: '',
        diagnostics: state === 'error' ? ['D 轴不匹配：64 与 128'] : [],
      },
    },
  };
}
const textOf = (primitives: Primitive[]) =>
  primitives
    .filter((p) => p.kind === 'text')
    .map((p) => p.text)
    .join('\n');

describe('tensor-first vector projection', () => {
  test('renders independent spatial axes and channels without turning tensor dimensions into display size', () => {
    const subject = node(),
      doc = makeEmptyProject();
    const before = structuredClone(subject);
    const view = tensorVisual(doc, subject, report(), 'structure');
    expect(textOf(view.primitives)).toContain('128×128×128');
    expect(textOf(view.primitives)).toContain('C16');
    expect(textOf(view.primitives)).not.toContain('C99');
    expect(view.primitives.filter((p) => p.kind === 'polygon').length).toBeGreaterThanOrEqual(2);
    expect(view.primitives.filter((p) => p.kind === 'text').every((p) => p.fontSize >= 14)).toBe(
      true,
    );
    const larger = report();
    larger.nodes.subject.shape!.D = 2048;
    expect(
      tensorVisual(doc, subject, larger, 'structure').primitives.filter((p) => p.kind !== 'text'),
    ).toEqual(view.primitives.filter((p) => p.kind !== 'text'));
    expect(subject).toEqual(before);
  });

  test.each(['pending', 'error'] as const)(
    'does not display stale output dimensions when analysis is %s',
    (state) => {
      const view = tensorVisual(makeEmptyProject(), node(), report(state), 'structure');
      const labels = textOf(view.primitives);
      expect(labels).not.toContain('128×128×128');
      expect(labels).not.toContain('C99');
      expect(labels).toContain(state === 'pending' ? '待配置' : '尺寸冲突');
    },
  );

  test('uses a local mapping for convolution, a sampling grid for pooling, and axis joining for concat', () => {
    const doc = makeEmptyProject(),
      conv = node('tensor.conv3d'),
      pool = node('tensor.pool3d'),
      concat = node('tensor.concat');
    concat.ports.in2 = { x: 0, y: 36 };
    const convView = tensorVisual(doc, conv, report(), 'structure');
    const poolView = tensorVisual(doc, pool, report(), 'structure');
    const concatView = tensorVisual(doc, concat, report(), 'structure');
    expect(
      convView.primitives.some(
        (p) => p.kind === 'polygon' && p.opacity !== undefined && p.opacity < 1,
      ),
    ).toBe(true);
    expect(poolView.primitives.filter((p) => p.kind === 'rect').length).toBeGreaterThan(
      convView.primitives.filter((p) => p.kind === 'rect').length,
    );
    expect(textOf(convView.primitives)).toContain('Conv3D');
    expect(textOf(poolView.primitives)).toContain('Pool3D');
    expect(textOf(concatView.primitives)).toContain('Concat · C');
    expect(concatView.ports.in.y).not.toBe(concatView.ports.in2.y);
    expect(convView.bounds.width).toBeLessThan(180);
    expect(convView.bounds.height).toBeLessThan(100);
  });

  test('figure projection preserves hand-edited size, colors, and label while updating automatic dimensions', () => {
    const subject = node(),
      doc = makeEmptyProject();
    subject.size = { width: 210, height: 72 };
    subject.primitives[0] = {
      kind: 'rect',
      x: 0,
      y: 0,
      width: 210,
      height: 72,
      fill: '#a6bdce',
      stroke: '#445769',
    };
    subject.presentation.fillOverride = '#e7c2ab';
    subject.presentation.labelOverride = '我的跳接特征';
    const view = tensorVisual(doc, subject, report('ready', 32), 'figure');
    const front = view.primitives.find((p) => p.kind === 'rect');
    expect(front).toMatchObject({ width: 210, height: 72, fill: '#e7c2ab' });
    expect(textOf(view.primitives)).toContain('我的跳接特征');
    expect(textOf(view.primitives)).toContain('C32');
    expect(textOf(view.primitives)).not.toContain('C99');
  });

  test('shows the actual per-axis kernel and stride instead of a generic operation label', () => {
    const subject = node('tensor.conv3d');
    if (subject.generation?.source.kind !== 'local') throw Error('fixture');
    subject.generation.source.params = {
      kernelD: 3,
      kernelH: 5,
      kernelW: 3,
      strideD: 1,
      strideH: 2,
      strideW: 1,
    };
    const view = tensorVisual(makeEmptyProject(), subject, report(), 'structure');
    expect(textOf(view.primitives)).toContain('k3×5×3');
    expect(textOf(view.primitives)).toContain('s1×2×1');
  });

  test('new automatic captions honor figure opacity and text color overrides', () => {
    const subject = node();
    subject.presentation.opacityOverride = 0.4;
    subject.presentation.textOverride = '#805544';
    const view = tensorVisual(makeEmptyProject(), subject, report(), 'figure');
    expect(
      view.primitives
        .filter((p) => p.kind === 'text')
        .every((p) => p.color === '#805544' && p.opacity === 0.4),
    ).toBe(true);
  });

  test('new figure captions use the document text palette when there is no local override', () => {
    const doc = makeEmptyProject();
    doc.theme.textColor = '#f4ead8';
    for (const id of ['tensor.result3d', 'tensor.conv3d']) {
      const view = tensorVisual(doc, node(id), report(), 'figure');
      expect(
        view.primitives.filter((p) => p.kind === 'text').every((p) => p.color === '#f4ead8'),
      ).toBe(true);
    }
  });

  test('a multiline operation label keeps its next line and kernel caption apart', () => {
    const subject = node('tensor.conv3d');
    subject.presentation.labelOverride = '支路卷积\n共享输入';
    const view = tensorVisual(makeEmptyProject(), subject, report(), 'figure');
    const lines = view.primitives.filter((p) => p.kind === 'text');
    expect(lines.map((p) => p.text)).toEqual(['支路卷积', '共享输入', 'k3³ · s1']);
    expect(lines[1].y).toBeGreaterThanOrEqual(lines[0].y + lines[0].height);
    expect(lines[2].y).toBeGreaterThanOrEqual(lines[1].y + lines[1].height);
    expect(view.bounds.y + view.bounds.height).toBeGreaterThanOrEqual(lines[2].y + lines[2].height);
  });

  test('add uses a small plus action, not a convolution mapping', () => {
    const subject = node('tensor.add');
    subject.ports.in2 = { x: 0, y: 36 };
    const view = tensorVisual(makeEmptyProject(), subject, report(), 'structure');
    expect(view.primitives.some((p) => p.kind === 'ellipse')).toBe(true);
    expect(textOf(view.primitives)).toContain('⊕');
    expect(
      view.primitives.some((p) => p.kind === 'polygon' && p.opacity !== undefined && p.opacity < 1),
    ).toBe(false);
  });

  test.each([
    ['tensor.conv3d', '2.0.0', 1],
    ['tensor.conv3d', '1.0.0', 2],
    ['plugin.custom-operation', '1.0.0', 1],
    ['tensor.source3d', '2.0.0', 1],
    ['tensor.result3d', '1.0.0', 2],
  ] as const)(
    'preserves the saved vector snapshot for unavailable rule %s %s schema %s',
    (id, version, schema) => {
      const subject = node(id);
      subject.generation!.version = version;
      subject.generation!.paramSchemaVersion = schema;
      subject.primitives = [
        { kind: 'ellipse', x: 7, y: 6, width: 60, height: 40, fill: '#cc4433', stroke: '#553322' },
        {
          kind: 'text',
          x: 0,
          y: 50,
          width: 100,
          height: 20,
          text: '历史图形',
          fontSize: 14,
          color: '#663333',
        },
      ];
      const before = structuredClone(subject);
      for (const mode of ['structure', 'figure'] as const) {
        const view = tensorVisual(makeEmptyProject(), subject, report('unsupported'), mode);
        expect(view.primitives.slice(0, 2)).toEqual(subject.primitives);
        expect(view.primitives.some((p) => p.kind === 'polygon')).toBe(false);
        expect(textOf(view.primitives)).toContain('推导规则未知');
        expect(textOf(view.primitives)).not.toContain('128×128×128');
        expect(textOf(view.primitives)).not.toContain('k3³');
      }
      expect(subject).toEqual(before);
    },
  );

  test('a known result with an unsupported upstream still uses its normal tensor projection without stale dimensions', () => {
    const subject = node('tensor.result3d');
    const view = tensorVisual(makeEmptyProject(), subject, report('unsupported'), 'structure');
    expect(view.primitives.filter((p) => p.kind === 'polygon')).toHaveLength(2);
    expect(textOf(view.primitives)).toContain('推导规则未知');
    expect(textOf(view.primitives)).not.toContain('C99');
    expect(textOf(view.primitives)).not.toContain('128×128×128');
  });

  test('encloses every primitive and label in both workspace modes', () => {
    for (const mode of ['structure', 'figure'] as const) {
      for (const id of [
        'tensor.source3d',
        'tensor.conv3d',
        'tensor.pool3d',
        'tensor.concat',
        'tensor.add',
      ]) {
        const subject = node(id);
        subject.presentation.labelOverride = '自定义显示名称';
        const view = tensorVisual(makeEmptyProject(), subject, report('error'), mode),
          b = view.bounds;
        for (const p of view.primitives) {
          const points =
            p.kind === 'polygon'
              ? p.points
              : [
                  { x: p.x, y: p.y },
                  { x: p.x + p.width, y: p.y + p.height },
                ];
          for (const point of points) {
            expect(point.x).toBeGreaterThanOrEqual(b.x);
            expect(point.y).toBeGreaterThanOrEqual(b.y);
            expect(point.x).toBeLessThanOrEqual(b.x + b.width);
            expect(point.y).toBeLessThanOrEqual(b.y + b.height);
          }
        }
      }
    }
  });
});

test('a reused glyph does not replace the registered operator name', () => {
  const subject = node('example.leaky-relu');
  subject.name = 'LeakyReLU';
  if (subject.generation?.source.kind !== 'local') throw Error('fixture');
  subject.generation.source.params = { alpha: 0.2, dimension: 2 };
  const view = tensorVisual(makeEmptyProject(), subject, report(), 'figure');
  const labels = view.primitives.filter((p) => p.kind === 'text').map((p) => p.text);
  expect(labels).toContain('LeakyReLU');
  expect(labels).not.toContain('ReLU');
  expect(labels).toContain('alpha = 0.2');
});

test('registered output port identities determine the operation projection side', () => {
  const subject = node('tensor.relu');
  subject.ports = { input: { x: 0, y: 22 }, value: { x: 76, y: 22 } };
  const definitions = new Map(computations);
  const definition = definitions.get('tensor.relu')!;
  definitions.set('tensor.relu', {
    ...definition,
    outputPort: 'value',
    inputs: () => [{ id: 'input', role: 'tensor' }],
  });
  const view = renderTensorVisual(
    makeEmptyProject(),
    subject,
    report(),
    'structure',
    'dark',
    definitions,
  );
  expect(view.ports.input).toEqual({ x: 0, y: 22 });
  expect(view.ports.value).toEqual({ x: 84, y: 22 });
});
