"""
Price Tracker Dashboard - Streamlit
Install: pip install streamlit pandas plotly requests
Run: streamlit run dashboard.py
"""

import streamlit as st
import requests
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from datetime import datetime, timedelta

# Configuration
API_URL = "http://localhost:8000/api"

# Page config
st.set_page_config(
    page_title="Price Tracker Dashboard",
    page_icon="🏷️",
    layout="wide"
)

# Custom CSS
st.markdown("""
<style>
    .main-header {
        font-size: 2.5rem;
        font-weight: bold;
        color: #232F3E;
        margin-bottom: 1rem;
    }
    .metric-card {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        padding: 1.5rem;
        border-radius: 10px;
        color: white;
    }
    .product-card {
        padding: 1rem;
        border-radius: 8px;
        border: 1px solid #e0e0e0;
        margin-bottom: 1rem;
        background: white;
    }
    .price-drop {
        color: #10b981;
        font-weight: bold;
    }
    .price-increase {
        color: #ef4444;
        font-weight: bold;
    }
</style>
""", unsafe_allow_html=True)

# Helper functions
@st.cache_data(ttl=300)  # Cache for 5 minutes
def fetch_products():
    """Fetch all tracked products"""
    try:
        response = requests.get(f"{API_URL}/products", timeout=5)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        st.error(f"Error fetching products: {str(e)}")
        return []

@st.cache_data(ttl=300)
def fetch_price_history(product_id):
    """Fetch price history for a product"""
    try:
        response = requests.get(f"{API_URL}/products/{product_id}/prices", timeout=5)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        return []

def delete_product(product_id):
    """Delete a tracked product"""
    try:
        response = requests.delete(f"{API_URL}/products/{product_id}", timeout=5)
        response.raise_for_status()
        st.success("Product removed successfully!")
        st.cache_data.clear()
        st.rerun()
    except Exception as e:
        st.error(f"Error deleting product: {str(e)}")

def add_product(url, target_price=None):
    """Add a new product to track"""
    try:
        payload = {"url": url}
        if target_price:
            payload["target_price"] = float(target_price)
        
        response = requests.post(f"{API_URL}/products", json=payload, timeout=10)
        response.raise_for_status()
        st.success("Product added successfully!")
        st.cache_data.clear()
        st.rerun()
    except requests.exceptions.HTTPError as e:
        # Extract error detail from response
        error_detail = "Unknown error"
        try:
            if hasattr(e, 'response') and e.response is not None:
                error_data = e.response.json()
                if "detail" in error_data:
                    error_detail = error_data["detail"]
                else:
                    error_detail = str(error_data)
            else:
                error_detail = str(e)
        except:
            if hasattr(e, 'response') and e.response is not None:
                error_detail = e.response.text if hasattr(e.response, 'text') else str(e)
            else:
                error_detail = str(e)
        st.error(f"Error adding product: {error_detail}")
    except Exception as e:
        st.error(f"Error adding product: {str(e)}")

# Header
st.markdown('<p class="main-header">🏷️ Amazon Price Tracker Dashboard</p>', unsafe_allow_html=True)

# Sidebar - Add new product
with st.sidebar:
    st.header("➕ Add New Product")
    
    with st.form("add_product_form"):
        product_url = st.text_input("Amazon Product URL", placeholder="https://www.amazon.com/...")
        target_price = st.number_input("Target Price (optional)", min_value=0.0, step=0.01, value=0.0)
        
        submit = st.form_submit_button("Track Product", width='stretch')
        
        if submit:
            if product_url:
                add_product(product_url, target_price if target_price > 0 else None)
            else:
                st.error("Please enter a product URL")
    
    st.divider()
    
    # Refresh button
    if st.button("🔄 Refresh Data", width='stretch'):
        st.cache_data.clear()
        st.rerun()
    
    st.info("💡 Tip: Prices update automatically every 6 hours")

# Fetch data
products = fetch_products()

if not products:
    st.info("No products tracked yet. Add your first product using the sidebar!")
    st.stop()

# Calculate metrics
total_products = len(products)
total_value = sum(p['current_price'] for p in products)
alerts = [p for p in products if p.get('target_price') and p['current_price'] <= p['target_price']]

# Display metrics
col1, col2, col3, col4 = st.columns(4)

with col1:
    st.metric(
        label="📦 Tracked Products",
        value=total_products
    )

with col2:
    st.metric(
        label="💰 Total Value",
        value=f"${total_value:.2f}"
    )

with col3:
    st.metric(
        label="🔔 Price Alerts",
        value=len(alerts)
    )

with col4:
    avg_price = total_value / total_products if total_products > 0 else 0
    st.metric(
        label="📊 Avg Price",
        value=f"${avg_price:.2f}"
    )

# Price Alerts Section
if alerts:
    st.header("🔔 Price Drop Alerts")
    
    for product in alerts:
        col1, col2 = st.columns([3, 1])
        
        with col1:
            st.success(f"**{product['title'][:60]}...**")
            st.write(f"Current: ${product['current_price']:.2f} | Target: ${product['target_price']:.2f}")
        
        with col2:
            if st.button("View", key=f"alert_{product['id']}"):
                st.session_state['selected_product'] = product['id']

st.divider()

# Tabs
tab1, tab2, tab3 = st.tabs(["📋 All Products", "📈 Price Trends", "⚙️ Settings"])

# Tab 1: All Products
with tab1:
    st.header("All Tracked Products")
    
    # Sort options
    col1, col2 = st.columns([2, 2])
    with col1:
        sort_by = st.selectbox("Sort by", ["Recent", "Price: Low to High", "Price: High to Low", "Name"])
    
    # Sort products
    if sort_by == "Price: Low to High":
        products_sorted = sorted(products, key=lambda x: x['current_price'])
    elif sort_by == "Price: High to Low":
        products_sorted = sorted(products, key=lambda x: x['current_price'], reverse=True)
    elif sort_by == "Name":
        products_sorted = sorted(products, key=lambda x: x['title'])
    else:
        products_sorted = sorted(products, key=lambda x: x['created_at'], reverse=True)
    
    # Display products in grid
    cols = st.columns(2)
    
    for idx, product in enumerate(products_sorted):
        with cols[idx % 2]:
            with st.container():
                col_img, col_info = st.columns([1, 3])
                
                with col_img:
                    if product.get('image_url'):
                        st.image(product['image_url'], width=100)
                    else:
                        st.write("🖼️")
                
                with col_info:
                    st.markdown(f"**{product['title'][:60]}...**")
                    st.markdown(f"<h3 style='color: #B12704; margin: 0;'>${product['current_price']:.2f}</h3>", unsafe_allow_html=True)
                    
                    if product.get('target_price'):
                        if product['current_price'] <= product['target_price']:
                            st.markdown(f"<span class='price-drop'>✓ Below target (${product['target_price']:.2f})</span>", unsafe_allow_html=True)
                        else:
                            st.write(f"Target: ${product['target_price']:.2f}")
                    
                    col_btn1, col_btn2, col_btn3 = st.columns(3)
                    
                    with col_btn1:
                        if st.button("📊 Chart", key=f"chart_{product['id']}", width='stretch'):
                            st.session_state['selected_product'] = product['id']
                    
                    with col_btn2:
                        if st.button("🔗 Link", key=f"link_{product['id']}", width='stretch'):
                            st.write(f"[Open Product]({product['url']})")
                    
                    with col_btn3:
                        if st.button("🗑️ Remove", key=f"delete_{product['id']}", width='stretch'):
                            delete_product(product['id'])
                
                st.divider()

# Tab 2: Price Trends
with tab2:
    st.header("Price Trend Analysis")
    
    # Product selector
    product_names = {p['id']: p['title'][:50] for p in products}
    selected_id = st.selectbox(
        "Select Product",
        options=list(product_names.keys()),
        format_func=lambda x: product_names[x],
        key="trend_product"
    )
    
    if selected_id:
        product = next(p for p in products if p['id'] == selected_id)
        price_history = fetch_price_history(selected_id)
        
        if price_history:
            # Prepare data
            df = pd.DataFrame(price_history)
            df['timestamp'] = pd.to_datetime(df['timestamp'])
            df = df.sort_values('timestamp')
            
            # Calculate statistics
            current_price = df['price'].iloc[-1]
            first_price = df['price'].iloc[0]
            min_price = df['price'].min()
            max_price = df['price'].max()
            avg_price = df['price'].mean()
            
            # Display stats
            col1, col2, col3, col4 = st.columns(4)
            
            with col1:
                st.metric("Current", f"${current_price:.2f}")
            with col2:
                change = current_price - first_price
                st.metric("Change", f"${change:.2f}", f"{(change/first_price*100):.1f}%")
            with col3:
                st.metric("Min", f"${min_price:.2f}")
            with col4:
                st.metric("Max", f"${max_price:.2f}")
            
            # Price chart
            fig = go.Figure()
            
            # Price line
            fig.add_trace(go.Scatter(
                x=df['timestamp'],
                y=df['price'],
                mode='lines+markers',
                name='Price',
                line=dict(color='#FF9900', width=3),
                marker=dict(size=8)
            ))
            
            # Average line
            fig.add_trace(go.Scatter(
                x=df['timestamp'],
                y=[avg_price] * len(df),
                mode='lines',
                name='Average',
                line=dict(color='gray', dash='dash')
            ))
            
            # Target price line (if exists)
            if product.get('target_price'):
                fig.add_trace(go.Scatter(
                    x=df['timestamp'],
                    y=[product['target_price']] * len(df),
                    mode='lines',
                    name='Target',
                    line=dict(color='green', dash='dot')
                ))
            
            fig.update_layout(
                title=f"Price History - {product['title'][:60]}",
                xaxis_title="Date",
                yaxis_title="Price (USD)",
                hovermode='x unified',
                height=500
            )
            
            st.plotly_chart(fig, width='stretch')
            
            # Price distribution
            col1, col2 = st.columns(2)
            
            with col1:
                st.subheader("Price Distribution")
                hist_fig = px.histogram(
                    df, 
                    x='price', 
                    nbins=20,
                    title="Price Frequency"
                )
                st.plotly_chart(hist_fig, width='stretch')
            
            with col2:
                st.subheader("Price Statistics")
                stats_df = pd.DataFrame({
                    'Metric': ['Current', 'Average', 'Minimum', 'Maximum', 'Median', 'Std Dev'],
                    'Value': [
                        f"${current_price:.2f}",
                        f"${avg_price:.2f}",
                        f"${min_price:.2f}",
                        f"${max_price:.2f}",
                        f"${df['price'].median():.2f}",
                        f"${df['price'].std():.2f}"
                    ]
                })
                st.dataframe(stats_df, hide_index=True, width='stretch')
        
        else:
            st.info("No price history available yet. Check back later!")

# Tab 3: Settings
with tab3:
    st.header("⚙️ Settings & Information")
    
    col1, col2 = st.columns(2)
    
    with col1:
        st.subheader("📊 Statistics")
        st.write(f"**Total Products:** {len(products)}")
        st.write(f"**Total Value:** ${total_value:.2f}")
        st.write(f"**Active Alerts:** {len(alerts)}")
        
        # Calculate savings
        total_initial = sum(p['current_price'] for p in products)
        st.write(f"**Portfolio Value:** ${total_initial:.2f}")
    
    with col2:
        st.subheader("ℹ️ About")
        st.write("**Version:** 1.0.0")
        st.write("**Update Frequency:** Every 6 hours")
        st.write("**API Status:** ✅ Connected")
        
        if st.button("Clear All Data", type="secondary"):
            st.warning("This will delete all tracked products!")
    
    st.divider()
    
    st.subheader("📝 Export Data")
    
    if products:
        # Create export dataframe
        export_df = pd.DataFrame([
            {
                'Title': p['title'],
                'Current Price': p['current_price'],
                'Target Price': p.get('target_price', 'N/A'),
                'URL': p['url'],
                'Last Checked': p['last_checked']
            }
            for p in products
        ])
        
        csv = export_df.to_csv(index=False)
        st.download_button(
            label="📥 Download CSV",
            data=csv,
            file_name=f"price_tracker_{datetime.now().strftime('%Y%m%d')}.csv",
            mime="text/csv"
        )

# Footer
st.divider()
st.caption("💡 Price Tracker Dashboard | Built with Streamlit | Data updates every 6 hours")