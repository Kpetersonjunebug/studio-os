create table if not exists public.studio_classes (
    user_id uuid not null references auth.users (id) on delete cascade,
    local_id text not null,
    code text not null default '',
    name text not null default '',
    meeting_days jsonb not null default '[]'::jsonb,
    sort_order integer not null default 0,
    updated_at timestamptz not null default now(),
    primary key (user_id, local_id),
    constraint studio_classes_meeting_days_array check (jsonb_typeof(meeting_days) = 'array')
);

create table if not exists public.studio_students (
    user_id uuid not null references auth.users (id) on delete cascade,
    class_local_id text not null,
    local_id bigint not null,
    name text not null default '',
    sort_order integer not null default 0,
    updated_at timestamptz not null default now(),
    primary key (user_id, class_local_id, local_id),
    foreign key (user_id, class_local_id)
        references public.studio_classes (user_id, local_id)
        on delete cascade
);

create index if not exists studio_classes_user_id_idx on public.studio_classes (user_id);
create index if not exists studio_students_user_id_idx on public.studio_students (user_id);
create index if not exists studio_students_class_idx on public.studio_students (user_id, class_local_id);

alter table public.studio_classes enable row level security;
alter table public.studio_students enable row level security;

revoke all on table public.studio_classes from anon, authenticated;
revoke all on table public.studio_students from anon, authenticated;
grant select, insert, update, delete on table public.studio_classes to authenticated;
grant select, insert, update, delete on table public.studio_students to authenticated;

drop policy if exists "studio_classes_select_own" on public.studio_classes;
create policy "studio_classes_select_own" on public.studio_classes for select
to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "studio_classes_insert_own" on public.studio_classes;
create policy "studio_classes_insert_own" on public.studio_classes for insert
to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "studio_classes_update_own" on public.studio_classes;
create policy "studio_classes_update_own" on public.studio_classes for update
to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "studio_classes_delete_own" on public.studio_classes;
create policy "studio_classes_delete_own" on public.studio_classes for delete
to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "studio_students_select_own" on public.studio_students;
create policy "studio_students_select_own" on public.studio_students for select
to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "studio_students_insert_own" on public.studio_students;
create policy "studio_students_insert_own" on public.studio_students for insert
to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "studio_students_update_own" on public.studio_students;
create policy "studio_students_update_own" on public.studio_students for update
to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "studio_students_delete_own" on public.studio_students;
create policy "studio_students_delete_own" on public.studio_students for delete
to authenticated using ((select auth.uid()) = user_id);
