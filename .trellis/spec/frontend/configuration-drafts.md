# Configuration Draft Contract

## Scenario: Explicit global configuration save

### 1. Scope / Trigger

- Apply when adding or changing any visible AI, storage, or Codex setting.
- Configuration controls edit component-local drafts. Field changes must not persist or alter global runtime defaults before Save succeeds.

### 2. Signatures

```text
AppConfigPanel draft -> saveConfigDraft(draft) -> PUT /api/ai/config
Storage draft        -> saveStorageConfig(...) -> PUT /api/storage/config
Codex draft          -> localStorage only during the global Save action
```

### 3. Contracts

- One fixed Save command persists all applicable visible sections.
- Section saves are not a distributed transaction: successful sections update their baselines, failed sections retain their drafts.
- AI model refresh and S3 debug consume unsaved drafts without saving them.
- Closing, internal navigation, and browser unload must warn when any section differs from its saved baseline.
- Discard restores the latest saved AI, storage, and Codex baselines.
- Image/video workbench task parameters are page-local; they may read saved channel/model options but must not call the global config updater.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Save succeeds for every section | Update all baselines and show success |
| One section fails | Show its concrete error and keep that section dirty |
| Close or navigate while dirty | Ask whether to discard or continue editing |
| Model refresh with unsaved channel fields | Use the draft and reuse only the matching saved masked secret |
| Codex Connect before Save | Connection may start with the draft, but localStorage remains unchanged |

### 5. Good/Base/Bad Cases

- Good: changing an API URL, refreshing its models, then closing without saving leaves the stored URL unchanged.
- Base: opening the panel and making no changes keeps Save disabled.
- Bad: a field handler calls a server save, writes localStorage, or updates workbench-global defaults.

### 6. Tests Required

- Assert field changes cause no network persistence and no localStorage writes.
- Assert global Save persists AI/storage/Codex and updates saved baselines.
- Assert partial failure retains only failed drafts as dirty.
- Assert modal close, route navigation, and `beforeunload` protect dirty drafts.
- Assert image/video task controls do not change global saved preferences.

### 7. Wrong vs Correct

#### Wrong

```ts
onChange={(value) => {
    updateConfig("imageModel", value);
    localStorage.setItem("model", value);
}}
```

#### Correct

```ts
onChange={(value) => setDraft((current) => ({ ...current, imageModel: value }))}
// The global Save handler is the only persistence boundary.
```
