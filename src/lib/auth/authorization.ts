import "server-only";

import { redirect } from "next/navigation";
import { getSessionUser } from "./session";
import { roleCanAccess } from "./users";
import type { SessionUser, UserRole } from "./types";
import { forbidden, unauthorized } from "@/server/errors";

export async function requirePageRole(
  allowedRoles: readonly UserRole[],
): Promise<SessionUser> {
  const user = await getSessionUser();

  if (!user) {
    redirect("/login");
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
  if (!roleCanAccess(user.rol, allowedRoles)) throw forbidden();
  return user;
}
