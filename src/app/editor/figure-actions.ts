import type { AnnotationContent, DocumentStore, Point } from '../../core/document/types.ts';
import {
  planAddFigureAnnotation,
  planAddFigureRepresentation,
  planUpdateFigureAnnotation,
  type FigureAddition,
} from '../../core/figure/index.ts';
import type { Result } from '../../core/document/types.ts';
import {
  planUpdateFigureAppearance,
  type FigureAppearance,
} from '../../graphics/figure-appearance.ts';

type FigureTarget = { store: DocumentStore; show(id: string): void };
type FigureActionOptions = {
  /** Owns copy migration and every project/draft confirmation before mutation. */
  ensureTarget(): Promise<FigureTarget | null>;
  onError(message: string): void;
};

/** Complete drawing commands shared by panels; no caller-arranged transaction or selection. */
export function createFigureActions({ ensureTarget, onError }: FigureActionOptions) {
  const add = async (plan: (store: DocumentStore) => Result<FigureAddition>) => {
    const target = await ensureTarget();
    if (!target) return;
    const snapshot = target.store.getSnapshot();
    const result = plan(target.store);
    if (!result.ok) return onError(result.error.message);
    const commit = await target.store.dispatch({
      baseRevision: snapshot.revision,
      operations: result.value.operations,
    });
    if (!commit.ok) onError(commit.error.message);
    else target.show(result.value.id);
  };
  return {
    addAnnotation: (text = '说明', position?: Point) =>
      add((store) => planAddFigureAnnotation(store.getSnapshot(), text, position)),
    addRepresentation: (sourceId: string, position?: Point) =>
      add((store) => planAddFigureRepresentation(store.getSnapshot(), sourceId, position)),
    async updateAnnotation(id: string, text: string | AnnotationContent) {
      const target = await ensureTarget();
      if (!target) return false;
      const snapshot = target.store.getSnapshot();
      const result = planUpdateFigureAnnotation(
        snapshot,
        id,
        typeof text === 'string' ? { kind: 'manual', text } : text,
      );
      if (!result.ok) {
        onError(result.error.message);
        return false;
      }
      const commit = await target.store.dispatch({
        baseRevision: snapshot.revision,
        operations: result.value,
      });
      if (!commit.ok) onError(commit.error.message);
      else target.show(id);
      return commit.ok;
    },
    async updateFigureAppearance(id: string, values: FigureAppearance) {
      const target = await ensureTarget();
      if (!target) return false;
      const snapshot = target.store.getSnapshot();
      const plan = planUpdateFigureAppearance(snapshot, id, values);
      if (!plan.ok) {
        onError(plan.error.message);
        return false;
      }
      const commit = await target.store.dispatch({
        baseRevision: snapshot.revision,
        operations: plan.value,
      });
      if (!commit.ok) onError(commit.error.message);
      return commit.ok;
    },
  };
}
