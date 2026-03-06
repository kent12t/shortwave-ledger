import { NextResponse } from "next/server";
import { collectHeadlines, totalFeedCount } from "@/lib/news";

export const revalidate = 300; // Cache for 5 minutes at the edge

export async function GET() {
  try {
    const { headlines, feedSuccess } = await collectHeadlines();

    if (headlines.length === 0) {
      return NextResponse.json(
        {
          headlines: [],
          generatedAt: new Date().toISOString(),
          feedHealth: `${feedSuccess}/${totalFeedCount}`,
          message: "No headlines available right now.",
        },
        { 
          status: 503,
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate",
          }
        },
      );
    }

    return NextResponse.json(
      {
        headlines,
        generatedAt: new Date().toISOString(),
        feedHealth: `${feedSuccess}/${totalFeedCount}`,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=59",
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    return NextResponse.json(
      {
        headlines: [],
        generatedAt: new Date().toISOString(),
        feedHealth: `0/${totalFeedCount}`,
        message,
      },
      { status: 500 },
    );
  }
}
