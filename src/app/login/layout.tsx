import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";

export default async function LoginLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  try {
    const user = await getSessionUser();
    if (user) {
      redirect(
        user.mustChangePassword
          ? "/change-password"
          : user.rol === "CONDUCTOR"
            ? "/conductor"
            : "/dashboard",
      );
    }
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "digest" in error &&
      typeof (error as { digest?: string }).digest === "string" &&
      (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
    ) {
      throw error;
    }
  }
  return children;
}
