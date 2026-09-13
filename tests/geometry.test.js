// Tests de la géométrie pure — `node --test tests/`
const test   = require('node:test');
const assert = require('node:assert/strict');
const G = require('../geometry.js');

const close = (a, b, tol = 1e-9) =>
  assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b} (écart ${Math.abs(a - b)})`);

test('normV normalise et protège du vecteur nul', () => {
  const n = G.normV({ x: 3, y: 4 });
  close(n.x, 0.6); close(n.y, 0.8);
  assert.deepEqual(G.normV({ x: 0, y: 0 }), { x: 0, y: 0 });
});

test('computeDimGeometry : ligne de cote parallèle et à la bonne distance', () => {
  const p1 = { x: 0, y: 0 }, p2 = { x: 100, y: 0 };
  const geo = G.computeDimGeometry(p1, p2, { x: 50, y: 30 });

  close(geo.len, 100);
  close(geo.angle, 0);
  // Segment horizontal, écartement vers le bas (y croissant)
  close(geo.c1.x, 0); close(geo.c2.x, 100);
  close(geo.c1.y, geo.c2.y);                       // parallèle à p1-p2
  close(Math.abs(geo.c1.y - p1.y), 30);            // à 30 pt du segment
  close(geo.mid.x, 50);
});

test('computeDimGeometry : écartement de signe opposé bascule les rappels', () => {
  const p1 = { x: 0, y: 0 }, p2 = { x: 100, y: 0 };
  const bas  = G.computeDimGeometry(p1, p2, { x: 50, y:  30 });
  const haut = G.computeDimGeometry(p1, p2, { x: 50, y: -30 });
  assert.ok(bas.offset * haut.offset < 0, 'les offsets doivent être de signes opposés');
  // Les lignes de rappel partent du point mesuré vers la ligne de cote
  assert.ok(Math.sign(bas.e1e.y - bas.e1s.y) !== Math.sign(haut.e1e.y - haut.e1s.y));
});

test('computeDimGeometry : segment vertical et segment dégénéré', () => {
  const geo = G.computeDimGeometry({ x: 10, y: 0 }, { x: 10, y: 50 }, { x: 40, y: 25 });
  close(geo.len, 50);
  close(Math.abs(geo.angle), 90);
  close(geo.c1.x, geo.c2.x);

  const deg = G.computeDimGeometry({ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 9, y: 9 });
  assert.ok(Number.isFinite(deg.mid.x) && Number.isFinite(deg.mid.y), 'pas de NaN');
});

test('dimTextAngle : le texte n’est jamais à l’envers', () => {
  assert.equal(G.dimTextAngle(0), 0);
  assert.equal(G.dimTextAngle(45), 45);
  assert.equal(G.dimTextAngle(180), 0);
  assert.equal(G.dimTextAngle(-170), 10);
});

test('makeRevisionCloudPath : chemin fermé, arcs sur les 4 côtés', () => {
  const d = G.makeRevisionCloudPath(0, 0, 200, 100);
  assert.ok(d.startsWith('M '), 'commence par un déplacement');
  assert.ok(d.trim().endsWith('Z'), 'chemin fermé');
  const arcs = (d.match(/A /g) || []).length;
  assert.ok(arcs >= 8, `au moins 8 arcs, obtenu ${arcs}`);
  // Rectangle dégénéré : pas de boucle infinie ni de NaN
  assert.ok(!/NaN/.test(G.makeRevisionCloudPath(0, 0, 1, 1)));
});

test('scaleToPointsPerUnit : échelles normalisées', () => {
  // À 1:100, 1 m réel = 10 mm papier = 10/0.3528 ≈ 28.35 pt
  close(G.scaleToPointsPerUnit(100, 'm'), 1000 / (25.4 / 72 * 100), 1e-9);
  close(G.scaleToPointsPerUnit(100, 'm'), 28.3464566929, 1e-9);
  // 1:50, en cm : 1 cm réel = 0.2 mm papier
  close(G.scaleToPointsPerUnit(50, 'cm'), 10 / (25.4 / 72 * 50), 1e-9);
  // Cohérence entre unités : 1 m = 100 cm
  close(G.scaleToPointsPerUnit(100, 'm'), G.scaleToPointsPerUnit(100, 'cm') * 100, 1e-9);
});

test('scaleToPointsPerUnit : aller-retour avec pointsPerUnitToScale', () => {
  for (const n of [20, 25, 50, 100, 200, 500, 75]) {
    for (const u of ['m', 'cm', 'mm']) {
      close(G.pointsPerUnitToScale(G.scaleToPointsPerUnit(n, u), u), n, 1e-9);
    }
  }
});

test('scaleToPointsPerUnit : entrées invalides rejetées', () => {
  assert.throws(() => G.scaleToPointsPerUnit(100, 'pouces'), /Unité inconnue/);
  assert.throws(() => G.scaleToPointsPerUnit(0, 'm'));
  assert.throws(() => G.scaleToPointsPerUnit(-5, 'm'));
});

test('formatDimension : points bruts si non calibré, unité réelle sinon', () => {
  assert.equal(G.formatDimension(123.4, null), '123 pt');
  // À 1:100, 283.46 pt = 10 m
  const calib = { pointsPerUnit: G.scaleToPointsPerUnit(100, 'm'), unit: 'm' };
  assert.equal(G.formatDimension(G.scaleToPointsPerUnit(100, 'm') * 10, calib), '10.00 m');
});

test('formatArea : surface au carré de l’unité', () => {
  const ppu = G.scaleToPointsPerUnit(100, 'm');
  // Une pièce de 4 m × 5 m = 20 m²
  assert.equal(G.formatArea((4 * ppu) * (5 * ppu), { pointsPerUnit: ppu, unit: 'm' }), '20.00 m²');
});

test('polygonArea : lacet, indépendant du sens de parcours', () => {
  const carre = [{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}];
  close(G.polygonArea(carre), 100);
  close(G.polygonArea([...carre].reverse()), 100);
  // Forme en L : 100 − 25
  close(G.polygonArea([{x:0,y:0},{x:10,y:0},{x:10,y:5},{x:5,y:5},{x:5,y:10},{x:0,y:10}]), 75);
  assert.equal(G.polygonArea([{x:0,y:0},{x:1,y:1}]), 0);
});

test('pathLength : ouverte et fermée', () => {
  const pts = [{x:0,y:0},{x:3,y:4},{x:3,y:4}];
  close(G.pathLength(pts), 5);
  close(G.pathLength([{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}], true), 40);
});

test('rotatePoint90 : les coins de la page tombent juste', () => {
  const H = 842;   // hauteur A4 en points
  assert.deepEqual(G.rotatePoint90({ x: 0, y: 0 }, H), { x: H, y: 0 });
  assert.deepEqual(G.rotatePoint90({ x: 0, y: H }, H), { x: 0, y: 0 });
  const W = 595;
  assert.deepEqual(G.rotatePoint90({ x: W, y: 0 }, H), { x: H, y: W });
});

test('rotatePoint90 : quatre rotations reviennent au point de départ', () => {
  const W = 595, H = 842;
  let p = { x: 120, y: 300 };
  p = G.rotatePoint90(p, H);   // page devient H × W
  p = G.rotatePoint90(p, W);
  p = G.rotatePoint90(p, H);
  p = G.rotatePoint90(p, W);
  close(p.x, 120, 1e-9); close(p.y, 300, 1e-9);
});

test('constrainAngle : contrainte orthogonale et à 45°', () => {
  const o = { x: 0, y: 0 };
  const h = G.constrainAngle(o, { x: 100, y: 6 }, 90);
  close(h.y, 0, 1e-9); close(h.x, Math.hypot(100, 6), 1e-9);   // longueur conservée

  const d = G.constrainAngle(o, { x: 100, y: 90 }, 45);
  close(d.x, d.y, 1e-9);
  assert.deepEqual(G.constrainAngle(o, { x: 0, y: 0 }, 45), { x: 0, y: 0 });
});

test('nearestPoint : respecte la tolérance', () => {
  const cands = [{x:0,y:0},{x:50,y:50}];
  assert.deepEqual(G.nearestPoint({x:3,y:4}, cands, 8), {x:0,y:0});
  assert.equal(G.nearestPoint({x:3,y:4}, cands, 2), null);
  assert.equal(G.nearestPoint({x:0,y:0}, [], 10), null);
});
