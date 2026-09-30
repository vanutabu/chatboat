"use strict";

const express = require("express");
const c = require("../controllers/authController");
const { requireUser } = require("../middleware/userAuth");
const { loginLimiter, signupLimiter, forgotLimiter } = require("../middleware/authRateLimit");

const router = express.Router();

router.get("/config", c.config);
router.post("/signup", signupLimiter, c.signup);
router.post("/google", loginLimiter, c.googleLogin);
router.post("/login", loginLimiter, c.login);
router.post("/logout", c.logout);
router.post("/forgot", forgotLimiter, c.forgot);
router.post("/change-password", requireUser, c.changePassword);

module.exports = router;
