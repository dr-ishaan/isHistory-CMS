const obsidian = require('obsidian');

/* ═════════════════════════════════════════════════════════════════════════
   isHistory CMS Plugin v3.0.0
   
   Custom-built CMS for the isHistory Astro project.
   Manages TWO content collections:
     - archive (src/content/blog/) — AI history posts with 3 tracks (A/P/E)
     - vault   (src/content/vault/) — Research notes & meta docs
   
   Every field, validator, and UI element is tailored to the
   isHistory content schema defined in src/content.config.ts
   ═════════════════════════════════════════════════════════════════════════ */

/* ─── isHistory Schema Constants ─── */

const TRACKS = {
    A: { name: "Articles", emoji: "📰", color: "#7c3aed" },
    P: { name: "Profiles", emoji: "🧠", color: "#3b82f6" },
    E: { name: "Events",   emoji: "⚡", color: "#f59e0b" },
};

const STATUSES = ["published", "upcoming", "planned"];

const SERIES = {
    "minds-and-machines": {
        name: "Minds & Machines",
        subtitle: "The Story of AI",
        tracks: { A: 25, P: 25, E: 25 },
    },
};

const ARCHIVE_REQUIRED = ["title", "date", "description"];
const ARCHIVE_OPTIONAL = ["draft", "tags", "image", "series", "seriesOrder", "track", "status", "part", "figures", "connects", "era", "aliases"];
const VAULT_REQUIRED = ["title"];

/* ─── Settings ─── */

const SETTINGS_VERSION = 5;

const DEFAULT_SETTINGS = {
    _version: SETTINGS_VERSION,
    archivePath: "src/content/blog",
    vaultPath: "src/content/vault",
    cardsPerPage: 40,
    showRibbonIcon: true,
};

function migrateSettings(loaded) {
    const version = loaded._version || 0;
    if (version < 5) {
        // v5: complete rebuild for isHistory schema
        // Reset to new defaults, preserve nothing from generic plugin
        loaded.archivePath = loaded.archivePath || DEFAULT_SETTINGS.archivePath;
        loaded.vaultPath = loaded.vaultPath || DEFAULT_SETTINGS.vaultPath;
        loaded.cardsPerPage = loaded.cardsPerPage || DEFAULT_SETTINGS.cardsPerPage;
        loaded.showRibbonIcon = loaded.showRibbonIcon !== undefined ? loaded.showRibbonIcon : true;
        // Remove old keys
        delete loaded.contentPath;
        delete loaded.requiredFields;
        delete loaded.validateDraft;
        delete loaded.validateDate;
        delete loaded.autoSyncGraph;
    }
    loaded._version = SETTINGS_VERSION;
    return loaded;
}

/* ═════════════════════════════════════════════════════════════════════════
   isHistory VALIDATOR — tailored to your content.config.ts
   ═════════════════════════════════════════════════════════════════════════ */

class IsHistoryValidator {

    static validateArchive(fm) {
        const errors = [];
        if (!fm) {
            errors.push({ field: "Frontmatter", message: "Missing frontmatter block entirely.", severity: "error" });
            return errors;
        }

        // Required fields
        if (!fm.title || typeof fm.title !== "string" || fm.title.trim().length < 5) {
            errors.push({ field: "title", message: "Required. Must be at least 5 characters for SEO.", severity: "error" });
        } else if (fm.title.length > 120) {
            errors.push({ field: "title", message: `Too long (${fm.title.length}/120 chars). Keep titles concise.`, severity: "warning" });
        }

        if (!fm.date) {
            errors.push({ field: "date", message: "Required. Publication date for the article.", severity: "error" });
        } else if (isNaN(Date.parse(String(fm.date)))) {
            errors.push({ field: "date", message: "Invalid date. Use YYYY-MM-DD format.", severity: "error" });
        }

        if (!fm.description || typeof fm.description !== "string" || fm.description.trim().length < 15) {
            errors.push({ field: "description", message: "Required. Must be at least 15 characters for SEO meta.", severity: "error" });
        } else if (fm.description.length > 160) {
            errors.push({ field: "description", message: `Too long (${fm.description.length}/160 chars). Will be truncated in search results.`, severity: "warning" });
        }

        // Track validation
        if (fm.track && !TRACKS[fm.track]) {
            errors.push({ field: "track", message: `Invalid track "${fm.track}". Must be A, P, or E.`, severity: "error" });
        }

        // Status validation
        if (fm.status && !STATUSES.includes(fm.status)) {
            errors.push({ field: "status", message: `Invalid status "${fm.status}". Must be published, upcoming, or planned.`, severity: "error" });
        }

        // Series + seriesOrder pair
        if (fm.series && !fm.seriesOrder) {
            errors.push({ field: "seriesOrder", message: `You set series="${fm.series}" but forgot seriesOrder (e.g. "A1", "P3", "E14").`, severity: "warning" });
        }
        if (fm.seriesOrder && !fm.series) {
            errors.push({ field: "series", message: `You set seriesOrder="${fm.seriesOrder}" but have no series defined.`, severity: "warning" });
        }

        // seriesOrder format check
        if (fm.seriesOrder && typeof fm.seriesOrder === "string") {
            const match = fm.seriesOrder.match(/^([APE])(\d+)$/);
            if (!match) {
                errors.push({ field: "seriesOrder", message: `Format should be track+number (e.g. "A1", "P3", "E14"). Got "${fm.seriesOrder}".`, severity: "warning" });
            } else {
                const orderTrack = match[1];
                if (fm.track && fm.track !== orderTrack) {
                    errors.push({ field: "seriesOrder", message: `seriesOrder track (${orderTrack}) doesn't match track field (${fm.track}).`, severity: "error" });
                }
            }
        }

        // Draft + status conflict
        if (fm.draft === true && fm.status === "published") {
            errors.push({ field: "draft", message: `Marked as draft but status is "published". Set draft:false or status:"upcoming".`, severity: "warning" });
        }

        // Tags format
        if (fm.tags !== undefined && !Array.isArray(fm.tags)) {
            errors.push({ field: "tags", message: "Must be a YAML list: [tag1, tag2, tag3]", severity: "error" });
        }

        // Aliases format
        if (fm.aliases !== undefined && !Array.isArray(fm.aliases)) {
            errors.push({ field: "aliases", message: "Must be a YAML list: [\"A1\"]", severity: "error" });
        }

        // Image path
        if (fm.image && typeof fm.image === "string" && !fm.image.startsWith("/")) {
            errors.push({ field: "image", message: "Hero image path should start with / (e.g. /images/a1-hero.jpg)", severity: "warning" });
        }

        // Connects format hint
        if (fm.connects && typeof fm.connects === "string") {
            // Valid format: "P1, A5, E3"
            const parts = fm.connects.split(",").map(s => s.trim()).filter(s => s);
            const badRefs = parts.filter(p => !p.match(/^[APE]\d+$/));
            if (badRefs.length > 0) {
                errors.push({ field: "connects", message: `Invalid references: ${badRefs.join(", ")}. Use format "P1, A5, E3".`, severity: "warning" });
            }
        }

        // Figures should be non-empty for profiles
        if (fm.track === "P" && (!fm.figures || fm.figures.trim() === "")) {
            errors.push({ field: "figures", message: "Profiles should list the key historic figure(s).", severity: "warning" });
        }

        return errors;
    }

    static validateVault(fm) {
        const errors = [];
        if (!fm) {
            errors.push({ field: "Frontmatter", message: "Missing frontmatter block.", severity: "error" });
            return errors;
        }
        if (!fm.title || typeof fm.title !== "string" || fm.title.trim() === "") {
            errors.push({ field: "title", message: "Required. Every vault note needs a title.", severity: "error" });
        }
        if (fm.publish !== undefined && typeof fm.publish !== "boolean") {
            errors.push({ field: "publish", message: "Must be true or false.", severity: "error" });
        }
        if (fm.tags !== undefined && !Array.isArray(fm.tags)) {
            errors.push({ field: "tags", message: "Must be a YAML list: [tag1, tag2]", severity: "error" });
        }
        if (fm.order !== undefined && typeof fm.order !== "number") {
            errors.push({ field: "order", message: "Must be a number for sorting.", severity: "error" });
        }
        return errors;
    }

    static getStatus(errors) {
        if (errors.length === 0) return { status: "ready", label: "Ready", errors };
        if (errors.some(e => e.severity === "error")) return { status: "error", label: "Errors", errors };
        return { status: "warning", label: "Warnings", errors };
    }

    static validateFile(file, app, settings) {
        try {
            const cache = app.metadataCache.getFileCache(file);
            const fm = cache?.frontmatter;
            const isArchive = file.path.startsWith(settings.archivePath);
            const isVault = file.path.startsWith(settings.vaultPath);

            if (isArchive) {
                return this.getStatus(this.validateArchive(fm));
            } else if (isVault) {
                return this.getStatus(this.validateVault(fm));
            }
            return { status: "ready", label: "N/A", errors: [] };
        } catch (e) {
            return { status: "error", label: "Error", errors: [{ field: "Validation", message: "Failed to validate.", severity: "error" }] };
        }
    }
}

/* ═════════════════════════════════════════════════════════════════════════
   CONTENT CACHE — dual-collection, incremental
   ═════════════════════════════════════════════════════════════════════════ */

class ContentCache {
    constructor() {
        this.items = new Map();
        this._stats = null;
        this._statsDirty = true;
    }

    _getCollection(path, settings) {
        if (path.startsWith(settings.archivePath)) return "archive";
        if (path.startsWith(settings.vaultPath)) return "vault";
        return null;
    }

    _buildItem(file, app, settings) {
        try {
            const collection = this._getCollection(file.path, settings);
            if (!collection) return null;

            const cache = app.metadataCache.getFileCache(file);
            const fm = cache?.frontmatter || {};
            const validation = IsHistoryValidator.validateFile(file, app, settings);

            // Derive track from seriesOrder if track field missing
            let track = fm.track || null;
            if (!track && fm.seriesOrder && typeof fm.seriesOrder === "string") {
                const m = fm.seriesOrder.match(/^([APE])/);
                if (m) track = m[1];
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
        } catch (e) { return null; }
    }

    scanAll(app, settings) {
        try {
            const files = app.vault.getMarkdownFiles();
            const contentFiles = files.filter(f =>
                f.path.startsWith(settings.archivePath) || f.path.startsWith(settings.vaultPath)
            );
            const currentPaths = new Set(contentFiles.map(f => f.path));

            for (const path of [...this.items.keys()]) {
                if (!currentPaths.has(path)) { this.items.delete(path); this._statsDirty = true; }
            }
            for (const file of contentFiles) {
                const existing = this.items.get(file.path);
                if (!existing || existing.file !== file) {
                    const item = this._buildItem(file, app, settings);
                    if (item) { this.items.set(file.path, item); this._statsDirty = true; }
                }
            }
            this._statsDirty = true;
        } catch (e) { console.error("isHistory CMS: scanAll failed", e); }
    }

    updateFile(file, app, settings) {
        try {
            if (!this._getCollection(file.path, settings)) return;
            const item = this._buildItem(file, app, settings);
            if (item) { this.items.set(file.path, item); this._statsDirty = true; }
        } catch (e) { console.error("isHistory CMS: updateFile failed", e); }
    }

    removeFile(path) {
        if (this.items.has(path)) { this.items.delete(path); this._statsDirty = true; }
    }

    isInCollection(path, settings) {
        return path.startsWith(settings.archivePath) || path.startsWith(settings.vaultPath);
    }

    getStats() {
        if (!this._statsDirty && this._stats) return this._stats;
        try {
            const items = [...this.items.values()];
            const archive = items.filter(i => i.collection === "archive");
            const vault = items.filter(i => i.collection === "vault");

            const byTrack = { A: archive.filter(i => i.track === "A"), P: archive.filter(i => i.track === "P"), E: archive.filter(i => i.track === "E"), none: archive.filter(i => !i.track) };
            const byStatus = { published: archive.filter(i => i.status === "published").length, upcoming: archive.filter(i => i.status === "upcoming").length, planned: archive.filter(i => i.status === "planned").length, none: archive.filter(i => !i.status).length };

            this._stats = {
                total: items.length,
                archiveTotal: archive.length,
                vaultTotal: vault.length,
                drafts: archive.filter(i => i.draft).length,
                published: byStatus.published,
                upcoming: byStatus.upcoming,
                planned: byStatus.planned,
                ready: items.filter(i => i.validation.status === "ready").length,
                errors: items.filter(i => i.validation.status === "error").length,
                warnings: items.filter(i => i.validation.status === "warning").length,
                trackA: byTrack.A.length,
                trackP: byTrack.P.length,
                trackE: byTrack.E.length,
                trackNone: byTrack.none.length,
                uniqueTags: [...new Set(items.flatMap(i => i.tags))],
                allEras: [...new Set(archive.map(i => i.era).filter(e => e))],
                allSeries: [...new Set(archive.map(i => i.series).filter(s => s))],
            };
            this._statsDirty = false;
            return this._stats;
        } catch (e) {
            console.error("isHistory CMS: getStats failed", e);
            return { total: 0, archiveTotal: 0, vaultTotal: 0, drafts: 0, published: 0, upcoming: 0, planned: 0, ready: 0, errors: 0, warnings: 0, trackA: 0, trackP: 0, trackE: 0, trackNone: 0, uniqueTags: [], allEras: [], allSeries: [] };
        }
    }

    getSortedItems(collection) {
        const items = [...this.items.values()];
        const filtered = collection ? items.filter(i => i.collection === collection) : items;
        return filtered.sort((a, b) => {
            // Sort by seriesOrder if available, then path
            const ao = a.seriesOrder || "";
            const bo = b.seriesOrder || "";
            if (ao && bo) return ao.localeCompare(bo);
            if (ao) return -1;
            if (bo) return 1;
            return a.path.localeCompare(b.path);
        });
    }

    matchesFilter(item, filter, searchQuery) {
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
        if (filter === "warnings" && item.validation.status !== "warning") return false;
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            return item.title.toLowerCase().includes(q) || item.path.toLowerCase().includes(q) ||
                item.tags.some(t => t.toLowerCase().includes(q)) || item.era.toLowerCase().includes(q) ||
                item.figures.toLowerCase().includes(q) || item.seriesOrder.toLowerCase().includes(q);
        }
        return true;
    }
}

/* ═════════════════════════════════════════════════════════════════════════
   DASHBOARD VIEW — isHistory Edition
   ═════════════════════════════════════════════════════════════════════════ */

const VIEW_TYPE_DASHBOARD = "ishistory-dashboard";

class IsHistoryDashboardView extends obsidian.ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.currentFilter = "all";
        this.searchQuery = "";
        this._visibleLimit = plugin.settings.cardsPerPage || 40;
        this._cardElements = new Map();
        this._gridEl = null;
        this._statsEl = null;
        this._loadMoreEl = null;
        this._totalVisible = 0;
        this._destroyed = false;
        this._ready = false;
        this._pendingPaths = new Set();
        this._updateTimer = null;
    }

    getViewType() { return VIEW_TYPE_DASHBOARD; }
    getDisplayText() { return "isHistory CMS"; }
    getIcon() { return "book-open"; }

    async onOpen() {
        this._destroyed = false;

        this.registerEvent(this.app.metadataCache.on("changed", (file) => {
            if (!this.app.workspace.layoutReady) return;
            if (this._destroyed) return;
            if (!this.plugin.cache.isInCollection(file.path, this.plugin.settings)) return;
            this._queuePath(file.path);
        }));

        this.registerEvent(this.app.vault.on("create", (file) => {
            if (!this.app.workspace.layoutReady) return;
            if (this._destroyed) return;
            if (!this.plugin.cache.isInCollection(file.path, this.plugin.settings) || file.extension !== "md") return;
            setTimeout(() => { if (!this._destroyed) this._queuePath(file.path); }, 500);
        }));

        this.registerEvent(this.app.vault.on("delete", (file) => {
            if (!this.app.workspace.layoutReady) return;
            if (this._destroyed) return;
            if (!this.plugin.cache.isInCollection(file.path, this.plugin.settings)) return;
            this.plugin.cache.removeFile(file.path);
            this._queuePath(file.path);
        }));

        this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
            if (!this.app.workspace.layoutReady) return;
            if (this._destroyed) return;
            if (this.plugin.cache.isInCollection(oldPath, this.plugin.settings)) {
                this.plugin.cache.removeFile(oldPath);
                this._queuePath(oldPath);
            }
            if (this.plugin.cache.isInCollection(file.path, this.plugin.settings) && file.extension === "md") {
                setTimeout(() => { if (!this._destroyed) this._queuePath(file.path); }, 500);
            }
        }));

        if (this.app.workspace.layoutReady) {
            this._doInitialScan();
        } else {
            const ref = this.app.workspace.on("layout-ready", () => {
                this.app.workspace.offref(ref);
                this._doInitialScan();
            });
            this.registerEvent(ref);
            this._showLoading();
        }
    }

    _showLoading() {
        try {
            const c = this._getContainer(); if (!c) return;
            c.empty(); c.addClass("ishistory-dashboard");
            c.createEl("div", { cls: "cms-loading-state" }).innerHTML =
                '<div class="cms-empty-title">Loading isHistory CMS...</div>';
        } catch (e) { /* ignore */ }
    }

    _doInitialScan() {
        if (this._destroyed) return;
        try { this.plugin.cache.scanAll(this.app, this.plugin.settings); } catch (e) { console.error(e); }
        this.renderDashboard();
        this._ready = true;
    }

    _queuePath(path) { this._pendingPaths.add(path); this._scheduleUpdate(); }
    _scheduleUpdate() {
        if (!this._ready) return;
        if (this._updateTimer) clearTimeout(this._updateTimer);
        this._updateTimer = setTimeout(() => this._processPending(), 500);
    }
    _processPending() {
        if (this._destroyed || this._pendingPaths.size === 0) return;
        const paths = new Set(this._pendingPaths); this._pendingPaths.clear();
        for (const path of paths) {
            try {
                const item = this.plugin.cache.items.get(path);
                if (item) {
                    const file = this.app.vault.getAbstractFileByPath(path);
                    if (file && file.extension === "md") this.plugin.cache.updateFile(file, this.app, this.plugin.settings);
                }
            } catch (e) { console.error(e); }
        }
        if (!this._destroyed && this._ready) { try { this.renderDashboard(); } catch (e) { console.error(e); } }
    }

    _getContainer() { try { return this.containerEl.children[1] || this.containerEl.createDiv(); } catch (e) { return null; } }

    renderDashboard() {
        const container = this._getContainer(); if (!container) return;
        container.empty(); container.addClass("ishistory-dashboard");
        this._cardElements.clear();

        try {
            const cache = this.plugin.cache;

            // ─── Header ───
            const header = container.createEl("div", { cls: "cms-dash-header" });
            header.createEl("h2", { text: "isHistory", cls: "cms-dash-title" });
            header.createEl("p", { text: "Content management for the AI history archive", cls: "cms-dash-subtitle" });

            // ─── Stats ───
            this._statsEl = container.createEl("div", { cls: "cms-stats-row" });
            this._renderStats();

            // ─── Toolbar ───
            const toolbar = container.createEl("div", { cls: "cms-toolbar" });

            const searchWrap = toolbar.createEl("div", { cls: "cms-search-wrap" });
            const searchInput = searchWrap.createEl("input", { type: "text", placeholder: "Search posts, figures, tags...", cls: "cms-search-input", value: this.searchQuery });
            searchInput.addEventListener("input", () => { this.searchQuery = searchInput.value; this.applyFilters(); });

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
                const btn = filterGroup.createEl("button", { text: f.label, cls: `cms-filter-btn ${this.currentFilter === f.key ? "cms-filter-btn-active" : ""}` });
                btn.addEventListener("click", () => {
                    this.currentFilter = f.key;
                    filterGroup.querySelectorAll(".cms-filter-btn").forEach(b => b.removeClass("cms-filter-btn-active"));
                    btn.addClass("cms-filter-btn-active");
                    this.applyFilters();
                });
            }

            const actionsGroup = toolbar.createEl("div", { cls: "cms-actions-group" });
            actionsGroup.createEl("button", { text: "+ New Post", cls: "cms-btn cms-btn-primary" })
                .addEventListener("click", () => this._newPost());
            actionsGroup.createEl("button", { text: "Refresh", cls: "cms-btn cms-btn-secondary" })
                .addEventListener("click", () => { try { this.plugin.cache.scanAll(this.app, this.plugin.settings); this.renderDashboard(); } catch (e) { console.error(e); } });

            // ─── Grid ───
            this._gridEl = container.createEl("div", { cls: "cms-content-grid" });
            const items = cache.getSortedItems();
            if (items.length === 0) {
                this._gridEl.createEl("div", { cls: "cms-empty-state" }).innerHTML =
                    '<div class="cms-empty-title">No content found</div><div class="cms-empty-desc">Check your content paths in Settings.</div>';
            } else {
                for (const item of items) this._createCardElement(item);
            }

            // ─── Load More ───
            this._loadMoreEl = container.createEl("div", { cls: "cms-load-more-wrap" });
            this._loadMoreEl.createEl("button", { text: "Load More", cls: "cms-btn cms-btn-secondary cms-btn-full" })
                .addEventListener("click", () => { this._visibleLimit += this.plugin.settings.cardsPerPage || 40; this.applyFilters(); });

            this.applyFilters();
            this._renderMetaSection(container);

        } catch (e) {
            console.error("isHistory Dashboard render error:", e);
            try { container.empty(); const err = container.createEl("div", { cls: "cms-error-display" }); err.createEl("h3", { text: "Error" }); err.createEl("p", { text: e.message }); } catch (e2) {}
        }
    }

    _renderStats() {
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

    _createCardElement(item) {
        if (!this._gridEl) return null;
        try {
            const trackInfo = item.track ? TRACKS[item.track] : null;
            const card = this._gridEl.createEl("div", {
                cls: `cms-card cms-card-${item.validation.status} cms-card-${item.collection}${item.track ? " cms-card-track-" + item.track : ""}`,
                attr: { "data-path": item.path, "data-collection": item.collection, "data-track": item.track || "", "data-validation": item.validation.status, "data-draft": String(item.draft), "data-status": item.status },
            });

            // Header
            const cardHeader = card.createEl("div", { cls: "cms-card-header" });
            const titleArea = cardHeader.createEl("div", { cls: "cms-card-title-area" });
            if (item.seriesOrder) {
                titleArea.createEl("span", { text: item.seriesOrder, cls: `cms-card-code cms-card-code-${item.track || "X"}` });
            }
            titleArea.createEl("span", { text: item.title, cls: "cms-card-title" });

            // Badges
            const badgeArea = cardHeader.createEl("div", { cls: "cms-card-badges" });
            if (item.track && TRACKS[item.track]) {
                badgeArea.createEl("span", { text: `${TRACKS[item.track].emoji} ${TRACKS[item.track].name}`, cls: "cms-badge cms-badge-track" });
            }
            badgeArea.createEl("span", { text: item.validation.label, cls: `cms-badge cms-badge-${item.validation.status === "ready" ? "success" : item.validation.status === "error" ? "error" : "warning"}` });

            // Body
            const cardBody = card.createEl("div", { cls: "cms-card-body" });

            // Description (truncated)
            if (item.description) {
                cardBody.createEl("div", { text: item.description.length > 120 ? item.description.substring(0, 120) + "..." : item.description, cls: "cms-card-desc" });
            }

            const metaRow = cardBody.createEl("div", { cls: "cms-card-meta" });
            if (item.era) metaRow.createEl("span", { text: item.era, cls: "cms-meta-item cms-meta-era" });
            if (item.date) metaRow.createEl("span", { text: item.date, cls: "cms-meta-item" });
            if (item.status) metaRow.createEl("span", { text: item.status, cls: `cms-meta-item cms-status-${item.status}` });
            if (item.draft) metaRow.createEl("span", { text: "DRAFT", cls: "cms-meta-item cms-draft-yes" });
            if (item.part) metaRow.createEl("span", { text: item.part, cls: "cms-meta-item" });

            // Figures
            if (item.figures) {
                const figRow = cardBody.createEl("div", { cls: "cms-card-figures" });
                figRow.createEl("span", { text: "Figures: ", cls: "cms-figures-label" });
                figRow.createEl("span", { text: item.figures.length > 60 ? item.figures.substring(0, 60) + "..." : item.figures, cls: "cms-figures-value" });
            }

            // Tags
            if (item.tags.length > 0) {
                const tagRow = cardBody.createEl("div", { cls: "cms-card-tags" });
                for (const tag of item.tags.slice(0, 4)) tagRow.createEl("span", { text: tag, cls: "cms-card-tag" });
                if (item.tags.length > 4) tagRow.createEl("span", { text: `+${item.tags.length - 4}`, cls: "cms-card-tag cms-card-tag-more" });
            }

            // Validation errors
            if (item.validation.errors.length > 0) {
                const errorList = cardBody.createEl("div", { cls: "cms-card-errors" });
                for (const err of item.validation.errors.slice(0, 3)) {
                    errorList.createEl("div", { text: `${err.field}: ${err.message}`, cls: `cms-card-error cms-card-error-${err.severity}` });
                }
                if (item.validation.errors.length > 3) errorList.createEl("div", { text: `+${item.validation.errors.length - 3} more`, cls: "cms-card-error-more" });
            }

            // Actions
            const cardActions = card.createEl("div", { cls: "cms-card-actions" });
            cardActions.createEl("button", { text: "Open", cls: "cms-btn cms-btn-sm" })
                .addEventListener("click", () => { if (item.file) this.app.workspace.getLeaf(false).openFile(item.file); });
            cardActions.createEl("button", { text: "Validate", cls: "cms-btn cms-btn-sm cms-btn-secondary" })
                .addEventListener("click", () => {
                    try {
                        const r = IsHistoryValidator.validateFile(item.file, this.app, this.plugin.settings);
                        new obsidian.Notice(r.errors.length === 0 ? `${item.seriesOrder || item.name}: All fields valid!` : `${item.seriesOrder || item.name}: ${r.errors.filter(e => e.severity === "error").length} error(s), ${r.errors.filter(e => e.severity === "warning").length} warning(s)`);
                    } catch (e) { new obsidian.Notice(`Validation failed: ${e.message}`); }
                });
            if (item.draft) {
                cardActions.createEl("button", { text: "Publish", cls: "cms-btn cms-btn-sm cms-btn-primary" })
                    .addEventListener("click", () => this._publishPost(item.file));
            }

            this._cardElements.set(item.path, card);
            return card;
        } catch (e) { console.error(e); return null; }
    }

    async _publishPost(file) {
        if (!file) return;
        try {
            await this.app.fileManager.processFrontMatter(file, (fm) => {
                fm.draft = false;
                fm.status = "published";
                fm.date = new Date().toISOString().split('T')[0];
            });
            new obsidian.Notice(`Published: ${file.basename}`);
        } catch (e) { new obsidian.Notice(`Publish failed: ${e.message}`); }
    }

    async _newPost() {
        try {
            // Ask for track
            const trackModal = new obsidian.Modal(this.app);
            trackModal.titleEl.setText("New Post — Select Track");
            const body = trackModal.contentEl.createEl("div", { cls: "cms-new-post-tracks" });

            for (const [code, info] of Object.entries(TRACKS)) {
                const btn = body.createEl("button", { text: `${info.emoji} ${info.name} (${code})`, cls: "cms-btn cms-btn-track-btn" });
                btn.addEventListener("click", async () => {
                    trackModal.close();
                    const count = this.plugin.cache.getSortedItems("archive").filter(i => i.track === code).length + 1;
                    const seriesOrder = `${code}${count}`;
                    const slug = `${seriesOrder}-untitled-post`;
                    const path = `${this.plugin.settings.archivePath}/${slug}.md`;

                    const content = `---\ntitle: "Untitled ${info.name} Post"\ndate: ${new Date().toISOString().split('T')[0]}\ndescription: ""\ndraft: true\ntags: []\nimage: "/images/${seriesOrder.toLowerCase()}-hero.jpg"\nseries: "minds-and-machines"\nseriesOrder: "${seriesOrder}"\ntrack: "${code}"\nstatus: "planned"\npart: ""\nfigures: ""\nconnects: ""\nera: ""\naliases: ["${seriesOrder}"]\n---\n\nStart writing here...\n`;

                    try {
                        await this.app.vault.create(path, content);
                        const file = this.app.vault.getAbstractFileByPath(path);
                        if (file) this.app.workspace.getLeaf(false).openFile(file);
                        new obsidian.Notice(`Created ${seriesOrder} — fill in the frontmatter!`);
                    } catch (e) { new obsidian.Notice(`Failed to create: ${e.message}`); }
                });
            }
            trackModal.open();
        } catch (e) { console.error(e); }
    }

    applyFilters() {
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
                cardEl.style.display = (!matches || beyondPage) ? "none" : "";
            }
            this._totalVisible = visibleCount;
            if (this._loadMoreEl) {
                this._loadMoreEl.style.display = this._totalVisible > this._visibleLimit ? "" : "none";
                const btn = this._loadMoreEl.querySelector("button");
                if (btn) btn.textContent = `Load More (${Math.max(0, this._totalVisible - this._visibleLimit)} remaining)`;
            }
        } catch (e) { console.error(e); }
    }

    _renderMetaSection(container) {
        if (!container) return;
        try {
            const existing = container.querySelector(".cms-meta-section"); if (existing) existing.remove();
            const stats = this.plugin.cache.getStats();
            if (stats.uniqueTags.length === 0 && stats.allEras.length === 0) return;
            const items = this.plugin.cache.getSortedItems();
            const section = container.createEl("div", { cls: "cms-meta-section" });

            if (stats.allEras.length > 0) {
                const block = section.createEl("div", { cls: "cms-meta-block" });
                block.createEl("h4", { text: `Eras (${stats.allEras.length})`, cls: "cms-meta-heading" });
                const list = block.createEl("div", { cls: "cms-tag-list" });
                for (const era of stats.allEras.sort()) {
                    list.createEl("span", { text: `${era} (${items.filter(i => i.era === era).length})`, cls: "cms-tag-chip cms-era-chip" });
                }
            }
            if (stats.uniqueTags.length > 0) {
                const block = section.createEl("div", { cls: "cms-meta-block" });
                block.createEl("h4", { text: `Tags (${stats.uniqueTags.length})`, cls: "cms-meta-heading" });
                const list = block.createEl("div", { cls: "cms-tag-list" });
                for (const tag of stats.uniqueTags.sort().slice(0, 30)) {
                    list.createEl("span", { text: `${tag} (${items.filter(i => i.tags.includes(tag)).length})`, cls: "cms-tag-chip" });
                }
                if (stats.uniqueTags.length > 30) list.createEl("span", { text: `+${stats.uniqueTags.length - 30} more`, cls: "cms-tag-chip" });
            }
        } catch (e) { console.error(e); }
    }

    async onClose() {
        this._destroyed = true; this._ready = false;
        if (this._updateTimer) clearTimeout(this._updateTimer);
        this._cardElements.clear(); this._pendingPaths.clear();
    }
}

/* ═════════════════════════════════════════════════════════════════════════
   SIDEBAR VIEW — isHistory Quick Validate
   ═════════════════════════════════════════════════════════════════════════ */

const VIEW_TYPE_SIDEBAR = "ishistory-sidebar";

class IsHistorySidebarView extends obsidian.ItemView {
    constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this._updateTimer = null; this._destroyed = false; }

    getViewType() { return VIEW_TYPE_SIDEBAR; }
    getDisplayText() { return "isHistory Validate"; }
    getIcon() { return "checklist"; }

    async onOpen() {
        this._destroyed = false;
        this.registerEvent(this.app.workspace.on("active-file-change", () => { if (!this.app.workspace.layoutReady || this._destroyed) return; this._debounceUpdate(); }));
        this.registerEvent(this.app.metadataCache.on("changed", (file) => {
            if (!this.app.workspace.layoutReady || this._destroyed) return;
            const active = this.app.workspace.getActiveFile();
            if (active && file.path === active.path) this._debounceUpdate();
        }));
        if (this.app.workspace.layoutReady) this._debounceUpdate();
        else {
            const ref = this.app.workspace.on("layout-ready", () => { this.app.workspace.offref(ref); this._debounceUpdate(); });
            this.registerEvent(ref);
        }
    }

    _debounceUpdate() { if (this._destroyed) return; if (this._updateTimer) clearTimeout(this._updateTimer); this._updateTimer = setTimeout(() => this.updateUI(), 400); }

    updateUI() {
        if (this._destroyed) return;
        try {
            const container = this.containerEl.children[1]; if (!container) return;
            container.empty(); container.addClass("ishistory-sidebar");
            const activeFile = this.app.workspace.getActiveFile();
            const settings = this.plugin.settings;

            if (!activeFile || activeFile.extension !== "md" || !this.plugin.cache.isInCollection(activeFile.path, settings)) {
                container.createEl("div", { text: "Open a file in archive or vault to validate.", cls: "cms-sidebar-empty-state" });
                return;
            }

            const collection = activeFile.path.startsWith(settings.archivePath) ? "archive" : "vault";
            const cached = this.plugin.cache.items.get(activeFile.path);
            const result = cached ? cached.validation : IsHistoryValidator.validateFile(activeFile, this.app, settings);

            container.createEl("div", { text: "isHistory Validate", cls: "cms-sidebar-title" });

            const fileInfo = container.createEl("div", { cls: "cms-sidebar-file-info" });
            if (cached && cached.seriesOrder) fileInfo.createEl("span", { text: cached.seriesOrder, cls: `cms-card-code cms-card-code-${cached.track || "X"}` });
            fileInfo.createEl("span", { text: activeFile.path, cls: "cms-sidebar-file-title" });

            const badgeMap = { ready: { text: "Ready for Production", cls: "cms-badge-success" }, error: { text: "Schema Errors Found", cls: "cms-badge-error" }, warning: { text: "Warnings", cls: "cms-badge-warning" } };
            const badge = badgeMap[result.status] || badgeMap.error;
            container.createEl("div", { cls: "cms-status-wrapper" }).createEl("span", { text: badge.text, cls: `cms-badge ${badge.cls}` });

            container.createEl("hr");
            const list = container.createEl("div", { cls: "cms-diagnostics-list" });

            if (result.errors.length === 0) {
                list.createEl("div", { text: "All fields valid! Ready to push to production.", cls: "cms-success-text" });
            } else {
                for (const error of result.errors) {
                    const item = list.createEl("div", { cls: `cms-error-item severity-${error.severity}` });
                    item.createEl("div", { text: error.field, cls: "cms-error-field" });
                    item.createEl("p", { text: error.message, cls: "cms-error-message" });
                }
            }

            const actions = container.createEl("div", { cls: "cms-sidebar-actions" });
            if (collection === "archive" && cached && cached.draft) {
                actions.createEl("button", { text: "Publish This Post", cls: "cms-btn cms-btn-primary cms-btn-full" })
                    .addEventListener("click", async () => {
                        try {
                            await this.app.fileManager.processFrontMatter(activeFile, (fm) => { fm.draft = false; fm.status = "published"; fm.date = new Date().toISOString().split('T')[0]; });
                            new obsidian.Notice(`Published: ${activeFile.basename}`);
                            this._debounceUpdate();
                        } catch (e) { new obsidian.Notice(`Failed: ${e.message}`); }
                    });
            }
            actions.createEl("button", { text: "Open Dashboard", cls: "cms-btn cms-btn-secondary cms-btn-full" })
                .addEventListener("click", () => this.plugin.activateDashboard());
        } catch (e) { console.error(e); }
    }

    async onClose() { this._destroyed = true; if (this._updateTimer) clearTimeout(this._updateTimer); }
}

/* ═════════════════════════════════════════════════════════════════════════
   SETTINGS TAB — isHistory Edition
   ═════════════════════════════════════════════════════════════════════════ */

class IsHistorySettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

    display() {
        const { containerEl } = this; containerEl.empty();
        containerEl.createEl("h2", { text: "isHistory CMS Settings" });

        containerEl.createEl("h3", { text: "Content Paths" });
        new obsidian.Setting(containerEl).setName("Archive path").setDesc("Path to blog/archive content (default: src/content/blog)")
            .addText(text => text.setPlaceholder("src/content/blog").setValue(this.plugin.settings.archivePath)
                .onChange(async (v) => { this.plugin.settings.archivePath = v; await this.plugin.saveSettings(); }));
        new obsidian.Setting(containerEl).setName("Vault path").setDesc("Path to vault/research content (default: src/content/vault)")
            .addText(text => text.setPlaceholder("src/content/vault").setValue(this.plugin.settings.vaultPath)
                .onChange(async (v) => { this.plugin.settings.vaultPath = v; await this.plugin.saveSettings(); }));

        containerEl.createEl("h3", { text: "Performance" });
        new obsidian.Setting(containerEl).setName("Cards per page").setDesc("Number of cards before 'Load More'")
            .addSlider(slider => slider.setLimits(10, 100, 10).setValue(this.plugin.settings.cardsPerPage || 40).setDynamicTooltip()
                .onChange(async (v) => { this.plugin.settings.cardsPerPage = v; await this.plugin.saveSettings(); }));

        containerEl.createEl("h3", { text: "Appearance" });
        new obsidian.Setting(containerEl).setName("Show ribbon icon").setDesc("Show isHistory icon in the left ribbon")
            .addToggle(toggle => toggle.setValue(this.plugin.settings.showRibbonIcon).onChange(async (v) => { this.plugin.settings.showRibbonIcon = v; await this.plugin.saveSettings(); }));

        containerEl.createEl("div", { cls: "cms-settings-version" }).innerHTML =
            `isHistory CMS v${this.plugin.manifest.version} &middot; Schema v${this.plugin.settings._version}`;
    }
}

/* ═════════════════════════════════════════════════════════════════════════
   MAIN PLUGIN CLASS
   ═════════════════════════════════════════════════════════════════════════ */

module.exports = class IsHistoryPlugin extends obsidian.Plugin {
    async onload() {
        try {
            await this.loadSettings();
            this.cache = new ContentCache();

            this.registerView(VIEW_TYPE_DASHBOARD, (leaf) => new IsHistoryDashboardView(leaf, this));
            this.registerView(VIEW_TYPE_SIDEBAR, (leaf) => new IsHistorySidebarView(leaf, this));

            this.addRibbonIcon("book-open", "isHistory CMS", () => this.activateDashboard());

            this.addCommand({ id: "open-dashboard", name: "Open isHistory Dashboard", callback: () => this.activateDashboard() });
            this.addCommand({ id: "open-sidebar", name: "Open Quick Validate", callback: () => this.activateSidebar() });
            this.addCommand({ id: "validate-current", name: "Validate Current Post", callback: () => this.validateCurrent() });
            this.addCommand({ id: "publish-current", name: "Publish Current Draft", callback: () => this.publishCurrent() });
            this.addCommand({ id: "new-article", name: "New Article (A-track)", callback: () => this.newPost("A") });
            this.addCommand({ id: "new-profile", name: "New Profile (P-track)", callback: () => this.newPost("P") });
            this.addCommand({ id: "new-event", name: "New Event (E-track)", callback: () => this.newPost("E") });
            this.addCommand({ id: "bulk-validate", name: "Validate All Content", callback: () => this.bulkValidate() });

            this.addSettingTab(new IsHistorySettingTab(this.app, this));

            console.log("isHistory CMS v" + this.manifest.version + " loaded");
        } catch (e) {
            console.error("isHistory CMS: fatal onload error", e);
            new obsidian.Notice("isHistory CMS failed to load.");
        }
    }

    async onunload() {
        try {
            this.app.workspace.detachLeavesOfType(VIEW_TYPE_DASHBOARD);
            this.app.workspace.detachLeavesOfType(VIEW_TYPE_SIDEBAR);
        } catch (e) {}
    }

    async loadSettings() {
        try {
            const loaded = await this.loadData();
            const migrated = migrateSettings(loaded || {});
            this.settings = Object.assign({}, DEFAULT_SETTINGS, migrated);
            this.settings._version = SETTINGS_VERSION;
            await this.saveData(this.settings);
        } catch (e) { this.settings = Object.assign({}, DEFAULT_SETTINGS); }
    }

    async saveSettings() { try { await this.saveData(this.settings); } catch (e) {} }

    async activateDashboard() {
        try {
            const { workspace } = this.app;
            let leaf = workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)[0];
            if (!leaf) { leaf = workspace.getLeaf(false); await leaf.setViewState({ type: VIEW_TYPE_DASHBOARD, active: true }); }
            workspace.revealLeaf(leaf);
        } catch (e) { console.error(e); }
    }

    async activateSidebar() {
        try {
            const { workspace } = this.app;
            let leaf = workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR)[0];
            if (!leaf) { leaf = workspace.getRightLeaf(false); await leaf.setViewState({ type: VIEW_TYPE_SIDEBAR, active: true }); }
            workspace.revealLeaf(leaf);
        } catch (e) { console.error(e); }
    }

    validateCurrent() {
        try {
            const file = this.app.workspace.getActiveFile();
            if (!file || !this.cache.isInCollection(file.path, this.settings)) { new obsidian.Notice("Open an archive or vault file first."); return; }
            const result = IsHistoryValidator.validateFile(file, this.app, this.settings);
            if (result.errors.length === 0) new obsidian.Notice(`${file.basename}: All fields valid!`);
            else new obsidian.Notice(`${file.basename}: ${result.errors.filter(e => e.severity === "error").length} error(s), ${result.errors.filter(e => e.severity === "warning").length} warning(s)`);
        } catch (e) { new obsidian.Notice(`Validation failed: ${e.message}`); }
    }

    async publishCurrent() {
        try {
            const file = this.app.workspace.getActiveFile();
            if (!file || !file.path.startsWith(this.settings.archivePath)) { new obsidian.Notice("Open an archive file first."); return; }
            await this.app.fileManager.processFrontMatter(file, (fm) => { fm.draft = false; fm.status = "published"; fm.date = new Date().toISOString().split('T')[0]; });
            new obsidian.Notice(`Published: ${file.basename}`);
        } catch (e) { new obsidian.Notice(`Failed: ${e.message}`); }
    }

    async newPost(track) {
        try {
            const info = TRACKS[track];
            const count = this.cache.getSortedItems("archive").filter(i => i.track === track).length + 1;
            const seriesOrder = `${track}${count}`;
            const slug = `${seriesOrder}-untitled-post`;
            const path = `${this.settings.archivePath}/${slug}.md`;
            const content = `---\ntitle: "Untitled ${info.name} Post"\ndate: ${new Date().toISOString().split('T')[0]}\ndescription: ""\ndraft: true\ntags: []\nimage: "/images/${seriesOrder.toLowerCase()}-hero.jpg"\nseries: "minds-and-machines"\nseriesOrder: "${seriesOrder}"\ntrack: "${track}"\nstatus: "planned"\npart: ""\nfigures: ""\nconnects: ""\nera: ""\naliases: ["${seriesOrder}"]\n---\n\nStart writing here...\n`;
            await this.app.vault.create(path, content);
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file) this.app.workspace.getLeaf(false).openFile(file);
            new obsidian.Notice(`Created ${seriesOrder} — fill in the frontmatter!`);
        } catch (e) { new obsidian.Notice(`Failed to create: ${e.message}`); }
    }

    bulkValidate() {
        try {
            this.cache.scanAll(this.app, this.settings);
            const items = this.cache.getSortedItems();
            const errors = items.filter(i => i.validation.status === "error").length;
            const warnings = items.filter(i => i.validation.status === "warning").length;
            const ready = items.filter(i => i.validation.status === "ready").length;
            new obsidian.Notice(`${items.length} posts: ${ready} ready, ${errors} errors, ${warnings} warnings`);
        } catch (e) { new obsidian.Notice(`Bulk validate failed: ${e.message}`); }
    }
};
