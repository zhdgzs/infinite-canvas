# 技术设计

## 边界与数据流

```text
PostgreSQL timestamptz -> pg Date -> Fastify 响应对象 -> 全局日期序列化 -> ISO 8601 +08:00
```

数据库继续保存绝对时间点。时区只影响数据库展示/会话解释和 API 输出格式，不改变时间戳本身。

## 设计

1. 在 `server/src/lib/time.ts` 集中维护东八区 ISO 格式化和响应对象日期转换函数。
2. 在 Fastify `preSerialization` 钩子中递归转换 JSON 响应里的真实 `Date` 值；仅遍历数组和普通对象，避免影响 Buffer、流和第三方实例。
3. 文件访问和 S3 调试接口直接返回 `Date`，由全局钩子统一处理。
4. Node 运行镜像和 Compose 设置 `TZ=Asia/Shanghai`。
5. PostgreSQL 通过启动参数设置 `timezone`、`log_timezone`，应用连接池再通过连接参数设置会话时区，保证非 Compose 启动时也一致。

## 兼容性

- `Date.parse` 可直接解析 `+08:00` ISO 字符串，前端访问 URL 缓存逻辑无需修改。
- 时间值对应的 Unix 毫秒数不变，因此数据库排序、过期比较、Cookie 和文件令牌签名不变。
- 已有 `timestamptz` 数据无需迁移。

## 取舍

- 不覆盖 `Date.prototype.toJSON`，避免修改全局原型。
- 不按字段名识别日期字符串，避免误改用户业务数据。
- 不引入日期库；固定 UTC+8 的 ISO 格式化逻辑很小，使用标准 `Date` 即可完成。

## 回滚

移除 Fastify 序列化钩子、数据库连接时区参数和容器时区配置即可恢复原有 UTC 输出；不涉及数据迁移。
