
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
    // Read controls
    const sortOrder = (document.getElementById('sortOrder')?.value) || 'newest';
    const onlyBelow = !!document.getElementById('filterBelow')?.checked;

    let sortedProducts = Array.isArray(products) ? products.slice() : products;
    // Optional filter: only items at/below target
    if (onlyBelow && Array.isArray(sortedProducts)) {
      sortedProducts = sortedProducts.filter(p => p.target_price && p.current_price <= p.target_price);
    }

    sortedProducts = Array.isArray(sortedProducts) ? sortedProducts.sort((a, b) => {
      if (sortOrder === 'priceAsc') {
        return (a.current_price ?? 0) - (b.current_price ?? 0);
      }
      if (sortOrder === 'drop') {
        const ad = a.target_price ? (a.current_price - a.target_price) : Number.POSITIVE_INFINITY;
        const bd = b.target_price ? (b.current_price - b.target_price) : Number.POSITIVE_INFINITY;
        return ad - bd; // most negative (biggest drop) first
      }
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
    
    const html = sortedProducts.map(product => {
      const isBelow = product.target_price && product.current_price <= product.target_price;
      const editLabel = product.target_price ? 'Update target' : 'Set target';
      const editClass = product.target_price ? 'btn btn-primary edit-target-btn' : 'btn btn-ghost edit-target-btn';
      return `
      <div class="product-item ${isBelow ? 'below-target' : ''}" data-id="${product.id}">
        <img src="${product.image_url || 'icons/icon48.png'}" alt="Product">
        <div class="product-details">
          <div class="title">${product.title}</div>
          <div style="display:flex;align-items:center;gap:8px;">
            <div class="price">$${product.current_price.toFixed(2)}</div>
            <canvas class="sparkline" width="80" height="24" data-id="${product.id}"></canvas>
          </div>
          ${isBelow ? 
            `<div class="price-drop">✓ Below target price!</div>` : ''}
          ${product.target_price != null ? `<div class="target-line">Target: $${Number(product.target_price).toFixed(2)}</div>` : ''}
          <div style="margin-top:6px; display:flex; gap:8px; align-items:center;">
            <button class="untrack-btn" data-id="${product.id}" style="padding:6px 10px;background:#e74c3c;color:#fff;border:none;border-radius:4px;cursor:pointer;">Untrack</button>
            <button class="${editClass}" data-id="${product.id}">${editLabel}</button>
          </div>
          <div class="target-editor" data-id="${product.id}" style="margin-top:8px;">
            <input type="number" class="target-input" step="0.01" placeholder="Target price" value="${product.target_price ?? ''}" style="padding:6px;border:1px solid #ddd;border-radius:4px;width:130px;">
            <button class="save-target-btn" data-id="${product.id}" style="padding:6px 10px;background:#067D62;color:#fff;border:none;border-radius:4px;cursor:pointer;">Save</button>
            <button class="cancel-target-btn" data-id="${product.id}" style="padding:6px 10px;background:#aaa;color:#fff;border:none;border-radius:4px;cursor:pointer;">Cancel</button>
          </div>
          <div class="item-status" id="status-${product.id}"></div>
        </div>
      </div>
    `}).join('');
    
    document.getElementById('productList').innerHTML = html;
    // Render sparklines
    document.querySelectorAll('canvas.sparkline').forEach(c => {
      const pid = c.getAttribute('data-id');
      renderSparkline(c, pid);
    });
    
    // Add click listeners
    document.querySelectorAll('.product-item').forEach(item => {
      item.addEventListener('click', (e) => {
        // Ignore clicks on interactive controls/editors
        if (e.target.closest('.untrack-btn, .edit-target-btn, .save-target-btn, .cancel-target-btn, .target-editor, .target-input')) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
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
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const editor = document.querySelector(`.target-editor[data-id="${id}"]`);
        if (editor) editor.classList.add('open');
      });
    });

    document.querySelectorAll('.cancel-target-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const editor = document.querySelector(`.target-editor[data-id="${id}"]`);
        if (editor) editor.classList.remove('open');
      });
    });

    document.querySelectorAll('.save-target-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const editor = document.querySelector(`.target-editor[data-id="${id}"]`);
        const input = editor?.querySelector('.target-input');
        const val = input?.value ?? '';
        // Validate number input
        if (val !== '' && isNaN(parseFloat(val))) {
          const statusEl = document.getElementById(`status-${id}`);
          if (statusEl) { statusEl.className = 'item-status error'; statusEl.textContent = 'Enter a valid number'; }
          return;
        }
        const payload = { target_price: val === '' ? null : parseFloat(val) };
        const statusEl = document.getElementById(`status-${id}`);
        try {
          if (statusEl) { statusEl.className = 'item-status'; statusEl.textContent = 'Saving…'; }
          btn.disabled = true; if (input) input.disabled = true;
          // Try PATCH first, then PUT, then POST fallback
          let resp = await fetch(`${API_URL}/products/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (!resp.ok && (resp.status === 405 || resp.status === 404)) {
            resp = await fetch(`${API_URL}/products/${id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify(payload)
            });
          }
          if (!resp.ok && (resp.status === 404 || resp.status === 405)) {
            // Fallback to POST /products with URL upsert if supported
            const product = Array.isArray(sortedProducts) ? sortedProducts.find(p => p.id == id) : null;
            const body = product ? { url: product.url, target_price: payload.target_price } : payload;
            resp = await fetch(`${API_URL}/products`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify(body)
            });
            // If creating with target fails due to duplicate, delete and recreate with target
            if (!resp.ok && resp.status === 400 && product) {
              await fetch(`${API_URL}/products/${id}`, { method: 'DELETE' });
              resp = await fetch(`${API_URL}/products`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ url: product.url, target_price: payload.target_price })
              });
            }
          }
          if (!resp.ok) {
            let detail = 'Failed to update target';
            try { const data = await resp.json(); detail = data.detail || JSON.stringify(data); } catch {}
            throw new Error(detail);
          }
          if (statusEl) { statusEl.className = 'item-status success'; statusEl.textContent = (val === '' ? 'Target cleared' : 'Target saved'); }
          // Flash the card
          const card = document.querySelector(`.product-item[data-id="${id}"]`);
          if (card) { card.classList.add('flash-success'); setTimeout(()=>card.classList.remove('flash-success'), 900); }
          await loadTrackedProducts();
        } catch (err) {
          if (statusEl) { statusEl.className = 'item-status error'; statusEl.textContent = err.message; }
        } finally {
          btn.disabled = false; if (input) input.disabled = false; if (editor) editor.classList.remove('open');
        }
      });
    });

    // Prevent clicks in the input from bubbling to the product item
    document.querySelectorAll('.target-input').forEach(input => {
      ['click','mousedown','mouseup','keydown','keyup','input','focus'].forEach(ev => {
        input.addEventListener(ev, e => { e.stopPropagation(); });
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

  // Controls listeners
  const sortSelect = document.getElementById('sortOrder');
  const filterBelow = document.getElementById('filterBelow');
  if (sortSelect) sortSelect.addEventListener('change', loadTrackedProducts);
  if (filterBelow) filterBelow.addEventListener('change', loadTrackedProducts);
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
