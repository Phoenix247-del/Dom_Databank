const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');

// Login page
router.get('/login', authController.loginPage);

// Handle login
router.post('/login', authController.login);

// Logout
router.get('/logout', authController.logout);

module.exports = router;
