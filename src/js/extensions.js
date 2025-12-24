import { compare } from "compare-versions";

import { getChromeVer, isUpToDate, storageGet, storageSet } from "./utils.js";

const BASE_URLS = {
	"chromewebstore.google.com": "https://clients2.google.com/service/update2/crx",
	"microsoftedge.microsoft.com": "https://edge.microsoft.com/extensionwebstorebase/v1/crx",
};

export async function checkForUpdates() {
	const { extensions = {} } = await storageGet("extensions");

	for (const [id, obj] of Object.entries(extensions)) {
		if (!obj.updateUrl || (await getStateFor(id)) !== "idling") continue;

		try {
			const url = generateUrl("update", { id, updateUrl: obj.updateUrl, version: obj.version });
			const response = await fetch(url);
			const text = await response.text();

			const matchUpdateCheck = text.match(/(<updatecheck.+\/>)/);
			if (!matchUpdateCheck) {
				throw new Error("Failed to find updatecheck.");
			}

			const updateCheck = matchUpdateCheck[1];
			const matchCodebase = updateCheck.match(/codebase=['"]([^'"]+)/);
			const matchVersion = updateCheck.match(/version=['"]([^'"]+)/);
			let codebase = matchCodebase ? matchCodebase[1].trim() : null;
			let version = matchVersion ? matchVersion[1].trim() : null;

			if (codebase) {
				try {
					new URL(codebase);
				} catch {
					codebase = null;
				}
			}

			if (version && version.length === 0) {
				version = null;
			}

			const hasUpdate = version && codebase;
			let localIsUTD = true;

			if (hasUpdate) {
				localIsUTD = obj.version === version || isUpToDate(obj.version, version);
			}

			obj.newUrl = localIsUTD ? null : codebase;
			obj.newVer = localIsUTD ? null : version;
			obj.lastCheckStatus = 0;
		} catch (error) {
			console.warn(error.message);
			obj.lastCheckStatus = 1;
		} finally {
			obj.lastCheck = Date.now();
		}
	}

	await storageSet({ extensions });
}

export async function downloadExt(url) {
	return new Promise((resolve, reject) => {
		let downloadId;

		function dlOnChangedCb(downloadDelta) {
			const { id, state } = downloadDelta;
			if (id !== downloadId || !state?.current) return;

			if (state.current === "complete" || state.current === "interrupted") {
				chrome.downloads.onChanged.removeListener(dlOnChangedCb);
				chrome.alarms.clear(`timeout-dl-${downloadId}`).catch(() => {});
				chrome.downloads.erase({ id: downloadId }).catch(() => {});
			}

			if (state.current === "complete") {
				resolve();
			} else if (state.current === "interrupted") {
				reject(new Error("Download interrupted."));
			}
		}

		chrome.downloads.onChanged.addListener(dlOnChangedCb);
		chrome.downloads
			.download({ saveAs: false, url })
			.then((id) => {
				downloadId = id;
				if (!downloadId) throw new Error("Download did not return an Id.");

				return chrome.alarms.create(`timeout-dl-${downloadId}`, { delayInMinutes: 1 });
			})
			.catch((error) => {
				chrome.downloads.onChanged.removeListener(dlOnChangedCb);

				if (downloadId) {
					chrome.downloads.erase({ id: downloadId }).catch(() => {});
				}

				console.warn(error.message);
				reject(error);
			});
	});
}

export function generateUrl(action = "install", { hostname, id, updateUrl, version } = {}) {
	const chromeVersion = getChromeVer();

	switch (action) {
		case "install": {
			if (!hostname || !id) {
				throw new Error('"hostname" and "id" required for action "install".');
			}

			const baseUrl = BASE_URLS[hostname];
			if (!baseUrl) {
				throw new Error(`"hostname" (${hostname}) not supported.`);
			}

			return `${baseUrl}?response=redirect&acceptformat=crx2,crx3&prodversion=${chromeVersion}&x=id%3D${id}%26installsource%3Dondemand%26uc`;
		}

		case "update": {
			if (!updateUrl || !id || !version) {
				throw new Error('"updateURL", "id" and "version" required for action "update".');
			}

			return `${updateUrl}?response=updatecheck&acceptformat=crx2,crx3&prodversion=${chromeVersion}&x=id%3D${id}%26v%3D${version}%26uc`;
		}

		default: {
			throw new Error('"action" is not "install" or "update".');
		}
	}
}

export function getExtInfosFromUrl(url) {
	const { hostname, pathname } = new URL(url);
	const match = pathname.match(/^(?:\/addons)?\/detail\/([^/]+)\/([^/]+)/);
	if (!match) {
		throw new Error("Failed to find infos from URL.");
	}

	return {
		hostname,
		id: decodeURIComponent(match[2]),
		name: decodeURIComponent(match[1]),
	};
}

export async function installExt(url) {
	const { hostname, id } = getExtInfosFromUrl(url);
	const downloadUrl = generateUrl("install", { hostname, id });
	await downloadExt(downloadUrl);
}

export async function setExtensionsState(id, isInstall = false) {
	let exts;
	try {
		exts = id ? [await chrome.management.get(id)] : await chrome.management.getAll();
	} catch (error) {
		console.warn(error.message);

		return;
	}

	if (id && isInstall) {
		await chrome.alarms.clear(`timeout-upd-${id}`);
		await setStateFor(id, "idling");
	}

	const { extensions = {} } = await storageGet("extensions");
	const tempExtensions = {};

	for (const ext of exts) {
		if (ext.type !== "extension") continue;

		if ((await getStateFor(ext.id)) === null) {
			await setStateFor(ext.id, "idling");
		}

		try {
			const newVer = extensions[ext.id]?.newVer ?? null;
			const newUrl = extensions[ext.id]?.newUrl ?? null;
			const lastCheck = extensions[ext.id]?.lastCheck ?? 0;
			const lastCheckStatus = extensions[ext.id]?.lastCheckStatus ?? 2; // 0: ok, 1: fail, 2: never
			let localIsUTD = true;

			if (newVer) {
				localIsUTD = ext.version === newVer || isUpToDate(ext.version, newVer);
			}

			tempExtensions[ext.id] = {
				id: ext.id,
				lastCheck,
				lastCheckStatus,
				name: ext.name,
				newUrl: localIsUTD ? null : newUrl,
				newVer: localIsUTD ? null : newVer,
				shortName: ext.shortName,
				updateUrl: ext.updateUrl ?? null,
				version: ext.version,
			};
		} catch (error) {
			console.warn(`Failed to process extension "${ext.name}" (${ext.id}): ${error.message}`);
		}
	}

	await storageSet({ extensions: id ? { ...extensions, ...tempExtensions } : tempExtensions });
}

export async function getStateFor(id) {
	return await navigator.locks.request("states", async () => {
		const { states = {} } = await storageGet("states");

		return states[id] ?? null;
	});
}

export async function setStateFor(id, state) {
	return await navigator.locks.request("states", async () => {
		const { states = {} } = await storageGet("states");

		return await storageSet({ states: { ...states, [id]: state } });
	});
}

export async function remStateFor(id) {
	return await navigator.locks.request("states", async () => {
		const { states = {} } = await storageGet("states");
		delete states[id];

		return await storageSet({ states });
	});
}

export async function updateExt(id) {
	let hasInstalled = false;
	const { extensions = {} } = await storageGet("extensions");
	if (!extensions[id]) {
		throw new Error(`Id "${id}" not in storage.`);
	}

	if ((await getStateFor(id)) === "downloading") {
		throw new Error(`Id "${id}" is already downloading.`);
	}

	try {
		if (extensions[id].newUrl) {
			await setStateFor(id, "downloading");
			await downloadExt(extensions[id].newUrl);

			await setStateFor(id, "updating");

			hasInstalled = await versionMatch(id, extensions[id].newVer);
		} else {
			throw new Error(`No update found for "${extensions[id].shortName}".`);
		}
	} catch (error) {
		console.warn(error.message);

		if ((await getStateFor(id)) === "downloading") {
			await setStateFor(id, "idling");
		}
	} finally {
		// the user might cancel or the browser can take time to update the extension, give it 2 minutes and reset the state
		if (!hasInstalled) {
			await chrome.alarms.create(`timeout-upd-${id}`, { delayInMinutes: 2 });
		}
	}
}

async function versionMatch(id, version) {
	try {
		const ext = await chrome.management.get(id);

		return ext.version === version || compare(ext.version, version, "=");
	} catch (error) {
		console.warn(error.message);

		return false;
	}
}
