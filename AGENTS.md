# Project Guidelines

## Overview

TaxHacker is a Next.js 15 full-stack accounting app with Prisma/PostgreSQL, Better Auth, optional Stripe billing, and AI-powered document analysis. The app supports both self-hosted and cloud-style flows, but this repository is primarily structured around self-hosted operation.

Key folders:

- `app/`: Next.js app router pages, layouts, route handlers, and server actions.
- `components/`: UI grouped by feature area.
- `lib/`: shared infrastructure such as auth, config, DB, files, uploads, Stripe, email, and utilities.
- `models/`: Prisma-backed data access layer.
- `ai/`: LLM prompts, schemas, attachments, and provider orchestration.
- `forms/`: Zod form schemas.
- `prisma/`: schema, generated client, and migrations.
- `scripts/`: operational scripts, including the production deploy rollback script.

## Working Conventions

- Use `AGENTS.md` as the single repo-wide agent reference file. Do not add `copilot-instructions.md` unless the project intentionally moves away from `AGENTS.md`.
- Prefer server-side imports from `@/lib/config` only. That module is server-only and validates secrets at import time.
- Client components must use `@/lib/public-config` instead of `@/lib/config`.
- Static Stripe plan metadata lives in `@/lib/stripe-plans`. Do not import `@/lib/stripe` from client code because it initializes the server Stripe client.
- Amounts are stored as integer cents in the database. Keep that convention when editing forms, models, exports, or AI extraction.
- File operations should go through the existing file helpers in `lib/files.ts` and related modules instead of manual path construction.
- Prefer minimal changes that preserve the current app-router and Prisma patterns already used in the repo.

## Main Commands

- Install dependencies: `npm install`
- Dev server: `npm run dev`
- Production build check: `npm run build`
- Production start: `npm start`
- Lint: `npm run lint`

Local Docker paths:

- `docker-compose.yml`: run the published `latest` image from GHCR.
- `docker-compose.build.yml`: build locally from the checked-out source.
- `docker-compose.production.yml`: production stack used on the Raspberry Pi.

Useful local validation commands:

- `set -a && source .env && set +a && npm run build`
- `set -a && source .env && set +a && docker compose -f docker-compose.build.yml up -d --build`
- `docker compose -f docker-compose.build.yml ps`
- `curl -I --max-time 20 http://127.0.0.1:7331`

## Runtime Architecture

- Framework: Next.js app router with server components, route handlers, and server actions.
- Database: PostgreSQL 17 with Prisma.
- Auth: Better Auth with email OTP and self-hosted mode shortcuts in `lib/auth.ts`.
- Billing: Stripe checkout, webhook, and portal routes under `app/api/stripe/`.
- Email: Resend via `lib/email.ts`.
- AI: provider configuration in `lib/llm-providers.ts` and orchestration under `ai/`.
- Uploads and generated assets: persisted under `data/` in Docker-backed environments.

Important data/storage areas:

- User uploads live under `UPLOAD_PATH`, which is `/app/data/uploads` in containers.
- App data is persisted through `./data:/app/data` in Docker setups.
- Production and local Docker both use PostgreSQL 17.

## Config And Environment Notes

- `BETTER_AUTH_SECRET` is required and must be at least 32 characters.
- For Docker builds, `BETTER_AUTH_SECRET` is needed in two places:
  - build args, so `next build` succeeds during image creation
  - runtime environment, so auth config validates on startup
- `BASE_URL` must match the externally reachable app URL for auth and Stripe redirects.
- `SELF_HOSTED_MODE=true` changes auth flow and behavior across the app.
- Private env parsing belongs in `lib/config.ts`; public UI-safe values belong in `lib/public-config.ts`.

## Production Flow

Production deployment is based on a tagged release flowing through GitHub Actions, GHCR, Tailscale, and a Raspberry Pi host.

### Images

- `.github/workflows/docker-release.yml`: builds and pushes version-tagged images when a `v*` tag is pushed.
- `.github/workflows/docker-latest.yml`: builds and pushes `ghcr.io/<owner>/taxhacker:latest` on pushes to `main`.
- Both workflows build multi-arch images for `linux/amd64` and `linux/arm64`.
- Both workflows pass `BETTER_AUTH_SECRET` as a Docker build arg.

### Tagged Pi Deploy Flow

The Pi deploy path is implemented in `.github/workflows/deploy-pi.yml`.

Sequence:

1. Trigger on pushed tags matching `v*`, or manually through `workflow_dispatch`.
2. Resolve the deploy image:
   - tagged push defaults to `ghcr.io/<repo_owner>/taxhacker:<tag-without-v>`
   - manual runs can override the image explicitly
3. Log in to GHCR and wait until the image manifest is actually available.
4. Connect the GitHub Actions runner to the Tailnet using `tailscale/github-action@v4`.
5. Start SSH agent access with the Pi private key.
6. Verify Pi reachability over Tailscale and TCP port 22.
7. Copy `docker-compose.production.yml` and `scripts/deploy-with-rollback.sh` to the Pi deploy directory.
8. SSH into the Pi, optionally log in to GHCR, and run the deploy script.
9. Verify locally on the Pi that:
   - `docker compose ps` is healthy
   - `http://127.0.0.1:7331` responds
   - port `7331` is listening
10. Verify network reachability from the workflow runner with `curl http://<PI_HOST>:7331`.

### Pi Runtime Expectations

The deploy workflow uses these defaults:

- deploy dir: `/root/projects/taxhacker`
- compose file: `docker-compose.production.yml`
- env file: `.env`

The Pi compose file:

- runs the app from `TAXHACKER_IMAGE` or falls back to `ghcr.io/yagnil/taxhacker:latest`
- loads `.env` with `env_file`
- binds the app as `${APP_BIND_ADDRESS:-0.0.0.0}:7331:7331`
- mounts `./data:/app/data`
- uses PostgreSQL 17 with a local volume-backed data directory

### Rollback Behavior

Production deploy safety is implemented in `scripts/deploy-with-rollback.sh`.

- It validates that `BETTER_AUTH_SECRET` exists in the Pi `.env` and is at least 32 characters.
- It backs up the current `.env` before changing `TAXHACKER_IMAGE`.
- It pulls and starts the target stack.
- It waits for the app service to become healthy.
- If health fails, it restores the previous `.env`, re-pulls the old services, and brings the stack back up.

### Required Production Secrets

The GitHub Actions production path depends on repository secrets including:

- `BETTER_AUTH_SECRET`
- `TS_OAUTH_CLIENT_ID`
- `TS_AUDIENCE`
- `PI_HOST`
- `PI_USER`
- `PI_SSH_KEY`
- `GHCR_USERNAME`
- `GHCR_TOKEN`

When debugging deploy failures, check both the image publishing workflow and the Pi deploy workflow. A common failure mode is deploy starting before the tagged image becomes available in GHCR.

### Production Troubleshooting Checklist

Use this order when production deploys or the live Pi instance fail:

1. Confirm the release image exists in GHCR.
   - Check `.github/workflows/docker-release.yml` for the tag-triggered build.
   - Verify the deploy workflow is targeting `ghcr.io/<owner>/taxhacker:<tag-without-v>`.
   - If deploy started before the image was published, re-run the deploy after the image manifest is available.
2. Confirm the deploy workflow reached the Pi over Tailscale.
   - Check the `Connect to Tailscale`, `Verify Raspberry Pi network reachability`, and SSH-related steps in `.github/workflows/deploy-pi.yml`.
   - Validate that `PI_HOST` resolves on the tailnet and TCP port `22` is reachable.
3. Confirm the Pi received the latest deploy files.
   - Verify `docker-compose.production.yml` and `scripts/deploy-with-rollback.sh` were copied into `/root/projects/taxhacker`.
   - If workflow changes were recent, re-run deploy so the Pi gets the updated compose file and rollback script.
4. Confirm the Pi environment is valid.
   - Check `/root/projects/taxhacker/.env` exists.
   - Confirm `BETTER_AUTH_SECRET` is present and at least 32 characters.
   - Confirm `BASE_URL`, `DATABASE_URL`, and any Stripe or Resend settings match the intended environment.
5. Confirm the target container image is actually selected.
   - Inspect `TAXHACKER_IMAGE` in the Pi `.env`.
   - The rollback script updates this value before `docker compose pull` and `up -d`.
6. Confirm the stack is healthy on the Pi.
   - Run `docker compose --env-file .env -f docker-compose.production.yml ps` in `/root/projects/taxhacker`.
   - Check `docker compose ... logs --tail=200 app` if the app is restarting or unhealthy.
   - Inspect the container health state if `ps` is not enough.
7. Confirm the app is reachable locally on the Pi before debugging external networking.
   - `curl -I http://127.0.0.1:7331`
   - `ss -ltn | grep ':7331'`
   - If this fails, the problem is inside the app container, env, or compose stack rather than Tailscale.
8. Confirm the port binding is correct.
   - `docker-compose.production.yml` should publish `${APP_BIND_ADDRESS:-0.0.0.0}:7331:7331`.
   - If the service binds only to `127.0.0.1`, the Pi can look healthy locally while failing remotely.
9. Confirm the app built with the required auth secret.
   - `BETTER_AUTH_SECRET` must be available during Docker build and at runtime.
   - Missing build args can break `next build`; missing runtime env breaks startup validation.
10. Confirm the browser issue is not a client/server config leak.
   - Private env validation belongs only in `lib/config.ts`.
   - Client code must use `lib/public-config.ts`.
   - If the browser shows `BETTER_AUTH_SECRET` Zod errors, look for accidental client imports of server-only config.

## Common Operational Gotchas

- If the browser shows config-related Zod errors for private env vars, check for accidental client imports of `@/lib/config`.
- If Docker builds fail on `BETTER_AUTH_SECRET`, confirm the value is present both in build args and container environment.
- If the app is reachable only on localhost in production, check the published port binding in `docker-compose.production.yml`.
- If Pi deployment succeeds but the app is unavailable, verify Tailscale reachability, Pi SSH access, `docker compose ps`, and local `curl http://127.0.0.1:7331` on the Pi.
- If local `docker-compose.yml` fails to pull from GHCR, switch to `docker-compose.build.yml` and build locally.

## Where To Look First

- Auth or session bugs: `lib/auth.ts`, `middleware.ts`, `app/(auth)/`
- Config/env issues: `lib/config.ts`, `lib/public-config.ts`, compose files, workflow build args
- Billing issues: `lib/stripe.ts`, `lib/stripe-plans.ts`, `app/api/stripe/`
- File upload or storage issues: `lib/files.ts`, `lib/uploads.ts`, `components/files/`, `app/(app)/files/`
- AI parsing or provider issues: `ai/`, `lib/llm-providers.ts`, `app/(app)/settings/llm/`
- Production deploy issues: `.github/workflows/`, `docker-compose.production.yml`, `scripts/deploy-with-rollback.sh`