# Technical Design

## Scope

This task delivers one cohesive cross-layer capability:

1. Instance-level selectable local or S3-compatible file storage.
2. Per-file binding to a concrete storage backend so historical files remain readable after configuration changes.
3. A storage configuration UI and explicit global save behavior for all visible configuration tabs.

The work stays in one task because uploads, generated files, access URLs, configuration persistence, and unsaved-draft behavior share the same release boundary.

## Database Model

### `storage_backends`

Store concrete backend configurations as durable records:

- `id`: stable text identifier.
- `name`: required administrator-facing label.
- `type`: `local` or `s3`.
- `endpoint`, `public_endpoint`, `region`, `bucket`.
- `access_key_id`, `secret_access_key`.
- `object_prefix`, `force_path_style`.
- `is_active`: current default backend for new writes.
- `created_at`, `updated_at`.

The local backend has one stable record and reads its actual path from `UPLOAD_DIR`; the path is not editable in the database or UI.

Backend lifecycle is explicit:

- “Add backend” creates a new record and ID.
- “Edit backend” updates the selected record.
- Selecting an existing backend as default only changes active state.
- Creating a backend never activates it implicitly; activation is an explicit draft choice applied by global Save.
- Backends referenced by files lock bucket and object prefix, but allow credential, endpoint, public endpoint, region and path-style repair.
- Unreferenced backends may be fully edited or deleted.
- Mark exactly one backend active in the same database transaction.
- Keep referenced inactive backends because existing files depend on them.

### `files.storage_backend_id`

Add a non-null foreign key to `storage_backends.id`. Migration order:

1. Create `storage_backends`.
2. Insert the stable local backend.
3. Add nullable `files.storage_backend_id`.
4. Assign all existing files to the local backend.
5. Make the column non-null and add its index/foreign key.

`files.path` remains a relative local path or S3 object key. `storageKey` remains unchanged.

### `generation_tasks.storage_backend_id`

Add a non-null backend reference captured when the task is created. Workers save generated results to this pinned backend even if the instance default changes while the task is running. Existing tasks are backfilled to the local backend.

## Backend Storage Boundary

Introduce a storage service that owns backend dispatch. File routes and workers must not call local filesystem helpers directly.

Core operations:

```text
storeTempFile(backend, path, tempPath, metadata)
storeBuffer(backend, path, buffer, metadata)
readBuffer(backend, path)
getAccessUrl(backend, file, expiresAt)
```

### Local driver

- Reuse the current disk implementation and `EXDEV` copy fallback.
- Return the existing signed `/api/files/:storageKey/content` URL.
- Stream local content with range support through the content route.

### S3 driver

- Use `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`.
- Support AWS S3 and MinIO through endpoint, region and path-style options.
- Use the configured internal endpoint for object operations.
- Use `public_endpoint` for browser-facing presigned URLs when provided; otherwise use `endpoint`/standard AWS resolution.
- Upload browser temporary files as streams with known content length and generated buffers directly.
- Read reference media into a Buffer for generation providers.
- Keep browser uploads server-mediated so existing validation, hashing and database creation remain authoritative.

### File access contract

`GET /api/files/:storageKey/access-url` remains the only frontend entry point:

- Query the owned file and its bound backend.
- Local: return a signed app content URL.
- S3: return a presigned GET URL.

`GET /api/files/:storageKey/content` is local-only and rejects non-local files.

Logical deletion behavior remains unchanged; physical object cleanup and reference-aware garbage collection are out of scope.

## Storage Configuration API

Add an admin-only storage module and a reusable `requireAdmin` hook.

Endpoints:

```text
GET  /api/storage/config
PUT  /api/storage/config
POST /api/storage/debug
```

The read response includes:

- Active storage type.
- Read-only local `UPLOAD_DIR`.
- Current/latest S3 fields.
- Masked secret and `hasSecretAccessKey`; never the stored secret itself.
- Historical S3 backends with masked credentials, active state and referenced file counts.

The update endpoint saves without testing the connection.

The debug endpoint accepts unsaved draft fields. It checks that the bucket exists and permissions allow writing, reading/head, and deleting a temporary object. It never creates a bucket and reports the provider error safely. When the draft omits a secret, the saved secret may be reused only for the matching saved S3 backend. On success it leaves a dedicated debug object briefly and returns a browser-facing presigned URL; the server does not fetch the public endpoint. Schedule best-effort cleanup after roughly ten minutes and never insert the debug object into `files`.

Historical backends remain editable for credential rotation and public endpoint repair. A backend referenced by files cannot be deleted.

## Configuration Draft And Save Model

### Runtime state versus persisted state

- Remove the 700ms persistence timer from `useConfigStore`.
- `updateConfig` continues to update runtime choices used by image/video/canvas workflows but does not call the server.
- `AppConfigPanel` owns draft copies of AI, storage and Codex configuration.
- Editing configuration fields changes only these drafts, not the runtime/persisted stores.
- Image/video workbench parameters become page-local task state and no longer mutate global saved defaults.

### Global save

A fixed global Save button is shown in both the full configuration page and modal. One click starts all applicable saves:

- AI channels/models/preferences to the existing server API.
- Storage settings to the admin API when the user is an admin.
- Codex URL/token/confirmation settings to browser persistence.

Use section-level results rather than claiming cross-system transactionality. Successful sections update their saved baselines; failed sections keep their drafts and dirty state. Display specific errors and an overall success only when every applicable section succeeds.

### Existing configuration actions

- Model refresh must use the current channel draft without implicitly saving it. Add/refactor an API accepting draft channel fields and optionally reusing a saved secret for the same channel.
- S3 debug uses the storage draft and never saves.
- Codex Connect/Disconnect remains immediate and can use draft URL/token, but only Save writes persistent browser values.

### Unsaved-change protection

- Aggregate dirty state across AI, storage and Codex drafts.
- Switching tabs preserves drafts.
- Closing the modal or leaving `/config` with dirty state asks for confirmation.
- “Continue editing” keeps drafts; “Discard” restores saved baselines and then closes/navigates.
- Add a browser `beforeunload` guard for refresh/tab close.

## UI

Add a visible `storage` tab for admins only.

Controls:

- Storage mode segmented control: local / S3.
- Default backend selector when S3 mode is selected; adding a backend does not select or activate it automatically.
- Read-only local upload path.
- S3 endpoint, optional public endpoint, region, bucket, access key, secret key, object prefix, path-style switch.
- Debug connection button with loading and detailed result.
- Debug result with a copy/open action for the temporary presigned URL.
- Masked secret placeholder consistent with AI API Key behavior.
- Collapsible historical S3 backend list with file counts, debug and credential repair actions.

Keep one fixed Save command outside individual tabs. Replace the misleading “Done means saved” behavior.

## Compatibility And Rollback

- Existing rows are assigned to the local backend by migration and continue to resolve through the current content route.
- Frontend storage keys and media data structures do not change.
- Switching back to local affects only new writes.
- S3 write failures are returned to the caller and never silently fall back to local storage.
- In-flight generation tasks keep their backend selected at task creation.
- Rolling back application code after the migration remains possible because `files.path` and local files are unchanged, but files written to S3 after rollout require the new code to read.
- Historical backend rows must not be deleted while referenced by files.

## Security Notes

- Storage configuration endpoints are admin-only.
- S3 secret follows the existing AI API Key policy: plaintext in PostgreSQL, masked in API responses.
- Presigned URLs use short configured expiry and are generated only after file ownership validation.
- Provider errors shown by debug must not include secret values or authorization headers.
