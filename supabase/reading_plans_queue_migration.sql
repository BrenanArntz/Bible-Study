begin;

alter table public.study_reading_plans
    add column if not exists status text not null default 'active';
alter table public.study_reading_plans
    alter column books drop not null;
comment on column public.study_reading_plans.books
    is 'Legacy generator input retained temporarily for lazy creation of explicit items.';
comment on column public.study_reading_plans.chapter_selections
    is 'Legacy generator input retained temporarily for lazy creation of explicit items.';
alter table public.study_reading_plans
    drop constraint if exists study_reading_plans_status_check;
update public.study_reading_plans set status = 'archived' where status = 'cancelled';
alter table public.study_reading_plans
    add constraint study_reading_plans_status_check
    check (status in ('active', 'paused', 'completed', 'archived'));

alter table public.study_tasks
    add column if not exists status text not null default 'active';
alter table public.study_tasks
    drop constraint if exists study_tasks_status_check;
alter table public.study_tasks
    add constraint study_tasks_status_check
    check (status in ('active', 'paused', 'archived'));

drop trigger if exists study_reading_plan_schedule_changed on public.study_reading_plans;
drop function if exists public.clear_book_reading_plan_completions_on_schedule_change();

create table if not exists public.study_reading_plan_items (
    id uuid primary key default gen_random_uuid(),
    plan_id uuid not null references public.study_reading_plans(id) on delete cascade,
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    sort_order integer not null check (sort_order >= 0),
    scheduled_date date,
    chapter_selections jsonb not null
        check (jsonb_typeof(chapter_selections) = 'array'),
    status text not null default 'pending'
        check (status in ('pending', 'completed', 'skipped')),
    completed_date date,
    notes text,
    created_at timestamptz not null default now(),
    constraint study_reading_plan_items_completion_date_check
        check ((status = 'completed' and completed_date is not null)
            or (status <> 'completed' and completed_date is null))
);

create index if not exists study_reading_plan_items_plan_order_idx
    on public.study_reading_plan_items (plan_id, sort_order);
create index if not exists study_reading_plan_items_plan_date_idx
    on public.study_reading_plan_items (plan_id, scheduled_date)
    where status = 'pending';

create table if not exists public.reading_logs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    read_date date not null,
    chapter_selections jsonb not null
        check (jsonb_typeof(chapter_selections) = 'array'),
    source_type text not null check (source_type in ('plan', 'manual')),
    plan_id uuid references public.study_reading_plans(id) on delete set null,
    plan_item_id uuid references public.study_reading_plan_items(id) on delete set null,
    created_at timestamptz not null default now()
);

alter table public.reading_logs
    add column if not exists legacy_source_id uuid;

create index if not exists reading_logs_user_date_idx
    on public.reading_logs (user_id, read_date);
create index if not exists reading_logs_plan_item_idx
    on public.reading_logs (plan_item_id)
    where plan_item_id is not null;
create unique index if not exists reading_logs_legacy_source_id_idx
    on public.reading_logs (legacy_source_id);

insert into public.reading_logs (
    user_id, read_date, chapter_selections, source_type, created_at, legacy_source_id
)
select reading.user_id, reading.read_date, reading.chapter_selections,
       'manual', reading.created_at, reading.id
from public.study_chapter_readings reading
on conflict (legacy_source_id) do nothing;

create or replace function public.backfill_legacy_chapter_readings()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if auth.uid() is null then
        raise exception 'A signed-in user is required.';
    end if;

    insert into public.reading_logs (
        user_id, read_date, chapter_selections, source_type, created_at, legacy_source_id
    )
    select reading.user_id, reading.read_date, reading.chapter_selections,
           'manual', reading.created_at, reading.id
    from public.study_chapter_readings reading
    where reading.user_id = auth.uid()
    on conflict (legacy_source_id) do nothing;
end;
$$;

alter table public.study_reading_plans enable row level security;
alter table public.study_reading_plan_items enable row level security;
alter table public.reading_logs enable row level security;
alter table public.study_tasks enable row level security;

drop policy if exists "Users read accessible reading plans" on public.study_reading_plans;
drop policy if exists "Users insert own reading plans" on public.study_reading_plans;
drop policy if exists "Users update accessible reading plans" on public.study_reading_plans;
drop policy if exists "Users delete accessible reading plans" on public.study_reading_plans;

create policy "Users read accessible reading plans"
    on public.study_reading_plans for select to authenticated
    using (
        user_id = (select auth.uid())
        or (nullif(trim(collaborator_email), '') is not null
            and lower(trim(collaborator_email)) = lower(coalesce(auth.jwt() ->> 'email', '')))
        or (nullif(trim(owner_email), '') is not null
            and lower(trim(owner_email)) = lower(coalesce(auth.jwt() ->> 'email', '')))
    );

create policy "Users insert own reading plans"
    on public.study_reading_plans for insert to authenticated
    with check (user_id = (select auth.uid()));

create policy "Users update accessible reading plans"
    on public.study_reading_plans for update to authenticated
    using (
        user_id = (select auth.uid())
        or (nullif(trim(collaborator_email), '') is not null
            and lower(trim(collaborator_email)) = lower(coalesce(auth.jwt() ->> 'email', '')))
        or (nullif(trim(owner_email), '') is not null
            and lower(trim(owner_email)) = lower(coalesce(auth.jwt() ->> 'email', '')))
    )
    with check (
        user_id = (select auth.uid())
        or (nullif(trim(collaborator_email), '') is not null
            and lower(trim(collaborator_email)) = lower(coalesce(auth.jwt() ->> 'email', '')))
        or (nullif(trim(owner_email), '') is not null
            and lower(trim(owner_email)) = lower(coalesce(auth.jwt() ->> 'email', '')))
    );

create policy "Users delete accessible reading plans"
    on public.study_reading_plans for delete to authenticated
    using (
        user_id = (select auth.uid())
        or (nullif(trim(collaborator_email), '') is not null
            and lower(trim(collaborator_email)) = lower(coalesce(auth.jwt() ->> 'email', '')))
    );

drop policy if exists "Users read accessible reading plan items" on public.study_reading_plan_items;
drop policy if exists "Users insert accessible reading plan items" on public.study_reading_plan_items;
drop policy if exists "Users update accessible reading plan items" on public.study_reading_plan_items;
drop policy if exists "Users delete accessible reading plan items" on public.study_reading_plan_items;

create policy "Users read accessible reading plan items"
    on public.study_reading_plan_items for select to authenticated
    using (exists (
        select 1 from public.study_reading_plans plan
        where plan.id = plan_id and (
            plan.user_id = (select auth.uid())
            or (nullif(trim(plan.collaborator_email), '') is not null
                and lower(trim(plan.collaborator_email)) = lower(coalesce(auth.jwt() ->> 'email', '')))
            or (nullif(trim(plan.owner_email), '') is not null
                and lower(trim(plan.owner_email)) = lower(coalesce(auth.jwt() ->> 'email', '')))
        )
    ));

create policy "Users insert accessible reading plan items"
    on public.study_reading_plan_items for insert to authenticated
    with check (
        exists (
            select 1 from public.study_reading_plans plan
            where plan.id = plan_id
              and plan.user_id = study_reading_plan_items.user_id
              and (
                plan.user_id = (select auth.uid())
                or (nullif(trim(plan.collaborator_email), '') is not null
                    and lower(trim(plan.collaborator_email)) = lower(coalesce(auth.jwt() ->> 'email', '')))
                or (nullif(trim(plan.owner_email), '') is not null
                    and lower(trim(plan.owner_email)) = lower(coalesce(auth.jwt() ->> 'email', '')))
            )
        )
    );

create policy "Users update accessible reading plan items"
    on public.study_reading_plan_items for update to authenticated
    using (exists (
        select 1 from public.study_reading_plans plan
        where plan.id = plan_id and (
            plan.user_id = (select auth.uid())
            or (nullif(trim(plan.collaborator_email), '') is not null
                and lower(trim(plan.collaborator_email)) = lower(coalesce(auth.jwt() ->> 'email', '')))
            or (nullif(trim(plan.owner_email), '') is not null
                and lower(trim(plan.owner_email)) = lower(coalesce(auth.jwt() ->> 'email', '')))
        )
    ))
    with check (exists (
        select 1 from public.study_reading_plans plan
        where plan.id = plan_id
          and plan.user_id = study_reading_plan_items.user_id
          and (
            plan.user_id = (select auth.uid())
            or (nullif(trim(plan.collaborator_email), '') is not null
                and lower(trim(plan.collaborator_email)) = lower(coalesce(auth.jwt() ->> 'email', '')))
            or (nullif(trim(plan.owner_email), '') is not null
                and lower(trim(plan.owner_email)) = lower(coalesce(auth.jwt() ->> 'email', '')))
        )
    ));

create policy "Users delete accessible reading plan items"
    on public.study_reading_plan_items for delete to authenticated
    using (exists (
        select 1 from public.study_reading_plans plan
        where plan.id = plan_id and (
            plan.user_id = (select auth.uid())
            or (nullif(trim(plan.collaborator_email), '') is not null
                and lower(trim(plan.collaborator_email)) = lower(coalesce(auth.jwt() ->> 'email', '')))
            or (nullif(trim(plan.owner_email), '') is not null
                and lower(trim(plan.owner_email)) = lower(coalesce(auth.jwt() ->> 'email', '')))
        )
    ));

drop policy if exists "Users read own reading logs" on public.reading_logs;
drop policy if exists "Users insert own reading logs" on public.reading_logs;
drop policy if exists "Users update own manual reading logs" on public.reading_logs;
drop policy if exists "Users delete own manual reading logs" on public.reading_logs;
drop policy if exists "Users delete accessible plan reading logs" on public.reading_logs;

create policy "Users read own reading logs"
    on public.reading_logs for select to authenticated
    using (user_id = (select auth.uid()));

create policy "Users insert own reading logs"
    on public.reading_logs for insert to authenticated
    with check (user_id = (select auth.uid()));

create policy "Users update own manual reading logs"
    on public.reading_logs for update to authenticated
    using (user_id = (select auth.uid()) and source_type = 'manual')
    with check (user_id = (select auth.uid()) and source_type = 'manual');

create policy "Users delete own manual reading logs"
    on public.reading_logs for delete to authenticated
    using (user_id = (select auth.uid()) and source_type = 'manual');

create policy "Users delete accessible plan reading logs"
    on public.reading_logs for delete to authenticated
    using (
        source_type = 'plan' and exists (
            select 1 from public.study_reading_plans plan
            where plan.id = plan_id and (
                plan.user_id = (select auth.uid())
                or (nullif(trim(plan.collaborator_email), '') is not null
                    and lower(trim(plan.collaborator_email)) = lower(coalesce(auth.jwt() ->> 'email', '')))
                or (nullif(trim(plan.owner_email), '') is not null
                    and lower(trim(plan.owner_email)) = lower(coalesce(auth.jwt() ->> 'email', '')))
            )
        )
    );

drop policy if exists "Users manage their own recurring tasks" on public.study_tasks;
create policy "Users manage their own recurring tasks"
    on public.study_tasks for all to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

create or replace function public.toggle_study_reading_plan_item(p_item_id uuid, p_read_date date)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    selected_item public.study_reading_plan_items%rowtype;
    selected_plan public.study_reading_plans%rowtype;
    was_completed boolean;
begin
    if auth.uid() is null or p_read_date is null then
        raise exception 'A signed-in user and valid read date are required.';
    end if;

    select item.* into selected_item
    from public.study_reading_plan_items item
    join public.study_reading_plans plan on plan.id = item.plan_id
    where item.id = p_item_id
      and (
          plan.user_id = auth.uid()
          or (nullif(trim(plan.collaborator_email), '') is not null
              and lower(trim(plan.collaborator_email)) = lower(coalesce(auth.jwt() ->> 'email', '')))
          or (nullif(trim(plan.owner_email), '') is not null
              and lower(trim(plan.owner_email)) = lower(coalesce(auth.jwt() ->> 'email', '')))
      )
    for update of item;

    if not found then
        raise exception 'Reading plan item not found or access denied.';
    end if;
    if selected_item.status = 'skipped' then
        raise exception 'Restore the skipped item before completing it.';
    end if;

    was_completed := selected_item.status = 'completed';
    if was_completed then
        update public.study_reading_plan_items
        set status = 'pending', completed_date = null
        where id = selected_item.id;
        delete from public.reading_logs where plan_item_id = selected_item.id;
    else
        update public.study_reading_plan_items
        set status = 'completed', completed_date = p_read_date
        where id = selected_item.id;
        insert into public.reading_logs (
            user_id, read_date, chapter_selections, source_type, plan_id, plan_item_id
        ) values (
            auth.uid(), p_read_date, selected_item.chapter_selections, 'plan',
            selected_item.plan_id, selected_item.id
        );
    end if;

    select * into selected_plan from public.study_reading_plans where id = selected_item.plan_id;
    if selected_plan.status not in ('paused', 'archived') then
        if exists (
            select 1 from public.study_reading_plan_items
            where plan_id = selected_item.plan_id and status = 'pending'
        ) then
            update public.study_reading_plans set status = 'active' where id = selected_item.plan_id;
        else
            update public.study_reading_plans set status = 'completed' where id = selected_item.plan_id;
        end if;
    end if;
    return not was_completed;
end;
$$;

revoke all on function public.toggle_study_reading_plan_item(uuid, date) from public, anon;
revoke all on function public.backfill_legacy_chapter_readings() from public, anon;
grant select, insert, update, delete on public.study_reading_plan_items to authenticated;
grant select, insert, update, delete on public.reading_logs to authenticated;
grant execute on function public.toggle_study_reading_plan_item(uuid, date) to authenticated;
grant execute on function public.backfill_legacy_chapter_readings() to authenticated;
grant select, insert, update, delete on public.study_tasks to authenticated;

commit;

-- Opening Today once after migration creates explicit queue items for legacy
-- generated plans. Then backfill every user's old check-offs (including shared
-- collaborators) by joining on plan_id + the old scheduled_date:
-- insert into public.reading_logs
--     (user_id, read_date, chapter_selections, source_type, plan_id, plan_item_id, created_at)
-- select completion.user_id, completion.scheduled_date, item.chapter_selections,
--        'plan', item.plan_id, item.id, completion.completed_at
-- from public.study_reading_plan_completions completion
-- join public.study_reading_plan_items item
--   on item.plan_id = completion.plan_id
--  and item.scheduled_date = completion.scheduled_date
-- where not exists (
--     select 1 from public.reading_logs log
--     where log.plan_item_id = item.id and log.user_id = completion.user_id
-- );
