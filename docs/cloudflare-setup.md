# Cloudflare deploy + progress sync — one-time setup

TLAD is served by a single Cloudflare Worker that hosts the static build (`dist/`) **and**
a tiny `/api/progress` sync endpoint backed by D1, gated by Cloudflare Access. The app
still works as a pure localStorage app anywhere else (e.g. plain static hosting): if
`/api/progress` returns 404 the client silently stays local, so none of this is required
to run — it's what turns on cross-device sync.

The repo ships with placeholders in `wrangler.toml`; these steps fill them in.

## 1. Create the D1 database

```sh
npx wrangler d1 create tlad-progress
```

Copy the printed `database_id` into `wrangler.toml` → `[[d1_databases]]` → `database_id`.

Apply the schema:

```sh
npx wrangler d1 migrations apply tlad-progress --remote   # production
npx wrangler d1 migrations apply tlad-progress --local    # local dev (npm run worker:dev)
```

## 2. Put the app behind Cloudflare Access

In the Cloudflare dashboard → **Zero Trust → Access → Applications**, add a
**self-hosted** application for the Worker's hostname (its `*.workers.dev` URL or your
custom domain). Add a policy that allows your email(s). This is what makes the app
genuinely private and gives the Worker a verified identity per user.

Then fill in `wrangler.toml` → `[vars]`:

- `ACCESS_TEAM_DOMAIN` — your team domain, e.g. `myteam.cloudflareaccess.com`
  (Zero Trust → Settings → Custom Pages / your team name).
- `ACCESS_AUD` — the Application Audience (AUD) tag from the Access application's overview.

The Worker verifies the `Cf-Access-Jwt-Assertion` JWT (signature + audience) against your
team's public keys and keys each user's progress row by their email — it does **not**
trust the plaintext email header alone.

## 3. Deploy

Locally:

```sh
npm run deploy        # = npm run build && wrangler deploy
```

Or via CI: the `.github/workflows/deploy.yml` workflow builds and deploys on push to
`main`. Add two GitHub repo secrets:

- `CLOUDFLARE_API_TOKEN` — a token with *Edit Workers* + *D1* permissions.
- `CLOUDFLARE_ACCOUNT_ID` — your account id.

## Local development

```sh
npm run worker:dev    # wrangler dev --local: serves dist/ + /api against a local D1
```

Access isn't in front of `wrangler dev`, so `/api/progress` returns **401** locally (no
`Cf-Access-Jwt-Assertion` header) — that's expected. Use it to smoke-test asset serving
and the auth gate; the merge/convergence logic is covered by `npm test`
(`shared/merge.test.ts`).

## How sync behaves

- **Merge, never clobber.** `shared/merge.ts` is a commutative, idempotent union: reads
  and exercises union (earliest timestamp wins), quiz keeps the best score + max attempts,
  checklist items OR to checked. Both the client and the Worker merge, so two devices
  holding different partial progress converge instead of overwriting each other.
- **Offline-first.** The client paints from localStorage immediately, pulls + merges the
  server copy on load, and debounces writes back. Failed writes retry on the next change
  or the browser `online` event.
- **First run migrates up.** On the first load against the Worker, existing localStorage
  progress is merged into D1, so nothing is lost switching from static hosting.
