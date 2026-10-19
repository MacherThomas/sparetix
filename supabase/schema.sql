-- SpareTix database schema
-- Paste into Supabase: Dashboard → SQL Editor → New query → Run.
-- Safe to run more than once.

create table if not exists public.tickets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null check (char_length(trim(title)) between 1 and 140),
  category    text not null default 'Events' check (category in ('Events', 'Transport')),
  price       numeric(10, 2) check (price is null or price >= 0),
  event_date  date,
  contact     text check (contact is null or char_length(contact) <= 140),
  sold        boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists tickets_user_id_idx on public.tickets (user_id);
create index if not exists tickets_created_at_idx on public.tickets (created_at desc);

-- Row Level Security: nothing is readable without logging in.
alter table public.tickets enable row level security;

-- Anonymous visitors get no access at all.
revoke all on public.tickets from anon;
grant select, insert, update, delete on public.tickets to authenticated;

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
