export type Point = { x: number; y: number };
export type Bounds = Point & { width: number; height: number };
export type BlockAppearance = {
  mode: 'flat' | 'axonometric';
  depth: number;
  stackCount: number;
  stackGap: number;
  angleDeg: number;
};
export type Primitive = (
  | ({ kind: 'rect' | 'ellipse'; fill: string; stroke: string; strokeWidth?: number } & Bounds)
  | { kind: 'polygon'; points: Point[]; fill: string; stroke: string; strokeWidth?: number }
  | ({ kind: 'text'; text: string; fontSize: number; color: string } & Bounds)
  | ({ kind: 'image'; assetId: string } & Bounds)
) & { opacity?: number };
export type BlockGeometry = {
  primitives: Primitive[];
  ports: Record<string, Point>;
  bounds: Bounds;
};
