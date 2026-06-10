/**
 * isHistory CMS Plugin — Settings Tab
 *
 * Configuration UI for all plugin settings.
 * v1.5.0: Full settings UI designed for non-technical users.
 *   - NO sliders: number inputs with unit labels and hints
 *   - Toggles for booleans, dropdowns for choices from lists
 *   - Visual track editor with color picker
 *   - Tag/chip editor for statuses and required fields
 *   - Template variable insert buttons above textareas
 *   - Reset-to-default buttons on every section
 */

import { PluginSettingTab, type App, Setting, Modal, Notice, type SettingDefinitionItem } from "obsidian";
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
		if (this._rescanTimer) window.clearTimeout(this._rescanTimer);
		this._rescanTimer = window.setTimeout(() => {
			this.plugin.rescanCache();
		}, delay);
	}

	/** Helper: configure a number input with unit label and optional reset */
	private _addNumberInput(
		setting: Setting,
		opts: {
			name: string;
			desc: string;
			value: number;
			unit: string;
			placeholder?: string;
			min?: number;
			max?: number;
			step?: number;
			defaultValue: number;
			onChange: (v: number) => void;
		},
	): void {
		setting.setName(opts.name).setDesc(opts.desc);
		setting.addText((text) => {
			text.inputEl.type = "number";
			text.inputEl.classList.add("cms-number-input");
			if (opts.min !== undefined) text.inputEl.min = String(opts.min);
			if (opts.max !== undefined) text.inputEl.max = String(opts.max);
			if (opts.step !== undefined) text.inputEl.step = String(opts.step);
			if (opts.placeholder) text.inputEl.placeholder = opts.placeholder;
			text.setValue(String(opts.value));
			text.onChange(async (v) => {
				const num = parseInt(v, 10);
				if (!isNaN(num)) {
					opts.onChange(num);
					await this.plugin.saveSettings();
					this._debouncedRescan();
				}
			});
		});
		// Unit label
		const unitSpan = setting.controlEl.createSpan({ text: opts.unit, cls: "cms-input-unit" });
		setting.controlEl.appendChild(unitSpan);
		// Reset button
		setting.addExtraButton((btn) => {
			btn.setIcon("reset")
				.setTooltip(`Reset to default (${opts.defaultValue} ${opts.unit})`)
				.onClick(async () => {
					opts.onChange(opts.defaultValue);
					await this.plugin.saveSettings();
					this._debouncedRescan();
					this.update();
				});
		});
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const defs: SettingDefinitionItem[] = [];

		// ═══════════════════════════════════════════════════════════
		//  CONTENT PATHS
		// ═══════════════════════════════════════════════════════════
		defs.push({
			name: "Content Paths",
			render: (setting) => {
				setting.setHeading();
			},
		});

		defs.push({
			name: "Content paths hint",
			searchable: false,
			render: (setting) => {
				setting.settingEl.empty();
				setting.settingEl.addClass("cms-raw-item");
				setting.settingEl.createEl("p", {
					text: "Where your blog posts and research notes live inside the vault. These should match your Astro project's content folder structure.",
					cls: "cms-settings-hint",
				});
			},
		});

		defs.push({
			name: "Archive path",
			desc: "Folder with your blog posts (e.g. src/content/blog)",
			render: (setting) => {
				setting
					.addText((text) =>
						text
							.setPlaceholder("src/content/blog")
							.setValue(this.plugin.settings.archivePath)
							.onChange(async (v) => {
								this.plugin.settings.archivePath = normalizePathSetting(v);
								await this.plugin.saveSettings();
								this._debouncedRescan();
							})
					)
					.addExtraButton((btn) =>
						btn.setIcon("reset").setTooltip("Reset to default").onClick(async () => {
							this.plugin.settings.archivePath = DEFAULT_SETTINGS.archivePath;
							await this.plugin.saveSettings();
							this._debouncedRescan();
							this.update();
						})
					);
			},
		});

		defs.push({
			name: "Vault path",
			desc: "Folder with your research notes (e.g. src/content/vault)",
			render: (setting) => {
				setting
					.addText((text) =>
						text
							.setPlaceholder("src/content/vault")
							.setValue(this.plugin.settings.vaultPath)
							.onChange(async (v) => {
								this.plugin.settings.vaultPath = normalizePathSetting(v);
								await this.plugin.saveSettings();
								this._debouncedRescan();
							})
					)
					.addExtraButton((btn) =>
						btn.setIcon("reset").setTooltip("Reset to default").onClick(async () => {
							this.plugin.settings.vaultPath = DEFAULT_SETTINGS.vaultPath;
							await this.plugin.saveSettings();
							this._debouncedRescan();
							this.update();
						})
					);
			},
		});

		// ═══════════════════════════════════════════════════════════
		//  TRACKS
		// ═══════════════════════════════════════════════════════════
		defs.push({
			name: "Tracks",
			render: (setting) => {
				setting.setHeading();
			},
		});

		defs.push({
			name: "Tracks hint",
			searchable: false,
			render: (setting) => {
				setting.settingEl.empty();
				setting.settingEl.addClass("cms-raw-item");
				setting.settingEl.createEl("p", {
					text: "Tracks organize your content by type. Each track has a short code (used in seriesOrder like A1, P3), a display name, an emoji, and a color. You can add, edit, or remove tracks to match your content categories.",
					cls: "cms-settings-hint",
				});
			},
		});

		for (const [code, info] of Object.entries(this.plugin.settings.tracks)) {
			defs.push({
				name: `${info.emoji} ${info.name}`,
				desc: `Code: ${code} \u00B7 Color: ${info.color}`,
				render: (setting) => {
					setting
						.addButton((btn) =>
							btn.setButtonText("Edit").onClick(() => {
								new TrackEditorModal(this.app, this.plugin, code, info, () => this.update()).open();
							})
						)
						.addButton((btn) =>
							// Feature 2: Track deletion warning with orphan count
							btn.setButtonText("Remove").setDestructive().onClick(() => {
								const orphanCount = [...this.plugin.cache.items.values()].filter((i) => i.track === code).length;
								if (orphanCount > 0) {
									new TrackDeleteConfirmModal(this.app, this.plugin, code, info.name, orphanCount, () => {
										this._debouncedRescan();
										this.update();
									}).open();
								} else {
									void (async () => {
										delete this.plugin.settings.tracks[code];
										await this.plugin.saveSettings();
										this.plugin._updateDynamicStyles();
										this._debouncedRescan();
										this.update();
										new Notice(`Track "${code}" removed.`);
									})();
								}
							})
						);
				},
			});
		}

		defs.push({
			name: "Add a new track",
			desc: "Create a new content category with its own code, name, emoji, and color",
			render: (setting) => {
				setting.addButton((btn) =>
					btn.setButtonText("+ Add Track").setCta().onClick(() => {
						new TrackEditorModal(this.app, this.plugin, null, null, () => this.update()).open();
					})
				);
			},
		});

		// Reset tracks
		defs.push({
			name: "Reset tracks to default",
			desc: `Restore the default tracks: ${Object.entries(DEFAULT_TRACKS).map(([c, i]) => `${i.emoji} ${i.name} (${c})`).join(", ")}`,
			render: (setting) => {
				setting.addButton((btn) =>
					btn.setButtonText("Reset").setDestructive().onClick(async () => {
						this.plugin.settings.tracks = { ...DEFAULT_TRACKS };
						await this.plugin.saveSettings();
						this.plugin._updateDynamicStyles();
						this._debouncedRescan();
						this.update();
						new Notice("Tracks reset to defaults.");
					})
				);
			},
		});

		// ═══════════════════════════════════════════════════════════
		//  STATUSES — tag/chip editor
		// ═══════════════════════════════════════════════════════════
		defs.push({
			name: "Post Statuses",
			render: (setting) => {
				setting.setHeading();
			},
		});

		defs.push({
			name: "Post Statuses hint",
			searchable: false,
			render: (setting) => {
				setting.settingEl.empty();
				setting.settingEl.addClass("cms-raw-item");
				setting.settingEl.createEl("p", {
					text: "Statuses describe the publication stage of a post (e.g. published, upcoming, planned). These appear as filter options and in the pre-flight settings.",
					cls: "cms-settings-hint",
				});
			},
		});

		// Current statuses as removable chips
		defs.push({
			name: "Current statuses",
			searchable: false,
			render: (setting) => {
				setting.settingEl.empty();
				setting.settingEl.addClass("cms-raw-item");
				const statusChipRow = setting.settingEl.createEl("div", { cls: "cms-chip-row" });
				for (const status of this.plugin.settings.statuses) {
					const chip = statusChipRow.createEl("span", { cls: "cms-chip" });
					chip.createSpan({ text: status, cls: "cms-chip-text" });
					const removeBtn = chip.createEl("button", { cls: "cms-chip-remove", attr: { "aria-label": `Remove ${status}` } });
					removeBtn.setText("\u00D7");
					removeBtn.addEventListener("click", () => {
						void (async () => {
							this.plugin.settings.statuses = this.plugin.settings.statuses.filter((s) => s !== status);
							await this.plugin.saveSettings();
							this._debouncedRescan();
							this.update();
						})();
					});
				}
			},
		});

		// Add new status
		defs.push({
			name: "Add a new status",
			render: (setting) => {
				setting.addText((text) => {
					text.setPlaceholder("e.g. archived, featured, draft");
					text.inputEl.classList.add("cms-add-status-input");
					text.onChange(() => { /* track input for button wiring */ });
				});
				setting.addButton((btn) => {
					btn.setButtonText("Add").setCta();
					btn.buttonEl.classList.add("cms-add-status-btn");
					btn.onClick(async () => {
						const input = this.containerEl.querySelector<HTMLInputElement>(".cms-add-status-input");
						const value = input?.value?.trim().toLowerCase();
						if (!value) {
							new Notice("Please type a status name first.");
							return;
						}
						if (this.plugin.settings.statuses.includes(value)) {
							new Notice(`Status "${value}" already exists.`);
							return;
						}
						this.plugin.settings.statuses.push(value);
						await this.plugin.saveSettings();
						this._debouncedRescan();
						this.update();
						new Notice(`Added status: ${value}`);
					});
				});
			},
		});

		// Reset statuses
		defs.push({
			name: "Reset statuses to default",
			desc: `Restore: ${[...DEFAULT_STATUSES].join(", ")}`,
			render: (setting) => {
				setting.addButton((btn) =>
					btn.setButtonText("Reset").setDestructive().onClick(async () => {
						this.plugin.settings.statuses = [...DEFAULT_STATUSES];
						await this.plugin.saveSettings();
						this._debouncedRescan();
						this.update();
						new Notice("Statuses reset to defaults.");
					})
				);
			},
		});

		// ═══════════════════════════════════════════════════════════
		//  Feature 4: Cross-field settings validation warnings
		// ═══════════════════════════════════════════════════════════
		defs.push({
			name: "Validation warnings",
			searchable: false,
			visible: () => {
				const s = this.plugin.settings;
				return s.minTitleLength >= s.maxTitleLength ||
					s.minDescriptionLength >= s.maxDescriptionLength ||
					Object.keys(s.tracks).length === 0 ||
					s.statuses.length === 0 ||
					(s.archivePath === s.vaultPath && s.archivePath !== "");
			},
			render: (setting) => {
				setting.settingEl.empty();
				setting.settingEl.addClass("cms-raw-item");
				const validationWarnings: string[] = [];
				const s = this.plugin.settings;
				if (s.minTitleLength >= s.maxTitleLength) validationWarnings.push("Min title length must be less than max title length.");
				if (s.minDescriptionLength >= s.maxDescriptionLength) validationWarnings.push("Min description length must be less than max description length.");
				if (Object.keys(s.tracks).length === 0) validationWarnings.push("You have no tracks defined. New posts cannot be created.");
				if (s.statuses.length === 0) validationWarnings.push("You have no statuses defined. Pre-flight may not work correctly.");
				if (s.archivePath === s.vaultPath && s.archivePath !== "") validationWarnings.push("Archive path and vault path should be different.");
				if (validationWarnings.length > 0) {
					const warnBox = setting.settingEl.createEl("div", { cls: "cms-settings-warnings" });
					warnBox.createEl("strong", { text: "Settings issues:" });
					for (const w of validationWarnings) {
						warnBox.createEl("div", { text: w, cls: "cms-settings-warning" });
					}
				}
			},
		});

		// ═══════════════════════════════════════════════════════════
		//  VALIDATION RULES — number inputs with unit labels
		// ═══════════════════════════════════════════════════════════
		defs.push({
			name: "Validation Rules",
			render: (setting) => {
				setting.setHeading();
			},
		});

		defs.push({
			name: "Validation Rules hint",
			searchable: false,
			render: (setting) => {
				setting.settingEl.empty();
				setting.settingEl.addClass("cms-raw-item");
				setting.settingEl.createEl("p", {
					text: "These rules check your frontmatter for common mistakes. The plugin will flag titles and descriptions that are too short (errors) or too long (warnings). Adjust the thresholds to match your SEO requirements.",
					cls: "cms-settings-hint",
				});
			},
		});

		defs.push({
			name: "Minimum title length",
			desc: "Titles shorter than this will be flagged as errors. Search engines prefer titles with at least a few words.",
			render: (setting) => {
				this._addNumberInput(setting, {
					name: "Minimum title length",
					desc: "Titles shorter than this will be flagged as errors. Search engines prefer titles with at least a few words.",
					value: this.plugin.settings.minTitleLength,
					unit: "chars",
					min: 1,
					max: 50,
					step: 1,
					defaultValue: DEFAULT_SETTINGS.minTitleLength,
					onChange: (v) => { this.plugin.settings.minTitleLength = v; },
				});
			},
		});

		defs.push({
			name: "Maximum title length",
			desc: "Titles longer than this will be flagged as warnings. Google truncates titles around 60 characters in results.",
			render: (setting) => {
				this._addNumberInput(setting, {
					name: "Maximum title length",
					desc: "Titles longer than this will be flagged as warnings. Google truncates titles around 60 characters in results.",
					value: this.plugin.settings.maxTitleLength,
					unit: "chars",
					min: 30,
					max: 300,
					step: 5,
					defaultValue: DEFAULT_SETTINGS.maxTitleLength,
					onChange: (v) => { this.plugin.settings.maxTitleLength = v; },
				});
			},
		});

		defs.push({
			name: "Minimum description length",
			desc: "Descriptions shorter than this will be flagged as errors. Good meta descriptions help with search engine optimization.",
			render: (setting) => {
				this._addNumberInput(setting, {
					name: "Minimum description length",
					desc: "Descriptions shorter than this will be flagged as errors. Good meta descriptions help with search engine optimization.",
					value: this.plugin.settings.minDescriptionLength,
					unit: "chars",
					min: 1,
					max: 100,
					step: 1,
					defaultValue: DEFAULT_SETTINGS.minDescriptionLength,
					onChange: (v) => { this.plugin.settings.minDescriptionLength = v; },
				});
			},
		});

		defs.push({
			name: "Maximum description length",
			desc: "Descriptions longer than this will be flagged as warnings. Google typically shows about 155-160 characters of meta descriptions.",
			render: (setting) => {
				this._addNumberInput(setting, {
					name: "Maximum description length",
					desc: "Descriptions longer than this will be flagged as warnings. Google typically shows about 155-160 characters of meta descriptions.",
					value: this.plugin.settings.maxDescriptionLength,
					unit: "chars",
					min: 50,
					max: 500,
					step: 5,
					defaultValue: DEFAULT_SETTINGS.maxDescriptionLength,
					onChange: (v) => { this.plugin.settings.maxDescriptionLength = v; },
				});
			},
		});

		// Image prefix — text input
		defs.push({
			name: "Image path must start with",
			desc: "Hero image paths should begin with this prefix. Typically \"/\" for absolute paths or \"./\" for relative paths.",
			render: (setting) => {
				setting
					.addText((text) =>
						text.setValue(this.plugin.settings.imagePrefix).onChange(async (v) => {
							this.plugin.settings.imagePrefix = v;
							await this.plugin.saveSettings();
							this._debouncedRescan();
						})
					)
					.addExtraButton((btn) =>
						btn.setIcon("reset").setTooltip("Reset to default (\"/\")").onClick(async () => {
							this.plugin.settings.imagePrefix = DEFAULT_SETTINGS.imagePrefix;
							await this.plugin.saveSettings();
							this._debouncedRescan();
							this.update();
						})
					);
			},
		});

		// Required archive fields — tag/chip editor
		defs.push({
			name: "Required archive fields",
			render: (setting) => {
				setting.setHeading();
			},
		});

		defs.push({
			name: "Required archive fields hint",
			searchable: false,
			render: (setting) => {
				setting.settingEl.empty();
				setting.settingEl.addClass("cms-raw-item");
				setting.settingEl.createEl("p", {
					text: "These frontmatter fields must be present in every archive post. If a field is missing or empty, the validator will flag it as an error.",
					cls: "cms-settings-hint",
				});
			},
		});

		defs.push({
			name: "Current required fields",
			searchable: false,
			render: (setting) => {
				setting.settingEl.empty();
				setting.settingEl.addClass("cms-raw-item");
				const reqChipRow = setting.settingEl.createEl("div", { cls: "cms-chip-row" });
				for (const field of this.plugin.settings.requiredArchiveFields) {
					const chip = reqChipRow.createEl("span", { cls: "cms-chip" });
					chip.createSpan({ text: field, cls: "cms-chip-text" });
					const removeBtn = chip.createEl("button", { cls: "cms-chip-remove", attr: { "aria-label": `Remove ${field}` } });
					removeBtn.setText("\u00D7");
					removeBtn.addEventListener("click", () => {
						void (async () => {
							this.plugin.settings.requiredArchiveFields = this.plugin.settings.requiredArchiveFields.filter((f) => f !== field);
							await this.plugin.saveSettings();
							this._debouncedRescan();
							this.update();
						})();
					});
				}
			},
		});

		defs.push({
			name: "Add a required field",
			render: (setting) => {
				setting.addText((text) => {
					text.setPlaceholder("e.g. series, track, era");
					text.inputEl.classList.add("cms-add-field-input");
					text.onChange(() => { /* track input */ });
				});
				setting.addButton((btn) => {
					btn.setButtonText("Add").setCta();
					btn.onClick(async () => {
						const input = this.containerEl.querySelector<HTMLInputElement>(".cms-add-field-input");
						const value = input?.value?.trim().toLowerCase();
						if (!value) {
							new Notice("Please type a field name first.");
							return;
						}
						if (this.plugin.settings.requiredArchiveFields.includes(value)) {
							new Notice(`Field "${value}" is already required.`);
							return;
						}
						this.plugin.settings.requiredArchiveFields.push(value);
						await this.plugin.saveSettings();
						this._debouncedRescan();
						this.update();
						new Notice(`Added required field: ${value}`);
					});
				});
			},
		});

		defs.push({
			name: "Reset required fields to default",
			desc: `Restore: ${DEFAULT_SETTINGS.requiredArchiveFields.join(", ")}`,
			render: (setting) => {
				setting.addButton((btn) =>
					btn.setButtonText("Reset").setDestructive().onClick(async () => {
						this.plugin.settings.requiredArchiveFields = [...DEFAULT_SETTINGS.requiredArchiveFields];
						await this.plugin.saveSettings();
						this._debouncedRescan();
						this.update();
					})
				);
			},
		});

		// ═══════════════════════════════════════════════════════════
		//  CARD DISPLAY — number inputs with context
		// ═══════════════════════════════════════════════════════════
		defs.push({
			name: "Card Display",
			render: (setting) => {
				setting.setHeading();
			},
		});

		defs.push({
			name: "Card Display hint",
			searchable: false,
			render: (setting) => {
				setting.settingEl.empty();
				setting.settingEl.addClass("cms-raw-item");
				setting.settingEl.createEl("p", {
					text: "Control how much information is shown on each card in the dashboard. Higher values show more detail but make the page longer.",
					cls: "cms-settings-hint",
				});
			},
		});

		defs.push({
			name: "Cards per page",
			desc: "How many cards to show before the \"Load More\" button appears. Lower values load faster.",
			render: (setting) => {
				this._addNumberInput(setting, {
					name: "Cards per page",
					desc: "How many cards to show before the \"Load More\" button appears. Lower values load faster.",
					value: this.plugin.settings.cardsPerPage,
					unit: "cards",
					min: 5,
					max: 200,
					step: 5,
					defaultValue: DEFAULT_SETTINGS.cardsPerPage,
					onChange: (v) => { this.plugin.settings.cardsPerPage = v; },
				});
			},
		});

		defs.push({
			name: "Description preview length",
			desc: "How many characters of the description to show on each card before truncating with \"...\".",
			render: (setting) => {
				this._addNumberInput(setting, {
					name: "Description preview length",
					desc: "How many characters of the description to show on each card before truncating with \"...\".",
					value: this.plugin.settings.descriptionTruncation,
					unit: "chars",
					min: 20,
					max: 500,
					step: 10,
					defaultValue: DEFAULT_SETTINGS.descriptionTruncation,
					onChange: (v) => { this.plugin.settings.descriptionTruncation = v; },
				});
			},
		});

		defs.push({
			name: "Figures preview length",
			desc: "How many characters of the figures field to show on each card.",
			render: (setting) => {
				this._addNumberInput(setting, {
					name: "Figures preview length",
					desc: "How many characters of the figures field to show on each card.",
					value: this.plugin.settings.figuresTruncation,
					unit: "chars",
					min: 10,
					max: 200,
					step: 5,
					defaultValue: DEFAULT_SETTINGS.figuresTruncation,
					onChange: (v) => { this.plugin.settings.figuresTruncation = v; },
				});
			},
		});

		defs.push({
			name: "Tags shown per card",
			desc: "Maximum number of tags displayed on each card. Extra tags show as \"+3 more\".",
			render: (setting) => {
				this._addNumberInput(setting, {
					name: "Tags shown per card",
					desc: "Maximum number of tags displayed on each card. Extra tags show as \"+3 more\".",
					value: this.plugin.settings.maxTagsPerCard,
					unit: "tags",
					min: 1,
					max: 20,
					step: 1,
					defaultValue: DEFAULT_SETTINGS.maxTagsPerCard,
					onChange: (v) => { this.plugin.settings.maxTagsPerCard = v; },
				});
			},
		});

		defs.push({
			name: "Errors shown per card",
			desc: "Maximum number of validation errors displayed on each card. Extra errors show as \"+2 more\".",
			render: (setting) => {
				this._addNumberInput(setting, {
					name: "Errors shown per card",
					desc: "Maximum number of validation errors displayed on each card. Extra errors show as \"+2 more\".",
					value: this.plugin.settings.maxErrorsPerCard,
					unit: "errors",
					min: 1,
					max: 20,
					step: 1,
					defaultValue: DEFAULT_SETTINGS.maxErrorsPerCard,
					onChange: (v) => { this.plugin.settings.maxErrorsPerCard = v; },
				});
			},
		});

		defs.push({
			name: "Tags in meta section",
			desc: "Maximum number of unique tags shown in the \"Tags\" section at the bottom of the dashboard.",
			render: (setting) => {
				this._addNumberInput(setting, {
					name: "Tags in meta section",
					desc: "Maximum number of unique tags shown in the \"Tags\" section at the bottom of the dashboard.",
					value: this.plugin.settings.maxMetaTags,
					unit: "tags",
					min: 5,
					max: 200,
					step: 5,
					defaultValue: DEFAULT_SETTINGS.maxMetaTags,
					onChange: (v) => { this.plugin.settings.maxMetaTags = v; },
				});
			},
		});

		// ═══════════════════════════════════════════════════════════
		//  NEW POST TEMPLATE — with variable insert buttons
		// ═══════════════════════════════════════════════════════════
		defs.push({
			name: "New Post Template",
			render: (setting) => {
				setting.setHeading();
			},
		});

		defs.push({
			name: "New Post Template hint",
			searchable: false,
			render: (setting) => {
				setting.settingEl.empty();
				setting.settingEl.addClass("cms-raw-item");
				setting.settingEl.createEl("p", {
					text: "Customize how new posts are created. Click the variable buttons below each field to insert placeholders that get filled in automatically when you create a new post.",
					cls: "cms-settings-hint",
				});
			},
		});

		// Variable reference card
		defs.push({
			name: "Available Variables",
			searchable: false,
			render: (setting) => {
				setting.settingEl.empty();
				setting.settingEl.addClass("cms-raw-item");
				const varCard = setting.settingEl.createEl("div", { cls: "cms-template-vars-card" });
				varCard.createEl("strong", { text: "Available Variables" });
				const varGrid = varCard.createEl("div", { cls: "cms-template-vars-grid" });
				for (const v of TEMPLATE_VARIABLES) {
					const varItem = varGrid.createEl("div", { cls: "cms-template-var-item" });
					varItem.createEl("code", { text: `{{${v.name}}}` });
					varItem.createEl("span", { text: v.description, cls: "cms-template-var-desc" });
				}
			},
		});

		// Default series
		defs.push({
			name: "Default series",
			desc: "Series name applied to all new posts (e.g. minds-and-machines)",
			render: (setting) => {
				setting
					.addText((text) =>
						text.setPlaceholder("minds-and-machines")
							.setValue(this.plugin.settings.defaultSeries || "")
							.onChange(async (v) => {
								this.plugin.settings.defaultSeries = v.trim();
								await this.plugin.saveSettings();
							})
					)
					.addExtraButton((btn) =>
						btn.setIcon("reset").setTooltip("Reset to default").onClick(async () => {
							this.plugin.settings.defaultSeries = DEFAULT_SETTINGS.defaultSeries;
							await this.plugin.saveSettings();
							this.update();
						})
					);
			},
		});

		// Slug format with variable buttons
		defs.push({
			name: "Slug format",
			desc: "File name pattern for new posts. This becomes the .md file name.",
			render: (setting) => {
				setting.addText((text) => {
					text.inputEl.classList.add("cms-template-input");
					text.setPlaceholder("{{seriesOrder}}-untitled-post")
						.setValue(this.plugin.settings.newPostSlug)
						.onChange(async (v) => {
							this.plugin.settings.newPostSlug = v;
							await this.plugin.saveSettings();
						});
				});
				setting.addExtraButton((btn) =>
					btn.setIcon("reset").setTooltip("Reset to default").onClick(async () => {
						this.plugin.settings.newPostSlug = DEFAULT_SETTINGS.newPostSlug;
						await this.plugin.saveSettings();
						this.update();
					})
				);
				this._addVariableButtons(this.containerEl, "cms-template-input", ["seriesOrder", "seriesOrderLower", "track"]);
			},
		});

		// Title format with variable buttons
		defs.push({
			name: "Title format",
			desc: "Default title for new posts",
			render: (setting) => {
				setting.addText((text) => {
					text.inputEl.classList.add("cms-template-input-title");
					text.setPlaceholder("Untitled {{trackName}} Post")
						.setValue(this.plugin.settings.newPostTitle)
						.onChange(async (v) => {
							this.plugin.settings.newPostTitle = v;
							await this.plugin.saveSettings();
						});
				});
				setting.addExtraButton((btn) =>
					btn.setIcon("reset").setTooltip("Reset to default").onClick(async () => {
						this.plugin.settings.newPostTitle = DEFAULT_SETTINGS.newPostTitle;
						await this.plugin.saveSettings();
						this.update();
					})
				);
				this._addVariableButtons(this.containerEl, "cms-template-input-title", ["trackName", "seriesOrder", "series"]);
			},
		});

		// Image path format with variable buttons
		defs.push({
			name: "Image path format",
			desc: "Hero image path pattern for new posts",
			render: (setting) => {
				setting.addText((text) => {
					text.inputEl.classList.add("cms-template-input-image");
					text.setPlaceholder("/images/{{seriesOrderLower}}-hero.jpg")
						.setValue(this.plugin.settings.newPostImage)
						.onChange(async (v) => {
							this.plugin.settings.newPostImage = v;
							await this.plugin.saveSettings();
						});
				});
				setting.addExtraButton((btn) =>
					btn.setIcon("reset").setTooltip("Reset to default").onClick(async () => {
						this.plugin.settings.newPostImage = DEFAULT_SETTINGS.newPostImage;
						await this.plugin.saveSettings();
						this.update();
					})
				);
				this._addVariableButtons(this.containerEl, "cms-template-input-image", ["seriesOrderLower", "seriesOrder", "track"]);
			},
		});

		// Default status — dropdown from defined statuses
		defs.push({
			name: "Default status for new posts",
			desc: "What publication status to set on newly created posts",
			render: (setting) => {
				setting.addDropdown((dd) => {
					for (const s of this.plugin.settings.statuses) {
						dd.addOption(s, s);
					}
					dd.setValue(this.plugin.settings.newPostStatus || this.plugin.settings.statuses[0] || "planned");
					dd.onChange(async (v) => {
						this.plugin.settings.newPostStatus = v;
						await this.plugin.saveSettings();
					});
				});
			},
		});

		// Body template with variable buttons
		defs.push({
			name: "Body template",
			desc: "Default content for the body of new posts. This appears below the frontmatter.",
			render: (setting) => {
				setting.addTextArea((text) => {
					text.inputEl.classList.add("cms-template-textarea");
					text.setPlaceholder("Start writing here...")
						.setValue(this.plugin.settings.newPostBody)
						.onChange(async (v) => {
							this.plugin.settings.newPostBody = v;
							await this.plugin.saveSettings();
						});
					text.inputEl.rows = 4;
				});
				setting.addExtraButton((btn) =>
					btn.setIcon("reset").setTooltip("Reset to default").onClick(async () => {
						this.plugin.settings.newPostBody = DEFAULT_SETTINGS.newPostBody;
						await this.plugin.saveSettings();
						this.update();
					})
				);
				this._addVariableButtons(this.containerEl, "cms-template-textarea", ["seriesOrder", "trackName", "date", "series"]);
			},
		});

		// ═══════════════════════════════════════════════════════════
		//  PRE-FLIGHT SETTINGS — toggles and dropdowns
		// ═══════════════════════════════════════════════════════════
		defs.push({
			name: "Pre-flight",
			render: (setting) => {
				setting.setHeading();
			},
		});

		defs.push({
			name: "Pre-flight hint",
			searchable: false,
			render: (setting) => {
				setting.settingEl.empty();
				setting.settingEl.addClass("cms-raw-item");
				setting.settingEl.createEl("p", {
					text: "Pre-flight prepares a draft for publishing. When you click \"Pre-flight\" on a post, these settings determine what changes are made to the frontmatter.",
					cls: "cms-settings-hint",
				});
			},
		});

		defs.push({
			name: "Set draft flag to",
			desc: "What the draft field should be set to when pre-flighting. Choose \"false (publish)\" to mark the post as ready for publication.",
			render: (setting) => {
				setting.addDropdown((dd) => {
					dd.addOption("false", "false \u2014 publish the post");
					dd.addOption("true", "true \u2014 keep as draft");
					dd.setValue(String(this.plugin.settings.preflightDraft));
					dd.onChange(async (v) => {
						this.plugin.settings.preflightDraft = v === "true";
						await this.plugin.saveSettings();
					});
				});
			},
		});

		defs.push({
			name: "Set status to",
			desc: "What the status field should be set to when pre-flighting",
			render: (setting) => {
				setting.addDropdown((dd) => {
					for (const s of this.plugin.settings.statuses) {
						dd.addOption(s, s);
					}
					dd.setValue(this.plugin.settings.preflightStatus || "published");
					dd.onChange(async (v) => {
						this.plugin.settings.preflightStatus = v;
						await this.plugin.saveSettings();
					});
				});
			},
		});

		defs.push({
			name: "Auto-fill today's date",
			desc: "If the post has no date set, automatically fill it with today's date when pre-flighting",
			render: (setting) => {
				setting.addToggle((toggle) =>
					toggle.setValue(this.plugin.settings.preflightAutoDate).onChange(async (v) => {
						this.plugin.settings.preflightAutoDate = v;
						await this.plugin.saveSettings();
					})
				);
			},
		});

		// Reset pre-flight
		defs.push({
			name: "Reset pre-flight to default",
			desc: "Restore: draft=false, status=published, auto-fill date=true",
			render: (setting) => {
				setting.addButton((btn) =>
					btn.setButtonText("Reset").setDestructive().onClick(async () => {
						this.plugin.settings.preflightDraft = DEFAULT_SETTINGS.preflightDraft;
						this.plugin.settings.preflightStatus = DEFAULT_SETTINGS.preflightStatus;
						this.plugin.settings.preflightAutoDate = DEFAULT_SETTINGS.preflightAutoDate;
						await this.plugin.saveSettings();
						this.update();
					})
				);
			},
		});

		// ═══════════════════════════════════════════════════════════
		//  APPEARANCE
		// ═══════════════════════════════════════════════════════════
		defs.push({
			name: "Appearance",
			render: (setting) => {
				setting.setHeading();
			},
		});

		defs.push({
			name: "Show ribbon icon",
			desc: "Show the isHistory icon in the left sidebar ribbon for quick access",
			render: (setting) => {
				setting.addToggle((toggle) =>
					toggle.setValue(this.plugin.settings.showRibbonIcon).onChange(async (v) => {
						this.plugin.settings.showRibbonIcon = v;
						await this.plugin.saveSettings();
						this.plugin.updateRibbonIcon();
					})
				);
			},
		});

		// ═══════════════════════════════════════════════════════════
		//  DEPLOY HINT
		// ═══════════════════════════════════════════════════════════
		defs.push({
			name: "Deploying to Your Site",
			render: (setting) => {
				setting.setHeading();
			},
		});

		defs.push({
			name: "Git sync required",
			desc: "This plugin manages frontmatter and validation. To deploy changes to your Astro site, use Obsidian Git or your preferred Git sync method.",
			render: (setting) => {
				setting.addButton((btn) =>
					btn.setButtonText("Open Obsidian Git").setCta().onClick(() => {
						const appWithPlugins = this.app as unknown as { plugins?: { plugins?: Record<string, { manifest?: { id?: string } }> }; setting?: { open: () => void; openTabById: (id: string) => void } };
						const gitPlugin = appWithPlugins.plugins?.plugins?.["obsidian-git"];
						if (gitPlugin && appWithPlugins.setting) {
							appWithPlugins.setting.open();
							appWithPlugins.setting.openTabById("obsidian-git");
						} else {
							window.open("https://github.com/Vinzent03/obsidian-git", "_blank");
						}
					})
				);
			},
		});

		// Version footer
		defs.push({
			name: "Version",
			searchable: false,
			render: (setting) => {
				setting.settingEl.empty();
				setting.settingEl.addClass("cms-raw-item");
				const versionEl = setting.settingEl.createEl("div", { cls: "cms-settings-version" });
				versionEl.createEl("span", { text: `isHistory CMS v${this.plugin.manifest.version}` });
				versionEl.appendText(` \u00B7 Schema v${this.plugin.settings._version}`);
			},
		});

		return defs;
	}

	/** Add clickable variable insert buttons below a template input */
	private _addVariableButtons(
		containerEl: HTMLElement,
		inputClass: string,
		varNames: string[],
	): void {
		const btnRow = containerEl.createEl("div", { cls: "cms-var-btn-row" });
		btnRow.createEl("span", { text: "Insert:", cls: "cms-var-btn-label" });
		for (const name of varNames) {
			const btn = btnRow.createEl("button", {
				text: `{{${name}}}`,
				cls: "cms-var-btn",
				attr: { "data-var": name },
			});
			btn.addEventListener("click", () => {
				const input = containerEl.querySelector<HTMLInputElement | HTMLTextAreaElement>(`.${inputClass}`);
				if (!input) return;
				const start = input.selectionStart ?? input.value.length;
				const end = input.selectionEnd ?? input.value.length;
				const insertion = `{{${name}}}`;
				const newValue = input.value.substring(0, start) + insertion + input.value.substring(end);
				input.value = newValue;
				// Set cursor position after insertion
				const newPos = start + insertion.length;
				input.setSelectionRange(newPos, newPos);
				// Trigger the onChange (dispatch both events for compatibility)
				input.dispatchEvent(new Event("input", { bubbles: true }));
				input.dispatchEvent(new Event("change", { bubbles: true }));
			});
		}
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
		codeSetting.createEl("label", { text: "Track code" });
		codeSetting.createEl("p", { text: "1-2 uppercase letters used in seriesOrder (e.g. A1, P3, E14). This cannot be changed after creation.", cls: "cms-form-hint" });
		const codeInput = codeSetting.createEl("input", {
			type: "text", cls: "cms-form-input",
		});
		codeInput.value = this.editCode || "";
		codeInput.placeholder = "e.g. A, R, T";
		codeInput.maxLength = 2;
		if (this.editCode) codeInput.disabled = true;

		// Name input
		const nameSetting = form.createEl("div", { cls: "cms-form-field" });
		nameSetting.createEl("label", { text: "Display name" });
		nameSetting.createEl("p", { text: "The human-readable name shown in the dashboard and filters (e.g. \"Articles\", \"Photography\").", cls: "cms-form-hint" });
		const nameInput = nameSetting.createEl("input", {
			type: "text", cls: "cms-form-input",
		});
		nameInput.value = this.editInfo?.name || "";
		nameInput.placeholder = "e.g. Articles, Reviews, Tutorials";

		// Emoji input
		const emojiSetting = form.createEl("div", { cls: "cms-form-field" });
		emojiSetting.createEl("label", { text: "Emoji" });
		emojiSetting.createEl("p", { text: "An emoji that represents this track. You can copy one from emojipedia.org.", cls: "cms-form-hint" });
		const emojiInput = emojiSetting.createEl("input", {
			type: "text", cls: "cms-form-input cms-form-input-emoji",
		});
		emojiInput.value = this.editInfo?.emoji || "";
		emojiInput.placeholder = "\u{1F4F0}";

		// Color input — with native color picker
		const colorSetting = form.createEl("div", { cls: "cms-form-field" });
		colorSetting.createEl("label", { text: "Color" });
		colorSetting.createEl("p", { text: "The accent color for this track. Used for card borders, badges, and stats in the dashboard.", cls: "cms-form-hint" });
		const colorRow = colorSetting.createEl("div", { cls: "cms-color-input-row" });
		const colorPicker = colorRow.createEl("input", {
			type: "color", cls: "cms-color-picker",
		});
		colorPicker.value = this.editInfo?.color || "#7c3aed";
		const colorInput = colorRow.createEl("input", {
			type: "text", cls: "cms-form-input cms-form-input-color",
		});
		colorInput.value = this.editInfo?.color || "#7c3aed";
		colorInput.placeholder = "#7c3aed";
		const colorPreview = colorRow.createEl("div", { cls: "cms-color-preview" });
		colorPreview.style.backgroundColor = colorInput.value;
		// Sync picker → text + preview
		colorPicker.addEventListener("input", () => {
			colorInput.value = colorPicker.value;
			colorPreview.style.backgroundColor = colorPicker.value;
		});
		// Sync text → picker + preview
		colorInput.addEventListener("input", () => {
			if (/^#[0-9a-fA-F]{6}$/.test(colorInput.value)) {
				colorPicker.value = colorInput.value;
				colorPreview.style.backgroundColor = colorInput.value;
			}
		});

		// Error display area
		const errorArea = form.createEl("div", { cls: "cms-form-errors" });

		// Buttons
		const btnRow = form.createEl("div", { cls: "cms-modal-btn-row" });
		btnRow.createEl("button", { text: "Cancel", cls: "cms-btn cms-btn-secondary" })
			.addEventListener("click", () => this.close());
		btnRow.createEl("button", { text: "Save Track", cls: "cms-btn cms-btn-primary" })
			.addEventListener("click", () => {
				void (async () => {
					const code = codeInput.value.trim().toUpperCase();
					const name = nameInput.value.trim();
					const emoji = emojiInput.value.trim() || "\u{1F4CB}";
					const color = colorInput.value.trim() || "#7c3aed";

					// Validate with user-visible feedback
					const errors: string[] = [];
					if (!code || code.length === 0) {
						errors.push("Track code is required.");
					}
					if (code && !/^[A-Z]{1,2}$/.test(code)) {
						errors.push("Track code must be 1-2 uppercase letters (A-Z).");
					}
					if (!name) {
						errors.push("Display name is required.");
					}
					if (!this.editCode && code in this.plugin.settings.tracks) {
						errors.push(`Track code "${code}" already exists. Choose a different code.`);
					}
					if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
						errors.push("Color must be a valid hex code (e.g. #7c3aed).");
					}

					if (errors.length > 0) {
						errorArea.empty();
						for (const err of errors) {
							errorArea.createEl("div", { text: err, cls: "cms-form-error" });
						}
						return;
					}

					this.plugin.settings.tracks[code] = { name, emoji, color };
					await this.plugin.saveSettings();
					this.plugin._updateDynamicStyles();
					this._debouncedRescan();
					this.close();
					this.onSave();
					new Notice(`Track "${name}" (${code}) saved.`);
				})();
			});
	}

	private _debouncedRescan(delay = 600): void {
		window.setTimeout(() => this.plugin.rescanCache(), delay);
	}
}

// ─── Feature 2: Track Deletion Confirmation Modal ───

class TrackDeleteConfirmModal extends Modal {
	private plugin: IsHistoryPlugin;
	private trackCode: string;
	private trackName: string;
	private orphanCount: number;
	private onDelete: () => void;

	constructor(
		app: App,
		plugin: IsHistoryPlugin,
		trackCode: string,
		trackName: string,
		orphanCount: number,
		onDelete: () => void,
	) {
		super(app);
		this.plugin = plugin;
		this.trackCode = trackCode;
		this.trackName = trackName;
		this.orphanCount = orphanCount;
		this.onDelete = onDelete;
	}

	onOpen(): void {
		const { titleEl, contentEl } = this;
		titleEl.setText(`Delete track "${this.trackCode}"?`);

		const form = contentEl.createEl("div", { cls: "cms-track-editor" });
		form.createEl("p", {
			text: `${this.orphanCount} post${this.orphanCount !== 1 ? "s" : ""} currently use the track "${this.trackCode}" (${this.trackName}). Deleting it will cause validation errors on those posts because their "track" field will no longer be recognized.`,
			cls: "cms-form-hint",
		});
		form.createEl("p", {
			text: "You can fix this later by editing each post's frontmatter to use a different track code.",
			cls: "cms-form-hint",
		});

		const btnRow = form.createEl("div", { cls: "cms-modal-btn-row" });
		btnRow.createEl("button", { text: "Cancel", cls: "cms-btn cms-btn-secondary" })
			.addEventListener("click", () => this.close());
		btnRow.createEl("button", { text: "Delete anyway", cls: "cms-btn cms-btn-primary" })
			.addEventListener("click", () => {
				void (async () => {
					delete this.plugin.settings.tracks[this.trackCode];
					await this.plugin.saveSettings();
					this.plugin._updateDynamicStyles();
					this.close();
					this.onDelete();
					new Notice(`Track "${this.trackCode}" deleted. ${this.orphanCount} post${this.orphanCount !== 1 ? "s" : ""} now orphaned.`);
				})();
			});
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
