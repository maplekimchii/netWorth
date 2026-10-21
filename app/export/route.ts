import { auth } from "@/auth";
import { today } from "@/lib/format";
import { exportXlsx } from "@/lib/importers";

export async function GET() {
  if (!(await auth())) return new Response("Sign in first.", { status: 401 });
  return new Response(new Uint8Array(await exportXlsx()), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="networth-${today()}.xlsx"`,
    },
  });
}
