/**
 * isHistory CMS Plugin — Main Entry Point
 *
 * Orchestrates all plugin components: cache, views, commands,
 * settings, and shared operations like preflight and new-post.
 */

import { Plugin, Notice, Modal, type TFile } from "obsidian";
import {
  type IsHistorySettings,
  type TrackCode,
  type ContentItem,
  type ValidationResult,
  DEFAULT_SETTINGS,
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
import { TRACKS } from "./types";

export class IsHistoryPlugin extends Plugin {
  settings!: IsHistorySettings;
  cache!: ContentCache;
  private _ribbonIcon: HTMLElement | null = null;

  async onload() {
    try {
      await this.loadSettings();
      this.cache = new ContentCache();

      // Register views
      this.registerView(VIEW_TYPE_DASHBOARD, (leaf) => new IsHistoryDashboardView(leaf, this));
      this.registerView(VIEW_TYPE_SIDEBAR, (leaf) => new IsHistorySidebarView(leaf, this));

      // Ribbon icon
      if (this.settings.showRibbonIcon) {
        this._ribbonIcon = this.addRibbonIcon("book-open", "isHistory CMS", () =>
          this.activateDashboard()
        );
      }

      // Commands
      this.addCommand({
        id: "open-dashboard",
        name: "Open isHistory dashboard",
        callback: () => this.activateDashboard(),
      });
      this.addCommand({
        id: "open-sidebar",
        name: "Open quick validate",
        callback: () => this.activateSidebar(),
      });
      this.addCommand({
        id: "validate-current",
        name: "Validate current post",
        callback: () => this.validateCurrent(),
      });
      this.addCommand({
        id: "publish-current",
        name: "Pre-flight current draft",
        callback: () => this.publishCurrent(),
      });
      this.addCommand({
        id: "new-article",
        name: "New article (A-track)",
        callback: () => this.newPost("A"),
      });
      this.addCommand({
        id: "new-profile",
        name: "New profile (P-track)",
        callback: () => this.newPost("P"),
      });
      this.addCommand({
        id: "new-event",
        name: "New event (E-track)",
        callback: () => this.newPost("E"),
      });
      this.addCommand({
        id: "bulk-validate",
        name: "Validate all content",
        callback: () => this.bulkValidate(),
      });
      this.addCommand({
        id: "bulk-preflight",
        name: "Bulk pre-flight all drafts",
        callback: () => this.bulkPreFlight(),
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
    } catch {}
  }

  // ─── Settings ───

  async loadSettings() {
    try {
      const loaded = await this.loadData();
      const migrated = migrateSettings(loaded || {});
      this.settings = Object.assign({}, DEFAULT_SETTINGS, migrated) as IsHistorySettings;
      this.settings._version = DEFAULT_SETTINGS._version;
      await this.saveData(this.settings);
    } catch {
      this.settings = Object.assign({}, DEFAULT_SETTINGS) as IsHistorySettings;
    }
  }

  async saveSettings() {
    try {
      await this.saveData(this.settings);
    } catch {}
  }

  // ─── Cache Refresh ───

  rescanCache() {
    try {
      this.cache.scanAll(this.app, this.settings);
      const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD);
      for (const leaf of leaves) {
        if (leaf.view instanceof IsHistoryDashboardView) {
          leaf.view.renderDashboard();
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
          this.activateDashboard()
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
      workspace.revealLeaf(leaf);
    } catch (e) { console.error(e); }
  }

  async activateSidebar() {
    try {
      const { workspace } = this.app;
      let leaf = workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR)[0];
      if (!leaf) {
        leaf = workspace.getRightLeaf(false)!;
        await leaf.setViewState({ type: VIEW_TYPE_SIDEBAR, active: true });
      }
      workspace.revealLeaf(leaf);
    } catch (e) { console.error(e); }
  }

  // ─── Shared Validation ───

  validateFile(file: TFile): ValidationResult {
    try {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      const isArchive = file.path.startsWith(this.settings.archivePath);
      const isVault = file.path.startsWith(this.settings.vaultPath);

      if (isArchive) {
        return getStatus(validateArchive(fm));
      } else if (isVault) {
        return getStatus(validateVault(fm));
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
          `${file.basename}: ${result.errors.filter((e) => e.severity === "error").length} error(s), ${result.errors.filter((e) => e.severity === "warning").length} warning(s)`
        );
      }
    } catch (e) {
      new Notice(`Validation failed: ${(e as Error).message}`);
    }
  }

  // ─── Shared Pre-flight (consolidated from 3 duplicates) ───

  async preflightFile(file: TFile): Promise<void> {
    if (!file) return;
    try {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        fm.draft = false;
        fm.status = "published";
        // Only set date to today if no date is already specified
        if (!fm.date) {
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

  // ─── New Post (consolidated from 2 duplicates) ───

  async newPost(track: TrackCode) {
    try {
      const info = TRACKS[track];
      if (!info) {
        new Notice(`Unknown track: ${track}`);
        return;
      }

      // Find the next available seriesOrder number
      const existingOrders = this.cache
        .getSortedItems("archive")
        .filter((i) => i.track === track && i.seriesOrder)
        .map((i) => {
          const m = i.seriesOrder.match(/^[APE](\d+)$/);
          return m ? parseInt(m[1], 10) : 0;
        });
      const nextNum = existingOrders.length > 0 ? Math.max(...existingOrders) + 1 : 1;
      const seriesOrder = `${track}${nextNum}`;

      let slug = `${seriesOrder}-untitled-post`;
      let path = `${this.settings.archivePath}/${slug}.md`;

      // Avoid file path collision
      let suffix = 0;
      while (this.app.vault.getAbstractFileByPath(path)) {
        suffix++;
        slug = `${seriesOrder}-untitled-post-${suffix}`;
        path = `${this.settings.archivePath}/${slug}.md`;
      }

      const content = `---
title: "Untitled ${info.name} Post"
date: ${new Date().toISOString().split("T")[0]}
description: ""
draft: true
tags: []
image: "/images/${seriesOrder.toLowerCase()}-hero.jpg"
series: "minds-and-machines"
seriesOrder: "${seriesOrder}"
track: "${track}"
status: "planned"
part: ""
figures: ""
connects: ""
era: ""
aliases: ["${seriesOrder}"]
---

Start writing here...
`;

      await this.app.vault.create(path, content);
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file) this.app.workspace.getLeaf(false).openFile(file as TFile);
      new Notice(`Created ${seriesOrder} — fill in the frontmatter!`);
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
      const drafts = this.cache.getSortedItems("archive").filter((i) => i.draft);
      if (drafts.length === 0) {
        new Notice("No drafts to pre-flight.");
        return;
      }

      const confirmed = await new Promise<boolean>((resolve) => {
        const modal = new Modal(this.app);
        modal.titleEl.setText(`Pre-flight ${drafts.length} draft(s)?`);
        const body = modal.contentEl.createEl("div");
        body.createEl("p", {
          text: `This will set ${drafts.length} draft(s) to draft:false, status:"published". Continue?`,
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
