const obsidian = require('obsidian');

/* ═══════════════════════════════════════════════════════════
   SETTINGS — with schema versioning
   ═══════════════════════════════════════════════════════════ */

const SETTINGS_VERSION = 2;

const DEFAULT_SETTINGS = {
    _version: SETTINGS_VERSION,
    contentPath: "src/content",
    requiredFields: ["title", "description", "status", "era"],
    validateDraft: true,
    validateDate: true,
    autoSyncGraph: true,
    showRibbonIcon: true,
    cardsPerPage: 40,
};

function migrateSettings(loaded) {
    const version = loaded._version || 0;

    // v0 → v1: initial versioned settings
    if (version < 1) {
        if (loaded.oldContentPath) {
            loaded.contentPath = loaded.oldContentPath;
            delete loaded.oldContentPath;
        }
    }

    // v1 → v2: requiredFields changed from comma-string to array
    if (version < 2) {
        if (typeof loaded.requiredFields === "string") {
            loaded.requiredFields = loaded.requiredFields.split(",").map(s => s.trim()).filter(s => s);
        }
        if (loaded.cardsPerPage === undefined) {
            loaded.cardsPerPage = 40;
        }
    }

    loaded._version = SETTINGS_VERSION;
    return loaded;
}

/* ═══════════════════════════════════════════════════════════
   VALIDATOR ENGINE
   ═══════════════════════════════════════════════════════════ */

class AstroCMSValidator {
    static validate(frontmatter, settings) {
        const errors = [];
        if (!frontmatter) {
            errors.push({ field: "Frontmatter", message: "Metadata block is completely missing.", severity: "error" });
            return errors;
        }

        const required = settings.requiredFields || DEFAULT_SETTINGS.requiredFields;
        for (const field of required) {
            if (!frontmatter[field] || typeof frontmatter[field] !== "string" || frontmatter[field].trim() === "") {
                errors.push({ field, message: `This field is missing or empty. Astro requires it to compile.`, severity: "error" });
            }
        }

        if (settings.validateDraft) {
            if (frontmatter["draft"] === undefined || typeof frontmatter["draft"] !== "boolean") {
                errors.push({ field: "draft", message: "Must be explicitly set to true or false (no quotes).", severity: "error" });
            }
        }

        if (settings.validateDate) {
            if (!frontmatter["date"]) {
                errors.push({ field: "date", message: "Publication date is missing.", severity: "error" });
            } else {
                const dateStr = String(frontmatter["date"]);
                if (isNaN(Date.parse(dateStr))) {
                    errors.push({ field: "date", message: "Invalid date format. Use YYYY-MM-DD.", severity: "error" });
                }
            }
        }

        const arrayFields = ["tags", "connects"];
        for (const field of arrayFields) {
            if (frontmatter[field] !== undefined && !Array.isArray(frontmatter[field])) {
                errors.push({ field, message: `Must be formatted as a list, e.g.: ["item1", "item2"]`, severity: "warning" });
            }
        }

        if (frontmatter["series"] && !frontmatter["seriesOrder"]) {
            errors.push({ field: "seriesOrder", message: "You have an active 'series' but forgot to specify a 'seriesOrder' (e.g., 'A1').", severity: "warning" });
        }

        return errors;
    }

    static getStatusForFile(file, app, settings) {
        const cache = app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter;
        const errors = this.validate(fm, settings);
        if (errors.length === 0) return { status: "ready", label: "Ready", errors: [] };
        if (errors.some(e => e.severity === "error")) return { status: "error", label: "Errors", errors };
        return { status: "warning", label: "Warnings", errors };
    }
}

/* ═══════════════════════════════════════════════════════════
   CONTENT CACHE — incremental, never re-scans everything
   ═══════════════════════════════════════════════════════════ */

class ContentCache {
    constructor() {
        this.items = new Map(); // path → ContentItem
        this._stats = null;
        this._statsDirty = true;
        this._lastContentPath = null;
    }

    _buildItem(file, app, settings) {
        try {
            const cache = app.metadataCache.getFileCache(file);
            const fm = cache?.frontmatter || {};
            const validation = AstroCMSValidator.getStatusForFile(file, app, settings);
            return {
                file,
                path: file.path,
                name: file.basename,
                title: fm.title || file.basename,
                description: fm.description || "",
                status: fm.status || "—",
                era: fm.era || "—",
                draft: fm.draft,
                date: fm.date ? String(fm.date) : "—",
                tags: Array.isArray(fm.tags) ? fm.tags : [],
                connects: Array.isArray(fm.connects) ? fm.connects : [],
                series: fm.series || "",
                seriesOrder: fm.seriesOrder || "",
                validation,
            };
        } catch (e) {
            return null;
        }
    }

    scanAll(app, settings) {
        const contentPath = settings.contentPath || DEFAULT_SETTINGS.contentPath;

        // If content path changed, full reset
        if (this._lastContentPath && this._lastContentPath !== contentPath) {
            this.items.clear();
        }
        this._lastContentPath = contentPath;

        const files = app.vault.getMarkdownFiles();
        const contentFiles = files.filter(f => f.path.startsWith(contentPath));
        const currentPaths = new Set(contentFiles.map(f => f.path));

        // Remove files that no longer exist
        for (const path of this.items.keys()) {
            if (!currentPaths.has(path)) {
                this.items.delete(path);
                this._statsDirty = true;
            }
        }

        // Add or update files
        for (const file of contentFiles) {
            const existing = this.items.get(file.path);
            if (!existing || existing.file !== file) {
                const item = this._buildItem(file, app, settings);
                if (item) {
                    this.items.set(file.path, item);
                    this._statsDirty = true;
                }
            }
        }

        this._statsDirty = true;
    }

    updateFile(file, app, settings) {
        const contentPath = settings.contentPath || DEFAULT_SETTINGS.contentPath;
        if (!file.path.startsWith(contentPath)) return;

        const item = this._buildItem(file, app, settings);
        if (item) {
            this.items.set(file.path, item);
            this._statsDirty = true;
        }
    }

    removeFile(path) {
        if (this.items.has(path)) {
            this.items.delete(path);
            this._statsDirty = true;
        }
    }

    getStats() {
        if (!this._statsDirty && this._stats) return this._stats;

        const items = [...this.items.values()];
        this._stats = {
            total: items.length,
            published: items.filter(i => i.status === "published").length,
            drafts: items.filter(i => i.draft === true).length,
            ready: items.filter(i => i.validation.status === "ready").length,
            errors: items.filter(i => i.validation.status === "error").length,
            warnings: items.filter(i => i.validation.status === "warning").length,
            uniqueTags: [...new Set(items.flatMap(i => i.tags))],
            allEras: [...new Set(items.map(i => i.era).filter(e => e && e !== "—"))],
            allSeries: [...new Set(items.map(i => i.series).filter(s => s && s !== ""))],
        };
        this._statsDirty = false;
        return this._stats;
    }

    forceStatsDirty() {
        this._statsDirty = true;
    }

    getSortedItems() {
        return [...this.items.values()].sort((a, b) => a.path.localeCompare(b.path));
    }

    matchesFilter(item, filter, searchQuery) {
        // Filter check
        if (filter === "ready" && item.validation.status !== "ready") return false;
        if (filter === "error" && item.validation.status !== "error") return false;
        if (filter === "warning" && item.validation.status !== "warning") return false;
        if (filter === "draft" && item.draft !== true) return false;
        if (filter === "published" && item.status !== "published") return false;

        // Search check
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            return (
                item.title.toLowerCase().includes(q) ||
                item.path.toLowerCase().includes(q) ||
                item.tags.some(t => t.toLowerCase().includes(q)) ||
                item.era.toLowerCase().includes(q)
            );
        }

        return true;
    }
}

/* ═══════════════════════════════════════════════════════════
   DASHBOARD VIEW — incremental, never full re-render
   ═══════════════════════════════════════════════════════════ */

const VIEW_TYPE_DASHBOARD = "astro-cms-dashboard";

class AstroCMSDashboardView extends obsidian.ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.currentFilter = "all";
        this.searchQuery = "";
        this._visibleLimit = plugin.settings.cardsPerPage || 40;
        this._cardElements = new Map(); // path → HTMLElement
        this._gridEl = null;
        this._statsEl = null;
        this._loadMoreEl = null;
        this._totalVisible = 0;
    }

    getViewType() { return VIEW_TYPE_DASHBOARD; }
    getDisplayText() { return "Astro CMS Dashboard"; }
    getIcon() { return "layout-dashboard"; }

    async onOpen() {
        // ─── Smart event routing: update only what changed ───
        this.registerEvent(this.app.metadataCache.on("changed", (file) => {
            if (!file.path.startsWith(this.plugin.settings.contentPath)) return;
            this.plugin.cache.updateFile(file, this.app, this.plugin.settings);
            this._patchCard(file.path);
            this._patchStats();
        }));

        this.registerEvent(this.app.vault.on("create", (file) => {
            if (!file.path.startsWith(this.plugin.settings.contentPath) || file.extension !== "md") return;
            setTimeout(() => {
                this.plugin.cache.updateFile(file, this.app, this.plugin.settings);
                this._addCard(file.path);
                this._patchStats();
            }, 150);
        }));

        this.registerEvent(this.app.vault.on("delete", (file) => {
            if (!file.path.startsWith(this.plugin.settings.contentPath)) return;
            this.plugin.cache.removeFile(file.path);
            this._removeCard(file.path);
            this._patchStats();
        }));

        this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
            if (oldPath.startsWith(this.plugin.settings.contentPath)) {
                this.plugin.cache.removeFile(oldPath);
                this._removeCard(oldPath);
            }
            if (file.path.startsWith(this.plugin.settings.contentPath) && file.extension === "md") {
                setTimeout(() => {
                    this.plugin.cache.updateFile(file, this.app, this.plugin.settings);
                    this._addCard(file.path);
                    this._patchStats();
                }, 150);
            }
            this._patchStats();
        }));

        // Initial full scan + render
        try {
            this.plugin.cache.scanAll(this.app, this.plugin.settings);
        } catch (e) {
            console.error("Astro CMS: initial scan failed", e);
        }
        setTimeout(() => this.renderDashboard(), 50);
    }

    _getContainer() {
        return this.containerEl.children[1] || this.containerEl.createDiv();
    }

    /* ─── FULL RENDER (only called once on open + manual refresh) ─── */

    renderDashboard() {
        let container;
        try {
            container = this._getContainer();
        } catch (e) {
            return;
        }

        container.empty();
        container.addClass("astro-cms-dashboard");
        this._cardElements.clear();

        try {
            const cache = this.plugin.cache;

            // ─── Header ───
            const header = container.createEl("div", { cls: "cms-dash-header" });
            header.createEl("h2", { text: "Astro Content Dashboard", cls: "cms-dash-title" });
            header.createEl("p", { text: "Manage and validate your Astro content folder", cls: "cms-dash-subtitle" });

            // ─── Stats Row ───
            this._statsEl = container.createEl("div", { cls: "cms-stats-row" });
            this._renderStats();

            // ─── Toolbar ───
            const toolbar = container.createEl("div", { cls: "cms-toolbar" });

            const searchWrap = toolbar.createEl("div", { cls: "cms-search-wrap" });
            const searchInput = searchWrap.createEl("input", {
                type: "text", placeholder: "Search posts...",
                cls: "cms-search-input", value: this.searchQuery,
            });
            searchInput.addEventListener("input", () => {
                this.searchQuery = searchInput.value;
                this.applyFilters();
            });

            const filterGroup = toolbar.createEl("div", { cls: "cms-filter-group" });
            const filters = [
                { key: "all", label: "All" },
                { key: "ready", label: "Ready" },
                { key: "error", label: "Errors" },
                { key: "warning", label: "Warnings" },
                { key: "draft", label: "Drafts" },
                { key: "published", label: "Published" },
            ];
            for (const f of filters) {
                const btn = filterGroup.createEl("button", {
                    text: f.label,
                    cls: `cms-filter-btn ${this.currentFilter === f.key ? "cms-filter-btn-active" : ""}`,
                });
                btn.addEventListener("click", () => {
                    this.currentFilter = f.key;
                    filterGroup.querySelectorAll(".cms-filter-btn").forEach(b => b.removeClass("cms-filter-btn-active"));
                    btn.addClass("cms-filter-btn-active");
                    this.applyFilters();
                });
            }

            const actionsGroup = toolbar.createEl("div", { cls: "cms-actions-group" });
            actionsGroup.createEl("button", { text: "Bulk Pre-Flight", cls: "cms-btn cms-btn-primary" })
                .addEventListener("click", () => this._bulkPreflight());
            actionsGroup.createEl("button", { text: "Refresh", cls: "cms-btn cms-btn-secondary" })
                .addEventListener("click", () => {
                    this.plugin.cache.scanAll(this.app, this.plugin.settings);
                    this.renderDashboard();
                });

            // ─── Content Grid ───
            this._gridEl = container.createEl("div", { cls: "cms-content-grid" });
            const items = cache.getSortedItems();

            if (items.length === 0) {
                this._gridEl.createEl("div", { cls: "cms-empty-state" }).innerHTML =
                    `<div class="cms-empty-title">No posts found in ${this.plugin.settings.contentPath}</div>` +
                    `<div class="cms-empty-desc">Make sure your Astro content folder is inside your Obsidian vault.</div>`;
            } else {
                for (const item of items) {
                    this._createCardElement(item);
                }
            }

            // ─── Load More ───
            this._loadMoreEl = container.createEl("div", { cls: "cms-load-more-wrap" });
            this._loadMoreEl.createEl("button", { text: "Load More", cls: "cms-btn cms-btn-secondary cms-btn-full" })
                .addEventListener("click", () => {
                    this._visibleLimit += this.plugin.settings.cardsPerPage || 40;
                    this.applyFilters();
                });

            // Apply initial filter state
            this.applyFilters();

            // ─── Tags / Eras / Series ───
            this._renderMetaSection(container);

        } catch (e) {
            console.error("Astro CMS Dashboard render error:", e);
            container.empty();
            const err = container.createEl("div", { cls: "cms-error-display" });
            err.createEl("h3", { text: "Dashboard Error" });
            err.createEl("p", { text: e.message || "Unknown error." });
            err.createEl("pre", { text: e.stack || "" });
        }
    }

    /* ─── STATS ─── */

    _renderStats() {
        if (!this._statsEl) return;
        this._statsEl.empty();
        const s = this.plugin.cache.getStats();
        const cards = [
            { label: "Total Posts", value: s.total, cls: "" },
            { label: "Published", value: s.published, cls: "cms-stat-success" },
            { label: "Drafts", value: s.drafts, cls: "cms-stat-warning" },
            { label: "Errors", value: s.errors, cls: "cms-stat-error" },
            { label: "Warnings", value: s.warnings, cls: "cms-stat-warn" },
            { label: "Ready", value: s.ready, cls: "cms-stat-success" },
        ];
        for (const c of cards) {
            const el = this._statsEl.createEl("div", { cls: `cms-stat-card ${c.cls}` });
            el.createEl("div", { text: String(c.value), cls: "cms-stat-value" });
            el.createEl("div", { text: c.label, cls: "cms-stat-label" });
        }
    }

    _patchStats() {
        this._renderStats();
        this._renderMetaSection(this._getContainer());
    }

    /* ─── CARD CREATION ─── */

    _createCardElement(item) {
        const card = this._gridEl.createEl("div", {
            cls: `cms-card cms-card-${item.validation.status}`,
            attr: {
                "data-path": item.path,
                "data-validation": item.validation.status,
                "data-draft": String(item.draft === true),
                "data-publish": item.status,
            },
        });
        this._populateCard(card, item);
        this._cardElements.set(item.path, card);
        return card;
    }

    _populateCard(card, item) {
        card.empty();

        // Header
        const cardHeader = card.createEl("div", { cls: "cms-card-header" });
        cardHeader.createEl("span", { text: item.title, cls: "cms-card-title" });
        const badgeCls = { ready: "cms-badge-success", error: "cms-badge-error", warning: "cms-badge-warning" };
        cardHeader.createEl("span", { text: item.validation.label, cls: `cms-badge ${badgeCls[item.validation.status] || ""}` });

        // Body
        const cardBody = card.createEl("div", { cls: "cms-card-body" });
        const metaRow = cardBody.createEl("div", { cls: "cms-card-meta" });
        metaRow.createEl("span", { text: `Status: ${item.status}`, cls: "cms-meta-item" });
        metaRow.createEl("span", { text: `Era: ${item.era}`, cls: "cms-meta-item" });
        metaRow.createEl("span", { text: `Date: ${item.date}`, cls: "cms-meta-item" });
        if (item.draft !== undefined) {
            metaRow.createEl("span", {
                text: item.draft ? "Draft" : "Published",
                cls: `cms-meta-item cms-draft-${item.draft ? "yes" : "no"}`,
            });
        }

        if (item.tags.length > 0) {
            const tagRow = cardBody.createEl("div", { cls: "cms-card-tags" });
            for (const tag of item.tags.slice(0, 5)) {
                tagRow.createEl("span", { text: tag, cls: "cms-card-tag" });
            }
            if (item.tags.length > 5) {
                tagRow.createEl("span", { text: `+${item.tags.length - 5}`, cls: "cms-card-tag cms-card-tag-more" });
            }
        }

        if (item.validation.errors.length > 0) {
            const errorList = cardBody.createEl("div", { cls: "cms-card-errors" });
            for (const err of item.validation.errors.slice(0, 3)) {
                errorList.createEl("div", {
                    text: `${err.field}: ${err.message}`,
                    cls: `cms-card-error cms-card-error-${err.severity}`,
                });
            }
            if (item.validation.errors.length > 3) {
                errorList.createEl("div", { text: `+${item.validation.errors.length - 3} more`, cls: "cms-card-error-more" });
            }
        }

        // Actions
        const cardActions = card.createEl("div", { cls: "cms-card-actions" });
        cardActions.createEl("button", { text: "Open", cls: "cms-btn cms-btn-sm" })
            .addEventListener("click", () => this.app.workspace.getLeaf(false).openFile(item.file));
        if (item.draft === true) {
            cardActions.createEl("button", { text: "Pre-Flight", cls: "cms-btn cms-btn-sm cms-btn-primary" })
                .addEventListener("click", () => this._preflightSingle(item.file));
        }
        cardActions.createEl("button", { text: "Validate", cls: "cms-btn cms-btn-sm cms-btn-secondary" })
            .addEventListener("click", () => {
                const r = AstroCMSValidator.getStatusForFile(item.file, this.app, this.plugin.settings);
                new obsidian.Notice(r.errors.length === 0
                    ? `${item.file.basename}: All fields valid!`
                    : `${item.file.basename}: ${r.errors.filter(e => e.severity === "error").length} error(s), ${r.errors.filter(e => e.severity === "warning").length} warning(s)`);
            });
    }

    /* ─── INCREMENTAL CARD UPDATES ─── */

    _patchCard(path) {
        const item = this.plugin.cache.items.get(path);
        const cardEl = this._cardElements.get(path);
        if (!cardEl) {
            // New card — add it
            if (item) this._addCard(path);
            return;
        }
        if (!item) {
            this._removeCard(path);
            return;
        }

        // Update data attributes
        cardEl.className = `cms-card cms-card-${item.validation.status}`;
        cardEl.setAttribute("data-validation", item.validation.status);
        cardEl.setAttribute("data-draft", String(item.draft === true));
        cardEl.setAttribute("data-publish", item.status);

        // Repopulate card content in-place
        this._populateCard(cardEl, item);

        // Re-apply filters (card might now match/unmatch current filter)
        this.applyFilters();
    }

    _addCard(path) {
        const item = this.plugin.cache.items.get(path);
        if (!item || this._cardElements.has(path)) return;
        this._createCardElement(item);
        this.applyFilters();
    }

    _removeCard(path) {
        const cardEl = this._cardElements.get(path);
        if (cardEl) {
            cardEl.remove();
            this._cardElements.delete(path);
            this.applyFilters();
        }
    }

    /* ─── CSS-BASED SEARCH & FILTER ─── */

    applyFilters() {
        const filter = this.currentFilter;
        const search = this.searchQuery.toLowerCase().trim();
        let visibleCount = 0;

        for (const [path, cardEl] of this._cardElements) {
            const item = this.plugin.cache.items.get(path);
            if (!item) { cardEl.style.display = "none"; continue; }

            const matches = this.plugin.cache.matchesFilter(item, filter, search);
            const beyondPage = matches && visibleCount >= this._visibleLimit;

            if (matches) visibleCount++;
            cardEl.style.display = (!matches || beyondPage) ? "none" : "";
        }

        this._totalVisible = visibleCount;
        this._updateLoadMore();
    }

    _updateLoadMore() {
        if (!this._loadMoreEl) return;
        const totalMatching = this._totalVisible;
        this._loadMoreEl.style.display = totalMatching > this._visibleLimit ? "" : "none";
        const btn = this._loadMoreEl.querySelector("button");
        if (btn) btn.textContent = `Load More (${totalMatching - this._visibleLimit} remaining)`;
    }

    /* ─── META SECTION (Tags, Eras, Series) ─── */

    _renderMetaSection(container) {
        const existing = container.querySelector(".cms-meta-section");
        if (existing) existing.remove();

        const stats = this.plugin.cache.getStats();
        if (stats.uniqueTags.length === 0 && stats.allEras.length === 0 && stats.allSeries.length === 0) return;

        const items = this.plugin.cache.getSortedItems();
        const section = container.createEl("div", { cls: "cms-meta-section" });

        if (stats.uniqueTags.length > 0) {
            const block = section.createEl("div", { cls: "cms-meta-block" });
            block.createEl("h4", { text: `Tags (${stats.uniqueTags.length})`, cls: "cms-meta-heading" });
            const list = block.createEl("div", { cls: "cms-tag-list" });
            for (const tag of stats.uniqueTags.sort()) {
                const count = items.filter(i => i.tags.includes(tag)).length;
                list.createEl("span", { text: `${tag} (${count})`, cls: "cms-tag-chip" });
            }
        }

        if (stats.allEras.length > 0) {
            const block = section.createEl("div", { cls: "cms-meta-block" });
            block.createEl("h4", { text: `Eras (${stats.allEras.length})`, cls: "cms-meta-heading" });
            const list = block.createEl("div", { cls: "cms-tag-list" });
            for (const era of stats.allEras.sort()) {
                const count = items.filter(i => i.era === era).length;
                list.createEl("span", { text: `${era} (${count})`, cls: "cms-tag-chip cms-era-chip" });
            }
        }

        if (stats.allSeries.length > 0) {
            const block = section.createEl("div", { cls: "cms-meta-block" });
            block.createEl("h4", { text: `Series (${stats.allSeries.length})`, cls: "cms-meta-heading" });
            const list = block.createEl("div", { cls: "cms-tag-list" });
            for (const s of stats.allSeries.sort()) {
                const count = items.filter(i => i.series === s).length;
                list.createEl("span", { text: `${s} (${count})`, cls: "cms-tag-chip cms-series-chip" });
            }
        }
    }

    /* ─── ACTIONS ─── */

    async _preflightSingle(file) {
        try {
            await this.app.fileManager.processFrontMatter(file, (fm) => {
                fm["draft"] = false;
                fm["status"] = "published";
                fm["date"] = new Date().toISOString().split('T')[0];
            });
            new obsidian.Notice(`Pre-flight complete: ${file.basename}`);
            this.plugin.cache.updateFile(file, this.app, this.plugin.settings);
            this._patchCard(file.path);
            this._patchStats();
        } catch (e) {
            new obsidian.Notice(`Pre-flight failed: ${e.message}`);
        }
    }

    async _bulkPreflight() {
        const items = this.plugin.cache.getSortedItems().filter(i => i.draft === true);
        if (items.length === 0) { new obsidian.Notice("No drafts to pre-flight."); return; }

        const confirmed = await this._confirmAction(
            `Pre-flight ${items.length} draft(s)?`,
            `This will set draft=false, status="published", and today's date on all draft posts.`
        );
        if (!confirmed) return;

        let success = 0;
        for (const item of items) {
            try {
                await this.app.fileManager.processFrontMatter(item.file, (fm) => {
                    fm["draft"] = false;
                    fm["status"] = "published";
                    fm["date"] = new Date().toISOString().split('T')[0];
                });
                success++;
            } catch (e) { /* skip */ }
        }
        new obsidian.Notice(`Pre-flight complete: ${success}/${items.length} posts updated.`);
        this.plugin.cache.scanAll(this.app, this.plugin.settings);
        this.renderDashboard();
    }

    async _confirmAction(title, message) {
        return new Promise((resolve) => {
            const modal = new obsidian.Modal(this.app);
            modal.titleEl.setText(title);
            modal.contentEl.createEl("p", { text: message });
            const btnRow = modal.contentEl.createEl("div", { cls: "cms-modal-btn-row" });
            btnRow.createEl("button", { text: "Cancel", cls: "cms-btn cms-btn-secondary" })
                .addEventListener("click", () => { modal.close(); resolve(false); });
            btnRow.createEl("button", { text: "Confirm", cls: "cms-btn cms-btn-primary" })
                .addEventListener("click", () => { modal.close(); resolve(true); });
            modal.open();
        });
    }

    async onClose() {
        this._cardElements.clear();
    }
}

/* ═══════════════════════════════════════════════════════════
   SIDEBAR VIEW — lightweight per-file, uses cache
   ═══════════════════════════════════════════════════════════ */

const VIEW_TYPE_SIDEBAR = "astro-cms-sidebar-view";

class AstroCMSSidebarView extends obsidian.ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this._updateTimer = null;
    }

    getViewType() { return VIEW_TYPE_SIDEBAR; }
    getDisplayText() { return "Astro CMS Validate"; }
    getIcon() { return "checklist"; }

    async onOpen() {
        this.registerEvent(this.app.workspace.on("active-file-change", () => this.updateUI()));
        // Only re-validate if the active file's metadata changed
        this.registerEvent(this.app.metadataCache.on("changed", (file) => {
            const active = this.app.workspace.getActiveFile();
            if (active && file.path === active.path) this.updateUI();
        }));
        setTimeout(() => this.updateUI(), 50);
    }

    updateUI() {
        const container = this.containerEl.children[1];
        if (!container) return;
        container.empty();
        container.addClass("astro-cms-sidebar");
        const activeFile = this.app.workspace.getActiveFile();

        if (!activeFile || activeFile.extension !== "md" || !activeFile.path.startsWith(this.plugin.settings.contentPath)) {
            container.createEl("div", { text: `Open a file in ${this.plugin.settings.contentPath} to validate.`, cls: "cms-sidebar-empty-state" });
            return;
        }

        // Use cache if available, otherwise validate directly
        const cached = this.plugin.cache.items.get(activeFile.path);
        const result = cached
            ? cached.validation
            : AstroCMSValidator.getStatusForFile(activeFile, this.app, this.plugin.settings);

        container.createEl("div", { text: "Quick Validate", cls: "cms-sidebar-title" });
        container.createEl("div", { text: activeFile.path, cls: "cms-sidebar-file-title" });

        const statusWrapper = container.createEl("div", { cls: "cms-status-wrapper" });
        const badgeMap = {
            ready: { text: "Ready for GitHub", cls: "cms-badge-success" },
            error: { text: "Structural Errors Found", cls: "cms-badge-error" },
            warning: { text: "Optimization Warnings", cls: "cms-badge-warning" },
        };
        const badge = badgeMap[result.status] || badgeMap.error;
        statusWrapper.createEl("span", { text: badge.text, cls: `cms-badge ${badge.cls}` });

        container.createEl("hr");
        const listContainer = container.createEl("div", { cls: "cms-diagnostics-list" });

        if (result.errors.length === 0) {
            listContainer.createEl("div", { text: "All fields look perfect! Ready to push cleanly to production.", cls: "cms-success-text" });
        } else {
            for (const error of result.errors) {
                const errorItem = listContainer.createEl("div", { cls: `cms-error-item severity-${error.severity}` });
                errorItem.createEl("div", { text: error.field, cls: "cms-error-field" });
                errorItem.createEl("p", { text: error.message, cls: "cms-error-message" });
            }
        }

        const actions = container.createEl("div", { cls: "cms-sidebar-actions" });
        actions.createEl("button", { text: "Pre-Flight This Post", cls: "cms-btn cms-btn-primary cms-btn-full" })
            .addEventListener("click", async () => {
                try {
                    await this.app.fileManager.processFrontMatter(activeFile, (fm) => {
                        fm["draft"] = false;
                        fm["status"] = "published";
                        fm["date"] = new Date().toISOString().split('T')[0];
                    });
                    new obsidian.Notice(`Pre-flight complete: ${activeFile.basename}`);
                    this.plugin.cache.updateFile(activeFile, this.app, this.plugin.settings);
                    this.updateUI();
                } catch (e) {
                    new obsidian.Notice(`Pre-flight failed: ${e.message}`);
                }
            });
        actions.createEl("button", { text: "Open Dashboard", cls: "cms-btn cms-btn-secondary cms-btn-full" })
            .addEventListener("click", () => this.plugin.activateDashboard());
    }

    async onClose() {}
}

/* ═══════════════════════════════════════════════════════════
   SETTINGS TAB — with version display
   ═══════════════════════════════════════════════════════════ */

class AstroCMSSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl("h2", { text: "Astro CMS Plugin Settings" });

        new obsidian.Setting(containerEl)
            .setName("Content folder path")
            .setDesc("Path to your Astro content collection folder")
            .addText(text => text
                .setPlaceholder("src/content")
                .setValue(this.plugin.settings.contentPath)
                .onChange(async (value) => {
                    this.plugin.settings.contentPath = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl("h3", { text: "Validation Rules" });

        new obsidian.Setting(containerEl)
            .setName("Required fields")
            .setDesc("Comma-separated list of required frontmatter fields")
            .addText(text => text
                .setPlaceholder("title, description, status, era")
                .setValue(this.plugin.settings.requiredFields.join(", "))
                .onChange(async (value) => {
                    this.plugin.settings.requiredFields = value.split(",").map(s => s.trim()).filter(s => s);
                    await this.plugin.saveSettings();
                }));

        new obsidian.Setting(containerEl)
            .setName("Validate draft field")
            .setDesc("Check that the 'draft' field exists and is a boolean")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.validateDraft)
                .onChange(async (value) => {
                    this.plugin.settings.validateDraft = value;
                    await this.plugin.saveSettings();
                }));

        new obsidian.Setting(containerEl)
            .setName("Validate date field")
            .setDesc("Check that the 'date' field exists and is valid")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.validateDate)
                .onChange(async (value) => {
                    this.plugin.settings.validateDate = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl("h3", { text: "Performance" });

        new obsidian.Setting(containerEl)
            .setName("Cards per page")
            .setDesc("Number of content cards to show before 'Load More' (lower = faster)")
            .addSlider(slider => slider
                .setLimits(10, 100, 10)
                .setValue(this.plugin.settings.cardsPerPage || 40)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.cardsPerPage = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl("h3", { text: "Graph Integration" });

        new obsidian.Setting(containerEl)
            .setName("Auto-sync graph links")
            .setDesc("Inject 'connects', 'series', and 'era' as graph links for the Obsidian graph view")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoSyncGraph)
                .onChange(async (value) => {
                    this.plugin.settings.autoSyncGraph = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl("h3", { text: "Appearance" });

        new obsidian.Setting(containerEl)
            .setName("Show ribbon icon")
            .setDesc("Show the Astro CMS icon in the left ribbon")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showRibbonIcon)
                .onChange(async (value) => {
                    this.plugin.settings.showRibbonIcon = value;
                    await this.plugin.saveSettings();
                }));

        // Version info
        containerEl.createEl("div", { cls: "cms-settings-version" }).innerHTML =
            `Settings schema v${this.plugin.settings._version} &middot; Plugin v${this.plugin.manifest.version}`;
    }
}

/* ═══════════════════════════════════════════════════════════
   MAIN PLUGIN CLASS
   ═══════════════════════════════════════════════════════════ */

module.exports = class AstroCMSPlugin extends obsidian.Plugin {
    async onload() {
        await this.loadSettings();

        // Shared cache — lives on the plugin, shared by all views
        this.cache = new ContentCache();

        // Register views
        this.registerView(VIEW_TYPE_DASHBOARD, (leaf) => new AstroCMSDashboardView(leaf, this));
        this.registerView(VIEW_TYPE_SIDEBAR, (leaf) => new AstroCMSSidebarView(leaf, this));

        // Ribbon icon
        this.addRibbonIcon("layout-dashboard", "Astro CMS Dashboard", () => this.activateDashboard());

        // Commands
        this.addCommand({ id: "open-dashboard", name: "Open Dashboard", callback: () => this.activateDashboard() });
        this.addCommand({ id: "open-sidebar", name: "Open Quick Validate Sidebar", callback: () => this.activateSidebar() });
        this.addCommand({ id: "preflight-current", name: "Pre-Flight Current Post", callback: () => this.executePreflight() });
        this.addCommand({ id: "validate-current", name: "Validate Current Post", callback: () => this.validateCurrentFile() });
        this.addCommand({ id: "bulk-preflight", name: "Bulk Pre-Flight All Drafts", callback: () => this.bulkPreflight() });

        // Settings
        this.addSettingTab(new AstroCMSSettingTab(this.app, this));

        // Graph link injection (debounced batch)
        this._linkQueue = new Map();
        this._linkTimer = null;

        this.registerEvent(
            this.app.metadataCache.on("changed", (file) => {
                if (!this.settings.autoSyncGraph) return;
                if (!file.path.startsWith(this.settings.contentPath)) return;
                const cache = this.app.metadataCache.getFileCache(file);
                if (!cache || !cache.frontmatter) return;

                const fm = cache.frontmatter;
                const dynamicLinks = [];
                if (Array.isArray(fm["connects"])) dynamicLinks.push(...fm["connects"]);
                else if (typeof fm["connects"] === "string") dynamicLinks.push(...fm["connects"].split(",").map(s => s.trim()));
                if (fm["series"]) dynamicLinks.push(String(fm["series"]));
                if (fm["era"]) dynamicLinks.push(String(fm["era"]));
                if (dynamicLinks.length === 0) return;

                this._linkQueue.set(file.path, { file, dynamicLinks });
                this._scheduleLinkInjection();
            })
        );

        console.log("Astro CMS Plugin v" + this.manifest.version + " loaded");
    }

    _scheduleLinkInjection() {
        if (this._linkTimer) clearTimeout(this._linkTimer);
        this._linkTimer = setTimeout(() => this._processLinkQueue(), 500);
    }

    _processLinkQueue() {
        for (const [, { file, dynamicLinks }] of this._linkQueue) {
            try {
                const cache = this.app.metadataCache.getFileCache(file);
                if (!cache) continue;
                if (!cache.links) cache.links = [];
                for (const dest of dynamicLinks) {
                    if (dest && !cache.links.some(l => l.link === dest)) {
                        cache.links.push({
                            link: dest, original: `[[${dest}]]`, displayText: dest,
                            position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } },
                        });
                    }
                }
            } catch (e) { /* skip */ }
        }
        this._linkQueue.clear();
    }

    async onunload() {
        if (this._linkTimer) clearTimeout(this._linkTimer);
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_DASHBOARD);
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_SIDEBAR);
    }

    async loadSettings() {
        const loaded = await this.loadData();
        const migrated = migrateSettings(loaded || {});
        this.settings = Object.assign({}, DEFAULT_SETTINGS, migrated);
        // Ensure _version is always current
        this.settings._version = SETTINGS_VERSION;
        await this.saveSettings();
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async activateDashboard() {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)[0];
        if (!leaf) {
            leaf = workspace.getLeaf(false);
            await leaf.setViewState({ type: VIEW_TYPE_DASHBOARD, active: true });
        }
        workspace.revealLeaf(leaf);
    }

    async activateSidebar() {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR)[0];
        if (!leaf) {
            leaf = workspace.getRightLeaf(false);
            await leaf.setViewState({ type: VIEW_TYPE_SIDEBAR, active: true });
        }
        workspace.revealLeaf(leaf);
    }

    async executePreflight() {
        const file = this.app.workspace.getActiveFile();
        if (!file || !file.path.startsWith(this.settings.contentPath)) {
            new obsidian.Notice("Open a file in the content folder first.");
            return;
        }
        try {
            await this.app.fileManager.processFrontMatter(file, (fm) => {
                fm["draft"] = false;
                fm["status"] = "published";
                fm["date"] = new Date().toISOString().split('T')[0];
            });
            new obsidian.Notice(`Pre-flight complete: ${file.basename}`);
        } catch (e) {
            new obsidian.Notice(`Pre-flight failed: ${e.message}`);
        }
    }

    validateCurrentFile() {
        const file = this.app.workspace.getActiveFile();
        if (!file || !file.path.startsWith(this.settings.contentPath)) {
            new obsidian.Notice("Open a file in the content folder first.");
            return;
        }
        const result = AstroCMSValidator.getStatusForFile(file, this.app, this.settings);
        if (result.errors.length === 0) {
            new obsidian.Notice(`${file.basename}: All fields valid!`);
        } else {
            const e = result.errors.filter(e => e.severity === "error").length;
            const w = result.errors.filter(e => e.severity === "warning").length;
            new obsidian.Notice(`${file.basename}: ${e} error(s), ${w} warning(s)`);
        }
    }

    async bulkPreflight() {
        const items = this.cache.getSortedItems().filter(i => i.draft === true);
        if (items.length === 0) { new obsidian.Notice("No drafts to pre-flight."); return; }
        let success = 0;
        for (const item of items) {
            try {
                await this.app.fileManager.processFrontMatter(item.file, (fm) => {
                    fm["draft"] = false;
                    fm["status"] = "published";
                    fm["date"] = new Date().toISOString().split('T')[0];
                });
                success++;
            } catch (e) { /* skip */ }
        }
        new obsidian.Notice(`Pre-flight complete: ${success}/${items.length} posts updated.`);
    }
};
