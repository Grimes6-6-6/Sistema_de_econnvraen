import { requireApiRole } from "@/lib/auth/authorization";
import { getOperationalDocumentFile } from "@/server/admin/documents";
import { handleRouteError } from "@/server/http";

export const runtime = "nodejs";

function contentDisposition(filename: string, preview: boolean): string {
  const fallback = filename.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 120) || "documento";
  const disposition = preview ? "inline" : "attachment";
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiRole([
      "SUPER_ADMIN",
      "ADMINISTRADOR",
      "CONDUCTOR",
    ]);
    const { id } = await params;
    const file = await getOperationalDocumentFile(user, id);
    const preview = new URL(request.url).searchParams.get("preview") === "1";
    return new Response(new Uint8Array(file.contents), {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": contentDisposition(file.name, preview),
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Type": file.mimeType,
        "Cross-Origin-Resource-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
