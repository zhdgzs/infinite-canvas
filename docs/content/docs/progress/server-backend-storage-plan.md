---
title: 服务端持久化方案
description: 后端化、云端存储和文件持久化的最终确认方案
---

# 服务端持久化方案

本文档是服务端持久化改造的开发依据。目标是将项目从“浏览器本地存储为主”改为“服务端为唯一真实数据源”的普通网站模式。旧本地 IndexedDB / WebDAV 数据不迁移，按新系统重新使用。前端本地只允许保留基础资源缓存、第三方提示词缓存和设备级配置。

## 整体架构

- 新增 `server/` 目录作为线上业务后端。
- 后端技术栈：Fastify、TypeScript、Drizzle ORM、PostgreSQL。
- 后端包管理器：npm / `package-lock.json`。
- Fastify 同时托管 `web/dist` 静态文件。
- 所有 API 使用 `/api` 前缀，非 `/api` 路径 fallback 到前端 `index.html`。
- Docker Compose 只包含 `server` 和 `postgres`。
- 宿主机 Nginx 反代到 server 一个端口。
- 数据目录使用宿主机目录挂载：
  - `./data/postgres:/var/lib/postgresql/data`
  - `./data/uploads:/data/uploads`
- server Docker entrypoint 启动时先执行 Drizzle migrations，迁移失败则 server 不启动。
- 提供 `GET /api/health` 健康检查。

## 部署配置

使用环境变量 / `.env`：

```env
DATABASE_URL=
SESSION_SECRET=
UPLOAD_DIR=/data/uploads
FILE_ACCESS_URL_TTL_SECONDS=7200
IMAGE_WORKER_CONCURRENCY=5
AUDIO_WORKER_CONCURRENCY=5
VIDEO_WORKER_CONCURRENCY=1
IMAGE_MAX_UPLOAD_MB=50
VIDEO_MAX_UPLOAD_MB=500
AUDIO_MAX_UPLOAD_MB=100
FILE_MAX_UPLOAD_MB=500
AI_DEBUG_LOG=false
```

`SESSION_SECRET` 由用户自行生成并配置。AI API Key 明文存数据库，不使用 `ENCRYPTION_KEY`。

## 统一响应格式

所有 JSON API 返回：

```json
{ "code": 200, "msg": "", "data": {} }
```

前端以 `code === 200` 判断成功，`code !== 200` 视为异常并展示 `msg`。

建议业务码：

```text
200 成功
400 参数错误
401 未登录或会话过期
403 无权限
404 资源不存在
409 状态冲突
413 文件过大
415 文件类型不支持
429 请求过于频繁或队列繁忙
500 服务端错误
502 上游 AI 服务错误
504 上游 AI 服务超时
```

HTTP 状态码仍建议保持语义正确。

## 账号与会话

- 必须登录才能访问主功能。
- 数据库无用户时开放初始化注册页。
- 第一个注册用户角色固定为 `admin`。
- 一旦已有用户，关闭注册接口。
- 不使用 setup token。
- 登录方式：用户名 + 密码。
- 密码最少 8 位。
- 密码哈希：Argon2id。
- 会话使用 httpOnly cookie。
- session 存数据库，30 天滚动有效期。
- 改密码后清理旧 session。
- 提供 admin 密码重置脚本。

## 文件存储

- 文件本体不存数据库。
- 数据库存文件元数据，文件默认存磁盘。
- 存储层抽象为可替换实现，后续兼容 S3 / MinIO。
- 新 `storageKey` 格式：`kind_nanoid`，例如 `image_xxx`、`video_xxx`。
- 磁盘路径：

```text
/data/uploads/{userId}/{yyyy}/{mm}/{storageKey}.{ext}
```

- 数据库存相对路径，不存绝对路径。
- 磁盘实际文件名只用 `storageKey.ext`。
- DB 保存 `original_name`，下载时优先使用 `original_name`，否则用 `storageKey.ext`。
- 不做文件去重，每次上传 / 生成都创建新 `storageKey`。
- 删除只逻辑标记，不物理删除。
- 后续可做回收站 / 存储管理，由用户手动确认后才物理删除。

## 文件接口

- MVP 上传使用 multipart：

```text
POST /api/files
```

- 未来可扩展：

```text
POST /api/files/upload-url
POST /api/files/complete
```

- 获取访问链接：

```text
GET /api/files/:storageKey/access-url
```

- 磁盘内容接口：

```text
GET /api/files/:storageKey/content
```

- `access-url` 默认有效期 2 小时，可配置。
- 磁盘 content 接口同时支持临时签名 token 和登录 session。
- content 接口必须支持 Range、Content-Type、Content-Length、ETag 或 Last-Modified。
- 文件默认私有，必须登录或持有效签名访问。

## 文件校验与元数据

- 后端以文件头检测 MIME 为准，浏览器 `file.type` 只作提示。
- 未知 / 非媒体文件拒绝上传。
- 允许图片格式：png、jpeg、webp、gif、avif；不允许 svg。
- 默认不安装 ffmpeg / ffprobe。
- 图片元数据用 `sharp` 提取。
- 视频 / 音频如检测到 ffprobe 则提取宽高 / 时长；否则只保存 mime / bytes。
- AI 生成图片按上游原始格式保存，不强制转码。

## 核心表

建议表：

```text
users
sessions
files
canvas_projects
assets
generation_tasks
ai_channels
user_ai_preferences
user_preferences
```

ID 规则：

- `users.id`、`sessions.id` 使用 UUID。
- `canvas_projects.id`、`assets.id`、`generation_tasks.id` 由后端生成 nanoid / text。
- 画布节点 ID 仍由前端生成。
- 时间字段 API 统一返回 ISO 字符串。

## 画布项目

- 服务端是唯一真实数据源。
- 项目 ID 由后端生成。
- 项目列表分页 + 标题搜索，默认 `updated_at desc`。
- 列表接口只返回摘要，不返回完整 JSON。
- MVP 不做画布缩略图。
- 画布保存粒度：debounce 后上传整个项目 JSON。
- 不做冲突合并，以服务端数据为准。
- 服务端不直接修改画布 JSON。
- 画布生成任务完成后，由前端轮询结果并回填节点，再保存项目 JSON。
- 打开画布时扫描 loading 节点里的 `generationTaskId`，恢复任务状态并回填。
- 媒体节点删除 `metadata.content` 语义，统一保存 `metadata.storageKey`。
- 文本节点继续使用 `metadata.content`。
- 项目 JSON 不保存 blob URL、dataURL、access URL。
- 画布聊天 / 助手历史图片只保存 `storageKey`。

## 素材库

- asset ID 由后端生成。
- 支持类型：`text | image | video | audio`。
- 音频素材先用默认图标，不做封面。
- 素材列表服务端分页、类型过滤、标题 / 标签搜索。
- 素材封面使用 `coverStorageKey` + 外部 `coverUrl` 双字段。
- 新上传封面统一入文件存储。
- 素材库页面上传文件：创建 file + asset。
- 画布 / 参考图上传：只创建 file。
- 生成结果默认不自动加入素材库，用户手动加入。

## AI 配置

- AI 配置按用户保存。
- 渠道拆表 `ai_channels`。
- 其他模型偏好存 `user_ai_preferences.preferences` JSONB。
- API Key 明文存数据库。
- 配置接口不返回完整 API Key，只返回脱敏值和 `hasApiKey`。
- 更新规则：
  - 不传 `apiKey`：不修改原 key。
  - `apiKey: ""`：清空。
  - 传新值：替换。
- 模型列表刷新由后端调用上游并保存到渠道 `models`。
- 前端不再直连 AI API。
- 生成任务创建时前端只传 `channelId + model + 业务参数`，不传 API Key。

## AI 生成任务

- 图片、视频、音频、文本全部统一走后端异步任务。
- 前端创建任务后轮询状态。
- MVP 不做 SSE / WebSocket。
- 文本结果不做流式，一次性返回。
- 任务 ID 由后端生成。
- 任务状态：

```text
queued
running
succeeded
failed
cancelled
```

- 使用 PostgreSQL 表队列，不引入 Redis。
- 同一个后端进程启动 worker。
- 默认并发：

```text
image 5
audio 5
video 1
```

- 任务支持取消：
  - queued：直接 cancelled。
  - running：上游支持取消则调用上游；不支持则标记取消并忽略后续结果。
- 重启恢复：
  - 有 `provider_task_id` 的任务继续轮询。
  - 无 `provider_task_id` 的 running 任务标记失败。
- 任务保存引用输入的 `storageKey` 和当时元数据快照。
- 默认不保存完整 provider request / response；`AI_DEBUG_LOG=true` 时才保存。
- 生成记录永久保留，用户手动删除。

## 前端改造原则

- 一次性改为云端 store。
- 业务数据不再使用 localforage 作为真实来源。
- 本地只保留：
  - 文件 / access-url / Blob 基础缓存。
  - 第三方 prompt cache。
  - Local Agent URL / token、面板宽度等设备配置。
- 第三方提示词库保持前端直连 GitHub + IndexedDB 缓存。
- WebDAV UI 先隐藏，后端不设计 WebDAV。
- 文档明确：新后端版不迁移旧浏览器本地数据。

## 备份

必须成对备份：

```text
./data/postgres
./data/uploads
```

只备份数据库或只备份 uploads 都不完整，因为业务 JSON 通过 `storageKey` 引用文件。
