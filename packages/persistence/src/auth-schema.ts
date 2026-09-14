import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Better Auth's own canonical identity tables (Sprint 9, DEC-089) — the
 * single source of truth for authentication identity, never duplicated by
 * a second "Ritmo User" table. Field names/types/constraints here were
 * derived directly from Better Auth 1.7.4's own `getSchema()` function
 * (`better-auth/db`) called with our real config (email/password enabled),
 * not guessed from documentation — see docs/DECISIONS.md DEC-095. These
 * tables are owned by Better Auth; this codebase never writes to them
 * directly except through `auth.api.*` — see
 * `apps/ritmo/src/functions/auth.ts`.
 *
 * Unlike the rest of this schema (where every date is an explicit calendar
 * string — see `schema.ts`'s own header comment), these ARE real wall-clock
 * instants (session expiry, token issuance) — `timestamp` is the correct
 * column type here, not `text`.
 */
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull(),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  /** Only present for the "credential" (email/password) provider — hashed by Better Auth, never touched here. */
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

// Re-exported so drizzle-kit's schema introspection (pointed at schema.ts
// only, per drizzle.config.ts) picks these tables up transitively.
export const authSchema = { user, session, account, verification };
