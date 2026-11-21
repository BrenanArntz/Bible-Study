begin;

alter table public.prayers
    add column if not exists shared_with_user_ids uuid[] not null default '{}';

create index if not exists prayers_shared_users_idx
    on public.prayers using gin (shared_with_user_ids);

create or replace function public.prayer_shared_accounts_are_registered(p_user_ids uuid[])
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
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

revoke all on function public.prayer_shared_accounts_are_registered(uuid[]) from public, anon;
grant execute on function public.prayer_shared_accounts_are_registered(uuid[]) to authenticated;

create or replace function public.guard_prayer_ownership()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
    if tg_op = 'INSERT' then
        if new.user_id is distinct from (select auth.uid()) then
            raise exception 'New prayers must belong to the signed-in user.';
        end if;
        if not public.prayer_shared_accounts_are_registered(new.shared_with_user_ids) then
            raise exception 'Choose registered accounts other than your own.';
        end if;
        return new;
    end if;
    if new.user_id is distinct from old.user_id
       or new.owner_email is distinct from old.owner_email then
        raise exception 'Prayer ownership cannot be changed.';
    end if;
    if old.user_id is distinct from (select auth.uid())
       and (
           new.shared_with_email is distinct from old.shared_with_email
           or new.shared_with_user_ids is distinct from old.shared_with_user_ids
       ) then
        raise exception 'Only the prayer owner can change sharing.';
    end if;
    if new.shared_with_user_ids is distinct from old.shared_with_user_ids
       and not public.prayer_shared_accounts_are_registered(new.shared_with_user_ids) then
        raise exception 'Choose registered accounts other than your own.';
    end if;
    return new;
end;
$$;

revoke all on function public.guard_prayer_ownership() from public, anon;
drop trigger if exists guard_prayer_ownership on public.prayers;
create trigger guard_prayer_ownership
    before insert or update on public.prayers
    for each row execute function public.guard_prayer_ownership();

drop policy if exists "Users read accessible prayers" on public.prayers;
create policy "Users read accessible prayers"
    on public.prayers for select to authenticated
    using (
        (select auth.uid()) = user_id
        or lower(coalesce((select auth.jwt() ->> 'email'), '')) = lower(coalesce(shared_with_email, ''))
        or (select auth.uid()) = any(coalesce(shared_with_user_ids, '{}'::uuid[]))
    );

drop policy if exists "Users insert accessible prayers" on public.prayers;
create policy "Users insert accessible prayers"
    on public.prayers for insert to authenticated
    with check (
        (select auth.uid()) = user_id
        or lower(coalesce((select auth.jwt() ->> 'email'), '')) = lower(coalesce(shared_with_email, ''))
        or (select auth.uid()) = any(coalesce(shared_with_user_ids, '{}'::uuid[]))
    );

drop policy if exists "Users update accessible prayers" on public.prayers;
create policy "Users update accessible prayers"
    on public.prayers for update to authenticated
    using (
        (select auth.uid()) = user_id
        or lower(coalesce((select auth.jwt() ->> 'email'), '')) = lower(coalesce(shared_with_email, ''))
        or (select auth.uid()) = any(coalesce(shared_with_user_ids, '{}'::uuid[]))
    )
    with check (
        (select auth.uid()) = user_id
        or lower(coalesce((select auth.jwt() ->> 'email'), '')) = lower(coalesce(shared_with_email, ''))
        or (select auth.uid()) = any(coalesce(shared_with_user_ids, '{}'::uuid[]))
    );

drop policy if exists "Users delete accessible prayers" on public.prayers;
create policy "Users delete accessible prayers"
    on public.prayers for delete to authenticated
    using (
        (select auth.uid()) = user_id
        or lower(coalesce((select auth.jwt() ->> 'email'), '')) = lower(coalesce(shared_with_email, ''))
        or (select auth.uid()) = any(coalesce(shared_with_user_ids, '{}'::uuid[]))
    );

commit;
