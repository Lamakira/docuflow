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

## Spacing & layout

- **A board (the Opportunities pipeline, or any future board) fills the page below its head, every column is the board's height, and a column with more cards than fit scrolls inside itself. The page itself never scrolls. Never size columns to their own content, and never stretch them to the longest one.**
  Why: the owner's model is Trello. Stretched to the longest column (Won, thousands of pixels), the short columns became long empty strips; sized to their content, columns stopped lining up.
  <!-- 2026-11-18: "je pensais que tu avais corrigé les cards qui s'allongent et prennent la longueur de la carte la plus longue" -->
  <!-- 2026-11-18: "les cartes doivent avoir la même taille. celles qui ont un nombre d'éléments qui dépasse la longueur normal, on doit scroller à l'intérieur comme c'est fait sur Trello" (after rejecting columns sized to their content) -->

- **Heads in a row of columns or cards are all the same height. A head never wraps only when its text is long: it stays on one line, and a label too long for it ends in an ellipsis.**
  Why: a taller head starts its column's content lower than the others ("Discovering call completed" did).
  <!-- 2026-11-19: "Regarde le décalage créé par l'en-tête de la colonne "Discovering call completed"" -->

## Copy

- **A page's name appears in the sidebar and in its title, nowhere else. A top-level page's breadcrumb stops at the Workspace. A subtitle exists only when it says something the title does not: never "<Page> in <Workspace>."**
  Record and nested pages keep their full breadcrumb (`DocuFlow / Opportunities / <name>`); the File viewer keeps `DocuFlow / File`, because its title is the File's name.
  Why: the name four times over (sidebar, breadcrumb, title, subtitle) adds nothing and crowds the head.
  Check: `tests/characterization/web-app-v2-design-rules.test.ts`, and the breadcrumb case in `tests/characterization/web-app-v2-opportunities.test.ts`.
  <!-- 2026-11-19: "le fait qu'il y ait "Opportunities" 3 fois la ici, je n'aime pas"; then chose: breadcrumb and subtitle, on every page -->
