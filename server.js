const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const path = require('path');
const https = require('https');
const http = require('http');
const session = require('express-session');

// Only import SQLiteStore locally (it requires sqlite3 which doesn't work in Vercel)
let SQLiteStore = null;
if (!process.env.VERCEL) {
    SQLiteStore = require('connect-sqlite3')(session);
}

// Use database adapter (libsql in Vercel, sqlite3 locally)
const db = require('./db-adapter');

const app = express();
const PORT = 3000;

console.log(`[Boot] CWD: ${process.cwd()}`);
console.log(`[Boot] Server file: ${__filename}`);

app.get('/api/health', (req, res) => {
    res.json({ ok: true, cwd: process.cwd(), file: __filename });
});

app.get('/api/debug/routes', (req, res) => {
    const routes = [];
    if (app && app._router && Array.isArray(app._router.stack)) {
        app._router.stack.forEach((layer) => {
            if (layer.route && layer.route.path) {
                const methods = Object.keys(layer.route.methods || {}).map((m) => m.toUpperCase());
                routes.push({ path: layer.route.path, methods });
            }
        });
    }
    res.json({ count: routes.length, routes });
});

// Session configuration
// Use memory store in Vercel (sqlite3 doesn't work), SQLite store locally
const sessionConfig = {
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.VERCEL ? true : false, // HTTPS in Vercel
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
};

if (process.env.VERCEL) {
    // Use memory store in Vercel (sessions will be lost on restart, but works)
    // For production, consider using Vercel KV or external Redis
    sessionConfig.store = new (require('express-session').MemoryStore)();
} else {
    // Use SQLite store locally
    const sessionDir = './';
    sessionConfig.store = new SQLiteStore({ db: 'sessions.db', dir: sessionDir });
}

app.use(session(sessionConfig));

// Middleware
const corsOptions = {
    origin: true,
    credentials: true
};
app.use(cors(corsOptions));
// Handle CORS preflight for all routes (needed for POST/DELETE with JSON)
app.options('*', cors(corsOptions));
app.use(bodyParser.json({ limit: '50mb' })); // Increase limit for screenshot data
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Log API requests to confirm they hit this server
app.use('/api', (req, res, next) => {
    console.log(`[API] ${req.method} ${req.originalUrl}`);
    next();
});

// Authentication middleware
function requireAuth(req, res, next) {
    // Allow access to all API endpoints (they handle their own auth)
    if (req.path.startsWith('/api/')) {
        return next();
    }
    
    if (req.session && req.session.userId) {
        return next();
    }
    // Allow access to login page and API auth endpoints
    if (req.path === '/new-theme/login.html' || req.path === '/login.html' || 
        req.path.startsWith('/api/auth/') || req.path === '/api/auth/login' || 
        req.path === '/api/auth/check-email' || req.path === '/api/auth/set-password') {
        return next();
    }
    // Redirect to login if accessing protected HTML pages
    if ((req.path.startsWith('/new-theme/') || req.path.startsWith('/')) && 
        (req.path.endsWith('.html') || req.path === '/new-theme/' || req.path === '/')) {
        if (!req.path.includes('login.html')) {
            return res.redirect('/new-theme/login.html');
        }
    }
    return next();
}

// Apply auth middleware to HTML pages
app.use((req, res, next) => {
    const isHtmlPage = req.path.endsWith('.html') || req.path === '/new-theme/' || req.path === '/';
    if (isHtmlPage && !req.path.includes('login.html')) {
        return requireAuth(req, res, next);
    }
    next();
});

// Database initialization
// Database is already initialized in db-adapter.js
// Initialize tables
setTimeout(() => {
    initializeDatabase();
}, 100); // Small delay to ensure db is ready

// Initialize database tables
function initializeDatabase() {
    db.serialize(() => {
        // Applications table
        db.run(`CREATE TABLE IF NOT EXISTS applications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            app_id TEXT NOT NULL UNIQUE,
            description TEXT,
            version TEXT DEFAULT '1.0.0',
            webhook_url TEXT,
            hwid_lock_enabled INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        
        // Add new columns if they don't exist
        db.all("PRAGMA table_info(applications)", (err, columns) => {
            if (err) {
                console.error('Error checking table info:', err.message);
                return;
            }
            
            const columnNames = columns.map(col => col.name);
            
            if (!columnNames.includes('description')) {
                db.run('ALTER TABLE applications ADD COLUMN description TEXT', (err) => {
                    if (err && !err.message.includes('duplicate column')) {
                        console.log('Error adding description column:', err.message);
                    }
                });
            }
            if (!columnNames.includes('version')) {
                db.run('ALTER TABLE applications ADD COLUMN version TEXT DEFAULT \'1.0.0\'', (err) => {
                    if (err && !err.message.includes('duplicate column')) {
                        console.log('Error adding version column:', err.message);
                    }
                });
            }
            if (!columnNames.includes('webhook_url')) {
                db.run('ALTER TABLE applications ADD COLUMN webhook_url TEXT', (err) => {
                    if (err && !err.message.includes('duplicate column')) {
                        console.log('Error adding webhook_url column:', err.message);
                    }
                });
            }
            if (!columnNames.includes('hwid_lock_enabled')) {
                db.run('ALTER TABLE applications ADD COLUMN hwid_lock_enabled INTEGER DEFAULT 1', (err) => {
                    if (err && !err.message.includes('duplicate column')) {
                        console.log('Error adding hwid_lock_enabled column:', err.message);
                    }
                });
            }
            if (!columnNames.includes('status')) {
                db.run('ALTER TABLE applications ADD COLUMN status TEXT DEFAULT \'Active\'', (err) => {
                    if (err && !err.message.includes('duplicate column')) {
                        console.log('Error adding status column:', err.message);
                    }
                });
            }
            if (!columnNames.includes('created_by')) {
                db.run('ALTER TABLE applications ADD COLUMN created_by INTEGER', (err) => {
                    if (err && !err.message.includes('duplicate column')) {
                        console.log('Error adding created_by column:', err.message);
                    }
                });
            }
        });

        // Licenses table
        db.run(`CREATE TABLE IF NOT EXISTS licenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            app_id TEXT NOT NULL,
            license_key TEXT NOT NULL UNIQUE,
            duration_value INTEGER,
            duration_unit TEXT,
            is_unlimited INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME,
            is_active INTEGER DEFAULT 1,
            locked_hwid TEXT,
            is_banned INTEGER DEFAULT 0,
            is_paused INTEGER DEFAULT 0,
            paused_at DATETIME,
            paused_expires_at DATETIME,
            FOREIGN KEY (app_id) REFERENCES applications(app_id)
        )`);
        
        // Migrate existing licenses - add new columns if they don't exist
        db.all("PRAGMA table_info(licenses)", (err, columns) => {
            if (err) {
                console.error('Error checking table info:', err.message);
                return;
            }
            
            const columnNames = columns.map(col => col.name);
            const columnsToAdd = [];
            
            // Check which columns need to be added
            if (!columnNames.includes('locked_hwid')) {
                columnsToAdd.push({ name: 'locked_hwid', sql: 'ALTER TABLE licenses ADD COLUMN locked_hwid TEXT' });
            }
            if (!columnNames.includes('is_banned')) {
                columnsToAdd.push({ name: 'is_banned', sql: 'ALTER TABLE licenses ADD COLUMN is_banned INTEGER DEFAULT 0' });
            }
            if (!columnNames.includes('duration_value')) {
                columnsToAdd.push({ name: 'duration_value', sql: 'ALTER TABLE licenses ADD COLUMN duration_value INTEGER' });
            }
            if (!columnNames.includes('duration_unit')) {
                columnsToAdd.push({ name: 'duration_unit', sql: 'ALTER TABLE licenses ADD COLUMN duration_unit TEXT' });
            }
            if (!columnNames.includes('is_unlimited')) {
                columnsToAdd.push({ name: 'is_unlimited', sql: 'ALTER TABLE licenses ADD COLUMN is_unlimited INTEGER DEFAULT 0' });
            }
            if (!columnNames.includes('created_by')) {
                columnsToAdd.push({ name: 'created_by', sql: 'ALTER TABLE licenses ADD COLUMN created_by INTEGER' });
            }
            if (!columnNames.includes('is_paused')) {
                columnsToAdd.push({ name: 'is_paused', sql: 'ALTER TABLE licenses ADD COLUMN is_paused INTEGER DEFAULT 0' });
            }
            if (!columnNames.includes('paused_at')) {
                columnsToAdd.push({ name: 'paused_at', sql: 'ALTER TABLE licenses ADD COLUMN paused_at DATETIME' });
            }
            if (!columnNames.includes('paused_expires_at')) {
                columnsToAdd.push({ name: 'paused_expires_at', sql: 'ALTER TABLE licenses ADD COLUMN paused_expires_at DATETIME' });
            }
            
            // Add columns sequentially
            let addColumnIndex = 0;
            const addNextColumn = () => {
                if (addColumnIndex >= columnsToAdd.length) {
                    // All columns added, now migrate data if needed
                    migrateDurationData();
                    return;
                }
                
                const column = columnsToAdd[addColumnIndex];
                db.run(column.sql, (err) => {
                    if (err && !err.message.includes('duplicate column')) {
                        console.log(`Error adding column ${column.name}:`, err.message);
                    }
                    addColumnIndex++;
                    addNextColumn();
                });
            };
            
            // Migrate old duration_days to new format and make it nullable
            const migrateDurationData = () => {
                if (columnNames.includes('duration_days')) {
                    db.all("PRAGMA table_info(licenses)", (err2, columns2) => {
                        if (!err2) {
                            const newColumnNames = columns2.map(col => col.name);
                            if (newColumnNames.includes('duration_value') && newColumnNames.includes('duration_unit')) {
                                // Migrate data first
                                db.run(`UPDATE licenses SET duration_value = duration_days, duration_unit = 'days' WHERE duration_value IS NULL AND duration_days IS NOT NULL`, (err3) => {
                                    if (err3) {
                                        console.log('Migration error:', err3.message);
                                    } else {
                                        console.log('Migration completed: duration_days migrated to duration_value');
                                        // Note: SQLite doesn't support ALTER COLUMN to change NOT NULL constraint
                                        // We'll handle this by including duration_days in INSERT if it exists
                                    }
                                });
                            }
                        }
                    });
                }
            };
            
            // Start adding columns
            addNextColumn();
        });

        // License usage tracking
        db.run(`CREATE TABLE IF NOT EXISTS license_usage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            license_key TEXT NOT NULL,
            hwid TEXT,
            last_check DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (license_key) REFERENCES licenses(license_key)
        )`);
        
        // License format configuration
        db.run(`CREATE TABLE IF NOT EXISTS license_format_config (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            format TEXT NOT NULL DEFAULT '**********',
            options TEXT NOT NULL DEFAULT '{"bigLetters":true,"digits":true,"specialChars":false}',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        
        // Initialize default format if not exists
        db.run(`INSERT OR IGNORE INTO license_format_config (id, format, options) VALUES (1, '**********', '{"bigLetters":false,"digits":true,"specialChars":false}')`);
        
        // Custom messages table (per-user, global for all applications)
        db.run(`CREATE TABLE IF NOT EXISTS custom_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            app_id TEXT NOT NULL,
            message_key TEXT NOT NULL,
            message_value TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, app_id, message_key)
        )`);
        
        // Custom messages table (per-user, global for all applications)
        db.run(`CREATE TABLE IF NOT EXISTS custom_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            app_id TEXT NOT NULL,
            message_key TEXT NOT NULL,
            message_value TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, app_id, message_key)
        )`);
        
        // Protection settings table (per-user, global for all applications)
        db.run(`CREATE TABLE IF NOT EXISTS protection_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            app_id TEXT NOT NULL,
            setting_key TEXT NOT NULL,
            setting_value INTEGER DEFAULT 1,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, app_id, setting_key)
        )`);
        
        // Users table
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT,
            status TEXT DEFAULT 'Pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Add new user profile columns if they don't exist
        db.all("PRAGMA table_info(users)", (err, columns) => {
            if (err) {
                console.error('Error checking users table info:', err.message);
                return;
            }

            const columnNames = columns.map(col => col.name);

            if (!columnNames.includes('display_name')) {
                db.run('ALTER TABLE users ADD COLUMN display_name TEXT', (err) => {
                    if (err && !err.message.includes('duplicate column')) {
                        console.log('Error adding display_name column:', err.message);
                    }
                });
            }
            if (!columnNames.includes('avatar_url')) {
                db.run('ALTER TABLE users ADD COLUMN avatar_url TEXT', (err) => {
                    if (err && !err.message.includes('duplicate column')) {
                        console.log('Error adding avatar_url column:', err.message);
                    }
                });
            }
            if (!columnNames.includes('announcements_opt_in')) {
                db.run('ALTER TABLE users ADD COLUMN announcements_opt_in INTEGER DEFAULT 0', (err) => {
                    if (err && !err.message.includes('duplicate column')) {
                        console.log('Error adding announcements_opt_in column:', err.message);
                    }
                });
            }
            if (!columnNames.includes('announcements_webhook_url')) {
                db.run('ALTER TABLE users ADD COLUMN announcements_webhook_url TEXT', (err) => {
                    if (err && !err.message.includes('duplicate column')) {
                        console.log('Error adding announcements_webhook_url column:', err.message);
                    }
                });
            }
            if (!columnNames.includes('banned_until')) {
                db.run('ALTER TABLE users ADD COLUMN banned_until TEXT', (err) => {
                    if (err && !err.message.includes('duplicate column')) {
                        console.log('Error adding banned_until column:', err.message);
                    }
                });
            }
            if (!columnNames.includes('ban_reason')) {
                db.run('ALTER TABLE users ADD COLUMN ban_reason TEXT', (err) => {
                    if (err && !err.message.includes('duplicate column')) {
                        console.log('Error adding ban_reason column:', err.message);
                    }
                });
            }
            if (!columnNames.includes('warn_message')) {
                db.run('ALTER TABLE users ADD COLUMN warn_message TEXT', (err) => {
                    if (err && !err.message.includes('duplicate column')) {
                        console.log('Error adding warn_message column:', err.message);
                    }
                });
            }
            if (!columnNames.includes('warn_confirmed')) {
                db.run('ALTER TABLE users ADD COLUMN warn_confirmed INTEGER DEFAULT 0', (err) => {
                    if (err && !err.message.includes('duplicate column')) {
                        console.log('Error adding warn_confirmed column:', err.message);
                    }
                });
            }
        });
        
        // User permissions table
        db.run(`CREATE TABLE IF NOT EXISTS user_permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            permission_key TEXT NOT NULL,
            permission_value TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(user_id, permission_key)
        )`);

        // User application access table
        db.run(`CREATE TABLE IF NOT EXISTS user_app_access (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            app_id TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(user_id, app_id)
        )`);
        
        // Create admin_logs table for activity logging
        db.run(`CREATE TABLE IF NOT EXISTS admin_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            user_email TEXT,
            action_type TEXT NOT NULL,
            action_details TEXT,
            license_key TEXT,
            app_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        )`);
        
        // Create default admin user if doesn't exist
        db.get('SELECT id FROM users WHERE email = ?', ['admin@admin.com'], (err, row) => {
            if (err) {
                console.error('Error checking admin user:', err.message);
            } else if (!row) {
                const defaultPassword = crypto.createHash('sha256').update('admin123').digest('hex');
                db.run('INSERT INTO users (email, password_hash, status) VALUES (?, ?, ?)', 
                    ['admin@admin.com', defaultPassword, 'Active'], (err) => {
                    if (err) {
                        console.error('Error creating admin user:', err.message);
                    } else {
                        console.log('Default admin user created: admin@admin.com / admin123');
                    }
                });
            }
        });
        
        // Migrate existing protection_settings table if it doesn't have app_id column
        db.all("PRAGMA table_info(protection_settings)", (err, columns) => {
            if (err) {
                console.error('Error checking protection_settings table info:', err.message);
                return;
            }
            
            const columnNames = columns.map(col => col.name);
            
            // If app_id column doesn't exist, we need to recreate the table
            if (!columnNames.includes('app_id')) {
                console.log('Migrating protection_settings table to add app_id column...');
                
                // Create new table with app_id
                db.run(`CREATE TABLE IF NOT EXISTS protection_settings_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    app_id TEXT NOT NULL DEFAULT 'global',
                    setting_key TEXT NOT NULL,
                    setting_value INTEGER DEFAULT 1,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(app_id, setting_key)
                )`, (err) => {
                    if (err) {
                        console.error('Error creating new protection_settings table:', err.message);
                        return;
                    }
                    
                    // Copy existing data with 'global' app_id
                    db.run(`INSERT INTO protection_settings_new (app_id, setting_key, setting_value, updated_at)
                        SELECT 'global', setting_key, setting_value, updated_at FROM protection_settings`, (err) => {
                        if (err) {
                            console.error('Error migrating protection_settings data:', err.message);
                            return;
                        }
                        
                        // Drop old table
                        db.run('DROP TABLE protection_settings', (err) => {
                            if (err) {
                                console.error('Error dropping old protection_settings table:', err.message);
                                return;
                            }
                            
                            // Rename new table
                            db.run('ALTER TABLE protection_settings_new RENAME TO protection_settings', (err) => {
                                if (err) {
                                    console.error('Error renaming protection_settings table:', err.message);
                                    return;
                                }
                                
                                console.log('Successfully migrated protection_settings table');
                                initializeDefaultProtectionSettings();
                            });
                        });
                    });
                });
            } else {
                // Table already has app_id, just initialize defaults
                initializeDefaultProtectionSettings();
            }
            if (!columnNames.includes('user_id')) {
                console.log('Migrating protection_settings table to add user_id column...');
                db.run(`CREATE TABLE IF NOT EXISTS protection_settings_new_user (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    app_id TEXT NOT NULL,
                    setting_key TEXT NOT NULL,
                    setting_value INTEGER DEFAULT 1,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_id, app_id, setting_key)
                )`, (err) => {
                    if (err) {
                        console.error('Error creating new protection_settings table:', err.message);
                        return;
                    }
                    db.run(`INSERT INTO protection_settings_new_user (user_id, app_id, setting_key, setting_value, updated_at)
                        SELECT NULL, app_id, setting_key, setting_value, updated_at FROM protection_settings`, (err) => {
                        if (err) {
                            console.error('Error migrating protection_settings data:', err.message);
                            return;
                        }
                        db.run('DROP TABLE protection_settings', (err) => {
                            if (err) {
                                console.error('Error dropping old protection_settings table:', err.message);
                                return;
                            }
                            db.run('ALTER TABLE protection_settings_new_user RENAME TO protection_settings', (err) => {
                                if (err) {
                                    console.error('Error renaming protection_settings table:', err.message);
                                    return;
                                }
                                console.log('Successfully migrated protection_settings table with user_id');
                            });
                        });
                    });
                });
            }
        });

        db.all("PRAGMA table_info(custom_messages)", (err, columns) => {
            if (err) {
                console.error('Error checking custom_messages table info:', err.message);
                return;
            }
            const columnNames = columns.map(col => col.name);
            if (!columnNames.includes('user_id')) {
                console.log('Migrating custom_messages table to add user_id column...');
                db.run(`CREATE TABLE IF NOT EXISTS custom_messages_new_user (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    app_id TEXT NOT NULL,
                    message_key TEXT NOT NULL,
                    message_value TEXT NOT NULL,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_id, app_id, message_key)
                )`, (err) => {
                    if (err) {
                        console.error('Error creating new custom_messages table:', err.message);
                        return;
                    }
                    db.run(`INSERT INTO custom_messages_new_user (user_id, app_id, message_key, message_value, updated_at)
                        SELECT NULL, app_id, message_key, message_value, updated_at FROM custom_messages`, (err) => {
                        if (err) {
                            console.error('Error migrating custom_messages data:', err.message);
                            return;
                        }
                        db.run('DROP TABLE custom_messages', (err) => {
                            if (err) {
                                console.error('Error dropping old custom_messages table:', err.message);
                                return;
                            }
                            db.run('ALTER TABLE custom_messages_new_user RENAME TO custom_messages', (err) => {
                                if (err) {
                                    console.error('Error renaming custom_messages table:', err.message);
                                    return;
                                }
                                console.log('Successfully migrated custom_messages table with user_id');
                            });
                        });
                    });
                });
            }
        });
        
        function initializeDefaultProtectionSettings() {
            // Initialize default global settings if they don't exist
            db.run(`INSERT OR IGNORE INTO protection_settings (user_id, app_id, setting_key, setting_value) VALUES 
                (NULL, 'global', 'application', 1),
                (NULL, 'global', 'status', 1),
                (NULL, 'global', 'pc_name', 1),
                (NULL, 'global', 'hwid', 1),
                (NULL, 'global', 'ipv4', 1),
                (NULL, 'global', 'expiration_date', 1),
                (NULL, 'global', 'last_login', 1),
                (NULL, 'global', 'reason', 1),
                (NULL, 'global', 'screenshot', 1)
            `);
        }
    });
}

// Generate unique license key based on configured format
function generateLicenseKey(callback) {
    // Get license format configuration
    db.get('SELECT format, options FROM license_format_config WHERE id = 1', (err, config) => {
        if (err) {
            console.error('Error loading license format config:', err);
            // Fallback to default format
            return callback(generateDefaultLicenseKey());
        }
        
        const format = config?.format || '**********';
        let options = { bigLetters: false, digits: true, specialChars: false };
        
        try {
            if (config?.options) {
                options = JSON.parse(config.options);
            }
        } catch (parseErr) {
            console.error('Error parsing license format options:', parseErr);
        }
        
        // Build character set - always start with base set (lowercase letters)
        // Checkboxes ADD additional character types (include, not only)
        let chars = 'abcdefghijklmnopqrstuvwxyz'; // Base set - always included
        
        // Add uppercase letters if option is enabled
        if (options.bigLetters === true) {
            chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        }
        
        // Add digits if option is enabled
        if (options.digits === true) {
            chars += '0123456789';
        }
        
        // Add special characters if option is enabled
        if (options.specialChars === true) {
            chars += '!@#$%^&*';
        }
        
        // If no characters selected (shouldn't happen, but safety check), use default
        if (!chars) {
            chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        }
        
        // Generate license key based on format
        let licenseKey = '';
        const randomBytes = crypto.randomBytes(format.length);
        
        for (let i = 0; i < format.length; i++) {
            if (format[i] === '*') {
                // Generate random character
                const randomIndex = randomBytes[i] % chars.length;
                licenseKey += chars[randomIndex];
            } else {
                // Use literal character from format (e.g., prefix like "VARP-")
                licenseKey += format[i];
            }
        }
        
        callback(licenseKey);
    });
}

// Fallback function for default license key generation
function generateDefaultLicenseKey() {
    const length = 9;
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let licenseKey = '';
    const randomBytes = crypto.randomBytes(length);
    
    for (let i = 0; i < length; i++) {
        const randomIndex = randomBytes[i] % chars.length;
        licenseKey += chars[randomIndex];
    }
    
    return licenseKey;
}

// API Routes

// ==================== AUTHENTICATION API ====================
// (Must be defined first to ensure they are registered)

// Check if email is approved
app.post('/api/auth/check-email', (req, res) => {
    const { email } = req.body;
    
    if (!email) {
        return res.json({ approved: false, error: 'Email is required' });
    }
    
    db.get('SELECT id, status FROM users WHERE email = ?', [email], (err, user) => {
        if (err) {
            return res.status(500).json({ approved: false, error: 'Database error' });
        }
        
        if (!user) {
            return res.json({ approved: false, error: 'Email not found. Please contact administrator.' });
        }
        
        if (user.status === 'Pending') {
            return res.json({ approved: true, pending: true, message: 'Email found. Please set your password.' });
        }
        
        if (user.status === 'Active') {
            return res.json({ approved: true, pending: false, message: 'Email found. Please enter your password.' });
        }
        
        return res.json({ approved: false, error: 'Account is not active.' });
    });
});

// Login
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ success: false, error: 'Email and password are required' });
    }
    
    db.get('SELECT id, email, password_hash, status FROM users WHERE email = ?', [email], (err, user) => {
        if (err) {
            return res.status(500).json({ success: false, error: 'Database error' });
        }
        
        if (!user) {
            return res.status(401).json({ success: false, error: 'Invalid email or password' });
        }
        
        if (user.status !== 'Active') {
            return res.status(401).json({ success: false, error: 'Account is not active. Please contact administrator.' });
        }
        
        const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
        
        if (user.password_hash !== passwordHash) {
            return res.status(401).json({ success: false, error: 'Invalid email or password' });
        }
        
        // Set session
        req.session.userId = user.id;
        req.session.email = user.email;
        
        return res.json({ success: true, message: 'Login successful' });
    });
});

// Set password (for pending users)
app.post('/api/auth/set-password', (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ success: false, error: 'Email and password are required' });
    }
    
    if (password.length < 6) {
        return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    }
    
    db.get('SELECT id, status FROM users WHERE email = ?', [email], (err, user) => {
        if (err) {
            return res.status(500).json({ success: false, error: 'Database error' });
        }
        
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        
        if (user.status !== 'Pending') {
            return res.status(400).json({ success: false, error: 'Password already set' });
        }
        
        const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
        
        db.run('UPDATE users SET password_hash = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', 
            [passwordHash, 'Active', user.id], (updateErr) => {
            if (updateErr) {
                return res.status(500).json({ success: false, error: 'Failed to set password' });
            }
            
            // Set session
            req.session.userId = user.id;
            req.session.email = user.email;
            
            return res.json({ success: true, message: 'Password set successfully' });
        });
    });
});

// Check if user is logged in
app.get('/api/auth/me', (req, res) => {
    if (req.session && req.session.userId) {
        db.get('SELECT id, email, status, display_name, avatar_url, announcements_opt_in, banned_until, ban_reason, warn_message, warn_confirmed FROM users WHERE id = ?', [req.session.userId], (err, user) => {
            if (err || !user) {
                return res.json({ loggedIn: false });
            }
            const now = new Date();
            if (user.status === 'Banned' && user.banned_until) {
                const bannedUntilDate = new Date(user.banned_until);
                if (!isNaN(bannedUntilDate) && bannedUntilDate <= now) {
                    db.run('UPDATE users SET status = ?, banned_until = NULL, ban_reason = NULL WHERE id = ?', ['Active', user.id]);
                    user.status = 'Active';
                    user.banned_until = null;
                    user.ban_reason = null;
                }
            }
            return res.json({
                loggedIn: true,
                user: {
                    id: user.id,
                    email: user.email,
                    status: user.status,
                    display_name: user.display_name || '',
                    avatar_url: user.avatar_url || '',
                    announcements_opt_in: !!user.announcements_opt_in,
                    banned_until: user.banned_until || null,
                    ban_reason: user.ban_reason || '',
                    warn_message: user.warn_message || null,
                    warn_confirmed: !!user.warn_confirmed
                }
            });
        });
    } else {
        return res.json({ loggedIn: false });
    }
});

// Get user permissions
app.get('/api/auth/permissions', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    getUserPermissions(req.session.userId, (err, permissions) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        return res.json({ permissions: permissions || {} });
    });
});

// Helper function to get custom message (callback-based, per-user with fallback)
function getCustomMessageForUser(userId, key, defaultMessage, callback) {
    db.get('SELECT message_value FROM custom_messages WHERE app_id = ? AND message_key = ? AND user_id = ?', ['global', key, userId], (err, row) => {
        if (err || !row || !row.message_value) {
            db.get('SELECT message_value FROM custom_messages WHERE app_id = ? AND message_key = ? AND user_id IS NULL', ['global', key], (fallbackErr, fallbackRow) => {
                if (fallbackErr || !fallbackRow || !fallbackRow.message_value) {
                    callback(defaultMessage);
                } else {
                    callback(fallbackRow.message_value);
                }
            });
        } else {
            callback(row.message_value);
        }
    });
}

// ==================== LICENSE CHECK API (for C++ applications) ====================
// This endpoint must be early to avoid routing conflicts
app.post('/api/licenses/check', (req, res) => {
    const { app_id, license_key, hwid, app_version, pc_name, ipv4, login_date, screenshot } = req.body;
    let ownerUserId = null;

    if (!app_id || !license_key) {
        return res.status(400).json({ 
            success: false,
            reason: 'app_id and license_key are required' 
        });
    }

    // Check license and application
    // First, get the current HWID Lock status directly from applications table to ensure we have the latest value
    db.get(
        `SELECT l.*, l.created_by as license_owner_id, a.name as app_name, a.version as app_version, a.hwid_lock_enabled, a.webhook_url, a.created_by as app_owner_id 
         FROM licenses l 
         JOIN applications a ON l.app_id = a.app_id 
         WHERE l.license_key = ? AND l.app_id = ? AND l.is_active = 1`,
        [license_key, app_id],
        (err, license) => {
            if (err) {
                getCustomMessageForUser(null, 'database-error', 'Database error', (dbErrorMsg) => {
                    return res.status(500).json({ 
                        success: false,
                        reason: dbErrorMsg
                    });
                });
                return;
            }

            if (!license) {
                // Try to get webhook URL and app name for failed auth logging
                db.get('SELECT name, version, webhook_url, created_by FROM applications WHERE app_id = ?', [app_id], (err, app) => {
                    ownerUserId = app?.created_by || null;
                    getCustomMessageForUser(ownerUserId, 'invalid-license', 'Invalid license key or application ID', (invalidMsg) => {
                        if (!err && app && app.webhook_url && app.webhook_url.trim()) {
                            const webhookData = {
                                success: false,
                                app_name: app.name || 'Unknown',
                                app_version: app.version || app_version || 'N/A',
                                license_key: license_key,
                                hwid: hwid || 'N/A',
                                pc_name: pc_name || 'N/A',
                                ipv4: ipv4 || 'N/A',
                                login_date: login_date || new Date().toISOString(),
                                screenshot: screenshot || '',
                                reason: invalidMsg
                            };
                            setImmediate(() => sendDiscordWebhook(app.webhook_url, webhookData, ownerUserId));
                        }
                        
                        return res.json({ 
                            success: false,
                            reason: invalidMsg
                        });
                    });
                });
                return;
            }

            ownerUserId = license.license_owner_id || license.app_owner_id || null;

            // Check application version if provided
            if (app_version && license.app_version && license.app_version !== app_version) {
                getCustomMessageForUser(ownerUserId, 'version-mismatch', `Version mismatch. Application version ${app_version} does not match required version ${license.app_version}. Please update your application.`, (versionMsg) => {
                    const formattedVersionMsg = versionMsg.replace('{current}', app_version).replace('{required}', license.app_version);
                    
                    if (license.webhook_url && license.webhook_url.trim()) {
                        const webhookData = {
                            success: false,
                            app_name: license.app_name,
                            app_version: app_version,
                            license_key: license_key,
                            hwid: hwid || 'N/A',
                            pc_name: pc_name || 'N/A',
                            ipv4: ipv4 || 'N/A',
                            login_date: login_date || new Date().toISOString(),
                            screenshot: screenshot || '',
                            reason: formattedVersionMsg
                        };
                        setImmediate(() => sendDiscordWebhook(license.webhook_url, webhookData, ownerUserId));
                    }
                    
                    return res.json({ 
                        success: false,
                        reason: formattedVersionMsg,
                        version_error: true,
                        required_version: license.app_version,
                        current_version: app_version
                    });
                });
                return;
            }

            // Check if banned
            if (license.is_banned === 1) {
                getCustomMessageForUser(ownerUserId, 'license-banned', 'License has been banned', (bannedMsg) => {
                    if (license.webhook_url && license.webhook_url.trim()) {
                        const webhookData = {
                            success: false,
                            app_name: license.app_name,
                            app_version: license.app_version || app_version,
                            license_key: license_key,
                            hwid: hwid || 'N/A',
                            pc_name: pc_name || 'N/A',
                            ipv4: ipv4 || 'N/A',
                            login_date: login_date || new Date().toISOString(),
                            screenshot: screenshot || '',
                            reason: bannedMsg
                        };
                        setImmediate(() => sendDiscordWebhook(license.webhook_url, webhookData, ownerUserId));
                    }
                    
                    return res.json({ 
                        success: false,
                        reason: bannedMsg
                    });
                });
                return;
            }
            
            // Check if license is paused
            if (license.is_paused === 1) {
                getCustomMessageForUser(ownerUserId, 'license-paused', 'License is paused', (pausedMsg) => {
                    if (license.webhook_url && license.webhook_url.trim()) {
                        const webhookData = {
                            success: false,
                            app_name: license.app_name,
                            app_version: license.app_version || app_version,
                            license_key: license_key,
                            hwid: hwid || 'N/A',
                            pc_name: pc_name || 'N/A',
                            ipv4: ipv4 || 'N/A',
                            login_date: login_date || new Date().toISOString(),
                            screenshot: screenshot || '',
                            reason: pausedMsg
                        };
                        setImmediate(() => sendDiscordWebhook(license.webhook_url, webhookData, ownerUserId));
                    }
                    
                    return res.json({ 
                        success: false,
                        reason: pausedMsg
                    });
                });
                return;
            }

            // Check if inactive
            if (license.is_active === 0) {
                getCustomMessageForUser(ownerUserId, 'license-inactive', 'License is inactive', (inactiveMsg) => {
                    if (license.webhook_url && license.webhook_url.trim()) {
                        const webhookData = {
                            success: false,
                            app_name: license.app_name,
                            app_version: license.app_version || app_version,
                            license_key: license_key,
                            hwid: hwid || 'N/A',
                            pc_name: pc_name || 'N/A',
                            ipv4: ipv4 || 'N/A',
                            login_date: login_date || new Date().toISOString(),
                            screenshot: screenshot || '',
                            reason: inactiveMsg
                        };
                        setImmediate(() => sendDiscordWebhook(license.webhook_url, webhookData, ownerUserId));
                    }
                    
                    return res.json({ 
                        success: false,
                        reason: inactiveMsg
                    });
                });
                return;
            }

            // Check if HWID Lock is enabled for this application
            let hwidLockEnabled = false;
            const hwidLockValue = license.hwid_lock_enabled;
            
            if (hwidLockValue !== null && hwidLockValue !== undefined) {
                const valueStr = String(hwidLockValue).trim();
                hwidLockEnabled = (valueStr === '1' || hwidLockValue === 1 || hwidLockValue === true);
            }
            
            console.log(`[License Check] License: ${license_key}, App: ${app_id}, HWID Lock Enabled: ${hwidLockEnabled}`);

            const now = new Date();
            let expiresAt = null;
            let isActivated = false;
            
            if (!license.is_unlimited && !license.expires_at && license.duration_value && license.duration_unit) {
                if (hwidLockEnabled) {
                    if (!hwid || hwid.trim() === '') {
                        getCustomMessageForUser(ownerUserId, 'hwid-required', 'HWID is required to activate license. Time starts counting from activation moment.', (hwidRequiredMsg) => {
                            if (license.webhook_url && license.webhook_url.trim()) {
                                const webhookData = {
                                    success: false,
                                    app_name: license.app_name,
                                    app_version: license.app_version || app_version,
                                    license_key: license_key,
                                    hwid: 'N/A',
                                    pc_name: pc_name || 'N/A',
                                    ipv4: ipv4 || 'N/A',
                                    login_date: login_date || new Date().toISOString(),
                                    screenshot: screenshot || '',
                                    reason: hwidRequiredMsg
                                };
                                setImmediate(() => sendDiscordWebhook(license.webhook_url, webhookData, ownerUserId));
                            }
                            
                            return res.json({ 
                                success: false,
                                reason: hwidRequiredMsg
                            });
                        });
                        return;
                    }
                }
                
                expiresAt = calculateExpirationDate(license.duration_value, license.duration_unit, false);
                isActivated = true;
                
                if (hwidLockEnabled && hwid) {
                    console.log(`[License Activation] Setting locked_hwid for license ${license_key} because HWID Lock is enabled`);
                    db.run(
                        'UPDATE licenses SET expires_at = ?, locked_hwid = ? WHERE license_key = ?',
                        [expiresAt.toISOString(), hwid, license_key]
                    );
                } else {
                    console.log(`[License Activation] NOT setting locked_hwid for license ${license_key} - HWID Lock disabled`);
                    db.run(
                        'UPDATE licenses SET expires_at = ?, locked_hwid = NULL WHERE license_key = ?',
                        [expiresAt.toISOString(), license_key]
                    );
                }
            } else if (license.expires_at) {
                if (hwidLockEnabled) {
                    if (!license.locked_hwid) {
                        if (hwid) {
                            db.run(
                                'UPDATE licenses SET locked_hwid = ? WHERE license_key = ?',
                                [hwid, license_key]
                            );
                        }
                    } else if (license.locked_hwid !== hwid) {
                        getCustomMessageForUser(ownerUserId, 'hwid-mismatch', 'License is locked to different hardware', (hwidMismatchMsg) => {
                            if (license.webhook_url && license.webhook_url.trim()) {
                                const webhookData = {
                                    success: false,
                                    app_name: license.app_name,
                                    app_version: license.app_version || app_version,
                                    license_key: license_key,
                                    hwid: hwid || 'N/A',
                                    pc_name: pc_name || 'N/A',
                                    ipv4: ipv4 || 'N/A',
                                    login_date: login_date || new Date().toISOString(),
                                    screenshot: screenshot || '',
                                    reason: hwidMismatchMsg
                                };
                                setImmediate(() => sendDiscordWebhook(license.webhook_url, webhookData, ownerUserId));
                            }
                            
                            return res.json({ 
                                success: false,
                                reason: hwidMismatchMsg
                            });
                        });
                        return;
                    }
                } else {
                    if (license.locked_hwid) {
                        db.run(
                            'UPDATE licenses SET locked_hwid = NULL WHERE license_key = ?',
                            [license_key]
                        );
                    }
                }
                
                expiresAt = new Date(license.expires_at);
                isActivated = true;
                
                if (now > expiresAt) {
                    getCustomMessageForUser(ownerUserId, 'license-expired', 'License has expired', (expiredMsg) => {
                        if (license.webhook_url && license.webhook_url.trim()) {
                            const webhookData = {
                                success: false,
                                app_name: license.app_name,
                                app_version: license.app_version || app_version,
                                license_key: license_key,
                                hwid: hwid || 'N/A',
                                pc_name: pc_name || 'N/A',
                                ipv4: ipv4 || 'N/A',
                                login_date: login_date || new Date().toISOString(),
                                expires_at: expiresAt ? expiresAt.toISOString() : null,
                                screenshot: screenshot || '',
                                reason: expiredMsg
                            };
                            setImmediate(() => sendDiscordWebhook(license.webhook_url, webhookData, ownerUserId));
                        }
                        
                        return res.json({ 
                            success: false,
                            reason: expiredMsg 
                        });
                    });
                    return;
                }
            } else if (license.is_unlimited) {
                if (hwidLockEnabled) {
                    if (!license.locked_hwid && hwid) {
                        db.run(
                            'UPDATE licenses SET locked_hwid = ? WHERE license_key = ?',
                            [hwid, license_key]
                        );
                    }
                } else {
                    if (license.locked_hwid) {
                        db.run(
                            'UPDATE licenses SET locked_hwid = NULL WHERE license_key = ?',
                            [license_key]
                        );
                    }
                }
                isActivated = true;
            } else {
                return res.json({ 
                    success: false,
                    reason: 'License configuration error' 
                });
            }

            // Update license usage
            if (hwid) {
                db.run(
                    `INSERT OR REPLACE INTO license_usage (license_key, hwid, last_check) 
                     VALUES (?, ?, CURRENT_TIMESTAMP)`,
                    [license_key, hwid]
                );
            } else {
                db.run(
                    `INSERT OR REPLACE INTO license_usage (license_key, last_check) 
                     VALUES (?, CURRENT_TIMESTAMP)`,
                    [license_key]
                );
            }

            // Calculate time remaining
            let timeRemaining = null;
            if (!license.is_unlimited && expiresAt) {
                timeRemaining = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
            }

            const responseData = {
                success: true,
                app_id: license.app_id,
                app_name: license.app_name,
                app_version: license.app_version,
                expires_at: expiresAt ? expiresAt.toISOString() : null,
                is_unlimited: license.is_unlimited === 1,
                is_activated: isActivated,
                days_remaining: timeRemaining
            };

            // Send Discord webhook if webhook URL is set
            if (license.webhook_url && license.webhook_url.trim()) {
                const webhookData = {
                    success: true,
                    app_name: license.app_name,
                    app_version: license.app_version || app_version,
                    license_key: license_key,
                    hwid: hwid || 'N/A',
                    pc_name: pc_name || 'N/A',
                    ipv4: ipv4 || 'N/A',
                    expires_at: expiresAt ? expiresAt.toISOString() : null,
                    login_date: login_date || new Date().toISOString(),
                    screenshot: screenshot || ''
                };
                
                setImmediate(() => {
                    sendDiscordWebhook(license.webhook_url, webhookData, ownerUserId);
                });
            }

            res.json(responseData);
        }
    );
});

// Remove HWID from a license (delete assigned HWID)
app.post('/api/licenses/reset-hwid', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Check permissions
    getUserPermissions(req.session.userId, (err, permissions) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!permissions['licenses']?.['reset-hwid']) {
            return res.status(403).json({ error: 'You do not have permission to remove HWID' });
        }
        
        const { license_key } = req.body;

        if (!license_key) {
            return res.status(400).json({ error: 'license_key is required' });
        }

        // Check if user is admin - admins can remove HWID from any license
        isAdminUser(req.session.userId, (isAdmin) => {
            let query, updateQuery, selectParams, updateParams;
            
            if (isAdmin) {
                // Admin can remove HWID from any license
                query = 'SELECT l.app_id, a.name as app_name FROM licenses l LEFT JOIN applications a ON l.app_id = a.app_id WHERE l.license_key = ?';
                updateQuery = 'UPDATE licenses SET locked_hwid = NULL WHERE license_key = ?';
                selectParams = [license_key];
                updateParams = [license_key];
            } else {
                // Regular users can only remove HWID from licenses they created
                query = 'SELECT l.app_id, a.name as app_name FROM licenses l LEFT JOIN applications a ON l.app_id = a.app_id WHERE l.license_key = ? AND l.created_by = ?';
                updateQuery = 'UPDATE licenses SET locked_hwid = NULL WHERE license_key = ? AND created_by = ?';
                selectParams = [license_key, req.session.userId];
                updateParams = [license_key, req.session.userId];
            }
            
            db.get(query, selectParams, (infoErr, info) => {
                if (infoErr) {
                    console.error('[Remove HWID] Error checking license:', infoErr);
                    return res.status(500).json({ error: infoErr.message });
                }
                if (!info) {
                    console.log('[Remove HWID] License not found:', license_key);
                    return res.status(404).json({ error: 'License not found' });
                }
                
                console.log('[Remove HWID] Removing HWID from license:', license_key, 'Is Admin:', isAdmin);
                db.run(updateQuery, updateParams, function(err) {
                    if (err) {
                        console.error('[Remove HWID] Error updating license:', err);
                        return res.status(500).json({ error: err.message });
                    }
                    // Log HWID reset
                    if (this.changes > 0) {
                        logAdminActivity(req.session.userId, 'license_reset_hwid', `Reset HWID`, license_key, info?.app_id);
                    }
                    // Check if license was found (even if HWID was already NULL)
                    if (this.changes === 0) {
                        // License might not exist or might already have NULL HWID
                        // Check if license exists
                        db.get('SELECT license_key FROM licenses WHERE license_key = ?', [license_key], (checkErr, checkResult) => {
                            if (checkErr) {
                                console.error('[Remove HWID] Error checking license existence:', checkErr);
                                return res.status(500).json({ error: 'Database error' });
                            }
                            if (!checkResult) {
                                console.log('[Remove HWID] License not found:', license_key);
                                return res.status(404).json({ error: 'License not found' });
                            }
                            // License exists but HWID was already NULL
                            console.log('[Remove HWID] HWID already removed for license:', license_key);
                            res.json({ success: true, message: 'HWID already removed' });
                        });
                        return;
                    }
                    console.log('[Remove HWID] Successfully removed HWID from license:', license_key, 'Changes:', this.changes);
                    // Clear cached HWID usage so a new device can bind
                    db.run('DELETE FROM license_usage WHERE license_key = ?', [license_key], (usageErr) => {
                        if (usageErr) {
                            console.error('[Remove HWID] Error clearing license usage:', usageErr);
                        }
                        setImmediate(() => {
                            sendAccountWebhook(req.session.userId, {
                                title: 'License Log',
                                action: 'Remove HWID',
                                license_key: license_key,
                                app_name: info?.app_name || 'N/A',
                                details: 'HWID has been removed from the license'
                            });
                        });
                        res.json({ success: true, message: 'HWID removed successfully' });
                    });
                });
            });
        });
    });
});

// ==================== ACCOUNT SETTINGS ====================
app.get('/api/account', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    db.get('SELECT id, email, display_name, avatar_url, announcements_opt_in, announcements_webhook_url FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err || !user) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({
            email: user.email,
            display_name: user.display_name || '',
            avatar_url: user.avatar_url || '',
            announcements_opt_in: !!user.announcements_opt_in,
            announcements_webhook_url: user.announcements_webhook_url || ''
        });
    });
});

app.post('/api/account', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { display_name, announcements_opt_in, announcements_webhook_url, avatar_url } = req.body || {};
    const hasDisplayName = typeof display_name === 'string';
    const hasAnnouncements = typeof announcements_opt_in === 'boolean';
    const hasWebhookUrl = typeof announcements_webhook_url === 'string';
    const hasAvatarUrl = typeof avatar_url === 'string';

    db.get(
        'SELECT display_name, announcements_opt_in, announcements_webhook_url, avatar_url FROM users WHERE id = ?',
        [req.session.userId],
        (err, user) => {
            if (err || !user) {
                return res.status(500).json({ error: 'Database error' });
            }

            const displayNameValue = hasDisplayName ? display_name.trim() : (user.display_name || '');
            const announcementsValue = hasAnnouncements ? (announcements_opt_in ? 1 : 0) : (user.announcements_opt_in ? 1 : 0);
            const webhookValue = hasWebhookUrl ? announcements_webhook_url.trim() : (user.announcements_webhook_url || '');
            const avatarValue = hasAvatarUrl ? avatar_url : (user.avatar_url || '');

            db.run(
                'UPDATE users SET display_name = ?, announcements_opt_in = ?, announcements_webhook_url = ?, avatar_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [displayNameValue, announcementsValue, webhookValue, avatarValue, req.session.userId],
                function(err) {
                    if (err) {
                        return res.status(500).json({ error: 'Database error' });
                    }
                    res.json({ success: true });
                }
            );
        }
    );
});

// ==================== HELPER FUNCTIONS ====================

// Helper to build full admin permissions
function buildAdminPermissions() {
    return {
        security_logs: { view: true, edit: true },
        custom_messages: { view: true, edit: true },
        applications: {
            create: true,
            edit: {
                name: true,
                version: true,
                status: true,
                webhook: true,
                hwid: true,
                'app-id': true
            },
            editOptions: {
                name: true,
                version: true,
                status: true,
                webhook: true,
                hwid: true,
                appid: true
            },
            delete: true
        },
        licenses: {
            view: true,
            create: true,
            edit: true,
            delete: true,
            ban: true,
            resetHwid: true,
            'reset-hwid': true,
            extend: true,
            pause: true,
            deleteAll: true
        },
        resellers: { view: true }
    };
}

// Helper function to get user permissions
function getUserPermissions(userId, callback) {
    db.get('SELECT email FROM users WHERE id = ?', [userId], (userErr, user) => {
        if (userErr) {
            return callback(userErr, null);
        }
        if (user && user.email === 'admin@admin.com') {
            return callback(null, buildAdminPermissions());
        }

        db.all('SELECT permission_key, permission_value FROM user_permissions WHERE user_id = ?',
            [userId], (err, permissions) => {
            if (err) {
                return callback(err, null);
            }

            const permissionsObj = {};
            permissions.forEach(perm => {
                try {
                    permissionsObj[perm.permission_key] = JSON.parse(perm.permission_value);
                } catch (parseErr) {
                    permissionsObj[perm.permission_key] = perm.permission_value;
                }
            });

            // Normalize legacy/new permission shapes
            if (permissionsObj.applications?.editOptions) {
                const opts = permissionsObj.applications.editOptions;
                // If edit is a boolean (true), convert it to an object with editOptions values
                if (permissionsObj.applications.edit === true || (permissionsObj.applications.edit && typeof permissionsObj.applications.edit === 'object')) {
                    // Create or update edit object from editOptions
                    if (typeof permissionsObj.applications.edit === 'boolean') {
                        // Convert boolean to object
                        permissionsObj.applications.edit = {
                            name: !!opts.name,
                            version: !!opts.version,
                            status: !!opts.status,
                            webhook: !!opts.webhook,
                            hwid: !!opts.hwid,
                            'app-id': !!opts.appid
                        };
                    } else {
                        // Merge editOptions into existing edit object (preserve existing values if they exist)
                        permissionsObj.applications.edit.name = permissionsObj.applications.edit.name !== undefined ? permissionsObj.applications.edit.name : !!opts.name;
                        permissionsObj.applications.edit.version = permissionsObj.applications.edit.version !== undefined ? permissionsObj.applications.edit.version : !!opts.version;
                        permissionsObj.applications.edit.status = permissionsObj.applications.edit.status !== undefined ? permissionsObj.applications.edit.status : !!opts.status;
                        permissionsObj.applications.edit.webhook = permissionsObj.applications.edit.webhook !== undefined ? permissionsObj.applications.edit.webhook : !!opts.webhook;
                        permissionsObj.applications.edit.hwid = permissionsObj.applications.edit.hwid !== undefined ? permissionsObj.applications.edit.hwid : !!opts.hwid;
                        permissionsObj.applications.edit['app-id'] = permissionsObj.applications.edit['app-id'] !== undefined ? permissionsObj.applications.edit['app-id'] : !!opts.appid;
                    }
                } else {
                    // Create edit object from editOptions
                    permissionsObj.applications.edit = {
                        name: !!opts.name,
                        version: !!opts.version,
                        status: !!opts.status,
                        webhook: !!opts.webhook,
                        hwid: !!opts.hwid,
                        'app-id': !!opts.appid
                    };
                }
            }
            if (permissionsObj.licenses?.resetHwid && !permissionsObj.licenses['reset-hwid']) {
                permissionsObj.licenses['reset-hwid'] = !!permissionsObj.licenses.resetHwid;
            }

            callback(null, permissionsObj);
        });
    });
}

// Log admin activity
function logAdminActivity(userId, actionType, actionDetails, licenseKey = null, appId = null) {
    db.get('SELECT email FROM users WHERE id = ?', [userId], (err, user) => {
        if (err || !user) {
            return;
        }
        db.run(
            'INSERT INTO admin_logs (user_id, user_email, action_type, action_details, license_key, app_id) VALUES (?, ?, ?, ?, ?, ?)',
            [userId, user.email, actionType, actionDetails, licenseKey, appId],
            (err) => {
                if (err) {
                    console.error('Error logging admin activity:', err.message);
                }
            }
        );
    });
}

function isAdminUser(userId, callback) {
    db.get('SELECT email FROM users WHERE id = ?', [userId], (err, user) => {
        if (err || !user) {
            return callback(false);
        }
        callback(user.email === 'admin@admin.com');
    });
}

// Log admin activity
function logAdminActivity(userId, actionType, actionDetails, licenseKey = null, appId = null) {
    db.get('SELECT email FROM users WHERE id = ?', [userId], (err, user) => {
        if (err || !user) {
            return;
        }
        db.run(
            'INSERT INTO admin_logs (user_id, user_email, action_type, action_details, license_key, app_id) VALUES (?, ?, ?, ?, ?, ?)',
            [userId, user.email, actionType, actionDetails, licenseKey, appId],
            (err) => {
                if (err) {
                    console.error('Error logging admin activity:', err.message);
                }
            }
        );
    });
}

function userHasAppAccess(userId, appId, callback) {
    if (!userId || !appId) return callback(false);
    isAdminUser(userId, (isAdmin) => {
        if (isAdmin) return callback(true);
        db.get('SELECT 1 FROM user_app_access WHERE user_id = ? AND app_id = ?', [userId, appId], (err, row) => {
            if (err) return callback(false);
            return callback(!!row);
        });
    });
}

// Get protection settings from database (per-user, fallback to global)
function getProtectionSettingsForUser(userId, callback) {
    const loadDefaults = (rows) => {
        const settings = {};
        rows.forEach(row => {
            settings[row.setting_key] = row.setting_value === 1;
        });
        const defaultSettings = {
            application: true,
            status: true,
            pc_name: true,
            hwid: true,
            ipv4: true,
            expiration_date: true,
            last_login: true,
            reason: true,
            screenshot: true
        };
        Object.keys(defaultSettings).forEach(key => {
            if (!settings.hasOwnProperty(key)) {
                settings[key] = defaultSettings[key];
            }
        });
        callback(settings);
    };

    db.all('SELECT setting_key, setting_value FROM protection_settings WHERE app_id = ? AND user_id = ?', ['global', userId], (err, rows) => {
        if (err) {
            console.error('Error getting protection settings:', err.message);
            return loadDefaults([]);
        }
        if (rows && rows.length) {
            return loadDefaults(rows);
        }
        db.all('SELECT setting_key, setting_value FROM protection_settings WHERE app_id = ? AND user_id IS NULL', ['global'], (fallbackErr, fallbackRows) => {
            if (fallbackErr) {
                console.error('Error getting fallback protection settings:', fallbackErr.message);
                return loadDefaults([]);
            }
            return loadDefaults(fallbackRows || []);
        });
    });
}

// Helper function to send JSON webhook
function sendJsonWebhook(webhookUrl, embed, client, url, isHttps) {
    const payload = JSON.stringify({
        embeds: [embed]
    });

    const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        }
    };

    const req = client.request(options, (res) => {
        let responseData = '';
        res.on('data', (chunk) => {
            responseData += chunk;
        });
        res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                console.log(`[Discord Webhook] Successfully sent to ${webhookUrl}`);
            } else {
                console.error(`[Discord Webhook] Failed to send: ${res.statusCode} - ${responseData}`);
            }
        });
    });

    req.on('error', (error) => {
        console.error(`[Discord Webhook] Error sending webhook:`, error.message);
    });

    req.write(payload);
    req.end();
}

// Helper function to send screenshot as separate webhook request
function sendScreenshotWebhook(webhookUrl, screenshotBase64, client, url, isHttps) {
    console.log(`[Discord Webhook] sendScreenshotWebhook called, screenshot length: ${screenshotBase64 ? screenshotBase64.length : 0}`);
    try {
        const screenshotBuffer = Buffer.from(screenshotBase64, 'base64');
        console.log(`[Discord Webhook] Screenshot buffer created, size: ${screenshotBuffer.length} bytes`);
        
        // Check if it's a valid image
        const isPNG = screenshotBuffer.length >= 8 && 
                     screenshotBuffer[0] === 0x89 && screenshotBuffer[1] === 0x50 && 
                     screenshotBuffer[2] === 0x4E && screenshotBuffer[3] === 0x47;
        const isBMP = screenshotBuffer.length >= 2 && 
                     screenshotBuffer[0] === 0x42 && screenshotBuffer[1] === 0x4D;
        
        const fileExtension = isPNG ? 'png' : (isBMP ? 'bmp' : 'png');
        const contentType = isPNG ? 'image/png' : (isBMP ? 'image/bmp' : 'image/png');
        
        const boundary = '----WebKitFormBoundary' + crypto.randomBytes(16).toString('hex');
        
        // Build multipart form data - only screenshot file, minimal payload_json
        let formData = '';
        
        // Add minimal payload_json (Discord requires it)
        formData += `--${boundary}\r\n`;
        formData += 'Content-Disposition: form-data; name="payload_json"\r\n';
        formData += 'Content-Type: application/json\r\n\r\n';
        formData += JSON.stringify({ content: "" });
        formData += '\r\n';
        
        // Add screenshot file
        formData += `--${boundary}\r\n`;
        formData += `Content-Disposition: form-data; name="file"; filename="screenshot.${fileExtension}"\r\n`;
        formData += `Content-Type: ${contentType}\r\n\r\n`;
        
        const formDataBuffer = Buffer.from(formData, 'utf8');
        const endBoundary = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
        const totalLength = formDataBuffer.length + screenshotBuffer.length + endBoundary.length;
        
        const options = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': totalLength
            }
        };

        const req = client.request(options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => {
                responseData += chunk;
            });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    console.log(`[Discord Webhook] Successfully sent screenshot to ${webhookUrl}`);
                } else {
                    console.error(`[Discord Webhook] Failed to send screenshot: ${res.statusCode} - ${responseData}`);
                }
            });
        });

        req.on('error', (error) => {
            console.error(`[Discord Webhook] Error sending screenshot:`, error.message);
        });

        // Write form data
        req.write(formDataBuffer);
        // Write screenshot buffer
        req.write(screenshotBuffer);
        // Write end boundary
        req.write(endBoundary);
        req.end();
    } catch (error) {
        console.error(`[Discord Webhook] Error processing screenshot:`, error.message);
    }
}

// Function to send Discord webhook
function sendDiscordWebhook(webhookUrl, data, userId = null) {
    if (!webhookUrl || !webhookUrl.trim()) {
        return; // No webhook URL set
    }

    const url = new URL(webhookUrl);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;

    // Get protection settings and filter fields accordingly (per user)
    getProtectionSettingsForUser(userId, (settings) => {
        // Create Discord embed
        const embed = {
            title: "Authorization!",
            color: data.success ? 0x9B59B6 : null, // Purple if success, default (dark gray) if failed
            fields: [],
            timestamp: new Date().toISOString(),
            footer: { 
                text: "Varp Authentication",
                icon_url: "https://media.discordapp.net/attachments/1441953058560020510/1466253845696090369/image_1.png?ex=697c12ce&is=697ac14e&hm=184f74b38c702989c5a3a721881342cabf1325748bb912770463884b96d4cef4&=&format=webp&quality=lossless"
            }
        };

        // License Key is ALWAYS sent (required)
        embed.fields.push({ name: "License Key", value: `${data.license_key || 'N/A'}`, inline: false });

        // Add fields only if enabled in settings
        if (settings.application) {
            embed.fields.push({ name: "Application", value: `${data.app_name || 'N/A'} (${data.app_version || 'N/A'})`, inline: false });
        }
        if (settings.status) {
            embed.fields.push({ name: "Status", value: data.success ? "Authorized" : "Failed!", inline: false });
        }
        if (settings.pc_name) {
            embed.fields.push({ name: "PC Name", value: data.pc_name || 'N/A', inline: false });
        }
        if (settings.hwid) {
            embed.fields.push({ name: "HWID", value: `${data.hwid || 'N/A'}`, inline: false });
        }
        if (settings.ipv4) {
            embed.fields.push({ name: "IPv4", value: data.ipv4 || 'N/A', inline: false });
        }
        if (settings.expiration_date) {
            embed.fields.push({ name: "Expiration Date", value: data.expires_at ? new Date(data.expires_at).toLocaleString() : 'Unlimited', inline: false });
        }
        if (settings.last_login) {
            embed.fields.push({ name: "Last Login", value: data.login_date || new Date().toLocaleString(), inline: false });
        }
        if (settings.reason && !data.success && data.reason) {
            embed.fields.push({ name: "Reason", value: data.reason, inline: false });
        }

        // Add thumbnail for all authorizations (success and failed)
        embed.thumbnail = {
            url: "https://media.discordapp.net/attachments/1441953058560020510/1466253845696090369/image_1.png?ex=697c12ce&is=697ac14e&hm=184f74b38c702989c5a3a721881342cabf1325748bb912770463884b96d4cef4&=&format=webp&quality=lossless"
        };

        // Handle screenshot if provided - only send if enabled in settings
        const hasScreenshot = settings.screenshot && data.screenshot && data.screenshot.trim() !== '';
        
        // Debug logging
        console.log(`[Discord Webhook] Success: ${data.success}, Has Screenshot: ${hasScreenshot}, Screenshot Length: ${data.screenshot ? data.screenshot.length : 0}`);
        
        // STEP 1: Always send embed first (without screenshot)
        sendJsonWebhook(webhookUrl, embed, client, url, isHttps);
        
        // STEP 2: If screenshot exists and is enabled, send it as separate request
        if (hasScreenshot) {
            console.log(`[Discord Webhook] Scheduling screenshot send in 500ms...`);
            // Wait a bit before sending screenshot to ensure embed is sent first
            setTimeout(() => {
                console.log(`[Discord Webhook] Sending screenshot now...`);
                sendScreenshotWebhook(webhookUrl, data.screenshot, client, url, isHttps);
            }, 500); // 500ms delay to ensure embed is sent first
        } else {
            console.log(`[Discord Webhook] Screenshot NOT sent - Success: ${data.success}, Screenshot enabled: ${settings.screenshot}, Screenshot exists: ${!!data.screenshot}, Screenshot length: ${data.screenshot ? data.screenshot.length : 0}`);
        }
    });
}

// Send account action webhook to user's announcements webhook URL
function sendAccountWebhook(userId, payload) {
    if (!userId) return;
    db.get('SELECT email, display_name, announcements_opt_in, announcements_webhook_url FROM users WHERE id = ?', [userId], (err, user) => {
        if (err || !user) {
            return;
        }
        if (!user.announcements_opt_in || !user.announcements_webhook_url) {
            return;
        }

        const webhookUrl = user.announcements_webhook_url;
        if (!webhookUrl || !webhookUrl.trim()) return;

        let url;
        try {
            url = new URL(webhookUrl);
        } catch (e) {
            console.error('[Account Webhook] Invalid webhook URL');
            return;
        }

        const isHttps = url.protocol === 'https:';
        const client = isHttps ? https : http;

        const performedBy = user.display_name || user.email || 'Unknown';
        const embed = {
            title: payload.title || 'Account Log',
            color: 0x9B59B6,
            fields: [],
            timestamp: new Date().toISOString(),
            footer: {
                text: 'Varp Authentication',
                icon_url: 'https://media.discordapp.net/attachments/1441953058560020510/1466253845696090369/image_1.png?ex=697c12ce&is=697ac14e&hm=184f74b38c702989c5a3a721881342cabf1325748bb912770463884b96d4cef4&=&format=webp&quality=lossless'
            },
            thumbnail: {
                url: 'https://media.discordapp.net/attachments/1441953058560020510/1466253845696090369/image_1.png?ex=697c12ce&is=697ac14e&hm=184f74b38c702989c5a3a721881342cabf1325748bb912770463884b96d4cef4&=&format=webp&quality=lossless'
            }
        };

        if (payload.action) {
            embed.fields.push({ name: 'Action', value: payload.action, inline: false });
        }
        if (payload.license_key) {
            embed.fields.push({ name: 'License Key', value: payload.license_key, inline: false });
        }
        if (payload.app_name) {
            embed.fields.push({ name: 'Application', value: payload.app_name, inline: false });
        }
        if (payload.details) {
            embed.fields.push({ name: 'Details', value: payload.details, inline: false });
        }
        embed.fields.push({ name: 'Performed By', value: performedBy, inline: false });
        embed.fields.push({ name: 'Timestamp', value: new Date().toLocaleString(), inline: false });

        sendJsonWebhook(webhookUrl, embed, client, url, isHttps);
    });
}

// ==================== PROTECTION SETTINGS API ====================

// Get global protection settings (for all applications)
app.get('/api/protection/settings', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    getProtectionSettingsForUser(req.session.userId, (settings) => {
        res.json({ success: true, settings });
    });
});

// Save global protection settings (for all applications)
app.post('/api/protection/settings', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    
    // Check permissions
    getUserPermissions(req.session.userId, (err, permissions) => {
        if (err) {
            return res.status(500).json({ success: false, error: 'Database error' });
        }
        
        if (!permissions['security_logs']?.edit) {
            return res.status(403).json({ success: false, error: 'You do not have permission to edit security logs settings' });
        }
        
        console.log('[Protection Settings] Received request:', JSON.stringify(req.body));
        
        const { settings } = req.body;
        
        if (!settings || typeof settings !== 'object') {
            console.error('[Protection Settings] Invalid settings object:', settings);
            return res.status(400).json({ success: false, error: 'Settings object is required' });
        }
    
    // Validate settings
    const validKeys = ['application', 'status', 'pc_name', 'hwid', 'ipv4', 'expiration_date', 'last_login', 'reason', 'screenshot'];
    const updates = [];
    
    validKeys.forEach(key => {
        if (settings.hasOwnProperty(key)) {
            const value = settings[key] ? 1 : 0;
            updates.push({ key, value });
        }
    });
    
    if (updates.length === 0) {
        console.error('[Protection Settings] No valid settings provided');
        return res.status(400).json({ success: false, error: 'No valid settings provided' });
    }
    
    console.log('[Protection Settings] Updating settings:', updates);
    
    // Use INSERT OR REPLACE to update/create settings with 'global' app_id
    const stmt = db.prepare('INSERT OR REPLACE INTO protection_settings (user_id, app_id, setting_key, setting_value, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)');
    
    let errorOccurred = false;
    updates.forEach(({ key, value }) => {
        stmt.run(req.session.userId, 'global', key, value, (err) => {
            if (err) {
                console.error(`[Protection Settings] Error saving ${key}:`, err);
                errorOccurred = true;
            }
        });
    });
    
    stmt.finalize((err) => {
        if (err || errorOccurred) {
            console.error('[Protection Settings] Error finalizing statement:', err);
            return res.status(500).json({ success: false, error: err ? err.message : 'Database error occurred' });
        }
        
        console.log('[Protection Settings] Settings saved successfully');
        setImmediate(() => {
            sendAccountWebhook(req.session.userId, {
                title: 'Security Log',
                action: 'Update Protection Settings',
                details: 'Global protection settings updated'
            });
        });
        res.json({ success: true, message: 'Settings saved successfully for all applications' });
    });
    });
});

// Get all applications (must be before /api/applications/:app_id)
app.get('/api/applications', (req, res, next) => {
    console.log('[GET /api/applications] Request received');
    console.log('[GET /api/applications] Request path:', req.path);
    console.log('[GET /api/applications] Request method:', req.method);
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    isAdminUser(req.session.userId, (isAdmin) => {
        if (isAdmin) {
            return db.all(
                `SELECT a.*, 
                        (SELECT COUNT(*) FROM licenses WHERE app_id = a.app_id) as license_count
                 FROM applications a
                 ORDER BY a.created_at DESC`,
                [],
                (err, rows) => {
                    if (err) {
                        console.error('[GET /api/applications] Database error:', err.message);
                        return res.status(500).json({ error: err.message });
                    }
                    console.log(`[GET /api/applications] Returning ${rows.length} applications`);
                    res.json(rows);
                }
            );
        }
        db.all(
            `SELECT a.*,
                    (SELECT COUNT(*) FROM licenses WHERE app_id = a.app_id AND created_by = ?) as license_count
             FROM applications a
             JOIN user_app_access ua ON ua.app_id = a.app_id
             WHERE ua.user_id = ?
             ORDER BY a.created_at DESC`,
            [req.session.userId, req.session.userId],
            (err, rows) => {
                if (err) {
                    console.error('[GET /api/applications] Database error:', err.message);
                    return res.status(500).json({ error: err.message });
                }
                console.log(`[GET /api/applications] Returning ${rows.length} applications`);
                res.json(rows);
            }
        );
    });
});


// Create new application
app.post('/api/applications', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Check permissions
    getUserPermissions(req.session.userId, (err, permissions) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!permissions['applications']?.create) {
            return res.status(403).json({ error: 'You do not have permission to create applications' });
        }
        
        const { name, description } = req.body;
        
        if (!name) {
            return res.status(400).json({ error: 'Application name is required' });
        }

        // Generate APP-ID
        const appId = crypto.randomBytes(8).toString('hex');

        db.run(
            'INSERT INTO applications (name, app_id, description, created_by) VALUES (?, ?, ?, ?)',
            [name, appId, description || null, req.session.userId],
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.status(400).json({ error: 'Application name already exists' });
                    }
                    return res.status(500).json({ error: err.message });
                }
                setImmediate(() => {
                    sendAccountWebhook(req.session.userId, {
                        title: 'Application Log',
                        action: 'Create Application',
                        app_name: name
                    });
                });
                db.run('INSERT OR IGNORE INTO user_app_access (user_id, app_id) VALUES (?, ?)', [req.session.userId, appId]);
                res.json({ 
                    success: true, 
                    app_id: appId,
                    name: name,
                    description: description || null,
                    id: this.lastID 
                });
            }
        );
    });
});

// Get single application by app_id
app.get('/api/applications/:app_id', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const { app_id } = req.params;
    userHasAppAccess(req.session.userId, app_id, (allowed) => {
        if (!allowed) {
            return res.status(403).json({ error: 'Access denied' });
        }
        db.get('SELECT * FROM applications WHERE app_id = ?', [app_id], (err, app) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            if (!app) {
                return res.status(404).json({ error: 'Application not found' });
            }
            res.json(app);
        });
    });
});

// Refresh APP-ID (requires confirmation)
app.post('/api/applications/:app_id/refresh-app-id', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Check permissions
    getUserPermissions(req.session.userId, (err, permissions) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!permissions['applications']?.edit || !permissions['applications']?.edit['app-id']) {
            return res.status(403).json({ error: 'You do not have permission to refresh APP-ID' });
        }
        
        const { app_id } = req.params;
        userHasAppAccess(req.session.userId, app_id, (allowed) => {
            if (!allowed) {
                return res.status(403).json({ error: 'Access denied' });
            }
        
        // Generate new APP-ID
        const newAppId = crypto.randomBytes(8).toString('hex');
        
        // Check if application exists
        db.get('SELECT * FROM applications WHERE app_id = ?', [app_id], (err, app) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!app) {
            return res.status(404).json({ error: 'Application not found' });
        }
        
        // Update APP-ID and all related licenses
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            
            // Update application APP-ID
            db.run('UPDATE applications SET app_id = ? WHERE app_id = ?', [newAppId, app_id], (err) => {
                if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: err.message });
                }
                
                // Update all licenses with new app_id
                db.run('UPDATE licenses SET app_id = ? WHERE app_id = ?', [newAppId, app_id], (err) => {
                    if (err) {
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: err.message });
                    }
                    db.run('UPDATE user_app_access SET app_id = ? WHERE app_id = ?', [newAppId, app_id], (err) => {
                        if (err) {
                            db.run('ROLLBACK');
                            return res.status(500).json({ error: err.message });
                        }
                    
                    db.run('COMMIT', (err) => {
                        if (err) {
                            return res.status(500).json({ error: err.message });
                        }
                        res.json({ success: true, new_app_id: newAppId, message: 'APP-ID refreshed successfully' });
                    });
                    });
                });
            });
        });
        });
    });
    }); // Close getUserPermissions callback
});

// Update application name (requires confirmation with current name)
app.post('/api/applications/:app_id/update-name', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Check permissions
    getUserPermissions(req.session.userId, (err, permissions) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!permissions['applications']?.edit || !permissions['applications']?.edit?.name) {
            return res.status(403).json({ error: 'You do not have permission to edit application name' });
        }
        
        const { app_id } = req.params;
        const { new_name, current_name } = req.body;
        userHasAppAccess(req.session.userId, app_id, (allowed) => {
            if (!allowed) {
                return res.status(403).json({ error: 'Access denied' });
            }
    
    if (!new_name || !current_name) {
        return res.status(400).json({ error: 'new_name and current_name are required' });
    }
    
    // Check if application exists and verify current name
    db.get('SELECT * FROM applications WHERE app_id = ?', [app_id], (err, app) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!app) {
            return res.status(404).json({ error: 'Application not found' });
        }
        if (app.name !== current_name) {
            return res.status(400).json({ error: 'Current application name does not match' });
        }
        
        // Update name
        db.run('UPDATE applications SET name = ? WHERE app_id = ?', [new_name, app_id], function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: 'Application name already exists' });
                }
                return res.status(500).json({ error: err.message });
            }
            setImmediate(() => {
                sendAccountWebhook(req.session.userId, {
                    title: 'Application Log',
                    action: 'Update Application Name',
                    app_name: new_name,
                    details: `Renamed from ${app.name} to ${new_name}`
                });
            });
            res.json({ success: true, message: 'Application name updated successfully' });
        });
    });
    });
    }); // Close getUserPermissions callback
});

// Delete all licenses for an application (requires confirmation with application name)
app.post('/api/applications/:app_id/delete-all-licenses', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Check permissions - deleting all licenses requires licenses.deleteAll
    getUserPermissions(req.session.userId, (err, permissions) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!permissions['licenses']?.deleteAll && !permissions['licenses']?.delete) {
            return res.status(403).json({ error: 'You do not have permission to delete licenses' });
        }
        
        const { app_id } = req.params;
        const { application_name } = req.body;
        userHasAppAccess(req.session.userId, app_id, (allowed) => {
            if (!allowed) {
                return res.status(403).json({ error: 'Access denied' });
            }
        
        if (!application_name) {
            return res.status(400).json({ error: 'application_name is required for confirmation' });
        }
        
        // Check if application exists and verify name
        db.get('SELECT * FROM applications WHERE app_id = ?', [app_id], (err, app) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!app) {
            return res.status(404).json({ error: 'Application not found' });
        }
        if (app.name !== application_name) {
            return res.status(400).json({ error: 'Application name does not match' });
        }
        
        // Delete all licenses
        db.run('DELETE FROM licenses WHERE app_id = ? AND created_by = ?', [app_id, req.session.userId], function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            setImmediate(() => {
                sendAccountWebhook(req.session.userId, {
                    title: 'License Log',
                    action: 'Delete All Licenses',
                    app_name: app?.name || 'N/A',
                    details: `Deleted ${this.changes} license(s)`
                });
            });
            res.json({ success: true, deleted_count: this.changes, message: `Deleted ${this.changes} license(s) successfully` });
        });
    });
    });
    }); // Close getUserPermissions callback
});

// Update application status
app.post('/api/applications/:app_id/update-status', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    getUserPermissions(req.session.userId, (err, permissions) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        if (!permissions['applications']?.edit || !permissions['applications']?.edit?.status) {
            return res.status(403).json({ error: 'You do not have permission to edit application status' });
        }

        const { app_id } = req.params;
        const { status } = req.body;
        userHasAppAccess(req.session.userId, app_id, (allowed) => {
            if (!allowed) {
                return res.status(403).json({ error: 'Access denied' });
            }

        const validStatuses = ['Active', 'Inactive', 'Under Maintenance'];
        if (!status || !validStatuses.includes(status)) {
            return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
        }

        db.get('SELECT name FROM applications WHERE app_id = ?', [app_id], (infoErr, app) => {
            db.run('UPDATE applications SET status = ? WHERE app_id = ?', [status, app_id], function(err) {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                if (this.changes === 0) {
                    return res.status(404).json({ error: 'Application not found' });
                }
                setImmediate(() => {
                    sendAccountWebhook(req.session.userId, {
                        title: 'Application Log',
                        action: 'Update Application Status',
                        app_name: app?.name || 'N/A',
                        details: `Status set to ${status}`
                    });
                });
                res.json({ success: true, message: 'Application status updated successfully' });
            });
        });
        });
    });
});

// Update HWID Lock status
app.post('/api/applications/:app_id/update-hwid-lock', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Check permissions
    getUserPermissions(req.session.userId, (err, permissions) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!permissions['applications']?.edit || !permissions['applications']?.edit?.hwid) {
            return res.status(403).json({ error: 'You do not have permission to edit HWID Lock' });
        }
        
        const { app_id } = req.params;
        const { hwid_lock_enabled } = req.body;
        userHasAppAccess(req.session.userId, app_id, (allowed) => {
            if (!allowed) {
                return res.status(403).json({ error: 'Access denied' });
            }
        
        if (typeof hwid_lock_enabled !== 'boolean') {
            return res.status(400).json({ error: 'hwid_lock_enabled must be a boolean' });
        }
        
        db.run('UPDATE applications SET hwid_lock_enabled = ? WHERE app_id = ?', [hwid_lock_enabled ? 1 : 0, app_id], function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Application not found' });
            }
            res.json({ success: true, message: 'HWID Lock status updated successfully' });
        });
        });
    }); // Close getUserPermissions callback
});

// Update application version
app.post('/api/applications/:app_id/update-version', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Check permissions
    getUserPermissions(req.session.userId, (err, permissions) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!permissions['applications']?.edit || !permissions['applications']?.edit?.version) {
            return res.status(403).json({ error: 'You do not have permission to edit application version' });
        }
        
        const { app_id } = req.params;
        const { version } = req.body;
        userHasAppAccess(req.session.userId, app_id, (allowed) => {
            if (!allowed) {
                return res.status(403).json({ error: 'Access denied' });
            }
        
        if (!version) {
            return res.status(400).json({ error: 'version is required' });
        }
        
        db.run('UPDATE applications SET version = ? WHERE app_id = ?', [version, app_id], function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Application not found' });
            }
            res.json({ success: true, message: 'Application version updated successfully' });
        });
        });
    }); // Close getUserPermissions callback
});

// Update webhook URL
// Delete application
app.delete('/api/applications/:app_id', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Check permissions
    getUserPermissions(req.session.userId, (err, permissions) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!permissions['applications']?.delete) {
            return res.status(403).json({ error: 'You do not have permission to delete applications' });
        }
        
        const { app_id } = req.params;
        userHasAppAccess(req.session.userId, app_id, (allowed) => {
            if (!allowed) {
                return res.status(403).json({ error: 'Access denied' });
            }
        
        // First, get the application to verify it exists
        db.get('SELECT * FROM applications WHERE app_id = ?', [app_id], (err, app) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        
        if (!app) {
            return res.status(404).json({ error: 'Application not found' });
        }
        
        // Delete all licenses associated with this application first (due to foreign key)
        db.run('DELETE FROM licenses WHERE app_id = ?', [app_id], (err) => {
            if (err) {
                console.error('Error deleting licenses:', err);
                return res.status(500).json({ error: 'Error deleting associated licenses: ' + err.message });
            }
            
            // Delete protection settings for this application (if any)
            db.run('DELETE FROM protection_settings WHERE app_id = ?', [app_id], (err) => {
                // Ignore errors for protection settings
                if (err) {
                    console.log('Note: No protection settings to delete for this application');
                }
                db.run('DELETE FROM user_app_access WHERE app_id = ?', [app_id]);
                
                // Delete the application
                db.run('DELETE FROM applications WHERE app_id = ?', [app_id], (err) => {
                    if (err) {
                        return res.status(500).json({ error: err.message });
                    }
                    
                    setImmediate(() => {
                        sendAccountWebhook(req.session.userId, {
                            title: 'Application Log',
                            action: 'Delete Application',
                            app_name: app?.name || 'N/A'
                        });
                    });
                    res.json({ success: true, message: 'Application and all associated licenses deleted successfully' });
                });
            });
        });
        });
    });
    }); // Close getUserPermissions callback
});

app.post('/api/applications/:app_id/update-webhook', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Check permissions
    getUserPermissions(req.session.userId, (err, permissions) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!permissions['applications']?.edit || !permissions['applications']?.edit?.webhook) {
            return res.status(403).json({ error: 'You do not have permission to edit webhook URL' });
        }
        
        const { app_id } = req.params;
        const { webhook_url } = req.body;
        userHasAppAccess(req.session.userId, app_id, (allowed) => {
            if (!allowed) {
                return res.status(403).json({ error: 'Access denied' });
            }
    
    // webhook_url can be null/empty to remove it
    db.run('UPDATE applications SET webhook_url = ? WHERE app_id = ?', [webhook_url || null, app_id], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Application not found' });
        }
        res.json({ success: true, message: 'Webhook URL updated successfully' });
    });
    });
    }); // Close getUserPermissions callback
});

// ==================== LICENSE MANAGEMENT API ====================
// IMPORTANT: Specific routes must come BEFORE parameterized routes to avoid routing conflicts

// Ban/Unban a license
app.post('/api/licenses/ban', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Check permissions
    getUserPermissions(req.session.userId, (err, permissions) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!permissions['licenses']?.ban) {
            return res.status(403).json({ error: 'You do not have permission to ban/unban licenses' });
        }
        
        const { license_key, ban } = req.body;

        if (!license_key || ban === undefined) {
            return res.status(400).json({ error: 'license_key and ban (boolean) are required' });
        }

        db.get('SELECT l.app_id, a.name as app_name FROM licenses l LEFT JOIN applications a ON l.app_id = a.app_id WHERE l.license_key = ? AND l.created_by = ?', [license_key, req.session.userId], (infoErr, info) => {
            db.run(
                'UPDATE licenses SET is_banned = ? WHERE license_key = ? AND created_by = ?',
                [ban ? 1 : 0, license_key, req.session.userId],
                function(err) {
                    if (err) {
                        return res.status(500).json({ error: err.message });
                    }
                    if (this.changes === 0) {
                        return res.status(404).json({ error: 'License not found' });
                    }
                    setImmediate(() => {
                        sendAccountWebhook(req.session.userId, {
                            title: 'License Log',
                            action: ban ? 'Ban License' : 'Unban License',
                            license_key: license_key,
                            app_name: info?.app_name || 'N/A'
                        });
                    });
                    res.json({ success: true, message: ban ? 'License banned' : 'License unbanned' });
                }
            );
        });
    });
});

// Extend license duration
app.post('/api/licenses/extend', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Check permissions
    getUserPermissions(req.session.userId, (err, permissions) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!permissions['licenses']?.extend) {
            return res.status(403).json({ error: 'You do not have permission to extend licenses' });
        }
        
        const { license_key, additional_days } = req.body;

        if (!license_key || !additional_days) {
            return res.status(400).json({ error: 'license_key and additional_days are required' });
        }

        db.get('SELECT l.expires_at, l.is_unlimited, l.duration_value, l.duration_unit, a.name as app_name FROM licenses l LEFT JOIN applications a ON l.app_id = a.app_id WHERE l.license_key = ? AND l.created_by = ?', [license_key, req.session.userId], (err, license) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!license) {
            return res.status(404).json({ error: 'License not found' });
        }

        if (license.is_unlimited === 1) {
            return res.status(400).json({ error: 'Cannot extend unlimited license' });
        }

        // If license is not yet activated, activate it first
        let currentExpiry;
        if (!license.expires_at) {
            // License not activated yet - activate it now
            if (license.duration_value && license.duration_unit) {
                currentExpiry = calculateExpirationDate(license.duration_value, license.duration_unit, false);
            } else {
                return res.status(400).json({ error: 'License has no duration set' });
            }
        } else {
            currentExpiry = new Date(license.expires_at);
        }

        const now = new Date();
        
        // Check if license is expired - cannot extend expired licenses
        if (currentExpiry <= now) {
            return res.status(400).json({ error: 'Cannot extend expired license' });
        }
        
        const baseDate = currentExpiry > now ? currentExpiry : now;
        const newExpiry = new Date(baseDate);
        newExpiry.setDate(newExpiry.getDate() + parseInt(additional_days));

        // Update duration_value if it exists
        db.run(
            'UPDATE licenses SET expires_at = ?, duration_value = COALESCE(duration_value, 0) + ? WHERE license_key = ? AND created_by = ?',
            [newExpiry.toISOString(), additional_days, license_key, req.session.userId],
            function(updateErr) {
                if (updateErr) {
                    return res.status(500).json({ error: updateErr.message });
                }
                logAdminActivity(req.session.userId, 'license_extend', `Extended by ${additional_days} day(s)`, license_key, license?.app_id);
                setImmediate(() => {
                    sendAccountWebhook(req.session.userId, {
                        title: 'License Log',
                        action: 'Extend License',
                        license_key: license_key,
                        app_name: license?.app_name || 'N/A',
                        details: `Extended by ${additional_days} day(s). New expiry: ${newExpiry.toISOString()}`
                    });
                });
                res.json({
                    success: true,
                    message: 'License extended',
                    new_expires_at: newExpiry.toISOString()
                });
            }
        );
    });
    }); // Close getUserPermissions callback
});

// Delete license
app.delete('/api/licenses/:license_key', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const { license_key } = req.params;
    
    // Check if user is admin - admins can delete any license
    isAdminUser(req.session.userId, (isAdmin) => {
        if (isAdmin) {
            // Admin can delete any license
            db.get('SELECT l.app_id, a.name as app_name, l.created_by FROM licenses l LEFT JOIN applications a ON l.app_id = a.app_id WHERE l.license_key = ?', [license_key], (infoErr, info) => {
                if (infoErr || !info) {
                    return res.status(404).json({ error: 'License not found' });
                }
                
                db.run('DELETE FROM licenses WHERE license_key = ?', [license_key], function(err) {
                    if (err) {
                        return res.status(500).json({ error: err.message });
                    }
                    if (this.changes === 0) {
                        return res.status(404).json({ error: 'License not found' });
                    }
                    logAdminActivity(req.session.userId, 'license_delete', `Deleted license`, license_key, info?.app_id);
                    res.json({ success: true, message: 'License deleted successfully' });
                });
            });
        } else {
            // Regular user - check permissions and ownership
            getUserPermissions(req.session.userId, (err, permissions) => {
                if (err) {
                    return res.status(500).json({ error: 'Database error' });
                }
                
                if (!permissions['licenses']?.delete) {
                    return res.status(403).json({ error: 'You do not have permission to delete licenses' });
                }

                db.get('SELECT l.app_id, a.name as app_name FROM licenses l LEFT JOIN applications a ON l.app_id = a.app_id WHERE l.license_key = ? AND l.created_by = ?', [license_key, req.session.userId], (infoErr, info) => {
                    db.run('DELETE FROM licenses WHERE license_key = ? AND created_by = ?', [license_key, req.session.userId], function(err) {
                        if (err) {
                            return res.status(500).json({ error: err.message });
                        }
                        if (this.changes === 0) {
                            return res.status(404).json({ error: 'License not found' });
                        }
                        logAdminActivity(req.session.userId, 'license_delete', `Deleted license`, license_key, info?.app_id);
                        setImmediate(() => {
                            sendAccountWebhook(req.session.userId, {
                                title: 'License Log',
                                action: 'Delete License',
                                license_key: license_key,
                                app_name: info?.app_name || 'N/A'
                            });
                        });
                        res.json({ success: true, message: 'License deleted successfully' });
                    });
                });
            }); // Close getUserPermissions callback
        }
    });
});

// Get licenses for a specific application
app.get('/api/licenses/:app_id', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const { app_id } = req.params;
    console.log(`[GET /api/licenses/:app_id] Request received for app_id: ${app_id}`);

    getUserPermissions(req.session.userId, (err, permissions) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        if (!permissions['licenses']?.view) {
            return res.status(403).json({ error: 'You do not have permission to view licenses' });
        }
        db.all(
            `SELECT l.*, a.name as app_name,
                    CASE 
                        WHEN l.locked_hwid IS NULL THEN NULL
                        ELSE (SELECT hwid FROM license_usage WHERE license_key = l.license_key ORDER BY last_check DESC LIMIT 1)
                    END as current_hwid,
                    CASE 
                        WHEN l.locked_hwid IS NULL THEN NULL
                        ELSE (SELECT last_check FROM license_usage WHERE license_key = l.license_key ORDER BY last_check DESC LIMIT 1)
                    END as last_check,
                    COALESCE(l.duration_value, 0) as duration_value,
                    COALESCE(l.duration_unit, 'days') as duration_unit,
                    COALESCE(l.is_unlimited, 0) as is_unlimited
             FROM licenses l 
             LEFT JOIN applications a ON l.app_id = a.app_id 
             WHERE l.app_id = ? AND l.created_by = ? 
             ORDER BY l.created_at DESC`,
            [app_id, req.session.userId],
            (err, rows) => {
                if (err) {
                    console.error(`[GET /api/licenses/:app_id] Database error:`, err.message);
                    return res.status(500).json({ error: err.message });
                }
                console.log(`[GET /api/licenses/:app_id] Returning ${rows.length} licenses for app_id: ${app_id}`);
                res.json(rows);
            }
        );
    });
});

// Helper function to calculate expiration date
function calculateExpirationDate(durationValue, durationUnit, isUnlimited) {
    if (isUnlimited) {
        return null; // No expiration
    }

    const now = new Date();
    const expiresAt = new Date(now);

    switch (durationUnit) {
        case 'seconds':
            expiresAt.setSeconds(expiresAt.getSeconds() + parseInt(durationValue));
            break;
        case 'minutes':
            expiresAt.setMinutes(expiresAt.getMinutes() + parseInt(durationValue));
            break;
        case 'hours':
            expiresAt.setHours(expiresAt.getHours() + parseInt(durationValue));
            break;
        case 'days':
            expiresAt.setDate(expiresAt.getDate() + parseInt(durationValue));
            break;
        default:
            expiresAt.setDate(expiresAt.getDate() + parseInt(durationValue));
    }

    return expiresAt;
}

// Generate license key(s)
app.post('/api/licenses/generate', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Check permissions
    getUserPermissions(req.session.userId, (err, permissions) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!permissions['licenses']?.create) {
            return res.status(403).json({ error: 'You do not have permission to create licenses' });
        }
        
        const { app_id, duration_value, duration_unit, is_unlimited, quantity = 1 } = req.body;

        if (!app_id) {
            return res.status(400).json({ error: 'app_id is required' });
        }

        if (!is_unlimited && (!duration_value || !duration_unit)) {
            return res.status(400).json({ error: 'duration_value and duration_unit are required (or set is_unlimited to true)' });
        }

        const numLicenses = Math.max(1, Math.min(parseInt(quantity) || 1, 100)); // Limit to 1-100

        userHasAppAccess(req.session.userId, app_id, (allowed) => {
            if (!allowed) {
                return res.status(403).json({ error: 'Access denied' });
            }

        // Check if application exists
        db.get('SELECT * FROM applications WHERE app_id = ?', [app_id], (err, app) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!app) {
            return res.status(404).json({ error: 'Application not found' });
        }

        // Check if duration_days column exists and include it in INSERT for compatibility
        db.all("PRAGMA table_info(licenses)", (err, columns) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            
            const columnNames = columns.map(col => col.name);
            const hasDurationDays = columnNames.includes('duration_days');
            
            // Calculate duration_days for backward compatibility (convert to days)
            let durationDays = null;
            if (!is_unlimited && duration_value && duration_unit) {
                switch (duration_unit) {
                    case 'seconds':
                        durationDays = Math.ceil(duration_value / (24 * 60 * 60));
                        break;
                    case 'minutes':
                        durationDays = Math.ceil(duration_value / (24 * 60));
                        break;
                    case 'hours':
                        durationDays = Math.ceil(duration_value / 24);
                        break;
                    case 'days':
                        durationDays = duration_value;
                        break;
                    default:
                        durationDays = duration_value;
                }
            }

            // Build INSERT query based on available columns
            // expires_at is NULL - will be set on first activation
            let insertQuery = 'INSERT INTO licenses (app_id, license_key, duration_value, duration_unit, is_unlimited, expires_at, created_by';
            if (hasDurationDays) {
                insertQuery += ', duration_days';
            }
            insertQuery += ') VALUES (?, ?, ?, ?, ?, ?, ?';
            if (hasDurationDays) {
                insertQuery += ', ?';
            }
            insertQuery += ')';

            const licenseKeys = [];
            let insertedCount = 0;
            let errorOccurred = false;

            // Generate multiple licenses
            const generateNextLicense = () => {
                if (insertedCount >= numLicenses || errorOccurred) {
                    if (errorOccurred) {
                        return; // Error already handled
                    }
                    // All licenses generated successfully
                    const sampleKeys = licenseKeys.slice(0, 5);
                    const keySummary = sampleKeys.length ? sampleKeys.join(', ') + (licenseKeys.length > sampleKeys.length ? ` (+${licenseKeys.length - sampleKeys.length} more)` : '') : 'N/A';
                    setImmediate(() => {
                        sendAccountWebhook(req.session.userId, {
                            title: 'License Log',
                            action: 'Generate License',
                            app_name: app ? `${app.name}${app.version ? ` (${app.version})` : ''}` : 'N/A',
                            details: `Generated ${licenseKeys.length} license(s). Keys: ${keySummary}`
                        });
                    });
                    res.json({
                        success: true,
                        license_key: numLicenses === 1 ? licenseKeys[0] : undefined,
                        license_keys: licenseKeys,
                        count: licenseKeys.length
                    });
                    return;
                }

                // Generate unique license key
                let attempts = 0;
                const maxAttempts = 10;

                const tryInsert = () => {
                    generateLicenseKey((licenseKey) => {
                        // Check if key already exists
                        db.get('SELECT license_key FROM licenses WHERE license_key = ?', [licenseKey], (checkErr, existing) => {
                            if (checkErr) {
                                errorOccurred = true;
                                return res.status(500).json({ error: checkErr.message });
                            }

                            if (existing) {
                                // Key exists, generate new one
                                attempts++;
                                if (attempts >= maxAttempts) {
                                    errorOccurred = true;
                                    return res.status(500).json({ error: 'Failed to generate unique license key after multiple attempts' });
                                }
                                tryInsert();
                                return;
                            }

                            // Key is unique, insert it
                            let insertValues = [app_id, licenseKey, duration_value || null, duration_unit || null, is_unlimited ? 1 : 0, null, req.session.userId];
                            if (hasDurationDays) {
                                insertValues.push(durationDays);
                            }

                            db.run(insertQuery, insertValues, function(insertErr) {
                                if (insertErr) {
                                    errorOccurred = true;
                                    return res.status(500).json({ error: insertErr.message });
                                }
                                licenseKeys.push(licenseKey);
                                insertedCount++;
                                // Log license generation
                                logAdminActivity(req.session.userId, 'license_generate', `Generated license for app ${app_id}`, licenseKey, app_id);
                                generateNextLicense();
                            });
                        });
                    });
                };

                tryInsert();
            };

            // Start generating licenses
            generateNextLicense();
        }); // Close db.all("PRAGMA table_info")
        }); // Close db.get('SELECT * FROM applications')
        }); // Close userHasAppAccess
    }); // Close getUserPermissions callback
});

// Get custom messages
app.get('/api/messages', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    db.all('SELECT message_key, message_value FROM custom_messages WHERE app_id = ? AND user_id = ?', ['global', req.session.userId], (err, rows) => {
        if (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
        
        const messages = {};
        rows.forEach(row => {
            messages[row.message_key] = row.message_value;
        });
        
        // Ensure all keys exist with defaults
        const defaultMessages = {
            'invalid-app-id': 'Invalid license key or application ID',
            'invalid-license': 'Invalid license key or application ID',
            'version-mismatch': 'Version mismatch. Application version {current} does not match required version {required}. Please update your application.',
            'license-banned': 'License has been banned',
            'license-paused': 'License is paused',
            'license-inactive': 'License is inactive',
            'hwid-required': 'HWID is required to activate license. Time starts counting from activation moment.',
            'hwid-mismatch': 'License is locked to different hardware',
            'license-expired': 'License has expired',
            'database-error': 'Database error',
            'missing-params': 'app_id and license_key are required'
        };
        
        Object.keys(defaultMessages).forEach(key => {
            if (!messages.hasOwnProperty(key)) {
                messages[key] = defaultMessages[key];
            }
        });
        
        if (rows.length) {
            return res.json({ success: true, messages });
        }
        db.all('SELECT message_key, message_value FROM custom_messages WHERE app_id = ? AND user_id IS NULL', ['global'], (fallbackErr, fallbackRows) => {
            if (fallbackErr) {
                return res.status(500).json({ success: false, error: fallbackErr.message });
            }
            const fallbackMessages = {};
            (fallbackRows || []).forEach(row => {
                fallbackMessages[row.message_key] = row.message_value;
            });
            Object.keys(defaultMessages).forEach(key => {
                if (!fallbackMessages.hasOwnProperty(key)) {
                    fallbackMessages[key] = defaultMessages[key];
                }
            });
            return res.json({ success: true, messages: fallbackMessages });
        });
    });
});

// Save custom messages
app.post('/api/messages', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    
    // Check permissions
    getUserPermissions(req.session.userId, (err, permissions) => {
        if (err) {
            return res.status(500).json({ success: false, error: 'Database error' });
        }
        
        if (!permissions['custom_messages']?.edit) {
            return res.status(403).json({ success: false, error: 'You do not have permission to edit custom messages' });
        }
        
        const { messages } = req.body;
        
        if (!messages || typeof messages !== 'object') {
            return res.status(400).json({ success: false, error: 'Messages object is required' });
        }
    
    const validKeys = ['invalid-app-id', 'invalid-license', 'version-mismatch', 'license-banned', 'license-inactive', 'hwid-required', 'hwid-mismatch', 'license-expired', 'license-paused', 'database-error', 'missing-params'];
    const updates = [];
    
    validKeys.forEach(key => {
        if (messages.hasOwnProperty(key)) {
            updates.push({ key, value: messages[key] });
        }
    });
    
    if (updates.length === 0) {
        return res.status(400).json({ success: false, error: 'No valid messages provided' });
    }
    
    // Use INSERT OR REPLACE to update/create messages with 'global' app_id
    const stmt = db.prepare('INSERT OR REPLACE INTO custom_messages (user_id, app_id, message_key, message_value, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)');
    
    updates.forEach(({ key, value }) => {
        stmt.run(req.session.userId, 'global', key, value);
    });
    
    stmt.finalize((err) => {
        if (err) {
            console.error('Error saving custom messages:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
        
        setImmediate(() => {
            sendAccountWebhook(req.session.userId, {
                title: 'Custom Messages Log',
                action: 'Update Custom Messages',
                details: 'Global custom messages updated'
            });
        });
        res.json({ success: true, message: 'Messages saved successfully' });
    });
    }); // Close getUserPermissions callback
});

app.post('/api/account/avatar', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { avatar_url } = req.body || {};
    const avatarValue = typeof avatar_url === 'string' ? avatar_url : '';

    db.run(
        'UPDATE users SET avatar_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [avatarValue, req.session.userId],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            return res.json({ success: true });
        }
    );
});

app.post('/api/account/delete', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = req.session.userId;
    db.serialize(() => {
        db.run('DELETE FROM user_permissions WHERE user_id = ?', [userId]);
        db.run('DELETE FROM users WHERE id = ?', [userId], function(err) {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            req.session.destroy(() => {
                return res.json({ success: true });
            });
        });
    });
});

// Logout
app.post('/api/auth/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ success: false, error: 'Failed to logout' });
        }
        return res.json({ success: true, message: 'Logged out successfully' });
    });
});

// ==================== USER MANAGEMENT API (Admin only) ====================

// Get all users
app.get('/api/admin/users', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Check if user is admin (for now, check if email is admin@admin.com)
    db.get('SELECT email FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err || !user || user.email !== 'admin@admin.com') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        
        db.all(`SELECT u.id, u.email, u.status, u.display_name, u.avatar_url, u.banned_until, u.ban_reason, u.created_at, u.updated_at
                FROM users u
                ORDER BY u.created_at DESC`, (err, users) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            
            // Get permissions for each user
            if (users.length === 0) {
                return res.json([]);
            }
            
            const userIds = users.map(u => u.id);
            const placeholders = userIds.map(() => '?').join(',');
            
            db.all(`SELECT user_id, permission_key, permission_value 
                    FROM user_permissions 
                    WHERE user_id IN (${placeholders})`, userIds, (permErr, permissions) => {
                if (permErr) {
                    return res.status(500).json({ error: 'Database error' });
                }
                
                // Group permissions by user_id
                const permissionsByUser = {};
                permissions.forEach(perm => {
                    if (!permissionsByUser[perm.user_id]) {
                        permissionsByUser[perm.user_id] = {};
                    }
                    try {
                        permissionsByUser[perm.user_id][perm.permission_key] = JSON.parse(perm.permission_value);
                    } catch (parseErr) {
                        // If parsing fails, store as string
                        permissionsByUser[perm.user_id][perm.permission_key] = perm.permission_value;
                    }
                });
                
                db.all(`SELECT user_id, app_id FROM user_app_access WHERE user_id IN (${placeholders})`, userIds, (accessErr, accessRows) => {
                    if (accessErr) {
                        return res.status(500).json({ error: 'Database error' });
                    }
                    const accessByUser = {};
                    accessRows.forEach(row => {
                        if (!accessByUser[row.user_id]) {
                            accessByUser[row.user_id] = [];
                        }
                        accessByUser[row.user_id].push(row.app_id);
                    });

                // Get license counts and app access counts for each user
                db.all(`SELECT created_by, COUNT(*) as total_licenses,
                        SUM(CASE WHEN created_at >= datetime('now', '-24 hours') THEN 1 ELSE 0 END) as keys_24h
                        FROM licenses 
                        WHERE created_by IN (${placeholders})
                        GROUP BY created_by`, userIds, (licenseErr, licenseCounts) => {
                    if (licenseErr) {
                        return res.status(500).json({ error: 'Database error' });
                    }
                    
                    const licenseCountsByUser = {};
                    licenseCounts.forEach(row => {
                        licenseCountsByUser[row.created_by] = {
                            total_licenses: row.total_licenses || 0,
                            keys_24h: row.keys_24h || 0
                        };
                    });

                    // Format users with permissions
                    const formattedUsers = users.map(user => {
                        if (user.status === 'Banned' && user.banned_until) {
                            const bannedUntilDate = new Date(user.banned_until);
                            if (!isNaN(bannedUntilDate) && bannedUntilDate <= new Date()) {
                                db.run('UPDATE users SET status = ?, banned_until = NULL, ban_reason = NULL WHERE id = ?', ['Active', user.id]);
                                user.status = 'Active';
                                user.banned_until = null;
                                user.ban_reason = null;
                            }
                        }
                        let permissions = permissionsByUser[user.id] || {};
                        if (user.email === 'admin@admin.com') {
                            permissions = buildAdminPermissions();
                        }
                        
                        const licenseData = licenseCountsByUser[user.id] || { total_licenses: 0, keys_24h: 0 };
                        const appAccessCount = (accessByUser[user.id] || []).length;
                        
                        return ({
                            id: user.id,
                            email: user.email,
                            status: user.status,
                            display_name: user.display_name || '',
                            avatar_url: user.avatar_url || '',
                            banned_until: user.banned_until || null,
                            ban_reason: user.ban_reason || '',
                            created_at: user.created_at,
                            updated_at: user.updated_at,
                            permissions,
                            app_access: accessByUser[user.id] || [],
                            total_licenses: licenseData.total_licenses,
                            keys_24h: licenseData.keys_24h,
                            app_access_count: appAccessCount
                        });
                    });
                    
                    return res.json(formattedUsers);
                });
                });
            });
        });
    });
});

// Delete all licenses for a user (admin only)
app.post('/api/admin/users/:userId/delete-all-licenses', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    db.get('SELECT email FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err || !user || user.email !== 'admin@admin.com') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        
        const userId = parseInt(req.params.userId);
        
        // Get user info for logging
        db.get('SELECT email FROM users WHERE id = ?', [userId], (userErr, targetUser) => {
            if (userErr || !targetUser) {
                return res.status(404).json({ error: 'User not found' });
            }
            
            // Delete all licenses for this user
            db.run('DELETE FROM licenses WHERE created_by = ?', [userId], function(deleteErr) {
                if (deleteErr) {
                    console.error(`[DELETE /api/admin/users/:userId/delete-all-licenses] Database error:`, deleteErr.message);
                    return res.status(500).json({ error: deleteErr.message });
                }
                
                const deletedCount = this.changes;
                
                // Log admin activity
                logAdminActivity(req.session.userId, 'delete_all_licenses', `Deleted all ${deletedCount} license(s) for user ${targetUser.email}`, null, null);
                
                res.json({ success: true, deleted_count: deletedCount, message: `Deleted ${deletedCount} license(s) successfully` });
            });
        });
    });
});

app.post('/api/admin/users/:userId/ban', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    db.get('SELECT email FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err || !user || user.email !== 'admin@admin.com') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const { userId } = req.params;
        const { duration_value, duration_unit, reason } = req.body || {};
        const durationValue = parseInt(duration_value);
        const durationUnit = duration_unit || 'days';

        if (!durationValue || durationValue <= 0) {
            return res.status(400).json({ error: 'duration_value must be greater than 0' });
        }

        const now = new Date();
        const bannedUntil = new Date(now);
        switch (durationUnit) {
            case 'hours':
                bannedUntil.setHours(bannedUntil.getHours() + durationValue);
                break;
            case 'weeks':
                bannedUntil.setDate(bannedUntil.getDate() + durationValue * 7);
                break;
            case 'months':
                bannedUntil.setMonth(bannedUntil.getMonth() + durationValue);
                break;
            case 'days':
            default:
                bannedUntil.setDate(bannedUntil.getDate() + durationValue);
                break;
        }

        db.run(
            'UPDATE users SET status = ?, banned_until = ?, ban_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            ['Banned', bannedUntil.toISOString(), reason || '', userId],
            function(updateErr) {
                if (updateErr) {
                    return res.status(500).json({ error: 'Database error' });
                }
                if (this.changes === 0) {
                    return res.status(404).json({ error: 'User not found' });
                }
                return res.json({ success: true, banned_until: bannedUntil.toISOString() });
            }
        );
    });
});

app.post('/api/admin/users/:userId/unban', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    db.get('SELECT email FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err || !user || user.email !== 'admin@admin.com') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const { userId } = req.params;
        db.run(
            'UPDATE users SET status = ?, banned_until = NULL, ban_reason = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            ['Active', userId],
            function(updateErr) {
                if (updateErr) {
                    return res.status(500).json({ error: 'Database error' });
                }
                if (this.changes === 0) {
                    return res.status(404).json({ error: 'User not found' });
                }
                return res.json({ success: true });
            }
        );
    });
});

// Warn user (admin only)
app.post('/api/admin/users/:userId/warn', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    db.get('SELECT email FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err || !user || user.email !== 'admin@admin.com') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const { userId } = req.params;
        const { reason } = req.body || {};

        if (!reason || !reason.trim()) {
            return res.status(400).json({ error: 'Reason is required' });
        }

        db.run(
            'UPDATE users SET warn_message = ?, warn_confirmed = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [reason.trim(), userId],
            function(updateErr) {
                if (updateErr) {
                    return res.status(500).json({ error: 'Database error' });
                }
                if (this.changes === 0) {
                    return res.status(404).json({ error: 'User not found' });
                }
                
                // Log admin activity
                logAdminActivity(req.session.userId, 'user_warn', `Warned user ID: ${userId} - Reason: ${reason.trim()}`, null, null, userId);
                
                return res.json({ success: true, message: 'User warned successfully' });
            }
        );
    });
});

// Confirm warn (user confirms they've seen the warning)
app.post('/api/auth/confirm-warn', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    db.run(
        'UPDATE users SET warn_confirmed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [req.session.userId],
        function(updateErr) {
            if (updateErr) {
                return res.status(500).json({ error: 'Database error' });
            }
            if (this.changes === 0) {
                return res.status(404).json({ error: 'User not found' });
            }
            return res.json({ success: true, message: 'Warning confirmed' });
        }
    );
});

// Create new user
app.post('/api/admin/users', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    db.get('SELECT email FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err || !user || user.email !== 'admin@admin.com') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        
        const { email, permissions, allowed_app_ids } = req.body;
        
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }
        
        // Check if email already exists
        db.get('SELECT id FROM users WHERE email = ?', [email], (err, existing) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (existing) {
                return res.status(400).json({ error: 'Email already exists' });
            }
            
            // Create user
            db.run('INSERT INTO users (email, status) VALUES (?, ?)', [email, 'Pending'], function(insertErr) {
                if (insertErr) {
                    return res.status(500).json({ error: 'Failed to create user' });
                }
                
                const userId = this.lastID;
                
                // Add permissions
                if (permissions && typeof permissions === 'object') {
                    const stmt = db.prepare('INSERT OR REPLACE INTO user_permissions (user_id, permission_key, permission_value) VALUES (?, ?, ?)');
                    
                    Object.keys(permissions).forEach(key => {
                        const value = permissions[key];
                        if (value !== null && value !== undefined) {
                            stmt.run([userId, key, JSON.stringify(value)]);
                        }
                    });
                    
                    stmt.finalize((finalizeErr) => {
                        if (finalizeErr) {
                            console.error('Error saving permissions:', finalizeErr);
                        }
                    });
                }
                
                if (Array.isArray(allowed_app_ids) && allowed_app_ids.length) {
                    const accessStmt = db.prepare('INSERT OR IGNORE INTO user_app_access (user_id, app_id) VALUES (?, ?)');
                    allowed_app_ids.forEach((appId) => {
                        if (appId) {
                            accessStmt.run([userId, appId]);
                        }
                    });
                    accessStmt.finalize();
                }
                
                return res.json({ success: true, userId: userId });
            });
        });
    });
});

// Update user permissions
app.post('/api/admin/users/:userId/permissions', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    db.get('SELECT email FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err || !user || user.email !== 'admin@admin.com') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        
        const userId = parseInt(req.params.userId);
        const { permissions, allowed_app_ids } = req.body;
        
        if (!permissions || typeof permissions !== 'object') {
            return res.status(400).json({ error: 'Permissions object is required' });
        }
        
        // Check if trying to save permissions for admin user
        db.get('SELECT email FROM users WHERE id = ?', [userId], (userErr, targetUser) => {
            if (userErr || !targetUser) {
                return res.status(404).json({ error: 'User not found' });
            }
            
            // Allow saving permissions for admin user (they will be stored but may be overridden by buildAdminPermissions)
            // Delete existing permissions
            db.run('DELETE FROM user_permissions WHERE user_id = ?', [userId], (deleteErr) => {
                if (deleteErr) {
                    return res.status(500).json({ error: 'Failed to update permissions' });
                }
                
                // Insert new permissions
                const stmt = db.prepare('INSERT INTO user_permissions (user_id, permission_key, permission_value) VALUES (?, ?, ?)');
                
                Object.keys(permissions).forEach(key => {
                    const value = permissions[key];
                    if (value !== null && value !== undefined) {
                        stmt.run([userId, key, JSON.stringify(value)]);
                    }
                });
                
                stmt.finalize((finalizeErr) => {
                    if (finalizeErr) {
                        return res.status(500).json({ error: 'Failed to save permissions' });
                    }
                    db.run('DELETE FROM user_app_access WHERE user_id = ?', [userId], (accessDeleteErr) => {
                        if (accessDeleteErr) {
                            return res.status(500).json({ error: 'Failed to save app access' });
                        }
                        if (Array.isArray(allowed_app_ids) && allowed_app_ids.length) {
                            const accessStmt = db.prepare('INSERT OR IGNORE INTO user_app_access (user_id, app_id) VALUES (?, ?)');
                            allowed_app_ids.forEach((appId) => {
                                if (appId) {
                                    accessStmt.run([userId, appId]);
                                }
                            });
                            accessStmt.finalize(() => {
                                return res.json({ success: true });
                            });
                        } else {
                            return res.json({ success: true });
                        }
                    });
                });
            });
        });
    });
});

// Delete user
app.delete('/api/admin/users/:userId', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    db.get('SELECT email FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err || !user || user.email !== 'admin@admin.com') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        
        const userId = parseInt(req.params.userId);
        
        if (userId === req.session.userId) {
            return res.status(400).json({ error: 'Cannot delete your own account' });
        }
        
        db.run('DELETE FROM users WHERE id = ?', [userId], (err) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to delete user' });
            }
            
            return res.json({ success: true });
        });
    });
});

// Get user license logs (admin only)
app.get('/api/admin/users/:userId/logs', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    db.get('SELECT email FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err || !user || user.email !== 'admin@admin.com') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        
        const userId = parseInt(req.params.userId);
        
        db.all(
            `SELECT l.*, a.name as app_name, a.app_id,
                    COALESCE(l.duration_value, 0) as duration_value,
                    COALESCE(l.duration_unit, 'days') as duration_unit,
                    COALESCE(l.is_unlimited, 0) as is_unlimited
             FROM licenses l
             LEFT JOIN applications a ON l.app_id = a.app_id
             WHERE l.created_by = ?
             ORDER BY l.created_at DESC`,
            [userId],
            (err, rows) => {
                if (err) {
                    return res.status(500).json({ error: 'Database error' });
                }
                res.json(rows);
            }
        );
    });
});

// Get license format configuration (admin only)
app.get('/api/admin/license-format', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    db.get('SELECT email FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err || !user || user.email !== 'admin@admin.com') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        
        db.get('SELECT format, options FROM license_format_config WHERE id = 1', (configErr, config) => {
            if (configErr) {
                return res.status(500).json({ error: configErr.message });
            }
            
            if (!config) {
                // Return default format
                return res.json({
                    format: '**********',
                    options: { bigLetters: false, digits: true, specialChars: false }
                });
            }
            
            let options = { bigLetters: false, digits: true, specialChars: false };
            try {
                if (config.options) {
                    options = JSON.parse(config.options);
                }
            } catch (parseErr) {
                console.error('Error parsing license format options:', parseErr);
            }
            
            res.json({
                format: config.format || '**********',
                options: options
            });
        });
    });
});

// Save license format configuration (admin only)
app.post('/api/admin/license-format', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    db.get('SELECT email FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err || !user || user.email !== 'admin@admin.com') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        
        const { format, options } = req.body;
        
        if (!format || typeof format !== 'string') {
            return res.status(400).json({ error: 'Format is required' });
        }
        
        // Validate format contains at least one *
        if (!format.includes('*')) {
            return res.status(400).json({ error: 'Format must contain at least one * character' });
        }
        
        const optionsJson = JSON.stringify(options || { bigLetters: false, digits: true, specialChars: false });
        
        db.run(
            'INSERT OR REPLACE INTO license_format_config (id, format, options, updated_at) VALUES (1, ?, ?, CURRENT_TIMESTAMP)',
            [format, optionsJson],
            function(updateErr) {
                if (updateErr) {
                    return res.status(500).json({ error: updateErr.message });
                }
                
                logAdminActivity(req.session.userId, 'license_format_update', `Updated license format to: ${format}`, null, null);
                
                res.json({ success: true, message: 'License format saved successfully' });
            }
        );
    });
});

// Test license format (admin only)
app.post('/api/admin/license-format/test', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    db.get('SELECT email FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err || !user || user.email !== 'admin@admin.com') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        
        const { format, options } = req.body;
        
        if (!format || typeof format !== 'string') {
            return res.status(400).json({ error: 'Format is required' });
        }
        
        // Build character set - always start with base set (lowercase letters + digits)
        // Checkboxes ADD additional character types (include, not only)
        let chars = 'abcdefghijklmnopqrstuvwxyz0123456789'; // Base set - always included
        
        // Add uppercase letters if option is enabled
        if (options?.bigLetters === true) {
            chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        }
        
        // Digits are always included in base set, so no need to check
        
        // Add special characters if option is enabled
        if (options?.specialChars === true) {
            chars += '!@#$%^&*';
        }
        
        // Generate test license key
        let testKey = '';
        const randomBytes = crypto.randomBytes(format.length);
        
        for (let i = 0; i < format.length; i++) {
            if (format[i] === '*') {
                const randomIndex = randomBytes[i] % chars.length;
                testKey += chars[randomIndex];
            } else {
                testKey += format[i];
            }
        }
        
        res.json({ success: true, test_key: testKey });
    });
});

// Get activity logs (admin only)
app.get('/api/admin/logs', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    isAdminUser(req.session.userId, (isAdmin) => {
        if (!isAdmin) {
            return res.status(403).json({ error: 'Admin access required' });
        }
        
        db.all(
            'SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT 500',
            [],
            (err, logs) => {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                res.json(logs);
            }
        );
    });
});

// Admin license actions - ban by license key
app.post('/api/licenses/:licenseKey/ban', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    isAdminUser(req.session.userId, (isAdmin) => {
        if (!isAdmin) {
            return res.status(403).json({ error: 'Admin access required' });
        }
        
        const { licenseKey } = req.params;
        
        db.get('SELECT l.app_id, a.name as app_name FROM licenses l LEFT JOIN applications a ON l.app_id = a.app_id WHERE l.license_key = ?', [licenseKey], (infoErr, info) => {
            if (infoErr || !info) {
                return res.status(404).json({ error: 'License not found' });
            }
            
            db.run('UPDATE licenses SET is_banned = 1 WHERE license_key = ?', [licenseKey], function(err) {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                if (this.changes === 0) {
                    return res.status(404).json({ error: 'License not found' });
                }
                logAdminActivity(req.session.userId, 'license_ban', `Banned license`, licenseKey, info?.app_id);
                res.json({ success: true, message: 'License banned' });
            });
        });
    });
});

// Admin license actions - unban by license key
app.post('/api/licenses/:licenseKey/unban', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    isAdminUser(req.session.userId, (isAdmin) => {
        if (!isAdmin) {
            return res.status(403).json({ error: 'Admin access required' });
        }
        
        const { licenseKey } = req.params;
        
        db.get('SELECT l.app_id, a.name as app_name FROM licenses l LEFT JOIN applications a ON l.app_id = a.app_id WHERE l.license_key = ?', [licenseKey], (infoErr, info) => {
            if (infoErr || !info) {
                return res.status(404).json({ error: 'License not found' });
            }
            
            db.run('UPDATE licenses SET is_banned = 0 WHERE license_key = ?', [licenseKey], function(err) {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                if (this.changes === 0) {
                    return res.status(404).json({ error: 'License not found' });
                }
                logAdminActivity(req.session.userId, 'license_unban', `Unbanned license`, licenseKey, info?.app_id);
                res.json({ success: true, message: 'License unbanned' });
            });
        });
    });
});

// Admin license actions - extend by license key
app.post('/api/licenses/:licenseKey/extend', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    getUserPermissions(req.session.userId, (err, permissions) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        // Check if user is admin or has extend permission
        isAdminUser(req.session.userId, (isAdmin) => {
            if (!isAdmin && !permissions['licenses']?.extend) {
                return res.status(403).json({ error: 'You do not have permission to extend licenses' });
            }
            
            const { licenseKey } = req.params;
            const { duration_value, duration_unit } = req.body;
            
            if (!duration_value || !duration_unit) {
                return res.status(400).json({ error: 'duration_value and duration_unit are required' });
            }
            
            const query = isAdmin 
                ? 'SELECT expires_at, is_unlimited FROM licenses WHERE license_key = ?'
                : 'SELECT expires_at, is_unlimited FROM licenses WHERE license_key = ? AND created_by = ?';
            const params = isAdmin ? [licenseKey] : [licenseKey, req.session.userId];
            
            db.get(query, params, (err, license) => {
                if (err || !license) {
                    return res.status(404).json({ error: 'License not found' });
                }
                
                if (license.is_unlimited === 1) {
                    return res.status(400).json({ error: 'Cannot extend unlimited license' });
                }
                
                // Check if license is expired - cannot extend expired licenses
                const now = new Date();
                if (license.expires_at) {
                    const currentExpires = new Date(license.expires_at);
                    if (currentExpires <= now) {
                        return res.status(400).json({ error: 'Cannot extend expired license' });
                    }
                }
                
                let newExpiresAt;
                if (license.expires_at) {
                    const currentExpires = new Date(license.expires_at);
                    const additionalTime = calculateExpirationDate(parseInt(duration_value), duration_unit, false);
                    newExpiresAt = new Date(currentExpires.getTime() + (additionalTime.getTime() - new Date().getTime()));
                } else {
                    newExpiresAt = calculateExpirationDate(parseInt(duration_value), duration_unit, false);
                }
                
                const updateQuery = isAdmin
                    ? 'UPDATE licenses SET expires_at = ? WHERE license_key = ?'
                    : 'UPDATE licenses SET expires_at = ? WHERE license_key = ? AND created_by = ?';
                const updateParams = isAdmin 
                    ? [newExpiresAt.toISOString(), licenseKey]
                    : [newExpiresAt.toISOString(), licenseKey, req.session.userId];
                
                db.run(updateQuery, updateParams, function(updateErr) {
                    if (updateErr) {
                        return res.status(500).json({ error: updateErr.message });
                    }
                    if (this.changes === 0) {
                        return res.status(404).json({ error: 'License not found' });
                    }
                    res.json({ success: true });
                });
            });
        });
    });
});

// Admin license actions - reset HWID by license key
app.post('/api/licenses/:licenseKey/reset-hwid', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    isAdminUser(req.session.userId, (isAdmin) => {
        if (!isAdmin) {
            return res.status(403).json({ error: 'Admin access required' });
        }
        
        const { licenseKey } = req.params;
        
        db.get('SELECT l.app_id, a.name as app_name FROM licenses l LEFT JOIN applications a ON l.app_id = a.app_id WHERE l.license_key = ?', [licenseKey], (infoErr, info) => {
            if (infoErr || !info) {
                return res.status(404).json({ error: 'License not found' });
            }
            
            db.run('UPDATE licenses SET locked_hwid = NULL WHERE license_key = ?', [licenseKey], function(err) {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                if (this.changes === 0) {
                    return res.status(404).json({ error: 'License not found' });
                }
                
                // Clear cached HWID usage
                db.run('DELETE FROM license_usage WHERE license_key = ?', [licenseKey], (usageErr) => {
                    if (usageErr) {
                        console.error('[Admin Reset HWID] Error clearing license usage:', usageErr);
                    }
                    res.json({ success: true, message: 'HWID reset successfully' });
                });
            });
        });
    });
});

// Get dashboard stats
app.get('/api/admin/stats', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    db.get('SELECT email FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err || !user || user.email !== 'admin@admin.com') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        
        // Get total users
        db.get('SELECT COUNT(*) as count FROM users', (err1, usersResult) => {
            if (err1) {
                return res.status(500).json({ error: 'Database error' });
            }
            
            // Get total licenses
            db.get('SELECT COUNT(*) as count FROM licenses', (err2, licensesResult) => {
                if (err2) {
                    return res.status(500).json({ error: 'Database error' });
                }
                
                // Get total applications
                db.get('SELECT COUNT(*) as count FROM applications', (err3, appsResult) => {
                    if (err3) {
                        return res.status(500).json({ error: 'Database error' });
                    }
                    
                    // Get total banned licenses
                    db.get('SELECT COUNT(*) as count FROM licenses WHERE is_banned = 1', (err4, bannedResult) => {
                        if (err4) {
                            return res.status(500).json({ error: 'Database error' });
                        }
                        
                        return res.json({
                            totalUsers: usersResult.count,
                            totalLicenses: licensesResult.count,
                            totalApplications: appsResult.count,
                            totalBannedLicenses: bannedResult.count
                        });
                    });
                });
            });
        });
    });
});

// Pause all active licenses for an application
app.post('/api/applications/:app_id/pause-all', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    getUserPermissions(req.session.userId, (err, permissions) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        // Check if user is admin or has pause permission
        isAdminUser(req.session.userId, (isAdmin) => {
            if (!isAdmin && !permissions['licenses']?.pause) {
                return res.status(403).json({ error: 'You do not have permission to pause licenses' });
            }
            
            const { app_id } = req.params;
            const now = new Date();
            
            // Pause all active, non-banned, non-expired, non-paused licenses for this app
            // Only active licenses (not banned, not expired) can be paused
            db.run(
                `UPDATE licenses 
                 SET is_paused = 1, paused_at = ?, paused_expires_at = expires_at 
                 WHERE app_id = ? 
                 AND is_active = 1 
                 AND is_banned = 0 
                 AND is_paused = 0 
                 AND (expires_at > ? OR is_unlimited = 1)`,
                [now.toISOString(), app_id, now.toISOString()],
                function(updateErr) {
                    if (updateErr) {
                        return res.status(500).json({ error: updateErr.message });
                    }
                    res.json({ success: true, count: this.changes });
                }
            );
        });
    });
});

// Unpause all paused licenses for an application
app.post('/api/applications/:app_id/unpause-all', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    getUserPermissions(req.session.userId, (err, permissions) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        // Check if user is admin or has pause permission
        isAdminUser(req.session.userId, (isAdmin) => {
            if (!isAdmin && !permissions['licenses']?.pause) {
                return res.status(403).json({ error: 'You do not have permission to unpause licenses' });
            }
            
            const { app_id } = req.params;
        
        db.all(
            `SELECT license_key, paused_expires_at, paused_at, expires_at FROM licenses 
             WHERE app_id = ? AND is_paused = 1`,
            [app_id],
            (err, licenses) => {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                
                let updatedCount = 0;
                let updateIndex = 0;
                
                if (licenses.length === 0) {
                    return res.json({ success: true, count: 0 });
                }
                
                licenses.forEach(license => {
                    // Calculate time paused and add it to expires_at
                    let newExpiresAt = null;
                    if (license.paused_expires_at) {
                        const pausedExpires = new Date(license.paused_expires_at);
                        const pausedAt = license.paused_at ? new Date(license.paused_at) : new Date();
                        const now = new Date();
                        const pausedDuration = now.getTime() - pausedAt.getTime(); // Time in milliseconds
                        newExpiresAt = new Date(pausedExpires.getTime() + pausedDuration);
                    } else if (license.expires_at) {
                        newExpiresAt = new Date(license.expires_at);
                    }
                    
                    db.run(
                        'UPDATE licenses SET is_paused = 0, paused_at = NULL, paused_expires_at = NULL, expires_at = ? WHERE license_key = ?',
                        [newExpiresAt ? newExpiresAt.toISOString() : null, license.license_key],
                        function(updateErr) {
                            if (!updateErr) {
                                updatedCount++;
                            }
                            updateIndex++;
                            if (updateIndex === licenses.length) {
                                res.json({ success: true, count: updatedCount });
                            }
                        }
                    );
                });
            }
        );
    });
});

// Extend all active licenses for an application
app.post('/api/applications/:app_id/extend-all', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    getUserPermissions(req.session.userId, (err, permissions) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!permissions['licenses']?.extend) {
            return res.status(403).json({ error: 'You do not have permission to extend licenses' });
        }
        
        const { app_id } = req.params;
        const { duration_value, duration_unit } = req.body;
        
        if (!duration_value || !duration_unit) {
            return res.status(400).json({ error: 'duration_value and duration_unit are required' });
        }
        
        const now = new Date();
        
        // Get all active, non-expired licenses for this app
        db.all(
            `SELECT license_key, expires_at, is_unlimited FROM licenses 
             WHERE app_id = ? AND is_active = 1 AND is_banned = 0 AND is_unlimited = 0 AND (expires_at > ? OR expires_at IS NULL)`,
            [app_id, now.toISOString()],
            (err, licenses) => {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                
                let updatedCount = 0;
                let updateIndex = 0;
                
                if (licenses.length === 0) {
                    return res.json({ success: true, count: 0 });
                }
                
                licenses.forEach(license => {
                    // Double check - skip expired licenses
                    if (license.expires_at) {
                        const currentExpires = new Date(license.expires_at);
                        if (currentExpires <= now) {
                            updateIndex++;
                            if (updateIndex === licenses.length) {
                                res.json({ success: true, count: updatedCount });
                            }
                            return; // Skip expired license
                        }
                    }
                    
                    let newExpiresAt;
                    if (license.expires_at) {
                        const currentExpires = new Date(license.expires_at);
                        const additionalTime = calculateExpirationDate(parseInt(duration_value), duration_unit, false);
                        newExpiresAt = new Date(currentExpires.getTime() + (additionalTime.getTime() - new Date().getTime()));
                    } else {
                        newExpiresAt = calculateExpirationDate(parseInt(duration_value), duration_unit, false);
                    }
                    
                    db.run(
                        'UPDATE licenses SET expires_at = ? WHERE license_key = ?',
                        [newExpiresAt.toISOString(), license.license_key],
                        function(updateErr) {
                            if (!updateErr) {
                                updatedCount++;
                            }
                            updateIndex++;
                            if (updateIndex === licenses.length) {
                                res.json({ success: true, count: updatedCount });
                            }
                        }
                    );
                });
            }
        );
    });
});

// Pause all active licenses (all applications)
app.post('/api/licenses/pause-all', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    getUserPermissions(req.session.userId, (err, permissions) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        // Check if user is admin or has pause permission
        isAdminUser(req.session.userId, (isAdmin) => {
            if (!isAdmin && !permissions['licenses']?.pause) {
                return res.status(403).json({ error: 'You do not have permission to pause licenses' });
            }
            
            const now = new Date();
            
            // Pause all active, non-banned, non-expired, non-paused licenses
            // Only active licenses (not banned, not expired) can be paused
            // Admin can pause all licenses, regular users only their own
            const whereClause = isAdmin 
                ? `WHERE is_active = 1 AND is_banned = 0 AND is_paused = 0 AND (expires_at > ? OR is_unlimited = 1)`
                : `WHERE is_active = 1 AND is_banned = 0 AND is_paused = 0 AND (expires_at > ? OR is_unlimited = 1) AND created_by = ?`;
            const params = isAdmin 
                ? [now.toISOString(), now.toISOString()]
                : [now.toISOString(), now.toISOString(), req.session.userId];
            
            db.run(
                `UPDATE licenses 
                 SET is_paused = 1, paused_at = ?, paused_expires_at = expires_at 
                 ${whereClause}`,
                params,
                function(updateErr) {
                    if (updateErr) {
                        return res.status(500).json({ error: updateErr.message });
                    }
                    res.json({ success: true, count: this.changes });
                }
            );
        });
    });
});

// Unpause all paused licenses (all applications)
app.post('/api/licenses/unpause-all', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    getUserPermissions(req.session.userId, (err, permissions) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        // Check if user is admin or has pause permission
        isAdminUser(req.session.userId, (isAdmin) => {
            if (!isAdmin && !permissions['licenses']?.pause) {
                return res.status(403).json({ error: 'You do not have permission to unpause licenses' });
            }
            
            // Admin can unpause all licenses, regular users only their own
            const whereClause = isAdmin 
                ? `WHERE is_paused = 1`
                : `WHERE is_paused = 1 AND created_by = ?`;
            const params = isAdmin ? [] : [req.session.userId];
            
            db.all(
                `SELECT license_key, paused_expires_at, paused_at, expires_at FROM licenses 
                 ${whereClause}`,
                params,
                (err, licenses) => {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                
                let updatedCount = 0;
                let updateIndex = 0;
                
                if (licenses.length === 0) {
                    return res.json({ success: true, count: 0 });
                }
                
                licenses.forEach(license => {
                    // Calculate time paused and add it to expires_at
                    let newExpiresAt = null;
                    if (license.paused_expires_at) {
                        const pausedExpires = new Date(license.paused_expires_at);
                        const pausedAt = license.paused_at ? new Date(license.paused_at) : new Date();
                        const now = new Date();
                        const pausedDuration = now.getTime() - pausedAt.getTime(); // Time in milliseconds
                        newExpiresAt = new Date(pausedExpires.getTime() + pausedDuration);
                    } else if (license.expires_at) {
                        newExpiresAt = new Date(license.expires_at);
                    }
                    
                    const updateWhereClause = isAdmin 
                        ? 'WHERE license_key = ?'
                        : 'WHERE license_key = ? AND created_by = ?';
                    const updateParams = isAdmin 
                        ? [newExpiresAt ? newExpiresAt.toISOString() : null, license.license_key]
                        : [newExpiresAt ? newExpiresAt.toISOString() : null, license.license_key, req.session.userId];
                    
                    db.run(
                        `UPDATE licenses SET is_paused = 0, paused_at = NULL, paused_expires_at = NULL, expires_at = ? ${updateWhereClause}`,
                        updateParams,
                        function(updateErr) {
                            if (!updateErr) {
                                updatedCount++;
                            }
                            updateIndex++;
                            if (updateIndex === licenses.length) {
                                res.json({ success: true, count: updatedCount });
                            }
                        }
                    );
                });
            });
        });
    });
});
});

// Extend all active licenses (all applications)
app.post('/api/licenses/extend-all', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    getUserPermissions(req.session.userId, (err, permissions) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!permissions['licenses']?.extend) {
            return res.status(403).json({ error: 'You do not have permission to extend licenses' });
        }
        
        const { duration_value, duration_unit } = req.body;
        
        if (!duration_value || !duration_unit) {
            return res.status(400).json({ error: 'duration_value and duration_unit are required' });
        }
        
        const now = new Date();
        
        db.all(
            `SELECT license_key, expires_at, is_unlimited FROM licenses 
             WHERE is_active = 1 AND is_banned = 0 AND is_unlimited = 0 AND (expires_at > ? OR expires_at IS NULL) AND created_by = ?`,
            [now.toISOString(), req.session.userId],
            (err, licenses) => {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                
                let updatedCount = 0;
                let updateIndex = 0;
                
                if (licenses.length === 0) {
                    return res.json({ success: true, count: 0 });
                }
                
                licenses.forEach(license => {
                    // Double check - skip expired licenses
                    if (license.expires_at) {
                        const currentExpires = new Date(license.expires_at);
                        if (currentExpires <= now) {
                            updateIndex++;
                            if (updateIndex === licenses.length) {
                                res.json({ success: true, count: updatedCount });
                            }
                            return; // Skip expired license
                        }
                    }
                    
                    let newExpiresAt;
                    if (license.expires_at) {
                        const currentExpires = new Date(license.expires_at);
                        const additionalTime = calculateExpirationDate(parseInt(duration_value), duration_unit, false);
                        newExpiresAt = new Date(currentExpires.getTime() + (additionalTime.getTime() - new Date().getTime()));
                    } else {
                        newExpiresAt = calculateExpirationDate(parseInt(duration_value), duration_unit, false);
                    }
                    
                    db.run(
                        'UPDATE licenses SET expires_at = ? WHERE license_key = ?',
                        [newExpiresAt.toISOString(), license.license_key],
                        function(updateErr) {
                            if (!updateErr) {
                                updatedCount++;
                            }
                            updateIndex++;
                            if (updateIndex === licenses.length) {
                                res.json({ success: true, count: updatedCount });
                            }
                        }
                    );
                });
            }
        );
    });
});

// Pause single license
app.post('/api/licenses/:licenseKey/pause', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    getUserPermissions(req.session.userId, (err, permissions) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        // Check if user is admin or has pause permission
        isAdminUser(req.session.userId, (isAdmin) => {
            if (!isAdmin && !permissions['licenses']?.pause) {
                return res.status(403).json({ error: 'You do not have permission to pause licenses' });
            }
            
            const { licenseKey } = req.params;
            const now = new Date();
            
            // Admin can pause any license, regular users only their own
            const query = isAdmin 
                ? 'SELECT expires_at, is_active, is_banned, is_unlimited FROM licenses WHERE license_key = ?'
                : 'SELECT expires_at, is_active, is_banned, is_unlimited FROM licenses WHERE license_key = ? AND created_by = ?';
            const params = isAdmin ? [licenseKey] : [licenseKey, req.session.userId];
            
            db.get(query, params, (err, license) => {
                if (err || !license) {
                    return res.status(404).json({ error: 'License not found' });
                }
                
                // Only active licenses (not banned, not expired) can be paused
                if (license.is_active !== 1) {
                    return res.status(400).json({ error: 'Only active licenses can be paused' });
                }
                
                if (license.is_banned === 1) {
                    return res.status(400).json({ error: 'Banned licenses cannot be paused' });
                }
                
                // Check if license is expired (unless unlimited)
                if (license.is_unlimited !== 1 && license.expires_at) {
                    const expiresAt = new Date(license.expires_at);
                    if (expiresAt <= now) {
                        return res.status(400).json({ error: 'Expired licenses cannot be paused' });
                    }
                }
                
                const updateQuery = isAdmin 
                    ? 'UPDATE licenses SET is_paused = 1, paused_at = ?, paused_expires_at = expires_at WHERE license_key = ?'
                    : 'UPDATE licenses SET is_paused = 1, paused_at = ?, paused_expires_at = expires_at WHERE license_key = ? AND created_by = ?';
                const updateParams = isAdmin 
                    ? [now.toISOString(), licenseKey]
                    : [now.toISOString(), licenseKey, req.session.userId];
                
                db.run(updateQuery, updateParams, function(updateErr) {
                    if (updateErr) {
                        return res.status(500).json({ error: updateErr.message });
                    }
                    if (this.changes === 0) {
                        return res.status(404).json({ error: 'License not found' });
                    }
                    logAdminActivity(req.session.userId, 'license_pause', `Paused license`, licenseKey, license?.app_id);
                    res.json({ success: true });
                });
            });
        });
    });
});

// Unpause single license
app.post('/api/licenses/:licenseKey/unpause', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    getUserPermissions(req.session.userId, (err, permissions) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        // Check if user is admin or has pause permission
        isAdminUser(req.session.userId, (isAdmin) => {
            if (!isAdmin && !permissions['licenses']?.pause) {
                return res.status(403).json({ error: 'You do not have permission to unpause licenses' });
            }
            
            const { licenseKey } = req.params;
            
            // Admin can unpause any license, regular users only their own
            const query = isAdmin 
                ? 'SELECT paused_expires_at, paused_at, expires_at FROM licenses WHERE license_key = ?'
                : 'SELECT paused_expires_at, paused_at, expires_at FROM licenses WHERE license_key = ? AND created_by = ?';
            const params = isAdmin ? [licenseKey] : [licenseKey, req.session.userId];
            
            db.get(query, params, (err, license) => {
                if (err || !license) {
                    return res.status(404).json({ error: 'License not found' });
                }
                
                // Calculate time paused and add it to expires_at
                // When paused, we saved the original expires_at to paused_expires_at
                // Now we add the paused duration to the original expiration time
                let newExpiresAt = null;
                if (license.paused_expires_at) {
                    const pausedExpires = new Date(license.paused_expires_at);
                    const pausedAt = license.paused_at ? new Date(license.paused_at) : new Date();
                    const now = new Date();
                    const pausedDuration = now.getTime() - pausedAt.getTime(); // Time in milliseconds
                    newExpiresAt = new Date(pausedExpires.getTime() + pausedDuration);
                } else if (license.expires_at) {
                    newExpiresAt = new Date(license.expires_at);
                }
                
                const updateQuery = isAdmin 
                    ? 'UPDATE licenses SET is_paused = 0, paused_at = NULL, paused_expires_at = NULL, expires_at = ? WHERE license_key = ?'
                    : 'UPDATE licenses SET is_paused = 0, paused_at = NULL, paused_expires_at = NULL, expires_at = ? WHERE license_key = ? AND created_by = ?';
                const updateParams = isAdmin 
                    ? [newExpiresAt ? newExpiresAt.toISOString() : null, licenseKey]
                    : [newExpiresAt ? newExpiresAt.toISOString() : null, licenseKey, req.session.userId];
                
                db.run(updateQuery, updateParams, function(updateErr) {
                    if (updateErr) {
                        return res.status(500).json({ error: updateErr.message });
                    }
                    if (this.changes === 0) {
                        return res.status(404).json({ error: 'License not found' });
                    }
                    res.json({ success: true });
                });
            });
        });
    });
});

// Fallback for unknown API routes (avoid HTML 404 in the client)
app.use('/api', (req, res) => {
    res.status(404).json({ error: 'API route not found', path: req.originalUrl });
});

// Static files (must be after all API routes to avoid conflicts)
// Use absolute path for Vercel compatibility
const authPath = path.join(__dirname, 'auth');
app.use(express.static(authPath));
app.use('/new-theme', express.static(path.join(authPath, 'new-theme')));

// Only start server if not in Vercel (serverless environment)
if (!process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`Auth server running on http://localhost:${PORT}`);
    });

    // Graceful shutdown
    process.on('SIGINT', () => {
        db.close((err) => {
            if (err) {
                console.error(err.message);
            }
            console.log('Database connection closed.');
            process.exit(0);
        });
    });
}

// Export app for Vercel serverless functions
module.exports = app;

