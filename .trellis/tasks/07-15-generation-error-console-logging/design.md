# OpenAI 文本 SSE 直通设计

## 数据流

```
画布文本节点 -> POST /api/generations/text/stream -> OpenAI /v1/responses
                                                <- SSE <-
画布 fetch reader <- SSE 代理 <- 上游 SSE
```

前端不能用 `EventSource` 发送 POST JSON，因此使用已认证 cookie 的 `fetch` 读取 `ReadableStream`。服务端验证当前用户和渠道后，以服务端保存的 API Key 请求上游；浏览器永远不会取得渠道 Key。

## 后端

- Worker 导出 OpenAI 文本流请求帮助函数，复用既有渠道解析、Base URL、鉴权头和 Responses `input` 转换。
- `POST /api/generations/text/stream` 仅接受 text 任务的必要字段，并使用 `reply.hijack()` 把上游 SSE 内容逐块写入响应。
- 显式传 `stream: true` 和 `Accept: text/event-stream`。
- 客户端断开时中止上游 fetch；上游非 SSE 或非 2xx 时在控制台输出完整响应诊断，并向浏览器返回安全错误。

## 前端

- OpenAI 渠道改用文本流 API；分块解析 SSE 的 `data:` JSON，累计 `response.output_text.delta`，完成事件读取 `response.completed`。
- Gemini 渠道继续创建异步 text 任务，保留既有兼容性。
- OpenAI 文本流不创建 `generation_tasks` 记录，刷新页面时不恢复尚未完成的文本节点。
