const db = require('../config/db');

module.exports = (action) => {
  return (req, res, next) => {
    if (req.session.user) {
      db.query(
        'INSERT INTO activity_logs (user_id, action) VALUES (?, ?)',
        [req.session.user.id, action]
      );
    }
    next();
  };
};
