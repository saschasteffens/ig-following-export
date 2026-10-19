(() => {
  "use strict";
  if (globalThis.__followingExporter) return;
  globalThis.__followingExporter = true;

  const core = globalThis.FollowingExportCore;
  const accounts = new Map();
  const state = { status: "idle", source: "", message: "Open a profile’s Following list to begin.", startedAt: null };
  let timer = null;
  let observer = null;
  let dialog = null;
  let stagnant = 0;
  let rounds = 0;
  let lastCount = 0;

  function visible(element) {
    return element instanceof HTMLElement && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
  }

  function findDialog() {
    return [...document.querySelectorAll('[role="dialog"]')].filter(visible).at(-1) || null;
  }

  function rowFor(anchor) {
    for (let element = anchor.parentElement; element && element !== dialog; element = element.parentElement) {
      if (!element.querySelector('button, [role="button"]')) continue;
      const names = new Set([...element.querySelectorAll('a[href]')].map(a => core.profileFromURL(a.href)).filter(Boolean));
      if (names.size === 1) return element;
      // A container with several profiles is not an account row.
      if (names.size > 1) return null;
    }
    return null;
  }

  function collect() {
    if (!dialog || core.followingFromURL(location.href) !== state.source) return;
    // Restrict to the list's scroll container to exclude suggested accounts elsewhere.
    const scope = scroller();
    for (const anchor of scope.querySelectorAll('a[href]')) {
      const name = core.profileFromURL(anchor.href);
      if (!name || !visible(anchor)) continue;
      const row = rowFor(anchor);
      if (!row) continue;
      const labels = [...row.querySelectorAll('span')]
        .filter(span => !span.children.length && !span.closest('button, [role="button"], a'))
        .map(span => span.textContent.trim())
        .filter(text => text && text.toLowerCase() !== name && !/^(verified|followed by)\b/i.test(text));
      const existing = accounts.get(name);
      accounts.set(name, {
        username: name,
        displayName: existing?.displayName || labels[0] || "",
        collectedAt: existing?.collectedAt || new Date().toISOString()
      });
    }
  }

  function scroller() {
    const candidates = [dialog, ...dialog.querySelectorAll('div, ul')].filter(element => {
      const style = getComputedStyle(element);
      return visible(element) && /auto|scroll/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 4;
    });
    // Choose the scrolling element containing the most account links.
    return candidates.sort((a, b) => b.querySelectorAll('a[href]').length - a.querySelectorAll('a[href]').length)[0] || dialog;
  }

  function finish(status, message) {
    clearTimeout(timer);
    observer?.disconnect();
    timer = null;
    observer = null;
    state.status = status;
    state.message = message;
  }

  function tick() {
    if (state.status !== "collecting") return;
    if (core.followingFromURL(location.href) !== state.source || !dialog.isConnected || !visible(dialog)) {
      finish("paused", "The list was closed or the page changed. Your collected accounts are still available to download.");
      return;
    }
    const warning = [...dialog.querySelectorAll('[role="alert"]')].find(visible);
    if (warning) {
      finish("paused", "Instagram displayed a notice. Review it before continuing. You can download the accounts already collected.");
      return;
    }
    collect();
    stagnant = accounts.size === lastCount ? stagnant + 1 : 0;
    lastCount = accounts.size;
    rounds += 1;
    if (stagnant >= 12 || rounds >= 400) {
      finish(accounts.size ? "finished" : "error", accounts.size
        ? "Scrolling stopped. Check the count against Instagram: it may limit the list. You can continue scanning or download these accounts."
        : "No account rows could be read. Make sure the Following list is open. Instagram’s layout may have changed.");
      return;
    }
    const scroll = scroller();
    scroll.scrollTop += Math.max(200, scroll.clientHeight * 0.7);
    state.message = "Collecting as the list scrolls. Keep this tab open; you can close this popup.";
    timer = setTimeout(tick, 1500);
  }

  function start() {
    const source = core.followingFromURL(location.href);
    if (!source) return { error: "On Instagram, open the account’s profile and click its Following count. Followers lists cannot be exported with this tool." };
    const found = findDialog();
    if (!found) return { error: "The Following window isn’t open. Click Following on the profile, then try again." };
    if (state.status === "collecting") return snapshot(false);
    if (source !== state.source && accounts.size) {
      return { error: `You still have collected accounts from @${state.source}. Download them, then use Clear collected accounts before starting a different list.` };
    }
    if (source !== state.source) accounts.clear();
    dialog = found;
    state.source = source;
    state.status = "collecting";
    state.startedAt = new Date().toISOString();
    stagnant = 0;
    rounds = 0;
    lastCount = accounts.size;
    observer = new MutationObserver(collect);
    observer.observe(dialog, { childList: true, subtree: true });
    tick();
    return snapshot(false);
  }

  function snapshot(includeAccounts) {
    const result = { ...state, count: accounts.size };
    if (includeAccounts) result.accounts = [...accounts.values()];
    return result;
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.app !== "following-export") return;
    try {
      if (message.command === "start") respond(start());
      else if (message.command === "stop") {
        collect();
        finish("paused", "Paused. Download your collected accounts or continue scanning.");
        respond(snapshot(false));
      } else if (message.command === "clear") {
        finish("idle", "Cleared. Open a Following list to begin again.");
        accounts.clear();
        state.source = "";
        state.startedAt = null;
        respond(snapshot(false));
      } else if (message.command === "status" || message.command === "export") {
        respond(snapshot(message.command === "export"));
      } else respond({ error: "Unknown command." });
    } catch (error) {
      finish("error", "Collection stopped after a page error. Previously collected accounts can still be downloaded.");
      respond({ error: error.message });
    }
  });
})();
