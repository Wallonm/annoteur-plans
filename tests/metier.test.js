// Tests des outils de relevé (fonctions pures)
const test   = require('node:test');
const assert = require('node:assert/strict');

// tools-metier.js référence des globales du navigateur : on ne charge que
// les fonctions pures en neutralisant ce qui manque.
global.window = undefined;
const M = require('../tools-metier.js');
const G = require('../geometry.js');

test('measuresToCSV : séparateur « ; », BOM, décimale française', () => {
  const csv = M.measuresToCSV([
    { page: 1, calque: 'Existant', type: 'Cote',     designation: '',       valeur: 3.25, unite: 'm' },
    { page: 2, calque: 'Réseaux',  type: 'Comptage', designation: 'Prise',  valeur: 12,   unite: 'u' },
  ]);
  assert.ok(csv.startsWith('\uFEFF'), 'BOM présent pour Excel');
  const lignes = csv.split('\r\n');
  assert.equal(lignes[0], '\uFEFFPage;Calque;Type;Désignation;Valeur;Unité');
  assert.equal(lignes[1], '1;Existant;Cote;;3,25;m');
  assert.equal(lignes[2], '2;Réseaux;Comptage;Prise;12;u');
});

test('measuresToCSV : échappement des caractères problématiques', () => {
  const csv = M.measuresToCSV([
    { page: 1, calque: 'A;B', type: 'Comptage', designation: 'Porte "P1"', valeur: 1, unite: 'u' },
  ]);
  const ligne = csv.split('\r\n')[1];
  assert.ok(ligne.includes('"A;B"'), 'le point-virgule force les guillemets');
  assert.ok(ligne.includes('"Porte ""P1"""'), 'les guillemets sont doublés');
});

test('summarizeMeasures : les comptages sont agrégés par catégorie et page', () => {
  const res = M.summarizeMeasures([
    { page: 1, calque: 'A', type: 'Comptage', designation: 'Prise',     valeur: 1, unite: 'u' },
    { page: 1, calque: 'A', type: 'Comptage', designation: 'Prise',     valeur: 1, unite: 'u' },
    { page: 1, calque: 'A', type: 'Comptage', designation: 'Radiateur', valeur: 1, unite: 'u' },
    { page: 2, calque: 'A', type: 'Comptage', designation: 'Prise',     valeur: 1, unite: 'u' },
    { page: 1, calque: 'A', type: 'Cote',     designation: '',          valeur: 3, unite: 'm' },
  ]);
  const get = (p, d) => res.find(r => r.page === p && r.designation === d)?.valeur;
  assert.equal(get(1, 'Prise'), 2);
  assert.equal(get(1, 'Radiateur'), 1);
  assert.equal(get(2, 'Prise'), 1, 'les pages ne sont pas fusionnées');
  assert.equal(res.filter(r => r.type === 'Cote').length, 1, 'les cotes sont conservées telles quelles');
});

test('summarizeMeasures : tri par page puis par type', () => {
  const res = M.summarizeMeasures([
    { page: 3, calque: '', type: 'Surface', designation: '', valeur: 1, unite: 'm²' },
    { page: 1, calque: '', type: 'Surface', designation: '', valeur: 2, unite: 'm²' },
    { page: 1, calque: '', type: 'Cote',    designation: '', valeur: 3, unite: 'm' },
  ]);
  assert.deepEqual(res.map(r => [r.page, r.type]), [[1, 'Cote'], [1, 'Surface'], [3, 'Surface']]);
});

test('categoryColor : stable et déterministe', () => {
  const c1 = M.categoryColor('Prise');
  assert.equal(c1, M.categoryColor('Prise'), 'même catégorie → même couleur');
  assert.match(c1, /^#[0-9a-f]{6}$/i);
  assert.ok(new Set(['Prise', 'Radiateur', 'Porte', 'Fenêtre'].map(M.categoryColor)).size > 1,
            'des catégories différentes doivent se distinguer');
});

test('tampons : identifiants uniques et libellés renseignés', () => {
  assert.equal(new Set(M.STAMPS.map(s => s.id)).size, M.STAMPS.length);
  M.STAMPS.forEach(s => {
    assert.ok(s.label.length > 1);
    assert.match(s.color, /^#[0-9a-f]{6}$/i);
  });
});

test('surface d\u2019une pièce réelle : cohérence bout en bout', () => {
  // Une pièce de 4 m × 5 m relevée sur un plan au 1:100
  const ppu   = G.scaleToPointsPerUnit(100, 'm');
  const calib = { pointsPerUnit: ppu, unit: 'm' };
  const piece = [
    { x: 0,       y: 0 },
    { x: 4 * ppu, y: 0 },
    { x: 4 * ppu, y: 5 * ppu },
    { x: 0,       y: 5 * ppu },
  ];
  assert.equal(G.formatArea(G.polygonArea(piece), calib), '20,00 m²');
  assert.equal(G.formatDimension(G.pathLength(piece, true), calib), '18,00 m');
});
