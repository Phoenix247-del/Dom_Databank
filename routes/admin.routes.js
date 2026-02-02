const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');

const db = require('../config/db');
const { isAuthenticated, isAdmin } = require('../middleware/auth.middleware');

/* ================= Helpers ================= */
function safeReturnTo(req, fallback) {
  const candidate = (req.body?.return_to || req.query?.return_to || '').toString().trim();

  // Only allow returning back to dashboard (prevents open redirects)
  if (candidate.startsWith('/dashboard')) return candidate;

  return fallback || '/dashboard';
}

function redirectWithMessage(req, res, type, message, fallback) {
  const base = safeReturnTo(req, fallback);
  const glue = base.includes('?') ? '&' : '?';
  return res.redirect(base + glue + type + '=' + encodeURIComponent(message));
}

/**
 * DASHBOARD:
 * - Admin: sees all files/folders + logs + users + user_folder_access
 * - User: sees only assigned folders/files (no users list, no logs)
 */
router.get('/dashboard', isAuthenticated, (req, res) => {
  const user = req.session.user;

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

    const fallback = '/dashboard?open=userModal';

    if (!fullname || !email || !password) {
      return redirectWithMessage(req, res, 'error', 'Please fill all fields.', fallback);
    }

    db.query('SELECT id FROM users WHERE email = ?', [email], async (err, rows) => {
      if (err) {
        console.error('Create user check error:', err);
        return redirectWithMessage(req, res, 'error', 'Could not create user (DB error).', fallback);
      }

      if (rows && rows.length) {
        return redirectWithMessage(req, res, 'error', 'This email already exists.', fallback);
      }

      const hash = await bcrypt.hash(password, 10);

      db.query(
        'INSERT INTO users (fullname, email, password, role, can_search, can_preview, can_print) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [fullname, email, hash, role, 0, 0, 0],
        (err2) => {
          if (err2) {
            console.error('Create user insert error:', err2);
            return redirectWithMessage(req, res, 'error', 'Could not create user.', fallback);
          }
          return redirectWithMessage(req, res, 'success', 'User created successfully.', fallback);
        }
      );
    });
  } catch (e) {
    console.error('Create user error:', e);
    return redirectWithMessage(req, res, 'error', 'Could not create user.', '/dashboard?open=userModal');
  }
});

/* ================= ADMIN: UPDATE USER ================= */
router.post('/admin/users/:userId/update', isAuthenticated, isAdmin, (req, res) => {
  const adminUser = req.session.user;
  const userId = Number(req.params.userId);
  const fallback = '/dashboard?open=userModal';

  if (!userId) return redirectWithMessage(req, res, 'error', 'Invalid user.', fallback);

  if (Number(adminUser.id) === userId) {
    return redirectWithMessage(req, res, 'error', 'You cannot modify your own admin privileges here.', fallback);
  }

  const role = (req.body.role || 'user').trim();
  const can_search = req.body.can_search ? 1 : 0;
  const can_preview = req.body.can_preview ? 1 : 0;
  const can_print = req.body.can_print ? 1 : 0;

  let folderIds = req.body.folder_ids || [];
  if (!Array.isArray(folderIds)) folderIds = [folderIds];
  folderIds = folderIds.map(x => Number(x)).filter(Boolean);

  db.query(
    'UPDATE users SET role = ?, can_search = ?, can_preview = ?, can_print = ? WHERE id = ?',
    [role, can_search, can_preview, can_print, userId],
    (err) => {
      if (err) {
        console.error('Update user error:', err);
        return redirectWithMessage(req, res, 'error', 'Could not update user.', fallback);
      }

      db.query('DELETE FROM user_folder_access WHERE user_id = ?', [userId], (err2) => {
        if (err2) {
          console.error('Delete folder access error:', err2);
          return redirectWithMessage(req, res, 'error', 'Could not update folder assignments.', fallback);
        }

        if (role === 'admin') {
          return redirectWithMessage(req, res, 'success', 'User updated successfully.', fallback);
        }

        if (!folderIds.length) {
          return redirectWithMessage(req, res, 'success', 'User updated (no folders assigned).', fallback);
        }

        const values = folderIds.map(fid => [userId, fid]);
        db.query(
          'INSERT IGNORE INTO user_folder_access (user_id, folder_id) VALUES ?',
          [values],
          (err3) => {
            if (err3) console.error('Insert folder access error:', err3);
            return redirectWithMessage(req, res, 'success', 'User updated successfully.', fallback);
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
  const fallback = '/dashboard?open=userModal';

  if (!userId) return redirectWithMessage(req, res, 'error', 'Invalid user.', fallback);

  if (Number(adminUser.id) === userId) {
    return redirectWithMessage(req, res, 'error', 'You cannot delete your own admin account.', fallback);
  }

  db.query('SELECT role FROM users WHERE id = ?', [userId], (err, rows) => {
    if (err) {
      console.error('Delete user role check error:', err);
      return redirectWithMessage(req, res, 'error', 'Could not delete user.', fallback);
    }

    if (!rows || !rows.length) {
      return redirectWithMessage(req, res, 'error', 'User not found.', fallback);
    }

    if (rows[0].role === 'admin') {
      return redirectWithMessage(req, res, 'error', 'You cannot delete an admin account.', fallback);
    }

    db.query('DELETE FROM user_folder_access WHERE user_id = ?', [userId], (err2) => {
      if (err2) {
        console.error('Delete access rows error:', err2);
        return redirectWithMessage(req, res, 'error', 'Could not delete user (access cleanup failed).', fallback);
      }

      db.query('DELETE FROM users WHERE id = ?', [userId], (err3) => {
        if (err3) {
          console.error('Delete user error:', err3);
          return redirectWithMessage(req, res, 'error', 'Could not delete user.', fallback);
        }
        return redirectWithMessage(req, res, 'success', 'User deleted successfully.', fallback);
      });
    });
  });
});

/* ================= ADMIN: DELETE FILE ================= */
router.post('/admin/delete-file/:id', isAuthenticated, isAdmin, (req, res) => {
  const fileId = Number(req.params.id);
  const fallback = '/dashboard?open=fileModal';

  if (!fileId) return redirectWithMessage(req, res, 'error', 'Invalid file.', fallback);

  db.query('SELECT filepath FROM files WHERE id = ?', [fileId], (err, rows) => {
    if (err) {
      console.error('Fetch file error:', err);
      return redirectWithMessage(req, res, 'error', 'Could not delete file.', fallback);
    }

    const fp = rows && rows.length ? rows[0].filepath : null;

    db.query('DELETE FROM files WHERE id = ?', [fileId], (err2) => {
      if (err2) {
        console.error('Delete file DB error:', err2);
        return redirectWithMessage(req, res, 'error', 'Could not delete file.', fallback);
      }

      if (fp) {
        try {
          const normalized = String(fp).replace(/\\/g, '/').replace(/^\//, '');
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

      return redirectWithMessage(req, res, 'success', 'File deleted successfully.', fallback);
    });
  });
});

module.exports = router;
