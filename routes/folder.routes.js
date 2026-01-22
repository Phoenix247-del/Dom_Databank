const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth.middleware');
const logger = require('../middleware/logger.middleware');
const controller = require('../controllers/folder.controller');

router.post(
  '/folder',
  isAuthenticated,
  logger('Created a folder'),
  controller.createFolder
);

module.exports = router;
