import type { NextRequest } from "next/server";
import { chamarHub } from "@/lib/hub";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return chamarHub(req, "/api/diagnostico");
}
