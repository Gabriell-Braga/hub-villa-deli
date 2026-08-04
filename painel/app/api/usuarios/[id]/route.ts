import type { NextRequest } from "next/server";
import { chamarHub } from "@/lib/hub";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.text();
  return chamarHub(req, `/api/usuarios/${encodeURIComponent(params.id)}`, {
    method: "PATCH",
    body,
  });
}
