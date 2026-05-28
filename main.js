const obsidian = require('obsidian');

class AstroCMSValidator {
    static validate(frontmatter) {
        const errors = [];
        if (!frontmatter) {
            errors.push({ field: "Frontmatter", message: "Metadata block is completely missing.", severity: "error" });
            return errors;
        }
        const requiredStrings = ["title", "description", "status", "era"];
        for (const field of requiredStrings) {
            if (!frontmatter[field] || typeof frontmatter[field] !== "string" || frontmatter[field].trim() === "") {
                errors.push({ field, message: `This field is missing or empty. Astro requires it to compile.`, severity: "error" });
            }
        }
        if (frontmatter["draft"] === undefined || typeof frontmatter["draft"] !== "boolean") {
            errors.push({ field: "draft", message: "Must be explicitly set to true or false (no quotes).", severity: "error" });
        }
        if (!frontmatter["date"]) {
            errors.push({ field: "date", message: "Publication date is missing.", severity: "error" });
        } else {
            const dateStr = String(frontmatter["date"]);
            if (isNaN(Date.parse(dateStr))) {
                errors.push({ field: "date", message: "Invalid date format. Use YYYY-MM-DD.", severity: "error" });
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
}

const VIEW_TYPE_ASTRO_CMS = "astro-cms-sidebar-view";

class AstroCMSView extends obsidian.ItemView {
    constructor(leaf) {
        super(leaf);
        this._updateTimer = null;
    }

    getViewType() { return VIEW_TYPE_ASTRO_CMS; }
    getDisplayText() { return "Astro CMS Diagnostics"; }
    getIcon() { return "layout-list"; }

    async onOpen() {
        this.registerEvent(this.app.workspace.on("active-file-change", () => this._debouncedUpdate()));
        this.registerEvent(this.app.metadataCache.on("changed", () => this._debouncedUpdate()));
        this.updateUI();
    }

    _debouncedUpdate() {
        if (this._updateTimer) clearTimeout(this._updateTimer);
        this._updateTimer = setTimeout(() => this.updateUI(), 300);
    }

    updateUI() {
        const container = this.containerEl.children[1];
        container.empty();
        const activeFile = this.app.workspace.getActiveFile();

        if (!activeFile || activeFile.extension !== "md" || !activeFile.path.startsWith("src/content")) {
            container.createEl("div", { text: "Select a post inside src/content to analyze.", cls: "cms-sidebar-empty-state" });
            return;
        }

        container.createEl("div", { text: "Astro CMS Monitor", cls: "cms-sidebar-title" });
        container.createEl("div", { text: activeFile.path, cls: "cms-sidebar-file-title" });

        const cache = this.app.metadataCache.getFileCache(activeFile);
        const errors = AstroCMSValidator.validate(cache?.frontmatter);
        const statusWrapper = container.createEl("div", { cls: "cms-status-wrapper" });

        if (errors.length === 0) {
            statusWrapper.createEl("span", { text: "✓ Ready for GitHub", cls: "cms-badge cms-badge-success" });
        } else if (errors.some(e => e.severity === "error")) {
            statusWrapper.createEl("span", { text: "✗ Structural Errors Found", cls: "cms-badge cms-badge-error" });
        } else {
            statusWrapper.createEl("span", { text: "⚠ Optimization Warnings", cls: "cms-badge cms-badge-warning" });
        }

        container.createEl("hr");
        const listContainer = container.createEl("div", { cls: "cms-diagnostics-list" });

        if (errors.length === 0) {
            listContainer.createEl("div", { text: "All fields look perfect! Ready to push cleanly to production.", cls: "cms-success-text" });
            return;
        }

        for (const error of errors) {
            const errorItem = listContainer.createEl("div", { cls: `cms-error-item severity-${error.severity}` });
            errorItem.createEl("div", { text: error.field, cls: "cms-error-field" });
            errorItem.createEl("p", { text: error.message, cls: "cms-error-message" });
        }
    }
}

module.exports = class AstroCMSPlugin extends obsidian.Plugin {
    async onload() {
        this.registerView(VIEW_TYPE_ASTRO_CMS, (leaf) => new AstroCMSView(leaf));
        this.addRibbonIcon("layout-list", "Astro CMS Panel", () => this.activateView());
        this.addCommand({
            id: "astro-cms-ready-for-production",
            name: "Prepare Post for Production (Pre-Flight)",
            callback: () => this.executePreflight()
        });

        // Graph link injection — debounced & guarded to prevent infinite loops
        this._linkInjectionQueue = new Map();
        this._linkInjectionTimer = null;

        this.registerEvent(
            this.app.metadataCache.on("changed", (file) => {
                if (!file.path.startsWith("src/content")) return;
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

                // Queue file for batch processing instead of mutating cache immediately
                this._linkInjectionQueue.set(file.path, { file, dynamicLinks });
                this._scheduleLinkInjection();
            })
        );
    }

    _scheduleLinkInjection() {
        if (this._linkInjectionTimer) clearTimeout(this._linkInjectionTimer);
        this._linkInjectionTimer = setTimeout(() => this._processLinkQueue(), 500);
    }

    _processLinkQueue() {
        if (this._linkInjectionQueue.size === 0) return;

        const processed = new Set();

        for (const [path, { file, dynamicLinks }] of this._linkInjectionQueue) {
            // Guard: only process each file once per cycle
            if (processed.has(path)) continue;
            processed.add(path);

            try {
                const cache = this.app.metadataCache.getFileCache(file);
                if (!cache) continue;

                if (!cache.links) cache.links = [];

                let added = false;
                for (const dest of dynamicLinks) {
                    if (dest && !cache.links.some(l => l.link === dest)) {
                        cache.links.push({
                            link: dest,
                            original: `[[${dest}]]`,
                            displayText: dest,
                            position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } }
                        });
                        added = true;
                    }
                }

                // If no new links were actually added, this file is stable — skip next cycle
                if (!added) {
                    this._linkInjectionQueue.delete(path);
                }
            } catch (e) {
                // Safely skip files that cause errors
                this._linkInjectionQueue.delete(path);
            }
        }

        this._linkInjectionQueue.clear();
    }

    async onunload() {
        if (this._linkInjectionTimer) clearTimeout(this._linkInjectionTimer);
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_ASTRO_CMS);
    }

    async activateView() {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_ASTRO_CMS)[0];
        if (!leaf) {
            leaf = workspace.getRightLeaf(false);
            await leaf.setViewState({ type: VIEW_TYPE_ASTRO_CMS, active: true });
        }
        workspace.revealLeaf(leaf);
    }

    async executePreflight() {
        const file = this.app.workspace.getActiveFile();
        if (!file || !file.path.startsWith("src/content")) return;
        try {
            await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
                frontmatter["draft"] = false;
                frontmatter["status"] = "published";
                frontmatter["date"] = new Date().toISOString().split('T')[0];
            });
        } catch (e) {}
    }
};
