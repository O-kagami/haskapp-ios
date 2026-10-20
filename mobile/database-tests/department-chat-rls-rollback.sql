-- Existing auth IDs are used only inside this rollback; no credentials/users
-- are created or printed. No fixture is committed or delivered via Realtime.
BEGIN;
DO $$
DECLARE a uuid; b uuid; n integer; room text := 'hokudai:engineering:info-elec'; mid uuid:=gen_random_uuid(); denied boolean;
BEGIN
 SELECT id INTO a FROM auth.users ORDER BY created_at,id LIMIT 1;
 SELECT id INTO b FROM auth.users WHERE id<>a ORDER BY created_at,id LIMIT 1;
 IF a IS NULL OR b IS NULL THEN RAISE EXCEPTION 'Need two existing auth IDs for rollback-only RLS verification'; END IF;
 INSERT INTO public.department_chat_rooms VALUES ('qa:isolated','qa','qa','qa','Rollback fixture');
 INSERT INTO public.department_chat_memberships VALUES (a,room);
 INSERT INTO public.department_chat_messages(id,room_id,sender_id,nickname,body) VALUES (mid,room,a,'QA','Rollback fixture'),(gen_random_uuid(),'qa:isolated',b,'QA','Hidden rollback fixture');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated','is_anonymous',false)::text,true);
 SET LOCAL ROLE authenticated;
 SELECT count(*) INTO n FROM public.department_chat_messages; IF n<>1 THEN RAISE EXCEPTION 'Same-room read / outside-room isolation failed'; END IF;
 SELECT count(*) INTO n FROM public.department_chat_memberships; IF n<>1 THEN RAISE EXCEPTION 'Owner membership read failed'; END IF;
 INSERT INTO public.department_chat_messages(id,room_id,sender_id,nickname,body) VALUES(gen_random_uuid(),room,a,'QA','Own rollback-only insert');
 denied:=false; BEGIN INSERT INTO public.department_chat_messages(id,room_id,sender_id,nickname,body) VALUES(gen_random_uuid(),room,b,'QA','Spoof'); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END; IF NOT denied THEN RAISE EXCEPTION 'Sender spoof was accepted'; END IF;
 denied:=false; BEGIN INSERT INTO public.department_chat_messages(id,room_id,sender_id,nickname,body) VALUES(gen_random_uuid(),'qa:isolated',a,'QA','Wrong room'); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END; IF NOT denied THEN RAISE EXCEPTION 'Outside-room insert was accepted'; END IF;
 denied:=false; BEGIN INSERT INTO public.department_chat_memberships VALUES(b,room); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END; IF NOT denied THEN RAISE EXCEPTION 'Foreign membership was accepted'; END IF;
 UPDATE public.department_chat_memberships SET room_id='qa:isolated' WHERE owner_id=b; GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'Foreign membership changed'; END IF;
 denied:=false; BEGIN UPDATE public.department_chat_memberships SET owner_id=b WHERE owner_id=a; EXCEPTION WHEN insufficient_privilege THEN denied:=true; END; IF NOT denied THEN RAISE EXCEPTION 'Owner reassignment was accepted'; END IF;
 denied:=false; BEGIN UPDATE public.department_chat_messages SET body='edit' WHERE id=mid; EXCEPTION WHEN insufficient_privilege THEN denied:=true; END; IF NOT denied THEN RAISE EXCEPTION 'Message edit was accepted'; END IF;
 denied:=false; BEGIN DELETE FROM public.department_chat_messages WHERE id=mid; EXCEPTION WHEN insufficient_privilege THEN denied:=true; END; IF NOT denied THEN RAISE EXCEPTION 'Message delete was accepted'; END IF;
 denied:=false; BEGIN INSERT INTO public.department_chat_messages(id,room_id,sender_id,nickname,body,created_at) VALUES(gen_random_uuid(),room,a,'QA','forged time',now()); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END; IF NOT denied THEN RAISE EXCEPTION 'Client timestamp was accepted'; END IF;
 denied:=false; BEGIN INSERT INTO public.department_chat_messages(id,room_id,sender_id,nickname,body) VALUES(gen_random_uuid(),room,a,'QA',repeat('x',2001)); EXCEPTION WHEN check_violation THEN denied:=true; END; IF NOT denied THEN RAISE EXCEPTION 'Long body was accepted'; END IF;
 denied:=false; BEGIN INSERT INTO public.department_chat_messages(id,room_id,sender_id,nickname,body) VALUES(gen_random_uuid(),room,a,'QA',' '); EXCEPTION WHEN check_violation THEN denied:=true; END; IF NOT denied THEN RAISE EXCEPTION 'Blank body was accepted'; END IF;
 UPDATE public.department_chat_memberships SET room_id='qa:isolated' WHERE owner_id=a;
 SELECT count(*) INTO n FROM public.department_chat_messages WHERE room_id=room; IF n<>0 THEN RAISE EXCEPTION 'Previous room remained readable'; END IF;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated','is_anonymous',false)::text,true);
 SET LOCAL ROLE authenticated;
 SELECT count(*) INTO n FROM public.department_chat_messages; IF n<>0 THEN RAISE EXCEPTION 'Nonmember read was accepted'; END IF;
 INSERT INTO public.department_chat_memberships VALUES(b,room);
 SELECT count(*) INTO n FROM public.department_chat_messages; IF n<>2 THEN RAISE EXCEPTION 'New member cannot read same room'; END IF;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated','is_anonymous',true)::text,true);
 SET LOCAL ROLE authenticated;
 SELECT count(*) INTO n FROM public.department_chat_messages; IF n<>0 THEN RAISE EXCEPTION 'Anonymous Auth user could read'; END IF;
 SELECT count(*) INTO n FROM public.department_chat_rooms; IF n<>0 THEN RAISE EXCEPTION 'Anonymous Auth user could read rooms'; END IF;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
 SET LOCAL ROLE anon;
 denied:=false; BEGIN PERFORM 1 FROM public.department_chat_messages; EXCEPTION WHEN insufficient_privilege THEN denied:=true; END; IF NOT denied THEN RAISE EXCEPTION 'Guest could read'; END IF;
 denied:=false; BEGIN INSERT INTO public.department_chat_memberships VALUES(b,room); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END; IF NOT denied THEN RAISE EXCEPTION 'Guest could join'; END IF;
 RESET ROLE;
END $$;
ROLLBACK;
SELECT 'passed' AS rollback_rls_verification;
