import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { FixedWindowLimiter } from "./anonymousSession";
import { createPortalSession, deletePortalSession, getPortalSession, getSchoolPortalByUsername, listSchoolPortals, registerSchoolPortal, setSchoolPortalStatus } from "./portalDb";
import { createPortalSessionToken, hashPortalPassword, hashPortalSessionToken, PORTAL_SESSION_COOKIE, readPortalSessionToken, verifyPortalPassword, verifySupervisorAccessCode } from "./portalSecurity";
import { publicProcedure, router } from "./_core/trpc";

const loginLimiter = new FixedWindowLimiter(5, 15 * 60 * 1000);
const registrationInput = z.object({
  schoolName: z.string().trim().min(3, "أدخلي اسم المدرسة.").max(240),
  stage: z.string().trim().min(2, "حددي المرحلة التعليمية.").max(120),
  principalName: z.string().trim().min(3, "أدخلي اسم مدير المدرسة.").max(240),
  mobile: z.string().trim().regex(/^[0-9+\s-]{9,24}$/, "أدخلي رقم جوال صحيحاً."),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{4,80}$/, "اسم المستخدم من 4 أحرف أو أرقام إنجليزية على الأقل."),
  password: z.string().min(8, "كلمة المرور لا تقل عن 8 أحرف.").max(128),
});

function requestKey(ctx: { req: { ip?: string; socket?: { remoteAddress?: string } } }) {
  const address = ctx.req.ip || ctx.req.socket?.remoteAddress || "unknown";
  return createHash("sha256").update(address).digest("hex");
}

async function issueSession(ctx: { req: any; res: any }, role: "supervisor" | "school", schoolAccountId?: string) {
  const token = createPortalSessionToken();
  const maxAge = role === "supervisor" ? 12 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
  await createPortalSession({
    tokenHash: hashPortalSessionToken(token),
    role,
    schoolAccountId: schoolAccountId || null,
    expiresAt: new Date(Date.now() + maxAge),
  });
  ctx.res.cookie(PORTAL_SESSION_COOKIE, token, {
    ...getSessionCookieOptions(ctx.req),
    sameSite: "lax",
    maxAge,
  });
}

export async function readActiveSchoolPortal(cookieHeader?: string) {
  const token = readPortalSessionToken(cookieHeader);
  if (!token) return null;
  const session = await getPortalSession(hashPortalSessionToken(token));
  if (!session || session.session.role !== "school" || !session.account || !session.owner || session.account.status !== "active") return null;
  return { account: session.account, school: session.school!, owner: session.owner };
}

async function requireSupervisor(ctx: { req: { headers: { cookie?: string } } }) {
  const token = readPortalSessionToken(ctx.req.headers.cookie);
  const session = token ? await getPortalSession(hashPortalSessionToken(token)) : null;
  if (!session || session.session.role !== "supervisor") {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "تتطلب هذه الصفحة دخول المشرف." });
  }
  return session;
}

async function requireSchool(ctx: { req: { headers: { cookie?: string } } }) {
  const active = await readActiveSchoolPortal(ctx.req.headers.cookie);
  if (!active) throw new TRPCError({ code: "UNAUTHORIZED", message: "سجلي الدخول بحساب مدرسة مُفعّل أولاً." });
  return active;
}

export const portalRouter = router({
  me: publicProcedure.query(async ({ ctx }) => {
    const token = readPortalSessionToken(ctx.req.headers.cookie);
    const session = token ? await getPortalSession(hashPortalSessionToken(token)) : null;
    if (!session) return { authenticated: false as const };
    if (session.session.role === "supervisor") return { authenticated: true as const, role: "supervisor" as const };
    if (!session.account || !session.school) return { authenticated: false as const };
    return {
      authenticated: session.account.status === "active",
      role: "school" as const,
      status: session.account.status,
      school: {
        id: session.school.id,
        name: session.school.name,
        stage: session.school.stage,
        principalName: session.account.principalName,
        mobile: session.account.mobile,
        username: session.account.username,
      },
    };
  }),
  registerSchool: publicProcedure.input(registrationInput).mutation(async ({ input }) => {
    const passwordHash = await hashPortalPassword(input.password);
    const result = await registerSchoolPortal({ ...input, passwordHash });
    if (result.kind === "username_taken") {
      throw new TRPCError({ code: "CONFLICT", message: "اسم المستخدم مستخدم بالفعل. اختاري اسماً مختلفاً." });
    }
    return { status: "pending" as const, accountId: result.accountId };
  }),
  schoolLogin: publicProcedure.input(z.object({ username: z.string().trim().toLowerCase().min(1), password: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    const key = requestKey(ctx);
    if (!loginLimiter.allow(`school:${key}`)) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "تم تجاوز محاولات الدخول. حاولي بعد 15 دقيقة." });
    const record = await getSchoolPortalByUsername(input.username);
    const valid = record ? await verifyPortalPassword(input.password, record.account.passwordHash) : false;
    if (!record || !valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "اسم المستخدم أو كلمة المرور غير صحيحين." });
    if (record.account.status === "pending") throw new TRPCError({ code: "FORBIDDEN", message: "تم استلام طلب المدرسة وهو بانتظار تفعيل المشرف." });
    if (record.account.status === "suspended") throw new TRPCError({ code: "FORBIDDEN", message: "تم إيقاف حساب المدرسة. تواصلي مع المشرف." });
    await issueSession(ctx, "school", record.account.id);
    return { role: "school" as const, schoolName: record.school.name };
  }),
  supervisorLogin: publicProcedure.input(z.object({ accessCode: z.string().trim().min(1).max(32) })).mutation(async ({ ctx, input }) => {
    const key = requestKey(ctx);
    if (!loginLimiter.allow(`supervisor:${key}`)) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "تم تجاوز محاولات الدخول. حاولي بعد 15 دقيقة." });
    if (!verifySupervisorAccessCode(input.accessCode)) throw new TRPCError({ code: "UNAUTHORIZED", message: "بيانات دخول المشرف غير صحيحة." });
    await issueSession(ctx, "supervisor");
    return { role: "supervisor" as const };
  }),
  logout: publicProcedure.mutation(async ({ ctx }) => {
    const token = readPortalSessionToken(ctx.req.headers.cookie);
    if (token) await deletePortalSession(hashPortalSessionToken(token));
    ctx.res.clearCookie(PORTAL_SESSION_COOKIE, { ...getSessionCookieOptions(ctx.req), sameSite: "lax" });
    return { success: true as const };
  }),
  school: router({
    profile: publicProcedure.query(async ({ ctx }) => {
      const active = await requireSchool(ctx);
      return {
        school: { id: active.school.id, name: active.school.name, stage: active.school.stage },
        principalName: active.account.principalName,
        mobile: active.account.mobile,
        username: active.account.username,
        activatedAt: active.account.activatedAt,
      };
    }),
  }),
  supervisor: router({
    schools: publicProcedure.query(async ({ ctx }) => {
      await requireSupervisor(ctx);
      const rows = await listSchoolPortals();
      return rows.map(({ account, school }) => ({
        id: account.id,
        schoolName: school.name,
        stage: school.stage,
        principalName: account.principalName,
        mobile: account.mobile,
        username: account.username,
        status: account.status,
        createdAt: account.createdAt,
        activatedAt: account.activatedAt,
      }));
    }),
    setSchoolStatus: publicProcedure.input(z.object({ accountId: z.string().min(1).max(24), status: z.enum(["active", "suspended"]) })).mutation(async ({ ctx, input }) => {
      await requireSupervisor(ctx);
      const record = await setSchoolPortalStatus(input.accountId, input.status, "supervisor");
      if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "حساب المدرسة غير موجود." });
      return { id: record.account.id, status: record.account.status, schoolName: record.school.name };
    }),
  }),
});
