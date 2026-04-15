import { App, ButtonComponent, Modal, Notice } from "obsidian";
import CodeSpacePlugin from "./main";
import { t } from "./lang/helpers";

export class IgnoreManagerModal extends Modal {
	private plugin: CodeSpacePlugin;

	constructor(app: App, plugin: CodeSpacePlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen(): void {
		this.contentEl.addClass("ignore-manager-modal");
		this.setTitle(t("IGNORE_MANAGER_TITLE"));
		this.render();
	}

	onClose(): void {
		this.contentEl.removeClass("ignore-manager-modal");
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		const ignoredFiles = this.plugin.getIgnoredFiles();
		if (ignoredFiles.length === 0) {
			contentEl.createDiv({
				cls: "ignore-manager-empty",
				text: t("IGNORE_MANAGER_EMPTY")
			});
			return;
		}

		const listEl = contentEl.createDiv({ cls: "ignore-manager-list" });
		for (const path of ignoredFiles) {
			const itemEl = listEl.createDiv({ cls: "ignore-manager-item" });
			const infoEl = itemEl.createDiv({ cls: "ignore-manager-info" });
			infoEl.createDiv({
				cls: "ignore-manager-name",
				text: this.getFileName(path)
			});
			infoEl.createDiv({
				cls: "ignore-manager-path",
				text: this.getParentPath(path)
			});

			new ButtonComponent(itemEl)
				.setButtonText(t("IGNORE_MANAGER_REMOVE"))
				.setClass("ignore-manager-remove-button")
				.onClick(() => {
					void this.removeIgnoredFile(path);
				});
		}
	}

	private async removeIgnoredFile(path: string): Promise<void> {
		const changed = await this.plugin.unignoreFile(path);
		if (!changed) {
			return;
		}

		new Notice(t("NOTICE_UNIGNORE_SUCCESS"));
		this.render();
	}

	private getFileName(path: string): string {
		const segments = path.split("/");
		return segments[segments.length - 1] ?? path;
	}

	private getParentPath(path: string): string {
		const index = path.lastIndexOf("/");
		if (index === -1) {
			return "/";
		}

		const parentPath = path.slice(0, index);
		return parentPath || "/";
	}
}
