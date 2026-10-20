-- Applied to rhtowkcsguseruutnqvg with user approval.
-- Supabase migration version: 20261020014555; name: ios_campus_and_lecture_chat.
-- Reviewed original SQL SHA256: 9b8ecfcc60cec8bebf111e12ac460059b688903a80b4dbf2920135594eac2367.
begin;
create table public.campus_directory (
 id uuid primary key default gen_random_uuid(),
 category text not null check (category in ('club','promotion')),
 title text not null check (char_length(title) between 1 and 120),
 body text not null default '' check (char_length(body)<=4000),
 url text not null check (url ~ '^https://[^[:space:]]+$'),
 sponsor text not null default '',
 published boolean not null default false,
 expires_at timestamptz,
 created_at timestamptz not null default now()
);
alter table public.campus_directory enable row level security;
revoke all on public.campus_directory from public, anon, authenticated;
grant select on public.campus_directory to anon, authenticated;
create policy published_directory_read on public.campus_directory for select to anon, authenticated
 using (published and (expires_at is null or expires_at>now()));
-- Publication is operator-managed. No client INSERT/UPDATE/DELETE grants or policies.

-- Sender deletion follows the existing applied department-chat policy:
-- delete that sender's messages, rather than retaining identifying text/nickname.
-- Group deletion follows existing tasks/user_lecture_data group CASCADE semantics:
-- remove only messages of the deleted canonical group. Ordinary course withdrawal
-- deletes an enrollment, not a group; it revokes access but retains room history.
-- These cascades affect only this new message table, never other users/groups.
create table public.lecture_chat_messages (
 id uuid primary key,
 group_id uuid not null references public.groups(id) on delete cascade,
 sender_id uuid not null references auth.users(id) on delete cascade,
 nickname text not null check (char_length(btrim(nickname)) between 1 and 32),
 body text not null check (char_length(btrim(body)) between 1 and 2000),
 created_at timestamptz not null default now()
);
create index lecture_chat_room_time on public.lecture_chat_messages(group_id,created_at desc,id desc);
alter table public.lecture_chat_messages enable row level security;
revoke all on public.lecture_chat_messages from public, anon, authenticated;
grant select on public.lecture_chat_messages to authenticated;
grant insert(id,group_id,sender_id,nickname,body) on public.lecture_chat_messages to authenticated;
create policy enrolled_lecture_chat_read on public.lecture_chat_messages for select to authenticated
 using (exists(select 1 from public.user_lecture_data enrollment
   where enrollment.user_id=(select auth.uid()) and enrollment.group_id=lecture_chat_messages.group_id));
create policy enrolled_lecture_chat_send on public.lecture_chat_messages for insert to authenticated
 with check (sender_id=(select auth.uid()) and exists(select 1 from public.user_lecture_data enrollment
   where enrollment.user_id=(select auth.uid()) and enrollment.group_id=lecture_chat_messages.group_id));
-- No UPDATE/DELETE, SECURITY DEFINER, membership forgery, public room or Realtime grant.
-- RLS on existing user_lecture_data remains authoritative for the membership lookup.
commit;
