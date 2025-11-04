// Load settings
document.addEventListener('DOMContentLoaded', async () => {
  chrome.storage.sync.get({
    apiUrl: 'http://localhost:8000/api',
    dashboardUrl: 'http://localhost:8501',
    refreshMinutes: 30,
    enableNotifications: true,
    quietStart: '22:00',
    quietEnd: '07:00',
    minNotifyMins: 60
  }, (cfg) => {
    document.getElementById('apiUrl').value = cfg.apiUrl;
    document.getElementById('dashboardUrl').value = cfg.dashboardUrl;
    document.getElementById('refreshMinutes').value = cfg.refreshMinutes;
    document.getElementById('enableNotifications').checked = cfg.enableNotifications;
    document.getElementById('quietStart').value = cfg.quietStart;
    document.getElementById('quietEnd').value = cfg.quietEnd;
    document.getElementById('minNotifyMins').value = cfg.minNotifyMins;
  });

  document.getElementById('saveBtn').addEventListener('click', () => {
    const apiUrl = document.getElementById('apiUrl').value.trim();
    const dashboardUrl = document.getElementById('dashboardUrl').value.trim();
    const refreshMinutes = Math.max(1, parseInt(document.getElementById('refreshMinutes').value, 10) || 30);
    const enableNotifications = document.getElementById('enableNotifications').checked;
    const quietStart = document.getElementById('quietStart').value || '22:00';
    const quietEnd = document.getElementById('quietEnd').value || '07:00';
    const minNotifyMins = Math.max(1, parseInt(document.getElementById('minNotifyMins').value, 10) || 60);
    chrome.storage.sync.set({ apiUrl, dashboardUrl, refreshMinutes, enableNotifications, quietStart, quietEnd, minNotifyMins }, () => {
      const msg = document.getElementById('msg');
      msg.textContent = 'Saved.';
      setTimeout(() => msg.textContent = '', 1500);
      // Notify background to reconfigure alarms
      chrome.runtime.sendMessage({ action: 'reconfigureAlarms' });
    });
  });
});


