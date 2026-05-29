/**
 * isHistory CMS Plugin — Dashboard View
 *
 * Full content management UI with differential rendering.
 * Only changed cards are re-rendered instead of full DOM rebuild.
 */

import { ItemView, type WorkspaceLeaf, Notice, Modal, TFile } from "obsidian";
import {
  type ContentItem,
  type IsHistorySettings,
  type TrackCode,
  TRACKS,
  DEFAULT_SETTINGS,
} from "./types";
import { ContentCache } from "./cache";
import { IsHistoryPlugin } from "./main";

export const VIEW_TYPE_DASHBOARD = "ishistory-dashboard";

export class IsHistoryDashboardView extends ItemView {
  plugin: IsHistoryPlugin;
  currentFilter = "all";
  searchQuery = "";
  private _visibleLimit: number;
  private _cardElements: Map<string, HTMLElement> = new Map();
  private _gridEl: HTMLElement | null = null;
  private _statsEl: HTMLElement | null = null;
  private _loadMoreEl: HTMLElement | null = null;
  private _totalVisible = 0;
  private _destroyed = false;
  private _ready = false;
  private _pendingPaths: Set<string> = new Set();
  private _updateTimer: ReturnType<typeof setTimeout> | null = null;
  // Track previous item states for differential comparison
  private _itemSnapshots: Map<string, string> = new Map();

  constructor(leaf: WorkspaceLeaf, plugin: IsHistoryPlugin) {
    super(leaf);
    this.plugin = plugin;
    this._visibleLimit = plugin.settings.cardsPerPage || DEFAULT_SETTINGS.cardsPerPage;
  }

  getViewType() { return VIEW_TYPE_DASHBOARD; }
  getDisplayText() { return "isHistory CMS"; }
  getIcon() { return "book-open"; }

  async onOpen() {
    this._destroyed = false;

    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (!this.app.workspace.layoutReady) return;
        if (this._destroyed) return;
        if (!this.plugin.cache.isInCollection(file.path, this.plugin.settings)) return;
        this._queuePath(file.path);
      })
    );

    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (!this.app.workspace.layoutReady) return;
        if (this._destroyed) return;
        if (!this.plugin.cache.isInCollection(file.path, this.plugin.settings) || !(file instanceof TFile)) return;
        this._queuePath(file.path);
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (!this.app.workspace.layoutReady) return;
        if (this._destroyed) return;
        if (!this.plugin.cache.isInCollection(file.path, this.plugin.settings)) return;
        this.plugin.cache.removeFile(file.path);
        this._queuePath(file.path);
      })
    );

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (!this.app.workspace.layoutReady) return;
        if (this._destroyed) return;
        if (this.plugin.cache.isInCollection(oldPath, this.plugin.settings)) {
          this.plugin.cache.removeFile(oldPath);
          this._queuePath(oldPath);
        }
        if (this.plugin.cache.isInCollection(file.path, this.plugin.settings) && file instanceof TFile) {
          this._queuePath(file.path);
        }
      })
    );

    if (this.app.workspace.layoutReady) {
      this._doInitialScan();
    } else {
      const ref = this.app.workspace.on("layout-ready" as any, () => {
        this.app.workspace.offref(ref);
        this._doInitialScan();
      });
      this.registerEvent(ref);
      this._showLoading();
    }
  }

  private _showLoading(): void {
    try {
      const c = this._getContainer();
      if (!c) return;
      c.empty();
      c.addClass("ishistory-dashboard");
      const loadingEl = c.createEl("div", { cls: "cms-loading-state" });
      loadingEl.createEl("div", { text: "Loading isHistory CMS...", cls: "cms-empty-title" });
    } catch { /* ignore */ }
  }

  private _doInitialScan(): void {
    if (this._destroyed) return;
    try { this.plugin.cache.scanAll(this.app, this.plugin.settings); } catch (e) { console.error(e); }
    this.renderDashboard();
    this._ready = true;
  }

  private _queuePath(path: string): void {
    this._pendingPaths.add(path);
    this._scheduleUpdate();
  }

  private _scheduleUpdate(): void {
    if (!this._ready) return;
    if (this._updateTimer) clearTimeout(this._updateTimer);
    this._updateTimer = setTimeout(() => this._processPending(), 500);
  }

  private _processPending(): void {
    if (this._destroyed || this._pendingPaths.size === 0) return;
    const paths = new Set(this._pendingPaths);
    this._pendingPaths.clear();

    for (const path of paths) {
      try {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file && file instanceof TFile && this.plugin.cache.isInCollection(path, this.plugin.settings)) {
          this.plugin.cache.updateFile(file, this.app, this.plugin.settings);
        }
        if (!file && this.plugin.cache.items.has(path)) {
          this.plugin.cache.removeFile(path);
        }
      } catch (e) { console.error(e); }
    }

    if (!this._destroyed && this._ready) {
      try { this._differentialUpdate(); } catch (e) { console.error(e); }
    }
  }

  private _getContainer(): HTMLElement | null {
    try {
      return this.containerEl.children[1] as HTMLElement || this.containerEl.createDiv();
    } catch { return null; }
  }

  // ─── Snapshot-based differential comparison ───

  private _itemFingerprint(item: ContentItem): string {
    return JSON.stringify({
      t: item.title, d: item.draft, s: item.status,
      v: item.validation.status, tr: item.track,
      desc: item.description, era: item.era, date: item.date,
      part: item.part, figures: item.figures, tags: item.tags,
      so: item.seriesOrder, errs: item.validation.errors.length,
    });
  }

  // ─── Full Dashboard Render (initial load) ───

  renderDashboard(): void {
    const container = this._getContainer();
    if (!container) return;
    container.empty();
    container.addClass("ishistory-dashboard");
    this._cardElements.clear();
    this._itemSnapshots.clear();

    try {
      const cache = this.plugin.cache;

      // Header
      const header = container.createEl("div", { cls: "cms-dash-header" });
      header.createEl("h2", { text: "isHistory", cls: "cms-dash-title" });
      header.createEl("p", { text: "Content management for the AI history archive", cls: "cms-dash-subtitle" });

      // Stats
      this._statsEl = container.createEl("div", { cls: "cms-stats-row" });
      this._renderStats();

      // Toolbar
      const toolbar = container.createEl("div", { cls: "cms-toolbar" });

      const searchWrap = toolbar.createEl("div", { cls: "cms-search-wrap" });
      const searchInput = searchWrap.createEl("input", {
        type: "text",
        placeholder: "Search posts, figures, tags...",
        cls: "cms-search-input",
        value: this.searchQuery,
      });
      searchInput.addEventListener("input", () => {
        this.searchQuery = searchInput.value;
        this.applyFilters();
      });

      const filterGroup = toolbar.createEl("div", { cls: "cms-filter-group" });
      const filters = [
        { key: "all", label: "All" },
        { key: "archive", label: "📰 Archive" },
        { key: "track-A", label: "A Articles" },
        { key: "track-P", label: "P Profiles" },
        { key: "track-E", label: "E Events" },
        { key: "vault", label: "🔒 Vault" },
        { key: "drafts", label: "Drafts" },
        { key: "errors", label: "Errors" },
      ];
      for (const f of filters) {
        const btn = filterGroup.createEl("button", {
          text: f.label,
          cls: `cms-filter-btn ${this.currentFilter === f.key ? "cms-filter-btn-active" : ""}`,
        });
        btn.addEventListener("click", () => {
          this.currentFilter = f.key;
          filterGroup.querySelectorAll(".cms-filter-btn").forEach((b) => b.removeClass("cms-filter-btn-active"));
          btn.addClass("cms-filter-btn-active");
          this.applyFilters();
        });
      }

      const actionsGroup = toolbar.createEl("div", { cls: "cms-actions-group" });
      actionsGroup
        .createEl("button", { text: "+ New Post", cls: "cms-btn cms-btn-primary" })
        .addEventListener("click", () => this._newPost());
      actionsGroup
        .createEl("button", { text: "Refresh", cls: "cms-btn cms-btn-secondary" })
        .addEventListener("click", () => {
          try {
            this.plugin.cache.scanAll(this.app, this.plugin.settings);
            this.renderDashboard();
          } catch (e) { console.error(e); }
        });

      // Grid
      this._gridEl = container.createEl("div", { cls: "cms-content-grid" });
      const items = cache.getSortedItems();
      if (items.length === 0) {
        const emptyEl = this._gridEl.createEl("div", { cls: "cms-empty-state" });
        emptyEl.createEl("div", { text: "No content found", cls: "cms-empty-title" });
        emptyEl.createEl("div", { text: "Check your content paths in Settings.", cls: "cms-empty-desc" });
      } else {
        for (const item of items) {
          this._createCardElement(item);
          this._itemSnapshots.set(item.path, this._itemFingerprint(item));
        }
      }

      // Load More
      this._loadMoreEl = container.createEl("div", { cls: "cms-load-more-wrap" });
      this._loadMoreEl
        .createEl("button", { text: "Load More", cls: "cms-btn cms-btn-secondary cms-btn-full" })
        .addEventListener("click", () => {
          this._visibleLimit += this.plugin.settings.cardsPerPage || DEFAULT_SETTINGS.cardsPerPage;
          this.applyFilters();
        });

      this.applyFilters();
      this._renderMetaSection(container);
    } catch (e) {
      console.error("isHistory Dashboard render error:", e);
      try {
        container.empty();
        const err = container.createEl("div", { cls: "cms-error-display" });
        err.createEl("h3", { text: "Error" });
        err.createEl("p", { text: (e as Error).message });
      } catch {}
    }
  }

  // ─── DIFFERENTIAL UPDATE (core improvement) ───

  private _differentialUpdate(): void {
    if (!this._gridEl || this._destroyed) return;

    const cache = this.plugin.cache;
    const currentItems = new Map<string, ContentItem>();
    for (const item of cache.getSortedItems()) {
      currentItems.set(item.path, item);
    }

    // 1. Remove cards for deleted items
    for (const [path, cardEl] of this._cardElements) {
      if (!currentItems.has(path)) {
        cardEl.remove();
        this._cardElements.delete(path);
        this._itemSnapshots.delete(path);
      }
    }

    // 2. Add or update cards for current items
    for (const item of currentItems.values()) {
      const existingCard = this._cardElements.get(item.path);
      const prevSnapshot = this._itemSnapshots.get(item.path);
      const newSnapshot = this._itemFingerprint(item);

      if (!existingCard) {
        // New item — create card and insert in sorted order
        this._createCardElement(item);
        this._itemSnapshots.set(item.path, newSnapshot);
      } else if (prevSnapshot !== newSnapshot) {
        // Changed item — replace the card in-place
        const parent = existingCard.parentElement;
        const nextSibling = existingCard.nextSibling;
        existingCard.remove();
        const newCard = this._buildCardDOM(item);
        if (parent) {
          parent.insertBefore(newCard, nextSibling);
        }
        this._cardElements.set(item.path, newCard);
        this._itemSnapshots.set(item.path, newSnapshot);
      }
      // If snapshot matches, skip — no DOM work needed
    }

    // 3. Update stats
    if (this._statsEl) {
      this._renderStats();
    }

    // 4. Re-apply filters
    this.applyFilters();
  }

  // ─── Stats Rendering ───

  private _renderStats(): void {
    if (!this._statsEl) return;
    try {
      this._statsEl.empty();
      const s = this.plugin.cache.getStats();
      const cards = [
        { label: "Archive", value: s.archiveTotal, cls: "" },
        { label: "Vault", value: s.vaultTotal, cls: "cms-stat-vault" },
        { label: "A Articles", value: s.trackA, cls: "cms-stat-track-a" },
        { label: "P Profiles", value: s.trackP, cls: "cms-stat-track-p" },
        { label: "E Events", value: s.trackE, cls: "cms-stat-track-e" },
        { label: "Drafts", value: s.drafts, cls: "cms-stat-warning" },
        { label: "Errors", value: s.errors, cls: "cms-stat-error" },
        { label: "Ready", value: s.ready, cls: "cms-stat-success" },
      ];
      for (const c of cards) {
        const el = this._statsEl.createEl("div", { cls: `cms-stat-card ${c.cls}` });
        el.createEl("div", { text: String(c.value), cls: "cms-stat-value" });
        el.createEl("div", { text: c.label, cls: "cms-stat-label" });
      }
    } catch (e) { console.error(e); }
  }

  // ─── Card DOM Building ───

  private _buildCardDOM(item: ContentItem): HTMLElement {
    const card = this._gridEl!.createEl("div", {
      cls: `cms-card cms-card-${item.validation.status} cms-card-${item.collection}${item.track ? " cms-card-track-" + item.track : ""}`,
      attr: {
        "data-path": item.path,
        "data-collection": item.collection,
        "data-track": item.track || "",
        "data-validation": item.validation.status,
        "data-draft": String(item.draft),
        "data-status": item.status,
      },
    });

    // Header
    const cardHeader = card.createEl("div", { cls: "cms-card-header" });
    const titleArea = cardHeader.createEl("div", { cls: "cms-card-title-area" });
    if (item.seriesOrder) {
      titleArea.createEl("span", {
        text: item.seriesOrder,
        cls: `cms-card-code cms-card-code-${item.track || "X"}`,
      });
    }
    titleArea.createEl("span", { text: item.title, cls: "cms-card-title" });

    // Badges
    const badgeArea = cardHeader.createEl("div", { cls: "cms-card-badges" });
    if (item.track && TRACKS[item.track]) {
      badgeArea.createEl("span", {
        text: `${TRACKS[item.track].emoji} ${TRACKS[item.track].name}`,
        cls: "cms-badge cms-badge-track",
      });
    } else if (item.track) {
      badgeArea.createEl("span", { text: "❓ Custom Track", cls: "cms-badge cms-badge-track" });
    }
    badgeArea.createEl("span", {
      text: item.validation.label,
      cls: `cms-badge cms-badge-${item.validation.status === "ready" ? "success" : item.validation.status === "error" ? "error" : "warning"}`,
    });

    // Body
    const cardBody = card.createEl("div", { cls: "cms-card-body" });

    if (item.description) {
      cardBody.createEl("div", {
        text: item.description.length > 120 ? item.description.substring(0, 120) + "..." : item.description,
        cls: "cms-card-desc",
      });
    }

    const metaRow = cardBody.createEl("div", { cls: "cms-card-meta" });
    if (item.era) metaRow.createEl("span", { text: item.era, cls: "cms-meta-item cms-meta-era" });
    if (item.date) metaRow.createEl("span", { text: item.date, cls: "cms-meta-item" });
    if (item.status) metaRow.createEl("span", { text: item.status, cls: `cms-meta-item cms-status-${item.status}` });
    if (item.draft) metaRow.createEl("span", { text: "DRAFT", cls: "cms-meta-item cms-draft-yes" });
    if (item.part) metaRow.createEl("span", { text: item.part, cls: "cms-meta-item" });

    if (item.figures) {
      const figRow = cardBody.createEl("div", { cls: "cms-card-figures" });
      figRow.createEl("span", { text: "Figures: ", cls: "cms-figures-label" });
      figRow.createEl("span", {
        text: item.figures.length > 60 ? item.figures.substring(0, 60) + "..." : item.figures,
        cls: "cms-figures-value",
      });
    }

    if (item.tags.length > 0) {
      const tagRow = cardBody.createEl("div", { cls: "cms-card-tags" });
      for (const tag of item.tags.slice(0, 4))
        tagRow.createEl("span", { text: tag, cls: "cms-card-tag" });
      if (item.tags.length > 4)
        tagRow.createEl("span", { text: `+${item.tags.length - 4}`, cls: "cms-card-tag cms-card-tag-more" });
    }

    if (item.validation.errors.length > 0) {
      const errorList = cardBody.createEl("div", { cls: "cms-card-errors" });
      for (const err of item.validation.errors.slice(0, 3)) {
        errorList.createEl("div", {
          text: `${err.field}: ${err.message}`,
          cls: `cms-card-error cms-card-error-${err.severity}`,
        });
      }
      if (item.validation.errors.length > 3)
        errorList.createEl("div", { text: `+${item.validation.errors.length - 3} more`, cls: "cms-card-error-more" });
    }

    // Actions
    const cardActions = card.createEl("div", { cls: "cms-card-actions" });
    cardActions
      .createEl("button", { text: "Open", cls: "cms-btn cms-btn-sm" })
      .addEventListener("click", () => {
        if (item.file) this.app.workspace.getLeaf(false).openFile(item.file);
      });
    cardActions
      .createEl("button", { text: "Validate", cls: "cms-btn cms-btn-sm cms-btn-secondary" })
      .addEventListener("click", () => {
        try {
          const r = this.plugin.validateFile(item.file);
          new Notice(
            r.errors.length === 0
              ? `${item.seriesOrder || item.name}: All fields valid!`
              : `${item.seriesOrder || item.name}: ${r.errors.filter((e) => e.severity === "error").length} error(s), ${r.errors.filter((e) => e.severity === "warning").length} warning(s)`
          );
        } catch (e) { new Notice(`Validation failed: ${(e as Error).message}`); }
      });
    if (item.draft) {
      cardActions
        .createEl("button", { text: "Pre-flight", cls: "cms-btn cms-btn-sm cms-btn-primary" })
        .addEventListener("click", () => this.plugin.preflightFile(item.file));
    }

    return card;
  }

  private _createCardElement(item: ContentItem): HTMLElement | null {
    if (!this._gridEl) return null;
    try {
      const card = this._buildCardDOM(item);
      this._cardElements.set(item.path, card);
      return card;
    } catch (e) { console.error(e); return null; }
  }

  // ─── New Post ───

  private async _newPost(): Promise<void> {
    try {
      const trackModal = new Modal(this.app);
      trackModal.titleEl.setText("New Post — Select Track");
      const body = trackModal.contentEl.createEl("div", { cls: "cms-new-post-tracks" });

      for (const [code, info] of Object.entries(TRACKS) as [string, typeof TRACKS[TrackCode]][]) {
        const btn = body.createEl("button", {
          text: `${info.emoji} ${info.name} (${code})`,
          cls: "cms-btn cms-btn-track-btn",
        });
        btn.addEventListener("click", async () => {
          trackModal.close();
          await this.plugin.newPost(code as TrackCode);
        });
      }
      trackModal.open();
    } catch (e) { console.error(e); }
  }

  // ─── Filter Application ───

  applyFilters(): void {
    try {
      const filter = this.currentFilter;
      const search = this.searchQuery.toLowerCase().trim();
      let visibleCount = 0;

      for (const [path, cardEl] of this._cardElements) {
        const item = this.plugin.cache.items.get(path);
        if (!item) { cardEl.style.display = "none"; continue; }
        const matches = this.plugin.cache.matchesFilter(item, filter, search);
        const beyondPage = matches && visibleCount >= this._visibleLimit;
        if (matches) visibleCount++;
        cardEl.style.display = !matches || beyondPage ? "none" : "";
      }

      this._totalVisible = visibleCount;
      if (this._loadMoreEl) {
        this._loadMoreEl.style.display = this._totalVisible > this._visibleLimit ? "" : "none";
        const btn = this._loadMoreEl.querySelector("button");
        if (btn) btn.textContent = `Load More (${Math.max(0, this._totalVisible - this._visibleLimit)} remaining)`;
      }
    } catch (e) { console.error(e); }
  }

  // ─── Meta Section ───

  private _renderMetaSection(container: HTMLElement): void {
    if (!container) return;
    try {
      const existing = container.querySelector(".cms-meta-section");
      if (existing) existing.remove();

      const stats = this.plugin.cache.getStats();
      if (stats.uniqueTags.length === 0 && stats.allEras.length === 0) return;

      const items = this.plugin.cache.getSortedItems();
      const section = container.createEl("div", { cls: "cms-meta-section" });

      if (stats.allEras.length > 0) {
        const block = section.createEl("div", { cls: "cms-meta-block" });
        block.createEl("h4", { text: `Eras (${stats.allEras.length})`, cls: "cms-meta-heading" });
        const list = block.createEl("div", { cls: "cms-tag-list" });
        for (const era of stats.allEras.sort()) {
          list.createEl("span", {
            text: `${era} (${items.filter((i) => i.era === era).length})`,
            cls: "cms-tag-chip cms-era-chip",
          });
        }
      }

      if (stats.uniqueTags.length > 0) {
        const block = section.createEl("div", { cls: "cms-meta-block" });
        block.createEl("h4", { text: `Tags (${stats.uniqueTags.length})`, cls: "cms-meta-heading" });
        const list = block.createEl("div", { cls: "cms-tag-list" });
        for (const tag of stats.uniqueTags.sort().slice(0, 30)) {
          list.createEl("span", {
            text: `${tag} (${items.filter((i) => i.tags.includes(tag)).length})`,
            cls: "cms-tag-chip",
          });
        }
        if (stats.uniqueTags.length > 30)
          list.createEl("span", { text: `+${stats.uniqueTags.length - 30} more`, cls: "cms-tag-chip" });
      }
    } catch (e) { console.error(e); }
  }

  async onClose() {
    this._destroyed = true;
    this._ready = false;
    if (this._updateTimer) clearTimeout(this._updateTimer);
    this._cardElements.clear();
    this._pendingPaths.clear();
    this._itemSnapshots.clear();
  }
}
