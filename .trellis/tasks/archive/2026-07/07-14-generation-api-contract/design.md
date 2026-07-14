# 技术设计

## 资源边界

同一张 `generation_tasks` 表提供两种 API 投影，但不再暴露数据库整行：

```text
generation_tasks -> TaskState DTO   -> 创建、轮询、取消
                 -> Record DTO      -> 生成历史列表和删除
```

## 任务接口

### 创建任务

`POST /api/generations/tasks` 返回：

```ts
type GenerationTaskRef = {
    id: string;
    status: "queued";
};
```

### 查询任务

`GET /api/generations/tasks/:id` 使用按状态区分的响应：

```ts
type GenerationTaskState<T> =
    | { id: string; status: "queued" | "running" }
    | { id: string; status: "succeeded"; result: T }
    | { id: string; status: "failed" | "cancelled"; error: string | null };
```

数据库只查询 `id`、`status`、`result`、`error`。响应中不返回 prompt、配置、参考素材、用户、存储和 Provider 字段。

### 取消任务

`POST /api/generations/tasks/:id/cancel` 返回 `{ id, status }`。排队任务立即变为 `cancelled`；运行中任务保留 `running` 并设置内部 `cancelRequested`，由 worker 收敛到 `cancelled`。

## 记录接口

`GET /api/generations/records` 保留 `kind`、分页参数，并显式查询页面恢复所需字段：

```text
id, kind, status, prompt, model, config, references,
result, error, createdAt, updatedAt, startedAt, completedAt
```

排除 `userId`、`storageBackendId`、`channelId`、`providerTaskId`、`providerStatus`、`providerRequest`、`providerResponse`、`cancelRequested`、`deletedAt`。

`DELETE /api/generations/records/:id` 仅允许 `succeeded`、`failed`、`cancelled`；`queued`、`running` 返回 `409`，提示先取消任务。

## 前端类型

- `GenerationTaskRef`：创建任务返回值。
- `GenerationTaskState<T>`：轮询和取消返回值。
- `GenerationRecord<T>`：图片、视频历史记录。
- `GenerationRecordPage<T>`：分页记录列表。

图片、视频、音频、文本和画布轮询只依赖任务状态 DTO；图片和视频历史页面只依赖记录 DTO。

## 兼容性

项目尚未上线，直接删除旧路由并迁移所有前端调用，不增加兼容转发。

## 错误语义

- 任务或记录不存在、非当前用户所有、已逻辑删除：`404`。
- 取消终态任务：`409 当前任务状态不能取消`。
- 删除运行中或排队任务记录：`409 请先取消生成任务`。

## 回滚

恢复旧路由和完整 `GenerationTask` DTO 即可；不涉及数据库结构和数据迁移。
