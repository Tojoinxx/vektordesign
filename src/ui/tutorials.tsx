import type { ReactNode } from 'react';

/**
 * Kurze Tutorials beim ersten Benutzen eines Werkzeugs: animierte Skizze (SVG/SMIL,
 * läuft offline ohne Videodateien) plus zwei, drei Sätze. Jederzeit über Hilfe → Tutorials.
 */

export type TutorialId =
  | 'welcome'
  | 'select'
  | 'line'
  | 'rect'
  | 'circle'
  | 'text'
  | 'point'
  | 'dimension'
  | 'constraints'
  | 'gradient'
  | 'claude'
  | 'suggestions'
  | 'export';

export interface Tutorial {
  title: string;
  steps: string[];
  anim: () => ReactNode;
}

/**
 * Farben der Illustrationen. SMIL-Animationen brauchen echte Farbwerte, deshalb werden die
 * CSS-Tokens der Zeichenfläche vor dem Zeichnen ausgelesen (refreshTutorialColors).
 */
const K = {
  ink: '#1e2328',
  free: '#2f6fd6',
  freeFill: 'rgba(47,111,214,0.10)',
  freeSoft: '#eef3fd',
  tape: '#f5c518',
  tapeDark: '#d9a900',
  onTape: '#1e2328',
  ok: '#23915a',
  okSoft: '#e3f4ea',
  sel: '#e8590c',
  bg: '#ffffff',
  grid: '#eef1f4',
  frame: '#dbe1e7',
  card: '#ffffff',
  cardLine: '#b9c1ca',
};
const TOKENS: Record<keyof typeof K, string> = {
  ink: '--cv-ink',
  free: '--cv-free',
  freeFill: '--cv-free-fill',
  freeSoft: '--cv-free-soft',
  tape: '--tape',
  tapeDark: '--tape-dark',
  onTape: '--on-tape',
  ok: '--cv-ok',
  okSoft: '--cv-ok-soft',
  sel: '--cv-sel',
  bg: '--cv-bg',
  grid: '--cv-grid',
  frame: '--line',
  card: '--cv-card',
  cardLine: '--cv-card-line',
};

/** Liest die aktuellen Farben (Design und Zeichenfläche) für die Illustrationen. */
export function refreshTutorialColors(): void {
  if (typeof document === 'undefined') return;
  const cs = getComputedStyle(document.documentElement);
  for (const k of Object.keys(TOKENS) as (keyof typeof K)[]) {
    const v = cs.getPropertyValue(TOKENS[k]).trim();
    if (v) K[k] = v;
  }
}

const DUR = '4.5s';

function Frame({ children }: { children: ReactNode }) {
  return (
    <svg className="tut-anim" viewBox="0 0 240 140" role="img" aria-hidden="true">
      <rect x="0.5" y="0.5" width="239" height="139" rx="8" fill={K.bg} stroke={K.frame} />
      <g stroke={K.grid} strokeWidth="1">
        {Array.from({ length: 11 }, (_, i) => (
          <line key={`v${i}`} x1={20 + i * 20} y1="0" x2={20 + i * 20} y2="140" />
        ))}
        {Array.from({ length: 6 }, (_, i) => (
          <line key={`h${i}`} x1="0" y1={20 + i * 20} x2="240" y2={20 + i * 20} />
        ))}
      </g>
      {children}
    </svg>
  );
}

/** Mauszeiger, der sich entlang von Punkten bewegt. */
function Cursor({ path, times, dur = DUR, click }: { path: string; times?: string; dur?: string; click?: string }) {
  return (
    <g>
      <animateTransform attributeName="transform" type="translate" values={path} keyTimes={times} dur={dur} repeatCount="indefinite" />
      {click && (
        <circle r="0" fill="none" stroke={K.sel} strokeWidth="2">
          <animate attributeName="r" values={click} dur={dur} repeatCount="indefinite" />
        </circle>
      )}
      <path d="M0 0 L0 15 L4 11 L7 18 L10 17 L7 10 L12 10 Z" fill={K.ink} stroke={K.bg} strokeWidth="1.2" />
    </g>
  );
}

function Tag({ x, y, text, show, dur = DUR }: { x: number; y: number; text: string; show: string; dur?: string }) {
  return (
    <g opacity="0">
      <animate attributeName="opacity" values={show} dur={dur} repeatCount="indefinite" calcMode="discrete" />
      <rect x={x - 18} y={y - 9} width="36" height="18" rx="3" fill={K.tape} stroke={K.tapeDark} />
      <text x={x} y={y + 4} textAnchor="middle" fontSize="11" fontWeight="600" fill={K.onTape} fontFamily="IBM Plex Sans, sans-serif">
        {text}
      </text>
    </g>
  );
}

export const TUTORIALS: Record<TutorialId, Tutorial> = {
  welcome: {
    title: 'Erst grob zeichnen, dann exakt festlegen',
    steps: [
      'Zeichne Formen ungefähr – wie im Inventor-Skizzenmodus.',
      'Mit Bemaßungen (D) und Abhängigkeiten wird alles exakt. Die Geometrie passt sich automatisch an.',
      'Unten rechts siehst du, ob die Skizze vollständig bestimmt ist.',
    ],
    anim: () => (
      <Frame>
        <path fill={K.freeFill} stroke={K.free} strokeWidth="2">
          <animate attributeName="d" values="M62 96 L168 101 L162 44 L70 38 Z;M62 96 L168 101 L162 44 L70 38 Z;M60 100 L180 100 L180 40 L60 40 Z;M60 100 L180 100 L180 40 L60 40 Z" keyTimes="0;0.35;0.55;1" dur={DUR} repeatCount="indefinite" />
          <animate attributeName="stroke" values={`${K.free};${K.free};${K.ink};${K.ink}`} keyTimes="0;0.55;0.6;1" dur={DUR} repeatCount="indefinite" />
        </path>
        <Tag x={120} y={118} text="80" show="0;0;1;1" />
        <Tag x={203} y={70} text="40" show="0;0;1;1" />
        <g opacity="0">
          <animate attributeName="opacity" values="0;0;0;1" keyTimes="0;0.5;0.62;1" dur={DUR} repeatCount="indefinite" calcMode="discrete" />
          <rect x="70" y="8" width="100" height="18" rx="9" fill={K.okSoft} stroke={K.ok} />
          <text x="120" y="21" textAnchor="middle" fontSize="10" fill={K.ok} fontWeight="600" fontFamily="IBM Plex Sans, sans-serif">
            Vollständig bestimmt
          </text>
        </g>
      </Frame>
    ),
  },
  select: {
    title: 'Auswählen und verschieben',
    steps: [
      'Klicken wählt aus, Umschalt-Klick fügt hinzu. Ziehen verschiebt alles, was noch nicht festgelegt ist.',
      'Rahmen von links nach rechts: ganz enthaltene Objekte. Von rechts nach links: alles, was berührt wird.',
      'Doppelklick auf eine Bemaßung ändert den Wert.',
    ],
    anim: () => (
      <Frame>
        <rect x="50" y="50" width="50" height="40" fill="none" strokeWidth="2">
          <animate attributeName="stroke" values={`${K.ink};${K.ink};${K.sel};${K.sel}`} keyTimes="0;0.55;0.6;1" dur={DUR} repeatCount="indefinite" calcMode="discrete" />
        </rect>
        <circle cx="160" cy="70" r="22" fill="none" strokeWidth="2">
          <animate attributeName="stroke" values={`${K.ink};${K.ink};${K.sel};${K.sel}`} keyTimes="0;0.55;0.6;1" dur={DUR} repeatCount="indefinite" calcMode="discrete" />
        </circle>
        <rect x="30" y="30" width="0" height="0" fill={K.freeFill} stroke={K.free}>
          <animate attributeName="width" values="0;180;180;0" keyTimes="0;0.5;0.62;1" dur={DUR} repeatCount="indefinite" />
          <animate attributeName="height" values="0;84;84;0" keyTimes="0;0.5;0.62;1" dur={DUR} repeatCount="indefinite" />
        </rect>
        <Cursor path="30 30;210 114;210 114;30 30" times="0;0.5;0.62;1" />
      </Frame>
    ),
  },
  line: {
    title: 'Linie im Kettenmodus',
    steps: [
      'Punkte nacheinander anklicken – jede Linie beginnt am Ende der vorherigen.',
      'Länge eintippen (Tab wechselt zum Winkel), Enter setzt den Punkt. Fast waagrecht oder senkrecht rastet automatisch ein.',
      'Zurück zum Startpunkt schließt die Form (füllbar). Esc beendet die Kette.',
    ],
    anim: () => (
      <Frame>
        <path fill="none" stroke={K.free} strokeWidth="2" strokeLinejoin="round">
          <animate attributeName="d" values="M50 100 L50 100;M50 100 L130 100;M50 100 L130 100 L130 40;M50 100 L130 100 L130 40 L50 100;M50 100 L130 100 L130 40 L50 100" keyTimes="0;0.25;0.5;0.75;1" dur={DUR} repeatCount="indefinite" calcMode="discrete" />
        </path>
        <path d="M50 100 L130 100 L130 40 Z" fill={K.freeFill} opacity="0">
          <animate attributeName="opacity" values="0;0;0;1" keyTimes="0;0.5;0.75;1" dur={DUR} repeatCount="indefinite" calcMode="discrete" />
        </path>
        <Tag x={90} y={118} text="80" show="0;1;1;1;1" />
        <Cursor path="50 100;130 100;130 40;50 100;50 100" times="0;0.25;0.5;0.75;1" click="0;12;0;12;0;12;0;0" />
      </Frame>
    ),
  },
  rect: {
    title: 'Rechteck',
    steps: [
      'Erste Ecke klicken, dann die gegenüberliegende – oder im Modus „Mittelpunkt“ zuerst die Mitte.',
      'Breite eintippen, Tab, Höhe eintippen, Enter – die Werte werden als Bemaßungen gespeichert.',
      'Tipp: Mitte auf den Ursprung setzen, dann ist die Lage gleich festgelegt.',
    ],
    anim: () => (
      <Frame>
        <rect x="60" y="40" width="0" height="0" fill={K.freeFill} stroke={K.free} strokeWidth="2" strokeDasharray="6 4">
          <animate attributeName="width" values="0;80;120;120" keyTimes="0;0.45;0.7;1" dur={DUR} repeatCount="indefinite" />
          <animate attributeName="height" values="0;50;60;60" keyTimes="0;0.45;0.7;1" dur={DUR} repeatCount="indefinite" />
        </rect>
        <Tag x={120} y={118} text="80" show="0;0;1;1" />
        <Cursor path="60 40;140 90;180 100;180 100" times="0;0.45;0.7;1" />
      </Frame>
    ),
  },
  circle: {
    title: 'Kreis',
    steps: ['Mittelpunkt klicken (z. B. die Rechteckmitte – dann bleibt der Kreis dort), dann einen Punkt auf dem Kreis.', 'Durchmesser direkt eintippen und mit Enter bestätigen.'],
    anim: () => (
      <Frame>
        <circle cx="120" cy="70" r="0" fill={K.freeFill} stroke={K.free} strokeWidth="2">
          <animate attributeName="r" values="0;0;40;40" keyTimes="0;0.2;0.6;1" dur={DUR} repeatCount="indefinite" />
        </circle>
        <path d="M116 70 h8 M120 66 v8" stroke={K.ink} strokeWidth="1.5" />
        <Tag x={120} y={128} text="Ø80" show="0;0;1;1" />
        <Cursor path="120 70;120 70;160 70;160 70" times="0;0.2;0.6;1" click="0;12;0;0" />
      </Frame>
    ),
  },
  text: {
    title: 'Text',
    steps: ['Klicken setzt den Text auf die Grundlinie, dann tippen und Enter.', 'Schriftart, Größe (mm) und Farbe stellst du rechts unter „Eigenschaften“ ein. Doppelklick bearbeitet den Text.'],
    anim: () => (
      <Frame>
        <line x1="70" y1="95" x2="190" y2="95" stroke={K.cardLine} strokeDasharray="3 3" />
        <text x="70" y="95" fontSize="64" fontWeight="700" fontFamily="Arial, sans-serif" fill={K.ink}>
          <animate attributeName="opacity" values="0;0;1;1" keyTimes="0;0.35;0.4;1" dur={DUR} repeatCount="indefinite" calcMode="discrete" />N
        </text>
        <rect x="70" y="45" width="2" height="54" fill={K.sel}>
          <animate attributeName="x" values="70;70;118;118" keyTimes="0;0.35;0.4;1" dur={DUR} repeatCount="indefinite" calcMode="discrete" />
          <animate attributeName="opacity" values="1;0;1;0;1" dur="1s" repeatCount="indefinite" />
        </rect>
        <Cursor path="76 99;76 99;150 120" times="0;0.35;1" click="0;12;0;0" />
      </Frame>
    ),
  },
  point: {
    title: 'Punkt',
    steps: ['Hilfspunkte setzen, an denen du Bemaßungen und Abhängigkeiten festmachst. Punkte werden nie exportiert.'],
    anim: () => (
      <Frame>
        {[
          [70, 50],
          [120, 90],
          [170, 60],
        ].map(([x, y], i) => (
          <path key={i} d={`M${x - 5} ${y} h10 M${x} ${y - 5} v10`} stroke={K.free} strokeWidth="2" opacity="0">
            <animate attributeName="opacity" values={i === 0 ? '0;1;1;1' : i === 1 ? '0;0;1;1' : '0;0;0;1'} keyTimes="0;0.3;0.6;1" dur={DUR} repeatCount="indefinite" calcMode="discrete" />
          </path>
        ))}
        <Cursor path="70 50;120 90;170 60;170 60" times="0;0.3;0.6;1" />
      </Frame>
    ),
  },
  dimension: {
    title: 'Bemaßung (D)',
    steps: [
      'Linie, Kreis oder zwei Punkte anklicken, Maß mit der Maus platzieren. Die Mausposition entscheidet: waagrecht, senkrecht oder ausgerichtet.',
      'Wert eintippen – auch Ausdrücke wie 20+5 oder d0*2 – und Enter. Die Geometrie passt sich an.',
      'Würde die Skizze überbestimmt, kannst du ein getriebenes Maß (in Klammern) anlegen.',
    ],
    anim: () => (
      <Frame>
        <line x1="60" y1="80" y2="80" stroke={K.ink} strokeWidth="2.5">
          <animate attributeName="x2" values="140;140;140;190;190" keyTimes="0;0.3;0.6;0.75;1" dur={DUR} repeatCount="indefinite" />
        </line>
        <g opacity="0">
          <animate attributeName="opacity" values="0;1;1;1" keyTimes="0;0.3;0.6;1" dur={DUR} repeatCount="indefinite" calcMode="discrete" />
          <line x1="60" y1="74" x2="60" y2="44" stroke={K.ink} />
          <line y1="74" y2="44" stroke={K.ink}>
            <animate attributeName="x1" values="140;140;190;190" keyTimes="0;0.6;0.75;1" dur={DUR} repeatCount="indefinite" />
            <animate attributeName="x2" values="140;140;190;190" keyTimes="0;0.6;0.75;1" dur={DUR} repeatCount="indefinite" />
          </line>
          <line x1="60" y1="50" y2="50" stroke={K.ink}>
            <animate attributeName="x2" values="140;140;190;190" keyTimes="0;0.6;0.75;1" dur={DUR} repeatCount="indefinite" />
          </line>
        </g>
        <Tag x={110} y={50} text="37,4" show="0;1;0;0" />
        <Tag x={125} y={50} text="80" show="0;0;1;1" />
        <Cursor path="100 80;105 52;105 52;160 110" times="0;0.3;0.6;1" />
      </Frame>
    ),
  },
  constraints: {
    title: 'Abhängigkeiten',
    steps: [
      'Abhängigkeit wählen (z. B. Parallel) und die Elemente nacheinander anklicken – das Werkzeug bleibt aktiv, Esc beendet.',
      'Die Symbole an der Geometrie zeigen, was gilt. Symbol anklicken und Entf löscht es. F8 zeigt alle, F9 blendet sie aus.',
    ],
    anim: () => (
      <Frame>
        <line x1="50" y1="50" x2="190" y2="50" stroke={K.ink} strokeWidth="2.5" />
        <line x1="50" y1="100" x2="190" y2="80" stroke={K.ink} strokeWidth="2.5">
          <animate attributeName="y2" values="80;80;100;100" keyTimes="0;0.45;0.6;1" dur={DUR} repeatCount="indefinite" />
        </line>
        <g opacity="0">
          <animate attributeName="opacity" values="0;0;1;1" keyTimes="0;0.5;0.6;1" dur={DUR} repeatCount="indefinite" calcMode="discrete" />
          <rect x="112" y="24" width="16" height="16" rx="3" fill={K.card} stroke={K.cardLine} />
          <path d="M116 36 L120 28 M120 36 L124 28" stroke={K.ink} strokeWidth="1.4" />
          <rect x="112" y="110" width="16" height="16" rx="3" fill={K.card} stroke={K.cardLine} />
          <path d="M116 122 L120 114 M120 122 L124 114" stroke={K.ink} strokeWidth="1.4" />
        </g>
        <Cursor path="120 50;120 50;150 92;150 92" times="0;0.25;0.45;1" click="0;12;0;12;0" />
      </Frame>
    ),
  },
  gradient: {
    title: 'Farbverlauf',
    steps: [
      'Form auswählen und rechts unter „Füllung“ auf Verlauf stellen – Farben und Deckkraft der Stufen einstellen.',
      'Mit dem Verlaufswerkzeug (G) einen Strich durch die Form ziehen: Start = erste Farbe, Ende = letzte Farbe. Umschalt rastet auf 45°.',
      '„Verblassen“ lässt die Farbe in Transparenz auslaufen. Schnellwahl: links→rechts, oben→unten …',
    ],
    anim: () => (
      <Frame>
        <defs>
          <linearGradient id="tut-g" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={K.free} />
            <stop offset="1" stopColor={K.free} stopOpacity="0">
              <animate attributeName="offset" values="1;1;0.15;1" keyTimes="0;0.25;0.6;1" dur={DUR} repeatCount="indefinite" />
            </stop>
          </linearGradient>
        </defs>
        <rect x="45" y="35" width="150" height="70" rx="6" fill="url(#tut-g)" stroke={K.ink} strokeWidth="1.5" />
        <line x1="55" y1="70" y2="70" stroke={K.ink} strokeWidth="1.5" strokeDasharray="5 3">
          <animate attributeName="x2" values="55;55;185;185" keyTimes="0;0.25;0.6;1" dur={DUR} repeatCount="indefinite" />
        </line>
        <circle cx="55" cy="70" r="6" fill={K.free} stroke={K.ink} strokeWidth="2" />
        <Cursor path="55 70;55 70;185 70;185 70" times="0;0.25;0.6;1" />
      </Frame>
    ),
  },
  claude: {
    title: 'Claude als Design-Agent',
    steps: [
      'Schreib, was du möchtest – z. B. „Kreis Ø10 in die Rechteckmitte, Füllung Rot“ – oder zieh Bilder hinein, die Claude nachbauen soll.',
      'Claude zeichnet mit denselben Werkzeugen inklusive Bemaßungen, prüft das Ergebnis und erklärt kurz, was es getan hat.',
      'Alles von einem Auftrag ist ein Rückgängig-Schritt. Dafür ist ein eigener API-Schlüssel nötig (Einstellungen im Claude-Tab).',
    ],
    anim: () => (
      <Frame>
        <rect x="20" y="18" width="120" height="26" rx="13" fill={K.freeSoft} stroke={K.free} />
        <text x="32" y="35" fontSize="10" fill={K.ink} fontFamily="IBM Plex Sans, sans-serif">
          Kreis Ø40 in die Mitte
        </text>
        <rect x="70" y="58" width="130" height="66" fill="#fde2e2" stroke={K.ink} strokeWidth="1.5" />
        <circle cx="135" cy="91" r="0" fill="#fff" stroke={K.ink} strokeWidth="1.5">
          <animate attributeName="r" values="0;0;20;20" keyTimes="0;0.35;0.55;1" dur={DUR} repeatCount="indefinite" />
        </circle>
        <path d="M200 30 l4 -8 l4 8 l8 4 l-8 4 l-4 8 l-4 -8 l-8 -4 Z" fill={K.tape} stroke={K.tapeDark}>
          <animateTransform attributeName="transform" type="rotate" values="0 204 34;90 204 34" dur="2s" repeatCount="indefinite" />
        </path>
      </Frame>
    ),
  },
  suggestions: {
    title: 'Stilvorschläge',
    steps: [
      'Element oder ganzes Motiv auswählen – rechts erscheinen mindestens 8 Vorschläge als Vorschaubilder.',
      'Klick übernimmt den Stil, Strg+Z nimmt ihn zurück. Mit Claude gibt es KI-Vorschläge zu einem Stichwort wie „Vintage“.',
    ],
    anim: () => (
      <Frame>
        <text x="28" y="92" fontSize="64" fontWeight="700" fontFamily="Arial, sans-serif" fill={K.free}>
          N
          <animate attributeName="fill" values={`${K.free};${K.free};#e8590c;#e8590c`} keyTimes="0;0.6;0.65;1" dur={DUR} repeatCount="indefinite" calcMode="discrete" />
        </text>
        {['#e8590c', '#2f9e5b', '#7048e8', '#f5c518', '#1e2328', '#f783ac', '#15aabf', '#a0522d'].map((c, i) => (
          <g key={i} opacity="0">
            <animate attributeName="opacity" values="0;1;1" keyTimes={`0;${(0.05 + i * 0.04).toFixed(2)};1`} dur={DUR} repeatCount="indefinite" calcMode="discrete" />
            <rect x={110 + (i % 4) * 30} y={30 + Math.floor(i / 4) * 44} width="26" height="38" rx="4" fill={K.card} stroke={i === 0 ? K.sel : K.frame} />
            <text x={123 + (i % 4) * 30} y={58 + Math.floor(i / 4) * 44} textAnchor="middle" fontSize="22" fontWeight="700" fontFamily="Arial, sans-serif" fill={c}>
              N
            </text>
          </g>
        ))}
        <Cursor path="200 120;123 52;123 52;123 52" times="0;0.55;0.65;1" click="0;0;12;0" />
      </Frame>
    ),
  },
  export: {
    title: 'Exportieren',
    steps: [
      'SVG hat exakt die gezeichneten Millimeter (Illustrator, Cricut Design Space, Silhouette). PNG mit mindestens 300 dpi und transparentem Hintergrund.',
      'Bemaßungen, Symbole und Konstruktionslinien werden nie exportiert. „Spiegeln“ für Flexfolie.',
    ],
    anim: () => (
      <Frame>
        <rect x="35" y="40" width="70" height="50" fill="#d62828" />
        <circle cx="70" cy="65" r="9" fill="#fff" />
        <path d="M120 65 h30 m-8 -8 l8 8 l-8 8" stroke={K.ink} strokeWidth="2" fill="none" />
        <path d="M165 30 h35 l12 12 v66 h-47 Z" fill={K.card} stroke={K.ink} strokeWidth="1.5" />
        <text x="188" y="78" textAnchor="middle" fontSize="11" fontWeight="600" fill={K.ink} fontFamily="IBM Plex Sans, sans-serif">
          SVG
        </text>
        <Tag x={188} y={124} text="80×40" show="0;1;1" />
      </Frame>
    ),
  },
};

const SEEN_KEY = 'vd.tutorials.seen';
const OFF_KEY = 'vd.tutorials.off';

function readSeen(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

export function isTutorialSeen(id: TutorialId): boolean {
  return readSeen().includes(id);
}

export function markTutorialSeen(id: TutorialId): void {
  try {
    const s = new Set(readSeen());
    s.add(id);
    localStorage.setItem(SEEN_KEY, JSON.stringify([...s]));
  } catch {
    /* privater Modus */
  }
}

export function tutorialsEnabled(): boolean {
  try {
    return localStorage.getItem(OFF_KEY) !== '1';
  } catch {
    return true;
  }
}

export function setTutorialsEnabled(on: boolean): void {
  try {
    if (on) {
      localStorage.removeItem(OFF_KEY);
      localStorage.removeItem(SEEN_KEY);
    } else localStorage.setItem(OFF_KEY, '1');
  } catch {
    /* privater Modus */
  }
}
