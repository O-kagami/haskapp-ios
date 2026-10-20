// Disposable PGlite only: no network, real Supabase project, credential or user data.
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {PGlite}=require(process.argv[2]||'@electric-sql/pglite');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',G='33333333-3333-4333-8333-333333333333',H='44444444-4444-4444-8444-444444444444';
(async()=>{const db=new PGlite();let count=0;const check=(ok,label)=>{assert.ok(ok,label);count++;};
await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${A}'),('${B}');
create function auth.uid() returns uuid language sql stable security invoker as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to anon,authenticated;create table public.groups(id uuid primary key);insert into public.groups values('${G}'),('${H}');
create table public.user_lecture_data(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),group_id uuid references public.groups(id) on delete cascade);
insert into public.user_lecture_data(user_id,group_id) values('${A}','${G}'),('${B}','${H}');alter table public.user_lecture_data enable row level security;
grant select on public.user_lecture_data to authenticated;create policy own_enrollment on public.user_lecture_data for select to authenticated using(user_id=auth.uid());`);
const sql=fs.readFileSync(path.join(__dirname,'../migrations/drafts/20261020010508_ios_campus_and_lecture_chat_review.sql'),'utf8');await db.exec(sql);
await db.exec(`insert into public.campus_directory(category,title,url,published) values('club','Verified published club','https://example.org/club',true),('promotion','Unpublished promotion','https://example.org/promo',false);`);
async function as(role,owner,sql){await db.exec('begin');try{await db.exec(`set local role ${role};select set_config('request.jwt.claim.sub','${owner}',true)`);const result=await db.query(sql);await db.exec('rollback');return result.rows;}catch(e){await db.exec('rollback');throw e;}}
async function denied(role,owner,sql){let error;try{await as(role,owner,sql);}catch(e){error=e;}check(!!error,'Expected denied operation');}
check((await as('anon','',`select * from public.campus_directory`)).length===1,'Anonymous sees only published catalogue');
await denied('anon','',`select * from public.lecture_chat_messages`);
await denied('authenticated',A,`insert into public.campus_directory(category,title,url) values('club','Forged','https://example.org')`);
await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${A}',false);insert into public.lecture_chat_messages(id,group_id,sender_id,nickname,body) values('55555555-5555-4555-8555-555555555555','${G}','${A}','Sample','Local RLS test');reset role`);
check((await as('authenticated',A,'select * from public.lecture_chat_messages')).length===1,'Enrolled owner can read own lecture room');
check((await as('authenticated',B,'select * from public.lecture_chat_messages')).length===0,'Other lecture enrollee cannot read this room');
await denied('authenticated',B,`insert into public.lecture_chat_messages(id,group_id,sender_id,nickname,body) values(gen_random_uuid(),'${G}','${B}','B','forbidden')`);
await denied('authenticated',A,`insert into public.lecture_chat_messages(id,group_id,sender_id,nickname,body) values(gen_random_uuid(),'${G}','${B}','Forged','forbidden')`);
await denied('authenticated',A,`update public.lecture_chat_messages set sender_id='${B}'`);
await denied('authenticated',A,`delete from public.lecture_chat_messages`);
await denied('authenticated',A,`insert into public.lecture_chat_messages(id,group_id,sender_id,nickname,body,created_at) values(gen_random_uuid(),'${G}','${A}','A','date spoof',now())`);
await db.exec(`delete from public.user_lecture_data where user_id='${A}'`);
check((await as('authenticated',A,'select * from public.lecture_chat_messages')).length===0,'Removing enrolment revokes room visibility');
check((await db.query('select * from public.groups')).rows.length===2,'Existing group data unchanged');
// Match the recorded existing group->enrollment CASCADE. Account A already
// withdrew above; old room posts must remain until account/group deletion.
check((await db.query(`select * from public.lecture_chat_messages where sender_id='${A}'`)).rows.length===1,'Withdrawing from a course keeps room history');
await db.exec(`insert into public.user_lecture_data(user_id,group_id) values('${B}','${G}')`);
check((await as('authenticated',B,`select * from public.lecture_chat_messages where group_id='${G}'`)).length===1,'Another enrolled user can still read history after the sender withdraws');
await denied('authenticated',B,`delete from public.groups where id='${G}'`);
await denied('authenticated',B,`delete from auth.users where id='${A}'`);
await db.exec(`insert into public.lecture_chat_messages(id,group_id,sender_id,nickname,body) values
('66666666-6666-4666-8666-666666666666','${G}','${B}','B','Other author in same room'),
('77777777-7777-4777-8777-777777777777','${H}','${A}','A','Former room history'),
('88888888-8888-4888-8888-888888888888','${H}','${B}','B','Other room history')`);
const otherBefore=(await db.query(`select id,group_id,sender_id,nickname,body from public.lecture_chat_messages where sender_id='${B}' order by id`)).rows;
// Privileged parent deletion is local-only. No DELETE is granted to app roles.
await db.exec(`delete from auth.users where id='${A}'`);
check((await db.query(`select * from auth.users where id='${A}'`)).rows.length===0,'Account deletion is not blocked by lecture messages');
check((await db.query(`select * from public.lecture_chat_messages where sender_id='${A}'`)).rows.length===0,'Account deletion removes all own messages across rooms');
check(JSON.stringify((await db.query(`select id,group_id,sender_id,nickname,body from public.lecture_chat_messages where sender_id='${B}' order by id`)).rows)===JSON.stringify(otherBefore),'Account deletion preserves all other authors message contents');
check((await db.query('select * from public.groups')).rows.length===2,'Account deletion does not delete canonical groups');
await db.exec(`delete from public.groups where id='${G}'`);
check((await db.query(`select * from public.groups where id='${G}'`)).rows.length===0,'Canonical group deletion is not blocked by message history');
check((await db.query(`select * from public.lecture_chat_messages where group_id='${G}'`)).rows.length===0,'Group deletion removes only that room history');
check((await db.query(`select * from public.user_lecture_data where group_id='${G}'`)).rows.length===0,'Existing group enrollment cascade still works');
check(JSON.stringify((await db.query(`select id,group_id,sender_id,nickname,body from public.lecture_chat_messages where group_id='${H}' order by id`)).rows)===JSON.stringify(otherBefore.filter(x=>x.group_id===H)),'Deleting one room preserves other room message contents');
check((await db.query(`select * from auth.users where id='${B}'`)).rows.length===1,'Group deletion does not delete user accounts');
check((await db.query('select * from public.campus_directory')).rows.length===2,'Account/group deletions do not change campus listings');
console.log(`Passed ${count} disposable DB authorization checks; migration not applied remotely`);await db.close();})().catch(e=>{console.error(e.message);process.exitCode=1});
