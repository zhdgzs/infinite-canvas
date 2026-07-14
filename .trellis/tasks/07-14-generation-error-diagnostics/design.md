# 技术设计

## 问题边界

当前失败链路为：

```text
第三方请求异常
  -> Node fetch 抛出 TypeError("fetch failed", { cause })
  -> runTask catch 仅读取 error.message
  -> generation_tasks.error = "fetch failed"
  -> 无 worker 失败日志
```

修复只调整 worker 的错误归一化与日志边界，不改变任务 API、数据库结构或生成流程。

## 日志依赖

`buildApp()` 已创建 Fastify/Pino logger。应用入口调用 `startGenerationWorker(app.log)`，worker 使用 Fastify 的 logger 类型，不创建第二个 logger 实例。

worker tick 的调度异常和单任务执行异常均通过该 logger 输出：

- 调度异常：记录 `err`，消息为 generation worker tick failed。
- 任务异常：记录 `err`、`taskId`、`kind`、`channelId`、`model`，消息为 generation task failed。

不记录用户 ID、API Key、Authorization、请求头、Prompt、配置、参考素材或完整 Provider 请求/响应。

## 错误归一化

在 worker 内集中提供安全错误消息函数：

1. 非 `Error` 值返回“生成失败”。
2. 沿标准 `Error.cause` 链提取非空 message，并去除相邻重复值。
3. 顶层为泛化网络错误（如 `fetch failed`）时，组合底层 cause，例如 `fetch failed：connect ECONNREFUSED ...`。
4. 对认证、密钥等敏感片段进行掩码，最终字符串写入 `generation_tasks.error`。
5. 普通业务错误保持原有 message，不强行附加内部细节。

原始 Error 会投影为仅保留脱敏 name、stack 和 cause 链的 Error 副本，再进入服务端 Pino 的标准 `err` 字段；数据库/API 只保存归一化后的安全字符串。这样既保留诊断信息，也避免异常对象的其他可枚举属性进入日志。

## Provider HTTP 错误

`fetchJson()` 先读取响应文本，再容错解析 JSON：

- 非 2xx：错误消息同时包含 HTTP 状态码和可解析的 Provider 错误说明。
- 非 JSON 错误响应：使用有限长度的纯文本说明；空响应退回通用状态码错误。
- 2xx 但响应不是合法 JSON：明确报告响应解析失败，而不是伪装成网络失败。

二进制响应沿用现有读取逻辑，本任务不重构媒体下载协议。

## 数据流与兼容性

```text
Error + cause
  ├─ Pino err serializer -> Docker 标准日志（stack/cause + 任务字段）
  └─ safe task message   -> generation_tasks.error -> 现有轮询 API
```

- `GET /api/generations/tasks/:id` 的判别联合结构不变。
- 数据库 `error` 字段仍为 text，无迁移。
- 前端继续显示现有 `error` 字符串，无需修改。
- 四种生成类型统一生效。

## 风险与回滚

- 风险：Provider 错误正文可能很长或含敏感信息。通过长度限制和敏感词掩码控制。
- 风险：日志错误对象可能包含额外属性。日志只使用脱敏后的 Error 副本和允许的任务字段；请求数据不作为日志字段。
- 回滚：恢复 `startGenerationWorker()` 无参调用、原 catch 和 `fetchJson()`；无数据结构回滚。
