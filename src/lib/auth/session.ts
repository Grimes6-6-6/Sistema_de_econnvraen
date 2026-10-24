import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { SessionUser, UserRole } from "./types";
import { parseEntityId } from "@/lib/domain/ids";
import { query } from "@/server/db/pool";
import { forbidden, unauthorized } from "@/server/errors";

const SESSION_COOKIE_NAME =
  process.env.NODE_ENV === "production"
    ? "__Host-econnvrae_session"
    : "econnvrae_session";
const SESSION_DURATION_SECONDS = 8 * 60 * 60;
const SESSION_IDLE_TIMEOUT_MINUTES = 30;
const SMS_CHALLENGE_DURATION_SECONDS = 10 * 60;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

interface SessionRow {
  id_usuario: number;
  username: string;
  rol: UserRole;
  nombres: string | null;
  apellidos: string | null;
  dni: string | null;
  id_conductor: number | null;
  id_agencia: number | null;
  agencia_nombre: string | null;
  must_change_password: boolean;
}

interface SmsChallengeRow extends SessionRow {
  telefono: string | null;
  sms_code_hash: string | null;
  sms_expires_at: Date | null;
}

export interface SmsChallenge {
  tokenHash: string;
  userId: number;
  user: SessionUser;
  phone: string | null;
  smsCodeHash: string | null;
  smsExpiresAt: Date | null;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function numericUserId(user: SessionUser): number {
  const match = /^U(\d{3,10})$/.exec(user.id);
  if (!match) throw new Error("INVALID_SESSION_USER_ID");
  return Number(match[1]);
}

function numericAgencyId(user: SessionUser): number | null {
  if (!user.agenciaId) return null;
  const match = /^A(\d{2,10})$/.exec(user.agenciaId);
  if (!match) throw new Error("INVALID_SESSION_AGENCY_ID");
  return Number(match[1]);
}

function toSessionUser(row: SessionRow): SessionUser {
  return {
    id: `U${String(row.id_usuario).padStart(3, "0")}`,
    username: row.username,
    nombres: row.nombres || "Usuario",
    apellidos: row.apellidos || "",
    rol: row.rol,
    dni: row.dni || "",
    conductorId:
      row.id_conductor === null
        ? null
        : `C${String(row.id_conductor).padStart(2, "0")}`,
    agenciaId:
      row.id_agencia === null
        ? null
        : `A${String(row.id_agencia).padStart(3, "0")}`,
    agenciaNombre: row.agencia_nombre,
    mustChangePassword: row.must_change_password,
  };
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token || !SESSION_TOKEN_PATTERN.test(token)) return null;

  const result = await query<SessionRow>(
    `SELECT
       u.id_usuario,
       u.username,
       r.nombre AS rol,
       p.nombres,
       p.apellidos,
       p.nro_documento AS dni,
       driver.id_conductor,
       s.id_agencia_activa AS id_agencia,
       agency.nombre AS agencia_nombre
       , u.must_change_password
     FROM sesiones s
     JOIN usuarios u ON u.id_usuario = s.id_usuario
     JOIN roles r ON r.id_rol = u.id_rol
     LEFT JOIN personas p ON p.id_persona = u.id_persona
     LEFT JOIN conductores driver ON driver.id_persona = u.id_persona
     LEFT JOIN agencias agency
       ON agency.id_agencia = s.id_agencia_activa
      AND agency.estado = 'ACTIVA'
     WHERE s.token_hash = $1
       AND s.revoked_at IS NULL
       AND s.expires_at > NOW()
       AND s.last_seen_at > NOW() - ($2::integer * INTERVAL '1 minute')
       AND s.created_at >= u.password_changed_at
       AND u.estado = 'ACTIVO'
       AND (u.must_change_password = TRUE OR s.mfa_verified_at IS NOT NULL)
       AND (
         u.must_change_password = FALSE
         OR u.temporary_password_expires_at > NOW()
       )
       AND agency.id_agencia IS NOT NULL
       AND (
         r.nombre = 'SUPER_ADMIN'
         OR EXISTS (
           SELECT 1
           FROM usuarios_agencias membership
           WHERE membership.id_usuario = u.id_usuario
             AND membership.id_agencia = s.id_agencia_activa
             AND membership.estado = 'ACTIVO'
         )
       )
     LIMIT 1`,
    [hashToken(token), SESSION_IDLE_TIMEOUT_MINUTES],
  );
  if (!result.rows[0]) return null;
  await query(
    "UPDATE sesiones SET last_seen_at = NOW() WHERE token_hash = $1",
    [hashToken(token)],
  );
  return toSessionUser(result.rows[0]);
}

export async function createSession(
  user: SessionUser,
  metadata?: { ipHash?: string | null; userAgent?: string | null },
  options?: { secondFactorVerified?: boolean; smsChallenge?: boolean },
): Promise<{ tokenHash: string; userId: number }> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const userId = numericUserId(user);
  const agencyId = numericAgencyId(user);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_SECONDS * 1000);
  const smsChallengeExpiresAt = options?.smsChallenge
    ? new Date(Date.now() + SMS_CHALLENGE_DURATION_SECONDS * 1000)
    : null;

  await query(
    `INSERT INTO sesiones (
       token_hash, id_usuario, id_agencia_activa, expires_at, ip_hash, user_agent,
       mfa_verified_at, mfa_challenge_expires_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      tokenHash,
      userId,
      agencyId,
      expiresAt,
      metadata?.ipHash || null,
      metadata?.userAgent?.slice(0, 255) || null,
      options?.secondFactorVerified ? new Date() : null,
      smsChallengeExpiresAt,
    ],
  );

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    priority: "high",
    maxAge: SESSION_DURATION_SECONDS,
    path: "/",
  });
  return { tokenHash, userId };
}

export async function getSmsChallenge(): Promise<SmsChallenge | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token || !SESSION_TOKEN_PATTERN.test(token)) return null;
  const tokenHash = hashToken(token);

  const result = await query<SmsChallengeRow>(
    `SELECT
       u.id_usuario,
       u.username,
       r.nombre AS rol,
       p.nombres,
       p.apellidos,
       p.nro_documento AS dni,
       driver.id_conductor,
       s.id_agencia_activa AS id_agencia,
       agency.nombre AS agencia_nombre,
       u.must_change_password,
       p.telefono,
       s.sms_code_hash,
       s.sms_expires_at
     FROM sesiones s
     JOIN usuarios u ON u.id_usuario = s.id_usuario
     JOIN roles r ON r.id_rol = u.id_rol
     LEFT JOIN personas p ON p.id_persona = u.id_persona
     LEFT JOIN conductores driver ON driver.id_persona = u.id_persona
     LEFT JOIN agencias agency
       ON agency.id_agencia = s.id_agencia_activa
      AND agency.estado = 'ACTIVA'
     WHERE s.token_hash = $1
       AND s.revoked_at IS NULL
       AND s.expires_at > NOW()
       AND s.mfa_verified_at IS NULL
       AND s.mfa_challenge_expires_at > NOW()
       AND s.created_at >= u.password_changed_at
       AND u.estado = 'ACTIVO'
       AND u.must_change_password = FALSE
       AND agency.id_agencia IS NOT NULL
       AND (
         r.nombre = 'SUPER_ADMIN'
         OR EXISTS (
           SELECT 1
           FROM usuarios_agencias membership
           WHERE membership.id_usuario = u.id_usuario
             AND membership.id_agencia = s.id_agencia_activa
             AND membership.estado = 'ACTIVO'
         )
       )
     LIMIT 1`,
    [tokenHash],
  );

  const row = result.rows[0];
  if (!row) return null;
  return {
    tokenHash,
    userId: row.id_usuario,
    user: toSessionUser(row),
    phone: row.telefono,
    smsCodeHash: row.sms_code_hash,
    smsExpiresAt: row.sms_expires_at,
  };
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  try {
    if (token && SESSION_TOKEN_PATTERN.test(token)) {
      await query(
        "UPDATE sesiones SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL",
        [hashToken(token)],
      );
    }
  } finally {
    cookieStore.set(SESSION_COOKIE_NAME, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      priority: "high",
      maxAge: 0,
      path: "/",
    });
  }
}

export async function switchSessionAgency(
  agencyValue: string,
): Promise<SessionUser> {
  const agencyId = parseEntityId(agencyValue, "A");
  if (!agencyId) throw forbidden("La agencia seleccionada no es válida.");

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token || !SESSION_TOKEN_PATTERN.test(token)) throw unauthorized();

  const updated = await query(
    `UPDATE sesiones session
     SET id_agencia_activa = $2
     FROM usuarios user_account
     JOIN roles role ON role.id_rol = user_account.id_rol
     WHERE session.token_hash = $1
       AND session.id_usuario = user_account.id_usuario
       AND session.revoked_at IS NULL
       AND session.expires_at > NOW()
       AND user_account.estado = 'ACTIVO'
       AND EXISTS (
         SELECT 1
         FROM agencias agency
         WHERE agency.id_agencia = $2
           AND agency.estado = 'ACTIVA'
       )
       AND (
         role.nombre = 'SUPER_ADMIN'
         OR EXISTS (
           SELECT 1
           FROM usuarios_agencias membership
           WHERE membership.id_usuario = user_account.id_usuario
             AND membership.id_agencia = $2
             AND membership.estado = 'ACTIVO'
         )
       )
     RETURNING session.token_hash`,
    [hashToken(token), agencyId],
  );

  if (!updated.rowCount) {
    throw forbidden("No tienes acceso a la agencia seleccionada.");
  }

  const user = await getSessionUser();
  if (!user) throw unauthorized();
  return user;
}
