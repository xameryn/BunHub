const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const passport = require('passport');
const { Strategy: DiscordStrategy } = require('passport-discord');
const multer = require('multer');
const chokidar = require('chokidar');
const { generateHLS, HLS_DIR } = require('./utils/hlsHandler');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const FILE_DIR = path.join(__dirname, 'files');

if (!fs.existsSync(FILE_DIR)) {
  fs.mkdirSync(FILE_DIR, { recursive: true });
}

// Serve files publicly
app.use('/files', express.static(FILE_DIR, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.mp4')) {
      res.set('Content-Type', 'video/mp4');
    } else if (filePath.endsWith('.webm')) {
      res.set('Content-Type', 'video/webm');
    } else if (filePath.endsWith('.mov')) {
      res.set('Content-Type', 'video/quicktime');
    }
  }
}));

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const IP_ADDRESSES = {
  dev: process.env.DEV_IP,
  local: process.env.LOCAL_IP,
  remote: process.env.REMOTE_IP,
};

if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !IP_ADDRESSES.dev || !IP_ADDRESSES.local || !IP_ADDRESSES.remote) {
  throw new Error('Missing required environment variables');
}

const whitelist = process.env.WHITELIST.split(',');
let uploadedFiles = [];

// Watch for changes in the file directory
const fileWatcher = chokidar.watch(FILE_DIR, {
  persistent: true
});

fileWatcher.on('all', (event, filePath) => {
  console.log(`File ${event} at ${filePath}`);
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
  secret: process.env.SESSION_SECRET || 'your-session-secret',
  resave: false,
  saveUninitialized: false
}));

// Initialize passport
app.use(passport.initialize());
app.use(passport.session());

// Middleware to determine callback URL based on IP address
function determineIpAddress(req, res, next) {
  const ip = req.ip;
  let ipAddress;

  if (ip.startsWith('::ffff:192.168.')) {
    ipAddress = IP_ADDRESSES.local;
  } else if (ip === '::1' || ip === '127.0.0.1') {
    ipAddress = IP_ADDRESSES.dev;
  } else {
    ipAddress = IP_ADDRESSES.remote;
  }

  console.log(`IP Address: ${ip}`);
  console.log(`Selected Callback URL: ${ipAddress}`);

  req.session.ipAddress = ipAddress;
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
  clientID: DISCORD_CLIENT_ID,
  clientSecret: DISCORD_CLIENT_SECRET,
  callbackURL: `http://${IP_ADDRESSES.remote}:${PORT}/auth/discord/callback`,
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

// Serve files publicly
app.use('/files', express.static(FILE_DIR));

// Add this near your other middleware
app.use('/hls', express.static(HLS_DIR));

// List files and their public URLs (only for logged-in users)
app.get('/files', ensureAuthenticated, (req, res) => {
  const filesWithUrls = uploadedFiles.map(file => {
    const baseUrl = `http://${IP_ADDRESSES.remote}:${PORT}`;
    let url;

    if (file.isHLS) {
      // For HLS videos, return the player page URL
      url = `${baseUrl}/player.html?video=${encodeURIComponent(file.hlsUrl)}`;
      console.log('Generated HLS player URL:', url);
    } else {
      url = `${baseUrl}/files/${encodeURIComponent(file.filename)}`;
    }

    return {
      filename: file.filename,
      uploader: file.uploader,
      url: url,
      isHLS: file.isHLS
    };
  });
  res.json(filesWithUrls);
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
app.post('/upload', ensureAuthenticated, upload.single('file'), async (req, res) => {
  try {
    const uploader = req.user.username;
    const file = req.file;
    
    // Log the file details
    console.log('Uploaded file:', {
      filename: file.originalname,
      mimetype: file.mimetype,
      size: file.size
    });

    // Check if it's a video file more comprehensively
    const videoExtensions = ['.mp4', '.webm', '.mov', '.avi'];
    const isVideo = videoExtensions.some(ext => 
      file.originalname.toLowerCase().endsWith(ext)
    );

    if (isVideo) {
      console.log('Processing video file...');
      try {
        const hlsUrl = await generateHLS(file.path, file.originalname);
        console.log('HLS URL generated:', hlsUrl);
        uploadedFiles.push({ 
          filename: file.originalname, 
          uploader,
          isHLS: true,
          hlsUrl: `http://${IP_ADDRESSES.remote}:${PORT}${hlsUrl}`
        });
      } catch (error) {
        console.error('Error generating HLS:', error);
        // Fall back to regular file handling if HLS generation fails
        uploadedFiles.push({ 
          filename: file.originalname, 
          uploader
        });
      }
    } else {
      uploadedFiles.push({ 
        filename: file.originalname, 
        uploader
      });
    }
    
    res.status(200).send('File uploaded successfully');
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).send('Error processing upload');
  }
});

// Delete files (only for logged-in users)
app.delete('/delete/:filename', ensureAuthenticated, (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(FILE_DIR, filename); // Use FILE_DIR instead of 'uploads'

  fs.unlink(filePath, (err) => {
    if (err) {
      console.error('Error deleting file:', err);
      return res.status(500).send('Error deleting file');
    }
    res.send('File deleted successfully');
  });
});

// Discord OAuth2 login route
app.get('/auth/discord', determineIpAddress, (req, res, next) => {
  const callbackURL = `http://${req.session.ipAddress}:${PORT}/auth/discord/callback`;
  console.log(`Redirecting to Discord with callback URL: ${callbackURL}`);
  passport.authenticate('discord', {
    callbackURL: callbackURL
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
  const callbackURL = `http://${req.session.ipAddress}:${PORT}/auth/discord/callback`;
  console.log(`Handling callback with URL: ${callbackURL}`);
  passport.authenticate('discord', {
    callbackURL: callbackURL,
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
    res.redirect('/');
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

const server = app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});
