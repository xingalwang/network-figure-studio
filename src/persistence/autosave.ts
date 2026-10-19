import {
  fail,
  ok,
  type DocumentStore,
  type ErrorDetail,
  type ProjectDocument,
  type Result,
} from '../core/document/types.ts';

export type AutosaveRepository = { save(doc: ProjectDocument): Promise<void> };
export type AutosaveStatus = {
  kind: 'pending' | 'saving' | 'saved' | 'failed' | 'readonly';
  documentId: string;
  revision: number;
  savedRevision?: number;
  error?: ErrorDetail;
};
export type AutosaveOptions = { delayMs?: number; onStatus?: (status: AutosaveStatus) => void };
export type AutosaveController = { flush(): Promise<Result<void>>; dispose(): void };

export function startAutosave(
  store: DocumentStore,
  repository: AutosaveRepository,
  options: AutosaveOptions = {},
): AutosaveController {
  let pending: ProjectDocument | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<Result<void>> | null = null;
  let savedRevision: number | undefined;
  let disposed = false;
  let ready = false;
  let force = false;
  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const emit = (kind: AutosaveStatus['kind'], error?: ErrorDetail) => {
    if (disposed) return;
    const doc = store.getSnapshot();
    options.onStatus?.({
      kind,
      documentId: doc.id,
      revision: doc.revision,
      savedRevision,
      ...(error ? { error } : {}),
    });
  };

  function drain(): Promise<Result<void>> {
    if (running) return running;
    if (!pending || disposed || store.isReadonly()) {
      force = false;
      return Promise.resolve(ok(undefined));
    }
    const operation = (async (): Promise<Result<void>> => {
      while (pending && (ready || force) && !disposed && !store.isReadonly()) {
        const snapshot = pending;
        pending = null;
        ready = false;
        clearTimer();
        emit('saving');
        try {
          await repository.save(snapshot);
          savedRevision = snapshot.revision;
          emit(store.isReadonly() ? 'readonly' : pending ? 'pending' : 'saved');
        } catch (error) {
          if (!pending) pending = snapshot;
          clearTimer();
          ready = false;
          const detail: ErrorDetail = {
            code:
              error instanceof Error && error.name === 'QuotaExceededError'
                ? 'STORAGE_QUOTA_EXCEEDED'
                : 'AUTOSAVE_FAILED',
            message: `自动保存失败，编辑仍保留在内存中。${error instanceof Error ? error.message : ''}`,
          };
          emit('failed', detail);
          return { ok: false, error: detail };
        }
      }
      return ok(undefined);
    })();
    running = operation.finally(() => {
      running = null;
      force = false;
    });
    return running;
  }

  const schedule = () => {
    if (disposed) return;
    clearTimer();
    ready = false;
    if (store.isReadonly()) {
      pending = null;
      emit('readonly');
      return;
    }
    const snapshot = store.getSnapshot();
    if (snapshot.revision === savedRevision) {
      emit('saved');
      return;
    }
    pending = snapshot;
    emit('pending');
    timer = setTimeout(() => {
      timer = undefined;
      ready = true;
      void drain();
    }, options.delayMs ?? 500);
  };
  const unsubscribe = store.subscribe(schedule);
  schedule();
  return {
    flush() {
      if (disposed) return Promise.resolve(fail('AUTOSAVE_DISPOSED', '自动保存已停止。'));
      if (store.isReadonly()) return Promise.resolve(fail('READONLY', '只读项目不能自动保存。'));
      clearTimer();
      ready = true;
      force = true;
      return drain();
    },
    dispose() {
      disposed = true;
      clearTimer();
      pending = null;
      unsubscribe();
    },
  };
}
