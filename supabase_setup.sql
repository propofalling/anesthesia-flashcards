-- TrueLearn ITE Flashcards — cross-device SRS progress sync
-- Run this once in your Supabase project: SQL Editor -> New query -> paste -> Run.

create table if not exists public.srs_progress (
  profile    text        not null,
  card_id    text        not null,
  state      jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (profile, card_id)
);

alter table public.srs_progress enable row level security;

-- Personal single-user app: the public "anon" key may read/write.
-- Rows are namespaced by the `profile` string set in config.js. Only spaced-
-- repetition scheduling data is stored here (no personal or clinical info), and
-- the deck itself is already public — so this is low-sensitivity by design.
drop policy if exists "anon full access" on public.srs_progress;
create policy "anon full access" on public.srs_progress
  for all to anon using (true) with check (true);
