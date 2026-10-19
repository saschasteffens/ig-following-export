"use strict";
const core = globalThis.FollowingExportCore;
const $ = id => document.getElementById(id);
let tabId = null;
let connected = false;
let busy = false;
let lastStatus = null;

function showError(message) {
  $("status").textContent = message;
}

async function send(command) {
  if (!tabId) throw new Error("Open an Instagram tab first, then reopen this extension.");
  return chrome.tabs.sendMessage(tabId, { app: "following-export", command });
}

function render(state) {
  if (state.error) {
    if (lastStatus) render(lastStatus);
    showError(state.error);
    return;
  }
  lastStatus = state;
  $("count").textContent = state.count.toLocaleString();
  $("source").textContent = state.source ? `@${state.source}` : "READY WHEN YOU ARE";
  $("badge").textContent = ({ idle: "Idle", collecting: "Collecting", paused: "Paused", finished: "Review count", error: "Needs attention" })[state.status] || state.status;
  $("status").textContent = state.message;
  $("start").disabled = !connected || state.status === "collecting" || busy;
  $("start").textContent = state.count ? "Continue scanning" : "Start collecting";
  $("stop").disabled = state.status !== "collecting" || busy;
  $("download").disabled = !state.count || busy;
  $("clear").disabled = !state.count || busy;
}

async function action(command) {
  if (busy) return;
  busy = true;
  if (lastStatus) render(lastStatus);
  try {
    const result = await send(command);
    busy = false;
    render(result);
  } catch {
    busy = false;
    connected = false;
    $("start").disabled = true;
    $("stop").disabled = true;
    $("download").disabled = true;
    $("clear").disabled = true;
    showError("The Instagram tab changed or closed. Reopen this extension on the Instagram tab.");
  }
}

$("profile-form").addEventListener("submit", async event => {
  event.preventDefault();
  const name = core.username($("username").value);
  if (!name) { showError("Enter an Instagram username, such as natgeo (without a link)."); return; }
  try {
    await chrome.tabs.create({ url: `https://www.instagram.com/${name}/` });
    window.close();
  } catch { showError("Could not open Instagram. Try opening the profile in a new tab yourself."); }
});

$("start").addEventListener("click", () => action("start"));
$("stop").addEventListener("click", () => action("stop"));
$("clear").addEventListener("click", () => action("clear"));
$("download").addEventListener("click", async () => {
  try {
    const result = await send("export");
    if (result.error) throw new Error(result.error);
    if (!result.accounts?.length) { showError("No accounts have been collected yet."); return; }
    const url = URL.createObjectURL(new Blob([core.toCSV(result.accounts, result.source)], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${result.source}-following-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    // The browser retains the URL until the popup closes; don't revoke it during download.
  } catch { showError("Could not download. Reopen the extension on the Instagram tab and try again."); }
});

async function connect() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !core.instagramURL(tab.url)) {
      showError("Open an Instagram profile above, then click its Following count.");
      return;
    }
    tabId = tab.id;
    $("username").value = core.followingFromURL(tab.url) || core.profileFromURL(tab.url) || "";
    await chrome.scripting.executeScript({ target: { tabId }, files: ["core.js", "collector.js"] });
    connected = true;
    render(await send("status"));
    setInterval(async () => {
      if (busy || !connected) return;
      try {
        // Keep a useful start error visible until the user takes another action.
        const result = await send("status");
        if (result.status === "collecting" || lastStatus?.status === "collecting") render(result);
      } catch {
        connected = false;
        $("start").disabled = true;
        $("stop").disabled = true;
        $("download").disabled = true;
        $("clear").disabled = true;
        showError("The Instagram tab is no longer available. Reopen this extension on Instagram.");
      }
    }, 1000);
  } catch {
    showError("Could not connect to this tab. Refresh Instagram, then reopen the extension.");
  }
}
connect();
