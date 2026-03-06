import { XMLParser } from "fast-xml-parser";

export type Headline = {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: string;
  score: number;
};

type FeedSource = {
  name: string;
  url: string;
};

type ParsedEntry = {
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: string;
  topicKey: string;
};

const FEEDS: FeedSource[] = [
  { name: "BBC", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { name: "NPR", url: "https://feeds.npr.org/1001/rss.xml" },
  { name: "DW", url: "https://rss.dw.com/xml/rss-en-top" },
  { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { name: "Guardian", url: "https://www.theguardian.com/world/rss" },
  {
    name: "UN News",
    url: "https://news.un.org/feed/subscribe/en/news/all/rss.xml",
  },
];

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "for",
  "and",
  "or",
  "to",
  "of",
  "in",
  "on",
  "with",
  "from",
  "at",
  "by",
  "is",
  "are",
  "was",
  "were",
  "as",
  "after",
  "before",
  "amid",
  "over",
  "under",
  "new",
  "live",
  "says",
]);

const IMPACT_TERMS = [
  "war",
  "ceasefire",
  "election",
  "summit",
  "court",
  "market",
  "earthquake",
  "flood",
  "hurricane",
  "pandemic",
  "sanction",
  "policy",
  "climate",
  "attack",
  "peace",
  "protest",
  "inflation",
  "rates",
  "crisis",
  "refugee",
];

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    const keep = new URLSearchParams();

    ["id", "article", "story"].forEach((key) => {
      const found = url.searchParams.get(key);
      if (found) {
        keep.set(key, found);
      }
    });

    url.search = keep.toString();
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

function getTopicKey(title: string): string {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));

  return words.slice(0, 4).sort().join("|");
}

function impactScore(title: string, summary: string): number {
  const text = `${title} ${summary}`.toLowerCase();
  const hits = IMPACT_TERMS.reduce(
    (acc, term) => (text.includes(term) ? acc + 1 : acc),
    0,
  );

  return Math.min(hits / 4, 1);
}

function parseDate(value: string | undefined): string {
  if (!value) {
    return new Date().toISOString();
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return new Date().toISOString();
  }

  return new Date(parsed).toISOString();
}

function titleFromEntry(entry: Record<string, unknown>): string {
  const raw = entry.title;
  if (typeof raw === "string") {
    return stripTags(raw);
  }

  if (raw && typeof raw === "object" && "#text" in raw) {
    const text = (raw as { "#text"?: unknown })["#text"];
    if (typeof text === "string") {
      return stripTags(text);
    }
  }

  return "Untitled headline";
}

function summaryFromEntry(entry: Record<string, unknown>): string {
  const candidates = [entry.description, entry.summary, entry.content];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return stripTags(candidate);
    }

    if (candidate && typeof candidate === "object" && "#text" in candidate) {
      const text = (candidate as { "#text"?: unknown })["#text"];
      if (typeof text === "string" && text.trim().length > 0) {
        return stripTags(text);
      }
    }
  }

  return "Tap read further for the full report.";
}

function linkFromEntry(entry: Record<string, unknown>): string {
  const rawLink = entry.link;
  if (typeof rawLink === "string") {
    return canonicalUrl(rawLink);
  }

  if (rawLink && typeof rawLink === "object" && "@_href" in rawLink) {
    const href = (rawLink as { "@_href"?: unknown })["@_href"];
    if (typeof href === "string") {
      return canonicalUrl(href);
    }
  }

  return "#";
}

function parseRss(xml: string, sourceName: string): ParsedEntry[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: true,
    trimValues: true,
  });

  const parsed = parser.parse(xml) as Record<string, unknown>;
  const rssItems = toArray(
    ((parsed.rss as Record<string, unknown>)?.channel as Record<string, unknown>)
      ?.item as Record<string, unknown> | Record<string, unknown>[] | undefined,
  );

  const atomItems = toArray(
    (parsed.feed as Record<string, unknown>)?.entry as
      | Record<string, unknown>
      | Record<string, unknown>[]
      | undefined,
  );

  return [...rssItems, ...atomItems]
    .map((entry) => {
      const title = titleFromEntry(entry);
      const summary = summaryFromEntry(entry);
      const url = linkFromEntry(entry);
      const publishedAt = parseDate(
        typeof entry.pubDate === "string"
          ? entry.pubDate
          : typeof entry.published === "string"
            ? entry.published
            : typeof entry.updated === "string"
              ? entry.updated
              : typeof entry["dc:date"] === "string"
                ? (entry["dc:date"] as string)
                : undefined,
      );

      return {
        title,
        summary,
        url,
        source: sourceName,
        publishedAt,
        topicKey: getTopicKey(title),
      };
    })
    .filter((entry) => entry.url !== "#" && entry.title.length > 15);
}

function dedupeEntries(entries: ParsedEntry[]): ParsedEntry[] {
  const byUrl = new Map<string, ParsedEntry>();
  const byTitle = new Map<string, ParsedEntry>();

  for (const entry of entries) {
    const urlKey = canonicalUrl(entry.url);
    const titleKey = entry.title.toLowerCase().replace(/[^a-z0-9]/g, "");

    if (!byUrl.has(urlKey)) {
      byUrl.set(urlKey, entry);
    }

    if (!byTitle.has(titleKey)) {
      byTitle.set(titleKey, entry);
    }
  }

  const combined = new Map<string, ParsedEntry>();
  [...byUrl.values(), ...byTitle.values()].forEach((entry) => {
    combined.set(`${entry.source}:${entry.url}`, entry);
  });

  return [...combined.values()];
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 2,
): Promise<Response> {
  try {
    const response = await fetch(url, options);
    if (!response.ok && retries > 0) {
      throw new Error(`Retrying ${url}...`);
    }
    return response;
  } catch (err) {
    if (retries > 0) {
      // Exponential backoff: 500ms, then 1000ms
      await new Promise((res) => setTimeout(res, (3 - retries) * 500));
      return fetchWithRetry(url, options, retries - 1);
    }
    throw err;
  }
}

export async function collectHeadlines(): Promise<{
  headlines: Headline[];
  feedSuccess: number;
}> {
  const now = Date.now();

  const feedResults = await Promise.allSettled(
    FEEDS.map(async (feed) => {
      const response = await fetchWithRetry(
        feed.url,
        {
          cache: "no-store",
          headers: {
            "User-Agent": "ShortwaveLedger/1.0",
          },
          signal: AbortSignal.timeout(8000),
        },
        1, // 1 retry
      );

      if (!response.ok) {
        throw new Error(`Feed ${feed.name} failed: ${response.status}`);
      }

      const xml = await response.text();
      return parseRss(xml, feed.name);
    }),
  );

  const feedSuccess = feedResults.filter(
    (result) => result.status === "fulfilled",
  ).length;

  const merged = feedResults.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );

  const entries = dedupeEntries(merged);
  const coverage = new Map<string, Set<string>>();
  const sourceDensity = new Map<string, number>();

  for (const entry of entries) {
    if (!coverage.has(entry.topicKey)) {
      coverage.set(entry.topicKey, new Set());
    }

    coverage.get(entry.topicKey)?.add(entry.source);
    sourceDensity.set(entry.source, (sourceDensity.get(entry.source) ?? 0) + 1);
  }

  const ranked = entries
    .map((entry) => {
      const hoursOld = Math.max(
        0,
        (now - new Date(entry.publishedAt).getTime()) / (1000 * 60 * 60),
      );
      const recency = Math.exp(-hoursOld / 24);
      const consensus = Math.min(
        (coverage.get(entry.topicKey)?.size ?? 1) / 4,
        1,
      );
      const sourceShare = (sourceDensity.get(entry.source) ?? 1) / entries.length;
      const diversityBoost = Math.max(0, 1 - sourceShare * 4);
      const impact = impactScore(entry.title, entry.summary);
      const score =
        0.45 * consensus + 0.3 * recency + 0.15 * impact + 0.1 * diversityBoost;

      return {
        ...entry,
        id: `${entry.source}-${entry.url}`,
        score,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 36)
    .map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
      url: item.url,
      source: item.source,
      publishedAt: item.publishedAt,
      score: Number(item.score.toFixed(4)),
    }));

  return {
    headlines: ranked,
    feedSuccess,
  };
}

export const totalFeedCount = FEEDS.length;
