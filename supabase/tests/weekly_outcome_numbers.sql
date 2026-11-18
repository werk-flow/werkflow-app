-- The admin's weekly company numbers count each rule as of a Berlin week end
-- (migration 20261218090001_count_weekly_outcome_numbers.sql):
-- * workdays are Monday to Friday after the first day up to the last, across
--   a month end and a leap day; a day before the first counts none;
-- * K2 counts each overdue kind as it stood at the end of the reading day:
--   a row created later never counts, one closed later still counts;
-- * T2 measures the workdays from the last finish on site to the first
--   reviewed release, in the week of the release;
-- * A1 shares the jobs finished in the week with a submitted or approved
--   work report; A2 the week's entries the person recorded, a rejected one aside;
-- * a week without finished jobs or entries reports zero and no median;
-- * another organization's rows never count, and only the service role
--   executes the functions.
-- Runs inside one transaction against the local stack and rolls back.
begin;

do $$ begin
  if (select count(*) from (values
      ('2026-02-27'::date, '2026-03-02'::date, 1),  -- Friday to Monday across a month end
      ('2040-02-28', '2040-03-01', 2),              -- the leap day is a workday
      ('2026-03-02', '2026-02-27', 0),              -- a day in the past counts none
      ('2026-02-25', '2026-02-25', 0),
      ('2026-02-14', '2026-02-15', 0),              -- Saturday to Sunday
      ('2026-02-16', '2026-02-26', 8),
      ('2025-12-31', '2026-01-31', 22)
    ) as expected(from_day, to_day, workdays)
    where public.count_berlin_workdays(expected.from_day, expected.to_day) is distinct from expected.workdays) <> 0 then
    raise exception 'workdays are not the Monday to Friday days after the first day up to the last';
  end if;
end $$;

-- The rows bypass the write guards and references; each sets what the rules read.
-- Organization A is 27800000-…-0a, organization B 27800000-…-0b.
set local session_replication_role = replica;

-- Follow-ups: F1 open, F2 completed 02-25, F3 cancelled before its due time,
-- F4 and F6 created after 02-22, F5 due after 03-01, FB foreign.
insert into public.client_follow_ups(id,organization_id,client_id,title,due_at,status,completed_at,cancelled_at,owner_user_id,created_by,updated_by,created_at,completed_by,cancelled_by) values
('27800000-0000-4000-8000-000000000101','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000001','Rückruf F1','2026-02-20 09:00+00','open',null,null,'27800000-0000-4000-8000-000000000002','27800000-0000-4000-8000-000000000002','27800000-0000-4000-8000-000000000002','2026-02-10 09:00+00',null,null),
('27800000-0000-4000-8000-000000000102','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000001','Rückruf F2','2026-02-20 09:00+00','completed','2026-02-25 09:00+00',null,'27800000-0000-4000-8000-000000000002','27800000-0000-4000-8000-000000000002','27800000-0000-4000-8000-000000000002','2026-02-10 09:00+00','27800000-0000-4000-8000-000000000002',null),
('27800000-0000-4000-8000-000000000103','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000001','Rückruf F3','2026-02-27 09:00+00','cancelled',null,'2026-02-26 09:00+00','27800000-0000-4000-8000-000000000002','27800000-0000-4000-8000-000000000002','27800000-0000-4000-8000-000000000002','2026-02-10 09:00+00',null,'27800000-0000-4000-8000-000000000002'),
('27800000-0000-4000-8000-000000000104','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000001','Rückruf F4','2026-02-25 09:00+00','open',null,null,'27800000-0000-4000-8000-000000000002','27800000-0000-4000-8000-000000000002','27800000-0000-4000-8000-000000000002','2026-02-24 09:00+00',null,null),
('27800000-0000-4000-8000-000000000105','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000001','Rückruf F5','2026-03-05 09:00+00','open',null,null,'27800000-0000-4000-8000-000000000002','27800000-0000-4000-8000-000000000002','27800000-0000-4000-8000-000000000002','2026-02-10 09:00+00',null,null),
('27800000-0000-4000-8000-000000000106','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000001','Rückruf F6','2026-02-28 09:00+00','open',null,null,'27800000-0000-4000-8000-000000000002','27800000-0000-4000-8000-000000000002','27800000-0000-4000-8000-000000000002','2026-02-26 09:00+00',null,null),
('27800000-0000-4000-8000-000000000107','27800000-0000-4000-8000-00000000000b','27800000-0000-4000-8000-000000000003','Fremd','2026-02-20 09:00+00','open',null,null,'27800000-0000-4000-8000-000000000004','27800000-0000-4000-8000-000000000004','27800000-0000-4000-8000-000000000004','2026-02-10 09:00+00',null,null);

-- Requests: R1 open since Monday 02-16, R2 closed 02-24, R3 converted 02-25,
-- R4 and R7 received after 02-22, R5 added to work 02-24, R6 in clarification
-- for exactly 3 workdays on 03-01, RB foreign.
insert into public.client_requests(id,organization_id,summary,status,received_at,callback_due_at,closed_at,closed_reason,closed_by,converted_at,converted_by,created_at,updated_at) values
('27800000-0000-4000-8000-000000000201','27800000-0000-4000-8000-00000000000a','Heizung R1','offen','2026-02-16 08:00+00','2026-02-17 08:00+00',null,null,null,null,null,'2026-02-16 08:00+00','2026-02-16 08:00+00'),
('27800000-0000-4000-8000-000000000202','27800000-0000-4000-8000-00000000000a','Heizung R2','geschlossen','2026-02-18 08:00+00',null,'2026-02-24 08:00+00','sonstiges','27800000-0000-4000-8000-000000000002',null,null,'2026-02-18 08:00+00','2026-02-24 08:00+00'),
('27800000-0000-4000-8000-000000000203','27800000-0000-4000-8000-00000000000a','Heizung R3','umgewandelt','2026-02-09 08:00+00','2026-02-20 08:00+00',null,null,null,'2026-02-25 08:00+00','27800000-0000-4000-8000-000000000002','2026-02-09 08:00+00','2026-02-25 08:00+00'),
('27800000-0000-4000-8000-000000000204','27800000-0000-4000-8000-00000000000a','Heizung R4','offen','2026-02-27 08:00+00','2026-02-27 11:00+00',null,null,null,null,null,'2026-02-27 08:00+00','2026-02-27 08:00+00'),
('27800000-0000-4000-8000-000000000205','27800000-0000-4000-8000-00000000000a','Heizung R5','hinzugefuegt','2026-02-02 08:00+00',null,null,null,null,null,null,'2026-02-02 08:00+00','2026-03-10 08:00+00'),
('27800000-0000-4000-8000-000000000206','27800000-0000-4000-8000-00000000000a','Heizung R6','in_klaerung','2026-02-24 08:00+00',null,null,null,null,null,null,'2026-02-24 08:00+00','2026-02-24 08:00+00'),
('27800000-0000-4000-8000-000000000207','27800000-0000-4000-8000-00000000000a','Heizung R7','offen','2026-02-26 08:00+00','2026-02-26 11:00+00',null,null,null,null,null,'2026-02-26 08:00+00','2026-02-26 08:00+00'),
('27800000-0000-4000-8000-000000000208','27800000-0000-4000-8000-00000000000b','Fremd','offen','2026-02-02 08:00+00','2026-02-03 08:00+00',null,null,null,null,null,'2026-02-02 08:00+00','2026-02-02 08:00+00');
insert into public.work_request_entries(id,organization_id,request_id,job_id,summary,attempt_key,created_by,created_at) values
('27800000-0000-4000-8000-000000000209','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000205','27800000-0000-4000-8000-000000000501','Heizung R5','27800000-0000-4000-8000-000000000209','27800000-0000-4000-8000-000000000002','2026-02-24 08:00+00');

-- Maintenance: M1 open, M2 completed 02-25, M3 and M7 windows end after 02-22,
-- M4 cancelled 02-24, M5 due 02-15 inside a window until 03-05, M6 window
-- ends on the month end 02-28, MB foreign.
insert into public.maintenance_due_work(id,organization_id,maintenance_plan_id,maintenance_plan_revision_id,original_due_date,due_date,window_start_date,window_end_date,status,job_id,scope_outcome,completed_on,created_by,updated_by,created_at,updated_at,exception_reason) values
('27800000-0000-4000-8000-000000000301','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000011','27800000-0000-4000-8000-000000000012','2026-02-15','2026-02-15','2026-02-10','2026-02-20','open',null,null,null,'27800000-0000-4000-8000-000000000002','27800000-0000-4000-8000-000000000002','2026-02-01 08:00+00','2026-02-01 08:00+00',null),
('27800000-0000-4000-8000-000000000302','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000011','27800000-0000-4000-8000-000000000012','2026-02-14','2026-02-15','2026-02-10','2026-02-20','completed','27800000-0000-4000-8000-000000000509','complete','2026-02-25','27800000-0000-4000-8000-000000000002','27800000-0000-4000-8000-000000000002','2026-02-01 08:00+00','2026-02-25 08:00+00',null),
('27800000-0000-4000-8000-000000000303','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000011','27800000-0000-4000-8000-000000000012','2026-02-20','2026-02-20','2026-02-15','2026-02-27','visit_created','27800000-0000-4000-8000-000000000509',null,null,'27800000-0000-4000-8000-000000000002','27800000-0000-4000-8000-000000000002','2026-02-01 08:00+00','2026-02-01 08:00+00',null),
('27800000-0000-4000-8000-000000000304','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000011','27800000-0000-4000-8000-000000000012','2026-02-05','2026-02-05','2026-02-01','2026-02-10','cancelled',null,null,null,'27800000-0000-4000-8000-000000000002','27800000-0000-4000-8000-000000000002','2026-02-01 08:00+00','2026-02-24 08:00+00','Vertrag beendet'),
('27800000-0000-4000-8000-000000000305','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000011','27800000-0000-4000-8000-000000000012','2026-02-13','2026-02-15','2026-02-01','2026-03-05','open',null,null,null,'27800000-0000-4000-8000-000000000002','27800000-0000-4000-8000-000000000002','2026-02-01 08:00+00','2026-02-01 08:00+00',null),
('27800000-0000-4000-8000-000000000306','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000011','27800000-0000-4000-8000-000000000012','2026-02-25','2026-02-25','2026-02-20','2026-02-28','open',null,null,null,'27800000-0000-4000-8000-000000000002','27800000-0000-4000-8000-000000000002','2026-02-01 08:00+00','2026-02-01 08:00+00',null),
('27800000-0000-4000-8000-000000000307','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000011','27800000-0000-4000-8000-000000000012','2026-02-24','2026-02-24','2026-02-20','2026-02-26','open',null,null,null,'27800000-0000-4000-8000-000000000002','27800000-0000-4000-8000-000000000002','2026-02-01 08:00+00','2026-02-01 08:00+00',null),
('27800000-0000-4000-8000-000000000308','27800000-0000-4000-8000-00000000000b','27800000-0000-4000-8000-000000000013','27800000-0000-4000-8000-000000000014','2026-02-05','2026-02-05','2026-02-01','2026-02-10','open',null,null,null,'27800000-0000-4000-8000-000000000004','27800000-0000-4000-8000-000000000004','2026-02-01 08:00+00','2026-02-01 08:00+00',null);

-- Blockers: B1 open, B2 resolved 02-25, B3 review due on 02-22 itself,
-- B4 parking reviewed 02-27, B5 created 02-25, BB foreign.
insert into public.work_blockers(id,organization_id,job_id,kind,state,next_review_date,resolved_at,created_at,updated_at,reason,responsible_employee_record_id,resolved_by,resolution_note) values
('27800000-0000-4000-8000-000000000401','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000501','blocker','open','2026-02-20',null,'2026-02-01 08:00+00','2026-02-01 08:00+00','material','27800000-0000-4000-8000-000000000008',null,null),
('27800000-0000-4000-8000-000000000402','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000501','blocker','resolved','2026-02-20','2026-02-25 08:00+00','2026-02-01 08:00+00','2026-02-25 08:00+00','material','27800000-0000-4000-8000-000000000008','27800000-0000-4000-8000-000000000002','Material ist da'),
('27800000-0000-4000-8000-000000000403','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000502','blocker','open','2026-02-22',null,'2026-02-01 08:00+00','2026-02-01 08:00+00','material','27800000-0000-4000-8000-000000000008',null,null),
('27800000-0000-4000-8000-000000000404','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000503','parking','open','2026-02-27',null,'2026-02-01 08:00+00','2026-02-01 08:00+00','material','27800000-0000-4000-8000-000000000008',null,null),
('27800000-0000-4000-8000-000000000405','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000504','blocker','open','2026-02-10',null,'2026-02-25 08:00+00','2026-02-25 08:00+00','material','27800000-0000-4000-8000-000000000008',null,null),
('27800000-0000-4000-8000-000000000406','27800000-0000-4000-8000-00000000000b','27800000-0000-4000-8000-000000000510','blocker','open','2026-02-10',null,'2026-02-01 08:00+00','2026-02-01 08:00+00','material','27800000-0000-4000-8000-000000000008',null,null);

-- Jobs finished on site (state events) and their handovers:
-- J1 finished Monday 02-23, released 02-24; J2 finished 02-16, released 02-26;
-- J3 finished Wednesday 02-25 and J4 Monday 02-23, both waiting; J5 finished
-- 02-24 and back in progress 02-26; J6 finished 02-17, released 02-18 and
-- again 02-26; J7 finished 02-02, handed over 02-04 and withdrawn 02-24, which
-- finishes nothing; JB foreign, waiting.
insert into public.work_execution_events(id,organization_id,job_id,event_type,from_state,to_state,gate_fingerprint,previous_version,resulting_version,created_at) values
('27800000-0000-4000-8000-000000000601','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000501','transitioned','in_progress','execution_complete','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',1,2,'2026-02-23 09:00+00'),
('27800000-0000-4000-8000-000000000602','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000502','transitioned','in_progress','execution_complete','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',1,2,'2026-02-16 09:00+00'),
('27800000-0000-4000-8000-000000000603','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000503','transitioned','in_progress','execution_complete','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',1,2,'2026-02-25 09:00+00'),
('27800000-0000-4000-8000-000000000604','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000504','transitioned','in_progress','execution_complete','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',1,2,'2026-02-23 09:00+00'),
('27800000-0000-4000-8000-000000000605','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000505','transitioned','in_progress','execution_complete','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',1,2,'2026-02-24 09:00+00'),
('27800000-0000-4000-8000-000000000606','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000505','reopened','execution_complete','in_progress','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',2,3,'2026-02-26 09:00+00'),
('27800000-0000-4000-8000-000000000607','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000506','transitioned','in_progress','execution_complete','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',1,2,'2026-02-17 09:00+00'),
('27800000-0000-4000-8000-000000000609','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000507','transitioned','in_progress','execution_complete','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',1,2,'2026-02-02 09:00+00'),
('27800000-0000-4000-8000-000000000610','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000507','handed_over','execution_complete','handed_over','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',2,3,'2026-02-04 09:00+00'),
('27800000-0000-4000-8000-000000000611','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000507','handover_withdrawn','handed_over','execution_complete','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',3,4,'2026-02-24 09:00+00'),
('27800000-0000-4000-8000-000000000608','27800000-0000-4000-8000-00000000000b','27800000-0000-4000-8000-000000000510','transitioned','in_progress','execution_complete','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',1,2,'2026-02-16 09:00+00');
insert into public.work_handover_packages(id,organization_id,job_id,state,created_by,updated_by) values
('27800000-0000-4000-8000-000000000701','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000501','released','27800000-0000-4000-8000-000000000002','27800000-0000-4000-8000-000000000002'),
('27800000-0000-4000-8000-000000000702','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000502','released','27800000-0000-4000-8000-000000000002','27800000-0000-4000-8000-000000000002'),
('27800000-0000-4000-8000-000000000707','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000507','reopened','27800000-0000-4000-8000-000000000002','27800000-0000-4000-8000-000000000002'),
('27800000-0000-4000-8000-000000000706','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000506','released','27800000-0000-4000-8000-000000000002','27800000-0000-4000-8000-000000000002');
insert into public.work_handover_releases(id,organization_id,package_id,request_id,release_number,commercial_readiness,content_hash,gate_fingerprint,gate_snapshot,package_document_id,renderer_version,responsibility_snapshot,target_snapshot,reviewed_by,reviewed_at) values
('27800000-0000-4000-8000-000000000711','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000701','27800000-0000-4000-8000-000000000721',1,'not_ready','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','{}','27800000-0000-4000-8000-000000000731','1','{}','{}','27800000-0000-4000-8000-000000000002','2026-02-24 09:00+00'),
('27800000-0000-4000-8000-000000000712','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000702','27800000-0000-4000-8000-000000000722',1,'not_ready','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','{}','27800000-0000-4000-8000-000000000732','1','{}','{}','27800000-0000-4000-8000-000000000002','2026-02-26 09:00+00'),
('27800000-0000-4000-8000-000000000716','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000706','27800000-0000-4000-8000-000000000726',1,'not_ready','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','{}','27800000-0000-4000-8000-000000000736','1','{}','{}','27800000-0000-4000-8000-000000000002','2026-02-18 09:00+00'),
('27800000-0000-4000-8000-000000000718','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000707','27800000-0000-4000-8000-000000000728',1,'not_ready','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','{}','27800000-0000-4000-8000-000000000738','1','{}','{}','27800000-0000-4000-8000-000000000002','2026-02-04 09:00+00'),
('27800000-0000-4000-8000-000000000717','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000706','27800000-0000-4000-8000-000000000727',2,'not_ready','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','{}','27800000-0000-4000-8000-000000000737','1','{}','{}','27800000-0000-4000-8000-000000000002','2026-02-26 10:00+00');

-- Work reports: J1 approved, J2 approved, J3 rejected, J4 submitted, J5 draft,
-- J6 a site diary only.
insert into public.work_artifacts(id,organization_id,job_id,kind,status,created_by) values
('27800000-0000-4000-8000-000000000801','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000501','work_report','approved','27800000-0000-4000-8000-000000000002'),
('27800000-0000-4000-8000-000000000802','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000502','work_report','approved','27800000-0000-4000-8000-000000000002'),
('27800000-0000-4000-8000-000000000803','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000503','work_report','rejected','27800000-0000-4000-8000-000000000002'),
('27800000-0000-4000-8000-000000000804','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000504','work_report','submitted','27800000-0000-4000-8000-000000000002'),
('27800000-0000-4000-8000-000000000805','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000505','work_report','draft','27800000-0000-4000-8000-000000000002'),
('27800000-0000-4000-8000-000000000806','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000506','site_diary','submitted','27800000-0000-4000-8000-000000000002');

-- Time entries: the week of 02-23 holds three by the person (one more
-- rejected), one by the office and one recovery, the first stamped 00:30 on
-- Monday in Berlin; the week of 02-16 two by the person and two by the
-- office; 00:30 on Monday 03-02 belongs to the next week; EB is foreign.
insert into public.time_entries(id,organization_id,user_id,entry_type,capture_source,status,timestamp) values
('27800000-0000-4000-8000-000000000901','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000005','clock_in','employee','approved','2026-02-22 23:30+00'),
('27800000-0000-4000-8000-000000000902','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000005','clock_out','employee','approved','2026-02-23 16:00+00'),
('27800000-0000-4000-8000-000000000903','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000006','clock_in','employee','pending','2026-02-24 07:00+00'),
('27800000-0000-4000-8000-000000000904','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000006','clock_out','employee','rejected','2026-02-24 15:00+00'),
('27800000-0000-4000-8000-000000000905','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000006','clock_out','manager','approved','2026-02-24 15:30+00'),
('27800000-0000-4000-8000-000000000906','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000005','clock_out','system_recovery','approved','2026-02-27 16:00+00'),
('27800000-0000-4000-8000-000000000907','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000005','clock_in','employee','approved','2026-03-01 23:30+00'),
('27800000-0000-4000-8000-000000000908','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000005','clock_in','employee','approved','2026-02-17 07:00+00'),
('27800000-0000-4000-8000-000000000909','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000005','clock_out','employee','approved','2026-02-17 15:00+00'),
('27800000-0000-4000-8000-000000000910','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000006','clock_in','manager','approved','2026-02-18 07:00+00'),
('27800000-0000-4000-8000-000000000911','27800000-0000-4000-8000-00000000000a','27800000-0000-4000-8000-000000000006','clock_out','manager','approved','2026-02-18 15:00+00'),
('27800000-0000-4000-8000-000000000912','27800000-0000-4000-8000-00000000000b','27800000-0000-4000-8000-000000000007','clock_in','manager','approved','2026-02-24 07:00+00');

set local session_replication_role = origin;

do $$ declare
  v_weeks jsonb := public.read_weekly_outcome_numbers('27800000-0000-4000-8000-00000000000a', '2026-03-01', 3);
begin
  if jsonb_array_length(v_weeks) is distinct from 3
     or v_weeks#>>'{0,weekStart}' is distinct from '2026-02-09'
     or v_weeks#>>'{2,weekStart}' is distinct from '2026-02-23'
     or v_weeks#>>'{2,lastDay}' is distinct from '2026-03-01' then
    raise exception 'the weeks are not the last ones up to the given day, Monday to Sunday, oldest first: %', v_weeks;
  end if;

  if v_weeks#>'{1,overdue}' is distinct from
       '{"followUps": 2, "requestCallbacks": 2, "maintenance": 3, "staleRequests": 3, "waitingHandovers": 1, "blockerReviews": 2}'::jsonb then
    raise exception 'K2 does not count the overdue items as they stood at the end of Sunday 02-22: %', v_weeks#>'{1,overdue}';
  end if;
  if v_weeks#>'{2,overdue}' is distinct from
       '{"followUps": 3, "requestCallbacks": 3, "maintenance": 4, "staleRequests": 1, "waitingHandovers": 2, "blockerReviews": 4}'::jsonb then
    raise exception 'K2 does not count the overdue items as they stood at the end of Sunday 03-01: %', v_weeks#>'{2,overdue}';
  end if;

  if v_weeks#>'{2,handover}' is distinct from '{"released": 2, "medianWorkdays": 4.5, "withinTwoWorkdays": 1}'::jsonb then
    raise exception 'T2 does not measure the workdays from the last finish to the first release of the week: %', v_weeks#>'{2,handover}';
  end if;
  if v_weeks#>'{1,handover}' is distinct from '{"released": 1, "medianWorkdays": 1, "withinTwoWorkdays": 1}'::jsonb then
    raise exception 'T2 counts a release in another week than its own: %', v_weeks#>'{1,handover}';
  end if;

  if v_weeks#>'{2,workReports}' is distinct from '{"finished": 4, "withReport": 2}'::jsonb
     or v_weeks#>'{1,workReports}' is distinct from '{"finished": 2, "withReport": 1}'::jsonb then
    raise exception 'A1 does not share the jobs finished in the week with a submitted or approved work report: %', v_weeks;
  end if;

  if v_weeks#>'{2,timeCapture}' is distinct from '{"entries": 5, "byEmployee": 3}'::jsonb
     or v_weeks#>'{1,timeCapture}' is distinct from '{"entries": 4, "byEmployee": 2}'::jsonb then
    raise exception 'A2 does not share the week''s entries the person recorded, by Berlin week: %', v_weeks;
  end if;

  if v_weeks->0 is distinct from jsonb_build_object(
       'weekStart', '2026-02-09', 'lastDay', '2026-02-15',
       'overdue', public.count_overdue_items_at('27800000-0000-4000-8000-00000000000a', '2026-02-15'),
       'handover', '{"released": 0, "medianWorkdays": null, "withinTwoWorkdays": 0}'::jsonb,
       'workReports', '{"finished": 0, "withReport": 0}'::jsonb,
       'timeCapture', '{"entries": 0, "byEmployee": 0}'::jsonb) then
    raise exception 'a week without finished jobs or entries does not report zero and no median: %', v_weeks->0;
  end if;
end $$;

do $$ declare
  v_weeks jsonb := public.read_weekly_outcome_numbers('27800000-0000-4000-8000-00000000000b', '2026-03-01', 1);
begin
  if v_weeks->0 is distinct from jsonb_build_object(
       'weekStart', '2026-02-23', 'lastDay', '2026-03-01',
       'overdue', '{"followUps": 1, "requestCallbacks": 1, "maintenance": 1, "staleRequests": 1, "waitingHandovers": 1, "blockerReviews": 1}'::jsonb,
       'handover', '{"released": 0, "medianWorkdays": null, "withinTwoWorkdays": 0}'::jsonb,
       'workReports', '{"finished": 0, "withReport": 0}'::jsonb,
       'timeCapture', '{"entries": 1, "byEmployee": 0}'::jsonb) then
    raise exception 'one organization''s numbers count another organization''s rows: %', v_weeks->0;
  end if;
end $$;

do $$ begin
  if (select count(*) from (values
      ('public.count_berlin_workdays(date,date)'),
      ('public.berlin_day_end_or_now(date)'),
      ('public.count_overdue_items_at(uuid,date)'),
      ('public.measure_handover_turnaround(uuid,timestamptz,timestamptz)'),
      ('public.measure_work_report_share(uuid,timestamptz,timestamptz)'),
      ('public.measure_own_time_capture_share(uuid,timestamptz,timestamptz)'),
      ('public.read_weekly_outcome_numbers(uuid,date,integer)')
    ) as fn(signature)
    where has_function_privilege('anon', fn.signature, 'execute')
       or has_function_privilege('authenticated', fn.signature, 'execute')
       or not has_function_privilege('service_role', fn.signature, 'execute')) <> 0 then
    raise exception 'a weekly number function is executable by a client role or not by the service role';
  end if;
end $$;

rollback;
