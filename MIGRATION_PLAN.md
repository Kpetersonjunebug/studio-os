# Studio OS online migration

## Source of truth

The preserved baseline is commit `7d91a57` on `experimental-pilot`. It captures the newest working August 28, 2026 web build, including the previously uncommitted follow-up, class-evaluation, backup, and restore work.

## Safety rules

- The interface and existing domain model stay in place.
- `localStorage` remains the first write and offline cache.
- Existing backup/restore remains independent of Supabase.
- Class identity/details and roster membership sync in Phase 1.
- Project details, current-project selection, and private Project Brief files sync in Phase 2.
- Phase 1 and 2 normalized tables cover Classes, Students, and Projects; Phase 3 snapshots add the remaining teaching data without changing the interface.
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

## Phase 2 Projects + Project Briefs

1. Project names, dates, milestones, notes, order, and current-project selection join the existing conflict-safe snapshot.
2. Automatic startup sync will not initialize Projects. The user must choose **Sync now** on the primary computer, preventing an older browser from becoming the accidental Project source.
3. Project initialization preserves the existing cloud Classes + Students and adds only matching local Project data.
4. Project Brief files upload to a private Supabase Storage bucket.
5. Each file path begins with the signed-in user's ID and Storage RLS limits select, insert, update, and delete to that user.
6. PDF, Word, RTF, text, and ODT files up to 15 MB are accepted.
7. Attachment metadata remains in local backups and syncs with its Project record.

## Phase 3 full-state migration

1. The complete local Studio OS state is stored as an owner-scoped JSON snapshot, including attendance, critiques/evaluations, follow-ups, class notes, dates, calendar settings, classes, rosters, projects, and current selections.
2. Snapshots are append-only. Every successful cloud write creates a new revision, so an older cloud version is never overwritten or deleted.
3. The first full-state upload must be started with **Sync now** on the primary computer after restoring its newest local backup. Automatic startup sync cannot initialize an empty full-state cloud.
4. A new device must explicitly choose **Use cloud copy** when it has unrelated browser-local data. The local state is automatically backed up before the cloud copy is loaded.
5. If two devices change after their last common revision, sync pauses and exposes explicit **Use cloud copy** and **Upload this device** choices.
6. The normalized Classes, Students, and Projects tables remain in place for compatibility, while the append-only full snapshot becomes the source for cross-device continuity.

## Verification gates

- Static JavaScript syntax and pure mapping tests pass.
- Existing UI opens with no Supabase configuration and remains fully local.
- Database tables have RLS, explicit grants, and owner-scoped policies.
- Append and select are tested as the signed-in user; snapshot update and delete remain unavailable by design.
- Attendance, notes, evaluations, follow-ups, classes, students, and projects changed on device A appear on device B after sync.
- Offline/local-only saves continue to work if Supabase is unavailable.
- GitHub Pages loads the same app and completes a magic-link redirect.

## Deferred work

- Realtime subscriptions.
- Student or TA accounts.
- OpenAI features.
