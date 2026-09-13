# Journal des versions — Annoteur Plans PDF

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
