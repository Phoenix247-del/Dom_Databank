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
    if (!name) {
      return res.redirect('/dashboard?error=' + encodeURIComponent('Folder name is required.'));
    }

    db.query(
      'INSERT INTO folders (name, created_by) VALUES (?, ?)',
      [name, req.session.user.id],
      (err) => {
        if (err) {
          console.error('Create folder error:', err);
          return res.redirect('/dashboard?error=' + encodeURIComponent('Could not create folder.'));
        }
        return res.redirect('/dashboard?success=' + encodeURIComponent('Folder created successfully.'));
      }
    );
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
    const newName = (req.body.name || '').trim();

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

    // Safety: don’t delete folder that still has files
    db.query(
      'SELECT COUNT(*) AS cnt FROM files WHERE folder_id = ?',
      [folderId],
      (err, rows) => {
        if (err) {
          console.error('Folder delete precheck error:', err);
          return res.redirect('/dashboard?error=' + encodeURIComponent('Could not verify folder contents.'));
        }

        const count = rows?.[0]?.cnt || 0;
        if (count > 0) {
          return res.redirect(
            '/dashboard?error=' + encodeURIComponent('Folder has files. Delete/move files first before deleting folder.')
          );
        }

        db.query(
          'DELETE FROM folders WHERE id = ?',
          [folderId],
          (err2, result) => {
            if (err2) {
              console.error('Delete folder error:', err2);
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
  } catch (e) {
    console.error('Delete folder crash:', e);
    return res.redirect('/dashboard?error=' + encodeURIComponent('Unexpected error deleting folder.'));
  }
};
