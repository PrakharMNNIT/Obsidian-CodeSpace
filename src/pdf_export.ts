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

type ResolvedCodeEmbed = {
	file: TFile;
	startLine: number;
	endLine: number;
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

const MARKDOWN_LANGUAGE_ALIASES: Record<string, string> = {
	htm: "html",
	xhtml: "html",
	mjs: "javascript",
	cjs: "javascript",
	json5: "json",
	jsonc: "json",
	vue: "javascript",
	svelte: "javascript",
	astro: "javascript",
	scss: "css",
	sass: "css",
	less: "css",
	yml: "yaml",
	urdf: "xml",
	xacro: "xml",
	svg: "xml",
	xsd: "xml",
	xsl: "xml",
	xslt: "xml",
	wsdl: "xml",
	plist: "xml",
	csproj: "xml",
	vcxproj: "xml",
	props: "xml",
	targets: "xml",
	config: "xml",
	toml: "yaml",
	ini: "yaml",
	cfg: "yaml",
	conf: "yaml",
};

const KNOWN_RENDERABLE_CODE_EXTENSIONS = new Set([
	"py",
	"c",
	"cpp",
	"h",
	"hpp",
	"cc",
	"cxx",
	"js",
	"ts",
	"jsx",
	"tsx",
	"json",
	"mjs",
	"cjs",
	"json5",
	"jsonc",
	"vue",
	"svelte",
	"astro",
	"html",
	"htm",
	"xhtml",
	"css",
	"scss",
	"sass",
	"less",
	"sql",
	"php",
	"rs",
	"java",
	"cs",
	"go",
	"yaml",
	"yml",
	"xml",
	"urdf",
	"xacro",
	"svg",
	"xsd",
	"xsl",
	"xslt",
	"wsdl",
	"plist",
	"csproj",
	"vcxproj",
	"props",
	"targets",
	"config",
	"toml",
	"ini",
	"cfg",
	"conf",
]);

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

function getMarkdownLanguage(ext: string): string {
	return MARKDOWN_LANGUAGE_ALIASES[ext] ?? ext;
}

function createFencedCodeBlock(content: string, ext: string): string {
	const markdownLanguage = getMarkdownLanguage(ext);
	const fenceMatches = content.match(/`+/g) ?? [];
	let longestFence = 0;
	for (const fence of fenceMatches) {
		longestFence = Math.max(longestFence, fence.length);
	}
	const fence = "`".repeat(Math.max(3, longestFence + 1));
	return `${fence}${markdownLanguage}\n${content}\n${fence}`;
}

function indentMultiline(text: string, indent: string): string {
	if (!indent) return text;
	return text
		.split("\n")
		.map((line) => `${indent}${line}`)
		.join("\n");
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

function collectAllowedExtensions(plugin: CodeSpacePlugin): Set<string> {
	const configured = plugin.settings.extensions
		.split(",")
		.map((value) => value.trim().toLowerCase())
		.filter(Boolean);

	return new Set([...configured, ...Array.from(KNOWN_RENDERABLE_CODE_EXTENSIONS)]);
}

function parseLineFragment(hashPart: string): { startLine: number; endLine: number } | null {
	if (!hashPart) {
		return { startLine: 0, endLine: 0 };
	}

	const rangeMatch = hashPart.match(/^L?(\d+)-L?(\d+)$/i);
	if (rangeMatch?.[1] && rangeMatch[2]) {
		const startLine = Math.max(1, Number.parseInt(rangeMatch[1], 10));
		const endLine = Math.max(startLine, Number.parseInt(rangeMatch[2], 10));
		return { startLine, endLine };
	}

	const singleMatch = hashPart.match(/^L?(\d+)$/i);
	if (singleMatch?.[1]) {
		const startLine = Math.max(1, Number.parseInt(singleMatch[1], 10));
		return { startLine, endLine: 0 };
	}

	return null;
}

function resolveCodeEmbedReference(
	plugin: CodeSpacePlugin,
	rawReference: string,
	sourcePath: string,
	allowedExtensions: Set<string>
): ResolvedCodeEmbed | null {
	const trimmed = rawReference.trim();
	if (!trimmed) return null;

	const pipeIndex = trimmed.indexOf("|");
	const reference = pipeIndex === -1 ? trimmed : trimmed.slice(0, pipeIndex).trim();
	if (!reference) return null;

	const hashIndex = reference.indexOf("#");
	const filePath = hashIndex === -1 ? reference : reference.slice(0, hashIndex).trim();
	const hashPart = hashIndex === -1 ? "" : reference.slice(hashIndex + 1).trim();
	if (!filePath) return null;
	const hadLeadingSlash = /^[\\/]/.test(filePath);

	const lineFragment = parseLineFragment(hashPart);
	if (hashPart && !lineFragment) {
		return null;
	}

	const normalizedFilePath = normalizePath(filePath.replace(/\\/g, "/")).trim();
	if (!normalizedFilePath) return null;

	let file: TFile | null = null;

	if (hadLeadingSlash) {
		const rootPath = normalizedFilePath.replace(/^\/+/, "");
		const exact = plugin.app.vault.getAbstractFileByPath(rootPath);
		file = exact instanceof TFile ? exact : null;
	}

	if (!file) {
		file = plugin.app.metadataCache.getFirstLinkpathDest(normalizedFilePath, sourcePath);
	}

	if (!file && normalizedFilePath.includes("/")) {
		const exact = plugin.app.vault.getAbstractFileByPath(normalizedFilePath);
		file = exact instanceof TFile ? exact : null;
	}

	if (!file && !normalizedFilePath.includes("/")) {
		const fileNameLower = normalizedFilePath.toLowerCase();
		file =
			plugin.app.vault.getFiles().find((candidate) => candidate.name === normalizedFilePath) ??
			plugin.app.vault.getFiles().find((candidate) => candidate.name.toLowerCase() === fileNameLower) ??
			null;
	}

	if (!file) return null;

	const ext = file.extension.toLowerCase();
	if (!allowedExtensions.has(ext)) {
		return null;
	}

	return {
		file,
		startLine: lineFragment?.startLine ?? 0,
		endLine: lineFragment?.endLine ?? 0,
	};
}

function sliceFileContent(content: string, startLine: number, endLine: number): string {
	if (startLine <= 1 && endLine <= 0) {
		return content;
	}

	const lines = content.split("\n");
	const clampedStart = Math.min(Math.max(startLine, 1), lines.length);
	const clampedEnd = endLine > 0 ? Math.min(Math.max(endLine, clampedStart), lines.length) : lines.length;
	return lines.slice(clampedStart - 1, clampedEnd).join("\n");
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

async function expandCodeEmbedsInMarkdown(
	plugin: CodeSpacePlugin,
	markdown: string,
	sourceFile: TFile
): Promise<string> {
	const allowedExtensions = collectAllowedExtensions(plugin);
	const lines = markdown.split("\n");
	const output: string[] = [];
	let activeFence: { marker: "`" | "~"; length: number } | null = null;

	for (const line of lines) {
		const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})/);
		if (fenceMatch?.[2]) {
			const marker = fenceMatch[2][0] as "`" | "~";
			const length = fenceMatch[2].length;

			if (!activeFence) {
				activeFence = { marker, length };
			} else if (activeFence.marker === marker && length >= activeFence.length) {
				activeFence = null;
			}

			output.push(line);
			continue;
		}

		if (activeFence) {
			output.push(line);
			continue;
		}

		const embedMatch = line.match(/^([>\s]*)!\[\[([^\]]+)\]\]\s*$/);
		if (!embedMatch?.[2]) {
			output.push(line);
			continue;
		}

		const indent = embedMatch[1] ?? "";
		const rawReference = embedMatch[2].trim();
		const resolved = resolveCodeEmbedReference(plugin, rawReference, sourceFile.path, allowedExtensions);
		if (!resolved) {
			output.push(line);
			continue;
		}

		const fullContent = await plugin.app.vault.read(resolved.file);
		const slicedContent = sliceFileContent(fullContent, resolved.startLine, resolved.endLine);
		const fencedCode = createFencedCodeBlock(slicedContent, resolved.file.extension.toLowerCase());
		output.push(indentMultiline(fencedCode, indent));
	}

	return output.join("\n");
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
