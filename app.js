// ============================================================
// app.js — Logique principale de l'annoteur de plans PDF
// ============================================================

const APP_VERSION  = '1.6.0';   // Lot 5 — Outils métier
const PROJECT_FORMAT = '2.1';   // points PDF + calques globaux au document

// === Configuration PDF.js ===
// Worker servi localement : aucune dépendance réseau à l'exécution.
pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

// ============================================================
// ÉTAT GLOBAL
// ============================================================
const App = {
  pdfDoc:       null,    // PDFDocumentProxy (PDF.js)
  currentPage:  1,
  totalPages:   0,

  // Empreinte du PDF chargé — permet de vérifier qu'un projet correspond bien au plan
  pdfInfo:      null,    // { fileName, byteSize, pageCount }
  pdfBlob:      null,    // conservé pour la reprise après fermeture accidentelle

  // Suivi des modifications non sauvegardées
  dirty:        false,

  // Données par page : rotation, calibration, objets sérialisés (en points PDF)
  pageData: {},

  // Calques
  layers:        [],
  activeLayerId: null,
  nextLayerId:   1,

  // Toile Fabric.js
  canvas: null,

  // Couleur des tracés des symboles (indépendant des outils de dessin)
  symbolColor: '#000000',

  // Outil actif et options de style
  activeTool: 'select',
  toolProps: {
    strokeColor: '#e53e3e',
    fillColor:   'transparent',
    strokeWidth: 2,
    fontSize:    16,
    fontColor:   '#000000',
    opacity:     1,
    dashArray:   null,        // null=plein, [8,4]=tirets, [2,4]=pointillés
  },

  // État de dessin en cours
  draw: {
    active:          false,
    startPt:         null,
    tempObj:         null,
    points:          [],      // pour polyline
    previewLine:     null,    // ligne de filigrane click-click
    step:            0,       // étape courante (0=idle, 1,2,3=clics successifs)
    // Outil cote 3 clics
    dimP1:           null,    // premier point mesuré
    dimP2:           null,    // deuxième point mesuré
    dimPreviewObjs:  null,    // { coteLine, ext1, ext2, text } filigrane cote
    dimDot1:         null,    // marqueur visuel p1
    dimDot2:         null,    // marqueur visuel p2
    previewText:     null,    // étiquette de mesure (preview étape 1)
  },

  // État pan
  isPanning:   false,
  isDragging:  false,
  lastPanX:    0,
  lastPanY:    0,

  // Historique par page : { [pageNum]: { stack: [json], index } }
  history: {},

  // Symbole en cours de drag depuis la palette
  dragSymbolId: null,

  // Poignées d'édition de cote (affiché quand une cote est sélectionnée)
  activeDimHandles: null,  // { h1, h2, h3, dimGroup, previewObjs }
  _rebuildingDim:   false, // verrou anti-boucle lors de la reconstruction

  // Poignées d'édition de polygone / polyligne
  activePolyHandles: null, // { handles: [fabricPath, ...], obj }
  _rebuildingPoly:   false,

  // Presse-papiers (copier/coller)
  clipboard: null, // { objects: [...], pageNum }
};

// ============================================================
// INITIALISATION
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  initCanvas();
  initToolbar();
  initSidebar();
  initModals();
  initSymbolLibrary();
  initKeyboardShortcuts();
  initAutosave();
  initAccessibility();
  initTouch();
  updateCalibrationUI();
  updateDocumentState();

  const verEl = document.getElementById('app-version');
  if (verEl) verEl.textContent = `v${APP_VERSION}`;
});

// ============================================================
// OBJETS TEMPORAIRES (previews, marqueurs, poignées)
// ------------------------------------------------------------
// Ils sont balisés par data.temp pour ne JAMAIS être confondus avec
// des annotations de l'utilisateur : les identifier par `!selectable`
// détruisait les objets des calques verrouillés (bug v1.1).
// ============================================================
function tempProps(extra = {}) {
  return {
    selectable: false,
    evented:    false,
    excludeFromExport: true,
    ...extra,
    data: { temp: true, ...(extra.data || {}) },
  };
}

// Un objet est-il temporaire (preview, marqueur, poignée) ?
function isTempObject(o) {
  const t = o?.data?.type;
  return !!(o?.data?.temp || t === 'dimHandle' || t === 'polyHandle');
}

// Supprime tous les objets temporaires encore présents sur le canvas
function removeTempObjects() {
  const fc = App.canvas;
  fc.getObjects().filter(isTempObject).forEach(o => fc.remove(o));
}

// ============================================================
// SÉRIALISATION — point d'entrée unique
// ------------------------------------------------------------
// Utilisé par la sauvegarde de page, l'historique, l'autosave, la
// sauvegarde de projet et l'export : un seul endroit décide de ce qui
// est persistable, donc plus de poignées ni de previews dans les données.
// ============================================================
function serializePage(pageNum = App.currentPage) {
  const json = App.canvas.toJSON(['data', 'objectType', 'strokeUniform']);
  return json.objects
    .filter((o, i) => {
      const live = App.canvas.item(i);
      if (isTempObject(o) || isTempObject(live)) return false;
      return !o.data?.pageNum || o.data.pageNum === pageNum;
    })
    .map(stripVolatileData);
}

// Retire du `data` sérialisé tout ce qui ne doit pas être persisté
// (références vers des objets Fabric vivants, caches internes)
function stripVolatileData(obj) {
  if (!obj?.data) return obj;
  const { dimGroup, polyObj, _lastCenter, ...cleanData } = obj.data;
  return { ...obj, data: cleanData };
}

// Marque le document comme modifié (déclenche autosave + garde-fou fermeture)
function markDirty() {
  App.dirty = true;
  scheduleAutosave();
  updateDocumentState();
}

// ============================================================
// CANVAS FABRIC.JS — Création et gestion zoom/pan
// ============================================================
function initCanvas() {
  const wrapper = document.getElementById('canvas-wrapper');
  const w = wrapper.clientWidth  || 800;
  const h = wrapper.clientHeight || 600;

  App.canvas = new fabric.Canvas('main-canvas', {
    width:              w,
    height:             h,
    backgroundColor:    '#555566',
    selection:          true,
    preserveObjectStacking: true,
  });

  const fc = App.canvas;

  // --- Zoom molette ---
  fc.on('mouse:wheel', (opt) => {
    const delta = opt.e.deltaY;
    let zoom = fc.getZoom();
    zoom *= 0.999 ** delta;
    zoom = Math.max(0.05, Math.min(20, zoom));
    fc.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
    updateZoomDisplay();
    scheduleBackgroundRefresh();
    opt.e.preventDefault();
    opt.e.stopPropagation();
  });

  // --- Pan bouton central ou espace enfoncé ---
  fc.on('mouse:down', handleMouseDown);
  fc.on('mouse:move', handleMouseMove);
  fc.on('mouse:up',   handleMouseUp);
  fc.on('mouse:dblclick', handleDblClick);

  // Quand un objet est sélectionné, peupler le panneau propriétés et l'affichage L/H
  fc.on('selection:created', (e) => {
    updatePropsFromSelection(e);
    const obj = e.selected?.[0];
    if (obj?.data?.type === 'dimension') { showDimHandles(obj); return; }
    if (obj?.type === 'polygon' || obj?.type === 'polyline') { showPolyHandles(obj); return; }
    if (obj?.data?.type !== 'dimHandle' && obj?.data?.type !== 'polyHandle') {
      removeDimHandles(); removePolyHandles();
    }
  });
  fc.on('selection:updated', (e) => {
    updatePropsFromSelection(e);
    const sel = e.selected?.[0];
    const des = e.deselected?.[0];
    // Ne rien faire si on sélectionne une poignée
    if (sel?.data?.type === 'dimHandle' || sel?.data?.type === 'polyHandle') return;
    // Nettoyer si on quitte une forme éditée
    if (des?.data?.type === 'dimension' || des?.data?.type === 'dimHandle') removeDimHandles();
    if (des?.type === 'polygon' || des?.type === 'polyline' || des?.data?.type === 'polyHandle') removePolyHandles();
    // Afficher les poignées de la nouvelle sélection
    if (sel?.data?.type === 'dimension') showDimHandles(sel);
    else if (sel?.type === 'polygon' || sel?.type === 'polyline') showPolyHandles(sel);
  });
  fc.on('selection:cleared', () => {
    updateDimDisplay(null);
    if (!App._rebuildingDim)  removeDimHandles();
    if (!App._rebuildingPoly) removePolyHandles();
  });

  // Mémorise qu'une textbox vient de quitter l'édition (le même clic ne doit pas en créer une autre)
  fc.on('text:editing:exited', () => {
    App._textJustExited = true;
    setTimeout(() => { App._textJustExited = false; }, 0);
  });

  // Mettre à jour L/H pendant le redimensionnement
  fc.on('object:scaling', (e) => updateDimDisplay(e.target));

  // Synchroniser les poignées quand on déplace un objet
  fc.on('object:moving', (e) => {
    const obj = e.target;
    if (obj?.data?.type === 'dimHandle')  { handleDimHandleMoving(obj); return; }
    if (obj?.data?.type === 'dimension')  { syncDimHandlePositions(); return; }
    if (obj?.data?.type === 'polyHandle') { rebuildPolyFromHandles(false); return; }
    if (obj?.type === 'polygon' || obj?.type === 'polyline') repositionPolyHandles();
  });

  // Finaliser le déplacement d'un objet
  fc.on('object:modified', (e) => {
    const obj = e.target;
    if (obj?.data?.type === 'dimHandle')  { rebuildDimensionFromHandles(); return; }
    if (obj?.data?.type === 'polyHandle') { saveHistoryState(); return; } // déjà reconstruit dans object:moving
    if (obj?.data?.type === 'dimension' && !App._rebuildingDim) {
      syncDimGroupData(obj); repositionDimHandles();
    }
    if ((obj?.type === 'polygon' || obj?.type === 'polyline') && !App._rebuildingPoly) {
      repositionPolyHandles();
    }
    updateDimDisplay(obj);
    if (!App._rebuildingDim && !App._rebuildingPoly) saveHistoryState();
  });

  // Cible de drop pour les symboles
  const container = document.getElementById('canvas-container');
  container.addEventListener('dragover', (e) => { e.preventDefault(); });
  container.addEventListener('drop',     handleSymbolDrop);

  // Redimensionner le canvas quand la fenêtre change.
  // En v1.1 ce gestionnaire ne faisait rien dès qu'un PDF était chargé : le
  // canvas gardait son ancienne taille et le repère des annotations dérivait.
  // Maintenant le repère est indépendant de la fenêtre, on peut simplement
  // redimensionner et ré-ajuster la vue.
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      fc.setWidth(wrapper.clientWidth   || 800);
      fc.setHeight(wrapper.clientHeight || 600);
      if (App.pdfDoc) fitToWindow(); else fc.requestRenderAll();
    }, 120);
  });
}

// ============================================================
// GESTION ÉVÉNEMENTS SOURIS — Dispatch vers les outils
// ============================================================
// ============================================================
// ACCROCHAGE (v1.4)
// ------------------------------------------------------------
// Maj  : contrainte d'angle à 45° depuis l'origine du tracé en cours.
// Sinon : accrochage aux sommets des tracés existants (8 px écran).
// Indispensable pour coter : en v1.1 il était impossible de tracer une
// ligne exactement horizontale.
// ============================================================
const SNAP_TOL_SCREEN_PX = 8;

let snapCandidates = null;   // recalculé à chaque appui, pas à chaque mouvement
let snapMarker     = null;

// Origine du tracé en cours, selon l'outil
function currentDrawOrigin() {
  if (App.draw.dimP1 && App.draw.step >= 1) return App.draw.dimP1;
  if (App.draw.points.length) return App.draw.points[App.draw.points.length - 1];
  if (App.draw.startPt) return App.draw.startPt;
  return null;
}

// Sommets accrochables de la page (extrémités de lignes, sommets de polygones,
// points de cote). Coûteux : mis en cache, jamais recalculé pendant un déplacement.
function collectSnapCandidates() {
  const pts = [];
  App.canvas.getObjects().forEach(o => {
    if (isTempObject(o) || !o.visible) return;
    if (o.type === 'line') {
      getLineAbsolutePoints(o).forEach(p => pts.push(p));
    } else if ((o.type === 'polygon' || o.type === 'polyline') && o.points) {
      getPolyAbsolutePoints(o).forEach(p => pts.push(p));
    } else if (o.data?.p1) {
      pts.push(o.data.p1, o.data.p2);
    }
  });
  return pts;
}

// Applique l'accrochage à un point du plan
function snapPoint(pt, e) {
  const tool = App.activeTool;
  if (!['line', 'polyline', 'polygon', 'measure', 'calibrate'].includes(tool)) return pt;

  let out = pt;

  // 1. Contrainte d'angle (Maj) — prioritaire, c'est un geste explicite
  const origin = currentDrawOrigin();
  if (e?.shiftKey && origin) {
    out = constrainAngle(origin, pt, 45);
  } else {
    // 2. Accrochage aux sommets existants
    if (!snapCandidates) snapCandidates = collectSnapCandidates();
    const tol  = SNAP_TOL_SCREEN_PX / (App.canvas.getZoom() || 1);
    const near = nearestPoint(pt, snapCandidates, tol);
    if (near) out = { x: near.x, y: near.y };
  }

  showSnapMarker(out !== pt ? out : null);
  return out;
}

// Repère visuel du point accroché
function showSnapMarker(pt) {
  const fc = App.canvas;
  if (snapMarker) { fc.remove(snapMarker); snapMarker = null; }
  if (!pt) return;
  const s = 5 / (fc.getZoom() || 1);
  snapMarker = new fabric.Path(
    `M ${pt.x - s} ${pt.y - s} L ${pt.x + s} ${pt.y + s} M ${pt.x - s} ${pt.y + s} L ${pt.x + s} ${pt.y - s}`,
    tempProps({ stroke: '#00ff88', strokeWidth: 1.5 / (fc.getZoom() || 1), fill: '' }));
  fc.add(snapMarker);
}

function invalidateSnapCache() { snapCandidates = null; }

function handleMouseDown(opt) {
  const e  = opt.e;
  const fc = App.canvas;
  invalidateSnapCache();                 // la page a pu changer depuis le dernier clic
  const pt = snapPoint(fc.getPointer(e), e);

  // --- Pan : bouton central OU espace enfoncé OU outil pan ---
  if (e.button === 1 || App.isPanning || App.activeTool === 'pan') {
    App.isDragging = true;
    App.lastPanX   = e.clientX;
    App.lastPanY   = e.clientY;
    fc.defaultCursor = 'grabbing';
    e.preventDefault();
    return;
  }

  if (App.activeTool === 'select') return; // Fabric gère

  // Aucun document ouvert → aucun outil ne doit s'exécuter
  if (!requireDocument()) return;

  // Si le dessin n'a pas encore commencé et qu'un objet existant est sous le curseur → sélectionner
  const drawInProgress = App.draw.active || App.draw.step > 0;
  if (!drawInProgress) {
    const target = fc.findTarget(e);
    if (target && target.selectable && target.data?.type !== 'dimHandle' && target.data?.type !== 'polyHandle') {
      fc.setActiveObject(target);
      fc.requestRenderAll();
      return;
    }
  }

  switch (App.activeTool) {
    case 'calibrate': toolCalibrate_down(pt); break;
    case 'measure':   toolMeasure_down(pt);   break;
    case 'line':      toolLine_down(pt);      break;
    case 'cloud':     toolCloud_down(pt);     break;
    case 'polyline':  toolPolyline_down(pt);  break;
    case 'polygon':   toolPolygon_down(pt);   break;
    case 'rect':      toolRect_down(pt);      break;
    case 'circle':    toolCircle_down(pt);    break;
    case 'text':      toolText_down(pt);      break;
    case 'count':     toolCount_down(pt);     break;
    case 'leader':    toolLeader_down(pt);    break;
    // freedraw géré nativement par Fabric (isDrawingMode)
  }
}

function handleMouseMove(opt) {
  const e  = opt.e;
  const fc = App.canvas;

  // --- Pan en cours ---
  if (App.isDragging) {
    const vpt = fc.viewportTransform;
    vpt[4] += e.clientX - App.lastPanX;
    vpt[5] += e.clientY - App.lastPanY;
    fc.requestRenderAll();
    App.lastPanX = e.clientX;
    App.lastPanY = e.clientY;
    return;
  }

  // Curseur : si on survole un objet existant sans dessin en cours → pointer
  if (App.activeTool !== 'select' && App.activeTool !== 'pan') {
    const drawInProgress = App.draw.active || App.draw.step > 0;
    if (!drawInProgress) {
      const target = fc.findTarget(e);
      const onObj  = target && target.selectable
                     && target.data?.type !== 'dimHandle'
                     && target.data?.type !== 'polyHandle';
      fc.defaultCursor = onObj ? 'pointer' : (App.activeTool === 'text' ? 'text' : 'crosshair');
      fc.requestRenderAll();
    }
  }

  if (!App.draw.active && !['calibrate', 'measure', 'leader'].includes(App.activeTool)) return;

  const pt = snapPoint(fc.getPointer(e), e);

  // Mise à jour de la preview (filigrane) selon l'outil
  switch (App.activeTool) {
    case 'calibrate':
      if (App.draw.step === 1 && App.draw.previewLine) {
        App.draw.previewLine.set({ x2: pt.x, y2: pt.y });
        fc.requestRenderAll();
      }
      break;
    case 'measure':
      if (App.draw.step === 1 && App.draw.previewLine) {
        // Filigrane simple p1→souris avec étiquette de mesure en temps réel
        App.draw.previewLine.set({ x2: pt.x, y2: pt.y });
        if (App.draw.previewText) {
          const p1      = App.draw.dimP1;
          const pixDist = Math.hypot(pt.x - p1.x, pt.y - p1.y);
          const label   = formatDimension(pixDist, getPageCalibration());
          const angle   = Math.atan2(pt.y - p1.y, pt.x - p1.x) * 180 / Math.PI;
          const ta      = (angle > 90 || angle < -90) ? angle + 180 : angle;
          App.draw.previewText.set({
            text: label,
            left: (p1.x + pt.x) / 2,
            top:  (p1.y + pt.y) / 2,
            angle: ta,
          });
        }
        fc.requestRenderAll();
      } else if (App.draw.step === 2 && App.draw.dimPreviewObjs) {
        // Filigrane de la cote complète : mise à jour de l'écartement en temps réel
        const geo = computeDimGeometry(App.draw.dimP1, App.draw.dimP2, pt);
        updateDimPreviewObjects(App.draw.dimPreviewObjs, geo, App.draw.dimP1, App.draw.dimP2);
        fc.requestRenderAll();
      }
      break;
    case 'polyline':
    case 'polygon':
      if (App.draw.points.length > 0 && App.draw.previewLine) {
        App.draw.previewLine.set({ x2: pt.x, y2: pt.y });
        // Pour le polygone, mise à jour du segment de fermeture filigrane
        if (App.activeTool === 'polygon' && App.draw.closingLine && App.draw.points.length >= 2) {
          const p0 = App.draw.points[0];
          App.draw.closingLine.set({ x1: pt.x, y1: pt.y, x2: p0.x, y2: p0.y });
        }
        fc.requestRenderAll();
      }
      break;
    case 'leader':
      if (App.draw.step === 1 && App.draw.previewLine) {
        App.draw.previewLine.set({ x2: pt.x, y2: pt.y });
        fc.requestRenderAll();
      }
      break;
    case 'line':
      if (App.draw.active && App.draw.tempObj) {
        App.draw.tempObj.set({ x2: pt.x, y2: pt.y });
        fc.requestRenderAll();
      }
      break;
    case 'rect':
      if (App.draw.active && App.draw.tempObj) {
        const dx = pt.x - App.draw.startPt.x;
        const dy = pt.y - App.draw.startPt.y;
        App.draw.tempObj.set({
          left:   dx > 0 ? App.draw.startPt.x : pt.x,
          top:    dy > 0 ? App.draw.startPt.y : pt.y,
          width:  Math.abs(dx),
          height: Math.abs(dy),
        });
        fc.requestRenderAll();
      }
      break;
    case 'cloud':
      if (App.draw.active && App.draw.tempObj) {
        const s = App.draw.startPt;
        const pathStr = makeRevisionCloudPath(
          Math.min(s.x, pt.x), Math.min(s.y, pt.y),
          Math.max(s.x, pt.x), Math.max(s.y, pt.y)
        );
        App.draw.tempObj.set({ path: fabric.util.parsePath(pathStr) });
        App.draw.tempObj.setCoords();
        fc.requestRenderAll();
      }
      break;
    case 'circle':
      if (App.draw.active && App.draw.tempObj) {
        const rx = Math.abs(pt.x - App.draw.startPt.x) / 2;
        const ry = Math.abs(pt.y - App.draw.startPt.y) / 2;
        App.draw.tempObj.set({
          left: Math.min(pt.x, App.draw.startPt.x),
          top:  Math.min(pt.y, App.draw.startPt.y),
          rx, ry,
        });
        fc.requestRenderAll();
      }
      break;
  }
}

function handleMouseUp(opt) {
  const fc = App.canvas;

  // Fin du pan
  if (App.isDragging) {
    App.isDragging = false;
    fc.setViewportTransform(fc.viewportTransform);
    fc.defaultCursor = App.activeTool === 'pan' ? 'grab' : 'crosshair';
    return;
  }

  const pt = snapPoint(fc.getPointer(opt.e), opt.e);
  showSnapMarker(null);

  switch (App.activeTool) {
    case 'line':   toolLine_up(pt);   break;
    case 'rect':   toolRect_up(pt);   break;
    case 'circle': toolCircle_up(pt); break;
    case 'cloud':  toolCloud_up(pt);  break;
  }
}

function handleDblClick(opt) {
  if (App.activeTool === 'polyline') toolPolyline_finish();
  if (App.activeTool === 'polygon')  toolPolygon_finish();
}

// ============================================================
// OUTILS DE DESSIN
// ============================================================

// --- Helpers communs ---
// Crée automatiquement un calque "Annotations" si la page n'en a aucun
function ensureActiveLayer() {
  if (!App.pageData[App.currentPage]) return false;   // garde : aucun document ouvert
  // Les calques sont globaux au document depuis la v1.4 : plus rien à recopier par page.
  if (App.layers.length === 0) addLayer('Annotations');
  return true;
}

// Garde commune à tous les outils : refuse d'agir tant qu'aucun PDF n'est ouvert.
// En v1.1, dessiner sans document levait un TypeError silencieux.
let noDocWarned = 0;
function requireDocument() {
  if (App.pdfDoc && App.pageData[App.currentPage]) return true;
  const now = Date.now();
  if (now - noDocWarned > 1500) {       // ne pas spammer sur des clics répétés
    noDocWarned = now;
    showToast('Ouvrez d’abord un PDF (📂 Ouvrir PDF)');
  }
  return false;
}

function baseProps(extra = {}) {
  ensureActiveLayer();
  const tp = App.toolProps;
  return {
    stroke:          tp.strokeColor,
    strokeWidth:     tp.strokeWidth,
    strokeDashArray: tp.dashArray,
    opacity:         tp.opacity,
    // L'épaisseur du trait est une grandeur physique (en points, ≈ 0,35 mm/pt) :
    // redimensionner une forme ne doit pas épaissir son contour.
    strokeUniform:   true,
    selectable:      false,
    evented:         false,
    data: {
      layerId:  App.activeLayerId,
      pageNum:  App.currentPage,
      ...extra,
    },
  };
}

function isTransparentFill(fill) {
  return !fill || fill === 'transparent' || fill === 'rgba(0,0,0,0)';
}

function finalizeObj(obj) {
  obj.set({ selectable: true, evented: true });
  if (isTransparentFill(obj.fill)) obj.set('perPixelTargetFind', true);
  applyLayerPropsToObj(obj);
  App.canvas.setActiveObject(obj);
  App.canvas.requestRenderAll();
  saveHistoryState();
  App.draw.active  = false;
  App.draw.tempObj = null;
}

// --- Ligne simple ---
function toolLine_down(pt) {
  App.draw.active  = true;
  App.draw.startPt = { x: pt.x, y: pt.y };
  const line = new fabric.Line([pt.x, pt.y, pt.x, pt.y], {
    ...baseProps(),
    fill: '',
  });
  App.canvas.add(line);
  App.draw.tempObj = line;
}
function toolLine_up(pt) {
  if (!App.draw.active || !App.draw.tempObj) return;
  App.draw.tempObj.set({ x2: pt.x, y2: pt.y });
  finalizeObj(App.draw.tempObj);
}

// --- Rectangle ---
function toolRect_down(pt) {
  App.draw.active  = true;
  App.draw.startPt = { x: pt.x, y: pt.y };
  const tp = App.toolProps;
  const rect = new fabric.Rect({
    left: pt.x, top: pt.y, width: 0, height: 0,
    ...baseProps(),
    fill: tp.fillColor,
  });
  App.canvas.add(rect);
  App.draw.tempObj = rect;
}
function toolRect_up(pt) {
  if (!App.draw.active || !App.draw.tempObj) return;
  const dx = pt.x - App.draw.startPt.x;
  const dy = pt.y - App.draw.startPt.y;
  if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
    App.canvas.remove(App.draw.tempObj);
    App.draw.active = false; App.draw.tempObj = null; return;
  }
  App.draw.tempObj.set({
    left: Math.min(pt.x, App.draw.startPt.x),
    top:  Math.min(pt.y, App.draw.startPt.y),
    width: Math.abs(dx), height: Math.abs(dy),
  });
  finalizeObj(App.draw.tempObj);
}

// --- Cercle/Ellipse ---
function toolCircle_down(pt) {
  App.draw.active  = true;
  App.draw.startPt = { x: pt.x, y: pt.y };
  const tp = App.toolProps;
  const ellipse = new fabric.Ellipse({
    left: pt.x, top: pt.y, rx: 0, ry: 0,
    ...baseProps(),
    fill: tp.fillColor,
  });
  App.canvas.add(ellipse);
  App.draw.tempObj = ellipse;
}
function toolCircle_up(pt) {
  if (!App.draw.active || !App.draw.tempObj) return;
  const rx = Math.abs(pt.x - App.draw.startPt.x) / 2;
  const ry = Math.abs(pt.y - App.draw.startPt.y) / 2;
  if (rx < 2 && ry < 2) {
    App.canvas.remove(App.draw.tempObj);
    App.draw.active = false; App.draw.tempObj = null; return;
  }
  App.draw.tempObj.set({
    left: Math.min(pt.x, App.draw.startPt.x),
    top:  Math.min(pt.y, App.draw.startPt.y),
    rx, ry,
  });
  finalizeObj(App.draw.tempObj);
}

// --- Texte ---
function toolText_down(pt) {
  if (!requireDocument()) return;
  const fc = App.canvas;
  // Le clic qui a fermé une édition de textbox ne doit pas en ouvrir une nouvelle
  if (App._textJustExited) return;
  const active = fc.getActiveObject();
  if (active?.isEditing) return;
  if (active) {
    fc.discardActiveObject();
    fc.requestRenderAll();
    return;
  }
  ensureActiveLayer();
  const tp = App.toolProps;
  const tbox = new fabric.Textbox('Texte', {
    left: pt.x, top: pt.y,
    width: 200,
    fontSize:   tp.fontSize,
    fill:       tp.fontColor,
    fontFamily: 'Arial',
    opacity:    tp.opacity,
    // Empêche la déformation : le redimensionnement horizontal fait revenir à la ligne
    lockScalingY:    false,
    lockUniScaling:  false,
    data: { layerId: App.activeLayerId, pageNum: App.currentPage },
  });
  App.canvas.add(tbox);
  applyLayerPropsToObj(tbox);
  App.canvas.setActiveObject(tbox);
  tbox.enterEditing();
  tbox.selectAll();
  App.canvas.requestRenderAll();
  saveHistoryState();
}

// --- Polyligne (click multiple, dbl-clic pour finir) ---
function toolPolyline_down(pt) {
  App.draw.points.push({ x: pt.x, y: pt.y });

  // Segment de preview
  if (App.draw.previewLine) App.canvas.remove(App.draw.previewLine);
  const prevLine = new fabric.Line([pt.x, pt.y, pt.x, pt.y], tempProps({
    stroke: App.toolProps.strokeColor, strokeWidth: 1, strokeDashArray: [4, 3],
  }));
  App.canvas.add(prevLine);
  App.draw.previewLine = prevLine;
  App.draw.active = true;

  // Dessiner le segment si on a ≥2 points
  if (App.draw.points.length >= 2) {
    const pts = App.draw.points;
    const n = pts.length;
    const tp = App.toolProps;
    const seg = new fabric.Line(
      [pts[n-2].x, pts[n-2].y, pts[n-1].x, pts[n-1].y],
      tempProps({ stroke: tp.strokeColor, strokeWidth: tp.strokeWidth,
                  strokeDashArray: tp.dashArray, opacity: tp.opacity, fill: '' })
    );
    App.canvas.add(seg);
  }
  App.draw.step = 1;
}
function toolPolyline_finish() {
  if (App.draw.points.length < 2) {
    resetDrawState(); return;
  }
  App.draw.previewLine = null;
  // Supprimer les segments temporaires (balisés data.temp — jamais par `selectable`,
  // qui vaut false aussi sur les objets des calques verrouillés)
  removeTempObjects();

  const polyline = new fabric.Polyline(App.draw.points, {
    ...baseProps(),
    fill: App.toolProps.fillColor,
    stroke: App.toolProps.strokeColor,
  });
  polyline.set({ selectable: true, evented: true });
  App.canvas.add(polyline);
  applyLayerPropsToObj(polyline);
  App.canvas.setActiveObject(polyline);
  App.canvas.requestRenderAll();
  saveHistoryState();

  App.draw.points = [];
  App.draw.active = false;
  App.draw.step   = 0;
}

// --- Polygone (click multiple, dbl-clic pour fermer) ---
function toolPolygon_down(pt) {
  App.draw.points.push({ x: pt.x, y: pt.y });
  App.draw.active = true;

  // Ligne de preview depuis ce point vers la souris
  if (App.draw.previewLine) App.canvas.remove(App.draw.previewLine);
  const prevLine = new fabric.Line([pt.x, pt.y, pt.x, pt.y], tempProps({
    stroke: App.toolProps.strokeColor, strokeWidth: 1,
    strokeDashArray: [4, 3], opacity: 0.7,
  }));
  App.canvas.add(prevLine);
  App.draw.previewLine = prevLine;

  // Après le 2e point, dessiner le segment validé ET le segment de fermeture en filigrane
  if (App.draw.points.length >= 2) {
    const pts = App.draw.points;
    const n   = pts.length;
    const seg = new fabric.Line(
      [pts[n-2].x, pts[n-2].y, pts[n-1].x, pts[n-1].y],
      tempProps({ stroke: App.toolProps.strokeColor, strokeWidth: App.toolProps.strokeWidth,
                  strokeDashArray: App.toolProps.dashArray })
    );
    App.canvas.add(seg);

    // Segment de fermeture filigrane (dernier point → premier point)
    if (App.draw.closingLine) App.canvas.remove(App.draw.closingLine);
    const closingLine = new fabric.Line(
      [pts[n-1].x, pts[n-1].y, pts[0].x, pts[0].y],
      tempProps({ stroke: App.toolProps.strokeColor, strokeWidth: 1,
                  strokeDashArray: [3, 5], opacity: 0.45 })
    );
    App.canvas.add(closingLine);
    App.draw.closingLine = closingLine;
  }
  App.draw.step = 1;
}

function toolPolygon_finish() {
  if (App.draw.points.length < 3) { resetDrawState(); return; }

  // Supprimer tous les objets temporaires (balisés data.temp)
  App.draw.previewLine = null;
  App.draw.closingLine = null;
  removeTempObjects();

  const tp = App.toolProps;
  const polygon = new fabric.Polygon(App.draw.points, {
    stroke:          tp.strokeColor,
    strokeWidth:     tp.strokeWidth,
    strokeDashArray: tp.dashArray,
    fill:            tp.fillColor,
    opacity:         tp.opacity,
    ...baseProps(),
  });
  polygon.set({ selectable: true, evented: true });
  App.canvas.add(polygon);
  applyLayerPropsToObj(polygon);
  App.canvas.setActiveObject(polygon);
  App.canvas.requestRenderAll();
  saveHistoryState();

  App.draw.points      = [];
  App.draw.active      = false;
  App.draw.step        = 0;
  App.draw.closingLine = null;
}

// --- Dessin libre (géré par Fabric isDrawingMode) ---
function toolFreeDraw_activate() {
  if (!requireDocument()) { setActiveTool('select'); return; }
  ensureActiveLayer();
  const fc = App.canvas;
  fc.isDrawingMode = true;
  fc.freeDrawingBrush = new fabric.PencilBrush(fc);
  fc.freeDrawingBrush.color   = App.toolProps.strokeColor;
  fc.freeDrawingBrush.width   = App.toolProps.strokeWidth;
  fc.freeDrawingBrush.decimate = 4; // lissage

  // Quand le tracé libre se termine, lui assigner le calque
  fc.once('path:created', (e) => {
    const path = e.path;
    path.set({ data: { layerId: App.activeLayerId, pageNum: App.currentPage } });
    applyLayerPropsToObj(path);
    saveHistoryState();
    // Réactiver l'écoute
    fc.on('path:created', (ev) => {
      const p = ev.path;
      p.set({ data: { layerId: App.activeLayerId, pageNum: App.currentPage } });
      applyLayerPropsToObj(p);
      saveHistoryState();
    });
  });
}

// Crée un marqueur en croix (+) à la position donnée (plus lisible qu'un cercle)
function makeCrossMarker(x, y, size, color) {
  const s = size;
  return new fabric.Path(
    `M ${x - s} ${y} L ${x + s} ${y} M ${x} ${y - s} L ${x} ${y + s}`,
    tempProps({ stroke: color, strokeWidth: 2, fill: '' })
  );
}

// --- Outil Mesure/Cote (3 clics : p1 → p2 → écartement) ---
function toolMeasure_down(pt) {
  const fc = App.canvas;

  if (App.draw.step === 0) {
    // Clic 1 : point de départ
    App.draw.step  = 1;
    App.draw.dimP1 = { x: pt.x, y: pt.y };

    // Marqueur visuel p1 (croix)
    const dot1 = makeCrossMarker(pt.x, pt.y, 6, '#00ccff');
    fc.add(dot1);
    App.draw.dimDot1 = dot1;

    // Ligne filigrane p1→souris
    const pl = new fabric.Line([pt.x, pt.y, pt.x, pt.y], tempProps({
      stroke: '#00aaff', strokeWidth: 1.5, strokeDashArray: [5, 3], opacity: 0.75,
    }));
    fc.add(pl);
    App.draw.previewLine = pl;

    // Étiquette de mesure (dès le 1er clic)
    const ptxt = new fabric.Text('0', tempProps({
      left: pt.x, top: pt.y - 14,
      fontSize: 12, fill: '#0077cc', fontWeight: 'bold',
      originX: 'center', originY: 'bottom',
      backgroundColor: 'rgba(255,255,255,0.85)', padding: 2,
    }));
    fc.add(ptxt);
    App.draw.previewText = ptxt;

    updateMeasureIndicator(1);

  } else if (App.draw.step === 1) {
    // Clic 2 : point de fin → basculer en mode offset
    App.draw.step  = 2;
    App.draw.dimP2 = { x: pt.x, y: pt.y };

    // Supprimer la ligne simple p1→souris et son étiquette
    fc.remove(App.draw.previewLine);
    App.draw.previewLine = null;
    if (App.draw.previewText) { fc.remove(App.draw.previewText); App.draw.previewText = null; }

    // Marqueur visuel p2 (croix)
    const dot2 = makeCrossMarker(pt.x, pt.y, 6, '#00ccff');
    fc.add(dot2);
    App.draw.dimDot2 = dot2;

    // Créer les objets de preview de cote (filigrane)
    const geo = computeDimGeometry(App.draw.dimP1, App.draw.dimP2, { x: pt.x, y: pt.y + 30 });
    App.draw.dimPreviewObjs = createDimPreviewObjects(geo, App.draw.dimP1, App.draw.dimP2);

    updateMeasureIndicator(2);

  } else if (App.draw.step === 2) {
    // Clic 3 : valider l'écartement → créer la cote finale
    const geo = computeDimGeometry(App.draw.dimP1, App.draw.dimP2, pt);
    cleanupDimPreview();
    createOffsetDimension(App.draw.dimP1, App.draw.dimP2, geo);

    App.draw.step  = 0;
    App.draw.dimP1 = null;
    App.draw.dimP2 = null;
    hideIndicator('measure-indicator');
  }
}

// Met à jour le texte de l'indicateur selon l'étape
function updateMeasureIndicator(step) {
  const el = document.getElementById('measure-indicator');
  if (!el) return;
  const msgs = {
    1: '📏 Clic 2 : deuxième point — Échap pour annuler',
    2: '📐 Clic 3 : écartement de la ligne de cote — Échap pour annuler',
  };
  el.textContent = msgs[step] || '';
  el.style.display = step ? 'block' : 'none';
}

// --- Outil Calibration (click-click) ---
function toolCalibrate_down(pt) {
  if (App.draw.step === 0) {
    App.draw.step    = 1;
    App.draw.startPt = { x: pt.x, y: pt.y };

    const line = new fabric.Line([pt.x, pt.y, pt.x, pt.y], tempProps({
      stroke: '#ffcc00', strokeWidth: 2, strokeDashArray: [6, 3],
    }));
    App.canvas.add(line);
    App.draw.previewLine = line;
    showIndicator('calib-indicator');
  } else {
    if (App.draw.previewLine) App.canvas.remove(App.draw.previewLine);
    App.draw.previewLine = null;
    hideIndicator('calib-indicator');

    const p1 = App.draw.startPt;
    const pixelDist = Math.hypot(pt.x - p1.x, pt.y - p1.y);

    App.draw.step    = 0;
    App.draw.startPt = null;

    // Afficher la modale de saisie
    document.getElementById('calib-px-dist').textContent = pixelDist.toFixed(1);
    document.getElementById('calib-real-dist').value     = '';
    openModal('modal-calib');

    // Stocker la distance pixel en attente de confirmation
    App._pendingCalibPixels = pixelDist;
  }
}

// ============================================================
// DIMENSIONS AFFICHAGE HEADER — L/H en unités calibrées
// ============================================================

// Retourne la taille affichée d'un objet Fabric en pixels canvas
function getObjPxSize(obj) {
  return { w: obj.getScaledWidth(), h: obj.getScaledHeight() };
}

// Convertit des pixels canvas → valeur dans l'unité de calibration (ou px)
function pxToDisplay(px) {
  const calib = getPageCalibration();
  if (!calib) return { val: Math.round(px), unit: 'px' };
  return { val: parseFloat((px / calib.pointsPerUnit).toFixed(2)), unit: calib.unit };
}

// Convertit une valeur en unité calibrée → pixels canvas
function displayToPx(val, unit) {
  const calib = getPageCalibration();
  if (!calib) return parseFloat(val);
  // val est dans calib.unit ; convertir si nécessaire (ici même unité car le champ affiche calib.unit)
  return parseFloat(val) * calib.pointsPerUnit;
}

// Met à jour les champs L/H du header selon l'objet sélectionné
function updateDimDisplay(obj) {
  const dimDisplay = document.getElementById('dim-display');
  const dimSep     = document.getElementById('dim-sep');

  if (!obj) {
    dimDisplay.style.display = 'none';
    if (dimSep) dimSep.style.display = 'none';
    return;
  }

  dimDisplay.style.display = 'flex';
  if (dimSep) dimSep.style.display = '';

  const { w: pxW, h: pxH }  = getObjPxSize(obj);
  const { val: dW, unit }    = pxToDisplay(pxW);
  const { val: dH }          = pxToDisplay(pxH);

  document.getElementById('dim-w').value    = dW;
  document.getElementById('dim-h').value    = dH;
  document.getElementById('dim-unit').textContent = unit;
}

// Applique une nouvelle taille (en unités affichées) à l'objet sélectionné
function applyDimChange() {
  const fc  = App.canvas;
  const sel = fc.getActiveObject();
  if (!sel) return;

  const rawW = parseFloat(document.getElementById('dim-w').value);
  const rawH = parseFloat(document.getElementById('dim-h').value);
  const unit = document.getElementById('dim-unit').textContent;
  if (!rawW || !rawH || rawW <= 0 || rawH <= 0) return;

  const newPxW = displayToPx(rawW, unit);
  const newPxH = displayToPx(rawH, unit);

  const intrW = sel.width  || 1;
  const intrH = sel.height || 1;

  sel.set({ scaleX: newPxW / intrW, scaleY: newPxH / intrH });
  sel.setCoords();
  fc.requestRenderAll();
  saveHistoryState();
  // Re-afficher les valeurs arrondies
  updateDimDisplay(sel);
}

// ============================================================
// GÉOMÉTRIE DES COTES
// ============================================================

// Crée les objets Fabric filigrane (preview) pour la cote en cours de tracé
// La mesure réelle s'affiche dès l'étape 2 (offset en cours)
function createDimPreviewObjects(geo, p1, p2) {
  const fc = App.canvas;
  const ph = tempProps({ stroke: '#00aaff', strokeWidth: 1.5, strokeDashArray: [5, 3], opacity: 0.75, fill: '' });

  const coteLine = new fabric.Line([geo.c1.x, geo.c1.y, geo.c2.x, geo.c2.y], ph);
  const ext1     = new fabric.Line([geo.e1s.x, geo.e1s.y, geo.e1e.x, geo.e1e.y], ph);
  const ext2     = new fabric.Line([geo.e2s.x, geo.e2s.y, geo.e2e.x, geo.e2e.y], ph);

  // Petits tirets obliques aux extrémités de la ligne de cote (preview)
  const calib    = getPageCalibration();
  const pixDist  = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const label    = formatDimension(pixDist, calib);
  const txtAngle = (geo.angle > 90 || geo.angle < -90) ? geo.angle + 180 : geo.angle;

  const text = new fabric.Text(label, tempProps({
    left: geo.mid.x, top: geo.mid.y,
    fontSize: 12, fill: '#0077cc', fontWeight: 'bold',
    originX: 'center', originY: 'bottom',
    angle: txtAngle,
    backgroundColor: 'rgba(255,255,255,0.85)',
    padding: 2,
  }));

  [coteLine, ext1, ext2, text].forEach(o => fc.add(o));
  return { coteLine, ext1, ext2, text, p1, p2 };
}

// Met à jour les objets filigrane selon la nouvelle géométrie (pendant le déplacement souris)
function updateDimPreviewObjects(objs, geo, p1, p2) {
  objs.coteLine.set({ x1: geo.c1.x, y1: geo.c1.y, x2: geo.c2.x, y2: geo.c2.y });
  objs.ext1.set({ x1: geo.e1s.x, y1: geo.e1s.y, x2: geo.e1e.x, y2: geo.e1e.y });
  objs.ext2.set({ x1: geo.e2s.x, y1: geo.e2s.y, x2: geo.e2e.x, y2: geo.e2e.y });

  const txtAngle = (geo.angle > 90 || geo.angle < -90) ? geo.angle + 180 : geo.angle;
  objs.text.set({ left: geo.mid.x, top: geo.mid.y, angle: txtAngle });
  // La mesure est fixe (p1 et p2 ne changent pas à cette étape) — pas besoin de recalculer
}

// ============================================================
// ÉDITION DES COTES — Poignées de contrôle draggables
// ============================================================

// Affiche 3 poignées de contrôle sur la cote sélectionnée (p1, p2, milieu cote)
function showDimHandles(group) {
  removeDimHandles();
  const d = group?.data;
  if (!d?.p1 || !d?.p2 || !d?.offsetPt) return;

  const h1 = makeDimHandle(d.p1,       'dimP1');
  const h2 = makeDimHandle(d.p2,       'dimP2');
  const h3 = makeDimHandle(d.offsetPt, 'dimOff');
  [h1, h2, h3].forEach(h => App.canvas.add(h));

  App.activeDimHandles = { h1, h2, h3, dimGroup: group, previewObjs: null };
  // Cacher les poignées de transformation standard
  group.set({ hasControls: false, borderColor: '#00aaff', borderDashArray: [4, 2] });
  App.canvas.requestRenderAll();
}

// Supprime les poignées actives et restaure l'aspect normal du groupe
function removeDimHandles() {
  if (!App.activeDimHandles) return;
  const { h1, h2, h3, previewObjs, dimGroup } = App.activeDimHandles;
  [h1, h2, h3].forEach(h => { if (h) App.canvas.remove(h); });
  if (previewObjs) Object.values(previewObjs).forEach(o => App.canvas.remove(o));
  if (dimGroup) dimGroup.set({ hasControls: true, visible: true });
  App.activeDimHandles = null;
}

// Crée une poignée draggable (croix bleue) à la position donnée
// NB : aucune référence vers le groupe cote n'est stockée dans `data` — elle serait
// sérialisée (fichier projet gonflé + croix orphelines au rechargement).
// Le groupe vit dans App.activeDimHandles.dimGroup.
function makeDimHandle(pt, role) {
  const s = 8;
  return new fabric.Path(`M ${-s} 0 L ${s} 0 M 0 ${-s} L 0 ${s}`, {
    left: pt.x, top: pt.y,
    originX: 'center', originY: 'center',
    stroke: '#00aaff', strokeWidth: 2.5, fill: '',
    selectable: true, evented: true,
    hasBorders: false, hasControls: false,
    lockRotation: true, lockScalingX: true, lockScalingY: true,
    perPixelTargetFind: true,
    excludeFromExport: true,
    data: { type: 'dimHandle', role },
  });
}

// Repositionne les poignées après déplacement du groupe cote
function repositionDimHandles() {
  const handles = App.activeDimHandles;
  if (!handles?.dimGroup?.data) return;
  const d = handles.dimGroup.data;
  handles.h1.set({ left: d.p1.x,       top: d.p1.y       }); handles.h1.setCoords();
  handles.h2.set({ left: d.p2.x,       top: d.p2.y       }); handles.h2.setCoords();
  handles.h3.set({ left: d.offsetPt.x, top: d.offsetPt.y }); handles.h3.setCoords();
  App.canvas.requestRenderAll();
}

// Synchronise les poignées PENDANT le déplacement (live) du groupe cote
function syncDimHandlePositions() {
  const handles = App.activeDimHandles;
  if (!handles?.dimGroup?.data) return;
  const d = handles.dimGroup.data;
  const gc = handles.dimGroup.getCenterPoint();
  if (!d._lastCenter) return;
  const dx = gc.x - d._lastCenter.x, dy = gc.y - d._lastCenter.y;
  handles.h1.set({ left: d.p1.x + dx,       top: d.p1.y + dy });
  handles.h2.set({ left: d.p2.x + dx,       top: d.p2.y + dy });
  handles.h3.set({ left: d.offsetPt.x + dx, top: d.offsetPt.y + dy });
  [handles.h1, handles.h2, handles.h3].forEach(h => h.setCoords());
  App.canvas.requestRenderAll();
}

// Met à jour p1/p2/offsetPt dans le data du groupe après son déplacement
function syncDimGroupData(group) {
  const d  = group.data;
  const gc = group.getCenterPoint();
  if (!d._lastCenter) { d._lastCenter = gc; return; }
  const dx = gc.x - d._lastCenter.x, dy = gc.y - d._lastCenter.y;
  d.p1        = { x: d.p1.x + dx,        y: d.p1.y + dy };
  d.p2        = { x: d.p2.x + dx,        y: d.p2.y + dy };
  d.offsetPt  = { x: d.offsetPt.x + dx,  y: d.offsetPt.y + dy };
  d._lastCenter = { x: gc.x, y: gc.y };
}

// Mise à jour en temps réel pendant le drag d'une poignée (filigrane)
function handleDimHandleMoving(handle) {
  const handles = App.activeDimHandles;
  if (!handles) return;

  const p1  = { x: handles.h1.left, y: handles.h1.top };
  const p2  = { x: handles.h2.left, y: handles.h2.top };
  const off = { x: handles.h3.left, y: handles.h3.top };
  const geo = computeDimGeometry(p1, p2, off);

  // Cacher le groupe définitif pendant l'édition
  if (handles.dimGroup) handles.dimGroup.set('visible', false);

  // Créer ou mettre à jour le filigrane
  if (!handles.previewObjs) {
    handles.previewObjs = createDimPreviewObjects(geo, p1, p2);
  } else {
    updateDimPreviewObjects(handles.previewObjs, geo, p1, p2);
    // Mettre à jour l'étiquette de mesure
    const calib   = getPageCalibration();
    const pixDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    handles.previewObjs.text.set('text', formatDimension(pixDist, calib));
  }
  App.canvas.requestRenderAll();
}

// Reconstruit la cote finale après relâchement d'une poignée
function rebuildDimensionFromHandles() {
  const handles = App.activeDimHandles;
  if (!handles) return;

  App._rebuildingDim = true;
  const fc = App.canvas;

  const p1  = { x: handles.h1.left, y: handles.h1.top };
  const p2  = { x: handles.h2.left, y: handles.h2.top };
  const off = { x: handles.h3.left, y: handles.h3.top };

  // Supprimer le filigrane temporaire
  if (handles.previewObjs) {
    Object.values(handles.previewObjs).forEach(o => fc.remove(o));
    handles.previewObjs = null;
  }

  const oldData  = handles.dimGroup?.data || {};
  if (handles.dimGroup) fc.remove(handles.dimGroup);

  // Reconstruire avec la nouvelle géométrie
  const geo      = computeDimGeometry(p1, p2, off);
  const savedLay = App.activeLayerId;
  App.activeLayerId = oldData.layerId || savedLay;
  const newGroup = buildDimGroupOnCanvas(p1, p2, geo, App.activeLayerId);
  App.activeLayerId = savedLay;
  applyLayerPropsToObj(newGroup);

  // Mettre à jour les références dans les poignées
  handles.dimGroup = newGroup;
  newGroup.set({ hasControls: false, borderColor: '#00aaff', borderDashArray: [4, 2] });

  fc.requestRenderAll();
  saveHistoryState();
  App._rebuildingDim = false;
}

// ============================================================
// ÉDITION DES POLYGONES / POLYLIGNES — Poignées de sommets
// ============================================================

// Retourne les positions absolues (page) des sommets d'un polygone/polyligne.
// Fabric place `left` d'un polygone à minX − épaisseur/2 : le centre utilisé par
// la matrice coïncide donc avec le centre géométrique, la conversion est directe.
function getPolyAbsolutePoints(obj) {
  const mat = obj.calcTransformMatrix();
  return obj.points.map(p => fabric.util.transformPoint(
    { x: p.x - obj.pathOffset.x, y: p.y - obj.pathOffset.y },
    mat
  ));
}

// Positions absolues (page) des deux extrémités d'une ligne.
// Pour une Line en revanche, `left` vaut exactement minX : le centre de la
// matrice est décalé d'une demi-épaisseur par rapport au centre géométrique,
// et les extrémités obtenues tombent à côté (accrochage imprécis). On neutralise
// donc l'épaisseur le temps du calcul.
function getLineAbsolutePoints(obj) {
  const sw = obj.strokeWidth;
  obj.strokeWidth = 0;
  try {
    const lp  = obj.calcLinePoints();
    const mat = obj.calcTransformMatrix();
    return [
      fabric.util.transformPoint({ x: lp.x1, y: lp.y1 }, mat),
      fabric.util.transformPoint({ x: lp.x2, y: lp.y2 }, mat),
    ];
  } finally {
    obj.strokeWidth = sw;
    obj.setCoords();
  }
}

// Affiche une poignée (croix orange) sur chaque sommet
function showPolyHandles(obj) {
  removePolyHandles();
  if (!obj.points || !obj.points.length) return;
  const absPts  = getPolyAbsolutePoints(obj);
  const handles = absPts.map((pt, i) => {
    const s = 7;
    const h = new fabric.Path(`M ${-s} 0 L ${s} 0 M 0 ${-s} L 0 ${s}`, {
      left: pt.x, top: pt.y,
      originX: 'center', originY: 'center',
      stroke: '#ffaa00', strokeWidth: 2.5, fill: '',
      selectable: true, evented: true,
      hasBorders: false, hasControls: false,
      lockRotation: true, lockScalingX: true, lockScalingY: true,
      perPixelTargetFind: true,
      excludeFromExport: true,
      data: { type: 'polyHandle', ptIndex: i },
    });
    App.canvas.add(h);
    return h;
  });
  App.activePolyHandles = { handles, obj };
  obj.set({ hasControls: false, borderColor: '#ffaa00', borderDashArray: [4, 2] });
  App.canvas.requestRenderAll();
}

// Supprime les poignées actives
function removePolyHandles() {
  if (!App.activePolyHandles) return;
  const { handles, obj } = App.activePolyHandles;
  handles.forEach(h => App.canvas.remove(h));
  if (obj) obj.set({ hasControls: true, visible: true });
  App.activePolyHandles = null;
}

// Repositionne les poignées après déplacement de la forme
function repositionPolyHandles() {
  if (!App.activePolyHandles?.obj) return;
  const { handles, obj } = App.activePolyHandles;
  const absPts = getPolyAbsolutePoints(obj);
  handles.forEach((h, i) => {
    if (absPts[i]) { h.set({ left: absPts[i].x, top: absPts[i].y }); h.setCoords(); }
  });
  App.canvas.requestRenderAll();
}

// Reconstruit la forme (poly) à partir des positions absolues des poignées (pendant et après drag)
function rebuildPolyFromHandles(saveHistory) {
  const state = App.activePolyHandles;
  if (!state) return;
  App._rebuildingPoly = true;

  const { handles, obj } = state;
  const absPts = handles.map(h => ({ x: h.left, y: h.top }));
  const Cls    = obj.type === 'polygon' ? fabric.Polygon : fabric.Polyline;

  const newObj = new Cls(absPts, {
    stroke: obj.stroke, strokeWidth: obj.strokeWidth,
    strokeDashArray: obj.strokeDashArray,
    fill: obj.fill, opacity: obj.opacity,
    selectable: true, evented: true,
    data: { ...obj.data },
  });

  // Conserver l'ordre Z
  const objs = App.canvas.getObjects();
  const idx  = objs.indexOf(obj);
  App.canvas.remove(obj);
  if (idx >= 0) App.canvas.insertAt(newObj, idx, false);
  else          App.canvas.add(newObj);

  applyLayerPropsToObj(newObj);
  newObj.set({ hasControls: false, borderColor: '#ffaa00', borderDashArray: [4, 2], visible: true });

  // Mettre à jour les références dans les poignées
  state.obj = newObj;

  if (saveHistory) saveHistoryState();
  App.canvas.requestRenderAll();
  App._rebuildingPoly = false;
}

// Supprime tous les objets de preview et marqueurs de la cote en cours
function cleanupDimPreview() {
  const fc = App.canvas;
  if (App.draw.dimPreviewObjs) {
    Object.values(App.draw.dimPreviewObjs).forEach(o => fc.remove(o));
    App.draw.dimPreviewObjs = null;
  }
  if (App.draw.dimDot1) { fc.remove(App.draw.dimDot1); App.draw.dimDot1 = null; }
  if (App.draw.dimDot2) { fc.remove(App.draw.dimDot2); App.draw.dimDot2 = null; }
}

// ============================================================
// NUAGE DE RÉVISION
// ============================================================

function toolCloud_down(pt) {
  App.draw.active  = true;
  App.draw.startPt = { x: pt.x, y: pt.y };
  const tp  = App.toolProps;
  const obj = new fabric.Path(makeRevisionCloudPath(pt.x, pt.y, pt.x + 1, pt.y + 1), {
    stroke:          tp.strokeColor,
    strokeWidth:     tp.strokeWidth,
    fill:            tp.fillColor,
    opacity:         tp.opacity,
    selectable:      false, evented: false,
    data: { layerId: App.activeLayerId, pageNum: App.currentPage, type: 'cloud' },
  });
  App.canvas.add(obj);
  App.draw.tempObj = obj;
}

function toolCloud_up(pt) {
  if (!App.draw.active || !App.draw.tempObj) return;
  const s  = App.draw.startPt;
  const dx = Math.abs(pt.x - s.x), dy = Math.abs(pt.y - s.y);
  if (dx < 8 && dy < 8) {
    App.canvas.remove(App.draw.tempObj);
    App.draw.active = false; App.draw.tempObj = null; return;
  }
  const pathStr = makeRevisionCloudPath(
    Math.min(s.x, pt.x), Math.min(s.y, pt.y),
    Math.max(s.x, pt.x), Math.max(s.y, pt.y)
  );
  App.draw.tempObj.set({ path: fabric.util.parsePath(pathStr) });
  finalizeObj(App.draw.tempObj);
}

// Construit et ajoute sur le canvas un groupe cote permanente (sans setActiveObject)
function buildDimGroupOnCanvas(p1, p2, geo, layerId) {
  const tp      = App.toolProps;
  const calib   = getPageCalibration();
  const pixDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const label   = formatDimension(pixDist, calib);
  const txtAngle = (geo.angle > 90 || geo.angle < -90) ? geo.angle + 180 : geo.angle;

  const ls = { stroke: tp.strokeColor, strokeWidth: tp.strokeWidth, fill: '', strokeDashArray: tp.dashArray };

  const coteLine = new fabric.Line([geo.c1.x, geo.c1.y, geo.c2.x, geo.c2.y], ls);

  const tickLen = 7;
  const ux   = (p2.x - p1.x) / geo.len, uy = (p2.y - p1.y) / geo.len;
  const diag = normV({ x: ux + geo.nx, y: uy + geo.ny });
  const tick1 = new fabric.Line(
    [geo.c1.x - diag.x*tickLen, geo.c1.y - diag.y*tickLen,
     geo.c1.x + diag.x*tickLen, geo.c1.y + diag.y*tickLen], ls);
  const tick2 = new fabric.Line(
    [geo.c2.x - diag.x*tickLen, geo.c2.y - diag.y*tickLen,
     geo.c2.x + diag.x*tickLen, geo.c2.y + diag.y*tickLen], ls);

  const extStyle = { ...ls, strokeDashArray: null };
  const ext1 = new fabric.Line([geo.e1s.x, geo.e1s.y, geo.e1e.x, geo.e1e.y], extStyle);
  const ext2 = new fabric.Line([geo.e2s.x, geo.e2s.y, geo.e2e.x, geo.e2e.y], extStyle);

  const text = new fabric.Text(label, {
    left: geo.mid.x, top: geo.mid.y,
    fontSize: 12, fill: tp.strokeColor,
    originX: 'center', originY: 'bottom',
    angle: txtAngle,
    backgroundColor: 'rgba(255,255,255,0.82)',
    padding: 2,
  });

  // Point milieu de la ligne de cote (poignée d'écartement)
  const offsetPt = { x: geo.mid.x, y: geo.mid.y };

  const group = new fabric.Group([ext1, ext2, coteLine, tick1, tick2, text], {
    selectable: true, evented: true,
    lockScalingX: true, lockScalingY: true, // pas de redimensionnement libre
    hasRotatingPoint: false,
    data: {
      type: 'dimension', layerId: layerId || App.activeLayerId, pageNum: App.currentPage,
      pointLength: pixDist,
      p1: { ...p1 }, p2: { ...p2 }, offsetPt: { ...offsetPt },
      _lastCenter: null,
    },
  });

  App.canvas.add(group);
  group.data._lastCenter = group.getCenterPoint();
  return group;
}

// Crée la cote finale et la sélectionne (appelé depuis l'outil mesure)
function createOffsetDimension(p1, p2, geo) {
  const group = buildDimGroupOnCanvas(p1, p2, geo, App.activeLayerId);
  applyLayerPropsToObj(group);
  App.canvas.setActiveObject(group);
  App.canvas.requestRenderAll();
  saveHistoryState();
  return group;
}

// ============================================================
// COTES / DIMENSIONS (ancienne API conservée pour updateAllDimensionLabels)
// ============================================================
// Met à jour toutes les cotes de la page courante après recalibration
function updateAllDimensionLabels() {
  const calib = getPageCalibration();
  App.canvas.getObjects('group').forEach(group => {
    if (group.data?.type !== 'dimension') return;
    if (group.data?.pageNum !== App.currentPage) return;
    const newLabel = formatDimension(group.data.pointLength ?? group.data.pixelLength, calib);
    const textObj  = group._objects?.find(o => o.type === 'text');
    if (textObj) {
      textObj.set('text', newLabel);
      group.set('dirty', true);
    }
  });
  App.canvas.requestRenderAll();
}

// ============================================================
// CALIBRATION
// ============================================================
function getPageCalibration() {
  return App.pageData[App.currentPage]?.calibration || null;
}

function setPageCalibration(pointsPerUnit, unit) {
  if (!App.pageData[App.currentPage]) return;
  if (!(pointsPerUnit > 0) || !Number.isFinite(pointsPerUnit)) {
    showError('Calibration invalide.'); return;
  }
  App.pageData[App.currentPage].calibration = { pointsPerUnit, unit };
  updateCalibrationUI();
  updateAllDimensionLabels();
  updateAllAreaLabels();
  markDirty();
  const ech = pointsPerUnitToScale(pointsPerUnit, unit);
  showToast(`Calibration : 1 ${unit} = ${pointsPerUnit.toFixed(2)} pt` +
            (ech ? ` (échelle ≈ 1:${Math.round(ech)})` : ''));
}

// Propage la calibration de la page courante à toutes les pages du document.
// Possible uniquement depuis que la calibration est en points : elle ne dépend
// plus de l'échelle d'affichage propre à chaque page.
function applyCalibrationToAllPages() {
  const calib = getPageCalibration();
  if (!calib) return;
  let n = 0;
  for (let p = 1; p <= App.totalPages; p++) {
    if (p === App.currentPage || !App.pageData[p]) continue;
    App.pageData[p].calibration = { ...calib };
    n++;
  }
  if (n) { markDirty(); showToast(`Échelle appliquée à ${n} autre(s) page(s)`); }
}

function updateCalibrationUI() {
  const calib     = getPageCalibration();
  const statusEl  = document.getElementById('calib-status');
  const pageNumEl = document.getElementById('calib-page-num');
  if (pageNumEl) pageNumEl.textContent = App.currentPage;
  if (!statusEl) return;
  if (calib) {
    const ech = pointsPerUnitToScale(calib.pointsPerUnit, calib.unit);
    statusEl.className = 'calibration-info calibrated';
    statusEl.textContent = `✓ 1 ${calib.unit} = ${calib.pointsPerUnit.toFixed(2)} pt` +
                           (ech ? `  —  échelle ≈ 1:${Math.round(ech)}` : '');
  } else {
    statusEl.className = 'calibration-info';
    statusEl.textContent = 'Non calibrée — mesures en points (🎯 ou saisir une échelle)';
  }
}

// ============================================================
// PDF — Chargement et rendu
// ============================================================
// Seuil au-delà duquel on prévient l'utilisateur (le PDF est chargé en mémoire)
const BIG_PDF_WARN_BYTES = 100 * 1024 * 1024;

async function loadPDF(file) {
  // Un document est déjà ouvert avec des modifications non sauvegardées ?
  if (App.pdfDoc && App.dirty &&
      !confirm('Des annotations non sauvegardées vont être perdues. Ouvrir quand même ce PDF ?')) {
    return;
  }

  if (file.size > BIG_PDF_WARN_BYTES) {
    const mb = Math.round(file.size / 1024 / 1024);
    if (!confirm(`Ce PDF fait ${mb} Mo. Il sera entièrement chargé en mémoire et le rendu ` +
                 `de chaque page peut être long.\n\nContinuer ?`)) return;
  }

  setProgress(`Lecture de ${file.name}…`);

  try {
    const arrayBuffer = await file.arrayBuffer();

    // Réinitialisation COMPLÈTE : sans ça les annotations du document
    // précédent se superposaient au nouveau plan.
    resetDocumentState();

    App.pdfBlob    = file;
    App.pdfDoc     = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    App.totalPages = App.pdfDoc.numPages;
    App.currentPage = 1;
    App.pdfInfo    = { fileName: file.name, byteSize: file.size, pageCount: App.totalPages };

    // La rotation est ABSOLUE et part du /Rotate du PDF : getViewport({rotation})
    // l'écrase, or un plan scanné stocké en /Rotate 90 s'affichait de travers.
    for (let i = 1; i <= App.totalPages; i++) {
      const pg = await App.pdfDoc.getPage(i);
      App.pageData[i] = {
        rotation:    ((pg.rotate || 0) % 360 + 360) % 360,
        calibration: null,   // { pointsPerUnit, unit }
        objects:     [],     // objets Fabric sérialisés, en points PDF
      };
    }

    document.getElementById('thumb-hint')?.remove();

    // La page 1 s'affiche AVANT les vignettes : en v1.1 le rendu séquentiel
    // des N vignettes gelait l'application plusieurs minutes avant tout affichage.
    setProgress('Rendu de la page 1…');
    await switchPage(1);
    applyPageDefaults();

    buildThumbnailStrip();          // squelettes immédiats
    startLazyThumbnails();          // rendus à la demande, 1 à la fois

    updateDocumentState();
    clearProgress();
    showToast(`${file.name} — ${App.totalPages} page(s)`);

    // Reprise différée : le PDF était trop volumineux pour être stocké,
    // on réapplique le projet dès que l'utilisateur rouvre le bon fichier.
    if (App._pendingRecovery) {
      const proj = App._pendingRecovery;
      App._pendingRecovery = null;
      await loadProject(JSON.stringify(proj));
      App.dirty = true;
      updateDocumentState();
    }
  } catch (err) {
    console.error(err);
    resetDocumentState();
    clearProgress();
    showError(`Impossible d'ouvrir ce PDF : ${describeError(err)}`);
  }
}

// Adapte les valeurs par défaut (épaisseur de trait, corps de texte) au format
// du plan. Ces grandeurs sont maintenant PHYSIQUES (en points) : 2 pt ≈ 0,7 mm
// convient à une feuille A4, mais serait invisible sur un A0.
function applyPageDefaults() {
  const pd = App.pageData[1];
  if (!pd?.pageW) return;
  const ref = Math.max(pd.pageW, pd.pageH);          // plus grand côté, en points

  App.toolProps.strokeWidth = Math.max(1, Math.round(ref / 400 * 2) / 2);  // pas de 0,5 pt
  App.toolProps.fontSize    = Math.max(10, Math.round(ref / 60));

  const sw = document.getElementById('prop-stroke-width');
  const fs = document.getElementById('prop-font-size');
  if (sw) sw.value = App.toolProps.strokeWidth;
  if (fs) fs.value = App.toolProps.fontSize;
}

// Remet à zéro tout l'état lié au document (appelé avant chaque ouverture)
function resetDocumentState() {
  resetDrawState();
  App.canvas?.remove(...(App.canvas.getObjects() || []));
  App.pdfDoc        = null;
  App.pdfInfo       = null;
  App.pdfBlob       = null;
  App.totalPages    = 0;
  App.currentPage   = 1;
  App.pageData      = {};
  App.layers        = [];
  App.activeLayerId = null;
  App.nextLayerId   = 1;
  App.history       = {};
  App.clipboard     = null;
  App.dirty         = false;
  renderLayersList();
  App.canvas?.requestRenderAll();
}

// ------------------------------------------------------------
// Vignettes paresseuses : squelettes instantanés, rendu à la demande
// ------------------------------------------------------------
const Thumbs = {
  observer: null,
  queue:    [],       // numéros de page en attente de rendu
  busy:     false,    // un seul rendu à la fois (pdf.js sature le thread sinon)
  done:     new Set(),
};

function buildThumbnailStrip() {
  const strip = document.getElementById('thumbnails');
  strip.innerHTML = '';
  Thumbs.done.clear();
  Thumbs.queue = [];

  for (let i = 1; i <= App.totalPages; i++) {
    const div = document.createElement('div');
    div.className = `thumb${i === App.currentPage ? ' active' : ''}`;
    div.dataset.page = i;
    div.title = `Page ${i}`;
    div.addEventListener('click', () => switchPage(i));

    const ph = document.createElement('div');
    ph.className = 'thumb-placeholder';
    ph.textContent = '…';

    const numSpan = document.createElement('span');
    numSpan.className = 'thumb-num';
    numSpan.textContent = i;

    const rotBtn = document.createElement('button');
    rotBtn.className = 'thumb-rot-btn';
    rotBtn.innerHTML = '↻';
    rotBtn.title = 'Rotation 90°';
    rotBtn.addEventListener('click', (e) => { e.stopPropagation(); rotatePage(i); });

    div.append(ph, numSpan, rotBtn);
    strip.appendChild(div);
  }
}

function startLazyThumbnails() {
  Thumbs.observer?.disconnect();
  const strip = document.getElementById('thumbnails');

  Thumbs.observer = new IntersectionObserver((entries) => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      const pn = Number(en.target.dataset.page);
      if (!Thumbs.done.has(pn) && !Thumbs.queue.includes(pn)) {
        Thumbs.queue.push(pn);
        drainThumbQueue();
      }
    });
  }, { root: strip, rootMargin: '200px' });

  strip.querySelectorAll('.thumb').forEach(t => Thumbs.observer.observe(t));

  // Filet de sécurité : les premières vignettes sont toujours visibles, on les
  // met en file sans attendre l'observateur (qui peut ne jamais se déclencher
  // si l'onglet est en arrière-plan au chargement).
  for (let i = 1; i <= Math.min(8, App.totalPages); i++) {
    if (!Thumbs.queue.includes(i)) Thumbs.queue.push(i);
  }
  drainThumbQueue();
}

async function drainThumbQueue() {
  if (Thumbs.busy) return;
  Thumbs.busy = true;
  try {
    while (Thumbs.queue.length) {
      // Priorité à la page courante si elle est dans la file
      const idx = Thumbs.queue.indexOf(App.currentPage);
      const pn  = Thumbs.queue.splice(idx >= 0 ? idx : 0, 1)[0];
      if (Thumbs.done.has(pn) || !App.pdfDoc) continue;
      await renderThumbnail(pn);
      Thumbs.done.add(pn);
      // Laisser respirer l'interface entre deux pages lourdes
      await new Promise(r => setTimeout(r, 0));
    }
  } catch (err) {
    console.warn('Vignette non rendue :', err);
  } finally {
    Thumbs.busy = false;
  }
}

async function renderThumbnail(pageNum) {
  const div = document.querySelector(`.thumb[data-page="${pageNum}"]`);
  if (!div) return;
  const canvasEl = document.createElement('canvas');
  await renderPageToCanvas(pageNum, canvasEl, 62);
  div.querySelector('.thumb-placeholder')?.remove();
  div.querySelector('canvas')?.remove();
  div.prepend(canvasEl);
}

// Force le re-rendu d'une vignette déjà générée (après rotation)
async function refreshThumbnail(pageNum) {
  Thumbs.done.delete(pageNum);
  if (!Thumbs.queue.includes(pageNum)) Thumbs.queue.push(pageNum);
  await drainThumbQueue();
}

// Rendu d'une page PDF dans un <canvas> HTML (pour vignettes)
async function renderPageToCanvas(pageNum, canvasEl, maxW) {
  const page     = await App.pdfDoc.getPage(pageNum);
  const rotation = App.pageData[pageNum]?.rotation || 0;
  const vp0      = page.getViewport({ scale: 1, rotation });
  const scale    = maxW / vp0.width;
  const vp       = page.getViewport({ scale, rotation });
  canvasEl.width  = vp.width;
  canvasEl.height = vp.height;
  await page.render({ canvasContext: canvasEl.getContext('2d'), viewport: vp }).promise;
}

// ============================================================
// NAVIGATION DE PAGES
// ============================================================
async function switchPage(pageNum) {
  if (!App.pdfDoc || pageNum < 1 || pageNum > App.totalPages) return;

  // IMPORTANT : nettoyer AVANT de sauvegarder, sinon les poignées et previews
  // encore présents sur le canvas sont persistés comme des annotations.
  if (App.canvas) {
    resetDrawState();
    saveCurrentPageObjects();
  }

  App.currentPage = pageNum;

  // Les calques sont globaux au document : rien à recharger par page.

  // Mettre à jour les vignettes actives
  document.querySelectorAll('.thumb').forEach(t => {
    t.classList.toggle('active', Number(t.dataset.page) === pageNum);
  });
  document.getElementById('page-info').textContent = `Page ${pageNum} / ${App.totalPages}`;
  updateCalibrationUI();
  resetDrawState();

  await renderCurrentPage();
  loadPageObjects();
  updateHistoryButtons();
}

// ============================================================
// REPÈRE DE COORDONNÉES (v2.0)
// ------------------------------------------------------------
// L'espace objet du canvas Fabric EST l'espace de la page PDF, en points
// (origine = coin haut-gauche de la page, 1 unité = 1 pt = 0,3528 mm).
//
// La v1.1 stockait les annotations en pixels écran, dans un repère
// recalculé à chaque rendu depuis la taille de la fenêtre : rouvrir un
// projet sur un autre écran décalait tout, et la calibration devenait
// fausse. Désormais l'adaptation à la fenêtre passe UNIQUEMENT par le
// viewportTransform de Fabric (zoom/pan), qui ne touche pas aux objets.
//
// La netteté du plan est découplée du repère : le fond est rendu par
// pdf.js à `bgScale` (≈ zoom × densité écran) puis affiché avec un
// facteur 1/bgScale. Zoomer re-rend donc le plan au lieu d'agrandir
// une image — la v1.1 étirait un JPEG et devenait illisible.
// ============================================================

const BG_MAX_SCALE   = 4;      // plafond de résolution du fond
const BG_MIN_SCALE   = 0.25;
const BG_REFRESH_MS  = 250;    // anti-rebond après un zoom
const BG_RESCALE_TOL = 0.25;   // écart relatif à partir duquel on re-rend

let bgRefreshTimer = null;
let bgRenderTask   = null;     // RenderTask pdf.js en cours (annulable)
let bgCurrentScale = 0;

// Résolution de rendu souhaitée pour le fond au zoom courant
function targetBackgroundScale() {
  const zoom = App.canvas ? App.canvas.getZoom() : 1;
  const dpr  = window.devicePixelRatio || 1;
  return Math.min(BG_MAX_SCALE, Math.max(BG_MIN_SCALE, zoom * dpr));
}

// Rend la page courante dans le canvas Fabric
async function renderCurrentPage() {
  const fc      = App.canvas;
  const wrapper = document.getElementById('canvas-wrapper');
  const pd      = App.pageData[App.currentPage];
  if (!pd) return;

  const page     = await App.pdfDoc.getPage(App.currentPage);
  const rotation = pd.rotation || 0;

  // Dimensions de la page EN POINTS — c'est l'espace objet
  const vp1 = page.getViewport({ scale: 1, rotation });
  pd.pageW = vp1.width;
  pd.pageH = vp1.height;

  fc.setWidth(wrapper.clientWidth   || 800);
  fc.setHeight(wrapper.clientHeight || 600);

  fitToWindow();                       // définit le zoom/pan initial
  await refreshBackground(true);       // puis le fond à la bonne résolution
}

// (Re)construit l'image de fond à la résolution adaptée au zoom courant.
// `force` ignore le seuil de tolérance (changement de page, rotation…).
async function refreshBackground(force = false) {
  const fc = App.canvas;
  const pd = App.pageData[App.currentPage];
  if (!App.pdfDoc || !pd) return;

  const target = targetBackgroundScale();
  if (!force && bgCurrentScale > 0 &&
      Math.abs(target - bgCurrentScale) / bgCurrentScale < BG_RESCALE_TOL) return;

  // Annuler un rendu encore en cours (zooms successifs rapides)
  if (bgRenderTask) { try { bgRenderTask.cancel(); } catch {} bgRenderTask = null; }

  const pageNum = App.currentPage;
  try {
    const page = await App.pdfDoc.getPage(pageNum);
    const vp   = page.getViewport({ scale: target, rotation: pd.rotation || 0 });

    const off  = document.createElement('canvas');
    off.width  = Math.max(1, Math.round(vp.width));
    off.height = Math.max(1, Math.round(vp.height));

    bgRenderTask = page.render({ canvasContext: off.getContext('2d'), viewport: vp });
    await bgRenderTask.promise;
    bgRenderTask = null;

    if (pageNum !== App.currentPage) return;   // l'utilisateur a changé de page

    // L'image couvre exactement [0, pageW] × [0, pageH] en points
    const bg = new fabric.Image(off, {
      left: 0, top: 0,
      originX: 'left', originY: 'top',
      scaleX: pd.pageW / off.width,
      scaleY: pd.pageH / off.height,
      selectable: false, evented: false,
      objectCaching: false,
    });
    fc.setBackgroundImage(bg, () => {});   // objet Fabric → synchrone
    bgCurrentScale = target;
    fc.requestRenderAll();
  } catch (err) {
    bgRenderTask = null;
    if (err?.name === 'RenderingCancelledException') return;
    console.error(err);
    showError(`Rendu de la page ${pageNum} impossible : ${describeError(err)}`);
  }
}

// À appeler après tout changement de zoom
function scheduleBackgroundRefresh() {
  clearTimeout(bgRefreshTimer);
  bgRefreshTimer = setTimeout(() => refreshBackground(false), BG_REFRESH_MS);
}

// Rotation d'une page (cumul 90°)
// Rotation d'une page de 90° horaire.
// Les annotations tournent AVEC le plan : en v1.1 le fond tournait et les
// annotations restaient en place, ce qui les désolidarisait du dessin.
async function rotatePage(pageNum) {
  const pd = App.pageData[pageNum];
  if (!App.pdfDoc || !pd) return;

  // Hauteur de la page AVANT rotation, en points : c'est elle qui définit
  // la transformation (x, y) → (pageH − y, x).
  const page = await App.pdfDoc.getPage(pageNum);
  const vpBefore = page.getViewport({ scale: 1, rotation: pd.rotation || 0 });
  const pageH = vpBefore.height;

  if (pageNum === App.currentPage) {
    resetDrawState();
    rotateObjects90(App.canvas.getObjects(), pageH);
    App.canvas.discardActiveObject();
    App.canvas.requestRenderAll();
    saveCurrentPageObjects();
  } else {
    pd.objects = await rotatePageObjectsOffscreen(pd.objects || [], pageH);
  }

  pd.rotation = ((pd.rotation || 0) + 90) % 360;

  await refreshThumbnail(pageNum);
  if (pageNum === App.currentPage) await renderCurrentPage();
  markDirty();
  saveHistoryState();
}

// Fait tourner de 90° une liste d'objets Fabric vivants.
// `getCenterPoint` / `setPositionByOrigin` gèrent correctement les objets déjà
// tournés et les origines non standard — un calcul sur la boîte left/top les
// aurait décalés, l'erreur s'accumulant à chaque rotation.
function rotateObjects90(objects, pageH) {
  objects.forEach(obj => {
    if (isTempObject(obj)) return;
    const c  = obj.getCenterPoint();
    const nc = rotatePoint90({ x: c.x, y: c.y }, pageH);
    obj.set('angle', normalizeAngle((obj.angle || 0) + 90));
    obj.setPositionByOrigin(new fabric.Point(nc.x, nc.y), 'center', 'center');
    obj.setCoords();
    if (obj.data) {
      rotateDimData90(obj.data, pageH);
      // Le suivi de déplacement des cotes repart du nouveau centre : le laisser
      // à null ferait échouer la première synchronisation après rotation.
      if (obj.data.type === 'dimension') obj.data._lastCenter = obj.getCenterPoint();
    }
  });
}

// Les cotes portent leurs points de mesure en coordonnées absolues
function rotateDimData90(data, pageH) {
  for (const key of ['p1', 'p2', 'offsetPt']) {
    if (data[key] && typeof data[key].x === 'number') data[key] = rotatePoint90(data[key], pageH);
  }
}

// Rotation des objets d'une page NON affichée : ils sont ré-hydratés dans un
// canvas jetable pour réutiliser exactement le même code que la page courante.
function rotatePageObjectsOffscreen(serialized, pageH) {
  if (!serialized.length) return Promise.resolve(serialized);
  return new Promise(resolve => {
    fabric.util.enlivenObjects(serialized, (objs) => {
      const tmp = new fabric.StaticCanvas(null, { width: 10, height: 10 });
      objs.forEach(o => tmp.add(o));
      rotateObjects90(objs, pageH);
      const out = tmp.toJSON(['data', 'objectType', 'strokeUniform'])
                     .objects.map(stripVolatileData);
      tmp.dispose();
      resolve(out);
    });
  });
}

// ============================================================
// GESTION DES OBJETS FABRIC PAR PAGE
// ============================================================
function saveCurrentPageObjects() {
  const pd = App.pageData[App.currentPage];
  if (!pd) return;                       // pas de PDF chargé → rien à sauvegarder
  pd.objects = serializePage(App.currentPage);
}

function loadPageObjects() {
  const fc      = App.canvas;
  const objects = App.pageData[App.currentPage]?.objects || [];

  // Supprimer tous les objets Fabric courants
  fc.remove(...fc.getObjects());

  if (objects.length === 0) { fc.requestRenderAll(); seedHistory(); return; }

  // Recréer les objets Fabric à partir du JSON sérialisé
  fabric.util.enlivenObjects(objects, (fabricObjs) => {
    fabricObjs.forEach(obj => {
      if (isTransparentFill(obj.fill)) obj.set('perPixelTargetFind', true);
      fc.add(obj);
    });
    applyAllLayerStates(); // Re-appliquer visibilité / verrouillage
    fc.requestRenderAll();
    seedHistory();         // après l'hydratation : enlivenObjects est asynchrone
  });
}

// ============================================================
// GESTION DES CALQUES
// ============================================================
const LAYER_COLORS = ['#e05c5c','#f0a030','#50c060','#50b8e0','#a060e0','#e060a0','#80c040','#40a0c0'];

function addLayer(name) {
  const id = App.nextLayerId++;
  const color = LAYER_COLORS[(App.layers.length) % LAYER_COLORS.length];
  App.layers.push({ id, name, visible: true, locked: false, color });
  if (!App.activeLayerId) App.activeLayerId = id;
  renderLayersList();
  saveHistoryState();
  return id;
}

function removeLayer(id) {
  if (App.layers.length <= 1) { showToast('Impossible de supprimer le dernier calque'); return; }
  App.layers = App.layers.filter(l => l.id !== id);
  if (App.activeLayerId === id) App.activeLayerId = App.layers[0]?.id || null;
  // Supprimer les objets du calque sur toutes les pages
  Object.keys(App.pageData).forEach(p => {
    App.pageData[p].objects = App.pageData[p].objects.filter(o => o.data?.layerId !== id);
  });
  // Supprimer du canvas courant
  App.canvas.getObjects().filter(o => o.data?.layerId === id).forEach(o => App.canvas.remove(o));
  App.canvas.requestRenderAll();
  renderLayersList();
  saveHistoryState();
}

function renameLayer(id, newName) {
  const layer = App.layers.find(l => l.id === id);
  if (layer) { layer.name = newName; renderLayersList(); saveHistoryState(); }
}

function toggleLayerVisibility(id) {
  const layer = App.layers.find(l => l.id === id);
  if (!layer) return;
  layer.visible = !layer.visible;
  // Un objet masqué ne doit pas rester sélectionnable : en v1.1 Ctrl+A
  // l'attrapait et il pouvait être déplacé ou supprimé sans être vu.
  App.canvas.getObjects().forEach(obj => {
    if (obj.data?.layerId === id) {
      obj.set({ visible:    layer.visible,
                selectable: layer.visible && !layer.locked,
                evented:    layer.visible && !layer.locked });
    }
  });
  App.canvas.discardActiveObject();
  App.canvas.requestRenderAll();
  renderLayersList();
  saveHistoryState();
}

function toggleLayerLock(id) {
  const layer = App.layers.find(l => l.id === id);
  if (!layer) return;
  layer.locked = !layer.locked;
  App.canvas.getObjects().forEach(obj => {
    if (obj.data?.layerId === id) {
      obj.set({ selectable: layer.visible && !layer.locked,
                evented:    layer.visible && !layer.locked });
    }
  });
  App.canvas.discardActiveObject();
  App.canvas.requestRenderAll();
  renderLayersList();
  saveHistoryState();
}

// Applique l'état de visibilité et verrouillage de tous les calques aux objets
function applyAllLayerStates() {
  App.layers.forEach(layer => {
    App.canvas.getObjects().forEach(obj => {
      if (obj.data?.layerId === layer.id) {
        obj.set({
          visible:    layer.visible,
          selectable: !layer.locked,
          evented:    !layer.locked,
        });
      }
    });
  });
}

// Applique l'état du calque actif à un objet nouvellement créé
function applyLayerPropsToObj(obj) {
  const layer = App.layers.find(l => l.id === App.activeLayerId);
  if (!layer) return;
  obj.set({
    visible:    layer.visible,
    selectable: !layer.locked,
    evented:    !layer.locked,
  });
}

// Rendu de la liste des calques dans le panneau
function renderLayersList() {
  const list = document.getElementById('layers-list');
  if (!list) return;
  list.innerHTML = '';

  // Ordre inversé : le calque du dessus en premier visuellement
  [...App.layers].reverse().forEach(layer => {
    const item = document.createElement('div');
    item.className = `layer-item${layer.id === App.activeLayerId ? ' active' : ''}`;
    item.addEventListener('click', () => setActiveLayer(layer.id));

    const dot = document.createElement('div');
    dot.className = 'layer-color';
    dot.style.background = layer.color;

    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = layer.name;
    name.title = 'Double-clic pour renommer';
    name.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      openRenameLayerModal(layer.id, layer.name);
    });

    const btnRen = document.createElement('button');
    btnRen.className = 'layer-btn';
    btnRen.innerHTML = '✏️';
    btnRen.title = 'Renommer';
    btnRen.addEventListener('click', (e) => { e.stopPropagation(); openRenameLayerModal(layer.id, layer.name); });

    const btnVis = document.createElement('button');
    btnVis.className = `layer-btn${!layer.visible ? ' hidden' : ''}`;
    btnVis.innerHTML = layer.visible ? '👁' : '🚫';
    btnVis.title = layer.visible ? 'Masquer' : 'Afficher';
    btnVis.addEventListener('click', (e) => { e.stopPropagation(); toggleLayerVisibility(layer.id); });

    const btnLock = document.createElement('button');
    btnLock.className = `layer-btn${layer.locked ? ' locked' : ''}`;
    btnLock.innerHTML = layer.locked ? '🔒' : '🔓';
    btnLock.title = layer.locked ? 'Déverrouiller' : 'Verrouiller';
    btnLock.addEventListener('click', (e) => { e.stopPropagation(); toggleLayerLock(layer.id); });

    const btnDel = document.createElement('button');
    btnDel.className = 'layer-btn';
    btnDel.innerHTML = '✕';
    btnDel.title = 'Supprimer le calque';
    btnDel.style.color = 'var(--danger)';
    btnDel.addEventListener('click', (e) => { e.stopPropagation(); if (confirm(`Supprimer le calque "${layer.name}" ?`)) removeLayer(layer.id); });

    item.append(dot, name, btnRen, btnVis, btnLock, btnDel);
    list.appendChild(item);
  });
}

function setActiveLayer(id) {
  App.activeLayerId = id;
  renderLayersList();
}

// ============================================================
// SYMBOLES SVG — Bibliothèque et placement
// ============================================================
function makeSymItem(sym) {
  const item = document.createElement('div');
  item.className = 'sym-item';
  item.draggable = true;
  item.dataset.symbolId = sym.id;
  item.title = sym.label;

  const preview = document.createElement('div');
  preview.className = 'sym-preview';
  preview.innerHTML = sym.svg;

  const label = document.createElement('div');
  label.className = 'sym-label';
  label.textContent = sym.label;

  item.appendChild(preview);
  item.appendChild(label);

  item.addEventListener('dragstart', (e) => {
    App.dragSymbolId = sym.id;
    e.dataTransfer.setData('symbolId', sym.id);
    e.dataTransfer.effectAllowed = 'copy';
    const ghost = document.getElementById('drag-ghost');
    ghost.innerHTML = sym.svg;
    ghost.style.display = 'block';
    e.dataTransfer.setDragImage(ghost, 20, 20);
  });
  item.addEventListener('dragend', () => {
    document.getElementById('drag-ghost').style.display = 'none';
  });
  item.addEventListener('click', (e) => {
    if (e.defaultPrevented) return;
    const fc  = App.canvas;
    const vpt = fc.viewportTransform;
    const cx  = (fc.width  / 2 - vpt[4]) / vpt[0];
    const cy  = (fc.height / 2 - vpt[5]) / vpt[3];
    placeSymbol(sym.id, cx, cy);
  });
  return item;
}

function renderSymbolSearch(container, query) {
  const q = query.toLowerCase().trim();
  let existing = container.querySelector('.sym-search-results');
  if (!existing) {
    existing = document.createElement('div');
    existing.className = 'sym-search-results';
    container.prepend(existing);
  }
  existing.innerHTML = '';
  if (!q) { existing.style.display = 'none'; return; }

  const allSyms = SYMBOL_CATEGORIES.flatMap(c => c.symbols);
  const matches = allSyms.filter(s => s.label.toLowerCase().includes(q));
  existing.style.display = '';
  if (matches.length === 0) {
    existing.innerHTML = '<div style="color:var(--text-muted);font-size:11px;padding:4px">Aucun résultat</div>';
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'sym-grid';
  matches.forEach(s => grid.appendChild(makeSymItem(s)));
  existing.appendChild(grid);
}

function initSymbolLibrary() {
  const container = document.getElementById('symbol-library');
  if (!container) return;

  // Barre de recherche
  const searchWrap = document.createElement('div');
  searchWrap.style.cssText = 'padding:6px 8px 4px;position:sticky;top:0;background:var(--panel-bg);z-index:2;';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = '🔍 Rechercher un symbole…';
  searchInput.style.cssText = 'width:100%;box-sizing:border-box;padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--input-bg);color:var(--text);font-size:12px;';
  searchInput.addEventListener('input', () => {
    renderSymbolSearch(container, searchInput.value);
    // Masquer/afficher les catégories selon la recherche
    container.querySelectorAll('.sym-category').forEach(s => {
      s.style.display = searchInput.value.trim() ? 'none' : '';
    });
  });
  searchWrap.appendChild(searchInput);
  container.appendChild(searchWrap);

  // Zone résultats recherche (initialement cachée)
  const searchResults = document.createElement('div');
  searchResults.className = 'sym-search-results';
  searchResults.style.display = 'none';
  container.appendChild(searchResults);

  SYMBOL_CATEGORIES.forEach(cat => {
    const section = document.createElement('div');
    section.className = 'sym-category';

    const title = document.createElement('div');
    title.className = 'sym-category-title';
    const titleText = document.createElement('span');
    titleText.textContent = cat.label;
    const arrow = document.createElement('span');
    arrow.className = 'sym-cat-arrow';
    arrow.textContent = '▾';
    title.append(titleText, arrow);
    title.addEventListener('click', () => section.classList.toggle('collapsed'));
    section.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'sym-grid';

    cat.symbols.forEach(sym => {
      grid.appendChild(makeSymItem(sym));
    });

    section.appendChild(grid);
    container.appendChild(section);
  });
}

// Calcule la taille cible en pixels pour un symbole selon la calibration de la page
// Si calibré, utilise les dimensions réelles françaises (cm) du symbole
// Sinon, retombe sur les dimensions pixel par défaut
function getSymbolTargetPxSize(sym) {
  const calib = getPageCalibration();
  if (calib && sym.realW_cm != null) {
    let pixelsPerCm;
    if      (calib.unit === 'm')  pixelsPerCm = calib.pointsPerUnit / 100;
    else if (calib.unit === 'cm') pixelsPerCm = calib.pointsPerUnit;
    else                          pixelsPerCm = calib.pointsPerUnit * 10; // mm → cm
    return { w: sym.realW_cm * pixelsPerCm, h: sym.realH_cm * pixelsPerCm };
  }
  return { w: sym.defaultW, h: sym.defaultH };
}

// Applique la couleur choisie aux tracés d'un tableau d'objets Fabric issus d'un SVG
// Ne touche pas aux fills blancs ou transparents (fond des symboles)
function applySymbolColor(objects, color) {
  if (!color || color === '#000000') return; // noir = couleur SVG d'origine, rien à faire
  objects.forEach(obj => {
    if (obj.stroke && obj.stroke !== 'none' && obj.stroke !== '')
      obj.set('stroke', color);
    // Fill noir uniquement (poignées, points) → aussi coloré
    if (obj.fill && obj.fill !== 'none' && obj.fill !== ''
        && obj.fill !== 'white' && obj.fill !== '#ffffff'
        && obj.fill !== 'transparent')
      obj.set('fill', color);
  });
}

function recolorSelectedSymbol(color) {
  const active = App.canvas?.getActiveObject();
  if (!active || active.data?.type !== 'symbol') return;
  const objs = active.getObjects ? active.getObjects() : [active];
  objs.forEach(obj => {
    if (obj.stroke && obj.stroke !== 'none' && obj.stroke !== '') obj.set('stroke', color);
    if (obj.fill && obj.fill !== 'none' && obj.fill !== ''
        && obj.fill !== 'white' && obj.fill !== '#ffffff'
        && obj.fill !== 'transparent') obj.set('fill', color);
  });
  App.canvas.requestRenderAll();
  saveHistoryState();
}

function placeSymbol(symbolId, x, y) {
  if (!requireDocument()) return;
  const sym = SYMBOL_CATEGORIES.flatMap(c => c.symbols).find(s => s.id === symbolId);
  if (!sym) return;

  ensureActiveLayer();

  if (sym.nativeFabric) {
    const nf = sym.nativeFabric;
    const stroke = App.symbolColor || '#000000';
    let obj;
    if (nf.type === 'polygon') {
      obj = new fabric.Polygon(nf.points, { fill: 'white', stroke, strokeWidth: 2, strokeUniform: true });
    } else if (nf.type === 'path') {
      obj = new fabric.Path(nf.d, { fill: 'white', stroke, strokeWidth: 2, strokeUniform: true });
    } else if (nf.type === 'ellipse') {
      obj = new fabric.Ellipse({ rx: nf.rx, ry: nf.ry, fill: 'white', stroke, strokeWidth: 2, strokeUniform: true });
    } else {
      return;
    }
    const { w: targetW, h: targetH } = getSymbolTargetPxSize(sym);
    obj.set({
      left: x - targetW / 2, top: y - targetH / 2,
      scaleX: targetW / (obj.width  || sym.defaultW),
      scaleY: targetH / (obj.height || sym.defaultH),
      selectable: true, evented: true, hasControls: true, hasBorders: true,
      data: { type: 'symbol', symbolId, layerId: App.activeLayerId, pageNum: App.currentPage },
    });
    applyLayerPropsToObj(obj);
    App.canvas.add(obj);
    App.canvas.setActiveObject(obj);
    App.canvas.requestRenderAll();
    updateDimDisplay(obj);
    saveHistoryState();
    return;
  }

  fabric.loadSVGFromString(sym.svg, (objects, options) => {
    applySymbolColor(objects, App.symbolColor);

    // strokeUniform: true → épaisseur du trait constante quel que soit le scale
    objects.forEach(o => o.set({ strokeUniform: true }));

    const group = fabric.util.groupSVGElements(objects, options);
    const { w: targetW, h: targetH } = getSymbolTargetPxSize(sym);
    const scaleX = targetW / (group.width  || sym.defaultW);
    const scaleY = targetH / (group.height || sym.defaultH);

    group.set({
      left:        x - targetW / 2,
      top:         y - targetH / 2,
      scaleX,      scaleY,
      selectable:  true,
      evented:     true,
      hasControls: true,
      hasBorders:  true,
      strokeUniform: true,
      data: { type: 'symbol', symbolId, layerId: App.activeLayerId, pageNum: App.currentPage },
    });

    applyLayerPropsToObj(group);
    App.canvas.add(group);
    App.canvas.setActiveObject(group);
    App.canvas.requestRenderAll();
    updateDimDisplay(group);
    saveHistoryState();
  });
}

function handleSymbolDrop(e) {
  e.preventDefault();
  const symbolId = e.dataTransfer.getData('symbolId') || App.dragSymbolId;
  if (!symbolId) return;

  const fc  = App.canvas;
  const el  = fc.lowerCanvasEl;
  const rect = el.getBoundingClientRect();
  const vpt  = fc.viewportTransform;
  const canvasX = (e.clientX - rect.left  - vpt[4]) / vpt[0];
  const canvasY = (e.clientY - rect.top   - vpt[5]) / vpt[3];

  placeSymbol(symbolId, canvasX, canvasY);
  App.dragSymbolId = null;
}

// ============================================================
// SAUVEGARDE / CHARGEMENT DU PROJET
// ============================================================
// Nom de fichier dérivé du PDF source plutôt qu'un nom fixe
function projectFileName() {
  const base = (App.pdfInfo?.fileName || 'projet').replace(/\.pdf$/i, '');
  return `${base}.annot.json`;
}

function buildProjectData() {
  saveCurrentPageObjects();
  return {
    version:     PROJECT_FORMAT,
    appVersion:  APP_VERSION,
    savedAt:     new Date().toISOString(),
    // Empreinte du PDF : permet de détecter qu'on applique un projet au mauvais plan
    source:      App.pdfInfo,
    totalPages:  App.totalPages,
    nextLayerId: App.nextLayerId,
    layers:        App.layers.map(l => ({ ...l })),   // globaux au document
    activeLayerId: App.activeLayerId,
    pages:         App.pageData,
  };
}

function saveProject() {
  if (!requireDocument()) return;
  try {
    const json = JSON.stringify(buildProjectData(), null, 2);
    downloadBlob(new Blob([json], { type: 'application/json' }), projectFileName());
    App.dirty = false;
    updateDocumentState();
    showToast(`Projet sauvegardé — ${projectFileName()}`);
  } catch (err) {
    console.error(err);
    showError(`Sauvegarde impossible : ${describeError(err)}`);
  }
}

// Télécharge un Blob sous un nom donné (révocation différée : Firefox annule sinon)
function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url; a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Vérifie que le projet correspond bien au PDF ouvert. N'empêche pas le chargement
// (un PDF ré-exporté change de taille) mais prévient explicitement.
function checkProjectMatchesPdf(data) {
  const src = data.source;
  const cur = App.pdfInfo;
  if (!src || !cur) return true;

  const problems = [];
  if (src.pageCount && src.pageCount !== cur.pageCount)
    problems.push(`${src.pageCount} page(s) attendues, ${cur.pageCount} ouverte(s)`);
  if (src.fileName && src.fileName !== cur.fileName)
    problems.push(`fichier « ${src.fileName} » attendu, « ${cur.fileName} » ouvert`);
  else if (src.byteSize && src.byteSize !== cur.byteSize)
    problems.push('la taille du fichier a changé');

  if (!problems.length) return true;
  return confirm(
    `⚠️ Ce projet ne semble pas correspondre au PDF ouvert :\n\n` +
    problems.map(p => `  • ${p}`).join('\n') +
    `\n\nLes annotations risquent d'être mal placées. Charger quand même ?`
  );
}

async function loadProject(jsonStr) {
  if (!requireDocument()) return;

  let data;
  try {
    data = JSON.parse(jsonStr);
  } catch (err) {
    showError(`Fichier projet illisible : ${describeError(err)}`);
    return;
  }
  if (!data || typeof data !== 'object' || !data.pages) {
    showError('Ce fichier n’est pas un projet Annoteur valide.');
    return;
  }
  if (!checkProjectMatchesPdf(data)) return;

  // Migration du repère : les projets v1.0/v1.1 stockaient les annotations en
  // pixels écran. La conversion utilise le renderScale et l'offset propres à
  // CHAQUE page (un même projet pouvait en contenir plusieurs).
  let notes = [];
  try {
    const migrated = migrateProject(data);
    data  = migrated.data;
    notes = migrated.notes;
  } catch (err) {
    showError(`Projet non convertible : ${describeError(err)}`);
    return;
  }

  try {
    App.nextLayerId = data.nextLayerId || 1;

    // Restaurer les données de pages (calibration, rotation, objets, calques)
    Object.keys(data.pages).forEach(p => {
      const pn = Number(p);
      if (!Number.isFinite(pn) || pn < 1 || pn > App.totalPages) return;  // page hors document
      App.pageData[pn] = App.pageData[pn] || {};
      Object.assign(App.pageData[pn], data.pages[p]);
      if (!Array.isArray(App.pageData[pn].objects)) App.pageData[pn].objects = [];
    });

    // Calques globaux au document (la migration les a remontés si nécessaire)
    App.layers        = (data.layers || []).map(l => ({ ...l }));
    App.activeLayerId = data.activeLayerId ?? App.layers[0]?.id ?? null;
    renderLayersList();
    await renderCurrentPage();
    loadPageObjects();
    updateCalibrationUI();
    App.dirty = false;
    updateDocumentState();
    if (notes.length) {
      showToast('Projet converti au nouveau format ✓');
      console.info('Migration du projet :\n- ' + notes.join('\n- '));
      setTimeout(() => showToast(notes[0]), 2600);
    } else {
      showToast('Projet chargé ✓');
    }
  } catch (err) {
    console.error(err);
    showError(`Chargement du projet impossible : ${describeError(err)}`);
  }
}

// ============================================================
// EXPORT PDF
// ============================================================

// Formats papier — dimensions portrait en mm (jsPDF name → { w, h })
const PAPER_FORMATS = {
  a4: { w: 210, h: 297 },
  a3: { w: 297, h: 420 },
};

// Aiguillage : vectoriel (défaut) ou rastérisé (compatibilité)
async function exportPDF(selectedLayerIds, resolution, format = 'original', mode = 'vector') {
  if (!requireDocument()) return;
  if (mode === 'vector') return exportPDFVectorial(selectedLayerIds);
  return exportPDFRaster(selectedLayerIds, resolution, format);
}

// Export vectoriel : annotations ajoutées au PDF d'origine, qui conserve
// son vectoriel, son texte recherchable et sa taille de fichier.
const VECTOR_MAX_BYTES = 200 * 1024 * 1024;

async function exportPDFVectorial(selectedLayerIds) {
  if (!App.pdfBlob) {
    showError('Le PDF d’origine n’est plus disponible : utilisez l’export rastérisé.');
    return;
  }
  if (App.pdfBlob.size > VECTOR_MAX_BYTES) {
    showError('PDF trop volumineux pour l’export vectoriel — choisissez « Rastérisé ».');
    return;
  }

  setProgress('Export vectoriel : préparation…');
  saveCurrentPageObjects();
  try {
    const bytes = await exportPdfVector(selectedLayerIds, (pn, total) =>
      setProgress(`Export vectoriel : page ${pn} / ${total}…`));
    const base = (App.pdfInfo?.fileName || 'plan').replace(/\.pdf$/i, '');
    downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${base}-annote.pdf`);
    showToast('Export vectoriel terminé ✓');
  } catch (err) {
    console.error(err);
    showError(`Export vectoriel impossible : ${describeError(err)}. ` +
              `Réessayez en mode « Rastérisé ».`);
  } finally {
    clearProgress();
  }
}

async function exportPDFRaster(selectedLayerIds, resolution, format = 'original') {
  setProgress('Export : préparation…');

  const { jsPDF } = window.jspdf;
  const fc        = App.canvas;
  const dpiMult   = parseFloat(resolution) || 2;
  const paperFmt  = PAPER_FORMATS[format] || null; // null = format original

  saveCurrentPageObjects();

  // Canvas Fabric hors-écran pour les annotations (fond transparent)
  const tmpEl = document.createElement('canvas');
  tmpEl.id    = '__export_tmp__';
  tmpEl.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;';
  document.body.appendChild(tmpEl);
  const tmpFc = new fabric.Canvas('__export_tmp__', { enableRetinaScaling: false });

  // Résolution pixel des formats papier (l'image rastérisée), puis conversion
  // des dimensions de page en points pour jsPDF.
  const PRINT_DPI = 150;
  const MM_TO_PX  = PRINT_DPI / 25.4;
  const MM_TO_PT  = 72 / 25.4;

  let doc = null;

  try {
    for (let pn = 1; pn <= App.totalPages; pn++) {
      setProgress(`Export : page ${pn} / ${App.totalPages}…`);
      const pdfPage   = await App.pdfDoc.getPage(pn);
      const rotation  = App.pageData[pn]?.rotation || 0;
      const vp0       = pdfPage.getViewport({ scale: 1, rotation });

      // Résolution d'export : les objets sont en points PDF, on rend donc la
      // page à `dpiMult` × 72 dpi et on applique le MÊME facteur aux annotations.
      // La v1.1 multipliait par le renderScale de l'affichage : une page jamais
      // ouverte s'exportait à une échelle arbitraire.
      const exportScale = dpiMult;
      const vp          = pdfPage.getViewport({ scale: exportScale, rotation });
      const W = Math.round(vp.width);
      const H = Math.round(vp.height);

      // 1. Rendre la page PDF dans un canvas 2D à l'échelle export
      const pdfCanvas     = document.createElement('canvas');
      pdfCanvas.width     = W;
      pdfCanvas.height    = H;
      await pdfPage.render({ canvasContext: pdfCanvas.getContext('2d'), viewport: vp }).promise;

      // 2. Canvas Fabric : annotations seules, fond transparent
      //    clear() vide les objets ET met backgroundColor = '' (transparent)
      tmpFc.setDimensions({ width: W, height: H });
      tmpFc.clear();
      tmpFc.backgroundColor = '';

      const objects = (App.pageData[pn]?.objects || []).filter(
        o => selectedLayerIds.includes(o.data?.layerId)
      );

      if (objects.length > 0) {
        await new Promise(resolve => {
          fabric.util.enlivenObjects(objects, fabricObjs => {
            fabricObjs.forEach(o => tmpFc.add(o));
            resolve();
          });
        });
      }

      // Les objets sont en points PDF, origine = coin haut-gauche de la page :
      // une simple homothétie suffit, sans offset de centrage à compenser.
      tmpFc.setViewportTransform([exportScale, 0, 0, exportScale, 0, 0]);
      tmpFc.renderAll(); // synchrone — garanti sur canvas hors-écran

      // 3. Composite : PDF (fond) + annotations par-dessus, canvas 2D natif
      const composite    = document.createElement('canvas');
      composite.width    = W;
      composite.height   = H;
      const ctx          = composite.getContext('2d');
      ctx.drawImage(pdfCanvas, 0, 0);           // page PDF rendue
      ctx.drawImage(tmpFc.lowerCanvasEl, 0, 0); // annotations (fond transparent)

      // 4. Mise à l'échelle format papier (espace pixel, 150 DPI)
      //    Tout se fait ici — pas de conversion mm dans jsPDF
      let finalCanvas;
      if (paperFmt) {
        const isLand = W > H;
        // Dimensions du papier en pixels à 150 DPI (orientation selon ratio de la page)
        const pw = Math.round((isLand ? paperFmt.h : paperFmt.w) * MM_TO_PX);
        const ph = Math.round((isLand ? paperFmt.w : paperFmt.h) * MM_TO_PX);

        // Adapter l'image au papier (ratio conservé, centré, fond blanc)
        const scale = Math.min(pw / W, ph / H);
        const sw    = Math.round(W * scale);
        const sh    = Math.round(H * scale);
        const ox    = Math.round((pw - sw) / 2);
        const oy    = Math.round((ph - sh) / 2);

        finalCanvas           = document.createElement('canvas');
        finalCanvas.width     = pw;
        finalCanvas.height    = ph;
        const fCtx            = finalCanvas.getContext('2d');
        fCtx.fillStyle        = 'white';
        fCtx.fillRect(0, 0, pw, ph);
        fCtx.drawImage(composite, ox, oy, sw, sh);
      } else {
        finalCanvas = composite; // format original = dimensions pixel natives
      }

      // 5. Ajouter la page au PDF, DIMENSIONNÉE EN POINTS.
      //    La v1.1 utilisait `unit: 'px'`, que jsPDF interprète à 96 dpi : la
      //    page exportée n'avait aucun rapport de taille avec le plan source,
      //    ce qui rendait toute impression à l'échelle impossible.
      const FW = finalCanvas.width;
      const FH = finalCanvas.height;
      const ptW = paperFmt
        ? (FW > FH ? paperFmt.h : paperFmt.w) * MM_TO_PT   // format papier demandé
        : vp0.width;                                       // taille native de la page
      const ptH = paperFmt
        ? (FW > FH ? paperFmt.w : paperFmt.h) * MM_TO_PT
        : vp0.height;

      const orient = ptW > ptH ? 'l' : 'p';
      const imgURL = finalCanvas.toDataURL('image/jpeg', 0.93);

      if (!doc) {
        doc = new jsPDF({ orientation: orient, unit: 'pt', format: [ptW, ptH], compress: true });
      } else {
        doc.addPage([ptW, ptH], orient);
      }
      doc.addImage(imgURL, 'JPEG', 0, 0, ptW, ptH);
    }

    if (doc) {
      const base = (App.pdfInfo?.fileName || 'plan').replace(/\.pdf$/i, '');
      doc.save(`${base}-annote.pdf`);
      showToast('Export terminé ✓');
    }
  } catch (err) {
    console.error(err);
    showError(`Export impossible : ${describeError(err)}. ` +
              `Essayez une résolution plus basse si le plan est très grand.`);
  } finally {
    clearProgress();
    tmpFc.dispose();
    tmpEl.remove();
  }
}

// ============================================================
// HISTORIQUE (UNDO)
// ============================================================
// ------------------------------------------------------------
// Historique par page, avec rétablissement.
// La v1.1 avait une pile globale pour des instantanés par page : après un
// changement de page, annuler décrémentait l'index sans rien restaurer.
// Il n'y avait ni instantané initial (la 1re action n'était pas annulable),
// ni rétablissement, et le curseur d'opacité saturait la pile de 30 entrées.
// ------------------------------------------------------------
const HISTORY_LIMIT = 50;

function pageHistory(pageNum = App.currentPage) {
  if (!App.history[pageNum]) App.history[pageNum] = { stack: [], index: -1 };
  return App.history[pageNum];
}

// Instantané complet : objets ET état des calques, pour que l'ajout, la
// suppression ou le renommage d'un calque soient annulables comme le reste.
function currentSnapshot() {
  return JSON.stringify({
    objects:       App.pageData[App.currentPage]?.objects || [],
    layers:        App.layers,
    activeLayerId: App.activeLayerId,
  });
}

function saveHistoryState() {
  if (!App.pageData[App.currentPage] || App._restoringHistory) return;
  saveCurrentPageObjects();
  markDirty();

  const h    = pageHistory();
  const snap = currentSnapshot();
  if (h.stack[h.index] === snap) return;         // rien n'a changé

  h.stack.length = h.index + 1;                  // tronquer la branche annulée
  h.stack.push(snap);
  if (h.stack.length > HISTORY_LIMIT) h.stack.shift();
  h.index = h.stack.length - 1;
  updateHistoryButtons();
}

// Instantané de départ, posé à l'ouverture d'une page : sans lui la première
// action de la page ne pouvait pas être annulée.
function seedHistory() {
  const h = pageHistory();
  if (h.stack.length) return;
  h.stack = [currentSnapshot()];
  h.index = 0;
  updateHistoryButtons();
}

function applySnapshot(json) {
  const snap = JSON.parse(json);
  App._restoringHistory = true;
  try {
    App.pageData[App.currentPage].objects = snap.objects;
    App.layers        = (snap.layers || []).map(l => ({ ...l }));
    App.activeLayerId = snap.activeLayerId ?? App.layers[0]?.id ?? null;
    renderLayersList();
    loadPageObjects();
  } finally {
    App._restoringHistory = false;
  }
  markDirty();
  updateHistoryButtons();
}

function undo() {
  const h = pageHistory();
  if (h.index <= 0) { showToast('Rien à annuler sur cette page'); return; }
  h.index--;
  applySnapshot(h.stack[h.index]);
}

function redo() {
  const h = pageHistory();
  if (h.index >= h.stack.length - 1) { showToast('Rien à rétablir'); return; }
  h.index++;
  applySnapshot(h.stack[h.index]);
}

function updateHistoryButtons() {
  const h = App.history[App.currentPage] || { stack: [], index: -1 };
  const u = document.getElementById('btn-undo');
  const r = document.getElementById('btn-redo');
  if (u) u.disabled = h.index <= 0;
  if (r) r.disabled = h.index >= h.stack.length - 1;
}

// ============================================================
// RÉINITIALISATION ÉTAT DE DESSIN
// ============================================================
function resetDrawState() {
  const fc = App.canvas;
  if (App.draw.tempObj)     { fc.remove(App.draw.tempObj); }
  cleanupDimPreview();
  removeDimHandles();
  removePolyHandles();
  snapMarker = null;
  invalidateSnapCache();
  // Supprimer tous les objets temporaires restants (previews, segments intermédiaires,
  // marqueurs). Balisés par data.temp : les calques verrouillés ne sont plus touchés.
  removeTempObjects();

  App.draw = {
    active: false, startPt: null, tempObj: null,
    points: [], previewLine: null, previewText: null, step: 0,
    dimP1: null, dimP2: null, dimPreviewObjs: null, dimDot1: null, dimDot2: null,
    closingLine: null,
  };
  hideIndicator('calib-indicator');
  hideIndicator('measure-indicator');
  fc.requestRenderAll();
}

// ============================================================
// TOOLBAR — Sélection des outils et raccourcis
// ============================================================
function initToolbar() {
  // Boutons outils
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => setActiveTool(btn.dataset.tool));
  });

  // Zoom
  document.getElementById('btn-zoom-in') .addEventListener('click', () => changeZoom(1.25));
  document.getElementById('btn-zoom-out').addEventListener('click', () => changeZoom(0.8));
  document.getElementById('btn-zoom-fit').addEventListener('click', fitToWindow);
  document.getElementById('btn-zoom-100')?.addEventListener('click', zoomToActualSize);

  // Fichiers
  document.getElementById('btn-open-pdf').addEventListener('click', () => document.getElementById('input-pdf').click());
  document.getElementById('input-pdf').addEventListener('change', (e) => {
    if (e.target.files[0]) loadPDF(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('btn-save-project').addEventListener('click', () => {
    document.getElementById('projet-dropdown').classList.remove('open');
    saveProject();
  });
  document.getElementById('btn-load-project').addEventListener('click', () => {
    document.getElementById('projet-dropdown').classList.remove('open');
    document.getElementById('input-project').click();
  });
  document.getElementById('btn-projet').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('projet-dropdown').classList.toggle('open');
  });
  document.addEventListener('click', () => {
    document.getElementById('projet-dropdown')?.classList.remove('open');
  });
  document.getElementById('input-project').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => loadProject(ev.target.result);
    reader.readAsText(f);
    e.target.value = '';
  });

  // Import SVG/image personnalisé
  document.getElementById('input-custom-svg').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (f.name.endsWith('.svg')) {
      const reader = new FileReader();
      reader.onload = ev => {
        const fc  = App.canvas;
        const vpt = fc.viewportTransform;
        const cx  = (fc.width  / 2 - vpt[4]) / vpt[0];
        const cy  = (fc.height / 2 - vpt[5]) / vpt[3];
        fabric.loadSVGFromString(ev.target.result, (objects, options) => {
          const grp = fabric.util.groupSVGElements(objects, options);
          grp.scaleToWidth(150);
          grp.set({ left: cx, top: cy, data: { layerId: App.activeLayerId, pageNum: App.currentPage } });
          applyLayerPropsToObj(grp);
          fc.add(grp); fc.setActiveObject(grp); fc.requestRenderAll();
          saveHistoryState();
        });
      };
      reader.readAsText(f);
    } else {
      // Image raster
      const url = URL.createObjectURL(f);
      fabric.Image.fromURL(url, (img) => {
        img.scaleToWidth(150);
        img.set({ data: { layerId: App.activeLayerId, pageNum: App.currentPage } });
        applyLayerPropsToObj(img);
        App.canvas.add(img);
        App.canvas.setActiveObject(img);
        App.canvas.requestRenderAll();
        saveHistoryState();
        URL.revokeObjectURL(url);
      });
    }
    e.target.value = '';
  });

  // Glisser-déposer d'un PDF sur la zone de travail
  const wrapper = document.getElementById('canvas-wrapper');
  ['dragenter', 'dragover'].forEach(ev =>
    wrapper.addEventListener(ev, (e) => {
      if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
      e.preventDefault();
      wrapper.classList.add('drag-over');
    }));
  wrapper.addEventListener('dragleave', (e) => {
    if (e.target === wrapper) wrapper.classList.remove('drag-over');
  });
  wrapper.addEventListener('drop', (e) => {
    wrapper.classList.remove('drag-over');
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;                       // sinon : drop de symbole, déjà géré
    e.preventDefault();
    if (/\.pdf$/i.test(f.name))                 loadPDF(f);
    else if (/\.json$/i.test(f.name))           f.text().then(loadProject);
    else showToast('Format non reconnu (PDF ou projet .json attendu)');
  });

  // Import d'un symbole personnalisé (le champ existait mais n'était ouvert par rien)
  document.getElementById('btn-import-symbol')?.addEventListener('click', () => {
    if (!requireDocument()) return;
    document.getElementById('input-custom-svg').click();
  });

  // Export
  document.getElementById('btn-export').addEventListener('click', openExportModal);

  // Undo / Supprimer
  document.getElementById('btn-undo')  .addEventListener('click', undo);
  document.getElementById('btn-redo')  .addEventListener('click', redo);
  document.getElementById('btn-front')?.addEventListener('click', () => changeZOrder('front'));
  document.getElementById('btn-back') ?.addEventListener('click', () => changeZOrder('back'));
  document.getElementById('btn-help') ?.addEventListener('click', openHelp);
  document.getElementById('btn-area')  ?.addEventListener('click', () => {
    const sel = App.canvas.getActiveObject();
    if (sel) addAreaLabel(sel); else showToast('Sélectionnez une forme fermée');
  });
  document.getElementById('btn-measures')?.addEventListener('click', openMeasuresModal);
  document.getElementById('btn-measures-2')?.addEventListener('click', openMeasuresModal);
  document.getElementById('measures-csv')?.addEventListener('click', exportMeasuresCSV);
  document.getElementById('measures-close')?.addEventListener('click', () =>
    closeModal(document.getElementById('modal-measures')));
  document.getElementById('count-category')?.addEventListener('input', updateCountBadge);
  document.getElementById('stamp-list')?.addEventListener('click', (e) => {
    const id = e.target.closest('[data-stamp]')?.dataset.stamp;
    if (id) placeStamp(id);
  });
  document.getElementById('btn-delete').addEventListener('click', deleteSelected);

  // Champs L/H dans le header — Entrée ou blur pour appliquer
  ['dim-w', 'dim-h'].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyDimChange(); } });
    el.addEventListener('blur', applyDimChange);
  });
}

function setActiveTool(toolName) {
  const fc = App.canvas;

  // Désactiver l'ancien outil
  if (App.activeTool === 'freedraw') {
    fc.isDrawingMode = false;
    fc.off('path:created');
  }
  resetDrawState();

  App.activeTool = toolName;

  // Mettre à jour les boutons
  document.querySelectorAll('.tool-btn[data-tool]').forEach(b => {
    const on = b.dataset.tool === toolName;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });

  // Configurer le canvas
  fc.isDrawingMode = false;
  fc.selection     = toolName === 'select';
  fc.defaultCursor = ['select','pan'].includes(toolName) ? (toolName === 'pan' ? 'grab' : 'default') : 'crosshair';

  if (toolName === 'freedraw') toolFreeDraw_activate();
  if (toolName === 'text') fc.defaultCursor = 'text';
}

function changeZoom(factor) {
  const fc  = App.canvas;
  const oz  = fc.getZoom();
  const nz  = Math.max(0.05, Math.min(20, oz * factor));
  const cx  = fc.width  / 2;
  const cy  = fc.height / 2;
  fc.zoomToPoint({ x: cx, y: cy }, nz);
  updateZoomDisplay();
  scheduleBackgroundRefresh();
}

// ============================================================
// COPIER / COUPER / COLLER / DUPLIQUER
// ============================================================
function copySelected() {
  const objs = App.canvas.getActiveObjects();
  if (!objs.length) return;
  App.clipboard = {
    objects: objs.map(o => o.toObject(['data'])),
    pageNum: App.currentPage,
  };
  showToast(`${objs.length} objet(s) copié(s)`);
}

function cutSelected() {
  copySelected();
  deleteSelected();
}

function pasteClipboard() {
  if (!App.clipboard?.objects?.length) { showToast('Presse-papiers vide'); return; }
  ensureActiveLayer();
  const fc = App.canvas;
  fc.discardActiveObject();
  const offset = 20;
  fabric.util.enlivenObjects(App.clipboard.objects, (fabricObjs) => {
    fabricObjs.forEach(o => {
      o.set({
        left: (o.left || 0) + offset,
        top:  (o.top  || 0) + offset,
        data: { ...o.data, layerId: App.activeLayerId, pageNum: App.currentPage },
      });
      fc.add(o);
    });
    if (fabricObjs.length === 1) {
      fc.setActiveObject(fabricObjs[0]);
    } else if (fabricObjs.length > 1) {
      const sel = new fabric.ActiveSelection(fabricObjs, { canvas: fc });
      fc.setActiveObject(sel);
    }
    fc.requestRenderAll();
    saveHistoryState();
  });
}

function duplicateSelected() {
  const objs = App.canvas.getActiveObjects();
  if (!objs.length) return;
  App.clipboard = { objects: objs.map(o => o.toObject(['data'])), pageNum: App.currentPage };
  pasteClipboard();
}

// Ajuste le zoom/pan pour que la page entière tienne dans la fenêtre.
// Seul le viewportTransform bouge : les coordonnées des objets sont intactes.
function fitToWindow() {
  if (!App.pdfDoc) return;
  const pd = App.pageData[App.currentPage];
  if (!pd?.pageW) return;
  const fc    = App.canvas;
  const scale = Math.min(fc.width / pd.pageW, fc.height / pd.pageH) * 0.95;
  const tx    = (fc.width  - pd.pageW * scale) / 2;
  const ty    = (fc.height - pd.pageH * scale) / 2;
  fc.setViewportTransform([scale, 0, 0, scale, tx, ty]);
  updateZoomDisplay();
  scheduleBackgroundRefresh();
}

// Zoom à 100 % = 1 point écran par point PDF (taille réelle à 72 dpi)
function zoomToActualSize() {
  const fc = App.canvas;
  fc.zoomToPoint({ x: fc.width / 2, y: fc.height / 2 }, 1);
  updateZoomDisplay();
  scheduleBackgroundRefresh();
}

function updateZoomDisplay() {
  const z = App.canvas.getZoom();
  document.getElementById('zoom-display').textContent = `${Math.round(z * 100)}%`;
}

// ============================================================
// ORDRE D'EMPILEMENT (v1.4)
// ============================================================
function changeZOrder(action) {
  const fc   = App.canvas;
  const objs = fc.getActiveObjects().filter(o => !isTempObject(o));
  if (!objs.length) { showToast('Sélectionnez d’abord un objet'); return; }
  // L'image de fond n'est pas dans getObjects() : elle reste toujours derrière.
  objs.forEach(o => {
    if      (action === 'front')    fc.bringToFront(o);
    else if (action === 'back')     fc.sendToBack(o);
    else if (action === 'forward')  fc.bringForward(o);
    else if (action === 'backward') fc.sendBackwards(o);
  });
  fc.requestRenderAll();
  saveHistoryState();
}

// ============================================================
// AIDE — RACCOURCIS CLAVIER
// ------------------------------------------------------------
// La liste est construite à partir de TOOL_SHORTCUTS, la table réellement
// utilisée par le gestionnaire clavier : impossible qu'elle dérive de
// l'implémentation (l'infobulle annonçait « Espace » pour un raccourci « H »).
// ============================================================
const TOOL_SHORTCUTS = {
  v: 'select', h: 'pan', l: 'line', p: 'polyline', g: 'polygon', r: 'rect',
  c: 'circle', f: 'freedraw', n: 'cloud', t: 'text', m: 'measure', k: 'calibrate',
  x: 'count', a: 'leader',
};

const TOOL_LABELS = {
  select: 'Sélection', pan: 'Déplacer la vue', line: 'Ligne', polyline: 'Polyligne',
  polygon: 'Polygone', rect: 'Rectangle', circle: 'Cercle / ellipse',
  freedraw: 'Dessin libre', cloud: 'Nuage de révision', text: 'Texte',
  measure: 'Cote / mesure', calibrate: 'Calibrer la page',
  count: 'Compter (clic par élément)', leader: 'Bulle de renvoi',
};

const OTHER_SHORTCUTS = [
  ['Édition', [
    ['Ctrl + Z',        'Annuler'],
    ['Ctrl + Maj + Z / Ctrl + Y', 'Rétablir'],
    ['Ctrl + C / X / V', 'Copier / couper / coller'],
    ['Ctrl + D',        'Dupliquer'],
    ['Ctrl + A',        'Tout sélectionner'],
    ['Suppr',           'Supprimer la sélection'],
    ['Échap',           'Annuler le tracé en cours / fermer une fenêtre'],
  ]],
  ['Empilement', [
    ['Ctrl + ⇧ Début',  'Mettre au premier plan'],
    ['Ctrl + ⇧ Fin',    'Mettre à l’arrière-plan'],
    ['Ctrl + ]',        'Avancer d’un rang'],
    ['Ctrl + [',        'Reculer d’un rang'],
  ]],
  ['Navigation et vue', [
    ['Page ↑ / Page ↓', 'Page précédente / suivante'],
    ['0',               'Ajuster à la fenêtre'],
    ['1',               'Taille réelle (100 %)'],
    ['Molette',         'Zoomer'],
    ['Espace (maintenu)', 'Déplacer la vue'],
    ['Clic molette',    'Déplacer la vue'],
  ]],
  ['Tracé', [
    ['Maj (maintenu)',  'Contraindre l’angle à 45°'],
    ['Double-clic',     'Terminer une polyligne / fermer un polygone'],
  ]],
  ['Relevé', [
    ['S',               'Surface et périmètre de la forme sélectionnée'],
    ['Ctrl + M',        'Récapitulatif des mesures'],
  ]],
];

function buildShortcutsHelp() {
  const body = document.getElementById('help-body');
  if (!body || body.dataset.built) return;
  body.dataset.built = '1';

  const section = (title, rows) => {
    const h = document.createElement('div');
    h.className = 'help-section';
    h.innerHTML = `<h3>${title}</h3>`;
    const dl = document.createElement('dl');
    rows.forEach(([k, d]) => {
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = d;
      dl.append(dt, dd);
    });
    h.appendChild(dl);
    return h;
  };

  const outils = Object.entries(TOOL_SHORTCUTS)
    .map(([key, tool]) => [key.toUpperCase(), TOOL_LABELS[tool] || tool]);
  body.appendChild(section('Outils', outils));
  OTHER_SHORTCUTS.forEach(([t, rows]) => body.appendChild(section(t, rows)));
}

function openHelp() {
  buildShortcutsHelp();
  openModal('modal-help');
}

function deleteSelected() {
  const fc  = App.canvas;
  const sel = fc.getActiveObjects();
  if (!sel.length) return;
  sel.forEach(o => fc.remove(o));
  fc.discardActiveObject();
  fc.requestRenderAll();
  saveHistoryState();
}

// ============================================================
// PANNEAU PROPRIÉTÉS — Mise à jour depuis la sélection
// ============================================================
function updatePropsFromSelection() {
  const fc  = App.canvas;
  const sel = fc.getActiveObject();
  if (!sel) return;

  // Couleur de contour
  const stroke = sel.stroke;
  if (stroke) {
    document.getElementById('prop-stroke-color').value = rgbToHex(stroke) || '#e53e3e';
    App.toolProps.strokeColor = stroke;
  }
  if (sel.strokeWidth !== undefined) {
    document.getElementById('prop-stroke-width').value = sel.strokeWidth;
  }

  // Remplissage
  const fill = sel.fill;
  const fillMode = document.getElementById('prop-fill-mode');
  const fillColor = document.getElementById('prop-fill-color');
  if (fill && fill !== 'transparent' && fill !== '' && fill !== 'rgba(0,0,0,0)') {
    fillMode.value  = 'solid';
    fillColor.value = rgbToHex(fill) || '#ffffff';
    App.toolProps.fillColor = fill;
  } else {
    fillMode.value = 'transparent';
  }

  // Opacité
  const op = Math.round((sel.opacity || 1) * 100);
  document.getElementById('prop-opacity').value          = op;
  document.getElementById('prop-opacity-val').textContent = op;

  // Tirets
  const dash = sel.strokeDashArray;
  const dashSel = document.getElementById('prop-dash');
  if (!dash || !dash.length)   dashSel.value = 'solid';
  else if (dash[0] === 2)      dashSel.value = 'dotted';
  else                         dashSel.value = 'dashed';

  // Taille de police (textes)
  if (sel.fontSize !== undefined) {
    document.getElementById('prop-font-size').value = sel.fontSize;
    App.toolProps.fontSize = sel.fontSize;
  }

  // Couleur de texte
  if (sel.type === 'textbox' || sel.type === 'i-text' || sel.type === 'text') {
    const fc = sel.fill;
    if (fc) document.getElementById('prop-text-color').value = rgbToHex(fc) || '#000000';
  }

  // Mettre à jour l'affichage L/H dans le header
  updateDimDisplay(sel);
}

// ============================================================
// SIDEBAR — Onglets et panneau propriétés
// ============================================================
function initSidebar() {
  // Onglets
  const tabs = [...document.querySelectorAll('.sidebar-tab')];
  const selectTab = (tab) => {
    tabs.forEach(t => {
      const on = t === tab;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(`panel-${t.dataset.panel}`)?.classList.toggle('active', on);
    });
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => selectTab(tab));
    // Navigation clavier conforme au motif ARIA « tablist »
    tab.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      selectTab(next); next.focus();
    });
  });
  selectTab(tabs[0]);

  // Contrôles de style
  // Les contrôles continus (couleurs, opacité) appliquent en direct sur `input`
  // mais n'enregistrent dans l'historique que sur `change` : en v1.1 un seul
  // glissement du curseur d'opacité saturait la pile et détruisait l'historique.
  bindStyleControl('prop-stroke-color', 'input', (v) => {
    App.toolProps.strokeColor = v;
    applyToSelection({ stroke: v }, false);
    if (App.activeTool === 'freedraw') App.canvas.freeDrawingBrush.color = v;
  });
  bindStyleControl('prop-fill-color', 'input', (v) => {
    App.toolProps.fillColor = v;
    if (document.getElementById('prop-fill-mode').value === 'solid')
      applyToSelection({ fill: v }, false);
  });
  bindStyleControl('prop-text-color', 'input', (v) => {
    App.toolProps.fontColor = v;
    applyToSelection({ fill: v }, false);
  });
  bindStyleControl('prop-opacity', 'input', (v) => {
    const op = parseInt(v, 10) / 100;
    App.toolProps.opacity = op;
    document.getElementById('prop-opacity-val').textContent = v;
    applyToSelection({ opacity: op }, false);
  });

  document.getElementById('prop-stroke-width').addEventListener('change', (e) => {
    const w = Math.max(0.1, parseFloat(e.target.value) || 2);
    e.target.value = w;
    App.toolProps.strokeWidth = w;
    applyToSelection({ strokeWidth: w });
    if (App.activeTool === 'freedraw') App.canvas.freeDrawingBrush.width = w;
  });
  document.getElementById('prop-fill-mode').addEventListener('change', (e) => {
    const fill = e.target.value === 'transparent' ? 'transparent' : document.getElementById('prop-fill-color').value;
    App.toolProps.fillColor = fill;
    applyToSelection({ fill });
  });
  document.getElementById('prop-dash').addEventListener('change', (e) => {
    const map = { solid: null, dashed: [8, 4], dotted: [2, 4] };
    App.toolProps.dashArray = map[e.target.value];
    applyToSelection({ strokeDashArray: map[e.target.value] });
  });
  document.getElementById('prop-font-size').addEventListener('change', (e) => {
    App.toolProps.fontSize = Math.max(1, parseInt(e.target.value, 10) || 16);
    e.target.value = App.toolProps.fontSize;
    applyToSelection({ fontSize: App.toolProps.fontSize });
  });

  // Couleur des tracés des symboles
  document.getElementById('symbol-color').addEventListener('input', (e) => {
    App.symbolColor = e.target.value;
    recolorSelectedSymbol(e.target.value);
  });
  document.getElementById('symbol-color-reset').addEventListener('click', () => {
    App.symbolColor = '#000000';
    document.getElementById('symbol-color').value = '#000000';
    recolorSelectedSymbol('#000000');
  });

  // Nouveau calque
  document.getElementById('btn-add-layer').addEventListener('click', () => {
    const name = `Calque ${App.nextLayerId}`;
    const id = addLayer(name);
    setActiveLayer(id);
  });

  // Calibration par échelle
  document.getElementById('btn-calib-scale').addEventListener('click', () => {
    openModal('modal-calib-scale');
  });
}

// Applique un jeu de propriétés à la sélection.
// `history = false` pour les contrôles continus : l'enregistrement se fait
// alors une seule fois, au relâchement (événement `change`).
// Remet le panneau Style en accord avec les réglages d'outil courants
function syncPropsPanelFromTool() {
  const tp = App.toolProps;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('prop-stroke-color', rgbToHex(tp.strokeColor) || '#e53e3e');
  set('prop-stroke-width', tp.strokeWidth);
  set('prop-font-size',    tp.fontSize);
  set('prop-text-color',   rgbToHex(tp.fontColor) || '#000000');
  set('prop-opacity',      Math.round(tp.opacity * 100));
  const val = document.getElementById('prop-opacity-val');
  if (val) val.textContent = Math.round(tp.opacity * 100);
  set('prop-fill-mode', isTransparentFill(tp.fillColor) ? 'transparent' : 'solid');
  if (!isTransparentFill(tp.fillColor)) set('prop-fill-color', rgbToHex(tp.fillColor) || '#ff0000');
  const dash = tp.dashArray;
  set('prop-dash', !dash ? 'solid' : (dash[0] === 2 ? 'dotted' : 'dashed'));
}

function applyToSelection(props, history = true) {
  const fc  = App.canvas;
  const sel = fc.getActiveObjects();
  if (!sel.length) return;
  sel.forEach(obj => {
    obj.set(props);
    if ('fill' in props) obj.set('perPixelTargetFind', isTransparentFill(props.fill));
    obj.setCoords();
  });
  fc.requestRenderAll();
  if (history) saveHistoryState();
}

// Associe un contrôle continu : application immédiate sur `input`,
// enregistrement dans l'historique une seule fois sur `change`.
function bindStyleControl(id, liveEvent, apply) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener(liveEvent, (e) => apply(e.target.value));
  el.addEventListener('change', (e) => { apply(e.target.value); saveHistoryState(); });
}

// ============================================================
// MODALES
// ============================================================
function initModals() {
  // --- Modal calibration par segment ---
  document.getElementById('calib-cancel').addEventListener('click', () => {
    closeModal(document.getElementById('modal-calib'));
    App._pendingCalibPixels = null;
  });
  document.getElementById('calib-confirm').addEventListener('click', () => {
    const realDist = parseFloat(document.getElementById('calib-real-dist').value);
    const unit     = document.getElementById('calib-unit').value;
    if (!realDist || realDist <= 0) { showToast('Saisir une distance valide'); return; }
    const pointsPerUnit = App._pendingCalibPixels / realDist;
    closeModal(document.getElementById('modal-calib'));
    setPageCalibration(pointsPerUnit, unit);
    App._pendingCalibPixels = null;
    // Revenir à l'outil select
    setActiveTool('select');
  });

  // --- Modal calibration par échelle ---
  document.getElementById('scale-preset').addEventListener('change', (e) => {
    document.getElementById('custom-scale-label').style.display =
      e.target.value === 'custom' ? '' : 'none';
  });
  document.getElementById('scale-cancel').addEventListener('click', () => {
    closeModal(document.getElementById('modal-calib-scale'));
  });
  document.getElementById('scale-confirm').addEventListener('click', () => {
    const preset     = document.getElementById('scale-preset').value;
    const customVal  = document.getElementById('scale-custom').value;
    const unit       = document.getElementById('scale-unit').value;
    const denominator = preset === 'custom' ? parseFloat(customVal) : parseFloat(preset);
    if (!denominator || denominator <= 0) { showToast('Sélectionner ou saisir une échelle valide'); return; }
    if (!App.pageData[App.currentPage]) return;

    // Conversion purement géométrique (geometry.js), sans aucune dépendance à
    // l'affichage — en v1.1 elle passait par renderScale et devenait fausse
    // dès que la fenêtre changeait de taille.
    let pointsPerUnit;
    try {
      pointsPerUnit = scaleToPointsPerUnit(denominator, unit);
    } catch (err) {
      showError(describeError(err)); return;
    }

    closeModal(document.getElementById('modal-calib-scale'));
    setPageCalibration(pointsPerUnit, unit);
    if (document.getElementById('calib-all-pages')?.checked) applyCalibrationToAllPages();
  });

  // --- Modal export ---
  document.getElementById('export-mode')?.addEventListener('change', (e) => {
    const raster = e.target.value === 'raster';
    document.getElementById('raster-options').style.display = raster ? '' : 'none';
    document.getElementById('export-hint').textContent = raster
      ? "Le mode rastérisé aplatit le plan en image : compatible partout, mais le texte du plan n'est plus sélectionnable et le fichier est nettement plus lourd."
      : "Le mode vectoriel ajoute les annotations au PDF d'origine : le plan garde sa qualité, son texte reste sélectionnable et le fichier reste léger.";
  });

  document.getElementById('export-cancel').addEventListener('click', () => {
    closeModal(document.getElementById('modal-export'));
  });
  document.getElementById('export-confirm').addEventListener('click', () => {
    const checkboxes = document.querySelectorAll('#export-layers-list input[type=checkbox]:checked');
    const selectedIds = Array.from(checkboxes).map(cb => parseInt(cb.value));
    const resolution  = document.getElementById('export-resolution').value;
    const format      = document.getElementById('export-format').value;
    const mode        = document.getElementById('export-mode').value;
    const total       = document.querySelectorAll('#export-layers-list input[type=checkbox]').length;
    if (total > 0 && selectedIds.length === 0 &&
        !confirm('Aucun calque sélectionné : le PDF exporté ne contiendra aucune annotation.\n\nContinuer ?')) {
      return;
    }
    closeModal(document.getElementById('modal-export'));
    exportPDF(selectedIds, resolution, format, mode);
  });

  // --- Modal renommer calque ---
  document.getElementById('rename-layer-cancel').addEventListener('click', () => {
    closeModal(document.getElementById('modal-rename-layer'));
  });
  document.getElementById('rename-layer-confirm').addEventListener('click', () => {
    const id    = parseInt(document.getElementById('modal-rename-layer').dataset.layerId);
    const name  = document.getElementById('rename-layer-input').value.trim();
    if (name) renameLayer(id, name);
    closeModal(document.getElementById('modal-rename-layer'));
  });
  document.getElementById('help-close')?.addEventListener('click', () =>
    closeModal(document.getElementById('modal-help')));

  document.getElementById('rename-layer-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('rename-layer-confirm').click();
  });

  // Fermer les modales en cliquant le backdrop
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal(backdrop);
    });
  });
}

// Fermeture d'une modale : annule aussi l'opération en attente le cas échéant
function closeModal(modal) {
  modal.classList.remove('open');
  if (modal.id === 'modal-calib') App._pendingCalibPixels = null;
  if (App._modalReturnFocus) { App._modalReturnFocus.focus?.(); App._modalReturnFocus = null; }
}

function openModal(id) {
  App._modalReturnFocus = document.activeElement;
  const modal = document.getElementById(id);
  modal.classList.add('open');
  // Focus sur le premier champ ou bouton utile
  setTimeout(() => {
    const first = modal.querySelector('input:not([type=hidden]), select, button.confirm');
    first?.focus();
    if (first?.select) first.select();
  }, 30);
}

function openRenameLayerModal(id, currentName) {
  const modal = document.getElementById('modal-rename-layer');
  modal.dataset.layerId = id;
  document.getElementById('rename-layer-input').value = currentName;
  openModal('modal-rename-layer');
}

function openExportModal() {
  if (!requireDocument()) return;
  saveCurrentPageObjects();

  const allLayers = App.layers;      // calques globaux au document

  const list = document.getElementById('export-layers-list');
  list.innerHTML = '';

  if (allLayers.length === 0) {
    list.innerHTML = '<p style="color:var(--text-muted);font-size:12px;padding:4px 0">Aucun calque</p>';
  } else {
    allLayers.forEach(layer => {
      const item  = document.createElement('div');
      item.className = 'layer-export-item';
      const label = document.createElement('label');
      const cb    = document.createElement('input');
      cb.type    = 'checkbox';
      cb.value   = layer.id;
      cb.checked = layer.visible;
      const dot  = document.createElement('span');
      dot.style.cssText = `display:inline-block;width:10px;height:10px;border-radius:50%;background:${layer.color};flex-shrink:0`;
      const txt  = document.createTextNode(layer.name);
      label.append(cb, dot, txt);
      item.appendChild(label);
      list.appendChild(item);
    });
  }
  openModal('modal-export');
}

// ============================================================
// RACCOURCIS CLAVIER
// ============================================================
function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Échap ferme la modale ouverte (avant toute autre logique : en v1.1 le
    // gestionnaire sortait immédiatement et Échap ne fermait donc rien)
    const openModal = document.querySelector('.modal-backdrop.open');
    if (openModal) {
      if (e.key === 'Escape') { e.preventDefault(); closeModal(openModal); }
      return;
    }
    if (document.activeElement?.tagName === 'INPUT'  ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.isContentEditable) return;

    const isCtrl = e.ctrlKey || e.metaKey;

    if (isCtrl && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      e.shiftKey ? redo() : undo();                 // Ctrl+Maj+Z = rétablir
      return;
    }
    if (isCtrl && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }
    if (isCtrl && e.key === 'c') { e.preventDefault(); copySelected(); return; }
    if (isCtrl && e.key === 'x') { e.preventDefault(); cutSelected(); return; }
    if (isCtrl && e.key === 'v') { e.preventDefault(); pasteClipboard(); return; }
    if (isCtrl && e.key === 'd') { e.preventDefault(); duplicateSelected(); return; }
    if (isCtrl && e.key === 'a') {
      e.preventDefault();
      const fc = App.canvas;
      const sel = new fabric.ActiveSelection(
        fc.getObjects().filter(o => o.selectable && o.evented && o.data?.type !== 'dimHandle' && o.data?.type !== 'polyHandle'),
        { canvas: fc }
      );
      fc.setActiveObject(sel);
      fc.requestRenderAll();
      return;
    }
    if (e.key === 'Escape') {
      resetDrawState();
      if (App.activeTool !== 'select') setActiveTool('select');
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(); return; }

    // Ordre d'empilement
    if (isCtrl && e.key === ']')    { e.preventDefault(); changeZOrder(e.shiftKey ? 'front' : 'forward');  return; }
    if (isCtrl && e.key === '[')    { e.preventDefault(); changeZOrder(e.shiftKey ? 'back'  : 'backward'); return; }
    if (isCtrl && e.key === 'Home') { e.preventDefault(); changeZOrder('front'); return; }
    if (isCtrl && e.key === 'End')  { e.preventDefault(); changeZOrder('back');  return; }

    // Relevé
    if (isCtrl && (e.key === 'm' || e.key === 'M')) { e.preventDefault(); openMeasuresModal(); return; }
    if (!isCtrl && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      const sel = App.canvas.getActiveObject();
      if (sel) addAreaLabel(sel); else showToast('Sélectionnez une forme fermée');
      return;
    }

    // Aide
    if (e.key === '?' || e.key === 'F1') { e.preventDefault(); openHelp(); return; }

    // Espace = toggle pan
    if (e.key === ' ') {
      e.preventDefault();
      App.isPanning = true;
      App.canvas.defaultCursor = 'grab';
      return;
    }

    // Raccourcis outils
    // Navigation entre pages (absente en v1.1 : seules les vignettes le permettaient)
    if (e.key === 'PageDown') { e.preventDefault(); switchPage(App.currentPage + 1); return; }
    if (e.key === 'PageUp')   { e.preventDefault(); switchPage(App.currentPage - 1); return; }
    if (e.key === '0') { e.preventDefault(); fitToWindow();      return; }
    if (e.key === '1') { e.preventDefault(); zoomToActualSize(); return; }

    if (!isCtrl && TOOL_SHORTCUTS[e.key]) setActiveTool(TOOL_SHORTCUTS[e.key]);
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === ' ') {
      App.isPanning = false;
      App.canvas.defaultCursor = App.activeTool === 'pan' ? 'grab' : (App.activeTool === 'select' ? 'default' : 'crosshair');
    }
  });
}

// ============================================================
// SAUVEGARDE AUTOMATIQUE (IndexedDB) ET REPRISE
// ------------------------------------------------------------
// En v1.1, fermer l'onglet perdait tout le travail. On conserve ici
// le projet ET le PDF source, pour une reprise sans re-sélection de fichier.
// ============================================================
const DB_NAME    = 'annoteur';
const DB_STORE   = 'sessions';
const AUTOSAVE_KEY   = 'last-session';
const AUTOSAVE_DELAY = 2000;            // ms après la dernière modification
const AUTOSAVE_MAX_PDF_BYTES = 200 * 1024 * 1024;

let autosaveTimer = null;
let autosaveDb    = null;

function openDb() {
  if (autosaveDb) return Promise.resolve(autosaveDb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => { autosaveDb = req.result; resolve(autosaveDb); };
    req.onerror   = () => reject(req.error);
  });
}

function dbPut(key, value) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
  }));
}

function dbGet(key) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx  = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  }));
}

function dbDelete(key) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(key);
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
  })).catch(() => {});
}

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(doAutosave, AUTOSAVE_DELAY);
}

async function doAutosave() {
  if (!App.pdfDoc) return;
  try {
    const record = {
      savedAt: Date.now(),
      project: buildProjectData(),
      // Le PDF lui-même, pour que la reprise ne demande pas de re-sélectionner le fichier
      pdfBlob: (App.pdfBlob && App.pdfBlob.size <= AUTOSAVE_MAX_PDF_BYTES) ? App.pdfBlob : null,
      fileName: App.pdfInfo?.fileName || 'document.pdf',
    };
    await dbPut(AUTOSAVE_KEY, record);
    setAutosaveStamp(record.savedAt);
  } catch (err) {
    // Quota dépassé ou mode privé : on retente sans le PDF avant d'abandonner
    console.warn('Autosave échouée :', err);
    try {
      await dbPut(AUTOSAVE_KEY, {
        savedAt: Date.now(), project: buildProjectData(),
        pdfBlob: null, fileName: App.pdfInfo?.fileName || 'document.pdf',
      });
      setAutosaveStamp(Date.now());
    } catch { setAutosaveStamp(null); }
  }
}

function setAutosaveStamp(ts) {
  const el = document.getElementById('autosave-state');
  if (!el) return;
  if (!ts) { el.textContent = '⚠️ sauvegarde auto indisponible'; el.title = ''; return; }
  const t = new Date(ts);
  el.textContent = `↻ ${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;
  el.title = `Sauvegarde automatique locale à ${t.toLocaleTimeString('fr-FR')}`;
}

async function initAutosave() {
  // Garde-fou à la fermeture
  window.addEventListener('beforeunload', (e) => {
    if (!App.dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });

  // Proposition de reprise
  try {
    const rec = await dbGet(AUTOSAVE_KEY);
    if (!rec?.project) return;
    const when = new Date(rec.savedAt).toLocaleString('fr-FR');
    const pages = Object.values(rec.project.pages || {})
      .reduce((n, p) => n + (p.objects?.length || 0), 0);
    if (pages === 0) { await dbDelete(AUTOSAVE_KEY); return; }

    offerRecovery(rec, when, pages);
  } catch (err) {
    console.warn('Reprise indisponible :', err);
  }
}

function offerRecovery(rec, when, pages) {
  const bar = document.getElementById('recovery-bar');
  if (!bar) return;
  document.getElementById('recovery-text').textContent =
    `Session non sauvegardée du ${when} — ${rec.fileName}, ${pages} annotation(s).`;
  bar.style.display = 'flex';

  document.getElementById('recovery-restore').onclick = async () => {
    bar.style.display = 'none';
    try {
      if (rec.pdfBlob) {
        setProgress('Reprise de la session…');
        await loadPDF(new File([rec.pdfBlob], rec.fileName, { type: 'application/pdf' }));
        await loadProject(JSON.stringify(rec.project));
        App.dirty = true;
        updateDocumentState();
        showToast('Session restaurée ✓');
      } else {
        // Le PDF n'a pas pu être stocké (trop volumineux) : on garde le projet
        App._pendingRecovery = rec.project;
        showToast('Ouvrez le PDF d’origine : les annotations seront réappliquées.');
      }
    } catch (err) {
      console.error(err);
      showError(`Reprise impossible : ${describeError(err)}`);
    } finally {
      clearProgress();
    }
  };

  document.getElementById('recovery-discard').onclick = async () => {
    bar.style.display = 'none';
    await dbDelete(AUTOSAVE_KEY);
  };
}

// Met à jour l'en-tête : nom du document, état modifié, activation des outils
function updateDocumentState() {
  const hasDoc = !!App.pdfDoc;

  const nameEl = document.getElementById('doc-name');
  if (nameEl) {
    nameEl.textContent = hasDoc ? App.pdfInfo?.fileName || '' : 'Aucun document';
    nameEl.title = nameEl.textContent;
  }

  const dirtyEl = document.getElementById('doc-dirty');
  if (dirtyEl) dirtyEl.style.display = (hasDoc && App.dirty) ? '' : 'none';

  document.body.classList.toggle('no-document', !hasDoc);
  document.querySelectorAll('[data-needs-doc]').forEach(el => { el.disabled = !hasDoc; });
}

// ============================================================
// ACCESSIBILITÉ
// ------------------------------------------------------------
// Les boutons n'ont qu'un emoji comme contenu : sans libellé ils sont
// annoncés « bouton » par un lecteur d'écran. On dérive le libellé de
// l'infobulle, déjà rédigée et traduite.
// ============================================================
function initAccessibility() {
  document.querySelectorAll('button[title]').forEach(b => {
    if (!b.getAttribute('aria-label')) b.setAttribute('aria-label', b.title);
  });
  document.querySelectorAll('.tool-btn[data-tool]').forEach(b => {
    b.setAttribute('aria-pressed', String(b.classList.contains('active')));
  });

  // Bascules des panneaux sur petit écran
  document.getElementById('btn-toggle-tools')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.body.classList.toggle('tools-open');
    document.body.classList.remove('panel-open');
  });
  document.getElementById('btn-toggle-sidebar')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.body.classList.toggle('panel-open');
    document.body.classList.remove('tools-open');
  });
  document.getElementById('canvas-wrapper')?.addEventListener('pointerdown', () => {
    document.body.classList.remove('tools-open', 'panel-open');
  });
}

// ============================================================
// TACTILE — pincer pour zoomer
// ------------------------------------------------------------
// Fabric émet `touch:gesture` ; inutile de recoder la détection.
// ============================================================
function initTouch() {
  let startZoom = 1;
  App.canvas.on('touch:gesture', (opt) => {
    const e = opt.e;
    if (!e.touches || e.touches.length !== 2) return;
    e.preventDefault();
    if (opt.self.state === 'start') startZoom = App.canvas.getZoom();
    const z = Math.max(0.05, Math.min(20, startZoom * opt.self.scale));
    App.canvas.zoomToPoint({ x: opt.self.x, y: opt.self.y }, z);
    updateZoomDisplay();
    if (opt.self.state === 'end') scheduleBackgroundRefresh();
  });
}

// ============================================================
// UTILITAIRES UI
// ============================================================
let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

// Une erreur ne doit PAS disparaître au bout de 2,5 s comme une info.
function showError(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show error';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 12000);
  console.error(msg);
}

// Message technique lisible à partir d'une exception
function describeError(err) {
  if (!err) return 'erreur inconnue';
  const name = err.name || '';
  if (name === 'PasswordException')      return 'le document est protégé par mot de passe';
  if (name === 'InvalidPDFException')    return 'le fichier est corrompu ou n’est pas un PDF';
  if (name === 'MissingPDFException')    return 'le fichier est introuvable';
  if (name === 'QuotaExceededError')     return 'espace de stockage local insuffisant';
  if (name === 'RangeError' || /canvas/i.test(err.message || ''))
    return 'taille de canvas dépassée (plan trop grand pour cette résolution)';
  return err.message || String(err);
}

// Indicateur de progression PERSISTANT (le toast disparaissait au bout de 2,5 s
// alors que le traitement durait encore plusieurs minutes)
function setProgress(msg) {
  const el = document.getElementById('progress');
  if (!el) return;
  el.querySelector('.progress-text').textContent = msg;
  el.style.display = 'flex';
}
function clearProgress() {
  const el = document.getElementById('progress');
  if (el) el.style.display = 'none';
}

function showIndicator(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'block';
}
function hideIndicator(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

// Convertit rgb(r,g,b) en #rrggbb pour les color inputs
function rgbToHex(color) {
  if (!color || color.startsWith('#')) return color;
  const m = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (!m) return color;
  return '#' + [m[1], m[2], m[3]].map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
}
