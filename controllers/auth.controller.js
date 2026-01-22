const db = require('../config/db');
const bcrypt = require('bcrypt');

// =======================
// SHOW LOGIN PAGE
// =======================
exports.loginPage = (req, res) => {
  // If already logged in, go to dashboard
  if (req.session.user) {
    return res.redirect('/dashboard');
  }
  res.render('login');
};

// =======================
// HANDLE LOGIN
// =======================
exports.login = (req, res) => {
  const { email, password } = req.body;

  // Basic validation
  if (!email || !password) {
    return res.send('Email and password are required');
  }

  // Fetch user
  db.query(
    'SELECT * FROM users WHERE email = ?',
    [email],
    async (err, results) => {
      if (err) {
        console.error('DB Error:', err);
        return res.status(500).send('Server error');
      }

      if (results.length === 0) {
        return res.send('Invalid email or password');
      }

      const user = results[0];

      // Compare password
      const match = await bcrypt.compare(password, user.password);
      if (!match) {
        return res.send('Invalid email or password');
      }

      // Save user session
      req.session.user = {
        id: user.id,
        fullname: user.fullname,
        email: user.email,
        role: user.role
      };

      // Redirect to dashboard
      res.redirect('/dashboard');
    }
  );
};

// =======================
// LOGOUT
// =======================
exports.logout = (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Logout Error:', err);
      return res.status(500).send('Could not log out');
    }
    res.redirect('/login');
  });
};
