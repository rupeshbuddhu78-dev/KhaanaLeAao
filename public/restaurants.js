// ==========================================
// RESTAURANT MANAGEMENT LOGIC (Production Ready)
// ==========================================

// 1. Switch between List View and Details View
function openDetails(restaurantName) {
    // Hide List, Show Details
    document.getElementById('listView').style.display = 'none';
    document.getElementById('detailsView').style.display = 'block';
    
    // Set Title dynamically
    document.getElementById('detailTitle').innerText = restaurantName;

    // NEXT STEP: Yahan hum Supabase se us specific restaurant ka data fetch karenge
    // fetchRestaurantDetailsFromDB(restaurantId);
}

function closeDetails() {
    // Hide Details, Show List
    document.getElementById('detailsView').style.display = 'none';
    document.getElementById('listView').style.display = 'block';
}

// 2. Tab Switching Logic inside Details Page
function switchTab(event, tabId) {
    // Hide all tab contents
    let contents = document.getElementsByClassName("tab-content");
    for (let i = 0; i < contents.length; i++) {
        contents[i].classList.remove("active");
    }

    // Remove active class from all tab buttons
    let links = document.getElementsByClassName("tab-link");
    for (let i = 0; i < links.length; i++) {
        links[i].classList.remove("active");
    }

    // Show the selected tab and make button active
    document.getElementById(tabId).classList.add("active");
    event.currentTarget.classList.add("active");
}

console.log("Restaurant Module Loaded! Ready for Supabase Integration 🚀");
