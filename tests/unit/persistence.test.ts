import { it } from 'vitest';
import assert from 'node:assert/strict';
import { createDocumentStore } from '../../src/core/commands/store.ts';
import { makeCoreFixture } from '../fixtures/project.ts';
import type { NodeEntity, ProjectDocument } from '../../src/core/document/types.ts';
import {
  createProjectBlob,
  openProject,
  saveProject,
  type ProjectDestination,
  type ProjectFileBackend,
} from '../../src/persistence/project-files.ts';
import { startAutosave, type AutosaveStatus } from '../../src/persistence/autosave.ts';
import { acquireProjectLock, type ProjectLockManager } from '../../src/persistence/project-lock.ts';
import { createIndexedDBRepository } from '../../src/persistence/indexeddb.ts';

const pause = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fullProject() {
  const doc = makeCoreFixture();
  const node = doc.entities['node-a'] as NodeEntity;
  node.generation = {
    generatorId: 'builtin/conv',
    version: '1.0.0',
    paramSchemaVersion: 1,
    source: {
      kind: 'local',
      params: { appearance: 'volume', thickness: 20, stack: 4, projection: 35 },
    },
    localKeys: { block: node.id },
  };
  node.presentation = {
    ...node.presentation,
    labelOverride: '特征提取',
    fillOverride: '#aabbcc',
    moved: true,
    scale: 1.5,
  };
  doc.dependencies['builtin/conv'] = '1.0.0';
  doc.assets['input-image'] = {
    mime: 'image/png',
    data: 'data:image/png;base64,YQ==',
    width: 1,
    height: 1,
  };
  node.primitives.push({
    kind: 'image',
    assetId: 'input-image',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
  });
  return doc;
}
const noDownload: ProjectFileBackend = {
  download: () => {
    throw new Error('unexpected download');
  },
};

it('project files retain editable geometry, generation parameters, overrides and embedded assets', async () => {
  const doc = fullProject();
  const blob = createProjectBlob(doc);
  const result = await openProject(new File([blob], 'figure.nnfig.json'));
  assert.deepEqual(result, { ok: true, value: doc });
});

it('opening malformed, unsupported and unreadable files returns errors without touching the document', async () => {
  const doc = fullProject();
  const store = createDocumentStore(doc);
  for (const text of ['{', JSON.stringify({ ...doc, schemaVersion: 99 })]) {
    assert.equal((await openProject(new File([text], 'bad.nnfig.json'))).ok, false);
  }
  const unreadable = {
    text: async () => {
      throw new Error('read failed');
    },
  } as unknown as File;
  assert.equal((await openProject(unreadable)).ok, false);
  assert.deepEqual(store.getSnapshot(), doc);
});

it('file saving reports written only after close and returns the original snapshot revision', async () => {
  const store = createDocumentStore(fullProject());
  const closing = deferred();
  let text = '';
  let settled = false;
  const destination: ProjectDestination = {
    name: 'figure.nnfig.json',
    createWritable: async () => ({
      write: async (blob) => {
        text = await blob.text();
      },
      close: () => closing.promise,
    }),
  };
  const saving = saveProject(store.getSnapshot(), destination, noDownload).then((result) => {
    settled = true;
    return result;
  });
  await pause();
  await store.dispatch({
    baseRevision: 0,
    operations: [{ kind: 'label', id: 'node-a', text: 'new edit' }],
  });
  assert.equal(settled, false);
  closing.resolve();
  const result = await saving;
  assert.equal(result.kind, 'written');
  if (result.kind === 'written') {
    assert.equal(result.revision, 0);
    assert.equal(result.documentId, store.getSnapshot().id);
  }
  assert.equal(JSON.parse(text).entities['node-a'].presentation.labelOverride, '特征提取');
  assert.equal(store.getSnapshot().revision, 1);
});

it('picker cancellation neither downloads nor reports a saved file', async () => {
  const result = await saveProject(fullProject(), undefined, {
    ...noDownload,
    pickDestination: async () => {
      throw new DOMException('cancel', 'AbortError');
    },
  });
  assert.equal(result.kind, 'cancelled');
});

it('permission loss and stream failure are failed saves, not cancellation or fallback downloads', async () => {
  const denied: ProjectDestination = {
    createWritable: async () => {
      throw new DOMException('denied', 'NotAllowedError');
    },
  };
  assert.equal((await saveProject(fullProject(), denied, noDownload)).kind, 'failed');
  let aborted = false;
  const broken: ProjectDestination = {
    createWritable: async () => ({
      write: async () => {
        throw new DOMException('scan failed', 'AbortError');
      },
      close: async () => {
        throw new Error('must not close');
      },
      abort: async () => {
        aborted = true;
      },
    }),
  };
  assert.equal((await saveProject(fullProject(), broken, noDownload)).kind, 'failed');
  assert.equal(aborted, true);
});

it('unsupported file picker starts a portable download without claiming disk confirmation', async () => {
  let downloaded: Blob | undefined;
  let name = '';
  const result = await saveProject(fullProject(), undefined, {
    download: (blob, fileName) => {
      downloaded = blob;
      name = fileName;
    },
  });
  assert.equal(result.kind, 'download-started');
  assert.match(name, /\.nnfig\.json$/);
  assert.deepEqual(await openProject(new File([downloaded!], name)), {
    ok: true,
    value: fullProject(),
  });
});

it('invalid documents never reach a file destination', async () => {
  const doc = fullProject();
  doc.page.width = -1;
  const result = await saveProject(
    doc,
    {
      createWritable: async () => {
        throw new Error('destination must not be opened');
      },
    },
    noDownload,
  );
  assert.equal(result.kind, 'failed');
});

it('autosave waits 500ms and coalesces edits to the newest revision', async () => {
  const store = createDocumentStore(fullProject());
  const writes: ProjectDocument[] = [];
  const autosave = startAutosave(store, {
    save: async (doc) => {
      writes.push(doc);
    },
  });
  await store.dispatch({
    baseRevision: 0,
    operations: [{ kind: 'label', id: 'node-a', text: 'first' }],
  });
  await store.dispatch({
    baseRevision: 1,
    operations: [{ kind: 'label', id: 'node-a', text: 'second' }],
  });
  await pause(30);
  assert.equal(writes.length, 0);
  await pause(500);
  assert.deepEqual(
    writes.map((doc) => doc.revision),
    [2],
  );
  autosave.dispose();
});

it('autosave serializes writes and an old completion never reports a newer edit as saved', async () => {
  const store = createDocumentStore(fullProject());
  const first = deferred();
  const second = deferred();
  const writes: number[] = [];
  const statuses: AutosaveStatus[] = [];
  const autosave = startAutosave(
    store,
    {
      save: async (doc) => {
        writes.push(doc.revision);
        await (doc.revision === 0 ? first.promise : second.promise);
      },
    },
    { onStatus: (value) => statuses.push(value) },
  );
  const flushing = autosave.flush();
  await store.dispatch({
    baseRevision: 0,
    operations: [{ kind: 'label', id: 'node-a', text: 'new' }],
  });
  assert.deepEqual(writes, [0]);
  first.resolve();
  await pause();
  assert.deepEqual(writes, [0, 1]);
  assert.equal(statuses.at(-1)?.kind, 'saving');
  assert.equal(
    statuses.some((value) => value.kind === 'saved' && value.revision === 1),
    false,
  );
  second.resolve();
  assert.deepEqual(await flushing, { ok: true, value: undefined });
  assert.equal(statuses.at(-1)?.kind, 'saved');
  assert.equal(statuses.at(-1)?.savedRevision, 1);
  autosave.dispose();
});

it('quota failure preserves edits and a later flush retries the latest snapshot', async () => {
  const store = createDocumentStore(fullProject());
  let quotaFull = true;
  let saved: ProjectDocument | undefined;
  const statuses: AutosaveStatus[] = [];
  const autosave = startAutosave(
    store,
    {
      save: async (doc) => {
        if (quotaFull) throw new DOMException('full', 'QuotaExceededError');
        saved = doc;
      },
    },
    { onStatus: (state) => statuses.push(state) },
  );
  await store.dispatch({
    baseRevision: 0,
    operations: [{ kind: 'label', id: 'node-a', text: 'keep me' }],
  });
  assert.equal((await autosave.flush()).ok, false);
  assert.equal(statuses.at(-1)?.kind, 'failed');
  assert.equal(
    (store.getSnapshot().entities['node-a'] as NodeEntity).presentation.labelOverride,
    'keep me',
  );
  quotaFull = false;
  assert.equal((await autosave.flush()).ok, true);
  assert.equal(saved?.revision, 1);
  autosave.dispose();
});

it('readonly pages cannot autosave and dispose cancels pending writes', async () => {
  const store = createDocumentStore(fullProject());
  store.setReadonly(true);
  const writes: number[] = [];
  const autosave = startAutosave(
    store,
    {
      save: async (doc) => {
        writes.push(doc.revision);
      },
    },
    { delayMs: 5 },
  );
  assert.equal((await autosave.flush()).ok, false);
  await pause(15);
  assert.deepEqual(writes, []);
  store.setReadonly(false);
  autosave.dispose();
  await pause(15);
  assert.deepEqual(writes, []);
  assert.equal((await autosave.flush()).ok, false);
});

it('a readonly transition cancels a pending autosave, then explicit write access can resume', async () => {
  const store = createDocumentStore(fullProject());
  const writes: number[] = [];
  const autosave = startAutosave(
    store,
    {
      save: async (doc) => {
        writes.push(doc.revision);
      },
    },
    { delayMs: 5 },
  );
  store.setReadonly(true);
  await pause(15);
  assert.deepEqual(writes, []);
  store.setReadonly(false);
  assert.equal((await autosave.flush()).ok, true);
  assert.deepEqual(writes, [0]);
  autosave.dispose();
});

function controlledLocks(): ProjectLockManager {
  const held = new Set<string>();
  return {
    async request(name, options, callback) {
      assert.equal(options.mode, 'exclusive');
      assert.equal(options.ifAvailable, true);
      if (held.has(name)) {
        await callback(null);
        return;
      }
      held.add(name);
      try {
        await callback({ name });
      } finally {
        held.delete(name);
      }
    },
  };
}

it('the second tab is readonly until the first releases its native lease', async () => {
  const locks = controlledLocks();
  const options = { locks, createChannel: () => undefined };
  const first = await acquireProjectLock('same-project', options);
  const second = await acquireProjectLock('same-project', options);
  const other = await acquireProjectLock('other-project', options);
  assert.equal(first.kind, 'writable');
  assert.equal(second.kind, 'readonly');
  assert.equal(other.kind, 'writable');
  await first.release();
  await first.release();
  const replacement = await acquireProjectLock('same-project', options);
  assert.equal(replacement.kind, 'writable');
  await Promise.all([second.release(), other.release(), replacement.release()]);
});

it('missing Web Locks is unsupported, while a rejected lock request is failed', async () => {
  const unsupported = await acquireProjectLock('project', { locks: null });
  assert.equal(unsupported.kind, 'unsupported');
  const rejected = await acquireProjectLock('project', {
    locks: {
      request: async () => {
        throw new Error('denied');
      },
    },
    createChannel: () => undefined,
  });
  assert.equal(rejected.kind, 'failed');
  await unsupported.release();
  await rejected.release();
});

it('missing IndexedDB is reported rather than pretending to have saved locally', async () => {
  const repository = createIndexedDBRepository({ indexedDB: null });
  await assert.rejects(repository.save(fullProject()), /IndexedDB/);
  await assert.rejects(repository.latest(), /IndexedDB/);
  repository.close();
});

it('a no-op flush does not disable debouncing for later edits during a write', async () => {
  const store = createDocumentStore(fullProject());
  const writing = deferred();
  const writes: number[] = [];
  const autosave = startAutosave(
    store,
    {
      save: async (doc) => {
        writes.push(doc.revision);
        if (doc.revision === 1) await writing.promise;
      },
    },
    { delayMs: 50 },
  );
  try {
    await autosave.flush();
    await autosave.flush();
    await store.dispatch({
      baseRevision: 0,
      operations: [{ kind: 'label', id: 'node-a', text: 'one' }],
    });
    await pause(60);
    assert.deepEqual(writes, [0, 1]);
    await store.dispatch({
      baseRevision: 1,
      operations: [{ kind: 'label', id: 'node-a', text: 'two' }],
    });
    writing.resolve();
    await pause();
    assert.deepEqual(writes, [0, 1]);
    await pause(60);
    assert.deepEqual(writes, [0, 1, 2]);
  } finally {
    autosave.dispose();
    writing.resolve();
  }
});

it(
  'release broadcasts availability but the readonly tab must explicitly reacquire its lease',
  { timeout: 2_000 },
  async () => {
    const locks = controlledLocks();
    const projectId = `notify-${crypto.randomUUID()}`;
    const available = deferred();
    const first = await acquireProjectLock(projectId, { locks });
    const second = await acquireProjectLock(projectId, {
      locks,
      onAvailable: () => available.resolve(),
    });
    try {
      assert.equal(second.kind, 'readonly');
      await first.release();
      await available.promise;
      assert.equal(second.kind, 'readonly');
      const replacement = await acquireProjectLock(projectId, { locks });
      assert.equal(replacement.kind, 'writable');
      await replacement.release();
    } finally {
      await first.release();
      await second.release();
    }
  },
);

// This driver controls native request/transaction events, not IndexedDB storage semantics.
// Real IndexedDB and cross-tab lock coverage is provided by browser integration tests.
function idbProtocolDriver() {
  const transactions: any[] = [];
  const db = {
    onversionchange: null,
    close() {},
    transaction(stores: string[], mode: IDBTransactionMode) {
      const tx: any = {
        stores,
        mode,
        writes: [],
        reads: [],
        error: null,
        oncomplete: null,
        onabort: null,
        onerror: null,
      };
      tx.objectStore = (store: string) => ({
        put(value: unknown, key?: IDBValidKey) {
          tx.writes.push({ store, value, key });
          return {};
        },
        get(key: IDBValidKey) {
          const request = { result: undefined as unknown, onsuccess: null as (() => void) | null };
          tx.reads.push({ store, key, request });
          return request;
        },
      });
      tx.abort = () => tx.onabort?.();
      transactions.push(tx);
      return tx;
    },
  };
  const factory = {
    open() {
      const request = { result: db, onsuccess: null as (() => void) | null };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  } as unknown as IDBFactory;
  return { factory, transactions };
}

it('IndexedDB save waits for transaction commit and captures the document before asynchronous opening', async () => {
  const driver = idbProtocolDriver();
  const repository = createIndexedDBRepository({ indexedDB: driver.factory });
  const doc = fullProject();
  let settled = false;
  const saving = repository.save(doc).then(() => {
    settled = true;
  });
  doc.title = 'edited while opening';
  await pause();
  const tx = driver.transactions[0];
  assert.equal(tx.mode, 'readwrite');
  assert.equal(settled, false);
  assert.deepEqual(tx.writes, [
    { store: 'projects', value: fullProject(), key: undefined },
    { store: 'metadata', value: 'test-project', key: 'latest' },
  ]);
  tx.oncomplete();
  await saving;
  assert.equal(settled, true);
  repository.close();
});

it('IndexedDB transaction abort rejects save with the quota error', async () => {
  const driver = idbProtocolDriver();
  const repository = createIndexedDBRepository({ indexedDB: driver.factory });
  const saving = repository.save(fullProject());
  await pause();
  const tx = driver.transactions[0];
  tx.error = new DOMException('quota full', 'QuotaExceededError');
  tx.onabort();
  await assert.rejects(saving, { name: 'QuotaExceededError' });
  repository.close();
});

it('IndexedDB load validates stored documents and returns null only for a missing record', async () => {
  const driver = idbProtocolDriver();
  const repository = createIndexedDBRepository({ indexedDB: driver.factory });
  for (const value of [fullProject(), undefined, { ...fullProject(), schemaVersion: 99 }]) {
    const loading = repository.load('test-project');
    await pause();
    const tx = driver.transactions.at(-1);
    assert.deepEqual([tx.reads[0].store, tx.reads[0].key], ['projects', 'test-project']);
    tx.reads[0].request.result = value;
    tx.reads[0].request.onsuccess();
    tx.oncomplete();
    if (value && value.schemaVersion === 99) await assert.rejects(loading, /工程/);
    else assert.deepEqual(await loading, value ?? null);
  }
  repository.close();
});

it('IndexedDB latest reads the latest pointer and its project in one readonly transaction', async () => {
  const driver = idbProtocolDriver();
  const repository = createIndexedDBRepository({ indexedDB: driver.factory });
  const loading = repository.latest();
  await pause();
  const tx = driver.transactions[0];
  assert.equal(tx.mode, 'readonly');
  assert.deepEqual([tx.reads[0].store, tx.reads[0].key], ['metadata', 'latest']);
  tx.reads[0].request.result = 'test-project';
  tx.reads[0].request.onsuccess();
  assert.deepEqual([tx.reads[1].store, tx.reads[1].key], ['projects', 'test-project']);
  tx.reads[1].request.result = fullProject();
  tx.reads[1].request.onsuccess();
  tx.oncomplete();
  assert.deepEqual(await loading, fullProject());
  assert.equal(driver.transactions.length, 1);
  repository.close();
});

it('IndexedDB preserves the request quota error before the transaction abort event', async () => {
  const driver = idbProtocolDriver();
  const repository = createIndexedDBRepository({ indexedDB: driver.factory });
  const saving = repository.save(fullProject());
  await pause();
  const tx = driver.transactions[0];
  tx.onerror({ target: { error: new DOMException('quota full', 'QuotaExceededError') } });
  tx.onabort();
  await assert.rejects(saving, { name: 'QuotaExceededError' });
  repository.close();
});
