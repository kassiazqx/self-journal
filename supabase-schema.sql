-- ============================================
-- 自我觉察日记 App - Supabase 数据库初始化 SQL
-- 在 Supabase 控制台 → SQL Editor 中运行此文件
-- ============================================

-- 开启 Row Level Security 扩展（Supabase 默认已开启）
-- 确保 uuid 扩展可用
create extension if not exists "uuid-ossp";

-- ============================================
-- 日记记录表
-- ============================================
create table if not exists public.journal_entries (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  content text not null,                          -- 原始输入内容（文字或语音转文字）
  template_type text default 'free' check (       -- 模板类型
    template_type in ('gratitude', 'learning', 'emotion', 'action', 'free')
  ),
  created_at  timestamptz default now() not null,
  updated_at  timestamptz default now() not null,
  deleted_at  timestamptz default null,            -- 软删除标记（null = 未删除）
  sync_status text default 'synced' check (        -- 多端同步状态（为 Capacitor 预留）
    sync_status in ('synced', 'pending', 'conflict')
  )
);

-- 索引优化
create index if not exists idx_journal_entries_user_id on public.journal_entries(user_id);
create index if not exists idx_journal_entries_created_at on public.journal_entries(created_at desc);

-- Row Level Security：每个用户只能看到自己的数据
alter table public.journal_entries enable row level security;

create policy "用户只能查看自己的记录"
  on public.journal_entries for select
  using (auth.uid() = user_id);

create policy "用户只能创建自己的记录"
  on public.journal_entries for insert
  with check (auth.uid() = user_id);

create policy "用户只能更新自己的记录"
  on public.journal_entries for update
  using (auth.uid() = user_id);

create policy "用户只能删除自己的记录"
  on public.journal_entries for delete
  using (auth.uid() = user_id);

-- 自动更新 updated_at
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================
-- 觉察流对话表
-- ============================================
create table if not exists public.conversations (
  id           uuid default uuid_generate_v4() primary key,
  user_id      uuid references auth.users(id) on delete cascade not null,
  entry_id     uuid references public.journal_entries(id) on delete cascade not null,
  context_type text not null default 'entry',
  messages     jsonb not null default '[]',
  created_at   timestamptz default now() not null,
  updated_at   timestamptz default now() not null,
  unique (entry_id, context_type)
);

create index if not exists idx_conversations_entry_id on public.conversations(entry_id);

alter table public.conversations enable row level security;

create policy "用户只能查看自己的对话"
  on public.conversations for select
  using (auth.uid() = user_id);

create policy "用户只能创建自己的对话"
  on public.conversations for insert
  with check (auth.uid() = user_id);

create policy "用户只能更新自己的对话"
  on public.conversations for update
  using (auth.uid() = user_id);

create policy "用户只能删除自己的对话"
  on public.conversations for delete
  using (auth.uid() = user_id);

create trigger set_conversations_updated_at
  before update on public.conversations
  for each row execute procedure public.handle_updated_at();
