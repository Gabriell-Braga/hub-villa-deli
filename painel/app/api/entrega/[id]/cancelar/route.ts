import type { NextRequest } from "next/server";
import { chamarHub } from "@/lib/hub";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  return chamarHub(
    req,
    `/api/entrega/${encodeURIComponent(params.id)}/cancelar`,
    { method: "POST" }
  );
}
