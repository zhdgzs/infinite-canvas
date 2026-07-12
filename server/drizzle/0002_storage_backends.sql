CREATE TABLE storage_backends (
    id text PRIMARY KEY,
    name text NOT NULL,
    type text NOT NULL CHECK (type IN ('local', 's3')),
    endpoint text,
    public_endpoint text,
    region text,
    bucket text,
    access_key_id text,
    secret_access_key text,
    object_prefix text NOT NULL DEFAULT '',
    force_path_style boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX storage_backends_single_active_idx ON storage_backends (is_active) WHERE is_active = true;
CREATE INDEX storage_backends_active_idx ON storage_backends (is_active);

INSERT INTO storage_backends (id, name, type, is_active)
VALUES ('local', '本地磁盘', 'local', true);

ALTER TABLE files ADD COLUMN storage_backend_id text;
UPDATE files SET storage_backend_id = 'local';
ALTER TABLE files ALTER COLUMN storage_backend_id SET NOT NULL;
ALTER TABLE files ADD CONSTRAINT files_storage_backend_id_fk FOREIGN KEY (storage_backend_id) REFERENCES storage_backends(id);
CREATE INDEX files_storage_backend_id_idx ON files (storage_backend_id);

ALTER TABLE generation_tasks ADD COLUMN storage_backend_id text;
UPDATE generation_tasks SET storage_backend_id = 'local';
ALTER TABLE generation_tasks ALTER COLUMN storage_backend_id SET NOT NULL;
ALTER TABLE generation_tasks ADD CONSTRAINT generation_tasks_storage_backend_id_fk FOREIGN KEY (storage_backend_id) REFERENCES storage_backends(id);
CREATE INDEX generation_tasks_storage_backend_id_idx ON generation_tasks (storage_backend_id);
