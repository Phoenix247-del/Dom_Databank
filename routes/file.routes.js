const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const { isAuthenticated, isAdmin } = require('../middleware/auth.middleware');
const logger = require('../middleware/logger.middleware');
const controller = require('../controllers/file.controller');

/* ================= UPLOAD PATH (PERSISTENT STORAGE READY) =================
   - Local dev (no env): ./uploads/documents
   - Railway volume: set UPLOAD_ROOT=/data/uploads and/or UPLOAD_DOCS=/data/uploads/documents
*/
const UPLOAD_ROOT = process.env.UPLOAD_ROOT || path.join(__dirname, '..', 'uploads');
const UPLOAD_DOCS = process.env.UPLOAD_DOCS || path.join(UPLOAD_ROOT, 'documents');

// Ensure folders exist
fs.mkdirSync(UPLOAD_DOCS, { recursive: true });

/* ================= MULTER CONFIG ================= */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DOCS),
  filename: (req, file, cb) => cb(null, Date.now() + '_' + file.originalname)
});

const upload = multer({ storage });

/* ================= UPLOAD FILE ================= */
router.post(
  '/upload',
  isAuthenticated,
  logger('Uploaded a file'),
  upload.array('documents', 20),
  controller.uploadFile
);

/* ================= DELETE FILE (ADMIN ONLY) =================
   (Your dashboard uses /admin/delete-file/:id POST already.)
   Keep this route for API-style delete if needed.
*/
router.delete(
  '/file/:id',
  isAuthenticated,
  isAdmin,
  logger('Deleted a file'),
  (req, res) => {
    const db = require('../config/db');
    db.query('DELETE FROM files WHERE id = ?', [req.params.id], (err) => {
      if (err) {
        console.error('Delete DB record error:', err);
        return res.status(500).send('Delete failed');
      }
      res.sendStatus(200);
    });
  }
);

/* ================= SEARCH FILES ================= */
router.get('/search', isAuthenticated, controller.searchFiles);

/* ================= LIST FILES BY FOLDER ================= */
router.get('/folder/:folderId', isAuthenticated, controller.listFilesByFolder);

module.exports = router;
