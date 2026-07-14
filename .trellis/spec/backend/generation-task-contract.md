# Generation Task Contract

## Scenario: Asynchronous generation tasks and records

### 1. Scope / Trigger

- Apply this contract whenever creating, polling, cancelling, listing, or deleting image, video, audio, or text generation tasks.
- The `generation_tasks` table is the persistence source, but task execution and generation records are separate API projections.

### 2. Signatures

```text
POST   /api/generations/tasks
GET    /api/generations/tasks/:id
POST   /api/generations/tasks/:id/cancel
GET    /api/generations/records?kind=<kind>&page=<page>&pageSize=<size>
DELETE /api/generations/records/:id
```

Task states:

```text
queued | running | succeeded | failed | cancelled
```

### 3. Contracts

- Task creation returns only `{ id, status: "queued" }`.
- Task polling returns `{ id, status }` while queued or running, adds `result` only for succeeded tasks, and adds `error` only for failed or cancelled tasks.
- Task queries select only `id`, `status`, `result`, and `error` from PostgreSQL.
- Cancellation returns only `{ id, status }`. A queued task becomes cancelled immediately; a running task sets the internal cancellation flag and remains running until the worker marks it cancelled.
- Record listing returns only fields required by image/video history restoration: `id`, `kind`, `status`, `prompt`, `model`, `config`, `references`, `result`, `error`, `createdAt`, `updatedAt`, `startedAt`, and `completedAt`.
- Normal APIs never expose `userId`, `storageBackendId`, channel identity, provider task state, provider request/response payloads, cancellation flags, or deletion metadata.
- Records may include queued/running tasks so video pages can resume polling after refresh.
- Only succeeded, failed, or cancelled records can be deleted. Deleting a record is logical deletion only and never deletes generated files.
- Old `/api/generations` collection/item routes have no compatibility layer.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Task/record is absent, deleted, or owned by another user | `404 生成任务不存在` |
| Cancel a succeeded, failed, or cancelled task | `409 当前任务状态不能取消` |
| Delete a queued or running record | `409 请先取消生成任务` |
| Poll a queued or running task | Return no prompt, config, references, result, or provider fields |
| Poll a succeeded task | Return `result` and no `error` field |
| Poll a failed or cancelled task | Return `error` and no `result` field |

### 5. Good/Base/Bad Cases

- Good: a 1.2-second polling loop receives only task identity and state until the terminal response.
- Good: the records list restores image/video history and resumes an unfinished video task without exposing provider debug data.
- Base: deleting a failed record hides it from history but leaves generated/storage files untouched.
- Bad: `db.select().from(generationTasks)` in a normal API route, because it exposes internal fields and can repeatedly transfer large JSON payloads.
- Bad: deleting a running record while its worker continues consuming resources.

### 6. Tests Required

- API: assert create returns only `id` and `queued`.
- API: assert queued/running polls omit `result`, `error`, prompt, config, references, and internal fields.
- API: assert succeeded polls contain `result`; failed/cancelled polls contain `error`.
- API: assert records contain every history restoration field and omit every internal field.
- API: assert deleting queued/running returns `409`, while terminal deletion hides the record without deleting its file.
- Frontend: assert image, video, audio, text, and canvas consumers handle the discriminated task state.
- Frontend: assert video refresh still resumes unfinished records.

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
