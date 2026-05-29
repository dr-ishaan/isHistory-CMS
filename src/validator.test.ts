/**
 * isHistory CMS Plugin — Validator Tests
 *
 * Comprehensive test suite for the validation engine,
 * covering archive and vault frontmatter validation rules.
 */

import { describe, it, expect } from "vitest";
import { validateArchive, validateVault, getStatus } from "./validator";
import type { ArchiveFrontmatter, VaultFrontmatter, ValidationError } from "./types";

// ─── Archive Validation ───

describe("validateArchive", () => {
  it("should report error for missing frontmatter", () => {
    const errors = validateArchive(null);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("Frontmatter");
    expect(errors[0].severity).toBe("error");
  });

  it("should report error for undefined frontmatter", () => {
    const errors = validateArchive(undefined);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("Frontmatter");
  });

  // ─── Title ───

  describe("title validation", () => {
    it("should report error for missing title", () => {
      const errors = validateArchive({ date: "2026-01-01", description: "A valid description text" });
      const titleErrors = errors.filter((e) => e.field === "title");
      expect(titleErrors).toHaveLength(1);
      expect(titleErrors[0].severity).toBe("error");
    });

    it("should report error for title shorter than 5 chars", () => {
      const errors = validateArchive({ title: "Hi", date: "2026-01-01", description: "A valid description" });
      const titleErrors = errors.filter((e) => e.field === "title");
      expect(titleErrors).toHaveLength(1);
      expect(titleErrors[0].severity).toBe("error");
    });

    it("should report warning for title longer than 120 chars", () => {
      const longTitle = "A".repeat(121);
      const errors = validateArchive({ title: longTitle, date: "2026-01-01", description: "Valid desc" });
      const titleErrors = errors.filter((e) => e.field === "title");
      expect(titleErrors).toHaveLength(1);
      expect(titleErrors[0].severity).toBe("warning");
    });

    it("should accept a valid title between 5 and 120 chars", () => {
      const errors = validateArchive({ title: "The Ancient Dream of Artificial Life", date: "2026-01-01", description: "A valid description" });
      const titleErrors = errors.filter((e) => e.field === "title");
      expect(titleErrors).toHaveLength(0);
    });
  });

  // ─── Date ───

  describe("date validation", () => {
    it("should report error for missing date", () => {
      const errors = validateArchive({ title: "Valid Title", description: "Valid description" });
      const dateErrors = errors.filter((e) => e.field === "date");
      expect(dateErrors).toHaveLength(1);
      expect(dateErrors[0].severity).toBe("error");
    });

    it("should report error for invalid date format", () => {
      const errors = validateArchive({ title: "Valid Title", date: "not-a-date", description: "Valid desc" });
      const dateErrors = errors.filter((e) => e.field === "date");
      expect(dateErrors).toHaveLength(1);
      expect(dateErrors[0].severity).toBe("error");
    });

    it("should accept YYYY-MM-DD format", () => {
      const errors = validateArchive({ title: "Valid Title", date: "2026-05-28", description: "Valid desc" });
      const dateErrors = errors.filter((e) => e.field === "date");
      expect(dateErrors).toHaveLength(0);
    });
  });

  // ─── Description ───

  describe("description validation", () => {
    it("should report error for missing description", () => {
      const errors = validateArchive({ title: "Valid Title", date: "2026-01-01" });
      const descErrors = errors.filter((e) => e.field === "description");
      expect(descErrors).toHaveLength(1);
      expect(descErrors[0].severity).toBe("error");
    });

    it("should report error for description shorter than 15 chars", () => {
      const errors = validateArchive({ title: "Valid Title", date: "2026-01-01", description: "Too short" });
      const descErrors = errors.filter((e) => e.field === "description");
      expect(descErrors).toHaveLength(1);
      expect(descErrors[0].severity).toBe("error");
    });

    it("should report warning for description longer than 160 chars", () => {
      const longDesc = "A".repeat(161);
      const errors = validateArchive({ title: "Valid Title", date: "2026-01-01", description: longDesc });
      const descErrors = errors.filter((e) => e.field === "description");
      expect(descErrors).toHaveLength(1);
      expect(descErrors[0].severity).toBe("warning");
    });

    it("should accept a valid description between 15 and 160 chars", () => {
      const errors = validateArchive({ title: "Valid Title", date: "2026-01-01", description: "A valid description that is long enough" });
      const descErrors = errors.filter((e) => e.field === "description");
      expect(descErrors).toHaveLength(0);
    });
  });

  // ─── Track ───

  describe("track validation", () => {
    it("should report error for invalid track", () => {
      const errors = validateArchive({ title: "Valid", date: "2026-01-01", description: "Valid description", track: "X" });
      const trackErrors = errors.filter((e) => e.field === "track");
      expect(trackErrors).toHaveLength(1);
      expect(trackErrors[0].severity).toBe("error");
    });

    it("should accept valid tracks A, P, E", () => {
      for (const track of ["A", "P", "E"]) {
        const errors = validateArchive({ title: "Valid", date: "2026-01-01", description: "Valid description", track });
        const trackErrors = errors.filter((e) => e.field === "track");
        expect(trackErrors).toHaveLength(0);
      }
    });

    it("should not error when track is absent", () => {
      const errors = validateArchive({ title: "Valid", date: "2026-01-01", description: "Valid description" });
      const trackErrors = errors.filter((e) => e.field === "track");
      expect(trackErrors).toHaveLength(0);
    });
  });

  // ─── Status ───

  describe("status validation", () => {
    it("should report error for invalid status", () => {
      const errors = validateArchive({ title: "Valid", date: "2026-01-01", description: "Valid description", status: "unknown" });
      const statusErrors = errors.filter((e) => e.field === "status");
      expect(statusErrors).toHaveLength(1);
      expect(statusErrors[0].severity).toBe("error");
    });

    it("should accept published, upcoming, planned", () => {
      for (const status of ["published", "upcoming", "planned"]) {
        const errors = validateArchive({ title: "Valid", date: "2026-01-01", description: "Valid description", status });
        const statusErrors = errors.filter((e) => e.field === "status");
        expect(statusErrors).toHaveLength(0);
      }
    });
  });

  // ─── Series + seriesOrder Pair ───

  describe("series/seriesOrder pairing", () => {
    it("should warn if series is set but seriesOrder is missing", () => {
      const errors = validateArchive({ title: "Valid", date: "2026-01-01", description: "Valid desc", series: "minds-and-machines" });
      const pairErrors = errors.filter((e) => e.field === "seriesOrder");
      expect(pairErrors).toHaveLength(1);
      expect(pairErrors[0].severity).toBe("warning");
    });

    it("should warn if seriesOrder is set but series is missing", () => {
      const errors = validateArchive({ title: "Valid", date: "2026-01-01", description: "Valid desc", seriesOrder: "A1", track: "A" });
      const pairErrors = errors.filter((e) => e.field === "series");
      expect(pairErrors).toHaveLength(1);
      expect(pairErrors[0].severity).toBe("warning");
    });

    it("should warn for invalid seriesOrder format", () => {
      const errors = validateArchive({ title: "Valid", date: "2026-01-01", description: "Valid desc", series: "test", seriesOrder: "X99" });
      const formatErrors = errors.filter((e) => e.field === "seriesOrder" && e.message.includes("Format"));
      expect(formatErrors).toHaveLength(1);
      expect(formatErrors[0].severity).toBe("warning");
    });

    it("should error when seriesOrder track does not match track field", () => {
      const errors = validateArchive({ title: "Valid", date: "2026-01-01", description: "Valid desc", series: "test", seriesOrder: "A1", track: "P" });
      const mismatchErrors = errors.filter((e) => e.field === "seriesOrder" && e.severity === "error");
      expect(mismatchErrors).toHaveLength(1);
    });
  });

  // ─── Draft + Status Conflict ───

  describe("draft/status conflict", () => {
    it("should warn when draft:true and status:published", () => {
      const errors = validateArchive({ title: "Valid", date: "2026-01-01", description: "Valid desc", draft: true, status: "published" });
      const conflictErrors = errors.filter((e) => e.field === "draft");
      expect(conflictErrors).toHaveLength(1);
      expect(conflictErrors[0].severity).toBe("warning");
    });

    it("should not warn when draft:false and status:published", () => {
      const errors = validateArchive({ title: "Valid", date: "2026-01-01", description: "Valid desc", draft: false, status: "published" });
      const conflictErrors = errors.filter((e) => e.field === "draft");
      expect(conflictErrors).toHaveLength(0);
    });
  });

  // ─── Tags ───

  describe("tags validation", () => {
    it("should error when tags is a string instead of array", () => {
      const errors = validateArchive({ title: "Valid", date: "2026-01-01", description: "Valid desc", tags: "tag1, tag2" } as any);
      const tagErrors = errors.filter((e) => e.field === "tags");
      expect(tagErrors).toHaveLength(1);
      expect(tagErrors[0].severity).toBe("error");
    });

    it("should accept tags as array", () => {
      const errors = validateArchive({ title: "Valid", date: "2026-01-01", description: "Valid desc", tags: ["tag1", "tag2"] });
      const tagErrors = errors.filter((e) => e.field === "tags");
      expect(tagErrors).toHaveLength(0);
    });
  });

  // ─── Aliases ───

  describe("aliases validation", () => {
    it("should error when aliases is not an array", () => {
      const errors = validateArchive({ title: "Valid", date: "2026-01-01", description: "Valid desc", aliases: "A1" } as any);
      const aliasErrors = errors.filter((e) => e.field === "aliases");
      expect(aliasErrors).toHaveLength(1);
      expect(aliasErrors[0].severity).toBe("error");
    });
  });

  // ─── Image ───

  describe("image validation", () => {
    it("should warn when image path does not start with /", () => {
      const errors = validateArchive({ title: "Valid", date: "2026-01-01", description: "Valid desc", image: "images/hero.jpg" });
      const imageErrors = errors.filter((e) => e.field === "image");
      expect(imageErrors).toHaveLength(1);
      expect(imageErrors[0].severity).toBe("warning");
    });

    it("should accept image path starting with /", () => {
      const errors = validateArchive({ title: "Valid", date: "2026-01-01", description: "Valid desc", image: "/images/hero.jpg" });
      const imageErrors = errors.filter((e) => e.field === "image");
      expect(imageErrors).toHaveLength(0);
    });
  });

  // ─── Connects ───

  describe("connects validation", () => {
    it("should warn for invalid reference format", () => {
      const errors = validateArchive({ title: "Valid", date: "2026-01-01", description: "Valid desc", connects: "P1, INVALID, E3" });
      const connectErrors = errors.filter((e) => e.field === "connects");
      expect(connectErrors).toHaveLength(1);
      expect(connectErrors[0].severity).toBe("warning");
    });

    it("should accept valid connects format", () => {
      const errors = validateArchive({ title: "Valid", date: "2026-01-01", description: "Valid desc", connects: "P1, A5, E3" });
      const connectErrors = errors.filter((e) => e.field === "connects");
      expect(connectErrors).toHaveLength(0);
    });
  });

  // ─── Figures (P-track) ───

  describe("figures for profiles", () => {
    it("should warn when P-track profile has no figures", () => {
      const errors = validateArchive({ title: "Valid", date: "2026-01-01", description: "Valid desc", track: "P" });
      const figErrors = errors.filter((e) => e.field === "figures");
      expect(figErrors).toHaveLength(1);
      expect(figErrors[0].severity).toBe("warning");
    });

    it("should not warn when P-track profile has figures", () => {
      const errors = validateArchive({ title: "Valid", date: "2026-01-01", description: "Valid desc", track: "P", figures: "Ada Lovelace" });
      const figErrors = errors.filter((e) => e.field === "figures");
      expect(figErrors).toHaveLength(0);
    });
  });

  // ─── Fully Valid Archive ───

  it("should return no errors for a fully valid archive post", () => {
    const errors = validateArchive({
      title: "The Ancient Dream of Artificial Life",
      date: "2026-05-28",
      description: "From bronze giants to clockwork wonders, the dream of creating life",
      draft: false,
      tags: ["ai-history", "philosophy"],
      image: "/images/a1-hero.jpg",
      series: "minds-and-machines",
      seriesOrder: "A1",
      track: "A",
      status: "published",
      part: "Part I",
      figures: "",
      connects: "P1, E1",
      era: "Ancient - 1850",
    });
    expect(errors).toHaveLength(0);
  });
});

// ─── Vault Validation ───

describe("validateVault", () => {
  it("should report error for missing frontmatter", () => {
    const errors = validateVault(null);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("Frontmatter");
  });

  it("should report error for missing title", () => {
    const errors = validateVault({});
    const titleErrors = errors.filter((e) => e.field === "title");
    expect(titleErrors).toHaveLength(1);
    expect(titleErrors[0].severity).toBe("error");
  });

  it("should report error for empty title", () => {
    const errors = validateVault({ title: "" });
    const titleErrors = errors.filter((e) => e.field === "title");
    expect(titleErrors).toHaveLength(1);
  });

  it("should accept valid vault frontmatter", () => {
    const errors = validateVault({ title: "Research Notes" });
    expect(errors).toHaveLength(0);
  });

  it("should error when publish is not boolean", () => {
    const errors = validateVault({ title: "Notes", publish: "yes" } as any);
    const pubErrors = errors.filter((e) => e.field === "publish");
    expect(pubErrors).toHaveLength(1);
    expect(pubErrors[0].severity).toBe("error");
  });

  it("should accept boolean publish", () => {
    const errors = validateVault({ title: "Notes", publish: true });
    const pubErrors = errors.filter((e) => e.field === "publish");
    expect(pubErrors).toHaveLength(0);
  });

  it("should error when tags is not array", () => {
    const errors = validateVault({ title: "Notes", tags: "meta" } as any);
    const tagErrors = errors.filter((e) => e.field === "tags");
    expect(tagErrors).toHaveLength(1);
  });

  it("should error when order is not a number", () => {
    const errors = validateVault({ title: "Notes", order: "first" } as any);
    const orderErrors = errors.filter((e) => e.field === "order");
    expect(orderErrors).toHaveLength(1);
  });

  it("should accept valid order number", () => {
    const errors = validateVault({ title: "Notes", order: 1 });
    const orderErrors = errors.filter((e) => e.field === "order");
    expect(orderErrors).toHaveLength(0);
  });
});

// ─── Status Derivation ───

describe("getStatus", () => {
  it("should return ready for empty errors", () => {
    const result = getStatus([]);
    expect(result.status).toBe("ready");
    expect(result.label).toBe("Ready");
  });

  it("should return error for error severity", () => {
    const result = getStatus([{ field: "title", message: "Missing", severity: "error" }]);
    expect(result.status).toBe("error");
    expect(result.label).toBe("Errors");
  });

  it("should return warning for warning-only errors", () => {
    const result = getStatus([{ field: "title", message: "Too long", severity: "warning" }]);
    expect(result.status).toBe("warning");
    expect(result.label).toBe("Warnings");
  });

  it("should return error when both error and warning present", () => {
    const result = getStatus([
      { field: "title", message: "Missing", severity: "error" },
      { field: "image", message: "No slash", severity: "warning" },
    ]);
    expect(result.status).toBe("error");
  });
});
