import {
	App,
	Component,
	FileSystemAdapter,
	MarkdownRenderer,
	MarkdownView,
	Notice,
	Platform,
	TFile,
	normalizePath,
} from "obsidian";
import { expandCodeEmbedsInMarkdown } from "./code_embed_markdown";
import type CodeSpacePlugin from "./main";
import { t } from "./lang/helpers";

type ElectronSaveDialogResult = {
	canceled: boolean;
	filePath?: string;
};

type ElectronDialog = {
	showSaveDialog: (options: {
		title?: string;
		buttonLabel?: string;
		defaultPath?: string;
		filters?: Array<{ name: string; extensions: string[] }>;
	}) => Promise<ElectronSaveDialogResult>;
};

type ElectronBrowserWindow = {
	loadURL: (url: string) => Promise<void> | void;
	destroy: () => void;
	removeMenu?: () => void;
	setMenuBarVisibility?: (visible: boolean) => void;
	webContents: {
		once: (event: string, callback: (...args: unknown[]) => void) => void;
		printToPDF: (options: Record<string, unknown>) => Promise<Uint8Array | ArrayBuffer>;
	};
};

type ElectronModule = {
	dialog?: ElectronDialog;
	remote?: {
		dialog?: ElectronDialog;
		BrowserWindow?: new (options: Record<string, unknown>) => ElectronBrowserWindow;
	};
	BrowserWindow?: new (options: Record<string, unknown>) => ElectronBrowserWindow;
};

type FsPromisesModule = {
	mkdir: (path: string, options: { recursive: boolean }) => Promise<void>;
	unlink: (path: string) => Promise<void>;
	writeFile: (path: string, data: Uint8Array | string, encoding?: string) => Promise<void>;
};

type OsModule = {
	tmpdir: () => string;
};

type PathModule = {
	join: (...parts: string[]) => string;
	dirname: (path: string) => string;
};

type UrlModule = {
	pathToFileURL: (path: string) => { href: string };
};

const LOCAL_IMAGE_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"svg",
	"bmp",
	"ico",
	"avif",
	"tif",
	"tiff",
]);

const IMAGE_MIME_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	bmp: "image/bmp",
	ico: "image/x-icon",
	avif: "image/avif",
	tif: "image/tiff",
	tiff: "image/tiff",
};


function getNodeModule<T>(name: string): T {
	const requireFn = (window as Window & { require?: (module: string) => unknown }).require;
	if (!requireFn) {
		throw new Error("Node modules unavailable");
	}
	return requireFn(name) as T;
}

function getElectron(): ElectronModule {
	return getNodeModule<ElectronModule>("electron");
}

function getFs(): FsPromisesModule {
	return getNodeModule<FsPromisesModule>("fs/promises");
}

function getOs(): OsModule {
	return getNodeModule<OsModule>("os");
}

function getPath(): PathModule {
	return getNodeModule<PathModule>("path");
}

function getUrl(): UrlModule {
	return getNodeModule<UrlModule>("url");
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function getVaultBasePath(app: App): string | null {
	const adapter = app.vault.adapter;
	return adapter instanceof FileSystemAdapter
		? adapter.getBasePath()
		: (adapter as { getBasePath?: () => string }).getBasePath?.() ?? null;
}

function absoluteFsPathToVaultPath(app: App, absolutePath: string): string {
	const basePath = getVaultBasePath(app);
	if (!basePath) return "";

	const normalizedBasePath = basePath.replace(/\\/g, "/").replace(/\/+$/, "");
	const normalizedAbsolutePath = absolutePath
		.replace(/\\/g, "/")
		.replace(/^\/([A-Za-z]:\/)/, "$1");

	const baseLower = normalizedBasePath.toLowerCase();
	const absoluteLower = normalizedAbsolutePath.toLowerCase();

	if (absoluteLower === baseLower) {
		return "";
	}

	if (absoluteLower.startsWith(`${baseLower}/`)) {
		return normalizedAbsolutePath.slice(normalizedBasePath.length + 1);
	}

	return "";
}

function normalizeVaultReference(app: App, rawReference: string): string {
	const trimmed = rawReference.trim();
	if (!trimmed) return "";

	if (/^(data|blob):/i.test(trimmed) || /^https?:\/\//i.test(trimmed)) {
		return "";
	}

	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
		try {
			const parsed = new URL(trimmed);
			if (parsed.protocol === "obsidian:" || parsed.protocol === "app:") {
				const pathParam = parsed.searchParams.get("path") ?? parsed.searchParams.get("file");
				if (pathParam) {
					return normalizePath(decodeURIComponent(pathParam).replace(/\\/g, "/")).replace(/^\/+/, "");
				}
			}

			if (parsed.protocol === "file:") {
				const vaultRelativePath = absoluteFsPathToVaultPath(app, decodeURIComponent(parsed.pathname));
				return normalizePath(vaultRelativePath).replace(/^\/+/, "");
			}
		} catch {
			return "";
		}

		return "";
	}

	return normalizePath(trimmed.replace(/\\/g, "/")).replace(/^\/+/, "");
}

function resolveVaultFileReference(app: App, rawReference: string, sourcePath: string): TFile | null {
	const cleanedReference = rawReference
		.trim()
		.replace(/^!?\[\[/, "")
		.replace(/\]\]$/, "");

	const pipeIndex = cleanedReference.indexOf("|");
	const referenceWithoutAlias =
		pipeIndex === -1 ? cleanedReference : cleanedReference.slice(0, pipeIndex).trim();
	const hashIndex = referenceWithoutAlias.indexOf("#");
	const fileReference =
		hashIndex === -1 ? referenceWithoutAlias : referenceWithoutAlias.slice(0, hashIndex).trim();
	if (!fileReference) return null;

	const normalizedReference = normalizeVaultReference(app, fileReference);
	if (!normalizedReference) return null;

	let file = app.metadataCache.getFirstLinkpathDest(normalizedReference, sourcePath);
	if (!file) {
		const exact = app.vault.getAbstractFileByPath(normalizedReference);
		file = exact instanceof TFile ? exact : null;
	}

	if (!file && !normalizedReference.includes("/")) {
		const lowered = normalizedReference.toLowerCase();
		file =
			app.vault.getFiles().find((candidate) => candidate.name === normalizedReference) ??
			app.vault.getFiles().find((candidate) => candidate.name.toLowerCase() === lowered) ??
			null;
	}

	return file;
}

function getImageMimeType(file: TFile): string {
	return IMAGE_MIME_TYPES[file.extension.toLowerCase()] ?? "application/octet-stream";
}

function toDataUrl(binary: ArrayBuffer, mimeType: string): string {
	const bytes = new Uint8Array(binary);
	let binaryString = "";
	const chunkSize = 0x8000;

	for (let index = 0; index < bytes.length; index += chunkSize) {
		const chunk = bytes.subarray(index, Math.min(index + chunkSize, bytes.length));
		binaryString += String.fromCharCode(...chunk);
	}

	return `data:${mimeType};base64,${window.btoa(binaryString)}`;
}

function extractImageReference(imageEl: HTMLImageElement): string {
	const internalEmbed = imageEl.closest<HTMLElement>(".internal-embed, .image-embed, .media-embed");
	const candidates = [
		internalEmbed?.getAttribute("src"),
		internalEmbed?.getAttribute("data-path"),
		imageEl.getAttribute("src"),
		imageEl.currentSrc,
	];

	for (const candidate of candidates) {
		const value = candidate?.trim();
		if (value) {
			return value;
		}
	}

	return "";
}

async function inlineLocalImages(app: App, container: HTMLElement, sourcePath: string): Promise<void> {
	const images = Array.from(container.querySelectorAll("img"));

	for (const imageEl of images) {
		const rawReference = extractImageReference(imageEl);
		if (!rawReference) continue;

		const file = resolveVaultFileReference(app, rawReference, sourcePath);
		if (!file || !LOCAL_IMAGE_EXTENSIONS.has(file.extension.toLowerCase())) {
			continue;
		}

		try {
			const binary = await app.vault.readBinary(file);
			imageEl.setAttribute("src", toDataUrl(binary, getImageMimeType(file)));
			imageEl.removeAttribute("srcset");
			imageEl.setAttribute("loading", "eager");
			imageEl.setAttribute("decoding", "sync");

			if (!imageEl.getAttribute("alt")) {
				imageEl.setAttribute("alt", file.basename);
			}
		} catch (error) {
			console.warn("Code Space: Failed to inline image for PDF export", file.path, error);
		}
	}
}

async function renderMarkdownToHtml(app: App, markdown: string, sourcePath: string): Promise<string> {
	const host = document.createElement("div");
	host.className = "markdown-rendered markdown-preview-view code-space-pdf-export-root";
	document.body.appendChild(host);

	const component = new Component();
	component.load();

	try {
		await MarkdownRenderer.render(app, markdown, host, sourcePath, component);
		await wait(80);
		await inlineLocalImages(app, host, sourcePath);
		return host.innerHTML;
	} finally {
		component.unload();
		host.remove();
	}
}

function collectHeadMarkup(doc: Document): string {
	return Array.from(doc.head.querySelectorAll("style, link[rel='stylesheet']"))
		.map((node) => node.outerHTML)
		.join("\n");
}

function buildExportHtml(title: string, renderedHtml: string): string {
	const headMarkup = collectHeadMarkup(document);
	const bodyClassName = `${document.body.className} code-space-pdf-export-body`;

	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
${headMarkup}
<style>
@page {
	size: auto;
	margin: 16mm;
}

html,
body {
	background: var(--background-primary, #ffffff) !important;
}

body.code-space-pdf-export-body {
	margin: 0;
	padding: 0;
	color: var(--text-normal, #1f2937);
}

.code-space-pdf-export-page {
	padding: 0;
	color: var(--text-normal, #1f2937);
}

.code-space-pdf-export-page .copy-code-button,
.code-space-pdf-export-page .metadata-container,
.code-space-pdf-export-page .internal-embed .markdown-embed-title {
	display: none !important;
}

.code-space-pdf-export-page .internal-embed,
.code-space-pdf-export-page .image-embed,
.code-space-pdf-export-page figure {
	page-break-inside: avoid;
}

.code-space-pdf-export-page img {
	display: block;
	max-width: 100%;
	height: auto;
	margin: 1rem auto;
	border-radius: 10px;
	box-shadow: 0 0 0 1px var(--background-modifier-border, rgba(15, 23, 42, 0.12));
	background: var(--background-primary, #ffffff);
	page-break-inside: avoid;
}

.code-space-pdf-export-page pre {
	white-space: pre-wrap;
	word-break: break-word;
	margin: 1rem 0;
	padding: 14px 16px;
	background: var(--background-secondary, #f6f7f9);
	border: 1px solid var(--background-modifier-border, #d8dde6);
	border-radius: 12px;
	box-shadow: 0 1px 0 rgba(15, 23, 42, 0.04);
	page-break-inside: avoid;
}

.code-space-pdf-export-page pre code {
	white-space: inherit;
	word-break: inherit;
	background: transparent;
	padding: 0;
}
</style>
</head>
<body class="${escapeHtml(bodyClassName)}">
<div class="markdown-preview-view markdown-rendered code-space-pdf-export-page">
${renderedHtml}
</div>
</body>
</html>`;
}

async function waitForWindowLoad(browserWindow: ElectronBrowserWindow, url: string): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		let settled = false;

		browserWindow.webContents.once("did-finish-load", () => {
			if (settled) return;
			settled = true;
			resolve();
		});

		browserWindow.webContents.once("did-fail-load", (...args) => {
			if (settled) return;
			settled = true;
			const errorDescription = typeof args[2] === "string" ? args[2] : "Failed to load export document";
			reject(new Error(errorDescription));
		});

		void Promise.resolve(browserWindow.loadURL(url)).catch((error) => {
			if (settled) return;
			settled = true;
			reject(error instanceof Error ? error : new Error(String(error)));
		});
	});
}

function toUint8Array(data: Uint8Array | ArrayBuffer): Uint8Array {
	return data instanceof Uint8Array ? data : new Uint8Array(data);
}

async function printHtmlToPdf(html: string, outputPath: string): Promise<void> {
	const fs = getFs();
	const os = getOs();
	const path = getPath();
	const url = getUrl();
	const electron = getElectron();

	const tempDir = path.join(os.tmpdir(), "obsidian-code-space");
	await fs.mkdir(tempDir, { recursive: true });

	const tempHtmlPath = path.join(tempDir, `code-space-export-${Date.now()}.html`);
	await fs.writeFile(tempHtmlPath, html, "utf8");

	const browserWindowConstructor = electron.remote?.BrowserWindow ?? electron.BrowserWindow;
	if (!browserWindowConstructor) {
		try {
			await fs.unlink(tempHtmlPath);
		} catch {
			// Ignore cleanup failures.
		}
		throw new Error("Embedded PDF exporter unavailable");
	}

	let browserWindow: ElectronBrowserWindow | null = null;

	try {
		browserWindow = new browserWindowConstructor({
			show: false,
			width: 1280,
			height: 1024,
		});

		browserWindow.removeMenu?.();
		browserWindow.setMenuBarVisibility?.(false);

		await waitForWindowLoad(browserWindow, url.pathToFileURL(tempHtmlPath).href);
		const pdfData = await browserWindow.webContents.printToPDF({
			printBackground: true,
			preferCSSPageSize: true,
		});
		await fs.writeFile(outputPath, toUint8Array(pdfData));
	} finally {
		browserWindow?.destroy();
		try {
			await fs.unlink(tempHtmlPath);
		} catch {
			// Ignore cleanup failures.
		}
	}
}

function getDefaultPdfPath(app: App, file: TFile): string {
	const path = getPath();
	const adapter = app.vault.adapter;

	const basePath =
		adapter instanceof FileSystemAdapter
			? adapter.getBasePath()
			: (adapter as { getBasePath?: () => string }).getBasePath?.();

	if (!basePath) {
		return `${file.basename}.pdf`;
	}

	const parentPath = file.parent?.path ? file.parent.path.split("/").filter(Boolean) : [];
	return path.join(basePath, ...parentPath, `${file.basename}.pdf`);
}

async function chooseOutputPath(app: App, file: TFile): Promise<string | null> {
	const electron = getElectron();
	const dialog = electron.dialog ?? electron.remote?.dialog;
	if (!dialog) {
		throw new Error(t("NOTICE_EXPORT_PDF_DIALOG_UNAVAILABLE"));
	}

	const result = await dialog.showSaveDialog({
		title: t("CMD_EXPORT_CURRENT_NOTE_PDF"),
		buttonLabel: "PDF",
		defaultPath: getDefaultPdfPath(app, file),
		filters: [{ name: "PDF", extensions: ["pdf"] }],
	});

	if (result.canceled || !result.filePath) {
		return null;
	}

	return result.filePath.toLowerCase().endsWith(".pdf") ? result.filePath : `${result.filePath}.pdf`;
}

export async function exportCurrentNoteToPdf(plugin: CodeSpacePlugin): Promise<void> {
	if (!Platform.isDesktopApp) {
		new Notice(t("NOTICE_EXPORT_PDF_DESKTOP_ONLY"));
		return;
	}

	const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
	const sourceFile = activeView?.file;
	if (!activeView || !sourceFile || sourceFile.extension.toLowerCase() !== "md") {
		new Notice(t("NOTICE_EXPORT_PDF_NO_NOTE"));
		return;
	}

	try {
		const outputPath = await chooseOutputPath(plugin.app, sourceFile);
		if (!outputPath) {
			return;
		}

		new Notice(t("NOTICE_EXPORT_PDF_STARTED"), 2000);

		const markdown = activeView.getViewData();
		const expandedMarkdown = await expandCodeEmbedsInMarkdown(plugin, markdown, sourceFile);
		const renderedHtml = await renderMarkdownToHtml(plugin.app, expandedMarkdown, sourceFile.path);
		const exportHtml = buildExportHtml(sourceFile.basename, renderedHtml);

		await printHtmlToPdf(exportHtml, outputPath);
		new Notice(`${t("NOTICE_EXPORT_PDF_SUCCESS")} ${outputPath}`, 5000);
	} catch (error) {
		console.error("Code Space: Failed to export PDF", error);
		new Notice(`${t("NOTICE_EXPORT_PDF_FAILED")}: ${String(error)}`, 7000);
	}
}
