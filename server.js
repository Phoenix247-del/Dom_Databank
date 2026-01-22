const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Session (use env secret for deployment)
app.use(session({
  secret: process.env.SESSION_SECRET || 'dom_databank_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false // set to true only when using HTTPS + behind proxy (see note below)
  }
}));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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

// ✅ Start server using Render/Vercel assigned port
const PORT = process.env.PORT || 5500;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
