begin;

create table if not exists public.prayer_categories (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    name text not null,
    created_at timestamptz not null default now(),
    check (length(btrim(name)) between 1 and 60)
);

create unique index if not exists prayer_categories_user_lower_name_idx
    on public.prayer_categories (user_id, lower(name));

create table if not exists public.prayers (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    owner_email text,
    shared_with_email text,
    shared_with_user_ids uuid[] not null default '{}',
    category_name text not null default 'General' check (length(btrim(category_name)) between 1 and 60),
    title text not null check (length(btrim(title)) between 1 and 160),
    details text not null default '' check (length(details) <= 8000),
    scripture_ref text check (scripture_ref is null or length(scripture_ref) <= 100),
    is_pinned boolean not null default false,
    pray_count integer not null default 0 check (pray_count >= 0),
    last_prayed_at timestamptz,
    updates jsonb not null default '[]'::jsonb check (jsonb_typeof(updates) = 'array'),
    status text not null default 'active' check (status in ('active', 'answered')),
    answered_at date,
    answer_note text check (answer_note is null or length(answer_note) <= 4000),
    created_at timestamptz not null default now(),
    check (
        shared_with_email is null
        or (
            shared_with_email = lower(btrim(shared_with_email))
            and shared_with_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
        )
    )
);

alter table public.prayers
    add column if not exists shared_with_user_ids uuid[] not null default '{}';

create index if not exists prayers_user_status_idx
    on public.prayers (user_id, status, created_at desc);
create index if not exists prayers_shared_email_idx
    on public.prayers (lower(shared_with_email))
    where shared_with_email is not null;
create index if not exists prayers_shared_users_idx
    on public.prayers using gin (shared_with_user_ids);

grant select, insert, update, delete on public.prayer_categories to authenticated;
grant select, insert, update, delete on public.prayers to authenticated;

alter table public.prayer_categories enable row level security;
alter table public.prayers enable row level security;

drop policy if exists "Users manage their prayer categories" on public.prayer_categories;
create policy "Users manage their prayer categories"
    on public.prayer_categories for all to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

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

create or replace function public.rename_prayer_category(p_category_id uuid, p_name text)
returns public.prayer_categories
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
    selected_category public.prayer_categories%rowtype;
begin
    if length(btrim(coalesce(p_name, ''))) not between 1 and 60 then
        raise exception 'Enter a category name between 1 and 60 characters.';
    end if;
    select * into selected_category
    from public.prayer_categories
    where id = p_category_id and user_id = (select auth.uid())
    for update;
    if not found then
        raise exception 'Prayer category not found or you do not have permission to edit it.';
    end if;
    update public.prayers
    set category_name = btrim(p_name)
    where user_id = (select auth.uid()) and category_name = selected_category.name;
    update public.prayer_categories
    set name = btrim(p_name)
    where id = selected_category.id
    returning * into selected_category;
    return selected_category;
end;
$$;

create or replace function public.delete_prayer_category(p_category_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
    selected_category public.prayer_categories%rowtype;
begin
    select * into selected_category
    from public.prayer_categories
    where id = p_category_id and user_id = (select auth.uid())
    for update;
    if not found then
        raise exception 'Prayer category not found or you do not have permission to delete it.';
    end if;
    update public.prayers
    set category_name = 'General'
    where user_id = (select auth.uid()) and category_name = selected_category.name;
    delete from public.prayer_categories where id = selected_category.id;
    return selected_category.id;
end;
$$;

create or replace function public.mark_prayer_prayed(p_prayer_id uuid)
returns table(pray_count integer, last_prayed_at timestamptz)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
    update public.prayers as prayer
    set pray_count = prayer.pray_count + 1,
        last_prayed_at = now()
    where prayer.id = p_prayer_id
    returning prayer.pray_count, prayer.last_prayed_at
    into pray_count, last_prayed_at;

    if not found then
        raise exception 'Prayer not found or you do not have permission to update it.';
    end if;
    return next;
end;
$$;

revoke all on function public.mark_prayer_prayed(uuid) from public, anon;
revoke all on function public.rename_prayer_category(uuid, text) from public, anon;
revoke all on function public.delete_prayer_category(uuid) from public, anon;
grant execute on function public.mark_prayer_prayed(uuid) to authenticated;
grant execute on function public.rename_prayer_category(uuid, text) to authenticated;
grant execute on function public.delete_prayer_category(uuid) to authenticated;

commit;
