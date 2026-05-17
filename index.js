const express = require('express');
const cors = require('cors');
const axios = require('axios');
const https = require('https');
const { createClient } = require('@supabase/supabase-js');
const Razorpay = require('razorpay'); 
const crypto = require('crypto');

require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- SUPABASE SETUP ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ ERROR: .env file mein Supabase URL ya Key missing hai!");
}

const supabase = createClient(supabaseUrl, supabaseKey);
// ----------------------

// --- RAZORPAY SETUP ---
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID, 
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});
// ----------------------

// Test Route
app.get('/', (req, res) => {
    res.send('KhaanaLeAao ka Backend, Supabase aur Razorpay teeno taiyaar hain! 🚀🍲💳');
});

// ==========================================
// 🔥 PAYMENT GATEWAY ROUTES (RAZORPAY) 🔥
// ==========================================

app.post('/create-payment', async (req, res) => {
    try {
        const { amount } = req.body; 
        
        if (!amount) {
            return res.status(400).json({ status: "error", message: "Amount is required" });
        }

        const options = {
            amount: Math.round(amount * 100), 
            currency: "INR",
            receipt: "receipt_" + Math.random().toString(36).substring(7),
        };

        const order = await razorpay.orders.create(options);
        
        res.status(200).json({
            status: "success",
            order_id: order.id,
            amount: options.amount
        });
    } catch (error) {
        console.error("❌ Razorpay Error:", error);
        res.status(500).json({ status: "error", message: "Payment order fail ho gaya", error: error.message });
    }
});

app.post('/verify-payment', (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({ status: "error", message: "Missing Razorpay details" });
        }

        const sign = razorpay_order_id + "|" + razorpay_payment_id;
        
        const expectedSign = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
            .update(sign.toString())
            .digest("hex");

        if (razorpay_signature === expectedSign) {
            console.log("✅ Payment Verified! Payment ID:", razorpay_payment_id);
            return res.status(200).json({ status: "success", message: "Payment verified successfully", payment_id: razorpay_payment_id });
        } else {
            console.error("❌ Invalid Signature Detected!");
            return res.status(400).json({ status: "error", message: "Invalid payment signature!" });
        }
    } catch (error) {
        console.error("❌ Verification Error:", error);
        res.status(500).json({ status: "error", message: "Verification failed", error: error.message });
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
        const apiKey = "0b810632-34e1-11f1-bfb4-0200cd936042"; 
        console.log(`Sending OTP to ${phone} via 2Factor...`);
        
        const url = `https://2factor.in/API/V1/${apiKey}/SMS/${phone}/${otp}/OTP1`;
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

        if (error) {
            throw error;
        }

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

app.get('/admin/restaurants', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('restaurants')
            .select('*')
            .order('created_at', { ascending: false }); 

        if (error) throw error;
        res.json({ status: 'success', data: data });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.post('/admin/approve-restaurant', async (req, res) => {
    const { phone, status } = req.body; 
    const finalStatus = status ? status : 'active'; 

    try {
        const { data, error } = await supabase
            .from('restaurants')
            .update({ status: finalStatus }) 
            .eq('phone', phone);

        if (error) throw error;
        res.json({ status: 'success', message: `Restaurant marked as ${finalStatus.toUpperCase()} Successfully!` });
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
// 🔥 CUSTOMER (USER) AUTHENTICATION ROUTES
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
                { id: "3", name: "Burger", logo_url: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=500&q=80" },
                { id: "4", name: "Healthy", logo_url: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=500&q=80" },
                { id: "5", name: "Biryani", logo_url: "https://images.unsplash.com/photo-1631515243349-e0cb75fb8d3a?w=500&q=80" }
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
        user_id, 
        restaurant_id, 
        restaurant_name, 
        order_items, 
        delivery_address, 
        item_total, 
        delivery_charge, 
        grand_total, 
        payment_mode,
        payment_id 
    } = req.body;

    if (!user_id || !restaurant_id || !order_items || !grand_total) {
        return res.status(400).json({ status: 'error', message: 'Order details missing hain!' });
    }

    try {
        const { data, error } = await supabase
            .from('orders')
            .insert([{
                user_id,
                restaurant_id,
                restaurant_name, 
                order_items, 
                delivery_address,
                item_total,
                delivery_charge,
                grand_total,
                payment_mode: payment_mode || 'COD',
                payment_id: payment_id || null, 
                order_status: 'Pending' 
            }])
            .select()
            .single();
        if (error) throw error;
        
        console.log("✅ New Order Placed with Name:", restaurant_name);
        res.json({ status: 'success', message: 'Order Confirmed!', order: data });
    } catch (error) {
        console.error("❌ Place Order Error:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.get('/order/customer/:userId', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('orders')
            .select('*') 
            .eq('user_id', req.params.userId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json({ status: 'success', data });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.get('/order/partner/:restaurantId', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('orders')
            .select('*')
            .eq('restaurant_id', req.params.restaurantId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json({ status: 'success', data });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.post('/order/update-status', async (req, res) => {
    const { order_id, status } = req.body;

    if (!order_id || !status) {
        return res.status(400).json({ status: 'error', message: 'Order ID aur Naya Status zaroori hai!' });
    }

    try {
        const { data, error } = await supabase
            .from('orders')
            .update({ order_status: status })
            .eq('id', order_id)
            .select();

        if (error) throw error;
        res.json({ status: 'success', message: `Order status changed to ${status}!`, data });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// ==========================================
// 🚀 🔥 NAYA AYA HAI: LIVE TRACKING API (UPDATED) 🔥 🚀
// ==========================================
app.get('/order/track/:orderId', async (req, res) => {
    try {
        const orderId = req.params.orderId;

        // 1. Order details nikalo
        const { data: orderData, error: orderError } = await supabase
            .from('orders')
            .select('*')
            .eq('id', orderId)
            .single();

        if (orderError || !orderData) {
            return res.status(404).json({ status: 'error', message: 'Order nahi mila!' });
        }

        // 2. Items ko text mein convert karo
        let itemsSummary = "View Items";
        if (orderData.order_items && Array.isArray(orderData.order_items)) {
            itemsSummary = orderData.order_items.map(item => `${item.qty} x ${item.name}`).join(', ');
        }

        // 3. 🔥 YAHAN HAI MAIN FIX: Restaurant ka asli address aur phone nikalo
        let restAddress = "Address not found";
        let restPhone = "";
        
        if (orderData.restaurant_id) {
            // Restaurant table se data nikal rahe hain
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

       // 4. App me bhejne ke liye Data tayyar karna
        const liveData = {
            order_status: orderData.order_status || "Pending",
            delivery_address: orderData.delivery_address || "Address not provided",
            restaurant_name: orderData.restaurant_name || "Restaurant",
            restaurant_address: restAddress, // 🔥 Database se asli restaurant address
            restaurant_phone: restPhone,     // 🔥 Database se asli restaurant phone
            items_summary: itemsSummary,
            
            // 🔥 YAHAN CHANGE HUA HAI: Ab user ka asli naam aur phone aayega
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
// 🛡️ ADMIN POWERS
// ==========================================

app.get('/admin/all-orders', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('orders')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json({ status: 'success', data });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.delete('/admin/delete-order/:id', async (req, res) => {
    try {
        const { error } = await supabase
            .from('orders')
            .delete()
            .eq('id', req.params.id);

        if (error) throw error;
        res.json({ status: 'success', message: 'Order successfully deleted!' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.post('/admin/edit-order', async (req, res) => {
    const { order_id, new_status, new_total } = req.body;
    try {
        const updates = {};
        if (new_status) updates.order_status = new_status;
        if (new_total) updates.grand_total = new_total;

        const { data, error } = await supabase
            .from('orders')
            .update(updates)
            .eq('id', order_id)
            .select();

        if (error) throw error;
        res.json({ status: 'success', message: 'Admin forcefully updated the order.', data });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Server Start Karna
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server port ${PORT} par daud raha hai 🍲`);
  console.log(`✅ Supabase bhi connect ho chuka hai!`);
});
