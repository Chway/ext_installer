import esbuild from "esbuild";
import copy from "esbuild-plugin-copy";
import { globby } from "globby";
import { constants } from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { zip } from "zip-a-folder";

// --- Utilities related to filesystem ---

async function buildChromePackage() {
	const chromeStart = process.hrtime();

	await fsPromises.mkdir("dist/chrome", { recursive: true });

	await fsPromises.cp("dist/build", "dist/chrome", { recursive: true });
	await fsPromises.copyFile("src/manifest.chrome.json", "dist/chrome/manifest.json");

	console.log(`Chrome build completed (${getElapsedTime(chromeStart)} s)`);
}

// --- Utilities related to timing ---

async function buildExtension(packageName, options) {
	await fsPromises.rm("dist", { force: true, recursive: true });

	await buildWithEsbuild();

	if (options.firefox) {
		const hasFirefox = await fileExists("src/manifest.firefox.json");

		if (hasFirefox) {
			await buildFirefoxPackage(packageName);
		} else {
			console.log("Skipping Firefox (no manifest)");
		}
	}

	if (options.chrome) {
		const hasChrome = await fileExists("src/manifest.chrome.json");

		if (hasChrome) {
			await buildChromePackage();
		} else {
			console.log("Skipping Chrome (no manifest)");
		}
	}

	await fsPromises.rm("dist/build", { force: true, recursive: true });
}

// --- Helpers related to build inputs ---

async function buildFirefoxPackage(packageName) {
	const firefoxStart = process.hrtime();

	await fsPromises.mkdir("dist/firefox", { recursive: true });
	await fsPromises.mkdir("dist/firefoxTemp", { recursive: true });
	await fsPromises.mkdir("dist/sourceTemp", { recursive: true });

	const sourceFiles = await globby(["**/*", "!**/*.pem"], { absolute: true, dot: true, gitignore: true });

	for (const file of sourceFiles) {
		const relative = path.relative(".", file);
		const dest = path.join("dist/sourceTemp", relative);
		await fsPromises.mkdir(path.dirname(dest), { recursive: true });
		await fsPromises.copyFile(file, dest);
	}

	await zip("dist/sourceTemp", `dist/firefox/source_${packageName}.zip`);

	await fsPromises.cp("dist/build", "dist/firefoxTemp", { recursive: true });
	await fsPromises.copyFile("src/manifest.firefox.json", "dist/firefoxTemp/manifest.json");

	await zip("dist/firefoxTemp", `dist/firefox/${packageName}.zip`);

	await fsPromises.rm("dist/sourceTemp", { force: true, recursive: true });
	await fsPromises.rm("dist/firefoxTemp", { force: true, recursive: true });

	console.log(`Firefox build completed (${getElapsedTime(firefoxStart)} s)`);
}

async function buildWithEsbuild() {
	await fsPromises.mkdir("dist/build", { recursive: true });

	const buildOptions = {
		banner: {
			js: `if (!Object.hasOwn(self, "browser")) { self.browser = self.chrome; }`,
		},
		bundle: true,
		define: { global: "window" },
		format: "iife",
		minify: true,
		outdir: "dist/build",
		platform: "browser",
		plugins: [
			copy({
				assets: [
					{ from: "src/css/*", to: "css" },
					{ from: "src/img/*", to: "img" },
					{ from: "src/*.html", to: "." },
				],
			}),
		],
		resolveExtensions: [".ts", ".js"],
		sourcemap: false,
		target: "esnext",
	};

	const entryFiles = await getEntryFiles();

	if (entryFiles.length === 0) {
		console.log("No JS entry files found — building static-only extension.");
	} else {
		buildOptions.entryPoints = getEntryPoints(entryFiles);

		const injectFiles = await getInjectFiles();
		if (injectFiles.length > 0) {
			buildOptions.inject = injectFiles;
		}
	}

	await esbuild.build(buildOptions);

	console.log("Entry files:", entryFiles);
	const entryPoints = getEntryPoints(entryFiles);
	buildOptions.entryPoints = entryPoints;

	const injectFiles = await getInjectFiles();

	if (injectFiles.length > 0) {
		console.log("Injects files:", injectFiles);
		buildOptions.inject = injectFiles;
	}

	await esbuild.build(buildOptions);
}

async function fileExists(filePath) {
	try {
		await fsPromises.access(filePath, constants.F_OK);

		return true;
	} catch {
		return false;
	}
}

// --- Core build step using esbuild ---

function getElapsedTime(startTime) {
	const [sec, nano] = process.hrtime(startTime);

	return (sec + nano / 1e9).toFixed(3);
}

// --- Packaging for Firefox ---

async function getEntryFiles() {
	const candidates = [
		"init.ts",
		"options.ts",
		"popup.ts",
		"injector.ts",
		"init.js",
		"options.js",
		"popup.js",
		"injector.js",
		"callbackRelay.js",
	];

	const baseDir = "src/js";
	const entries = [];

	for (const file of candidates) {
		const fullPath = path.join(baseDir, file);

		if (await fileExists(fullPath)) {
			entries.push(file);
		}
	}

	return entries;
}

// --- Packaging for Chrome ---

function getEntryPoints(entries) {
	const entryPoints = {};

	for (const file of entries) {
		const name = file.replace(/\.(ts|js)$/, "");
		entryPoints[`js/${name}`] = `src/js/${file}`;
	}

	return entryPoints;
}

// --- Orchestrator ---

async function getInjectFiles(dir = "injects") {
	try {
		const files = await fsPromises.readdir(dir);

		return files.filter((f) => f.endsWith(".js")).map((f) => path.join(dir, f));
	} catch {
		return [];
	}
}

// --- Main execution ---

async function main() {
	const start = process.hrtime();

	const args = process.argv.slice(2);
	const includeFirefox = args.includes("--firefox") || args.length === 0;
	const includeChrome = args.includes("--chrome") || args.length === 0;

	const pkgPath = fileURLToPath(new URL("package.json", import.meta.url));
	const pkgRaw = await fsPromises.readFile(pkgPath);
	const pkg = JSON.parse(pkgRaw.toString());

	try {
		await buildExtension(pkg.name, {
			chrome: includeChrome,
			firefox: includeFirefox,
		});

		console.log(`Build completed successfully (${getElapsedTime(start)} s)`);
	} catch (error) {
		console.error(`Build failed (${getElapsedTime(start)} s)\n`, error);

		// eslint-disable-next-line unicorn/no-process-exit
		process.exit(1);
	}
}

main().catch(() => {});
