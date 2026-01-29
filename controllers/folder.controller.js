const db = require('../config/db');

function isAdminUser(req) {
  return req.session?.user?.role === 'admin';
}

function toIntOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* ================= CREATE FOLDER (ADMIN ONLY) ================= */
exports.createFolder = (req, res) => {
  try {
    if (!isAdminUser(req)) {
      return res.redirect('/dashboard?error=' + encodeURIComponent('Only Admin can create folders.'));
    }

    const name = (req.body.name || '').trim();
    const parentId = toIntOrNull(req.body.parent_id);

    if (!name) {
      return res.redirect('/dashboard?error=' + encodeURIComponent('Folder name is required.'));
    }

    // If parent selected, validate it exists
    const insertFolder = () => {
      // Your SQL should include parent_id column. If parent_id doesn't exist yet, add it first.
      db.query(
        'INSERT INTO folders (name, created_by, parent_id) VALUES (?, ?, ?)',
        [name, req.session.user.id, parentId],
        (err) => {
          if (err) {
            console.error('Create folder error:', err);
            return res.redirect('/dashboard?error=' + encodeURIComponent('Could not create folder.'));
          }
          return res.redirect('/dashboard?success=' + encodeURIComponent('Folder created successfully.'));
        }
      );
    };

    if (!parentId) return insertFolder();

    db.query('SELECT id FROM folders WHERE id = ? LIMIT 1', [parentId], (err, rows) => {
      if (err) {
        console.error('Parent folder check error:', err);
        return res.redirect('/dashboard?error=' + encodeURIComponent('Could not verify parent folder.'));
      }
      if (!rows || rows.length === 0) {
        return res.redirect('/dashboard?error=' + encodeURIComponent('Selected parent folder not found.'));
      }
      insertFolder();
    });
  } catch (e) {
    console.error('Create folder crash:', e);
    return res.redirect('/dashboard?error=' + encodeURIComponent('Unexpected error creating folder.'));
  }
};

/* ================= RENAME FOLDER (ADMIN ONLY) ================= */
exports.renameFolder = (req, res) => {
  try {
    if (!isAdminUser(req)) {
      return res.redirect('/dashboard?error=' + encodeURIComponent('Only Admin can rename folders.'));
    }

    const folderId = req.params.id;
    const newName = ((req.body.new_name || req.body.name) || '').trim(); // supports both

    if (!newName) {
      return res.redirect('/dashboard?error=' + encodeURIComponent('New folder name is required.'));
    }

    db.query(
      'UPDATE folders SET name = ? WHERE id = ?',
      [newName, folderId],
      (err, result) => {
        if (err) {
          console.error('Rename folder error:', err);
          return res.redirect('/dashboard?error=' + encodeURIComponent('Could not rename folder.'));
        }

        if (!result || result.affectedRows === 0) {
          return res.redirect('/dashboard?error=' + encodeURIComponent('Folder not found.'));
        }

        return res.redirect('/dashboard?success=' + encodeURIComponent('Folder renamed successfully.'));
      }
    );
  } catch (e) {
    console.error('Rename folder crash:', e);
    return res.redirect('/dashboard?error=' + encodeURIComponent('Unexpected error renaming folder.'));
  }
};

/* ================= DELETE FOLDER (ADMIN ONLY) ================= */
exports.deleteFolder = (req, res) => {
  try {
    if (!isAdminUser(req)) {
      return res.redirect('/dashboard?error=' + encodeURIComponent('Only Admin can delete folders.'));
    }

    const folderId = req.params.id;

    // 1) Block delete if folder has files
    db.query(
      'SELECT COUNT(*) AS cnt FROM files WHERE folder_id = ?',
      [folderId],
      (err, rows) => {
        if (err) {
          console.error('Folder delete precheck (files) error:', err);
          return res.redirect('/dashboard?error=' + encodeURIComponent('Could not verify folder contents.'));
        }

        const fileCount = rows?.[0]?.cnt || 0;
        if (fileCount > 0) {
          return res.redirect(
            '/dashboard?error=' + encodeURIComponent('Folder has files. Delete/move files first before deleting folder.')
          );
        }

        // 2) Block delete if folder has subfolders
        db.query(
          'SELECT COUNT(*) AS cnt FROM folders WHERE parent_id = ?',
          [folderId],
          (err2, rows2) => {
            if (err2) {
              console.error('Folder delete precheck (subfolders) error:', err2);
              return res.redirect('/dashboard?error=' + encodeURIComponent('Could not verify subfolders.'));
            }

            const childCount = rows2?.[0]?.cnt || 0;
            if (childCount > 0) {
              return res.redirect(
                '/dashboard?error=' + encodeURIComponent('Folder has subfolders. Delete/move subfolders first.')
              );
            }

            // 3) Delete folder
            db.query(
              'DELETE FROM folders WHERE id = ?',
              [folderId],
              (err3, result) => {
                if (err3) {
                  console.error('Delete folder error:', err3);
                  return res.redirect('/dashboard?error=' + encodeURIComponent('Could not delete folder.'));
                }

                if (!result || result.affectedRows === 0) {
                  return res.redirect('/dashboard?error=' + encodeURIComponent('Folder not found.'));
                }

                return res.redirect('/dashboard?success=' + encodeURIComponent('Folder deleted successfully.'));
              }
            );
          }
        );
      }
    );
  } catch (e) {
    console.error('Delete folder crash:', e);
    return res.redirect('/dashboard?error=' + encodeURIComponent('Unexpected error deleting folder.'));
  }
};
