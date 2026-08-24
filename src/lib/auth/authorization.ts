import "server-only";

import { redirect } from "next/navigation";
import { getSessionUser } from "./session";
import { roleHasPermission, type Permission } from "./permissions";
import { roleCanAccess } from "./users";
import type { SessionUser, UserRole } from "./types";
import { AppError, forbidden, unauthorized } from "@/server/errors";

function assertPasswordReady(user: SessionUser): void {
  if (user.mustChangePassword) {
    throw new AppError(
      "PASSWORD_CHANGE_REQUIRED",
      "Debes cambiar tu contraseña temporal antes de continuar.",
      403,
    );
  }
}

export async function requirePageRole(
  allowedRoles: readonly UserRole[],
): Promise<SessionUser> {
  const user = await getSessionUser();

  if (!user) {
    redirect("/login");
  }

  if (user.mustChangePassword) {
    redirect("/change-password");
  }

  if (!roleCanAccess(user.rol, allowedRoles)) {
    redirect(user.rol === "CONDUCTOR" ? "/conductor" : "/dashboard");
  }

  return user;
}

export async function requireApiRole(
  allowedRoles: readonly UserRole[],
): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw unauthorized();
  assertPasswordReady(user);
  if (!roleCanAccess(user.rol, allowedRoles)) throw forbidden();
  return user;
}

export async function requireApiPermission(
  permission: Permission,
): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw unauthorized();
  assertPasswordReady(user);
  if (!roleHasPermission(user.rol, permission)) throw forbidden();
  return user;
}
