import type {
  PluginDefinition,
  GeneratorDefinition,
  CanvasCommand,
  ParamField,
  PrimitiveDefinition,
  ConnectionPatternDefinition,
} from './sdk.ts';
import { fail, ok, type Params, type Result } from '../core/document/types.ts';
export type PluginRegistry = {
  generators: ReadonlyMap<string, GeneratorDefinition>;
  commands: ReadonlyMap<string, CanvasCommand>;
  primitives: ReadonlyMap<string, PrimitiveDefinition>;
  connectionPatterns: ReadonlyMap<string, ConnectionPatternDefinition>;
  plugins: ReadonlyMap<string, PluginDefinition>;
};
const identifier = (s: string) =>
  /^[\w.-]+$/.test(s) && !['constructor', 'prototype', '__proto__'].includes(s);
export function createPluginRegistry(definitions: PluginDefinition[]): PluginRegistry {
  const plugins = new Map<string, PluginDefinition>(),
    generators = new Map<string, GeneratorDefinition>(),
    commands = new Map<string, CanvasCommand>(),
    primitives = new Map<string, PrimitiveDefinition>(),
    connectionPatterns = new Map<string, ConnectionPatternDefinition>();
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
  return { plugins, generators, commands, primitives, connectionPatterns };
}
export function validateParams(fields: ParamField[], params: Params): Result<Params> {
  const valueOk = (f: ParamField, v: unknown): boolean => {
    switch (f.type) {
      case 'number':
        if (f.nullable && v === null) return true;
        return (
          typeof v === 'number' &&
          Number.isFinite(v) &&
          v >= f.min &&
          v <= f.max &&
          (f.step !== 1 || Number.isInteger(v))
        );
      case 'text':
        return typeof v === 'string';
      case 'boolean':
        return typeof v === 'boolean';
      case 'color':
        return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
      case 'enum':
        return f.options.some((o) => o.value === v);
      case 'list':
        return Array.isArray(v) && v.length <= 1000 && v.every((x) => valueOk(f.item, x));
    }
  };
  if (!params || Array.isArray(params) || typeof params !== 'object')
    return fail('INVALID_PARAMS', '参数格式无效。');
  const bad = fields.find((f) => !valueOk(f, params[f.key]));
  if (bad) return fail('INVALID_PARAMS', `请检查“${bad.label}”。`);
  if (Object.keys(params).some((k) => k !== '__slots' && !fields.some((f) => f.key === k)))
    return fail('INVALID_PARAMS', '包含未声明的参数。');
  if (
    params.__slots !== undefined &&
    (!params.__slots || Array.isArray(params.__slots) || typeof params.__slots !== 'object')
  )
    return fail('INVALID_PARAMS', '子层覆盖参数无效。');
  return ok(structuredClone(params));
}
