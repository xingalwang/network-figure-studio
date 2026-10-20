import { fail, ok, type Params, type Result } from '../document/types.ts';
import type { ParamField } from './types.ts';

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
