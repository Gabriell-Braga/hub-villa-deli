import type { NextRequest } from "next/server";
import { chamarHub } from "@/lib/hub";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.text();
  return chamarHub(
    req,
    `/api/entrega/${encodeURIComponent(params.id)}/concluir`,
    { method: "POST", body }
  );
}
