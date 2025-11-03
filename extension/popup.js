
const API_URL = 'http://localhost:8000/api';

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
  
  if (tab.url && tab.url.includes('amazon.com') && tab.url.includes('/dp/')) {
    document.getElementById('currentPage').style.display = 'block';
    
    // Get product info from content script
    chrome.tabs.sendMessage(tab.id, { action: 'getProductInfo' }, (response) => {
      if (response) {
        displayCurrentProduct(response, tab.url);
      }
    });
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
    trackProduct(url, targetPrice || null);
  });
}

// Track product
async function trackProduct(url, targetPrice) {
  try {
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
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

// Load tracked products
async function loadTrackedProducts() {
  try {
    const response = await fetch(`${API_URL}/products`);
    const products = await response.json();
    
    document.getElementById('productCount').textContent = products.length;
    
    if (products.length === 0) {
      document.getElementById('productList').innerHTML = `
        <div class="empty-state">
          <p>No products tracked yet</p>
          <p>Visit an Amazon product page to start tracking</p>
        </div>
      `;
      return;
    }
    
    const html = products.map(product => `
      <div class="product-item" data-id="${product.id}">
        <img src="${product.image_url || 'icons/icon48.png'}" alt="Product">
        <div class="product-details">
          <div class="title">${product.title}</div>
          <div class="price">$${product.current_price.toFixed(2)}</div>
          ${product.target_price && product.current_price <= product.target_price ? 
            `<div class="price-drop">✓ Below target price!</div>` : ''}
        </div>
      </div>
    `).join('');
    
    document.getElementById('productList').innerHTML = html;
    
    // Add click listeners
    document.querySelectorAll('.product-item').forEach(item => {
      item.addEventListener('click', () => {
        const productId = item.dataset.id;
        const product = products.find(p => p.id == productId);
        if (product) {
          chrome.tabs.create({ url: product.url });
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
      // Open Streamlit dashboard
      chrome.tabs.create({ url: 'http://localhost:8501' });
    });
  }
});
