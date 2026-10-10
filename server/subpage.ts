// The subscription as a browser sees it: the same /sub/<token> address, a page
// instead of the text the Taiga client reads. Self-contained: no bundle, no
// outside requests, so it opens wherever the address is published.

import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import QRCode from 'qrcode';
import {TRANSPORTS, plural, siteUrl, telegramUrl} from '../shared/model.js';
import type {NodeRecord, SubscriptionRecord} from '../shared/panel.js';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]!);

/** A browser asks for HTML; the client's fetch and curl accept anything. ?raw gives the text. */
export function wantsPage(accept: string | undefined, query: unknown): boolean {
  if (query && typeof query === 'object' && 'raw' in query) return false;
  return /\btext\/html\b/i.test(accept ?? '');
}

/** Twemoji's country flags (MIT), for systems without flag glyphs: served at /sub/_/flags.woff2. */
export const FLAG_FONT = fs.readFileSync(createRequire(import.meta.url).resolve('country-flag-emoji-polyfill/dist/TwemojiCountryFlags.woff2'));

/**
 * Noto Color Emoji (COLRv1, OFL) in unicode-range parts, from assets/: the last font in the stack,
 * so a browser takes the system's emoji first and downloads a part only where it has none.
 */
const EMOJI_DIR = path.resolve('assets/fonts/noto-color-emoji');
export const EMOJI_CSS = fs.readFileSync(path.join(EMOJI_DIR, 'emoji.css'), 'utf8');
export const EMOJI_PARTS = new Map(
  fs
    .readdirSync(EMOJI_DIR)
    .filter(f => /^\d+\.woff2$/.test(f))
    .map(f => [f, fs.readFileSync(path.join(EMOJI_DIR, f))]),
);
/** The system emoji fonts by name, then ours: in every font-family after the text fonts. */
export const EMOJI_STACK = "'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji','Taiga Emoji'";

/** What only the page needs from it, for the Content-Security-Policy. */
export const PAGE_CSP = "default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const dateRu = (ms: number) =>
  new Date(ms).toLocaleDateString('ru-RU', {day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'});

export async function subscriptionPage(sub: SubscriptionRecord, nodes: NodeRecord[], url: string): Promise<string> {
  // Dark on light with a quiet zone: what phone cameras read best, whatever the page's theme.
  const qr = await QRCode.toString(url, {type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: {dark: '#07080c', light: '#e6e9f0'}});
  const name = sub.name.trim() || 'Taiga';
  const telegram = telegramUrl(sub.telegram);
  const site = siteUrl(sub.site);
  const message = sub.message.trim();
  const count = `${nodes.length} ${plural(nodes.length, 'профиль', 'профиля', 'профилей')}`;

  const contacts = [
    telegram && `<a class="btn" href="${esc(telegram)}" target="_blank" rel="noopener noreferrer">Telegram</a>`,
    site && `<a class="btn" href="${esc(site)}" target="_blank" rel="noopener noreferrer">${esc(new URL(site).hostname)}</a>`,
  ].filter(Boolean);

  const rows = nodes
    .map((n, i) => {
      const via = [...new Set(n.transports.map(t => TRANSPORTS[t.type]?.shortLabel ?? t.type))];
      return `<li class="node">
        <div class="node-main">
          <span class="idx">${String(i + 1).padStart(2, '0')}</span>
          <div class="node-text">
            <div class="node-name">${esc(n.name || 'Без имени')}</div>
            <div class="tags">${via.map(v => `<span class="tag">${esc(v)}</span>`).join('')}</div>
          </div>
        </div>
        <button class="btn small" type="button" data-copy="${esc(n.link)}">Копировать ссылку</button>
      </li>`;
    })
    .join('');

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${esc(name)} · подписка Taiga</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M3 0h13v13l-3 3H0V3z" fill="#f2e94e"/></svg>')}">
<link rel="stylesheet" href="/sub/_/emoji.css">
<style>
@font-face{font-family:'Twemoji Country Flags';src:url('/sub/_/flags.woff2') format('woff2');font-display:swap;unicode-range:U+1F1E6-1F1FF,U+1F3F4,U+E0062-E007F}
:root{--void:#07080c;--steel:#0e1118;--plate:#141924;--wire:#252d3d;--dim:#8a93a8;--ink:#e6e9f0;--acid:#f2e94e;--cyan:#3fd7e8;--ok:#4fe08a;--warn:#ffab3d;
--mono:'Twemoji Country Flags','JetBrains Mono',${EMOJI_STACK},ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--cut:polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100dvh;background:var(--void);color:var(--ink);font:14px/1.55 var(--mono);-webkit-font-smoothing:antialiased;overflow-wrap:anywhere}
body::before{content:'';position:fixed;inset:0;pointer-events:none;background-image:linear-gradient(rgb(63 215 232/.04) 1px,transparent 1px),linear-gradient(90deg,rgb(63 215 232/.04) 1px,transparent 1px);background-size:48px 48px;-webkit-mask-image:radial-gradient(ellipse at 30% 0%,#000 30%,transparent 75%);mask-image:radial-gradient(ellipse at 30% 0%,#000 30%,transparent 75%)}
main{position:relative;max-width:720px;margin:0 auto;padding:40px 16px 56px}
.kicker{color:var(--cyan);font-size:12px;letter-spacing:.18em;text-transform:uppercase}
h1{margin:6px 0 4px;font-size:clamp(28px,7vw,40px);line-height:1.1;font-weight:700;letter-spacing:-.01em}
h2{margin:0 0 14px;font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);font-weight:600}
.meta{color:var(--dim);font-size:13px}
.panel{margin-top:20px;padding:20px;background:var(--steel);border:1px solid var(--wire);clip-path:var(--cut)}
.message{white-space:pre-line;border-left:2px solid var(--acid);padding-left:14px;margin-top:20px}
.row{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:8px 16px;border:1px solid var(--wire);background:var(--plate);color:var(--ink);font:600 13px var(--mono);text-decoration:none;cursor:pointer;clip-path:polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px);transition:border-color .15s,color .15s}
.btn:hover{border-color:var(--acid);color:var(--acid)}
.btn:focus-visible{outline:2px solid var(--cyan);outline-offset:2px}
.btn.primary{background:var(--acid);border-color:var(--acid);color:var(--void)}
.btn.primary:hover{background:#fff35c;color:var(--void)}
.btn.small{min-height:34px;padding:6px 12px;font-size:12px;flex:none}
.btn.done{border-color:var(--ok);color:var(--ok)}
.btn.primary.done{background:var(--ok);border-color:var(--ok);color:var(--void)}
.connect{display:grid;grid-template-columns:1fr auto;gap:20px;align-items:start}
.qr{width:168px;margin:0;text-align:center}
.qr svg{display:block;width:100%;height:auto;clip-path:polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px)}
.qr figcaption{margin-top:8px;color:var(--dim);font-size:11px;line-height:1.4}
.url{display:block;margin-top:16px;width:100%;padding:12px 14px;background:var(--void);border:1px solid var(--wire);color:var(--acid);font:13px var(--mono);user-select:all;-webkit-user-select:all}
ol{margin:0;padding:0;list-style:none;counter-reset:s}
ol li{counter-increment:s;position:relative;padding-left:34px;margin:10px 0}
ol li::before{content:counter(s);position:absolute;left:0;top:0;width:22px;height:22px;display:grid;place-items:center;background:var(--plate);border:1px solid var(--wire);color:var(--cyan);font-size:12px}
b{color:var(--ink);font-weight:600}
ul.nodes{list-style:none;margin:0;padding:0}
.node{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-top:1px solid var(--wire)}
.node:first-child{border-top:0;padding-top:0}
.node:last-child{padding-bottom:0}
.node-main{display:flex;gap:12px;min-width:0}
.idx{color:var(--dim);font-size:12px;padding-top:2px}
.node-name{font-weight:600}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
.tag{font-size:11px;padding:1px 7px;border:1px solid var(--wire);color:var(--cyan)}
.empty{color:var(--dim)}
.warn{color:var(--warn);font-size:12px;margin-top:20px}
footer{margin-top:28px;color:var(--dim);font-size:12px;display:flex;flex-wrap:wrap;gap:6px 18px}
footer a{color:var(--dim)}
footer a:hover{color:var(--acid)}
@media (max-width:520px){main{padding-top:28px}.connect{grid-template-columns:1fr}.qr{justify-self:center;width:200px}.panel{padding:16px}.node{flex-direction:column;align-items:stretch}.node .btn{width:100%}.row .btn{flex:1 1 auto}}
@media (prefers-reduced-motion:reduce){.btn{transition:none}}
</style>
</head>
<body>
<main>
  <div class="kicker">Подписка Taiga</div>
  <h1>${esc(name)}</h1>
  <div class="meta">${count} · обновлена ${dateRu(sub.updatedAt || sub.createdAt)}</div>
  ${message ? `<div class="message">${esc(message)}</div>` : ''}
  ${contacts.length ? `<div class="row">${contacts.join('')}</div>` : ''}

  <section class="panel">
    <h2>Как подключиться</h2>
    <div class="connect">
      <ol>
        <li>Откройте приложение <b>Taiga</b>.</li>
        <li>Выберите <b>Импорт → Подписка по адресу</b>.</li>
        <li>Вставьте адрес ниже. Профили будут обновляться сами при каждом запуске.</li>
      </ol>
      <figure class="qr" aria-label="QR-код адреса подписки">${qr}<figcaption>Наведите камеру телефона, чтобы открыть подписку на нём</figcaption></figure>
    </div>
    <code class="url" id="sub-url">${esc(url)}</code>
    <div class="row"><button class="btn primary" type="button" data-copy="${esc(url)}">Скопировать адрес подписки</button></div>
  </section>

  <section class="panel">
    <h2>Профили</h2>
    ${nodes.length ? `<ul class="nodes">${rows}</ul>` : '<p class="empty">В подписке пока нет профилей.</p>'}
    ${nodes.length > 1 ? `<div class="row"><button class="btn" type="button" data-copy="${esc(nodes.map(n => n.link).join('\n'))}">Скопировать все ссылки</button></div>` : ''}
    <p class="warn">В ссылках ключи шифрования: передавайте этот адрес только своим.</p>
  </section>

  <footer>
    <span>Taiga</span>
    <a href="?raw" rel="nofollow">Текст подписки</a>
  </footer>
</main>
<script>
(function(){
  function fallback(text){
    var t=document.createElement('textarea');t.value=text;t.setAttribute('readonly','');t.style.position='fixed';t.style.opacity='0';
    document.body.appendChild(t);t.select();var ok=false;try{ok=document.execCommand('copy')}catch(e){}document.body.removeChild(t);
    return ok?Promise.resolve():Promise.reject();
  }
  document.addEventListener('click',function(e){
    var b=e.target.closest&&e.target.closest('[data-copy]');if(!b)return;
    var text=b.getAttribute('data-copy'),label=b.dataset.label||b.textContent;b.dataset.label=label;
    var p=navigator.clipboard&&window.isSecureContext?navigator.clipboard.writeText(text).catch(function(){return fallback(text)}):fallback(text);
    p.then(function(){b.textContent='Скопировано';b.classList.add('done')},function(){b.textContent='Не удалось: выделите вручную'})
     .then(function(){clearTimeout(b._t);b._t=setTimeout(function(){b.textContent=label;b.classList.remove('done')},1800)});
  });
})();
</script>
</body>
</html>
`;
}
