create table if not exists public.studio_state_snapshots (
    user_id uuid not null references auth.users (id) on delete cascade,
    revision bigint not null check (revision > 0),
    schema_version integer not null default 1 check (schema_version > 0),
    state jsonb not null check (jsonb_typeof(state) = 'object'),
    content_hash text not null check (length(content_hash) = 64),
    created_at timestamptz not null default now(),
    primary key (user_id, revision)
);

create index if not exists studio_state_snapshots_latest_idx
on public.studio_state_snapshots (user_id, revision desc);

alter table public.studio_state_snapshots enable row level security;

revoke all on table public.studio_state_snapshots from anon, authenticated;
grant select, insert on table public.studio_state_snapshots to authenticated;

drop policy if exists "studio_state_snapshots_select_own" on public.studio_state_snapshots;
create policy "studio_state_snapshots_select_own"
on public.studio_state_snapshots for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "studio_state_snapshots_insert_own" on public.studio_state_snapshots;
create policy "studio_state_snapshots_insert_own"
on public.studio_state_snapshots for insert
to authenticated
with check ((select auth.uid()) = user_id);

comment on table public.studio_state_snapshots is
'Append-only, per-user Studio OS state history. The highest revision is the current cloud state.';
