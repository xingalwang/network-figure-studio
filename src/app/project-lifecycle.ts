import { createDocumentStore } from '../core/commands/store.ts';
import { createProject } from '../core/document/codec.ts';
import { createGenerationServices } from '../core/generation/merge.ts';
import type { DocumentStore, Params, ProjectDocument } from '../core/document/types.ts';
import type { PluginRegistry } from '../plugins/registry.ts';
import { startAutosave, type AutosaveController } from '../persistence/autosave.ts';
import type { ProjectRepository } from '../persistence/indexeddb.ts';
import { acquireProjectLock, type ProjectLease } from '../persistence/project-lock.ts';
import {
  saveProject,
  type ProjectDestination,
  type ProjectFileBackend,
} from '../persistence/project-files.ts';
import { createEditorSession, type EditorSession } from './session.ts';
import { initialProjectView } from './project-view.ts';

export type ProjectBundle = { store: DocumentStore; session: EditorSession };
type ProjectOrigin = 'restore' | 'file' | 'new';
export type ProjectLifecycleState = {
  bundle: ProjectBundle | null;
  busy: boolean;
  lockMode: ProjectLease['kind'] | 'loading';
  autoStatus: string;
  fileStatus: string;
  error: string;
  notice: string;
};
type Runtime = {
  bundle: ProjectBundle;
  origin: ProjectOrigin;
  lease: ProjectLease;
  autosave?: AutosaveController;
  destination?: ProjectDestination;
  fileRevision?: number;
  safeRevision: number;
  autosavedRevision?: number;
  checkpoint: string;
  unsubscribe: (() => void)[];
};

const signature = (generatorId: string, params: Params) => JSON.stringify([generatorId, params]);
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Owns the document, its lease, and every writer for one mounted application. */
export function createProjectLifecycle(repository: ProjectRepository, registry: PluginRegistry) {
  let state: ProjectLifecycleState = {
    bundle: null,
    busy: false,
    lockMode: 'loading',
    autoStatus: '正在连接本地存储',
    fileStatus: '尚未保存文件',
    error: '',
    notice: '',
  };
  let current: Runtime | undefined;
  let disposed = false;
  const listeners = new Set<() => void>();
  const patch = (next: Partial<ProjectLifecycleState>) => {
    if (disposed) return;
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  };

  function generationDirty(runtime: Runtime) {
    const session = runtime.bundle.session.getSnapshot();
    const value = signature(session.generatorId, session.params);
    if (session.draft) return value !== signature(session.generatorId, session.draft.params);
    return (
      value !== runtime.checkpoint &&
      value !==
        signature(session.generatorId, registry.generators.get(session.generatorId)!.defaults)
    );
  }
  const fileDirty = (runtime: Runtime) =>
    runtime.bundle.store.getSnapshot().revision !== runtime.safeRevision;
  function confirmSwitch(runtime: Runtime) {
    const draft = generationDirty(runtime);
    const file = runtime.lease.kind === 'unsupported' && fileDirty(runtime);
    if (!draft && !file) return true;
    return window.confirm(
      `${draft ? '有尚未应用或放入画布的生成参数。' : ''}${file ? '工程修改尚未确认写入文件；发起下载不代表已落盘。' : ''}继续将丢弃这些修改，是否继续？`,
    );
  }

  async function release(runtime: Runtime) {
    runtime.autosave?.dispose();
    runtime.unsubscribe.forEach((unsubscribe) => unsubscribe());
    await runtime.lease.release();
  }

  async function install(candidate: ProjectDocument, origin: ProjectOrigin) {
    patch({
      bundle: null,
      lockMode: 'loading',
      autoStatus: '正在连接本地存储',
      fileStatus: '尚未保存文件',
      error: '',
      notice: '',
    });
    let lease = await acquireProjectLock(candidate.id, {
      onAvailable: () => {
        if (current?.lease === lease) patch({ notice: '另一标签页已退出。可点击“接管编辑”继续。' });
      },
    });
    if (disposed) {
      await lease.release();
      return;
    }
    let doc = candidate;
    // A restore candidate is only a hint until we hold its write lock. Files are explicit user input.
    if (lease.kind === 'writable' && origin === 'restore') {
      try {
        doc = (await repository.load(candidate.id)) ?? candidate;
      } catch (error) {
        await lease.release();
        lease = {
          kind: 'failed',
          projectId: candidate.id,
          release: async () => {},
          error: { code: 'RESTORE_FAILED', message: `无法重新读取恢复项目：${message(error)}` },
        };
      }
    }
    if (disposed) {
      await lease.release();
      return;
    }
    const store = createDocumentStore(doc, createGenerationServices(registry));
    store.setReadonly(lease.kind !== 'writable' && lease.kind !== 'unsupported');
    const session = createEditorSession(store, registry);
    if (Object.keys(doc.entities).length) {
      const initialView = initialProjectView(doc);
      session.setWorkspace(initialView.workspace);
      session.select(initialView.selection);
    }
    const initial = session.getSnapshot();
    const runtime: Runtime = {
      bundle: { store, session },
      origin,
      lease,
      safeRevision: doc.revision,
      checkpoint: signature(initial.generatorId, initial.params),
      unsubscribe: [],
    };
    let previous = initial;
    runtime.unsubscribe.push(
      session.subscribe(() => {
        const next = session.getSnapshot();
        // Placement/application and explicit cancellation consume the current generator work.
        if ((previous.draft && !next.draft) || (previous.placing && !next.placing))
          runtime.checkpoint = signature(next.generatorId, next.params);
        previous = next;
      }),
    );
    runtime.unsubscribe.push(
      store.subscribe(() => {
        if (
          runtime.fileRevision !== undefined &&
          store.getSnapshot().revision !== runtime.fileRevision
        )
          patch({ fileStatus: '文件有未保存修改' });
      }),
    );
    current = runtime;
    patch({
      bundle: runtime.bundle,
      lockMode: lease.kind,
      autoStatus:
        lease.kind === 'writable'
          ? '有未保存修改'
          : lease.kind === 'unsupported'
            ? '独立文件模式'
            : lease.kind === 'readonly'
              ? '只读 · 另一标签页正在编辑'
              : '只读 · 无法取得项目锁',
      notice:
        lease.kind === 'unsupported'
          ? '此浏览器不支持项目锁；请使用工程文件保存，不启用自动恢复写入。'
          : '',
      error: lease.kind === 'failed' ? lease.error.message : '',
    });
    if (lease.kind === 'writable') {
      runtime.autosave = startAutosave(store, repository, {
        onStatus(status) {
          if (current !== runtime) return;
          runtime.autosavedRevision = status.savedRevision;
          patch({
            autoStatus:
              status.kind === 'saved'
                ? '已存于浏览器'
                : status.kind === 'saving'
                  ? '正在自动保存'
                  : status.kind === 'failed'
                    ? '自动保存失败'
                    : '有未保存修改',
            ...(status.kind === 'failed' ? { error: status.error?.message ?? '自动保存失败' } : {}),
          });
        },
      });
    }
  }

  async function switchProject(
    doc: ProjectDocument,
    origin: 'file' | 'new' = 'file',
  ): Promise<boolean> {
    if (state.busy || disposed) return false;
    patch({ busy: true });
    try {
      const runtime = current;
      if (runtime) {
        if (!confirmSwitch(runtime)) return false;
        const flushed = await runtime.autosave?.flush();
        if (flushed && !flushed.ok) {
          patch({ error: flushed.error.message });
          return false;
        }
        runtime.bundle.store.setReadonly(true);
        current = undefined;
        await release(runtime);
      }
      await install(doc, origin);
      return !disposed && state.bundle?.store.getSnapshot().id === doc.id;
    } finally {
      patch({ busy: false });
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async start() {
      if (state.busy || current || disposed) return;
      patch({ busy: true });
      try {
        let candidate: ProjectDocument | null = null;
        let error = '';
        try {
          candidate = await repository.latest();
        } catch (cause) {
          error = message(cause);
        }
        if (disposed) return;
        await install(candidate ?? createProject('未命名架构图', 2), candidate ? 'restore' : 'new');
        if (error) patch({ error });
      } finally {
        patch({ busy: false });
      }
    },
    switchProject,
    async retryLock() {
      const runtime = current;
      if (
        !runtime ||
        state.busy ||
        !['readonly', 'failed'].includes(runtime.lease.kind) ||
        !confirmSwitch(runtime)
      )
        return;
      patch({ busy: true });
      try {
        current = undefined;
        await release(runtime);
        await install(runtime.bundle.store.getSnapshot(), runtime.origin);
      } finally {
        patch({ busy: false });
      }
    },
    async save(copy = false, backend?: ProjectFileBackend) {
      const runtime = current;
      if (!runtime || state.busy) return;
      const result = await saveProject(
        runtime.bundle.store.getSnapshot(),
        copy ? undefined : runtime.destination,
        backend,
      );
      if (current !== runtime) return;
      if (result.kind === 'written') {
        runtime.destination = result.destination;
        runtime.fileRevision = result.revision;
        runtime.safeRevision = result.revision;
        patch({
          fileStatus:
            runtime.bundle.store.getSnapshot().revision === result.revision
              ? '文件已保存'
              : '文件有未保存修改',
        });
      } else if (result.kind === 'download-started')
        patch({ fileStatus: `已发起下载 · r${result.revision}` });
      else if (result.kind === 'failed') patch({ error: result.error.message });
    },
    hasUnsavedWork() {
      if (!current) return false;
      const revision = current.bundle.store.getSnapshot().revision;
      return (
        generationDirty(current) || (fileDirty(current) && revision !== current.autosavedRevision)
      );
    },
    clearError() {
      patch({ error: '' });
    },
    clearNotice() {
      patch({ notice: '' });
    },
    dispose() {
      disposed = true;
      const runtime = current;
      current = undefined;
      // Keep the lease until any already-started save has finished, even during an unmount.
      void (async () => {
        if (runtime) {
          await runtime.autosave?.flush();
          await release(runtime);
        }
        repository.close();
      })();
      listeners.clear();
    },
  };
}
export type ProjectLifecycle = ReturnType<typeof createProjectLifecycle>;
