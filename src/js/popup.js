import { storageGet } from "./utils.js";

const elementState = new WeakMap();

const checkUpdates = document.querySelector(".check-updates");
const updatesContainer = document.querySelector(".updates");
const template = document.querySelector("#extension-template");
const noUpdates = updatesContainer.querySelector(".no-updates");

document.addEventListener("DOMContentLoaded", async () => {
	await main();
});

async function checkUpdatesCb(event) {
	const element = event.currentTarget;
	const state = elementState.get(element);
	if (state?.disabled) return;

	setElementDisable(element);

	try {
		const { ok } = await chrome.runtime.sendMessage({ action: "check-updates" });
		if (!ok) return;

		await writeList();
	} catch {
		//
	} finally {
		setElementDisable(element, true);
	}
}

async function main() {
	const elVersion = document.querySelector(".version");
	elVersion.textContent = `v${chrome.runtime.getManifest().version}`;

	checkUpdates.addEventListener("click", checkUpdatesCb);
	await writeList();
}

function setElementDisable(element, enable = false) {
	elementState.set(element, { disabled: !enable });
	element.classList.toggle("waiting", !enable);
}

async function updateExt(event) {
	const element = event.currentTarget;
	const state = elementState.get(element);
	if (state?.disabled) return;

	setElementDisable(element);

	try {
		const { id } = element.dataset;
		await chrome.runtime.sendMessage({ action: "update-ext", args: { id } });
	} catch {
		// pass
	} finally {
		setElementDisable(element, true);
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
			li.querySelector(".name").textContent = obj.shortName;
			li.querySelector(".name").title = obj.name;
			li.querySelector(".ver").textContent = `(${obj.newVer})`;

			if (obj.pending) {
				li.classList.add("pending");
			} else {
				li.addEventListener("click", updateExt);
			}

			updatesContainer.append(li);
		}
	}
}
