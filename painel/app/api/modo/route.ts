import type { NextRequest } from "next/server";
import { chamarHub } from "@/lib/hub";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return chamarHub(req, "/api/modo");
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  return chamarHub(req, "/api/modo/trocar", { method: "POST", body });
}
