create table if not exists public.reader_profiles (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    owner_user_id uuid not null references auth.users(id) on delete cascade,
    shared_emails text[] not null default '{}',
    created_at timestamptz not null default now()
);

create index if not exists reader_profiles_owner_idx on public.reader_profiles(owner_user_id);
create index if not exists reader_profiles_shared_emails_idx on public.reader_profiles using gin(shared_emails);

alter table public.reader_profiles enable row level security;

drop policy if exists "Users read accessible managed reader profiles" on public.reader_profiles;
create policy "Users read accessible managed reader profiles"
    on public.reader_profiles for select to authenticated
    using (
        owner_user_id = (select auth.uid())
        or lower(coalesce(auth.jwt() ->> 'email', '')) = any(shared_emails)
    );

drop policy if exists "Users insert owned managed reader profiles" on public.reader_profiles;
create policy "Users insert owned managed reader profiles"
    on public.reader_profiles for insert to authenticated
    with check (owner_user_id = (select auth.uid()));

drop policy if exists "Users update accessible managed reader profiles" on public.reader_profiles;
create policy "Users update accessible managed reader profiles"
    on public.reader_profiles for update to authenticated
    using (
        owner_user_id = (select auth.uid())
        or lower(coalesce(auth.jwt() ->> 'email', '')) = any(shared_emails)
    )
    with check (
        owner_user_id = (select auth.uid())
        or lower(coalesce(auth.jwt() ->> 'email', '')) = any(shared_emails)
    );

drop policy if exists "Users delete owned managed reader profiles" on public.reader_profiles;
create policy "Users delete owned managed reader profiles"
    on public.reader_profiles for delete to authenticated
    using (owner_user_id = (select auth.uid()));

alter table public.study_reading_plans add column if not exists profile_id uuid references public.reader_profiles(id) on delete cascade;
alter table public.study_reading_plan_items add column if not exists profile_id uuid references public.reader_profiles(id) on delete cascade;
alter table public.study_reading_plan_completions add column if not exists profile_id uuid references public.reader_profiles(id) on delete cascade;
alter table public.reading_logs add column if not exists profile_id uuid references public.reader_profiles(id) on delete cascade;
alter table public.study_tasks add column if not exists profile_id uuid references public.reader_profiles(id) on delete cascade;
alter table public.study_task_completions add column if not exists profile_id uuid references public.reader_profiles(id) on delete cascade;
alter table public.study_chapter_readings add column if not exists profile_id uuid references public.reader_profiles(id) on delete cascade;

create index if not exists study_reading_plans_profile_idx on public.study_reading_plans(profile_id);
create index if not exists study_reading_plan_items_profile_idx on public.study_reading_plan_items(profile_id);
create index if not exists reading_logs_profile_idx on public.reading_logs(profile_id);
create index if not exists study_tasks_profile_idx on public.study_tasks(profile_id);
create index if not exists study_task_completions_profile_idx on public.study_task_completions(profile_id);

create or replace function public.profile_is_accessible(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
    select p_profile_id is not null and exists (
        select 1 from public.reader_profiles profile
        where profile.id = p_profile_id
          and (
              profile.owner_user_id = (select auth.uid())
              or lower(coalesce(auth.jwt() ->> 'email', '')) = any(profile.shared_emails)
          )
    );
$$;

-- Reading plans
drop policy if exists "Users read accessible reading plans" on public.study_reading_plans;
create policy "Users read accessible reading plans" on public.study_reading_plans for select to authenticated
using (
    (profile_id is null and (
        user_id = (select auth.uid())
        or (collaborator_email is not null and lower(collaborator_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
        or (owner_email is not null and lower(owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
    ))
    or public.profile_is_accessible(profile_id)
);

drop policy if exists "Users insert own reading plans" on public.study_reading_plans;
create policy "Users insert own reading plans" on public.study_reading_plans for insert to authenticated
with check (
    (profile_id is null and user_id = (select auth.uid()))
    or public.profile_is_accessible(profile_id)
);

drop policy if exists "Users update accessible reading plans" on public.study_reading_plans;
create policy "Users update accessible reading plans" on public.study_reading_plans for update to authenticated
using (
    (profile_id is null and (
        user_id = (select auth.uid())
        or (collaborator_email is not null and lower(collaborator_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
        or (owner_email is not null and lower(owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
    ))
    or public.profile_is_accessible(profile_id)
) with check (
    (profile_id is null and (
        user_id = (select auth.uid())
        or (collaborator_email is not null and lower(collaborator_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
        or (owner_email is not null and lower(owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
    ))
    or public.profile_is_accessible(profile_id)
);

drop policy if exists "Users delete accessible reading plans" on public.study_reading_plans;
create policy "Users delete accessible reading plans" on public.study_reading_plans for delete to authenticated
using (
    (profile_id is null and (
        user_id = (select auth.uid())
        or (collaborator_email is not null and lower(collaborator_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
    ))
    or public.profile_is_accessible(profile_id)
);

-- Plan items follow their plan/profile access
drop policy if exists "Users manage own or profile plan items" on public.study_reading_plan_items;
create policy "Users manage own or profile plan items" on public.study_reading_plan_items for all to authenticated
using (
    exists (
        select 1 from public.study_reading_plans plan
        where plan.id = plan_id
          and ((plan.profile_id is null and plan.user_id = (select auth.uid()))
               or public.profile_is_accessible(plan.profile_id))
    )
)
with check (
    exists (
        select 1 from public.study_reading_plans plan
        where plan.id = plan_id
          and ((plan.profile_id is null and plan.user_id = (select auth.uid()))
               or public.profile_is_accessible(plan.profile_id))
    )
);

-- Reading logs
drop policy if exists "Users read own reading logs" on public.reading_logs;
drop policy if exists "Users insert own reading logs" on public.reading_logs;
drop policy if exists "Users update own manual reading logs" on public.reading_logs;
drop policy if exists "Users delete own manual reading logs" on public.reading_logs;
drop policy if exists "Users delete accessible plan reading logs" on public.reading_logs;
create policy "Users read accessible reading logs" on public.reading_logs for select to authenticated
using (
    (profile_id is null and user_id = (select auth.uid()))
    or public.profile_is_accessible(profile_id)
);
create policy "Users insert accessible reading logs" on public.reading_logs for insert to authenticated
with check (
    (profile_id is null and user_id = (select auth.uid()))
    or public.profile_is_accessible(profile_id)
);
create policy "Users update accessible manual reading logs" on public.reading_logs for update to authenticated
using (source_type = 'manual' and ((profile_id is null and user_id = (select auth.uid())) or public.profile_is_accessible(profile_id)))
with check (source_type = 'manual' and ((profile_id is null and user_id = (select auth.uid())) or public.profile_is_accessible(profile_id)));
create policy "Users delete accessible reading logs" on public.reading_logs for delete to authenticated
using (
    ((profile_id is null and user_id = (select auth.uid())) or public.profile_is_accessible(profile_id))
);

-- Recurring tasks and completions
drop policy if exists "Users manage their own recurring tasks" on public.study_tasks;
create policy "Users manage own or profile recurring tasks" on public.study_tasks for all to authenticated
using ((profile_id is null and user_id = (select auth.uid())) or public.profile_is_accessible(profile_id))
with check ((profile_id is null and user_id = (select auth.uid())) or public.profile_is_accessible(profile_id));

drop policy if exists "Users manage their own task completions" on public.study_task_completions;
create policy "Users manage own or profile task completions" on public.study_task_completions for all to authenticated
using (
    (profile_id is null and user_id = (select auth.uid()))
    or public.profile_is_accessible(profile_id)
)
with check (
    (profile_id is null and user_id = (select auth.uid()))
    or public.profile_is_accessible(profile_id)
);

drop policy if exists "Users manage their own chapter readings" on public.study_chapter_readings;
create policy "Users manage own or profile chapter readings" on public.study_chapter_readings for all to authenticated
using ((profile_id is null and user_id = (select auth.uid())) or public.profile_is_accessible(profile_id))
with check ((profile_id is null and user_id = (select auth.uid())) or public.profile_is_accessible(profile_id));

drop policy if exists "Users read accessible reading completions" on public.study_reading_plan_completions;
drop policy if exists "Users insert accessible reading completions" on public.study_reading_plan_completions;
drop policy if exists "Users update accessible reading completions" on public.study_reading_plan_completions;
drop policy if exists "Users delete accessible reading completions" on public.study_reading_plan_completions;
create policy "Users read accessible reading completions" on public.study_reading_plan_completions for select to authenticated
using ((profile_id is null and user_id = (select auth.uid())) or public.profile_is_accessible(profile_id));
create policy "Users insert accessible reading completions" on public.study_reading_plan_completions for insert to authenticated
with check ((profile_id is null and user_id = (select auth.uid())) or public.profile_is_accessible(profile_id));
create policy "Users update accessible reading completions" on public.study_reading_plan_completions for update to authenticated
using ((profile_id is null and user_id = (select auth.uid())) or public.profile_is_accessible(profile_id))
with check ((profile_id is null and user_id = (select auth.uid())) or public.profile_is_accessible(profile_id));
create policy "Users delete accessible reading completions" on public.study_reading_plan_completions for delete to authenticated
using ((profile_id is null and user_id = (select auth.uid())) or public.profile_is_accessible(profile_id));

grant select, insert, update, delete on public.reader_profiles to authenticated;

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
          (plan.profile_id is null and plan.user_id = auth.uid())
          or public.profile_is_accessible(plan.profile_id)
      )
    for update of item;
    if not found then raise exception 'Reading plan item not found or access denied.'; end if;
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
        select * into selected_plan from public.study_reading_plans where id = selected_item.plan_id;
        insert into public.reading_logs (
            user_id, profile_id, read_date, chapter_selections, source_type, plan_id, plan_item_id
        ) values (
            auth.uid(), selected_plan.profile_id, p_read_date,
            selected_item.chapter_selections, 'plan', selected_item.plan_id, selected_item.id
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
grant execute on function public.toggle_study_reading_plan_item(uuid, date) to authenticated;
