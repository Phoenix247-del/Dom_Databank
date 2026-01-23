const db = require('../config/db');

/* ================= UPLOAD FILE ================= */
exports.uploadFile = (req, res) => {
  const { folder_id } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).send('No file uploaded');
  }

  // ✅ Store a browser-friendly path (served by: app.use('/uploads', express.static(UPLOAD_ROOT)))
  // This avoids storing absolute disk paths like /var/data/... which break Preview/Print URLs.
  const webPath = `uploads/documents/${file.filename}`.replace(/\\/g, '/');

  db.query(
    'INSERT INTO files (folder_id, filename, filepath, uploaded_by) VALUES (?, ?, ?, ?)',
    [folder_id, file.originalname, webPath, req.session.user.id],
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

    db.query('SELECT * FROM folders', (err2, folders) => {
      if (err2) {
        console.error('Folder fetch error:', err2);
        return res.status(500).send('Folder load failed');
      }

      // ✅ Always pass logs
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
            return res.render('dashboard', {
              user,
              files,
              folders,
              logs: [],
              selectedFolderId: null,
              selectedFolderName: null
            });
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

  // Load selected folder files
  db.query(
    'SELECT * FROM files WHERE folder_id = ? ORDER BY uploaded_at DESC',
    [folderId],
    (err, files) => {
      if (err) {
        console.error('Folder files error:', err);
        return res.status(500).send('Could not load folder files');
      }

      // Load folders list (for modal + upload dropdown)
      db.query('SELECT * FROM folders', (err2, folders) => {
        if (err2) {
          console.error('Folders load error:', err2);
          return res.status(500).send('Could not load folders');
        }

        // Find folder name from list
        const selectedFolder = folders.find(f => String(f.id) === String(folderId));
        const selectedFolderName = selectedFolder ? selectedFolder.name : 'Selected Folder';

        // Admin logs (optional but consistent)
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
              return res.render('dashboard', {
                user,
                files,
                folders,
                logs: [],
                selectedFolderId: folderId,
                selectedFolderName
              });
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
