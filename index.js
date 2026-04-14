const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
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
    console.error("ERROR: .env file mein Supabase URL ya Key missing hai!");
}

const supabase = createClient(supabaseUrl, supabaseKey);
// ----------------------

// Test Route
app.get('/', (req, res) => {
  res.send('KhaanaLeAao ka Backend aur Supabase dono taiyaar hain! 🚀🍲');
});

// 1. Asli Route: OTP Bhejne ke liye
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
      console.log(`Success: OTP ${otp} sent to ${phone}`);
      return res.json({ status: 'success', message: 'OTP bhej diya gaya hai', otp: otp });
    } else {
      console.error("2Factor Gateway Error:", response.data);
      return res.status(500).json({ status: 'error', message: 'SMS Gateway issue' });
    }
  } catch (error) {
    console.error("Server ka Error:", error.message);
    return res.status(500).json({ status: 'error', message: 'Backend crash ho gaya.' });
  }
});

// 2. Duplicate Phone Number Checking ke sath
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
        console.error("Supabase Error:", error.message);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// 3. Login ke liye
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

// 4. 3-Step Restaurant Registration Details Save karne ke liye
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
        console.error("Route 4 Crash:", error.message);
        res.status(500).json({ status: 'error', message: error.message || "Unknown Database Error" });
    }
});

// 5. App refresh button aur auto-status ke liye
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

// 6. Admin Panel ke liye sabhi restaurants fetch karna
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

// 7. Admin Panel se Restaurant Approve aur Suspend karne ke liye
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

// 8. Dashboard pe Restaurant ka naam aur status fetch karne ke liye
app.get('/partner/dashboard/:phone', async (req, res) => {
    const { phone } = req.params;
    try {
        const { data, error } = await supabase
            .from('restaurants')
            .select('restaurant_name, is_online') 
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

// 9. Switch ON/OFF karne par Database update karne ke liye
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

// 10. Nayi Category Add karne ke liye
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

// 11. Saari Categories Fetch karne ke liye
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

// 12. Naya Menu Item (Dish) Add karne ke liye (Old logic safe rakhne ke liye)
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

// ==========================================
// 🔥 API 13: Pura Menu Fetch karne ke liye (SAFE FIX FOR PRICES)
// Server crash se bachane ke liye manual fetch lagaya hai.
// ==========================================
app.get('/partner/menu/:phone', async (req, res) => {
    try {
        // Step 1: Pehle saare items fetch karo
        const { data: menuItems, error: menuErr } = await supabase
            .from('menu_items')
            .select('*')
            .eq('restaurant_phone', req.params.phone);
            
        if (menuErr) throw menuErr;

        if (!menuItems || menuItems.length === 0) {
            return res.json({ status: 'success', data: [] });
        }

        // Step 2: Sab items ki IDs nikalo taaki unke prices fetch kar sakein
        const itemIds = menuItems.map(item => item.id);

        // Step 3: Variants aur Addons fetch karo
        const { data: variants, error: varErr } = await supabase
            .from('item_variants')
            .select('*')
            .in('item_id', itemIds);

        const { data: addons, error: addErr } = await supabase
            .from('item_addons')
            .select('*')
            .in('item_id', itemIds);

        // Step 4: Items ke andar unke respective variants/addons attach kar do
        const completeMenu = menuItems.map(item => {
            return {
                ...item,
                variants: variants ? variants.filter(v => v.item_id === item.id) : [],
                addons: addons ? addons.filter(a => a.item_id === item.id) : []
            };
        });

        res.json({ status: 'success', data: completeMenu });

    } catch (error) {
        console.error("Menu Fetch Crash Error:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// ==========================================
// 🔥 API 14: ADD MENU ITEM (UPDATED WITH VARIANTS)
// ==========================================
app.post('/add-menu-item', async (req, res) => {
    try {
        const { 
            restaurant_phone, item_name, category, description, is_veg, 
            is_available, prep_time, image_url, has_variants, base_price, price, variants, addons 
        } = req.body;

        if (!restaurant_phone) {
            return res.status(400).json({ error: "Restaurant phone is missing from app!" });
        }

        // Available True rakhein by default
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
        console.error("API 14 Server Crash Error:", error);
        res.status(500).json({ error: error.message || "Internal Server Error" });
    }
});

// ==========================================
// 🔥 API 15: UPDATE ITEM AVAILABILITY (Toggle Switch Ke Liye Fix Ho Gaya)
// ==========================================
app.post('/partner/update-item-availability', async (req, res) => {
    const { id, is_available } = req.body;
    
    // Console log to check what is coming from Android
    console.log(`🚀 [Switch Debug] ID: ${id} | Type: ${typeof id} | Status: ${is_available}`);

    try {
        // Boolean conversion fix - strictly checking for true string or boolean
        const booleanStatus = (is_available === true || is_available === 'true');

        const { data, error } = await supabase
            .from('menu_items')
            .update({ is_available: booleanStatus })
            .eq('id', id)
            .select(); // Fetch updated row

        if (error) throw error;

        // Check if item was actually found and updated
        if (!data || data.length === 0) {
            console.log(`❌ [Switch Error] Database mein ID ${id} match nahi hui!`);
            return res.status(404).json({ status: 'error', message: 'Item not found in DB' });
        }

        console.log(`✅ [Switch Success] ID ${id} ab ${booleanStatus} ho gaya hai!`);
        res.json({ status: 'success', message: 'Item availability updated!' });

    } catch (error) {
        console.error("❌ [Switch API Crash]:", error.message);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// ==========================================
// 🔥 API 16: DELETE MENU ITEM
// ==========================================
app.delete('/partner/delete-item/:id', async (req, res) => {
    try {
        const itemId = req.params.id;

        await supabase.from('item_variants').delete().eq('item_id', itemId);
        await supabase.from('item_addons').delete().eq('item_id', itemId);
        
        const { error } = await supabase.from('menu_items').delete().eq('id', itemId);
        if (error) throw error;

        res.json({ status: 'success', message: 'Item deleted successfully!' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// ==========================================
// 🔥 API 17: UPDATE FULL MENU ITEM (Edit Button Ke Liye)
// ==========================================
app.post('/partner/update-menu-item', async (req, res) => {
    try {
        const { 
            id, item_name, category, description, is_veg, 
            prep_time, image_url, base_price, has_variants, variants, addons 
        } = req.body;

        const { error: updateErr } = await supabase
            .from('menu_items')
            .update({
                item_name, category, description, is_veg, 
                prep_time, image_url, base_price, has_variants
            })
            .eq('id', id);

        if (updateErr) throw updateErr;

        await supabase.from('item_variants').delete().eq('item_id', id);
        await supabase.from('item_addons').delete().eq('item_id', id);

        if (has_variants && variants && variants.length > 0) {
            const vData = variants.map(v => ({ item_id: id, variant_name: v.name || v.variant_name, price: v.price }));
            await supabase.from('item_variants').insert(vData);
        }
        if (addons && addons.length > 0) {
            const aData = addons.map(a => ({ item_id: id, addon_name: a.name || a.addon_name, price: a.price }));
            await supabase.from('item_addons').insert(aData);
        }

        res.json({ status: 'success', message: 'Dish updated successfully!' });
    } catch (error) {
        console.error("Update Item Crash:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Server Start Karna
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server port ${PORT} par daud raha hai 🍲`);
  console.log(`Supabase bhi connect ho chuka hai! ✅`);
});
