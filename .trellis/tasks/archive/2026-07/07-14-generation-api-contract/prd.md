# 生成任务接口语义重构

## Goal

按业务语义拆分生成任务执行、状态查询和生成历史，避免高频轮询接口返回完整数据库记录。

## Requirements

- 创建异步生成任务的接口只返回任务标识和初始状态。
- 高频任务状态查询只返回当前状态，以及终态需要的 `result` 或 `error`。
- API 不返回 `userId`、`storageBackendId`、`providerRequest`、`providerResponse` 等内部字段。
- 数据库查询使用与响应契约一致的显式字段投影，不先读取整行再删除字段。
- 生成历史与任务轮询是不同业务语义，不共用同一个完整任务 DTO。
- 当前生成历史用于生图和视频页面在刷新、跨设备后恢复生成记录。
- 删除生成历史当前仅逻辑删除任务记录，不取消运行中任务，也不删除生成文件。
- 保留生图和视频页面现有的“生成记录”功能及视频未完成任务的刷新续跑能力。
- 单任务状态查询使用 `GET /api/generations/tasks/:id`，不增加冗余的 `/status` 后缀。
- `queued`、`running` 任务不能通过记录删除接口隐藏，必须先取消并进入终态。
- 记录删除仅设置逻辑删除标记，不删除生成文件或已写入画布、素材库的数据。
- 生成历史接口使用 `GET /api/generations/records` 和 `DELETE /api/generations/records/:id`。

## Acceptance Criteria

- [ ] 轮询请求不再返回 prompt、config、references、渠道、存储和 Provider 调试字段。
- [ ] 处理中响应包含任务 ID 和状态；成功响应额外包含 result；失败或取消响应额外包含 error。
- [ ] 创建、轮询、取消和历史记录使用各自明确的响应类型。
- [ ] 前端图片、视频、音频、文本和画布任务轮询适配精简响应。
- [ ] 生成历史页面仍能恢复展示所需的提示词、模型、配置、参考素材、结果和时间信息。

## Confirmed Facts

- `POST /api/generations` 当前用于创建异步任务。
- `GET /api/generations/:id` 当前仅被前端用于轮询任务状态和读取终态结果。
- `GET /api/generations` 当前用于图片和视频生成历史列表。
- `DELETE /api/generations/:id` 当前用于从生成历史中逻辑删除记录。
- 生成历史显示在生图工作台和视频创作台的“生成记录”区域：桌面端位于左侧栏，移动端通过“记录”按钮打开底部抽屉。
- 点击图片生成记录会恢复提示词、参考图、模型参数和结果图片；点击视频生成记录会恢复提示词、图片/视频/音频参考、模型参数和结果视频。
- 视频生成历史还用于页面刷新后发现并继续轮询未完成任务。
- 画布撤销/重做不使用生成任务接口，而是由画布页面内存中的 `past` / `future` 快照独立实现。
- Agent 面板的“历史”是对话线程历史，也与生成任务记录无关。
- 对单个任务查询时，资源路径参数比 `status?id=` 查询参数更明确；如果任务资源的唯一公开表示就是执行状态，则 `GET /tasks/:id` 比额外增加 `/status` 更简洁。
- 用户已确认采用 `GET /api/generations/tasks/:id`。
- 用户已确认生成中任务必须先取消，终态后才能删除记录。
- 用户已确认生成历史资源命名为 `/api/generations/records`。

## API Contract

```text
POST   /api/generations/tasks             创建异步任务
GET    /api/generations/tasks/:id         查询任务状态和终态结果
POST   /api/generations/tasks/:id/cancel  取消任务
GET    /api/generations/records           查询生成记录
DELETE /api/generations/records/:id       删除终态生成记录
```

旧 `/api/generations` 路由不保留兼容层。

## Notes

- 项目尚未上线，不需要保留旧接口兼容层。
