# Corrections — Landing page DocuFlow

> Delta à appliquer sur `design_handoff_docuflow_marketing_site/Homepage.dc.html`.
> **Ne pas repartir de zéro.** Le système de design, la typographie, les tokens, les espacements,
> l'animation du repli, la section Transparence et la bande 18:00 sont validés et se conservent tels quels.

---

## Le problème à corriger

La page présente DocuFlow comme un outil de time tracking avec des extras. Sur dix temps forts, huit sont cadrés par le temps : le H1, le sous-titre, le visuel héros, le rail, le titre secteurs, le CTA final, la baseline du pied de page — et jusqu'à la section censée porter le CRM, dont le visuel est un tableau d'heures consommées.

C'est à contresens du produit. DocuFlow n'a pas de fonctionnalité vedette : **le regroupement est l'argument de vente**. Un client qui paie pour quatre outils doit comprendre en quinze secondes qu'il en remplace quatre, pas qu'il achète un chronomètre.

La cause est la colonne vertébrale « la page est une journée de travail », qui est une métaphore de time tracking et qui contamine tout ce qui s'y accroche. C'est une erreur du brief initial, pas de l'exécution.

## La correction : changer la colonne vertébrale

**La page n'est plus une journée, c'est un mandat client.**

Cette structure n'est pas une idée plaquée : c'est le modèle de données réel du produit. Dans le schéma, `crmProjects` est la table pivot — les heures, les tâches, les captures, les notes, les rappels, les membres et la documentation s'y rattachent tous par `crmProjectId`. Le projet client est littéralement ce qui unifie les quatre piliers.

Les étapes du rail deviennent les **vraies étapes du CRM du produit**, en monospace majuscules :

```
LEAD  →  WON  →  IN PROGRESS  →  IN REVIEW  →  COMPLETED
```

Même rail 1 px, même point ambre, même progression au scroll, même traitement typographique. **Seuls les libellés changent.** L'accent ambre reste, il ne signifie plus « l'heure suivie » mais « l'étape courante ».

---

## 1. Nouvel ordre des sections

L'ordre suit le cycle de vie d'un mandat, ce qui rééquilibre mécaniquement les piliers : un pilier, une section.

| Étape | Section | Pilier | Changement |
|---|---|---|---|
| `LEAD` | Héros | — | Copy + visuel refaits |
| — | Bande de preuve | — | Conservée, chiffres à revoir |
| — | Le problème + animation | — | Cartes réordonnées |
| `WON` | Le client | **CRM** | Remonte avant « le travail », visuel refait |
| `IN PROGRESS` | Les heures | **Temps & activité** | Conservée telle quelle |
| `IN PROGRESS` | La documentation | **Documentation** | **Section nouvelle** |
| `IN REVIEW` | La réponse | **IA** | Conservée telle quelle |
| — | Transparence | — | Conservée telle quelle |
| `COMPLETED` | Les secteurs | — | Titre seul à changer |
| `COMPLETED` | L'addition | — | Lignes réordonnées |

Le time tracking passe d'organisateur de la page à **un pilier sur quatre**. La documentation, qui donne son nom au produit et qui n'avait qu'une demi-section partagée avec l'IA, obtient la sienne.

---

## 2. Héros — `LEAD`

### Copy

Badge d'étape (remplace `08:12 — the workday begins`) :
> `LEAD` — a new client project

**H1** — remplace « See the whole workday, not slices of it. »
> ## One place for everything a client project leaves behind.

*Alternative si Masdouk veut plus mordant :*
> ## Four tools remember four things. DocuFlow remembers the client.

**Sous-titre** — remplace l'actuel. Noter l'ordre : le CRM ouvre, les heures sont au milieu, la documentation ferme.
> Contacts, budgets, tasks, hours, screenshots and documents — all attached to the same client project, in one tool. Service teams replace four subscriptions with DocuFlow.

CTA et mention légale : inchangés.

### Visuel héros

Même carte blanche, même bordure `rule`, même rayon 8, même qualité de construction, **même zone d'inspecteur à hauteur réservée** (le CLS ≈ 0 se conserve). Ce qui change est l'axe.

Aujourd'hui : une journée de 08 h à 18 h, avec une règle horaire.
Demain : **un projet client, avec tout ce qui s'y rattache.**

En-tête de carte : `ONE CLIENT PROJECT · EVERYTHING ATTACHED` (remplace `ONE DAY · ONE TIMELINE`)

Couches, de haut en bas :
1. **Identité** — `Northwind · Ledger rebuild`, puce d'étape ambre `IN PROGRESS`
2. **Barre d'étapes** — les cinq étapes en monospace, celles franchies en `slate`, l'étape courante en ambre, les suivantes en `rule`
3. **Le dossier client** — 3 contacts (initiales en pastilles), budget `$48,000` avec barre de consommation, 2 étiquettes
4. **Les heures** — bande compacte de temps cumulé par membre, pas une règle horaire
5. **Les captures** — la rangée de vignettes rayées existante, conservée
6. **Documents et tâches** — les marqueurs carrés ambre (tâches) et ronds verts (documents) existants, conservés
7. **Inspecteur** — même comportement au survol/focus, mais il décrit la couche survolée plutôt qu'un créneau horaire

Les données factices (Northwind, Meridian, Kaleido, Ledger rebuild) sont bonnes et se conservent.

---

## 3. Le problème + animation

**L'animation elle-même ne change pas** — elle fonctionne, elle est validée.

Deux corrections :

**a) Il manque le CRM dans les quatre cartes.** Les quatre postes actuels sont Time tracker / Monitoring / Project management / Wiki-docs — aucun ne représente le pilier client. Renommer et réordonner, en gardant le total à 38 $ :

| Ordre | Carte | Prix | Sous-titre |
|---|---|---|---|
| 1 | CRM & projects | $12 | Clients, but no hours. |
| 2 | Time tracker | $7 | Hours, but no client. |
| 3 | Monitoring | $9 | Screenshots, but no context. |
| 4 | Wiki & docs | $10 | Pages nobody opens. |

**b) Le paragraphe** — remplace l'actuel, même longueur :
> A CRM that doesn't know the hours. A time tracker that doesn't know the client. A monitoring tool that doesn't know the project. A wiki nobody opens. Four bills, four exports, and a spreadsheet to glue it together.

Le titre « Your stack has four logins and no memory. » se conserve — il est bon.

⚠️ La carte résultat DocuFlow et le reçu de la section `COMPLETED` doivent lister les postes **dans le même ordre**.

---

## 4. Le client — `WON` (remonte avant « les heures »)

C'est la section la plus à corriger : elle porte le CRM mais son visuel est un tableau d'heures.

**H2** — remplace « Hours belong to a client, not to a spreadsheet. »
> ## The client record everything hangs off.

**Paragraphe** :
> Companies, contacts, budgets, stages and notes live in the CRM. Every project, task, hour, screenshot and document files itself against the right client — not because someone tagged it, but because that's where it was created.

**Visuel** — remplace le tableau `Northwind 38.5 h · 62% used`. Montrer **la fiche client**, pas sa consommation d'heures :
- En-tête : `Northwind Systems`, puce d'étape ambre `Won — In progress`
- Trois contacts avec rôle (mono 11 px)
- Budget : `$48,000` et une barre de consommation
- Deux étiquettes
- Un rappel à venir : `Apr 12 · Scope review`
- **Une seule ligne d'heures** en bas, discrète — les heures sont un attribut du client parmi d'autres, plus le sujet

---

## 5. Les heures — `IN PROGRESS`

Section actuelle `09:40`. **Aucun changement** hors le libellé d'étape.

Le H2 « What happened, not what was reported. » et le visuel (captures + histogramme d'activité) sont bons et se conservent.

---

## 6. La documentation — `IN PROGRESS` (section nouvelle)

Le produit s'appelle DocuFlow et est né comme outil de documentation. Il n'avait qu'une demi-section partagée avec l'IA.

Bande : réutiliser le fond chaud `#FBF3E6` existant.

**H2** :
> ## Write it where the work is.

**Paragraphe** :
> The block editor lives inside the client project — specs, meeting notes, statements of work, nested pages, reusable templates. Not a separate wiki nobody opens, because it's already where the work is.

**Visuel** — carte blanche, mêmes conventions que les autres visuels :
- Fil d'Ariane mono 11 px : `Northwind / Ledger rebuild / Technical spec`
- Une maquette de page en blocs : un titre, un paragraphe, une case à cocher cochée, un bloc de code rayé
- Une poignée de déplacement à six points à gauche d'un bloc, en `rule` — le détail qui signale un vrai éditeur

---

## 7. La réponse — `IN REVIEW`

Section actuelle `15:30`. **Aucun changement** hors le libellé d'étape.

Le H2 « Ask your own company a question. » et la carte de questions-réponses avec ses pastilles de source sont excellents et se conservent.

---

## 8. Transparence

**Aucun changement.** Section réussie, bien placée, conservée telle quelle.

---

## 9. Les secteurs — `COMPLETED`

**H2** — remplace « Teams that bill for their time. »
> ## Teams that deliver for clients.

Les huit cartes et leur comportement au survol sont conservés.

---

## 10. L'addition — `COMPLETED`

Bande `ink`, carte reçu, plans tarifaires, badge « Beta pricing » : **tout se conserve.**

Une seule correction : réordonner les quatre lignes du reçu pour qu'elles correspondent aux cartes de l'animation (CRM & projects $12 · Time tracker $7 · Monitoring $9 · Wiki & docs $10). Totaux inchangés — 38 $ contre 14 $.

---

## 11. CTA final

**H2** — remplace « Start tracking tomorrow morning. »
> ## Start with your next client project.

Bande ambre, boutons : inchangés.

---

## 12. Pied de page

**Baseline** — remplace « Time, activity, clients and knowledge on one timeline. Built and run by TECHMA. »
> Clients, projects, hours and documentation in one tool. Built and run by TECHMA.

Colonnes de liens, sélecteur de langue, mention Loi 25 : inchangés.

---

## 13. Bande de preuve

Structure et traitement conservés. Deux réserves :

- Les trois chiffres sont fictifs (184 200 h · 2,6 M captures · 11 400 documents). À remplacer par les valeurs réelles de la base avant toute mise en ligne, ou à retirer. Le brief interdit les statistiques inventées, et au Canada les indications trompeuses relèvent de la *Loi sur la concurrence*.
- Les trois métriques ne couvrent que le temps, les captures et les documents. **Ajouter une métrique client** (projets suivis ou clients gérés) pour que la preuve reflète les quatre piliers.

---

## Ce qui ne change pas

Pour lever toute ambiguïté — se conservent à l'identique :

- Les tokens `ink` / `paper` / `hour` / `live` / `slate` / `rule` et leurs variantes
- Cabinet Grotesk / Switzer / JetBrains Mono, et l'usage du monospace sur tout chiffre, durée, prix ou badge
- L'échelle : 1200 px de contenu, 84–92 px de padding vertical, rayons 4–8 px, filets 1 px plutôt qu'ombres
- L'arc chromatique froid → chaud → `ink` entre les bandes
- Le rail vertical 1 px, son point ambre, sa progression au scroll écrite directement dans le DOM
- L'animation du repli en une passe, `IntersectionObserver` à 0.45, `prefers-reduced-motion` respecté
- Le focus global `2px solid #E9A23B`, les points de rupture 1240 / 900 / 560, la réserve de hauteur de l'inspecteur
