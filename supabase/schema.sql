-- SpareTix database schema: events, their tickets, "looking for" requests,
-- and private messages between sellers and buyers.
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
-- "Looking for" requests: one per user per event.
-- ---------------------------------------------------------------------------
create table if not exists public.requests (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete restrict,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  contact     text check (contact is null or char_length(contact) <= 140),
  created_at  timestamptz not null default now()
);

create unique index if not exists requests_event_user_key on public.requests (event_id, user_id);

alter table public.requests enable row level security;
revoke all on public.requests from anon;
revoke all on public.requests from authenticated;
grant select, insert, delete on public.requests to authenticated;

drop policy if exists "Logged-in users can read all requests" on public.requests;
create policy "Logged-in users can read all requests"
  on public.requests for select
  to authenticated
  using (auth.uid() is not null);

drop policy if exists "Users can insert their own requests" on public.requests;
create policy "Users can insert their own requests"
  on public.requests for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own requests" on public.requests;
create policy "Users can delete their own requests"
  on public.requests for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- find_or_create_event: the upcoming event with this name, or a new one.
-- Shared by post_ticket and post_request. Runs with the caller's rights, so
-- all policies above apply.
-- ---------------------------------------------------------------------------
create or replace function public.find_or_create_event(
  p_event_name text,
  p_event_id   uuid default null,
  p_event_date date default null,
  p_category   text default 'Events'
)
returns public.events
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_name   text := btrim(coalesce(p_event_name, ''));
  v_today  date := (now() at time zone 'Europe/Madrid')::date;
  v_event  public.events;
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

  return v_event;
end;
$$;

-- ---------------------------------------------------------------------------
-- post_ticket: add a ticket to the event (created if needed).
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
  v_event   public.events;
  v_ticket  public.tickets;
begin
  v_event := public.find_or_create_event(p_event_name, p_event_id, p_event_date, p_category);

  insert into public.tickets (user_id, event_id, price, paid_price, contact)
  values (auth.uid(), v_event.id, p_price, p_paid_price, nullif(btrim(p_contact), ''))
  returning * into v_ticket;

  return jsonb_build_object('event', to_jsonb(v_event), 'ticket', to_jsonb(v_ticket));
end;
$$;

-- ---------------------------------------------------------------------------
-- post_request: say you're looking for a ticket for the event (created if
-- needed). Asking twice for the same event keeps the first request.
-- ---------------------------------------------------------------------------
create or replace function public.post_request(
  p_event_name text,
  p_event_id   uuid default null,
  p_event_date date default null,
  p_category   text default 'Events',
  p_contact    text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_event    public.events;
  v_request  public.requests;
  v_created  boolean := true;
begin
  v_event := public.find_or_create_event(p_event_name, p_event_id, p_event_date, p_category);

  insert into public.requests (user_id, event_id, contact)
  values (auth.uid(), v_event.id, nullif(btrim(p_contact), ''))
  on conflict (event_id, user_id) do nothing
  returning * into v_request;

  if v_request.id is null then
    v_created := false;
    select * into v_request from public.requests
    where event_id = v_event.id and user_id = auth.uid();
  end if;

  return jsonb_build_object('event', to_jsonb(v_event), 'request', to_jsonb(v_request), 'created', v_created);
end;
$$;

-- ---------------------------------------------------------------------------
-- Messages: private conversations between a seller and a buyer about one event.
-- A buyer starts one from a seller's ticket; a seller (someone with a ticket
-- for the event) starts one from a "looking for" request. Only the two people
-- in a conversation can read it or write in it.
-- ---------------------------------------------------------------------------
create table if not exists public.conversations (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete restrict,
  ticket_id   uuid references public.tickets (id) on delete set null,
  request_id  uuid references public.requests (id) on delete set null,
  seller_id   uuid not null references auth.users (id) on delete cascade,
  buyer_id    uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint conversations_two_people check (seller_id <> buyer_id)
);

-- One conversation per seller and buyer per event.
create unique index if not exists conversations_pair_key
  on public.conversations (event_id, seller_id, buyer_id);
create index if not exists conversations_seller_idx on public.conversations (seller_id);
create index if not exists conversations_buyer_idx on public.conversations (buyer_id);

create table if not exists public.messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  sender_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body             text not null check (
                     char_length(body) <= 2000 and char_length(btrim(body, E' \t\r\n')) >= 1
                   ),
  read_at          timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

revoke all on public.conversations from anon;
revoke all on public.conversations from authenticated;
grant select on public.conversations to authenticated;
grant insert (event_id, ticket_id, request_id, seller_id, buyer_id) on public.conversations to authenticated;

revoke all on public.messages from anon;
revoke all on public.messages from authenticated;
grant select on public.messages to authenticated;
-- Senders can't set read_at or timestamps themselves.
grant insert (conversation_id, sender_id, body) on public.messages to authenticated;
-- The recipient may only mark messages as read.
grant update (read_at) on public.messages to authenticated;

drop policy if exists "People in a conversation can read it" on public.conversations;
create policy "People in a conversation can read it"
  on public.conversations for select
  to authenticated
  using (auth.uid() = seller_id or auth.uid() = buyer_id);

drop policy if exists "Start a conversation from a ticket or a request" on public.conversations;
create policy "Start a conversation from a ticket or a request"
  on public.conversations for insert
  to authenticated
  with check (
    (
      -- A buyer writes to the seller of a ticket for this event.
      auth.uid() = conversations.buyer_id
      and conversations.ticket_id is not null
      and conversations.request_id is null
      and exists (
        select 1 from public.tickets t
        where t.id = conversations.ticket_id
          and t.user_id = conversations.seller_id
          and t.event_id = conversations.event_id
      )
    )
    or (
      -- A seller with a ticket for this event writes to someone looking for one.
      auth.uid() = conversations.seller_id
      and conversations.request_id is not null
      and conversations.ticket_id is null
      and exists (
        select 1 from public.requests r
        where r.id = conversations.request_id
          and r.user_id = conversations.buyer_id
          and r.event_id = conversations.event_id
      )
      and exists (
        select 1 from public.tickets t
        where t.event_id = conversations.event_id and t.user_id = auth.uid()
      )
    )
  );

drop policy if exists "People in a conversation can read its messages" on public.messages;
create policy "People in a conversation can read its messages"
  on public.messages for select
  to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (auth.uid() = c.seller_id or auth.uid() = c.buyer_id)
    )
  );

drop policy if exists "People in a conversation can send messages" on public.messages;
create policy "People in a conversation can send messages"
  on public.messages for insert
  to authenticated
  with check (
    auth.uid() = messages.sender_id
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (auth.uid() = c.seller_id or auth.uid() = c.buyer_id)
    )
  );

drop policy if exists "Recipients can mark messages as read" on public.messages;
create policy "Recipients can mark messages as read"
  on public.messages for update
  to authenticated
  using (
    auth.uid() <> messages.sender_id
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (auth.uid() = c.seller_id or auth.uid() = c.buyer_id)
    )
  )
  with check (
    auth.uid() <> messages.sender_id
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (auth.uid() = c.seller_id or auth.uid() = c.buyer_id)
    )
  );

-- ---------------------------------------------------------------------------
-- start_conversation: open (or reuse) the conversation about a ticket or a
-- request and return its id. Runs with the caller's rights, so the insert
-- policy above decides who may start one.
-- ---------------------------------------------------------------------------
create or replace function public.start_conversation(
  p_ticket_id  uuid default null,
  p_request_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_event_id   uuid;
  v_seller_id  uuid;
  v_buyer_id   uuid;
  v_id         uuid;
begin
  if auth.uid() is null then
    raise exception 'You need to be logged in.' using errcode = '42501';
  end if;

  if p_ticket_id is not null then
    select event_id, user_id into v_event_id, v_seller_id from public.tickets where id = p_ticket_id;
    if v_event_id is null then
      raise exception 'This ticket is no longer listed.' using errcode = '22023';
    end if;
    v_buyer_id := auth.uid();
  elsif p_request_id is not null then
    select event_id, user_id into v_event_id, v_buyer_id from public.requests where id = p_request_id;
    if v_event_id is null then
      raise exception 'This person is no longer looking.' using errcode = '22023';
    end if;
    v_seller_id := auth.uid();
    if not exists (
      select 1 from public.tickets where event_id = v_event_id and user_id = auth.uid()
    ) then
      raise exception 'Post a ticket for this event first to message people looking.' using errcode = '42501';
    end if;
  else
    raise exception 'Choose a ticket or a request to reply to.' using errcode = '22023';
  end if;

  if v_seller_id = v_buyer_id then
    raise exception 'That is your own listing.' using errcode = '22023';
  end if;

  select id into v_id from public.conversations
  where event_id = v_event_id and seller_id = v_seller_id and buyer_id = v_buyer_id;

  if v_id is null then
    insert into public.conversations (event_id, ticket_id, request_id, seller_id, buyer_id)
    values (v_event_id, p_ticket_id, p_request_id, v_seller_id, v_buyer_id)
    on conflict do nothing
    returning id into v_id;

    -- Opened by the other person at the same moment: use that one.
    if v_id is null then
      select id into v_id from public.conversations
      where event_id = v_event_id and seller_id = v_seller_id and buyer_id = v_buyer_id;
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.find_or_create_event(text, uuid, date, text) from public, anon;
grant execute on function public.find_or_create_event(text, uuid, date, text) to authenticated;
revoke all on function public.post_ticket(text, uuid, date, text, numeric, numeric, text) from public, anon;
grant execute on function public.post_ticket(text, uuid, date, text, numeric, numeric, text) to authenticated;
revoke all on function public.post_request(text, uuid, date, text, text) from public, anon;
grant execute on function public.post_request(text, uuid, date, text, text) to authenticated;
revoke all on function public.start_conversation(uuid, uuid) from public, anon;
grant execute on function public.start_conversation(uuid, uuid) to authenticated;

commit;

-- Make the API pick up the new tables and functions right away.
notify pgrst, 'reload schema';
