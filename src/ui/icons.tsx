import type { ReactNode, SVGProps } from 'react';
import type { ConstraintKind } from '../model/types';

/** Eigene CAD-Symbole (24 × 24, Kontur in currentColor). */
function Icon({ children, size = 24, ...rest }: { children: ReactNode; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

const dot = (x: number, y: number) => <rect x={x - 1.6} y={y - 1.6} width="3.2" height="3.2" fill="currentColor" stroke="none" />;

export const IconSelect = (p: { size?: number }) => (
  <Icon {...p}>
    <path d="M6 3 L6 19 L10 15 L13 21 L15.5 20 L12.5 14 L18 14 Z" fill="currentColor" fillOpacity="0.12" />
  </Icon>
);
export const IconLine = (p: { size?: number }) => (
  <Icon {...p}>
    <path d="M5 19 L19 5" />
    {dot(5, 19)}
    {dot(19, 5)}
  </Icon>
);
export const IconRect = (p: { size?: number }) => (
  <Icon {...p}>
    <rect x="4" y="6" width="16" height="12" />
    {dot(4, 18)}
    {dot(20, 6)}
  </Icon>
);
export const IconRectCenter = (p: { size?: number }) => (
  <Icon {...p}>
    <rect x="4" y="6" width="16" height="12" />
    <path d="M10 12 h4 M12 10 v4" />
    {dot(20, 6)}
  </Icon>
);
export const IconCircle = (p: { size?: number }) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M10 12 h4 M12 10 v4" />
  </Icon>
);
export const IconText = (p: { size?: number }) => (
  <Icon {...p}>
    <path d="M5 6 V4 H19 V6 M12 4 V20 M9 20 H15" />
  </Icon>
);
export const IconPoint = (p: { size?: number }) => (
  <Icon {...p}>
    <path d="M12 6 V18 M6 12 H18" />
    <circle cx="12" cy="12" r="2.2" fill="currentColor" />
  </Icon>
);
export const IconDimension = (p: { size?: number }) => (
  <Icon {...p}>
    <path d="M4 18 V8 M20 18 V8" />
    <path d="M4 12 H20" />
    <path d="M7 9.5 L4 12 L7 14.5 M17 9.5 L20 12 L17 14.5" />
    <path d="M9 18 H15" strokeOpacity="0.5" />
  </Icon>
);
export const IconGradient = (p: { size?: number }) => (
  <Icon {...p}>
    <rect x="3.5" y="5" width="17" height="14" rx="2" />
    <path d="M6 5 V19" strokeWidth="2.6" stroke="currentColor" />
    <path d="M9.5 5 V19" strokeWidth="2" strokeOpacity="0.7" />
    <path d="M13 5 V19" strokeWidth="1.4" strokeOpacity="0.45" />
    <path d="M16.5 5 V19" strokeWidth="1" strokeOpacity="0.25" />
  </Icon>
);
export const IconConstruction = (p: { size?: number }) => (
  <Icon {...p}>
    <path d="M4 20 L20 4" strokeDasharray="3 3" />
  </Icon>
);

export function ConstraintIcon({ kind, size = 20 }: { kind: ConstraintKind; size?: number }) {
  switch (kind) {
    case 'coincident':
      return (
        <Icon size={size}>
          <path d="M4 18 L12 12 L20 16" strokeOpacity="0.45" />
          <circle cx="12" cy="12" r="3" fill="currentColor" />
        </Icon>
      );
    case 'horizontal':
      return (
        <Icon size={size}>
          <path d="M4 12 H20" />
          {dot(4, 12)}
          {dot(20, 12)}
        </Icon>
      );
    case 'vertical':
      return (
        <Icon size={size}>
          <path d="M12 4 V20" />
          {dot(12, 4)}
          {dot(12, 20)}
        </Icon>
      );
    case 'parallel':
      return (
        <Icon size={size}>
          <path d="M5 17 L13 5 M11 19 L19 7" />
        </Icon>
      );
    case 'perpendicular':
      return (
        <Icon size={size}>
          <path d="M4 19 H20 M12 19 V5" />
          <path d="M12 15 H16 V19" strokeOpacity="0.5" />
        </Icon>
      );
    case 'collinear':
      return (
        <Icon size={size}>
          <path d="M3 19 L10 12 M14 8 L21 1" />
          <path d="M10 12 L14 8" strokeDasharray="1.5 2" strokeOpacity="0.6" />
        </Icon>
      );
    case 'tangent':
      return (
        <Icon size={size}>
          <circle cx="12" cy="10" r="6" />
          <path d="M3 16 H21" />
        </Icon>
      );
    case 'concentric':
      return (
        <Icon size={size}>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="3.5" />
        </Icon>
      );
    case 'equal':
      return (
        <Icon size={size}>
          <path d="M5 9 H19 M5 15 H19" />
        </Icon>
      );
    case 'symmetric':
      return (
        <Icon size={size}>
          <path d="M12 3 V21" strokeDasharray="2 2" strokeOpacity="0.6" />
          <path d="M8 6 L4 12 L8 18 M16 6 L20 12 L16 18" />
        </Icon>
      );
    case 'midpoint':
      return (
        <Icon size={size}>
          <path d="M3 17 H21" />
          <path d="M12 7 L16 15 H8 Z" fill="currentColor" fillOpacity="0.15" />
        </Icon>
      );
    case 'fix':
      return (
        <Icon size={size}>
          <rect x="6" y="11" width="12" height="9" rx="1.5" fill="currentColor" fillOpacity="0.15" />
          <path d="M8.5 11 V8 a3.5 3.5 0 0 1 7 0 V11" />
        </Icon>
      );
  }
}

export const CONSTRAINT_ORDER: ConstraintKind[] = [
  'coincident',
  'horizontal',
  'vertical',
  'parallel',
  'perpendicular',
  'collinear',
  'tangent',
  'concentric',
  'equal',
  'symmetric',
  'midpoint',
  'fix',
];

// ---------------------------------------------------------------------------
// Bearbeiten (Meilenstein 2)
// ---------------------------------------------------------------------------

export const IconTrim = (p: { size?: number }) => (
  <Icon {...p}>
    <path d="M4 12 H9 M15 12 H20" />
    <path d="M9 12 H15" strokeDasharray="1.5 2.5" strokeOpacity="0.5" />
    <path d="M9 5 V19 M15 5 V19" strokeOpacity="0.55" />
    <path d="M10.5 8.5 L13.5 15.5 M13.5 8.5 L10.5 15.5" strokeWidth="1.4" />
  </Icon>
);
export const IconExtend = (p: { size?: number }) => (
  <Icon {...p}>
    <path d="M3 12 H11" />
    <path d="M11 12 H18" strokeDasharray="2 2" />
    <path d="M19 4 V20" strokeOpacity="0.55" />
    <path d="M15 9 L18 12 L15 15" />
  </Icon>
);
export const IconMeasure = (p: { size?: number }) => (
  <Icon {...p}>
    <rect x="2.5" y="8" width="19" height="8" rx="1" transform="rotate(-30 12 12)" />
    <path d="M7.4 13.6 L6.4 11.9 M10.4 11.9 L9.4 10.2 M13.4 10.2 L12.4 8.5 M16.4 8.5 L15.4 6.8" transform="translate(0.6 1.6)" />
  </Icon>
);
export const IconMove = (p: { size?: number }) => (
  <Icon {...p}>
    <path d="M12 3 V21 M3 12 H21" />
    <path d="M9.5 5.5 L12 3 L14.5 5.5 M9.5 18.5 L12 21 L14.5 18.5 M5.5 9.5 L3 12 L5.5 14.5 M18.5 9.5 L21 12 L18.5 14.5" />
  </Icon>
);
export const IconRotate = (p: { size?: number }) => (
  <Icon {...p}>
    <path d="M19 12 a7 7 0 1 1 -2.05 -4.95" />
    <path d="M17.5 3.5 V7.5 H13.5" />
    {dot(12, 12)}
  </Icon>
);
export const IconScale = (p: { size?: number }) => (
  <Icon {...p}>
    <rect x="3.5" y="11" width="9.5" height="9.5" strokeOpacity="0.55" />
    <rect x="3.5" y="3.5" width="17" height="17" />
    <path d="M13 11 L19 5 M15 5 H19 V9" />
  </Icon>
);
export const IconMirror = (p: { size?: number }) => (
  <Icon {...p}>
    <path d="M12 3 V21" strokeDasharray="2 2" strokeOpacity="0.6" />
    <path d="M9 7 L3.5 17 H9 Z" />
    <path d="M15 7 L20.5 17 H15 Z" fill="currentColor" fillOpacity="0.15" />
  </Icon>
);
export const IconPatternRect = (p: { size?: number }) => (
  <Icon {...p}>
    <rect x="3.5" y="3.5" width="6" height="6" />
    <rect x="14.5" y="3.5" width="6" height="6" strokeOpacity="0.55" />
    <rect x="3.5" y="14.5" width="6" height="6" strokeOpacity="0.55" />
    <rect x="14.5" y="14.5" width="6" height="6" strokeOpacity="0.55" />
  </Icon>
);
export const IconPatternCirc = (p: { size?: number }) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8" strokeDasharray="1.5 2.5" strokeOpacity="0.45" />
    <circle cx="12" cy="4" r="2.2" />
    <circle cx="19" cy="16" r="2.2" strokeOpacity="0.55" />
    <circle cx="5" cy="16" r="2.2" strokeOpacity="0.55" />
  </Icon>
);
export const IconOffset = (p: { size?: number }) => (
  <Icon {...p}>
    <rect x="7.5" y="7.5" width="9" height="9" rx="0.5" />
    <rect x="3.5" y="3.5" width="17" height="17" rx="4" strokeDasharray="2.5 2" />
  </Icon>
);
export const IconFillet = (p: { size?: number }) => (
  <Icon {...p}>
    <path d="M4 20 V11 a7 7 0 0 1 7 -7 H20" />
    <path d="M4 4 V8 M4 4 H8" strokeOpacity="0.45" strokeDasharray="1.5 2" />
  </Icon>
);
export const IconChamfer = (p: { size?: number }) => (
  <Icon {...p}>
    <path d="M4 20 V10 L10 4 H20" />
    <path d="M4 4 V8 M4 4 H8" strokeOpacity="0.45" strokeDasharray="1.5 2" />
  </Icon>
);
export const IconTextToPaths = (p: { size?: number }) => (
  <Icon {...p}>
    <path d="M4 20 L9.5 4 H11.5 L17 20 M6.5 14 H14.5" />
    {dot(4, 20)}
    {dot(9.5, 4)}
    {dot(17, 20)}
    <path d="M18 6 h3 M19.5 4.5 v3" strokeOpacity="0.6" />
  </Icon>
);
export const IconToShape = (p: { size?: number }) => (
  <Icon {...p}>
    <path d="M5 18 C5 8 9 5 19 5" />
    {dot(5, 18)}
    {dot(19, 5)}
    <path d="M5 18 L9 9" strokeOpacity="0.45" />
    <circle cx="9" cy="9" r="1.4" />
  </Icon>
);
const boolShapes = (fillA: number, fillB: number, fillI: number) => (
  <>
    <defs />
    <rect x="3.5" y="3.5" width="11" height="11" rx="1" fill="currentColor" fillOpacity={fillA} />
    <circle cx="15" cy="15" r="6" fill="currentColor" fillOpacity={fillB} />
    {fillI > 0 && <path d="M14.5 9 V14.5 H9 A6 6 0 0 1 14.5 9 Z" fill="currentColor" fillOpacity={fillI} stroke="none" />}
  </>
);
export const IconUnion = (p: { size?: number }) => (
  <Icon {...p}>
    <path d="M3.5 4.5 a1 1 0 0 1 1 -1 H13.5 a1 1 0 0 1 1 1 V9.1 A6 6 0 1 1 9.1 14.5 H4.5 a1 1 0 0 1 -1 -1 Z" fill="currentColor" fillOpacity="0.3" />
  </Icon>
);
export const IconSubtract = (p: { size?: number }) => (
  <Icon {...p}>
    <path d="M3.5 4.5 a1 1 0 0 1 1 -1 H13.5 a1 1 0 0 1 1 1 V9.1 A6 6 0 0 0 9.1 14.5 H4.5 a1 1 0 0 1 -1 -1 Z" fill="currentColor" fillOpacity="0.3" />
    <circle cx="15" cy="15" r="6" strokeDasharray="2 2" strokeOpacity="0.55" />
  </Icon>
);
export const IconIntersect = (p: { size?: number }) => <Icon {...p}>{boolShapes(0, 0, 0.45)}</Icon>;
export const IconExclude = (p: { size?: number }) => (
  <Icon {...p}>
    <path d="M3.5 4.5 a1 1 0 0 1 1 -1 H13.5 a1 1 0 0 1 1 1 V9.1 A6 6 0 0 0 9.1 14.5 H4.5 a1 1 0 0 1 -1 -1 Z" fill="currentColor" fillOpacity="0.3" stroke="none" />
    <path d="M14.5 9.1 V13.5 a1 1 0 0 1 -1 1 H9.1 A6 6 0 1 0 14.5 9.1 Z" fill="currentColor" fillOpacity="0.3" stroke="none" />
    {boolShapes(0, 0, 0)}
  </Icon>
);

export const IconSketch = (p: { size?: number }) => (
  <Icon {...p}>
    <path d="M3 17 C6 10 9 20 12 13 S17 6 21 9" strokeDasharray="0" />
    <path d="M15.5 4.5 L19.5 8.5 L11 17 L7 17 L7 13 Z" fill="currentColor" fillOpacity="0.12" strokeWidth="1.4" />
  </Icon>
);
