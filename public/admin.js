// Sidebar Menu Click Logic
const menuItems = document.querySelectorAll('.menu li');

menuItems.forEach(item => {
    item.addEventListener('click', () => {
        // Sabse active class hatao
        menuItems.forEach(i => i.classList.remove('active'));
        // Jispe click kiya uspe active class lagao
        item.classList.add('active');
        
        // Tum iske aage alag-alag page load karne ka logic likh sakte ho
        console.log("Navigating to: " + item.innerText);
    });
});

console.log("Admin Panel Ready!");
