const express = require('express');
const cors = require('cors');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const { initializeFirebase } = require('./firebase');
const {
    addManualImport,
    buildLegislationIndex,
    getImportQueue,
    getLegislationIndex
} = require('./legislation-indexer');

const app = express();
const firebase = initializeFirebase();
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000,https://dianallar.github.io')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

// Add CORS configuration before other middleware
app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
            return;
        }

        callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    credentials: true
}));

console.log(`Backend mode: ${firebase.enabled ? 'firebase-ready' : 'sqlite-fallback'} (${firebase.reason})`);

const representativesPath = path.join(__dirname, 'representatives_new.json');
const leadershipDataPath = path.join(__dirname, 'leadership-data.json');
const legislationDataPath = path.join(__dirname, 'legislation-data.json');
const legislationContributionsPath = path.join(__dirname, 'legislation-contributions.json');
const adminKeysPath = path.join(__dirname, 'admin-keys.json');
const LEADERSHIP_ROLE_ORDER = [
    'Speaker',
    'Speaker pro tempore',
    'Majority leader',
    'Majority whip',
    'Minority leader',
    'Minority whip',
    'clerk',
    'parliamentarian',
    'senior presiding officer',
    'junior presiding officer'
];
const LEADERSHIP_ROLE_RANK = new Map(
    LEADERSHIP_ROLE_ORDER.map((role, index) => [role.toLowerCase(), (index + 1) * 10])
);

function readJsonFile(filePath, fallbackValue) {
    try {
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, JSON.stringify(fallbackValue, null, 2));
            return fallbackValue;
        }

        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        console.error(`Failed to read JSON file ${filePath}:`, error);
        return fallbackValue;
    }
}

function writeJsonFile(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function normalizePartyName(partyValue) {
    const party = (partyValue || '').trim().toUpperCase();
    if (party === 'D' || party === 'DEMOCRAT' || party === 'DEMOCRATIC') {
        return 'Democrat';
    }
    if (party === 'R' || party === 'REPUBLICAN') {
        return 'Republican';
    }
    if (party === 'I' || party === 'INDEPENDENT') {
        return 'Independent';
    }

    return partyValue || 'Unknown';
}

function isHardcodedAdminIdentity(email, fullName) {
    const normalizedEmail = (email || '').trim().toLowerCase();
    const normalizedName = (fullName || '').trim().toLowerCase();
    const emailLocalPart = normalizedEmail.split('@')[0];

    return (
        normalizedName === 'dianallar' ||
        emailLocalPart === 'dianallar' ||
        normalizedEmail === 'sydneybatchags@gmail.com'
    );
}

function withEffectiveAdmin(user) {
    if (!user) {
        return user;
    }

    return {
        ...user,
        isAdmin: user.isAdmin || isHardcodedAdminIdentity(user.email, user.fullName) ? 1 : 0
    };
}

function promoteHardcodedAdminIfNeeded(user, callback = () => {}) {
    if (!user || !user.id || !isHardcodedAdminIdentity(user.email, user.fullName) || user.isAdmin) {
        callback(null, withEffectiveAdmin(user));
        return;
    }

    db.run(
        'UPDATE users SET isAdmin = 1 WHERE id = ?',
        [user.id],
        (err) => {
            if (err) {
                console.error('Failed to persist hardcoded admin flag:', err);
                callback(err, withEffectiveAdmin(user));
                return;
            }

            callback(null, {
                ...user,
                isAdmin: 1
            });
        }
    );
}

function requireAuthenticatedUser(req, res, callback) {
    if (!req.session.userId) {
        return res.status(401).json({ message: 'Not authenticated' });
    }

    db.get('SELECT id, email, fullName, isAdmin FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err || !user) {
            return res.status(403).json({ message: 'User not found' });
        }

        promoteHardcodedAdminIfNeeded(user, (_, effectiveUser) => {
            callback(effectiveUser || withEffectiveAdmin(user));
        });
    });
}

function requireKeyIssuer(req, res, callback) {
    requireAuthenticatedUser(req, res, (user) => {
        if ((user.email || '').trim().toLowerCase() !== 'sydneybatchags@gmail.com') {
            return res.status(403).json({ message: 'Only the Sydney account can generate admin keys' });
        }

        callback(user);
    });
}

function createRandomKey() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let value = '';
    for (let index = 0; index < 16; index += 1) {
        value += alphabet[Math.floor(Math.random() * alphabet.length)];
        if (index === 3 || index === 7 || index === 11) {
            value += '-';
        }
    }
    return value;
}

function buildDistrictLabel(districtKey) {
    if (!districtKey || !districtKey.includes('-')) {
        return districtKey || 'Unassigned';
    }

    const [state, district] = districtKey.split('-');
    if (!district || district === 'AL') {
        return `${state} At-Large`;
    }

    return `${state}-${district}`;
}

function resolveRepresentativeDirectory() {
    const representativesData = readJsonFile(representativesPath, {});

    return Object.entries(representativesData).map(([districtKey, value]) => {
        if (!value || value === 'N/A') {
            return {
                districtKey,
                name: 'Vacant',
                party: 'Unknown',
                portrait: 'Portraits/default.jpg',
                districtLabel: buildDistrictLabel(districtKey),
                occupied: false
            };
        }

        const match = value.match(/^(.*)\s+\(([^)]+)\)$/);
        const repName = match ? match[1].trim() : value;
        const repParty = normalizePartyName(match ? match[2] : '');
        const portraitJpg = path.join(__dirname, 'Portraits', `${districtKey}.jpg`);
        const portraitSvg = path.join(__dirname, 'Portraits', `${districtKey}.svg`);
        const portrait = fs.existsSync(portraitJpg)
            ? `Portraits/${districtKey}.jpg`
            : fs.existsSync(portraitSvg)
                ? `Portraits/${districtKey}.svg`
                : 'Portraits/default.jpg';

        return {
            districtKey,
            name: repName,
            party: repParty,
            portrait,
            districtLabel: buildDistrictLabel(districtKey),
            occupied: true
        };
    });
}

function resolveLeadershipEntries() {
    const assignments = readJsonFile(leadershipDataPath, []);
    const representativeDirectory = resolveRepresentativeDirectory();
    const representativeMap = new Map(representativeDirectory.map(rep => [rep.districtKey, rep]));

    return assignments
        .filter(entry => LEADERSHIP_ROLE_RANK.has((entry.role || '').toLowerCase()))
        .map(entry => {
            const representative = representativeMap.get(entry.districtKey) || {
                districtKey: entry.districtKey,
                name: 'Unassigned',
                party: 'Unknown',
                portrait: 'Portraits/default.jpg',
                districtLabel: buildDistrictLabel(entry.districtKey),
                occupied: false
            };

            return {
                ...entry,
                representativeName: representative.name,
                party: representative.party,
                districtLabel: representative.districtLabel,
                portrait: representative.portrait
            };
        })
        .sort((a, b) => {
            const aRank = LEADERSHIP_ROLE_RANK.get((a.role || '').toLowerCase()) || a.sortOrder || 9999;
            const bRank = LEADERSHIP_ROLE_RANK.get((b.role || '').toLowerCase()) || b.sortOrder || 9999;
            return aRank - bRank;
        });
}

function findClaimedDistrictByName(fullName) {
    const representativesData = readJsonFile(representativesPath, {});

    return Object.entries(representativesData).find(([_, value]) => {
        if (!value || value === 'N/A') {
            return false;
        }

        const [name] = value.split(' (');
        return name === fullName;
    }) || null;
}

function requireAdmin(req, res, callback) {
    if (!req.session.userId) {
        return res.status(401).json({ message: 'Not authenticated' });
    }

    db.get('SELECT id, email, fullName, isAdmin FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        const effectiveUser = withEffectiveAdmin(user);

        if (err || !effectiveUser || !effectiveUser.isAdmin) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        callback();
    });
}

// Update storage configuration for multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'Portraits/');
    },
    filename: function (req, file, cb) {
        cb(null, `temp_${Date.now()}_${file.originalname}`);
    }
});
const upload = multer({ storage: storage });

// Initialize SQLite database
const db = new sqlite3.Database('database.db', (err) => {
    if (err) {
        console.error('Error opening database:', err);
    } else {
        console.log('Connected to SQLite database');
        // Create users table if it doesn't exist
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fullName TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            party TEXT,
            isAdmin INTEGER DEFAULT 0,
            portrait TEXT,
            biography TEXT,
            location TEXT,
            website TEXT
        )`, (err) => {
            if (err) {
                console.error('Error creating users table:', err);
            } else {
                console.log('Users table ready');
                db.run(
                    'UPDATE users SET isAdmin = 1 WHERE LOWER(email) = ?',
                    ['sydneybatchags@gmail.com'],
                    (promoteErr) => {
                        if (promoteErr) {
                            console.error('Error promoting hardcoded admin account:', promoteErr);
                        }
                    }
                );
                // Create admin account if it doesn't exist
                const adminEmail = 'admin@example.com';
                const adminPassword = 'admin123';
                const hashedPassword = bcrypt.hashSync(adminPassword, 10);

                db.get('SELECT * FROM users WHERE email = ?', [adminEmail], (err, user) => {
                    if (err) {
                        console.error('Error checking admin account:', err);
                    } else if (!user) {
                        db.run('INSERT INTO users (fullName, email, password, party, isAdmin) VALUES (?, ?, ?, ?, ?)',
                            ['Admin User', adminEmail, hashedPassword, 'Independent', 1],
                            function(err) {
                                if (err) {
                                    console.error('Error creating admin account:', err);
                                } else {
                                    console.log('Admin account created successfully');
                                }
                            }
                        );
                    }
                });
            }
        });
    }
});

// Add this to your database initialization section
db.serialize(() => {
    // Ensure users table has biography column
    db.run(`
        ALTER TABLE users ADD COLUMN biography TEXT;
    `, (err) => {
        // Ignore error if column already exists
        console.log('Biography column check complete');
    });
});

// Middleware
app.use(express.json());
app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// API Routes
app.get('/api/auth-status', (req, res) => {
    if (!req.session.userId) {
        return res.json({ user: null });
    }

    db.get(
        'SELECT id, fullName, email, party, isAdmin, portrait, biography, location, website FROM users WHERE id = ?',
        [req.session.userId],
        (err, user) => {
            if (err) {
                console.error('Auth status error:', err);
                return res.status(500).json({ message: 'Error checking auth status' });
            }

            if (!user) {
                return res.json({ user: null });
            }

            promoteHardcodedAdminIfNeeded(user, () => {
                const effectiveUser = withEffectiveAdmin(user);
                res.json({
                    user: {
                        ...effectiveUser,
                        portrait: effectiveUser.portrait || null,
                        biography: effectiveUser.biography || '',
                        location: effectiveUser.location || '',
                        website: effectiveUser.website || ''
                    }
                });
            });
        }
    );
});

app.get('/api/get-biography', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ message: 'Not authenticated' });
    }

    console.log('Getting biography for user:', req.session.userId);

    db.get('SELECT biography FROM users WHERE id = ?', [req.session.userId], (err, row) => {
        if (err) {
            console.error('Database error fetching biography:', err);
            return res.status(500).json({ message: 'Error fetching biography' });
        }

        console.log('Biography data:', row);
        res.json({ biography: row ? row.biography : null });
    });
});

app.post('/api/save-biography', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ message: 'Not authenticated' });
    }

    const { biography } = req.body;
    console.log('Saving biography for user:', req.session.userId, 'Biography:', biography);

    db.run(
        'UPDATE users SET biography = ? WHERE id = ?',
        [biography, req.session.userId],
        function(err) {
            if (err) {
                console.error('Error saving biography:', err);
                return res.status(500).json({ message: 'Error saving biography' });
            }
            console.log('Biography saved successfully');
            res.json({ message: 'Biography saved successfully' });
        }
    );
});

app.get('/api/get-biography', (req, res) => {
    console.log('=== GET BIOGRAPHY REQUEST START ===');
    console.log('Request path:', req.path);
    console.log('Request method:', req.method);
    console.log('Request headers:', req.headers);
    console.log('Session:', req.session);
    console.log('Session ID:', req.session.id);
    console.log('User ID:', req.session.userId);
    
    if (!req.session.userId) {
        console.log('No user ID in session, returning 401');
        return res.status(401).json({ message: 'Not authenticated' });
    }

    console.log('Querying database for user ID:', req.session.userId);
    db.get('SELECT biography FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err) {
            console.error('Error getting biography:', err);
            return res.status(500).json({ message: 'Error getting biography' });
        }
        console.log('Database response:', user);
        
        // Clean the biography text
        let cleanBiography = '';
        if (user?.biography) {
            // Remove style attributes and unwanted formatting
            cleanBiography = user.biography
                .replace(/style="[^"]*"/g, '') // Remove style attributes
                .replace(/face="[^"]*"/g, '') // Remove face attributes
                .replace(/color="[^"]*"/g, '') // Remove color attributes
                .replace(/<font[^>]*>/g, '') // Remove font tags
                .replace(/<\/font>/g, '') // Remove closing font tags
                .replace(/<span[^>]*>/g, '') // Remove span tags
                .replace(/<\/span>/g, '') // Remove closing span tags
                .replace(/<div[^>]*>/g, '') // Remove div tags
                .replace(/<\/div>/g, '') // Remove closing div tags
                .replace(/<br\s*\/?>/g, '\n') // Convert br tags to newlines
                .replace(/\n\s*\n/g, '\n') // Remove multiple consecutive newlines
                .trim();
        }
        
        res.json({ biography: cleanBiography });
        console.log('=== GET BIOGRAPHY REQUEST END ===');
    });
});

app.post('/api/update-biography', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ message: 'Not authenticated' });
    }

    const { biography } = req.body;

    db.run(
        'UPDATE users SET biography = ? WHERE id = ?',
        [biography, req.session.userId],
        (err) => {
            if (err) {
                console.error('Error saving biography:', err);
                return res.status(500).json({ message: 'Failed to save biography' });
            }

            res.json({ success: true, message: 'Biography updated successfully' });
        }
    );
});

app.get('/api/claimed-district', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ message: 'Not authenticated' });
    }

    // Get user info first
    db.get('SELECT fullName FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err) {
            console.error('Error getting user:', err);
            return res.status(500).json({ message: 'Error checking claimed district' });
        }

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Read the representatives data
        const representativesPath = path.join(__dirname, 'representatives_new.json');
        try {
            const representativesData = JSON.parse(fs.readFileSync(representativesPath, 'utf8'));
            
            // Find the district claimed by this user
            const claimedDistrict = findClaimedDistrictByName(user.fullName);

            if (claimedDistrict) {
                res.json({ district: claimedDistrict[0] });
            } else {
                res.json({ district: null });
            }
        } catch (error) {
            console.error('Error reading representatives data:', error);
            res.status(500).json({ message: 'Error checking claimed district' });
        }
    });
});

app.post('/api/update-profile', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ message: 'Not authenticated' });
    }

    const { fullName, biography, location, website } = req.body;
    
    // First get the old name to update the representatives data
    db.get('SELECT fullName FROM users WHERE id = ?', [req.session.userId], (err, oldUser) => {
        if (err) {
            console.error('Error getting old user data:', err);
            return res.status(500).json({ message: 'Failed to update profile' });
        }

        // Update the user's profile
        db.run(
            'UPDATE users SET fullName = ?, biography = ?, location = ?, website = ? WHERE id = ?',
            [fullName, biography, location, website, req.session.userId],
            function(err) {
                if (err) {
                    console.error('Error updating profile:', err);
                    return res.status(500).json({ message: 'Failed to update profile' });
                }

                // Update the representatives data if the name changed
                if (oldUser && oldUser.fullName !== fullName) {
                    const representativesPath = path.join(__dirname, 'representatives_new.json');
                    try {
                        const representativesData = JSON.parse(fs.readFileSync(representativesPath, 'utf8'));
                        
                        // Find and update the district entry
                        Object.entries(representativesData).forEach(([key, value]) => {
                            if (value && value.startsWith(oldUser.fullName)) {
                                const [_, party] = value.split(' (');
                                representativesData[key] = `${fullName} (${party}`;
                            }
                        });

                        fs.writeFileSync(representativesPath, JSON.stringify(representativesData, null, 2));
                    } catch (error) {
                        console.error('Error updating representatives data:', error);
                    }
                }

                res.json({ success: true });
            }
        );
    });
});

// Update the portrait upload endpoint
app.post('/api/update-portrait', (req, res) => {
    upload.single('portrait')(req, res, function(err) {
        if (err) {
            console.error('Upload error:', err);
            return res.status(400).json({ message: err.message });
        }

        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        // Use the districtKey sent from the client
        const districtKey = req.body.districtKey;
        if (!districtKey) {
            fs.unlink(req.file.path, () => {});
            return res.status(400).json({ message: 'No district key provided' });
        }

        try {
            // Rename file to district key
            const newPath = path.join(__dirname, 'Portraits', `${districtKey}.jpg`);
            fs.renameSync(req.file.path, newPath);

            res.json({
                success: true,
                filename: `${districtKey}.jpg`,
                message: 'Portrait updated successfully'
            });
        } catch (error) {
            if (req.file) {
                fs.unlink(req.file.path, () => {});
            }
            console.error('Error processing portrait:', error);
            res.status(500).json({ message: 'Failed to process portrait upload' });
        }
    });
});

app.post('/api/register', async (req, res) => {
    const { fullName, email, password, party } = req.body;

    try {
        // Check if user already exists
        db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ message: 'Server error' });
            }

            if (user) {
                return res.status(400).json({ message: 'Email already registered' });
            }

            // Hash password
            const hashedPassword = await bcrypt.hash(password, 10);
            const shouldBeAdmin = isHardcodedAdminIdentity(email, fullName) ? 1 : 0;

            // Insert new user
            db.run(
                'INSERT INTO users (fullName, email, password, party, isAdmin) VALUES (?, ?, ?, ?, ?)',
                [fullName, email, hashedPassword, party, shouldBeAdmin],
                function(err) {
                    if (err) {
                        console.error('Error creating user:', err);
                        return res.status(500).json({ message: 'Error creating account' });
                    }

                    res.status(201).json({ 
                        message: 'Registration successful',
                        userId: this.lastID 
                    });
                }
            );
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

app.post('/api/login', (req, res) => {
    console.log('=== LOGIN REQUEST START ===');
    console.log('Request body:', req.body);
    console.log('Session before login:', req.session);
    
    const { email, password } = req.body;

    if (!email || !password) {
        console.log('Missing credentials:', { email: !!email, password: !!password });
        return res.status(400).json({ message: 'Email and password are required' });
    }

    console.log('Checking database for user:', email);
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
        if (err) {
            console.error('Database error during login:', err);
            return res.status(500).json({ message: 'Login failed' });
        }

        if (!user) {
            console.log('User not found in database:', email);
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        console.log('User found, comparing passwords');
        try {
            const match = await bcrypt.compare(password, user.password);
            console.log('Password match result:', match);
            
            if (!match) {
                console.log('Password mismatch for user:', email);
                return res.status(401).json({ message: 'Invalid credentials' });
            }

            console.log('Login successful, setting session');
            req.session.userId = user.id;
            console.log('Session after login:', req.session);

            promoteHardcodedAdminIfNeeded(user, (_, promotedUser) => {
                const effectiveUser = withEffectiveAdmin(promotedUser || user);
                const responseData = { 
                    success: true, 
                    user: {
                        id: effectiveUser.id,
                        fullName: effectiveUser.fullName,
                        email: effectiveUser.email,
                        party: effectiveUser.party,
                        portrait: effectiveUser.portrait,
                        isAdmin: effectiveUser.isAdmin
                    }
                };
                console.log('Sending response:', responseData);
                res.json(responseData);
                console.log('=== LOGIN REQUEST END ===');
            });
        } catch (error) {
            console.error('Error during password comparison:', error);
            res.status(500).json({ message: 'Login failed' });
        }
    });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.post('/api/claim-district', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ message: 'Not authenticated' });
    }

    const { state, district } = req.body;
    if (!state || !district) {
        return res.status(400).json({ message: 'State and district are required' });
    }

    const districtKey = `${state}-${district}`;
    const representativesPath = path.join(__dirname, 'representatives_new.json');

    try {
        // Read current representatives data
        let representativesData = JSON.parse(fs.readFileSync(representativesPath, 'utf8'));

        // Check if district is already claimed
        if (representativesData[districtKey] && representativesData[districtKey] !== "N/A") {
            return res.status(400).json({ message: 'District is already claimed' });
        }

        // Get user info
        db.get('SELECT fullName, party FROM users WHERE id = ?', [req.session.userId], (err, user) => {
            if (err) {
                console.error('Error getting user info:', err);
                return res.status(500).json({ message: 'Failed to claim district' });
            }

            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            // Update representatives data
            representativesData[districtKey] = `${user.fullName} (${user.party.charAt(0)})`;
            fs.writeFileSync(representativesPath, JSON.stringify(representativesData, null, 2));

            res.json({ 
                success: true, 
                message: 'District claimed successfully',
                representative: representativesData[districtKey]
            });
        });
    } catch (error) {
        console.error('Error claiming district:', error);
        res.status(500).json({ message: 'Failed to claim district' });
    }
});

// Admin: Get all districts endpoint
app.get('/api/admin/districts', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ message: 'Not authenticated' });
    }

    // Check if user is admin
    db.get('SELECT id, email, fullName, isAdmin FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        const effectiveUser = withEffectiveAdmin(user);
        if (err || !effectiveUser || !effectiveUser.isAdmin) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        const representativesPath = path.join(__dirname, 'representatives_new.json');
        try {
            const representativesData = JSON.parse(fs.readFileSync(representativesPath, 'utf8'));
            res.json({ districts: representativesData });
        } catch (error) {
            console.error('Error reading representatives data:', error);
            res.status(500).json({ message: 'Error fetching districts' });
        }
    });
});

// Admin: Update district endpoint
app.post('/api/admin/update-district', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ message: 'Not authenticated' });
    }

    // Check if user is admin
    db.get('SELECT id, email, fullName, isAdmin FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        const effectiveUser = withEffectiveAdmin(user);
        if (err || !effectiveUser || !effectiveUser.isAdmin) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        const { districtKey, representative } = req.body;
        if (!districtKey || !representative) {
            return res.status(400).json({ message: 'District key and representative are required' });
        }

        const representativesPath = path.join(__dirname, 'representatives_new.json');
        try {
            let representativesData = JSON.parse(fs.readFileSync(representativesPath, 'utf8'));
            representativesData[districtKey] = representative;
            fs.writeFileSync(representativesPath, JSON.stringify(representativesData, null, 2));
            res.json({ success: true });
        } catch (error) {
            console.error('Error updating district:', error);
            res.status(500).json({ message: 'Error updating district' });
        }
    });
});

// Admin: Get all users endpoint
app.get('/api/admin/users', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ message: 'Not authenticated' });
    }

    // Check if user is admin
    db.get('SELECT id, email, fullName, isAdmin FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        const effectiveUser = withEffectiveAdmin(user);
        if (err || !effectiveUser || !effectiveUser.isAdmin) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        db.all('SELECT id, fullName, email, party, isAdmin, created_at FROM users', [], (err, users) => {
            if (err) {
                return res.status(500).json({ message: 'Error fetching users' });
            }
            res.json({ users });
        });
    });
});

// Admin: Update user endpoint
app.post('/api/admin/update-user', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ message: 'Not authenticated' });
    }

    // Check if user is admin
    db.get('SELECT id, email, fullName, isAdmin FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        const effectiveUser = withEffectiveAdmin(user);
        if (err || !effectiveUser || !effectiveUser.isAdmin) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        const { userId, fullName, party, isAdmin } = req.body;
        if (!userId) {
            return res.status(400).json({ message: 'User ID is required' });
        }

        db.run(
            'UPDATE users SET fullName = ?, party = ?, isAdmin = ? WHERE id = ?',
            [fullName, party, isAdmin ? 1 : 0, userId],
            function(err) {
                if (err) {
                    return res.status(500).json({ message: 'Error updating user' });
                }
                res.json({ success: true });
            }
        );
    });
});

// Add this endpoint after your other API routes
app.post('/api/unclaim-district', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ message: 'Not authenticated' });
    }

    const { state, district } = req.body;
    const districtKey = `${state}-${district}`;

    try {
        // First verify the user owns this district
        const representativesPath = path.join(__dirname, 'representatives_new.json');
        const representativesData = JSON.parse(fs.readFileSync(representativesPath, 'utf8'));

        // Get user info
        db.get('SELECT fullName FROM users WHERE id = ?', [req.session.userId], (err, user) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ message: 'Server error' });
            }

            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            // Check if user owns this district
            const currentRep = representativesData[districtKey];
            if (!currentRep || !currentRep.startsWith(user.fullName)) {
                return res.status(403).json({ message: 'You do not own this district' });
            }

            // Update representatives data
            representativesData[districtKey] = 'N/A';
            fs.writeFileSync(representativesPath, JSON.stringify(representativesData, null, 2));

            // Delete portrait if it exists
            const portraitPath = path.join(__dirname, 'Portraits', `${districtKey}.jpg`);
            if (fs.existsSync(portraitPath)) {
                fs.unlink(portraitPath, (err) => {
                    if (err) console.error('Error deleting portrait:', err);
                });
            }

            res.json({ 
                success: true,
                message: 'District unclaimed successfully'
            });
        });
    } catch (error) {
        console.error('Error in unclaim district:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

async function getDistrictBiography(districtKey) {
    if (firebase.enabled && firebase.firestore) {
        try {
            const districtDoc = await firebase.firestore.collection('districts').doc(districtKey).get();
            if (districtDoc.exists) {
                return districtDoc.data()?.biography || null;
            }
        } catch (error) {
            console.error('Firebase biography lookup failed, falling back to SQLite:', error.message);
        }
    }

    return new Promise((resolve, reject) => {
        const representativesData = readJsonFile(representativesPath, {});
        const representativeEntry = representativesData[districtKey];

        if (!representativeEntry || representativeEntry === 'N/A') {
            resolve(null);
            return;
        }

        const [name] = representativeEntry.split(' (');
        db.get(
            'SELECT biography FROM users WHERE fullName = ?',
            [name],
            (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }

                resolve(row?.biography || null);
            }
        );
    });
}

app.get('/api/backend-status', (req, res) => {
    res.json({
        mode: firebase.enabled ? 'firebase' : 'sqlite',
        firebaseConfigured: firebase.enabled
    });
});

app.get('/api/leadership', (req, res) => {
    res.json({
        leadership: resolveLeadershipEntries(),
        representatives: resolveRepresentativeDirectory().filter(rep => rep.occupied),
        roles: LEADERSHIP_ROLE_ORDER
    });
});

app.post('/api/admin/leadership', (req, res) => {
    requireAdmin(req, res, () => {
        const {
            id,
            role,
            section,
            districtKey,
            office,
            phone,
            email,
            bio,
            sortOrder
        } = req.body;

        const normalizedRole = (role || '').trim();
        if (!normalizedRole || !districtKey) {
            return res.status(400).json({ message: 'Role and district are required' });
        }

        if (!LEADERSHIP_ROLE_RANK.has(normalizedRole.toLowerCase())) {
            return res.status(400).json({ message: 'Invalid leadership role' });
        }

        const leadershipEntries = readJsonFile(leadershipDataPath, []);
        const entryId = id || normalizedRole.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const nextEntry = {
            id: entryId,
            role: normalizedRole,
            section: section || 'Leadership',
            districtKey,
            office: office || '',
            phone: phone || '',
            email: email || '',
            bio: bio || '',
            sortOrder: Number.isFinite(Number(sortOrder))
                ? Number(sortOrder)
                : (LEADERSHIP_ROLE_RANK.get(normalizedRole.toLowerCase()) || leadershipEntries.length * 10 + 10)
        };

        const existingIndex = leadershipEntries.findIndex(entry =>
            entry.id === entryId || (entry.role || '').toLowerCase() === normalizedRole.toLowerCase()
        );
        if (existingIndex >= 0) {
            leadershipEntries[existingIndex] = nextEntry;
        } else {
            leadershipEntries.push(nextEntry);
        }

        writeJsonFile(leadershipDataPath, leadershipEntries);
        res.json({ success: true, leadership: resolveLeadershipEntries() });
    });
});

app.post('/api/admin/leadership/delete', (req, res) => {
    requireAdmin(req, res, () => {
        const { id } = req.body;
        if (!id) {
            return res.status(400).json({ message: 'Leadership role id is required' });
        }

        const leadershipEntries = readJsonFile(leadershipDataPath, []);
        writeJsonFile(
            leadershipDataPath,
            leadershipEntries.filter(entry => entry.id !== id)
        );

        res.json({ success: true, leadership: resolveLeadershipEntries() });
    });
});

app.get('/api/legislation', (req, res) => {
    const index = getLegislationIndex();
    res.json(index);
});

app.post('/api/admin/legislation/rebuild', (req, res) => {
    requireAdmin(req, res, () => {
        const index = buildLegislationIndex();
        res.json({ success: true, ...index });
    });
});

app.get('/api/admin/legislation/import-queue', (req, res) => {
    requireAdmin(req, res, () => {
        res.json({ queue: getImportQueue() });
    });
});

app.get('/api/admin/legislation/contributions', (req, res) => {
    requireAdmin(req, res, () => {
        res.json({ contributions: readJsonFile(legislationContributionsPath, []) });
    });
});

app.post('/api/legislation/submit', (req, res) => {
    requireAuthenticatedUser(req, res, (user) => {
        const {
            title,
            billNumber,
            sponsor,
            sponsorDistrict,
            status,
            committee,
            summary,
            googleDocUrl,
            nextActionType,
            nextActionLabel,
            nextActionDate,
            nextActionLocation,
            queuePdfExport,
            queueTxtExport,
            queueJsonExport
        } = req.body;

        if (!title || !googleDocUrl) {
            return res.status(400).json({ message: 'Title and Google Doc link are required' });
        }

        const contributions = readJsonFile(legislationContributionsPath, []);
        const contribution = {
            id: `contribution-${Date.now()}`,
            title,
            billNumber,
            sponsor,
            sponsorDistrict,
            status: status || 'Introduced',
            committee,
            summary,
            googleDocUrl,
            nextActionType,
            nextActionLabel,
            nextActionDate,
            nextActionLocation,
            queuePdfExport: Boolean(queuePdfExport),
            queueTxtExport: Boolean(queueTxtExport),
            queueJsonExport: Boolean(queueJsonExport),
            submittedBy: {
                id: user.id,
                fullName: user.fullName,
                email: user.email
            },
            submittedAt: new Date().toISOString(),
            reviewStatus: 'pending'
        };

        contributions.push(contribution);
        writeJsonFile(legislationContributionsPath, contributions);
        res.json({ success: true, contribution });
    });
});

app.post('/api/admin/legislation/import-link', (req, res) => {
    requireAdmin(req, res, () => {
        const {
            title,
            billNumber,
            sponsor,
            sponsorDistrict,
            status,
            committee,
            summary,
            googleDocUrl,
            nextActionType,
            nextActionLabel,
            nextActionDate,
            nextActionLocation,
            publishToIndex,
            queuePdfExport,
            queueTxtExport,
            queueJsonExport
        } = req.body;

        if (!title || !googleDocUrl) {
            return res.status(400).json({ message: 'Title and Google Doc link are required' });
        }

        const index = addManualImport({
            title,
            billNumber,
            sponsor,
            sponsorDistrict,
            status,
            committee,
            summary,
            googleDocUrl,
            nextActionType,
            nextActionLabel,
            nextActionDate,
            nextActionLocation,
            publishToIndex,
            queuePdfExport,
            queueTxtExport,
            queueJsonExport
        });

        res.json({ success: true, ...index, queue: getImportQueue() });
    });
});

app.post('/api/admin/legislation/contributions/approve', (req, res) => {
    requireAdmin(req, res, () => {
        const { id } = req.body;
        const contributions = readJsonFile(legislationContributionsPath, []);
        const contribution = contributions.find(entry => entry.id === id);

        if (!contribution) {
            return res.status(404).json({ message: 'Contribution not found' });
        }

        const index = addManualImport({
            ...contribution,
            publishToIndex: true
        });

        const updated = contributions.map(entry => entry.id === id
            ? {
                ...entry,
                reviewStatus: 'approved',
                reviewedAt: new Date().toISOString()
            }
            : entry
        );
        writeJsonFile(legislationContributionsPath, updated);

        res.json({ success: true, ...index, contributions: updated, queue: getImportQueue() });
    });
});

app.post('/api/admin/legislation/contributions/reject', (req, res) => {
    requireAdmin(req, res, () => {
        const { id } = req.body;
        const contributions = readJsonFile(legislationContributionsPath, []);
        const updated = contributions.map(entry => entry.id === id
            ? {
                ...entry,
                reviewStatus: 'rejected',
                reviewedAt: new Date().toISOString()
            }
            : entry
        );
        writeJsonFile(legislationContributionsPath, updated);
        res.json({ success: true, contributions: updated });
    });
});

app.post('/api/admin/generate-key', (req, res) => {
    requireKeyIssuer(req, res, (user) => {
        const keys = readJsonFile(adminKeysPath, []);
        const key = {
            id: `admin-key-${Date.now()}`,
            key: createRandomKey(),
            createdAt: new Date().toISOString(),
            createdBy: {
                id: user.id,
                email: user.email,
                fullName: user.fullName
            },
            usedAt: null,
            usedBy: null
        };

        keys.push(key);
        writeJsonFile(adminKeysPath, keys);
        res.json({ success: true, key });
    });
});

app.post('/api/admin/redeem-key', (req, res) => {
    requireAuthenticatedUser(req, res, (user) => {
        const { key } = req.body;
        const keys = readJsonFile(adminKeysPath, []);
        const matchingKey = keys.find(entry => entry.key === key);

        if (!matchingKey) {
            return res.status(404).json({ message: 'Invalid admin key' });
        }

        if (matchingKey.usedAt) {
            return res.status(400).json({ message: 'This admin key has already been used' });
        }

        db.run('UPDATE users SET isAdmin = 1 WHERE id = ?', [user.id], (err) => {
            if (err) {
                return res.status(500).json({ message: 'Failed to promote account' });
            }

            matchingKey.usedAt = new Date().toISOString();
            matchingKey.usedBy = {
                id: user.id,
                email: user.email,
                fullName: user.fullName
            };
            writeJsonFile(adminKeysPath, keys);

            res.json({ success: true, message: 'Admin access granted' });
        });
    });
});

app.post('/api/admin/legislation', (req, res) => {
    requireAdmin(req, res, () => {
        const {
            id,
            billNumber,
            title,
            status,
            committee,
            sponsor,
            sponsorDistrict,
            summary,
            nextActionType,
            nextActionLabel,
            nextActionDate,
            nextActionLocation,
            updatedAt
        } = req.body;

        if (!billNumber || !title || !status) {
            return res.status(400).json({ message: 'Bill number, title, and status are required' });
        }

        const bills = readJsonFile(legislationDataPath, []);
        const billId = id || billNumber.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const nextBill = {
            id: billId,
            billNumber,
            title,
            status,
            committee: committee || '',
            sponsor: sponsor || '',
            sponsorDistrict: sponsorDistrict || '',
            summary: summary || '',
            nextActionType: nextActionType || '',
            nextActionLabel: nextActionLabel || '',
            nextActionDate: nextActionDate || '',
            nextActionLocation: nextActionLocation || '',
            updatedAt: updatedAt || new Date().toISOString().slice(0, 10)
        };

        const existingIndex = bills.findIndex(bill => bill.id === billId);
        if (existingIndex >= 0) {
            bills[existingIndex] = nextBill;
        } else {
            bills.push(nextBill);
        }

        writeJsonFile(legislationDataPath, bills);
        res.json({ success: true, bills });
    });
});

app.post('/api/admin/legislation/delete', (req, res) => {
    requireAdmin(req, res, () => {
        const { id } = req.body;
        if (!id) {
            return res.status(400).json({ message: 'Bill id is required' });
        }

        const bills = readJsonFile(legislationDataPath, []);
        writeJsonFile(
            legislationDataPath,
            bills.filter(bill => bill.id !== id)
        );

        res.json({ success: true, bills: readJsonFile(legislationDataPath, []) });
    });
});

app.get(['/api/get-district-biography/:districtKey', '/api/biography/:districtKey'], async (req, res) => {
    try {
        const biography = await getDistrictBiography(req.params.districtKey);
        res.json({ biography });
    } catch (error) {
        console.error('Error fetching district biography:', error);
        res.status(500).json({ message: 'Error fetching biography' });
    }
});

// Static file serving - moved after API routes
app.use(express.static(__dirname));
app.use('/Portraits', express.static(path.join(__dirname, 'Portraits'), {
    setHeaders: (res, path) => {
        if (path.endsWith('.svg')) {
            res.set('Content-Type', 'image/svg+xml');
        }
    }
}));

// Ensure Portraits directory exists
const portraitsDir = path.join(__dirname, 'Portraits');
if (!fs.existsSync(portraitsDir)) {
    fs.mkdirSync(portraitsDir);
}

// Copy default profile picture if it doesn't exist
const defaultPfpPath = path.join(portraitsDir, 'default.svg');
if (!fs.existsSync(defaultPfpPath)) {
    fs.copyFileSync(path.join(__dirname, 'Portraits', 'default.svg'), defaultPfpPath);
}

// Add route handler for root path
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
