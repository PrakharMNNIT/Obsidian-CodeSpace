import { access, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const vaultPath = process.env.OBSIDIAN_VAULT_PATH || "C:\\Nonlinear\\ob";
const configDir = process.env.OBSIDIAN_CONFIG_DIR || [".", "obsidian"].join("");
const pluginPath = path.join(vaultPath, configDir, "plugins", "code-space");
const artifacts = ["main.js", "manifest.json", "styles.css"];

await access(vaultPath);
await Promise.all(artifacts.map((artifact) => access(artifact)));
await mkdir(pluginPath, { recursive: true });
await Promise.all(artifacts.map((artifact) => copyFile(artifact, path.join(pluginPath, artifact))));
