import type { NextRequest } from "next/server";
import { chamarHub } from "@/lib/hub";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const aba = req.nextUrl.searchParams.get("aba") ?? "abertos";
  const limite = req.nextUrl.searchParams.get("limite") ?? "50";
  return chamarHub(
    req,
    `/api/pedidos?aba=${encodeURIComponent(aba)}&limite=${encodeURIComponent(limite)}`
  );
}
