// config/db.js
// ✅ Works on Railway Pro (internal MySQL) + local XAMPP
// ✅ Avoids silently falling back to localhost in production

// Load .env only for local development
if (!process.env.RAILWAY_ENVIRONMENT && process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config();
  } catch (_) {}
}

const mysql = require('mysql2');

const isProd = !!process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production';

// In production (Railway), do NOT default to localhost silently.
// If DB_HOST is missing, we want to see it clearly in logs.
const host = isProd ? process.env.DB_HOST : (process.env.DB_HOST || 'localhost');
const port = Number(process.env.DB_PORT || 3306);
const user = process.env.DB_USER || 'root';
const password = process.env.DB_PASSWORD || '';
const database = process.env.DB_NAME || 'dom_databank';

const db = mysql.createPool({
  host,
  port,
  user,
  password,
  database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 20000
});

db.getConnection((err, connection) => {
  if (err) {
    console.error('❌ MySQL connection failed (full):', err);
    console.error('🔎 DB ENV CHECK:', {
      DB_HOST: process.env.DB_HOST,
      DB_PORT: process.env.DB_PORT,
      DB_USER: process.env.DB_USER,
      DB_NAME: process.env.DB_NAME,
      // Do not print DB_PASSWORD
      RAILWAY_ENVIRONMENT: process.env.RAILWAY_ENVIRONMENT || null,
      NODE_ENV: process.env.NODE_ENV || null
    });
  } else {
    console.log('✅ MySQL connected successfully:', {
      host,
      port,
      database
    });
    connection.release();
  }
});

module.exports = db;
