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

create policy "Users manage their own recurring tasks" on public.study_tasks
    for all to authenticated using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

create policy "Users manage their own task completions" on public.study_task_completions
    for all to authenticated using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.study_tasks to authenticated;
grant select, insert, update, delete on public.study_task_completions to authenticated;
