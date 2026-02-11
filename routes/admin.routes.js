const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');

const db = require('../config/db');
const { isAuthenticated, isAdmin } = require('../middleware/auth.middleware');

/* ================= Extra Safety Guard ================= */
router.use((req, res, next) => {
  // Prevent any accidental dashboard access without session
  if (!req.session || !req.session.user) {
    return res.redirect('/login');
  }
  next();
});

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

/* ================= DASHBOARD ================= */
router.get('/dashboard', isAuthenticated, (req, res) => {

  const user = req.session.user;

  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = 10;
  const offset = (page - 1) * limit;

  function isMissingTable(err) {
    return err && (err.code === 'ER_NO_SUCH_TABLE' || err.errno === 1146);
  }

  /* ================= LOAD FOLDERS ================= */
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

      // Fallback safe mode
      if (isMissingTable(err)) {
        return db.query('SELECT * FROM folders ORDER BY name ASC', cb);
      }

      return cb(err);
    });
  }

  /* ================= LOAD FILES ================= */
  function loadFiles(cb) {

    const countAllSql = 'SELECT COUNT(*) AS total FROM files';
    const listAllSql = 'SELECT * FROM files ORDER BY uploaded_at DESC LIMIT ? OFFSET ?';

    if (user.role === 'admin') {

      db.query(countAllSql, (cerr, crows) => {
        if (cerr) return cb(cerr);

        const total = Number(crows[0]?.total || 0);
        const totalPages = Math.max(Math.ceil(total / limit), 1);

        db.query(listAllSql, [limit, offset], (lerr, lrows) => {
          if (lerr) return cb(lerr);
          cb(null, { files: lrows || [], page, totalPages });
        });
      });

      return;
    }

    /* ---------- USER FILE ACCESS ---------- */

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
        const total = Number(crows[0]?.total || 0);
        const totalPages = Math.max(Math.ceil(total / limit), 1);

        return db.query(listSql, [user.id, limit, offset], (lerr, lrows) => {
          if (lerr) return cb(lerr);
          cb(null, { files: lrows || [], page, totalPages });
        });
      }

      // Safe fallback
      if (isMissingTable(cerr)) {

        db.query(countAllSql, (cerr2, crows2) => {
          if (cerr2) return cb(cerr2);

          const total = Number(crows2[0]?.total || 0);
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

  /* ================= ADMIN ACCESS ROWS ================= */
  function loadAccessRows(cb) {

    db.query('SELECT user_id, folder_id FROM user_folder_access', (err, rows) => {

      if (!err) return cb(null, rows || []);

      if (isMissingTable(err)) return cb(null, []);

      return cb(err);
    });
  }

  /* ================= LOAD EVERYTHING ================= */

  loadFolders((fErr, folders) => {

    if (fErr) {
      console.error(fErr);
      return res.status(500).send('Folder load error');
    }

    loadFiles((fiErr, fileResult) => {

      if (fiErr) {
        console.error(fiErr);
        return res.status(500).send('File load error');
      }

      const files = fileResult.files;
      const totalPages = fileResult.totalPages;

      /* ---------- NON ADMIN ---------- */
      if (user.role !== 'admin') {
        return res.render('dashboard', {
          user,
          files,
          folders,
          logs: [],
          users: [],
          accessRows: [],
          page,
          totalPages
        });
      }

      /* ---------- ADMIN EXTRA DATA ---------- */

      const logsSql = `
        SELECT al.id, al.action, al.created_at, u.fullname, u.email
        FROM activity_logs al
        LEFT JOIN users u ON u.id = al.user_id
        ORDER BY al.created_at DESC
        LIMIT 200
      `;

      db.query(logsSql, (err3, logs) => {

        if (err3) logs = [];

        db.query(
          'SELECT id, fullname, email, role, can_search, can_preview, can_print, created_at FROM users ORDER BY created_at DESC',
          (err4, users) => {

            if (err4) users = [];

            loadAccessRows((err5, accessRows) => {

              if (err5) accessRows = [];

              return res.render('dashboard', {
                user,
                files,
                folders,
                logs,
                users,
                accessRows,
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

/* ================= CREATE USER ================= */
router.post('/admin/create-user', isAuthenticated, isAdmin, async (req, res) => {

  try {

    const fullname = req.body.fullname?.trim();
    const email = req.body.email?.trim().toLowerCase();
    const password = req.body.password?.trim();
    const role = req.body.role || 'user';

    if (!fullname || !email || !password) {
      return redirectWithMessage(req, res, 'error', 'Fill all fields', '/dashboard?open=userModal');
    }

    const hash = await bcrypt.hash(password, 10);

    db.query(
      'INSERT INTO users (fullname,email,password,role,can_search,can_preview,can_print) VALUES (?,?,?,?,0,0,0)',
      [fullname, email, hash, role],
      err => {
        if (err) {
          console.error(err);
          return redirectWithMessage(req, res, 'error', 'User creation failed', '/dashboard?open=userModal');
        }

        redirectWithMessage(req, res, 'success', 'User created', '/dashboard?open=userModal');
      }
    );

  } catch (e) {
    console.error(e);
    redirectWithMessage(req, res, 'error', 'User creation failed', '/dashboard?open=userModal');
  }

});

/* ================= DELETE FILE ================= */
router.post('/admin/delete-file/:id', isAuthenticated, isAdmin, (req, res) => {

  const fileId = Number(req.params.id);

  db.query('SELECT filepath FROM files WHERE id=?', [fileId], (err, rows) => {

    if (err) return res.redirect('/dashboard');

    const filepath = rows[0]?.filepath;

    db.query('DELETE FROM files WHERE id=?', [fileId], () => {

      if (filepath) {
        try {
          const fullPath = path.join(process.cwd(), filepath);
          if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
        } catch {}
      }

      res.redirect('/dashboard');
    });

  });

});

module.exports = router;