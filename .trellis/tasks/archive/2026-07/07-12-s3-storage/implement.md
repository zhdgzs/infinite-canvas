# Implementation Plan

## 1. Database And Dependencies

- [ ] Add AWS S3 client and presigner dependencies to `server/package.json` and lockfile.
- [ ] Add `storageBackends` and `files.storageBackendId` to the Drizzle schema.
- [ ] Add and backfill `generationTasks.storageBackendId` so tasks pin their creation-time backend.
- [ ] Add `0002_storage_backends.sql` with the local-backend backfill and constraints.
- [ ] Confirm migration preserves every existing `storage_key` and `path`.

## 2. Authentication And Storage Configuration API

- [ ] Add a reusable `requireAdmin` pre-handler based on `request.auth.user.role`.
- [ ] Implement storage configuration schemas, masking and active-backend transaction logic.
- [ ] Add admin-only GET/PUT storage configuration routes.
- [ ] Add the unsaved-draft S3 debug route without bucket creation.
- [ ] Return a temporary-object presigned URL and schedule best-effort debug object cleanup.
- [ ] Add historical-backend listing/update/delete guards with referenced file counts.
- [ ] Implement explicit add/edit/activate semantics and lock bucket/object prefix for referenced backends.
- [ ] Ensure newly created backends remain inactive until an explicit default selection is globally saved.
- [ ] Register the new routes in the Fastify app.

## 3. Storage Drivers

- [ ] Define the shared storage backend/service contract.
- [ ] Adapt current local storage to the contract, preserving EXDEV fallback and metadata extraction.
- [ ] Implement S3/MinIO put/read/presign operations.
- [ ] Include `storageBackendId` in stored-file metadata and all file inserts.
- [ ] Centralize active-backend lookup and file-bound backend lookup.

## 4. File And Worker Integration

- [ ] Make browser uploads use the active backend.
- [ ] Make generated buffers use the active backend.
- [ ] Capture the active backend when creating generation tasks and use that pinned backend in workers.
- [ ] Make generation reference reads dispatch by each file's backend.
- [ ] Make `access-url` return local content URLs or S3 presigned URLs by backend.
- [ ] Restrict the content route to local files while preserving range requests.
- [ ] Keep logical deletion behavior unchanged.

## 5. Frontend Storage Configuration

- [ ] Add storage API types/services with masked secret handling.
- [ ] Add the admin-only Storage tab and all required controls.
- [ ] Require a backend display name and show identity/file-count metadata in backend lists.
- [ ] Add the draft-based debug connection action and detailed feedback.
- [ ] Show local `UPLOAD_DIR` read-only.
- [ ] Add collapsible historical backend management with credential repair and deletion guards.

## 6. Explicit Global Save

- [ ] Remove the config autosave timer and separate runtime updates from persistence.
- [ ] Separate image/video workbench task parameters from globally saved defaults.
- [ ] Add AI, storage and Codex draft/baseline state to the configuration panel.
- [ ] Add one fixed global Save button in both modal and page layouts.
- [ ] Save applicable sections, retain failed drafts, and report section-specific errors.
- [ ] Refactor model refresh to use unsaved channel drafts without persisting them.
- [ ] Make Codex connection actions use drafts while browser persistence happens only on Save.
- [ ] Add dirty-state confirmation for modal close, route navigation and browser unload.

## 7. Documentation And Release Records

- [ ] Update Docker/environment documentation for S3/MinIO configuration semantics.
- [ ] Update feature/pending-test documentation according to project rules.
- [ ] Add a concise `CHANGELOG.md` Unreleased entry.

## 8. Static Verification

- [ ] Review all direct `absoluteUploadPath`, `readFile`, `fileStream`, `storeBufferFile` and file insert call sites.
- [ ] Verify all API responses keep secrets masked.
- [ ] Verify non-admin users cannot access storage settings endpoints or the Storage tab.
- [ ] Verify no field change calls storage/AI persistence or localStorage before Save.
- [ ] Verify local and S3 files resolve through the same frontend `access-url` flow.
- [ ] Run `git diff --check` and inspect the final diff. Per project instructions, do not run build, type-check or tests unless explicitly requested.

## Rollback Points

- Database migration: do not remove or rewrite existing `files.path` values.
- Storage rollout: local remains the default until an admin explicitly saves S3 as active.
- UI rollout: preserve the last loaded/saved baseline so failed saves can be retried without losing drafts.
