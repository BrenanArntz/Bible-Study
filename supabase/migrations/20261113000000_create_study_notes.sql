create table if not exists public.study_notes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    path text not null,
    content text not null default '',
    title text not null,
    category text not null check (category in ('exegesis', 'topics', 'church-history', 'daily')),
    note_date date,
    identifier text,
    reference text,
    reading jsonb,
    completed boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, path),
    check (path ~ '^(exegesis|topics|church-history|daily)/.+[.]md$'),
    check (path !~ '(^|/)[.][.]?(/|$)' and path !~ E'\\\\'),
    check (split_part(path, '/', 1) = category)
);

create index if not exists study_notes_user_category_path_idx
    on public.study_notes (user_id, category, path);
create index if not exists study_notes_user_date_idx
    on public.study_notes (user_id, note_date);

grant select, insert, update, delete on public.study_notes to authenticated;

create or replace function public.set_study_note_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists study_notes_updated_at on public.study_notes;
create trigger study_notes_updated_at
    before update on public.study_notes
    for each row execute function public.set_study_note_updated_at();

alter table public.study_notes enable row level security;

drop policy if exists "Users can read their own study notes" on public.study_notes;
create policy "Users can read their own study notes"
    on public.study_notes for select to authenticated
    using ((select auth.uid()) = user_id);

drop policy if exists "Users can add their own study notes" on public.study_notes;
create policy "Users can add their own study notes"
    on public.study_notes for insert to authenticated
    with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own study notes" on public.study_notes;
create policy "Users can update their own study notes"
    on public.study_notes for update to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own study notes" on public.study_notes;
create policy "Users can delete their own study notes"
    on public.study_notes for delete to authenticated
    using ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit)
values ('study-images', 'study-images', false, 26214400)
on conflict (id) do update
set public = false, file_size_limit = 26214400;

drop policy if exists "scripture_study_read_own_images" on storage.objects;
create policy "scripture_study_read_own_images"
    on storage.objects for select to authenticated
    using (
        bucket_id = 'study-images'
        and (storage.foldername(name))[1] = (select auth.uid())::text
    );

drop policy if exists "scripture_study_upload_own_images" on storage.objects;
create policy "scripture_study_upload_own_images"
    on storage.objects for insert to authenticated
    with check (
        bucket_id = 'study-images'
        and (storage.foldername(name))[1] = (select auth.uid())::text
    );

drop policy if exists "scripture_study_update_own_images" on storage.objects;
create policy "scripture_study_update_own_images"
    on storage.objects for update to authenticated
    using (
        bucket_id = 'study-images'
        and (storage.foldername(name))[1] = (select auth.uid())::text
    )
    with check (
        bucket_id = 'study-images'
        and (storage.foldername(name))[1] = (select auth.uid())::text
    );

drop policy if exists "scripture_study_delete_own_images" on storage.objects;
create policy "scripture_study_delete_own_images"
    on storage.objects for delete to authenticated
    using (
        bucket_id = 'study-images'
        and (storage.foldername(name))[1] = (select auth.uid())::text
    );
