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
  const user = req.session.user;
  // folder_id can arrive as a string OR an array (e.g., when multiple inputs share the same name)
  let folderRaw = req.body.folder_id;
  if (Array.isArray(folderRaw)) {
    // pick the last non-empty value
    folderRaw = [...folderRaw].reverse().find(v => String(v || '').trim() !== '') || '';
  }
  const folder_id = Number(String(folderRaw || '').trim());
  const file = req.file;

  if (!file) return res.status(400).send('No file uploaded');
  if (!Number.isFinite(folder_id) || folder_id <= 0) return res.status(400).send('Folder is required');

  // ✅ ENFORCE: user can only upload to assigned folders
  if (user.role !== 'admin') {
    const ok = await userHasFolderAccess(user.id, folder_id);
    if (!ok) return res.status(403).send('You are not allowed to upload to this folder');
  }

  const publicPath = buildPublicFilePath(file);

  db.query(
    'INSERT INTO files (folder_id, filename, filepath, uploaded_by) VALUES (?, ?, ?, ?)',
    [folder_id, file.originalname, publicPath, user.id],
    (err) => {
      if (err) {
        console.error('File upload error:', err);
        return res.status(500).send('File upload failed');
      }
      // Keep File Management modal open and preserve selected folder after upload
      // so users can upload multiple files without re-selecting the folder.
      const glue = '?';
      const qs = `open=fileModal&folder_id=${encodeURIComponent(String(folder_id))}`;
      return res.redirect(`/dashboard${glue}${qs}&success=${encodeURIComponent('File uploaded successfully.')}`);
    }
  );
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
  const user = req.session.user;
  const folderId = Number(req.params.folderId);

  if (!folderId) return res.status(400).send('Invalid folder');

  // ✅ ENFORCE: users can only open folders they are assigned to
  if (user.role !== 'admin') {
    const ok = await userHasFolderAccess(user.id, folderId);
    if (!ok) return res.status(403).send('You are not assigned to this folder');
  }

  loadFilesForUser(user, { folderId }, (err, files) => {
    if (err) {
      console.error('Folder files error:', err);
      return res.status(500).send('Could not load folder files');
    }

    files = (files || []).map(f => ({ ...f, filepath: normalizeDbPath(f.filepath) }));

    loadFoldersForUser(user, (err2, folders) => {
      if (err2) {
        console.error('Folders load error:', err2);
        return res.status(500).send('Could not load folders');
      }

      const selectedFolder = (folders || []).find(f => String(f.id) === String(folderId));
      const selectedFolderName = selectedFolder ? selectedFolder.name : 'Selected Folder';

      if (user.role === 'admin') {
        loadLogs((err3, logs) => {
          if (err3) logs = [];
          return res.render('dashboard', {
            user,
            files,
            folders,
            logs,
            selectedFolderId: folderId,
            selectedFolderName
          });
        });
      } else {
        return res.render('dashboard', {
          user,
          files,
          folders,
          logs: [],
          selectedFolderId: folderId,
          selectedFolderName
        });
      }
    });
  });
};
