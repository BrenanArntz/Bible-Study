-- Run this script in the Supabase SQL Editor to create or update the app schema.
begin;

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

create table if not exists public.study_tasks (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    task_type text not null check (task_type in ('personal-reading','reading-with-haley','verse-quiz','greek','church-history','other')),
    title text not null check (length(title) between 1 and 120),
    details text not null default '',
    weekdays integer[] not null check (cardinality(weekdays) between 1 and 7),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.study_task_completions (
    task_id uuid not null references public.study_tasks(id) on delete cascade,
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    completion_date date not null,
    completed_at timestamptz not null default now(),
    primary key (task_id, completion_date)
);

alter table public.study_tasks enable row level security;
alter table public.study_task_completions enable row level security;

drop policy if exists "Users manage their own recurring tasks" on public.study_tasks;
create policy "Users manage their own recurring tasks" on public.study_tasks
    for all to authenticated using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their own task completions" on public.study_task_completions;
create policy "Users manage their own task completions" on public.study_task_completions
    for all to authenticated using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.study_tasks to authenticated;
grant select, insert, update, delete on public.study_task_completions to authenticated;

create table if not exists public.study_reading_plans (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    title text not null check (length(title) between 1 and 120),
    books text[] not null check (cardinality(books) between 1 and 66),
    chapter_selections jsonb,
    chapters_per_reading integer not null check (chapters_per_reading between 1 and 50),
    interval_days integer not null check (interval_days between 1 and 365),
    start_date date not null,
    created_at timestamptz not null default now()
);

alter table public.study_reading_plans
    add column if not exists chapter_selections jsonb;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'study_reading_plans_chapter_selections_array'
          and conrelid = 'public.study_reading_plans'::regclass
    ) then
        alter table public.study_reading_plans
            add constraint study_reading_plans_chapter_selections_array
            check (chapter_selections is null or jsonb_typeof(chapter_selections) = 'array');
    end if;
end;
$$;

create index if not exists study_reading_plans_user_created_idx
    on public.study_reading_plans (user_id, created_at);

create table if not exists public.study_reading_plan_completions (
    plan_id uuid not null references public.study_reading_plans(id) on delete cascade,
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    scheduled_date date not null,
    completed_at timestamptz not null default now(),
    primary key (plan_id, scheduled_date)
);

create index if not exists study_reading_plan_completions_date_idx
    on public.study_reading_plan_completions (scheduled_date, plan_id);

create table if not exists public.study_chapter_readings (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    read_date date not null default current_date,
    chapter_selections jsonb not null check (jsonb_typeof(chapter_selections) = 'array'),
    created_at timestamptz not null default now()
);

create index if not exists study_chapter_readings_user_date_idx
    on public.study_chapter_readings (user_id, read_date);

alter table public.study_reading_plans enable row level security;
alter table public.study_reading_plan_completions enable row level security;
alter table public.study_chapter_readings enable row level security;

drop policy if exists "Users manage their own book reading plans" on public.study_reading_plans;
create policy "Users manage their own book reading plans" on public.study_reading_plans
    for all to authenticated using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their own book reading completions" on public.study_reading_plan_completions;
create policy "Users manage their own book reading completions" on public.study_reading_plan_completions
    for all to authenticated
    using (
        (select auth.uid()) = user_id
        and exists (
            select 1 from public.study_reading_plans plan
            where plan.id = plan_id and plan.user_id = (select auth.uid())
        )
    )
    with check (
        (select auth.uid()) = user_id
        and exists (
            select 1 from public.study_reading_plans plan
            where plan.id = plan_id and plan.user_id = (select auth.uid())
        )
    );

drop policy if exists "Users manage their own chapter readings" on public.study_chapter_readings;
create policy "Users manage their own chapter readings" on public.study_chapter_readings
    for all to authenticated using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.study_reading_plans to authenticated;
grant select, insert, update, delete on public.study_reading_plan_completions to authenticated;
grant select, insert, update, delete on public.study_chapter_readings to authenticated;

create or replace function public.clear_book_reading_plan_completions_on_schedule_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
    if new.books is distinct from old.books
        or new.chapter_selections is distinct from old.chapter_selections
        or new.chapters_per_reading is distinct from old.chapters_per_reading
        or new.interval_days is distinct from old.interval_days
        or new.start_date is distinct from old.start_date then
        delete from public.study_reading_plan_completions
        where plan_id = old.id;
    end if;
    return new;
end;
$$;

drop trigger if exists study_reading_plan_schedule_changed on public.study_reading_plans;
create trigger study_reading_plan_schedule_changed
    before update of books, chapter_selections, chapters_per_reading, interval_days, start_date
    on public.study_reading_plans
    for each row execute function public.clear_book_reading_plan_completions_on_schedule_change();

commit;
