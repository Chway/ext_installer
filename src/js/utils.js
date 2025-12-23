import { compare, validate } from "compare-versions";

export function getChromeVer() {
	const match = /Chrome\/([\d.]+)/.exec(navigator.userAgent);
	if (!match) {
		throw new Error(`Failed to find version (${navigator.userAgent}).`);
	}

	return match[1];
}

export function isUpToDate(verA, verB) {
	verA = verA?.trim();
	verB = verB?.trim();

	const verAValid = validate(verA);
	const verBValid = validate(verB);

	if (!verAValid && !verBValid) return false;
	if (verAValid && !verBValid) return true;
	if (!verAValid && verBValid) return false;

	return compare(verA, verB, ">=");
}

export async function storageGet(data) {
	const response = await navigator.locks.request("storage", () => {
		return data ? browser.storage.local.get(data) : browser.storage.local.get();
	});

	return response;
}

export async function storageSet(data) {
	const response = await navigator.locks.request("storage", () => {
		return browser.storage.local.set(data);
	});

	return response;
}

export async function writeBadge() {
	const { extensions = {} } = await storageGet("extensions");
	const updates = Object.values(extensions)
		.map((e) => e.newVer)
		.filter(Boolean);

	await chrome.action.setBadgeBackgroundColor({ color: "crimson" });
	await chrome.action.setBadgeTextColor({ color: "#fff" });

	await chrome.action.setBadgeText({ text: updates.length > 0 ? `${updates.length}` : "" });
}
