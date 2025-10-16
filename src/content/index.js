const SYNC_KEY = 'gptBookmarks';
const CONTENT_PREFIX = 'gptBookmarkContent:';
const LOCAL_CONTENT_MAX_BYTES = 1024 * 1024 * 2;

const BUTTON_CLASS = 'gpt-bookmark-btn';
const WRAPPER_CLASS = 'gpt-bookmark-wrapper';
const ENHANCED_ATTR = 'data-gpt-bookmark-enhanced';
const HIGHLIGHT_CLASS = 'gpt-bookmark-highlight';
const STYLE_ID = 'gpt-bookmark-style';
const HIGHLIGHT_DURATION = 2400;
const ICON_CLASS = 'gpt-bookmark-icon';
const ICON_PATH_CLASS = 'gpt-bookmark-icon-path';
const TITLE_MAX_LENGTH = 120;

const MESSAGE_NODE_SELECTOR = '[data-message-id]';
const ASSISTANT_SELECTOR = '[data-message-author-role="assistant"]';
const TURN_SELECTOR = '[data-testid="conversation-turn"]';
const MARKDOWN_SELECTOR = '.markdown';

const PROJECT_TITLE_SELECTORS = [
  '[data-testid="project-title"]',
  '[data-testid="project-header-title"]',
  '[data-testid="project-header"] h1',
  '[data-testid="project-header"] span',
  '[data-testid="workspace-switcher-current"]',
  '[data-testid="project-name"]'
];

const bookmarkedIds = new Map(); // messageId -> bookmarkId
const activeHighlights = new Map(); // host -> timeoutId

let pendingHighlight = null;
let highlightIntervalId = null;
let initialised = false;

function deriveTitle(rawTitle, ...fallbacks) {
  const candidates = [
    typeof rawTitle === 'string' ? rawTitle : null,
    ...fallbacks
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') {
      continue;
    }
    const trimmed = candidate.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const firstLine = trimmed.split('\n').map((line) => line.trim()).find((line) => line.length > 0) ?? trimmed;
    if (firstLine.length > 0) {
      return firstLine.slice(0, TITLE_MAX_LENGTH);
    }
  }

  return '제목 없음';
}

function promptBookmarkTitle(defaultTitle) {
  const message = '즐겨찾기 제목을 입력하세요. 취소하면 저장되지 않습니다.';
  const result = window.prompt(message, defaultTitle);
  if (result === null) {
    return null;
  }
  const trimmed = result.trim();
  if (trimmed.length === 0) {
    return defaultTitle;
  }
  return trimmed.slice(0, TITLE_MAX_LENGTH);
}

function getSyncArea() {
  if (typeof chrome !== 'undefined' && chrome?.storage?.sync) {
    return chrome.storage.sync;
  }
  return chrome.storage?.local ?? null;
}

function getLocalArea() {
  if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
    return chrome.storage.local;
  }
  return null;
}

function promisify(area, method, ...args) {
  return new Promise((resolve, reject) => {
    if (!area?.[method]) {
      resolve();
      return;
    }

    area[method](...args, (result) => {
      const error = chrome.runtime?.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(result);
    });
  });
}

function normaliseList(raw) {
  if (!raw) {
    return [];
  }
  return Array.isArray(raw) ? raw : [];
}

async function listBookmarks() {
  const sync = getSyncArea();
  try {
    const result = await promisify(sync, 'get', SYNC_KEY);
    const raw = result?.[SYNC_KEY];
    return normaliseList(raw)
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        ...entry,
        savedAt: entry.savedAt ?? Date.now(),
        snippet: entry.snippet ?? '',
        title: deriveTitle(entry.title, entry.snippet ?? '', entry.conversationTitle ?? ''),
        conversationTitle: entry.conversationTitle ?? 'ChatGPT',
        projectId: entry.projectId ?? null,
        projectTitle: entry.projectTitle ?? null,
        origin: entry.origin ?? null,
        messageId: entry.messageId ?? entry.id
      }))
      .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
  } catch (error) {
    console.warn('[gpt-bookmarks] chrome.storage.sync.get 실패:', error);
    return [];
  }
}

async function writeBookmarks(entries) {
  const sync = getSyncArea();
  await promisify(sync, 'set', { [SYNC_KEY]: entries });
}

function getContentKey(id) {
  return `${CONTENT_PREFIX}${id}`;
}

async function saveBookmarkContent(id, content) {
  if (typeof content !== 'string' || content.length === 0) {
    return false;
  }

  const local = getLocalArea();
  if (!local) {
    return false;
  }

  const truncated = content.length > LOCAL_CONTENT_MAX_BYTES
    ? content.slice(0, LOCAL_CONTENT_MAX_BYTES)
    : content;

  const payload = {
    [getContentKey(id)]: {
      content: truncated,
      updatedAt: Date.now()
    }
  };

  await promisify(local, 'set', payload);
  return !!payload[getContentKey(id)].content;
}

async function removeBookmarkContent(id) {
  if (!id) {
    return;
  }

  const local = getLocalArea();
  if (!local) {
    return;
  }

  await promisify(local, 'remove', getContentKey(id)).catch((error) => {
    console.warn('[gpt-bookmarks] remove content failed:', error);
  });
}

async function addBookmarkEntry(bookmark) {
  if (!bookmark) {
    throw new Error('Bookmark payload is required');
  }

  const existing = await listBookmarks();
  const canonicalId = bookmark.messageId || bookmark.id || crypto.randomUUID();
  const messageId = bookmark.messageId ?? canonicalId;

  const entry = {
    id: canonicalId,
    messageId,
    conversationId: bookmark.conversationId ?? null,
    conversationTitle: bookmark.conversationTitle ?? 'ChatGPT',
    projectId: bookmark.projectId ?? null,
    projectTitle: bookmark.projectTitle ?? null,
    origin: bookmark.origin ?? null,
    snippet: (bookmark.snippet ?? '').slice(0, 160),
    title: deriveTitle(
      bookmark.title,
      bookmark.content ?? '',
      bookmark.snippet ?? '',
      bookmark.conversationTitle ?? ''
    ),
    url: bookmark.url,
    savedAt: bookmark.savedAt ?? Date.now(),
    hasContent: false
  };

  if (bookmark.content) {
    entry.hasContent = await saveBookmarkContent(canonicalId, bookmark.content);
  }

  const next = [
    ...existing.filter((item) => item.id !== canonicalId),
    entry
  ].sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));

  try {
    await writeBookmarks(next);
  } catch (error) {
    await removeBookmarkContent(canonicalId);
    throw error;
  }

  return entry;
}

async function removeBookmarkEntry(id) {
  if (!id) {
    return;
  }

  const existing = await listBookmarks();
  const next = existing.filter((item) => item.id !== id);
  await writeBookmarks(next);
  await removeBookmarkContent(id);
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .${WRAPPER_CLASS} {
      position: absolute;
      inset-inline-start: -36px;
      top: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2;
    }

    .${BUTTON_CLASS} {
      width: 28px;
      height: 28px;
      border-radius: 999px;
      border: none;
      background: rgba(15, 23, 42, 0.65);
      color: #94a3b8;
      cursor: pointer;
      font-size: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 160ms ease, color 160ms ease, background-color 160ms ease;
      padding: 0;
    }

    .${BUTTON_CLASS} .${ICON_CLASS} {
      width: 18px;
      height: 18px;
      display: block;
    }

    .${BUTTON_CLASS} .${ICON_CLASS} .${ICON_PATH_CLASS} {
      fill: rgba(148, 163, 184, 0.85);
      stroke: transparent;
      stroke-width: 0;
      transition: fill 160ms ease, stroke 160ms ease, stroke-width 160ms ease;
    }

    .${BUTTON_CLASS}:hover {
      transform: scale(1.05);
      background: rgba(15, 23, 42, 0.9);
    }

    .${BUTTON_CLASS}:hover .${ICON_CLASS} .${ICON_PATH_CLASS} {
      fill: rgba(250, 204, 21, 0.72);
    }

    .${BUTTON_CLASS}.is-active {
      background: rgba(234, 179, 8, 0.18);
    }

    .${BUTTON_CLASS}.is-active .${ICON_CLASS} .${ICON_PATH_CLASS} {
      fill: #facc15;
      stroke: rgba(245, 158, 11, 0.6);
      stroke-width: 0.8;
    }

    .${HIGHLIGHT_CLASS} {
      outline: 2px solid rgba(250, 204, 21, 0.9);
      box-shadow: 0 0 0 2px rgba(15, 23, 42, 0.9), 0 0 18px rgba(250, 204, 21, 0.45);
      border-radius: 18px;
      transition: outline 200ms ease, box-shadow 200ms ease, background 200ms ease;
      background: rgba(250, 204, 21, 0.08);
    }

    @media (max-width: 1024px) {
      .${WRAPPER_CLASS} {
        inset-inline-start: 0;
        top: -38px;
        position: relative;
        margin-bottom: 8px;
        justify-content: flex-start;
      }
    }
  `;

  document.head.appendChild(style);
}

function ensureBookmarkIcon(button) {
  if (!button || button.querySelector(`.${ICON_CLASS}`)) {
    return;
  }

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add(ICON_CLASS);

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M6 2h12a2 2 0 0 1 2 2v18l-8-4-8 4V4a2 2 0 0 1 2-2z');
  path.classList.add(ICON_PATH_CLASS);

  svg.appendChild(path);
  button.appendChild(svg);
}

function cssEscape(value) {
  if (typeof value !== 'string') {
    return '';
  }

  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }

  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

function getConversationTitle() {
  const title = document.title ?? '';
  return title.replace(/ - ChatGPT.*$/, '').trim() || 'ChatGPT';
}

function getProjectTitle() {
  for (const selector of PROJECT_TITLE_SELECTORS) {
    const element = document.querySelector(selector);
    if (element && element.textContent) {
      const text = element.textContent.trim();
      if (text) {
        return text;
      }
    }
  }

  return null;
}

function getPageContext() {
  const origin = window.location.origin;
  const segments = window.location.pathname.split('/').filter(Boolean);

  let projectId = null;
  let conversationId = null;

  if (segments.length > 0) {
    if (segments[0] === 'p') {
      projectId = segments[1] ?? null;
      const conversationIndex = segments.indexOf('c');
      if (conversationIndex !== -1 && segments[conversationIndex + 1]) {
        conversationId = segments[conversationIndex + 1];
      }
    } else if (segments[0] === 'c') {
      conversationId = segments[1] ?? null;
    }
  }

  return {
    origin,
    projectId,
    conversationId,
    projectTitle: getProjectTitle()
  };
}

function hashText(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return `tx_${Math.abs(hash)}`;
}

function identifyMessageNode(node) {
  if (!(node instanceof HTMLElement)) {
    return null;
  }

  if (node.dataset?.messageId && node.dataset.messageAuthorRole === 'assistant') {
    return node;
  }

  return node.closest(ASSISTANT_SELECTOR);
}

function extractMessageId(messageNode) {
  if (!messageNode) {
    return null;
  }

  const explicitId = messageNode.dataset?.messageId;
  if (explicitId) {
    return explicitId;
  }

  const turn = messageNode.closest(TURN_SELECTOR);
  if (turn?.dataset?.turnId) {
    return turn.dataset.turnId;
  }

  const markdown = messageNode.querySelector(MARKDOWN_SELECTOR);
  const text = markdown?.innerText?.trim();
  if (text) {
    return hashText(text);
  }

  return null;
}

function buildTargetUrl(context) {
  return buildConversationUrl({
    origin: context.origin,
    projectId: context.projectId,
    conversationId: context.conversationId
  });
}

function buildConversationUrl({ origin, projectId, conversationId }) {
  const base = origin || window.location.origin;
  const segments = [];

  if (projectId) {
    segments.push('p', projectId);
  }

  if (conversationId) {
    segments.push('c', conversationId);
  }

  if (segments.length === 0) {
    return window.location.href;
  }

  return `${base}/${segments.join('/')}`;
}

function buildBookmarkPayload(markdownEl) {
  if (!markdownEl) {
    return null;
  }

  const host = identifyMessageNode(markdownEl);
  if (!host) {
    return null;
  }

  const messageId = extractMessageId(host);
  if (!messageId) {
    return null;
  }

  const text = markdownEl.innerText.trim();
  const snippet = text.slice(0, 160);
  const context = getPageContext();
  const url = buildTargetUrl(context);
  const title = deriveTitle(null, text, snippet);

  return {
    id: messageId,
    messageId,
    conversationId: context.conversationId,
    projectId: context.projectId,
    projectTitle: context.projectTitle,
    origin: context.origin,
    conversationTitle: getConversationTitle(),
    snippet,
    title,
    content: text,
    url,
    savedAt: Date.now()
  };
}

function ensureWrapper(host) {
  if (!host) {
    return null;
  }

  if (host.hasAttribute(ENHANCED_ATTR)) {
    const existing = host.querySelector(`button.${BUTTON_CLASS}`);
    if (existing) {
      ensureBookmarkIcon(existing);
    }
    return existing ?? null;
  }

  const computed = window.getComputedStyle(host);
  if (computed.position === 'static') {
    host.style.position = 'relative';
  }

  const wrapper = document.createElement('div');
  wrapper.className = WRAPPER_CLASS;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = BUTTON_CLASS;
  ensureBookmarkIcon(button);
  wrapper.appendChild(button);

  host.insertBefore(wrapper, host.firstChild);
  host.setAttribute(ENHANCED_ATTR, 'true');

  return button;
}

function updateButtonVisual(button, active) {
  button.classList.toggle('is-active', active);
  button.setAttribute('aria-pressed', String(active));
  button.title = active ? '즐겨찾기에서 제거' : '즐겨찾기에 추가';
  button.setAttribute('aria-label', button.title);
}

function highlightHost(host) {
  if (!host) {
    return false;
  }

  host.scrollIntoView({ behavior: 'smooth', block: 'center' });

  if (activeHighlights.has(host)) {
    clearTimeout(activeHighlights.get(host));
  }

  host.classList.add(HIGHLIGHT_CLASS);
  const timeoutId = window.setTimeout(() => {
    host.classList.remove(HIGHLIGHT_CLASS);
    activeHighlights.delete(host);
  }, HIGHLIGHT_DURATION);

  activeHighlights.set(host, timeoutId);
  return true;
}

function findHostByMessageId(messageId) {
  if (!messageId) {
    return null;
  }

  const escaped = cssEscape(messageId);
  const node = document.querySelector(`[data-message-id="${escaped}"]`);
  if (!node) {
    return null;
  }

  const host = identifyMessageNode(node);
  if (host) {
    return host.closest(TURN_SELECTOR) || host;
  }

  return node.closest(TURN_SELECTOR) || node;
}

function highlightById(messageId) {
  if (!messageId) {
    return false;
  }

  const host = findHostByMessageId(messageId);
  if (host) {
    return highlightHost(host);
  }

  return false;
}

function requestHighlight(messageId) {
  if (!messageId) {
    return false;
  }

  if (highlightById(messageId)) {
    pendingHighlight = null;
    return true;
  }

  pendingHighlight = { id: messageId, attempts: 0 };
  return false;
}

function processPendingHighlight() {
  if (!pendingHighlight) {
    return;
  }

  const { id, attempts } = pendingHighlight;
  if (highlightById(id)) {
    pendingHighlight = null;
    return;
  }

  if (attempts > 40) {
    pendingHighlight = null;
    return;
  }

  pendingHighlight.attempts += 1;
}

async function handleToggle(button, markdownEl) {
  const payload = buildBookmarkPayload(markdownEl);
  if (!payload) {
    return;
  }

  const key = payload.messageId;
  const storedId = bookmarkedIds.get(key);

  try {
    if (storedId) {
      await removeBookmarkEntry(storedId);
      bookmarkedIds.delete(key);
      updateButtonVisual(button, false);
    } else {
      const defaultTitle = payload.title ?? deriveTitle(null, payload.snippet ?? '', payload.conversationTitle ?? '');
      const requestedTitle = promptBookmarkTitle(defaultTitle);
      if (requestedTitle === null) {
        return;
      }
      payload.title = requestedTitle;

      const saved = await addBookmarkEntry(payload);
      bookmarkedIds.set(key, saved.id);
      updateButtonVisual(button, true);
    }
  } catch (error) {
    console.error('[gpt-bookmarks] 즐겨찾기 토글 중 오류가 발생했습니다.', error);
  }
}

function enhanceMessage(node) {
  const host = identifyMessageNode(node);
  if (!host) {
    return;
  }

  const markdown = host.querySelector(MARKDOWN_SELECTOR);
  if (!markdown) {
    return;
  }

  const messageId = extractMessageId(host);
  if (!messageId) {
    return;
  }

  const button = ensureWrapper(host);
  if (!button) {
    return;
  }

  button.dataset.messageId = messageId;
  updateButtonVisual(button, bookmarkedIds.has(messageId));

  if (!button.dataset.gptBookmarkBound) {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      handleToggle(button, markdown);
    });
    button.dataset.gptBookmarkBound = 'true';
  }

  if (pendingHighlight?.id === messageId) {
    highlightById(messageId);
    pendingHighlight = null;
  }
}

function scanAndEnhance(root = document) {
  const nodes = root.querySelectorAll(MESSAGE_NODE_SELECTOR);
  nodes.forEach((node) => {
    const host = identifyMessageNode(node);
    if (host && host.dataset.messageAuthorRole === 'assistant') {
      enhanceMessage(host);
    }
  });

  processPendingHighlight();
}

function observeMutations() {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) {
          return;
        }

        if (node.matches?.(MESSAGE_NODE_SELECTOR)) {
          const host = identifyMessageNode(node);
          if (host && host.dataset.messageAuthorRole === 'assistant') {
            enhanceMessage(host);
          }
        } else {
          scanAndEnhance(node);
        }
      });
    });

    processPendingHighlight();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

function refreshButtonsFromStorage(entries) {
  bookmarkedIds.clear();
  entries.forEach((entry) => {
    const key = entry.messageId ?? entry.id;
    if (key) {
      bookmarkedIds.set(key, entry.id);
    }
  });

  document.querySelectorAll(`button.${BUTTON_CLASS}`).forEach((button) => {
    const id = button.dataset.messageId;
    updateButtonVisual(button, id ? bookmarkedIds.has(id) : false);
  });
}

function setupStorageSubscription() {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) {
    return () => {};
  }

  const handler = (changes, area) => {
    if (area !== 'sync' || !changes?.[SYNC_KEY]) {
      return;
    }

    const next = normaliseList(changes[SYNC_KEY].newValue);
    refreshButtonsFromStorage(next);
  };

  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

function setupMessaging() {
  if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) {
    return;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== 'gpt-bookmarks:highlight') {
      return false;
    }

    const messageId = message.payload?.messageId ?? message.payload?.id;
    const ok = requestHighlight(messageId);
    sendResponse?.({ ok });
    return false;
  });
}

async function bootstrap() {
  if (initialised) {
    return;
  }

  initialised = true;

  injectStyles();

  try {
    const existing = await listBookmarks();
    refreshButtonsFromStorage(existing);
  } catch (error) {
    console.warn('[gpt-bookmarks] 초기 즐겨찾기 로드 실패:', error);
  }

  setupStorageSubscription();
  scanAndEnhance();
  observeMutations();
  setupMessaging();

  if (!highlightIntervalId) {
    highlightIntervalId = window.setInterval(processPendingHighlight, 800);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}

window.addEventListener('beforeunload', () => {
  if (highlightIntervalId) {
    clearInterval(highlightIntervalId);
  }
});
