# 统一全局东八区时区

## Goal

统一应用运行时、PostgreSQL 和 API 日期响应的时区语义，避免服务端日期以 UTC `Z` 格式返回后被误认为少 8 小时。

## Requirements

- 应用默认时区固定为 `Asia/Shanghai`（UTC+8）。
- PostgreSQL 服务端默认时区和应用数据库连接会话时区固定为 `Asia/Shanghai`。
- 所有 API JSON 响应中的 `Date` 值统一序列化为带 `+08:00` 偏移的 ISO 8601 字符串。
- 日期仍表示同一绝对时间点，不得通过错误加减时间改变过期判断、排序、会话校验或签名有效期。
- 日期序列化必须在全局 API 边界集中处理，不在各业务路由逐字段重复转换。
- Docker 生产和本地开发 Compose 使用相同的时区配置。

## Acceptance Criteria

- [ ] Node 应用运行时的默认时区为 `Asia/Shanghai`。
- [ ] PostgreSQL 启动配置及每个应用连接会话的时区为 `Asia/Shanghai`。
- [ ] API 返回的 `createdAt`、`updatedAt`、`expiresAt`、`startedAt`、`completedAt` 等 `Date` 字段均采用 `YYYY-MM-DDTHH:mm:ss.sss+08:00` 格式。
- [ ] `/api/files/:storageKey/access-url` 和 `/api/storage/debug` 不再自行生成 UTC 日期字符串，而是进入统一日期序列化流程。
- [ ] 文件访问令牌仍使用毫秒时间戳校验，有效期长度不变。
- [ ] 非 JSON 响应（文件流、静态文件）不受日期转换影响。
- [ ] `CHANGELOG.md` 和待测试文档记录本次用户可感知变更。

## Out Of Scope

- 修改宿主机操作系统时区。
- 修改数据库列类型或迁移现有时间数据；现有列均为 `timestamptz`，保存的是绝对时间点。
- 将业务 JSON 中原本就是字符串的任意内容猜测为日期并自动转换。

## Notes

- 用户明确要求全局修复，不能只处理单个 `expiresAt` 字段。
