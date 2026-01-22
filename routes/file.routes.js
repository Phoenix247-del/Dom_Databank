const express = require('express');
const router = express.Router();
const multer = require('multer');

const { isAuthenticated, isAdmin } = require('../middleware/auth.middleware');
const logger = require('../middleware/logger.middleware');
const controller = require('../controllers/file.controller');

/* ================= MULTER CONFIG ================= */
const storage = multer.diskStorage({
  destination: './uploads/documents',
  filename: (req, file, cb) => {
    cb(null, Date.now() + '_' + file.originalname);
  }
});

const upload = multer({ storage });

/* ================= UPLOAD FILE ================= */
router.post(
  '/upload',
  isAuthenticated,
  logger('Uploaded a file'),
  upload.single('document'),
  controller.uploadFile
);

/* ================= DELETE FILE (ADMIN ONLY) ================= */
router.delete(
  '/file/:id',
  isAuthenticated,
  isAdmin,
  logger('Deleted a file'),
  (req, res) => {
    const db = require('../config/db');
    db.query(
      'DELETE FROM files WHERE id = ?',
      [req.params.id],
      () => {
        res.sendStatus(200);
      }
    );
  }
);

/* ================= SEARCH FILES ================= */
router.get('/search', isAuthenticated, controller.searchFiles);

/* ================= LIST FILES BY FOLDER ================= */
/* Works for BOTH admin and users */
router.get('/folder/:folderId', isAuthenticated, controller.listFilesByFolder);

module.exports = router;
