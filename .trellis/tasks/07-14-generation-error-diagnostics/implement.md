# 实施清单

- [x] 阅读 backend generation task contract、错误处理及日志规范，确认普通任务 API 不暴露内部 Provider 字段。
- [x] 将 `app.log` 从服务入口注入 generation worker，替换调度层 `console.error`。
- [x] 在 `runTask()` catch 中输出带任务关联字段的 error 级结构化日志。
- [x] 增加集中、安全的任务错误消息归一化，保留 `fetch` cause 并掩码敏感片段。
- [x] 改进 `fetchJson()` 的非 2xx 状态码、Provider JSON/文本错误和无效 JSON处理。
- [x] 确认图片、视频、音频、文本任务均经过统一错误边界，且成功路径与任务 API DTO 不变。
- [x] 更新 `CHANGELOG.md` 的 `Unreleased`、`pending-test.mdx`，并检查 `todo.mdx` 是否需要调整。
- [x] 按项目要求做静态差异与契约检查；不执行构建、类型检查或测试。

## 验证要点

- 模拟 `TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 127.0.0.1:443") })`，任务错误包含底层连接原因。
- 模拟 Provider 非 2xx JSON 错误，任务错误同时包含 HTTP 状态码和服务商消息。
- 模拟 Provider 非 JSON/空错误响应，任务错误仍可定位状态码且不会因 JSON.parse 覆盖原始错误。
- 检查日志调用包含 `err`、`taskId`、`kind`、`channelId`、`model`，不包含密钥、请求头、Prompt、配置或参考素材。
- 搜索确认 worker 不再使用 `console.error`，现有任务轮询响应结构没有变化。

## 风险文件与回滚点

- `server/src/index.ts`：只负责注入现有 logger。
- `server/src/modules/worker.ts`：错误边界与请求解析的主要修改点；若出现回归可独立恢复。
- `CHANGELOG.md`、`docs/content/docs/progress/pending-test.mdx`：用户可感知变更记录。
