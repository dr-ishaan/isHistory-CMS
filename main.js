const obsidian = require('obsidian');

/* ═══════════════════════════════════════════════════════════
   DEFAULT SETTINGS
   ═══════════════════════════════════════════════════════════ */

const DEFAULT_SETTINGS = {
    contentPath: "src/content",
    requiredFields: ["title", "description", "status", "era"],
    validateDraft: true,
    validateDate: true,
    autoSyncGraph: true,
    showRibbonIcon: true,
};

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
   CONTENT SCANNER — scans src/content for all posts
   ═══════════════════════════════════════════════════════════ */

class ContentScanner {
    static scanContent(app, settings) {
        const contentPath = settings.contentPath || DEFAULT_SETTINGS.contentPath;
        const files = app.vault.getMarkdownFiles();
        const contentFiles = files.filter(f => f.path.startsWith(contentPath));

        const results = [];
        for (const file of contentFiles) {
            try {
                const cache = app.metadataCache.getFileCache(file);
                const fm = cache?.frontmatter || {};
                const validation = AstroCMSValidator.getStatusForFile(file, app, settings);

                results.push({
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
                });
            } catch (e) {
                // Skip files that cause errors
            }
        }
        return results;
    }

    static getStats(contentItems) {
        const total = contentItems.length;
        const published = contentItems.filter(i => i.status === "published").length;
        const drafts = contentItems.filter(i => i.draft === true).length;
        const ready = contentItems.filter(i => i.validation.status === "ready").length;
        const errors = contentItems.filter(i => i.validation.status === "error").length;
        const warnings = contentItems.filter(i => i.validation.status === "warning").length;
        const allTags = contentItems.flatMap(i => i.tags);
        const uniqueTags = [...new Set(allTags)];
        const allEras = [...new Set(contentItems.map(i => i.era).filter(e => e && e !== "—"))];
        const allSeries = [...new Set(contentItems.map(i => i.series).filter(s => s && s !== ""))];

        return { total, published, drafts, ready, errors, warnings, uniqueTags, allEras, allSeries };
    }
}

/* ═══════════════════════════════════════════════════════════
   DASHBOARD VIEW — full-page content management dashboard
   ═══════════════════════════════════════════════════════════ */

const VIEW_TYPE_DASHBOARD = "astro-cms-dashboard";

class AstroCMSDashboardView extends obsidian.ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this._updateTimer = null;
        this.currentFilter = "all";
        this.searchQuery = "";
        this._cachedItems = [];
    }

    getViewType() { return VIEW_TYPE_DASHBOARD; }
    getDisplayText() { return "Astro CMS Dashboard"; }
    getIcon() { return "layout-dashboard"; }

    async onOpen() {
        this.registerEvent(this.app.workspace.on("active-file-change", () => this._debouncedUpdate()));
        this.registerEvent(this.app.metadataCache.on("changed", () => this._debouncedUpdate()));
        this.registerEvent(this.app.vault.on("modify", () => this._debouncedUpdate()));
        this.registerEvent(this.app.vault.on("delete", () => this._debouncedUpdate()));
        this.registerEvent(this.app.vault.on("create", () => this._debouncedUpdate()));
        // Small delay to ensure DOM container is fully ready
        setTimeout(() => this.renderDashboard(), 50);
    }

    _debouncedUpdate() {
        if (this._updateTimer) clearTimeout(this._updateTimer);
        this._updateTimer = setTimeout(() => this.renderDashboard(), 400);
    }

    _getContainer() {
        // Use the content container for ItemView
        return this.containerEl.children[1] || this.containerEl.createDiv();
    }

    renderDashboard() {
        let container;
        try {
            container = this._getContainer();
        } catch (e) {
            console.error("Astro CMS: container not ready", e);
            return;
        }

        container.empty();
        container.addClass("astro-cms-dashboard");

        try {
            this._cachedItems = ContentScanner.scanContent(this.app, this.plugin.settings);
            const items = this._cachedItems;
            const stats = ContentScanner.getStats(items);

            // ─── Header ───
            const header = container.createEl("div", { cls: "cms-dash-header" });
            header.createEl("h2", { text: "Astro Content Dashboard", cls: "cms-dash-title" });
            header.createEl("p", { text: "Manage and validate your Astro content folder", cls: "cms-dash-subtitle" });

            // ─── Stats Row ───
            const statsRow = container.createEl("div", { cls: "cms-stats-row" });
            this._renderStatCard(statsRow, "Total Posts", stats.total);
            this._renderStatCard(statsRow, "Published", stats.published, "cms-stat-success");
            this._renderStatCard(statsRow, "Drafts", stats.drafts, "cms-stat-warning");
            this._renderStatCard(statsRow, "Errors", stats.errors, "cms-stat-error");
            this._renderStatCard(statsRow, "Warnings", stats.warnings, "cms-stat-warn");
            this._renderStatCard(statsRow, "Ready", stats.ready, "cms-stat-success");

            // ─── Toolbar ───
            const toolbar = container.createEl("div", { cls: "cms-toolbar" });

            // Search
            const searchWrap = toolbar.createEl("div", { cls: "cms-search-wrap" });
            const searchInput = searchWrap.createEl("input", {
                type: "text",
                placeholder: "Search posts...",
                cls: "cms-search-input",
                value: this.searchQuery,
            });
            searchInput.addEventListener("input", () => {
                this.searchQuery = searchInput.value;
                this._renderContentGrid(container, items);
            });

            // Filter buttons
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
                    this._renderContentGrid(container, items);
                });
            }

            // Bulk action
            const actionsGroup = toolbar.createEl("div", { cls: "cms-actions-group" });
            const bulkPreflightBtn = actionsGroup.createEl("button", {
                text: "Bulk Pre-Flight",
                cls: "cms-btn cms-btn-primary",
            });
            bulkPreflightBtn.addEventListener("click", () => this._bulkPreflight(items));

            const refreshBtn = actionsGroup.createEl("button", {
                text: "Refresh",
                cls: "cms-btn cms-btn-secondary",
            });
            refreshBtn.addEventListener("click", () => this.renderDashboard());

            // ─── Content Grid ───
            this._renderContentGrid(container, items);

            // ─── Tags & Eras Section ───
            if (stats.uniqueTags.length > 0 || stats.allEras.length > 0 || stats.allSeries.length > 0) {
                const metaSection = container.createEl("div", { cls: "cms-meta-section" });

                if (stats.uniqueTags.length > 0) {
                    const tagSection = metaSection.createEl("div", { cls: "cms-meta-block" });
                    tagSection.createEl("h4", { text: `Tags (${stats.uniqueTags.length})`, cls: "cms-meta-heading" });
                    const tagList = tagSection.createEl("div", { cls: "cms-tag-list" });
                    for (const tag of stats.uniqueTags.sort()) {
                        const count = items.filter(i => i.tags.includes(tag)).length;
                        tagList.createEl("span", { text: `${tag} (${count})`, cls: "cms-tag-chip" });
                    }
                }

                if (stats.allEras.length > 0) {
                    const eraSection = metaSection.createEl("div", { cls: "cms-meta-block" });
                    eraSection.createEl("h4", { text: `Eras (${stats.allEras.length})`, cls: "cms-meta-heading" });
                    const eraList = eraSection.createEl("div", { cls: "cms-tag-list" });
                    for (const era of stats.allEras.sort()) {
                        const count = items.filter(i => i.era === era).length;
                        eraList.createEl("span", { text: `${era} (${count})`, cls: "cms-tag-chip cms-era-chip" });
                    }
                }

                if (stats.allSeries.length > 0) {
                    const seriesSection = metaSection.createEl("div", { cls: "cms-meta-block" });
                    seriesSection.createEl("h4", { text: `Series (${stats.allSeries.length})`, cls: "cms-meta-heading" });
                    const seriesList = seriesSection.createEl("div", { cls: "cms-tag-list" });
                    for (const s of stats.allSeries.sort()) {
                        const count = items.filter(i => i.series === s).length;
                        seriesList.createEl("span", { text: `${s} (${count})`, cls: "cms-tag-chip cms-series-chip" });
                    }
                }
            }

            // No content message
            if (items.length === 0) {
                const empty = container.createEl("div", { cls: "cms-empty-state" });
                empty.createEl("div", { text: "No posts found in " + this.plugin.settings.contentPath, cls: "cms-empty-title" });
                empty.createEl("div", { text: "Make sure your Astro content folder is inside your Obsidian vault.", cls: "cms-empty-desc" });
            }

        } catch (e) {
            console.error("Astro CMS Dashboard render error:", e);
            container.empty();
            const errorEl = container.createEl("div", { cls: "cms-error-display" });
            errorEl.createEl("h3", { text: "Dashboard Error" });
            errorEl.createEl("p", { text: e.message || "An unknown error occurred." });
            errorEl.createEl("pre", { text: e.stack || "" });
        }
    }

    _renderContentGrid(container, items) {
        let existing = container.querySelector(".cms-content-grid");
        if (existing) existing.remove();

        // Apply filters
        let filtered = items;
        if (this.currentFilter === "ready") filtered = items.filter(i => i.validation.status === "ready");
        else if (this.currentFilter === "error") filtered = items.filter(i => i.validation.status === "error");
        else if (this.currentFilter === "warning") filtered = items.filter(i => i.validation.status === "warning");
        else if (this.currentFilter === "draft") filtered = items.filter(i => i.draft === true);
        else if (this.currentFilter === "published") filtered = items.filter(i => i.status === "published");

        // Apply search
        if (this.searchQuery.trim()) {
            const q = this.searchQuery.toLowerCase();
            filtered = filtered.filter(i =>
                i.title.toLowerCase().includes(q) ||
                i.path.toLowerCase().includes(q) ||
                i.tags.some(t => t.toLowerCase().includes(q)) ||
                i.era.toLowerCase().includes(q)
            );
        }

        const grid = container.createEl("div", { cls: "cms-content-grid" });

        if (filtered.length === 0) {
            grid.createEl("div", { text: "No posts match your filter.", cls: "cms-empty-state" });
            return;
        }

        for (const item of filtered) {
            this._renderContentCard(grid, item);
        }
    }

    _renderContentCard(grid, item) {
        const card = grid.createEl("div", { cls: `cms-card cms-card-${item.validation.status}` });

        // Card header
        const cardHeader = card.createEl("div", { cls: "cms-card-header" });
        cardHeader.createEl("span", { text: item.title, cls: "cms-card-title" });
        this._renderStatusBadge(cardHeader, item.validation);

        // Card body
        const cardBody = card.createEl("div", { cls: "cms-card-body" });

        const metaRow = cardBody.createEl("div", { cls: "cms-card-meta" });
        metaRow.createEl("span", { text: `Status: ${item.status}`, cls: "cms-meta-item" });
        metaRow.createEl("span", { text: `Era: ${item.era}`, cls: "cms-meta-item" });
        metaRow.createEl("span", { text: `Date: ${item.date}`, cls: "cms-meta-item" });
        if (item.draft !== undefined) {
            metaRow.createEl("span", { text: item.draft ? "Draft" : "Published", cls: `cms-meta-item cms-draft-${item.draft ? "yes" : "no"}` });
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

        // Validation errors
        if (item.validation.errors.length > 0) {
            const errorList = cardBody.createEl("div", { cls: "cms-card-errors" });
            for (const err of item.validation.errors.slice(0, 3)) {
                errorList.createEl("div", {
                    text: `${err.field}: ${err.message}`,
                    cls: `cms-card-error cms-card-error-${err.severity}`,
                });
            }
            if (item.validation.errors.length > 3) {
                errorList.createEl("div", {
                    text: `+${item.validation.errors.length - 3} more issues`,
                    cls: "cms-card-error-more",
                });
            }
        }

        // Card actions
        const cardActions = card.createEl("div", { cls: "cms-card-actions" });
        const openBtn = cardActions.createEl("button", { text: "Open", cls: "cms-btn cms-btn-sm" });
        openBtn.addEventListener("click", () => this.app.workspace.getLeaf(false).openFile(item.file));

        if (item.draft === true) {
            const preflightBtn = cardActions.createEl("button", { text: "Pre-Flight", cls: "cms-btn cms-btn-sm cms-btn-primary" });
            preflightBtn.addEventListener("click", () => this._preflightSingle(item.file));
        }

        const validateBtn = cardActions.createEl("button", { text: "Validate", cls: "cms-btn cms-btn-sm cms-btn-secondary" });
        validateBtn.addEventListener("click", () => this._validateSingle(item.file));
    }

    _renderStatCard(row, label, value, colorClass) {
        const card = row.createEl("div", { cls: `cms-stat-card ${colorClass || ""}` });
        card.createEl("div", { text: String(value), cls: "cms-stat-value" });
        card.createEl("div", { text: label, cls: "cms-stat-label" });
    }

    _renderStatusBadge(container, validation) {
        const cls = {
            ready: "cms-badge-success",
            error: "cms-badge-error",
            warning: "cms-badge-warning",
        };
        container.createEl("span", { text: validation.label, cls: `cms-badge ${cls[validation.status] || ""}` });
    }

    async _preflightSingle(file) {
        try {
            await this.app.fileManager.processFrontMatter(file, (fm) => {
                fm["draft"] = false;
                fm["status"] = "published";
                fm["date"] = new Date().toISOString().split('T')[0];
            });
            new obsidian.Notice(`Pre-flight complete: ${file.basename}`);
            this.renderDashboard();
        } catch (e) {
            new obsidian.Notice(`Pre-flight failed: ${e.message}`);
        }
    }

    async _bulkPreflight(items) {
        const drafts = items.filter(i => i.draft === true);
        if (drafts.length === 0) {
            new obsidian.Notice("No drafts to pre-flight.");
            return;
        }

        const confirmed = await this._confirmAction(
            `Pre-flight ${drafts.length} draft(s)?`,
            `This will set draft=false, status="published", and today's date on all draft posts.`
        );
        if (!confirmed) return;

        let success = 0;
        for (const item of drafts) {
            try {
                await this.app.fileManager.processFrontMatter(item.file, (fm) => {
                    fm["draft"] = false;
                    fm["status"] = "published";
                    fm["date"] = new Date().toISOString().split('T')[0];
                });
                success++;
            } catch (e) { /* skip */ }
        }
        new obsidian.Notice(`Pre-flight complete: ${success}/${drafts.length} posts updated.`);
        this.renderDashboard();
    }

    _validateSingle(file) {
        const result = AstroCMSValidator.getStatusForFile(file, this.app, this.plugin.settings);
        if (result.errors.length === 0) {
            new obsidian.Notice(`${file.basename}: All fields valid!`);
        } else {
            const errorCount = result.errors.filter(e => e.severity === "error").length;
            const warnCount = result.errors.filter(e => e.severity === "warning").length;
            new obsidian.Notice(`${file.basename}: ${errorCount} error(s), ${warnCount} warning(s)`);
        }
    }

    async _confirmAction(title, message) {
        return new Promise((resolve) => {
            const modal = new obsidian.Modal(this.app);
            modal.titleEl.setText(title);
            modal.contentEl.createEl("p", { text: message });
            const btnRow = modal.contentEl.createEl("div", { cls: "cms-modal-btn-row" });
            btnRow.createEl("button", { text: "Cancel", cls: "cms-btn cms-btn-secondary" }).addEventListener("click", () => { modal.close(); resolve(false); });
            btnRow.createEl("button", { text: "Confirm", cls: "cms-btn cms-btn-primary" }).addEventListener("click", () => { modal.close(); resolve(true); });
            modal.open();
        });
    }

    async onClose() {
        if (this._updateTimer) clearTimeout(this._updateTimer);
    }
}

/* ═══════════════════════════════════════════════════════════
   QUICK VALIDATE SIDEBAR VIEW — lightweight per-file panel
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
        this.registerEvent(this.app.workspace.on("active-file-change", () => this._debouncedUpdate()));
        this.registerEvent(this.app.metadataCache.on("changed", () => this._debouncedUpdate()));
        setTimeout(() => this.updateUI(), 50);
    }

    _debouncedUpdate() {
        if (this._updateTimer) clearTimeout(this._updateTimer);
        this._updateTimer = setTimeout(() => this.updateUI(), 300);
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

        container.createEl("div", { text: "Quick Validate", cls: "cms-sidebar-title" });
        container.createEl("div", { text: activeFile.path, cls: "cms-sidebar-file-title" });

        const result = AstroCMSValidator.getStatusForFile(activeFile, this.app, this.plugin.settings);
        const statusWrapper = container.createEl("div", { cls: "cms-status-wrapper" });

        if (result.status === "ready") {
            statusWrapper.createEl("span", { text: "Ready for GitHub", cls: "cms-badge cms-badge-success" });
        } else if (result.status === "error") {
            statusWrapper.createEl("span", { text: "Structural Errors Found", cls: "cms-badge cms-badge-error" });
        } else {
            statusWrapper.createEl("span", { text: "Optimization Warnings", cls: "cms-badge cms-badge-warning" });
        }

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

        // Quick actions
        const actions = container.createEl("div", { cls: "cms-sidebar-actions" });
        const preflightBtn = actions.createEl("button", { text: "Pre-Flight This Post", cls: "cms-btn cms-btn-primary cms-btn-full" });
        preflightBtn.addEventListener("click", async () => {
            try {
                await this.app.fileManager.processFrontMatter(activeFile, (fm) => {
                    fm["draft"] = false;
                    fm["status"] = "published";
                    fm["date"] = new Date().toISOString().split('T')[0];
                });
                new obsidian.Notice(`Pre-flight complete: ${activeFile.basename}`);
                this.updateUI();
            } catch (e) {
                new obsidian.Notice(`Pre-flight failed: ${e.message}`);
            }
        });

        const dashBtn = actions.createEl("button", { text: "Open Dashboard", cls: "cms-btn cms-btn-secondary cms-btn-full" });
        dashBtn.addEventListener("click", () => this.plugin.activateDashboard());
    }

    async onClose() {
        if (this._updateTimer) clearTimeout(this._updateTimer);
    }
}

/* ═══════════════════════════════════════════════════════════
   SETTINGS TAB
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
    }
}

/* ═══════════════════════════════════════════════════════════
   MAIN PLUGIN CLASS
   ═══════════════════════════════════════════════════════════ */

module.exports = class AstroCMSPlugin extends obsidian.Plugin {
    async onload() {
        await this.loadSettings();

        // Register views
        this.registerView(VIEW_TYPE_DASHBOARD, (leaf) => new AstroCMSDashboardView(leaf, this));
        this.registerView(VIEW_TYPE_SIDEBAR, (leaf) => new AstroCMSSidebarView(leaf, this));

        // Ribbon icon
        this.addRibbonIcon("layout-dashboard", "Astro CMS Dashboard", () => this.activateDashboard());

        // Commands
        this.addCommand({
            id: "open-dashboard",
            name: "Open Dashboard",
            callback: () => this.activateDashboard(),
        });

        this.addCommand({
            id: "open-sidebar",
            name: "Open Quick Validate Sidebar",
            callback: () => this.activateSidebar(),
        });

        this.addCommand({
            id: "preflight-current",
            name: "Pre-Flight Current Post",
            callback: () => this.executePreflight(),
        });

        this.addCommand({
            id: "validate-current",
            name: "Validate Current Post",
            callback: () => this.validateCurrentFile(),
        });

        this.addCommand({
            id: "bulk-preflight",
            name: "Bulk Pre-Flight All Drafts",
            callback: () => this.bulkPreflight(),
        });

        // Settings tab
        this.addSettingTab(new AstroCMSSettingTab(this.app, this));

        // Graph link injection (debounced, guarded)
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

                if (Array.isArray(fm["connects"])) {
                    dynamicLinks.push(...fm["connects"]);
                } else if (typeof fm["connects"] === "string") {
                    dynamicLinks.push(...fm["connects"].split(",").map(s => s.trim()));
                }

                if (fm["series"]) dynamicLinks.push(String(fm["series"]));
                if (fm["era"]) dynamicLinks.push(String(fm["era"]));

                if (dynamicLinks.length === 0) return;

                this._linkQueue.set(file.path, { file, dynamicLinks });
                this._scheduleLinkInjection();
            })
        );

        console.log("Astro CMS Plugin loaded");
    }

    _scheduleLinkInjection() {
        if (this._linkTimer) clearTimeout(this._linkTimer);
        this._linkTimer = setTimeout(() => this._processLinkQueue(), 500);
    }

    _processLinkQueue() {
        if (this._linkQueue.size === 0) return;

        for (const [path, { file, dynamicLinks }] of this._linkQueue) {
            try {
                const cache = this.app.metadataCache.getFileCache(file);
                if (!cache) continue;

                if (!cache.links) cache.links = [];

                for (const dest of dynamicLinks) {
                    if (dest && !cache.links.some(l => l.link === dest)) {
                        cache.links.push({
                            link: dest,
                            original: `[[${dest}]]`,
                            displayText: dest,
                            position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } },
                        });
                    }
                }
            } catch (e) {
                // Skip problematic files
            }
        }
        this._linkQueue.clear();
    }

    async onunload() {
        if (this._linkTimer) clearTimeout(this._linkTimer);
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_DASHBOARD);
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_SIDEBAR);
        console.log("Astro CMS Plugin unloaded");
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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
            const errorCount = result.errors.filter(e => e.severity === "error").length;
            const warnCount = result.errors.filter(e => e.severity === "warning").length;
            new obsidian.Notice(`${file.basename}: ${errorCount} error(s), ${warnCount} warning(s)`);
        }
    }

    async bulkPreflight() {
        const items = ContentScanner.scanContent(this.app, this.settings);
        const drafts = items.filter(i => i.draft === true);
        if (drafts.length === 0) {
            new obsidian.Notice("No drafts to pre-flight.");
            return;
        }

        let success = 0;
        for (const item of drafts) {
            try {
                await this.app.fileManager.processFrontMatter(item.file, (fm) => {
                    fm["draft"] = false;
                    fm["status"] = "published";
                    fm["date"] = new Date().toISOString().split('T')[0];
                });
                success++;
            } catch (e) { /* skip */ }
        }
        new obsidian.Notice(`Pre-flight complete: ${success}/${drafts.length} posts updated.`);
    }
};
