// ============================================================
// app.js — Logique principale de l'annoteur de plans PDF
// ============================================================

// === Configuration PDF.js ===
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ============================================================
// ÉTAT GLOBAL
// ============================================================
const App = {
  pdfDoc:       null,    // PDFDocumentProxy (PDF.js)
  currentPage:  1,
  totalPages:   0,

  // Données par page : rotation, calibration, objets sérialisés, renderScale
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

  // Historique (undo simplifié : liste des états JSON par page)
  history: [],
  historyIndex: -1,

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
  updateCalibrationUI();
});

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

  // Redimensionner le canvas si la fenêtre change
  window.addEventListener('resize', () => {
    if (!App.pdfDoc) {
      fc.setWidth(wrapper.clientWidth);
      fc.setHeight(wrapper.clientHeight);
    }
  });
}

// ============================================================
// GESTION ÉVÉNEMENTS SOURIS — Dispatch vers les outils
// ============================================================
function handleMouseDown(opt) {
  const e  = opt.e;
  const fc = App.canvas;
  const pt = fc.getPointer(e);

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

  if (!App.draw.active && App.activeTool !== 'calibrate' && App.activeTool !== 'measure') return;

  const pt = fc.getPointer(e);

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

  const pt = fc.getPointer(opt.e);

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
  if (App.layers.length === 0) {
    addLayer('Annotations');
    App.pageData[App.currentPage].layers       = [...App.layers];
    App.pageData[App.currentPage].activeLayerId = App.activeLayerId;
  }
}

function baseProps(extra = {}) {
  ensureActiveLayer();
  const tp = App.toolProps;
  return {
    stroke:          tp.strokeColor,
    strokeWidth:     tp.strokeWidth,
    strokeDashArray: tp.dashArray,
    opacity:         tp.opacity,
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
  const prevLine = new fabric.Line([pt.x, pt.y, pt.x, pt.y], {
    stroke: App.toolProps.strokeColor, strokeWidth: 1,
    strokeDashArray: [4, 3], selectable: false, evented: false,
  });
  App.canvas.add(prevLine);
  App.draw.previewLine = prevLine;
  App.draw.active = true;

  // Dessiner le segment si on a ≥2 points
  if (App.draw.points.length >= 2) {
    const pts = App.draw.points;
    const n = pts.length;
    const seg = new fabric.Line(
      [pts[n-2].x, pts[n-2].y, pts[n-1].x, pts[n-1].y],
      { ...baseProps(), fill: '' }
    );
    seg.set({ selectable: false, evented: false });
    App.canvas.add(seg);
  }
  App.draw.step = 1;
}
function toolPolyline_finish() {
  if (App.draw.points.length < 2) {
    resetDrawState(); return;
  }
  if (App.draw.previewLine) App.canvas.remove(App.draw.previewLine);
  App.draw.previewLine = null;

  // Construire la polyligne complète à partir des points
  const pts = App.draw.points.flatMap(p => [p.x, p.y]);
  // Supprimer les segments temporaires (non sélectionnables)
  App.canvas.getObjects('line').filter(o => !o.selectable).forEach(o => App.canvas.remove(o));

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
  const prevLine = new fabric.Line([pt.x, pt.y, pt.x, pt.y], {
    stroke: App.toolProps.strokeColor, strokeWidth: 1,
    strokeDashArray: [4, 3], selectable: false, evented: false, opacity: 0.7,
  });
  App.canvas.add(prevLine);
  App.draw.previewLine = prevLine;

  // Après le 2e point, dessiner le segment validé ET le segment de fermeture en filigrane
  if (App.draw.points.length >= 2) {
    const pts = App.draw.points;
    const n   = pts.length;
    const seg = new fabric.Line(
      [pts[n-2].x, pts[n-2].y, pts[n-1].x, pts[n-1].y],
      { stroke: App.toolProps.strokeColor, strokeWidth: App.toolProps.strokeWidth,
        strokeDashArray: App.toolProps.dashArray,
        selectable: false, evented: false }
    );
    App.canvas.add(seg);

    // Segment de fermeture filigrane (dernier point → premier point)
    if (App.draw.closingLine) App.canvas.remove(App.draw.closingLine);
    const closingLine = new fabric.Line(
      [pts[n-1].x, pts[n-1].y, pts[0].x, pts[0].y],
      { stroke: App.toolProps.strokeColor, strokeWidth: 1,
        strokeDashArray: [3, 5], selectable: false, evented: false, opacity: 0.45 }
    );
    App.canvas.add(closingLine);
    App.draw.closingLine = closingLine;
  }
  App.draw.step = 1;
}

function toolPolygon_finish() {
  if (App.draw.points.length < 3) { resetDrawState(); return; }

  // Supprimer tous les objets temporaires
  if (App.draw.previewLine) App.canvas.remove(App.draw.previewLine);
  if (App.draw.closingLine) App.canvas.remove(App.draw.closingLine);
  App.draw.previewLine = null;
  App.draw.closingLine = null;
  App.canvas.getObjects('line').filter(o => !o.selectable).forEach(o => App.canvas.remove(o));

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
    { stroke: color, strokeWidth: 2, fill: '', selectable: false, evented: false }
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
    const pl = new fabric.Line([pt.x, pt.y, pt.x, pt.y], {
      stroke: '#00aaff', strokeWidth: 1.5, strokeDashArray: [5, 3],
      selectable: false, evented: false, opacity: 0.75,
    });
    fc.add(pl);
    App.draw.previewLine = pl;

    // Étiquette de mesure (dès le 1er clic)
    const ptxt = new fabric.Text('0', {
      left: pt.x, top: pt.y - 14,
      fontSize: 12, fill: '#0077cc', fontWeight: 'bold',
      originX: 'center', originY: 'bottom',
      backgroundColor: 'rgba(255,255,255,0.85)', padding: 2,
      selectable: false, evented: false,
    });
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

    const line = new fabric.Line([pt.x, pt.y, pt.x, pt.y], {
      stroke: '#ffcc00', strokeWidth: 2, strokeDashArray: [6, 3],
      selectable: false, evented: false,
    });
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
    document.getElementById('calib-px-dist').textContent = Math.round(pixelDist);
    document.getElementById('calib-real-dist').value     = '';
    document.getElementById('modal-calib').classList.add('open');

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
  return { val: parseFloat((px / calib.pixelsPerUnit).toFixed(2)), unit: calib.unit };
}

// Convertit une valeur en unité calibrée → pixels canvas
function displayToPx(val, unit) {
  const calib = getPageCalibration();
  if (!calib) return parseFloat(val);
  // val est dans calib.unit ; convertir si nécessaire (ici même unité car le champ affiche calib.unit)
  return parseFloat(val) * calib.pixelsPerUnit;
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

// Calcule toute la géométrie d'une ligne de cote à partir de p1, p2 et d'un point d'écartement
function computeDimGeometry(p1, p2, offsetPt) {
  const dx  = p2.x - p1.x;
  const dy  = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;

  // Vecteur perpendiculaire normalisé (sens trigonométrique)
  const nx = -dy / len;
  const ny =  dx / len;

  // Distance signée de offsetPt à la droite p1-p2 (projection sur la perpendiculaire)
  const offset = (offsetPt.x - p1.x) * nx + (offsetPt.y - p1.y) * ny;

  // Points de la ligne de cote (parallèle à p1-p2, décalée de offset)
  const c1 = { x: p1.x + nx * offset, y: p1.y + ny * offset };
  const c2 = { x: p2.x + nx * offset, y: p2.y + ny * offset };

  // Sens du dépassement des lignes de rappel (même côté que l'offset)
  const sign      = offset >= 0 ? 1 : -1;
  const gap       = 3;  // espace entre le point mesuré et le début de la ligne de rappel
  const overshoot = 6;  // dépassement au-delà de la ligne de cote

  const e1s = { x: p1.x + nx * gap  * sign, y: p1.y + ny * gap  * sign };
  const e1e = { x: c1.x + nx * overshoot * sign, y: c1.y + ny * overshoot * sign };
  const e2s = { x: p2.x + nx * gap  * sign, y: p2.y + ny * gap  * sign };
  const e2e = { x: c2.x + nx * overshoot * sign, y: c2.y + ny * overshoot * sign };

  // Milieu de la ligne de cote (pour le texte)
  const mid = { x: (c1.x + c2.x) / 2, y: (c1.y + c2.y) / 2 };

  // Angle de la ligne de cote (en degrés, pour la rotation du texte)
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;

  return { c1, c2, e1s, e1e, e2s, e2e, mid, angle, offset, nx, ny, len };
}

// Crée les objets Fabric filigrane (preview) pour la cote en cours de tracé
// La mesure réelle s'affiche dès l'étape 2 (offset en cours)
function createDimPreviewObjects(geo, p1, p2) {
  const fc = App.canvas;
  const ph = { stroke: '#00aaff', strokeWidth: 1.5, strokeDashArray: [5, 3], selectable: false, evented: false, opacity: 0.75, fill: '' };

  const coteLine = new fabric.Line([geo.c1.x, geo.c1.y, geo.c2.x, geo.c2.y], ph);
  const ext1     = new fabric.Line([geo.e1s.x, geo.e1s.y, geo.e1e.x, geo.e1e.y], ph);
  const ext2     = new fabric.Line([geo.e2s.x, geo.e2s.y, geo.e2e.x, geo.e2e.y], ph);

  // Petits tirets obliques aux extrémités de la ligne de cote (preview)
  const calib    = getPageCalibration();
  const pixDist  = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const label    = formatDimension(pixDist, calib);
  const txtAngle = (geo.angle > 90 || geo.angle < -90) ? geo.angle + 180 : geo.angle;

  const text = new fabric.Text(label, {
    left: geo.mid.x, top: geo.mid.y,
    fontSize: 12, fill: '#0077cc', fontWeight: 'bold',
    originX: 'center', originY: 'bottom',
    angle: txtAngle,
    backgroundColor: 'rgba(255,255,255,0.85)',
    padding: 2,
    selectable: false, evented: false,
  });

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

  const h1 = makeDimHandle(d.p1,      'dimP1',  group);
  const h2 = makeDimHandle(d.p2,      'dimP2',  group);
  const h3 = makeDimHandle(d.offsetPt,'dimOff', group);
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
function makeDimHandle(pt, role, dimGroup) {
  const s = 8;
  return new fabric.Path(`M ${-s} 0 L ${s} 0 M 0 ${-s} L 0 ${s}`, {
    left: pt.x, top: pt.y,
    originX: 'center', originY: 'center',
    stroke: '#00aaff', strokeWidth: 2.5, fill: '',
    selectable: true, evented: true,
    hasBorders: false, hasControls: false,
    lockRotation: true, lockScalingX: true, lockScalingY: true,
    perPixelTargetFind: true,
    data: { type: 'dimHandle', role, dimGroup },
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
  [handles.h1, handles.h2, handles.h3].forEach(h => { if (h) h.data.dimGroup = newGroup; });
  newGroup.set({ hasControls: false, borderColor: '#00aaff', borderDashArray: [4, 2] });

  fc.requestRenderAll();
  saveHistoryState();
  App._rebuildingDim = false;
}

// ============================================================
// ÉDITION DES POLYGONES / POLYLIGNES — Poignées de sommets
// ============================================================

// Retourne les positions absolues (canvas) des sommets d'un polygone/polyligne
function getPolyAbsolutePoints(obj) {
  const mat = obj.calcTransformMatrix();
  return obj.points.map(p => fabric.util.transformPoint(
    { x: p.x - obj.pathOffset.x, y: p.y - obj.pathOffset.y },
    mat
  ));
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
      data: { type: 'polyHandle', ptIndex: i, polyObj: obj },
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
  handles.forEach(h => { h.data.polyObj = newObj; });
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

// Normalise un vecteur 2D
function normV(v) {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
}

// ============================================================
// NUAGE DE RÉVISION
// ============================================================

// Génère le chemin SVG d'un nuage de révision rectangulaire
// Les arcs bombent vers l'extérieur (sweep=0 sur un tracé CW)
function makeRevisionCloudPath(x1, y1, x2, y2) {
  const w = x2 - x1, h = y2 - y1;
  if (w < 2 || h < 2) return `M ${x1} ${y1} Z`;

  // Rayon des arcs : ~1/20ème du périmètre, entre 8 et 30 px
  const perimeter = 2 * (w + h);
  const arcR      = Math.max(8, Math.min(30, perimeter / 20));

  // Parcourir les 4 côtés dans le sens horaire
  const sides = [
    [x1, y1, x2, y1],  // haut
    [x2, y1, x2, y2],  // droite
    [x2, y2, x1, y2],  // bas
    [x1, y2, x1, y1],  // gauche
  ];

  let d = '';
  let first = true;

  for (const [ax, ay, bx, by] of sides) {
    const len = Math.hypot(bx - ax, by - ay);
    // Nombre d'arcs sur ce côté
    const n   = Math.max(1, Math.round(len / (arcR * 2)));
    for (let j = 0; j < n; j++) {
      const t0 = j / n, t1 = (j + 1) / n;
      const px0 = ax + (bx - ax) * t0, py0 = ay + (by - ay) * t0;
      const px1 = ax + (bx - ax) * t1, py1 = ay + (by - ay) * t1;
      if (first) { d += `M ${px0.toFixed(1)} ${py0.toFixed(1)} `; first = false; }
      // sweep=1 → arc CW → bombe vers l'extérieur sur un chemin CW (convexe)
      d += `A ${arcR.toFixed(1)} ${arcR.toFixed(1)} 0 0 1 ${px1.toFixed(1)} ${py1.toFixed(1)} `;
    }
  }
  return d + 'Z';
}

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
      pixelLength: pixDist,
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
function createDimensionObject(p1, p2) {
  const calib     = getPageCalibration();
  const pixelDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const label     = formatDimension(pixelDist, calib);
  const angle     = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
  const mx        = (p1.x + p2.x) / 2;
  const my        = (p1.y + p2.y) / 2;

  // Ligne principale
  const line = new fabric.Line([p1.x, p1.y, p2.x, p2.y], {
    stroke: App.toolProps.strokeColor,
    strokeWidth: App.toolProps.strokeWidth,
    selectable: false, evented: false,
  });

  // Petits terminaux perpendiculaires
  const len  = 8;
  const perp = angle + 90;
  const pr   = perp * Math.PI / 180;
  const tick1 = new fabric.Line(
    [p1.x - Math.cos(pr)*len/2, p1.y - Math.sin(pr)*len/2, p1.x + Math.cos(pr)*len/2, p1.y + Math.sin(pr)*len/2],
    { stroke: App.toolProps.strokeColor, strokeWidth: App.toolProps.strokeWidth, selectable: false, evented: false }
  );
  const tick2 = new fabric.Line(
    [p2.x - Math.cos(pr)*len/2, p2.y - Math.sin(pr)*len/2, p2.x + Math.cos(pr)*len/2, p2.y + Math.sin(pr)*len/2],
    { stroke: App.toolProps.strokeColor, strokeWidth: App.toolProps.strokeWidth, selectable: false, evented: false }
  );

  // Étiquette de cote
  const textAngle = (angle > 90 || angle < -90) ? angle + 180 : angle;
  const text = new fabric.Text(label, {
    left: mx, top: my,
    fontSize: 12,
    fill: App.toolProps.strokeColor,
    originX: 'center', originY: 'bottom',
    angle: textAngle,
    backgroundColor: 'rgba(255,255,255,0.75)',
    padding: 2,
    selectable: false, evented: false,
  });

  // Regrouper tous les éléments
  const group = new fabric.Group([line, tick1, tick2, text], {
    selectable: true, evented: true,
    data: {
      type:        'dimension',
      layerId:     App.activeLayerId,
      pageNum:     App.currentPage,
      pixelLength: pixelDist,
      p1: { x: p1.x, y: p1.y },
      p2: { x: p2.x, y: p2.y },
    },
  });

  App.canvas.add(group);
  applyLayerPropsToObj(group);
  App.canvas.setActiveObject(group);
  App.canvas.requestRenderAll();
  saveHistoryState();
}

function formatDimension(pixelLength, calib) {
  if (!calib || !calib.pixelsPerUnit) return `${Math.round(pixelLength)} px`;
  const realVal = pixelLength / calib.pixelsPerUnit;
  return `${realVal.toFixed(2)} ${calib.unit}`;
}

// Met à jour toutes les cotes de la page courante après recalibration
function updateAllDimensionLabels() {
  const calib = getPageCalibration();
  App.canvas.getObjects('group').forEach(group => {
    if (group.data?.type !== 'dimension') return;
    if (group.data?.pageNum !== App.currentPage) return;
    const newLabel = formatDimension(group.data.pixelLength, calib);
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

function setPageCalibration(pixelsPerUnit, unit) {
  if (!App.pageData[App.currentPage]) return;
  App.pageData[App.currentPage].calibration = { pixelsPerUnit, unit };
  updateCalibrationUI();
  updateAllDimensionLabels();
  showToast(`Calibration appliquée : 1 ${unit} = ${(1/pixelsPerUnit).toFixed(2)} px⁻¹`);
}

function updateCalibrationUI() {
  const calib     = getPageCalibration();
  const statusEl  = document.getElementById('calib-status');
  const pageNumEl = document.getElementById('calib-page-num');
  if (pageNumEl) pageNumEl.textContent = App.currentPage;
  if (!statusEl) return;
  if (calib) {
    const ppu = calib.pixelsPerUnit;
    statusEl.className = 'calibration-info calibrated';
    statusEl.textContent = `✓ 1 ${calib.unit} = ${ppu.toFixed(2)} px`;
  } else {
    statusEl.className = 'calibration-info';
    statusEl.textContent = 'Non calibrée — utilisez 🎯 ou saisissez une échelle';
  }
}

// ============================================================
// PDF — Chargement et rendu
// ============================================================
async function loadPDF(file) {
  showToast('Chargement du PDF…');
  const arrayBuffer = await file.arrayBuffer();
  App.pdfDoc     = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  App.totalPages = App.pdfDoc.numPages;
  App.currentPage = 1;

  // Initialiser pageData pour chaque page
  for (let i = 1; i <= App.totalPages; i++) {
    App.pageData[i] = App.pageData[i] || {
      rotation:    0,
      calibration: null,
      objects:     [],       // objets Fabric sérialisés
      renderScale: 1,
    };
  }

  // Supprimer le hint
  document.getElementById('thumb-hint')?.remove();

  await renderThumbnails();
  await switchPage(1);
  showToast(`PDF chargé — ${App.totalPages} page(s)`);
}

// Génère toutes les vignettes
async function renderThumbnails() {
  const strip = document.getElementById('thumbnails');
  strip.innerHTML = '';
  for (let i = 1; i <= App.totalPages; i++) {
    const div = document.createElement('div');
    div.className = `thumb${i === App.currentPage ? ' active' : ''}`;
    div.dataset.page = i;
    div.title = `Page ${i}`;
    div.addEventListener('click', () => switchPage(i));

    const numSpan = document.createElement('span');
    numSpan.className = 'thumb-num';
    numSpan.textContent = i;

    const rotBtn = document.createElement('button');
    rotBtn.className = 'thumb-rot-btn';
    rotBtn.innerHTML = '↻';
    rotBtn.title = 'Rotation 90°';
    rotBtn.addEventListener('click', (e) => { e.stopPropagation(); rotatePage(i); });

    const thumbCanvas = document.createElement('canvas');
    div.appendChild(thumbCanvas);
    div.appendChild(numSpan);
    div.appendChild(rotBtn);
    strip.appendChild(div);

    // Rendre la vignette
    await renderPageToCanvas(i, thumbCanvas, 62);
  }
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

  // Sauvegarder les objets de la page courante
  if (App.canvas) saveCurrentPageObjects();

  App.currentPage = pageNum;

  // Charger les calques propres à cette page
  const pd = App.pageData[pageNum] || {};
  App.layers        = [...(pd.layers        || [])];
  App.activeLayerId = pd.activeLayerId || null;
  renderLayersList();

  // Mettre à jour les vignettes actives
  document.querySelectorAll('.thumb').forEach(t => {
    t.classList.toggle('active', Number(t.dataset.page) === pageNum);
  });
  document.getElementById('page-info').textContent = `Page ${pageNum} / ${App.totalPages}`;
  updateCalibrationUI();
  resetDrawState();

  await renderCurrentPage();
  loadPageObjects();
}

// Rend la page courante dans le canvas Fabric
async function renderCurrentPage() {
  const fc      = App.canvas;
  const wrapper = document.getElementById('canvas-wrapper');
  const page    = await App.pdfDoc.getPage(App.currentPage);
  const rotation = App.pageData[App.currentPage]?.rotation || 0;

  const containerW = wrapper.clientWidth  || 800;
  const containerH = wrapper.clientHeight || 600;

  const vp0     = page.getViewport({ scale: 1, rotation });
  const scale   = Math.min(containerW / vp0.width, containerH / vp0.height) * 0.92;
  const vp      = page.getViewport({ scale, rotation });

  App.pageData[App.currentPage].renderScale  = scale;
  App.pageData[App.currentPage].pageW        = vp.width;
  App.pageData[App.currentPage].pageH        = vp.height;

  // Rendre dans un canvas off-screen
  const offCanvas     = document.createElement('canvas');
  offCanvas.width     = vp.width;
  offCanvas.height    = vp.height;
  await page.render({ canvasContext: offCanvas.getContext('2d'), viewport: vp }).promise;

  // Redimensionner le canvas Fabric à la taille du container
  fc.setWidth(containerW);
  fc.setHeight(containerH);

  // Centrer dans le container via transform
  const tx = (containerW - vp.width)  / 2;
  const ty = (containerH - vp.height) / 2;

  // Sauvegarder l'offset pour l'export (les annotations sont en coordonnées canvas, pas page)
  App.pageData[App.currentPage].canvasOffsetX = tx;
  App.pageData[App.currentPage].canvasOffsetY = ty;

  // Définir le fond PDF
  return new Promise(resolve => {
    fc.setBackgroundImage(
      offCanvas.toDataURL('image/jpeg', 0.9),
      () => {
        fc.backgroundImage.set({
          left: tx, top: ty,
          originX: 'left', originY: 'top',
          scaleX: 1, scaleY: 1,
        });
        // Réinitialiser le viewport transform (supprime zoom/pan précédents)
        fc.setViewportTransform([1, 0, 0, 1, 0, 0]);
        updateZoomDisplay();
        fc.requestRenderAll();
        resolve();
      },
      { crossOrigin: 'anonymous' }
    );
  });
}

// Rotation d'une page (cumul 90°)
async function rotatePage(pageNum) {
  if (!App.pdfDoc) return;
  App.pageData[pageNum].rotation = ((App.pageData[pageNum].rotation || 0) + 90) % 360;
  // Mettre à jour la vignette
  const thumbDiv = document.querySelector(`.thumb[data-page="${pageNum}"]`);
  if (thumbDiv) {
    const tc = thumbDiv.querySelector('canvas');
    if (tc) await renderPageToCanvas(pageNum, tc, 62);
  }
  if (pageNum === App.currentPage) await renderCurrentPage();
}

// ============================================================
// GESTION DES OBJETS FABRIC PAR PAGE
// ============================================================
function saveCurrentPageObjects() {
  const fc = App.canvas;
  const json = fc.toJSON(['data', 'objectType']);
  App.pageData[App.currentPage].objects = json.objects.filter(
    o => !o.data?.pageNum || o.data.pageNum === App.currentPage
  );
  // Sauvegarder les calques propres à cette page
  App.pageData[App.currentPage].layers        = [...App.layers];
  App.pageData[App.currentPage].activeLayerId = App.activeLayerId;
}

function loadPageObjects() {
  const fc      = App.canvas;
  const objects = App.pageData[App.currentPage]?.objects || [];

  // Supprimer tous les objets Fabric courants
  fc.remove(...fc.getObjects());

  if (objects.length === 0) { fc.requestRenderAll(); return; }

  // Recréer les objets Fabric à partir du JSON sérialisé
  fabric.util.enlivenObjects(objects, (fabricObjs) => {
    fabricObjs.forEach(obj => {
      if (isTransparentFill(obj.fill)) obj.set('perPixelTargetFind', true);
      fc.add(obj);
    });
    applyAllLayerStates(); // Re-appliquer visibilité / verrouillage
    fc.requestRenderAll();
  });
}

// ============================================================
// GESTION DES CALQUES
// ============================================================
const LAYER_COLORS = ['#e05c5c','#f0a030','#50c060','#50b8e0','#a060e0','#e060a0','#80c040','#40a0c0'];

function addDefaultLayer() {
  addLayer('Calque 1');
}

function addLayer(name) {
  const id = App.nextLayerId++;
  const color = LAYER_COLORS[(App.layers.length) % LAYER_COLORS.length];
  App.layers.push({ id, name, visible: true, locked: false, color });
  if (!App.activeLayerId) App.activeLayerId = id;
  renderLayersList();
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
  if (layer) { layer.name = newName; renderLayersList(); }
}

function toggleLayerVisibility(id) {
  const layer = App.layers.find(l => l.id === id);
  if (!layer) return;
  layer.visible = !layer.visible;
  // Appliquer sur les objets du canvas courant
  App.canvas.getObjects().forEach(obj => {
    if (obj.data?.layerId === id) obj.set('visible', layer.visible);
  });
  App.canvas.requestRenderAll();
  renderLayersList();
}

function toggleLayerLock(id) {
  const layer = App.layers.find(l => l.id === id);
  if (!layer) return;
  layer.locked = !layer.locked;
  App.canvas.getObjects().forEach(obj => {
    if (obj.data?.layerId === id) {
      obj.set({ selectable: !layer.locked, evented: !layer.locked });
    }
  });
  App.canvas.discardActiveObject();
  App.canvas.requestRenderAll();
  renderLayersList();
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
    if      (calib.unit === 'm')  pixelsPerCm = calib.pixelsPerUnit / 100;
    else if (calib.unit === 'cm') pixelsPerCm = calib.pixelsPerUnit;
    else                          pixelsPerCm = calib.pixelsPerUnit / 10; // mm
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
function saveProject() {
  if (!App.pdfDoc) { showToast('Aucun PDF chargé'); return; }
  saveCurrentPageObjects();

  const projectData = {
    version:    '1.1',
    totalPages: App.totalPages,
    nextLayerId: App.nextLayerId,
    pages:      App.pageData, // calques inclus dans chaque pageData[pn]
  };

  const json = JSON.stringify(projectData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'projet.annot.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Projet sauvegardé ✓');
}

async function loadProject(jsonStr) {
  let data;
  try { data = JSON.parse(jsonStr); } catch { showToast('Fichier invalide'); return; }

  App.nextLayerId = data.nextLayerId || 1;

  // Restaurer les données de pages (calibration, rotation, objets, calques)
  Object.keys(data.pages || {}).forEach(p => {
    const pn = Number(p);
    App.pageData[pn] = App.pageData[pn] || {};
    Object.assign(App.pageData[pn], data.pages[p]);
    // Compatibilité v1.0 : calques globaux migrés sur toutes les pages
    if (!App.pageData[pn].layers && data.layers) {
      App.pageData[pn].layers        = [...data.layers];
      App.pageData[pn].activeLayerId = data.layers[0]?.id || null;
    }
  });

  // Recharger la page courante SANS sauvegarder le canvas (qui est vide à ce stade)
  // et écraserait les objets qu'on vient de restaurer.
  const pd = App.pageData[App.currentPage] || {};
  App.layers        = [...(pd.layers        || [])];
  App.activeLayerId = pd.activeLayerId || null;
  renderLayersList();
  await renderCurrentPage();
  loadPageObjects();
  updateCalibrationUI();
  showToast('Projet chargé ✓');
}

// ============================================================
// EXPORT PDF
// ============================================================

// Formats papier — dimensions portrait en mm (jsPDF name → { w, h })
const PAPER_FORMATS = {
  a4: { w: 210, h: 297 },
  a3: { w: 297, h: 420 },
};

async function exportPDF(selectedLayerIds, resolution, format = 'original') {
  if (!App.pdfDoc) { showToast('Aucun PDF chargé'); return; }
  showToast('Export en cours…');

  const { jsPDF } = window.jspdf;
  const savedPage = App.currentPage;
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

  // 150 DPI pour la mise à l'échelle des formats papier
  const PRINT_DPI = 150;
  const MM_TO_PX  = PRINT_DPI / 25.4;

  let doc = null;

  try {
    for (let pn = 1; pn <= App.totalPages; pn++) {
      const pdfPage   = await App.pdfDoc.getPage(pn);
      const rotation  = App.pageData[pn]?.rotation || 0;
      const vp0       = pdfPage.getViewport({ scale: 1, rotation });

      // Résolution d'export = renderScale × dpiMult
      const renderScale = App.pageData[pn]?.renderScale || 1;
      const exportScale = renderScale * dpiMult;
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

      // Transformer : soustraire l'offset de centrage UI, passer à l'échelle export
      // Les objets ont été placés en coords canvas (origin = coin haut-gauche du container,
      // pas de la page PDF). L'offset (tx, ty) est le décalage de centrage de la page.
      const tx = App.pageData[pn]?.canvasOffsetX || 0;
      const ty = App.pageData[pn]?.canvasOffsetY || 0;
      tmpFc.setViewportTransform([dpiMult, 0, 0, dpiMult, -tx * dpiMult, -ty * dpiMult]);
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

      // 5. Ajouter la page au PDF (unit: px, dimensions exactes, pas de conversion)
      const FW     = finalCanvas.width;
      const FH     = finalCanvas.height;
      const orient = FW > FH ? 'l' : 'p';
      const imgURL = finalCanvas.toDataURL('image/jpeg', 0.93);

      if (!doc) {
        doc = new jsPDF({ orientation: orient, unit: 'px', format: [FW, FH], compress: true });
      } else {
        doc.addPage([FW, FH], orient);
      }
      doc.addImage(imgURL, 'JPEG', 0, 0, FW, FH);
    }

    if (doc) {
      doc.save('plans-annotes.pdf');
      showToast('Export terminé ✓');
    }
  } finally {
    tmpFc.dispose();
    document.body.removeChild(tmpEl);
    if (App.currentPage !== savedPage) await switchPage(savedPage);
  }
}

// ============================================================
// HISTORIQUE (UNDO)
// ============================================================
function saveHistoryState() {
  saveCurrentPageObjects();
  const snapshot = JSON.stringify({
    page:    App.currentPage,
    objects: App.pageData[App.currentPage].objects,
  });
  // Tronquer l'historique si on est au milieu
  App.history = App.history.slice(0, App.historyIndex + 1);
  App.history.push(snapshot);
  if (App.history.length > 30) App.history.shift();
  App.historyIndex = App.history.length - 1;
}

function undo() {
  if (App.historyIndex <= 0) { showToast('Rien à annuler'); return; }
  App.historyIndex--;
  const snap = JSON.parse(App.history[App.historyIndex]);
  if (snap.page === App.currentPage) {
    App.pageData[App.currentPage].objects = snap.objects;
    loadPageObjects();
  }
}

// ============================================================
// RÉINITIALISATION ÉTAT DE DESSIN
// ============================================================
function resetDrawState() {
  const fc = App.canvas;
  if (App.draw.tempObj)     { fc.remove(App.draw.tempObj); }
  if (App.draw.previewLine) { fc.remove(App.draw.previewLine); }
  if (App.draw.previewText) { fc.remove(App.draw.previewText); }
  if (App.draw.closingLine) { fc.remove(App.draw.closingLine); }
  cleanupDimPreview();
  removeDimHandles();
  removePolyHandles();
  // Supprimer les segments intermédiaires de polyline (non sélectionnables)
  fc.getObjects('line').filter(o => !o.selectable).forEach(o => fc.remove(o));

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

  // Export
  document.getElementById('btn-export').addEventListener('click', openExportModal);

  // Undo / Supprimer
  document.getElementById('btn-undo')  .addEventListener('click', undo);
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
    b.classList.toggle('active', b.dataset.tool === toolName);
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

function fitToWindow() {
  if (!App.pdfDoc) return;
  const pd   = App.pageData[App.currentPage];
  if (!pd?.pageW) return;
  const fc   = App.canvas;
  const scaleX = fc.width  / pd.pageW;
  const scaleY = fc.height / pd.pageH;
  const scale  = Math.min(scaleX, scaleY) * 0.95;
  const tx     = (fc.width  - pd.pageW * scale) / 2;
  const ty     = (fc.height - pd.pageH * scale) / 2;
  fc.setViewportTransform([scale, 0, 0, scale, tx, ty]);
  updateZoomDisplay();
}

function updateZoomDisplay() {
  const z = App.canvas.getZoom();
  document.getElementById('zoom-display').textContent = `${Math.round(z * 100)}%`;
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
  document.querySelectorAll('.sidebar-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = document.getElementById(`panel-${tab.dataset.panel}`);
      if (panel) panel.classList.add('active');
    });
  });

  // Contrôles de style
  document.getElementById('prop-stroke-color').addEventListener('input', (e) => {
    App.toolProps.strokeColor = e.target.value;
    applyToSelection({ stroke: e.target.value });
    if (App.activeTool === 'freedraw') App.canvas.freeDrawingBrush.color = e.target.value;
  });
  document.getElementById('prop-stroke-width').addEventListener('change', (e) => {
    const w = parseFloat(e.target.value) || 2;
    App.toolProps.strokeWidth = w;
    applyToSelection({ strokeWidth: w });
    if (App.activeTool === 'freedraw') App.canvas.freeDrawingBrush.width = w;
  });
  document.getElementById('prop-fill-color').addEventListener('input', (e) => {
    App.toolProps.fillColor = e.target.value;
    if (document.getElementById('prop-fill-mode').value === 'solid')
      applyToSelection({ fill: e.target.value });
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
  document.getElementById('prop-opacity').addEventListener('input', (e) => {
    const op = parseInt(e.target.value) / 100;
    App.toolProps.opacity = op;
    document.getElementById('prop-opacity-val').textContent = e.target.value;
    applyToSelection({ opacity: op });
  });
  document.getElementById('prop-text-color').addEventListener('input', (e) => {
    App.toolProps.fontColor = e.target.value;
    applyToSelection({ fill: e.target.value });
  });
  document.getElementById('prop-font-size').addEventListener('change', (e) => {
    App.toolProps.fontSize = parseInt(e.target.value) || 16;
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
    document.getElementById('modal-calib-scale').classList.add('open');
  });
}

function applyToSelection(props) {
  const fc  = App.canvas;
  const sel = fc.getActiveObjects();
  if (!sel.length) return;
  sel.forEach(obj => {
    obj.set(props);
    if ('fill' in props) obj.set('perPixelTargetFind', isTransparentFill(props.fill));
    obj.setCoords();
  });
  fc.requestRenderAll();
  saveHistoryState();
}

// ============================================================
// MODALES
// ============================================================
function initModals() {
  // --- Modal calibration par segment ---
  document.getElementById('calib-cancel').addEventListener('click', () => {
    document.getElementById('modal-calib').classList.remove('open');
    App._pendingCalibPixels = null;
  });
  document.getElementById('calib-confirm').addEventListener('click', () => {
    const realDist = parseFloat(document.getElementById('calib-real-dist').value);
    const unit     = document.getElementById('calib-unit').value;
    if (!realDist || realDist <= 0) { showToast('Saisir une distance valide'); return; }
    const pixelsPerUnit = App._pendingCalibPixels / realDist;
    document.getElementById('modal-calib').classList.remove('open');
    setPageCalibration(pixelsPerUnit, unit);
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
    document.getElementById('modal-calib-scale').classList.remove('open');
  });
  document.getElementById('scale-confirm').addEventListener('click', () => {
    const preset     = document.getElementById('scale-preset').value;
    const customVal  = document.getElementById('scale-custom').value;
    const unit       = document.getElementById('scale-unit').value;
    const denominator = preset === 'custom' ? parseFloat(customVal) : parseFloat(preset);
    if (!denominator || denominator <= 0) { showToast('Sélectionner ou saisir une échelle valide'); return; }

    const pd = App.pageData[App.currentPage];
    if (!pd) return;
    const renderScale = pd.renderScale || 1;

    // 1 PDF point = 1/72 pouce = 25.4/72 mm
    // A l'échelle 1:N sur papier → 1 mm papier = N mm réels
    // 1 px = (25.4/72) mm papier / renderScale → * N = réel en mm → /10 = cm → /100 = m
    const mmPerPt     = 25.4 / 72;
    const mmPerPixel  = mmPerPt / renderScale;  // mm papier par pixel affiché
    const realMmPerPx = mmPerPixel * denominator; // mm réels par pixel

    let pixelsPerUnit;
    if (unit === 'm')      pixelsPerUnit = 1000 / realMmPerPx;
    else if (unit === 'cm') pixelsPerUnit = 10   / realMmPerPx;
    else                    pixelsPerUnit = 1    / realMmPerPx;

    document.getElementById('modal-calib-scale').classList.remove('open');
    setPageCalibration(pixelsPerUnit, unit);
  });

  // --- Modal export ---
  document.getElementById('export-cancel').addEventListener('click', () => {
    document.getElementById('modal-export').classList.remove('open');
  });
  document.getElementById('export-confirm').addEventListener('click', () => {
    const checkboxes = document.querySelectorAll('#export-layers-list input[type=checkbox]:checked');
    const selectedIds = Array.from(checkboxes).map(cb => parseInt(cb.value));
    const resolution  = document.getElementById('export-resolution').value;
    const format      = document.getElementById('export-format').value;
    document.getElementById('modal-export').classList.remove('open');
    exportPDF(selectedIds, resolution, format);
  });

  // --- Modal renommer calque ---
  document.getElementById('rename-layer-cancel').addEventListener('click', () => {
    document.getElementById('modal-rename-layer').classList.remove('open');
  });
  document.getElementById('rename-layer-confirm').addEventListener('click', () => {
    const id    = parseInt(document.getElementById('modal-rename-layer').dataset.layerId);
    const name  = document.getElementById('rename-layer-input').value.trim();
    if (name) renameLayer(id, name);
    document.getElementById('modal-rename-layer').classList.remove('open');
  });
  document.getElementById('rename-layer-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('rename-layer-confirm').click();
  });

  // Fermer les modales en cliquant le backdrop
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.classList.remove('open');
    });
  });
}

function openRenameLayerModal(id, currentName) {
  const modal = document.getElementById('modal-rename-layer');
  modal.dataset.layerId = id;
  document.getElementById('rename-layer-input').value = currentName;
  modal.classList.add('open');
  setTimeout(() => document.getElementById('rename-layer-input').select(), 50);
}

function openExportModal() {
  if (!App.pdfDoc) { showToast('Aucun PDF chargé'); return; }
  saveCurrentPageObjects();

  // Collecter tous les calques de toutes les pages (IDs uniques)
  const seen = new Set();
  const allLayers = [];
  for (let pn = 1; pn <= App.totalPages; pn++) {
    (App.pageData[pn]?.layers || []).forEach(l => {
      if (!seen.has(l.id)) { seen.add(l.id); allLayers.push({ ...l, page: pn }); }
    });
  }

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
      const txt  = document.createTextNode(`${layer.name} (p.${layer.page})`);
      label.append(cb, dot, txt);
      item.appendChild(label);
      list.appendChild(item);
    });
  }
  document.getElementById('modal-export').classList.add('open');
}

// ============================================================
// RACCOURCIS CLAVIER
// ============================================================
function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Ne pas interférer si une modal est ouverte ou si on édite un texte
    if (document.querySelector('.modal-backdrop.open')) return;
    if (document.activeElement?.tagName === 'INPUT'  ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.isContentEditable) return;

    const isCtrl = e.ctrlKey || e.metaKey;

    if (isCtrl && e.key === 'z') { e.preventDefault(); undo(); return; }
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

    // Espace = toggle pan
    if (e.key === ' ') {
      e.preventDefault();
      App.isPanning = true;
      App.canvas.defaultCursor = 'grab';
      return;
    }

    // Raccourcis outils
    const shortcuts = { v: 'select', h: 'pan', l: 'line', p: 'polyline', g: 'polygon', r: 'rect', c: 'circle', f: 'freedraw', n: 'cloud', t: 'text', m: 'measure', k: 'calibrate' };
    if (!isCtrl && shortcuts[e.key]) setActiveTool(shortcuts[e.key]);
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === ' ') {
      App.isPanning = false;
      App.canvas.defaultCursor = App.activeTool === 'pan' ? 'grab' : (App.activeTool === 'select' ? 'default' : 'crosshair');
    }
  });
}

// ============================================================
// UTILITAIRES UI
// ============================================================
let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
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
