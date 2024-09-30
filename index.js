const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const passport = require('passport');
const { Strategy: DiscordStrategy } = require('passport-discord');
const multer = require('multer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT;
const FILE_DIR = path.join(__dirname, 'files');

if (!fs.existsSync(FILE_DIR)) {
  fs.mkdirSync(FILE_DIR, { recursive: true });
}

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const CALLBACK_URLS = {
  dev: process.env.DEV_CALLBACK_URL,
  local: process.env.LOCAL_CALLBACK_URL,
  remote: process.env.REMOTE_CALLBACK_URL,
};

const whitelist = process.env.WHITELIST.split(',');
let uploadedFiles = [];

// Watch for changes in the file directory
const fileWatcher = require('chokidar').watch(FILE_DIR, {
  persistent: true
});

// Send the updated file list to the client when there are changes
fileWatcher.on('all', (event, path) => {
  console.log(`File ${event} at ${path}`);
  uploadedFiles = fs.readdirSync(FILE_DIR).map(file => ({
    filename: file,
    uploader: 'unknown' // Adjust as needed to track uploader
  }));
});

// Configure Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, FILE_DIR);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});
const upload = multer({ storage });

// Configure session middleware
app.use(session({
  secret: 'your-session-secret',
  resave: false,
  saveUninitialized: false
}));

// Initialize passport
app.use(passport.initialize());
app.use(passport.session());

// Middleware to determine callback URL based on IP address
function determineCallbackURL(req, res, next) {
  const ip = req.ip;
  let callbackURL;

  if (ip.startsWith('::ffff:192.168.')) {
    callbackURL = CALLBACK_URLS.local;
  } else if (ip === '::1' || ip === '127.0.0.1') {
    callbackURL = CALLBACK_URLS.dev;
  } else {
    callbackURL = CALLBACK_URLS.remote;
  }

  console.log(`IP Address: ${ip}`);
  console.log(`Selected Callback URL: ${callbackURL}`);

  req.session.callbackURL = callbackURL;
  next();
}

// Ensure all routes except authentication require login
app.use((req, res, next) => {
  if (req.isAuthenticated() || req.path.startsWith('/auth')) {
    return next();
  } else {
    return res.redirect('/auth/discord');
  }
});

// Error-handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(500).send('Something went wrong!');
});

// Configure Passport with Discord strategy
passport.use(new DiscordStrategy({
  clientID: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  callbackURL: CALLBACK_URLS.remote, // Default callback URL
  scope: ['identify']
}, (accessToken, refreshToken, profile, done) => {
  return done(null, profile);
}));

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((obj, done) => {
  done(null, obj);
});

// Serve static files for the frontend
app.use(express.static(path.join(__dirname, 'public')));

// List files and their uploaders (only for logged-in users)
app.get('/files', ensureAuthenticated, (req, res) => {
  res.json(uploadedFiles);
});

// Download files (only for logged-in users)
app.get('/download/:filename', ensureAuthenticated, (req, res) => {
  const filePath = path.join(FILE_DIR, req.params.filename);
  res.download(filePath, err => {
    if (err) {
      res.status(404).send('File not found');
    }
  });
});

// Handle file uploads (only for logged-in users)
app.post('/upload', ensureAuthenticated, upload.single('file'), (req, res) => {
  const uploader = req.user.username;
  uploadedFiles.push({ filename: req.file.originalname, uploader });
  res.status(200).send('File uploaded successfully');
});

// Discord OAuth2 login route
app.get('/auth/discord', determineCallbackURL, (req, res, next) => {
  console.log(`Redirecting to Discord with callback URL: ${req.session.callbackURL}`);
  passport.authenticate('discord', {
    callbackURL: req.session.callbackURL
  })(req, res, next);
});

app.get('/auth-status', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({ isAuthenticated: true, username: req.user.username });
  } else {
    res.json({ isAuthenticated: false });
  }
});

// Discord OAuth2 callback route
app.get('/auth/discord/callback', (req, res, next) => {
  console.log(`Handling callback with URL: ${req.session.callbackURL}`);
  passport.authenticate('discord', {
    callbackURL: req.session.callbackURL,
    failureRedirect: '/'
  })(req, res, next);
}, (req, res) => {
  console.log(`User authenticated: ${req.user.username}`);
  if (!whitelist.includes(req.user.username)) {
    req.logout((err) => {
      if (err) {
        console.error('Error during logout:', err);
        return res.status(500).send('Error during logout');
      }
      console.log('User not whitelisted, logging out');
      return res.status(401).send('Unauthorized');
    });
  } else {
    console.log('User whitelisted, redirecting to home');
    res.redirect('/'); // Redirect to home after successful login
  }
});

// Logout route
app.get('/logout', (req, res, next) => {
  req.logout(function(err) {
    if (err) { return next(err); }
    res.redirect('/');
  });
});

// Middleware to ensure user is authenticated
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/auth/discord');
}

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
