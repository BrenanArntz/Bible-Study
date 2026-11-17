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

create table if not exists public.study_user_profiles (
    user_id uuid primary key references auth.users (id) on delete cascade,
    display_name text not null check (length(btrim(display_name)) between 1 and 80),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

grant select, insert, update on public.study_user_profiles to authenticated;

drop trigger if exists study_user_profiles_updated_at on public.study_user_profiles;
create trigger study_user_profiles_updated_at
    before update on public.study_user_profiles
    for each row execute function public.set_study_note_updated_at();

alter table public.study_user_profiles enable row level security;

drop policy if exists "Users manage their own profile" on public.study_user_profiles;
create policy "Users manage their own profile" on public.study_user_profiles
    for all to authenticated using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

insert into public.study_user_profiles (user_id, display_name)
select
    id,
    btrim(raw_user_meta_data ->> 'display_name')
from auth.users
where nullif(btrim(raw_user_meta_data ->> 'display_name'), '') is not null
  and length(btrim(raw_user_meta_data ->> 'display_name')) <= 80
on conflict (user_id) do nothing;

create or replace function public.set_study_performed_by_name()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
    resolved_name text;
begin
    select coalesce(
        nullif(btrim(profile.display_name), ''),
        nullif(btrim(account.email), ''),
        new.user_id::text
    )
    into resolved_name
    from auth.users account
    left join public.study_user_profiles profile on profile.user_id = account.id
    where account.id = new.user_id;

    new.performed_by_name := coalesce(resolved_name, new.user_id::text);
    return new;
end;
$$;

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
    weekdays integer[],
    cadence_type text not null default 'weekdays',
    interval_days integer not null default 1,
    start_date date not null default current_date,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.study_tasks
    add column if not exists cadence_type text not null default 'weekdays';
alter table public.study_tasks
    add column if not exists interval_days integer not null default 1;
alter table public.study_tasks
    add column if not exists start_date date;
update public.study_tasks
    set start_date = created_at::date
    where start_date is null;
alter table public.study_tasks
    alter column start_date set default current_date;
alter table public.study_tasks
    alter column start_date set not null;
alter table public.study_tasks
    alter column weekdays drop not null;
alter table public.study_tasks
    drop constraint if exists study_tasks_weekdays_check;

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'study_tasks_cadence_type_check'
          and conrelid = 'public.study_tasks'::regclass
    ) then
        alter table public.study_tasks
            add constraint study_tasks_cadence_type_check
            check (cadence_type in ('interval', 'weekdays'));
    end if;

    if not exists (
        select 1 from pg_constraint
        where conname = 'study_tasks_interval_days_check'
          and conrelid = 'public.study_tasks'::regclass
    ) then
        alter table public.study_tasks
            add constraint study_tasks_interval_days_check
            check (interval_days between 1 and 365);
    end if;
end;
$$;

alter table public.study_tasks
    add constraint study_tasks_weekdays_check
    check (
        (cadence_type = 'weekdays' and weekdays is not null
            and cardinality(weekdays) between 1 and 7
            and weekdays <@ array[0, 1, 2, 3, 4, 5, 6])
        or (cadence_type = 'interval' and weekdays is null)
    );

create table if not exists public.study_task_completions (
    task_id uuid not null references public.study_tasks(id) on delete cascade,
    task_title text not null,
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    performed_by_name text not null,
    completion_date date not null,
    completed_at timestamptz not null default now(),
    primary key (task_id, completion_date)
);

drop index if exists public.study_task_completions_id_idx;
alter table public.study_task_completions
    drop column if exists id;
alter table public.study_task_completions
    add column if not exists task_title text;
update public.study_task_completions completion
    set task_title = task_row.title
    from public.study_tasks task_row
    where completion.task_id = task_row.id
      and completion.task_title is null;
alter table public.study_task_completions
    alter column task_title set not null;
alter table public.study_task_completions
    add column if not exists performed_by_name text;
update public.study_task_completions completion
    set performed_by_name = coalesce(
        nullif(btrim(profile.display_name), ''),
        nullif(btrim(account.email), ''),
        completion.user_id::text
    )
    from auth.users account
    left join public.study_user_profiles profile on profile.user_id = account.id
    where completion.user_id = account.id
      and completion.performed_by_name is null;
alter table public.study_task_completions
    alter column performed_by_name set not null;
drop trigger if exists study_task_completions_performed_by_name on public.study_task_completions;
create trigger study_task_completions_performed_by_name
    before insert or update of user_id on public.study_task_completions
    for each row execute function public.set_study_performed_by_name();
comment on column public.study_task_completions.performed_by_name
    is 'Display name of the account that completed this task.';

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

alter table public.study_reading_plans
    add column if not exists cadence_type text not null default 'interval';

alter table public.study_reading_plans
    add column if not exists weekdays integer[];

alter table public.study_reading_plans
    add column if not exists status text not null default 'active';

alter table public.study_reading_plans
    add column if not exists collaborator_email text;

alter table public.study_reading_plans
    add column if not exists owner_email text;

alter table public.study_reading_plans
    alter column interval_days drop not null;

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

    if not exists (
        select 1
        from pg_constraint
        where conname = 'study_reading_plans_cadence_type_check'
          and conrelid = 'public.study_reading_plans'::regclass
    ) then
        alter table public.study_reading_plans
            add constraint study_reading_plans_cadence_type_check
            check (cadence_type in ('interval', 'weekdays'));
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'study_reading_plans_status_check'
          and conrelid = 'public.study_reading_plans'::regclass
    ) then
        alter table public.study_reading_plans
            add constraint study_reading_plans_status_check
            check (status in ('active', 'completed', 'cancelled'));
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'study_reading_plans_weekdays_check'
          and conrelid = 'public.study_reading_plans'::regclass
    ) then
        alter table public.study_reading_plans
            add constraint study_reading_plans_weekdays_check
            check (weekdays is null or (cardinality(weekdays) between 1 and 7));
    end if;
end;
$$;

create index if not exists study_reading_plans_user_created_idx
    on public.study_reading_plans (user_id, created_at);
create index if not exists study_reading_plans_collaborator_idx
    on public.study_reading_plans (lower(collaborator_email));
create index if not exists study_reading_plans_owner_email_idx
    on public.study_reading_plans (lower(owner_email));
create index if not exists study_reading_plans_status_idx
    on public.study_reading_plans (status);

create table if not exists public.study_reading_plan_completions (
    plan_id uuid not null references public.study_reading_plans(id) on delete cascade,
    plan_title text not null,
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    performed_by_name text not null,
    scheduled_date date not null,
    completed_at timestamptz not null default now(),
    primary key (plan_id, scheduled_date)
);

drop index if exists public.study_reading_plan_completions_id_idx;
alter table public.study_reading_plan_completions
    drop column if exists id;
alter table public.study_reading_plan_completions
    add column if not exists plan_title text;
update public.study_reading_plan_completions completion
    set plan_title = plan_row.title
    from public.study_reading_plans plan_row
    where completion.plan_id = plan_row.id
      and completion.plan_title is null;
alter table public.study_reading_plan_completions
    alter column plan_title set not null;
alter table public.study_reading_plan_completions
    add column if not exists performed_by_name text;
update public.study_reading_plan_completions completion
    set performed_by_name = coalesce(
        nullif(btrim(profile.display_name), ''),
        nullif(btrim(account.email), ''),
        completion.user_id::text
    )
    from auth.users account
    left join public.study_user_profiles profile on profile.user_id = account.id
    where completion.user_id = account.id
      and completion.performed_by_name is null;
alter table public.study_reading_plan_completions
    alter column performed_by_name set not null;
drop trigger if exists study_reading_plan_completions_performed_by_name on public.study_reading_plan_completions;
create trigger study_reading_plan_completions_performed_by_name
    before insert or update of user_id on public.study_reading_plan_completions
    for each row execute function public.set_study_performed_by_name();
comment on column public.study_reading_plan_completions.performed_by_name
    is 'Display name of the account that completed this reading.';

create index if not exists study_reading_plan_completions_date_idx
    on public.study_reading_plan_completions (scheduled_date, plan_id);

create table if not exists public.study_chapter_readings (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    performed_by_name text not null,
    read_date date not null default current_date,
    chapter_selections jsonb not null check (jsonb_typeof(chapter_selections) = 'array'),
    created_at timestamptz not null default now()
);

alter table public.study_chapter_readings
    add column if not exists performed_by_name text;
update public.study_chapter_readings reading
    set performed_by_name = coalesce(
        nullif(btrim(profile.display_name), ''),
        nullif(btrim(account.email), ''),
        reading.user_id::text
    )
    from auth.users account
    left join public.study_user_profiles profile on profile.user_id = account.id
    where reading.user_id = account.id
      and reading.performed_by_name is null;
alter table public.study_chapter_readings
    alter column performed_by_name set not null;
drop trigger if exists study_chapter_readings_performed_by_name on public.study_chapter_readings;
create trigger study_chapter_readings_performed_by_name
    before insert or update of user_id on public.study_chapter_readings
    for each row execute function public.set_study_performed_by_name();
comment on column public.study_chapter_readings.performed_by_name
    is 'Display name of the account that logged these chapters.';

create index if not exists study_chapter_readings_user_date_idx
    on public.study_chapter_readings (user_id, read_date);

alter table public.study_reading_plans enable row level security;
alter table public.study_reading_plan_completions enable row level security;
alter table public.study_chapter_readings enable row level security;

drop policy if exists "Users manage their own book reading plans" on public.study_reading_plans;
drop policy if exists "Users read accessible reading plans" on public.study_reading_plans;
drop policy if exists "Users insert own reading plans" on public.study_reading_plans;
drop policy if exists "Users update accessible reading plans" on public.study_reading_plans;
drop policy if exists "Users delete accessible reading plans" on public.study_reading_plans;

create policy "Users read accessible reading plans"
    on public.study_reading_plans for select to authenticated
    using (
        (select auth.uid()) = user_id
        or (collaborator_email is not null and lower(collaborator_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
        or (owner_email is not null and lower(owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
    );

create policy "Users insert own reading plans"
    on public.study_reading_plans for insert to authenticated
    with check ((select auth.uid()) = user_id);

create policy "Users update accessible reading plans"
    on public.study_reading_plans for update to authenticated
    using (
        (select auth.uid()) = user_id
        or (collaborator_email is not null and lower(collaborator_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
        or (owner_email is not null and lower(owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
    )
    with check (
        (select auth.uid()) = user_id
        or (collaborator_email is not null and lower(collaborator_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
        or (owner_email is not null and lower(owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
    );

create policy "Users delete accessible reading plans"
    on public.study_reading_plans for delete to authenticated
    using (
        (select auth.uid()) = user_id
        or (collaborator_email is not null and lower(collaborator_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
    );

drop policy if exists "Users manage their own book reading completions" on public.study_reading_plan_completions;
drop policy if exists "Users read accessible reading completions" on public.study_reading_plan_completions;
drop policy if exists "Users insert accessible reading completions" on public.study_reading_plan_completions;
drop policy if exists "Users update accessible reading completions" on public.study_reading_plan_completions;
drop policy if exists "Users delete accessible reading completions" on public.study_reading_plan_completions;

create policy "Users read accessible reading completions"
    on public.study_reading_plan_completions for select to authenticated
    using (
        exists (
            select 1 from public.study_reading_plans plan
            where plan.id = plan_id
              and (
                  plan.user_id = (select auth.uid())
                  or (plan.collaborator_email is not null and lower(plan.collaborator_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
                  or (plan.owner_email is not null and lower(plan.owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
              )
        )
    );

create policy "Users insert accessible reading completions"
    on public.study_reading_plan_completions for insert to authenticated
    with check (
        (select auth.uid()) = user_id
        and exists (
            select 1 from public.study_reading_plans plan
            where plan.id = plan_id
              and (
                  plan.user_id = (select auth.uid())
                  or (plan.collaborator_email is not null and lower(plan.collaborator_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
                  or (plan.owner_email is not null and lower(plan.owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
              )
        )
    );

create policy "Users update accessible reading completions"
    on public.study_reading_plan_completions for update to authenticated
    using (
        exists (
            select 1 from public.study_reading_plans plan
            where plan.id = plan_id
              and (
                  plan.user_id = (select auth.uid())
                  or (plan.collaborator_email is not null and lower(plan.collaborator_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
                  or (plan.owner_email is not null and lower(plan.owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
              )
        )
    );

create policy "Users delete accessible reading completions"
    on public.study_reading_plan_completions for delete to authenticated
    using (
        exists (
            select 1 from public.study_reading_plans plan
            where plan.id = plan_id
              and (
                  plan.user_id = (select auth.uid())
                  or (plan.collaborator_email is not null and lower(plan.collaborator_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
                  or (plan.owner_email is not null and lower(plan.owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
              )
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
        or new.start_date is distinct from old.start_date
        or new.cadence_type is distinct from old.cadence_type
        or new.weekdays is distinct from old.weekdays then
        delete from public.study_reading_plan_completions
        where plan_id = old.id;
    end if;
    return new;
end;
$$;

drop trigger if exists study_reading_plan_schedule_changed on public.study_reading_plans;
create trigger study_reading_plan_schedule_changed
    before update of books, chapter_selections, chapters_per_reading, interval_days, start_date, cadence_type, weekdays
    on public.study_reading_plans
    for each row execute function public.clear_book_reading_plan_completions_on_schedule_change();

commit;
