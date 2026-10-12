#!/usr/bin/env python3
"""
annoteur_json.py : générateur de fichiers projet .annot.json pour l'Annoteur de plans (format 2.1).

Implémentation de référence de SPEC-JSON-ANNOTEUR.md. Aucune dépendance (bibliothèque standard).
Toutes les coordonnées sont en POINTS PDF, origine en haut à gauche de la page AFFICHÉE
(rotation du PDF comprise), axe Y vers le bas.

Usage minimal :
    from annoteur_json import Projet
    p = Projet("plans.pdf", 8422662, {1: dict(w=1190.52, h=841.68, echelle=50, unite="cm")})
    c = p.calque("Meubles", "#a060e0")
    p.symbole(1, c, "lit-double", cx=300, cy=200, angle=90)
    p.texte(1, c, "Chambre 1", x=120, y=80, taille=14)
    p.sauver("plans.annot.json")
"""
import json, math, copy, pathlib

ICI = pathlib.Path(__file__).resolve().parent
PALETTE = ['#e05c5c', '#f0a030', '#50c060', '#50b8e0', '#a060e0', '#e060a0', '#80c040', '#40a0c0']
MM_PAR_UNITE = {'m': 1000, 'cm': 10, 'mm': 1}
MM_PAR_POINT = 25.4 / 72
COULEUR_COMPTAGE = ['#e05c5c', '#f0a030', '#50c060', '#50b8e0', '#a060e0', '#e060a0']


# ---------- utilitaires numériques ----------------------------------------------------
def points_par_unite(denominateur, unite):
    """Échelle 1:N -> nombre de points PDF par unité réelle (copie de geometry.js)."""
    return MM_PAR_UNITE[unite] / (MM_PAR_POINT * denominateur)


def fr(v, dec=2):
    """Nombre au format fr-FR de l'app : virgule décimale, espace fine insécable (U+202F) entre milliers."""
    s = f"{abs(v):,.{dec}f}".replace(',', ' ').replace('.', ',')
    return ('-' if v < 0 else '') + s


def fmt_longueur(pt, calib):
    if not calib:
        return f"{fr(round(pt), 0)} pt"
    v, u = pt / calib['pointsPerUnit'], calib['unit']
    if u == 'cm' and v > 999:
        v, u = v / 100, 'm'
    return f"{fr(v)} {u}"


def fmt_surface(pt2, calib):
    if not calib:
        return f"{fr(round(pt2), 0)} pt²"
    v, u = pt2 / calib['pointsPerUnit'] ** 2, calib['unit']
    if u == 'cm' and v > 999:
        v, u = v / 10000, 'm'
    return f"{fr(v)} {u}²"


def _rot(x, y, deg):
    a = math.radians(deg)
    return x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)


def _ligne_abs(a, b, **style):
    """Line Fabric à partir de deux points ABSOLUS (conversion en repère groupe faite plus tard)."""
    return {'_abs': (a, b), 'type': 'line', **style}


def _texte_bbox(txt, taille, cx, cy, angle, ox, oy):
    lignes = txt.split('\n')
    w = max(len(l) for l in lignes) * taille * 0.56
    h = len(lignes) * taille * 1.13
    dx = {'left': 0, 'center': -w / 2, 'right': -w}[ox]
    dy = {'top': 0, 'center': -h / 2, 'bottom': -h}[oy]
    pts = []
    for x, y in ((0, 0), (w, 0), (w, h), (0, h)):
        rx, ry = _rot(x + dx, y + dy, angle)
        pts.append((cx + rx, cy + ry))
    return pts


def _grouper(enfants, data, **opts):
    """Assemble des enfants décrits en coordonnées absolues en un groupe Fabric cohérent.
    Chaque enfant : {'_abs': ((x1,y1),(x2,y2))} pour une ligne, ou {'_pos': (x,y), '_bbox': [pts]} sinon.
    Le groupe prend pour boîte l'union des boîtes ; les enfants sont exprimés par rapport à son centre."""
    pts = []
    for e in enfants:
        if '_abs' in e:
            pts += list(e['_abs'])
        pts += e.get('_bbox', [])
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    gx, gy, gw, gh = min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)
    cx, cy = gx + gw / 2, gy + gh / 2
    out = []
    for e in enfants:
        e = dict(e)
        if '_abs' in e:
            (ax, ay), (bx, by) = e.pop('_abs')
            mx, my = (ax + bx) / 2, (ay + by) / 2
            e.update(left=min(ax, bx) - cx, top=min(ay, by) - cy, width=abs(bx - ax), height=abs(by - ay),
                     x1=ax - mx, y1=ay - my, x2=bx - mx, y2=by - my)
        else:
            px, py = e.pop('_pos')
            e.update(left=px - cx, top=py - cy)
            e.pop('_bbox', None)
        out.append(e)
    return {'type': 'group', 'left': gx, 'top': gy, 'width': gw, 'height': gh, 'objects': out,
            'data': data, **opts}


# ---------- projet ----------------------------------------------------------------------
class Projet:
    def __init__(self, pdf_nom, pdf_octets, pages):
        """pages : {n: dict(w=, h=, rotation=0, echelle=None, unite='cm', pointsParUnite=None)}
        w/h = taille de la page AFFICHÉE en points (après rotation). `echelle` = dénominateur N de 1:N
        (ou `pointsParUnite` si l'échelle a été mesurée). Sans l'un ni l'autre : page non calibrée."""
        self.source = {'fileName': pdf_nom, 'byteSize': pdf_octets, 'pageCount': len(pages)}
        self.pages = {}
        for n, d in pages.items():
            pg = {'rotation': d.get('rotation', 0), 'objects': [], 'pageW': d['w'], 'pageH': d['h']}
            ppu = d.get('pointsParUnite') or (points_par_unite(d['echelle'], d.get('unite', 'cm')) if d.get('echelle') else None)
            if ppu:
                pg['calibration'] = {'pointsPerUnit': ppu, 'unit': d.get('unite', 'cm')}
            self.pages[int(n)] = pg
        self.layers = []
        self._gab = None

    # -- calques
    def calque(self, nom, couleur=None):
        cid = max([l['id'] for l in self.layers], default=0) + 1
        self.layers.append({'id': cid, 'name': nom, 'visible': True, 'locked': False,
                            'color': couleur or PALETTE[(cid - 1) % len(PALETTE)]})
        return cid

    # -- ajout générique
    def _ajouter(self, page, calque, obj, **data):
        if calque not in [l['id'] for l in self.layers]:
            raise ValueError(f"calque {calque} inconnu")
        d = dict(obj.pop('data', {}))
        d.update(data)
        d.update(layerId=calque, pageNum=int(page))
        obj['data'] = d
        self.pages[int(page)]['objects'].append(obj)
        return obj

    def _calib(self, page):
        return self.pages[int(page)].get('calibration')

    def _pts_par_cm(self, page):
        c = self._calib(page)
        if not c:
            return None
        return {'m': c['pointsPerUnit'] / 100, 'cm': c['pointsPerUnit'], 'mm': c['pointsPerUnit'] * 10}[c['unit']]

    # -- objets simples
    def texte(self, page, calque, texte, x, y, taille=14, couleur='#000000', largeur=200, fond='', gras=False, angle=0):
        return self._ajouter(page, calque, {
            'type': 'textbox', 'left': x, 'top': y, 'width': largeur, 'text': texte, 'fontSize': taille,
            'fill': couleur, 'fontFamily': 'Arial', 'fontWeight': 'bold' if gras else 'normal',
            'backgroundColor': fond, 'textAlign': 'left', 'angle': angle})

    def rect(self, page, calque, x, y, w, h, trait='#e53e3e', epaisseur=2, remplissage='transparent', angle=0, tirets=None):
        return self._ajouter(page, calque, {
            'type': 'rect', 'left': x, 'top': y, 'width': w, 'height': h, 'fill': remplissage, 'stroke': trait,
            'strokeWidth': epaisseur, 'strokeUniform': True, 'strokeDashArray': tirets, 'angle': angle, 'rx': 0, 'ry': 0})

    def ellipse(self, page, calque, x, y, rx, ry, trait='#e53e3e', epaisseur=2, remplissage='transparent'):
        return self._ajouter(page, calque, {
            'type': 'ellipse', 'left': x, 'top': y, 'rx': rx, 'ry': ry, 'width': 2 * rx, 'height': 2 * ry,
            'fill': remplissage, 'stroke': trait, 'strokeWidth': epaisseur, 'strokeUniform': True})

    def ligne(self, page, calque, x1, y1, x2, y2, trait='#e53e3e', epaisseur=2, tirets=None):
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        return self._ajouter(page, calque, {
            'type': 'line', 'left': min(x1, x2), 'top': min(y1, y2), 'width': abs(x2 - x1), 'height': abs(y2 - y1),
            'x1': x1 - mx, 'y1': y1 - my, 'x2': x2 - mx, 'y2': y2 - my, 'fill': '', 'stroke': trait,
            'strokeWidth': epaisseur, 'strokeUniform': True, 'strokeDashArray': tirets})

    def polygone(self, page, calque, points, trait='#e53e3e', epaisseur=2, remplissage='transparent', ferme=True):
        """points : [(x,y),...] absolus. Ne PAS fournir left/top/width/height : Fabric les recalcule."""
        return self._ajouter(page, calque, {
            'type': 'polygon' if ferme else 'polyline', 'points': [{'x': x, 'y': y} for x, y in points],
            'fill': remplissage, 'stroke': trait, 'strokeWidth': epaisseur, 'strokeUniform': True})

    def nuage(self, page, calque, x1, y1, x2, y2, trait='#e53e3e', epaisseur=2):
        return self._ajouter(page, calque, {
            'type': 'path', 'path': _chemin_nuage(x1, y1, x2, y2), 'fill': 'transparent', 'stroke': trait,
            'strokeWidth': epaisseur}, type='cloud')

    # -- objets métier
    def cote(self, page, calque, p1, p2, ecartement=30, couleur='#2090ff', taille=12, tirets=None):
        """Cote entre p1 et p2 (absolus). `ecartement` = distance signée de la ligne de cote (+ = côté gauche
        du vecteur p1->p2 en repère Y vers le bas, voir spec §6.3). Le libellé est calculé depuis la calibration."""
        (x1, y1), (x2, y2) = p1, p2
        dx, dy = x2 - x1, y2 - y1
        ln = math.hypot(dx, dy) or 1
        nx, ny = -dy / ln, dx / ln
        off = ecartement
        c1 = (x1 + nx * off, y1 + ny * off); c2 = (x2 + nx * off, y2 + ny * off)
        s = 1 if off >= 0 else -1
        gap, ov, tick = 3, 6, 7
        e1s = (x1 + nx * gap * s, y1 + ny * gap * s); e1e = (c1[0] + nx * ov * s, c1[1] + ny * ov * s)
        e2s = (x2 + nx * gap * s, y2 + ny * gap * s); e2e = (c2[0] + nx * ov * s, c2[1] + ny * ov * s)
        ux, uy = dx / ln, dy / ln
        dgx, dgy = ux + nx, uy + ny
        dn = math.hypot(dgx, dgy) or 1
        dgx, dgy = dgx / dn, dgy / dn
        mid = ((c1[0] + c2[0]) / 2, (c1[1] + c2[1]) / 2)
        ang = math.degrees(math.atan2(dy, dx))
        ang_txt = ang + 180 if (ang > 90 or ang < -90) else ang
        ang_txt = ((ang_txt + 180) % 360) - 180
        ls = dict(fill='', stroke=couleur, strokeWidth=1, strokeUniform=True, strokeDashArray=tirets)
        ext = dict(ls, strokeDashArray=None)
        label = fmt_longueur(ln, self._calib(page))
        enfants = [
            _ligne_abs(e1s, e1e, **ext), _ligne_abs(e2s, e2e, **ext), _ligne_abs(c1, c2, **ls),
            _ligne_abs((c1[0] - dgx * tick, c1[1] - dgy * tick), (c1[0] + dgx * tick, c1[1] + dgy * tick), **ls),
            _ligne_abs((c2[0] - dgx * tick, c2[1] - dgy * tick), (c2[0] + dgx * tick, c2[1] + dgy * tick), **ls),
            {'type': 'text', 'text': label, 'fontSize': taille, 'fill': couleur, 'originX': 'center', 'originY': 'bottom',
             'angle': ang_txt, 'backgroundColor': 'rgba(255,255,255,0.82)', '_pos': mid,
             '_bbox': _texte_bbox(label, taille, mid[0], mid[1], ang_txt, 'center', 'bottom')},
        ]
        g = _grouper(enfants, {'type': 'dimension', 'pointLength': ln, 'p1': {'x': x1, 'y': y1}, 'p2': {'x': x2, 'y': y2},
                               'offsetPt': {'x': mid[0], 'y': mid[1]}}, lockScalingX=True, lockScalingY=True)
        return self._ajouter(page, calque, g)

    def etiquette_surface(self, page, calque, points, couleur='#e53e3e', taille=13):
        """Étiquette « surface + périmètre » au centre (moyenne des sommets) du polygone `points`."""
        n = len(points)
        aire = abs(sum(points[i][0] * points[(i + 1) % n][1] - points[(i + 1) % n][0] * points[i][1] for i in range(n))) / 2
        per = sum(math.hypot(points[(i + 1) % n][0] - points[i][0], points[(i + 1) % n][1] - points[i][1]) for i in range(n))
        cal = self._calib(page)
        cx, cy = sum(p[0] for p in points) / n, sum(p[1] for p in points) / n
        return self._ajouter(page, calque, {
            'type': 'text', 'left': cx, 'top': cy, 'originX': 'center', 'originY': 'center', 'fontSize': taille, 'fill': couleur,
            'fontFamily': 'Arial', 'textAlign': 'center', 'backgroundColor': 'rgba(255,255,255,0.82)',
            'text': f"{fmt_surface(aire, cal)}\n{fmt_longueur(per, cal)} de périmètre"},
            type='areaLabel', areaPt2=aire, perimeterPt=per, sourceType='polygon')

    def compteur(self, page, calque, categorie, x, y, index=None):
        """Repère numéroté. `index` : numéro suivant dans la catégorie (toutes pages) si omis."""
        if index is None:
            index = 1 + max([o['data'].get('index', 0) for pg in self.pages.values() for o in pg['objects']
                             if o['data'].get('type') == 'count' and o['data'].get('category') == categorie], default=0)
        h = 0
        for ch in (ord(c) for c in categorie):
            h = (h * 31 + ch) & 0xFFFFFFFF
        col = COULEUR_COMPTAGE[h % len(COULEUR_COMPTAGE)]
        r = max(6, self.pages[int(page)]['pageW'] / 90)
        sw = max(1, r / 6)
        t = 2 * r + sw
        return self._ajouter(page, calque, {
            'type': 'group', 'left': x, 'top': y, 'originX': 'center', 'originY': 'center', 'width': t, 'height': t,
            'hasControls': False,
            'objects': [
                {'type': 'circle', 'originX': 'center', 'originY': 'center', 'left': 0, 'top': 0, 'radius': r,
                 'fill': 'rgba(255,255,255,0.9)', 'stroke': col, 'strokeWidth': sw, 'strokeUniform': True},
                {'type': 'text', 'originX': 'center', 'originY': 'center', 'left': 0, 'top': 0, 'text': str(index),
                 'fontSize': r * 1.15, 'fill': col, 'fontFamily': 'Arial', 'fontWeight': 'bold'}]},
            type='count', category=categorie, index=index)

    def bulle(self, page, calque, pointe, texte_xy, texte='Annotation', taille=13, couleur='#e53e3e', couleur_texte='#000000', epaisseur=1):
        """Bulle de renvoi : flèche au point `pointe`, texte à `texte_xy`."""
        (fx, fy), (tx, ty) = pointe, texte_xy
        ang = math.atan2(ty - fy, tx - fx)
        tete = taille * 0.55
        larg = taille * 10
        gauche = tx < fx
        # boîte du texte (origine droite si le texte est à gauche de la pointe)
        bx0 = tx - larg if gauche else tx
        by0 = ty - taille
        lignes = max(1, texte.count('\n') + 1)
        bh = taille * 1.13 * lignes
        pts_tr = [(fx + dx, fy + dy) for dx in (-tete, tete) for dy in (-tete, tete)]
        enfants = [
            _ligne_abs((fx, fy), (tx, ty), fill='', stroke=couleur, strokeWidth=epaisseur, strokeUniform=True),
            {'type': 'triangle', 'originX': 'center', 'originY': 'center', 'width': tete * 1.4, 'height': tete * 2,
             'fill': couleur, 'angle': math.degrees(ang) + 90, '_pos': (fx, fy), '_bbox': pts_tr},
            {'type': 'textbox', 'text': texte, 'width': larg, 'fontSize': taille, 'fill': couleur_texte, 'fontFamily': 'Arial',
             'backgroundColor': 'rgba(255,255,255,0.82)', 'originX': 'right' if gauche else 'left', 'originY': 'top',
             '_pos': (tx, by0), '_bbox': [(bx0, by0), (bx0 + larg, by0 + bh)]},
        ]
        return self._ajouter(page, calque, _grouper(enfants, {'type': 'leader'}))

    # -- symboles
    def _gabarits(self):
        if self._gab is None:
            self._gab = json.load(open(ICI / 'symboles-gabarits.json', encoding='utf-8'))['symboles']
        return self._gab

    def symbole(self, page, calque, symbole_id, cx, cy, angle=0, largeur=None, hauteur=None, couleur=None):
        """Pose le symbole `symbole_id` centré sur (cx, cy).
        Taille : réelle (realW_cm x realH_cm) si la page est calibrée et le symbole dimensionné, sinon taille par défaut.
        `largeur`/`hauteur` (en points) forcent la taille. `couleur` : recolore les traits (comme la barre de style)."""
        gab = self._gabarits()
        if symbole_id not in gab:
            raise ValueError(f"symbole inconnu : {symbole_id}")
        g = gab[symbole_id]
        obj = copy.deepcopy(g['objet'])
        ppc = self._pts_par_cm(page)
        if largeur is None or hauteur is None:
            if ppc and g['realW_cm'] is not None:
                W, H = g['realW_cm'] * ppc, g['realH_cm'] * ppc
            else:
                W, H = g['defaultW'], g['defaultH']
            largeur = largeur or W
            hauteur = hauteur or H
        obj['scaleX'] = largeur / obj['width']
        obj['scaleY'] = hauteur / obj['height']
        ox, oy = _rot(largeur / 2, hauteur / 2, angle)
        obj['left'], obj['top'], obj['angle'] = cx - ox, cy - oy, angle
        if couleur:
            _recolorer(obj, couleur)
        return self._ajouter(page, calque, obj)

    # -- sortie
    def donnees(self):
        return {'version': '2.1', 'appVersion': '1.8.3', 'savedAt': None, 'source': self.source,
                'totalPages': len(self.pages), 'nextLayerId': max([l['id'] for l in self.layers], default=0) + 1,
                'layers': self.layers, 'activeLayerId': self.layers[0]['id'] if self.layers else None,
                'pages': {str(n): pg for n, pg in sorted(self.pages.items())}}

    def sauver(self, chemin):
        import datetime
        d = self.donnees()
        d['savedAt'] = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
        erreurs = verifier(d)
        if erreurs:
            raise ValueError("Projet invalide :\n- " + "\n- ".join(erreurs))
        pathlib.Path(chemin).write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding='utf-8')
        return chemin


# ---------- helpers de forme ---------------------------------------------------------
def _fond_symbole(fill):
    return (not fill) or fill in ('none', 'transparent') or str(fill).lower() in ('white', '#ffffff', '#fff', 'rgb(255,255,255)')


def _recolorer(o, couleur):
    """Même règle que recolorSymbolObjects (app.js) : trait -> couleur ; remplissage -> couleur sauf fond blanc/transparent."""
    for c in o.get('objects', [o]):
        if c.get('stroke') and c['stroke'] != 'none':
            c['stroke'] = couleur
        if not _fond_symbole(c.get('fill')):
            c['fill'] = couleur


def _chemin_nuage(x1, y1, x2, y2, r=None):
    """Chemin SVG (arcs) d'un nuage de révision, même algorithme que makeRevisionCloudPath."""
    w, h = x2 - x1, y2 - y1
    r = r or max(8, min(30, 2 * (w + h) / 20))
    d, premier = '', True
    for ax, ay, bx, by in ((x1, y1, x2, y1), (x2, y1, x2, y2), (x2, y2, x1, y2), (x1, y2, x1, y1)):
        n = max(1, round(math.hypot(bx - ax, by - ay) / (r * 2)))
        for j in range(n):
            t0, t1 = j / n, (j + 1) / n
            p0 = (ax + (bx - ax) * t0, ay + (by - ay) * t0)
            p1 = (ax + (bx - ax) * t1, ay + (by - ay) * t1)
            if premier:
                d += f"M {p0[0]:.1f} {p0[1]:.1f} "
                premier = False
            d += f"A {r:.1f} {r:.1f} 0 0 1 {p1[0]:.1f} {p1[1]:.1f} "
    return d + 'Z'


# ---------- contrôle avant livraison ---------------------------------------------------
TYPES_OBJET = {'textbox', 'text', 'rect', 'ellipse', 'circle', 'line', 'polygon', 'polyline', 'path', 'group', 'triangle'}


def verifier(d, symboles=None):
    """Retourne la liste des erreurs bloquantes (vide = projet conforme à la spec)."""
    e = []
    if d.get('version') != '2.1':
        e.append("version doit valoir '2.1'")
    if not all(k in d for k in ('source', 'totalPages', 'layers', 'pages', 'nextLayerId')):
        e.append("champs racine manquants")
        return e
    ids = [l['id'] for l in d['layers']]
    if len(ids) != len(set(ids)):
        e.append("identifiants de calques dupliqués")
    if d['nextLayerId'] <= max(ids, default=0):
        e.append("nextLayerId doit dépasser tous les identifiants de calques")
    if d.get('activeLayerId') not in ids and ids:
        e.append("activeLayerId inconnu")
    if d['source'].get('pageCount') != d['totalPages']:
        e.append("source.pageCount != totalPages")
    gab = symboles or json.load(open(ICI / 'symboles-gabarits.json', encoding='utf-8'))['symboles']
    for n, pg in d['pages'].items():
        if not (1 <= int(n) <= d['totalPages']):
            e.append(f"page {n} hors document")
        cal = pg.get('calibration')
        if cal and not (cal['pointsPerUnit'] > 0 and cal['unit'] in MM_PAR_UNITE):
            e.append(f"page {n} : calibration invalide")
        for i, o in enumerate(pg['objects']):
            w = f"page {n} objet {i} ({o.get('type')})"
            if o.get('type') not in TYPES_OBJET:
                e.append(f"{w} : type Fabric inconnu")
            dt = o.get('data') or {}
            if dt.get('layerId') not in ids:
                e.append(f"{w} : data.layerId absent ou inconnu")
            if dt.get('pageNum') != int(n):
                e.append(f"{w} : data.pageNum != {n}")
            if dt.get('type') == 'symbol' and dt.get('symbolId') not in gab:
                e.append(f"{w} : symbolId inconnu")
            if dt.get('type') == 'dimension' and not all(k in dt for k in ('p1', 'p2', 'offsetPt', 'pointLength')):
                e.append(f"{w} : cote sans p1/p2/offsetPt/pointLength")
            for k in ('left', 'top'):
                if k in o and not isinstance(o[k], (int, float)):
                    e.append(f"{w} : {k} non numérique")
            if o.get('type') == 'textbox' and not o.get('width'):
                e.append(f"{w} : textbox sans width")
    return e


if __name__ == '__main__':
    import sys
    print("Bibliothèque : importer Projet. Contrôle d'un fichier : annoteur_json.py fichier.annot.json")
    if len(sys.argv) > 1:
        errs = verifier(json.load(open(sys.argv[1], encoding='utf-8')))
        print("OK" if not errs else "\n".join(errs))
