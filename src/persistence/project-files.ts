import { decodeProject, encodeProject } from '../core/document/codec.ts';
import {
  fail,
  type ErrorDetail,
  type ProjectDocument,
  type Result,
} from '../core/document/types.ts';

export type ProjectWritable = {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
};
export type ProjectDestination = { name?: string; createWritable(): Promise<ProjectWritable> };
export type ProjectFileBackend = {
  pickDestination?: (suggestedName: string) => Promise<ProjectDestination>;
  download(blob: Blob, fileName: string): void | Promise<void>;
};
type SavedSnapshot = { documentId: string; revision: number; fileName: string };
export type SaveResult =
  | (SavedSnapshot & { kind: 'written'; destination: ProjectDestination })
  | (SavedSnapshot & { kind: 'download-started' })
  | { kind: 'cancelled' }
  | { kind: 'failed'; error: ErrorDetail };

export async function openProject(file: File): Promise<Result<ProjectDocument>> {
  try {
    return decodeProject(await file.text());
  } catch {
    return fail('FILE_READ_FAILED', '无法读取工程文件；当前项目未改变。');
  }
}

export function createProjectBlob(doc: ProjectDocument): Blob {
  return new Blob([encodeProject(doc)], { type: 'application/json' });
}

function browserBackend(): ProjectFileBackend {
  const browser = globalThis as typeof globalThis & {
    showSaveFilePicker?: (options: {
      suggestedName: string;
      types: { description: string; accept: Record<string, string[]> }[];
    }) => Promise<ProjectDestination>;
  };
  return {
    pickDestination: browser.showSaveFilePicker
      ? (suggestedName) =>
          browser.showSaveFilePicker!({
            suggestedName,
            types: [{ description: '架构图工程', accept: { 'application/json': ['.nnfig.json'] } }],
          })
      : undefined,
    download(blob, fileName) {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      try {
        anchor.href = url;
        anchor.download = fileName;
        document.body.append(anchor);
        anchor.click();
      } finally {
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1_000);
      }
    },
  };
}

const failure = (error: unknown): SaveResult => ({
  kind: 'failed',
  error: {
    code: 'FILE_SAVE_FAILED',
    message: `工程文件未保存：${error instanceof Error ? error.message : '写入失败。'}`,
  },
});

export async function saveProject(
  doc: ProjectDocument,
  destination?: ProjectDestination,
  backend: ProjectFileBackend = browserBackend(),
): Promise<SaveResult> {
  let blob: Blob;
  try {
    blob = createProjectBlob(doc);
  } catch (error) {
    return failure(error);
  }
  const fileName = `${doc.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim() || '未命名架构图'}.nnfig.json`;
  const snapshot = { documentId: doc.id, revision: doc.revision, fileName };
  if (!destination && backend.pickDestination) {
    try {
      destination = await backend.pickDestination(fileName);
    } catch (error) {
      return error instanceof Error && error.name === 'AbortError'
        ? { kind: 'cancelled' }
        : failure(error);
    }
  }
  if (!destination) {
    try {
      await backend.download(blob, fileName);
      return { kind: 'download-started', ...snapshot };
    } catch (error) {
      return failure(error);
    }
  }
  let writable: ProjectWritable | undefined;
  try {
    writable = await destination.createWritable();
    await writable.write(blob);
    await writable.close();
    return { kind: 'written', ...snapshot, fileName: destination.name ?? fileName, destination };
  } catch (error) {
    try {
      await writable?.abort?.();
    } catch {
      /* Preserve the original write error. */
    }
    return failure(error);
  }
}
