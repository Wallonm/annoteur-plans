// ============================================================
// geometry.js — Fonctions géométriques pures (sans DOM ni Fabric)
// ------------------------------------------------------------
// Isolées ici pour être testables hors navigateur (`node --test`).
// Chargé comme script classique dans le navigateur, requis comme
// module CommonJS par les tests.
//
// UNITÉ : depuis la v2.0, toutes les coordonnées sont en POINTS PDF
// (1 pt = 1/72 pouce = 0,3528 mm), indépendamment de l'affichage.
// ============================================================

// --- Vecteurs -----------------------------------------------

function normV(v) {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
}

// --- Géométrie d'une ligne de cote ---------------------------
// À partir des deux points mesurés et d'un point d'écartement,
// calcule la ligne de cote, les lignes de rappel et le milieu.

function computeDimGeometry(p1, p2, offsetPt) {
  const dx  = p2.x - p1.x;
  const dy  = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;

  // Vecteur perpendiculaire normalisé (sens trigonométrique)
  const nx = -dy / len;
  const ny =  dx / len;

  // Distance signée de offsetPt à la droite p1-p2
  const offset = (offsetPt.x - p1.x) * nx + (offsetPt.y - p1.y) * ny;

  const c1 = { x: p1.x + nx * offset, y: p1.y + ny * offset };
  const c2 = { x: p2.x + nx * offset, y: p2.y + ny * offset };

  // Sens du dépassement des lignes de rappel (même côté que l'offset)
  const sign      = offset >= 0 ? 1 : -1;
  const gap       = 3;  // espace entre le point mesuré et la ligne de rappel
  const overshoot = 6;  // dépassement au-delà de la ligne de cote

  const e1s = { x: p1.x + nx * gap * sign,       y: p1.y + ny * gap * sign };
  const e1e = { x: c1.x + nx * overshoot * sign, y: c1.y + ny * overshoot * sign };
  const e2s = { x: p2.x + nx * gap * sign,       y: p2.y + ny * gap * sign };
  const e2e = { x: c2.x + nx * overshoot * sign, y: c2.y + ny * overshoot * sign };

  const mid   = { x: (c1.x + c2.x) / 2, y: (c1.y + c2.y) / 2 };
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;

  return { c1, c2, e1s, e1e, e2s, e2e, mid, angle, offset, nx, ny, len };
}

// Ramène un angle dans l'intervalle ]-180, 180]
function normalizeAngle(deg) {
  let a = deg % 360;
  if (a > 180)   a -= 360;
  if (a <= -180) a += 360;
  return a === 0 ? 0 : a;              // évite -0
}

// Angle du texte de cote : jamais à l'envers
function dimTextAngle(angle) {
  return normalizeAngle((angle > 90 || angle < -90) ? angle + 180 : angle);
}

// --- Nuage de révision ---------------------------------------
// Chemin SVG d'un rectangle bordé d'arcs bombant vers l'extérieur.

function makeRevisionCloudPath(x1, y1, x2, y2, arcRadius) {
  const w = x2 - x1, h = y2 - y1;
  if (w < 2 || h < 2) return `M ${x1} ${y1} Z`;

  const perimeter = 2 * (w + h);
  const arcR = arcRadius || Math.max(8, Math.min(30, perimeter / 20));

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
    const n   = Math.max(1, Math.round(len / (arcR * 2)));
    for (let j = 0; j < n; j++) {
      const t0 = j / n, t1 = (j + 1) / n;
      const px0 = ax + (bx - ax) * t0, py0 = ay + (by - ay) * t0;
      const px1 = ax + (bx - ax) * t1, py1 = ay + (by - ay) * t1;
      if (first) { d += `M ${px0.toFixed(1)} ${py0.toFixed(1)} `; first = false; }
      // sweep=1 → arc horaire → convexe sur un parcours horaire
      d += `A ${arcR.toFixed(1)} ${arcR.toFixed(1)} 0 0 1 ${px1.toFixed(1)} ${py1.toFixed(1)} `;
    }
  }
  return d + 'Z';
}

// --- Calibration ---------------------------------------------
// La calibration relie les points PDF aux unités réelles du plan.
// Elle ne dépend PLUS de l'échelle d'affichage (bug majeur de la v1.1).

const MM_PER_POINT = 25.4 / 72;
const MM_PER_UNIT  = { m: 1000, cm: 10, mm: 1 };

// Échelle 1:N → nombre de points PDF représentant une unité réelle.
// Sur le papier, 1 pt = 25,4/72 mm ; à l'échelle 1:N il représente N fois plus.
function scaleToPointsPerUnit(denominator, unit) {
  const mmPerUnit = MM_PER_UNIT[unit];
  if (!mmPerUnit) throw new Error(`Unité inconnue : ${unit}`);
  if (!(denominator > 0)) throw new Error('Dénominateur d’échelle invalide');
  const realMmPerPoint = MM_PER_POINT * denominator;
  return mmPerUnit / realMmPerPoint;
}

// Réciproque : à partir d'une calibration, retrouve le dénominateur d'échelle
function pointsPerUnitToScale(pointsPerUnit, unit) {
  const mmPerUnit = MM_PER_UNIT[unit];
  if (!mmPerUnit || !(pointsPerUnit > 0)) return null;
  return mmPerUnit / (pointsPerUnit * MM_PER_POINT);
}

// Formatage d'une longueur (en points) dans l'unité calibrée
function formatDimension(lengthPt, calib) {
  if (!calib || !calib.pointsPerUnit) return `${Math.round(lengthPt)} pt`;
  return `${(lengthPt / calib.pointsPerUnit).toFixed(2)} ${calib.unit}`;
}

// Formatage d'une surface (en points²)
function formatArea(areaPt2, calib) {
  if (!calib || !calib.pointsPerUnit) return `${Math.round(areaPt2)} pt²`;
  const v = areaPt2 / (calib.pointsPerUnit ** 2);
  return `${v.toFixed(2)} ${calib.unit}²`;
}

// --- Surfaces et longueurs -----------------------------------

// Aire d'un polygone (formule du lacet), toujours positive
function polygonArea(points) {
  const n = points.length;
  if (n < 3) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

// Longueur d'une polyligne ; `closed` ajoute le segment de fermeture
function pathLength(points, closed = false) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i-1].x, points[i].y - points[i-1].y);
  }
  if (closed && points.length > 2) {
    const a = points[points.length - 1], b = points[0];
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

// --- Rotation de page ----------------------------------------
// Rotation de 90° horaire d'un point, dans une page de hauteur pageH points.
// Vérification aux coins : (0,0)→(pageH,0), (0,pageH)→(0,0).

function rotatePoint90(pt, pageH) {
  return { x: pageH - pt.y, y: pt.x };
}

// --- Accrochage ----------------------------------------------

// Contraint un point sur un multiple d'angle (par défaut 45°) autour de l'origine
function constrainAngle(origin, pt, stepDeg = 45) {
  const dx = pt.x - origin.x, dy = pt.y - origin.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return { ...pt };
  const step = stepDeg * Math.PI / 180;
  const snapped = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: origin.x + Math.cos(snapped) * dist, y: origin.y + Math.sin(snapped) * dist };
}

// Point le plus proche parmi `candidates` sous réserve d'être à moins de `tol`
function nearestPoint(pt, candidates, tol) {
  let best = null, bestD = tol;
  for (const c of candidates) {
    const d = Math.hypot(c.x - pt.x, c.y - pt.y);
    if (d <= bestD) { bestD = d; best = c; }
  }
  return best;
}

// Export CommonJS pour les tests Node ; inerte dans le navigateur.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normV, computeDimGeometry, dimTextAngle, normalizeAngle, makeRevisionCloudPath,
    scaleToPointsPerUnit, pointsPerUnitToScale, formatDimension, formatArea,
    polygonArea, pathLength, rotatePoint90, constrainAngle, nearestPoint,
    MM_PER_POINT, MM_PER_UNIT,
  };
}
