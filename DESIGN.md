# DESIGN.md

Design rules for the v2 web app (`client/src/v2/`), each one a correction the
owner made. Read this before building or changing UI. A rule with a check names
the test that enforces it.

## Surfaces

- **A board column's head shows the stage and the number of cards, nothing else: never a money total.**
  Each card still shows its own Estimated value.
  Why (inferred, not confirmed by the owner): the total crowded the head and forced it onto a second line.
  <!-- 2026-11-19: "enlèves carrément le total de l'argent la" -->

- **A region that scrolls inside a page (a board column, a list inside a card) has a scrollbar that blends into it: no arrow buttons, no visible track, a thin rounded thumb tinted with the surface's colour (in a board column, `color-mix(in srgb, var(--df-stage) 35%, transparent)`), shown only while the pointer is over the region.**
  The region always reserves the bar's room (`scrollbar-gutter: stable`), so content keeps the same width whether it scrolls or not.
  Style it with `::-webkit-scrollbar*` and never set `scrollbar-width` or `scrollbar-color` on that element: Chrome ignores `::-webkit-scrollbar` as soon as either is set, and `scrollbar-width: thin` brings the arrow buttons back on Linux. Firefox gets `scrollbar-width: thin` only inside `@supports not selector(::-webkit-scrollbar)`.
  Why: the owner wants the bar to "fondre dans le décor".
  Check: `tests/characterization/web-app-v2-design-rules.test.ts`.
  <!-- 2026-11-19: "je veux une barre de scroll intégrée au card, sans les boutons de haut bas la. qu'on ait l'impression que ça fond dans le décor en fait" -->

- **Every empty or failed region is drawn by `client/src/v2/V2EmptyState.tsx`, never by hand: an icon, a title, one line and the way out, centred.**
  `V2RecordEmpty` for a record list (nothing yet, filters hide every row, or a Range that holds nothing: the filters or the search are named, and the one action clears them), `V2LoadFailed` for a failed load (its own icon, Try again), `V2EmptyState` for any other region, `V2CompactEmpty` for a section of a card that has a title, `V2EmptyLine` inside a field, a settings row, a dialog or a sheet. The count and the column heads above an empty list go away. Muted text that is not an empty state (a hint, a footnote, a wait) wears `df-note`.
  Why: empty states were being corrected one screen after another; the owner does not want to come back to it.
  Check: `tests/characterization/web-app-v2-empty-states.test.ts` fails on an empty or failed line written in a screen.
  <!-- 2026-11-25: "regarde encore un empty state mal géré"; "je ne veux vraiment plus revenir dessus. comment faire en sorte qu'un empty state soit partagé partout dans l'app de sorte à ne pas refaire ça ou corriger ça un par un" -->

## Spacing & layout

- **A board (the Opportunities pipeline, or any future board) fills the page below its head, every column is the board's height, and a column with more cards than fit scrolls inside itself. The page itself never scrolls. Never size columns to their own content, and never stretch them to the longest one.**
  Why: the owner's model is Trello. Stretched to the longest column (Won, thousands of pixels), the short columns became long empty strips; sized to their content, columns stopped lining up.
  <!-- 2026-11-18: "je pensais que tu avais corrigé les cards qui s'allongent et prennent la longueur de la carte la plus longue" -->
  <!-- 2026-11-18: "les cartes doivent avoir la même taille. celles qui ont un nombre d'éléments qui dépasse la longueur normal, on doit scroller à l'intérieur comme c'est fait sur Trello" (after rejecting columns sized to their content) -->

- **Heads in a row of columns or cards are all the same height. A head never wraps only when its text is long: it stays on one line, and a label too long for it ends in an ellipsis.**
  Why: a taller head starts its column's content lower than the others ("Discovering call completed" did).
  <!-- 2026-11-19: "Regarde le décalage créé par l'en-tête de la colonne "Discovering call completed"" -->

- **Every page's head is `client/src/v2/V2PageHead.tsx`: the title with its count or date beside it in a filled pill, the line about the page right under it, and the actions on the title's line, all as tall as a button.**
  Never a bordered chip (it reads as a control) nor one beside a button, and never a note under the head for what the subhead says. One or two filters sit in the head, before the main button; a row of filters starts at three.
  Why: on People the boxed `1 Member` was shorter than `Invite`, and the seats line stood apart from the title; each screen spaced its head its own way.
  Check: `tests/characterization/web-app-v2-design-rules.test.ts`.
  <!-- 2026-11-25: "la mention "1 member" est plus petit que le bouton "Invite" et la mention "1 of 500 Billable Seats used." est trop espacé du titre [...] il y a un manque de cohérence dans la gestion de l'espace ici"; then, of plain text: "la mention "1 member" n'est pas directement visible et pour l'input de recherche et la case à cocher [...] ils prennent une ligne entière à eux seul" -->

## Copy

- **A page's name appears in the sidebar and in its title, nowhere else. A top-level page's breadcrumb stops at the Workspace. A subtitle exists only when it says something the title does not: never "<Page> in <Workspace>."**
  Record and nested pages keep their full breadcrumb (`DocuFlow / Opportunities / <name>`); the File viewer keeps `DocuFlow / File`, because its title is the File's name.
  Why: the name four times over (sidebar, breadcrumb, title, subtitle) adds nothing and crowds the head.
  Check: `tests/characterization/web-app-v2-design-rules.test.ts`, and the breadcrumb case in `tests/characterization/web-app-v2-opportunities.test.ts`.
  <!-- 2026-11-19: "le fait qu'il y ait "Opportunities" 3 fois la ici, je n'aime pas"; then chose: breadcrumb and subtitle, on every page -->

- **The browser tab's title names the screen: what is open first, then what holds it, then DocuFlow (`Gallery - Activity - DocuFlow`, `Acme - Clients - DocuFlow`).**
  Every title comes from `pageTitleFor` (`client/src/v2/presentation.ts`), set by `V2PageTitle`.
  Why: every tab said `DocuFlow`, so several tabs of the app could not be told apart.
  Check: `tests/characterization/web-app-v2-page-title.test.ts`.
  <!-- 2026-11-25: "je ne peux pas savoir directement dans quel onglet je me trouve. ça affiche juste "Docuflow" quel que soit l'onglet" -->

- **No em dash anywhere the app shows text: screens, dialogs, empty states, help articles, emails. Write a comma, a colon, a semicolon, brackets or a new sentence; where a dash is really needed, use a hyphen (`-`).**
  An empty value in a list or a record shows `-`. Code comments and operator messages (logs, configuration) are not text the app shows. v1 screens stay as they are.
  Why: the owner's choice; no reason given.
  Check: `tests/characterization/web-app-v2-design-rules.test.ts`.
  <!-- 2026-11-24: ""Project Documents in DocuFlow — visible to Members assigned to that Project." mets ça dans les règles du projet. Pas de tiret cadratin dans toute l'app. Utilise les tirets - si nécessaire" -->
