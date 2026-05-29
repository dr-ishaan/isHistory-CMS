/**
 * isHistory CMS Plugin — Main Entry Point
 *
 * Orchestrates all plugin components: cache, views, commands,
 * settings, and shared operations.
 * v1.5.0: Fully dynamic tracks, template engine, configurable
 * pre-flight, and runtime CSS injection for track colors.
 */

import { Plugin, Notice, Modal, type TFile } from "obsidian";
import {
  type IsHistorySettings,
  type TrackCode,
  type ValidationResult,
  type TrackInfo,
  DEFAULT_SETTINGS,
  normalizePathSetting,
  substituteVars,
  getValidationConfig,
  hexToRgba,
} from "./types";
import { ContentCache } from "./cache";
import { validateArchive, validateVault, getStatus } from "./validator";
import { IsHistorySettingTab, migrateSettings } from "./settings";
import {
  IsHistoryDashboardView,
  VIEW_TYPE_DASHBOARD,
} from "./dashboard";
import {
  IsHistorySidebarView,
  VIEW_TYPE_SIDEBAR,
} from "./sidebar";

export default class IsHistoryPlugin extends Plugin {
  settings!: IsHistorySettings;
  cache!: ContentCache;
  private _ribbonIcon: HTMLElement | null = null;
  private _dynamicStyleEl: HTMLElement | null = null;

  async onload() {
    try {
      await this.loadSettings();
      this.cache = new ContentCache();

      // Register views
      this.registerView(VIEW_TYPE_DASHBOARD, (leaf) => new IsHistoryDashboardView(leaf, this));
      this.registerView(VIEW_TYPE_SIDEBAR, (leaf) => new IsHistorySidebarView(leaf, this));

      // Inject dynamic CSS for track colors
      this._injectDynamicStyles();

      // Ribbon icon
      if (this.settings.showRibbonIcon) {
        this._ribbonIcon = this.addRibbonIcon("book-open", "isHistory CMS", () =>
          void this.activateDashboard()
        );
      }

      // Commands
      this.addCommand({
        id: "open-dashboard",
        name: "Open isHistory dashboard",
        callback: () => { void this.activateDashboard(); },
      });
      this.addCommand({
        id: "open-sidebar",
        name: "Open quick validate",
        callback: () => { void this.activateSidebar(); },
      });
      this.addCommand({
        id: "validate-current",
        name: "Validate current post",
        callback: () => this.validateCurrent(),
      });
      this.addCommand({
        id: "publish-current",
        name: "Pre-flight current draft",
        callback: () => { void this.publishCurrent(); },
      });

      // Dynamic track commands — one per track
      this._registerTrackCommands();

      this.addCommand({
        id: "bulk-validate",
        name: "Validate all content",
        callback: () => this.bulkValidate(),
      });
      this.addCommand({
        id: "bulk-preflight",
        name: "Bulk pre-flight all drafts",
        callback: () => { void this.bulkPreFlight(); },
      });

      // Settings tab
      this.addSettingTab(new IsHistorySettingTab(this.app, this));
    } catch (e) {
      console.error("isHistory CMS: fatal onload error", e);
      new Notice("isHistory CMS failed to load.");
    }
  }

  async onunload() {
    try {
      this.app.workspace.detachLeavesOfType(VIEW_TYPE_DASHBOARD);
      this.app.workspace.detachLeavesOfType(VIEW_TYPE_SIDEBAR);
      // Clean up injected styles
      this._dynamicStyleEl?.remove();
      this._dynamicStyleEl = null;
    } catch (e) {
      console.error("isHistory CMS: onunload error", e);
    }
  }

  // ─── Dynamic Track Commands ───

  private _registerTrackCommands(): void {
    for (const [code, info] of Object.entries(this.settings.tracks)) {
      this.addCommand({
        id: `new-${code.toLowerCase()}-track`,
        name: `New ${info.name} (${code}-track)`,
        callback: () => { void this.newPost(code); },
      });
    }
  }

  // ─── Dynamic CSS Injection ───

  /** Inject CSS variables and per-track styles from settings */
  _injectDynamicStyles(): void {
    let el = document.getElementById("ishistory-dynamic-styles") as HTMLElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = "ishistory-dynamic-styles";
      document.head.appendChild(el);
    }
    this._dynamicStyleEl = el;
    this._updateDynamicStyles();
  }

  /** Update the injected CSS — call when tracks change */
  _updateDynamicStyles(): void {
    if (!this._dynamicStyleEl) return;
    const rules: string[] = [];

    // CSS custom properties for track colors
    rules.push(":root {");
    for (const [code, info] of Object.entries(this.settings.tracks)) {
      rules.push(`--ish-track-${code.toLowerCase()}: ${info.color};`);
    }
    rules.push("}");

    // Per-track card code styles
    for (const [code, info] of Object.entries(this.settings.tracks)) {
      const lc = code.toLowerCase();
      rules.push(`.cms-card-code-${lc} { background: ${hexToRgba(info.color, 0.15)}; color: ${info.color}; }`);
      rules.push(`.cms-card.cms-card-track-${code} { border-left-color: ${info.color}; }`);
      rules.push(`.cms-stat-track-${lc} .cms-stat-value { color: ${info.color}; }`);
    }

    // Track tag styles (use primary track color with low opacity)
    const primaryColor = Object.values(this.settings.tracks)[0]?.color || "#7c3aed";
    rules.push(`.cms-card-tag { background: ${hexToRgba(primaryColor, 0.1)}; color: var(--ish-track-a, ${primaryColor}); }`);
    rules.push(`.cms-tag-chip { background: ${hexToRgba(primaryColor, 0.08)}; color: var(--ish-track-a, ${primaryColor}); }`);

    this._dynamicStyleEl.textContent = rules.join("\n");
  }

  // ─── Settings ───

  async loadSettings() {
    try {
      const loaded = await this.loadData();
      const migrated = migrateSettings(loaded || {});
      this.settings = Object.assign({}, DEFAULT_SETTINGS, migrated) as IsHistorySettings;
      this.settings._version = DEFAULT_SETTINGS._version;
      this.settings.archivePath = normalizePathSetting(this.settings.archivePath);
      this.settings.vaultPath = normalizePathSetting(this.settings.vaultPath);
      if (loaded && (loaded._version || 0) < DEFAULT_SETTINGS._version) {
        await this.saveData(this.settings);
      }
    } catch (e) {
      console.error("isHistory CMS: loadSettings failed", e);
      this.settings = Object.assign({}, DEFAULT_SETTINGS) as IsHistorySettings;
    }
  }

  async saveSettings() {
    try {
      await this.saveData(this.settings);
    } catch (e) {
      console.error("isHistory CMS: saveSettings failed", e);
    }
  }

  // ─── Cache Refresh ───

  rescanCache() {
    try {
      this.cache.scanAll(this.app, this.settings);
      const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD);
      for (const leaf of leaves) {
        if (leaf.view instanceof IsHistoryDashboardView) {
          leaf.view.requestRender();
        }
      }
    } catch (e) {
      console.error("isHistory CMS: rescanCache failed", e);
    }
  }

  // ─── Ribbon Icon ───

  updateRibbonIcon() {
    try {
      if (this._ribbonIcon) {
        this._ribbonIcon.remove();
        this._ribbonIcon = null;
      }
      if (this.settings.showRibbonIcon) {
        this._ribbonIcon = this.addRibbonIcon("book-open", "isHistory CMS", () =>
          void this.activateDashboard()
        );
      }
    } catch (e) {
      console.error("isHistory CMS: updateRibbonIcon failed", e);
    }
  }

  // ─── View Activation ───

  async activateDashboard() {
    try {
      const { workspace } = this.app;
      let leaf = workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)[0];
      if (!leaf) {
        leaf = workspace.getLeaf(false);
        await leaf.setViewState({ type: VIEW_TYPE_DASHBOARD, active: true });
      }
      await workspace.revealLeaf(leaf);
    } catch (e) { console.error(e); }
  }

  async activateSidebar() {
    try {
      const { workspace } = this.app;
      let leaf = workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR)[0];
      if (!leaf) {
        const rightLeaf = workspace.getRightLeaf(false);
        if (!rightLeaf) {
          new Notice("Could not open sidebar view.");
          return;
        }
        leaf = rightLeaf;
        await leaf.setViewState({ type: VIEW_TYPE_SIDEBAR, active: true });
      }
      await workspace.revealLeaf(leaf);
    } catch (e) { console.error(e); }
  }

  // ─── Shared Validation ───

  validateFile(file: TFile): ValidationResult {
    try {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      const config = getValidationConfig(this.settings);
      const isArchive = file.path.startsWith(normalizePathSetting(this.settings.archivePath));
      const isVault = file.path.startsWith(normalizePathSetting(this.settings.vaultPath));

      if (isArchive) {
        return getStatus(validateArchive(fm, config));
      } else if (isVault) {
        return getStatus(validateVault(fm, config));
      }
      return { status: "ready", label: "N/A", errors: [] };
    } catch {
      return {
        status: "error",
        label: "Error",
        errors: [{ field: "Validation", message: "Failed to validate.", severity: "error" }],
      };
    }
  }

  validateCurrent() {
    try {
      const file = this.app.workspace.getActiveFile();
      if (!file || !this.cache.isInCollection(file.path, this.settings)) {
        new Notice("Open an archive or vault file first.");
        return;
      }
      const result = this.validateFile(file);
      if (result.errors.length === 0) {
        new Notice(`${file.basename}: All fields valid!`);
      } else {
        new Notice(
          `${file.basename}: ${result.errors.filter((err) => err.severity === "error").length} error(s), ${result.errors.filter((err) => err.severity === "warning").length} warning(s)`
        );
      }
    } catch (e) {
      new Notice(`Validation failed: ${(e as Error).message}`);
    }
  }

  // ─── Shared Pre-flight (configurable) ───

  async preflightFile(file: TFile): Promise<void> {
    if (!file) return;
    try {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        fm.draft = this.settings.preflightDraft;
        fm.status = this.settings.preflightStatus;
        if (this.settings.preflightAutoDate && !fm.date) {
          fm.date = new Date().toISOString().split("T")[0];
        }
      });
      new Notice(`Pre-flighted: ${file.basename}. Sync with Git to deploy.`);
    } catch (e) {
      new Notice(`Pre-flight failed: ${(e as Error).message}`);
    }
  }

  async publishCurrent() {
    try {
      const file = this.app.workspace.getActiveFile();
      if (!file || !this.cache.isInCollection(file.path, this.settings)) {
        new Notice("Open an archive or vault file first.");
        return;
      }
      await this.preflightFile(file);
    } catch (e) {
      new Notice(`Failed: ${(e as Error).message}`);
    }
  }

  // ─── New Post (template engine) ───

  async newPost(track: TrackCode) {
    try {
      const info: TrackInfo | undefined = this.settings.tracks[track];
      if (!info) {
        new Notice(`Unknown track: ${track}`);
        return;
      }

      // Template variables
      const vars: Record<string, string> = {};

      // Find next seriesOrder number
      const existingOrders = this.cache
        .getSortedItems("archive", this.settings.tracks)
        .filter((i) => i.track === track && i.seriesOrder)
        .map((i) => {
          const m = i.seriesOrder.match(/^[A-Za-z](\d+)$/);
          return m ? parseInt(m[1], 10) : 0;
        });
      const nextNum = existingOrders.length > 0 ? Math.max(...existingOrders) + 1 : 1;
      const seriesOrder = `${track}${nextNum}`;

      vars.seriesOrder = seriesOrder;
      vars.seriesOrderLower = seriesOrder.toLowerCase();
      vars.track = track;
      vars.trackName = info.name;
      vars.date = new Date().toISOString().split("T")[0];
      vars.series = this.settings.defaultSeries || "";

      // Build slug from template
      const slug = substituteVars(this.settings.newPostSlug, vars);
      let path = `${normalizePathSetting(this.settings.archivePath)}/${slug}.md`;

      // Avoid file path collision
      let suffix = 0;
      while (this.app.vault.getAbstractFileByPath(path)) {
        suffix++;
        vars.seriesOrder = `${seriesOrder}-${suffix}`;
        vars.seriesOrderLower = `${seriesOrder.toLowerCase()}-${suffix}`;
        const collSlug = substituteVars(this.settings.newPostSlug, vars);
        path = `${normalizePathSetting(this.settings.archivePath)}/${collSlug}.md`;
      }

      // Reset vars for template
      vars.seriesOrder = suffix > 0 ? `${seriesOrder}-${suffix}` : seriesOrder;
      vars.seriesOrderLower = vars.seriesOrder.toLowerCase();

      // Build content from template settings
      const title = substituteVars(this.settings.newPostTitle, vars);
      const image = substituteVars(this.settings.newPostImage, vars);
      const status = this.settings.newPostStatus;
      const body = substituteVars(this.settings.newPostBody, vars);
      const series = this.settings.defaultSeries || "";

      const content = `---
title: "${title}"
date: ${vars.date}
description: ""
draft: true
tags: []
image: "${image}"
series: "${series}"
seriesOrder: "${vars.seriesOrder}"
track: "${track}"
status: "${status}"
part: ""
figures: ""
connects: ""
era: ""
aliases: ["${vars.seriesOrder}"]
---

${body}`;

      const createdFile = await this.app.vault.create(path, content);
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(createdFile);
      new Notice(`Created ${vars.seriesOrder} — fill in the frontmatter!`);
    } catch (e) {
      new Notice(`Failed to create: ${(e as Error).message}`);
    }
  }

  // ─── Bulk Operations ───

  bulkValidate() {
    try {
      this.cache.scanAll(this.app, this.settings);
      const items = this.cache.getSortedItems();
      const errors = items.filter((i) => i.validation.status === "error").length;
      const warnings = items.filter((i) => i.validation.status === "warning").length;
      const ready = items.filter((i) => i.validation.status === "ready").length;
      new Notice(`${items.length} posts: ${ready} ready, ${errors} errors, ${warnings} warnings`);
    } catch (e) {
      new Notice(`Bulk validate failed: ${(e as Error).message}`);
    }
  }

  async bulkPreFlight() {
    try {
      this.cache.scanAll(this.app, this.settings);
      const drafts = this.cache.getSortedItems("archive", this.settings.tracks).filter((i) => i.draft);
      if (drafts.length === 0) {
        new Notice("No drafts to pre-flight.");
        return;
      }

      const confirmed = await new Promise<boolean>((resolve) => {
        const modal = new Modal(this.app);
        modal.titleEl.setText(`Pre-flight ${drafts.length} draft(s)?`);
        const body = modal.contentEl.createEl("div");
        body.createEl("p", {
          text: `This will set ${drafts.length} draft(s) to draft:${this.settings.preflightDraft}, status:"${this.settings.preflightStatus}". Continue?`,
        });
        const btnRow = body.createEl("div", { cls: "cms-modal-btn-row" });
        btnRow
          .createEl("button", { text: "Cancel", cls: "cms-btn cms-btn-secondary" })
          .addEventListener("click", () => {
            modal.close();
            resolve(false);
          });
        btnRow
          .createEl("button", { text: "Pre-flight all", cls: "cms-btn cms-btn-primary" })
          .addEventListener("click", () => {
            modal.close();
            resolve(true);
          });
        modal.open();
      });

      if (!confirmed) return;

      let published = 0;
      for (const item of drafts) {
        try {
          await this.preflightFile(item.file);
          published++;
        } catch (e) {
          console.error(`Failed to pre-flight ${item.path}:`, e);
        }
      }
      new Notice(
        `Pre-flighted ${published}/${drafts.length} draft(s). Sync with Git to deploy.`
      );
    } catch (e) {
      new Notice(`Bulk pre-flight failed: ${(e as Error).message}`);
    }
  }
}
