const db = require('../config/db');
const path = require('path');

/* Build a consistent public path for uploaded files.
   We serve uploads via: app.use('/uploads', express.static(UPLOAD_ROOT))
   So the URL should be: /uploads/documents/<stored_filename>

   We store in DB as: uploads/documents/<stored_filename>
*/
function buildPublicFilePath(file) {
  const storedName = file.filename;
  return `uploads/documents/${storedName}`;
}

/* Normalize older paths that may have been stored incorrectly */
function normalizeDbPath(fp) {
  if (!fp) return '';
  const p = String(fp).replace(/\\/g, '/');

  // If stored as absolute volume path like /data/uploads/documents/xxx
  const idx = p.indexOf('/uploads/');
  if (idx !== -1) {
    return p.slice(idx + 1); // remove leading slash so it becomes uploads/...
  }

  // If mistakenly stored as data/uploads/...
  const idx2 = p.indexOf('uploads/');
  if (idx2 !== -1) {
    return p.slice(idx2); // uploads/...
  }

  // If stored as documents/xxx
  if (p.startsWith('documents/')) return `uploads/${p}`;

  // Fix legacy bug: uploadsdocuments -> uploads/documents
  return p.replace('uploadsdocuments', 'uploads/documents');
}

/* Check if user has access to a folder */
function userHasFolderAccess(userId, folderId) {
  return new Promise((resolve) => {
    db.query(
      'SELECT 1 FROM user_folder_access WHERE user_id = ? AND folder_id = ? LIMIT 1',
      [userId, folderId],
      (err, rows) => {
        if (err) return resolve(false);
        resolve(rows && rows.length > 0);
      }
    );
  });
}

/* Load folders for admin or assigned folders for users */
function loadFoldersForUser(user, cb) {
  if (user.role === 'admin') {
    db.query('SELECT * FROM folders ORDER BY created_at DESC', cb);
  } else {
    db.query(
      `
        SELECT f.*
        FROM folders f
        INNER JOIN user_folder_access ufa
          ON ufa.folder_id = f.id
        WHERE ufa.user_id = ?
        ORDER BY f.created_at DESC
      `,
      [user.id],
      cb
    );
  }
}

/* Load files for admin or assigned folder files for users (optionally filtered) */
function loadFilesForUser(user, { folderId = null, keyword = '', date = '' }, cb) {
  let sql = `
    SELECT fi.*
    FROM files fi
  `;
  const params = [];

  if (user.role !== 'admin') {
    sql += `
      INNER JOIN user_folder_access ufa
        ON ufa.folder_id = fi.folder_id
       AND ufa.user_id = ?
    `;
    params.push(user.id);
  }

  sql += ' WHERE 1=1 ';

  if (folderId) {
    sql += ' AND fi.folder_id = ? ';
    params.push(folderId);
  }

  if (keyword) {
    sql += ' AND fi.filename LIKE ? ';
    params.push(`%${keyword}%`);
  }

  if (date) {
    sql += ' AND DATE(fi.uploaded_at) = ? ';
    params.push(date);
  }

  sql += ' ORDER BY fi.uploaded_at DESC ';

  db.query(sql, params, cb);
}

/* Load logs for admin */
function loadLogs(cb) {
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
  db.query(logsSql, cb);
}

/* ================= UPLOAD FILE ================= */
exports.uploadFile = async (req, res) => {
  try {
    // Support BOTH single and multiple uploads
    const uploaded = Array.isArray(req.files) && req.files.length
      ? req.files
      : (req.file ? [req.file] : []);

    const folderId = req.body.folder_id;

    if (!folderId) {
      // If files were uploaded but folder is missing, this is a client-side issue
      return res.redirect('/dashboard?error=' + encodeURIComponent('Please select a folder.') + '&open=fileModal');
    }

    if (!uploaded.length) {
      return res.redirect('/dashboard?error=' + encodeURIComponent('No file selected.') + '&open=fileModal&folder_id=' + encodeURIComponent(folderId));
    }

    const fileInserts = uploaded.map(f => ({
      filename: f.originalname,
      filepath: f.path,
      folder_id: folderId
    }));

    for (const row of fileInserts) {
      await new Promise((resolve, reject) => {
        db.query(
          'INSERT INTO files (filename, filepath, folder_id) VALUES (?, ?, ?)',
          [row.filename, row.filepath, row.folder_id],
          (err) => (err ? reject(err) : resolve())
        );
      });
    }

    // Stay in File modal + keep folder selected
    const msg = uploaded.length === 1 ? 'File uploaded successfully!' : `${uploaded.length} files uploaded successfully!`;
    return res.redirect('/dashboard?success=' + encodeURIComponent(msg) + '&open=fileModal&folder_id=' + encodeURIComponent(folderId));
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).send('Internal Server Error');
  }
};


/* ================= SEARCH FILES ================= */
exports.searchFiles = (req, res) => {
  const user = req.session.user;
  const keyword = (req.query.keyword || '').trim();
  const date = (req.query.date || '').trim();

  // privilege check (server-side)
  if (user.role !== 'admin' && !Number(user.can_search)) {
    return res.status(403).send('You do not have search privilege');
  }

  loadFilesForUser(user, { keyword, date }, (err, files) => {
    if (err) {
      console.error('Search error:', err);
      return res.status(500).send('Search failed');
    }

    files = (files || []).map(f => ({ ...f, filepath: normalizeDbPath(f.filepath) }));

    loadFoldersForUser(user, (err2, folders) => {
      if (err2) {
        console.error('Folder load error:', err2);
        return res.status(500).send('Folder load failed');
      }

      if (user.role === 'admin') {
        loadLogs((err3, logs) => {
          if (err3) logs = [];
          return res.render('dashboard', {
            user,
            files,
            folders,
            logs,
            selectedFolderId: null,
            selectedFolderName: null
          });
        });
      } else {
        return res.render('dashboard', {
          user,
          files,
          folders,
          logs: [],
          selectedFolderId: null,
          selectedFolderName: null
        });
      }
    });
  });
};

/* ================= LIST FILES BY FOLDER ================= */
exports.listFilesByFolder = async (req, res) => {
  try {
    const folderId = req.params.folderId;
    const user = req.session.user;

    // Pagination
    const perPage = 10;
    const page = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
    const offset = (page - 1) * perPage;

    // Confirm folder exists (and get name)
    const folder = await new Promise((resolve, reject) => {
      db.query('SELECT id, name FROM folders WHERE id = ?', [folderId], (err, rows) => {
        if (err) return reject(err);
        resolve(rows && rows.length ? rows[0] : null);
      });
    });
    if (!folder) return res.status(404).send('Folder not found');

    // Access check (non-admin must be assigned)
    if (user.role !== 'admin') {
      const hasAccess = await new Promise((resolve, reject) => {
        db.query(
          'SELECT 1 FROM user_folder_access WHERE user_id = ? AND folder_id = ? LIMIT 1',
          [user.id, folderId],
          (err, rows) => {
            if (err) return reject(err);
            resolve(rows && rows.length > 0);
          }
        );
      });
      if (!hasAccess) return res.status(403).send('Access denied');
    }

    // Count files in folder
    const total = await new Promise((resolve, reject) => {
      db.query('SELECT COUNT(*) AS cnt FROM files WHERE folder_id = ?', [folderId], (err, rows) => {
        if (err) return reject(err);
        resolve(rows?.[0]?.cnt || 0);
      });
    });
    const totalPages = Math.max(Math.ceil(total / perPage), 1);

    // Fetch paginated files
    const files = await new Promise((resolve, reject) => {
      db.query(
        'SELECT * FROM files WHERE folder_id = ? ORDER BY uploaded_at DESC LIMIT ? OFFSET ?',
        [folderId, perPage, offset],
        (err, rows) => (err ? reject(err) : resolve(rows || []))
      );
    });

    // Folders list for sidebar/modals
    const folders = await new Promise((resolve, reject) => {
      const q = (user.role === 'admin')
        ? 'SELECT * FROM folders ORDER BY name ASC'
        : `SELECT f.* 
           FROM folders f 
           INNER JOIN user_folder_access ufa ON ufa.folder_id = f.id 
           WHERE ufa.user_id = ?
           ORDER BY f.name ASC`;

      const params = (user.role === 'admin') ? [] : [user.id];
      db.query(q, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });

    return res.render('dashboard', {
      user,
      files,
      folders,
      selectedFolderId: folderId,
      selectedFolderName: folder.name,
      logs: [],
      users: [],
      accessRows: [],
      page,
      totalPages,
      paginationBase: `/files/folder/${folderId}`
    });
  } catch (err) {
    console.error('Error listing folder files:', err);
    return res.status(500).send('Internal Server Error');
  }
};

