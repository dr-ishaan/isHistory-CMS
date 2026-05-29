/**
 * isHistory CMS Plugin — Type Definitions
 *
 * Central type declarations shared across all modules.
 */

import { TFile, MetadataCache, Vault, App } from "obsidian";

// ─── Track System ───

export interface TrackInfo {
  name: string;
  emoji: string;
  color: string;
}

export type TrackCode = "A" | "P" | "E";

export const TRACKS: Record<TrackCode, TrackInfo> = {
  A: { name: "Articles", emoji: "📰", color: "#7c3aed" },
  P: { name: "Profiles", emoji: "🧠", color: "#3b82f6" },
  E: { name: "Events", emoji: "⚡", color: "#f59e0b" },
};

export const STATUSES = ["published", "upcoming", "planned"] as const;
export type Status = (typeof STATUSES)[number];

export interface SeriesDefinition {
  name: string;
  subtitle: string;
  tracks: Record<TrackCode, number>;
}

export const SERIES: Record<string, SeriesDefinition> = {
  "minds-and-machines": {
    name: "Minds & Machines",
    subtitle: "The Story of AI",
    tracks: { A: 25, P: 25, E: 25 },
  },
};

// ─── Validation ───

export type Severity = "error" | "warning";

export interface ValidationError {
  field: string;
  message: string;
  severity: Severity;
}

export type ValidationStatus = "ready" | "error" | "warning";

export interface ValidationResult {
  status: ValidationStatus;
  label: string;
  errors: ValidationError[];
}

// ─── Content Items ───

export type CollectionType = "archive" | "vault";

export interface ContentItem {
  file: TFile;
  path: string;
  collection: CollectionType;
  name: string;
  title: string;
  description: string;
  date: string;
  status: string;
  draft: boolean;
  track: TrackCode | null;
  series: string;
  seriesOrder: string;
  part: string;
  era: string;
  figures: string;
  connects: string;
  image: string;
  tags: string[];
  aliases: string[];
  publish: boolean | undefined;
  order: number | undefined;
  validation: ValidationResult;
}

// ─── Cache Stats ───

export interface CacheStats {
  total: number;
  archiveTotal: number;
  vaultTotal: number;
  drafts: number;
  published: number;
  upcoming: number;
  planned: number;
  ready: number;
  errors: number;
  warnings: number;
  trackA: number;
  trackP: number;
  trackE: number;
  trackNone: number;
  uniqueTags: string[];
  allEras: string[];
  allSeries: string[];
}

// ─── Settings ───

export const SETTINGS_VERSION = 7;

export interface IsHistorySettings {
  _version: number;
  archivePath: string;
  vaultPath: string;
  cardsPerPage: number;
  showRibbonIcon: boolean;
}

export const DEFAULT_SETTINGS: IsHistorySettings = {
  _version: SETTINGS_VERSION,
  archivePath: "src/content/blog",
  vaultPath: "src/content/vault",
  cardsPerPage: 40,
  showRibbonIcon: true,
};

// ─── Frontmatter Schemas ───

export const ARCHIVE_REQUIRED: (keyof ArchiveFrontmatter)[] = [
  "title",
  "date",
  "description",
];
export const ARCHIVE_OPTIONAL: (keyof ArchiveFrontmatter)[] = [
  "draft",
  "tags",
  "image",
  "series",
  "seriesOrder",
  "track",
  "status",
  "part",
  "figures",
  "connects",
  "era",
  "aliases",
];
export const VAULT_REQUIRED: (keyof VaultFrontmatter)[] = ["title"];

export interface ArchiveFrontmatter {
  title?: string;
  date?: string;
  description?: string;
  draft?: boolean;
  tags?: unknown;
  image?: string;
  series?: string;
  seriesOrder?: string;
  track?: string;
  status?: string;
  part?: string;
  figures?: string;
  connects?: string;
  era?: string;
  aliases?: unknown;
}

export interface VaultFrontmatter {
  title?: string;
  created?: string;
  updated?: string;
  author?: string;
  description?: string;
  publish?: boolean;
  tags?: unknown;
  order?: number;
  relatedChapters?: string;
}
