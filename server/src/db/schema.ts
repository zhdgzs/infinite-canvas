import { relations } from "drizzle-orm";
import { bigint, boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const users = pgTable(
    "users",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        username: text("username").notNull().unique(),
        passwordHash: text("password_hash").notNull(),
        role: text("role").notNull().default("admin"),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [index("users_username_idx").on(table.username)],
);

export const sessions = pgTable(
    "sessions",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        tokenHash: text("token_hash").notNull().unique(),
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    },
    (table) => [index("sessions_user_id_idx").on(table.userId), index("sessions_expires_at_idx").on(table.expiresAt)],
);

export const files = pgTable(
    "files",
    {
        storageKey: text("storage_key").primaryKey(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        kind: text("kind").notNull(),
        path: text("path").notNull().unique(),
        originalName: text("original_name"),
        mimeType: text("mime_type").notNull(),
        bytes: bigint("bytes", { mode: "number" }).notNull(),
        width: integer("width"),
        height: integer("height"),
        durationMs: integer("duration_ms"),
        sha256: text("sha256"),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        deletedAt: timestamp("deleted_at", { withTimezone: true }),
    },
    (table) => [index("files_user_id_idx").on(table.userId), index("files_kind_idx").on(table.kind), index("files_deleted_at_idx").on(table.deletedAt)],
);

export const canvasProjects = pgTable(
    "canvas_projects",
    {
        id: text("id").primaryKey(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        title: text("title").notNull(),
        data: jsonb("data").notNull(),
        version: integer("version").notNull().default(1),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
        deletedAt: timestamp("deleted_at", { withTimezone: true }),
    },
    (table) => [index("canvas_projects_user_id_idx").on(table.userId), index("canvas_projects_updated_at_idx").on(table.updatedAt), index("canvas_projects_deleted_at_idx").on(table.deletedAt)],
);

export const assets = pgTable(
    "assets",
    {
        id: text("id").primaryKey(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        kind: text("kind").notNull(),
        title: text("title").notNull(),
        tags: jsonb("tags").notNull().default([]),
        coverStorageKey: text("cover_storage_key"),
        coverUrl: text("cover_url"),
        data: jsonb("data").notNull(),
        metadata: jsonb("metadata"),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
        deletedAt: timestamp("deleted_at", { withTimezone: true }),
    },
    (table) => [index("assets_user_id_idx").on(table.userId), index("assets_kind_idx").on(table.kind), index("assets_updated_at_idx").on(table.updatedAt), index("assets_deleted_at_idx").on(table.deletedAt)],
);

export const generationTasks = pgTable(
    "generation_tasks",
    {
        id: text("id").primaryKey(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        kind: text("kind").notNull(),
        status: text("status").notNull(),
        prompt: text("prompt").notNull().default(""),
        channelId: text("channel_id"),
        model: text("model"),
        config: jsonb("config").notNull().default({}),
        references: jsonb("references").notNull().default([]),
        result: jsonb("result").notNull().default({}),
        error: text("error"),
        providerTaskId: text("provider_task_id"),
        providerStatus: text("provider_status"),
        providerRequest: jsonb("provider_request"),
        providerResponse: jsonb("provider_response"),
        cancelRequested: boolean("cancel_requested").notNull().default(false),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
        startedAt: timestamp("started_at", { withTimezone: true }),
        completedAt: timestamp("completed_at", { withTimezone: true }),
        deletedAt: timestamp("deleted_at", { withTimezone: true }),
    },
    (table) => [index("generation_tasks_user_id_idx").on(table.userId), index("generation_tasks_status_idx").on(table.status), index("generation_tasks_kind_idx").on(table.kind), index("generation_tasks_created_at_idx").on(table.createdAt)],
);

export const aiChannels = pgTable(
    "ai_channels",
    {
        id: text("id").primaryKey(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        name: text("name").notNull(),
        baseUrl: text("base_url").notNull(),
        apiFormat: text("api_format").notNull().default("openai"),
        apiKey: text("api_key"),
        models: jsonb("models").notNull().default([]),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [index("ai_channels_user_id_idx").on(table.userId)],
);

export const userAiPreferences = pgTable("user_ai_preferences", {
    userId: uuid("user_id")
        .primaryKey()
        .references(() => users.id, { onDelete: "cascade" }),
    preferences: jsonb("preferences").notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userPreferences = pgTable("user_preferences", {
    userId: uuid("user_id")
        .primaryKey()
        .references(() => users.id, { onDelete: "cascade" }),
    theme: text("theme"),
    preferences: jsonb("preferences").notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userRelations = relations(users, ({ many, one }) => ({
    sessions: many(sessions),
    files: many(files),
    projects: many(canvasProjects),
    assets: many(assets),
    aiChannels: many(aiChannels),
    aiPreferences: one(userAiPreferences),
    preferences: one(userPreferences),
}));
