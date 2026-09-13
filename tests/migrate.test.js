// Tests de migration v1.x → v2.1, sur cas synthétiques ET sur le projet réel.
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

test('migrateProject : v1.0 (calques déjà globaux) traversé sans perte', () => {
  const { data } = migrateProject({
    version: '1.0',
    layers: [{ id: 1, name: 'Calque 1', visible: true, locked: false, color: '#fff' }],
    pages: { 1: { renderScale: 1, objects: [] } },
  });
  assert.equal(data.version, '2.1');
  assert.deepEqual(data.layers.map(l => l.name), ['Calque 1']);
  assert.equal(data.activeLayerId, 1);
  assert.equal(data.pages['1'].layers, undefined, 'les calques ne sont plus par page');
});

test('migrateProject : un projet 2.1 n’est pas reconverti', () => {
  const v21 = { version: '2.1', layers: [], pages: { 1: { objects: [{ left: 42 }] } } };
  const { data, notes } = migrateProject(v21);
  assert.equal(data.pages['1'].objects[0].left, 42);
  assert.equal(notes.length, 0);
});

test('migrateProject : un projet 2.0 est repris à l’étape des calques seulement', () => {
  const { data, notes } = migrateProject({
    version: '2.0',
    pages: { 1: { objects: [{ left: 42 }], layers: [{ id: 4, name: 'X' }], activeLayerId: 4 } },
  });
  assert.equal(data.pages['1'].objects[0].left, 42, 'aucune reconversion de coordonnées');
  assert.deepEqual(data.layers.map(l => l.id), [4]);
  assert.ok(notes.some(n => /calque/.test(n)));
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

  assert.equal(data.version, '2.1');
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

// ------------------------------------------------------------
// 2.0 → 2.1 : calques globaux
// ------------------------------------------------------------
const { liftLayersToDocument } = require('../migrate.js');

test('liftLayersToDocument : union par identifiant, premier nom conservé', () => {
  const { data, count } = liftLayersToDocument({
    nextLayerId: 2,
    pages: {
      1: { objects: [], layers: [{ id: 1, name: 'Existant' }, { id: 3, name: 'Réseaux' }],
           activeLayerId: 3 },
      2: { objects: [], layers: [{ id: 3, name: 'Réseaux (bis)' }, { id: 7, name: 'Cotes' }],
           activeLayerId: 7 },
    },
  });

  assert.equal(count, 3);
  assert.deepEqual(data.layers.map(l => l.id), [1, 3, 7]);
  assert.equal(data.layers.find(l => l.id === 3).name, 'Réseaux', 'premier nom rencontré');
  assert.equal(data.activeLayerId, 3);
  assert.ok(data.nextLayerId >= 8, `nextLayerId doit dépasser le plus grand id (obtenu ${data.nextLayerId})`);
  assert.equal(data.pages['1'].layers, undefined, 'plus de calques par page');
  assert.equal(data.pages['2'].activeLayerId, undefined);
});

test('liftLayersToDocument : projet sans aucun calque', () => {
  const { data, count } = liftLayersToDocument({ pages: { 1: { objects: [] } } });
  assert.equal(count, 0);
  assert.deepEqual(data.layers, []);
  assert.equal(data.activeLayerId, null);
  assert.equal(data.nextLayerId, 1);
});

test('migrateProject : v1.1 → 2.1 en une passe (points PDF + calques globaux)', () => {
  const { data, notes } = migrateProject({
    version: '1.1', nextLayerId: 3,
    pages: {
      1: { renderScale: 0.5, canvasOffsetX: 10, canvasOffsetY: 0,
           objects: [{ type: 'rect', left: 60, top: 20, data: { layerId: 1 } }],
           layers: [{ id: 1, name: 'A' }], activeLayerId: 1,
           calibration: { pixelsPerUnit: 2, unit: 'cm' } },
      2: { renderScale: 0.25, canvasOffsetX: 0, canvasOffsetY: 0, objects: [],
           layers: [{ id: 2, name: 'B' }], activeLayerId: 2 },
    },
  });

  assert.equal(data.version, '2.1');
  close(data.pages['1'].objects[0].left, (60 - 10) / 0.5);      // 100
  close(data.pages['1'].calibration.pointsPerUnit, 4);
  assert.deepEqual(data.layers.map(l => l.name), ['A', 'B']);
  assert.equal(data.pages['1'].layers, undefined);
  assert.ok(notes.length >= 2, 'les deux étapes doivent être signalées');
});

test('projet réel : les calques remontent au document sans doublon', { skip: !fs.existsSync(fixture) }, () => {
  const src = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  const { data } = migrateProject(src);

  const idsSource = new Set();
  Object.values(src.pages).forEach(p => (p.layers || []).forEach(l => idsSource.add(l.id)));

  assert.equal(data.version, '2.1');
  assert.deepEqual(new Set(data.layers.map(l => l.id)), idsSource,
                   'tous les identifiants de calque sont conservés, sans doublon');
  assert.equal(data.layers.length, idsSource.size);
  const maxId = Math.max(...data.layers.map(l => l.id));
  assert.ok(data.nextLayerId > maxId, 'nextLayerId au-dessus du plus grand identifiant');

  // Les calques homonymes créés page par page doivent rester distinguables
  const noms = data.layers.map(l => l.name);
  assert.equal(new Set(noms).size, noms.length, `noms de calque en double : ${noms.join(', ')}`);

  // Tous les objets référencent un calque existant
  const connus = new Set(data.layers.map(l => l.id));
  Object.values(data.pages).forEach(p => (p.objects || []).forEach(o => {
    if (o.data?.layerId != null) assert.ok(connus.has(o.data.layerId),
      `calque ${o.data.layerId} référencé mais absent`);
  }));
});

test('liftLayersToDocument : les homonymes sont suffixés par leur page d’origine', () => {
  const { data } = liftLayersToDocument({
    pages: {
      1: { layers: [{ id: 1, name: 'Annotations' }] },
      3: { layers: [{ id: 2, name: 'Annotations' }] },
      4: { layers: [{ id: 3, name: 'Annotations' }, { id: 4, name: 'Réseaux' }] },
    },
  });
  assert.deepEqual(data.layers.map(l => l.name),
                   ['Annotations', 'Annotations (p.3)', 'Annotations (p.4)', 'Réseaux']);
  assert.deepEqual(data.layers.map(l => l.id), [1, 2, 3, 4], 'les identifiants sont intacts');
});
