import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listBookmarks,
  removeBookmark,
  subscribeBookmarks,
  buildConversationUrl,
  updateBookmark
} from '../storage';

const isExtensionContext = typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.tabs;
const HIGHLIGHT_MESSAGE = 'gpt-bookmarks:highlight';
const HIGHLIGHT_RETRY_COUNT = 10;
const HIGHLIGHT_RETRY_DELAY = 400;
const TITLE_MAX_LENGTH = 120;

const formatDate = (timestamp) => {
  if (!timestamp) {
    return '';
  }
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return '';
  }
};

const deriveConversationLabel = (bookmark) => {
  if (bookmark.conversationTitle && bookmark.conversationTitle !== 'ChatGPT') {
    return bookmark.conversationTitle;
  }
  if (bookmark.projectTitle) {
    return bookmark.projectTitle;
  }
  if (bookmark.snippet) {
    return bookmark.snippet.slice(0, 24).trim();
  }
  return '이름 없는 대화';
};

const buildTargetUrl = (bookmark) => {
  if (bookmark.url) {
    return bookmark.url;
  }

  return buildConversationUrl({
    origin: bookmark.origin,
    projectId: bookmark.projectId,
    conversationId: bookmark.conversationId
  });
};

const queryTabs = (queryInfo) => {
  if (!isExtensionContext) {
    return Promise.resolve([]);
  }
  return new Promise((resolve, reject) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      const error = chrome.runtime?.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(tabs ?? []);
    });
  });
};

const updateTab = (tabId, updateInfo) => {
  if (!isExtensionContext) {
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, updateInfo, (tab) => {
      const error = chrome.runtime?.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(tab ?? null);
    });
  });
};

const createTab = (createInfo) => {
  if (!isExtensionContext) {
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    chrome.tabs.create(createInfo, (tab) => {
      const error = chrome.runtime?.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(tab ?? null);
    });
  });
};

const sendHighlightRequest = (tabId, bookmark) => {
  if (!isExtensionContext || !tabId) {
    return Promise.resolve(false);
  }

  const messageId = bookmark.messageId ?? bookmark.id;
  if (!messageId) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    let attempts = 0;

    const attempt = () => {
      attempts += 1;
      chrome.tabs.sendMessage(
        tabId,
        {
          type: HIGHLIGHT_MESSAGE,
          payload: {
            messageId,
            snippet: bookmark.snippet
          }
        },
        (response) => {
          const error = chrome.runtime?.lastError;
          if (error) {
            if (attempts < HIGHLIGHT_RETRY_COUNT) {
              setTimeout(attempt, HIGHLIGHT_RETRY_DELAY);
              return;
            }
            console.warn('[gpt-bookmarks] 하이라이트 메시지 전송 실패:', error.message);
            resolve(false);
            return;
          }

          if (response?.ok) {
            resolve(true);
          } else if (attempts < HIGHLIGHT_RETRY_COUNT) {
            setTimeout(attempt, HIGHLIGHT_RETRY_DELAY);
          } else {
            resolve(false);
          }
        }
      );
    };

    attempt();
  });
};

const focusConversationTab = async (bookmark) => {
  const targetUrl = buildTargetUrl(bookmark);

  if (!isExtensionContext) {
    window.open(targetUrl, '_blank', 'noopener');
    return;
  }

  const urlPattern = `${targetUrl}*`;
  const matchingTabs = await queryTabs({ url: urlPattern });
  const candidate = matchingTabs?.[0];

  if (candidate?.id) {
    await updateTab(candidate.id, { active: true });
    await sendHighlightRequest(candidate.id, bookmark);
    return;
  }

  const [activeTab] = await queryTabs({ active: true, lastFocusedWindow: true });

  const highlightAfterLoad = (tabId) => {
    if (!tabId) {
      return;
    }

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId) {
        return;
      }
      if (changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(() => {
          void sendHighlightRequest(tabId, bookmark);
        }, 300);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  };

  if (activeTab?.id) {
    try {
      await updateTab(activeTab.id, { url: targetUrl });
      highlightAfterLoad(activeTab.id);
    } catch (error) {
      console.warn('[gpt-bookmarks] 탭 이동 실패, 새 탭을 생성합니다.', error);
      const newTab = await createTab({ url: targetUrl });
      if (newTab?.id) {
        highlightAfterLoad(newTab.id);
      }
    }
    return;
  }

  const newTab = await createTab({ url: targetUrl });
  if (newTab?.id) {
    highlightAfterLoad(newTab.id);
  }
};

const App = () => {
  const [bookmarks, setBookmarks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  const [editing, setEditing] = useState({ id: null, value: '' });
  const [searchQuery, setSearchQuery] = useState('');
  const editingInputRef = useRef(null);

  useEffect(() => {
    if (!editing.id) {
      return;
    }

    const input = editingInputRef.current;
    if (input) {
      input.focus();
      input.select();
    }
  }, [editing.id]);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        const result = await listBookmarks();
        if (!cancelled) {
          setBookmarks(result);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    hydrate();

    const unsubscribe = subscribeBookmarks((next) => {
      if (!cancelled) {
        setBookmarks(next);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const normalizedQuery = useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery]);

  const filteredBookmarks = useMemo(() => {
    if (!normalizedQuery) {
      return bookmarks;
    }

    return bookmarks.filter((bookmark) => {
      const candidates = [
        bookmark.title,
        bookmark.snippet,
        bookmark.conversationTitle,
        bookmark.projectTitle
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return candidates.includes(normalizedQuery);
    });
  }, [bookmarks, normalizedQuery]);

  const grouped = useMemo(() => {
    const map = new Map();

    filteredBookmarks.forEach((bookmark) => {
      const key = bookmark.projectId ?? bookmark.conversationId ?? bookmark.conversationTitle ?? 'unknown';
      if (!map.has(key)) {
        map.set(key, {
          key,
          title: deriveConversationLabel(bookmark),
          items: []
        });
      }

      map.get(key).items.push(bookmark);
    });

    return Array.from(map.values()).map((group) => ({
      ...group,
      items: group.items.slice().sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))
    }));
  }, [filteredBookmarks]);

  const toggleGroup = useCallback((key) => {
    if (!key) {
      return;
    }

    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const handleRemove = async (id) => {
    if (!id) {
      return;
    }

    if (editing.id === id) {
      setEditing({ id: null, value: '' });
    }

    const confirmed = window.confirm('이 즐겨찾기를 삭제하시겠습니까?');
    if (!confirmed) {
      return;
    }

    try {
      await removeBookmark(id);
    } catch (error) {
      console.error('[gpt-bookmarks] 즐겨찾기 삭제 오류:', error);
    }
  };

  const beginEdit = (bookmark) => {
    if (!bookmark?.id) {
      return;
    }

    const initialValue =
      bookmark.title?.trim() ||
      bookmark.snippet?.slice(0, 60).trim() ||
      bookmark.conversationTitle ||
      '제목 없음';

    setEditing({
      id: bookmark.id,
      value: initialValue.slice(0, TITLE_MAX_LENGTH)
    });
  };

  const cancelEdit = () => {
    setEditing({ id: null, value: '' });
  };

  const commitEdit = async (bookmark) => {
    if (!bookmark?.id || editing.id !== bookmark.id) {
      return;
    }

    const trimmed = editing.value.trim().slice(0, TITLE_MAX_LENGTH);
    const currentTitle = bookmark.title ?? '';

    if (trimmed.length === 0 || trimmed === currentTitle.trim()) {
      cancelEdit();
      return;
    }

    try {
      await updateBookmark(bookmark.id, { title: trimmed });
      setBookmarks((prev) =>
        prev.map((item) => (item.id === bookmark.id ? { ...item, title: trimmed } : item))
      );
      cancelEdit();
    } catch (error) {
      console.error('[gpt-bookmarks] 제목 업데이트 중 오류가 발생했습니다.', error);
    }
  };

  const handleOpen = async (bookmark) => {
    if (!bookmark) {
      return;
    }

    if (editing.id === bookmark.id) {
      return;
    }

    try {
      await focusConversationTab(bookmark);
    } catch (error) {
      console.error('[gpt-bookmarks] 대화 이동 중 오류가 발생했습니다.', error);
      const targetUrl = buildTargetUrl(bookmark);
      window.open(targetUrl, '_blank', 'noopener');
    }
  };

  const handleItemKeyDown = (event, bookmark, isEditing) => {
    if (isEditing) {
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void handleOpen(bookmark);
    }
  };

  const handleTitleInputKeyDown = (event, bookmark) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void commitEdit(bookmark);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelEdit();
    }
  };

  return (
    <div className="sidepanel">
      <header className="sidepanel__header">
        <h1 className="sidepanel__title">GPT Favorites</h1>
        <p className="sidepanel__subtitle">Bookmark and revisit ChatGPT answers with ease.</p>
        <label className="sidepanel__search" htmlFor="bookmark-search">
          <span className="sidepanel__search-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path
                d="M11 4a7 7 0 1 1-4.95 11.95L4 18l2.05-2.05A7 7 0 0 1 11 4Zm0 2a5 5 0 1 0 3.54 8.54A5 5 0 0 0 11 6Z"
                fill="currentColor"
                fillRule="evenodd"
              />
            </svg>
          </span>
          <input
            id="bookmark-search"
            type="search"
            className="sidepanel__search-input"
            placeholder="제목 또는 내용으로 검색"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="sidepanel__search-clear"
              onClick={() => setSearchQuery('')}
              aria-label="검색어 지우기"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M6 18 18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </label>
      </header>

      {loading ? (
        <section className="sidepanel__empty">
          <p>즐겨찾기를 불러오는 중입니다…</p>
        </section>
      ) : bookmarks.length === 0 ? (
        <section className="sidepanel__empty">
          <p>아직 즐겨찾기한 답변이 없습니다.</p>
          <p>ChatGPT 답변 옆의 별 아이콘을 눌러 즐겨찾기를 추가하세요.</p>
        </section>
      ) : grouped.length === 0 ? (
        <section className="sidepanel__empty">
          <p>검색 결과가 없습니다.</p>
          <p>다른 키워드로 다시 검색해 보세요.</p>
        </section>
      ) : (
        <section className="sidepanel__groups" aria-live="polite">
          {grouped.map((group) => {
            const isExpanded = normalizedQuery ? true : expandedGroups.has(group.key);
            const visibleItems = isExpanded ? group.items : group.items.slice(0, 1);
            const showToggle = !normalizedQuery && group.items.length > 1;

            return (
              <article key={group.key} className="sidepanel__group">
                <header className="sidepanel__group-header">
                  <span className="sidepanel__group-title">{group.title}</span>
                  {showToggle && (
                    <button
                      type="button"
                      className={`sidepanel__group-toggle${isExpanded ? ' is-expanded' : ''}`}
                      onClick={() => toggleGroup(group.key)}
                      aria-expanded={isExpanded}
                      aria-label={isExpanded ? '그룹 접기' : '그룹 펼치기'}
                    >
                      <svg className="sidepanel__group-toggle-icon" viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M6 9l6 6 6-6"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  )}
                </header>

                <ul className="sidepanel__list">
                  {visibleItems.map((bookmark) => {
                    const isEditing = editing.id === bookmark.id;

                    return (
                      <li key={bookmark.id} className="sidepanel__item">
                        <div
                          className={`sidepanel__item-main${isEditing ? ' is-editing' : ''}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => handleOpen(bookmark)}
                          onKeyDown={(event) => handleItemKeyDown(event, bookmark, isEditing)}
                        >
                          <div className="sidepanel__item-header">
                            {isEditing ? (
                              <input
                                ref={editingInputRef}
                                className="sidepanel__item-title-input"
                                value={editing.value}
                                maxLength={TITLE_MAX_LENGTH}
                                onChange={(event) =>
                                  setEditing((prev) => ({
                                    ...prev,
                                    value: event.target.value
                                  }))
                                }
                                onKeyDown={(event) => handleTitleInputKeyDown(event, bookmark)}
                                onClick={(event) => event.stopPropagation()}
                              />
                            ) : (
                              <span
                                className="sidepanel__item-title"
                                title={bookmark.title ?? '제목 없음'}
                              >
                                {bookmark.title ?? '제목 없음'}
                              </span>
                            )}
                            <div className="sidepanel__item-icons">
                              <button
                                type="button"
                                className={`sidepanel__item-icon ${
                                  isEditing ? 'sidepanel__item-icon--confirm' : 'sidepanel__item-icon--edit'
                                }`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (isEditing) {
                                    void commitEdit(bookmark);
                                  } else {
                                    beginEdit(bookmark);
                                  }
                                }}
                                aria-label={isEditing ? '제목 수정 확인' : '제목 편집'}
                              >
                                <svg className="sidepanel__item-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
                                  {isEditing ? (
                                    <path
                                      d="M5 13l4 4 10-10"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  ) : (
                                    <path
                                      d="M4 17.25V20h2.75l8.1-8.1-2.75-2.75L4 17.25zm14.71-9.54a1 1 0 0 0 0-1.41l-1.6-1.6a1 1 0 0 0-1.41 0l-1.37 1.37 2.75 2.75 1.63-1.11Z"
                                      fill="currentColor"
                                    />
                                  )}
                                </svg>
                              </button>
                              {isEditing && (
                                <button
                                  type="button"
                                  className="sidepanel__item-icon sidepanel__item-icon--cancel"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    cancelEdit();
                                  }}
                                  aria-label="제목 수정 취소"
                                >
                                  <svg className="sidepanel__item-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
                                    <path
                                      d="M6 6l12 12M6 18L18 6"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                    />
                                  </svg>
                                </button>
                              )}
                              <button
                                type="button"
                                className="sidepanel__item-icon sidepanel__item-icon--remove"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleRemove(bookmark.id);
                                }}
                                aria-label="즐겨찾기 삭제"
                              >
                                <svg className="sidepanel__item-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
                                  <path
                                    d="M6 6h12M9 6V4h6v2m-1 4v8m-4-8v8M7 6h10l-1 14H8L7 6Z"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.6"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              </button>
                            </div>
                          </div>
                          <span className="sidepanel__item-snippet">{bookmark.snippet}</span>
                          <span className="sidepanel__item-meta">{formatDate(bookmark.savedAt)}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
};

export default App;
