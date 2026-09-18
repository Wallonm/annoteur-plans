// Tests de l'export vectoriel (fonctions pures : conversion en tracés, texte, épaisseur)
const test   = require('node:test');
const assert = require('node:assert/strict');
const E = require('../export-vector.js');

const close = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);

test('fabricToLocalPath : triangle (pointe de flèche des bulles) → 3 sommets fermés', () => {
  const cmds = E.fabricToLocalPath({ type: 'triangle', width: 10, height: 20 });
  assert.ok(cmds, 'le triangle n’était pas exporté en v1.7');
  assert.deepEqual(cmds.map(c => c.c), ['M', 'L', 'L', 'Z']);
  assert.deepEqual(cmds[0].p[0], { x: -5, y: 10 });   // bas gauche
  assert.deepEqual(cmds[1].p[0], { x: 0,  y: -10 });  // sommet en haut, comme fabric.Triangle
  assert.deepEqual(cmds[2].p[0], { x: 5,  y: 10 });
});

test('fabricToLocalPath : rectangle à coins arrondis → 4 cubiques, arrondi borné', () => {
  const cmds = E.fabricToLocalPath({ type: 'rect', width: 100, height: 40, rx: 8, ry: 8 });
  assert.equal(cmds.filter(c => c.c === 'C').length, 4);
  assert.deepEqual(cmds[0].p[0], { x: -50 + 8, y: -20 });
  // rx supérieur à la moitié du côté : borné, pas de chevauchement
  const big = E.fabricToLocalPath({ type: 'rect', width: 100, height: 40, rx: 500, ry: 500 });
  assert.deepEqual(big[0].p[0], { x: 0, y: -20 });
  // sans rx/ry : rectangle à angles droits inchangé
  const plain = E.fabricToLocalPath({ type: 'rect', width: 100, height: 40 });
  assert.deepEqual(plain.map(c => c.c), ['M', 'L', 'L', 'L', 'Z']);
});

test('sanitizeForFont : espaces typographiques fr-FR → espace simple, reste inchangé', () => {
  // Police factice : accepte tout sauf les caractères hors WinAnsi listés
  const font = { encodeText: ch => { if ('  →'.includes(ch)) throw new Error('x'); } };
  const label = (1500).toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' mm';
  assert.equal(E.sanitizeForFont(label, font), '1 500,00 mm');
  assert.equal(E.sanitizeForFont('a → b', font), 'a -> b');
  assert.equal(E.sanitizeForFont('12,50 m²', font), '12,50 m²');
});

test('effectiveStrokeWidth : strokeUniform ignore l’échelle, sinon moyenne des échelles', () => {
  close(E.effectiveStrokeWidth({ strokeWidth: 2, strokeUniform: true, scaleX: 3, scaleY: 3 }), 2);
  close(E.effectiveStrokeWidth({ strokeWidth: 2, scaleX: 2, scaleY: 4 }), 6);
  assert.equal(E.effectiveStrokeWidth({ strokeWidth: 0 }), 0);
});

test('fmt : deux décimales au plus, sans zéros inutiles', () => {
  assert.equal(E.fmt(1.005), '1');           // arrondi binaire de 1.005 → 1.00
  assert.equal(E.fmt(12.3456), '12.35');
  assert.equal(E.fmt(-0.004), '0');
});
