const express = require('express');
const router = express.Router();

const { isAuthenticated, isAdmin } = require('../middleware/auth.middleware');
const logger = require('../middleware/logger.middleware');
const controller = require('../controllers/folder.controller');

/**
 * Create folder (ADMIN ONLY)
 * POST /folder
 * Supports optional parent_id for nested folders
 */
router.post(
  '/folder',
  isAuthenticated,
  isAdmin,
  logger('Created a folder'),
  controller.createFolder
);

/**
 * Rename folder (ADMIN ONLY)
 * POST /folder/:id/rename
 */
router.post(
  '/folder/:id/rename',
  isAuthenticated,
  isAdmin,
  logger('Renamed a folder'),
  controller.renameFolder
);

/**
 * Delete folder (ADMIN ONLY)
 * POST /folder/:id/delete
 * Blocks delete if folder has files OR subfolders
 */
router.post(
  '/folder/:id/delete',
  isAuthenticated,
  isAdmin,
  logger('Deleted a folder'),
  controller.deleteFolder
);

module.exports = router;
