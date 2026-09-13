# Journal des versions — Annoteur Plans PDF

## v1.6.0 — Lot 5 : Outils métier

Les mesures ne vivaient que dans le dessin : impossible de les reprendre dans un devis.

### Ajouté

- **Surface et périmètre** (`S`, ou bouton ▦) sur un polygone ou un rectangle
  sélectionné : une étiquette affiche les deux valeurs dans l'unité calibrée, et se
  recalcule automatiquement si l'échelle de la page change.
  Vérifié sur le plan réel : une pièce de 4 m × 5 m donne 200 000 cm² et 1 800 cm.
- **Outil de comptage** (`X`) : un clic par élément, repère rond numéroté, numérotation
  et couleur automatiques **par catégorie** (prises, radiateurs, portes…), continues sur
  l'ensemble du document. Compteur en direct dans le panneau *Relevé*.
- **Bulle de renvoi** (`A`) : deux clics — le point désigné puis l'emplacement du texte —
  produisent une flèche et une étiquette éditable, groupées.
- **Tampons** : BON POUR EXÉCUTION, À VALIDER, À MODIFIER, VU, ANNULÉ, datés du jour,
  avec cadre et inclinaison.
- **Récapitulatif des mesures** (`Ctrl+M`, ou bouton Σ) : tableau de toutes les cotes,
  surfaces, périmètres et comptages du document, page par page et calque par calque,
  comptages agrégés par catégorie.
- **Export CSV** du récapitulatif, séparateur `;` et BOM UTF-8 : s'ouvre directement
  dans Excel en français, décimales à la virgule.
- Nouvel onglet **Relevé** dans le panneau latéral.

Tous ces objets passent dans l'export vectoriel en texte réel et en tracés.

### Qualité de code

- `tools-metier.js` séparé ; 7 tests supplémentaires (41 au total) sur le format CSV,
  l'agrégation des comptages, l'échappement des caractères et la cohérence
  surface/périmètre de bout en bout.

## v1.5.0 — Lot 4 : Export vectoriel, hors ligne, accessibilité

### Ajouté — export vectoriel (mode par défaut)

- **Les annotations sont ajoutées au PDF d'origine sous forme de tracés vectoriels et de
  texte réel** (pdf-lib), au lieu de tout rastériser en JPEG. Le plan conserve sa qualité,
  son texte reste sélectionnable, et les annotations aussi.
  Mesuré sur `plan_redresse_v4.pdf` : **14,65 Mo en 1 s** (source 14,63 Mo, soit 20 Ko
  d'annotations) et les 30 textes d'annotation de la page 4 ressortent en texte
  extractible. L'export rastérisé produisait 10,6 Mo d'images aplaties et dégradées.
- Toutes les formes sont converties : lignes, rectangles, ellipses (quatre cubiques),
  polygones, tracés libres, nuages de révision et symboles (les arcs sont réduits en
  cubiques), groupes (cotes, symboles) par récursion, avec opacité, tirets et
  épaisseurs conservés.
- Le texte est positionné à partir des métriques réelles de Fabric plutôt que de
  constantes recopiées. Les caractères non représentables en Helvetica standard sont
  remplacés au lieu de faire échouer l'export.
- **Le mode rastérisé reste disponible** dans la fenêtre d'export, sous « Compatibilité ».

### Corrigé

- **La rotation propre au PDF (`/Rotate`) est prise en compte.** Elle était écrasée par
  `getViewport({rotation})` : un plan scanné enregistré en `/Rotate 90` s'affichait de
  travers. La rotation est désormais absolue, initialisée depuis le document, et
  réappliquée telle quelle à l'export.

### Ajouté — fonctionnement hors ligne

- **Les quatre bibliothèques sont servies localement** (`vendor/`, ~2,5 Mo) : pdf.js,
  Fabric, jsPDF et pdf-lib, worker pdf.js compris. L'application ne dépend plus d'un
  CDN — indispensable sur chantier. Les contrôles d'intégrité SRI n'ont plus d'objet
  pour des fichiers de même origine et ont donc été retirés.

### Ajouté — accessibilité

- Onglets latéraux en véritables `role="tab"` avec navigation aux flèches ← →.
- Libellés `aria-label` sur tous les boutons (leur contenu n'était qu'un emoji),
  `aria-pressed` sur l'outil actif.
- Fenêtres modales `role="dialog" aria-modal="true"` avec titre associé.
- Contour de focus visible au clavier (`:focus-visible`).
- Contraste du texte secondaire porté de ≈4,1:1 à ≈6,7:1 (seuil AA atteint).

### Ajouté — tablette et petits écrans

- Sous 900 px, les deux panneaux latéraux se replient derrière des boutons et
  s'ouvrent en superposition ; ils se referment au premier appui sur le plan.
- Cibles tactiles portées à 44 px sur écran tactile, vignettes agrandies.
- **Pincer pour zoomer**, via les gestes déjà fournis par Fabric.

## v1.4.0 — Lot 3 : Confort

### Changé — historique

- **Annuler/rétablir entièrement réécrits.** L'historique est désormais tenu **par page**,
  avec un instantané initial. Corrige d'un coup :
  - la première action d'une page n'était pas annulable,
  - après un changement de page, annuler ne faisait plus rien silencieusement,
  - il n'existait aucun rétablissement.
- **`Ctrl+Maj+Z` et `Ctrl+Y` rétablissent**, bouton ↪ dans la barre d'outils. Les boutons
  annuler/rétablir se grisent quand il n'y a rien à faire.
- **Un glissement de curseur = une seule entrée d'historique.** Les contrôles continus
  (opacité, couleurs) appliquent en direct mais n'enregistrent qu'au relâchement.
  Vérifié : 13 mouvements du curseur d'opacité → 1 entrée (contre 13 avant, ce qui
  saturait la pile de 30 et détruisait l'historique réel). Capacité portée à 50.
- **Les opérations de calque sont annulables** (ajout, suppression, renommage,
  visibilité, verrouillage) : l'instantané couvre objets *et* calques.

### Changé — calques

- **Les calques sont globaux au document**, et non plus par page. Le modèle précédent
  était incohérent : calques stockés par page, identifiants globaux, suppression
  effaçant les objets de toutes les pages, et objets calque partagés par référence
  entre pages (renommer sur une page en affectait une autre).
- **Migration automatique** des projets 2.0 → 2.1 : union des calques par identifiant,
  `nextLayerId` recalculé. Vérifié sur le projet réel : 5 calques remontés sans doublon,
  132 annotations intactes.
- La fenêtre d'export liste les calques une seule fois, sans suffixe `(p.N)`.

### Ajouté — tracé

- **Contrainte d'angle avec `Maj`** (multiples de 45°) sur ligne, polyligne, polygone,
  cote et calibration. Il était jusqu'ici impossible de tracer une ligne exactement
  horizontale, ce qui rendait toute cotation approximative.
- **Accrochage aux extrémités et sommets** existants (8 px écran), avec repère vert.
  Les candidats sont mis en cache à chaque appui plutôt que recalculés à chaque
  mouvement de souris.
- **Ordre d'empilement** : premier plan / arrière-plan (boutons + `Ctrl+]` / `Ctrl+[`,
  avec `Maj` pour aller directement aux extrêmes).

### Ajouté — aide

- **Panneau des raccourcis clavier** (`?` ou `F1`), construit à partir de la table
  réellement utilisée par le gestionnaire clavier — il ne peut donc plus diverger du
  code, ce qui était le cas de l'infobulle annonçant « Espace » pour un raccourci « H ».

### Corrigé

- **Accrochage et poignées imprécis d'une demi-épaisseur de trait.** Fabric calcule le
  centre de transformation d'une `Line` en incluant l'épaisseur, alors que ses
  coordonnées locales en sont indépendantes : les extrémités tombaient 1 pt à côté.
  Les polygones, eux, n'étaient pas concernés — leur `left` intègre déjà ce décalage.
- La saisie d'épaisseur et de corps de texte est bornée (plus de valeur nulle ou
  négative).

## v1.3.0 — Lot 2 : Fondation (repère en points PDF)

Le chantier de fond : les annotations ne sont plus stockées en pixels écran.

### Changé — repère de coordonnées

- **Les annotations sont désormais en POINTS PDF** (1 pt = 1/72 pouce = 0,353 mm),
  dans le repère de la page, origine au coin haut-gauche. L'adaptation à la fenêtre
  passe uniquement par le zoom/pan de la vue, qui ne touche pas aux objets.
  Auparavant le repère était recalculé à chaque rendu depuis la taille de la fenêtre
  (`renderScale`, `canvasOffsetX/Y`), ce qui entraînait :
  - un décalage de toutes les annotations à la réouverture sur un autre écran,
  - une calibration devenue fausse après un simple redimensionnement,
  - un export dépendant d'offsets issus d'une autre session.
  Ces champs n'existent plus.
- **La calibration est en `pointsPerUnit`**, grandeur stable à vie. Le calcul depuis
  une échelle (1:50, 1:100…) est purement géométrique. L'échelle correspondante est
  affichée en clair dans le panneau (« ✓ 1 cm = 1,86 pt — échelle ≈ 1:15 »).
- **Migration automatique des projets v1.0/v1.1**, page par page, avec le `renderScale`
  et l'offset propres à chacune — un même projet pouvait en contenir plusieurs.
  Vérifié sur `projet.annot.json` : 132 annotations sur 7 pages, deux repères
  distincts, toutes replacées correctement.
- **Le redimensionnement de la fenêtre fonctionne** : le canvas suit et la vue se
  réajuste (le gestionnaire était inopérant dès qu'un PDF était chargé).
- **La rotation d'une page fait tourner les annotations avec le plan.** Quatre
  rotations ramènent exactement à l'état initial.
- **L'épaisseur de trait et le corps de texte sont des grandeurs physiques** (en points).
  Leurs valeurs par défaut s'adaptent au format du plan à l'ouverture. Les formes
  utilisent `strokeUniform` : redimensionner ne déforme plus le contour.

### Changé — affichage

- **Le plan est re-rendu par pdf.js au niveau de zoom courant** (anti-rebond 250 ms,
  plafond ×4, rendu précédent annulé). La v1.1 étirait une image JPEG : zoomer sur
  une cote donnait une bouillie de pixels. Mesuré : 919 px → 3506 px de large au zoom.

### Corrigé

- **L'export conserve la taille physique du plan.** jsPDF était appelé en `unit: 'px'`
  (96 dpi), sans rapport avec la page source : toute impression à l'échelle était
  faussée. Les pages sont maintenant dimensionnées en points. Vérifié : page source
  2599,3 × 3676,6 pt → page exportée 2599,3 × 3676,6 pt.
- **L'export ne dépend plus du renderScale d'affichage** : une page jamais ouverte
  s'exportait à une échelle arbitraire.

### Ajouté

- **Échelle applicable à toutes les pages** en une case à cocher (impossible tant que
  la calibration dépendait de l'affichage propre à chaque page).
- Unité **mm** dans la calibration par échelle.
- Bouton et raccourci **taille réelle 1:1** (`1`), **ajuster** (`0`).
- **Navigation entre pages au clavier** : `Page↑` / `Page↓`.

### Qualité de code

- `geometry.js` : fonctions géométriques pures (cotes, nuage de révision, conversions
  d'échelle, surfaces, rotation, accrochage), sans DOM ni Fabric.
- `migrate.js` : migration des fichiers projet, isolée et testable.
- **28 tests automatisés** (`node --test "tests/*.test.js"`, zéro dépendance), dont la
  migration du projet réel utilisé comme fixture. Un test a immédiatement révélé une
  anomalie d'angle de texte de cote (360° au lieu de 0°), corrigée.
- Code mort supprimé : `createDimensionObject`, `addDefaultLayer`, `normV` dupliqué.

## v1.2.0 — Lot 1 : Fiabilité

Objectif : supprimer toute perte de données silencieuse et rendre le chargement supportable.

### Corrigé — perte de données

- **Verrouiller un calque ne détruit plus ses lignes.** Les objets temporaires (previews,
  segments intermédiaires, marqueurs) sont désormais balisés par `data.temp` et supprimés
  sur ce critère. Auparavant ils étaient identifiés par `!selectable`, ce qui visait aussi
  les objets des calques verrouillés : un simple `Échap` les effaçait définitivement.
- **Les poignées d'édition ne sont plus enregistrées comme des annotations.** Une fonction
  unique `serializePage()` décide de ce qui est persistable et est utilisée par la sauvegarde
  de page, l'historique, l'autosave, la sauvegarde de projet et l'export.
- **Plus de référence circulaire dans les fichiers projet.** Les poignées ne stockent plus
  l'objet Fabric qu'elles éditent (fichiers projet nettement plus légers).
- **`switchPage` nettoie avant de sauvegarder**, et non l'inverse.
- **Ouvrir un second PDF repart d'un état vierge** (annotations, calques, historique,
  presse-papiers). Les annotations du document précédent ne se superposent plus au nouveau.

### Corrigé — robustesse

- **Dessiner avant d'avoir ouvert un PDF** n'échoue plus par `TypeError` silencieuse :
  une garde commune prévient l'utilisateur et la barre d'outils est grisée.
- **Gestion d'erreur** sur l'ouverture de PDF, le chargement de projet et l'export, avec
  des messages explicites (document protégé, fichier corrompu, canvas trop grand…).
- **Le rendu de page ne peut plus se figer** : le fond est construit directement depuis le
  canvas hors-écran au lieu d'un aller-retour par data-URL JPEG (qui, en cas d'échec de
  chargement de l'image, laissait l'application bloquée sans message — et dégradait la
  qualité du plan par recompression).
- **Échap ferme les modales** (le gestionnaire clavier sortait avant de les traiter).
- Champ de couleur de remplissage : `#ff000022` était une valeur invalide, refusée par le
  navigateur.

### Ajouté — sécurité du travail

- **Sauvegarde automatique locale** (IndexedDB) 2 s après chaque modification, **PDF source
  inclus** (jusqu'à 200 Mo) : après une fermeture accidentelle, une barre propose de
  reprendre la session sans re-sélectionner le fichier.
- **Garde-fou à la fermeture** de l'onglet en cas de modifications non sauvegardées.
- **Empreinte du PDF dans le fichier projet** (nom, taille, nombre de pages) : ouvrir un
  projet sur le mauvais plan déclenche maintenant un avertissement explicite.
- Le fichier projet et le PDF exporté prennent le nom du plan source.

### Ajouté — chargement et confort

- **La page 1 s'affiche avant les vignettes**, qui sont ensuite rendues à la demande
  (IntersectionObserver, un rendu à la fois). Sur `plan_redresse_v4.pdf` (15 Mo, 7 pages
  de 2599 × 3677 pt) : **~8,7 s avant affichage au lieu de ~77 s**.
- **Indicateur de progression persistant** pour le chargement et l'export, au lieu d'un
  toast qui disparaissait au bout de 2,5 s alors que le traitement continuait.
- **Les erreurs se distinguent des informations** (toast rouge, 12 s).
- **État du document dans l'en-tête** : nom du plan, point orange si modifications non
  sauvegardées, heure de la dernière sauvegarde automatique.
- **État vide guidé** et **glisser-déposer** d'un PDF ou d'un projet sur la zone de travail.
- **Import de symbole personnalisé accessible** : le champ existait mais aucun bouton ne
  l'ouvrait.
- Avertissement au-delà de 100 Mo, et confirmation avant d'écraser un travail non sauvegardé.
- Confirmation si l'export ne contient aucun calque.

---

## v1.1.0 — Référence

État initial, avant audit.
