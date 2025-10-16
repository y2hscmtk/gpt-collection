import {
  listBookmarks,
  addBookmark,
  removeBookmark,
  buildConversationUrl
} from '../shared/bookmarks';

const MESSAGE_SCOPE = 'gpt-bookmarks';
const panelStateByWindow = new Map();

async function ensurePanelBehavior() {
  if (!chrome.sidePanel?.setPanelBehavior) {
    return;
  }

  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  } catch (error) {
    console.warn('[gpt-bookmarks] Failed to set side panel behaviour:', error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  ensurePanelBehavior();
});

ensurePanelBehavior();

if (chrome.sidePanel?.onClosed) {
  chrome.sidePanel.onClosed.addListener(({ windowId }) => {
    panelStateByWindow.set(windowId, false);
  });
}

if (chrome.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener((_tabId, removeInfo) => {
    if (typeof removeInfo?.windowId === 'number') {
      panelStateByWindow.delete(removeInfo.windowId);
    }
  });
}

chrome.action?.onClicked.addListener(async (tab) => {
  if (!tab?.windowId) {
    return;
  }

  const windowId = tab.windowId;
  const isOpen = panelStateByWindow.get(windowId) ?? false;

  try {
    if (isOpen && chrome.sidePanel?.close) {
      await chrome.sidePanel.close({ windowId });
      panelStateByWindow.set(windowId, false);
    } else {
      await chrome.sidePanel.open({ windowId });
      panelStateByWindow.set(windowId, true);
    }
  } catch (error) {
    console.warn('[gpt-bookmarks] Side panel toggle failed:', error);
  }
});

function respondOk(sendResponse, data) {
  sendResponse({ ok: true, data });
}

function respondError(sendResponse, error) {
  sendResponse({ ok: false, error: error?.message ?? String(error) });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.scope !== MESSAGE_SCOPE) {
    return undefined;
  }

  (async () => {
    switch (message.type) {
      case 'list': {
        const bookmarks = await listBookmarks();
        respondOk(sendResponse, bookmarks);
        break;
      }
      case 'add': {
        const payload = message.payload || {};
        if (!payload.url) {
          payload.url = buildConversationUrl({
            origin: payload.origin,
            projectId: payload.projectId,
            conversationId: payload.conversationId
          });
        }
        const saved = await addBookmark(payload);
        respondOk(sendResponse, saved);
        break;
      }
      case 'remove': {
        await removeBookmark(message.payload?.id);
        respondOk(sendResponse, null);
        break;
      }
      default: {
        sendResponse({
          ok: false,
          error: `Unknown message type: ${message.type}`
        });
      }
    }
  })().catch((error) => {
    respondError(sendResponse, error);
  });

  return true;
});
