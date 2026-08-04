import type { NextRequest } from "next/server";
import { chamarHub } from "@/lib/hub";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  return chamarHub(req, `/api/cotacao/${encodeURIComponent(params.id)}`);
}
