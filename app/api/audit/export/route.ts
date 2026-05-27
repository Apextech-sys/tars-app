import { type NextRequest, NextResponse } from "next/server";
import { exportAuditCsv } from "@/app/audit/actions";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const csv = await exportAuditCsv({
    runId: searchParams.get("runId") ?? undefined,
    steps: searchParams.getAll("step"),
    repos: searchParams.getAll("repo"),
    dateFrom: searchParams.get("dateFrom") ?? undefined,
    dateTo: searchParams.get("dateTo") ?? undefined,
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="audit-log.csv"',
    },
  });
}
