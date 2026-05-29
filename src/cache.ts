/**
 * isHistory CMS Plugin — Content Cache
 *
 * Dual-collection, incremental content index.
 * Manages in-memory content items with stats caching.
 */

import { type App, type TFile, type MetadataCache } from "obsidian";
import {
  type ContentItem,
  type CollectionType,
  type CacheStats,
  type IsHistorySettings,
  type TrackCode,
  type ValidationResult,
} from "./types";
import { validateArchive, validateVault, getStatus } from "./validator";

export class ContentCache {
  items: Map<string, ContentItem> = new Map();
  private _stats: CacheStats | null = null;
  private _statsDirty = true;

  // ─── Collection Detection ───

  _getCollection(path: string, settings: IsHistorySettings): CollectionType | null {
    if (path.startsWith(settings.archivePath)) return "archive";
    if (path.startsWith(settings.vaultPath)) return "vault";
    return null;
  }

  // ─── Build Item from File ───

  _buildItem(file: TFile, app: App, settings: IsHistorySettings): ContentItem | null {
    try {
      const collection = this._getCollection(file.path, settings);
      if (!collection) return null;

      const cache = app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter || {};

      // Validate using the correct schema
      let validation: ValidationResult;
      if (collection === "archive") {
        validation = getStatus(validateArchive(fm as any));
      } else {
        validation = getStatus(validateVault(fm as any));
      }

      // Derive track from seriesOrder if track field missing
      let track: TrackCode | null = fm.track || null;
      if (!track && fm.seriesOrder && typeof fm.seriesOrder === "string") {
        const m = fm.seriesOrder.match(/^([APE])/);
        if (m) track = m[1] as TrackCode;
      }

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
        tags: Array.isArray(fm.tags) ? fm.tags : [],
        aliases: Array.isArray(fm.aliases) ? fm.aliases : [],
        publish: fm.publish,
        order: fm.order,
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
          f.path.startsWith(settings.archivePath) ||
          f.path.startsWith(settings.vaultPath)
      );
      const currentPaths = new Set(contentFiles.map((f) => f.path));

      // Remove stale entries
      for (const path of [...this.items.keys()]) {
        if (!currentPaths.has(path)) {
          this.items.delete(path);
          this._statsDirty = true;
        }
      }

      // Rebuild all items (always rebuild to pick up content changes)
      for (const file of contentFiles) {
        const item = this._buildItem(file, app, settings);
        if (item) {
          this.items.set(file.path, item);
          this._statsDirty = true;
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
    return (
      path.startsWith(settings.archivePath) ||
      path.startsWith(settings.vaultPath)
    );
  }

  // ─── Statistics ───

  getStats(): CacheStats {
    if (!this._statsDirty && this._stats) return this._stats!;

    try {
      const items = [...this.items.values()];
      const archive = items.filter((i) => i.collection === "archive");
      const vault = items.filter((i) => i.collection === "vault");

      const byTrack = {
        A: archive.filter((i) => i.track === "A"),
        P: archive.filter((i) => i.track === "P"),
        E: archive.filter((i) => i.track === "E"),
        none: archive.filter((i) => !i.track),
      };

      const byStatus = {
        published: archive.filter((i) => i.status === "published").length,
        upcoming: archive.filter((i) => i.status === "upcoming").length,
        planned: archive.filter((i) => i.status === "planned").length,
        none: archive.filter((i) => !i.status).length,
      };

      this._stats = {
        total: items.length,
        archiveTotal: archive.length,
        vaultTotal: vault.length,
        drafts: archive.filter((i) => i.draft).length,
        published: byStatus.published,
        upcoming: byStatus.upcoming,
        planned: byStatus.planned,
        ready: items.filter((i) => i.validation.status === "ready").length,
        errors: items.filter((i) => i.validation.status === "error").length,
        warnings: items.filter((i) => i.validation.status === "warning").length,
        trackA: byTrack.A.length,
        trackP: byTrack.P.length,
        trackE: byTrack.E.length,
        trackNone: byTrack.none.length,
        uniqueTags: [...new Set(items.flatMap((i: ContentItem) => i.tags as string[]))],
        allEras: [...new Set(archive.map((i) => i.era).filter((e) => e))],
        allSeries: [...new Set(archive.map((i) => i.series).filter((s) => s))],
      };

      this._statsDirty = false;
      return this._stats!;
    } catch (e) {
      console.error("isHistory CMS: getStats failed", e);
      return {
        total: 0, archiveTotal: 0, vaultTotal: 0, drafts: 0,
        published: 0, upcoming: 0, planned: 0, ready: 0,
        errors: 0, warnings: 0, trackA: 0, trackP: 0,
        trackE: 0, trackNone: 0, uniqueTags: [], allEras: [],
        allSeries: [],
      };
    }
  }

  // ─── Sorting ───

  getSortedItems(collection?: CollectionType): ContentItem[] {
    const items = [...this.items.values()];
    const filtered = collection
      ? items.filter((i) => i.collection === collection)
      : items;

    return filtered.sort((a, b) => {
      const ao = a.seriesOrder || "";
      const bo = b.seriesOrder || "";

      if (ao && bo) {
        const parseOrder = (s: string) => {
          const m = s.match(/^([APE])(\d+)$/);
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
    });
  }

  // ─── Filtering ───

  matchesFilter(
    item: ContentItem,
    filter: string,
    searchQuery: string
  ): boolean {
    if (filter === "archive" && item.collection !== "archive") return false;
    if (filter === "vault" && item.collection !== "vault") return false;
    if (filter === "track-A" && item.track !== "A") return false;
    if (filter === "track-P" && item.track !== "P") return false;
    if (filter === "track-E" && item.track !== "E") return false;
    if (filter === "drafts" && item.draft !== true) return false;
    if (filter === "published" && item.status !== "published") return false;
    if (filter === "upcoming" && item.status !== "upcoming") return false;
    if (filter === "planned" && item.status !== "planned") return false;
    if (filter === "ready" && item.validation.status !== "ready") return false;
    if (filter === "errors" && item.validation.status !== "error") return false;
    if (filter === "warnings" && item.validation.status !== "warning")
      return false;

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
}
