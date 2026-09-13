// ============================================================
// migrate.js — Migration des fichiers projet
// ------------------------------------------------------------
// v1.1 → v2.0 : les annotations étaient stockées en PIXELS ÉCRAN,
// dans un repère dépendant de la taille de la fenêtre au moment du
// rendu (renderScale + canvasOffsetX/Y, propres à chaque page).
// La v2.0 les stocke en POINTS PDF, repère stable du document.
//
//     x_points = (x_pixels − canvasOffsetX) / renderScale
//
// Chaque page est convertie avec SES PROPRES valeurs : un même projet
// pouvait contenir plusieurs repères si la fenêtre avait été
// redimensionnée en cours de session.
// ============================================================

const PROJECT_FORMAT_CURRENT = '2.1';

// Propriétés d'un objet Fabric qui sont des longueurs à mettre à l'échelle
// lorsque le trait ne suit PAS la mise à l'échelle de l'objet (strokeUniform).
function scaleUniformStroke(obj, k) {
  if (typeof obj.strokeWidth === 'number') obj.strokeWidth *= k;
  if (Array.isArray(obj.strokeDashArray)) obj.strokeDashArray = obj.strokeDashArray.map(v => v * k);
}

// Convertit un objet Fabric sérialisé du repère écran vers le repère page.
// left/top subissent la translation + l'échelle ; scaleX/scaleY absorbent
// l'échelle pour que la géométrie interne (points, path, width/height,
// fontSize) reste inchangée.
function migrateObject(obj, k, offsetX, offsetY) {
  const o = { ...obj };

  if (typeof o.left === 'number') o.left = (o.left - offsetX) * k;
  if (typeof o.top  === 'number') o.top  = (o.top  - offsetY) * k;

  o.scaleX = (typeof o.scaleX === 'number' ? o.scaleX : 1) * k;
  o.scaleY = (typeof o.scaleY === 'number' ? o.scaleY : 1) * k;

  // Trait à épaisseur constante : il n'est pas emporté par scaleX/scaleY,
  // il faut donc le convertir explicitement.
  if (o.strokeUniform) scaleUniformStroke(o, k);

  // Données métier exprimées en coordonnées absolues (cotes)
  if (o.data) {
    const d = { ...o.data };
    for (const key of ['p1', 'p2', 'offsetPt']) {
      if (d[key] && typeof d[key].x === 'number') {
        d[key] = { x: (d[key].x - offsetX) * k, y: (d[key].y - offsetY) * k };
      }
    }
    if (typeof d.pixelLength === 'number') {
      d.pointLength = d.pixelLength * k;
      delete d.pixelLength;
    }
    delete d._lastCenter;
    delete d.dimGroup;
    delete d.polyObj;
    o.data = d;
  }

  return o;
}

// Migre une page complète. Retourne la page migrée (nouvel objet).
function migratePage(page) {
  const renderScale = page.renderScale;
  const offsetX = page.canvasOffsetX || 0;
  const offsetY = page.canvasOffsetY || 0;
  const objects = Array.isArray(page.objects) ? page.objects : [];

  const out = { ...page };
  delete out.canvasOffsetX;
  delete out.canvasOffsetY;
  delete out.renderScale;
  delete out.pageW;          // recalculés au rendu, en points
  delete out.pageH;

  // Page jamais affichée (renderScale par défaut, aucun offset) : elle ne
  // peut pas contenir d'annotations placées, rien à convertir.
  if (!renderScale || renderScale <= 0) {
    out.objects = objects;
    return out;
  }

  const k = 1 / renderScale;
  out.objects = objects.map(o => migrateObject(o, k, offsetX, offsetY));

  // La calibration était en pixels écran par unité → points par unité
  if (page.calibration && typeof page.calibration.pixelsPerUnit === 'number') {
    out.calibration = {
      pointsPerUnit: page.calibration.pixelsPerUnit * k,
      unit:          page.calibration.unit,
    };
  }

  return out;
}

// ------------------------------------------------------------
// 2.0 → 2.1 : les calques deviennent globaux au document
// ------------------------------------------------------------
// Jusqu'en 2.0 les calques étaient stockés par page alors que leurs
// identifiants étaient globaux et que la suppression d'un calque effaçait
// les objets de TOUTES les pages — un modèle incohérent. Pour un jeu de
// plans, l'attente est un jeu de calques unique.
function liftLayersToDocument(data) {
  const layers = [];
  const seen   = new Map();
  let activeLayerId = null;

  Object.values(data.pages || {}).forEach(page => {
    (page.layers || []).forEach(l => {
      if (l == null || l.id == null) return;
      if (!seen.has(l.id)) { seen.set(l.id, { ...l }); layers.push(seen.get(l.id)); }
    });
    if (activeLayerId == null && page.activeLayerId != null) activeLayerId = page.activeLayerId;
  });

  const out = { ...data, pages: {} };
  Object.keys(data.pages || {}).forEach(key => {
    const { layers: _l, activeLayerId: _a, ...rest } = data.pages[key];
    out.pages[key] = rest;
  });

  out.layers        = layers;
  out.activeLayerId = activeLayerId ?? layers[0]?.id ?? null;
  // nextLayerId doit rester au-dessus de tous les identifiants existants
  const maxId = layers.reduce((m, l) => Math.max(m, Number(l.id) || 0), 0);
  out.nextLayerId = Math.max(Number(data.nextLayerId) || 1, maxId + 1);

  return { data: out, count: layers.length };
}

// Point d'entrée : migre un projet vers le format courant.
// Retourne { data, notes } — `notes` décrit ce qui a été converti.
function migrateProject(data) {
  const notes = [];
  if (!data || typeof data !== 'object') throw new Error('Projet illisible');

  let version = String(data.version || '1.0');
  if (version === PROJECT_FORMAT_CURRENT) return { data, notes };

  if (!['1.0', '1.1', '2.0'].includes(version)) {
    throw new Error(`Format de projet non pris en charge : ${version}`);
  }

  let out = { ...data, pages: { ...(data.pages || {}) } };

  // --- Étape 1 : pixels écran → points PDF ---
  if (version === '1.0' || version === '1.1') {
    const pages = {};
    let converted = 0;

    Object.keys(out.pages).forEach(key => {
      const page = { ...out.pages[key] };
      // v1.0 : calques globaux, recopiés sur chaque page avant reprise à l'étape 2
      if (!page.layers && Array.isArray(data.layers)) {
        page.layers        = data.layers.map(l => ({ ...l }));
        page.activeLayerId = data.layers[0]?.id ?? null;
      }
      pages[key] = migratePage(page);
      if (page.renderScale > 0 && (page.objects || []).length) converted++;
    });

    out.pages = pages;
    delete out.layers;

    if (converted) {
      notes.push(`${converted} page(s) converties des pixels écran vers les points PDF.`);
      const scales = [...new Set(Object.values(data.pages || {})
        .map(p => p.renderScale).filter(s => s > 0))];
      if (scales.length > 1) {
        notes.push(
          `Ce projet contenait ${scales.length} échelles d'affichage différentes ` +
          `(fenêtre redimensionnée en cours de session) : chaque page a été convertie ` +
          `avec la sienne.`);
      }
    }
    version = '2.0';
  }

  // --- Étape 2 : calques par page → calques globaux ---
  if (version === '2.0') {
    const lifted = liftLayersToDocument(out);
    out = lifted.data;
    if (lifted.count) {
      notes.push(`${lifted.count} calque(s) regroupés au niveau du document.`);
    }
  }

  out.version = PROJECT_FORMAT_CURRENT;
  return { data: out, notes };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    migrateProject, migratePage, migrateObject, liftLayersToDocument,
    PROJECT_FORMAT_CURRENT,
  };
}
