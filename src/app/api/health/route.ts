import { NextResponse } from "next/server";
import { totalFeedCount } from "@/lib/news";

export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      timestamp: new Date().toISOString(),
      feedsConfigured: totalFeedCount,
    },
    { status: 200 }
  );
}
