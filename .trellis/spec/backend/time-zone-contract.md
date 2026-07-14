# Time Zone Contract

## Scenario: UTC+8 runtime and API dates

### 1. Scope / Trigger

- Apply this contract whenever backend code creates, stores, compares, or returns dates.
- PostgreSQL remains the source of truth for persisted timestamps, while the Fastify response boundary owns API date formatting.

### 2. Signatures

```text
Runtime time zone                         Asia/Shanghai
PostgreSQL timezone / log_timezone       Asia/Shanghai
PostgreSQL column type                    timestamp with time zone
API Date format                           YYYY-MM-DDTHH:mm:ss.sss+08:00
server/src/lib/time.ts                    now(), addDays(), toIso(), serializeDates()
```

### 3. Contracts

- `TZ=Asia/Shanghai` is set for application and PostgreSQL containers.
- PostgreSQL starts with `timezone=Asia/Shanghai` and `log_timezone=Asia/Shanghai`.
- Every application pool connection sets its session timezone from `config.timeZone`.
- Database timestamps store absolute instants. Do not add or subtract eight hours before database writes or comparisons.
- Fastify's global `preSerialization` hook converts actual `Date` values in JSON payloads to ISO 8601 strings with `+08:00`.
- Route handlers return `Date` objects. They must not format response date fields independently.
- Existing strings inside JSON or JSONB payloads are not guessed or rewritten as dates.
- HTTP dates such as `Last-Modified` continue to use the RFC-required GMT format.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| API payload contains a `Date` | Serialize with `+08:00` while preserving the Unix timestamp |
| API payload contains arrays or nested plain objects | Convert every nested `Date` |
| Payload is a stream, Buffer, or non-plain object | Leave it unchanged |
| JSON/JSONB contains a date-looking string | Leave the string unchanged |
| Database connection is created outside Compose | Pool session still uses `Asia/Shanghai` |
| Existing PostgreSQL data directory is reused | Startup `-c` settings apply without data migration |

### 5. Good/Base/Bad Cases

- Good: a PostgreSQL `timestamptz` value becomes a JavaScript `Date`, then the API returns the same instant as `2026-07-14T18:00:00.000+08:00`.
- Base: expiration checks and ordering continue to compare absolute instants and are unaffected by display offset.
- Bad: adding eight hours to a timestamp before saving it, which changes the actual instant.
- Bad: calling `toISOString()` in each route and returning UTC `Z` strings that bypass the global serializer.

### 6. Tests Required

- Unit: assert `toIso()` preserves the Unix timestamp when its output is parsed.
- Unit: assert `serializeDates()` converts nested object and array dates but leaves strings, Buffer instances, and null values unchanged.
- API: assert representative `createdAt`, `updatedAt`, and `expiresAt` fields end in `+08:00`.
- Access URL: assert the signed token expiration milliseconds and returned `expiresAt` describe the same instant.
- PostgreSQL: assert `SHOW timezone` returns `Asia/Shanghai` for both the server default and an application pool connection.

### 7. Wrong vs Correct

#### Wrong

```ts
return ok({ expiresAt: expiresAt.toISOString() });
```

This bypasses the global date boundary and returns a UTC `Z` string.

#### Correct

```ts
return ok({ expiresAt });
```

The Fastify `preSerialization` hook converts the `Date` consistently with every other API date.
