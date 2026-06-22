-- Supabase SQL Editor에서 실행하세요

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  nickname text not null,
  content text not null check (char_length(content) <= 500),
  created_at timestamptz not null default now()
);

create index messages_created_at_idx on public.messages (created_at desc);

alter table public.messages enable row level security;

create policy "messages_select"
  on public.messages for select
  using (true);

create policy "messages_insert"
  on public.messages for insert
  with check (true);

-- Realtime 활성화 (Supabase Dashboard → Database → Replication)
alter publication supabase_realtime add table public.messages;
