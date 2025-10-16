import storage from './chromeStorage';

const TITLE_MAX_LENGTH = 120;

function normaliseList(raw) {
  if (!raw) {
    return [];
  }
  return Array.isArray(raw) ? raw : [];
}

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

function normaliseBookmarks(raw) {
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
}

export async function listBookmarks() {
  const sync = storage.getSyncArea();
  try {
    const result = await storage.promisify(sync, 'get', storage.SYNC_KEY);
    const raw = result?.[storage.SYNC_KEY];
    return normaliseBookmarks(raw);
  } catch (error) {
    console.warn('[gpt-bookmarks] chrome.storage.sync.get failed:', error);
    return [];
  }
}

async function writeBookmarks(entries) {
  const sync = storage.getSyncArea();
  await storage.promisify(sync, 'set', { [storage.SYNC_KEY]: entries });
}

function getContentKey(id) {
  return `${storage.CONTENT_PREFIX}${id}`;
}

async function saveBookmarkContent(id, content) {
  if (typeof content !== 'string' || content.length === 0) {
    return false;
  }

  const local = storage.getLocalArea();
  if (!local) {
    return false;
  }

  const truncated = content.length > storage.LOCAL_CONTENT_MAX_BYTES
    ? content.slice(0, storage.LOCAL_CONTENT_MAX_BYTES)
    : content;

  const payload = {
    [getContentKey(id)]: {
      content: truncated,
      updatedAt: Date.now()
    }
  };

  await storage.promisify(local, 'set', payload);
  return !!payload[getContentKey(id)].content;
}

async function removeBookmarkContent(id) {
  if (!id) {
    return;
  }

  const local = storage.getLocalArea();
  if (!local) {
    return;
  }

  await storage.promisify(local, 'remove', getContentKey(id)).catch((error) => {
    console.warn('[gpt-bookmarks] remove content failed:', error);
  });
}

export async function addBookmark(bookmark) {
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

export async function removeBookmark(id) {
  if (!id) {
    return;
  }

  const existing = await listBookmarks();
  const next = existing.filter((item) => item.id !== id);
  await writeBookmarks(next);
  await removeBookmarkContent(id);
}

export async function updateBookmark(id, updates) {
  if (!id) {
    throw new Error('Bookmark id is required');
  }
  if (!updates || typeof updates !== 'object') {
    return null;
  }

  const existing = await listBookmarks();
  const index = existing.findIndex((item) => item.id === id);
  if (index === -1) {
    return null;
  }

  const current = existing[index];
  const nextEntry = {
    ...current,
    ...updates
  };

  if ('title' in updates) {
    nextEntry.title = deriveTitle(updates.title, updates.snippet ?? current.snippet, current.conversationTitle);
  }

  const next = existing
    .map((item, idx) => (idx === index ? nextEntry : item))
    .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));

  await writeBookmarks(next);
  return nextEntry;
}

export function subscribeBookmarks(callback) {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) {
    return () => {};
  }

  const handler = (changes, area) => {
    if (area !== 'sync' || !changes?.[storage.SYNC_KEY]) {
      return;
    }

    const next = normaliseBookmarks(changes[storage.SYNC_KEY].newValue);
    callback(next);
  };

  chrome.storage.onChanged.addListener(handler);

  return () => {
    chrome.storage.onChanged.removeListener(handler);
  };
}

export function buildConversationUrl({ origin, projectId, conversationId }) {
  const base = origin || (typeof window !== 'undefined' ? window.location.origin : 'https://chatgpt.com');
  const segments = [];

  if (projectId) {
    segments.push('p', projectId);
  }

  if (conversationId) {
    segments.push('c', conversationId);
  }

  if (segments.length === 0) {
    return typeof window !== 'undefined' ? window.location.href : base;
  }

  return `${base}/${segments.join('/')}`;
}

export const storageUtils = {
  writeBookmarks,
  saveBookmarkContent,
  removeBookmarkContent
};
