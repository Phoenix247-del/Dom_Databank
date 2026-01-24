// server.js

// Load .env only in local development
if (!process.env.RAILWAY_ENVIRONMENT && process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config();
  } catch (_) {}
}

const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const app = express();

/* ================= MIDDLEWARE ================= */

// Required when running behind Railway proxy
app.set('trust proxy', 1);

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ================= SESSION ================= */

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dom_databank_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false // keep false unless you enable HTTPS-only cookies
    }
  })
);

/* ================= STATIC FILES ================= */

app.use(express.static(path.join(__dirname, 'public')));

/* ================= UPLOADS (PERSISTENT STORAGE) ================= */

// Railway volume mount (recommended): /data
const UPLOAD_ROOT = process.env.UPLOAD_ROOT || path.join(__dirname, 'uploads');
const DOCS_DIR = path.join(UPLOAD_ROOT, 'documents');

// Ensure folders exist (important on fresh deploy)
if (!fs.existsSync(DOCS_DIR)) {
  fs.mkdirSync(DOCS_DIR, { recursive: true });
}

// Serve uploaded files
app.use('/uploads', express.static(UPLOAD_ROOT));

/* ================= VIEW ENGINE ================= */

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

/* ================= HEALTH ROUTES ================= */

// Railway health check
app.get('/health', (req, res) => res.status(200).send('OK'));

// Root redirect
app.get('/', (req, res) => res.redirect('/login'));

/* ================= ROUTES ================= */

app.use('/', require('./routes/auth.routes'));
app.use('/', require('./routes/admin.routes'));

// File routes
const fileRoutes = require('./routes/file.routes');
app.use('/', fileRoutes);
app.use('/files', fileRoutes);

// Folder routes
app.use('/', require('./routes/folder.routes'));

/* ================= CRASH SAFETY ================= */

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
});

/* ================= START SERVER ================= */

const PORT = Number(process.env.PORT || 5500);

// IMPORTANT: bind to 0.0.0.0 so Railway detects open port
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
