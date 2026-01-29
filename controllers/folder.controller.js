const db = require('../config/db');

function isAdminUser(req) {
  return req.session?.user?.role === 'admin';
}

/* ================= CREATE FOLDER (ADMIN ONLY) ================= */
exports.createFolder = (req, res) => {
  try {
    if (!isAdminUser(req)) {
      return res.redirect('/dashboard?error=' + encodeURIComponent('Only Admin can create folders.'));
    }

    const name = (req.body.name || '').trim();
    const parentIdRaw = (req.body.parent_id || '').trim();
    const parent_id = parentIdRaw ? Number(parentIdRaw) : null;

    if (!name) {
      return res.redirect('/dashboard?error=' + encodeURIComponent('Folder name is required.'));
    }

    if (parentIdRaw && (!Number.isFinite(parent_id) || parent_id <= 0)) {
      return res.redirect('/dashboard?error=' + encodeURIComponent('Invalid parent folder selected.'));
    }

    // If parent_id provided, ensure it exists
    const insertFolder = () => {
      db.query(
        'INSERT INTO folders (name, parent_id, created_by) VALUES (?, ?, ?)',
        [name, parent_id, req.session.user.id],
        (err) => {
          if (err) {
            console.error('Create folder error:', err);
            return res.redirect('/dashboard?error=' + encodeURIComponent('Could not create folder.'));
          }
          return res.redirect('/dashboard?success=' + encodeURIComponent('Folder created successfully.'));
        }
      );
    };

    if (parent_id) {
      db.query('SELECT id FROM folders WHERE id = ? LIMIT 1', [parent_id], (err, rows) => {
        if (err) {
          console.error('Parent folder check error:', err);
          return res.redirect('/dashboard?error=' + encodeURIComponent('Could not verify parent folder.'));
        }
        if (!rows || rows.length === 0) {
          return res.redirect('/dashboard?error=' + encodeURIComponent('Parent folder not found.'));
        }
        insertFolder();
      });
    } else {
      insertFolder();
    }
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

    const folderId = Number(req.params.id);
    const newName = (req.body.new_name || req.body.name || '').trim();

    if (!folderId) {
      return res.redirect('/dashboard?error=' + encodeURIComponent('Invalid folder.'));
    }
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

    const folderId = Number(req.params.id);
    if (!folderId) {
      return res.redirect('/dashboard?error=' + encodeURIComponent('Invalid folder.'));
    }

    // Safety 1: don’t delete folder that has files
    db.query('SELECT COUNT(*) AS cnt FROM files WHERE folder_id = ?', [folderId], (err, rows) => {
      if (err) {
        console.error('Folder delete file precheck error:', err);
        return res.redirect('/dashboard?error=' + encodeURIComponent('Could not verify folder contents.'));
      }

      const fileCount = rows?.[0]?.cnt || 0;
      if (fileCount > 0) {
        return res.redirect('/dashboard?error=' + encodeURIComponent('Folder has files. Delete/move files first.'));
      }

      // Safety 2: don’t delete folder that has child folders
      db.query('SELECT COUNT(*) AS cnt FROM folders WHERE parent_id = ?', [folderId], (err2, rows2) => {
        if (err2) {
          console.error('Folder delete child precheck error:', err2);
          return res.redirect('/dashboard?error=' + encodeURIComponent('Could not verify subfolders.'));
        }

        const childCount = rows2?.[0]?.cnt || 0;
        if (childCount > 0) {
          return res.redirect('/dashboard?error=' + encodeURIComponent('Folder has subfolders. Delete/move them first.'));
        }

        db.query('DELETE FROM folders WHERE id = ?', [folderId], (err3, result) => {
          if (err3) {
            console.error('Delete folder error:', err3);
            return res.redirect('/dashboard?error=' + encodeURIComponent('Could not delete folder.'));
          }
          if (!result || result.affectedRows === 0) {
            return res.redirect('/dashboard?error=' + encodeURIComponent('Folder not found.'));
          }
          return res.redirect('/dashboard?success=' + encodeURIComponent('Folder deleted successfully.'));
        });
      });
    });
  } catch (e) {
    console.error('Delete folder crash:', e);
    return res.redirect('/dashboard?error=' + encodeURIComponent('Unexpected error deleting folder.'));
  }
};
