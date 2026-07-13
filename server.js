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
const { Pool } = require('pg');

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

// Local JSON File Sync Handlers (Fallback Mode)
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

// --- DATABASE HYBRID LAYER ADAPTERS ---
let pool = null;
let useDb = false;

if (process.env.DATABASE_URL) {
  console.log('[Database] DATABASE_URL environment variable detected. Enabling cloud PostgreSQL.');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });
  useDb = true;
  initDbSchema();
} else {
  console.log('[Database] No DATABASE_URL found. Running locally on JSON file storage.');
}

async function initDbSchema() {
  try {
    const client = await pool.connect();
    
    // Create Users Schema
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(50) PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create Configs Schema
    await client.query(`
      CREATE TABLE IF NOT EXISTS configs (
        user_id VARCHAR(50) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        promptpay_id VARCHAR(50) NOT NULL,
        verify_mode VARCHAR(20) NOT NULL,
        easyslip_api_key VARCHAR(255),
        streamer_name VARCHAR(100) NOT NULL,
        streamer_description TEXT,
        banned_words TEXT,
        require_approval BOOLEAN DEFAULT FALSE,
        min_amount_tts NUMERIC DEFAULT 1,
        min_donate_amount NUMERIC DEFAULT 1,
        tts_speed NUMERIC DEFAULT 1.0,
        tts_pitch NUMERIC DEFAULT 1.0,
        sound_volume NUMERIC DEFAULT 0.8,
        overlay_accent_color VARCHAR(10) DEFAULT '#ff007f',
        overlay_text_color VARCHAR(10) DEFAULT '#ffffff',
        alert_animation VARCHAR(20) DEFAULT 'slide',
        alert_sound_file VARCHAR(255),
        goal_enabled BOOLEAN DEFAULT FALSE,
        goal_title VARCHAR(255),
        goal_target NUMERIC DEFAULT 5000,
        goal_current NUMERIC DEFAULT 0,
        viewer_accent_color VARCHAR(10) DEFAULT '#8a2be2',
        viewer_banner_file VARCHAR(255)
      )
    `);
    
    // Create Donations Schema
    await client.query(`
      CREATE TABLE IF NOT EXISTS donations (
        id VARCHAR(50) PRIMARY KEY,
        user_id VARCHAR(50) REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        message TEXT,
        amount NUMERIC NOT NULL,
        status VARCHAR(20) NOT NULL,
        qr_payload TEXT,
        slip_qr_data TEXT,
        trans_ref VARCHAR(100),
        sender_name VARCHAR(100),
        verification_method VARCHAR(50),
        is_simulation BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        paid_at TIMESTAMP WITH TIME ZONE,
        approved_at TIMESTAMP WITH TIME ZONE,
        rejected_at TIMESTAMP WITH TIME ZONE
      )
    `);
    
    client.release();
    console.log('[Database] PostgreSQL schemas initialized successfully.');
    
    // Auto-migrate local JSON file database into PostgreSQL if empty
    await migrateJsonToPostgres();
  } catch (err) {
    console.error('[Database] Failed to initialize DB schemas:', err.message);
  }
}

async function migrateJsonToPostgres() {
  try {
    const usersCountRes = await pool.query('SELECT COUNT(*) FROM users');
    const dbUsersCount = parseInt(usersCountRes.rows[0].count);
    
    if (dbUsersCount === 0) {
      const localUsers = loadUsers();
      if (localUsers.length > 0) {
        console.log(`[Database Migration] DB is empty but found ${localUsers.length} local JSON users. Migrating...`);
        
        // Migrate Users
        for (const u of localUsers) {
          await pool.query(
            'INSERT INTO users (id, username, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5)',
            [u.id, u.username, u.passwordHash, u.role, u.createdAt]
          );
        }
        
        // Migrate Configs
        const localConfigs = loadConfigs();
        for (const c of localConfigs) {
          await pool.query(`
            INSERT INTO configs (
              user_id, promptpay_id, verify_mode, easyslip_api_key, streamer_name, streamer_description,
              banned_words, require_approval, min_amount_tts, min_donate_amount, tts_speed, tts_pitch,
              sound_volume, overlay_accent_color, overlay_text_color, alert_animation, alert_sound_file,
              goal_enabled, goal_title, goal_target, goal_current, viewer_accent_color, viewer_banner_file
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23
            )
          `, [
            c.userId, c.promptpayId, c.verifyMode, c.easyslipApiKey, c.streamerName, c.streamerDescription,
            c.bannedWords, c.requireApproval, c.minAmountTts, c.minDonateAmount, c.ttsSpeed, c.ttsPitch,
            c.soundVolume, c.overlayAccentColor, c.overlayTextColor, c.alertAnimation, c.alertSoundFile,
            c.goalEnabled, c.goalTitle, c.goalTarget, c.goalCurrent, c.viewerAccentColor, c.viewerBannerFile
          ]);
        }
        
        // Migrate Donations
        const localDonations = loadDonations();
        for (const d of localDonations) {
          await pool.query(`
            INSERT INTO donations (
              id, user_id, name, message, amount, status, qr_payload, slip_qr_data, trans_ref,
              sender_name, verification_method, is_simulation, created_at, paid_at, approved_at, rejected_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
            )
          `, [
            d.id, d.userId, d.name, d.message, d.amount, d.status, d.qrPayload, d.slipQrData, d.transRef,
            d.senderName, d.verificationMethod, d.isSimulation || false, d.createdAt, d.paidAt, d.approvedAt, d.rejectedAt
          ]);
        }
        
        console.log('[Database Migration] All local JSON data successfully migrated to PostgreSQL cloud!');
      }
    }
  } catch (err) {
    console.error('[Database Migration] Error during migration:', err.message);
  }
}

// PostgreSQL Mapper Helpers
function mapConfigFromDb(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    promptpayId: row.promptpay_id,
    verifyMode: row.verify_mode,
    easyslipApiKey: row.easyslip_api_key,
    streamerName: row.streamer_name,
    streamerDescription: row.streamer_description,
    bannedWords: row.banned_words,
    requireApproval: row.require_approval,
    minAmountTts: Number(row.min_amount_tts),
    minDonateAmount: Number(row.min_donate_amount),
    ttsSpeed: Number(row.tts_speed),
    ttsPitch: Number(row.tts_pitch),
    soundVolume: Number(row.sound_volume),
    overlayAccentColor: row.overlay_accent_color,
    overlayTextColor: row.overlay_text_color,
    alertAnimation: row.alert_animation,
    alertSoundFile: row.alert_sound_file,
    goalEnabled: row.goal_enabled,
    goalTitle: row.goal_title,
    goalTarget: Number(row.goal_target),
    goalCurrent: Number(row.goal_current),
    viewerAccentColor: row.viewer_accent_color,
    viewerBannerFile: row.viewer_banner_file
  };
}

function mapDonationFromDb(r) {
  if (!r) return null;
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    message: r.message,
    amount: Number(r.amount),
    status: r.status,
    qrPayload: r.qr_payload,
    slipQrData: r.slip_qr_data,
    transRef: r.trans_ref,
    senderName: r.sender_name,
    verificationMethod: r.verification_method,
    isSimulation: r.is_simulation,
    createdAt: r.created_at,
    paidAt: r.paid_at,
    approvedAt: r.approved_at,
    rejectedAt: r.rejected_at
  };
}

// Async Database Access Handlers (supports transparent fallback to JSON)
async function dbGetUsers() {
  if (useDb) {
    const res = await pool.query('SELECT * FROM users');
    return res.rows.map(r => ({
      id: r.id,
      username: r.username,
      passwordHash: r.password_hash,
      role: r.role,
      createdAt: r.created_at
    }));
  }
  return loadUsers();
}

async function dbAddUser(u) {
  if (useDb) {
    await pool.query(
      'INSERT INTO users (id, username, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5)',
      [u.id, u.username, u.passwordHash, u.role, u.createdAt]
    );
    return;
  }
  const users = loadUsers();
  users.push(u);
  saveUsers(users);
}

async function dbGetConfigs() {
  if (useDb) {
    const res = await pool.query('SELECT * FROM configs');
    return res.rows.map(mapConfigFromDb);
  }
  return loadConfigs();
}

async function dbSaveConfig(c) {
  if (useDb) {
    await pool.query(`
      INSERT INTO configs (
        user_id, promptpay_id, verify_mode, easyslip_api_key, streamer_name, streamer_description,
        banned_words, require_approval, min_amount_tts, min_donate_amount, tts_speed, tts_pitch,
        sound_volume, overlay_accent_color, overlay_text_color, alert_animation, alert_sound_file,
        goal_enabled, goal_title, goal_target, goal_current, viewer_accent_color, viewer_banner_file
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23
      ) ON CONFLICT (user_id) DO UPDATE SET
        promptpay_id = EXCLUDED.promptpay_id,
        verify_mode = EXCLUDED.verify_mode,
        easyslip_api_key = EXCLUDED.easyslip_api_key,
        streamer_name = EXCLUDED.streamer_name,
        streamer_description = EXCLUDED.streamer_description,
        banned_words = EXCLUDED.banned_words,
        require_approval = EXCLUDED.require_approval,
        min_amount_tts = EXCLUDED.min_amount_tts,
        min_donate_amount = EXCLUDED.min_donate_amount,
        tts_speed = EXCLUDED.tts_speed,
        tts_pitch = EXCLUDED.tts_pitch,
        sound_volume = EXCLUDED.sound_volume,
        overlay_accent_color = EXCLUDED.overlay_accent_color,
        overlay_text_color = EXCLUDED.overlay_text_color,
        alert_animation = EXCLUDED.alert_animation,
        alert_sound_file = EXCLUDED.alert_sound_file,
        goal_enabled = EXCLUDED.goal_enabled,
        goal_title = EXCLUDED.goal_title,
        goal_target = EXCLUDED.goal_target,
        goal_current = EXCLUDED.goal_current,
        viewer_accent_color = EXCLUDED.viewer_accent_color,
        viewer_banner_file = EXCLUDED.viewer_banner_file
    `, [
      c.userId, c.promptpayId, c.verifyMode, c.easyslipApiKey, c.streamerName, c.streamerDescription,
      c.bannedWords, c.requireApproval, c.minAmountTts, c.minDonateAmount, c.ttsSpeed, c.ttsPitch,
      c.soundVolume, c.overlayAccentColor, c.overlayTextColor, c.alertAnimation, c.alertSoundFile,
      c.goalEnabled, c.goalTitle, c.goalTarget, c.goalCurrent, c.viewerAccentColor, c.viewerBannerFile
    ]);
    return;
  }
  const configs = loadConfigs();
  const idx = configs.findIndex(item => item.userId === c.userId);
  if (idx !== -1) {
    configs[idx] = c;
  } else {
    configs.push(c);
  }
  saveConfigs(configs);
}

async function dbGetDonations() {
  if (useDb) {
    const res = await pool.query('SELECT * FROM donations');
    return res.rows.map(mapDonationFromDb);
  }
  return loadDonations();
}

async function dbSaveDonation(d) {
  if (useDb) {
    await pool.query(`
      INSERT INTO donations (
        id, user_id, name, message, amount, status, qr_payload, slip_qr_data, trans_ref,
        sender_name, verification_method, is_simulation, created_at, paid_at, approved_at, rejected_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
      ) ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        slip_qr_data = EXCLUDED.slip_qr_data,
        trans_ref = EXCLUDED.trans_ref,
        sender_name = EXCLUDED.sender_name,
        verification_method = EXCLUDED.verification_method,
        is_simulation = EXCLUDED.is_simulation,
        paid_at = EXCLUDED.paid_at,
        approved_at = EXCLUDED.approved_at,
        rejected_at = EXCLUDED.rejected_at
    `, [
      d.id, d.userId, d.name, d.message, d.amount, d.status, d.qrPayload, d.slipQrData, d.transRef,
      d.senderName, d.verificationMethod, d.isSimulation || false, d.createdAt, d.paidAt, d.approvedAt, d.rejectedAt
    ]);
    return;
  }
  const donations = loadDonations();
  const idx = donations.findIndex(item => item.id === d.id);
  if (idx !== -1) {
    donations[idx] = d;
  } else {
    donations.push(d);
  }
  saveDonations(donations);
}

// Automatic Legacy migration on Server Boot
(async function migrateLegacyData() {
  const legacyConfigPath = path.join(__dirname, 'config.json');
  const legacyDonationsPath = path.join(__dirname, 'donations.json');
  
  if (fs.existsSync(legacyConfigPath)) {
    console.log('[Migration] Legacy config file detected. Starting data migration...');
    const users = await dbGetUsers();
    
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
      
      await dbAddUser(adminUser);
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
      await dbSaveConfig(migratedConfig);
      
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
        
        for (const d of legacyDonations) {
          const migratedDonation = Object.assign({}, d, { userId: defaultUserId });
          await dbSaveDonation(migratedDonation);
        }
      }
      
      // Rename files to prevent duplicate migrations
      try {
        fs.renameSync(legacyConfigPath, legacyConfigPath + '.bak');
        if (fs.existsSync(legacyDonationsPath)) {
          fs.renameSync(legacyDonationsPath, legacyDonationsPath + '.bak');
        }
        console.log('[Migration] Single-user config successfully migrated to database.');
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
async function completePayment(donation, config, username) {
  donation.status = config.requireApproval ? 'pending_approval' : 'paid';
  donation.paidAt = new Date().toISOString();
  
  // Increment Goal progress if enabled AND NOT a simulation
  if (config.goalEnabled && !donation.isSimulation) {
    config.goalCurrent = (config.goalCurrent || 0) + donation.amount;
    await dbSaveConfig(config);

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
  socket.on('join-room', async (username) => {
    if (!username) return;
    const cleanRoom = username.trim().toLowerCase();
    socket.join(cleanRoom);
    console.log(`Socket ${socket.id} joined room: ${cleanRoom}`);
    
    // Emit correct goal update
    const users = await dbGetUsers();
    const targetUser = users.find(u => u.username.toLowerCase() === cleanRoom);
    if (targetUser) {
      const configs = await dbGetConfigs();
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

app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'กรุณากรอก Username และ Password' });
  }
  
  const cleanUsername = username.trim().toLowerCase();
  if (cleanUsername.length < 3 || !/^[a-zA-Z0-9_\-]+$/.test(cleanUsername)) {
    return res.status(400).json({ error: 'Username ต้องมีความยาว 3 ตัวอักษรขึ้นไป และสามารถใช้ได้เฉพาะ A-Z, 0-9, _, - เท่านั้น' });
  }

  const users = await dbGetUsers();
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
    role: cleanUsername === 'admin' ? 'admin' : 'streamer',
    createdAt: new Date().toISOString()
  };

  await dbAddUser(newUser);

  // Initialize Default configs
  const defConfig = makeDefaultConfig(userId);
  await dbSaveConfig(defConfig);

  req.session.userId = userId;
  res.json({ success: true, user: { id: userId, username: cleanUsername } });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
  }

  const cleanUsername = username.trim().toLowerCase();
  const users = await dbGetUsers();
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

app.get('/api/auth/me', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const users = await dbGetUsers();
  const user = users.find(u => u.id === req.session.userId);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }
  res.json({ user: { id: user.id, username: user.username, role: user.role } });
});

// --- SCAPED CONFIG & ASSET APIS ---

app.get('/api/config', async (req, res) => {
  const targetUsername = req.query.username;
  const configs = await dbGetConfigs();
  
  if (targetUsername) {
    // Public fetch scoped config by username (Viewer or OBS Overlay queries)
    const users = await dbGetUsers();
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
    await dbSaveConfig(config);
  }
  res.json(config);
});

app.post('/api/config', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  
  const configs = await dbGetConfigs();
  const config = configs.find(c => c.userId === req.session.userId);
  
  if (!config) {
    return res.status(404).json({ error: 'Config entity not found' });
  }

  const { 
    promptpayId, verifyMode, easyslipApiKey, streamerName, streamerDescription,
    bannedWords, requireApproval, minAmountTts, minDonateAmount, ttsSpeed, ttsPitch, soundVolume,
    overlayAccentColor, overlayTextColor, alertAnimation, alertSoundFile,
    goalEnabled, goalTitle, goalTarget, goalCurrent,
    viewerAccentColor, viewerBannerFile
  } = req.body;

  const updatedConfig = Object.assign({}, config, {
    promptpayId: promptpayId || config.promptpayId,
    verifyMode: verifyMode || config.verifyMode,
    easyslipApiKey: easyslipApiKey !== undefined ? easyslipApiKey : config.easyslipApiKey,
    streamerName: streamerName || config.streamerName,
    streamerDescription: streamerDescription !== undefined ? streamerDescription : config.streamerDescription,
    bannedWords: bannedWords !== undefined ? bannedWords : config.bannedWords,
    requireApproval: requireApproval !== undefined ? !!requireApproval : config.requireApproval,
    minAmountTts: minAmountTts !== undefined ? Number(minAmountTts) : config.minAmountTts,
    minDonateAmount: minDonateAmount !== undefined ? Number(minDonateAmount) : config.minDonateAmount,
    ttsSpeed: ttsSpeed !== undefined ? Number(ttsSpeed) : config.ttsSpeed,
    ttsPitch: ttsPitch !== undefined ? Number(ttsPitch) : config.ttsPitch,
    soundVolume: soundVolume !== undefined ? Number(soundVolume) : config.soundVolume,
    overlayAccentColor: overlayAccentColor || config.overlayAccentColor,
    overlayTextColor: overlayTextColor || config.overlayTextColor,
    alertAnimation: alertAnimation || config.alertAnimation,
    alertSoundFile: alertSoundFile !== undefined ? alertSoundFile : config.alertSoundFile,
    goalEnabled: goalEnabled !== undefined ? !!goalEnabled : config.goalEnabled,
    goalTitle: goalTitle || config.goalTitle,
    goalTarget: goalTarget !== undefined ? Number(goalTarget) : config.goalTarget,
    goalCurrent: goalCurrent !== undefined ? Number(goalCurrent) : config.goalCurrent,
    viewerAccentColor: viewerAccentColor || config.viewerAccentColor,
    viewerBannerFile: viewerBannerFile !== undefined ? viewerBannerFile : config.viewerBannerFile
  });

  await dbSaveConfig(updatedConfig);

  // Broadcast dynamic update to goal OBS widgets
  const users = await dbGetUsers();
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
app.post('/api/upload-banner', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const { imageBase64 } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'No image data provided' });
  
  try {
    const buffer = Buffer.from(imageBase64, 'base64');
    const targetPath = path.join(BANNERS_DIR, `${req.session.userId}.jpg`);
    fs.writeFileSync(targetPath, buffer);
    
    const configs = await dbGetConfigs();
    const config = configs.find(c => c.userId === req.session.userId);
    if (config) {
      config.viewerBannerFile = `/uploads/banners/${req.session.userId}.jpg`;
      await dbSaveConfig(config);
    }
    
    res.json({ success: true, message: 'Banner successfully updated' });
  } catch (error) {
    console.error('Banner upload error:', error);
    res.status(500).json({ error: 'Failed uploading banner' });
  }
});

// Custom sound file upload endpoint
app.post('/api/upload-sound', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const { soundBase64, filename } = req.body;
  if (!soundBase64) return res.status(400).json({ error: 'No sound data provided' });
  
  try {
    const ext = path.extname(filename || 'alert.mp3').toLowerCase();
    const buffer = Buffer.from(soundBase64, 'base64');
    const targetFilename = `${req.session.userId}${ext}`;
    const targetPath = path.join(SOUNDS_DIR, targetFilename);
    
    fs.writeFileSync(targetPath, buffer);
    
    const configs = await dbGetConfigs();
    const config = configs.find(c => c.userId === req.session.userId);
    if (config) {
      config.alertSoundFile = `/uploads/sounds/${targetFilename}`;
      await dbSaveConfig(config);
    }
    
    res.json({ success: true, message: 'Sound uploaded successfully', filename: `/uploads/sounds/${targetFilename}` });
  } catch (error) {
    console.error('Sound upload error:', error);
    res.status(500).json({ error: 'Failed uploading audio sound' });
  }
});

// --- DONATIONS APIS ---

app.get('/api/donations', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const donations = await dbGetDonations();
  res.json(donations.filter(d => d.userId === req.session.userId));
});

app.post('/api/donate', async (req, res) => {
  const { name, message, amount, username } = req.body;
  
  if (!username) return res.status(400).json({ error: 'Username target is required' });
  if (!name || !amount || isNaN(amount) || parseFloat(amount) <= 0) {
    return res.status(400).json({ error: 'Invalid name or amount' });
  }

  const users = await dbGetUsers();
  const targetUser = users.find(u => u.username.toLowerCase() === username.trim().toLowerCase());
  if (!targetUser) return res.status(400).json({ error: 'สตรีมเมอร์เป้าหมายไม่ปรากฏในระบบ' });
  
  const configs = await dbGetConfigs();
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
    isSimulation: false,
    createdAt: new Date().toISOString()
  };
  
  await dbSaveDonation(donation);
  
  res.json({
    success: true,
    donationId,
    qrPayload,
    amount: donation.amount
  });
});

app.post('/api/simulate-success', async (req, res) => {
  const { donationId } = req.body;
  const donations = await dbGetDonations();
  const donation = donations.find(d => d.id === donationId);
  
  if (!donation) return res.status(404).json({ error: 'Donation not found' });
  
  if (donation.status === 'paid' || donation.status === 'pending_approval') {
    return res.status(400).json({ error: 'Donation already processed' });
  }
  
  const users = await dbGetUsers();
  const user = users.find(u => u.id === donation.userId);
  if (!user) return res.status(400).json({ error: 'Associated user missing' });
  
  const configs = await dbGetConfigs();
  const config = configs.find(c => c.userId === donation.userId);
  
  donation.isSimulation = true;
  donation.verificationMethod = 'Simulation';
  await completePayment(donation, config, user.username);
  await dbSaveDonation(donation);
  
  res.json({ success: true, donation });
});

app.post('/api/verify', async (req, res) => {
  const { qrData, donationId } = req.body;
  if (!qrData || !donationId) {
    return res.status(400).json({ error: 'QR Data and Donation ID are required' });
  }
  
  const donations = await dbGetDonations();
  const donation = donations.find(d => d.id === donationId);
  if (!donation) return res.status(404).json({ error: 'Donation not found' });
  
  if (donation.status === 'paid' || donation.status === 'pending_approval') {
    return res.json({ success: true, message: 'Already processed', donation });
  }

  const users = await dbGetUsers();
  const user = users.find(u => u.id === donation.userId);
  if (!user) return res.status(400).json({ error: 'Target user missing' });

  const configs = await dbGetConfigs();
  const config = configs.find(c => c.userId === donation.userId);
  
  if (config.verifyMode === 'simulate') {
    donation.isSimulation = true;
    donation.verificationMethod = 'Simulation';
    await completePayment(donation, config, user.username);
    await dbSaveDonation(donation);
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
      donation.isSimulation = false;
      
      await completePayment(donation, config, user.username);
      await dbSaveDonation(donation);
      
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
      donation.isSimulation = false;
      
      await completePayment(donation, config, user.username);
      await dbSaveDonation(donation);
      
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
app.all('/api/webhook/notification', async (req, res) => {
  const username = req.query.username || req.body.username;
  if (!username) return res.status(400).json({ error: 'Username parameter missing' });

  const title = req.query.title || req.body.title || '';
  const text = req.query.text || req.body.text || '';
  
  console.log(`[Webhook] Scoped webhook for user: ${username}`);
  
  const users = await dbGetUsers();
  const user = users.find(u => u.username.toLowerCase() === username.trim().toLowerCase());
  if (!user) return res.status(404).json({ error: 'Target user not found' });
  
  const configs = await dbGetConfigs();
  const config = configs.find(c => c.userId === user.id);
  if (!config) return res.status(400).json({ error: 'Config files missing' });

  const parsed = parseNotificationText(title, text);
  if (!parsed.amount || isNaN(parsed.amount)) {
    return res.status(200).json({ status: 'ignored', message: 'No valid transfer amount found' });
  }
  
  const filteredSender = filterProfanity(parsed.sender, config.bannedWords);
  const donations = await dbGetDonations();
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
    donation.isSimulation = false;
    await completePayment(donation, config, user.username);
    await dbSaveDonation(donation);
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
      isSimulation: false,
      verificationMethod: 'Notification Forwarder (Direct)'
    };
    
    await completePayment(newDonation, config, user.username);
    await dbSaveDonation(newDonation);
    return res.json({ status: 'success', matched: false, donation: newDonation });
  }
});

// Approve Pending Action
app.post('/api/donations/approve', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const { donationId } = req.body;
  
  const donations = await dbGetDonations();
  const donation = donations.find(d => d.id === donationId && d.userId === req.session.userId);
  if (!donation) return res.status(404).json({ error: 'Donation not found' });
  
  if (donation.status !== 'pending_approval') return res.status(400).json({ error: 'Not waiting for approval' });
  
  donation.status = 'paid';
  donation.approvedAt = new Date().toISOString();
  await dbSaveDonation(donation);

  const users = await dbGetUsers();
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
app.post('/api/donations/reject', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const { donationId } = req.body;
  
  const donations = await dbGetDonations();
  const donation = donations.find(d => d.id === donationId && d.userId === req.session.userId);
  if (!donation) return res.status(404).json({ error: 'Donation not found' });
  
  if (donation.status !== 'pending_approval') return res.status(400).json({ error: 'Not waiting for approval' });
  
  donation.status = 'rejected';
  donation.rejectedAt = new Date().toISOString();
  await dbSaveDonation(donation);
  res.json({ success: true, donation });
});

// Get Scoped statistics
app.get('/api/stats', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  
  const allDonations = await dbGetDonations();
  const donations = allDonations.filter(d => d.userId === req.session.userId);
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
app.post('/api/test-alert', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  
  const users = await dbGetUsers();
  const user = users.find(u => u.id === req.session.userId);
  const configs = await dbGetConfigs();
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

// --- PLATFORM OWNER APIS & ROUTING ---

app.get('/owner.html', async (req, res, next) => {
  if (!req.session.userId) return res.redirect('/login.html');
  const users = await dbGetUsers();
  const user = users.find(u => u.id === req.session.userId);
  if (!user || user.role !== 'admin') {
    return res.status(403).send('Forbidden: เฉพาะผู้เป็นเจ้าของระบบ (Platform Owner) เท่านั้นที่จะสามารถเข้าหน้าจอนี้ได้');
  }
  next();
});

app.get('/api/owner/stats', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const users = await dbGetUsers();
  const user = users.find(u => u.id === req.session.userId);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const configs = await dbGetConfigs();
  const donations = await dbGetDonations();

  // Calculate platform metrics
  const streamers = users.filter(u => u.role === 'streamer');
  const paidDonations = donations.filter(d => d.status === 'paid' && !d.isSimulation);
  const totalVolume = paidDonations.reduce((sum, d) => sum + d.amount, 0);

  // Map streamers list with their accumulated earnings
  const streamersList = streamers.map(s => {
    const streamerConfig = configs.find(c => c.userId === s.id) || {};
    const streamerPaid = donations.filter(d => d.userId === s.id && d.status === 'paid' && !d.isSimulation);
    const earnings = streamerPaid.reduce((sum, d) => sum + d.amount, 0);
    return {
      id: s.id,
      username: s.username,
      streamerName: streamerConfig.streamerName || 'ไม่มีชื่อแสดง',
      promptpayId: streamerConfig.promptpayId || 'ไม่ได้ระบุ',
      earnings,
      registeredAt: s.createdAt
    };
  });

  res.json({
    streamersCount: streamers.length,
    totalVolume,
    donationsCount: paidDonations.length,
    streamers: streamersList
  });
});

app.post('/api/owner/delete-streamer', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const users = await dbGetUsers();
  const user = users.find(u => u.id === req.session.userId);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { streamerId } = req.body;
  if (!streamerId) return res.status(400).json({ error: 'Streamer ID required' });

  // Ensure we don't delete another admin
  const targetUser = users.find(u => u.id === streamerId);
  if (!targetUser || targetUser.role === 'admin') {
    return res.status(400).json({ error: 'ไม่พบผู้ใช้หรือบัญชีเป้าหมายเป็นผู้ดูแลระบบ' });
  }

  if (useDb) {
    await pool.query('DELETE FROM users WHERE id = $1', [streamerId]);
  } else {
    const updatedUsers = users.filter(u => u.id !== streamerId);
    saveUsers(updatedUsers);
    
    const configs = loadConfigs();
    saveConfigs(configs.filter(c => c.userId !== streamerId));
    
    const donations = loadDonations();
    saveDonations(donations.filter(d => d.userId !== streamerId));
  }

  res.json({ success: true, message: 'ลบบัญชีสตรีมเมอร์สำเร็จ' });
});

// --- Dynamic Streamer URL catch-all routes ---

app.get('/:username', async (req, res, next) => {
  const cleanName = req.params.username.split('.')[0];
  if (['api', 'css', 'js', 'uploads', 'login.html', 'admin.html', 'overlay.html', 'goal.html', 'index.html', 'favicon'].includes(cleanName)) {
    return next();
  }
  const users = await dbGetUsers();
  const user = users.find(u => u.username.toLowerCase() === cleanName.toLowerCase());
  if (user) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.status(404).send('ไม่พบช่องสตรีมเมอร์นี้ในระบบ');
  }
});

app.get('/:username/overlay', async (req, res) => {
  const cleanName = req.params.username.toLowerCase();
  const users = await dbGetUsers();
  const user = users.find(u => u.username.toLowerCase() === cleanName);
  if (user) {
    res.sendFile(path.join(__dirname, 'public', 'overlay.html'));
  } else {
    res.status(404).send('ไม่พบห้องโอเวอร์เลย์สำหรับสตรีมเมอร์นี้');
  }
});

app.get('/:username/goal', async (req, res) => {
  const cleanName = req.params.username.toLowerCase();
  const users = await dbGetUsers();
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
