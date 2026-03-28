# Deployment Runbook (Vercel + Supabase)

This runbook is the source of truth for deploying the portal safely.

## 1) One-Time Setup

### GitHub and Branching

- [ ] Repository is connected to Vercel.
- [ ] `main` is protected (recommended).
- [ ] Team workflow uses feature branches + pull requests.

### Vercel Project

- [ ] Create project from GitHub repo.
- [ ] Framework detected as Next.js.
- [ ] Build command is `npm run build`.
- [ ] Production branch is `main`.

### Databases

- [ ] Production Supabase project/database exists.
- [ ] Preview/Staging Supabase project/database exists.
- [ ] Do not share the same DB between preview and production.

## 2) Environment Variables

Add all required keys in Vercel Project Settings -> Environment Variables.

### Targets

- Production: live values only.
- Preview: staging/sandbox values only.
- Development: optional, if needed for Vercel local development.

### Rules

- [ ] Same key names as local `.env`.
- [ ] Different sensitive values per environment.
- [ ] `DATABASE_URL` points to the correct DB by environment.
- [ ] Secrets are never committed to git.

## 3) Migration and Schema Steps

Prisma client generation happens during build. Database migrations still need to be applied to each target DB.

### Production DB

- [ ] Apply migrations:

```bash
npm run db:deploy
```

### Preview DB

- [ ] Apply migrations to preview DB as well:

```bash
npm run db:deploy
```

## 4) First Deploy Checklist

- [ ] Push code to `main` for production deployment.
- [ ] Confirm Vercel build succeeds.
- [ ] Check runtime logs for server/API errors.
- [ ] Run smoke tests:
  - [ ] `/`
  - [ ] `/members`
  - [ ] `/api/health/db`
  - [ ] `/api/election/config`
  - [ ] `/api/election/declare`
  - [ ] `/api/election/results`
  - [ ] `/api/votes`

## 5) Ongoing Release Process

Use this process for every change:

1. Create feature branch from `main`.
2. Push branch to GitHub.
3. Vercel creates a preview deployment automatically.
4. Validate preview deployment (UI + API flow).
5. Merge PR to `main`.
6. Vercel deploys production automatically.
7. Run post-deploy smoke test immediately.

## 6) Election Flow Verification

For each candidate release:

- [ ] Configure election.
- [ ] Declare election.
- [ ] Submit nominations.
- [ ] Cast test votes.
- [ ] Verify results endpoint output.
- [ ] Run invariants check:

```bash
npm run verify:invariants
```

## 7) Rollback Procedure

If production is broken:

1. Open Vercel project deployments.
2. Select last known-good deployment.
3. Redeploy that version.
4. Re-run smoke tests.
5. Create incident note with root cause and fix plan.

## 8) Common Failures and Fixes

### 500 responses in API routes

- Usually missing or wrong environment variables.
- Check Vercel runtime logs for exact failing route.

### Prisma runtime errors

- Migration not applied to target DB.
- Wrong `DATABASE_URL` for environment.

### Preview works, production fails

- Production env vars differ from preview.
- Confirm secrets and DB URL are correctly scoped.

## 9) Pre-Release Gate (Copy/Paste)

Use this checklist before every production merge:

- [ ] Preview deployment is green.
- [ ] Preview smoke tests passed.
- [ ] Prisma migrations applied to production DB.
- [ ] Production environment variables verified.
- [ ] Rollback target identified.
- [ ] Owner available for post-deploy verification.

## 10) Preview Schema Commands (Copy/Paste)

Set these once in your shell session:

```bash
export PREVIEW_DATABASE_URL='postgresql://<user>:<password>@<host>:6543/postgres?pgbouncer=true&schema=preview'
export PREVIEW_DIRECT_URL='postgresql://<user>:<password>@<host>:5432/postgres?sslmode=require&schema=preview'
```

Then run preview-safe setup:

```bash
npm run db:deploy:preview
npm run db:reset:preview
npm run db:seed:preview
npm run verify:invariants:preview
```

Expected signal on deploy: Prisma output should mention `schema "preview"` (not `public`).

## 11) Nominations management (production)

- **Who can use it:** Portal administrators (super user / admin grants) and **Election Committee** users see **Manage nominations** on the member dashboard after login.
- **What it does:** Create, edit, or delete nomination rows via `/api/admin/nominations` (requires member password). Use this to correct mistakes or add nominations on behalf of members.
- **Election freeze:** When the election status is **ended**, the API rejects create/update/delete until the cycle is reset in the database (same idea as frozen election configuration).
