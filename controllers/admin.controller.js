const db = require('../config/db');
const bcrypt = require('bcrypt');

exports.createUser = async (req, res) => {
  const { fullname, email, password, role } = req.body;

  if (!fullname || !email || !password) {
    return res.send('All fields required');
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  db.query(
    'INSERT INTO users (fullname, email, password, role) VALUES (?, ?, ?, ?)',
    [fullname, email, hashedPassword, role],
    (err) => {
      if (err) {
        console.error(err);
        return res.send('User already exists or error occurred');
      }
      res.redirect('/dashboard');
    }
  );
};
