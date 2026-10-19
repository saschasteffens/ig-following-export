// Representative rendered Instagram dialog. Network requests are intercepted;
// these tests never contact Instagram or need an account.
const row = (name, displayName) => `<div class="account"><a href="/${name}/"><img alt="${name}'s profile picture"></a><div><a href="/${name}/"><span>${name}</span></a><span>${displayName}</span></div><button><span>Follow</span></button></div>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body { font:14px system-ui; margin:40px; } [role=dialog] { width:400px; border:1px solid #ddd; padding:16px; }
.list { height:160px; overflow-y:auto; } .account { height:74px; display:flex; align-items:center; justify-content:space-between; }
.account>div { display:flex; flex-direction:column; } img { width:24px; height:24px; } [hidden] { display:none; }
</style></head><body>
<a href="/outside/">Outside account</a>
<div role="dialog"><h1>Following</h1><div class="list">
${row('alpha', 'Alice, &quot;A&quot;')}${row('beta', 'Renée 世界')}${row('alpha', 'Alice duplicate')}
</div></div>
<script>
  let next = 0;
  const list = document.querySelector('.list');
  list.addEventListener('scroll', () => {
    if (list.scrollTop + list.clientHeight >= list.scrollHeight - 10 && next++ === 0) {
      setTimeout(() => list.insertAdjacentHTML('beforeend', ${JSON.stringify(row('gamma', '=1+1'))}), 100);
    }
  });
  globalThis.chrome = { runtime: { onMessage: { addListener(fn) { globalThis.messageHandler = fn; } } } };
</script></body></html>`;
module.exports = { html, row };
