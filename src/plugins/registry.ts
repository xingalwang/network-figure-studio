import type {
  PluginDefinition,
  GeneratorDefinition,
  CanvasCommand,
  PrimitiveDefinition,
  ConnectionPatternDefinition,
} from './sdk.ts';
import { validateParams } from '../core/generation/parameters.ts';
import type {
  ComputationDefinition,
  ComputationRegistry,
} from '../core/computation/definitions.ts';
export type PluginRegistry = {
  generators: ReadonlyMap<string, GeneratorDefinition>;
  commands: ReadonlyMap<string, CanvasCommand>;
  primitives: ReadonlyMap<string, PrimitiveDefinition>;
  connectionPatterns: ReadonlyMap<string, ConnectionPatternDefinition>;
  plugins: ReadonlyMap<string, PluginDefinition>;
  computations: ComputationRegistry;
};
const identifier = (s: string) =>
  /^[\w.-]+$/.test(s) && !['constructor', 'prototype', '__proto__'].includes(s);
export function createPluginRegistry(definitions: PluginDefinition[]): PluginRegistry {
  const plugins = new Map<string, PluginDefinition>(),
    generators = new Map<string, GeneratorDefinition>(),
    commands = new Map<string, CanvasCommand>(),
    primitives = new Map<string, PrimitiveDefinition>(),
    connectionPatterns = new Map<string, ConnectionPatternDefinition>(),
    computations = new Map<string, ComputationDefinition>(),
    computationAliases = new Set<string>();
  for (const p of definitions) {
    const m = p.manifest;
    if (
      m.apiVersion !== 1 ||
      !identifier(m.id) ||
      !/^\d+\.\d+\.\d+$/.test(m.version) ||
      plugins.has(m.id)
    )
      throw new Error('插件清单版本或标识无效。');
    plugins.set(m.id, p);
  }
  const done = new Set<string>();
  function visit(id: string, path = new Set<string>()) {
    if (path.has(id)) throw new Error('插件存在循环依赖。');
    if (done.has(id)) return;
    const p = plugins.get(id);
    if (!p) throw new Error('插件依赖缺失。');
    const next = new Set(path).add(id);
    for (const [key, version] of Object.entries(p.manifest.dependencies ?? {})) {
      if (plugins.get(key)?.manifest.version !== version) throw new Error('插件依赖版本不匹配。');
      visit(key, next);
    }
    done.add(id);
  }
  for (const p of definitions) {
    visit(p.manifest.id);
    for (const g of [...(p.generators ?? []), ...(p.primitives ?? [])]) {
      if (
        !identifier(g.id) ||
        generators.has(g.id) ||
        !/^\d+\.\d+\.\d+$/.test(g.version) ||
        !Number.isInteger(g.paramSchemaVersion) ||
        g.paramSchemaVersion < 1 ||
        !validateParams(g.fields, g.defaults).ok
      )
        throw new Error('生成器声明无效或重复。');
      generators.set(g.id, g);
    }
    for (const primitive of p.primitives ?? []) {
      if (typeof primitive.category !== 'string' || !primitive.category.trim())
        throw new Error('基元分类无效。');
      primitives.set(primitive.id, primitive);
    }
    for (const pattern of p.connectionPatterns ?? []) {
      if (
        !identifier(pattern.id) ||
        connectionPatterns.has(pattern.id) ||
        !/^\d+\.\d+\.\d+$/.test(pattern.version) ||
        !validateParams(pattern.fields, pattern.defaults).ok ||
        typeof pattern.isAvailable !== 'function' ||
        typeof pattern.connect !== 'function'
      )
        throw new Error('连接模式声明无效或重复。');
      connectionPatterns.set(pattern.id, pattern);
    }
    for (const c of p.commands ?? []) {
      if (
        !identifier(c.id) ||
        commands.has(c.id) ||
        c.permissions.some((x) => !['move', 'label', 'fill', 'edgeStyle'].includes(x))
      )
        throw new Error('命令声明无效或重复。');
      commands.set(c.id, c);
    }
  }
  for (const plugin of definitions)
    for (const definition of plugin.computations ?? []) {
      const generator = generators.get(definition.generatorId),
        operation = definition.operation;
      if (
        !generator ||
        computations.has(definition.generatorId) ||
        (definition.kind !== undefined &&
          (!identifier(definition.kind) ||
            (definition.role === 'operation' && computationAliases.has(definition.kind)) ||
            (generators.has(definition.kind) && definition.kind !== definition.generatorId))) ||
        generator.version !== definition.version ||
        generator.paramSchemaVersion !== definition.paramSchemaVersion ||
        !['tensor-source', 'tensor-result', 'operation'].includes(definition.role) ||
        !identifier(definition.outputPort) ||
        typeof definition.dimension !== 'function' ||
        typeof definition.inputs !== 'function' ||
        typeof definition.infer !== 'function' ||
        (definition.validateParameters !== undefined &&
          typeof definition.validateParameters !== 'function') ||
        (definition.role === 'operation' &&
          (!operation ||
            !Number.isSafeInteger(operation.minInputs) ||
            !Number.isSafeInteger(operation.maxInputs) ||
            operation.minInputs < 1 ||
            operation.maxInputs < operation.minInputs ||
            operation.maxInputs > 64 ||
            !operation.dimensions.length ||
            operation.dimensions.some((d) => d !== 2 && d !== 3) ||
            typeof operation.prepareParams !== 'function' ||
            typeof operation.resultGeneratorId !== 'function'))
      )
        throw new Error('计算定义无效、重复或没有匹配的生成器版本。');
      const ports = definition.inputs(generator.defaults);
      if (
        !Array.isArray(ports) ||
        ports.length > 64 ||
        new Set(ports.map((p) => p.id)).size !== ports.length ||
        ports.some(
          (p) =>
            !identifier(p.id) ||
            p.id === definition.outputPort ||
            !['tensor', 'operation'].includes(p.role),
        ) ||
        (definition.role === 'tensor-source' && ports.length !== 0) ||
        (definition.role === 'tensor-result' &&
          (ports.length !== 1 || ports[0].role !== 'operation')) ||
        (definition.role === 'operation' &&
          (ports.length < operation!.minInputs ||
            ports.length > operation!.maxInputs ||
            ports.some((p) => p.role !== 'tensor')))
      )
        throw new Error('计算端口声明无效。');
      computations.set(definition.generatorId, definition);
      if (definition.role === 'operation' && definition.kind)
        computationAliases.add(definition.kind);
    }
  for (const definition of computations.values()) {
    if (definition.role !== 'operation' || !definition.operation) continue;
    for (const dimension of definition.operation.dimensions) {
      const output = computations.get(definition.operation.resultGeneratorId(dimension));
      if (
        output?.role !== 'tensor-result' ||
        output.dimension(generators.get(output.generatorId)!.defaults) !== dimension
      )
        throw new Error('计算操作的结果生成器必须注册为对应维数的结果张量。');
    }
  }
  return { plugins, generators, commands, primitives, connectionPatterns, computations };
}
export { validateParams } from '../core/generation/parameters.ts';
