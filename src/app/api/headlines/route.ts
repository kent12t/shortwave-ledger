import { NextResponse } from "next/server";
import { collectHeadlines, totalFeedCount } from "@/lib/news";

export const revalidate = 0;

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
        { status: 503 },
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
          "Cache-Control": "no-store",
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
