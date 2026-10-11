import {
  customType,
  primaryKey,
  decimal,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const uploadRateLimits = mysqlTable("uploadRateLimits", {
  bucketKey: varchar("bucketKey", { length: 64 }).primaryKey(),
  windowStart: int("windowStart").notNull(),
  requestCount: int("requestCount").notNull().default(0),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const schools = mysqlTable("schools", {
  id: varchar("id", { length: 24 }).primaryKey(),
  ownerId: int("ownerId").notNull(),
  name: varchar("name", { length: 240 }).notNull(),
  educationOffice: varchar("educationOffice", { length: 240 }),
  city: varchar("city", { length: 120 }),
  stage: varchar("stage", { length: 120 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** A school-owned account is activated by the supervisor before it can access reports. */
export const schoolPortalAccounts = mysqlTable("schoolPortalAccounts", {
  id: varchar("id", { length: 24 }).primaryKey(),
  ownerId: int("ownerId").notNull().unique(),
  schoolId: varchar("schoolId", { length: 24 }).notNull().unique(),
  principalName: varchar("principalName", { length: 240 }).notNull(),
  mobile: varchar("mobile", { length: 24 }).notNull(),
  username: varchar("username", { length: 80 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  status: mysqlEnum("status", ["pending", "active", "suspended"]).default("pending").notNull(),
  activatedAt: timestamp("activatedAt"),
  activatedBy: varchar("activatedBy", { length: 24 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Only the digest of a browser-held random session token is stored. */
export const portalSessions = mysqlTable("portalSessions", {
  tokenHash: varchar("tokenHash", { length: 64 }).primaryKey(),
  role: mysqlEnum("role", ["supervisor", "school"]).notNull(),
  schoolAccountId: varchar("schoolAccountId", { length: 24 }),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const evaluationReports = mysqlTable("evaluationReports", {
  id: varchar("id", { length: 24 }).primaryKey(),
  ownerId: int("ownerId").notNull(),
  schoolId: varchar("schoolId", { length: 24 }).notNull(),
  fileName: varchar("fileName", { length: 300 }).notNull(),
  fileKey: varchar("fileKey", { length: 600 }).notNull(),
  fileUrl: varchar("fileUrl", { length: 900 }).notNull(),
  status: mysqlEnum("status", ["processing", "completed", "failed"])
    .default("processing")
    .notNull(),
  errorMessage: text("errorMessage"),
  overallScore: decimal("overallScore", { precision: 5, scale: 2 }),
  overallScoreEvidence: text("overallScoreEvidence"),
  analyzedAt: timestamp("analyzedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const evaluationReportDomains = mysqlTable("evaluationReportDomains", {
  id: varchar("id", { length: 24 }).primaryKey(),
  reportId: varchar("reportId", { length: 24 }).notNull(),
  domainName: varchar("domainName", { length: 240 }).notNull(),
  score: decimal("score", { precision: 5, scale: 2 }).notNull(),
  scoreEvidence: text("scoreEvidence"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const evaluationCriteria = mysqlTable("evaluationCriteria", {
  id: varchar("id", { length: 24 }).primaryKey(),
  reportId: varchar("reportId", { length: 24 }).notNull(),
  domainName: varchar("domainName", { length: 240 }).notNull(),
  criterionCode: varchar("criterionCode", { length: 80 }).notNull(),
  criterionName: text("criterionName").notNull(),
  score: decimal("score", { precision: 5, scale: 2 }).notNull(),
  classification: mysqlEnum("classification", ["strength", "weakness"]).notNull(),
  priority: mysqlEnum("priority", ["low", "medium", "high", "critical"])
    .notNull(),
  evidence: text("evidence").notNull(),
  treatment: text("treatment").notNull(),
  treatmentSource: mysqlEnum("treatmentSource", ["extracted", "suggested"])
    .notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const improvementPlans = mysqlTable("improvementPlans", {
  id: varchar("id", { length: 24 }).primaryKey(),
  ownerId: int("ownerId").notNull(),
  reportId: varchar("reportId", { length: 24 }).notNull(),
  criterionId: varchar("criterionId", { length: 24 }).notNull().unique(),
  targetScore: decimal("targetScore", { precision: 5, scale: 2 }).notNull(),
  needDescription: text("needDescription").notNull(),
  improvementActions: text("improvementActions").notNull(),
  implementationMechanism: text("implementationMechanism").notNull(),
  startDate: varchar("startDate", { length: 10 }),
  endDate: varchar("endDate", { length: 10 }),
  responsibleName: varchar("responsibleName", { length: 240 }),
  status: mysqlEnum("status", ["planned", "in_progress", "completed"]).default("planned").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type ImprovementPlan = typeof improvementPlans.$inferSelect;

// Chunked blobs fit TiDB's individual-row limits and survive free-host restarts.
const binaryChunk = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() { return "mediumblob"; },
});
export const reportFileChunks = mysqlTable("reportFileChunks", {
  fileKey: varchar("fileKey", { length: 512 }).notNull(),
  chunkIndex: int("chunkIndex").notNull(),
  content: binaryChunk("content").notNull(),
}, table => [primaryKey({ columns: [table.fileKey, table.chunkIndex] })]);
