/**
 * isHistory CMS Plugin — Validation Engine
 *
 * Validates frontmatter for archive and vault collections
 * against the content schema. All rules are pure functions
 * with clear inputs and outputs for testability.
 */

import {
  type ValidationError,
  type ValidationResult,
  type ArchiveFrontmatter,
  type VaultFrontmatter,
  TRACKS,
  STATUSES,
} from "./types";

// ─── Helper: normalize tags (YAML shorthand → array) ───

function normalizeTags(tags: unknown): unknown {
  // Obsidian/YAML allows `tags: ai` as shorthand for `tags: [ai]`
  // A bare string should be treated as a single-element array.
  if (typeof tags === "string") {
    return [tags];
  }
  return tags;
}

// ─── Archive Validation ───

export function validateArchive(fm: ArchiveFrontmatter | null | undefined): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!fm) {
    errors.push({
      field: "Frontmatter",
      message: "Missing frontmatter block entirely.",
      severity: "error",
    });
    return errors;
  }

  // title
  if (!fm.title || typeof fm.title !== "string" || fm.title.trim().length < 5) {
    errors.push({
      field: "title",
      message: "Required. Must be at least 5 characters for SEO.",
      severity: "error",
    });
  } else if (fm.title.length > 120) {
    errors.push({
      field: "title",
      message: `Too long (${fm.title.length}/120 chars). Keep titles concise.`,
      severity: "warning",
    });
  }

  // date
  if (!fm.date) {
    errors.push({
      field: "date",
      message: "Required. Publication date for the article.",
      severity: "error",
    });
  } else if (isNaN(Date.parse(String(fm.date)))) {
    errors.push({
      field: "date",
      message: "Invalid date. Use YYYY-MM-DD format.",
      severity: "error",
    });
  } else if (new Date(String(fm.date)) > new Date()) {
    errors.push({
      field: "date",
      message: "Date is in the future. Articles should have a current or past date.",
      severity: "warning",
    });
  }

  // description
  if (
    !fm.description ||
    typeof fm.description !== "string" ||
    fm.description.trim().length < 15
  ) {
    errors.push({
      field: "description",
      message: "Required. Must be at least 15 characters for SEO meta.",
      severity: "error",
    });
  } else if (fm.description.length > 160) {
    errors.push({
      field: "description",
      message: `Too long (${fm.description.length}/160 chars). Will be truncated in search results.`,
      severity: "warning",
    });
  }

  // track
  if (fm.track && !(fm.track in TRACKS)) {
    errors.push({
      field: "track",
      message: `Invalid track "${fm.track}". Must be A, P, or E.`,
      severity: "error",
    });
  }

  // status
  if (fm.status && !STATUSES.includes(fm.status as (typeof STATUSES)[number])) {
    errors.push({
      field: "status",
      message: `Invalid status "${fm.status}". Must be published, upcoming, or planned.`,
      severity: "error",
    });
  }

  // series + seriesOrder pair
  if (fm.series && !fm.seriesOrder) {
    errors.push({
      field: "seriesOrder",
      message: `You set series="${fm.series}" but forgot seriesOrder (e.g. "A1", "P3", "E14").`,
      severity: "warning",
    });
  }
  if (fm.seriesOrder && !fm.series) {
    errors.push({
      field: "series",
      message: `You set seriesOrder="${fm.seriesOrder}" but have no series defined.`,
      severity: "warning",
    });
  }

  // seriesOrder format check
  if (fm.seriesOrder && typeof fm.seriesOrder === "string") {
    const match = fm.seriesOrder.match(/^([APE])(\d+)$/);
    if (!match) {
      errors.push({
        field: "seriesOrder",
        message: `Format should be track+number (e.g. "A1", "P3", "E14"). Got "${fm.seriesOrder}".`,
        severity: "warning",
      });
    } else {
      const orderTrack = match[1];
      if (fm.track && fm.track !== orderTrack) {
        errors.push({
          field: "seriesOrder",
          message: `seriesOrder track (${orderTrack}) doesn't match track field (${fm.track}).`,
          severity: "error",
        });
      }
    }
  }

  // draft + status conflict
  if (fm.draft === true && fm.status === "published") {
    errors.push({
      field: "draft",
      message: `Marked as draft but status is "published". Set draft:false or status:"upcoming".`,
      severity: "warning",
    });
  }

  // tags format (accept YAML shorthand: bare string → single-element array)
  const normalizedTags = normalizeTags(fm.tags);
  if (normalizedTags !== undefined && !Array.isArray(normalizedTags)) {
    errors.push({
      field: "tags",
      message: 'Must be a YAML list: [tag1, tag2, tag3]',
      severity: "error",
    });
  }

  // aliases format
  if (fm.aliases !== undefined && !Array.isArray(fm.aliases)) {
    errors.push({
      field: "aliases",
      message: 'Must be a YAML list: ["A1"]',
      severity: "error",
    });
  }

  // image path
  if (fm.image && typeof fm.image === "string" && !fm.image.startsWith("/")) {
    errors.push({
      field: "image",
      message: "Hero image path should start with / (e.g. /images/a1-hero.jpg)",
      severity: "warning",
    });
  }

  // connects format hint
  if (fm.connects && typeof fm.connects === "string") {
    const parts = fm.connects
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s);
    const badRefs = parts.filter((p) => !p.match(/^[APE]\d+$/));
    if (badRefs.length > 0) {
      errors.push({
        field: "connects",
        message: `Invalid references: ${badRefs.join(", ")}. Use format "P1, A5, E3".`,
        severity: "warning",
      });
    }
  }

  // figures should be non-empty for profiles
  if (fm.track === "P" && (!fm.figures || fm.figures.trim() === "")) {
    errors.push({
      field: "figures",
      message: "Profiles should list the key historic figure(s).",
      severity: "warning",
    });
  }

  return errors;
}

// ─── Vault Validation ───

export function validateVault(fm: VaultFrontmatter | null | undefined): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!fm) {
    errors.push({
      field: "Frontmatter",
      message: "Missing frontmatter block.",
      severity: "error",
    });
    return errors;
  }

  if (!fm.title || typeof fm.title !== "string" || fm.title.trim() === "") {
    errors.push({
      field: "title",
      message: "Required. Every vault note needs a title.",
      severity: "error",
    });
  }

  // created date format
  if (fm.created && isNaN(Date.parse(String(fm.created)))) {
    errors.push({
      field: "created",
      message: "Invalid date. Use YYYY-MM-DD format.",
      severity: "warning",
    });
  }

  // updated date format
  if (fm.updated && isNaN(Date.parse(String(fm.updated)))) {
    errors.push({
      field: "updated",
      message: "Invalid date. Use YYYY-MM-DD format.",
      severity: "warning",
    });
  }

  if (fm.publish !== undefined && typeof fm.publish !== "boolean") {
    errors.push({
      field: "publish",
      message: "Must be true or false.",
      severity: "error",
    });
  }

  // tags format (accept YAML shorthand)
  const normalizedTags = normalizeTags(fm.tags);
  if (normalizedTags !== undefined && !Array.isArray(normalizedTags)) {
    errors.push({
      field: "tags",
      message: 'Must be a YAML list: [tag1, tag2]',
      severity: "error",
    });
  }

  if (fm.order !== undefined && typeof fm.order !== "number") {
    errors.push({
      field: "order",
      message: "Must be a number for sorting.",
      severity: "error",
    });
  }

  return errors;
}

// ─── Status Derivation ───

export function getStatus(errors: ValidationError[]): ValidationResult {
  if (errors.length === 0) return { status: "ready", label: "Ready", errors };
  if (errors.some((e) => e.severity === "error"))
    return { status: "error", label: "Errors", errors };
  return { status: "warning", label: "Warnings", errors };
}
