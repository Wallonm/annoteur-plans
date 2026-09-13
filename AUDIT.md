# Audit — Annoteur Plans PDF

Périmètre : `index.html` (562 l.), `app.js` (2 944 l.), `symbols.js` (800 l., 65 symboles).
Méthode : lecture intégrale du code + exécution de l'app (serveur local, PDF `plan_redresse_v4.pdf`) pour confirmer chaque bug. Les éléments marqués **[vérifié]** ont été reproduits.

---

## Synthèse

L'outil est fonctionnellement riche et bien documenté en interne (commentaires FR clairs, géométrie des cotes soignée, 65 symboles cotés en cm réels). Le niveau de finition de l'UI est bon.

Mais il repose sur **un choix de fondation qui casse la fiabilité** : les annotations sont stockées en pixels-écran, dans un repère qui dépend de la taille de la fenêtre au moment du rendu. Tout le reste (rechargement de projet, calibration, rotation, export) en hérite. À côté de ça, trois bugs provoquent une **perte de données silencieuse**, et le chargement d'un plan lourd gèle l'application plusieurs minutes.

Ordre de priorité recommandé :

| Prio | Sujet | Effort |
|---|---|---|
| **P0** | Repère de coordonnées en points PDF | 2–3 j |
| **P0** | 3 bugs de perte de données | 0,5 j |
| **P0** | Chargement non bloquant + autosave | 1 j |
| **P1** | Undo/redo réécrit, calques globaux | 2 j |
| **P2** | Export vectoriel, accessibilité, outils métier | 3–5 j |

---

## P0 — Critique

### 1. Les annotations sont en pixels-écran, pas en coordonnées de page

`renderCurrentPage()` ([app.js:1604](app.js:1604)) calcule à chaque rendu :

```js
const scale = Math.min(containerW / vp0.width, containerH / vp0.height) * 0.92;
App.pageData[p].renderScale   = scale;
App.pageData[p].canvasOffsetX = (containerW - vp.width) / 2;
```

`scale` et l'offset dépendent de `wrapper.clientWidth/clientHeight`, donc de la taille de la fenêtre. Les objets Fabric sont ensuite créés et sauvegardés dans **ce** repère. Conséquences en chaîne :

- **Rechargement de projet faussé.** `loadProject()` ([app.js:2137](app.js:2137)) restaure les objets puis appelle `renderCurrentPage()`, qui **écrase** `renderScale` et les offsets avec de nouvelles valeurs. Ouvrir le projet sur un écran différent, une fenêtre redimensionnée ou avec la sidebar dans un autre état ⇒ toutes les annotations sont décalées et à la mauvaise taille.
- **Calibration invalidée.** `pixelsPerUnit` est exprimé en pixels-écran ([app.js:2762](app.js:2762) : `mmPerPixel = mmPerPt / renderScale`). Dès que `renderScale` change, toutes les cotes de la page sont fausses — sans aucun avertissement.
- **Incohérence déjà présente dans votre projet.** **[vérifié]** `projet.annot.json` contient deux `renderScale` différents pour un même document :

  ```
  2 pages → renderScale 0.20068759600244365   (canvasOffsetX 556.17)
  5 pages → renderScale 0.28385884774859604   (canvasOffsetX 295.19)
  ```

  La fenêtre a été redimensionnée en cours de session : ces 7 pages sont dans **deux repères mutuellement incompatibles**, et aucune ne correspondra à la prochaine ouverture.
- **`resize` inopérant.** Le handler ([app.js:191](app.js:191)) est un no-op dès qu'un PDF est chargé (`if (!App.pdfDoc)`). Le canvas garde son ancienne taille (zone vide / plan rogné), mais le prochain `switchPage` recalculera bien les offsets avec la nouvelle taille → décalage.
- **Rotation de page.** `rotatePage()` ([app.js:1660](app.js:1660)) re-rend le PDF mais ne transforme pas les objets : le plan tourne, les annotations restent en place.
- **Pages jamais affichées.** `renderScale` vaut 1 par défaut ([app.js:1509](app.js:1509)). Une page ouverte depuis un projet mais jamais visitée s'exporte à l'échelle 1 — soit ~3,5× trop petite dans votre cas.
- **Export fragile.** Il repose sur la soustraction `-tx * dpiMult` ([app.js:2234](app.js:2234)), donc sur des offsets pouvant venir d'une autre session.

**Correctif recommandé.** Stocker les objets en **points PDF** (repère de la page, origine coin haut-gauche, indépendant de l'affichage) et ne convertir qu'à l'affichage via une matrice `pageToScreen`. La calibration devient alors `pointsPerUnit` — stable à vie. Migration : pour un projet v1.1, diviser les coordonnées par le `renderScale` stocké de chaque page et soustraire l'offset (les données existantes sont récupérables, page par page).

Variante minimale si la refonte est trop lourde : figer `renderScale` à une valeur déterministe (ex. `scale = 1`, ou `72/150`), calculée **une seule fois** à l'ouverture du PDF et jamais recalculée, l'adaptation à la fenêtre se faisant uniquement par le `viewportTransform` de Fabric (zoom/pan), qui n'affecte pas les coordonnées objets. Corrige 5 symptômes d'un coup.

---

### 2. Verrouiller un calque détruit ses lignes **[vérifié]**

Trois endroits nettoient les segments temporaires en les identifiant par `!selectable` :

- `resetDrawState()` — [app.js:2314](app.js:2314)
- `toolPolyline_finish()` — [app.js:590](app.js:590)
- `toolPolygon_finish()` — [app.js:657](app.js:657)

```js
fc.getObjects('line').filter(o => !o.selectable).forEach(o => fc.remove(o));
```

Or `toggleLayerLock()` ([app.js:1757](app.js:1757)) met précisément `selectable: false` sur les objets du calque. Donc : verrouiller un calque contenant des lignes, puis appuyer sur **Échap**, changer d'outil ou terminer une polyligne ⇒ **toutes ces lignes sont supprimées**, et le `saveCurrentPageObjects()` suivant persiste la perte. Aucun message, et l'undo ne les récupère pas de façon fiable.

Test reproduit : 3 lignes sur un calque verrouillé → `Échap` → **0 ligne**.

**Correctif** : marquer les objets temporaires (`data: { temp: true }`) et filtrer sur ce drapeau, jamais sur `selectable`. ~10 lignes.

---

### 3. Les poignées d'édition sont sauvegardées comme annotations **[vérifié]**

`saveCurrentPageObjects()` ([app.js:1687](app.js:1687)) conserve tout objet sans `data.pageNum` :

```js
json.objects.filter(o => !o.data?.pageNum || o.data.pageNum === App.currentPage)
```

Les poignées de cote et de polygone ([app.js:1030](app.js:1030), [app.js:1160](app.js:1160)) ont un `data` **sans** `pageNum` → elles passent le filtre. Et `switchPage()` appelle `saveCurrentPageObjects()` **avant** `resetDrawState()` ([app.js:1571](app.js:1571)) : changer de page avec une cote sélectionnée sauvegarde ses 3 croix bleues, qui réapparaissent au retour en croix orphelines. Idem à chaque `saveHistoryState()` pendant l'édition.

Pire : `data.dimGroup` / `data.polyObj` contiennent une **référence à l'objet Fabric complet**, qui est sérialisée. **[vérifié]** le JSON produit contient bien `dimGroup` → fichier projet gonflé (le vôtre fait 582 Ko pour 7 pages) et re-création d'objets fantômes au chargement.

**Correctif** : exclure explicitement `dimHandle` / `polyHandle` du filtre, appeler `resetDrawState()` *avant* la sauvegarde dans `switchPage`, et stocker un id de groupe au lieu de la référence.

---

### 4. Dessiner avant d'ouvrir un PDF plante **[vérifié]**

`ensureActiveLayer()` ([app.js:404](app.js:404)) écrit dans `App.pageData[App.currentPage]`, qui vaut `undefined` tant qu'aucun PDF n'est chargé (`App.pageData = {}`).

| Action sans PDF | Résultat |
|---|---|
| Outil rectangle + clic | `TypeError: Cannot set properties of undefined (setting 'layers')` |
| Outil texte + clic | `TypeError: Cannot set properties of undefined (setting 'objects')` |
| Ouvrir un projet | `TypeError: Cannot read properties of null (reading 'getPage')` |

L'app reste muette (erreur console uniquement) et l'utilisateur ne comprend pas pourquoi rien ne se passe.

**Correctif** : garde `if (!App.pdfDoc) { showToast('Ouvrez d'abord un PDF'); return; }` en tête des outils, et désactivation visuelle de la barre d'outils tant qu'aucun document n'est chargé.

---

### 5. Le chargement gèle l'app plusieurs minutes **[vérifié]**

`loadPDF()` ([app.js:1528](app.js:1528)) rend **toutes** les vignettes séquentiellement **avant** d'afficher la page 1 :

```js
await renderThumbnails();   // boucle await sur les N pages
await switchPage(1);
```

Mesures sur `plan_redresse_v4.pdf` (15 Mo, 7 pages) :

| Étape | Temps |
|---|---|
| `fetch` du fichier | 96 ms |
| `pdfjsLib.getDocument` (parsing) | 202 ms |
| **1 vignette de 62 px** | **~11 s** (pages de 2599 × 3677 pt) |
| **7 vignettes avant tout affichage** | **~77 s** |

> *Correction : une première mesure annonçait « > 45 s par vignette ». Elle était faussée par l'environnement de test (panneau navigateur masqué, `requestAnimationFrame` non déclenché, donc rendu pdf.js suspendu). La mesure corrigée est ~11 s par vignette. Le constat est inchangé : la page 1 n'apparaît qu'après le rendu des 7 vignettes.*

Le toast « Chargement du PDF… » disparaît au bout de 2,5 s : l'utilisateur voit une app figée sans explication. Avec `plan_redresse_toutes_pages.pdf` (**977 Mo**), c'est inexploitable — et `file.arrayBuffer()` ([app.js:1517](app.js:1517)) charge en plus tout le fichier en mémoire d'un bloc.

**Correctifs** :
1. `await switchPage(1)` **avant** les vignettes (page 1 visible immédiatement).
2. Vignettes paresseuses via `IntersectionObserver`, avec placeholder ; file d'attente à 1 rendu concurrent.
3. Rendre les vignettes depuis un canvas basse résolution ou réutiliser le rendu de la page courante.
4. Indicateur de progression persistant (`3/7 pages…`) au lieu d'un toast fugace.
5. Avertissement au-delà de ~100 Mo, et `getDocument({ url })` plutôt que `{ data }` quand c'est possible.

---

### 6. Aucune sauvegarde automatique ni garde-fou à la fermeture

Rien n'est persisté : pas de `localStorage`, pas de `beforeunload`. Un onglet fermé par erreur = travail perdu. Et le projet JSON n'embarque **ni le PDF ni son empreinte** : au rechargement, rien ne vérifie que le PDF ouvert est bien le bon (`loadProject` ne compare même pas `data.totalPages` à `App.totalPages`, [app.js:2137](app.js:2137)) — on peut appliquer les annotations du plan A sur le plan B sans le moindre avertissement.

**Correctifs** (fort rapport valeur/effort) :
- Autosave dans IndexedDB toutes les 30 s + proposition de reprise au démarrage.
- `beforeunload` si modifications non sauvegardées.
- Stocker `{ fileName, pageCount, byteSize }` dans le projet et alerter en cas de discordance.
- Nom de fichier dérivé de la source (`plan_redresse_v4.annot.json`) plutôt que `projet.annot.json` fixe.

---

## P1 — Bugs secondaires

**Undo**
- Pas d'instantané initial : la **première action d'une page n'est jamais annulable** (`if (App.historyIndex <= 0) return`, [app.js:2288](app.js:2288)).
- `App.history` est global alors que les instantanés sont par page : après un changement de page, `undo()` décrémente l'index et **ne fait rien** ([app.js:2296](app.js:2296)) — l'utilisateur clique dans le vide.
- **Pas de redo** du tout, alors que la machinerie `historyIndex` est en place.
- `applyToSelection()` appelle `saveHistoryState()` à chaque événement `input` : un seul glissement du curseur d'opacité ([app.js:2668](app.js:2668)) sature le tampon de 30 entrées et détruit l'historique réel.
- Chaque `saveHistoryState()` fait un `JSON.stringify` de tous les objets de la page — coûteux dès quelques centaines d'annotations.
- Ajout / suppression / renommage de calque non annulables.

**Modèle de calques incohérent**
Les calques sont stockés par page (`pageData[n].layers`) mais `App.nextLayerId` est global et `removeLayer()` supprime les objets **de toutes les pages** ([app.js:1729](app.js:1729)). De plus `App.pageData[p].layers = [...App.layers]` ne copie que le tableau : les **objets calque sont partagés** entre pages, donc renommer ou masquer sur la page 1 affecte la page 2 de façon imprévisible. Pour un jeu de plans, l'attente naturelle est : **calques globaux au document**. À trancher explicitement.

**Calques masqués**
`toggleLayerVisibility()` ([app.js:1745](app.js:1745)) met `visible: false` mais laisse `selectable: true` : les objets invisibles restent sélectionnables et `Ctrl+A` les attrape. **[vérifié]**

**Ouverture d'un second PDF**
`loadPDF()` ne réinitialise ni `App.pageData` (`App.pageData[i] = App.pageData[i] || {...}`, [app.js:1524](app.js:1524)) ni l'historique, les calques ou le presse-papiers : les annotations du document précédent se superposent au nouveau.

**Aucune gestion d'erreur**
Ni `loadPDF`, ni `loadProject`, ni `exportPDF` n'ont de `catch`. PDF corrompu, chiffré ou canvas trop grand ⇒ rejet non géré, toast figé, aucun diagnostic.

**Export PDF**
- Tout est **rastérisé en JPEG qualité 0,93** ([app.js:2274](app.js:2274)) : perte du vectoriel et du texte recherchable du plan d'origine, artefacts sur les traits fins, poids de fichier multiplié (c'est très probablement l'origine du PDF de 977 Mo de ce dossier).
- `jsPDF({ unit: 'px', format: [FW, FH] })` ([app.js:2279](app.js:2279)) : l'unité `px` de jsPDF vaut 96 DPI, sans rapport avec les points de la page source. **La taille physique de la page exportée est donc fausse** → impossible d'imprimer à l'échelle (1:100 non respecté). Il faut calculer le format en `pt` depuis `getViewport({ scale: 1 })`.
- `PRINT_DPI = 150` est codé en dur ([app.js:2199](app.js:2199)).
- « Très haute (×3) » sur un grand plan dépasse la limite de taille de canvas des navigateurs (~16 384 px / ~268 Mpx) → échec silencieux.
- Aucun contrôle « au moins un calque coché » : on peut exporter le plan sans aucune annotation sans s'en apercevoir.
- Nom de sortie fixe `plans-annotes.pdf`.
- Boucle synchrone sur toutes les pages, UI bloquée, pas de progression ni d'annulation.
- Code mort : `if (App.currentPage !== savedPage)` ([app.js:2292](app.js:2292)) — `currentPage` ne change jamais dans la boucle.

**Rendu du plan**
Le fond est passé en `toDataURL('image/jpeg', 0.9)` ([app.js:1638](app.js:1638)) : double compression JPEG d'un plan trait, et data-URL énorme en mémoire. Utiliser directement le canvas hors-écran (`new fabric.Image(offCanvas)`). Surtout, **le zoom n'agrandit qu'une image bitmap** : zoomer sur une cote existante donne une bouillie de pixels. Il faudrait re-rendre la page via pdf.js au niveau de zoom courant (rendu progressif ou tuilé).

**Divers**
- `#ff000022` comme valeur d'`<input type="color">` ([index.html:216](index.html:216)) est invalide — **[vérifié]** warning navigateur, le champ retombe sur `#000000`.
- **Échap ne ferme pas les modales** : le handler clavier sort immédiatement si une modale est ouverte ([app.js:2874](app.js:2874)) et aucune modale ne gère Échap.
- `confirm()` natif pour la suppression de calque ([app.js:1848](app.js:1848)) alors que tout le reste utilise des modales maison.
- `input-custom-svg` est câblé ([app.js:2404](app.js:2404)) mais **aucun bouton ne l'ouvre** : import de symbole personnalisé = fonctionnalité inaccessible.
- Les outils de dessin n'ont pas `strokeUniform` ([app.js:420](app.js:420)) alors que les symboles l'ont : redimensionner un rectangle épaissit son trait.
- Le dessin libre ignore `dashArray` et `opacity` ; l'enregistrement de `path:created` ([app.js:686](app.js:686)) est inutilement tortueux (`once` qui réenregistre un `on`).
- `updatePropsFromSelection()` écrit la sélection dans `App.toolProps` ([app.js:2572](app.js:2572)) : sélectionner un symbole noir rend noir le prochain rectangle dessiné. Comportement « pipette implicite » à rendre explicite ou à supprimer.
- Le raccourci pan est **`H`** dans le code ([app.js:2915](app.js:2915)) mais l'infobulle annonce « (Espace) » ([index.html:359](index.html:359)).
- `Espace` positionne `isPanning = true` sans `blur` handler : perdre le focus fenêtre pendant l'appui laisse le pan bloqué.
- `handleMouseMove` appelle `findTarget()` **et** `requestRenderAll()` à chaque mouvement dès qu'un outil de dessin est actif ([app.js:253](app.js:253)), avec `perPixelTargetFind` sur les formes transparentes — coûteux.
- Code mort : `createDimensionObject()` ([app.js:1393](app.js:1393)), `addDefaultLayer()` ([app.js:1717](app.js:1717)), variable `pts` inutilisée ([app.js:587](app.js:587)), paramètre `unit` ignoré dans `displayToPx()` ([app.js:855](app.js:855)). `applySymbolColor()` et `recolorSelectedSymbol()` sont deux quasi-doublons.
- Le curseur d'opacité est borné à 10 % minimum ([index.html:226](index.html:226)) — impossible de masquer un objet.

---

## Architecture & qualité de code

**Ce qui est bien** : nommage clair et cohérent, commentaires FR utiles, géométrie des cotes (`computeDimGeometry`) propre et testable, séparation `symbols.js` avec dimensions réelles en cm, aucune dépendance de build (ouvrable par double-clic).

**Ce qui pose problème** :

1. **Monolithe de 2 944 lignes** avec un état global mutable (`App`) touché depuis partout. Les fonctions mélangent géométrie, état et manipulation du DOM (`toolMeasure_down` fait les trois). Découpage naturel : `state.js`, `geometry.js`, `tools/`, `layers.js`, `pdf.js`, `export.js`, `ui/`. En ES modules, sans bundler — les navigateurs le supportent.
2. **Aucun test.** La géométrie (`computeDimGeometry`, `makeRevisionCloudPath`, conversions d'échelle) est de la maths pure, testable en quelques dizaines de lignes de Vitest sans navigateur. C'est là que se cachent les régressions les plus coûteuses.
3. **Aucun lint ni typage.** ESLint aurait attrapé le code mort et les variables inutilisées ; JSDoc + `checkJs` aurait attrapé `pageData[currentPage]` potentiellement `undefined`.
4. **Pas de versionnement.** Le dossier n'est pas un dépôt git, et deux PDF (992 Mo au total) cohabitent avec le code. `git init` + un `.gitignore` sur les PDF est un préalable à toute refonte.
5. **Dépendances CDN sans `integrity`** ([index.html:556-558](index.html:556)) : pas de SRI, et **l'app ne fonctionne pas hors ligne** — bloquant pour un usage sur chantier. Vendorer les 3 librairies en local (~1,5 Mo) résout les deux points.
6. **Versions en retard d'une génération** : Fabric 5.x (6.x disponible, API de contrôles et perfs revues), pdf.js 3.11 (4.x/5.x). Migration à planifier, pas urgente.
7. **Numéros magiques dispersés** : `0.92` (marge de rendu), `gap = 3`, `overshoot = 6`, `tickLen = 7`, `30` (taille d'historique), `150` (DPI). À regrouper dans un objet `CONFIG`.
8. **Abus d'`innerHTML`** pour construire l'UI ; `emoji` comme icônes (rendu variable selon l'OS, illisible en petite taille).

---

## Ergonomie

**Points forts** : disposition à trois zones classique et lisible, palette de symboles avec recherche et catégories repliables, indicateurs contextuels pour les modes calibrage/mesure (excellent), cotes éditables par poignées, taille des symboles déduite de la calibration.

**Frictions**

*Navigation*
- Aucun moyen de changer de page au clavier (pas de `PageUp`/`PageDown`, pas de flèches) ni de bouton précédent/suivant : uniquement la bande de vignettes. `#page-info` est un texte mort, pas un champ de saisie.
- Pas de vue « plan d'ensemble » ni de mini-carte pour se repérer sur un grand plan zoomé.
- Le zoom molette ne se recentre pas sur la sélection ; pas de « zoom sur la sélection ».

*Découvrabilité*
- Aucun panneau d'aide des raccourcis (ils sont pourtant nombreux et bien pensés). Un `?` affichant la liste coûte 20 lignes.
- Les infobulles de la barre d'outils sont en CSS `::after` sur `:hover` : invisibles au clavier et sur tablette.
- Les icônes emoji (`╱`, `⬡`, `⟵⟶`) sont peu lisibles ; l'outil `📐` pour « polyligne » et `⊞` pour « ajuster » ne sont pas devinables.
- Le mode 3 clics de l'outil cote n'est expliqué que par l'indicateur, découvert seulement après le premier clic.

*Retour utilisateur*
- Les toasts durent 2,5 s et servent à tout : information, succès et **erreur**. Une erreur mérite un traitement distinct et persistant.
- Aucun état de chargement pendant l'export (UI figée, écran noir apparent).
- Pas d'état vide guidé : au lancement, seul un petit texte « Ouvrir un PDF pour commencer » dans la bande de vignettes. Une zone de glisser-déposer plein écran serait plus naturelle — d'autant que le glisser-déposer de PDF n'est **pas** géré du tout.

*Édition*
- **Pas de contrainte orthogonale (Shift), pas d'accrochage** (grille, extrémités, milieux, perpendiculaires). Pour de la cotation sur plan, c'est le manque le plus handicapant : impossible de tracer une ligne exactement horizontale.
- Pas de gestion d'ordre Z (premier plan / arrière-plan), pas de grouper/dégrouper, pas d'alignement/répartition.
- Pas de sélection par rectangle en mode outil (seulement en mode `select`).
- Les champs L/H du header sont loin de l'objet édité ; ils affichent la boîte englobante, donc des valeurs fausses pour un objet tourné.
- Pas de transparence réglable sur le remplissage (`<input type=color>` est opaque) ni de hachures — indispensable pour surligner des zones sur un plan.

*Accessibilité*
- Onglets de la sidebar en `<div>` sans `role="tab"` ni gestion clavier ; boutons outils sans `aria-label` (texte = emoji) ; aucun style de focus visible ; modales sans `role="dialog"`, sans piège à focus, sans fermeture par Échap ; `<label>` non reliés par `for`.
- Contraste de `--text-dim` (#9090a8) sur `--panel` (#252535) ≈ 4,1:1 — sous le seuil AA pour le petit texte (11 px très présent dans l'UI).

*Tablette / chantier*
- Largeurs fixes (sidebar 240 px, outils 46 px, vignettes 90 px), aucune adaptation responsive, pas de gestion du pinch-to-zoom ni de cibles tactiles ≥ 44 px. Inutilisable sur tablette en l'état — alors que c'est l'usage terrain naturel de cet outil.

---

## Fonctionnalités manquantes (métier)

Classées par valeur perçue pour de l'annotation de plans :

1. **Mesure de surface et de périmètre** sur polygone, avec affichage direct. Absent, alors que toute la géométrie nécessaire existe déjà.
2. **Outil de comptage** (cliquer pour incrémenter un compteur par catégorie : prises, radiateurs, portes…) — le cas d'usage n°1 du chiffrage sur plan.
3. **Tableau récapitulatif exportable** (CSV/Excel) des cotes, surfaces et comptages par calque et par page. Aujourd'hui les mesures ne vivent que dans le dessin.
4. **Accrochage et contrainte orthogonale** (cf. ergonomie) — condition d'une cotation crédible.
5. **Mesure cumulée / chaînée** et **mesure d'angle**.
6. **Flèche / bulle de renvoi (leader)** avec texte — le classique de l'annotation de plan, absent.
7. **Surligneur** semi-transparent et **tampons** (« À valider », « BON POUR EXÉCUTION », date, visa).
8. **Calibration propagée** : « appliquer cette échelle à toutes les pages », et lecture de l'échelle native du PDF quand elle est disponible.
9. **Export vectoriel** : superposer les annotations en vecteurs sur le PDF d'origine (via `pdf-lib`) plutôt que de tout rastériser — préserve la qualité, le texte recherchable et le poids du fichier. C'est le chantier le plus rentable sur la qualité du livrable.
10. **Comparaison de versions** de plans (superposition A/B avec différences colorées).
11. **Historique / attribution** des annotations (auteur, date) pour un usage à plusieurs.

---

## Plan d'action proposé

**Lot 1 — Fiabilité (≈ 4 jours)** — à faire avant toute nouvelle fonctionnalité
1. `git init` + `.gitignore` sur les PDF.
2. Correctifs rapides : drapeau `temp` sur les objets temporaires (bug 2), exclusion des poignées de la sérialisation (bug 3), gardes « pas de PDF » (bug 4), réinitialisation d'état dans `loadPDF`, `try/catch` sur les 3 points d'entrée.
3. `await switchPage(1)` avant les vignettes + vignettes paresseuses + indicateur de progression (bug 5).
4. Autosave IndexedDB + `beforeunload` + empreinte du PDF dans le projet (bug 6).

**Lot 2 — Fondation (≈ 3 jours)**
5. Passage des coordonnées en points PDF, calibration indépendante du rendu, migration des projets v1.1 (bug 1).
6. Tests Vitest sur la géométrie et les conversions d'échelle — filet de sécurité de cette migration.

**Lot 3 — Confort (≈ 3 jours)**
7. Undo/redo réécrit : instantané initial, historique par page, regroupement des événements continus (debounce), redo, annulation des opérations de calque.
8. Décision et mise en œuvre calques globaux au document.
9. Accrochage + contrainte Shift, ordre Z, navigation clavier entre pages, panneau d'aide des raccourcis, Échap ferme les modales.

**Lot 4 — Livrable & accessibilité (≈ 4 jours)**
10. Export vectoriel via `pdf-lib` sur le PDF d'origine, format de page en points, progression et annulation.
11. Reprise accessibilité (ARIA, focus, contrastes) et responsive tablette.
12. Vendorer les dépendances (fonctionnement hors ligne) + SRI.

**Lot 5 — Métier** : surface/périmètre, comptage, tableau exportable, bulles de renvoi, tampons.

---

*Audit réalisé le 12/09/2026 sur la base du code présent dans le dossier. Les bugs marqués **[vérifié]** ont été reproduits en exécutant l'application.*
