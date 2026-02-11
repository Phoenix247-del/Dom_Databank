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
  const isAdmin = req.session.user.role === 'admin';

  // Pagination (Recent Files)
  const pageSize = 10;
  const page = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
  const offset = (page - 1) * pageSize;

  // Fetch folders (needed for folder modals / assignment)
  const foldersSql = `SELECT * FROM folders ORDER BY created_at DESC`;

  // NOTE: We always paginate the recent files table
  const filesSqlAdmin = `
    SELECT id, filename, filepath, uploaded_at, folder_id
    FROM files
    ORDER BY uploaded_at DESC
    LIMIT ? OFFSET ?
  `;

  const countSqlAdmin = `SELECT COUNT(*) AS cnt FROM files`;

  const filesSqlUser = `
    SELECT f.id, f.filename, f.filepath, f.uploaded_at, f.folder_id
    FROM files f
    INNER JOIN folder_access fa ON f.folder_id = fa.folder_id
    WHERE fa.user_id = ?
    ORDER BY f.uploaded_at DESC
    LIMIT ? OFFSET ?
  `;

  const countSqlUser = `
    SELECT COUNT(*) AS cnt
    FROM files f
    INNER JOIN folder_access fa ON f.folder_id = fa.folder_id
    WHERE fa.user_id = ?
  `;

  // Admin view: all users + access rows
  const usersSql = `SELECT id, fullname, email, role, can_search, can_preview, can_print FROM users ORDER BY created_at DESC`;
  const accessRowsSql = `SELECT user_id, folder_id FROM folder_access`;

  // Logs (admin only)
  const logsSql = `
    SELECT l.*, u.fullname, u.email
    FROM logs l
    LEFT JOIN users u ON l.user_id = u.id
    ORDER BY l.created_at DESC
    LIMIT 200
  `;

  db.query(foldersSql, (errFolders, folders) => {
    if (errFolders) {
      console.error('Folders fetch error:', errFolders);
      return res.status(500).send('Error loading dashboard');
    }

    if (isAdmin) {
      // Admin: count -> files -> users -> access rows -> logs -> render
      db.query(countSqlAdmin, (errCount, countRows) => {
        if (errCount) {
          console.error('Files count error:', errCount);
          return res.status(500).send('Error loading dashboard');
        }

        const totalFiles = Number(countRows?.[0]?.cnt || 0);
        const totalPages = Math.max(Math.ceil(totalFiles / pageSize), 1);

        const safePage = Math.min(page, totalPages);
        const safeOffset = (safePage - 1) * pageSize;

        db.query(filesSqlAdmin, [pageSize, safeOffset], (errFiles, files) => {
          if (errFiles) {
            console.error('Files fetch error:', errFiles);
            return res.status(500).send('Error loading dashboard');
          }

          db.query(usersSql, (errUsers, users) => {
            if (errUsers) {
              console.error('Users fetch error:', errUsers);
              return res.status(500).send('Error loading dashboard');
            }

            db.query(accessRowsSql, (errAccess, accessRows) => {
              if (errAccess) {
                console.error('Access rows fetch error:', errAccess);
                return res.status(500).send('Error loading dashboard');
              }

              db.query(logsSql, (errLogs, logs) => {
                if (errLogs) {
                  console.error('Logs fetch error:', errLogs);
                  return res.status(500).send('Error loading dashboard');
                }

                return res.render('dashboard', {
                  user: req.session.user,
                  files,
                  folders,
                  users,
                  logs,
                  accessRows,
                  page: safePage,
                  totalPages,
                  totalFiles,
                  pageSize
                });
              });
            });
          });
        });
      });
    } else {
      // User: count -> files -> render (no users/logs)
      db.query(countSqlUser, [req.session.user.id], (errCount, countRows) => {
        if (errCount) {
          console.error('User files count error:', errCount);
          return res.status(500).send('Error loading dashboard');
        }

        const totalFiles = Number(countRows?.[0]?.cnt || 0);
        const totalPages = Math.max(Math.ceil(totalFiles / pageSize), 1);

        const safePage = Math.min(page, totalPages);
        const safeOffset = (safePage - 1) * pageSize;

        db.query(filesSqlUser, [req.session.user.id, pageSize, safeOffset], (errFiles, files) => {
          if (errFiles) {
            console.error('User files fetch error:', errFiles);
            return res.status(500).send('Error loading dashboard');
          }

          return res.render('dashboard', {
            user: req.session.user,
            files,
            folders,
            users: [],
            logs: [],
            accessRows: [],
            page: safePage,
            totalPages,
            totalFiles,
            pageSize
          });
        });
      });
    }
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
      return redirectWithMessage(req, res, 'error', 'Please fill all fields.', '/dashboard?open=userModal');
    }

    db.query('SELECT id FROM users WHERE email = ?', [email], async (err, rows) => {
      if (err) {
        console.error('Create user check error:', err);
        return redirectWithMessage(req, res, 'error', 'Could not create user (DB error).', '/dashboard?open=userModal');
      }

      if (rows && rows.length) {
        return redirectWithMessage(req, res, 'error', 'This email already exists.', '/dashboard?open=userModal');
      }

      const hash = await bcrypt.hash(password, 10);

      const can_search = 0;
      const can_preview = 0;
      const can_print = 0;

      db.query(
        'INSERT INTO users (fullname, email, password, role, can_search, can_preview, can_print) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [fullname, email, hash, role, can_search, can_preview, can_print],
        (err2) => {
          if (err2) {
            console.error('Create user insert error:', err2);
            return redirectWithMessage(req, res, 'error', 'Could not create user.', '/dashboard?open=userModal');
          }
          return redirectWithMessage(req, res, 'success', 'User created successfully.', '/dashboard?open=userModal');
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

  if (!userId) return redirectWithMessage(req, res, 'error', 'Invalid user.', '/dashboard?open=userModal');

  if (Number(adminUser.id) === userId) {
    return redirectWithMessage(req, res, 'error', 'You cannot modify your own admin privileges here.', '/dashboard?open=userModal');
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
        return redirectWithMessage(req, res, 'error', 'Could not update user.', '/dashboard?open=userModal');
      }

      db.query('DELETE FROM user_folder_access WHERE user_id = ?', [userId], (err2) => {
        if (err2) {
          console.error('Delete folder access error:', err2);
          return redirectWithMessage(req, res, 'error', 'Could not update folder assignments.', '/dashboard?open=userModal');
        }

        if (role === 'admin') {
          return redirectWithMessage(req, res, 'success', 'User updated successfully.', '/dashboard?open=userModal');
        }

        if (!folderIds.length) {
          return redirectWithMessage(req, res, 'success', 'User updated (no folders assigned).', '/dashboard?open=userModal');
        }

        const values = folderIds.map(fid => [userId, fid]);
        db.query(
          'INSERT IGNORE INTO user_folder_access (user_id, folder_id) VALUES ?',
          [values],
          (err3) => {
            if (err3) console.error('Insert folder access error:', err3);
            return redirectWithMessage(req, res, 'success', 'User updated successfully.', '/dashboard?open=userModal');
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

  if (!userId) return redirectWithMessage(req, res, 'error', 'Invalid user.', '/dashboard?open=userModal');

  if (Number(adminUser.id) === userId) {
    return redirectWithMessage(req, res, 'error', 'You cannot delete your own admin account.', '/dashboard?open=userModal');
  }

  db.query('SELECT role FROM users WHERE id = ?', [userId], (err, rows) => {
    if (err) {
      console.error('Delete user role check error:', err);
      return redirectWithMessage(req, res, 'error', 'Could not delete user.', '/dashboard?open=userModal');
    }

    if (!rows || !rows.length) {
      return redirectWithMessage(req, res, 'error', 'User not found.', '/dashboard?open=userModal');
    }

    if (rows[0].role === 'admin') {
      return redirectWithMessage(req, res, 'error', 'You cannot delete an admin account.', '/dashboard?open=userModal');
    }

    db.query('DELETE FROM user_folder_access WHERE user_id = ?', [userId], (err2) => {
      if (err2) {
        console.error('Delete access rows error:', err2);
        return redirectWithMessage(req, res, 'error', 'Could not delete user (access cleanup failed).', '/dashboard?open=userModal');
      }

      db.query('DELETE FROM users WHERE id = ?', [userId], (err3) => {
        if (err3) {
          console.error('Delete user error:', err3);
          return redirectWithMessage(req, res, 'error', 'Could not delete user.', '/dashboard?open=userModal');
        }
        return redirectWithMessage(req, res, 'success', 'User deleted successfully.', '/dashboard?open=userModal');
      });
    });
  });
});

/* ================= ADMIN: DELETE FILE ================= */
router.post('/admin/delete-file/:id', isAuthenticated, isAdmin, (req, res) => {
  const fileId = Number(req.params.id);
  if (!fileId) return redirectWithMessage(req, res, 'error', 'Invalid file.', '/dashboard?open=fileModal');

  db.query('SELECT filepath FROM files WHERE id = ?', [fileId], (err, rows) => {
    if (err) {
      console.error('Fetch file error:', err);
      return redirectWithMessage(req, res, 'error', 'Could not delete file.', '/dashboard?open=fileModal');
    }

    const fp = rows && rows.length ? rows[0].filepath : null;

    db.query('DELETE FROM files WHERE id = ?', [fileId], (err2) => {
      if (err2) {
        console.error('Delete file DB error:', err2);
        return redirectWithMessage(req, res, 'error', 'Could not delete file.', '/dashboard?open=fileModal');
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

      return redirectWithMessage(req, res, 'success', 'File deleted successfully.', '/dashboard?open=fileModal');
    });
  });
});

module.exports = router;


