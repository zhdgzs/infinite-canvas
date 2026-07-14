# 完善生图失败错误与日志

## Goal

让异步生图任务在服务端请求失败时保留可诊断且不泄露敏感信息的错误原因，并在 Docker 标准日志中记录对应任务的结构化失败日志，避免任务只返回泛化的 `fetch failed`。

## Requirements

- 保持现有异步任务 API 与任务状态协议不变。
- 捕获第三方 AI 请求失败的有效上下文，包括底层网络错误原因或第三方 HTTP 错误响应。
- 错误增强统一覆盖图片、视频、音频和文本生成任务。
- 任务终态 `error` 应提供可供用户排障的安全错误信息，不记录或返回 API Key、认证头、请求中的敏感内容。
- worker 遇到任务失败时必须输出结构化错误日志，使 Docker 日志可以按任务 ID 定位失败原因。
- 沿用项目现有 Fastify/Pino 日志与错误处理方式，不引入新的日志框架或不必要抽象。

## Confirmed Facts

- `startGenerationWorker()` 没有接收 Fastify logger；worker tick 仅用 `console.error` 处理调度层异常。
- `runTask()` 的 catch 只持久化 `Error.message`，没有记录日志；Node/Undici 的 `fetch failed` 根因通常位于 `Error.cause`，因此当前被丢弃。
- `fetchJson()` 已能从第三方 JSON 响应读取错误消息，但非 2xx 错误在存在服务商消息时不包含 HTTP 状态码，响应不是合法 JSON 时还会被 `JSON.parse` 异常覆盖。
- 图片、视频、音频、文本任务共用同一个 `runTask()`，其中多数 JSON 请求共用 `fetchJson()`；修改公共错误边界会自然影响所有生成类型。
- Fastify 已启用 Pino logger，应用入口可把 `app.log` 注入 worker，无需新增日志依赖。

## Acceptance Criteria

- [x] 网络连接、DNS、TLS、超时等 `fetch` 失败不再只保存无法定位根因的 `fetch failed`；任务错误至少包含安全的底层原因。
- [x] 第三方返回非 2xx 响应时，任务错误保留状态码和可用的服务商错误说明。
- [x] 每个失败任务在服务端输出 error 级结构化日志，至少可关联任务 ID、生成类型、模型/渠道与完整异常堆栈或 cause。
- [x] 日志和任务 API 均不暴露 API Key、Authorization 等密钥。
- [x] 成功任务、轮询响应和现有前端失败态消费协议不受影响。

## Out of Scope

- 不调整任务状态、轮询频率、并发数或生成业务逻辑。
- 不新增数据库字段、错误详情接口或前端调试面板。
- 不记录完整请求体、Prompt、参考素材或认证信息。

## Decisions

- 用户确认公共 worker 错误边界统一覆盖图片、视频、音频和文本任务，不保留仅图片生效的类型分支。

## Notes

- 用户现场任务：`task_W69WW0mZtBJRIqkrwHRFE`。
- 用户现场表现：任务状态为 `failed`，错误仅为 `fetch failed`；Docker 日志只有任务轮询请求的常规访问日志，没有 worker 失败日志。
- 当前阶段先确认错误丢失点和最小修复边界，再形成技术设计与实施计划。
