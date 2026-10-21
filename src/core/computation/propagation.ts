import type { ProjectDocument } from '../document/types.ts';
import type { AnalysisEntry, AnalysisReport, TensorShape } from './types.ts';
import type { ComputationRegistry, RuleResult } from './definitions.ts';
import { paramsOf, shapeDimension, shapeAxes } from './catalog.ts';
import { entry, full } from './rules.ts';
import { inbound, isOperation, isTensor } from './topology.ts';
import { defaultComputations, resolveComputation } from './registry.ts';
import { isMathExpression } from './formulas.ts';

function checkedResult(result: RuleResult, dimension: 2 | 3 | null): RuleResult {
  if (
    !result ||
    !['ready', 'pending', 'error', 'unsupported'].includes(result.state) ||
    typeof result.explanation !== 'string' ||
    !Array.isArray(result.steps) ||
    !result.steps.every((s) => typeof s === 'string') ||
    !Array.isArray(result.diagnostics) ||
    !result.diagnostics.every((s) => typeof s === 'string')
  )
    throw Error('计算规则返回了无效的诊断结果。');
  if (
    result.formulas !== undefined &&
    (!Array.isArray(result.formulas) ||
      result.formulas.length > 64 ||
      result.formulas.some(
        (formula) =>
          !formula ||
          typeof formula.label !== 'string' ||
          !isMathExpression(formula.expression) ||
          (formula.description !== undefined && typeof formula.description !== 'string'),
      ))
  )
    throw Error('计算规则返回了无效的公式。');
  if (result.state === 'ready') {
    const shape = result.shape;
    if (
      !shape ||
      !full(shape) ||
      Object.keys(shape).some(
        (a) => !shapeAxes(shapeDimension(shape)).includes(a as keyof TensorShape),
      ) ||
      (result.parameterCount !== undefined &&
        (!Number.isSafeInteger(result.parameterCount) || result.parameterCount < 0))
    )
      throw Error('计算规则返回了无效的张量规格或参数量。');
    if (dimension && shapeDimension(shape) !== dimension)
      throw Error(`计算定义为 ${dimension}D，规则输出的张量秩不匹配。`);
  }
  if (result.state === 'error' || result.state === 'unsupported') {
    const { shape: _shape, parameterCount: _count, formulas: _formulas, ...safe } = result;
    return safe;
  }
  return result;
}

/** Derived report only. Missing definitions never fall back to a built-in implementation. */
export function analyzeDocument(
  doc: ProjectDocument,
  computations: ComputationRegistry = defaultComputations(),
): AnalysisReport {
  const nodes: Record<string, AnalysisEntry> = {},
    visiting = new Set<string>();
  const analyze = (id: string): AnalysisEntry => {
    if (nodes[id]) return nodes[id];
    const entity = doc.entities[id];
    const definition = resolveComputation(entity, computations);
    if (entity?.kind !== 'node' || !entity.semantic || !definition)
      return (nodes[id] = entry(
        'unsupported',
        '此对象没有匹配版本的静态计算规则；图形仍可编辑和导出。',
        [
          entity?.generation
            ? `${entity.generation.generatorId}@${entity.generation.version} / 参数格式 ${entity.generation.paramSchemaVersion} 没有匹配的 ${entity.kind === 'node' ? (entity.semantic?.role ?? '对象') : '对象'} 计算定义；未套用其他版本规则。`
            : '对象没有生成器绑定，无法匹配计算规则。',
        ],
      ));
    if (entity.generation?.source.kind !== 'local')
      return (nodes[id] = entry(
        'unsupported',
        '计算对象需要独立参数来源，托管子层尚未注册计算语义。',
      ));
    if (visiting.has(id))
      return entry('error', '数据流存在循环，无法按先后顺序推导。', [
        '数据流形成循环；请移除回到上游的计算连线。',
      ]);
    visiting.add(id);
    let value = entry('pending', '等待输入或参数配置。');
    try {
      // Rules receive detached values so even a faulty extension cannot edit document state.
      const p = structuredClone(paramsOf(entity));
      const dimension = definition.dimension(p);
      const validation = definition.validateParameters?.(p);
      if (validation) value = { ...value, ...checkedResult(validation, dimension) };
      else if (definition.role === 'tensor-source') {
        const incoming = Object.values(doc.entities).some(
          (e) =>
            e.kind === 'edge' &&
            e.meaning === 'dataflow' &&
            e.target.kind === 'port' &&
            e.target.entityId === id,
        );
        value = incoming
          ? entry('error', '源张量只能声明输入数据，不接受其他运算产生的数据。', [
              '源数据块只提供输出，不接受入站数据流；请移除回连，或将输出连接到后续操作。',
            ])
          : { ...value, ...checkedResult(definition.infer(p, []), dimension) };
      } else {
        const links = inbound(doc, id),
          ports = definition.inputs(p);
        if (
          !Array.isArray(ports) ||
          ports.length < 1 ||
          ports.length > 64 ||
          new Set(ports.map((port) => port.id)).size !== ports.length
        )
          throw Error('计算规则返回了无效的输入端口。');
        const inputs = ports.flatMap((port) =>
          links
            .filter((link) => link.portId === port.id)
            .map((link) => ({ ...link, port, analysis: analyze(link.entityId) })),
        );
        value.inputs = inputs.map(({ entityId, portId, analysis }) => ({
          entityId,
          portId,
          shape: analysis.shape,
        }));
        const malformed =
          links.some((link) => {
            const source = doc.entities[link.entityId];
            const upstream = resolveComputation(source, computations);
            return (
              !ports.some((port) => port.id === link.portId) ||
              (upstream
                ? link.sourcePortId !== upstream.outputPort
                : source?.kind !== 'node' || !Object.hasOwn(source.ports, link.sourcePortId))
            );
          }) ||
          ports.some(
            (port) =>
              !Object.hasOwn(entity.ports, port.id) ||
              links.filter((link) => link.portId === port.id).length > 1,
          );
        const wrongRole = inputs.some((input) =>
          input.port.role === 'operation'
            ? !isOperation(doc.entities[input.entityId])
            : !isTensor(doc.entities[input.entityId]),
        );
        if (malformed || wrongRole)
          value = {
            ...value,
            state: 'error',
            diagnostics: ['数据流端口或对象类型不成立；运算接收张量，结果张量接收运算输出。'],
          };
        else if (inputs.length < ports.length)
          value.diagnostics = [
            `缺少 ${ports
              .filter((port) => !links.some((link) => link.portId === port.id))
              .map((port) => port.id)
              .join('、')} 输入。`,
          ];
        else if (inputs.some((input) => input.analysis.state === 'error'))
          value = {
            ...value,
            state: 'error',
            diagnostics: inputs
              .filter((input) => input.analysis.state === 'error')
              .map(
                (input) =>
                  `上游“${doc.entities[input.entityId]?.name ?? input.entityId}”：${input.analysis.diagnostics.join(' ')}`,
              ),
          };
        else if (inputs.some((input) => input.analysis.state === 'unsupported'))
          value = {
            ...value,
            state: 'unsupported',
            explanation: '上游计算规则不可用，当前步骤未推导输出。',
            diagnostics: inputs
              .filter((input) => input.analysis.state === 'unsupported')
              .map(
                (input) =>
                  `上游“${doc.entities[input.entityId]?.name ?? input.entityId}”：${input.analysis.diagnostics.join(' ') || input.analysis.explanation}`,
              ),
          };
        else if (
          inputs.some(
            (input) =>
              input.analysis.state !== 'ready' ||
              !input.analysis.shape ||
              !full(input.analysis.shape),
          )
        )
          value.diagnostics = ['输入规格尚未完整配置；未生成猜测尺寸。'];
        else if (
          dimension &&
          inputs.some((input) => shapeDimension(input.analysis.shape!) !== dimension)
        )
          value = {
            ...value,
            state: 'error',
            diagnostics: [`操作或结果块为 ${dimension}D，上游输出秩不一致。`],
          };
        else {
          value = {
            ...value,
            ...checkedResult(
              definition.infer(p, structuredClone(inputs.map((input) => input.analysis.shape!))),
              dimension,
            ),
          };
          if (definition.role === 'tensor-result' && value.state === 'ready' && !value.steps.length)
            value.steps = [...inputs[0].analysis.steps];
        }
      }
    } catch (error) {
      value = {
        ...entry('error', '计算定义无法推导当前对象。', [
          error instanceof Error ? error.message : '计算定义执行失败。',
        ]),
        inputs: value.inputs,
      };
    }
    visiting.delete(id);
    nodes[id] = value;
    return value;
  };
  for (const entity of Object.values(doc.entities))
    if (entity.kind === 'node' && entity.semantic) analyze(entity.id);
  return { nodes };
}
