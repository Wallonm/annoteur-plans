// Tests de migration v1.1 → v2.0, sur cas synthétiques ET sur le projet réel.
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const { migrateProject, migratePage, migrateObject } = require('../migrate.js');

const close = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b} (écart ${Math.abs(a - b)})`);

test('migrateObject : la formule (x − offset) / renderScale est appliquée', () => {
  const k = 1 / 0.25;
  const o = migrateObject({ left: 300, top: 150, scaleX: 2, scaleY: 2 }, k, 100, 50);
  close(o.left, (300 - 100) / 0.25);   // 800
  close(o.top,  (150 -  50) / 0.25);   // 400
  close(o.scaleX, 8);                  // l'échelle absorbe le facteur
  close(o.scaleY, 8);
});

test('migrateObject : trait à épaisseur constante converti explicitement', () => {
  const k = 4;
  const uni = migrateObject({ left: 0, top: 0, strokeWidth: 2, strokeUniform: true,
                              strokeDashArray: [8, 4] }, k, 0, 0);
  close(uni.strokeWidth, 8);
  assert.deepEqual(uni.strokeDashArray, [32, 16]);

  // Sans strokeUniform, le trait suit scaleX : il ne faut PAS le convertir
  const norm = migrateObject({ left: 0, top: 0, strokeWidth: 2 }, k, 0, 0);
  close(norm.strokeWidth, 2);
  close(norm.scaleX, 4);
});

test('migrateObject : les points des cotes suivent la conversion', () => {
  const o = migrateObject({
    left: 0, top: 0,
    data: { type: 'dimension', p1: { x: 200, y: 100 }, p2: { x: 400, y: 100 },
            offsetPt: { x: 300, y: 130 }, pixelLength: 200, _lastCenter: { x: 1, y: 2 } },
  }, 1 / 0.5, 100, 50);

  assert.deepEqual(o.data.p1, { x: 200, y: 100 });     // (200−100)/0.5
  assert.deepEqual(o.data.p2, { x: 600, y: 100 });     // (400−100)/0.5
  close(o.data.pointLength, 400);
  assert.equal(o.data.pixelLength, undefined);
  assert.equal(o.data._lastCenter, undefined, 'cache interne retiré');
});

test('migratePage : la calibration passe en points par unité', () => {
  const page = migratePage({
    renderScale: 0.25, canvasOffsetX: 0, canvasOffsetY: 0, objects: [],
    calibration: { pixelsPerUnit: 0.5, unit: 'm' },
  });
  close(page.calibration.pointsPerUnit, 0.5 / 0.25);   // 2 pt par mètre
  assert.equal(page.calibration.unit, 'm');
  assert.equal(page.calibration.pixelsPerUnit, undefined);
  assert.equal(page.renderScale, undefined, 'renderScale ne doit plus exister');
  assert.equal(page.canvasOffsetX, undefined);
});

test('migratePage : une page jamais affichée est laissée intacte', () => {
  const page = migratePage({ objects: [{ left: 10, top: 10 }], rotation: 90 });
  assert.deepEqual(page.objects, [{ left: 10, top: 10 }]);
  assert.equal(page.rotation, 90);
});

test('migrateProject : v1.0 (calques globaux) répartis par page', () => {
  const { data } = migrateProject({
    version: '1.0',
    layers: [{ id: 1, name: 'Calque 1', visible: true, locked: false, color: '#fff' }],
    pages: { 1: { renderScale: 1, objects: [] } },
  });
  assert.equal(data.version, '2.0');
  assert.equal(data.pages['1'].layers.length, 1);
  assert.equal(data.pages['1'].activeLayerId, 1);
  assert.equal(data.layers, undefined);
});

test('migrateProject : idempotent, un projet v2.0 n’est pas reconverti', () => {
  const v2 = { version: '2.0', pages: { 1: { objects: [{ left: 42 }] } } };
  const { data, notes } = migrateProject(v2);
  assert.equal(data.pages['1'].objects[0].left, 42);
  assert.equal(notes.length, 0);
});

test('migrateProject : format inconnu rejeté explicitement', () => {
  assert.throws(() => migrateProject({ version: '9.9', pages: {} }), /non pris en charge/);
  assert.throws(() => migrateProject(null), /illisible/);
});

// ------------------------------------------------------------
// Projet réel : plan_redresse_v4, 7 pages, DEUX repères distincts
// ------------------------------------------------------------
const fixture = path.join(__dirname, 'fixtures', 'projet-v1.1.json');

test('projet réel : conversion complète et cohérente', { skip: !fs.existsSync(fixture) }, () => {
  const src = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  const { data, notes } = migrateProject(src);

  assert.equal(data.version, '2.0');
  assert.ok(notes.some(n => /échelles d'affichage différentes/.test(n)),
            'le projet contient bien plusieurs repères, ce doit être signalé');

  let totalObjets = 0;
  for (const [key, srcPage] of Object.entries(src.pages)) {
    const outPage = data.pages[key];
    const rs = srcPage.renderScale;
    if (!rs) continue;

    const k  = 1 / rs;
    const ox = srcPage.canvasOffsetX || 0;
    const oy = srcPage.canvasOffsetY || 0;

    assert.equal(outPage.objects.length, srcPage.objects.length,
                 `page ${key} : aucun objet ne doit être perdu`);

    srcPage.objects.forEach((o, i) => {
      totalObjets++;
      const m = outPage.objects[i];
      if (typeof o.left === 'number') close(m.left, (o.left - ox) * k, 1e-6);
      if (typeof o.top  === 'number') close(m.top,  (o.top  - oy) * k, 1e-6);
      assert.equal(m.type, o.type, 'le type est préservé');
    });

    if (srcPage.calibration) {
      close(outPage.calibration.pointsPerUnit, srcPage.calibration.pixelsPerUnit * k, 1e-9);
    }
  }
  assert.ok(totalObjets > 0, 'la fixture doit contenir des annotations');
});

test('projet réel : les annotations restent dans les limites de la page', { skip: !fs.existsSync(fixture) }, () => {
  const src = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  const { data } = migrateProject(src);

  for (const [key, srcPage] of Object.entries(src.pages)) {
    if (!srcPage.renderScale || !srcPage.pageW) continue;
    // Dimensions de la page en points (pageW était en pixels écran)
    const pageWpt = srcPage.pageW / srcPage.renderScale;
    const pageHpt = srcPage.pageH / srcPage.renderScale;
    const marge   = Math.max(pageWpt, pageHpt) * 0.25;   // tolérance : objets ancrés en bordure

    data.pages[key].objects.forEach((o, i) => {
      if (typeof o.left !== 'number') return;
      assert.ok(o.left >= -marge && o.left <= pageWpt + marge,
        `page ${key} objet ${i} : left=${o.left.toFixed(0)} hors de [0, ${pageWpt.toFixed(0)}]`);
      assert.ok(o.top >= -marge && o.top <= pageHpt + marge,
        `page ${key} objet ${i} : top=${o.top.toFixed(0)} hors de [0, ${pageHpt.toFixed(0)}]`);
    });
  }
});

test('projet réel : calibrations converties dans un ordre de grandeur plausible', { skip: !fs.existsSync(fixture) }, () => {
  const { data } = migrateProject(JSON.parse(fs.readFileSync(fixture, 'utf8')));
  const calibs = Object.values(data.pages).map(p => p.calibration).filter(Boolean);
  assert.ok(calibs.length > 0, 'la fixture doit contenir des calibrations');
  for (const c of calibs) {
    assert.ok(c.pointsPerUnit > 0 && Number.isFinite(c.pointsPerUnit));
    assert.ok(!('pixelsPerUnit' in c), 'plus aucune calibration en pixels');
    assert.ok(['m', 'cm', 'mm'].includes(c.unit));
  }
});
