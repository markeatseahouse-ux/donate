const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const axios = require('axios');
const generatePayload = require('promptpay-qr');
const bcrypt = require('bcryptjs');
const cookieSession = require('cookie-session');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Paths and Directory Setup
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const LOGOS_DIR = path.join(UPLOADS_DIR, 'logos');
const BANNERS_DIR = path.join(UPLOADS_DIR, 'banners');
const SOUNDS_DIR = path.join(UPLOADS_DIR, 'sounds');

[DATA_DIR, UPLOADS_DIR, LOGOS_DIR, BANNERS_DIR, SOUNDS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const USERS_PATH = path.join(DATA_DIR, 'users.json');
const CONFIGS_PATH = path.join(DATA_DIR, 'configs.json');
const DONATIONS_PATH = path.join(DATA_DIR, 'donations.json');

// Session setup
app.use(cookieSession({
  name: 'session',
  keys: [process.env.SESSION_SECRET || 'secret-key-seahouse-overlay-app-99'],
  maxAge: 24 * 60 * 60 * 1000 // 24 hours
}));

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Middleware to redirect unauthenticated admin views
app.get('/admin.html', (req, res, next) => {
  if (!req.session.userId) {
    return res.redirect('/login.html');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Data Helpers
function loadUsers() {
  if (!fs.existsSync(USERS_PATH)) fs.writeFileSync(USERS_PATH, JSON.stringify([]));
  return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8') || '[]');
}

function saveUsers(users) {
  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));
}

function loadConfigs() {
  if (!fs.existsSync(CONFIGS_PATH)) fs.writeFileSync(CONFIGS_PATH, JSON.stringify([]));
  return JSON.parse(fs.readFileSync(CONFIGS_PATH, 'utf8') || '[]');
}

function saveConfigs(configs) {
  fs.writeFileSync(CONFIGS_PATH, JSON.stringify(configs, null, 2));
}

function loadDonations() {
  if (!fs.existsSync(DONATIONS_PATH)) fs.writeFileSync(DONATIONS_PATH, JSON.stringify([]));
  return JSON.parse(fs.readFileSync(DONATIONS_PATH, 'utf8') || '[]');
}

function saveDonations(donations) {
  fs.writeFileSync(DONATIONS_PATH, JSON.stringify(donations, null, 2));
}

// Config Defaults Maker
function makeDefaultConfig(userId) {
  return {
    userId,
    promptpayId: '0812345678', 
    verifyMode: 'simulate',    
    easyslipApiKey: '',
    streamerName: 'SEAHOUSE STREAM',
    streamerDescription: 'ขอบคุณทุกแรงสนับสนุนสำหรับการพัฒนาช่องและคอมมูนิตี้ของเราครับ!',
    bannedWords: 'ควย,สัส,เหี้ย,มึง,เย็ด,จู๋,หี,แตด,ชิบหาย,ฟาย,shyt,darn,fck',
    requireApproval: false,
    minAmountTts: 1,
    minDonateAmount: 1,
    ttsSpeed: 1.0,
    ttsPitch: 1.0,
    soundVolume: 0.8,
    overlayAccentColor: '#ff007f', 
    overlayTextColor: '#ffffff',
    alertAnimation: 'slide',
    alertSoundFile: '',
    goalEnabled: false,
    goalTitle: 'สมทบทุนซื้ออุปกรณ์สตรีม',
    goalTarget: 5000,
    goalCurrent: 0,
    viewerAccentColor: '#8a2be2',
    viewerBannerFile: ''
  };
}

// Automatic Migration helper (Imports legacy single-user config.json and donations.json)
(function migrateLegacyData() {
  const legacyConfigPath = path.join(__dirname, 'config.json');
  const legacyDonationsPath = path.join(__dirname, 'donations.json');
  
  if (fs.existsSync(legacyConfigPath)) {
    console.log('[Migration] Legacy config file detected. Starting data migration...');
    const users = loadUsers();
    
    // Check if we already migrated
    if (users.length === 0) {
      const defaultUserId = 'usr_' + Date.now();
      const defaultPassword = 'admin123';
      const salt = bcrypt.genSaltSync(10);
      const passwordHash = bcrypt.hashSync(defaultPassword, salt);
      
      const adminUser = {
        id: defaultUserId,
        username: 'admin',
        passwordHash,
        role: 'admin',
        createdAt: new Date().toISOString()
      };
      
      users.push(adminUser);
      saveUsers(users);
      console.log(`[Migration] Created default 'admin' account with password 'admin123'`);
      
      // Migrate Config
      let legacyConfig = {};
      try {
        legacyConfig = JSON.parse(fs.readFileSync(legacyConfigPath, 'utf8'));
      } catch(err) {
        console.error('Failed to parse legacy config', err);
      }
      
      const baseDefaults = makeDefaultConfig(defaultUserId);
      const migratedConfig = Object.assign({}, baseDefaults, legacyConfig, { userId: defaultUserId });
      
      const configs = loadConfigs();
      configs.push(migratedConfig);
      saveConfigs(configs);
      
      // Migrate Image Assets if they exist
      const legacyLogo = path.join(__dirname, 'public', 'streamer_logo.jpg');
      if (fs.existsSync(legacyLogo)) {
        fs.copyFileSync(legacyLogo, path.join(LOGOS_DIR, `${defaultUserId}.jpg`));
      }
      const legacyBanner = path.join(__dirname, 'public', 'streamer_banner.jpg');
      if (fs.existsSync(legacyBanner)) {
        fs.copyFileSync(legacyBanner, path.join(BANNERS_DIR, `${defaultUserId}.jpg`));
      }
      
      // Migrate Donations
      if (fs.existsSync(legacyDonationsPath)) {
        let legacyDonations = [];
        try {
          legacyDonations = JSON.parse(fs.readFileSync(legacyDonationsPath, 'utf8'));
        } catch(err) {}
        
        const migratedDonations = legacyDonations.map(d => {
          return Object.assign({}, d, { userId: defaultUserId });
        });
        
        const donations = loadDonations();
        saveDonations(donations.concat(migratedDonations));
      }
      
      // Rename files to prevent duplicate migrations
      try {
        fs.renameSync(legacyConfigPath, legacyConfigPath + '.bak');
        if (fs.existsSync(legacyDonationsPath)) {
          fs.renameSync(legacyDonationsPath, legacyDonationsPath + '.bak');
        }
        console.log('[Migration] Single-user config successfully migrated to multi-tenant DB.');
      } catch (err) {
        console.error('[Migration] Failed renaming backup files:', err);
      }
    }
  }
})();

// Advanced Profanity filter with safe-words check for Thai compatibility
function filterProfanity(text, bannedWordsStr) {
  if (!text) return '';
  if (!bannedWordsStr) return text;
  
  const safeWords = [
    "ยอม", "หอม", "ผอม", "ซ่อม", "ปลอม", "พร้อม", "ออม", "จอม", "ถนอม", "มอม", 
    "คอม", "ซ้อม", "ตรอม", "กลม", "หีบ", "กูรู", "กูเกิล", "กูเกิ้ล", "กระดูก", 
    "ฤดู", "ชมพู", "กู๊ด", "ปฐม", "พะยอม", "ถนอม", "ล้อม", "ส้อม", "ออมสิน"
  ];
  
  const words = bannedWordsStr.split(',').map(w => w.trim()).filter(w => w.length > 0);
  let filtered = text;
  
  for (const word of words) {
    if (word.length === 0) continue;
    
    const isEnglish = /^[A-Za-z0-9\s]+$/.test(word);
    let regex;
    if (isEnglish) {
      const escapedWord = word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      regex = new RegExp('\\b' + escapedWord + '\\b', 'gi');
    } else {
      const escapedWord = word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      regex = new RegExp(escapedWord, 'gi');
    }
    
    filtered = filtered.replace(regex, (match, offset) => {
      const startContext = Math.max(0, offset - 5);
      const endContext = Math.min(text.length, offset + match.length + 5);
      const contextText = text.substring(startContext, endContext);
      
      for (const safe of safeWords) {
        if (contextText.includes(safe)) {
          const matchInContextIndex = offset - startContext;
          const safeInContextIndex = contextText.indexOf(safe);
          
          if (safeInContextIndex !== -1 && 
              matchInContextIndex >= safeInContextIndex && 
              (matchInContextIndex + match.length) <= (safeInContextIndex + safe.length)) {
            return match; 
          }
        }
      }
      return '*'.repeat(match.length);
    });
  }
  return filtered;
}

// Bank Notification Regex Parser
function parseNotificationText(title, text) {
  let amount = null;
  let sender = 'ผู้สนับสนุนนิรนาม';
  
  if (!text) return { amount, sender };
  
  const cleanText = text.replace(/,/g, '');
  
  const amountRegex = /(\d+(\.\d{2})?)\s*(บาท|บ\.)/i;
  const amountMatch = cleanText.match(amountRegex);
  if (amountMatch) {
    amount = parseFloat(amountMatch[1]);
  } else {
    const fallbackAmountRegex = /(?:จำนวน|ยอดเงิน|เงินเข้า|เข้า)\s*(\d+(\.\d{2})?)/i;
    const fallbackMatch = cleanText.match(fallbackAmountRegex);
    if (fallbackMatch) {
      amount = parseFloat(fallbackMatch[1]);
    }
  }
  
  const senderRegex = /(?:จาก|โดย|จากบัญชี)\s*(นาย|นาง|น\.ส\.|คุณ)?\s*([A-Za-zก-๙\s\.\-_]+)/i;
  const senderMatch = cleanText.match(senderRegex);
  if (senderMatch) {
    let namePart = senderMatch[2].trim();
    namePart = namePart.split(/(?:เวลา|บช\.|บัญชี|ยอด|\d{2}\.\d{2}|\d{2}:\d{2}|โอนเข้า)/i)[0].trim();
    if (namePart) {
      sender = namePart;
    }
  }
  
  return { amount, sender };
}

// Safe helper to complete payment logic
function completePayment(donation, config, username) {
  donation.status = config.requireApproval ? 'pending_approval' : 'paid';
  donation.paidAt = new Date().toISOString();
  
  // Increment Goal progress if enabled AND NOT a simulation
  if (config.goalEnabled && !donation.isSimulation) {
    config.goalCurrent = (config.goalCurrent || 0) + donation.amount;
    const configs = loadConfigs();
    const configIndex = configs.findIndex(c => c.userId === config.userId);
    if (configIndex !== -1) {
      configs[configIndex] = config;
      saveConfigs(configs);
    }
    // Broadcast goal update inside channel room
    io.to(username.toLowerCase()).emit('goal-update', {
      title: config.goalTitle,
      target: config.goalTarget,
      current: config.goalCurrent,
      enabled: config.goalEnabled
    });
  }

  if (config.requireApproval) {
    // Send only to active admin console
    io.to(username.toLowerCase()).emit('admin-pending-approval', donation);
  } else {
    // Send to channel overlays
    io.to(username.toLowerCase()).emit('donation-alert', {
      id: donation.id,
      name: donation.name,
      senderRealName: donation.senderName || donation.name,
      message: donation.message,
      amount: donation.amount,
      timestamp: donation.paidAt
    });
  }
}

// Socket Connection Handler
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  // Scoped room register
  socket.on('join-room', (username) => {
    if (!username) return;
    const cleanRoom = username.trim().toLowerCase();
    socket.join(cleanRoom);
    console.log(`Socket ${socket.id} joined room: ${cleanRoom}`);
    
    // Emit correct goal update
    const users = loadUsers();
    const targetUser = users.find(u => u.username.toLowerCase() === cleanRoom);
    if (targetUser) {
      const configs = loadConfigs();
      const config = configs.find(c => c.userId === targetUser.id);
      if (config) {
        socket.emit('goal-update', {
          title: config.goalTitle,
          target: config.goalTarget,
          current: config.goalCurrent,
          enabled: config.goalEnabled
        });
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// --- API AUTHENTICATION ENDPOINTS ---

app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'กรุณากรอก Username และ Password' });
  }
  
  const cleanUsername = username.trim().toLowerCase();
  if (cleanUsername.length < 3 || !/^[a-zA-Z0-9_\-]+$/.test(cleanUsername)) {
    return res.status(400).json({ error: 'Username ต้องมีความยาว 3 ตัวอักษรขึ้นไป และสามารถใช้ได้เฉพาะ A-Z, 0-9, _, - เท่านั้น' });
  }

  const users = loadUsers();
  if (users.find(u => u.username.toLowerCase() === cleanUsername)) {
    return res.status(400).json({ error: 'ชื่อผู้ใช้งานนี้ถูกสมัครไปแล้ว' });
  }

  const userId = 'usr_' + Date.now();
  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync(password, salt);

  const newUser = {
    id: userId,
    username: cleanUsername,
    passwordHash,
    role: 'streamer',
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  saveUsers(users);

  // Initialize Default configs
  const configs = loadConfigs();
  const defConfig = makeDefaultConfig(userId);
  configs.push(defConfig);
  saveConfigs(configs);

  req.session.userId = userId;
  res.json({ success: true, user: { id: userId, username: cleanUsername } });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
  }

  const cleanUsername = username.trim().toLowerCase();
  const users = loadUsers();
  const user = users.find(u => u.username.toLowerCase() === cleanUsername);

  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง' });
  }

  req.session.userId = user.id;
  res.json({ success: true, user: { id: user.id, username: user.username } });
});

app.post('/api/auth/logout', (req, res) => {
  req.session = null;
  res.json({ success: true });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const users = loadUsers();
  const user = users.find(u => u.id === req.session.userId);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }
  res.json({ user: { id: user.id, username: user.username, role: user.role } });
});

// --- SCAPED CONFIG & ASSET APIS ---

app.get('/api/config', (req, res) => {
  const targetUsername = req.query.username;
  const configs = loadConfigs();
  
  if (targetUsername) {
    // Public fetch scoped config by username (Viewer or OBS Overlay queries)
    const users = loadUsers();
    const user = users.find(u => u.username.toLowerCase() === targetUsername.trim().toLowerCase());
    if (!user) {
      return res.status(404).json({ error: 'Streamer not found' });
    }
    const config = configs.find(c => c.userId === user.id);
    if (!config) return res.status(404).json({ error: 'Config not initialized' });
    
    // Sanitize secret API tokens for public requests
    const publicConfig = Object.assign({}, config);
    delete publicConfig.easyslipApiKey;
    publicConfig.userId = user.id;
    return res.json(publicConfig);
  }

  // Admin scopes configs
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  
  let config = configs.find(c => c.userId === req.session.userId);
  if (!config) {
    config = makeDefaultConfig(req.session.userId);
    configs.push(config);
    saveConfigs(configs);
  }
  res.json(config);
});

app.post('/api/config', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  
  const configs = loadConfigs();
  const configIndex = configs.findIndex(c => c.userId === req.session.userId);
  
  if (configIndex === -1) {
    return res.status(404).json({ error: 'Config entity not found' });
  }

  const existingConfig = configs[configIndex];
  const { 
    promptpayId, verifyMode, easyslipApiKey, streamerName, streamerDescription,
    bannedWords, requireApproval, minAmountTts, minDonateAmount, ttsSpeed, ttsPitch, soundVolume,
    overlayAccentColor, overlayTextColor, alertAnimation, alertSoundFile,
    goalEnabled, goalTitle, goalTarget, goalCurrent,
    viewerAccentColor, viewerBannerFile
  } = req.body;

  const updatedConfig = Object.assign({}, existingConfig, {
    promptpayId: promptpayId || existingConfig.promptpayId,
    verifyMode: verifyMode || existingConfig.verifyMode,
    easyslipApiKey: easyslipApiKey !== undefined ? easyslipApiKey : existingConfig.easyslipApiKey,
    streamerName: streamerName || existingConfig.streamerName,
    streamerDescription: streamerDescription !== undefined ? streamerDescription : existingConfig.streamerDescription,
    bannedWords: bannedWords !== undefined ? bannedWords : existingConfig.bannedWords,
    requireApproval: requireApproval !== undefined ? !!requireApproval : existingConfig.requireApproval,
    minAmountTts: minAmountTts !== undefined ? Number(minAmountTts) : existingConfig.minAmountTts,
    minDonateAmount: minDonateAmount !== undefined ? Number(minDonateAmount) : existingConfig.minDonateAmount,
    ttsSpeed: ttsSpeed !== undefined ? Number(ttsSpeed) : existingConfig.ttsSpeed,
    ttsPitch: ttsPitch !== undefined ? Number(ttsPitch) : existingConfig.ttsPitch,
    soundVolume: soundVolume !== undefined ? Number(soundVolume) : existingConfig.soundVolume,
    overlayAccentColor: overlayAccentColor || existingConfig.overlayAccentColor,
    overlayTextColor: overlayTextColor || existingConfig.overlayTextColor,
    alertAnimation: alertAnimation || existingConfig.alertAnimation,
    alertSoundFile: alertSoundFile !== undefined ? alertSoundFile : existingConfig.alertSoundFile,
    goalEnabled: goalEnabled !== undefined ? !!goalEnabled : existingConfig.goalEnabled,
    goalTitle: goalTitle || existingConfig.goalTitle,
    goalTarget: goalTarget !== undefined ? Number(goalTarget) : existingConfig.goalTarget,
    goalCurrent: goalCurrent !== undefined ? Number(goalCurrent) : existingConfig.goalCurrent,
    viewerAccentColor: viewerAccentColor || existingConfig.viewerAccentColor,
    viewerBannerFile: viewerBannerFile !== undefined ? viewerBannerFile : existingConfig.viewerBannerFile
  });

  configs[configIndex] = updatedConfig;
  saveConfigs(configs);

  // Broadcast dynamic update to goal OBS widgets
  const users = loadUsers();
  const user = users.find(u => u.id === req.session.userId);
  if (user) {
    io.to(user.username.toLowerCase()).emit('goal-update', {
      title: updatedConfig.goalTitle,
      target: updatedConfig.goalTarget,
      current: updatedConfig.goalCurrent,
      enabled: updatedConfig.goalEnabled
    });
  }

  res.json({ message: 'Configuration saved successfully', config: updatedConfig });
});

// Logo Custom Upload
app.post('/api/upload-logo', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const { imageBase64 } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'No image data provided' });
  
  try {
    const buffer = Buffer.from(imageBase64, 'base64');
    const targetPath = path.join(LOGOS_DIR, `${req.session.userId}.jpg`);
    fs.writeFileSync(targetPath, buffer);
    res.json({ success: true, message: 'Logo successfully updated' });
  } catch (error) {
    console.error('Logo upload error:', error);
    res.status(500).json({ error: 'Failed uploading logo' });
  }
});

// Banner Custom Upload
app.post('/api/upload-banner', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const { imageBase64 } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'No image data provided' });
  
  try {
    const buffer = Buffer.from(imageBase64, 'base64');
    const targetPath = path.join(BANNERS_DIR, `${req.session.userId}.jpg`);
    fs.writeFileSync(targetPath, buffer);
    
    const configs = loadConfigs();
    const configIndex = configs.findIndex(c => c.userId === req.session.userId);
    if (configIndex !== -1) {
      configs[configIndex].viewerBannerFile = `/uploads/banners/${req.session.userId}.jpg`;
      saveConfigs(configs);
    }
    
    res.json({ success: true, message: 'Banner successfully updated' });
  } catch (error) {
    console.error('Banner upload error:', error);
    res.status(500).json({ error: 'Failed uploading banner' });
  }
});

// Custom sound file upload endpoint
app.post('/api/upload-sound', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const { soundBase64, filename } = req.body;
  if (!soundBase64) return res.status(400).json({ error: 'No sound data provided' });
  
  try {
    const ext = path.extname(filename || 'alert.mp3').toLowerCase();
    const buffer = Buffer.from(soundBase64, 'base64');
    const targetFilename = `${req.session.userId}${ext}`;
    const targetPath = path.join(SOUNDS_DIR, targetFilename);
    
    fs.writeFileSync(targetPath, buffer);
    
    const configs = loadConfigs();
    const configIndex = configs.findIndex(c => c.userId === req.session.userId);
    if (configIndex !== -1) {
      configs[configIndex].alertSoundFile = `/uploads/sounds/${targetFilename}`;
      saveConfigs(configs);
    }
    
    res.json({ success: true, message: 'Sound uploaded successfully', filename: `/uploads/sounds/${targetFilename}` });
  } catch (error) {
    console.error('Sound upload error:', error);
    res.status(500).json({ error: 'Failed uploading audio sound' });
  }
});

// --- DONATIONS APIS ---

app.get('/api/donations', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const donations = loadDonations();
  res.json(donations.filter(d => d.userId === req.session.userId));
});

app.post('/api/donate', (req, res) => {
  const { name, message, amount, username } = req.body;
  
  if (!username) return res.status(400).json({ error: 'Username target is required' });
  if (!name || !amount || isNaN(amount) || parseFloat(amount) <= 0) {
    return res.status(400).json({ error: 'Invalid name or amount' });
  }

  const users = loadUsers();
  const targetUser = users.find(u => u.username.toLowerCase() === username.trim().toLowerCase());
  if (!targetUser) return res.status(400).json({ error: 'สตรีมเมอร์เป้าหมายไม่ปรากฏในระบบ' });
  
  const configs = loadConfigs();
  const config = configs.find(c => c.userId === targetUser.id);
  if (!config) return res.status(400).json({ error: 'Config details missing' });
  
  // Enforce general minimum validation
  const minAmount = Number(config.minDonateAmount) || 1;
  if (parseFloat(amount) < minAmount) {
    return res.status(400).json({ error: `จำนวนเงินสนับสนุนต่ำกว่าเกณฑ์ขั้นต่ำ (${minAmount} บาท)` });
  }
  
  // Filter profanity
  const filteredName = filterProfanity(name.trim(), config.bannedWords);
  const filteredMessage = filterProfanity((message || '').trim(), config.bannedWords);
  
  const donationId = 'don_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  const qrPayload = generatePayload(config.promptpayId, { amount: parseFloat(amount) });
  
  const donation = {
    id: donationId,
    userId: targetUser.id,
    name: filteredName,
    message: filteredMessage,
    amount: parseFloat(amount),
    status: 'pending',
    qrPayload,
    createdAt: new Date().toISOString()
  };
  
  const donations = loadDonations();
  donations.push(donation);
  saveDonations(donations);
  
  res.json({
    success: true,
    donationId,
    qrPayload,
    amount: donation.amount
  });
});

app.post('/api/simulate-success', (req, res) => {
  const { donationId } = req.body;
  const donations = loadDonations();
  const donationIndex = donations.findIndex(d => d.id === donationId);
  
  if (donationIndex === -1) return res.status(404).json({ error: 'Donation not found' });
  const donation = donations[donationIndex];
  
  if (donation.status === 'paid' || donation.status === 'pending_approval') {
    return res.status(400).json({ error: 'Donation already processed' });
  }
  
  const users = loadUsers();
  const user = users.find(u => u.id === donation.userId);
  if (!user) return res.status(400).json({ error: 'Associated user missing' });
  
  const configs = loadConfigs();
  const config = configs.find(c => c.userId === donation.userId);
  
  donation.isSimulation = true;
  donation.verificationMethod = 'Simulation';
  completePayment(donation, config, user.username);
  saveDonations(donations);
  
  res.json({ success: true, donation });
});

app.post('/api/verify', async (req, res) => {
  const { qrData, donationId } = req.body;
  if (!qrData || !donationId) {
    return res.status(400).json({ error: 'QR Data and Donation ID are required' });
  }
  
  const donations = loadDonations();
  const donationIndex = donations.findIndex(d => d.id === donationId);
  if (donationIndex === -1) return res.status(404).json({ error: 'Donation not found' });
  
  const donation = donations[donationIndex];
  if (donation.status === 'paid' || donation.status === 'pending_approval') {
    return res.json({ success: true, message: 'Already processed', donation });
  }

  const users = loadUsers();
  const user = users.find(u => u.id === donation.userId);
  if (!user) return res.status(400).json({ error: 'Target user missing' });

  const configs = loadConfigs();
  const config = configs.find(c => c.userId === donation.userId);
  
  if (config.verifyMode === 'simulate') {
    donation.isSimulation = true;
    donation.verificationMethod = 'Simulation';
    completePayment(donation, config, user.username);
    saveDonations(donations);
    return res.json({ success: true, message: 'Simulated payment verified', donation });
  }
  
  const duplicate = donations.find(d => d.slipQrData === qrData && (d.status === 'paid' || d.status === 'pending_approval'));
  if (duplicate) {
    return res.status(400).json({ error: 'สลิปนี้ถูกใช้ไปแล้ว (Duplicate Slip QR Code)' });
  }
  
  if (!config.easyslipApiKey) {
    if (qrData.startsWith('0046')) {
      donation.slipQrData = qrData;
      donation.transRef = 'MOCK_REF_' + Date.now();
      donation.senderName = 'ผู้โอนตัวจริง (สแกนทดสอบ)';
      
      completePayment(donation, config, user.username);
      saveDonations(donations);
      
      return res.json({ success: true, message: 'ตรวจสลิปทดสอบสำเร็จ', donation });
    }
    return res.status(400).json({ error: 'ตั้งค่า API Key ของ EasySlip ไม่ครบถ้วน' });
  }
  
  try {
    const response = await axios.post(
      'https://api.easyslip.com/v2/verify/bank',
      { payload: qrData, matchAmount: donation.amount },
      {
        headers: {
          'Authorization': `Bearer ${config.easyslipApiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const result = response.data;
    if (result.success === true) {
      const slipData = result.data;
      const slipAmount = parseFloat(slipData.amountInSlip);
      if (Math.abs(slipAmount - donation.amount) > 0.01) {
        return res.status(400).json({ error: `ยอดเงินในสลิปไม่ตรงกับยอดที่กำหนด` });
      }
      
      const rawSenderName = slipData.rawSlip?.sender?.displayName || slipData.rawSlip?.sender?.nameTh || donation.name;
      const filteredSenderName = filterProfanity(rawSenderName, config.bannedWords);
      
      donation.slipQrData = qrData;
      donation.transRef = slipData.transRef;
      donation.senderName = filteredSenderName;
      
      completePayment(donation, config, user.username);
      saveDonations(donations);
      
      res.json({ success: true, donation });
    } else {
      res.status(400).json({ error: result.error?.message || 'สลิปไม่ถูกต้อง' });
    }
  } catch (error) {
    console.error('EasySlip API Error:', error.response?.data || error.message);
    res.status(500).json({ error: 'เชื่อมต่อตรวจสลิปล้มเหลว' });
  }
});

// webhook macro connection supporting specific username query params
app.all('/api/webhook/notification', (req, res) => {
  const username = req.query.username || req.body.username;
  if (!username) return res.status(400).json({ error: 'Username parameter missing' });

  const title = req.query.title || req.body.title || '';
  const text = req.query.text || req.body.text || '';
  
  console.log(`[Webhook] Scoped webhook for user: ${username}`);
  
  const users = loadUsers();
  const user = users.find(u => u.username.toLowerCase() === username.trim().toLowerCase());
  if (!user) return res.status(404).json({ error: 'Target user not found' });
  
  const configs = loadConfigs();
  const config = configs.find(c => c.userId === user.id);
  if (!config) return res.status(400).json({ error: 'Config files missing' });

  const parsed = parseNotificationText(title, text);
  if (!parsed.amount || isNaN(parsed.amount)) {
    return res.status(200).json({ status: 'ignored', message: 'No valid transfer amount found' });
  }
  
  const filteredSender = filterProfanity(parsed.sender, config.bannedWords);
  const donations = loadDonations();
  const now = new Date();
  
  const matchIndex = donations.findIndex(d => {
    if (d.userId !== user.id || d.status !== 'pending') return false;
    const isAmountMatch = Math.abs(d.amount - parsed.amount) < 0.01;
    const isWithinTime = (now - new Date(d.createdAt)) < (20 * 60 * 1000);
    return isAmountMatch && isWithinTime;
  });
  
  if (matchIndex !== -1) {
    const donation = donations[matchIndex];
    donation.senderName = filteredSender;
    donation.verificationMethod = 'Notification Forwarder';
    completePayment(donation, config, user.username);
    saveDonations(donations);
    return res.json({ status: 'success', matched: true, donation });
  } else {
    const donationId = 'don_direct_' + Date.now();
    const newDonation = {
      id: donationId,
      userId: user.id,
      name: `คุณ ${filteredSender} (โอนตรง)`,
      message: filterProfanity('สนับสนุนสตรีมเมอร์ผ่านบัญชีธนาคารโดยตรง', config.bannedWords),
      amount: parsed.amount,
      createdAt: now.toISOString(),
      senderName: filteredSender,
      verificationMethod: 'Notification Forwarder (Direct)'
    };
    
    completePayment(newDonation, config, user.username);
    donations.push(newDonation);
    saveDonations(donations);
    return res.json({ status: 'success', matched: false, donation: newDonation });
  }
});

// Approve Pending Action
app.post('/api/donations/approve', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const { donationId } = req.body;
  
  const donations = loadDonations();
  const donationIndex = donations.findIndex(d => d.id === donationId && d.userId === req.session.userId);
  if (donationIndex === -1) return res.status(404).json({ error: 'Donation not found' });
  
  const donation = donations[donationIndex];
  if (donation.status !== 'pending_approval') return res.status(400).json({ error: 'Not waiting for approval' });
  
  donation.status = 'paid';
  donation.approvedAt = new Date().toISOString();
  saveDonations(donations);

  const users = loadUsers();
  const user = users.find(u => u.id === req.session.userId);

  io.to(user.username.toLowerCase()).emit('donation-alert', {
    id: donation.id,
    name: donation.name,
    senderRealName: donation.senderName || donation.name,
    message: donation.message,
    amount: donation.amount,
    timestamp: donation.paidAt
  });

  res.json({ success: true, donation });
});

// Reject Pending Action
app.post('/api/donations/reject', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const { donationId } = req.body;
  
  const donations = loadDonations();
  const donationIndex = donations.findIndex(d => d.id === donationId && d.userId === req.session.userId);
  if (donationIndex === -1) return res.status(404).json({ error: 'Donation not found' });
  
  const donation = donations[donationIndex];
  if (donation.status !== 'pending_approval') return res.status(400).json({ error: 'Not waiting for approval' });
  
  donation.status = 'rejected';
  donation.rejectedAt = new Date().toISOString();
  saveDonations(donations);
  res.json({ success: true, donation });
});

// Get Scoped statistics
app.get('/api/stats', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  
  const donations = loadDonations().filter(d => d.userId === req.session.userId);
  const paidAndApproval = donations.filter(d => (d.status === 'paid' || d.status === 'pending_approval') && !d.isSimulation);
  
  const totalAmount = paidAndApproval.reduce((sum, d) => sum + d.amount, 0);
  
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  
  const todayAmount = paidAndApproval
    .filter(d => new Date(d.paidAt || d.createdAt) >= startOfToday)
    .reduce((sum, d) => sum + d.amount, 0);

  const donorMap = {};
  paidAndApproval.forEach(d => {
    const key = d.name.trim();
    donorMap[key] = (donorMap[key] || 0) + d.amount;
  });
  
  const topDonators = Object.keys(donorMap)
    .map(name => ({ name, amount: donorMap[name] }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  res.json({
    totalAmount,
    todayAmount,
    topDonators,
    pendingCount: donations.filter(d => d.status === 'pending').length,
    approvalCount: donations.filter(d => d.status === 'pending_approval').length,
    successCount: donations.filter(d => d.status === 'paid').length
  });
});

// Scoped Google Speech API Proxy
app.get('/api/tts', async (req, res) => {
  const { text, lang } = req.query;
  if (!text) return res.status(400).send('Text is required');
  
  const targetLang = lang || 'th';
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${targetLang}&client=tw-ob&q=${encodeURIComponent(text)}`;
  
  try {
    const response = await axios({
      method: 'get',
      url: url,
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });
    res.setHeader('Content-Type', 'audio/mpeg');
    response.data.pipe(res);
  } catch (error) {
    console.error('TTS Proxy error', error.message);
    res.status(500).send('TTS retrieve failed');
  }
});

// Trigger a Test Alert from Dashboard
app.post('/api/test-alert', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  
  const users = loadUsers();
  const user = users.find(u => u.id === req.session.userId);
  const configs = loadConfigs();
  const config = configs.find(c => c.userId === req.session.userId);

  const { name, message, amount } = req.body;
  const filteredName = filterProfanity(name || 'ผู้สนับสนุนปริศนา', config.bannedWords);
  const filteredMessage = filterProfanity(message || 'ขอให้สตรีมเมอร์มีความสุขมากๆ ครับ!', config.bannedWords);

  const testAlert = {
    id: 'test_' + Date.now(),
    name: filteredName,
    message: filteredMessage,
    amount: parseFloat(amount) || 99,
    timestamp: new Date().toISOString(),
    isTest: true
  };
  
  io.to(user.username.toLowerCase()).emit('donation-alert', testAlert);
  res.json({ success: true, alert: testAlert });
});

// --- Dynamic Streamer URL catch-all routes ---

app.get('/:username', (req, res, next) => {
  const cleanName = req.params.username.split('.')[0];
  if (['api', 'css', 'js', 'uploads', 'login.html', 'admin.html', 'overlay.html', 'goal.html', 'index.html', 'favicon'].includes(cleanName)) {
    return next();
  }
  const users = loadUsers();
  const user = users.find(u => u.username.toLowerCase() === cleanName.toLowerCase());
  if (user) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.status(404).send('ไม่พบช่องสตรีมเมอร์นี้ในระบบ');
  }
});

app.get('/:username/overlay', (req, res) => {
  const cleanName = req.params.username.toLowerCase();
  const users = loadUsers();
  const user = users.find(u => u.username.toLowerCase() === cleanName);
  if (user) {
    res.sendFile(path.join(__dirname, 'public', 'overlay.html'));
  } else {
    res.status(404).send('ไม่พบห้องโอเวอร์เลย์สำหรับสตรีมเมอร์นี้');
  }
});

app.get('/:username/goal', (req, res) => {
  const cleanName = req.params.username.toLowerCase();
  const users = loadUsers();
  const user = users.find(u => u.username.toLowerCase() === cleanName);
  if (user) {
    res.sendFile(path.join(__dirname, 'public', 'goal.html'));
  } else {
    res.status(404).send('ไม่พบห้องเป้าหมายสะสมสำหรับสตรีมเมอร์นี้');
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`Multi-tenant Donate Overlay System Online!`);
  console.log(`- Web Server: http://localhost:${PORT}`);
  console.log(`- Registration / Admin panel: http://localhost:${PORT}/login.html`);
  console.log(`=======================================================`);
});
