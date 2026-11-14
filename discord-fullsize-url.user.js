// ==UserScript==
// @name         Discord: Copy full-size media & link URLs
// @namespace    https://github.com/DrScarab/discord-cpy-link
// @version      1.7.1
// @description  Hover an image, video, audio file, sticker, link preview, invite or website link in Discord and a small button appears in its corner: click it to copy the full URL (CDN signature included) to the clipboard, ready to paste into another channel or a new browser tab.
// @author       DrScarab
// @license      MIT
// @homepageURL  https://github.com/DrScarab/discord-cpy-link
// @supportURL   https://github.com/DrScarab/discord-cpy-link/issues
// @updateURL    https://raw.githubusercontent.com/DrScarab/discord-cpy-link/main/discord-fullsize-url.user.js
// @downloadURL  https://raw.githubusercontent.com/DrScarab/discord-cpy-link/main/discord-fullsize-url.user.js
// @match        https://discord.com/*
// @match        https://*.discord.com/*
// @match        https://discordapp.com/*
// @match        https://*.discordapp.com/*
// @run-at       document-idle
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------
  const CFG = {
    // Keep the in-place buttons visible all the time (faint) instead of only
    // on hover. The floating button for inline text links is always hover-only.
    alwaysVisible: false,
    // Skip proxied/embed images smaller than this (px) — kills link-preview
    // favicons and other tiny thumbnails. Direct attachments are never
    // size-checked.
    minProxySize: 96,
    // Query params Discord adds for thumbnailing. They are NOT part of the CDN
    // signature, so dropping them yields the original, full-resolution file
    // while ex/is/hm (the signature) stay valid.
    stripParams: ['width', 'height', 'format', 'quality', 'size', 'animated'],
    // Feature switches
    enableAudio: true,       // attachment players (mp3, wav, ogg, flac, ...)
    enableEmbeds: true,      // link previews / invite cards / Spotify
    enableInlineLinks: true, // plain http(s) links in message text
    // Discord's GIF picker serves Tenor/Klipy/Giphy clips as proxied .mp4 files
    // with short-lived CDN paths. Copy the provider's permanent share page
    // instead (klipy.com/gifs/…, tenor.com/view/…), which is what you paste into
    // Discord. Falls back to the .gif asset, then the mp4.
    preferGif: true,
    // Also show the floating copy button for links inside embed cards.
    inlineLinksInEmbeds: false,
    // Where the inline-link button goes: 'after' (trailing badge, default),
    // 'over' (on the link's top-right corner) or 'above' (floating above it).
    inlinePlacement: 'after',
    // Corner for the button on link-preview / invite cards: 'left' or 'right'.
    // 'right' avoids covering the provider text in the top-left of an embed.
    embedCorner: 'left',

    // --- Embed-fix services -------------------------------------------------
    // Twitter/X, Instagram, TikTok and Reddit have broken (or no) native
    // Discord embeds. When one of their links is copied, the domain is swapped
    // for a fix service that produces a working embed preview.
    //
    // Each entry:  from = the site,  to = the fix service,  enabled = on/off.
    // Edit `to` when a service dies, changes name or gets replaced — no other
    // code needs touching. Set `enabled: false` (or fixEmbeds: false) to copy
    // the original URL unchanged.
    fixEmbeds: true,
    fixServices: [
      // domain you post          -> fix service that renders it
      { enabled: true, from: 'twitter.com',   to: 'fxtwitter.com' },   // fixuptwitter.com is dead (NXDOMAIN)
      { enabled: true, from: 'x.com',         to: 'fixupx.com' },
      { enabled: true, from: 'instagram.com', to: 'instagramfix.com' }, // alt: zzinstagram.com
      { enabled: true, from: 'tiktok.com',    to: 'tnktok.com' },
      { enabled: true, from: 'reddit.com',    to: 'vxreddit.com' },     // alt: rxddit.com
    ],
  };

  // Snapshot of the shipped defaults (used by "Reset to defaults").
  const DEFAULTS = JSON.parse(JSON.stringify(CFG));

  // Real message media (attachments + proxied embed media + stickers).
  const MEDIA_RE = /\/(attachments|ephemeral-attachments|external|stickers)\//i;
  const MEDIA_SEL = [
    'img[src*="/attachments/"]',
    'img[src*="/ephemeral-attachments/"]',
    'img[src*="/external/"]',
    'img[src*="/stickers/"]',
    'video[src*="/attachments/"]',
    'video[src*="/ephemeral-attachments/"]',
    'video[src*="/external/"]',
  ].join(',');

  const AUDIO_SEL = '[class*="wrapperAudio"]';
  const EMBED_SEL = '[class*="embedFull"]';
  const INVITE_SEL = '[class*="guildInviteContainer"], [class*="inviteContainer"]';
  const SPOTIFY_SEL = 'iframe[class*="embedSpotify"], iframe[src*="open.spotify.com/embed"]';

  const ICON_LINK =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>' +
    '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';

  const ICON_CHECK =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
    'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M20 6 9 17l-5-5"/></svg>';

  const ICON_ERROR =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
    'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M18 6 6 18M6 6l12 12"/></svg>';

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------
  const CSS = `
.dcfu-btn {
  position: absolute !important;
  top: 8px !important;
  left: 8px !important;
  z-index: 2147483000 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  box-sizing: border-box !important;
  width: 30px !important;
  height: 30px !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 7px !important;
  background: rgba(0, 0, 0, 0.62) !important;
  color: #fff !important;
  font: 600 14px/1 var(--font-primary, "gg sans", "Noto Sans", sans-serif) !important;
  cursor: pointer !important;
  opacity: 0 !important;
  pointer-events: auto !important;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45) !important;
  -webkit-backdrop-filter: blur(2px);
  backdrop-filter: blur(2px);
  transition: opacity 0.12s ease, background-color 0.12s ease, transform 0.12s ease !important;
}
/* toggled from the userscript menu */
.dcfu-always .dcfu-btn {
  opacity: 0.55 !important;
}
/* GIF embeds: sit below Discord's own favourite/star button */
.dcfu-btn.dcfu-gif {
  top: 44px !important;
}
.dcfu-btn.dcfu-small {
  width: 26px !important;
  height: 26px !important;
  border-radius: 6px !important;
}
.dcfu-btn.dcfu-right {
  left: auto !important;
  right: 8px !important;
}
.dcfu-btn.dcfu-show,
.dcfu-btn:focus-visible {
  opacity: 1 !important;
}
.dcfu-btn:hover {
  background: ${CFG.alwaysVisible ? 'rgba(88,101,242,0.9)' : '#5865F2'} !important;
}
.dcfu-btn.dcfu-ok  { background: #248046 !important; opacity: 1 !important; }
.dcfu-btn.dcfu-err { background: #DA373C !important; opacity: 1 !important; }
.dcfu-btn.dcfu-float {
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
}
/* Fallback when the parent element cannot act as a containing block: keep the
   button visually on its target instead of letting it escape to the page
   corner. */
.dcfu-btn.dcfu-pinned {
  position: fixed !important;
}
.dcfu-btn svg { display: block; pointer-events: none; }

.dcfu-toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translate(-50%, 8px);
  z-index: 2147483647;
  max-width: 70vw;
  padding: 9px 14px;
  border-radius: 8px;
  background: #248046;
  color: #fff;
  font: 500 14px/1.3 var(--font-primary, "gg sans", "Noto Sans", sans-serif);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.dcfu-toast.dcfu-toast-err { background: #DA373C; }
.dcfu-toast.dcfu-toast-show { opacity: 1; transform: translate(-50%, 0); }
`;

  function injectCSS() {
    if (typeof GM_addStyle === 'function') {
      GM_addStyle(CSS);
      return;
    }
    const style = document.createElement('style');
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  // ---------------------------------------------------------------------------
  // URL helpers
  // ---------------------------------------------------------------------------
  function mediaSrc(el) {
    if (!el) return '';
    if (el.tagName === 'VIDEO') {
      const direct = el.currentSrc || el.src || '';
      if (direct && !direct.startsWith('blob:')) return direct;
      const source = el.querySelector('source[src]');
      return source ? source.src : '';
    }
    return el.currentSrc || el.src || el.getAttribute('src') || '';
  }

  function isDiscordCdn(hostname) {
    return /(^|\.)discordapp\.(net|com)$/i.test(hostname);
  }

  function absolute(raw) {
    if (!raw) return '';
    try {
      return new URL(raw, location.href).href;
    } catch (e) {
      return raw;
    }
  }

  // ---------------------------------------------------------------------------
  // Embed-fix services (twitter/x, instagram, tiktok, reddit)
  // ---------------------------------------------------------------------------
  function bareHost(host) {
    return String(host || '').toLowerCase().replace(/^www\./, '');
  }

  /** Is this host already one of the configured fix services? */
  function isFixServiceHost(host) {
    const h = bareHost(host);
    for (let i = 0; i < CFG.fixServices.length; i++) {
      const to = bareHost(CFG.fixServices[i].to);
      if (to && (h === to || h.endsWith('.' + to))) return true;
    }
    return false;
  }

  /**
   * Swap a broken platform domain for its fix service:
   *   https://www.instagram.com/p/DeWy5hENs40/  ->  https://instagramfix.com/p/DeWy5hENs40/
   *   https://x.com/user/status/123             ->  https://fixupx.com/user/status/123
   * URLs that are already on a fix service are returned untouched, as is
   * anything that does not match a configured rule.
   */
  function fixEmbedUrl(raw) {
    if (!raw || !CFG.fixEmbeds) return raw;

    let url;
    try {
      url = new URL(raw, location.href);
    } catch (e) {
      return raw;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return raw;

    const host = bareHost(url.hostname);

    // Already a fix-service link → copy it exactly as it is.
    if (isFixServiceHost(host)) return url.href;

    for (let i = 0; i < CFG.fixServices.length; i++) {
      const rule = CFG.fixServices[i];
      if (!rule || rule.enabled === false || !rule.to) continue;
      const from = bareHost(rule.from);
      if (!from) continue;
      if (host === from || host.endsWith('.' + from)) {
        url.hostname = rule.to;
        return url.href;
      }
    }
    return url.href;
  }

  /**
   * Rebuild a URL with empty query pairs (Discord leaves a trailing "&")
   * removed. Everything else — including the ex/is/hm signature — is kept
   * byte for byte.
   */
  function cleanQuery(raw) {
    let url;
    try {
      url = new URL(raw, location.href);
    } catch (e) {
      return raw;
    }
    const pairs = url.search.replace(/^\?/, '').split('&').filter(Boolean);
    return url.origin + url.pathname + (pairs.length ? '?' + pairs.join('&') : '');
  }

  /**
   * Turn a Discord CDN URL into the full-size original, keeping the signature
   * (ex / is / hm) intact and dropping only the unsigned thumbnail params.
   */
  function fullSizeUrl(raw) {
    if (!raw) return '';
    let url;
    try {
      url = new URL(raw, location.href);
    } catch (e) {
      return raw;
    }
    if (!isDiscordCdn(url.hostname)) return url.href;

    const strip = new Set(CFG.stripParams);
    const pairs = url.search.replace(/^\?/, '').split('&').filter(Boolean);
    const kept = pairs.filter((pair) => {
      const rawKey = pair.split('=')[0];
      let key = rawKey;
      try {
        key = decodeURIComponent(rawKey);
      } catch (e) {
        /* keep raw */
      }
      return !strip.has(key.toLowerCase());
    });

    return url.origin + url.pathname + (kept.length ? '?' + kept.join('&') : '');
  }

  // ---------------------------------------------------------------------------
  // GIF embeds: Discord proxies Tenor/Klipy/Giphy clips as .mp4 and the CDN
  // asset paths are short-lived. The wrapper's invisible `a.originalLink`
  // holds the provider's permanent share page (e.g. https://klipy.com/gifs/…),
  // which is exactly the link to paste into Discord.
  // ---------------------------------------------------------------------------
  const PROVIDER_HOSTS = /(^|\.)(tenor\.com|klipy\.com|giphy\.com|giphy\.media)$/i;
  const GIF_HOSTS = /(^|\.)(tenor\.com|klipy\.com|giphy\.com|giphy\.media)$/i;

  function providerPageUrl(anchor) {
    const a = anchor && anchor.querySelector('a[class*="originalLink"][href], a[data-role="img"][href]');
    if (!a) return null;
    let url;
    try {
      url = new URL(a.getAttribute('href'), location.href);
    } catch (e) {
      return null;
    }
    if (!PROVIDER_HOSTS.test(url.hostname)) return null;
    if (url.pathname === '/' || url.pathname === '') return null;
    return url.href;
  }

  /** Unwrap https://images-ext-N.discordapp.net/external/<hash>/https/<orig>. */
  function proxiedOriginal(href) {
    let url;
    try {
      url = new URL(href, location.href);
    } catch (e) {
      return null;
    }
    if (!/^images-ext-\d+\.discordapp\.net$/i.test(url.hostname)) return null;
    const m = url.pathname.match(/^\/external\/[^/]+\/(https?)\/(.+)$/i);
    return m ? m[1] + '://' + m[2] : null;
  }

  function gifCandidate(href) {
    const original = proxiedOriginal(href);
    if (!original) return null;

    let url;
    try {
      url = new URL(original);
    } catch (e) {
      return null;
    }
    if (!GIF_HOSTS.test(url.hostname)) return null;
    if (!/\.mp4$/i.test(url.pathname)) return null;

    const gif = original.replace(/\.mp4(?=($|[?#]))/i, '.gif');
    return gif === original ? null : gif;
  }

  /** Resolves true when the URL actually loads as an image. */
  function imageLoads(src, timeoutMs) {
    return new Promise((resolve) => {
      const img = new Image();
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        img.onload = img.onerror = null;
        resolve(ok);
      };
      img.onload = () => finish(true);
      img.onerror = () => finish(false);
      setTimeout(() => finish(false), timeoutMs || 2500);
      img.src = src;
    });
  }

  /**
   * If the media is a proxied Tenor/Klipy/Giphy .mp4 and the matching .gif
   * loads, return the .gif (permanent original URL). Otherwise return the input.
   * Returns a promise so the copy can wait for the check.
   */
  function maybeGif(url) {
    if (!CFG.preferGif || !url) return url;
    const gif = gifCandidate(url);
    if (!gif) return url;
    return imageLoads(gif).then((ok) => (ok ? gif : url));
  }

  /**
   * Discord renders an invisible `a.originalLink` over chat images whose href
   * already is the pristine original file (cdn.discordapp.com, no thumbnail
   * params). Prefer it when it points at the same attachment, and fall back to
   * de-thumbnailing the <img>/<video> src.
   */
  function resolveMediaUrl(media, anchor) {
    // GIF embeds → the provider's permanent share page (pasteable in Discord).
    if (CFG.preferGif) {
      const page = providerPageUrl(anchor);
      if (page) return page;
    }

    const src = mediaSrc(media);
    const link = anchor && anchor.querySelector(
      'a[href*="/attachments/"], a[href*="/ephemeral-attachments/"]'
    );
    if (link) {
      const href = link.getAttribute('href');
      try {
        const linkUrl = new URL(href, location.href);
        const srcUrl = new URL(src, location.href);
        if (isDiscordCdn(linkUrl.hostname) && linkUrl.pathname === srcUrl.pathname) {
          return maybeGif(cleanQuery(linkUrl.href));
        }
      } catch (e) {
        /* fall through */
      }
    }
    return maybeGif(fullSizeUrl(src));
  }

  /** Audio attachment player: the download link holds the signed direct URL. */
  function resolveAudioUrl(wrapper) {
    const link = wrapper.querySelector(
      'a[href*="/attachments/"], a[href*="/ephemeral-attachments/"]'
    );
    if (link) return cleanQuery(link.getAttribute('href'));

    const audio = wrapper.querySelector('audio');
    if (audio) {
      const src = audio.currentSrc || audio.src;
      if (src && !src.startsWith('blob:')) return cleanQuery(src);
    }
    return '';
  }

  /**
   * Link previews / invite cards: the title anchor points at the destination
   * page (invites included). Fall back to an invite anchor, then to the first
   * non-media link inside the card.
   */
  function resolveEmbedUrl(card) {
    const title = card.querySelector('a[class*="embedTitleLink"][href]');
    if (title && /^https?:/i.test(title.getAttribute('href'))) return absolute(title.getAttribute('href'));

    // No real title link (Instagram/TikTok cards use the author profile as the
    // only link): the URL the user actually posted is in the message text.
    const message = card.closest('[id^="chat-messages-"]');
    if (message) {
      const links = message.querySelectorAll('a[href^="http"]');
      for (let i = 0; i < links.length; i++) {
        const a = links[i];
        if (a.closest('[class*="embedFull"], [class*="guildInviteContainer"], [class*="inviteContainer"]')) continue;
        return absolute(a.getAttribute('href'));
      }
    }

    const invite = card.querySelector('a[href*="discord.gg/"], a[href*="discord.com/invite/"]');
    if (invite) return absolute(invite.getAttribute('href'));

    const links = card.querySelectorAll('a[href^="http"]');
    for (let i = 0; i < links.length; i++) {
      const a = links[i];
      if (/originalLink/i.test(String(a.className))) continue;
      const href = a.getAttribute('href') || '';
      if (/\/attachments\/|\/ephemeral-attachments\/|\/external\//i.test(href)) continue;
      return absolute(href);
    }
    return '';
  }

  // ---------------------------------------------------------------------------
  // Clipboard
  // ---------------------------------------------------------------------------
  function copyText(text) {
    return (async () => {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (e) {
        /* fall through */
      }

      try {
        if (typeof GM_setClipboard === 'function') {
          const res = GM_setClipboard(text, 'text');
          if (res && typeof res.then === 'function') await res;
          return true;
        }
      } catch (e) {
        /* fall through */
      }

      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:-2000px;left:-2000px;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (e) {
        return false;
      }
    })();
  }

  // ---------------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------------
  let toastEl = null;
  let toastTimer = 0;

  function toast(message, ok) {
    if (!toastEl || !toastEl.isConnected) {
      toastEl = document.createElement('div');
      toastEl.className = 'dcfu-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.classList.toggle('dcfu-toast-err', !ok);
    toastEl.classList.add('dcfu-toast-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('dcfu-toast-show'), 1600);
  }

  // ---------------------------------------------------------------------------
  // Buttons
  // ---------------------------------------------------------------------------
  const buttons = new WeakMap(); // target element -> button
  const placements = new Map(); // button -> { target, dx, dy }

  // Only attach to real chat content or a media-viewer modal. This keeps the
  // script away from preload/portal/measurement nodes that Discord parks at the
  // top-left of the app (a button attached there would float over the server
  // list).
  const REAL_TARGET = '[id^="chat-messages-"], [class*="messageListItem"], [class*="mediaArea"], [class*="searchResult"], [role="dialog"]';
  // Media also shows up in pickers (sticker/emoji panels are dialogs) — only
  // take it from real messages and the media viewer.
  const MEDIA_TARGET = '[id^="chat-messages-"], [class*="messageListItem"], [class*="mediaArea"], [class*="searchResult"]';

  function isRealTarget(el) {
    return !!(el && el.closest && el.closest(REAL_TARGET));
  }

  /**
   * Append the button and make sure it really sits at (dx,dy) of the target.
   * If the chosen container is not a containing block (static ancestors,
   * display:contents, React moved it, …) switch to a viewport-pinned button
   * that follows the target instead of letting the absolute position resolve
   * against the page corner.
   */
  function mountButton(btn, container, target, dx, dy, kind) {
    container.appendChild(btn);
    placements.set(btn, {
      target: target || container,
      dx: dx == null ? 8 : dx,
      dy: dy == null ? 8 : dy,
      kind: kind || '',
    });
    applyPlacement(btn);
  }

  function applyPlacement(btn) {
    const info = placements.get(btn);
    if (!info) return;
    const target = info.target;
    if (!target || !target.isConnected) {
      placements.delete(btn);
      btn.remove();
      return;
    }

    const tr = target.getBoundingClientRect();
    if (!tr.width && !tr.height) return; // hidden, nothing to align to

    const wantLeft = Math.round(tr.left + info.dx);
    const wantTop = Math.round(tr.top + info.dy);

    if (!btn.classList.contains('dcfu-pinned')) {
      const br = btn.getBoundingClientRect();
      // Generous tolerance: legit placements are within a few px (or scaled a
      // bit during open/close animations); a button that escaped its container
      // lands hundreds of px away, in the page corner.
      const ok = Math.abs(br.left - wantLeft) <= 40 && Math.abs(br.top - wantTop) <= 40;
      if (ok) return;
      btn.classList.add('dcfu-pinned');
    }

    btn.style.setProperty('left', wantLeft + 'px', 'important');
    btn.style.setProperty('top', wantTop + 'px', 'important');
  }

  function refreshPlacements() {
    placements.forEach((info, btn) => {
      if (!btn.isConnected) {
        placements.delete(btn);
        return;
      }
      applyPlacement(btn);
    });
  }

  function ensurePositioned(el) {
    if (!el) return;
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  }

  function anchorFor(media, rect) {
    let el = media.parentElement;
    let fallback = null;

    for (let depth = 0; el && el !== document.body && depth < 10; depth++, el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (cs.display === 'contents') continue; // no box → can't contain an absolute child
      const r = el.getBoundingClientRect();
      const sameSize = Math.abs(r.width - rect.width) <= 2 && Math.abs(r.height - rect.height) <= 2;
      if (!sameSize) continue;
      if (cs.position !== 'static') return el; // ideal: positioned, same box
      if (!fallback) fallback = el;
    }

    if (fallback) {
      fallback.style.position = 'relative';
      return fallback;
    }
    const parent = media.parentElement;
    if (parent && parent !== document.body && getComputedStyle(parent).display !== 'contents') {
      ensurePositioned(parent);
      return parent;
    }
    return null;
  }

  function bindHover(container) {
    if (container.__dcfuHover) return;
    container.__dcfuHover = true;
    const toggle = (on) => {
      const list = container.querySelectorAll(':scope > .dcfu-btn');
      for (let i = 0; i < list.length; i++) list[i].classList.toggle('dcfu-show', on);
    };
    container.addEventListener('pointerenter', () => toggle(true));
    container.addEventListener('pointerleave', () => toggle(false));
    container.addEventListener('focusin', () => toggle(true));
    container.addEventListener('focusout', () => toggle(false));
  }

  function flash(btn, icon, cls) {
    btn.innerHTML = icon;
    btn.classList.remove('dcfu-ok', 'dcfu-err');
    btn.classList.add(cls);
    clearTimeout(btn.__dcfuTimer);
    btn.__dcfuTimer = setTimeout(() => {
      btn.innerHTML = ICON_LINK;
      btn.classList.remove('dcfu-ok', 'dcfu-err');
    }, 1100);
  }

  function onClick(event, resolver, btn, okMessage) {
    event.preventDefault();
    event.stopPropagation();

    Promise.resolve()
      .then(() => resolver())
      .then((raw) => {
        let url = raw || '';
        if (!url) {
          flash(btn, ICON_ERROR, 'dcfu-err');
          toast('No URL found', false);
          return;
        }

        const original = url;
        url = fixEmbedUrl(url);

        let host = '';
        try {
          host = new URL(url).hostname;
        } catch (e) {
          host = '';
        }

        return copyText(url).then((ok) => {
          if (ok) {
            flash(btn, ICON_CHECK, 'dcfu-ok');
            toast(url !== original && host ? 'Copied ' + host + ' link' : okMessage, true);
          } else {
            flash(btn, ICON_ERROR, 'dcfu-err');
            toast('Copy failed — check browser clipboard permissions', false);
            console.warn('[Copy URL] clipboard write failed for', url);
          }
        });
      })
      .catch((err) => {
        console.warn('[Copy URL] resolver failed', err);
        flash(btn, ICON_ERROR, 'dcfu-err');
        toast('Copy failed', false);
      });
  }

  function createButton(resolver, container, extraClass, okMessage, title) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dcfu-btn' + (extraClass ? ' ' + extraClass : '');
    btn.draggable = false;
    btn.tabIndex = -1;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.innerHTML = ICON_LINK;

    btn.addEventListener('click', (e) => onClick(e, resolver, btn, okMessage));

    // Keep Discord from opening the lightbox / following the link / starting a
    // drag when the button is used.
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'auxclick', 'dblclick'].forEach((type) => {
      btn.addEventListener(type, (e) => e.stopPropagation());
    });
    btn.addEventListener('dragstart', (e) => e.preventDefault());

    bindHover(container);
    return btn;
  }

  // --- media (images / videos) ------------------------------------------------
  function tryInstallMedia(media) {
    const existing = buttons.get(media);
    if (existing && existing.isConnected) return;
    if (!isRealTarget(media)) return;
    if (!media.closest || !media.closest(MEDIA_TARGET)) return;

    const src = mediaSrc(media);
    if (!src) return;
    let url;
    try {
      url = new URL(src, location.href);
    } catch (e) {
      return;
    }
    if (!isDiscordCdn(url.hostname)) return;
    if (!MEDIA_RE.test(url.pathname)) return;

    const rect = media.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return; // not laid out yet

    const direct = /\/(attachments|ephemeral-attachments|stickers)\//i.test(url.pathname);
    if (!direct && Math.min(rect.width, rect.height) < CFG.minProxySize) return; // favicon etc.

    const anchor = anchorFor(media, rect);
    if (!anchor) return;

    // Discord puts its own "favourite" star in the top-left corner of GIF
    // embeds (it even overflows above the media), so drop our button below it.
    const isGif =
      media.getAttribute('aria-label') === 'GIF' ||
      !!(media.closest && media.closest('[aria-label="GIF"]'));
    const dy = isGif ? 44 : 8;

    const btn = createButton(
      () => resolveMediaUrl(media, anchor),
      anchor,
      isGif ? 'dcfu-gif' : '',
      isGif ? 'GIF link copied' : 'Full-size URL copied',
      isGif ? 'Copy GIF link' : 'Copy full-size URL (with signature)'
    );
    mountButton(btn, anchor, media, 8, dy, 'media');
    buttons.set(media, btn);
  }

  // --- audio attachments ------------------------------------------------------
  function tryInstallAudio(wrapper) {
    const existing = buttons.get(wrapper);
    if (existing && existing.isConnected) return;
    if (!isRealTarget(wrapper)) return;
    if (!resolveAudioUrl(wrapper)) return;

    const rect = wrapper.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 30) return;

    ensurePositioned(wrapper);
    const btn = createButton(
      () => resolveAudioUrl(wrapper),
      wrapper,
      'dcfu-small',
      'Audio URL copied',
      'Copy audio URL (with signature)'
    );
    mountButton(btn, wrapper, wrapper, 8, 8, 'audio');
    buttons.set(wrapper, btn);
  }

  // --- link previews / invite cards ------------------------------------------
  function tryInstallEmbed(card) {
    const existing = buttons.get(card);
    if (existing && existing.isConnected) return;
    if (!isRealTarget(card)) return;
    if (!resolveEmbedUrl(card)) return;

    const rect = card.getBoundingClientRect();
    if (rect.width < 100 || rect.height < 30) return;

    ensurePositioned(card);
    const corner = CFG.embedCorner === 'right' ? ' dcfu-right' : '';
    const btn = createButton(
      () => resolveEmbedUrl(card),
      card,
      'dcfu-small' + corner,
      'Link copied',
      'Copy embed link'
    );
    mountButton(btn, card, card, 8, 8, 'embed');
    buttons.set(card, btn);
  }

  // --- invite cards -----------------------------------------------------------
  // Discord's invite card (guildInviteContainer_*) is not an embed and holds no
  // URL in its own DOM: the invite link lives in the message text next to it.
  function resolveInviteUrl(card) {
    const direct = card.querySelector('a[href*="discord.gg/"], a[href*="discord.com/invite/"]');
    if (direct) return absolute(direct.getAttribute('href'));

    const message = card.closest('[id^="chat-messages-"]');
    if (message) {
      const link = message.querySelector('a[href*="discord.gg/"], a[href*="discord.com/invite/"]');
      if (link) return absolute(link.getAttribute('href'));
    }
    return '';
  }

  function tryInstallInvite(card) {
    const existing = buttons.get(card);
    if (existing && existing.isConnected) return;
    if (!isRealTarget(card)) return;
    if (!resolveInviteUrl(card)) return;

    const rect = card.getBoundingClientRect();
    if (rect.width < 150 || rect.height < 100) return;

    ensurePositioned(card);
    const corner = CFG.embedCorner === 'right' ? ' dcfu-right' : '';
    const btn = createButton(
      () => resolveInviteUrl(card),
      card,
      'dcfu-small' + corner,
      'Invite link copied',
      'Copy invite link'
    );
    mountButton(btn, card, card, 8, 8, 'invite');
    buttons.set(card, btn);
  }

  // --- Spotify players --------------------------------------------------------
  // Discord renders shared Spotify links as an <iframe> (embedSpotify_*) right
  // in the message. The canonical link is embedded in the iframe path:
  //   https://open.spotify.com/embed/track/<id>?utm_source=discord...
  //   → https://open.spotify.com/track/<id>
  function resolveSpotifyUrl(frame) {
    const src = frame.getAttribute('src') || '';
    let url;
    try {
      url = new URL(src, location.href);
    } catch (e) {
      return '';
    }
    if (!/(^|\.)spotify\.com$/i.test(url.hostname)) return '';

    const m = url.pathname.match(/^\/embed\/(track|album|playlist|artist|episode|show)\/([^/?#]+)/i);
    if (m) return 'https://open.spotify.com/' + m[1].toLowerCase() + '/' + m[2];

    const plain = url.pathname.match(/^\/(track|album|playlist|artist|episode|show)\/([^/?#]+)/i);
    if (plain) return 'https://open.spotify.com/' + plain[1].toLowerCase() + '/' + plain[2];
    return '';
  }

  function tryInstallSpotify(frame) {
    const existing = buttons.get(frame);
    if (existing && existing.isConnected) {
      applyPlacement(existing); // layout may have changed
      return;
    }
    if (!isRealTarget(frame)) return;
    if (!resolveSpotifyUrl(frame)) return;

    const parent = frame.parentElement;
    if (!parent) return;

    const fr = frame.getBoundingClientRect();
    if (fr.width < 100 || fr.height < 40) return;

    ensurePositioned(parent);
    const btn = createButton(
      () => resolveSpotifyUrl(frame),
      parent,
      'dcfu-small',
      'Spotify link copied',
      'Copy Spotify link'
    );
    mountButton(btn, parent, frame, 6, 6, 'spotify');
    buttons.set(frame, btn);
  }

  // --- inline links in message text ------------------------------------------
  const inlineTarget = (node) => {
    if (!CFG.enableInlineLinks) return null;
    if (!node || !node.closest) return null;
    if (node.closest('.dcfu-btn')) return null;
    const a = node.closest('a[href]');
    if (!a) return null;

    const href = a.getAttribute('href') || '';
    if (!/^https?:/i.test(href)) return null;
    if (!a.closest('[class*="messageContent"]')) return null;
    if (!CFG.inlineLinksInEmbeds && a.closest('[class*="embedFull"]')) return null;
    // Media links already get their own in-place button.
    if (/\/attachments\/|\/ephemeral-attachments\/|\/external\//i.test(href)) return null;
    return a;
  };

  let floatBtn = null;
  let floatAnchor = null;
  let floatTimer = 0;
  const lastPointer = { x: 0, y: 0 };

  document.addEventListener(
    'pointermove',
    (e) => {
      lastPointer.x = e.clientX;
      lastPointer.y = e.clientY;
    },
    { capture: true, passive: true }
  );

  function pointerInside(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return (
      lastPointer.x >= r.left - 2 &&
      lastPointer.x <= r.right + 2 &&
      lastPointer.y >= r.top - 2 &&
      lastPointer.y <= r.bottom + 2
    );
  }

  function hideFloat() {
    clearTimeout(floatTimer);
    if (floatBtn) floatBtn.classList.remove('dcfu-show');
  }

  function scheduleHideFloat() {
    clearTimeout(floatTimer);
    floatTimer = setTimeout(() => {
      if (!floatBtn) return;
      if (floatBtn.matches(':hover')) return;
      // The link moved under the cursor (layout shift) — keep the button and
      // follow it instead of disappearing.
      if (pointerInside(floatAnchor)) {
        showFloat(floatAnchor);
        return;
      }
      floatBtn.classList.remove('dcfu-show');
    }, 180);
  }

  function getFloatButton() {
    if (floatBtn && floatBtn.isConnected) return floatBtn;

    floatBtn = document.createElement('button');
    floatBtn.type = 'button';
    floatBtn.tabIndex = -1;
    floatBtn.draggable = false;
    floatBtn.className = 'dcfu-btn dcfu-small dcfu-float';
    floatBtn.title = 'Copy link';
    floatBtn.setAttribute('aria-label', 'Copy link');
    floatBtn.innerHTML = ICON_LINK;

    floatBtn.addEventListener('pointerenter', () => clearTimeout(floatTimer));
    floatBtn.addEventListener('pointerleave', scheduleHideFloat);
    floatBtn.addEventListener('click', (e) => {
      const anchor = floatAnchor;
      onClick(e, () => (anchor ? anchor.href : ''), floatBtn, 'Link copied');
    });
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'auxclick', 'dblclick'].forEach((type) => {
      floatBtn.addEventListener(type, (e) => e.stopPropagation());
    });

    document.body.appendChild(floatBtn);
    return floatBtn;
  }

  function showFloat(anchor) {
    clearTimeout(floatTimer);
    floatAnchor = anchor;

    const btn = getFloatButton();
    const size = 26;

    // Inline elements can wrap over several lines: use the last line box so the
    // button sits at the end of the link text.
    const rects = anchor.getClientRects();
    const r = rects.length ? rects[rects.length - 1] : anchor.getBoundingClientRect();

    let left;
    let top;

    if (CFG.inlinePlacement === 'above') {
      // floating above the link
      left = r.left;
      top = r.top - size - 4;
      if (top < 4) top = r.bottom + 4;
    } else if (CFG.inlinePlacement === 'over') {
      // tucked onto the link's top-right corner
      left = r.right - size;
      top = r.top - 6;
    } else {
      // 'after' (default): trailing badge directly behind the link text
      left = r.right + 4;
      top = r.top + (r.height - size) / 2;
    }

    if (left + size > window.innerWidth - 4) left = window.innerWidth - size - 4;
    if (left < 4) left = 4;
    if (top < 4) top = 4;
    if (top + size > window.innerHeight - 4) top = window.innerHeight - size - 4;

    btn.style.setProperty('top', Math.round(top) + 'px', 'important');
    btn.style.setProperty('left', Math.round(left) + 'px', 'important');
    btn.classList.add('dcfu-show');
  }

  document.addEventListener(
    'pointerover',
    (e) => {
      const anchor = inlineTarget(e.target);
      if (anchor) {
        if (anchor !== floatAnchor) showFloat(anchor);
        return;
      }
      if (floatBtn && floatBtn.contains(e.target)) return;
      if (floatBtn && floatBtn.classList.contains('dcfu-show')) scheduleHideFloat();
    },
    true
  );

  document.addEventListener(
    'pointerout',
    (e) => {
      if (!floatBtn || !floatBtn.classList.contains('dcfu-show')) return;
      if (floatBtn.contains(e.target)) return;
      const to = e.relatedTarget;
      if (to && (to === floatBtn || floatBtn.contains(to))) return;
      if (to && inlineTarget(to) === floatAnchor) return;
      scheduleHideFloat();
    },
    true
  );

  document.addEventListener(
    'scroll',
    () => {
      refreshPlacements();
      if (!floatBtn || !floatBtn.classList.contains('dcfu-show')) return;
      if (floatBtn.matches(':hover')) return;
      if (pointerInside(floatAnchor)) {
        showFloat(floatAnchor); // follow the link while it scrolls
      } else {
        hideFloat();
      }
    },
    { capture: true, passive: true }
  );
  window.addEventListener('resize', hideFloat, { passive: true });

  // ---------------------------------------------------------------------------
  // Scanning / observing
  // ---------------------------------------------------------------------------
  function scan() {
    refreshPlacements();

    const media = document.querySelectorAll(MEDIA_SEL);
    for (let i = 0; i < media.length; i++) tryInstallMedia(media[i]);

    if (CFG.enableAudio) {
      const audio = document.querySelectorAll(AUDIO_SEL);
      for (let i = 0; i < audio.length; i++) tryInstallAudio(audio[i]);
    }

    if (CFG.enableEmbeds) {
      const embeds = document.querySelectorAll(EMBED_SEL);
      for (let i = 0; i < embeds.length; i++) tryInstallEmbed(embeds[i]);

      const invites = document.querySelectorAll(INVITE_SEL);
      for (let i = 0; i < invites.length; i++) tryInstallInvite(invites[i]);

      const spotify = document.querySelectorAll(SPOTIFY_SEL);
      for (let i = 0; i < spotify.length; i++) tryInstallSpotify(spotify[i]);
    }
  }

  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      scan();
    }, 120);
  }

  // ---------------------------------------------------------------------------
  // Settings + userscript menu
  // ---------------------------------------------------------------------------
  const SETTINGS_KEY = 'dcfu.settings.v1';
  const SETTABLE = [
    'alwaysVisible',
    'enableAudio',
    'enableEmbeds',
    'enableInlineLinks',
    'inlineLinksInEmbeds',
    'inlinePlacement',
    'embedCorner',
    'fixEmbeds',
    'preferGif',
  ];

  function loadSettings() {
    if (typeof GM_getValue !== 'function') return;
    let saved = null;
    try {
      saved = GM_getValue(SETTINGS_KEY, null);
    } catch (e) {
      return;
    }
    if (!saved || typeof saved !== 'object') return;
    SETTABLE.forEach((key) => {
      if (key in saved) CFG[key] = saved[key];
    });
    if (Array.isArray(saved.fixServices) && saved.fixServices.length) CFG.fixServices = saved.fixServices;
  }

  function saveSettings() {
    if (typeof GM_setValue !== 'function') return;
    const data = {};
    SETTABLE.forEach((key) => {
      data[key] = CFG[key];
    });
    data.fixServices = CFG.fixServices;
    try {
      GM_setValue(SETTINGS_KEY, data);
    } catch (e) {
      /* ignore */
    }
  }

  function removeKind(kind) {
    const drop = [];
    placements.forEach((info, btn) => {
      if (info.kind === kind) drop.push(btn);
    });
    drop.forEach((btn) => {
      placements.delete(btn);
      btn.remove();
    });
  }

  function applySetting(key) {
    switch (key) {
      case 'alwaysVisible':
        document.documentElement.classList.toggle('dcfu-always', !!CFG.alwaysVisible);
        break;
      case 'enableAudio':
        if (!CFG.enableAudio) removeKind('audio');
        else schedule();
        break;
      case 'enableEmbeds':
        if (!CFG.enableEmbeds) {
          removeKind('embed');
          removeKind('invite');
          removeKind('spotify');
        } else {
          schedule();
        }
        break;
      case 'enableInlineLinks':
        if (!CFG.enableInlineLinks) hideFloat();
        break;
      case 'embedCorner':
        placements.forEach((info, btn) => {
          if (info.kind === 'embed' || info.kind === 'invite') {
            btn.classList.toggle('dcfu-right', CFG.embedCorner === 'right');
          }
        });
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Settings dialog (shadow DOM so Discord's CSS can't touch it)
  // ---------------------------------------------------------------------------
  function H(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  const SETTINGS_CSS = `
:host { all: initial; }
.backdrop {
  position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
  padding: 24px; background: rgba(0, 0, 0, 0.72);
}
.panel {
  width: min(640px, 94vw); max-height: min(82vh, 780px); display: flex; flex-direction: column;
  background: #313338; color: #dbdee1; border-radius: 10px; overflow: hidden;
  box-shadow: 0 16px 56px rgba(0, 0, 0, 0.65);
  font: 14px/1.35 "gg sans", "Noto Sans", system-ui, sans-serif;
}
.panel:focus { outline: none; }
.head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 16px 20px; border-bottom: 1px solid #3f4147;
}
.head h2 { margin: 0; font-size: 17px; font-weight: 700; color: #f2f3f5; }
.body { padding: 4px 20px 16px; overflow-y: auto; }
.section { padding-top: 14px; }
.section h3 {
  margin: 0 0 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
  text-transform: uppercase; color: #949ba4;
}
.row {
  display: flex; align-items: center; justify-content: space-between; gap: 18px;
  padding: 9px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.section .row:last-of-type { border-bottom: 0; }
.left { min-width: 0; }
.label { color: #f2f3f5; font-weight: 500; }
.hint { color: #949ba4; font-size: 12px; margin-top: 2px; }
input.switch {
  appearance: none; -webkit-appearance: none; flex: none; width: 40px; height: 24px;
  margin: 0; border-radius: 12px; background: #80848e; position: relative;
  cursor: pointer; transition: background 0.15s ease;
}
input.switch::after {
  content: ""; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px;
  border-radius: 50%; background: #fff; transition: transform 0.15s ease;
}
input.switch:checked { background: #5865f2; }
input.switch:checked::after { transform: translateX(16px); }
input.switch.small { width: 34px; height: 20px; border-radius: 10px; }
input.switch.small::after { width: 14px; height: 14px; top: 3px; left: 3px; }
input.switch.small:checked::after { transform: translateX(14px); }
select, input.text {
  background: #1e1f22; color: #dbdee1; border: 1px solid #1e1f22; border-radius: 6px;
  padding: 7px 9px; font: inherit; font-size: 13px; min-width: 0;
}
select:focus, input.text:focus { outline: 2px solid #5865f2; outline-offset: 0; border-color: transparent; }
.fixlist { display: flex; flex-direction: column; }
.fixrow { display: grid; grid-template-columns: 34px 1fr 14px 1fr 28px; gap: 8px; align-items: center; padding: 6px 0; }
.arrow { color: #949ba4; text-align: center; font-size: 13px; }
button { font: inherit; cursor: pointer; border: 0; border-radius: 6px; }
button.icon {
  background: transparent; color: #b5bac1; width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center; font-size: 15px;
}
button.icon:hover { background: rgba(255, 255, 255, 0.06); color: #f2f3f5; }
button.icon.small { width: 24px; height: 24px; font-size: 13px; }
button.ghost { background: transparent; color: #dbdee1; padding: 8px 12px; font-weight: 500; }
button.ghost:hover { background: rgba(255, 255, 255, 0.06); }
button.add { color: #7d8bf7; padding: 8px 0; font-weight: 600; }
button.add:hover { color: #a5aef9; }
button.primary { background: #5865f2; color: #fff; padding: 8px 16px; font-weight: 600; }
button.primary:hover { background: #4752c4; }
.foot {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 20px; border-top: 1px solid #3f4147; background: #2b2d31;
}
`;

  let settingsHost = null;

  function ensureSettingsHost() {
    if (settingsHost && settingsHost.isConnected) return settingsHost;

    const host = document.createElement('div');
    host.id = 'dcfu-settings';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:none';
    document.documentElement.appendChild(host);
    host.attachShadow({ mode: 'open' });

    // Keep Discord from reacting to anything that happens inside the dialog.
    ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'keydown', 'keyup', 'keypress', 'wheel', 'contextmenu'].forEach((type) => {
      host.addEventListener(type, (e) => e.stopPropagation());
    });
    host.shadowRoot.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeSettings();
      }
    });

    settingsHost = host;
    return host;
  }

  function closeSettings() {
    if (settingsHost) settingsHost.style.display = 'none';
  }

  function toggleRow(label, hint, key) {
    const row = H('div', 'row');
    const left = H('div', 'left');
    left.appendChild(H('div', 'label', label));
    if (hint) left.appendChild(H('div', 'hint', hint));

    const input = H('input', 'switch');
    input.type = 'checkbox';
    input.checked = !!CFG[key];
    input.addEventListener('change', () => {
      CFG[key] = input.checked;
      saveSettings();
      applySetting(key);
    });

    row.append(left, input);
    return row;
  }

  function selectRow(label, hint, key, options) {
    const row = H('div', 'row');
    const left = H('div', 'left');
    left.appendChild(H('div', 'label', label));
    if (hint) left.appendChild(H('div', 'hint', hint));

    const sel = H('select');
    options.forEach(([value, text]) => {
      const opt = H('option', '', text);
      opt.value = value;
      sel.appendChild(opt);
    });
    sel.value = CFG[key];
    sel.addEventListener('change', () => {
      CFG[key] = sel.value;
      saveSettings();
      applySetting(key);
    });

    row.append(left, sel);
    return row;
  }

  function fixRow(rule, index) {
    const row = H('div', 'fixrow');

    const en = H('input', 'switch small');
    en.type = 'checkbox';
    en.checked = rule.enabled !== false;
    en.title = 'Enabled';
    en.addEventListener('change', () => {
      rule.enabled = en.checked;
      saveSettings();
    });

    const from = H('input', 'text');
    from.value = rule.from || '';
    from.placeholder = 'twitter.com';
    from.addEventListener('input', () => {
      rule.from = from.value.trim();
      saveSettings();
    });

    const to = H('input', 'text');
    to.value = rule.to || '';
    to.placeholder = 'fxtwitter.com';
    to.addEventListener('input', () => {
      rule.to = to.value.trim();
      saveSettings();
    });

    const del = H('button', 'icon small', '✕');
    del.title = 'Remove';
    del.addEventListener('click', () => {
      CFG.fixServices.splice(index, 1);
      saveSettings();
      renderSettings();
    });

    row.append(en, from, H('span', 'arrow', '→'), to, del);
    return row;
  }

  function resetSettings() {
    SETTABLE.forEach((key) => {
      CFG[key] = DEFAULTS[key];
    });
    CFG.fixServices = JSON.parse(JSON.stringify(DEFAULTS.fixServices));
    saveSettings();
    ['alwaysVisible', 'enableAudio', 'enableEmbeds', 'enableInlineLinks', 'embedCorner'].forEach(applySetting);
    document.documentElement.classList.toggle('dcfu-always', !!CFG.alwaysVisible);
    schedule();
    renderSettings();
    toast('Settings reset', true);
  }

  function renderSettings() {
    const host = ensureSettingsHost();
    const root = host.shadowRoot;
    root.replaceChildren();

    const style = document.createElement('style');
    style.textContent = SETTINGS_CSS;
    root.appendChild(style);

    const backdrop = H('div', 'backdrop');
    const panel = H('div', 'panel');
    panel.tabIndex = -1;

    const head = H('div', 'head');
    head.appendChild(H('h2', '', 'Copy URL — Settings'));
    const close = H('button', 'icon', '✕');
    close.title = 'Close';
    close.addEventListener('click', closeSettings);
    head.appendChild(close);

    const body = H('div', 'body');

    const secButtons = H('section', 'section');
    secButtons.appendChild(H('h3', '', 'Buttons'));
    secButtons.appendChild(toggleRow('Audio files', 'Copy button on mp3 / wav / ogg players', 'enableAudio'));
    secButtons.appendChild(toggleRow('Inline links', 'Button on http(s) links in message text', 'enableInlineLinks'));
    secButtons.appendChild(toggleRow('Always visible', 'Show the corner buttons without hovering', 'alwaysVisible'));
    body.appendChild(secButtons);

    // Everything embed-related lives in one place.
    const secEmbeds = H('section', 'section');
    secEmbeds.appendChild(H('h3', '', 'Embeds & links'));
    secEmbeds.appendChild(
      toggleRow('Link previews & invites', 'Embed cards, invite cards and Spotify players', 'enableEmbeds')
    );
    secEmbeds.appendChild(
      toggleRow('Embed-fix services', 'Rewrite twitter/x, instagram, tiktok and reddit links to a working embed', 'fixEmbeds')
    );
    secEmbeds.appendChild(
      toggleRow('GIF link fix', 'Copy the Tenor/Klipy/Giphy share page instead of the expiring CDN file', 'preferGif')
    );
    body.appendChild(secEmbeds);

    const secPlace = H('section', 'section');
    secPlace.appendChild(H('h3', '', 'Placement'));
    secPlace.appendChild(
      selectRow('Inline link button', 'Where the button sits next to a link', 'inlinePlacement', [
        ['after', 'After the link (default)'],
        ['over', 'On the link’s top-right corner'],
        ['above', 'Floating above the link'],
      ])
    );
    secPlace.appendChild(
      selectRow('Embed button corner', 'Corner used on link previews and invite cards', 'embedCorner', [
        ['left', 'Left'],
        ['right', 'Right'],
      ])
    );
    body.appendChild(secPlace);

    const secFix = H('section', 'section');
    secFix.appendChild(H('h3', '', `Fix services (${CFG.fixServices.length})`));
    const list = H('div', 'fixlist');
    CFG.fixServices.forEach((rule, i) => list.appendChild(fixRow(rule, i)));
    secFix.appendChild(list);

    const add = H('button', 'ghost add', '+ Add service');
    add.addEventListener('click', () => {
      CFG.fixServices.push({ enabled: true, from: '', to: '' });
      saveSettings();
      renderSettings();
    });
    secFix.appendChild(add);
    body.appendChild(secFix);

    const foot = H('div', 'foot');
    const reset = H('button', 'ghost', 'Reset to defaults');
    reset.addEventListener('click', resetSettings);
    const done = H('button', 'primary', 'Done');
    done.addEventListener('click', closeSettings);
    foot.append(reset, done);

    panel.append(head, body, foot);
    backdrop.appendChild(panel);
    root.appendChild(backdrop);

    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) closeSettings();
    });
  }

  function openSettings() {
    renderSettings();
    const host = ensureSettingsHost();
    host.style.display = 'block';
    const panel = host.shadowRoot.querySelector('.panel');
    if (panel) panel.focus();
  }

  function registerMenu() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    GM_registerMenuCommand('Settings…', openSettings);
  }

  function start() {
    document.documentElement.classList.toggle('dcfu-always', !!CFG.alwaysVisible);
    injectCSS();
    scan();
    registerMenu();

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src'],
    });

    window.addEventListener('resize', schedule, { passive: true });
    document.addEventListener('scroll', schedule, { capture: true, passive: true });
  }

  loadSettings();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
