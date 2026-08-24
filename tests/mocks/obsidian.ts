export class FileSystemAdapter {}

export const Platform = {
	isDesktopApp: true,
	isWin: process.platform === "win32",
};

export function normalizePath(value: string): string {
	return value.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
}
