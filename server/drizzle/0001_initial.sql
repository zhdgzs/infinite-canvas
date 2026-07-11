CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    role text NOT NULL DEFAULT 'admin',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_username_idx ON users (username);

CREATE TABLE IF NOT EXISTS sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS files (
    storage_key text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind text NOT NULL,
    path text NOT NULL UNIQUE,
    original_name text,
    mime_type text NOT NULL,
    bytes bigint NOT NULL,
    width integer,
    height integer,
    duration_ms integer,
    sha256 text,
    created_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS files_user_id_idx ON files (user_id);
CREATE INDEX IF NOT EXISTS files_kind_idx ON files (kind);
CREATE INDEX IF NOT EXISTS files_deleted_at_idx ON files (deleted_at);

CREATE TABLE IF NOT EXISTS canvas_projects (
    id text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title text NOT NULL,
    data jsonb NOT NULL,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS canvas_projects_user_id_idx ON canvas_projects (user_id);
CREATE INDEX IF NOT EXISTS canvas_projects_updated_at_idx ON canvas_projects (updated_at);
CREATE INDEX IF NOT EXISTS canvas_projects_deleted_at_idx ON canvas_projects (deleted_at);

CREATE TABLE IF NOT EXISTS assets (
    id text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind text NOT NULL,
    title text NOT NULL,
    tags jsonb NOT NULL DEFAULT '[]'::jsonb,
    cover_storage_key text,
    cover_url text,
    data jsonb NOT NULL,
    metadata jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS assets_user_id_idx ON assets (user_id);
CREATE INDEX IF NOT EXISTS assets_kind_idx ON assets (kind);
CREATE INDEX IF NOT EXISTS assets_updated_at_idx ON assets (updated_at);
CREATE INDEX IF NOT EXISTS assets_deleted_at_idx ON assets (deleted_at);

CREATE TABLE IF NOT EXISTS generation_tasks (
    id text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind text NOT NULL,
    status text NOT NULL,
    prompt text NOT NULL DEFAULT '',
    channel_id text,
    model text,
    config jsonb NOT NULL DEFAULT '{}'::jsonb,
    "references" jsonb NOT NULL DEFAULT '[]'::jsonb,
    result jsonb NOT NULL DEFAULT '{}'::jsonb,
    error text,
    provider_task_id text,
    provider_status text,
    provider_request jsonb,
    provider_response jsonb,
    cancel_requested boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    completed_at timestamptz,
    deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS generation_tasks_user_id_idx ON generation_tasks (user_id);
CREATE INDEX IF NOT EXISTS generation_tasks_status_idx ON generation_tasks (status);
CREATE INDEX IF NOT EXISTS generation_tasks_kind_idx ON generation_tasks (kind);
CREATE INDEX IF NOT EXISTS generation_tasks_created_at_idx ON generation_tasks (created_at);

CREATE TABLE IF NOT EXISTS ai_channels (
    id text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL,
    base_url text NOT NULL,
    api_format text NOT NULL DEFAULT 'openai',
    api_key text,
    models jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_channels_user_id_idx ON ai_channels (user_id);

CREATE TABLE IF NOT EXISTS user_ai_preferences (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_preferences (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    theme text,
    preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
);
