import { NextResponse } from "next/server";
import { collectHeadlines, totalFeedCount, type FeedStatus, type Headline } from "@/lib/news";

export const revalidate = 300; // Cache for 5 minutes at the edge

export type HeadlinesResponse = {
  headlines: Headline[];
  feeds: FeedStatus[];
  feedHealth: string;
  generatedAt: string;
  message?: string;
};

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  const generatedAt = new Date().toISOString();

  try {
    const { headlines, feeds } = await collectHeadlines();
    const feedHealth = `${feeds.filter((feed) => feed.ok).length}/${totalFeedCount}`;

    if (headlines.length === 0) {
      return NextResponse.json<HeadlinesResponse>(
        {
          headlines: [],
          feeds,
          feedHealth,
          generatedAt,
          message: "Every station is silent right now. Try again in a minute.",
        },
        { status: 503, headers: NO_STORE },
      );
    }

    return NextResponse.json<HeadlinesResponse>(
      { headlines, feeds, feedHealth, generatedAt },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      },
    );
  } catch (error) {
    console.error("headlines: collection failed", error);
    return NextResponse.json<HeadlinesResponse>(
      {
        headlines: [],
        feeds: [],
        feedHealth: `0/${totalFeedCount}`,
        generatedAt,
        message: "The receiver hit a fault while tuning. Try again shortly.",
      },
      { status: 500, headers: NO_STORE },
    );
  }
}
