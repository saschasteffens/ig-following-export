(function (root) {
  "use strict";
  const reserved = new Set([
    "accounts", "direct", "explore", "reels", "reel", "p", "stories", "about",
    "privacy", "web", "legal", "challenge", "checkpoint", "emails", "settings"
  ]);

  function username(value) {
    const result = String(value || "").trim().replace(/^@/, "");
    return /^[a-zA-Z0-9._]{1,30}$/.test(result) && !reserved.has(result.toLowerCase())
      ? result.toLowerCase() : null;
  }

  function instagramURL(value) {
    try {
      const url = new URL(value, "https://www.instagram.com/");
      return url.protocol === "https:" && /^(www\.)?instagram\.com$/.test(url.hostname) ? url : null;
    } catch { return null; }
  }

  function profileFromURL(value) {
    const url = instagramURL(value);
    const match = url?.pathname.match(/^\/([^/]+)\/?$/);
    return match ? username(match[1]) : null;
  }

  function followingFromURL(value) {
    const url = instagramURL(value);
    const match = url?.pathname.match(/^\/([^/]+)\/following\/?$/);
    return match ? username(match[1]) : null;
  }

  function csvCell(value) {
    let text = String(value ?? "");
    // Prevent names from being interpreted as spreadsheet formulas on import.
    if (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  }

  function toCSV(accounts, source) {
    const rows = [["source_account", "username", "display_name", "profile_url", "collected_at"]];
    for (const account of accounts) {
      const name = username(account.username);
      if (!name) continue;
      rows.push([source, name, account.displayName || "", `https://www.instagram.com/${name}/`, account.collectedAt || ""]);
    }
    return "\ufeff" + rows.map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  }

  const api = { username, instagramURL, profileFromURL, followingFromURL, csvCell, toCSV };
  root.FollowingExportCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
