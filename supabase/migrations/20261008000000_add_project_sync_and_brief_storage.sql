alter table public.studio_classes
    add column if not exists current_project_local_id text,
    add column if not exists project_sync_version integer not null default 0;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'studio_classes_project_sync_version_check'
          and conrelid = 'public.studio_classes'::regclass
    ) then
        alter table public.studio_classes
            add constraint studio_classes_project_sync_version_check
            check (project_sync_version between 0 and 1);
    end if;
end $$;

create table if not exists public.studio_projects (
    user_id uuid not null references auth.users (id) on delete cascade,
    class_local_id text not null,
    local_id text not null,
    name text not null default '',
    start_date date,
    due_date date,
    next_milestone text not null default '',
    notes text not null default '',
    sort_order integer not null default 0,
    brief_storage_path text,
    brief_file_name text,
    brief_content_type text,
    brief_size bigint,
    brief_uploaded_at timestamptz,
    updated_at timestamptz not null default now(),
    primary key (user_id, class_local_id, local_id),
    foreign key (user_id, class_local_id)
        references public.studio_classes (user_id, local_id)
        on delete cascade,
    constraint studio_projects_brief_size_nonnegative
        check (brief_size is null or brief_size >= 0)
);

create index if not exists studio_projects_user_class_sort_idx
    on public.studio_projects (user_id, class_local_id, sort_order);

alter table public.studio_projects enable row level security;

revoke all on table public.studio_projects from anon, authenticated;
grant select, insert, update, delete on table public.studio_projects to authenticated;

drop policy if exists "studio_projects_select_own" on public.studio_projects;
create policy "studio_projects_select_own" on public.studio_projects for select
to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "studio_projects_insert_own" on public.studio_projects;
create policy "studio_projects_insert_own" on public.studio_projects for insert
to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "studio_projects_update_own" on public.studio_projects;
create policy "studio_projects_update_own" on public.studio_projects for update
to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "studio_projects_delete_own" on public.studio_projects;
create policy "studio_projects_delete_own" on public.studio_projects for delete
to authenticated using ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'studio-project-briefs',
    'studio-project-briefs',
    false,
    15728640,
    array[
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/rtf',
        'text/rtf',
        'text/plain',
        'application/vnd.oasis.opendocument.text',
        'application/octet-stream'
    ]::text[]
)
on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "studio_project_briefs_select_own" on storage.objects;
create policy "studio_project_briefs_select_own" on storage.objects for select
to authenticated using (
    bucket_id = 'studio-project-briefs'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "studio_project_briefs_insert_own" on storage.objects;
create policy "studio_project_briefs_insert_own" on storage.objects for insert
to authenticated with check (
    bucket_id = 'studio-project-briefs'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "studio_project_briefs_update_own" on storage.objects;
create policy "studio_project_briefs_update_own" on storage.objects for update
to authenticated using (
    bucket_id = 'studio-project-briefs'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
    bucket_id = 'studio-project-briefs'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "studio_project_briefs_delete_own" on storage.objects;
create policy "studio_project_briefs_delete_own" on storage.objects for delete
to authenticated using (
    bucket_id = 'studio-project-briefs'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
);
