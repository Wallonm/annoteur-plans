// ============================================================
// tools-metier.js — Outils de relevé et de chiffrage
// ------------------------------------------------------------
// Surface et périmètre, comptage par catégorie, bulle de renvoi,
// tampons, et export du récapitulatif en CSV.
// Toutes les grandeurs sont en points PDF et converties via la
// calibration de la page (geometry.js).
// ============================================================

// ------------------------------------------------------------
// SURFACE ET PÉRIMÈTRE
// ------------------------------------------------------------

// Sommets d'un polygone/polyligne en coordonnées page
function shapePoints(obj) {
  if (obj.points) return getPolyAbsolutePoints(obj).map(p => ({ x: p.x, y: p.y }));
  if (obj.type === 'rect') {
    const m = obj.calcTransformMatrix();
    const w = obj.width / 2, h = obj.height / 2;
    return [{ x: -w, y: -h }, { x: w, y: -h }, { x: w, y: h }, { x: -w, y: h }]
      .map(p => fabric.util.transformPoint(p, m));
  }
  return null;
}

// Étiquette « surface + périmètre » posée au centre d'une forme fermée
function addAreaLabel(obj) {
  const pts = shapePoints(obj);
  if (!pts || pts.length < 3) { showToast('Sélectionnez un polygone ou un rectangle'); return null; }

  const calib = getPageCalibration();
  const aire  = polygonArea(pts);
  const perim = pathLength(pts, true);
  const texte = `${formatArea(aire, calib)}\n${formatDimension(perim, calib)} de périmètre`;

  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;

  ensureActiveLayer();
  const label = new fabric.Text(texte, {
    left: cx, top: cy,
    originX: 'center', originY: 'center',
    fontSize: App.toolProps.fontSize,
    fill: App.toolProps.strokeColor,
    fontFamily: 'Arial',
    textAlign: 'center',
    backgroundColor: 'rgba(255,255,255,0.82)',
    padding: 2,
    data: {
      type: 'areaLabel', layerId: App.activeLayerId, pageNum: App.currentPage,
      areaPt2: aire, perimeterPt: perim,
      // L'objet mesuré est identifié pour pouvoir recalculer après recalibration
      sourceType: obj.type,
    },
  });
  applyLayerPropsToObj(label);
  App.canvas.add(label);
  App.canvas.setActiveObject(label);
  App.canvas.requestRenderAll();
  saveHistoryState();
  showToast(`Surface : ${formatArea(aire, calib)}`);
  return label;
}

// Met à jour les étiquettes de surface après changement de calibration
function updateAllAreaLabels() {
  const calib = getPageCalibration();
  App.canvas.getObjects().forEach(o => {
    if (o.data?.type !== 'areaLabel') return;
    o.set('text', `${formatArea(o.data.areaPt2, calib)}\n` +
                  `${formatDimension(o.data.perimeterPt, calib)} de périmètre`);
  });
  App.canvas.requestRenderAll();
}

// ------------------------------------------------------------
// COMPTAGE
// ------------------------------------------------------------
// Clic après clic, pose un repère numéroté dans la catégorie courante.
// C'est l'outil de base du chiffrage sur plan : compter les prises, les
// radiateurs, les portes…
// ------------------------------------------------------------

const COUNT_COLORS = ['#e05c5c', '#f0a030', '#50c060', '#50b8e0', '#a060e0', '#e060a0'];

function currentCountCategory() {
  return (document.getElementById('count-category')?.value || 'Élément').trim() || 'Élément';
}

// Numéro suivant dans la catégorie, toutes pages confondues
function nextCountIndex(category) {
  let max = 0;
  for (let p = 1; p <= App.totalPages; p++) {
    const objs = (p === App.currentPage)
      ? App.canvas.getObjects().map(o => o.data)
      : (App.pageData[p]?.objects || []).map(o => o.data);
    objs.forEach(d => {
      if (d?.type === 'count' && d.category === category) max = Math.max(max, d.index || 0);
    });
  }
  return max + 1;
}

function categoryColor(category) {
  let h = 0;
  for (const ch of category) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COUNT_COLORS[h % COUNT_COLORS.length];
}

function toolCount_down(pt) {
  if (!requireDocument()) return;
  ensureActiveLayer();

  const category = currentCountCategory();
  const index    = nextCountIndex(category);
  const color    = categoryColor(category);
  // Taille indexée sur le format du plan pour rester lisible à l'ajustement
  const r = Math.max(6, (App.pageData[App.currentPage]?.pageW || 600) / 90);

  const cercle = new fabric.Circle({
    radius: r, fill: 'rgba(255,255,255,0.9)', stroke: color,
    strokeWidth: Math.max(1, r / 6), strokeUniform: true,
    originX: 'center', originY: 'center',
  });
  const texte = new fabric.Text(String(index), {
    fontSize: r * 1.15, fill: color, fontFamily: 'Arial', fontWeight: 'bold',
    originX: 'center', originY: 'center',
  });

  const marqueur = new fabric.Group([cercle, texte], {
    left: pt.x, top: pt.y,
    originX: 'center', originY: 'center',
    hasControls: false,
    data: {
      type: 'count', category, index,
      layerId: App.activeLayerId, pageNum: App.currentPage,
    },
  });

  applyLayerPropsToObj(marqueur);
  App.canvas.add(marqueur);
  App.canvas.requestRenderAll();
  saveHistoryState();
  updateCountBadge();
}

// Total par catégorie sur l'ensemble du document
function countTotals() {
  const totaux = {};
  for (let p = 1; p <= App.totalPages; p++) {
    const datas = (p === App.currentPage)
      ? App.canvas.getObjects().filter(o => !isTempObject(o)).map(o => o.data)
      : (App.pageData[p]?.objects || []).map(o => o.data);
    datas.forEach(d => {
      if (d?.type !== 'count') return;
      totaux[d.category] = (totaux[d.category] || 0) + 1;
    });
  }
  return totaux;
}

function updateCountBadge() {
  const el = document.getElementById('count-total');
  if (!el) return;
  const totaux = countTotals();
  const cat = currentCountCategory();
  el.textContent = `${cat} : ${totaux[cat] || 0}`;
}

// ------------------------------------------------------------
// BULLE DE RENVOI (leader)
// ------------------------------------------------------------
// Deux clics : le point désigné, puis l'emplacement du texte.
// ------------------------------------------------------------
function toolLeader_down(pt) {
  if (!requireDocument()) return;

  if (App.draw.step === 0) {
    App.draw.step    = 1;
    App.draw.startPt = { x: pt.x, y: pt.y };
    const l = new fabric.Line([pt.x, pt.y, pt.x, pt.y], tempProps({
      stroke: App.toolProps.strokeColor, strokeWidth: 1, strokeDashArray: [5, 3],
    }));
    App.canvas.add(l);
    App.draw.previewLine = l;
    showIndicator('leader-indicator');
    return;
  }

  removeTempObjects();
  App.draw.previewLine = null;
  hideIndicator('leader-indicator');
  createLeader(App.draw.startPt, pt);
  App.draw.step = 0;
  App.draw.startPt = null;
}

function createLeader(from, to) {
  ensureActiveLayer();
  const tp   = App.toolProps;
  const size = tp.fontSize;
  const tete = size * 0.55;                       // taille de la pointe de flèche

  const ang  = Math.atan2(to.y - from.y, to.x - from.x);
  const ligne = new fabric.Line([from.x, from.y, to.x, to.y], {
    stroke: tp.strokeColor, strokeWidth: tp.strokeWidth, strokeUniform: true,
  });
  const pointe = new fabric.Triangle({
    left: from.x, top: from.y,
    width: tete * 1.4, height: tete * 2,
    fill: tp.strokeColor,
    originX: 'center', originY: 'center',
    angle: ang * 180 / Math.PI + 90,              // la pointe regarde le point désigné
  });
  const texte = new fabric.Textbox('Annotation', {
    left: to.x, top: to.y - size,
    width: size * 10,
    fontSize: size, fill: tp.fontColor, fontFamily: 'Arial',
    backgroundColor: 'rgba(255,255,255,0.82)',
    originX: to.x < from.x ? 'right' : 'left',
  });

  const groupe = new fabric.Group([ligne, pointe, texte], {
    data: { type: 'leader', layerId: App.activeLayerId, pageNum: App.currentPage },
  });
  applyLayerPropsToObj(groupe);
  App.canvas.add(groupe);
  App.canvas.setActiveObject(groupe);
  App.canvas.requestRenderAll();
  saveHistoryState();
}

// ------------------------------------------------------------
// TAMPONS
// ------------------------------------------------------------
const STAMPS = [
  { id: 'bpe',      label: 'BON POUR EXÉCUTION', color: '#2e8b57' },
  { id: 'valider',  label: 'À VALIDER',          color: '#e07b20' },
  { id: 'modifier', label: 'À MODIFIER',         color: '#e05c5c' },
  { id: 'vu',       label: 'VU',                 color: '#3a70c0' },
  { id: 'annule',   label: 'ANNULÉ',             color: '#888899' },
];

function placeStamp(stampId) {
  if (!requireDocument()) return;
  const st = STAMPS.find(s => s.id === stampId);
  if (!st) return;
  ensureActiveLayer();

  const fc  = App.canvas;
  const vpt = fc.viewportTransform;
  const cx  = (fc.width  / 2 - vpt[4]) / vpt[0];
  const cy  = (fc.height / 2 - vpt[5]) / vpt[3];

  const taille = Math.max(12, (App.pageData[App.currentPage]?.pageW || 600) / 28);
  const date   = new Date().toLocaleDateString('fr-FR');

  const titre = new fabric.Text(st.label, {
    fontSize: taille, fill: st.color, fontFamily: 'Arial', fontWeight: 'bold',
    originX: 'center', originY: 'center', top: -taille * 0.35,
  });
  const sousTitre = new fabric.Text(date, {
    fontSize: taille * 0.45, fill: st.color, fontFamily: 'Arial',
    originX: 'center', originY: 'center', top: taille * 0.55,
  });
  const cadre = new fabric.Rect({
    width:  titre.width + taille * 1.2,
    height: taille * 2.2,
    fill: 'rgba(255,255,255,0.75)', stroke: st.color,
    strokeWidth: Math.max(1.5, taille / 12), strokeUniform: true,
    rx: taille / 5, ry: taille / 5,
    originX: 'center', originY: 'center',
  });

  const groupe = new fabric.Group([cadre, titre, sousTitre], {
    left: cx, top: cy,
    originX: 'center', originY: 'center',
    angle: -12,
    data: { type: 'stamp', stampId, layerId: App.activeLayerId, pageNum: App.currentPage },
  });
  applyLayerPropsToObj(groupe);
  fc.add(groupe);
  fc.setActiveObject(groupe);
  fc.requestRenderAll();
  saveHistoryState();
}

// ------------------------------------------------------------
// RÉCAPITULATIF ET EXPORT CSV
// ------------------------------------------------------------
// Rassemble cotes, surfaces et comptages de TOUTES les pages. Jusqu'ici
// ces mesures n'existaient que dans le dessin, impossibles à reprendre
// dans un devis.
// ------------------------------------------------------------
function collectMeasures() {
  const lignes = [];
  const nomCalque = (id) => App.layers.find(l => l.id === id)?.name || '';

  for (let p = 1; p <= App.totalPages; p++) {
    const pd = App.pageData[p];
    if (!pd) continue;
    const calib = pd.calibration;
    const datas = (p === App.currentPage)
      ? App.canvas.getObjects().filter(o => !isTempObject(o)).map(o => o.data)
      : (pd.objects || []).map(o => o.data);

    datas.forEach(d => {
      if (!d) return;
      if (d.type === 'dimension') {
        const L = d.pointLength ?? d.pixelLength;
        if (L == null) return;
        lignes.push({ page: p, calque: nomCalque(d.layerId), type: 'Cote',
                      designation: '', valeur: valeurBrute(L, calib),
                      unite: calib ? calib.unit : 'pt' });
      } else if (d.type === 'areaLabel') {
        lignes.push({ page: p, calque: nomCalque(d.layerId), type: 'Surface',
                      designation: '', valeur: valeurSurface(d.areaPt2, calib),
                      unite: calib ? calib.unit + '²' : 'pt²' });
        lignes.push({ page: p, calque: nomCalque(d.layerId), type: 'Périmètre',
                      designation: '', valeur: valeurBrute(d.perimeterPt, calib),
                      unite: calib ? calib.unit : 'pt' });
      } else if (d.type === 'count') {
        lignes.push({ page: p, calque: nomCalque(d.layerId), type: 'Comptage',
                      designation: d.category, valeur: 1, unite: 'u' });
      }
    });
  }
  return lignes;
}

function valeurBrute(lengthPt, calib) {
  return calib ? +(lengthPt / calib.pointsPerUnit).toFixed(3) : +lengthPt.toFixed(1);
}
function valeurSurface(areaPt2, calib) {
  return calib ? +(areaPt2 / calib.pointsPerUnit ** 2).toFixed(3) : +areaPt2.toFixed(1);
}

// Agrégation des comptages : une ligne par catégorie et par page
function summarizeMeasures(lignes) {
  const comptages = {};
  const autres = [];
  lignes.forEach(l => {
    if (l.type !== 'Comptage') { autres.push(l); return; }
    const cle = `${l.page}|${l.calque}|${l.designation}`;
    if (!comptages[cle]) comptages[cle] = { ...l, valeur: 0 };
    comptages[cle].valeur += 1;
  });
  return [...autres, ...Object.values(comptages)]
    .sort((a, b) => a.page - b.page || a.type.localeCompare(b.type));
}

// CSV séparé par « ; » et encodé avec BOM : Excel français l'ouvre directement
function measuresToCSV(lignes) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const entete = ['Page', 'Calque', 'Type', 'Désignation', 'Valeur', 'Unité'];
  const corps  = lignes.map(l => [l.page, l.calque, l.type, l.designation,
                                  String(l.valeur).replace('.', ','), l.unite]);
  return '﻿' + [entete, ...corps].map(r => r.map(esc).join(';')).join('\r\n');
}

function exportMeasuresCSV() {
  if (!requireDocument()) return;
  saveCurrentPageObjects();
  const lignes = summarizeMeasures(collectMeasures());
  if (!lignes.length) { showToast('Aucune mesure à exporter'); return; }
  const base = (App.pdfInfo?.fileName || 'plan').replace(/\.pdf$/i, '');
  downloadBlob(new Blob([measuresToCSV(lignes)], { type: 'text/csv;charset=utf-8' }),
               `${base}-mesures.csv`);
  showToast(`${lignes.length} ligne(s) exportée(s)`);
}

// Tableau récapitulatif affiché dans une fenêtre
function openMeasuresModal() {
  if (!requireDocument()) return;
  saveCurrentPageObjects();
  const lignes = summarizeMeasures(collectMeasures());
  const body = document.getElementById('measures-body');
  body.innerHTML = '';

  if (!lignes.length) {
    body.innerHTML = '<p style="color:var(--text-dim);font-size:12px">' +
      'Aucune cote, surface ni comptage dans ce document.</p>';
  } else {
    const t = document.createElement('table');
    t.className = 'measures-table';
    t.innerHTML = '<thead><tr><th>Page</th><th>Calque</th><th>Type</th>' +
                  '<th>Désignation</th><th>Valeur</th><th>Unité</th></tr></thead>';
    const tb = document.createElement('tbody');
    lignes.forEach(l => {
      const tr = document.createElement('tr');
      [l.page, l.calque, l.type, l.designation, l.valeur, l.unite].forEach((v, i) => {
        const td = document.createElement('td');
        td.textContent = v ?? '';
        if (i === 4) td.style.textAlign = 'right';
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    body.appendChild(t);

    const totaux = countTotals();
    if (Object.keys(totaux).length) {
      const p = document.createElement('p');
      p.style.cssText = 'margin-top:10px;font-size:12px;color:var(--text-dim)';
      p.textContent = 'Totaux : ' +
        Object.entries(totaux).map(([c, n]) => `${c} × ${n}`).join('  ·  ');
      body.appendChild(p);
    }
  }
  openModal('modal-measures');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { measuresToCSV, summarizeMeasures, categoryColor, STAMPS };
}
