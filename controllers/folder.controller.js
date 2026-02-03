const db = require('../config/db');

function isAdminUser(req) {
  return req.session?.user?.role === 'admin';
}

function safeReturnTo(req, fallbackOpen) {
  const candidate = (req.body?.return_to || req.query?.return_to || '').toString().trim();
  // allow only dashboard redirects
  if (candidate.startsWith('/dashboard')) return candidate;
  return fallbackOpen || '/dashboard';
}

function redirectWithMessage(req, res, type, message, fallbackOpen) {
  const base = safeReturnTo(req, fallbackOpen);
  const glue = base.includes('?') ? '&' : '?';
  return res.redirect(base + glue + type + '=' + encodeURIComponent(message));
}

// Duplicate check helper: same name not allowed inside same parent
function folderNameExists(name, parent_id, excludeId, cb) {
  const pname = (name || '').trim();
  const pid = parent_id === null ? null : Number(parent_id);

  // Match parent_id NULL or equal value
  let sql = `
    SELECT id
    FROM folders
    WHERE name = ?
      AND (
        (parent_id IS NULL AND ? IS NULL)
        OR parent_id = ?
      )
  `;
  const params = [pname, pid, pid];

  if (excludeId) {
    sql += ' AND id <> ?';
    params.push(Number(excludeId));
  }

  sql += ' LIMIT 1';

  db.query(sql, params, (err, rows) => {
    if (err) return cb(err, false);
    return cb(null, !!(rows && rows.length));
  });
}

/* ================= CREATE FOLDER (ADMIN ONLY) ================= */
exports.createFolder = (req, res) => {
  try {
    if (!isAdminUser(req)) {
      return redirectWithMessage(req, res, 'error', 'Only Admin can create folders.', '/dashboard?open=folderModal');
    }

    const name = (req.body.name || '').trim();
    const parentIdRaw = (req.body.parent_id || '').trim();
    const parent_id = parentIdRaw ? Number(parentIdRaw) : null;

    if (!name) {
      return redirectWithMessage(req, res, 'error', 'Folder name is required.', '/dashboard?open=folderModal');
    }

    if (parentIdRaw && (!Number.isFinite(parent_id) || parent_id <= 0)) {
      return redirectWithMessage(req, res, 'error', 'Invalid parent folder selected.', '/dashboard?open=folderModal');
    }

    // Ensure no duplicates in same parent
    folderNameExists(name, parent_id, null, (dupErr, exists) => {
      if (dupErr) {
        console.error('Duplicate check error:', dupErr);
        return redirectWithMessage(req, res, 'error', 'Could not verify folder name.', '/dashboard?open=folderModal');
      }
      if (exists) {
        return redirectWithMessage(
          req,
          res,
          'error',
          'A folder with this name already exists in the selected location.',
          '/dashboard?open=folderModal'
        );
      }

      const insertFolder = () => {
        db.query(
          'INSERT INTO folders (name, parent_id, created_by) VALUES (?, ?, ?)',
          [name, parent_id, req.session.user.id],
          (err) => {
            if (err) {
              console.error('Create folder error:', err);
              return redirectWithMessage(req, res, 'error', 'Could not create folder.', '/dashboard?open=folderModal');
            }
            return redirectWithMessage(req, res, 'success', 'Folder created successfully.', '/dashboard?open=folderModal');
          }
        );
      };

      if (parent_id) {
        db.query('SELECT id FROM folders WHERE id = ? LIMIT 1', [parent_id], (err, rows) => {
          if (err) {
            console.error('Parent folder check error:', err);
            return redirectWithMessage(req, res, 'error', 'Could not verify parent folder.', '/dashboard?open=folderModal');
          }
          if (!rows || rows.length === 0) {
            return redirectWithMessage(req, res, 'error', 'Parent folder not found.', '/dashboard?open=folderModal');
          }
          insertFolder();
        });
      } else {
        insertFolder();
      }
    });
  } catch (e) {
    console.error('Create folder crash:', e);
    return redirectWithMessage(req, res, 'error', 'Unexpected error creating folder.', '/dashboard?open=folderModal');
  }
};

/* ================= RENAME FOLDER (ADMIN ONLY) ================= */
exports.renameFolder = (req, res) => {
  try {
    if (!isAdminUser(req)) {
      return redirectWithMessage(req, res, 'error', 'Only Admin can rename folders.', '/dashboard?open=folderModal');
    }

    const folderId = Number(req.params.id);
    const newName = (req.body.new_name || req.body.name || '').trim();

    if (!folderId) {
      return redirectWithMessage(req, res, 'error', 'Invalid folder.', '/dashboard?open=folderModal');
    }
    if (!newName) {
      return redirectWithMessage(req, res, 'error', 'New folder name is required.', '/dashboard?open=folderModal');
    }

    // Get parent_id so we can enforce uniqueness within same parent
    db.query('SELECT id, parent_id FROM folders WHERE id = ? LIMIT 1', [folderId], (err, rows) => {
      if (err) {
        console.error('Rename fetch folder error:', err);
        return redirectWithMessage(req, res, 'error', 'Could not rename folder.', '/dashboard?open=folderModal');
      }
      if (!rows || !rows.length) {
        return redirectWithMessage(req, res, 'error', 'Folder not found.', '/dashboard?open=folderModal');
      }

      const parent_id = rows[0].parent_id === null ? null : Number(rows[0].parent_id);

      folderNameExists(newName, parent_id, folderId, (dupErr, exists) => {
        if (dupErr) {
          console.error('Rename duplicate check error:', dupErr);
          return redirectWithMessage(req, res, 'error', 'Could not verify folder name.', '/dashboard?open=folderModal');
        }
        if (exists) {
          return redirectWithMessage(
            req,
            res,
            'error',
            'A folder with this name already exists in the same location.',
            '/dashboard?open=folderModal'
          );
        }

        db.query(
          'UPDATE folders SET name = ? WHERE id = ?',
          [newName, folderId],
          (err2, result) => {
            if (err2) {
              console.error('Rename folder error:', err2);
              return redirectWithMessage(req, res, 'error', 'Could not rename folder.', '/dashboard?open=folderModal');
            }
            if (!result || result.affectedRows === 0) {
              return redirectWithMessage(req, res, 'error', 'Folder not found.', '/dashboard?open=folderModal');
            }
            return redirectWithMessage(req, res, 'success', 'Folder renamed successfully.', '/dashboard?open=folderModal');
          }
        );
      });
    });
  } catch (e) {
    console.error('Rename folder crash:', e);
    return redirectWithMessage(req, res, 'error', 'Unexpected error renaming folder.', '/dashboard?open=folderModal');
  }
};

/* ================= DELETE FOLDER (ADMIN ONLY) ================= */
exports.deleteFolder = (req, res) => {
  try {
    if (!isAdminUser(req)) {
      return redirectWithMessage(req, res, 'error', 'Only Admin can delete folders.', '/dashboard?open=folderModal');
    }

    const folderId = Number(req.params.id);
    if (!folderId) {
      return redirectWithMessage(req, res, 'error', 'Invalid folder.', '/dashboard?open=folderModal');
    }

    // Safety 1: don’t delete folder that has files
    db.query('SELECT COUNT(*) AS cnt FROM files WHERE folder_id = ?', [folderId], (err, rows) => {
      if (err) {
        console.error('Folder delete file precheck error:', err);
        return redirectWithMessage(req, res, 'error', 'Could not verify folder contents.', '/dashboard?open=folderModal');
      }

      const fileCount = rows?.[0]?.cnt || 0;
      if (fileCount > 0) {
        return redirectWithMessage(req, res, 'error', 'Folder has files. Delete/move files first.', '/dashboard?open=folderModal');
      }

      // Safety 2: don’t delete folder that has child folders
      db.query('SELECT COUNT(*) AS cnt FROM folders WHERE parent_id = ?', [folderId], (err2, rows2) => {
        if (err2) {
          console.error('Folder delete child precheck error:', err2);
          return redirectWithMessage(req, res, 'error', 'Could not verify subfolders.', '/dashboard?open=folderModal');
        }

        const childCount = rows2?.[0]?.cnt || 0;
        if (childCount > 0) {
          return redirectWithMessage(req, res, 'error', 'Folder has subfolders. Delete/move them first.', '/dashboard?open=folderModal');
        }

        db.query('DELETE FROM folders WHERE id = ?', [folderId], (err3, result) => {
          if (err3) {
            console.error('Delete folder error:', err3);
            return redirectWithMessage(req, res, 'error', 'Could not delete folder.', '/dashboard?open=folderModal');
          }
          if (!result || result.affectedRows === 0) {
            return redirectWithMessage(req, res, 'error', 'Folder not found.', '/dashboard?open=folderModal');
          }
          return redirectWithMessage(req, res, 'success', 'Folder deleted successfully.', '/dashboard?open=folderModal');
        });
      });
    });
  } catch (e) {
    console.error('Delete folder crash:', e);
    return redirectWithMessage(req, res, 'error', 'Unexpected error deleting folder.', '/dashboard?open=folderModal');
  }
};
1