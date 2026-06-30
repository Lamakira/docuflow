---
name: Desktop agent — problèmes de tracking idle, veille et sessions journalières
description: Quatre comportements manquants ou incorrects dans desktop-agent comparés à Time Doctor 2. Analyse cause racine + objectif + pistes d'implémentation. Aucune modification effectuée à ce stade.
---

## Contexte

Le desktop-agent est conçu pour remplacer Time Doctor 2 (TD2) dans le suivi du temps de travail. Lors d'une session de test du 2026-06-25 sur Linux, quatre écarts de comportement ont été identifiés par rapport à ce que TD2 propose. Les causes racines ont été confirmées par lecture du code source. Aucune modification n'a été effectuée — ce document sert de brief pour l'implémentation.

---

## Problème 1 — Sur Linux, le reminder idle ne se déclenche jamais

### Ce qui se passe

Toutes les 3 à 5 minutes, l'app tente de faire une capture d'écran. Sur Linux avec Wayland (Ubuntu 22.04+), cette tentative ouvre une dialog système de sélection d'écran (portail XDG Desktop Portal). L'utilisateur doit cliquer pour confirmer. Or, cette interaction remet à zéro le compteur d'inactivité de l'OS. Comme l'app attend 10 minutes d'inactivité continue pour afficher le warning idle, et que la capture réinitialise ce compteur toutes les 3–5 minutes, le seuil de 10 minutes n'est jamais atteint en pratique.

Le problème ne se reproduit pas sur Windows ni sur macOS (après la première autorisation), où la capture s'effectue de façon silencieuse.

### Ce qu'on veut atteindre

Le mécanisme de détection d'inactivité doit fonctionner indépendamment des captures d'écran. Sur Linux, l'apparition de la dialog de sélection d'écran ne doit pas interférer avec le compteur idle.

### Pistes

- Mettre le timer en pause silencieuse locale (sans commande serveur) pendant la durée de l'appel de capture, puis le reprendre automatiquement. Le temps passé dans la dialog serait ainsi exclu du temps travaillé et n'interférerait pas avec le compteur idle.
- Détecter si la session est Wayland et désactiver automatiquement les captures sur ce mode jusqu'à ce qu'une meilleure solution soit disponible.
- Investiguer l'utilisation d'un token persistant PipeWire pour éviter la dialog à chaque capture (solution plus technique, dépendante de la version du portail installé).

---

## Problème 2 — La mise en veille ne met pas le tracking en pause

### Ce qui se passe

Quand le PC se met en veille, le timer reste dans l'état "en cours". Les sessions restent ouvertes et le temps de veille est entièrement comptabilisé comme du temps travaillé. L'event `suspend` de l'OS est bien capté par l'app mais il sert uniquement à enregistrer un événement analytique — aucune action n'est effectuée sur le timer.

Le seul mécanisme qui corrige partiellement ce problème est la réconciliation des sessions orphelines au redémarrage de l'app, mais il ne s'active pas à la sortie de veille.

### Ce qu'on veut atteindre

Comportement identique à TD2 : dès que le PC se met en veille, le timer passe en pause. À la sortie de veille, le timer reste en pause — l'utilisateur doit reprendre manuellement. On ne reprend pas automatiquement, car l'utilisateur a peut-être pris une pause déjeuner ou repris le lendemain.

### Pistes

- Écouter l'événement `suspend` de l'OS dans le processus principal (et non uniquement dans le worker d'activité) et déclencher une pause locale du timer à ce moment.
- À la sortie de veille (`resume`), rafraîchir l'affichage pour que l'utilisateur voit clairement que le timer est en pause et doit être repris.
- Pas de commande pause/resume envoyée au serveur pour les événements de veille — la session se ferme localement à l'heure de la mise en veille, et reprendra normalement via l'action manuelle de l'utilisateur.

---

## Problème 3 — Le warning idle doit déclencher une pause immédiate, sans countdown

### Ce qui se passe

Actuellement, quand l'utilisateur est inactif au-delà du seuil configuré, l'app affiche un warning avec un compte à rebours (60 secondes par défaut). Pendant tout ce temps, le timer continue de tourner. À l'issue du countdown, le timer est arrêté rétroactivement — ce qui détruit la session en cours et force l'utilisateur à tout recréer (resélectionner projet, tâche, relancer). Si l'utilisateur clique "oui, je travaille encore", le timer n'a jamais été mis en pause et continue simplement.

En pratique, si la fenêtre est cachée ou que l'utilisateur ne voit pas le warning (ce qui est fréquent car l'app n'envoie pas de notification système), le countdown expire silencieusement et la session est détruite.

### Ce qu'on veut atteindre

Dès que le seuil d'inactivité est atteint, le timer passe immédiatement en **pause** (pas en arrêt). Le warning informe simplement l'utilisateur qu'il a été mis en pause car il semblait inactif. Il n'y a pas de countdown. La session reste ouverte, en pause. Quand l'utilisateur revient et clique "je suis de retour", le timer reprend depuis l'état pausé. S'il confirme qu'il était en pause, le timer reste arrêté et la session se ferme normalement à l'heure où l'inactivité a commencé.

Ce comportement évite de détruire les sessions et ne requiert pas que l'utilisateur se souvienne de quel projet il trackait.

### Pistes

- À la détection du seuil idle, déclencher immédiatement une pause locale + commande `pause` vers le serveur, puis envoyer le prompt au renderer.
- Supprimer le countdown du composant `IdlePrompt`. Le message peut être reformulé : "Vous semblez inactif — tracking mis en pause. Cliquez pour reprendre."
- Le bouton "je suis de retour" déclenche un vrai `resume` (et non un simple dismiss comme aujourd'hui).
- La détection d'une activité globale (frappe clavier ou clic souris en dehors de la fenêtre de l'app) peut aussi déclencher la reprise automatique, comme TD2 le fait.

---

## Problème 4 — L'affichage du temps ne se réinitialise pas chaque jour par projet

### Ce qui se passe

Dans TD2, le compteur affiché dans l'app correspond uniquement aux heures trackées **ce jour** pour le projet en cours. Chaque matin le compteur repart de zéro. L'historique total est accessible dans les rapports mais n'est pas mis en avant dans l'interface quotidienne.

Dans le desktop-agent, la notion de "temps aujourd'hui" (`workedToday`) existe bien dans le code et est calculée correctement en excluant ce qui précède minuit. Cependant, une autre valeur (`elapsed`) représente le total cumulé de l'entrée active sans limite de date. Si l'UI affiche `elapsed` au lieu de `workedToday`, l'utilisateur voit un total accumulé sur plusieurs jours plutôt que le compteur du jour.

Par ailleurs, les sessions ne sont pas structurées par jour : une même entrée (`TimeEntry`) peut s'étaler sur plusieurs jours. Cela fonctionne pour le calcul de `workedToday` (qui est clamped à minuit), mais peut poser des problèmes si le serveur traite une entrée comme un tout indivisible plutôt que de la découper par jour.

### Ce qu'on veut atteindre

Comportement cible identique à TD2 :

- Le compteur de l'app affiche toujours le temps tracké **pour la journée en cours** sur le projet actif. Il repart de zéro chaque matin.
- Les données conservent l'historique complet — total all-time par utilisateur, par projet, par jour — pour les rapports et les breakdowns managériaux.
- Sur le serveur, il est souhaitable qu'une nouvelle entrée soit créée chaque jour (à minuit ou au premier démarrage du tracking) pour que les données soient proprement segmentées par date sans dépendre d'un calcul de clamp côté client.

### Pistes

- Vérifier en priorité ce que le composant d'affichage du timer utilise réellement (`elapsed` vs `workedToday`) — c'est peut-être juste un bug d'affichage sans refonte nécessaire.
- Si le calcul côté client est correct mais l'affichage non, corriger uniquement le composant concerné pour utiliser `workedToday`.
- Si on veut une segmentation propre côté serveur : à minuit (ou à la première reprise du tracking le lendemain), créer automatiquement une nouvelle `TimeEntry` pour le même projet/tâche plutôt que de prolonger l'entrée existante. Cela permet des requêtes serveur simples par date sans logique de clamp.
- Les données de total all-time et de breakdown par projet restent calculables côté serveur en agrégeant les entrées — aucune perte d'information.
