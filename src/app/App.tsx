import { useEffect, useState, useSyncExternalStore } from 'react';
import { createProjectLifecycle } from './project-lifecycle.ts';
import { createIndexedDBRepository } from '../persistence/indexeddb.ts';
import { Icon } from './Icons.tsx';
import { registry } from './registry.ts';
import { Editor } from './editor/Editor.tsx';
import './styles.css';
import '../workspaces/generator/tensor.css';
import './workbench/workbench.css';
export default function App() {
  const [lifecycle] = useState(() => createProjectLifecycle(createIndexedDBRepository(), registry));
  const persistence = useSyncExternalStore(lifecycle.subscribe, lifecycle.getSnapshot);
  useEffect(() => {
    void lifecycle.start();
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (lifecycle.hasUnsavedWork()) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      lifecycle.dispose();
    };
  }, [lifecycle]);
  if (!persistence.bundle)
    return (
      <main className="loading-screen">
        <Icon name="logo" size={36} />
        <h1>架构图工作台</h1>
        <p>正在打开本地工作区…</p>
      </main>
    );
  return (
    <Editor
      key={persistence.bundle.store.getSnapshot().id}
      bundle={persistence.bundle}
      lifecycle={lifecycle}
      persistence={persistence}
    />
  );
}
