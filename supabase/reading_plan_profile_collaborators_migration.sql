alter table public.study_reading_plans
    add column if not exists collaborator_profile_ids uuid[] not null default '{}';

alter table public.study_reading_plans
    add column if not exists collaborator_user_ids uuid[] not null default '{}';

create index if not exists study_reading_plans_collaborator_profiles_idx
    on public.study_reading_plans using gin(collaborator_profile_ids);

create index if not exists study_reading_plans_collaborator_users_idx
    on public.study_reading_plans using gin(collaborator_user_ids);

create or replace function public.reading_plan_partner_profiles_are_accessible(p_profile_ids uuid[])
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
    select not exists (
        select 1
        from unnest(coalesce(p_profile_ids, '{}'::uuid[])) as partner(profile_id)
        where not public.profile_is_accessible(partner.profile_id)
    );
$$;

create or replace function public.reading_plan_partner_accounts_are_registered(p_user_ids uuid[])
returns boolean language sql stable security definer set search_path = public, auth, pg_temp as $$
    select not exists (
        select 1
        from unnest(coalesce(p_user_ids, '{}'::uuid[])) as partner(user_id)
        where partner.user_id = (select auth.uid())
           or not exists (
               select 1
               from auth.users account
               where account.id = partner.user_id
                 and account.email is not null
                 and account.email_confirmed_at is not null
           )
    );
$$;

create or replace function public.reading_plan_is_accessible(p_plan_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
    select exists (
        select 1
        from public.study_reading_plans plan
        where plan.id = p_plan_id
          and (
              (
                  plan.profile_id is null
                  and (
                      plan.user_id = (select auth.uid())
                      or (plan.collaborator_email is not null
                          and lower(plan.collaborator_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
                      or (plan.owner_email is not null
                          and lower(plan.owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
                  )
              )
              or public.profile_is_accessible(plan.profile_id)
              or (select auth.uid()) = any(coalesce(plan.collaborator_user_ids, '{}'::uuid[]))
              or exists (
                  select 1
                  from unnest(coalesce(plan.collaborator_profile_ids, '{}'::uuid[])) as partner(profile_id)
                  where public.profile_is_accessible(partner.profile_id)
              )
          )
    );
$$;

create or replace function public.registered_reading_partners()
returns table(user_id uuid, display_name text)
language sql stable security definer set search_path = public, auth, pg_temp as $$
    with partners as (
        select
            account.id as partner_user_id,
            coalesce(
                nullif(btrim(profile.display_name), ''),
                nullif(btrim(account.raw_user_meta_data ->> 'display_name'), ''),
                'Registered account'
            ) as partner_display_name
        from auth.users account
        left join public.study_user_profiles profile on profile.user_id = account.id
        where (select auth.uid()) is not null
          and account.id <> (select auth.uid())
          and account.email is not null
          and account.email_confirmed_at is not null
    )
    select partner_user_id, partner_display_name
    from partners
    order by lower(partner_display_name), partner_user_id;
$$;

create or replace function public.guard_reading_plan_partner_profiles()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
    owns_plan boolean := false;
begin
    if auth.uid() is null then return new; end if;

    if new.user_id is distinct from old.user_id
       or new.profile_id is distinct from old.profile_id
       or new.collaborator_profile_ids is distinct from old.collaborator_profile_ids
       or new.collaborator_user_ids is distinct from old.collaborator_user_ids then
        if old.profile_id is null then
            owns_plan := old.user_id = (select auth.uid());
        else
            select profile.owner_user_id = (select auth.uid())
            into owns_plan
            from public.reader_profiles profile
            where profile.id = old.profile_id;
        end if;
        if not coalesce(owns_plan, false) then
            raise exception 'Only the owner of the plan profile can change plan partners.';
        end if;
        if new.collaborator_profile_ids is distinct from old.collaborator_profile_ids
           and not public.reading_plan_partner_profiles_are_accessible(new.collaborator_profile_ids) then
            raise exception 'You can only share a plan with profiles you can access.';
        end if;
        if new.collaborator_user_ids is distinct from old.collaborator_user_ids
           and not public.reading_plan_partner_accounts_are_registered(new.collaborator_user_ids) then
            raise exception 'Choose registered accounts other than your own.';
        end if;
    end if;
    return new;
end;
$$;

revoke all on function public.reading_plan_partner_profiles_are_accessible(uuid[]) from public, anon;
revoke all on function public.reading_plan_partner_accounts_are_registered(uuid[]) from public, anon;
revoke all on function public.reading_plan_is_accessible(uuid) from public, anon;
revoke all on function public.guard_reading_plan_partner_profiles() from public, anon;
revoke all on function public.registered_reading_partners() from public, anon;
grant execute on function public.reading_plan_partner_profiles_are_accessible(uuid[]) to authenticated;
grant execute on function public.reading_plan_partner_accounts_are_registered(uuid[]) to authenticated;
grant execute on function public.reading_plan_is_accessible(uuid) to authenticated;
grant execute on function public.registered_reading_partners() to authenticated;

drop trigger if exists guard_reading_plan_partner_profiles on public.study_reading_plans;
create trigger guard_reading_plan_partner_profiles
    before update on public.study_reading_plans
    for each row execute function public.guard_reading_plan_partner_profiles();

drop policy if exists "Users read accessible reading plans" on public.study_reading_plans;
create policy "Users read accessible reading plans"
    on public.study_reading_plans for select to authenticated
    using (public.reading_plan_is_accessible(id));

drop policy if exists "Users insert own reading plans" on public.study_reading_plans;
create policy "Users insert own reading plans"
    on public.study_reading_plans for insert to authenticated
    with check (
        (
            (profile_id is null and user_id = (select auth.uid()))
            or public.profile_is_accessible(profile_id)
        )
        and public.reading_plan_partner_profiles_are_accessible(collaborator_profile_ids)
        and public.reading_plan_partner_accounts_are_registered(collaborator_user_ids)
    );

drop policy if exists "Users update accessible reading plans" on public.study_reading_plans;
create policy "Users update accessible reading plans"
    on public.study_reading_plans for update to authenticated
    using (public.reading_plan_is_accessible(id))
    with check (public.reading_plan_is_accessible(id));

drop policy if exists "Users delete accessible reading plans" on public.study_reading_plans;
create policy "Users delete accessible reading plans"
    on public.study_reading_plans for delete to authenticated
    using (public.reading_plan_is_accessible(id));

drop policy if exists "Users manage own or profile plan items" on public.study_reading_plan_items;
drop policy if exists "Users read accessible reading plan items" on public.study_reading_plan_items;
drop policy if exists "Users insert accessible reading plan items" on public.study_reading_plan_items;
drop policy if exists "Users update accessible reading plan items" on public.study_reading_plan_items;
drop policy if exists "Users delete accessible reading plan items" on public.study_reading_plan_items;
create policy "Users manage own or profile plan items"
    on public.study_reading_plan_items for all to authenticated
    using (public.reading_plan_is_accessible(plan_id))
    with check (public.reading_plan_is_accessible(plan_id));

drop policy if exists "Users read accessible reading completions" on public.study_reading_plan_completions;
drop policy if exists "Users insert accessible reading completions" on public.study_reading_plan_completions;
drop policy if exists "Users update accessible reading completions" on public.study_reading_plan_completions;
drop policy if exists "Users delete accessible reading completions" on public.study_reading_plan_completions;
create policy "Users read accessible reading completions"
    on public.study_reading_plan_completions for select to authenticated
    using (public.reading_plan_is_accessible(plan_id));
create policy "Users insert accessible reading completions"
    on public.study_reading_plan_completions for insert to authenticated
    with check (
        user_id = (select auth.uid())
        and public.reading_plan_is_accessible(plan_id)
    );
create policy "Users update accessible reading completions"
    on public.study_reading_plan_completions for update to authenticated
    using (public.reading_plan_is_accessible(plan_id))
    with check (public.reading_plan_is_accessible(plan_id));
create policy "Users delete accessible reading completions"
    on public.study_reading_plan_completions for delete to authenticated
    using (public.reading_plan_is_accessible(plan_id));

create or replace function public.toggle_study_reading_plan_item(
    p_item_id uuid,
    p_read_date date,
    p_profile_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    selected_item public.study_reading_plan_items%rowtype;
    selected_plan public.study_reading_plans%rowtype;
    was_completed boolean;
    log_profile_id uuid;
begin
    if auth.uid() is null or p_read_date is null then
        raise exception 'A signed-in user and valid read date are required.';
    end if;

    select item.* into selected_item
    from public.study_reading_plan_items item
    where item.id = p_item_id
      and public.reading_plan_is_accessible(item.plan_id)
    for update;
    if not found then raise exception 'Reading plan item not found or access denied.'; end if;

    select * into selected_plan
    from public.study_reading_plans
    where id = selected_item.plan_id;

    if p_profile_id is not null and (
        not public.profile_is_accessible(p_profile_id)
        or (
            p_profile_id is distinct from selected_plan.profile_id
            and not (p_profile_id = any(coalesce(selected_plan.collaborator_profile_ids, '{}'::uuid[])))
            and not (auth.uid() = any(coalesce(selected_plan.collaborator_user_ids, '{}'::uuid[])))
        )
    ) then
        raise exception 'The selected reader profile is not a partner on this reading plan.';
    end if;
    log_profile_id := coalesce(p_profile_id, selected_plan.profile_id);

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
            user_id, profile_id, read_date, chapter_selections, source_type, plan_id, plan_item_id
        ) values (
            auth.uid(), log_profile_id, p_read_date,
            selected_item.chapter_selections, 'plan', selected_item.plan_id, selected_item.id
        );
    end if;

    select * into selected_plan
    from public.study_reading_plans
    where id = selected_item.plan_id;
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

create or replace function public.toggle_study_reading_plan_item(p_item_id uuid, p_read_date date)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
    select public.toggle_study_reading_plan_item(p_item_id, p_read_date, null::uuid);
$$;

revoke all on function public.toggle_study_reading_plan_item(uuid, date, uuid) from public, anon;
revoke all on function public.toggle_study_reading_plan_item(uuid, date) from public, anon;
grant execute on function public.toggle_study_reading_plan_item(uuid, date, uuid) to authenticated;
grant execute on function public.toggle_study_reading_plan_item(uuid, date) to authenticated;
