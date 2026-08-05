# Brief de design — Site vitrine DocuFlow

> **À coller intégralement dans Claude Design.**
> Le brief est en français ; **toute la copy affichée à l'écran doit être en anglais.**

---

## 1. Le produit

DocuFlow est une plateforme d'opérations tout-en-un pour les entreprises de services (agences, studios de développement, cabinets de conseil, comptables). Elle réunit en un seul outil ce que ces équipes paient aujourd'hui à quatre fournisseurs différents :

1. **Le temps** — minuteur web, feuilles de temps, présence, exports prêts pour la paie
2. **L'activité** — agent bureau (Windows / macOS / Linux) qui capture les captures d'écran, les niveaux d'activité clavier/souris et le temps mort ; tableaux de bord analytiques
3. **Le travail et les clients** — CRM (clients, contacts, pipeline, budgets), projets, tâches, mises à jour quotidiennes
4. **La connaissance** — éditeur de documentation par blocs façon Notion, documents d'entreprise, transcription automatique des vidéos, assistant IA qui répond par recherche sémantique sur tout ce corpus

Le produit existe, il tourne en production, il est utilisé quotidiennement par l'équipe qui le vend. Il remplace Time Doctor, que cette équipe payait auparavant.

## 2. Le job de la page d'accueil

Convaincre **le dirigeant d'une entreprise de services de 5 à 50 personnes** que remplacer sa pile de quatre outils par un seul est crédible — puis le faire démarrer un essai ou réserver une démo.

Un seul objectif de conversion primaire : **Start free trial**. Objectif secondaire : **Book a demo**.

## 3. L'audience

Propriétaire ou directeur des opérations d'une agence. Il facture ses clients à l'heure ou au forfait et ne sait pas précisément où part le temps de son équipe. Il paie déjà quatre abonnements par utilisateur et par mois. Il est pragmatique, sceptique face au discours marketing, et il compare les prix. Il n'a pas de temps à perdre : s'il ne comprend pas l'offre en dix secondes, il ferme l'onglet.

Il est aussi mal à l'aise avec l'idée de « surveiller » son équipe. C'est une objection réelle à traiter, pas à ignorer.

## 4. Le message central

> **Quatre abonnements, quatre tableaux de bord, et toujours aucune vue d'ensemble de la journée.**

DocuFlow ne se vend pas comme « un outil de time tracking de plus ». Il se vend sur la **consolidation** : tout ce qui s'est passé dans la journée — les heures, les captures, les tâches, les échanges clients, les documents écrits — sur une seule et même ligne de temps, dans un seul outil, sur une seule facture.

C'est la différenciation explicite face à Time Doctor, Hubstaff et consorts, qui ne couvrent qu'une tranche.

## 5. Direction artistique

### Le concept : la page est une journée de travail

Le produit sait ce qui s'est passé, heure par heure. C'est sa nature. La page reprend cette structure : **on la parcourt comme on parcourt une journée**, du matin au soir.

Chaque grande section porte une **heure réelle en monospace** au lieu d'un numéro d'ordre arbitraire, et chaque pilier produit apparaît à l'heure où il intervient naturellement dans la journée :

```
08:12  →  Le pointage         (hero)
09:40  →  Le travail          (activité, captures, analytics)
12:15  →  Les clients         (CRM, projets, tâches)
15:30  →  La connaissance     (documentation, assistant IA)
17:45  →  Le bilan            (rapports, mises à jour, facturation)
18:00  →  L'addition          (tarifs, calcul de consolidation)
```

Un **rail vertical fin sur le bord gauche** progresse au scroll, du matin vers le soir. C'est le seul élément décoratif de la page, et il encode une information vraie plutôt que d'orner.

> C'est la signature de la page — la seule chose sur laquelle on prend un risque. Tout le reste doit rester sobre et discipliné.

### Élément héros

Pas de capture d'écran de tableau de bord flottant en perspective. Le héros est **une seule ligne de temps horizontale d'une vraie journée de travail** : une bande continue de 8 h à 18 h, sur laquelle se superposent, empilées en couches, les données que le produit capture — blocs d'heures, vignettes de captures d'écran, barres de niveau d'activité, marqueurs de tâches, points de documents modifiés.

Les concurrents montrent quatre outils séparés. On montre une seule bande. **La différence de produit devient une différence visuelle immédiate.**

### Palette

Dérivée de l'arc d'une journée, et des couleurs de statut qui existent déjà dans le produit (actif / absent / occupé / hors ligne).

| Nom | Hex | Usage |
|---|---|---|
| `ink` | `#0F1524` | Bandes sombres, titres, ancrage |
| `paper` | `#F3F5F7` | Fond de page, froid pour éviter l'effet « papier crème » |
| `hour` | `#E9A23B` | Accent principal — l'heure suivie, le marqueur « maintenant » |
| `live` | `#1F9D6B` | Statut actif, validations, preuves |
| `slate` | `#59657A` | Texte courant |
| `rule` | `#D8DEE6` | Filets, séparateurs, bordures |

Progression sur la page : les bandes vont du froid (matin) vers le chaud (fin de journée) puis vers `ink` (le soir, section tarifs). **Pas un dégradé qui traverse la page** — des fonds de bande distincts et tenus, chacun uni.

### Typographie

| Rôle | Police | Note |
|---|---|---|
| Display | **Cabinet Grotesk** | Titres, serré et affirmé, poids 700–800, tracking négatif |
| Corps | **Switzer** | Texte courant, 400/500 |
| Données | **JetBrains Mono** | Heures, chiffres, étiquettes, badges — déjà la police du produit |

Toutes libres et auto-hébergeables (Fontshare / JetBrains) : aucune requête externe, meilleur LCP.

Le monospace n'est pas décoratif ici : c'est la police honnête des horodatages, et elle relie visuellement le site au produit. À utiliser partout où apparaît une heure, une durée, un pourcentage ou un prix.

**Ne pas utiliser Inter.** C'est la police du produit et le défaut de tout le SaaS ; le site vitrine doit avoir sa propre voix.

### Contraintes de forme

- Rayons de bordure faibles (4–8 px), jamais de cartes très arrondies
- Filets 1 px en `rule` plutôt que des ombres portées ; les ombres uniquement sur les éléments réellement flottants
- Grille 12 colonnes, largeur max de contenu 1200 px, largeur de texte max 68 caractères
- Mode clair uniquement pour la v1

## 6. Structure de la page d'accueil

La copy ci-dessous est à utiliser telle quelle, sauf mieux.

### 6.1 Barre de navigation
Sticky, fond `paper`, filet inférieur.
`DocuFlow` · Product (méga-menu 4 colonnes = les 4 piliers) · Solutions · Pricing · Resources · `Sign in` · **`Start free trial`**

### 6.2 Hero — `08:12`

> # See the whole workday, not slices of it.
>
> Time tracking, screenshots, activity levels, tasks, client records and documentation — on one timeline, in one tool. Service teams replace four subscriptions with DocuFlow.
>
> `Start free trial` · `Book a 15-minute demo`
>
> *No credit card. Desktop app for Windows, macOS and Linux.*

Visuel : la ligne de temps horizontale décrite au §5.

### 6.3 Bandeau de preuve

⚠️ **Contrainte stricte : aucun chiffre inventé, aucun logo client fictif.** DocuFlow n'a pas encore de clients externes. Construire la preuve sur ce qui est vrai :

> **Built by an agency that got tired of paying four vendors.**
> DocuFlow runs TECHMA's own operations every day — the timers, the screenshots, the client records, the docs. We ship what we use.

Trois chiffres d'usage interne réels en monospace, à remplir avec les vraies valeurs de la base :
`— hours tracked` · `— screenshots processed` · `— documents indexed`

### 6.4 Le problème — la pile d'outils

> ## Your stack has four logins and no memory.
>
> A time tracker that doesn't know what the work was for. A monitoring tool that doesn't know the client. A project board that doesn't know the hours. A wiki nobody opens. Four bills, four exports, and a spreadsheet to glue it together.

Visuel : quatre cartes d'outils séparées, chacune avec sa facture mensuelle, qui se replient en une seule au scroll. Sobre, une seule animation, respectant `prefers-reduced-motion`.

### 6.5 Le travail — `09:40`
**Pilier : activité & monitoring.** Captures d'écran, niveaux d'activité, détection du temps mort, agent bureau.

> ## What happened, not what was reported.
> The desktop agent records screenshots, keyboard and mouse activity and idle time in the background, and files everything against the project the timer was running on. Nobody writes a timesheet from memory.

### 6.6 Les clients — `12:15`
**Pilier : CRM, projets, tâches.**

> ## Hours belong to a client, not to a spreadsheet.
> Every tracked hour lands on a project, every project on a client, with its budget, its contacts, its stage and its notes. Profitability stops being a month-end guess.

### 6.7 La connaissance — `15:30`
**Pilier : documentation & IA.**

> ## Ask your own company a question.
> Documentation, company files and meeting recordings are indexed as they're written. Ask "what did we agree on the Ledger rebuild?" and get the answer with its source, not a list of files.

### 6.8 La transparence — objection monitoring

Section à part entière, pas une note de bas de page. C'est un argument de vente, et au Québec c'est aussi un sujet de conformité (Loi 25).

> ## Monitoring people can live with.
> Employees see exactly what's recorded and when the timer is running. Screenshots can be blurred, capture can be scheduled to working hours, and anyone can review their own data. Configure it once, tell your team, keep it visible.

### 6.9 Pour qui — `17:45`
Grille de cartes secteurs, chacune liant vers sa page `/solutions/*` : agences digitales, équipes de développement, cabinets de conseil, comptables, services juridiques, BPO, construction, agences de placement.

### 6.10 L'addition — `18:00`, bande `ink`

Le calcul de consolidation, en monospace, honnête et vérifiable :

> ## Four tools. One bill.
>
> ```
> Time tracker          $ 7 /user/mo
> Monitoring            $ 9 /user/mo
> Project management    $12 /user/mo
> Wiki / docs           $10 /user/mo
> ─────────────────────────────────
> Your stack            $38 /user/mo
> DocuFlow              $14 /user/mo
> ```

Puis les trois plans (Starter 7 $ / Growth 14 $ / Business 22 $ / Enterprise sur devis), avec la mention **« Beta pricing — subject to change »**.

### 6.11 CTA final
> ## Start tracking tomorrow morning.
> `Start free trial` · `Book a 15-minute demo`

### 6.12 Pied de page
Pied de page SEO large, quatre colonnes de liens (Product / Solutions / Compare / Company) + légal + sélecteur de langue. C'est un organe de maillage interne, à traiter comme tel : dense, lisible, complet.

## 7. Gabarits à produire également

1. **Page produit** (`/product/time-tracking`) — gabarit unique pour 10 pages : hero, bénéfices, captures, FAQ, maillage vers secteurs et comparatives
2. **Page secteur** (`/solutions/digital-agencies`) — points de douleur, fonctionnalités mobilisées, FAQ
3. **Page comparative** (`/compare/docuflow-vs-time-doctor`) — tableau comparatif, avec mention de la source tarifaire et de la date de vérification
4. **Page tarifs** — trois plans, comparateur de fonctionnalités, FAQ
5. **Méga-menu produit** et **pied de page**, en états ouvert et fermé

## 8. Ton éditorial

- Phrases courtes, voix active, verbes concrets. Une majuscule en début de phrase, pas de Title Case partout.
- Nommer les choses comme l'utilisateur les vit, pas comme le système les implémente : *screenshots*, pas *capture pipeline*.
- Un libellé de bouton décrit exactement ce qui se passe, et garde le même nom sur toute la suite du parcours.
- Aucun superlatif invérifiable : pas de *revolutionary*, *seamless*, *powerful*, *cutting-edge*, *unlock*, *supercharge*, *game-changing*.
- Être précis vaut mieux qu'être malin.

## 9. À ne pas faire

- Fond crème + serif à fort contraste + accent terracotta
- Fond noir + accent vert acide ou vermillon
- Dégradés violet/bleu, blobs flous, effets « glassmorphism »
- Numérotation `01 / 02 / 03` — la page utilise des heures, qui portent une information réelle
- Photos de banque d'images de gens souriants avec des casques téléphoniques
- Logos clients ou statistiques inventés (voir §6.3)
- Captures d'écran de tableaux de bord flottant en perspective 3D
- Inter comme police de titrage

## 10. Qualité de base attendue

- Responsive jusqu'à 360 px de large
- Focus clavier visible partout, contraste AA minimum, `prefers-reduced-motion` respecté
- Une seule séquence animée majeure (le repli de la pile, §6.4) plus des micro-interactions au survol ; rien d'autre
- Cible Lighthouse ≥ 95 sur les quatre axes, LCP < 2 s, CLS ≈ 0
- Polices auto-hébergées, aucune requête vers un domaine tiers

## 11. Livrables

1. Les tokens de design en variables CSS (couleurs, échelle typographique, espacements, rayons)
2. La page d'accueil complète, desktop et mobile
3. Les cinq gabarits du §7
4. L'inventaire des composants avec leurs états (repos, survol, focus, actif, désactivé)

L'intégration se fera en **Astro + Tailwind**, avec réutilisation des composants shadcn/ui existants du produit. Produire des tokens exploitables directement dans une config Tailwind.
