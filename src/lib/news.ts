import { XMLParser } from "fast-xml-parser";

export type Coverage = {
  source: string;
  title: string;
  url: string;
};

export type Headline = {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: string;
  score: number;
  /** Every independent outlet carrying this story, lead source first. */
  coverage: Coverage[];
};

export type FeedStatus = {
  name: string;
  ok: boolean;
};

type FeedSource = {
  name: string;
  url: string;
};

export type ParsedEntry = {
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: string;
  /** Position of the item within its feed (0 = editor's top pick). */
  position: number;
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

export const totalFeedCount = FEEDS.length;

/** How many stories end up on the dial. */
const MAX_STATIONS = 24;
/** Stories older than this are dropped before ranking. */
const MAX_AGE_HOURS = 72;
/** Minimum weighted token overlap for two headlines to count as one story. */
const SAME_STORY_THRESHOLD = 0.5;

// ── text helpers ─────────────────────────────────────────────────────────────

const STOP_WORDS = new Set(
  (
    "the a an for and or nor but to of in on with from at by is are was were be been being as " +
    "after before amid over under into onto about against between during without within " +
    "new live says say said its it this that these those than then there their they them " +
    "his her him she he who whom whose what when where why how which will would could should " +
    "can may might must has have had not no yes more most less least up down out off very " +
    "just also still now first last year years day days week weeks month months time report " +
    "reports latest update updates news video watch explained analysis opinion how why what"
  ).split(/\s+/),
);

const IMPACT_TERMS = [
  "war",
  "ceasefire",
  "truce",
  "election",
  "summit",
  "court",
  "verdict",
  "market",
  "earthquake",
  "flood",
  "hurricane",
  "typhoon",
  "wildfire",
  "pandemic",
  "outbreak",
  "sanction",
  "tariff",
  "climate",
  "attack",
  "strike",
  "killed",
  "dead",
  "peace",
  "protest",
  "inflation",
  "rates",
  "crisis",
  "refugee",
  "famine",
  "coup",
  "resign",
  "invasion",
  "treaty",
];

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#039;": "'",
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&mdash;": "—",
  "&ndash;": "–",
  "&lsquo;": "‘",
  "&rsquo;": "’",
  "&ldquo;": "“",
  "&rdquo;": "”",
  "&hellip;": "…",
};

function decodeEntities(value: string): string {
  return value.replace(/&[a-zA-Z]+;|&#\d+;|&#x[0-9a-fA-F]+;/g, (match) => {
    if (match in HTML_ENTITIES) return HTML_ENTITIES[match]!;
    try {
      if (match.startsWith("&#x"))
        return String.fromCodePoint(parseInt(match.slice(3, -1), 16));
      if (match.startsWith("&#"))
        return String.fromCodePoint(parseInt(match.slice(2, -1), 10));
    } catch {
      // Invalid code point — fall through and keep the raw entity.
    }
    return match;
  });
}

function stripTags(value: string): string {
  // Decode first so entity-encoded markup (&lt;p&gt;) is stripped too.
  return decodeEntities(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object" && "#text" in value) {
    const text = (value as { "#text"?: unknown })["#text"];
    if (typeof text === "string" || typeof text === "number") return String(text);
  }
  return "";
}

function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    const keep = new URLSearchParams();
    ["id", "article", "story"].forEach((key) => {
      const found = url.searchParams.get(key);
      if (found) keep.set(key, found);
    });
    url.search = keep.toString();
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

/**
 * Significant, lightly-stemmed tokens of a headline. Short all-caps
 * acronyms (US, UN, EU) are kept because they carry real meaning.
 */
export function tokenize(title: string): string[] {
  const tokens = title
    .replace(/[‘’ʼ]/g, "'")
    .replace(/'s\b/gi, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((raw) => {
      const isAcronym = raw.length >= 2 && raw === raw.toUpperCase() && /[A-Z]/.test(raw);
      const word = raw.toLowerCase();
      if (isAcronym) return ALIASES[word] ?? word;
      if (word.length < 3 || STOP_WORDS.has(word)) return "";
      return stem(word);
    })
    .filter(Boolean);
  return [...new Set(tokens)];
}

/** Demonyms and alternate names folded onto one token. */
const ALIASES: Record<string, string> = {
  czechia: "czech",
  iranian: "iran",
  israeli: "israel",
  ukrainian: "ukraine",
  russian: "russia",
  chinese: "china",
  palestinian: "palestine",
  syrian: "syria",
  lebanese: "lebanon",
  american: "us",
  british: "uk",
  britain: "uk",
  european: "europe",
  eu: "europe",
  german: "germany",
  french: "france",
  indian: "india",
  japanese: "japan",
  korean: "korea",
  protester: "protest",
  rally: "protest",
  demonstration: "protest",
};

function stem(raw: string): string {
  const word = stemSuffix(raw);
  return ALIASES[word] ?? ALIASES[raw] ?? word;
}

function stemSuffix(word: string): string {
  if (word.length > 5 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("ed") && !word.endsWith("eed"))
    return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss"))
    return word.slice(0, -1);
  return word;
}

function impactScore(title: string, summary: string): number {
  const text = `${title} ${summary}`.toLowerCase();
  const hits = IMPACT_TERMS.reduce(
    (acc, term) => (new RegExp(`\\b${term}`).test(text) ? acc + 1 : acc),
    0,
  );
  return Math.min(hits / 3, 1);
}

function parseDate(value: string | undefined, fallback: number): string {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return new Date(Number.isNaN(parsed) ? fallback : parsed).toISOString();
}

function hashString(value: string): string {
  // FNV-1a, 32-bit — short, stable ids for React keys and history.
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

// ── parsing ──────────────────────────────────────────────────────────────────

function linkFromEntry(entry: Record<string, unknown>): string {
  const links = Array.isArray(entry.link) ? entry.link : [entry.link];
  for (const link of links) {
    if (typeof link === "string" && link.startsWith("http")) return canonicalUrl(link);
    if (link && typeof link === "object") {
      const href = (link as { "@_href"?: unknown; "@_rel"?: unknown })["@_href"];
      const rel = (link as { "@_rel"?: unknown })["@_rel"];
      if (typeof href === "string" && (!rel || rel === "alternate"))
        return canonicalUrl(href);
    }
  }
  const guid = textOf(entry.guid);
  return guid.startsWith("http") ? canonicalUrl(guid) : "";
}

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: true,
});

export function parseFeed(xml: string, sourceName: string, now = Date.now()): ParsedEntry[] {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const channel = (parsed.rss as Record<string, unknown> | undefined)?.channel as
    | Record<string, unknown>
    | undefined;
  const rdf = parsed["rdf:RDF"] as Record<string, unknown> | undefined;
  const feed = parsed.feed as Record<string, unknown> | undefined;

  const items = [channel?.item, rdf?.item, feed?.entry].flatMap((value) =>
    value ? (Array.isArray(value) ? value : [value]) : [],
  ) as Record<string, unknown>[];

  const entries: ParsedEntry[] = [];
  items.forEach((entry, position) => {
    const title = stripTags(textOf(entry.title));
    const url = linkFromEntry(entry);
    if (!url || title.length < 16) return;

    const summary =
      [entry.description, entry.summary, entry.content, entry["content:encoded"]]
        .map((candidate) => stripTags(textOf(candidate)))
        .find((text) => text.length > 0) ?? "";

    const publishedAt = parseDate(
      [entry.pubDate, entry.published, entry.updated, entry["dc:date"]]
        .map(textOf)
        .find(Boolean),
      now,
    );

    entries.push({ title, summary, url, source: sourceName, publishedAt, position });
  });
  return entries;
}

// ── clustering & ranking ─────────────────────────────────────────────────────

type TokenizedEntry = ParsedEntry & { tokens: string[]; context: string[] };

type Story = {
  members: TokenizedEntry[];
};

function weightedOverlap(
  a: string[],
  b: string[],
  idf: Map<string, number>,
  minShared = 2,
): number {
  const setB = new Set(b);
  let shared = 0;
  let sharedCount = 0;
  for (const token of a) {
    if (setB.has(token)) {
      shared += idf.get(token) ?? 1;
      sharedCount++;
    }
  }
  if (sharedCount < minShared) return 0;
  const weight = (tokens: string[]) =>
    tokens.reduce((acc, token) => acc + (idf.get(token) ?? 1), 0);
  return shared / Math.min(weight(a), weight(b));
}

/**
 * Group headlines that describe the same event. Two headlines join when
 * their rarest shared words carry at least half the weight of the shorter
 * headline — so "Estonia shuts Russia border crossings" and "Estonia to
 * close border crossings with Russia" merge, while two unrelated Gaza
 * stories that only share "Gaza" and "Israel" do not.
 */
export function clusterEntries(entries: ParsedEntry[]): Story[] {
  const withTokens: TokenizedEntry[] = entries.map((entry) => {
    const tokens = tokenize(entry.title);
    // Title plus the lede: catches rewrites like "Czechs rally" vs
    // "Czechia: scores protest" that share almost no headline words.
    const lede = entry.summary.split(/(?<=[.!?])\s/)[0] ?? "";
    const context = [...new Set([...tokens, ...tokenize(lede.slice(0, 240))])];
    return { ...entry, tokens, context };
  });

  const docFreq = new Map<string, number>();
  withTokens.forEach(({ context }) =>
    context.forEach((token) => docFreq.set(token, (docFreq.get(token) ?? 0) + 1)),
  );
  const idf = new Map<string, number>();
  docFreq.forEach((count, token) =>
    idf.set(token, Math.log(1 + withTokens.length / count)),
  );

  const similarity = (a: TokenizedEntry, b: TokenizedEntry) =>
    Math.max(
      weightedOverlap(a.tokens, b.tokens, idf),
      weightedOverlap(a.context, b.context, idf, 3) * 0.95,
    );

  const stories: Story[] = [];
  // Process editor-prominent items first so they anchor clusters.
  const ordered = [...withTokens].sort((a, b) => a.position - b.position);

  for (const entry of ordered) {
    let best: Story | null = null;
    let bestSim = SAME_STORY_THRESHOLD;
    for (const story of stories) {
      // Blend best and mean member similarity so one loose match cannot
      // chain unrelated stories together.
      const sims = story.members.map((member) => similarity(entry, member));
      const mean = sims.reduce((a, b) => a + b, 0) / sims.length;
      const sim = Math.max(...sims) * 0.6 + mean * 0.4;
      if (sim >= bestSim) {
        best = story;
        bestSim = sim;
      }
    }
    if (best) best.members.push(entry);
    else stories.push({ members: [entry] });
  }
  return stories;
}

function dedupeEntries(entries: ParsedEntry[]): ParsedEntry[] {
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  return entries.filter((entry) => {
    const urlKey = canonicalUrl(entry.url);
    const titleKey = entry.title.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (seenUrls.has(urlKey) || seenTitles.has(titleKey)) return false;
    seenUrls.add(urlKey);
    seenTitles.add(titleKey);
    return true;
  });
}

export function rankEntries(
  allEntries: ParsedEntry[],
  now = Date.now(),
  limit = MAX_STATIONS,
): Headline[] {
  const fresh = dedupeEntries(allEntries).filter(
    (entry) => now - Date.parse(entry.publishedAt) < MAX_AGE_HOURS * 3_600_000,
  );
  const stories = clusterEntries(fresh);

  const scored = stories.map((story) => {
    const sources = new Set(story.members.map((member) => member.source));
    // 1 source → 0, 2 → .46, 3 → .71, 4 → .85, 5+ → .9+
    const consensus = 1 - Math.exp(-(sources.size - 1) / 1.6);

    const newest = Math.max(...story.members.map((m) => Date.parse(m.publishedAt)));
    const hoursOld = Math.max(0, (now - newest) / 3_600_000);
    const recency = Math.exp(-hoursOld / 18);

    // Feed order is each newsroom's own editorial ranking.
    const prominence = Math.max(...story.members.map((m) => Math.exp(-m.position / 10)));

    // The lead is the version its newsroom placed highest.
    const lead = [...story.members].sort(
      (a, b) =>
        a.position - b.position ||
        Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
    )[0]!;
    const impact = impactScore(lead.title, lead.summary);

    const score = 0.45 * consensus + 0.25 * recency + 0.15 * prominence + 0.15 * impact;
    return { story, lead, score };
  });

  // Greedy re-rank: each prior pick from the same lead source shaves 12%
  // off, so one prolific feed cannot monopolise the dial.
  const picked: typeof scored = [];
  const perSource = new Map<string, number>();
  const pool = [...scored];
  while (picked.length < limit && pool.length > 0) {
    let bestIndex = 0;
    let bestValue = -Infinity;
    pool.forEach((candidate, i) => {
      const value = candidate.score * Math.pow(0.88, perSource.get(candidate.lead.source) ?? 0);
      if (value > bestValue) {
        bestValue = value;
        bestIndex = i;
      }
    });
    const [choice] = pool.splice(bestIndex, 1);
    picked.push(choice!);
    perSource.set(choice!.lead.source, (perSource.get(choice!.lead.source) ?? 0) + 1);
  }

  return picked.map(({ story, lead, score }) => {
    const coverage: Coverage[] = [];
    const seen = new Set<string>();
    for (const member of [lead, ...story.members]) {
      if (seen.has(member.source)) continue;
      seen.add(member.source);
      coverage.push({ source: member.source, title: member.title, url: member.url });
    }
    const summary =
      lead.summary || story.members.find((m) => m.summary)?.summary || "";
    return {
      id: hashString(lead.url),
      title: lead.title,
      summary,
      url: lead.url,
      source: lead.source,
      publishedAt: lead.publishedAt,
      score: Number(score.toFixed(4)),
      coverage,
    };
  });
}

// ── fetching ─────────────────────────────────────────────────────────────────

async function fetchFeed(feed: FeedSource, retries = 1): Promise<string> {
  try {
    const response = await fetch(feed.url, {
      cache: "no-store",
      headers: {
        "User-Agent": "ShortwaveLedger/1.0 (+https://news.pixelsmith.io)",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`${feed.name} responded ${response.status}`);
    return await response.text();
  } catch (error) {
    if (retries <= 0) throw error;
    await new Promise((resolve) => setTimeout(resolve, 600));
    return fetchFeed(feed, retries - 1);
  }
}

export async function collectHeadlines(): Promise<{
  headlines: Headline[];
  feeds: FeedStatus[];
}> {
  const now = Date.now();
  const results = await Promise.allSettled(
    FEEDS.map(async (feed) => parseFeed(await fetchFeed(feed), feed.name, now)),
  );

  const feeds = FEEDS.map((feed, i) => ({
    name: feed.name,
    ok: results[i]!.status === "fulfilled",
  }));
  const entries = results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );

  return { headlines: rankEntries(entries, now), feeds };
}
