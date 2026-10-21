import { structurePalette, type ViewTheme } from '../../graphics/view-theme.ts';
import {
  Graph,
  Shape,
  ShapeRegistry,
  Point,
  InternalEvent,
  RubberBandHandler,
  EdgeHandlerConfig,
  VertexHandlerConfig,
  HandleConfig,
  type Cell,
  type AbstractCanvas2D,
  type ConnectionHandler,
} from '@maxgraph/core';
import { nodeVisual, paintPrimitives, drawingFont } from '../../graphics/paint.ts';
import { worldOrigin, resolvePort } from './ports.ts';
import { structureVisual } from '../../graphics/structure.ts';
import { annotationVisual, tensorVisual } from '../../graphics/tensor-visual.ts';
import {
  analyzeDocument,
  resolveComputation,
  type ComputationRegistry,
} from '../../core/computation/index.ts';
import { isFigureEntity, isStructureEntity, semanticTarget } from '../../core/figure/index.ts';
import type { Primitive, Bounds } from '../../graphics/primitives.ts';
import type {
  DocumentStore,
  ProjectDocument,
  Entity,
  Endpoint,
  ResolvedOperation,
  EdgeEntity,
  NodeEntity,
  Point as XY,
} from '../../core/document/types.ts';

type ShapeData = {
  visual: { bounds: Bounds; primitives: Primitive[]; caption?: string };
  assets: ProjectDocument['assets'];
};
export type GraphMode = 'figure' | 'structure';
class ModuleShape extends Shape {
  override paintVertexShape(c: AbstractCanvas2D, x: number, y: number, w: number, h: number) {
    const data = this.state?.cell.value as ShapeData;
    if (!data?.visual) return;
    const v = data.visual;
    c.save();
    c.translate(x, y);
    c.scale(w / v.bounds.width);
    c.translate(-v.bounds.x, -v.bounds.y);
    paintPrimitives(c, v.primitives, data.assets);
    c.restore();
  }
}
ShapeRegistry.add('network-module', ModuleShape);
EdgeHandlerConfig.selectionColor = '#526dd9';
EdgeHandlerConfig.connectFillColor = '#ffffff';
VertexHandlerConfig.selectionColor = '#526dd9';
HandleConfig.fillColor = '#ffffff';
HandleConfig.strokeColor = '#526dd9';
const portCellId = (id: string, p: string) => `${id}:port:${p}`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function configure(container: HTMLElement) {
  const graph = new Graph(container);
  graph.keepEdgesInBackground = true;
  // model.clear replaces the root; rebuilding a projection must not reset the viewport.
  graph.resetViewOnRootChange = false;
  graph.setHtmlLabels(false);
  graph.setCellsEditable(false);
  const toggleEvent = graph.isToggleEvent.bind(graph);
  graph.isToggleEvent = (event) => event.shiftKey || toggleEvent(event);
  graph.setCellsResizable(false);
  graph.setConnectable(true);
  graph.setPanning(true);
  graph.setAllowDanglingEdges(true);
  graph.setDisconnectOnMove(false);
  graph.setExtendParents(false);
  graph.setExtendParentsOnAdd(false);
  graph.setExtendParentsOnMove(false);
  graph.setConstrainChildren(false);
  graph.resetEdgesOnMove = false;
  graph.resetEdgesOnConnect = false;
  graph.resetEdgesOnResize = false;
  graph.gridSize = 1;
  graph.isFoldingEnabled = () => false;
  // maxGraph normalizes connected ports to parent terminals during reconnect validation.
  graph.isValidConnection = (source, target) =>
    [source, target].every((cell) => cell == null || cell.isVertex());
  graph.setAllowLoops(true);
  graph.getLabel = (cell) => (typeof cell?.value === 'string' ? cell.value : '');
  graph.getStylesheet().getDefaultEdgeStyle().fontFamily = drawingFont;
  return graph;
}
type Projection = {
  cells: Map<string, Cell>;
  ports: Map<string, { entityId: string; portId: string }>;
  visuals: Map<string, { x: number; y: number; width: number; height: number }>;
};
function project(
  graph: Graph,
  doc: ProjectDocument,
  editing = false,
  mode: GraphMode = 'figure',
  theme: ViewTheme = 'dark',
  computations?: ComputationRegistry,
): Projection {
  const cells = new Map<string, Cell>(),
    ports = new Map<string, { entityId: string; portId: string }>(),
    visuals = new Map<string, { x: number; y: number; width: number; height: number }>();
  const report = analyzeDocument(doc, computations);
  const visual = (node: NodeEntity) =>
    node.annotation
      ? annotationVisual(doc, node, report)
      : semanticTarget(doc, node.id)
        ? tensorVisual(doc, node, report, mode, theme, computations)
        : mode === 'structure'
          ? structureVisual(node, theme)
          : nodeVisual(node);
  const visible = (entity: Entity): boolean =>
    (mode === 'structure' ? isStructureEntity(doc, entity) : isFigureEntity(doc, entity)) &&
    (mode === 'structure' ||
      (entity.figureState !== 'unplaced' && entity.figureState !== 'hidden')) &&
    (!entity.parentId || visible(doc.entities[entity.parentId]));
  graph.isPort = (cell) => ports.has(cell?.getId() ?? '');
  graph.isCellSelectable = (cell) => !ports.has(cell?.getId() ?? '');
  graph.isCellMovable = (cell) => {
    const e = doc.entities[cell.getId() ?? ''];
    return !!e && e.kind !== 'edge' && !e.locked;
  };
  graph.batchUpdate(() => {
    graph.getDataModel().clear();
    const add = (e: Entity): Cell | undefined => {
      if (e.kind === 'edge' || !visible(e)) return;
      if (cells.has(e.id)) return cells.get(e.id);
      const parent = e.parentId ? add(doc.entities[e.parentId]) : graph.getDefaultParent();
      const b = e.kind === 'node' ? visual(e).bounds : { x: 0, y: 0, ...e.size };
      visuals.set(e.id, b);
      const cell = graph.insertVertex({
        parent,
        id: e.id,
        value:
          e.kind === 'node'
            ? { visual: visual(e), assets: doc.assets }
            : (e.presentation.labelOverride ?? (mode === 'structure' ? e.name : '')),
        position: [
          (mode === 'structure'
            ? (e.presentation.compositionPosition ?? e.presentation.position)
            : e.presentation.position
          ).x + b.x,
          (mode === 'structure'
            ? (e.presentation.compositionPosition ?? e.presentation.position)
            : e.presentation.position
          ).y + b.y,
        ],
        size: [b.width, b.height],
        style:
          e.kind === 'node'
            ? {
                shape: 'network-module',
                perimeter: 'rectanglePerimeter',
                resizable: false,
                overflow: 'visible',
                ...(mode === 'structure'
                  ? {
                      fontFamily: drawingFont,
                      fontSize: 12,
                      fontColor: structurePalette(theme).text,
                      verticalLabelPosition: 'bottom',
                      verticalAlign: 'top',
                      spacingTop: 6,
                      whiteSpace: 'nowrap',
                    }
                  : {}),
              }
            : {
                shape: 'rectangle',
                fillColor: 'none',
                strokeColor: 'none',
                fontColor: mode === 'structure' ? structurePalette(theme).text : '#586473',
                fontFamily: drawingFont,
                fontSize: mode === 'structure' ? 12 : 14,
                verticalLabelPosition: 'bottom',
                verticalAlign: 'top',
                spacingTop: mode === 'structure' ? 6 : 10,
                ...(mode === 'structure' ? { whiteSpace: 'nowrap' } : {}),
                resizable: false,
              },
      });
      cell.setConnectable(false);
      cells.set(e.id, cell);
      return cell;
    };
    Object.values(doc.entities).forEach(add);
    for (const e of Object.values(doc.entities)) {
      if (e.kind === 'edge' || !cells.has(e.id)) continue;
      const parent = cells.get(e.id)!,
        b = visuals.get(e.id)!,
        origin = worldOrigin(doc, e.id);
      for (const portId of Object.keys(e.ports)) {
        const local =
          e.kind === 'node' && (semanticTarget(doc, e.id) || mode === 'structure')
            ? 'ports' in visual(e)
              ? (visual(e) as unknown as { ports: Record<string, XY> }).ports[portId]
              : undefined
            : undefined;
        const p = local
          ? { ok: true as const, value: { x: origin.x + local.x, y: origin.y + local.y } }
          : resolvePort(doc, e.id, portId);
        if (!p.ok) continue;
        const id = portCellId(e.id, portId);
        ports.set(id, { entityId: e.id, portId });
        const port = graph.insertVertex({
          parent,
          id,
          value: '',
          position: [
            (p.value.x - origin.x - b.x) / b.width,
            (p.value.y - origin.y - b.y) / b.height,
          ],
          size: [6, 6],
          relative: true,
          style: {
            shape: 'ellipse',
            perimeter: 'ellipsePerimeter',
            fillColor: '#526dd9',
            strokeColor: '#526dd9',
            opacity: editing ? (mode === 'structure' ? 100 : 45) : 0,
            resizable: false,
            movable: false,
          },
        });
        port.getGeometry()!.offset = new Point(-3, -3);
      }
    }
    for (const e of Object.values(doc.entities)) {
      if (
        e.kind !== 'edge' ||
        !visible(e) ||
        [e.source, e.target].some((end) => end.kind === 'port' && !cells.has(end.entityId))
      )
        continue;
      const terminal = (x: Endpoint) =>
        x.kind === 'port' ? graph.getDataModel().getCell(portCellId(x.entityId, x.portId)) : null;
      const cell = graph.insertEdge({
        parent: e.parentId ? cells.get(e.parentId) : graph.getDefaultParent(),
        id: e.id,
        value: e.label ?? '',
        source: terminal(e.source),
        target: terminal(e.target),
        style: {
          edgeStyle:
            mode === 'structure' || e.route.kind === 'orthogonal'
              ? 'orthogonalEdgeStyle'
              : undefined,
          curved: mode === 'figure' && e.route.kind === 'curve',
          strokeColor: mode === 'structure' ? structurePalette(theme).edge : e.style.color,
          opacity: mode === 'structure' ? 100 : (e.style.opacity ?? 1) * 100,
          strokeWidth: e.style.width,
          dashed: e.style.dashed,
          endArrow: e.style.arrow ? 'classic' : 'none',
          endSize: 8,
          rounded: false,
          fontFamily: drawingFont,
          fontSize: 13,
          fontColor:
            mode === 'structure'
              ? structurePalette(theme).text
              : (doc.theme.textColor ?? '#26333d'),
          labelBackgroundColor:
            mode === 'structure'
              ? structurePalette(theme).surface
              : doc.page.background === 'transparent'
                ? 'none'
                : doc.page.background === 'white'
                  ? '#ffffff'
                  : doc.page.background,
          sourcePerimeterSpacing: 0,
          targetPerimeterSpacing: 0,
        },
      });
      const g = cell.getGeometry()!.clone();
      g.points = mode === 'structure' ? [] : e.route.points.map((p) => new Point(p.x, p.y));
      for (const source of [true, false]) {
        const end = source ? e.source : e.target;
        if (end.kind === 'free') {
          const o = worldOrigin(doc, end.spaceId),
            parent = worldOrigin(doc, e.parentId);
          g.setTerminalPoint(
            new Point(o.x + end.point.x - parent.x, o.y + end.point.y - parent.y),
            source,
          );
        }
      }
      graph.getDataModel().setGeometry(cell, g);
      cells.set(e.id, cell);
    }
  });
  // Keep model vertices before edges so port states exist on every view validation.
  // keepEdgesInBackground controls only painting order, including after zoom/pan.
  graph.getView().validate();
  return { cells, ports, visuals };
}
export function renderDocumentGraph(
  container: HTMLElement,
  doc: ProjectDocument,
  computations?: ComputationRegistry,
): Graph {
  const graph = configure(container);
  graph.setEnabled(false);
  project(graph, doc, false, 'figure', 'dark', computations);
  return graph;
}
/** Read-only figure preview; callers do not need maxGraph state or events. */
export function createGraphPreview(
  container: HTMLElement,
  doc: ProjectDocument,
  computations?: ComputationRegistry,
): { dispose(): void } {
  const graph = renderDocumentGraph(container, doc, computations);
  const fit = () => {
    const bounds = graph.getGraphBounds(),
      width = container.clientWidth,
      height = container.clientHeight,
      view = graph.getView(),
      oldScale = view.scale;
    if (!width || !height) return;
    const scale = Math.max(
      0.1,
      Math.min(
        1.05,
        (width - 72) / (bounds.width / oldScale || 1),
        (height - 72) / (bounds.height / oldScale || 1),
      ),
    );
    const x = bounds.x / oldScale - view.translate.x,
      y = bounds.y / oldScale - view.translate.y;
    view.scaleAndTranslate(
      scale,
      (width / scale - bounds.width / oldScale) / 2 - x,
      (height / scale - bounds.height / oldScale) / 2 - y,
    );
  };
  fit();
  const observer = new ResizeObserver(fit);
  observer.observe(container);
  return {
    dispose() {
      observer.disconnect();
      graph.destroy();
    },
  };
}
export type GraphViewport = { scale: number; x: number; y: number };
export type GraphAdapter = {
  graph: Graph;
  mode: GraphMode;
  /** Omit portId to anchor at the current computation rule output. */
  portPoint(id: string, portId?: string): XY;
  render(doc: ProjectDocument): void;
  /** A read-only structure preview. Gestures always commit against the formal store. */
  setProjectionDocument(doc?: ProjectDocument): void;
  getSelection(): string[];
  setSelection(ids: string[]): void;
  onSelection(fn: (ids: string[]) => void): () => void;
  onDoubleClick(fn: (id: string) => void): () => void;
  onScale(fn: (scale: number) => void): () => void;
  getScale(): number;
  getViewport(): GraphViewport;
  setViewport(viewport: GraphViewport): void;
  onViewport(fn: (viewport: GraphViewport) => void): () => void;
  setTheme(theme: ViewTheme): void;
  setTool(tool: 'select' | 'connect'): void;
  fit(): void;
  reveal(id: string): void;
  zoom(factor: number): void;
  toWorld(event: MouseEvent): XY;
  screenPoint(id: string): XY;
  dispose(): void;
};
export function createGraphAdapter(
  container: HTMLElement,
  store: DocumentStore,
  onError: (message: string) => void = () => {},
  mode: GraphMode = 'figure',
  theme: ViewTheme = 'dark',
  computations?: ComputationRegistry,
): GraphAdapter {
  const graph = configure(container);
  if (mode === 'structure') {
    const figureLabel = graph.getLabel.bind(graph);
    graph.getLabel = (cell) => {
      if (cell?.isEdge()) return figureLabel(cell);
      if (!cell || !graph.isCellSelected(cell)) return '';
      const value = cell.value as ShapeData | string;
      const caption = typeof value === 'string' ? value : value?.visual?.caption;
      return caption?.split(/\r?\n/)[0] ?? '';
    };
  }
  graph.setCellsBendable(mode === 'figure');
  graph.setAllowDanglingEdges(mode === 'figure');
  const rubberBand = new RubberBandHandler(graph);
  let painting = false,
    disposed = false,
    pending = false;
  let projection: Projection = { cells: new Map(), ports: new Map(), visuals: new Map() };
  const connectionHandler = graph.getPlugin<ConnectionHandler>('ConnectionHandler');
  if (connectionHandler) {
    // Terminals are explicit ports. A whole module highlight can cover a nearby
    // port and redirect its pointer events to the wrong object while dragging.
    connectionHandler.isConnectableCell = (cell) => projection.ports.has(cell.getId() ?? '');
  }
  let projectionDoc: ProjectDocument | undefined,
    renderedDoc = store.getSnapshot();
  const listeners = new Set<(ids: string[]) => void>();
  const doubleClickListeners = new Set<(id: string) => void>();
  const scaleListeners = new Set<(scale: number) => void>();
  const viewportListeners = new Set<(viewport: GraphViewport) => void>();
  const view = graph.getView();
  const viewport = (): GraphViewport => ({
    scale: view.scale,
    x: view.translate.x,
    y: view.translate.y,
  });
  const scaleChanged = () => {
    scaleListeners.forEach((fn) => fn(view.scale));
    viewportChanged();
  };
  const viewportChanged = () => viewportListeners.forEach((fn) => fn(viewport()));
  view.addListener(InternalEvent.SCALE, scaleChanged);
  view.addListener(InternalEvent.SCALE_AND_TRANSLATE, scaleChanged);
  view.addListener(InternalEvent.TRANSLATE, viewportChanged);
  const wheel = (event: WheelEvent) => {
    if (!event.deltaY || event.defaultPrevented) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? container.clientHeight : 1;
    const factor = Math.exp(-Math.max(-600, Math.min(600, event.deltaY * unit)) * 0.002);
    const scale = Math.max(0.1, Math.min(3, view.scale * factor));
    if (scale === view.scale) return;
    const rect = container.getBoundingClientRect();
    const x = event.clientX - rect.left,
      y = event.clientY - rect.top;
    // Keep the world point under the cursor fixed while changing the view only.
    view.scaleAndTranslate(
      scale,
      view.translate.x + x / scale - x / view.scale,
      view.translate.y + y / scale - y / view.scale,
    );
  };
  container.addEventListener('wheel', wheel, { passive: false });
  const selection = () =>
    graph
      .getSelectionCells()
      .map((c) => c.getId()!)
      .filter((id) => !!store.getSnapshot().entities[id]);
  const select = (ids: string[]) => {
    const previous = painting;
    painting = true;
    try {
      graph.setSelectionCells(
        ids.map((id) => projection.cells.get(id)).filter((c): c is Cell => !!c),
      );
    } finally {
      painting = previous;
    }
  };
  const render = (doc: ProjectDocument) => {
    if (disposed) return;
    const ids = selection();
    painting = true;
    try {
      try {
        const display =
          projectionDoc && projectionDoc.id === doc.id && projectionDoc.revision === doc.revision
            ? projectionDoc
            : doc;
        projection = project(graph, display, true, mode, theme, computations);
        renderedDoc = display;
      } catch {
        projectionDoc = undefined;
        projection = project(graph, store.getSnapshot(), true, mode, theme, computations);
        renderedDoc = store.getSnapshot();
      }
      graph.setEnabled(!store.isReadonly());
      select(ids);
    } catch (error) {
      graph.setEnabled(false);
      onError(
        `画布重建失败；工程数据仍保留，可保存后重新打开。${error instanceof Error ? error.message : ''}`,
      );
    } finally {
      painting = false;
    }
  };
  render(store.getSnapshot());
  const readEnd = (cell: Cell, source: boolean, spaceId: string | null): Endpoint | null => {
    const style = cell.getStyle(),
      portId = style[source ? 'sourcePort' : 'targetPort'];
    const terminal = cell.getTerminal(source);
    const key = typeof portId === 'string' ? portId : terminal?.getId();
    const port = key ? projection.ports.get(key) : undefined;
    if (port) return { kind: 'port', ...port };
    const point = cell.getGeometry()?.getTerminalPoint(source);
    return point ? { kind: 'free', spaceId, point: { x: point.x, y: point.y } } : null;
  };
  function topologyOwner(id: string): string | null {
    let e = store.getSnapshot().entities[id];
    while (e?.parentId) {
      e = store.getSnapshot().entities[e.parentId];
      if (e.generation) return e.id;
    }
    return null;
  }
  const changed = () => {
    if (painting || disposed || pending) return;
    const doc = store.getSnapshot(),
      ops: ResolvedOperation[] = [];
    for (const [id, cell] of projection.cells) {
      const e = doc.entities[id],
        g = cell.getGeometry();
      if (!e || !g) continue;
      if (e.kind !== 'edge') {
        const b = projection.visuals.get(id)!,
          position = { x: g.x - b.x, y: g.y - b.y };
        const current =
          mode === 'structure'
            ? (e.presentation.compositionPosition ?? e.presentation.position)
            : e.presentation.position;
        if (!same(position, current))
          ops.push({
            kind:
              mode === 'structure' && e.kind === 'node' && e.semantic ? 'compositionMove' : 'move',
            id,
            position,
          });
      } else {
        const points = g.points?.map((p) => ({ x: p.x, y: p.y })) ?? [];
        if (mode === 'figure' && !same(points, e.route.points))
          ops.push({ kind: 'route', id, route: { ...e.route, mode: 'manual', points } });
        for (const source of [true, false]) {
          const end = readEnd(cell, source, e.parentId);
          if (end && !same(end, source ? e.source : e.target)) {
            if (topologyOwner(id)) {
              onError('先解除组合的生成关联，再改变内部连接。');
              render(doc);
              return;
            }
            if (
              mode === 'figure' &&
              e.meaning === 'dataflow' &&
              !window.confirm('这会修改真实计算输入。确认修改计算关系？仅调整说明请另画说明线。')
            ) {
              render(doc);
              return;
            }
            ops.push({ kind: 'reconnect', id, end: source ? 'source' : 'target', endpoint: end });
          }
        }
      }
    }
    for (const cell of Object.values(graph.getDataModel().cells ?? {})) {
      const id = cell.getId();
      if (!cell.isEdge() || id == null || doc.entities[id]) continue;
      const source = readEnd(cell, true, null),
        target = readEnd(cell, false, null);
      if (!source || !target) {
        render(doc);
        return;
      }
      if ([source, target].some((x) => x.kind === 'port' && topologyOwner(x.entityId))) {
        onError('内部拓扑受生成器管理，请连接组合端口或先解除生成关联。');
        render(doc);
        return;
      }
      const edge: EdgeEntity = {
        id: crypto.randomUUID(),
        parentId: null,
        kind: 'edge',
        name: '连接',
        ...(doc.schemaVersion >= 2
          ? {
              meaning:
                mode === 'structure' &&
                [source, target].every(
                  (end) =>
                    end.kind === 'port' &&
                    doc.entities[end.entityId]?.kind === 'node' &&
                    (doc.entities[end.entityId] as NodeEntity).semantic,
                )
                  ? ('dataflow' as const)
                  : ('annotation' as const),
            }
          : {}),
        source,
        target,
        route: { kind: 'orthogonal', mode: 'auto', points: [], spaceId: null },
        style: {
          color: doc.theme.lineColor,
          width: doc.theme.lineWidth ?? 1.5,
          dashed: false,
          arrow: true,
        },
      };
      ops.push({ kind: 'put', entity: edge });
    }
    if (ops.length) {
      pending = true;
      void store.dispatch({ baseRevision: doc.revision, operations: ops }).then((r) => {
        pending = false;
        if (!r.ok) onError(r.error.message);
        render(store.getSnapshot());
      });
    }
  };
  graph.getDataModel().addListener(InternalEvent.CHANGE, changed);
  const selectionChanged = (
    _sender: unknown,
    event: { getProperty: (name: string) => unknown },
  ) => {
    if (mode === 'structure') {
      // Selection is temporary view state. Repaint only affected labels, including
      // programmatic/restored selections; do not rebuild cells or write history.
      const affected = new Set<Cell>([
        ...((event.getProperty('added') as Cell[] | undefined) ?? []),
        ...((event.getProperty('removed') as Cell[] | undefined) ?? []),
      ]);
      for (const cell of affected) {
        if (cell.isEdge()) continue;
        const state = view.getState(cell);
        if (state) graph.cellRenderer.redrawLabel(state, false);
      }
    }
    if (!painting) listeners.forEach((fn) => fn(selection()));
  };
  graph.getSelectionModel().addListener(InternalEvent.CHANGE, selectionChanged);
  const doubleClick = (_sender: unknown, event: { getProperty: (name: string) => any }) => {
    const cell = event.getProperty('cell') as Cell | undefined;
    const id = cell?.getId();
    const entityId = id && (projection.ports.get(id)?.entityId ?? id);
    if (entityId && store.getSnapshot().entities[entityId])
      doubleClickListeners.forEach((fn) => fn(entityId));
  };
  graph.addListener(InternalEvent.DOUBLE_CLICK, doubleClick);
  const unsubscribe = store.subscribe(() => render(store.getSnapshot()));
  const fit = () => {
    const b = graph.getGraphBounds(),
      width = container.clientWidth,
      height = container.clientHeight;
    if (!width || !height) return;
    const scale = Math.min(
      1.25,
      (width - 96) / Math.max(400, b.width / graph.getView().scale),
      (height - 100) / Math.max(260, b.height / graph.getView().scale),
    );
    const view = graph.getView();
    const x = b.x / view.scale - view.translate.x,
      y = b.y / view.scale - view.translate.y;
    view.scaleAndTranslate(
      Math.max(0.15, scale),
      (width / scale - b.width / view.scale) / 2 - x,
      (height / scale - b.height / view.scale) / 2 - y,
    );
  };
  return {
    graph,
    mode,
    portPoint(id, portId) {
      const entity = renderedDoc.entities[id];
      portId ??=
        entity?.kind === 'node'
          ? (resolveComputation(entity, computations)?.outputPort ?? 'out')
          : 'out';
      const cell = graph.getDataModel().getCell(portCellId(id, portId)),
        state = cell && graph.getView().getState(cell),
        rect = container.getBoundingClientRect();
      if (!state) throw Error('端口不可见');
      return { x: rect.left + state.getCenterX(), y: rect.top + state.getCenterY() };
    },
    render,
    setProjectionDocument(doc) {
      projectionDoc = mode === 'structure' ? doc : undefined;
      render(store.getSnapshot());
    },
    getSelection: selection,
    setSelection: select,
    onSelection(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    onDoubleClick(fn) {
      doubleClickListeners.add(fn);
      return () => {
        doubleClickListeners.delete(fn);
      };
    },
    onScale(fn) {
      scaleListeners.add(fn);
      return () => {
        scaleListeners.delete(fn);
      };
    },
    getScale: () => view.scale,
    getViewport: viewport,
    setViewport(next) {
      if ([next.scale, next.x, next.y].every(Number.isFinite) && next.scale > 0)
        view.scaleAndTranslate(Math.max(0.1, Math.min(3, next.scale)), next.x, next.y);
    },
    onViewport(fn) {
      viewportListeners.add(fn);
      return () => {
        viewportListeners.delete(fn);
      };
    },
    setTheme(next) {
      theme = next;
      if (mode === 'structure') render(store.getSnapshot());
    },
    setTool(tool) {
      graph.setConnectable(tool === 'connect');
    },
    fit,
    reveal(id) {
      const cell = projection.cells.get(id),
        view = graph.getView(),
        state = cell && view.getState(cell);
      if (!state) return;
      const margin = 56,
        dx =
          state.x < margin
            ? margin - state.x
            : Math.min(0, container.clientWidth - margin - state.x - state.width),
        dy =
          state.y < margin
            ? margin - state.y
            : Math.min(0, container.clientHeight - margin - state.y - state.height);
      if (dx || dy)
        view.setTranslate(view.translate.x + dx / view.scale, view.translate.y + dy / view.scale);
    },
    zoom(factor) {
      graph.zoomTo(Math.max(0.1, Math.min(3, graph.getView().scale * factor)));
    },
    toWorld(event) {
      const r = container.getBoundingClientRect(),
        v = graph.getView();
      return {
        x: (event.clientX - r.left) / v.scale - v.translate.x,
        y: (event.clientY - r.top) / v.scale - v.translate.y,
      };
    },
    screenPoint(id) {
      const cell = projection.cells.get(id),
        state = cell && graph.getView().getState(cell),
        r = container.getBoundingClientRect();
      if (!state) throw Error('对象不可见');
      const entity = renderedDoc.entities[id];
      if (entity?.kind === 'node' && semanticTarget(renderedDoc, entity.id)) {
        const v = tensorVisual(
            renderedDoc,
            entity,
            analyzeDocument(renderedDoc, computations),
            mode,
            theme,
            computations,
          ),
          p = v.primitives.find((primitive) => primitive.kind !== 'text');
        if (p) {
          const center =
            p.kind === 'polygon'
              ? {
                  x: p.points.reduce((sum, point) => sum + point.x, 0) / p.points.length,
                  y: p.points.reduce((sum, point) => sum + point.y, 0) / p.points.length,
                }
              : { x: p.x + p.width / 2, y: p.y + p.height / 2 };
          return {
            x: r.left + state.x + ((center.x - v.bounds.x) * state.width) / v.bounds.width,
            y: r.top + state.y + ((center.y - v.bounds.y) * state.height) / v.bounds.height,
          };
        }
      }
      return { x: r.left + state.x + state.width / 2, y: r.top + state.y + state.height / 2 };
    },
    dispose() {
      disposed = true;
      container.removeEventListener('wheel', wheel);
      view.removeListener(scaleChanged);
      view.removeListener(viewportChanged);
      scaleListeners.clear();
      viewportListeners.clear();
      unsubscribe();
      graph.getDataModel().removeListener(changed);
      graph.removeListener(doubleClick);
      doubleClickListeners.clear();
      graph.getSelectionModel().removeListener(selectionChanged);
      rubberBand.onDestroy();
      graph.destroy();
      listeners.clear();
    },
  };
}
