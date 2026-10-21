import {
  createContext,
  useContext,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
  type PointerEvent,
} from 'react';

const KEY = 'nnfig.workbench-layout.v1';
type Layout = { library: number; inspector: number; diagnostics: number; expanded: boolean | null };
const defaults: Layout = { library: 220, inspector: 308, diagnostics: 168, expanded: null };
const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));
function normalize(value: Partial<Layout>, viewport = window.innerWidth): Layout {
  const budget = Math.max(440, viewport - 360);
  const library = clamp(
    Number.isFinite(value.library) ? value.library! : defaults.library,
    180,
    Math.min(360, budget - 260),
  );
  return {
    library,
    inspector: clamp(
      Number.isFinite(value.inspector) ? value.inspector! : defaults.inspector,
      260,
      Math.min(460, budget - library),
    ),
    diagnostics: clamp(
      Number.isFinite(value.diagnostics) ? value.diagnostics! : defaults.diagnostics,
      104,
      Math.min(360, window.innerHeight - 290),
    ),
    expanded: typeof value.expanded === 'boolean' ? value.expanded : null,
  };
}
function readLayout(): Layout {
  try {
    return normalize(JSON.parse(localStorage.getItem(KEY) ?? '{}'));
  } catch {
    return normalize(defaults);
  }
}
const Context = createContext<{
  layout: Layout;
  setLayout: (value: Partial<Layout>) => void;
} | null>(null);
export function useWorkbenchLayout() {
  const value = useContext(Context);
  if (!value) throw Error('Workbench layout requires its provider.');
  return value;
}
export function WorkbenchLayout({ children }: { children: ReactNode }) {
  const [layout, update] = useState(readLayout);
  const setLayout = (value: Partial<Layout>) =>
    update((previous) => normalize({ ...previous, ...value }));
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(layout));
    } catch {
      /* Preferences are optional. */
    }
  }, [layout]);
  useEffect(() => {
    const resize = () => update((previous) => normalize(previous));
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  return <Context.Provider value={{ layout, setLayout }}>{children}</Context.Provider>;
}
export function layoutStyle(layout: Layout): CSSProperties {
  return {
    '--library-width': `${layout.library}px`,
    '--inspector-width': `${layout.inspector}px`,
    '--diagnostics-height': `${layout.diagnostics}px`,
  } as CSSProperties;
}
export function ResizeHandle({ side }: { side: 'library' | 'inspector' | 'diagnostics' }) {
  const { layout, setLayout } = useWorkbenchLayout();
  const horizontal = side === 'diagnostics';
  const names = { library: '模块栏宽度', inspector: '信息栏宽度', diagnostics: '底部面板高度' };
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const coordinate = horizontal ? event.clientY : event.clientX;
    const initial = layout[side];
    const target = event.currentTarget;
    const move = (next: globalThis.PointerEvent) => {
      const delta = (horizontal ? next.clientY : next.clientX) - coordinate;
      setLayout({
        [side]: initial + (side === 'library' ? delta : -delta),
        ...(horizontal ? { expanded: true } : {}),
      });
    };
    const stop = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', stop);
      target.removeEventListener('pointercancel', stop);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', stop);
    target.addEventListener('pointercancel', stop);
  };
  return (
    <div
      className={`dock-resize dock-resize-${side}`}
      role="separator"
      aria-label={`调整${names[side]}`}
      aria-orientation={horizontal ? 'horizontal' : 'vertical'}
      aria-valuenow={layout[side]}
      aria-valuemin={horizontal ? 104 : side === 'library' ? 180 : 260}
      aria-valuemax={horizontal ? 360 : side === 'library' ? 360 : 460}
      tabIndex={0}
      onPointerDown={start}
      onDoubleClick={() => setLayout({ [side]: defaults[side] })}
      onKeyDown={(event) => {
        const decrease = horizontal ? 'ArrowDown' : side === 'library' ? 'ArrowLeft' : 'ArrowRight';
        const increase = horizontal ? 'ArrowUp' : side === 'library' ? 'ArrowRight' : 'ArrowLeft';
        if (event.key === decrease || event.key === increase) {
          event.preventDefault();
          setLayout({
            [side]: layout[side] + (event.key === increase ? 16 : -16),
            ...(horizontal ? { expanded: true } : {}),
          });
        }
      }}
    />
  );
}
