require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { getComprehensiveData } = require('./app/api/comprehensive-data');
const { getResearcherResponse } = require('./app/api/researcher');
const { getModelPrediction } = require('./app/api/model-pred');

const app = express();
const PORT = process.env.PORT || 3000;

// Passport serialization stores entire profile in session for demo purposes
passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((obj, done) => {
  done(null, obj);
});

// Configure Google OAuth strategy
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: '/auth/google/callback',
    },
    (accessToken, refreshToken, profile, done) => {
      // In production persist user profile in database
      return done(null, profile);
    }
  )
);

// Middleware
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'fallback-secret',
    resave: false,
    saveUninitialized: false,
  })
);
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static('.'));

// Utility middleware to protect routes
const ensureAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
};

// Auth routes
app.get(
  '/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get(
  '/auth/google/callback',
  passport.authenticate('google', {
    failureRedirect: '/?error=login_failed',
    successRedirect: '/dashboard.html',
  })
);

app.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) {
      return next(err);
    }
    res.redirect('/');
  });
});

// API routes (protected)
app.get('/api/comprehensive-data', ensureAuthenticated, getComprehensiveData);
app.post('/api/researcher', ensureAuthenticated, getResearcherResponse);
app.post('/api/model-pred', ensureAuthenticated, getModelPrediction);

// Serve landing page and post-login dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/dashboard.html', ensureAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'app', 'information.html'));
});

app.get('/app/researcher.html', ensureAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'app', 'researcher.html'));
});

app.get('/app/model.html', ensureAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'app', 'model.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
