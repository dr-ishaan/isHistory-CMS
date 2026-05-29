/**
 * isHistory CMS Plugin — Settings Tab
 *
 * Configuration UI for content paths, pagination, appearance,
 * series defaults, and Git integration.
 */

import { PluginSettingTab, type App, Setting } from "obsidian";
import { type IsHistorySettings, SETTINGS_VERSION, DEFAULT_SETTINGS, normalizePathSetting } from "./types";
import { IsHistoryPlugin } from "./main";

export class IsHistorySettingTab extends PluginSettingTab {
  plugin: IsHistoryPlugin;

  constructor(app: App, plugin: IsHistoryPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Git sync dependency notice
    new Setting(containerEl)
      .setName("Deploying to your site")
      .setDesc(
        "This plugin manages frontmatter and validation only. To deploy changes to your Astro site, install Obsidian Git and configure auto-commit/push, or use your preferred Git sync method."
      )
      .addButton((btn) =>
        btn
          .setButtonText("Open Obsidian Git")
          .setClass("mod-cta")
          .onClick(() => {
            const gitPlugin = (this.app as any).plugins?.plugins?.["obsidian-git"];
            if (gitPlugin) {
              (this.app as any).setting?.open();
              (this.app as any).setting?.openTabById("obsidian-git");
            } else {
              window.open("https://github.com/Vinzent03/obsidian-git", "_blank");
            }
          })
      );

    containerEl.createEl("h3", { text: "Content paths" });
    new Setting(containerEl)
      .setName("Archive path")
      .setDesc("Path to blog/archive content (default: src/content/blog)")
      .addText((text) =>
        text
          .setPlaceholder("src/content/blog")
          .setValue(this.plugin.settings.archivePath)
          .onChange(async (v) => {
            this.plugin.settings.archivePath = normalizePathSetting(v);
            await this.plugin.saveSettings();
            this.plugin.rescanCache();
          })
      );
    new Setting(containerEl)
      .setName("Vault path")
      .setDesc("Path to vault/research content (default: src/content/vault)")
      .addText((text) =>
        text
          .setPlaceholder("src/content/vault")
          .setValue(this.plugin.settings.vaultPath)
          .onChange(async (v) => {
            this.plugin.settings.vaultPath = normalizePathSetting(v);
            await this.plugin.saveSettings();
            this.plugin.rescanCache();
          })
      );

    containerEl.createEl("h3", { text: "Defaults" });
    new Setting(containerEl)
      .setName("Default series")
      .setDesc("Series name applied to new posts (default: minds-and-machines)")
      .addText((text) =>
        text
          .setPlaceholder("minds-and-machines")
          .setValue(this.plugin.settings.defaultSeries || "")
          .onChange(async (v) => {
            this.plugin.settings.defaultSeries = v.trim();
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Performance" });
    new Setting(containerEl)
      .setName("Cards per page")
      .setDesc("Number of cards before 'Load More'")
      .addSlider((slider) =>
        slider
          .setLimits(10, 100, 10)
          .setValue(this.plugin.settings.cardsPerPage || 40)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.cardsPerPage = v;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Appearance" });
    new Setting(containerEl)
      .setName("Show ribbon icon")
      .setDesc("Show isHistory icon in the left ribbon")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showRibbonIcon).onChange(async (v) => {
          this.plugin.settings.showRibbonIcon = v;
          await this.plugin.saveSettings();
          this.plugin.updateRibbonIcon();
        })
      );

    const versionEl = containerEl.createEl("div", { cls: "cms-settings-version" });
    versionEl.createEl("span", { text: `isHistory CMS v${this.plugin.manifest.version}` });
    versionEl.appendText(` \u00B7 Schema v${this.plugin.settings._version}`);
  }
}

// ─── Settings Migration ───

export function migrateSettings(loaded: Record<string, any>): Record<string, any> {
  const version = loaded._version || 0;

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

  loaded._version = SETTINGS_VERSION;
  return loaded;
}
