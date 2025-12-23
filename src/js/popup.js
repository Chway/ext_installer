import { storageGet } from "lib-helpers";

const updatesContainer = document.querySelector(".updates");
const template = document.querySelector("#extension-template");
const noUpdates = updatesContainer.querySelector(".no-updates");

document.addEventListener("DOMContentLoaded", async () => {
	await main();
});

async function main() {
	const elVersion = document.querySelector(".version");
	elVersion.textContent = chrome.runtime.getManifest().version;

	await writeList();
}

async function updateExt(event) {
	const element = event.currentTarget;
	element.style.pointerEvents = "none";
	element.style.cursor = "wait";

	try {
		const { id } = element.dataset;
		await chrome.runtime.sendMessage({ action: "update-ext", args: { id } });
	} catch {
		// pass
	} finally {
		element.style.pointerEvents = "auto";
		element.style.cursor = "pointer";
	}
}

async function writeList() {
	const { extensions = {} } = await storageGet("extensions");
	const updatesArray = Object.values(extensions)
		.filter((obj) => obj.newVer)
		.toSorted((a, b) => a.shortName.localeCompare(b.shortName));

	for (const li of updatesContainer.querySelectorAll("li:not(.no-updates)")) li.remove();

	if (updatesArray.length === 0) {
		noUpdates.style.display = "block";
	} else {
		noUpdates.style.display = "none";

		for (const obj of updatesArray) {
			const clone = template.content.cloneNode(true);
			const li = clone.querySelector("li");
			li.dataset.id = obj.id;
			li.addEventListener("click", updateExt);
			li.querySelector(".name").textContent = obj.shortName;
			li.querySelector(".name").title = obj.name;
			li.querySelector(".ver").textContent = `(${obj.newVer})`;

			updatesContainer.append(li);
		}
	}
}
