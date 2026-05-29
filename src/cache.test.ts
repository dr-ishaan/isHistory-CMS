/**
 * isHistory CMS Plugin — ContentCache Tests
 *
 * Tests for sorting, filtering, and collection detection logic.
 */

import { describe, it, expect } from "vitest";
import { ContentCache } from "./cache";
import type { IsHistorySettings, ContentItem, ValidationResult, CacheStats } from "./types";

// ─── Mock helpers ───

const defaultSettings: IsHistorySettings = {
  _version: 7,
  archivePath: "src/content/blog",
  vaultPath: "src/content/vault",
  cardsPerPage: 40,
  showRibbonIcon: true,
};

function makeItem(overrides: Partial<ContentItem> & { path: string }): ContentItem {
  return {
    file: {} as any,
    collection: "archive",
    name: overrides.path.split("/").pop()?.replace(".md", "") || "test",
    title: "Test Post",
    description: "A test description",
    date: "2026-01-01",
    status: "published",
    draft: false,
    track: null,
    series: "",
    seriesOrder: "",
    part: "",
    era: "",
    figures: "",
    connects: "",
    image: "",
    tags: [],
    aliases: [],
    publish: undefined,
    order: undefined,
    validation: { status: "ready", label: "Ready", errors: [] },
    ...overrides,
  };
}

// ─── Collection Detection ───

describe("ContentCache._getCollection", () => {
  const cache = new ContentCache();

  it("should identify archive paths", () => {
    expect(cache._getCollection("src/content/blog/post1.md", defaultSettings)).toBe("archive");
  });

  it("should identify vault paths", () => {
    expect(cache._getCollection("src/content/vault/notes.md", defaultSettings)).toBe("vault");
  });

  it("should return null for non-collection paths", () => {
    expect(cache._getCollection("other/path/file.md", defaultSettings)).toBeNull();
    expect(cache._getCollection("README.md", defaultSettings)).toBeNull();
  });

  it("should respect custom paths", () => {
    const customSettings: IsHistorySettings = {
      ...defaultSettings,
      archivePath: "posts",
      vaultPath: "notes",
    };
    expect(cache._getCollection("posts/my-post.md", customSettings)).toBe("archive");
    expect(cache._getCollection("notes/my-note.md", customSettings)).toBe("vault");
  });
});

// ─── isInCollection ───

describe("ContentCache.isInCollection", () => {
  const cache = new ContentCache();

  it("should return true for archive paths", () => {
    expect(cache.isInCollection("src/content/blog/post.md", defaultSettings)).toBe(true);
  });

  it("should return true for vault paths", () => {
    expect(cache.isInCollection("src/content/vault/notes.md", defaultSettings)).toBe(true);
  });

  it("should return false for other paths", () => {
    expect(cache.isInCollection("random/path.md", defaultSettings)).toBe(false);
  });
});

// ─── Sorting ───

describe("ContentCache.getSortedItems", () => {
  const cache = new ContentCache();

  beforeEach(() => {
    cache.items.clear();
    // @ts-ignore - reset private field
    cache._statsDirty = true;
  });

  it("should sort by seriesOrder track then number", () => {
    cache.items.set("a", makeItem({ path: "a", seriesOrder: "P3", track: "P" }));
    cache.items.set("b", makeItem({ path: "b", seriesOrder: "A1", track: "A" }));
    cache.items.set("c", makeItem({ path: "c", seriesOrder: "E2", track: "E" }));
    cache.items.set("d", makeItem({ path: "d", seriesOrder: "A5", track: "A" }));

    const sorted = cache.getSortedItems();
    const orders = sorted.map((i) => i.seriesOrder);
    // Alphabetical by track letter: A < E < P
    expect(orders).toEqual(["A1", "A5", "E2", "P3"]);
  });

  it("should sort numerically not lexicographically", () => {
    cache.items.set("a", makeItem({ path: "a", seriesOrder: "A10", track: "A" }));
    cache.items.set("b", makeItem({ path: "b", seriesOrder: "A2", track: "A" }));
    cache.items.set("c", makeItem({ path: "c", seriesOrder: "A1", track: "A" }));

    const sorted = cache.getSortedItems();
    const orders = sorted.map((i) => i.seriesOrder);
    expect(orders).toEqual(["A1", "A2", "A10"]);
  });

  it("should place items with seriesOrder before items without", () => {
    cache.items.set("a", makeItem({ path: "a", seriesOrder: "A1", track: "A" }));
    cache.items.set("b", makeItem({ path: "b", seriesOrder: "" }));

    const sorted = cache.getSortedItems();
    expect(sorted[0].seriesOrder).toBe("A1");
    expect(sorted[1].seriesOrder).toBe("");
  });

  it("should sort items without seriesOrder by path", () => {
    cache.items.set("z", makeItem({ path: "z-post", seriesOrder: "" }));
    cache.items.set("a", makeItem({ path: "a-post", seriesOrder: "" }));

    const sorted = cache.getSortedItems();
    expect(sorted[0].path).toBe("a-post");
    expect(sorted[1].path).toBe("z-post");
  });

  it("should filter by collection type", () => {
    cache.items.set("a", makeItem({ path: "a", collection: "archive" }));
    cache.items.set("b", makeItem({ path: "b", collection: "vault" }));

    const archiveOnly = cache.getSortedItems("archive");
    expect(archiveOnly).toHaveLength(1);
    expect(archiveOnly[0].collection).toBe("archive");
  });
});

// ─── Filtering ───

describe("ContentCache.matchesFilter", () => {
  const cache = new ContentCache();

  const makeFilterItem = (overrides: Partial<ContentItem>): ContentItem =>
    makeItem({ path: "test", ...overrides });

  it("should match 'all' filter for any item", () => {
    const item = makeFilterItem({});
    expect(cache.matchesFilter(item, "all", "")).toBe(true);
  });

  it("should match 'archive' filter only for archive items", () => {
    expect(cache.matchesFilter(makeFilterItem({ collection: "archive" }), "archive", "")).toBe(true);
    expect(cache.matchesFilter(makeFilterItem({ collection: "vault" }), "archive", "")).toBe(false);
  });

  it("should match 'vault' filter only for vault items", () => {
    expect(cache.matchesFilter(makeFilterItem({ collection: "vault" }), "vault", "")).toBe(true);
    expect(cache.matchesFilter(makeFilterItem({ collection: "archive" }), "vault", "")).toBe(false);
  });

  it("should match track filters", () => {
    expect(cache.matchesFilter(makeFilterItem({ track: "A" }), "track-A", "")).toBe(true);
    expect(cache.matchesFilter(makeFilterItem({ track: "P" }), "track-A", "")).toBe(false);
    expect(cache.matchesFilter(makeFilterItem({ track: "E" }), "track-E", "")).toBe(true);
  });

  it("should match 'drafts' filter only for draft items", () => {
    expect(cache.matchesFilter(makeFilterItem({ draft: true }), "drafts", "")).toBe(true);
    expect(cache.matchesFilter(makeFilterItem({ draft: false }), "drafts", "")).toBe(false);
  });

  it("should match validation status filters", () => {
    const readyItem = makeFilterItem({ validation: { status: "ready", label: "Ready", errors: [] } });
    const errorItem = makeFilterItem({ validation: { status: "error", label: "Errors", errors: [{ field: "title", message: "Missing", severity: "error" }] } });

    expect(cache.matchesFilter(readyItem, "ready", "")).toBe(true);
    expect(cache.matchesFilter(errorItem, "ready", "")).toBe(false);
    expect(cache.matchesFilter(errorItem, "errors", "")).toBe(true);
    expect(cache.matchesFilter(readyItem, "errors", "")).toBe(false);
  });

  // ─── Search ───

  it("should match search query in title", () => {
    const item = makeFilterItem({ title: "The Ancient Dream of AI" });
    expect(cache.matchesFilter(item, "all", "ancient")).toBe(true);
    expect(cache.matchesFilter(item, "all", "robotics")).toBe(false);
  });

  it("should match search query in path", () => {
    const item = makeFilterItem({ path: "src/content/blog/a1-ancient-dream.md" });
    expect(cache.matchesFilter(item, "all", "a1-ancient")).toBe(true);
  });

  it("should match search query in tags", () => {
    const item = makeFilterItem({ tags: ["ai-history", "philosophy"] });
    expect(cache.matchesFilter(item, "all", "philosophy")).toBe(true);
    expect(cache.matchesFilter(item, "all", "mathematics")).toBe(false);
  });

  it("should match search query in era", () => {
    const item = makeFilterItem({ era: "Ancient - 1850" });
    expect(cache.matchesFilter(item, "all", "ancient")).toBe(true);
  });

  it("should match search query in figures", () => {
    const item = makeFilterItem({ figures: "Ada Lovelace, Alan Turing" });
    expect(cache.matchesFilter(item, "all", "turing")).toBe(true);
  });

  it("should match search query in seriesOrder", () => {
    const item = makeFilterItem({ seriesOrder: "A1" });
    expect(cache.matchesFilter(item, "all", "a1")).toBe(true);
  });

  it("should be case-insensitive", () => {
    const item = makeFilterItem({ title: "The Ancient Dream" });
    expect(cache.matchesFilter(item, "all", "ANCIENT")).toBe(true);
    expect(cache.matchesFilter(item, "all", "the ancient")).toBe(true);
  });
});

// ─── File Operations ───

describe("ContentCache.removeFile", () => {
  const cache = new ContentCache();

  it("should remove an item by path", () => {
    cache.items.set("test/path.md", makeItem({ path: "test/path.md" }));
    expect(cache.items.has("test/path.md")).toBe(true);

    cache.removeFile("test/path.md");
    expect(cache.items.has("test/path.md")).toBe(false);
  });

  it("should not throw when removing non-existent path", () => {
    expect(() => cache.removeFile("nonexistent.md")).not.toThrow();
  });
});
