// Global variables
let currentUser = null;
const API_BASE = 'https://vchouse-production.up.railway.app';

// Modal functions
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'block';
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
        // Clear any error messages
        const errorElement = modal.querySelector('.form-error');
        if (errorElement) {
            errorElement.textContent = '';
        }
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    console.log('=== PAGE LOAD ===');
    
    // Check if user is logged in
    try {
        console.log('Checking auth status...');
        const response = await fetch(`${API_BASE}/api/auth-status`, {
            credentials: 'include'
        });
        const data = await response.json();
        console.log('Auth status response:', data);
        
        if (response.ok && data.user) {
            console.log('User is logged in:', data.user);
            currentUser = {
                id: data.user.id,
                fullName: data.user.fullName,
                email: data.user.email,
                party: data.user.party,
                isAdmin: data.user.isAdmin
            };
            console.log('Current user set to:', currentUser);
            updateUIForUser();
        } else {
            console.log('No user logged in');
            currentUser = null;
            updateUIForUser();
        }
    } catch (error) {
        console.error('Error checking auth status:', error);
        currentUser = null;
        updateUIForUser();
    }

    // Add login form handler
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        console.log('Login form found, adding submit handler');
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            console.log('=== LOGIN FORM SUBMISSION START ===');
            
            const email = document.getElementById('loginEmail').value;
            const password = document.getElementById('loginPassword').value;
            
            console.log('Form values:', { email, passwordLength: password ? password.length : 0 });
            
            if (!email || !password) {
                console.log('Missing form values');
                document.getElementById('loginError').textContent = 'Please enter both email and password';
                return;
            }
            
            try {
                console.log('Sending login request to /api/login');
                const response = await fetch(`${API_BASE}/api/login`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ email, password }),
                    credentials: 'include'
                });
                
                console.log('Response status:', response.status);
                const data = await response.json();
                console.log('Response data:', data);
                
                if (response.ok) {
                    console.log('Login successful, updating UI');
                    currentUser = {
                        id: data.user.id,
                        fullName: data.user.fullName,
                        email: data.user.email,
                        party: data.user.party,
                        isAdmin: data.user.isAdmin
                    };
                    console.log('Current user set to:', currentUser);
                    updateUIForUser();
                    closeModal('loginModal');
                    showMessage('Login successful', 'success');
                    // Reload the page to update the UI
                    location.reload();
                } else {
                    console.log('Login failed:', data.message);
                    document.getElementById('loginError').textContent = data.message || 'Login failed';
                }
            } catch (error) {
                console.error('Login error:', error);
                document.getElementById('loginError').textContent = 'Login failed. Please try again.';
            }
            console.log('=== LOGIN FORM SUBMISSION END ===');
        });
    } else {
        console.error('Login form not found in the DOM');
    }

    // Add click handlers for login and register buttons
    const loginBtn = document.getElementById('loginBtn');
    const registerBtn = document.getElementById('registerBtn');
    
    if (loginBtn) {
        loginBtn.addEventListener('click', () => openModal('loginModal'));
    }
    
    if (registerBtn) {
        registerBtn.addEventListener('click', () => openModal('registerModal'));
    }

    // Add click handlers for close buttons
    const closeButtons = document.querySelectorAll('.close-modal');
    closeButtons.forEach(button => {
        button.addEventListener('click', () => {
            const modal = button.closest('.modal');
            if (modal) {
                closeModal(modal.id);
            }
        });
    });

    // Close modal when clicking outside
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            closeModal(e.target.id);
        }
    });

    const urlParams = new URLSearchParams(window.location.search);
    const state = urlParams.get('state');
    const district = urlParams.get('district');

    if (state && district) {
        await loadDistrictData(state, district);
        updatePageTitle(state, district);
        initializeDistrictMap(state, district);
    }
});

async function loadDistrictData(state, district) {
    try {
        const response = await fetch('representatives_new.json');
        const data = await response.json();
        
        const districtKey = `${state}-${district}`;
        const representativeInfo = data[districtKey];
        
        if (representativeInfo && representativeInfo !== "N/A") {
            const [name, party] = representativeInfo.split(' (');
            const partyClean = party.replace(')', '');
            
            // Update representative info without auth check
            updateRepresentativeInfo({ Name: name, Party: partyClean }, districtKey, state, district);
            
            // Fetch biography without auth requirement
            fetch(`${API_BASE}/api/biography/${districtKey}`)
                .then(response => response.json())
                .then(data => {
                    const biographyText = document.getElementById('biographyText');
                    biographyText.innerHTML = data.biography || 'No biography available.';
                    updateShowMoreButton();
                })
                .catch(error => {
                    console.error('Error loading biography:', error);
                    document.getElementById('biographyText').innerHTML = 'No biography available.';
                });
                
            loadDistrictStats(state, district);
            updateClaimButton(false);
        } else {
            document.getElementById('representativeName').textContent = 'No Representative Assigned';
            document.getElementById('partyBadge').style.display = 'none';
            document.getElementById('biographyContent').innerHTML = '<p>No representative information available for this district.</p>';
            loadDistrictStats(state, district);
            updateClaimButton(true);
        }
    } catch (error) {
        console.error('Error loading district data:', error);
    }
}

function updateRepresentativeInfo(districtData, districtKey, state, district) {
    const nameElement = document.getElementById('representativeName');
    const partyBadgeElement = document.getElementById('partyBadge');
    const portraitElement = document.getElementById('representativePortrait');
    const biographyElement = document.getElementById('biographyContent');
    const representativeInfo = document.querySelector('.representative-info');

    // Clear any existing claim button or edit button
    const existingButtons = representativeInfo.querySelectorAll('.claim-district-btn, .edit-biography-btn');
    existingButtons.forEach(button => button.remove());

    if (districtData && districtData.Name) {
        nameElement.textContent = districtData.Name;
        
        // Convert party abbreviation to full name
        const partyMap = {
            'D': 'Democrat',
            'R': 'Republican',
            'I': 'Independent'
        };
        const fullPartyName = partyMap[districtData.Party] || districtData.Party;
        
        partyBadgeElement.textContent = fullPartyName;
        partyBadgeElement.className = `party-badge ${fullPartyName.toLowerCase()}`;
        partyBadgeElement.style.display = 'inline-block';
        
        portraitElement.src = `Portraits/${districtKey}.jpg`;
        portraitElement.alt = `${districtData.Name}'s Portrait`;
        
        // Biography section update
        const biographySection = document.createElement('div');
        biographySection.className = 'biography';
        biographySection.innerHTML = `
            <h2>Biography</h2>
            <div class="biography-container">
                <div class="biography-content" id="biographyContent">
                    <div id="biographyText"></div>
                    <div class="fade-bottom" id="fadeBottom"></div>
                </div>
                <div class="biography-buttons">
                    ${currentUser && currentUser.fullName === districtData.Name ? 
                        '<button class="edit-biography-btn" onclick="openBiographyEditor()">Edit Biography</button>' : 
                        ''}
                </div>
            </div>
        `;

        // Replace existing biography content
        const existingBiography = document.querySelector('.biography');
        if (existingBiography) {
            existingBiography.replaceWith(biographySection);
        } else {
            biographyElement.appendChild(biographySection);
        }

        // Fetch and display biography
        fetch(`${API_BASE}/api/get-biography`, {
            credentials: 'include',
            headers: { 'Accept': 'application/json' }
        })
        .then(response => response.json())
        .then(data => {
            const biographyText = document.getElementById('biographyText');
            if (data.biography) {
                biographyText.innerHTML = data.biography;
                updateShowMoreButton(); // Check if we need the show more button
            } else {
                biographyText.innerHTML = '<p>No biography available.</p>';
            }
        })
        .catch(error => {
            console.error('Error loading biography:', error);
            document.getElementById('biographyText').innerHTML = '<p>No biography available.</p>';
        });
    } else {
        nameElement.textContent = 'No Representative Assigned';
        partyBadgeElement.style.display = 'none';
        biographyElement.innerHTML = '<p>This district is currently vacant.</p>';
        
        // Add claim district button
        const claimButton = document.createElement('button');
        claimButton.className = 'claim-district-btn';
        claimButton.textContent = 'Claim District';
        claimButton.addEventListener('click', () => {
            if (!currentUser) {
                openModal('loginModal');
            } else {
                handleClaimDistrict(state, district);
            }
        });
        representativeInfo.appendChild(claimButton);
    }
}

// Biography editor functions
function openBiographyEditor() {
    const editor = document.getElementById('biographyEditor');
    // Get current biography
    fetch(`${API_BASE}/api/get-biography`, {
        credentials: 'include'
    })
    .then(response => response.json())
    .then(data => {
        editor.innerHTML = data.biography || '';
        openModal('biographyModal');
    })
    .catch(error => {
        console.error('Error loading biography:', error);
        editor.innerHTML = '';
        openModal('biographyModal');
    });
}

// Handle biography form submission
document.getElementById('biographyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const editor = document.getElementById('biographyEditor');
    const biography = editor.innerText; // Use innerText instead of innerHTML to get plain text
    
    try {
        const response = await fetch(`${API_BASE}/api/update-biography`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ biography }),
            credentials: 'include'
        });
        
        const data = await response.json();
        if (response.ok) {
            closeModal('biographyModal');
            location.reload();
        } else {
            document.getElementById('biographyError').textContent = data.message || 'Failed to update biography';
        }
    } catch (error) {
        console.error('Error updating biography:', error);
        document.getElementById('biographyError').textContent = 'Failed to update biography. Please try again.';
    }
});

// Registration form handler
document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    console.log('Registration form submitted');

    const errorDiv = document.getElementById('registerError');
    const formData = new FormData(e.target);

    const registrationData = {
        fullName: formData.get('fullName'),
        email: formData.get('email'),
        password: formData.get('password'),
        party: formData.get('party')
    };

    // Validate form data
    if (!registrationData.fullName || !registrationData.email || !registrationData.password || !registrationData.party) {
        errorDiv.textContent = 'All fields are required';
        return;
    }

    // Password confirmation check
    if (formData.get('password') !== formData.get('confirmPassword')) {
        errorDiv.textContent = 'Passwords do not match';
        return;
    }

    console.log('Sending registration request...');
    try {
        const response = await fetch(`${API_BASE}/api/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(registrationData),
            credentials: 'include'
        });

        if (!response.ok) {
            const data = await response.json();
            errorDiv.textContent = data.message || 'Registration failed';
            return;
        }

        const data = await response.json();
        console.log('Registration successful:', data);
        closeModal('registerModal');
        showMessage('Registration successful! Please log in.');
        e.target.reset();
    } catch (error) {
        console.error('Registration error:', error);
        errorDiv.textContent = 'Error connecting to server. Please try again.';
    }
});

function loadDistrictStats(state, district) {
    const statsElement = document.getElementById('districtStats');
    const districtName = getDistrictFullName(state, district);
    
    statsElement.innerHTML = `
        <div class="stat-label">District</div>
        <div class="stat-value">${districtName}</div>
    `;
}

function initializeDistrictMap(state, district) {
    const map = L.map('districtMap', {
        center: [39.8283, -98.5795],
        zoom: 4,
        zoomControl: true,
        attributionControl: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    fetch('delawaretesting.geojson')
        .then(response => response.json())
        .then(data => {
            const districtKey = `${state}-${district}`;
            const districtFeature = data.features.find(f => f.properties.KeyComposite === districtKey);
            
            if (districtFeature) {
                console.log('District data:', districtFeature.properties);
                const layer = L.geoJSON(districtFeature, {
                    style: {
                        color: '#003366',
                        weight: 2,
                        fillOpacity: 0.3,
                        fillColor: '#003366'
                    }
                }).addTo(map);
                
                const bounds = layer.getBounds();
                map.fitBounds(bounds, {
                    padding: [50, 50],
                    maxZoom: 10
                });

                // Initialize pie charts with actual data from the GeoJSON
                initializePieCharts(districtFeature.properties);
            } else {
                console.error('District not found:', districtKey);
                document.getElementById('districtMap').innerHTML = 'District boundary not found';
            }
        })
        .catch(error => {
            console.error('Error loading district map:', error);
            document.getElementById('districtMap').innerHTML = 'Error loading district map';
        });
}

function initializePieCharts(districtData) {
    if (!districtData) {
        console.error('No district data provided for pie charts');
        return;
    }

    console.log('Initializing pie charts with data:', districtData);

    // Demographic Chart
    const demographicCtx = document.getElementById('demographicChart').getContext('2d');
    const whitePct = Math.round(parseFloat(districtData.WhitePct) * 100 || 0);
    const blackPct = Math.round(parseFloat(districtData.BlackPct) * 100 || 0);
    const hispanicPct = Math.round(parseFloat(districtData.HispanicPct) * 100 || 0);
    const asianPct = Math.round(parseFloat(districtData.AsianPct) * 100 || 0);
    const pacificPct = Math.round(parseFloat(districtData.PacificPct) * 100 || 0);
    const nativePct = Math.round(parseFloat(districtData.NativePct) * 100 || 0);
    const otherPct = Math.max(0, Math.round(pacificPct + nativePct));

    console.log('Demographic percentages:', { whitePct, blackPct, hispanicPct, asianPct, pacificPct, nativePct, otherPct });

    new Chart(demographicCtx, {
        type: 'pie',
        data: {
            labels: [
                `White (${whitePct}%)`,
                `Black (${blackPct}%)`,
                `Hispanic (${hispanicPct}%)`,
                `Asian (${asianPct}%)`,
                `Other (${otherPct}%)`
            ],
            datasets: [{
                data: [whitePct, blackPct, hispanicPct, asianPct, otherPct],
                backgroundColor: [
                    '#003366',
                    '#B5985A',
                    '#005DA6',
                    '#4A90E2',
                    '#7FB3D5'
                ]
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });

    // Voting History Chart
    const votingCtx = document.getElementById('votingChart').getContext('2d');
    const demPct = Math.round(parseFloat(districtData.DemPct) * 100 || 0);
    const repPct = Math.round(parseFloat(districtData.RepPct) * 100 || 0);
    const otherVotePct = Math.max(0, Math.round(100 - (demPct + repPct)));

    console.log('Voting percentages:', { demPct, repPct, otherVotePct });

    new Chart(votingCtx, {
        type: 'pie',
        data: {
            labels: [
                `Democratic (${demPct}%)`,
                `Republican (${repPct}%)`,
                `Other (${otherVotePct}%)`
            ],
            datasets: [{
                data: [demPct, repPct, otherVotePct],
                backgroundColor: [
                    '#0015BC',
                    '#FF0000',
                    '#4B0082'
                ]
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
}

function getDistrictFullName(state, district) {
    const stateNames = {
        'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
        'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
        'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho',
        'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas',
        'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
        'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
        'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
        'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
        'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma',
        'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
        'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
        'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia',
        'WI': 'Wisconsin', 'WY': 'Wyoming'
    };
    
    return `${stateNames[state]}'s ${district}${getOrdinalSuffix(district)} Congressional District`;
}

function getOrdinalSuffix(num) {
    const j = num % 10;
    const k = num % 100;
    if (j === 1 && k !== 11) return 'st';
    if (j === 2 && k !== 12) return 'nd';
    if (j === 3 && k !== 13) return 'rd';
    return 'th';
}

function updatePageTitle(state, district) {
    document.title = `${getDistrictFullName(state, district)} - VCHouse.gov`;
}

// Add handleClaimDistrict function
async function handleClaimDistrict(state, district) {
    if (!currentUser) {
        openModal('loginModal');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/claim-district`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ state, district }),
            credentials: 'include'
        });

        const data = await response.json();
        if (response.ok) {
            showMessage('District claimed successfully', 'success');
            // Reload the page to update the UI
            location.reload();
        } else {
            showMessage(data.message || 'Failed to claim district', 'error');
        }
    } catch (error) {
        console.error('Error claiming district:', error);
        showMessage('Failed to claim district. Please try again.', 'error');
    }
}

// Add showMessage function
function showMessage(message, type = 'info') {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.textContent = message;
    document.body.appendChild(messageDiv);
    
    // Remove message after 3 seconds
    setTimeout(() => {
        messageDiv.remove();
    }, 3000);
}

// Add this function to update UI based on user state
function updateUIForUser() {
    console.log('=== UPDATING UI FOR USER ===');
    console.log('Current user:', currentUser);
    
    const userMenu = document.querySelector('.user-menu');
    if (!userMenu) {
        console.error('User menu element not found');
        return;
    }

    if (currentUser && currentUser.fullName) {
        console.log('Updating UI for logged-in user:', currentUser.fullName);
        userMenu.innerHTML = `
            <div class="user-info">
                <span class="welcome-text">Welcome, ${currentUser.fullName}</span>
                <button class="btn btn-logout" onclick="logout()">Logout</button>
            </div>
        `;
    } else {
        console.log('Updating UI for logged-out state');
        userMenu.innerHTML = `
            <div class="auth-buttons">
                <button class="btn btn-login" id="loginBtn">Login</button>
                <button class="btn btn-register" id="registerBtn">Register</button>
            </div>
        `;
        
        // Reattach event listeners
        const loginBtn = document.getElementById('loginBtn');
        const registerBtn = document.getElementById('registerBtn');
        
        if (loginBtn) {
            loginBtn.addEventListener('click', () => openModal('loginModal'));
        }
        if (registerBtn) {
            registerBtn.addEventListener('click', () => openModal('registerModal'));
        }
    }
}

// Add logout function
async function logout() {
    try {
        console.log('Attempting to logout');
        const response = await fetch(`${API_BASE}/api/logout`, {
            method: 'POST',
            credentials: 'include'
        });
        
        if (response.ok) {
            console.log('Logout successful');
            currentUser = null;
            updateUIForUser();
            showMessage('Logged out successfully', 'success');
            // Reload the page to update all UI elements
            location.reload();
        } else {
            console.error('Logout failed:', response.status);
            showMessage('Failed to logout', 'error');
        }
    } catch (error) {
        console.error('Logout error:', error);
        showMessage('Failed to logout', 'error');
    }
}

// Add this function to check content height and manage button visibility
function updateShowMoreButton() {
    const biographyContent = document.getElementById('biographyContent');
    const showMoreBtn = document.getElementById('showMoreBtn');
    const fadeBottom = document.getElementById('fadeBottom');
    
    if (!biographyContent || !showMoreBtn || !fadeBottom) return;

    // Set initial max-height
    biographyContent.style.maxHeight = '150px';
    
    // Compare content height with container height
    if (biographyContent.scrollHeight > biographyContent.offsetHeight) {
        showMoreBtn.style.display = 'block';
        fadeBottom.style.display = 'block';
    } else {
        showMoreBtn.style.display = 'none';
        fadeBottom.style.display = 'none';
    }
}

// Update your biography fetch handler
async function fetchBiography(user) {
    try {
        const response = await fetch(`${API_BASE}/api/biography`);
        console.log('Biography response status:', response.status);
        
        if (response.ok) {
            const data = await response.json();
            console.log('Biography data:', data);
            
            // Update biography content
            const biographyText = document.getElementById('biographyText');
            biographyText.innerHTML = data.biography || 'No biography available.';
            
            // Check button visibility after content is updated
            updateShowMoreButton();
        }
    } catch (error) {
        console.error('Error fetching biography:', error);
    }
}

// Update your event listener setup
document.addEventListener('DOMContentLoaded', function() {
    const biographyContent = document.getElementById('biographyContent');
    const showMoreBtn = document.getElementById('showMoreBtn');
    const fadeBottom = document.getElementById('fadeBottom');

    // Check if elements exist
    if (showMoreBtn && biographyContent && fadeBottom) {
        // Set initial state
        if (biographyContent.scrollHeight > 150) {
            showMoreBtn.style.display = 'block';
            fadeBottom.style.display = 'block';
        }

        showMoreBtn.addEventListener('click', function() {
            if (biographyContent.classList.contains('expanded')) {
                // Collapse
                biographyContent.classList.remove('expanded');
                biographyContent.style.maxHeight = '150px';
                showMoreBtn.textContent = 'Show More';
                fadeBottom.style.display = 'block';
            } else {
                // Expand
                biographyContent.classList.add('expanded');
                biographyContent.style.maxHeight = 'none';
                showMoreBtn.textContent = 'Show Less';
                fadeBottom.style.display = 'none';
            }
        });
    }
});

// Update the updateBiographyDisplay function
function updateBiographyDisplay() {
    const biographyContent = document.getElementById('biographyContent');
    const showMoreBtn = document.getElementById('showMoreBtn');
    const fadeBottom = document.getElementById('fadeBottom');
    
    if (!biographyContent || !showMoreBtn || !fadeBottom) return;

    // Reset max-height to check true scroll height
    const tempMaxHeight = biographyContent.style.maxHeight;
    biographyContent.style.maxHeight = 'none';
    const scrollHeight = biographyContent.scrollHeight;
    biographyContent.style.maxHeight = tempMaxHeight;

    // Compare content height with max height (150px)
    if (scrollHeight > 150) {
        showMoreBtn.style.display = 'block';
        fadeBottom.style.display = 'block';
        biographyContent.style.maxHeight = '150px';
    } else {
        showMoreBtn.style.display = 'none';
        fadeBottom.style.display = 'none';
    }
}

// Add after initial district data loading
function updateClaimButton(isVacant) {
    const container = document.getElementById('claimDistrictContainer');
    if (isVacant) {
        container.innerHTML = `
            <button class="claim-district-btn" onclick="claimDistrict()">
                Claim This District
            </button>
        `;
    } else {
        container.innerHTML = '';
    }
}

async function claimDistrict() {
    if (!currentUser) {
        openModal('loginModal');
        return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const state = urlParams.get('state');
    const district = urlParams.get('district');

    try {
        const response = await fetch(`${API_BASE}/api/claim-district`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ state, district }),
            credentials: 'include'
        });

        const data = await response.json();

        if (response.ok) {
            showMessage('District claimed successfully!', 'success');
            // Reload the page to show updated information
            setTimeout(() => window.location.reload(), 1500);
        } else {
            showMessage(data.message || 'Failed to claim district', 'error');
        }
    } catch (error) {
        console.error('Error claiming district:', error);
        showMessage('Error claiming district', 'error');
    }
}

// Update loadDistrictData to include claim button logic
async function loadDistrictData(state, district) {
    try {
        const response = await fetch('representatives_new.json');
        const data = await response.json();
        
        const districtKey = `${state}-${district}`;
        const representativeInfo = data[districtKey];
        
        if (representativeInfo && representativeInfo !== "N/A") {
            const [name, party] = representativeInfo.split(' (');
            const partyClean = party.replace(')', '');
            
            // Update representative info without auth check
            updateRepresentativeInfo({ Name: name, Party: partyClean }, districtKey, state, district);
            
            // Fetch biography without auth requirement
            fetch(`/api/biography/${districtKey}`)
                .then(response => response.json())
                .then(data => {
                    const biographyText = document.getElementById('biographyText');
                    biographyText.innerHTML = data.biography || 'No biography available.';
                    updateShowMoreButton();
                })
                .catch(error => {
                    console.error('Error loading biography:', error);
                    document.getElementById('biographyText').innerHTML = 'No biography available.';
                });
                
            loadDistrictStats(state, district);
            updateClaimButton(false);
        } else {
            document.getElementById('representativeName').textContent = 'No Representative Assigned';
            document.getElementById('partyBadge').style.display = 'none';
            document.getElementById('biographyContent').innerHTML = '<p>No representative information available for this district.</p>';
            loadDistrictStats(state, district);
            updateClaimButton(true);
        }
    } catch (error) {
        console.error('Error loading district data:', error);
    }
}

async function unclaimDistrict() {
    if (!confirm('Are you sure you want to unclaim this district? This action cannot be undone.')) {
        return;
    }

    try {
        // Get current district info from URL
        const urlParams = new URLSearchParams(window.location.search);
        const state = urlParams.get('state');
        const district = urlParams.get('district');

        const response = await fetch(`${API_BASE}/api/unclaim-district`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ state, district }),
            credentials: 'include'
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.message || 'Failed to unclaim district');
        }

        const data = await response.json();
        showMessage('District unclaimed successfully');
        
        // Redirect to main page after short delay
        setTimeout(() => {
            window.location.href = 'VCHouse2.html';
        }, 1500);
    } catch (error) {
        console.error('Error unclaiming district:', error);
        showMessage('Error unclaiming district: ' + error.message, 'error');
    }
}

async function loadBiographyFromAPI() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const state = urlParams.get('state');
        const district = urlParams.get('district');
        const districtKey = `${state}-${district}`;

        const response = await fetch(`${API_BASE}/api/get-district-biography/${districtKey}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const biographyText = document.getElementById('biographyText');
        if (biographyText) {
            biographyText.innerHTML = data.biography || 'No biography available.';
        }
    } catch (error) {
        console.error('Error loading biography:', error);
        const biographyText = document.getElementById('biographyText');
        if (biographyText) {
            biographyText.textContent = 'Error loading biography.';
        }
    }
}

// Call this function after DOMContentLoaded or wherever appropriate
document.addEventListener('DOMContentLoaded', () => {
    loadBiographyFromAPI();
});
