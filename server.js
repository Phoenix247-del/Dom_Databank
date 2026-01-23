const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ If you later set cookie.secure=true on Render, enable this:
// app.set('trust proxy', 1);

// ✅ Session (use env secret for deployment)
app.use(session({
  secret: process.env.SESSION_SECRET || 'dom_databank_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false
  }
}));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// ✅ Serve uploaded files from Persistent Disk if configured, else local fallback
const UPLOAD_ROOT = process.env.UPLOAD_ROOT || path.join(__dirname, 'uploads');
app.use('/uploads', express.static(UPLOAD_ROOT));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ROUTES
app.use('/', require('./routes/auth.routes'));
app.use('/', require('./routes/admin.routes'));

// mount file routes at "/" (keep existing behavior) AND "/files" (enable /files/search)
const fileRoutes = require('./routes/file.routes');
app.use('/', fileRoutes);
app.use('/files', fileRoutes);

app.use('/', require('./routes/folder.routes'));

// ✅ Start server using Render assigned port
const PORT = process.env.PORT || 5500;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
