# Audit Explorer

Microsoft 365 unified audit & investigation explorer. Analysts upload the exports Microsoft gives them — the Purview unified audit log, Entra ID sign-in / audit / risk logs, Exchange message trace and Defender for Office 365 hunting tables — and get one searchable, chronological, interconnected record of activity per customer tenant.

The fundamental rule, from the product spec: **every audit record is ingested, preserved with its original fields, searchable, and connected to its user, resource, workload and source — even when the operation was introduced after this software was built.**

## What is in the foundation release

| Area | Status |
|---|---|
| Universal ingestion pipeline (CSV / JSON / JSONL, format auto-detection, streaming, checkpoints, dedup, progress) | Done |
| Raw immutable evidence store (original record JSON + export envelope + the uploaded file on disk) | Done |
| Normalised event index with full-text search, raw-property search and a query language | Done |
| Workspaces (one per customer tenant), analyst accounts (admin / analyst), IP exclusions, expected countries | Done |
| Global Activity, People, Emails, SharePoint & OneDrive, Teams, Identity & Access, Administration, Security & Compliance, Applications & Automation | Done (the seven area pages are curated views over the same index) |
| Data Coverage & Health: source inventory, record types vs catalog, gaps, retention horizons, uncatalogued operations | Done |
| Offline IP enrichment: country (CC0 geo DB) and owner classification (Microsoft 365 / Microsoft services / Azure / Microsoft network / Keepit / private) | Done |
| Cases & Investigations (linked evidence, notes, saved searches, reports) | Next |
| Detections ("signals": inbox rules, forwarding, spray, impossible travel, mass download, consent risk…) | Next — the sensitive-operation families and all the normalised fields they need are already indexed |
| Excel investigation report | Next |

Sources and their layer:

* **Layer A — Purview unified audit log.** New Purview portal export, classic compliance-center export, `Search-UnifiedAuditLog | Export-Csv`, and JSON dumps of AuditData records. All 262 record types from Microsoft's schema are known; unknown ones are kept as `RecordType n`.
* **Layer B — cross-product telemetry.** Entra sign-in logs (CSV and Graph JSON; interactive, non-interactive, service principal), Entra audit logs (CSV and JSON), Entra ID Protection risk detections, Exchange message trace (enhanced summary, extended report, `Get-MessageTrace(V2)`), Defender `EmailEvents`, `UrlClickEvents`, `EmailUrlInfo`, `EmailPostDeliveryEvents`, `EmailAttachmentInfo` and the union-of-tables export.

## Architecture

```
apps/web        React 18 + Vite + TypeScript SPA (TanStack Query, react-router, virtualised tables)
apps/api        Fastify 5 + TypeScript. Auth, workspaces, imports, search, people, coverage. Serves the SPA in production.
packages/core   Shared: catalog (record types, sources, workload groups, activities), ingestion (detect + normalise), query parser, API types.
packages/ipdata Offline IP → country and IP → owner lookups (data/geo.json, data/msip.json).
PostgreSQL 16   events (normalised columns + raw jsonb + tsvector), imports, identities, discovered_operations, users, sessions.
```

Ingestion: `file → row stream → detect format from the first 50 rows → normalise (0..n events per row) → enrich IPs → batch upsert ON CONFLICT (workspace, source record id) DO NOTHING → checkpoint → refresh people & operation inventories`. Interrupted imports resume from their checkpoint on restart; re-importing overlapping exports never duplicates activity.

Search: `GET /api/workspaces/:id/events` compiles filters and the query language to SQL. Known fields hit indexed columns; unknown `field:value` terms are resolved inside the raw record by `ae_prop(raw, path)`, a PL/pgSQL function that walks objects case-insensitively and Name/Value arrays by name — so `Parameters.ForwardTo:*` or `LogonError:Invalid*` work for any workload.

## Run it locally

Prerequisites: Node 22, pnpm 10, PostgreSQL 16 (or Docker for the database only).

```bash
pnpm install
pnpm -r build                                  # builds packages/* (the API imports them from dist)
createdb audit_explorer                        # or: docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=pg postgres:16-alpine
export DATABASE_URL=postgres://postgres@127.0.0.1:5432/audit_explorer
export ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=devpassword123 SESSION_SECRET=$(openssl rand -hex 32)
pnpm --filter @audit/api dev                   # http://localhost:8080  (migrations run on start)
pnpm --filter @audit/web dev                   # http://localhost:5173  (proxies /api)
pnpm --filter @audit/api sample:generate ./sample-data   # fictional tenant with an attack chain, five export files
```

Tests: `pnpm --filter @audit/core test`.

## Deploy on Coolify (docker compose)

1. Push this repository (private) to GitHub and create a **Docker Compose** resource in Coolify pointing at it.
2. Set the environment variables from `.env.example`: `POSTGRES_PASSWORD`, `SESSION_SECRET` (`openssl rand -hex 32`), `ADMIN_EMAIL`, `ADMIN_PASSWORD`.
3. Give the `app` service a domain with HTTPS (the session cookie is `Secure` in production) and expose port 8080.
4. Deploy. The first start creates the schema and the admin account; sign in and add analysts under *Users*.

Volumes: `evidence` (`/data`, the uploaded original files) and `pgdata`. Back both up. Size the host for the tenants you investigate: ~1 KB of raw JSON per audit record plus indexes — a 1,000,000-row Purview export is roughly 2 GB in PostgreSQL.

Upgrading: redeploy; migrations in `apps/api/migrations` apply automatically and imports that were running resume.

## Keeping the catalog current

`pnpm --filter @audit/api catalog:refresh` scrapes Microsoft's activity tables from learn.microsoft.com into `packages/core/data/activities.learn.json` and diffs the `AuditLogRecordType` enum against the public schema markdown, printing any record types to add. Commit the result. The catalog only improves labels and descriptions; ingestion never depends on it.

IP data: `packages/ipdata/data/geo.json` is generated at build time from the CC0 npm package `@ip-location-db/geo-whois-asn-country` (`pnpm --filter @audit/ipdata geo:rebuild` after bumping that dependency). `msip.json` (Microsoft 365 endpoints, Azure service tags, Microsoft ASNs, Keepit ranges) is committed; regenerate it periodically. The Coverage page shows both data dates.

## Query language

```
anna@contoso.com                 free text, any field including the raw record
user:anna* op:new-inboxrule      field filters, globs, implicit AND
result:failed OR op:userloginfailed
-owner:m365 country:RU           negate
ip:185.220.0.0/16                CIDR
Parameters.ForwardTo:*           any raw property (Name/Value lists included)
sensitive:"inbox rules"          sensitive operation families
session:<id>  mid:<message id>   pivots
ts:>2026-01-01
```

Fields: user, op, ip, wl (workload), group, result, obj, ua, type (record type), id, owner, item, detail, kind, country, session, source (purview, entra_signin, … or A/B), mid, nmid, counterpart (to/from/target/mailbox), import, failed, ts, usertype, correlation, sensitive.

## Security notes

* Everything stays on your server: no external calls from the browser (CSP `default-src 'self'`), fonts bundled from `@fontsource` packages, IP enrichment offline.
* Passwords are argon2id; sessions are signed, `HttpOnly`, `SameSite=Lax` cookies; login is rate-limited.
* Uploaded files are stored verbatim as evidence and hashed (SHA-256); identical files are not imported twice unless forced.
* CSV exports neutralise formula injection.
