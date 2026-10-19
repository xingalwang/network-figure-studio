import { createRoot } from 'react-dom/client';
import '@maxgraph/core/css/common.css';
const root = createRoot(document.getElementById('root')!);
if (import.meta.env.DEV && location.pathname.startsWith('/__test__/canvas')) {
  void import('../tests/fixtures/CanvasHarness.tsx').then(({ default: Harness }) =>
    root.render(<Harness />),
  );
} else {
  void import('./app/App.tsx').then(({ default: App }) => root.render(<App />));
}
