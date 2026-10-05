# Full-featured fork

`full-featured` is maintained from `a17f28e9ab44d34a24840cff70082470d775b9b1`, the last public commit before the Cal.diy conversion in `ab21c7f805`. It retains teams, organizations, workflows, routing forms, and the original license files. The original AGPL/commercial license split still applies.

Do not merge current Cal.diy `main` wholesale into this branch. Later cleanup commits remove features and drop their database tables. Review and backport individual fixes instead.

## Included backports

- Google Calendar PATCH retries from this fork's PR #1: three retries with exponential backoff and jitter; structured rate-limit 403s, 429, and server errors; no POST retries; abort and network-failure bounds preserved.
- Upstream #29708: cancellation ICS body and attachment use `METHOD:CANCEL`.
- Upstream #28897: booker-provided additional notes render as plain text in emails.
- Upstream #29857: normalize forwarded IP whitespace before banlist matching.
- Upstream #29703: omit null or undefined optional booking-field answers from calendar descriptions.

Security dependency updates were checked against maintainer advisories on 2026-10-02. Older versions suggested in the original upstream patches have additional disclosed issues:

| Dependency | Pinned version | Advisory |
| --- | --- | --- |
| protobufjs | 7.6.6 | [GHSA-j3f2-48v5-ccww](https://github.com/protobufjs/protobuf.js/security/advisories/GHSA-j3f2-48v5-ccww) |
| follow-redirects | 1.16.1 | [GHSA-q3jh-wrc6-jgq8](https://github.com/follow-redirects/follow-redirects/security/advisories/GHSA-q3jh-wrc6-jgq8) |
| shell-quote | 1.11.0 | [GHSA-pqg4-j6r4-53mv](https://github.com/ljharb/shell-quote/security/advisories/GHSA-pqg4-j6r4-53mv) |
| i18next-fs-backend | 2.6.8 | [GHSA-cchx-rhgv-92hj](https://github.com/i18next/i18next-fs-backend/security/advisories/GHSA-cchx-rhgv-92hj) |
| Vitest / @vitest/ui | 4.1.11 | [GHSA-82fw-gwwq-j7x9](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9) |

This is a targeted update, not a claim that every transitive dependency has been audited.

## Verification

Use Node 22 and the repository's Yarn 4.12.0. Node 26 is incompatible with the existing Prisma generator's directory-removal API.

```sh
yarn install --immutable
NODE_OPTIONS=--max-old-space-size=6144 yarn type-check:ci --force --concurrency=1
TZ=UTC yarn vitest run packages/app-store/googlecalendar/lib/__tests__ packages/emails/lib/generateIcsString.test.ts packages/lib/getIP.test.ts packages/lib/CalEventParser.test.ts
```

Generate Prisma artifacts for this branch before running tests. Generated artifacts from Cal.diy `main` omit workflow enums and cannot be reused.

Inspect typecheck output for compiler errors or heap exhaustion even if Turbo reports success: the existing `tsc-absolute` wrapper can conceal a crashed compiler's exit status.

## Upgrade from v6.2.0

The source image revision tested was `1c193cca8682b33b9866c792186033f7ef886682`. Relative to that release this branch has two pending migrations:

1. `20250413115818_add_azure`: adds the `AZUREAD` identity-provider enum value.
2. `20260226000000_seed_sink_shortener_feature`: inserts a disabled feature flag.

Neither migration drops data. The 2026-10-02 rehearsal restored a PostgreSQL 18.4 snapshot into a separate container and ran Prisma `migrate deploy` with this branch's schema and migrations. All existing tables and their contents were preserved, except the expected new feature and migration records. No application or reminder workers ran against the clone. This validates database migration only, not the upgraded application runtime.

Before production deployment:

1. Build an immutable application image from the tested branch revision on a separate builder or CI runner. Do not build on a memory-constrained production host.
2. Back up PostgreSQL using `pg_dump -Fc`, and securely preserve Compose configuration, environment variables, and the original application image digest. Keep backups outside the repository.
3. Retain `CALENDSO_ENCRYPTION_KEY`, `NEXTAUTH_SECRET`, database connection settings, Google credentials, SMTP settings, and the public application URL.
4. Smoke-test the built application against an isolated restored database. Disable outbound calendar writes, emails, webhooks, scheduled workers, and production callbacks until explicit integration tests are intended.
5. In the existing Compose project, replace only the application image. Preserve the PostgreSQL service, exact named volume, and PostgreSQL major version. Avoid pulling an unpinned `postgres` image during this change.
6. Verify the running image revision, completed migrations, login, booking/event-type visibility, integration connections, reminder settings, and application logs. An intentional end-to-end test booking requires calendar/email side effects.

Keep the old image available for rollback. Never use `docker compose down -v`, database reset commands, or the newer Cal.diy table-removal migrations. Existing bookings with missing external event references require separate reconciliation; these backports do not recreate them.

For upgrades of an existing installation, set the application Compose command to
`["/calcom/scripts/start-preserve-data.sh"]`. This runs migrations with fail-fast
behavior and skips the deprecated app-store seeder, which would otherwise
overwrite integration keys, enabled settings, and credential mappings.

The manual **Full-featured image** workflow publishes an AMD64 image to GHCR tagged
with the source commit. It uses a disposable build database and no production
credentials. Deploy the resulting immutable digest after the isolated runtime
checks; publication alone does not mean the image is production-verified.
