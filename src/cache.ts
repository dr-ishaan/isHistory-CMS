/**
 * isHistory CMS Plugin — Content Cache
 *
 * Dual-collection, incremental content index.
 * v1.5.0: Fully dynamic tracks, statuses, and regex patterns
 * derived from settings rather than hardcoded constants.
 */

import { type App, type TFile } from "obsidian";
import {
  type ContentItem,
  type CollectionType,
  type CacheStats,
  type IsHistorySettings,
  type TrackCode,
  type ValidationResult,
  type ArchiveFrontmatter,
  type VaultFrontmatter,
  normalizePathSetting,
  getValidationConfig,
  buildSeriesOrderRegex,
  RECENT_THRESHOLD_MS,
  type SortMode,
} from "./types";
import { validateArchive, validateVault, getStatus } from "./validator";

export class ContentCache {
  items: Map<string, ContentItem> = new Map();
  private _stats: CacheStats | null = null;
  private _statsDirty = true;

  // ─── Collection Detection ───

  _getCollection(path: string, settings: IsHistorySettings): CollectionType | null {
    const normalizedArchive = normalizePathSetting(settings.archivePath);
    const normalizedVault = normalizePathSetting(settings.vaultPath);
    if (path.startsWith(normalizedArchive)) return "archive";
    if (path.startsWith(normalizedVault)) return "vault";
    return null;
  }

  // ─── Build Item from File ───

  _buildItem(file: TFile, app: App, settings: IsHistorySettings): ContentItem | null {
    try {
      const collection = this._getCollection(file.path, settings);
      if (!collection) return null;

      const cache = app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter || {};
      const config = getValidationConfig(settings);

      // Validate using the correct schema
      let validation: ValidationResult;
      if (collection === "archive") {
        validation = getStatus(validateArchive(fm as ArchiveFrontmatter | null, config));
      } else {
        validation = getStatus(validateVault(fm as VaultFrontmatter | null, config));
      }

      // Derive track from seriesOrder if track field missing (dynamic regex)
      let track: TrackCode | null = fm.track || null;
      const seriesRegex = buildSeriesOrderRegex(settings.tracks);
      if (!track && fm.seriesOrder && typeof fm.seriesOrder === "string") {
        const m = fm.seriesOrder.match(seriesRegex);
        if (m) track = m[1] as TrackCode;
      }

      // Normalize tags: YAML shorthand (bare string) → single-element array
      const tags = Array.isArray(fm.tags)
        ? fm.tags as string[]
        : typeof fm.tags === "string"
          ? [fm.tags]
          : [];
      const aliases = Array.isArray(fm.aliases) ? fm.aliases as string[] : [];

      return {
        file,
        path: file.path,
        collection,
        name: file.basename,
        title: fm.title || file.basename,
        description: fm.description || "",
        date: fm.date ? String(fm.date) : "",
        status: fm.status || "",
        draft: fm.draft === true,
        track,
        series: fm.series || "",
        seriesOrder: fm.seriesOrder || "",
        part: fm.part || "",
        era: fm.era || "",
        figures: fm.figures || "",
        connects: fm.connects || "",
        image: fm.image || "",
        tags,
        aliases,
        publish: fm.publish as boolean | undefined,
        order: fm.order as number | undefined,
        validation,
      };
    } catch {
      return null;
    }
  }

  // ─── Full Scan ───

  scanAll(app: App, settings: IsHistorySettings): void {
    try {
      const files = app.vault.getMarkdownFiles();
      const contentFiles = files.filter(
        (f) =>
          f.path.startsWith(normalizePathSetting(settings.archivePath)) ||
          f.path.startsWith(normalizePathSetting(settings.vaultPath))
      );
      const currentPaths = new Set(contentFiles.map((f) => f.path));

      // Remove stale entries
      for (const path of [...this.items.keys()]) {
        if (!currentPaths.has(path)) {
          this.items.delete(path);
          this._statsDirty = true;
        }
      }

      // Rebuild items, only mark dirty if content actually changed
      for (const file of contentFiles) {
        const item = this._buildItem(file, app, settings);
        if (item) {
          const existing = this.items.get(file.path);
          if (!existing || this._itemFingerprint(existing) !== this._itemFingerprint(item)) {
            this.items.set(file.path, item);
            this._statsDirty = true;
          }
        }
      }
    } catch (e) {
      console.error("isHistory CMS: scanAll failed", e);
    }
  }

  // ─── Incremental Update ───

  updateFile(file: TFile, app: App, settings: IsHistorySettings): void {
    try {
      if (!this._getCollection(file.path, settings)) return;
      const item = this._buildItem(file, app, settings);
      if (item) {
        this.items.set(file.path, item);
        this._statsDirty = true;
      }
    } catch (e) {
      console.error("isHistory CMS: updateFile failed", e);
    }
  }

  removeFile(path: string): void {
    if (this.items.has(path)) {
      this.items.delete(path);
      this._statsDirty = true;
    }
  }

  isInCollection(path: string, settings: IsHistorySettings): boolean {
    const normalizedArchive = normalizePathSetting(settings.archivePath);
    const normalizedVault = normalizePathSetting(settings.vaultPath);
    return (
      path.startsWith(normalizedArchive) ||
      path.startsWith(normalizedVault)
    );
  }

  // ─── Item Fingerprint (for change detection) ───

  private _itemFingerprint(item: ContentItem): string {
    return JSON.stringify({
      t: item.title, d: item.draft, s: item.status,
      v: item.validation.status, tr: item.track,
      desc: item.description, era: item.era, date: item.date,
      part: item.part, figures: item.figures, tags: item.tags,
      so: item.seriesOrder, errs: item.validation.errors.length,
      connects: item.connects, image: item.image,
      aliases: item.aliases, series: item.series,
      publish: item.publish, order: item.order,
    });
  }

  // ─── Statistics (dynamic tracks) ───

  getStats(settings: IsHistorySettings): CacheStats {
    if (!this._statsDirty && this._stats) return this._stats;

    try {
      const items = [...this.items.values()];
      const archive = items.filter((i) => i.collection === "archive");
      const vault = items.filter((i) => i.collection === "vault");

      // Dynamic track counts from settings
      const trackCounts: Record<string, number> = {};
      for (const code of Object.keys(settings.tracks)) {
        trackCounts[code] = archive.filter((i) => i.track === code).length;
      }
      trackCounts["none"] = archive.filter((i) => !i.track).length;

      const stats: CacheStats = {
        total: items.length,
        archiveTotal: archive.length,
        vaultTotal: vault.length,
        drafts: archive.filter((i) => i.draft).length,
        published: archive.filter((i) => i.status === "published").length,
        upcoming: archive.filter((i) => i.status === "upcoming").length,
        planned: archive.filter((i) => i.status === "planned").length,
        ready: items.filter((i) => i.validation.status === "ready").length,
        errors: items.filter((i) => i.validation.status === "error").length,
        warnings: items.filter((i) => i.validation.status === "warning").length,
        trackCounts,
        uniqueTags: [...new Set(items.flatMap((i) => i.tags))],
        allEras: [...new Set(archive.map((i) => i.era).filter((e): e is string => !!e))],
        allSeries: [...new Set(archive.map((i) => i.series).filter((s): s is string => !!s))],
      };

      this._stats = stats;
      this._statsDirty = false;
      return stats;
    } catch (e) {
      console.error("isHistory CMS: getStats failed", e);
      return {
        total: 0, archiveTotal: 0, vaultTotal: 0, drafts: 0,
        published: 0, upcoming: 0, planned: 0, ready: 0,
        errors: 0, warnings: 0, trackCounts: {},
        uniqueTags: [], allEras: [], allSeries: [],
      };
    }
  }

  // ─── Sorting (dynamic regex + SortMode) ───

  getSortedItems(collection?: CollectionType, tracks?: Record<string, unknown>, sortMode?: SortMode): ContentItem[] {
    const items = [...this.items.values()];
    const filtered = collection
      ? items.filter((i) => i.collection === collection)
      : items;
    const trackKeys = tracks ? Object.keys(tracks) : ["A", "P", "E"];
    const mode = sortMode || "seriesOrder";

    return filtered.sort((a, b) => {
      // Sort by chosen mode
      switch (mode) {
        case "dateNewest": {
          const da = a.date ? Date.parse(a.date) || 0 : 0;
          const db = b.date ? Date.parse(b.date) || 0 : 0;
          return db - da;
        }
        case "dateOldest": {
          const da2 = a.date ? Date.parse(a.date) || Infinity : Infinity;
          const db2 = b.date ? Date.parse(b.date) || Infinity : Infinity;
          return da2 - db2;
        }
        case "titleAZ":
          return a.title.localeCompare(b.title);
        case "errorsFirst": {
          const va = a.validation.status === "error" ? 0 : a.validation.status === "warning" ? 1 : 2;
          const vb = b.validation.status === "error" ? 0 : b.validation.status === "warning" ? 1 : 2;
          return va - vb;
        }
        case "draftsFirst": {
          const da3 = a.draft ? 0 : 1;
          const db3 = b.draft ? 0 : 1;
          return da3 - db3;
        }
        case "seriesOrder":
        default: {
          const ao = a.seriesOrder || "";
          const bo = b.seriesOrder || "";

          if (ao && bo) {
            const codes = trackKeys.join("");
            const parseOrder = (s: string) => {
              const m = s.match(new RegExp(`^([${codes}])(\\d+)$`));
              return m ? { track: m[1], num: parseInt(m[2], 10) } : null;
            };
            const pa = parseOrder(ao);
            const pb = parseOrder(bo);
            if (pa && pb) {
              if (pa.track !== pb.track) return pa.track.localeCompare(pb.track);
              return pa.num - pb.num;
            }
            return ao.localeCompare(bo);
          }
          if (ao) return -1;
          if (bo) return 1;
          return a.path.localeCompare(b.path);
        }
      }
    });
  }

  // ─── Filtering (multi-criterion AND logic) ───

  matchesFilter(
    item: ContentItem,
    activeFilters: Set<string>,
    searchQuery: string
  ): boolean {
    const hasAll = activeFilters.has("all");

    if (!hasAll) {
      for (const filter of activeFilters) {
        if (!this._matchesSingleFilter(item, filter)) return false;
      }
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        item.title.toLowerCase().includes(q) ||
        item.path.toLowerCase().includes(q) ||
        item.tags.some((t) => t.toLowerCase().includes(q)) ||
        item.era.toLowerCase().includes(q) ||
        item.figures.toLowerCase().includes(q) ||
        item.seriesOrder.toLowerCase().includes(q)
      );
    }

    return true;
  }

  private _matchesSingleFilter(item: ContentItem, filter: string): boolean {
    if (filter === "archive" && item.collection !== "archive") return false;
    if (filter === "vault" && item.collection !== "vault") return false;
    // Dynamic track filters: "track-A", "track-P", etc.
    if (filter.startsWith("track-")) {
      const code = filter.slice(6);
      if (item.track !== code) return false;
    }
    if (filter === "drafts" && item.draft !== true) return false;
    if (filter === "ready" && item.validation.status !== "ready") return false;
    if (filter === "errors" && item.validation.status !== "error") return false;
    if (filter === "warnings" && item.validation.status !== "warning") return false;
    // Feature 8: Recently modified filter (24h)
    if (filter === "recent") {
      const mtime = item.file.stat?.mtime;
      if (!mtime) return false;
      return (Date.now() - mtime) < RECENT_THRESHOLD_MS;
    }
    return true;
  }

  /** Reset stats dirty flag (for testing). */
  resetStatsDirty(): void {
    this._statsDirty = true;
  }
}
