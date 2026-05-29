/**
 * isHistory CMS Plugin — Settings Tab
 *
 * Configuration UI for all plugin settings.
 * v1.5.0: Full settings UI with track editor, status editor,
 * validation thresholds, display limits, template editor,
 * and pre-flight behavior controls.
 * Designed for non-technical users with plain-English labels.
 */

import { PluginSettingTab, type App, Setting, Modal } from "obsidian";
import {
  type TrackInfo,
  SETTINGS_VERSION,
  DEFAULT_SETTINGS,
  DEFAULT_TRACKS,
  DEFAULT_STATUSES,
  normalizePathSetting,
  TEMPLATE_VARIABLES,
} from "./types";
import IsHistoryPlugin from "./main";

export class IsHistorySettingTab extends PluginSettingTab {
  plugin: IsHistoryPlugin;
  private _rescanTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(app: App, plugin: IsHistoryPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  private _debouncedRescan(delay = 600): void {
    if (this._rescanTimer) clearTimeout(this._rescanTimer);
    this._rescanTimer = setTimeout(() => {
      this.plugin.rescanCache();
    }, delay);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ─── Content Paths ───
    containerEl.createEl("h2", { text: "Content Paths" });
    new Setting(containerEl)
      .setName("Archive path")
      .setDesc("Folder with your blog posts (default: src/content/blog)")
      .addText((text) =>
        text
          .setPlaceholder("src/content/blog")
          .setValue(this.plugin.settings.archivePath)
          .onChange(async (v) => {
            this.plugin.settings.archivePath = normalizePathSetting(v);
            await this.plugin.saveSettings();
            this._debouncedRescan();
          })
      );
    new Setting(containerEl)
      .setName("Vault path")
      .setDesc("Folder with your research notes (default: src/content/vault)")
      .addText((text) =>
        text
          .setPlaceholder("src/content/vault")
          .setValue(this.plugin.settings.vaultPath)
          .onChange(async (v) => {
            this.plugin.settings.vaultPath = normalizePathSetting(v);
            await this.plugin.saveSettings();
            this._debouncedRescan();
          })
      );

    // ─── Tracks ───
    containerEl.createEl("h2", { text: "Tracks" });
    containerEl.createEl("p", {
      text: "Tracks organize your content by type. Each track has a code (used in seriesOrder like A1, P3), a name, an emoji, and a color.",
      cls: "cms-settings-hint",
    });

    for (const [code, info] of Object.entries(this.plugin.settings.tracks)) {
      new Setting(containerEl)
        .setName(`${info.emoji} ${info.name} (${code})`)
        .setDesc(`Color: ${info.color}`)
        .addButton((btn) =>
          btn.setButtonText("Edit").onClick(() => {
            new TrackEditorModal(this.app, this.plugin, code, info, () => this.display()).open();
          })
        )
        .addButton((btn) =>
          btn.setButtonText("Remove").setWarning().onClick(async () => {
            delete this.plugin.settings.tracks[code];
            await this.plugin.saveSettings();
            this.plugin._updateDynamicStyles();
            this._debouncedRescan();
            this.display();
          })
        );
    }

    new Setting(containerEl)
      .setName("Add a new track")
      .setDesc("Create a new content track with its own code, name, emoji, and color")
      .addButton((btn) =>
        btn.setButtonText("+ Add Track").setCta().onClick(() => {
          new TrackEditorModal(this.app, this.plugin, null, null, () => this.display()).open();
        })
      );

    // ─── Statuses ───
    containerEl.createEl("h2", { text: "Statuses" });
    containerEl.createEl("p", {
      text: "Statuses describe the publication stage of a post. Add or remove statuses to match your workflow.",
      cls: "cms-settings-hint",
    });

    for (const status of this.plugin.settings.statuses) {
      new Setting(containerEl)
        .setName(status)
        .addButton((btn) =>
          btn.setButtonText("Remove").setWarning().onClick(async () => {
            this.plugin.settings.statuses = this.plugin.settings.statuses.filter((s) => s !== status);
            await this.plugin.saveSettings();
            this._debouncedRescan();
            this.display();
          })
        );
    }

    new Setting(containerEl)
      .setName("Add a new status")
      .addText((text) => {
        text.setPlaceholder("e.g. archived, featured");
        text.onChange(() => { /* track input */ });
        const input = text.inputEl;
        const addBtn = input.parentElement?.querySelector(".cms-add-status-btn") as HTMLElement;
        if (addBtn) {
          // Wire button after it's created
        }
      })
      .addButton((btn) => {
        btn.setButtonText("Add").setCta();
        btn.buttonEl.classList.add("cms-add-status-btn");
        btn.onClick(async () => {
          const input = containerEl.querySelector(".cms-add-status-btn")?.parentElement?.querySelector("input") as HTMLInputElement;
          const value = input?.value?.trim();
          if (value && !this.plugin.settings.statuses.includes(value)) {
            this.plugin.settings.statuses.push(value);
            await this.plugin.saveSettings();
            this._debouncedRescan();
            this.display();
          }
        });
      });

    // ─── Validation Rules ───
    containerEl.createEl("h2", { text: "Validation Rules" });
    containerEl.createEl("p", {
      text: "These rules check your frontmatter for common mistakes. Adjust the thresholds to match your SEO requirements.",
      cls: "cms-settings-hint",
    });

    new Setting(containerEl)
      .setName("Minimum title length")
      .setDesc("Titles shorter than this will be flagged as errors")
      .addSlider((slider) =>
        slider.setLimits(1, 20, 1).setValue(this.plugin.settings.minTitleLength)
          .setDynamicTooltip().onChange(async (v) => {
            this.plugin.settings.minTitleLength = v;
            await this.plugin.saveSettings();
            this._debouncedRescan();
          })
      );

    new Setting(containerEl)
      .setName("Maximum title length")
      .setDesc("Titles longer than this will be flagged as warnings")
      .addSlider((slider) =>
        slider.setLimits(50, 200, 5).setValue(this.plugin.settings.maxTitleLength)
          .setDynamicTooltip().onChange(async (v) => {
            this.plugin.settings.maxTitleLength = v;
            await this.plugin.saveSettings();
            this._debouncedRescan();
          })
      );

    new Setting(containerEl)
      .setName("Minimum description length")
      .setDesc("Descriptions shorter than this will be flagged as errors")
      .addSlider((slider) =>
        slider.setLimits(5, 50, 1).setValue(this.plugin.settings.minDescriptionLength)
          .setDynamicTooltip().onChange(async (v) => {
            this.plugin.settings.minDescriptionLength = v;
            await this.plugin.saveSettings();
            this._debouncedRescan();
          })
      );

    new Setting(containerEl)
      .setName("Maximum description length")
      .setDesc("Descriptions longer than this will be flagged as warnings")
      .addSlider((slider) =>
        slider.setLimits(80, 300, 5).setValue(this.plugin.settings.maxDescriptionLength)
          .setDynamicTooltip().onChange(async (v) => {
            this.plugin.settings.maxDescriptionLength = v;
            await this.plugin.saveSettings();
            this._debouncedRescan();
          })
      );

    new Setting(containerEl)
      .setName("Image path must start with")
      .setDesc("Hero image paths should begin with this prefix (e.g. / or ./)")
      .addText((text) =>
        text.setValue(this.plugin.settings.imagePrefix).onChange(async (v) => {
          this.plugin.settings.imagePrefix = v;
          await this.plugin.saveSettings();
          this._debouncedRescan();
        })
      );

    new Setting(containerEl)
      .setName("Required archive fields")
      .setDesc("Comma-separated list of frontmatter fields that must be present (e.g. title, date, description)")
      .addText((text) =>
        text.setValue(this.plugin.settings.requiredArchiveFields.join(", ")).onChange(async (v) => {
          this.plugin.settings.requiredArchiveFields = v.split(",").map((s) => s.trim()).filter((s) => s);
          await this.plugin.saveSettings();
          this._debouncedRescan();
        })
      );

    // ─── Card Display ───
    containerEl.createEl("h2", { text: "Card Display" });
    containerEl.createEl("p", {
      text: "Control how much information is shown on each card in the dashboard.",
      cls: "cms-settings-hint",
    });

    new Setting(containerEl)
      .setName("Cards per page")
      .setDesc("How many cards to show before the 'Load More' button")
      .addSlider((slider) =>
        slider.setLimits(10, 200, 10).setValue(this.plugin.settings.cardsPerPage)
          .setDynamicTooltip().onChange(async (v) => {
            this.plugin.settings.cardsPerPage = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Description preview length")
      .setDesc("How many characters of the description to show on each card")
      .addSlider((slider) =>
        slider.setLimits(50, 300, 10).setValue(this.plugin.settings.descriptionTruncation)
          .setDynamicTooltip().onChange(async (v) => {
            this.plugin.settings.descriptionTruncation = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Figures preview length")
      .setDesc("How many characters of the figures field to show on each card")
      .addSlider((slider) =>
        slider.setLimits(20, 150, 5).setValue(this.plugin.settings.figuresTruncation)
          .setDynamicTooltip().onChange(async (v) => {
            this.plugin.settings.figuresTruncation = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Tags shown per card")
      .setDesc("Maximum number of tags displayed on each card")
      .addSlider((slider) =>
        slider.setLimits(1, 10, 1).setValue(this.plugin.settings.maxTagsPerCard)
          .setDynamicTooltip().onChange(async (v) => {
            this.plugin.settings.maxTagsPerCard = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Errors shown per card")
      .setDesc("Maximum number of validation errors displayed on each card")
      .addSlider((slider) =>
        slider.setLimits(1, 10, 1).setValue(this.plugin.settings.maxErrorsPerCard)
          .setDynamicTooltip().onChange(async (v) => {
            this.plugin.settings.maxErrorsPerCard = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Tags in meta section")
      .setDesc("Maximum number of unique tags shown in the Tags section at the bottom")
      .addSlider((slider) =>
        slider.setLimits(10, 100, 5).setValue(this.plugin.settings.maxMetaTags)
          .setDynamicTooltip().onChange(async (v) => {
            this.plugin.settings.maxMetaTags = v;
            await this.plugin.saveSettings();
          })
      );

    // ─── New Post Template ───
    containerEl.createEl("h2", { text: "New Post Template" });
    containerEl.createEl("p", {
      text: "Customize how new posts are created. Use variables like {{seriesOrder}}, {{date}}, etc. in the format fields.",
      cls: "cms-settings-hint",
    });

    // Variable reference
    const varList = containerEl.createEl("div", { cls: "cms-template-vars" });
    varList.createEl("strong", { text: "Available variables:" });
    const varUl = varList.createEl("ul");
    for (const v of TEMPLATE_VARIABLES) {
      varUl.createEl("li", { text: `{{${v.name}}} — ${v.description}` });
    }

    new Setting(containerEl)
      .setName("Default series")
      .setDesc("Series name applied to new posts (e.g. minds-and-machines)")
      .addText((text) =>
        text.setPlaceholder("minds-and-machines")
          .setValue(this.plugin.settings.defaultSeries || "")
          .onChange(async (v) => {
            this.plugin.settings.defaultSeries = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Slug format")
      .setDesc("File name pattern for new posts (e.g. {{seriesOrder}}-untitled-post)")
      .addText((text) =>
        text.setPlaceholder("{{seriesOrder}}-untitled-post")
          .setValue(this.plugin.settings.newPostSlug)
          .onChange(async (v) => {
            this.plugin.settings.newPostSlug = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Title format")
      .setDesc("Default title for new posts (e.g. Untitled {{trackName}} Post)")
      .addText((text) =>
        text.setPlaceholder("Untitled {{trackName}} Post")
          .setValue(this.plugin.settings.newPostTitle)
          .onChange(async (v) => {
            this.plugin.settings.newPostTitle = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Image path format")
      .setDesc("Hero image path pattern (e.g. /images/{{seriesOrderLower}}-hero.jpg)")
      .addText((text) =>
        text.setPlaceholder("/images/{{seriesOrderLower}}-hero.jpg")
          .setValue(this.plugin.settings.newPostImage)
          .onChange(async (v) => {
            this.plugin.settings.newPostImage = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default status for new posts")
      .setDesc("What status to set on newly created posts")
      .addDropdown((dd) => {
        for (const s of this.plugin.settings.statuses) {
          dd.addOption(s, s);
        }
        dd.setValue(this.plugin.settings.newPostStatus || this.plugin.settings.statuses[0] || "planned");
        dd.onChange(async (v) => {
          this.plugin.settings.newPostStatus = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Body template")
      .setDesc("Default content for the body of new posts")
      .addTextArea((text) =>
        text.setPlaceholder("Start writing here...")
          .setValue(this.plugin.settings.newPostBody)
          .onChange(async (v) => {
            this.plugin.settings.newPostBody = v;
            await this.plugin.saveSettings();
          })
      );

    // ─── Pre-flight Settings ───
    containerEl.createEl("h2", { text: "Pre-flight Settings" });
    containerEl.createEl("p", {
      text: "Pre-flight prepares a draft for publishing. Configure what happens when you pre-flight a post.",
      cls: "cms-settings-hint",
    });

    new Setting(containerEl)
      .setName("Set draft to")
      .setDesc("What the draft field should be set to when pre-flighting")
      .addDropdown((dd) => {
        dd.addOption("false", "false (published)");
        dd.addOption("true", "true (still draft)");
        dd.setValue(String(this.plugin.settings.preflightDraft));
        dd.onChange(async (v) => {
          this.plugin.settings.preflightDraft = v === "true";
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Set status to")
      .setDesc("What the status field should be set to when pre-flighting")
      .addDropdown((dd) => {
        for (const s of this.plugin.settings.statuses) {
          dd.addOption(s, s);
        }
        dd.setValue(this.plugin.settings.preflightStatus || "published");
        dd.onChange(async (v) => {
          this.plugin.settings.preflightStatus = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Auto-fill today's date")
      .setDesc("If the post has no date, fill it with today's date when pre-flighting")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.preflightAutoDate).onChange(async (v) => {
          this.plugin.settings.preflightAutoDate = v;
          await this.plugin.saveSettings();
        })
      );

    // ─── Appearance ───
    containerEl.createEl("h2", { text: "Appearance" });

    new Setting(containerEl)
      .setName("Show ribbon icon")
      .setDesc("Show the isHistory icon in the left sidebar ribbon")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showRibbonIcon).onChange(async (v) => {
          this.plugin.settings.showRibbonIcon = v;
          await this.plugin.saveSettings();
          this.plugin.updateRibbonIcon();
        })
      );

    // ─── Deploy Hint ───
    containerEl.createEl("h2", { text: "Deploying to Your Site" });
    new Setting(containerEl)
      .setName("Git sync required")
      .setDesc("This plugin manages frontmatter and validation. To deploy changes to your Astro site, use Obsidian Git or your preferred Git sync method.")
      .addButton((btn) =>
        btn.setButtonText("Open Obsidian Git").setCta().onClick(() => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const appAny = this.app as any;
          const gitPlugin = appAny.plugins?.plugins?.["obsidian-git"];
          if (gitPlugin) {
            appAny.setting?.open();
            appAny.setting?.openTabById("obsidian-git");
          } else {
            window.open("https://github.com/Vinzent03/obsidian-git", "_blank");
          }
        })
      );

    // Version footer
    const versionEl = containerEl.createEl("div", { cls: "cms-settings-version" });
    versionEl.createEl("span", { text: `isHistory CMS v${this.plugin.manifest.version}` });
    versionEl.appendText(` \u00B7 Schema v${this.plugin.settings._version}`);
  }
}

// ─── Track Editor Modal ───

class TrackEditorModal extends Modal {
  private plugin: IsHistoryPlugin;
  private editCode: string | null;
  private editInfo: TrackInfo | null;
  private onSave: () => void;

  constructor(
    app: App,
    plugin: IsHistoryPlugin,
    code: string | null,
    info: TrackInfo | null,
    onSave: () => void,
  ) {
    super(app);
    this.plugin = plugin;
    this.editCode = code;
    this.editInfo = info;
    this.onSave = onSave;
  }

  onOpen(): void {
    const { titleEl, contentEl } = this;
    titleEl.setText(this.editCode ? `Edit Track: ${this.editCode}` : "Add New Track");

    const form = contentEl.createEl("div", { cls: "cms-track-editor" });

    // Code input
    const codeSetting = form.createEl("div", { cls: "cms-form-field" });
    codeSetting.createEl("label", { text: "Track code (1-2 letters, used in seriesOrder like A1, P3):" });
    const codeInput = codeSetting.createEl("input", {
      type: "text", cls: "cms-form-input",
    });
    codeInput.value = this.editCode || "";
    codeInput.placeholder = "e.g. A, R, T";
    codeInput.maxLength = 2;
    if (this.editCode) codeInput.disabled = true; // Can't change code of existing track

    // Name input
    const nameSetting = form.createEl("div", { cls: "cms-form-field" });
    nameSetting.createEl("label", { text: "Display name:" });
    const nameInput = nameSetting.createEl("input", {
      type: "text", cls: "cms-form-input",
    });
    nameInput.value = this.editInfo?.name || "";
    nameInput.placeholder = "e.g. Articles, Reviews";

    // Emoji input
    const emojiSetting = form.createEl("div", { cls: "cms-form-field" });
    emojiSetting.createEl("label", { text: "Emoji (copy from emojipedia.org):" });
    const emojiInput = emojiSetting.createEl("input", {
      type: "text", cls: "cms-form-input cms-form-input-emoji",
    });
    emojiInput.value = this.editInfo?.emoji || "";
    emojiInput.placeholder = "\u{1F4F0}";

    // Color input
    const colorSetting = form.createEl("div", { cls: "cms-form-field" });
    colorSetting.createEl("label", { text: "Color (hex, e.g. #7c3aed):" });
    const colorRow = colorSetting.createEl("div", { cls: "cms-color-input-row" });
    const colorInput = colorRow.createEl("input", {
      type: "text", cls: "cms-form-input cms-form-input-color",
    });
    colorInput.value = this.editInfo?.color || "#7c3aed";
    const colorPreview = colorRow.createEl("div", { cls: "cms-color-preview" });
    colorPreview.style.backgroundColor = colorInput.value;
    colorInput.addEventListener("input", () => {
      colorPreview.style.backgroundColor = colorInput.value;
    });
    // Native color picker
    const colorPicker = colorRow.createEl("input", {
      type: "color", cls: "cms-color-picker",
    });
    colorPicker.value = colorInput.value;
    colorPicker.addEventListener("input", () => {
      colorInput.value = colorPicker.value;
      colorPreview.style.backgroundColor = colorPicker.value;
    });

    // Buttons
    const btnRow = form.createEl("div", { cls: "cms-modal-btn-row" });
    btnRow.createEl("button", { text: "Cancel", cls: "cms-btn cms-btn-secondary" })
      .addEventListener("click", () => this.close());
    btnRow.createEl("button", { text: "Save", cls: "cms-btn cms-btn-primary" })
      .addEventListener("click", async () => {
        const code = codeInput.value.trim().toUpperCase();
        const name = nameInput.value.trim();
        const emoji = emojiInput.value.trim() || "\u{1F4CB}";
        const color = colorInput.value.trim() || "#7c3aed";

        if (!code || code.length === 0) {
          // eslint-disable-next-line no-console
          console.warn("Track code is required");
          return;
        }
        if (!name) {
          // eslint-disable-next-line no-console
          console.warn("Track name is required");
          return;
        }
        if (!this.editCode && code in this.plugin.settings.tracks) {
          // eslint-disable-next-line no-console
          console.warn(`Track code "${code}" already exists`);
          return;
        }

        this.plugin.settings.tracks[code] = { name, emoji, color };
        await this.plugin.saveSettings();
        this.plugin._updateDynamicStyles();
        this._debouncedRescan();
        this.close();
        this.onSave();
      });
  }

  private _debouncedRescan(delay = 600): void {
    setTimeout(() => this.plugin.rescanCache(), delay);
  }
}

// ─── Settings Migration ───

export function migrateSettings(loaded: Record<string, unknown>): Record<string, unknown> {
  const version = (loaded._version as number) || 0;

  if (version < 5) {
    loaded.archivePath = loaded.archivePath || DEFAULT_SETTINGS.archivePath;
    loaded.vaultPath = loaded.vaultPath || DEFAULT_SETTINGS.vaultPath;
    loaded.cardsPerPage =
      loaded.cardsPerPage !== undefined && loaded.cardsPerPage !== null
        ? loaded.cardsPerPage
        : DEFAULT_SETTINGS.cardsPerPage;
    loaded.showRibbonIcon =
      loaded.showRibbonIcon !== undefined ? loaded.showRibbonIcon : true;
    delete loaded.contentPath;
    delete loaded.requiredFields;
    delete loaded.validateDraft;
    delete loaded.validateDate;
    delete loaded.autoSyncGraph;
  }

  if (version < 6) {
    if (!loaded.cardsPerPage || typeof loaded.cardsPerPage !== "number") {
      loaded.cardsPerPage = DEFAULT_SETTINGS.cardsPerPage;
    }
  }

  if (version < 7) {
    loaded.defaultSeries = loaded.defaultSeries || DEFAULT_SETTINGS.defaultSeries;
  }

  // v1.5.0: Migrate from hardcoded tracks/statuses to dynamic settings
  if (version < 8) {
    // Initialize tracks from default if not present
    if (!loaded.tracks || typeof loaded.tracks !== "object") {
      loaded.tracks = { ...DEFAULT_TRACKS };
    }
    // Initialize statuses from default if not present
    if (!Array.isArray(loaded.statuses)) {
      loaded.statuses = [...DEFAULT_STATUSES];
    }
    // Validation thresholds
    if (typeof loaded.minTitleLength !== "number") loaded.minTitleLength = DEFAULT_SETTINGS.minTitleLength;
    if (typeof loaded.maxTitleLength !== "number") loaded.maxTitleLength = DEFAULT_SETTINGS.maxTitleLength;
    if (typeof loaded.minDescriptionLength !== "number") loaded.minDescriptionLength = DEFAULT_SETTINGS.minDescriptionLength;
    if (typeof loaded.maxDescriptionLength !== "number") loaded.maxDescriptionLength = DEFAULT_SETTINGS.maxDescriptionLength;
    if (!Array.isArray(loaded.requiredArchiveFields)) loaded.requiredArchiveFields = [...DEFAULT_SETTINGS.requiredArchiveFields];
    if (typeof loaded.imagePrefix !== "string") loaded.imagePrefix = DEFAULT_SETTINGS.imagePrefix;
    // Display limits
    if (typeof loaded.descriptionTruncation !== "number") loaded.descriptionTruncation = DEFAULT_SETTINGS.descriptionTruncation;
    if (typeof loaded.figuresTruncation !== "number") loaded.figuresTruncation = DEFAULT_SETTINGS.figuresTruncation;
    if (typeof loaded.maxTagsPerCard !== "number") loaded.maxTagsPerCard = DEFAULT_SETTINGS.maxTagsPerCard;
    if (typeof loaded.maxErrorsPerCard !== "number") loaded.maxErrorsPerCard = DEFAULT_SETTINGS.maxErrorsPerCard;
    if (typeof loaded.maxMetaTags !== "number") loaded.maxMetaTags = DEFAULT_SETTINGS.maxMetaTags;
    // Template
    if (typeof loaded.newPostSlug !== "string") loaded.newPostSlug = DEFAULT_SETTINGS.newPostSlug;
    if (typeof loaded.newPostTitle !== "string") loaded.newPostTitle = DEFAULT_SETTINGS.newPostTitle;
    if (typeof loaded.newPostImage !== "string") loaded.newPostImage = DEFAULT_SETTINGS.newPostImage;
    if (typeof loaded.newPostStatus !== "string") loaded.newPostStatus = DEFAULT_SETTINGS.newPostStatus;
    if (typeof loaded.newPostBody !== "string") loaded.newPostBody = DEFAULT_SETTINGS.newPostBody;
    // Pre-flight
    if (typeof loaded.preflightDraft !== "boolean") loaded.preflightDraft = DEFAULT_SETTINGS.preflightDraft;
    if (typeof loaded.preflightStatus !== "string") loaded.preflightStatus = DEFAULT_SETTINGS.preflightStatus;
    if (typeof loaded.preflightAutoDate !== "boolean") loaded.preflightAutoDate = DEFAULT_SETTINGS.preflightAutoDate;
  }

  loaded._version = SETTINGS_VERSION;
  return loaded;
}
