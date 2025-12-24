import { checkForUpdates, installExt, setExtensionsState, updateExt } from "./extensions.js";
import { storageGet, storageSet, writeBadge } from "./utils.js";

export async function alarmsOnAlarmCb(alarm) {
	if (alarm.name === "check-updates") {
		await checkForUpdates();
	} else if (alarm.name.startsWith("timeout-dl-")) {
		const downloadId = Number(alarm.name.replace("timeout-dl-", ""));

		try {
			await chrome.downloads.cancel(downloadId);
			await chrome.downloads.erase({ id: downloadId }).catch(() => {});
		} catch (error) {
			console.warn(error.message);

			return;
		}
	}
}

export async function contextMenusOnClickedCb(info, _tab) {
	if (info.menuItemId === "install-ext") {
		installExt(info.pageUrl);
	}
}

export async function managementOnEnabledCb(info) {
	if (info.id === chrome.runtime.id) await setup({ context: "onEnabled" });
}

export async function managementOnInstalledCb(info) {
	await setExtensionsState(info.id, true);
}

export async function managementOnUninstalledCb(id) {
	const { extensions = {} } = await storageGet("extensions");
	if (extensions[id]) {
		delete extensions[id];
		await storageSet({ extensions });
	}
}

export function runtimeOnMessageCb(message, _sender, sendResponse) {
	async function handler() {
		switch (message.action) {
			case "check-updates": {
				try {
					await checkForUpdates();
					sendResponse({ err: null, ok: true });
				} catch (error) {
					sendResponse({ err: error.message, ok: false });
				}

				break;
			}

			case "update-ext": {
				try {
					await updateExt(message.args.id);
					sendResponse({ err: null, ok: true });
				} catch (error) {
					sendResponse({ err: error.message, ok: false });
				}

				break;
			}

			default: {
				sendResponse({ err: "No endpoint.", ok: false });

				break;
			}
		}
	}

	handler();

	return true;
}

export async function setup({ context } = {}) {
	if (context === "onInstalled") {
		chrome.contextMenus.create({
			contexts: ["page"],
			documentUrlPatterns: [
				"https://chromewebstore.google.com/detail/*",
				"https://microsoftedge.microsoft.com/addons/detail/*",
			],
			id: "install-ext",
			title: "Install extension",
		});
	}

	await setExtensionsState();
	await writeBadge();

	const checkUpdatesAlarm = await chrome.alarms.get("check-updates");
	if (!checkUpdatesAlarm) {
		await chrome.alarms.create("check-updates", { delayInMinutes: 1, periodInMinutes: 180 });
	}
}

export async function storageOnChangedCb(changes, _areaName) {
	const changesKeys = Object.keys(changes);
	if (changesKeys.includes("extensions")) {
		await writeBadge();
	}
}
