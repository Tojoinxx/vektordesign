import { describe, expect, it } from 'vitest';
import { vectorize } from '../../src/model/vectorize';
import { contoursBBox } from '../../src/model/shape';

/** 200 × 100 px: weißer Grund, blauer Kreis links, rotes Quadrat mit Loch rechts */
function testImage() {
  const w = 200;
  const h = 100;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let c = [255, 255, 255];
      if ((x - 50) ** 2 + (y - 50) ** 2 < 35 ** 2) c = [31, 58, 147];
      if (x >= 120 && x < 180 && y >= 20 && y < 80 && !(x >= 140 && x < 160 && y >= 40 && y < 60)) c = [200, 16, 46];
      data.set([c[0], c[1], c[2], 255], i);
    }
  return { width: w, height: h, data };
}

describe('Bild vektorisieren', () => {
  it('erkennt Farben, lässt den Hintergrund weg, behält Löcher; Maße stimmen (1 px = 0,5 mm)', () => {
    const layers = vectorize(testImage(), { colors: 3, detail: 'medium', removeBackground: true }, (x, y) => ({ x: x * 0.5, y: (100 - y) * 0.5 }));
    expect(layers).toHaveLength(2);
    const red = layers.find((l) => l.color === '#c8102e')!;
    const blue = layers.find((l) => l.color === '#1f3a93')!;
    expect(red && blue).toBeTruthy();
    expect(red.contours.length).toBe(2); // Außenkontur + Loch
    const rb = contoursBBox(red.contours)!;
    expect(rb.maxX - rb.minX).toBeCloseTo(30, 0);
    const bb = contoursBBox(blue.contours)!;
    expect(bb.maxX - bb.minX).toBeGreaterThan(33);
    expect(bb.maxX - bb.minX).toBeLessThan(37);
  });
});
