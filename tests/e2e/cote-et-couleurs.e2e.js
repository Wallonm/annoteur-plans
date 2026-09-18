// Test bout en bout (Playwright) : saisie manuelle de cote + couleur des symboles existants
// ------------------------------------------------------------------------------------
// Non lancé par `node --test` (dépend d'un navigateur). Exécution :
//   npm i -g playwright && npx playwright install chromium
//   node tests/e2e/cote-et-couleurs.e2e.js
// Variable PW_CHROMIUM : chemin d'un Chromium déjà installé (sinon celui de Playwright).
// Étapes : servir l'app, générer un PDF A4 vierge, l'ouvrir, calibrer 1:100 en cm,
// tracer une cote, la redimensionner par saisie, vérifier la géométrie ;
// poser un symbole, changer sa couleur via la barre de style, vérifier ses enfants.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const server = http.createServer((q, r) => {
  const f = path.join(ROOT, q.url === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0]));
  try {
    const d = fs.readFileSync(f);
    const t = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json' }[path.extname(f)] || 'application/octet-stream';
    r.writeHead(200, { 'Content-Type': t }); r.end(d);
  } catch { r.writeHead(404); r.end(); }
}).listen(3399);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
  await page.goto('http://localhost:3399/');
  await page.waitForFunction(() => typeof App !== 'undefined' && App.canvas);

  // PDF A4 vierge généré dans la page avec pdf-lib (déjà chargé par l'app)
  await page.evaluate(async () => {
    const { PDFDocument } = window.PDFLib;
    const doc = await PDFDocument.create(); doc.addPage([595.28, 841.89]); doc.addPage([595.28, 841.89]);
    const bytes = await doc.save();
    await loadPDF(new File([bytes], 'test.pdf', { type: 'application/pdf' }));
  });
  await page.waitForFunction(() => App.pdfDoc && App.pageData[1]);

  // Calibration 1:100 en cm
  await page.evaluate(() => setPageCalibration(scaleToPointsPerUnit(100, 'cm'), 'cm'));

  // 1) Cote de 100 pt horizontale, écartement 20 pt vers le bas
  const before = await page.evaluate(() => {
    const p1 = { x: 100, y: 100 }, p2 = { x: 200, y: 100 };
    const geo = computeDimGeometry(p1, p2, { x: 150, y: 120 });
    const g = createOffsetDimension(p1, p2, geo);
    return { p2: g.data.p2, off: g.data.offsetPt, label: dimensionValueText(g), n: App.canvas.getObjects().length };
  });
  console.log('cote initiale', JSON.stringify(before));

  // Saisie via la barre de style : la cote est sélectionnée → champ visible ?
  const barState = await page.evaluate(() => ({
    visible: getComputedStyle(document.getElementById('sb-dim-group')).display,
    value: document.getElementById('sb-dim-value').value,
    unit: document.getElementById('sb-dim-unit').textContent,
  }));
  console.log('barre de style', JSON.stringify(barState));

  await page.evaluate(() => { const el = document.getElementById('sb-dim-value'); el.focus(); el.value = '5,00 m'; el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  const after = await page.evaluate(() => {
    const g = App.canvas.getActiveObject();
    return { type: g?.data?.type, p1: g.data.p1, p2: g.data.p2, off: g.data.offsetPt, label: dimensionValueText(g),
             handles: !!App.activeDimHandles, hist: App.history[1].index, nObjs: App.canvas.getObjects().filter(o => !isTempObject(o)).length };
  });
  console.log('après saisie 5,00 m', JSON.stringify(after));
  const ppuCm = await page.evaluate(() => getPageCalibration().pointsPerUnit);
  const expectedLen = 500 * ppuCm;
  const ok1 = Math.abs(after.p2.x - (100 + expectedLen)) < 1e-6 && Math.abs(after.p2.y - 100) < 1e-6
           && Math.abs(after.off.y - 120) < 1e-6 && Math.abs(after.off.x - (100 + expectedLen / 2)) < 1e-6
           && after.label === '500,00 cm' && after.handles && after.nObjs === 1;
  console.log(ok1 ? 'OK  saisie manuelle : p1 fixe, p2 déplacé, écartement conservé, 1 seul objet' : 'FAIL saisie manuelle');

  // Undo doit restaurer l'ancienne cote
  await page.evaluate(() => undo());
  const undone = await page.evaluate(() => { const g = App.canvas.getObjects().find(o => o.data?.type === 'dimension'); return g.data.p2; });
  console.log(Math.abs(undone.x - 200) < 1e-6 ? 'OK  undo restaure p2=200' : 'FAIL undo ' + JSON.stringify(undone));
  await page.evaluate(() => redo());

  // Modale au double-clic : simulation directe
  await page.evaluate(() => { const g = App.canvas.getObjects().find(o => o.data?.type === 'dimension'); App.canvas.setActiveObject(g); openDimValueModal(g); });
  const modalOpen = await page.evaluate(() => document.getElementById('modal-dim-value').classList.contains('open'));
  await page.fill('#dim-value-input', '250');
  await page.press('#dim-value-input', 'Enter');
  const afterModal = await page.evaluate(() => {
    const g = App.canvas.getObjects().find(o => o.data?.type === 'dimension');
    return { label: dimensionValueText(g), open: document.getElementById('modal-dim-value').classList.contains('open') };
  });
  console.log(modalOpen && afterModal.label === '250,00 cm' && !afterModal.open ? 'OK  modale : 250 → 250,00 cm, fermée' : 'FAIL modale ' + JSON.stringify(afterModal));

  // Vrai double-clic souris sur la ligne de cote → modale
  await page.evaluate(() => { App.canvas.discardActiveObject(); App.canvas.requestRenderAll(); });
  const scr = await page.evaluate(() => {
    const g = App.canvas.getObjects().find(o => o.data?.type === 'dimension');
    const m = g.data.offsetPt; const v = App.canvas.viewportTransform; const r = App.canvas.upperCanvasEl.getBoundingClientRect();
    return { x: r.left + m.x * v[0] + v[4], y: r.top + m.y * v[3] + v[5] };
  });
  await page.mouse.dblclick(scr.x, scr.y);
  await page.waitForTimeout(200);
  const dbl = await page.evaluate(() => ({ open: document.getElementById('modal-dim-value').classList.contains('open'), val: document.getElementById('dim-value-input').value }));
  console.log(dbl.open ? 'OK  double-clic souris ouvre la modale (valeur ' + dbl.val + ')' : 'FAIL double-clic ' + JSON.stringify(dbl));
  if (dbl.open) await page.click('#dim-value-cancel');

  // Saisie invalide → toast, cote inchangée
  await page.evaluate(() => { const g = App.canvas.getObjects().find(o => o.data?.type === 'dimension'); App.canvas.setActiveObject(g); openDimValueModal(g); });
  await page.fill('#dim-value-input', 'abc');
  await page.press('#dim-value-input', 'Enter');
  const inval = await page.evaluate(() => ({ open: document.getElementById('modal-dim-value').classList.contains('open'), label: dimensionValueText(App.canvas.getObjects().find(o => o.data?.type === 'dimension')) }));
  console.log(inval.open && inval.label === '250,00 cm' ? 'OK  saisie invalide refusée, modale ouverte' : 'FAIL invalide ' + JSON.stringify(inval));
  await page.click('#dim-value-cancel');

  // Couleur de trait d'une cote via barre de style → enfants recolorés
  await page.evaluate(() => { const g = App.canvas.getObjects().find(o => o.data?.type === 'dimension'); App.canvas.setActiveObject(g); });
  await page.evaluate(() => { const el = document.getElementById('sb-stroke-color'); el.value = '#00aa00'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
  const dimColors = await page.evaluate(() => { const g = App.canvas.getObjects().find(o => o.data?.type === 'dimension'); return g.getObjects().map(o => o.type === 'text' ? o.fill : o.stroke); });
  console.log(dimColors.every(c => c === '#00aa00') ? 'OK  cote recolorée (lignes + texte)' : 'FAIL couleur cote ' + JSON.stringify(dimColors));

  // 2) Symbole SVG : pose, puis recoloration via barre de style et via sélecteur latéral
  await page.evaluate(() => { App.canvas.discardActiveObject(); placeSymbol(SYMBOL_CATEGORIES[0].symbols[0].id, 300, 300); });
  await page.waitForFunction(() => App.canvas.getObjects().some(o => o.data?.type === 'symbol'));
  const symInfo = await page.evaluate(() => { const s = App.canvas.getObjects().find(o => o.data?.type === 'symbol'); return { id: s.data.symbolId, type: s.type, strokes: (s.getObjects ? s.getObjects() : [s]).map(o => o.stroke) }; });
  console.log('symbole posé', JSON.stringify(symInfo));

  await page.evaluate(() => { const el = document.getElementById('sb-stroke-color'); el.value = '#ff00ff'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
  const symAfterBar = await page.evaluate(() => { const s = App.canvas.getObjects().find(o => o.data?.type === 'symbol'); return (s.getObjects ? s.getObjects() : [s]).filter(o => o.stroke && o.stroke !== 'none').map(o => o.stroke); });
  console.log(symAfterBar.length && symAfterBar.every(c => c === '#ff00ff') ? 'OK  symbole recoloré via barre de style' : 'FAIL barre de style symbole ' + JSON.stringify(symAfterBar));

  await page.evaluate(() => { const el = document.getElementById('symbol-color'); el.value = '#0000ff'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
  const symAfterSide = await page.evaluate(() => { const s = App.canvas.getObjects().find(o => o.data?.type === 'symbol'); return (s.getObjects ? s.getObjects() : [s]).filter(o => o.stroke && o.stroke !== 'none').map(o => o.stroke); });
  console.log(symAfterSide.every(c => c === '#0000ff') ? 'OK  symbole recoloré via sélecteur latéral' : 'FAIL sélecteur latéral ' + JSON.stringify(symAfterSide));

  // Sélection multiple de deux symboles → recoloration des deux
  await page.evaluate(() => placeSymbol(SYMBOL_CATEGORIES[1].symbols[0].id, 400, 400));
  await page.waitForFunction(() => App.canvas.getObjects().filter(o => o.data?.type === 'symbol').length === 2);
  await page.evaluate(() => {
    const syms = App.canvas.getObjects().filter(o => o.data?.type === 'symbol');
    App.canvas.setActiveObject(new fabric.ActiveSelection(syms, { canvas: App.canvas }));
    const el = document.getElementById('symbol-color'); el.value = '#123456'; el.dispatchEvent(new Event('change'));
  });
  const multi = await page.evaluate(() => App.canvas.getObjects().filter(o => o.data?.type === 'symbol').map(s => (s.getObjects ? s.getObjects() : [s]).filter(o => o.stroke && o.stroke !== 'none').every(o => o.stroke === '#123456')));
  console.log(multi.every(Boolean) ? 'OK  sélection multiple recolorée' : 'FAIL multi ' + JSON.stringify(multi));

  // Persistance : sérialisation puis rechargement de la page conserve la couleur des enfants
  await page.evaluate(() => { App.canvas.discardActiveObject(); saveCurrentPageObjects(); loadPageObjects(); });
  await page.waitForTimeout(300);
  const persisted = await page.evaluate(() => App.canvas.getObjects().filter(o => o.data?.type === 'symbol').map(s => (s.getObjects ? s.getObjects() : [s]).filter(o => o.stroke && o.stroke !== 'none').every(o => o.stroke === '#123456')));
  console.log(persisted.length === 2 && persisted.every(Boolean) ? 'OK  couleur conservée après sérialisation/rechargement' : 'FAIL persistance ' + JSON.stringify(persisted));

  // Historique : un glissé de 5 événements input ne crée pas 5 entrées
  const histBefore = await page.evaluate(() => App.history[1].stack.length);
  await page.evaluate(() => {
    const s = App.canvas.getObjects().find(o => o.data?.type === 'symbol'); App.canvas.setActiveObject(s);
    const el = document.getElementById('symbol-color');
    ['#111111', '#222222', '#333333', '#444444', '#555555'].forEach(c => { el.value = c; el.dispatchEvent(new Event('input')); });
    el.dispatchEvent(new Event('change'));
  });
  const histAfter = await page.evaluate(() => App.history[1].stack.length);
  console.log(histAfter - histBefore === 1 ? 'OK  historique : 1 entrée pour un glissé de couleur' : `FAIL historique +${histAfter - histBefore}`);

  await page.screenshot({ path: path.join(require('os').tmpdir(), 'annoteur-e2e.png') });
  // ---- v1.8.1 : correctifs de l'audit --------------------------------------
  // Bulle de renvoi : texte éditable via la modale, pointe exportée en vectoriel
  await page.evaluate(() => { App.canvas.discardActiveObject(); createLeader({ x: 100, y: 400 }, { x: 180, y: 360 }); });
  await page.evaluate(() => { const g = App.canvas.getObjects().find(o => o.data?.type === 'leader'); openLeaderTextModal(g); });
  await page.fill('#leader-text-input', 'Prise à déplacer');
  await page.click('#leader-text-confirm');
  const leaderTxt = await page.evaluate(() => leaderTextObject(App.canvas.getObjects().find(o => o.data?.type === 'leader')).text);
  console.log(leaderTxt === 'Prise à déplacer' ? 'OK  texte de bulle modifié via la modale' : 'FAIL bulle ' + leaderTxt);

  // Mesure libre : le polygone temporaire ne doit pas être sérialisé par un tampon posé pendant qu'il est affiché
  await page.evaluate(() => {
    setActiveTool('areapoly');
    [{ x: 300, y: 500 }, { x: 400, y: 500 }, { x: 400, y: 600 }].forEach(p => toolAreaPoly_down(p));
    toolAreaPoly_finish(App.canvas);
    placeStamp(STAMPS[0].id);                 // saveHistoryState pendant l'overlay
  });
  const leaked = await page.evaluate(() => (App.pageData[1].objects || []).filter(o => o.type === 'polygon' && o.stroke === '#2090ff').length);
  console.log(leaked === 0 ? 'OK  polygone de mesure libre non sérialisé' : 'FAIL fuite mesure libre ' + leaked);
  await page.evaluate(() => { setActiveTool('select'); });

  // Calque masqué : `visible` n'est plus persisté, et l'export vectoriel sort les objets du calque coché
  const hidden = await page.evaluate(async () => {
    const layer = App.layers[0];
    toggleLayerVisibility(layer.id);
    saveCurrentPageObjects();
    const persisted = App.pageData[1].objects.some(o => 'visible' in o);
    const bytesHidden = await exportPdfVector([layer.id]);
    const bytesNone   = await exportPdfVector([]);
    toggleLayerVisibility(layer.id);
    return { persisted, delta: bytesHidden.length - bytesNone.length };
  });
  console.log(!hidden.persisted && hidden.delta > 500 ? `OK  calque masqué exporté quand même (+${hidden.delta} o)` : 'FAIL calque masqué ' + JSON.stringify(hidden));

  // Calibration « toutes les pages » : les étiquettes de la page 1 sont recalculées depuis la page 2
  const allPages = await page.evaluate(async () => {
    await switchPage(2);
    setPageCalibration(scaleToPointsPerUnit(50, 'cm'), 'cm');    // 1:50 au lieu de 1:100
    applyCalibrationToAllPages();
    const dim = App.pageData[1].objects.find(o => o.data?.type === 'dimension');
    const txt = dim.objects.find(c => c.type === 'text').text;
    await switchPage(1);
    const live = dimensionValueText(App.canvas.getObjects().find(o => o.data?.type === 'dimension'));
    return { txt, live };
  });
  console.log(allPages.txt === '125,00 cm' && allPages.live === '125,00 cm' ? 'OK  calibration toutes pages : 250 cm à 1:100 → 125 cm à 1:50' : 'FAIL calibration toutes pages ' + JSON.stringify(allPages));

  // loadProject remplace l'état : objets des pages absentes du projet et historique effacés
  const replaced = await page.evaluate(async () => {
    const proj = JSON.parse(JSON.stringify(buildProjectData()));
    delete proj.pages['1'].objects; proj.pages['1'].objects = [];   // le projet ne contient plus rien en page 1
    proj.pages['2'] = { objects: [] };
    const before = App.canvas.getObjects().filter(o => !isTempObject(o)).length;
    await loadProject(JSON.stringify(proj));
    await new Promise(r => setTimeout(r, 300));
    return { before, after: App.canvas.getObjects().filter(o => !isTempObject(o)).length, hist: App.history[1]?.stack.length || 0 };
  });
  console.log(replaced.before > 0 && replaced.after === 0 && replaced.hist <= 1 ? 'OK  loadProject remplace l’état (objets et historique)' : 'FAIL loadProject ' + JSON.stringify(replaced));

  const realErrors = errors.filter(e => !/favicon|404/.test(e));
  console.log('Erreurs JS :', realErrors.length ? realErrors : 'aucune');
  if (realErrors.length) process.exitCode = 1;
  await browser.close(); server.close();
})().catch(e => { console.error('ERREUR', e); process.exit(1); });
