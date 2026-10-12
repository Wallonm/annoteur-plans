# Spec : générer un fichier projet `.annot.json` pour l'Annoteur de plans

Version de la spec : 1.0 du 12/10/2026
Application visée : Annoteur de plans v1.8.3, format de projet `2.1`, Fabric.js 5.1.0

Cette spec dit à Claude comment produire un fichier que l'Annoteur ouvre directement (Projet > Ouvrir projet…) et qui pose des annotations sur un PDF existant. Les règles viennent du code (`app.js`, `migrate.js`, `geometry.js`, `tools-metier.js`, `symbols.js`) et d'un fichier réel de 198 objets. Chaque recette a été rechargée dans l'application avec le PDF d'origine (voir §10).

Fichiers associés à placer à côté de cette spec :
- `annoteur_json.py` : générateur Python de référence (bibliothèque standard seule), avec la fonction `verifier()`.
- `symboles-gabarits.json` : les 68 symboles de la bibliothèque, prêts à copier.

## 1. Entrées nécessaires

Avant de générer, Claude réunit les éléments suivants. Il demande ce qui manque et n'invente aucune valeur.

| Élément | Source | Pourquoi |
|---|---|---|
| Nom exact du PDF | Utilisateur | Contrôlé à l'ouverture (§3, règle 3) |
| Taille du PDF en octets | `os.path.getsize` | Idem |
| Nombre de pages | PDF | `source.pageCount` et `totalPages` |
| Taille et rotation de chaque page | PDF (§5) | Repère des coordonnées |
| Échelle de chaque page | Utilisateur (1:50, 1:100…) ou cote lue sur le plan | Calibration, libellés des cotes, taille des symboles |
| Calques voulus | Utilisateur | Un objet appartient toujours à un calque |
| Position des annotations | Utilisateur, ou lecture du plan | Coordonnées en points |

Sans coordonnées fiables, Claude ne devine pas les positions. Il propose une grille de repérage ou demande un export de l'outil comme référence.

## 2. Principe

Le fichier est un JSON qui sérialise le canevas Fabric.js de chaque page, enrichi d'un bloc `data` par objet. Fabric complète les propriétés absentes avec ses valeurs par défaut. Une recette minimale suffit donc, à condition de respecter les règles du §3.

## 3. Règles impératives

1. **Unité et repère.** Tout est en points PDF (1 pt = 1/72 pouce = 0,3528 mm). Origine en haut à gauche de la page telle qu'elle est affichée, axe Y vers le bas. Une page tournée de 90 ou 270 degrés se repère dans son cadre tourné (vérifié sur la page 6 du fichier de référence, rotation 270).
2. **Version.** `"version": "2.1"` exactement. Les formats 1.0, 1.1 et 2.0 déclenchent une migration, ne jamais les générer.
3. **Correspondance avec le PDF.** `source.fileName`, `source.byteSize` et `source.pageCount` doivent correspondre au PDF ouvert dans l'outil. Sinon l'outil affiche une boîte de confirmation « Ce projet ne semble pas correspondre au PDF ouvert » (vérifié). Le chargement reste possible mais l'utilisateur doit confirmer.
4. **Le chargement remplace tout.** Les annotations, calibrations et calques déjà présents dans l'outil sont effacés. Pour compléter un projet existant, Claude part du JSON de l'utilisateur, ajoute ses objets et renvoie le fichier complet. Il ne génère jamais un fichier partiel.
5. **Rattachement.** Chaque objet de premier niveau porte `data.layerId` (un id présent dans `layers`) et `data.pageNum` (égal à la clé de la page qui le contient). Un objet dont le `pageNum` diffère de sa page est supprimé à la sauvegarde suivante (`serializePage` le filtre).
6. **Calques globaux.** Les calques sont au niveau du document, pas de la page. `nextLayerId` doit dépasser le plus grand id, `activeLayerId` doit exister.
7. **Police.** Tout texte déclare `"fontFamily": "Arial"`. Sans cela Fabric prend Times New Roman.
8. **Pas de `visible`, `selectable`, `evented`.** L'outil les recalcule depuis l'état du calque. Les persister fausse l'export d'un calque masqué.
9. **Pas de `_lastCenter`, `dimGroup`, `polyObj`** dans `data`. Ce sont des références internes retirées à la sauvegarde.
10. **Identifiants de symboles.** `data.symbolId` appartient à la liste du §7. Aucun gabarit n'existe pour les autres.

## 4. Structure racine

```json
{
  "version": "2.1",
  "appVersion": "1.8.3",
  "savedAt": "2026-10-12T09:00:00.000Z",
  "source": { "fileName": "plans.pdf", "byteSize": 8422662, "pageCount": 7 },
  "totalPages": 7,
  "nextLayerId": 3,
  "layers": [
    { "id": 1, "name": "Annotations", "visible": true, "locked": false, "color": "#e05c5c" },
    { "id": 2, "name": "Meubles", "visible": true, "locked": false, "color": "#f0a030" }
  ],
  "activeLayerId": 1,
  "pages": {
    "1": { "rotation": 0, "pageW": 1190.52, "pageH": 841.68,
           "calibration": { "pointsPerUnit": 0.5669, "unit": "cm" },
           "objects": [] }
  }
}
```

- `pages` est un objet dont les clés sont les numéros de page en chaîne (`"1"` à `"N"`). Les pages absentes restent vides.
- `calibration` est facultative. Sans elle la page n'est pas calibrée : les cotes s'affichent en `pt` et les symboles prennent leur taille par défaut.
- `unit` vaut `"m"`, `"cm"` ou `"mm"`.
- `color` d'un calque : la palette de l'outil est `#e05c5c #f0a030 #50c060 #50b8e0 #a060e0 #e060a0 #80c040 #40a0c0`.
- `pageW` et `pageH` sont recalculés par l'outil à l'affichage de la page. Les fournir reste utile, car les repères de comptage en dépendent.

## 5. Pages et calibration

**Taille et rotation.** Avec pypdf, pour chaque page : largeur et hauteur de la MediaBox (la CropBox, identique sur le fichier de référence), et `/Rotate`. Si la rotation vaut 90 ou 270, on échange largeur et hauteur. `rotation` reprend `/Rotate` (0, 90, 180 ou 270). Vérifié sur les 7 pages du fichier de référence, dont la page 6 (MediaBox 1190,52 x 841,68, `/Rotate` 270, affichée 841,68 x 1190,52).

**Calibration depuis une échelle 1:N** (formule de `geometry.js`) :

```
pointsPerUnit = mm_par_unite / (25,4 / 72 x N)      avec mm_par_unite = 1000 (m), 10 (cm), 1 (mm)
```

Exemple : 1:50 en cm donne 10 / (0,35278 x 50) = 0,5669 pt par cm.

Si l'utilisateur a mesuré une cote réelle, il vaut mieux calibrer sur cette mesure (`pointsPerUnit = longueur_en_points / longueur_réelle`). Le fichier de référence donne 0,5638 sur la page 2, proche mais différent du 1:50 théorique.

## 6. Recettes d'objets

Toutes les recettes ci-dessous ont été chargées dans l'outil. `L` désigne l'id de calque, `P` le numéro de page. Chaque objet porte `"data": { "layerId": L, "pageNum": P }`, avec des clés en plus quand c'est indiqué.

### 6.1 Texte libre

```json
{ "type": "textbox", "left": 620, "top": 120, "width": 200, "text": "Chambre 1\nRDC",
  "fontSize": 14, "fill": "#000000", "fontFamily": "Arial", "backgroundColor": "",
  "data": { "layerId": 1, "pageNum": 2 } }
```

`left` et `top` donnent le coin haut gauche. `width` est obligatoire (largeur de retour à la ligne). La hauteur se calcule seule. `\n` force un retour à la ligne. `backgroundColor` vaut `""` (transparent) ou une couleur, par exemple `"rgba(255,255,255,0.82)"`.

### 6.2 Rectangle, ellipse, ligne

```json
{ "type": "rect", "left": 620, "top": 200, "width": 80, "height": 40, "fill": "transparent",
  "stroke": "#e53e3e", "strokeWidth": 2, "strokeUniform": true, "angle": 0,
  "data": { "layerId": 1, "pageNum": 2 } }
```

- Ellipse : `type: "ellipse"`, `left` et `top` du coin haut gauche de la boîte englobante, `rx`, `ry`, et `width = 2 x rx`, `height = 2 x ry`.
- Ligne : `type: "line"`, `left`/`top` = minimum des abscisses et des ordonnées des deux extrémités, `width`/`height` = écarts absolus, puis `x1 y1 x2 y2` **relatifs au centre de la boîte** (centre = milieu du segment). Exemple de (100,250) à (300,280) : `x1:-100, y1:-15, x2:100, y2:15`.
- Trait pointillé : `"strokeDashArray": [8, 4]`. Pointillé fin : `[2, 4]`.
- Remplissage translucide : `"fill": "rgba(255,200,0,0.25)"`.

### 6.3 Polygone et polyligne

```json
{ "type": "polygon", "points": [ {"x":620,"y":330}, {"x":720,"y":330}, {"x":720,"y":410}, {"x":640,"y":430} ],
  "fill": "transparent", "stroke": "#e53e3e", "strokeWidth": 2, "strokeUniform": true,
  "data": { "layerId": 1, "pageNum": 2 } }
```

Points en coordonnées absolues de la page. **Ne pas fournir `left`, `top`, `width`, `height`** : Fabric les recalcule à partir des points. Pour une ligne brisée ouverte, `type: "polyline"`.

### 6.4 Nuage de révision

```json
{ "type": "path", "path": "M 620.0 460.0 A 16.0 16.0 0 0 1 652.0 460.0 ... Z",
  "fill": "transparent", "stroke": "#e53e3e", "strokeWidth": 2,
  "data": { "layerId": 1, "pageNum": 2, "type": "cloud" } }
```

`path` accepte une chaîne SVG avec des arcs (vérifié, Fabric la convertit). Là encore, pas de `left`/`top`. `annoteur_json.py` fournit `_chemin_nuage(x1, y1, x2, y2)` qui reproduit l'algorithme de l'outil (arcs de rayon `max(8, min(30, périmètre/20))`).

### 6.5 Cote

Une cote est un groupe de 6 enfants : deux lignes de rappel, la ligne de cote, deux traits d'extrémité obliques et un texte. Le libellé est **figé dans le JSON** : l'outil ne le recalcule qu'après une recalibration ou une édition de la cote. Claude doit donc le calculer lui-même.

Données de départ : `p1`, `p2` (points mesurés) et `ecartement` (distance signée de la ligne de cote).

```
len   = distance(p1, p2)
n     = (-(p2.y - p1.y), p2.x - p1.x) / len          normale
c1    = p1 + n x ecartement        c2 = p2 + n x ecartement
sens  = +1 si ecartement >= 0 sinon -1
rappel 1 : de p1 + n x 3 x sens  à  c1 + n x 6 x sens       (idem pour p2, c2)
ligne de cote : c1 -> c2
extrémités : traits de 7 pt de demi-longueur centrés sur c1 et sur c2, dirigés selon normalisé(u + n), u = (p2 - p1) / len
texte : au milieu de c1 et c2, originX "center", originY "bottom", fontSize 12,
        angle = angle(p1->p2) en degrés, retourné de 180 si hors de [-90, 90] (jamais à l'envers)
        fond "rgba(255,255,255,0.82)"
```

Le signe : pour une cote horizontale tracée de gauche à droite, un écartement positif place la ligne de cote **sous** les points mesurés. Pour une cote verticale tracée de haut en bas, positif place la ligne à gauche (vérifié).

Libellé : `len / pointsPerUnit` au format français, deux décimales, séparateur de milliers = espace fine insécable (U+202F), puis l'unité. Si l'unité est `cm` et la valeur dépasse 999, conversion en `m`. Sans calibration : valeur arrondie suivie de `pt`. Exemple : 300 pt à 0,5638 pt/cm donne `532,10 cm`.

Le groupe porte :

```json
"data": { "type": "dimension", "layerId": 1, "pageNum": 2, "pointLength": 300,
          "p1": {"x":150,"y":700}, "p2": {"x":450,"y":700}, "offsetPt": {"x":300,"y":730} }
```

`offsetPt` est le milieu de la ligne de cote. `pointLength` doit être égal à `len`. Avec `"lockScalingX": true, "lockScalingY": true`.

Géométrie interne : `left`/`top`/`width`/`height` du groupe = boîte englobante de ses enfants. Chaque enfant est exprimé **par rapport au centre du groupe** : `left = minX_enfant - centre_x`, `top = minY_enfant - centre_y`. Pour les lignes, `x1 y1 x2 y2` sont relatifs au centre de la ligne (comme au §6.2). Le code de référence est `Projet.cote()` dans `annoteur_json.py`.

### 6.6 Étiquette de surface

Texte `type: "text"` (pas `textbox`), centré sur la moyenne des sommets du polygone mesuré :

```json
{ "type": "text", "left": 670, "top": 372, "originX": "center", "originY": "center",
  "fontSize": 13, "fill": "#e53e3e", "fontFamily": "Arial", "textAlign": "center",
  "backgroundColor": "rgba(255,255,255,0.82)", "text": "1,01 m²\n425,68 cm de périmètre",
  "data": { "type": "areaLabel", "layerId": 1, "pageNum": 2,
            "areaPt2": 3200, "perimeterPt": 240, "sourceType": "polygon" } }
```

`areaPt2` : aire du polygone en points carrés (formule des lacets). `perimeterPt` : périmètre fermé en points. Le texte applique `pointsPerUnit²` pour la surface (conversion `cm²` vers `m²` au-delà de 999) et le format de longueur du §6.5 pour le périmètre.

### 6.7 Compteur

Repère numéroté, groupe centré :

```json
{ "type": "group", "left": 900, "top": 200, "originX": "center", "originY": "center",
  "width": 28.66, "height": 28.66, "hasControls": false,
  "objects": [
    { "type": "circle", "originX": "center", "originY": "center", "left": 0, "top": 0, "radius": 13.23,
      "fill": "rgba(255,255,255,0.9)", "stroke": "#e05c5c", "strokeWidth": 2.2, "strokeUniform": true },
    { "type": "text", "originX": "center", "originY": "center", "left": 0, "top": 0, "text": "1",
      "fontSize": 15.21, "fill": "#e05c5c", "fontFamily": "Arial", "fontWeight": "bold" } ],
  "data": { "type": "count", "category": "Prises", "index": 1, "layerId": 1, "pageNum": 2 } }
```

- Rayon `r = max(6, pageW / 90)`. Épaisseur `max(1, r / 6)`. Police `r x 1,15`. Taille du groupe `2r + épaisseur`.
- `index` : numéro suivant dans la catégorie, **toutes pages confondues**.
- Couleur : table `#e05c5c #f0a030 #50c060 #50b8e0 #a060e0 #e060a0` indexée par `h mod 6`, avec `h = (h x 31 + code_caractère) mod 2^32` calculé sur chaque caractère du nom de catégorie. Le comptage du relevé (onglet Relevé, export CSV) lit `data.category` et `data.index`.

### 6.8 Bulle de renvoi

Groupe de 3 enfants : ligne, pointe triangulaire à l'endroit désigné, zone de texte. Voir `Projet.bulle()`. Paramètres de l'outil : taille de police `s`, pointe de `0,55 x s`, zone de texte de largeur `10 x s` placée à `top = y_texte - s`, ancrée à droite si le texte est à gauche de la pointe. `data.type` vaut `"leader"`.

### 6.9 Objets non générés

- **Tampons** (`data.type: "stamp"`) : portent la date du jour et se posent à la main.
- **Groupes utilisateur** (`data.type: "usergroup"`) : produits par l'action Grouper de l'outil.
- Si un JSON existant en contient, Claude les recopie tels quels, sans les modifier.

## 7. Symboles

Source : `symboles-gabarits.json` (68 symboles, extraits de `symbols.js` v1.8.3 par l'application elle-même).

Identifiants par catégorie :

- architecture : porte-simple, porte-double, fenetre, escalier, colonne, cheminee
- chambre : lit-simple, lit-double, lit-enfant, armoire, dressing, table-nuit, commode, pax-100, pax-50
- sejour : canape, canape-angle, fauteuil, table-basse-carree, table-ovale, table-basse, tv-murale, tv-meuble, table-ronde, table-rect, table-a-manger, chaise, tabouret, bureau, bureau-angle, biblio-60, biblio-80, biblio-100
- cuisine : meuble-bas-60, meuble-bas-120, meuble-haut-60, placard-bas-60, placard-haut-60, plan-travail-angle, evier-simple-60, evier-double, plaque, four-encastre, lave-vaisselle, hotte, frigo
- sdb : wc, lavabo, baignoire, barriere-bain, lave-mains, douche, bidet, lave-linge, evier, chauffe-eau
- equipements : radiateur
- formes : fleche-simple, fleche-droite, fleche-double, triangle, losange, hexagone, croix, ellipse-sym, nuage, ligne-rupture, niveau

Chaque entrée du fichier contient `realW_cm`, `realH_cm` (dimensions réelles, `null` pour les formes graphiques), `defaultW`, `defaultH` et `objet` (l'objet Fabric à copier : `left` = `top` = 0, échelle 1, angle 0).

**Pose d'un symbole centré en (cx, cy), tourné de `a` degrés :**

```
W, H   = realW_cm x pts_par_cm, realH_cm x pts_par_cm      si la page est calibrée et realW_cm n'est pas null
         defaultW, defaultH                                  sinon
pts_par_cm = pointsPerUnit (cm) | pointsPerUnit / 100 (m) | pointsPerUnit x 10 (mm)
scaleX = W / objet.width        scaleY = H / objet.height
(dx, dy) = rotation de (W/2, H/2) d'un angle a      dx = W/2 cos a - H/2 sin a    dy = W/2 sin a + H/2 cos a
left = cx - dx        top = cy - dy        angle = a
data = { "type": "symbol", "symbolId": id, "layerId": L, "pageNum": P }
```

La rotation de Fabric se fait autour du coin haut gauche du groupe, d'où la correction (dx, dy). Vérifié : un `lit-double` posé en (400, 150) à 90 degrés a son centre exactement à cet endroit.

**Couleur.** Règle de l'outil (`recolorSymbolObjects`) : sur chaque enfant, le trait prend la couleur choisie, le remplissage aussi sauf s'il est blanc, transparent ou vide. Le noir par défaut ne modifie rien.

**Symboles non groupés.** Dix gabarits ne sont pas des groupes : `colonne` (rect), `ellipse-sym` (ellipse) et huit tracés (`fleche-droite`, `fleche-double`, `triangle`, `losange`, `hexagone`, `croix`, `nuage`, `ligne-rupture`). Même formule de pose, la couleur s'applique à l'objet lui-même.

Si un symbole manque, Claude peut copier l'objet d'un symbole de même `symbolId` déjà présent dans un JSON de l'utilisateur, mais jamais en inventer la géométrie.

## 8. Valeurs de style de référence

Relevées sur le fichier réel (plans A3 de 1190 x 842 pt) et sur les réglages par défaut de l'outil. À proportionner à la largeur de page.

| Élément | Valeur |
|---|---|
| Texte | `fontSize` 12 à 16, Arial, couleur d'annotation `#ff0000` ou `#000000` |
| Trait de forme | `strokeWidth` 2, couleur `#e53e3e` (rouge par défaut de l'outil) |
| Cote | `strokeWidth` 1, couleur `#2090ff` dans le fichier de référence, police 12 |
| Surface | police 13, fond `rgba(255,255,255,0.82)` |
| Grande page (3676 x 2599 pt) | objets de la page 1 du fichier de référence agrandis d'un facteur 3,52 (`scaleX`) |

## 9. Procédure de génération

1. Réunir les entrées du §1.
2. Lire le PDF (pypdf) : nombre de pages, taille en octets, dimensions et rotation de chaque page.
3. Définir calibrations et calques.
4. Générer les objets avec `annoteur_json.py`, ou à la main en suivant le §6.
5. Contrôler avec `verifier()` (ou `python annoteur_json.py fichier.annot.json`). Ce contrôle couvre la version, les calques, les `pageNum`, les `symbolId`, les champs d'une cote et la largeur des textbox.
6. Écrire le fichier sous le nom `<nom-du-pdf-sans-extension>.annot.json` (convention de l'outil).
7. Dire à l'utilisateur : ouvrir d'abord le PDF dans l'outil, puis Projet > Ouvrir projet…, et vérifier visuellement une page avant de continuer.

Exemple complet :

```python
from annoteur_json import Projet
p = Projet("plans.pdf", 8422662, {
    1: dict(w=1190.52, h=841.68, echelle=50, unite="cm"),
    2: dict(w=841.68, h=1190.52, rotation=270, pointsParUnite=0.5638)})
meubles = p.calque("Meubles")
p.symbole(1, meubles, "lit-double", cx=250, cy=150, angle=90)
p.cote(1, meubles, (150, 700), (450, 700), ecartement=30)
p.texte(1, meubles, "Chambre 1", x=120, y=80, taille=14)
p.compteur(1, meubles, "Prises", 900, 200)
p.sauver("plans.annot.json")
```

## 10. Ce qui est vérifié, ce qui ne l'est pas

Vérifié dans l'application v1.8.3 (Chromium, PDF de 7 pages de l'utilisateur) :
- Le fichier de référence se recharge sans erreur : 198 objets, 7 pages.
- Un projet généré avec toutes les recettes du §6 et 14 symboles se charge sans erreur console. Les 36 objets de la page de test apparaissent aux bonnes positions.
- Les symboles tombent au centre demandé, tournés ou non.
- Les cotes affichent la valeur attendue (532,10 cm pour 300 pt à 0,5638 pt/cm).
- Les repères placés dans le cadre d'une page tournée de 270 degrés se trouvent aux coins de la page affichée.
- L'export PDF vectoriel du projet généré aboutit (8,4 Mo).
- Un nom de PDF différent déclenche la boîte de confirmation.

Non vérifié :
- Les tampons et les groupes utilisateur (non générés).
- Le comportement avec des calques verrouillés ou masqués dans le JSON généré.
- L'édition d'une cote générée par saisie manuelle de sa valeur (la cote porte pourtant les données `p1`, `p2`, `offsetPt` attendues).
- La différence de 11 symboles sur 100 entre le fichier de référence et les gabarits (`wc`, `chaise` et autres) : leur géométrie interne a un léger décalage, sans doute parce que `symbols.js` a évolué après la sauvegarde du fichier.
- Toute version de l'outil autre que 1.8.3. Si `PROJECT_FORMAT` ou la version de Fabric change, cette spec est à reprendre.
