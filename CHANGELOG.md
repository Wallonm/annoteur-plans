# Journal des versions — Annoteur Plans PDF

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
