const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { isAuthenticated, isAdmin } = require('../middleware/auth.middleware');
const adminController = require('../controllers/admin.controller');

// ================= DASHBOARD =================
router.get('/dashboard', isAuthenticated, (req, res) => {
  const user = req.session.user;

  // Load files and folders always
  db.query('SELECT * FROM files ORDER BY uploaded_at DESC', (err, files) => {
    if (err) {
      console.error('Files load error:', err);
      return res.status(500).send('Error loading files');
    }

    db.query('SELECT * FROM folders', (err2, folders) => {
      if (err2) {
        console.error('Folders load error:', err2);
        return res.status(500).send('Error loading folders');
      }

      // If admin, also load activity logs
      if (user.role === 'admin') {
        const logsSql = `
          SELECT 
            al.id,
            al.action,
            al.created_at,
            u.fullname,
            u.email
          FROM activity_logs al
          LEFT JOIN users u ON u.id = al.user_id
          ORDER BY al.created_at DESC
          LIMIT 200
        `;

        db.query(logsSql, (err3, logs) => {
          if (err3) {
            console.error('Logs load error:', err3);
            // Even if logs fail, dashboard should still render
            return res.render('dashboard', { user, files, folders, logs: [] });
          }

          res.render('dashboard', { user, files, folders, logs });
        });
      } else {
        // Non-admin: no logs
        res.render('dashboard', { user, files, folders, logs: [] });
      }
    });
  });
});

// ================= ADMIN: CREATE USER =================
router.post('/admin/create-user', isAuthenticated, isAdmin, adminController.createUser);

// ================= ADMIN: DELETE FILE =================
router.post('/admin/delete-file/:id', isAuthenticated, isAdmin, (req, res) => {
  db.query('DELETE FROM files WHERE id = ?', [req.params.id], (err) => {
    if (err) {
      console.error('Delete file error:', err);
      return res.status(500).send('Could not delete file');
    }
    res.redirect('/dashboard');
  });
});

module.exports = router;
