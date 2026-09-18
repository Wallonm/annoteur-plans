// ============================================================
// export-vector.js — Export PDF vectoriel (pdf-lib)
// ------------------------------------------------------------
// Les annotations sont ajoutées au PDF D'ORIGINE sous forme de tracés
// vectoriels et de texte réel. La v1.1 rastérisait tout en JPEG : le plan
// perdait son vectoriel et son texte recherchable, les traits fins
// bavaient, et le fichier gonflait (10,6 Mo pour 7 pages ici).
//
// Chaîne de coordonnées, sans algèbre matricielle à la main :
//   point local ──calcTransformMatrix()──▶ points page (origine haut-gauche, y vers le bas)
//               ──Util.applyInverseTransform(vp.transform)──▶ espace utilisateur PDF (y vers le haut)
// `vp` intègre à la fois la rotation propre au PDF (/Rotate) et celle
// appliquée par l'utilisateur : un seul appel suffit.
// ============================================================

const KAPPA = 0.5522847498307936;   // approximation d'un quart d'ellipse par une cubique

// ------------------------------------------------------------
// Conversion d'un objet Fabric en commandes de tracé LOCALES
// (repère de l'objet, centre à l'origine) — exactement ce que Fabric dessine.
// ------------------------------------------------------------
function fabricToLocalPath(obj) {
  const cmds = [];
  const w = obj.width, h = obj.height;

  switch (obj.type) {
    case 'line': {
      const lp = obj.calcLinePoints();
      cmds.push({ c: 'M', p: [{ x: lp.x1, y: lp.y1 }] },
                { c: 'L', p: [{ x: lp.x2, y: lp.y2 }] });
      break;
    }
    case 'rect': {
      const x = -w / 2, y = -h / 2;
      // Coins arrondis (cadre des tampons) : rx/ry bornés à la moitié du côté,
      // chaque quart de cercle approché par une cubique, comme Fabric le trace.
      const rx = Math.min(obj.rx || 0, w / 2), ry = Math.min(obj.ry || 0, h / 2);
      if (rx > 0 && ry > 0) {
        const kx = rx * (1 - KAPPA), ky = ry * (1 - KAPPA);
        cmds.push({ c: 'M', p: [{ x: x + rx, y }] },
                  { c: 'L', p: [{ x: x + w - rx, y }] },
                  { c: 'C', p: [{ x: x + w - kx, y }, { x: x + w, y: y + ky }, { x: x + w, y: y + ry }] },
                  { c: 'L', p: [{ x: x + w, y: y + h - ry }] },
                  { c: 'C', p: [{ x: x + w, y: y + h - ky }, { x: x + w - kx, y: y + h }, { x: x + w - rx, y: y + h }] },
                  { c: 'L', p: [{ x: x + rx, y: y + h }] },
                  { c: 'C', p: [{ x: x + kx, y: y + h }, { x, y: y + h - ky }, { x, y: y + h - ry }] },
                  { c: 'L', p: [{ x, y: y + ry }] },
                  { c: 'C', p: [{ x, y: y + ky }, { x: x + kx, y }, { x: x + rx, y }] },
                  { c: 'Z' });
      } else {
        cmds.push({ c: 'M', p: [{ x,     y }] },
                  { c: 'L', p: [{ x: x + w, y }] },
                  { c: 'L', p: [{ x: x + w, y: y + h }] },
                  { c: 'L', p: [{ x,     y: y + h }] },
                  { c: 'Z' });
      }
      break;
    }
    case 'triangle': {
      // Pointe de flèche des bulles de renvoi (fabric.Triangle : sommet en haut)
      cmds.push({ c: 'M', p: [{ x: -w / 2, y:  h / 2 }] },
                { c: 'L', p: [{ x:  0,     y: -h / 2 }] },
                { c: 'L', p: [{ x:  w / 2, y:  h / 2 }] },
                { c: 'Z' });
      break;
    }
    case 'ellipse':
    case 'circle': {
      const rx = obj.rx ?? obj.radius, ry = obj.ry ?? obj.radius;
      const kx = rx * KAPPA, ky = ry * KAPPA;
      cmds.push({ c: 'M', p: [{ x:  rx, y: 0 }] });
      cmds.push({ c: 'C', p: [{ x:  rx, y:  ky }, { x:  kx, y:  ry }, { x: 0, y:  ry }] });
      cmds.push({ c: 'C', p: [{ x: -kx, y:  ry }, { x: -rx, y:  ky }, { x: -rx, y: 0 }] });
      cmds.push({ c: 'C', p: [{ x: -rx, y: -ky }, { x: -kx, y: -ry }, { x: 0, y: -ry }] });
      cmds.push({ c: 'C', p: [{ x:  kx, y: -ry }, { x:  rx, y: -ky }, { x:  rx, y: 0 }] });
      cmds.push({ c: 'Z' });
      break;
    }
    case 'polygon':
    case 'polyline': {
      const off = obj.pathOffset;
      obj.points.forEach((pt, i) => {
        cmds.push({ c: i === 0 ? 'M' : 'L', p: [{ x: pt.x - off.x, y: pt.y - off.y }] });
      });
      if (obj.type === 'polygon') cmds.push({ c: 'Z' });
      break;
    }
    case 'path': {
      // makePathSimpler ramène tout à M / L / C / Z (les arcs du nuage de
      // révision et des symboles deviennent des cubiques)
      const simple = fabric.util.makePathSimpler(obj.path);
      const off = obj.pathOffset;
      const P = (x, y) => ({ x: x - off.x, y: y - off.y });
      simple.forEach(seg => {
        const t = seg[0];
        if      (t === 'M') cmds.push({ c: 'M', p: [P(seg[1], seg[2])] });
        else if (t === 'L') cmds.push({ c: 'L', p: [P(seg[1], seg[2])] });
        else if (t === 'C') cmds.push({ c: 'C', p: [P(seg[1], seg[2]), P(seg[3], seg[4]), P(seg[5], seg[6])] });
        else if (t === 'Z' || t === 'z') cmds.push({ c: 'Z' });
      });
      break;
    }
    default:
      return null;      // texte, image, groupe : traités séparément
  }
  return cmds;
}

// ------------------------------------------------------------
// Couleurs
// ------------------------------------------------------------
function toRgbA(color) {
  if (!color || color === 'transparent' || color === 'none') return null;
  try {
    const [r, g, b, a] = new fabric.Color(color).getSource();
    return { rgb: PDFLib.rgb(r / 255, g / 255, b / 255), alpha: a == null ? 1 : a };
  } catch { return null; }
}

// Épaisseur de trait rendue, en points.
// Sans strokeUniform (objets migrés de la v1.1), le trait suit la mise à
// l'échelle de l'objet : il faut la répercuter.
function effectiveStrokeWidth(obj) {
  const sw = obj.strokeWidth || 0;
  if (!sw) return 0;
  if (obj.strokeUniform) return sw;
  const sx = Math.abs(obj.scaleX || 1), sy = Math.abs(obj.scaleY || 1);
  return sw * (sx + sy) / 2;
}

// ------------------------------------------------------------
// Texte — Helvetica standard (WinAnsi). Les caractères non encodables
// (flèches, symboles mathématiques) sont remplacés plutôt que de faire
// échouer tout l'export.
// ------------------------------------------------------------
// Espaces typographiques produits par toLocaleString('fr-FR') (U+202F entre
// les milliers, U+00A0 devant l'unité) : hors WinAnsi, rendus « ? » en v1.7.
const SPACE_LIKE = /[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g;
function sanitizeForFont(text, font) {
  let out = '';
  for (const ch of String(text).replace(SPACE_LIKE, ' ')) {
    try { font.encodeText(ch); out += ch; }
    catch { out += ch === '→' ? '->' : ch === '←' ? '<-' : '?'; }
  }
  return out;
}

// ------------------------------------------------------------
// Export principal
// ------------------------------------------------------------
async function exportPdfVector(selectedLayerIds, onProgress) {
  const { PDFDocument, StandardFonts, degrees } = PDFLib;

  const buf = await App.pdfBlob.arrayBuffer();
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });

  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold    = await doc.embedFont(StandardFonts.HelveticaBold);

  for (let pn = 1; pn <= App.totalPages; pn++) {
    onProgress?.(pn, App.totalPages);

    const pd  = App.pageData[pn] || {};
    const objs = (pd.objects || []).filter(o => selectedLayerIds.includes(o.data?.layerId));

    // La rotation demandée par l'utilisateur est absolue (initialisée depuis
    // le /Rotate du PDF) : on la réapplique telle quelle à la page exportée.
    const pdfLibPage = doc.getPage(pn - 1);
    pdfLibPage.setRotation(degrees(((pd.rotation || 0) % 360 + 360) % 360));

    if (!objs.length) continue;

    const pdfjsPage = await App.pdfDoc.getPage(pn);
    const vp = pdfjsPage.getViewport({ scale: 1, rotation: pd.rotation || 0 });

    // page (y vers le bas) → espace utilisateur PDF (y vers le haut)
    const toPdf = (pt) => {
      const [x, y] = pdfjsLib.Util.applyInverseTransform([pt.x, pt.y], vp.transform);
      return { x, y };
    };

    const live = await enliven(objs);
    const ctx  = { page: pdfLibPage, toPdf, fontRegular, fontBold, imageJobs: [] };
    // Un calque masqué à l'écran mais coché à l'export doit sortir : `visible`
    // n'est qu'un état d'affichage (et serializePage ne le persiste plus).
    live.forEach(o => { o.visible = true; drawObject(o, ctx, 1); });

    // Les images importées sont matricielles : elles sont incorporées telles
    // quelles, après la passe vectorielle (l'incorporation est asynchrone).
    for (const job of ctx.imageJobs) {
      try {
        const img = await doc.embedPng(job.dataUrl);
        pdfLibPage.drawImage(img, {
          x: job.x, y: job.y, width: job.width, height: job.height,
          rotate: degrees(job.ang * 180 / Math.PI), opacity: job.opacity,
        });
      } catch (err) { console.warn('Image non incorporée :', err); }
    }
  }

  return doc.save({ useObjectStreams: true });
}

function enliven(serialized) {
  return new Promise(resolve => {
    fabric.util.enlivenObjects(serialized, (objs) => {
      // Un canvas jetable donne aux objets les dimensions et matrices correctes
      const tmp = new fabric.StaticCanvas(null, { width: 10, height: 10 });
      objs.forEach(o => { tmp.add(o); o.setCoords(); });
      resolve(objs);
    });
  });
}

// Dessine un objet (récursif pour les groupes : symboles, cotes)
function drawObject(obj, ctx, parentOpacity) {
  if (!obj || obj.visible === false) return;
  const opacity = (obj.opacity == null ? 1 : obj.opacity) * parentOpacity;

  if (obj.type === 'group') {
    // La matrice d'un enfant intègre déjà celle du groupe quand `group` est défini
    obj.getObjects().forEach(child => drawObject(child, ctx, opacity));
    return;
  }

  if (obj.type === 'text' || obj.type === 'i-text' || obj.type === 'textbox') {
    drawTextObject(obj, ctx, opacity);
    return;
  }

  if (obj.type === 'image') { drawImageObject(obj, ctx, opacity); return; }

  const cmds = fabricToLocalPath(obj);
  if (!cmds || !cmds.length) return;

  const mat = obj.calcTransformMatrix();
  const map = (p) => {
    const page = fabric.util.transformPoint({ x: p.x, y: p.y }, mat);
    const pdf  = ctx.toPdf(page);
    return `${fmt(pdf.x)} ${fmt(-pdf.y)}`;   // drawSvgPath inverse y : (X,−Y) → (X,Y)
  };

  let d = '';
  for (const cmd of cmds) {
    if      (cmd.c === 'M') d += `M ${map(cmd.p[0])} `;
    else if (cmd.c === 'L') d += `L ${map(cmd.p[0])} `;
    else if (cmd.c === 'C') d += `C ${map(cmd.p[0])} ${map(cmd.p[1])} ${map(cmd.p[2])} `;
    else if (cmd.c === 'Z') d += 'Z ';
  }
  if (!d.trim()) return;

  const stroke = toRgbA(obj.stroke);
  const fill   = toRgbA(obj.fill);
  const sw     = effectiveStrokeWidth(obj);

  const opts = { x: 0, y: 0, scale: 1 };
  if (fill)            { opts.color = fill.rgb;       opts.opacity = opacity * fill.alpha; }
  if (stroke && sw > 0) {
    opts.borderColor   = stroke.rgb;
    opts.borderWidth   = sw;
    opts.borderOpacity = opacity * stroke.alpha;
    opts.borderLineCap = PDFLib.LineCapStyle.Round;
    if (Array.isArray(obj.strokeDashArray) && obj.strokeDashArray.length) {
      const k = obj.strokeUniform ? 1 : (Math.abs(obj.scaleX || 1) + Math.abs(obj.scaleY || 1)) / 2;
      opts.borderDashArray = obj.strokeDashArray.map(v => v * k);
    }
  }
  if (!opts.color && !opts.borderColor) return;

  ctx.page.drawSvgPath(d.trim(), opts);
}

// ------------------------------------------------------------
// Texte : pdf-lib positionne la LIGNE DE BASE, comme le fait Fabric via
// fillText. On réutilise les métriques de Fabric (_getTopOffset,
// getHeightOfLine, _getLineLeftOffset) plutôt que de recoder ses constantes.
// ------------------------------------------------------------
function drawTextObject(obj, ctx, opacity) {
  const fill = toRgbA(obj.fill);
  if (!fill) return;

  const mat   = obj.calcTransformMatrix();
  const lines = obj._textLines || [obj.text || ''];
  const bold  = /bold|[7-9]00/i.test(String(obj.fontWeight || ''));
  const font  = bold ? ctx.fontBold : ctx.fontRegular;

  const toPdfLocal = (lx, ly) => ctx.toPdf(fabric.util.transformPoint({ x: lx, y: ly }, mat));

  const topOffset  = obj._getTopOffset();
  const leftOffset = obj._getLeftOffset();
  let cumulative = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineHeight = obj.getHeightOfLine(i);
    const baselineY  = topOffset + cumulative + lineHeight / obj.lineHeight;
    const lineX      = leftOffset + obj._getLineLeftOffset(i);
    cumulative += lineHeight;

    // `_textLines` contient les lignes APRÈS retour automatique, sous forme de
    // tableaux de graphèmes (`textLines` donnerait le texte non replié).
    const raw = Array.isArray(lines[i]) ? lines[i].join('') : String(lines[i] ?? '');
    if (!raw.trim()) continue;
    const text = sanitizeForFont(raw, font);

    const origin = toPdfLocal(lineX, baselineY);
    // Angle et corps déduits de deux points voisins : absorbe la rotation de
    // l'objet, celle de la page et l'inversion de l'axe y.
    const along  = toPdfLocal(lineX + 10, baselineY);
    const up     = toPdfLocal(lineX, baselineY - (obj.fontSize || 12));
    const angle  = Math.atan2(along.y - origin.y, along.x - origin.x);
    const size   = Math.hypot(up.x - origin.x, up.y - origin.y);
    if (!(size > 0.1)) continue;

    // Fond de l'étiquette (cotes) : rectangle plein derrière le texte
    if (obj.backgroundColor) {
      const bg = toRgbA(obj.backgroundColor);
      if (bg) {
        const wpt = font.widthOfTextAtSize(text, size);
        const pad = (obj.padding || 0) * (size / (obj.fontSize || size));
        ctx.page.drawRectangle({
          x: origin.x - pad, y: origin.y - size * 0.25 - pad,
          width: wpt + pad * 2, height: size * 1.2 + pad * 2,
          color: bg.rgb, opacity: opacity * bg.alpha,
          rotate: PDFLib.radians(angle),
        });
      }
    }

    ctx.page.drawText(text, {
      x: origin.x, y: origin.y, size, font,
      color: fill.rgb, opacity: opacity * fill.alpha,
      rotate: PDFLib.radians(angle),
    });
  }
}

// Images importées : restituées telles quelles (déjà matricielles)
function drawImageObject(obj, ctx, opacity) {
  const el = obj.getElement?.();
  if (!el) return;
  try {
    const c = document.createElement('canvas');
    c.width  = el.naturalWidth  || el.width;
    c.height = el.naturalHeight || el.height;
    c.getContext('2d').drawImage(el, 0, 0);
    const dataUrl = c.toDataURL('image/png');
    const mat = obj.calcTransformMatrix();
    const tl  = ctx.toPdf(fabric.util.transformPoint({ x: -obj.width / 2, y: -obj.height / 2 }, mat));
    const tr  = ctx.toPdf(fabric.util.transformPoint({ x:  obj.width / 2, y: -obj.height / 2 }, mat));
    const bl  = ctx.toPdf(fabric.util.transformPoint({ x: -obj.width / 2, y:  obj.height / 2 }, mat));
    const w   = Math.hypot(tr.x - tl.x, tr.y - tl.y);
    const h   = Math.hypot(bl.x - tl.x, bl.y - tl.y);
    const ang = Math.atan2(tr.y - tl.y, tr.x - tl.x);
    // pdf-lib pivote autour de (x, y), coin bas-gauche de l'image : c'est donc
    // le coin bas-gauche réel qu'il faut lui donner (en v1.7 : tl.y - h, juste à angle nul).
    ctx.imageJobs.push({ dataUrl, x: bl.x, y: bl.y, width: w, height: h, ang, opacity });
  } catch (err) {
    console.warn('Image non exportée :', err);
  }
}

// Nombres compacts : un plan peut contenir des milliers de points
function fmt(n) {
  return (Math.round(n * 100) / 100).toString();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fabricToLocalPath, effectiveStrokeWidth, sanitizeForFont, fmt, KAPPA };
}
