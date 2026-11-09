import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const users=sqliteTable('users',{
  id:text('id').primaryKey(),login:text('login').notNull().unique(),name:text('name').notNull(),
  passwordHash:text('password_hash').notNull(),salt:text('salt').notNull(),role:text('role').notNull(),
});
export const sessions=sqliteTable('sessions',{
  tokenHash:text('token_hash').primaryKey(),userId:text('user_id').notNull().references(()=>users.id),expiresAt:integer('expires_at').notNull(),
});
export const datasets=sqliteTable('datasets',{
  id:text('id').primaryKey(),name:text('name').notNull(),version:text('version').notNull(),provenance:text('provenance').notNull(),
  payload:text('payload_json').notNull(),contentHash:text('content_hash').notNull(),createdAt:integer('created_at').notNull(),
});
export const scenarios=sqliteTable('scenarios',{
  id:text('id').primaryKey(),datasetId:text('dataset_id').notNull().references(()=>datasets.id),ownerId:text('owner_id').notNull().references(()=>users.id),
  name:text('name').notNull(),config:text('config_json').notNull(),createdAt:integer('created_at').notNull(),
});
export const runs=sqliteTable('runs',{
  id:text('id').primaryKey(),scenarioId:text('scenario_id').notNull().references(()=>scenarios.id),
  engineVersion:text('engine_version').notNull(),seed:integer('seed').notNull(),summary:text('summary_json').notNull(),createdAt:integer('created_at').notNull(),
});
export const auditEvents=sqliteTable('audit_events',{
  id:text('id').primaryKey(),userId:text('user_id').notNull().references(()=>users.id),action:text('action').notNull(),entityId:text('entity_id').notNull(),createdAt:integer('created_at').notNull(),
});
