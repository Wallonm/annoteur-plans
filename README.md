# Annoteur Plans PDF

Application web d'annotation et de relevé sur plans PDF : cotation à l'échelle,
symboles architecturaux, calques, comptage, et export vectoriel.

Aucune installation, aucun serveur, aucune donnée envoyée à l'extérieur :
tout se passe dans le navigateur.

## Démarrer

Ouvrir `index.html` dans un navigateur récent — par double-clic, ou via un
petit serveur local :

```bash
npx serve -p 3335 .
```

Les bibliothèques sont servies depuis `vendor/` : **l'application fonctionne
hors ligne**, y compris sur chantier sans réseau.

## Organisation

| Fichier | Rôle |
|---|---|
| `index.html` | Interface et styles |
| `app.js` | État, outils, calques, rendu, pages, export rastérisé |
| `geometry.js` | Géométrie pure (cotes, échelles, surfaces) — sans DOM |
| `migrate.js` | Migration des fichiers projet entre formats |
| `export-vector.js` | Export vectoriel via pdf-lib |
| `tools-metier.js` | Surface, comptage, bulles, tampons, récapitulatif CSV |
| `symbols.js` | 65 symboles architecturaux, cotés en cm réels |
| `vendor/` | pdf.js, Fabric, jsPDF, pdf-lib (versions figées) |
| `tests/` | Tests sans dépendance |

## Tests

```bash
node --test "tests/*.test.js"
```

47 tests, aucune dépendance à installer. Ils couvrent la géométrie des cotes,
les conversions d'échelle, la saisie manuelle des cotes, la rotation de page,
la migration des projets (avec un projet réel en fixture) et le format d'export CSV.

Un test bout en bout dans un vrai navigateur (`tests/e2e/`) vérifie la saisie
manuelle des cotes et la recoloration des symboles existants. Il demande
Playwright et Chromium, voir l'en-tête du fichier.

## Cotes

Trois clics posent une cote : point de départ, point d'arrivée, écartement.
Pour **ajuster une cote existante à une valeur connue** (lue sur le plan, ou
mesurée sur place) : double-clic sur la cote, ou champ *Valeur* de la barre de
style quand elle est sélectionnée. Le point de départ et l'alignement sont
conservés, le second point est déplacé à la longueur saisie selon la
calibration de la page. Saisie libre : `4,20`, `4.2 m`, `350 cm`, `120 pt`.

## Repère de coordonnées

Les annotations sont stockées en **points PDF** (1 pt = 1/72 pouce = 0,353 mm),
dans le repère de la page, origine au coin haut-gauche. L'affichage n'intervient
jamais dans les données : zoom et déplacement ne touchent que la vue.

C'est ce qui garantit qu'un projet rouvert sur un autre écran, dans une fenêtre
d'une autre taille, retombe exactement au bon endroit — et que la calibration
reste valable à vie.

## Formats de fichier projet

| Version | Contenu |
|---|---|
| 1.0 / 1.1 | Coordonnées en pixels écran, calques par page — **converti automatiquement** |
| 2.0 | Coordonnées en points PDF |
| 2.1 | Calques globaux au document (format courant) |

L'ouverture d'un ancien projet déclenche la conversion sans intervention, avec
un message indiquant ce qui a été fait.

## Export

- **Vectoriel** (par défaut) : les annotations sont ajoutées au PDF d'origine
  en tracés et en texte réel. Le plan garde sa qualité et son texte reste
  sélectionnable ; les annotations aussi.
- **Rastérisé** : tout est aplati en image. Compatible partout, mais plus lourd
  et dégradé. À réserver aux cas où le mode vectoriel pose problème.

Dans les deux cas la page exportée conserve la taille physique du plan source,
donc l'impression à l'échelle est exacte.

## Calques

Les calques appartiennent au **document**, pas à la page : un même calque peut
porter des annotations sur plusieurs pages. Le panneau indique donc, pour chacun,
combien d'objets il contient **sur la page affichée** ; ceux qui n'y ont rien
sont estompés, et le bouton *Cette page* les masque complètement.

Un clic sur la pastille de couleur change le repère du calque.

## Raccourcis

`?` ou `F1` affiche la liste complète, construite à partir de la table
réellement utilisée par l'application.

## Sauvegarde

Une sauvegarde automatique locale (IndexedDB) intervient 2 s après chaque
modification, **PDF source inclus**. Après une fermeture accidentelle, une barre
propose de reprendre la session sans re-sélectionner le fichier.

Cela ne remplace pas *Projet → Sauver projet*, qui produit un fichier
`.annot.json` que vous maîtrisez et pouvez archiver ou transmettre.
