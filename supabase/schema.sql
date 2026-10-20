-- SpareTix database schema: events and their tickets.
-- Paste into Supabase: Dashboard → SQL Editor → New query → Run.
--
-- Works on a fresh project and on the old single-table schema: it moves every
-- existing ticket into an event (one event per distinct ticket title) and then
-- removes the old title/category/date columns from tickets. Safe to run again.

begin;

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 140),
  event_date  date,
  category    text not null default 'Events' check (category in ('Events', 'Transport')),
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

-- One event per name and date (two undated events with the same name count as duplicates).
create unique index if not exists events_name_date_key
  on public.events (lower(name), event_date) nulls not distinct;
create index if not exists events_event_date_idx on public.events (event_date);

-- ---------------------------------------------------------------------------
-- Tickets (fresh projects get the new shape directly)
-- ---------------------------------------------------------------------------
create table if not exists public.tickets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  event_id    uuid,
  price       numeric(10, 2) check (price is null or price >= 0),
  paid_price  numeric(10, 2) check (paid_price is null or paid_price >= 0),
  contact     text check (contact is null or char_length(contact) <= 140),
  sold        boolean not null default false,
  created_at  timestamptz not null default now()
);

alter table public.tickets add column if not exists event_id uuid;

-- An event can't be deleted while it still has tickets (no cascade that could
-- remove another user's ticket). Re-created so older databases get it too.
alter table public.tickets drop constraint if exists tickets_event_id_fkey;
alter table public.tickets
  add constraint tickets_event_id_fkey
  foreign key (event_id) references public.events (id) on delete restrict;
alter table public.tickets
  add column if not exists paid_price numeric(10, 2) check (paid_price is null or paid_price >= 0);

-- ---------------------------------------------------------------------------
-- Migrate old tickets: one event per distinct title (ignoring case and
-- leading/trailing spaces). The event takes the soonest upcoming date given for
-- that title (or its latest date if all are past), and the category, creator
-- and creation time of the oldest ticket with that title.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tickets' and column_name = 'title'
  ) then
    insert into public.events (name, event_date, category, created_by, created_at)
    select distinct on (lower(btrim(t.title)))
      btrim(t.title),
      (select coalesce(
          min(t2.event_date) filter (where t2.event_date >= (now() at time zone 'Europe/Madrid')::date),
          max(t2.event_date))
        from public.tickets t2
        where lower(btrim(t2.title)) = lower(btrim(t.title))),
      t.category,
      t.user_id,
      t.created_at
    from public.tickets t
    where t.event_id is null
    order by lower(btrim(t.title)), t.created_at
    on conflict do nothing;

    update public.tickets t
    set event_id = e.id
    from public.events e
    where t.event_id is null
      and lower(e.name) = lower(btrim(t.title))
      and e.event_date is not distinct from (
        select coalesce(
          min(t2.event_date) filter (where t2.event_date >= (now() at time zone 'Europe/Madrid')::date),
          max(t2.event_date))
        from public.tickets t2
        where lower(btrim(t2.title)) = lower(btrim(t.title))
      );
  end if;
end $$;

alter table public.tickets alter column event_id set not null;
alter table public.tickets drop column if exists title;
alter table public.tickets drop column if exists category;
alter table public.tickets drop column if exists event_date;

create index if not exists tickets_event_id_idx on public.tickets (event_id);
create index if not exists tickets_user_id_idx on public.tickets (user_id);

-- ---------------------------------------------------------------------------
-- Row Level Security: nothing is readable without logging in.
-- ---------------------------------------------------------------------------
alter table public.events enable row level security;
alter table public.tickets enable row level security;

revoke all on public.events from anon;
revoke all on public.tickets from anon;

grant select, insert, delete on public.events to authenticated;
grant select, insert, delete on public.tickets to authenticated;
-- Only these columns can ever be changed after creation.
revoke update on public.events from authenticated;
grant update (name, event_date, category) on public.events to authenticated;
revoke update on public.tickets from authenticated;
grant update (price, paid_price, contact, sold) on public.tickets to authenticated;

-- Events
drop policy if exists "Logged-in users can read all events" on public.events;
create policy "Logged-in users can read all events"
  on public.events for select
  to authenticated
  using (auth.uid() is not null);

drop policy if exists "Logged-in users can create events" on public.events;
create policy "Logged-in users can create events"
  on public.events for insert
  to authenticated
  with check (auth.uid() = created_by);

drop policy if exists "Creators can edit their events" on public.events;
create policy "Creators can edit their events"
  on public.events for update
  to authenticated
  using (auth.uid() = created_by)
  with check (auth.uid() = created_by);

-- The foreign key above also blocks deleting an event that still has any tickets.
drop policy if exists "Creators can delete events without other users' tickets" on public.events;
create policy "Creators can delete events without other users' tickets"
  on public.events for delete
  to authenticated
  using (
    auth.uid() = created_by
    and not exists (
      select 1 from public.tickets t
      where t.event_id = events.id and t.user_id <> auth.uid()
    )
  );

-- Tickets
drop policy if exists "Logged-in users can read all tickets" on public.tickets;
create policy "Logged-in users can read all tickets"
  on public.tickets for select
  to authenticated
  using (auth.uid() is not null);

drop policy if exists "Users can insert their own tickets" on public.tickets;
create policy "Users can insert their own tickets"
  on public.tickets for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own tickets" on public.tickets;
create policy "Users can update their own tickets"
  on public.tickets for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own tickets" on public.tickets;
create policy "Users can delete their own tickets"
  on public.tickets for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- post_ticket: add a ticket to the upcoming event with this name, or create
-- the event first. Runs with the caller's rights, so all policies above apply.
-- ---------------------------------------------------------------------------
create or replace function public.post_ticket(
  p_event_name text,
  p_event_id   uuid    default null,
  p_event_date date    default null,
  p_category   text    default 'Events',
  p_price      numeric default null,
  p_paid_price numeric default null,
  p_contact    text    default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_name     text := btrim(coalesce(p_event_name, ''));
  v_today    date := (now() at time zone 'Europe/Madrid')::date;
  v_event    public.events;
  v_ticket   public.tickets;
begin
  if auth.uid() is null then
    raise exception 'You need to be logged in.' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'Please type the event name.' using errcode = '22023';
  end if;

  -- The event the user picked from the suggestions, if it is still upcoming.
  if p_event_id is not null then
    select * into v_event from public.events
    where id = p_event_id and (event_date is null or event_date >= v_today);
  end if;

  -- Otherwise the soonest upcoming event with the same name (case-insensitive).
  if v_event.id is null then
    select * into v_event from public.events
    where lower(name) = lower(v_name) and (event_date is null or event_date >= v_today)
    order by event_date asc nulls last, created_at asc
    limit 1;
  end if;

  -- Otherwise create it.
  if v_event.id is null then
    if p_event_date is not null and p_event_date < v_today then
      raise exception 'The event date is in the past.' using errcode = '22023';
    end if;

    insert into public.events (name, event_date, category, created_by)
    values (v_name, p_event_date, coalesce(p_category, 'Events'), auth.uid())
    on conflict do nothing
    returning * into v_event;

    -- Someone created the same event at the same moment: use theirs.
    if v_event.id is null then
      select * into v_event from public.events
      where lower(name) = lower(v_name) and event_date is not distinct from p_event_date
      limit 1;
    end if;
  end if;

  insert into public.tickets (user_id, event_id, price, paid_price, contact)
  values (auth.uid(), v_event.id, p_price, p_paid_price, nullif(btrim(p_contact), ''))
  returning * into v_ticket;

  return jsonb_build_object('event', to_jsonb(v_event), 'ticket', to_jsonb(v_ticket));
end;
$$;

revoke all on function public.post_ticket(text, uuid, date, text, numeric, numeric, text) from public, anon;
grant execute on function public.post_ticket(text, uuid, date, text, numeric, numeric, text) to authenticated;

commit;

-- Make the API pick up the new table and function right away.
notify pgrst, 'reload schema';
