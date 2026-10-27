import { describe, expect, it } from 'vitest';
import { evaluate, ExprError, formatNumber } from '../../src/params/expr';
import { evaluateDims, replaceName } from '../../src/params/params';
import { createDoc, addDimension } from '../../src/model/doc';

describe('Ausdrücke', () => {
  it('rechnet Grundrechenarten mit Punkt vor Strich', () => {
    expect(evaluate('20+5')).toBe(25);
    expect(evaluate('2+3*4')).toBe(14);
    expect(evaluate('(2+3)*4')).toBe(20);
    expect(evaluate('10/4')).toBe(2.5);
    expect(evaluate('2^3^2')).toBe(512);
    expect(evaluate('-2^2')).toBe(-4);
    expect(evaluate('2^-1')).toBe(0.5);
  });

  it('versteht Komma und Punkt als Dezimaltrenner', () => {
    expect(evaluate('12,5')).toBe(12.5);
    expect(evaluate('12.5')).toBe(12.5);
    expect(evaluate('0,5*4')).toBe(2);
  });

  it('kennt Funktionen, Konstanten und Einheiten', () => {
    expect(evaluate('sqrt(16)')).toBe(4);
    expect(evaluate('max(3; 7; 5)')).toBe(7);
    expect(evaluate('max(3, 7)')).toBe(7);
    expect(evaluate('sin(30)')).toBeCloseTo(0.5, 12);
    expect(evaluate('2cm')).toBe(20);
    expect(evaluate('1in')).toBe(25.4);
    expect(evaluate('pi')).toBeCloseTo(Math.PI, 12);
  });

  it('löst Namen auf', () => {
    expect(evaluate('d1*2', (n) => (n === 'd1' ? 40 : undefined))).toBe(80);
  });

  it('meldet Fehler verständlich', () => {
    expect(() => evaluate('')).toThrow(ExprError);
    expect(() => evaluate('2+')).toThrow(/unvollständig/);
    expect(() => evaluate('(2+3')).toThrow(/Klammer/);
    expect(() => evaluate('d9')).toThrow(/Unbekannter Name „d9“/);
    expect(() => evaluate('1/0')).toThrow(/Division/);
    expect(() => evaluate('foo(2)')).toThrow(/Unbekannte Funktion/);
    expect(() => evaluate('2 $ 3')).toThrow(/Unerwartetes Zeichen/);
  });

  it('formatiert deutsch', () => {
    expect(formatNumber(12.5)).toBe('12,5');
    expect(formatNumber(80)).toBe('80');
    expect(formatNumber(-0.0000001)).toBe('0');
    expect(formatNumber(1234.567, 2)).toBe('1234,57');
  });
});

describe('Bemaßungs-Parameter', () => {
  const base = () => {
    const d = createDoc();
    const a = addDimension(d, { kind: 'distance', refs: [], expr: '80', value: 0, driven: false });
    const b = addDimension(d, { kind: 'distance', refs: [], expr: 'd0/2', value: 0, driven: false });
    return { d, a, b };
  };

  it('wertet in Abhängigkeitsreihenfolge aus', () => {
    const { d, a, b } = base();
    const r = evaluateDims(d);
    expect(r.errors).toEqual({});
    expect(r.values[a.id]).toBe(80);
    expect(r.values[b.id]).toBe(40);
  });

  it('erkennt Zirkelbezüge', () => {
    const { d, a } = base();
    d.dims[a.id].expr = 'd1+1';
    const r = evaluateDims(d);
    expect(Object.values(r.errors).join()).toMatch(/Zirkelbezug|Fehler/);
  });

  it('lehnt Null und negative Längen ab', () => {
    const { d, a } = base();
    d.dims[a.id].expr = '0';
    expect(evaluateDims(d).errors[a.id]).toMatch(/größer als 0/);
    d.dims[a.id].expr = '-5';
    expect(evaluateDims(d).errors[a.id]).toMatch(/größer als 0/);
  });

  it('ersetzt Namen beim Löschen durch Werte', () => {
    expect(replaceName('d1*2+d10', 'd1', '40')).toBe('(40)*2+d10');
  });
});
