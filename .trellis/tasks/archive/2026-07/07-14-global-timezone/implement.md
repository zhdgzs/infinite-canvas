# 实施清单

- [x] 在时间工具中实现 `Date` 到 `+08:00` ISO 字符串的统一转换，并递归处理 API JSON 数据。
- [x] 在 Fastify 应用注册全局 `preSerialization` 日期转换钩子。
- [x] 移除文件访问和 S3 调试接口中的局部 `toISOString()`。
- [x] 为 PostgreSQL 连接池设置 `Asia/Shanghai` 会话时区。
- [x] 更新 Dockerfile、生产 Compose、本地 Compose 的应用和 PostgreSQL 时区配置。
- [x] 更新 `CHANGELOG.md` 和 `pending-test.mdx`，确认 TODO 无需调整。
- [x] 按项目约束进行静态代码审查与差异检查，不执行构建或测试。

## 风险点

- 全局递归转换不得处理文件流、Buffer 或非普通对象。
- 日期输出偏移变化不能改变对应的绝对时间点。
- PostgreSQL 启动参数必须对已有数据目录同样生效。
