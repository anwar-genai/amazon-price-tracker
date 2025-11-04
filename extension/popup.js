
let API_URL = 'http://localhost:8000/api';
let DASHBOARD_URL = 'http://localhost:8501';
// Load API URL from settings
chrome.storage.sync.get({ apiUrl: API_URL, dashboardUrl: DASHBOARD_URL }, cfg => {
  API_URL = cfg.apiUrl || API_URL;
  DASHBOARD_URL = cfg.dashboardUrl || DASHBOARD_URL;
});

// Canonicalize Amazon URL (strip query/hash) to avoid duplicates
function canonicalizeAmazonUrl(url) {
  try {
    const u = new URL(url);
    if (!/amazon\./.test(u.hostname)) return url;
    // Prefer /dp/ASIN format
    const asinMatch = u.pathname.match(/\/dp\/([A-Z0-9]{10})/i) || u.pathname.match(/\/gp\/product\/([A-Z0-9]{10})/i);
    if (asinMatch) {
      u.pathname = `/dp/${asinMatch[1]}`;
    }
    u.hash = '';
    u.search = '';
    return u.toString();
  } catch { return url; }
}

// Show message
function showMessage(text, type = 'success') {
  const messageDiv = document.getElementById('message');
  messageDiv.className = type;
  messageDiv.textContent = text;
  messageDiv.style.display = 'block';
  
  setTimeout(() => {
    messageDiv.style.display = 'none';
  }, 3000);
}

// Check if current page is Amazon product
async function checkCurrentPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (tab.url && /\bamazon\./.test(tab.url) && tab.url.includes('/dp/')) {
    document.getElementById('currentPage').style.display = 'block';
    
    // Get product info from content script
    chrome.tabs.sendMessage(tab.id, { action: 'getProductInfo' }, (response) => {
      if (chrome.runtime.lastError) {
        // Content script not ready on this page yet
        showMessage('Please wait for the page to finish loading, then reopen the popup.', 'error');
        return;
      }
      if (response) {
        displayCurrentProduct(response, tab.url);
      }
    });

    // Also check if this exact URL is already tracked to tailor the UI
    try {
      const res = await fetch(`${API_URL}/products`);
      const products = await res.json();
      const currentCanonical = canonicalizeAmazonUrl(tab.url);
      const alreadyTracked = Array.isArray(products) && products.some(p => {
        const pu = p.url || '';
        return canonicalizeAmazonUrl(pu) === currentCanonical;
      });
      const container = document.getElementById('currentProduct');
      if (alreadyTracked && container) {
        // When displayCurrentProduct runs, replace the button with a tracked badge
        // We delay a tick to let the DOM render
        setTimeout(() => markCurrentAsTracked(), 0);
        showMessage('Product already being tracked', 'success');
      }
    } catch (_e) {
      // ignore
    }
  }
}

// Display current product
function displayCurrentProduct(product, url) {
  const html = `
    <div class="product-preview">
      <img src="${product.image || 'icons/icon48.png'}" alt="Product">
      <div class="product-info">
        <div class="product-title">${product.title || 'Amazon Product'}</div>
        <div class="product-price">${product.price || 'N/A'}</div>
      </div>
    </div>
    <div class="target-price-input">
      <input type="number" id="targetPrice" placeholder="Target price (optional)" step="0.01">
    </div>
    <button class="track-btn" id="trackBtn">Track This Product</button>
  `;
  
  document.getElementById('currentProduct').innerHTML = html;
  
  // Add event listener
  document.getElementById('trackBtn').addEventListener('click', () => {
    const targetPrice = document.getElementById('targetPrice').value;
    trackProduct(canonicalizeAmazonUrl(url), targetPrice || null);
  });
}

// Replace the track button with a non-interactive tracked badge
function markCurrentAsTracked() {
  const trackBtn = document.getElementById('trackBtn');
  if (trackBtn) {
    trackBtn.outerHTML = '<div style="margin-top:8px;padding:10px;text-align:center;background:#eef9f1;color:#067d62;border-radius:6px;font-weight:600;">Already tracked ✓</div>';
  }
  const input = document.getElementById('targetPrice');
  if (input) {
    input.disabled = true;
    input.placeholder = 'Already tracked';
  }
}

// Track product
async function trackProduct(url, targetPrice) {
  try {
    const trackBtn = document.getElementById('trackBtn');
    if (trackBtn) {
      trackBtn.disabled = true;
      trackBtn.textContent = 'Tracking…';
    }

    const response = await fetch(`${API_URL}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, target_price: targetPrice ? parseFloat(targetPrice) : null })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to track product');
    }
    
    showMessage('Product tracked successfully!', 'success');
    loadTrackedProducts();

    if (trackBtn) {
      trackBtn.textContent = 'Tracked ✓';
      trackBtn.disabled = true;
    }
  } catch (error) {
    showMessage(error.message, 'error');
    const trackBtn = document.getElementById('trackBtn');
    if (trackBtn) {
      trackBtn.textContent = 'Track This Product';
      trackBtn.disabled = false;
    }
  }
}

// Load tracked products
async function loadTrackedProducts() {
  try {
    // show skeleton
    document.getElementById('productList').innerHTML = `
      <div class="loading">Loading…</div>
    `;
    const response = await fetch(`${API_URL}/products`);
    const products = await response.json();
    // Newest first: use created_at if present, else fall back to id
    const sortedProducts = Array.isArray(products) ? products.slice().sort((a, b) => {
      if (a.created_at && b.created_at) return new Date(b.created_at) - new Date(a.created_at);
      if (typeof a.id === 'number' && typeof b.id === 'number') return b.id - a.id;
      return 0;
    }) : products;
    
    document.getElementById('productCount').textContent = sortedProducts.length;
    
    if (sortedProducts.length === 0) {
      document.getElementById('productList').innerHTML = `
        <div class="empty-state">
          <p>No products tracked yet</p>
          <p>Visit an Amazon product page to start tracking</p>
        </div>
      `;
      return;
    }
    
    const html = sortedProducts.map(product => `
      <div class="product-item" data-id="${product.id}">
        <img src="${product.image_url || 'icons/icon48.png'}" alt="Product">
        <div class="product-details">
          <div class="title">${product.title}</div>
          <div style="display:flex;align-items:center;gap:8px;">
            <div class="price">$${product.current_price.toFixed(2)}</div>
            <canvas class="sparkline" width="80" height="24" data-id="${product.id}"></canvas>
          </div>
          ${product.target_price && product.current_price <= product.target_price ? 
            `<div class="price-drop">✓ Below target price!</div>` : ''}
          <div style="margin-top:6px; display:flex; gap:8px; align-items:center;">
            <button class="untrack-btn" data-id="${product.id}" style="padding:6px 10px;background:#e74c3c;color:#fff;border:none;border-radius:4px;cursor:pointer;">Untrack</button>
            <button class="edit-target-btn" data-id="${product.id}" style="padding:6px 10px;background:#6875F5;color:#fff;border:none;border-radius:4px;cursor:pointer;">Update target</button>
          </div>
        </div>
      </div>
    `).join('');
    
    document.getElementById('productList').innerHTML = html;
    // Render sparklines
    document.querySelectorAll('canvas.sparkline').forEach(c => {
      const pid = c.getAttribute('data-id');
      renderSparkline(c, pid);
    });
    
    // Add click listeners
    document.querySelectorAll('.product-item').forEach(item => {
      item.addEventListener('click', () => {
        const productId = item.dataset.id;
        const product = sortedProducts.find(p => p.id == productId);
        if (product) {
          chrome.tabs.create({ url: product.url });
        }
      });
    });

    // Action buttons (stop event bubbling)
    document.querySelectorAll('.untrack-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        try {
          const resp = await fetch(`${API_URL}/products/${id}`, { method: 'DELETE' });
          if (!resp.ok) throw new Error('Failed to untrack');
          showMessage('Removed from tracked items', 'success');
          loadTrackedProducts();
        } catch (err) {
          showMessage(err.message, 'error');
        }
      });
    });

    document.querySelectorAll('.edit-target-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const product = sortedProducts.find(p => p.id == id);
        const current = product && product.target_price ? product.target_price : '';
        const newVal = prompt('Set target price (leave empty to clear):', current);
        if (newVal === null) return; // cancelled
        const payload = { target_price: newVal === '' ? null : parseFloat(newVal) };
        try {
          const resp = await fetch(`${API_URL}/products/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (!resp.ok) throw new Error('Failed to update target');
          showMessage('Target price updated', 'success');
          loadTrackedProducts();
        } catch (err) {
          showMessage(err.message, 'error');
        }
      });
    });
    
  } catch (error) {
    document.getElementById('productList').innerHTML = `
      <div class="error">Error loading products. Make sure the backend is running.</div>
    `;
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  checkCurrentPage();
  loadTrackedProducts();
  
  // Refresh every 30 seconds
  setInterval(loadTrackedProducts, 30000);

  // Settings: open dashboard in a new tab
  const settingsBtn = document.getElementById('settingsBtn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: DASHBOARD_URL });
    });
  }
});

// Fetch and render small sparkline for recent price history
async function renderSparkline(canvas, productId) {
  if (!canvas || !productId) return;
  try {
    const resp = await fetch(`${API_URL}/products/${productId}/history?limit=30`);
    if (!resp.ok) return;
    const data = await resp.json(); // expect [{date, price}, ...]
    if (!Array.isArray(data) || data.length < 2) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0,0,w,h);
    const prices = data.map(d => d.price);
    const min = Math.min(...prices), max = Math.max(...prices);
    const xStep = w / (prices.length - 1);
    ctx.strokeStyle = '#067D62';
    ctx.lineWidth = 2;
    ctx.beginPath();
    prices.forEach((p, i) => {
      const x = i * xStep;
      const y = h - (max === min ? 0.5*h : ((p - min) / (max - min)) * h);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  } catch {}
}
