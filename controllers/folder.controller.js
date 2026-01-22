const db = require('../config/db');

exports.createFolder = (req, res) => {
  db.query(
    'INSERT INTO folders (name, created_by) VALUES (?, ?)',
    [req.body.name, req.session.user.id],
    () => res.redirect('/dashboard')
  );
};
