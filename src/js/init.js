import * as cb from "./callbacks.js";

chrome.runtime.onInstalled.addListener(() => cb.setup({ context: "onInstalled" }));
chrome.runtime.onStartup.addListener(() => cb.setup({ context: "onStartup" }));
chrome.runtime.onMessage.addListener(cb.runtimeOnMessageCb);

chrome.management.onInstalled.addListener(cb.managementOnInstalledCb);
chrome.management.onUninstalled.addListener(cb.managementOnUninstalledCb);
chrome.management.onEnabled.addListener(cb.managementOnEnabledCb);

chrome.contextMenus.onClicked.addListener(cb.contextMenusOnClickedCb);
chrome.storage.onChanged.addListener(cb.storageOnChangedCb);
chrome.alarms.onAlarm.addListener(cb.alarmsOnAlarmCb);
