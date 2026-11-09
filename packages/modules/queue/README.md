# Queue

Runs background work out of Postgres. It leases jobs to the worker, retries them, runs schedules, and keeps what keeps
failing as dead letters. It doesn't know what a job does: each job lives in the module it belongs to.

Table, metric and failure names still use the old wording, as do the two `pg_notify` channels
(`refresh_operations_wakeup` and `refresh_operations_player_refresh_settled`). Migration ids keep their
`refresh-operations/` prefix for good, because every migrated database has them on record. New migrations in this module use that prefix too. It doesn't have to match the module's name.

## What it owns

The `queue` schema. The tables are described in `db/tables.ts`:

- `operations`: one row per job, with its kind, payload, status and lease
- `attempts`: one row per run of a job
- `dead_letter_actions`: who replayed or discarded a dead letter, and why
- `schedules` and `schedule_occurrences`: recurring work and the runs it has created
- `admission_policy` and `admission_classes`: the concurrency limits and each class's credit
- `interactive_refresh_effects`: which sections of an interactive refresh have committed

The migrations in `migrations/` own the defaults, indexes and triggers. Effect tables for a kind belong to the module
that owns the job, not to this schema.

## Layout

- `domain/`: rules with no database code, like which class runs next, and what a failure turns into
- `db/`: `tables.ts` and one file per use case, for example `accept-operation.ts` and `claim-operation.ts`.
  `postgres-queue.ts` and `postgres-dead-letters.ts` bind them to a database.
- `jobs/`: what a job is (`job-definition.ts`), finding one by kind (`job-registry.ts`), and running one
  (`run-one-job.ts`, `run-sections.ts`)
- `lease-fences.ts`: checks that run inside another module's transaction, so its write only commits while the lease
  is held
- `model.ts`: the types and kind lists other modules share
- `operator-auth.ts`: the token check for the dead-letter CLI
- `testing.ts`: helpers for tests, exported as `@brawltome/queue/testing`

## Public surface

Everything other packages may import is exported from `index.ts`:

- `queueModule`: the module object (name and migrations)
- `createPostgresRefreshOperations`: the queue bound to a database, for the API and the worker
- `createPostgresDeadLetterOperations` and `authenticateDeadLetterOperator`: for the dead-letter CLI, with the
  `DeadLetterHooks` types the owners fill in
- `defineJob`, `JobContract`, `JobDefinition`, `Lease` and `JobTools`: for writing a job
- `createJobRegistry` and `runOneJob`: for the worker's dispatch
- `runSections`, `waitForRenewal`, `completeWithProofEffect`: pieces a job can use to run
- `decideSourceFailure`, `decideExecutionFailure`, `JobLeaseLostError`, `SourceAdmissionLimitedError`: to steer what
  happens when a job fails
- `readPayloadObject`, `isPositiveInteger` and the other payload helpers: for a job's `parsePayload`
- `acceptOperation`, `reserveForAdmission`, `reserveForBinding`, and `activateReserved`, `activateAdmitted`,
  `activateBound`, `rejectReserved`, `rejectExpired`: for writing work
- `findActiveOperation`, `listAwaiting`, `countActive`, `readAttemptHistory`, `readEffectLineage`, `operationMatches`:
  for reading it
- `reconcileFixedSchedule`, `reconcileResourceSchedules`, `disableFixedSchedule`: for the planners
- the fences from `lease-fences.ts`
- `model.ts`, re-exported whole

## How a job runs

1. Something writes an operation with `acceptOperation` or one of the `reserve` functions. The write runs the job's
   `parsePayload` first and refuses a payload that doesn't parse.
2. The worker claims the next due row and gets a lease. A row whose kind this release doesn't know, or whose payload
   no longer parses, is dead-lettered with the code `invalid_payload`, and claim moves on to the next one.
3. `run-one-job.ts` renews the lease and calls the job's `run`. The job returns an outcome, or throws and
   `decideFailure` or the default rules choose between retry, defer and dead letter.
4. If a lease expires, the next claim asks the job's `effectState`. `acknowledged` finishes the job without running it.
   Anything else runs it again, so `run` has to cope with work that's already partly saved.

## How to add a job

A job needs no queue migration. The database doesn't check kinds or payloads, so `parsePayload` is the only validation.
If the job saves results of its own, those tables go in the owner's migrations.

1. Add the contract in `packages/modules/<owner>/jobs/<kind>-contract.ts`: the kind, its work classes and
   `parsePayload`.
2. Add the job in `jobs/<kind>-job.ts`, as `create<Name>Job(dependencies)` returning `defineJob({ ...contract,
   failureCode, run })`. `clan/jobs/clan-refresh-job.ts` is a good one to copy. If the job can die after saving its
   result, give it `effectState` and return `acknowledged` once the result is final, so the next claim finishes the job
   instead of running it again.
3. Export both from the owner's `index.ts` and add the job to `createWorkerJobs` in `apps/api/src/worker/job-list.ts`.
   If the owner doesn't use the queue yet, add `queue` to its `dependsOn` and to `capabilityDependencies` in
   `tooling/architecture/src/current-policy.ts`.
4. Add the kind to `allOperationKinds` in `domain/queue-telemetry.ts`, `OperationLease` in `model.ts`, and
   `operationKind` in `packages/telemetry/src/index.ts`. A kind missing from that last list loses its metrics with no
   error. No new kind fits yet: `operation_dead_letters` is at 126 of its 128 series (19 kinds across 6 work classes,
   plus 12 admission series) and a kind adds 6. Dropped series break the dead-letter alert, so raise `maxSeries` first.
5. Test it with `runJobOnce` from `@brawltome/queue/testing`.
6. Ship that. A new kind's job has to ship one release before anything writes that kind. During a deploy the old worker
   is still claiming, and it dead-letters a kind it doesn't know.
7. In the next release, start writing it: a call to `acceptOperation`, or a planner in
   `apps/api/src/worker/planners.ts` if it runs on a schedule. A scheduled job also goes in `scheduledKinds` in
   `domain/queue-telemetry.ts`, or `schedule_lateness_ms` never reports it.
