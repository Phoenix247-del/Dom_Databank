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
 * - Admin: sees all files/folders + logs + users + accessRows (if table exists)
 * - User: sees only assigned folders/files IF access table exists; otherwise safe fallback shows all
 */
router.get('/dashboard', isAuthenticated, (req, res) => {
  const user = req.session.user;

  // Pagination for Recent Files
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = 10;
  const offset = (page - 1) * limit;

  // Some deployments may not have an access-mapping table yet.
  // If the table is missing, we fall back to showing ALL folders/files (so the dashboard never crashes).
  function isMissingTable(err) {
    return err && (err.code === 'ER_NO_SUCH_TABLE' || err.errno === 1146);
  }

  function loadAccessRowsForAdmin(cb) {
    // Preferred table name (used by this codebase)
    db.query('SELECT user_id, folder_id FROM user_folder_access', (err, rows) => {
      if (!err) return cb(null, rows || []);
      if (!isMissingTable(err)) return cb(err);

      // Backward-compat fallback (older name)
      db.query('SELECT user_id, folder_id FROM folder_access', (err2, rows2) => {
        if (!err2) return cb(null, rows2 || []);
        if (isMissingTable(err2)) return cb(null, []);
        return cb(err2);
      });
    });
  }

  function loadFolders(cb) {
    if (user.role === 'admin') {
      return db.query('SELECT * FROM folders ORDER BY name ASC', cb);
    }

    const sql = `
      SELECT f.*
      FROM folders f
      INNER JOIN user_folder_access ufa
        ON ufa.folder_id = f.id
      WHERE ufa.user_id = ?
      ORDER BY f.name ASC
    `;

    db.query(sql, [user.id], (err, rows) => {
      if (!err) return cb(null, rows);
      if (isMissingTable(err)) {
        // Fallback: show all folders (safe mode)
        return db.query('SELECT * FROM folders ORDER BY name ASC', cb);
      }
      return cb(err);
    });
  }

  function loadFiles(cb) {
    const countAllSql = 'SELECT COUNT(*) AS total FROM files';
    const listAllSql = 'SELECT * FROM files ORDER BY uploaded_at DESC LIMIT ? OFFSET ?';

    if (user.role === 'admin') {
      db.query(countAllSql, (cerr, crows) => {
        if (cerr) return cb(cerr);
        const total = Number(crows?.[0]?.total || 0);
        const totalPages = Math.max(Math.ceil(total / limit), 1);
        db.query(listAllSql, [limit, offset], (lerr, lrows) => {
          if (lerr) return cb(lerr);
          cb(null, { files: lrows || [], page, totalPages });
        });
      });
      return;
    }

    const countSql = `
      SELECT COUNT(*) AS total
      FROM files fi
      INNER JOIN user_folder_access ufa
        ON ufa.folder_id = fi.folder_id
       AND ufa.user_id = ?
    `;

    const listSql = `
      SELECT fi.*
      FROM files fi
      INNER JOIN user_folder_access ufa
        ON ufa.folder_id = fi.folder_id
       AND ufa.user_id = ?
      ORDER BY fi.uploaded_at DESC
      LIMIT ? OFFSET ?
    `;

    db.query(countSql, [user.id], (cerr, crows) => {
      if (!cerr) {
        const total = Number(crows?.[0]?.total || 0);
        const totalPages = Math.max(Math.ceil(total / limit), 1);
        return db.query(listSql, [user.id, limit, offset], (lerr, lrows) => {
          if (lerr) return cb(lerr);
          cb(null, { files: lrows || [], page, totalPages });
        });
      }

      // If access table missing, fall back to ALL files (safe mode)
      if (isMissingTable(cerr)) {
        db.query(countAllSql, (cerr2, crows2) => {
          if (cerr2) return cb(cerr2);
          const total = Number(crows2?.[0]?.total || 0);
          const totalPages = Math.max(Math.ceil(total / limit), 1);
          db.query(listAllSql, [limit, offset], (lerr2, lrows2) => {
            if (lerr2) return cb(lerr2);
            cb(null, { files: lrows2 || [], page, totalPages });
          });
        });
        return;
      }

      return cb(cerr);
    });
  }

  // 1) Load folders (with safe fallback)
  loadFolders((fErr, folders) => {
    if (fErr) {
      console.error('Folders load error:', fErr);
      return res.status(500).send('Error loading folders');
    }

    // 2) Load paginated files (with safe fallback)
    loadFiles((fiErr, fileResult) => {
      if (fiErr) {
        console.error('Files load error:', fiErr);
        return res.status(500).send('Error loading files');
      }

      const files = fileResult.files;
      const totalPages = fileResult.totalPages;

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
          selectedFolderName: null,
          page,
          totalPages
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

            loadAccessRowsForAdmin((err5, accessRows) => {
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
                selectedFolderName: null,
                page,
                totalPages
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
