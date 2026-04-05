-- 대화 목록
create table if not exists conversations (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null default '새 대화',
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- 대화 메시지
create table if not exists messages (
  id uuid default gen_random_uuid() primary key,
  conversation_id uuid references conversations(id) on delete cascade not null,
  role text check (role in ('user', 'assistant')) not null,
  content text not null,
  created_at timestamptz default now() not null
);

-- 법령 북마크
create table if not exists bookmarks (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  message_id uuid references messages(id) on delete cascade not null,
  conversation_id uuid references conversations(id) on delete cascade not null,
  note text,
  created_at timestamptz default now() not null,
  unique (user_id, message_id)
);

-- Row Level Security
alter table conversations enable row level security;
alter table messages enable row level security;
alter table bookmarks enable row level security;

-- 본인 데이터만 접근 가능
create policy "Users can manage own conversations"
  on conversations for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can manage messages in own conversations"
  on messages for all
  using (conversation_id in (select id from conversations where user_id = auth.uid()))
  with check (conversation_id in (select id from conversations where user_id = auth.uid()));

create policy "Users can manage own bookmarks"
  on bookmarks for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- updated_at 자동 갱신
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger conversations_updated_at
  before update on conversations
  for each row execute function update_updated_at();

-- 인덱스
create index if not exists idx_conversations_user on conversations(user_id, updated_at desc);
create index if not exists idx_messages_conversation on messages(conversation_id, created_at);
create index if not exists idx_bookmarks_user on bookmarks(user_id, created_at desc);

-- ─── 커뮤니티 Q&A ───

-- 질문 게시글
create table if not exists posts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  nickname text not null default '익명',
  title text not null,
  content text not null,
  category text check (category in ('중개실무', '계약서', '광고규정', '세금', '기타')) not null default '기타',
  views int default 0 not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- 답변/댓글
create table if not exists replies (
  id uuid default gen_random_uuid() primary key,
  post_id uuid references posts(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  nickname text not null default '익명',
  content text not null,
  created_at timestamptz default now() not null
);

-- 좋아요
create table if not exists post_likes (
  id uuid default gen_random_uuid() primary key,
  post_id uuid references posts(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  created_at timestamptz default now() not null,
  unique (post_id, user_id)
);

-- RLS
alter table posts enable row level security;
alter table replies enable row level security;
alter table post_likes enable row level security;

-- 게시글: 누구나 읽기, 본인만 쓰기/수정/삭제
create policy "Anyone can read posts" on posts for select using (true);
create policy "Users can create posts" on posts for insert with check (auth.uid() = user_id);
create policy "Users can update own posts" on posts for update using (auth.uid() = user_id);
create policy "Users can delete own posts" on posts for delete using (auth.uid() = user_id);

-- 댓글: 누구나 읽기, 본인만 쓰기/삭제
create policy "Anyone can read replies" on replies for select using (true);
create policy "Users can create replies" on replies for insert with check (auth.uid() = user_id);
create policy "Users can delete own replies" on replies for delete using (auth.uid() = user_id);

-- 좋아요: 누구나 읽기, 본인만 토글
create policy "Anyone can read likes" on post_likes for select using (true);
create policy "Users can like" on post_likes for insert with check (auth.uid() = user_id);
create policy "Users can unlike" on post_likes for delete using (auth.uid() = user_id);

-- 트리거
create trigger posts_updated_at
  before update on posts
  for each row execute function update_updated_at();

-- 인덱스
create index if not exists idx_posts_category on posts(category, created_at desc);
create index if not exists idx_posts_created on posts(created_at desc);
create index if not exists idx_replies_post on replies(post_id, created_at);
create index if not exists idx_post_likes_post on post_likes(post_id);

-- ─── 구독 결제 ───

-- 구독 정보
create table if not exists subscriptions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null unique,
  plan text check (plan in ('free', 'pro')) not null default 'free',
  kakao_sid text,  -- 카카오페이 정기결제 SID
  kakao_tid text,  -- 최근 결제 TID
  started_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- 일일 사용량 추적
create table if not exists daily_usage (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  usage_date date not null default current_date,
  count int not null default 0,
  unique (user_id, usage_date)
);

-- RLS
alter table subscriptions enable row level security;
alter table daily_usage enable row level security;

create policy "Users can read own subscription"
  on subscriptions for select using (auth.uid() = user_id);
create policy "Service can manage subscriptions"
  on subscriptions for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can read own usage"
  on daily_usage for select using (auth.uid() = user_id);
create policy "Users can manage own usage"
  on daily_usage for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 트리거
create trigger subscriptions_updated_at
  before update on subscriptions
  for each row execute function update_updated_at();

-- 인덱스
create index if not exists idx_subscriptions_user on subscriptions(user_id);
create index if not exists idx_daily_usage_user_date on daily_usage(user_id, usage_date);
