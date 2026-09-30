# Flyway migrations are append-only — never edit or delete an existing one

This backend uses [Flyway](https://flywaydb.org/) for schema migrations,
configured in `apps/backend/src/main/resources/application.properties`:

```properties
spring.flyway.enabled=true
spring.flyway.schemas=foodme
spring.flyway.locations=classpath:db/migration
```

Current migration files, in `apps/backend/src/main/resources/db/migration/`:

```
V1__init.sql
V2__images_in_db.sql
V3__more_menu_items.sql
```

## How Flyway tracks state (why this rule exists)

On startup, Flyway compares the migration files on the classpath against a
table it maintains in the database itself, `flyway_schema_history`. For
every migration that has already run against a given database, that table
stores the version, the filename, and a **checksum of the file's content**.

If you edit an already-applied migration file (say, changing a column name
inside `V2__images_in_db.sql`) instead of adding a new one:

- **On any database where `V2` already ran** — your local dev DB, a
  teammate's, the ephemeral one spun up in CI
  (`infra/docker-compose.yml --profile core`), or the real Postgres
  instance on Render — Flyway recomputes the checksum of the file on disk,
  sees it no longer matches the stored checksum, and **refuses to start**
  with a validation error.
- Even in the hypothetical case where checksum validation were bypassed,
  the databases that already ran the old `V2` and the ones that will now
  run the edited `V2` for the first time end up with **divergent schemas**
  that Flyway has no record of reconciling — silent, hard-to-debug drift
  between environments.

Migrations are a **log of changes**, not a snapshot you edit in place —
the same reason you don't rewrite a git commit that other people have
already pulled.

## What to do instead

If a past migration had a mistake, or the schema needs to change further,
**add a new file with the next version number** rather than touching an
existing one:

```
V4__fix_menu_item_column.sql
```

Determine the next number by taking the highest existing `V<n>` and
incrementing it — don't reuse or renumber existing versions, and don't
skip numbers speculatively.

## Rule

- Never modify the SQL inside `V1__init.sql`, `V2__images_in_db.sql`, or
  `V3__more_menu_items.sql` (or any future migration once it has been
  committed).
- Never delete a migration file.
- To change the schema, always add a new, higher-numbered migration file.
