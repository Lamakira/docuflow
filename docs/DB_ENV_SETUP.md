# DB Environment Setup

DocuFlow supporte deux modes de connexion à PostgreSQL. `DATABASE_URL` est toujours prioritaire.

---

## Mode 1 — DATABASE_URL (défaut Replit / Neon)

```env
DATABASE_URL=postgresql://user:password@host:5432/dbname
```

Ce mode est actif dès que `DATABASE_URL` est défini. C'est le mode actuel en production.

---

## Mode 2 — Variables PG* (fallback)

Si `DATABASE_URL` n'est **pas** défini, le backend reconstruit la connexion depuis :

| Variable | Obligatoire | Défaut | Description |
|---|---|---|---|
| `PGHOST` | ✅ | — | Hostname du serveur PostgreSQL |
| `PGPORT` | ❌ | `5432` | Port |
| `PGUSER` | ✅ | — | Utilisateur |
| `PGPASSWORD` | ✅ | — | Mot de passe |
| `PGDATABASE` | ✅ | — | Nom de la base |

Exemple `.env` local :

```env
PGHOST=localhost
PGPORT=5432
PGUSER=docuflow
PGPASSWORD=mysecret
PGDATABASE=docuflow_dev
```

---

## Où est définie la logique de fallback

| Fichier | Rôle |
|---|---|
| `shared/databaseUrl.ts` | **Source unique** — la règle elle-même : `DATABASE_URL`, sinon les `PG*` assemblés. Tout le reste l'importe |
| `server/config.ts` | Résout la connection string au démarrage avec le reste de la configuration, loggue la source (sans le mot de passe). Voir [CONFIGURATION.md](CONFIGURATION.md) |
| `server/db.ts` | Utilise `config.database` — plus de lecture directe de `DATABASE_URL` ni de `DB_DRIVER` |
| `server/auth.ts` | Session store (`connect-pg-simple`) — utilise `config.database.connectionString` |
| `drizzle.config.ts` | drizzle-kit CLI — importe `shared/databaseUrl.ts` |
| `scripts/lib/db.ts` | Connexion des scripts opérationnels (`db:migrate`, `db:seed`, `db:backfill:crm-links`, `db:verify`) — node-postgres, sans passer par `server/config.ts` |

---

## Scripts de diagnostic

```bash
# Vérifie la config DB sans se connecter
npm run db:env:check

# Affiche l'URL masquée (mot de passe caché)
npm run db:print:url:masked
```

Exemple de sortie `db:env:check` en mode DATABASE_URL :
```
=== DocuFlow — DB Environment Check ===

✅  Mode: DATABASE_URL (priority)
    Value: postgresql://user:<hidden>@host:5432/dbname
```

Exemple de sortie en mode PG* :
```
✅  Mode: PG* variables — all required vars present
    Effective URL: postgresql://user:<hidden>@localhost:5432/docuflow_dev
```

---

## Migrations

`npm run db:migrate` applique le journal de `migrations/` et embarque la même logique de résolution — aucune variable supplémentaire nécessaire. Le serveur ne crée plus rien au démarrage (#24) : une base à jour est une précondition du déploiement, pas un effet de bord du boot.

```bash
# Fonctionne avec DATABASE_URL défini
npm run db:migrate

# Fonctionne aussi avec PG* définis (sans DATABASE_URL)
PGHOST=localhost PGUSER=me PGPASSWORD=x PGDATABASE=mydb npm run db:migrate
```

`migrations/README.md` détaille l'ordre du journal, les scripts de seed et de backfill, et la procédure `--baseline` pour une base antérieure au journal.

---

## Tester localement

1. Copier `.env.example` → `.env`
2. Remplir soit `DATABASE_URL`, soit les variables `PG*`
3. Vérifier : `npm run db:env:check`
4. Démarrer : `npm run dev`
5. Vérifier dans les logs serveur : `[config] development — database DATABASE_URL over neon (...)` ou `... database PG_VARS ...`

---

## Checklist avant de retirer DATABASE_URL sur Replit

> ⛔ **Obsolète depuis le 2026-08-13 ([#53](https://github.com/Lamakira/docuflow/issues/53)).** Les variables `PG*` **ne sont pas fournies** sur l'infrastructure Replit actuelle : la documentation les réserve aux apps restées sur l'ancienne infrastructure Neon et renvoie à `DATABASE_URL`. Il n'existe donc pas d'état supporté où une app Replit tourne sur `PG*` sans `DATABASE_URL`, et ce checklist n'a plus de cible. Le mode 2 reste correct et utile ailleurs — conteneur local, CI, harnais de test — c'est uniquement le retrait de `DATABASE_URL` **sur Replit** qui n'a plus lieu d'être. Voir [`migration/phase-2-deployments-and-databases.md`](migration/phase-2-deployments-and-databases.md).

> ⚠️ **Ne pas retirer `DATABASE_URL` de prod tant que ce checklist n'est pas validé.**

- [ ] Les variables `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` sont définies sur Replit
- [ ] `npm run db:env:check` retourne ✅ en mode PG*
- [ ] Le serveur démarre et loggue `[config] ... database PG_VARS ...`
- [ ] La session utilisateur fonctionne (login / logout)
- [ ] `npm run db:migrate` fonctionne en mode PG* sur un environnement de staging
- [ ] Aucun log ne contient le mot de passe (`grep -i password` dans les logs)
- [ ] Le desktop agent n'est pas impacté (il parle HTTP à l'API — pas de DB directe)

---

## Note : Desktop Agent

Le desktop agent ne se connecte **jamais** directement à PostgreSQL. Il passe exclusivement par l'API HTTP du serveur. Ce changement est donc transparent pour lui.

---

## Avertissement

Le mot de passe n'est jamais loggué. La connection string dans les logs a toujours la forme :

```
postgresql://user:<hidden>@host:5432/dbname
```
