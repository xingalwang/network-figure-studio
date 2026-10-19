import type { NodeEntity, ProjectDocument } from '../document/types.ts';
import type { AnalysisEntry, AnalysisReport, TensorShape } from './types.ts';
import { tensorKind, tensorDimension, paramsOf, shapeAxes, shapeDimension } from './catalog.ts';
import { entry, full, positive, applyOperationRule } from './rules.ts';
import { inbound, isOperation, isTensor } from './topology.ts';

export function analyzeDocument(doc: ProjectDocument): AnalysisReport {
  const nodes: Record<string, AnalysisEntry> = {},
    visiting = new Set<string>();
  const analyze = (id: string): AnalysisEntry => {
    if (nodes[id]) return nodes[id];
    const entity = doc.entities[id],
      kind = tensorKind(entity);
    if (!entity || entity.kind !== 'node' || !kind)
      return (nodes[id] = entry(
        'unsupported',
        '此对象没有可用的静态计算规则；图形仍可编辑和导出。',
      ));
    if (entity.generation?.version !== '1.0.0' || entity.generation.paramSchemaVersion !== 1)
      return (nodes[id] = entry('unsupported', '该计算对象的生成器版本没有匹配的静态规则。', [
        '版本不匹配：需要生成器 1.0.0、参数格式版本 1；没有套用当前规则猜测输出。',
      ]));
    if (visiting.has(id))
      return entry('error', '数据流存在循环，无法按先后顺序推导。', [
        '数据流形成循环；请移除回到上游的计算连线。',
      ]);
    visiting.add(id);
    const p = paramsOf(entity),
      dimension = tensorDimension(entity) ?? 3,
      dimensions = shapeAxes(dimension);
    let result: AnalysisEntry;
    if (kind === 'source') {
      if (
        Object.values(doc.entities).some(
          (edge) =>
            edge.kind === 'edge' &&
            edge.meaning === 'dataflow' &&
            edge.target.kind === 'port' &&
            edge.target.entityId === id,
        )
      ) {
        visiting.delete(id);
        return (nodes[id] = entry('error', '源张量只能声明输入数据，不接受其他运算产生的数据。', [
          '源数据块只提供 out 输出，不接受入站数据流；请移除回连，或将输出连接到后续操作。',
        ]));
      }
      const shape = Object.fromEntries(
        dimensions.map((d) => [d, positive(p[d]) ? p[d] : null]),
      ) as TensorShape;
      const invalid = dimensions.filter(
        (d) => p[d] !== null && p[d] !== undefined && !positive(p[d]),
      );
      result = entry(
        invalid.length ? 'error' : full(shape) ? 'ready' : 'pending',
        '源张量声明真实数据规格；显示大小与厚度不参与计算。',
        invalid.map((d) => `${d} 必须是正整数或待配置。`),
      );
      if (!invalid.length) result.shape = shape;
      result.parameterCount = 0;
      result.steps = [
        `张量按 ${dimensions.join(' × ')} 表示：${dimensions.map((d) => shape[d] ?? '?').join(' × ')}`,
      ];
      if (result.state === 'pending')
        result.diagnostics.push(
          `待配置：${dimensions.filter((d) => shape[d] === null).join('、')}。`,
        );
    } else {
      const links = inbound(doc, id),
        expected = kind === 'concat' || kind === 'add' ? Number(p.inputCount) : 1;
      if (
        (kind === 'concat' || kind === 'add') &&
        (!positive(expected) || expected < 2 || expected > 8)
      ) {
        const missing = p.inputCount === null || p.inputCount === undefined;
        result = entry(missing ? 'pending' : 'error', '合并需要明确的输入数。', [
          missing ? '待配置合并输入数。' : '合并输入数必须为 2 至 8 的整数。',
        ]);
        visiting.delete(id);
        nodes[id] = result;
        return result;
      }
      const ports = Array.from({ length: expected }, (_, i) => (i === 0 ? 'in' : `in${i + 1}`));
      const malformed =
        links.some((l) => !ports.includes(l.portId) || l.sourcePortId !== 'out') ||
        ports.some((port) => links.filter((l) => l.portId === port).length > 1);
      const inputs = ports.flatMap((port) =>
        links
          .filter((l) => l.portId === port)
          .map((l) => ({ ...l, analysis: analyze(l.entityId) })),
      );
      result = entry('pending', '等待输入或参数配置。');
      result.inputs = inputs.map(({ entityId, portId, analysis }) => ({
        entityId,
        portId,
        shape: analysis.shape,
      }));
      const expectedRole = kind === 'result' ? 'operation' : 'tensor';
      const wrongRole = inputs.some((i) =>
        expectedRole === 'operation'
          ? !isOperation(doc.entities[i.entityId])
          : !isTensor(doc.entities[i.entityId]),
      );
      if (malformed || wrongRole) {
        result.state = 'error';
        result.diagnostics = ['数据流端口或对象类型不成立；运算接收张量，结果张量接收运算输出。'];
      } else if (inputs.length < ports.length) {
        result.diagnostics = [
          `缺少 ${ports.filter((port) => !links.some((l) => l.portId === port)).join('、')} 输入。`,
        ];
      } else if (inputs.some((i) => i.analysis.state === 'error')) {
        result.state = 'error';
        result.diagnostics = inputs.flatMap((i) =>
          i.analysis.state === 'error'
            ? [
                `上游“${doc.entities[i.entityId]?.name ?? i.entityId}”：${i.analysis.diagnostics.join(' ')}`,
              ]
            : [],
        );
      } else if (inputs.some((i) => i.analysis.state === 'unsupported')) {
        result.state = 'unsupported';
        result.explanation = '上游计算规则不可用，当前步骤未推导输出。';
        result.diagnostics = inputs
          .filter((i) => i.analysis.state === 'unsupported')
          .map(
            (i) =>
              `上游“${doc.entities[i.entityId]?.name ?? i.entityId}”：${i.analysis.diagnostics.join(' ') || i.analysis.explanation}`,
          );
      } else if (
        inputs.some(
          (i) => i.analysis.state !== 'ready' || !i.analysis.shape || !full(i.analysis.shape),
        )
      ) {
        result.diagnostics = ['输入规格尚未完整配置；未生成猜测尺寸。'];
      } else if (kind === 'result' && shapeDimension(inputs[0].analysis.shape!) !== dimension) {
        result.state = 'error';
        result.diagnostics = [
          `结果块为 ${dimension}D，上游输出为 ${shapeDimension(inputs[0].analysis.shape!)}D，秩不一致。`,
        ];
      } else if (kind === 'result') {
        result = {
          ...result,
          state: 'ready',
          shape: structuredClone(inputs[0].analysis.shape),
          parameterCount: 0,
          steps: [...inputs[0].analysis.steps],
          explanation: '此块是产生操作的输出，真实规格由上游推导，不能单独填写。',
          diagnostics: [],
        };
      } else {
        result = {
          ...result,
          ...applyOperationRule(
            kind,
            p,
            inputs.map((i) => i.analysis.shape!),
          ),
        };
      }
    }
    visiting.delete(id);
    nodes[id] = result;
    return result;
  };
  for (const entity of Object.values(doc.entities))
    if (entity.kind === 'node' && entity.semantic) analyze(entity.id);
  return { nodes };
}
