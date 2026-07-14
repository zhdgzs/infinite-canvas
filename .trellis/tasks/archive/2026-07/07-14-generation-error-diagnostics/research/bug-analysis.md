# Bug Analysis: generation worker failures lost fetch causes and logs

## 1. Root Cause Category

- **Category**: E - Implicit Assumption, with an A - Missing Spec contributor.
- **Specific Cause**: `runTask()` assumed `Error.message` contained the actionable failure reason and assumed normal application logging would cover task execution. Undici stores network diagnostics in `Error.cause`, while this worker runs outside the Fastify request lifecycle, so neither the persisted task error nor Docker logs retained the cause.

## 2. Why Fixes Failed

- No earlier repair existed. During this repair, the first logging draft passed the raw Error to Pino; review found that provider-reflected data or enumerable error properties could violate the no-secret logging requirement. The final boundary logs a redacted Error projection while preserving name, stack, and cause.

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
| --- | --- | --- | --- |
| P0 | Architecture | Inject the Fastify logger into the worker and log every task failure with stable task fields | DONE |
| P0 | Runtime contract | Normalize generic fetch failures through `Error.cause`; include HTTP status and safe provider details | DONE |
| P0 | Documentation | Add worker failure observability and redaction rules to the generation task contract | DONE |
| P1 | Test coverage | Add worker-level cases for fetch cause, JSON/text non-2xx, invalid JSON, and log field redaction when the project introduces backend tests | TODO |

## 4. Systematic Expansion

- **Similar Issues**: Repository search found this generation worker as the only long-running background execution loop. CLI script `console.error` calls are process-boundary reporting and do not share this problem. Request handlers already pass unexpected errors through Fastify logging or explicit safe `AppError` conversion.
- **Design Improvement**: Background executors must receive the application logger explicitly and own both an operator-facing error projection and a bounded user-facing error message.
- **Process Improvement**: When adding background work, review error propagation separately from HTTP request error handling and verify cause-chain retention plus secret redaction.

## 5. Knowledge Capture

- [x] Updated `.trellis/spec/backend/generation-task-contract.md` with signatures, contracts, error cases, required tests, and wrong/correct examples.
- [x] Recorded the root cause and prevention actions in this task.
- [ ] No template sync is applicable in this application repository.
- [ ] No commit is performed because project instructions prohibit unrequested commits.
