// background.js - MV3 service worker

let API_URL = 'http://localhost:8000/api';

// Load config from storage
function loadConfig(callback) {
  chrome.storage.sync.get({
    apiUrl: API_URL,
    refreshMinutes: 30,
    enableNotifications: true
  }, (cfg) => {
    API_URL = cfg.apiUrl || API_URL;
    callback && callback(cfg);
  });
}

// Keep a map of notificationId -> target URL so we can open it on click
const notificationTargetUrlById = new Map();

// On install/update: set up periodic checks
function configureAlarm() {
  loadConfig((cfg) => {
    chrome.alarms.clear('price-tracker-refresh', () => {
      chrome.alarms.create('price-tracker-refresh', {
        when: Date.now() + 5 * 1000,
        periodInMinutes: Math.max(1, Number(cfg.refreshMinutes) || 30)
      });
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeBackgroundColor({ color: '#FF6A00' });
  configureAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  configureAlarm();
});

// Handle messages from content/popup scripts
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (!request || !request.action) return; 

  switch (request.action) {
    case 'openPopup': {
      // Popups can't be programmatically opened as action popups; open as a tab instead
      const url = chrome.runtime.getURL('popup.html');
      chrome.tabs.create({ url });
      sendResponse && sendResponse({ ok: true });
      break;
    }
    case 'reconfigureAlarms': {
      configureAlarm();
      sendResponse && sendResponse({ ok: true });
      break;
    }
    default:
      break;
  }

  // Indicate we may respond asynchronously if needed
  return true;
});

// Poll the backend for price-drop notifications
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'price-tracker-refresh') return;

  try {
    // Update badge with count of items at/below target
    const productsResp = await fetch(`${API_URL}/products`);
    if (productsResp.ok) {
      const products = await productsResp.json();
      const count = Array.isArray(products) ? products.filter(p => p.target_price && p.current_price <= p.target_price).length : 0;
      chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    }

    // Notifications (optional per settings)
    loadConfig(async (cfg) => {
      if (!cfg.enableNotifications) return;
      const response = await fetch(`${API_URL}/notifications`, { method: 'GET' });
      if (!response.ok) return;
      const notifications = await response.json();
      if (!Array.isArray(notifications) || notifications.length === 0) return;
  
      for (const n of notifications) {
        const notificationId = `price-drop-${n.id ?? Date.now()}`;
        notificationTargetUrlById.set(notificationId, n.url);
        chrome.notifications.create(notificationId, {
          type: 'basic',
          iconUrl: n.image_url || 'icons/icon128.png',
          title: n.title || 'Price drop detected',
          message: n.message || 'A tracked item has dropped in price.',
          priority: 2
        });
      }
    });
  } catch (_e) {
    // Swallow errors to keep the service worker stable
  }
});

// When user clicks a notification, open the product page
chrome.notifications.onClicked.addListener((notificationId) => {
  const targetUrl = notificationTargetUrlById.get(notificationId);
  if (targetUrl) {
    chrome.tabs.create({ url: targetUrl });
  }
  chrome.notifications.clear(notificationId);
  notificationTargetUrlById.delete(notificationId);
});

// Optional: clear mapping on notification close
chrome.notifications.onClosed.addListener((notificationId, _byUser) => {
  notificationTargetUrlById.delete(notificationId);
});


