// content.js - Runs on Amazon product pages

// Normalize price text like "$21.89", "$6,187.21", "US$21.89" → "$21.89"
function normalizePriceText(text) {
  if (!text) return null;
  // Pick first number with optional thousands separators and decimals
  const match = String(text).replace(/\s+/g, ' ').match(/([€£$]?\s?)([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)(?:\.[0-9]{1,2})?/);
  if (!match) return null;
  const symbol = match[1] ? match[1].replace(/\s/g, '') : '';
  const numeric = match[0].replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
  return symbol + numeric;
}

// Extract product information from Amazon page
function getProductInfo() {
    try {
      // Get title
      const titleElement = document.querySelector('#productTitle');
      const title = titleElement ? titleElement.textContent.trim() : null;
      
      // Get price (multiple possible locations)
      let price = null;
    const priceSelectors = [
      '#corePrice_feature_div .a-offscreen',
      '.a-price .a-offscreen',
      '#priceblock_ourprice',
      '#priceblock_dealprice',
      '#price_inside_buybox',
      '#tp_price_block_total_price_ww',
      '.reinventPricePriceToPayMargin .a-offscreen',
      '.a-price-whole'
    ];
      
      for (const selector of priceSelectors) {
        const priceElement = document.querySelector(selector);
        if (priceElement) {
        price = normalizePriceText(priceElement.textContent.trim());
          break;
        }
      }
      
      // Get image
      let image = null;
      const imgElement = document.querySelector('#landingImage') || 
                         document.querySelector('#imgBlkFront') ||
                         document.querySelector('.a-dynamic-image');
      if (imgElement) {
        image = imgElement.src;
      }
      
      return { title, price, image };
    } catch (error) {
      console.error('Error extracting product info:', error);
      return null;
    }
  }
  
  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getProductInfo') {
      const productInfo = getProductInfo();
      sendResponse(productInfo);
    }
    return true;
  });
  
  // Add a floating button to track price (optional enhancement)
  function addTrackButton() {
    // Check if button already exists
    if (document.getElementById('price-tracker-btn')) return;
    
    const button = document.createElement('button');
    button.id = 'price-tracker-btn';
    button.innerHTML = '🏷️ Track Price';
    button.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 10000;
      padding: 12px 24px;
      background: #FF9900;
      color: white;
      border: none;
      border-radius: 24px;
      font-size: 14px;
      font-weight: bold;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      transition: all 0.3s;
    `;
    
    button.addEventListener('mouseenter', () => {
      button.style.transform = 'scale(1.05)';
      button.style.boxShadow = '0 6px 16px rgba(0,0,0,0.4)';
    });
    
    button.addEventListener('mouseleave', () => {
      button.style.transform = 'scale(1)';
      button.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    });
    
    button.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'openPopup' });
    });
    
    document.body.appendChild(button);
  }
  
  // Initialize when page loads
  if (window.location.href.includes('/dp/')) {
    addTrackButton();
  }