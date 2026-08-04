# Golden-Gate Run Log

Append-only record of golden-gate runs, newest first, as required by the roadmap's gate protocol. Record: date, gate, commit/build, environment, fixtures, result, evidence, defects, and anything deliberately skipped.

| Date | Gate | Commit / build | Environment | Fixtures | Result | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-08-04 | `GG-00` (automated v1) | Working tree at harness introduction (committed with the harness) | Local `bun start` production build + live Supabase (EU) + R2 `werkflow-documents-prod` | Disposable world `msf0xf6r`: Golden Test org (admin/Büro/employee) + outsider org | **8/8 passed** (72s) | Covered: role logins, customer creation, job creation with employee assignment, employee sees only assigned jobs, 6 MB direct-to-R2 upload on job page, Büro library visibility, employee blocked from `/dokumente` and `/inventar`, cross-organization isolation, sign-out. **Deliberately not yet automated:** invites/onboarding, time tracking, inventory take/return, Realtime freshness, mobile/responsive paths — extend `GG-00` when those areas next change |
