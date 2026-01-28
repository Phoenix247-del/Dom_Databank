const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');

const db = require('../config/db');
const { isAuthenticated, isAdmin } = require('../middleware/auth.middleware');

/* ================= Helpers ================= */
function redirectSuccess(res, message) {
  return res.redirect('/dashboard?success=' + encodeURIComponent(message));
}

function redirectError(res, message) {
  return res.redirect('/dashboard?error=' + encodeURIComponent(message));
}

/**
 * DASHBOARD:
 * - Admin: sees all files/folders + logs + users + user_folder_access
 * - User: sees only assigned folders/files (no users list, no logs)
 */
router.get('/dashboard', isAuthenticated, (req, res) => {
  const user = req.session.user;

  // Files query
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

    // Folders query
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

      // Non-admin render
      if (user.role !== 'admin') {
        return res.render('dashboard', {
          user,
          files,
          folders,
          logs: [],
          users: [],
          accessRows: [],
          selectedFolderId: null,
          selectedFolderName: null
        });
      }

      // Admin extras: logs + users + assignments
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
          logs = [];
        }

        db.query(
          'SELECT id, fullname, email, role, can_search, can_preview, can_print, created_at FROM users ORDER BY created_at DESC',
          (err4, users) => {
            if (err4) {
              console.error('Users load error:', err4);
              users = [];
            }

            db.query('SELECT user_id, folder_id FROM user_folder_access', (err5, accessRows) => {
              if (err5) {
                console.error('Access rows load error:', err5);
                accessRows = [];
              }

              return res.render('dashboard', {
                user,
                files,
                folders,
                logs,
                users,
                accessRows,
                selectedFolderId: null,
                selectedFolderName: null
              });
            });
          }
        );
      });
    });
  });
});

/* ================= ADMIN: CREATE USER ================= */
router.post('/admin/create-user', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const fullname = (req.body.fullname || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const password = (req.body.password || '').trim();
    const role = (req.body.role || 'user').trim();

    if (!fullname || !email || !password) {
      return redirectError(res, 'Please fill all fields.');
    }

    // check duplicate email
    db.query('SELECT id FROM users WHERE email = ?', [email], async (err, rows) => {
      if (err) {
        console.error('Create user check error:', err);
        return redirectError(res, 'Could not create user (DB error).');
      }

      if (rows && rows.length) {
        return redirectError(res, 'This email already exists.');
      }

      const hash = await bcrypt.hash(password, 10);

      // default privileges for new users (admin bypasses anyway)
      const can_search = 0;
      const can_preview = 0;
      const can_print = 0;

      db.query(
        'INSERT INTO users (fullname, email, password, role, can_search, can_preview, can_print) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [fullname, email, hash, role, can_search, can_preview, can_print],
        (err2) => {
          if (err2) {
            console.error('Create user insert error:', err2);
            return redirectError(res, 'Could not create user.');
          }
          return redirectSuccess(res, 'User created successfully.');
        }
      );
    });
  } catch (e) {
    console.error('Create user error:', e);
    return redirectError(res, 'Could not create user.');
  }
});

/* ================= ADMIN: UPDATE USER (role + privileges + folder assignments) ================= */
router.post('/admin/users/:userId/update', isAuthenticated, isAdmin, (req, res) => {
  const adminUser = req.session.user;
  const userId = Number(req.params.userId);

  if (!userId) return redirectError(res, 'Invalid user.');

  // Prevent editing your own admin privileges/role (recommended)
  if (Number(adminUser.id) === userId) {
    return redirectError(res, 'You cannot modify your own admin privileges here.');
  }

  const role = (req.body.role || 'user').trim();
  const can_search = req.body.can_search ? 1 : 0;
  const can_preview = req.body.can_preview ? 1 : 0;
  const can_print = req.body.can_print ? 1 : 0;

  // folder_ids can be single or array from <select multiple>
  let folderIds = req.body.folder_ids || [];
  if (!Array.isArray(folderIds)) folderIds = [folderIds];
  folderIds = folderIds.map(x => Number(x)).filter(Boolean);

  db.query(
    'UPDATE users SET role = ?, can_search = ?, can_preview = ?, can_print = ? WHERE id = ?',
    [role, can_search, can_preview, can_print, userId],
    (err) => {
      if (err) {
        console.error('Update user error:', err);
        return redirectError(res, 'Could not update user.');
      }

      // Replace folder assignments
      db.query('DELETE FROM user_folder_access WHERE user_id = ?', [userId], (err2) => {
        if (err2) {
          console.error('Delete folder access error:', err2);
          return redirectError(res, 'Could not update folder assignments.');
        }

        // If user is admin, folders are not required (admin bypass)
        if (role === 'admin') {
          return redirectSuccess(res, 'User updated successfully.');
        }

        // No folders assigned => user will see nothing & cannot upload
        if (!folderIds.length) {
          return redirectSuccess(res, 'User updated (no folders assigned).');
        }

        const values = folderIds.map(fid => [userId, fid]);
        db.query(
          'INSERT IGNORE INTO user_folder_access (user_id, folder_id) VALUES ?',
          [values],
          (err3) => {
            if (err3) console.error('Insert folder access error:', err3);
            return redirectSuccess(res, 'User updated successfully.');
          }
        );
      });
    }
  );
});

/* ================= ADMIN: DELETE USER ================= */
router.post('/admin/users/:userId/delete', isAuthenticated, isAdmin, (req, res) => {
  const adminUser = req.session.user;
  const userId = Number(req.params.userId);

  if (!userId) return redirectError(res, 'Invalid user.');

  // Prevent deleting yourself
  if (Number(adminUser.id) === userId) {
    return redirectError(res, 'You cannot delete your own admin account.');
  }

  // Prevent deleting other admins
  db.query('SELECT role FROM users WHERE id = ?', [userId], (err, rows) => {
    if (err) {
      console.error('Delete user role check error:', err);
      return redirectError(res, 'Could not delete user.');
    }

    if (!rows || !rows.length) {
      return redirectError(res, 'User not found.');
    }

    if (rows[0].role === 'admin') {
      return redirectError(res, 'You cannot delete an admin account.');
    }

    // Remove access rows first
    db.query('DELETE FROM user_folder_access WHERE user_id = ?', [userId], (err2) => {
      if (err2) {
        console.error('Delete access rows error:', err2);
        return redirectError(res, 'Could not delete user (access cleanup failed).');
      }

      // Delete user
      db.query('DELETE FROM users WHERE id = ?', [userId], (err3) => {
        if (err3) {
          console.error('Delete user error:', err3);
          return redirectError(res, 'Could not delete user.');
        }
        return redirectSuccess(res, 'User deleted successfully.');
      });
    });
  });
});

/* ================= ADMIN: DELETE FILE (used by dashboard.ejs) =================
   POST /admin/delete-file/:id
*/
router.post('/admin/delete-file/:id', isAuthenticated, isAdmin, (req, res) => {
  const fileId = Number(req.params.id);
  if (!fileId) return redirectError(res, 'Invalid file.');

  // Get file path, delete DB row, then delete file from disk (best-effort)
  db.query('SELECT filepath FROM files WHERE id = ?', [fileId], (err, rows) => {
    if (err) {
      console.error('Fetch file error:', err);
      return redirectError(res, 'Could not delete file.');
    }

    const fp = rows && rows.length ? rows[0].filepath : null;

    db.query('DELETE FROM files WHERE id = ?', [fileId], (err2) => {
      if (err2) {
        console.error('Delete file DB error:', err2);
        return redirectError(res, 'Could not delete file.');
      }

      // Best-effort local delete (works for local/persistent disk deployments)
      if (fp) {
        try {
          const normalized = String(fp).replace(/\\/g, '/').replace(/^\//, '');
          // common patterns: uploads/documents/xxx OR ./uploads/documents/xxx
          const possible = [
            path.join(process.cwd(), normalized),
            path.join(process.cwd(), normalized.replace(/^\.\//, '')),
            path.join(process.cwd(), 'uploads', 'documents', path.basename(normalized))
          ];

          for (const p of possible) {
            if (fs.existsSync(p)) {
              fs.unlinkSync(p);
              break;
            }
          }
        } catch (e) {
          console.warn('File unlink warning (ignored):', e.message);
        }
      }

      return redirectSuccess(res, 'File deleted successfully.');
    });
  });
});

module.exports = router;
