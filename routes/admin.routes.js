const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { isAuthenticated, isAdmin } = require('../middleware/auth.middleware');
const adminController = require('../controllers/admin.controller');

// ================= DASHBOARD =================
router.get('/dashboard', isAuthenticated, (req, res) => {
  const user = req.session.user;

  // ✅ Files: admin sees all, users see only assigned folder files
  let filesSql = 'SELECT * FROM files ORDER BY uploaded_at DESC';
  let filesParams = [];

  if (user.role !== 'admin') {
    filesSql = `
      SELECT fi.*
      FROM files fi
      INNER JOIN user_folder_access ufa
        ON ufa.folder_id = fi.folder_id
       AND ufa.user_id = ?
      ORDER BY fi.uploaded_at DESC
    `;
    filesParams = [user.id];
  }

  db.query(filesSql, filesParams, (err, files) => {
    if (err) {
      console.error('Files load error:', err);
      return res.status(500).send('Error loading files');
    }

    // ✅ Folders: admin sees all, users see only assigned folders
    let foldersSql = 'SELECT * FROM folders ORDER BY created_at DESC';
    let foldersParams = [];

    if (user.role !== 'admin') {
      foldersSql = `
        SELECT f.*
        FROM folders f
        INNER JOIN user_folder_access ufa
          ON ufa.folder_id = f.id
        WHERE ufa.user_id = ?
        ORDER BY f.created_at DESC
      `;
      foldersParams = [user.id];
    }

    db.query(foldersSql, foldersParams, (err2, folders) => {
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
