# Generation Task Contract

## Scenario: Asynchronous generation tasks and records

### 1. Scope / Trigger

- Apply this contract whenever creating, polling, cancelling, listing, or deleting image, video, audio, or text generation tasks.
- Apply it to worker execution failures and provider response parsing; asynchronous failures have no request error handler to log them.
- The `generation_tasks` table is the persistence source, but task execution and generation records are separate API projections.

### 2. Signatures

```text
POST   /api/generations/tasks
POST   /api/generations/text/stream
GET    /api/generations/tasks/:id
POST   /api/generations/tasks/:id/cancel
GET    /api/generations/records?kind=<kind>&page=<page>&pageSize=<size>
DELETE /api/generations/records/:id
startGenerationWorker(app.log)
```

Task states:

```text
queued | running | succeeded | failed | cancelled
```

### 3. Contracts

- Task creation returns only `{ id, status: "queued" }`.
- `POST /api/generations/text/stream` is authenticated, accepts `prompt`, `channelId`, `model`, and `config`, and directly proxies OpenAI Responses SSE to the browser. It never creates a `generation_tasks` row or exposes the channel API Key.
- The stream request explicitly uses `stream: true` and `Accept: text/event-stream`; client disconnection aborts the upstream request.
- Gemini text keeps the asynchronous task path because its stream protocol is outside this contract.
- Task polling returns `{ id, status }` while queued or running, adds `result` only for succeeded tasks, and adds `error` only for failed or cancelled tasks.
- Task queries select only `id`, `status`, `result`, and `error` from PostgreSQL.
- Cancellation returns only `{ id, status }`. A queued task becomes cancelled immediately; a running task sets the internal cancellation flag and remains running until the worker marks it cancelled.
- Record listing returns only fields required by image/video history restoration: `id`, `kind`, `status`, `prompt`, `model`, `config`, `references`, `result`, `error`, `createdAt`, `updatedAt`, `startedAt`, and `completedAt`.
- Normal APIs never expose `userId`, `storageBackendId`, channel identity, provider task state, provider request/response payloads, cancellation flags, or deletion metadata.
- Records may include queued/running tasks so video pages can resume polling after refresh.
- Only succeeded, failed, or cancelled records can be deleted. Deleting a record is logical deletion only and never deletes generated files.
- Old `/api/generations` collection/item routes have no compatibility layer.
- The application logger is injected into the generation worker. Every failed task logs a redacted `err` projection plus `taskId`, `kind`, `channelId`, and `model` at error level before the task is persisted as failed.
- Task failure messages unwrap a generic `fetch failed` through the standard `Error.cause` chain, redact credential-like values, and remain bounded before being stored in `generation_tasks.error`.
- Provider non-2xx errors include the HTTP status and an available safe JSON or text reason. Provider request bodies, prompts, references, request headers, and credentials are never logged.
- Every failed task and worker tick failure also writes the original error to the process console. HTTP response errors include the complete response URL, status, headers, and body there only; the raw response is not sent to Pino or persisted to PostgreSQL.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Task/record is absent, deleted, or owned by another user | `404 生成任务不存在` |
| Cancel a succeeded, failed, or cancelled task | `409 当前任务状态不能取消` |
| Delete a queued or running record | `409 请先取消生成任务` |
| Poll a queued or running task | Return no prompt, config, references, result, or provider fields |
| Poll a succeeded task | Return `result` and no `error` field |
| Poll a failed or cancelled task | Return `error` and no `result` field |
| `fetch` fails with a network `cause` | Store a safe message containing the underlying DNS, connection, TLS, or timeout reason |
| Provider returns non-2xx JSON or text | Store the HTTP status plus a bounded, redacted provider reason |
| Provider returns invalid JSON with 2xx | Fail with an explicit invalid JSON response message |
| Operator inspects container console after an HTTP response error | Receive complete response URL, status, headers, and body |
| OpenAI text stream client disconnects | Abort upstream stream without creating a generation task |

### 5. Good/Base/Bad Cases

- Good: a 1.2-second polling loop receives only task identity and state until the terminal response.
- Good: an OpenAI text node receives `response.output_text.delta` directly through the authenticated SSE proxy and updates without polling.
- Good: the records list restores image/video history and resumes an unfinished video task without exposing provider debug data.
- Base: deleting a failed record hides it from history but leaves generated/storage files untouched.
- Bad: `db.select().from(generationTasks)` in a normal API route, because it exposes internal fields and can repeatedly transfer large JSON payloads.
- Bad: deleting a running record while its worker continues consuming resources.
- Good: `TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED ...") })` produces a task error containing the connection reason and a structured Docker log keyed by task ID.
- Bad: persisting only `error.message` in a background worker, because Undici keeps the actionable network reason in `error.cause` and no Fastify request handler will log the exception.
- Good: wrap an HTTP response in `ProviderResponseError` and print it with `console.error`, while `logError` and `taskErrorMessage` consume only the bounded, redacted message.

### 6. Tests Required

- API: assert create returns only `id` and `queued`.
- API: assert queued/running polls omit `result`, `error`, prompt, config, references, and internal fields.
- API: assert succeeded polls contain `result`; failed/cancelled polls contain `error`.
- API: assert records contain every history restoration field and omit every internal field.
- API: assert deleting queued/running returns `409`, while terminal deletion hides the record without deleting its file.
- Frontend: assert image, video, audio, text, and canvas consumers handle the discriminated task state.
- Stream: assert OpenAI text parses split SSE blocks and `response.output_text.delta`, while Gemini continues to use the text task endpoint.
- Frontend: assert video refresh still resumes unfinished records.
- Worker: assert generic fetch failures preserve a redacted cause, non-2xx responses preserve status and provider reason, and invalid JSON cannot replace the original HTTP failure.
- Logging: assert task failures use the injected logger with `err`, task identity, kind, channel, and model while excluding request payloads and credentials.
- Logging: assert a non-JSON or non-2xx HTTP response appears in the container console with its full response diagnostics but remains redacted and bounded in Pino and `generation_tasks.error`.

### 7. Wrong vs Correct

#### Wrong

```ts
const [task] = await db.select().from(generationTasks).where(where);
return ok(task);
```

This couples the API to the database row and leaks large/internal fields into every poll.

#### Correct

```ts
const [task] = await db
    .select({ id: generationTasks.id, status: generationTasks.status, result: generationTasks.result, error: generationTasks.error })
    .from(generationTasks)
    .where(where);
return ok(taskStateResponse(task));
```

The API projection owns the public contract and returns only state-dependent fields.

#### Wrong: background task failure

```ts
catch (error) {
    await markFailed(task.id, error instanceof Error ? error.message : "生成失败");
}
```

This loses `fetch` causes and emits no log because the failure occurs outside a Fastify request lifecycle.

#### Correct: background task failure

```ts
catch (error) {
    logger.error({ err: logError(error), taskId: task.id, kind: task.kind, channelId: task.channelId, model: task.model }, "generation task failed");
    await markFailed(task.id, taskErrorMessage(error));
}
```

The structured log retains stack/cause for operators, while the persisted message is bounded and safe for the existing task API.
