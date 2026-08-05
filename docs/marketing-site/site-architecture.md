# DocuFlow — Architecture du site vitrine

> Document de cadrage. À valider avec Masdouk avant écriture de code.
> Statut : proposition — 21 juillet 2026

---

## 1. Décisions actées

| Sujet | Décision |
|---|---|
| Nom du produit | **DocuFlow** |
| Référence structure | timedoctor.com |
| Référence design / playbook SEO | agentiavocal.ca |
| Framework | **Astro** (voir §2) |
| Repo | Nouveau repo, séparé de l'app |
| Domaine | À définir |
| Tarifs | Fictifs en phase de design (voir §6) |

## 2. Pourquoi Astro

Le site est du contenu marketing statique, publié une fois puis modifié rarement. Aucune logique serveur, aucune session partagée avec l'app.

- **Zéro JS par défaut** → Core Web Vitals excellents d'office, ce qui est un facteur de classement direct.
- **Content Collections** → le SEO programmatique est le cas d'usage natif : un schéma typé + un jeu de données + `getStaticPaths()` = N pages générées.
- **Îlots React** via `@astrojs/react` → on réimporte les composants shadcn/ui et la config Tailwind de DocuFlow. Cohérence visuelle app ↔ site sans repartir de zéro.
- **i18n de routing intégré** → indispensable si bilingue.
- **Build statique** → hébergement Cloudflare Pages / Netlify, coût quasi nul.

Next.js n'apporterait ici que de la complexité (App Router, RSC, frontière client/serveur) sans contrepartie, puisqu'il n'y a rien de dynamique à rendre.

## 3. Décisions à trancher avec Masdouk

Ces trois points déterminent le volume de travail. À poser avant de construire.

1. **Bilingue FR/EN ou EN seul ?**
   agentiavocal.ca est bilingue et vise le Québec. Time Doctor est anglophone. Ça double le contenu et structure tout le routing — impossible à rattraper après coup proprement.
   *Recommandation : EN d'abord, architecture i18n en place dès le départ, FR en phase 2.*

2. **Fait-on des pages locales par ville ?**
   agentiavocal liste 50+ villes du Québec en footer. Ça marche pour un service local. Pour un outil B2B SaaS vendu partout, le retour est beaucoup plus faible et le risque de contenu dupliqué (pénalité Google) est réel.
   *Recommandation : non. Remplacer ce budget par des pages comparatives, bien plus rentables (voir §4).*

3. **Preuve sociale.**
   Masdouk évoque le « 10 000+ équipes nous font confiance » de Time Doctor. DocuFlow n'a pas encore de clients externes. Publier des chiffres ou des logos inventés est un risque réel : au Canada, les indications trompeuses tombent sous la *Loi sur la concurrence*, et un prospect qui découvre le pot aux roses est perdu définitivement.
   *Recommandation : bâtir la preuve sur ce qui est vrai et vérifiable — « Construit par une agence, pour les agences », « Utilisé quotidiennement par l'équipe TECHMA depuis X mois », les vrais chiffres d'usage interne (heures suivies, captures traitées, documents indexés). C'est plus crédible qu'un chiffre rond invérifiable, et ça devient un angle de vente honnête.*

## 4. Arborescence

### Pages fixes (écrites à la main)

```
/                        Accueil
/pricing                 Tarifs
/about                   À propos / l'équipe
/contact                 Contact + démo
/security                Sécurité & confidentialité des données
/legal/privacy           Politique de confidentialité
/legal/terms             Conditions d'utilisation
/legal/dpa               Entente de traitement des données
/404
```

### Pages Produit (1 par fonctionnalité — template commun)

Les 4 piliers réels du produit, tels qu'ils existent dans le code :

```
/product/time-tracking            Chrono web + minuteur, feuilles de temps
/product/employee-monitoring      Captures d'écran, agent bureau
/product/activity-analytics       Niveaux d'activité, temps mort, tableaux de bord
/product/attendance               Présence, horaires, exports
/product/task-management          Tâches, projets, mises à jour quotidiennes
/product/crm                      Clients, contacts, pipeline, budgets
/product/documentation            Éditeur de blocs, pages imbriquées, modèles
/product/ai-assistant             Recherche sémantique, transcriptions vidéo
/product/desktop-app              Windows / macOS / Linux
/product/reports                  Rapports & exports
```
**10 pages**

### Pages Solutions (template commun)

Par secteur :
```
/solutions/digital-agencies
/solutions/software-teams
/solutions/consulting-firms
/solutions/accounting-firms
/solutions/legal-services
/solutions/bpo-call-centers
/solutions/construction
/solutions/staffing-agencies
```
**8 pages**

Par cas d'usage :
```
/use-cases/remote-teams
/use-cases/hybrid-teams
/use-cases/client-billing
/use-cases/employee-productivity
/use-cases/project-profitability
/use-cases/onboarding-documentation
```
**6 pages**

### Pages comparatives — le vrai levier SEO

Ce sont les pages à plus fort taux de conversion du secteur : quelqu'un qui tape « Time Doctor alternative » est en fin de cycle d'achat, pas en découverte. C'est là qu'il faut mettre le budget, pas dans des pages par ville.

```
/compare/docuflow-vs-time-doctor
/compare/docuflow-vs-hubstaff
/compare/docuflow-vs-toggl-track
/compare/docuflow-vs-clockify
/compare/docuflow-vs-activtrak
/compare/docuflow-vs-insightful
/compare/docuflow-vs-notion-plus-time-tracker
/compare/docuflow-vs-monday

/alternatives/time-doctor-alternative
/alternatives/hubstaff-alternative
/alternatives/toggl-alternative
/alternatives/clockify-alternative
/alternatives/activtrak-alternative
```
**13 pages**

⚠️ Règle absolue sur ces pages : chaque affirmation sur un concurrent doit être sourcée depuis sa page tarifaire publique, avec la date de consultation. Un tableau comparatif faux est une plainte pour dénigrement.

### Ressources
```
/resources                Hub
/blog                     Index
/blog/[slug]              Articles
/glossary/[term]          Glossaire (time tracking, idle time, activity level…)
/changelog
```

### Volume total

| Scénario | Pages |
|---|---|
| EN seul, sans villes | **~51** |
| EN + FR | ~102 |
| EN + FR + 40 villes | ~182 |

Ce n'est pas 3-4 heures de travail. Le **template** d'une page produit peut se faire en 3-4 h ; les 51 pages remplies, non. À cadrer honnêtement avec Masdouk : proposer une **phase 1 = accueil + tarifs + 4 pages produit + 2 comparatives (9 pages)**, mise en ligne rapide, puis remplissage progressif.

## 5. Content Collections (Astro)

```ts
// src/content/config.ts
features    → { title, slug, pillar, tagline, hero, benefits[], screenshots[], faq[], related[] }
industries  → { title, slug, painPoints[], featuresUsed[], testimonial?, faq[] }
useCases    → { title, slug, scenario, featuresUsed[], outcome }
comparisons → { competitor, slug, pricingSource, checkedOn, table[], verdict }
posts       → { title, slug, date, author, excerpt, tags[] }
glossary    → { term, slug, definition, related[] }
```

Chaque collection alimente un unique template `[slug].astro`. Ajouter une page = ajouter un fichier de données, pas du code.

## 6. Tarifs (fictifs — placeholder)

À utiliser pour le design uniquement.

| Plan | Prix | Cible |
|---|---|---|
| Starter | 7 $/utilisateur/mois | Petites équipes, suivi du temps + tâches |
| Growth | 14 $/utilisateur/mois | + monitoring, analytics, CRM |
| Business | 22 $/utilisateur/mois | + documentation, assistant IA, exports |
| Enterprise | Sur devis | SSO, hébergement dédié, SLA |

⚠️ Ne pas mettre en ligne et faire indexer des prix destinés à changer : Google garde les anciennes valeurs en cache et un prospect retient le premier prix vu. Sur la version publiée, mettre soit **« Beta pricing — subject to change »**, soit un simple **« Contact us »**, et garder ces chiffres en interne pour la validation du design.

## 7. Fondations SEO techniques

- `sitemap.xml` généré (`@astrojs/sitemap`), `robots.txt`
- Balises canoniques sur toutes les pages ; `hreflang` si bilingue
- JSON-LD : `SoftwareApplication` sur les pages produit, `FAQPage` sur les FAQ, `Organization` global, `BreadcrumbList`
- Titres uniques ≤ 60 car., meta descriptions ≤ 155 car., un seul `<h1>` par page
- Open Graph + images sociales générées par page
- Cible Lighthouse ≥ 95 sur les 4 axes, LCP < 2 s, CLS ≈ 0
- Maillage interne : chaque page produit renvoie vers 3 secteurs et 2 comparatives

## 8. Prochaines étapes

1. Valider cette arborescence + les 3 décisions du §3 avec Masdouk
2. Faire produire les maquettes par Claude Design (voir `design-brief.md`)
3. Revue des maquettes avec Masdouk, écran par écran
4. Initialiser le repo Astro et intégrer
