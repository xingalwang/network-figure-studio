import { validateDocument } from '../core/document/validate.ts';
import type { ProjectDocument } from '../core/document/types.ts';
import type { AutosaveRepository } from './autosave.ts';

export type ProjectRepository = AutosaveRepository & {
  load(projectId: string): Promise<ProjectDocument | null>;
  latest(): Promise<ProjectDocument | null>;
  close(): void;
};
export type IndexedDBOptions = { databaseName?: string; indexedDB?: IDBFactory | null };

export function createIndexedDBRepository(options: IndexedDBOptions = {}): ProjectRepository {
  const factory = options.indexedDB === undefined ? globalThis.indexedDB : options.indexedDB;
  let connection: Promise<IDBDatabase> | undefined;
  let closed = false;
  function connect(): Promise<IDBDatabase> {
    if (closed) return Promise.reject(new Error('本地项目存储已关闭。'));
    if (!factory) return Promise.reject(new Error('此浏览器不支持 IndexedDB，无法自动保存。'));
    if (connection) return connection;
    connection = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(options.databaseName ?? 'nnfig-projects', 1);
      let abandoned = false;
      request.onupgradeneeded = () => {
        if (abandoned || closed) {
          request.transaction?.abort();
          return;
        }
        const db = request.result;
        if (!db.objectStoreNames.contains('projects'))
          db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('metadata')) db.createObjectStore('metadata');
      };
      request.onblocked = () => {
        abandoned = true;
        reject(new Error('本地项目存储升级被其他标签页阻止，请关闭旧页面后重试。'));
      };
      request.onerror = () => reject(request.error ?? new Error('无法打开本地项目存储。'));
      request.onsuccess = () => {
        const db = request.result;
        if (abandoned || closed) {
          db.close();
          reject(new Error('本地项目存储已关闭。'));
          return;
        }
        db.onversionchange = () => {
          db.close();
          connection = undefined;
        };
        resolve(db);
      };
    });
    void connection.catch(() => {
      connection = undefined;
    });
    return connection;
  }

  function transaction<T>(
    db: IDBDatabase,
    mode: IDBTransactionMode,
    work: (tx: IDBTransaction, result: (value: T) => void) => void,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(['projects', 'metadata'], mode);
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(tx.error ?? new Error('本地项目存储事务已中止。'));
      tx.onerror = (event) =>
        reject(
          (event.target as IDBRequest | null)?.error ??
            tx.error ??
            new Error('本地项目存储读写失败。'),
        );
      try {
        work(tx, (next) => {
          value = next;
        });
      } catch (error) {
        tx.abort();
        reject(error);
      }
    });
  }

  function checked(value: unknown): ProjectDocument | null {
    if (value === undefined) return null;
    const result = validateDocument(value);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  }

  return {
    async save(doc) {
      const valid = validateDocument(doc);
      if (!valid.ok) throw new Error(valid.error.message);
      const snapshot = structuredClone(doc);
      await transaction<void>(await connect(), 'readwrite', (tx, result) => {
        tx.objectStore('projects').put(snapshot);
        tx.objectStore('metadata').put(snapshot.id, 'latest');
        result(undefined);
      });
    },
    async load(projectId) {
      return checked(
        await transaction<unknown>(await connect(), 'readonly', (tx, result) => {
          const request = tx.objectStore('projects').get(projectId);
          request.onsuccess = () => result(request.result);
        }),
      );
    },
    async latest() {
      return checked(
        await transaction<unknown>(await connect(), 'readonly', (tx, result) => {
          const key = tx.objectStore('metadata').get('latest');
          key.onsuccess = () => {
            if (key.result === undefined) {
              result(undefined);
              return;
            }
            const request = tx.objectStore('projects').get(key.result);
            request.onsuccess = () => result(request.result);
          };
        }),
      );
    },
    close() {
      closed = true;
      void connection?.then(
        (db) => db.close(),
        () => {},
      );
    },
  };
}
