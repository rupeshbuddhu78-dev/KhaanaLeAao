const express = require('express');
const cors = require('cors');
const axios = require('axios');
const https = require('https');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const cloudinary = require('cloudinary').v2;

require('dotenv').config();

const app = express();

// Middleware (Image upload ke liye limit badha kar 10mb kar di hai)
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static('public'));

// --- SUPABASE SETUP ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ ERROR: .env file mein Supabase URL ya Key missing hai!");
}

const supabase = createClient(supabaseUrl, supabaseKey);
// ----------------------

// --- CASHFREE SETUP ---
const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID;
const CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY;
const CASHFREE_URL = "https://sandbox.cashfree.com/pg"; // Live ki jagah Sandbox lagayein // LIVE Production URL
// ----------------------

// --- CLOUDINARY SETUP ---
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});
// ----------------------

// --- API KEYS & GLOBALS ---
const TWO_FACTOR_API_KEY = "0b810632-34e1-11f1-bfb4-0200cd936042";
const riderOtpStorage = new Map();

// Test Route
app.get('/', (req, res) => {
    res.send('KhaanaLeAao ka Backend, Supabase, Cashfree aur Cloudinary sab taiyaar hain! 🚀🍲💳🖼️');
});

// ==========================================
// 🔥 PAYMENT GATEWAY ROUTES (CASHFREE) 🔥
// ==========================================

// 1. Create Cashfree Order Session for Android Drop-in SDK
app.post('/create-payment', async (req, res) => {
    try {
        const { amount, customer_id, customer_phone } = req.body; 
        
        if (!amount) {
            return res.status(400).json({ status: "error", message: "Amount is required" });
        }

        const uniqueOrderId = "order_" + Date.now() + "_" + Math.random().toString(36).substring(7);

        // Cashfree Order Body Layout
        const orderData = {
            order_amount: parseFloat(amount),
            order_currency: "INR",
            order_id: uniqueOrderId,
            customer_details: {
                customer_id: customer_id || "cust_" + Math.random().toString(36).substring(7),
                customer_phone: customer_phone || "9999999999",
                customer_name: "Khaana User"
            },
            order_meta: {
                return_url: "https://khaanaleaao.onrender.com/payment-status?order_id={order_id}"
            }
        };

        // Cashfree API hit karo Order create karne ke liye
        const response = await axios.post(`${CASHFREE_URL}/orders`, orderData, {
            headers: {
                'x-client-id': CASHFREE_APP_ID,
                'x-client-secret': CASHFREE_SECRET_KEY,
                'x-api-version': '2025-01-01',
                'Content-Type': 'application/json'
            }
        });
        
        // Android App ko Session ID aur Order ID bhej do
        res.status(200).json({
            status: "success",
            order_id: response.data.order_id,
            payment_session_id: response.data.payment_session_id,
            amount: response.data.order_amount
        });
    } catch (error) {
        console.error("❌ Cashfree Create Order Error:", error.response ? error.response.data : error.message);
        res.status(500).json({ status: "error", message: "Cashfree payment order fail ho gaya", error: error.message });
    }
});

// 2. Verify Cashfree Payment Status Securely from Backend
app.post('/verify-payment', async (req, res) => {
    try {
        const { order_id } = req.body;

        if (!order_id) {
            return res.status(400).json({ status: "error", message: "Missing order_id" });
        }

        // Cashfree Server se Directly status poocho
        const response = await axios.get(`${CASHFREE_URL}/orders/${order_id}`, {
            headers: {
                'x-client-id': CASHFREE_APP_ID,
                'x-client-secret': CASHFREE_SECRET_KEY,
                'x-api-version': '2025-01-01',
                'Content-Type': 'application/json'
            }
        });

        if (response.data.order_status === 'PAID') {
            console.log("✅ Cashfree Payment Verified! Order ID:", order_id);
            return res.status(200).json({ status: "success", message: "Payment verified successfully", order_id: order_id });
        } else {
            console.error("❌ Payment Not Paid! Status:", response.data.order_status);
            return res.status(400).json({ status: "error", message: `Payment status is ${response.data.order_status}` });
        }
    } catch (error) {
        console.error("❌ Cashfree Verification Error:", error.response ? error.response.data : error.message);
        res.status(500).json({ status: "error", message: "Verification failed", error: error.message });
    }
});

// ==========================================
// 🛑 CANCEL ORDER & CASHFREE REFUND API 🛑
// ==========================================

app.post('/order/cancel', async (req, res) => {
    const { order_id } = req.body; 

    if (!order_id) {
        return res.status(400).json({ status: 'error', message: 'Order ID missing hai!' });
    }

    try {
        const { data: order, error: fetchError } = await supabase
            .from('orders')
            .select('*')
            .eq('id', order_id)
            .single();

        if (fetchError || !order) {
            return res.status(404).json({ status: 'error', message: 'Order nahi mila!' });
        }

        if (order.order_status === 'Cancelled' || order.order_status === 'Delivered') {
            return res.status(400).json({ status: 'error', message: 'Ye order ab cancel nahi ho sakta.' });
        }

        let refundStatus = 'Not Applicable';
        let refundIdToSave = null;

        if (order.payment_mode === 'ONLINE' && order.payment_id && order.payment_id !== 'N/A') {
            try {
                console.log(`Initiating Cashfree refund for Order ID: ${order_id}`);
                const uniqueRefundId = "ref_" + Date.now();

                // Cashfree Refund API Request
                const refundResponse = await axios.post(`${CASHFREE_URL}/orders/${order_id}/refunds`, {
                    refund_amount: parseFloat(order.grand_total),
                    refund_id: uniqueRefundId,
                    refund_note: "Order cancelled by customer/server"
                }, {
                    headers: {
                        'x-client-id': CASHFREE_APP_ID,
                        'x-client-secret': CASHFREE_SECRET_KEY,
                        'x-api-version': '2025-01-01',
                        'Content-Type': 'application/json'
                    }
                });

                console.log("✅ Cashfree Refund successful! Refund ID:", refundResponse.data.refund_id);
                refundStatus = 'Initiated'; 
                refundIdToSave = refundResponse.data.refund_id;
            } catch (cashfreeError) {
                console.error("❌ Cashfree Refund Error:", cashfreeError.response ? cashfreeError.response.data : cashfreeError.message);
            }
        }

        const { data: updatedOrder, error: updateError } = await supabase
            .from('orders')
            .update({ 
                order_status: 'Cancelled', 
                refund_status: refundStatus,
                razorpay_refund_id: refundIdToSave || null  // Purane column me hi data daal rhe hain taki schema na badalna pade
            })
            .eq('id', order_id)
            .select();

        if (updateError) throw updateError;

        res.json({ 
            status: 'success', 
            message: 'Order Cancel ho gaya!', 
            refund_status: refundStatus,
            data: updatedOrder 
        });
    } catch (error) {
        console.error("❌ Cancel Order Server Error:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// ==========================================
// 🚀 🔥 LIVE TRACKING API (CASHFREE AUTO-REFUND CHECK) 🔥 🚀
// ==========================================
app.get('/order/track/:orderId', async (req, res) => {
    try {
        const orderId = req.params.orderId;

        const { data: orderData, error: orderError } = await supabase
            .from('orders')
            .select('*')
            .eq('id', orderId)
            .single();

        if (orderError || !orderData) {
            return res.status(404).json({ status: 'error', message: 'Order nahi mila!' });
        }

        if (orderData.order_status === 'Cancelled' && orderData.razorpay_refund_id && orderData.refund_status !== 'Completed') {
            try {
                // Cashfree se refund status fetch karo
                const refundCheck = await axios.get(`${CASHFREE_URL}/orders/${orderId}/refunds/${orderData.razorpay_refund_id}`, {
                    headers: {
                        'x-client-id': CASHFREE_APP_ID,
                        'x-client-secret': CASHFREE_SECRET_KEY,
                        'x-api-version': '2025-01-01',
                        'Content-Type': 'application/json'
                    }
                });

                if (refundCheck.data.refund_status === 'SUCCESS') {
                    await supabase.from('orders')
                        .update({ refund_status: 'Completed' })
                        .eq('id', orderId);
                    orderData.refund_status = 'Completed';
                }
            } catch (cashfreeErr) {
                console.error("Auto Cashfree Refund Check Error:", cashfreeErr.response ? cashfreeErr.response.data : cashfreeErr.message);
            }
        }

        let itemsSummary = "View Items";
        if (orderData.order_items && Array.isArray(orderData.order_items)) {
            itemsSummary = orderData.order_items.map(item => `${item.qty} x ${item.name}`).join(', ');
        }

        let restAddress = "Address not found";
        let restPhone = "";
        if (orderData.restaurant_id) {
            const { data: restData } = await supabase
                .from('restaurants')
                .select('address, phone')
                .eq('phone', orderData.restaurant_id) 
                .maybeSingle();
            if (restData) {
                restAddress = restData.address;
                restPhone = restData.phone;
            }
        }

        const liveData = {
            order_status: orderData.order_status || "Pending",
            refund_status: orderData.refund_status || "Not Applicable",
            delivery_address: orderData.delivery_address || "Address not provided",
            restaurant_name: orderData.restaurant_name || "Restaurant",
            restaurant_address: restAddress, 
            restaurant_phone: restPhone,     
            items_summary: itemsSummary,
            receiver_name: orderData.receiver_name || "User Name", 
            receiver_phone: orderData.receiver_phone || "No Phone" 
        };
        res.status(200).json({
            status: "success",
            data: liveData
        });
    } catch (error) {
        console.error("❌ Track Order Error:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// ==========================================
// 🔥 CUSTOMER RATING & REVIEW API 🔥
// ==========================================
app.post('/customer/rate-order', async (req, res) => {
    const { order_id, rating, review_text } = req.body;

    if (!order_id || rating === undefined) {
        return res.status(400).json({ status: 'error', message: 'Order ID aur Rating dono zaroori hain!' });
    }

    try {
        const { data, error } = await supabase
            .from('reviews') 
            .insert([{ 
                order_id: order_id, 
                rating: parseInt(rating, 10), 
                review_text: review_text || null 
            }])
            .select();

        if (error) throw error;

        res.status(200).json({ 
            status: 'success', 
            message: 'Review submit karne ke liye dhanyawad! ❤️',
            data: data[0]
        });
    } catch (error) {
        console.error("❌ Rate Order Server Error:", error.message);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// ==========================================
// 🔥 RESTAURANT / PARTNER ROUTES 🔥
// ==========================================

app.post('/send-otp', async (req, res) => {
    const { phone } = req.body;

    if (!phone || phone.length !== 10) {
        return res.status(400).json({ status: 'error', message: 'Kripya sahi 10-digit number dalein' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    try {
        console.log(`Sending OTP to ${phone} via 2Factor...`);
        const url = `https://2factor.in/API/V1/${TWO_FACTOR_API_KEY}/SMS/${phone}/${otp}/OTP1`;
        const response = await axios.get(url);

        if (response.data.Status === 'Success') {
            console.log(`✅ Success: OTP ${otp} sent to ${phone}`);
            return res.json({ status: 'success', message: 'OTP bhej diya gaya hai', otp: otp });
        } else {
            console.error("❌ 2Factor Gateway Error:", response.data);
            return res.status(500).json({ status: 'error', message: 'SMS Gateway issue' });
        }
    } catch (error) {
        console.error("❌ Server ka Error:", error.message);
        return res.status(500).json({ status: 'error', message: 'Backend crash ho gaya.' });
    }
});

app.post('/complete-registration', async (req, res) => {
    const { name, phone, password } = req.body;
    try {
        const { data: existingUser, error: fetchError } = await supabase
            .from('restaurants')
            .select('*')
            .eq('phone', phone)
            .single();

        if (existingUser) {
             if (existingUser.status !== 'incomplete') {
                 return res.status(400).json({ status: 'error', message: 'Ye mobile number pehle se registered hai!' });
            } else {
                const { error: updateError } = await supabase
                    .from('restaurants')
                    .update({ name: name, password: password })
                    .eq('phone', phone);
                
                if (updateError) throw updateError;
                return res.json({ status: 'success', message: 'Existing Account Updated!' });
            }
        }

        const { error: insertError } = await supabase
            .from('restaurants')
            .insert([{ name, phone, password, status: 'incomplete' }]);
        if (insertError) throw insertError;
        res.json({ status: 'success', message: 'Basic Account Created!' });
    } catch (error) {
        console.error("❌ Supabase Error:", error.message);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.post('/login-partner', async (req, res) => {
    const { phone, password } = req.body;
    try {
        const { data, error } = await supabase
            .from('restaurants')
            .select('*')
            .eq('phone', phone)
            .eq('password', password)
            .maybeSingle();

        if (error) throw error;

        if (data) {
            res.json({ status: 'success', partner: data });
        } else {
            res.status(401).json({ status: 'error', message: 'Invalid credentials' });
        }
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.post('/register-restaurant-details', async (req, res) => {
    const { 
        phone, restaurantName, ownerName, address, cuisine, foodType, 
        timings, fssaiUrl, panUrl, aadhaarUrl, logoUrl, accName, accNo, ifsc 
    } = req.body;
    
    try {
        const { data, error } = await supabase
            .from('restaurants')
            .update({ 
                restaurant_name: restaurantName, 
                owner_name: ownerName,
                address: address, 
                cuisine_type: cuisine,
                food_type: foodType,
                timings: timings,
                fssai_url: fssaiUrl, 
                pan_url: panUrl,
                aadhaar_url: aadhaarUrl,
                logo_url: logoUrl,
                bank_acc_name: accName,
                bank_acc_no: accNo,
                bank_ifsc: ifsc,
                status: 'pending_verification' 
            })
            .eq('phone', phone)
            .select();
            
        if (error) throw error;
        res.json({ status: 'success', message: 'Restaurant details submitted successfully!' });
    } catch (error) {
        console.error("❌ Route 4 Crash:", error.message);
        res.status(500).json({ status: 'error', message: error.message || "Unknown Database Error" });
    }
});

app.post('/check-status', async (req, res) => {
    const { phone } = req.body;
    try {
        const { data, error } = await supabase
            .from('restaurants')
            .select('status')
            .eq('phone', phone)
            .maybeSingle();

        if (error) throw error;

        if (data) {
            res.json({ status: 'success', dbStatus: data.status });
        } else {
            res.status(404).json({ status: 'error', message: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// ----------------------------------------------------
// 🔥 MAIN DASHBOARD ROUTES
// ----------------------------------------------------

app.get('/partner/dashboard/:phone', async (req, res) => {
    const { phone } = req.params;
    try {
        const { data, error } = await supabase
            .from('restaurants')
            .select('*') 
            .eq('phone', phone)
            .maybeSingle();

        if (error) throw error;
        
        if (data) {
            res.json({ status: 'success', data: data });
        } else {
            res.status(404).json({ status: 'error', message: 'Restaurant not found' });
        }
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.post('/partner/update-status', async (req, res) => {
    const { phone, is_online } = req.body;
    try {
        const { data, error } = await supabase
            .from('restaurants')
            .update({ is_online: is_online })
            .eq('phone', phone);

        if (error) throw error;
        res.json({ status: 'success', message: 'Status updated to ' + (is_online ? 'Online' : 'Offline') });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// ----------------------------------------------------
// 🔥 MENU MANAGEMENT ROUTES
// ----------------------------------------------------

app.post('/partner/add-category', async (req, res) => {
    const { restaurant_phone, name, sort_order } = req.body;
    try {
        const { data, error } = await supabase
            .from('menu_categories')
            .insert([{ restaurant_phone, name, sort_order }])
            .select();
             
        if (error) throw error;
        res.json({ status: 'success', message: 'Category added successfully!', data });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.get('/partner/categories/:phone', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('menu_categories')
            .select('*')
            .eq('restaurant_phone', req.params.phone)
            .order('sort_order', { ascending: true }); 
            
        if (error) throw error;
        res.json({ status: 'success', data });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.post('/partner/add-item', async (req, res) => {
    const { 
        restaurant_phone, category_id, item_name, description, 
        is_veg, base_price, image_url, is_available, has_variants, prep_time 
    } = req.body;
    
    try {
        const { data, error } = await supabase
            .from('menu_items')
            .insert([{ 
                restaurant_phone, category_id, item_name, description, 
                is_veg, base_price, image_url, is_available, has_variants, prep_time 
            }])
            .select();
            
        if (error) throw error;
        res.json({ status: 'success', message: 'Dish added successfully!', data });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.get('/partner/menu/:phone', async (req, res) => {
    try {
        const { data: menuItems, error: menuErr } = await supabase
            .from('menu_items')
            .select('*')
            .eq('restaurant_phone', req.params.phone);
            
        if (menuErr) throw menuErr;

        if (!menuItems || menuItems.length === 0) {
            return res.json({ status: 'success', data: [] });
        }

        const itemIds = menuItems.map(item => item.id);

        const { data: variants, error: varErr } = await supabase
            .from('item_variants')
            .select('*')
            .in('item_id', itemIds);

        const { data: addons, error: addErr } = await supabase
            .from('item_addons')
            .select('*')
            .in('item_id', itemIds);

        const completeMenu = menuItems.map(item => {
            return {
                ...item,
                variants: variants ? variants.filter(v => v.item_id === item.id) : [],
                addons: addons ? addons.filter(a => a.item_id === item.id) : []
            };
        });
        res.json({ status: 'success', data: completeMenu });

    } catch (error) {
        console.error("❌ Menu Fetch Crash Error:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.post('/add-menu-item', async (req, res) => {
    try {
        const { 
            restaurant_phone, item_name, category, description, is_veg, 
            is_available, prep_time, image_url, has_variants, base_price, price, variants, addons 
        } = req.body;

        if (!restaurant_phone) {
            return res.status(400).json({ error: "Restaurant phone is missing from app!" });
        }

        const safeIsAvailable = is_available !== undefined ? is_available : true;

        const { data: menuItem, error: itemError } = await supabase
            .from('menu_items')
            .insert([{
                restaurant_phone: restaurant_phone,
                item_name: item_name,
                category: category,
                description: description,
                is_veg: is_veg,
                is_available: safeIsAvailable,
                prep_time: prep_time,
                image_url: image_url,
                has_variants: has_variants,
                base_price: base_price || price || null,
                price: price || null
            }])
            .select()
            .single();

        if (itemError) throw itemError;

        const newDishId = menuItem.id;

        if (has_variants && variants && variants.length > 0) {
            const variantsToInsert = variants.map(v => ({
                item_id: newDishId,
                variant_name: v.name || v.variant_name,
                price: v.price
            }));
            await supabase.from('item_variants').insert(variantsToInsert);
        }
        
        if (addons && addons.length > 0) {
            const addonsToInsert = addons.map(a => ({
                item_id: newDishId,
                addon_name: a.name || a.addon_name,
                price: a.price
            }));
            await supabase.from('item_addons').insert(addonsToInsert);
        }

        res.status(200).json({ status: "success", message: "Dish saved successfully!" });
    } catch (error) {
        console.error("❌ API 14 Server Crash Error:", error);
        res.status(500).json({ error: error.message || "Internal Server Error" });
    }
});

app.post('/partner/update-item-availability', async (req, res) => {
    const { id, is_available } = req.body;
    try {
        const numericId = parseInt(id, 10);
        const booleanStatus = (is_available === true || is_available === 'true');

        const { data, error } = await supabase
            .from('menu_items') 
            .update({ is_available: booleanStatus })
            .eq('id', numericId)
            .select(); 

        if (error) throw error;
        res.json({ status: 'success', message: 'Item availability updated!' });

    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.post('/partner/update-variant-availability', async (req, res) => {
    const { id, is_available } = req.body;
    try {
        const numericId = parseInt(id, 10);
        const booleanStatus = (is_available === true || is_available === 'true');

        const { data, error } = await supabase
            .from('item_variants')
            .update({ is_available: booleanStatus })
            .eq('id', numericId)
            .select(); 

        if (error) throw error;
        res.json({ status: 'success', message: 'Variant availability updated!' });

    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.delete('/partner/delete-item/:id', async (req, res) => {
    try {
        const itemId = parseInt(req.params.id, 10);

        await supabase.from('item_variants').delete().eq('item_id', itemId);
        await supabase.from('item_addons').delete().eq('item_id', itemId);
        
        const { error } = await supabase.from('menu_items').delete().eq('id', itemId);
        if (error) throw error;

        res.json({ status: 'success', message: 'Item deleted successfully!' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.post('/partner/update-menu-item', async (req, res) => {
    try {
        const { 
            id, item_name, category, description, is_veg, 
            prep_time, image_url, base_price, has_variants, variants, addons 
        } = req.body;

        const numericId = parseInt(id, 10);

        const { error: updateErr } = await supabase
            .from('menu_items')
            .update({
                item_name, category, description, is_veg, 
                prep_time, image_url, base_price, has_variants
            })
            .eq('id', numericId);

        if (updateErr) throw updateErr;

        await supabase.from('item_variants').delete().eq('item_id', numericId);
        await supabase.from('item_addons').delete().eq('item_id', numericId);

        if (has_variants && variants && variants.length > 0) {
            const vData = variants.map(v => ({ item_id: numericId, variant_name: v.name || v.variant_name, price: v.price }));
            await supabase.from('item_variants').insert(vData);
        }
        
        if (addons && addons.length > 0) {
            const aData = addons.map(a => ({ item_id: numericId, addon_name: a.name || a.addon_name, price: a.price }));
            await supabase.from('item_addons').insert(aData);
        }

        res.json({ status: 'success', message: 'Dish updated successfully!' });
    } catch (error) {
        console.error("❌ Update Item Crash:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// ==========================================
// 🔥 CUSTOMER (USER) AUTHENTICATION & PROFILE ROUTES 🔥
// ==========================================

app.post('/user/check', async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ status: 'error', message: 'Phone number zaroori hai!' });

    try {
        const { data, error } = await supabase.from('users').select('*').eq('phone', phone).maybeSingle();
        if (error) throw error;
        if (data) {
            res.json({ status: 'exists', message: 'Welcome back!', user: data });
        } else {
            res.json({ status: 'new', message: 'Naya user hai, register karna padega.' });
        }
    } catch (error) {
        res.status(500).json({ status: 'error', message: `DB Error: ${error.message}` });
    }
});

app.post('/user/register', async (req, res) => {
    const { phone, full_name, email } = req.body;
    if (!phone || !full_name) return res.status(400).json({ status: 'error', message: 'Phone aur Name dono zaroori hain!' });

    try {
        const { data, error } = await supabase.from('users').insert([{ phone, full_name, email: email || null }]).select().single();
        if (error) {
            if (error.code === '23505') return res.status(400).json({ status: 'error', message: 'Ye number pehle se registered hai!' });
            return res.status(500).json({ status: 'error', message: `Supabase Error: ${error.message}` });
        }
        res.json({ status: 'success', message: 'Account ban gaya!', user: data });
    } catch (error) {
        res.status(500).json({ status: 'error', message: `Server Crash: ${error.message}` });
    }
});

app.post('/user/update-profile', async (req, res) => {
    const { current_phone, new_phone, full_name, email, image } = req.body;

    if (!current_phone) {
        return res.status(400).json({ status: 'error', message: 'User ka phone number missing hai!' });
    }

    try {
        let secureUrl = null;
        if (image) {
            const base64Image = image.startsWith('data:image') ? image : `data:image/jpeg;base64,${image}`;
            const uploadResponse = await cloudinary.uploader.upload(base64Image, { folder: 'khaanaleaao_users', width: 400, crop: 'scale' });
            secureUrl = uploadResponse.secure_url;
        }

        const updates = { updated_at: new Date() };
        if (full_name) updates.full_name = full_name;
        if (email) updates.email = email;
        if (new_phone) updates.phone = new_phone;
        if (secureUrl) updates.profile_image_url = secureUrl;

        const { data, error } = await supabase
            .from('users')
            .update(updates)
            .eq('phone', current_phone)
            .select()
            .single();

        if (error) {
            console.error('Supabase Update Error:', error);
            return res.status(500).json({ status: 'error', message: 'Database update me error aayi.' });
        }

        res.status(200).json({ status: 'success', message: 'Profile updated successfully!', user: data, imageUrl: secureUrl });
    } catch (error) {
        console.error('Profile Update Backend Error:', error);
        res.status(500).json({ status: 'error', message: 'Server error.', error: error.message });
    }
});

// ==========================================
// 🔥 CUSTOMER APP HOME SCREEN ROUTES
// ==========================================

app.get('/customer/restaurants', async (req, res) => {
    try {
        const { data, error } = await supabase.from('restaurants').select('phone, name, restaurant_name, cuisine_type, logo_url, is_online').eq('status', 'active');
        if (error) throw error;
        res.json({ status: 'success', data: data });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.get('/customer/categories', async (req, res) => {
    try {
        const { data, error } = await supabase.from('app_categories').select('*');
        if (error || !data || data.length === 0) {
            const defaultCategories = [
                { id: "1", name: "Offers", logo_url: "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=500&q=80" },
                { id: "2", name: "Pizza", logo_url: "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=500&q=80" },
                { id: "3", name: "Burger", logo_url: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=500&q=80" }
            ];
            return res.json({ status: 'success', data: defaultCategories });
        }
        res.json({ status: 'success', data: data });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.post('/partner/updateProfile', async (req, res) => {
    const { phone, field, value } = req.body;
    if (!phone || !field) return res.status(400).json({ status: 'error', message: 'Phone aur field name zaroori hai!' });
    
    try {
        const { data, error } = await supabase.from('restaurants').update({ [field]: value }).eq('phone', phone).select();
        if (error) throw error;
        res.json({ status: 'success', message: `${field} updated successfully!`, data: data });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// ==========================================
// 🔥 USER ADDRESS MANAGEMENT ROUTES
// ==========================================

app.post('/user/address/add', async (req, res) => {
    const { user_id, address_type, receiver_name, full_address, receiver_phone } = req.body;
    if (!user_id || !full_address || !receiver_phone) return res.status(400).json({ status: 'error', message: 'Zaroori details missing hain!' });
    
    try {
        const { data, error } = await supabase.from('user_addresses').insert([{ user_id, address_type: address_type || 'Home', receiver_name, full_address, receiver_phone }]).select();
        if (error) throw error;
        res.json({ status: 'success', message: 'Address successfully save ho gaya!', data });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.get('/user/addresses/:userId', async (req, res) => {
    try {
        const { data, error } = await supabase.from('user_addresses').select('*').eq('user_id', req.params.userId).order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ status: 'success', data });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.post('/user/address/update', async (req, res) => {
    const { id, address_type, receiver_name, full_address, receiver_phone } = req.body;
    if (!id) return res.status(400).json({ status: 'error', message: 'Address ID zaroori hai!' });
    
    try {
        const { data, error } = await supabase.from('user_addresses').update({ address_type, receiver_name, full_address, receiver_phone }).eq('id', id).select();
        if (error) throw error;
        res.json({ status: 'success', message: 'Address update ho gaya!', data });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.delete('/user/address/delete/:id', async (req, res) => {
    try {
        const { error } = await supabase.from('user_addresses').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ status: 'success', message: 'Address delete kar diya gaya hai!' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// ==========================================
// 🚀 🔥 ORDER MANAGEMENT & ADMIN POWERS 🔥 🚀
// ==========================================

app.post('/order/place', async (req, res) => {
    const { 
        user_id, restaurant_id, restaurant_name, order_items, delivery_address, 
        receiver_name, receiver_phone, cooking_instructions, item_total, 
        delivery_charge, grand_total, payment_mode, payment_id 
    } = req.body;
    
    if (!user_id || !restaurant_id || !order_items || !grand_total) {
        return res.status(400).json({ status: 'error', message: 'Order details missing hain!' });
    }
    
    try {
        const { data, error } = await supabase
            .from('orders')
            .insert([{ 
                user_id, restaurant_id, restaurant_name, order_items, delivery_address, 
                receiver_name, receiver_phone, cooking_instructions, item_total, 
                delivery_charge, grand_total, payment_mode: payment_mode || 'COD', 
                payment_id: payment_id || null, order_status: 'Pending' 
            }])
            .select()
            .single();

        if (error) throw error;
        res.json({ status: 'success', message: 'Order Confirmed!', order: data });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.get('/order/customer/:userId', async (req, res) => {
    try {
        const { data, error } = await supabase.from('orders').select('*').eq('user_id', req.params.userId).order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ status: 'success', data });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.get('/order/partner/:restaurantId', async (req, res) => {
    try {
        const { data, error } = await supabase.from('orders').select('*').eq('restaurant_id', req.params.restaurantId).order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ status: 'success', data });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.post('/order/update-status', async (req, res) => {
    const { order_id, status } = req.body;
    if (!order_id || !status) return res.status(400).json({ status: 'error', message: 'Order ID aur Naya Status zaroori hai!' });
    
    try {
        const { data, error } = await supabase.from('orders').update({ order_status: status }).eq('id', order_id).select();
        if (error) throw error;
        res.json({ status: 'success', message: `Order status changed to ${status}!`, data });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.get('/admin/all-orders', async (req, res) => {
    try {
        const { data, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ status: 'success', data });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.get('/admin/restaurants', async (req, res) => {
    try {
        const { data, error } = await supabase.from('restaurants').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ status: 'success', data });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// ==========================================
// 🛵 DELIVERY PARTNER (RIDER) APIs (OTP ADDED) 🛵
// ==========================================

// 1. Rider - Send OTP API
app.post('/rider/send-otp', async (req, res) => {
    const { mobile } = req.body;

    if (!mobile || mobile.length !== 10) {
        return res.status(400).json({ status: 'error', message: 'Sahi 10-digit number daalein!' });
    }

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    
    // Memory mein OTP save karo (10 mins valid)
    riderOtpStorage.set(mobile, otp);
    setTimeout(() => riderOtpStorage.delete(mobile), 10 * 60 * 1000);

    try {
        console.log(`Sending Rider OTP ${otp} to ${mobile} via 2Factor...`);
        const url = `https://2factor.in/API/V1/${TWO_FACTOR_API_KEY}/SMS/${mobile}/${otp}/OTP1`;
        const response = await axios.get(url);

        if (response.data.Status === 'Success') {
            return res.json({ status: 'success', message: 'OTP SMS par bhej diya gaya hai!' });
        } else {
            return res.status(500).json({ status: 'error', message: 'SMS Gateway issue' });
        }
    } catch (error) {
        console.error("❌ Rider Send OTP Error:", error.message);
        return res.status(500).json({ status: 'error', message: 'OTP bhejne mein dikkat aayi.' });
    }
});

// 2. Rider - Verify OTP & Login/Register
app.post('/rider/login', async (req, res) => {
    const { mobile, name, vehicle_number, otp } = req.body;

    if (!mobile || !otp) {
        return res.status(400).json({ status: 'error', message: 'Mobile aur OTP zaroori hai!' });
    }

    // 🔒 OTP Verification
    const savedOtp = riderOtpStorage.get(mobile);
    
    // Testing ke liye master OTP "0000" rakh diya hai
    if (savedOtp !== otp && otp !== "0000") {
         return res.status(400).json({ status: 'error', message: 'Galat OTP daala hai!' });
    }

    try {
        let { data: rider, error } = await supabase.from('riders').select('*').eq('mobile', mobile).single();

        if (!rider) {
            // Agar account nahi hai, toh Name aur Vehicle zaroori hai
            if (!name || !vehicle_number) {
                 return res.status(200).json({ 
                    status: 'new_rider', 
                    message: 'Naya account hai. Name aur Vehicle number bharein.' 
                });
            }

            // Naya Rider create karo
            const { data: newRider, error: insertError } = await supabase
                .from('riders')
                .insert([{ mobile, name, vehicle_number, is_online: false }])
                .select();
            if (insertError) throw insertError;
            rider = newRider[0];
        }

        // Login hone ke baad OTP hata do
        riderOtpStorage.delete(mobile);
        res.status(200).json({
            status: 'success',
            message: 'Login Successful!',
            data: rider
        });
    } catch (error) {
        console.error("❌ Rider Login Error:", error.message);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// 3. Update Rider Status 
app.post('/rider/toggle-status', async (req, res) => {
    const { rider_id, is_online } = req.body;
    try {
        const { data, error } = await supabase
            .from('riders')
            .update({ is_online: is_online })
            .eq('id', rider_id)
            .select();

        if (error) throw error;

        res.status(200).json({
            status: 'success',
            message: is_online ? "Rider ab ONLINE hai 🟢" : "Rider ab OFFLINE hai 🔴",
            data: data[0]
        });
    } catch (error) {
        console.error("❌ Toggle Status Error:", error.message);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// 4. Update Rider Live Location
app.post('/rider/update-location', async (req, res) => {
    const { rider_id, latitude, longitude } = req.body;

    if (!rider_id || !latitude || !longitude) {
        return res.status(400).json({ status: 'error', message: 'Incomplete location data!' });
    }

    try {
        const { error } = await supabase
            .from('riders')
            .update({ current_latitude: latitude, current_longitude: longitude })
            .eq('id', rider_id);

        if (error) throw error;

        res.status(200).json({ status: 'success', message: 'Location updated!' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// ==========================================
// Server Start
// ==========================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server port ${PORT} par daud raha hai Cashfree ke sath 🍲`);
});
