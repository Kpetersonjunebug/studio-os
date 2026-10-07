# Studio OS online migration

## Source of truth

The preserved baseline is commit `7d91a57` on `experimental-pilot`. It captures the newest working August 28, 2026 web build, including the previously uncommitted follow-up, class-evaluation, backup, and restore work.

## Safety rules

- The interface and existing domain model stay in place.
- `localStorage` remains the first write and offline cache.
- Existing backup/restore remains independent of Supabase.
- Only class identity/details and roster membership sync in Phase 1.
- Projects, critiques/evaluations, follow-ups, attendance, notes, dates, CSV import logic, and backup envelopes remain local.
- Cloud access requires Supabase Auth and per-user Row Level Security.
- The browser receives only a publishable key, never a secret or service-role key.
- Class deletion is not propagated during Phase 1 because unmigrated class records could otherwise be lost on another device.

## Phase 1 proof-of-concept

1. Sign in by email magic link.
2. On the first device, an empty cloud is initialized from its local Classes + Students.
3. On another device, an existing cloud snapshot is merged into its local state.
4. Later edits sync automatically after the local save succeeds.
5. A three-way fingerprint comparison prevents silent overwrites when local and cloud both changed since the last successful sync.
6. A visible Sync Now control allows recovery after going offline.

## Verification gates

- Static JavaScript syntax and pure mapping tests pass.
- Existing UI opens with no Supabase configuration and remains fully local.
- Database tables have RLS, explicit grants, and owner-scoped policies.
- Insert, select, update, and delete are tested as the signed-in user.
- A class and student added on device A appear on device B after Sync Now.
- Offline/local-only saves continue to work if Supabase is unavailable.
- GitHub Pages loads the same app and completes a magic-link redirect.

## Deferred work

- Projects, critiques/evaluations, follow-ups, attendance, notes, and class dates.
- Realtime subscriptions.
- Student or TA accounts.
- OpenAI features.
