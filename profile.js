document.addEventListener('DOMContentLoaded', async () => {
    // Check if user is logged in
    try {
        const response = await fetch(`${API_BASE}/api/auth-status`, {
            credentials: 'include'
        });
        const data = await response.json();
        
        if (response.ok && data.user) {
            currentUser = data.user;
            populateProfileForm(currentUser);
            updateUIForUser();
            
            // Show admin controls if user is admin
            if (currentUser.isAdmin) {
                document.getElementById('adminControls').style.display = 'block';
            }
        } else {
            window.location.href = 'index.html';
        }
    } catch (error) {
        console.error('Error checking auth status:', error);
        showMessage('Error loading profile', 'error');
    }

    // Portrait upload handling
    const portraitInput = document.getElementById('portraitInput');
    if (portraitInput) {
        portraitInput.addEventListener('change', handleProfilePictureUpload);
    }

    // Profile form submission
    const profileForm = document.getElementById('profileForm');
    if (profileForm) {
        profileForm.addEventListener('submit', handleProfileSubmit);
    }

    const generateAdminKeyBtn = document.getElementById('generateAdminKeyBtn');
    if (generateAdminKeyBtn) {
        generateAdminKeyBtn.addEventListener('click', generateAdminKey);
    }

    const redeemAdminKeyBtn = document.getElementById('redeemAdminKeyBtn');
    if (redeemAdminKeyBtn) {
        redeemAdminKeyBtn.addEventListener('click', redeemAdminKey);
    }
});

let currentUser = null;
const API_BASE = window.APP_CONFIG.apiBase;

function populateProfileForm(user) {
    const elements = {
        fullName: document.getElementById('fullName'),
        biography: document.getElementById('biography'),
        location: document.getElementById('location'),
        website: document.getElementById('website'),
        currentPortrait: document.getElementById('currentPortrait')
    };

    // Only set values if elements exist
    if (elements.fullName) elements.fullName.value = user.fullName || '';
    if (elements.biography) elements.biography.value = user.biography || '';
    if (elements.location) elements.location.value = user.location || '';
    if (elements.website) elements.website.value = user.website || '';
    
    if (elements.currentPortrait) {
        if (user.portrait) {
            elements.currentPortrait.src = `${API_BASE}/Portraits/${user.portrait}`;
            elements.currentPortrait.onerror = function() {
                this.src = `${API_BASE}/Portraits/default.svg`;
            };
        } else {
            elements.currentPortrait.src = `${API_BASE}/Portraits/default.svg`;
        }
    }
    
    // Load claimed district if any
    loadClaimedDistrict();
}

// Fix the profile picture upload handler
async function handleProfilePictureUpload(event) {
    try {
        const file = event.target.files[0];
        if (!file) {
            showMessage('No file selected', 'error');
            return;
        }

        // Check file type
        if (!file.type.startsWith('image/')) {
            showMessage('Please upload an image file', 'error');
            return;
        }

        // Get claimed district from the page
        const districtKey = document.getElementById('claimedDistrict')?.textContent?.trim();
        if (!districtKey || districtKey === 'None') {
            showMessage('No claimed district found', 'error');
            return;
        }

        const formData = new FormData();
        formData.append('portrait', file);
        formData.append('districtKey', districtKey);

        const response = await fetch(`${API_BASE}/api/update-portrait`, {
            method: 'POST',
            credentials: 'include',
            body: formData
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Failed to upload portrait');
        }

        const data = await response.json();

        // Update the portrait display
        const portraitImg = document.getElementById('currentPortrait');
        if (portraitImg && data.filename) {
            portraitImg.src = `${API_BASE}/Portraits/${data.filename}?t=${Date.now()}`;
        }

        showMessage('Portrait updated successfully', 'success');
    } catch (error) {
        console.error('Error uploading portrait:', error);
        showMessage(error.message || 'Failed to upload portrait', 'error');
    }
}

async function handleProfileSubmit(event) {
    event.preventDefault();

    const formData = {
        fullName: document.getElementById('fullName').value,
        biography: document.getElementById('biography').value,
        location: document.getElementById('location').value,
        website: document.getElementById('website').value
    };

    try {
        const response = await fetch(`${API_BASE}/api/update-profile`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData),
            credentials: 'include'
        });

        const data = await response.json();
        if (response.ok) {
            showMessage('Profile updated successfully', 'success');
            currentUser = { ...currentUser, ...formData };
        } else {
            showMessage(data.message || 'Failed to update profile', 'error');
        }
    } catch (error) {
        console.error('Error updating profile:', error);
        showMessage('Error updating profile', 'error');
    }
}

async function loadClaimedDistrict() {
    try {
        const response = await fetch(`${API_BASE}/api/claimed-district`, { credentials: 'include' });
        const data = await response.json();
        const districtElement = document.getElementById('claimedDistrict');
        if (districtElement) {
            if (data.district) {
                districtElement.textContent = data.district;
            } else {
                districtElement.textContent = 'None';
            }
        }
    } catch (error) {
        const districtElement = document.getElementById('claimedDistrict');
        if (districtElement) {
            districtElement.textContent = 'None';
        }
    }
}

// Admin functions
function moderateDistricts() {
    window.location.href = 'moderate-districts.html';
}

function manageUsers() {
    window.location.href = 'manage-users.html';
}

function viewReports() {
    window.location.href = 'reports.html';
}

// Helper function to show messages
function showMessage(message, type = 'success') {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.textContent = message;
    document.body.appendChild(messageDiv);
    
    setTimeout(() => {
        messageDiv.remove();
    }, 3000);
}

function updateUIForUser() {
    if (!currentUser) {
        window.location.href = 'index.html';
        return;
    }

    // Update navigation menu
    const userMenu = document.querySelector('.user-menu');
    if (userMenu) {
        userMenu.innerHTML = `
            <span class="user-welcome">Welcome, ${currentUser.fullName}</span>
            <button class="btn" onclick="logout()">Logout</button>
        `;
    }

    // Update admin controls visibility
    const adminControls = document.getElementById('adminControls');
    if (adminControls) {
        adminControls.style.display = currentUser.isAdmin ? 'block' : 'none';
    }

    const adminKeyIssuer = document.getElementById('adminKeyIssuer');
    if (adminKeyIssuer) {
        adminKeyIssuer.style.display = currentUser.email === 'sydneybatchags@gmail.com' ? 'block' : 'none';
    }

    // Update profile form visibility
    const profileForm = document.getElementById('profileForm');
    if (profileForm) {
        profileForm.style.display = 'block';
    }
}

// Add logout function if not already present
async function logout() {
    try {
            const response = await fetch(`${API_BASE}/api/logout`, {
            method: 'POST',
            credentials: 'include'
        });

        if (response.ok) {
            window.location.href = 'index.html';
        } else {
            showMessage('Logout failed', 'error');
        }
    } catch (error) {
        console.error('Error during logout:', error);
        showMessage('Error during logout', 'error');
    }
}

async function generateAdminKey() {
    try {
        const response = await fetch(`${API_BASE}/api/admin/generate-key`, {
            method: 'POST',
            credentials: 'include'
        });
        const data = await response.json();
        if (!response.ok) {
            showMessage(data.message || 'Failed to generate admin key', 'error');
            return;
        }

        const output = document.getElementById('generatedAdminKey');
        if (output) {
            output.style.display = 'block';
            output.textContent = `New admin key: ${data.key.key}`;
        }
        showMessage('Admin key generated', 'success');
    } catch (error) {
        showMessage('Failed to generate admin key', 'error');
    }
}

async function redeemAdminKey() {
    const input = document.getElementById('adminKeyInput');
    const key = input?.value?.trim();
    if (!key) {
        showMessage('Enter an admin key first', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/admin/redeem-key`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ key })
        });
        const data = await response.json();
        if (!response.ok) {
            showMessage(data.message || 'Failed to redeem admin key', 'error');
            return;
        }

        showMessage('Admin access granted. Reloading profile...', 'success');
        setTimeout(() => window.location.reload(), 800);
    } catch (error) {
        showMessage('Failed to redeem admin key', 'error');
    }
}
