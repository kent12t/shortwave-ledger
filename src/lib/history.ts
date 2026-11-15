import type { Headline } from "@/lib/news";

export type SeenHeadline = {
  id: string;
  title: string;
  source: string;
  url: string;
  seenAt: string;
};

const HISTORY_KEY = "shortwave-ledger-history-v2";
const MAX_ITEMS = 150;

export function readHistory(): SeenHeadline[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is SeenHeadline =>
            typeof item?.id === "string" &&
            typeof item?.title === "string" &&
            typeof item?.seenAt === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function writeHistory(items: SeenHeadline[]) {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
  } catch {
    // Private mode or storage full — the log is a convenience, not critical.
  }
}

export function addSeen(headline: Headline): SeenHeadline[] {
  const next = [
    {
      id: headline.id,
      title: headline.title,
      source: headline.source,
      url: headline.url,
      seenAt: new Date().toISOString(),
    },
    ...readHistory().filter((item) => item.id !== headline.id),
  ];
  writeHistory(next);
  return next;
}

export function clearHistory(): SeenHeadline[] {
  writeHistory([]);
  return [];
}

export function readPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(`shortwave-ledger-${key}`);
  } catch {
    return null;
  }
}

export function writePreference(key: string, value: string) {
  try {
    window.localStorage.setItem(`shortwave-ledger-${key}`, value);
  } catch {
    // ignore
  }
}
