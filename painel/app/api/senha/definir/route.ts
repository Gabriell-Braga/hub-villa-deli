import type { NextRequest } from "next/server";
import { chamarHubPublico } from "@/lib/hub";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.text();
  return chamarHubPublico("/api/auth/definir-senha", { method: "POST", body });
}
