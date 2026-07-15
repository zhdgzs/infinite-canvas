# 完整输出生成错误

## Goal

在容器控制台输出生成任务的完整错误信息，特别是上游的非 JSON 响应，方便排查渠道代理问题。

## Requirements

- 生成任务失败时，控制台直接输出未经脱敏或截断的原始错误对象。
- HTTP 响应解析失败或非成功响应时，原始错误对象包含请求 URL、响应状态、响应状态文本、完整响应头和完整响应体。
- `generation_tasks.error` 以及 Pino 结构化日志继续使用现有脱敏、长度限制逻辑。
- 不记录请求头、API Key、Prompt 或参考素材。

## Acceptance Criteria

- [ ] 容器日志可显示完整上游响应内容和响应元信息。
- [ ] 任务失败 API 仍只返回安全、截断的错误消息。
- [ ] 既有成功响应和非 HTTP 网络错误处理不变。

## Notes

- 仅修改 `server/src/modules/worker.ts`，属于轻量任务。
