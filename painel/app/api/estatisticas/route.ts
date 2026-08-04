import type { NextRequest } from "next/server";
import { chamarHub } from "@/lib/hub";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const dias = req.nextUrl.searchParams.get("dias") ?? "30";
  return chamarHub(req, `/api/estatisticas?dias=${encodeURIComponent(dias)}`);
}
