// server.js

// Load .env only for local development
if (!process.env.RAILWAY_ENVIRONMENT && process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config();
  } catch (_) {}
}

const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();

// If you later set secure cookies behind Railway HTTPS proxy, keep this:
app.set('trust proxy', 1);

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Session (use env secret for deployment)
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dom_databank_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false // can set true later if you want strict HTTPS cookies
    }
  })
);

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// ✅ Uploads path (Railway/Render-friendly)
// If you later add a volume/storage path, set UPLOAD_ROOT in Railway variables.
// Otherwise it will use local ./uploads
const UPLOAD_ROOT = process.env.UPLOAD_ROOT || path.join(__dirname, 'uploads');
app.use('/uploads', express.static(UPLOAD_ROOT));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ROUTES
app.use('/', require('./routes/auth.routes'));
app.use('/', require('./routes/admin.routes'));

// ✅ File routes: keep existing behaviour AND support /files/search
const fileRoutes = require('./routes/file.routes');
app.use('/', fileRoutes);
app.use('/files', fileRoutes);

app.use('/', require('./routes/folder.routes'));

// ✅ Start server using Railway assigned PORT
const PORT = process.env.PORT || 5500;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
