import { chamarHubPublico } from "@/lib/hub";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { token: string } }
) {
  return chamarHubPublico(`/api/auth/token/${encodeURIComponent(params.token)}`);
}
