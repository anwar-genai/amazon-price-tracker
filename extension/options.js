// Load settings
document.addEventListener('DOMContentLoaded', async () => {
  chrome.storage.sync.get({
    apiUrl: 'http://localhost:8000/api',
    refreshMinutes: 30,
    enableNotifications: true
  }, (cfg) => {
    document.getElementById('apiUrl').value = cfg.apiUrl;
    document.getElementById('refreshMinutes').value = cfg.refreshMinutes;
    document.getElementById('enableNotifications').checked = cfg.enableNotifications;
  });

  document.getElementById('saveBtn').addEventListener('click', () => {
    const apiUrl = document.getElementById('apiUrl').value.trim();
    const refreshMinutes = Math.max(1, parseInt(document.getElementById('refreshMinutes').value, 10) || 30);
    const enableNotifications = document.getElementById('enableNotifications').checked;
    chrome.storage.sync.set({ apiUrl, refreshMinutes, enableNotifications }, () => {
      const msg = document.getElementById('msg');
      msg.textContent = 'Saved.';
      setTimeout(() => msg.textContent = '', 1500);
      // Notify background to reconfigure alarms
      chrome.runtime.sendMessage({ action: 'reconfigureAlarms' });
    });
  });
});


