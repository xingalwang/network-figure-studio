import {
  fail,
  type ProjectDocument,
  type GenerationServices,
  type DocumentStore,
  type CommitResult,
  type ResolvedOperation,
} from '../document/types.ts';
import { validateDocument } from '../document/validate.ts';
import { applyOperations } from './apply.ts';
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
}
export function createDocumentStore(
  initial: ProjectDocument,
  services?: GenerationServices,
  onSubscriberError: (error: unknown) => void = (error) =>
    console.error('Document subscriber failed', error),
): DocumentStore {
  const valid = validateDocument(initial);
  if (!valid.ok) throw new Error(valid.error.message);
  let doc = freeze(structuredClone(initial)),
    readonly = false;
  const past: ProjectDocument[] = [],
    future: ProjectDocument[] = [],
    listeners = new Set<() => void>();
  const emit = () => {
    for (const fn of [...listeners]) {
      try {
        fn();
      } catch (error) {
        try {
          onSubscriberError(error);
        } catch (reportError) {
          console.error(reportError);
        }
      }
    }
  };
  const change = (value: ProjectDocument): CommitResult => {
    doc = freeze({ ...value, revision: doc.revision + 1 });
    emit();
    return { ok: true, document: doc };
  };
  return {
    getSnapshot: () => doc,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    canUndo: () => !readonly && past.length > 0,
    canRedo: () => !readonly && future.length > 0,
    isReadonly: () => readonly,
    setReadonly(v) {
      readonly = v;
      emit();
    },
    async dispatch(proposal) {
      if (readonly) return fail('READONLY', '此项目在另一个标签页编辑；本页只读。');
      if (proposal.baseRevision !== doc.revision)
        return fail('STALE_REVISION', '项目已变化，请重新执行。');
      const base = doc,
        ops: ResolvedOperation[] = [];
      try {
        for (const op of proposal.operations) {
          if (op.kind === 'generate') {
            if (!services) return fail('GENERATOR_UNAVAILABLE', '生成器不可用；现有图形仍可编辑。');
            const result = await services.prepare(base, op);
            if (!result.ok) return result;
            ops.push(...result.value);
          } else ops.push(op);
        }
        if (doc !== base || readonly)
          return fail('STALE_REVISION', '项目已变化，旧生成结果未应用。');
        if (!ops.length) return { ok: true, document: doc };
        const result = applyOperations(base, ops);
        if (!result.ok) return result;
        past.push(base);
        if (past.length > 100) past.shift();
        future.length = 0;
        return change(result.value);
      } catch (error) {
        return fail(
          'OPERATION_FAILED',
          error instanceof Error ? error.message : '操作未完成，原项目保持不变。',
        );
      }
    },
    undo() {
      if (readonly) return fail('READONLY', '当前为只读。');
      const previous = past.pop();
      if (!previous) return fail('NO_HISTORY', '没有可撤销的操作。');
      future.push(doc);
      return change(previous);
    },
    redo() {
      if (readonly) return fail('READONLY', '当前为只读。');
      const next = future.pop();
      if (!next) return fail('NO_HISTORY', '没有可重做的操作。');
      past.push(doc);
      return change(next);
    },
  };
}
