const db = require('../config/db');
const path = require('path');

/* Build a consistent public path for uploaded files.
   We serve uploads via: app.use('/uploads', express.static(UPLOAD_ROOT))
   So the URL should be: /uploads/documents/<stored_filename>

   We store in DB as: uploads/documents/<stored_filename>
*/
function buildPublicFilePath(file) {
  // multer gives `file.filename` and `file.path`
  const storedName = file.filename; // e.g. 1700000000_report.pdf
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

  return p;
}

/* ================= UPLOAD FILE ================= */
exports.uploadFile = (req, res) => {
  const { folder_id } = req.body;
  const file = req.file;

  if (!file) return res.status(400).send('No file uploaded');

  const publicPath = buildPublicFilePath(file);

  db.query(
    'INSERT INTO files (folder_id, filename, filepath, uploaded_by) VALUES (?, ?, ?, ?)',
    [folder_id, file.originalname, publicPath, req.session.user.id],
    (err) => {
      if (err) {
        console.error('File upload error:', err);
        return res.status(500).send('File upload failed');
      }
      res.redirect('/dashboard');
    }
  );
};

/* ================= SEARCH FILES ================= */
exports.searchFiles = (req, res) => {
  const { keyword, date } = req.query;
  const user = req.session.user;

  let sql = 'SELECT * FROM files WHERE 1=1';
  const params = [];

  if (keyword && keyword.trim() !== '') {
    sql += ' AND filename LIKE ?';
    params.push(`%${keyword.trim()}%`);
  }

  if (date && date !== '') {
    sql += ' AND DATE(uploaded_at) = ?';
    params.push(date);
  }

  sql += ' ORDER BY uploaded_at DESC';

  db.query(sql, params, (err, files) => {
    if (err) {
      console.error('Search error:', err);
      return res.status(500).send('Search failed');
    }

    // normalize filepaths for older records
    files = (files || []).map(f => ({ ...f, filepath: normalizeDbPath(f.filepath) }));

    db.query('SELECT * FROM folders', (err2, folders) => {
      if (err2) {
        console.error('Folder fetch error:', err2);
        return res.status(500).send('Folder load failed');
      }

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
            logs = [];
          }
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
exports.listFilesByFolder = (req, res) => {
  const user = req.session.user;
  const folderId = req.params.folderId;

  db.query(
    'SELECT * FROM files WHERE folder_id = ? ORDER BY uploaded_at DESC',
    [folderId],
    (err, files) => {
      if (err) {
        console.error('Folder files error:', err);
        return res.status(500).send('Could not load folder files');
      }

      files = (files || []).map(f => ({ ...f, filepath: normalizeDbPath(f.filepath) }));

      db.query('SELECT * FROM folders', (err2, folders) => {
        if (err2) {
          console.error('Folders load error:', err2);
          return res.status(500).send('Could not load folders');
        }

        const selectedFolder = folders.find(f => String(f.id) === String(folderId));
        const selectedFolderName = selectedFolder ? selectedFolder.name : 'Selected Folder';

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
              logs = [];
            }

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
    }
  );
};
