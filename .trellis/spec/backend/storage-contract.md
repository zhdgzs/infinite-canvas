# Storage Backend Contract

## Scenario: Local and S3-compatible file storage

### 1. Scope / Trigger

- Apply this contract whenever file upload, generated media, reference reads, file access URLs, or storage configuration changes.
- PostgreSQL file metadata is authoritative. A file must bind to the concrete backend that contains its bytes; the current default backend is only a write-time choice.

### 2. Signatures

```text
storage_backends.id                         stable backend identity
files.storage_backend_id                   non-null backend foreign key
generation_tasks.storage_backend_id        non-null backend pinned at task creation

GET  /api/files/:storageKey/access-url
GET  /api/files/:storageKey/content
GET  /api/storage/config                    admin only
PUT  /api/storage/config                    admin only
POST /api/storage/debug                     admin only
```

Storage code must dispatch through `server/src/files/storage.ts`:

```ts
storeMultipartFile(userId, backend, file)
storeBufferFile(userId, backend, buffer, filename, mimeType)
readStoredBuffer(backend, path)
s3AccessUrl(backend, path, expiresIn)
```

### 3. Contracts

- `storage_backends.type` is `local` or `s3`; exactly one row is active.
- The stable local backend ID is `local`; its physical root comes only from `UPLOAD_DIR`.
- `files.path` is a relative disk path for local storage and an object key for S3.
- S3 identity fields are `bucket` and `object_prefix`. Once files or generation tasks reference a backend, these fields are immutable.
- Credential, endpoint, public endpoint, region, and path-style fields may be repaired without changing the backend ID.
- Secret keys are stored in PostgreSQL but omitted from responses. Responses expose only a masked value and `hasSecretAccessKey`; a blank update preserves the stored secret.
- `/access-url` validates file ownership, then returns a signed local `/content` URL or an S3 presigned GET URL.
- `/content` accepts local files only.
- Browser uploads remain server-mediated. Generation tasks pin the active backend when created and workers always use that pinned backend.
- S3 debug uses an unsaved draft, never creates a bucket, tests write/read/delete with the internal endpoint, and returns a separate temporary presigned URL for manual browser verification.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| No active backend | `500 未配置默认存储后端` |
| Non-admin reads or writes storage config | `403` |
| New S3 backend has no secret | `400` |
| Referenced backend changes bucket or prefix | `409` |
| Referenced backend is deleted | `409` |
| S3 write/read/presign fails | Return a specific `502` error; never fall back to local disk |
| `/content` receives an S3 file | `400` |
| Debug bucket is absent or forbidden | Return the provider reason; never create the bucket |

### 5. Good/Base/Bad Cases

- Good: a task created while S3 backend A is active still writes to A after the administrator activates local storage.
- Base: local remains active after migration, and all existing files/tasks are backfilled to backend `local` without changing `storage_key` or `path`.
- Bad: resolving a reference with `join(UPLOAD_DIR, file.path)` without reading `file.storage_backend_id`.
- Bad: creating a new S3 backend implicitly activates it.

### 6. Tests Required

- Migration: assert one active local backend and non-null backfills for every existing file and generation task.
- Upload integration: assert local and S3 writes insert the selected `storage_backend_id` and S3 failure creates no local fallback file.
- Worker integration: create a task, change the active backend, then assert the result uses the task's pinned backend.
- Access integration: assert local returns `/content`, S3 returns a presigned provider URL, and cross-user access is rejected.
- Admin API: assert masking, blank-secret preservation, identity locking, guarded deletion, and non-admin `403` responses.
- Debug integration: assert no bucket creation, probe deletion, temporary URL return, and provider error propagation.

### 7. Wrong vs Correct

#### Wrong

```ts
const buffer = await readFile(join(config.uploadDir, file.path));
const result = await storeBufferFile(task.userId, output);
```

This assumes every file is local and lets a long-running task use whichever backend happens to be active at completion.

#### Correct

```ts
const sourceBackend = await storageBackendById(file.storageBackendId);
const buffer = await readStoredBuffer(sourceBackend, file.path);

const resultBackend = await storageBackendById(task.storageBackendId);
const result = await storeBufferFile(task.userId, resultBackend, output, filename, mimeType);
```
