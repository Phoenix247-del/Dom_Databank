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
app.set('trust proxy', 1);

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
      secure: false
    }
  })
);

/* ================= STATIC FILES ================= */
app.use(express.static(path.join(__dirname, 'public')));

/* ================= UPLOADS (PERSISTENT STORAGE) ================= */
const UPLOAD_ROOT = process.env.UPLOAD_ROOT || path.join(__dirname, 'uploads');
const DOCS_DIR = path.join(UPLOAD_ROOT, 'documents');

if (!fs.existsSync(DOCS_DIR)) {
  fs.mkdirSync(DOCS_DIR, { recursive: true });
}

app.use('/uploads', express.static(UPLOAD_ROOT));

/* ================= VIEW ENGINE ================= */
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

/* ================= HEALTH ROUTES ================= */
// ✅ Root returns 200 (helps default platform health checks)
app.get('/', (req, res) => res.status(200).send('Dom Databank is running'));

// ✅ Dedicated health endpoint
app.get('/health', (req, res) => res.status(200).send('OK'));

/* ================= ROUTES ================= */
app.use('/', require('./routes/auth.routes'));
app.use('/', require('./routes/admin.routes'));

const fileRoutes = require('./routes/file.routes');
app.use('/', fileRoutes);
app.use('/files', fileRoutes);

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

// IMPORTANT: bind to 0.0.0.0 so Railway can route traffic
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

/* ================= GRACEFUL SHUTDOWN (fixes scary SIGTERM npm error) ================= */
function shutdown(signal) {
  console.log(`🛑 Received ${signal}. Closing server gracefully...`);
  server.close(() => {
    console.log('✅ HTTP server closed. Exiting cleanly.');
    process.exit(0); // Exit 0 so npm doesn't show it as an error
  });

  // Force exit if something is hanging
  setTimeout(() => {
    console.log('⚠️ Forced shutdown after timeout.');
    process.exit(0);
  }, 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
