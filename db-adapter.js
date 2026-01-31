// Database adapter - uses @libsql/client in Vercel, sqlite3 locally
const isVercel = process.env.VERCEL;

let db;

if (isVercel) {
    // Use LibSQL in Vercel (no native modules)
    const { createClient } = require('@libsql/client');
    
    // For Vercel, use in-memory or file-based SQLite
    // You can also use Turso cloud database by setting LIBSQL_URL and LIBSQL_AUTH_TOKEN
    const libsqlUrl = process.env.LIBSQL_URL || 'file:/tmp/auth.db';
    const libsqlAuthToken = process.env.LIBSQL_AUTH_TOKEN;
    
    const client = createClient({
        url: libsqlUrl,
        authToken: libsqlAuthToken
    });
    
    // Create adapter that mimics sqlite3 API
    db = {
        client: client,
        
        // Convert callback-based API to match sqlite3
        run: function(sql, params, callback) {
            if (typeof params === 'function') {
                callback = params;
                params = [];
            }
            if (!params) params = [];
            
            (async () => {
                try {
                    const result = await client.execute({
                        sql: sql,
                        args: params
                    });
                    
                    if (callback) {
                        callback(null, {
                            changes: result.rowsAffected || 0,
                            lastID: result.lastInsertRowid || 0
                        });
                    }
                } catch (err) {
                    if (callback) callback(err);
                }
            })();
        },
        
        get: function(sql, params, callback) {
            if (typeof params === 'function') {
                callback = params;
                params = [];
            }
            if (!params) params = [];
            
            (async () => {
                try {
                    const result = await client.execute({
                        sql: sql,
                        args: params
                    });
                    
                    const row = result.rows.length > 0 ? result.rows[0] : null;
                    // Convert LibSQL row format to object
                    let rowObj = null;
                    if (row) {
                        rowObj = {};
                        for (let i = 0; i < result.columns.length; i++) {
                            const col = result.columns[i];
                            const colName = typeof col === 'string' ? col : col.name;
                            rowObj[colName] = row[i];
                        }
                    }
                    
                    if (callback) callback(null, rowObj);
                } catch (err) {
                    if (callback) callback(err);
                }
            })();
        },
        
        all: function(sql, params, callback) {
            if (typeof params === 'function') {
                callback = params;
                params = [];
            }
            if (!params) params = [];
            
            (async () => {
                try {
                    const result = await client.execute({
                        sql: sql,
                        args: params
                    });
                    
                    // Convert LibSQL rows to array of objects
                    const rows = result.rows.map(row => {
                        const obj = {};
                        for (let i = 0; i < result.columns.length; i++) {
                            const col = result.columns[i];
                            const colName = typeof col === 'string' ? col : col.name;
                            obj[colName] = row[i];
                        }
                        return obj;
                    });
                    
                    if (callback) callback(null, rows);
                } catch (err) {
                    if (callback) callback(err);
                }
            })();
        },
        
        serialize: function(callback) {
            // LibSQL doesn't have serialize, just execute callback
            if (callback) callback();
        },

        prepare: function(sql) {
            // Minimal prepare shim for LibSQL to support stmt.run(...)
            return {
                run: function(params, callback) {
                    if (typeof params === 'function') {
                        callback = params;
                        params = [];
                    }
                    if (!params) params = [];
                    (async () => {
                        try {
                            const result = await client.execute({
                                sql: sql,
                                args: params
                            });
                            if (callback) {
                                callback(null, {
                                    changes: result.rowsAffected || 0,
                                    lastID: result.lastInsertRowid || 0
                                });
                            }
                        } catch (err) {
                            if (callback) callback(err);
                        }
                    })();
                },
                finalize: function(callback) {
                    if (callback) callback(null);
                }
            };
        },
        
        close: function(callback) {
            (async () => {
                try {
                    await client.close();
                    if (callback) callback(null);
                } catch (err) {
                    if (callback) callback(err);
                }
            })();
        }
    };
    
    console.log('[DB] Using LibSQL client for Vercel');
} else {
    // Use sqlite3 locally
    const sqlite3 = require('sqlite3').verbose();
    const dbPath = './auth.db';
    
    db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
            console.error('[DB] Error opening database:', err.message);
        } else {
            console.log(`[DB] Connected to SQLite database at ${dbPath}`);
            // Emit ready event for compatibility
            if (typeof db.emit === 'function') {
                db.emit('ready');
            }
        }
    });
    
    console.log('[DB] Using sqlite3 for local development');
}

module.exports = db;

