"""
Amazon Price Tracker - Backend API
Install: pip install fastapi uvicorn sqlalchemy selenium beautifulsoup4 requests python-dotenv apscheduler webdriver-manager
Run: uvicorn main:app --reload
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime
from typing import List, Optional
import re
import json
import time
import urllib.parse
from bs4 import BeautifulSoup
import requests
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException
from webdriver_manager.chrome import ChromeDriverManager
from apscheduler.schedulers.background import BackgroundScheduler

# Database setup
SQLALCHEMY_DATABASE_URL = "sqlite:///./price_tracker.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Models
class Product(Base):
    __tablename__ = "products"
    id = Column(Integer, primary_key=True, index=True)
    url = Column(String, unique=True, index=True)
    title = Column(String)
    current_price = Column(Float)
    target_price = Column(Float, nullable=True)
    image_url = Column(String, nullable=True)
    currency = Column(String, default="USD")
    created_at = Column(DateTime, default=datetime.utcnow)
    last_checked = Column(DateTime, default=datetime.utcnow)
    prices = relationship("PriceHistory", back_populates="product", cascade="all, delete-orphan")

class PriceHistory(Base):
    __tablename__ = "price_history"
    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"))
    price = Column(Float)
    timestamp = Column(DateTime, default=datetime.utcnow)
    product = relationship("Product", back_populates="prices")

Base.metadata.create_all(bind=engine)

# Pydantic models
class ProductCreate(BaseModel):
    url: str
    target_price: Optional[float] = None

class ProductResponse(BaseModel):
    id: int
    url: str
    title: str
    current_price: float
    target_price: Optional[float]
    image_url: Optional[str]
    currency: str
    created_at: datetime
    last_checked: datetime
    
    class Config:
        from_attributes = True

class PriceHistoryResponse(BaseModel):
    price: float
    timestamp: datetime
    
    class Config:
        from_attributes = True

# Global driver instance (reused for efficiency)
_driver = None

def get_driver(recreate=False):
    """Get or create Chrome WebDriver instance"""
    global _driver
    
    # Close existing driver if recreate is requested
    if recreate and _driver is not None:
        try:
            _driver.quit()
        except:
            pass
        _driver = None
    
    if _driver is None:
        try:
            chrome_options = Options()
            # Minimal options to avoid compatibility issues
            chrome_options.add_argument('--headless')
            chrome_options.add_argument('--no-sandbox')
            chrome_options.add_argument('--disable-dev-shm-usage')
            chrome_options.add_argument('--disable-gpu')
            chrome_options.add_argument('--window-size=1920,1080')
            # Disable automation flags (helps avoid detection)
            chrome_options.add_argument('--disable-blink-features=AutomationControlled')
            chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
            chrome_options.add_experimental_option('useAutomationExtension', False)
            
            # Initialize driver with webdriver-manager (auto-downloads ChromeDriver)
            print("Initializing Chrome driver...")
            try:
                service = Service(ChromeDriverManager().install())
                _driver = webdriver.Chrome(service=service, options=chrome_options)
            except Exception as e:
                print(f"Error with ChromeDriverManager, trying direct Chrome driver: {str(e)}")
                # Fallback: try without service (uses system PATH ChromeDriver)
                _driver = webdriver.Chrome(options=chrome_options)
            
            # Set page load timeout
            _driver.set_page_load_timeout(30)
            
            # Execute script to remove webdriver property (optional, may fail on some versions)
            try:
                _driver.execute_cdp_cmd('Page.addScriptToEvaluateOnNewDocument', {
                    'source': '''
                        Object.defineProperty(navigator, 'webdriver', {
                            get: () => undefined
                        })
                    '''
                })
            except Exception as e:
                print(f"Warning: Could not execute CDP command (this is usually fine): {str(e)}")
            
            print("Chrome driver initialized successfully")
        except Exception as e:
            print(f"Error initializing Chrome driver: {str(e)}")
            _driver = None
            raise HTTPException(
                status_code=500,
                detail=f"Failed to initialize browser. Make sure Google Chrome is installed. Error: {str(e)}"
            )
    
    return _driver

# Scraper function using Selenium
def scrape_amazon_price(url: str) -> dict:
    """
    Scrape Amazon product details using Selenium
    Much more reliable than requests/BeautifulSoup as it uses a real browser
    """
    driver = None
    try:
        # Validate and clean URL
        if not url or not isinstance(url, str):
            raise HTTPException(status_code=400, detail="Invalid URL provided")
        
        # Ensure URL is properly formatted
        if not url.startswith(('http://', 'https://')):
            raise HTTPException(status_code=400, detail="URL must start with http:// or https://")
        
        # Clean URL - remove ref parameters and normalize
        original_url = url
        if '?' in url:
            base_url = url.split('?')[0]
            # Keep essential parameters but remove ref/tracking params
            params = url.split('?')[1].split('&')
            essential_params = [p for p in params if p.startswith(('dp=', 'ASIN=', 'id='))]
            if essential_params:
                url = base_url + '?' + '&'.join(essential_params)
            else:
                url = base_url
        
        print(f"Scraping URL: {url}")
        
        # Get driver instance
        driver = get_driver()
        
        # Navigate to product page directly (skip homepage for faster scraping)
        try:
            # Use execute_script as a workaround if driver.get fails
            try:
                driver.get(url)
            except Exception as get_error:
                error_str = str(get_error).lower()
                if "invalid argument" in error_str:
                    print(f"driver.get() failed with invalid argument, trying execute_script approach...")
                    # Try alternative navigation method using JavaScript
                    print("Attempting JavaScript navigation as fallback...")
                    try:
                        # First, navigate to a simple page
                        driver.get("data:text/html,<html><body></body></html>")
                        time.sleep(0.5)
                        # Then use JavaScript to navigate
                        driver.execute_script(f"window.location.href = '{url}';")
                        time.sleep(3)  # Wait for navigation
                        # Check if we're on the right page
                        current_url = driver.current_url
                        if not current_url or 'amazon' not in current_url.lower():
                            raise HTTPException(status_code=400, detail=f"Failed to navigate to Amazon page. Current URL: {current_url}")
                        print(f"Successfully navigated using JavaScript to: {current_url}")
                    except Exception as js_error:
                        print(f"JavaScript navigation also failed: {str(js_error)}")
                        # Final fallback: try with URL encoding
                        encoded_url = urllib.parse.quote(url, safe=':/?#[]@!$&\'()*+,;=')
                        print(f"Trying encoded URL navigation...")
                        driver.get(encoded_url)
                else:
                    raise
        except Exception as e:
            error_msg = str(e)
            # If we get an "invalid argument" error, try recreating the driver
            if "invalid argument" in error_msg.lower():
                print("Received invalid argument error, recreating driver...")
                try:
                    global _driver
                    if _driver:
                        _driver.quit()
                    _driver = None
                    driver = get_driver(recreate=True)
                    driver.get(url)
                except Exception as e2:
                    raise HTTPException(status_code=400, detail=f"Failed to navigate to URL after driver recreation: {str(e2)}")
            else:
                raise HTTPException(status_code=400, detail=f"Failed to navigate to URL: {error_msg}")
        
        # Wait for page to load with shorter timeout
        wait = WebDriverWait(driver, 10)
        
        # Small delay to let page start loading
        time.sleep(0.5)
        
        # Check for captcha or blocking
        try:
            page_source = driver.page_source.lower()
            if any(indicator in page_source for indicator in ['captcha', 'sorry, we just need to make sure', 'enter the characters']):
                raise HTTPException(
                    status_code=400,
                    detail="Amazon is showing a captcha. Please wait a few minutes and try again, or use a VPN/different network."
                )
        except Exception as e:
            if isinstance(e, HTTPException):
                raise
            print(f"Warning: Could not check for captcha: {str(e)}")
        
        # Wait for product title to appear (indicates page loaded)
        title_found = False
        try:
            wait.until(EC.presence_of_element_located((By.ID, "productTitle")))
            title_found = True
        except TimeoutException:
            # Try alternative selectors
            try:
                wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, "h1[data-automation-id='product-title']")))
                title_found = True
            except TimeoutException:
                pass
        
        if not title_found:
            # Give it one more try with a longer wait
            try:
                wait_longer = WebDriverWait(driver, 5)
                wait_longer.until(EC.presence_of_element_located((By.CSS_SELECTOR, "span#productTitle, h1[data-automation-id='product-title']")))
            except TimeoutException:
                raise HTTPException(status_code=400, detail="Product page did not load. URL may be invalid or product removed.")
        
        # Small delay to ensure all content is loaded
        time.sleep(0.5)
        
        # Extract title
        title = None
        title_selectors = [
            (By.ID, "productTitle"),
            (By.CSS_SELECTOR, "h1[data-automation-id='product-title']"),
            (By.CSS_SELECTOR, "span.product-title-word-break"),
            (By.CSS_SELECTOR, "h1.a-size-large")
        ]
        
        for selector_type, selector_value in title_selectors:
            try:
                element = driver.find_element(selector_type, selector_value)
                if element:
                    title = element.text.strip()
                    if title:
                        break
            except (NoSuchElementException, Exception) as e:
                print(f"Could not find title with selector {selector_value}: {str(e)}")
                continue
        
        # Extract price - try multiple methods with extensive selectors
        price = None
        
        # Wait a bit more for price to load (prices sometimes load dynamically)
        time.sleep(1)
        
        # Method 1: Try finding price elements directly with many selectors
        price_selectors = [
            # Primary price elements
            (By.ID, "priceblock_ourprice"),
            (By.ID, "priceblock_dealprice"),
            (By.ID, "priceblock_saleprice"),
            (By.ID, "priceblock_buyprice"),
            # Offscreen prices (hidden but accessible)
            (By.CSS_SELECTOR, "span.a-offscreen"),
            (By.CSS_SELECTOR, "span.a-price .a-offscreen"),
            (By.CSS_SELECTOR, "span[data-a-color='price'] .a-offscreen"),
            # Price display classes
            (By.CSS_SELECTOR, "span.a-price-whole"),
            (By.CSS_SELECTOR, ".a-price.a-text-price span.a-offscreen"),
            (By.CSS_SELECTOR, ".a-price[data-a-color='base'] span.a-offscreen"),
            (By.CSS_SELECTOR, "#corePriceDisplay_desktop_feature_div span.a-offscreen"),
            (By.CSS_SELECTOR, "#price .a-offscreen"),
            (By.CSS_SELECTOR, ".a-price-range span.a-offscreen"),
            # Newer Amazon formats
            (By.CSS_SELECTOR, "[data-a-color='price'] span.a-price"),
            (By.CSS_SELECTOR, "span[data-a-color='price']"),
            # Alternative price locations
            (By.CSS_SELECTOR, "#tp_price_block_total_price_ww span.a-offscreen"),
            (By.CSS_SELECTOR, ".apexPriceToPay span.a-offscreen"),
        ]
        
        print("Trying to extract price with multiple selectors...")
        for selector_type, selector_value in price_selectors:
            try:
                elements = driver.find_elements(selector_type, selector_value)
                print(f"Found {len(elements)} elements with selector: {selector_value}")
                for element in elements:
                    try:
                        # Try text first
                        price_text = element.text.strip()
                        if not price_text:
                            # Try getting from aria-label or data attributes
                            price_text = element.get_attribute('aria-label') or \
                                        element.get_attribute('data-a-price') or \
                                        element.get_attribute('textContent') or ''
                            price_text = price_text.strip()
                        
                        if price_text:
                            print(f"Found price text: {price_text}")
                            # Extract numeric value - handle formats like $29.99, 29.99, $1,234.56, etc.
                            # Remove currency symbols and extract the number
                            price_match = re.search(r'[\$€£¥]?\s*([\d,]+\.?\d{0,2})', price_text.replace(',', ''))
                            if price_match:
                                try:
                                    price_val = float(price_match.group(1).replace(',', ''))
                                    if price_val > 0 and price_val < 1000000:  # Sanity check
                                        price = price_val
                                        print(f"Successfully extracted price: ${price:.2f}")
                                        break
                                except ValueError:
                                    continue
                    except Exception as e:
                        print(f"Error processing price element: {str(e)}")
                        continue
                if price:
                    break
            except (NoSuchElementException, Exception) as e:
                print(f"Could not find price with selector {selector_value}: {str(e)}")
                continue
        
        # Method 2: Try extracting from JSON-LD and embedded JSON in page source
        if price is None:
            print("Trying to extract price from JSON data...")
            try:
                soup = BeautifulSoup(driver.page_source, 'html.parser')
                
                # Try JSON-LD structured data
                json_ld_scripts = soup.find_all('script', type='application/ld+json')
                for script in json_ld_scripts:
                    try:
                        data = json.loads(script.string)
                        if isinstance(data, dict):
                            # Check for offers.price
                            if 'offers' in data:
                                offers = data['offers']
                                if isinstance(offers, dict):
                                    price_data = offers.get('price')
                                elif isinstance(offers, list) and len(offers) > 0:
                                    price_data = offers[0].get('price')
                                else:
                                    price_data = None
                            else:
                                price_data = data.get('price')
                            
                            if price_data:
                                price = float(str(price_data).replace(',', ''))
                                if price > 0:
                                    print(f"Extracted price from JSON-LD: ${price:.2f}")
                                    break
                    except:
                        continue
                
                # Try application/json scripts
                if price is None:
                    script_tags = soup.find_all('script', type='application/json')
                    for script in script_tags:
                        try:
                            data = json.loads(script.string)
                            if isinstance(data, dict):
                                price_data = data.get('offers', {}).get('price', None) or \
                                            data.get('price', None) or \
                                            data.get('lowPrice', None) or \
                                            data.get('highPrice', None) or \
                                            data.get('priceAmount', None)
                                if price_data:
                                    price = float(str(price_data).replace(',', ''))
                                    if price > 0:
                                        print(f"Extracted price from JSON: ${price:.2f}")
                                        break
                        except:
                            continue
                            
            except Exception as e:
                print(f"Error extracting price from JSON: {str(e)}")
        
        # Method 3: Search page source directly for price patterns
        if price is None:
            print("Searching page source for price patterns...")
            try:
                page_source = driver.page_source
                # Look for common Amazon price patterns in the HTML
                price_patterns = [
                    r'"price"\s*:\s*"([\d,]+\.?\d{0,2})"',
                    r'"priceAmount"\s*:\s*"([\d,]+\.?\d{0,2})"',
                    r'"lowPrice"\s*:\s*"([\d,]+\.?\d{0,2})"',
                    r'data-a-price="([\d,]+\.?\d{0,2})"',
                    r'price.*?\$\s*([\d,]+\.?\d{0,2})',
                ]
                for pattern in price_patterns:
                    matches = re.findall(pattern, page_source)
                    for match in matches:
                        try:
                            price_val = float(match.replace(',', ''))
                            if 0 < price_val < 1000000:  # Sanity check
                                price = price_val
                                print(f"Extracted price from page source: ${price:.2f}")
                                break
                        except ValueError:
                            continue
                    if price:
                        break
            except Exception as e:
                print(f"Error searching page source: {str(e)}")
        
        # Extract image
        image_url = None
        image_selectors = [
            (By.ID, "landingImage"),
            (By.ID, "imgBlkFront"),
            (By.CSS_SELECTOR, "img[data-a-image-name='landingImage']"),
            (By.CSS_SELECTOR, "img.a-dynamic-image")
        ]
        
        for selector_type, selector_value in image_selectors:
            try:
                img_element = driver.find_element(selector_type, selector_value)
                if img_element:
                    image_url = img_element.get_attribute('src') or \
                               img_element.get_attribute('data-src') or \
                               img_element.get_attribute('data-old-src')
                    if image_url:
                        break
            except (NoSuchElementException, Exception):
                continue
        
        # Validate results
        if not title:
            raise HTTPException(status_code=400, detail="Could not extract product title. URL may be invalid.")
        
        if price is None or price <= 0:
            raise HTTPException(status_code=400, detail="Could not extract product price. Product may be out of stock, unavailable, or price may be in a different format.")
        
        return {
            'title': title,
            'price': price,
            'image_url': image_url,
            'currency': 'USD'
        }
    
    except HTTPException:
        raise
    except TimeoutException as e:
        print(f"Timeout error scraping {url}: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Timeout loading product page: {str(e)}")
    except Exception as e:
        print(f"Error scraping {url}: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Scraping error: {str(e)}")

# FastAPI app
app = FastAPI(title="Price Tracker API")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Database dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Endpoints
@app.post("/api/products", response_model=ProductResponse)
async def add_product(product: ProductCreate, background_tasks: BackgroundTasks):
    """Add a new product to track"""
    db = SessionLocal()
    try:
        # Check if product already exists
        existing = db.query(Product).filter(Product.url == product.url).first()
        if existing:
            raise HTTPException(status_code=400, detail="Product already being tracked")
        
        # Scrape initial data (raises HTTPException on error)
        scraped_data = scrape_amazon_price(product.url)
        
        # Create product
        db_product = Product(
            url=product.url,
            title=scraped_data['title'],
            current_price=scraped_data['price'],
            target_price=product.target_price,
            image_url=scraped_data['image_url'],
            currency=scraped_data['currency']
        )
        db.add(db_product)
        db.commit()
        db.refresh(db_product)
        
        # Add initial price history
        price_history = PriceHistory(
            product_id=db_product.id,
            price=scraped_data['price']
        )
        db.add(price_history)
        db.commit()
        
        # Refresh to ensure all attributes are loaded
        db.refresh(db_product)
        
        # Expunge the object from the session so it can be serialized after session closes
        db.expunge(db_product)
        
        return db_product
    finally:
        db.close()

@app.get("/api/products", response_model=List[ProductResponse])
async def get_products():
    """Get all tracked products"""
    db = SessionLocal()
    try:
        products = db.query(Product).all()
        return products
    finally:
        db.close()

@app.get("/api/products/{product_id}", response_model=ProductResponse)
async def get_product(product_id: int):
    """Get a specific product"""
    db = SessionLocal()
    try:
        product = db.query(Product).filter(Product.id == product_id).first()
        if not product:
            raise HTTPException(status_code=404, detail="Product not found")
        return product
    finally:
        db.close()

@app.get("/api/products/{product_id}/prices", response_model=List[PriceHistoryResponse])
async def get_price_history(product_id: int):
    """Get price history for a product"""
    db = SessionLocal()
    try:
        product = db.query(Product).filter(Product.id == product_id).first()
        if not product:
            raise HTTPException(status_code=404, detail="Product not found")
        
        prices = db.query(PriceHistory).filter(
            PriceHistory.product_id == product_id
        ).order_by(PriceHistory.timestamp).all()
        
        return prices
    finally:
        db.close()

@app.delete("/api/products/{product_id}")
async def delete_product(product_id: int):
    """Stop tracking a product"""
    db = SessionLocal()
    try:
        product = db.query(Product).filter(Product.id == product_id).first()
        if not product:
            raise HTTPException(status_code=404, detail="Product not found")
        
        db.delete(product)
        db.commit()
        return {"message": "Product deleted successfully"}
    finally:
        db.close()

@app.post("/api/products/{product_id}/update")
async def update_product_price(product_id: int):
    """Manually trigger price update for a product"""
    db = SessionLocal()
    try:
        product = db.query(Product).filter(Product.id == product_id).first()
        if not product:
            raise HTTPException(status_code=404, detail="Product not found")
        
        # Scrape updated data (raises HTTPException on error)
        scraped_data = scrape_amazon_price(product.url)
        
        # Update product
        product.current_price = scraped_data['price']
        product.last_checked = datetime.utcnow()
        
        # Add to price history
        price_history = PriceHistory(
            product_id=product.id,
            price=scraped_data['price']
        )
        db.add(price_history)
        db.commit()
        
        return {
            "message": "Price updated",
            "old_price": product.current_price,
            "new_price": scraped_data['price']
        }
    finally:
        db.close()

@app.get("/api/alerts")
async def get_price_alerts():
    """Get products that dropped below target price"""
    db = SessionLocal()
    try:
        alerts = db.query(Product).filter(
            Product.target_price.isnot(None),
            Product.current_price <= Product.target_price
        ).all()
        return alerts
    finally:
        db.close()

# Background job to update all prices
def update_all_prices():
    """Background job to update prices for all products"""
    db = SessionLocal()
    try:
        products = db.query(Product).all()
        print(f"Updating prices for {len(products)} products...")
        
        for product in products:
            try:
                scraped_data = scrape_amazon_price(product.url)
                product.current_price = scraped_data['price']
                product.last_checked = datetime.utcnow()
                
                price_history = PriceHistory(
                    product_id=product.id,
                    price=scraped_data['price']
                )
                db.add(price_history)
            except HTTPException as e:
                print(f"Failed to update {product.url}: {e.detail}")
            except Exception as e:
                print(f"Error updating product {product.id}: {str(e)}")
        
        db.commit()
        print("Price update complete!")
    except Exception as e:
        print(f"Error updating prices: {str(e)}")
    finally:
        db.close()

# Scheduler setup
scheduler = BackgroundScheduler()
scheduler.add_job(update_all_prices, 'interval', hours=6)  # Update every 6 hours

@app.on_event("startup")
async def startup_event():
    scheduler.start()
    print("Scheduler started - prices will update every 6 hours")

@app.on_event("shutdown")
async def shutdown_event():
    scheduler.shutdown()
    # Clean up Selenium driver
    global _driver
    if _driver is not None:
        try:
            _driver.quit()
            _driver = None
            print("Selenium driver closed")
        except Exception as e:
            print(f"Error closing Selenium driver: {str(e)}")

@app.get("/")
async def root():
    return {
        "message": "Price Tracker API",
        "docs": "/docs",
        "endpoints": {
            "add_product": "POST /api/products",
            "get_products": "GET /api/products",
            "get_product": "GET /api/products/{id}",
            "get_prices": "GET /api/products/{id}/prices",
            "delete_product": "DELETE /api/products/{id}",
            "get_alerts": "GET /api/alerts"
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)