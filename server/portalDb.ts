import { and, desc, eq, lt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { portalSessions, schoolPortalAccounts, schools, users } from "../drizzle/schema";
import { getDb } from "./db";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حالياً.");
  return db;
}

export type SchoolPortalRecord = {
  account: typeof schoolPortalAccounts.$inferSelect;
  school: typeof schools.$inferSelect;
  owner: typeof users.$inferSelect;
};

export async function registerSchoolPortal(input: {
  schoolName: string;
  stage: string;
  principalName: string;
  mobile: string;
  username: string;
  passwordHash: string;
}) {
  const db = await requireDb();
  const known = await db.select({ id: schoolPortalAccounts.id })
    .from(schoolPortalAccounts)
    .where(eq(schoolPortalAccounts.username, input.username))
    .limit(1);
  if (known[0]) return { kind: "username_taken" as const };

  const accountId = nanoid();
  const openId = `school:${accountId}`;
  await db.insert(users).values({
    openId,
    name: input.schoolName,
    email: null,
    loginMethod: "school_portal",
    role: "user",
    lastSignedIn: new Date(),
  });
  const owner = (await db.select().from(users).where(eq(users.openId, openId)).limit(1))[0];
  if (!owner) throw new Error("تعذّر إنشاء هوية المدرسة.");

  const schoolId = nanoid();
  await db.insert(schools).values({
    id: schoolId,
    ownerId: owner.id,
    name: input.schoolName,
    stage: input.stage,
    educationOffice: null,
    city: null,
  });
  await db.insert(schoolPortalAccounts).values({
    id: accountId,
    ownerId: owner.id,
    schoolId,
    principalName: input.principalName,
    mobile: input.mobile,
    username: input.username,
    passwordHash: input.passwordHash,
    status: "pending",
  });
  return { kind: "created" as const, accountId };
}

export async function getSchoolPortalByUsername(username: string): Promise<SchoolPortalRecord | null> {
  const db = await requireDb();
  const rows = await db.select({ account: schoolPortalAccounts, school: schools, owner: users })
    .from(schoolPortalAccounts)
    .innerJoin(schools, eq(schoolPortalAccounts.schoolId, schools.id))
    .innerJoin(users, eq(schoolPortalAccounts.ownerId, users.id))
    .where(eq(schoolPortalAccounts.username, username))
    .limit(1);
  return rows[0] || null;
}

export async function getSchoolPortalById(accountId: string): Promise<SchoolPortalRecord | null> {
  const db = await requireDb();
  const rows = await db.select({ account: schoolPortalAccounts, school: schools, owner: users })
    .from(schoolPortalAccounts)
    .innerJoin(schools, eq(schoolPortalAccounts.schoolId, schools.id))
    .innerJoin(users, eq(schoolPortalAccounts.ownerId, users.id))
    .where(eq(schoolPortalAccounts.id, accountId))
    .limit(1);
  return rows[0] || null;
}

export async function listSchoolPortals() {
  const db = await requireDb();
  return db.select({ account: schoolPortalAccounts, school: schools })
    .from(schoolPortalAccounts)
    .innerJoin(schools, eq(schoolPortalAccounts.schoolId, schools.id))
    .orderBy(desc(schoolPortalAccounts.createdAt));
}

export async function setSchoolPortalStatus(accountId: string, status: "active" | "suspended", supervisorId: string) {
  const db = await requireDb();
  await db.update(schoolPortalAccounts).set({
    status,
    activatedAt: status === "active" ? new Date() : null,
    activatedBy: supervisorId,
  }).where(eq(schoolPortalAccounts.id, accountId));
  return getSchoolPortalById(accountId);
}

export async function createPortalSession(input: {
  tokenHash: string;
  role: "supervisor" | "school";
  schoolAccountId?: string | null;
  expiresAt: Date;
}) {
  const db = await requireDb();
  await db.insert(portalSessions).values({
    tokenHash: input.tokenHash,
    role: input.role,
    schoolAccountId: input.schoolAccountId || null,
    expiresAt: input.expiresAt,
  });
}

export async function deletePortalSession(tokenHash: string) {
  const db = await requireDb();
  await db.delete(portalSessions).where(eq(portalSessions.tokenHash, tokenHash));
}

export async function getPortalSession(tokenHash: string) {
  const db = await requireDb();
  const rows = await db.select({ session: portalSessions, account: schoolPortalAccounts, school: schools, owner: users })
    .from(portalSessions)
    .leftJoin(schoolPortalAccounts, eq(portalSessions.schoolAccountId, schoolPortalAccounts.id))
    .leftJoin(schools, eq(schoolPortalAccounts.schoolId, schools.id))
    .leftJoin(users, eq(schoolPortalAccounts.ownerId, users.id))
    .where(eq(portalSessions.tokenHash, tokenHash))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.session.expiresAt.getTime() <= Date.now()) {
    await db.delete(portalSessions).where(eq(portalSessions.tokenHash, tokenHash));
    return null;
  }
  if (row.session.role === "school" && (!row.account || !row.school || !row.owner)) return null;
  return row;
}

export async function removeExpiredPortalSessions() {
  const db = await requireDb();
  await db.delete(portalSessions).where(lt(portalSessions.expiresAt, new Date()));
}
