import { createProject, migrateProjectV2, migrateProjectV3 } from '../../core/document/codec.ts';
import type { ProjectDocument } from '../../core/document/types.ts';
import { openProject } from '../../persistence/project-files.ts';
import type { ProjectBundle, ProjectLifecycle } from '../project-lifecycle.ts';

/** File confirmation and explicit format copies use the same lifecycle switch, including its write lock. */
export function createProjectActions({
  bundle,
  lifecycle,
  hasPendingParameters,
  onError,
  setHomeOpen,
  confirmDiscard = (message) => confirm(message),
}: {
  bundle: ProjectBundle;
  lifecycle: ProjectLifecycle;
  hasPendingParameters(): boolean;
  onError(message: string): void;
  setHomeOpen(open: boolean): void;
  confirmDiscard?(message: string): boolean;
}) {
  const switchProject = async (next: ProjectDocument, origin: 'new' | 'file' = 'file') => {
    if (
      hasPendingParameters() &&
      !confirmDiscard('有尚未应用的参数草稿。继续切换工程将丢弃这些草稿，是否继续？')
    )
      return false;
    return lifecycle.switchProject(next, origin);
  };
  return {
    switchProject,
    goHome: () => setHomeOpen(true),
    continueProject: () => setHomeOpen(false),
    async createNewProject() {
      const opened = await switchProject(createProject('未命名架构图', 2), 'new');
      if (opened) setHomeOpen(false);
      return opened;
    },
    async openProjectFile(file: File) {
      const parsed = await openProject(file);
      if (!parsed.ok) {
        onError(parsed.error.message);
        return false;
      }
      const opened = await switchProject(parsed.value);
      if (opened) setHomeOpen(false);
      return opened;
    },
    async ensureSchema(schema: 2 | 3): Promise<ProjectBundle | null> {
      if (bundle.store.isReadonly()) return null;
      const doc = bundle.store.getSnapshot();
      if (doc.schemaVersion >= schema) return bundle;
      if (
        schema === 3 &&
        !confirmDiscard('独立图稿需要新版工程格式。创建 v3 副本并继续？原工程保留。')
      )
        return null;
      const copy = schema === 3 ? migrateProjectV3(doc) : migrateProjectV2(doc);
      if (!(await switchProject(copy, 'new'))) return null;
      const next = lifecycle.getSnapshot().bundle;
      return next?.store.getSnapshot().id === copy.id ? next : null;
    },
    save: (copy = false) => lifecycle.save(copy, copy ? { download: downloadBlob } : undefined),
  };
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob),
    anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
