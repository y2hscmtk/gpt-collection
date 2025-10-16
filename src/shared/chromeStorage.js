const SYNC_KEY = 'gptBookmarks';
const CONTENT_PREFIX = 'gptBookmarkContent:';
const LOCAL_CONTENT_MAX_BYTES = 1024 * 1024 * 2;

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

const storageUtils = {
  SYNC_KEY,
  CONTENT_PREFIX,
  LOCAL_CONTENT_MAX_BYTES,
  getSyncArea,
  getLocalArea,
  promisify
};

export default storageUtils;
