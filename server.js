const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const axios = require('axios');
const generatePayload = require('promptpay-qr');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const CONFIG_PATH = path.join(__dirname, 'config.json');
const DONATIONS_PATH = path.join(__dirname, 'donations.json');

app.use(cors());
app.use(express.json({ limit: '10mb' })); // Increased limit to support base64 uploads (image/sound)
app.use(express.static(path.join(__dirname, 'public')));

// Helper to load configurations (Supports Environment Variables for Cloud Deployment)
function loadConfig() {
  const defaults = {
    promptpayId: '0812345678', 
    verifyMode: 'simulate',    
    easyslipApiKey: '',
    streamerName: 'SEAHOUSE STREAM',
    streamerDescription: 'ขอบคุณทุกแรงสนับสนุนสำหรับการพัฒนาช่องและคอมมูนิตี้ของเราครับ!',
    bannedWords: 'ควย,สัส,เหี้ย,มึง,เย็ด,จู๋,หี,แตด,ชิบหาย,ฟาย,shyt,darn,fck', // Default word filters
    requireApproval: false,
    minAmountTts: 1,
    minDonateAmount: 1, // General minimum donation amount (default 1 Baht)
    ttsSpeed: 1.0,
    ttsPitch: 1.0,
    soundVolume: 0.8,
    overlayAccentColor: '#ff007f', // Cyber pink default
    overlayTextColor: '#ffffff',
    alertAnimation: 'slide',
    alertSoundFile: '', // Optional custom sound
    goalEnabled: false,
    goalTitle: 'สมทบทุนซื้ออุปกรณ์สตรีม',
    goalTarget: 5000,
    goalCurrent: 0,
    viewerAccentColor: '#8a2be2', // Default purple accent for viewer page
    viewerBannerFile: '' // Optional custom banner
  };

  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  try {
    const data = fs.readFileSync(CONFIG_PATH, 'utf8');
    const diskConfig = JSON.parse(data);
    
    // PRIORITIZE diskConfig OVER process.env
    return {
      promptpayId: diskConfig.promptpayId || process.env.PROMPTPAY_ID || defaults.promptpayId,
      verifyMode: diskConfig.verifyMode || process.env.VERIFY_MODE || defaults.verifyMode,
      easyslipApiKey: diskConfig.easyslipApiKey || process.env.EASYSLIP_API_KEY || defaults.easyslipApiKey,
      streamerName: diskConfig.streamerName || process.env.STREAMER_NAME || defaults.streamerName,
      streamerDescription: diskConfig.streamerDescription || process.env.STREAMER_DESC || defaults.streamerDescription,
      bannedWords: diskConfig.bannedWords !== undefined ? diskConfig.bannedWords : defaults.bannedWords,
      requireApproval: diskConfig.requireApproval !== undefined ? diskConfig.requireApproval : defaults.requireApproval,
      minAmountTts: diskConfig.minAmountTts !== undefined ? Number(diskConfig.minAmountTts) : defaults.minAmountTts,
      minDonateAmount: diskConfig.minDonateAmount !== undefined ? Number(diskConfig.minDonateAmount) : defaults.minDonateAmount,
      ttsSpeed: diskConfig.ttsSpeed !== undefined ? Number(diskConfig.ttsSpeed) : defaults.ttsSpeed,
      ttsPitch: diskConfig.ttsPitch !== undefined ? Number(diskConfig.ttsPitch) : defaults.ttsPitch,
      soundVolume: diskConfig.soundVolume !== undefined ? Number(diskConfig.soundVolume) : defaults.soundVolume,
      overlayAccentColor: diskConfig.overlayAccentColor || defaults.overlayAccentColor,
      overlayTextColor: diskConfig.overlayTextColor || defaults.overlayTextColor,
      alertAnimation: diskConfig.alertAnimation || defaults.alertAnimation,
      alertSoundFile: diskConfig.alertSoundFile || defaults.alertSoundFile,
      goalEnabled: diskConfig.goalEnabled !== undefined ? diskConfig.goalEnabled : defaults.goalEnabled,
      goalTitle: diskConfig.goalTitle || defaults.goalTitle,
      goalTarget: diskConfig.goalTarget !== undefined ? Number(diskConfig.goalTarget) : defaults.goalTarget,
      goalCurrent: diskConfig.goalCurrent !== undefined ? Number(diskConfig.goalCurrent) : defaults.goalCurrent,
      viewerAccentColor: diskConfig.viewerAccentColor || defaults.viewerAccentColor,
      viewerBannerFile: diskConfig.viewerBannerFile || defaults.viewerBannerFile
    };
  } catch (err) {
    console.error('Error reading config.json, using defaults', err);
    return defaults;
  }
}

// Helper to save configurations
function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// Helper to load donations
function loadDonations() {
  if (!fs.existsSync(DONATIONS_PATH)) {
    fs.writeFileSync(DONATIONS_PATH, JSON.stringify([], null, 2));
    return [];
  }
  try {
    const data = fs.readFileSync(DONATIONS_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading donations.json, returning empty array', err);
    return [];
  }
}

// Helper to save donations
function saveDonations(donations) {
  fs.writeFileSync(DONATIONS_PATH, JSON.stringify(donations, null, 2));
}

// Advanced Profanity filter with safe-words check for Thai compatibility
function filterProfanity(text, bannedWordsStr) {
  if (!text) return '';
  if (!bannedWordsStr) return text;
  
  // List of common safe Thai words containing substrings like "อม", "กู", "หี"
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
      // Check surrounding context of the match to verify it isn't part of a safe word
      const startContext = Math.max(0, offset - 5);
      const endContext = Math.min(text.length, offset + match.length + 5);
      const contextText = text.substring(startContext, endContext);
      
      for (const safe of safeWords) {
        if (contextText.includes(safe)) {
          const matchInContextIndex = offset - startContext;
          const safeInContextIndex = contextText.indexOf(safe);
          
          // If the match falls entirely within a safe word, skip replacement
          if (safeInContextIndex !== -1 && 
              matchInContextIndex >= safeInContextIndex && 
              (matchInContextIndex + match.length) <= (safeInContextIndex + safe.length)) {
            return match; // Keep the original string
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

// Safe helper to complete/authorize payment logic
function completePayment(donation, config) {
  donation.status = config.requireApproval ? 'pending_approval' : 'paid';
  donation.paidAt = new Date().toISOString();
  
  // Increment Goal progress if enabled
  if (config.goalEnabled) {
    config.goalCurrent = (config.goalCurrent || 0) + donation.amount;
    saveConfig(config);
    // Broadcast goal update instantly
    io.emit('goal-update', {
      title: config.goalTitle,
      target: config.goalTarget,
      current: config.goalCurrent,
      enabled: config.goalEnabled
    });
  }

  if (config.requireApproval) {
    // Send to admin approvals queue
    io.emit('admin-pending-approval', donation);
  } else {
    // Send directly to overlay screen
    io.emit('donation-alert', {
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
  
  // Immediately send goal status to newly connected browser sources
  const config = loadConfig();
  socket.emit('goal-update', {
    title: config.goalTitle,
    target: config.goalTarget,
    current: config.goalCurrent,
    enabled: config.goalEnabled
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// --- REST API ENDPOINTS ---

// Config APIs
app.get('/api/config', (req, res) => {
  res.json(loadConfig());
});

app.post('/api/config', (req, res) => {
  const config = loadConfig();
  
  // Object assign values from body
  const { 
    promptpayId, verifyMode, easyslipApiKey, streamerName, streamerDescription,
    bannedWords, requireApproval, minAmountTts, minDonateAmount, ttsSpeed, ttsPitch, soundVolume,
    overlayAccentColor, overlayTextColor, alertAnimation, alertSoundFile,
    goalEnabled, goalTitle, goalTarget, goalCurrent,
    viewerAccentColor, viewerBannerFile
  } = req.body;

  if (!promptpayId) {
    return res.status(400).json({ error: 'PromptPay ID is required' });
  }

  const updatedConfig = {
    promptpayId,
    verifyMode,
    easyslipApiKey,
    streamerName,
    streamerDescription,
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
  };

  saveConfig(updatedConfig);
  
  // Broadcast update to goal widgets immediately in case goal configuration changed
  io.emit('goal-update', {
    title: updatedConfig.goalTitle,
    target: updatedConfig.goalTarget,
    current: updatedConfig.goalCurrent,
    enabled: updatedConfig.goalEnabled
  });

  res.json({ message: 'Configuration saved successfully', config: updatedConfig });
});

// Logo Upload Endpoint
app.post('/api/upload-logo', (req, res) => {
  const { imageBase64 } = req.body;
  if (!imageBase64) {
    return res.status(400).json({ error: 'No image data provided' });
  }
  
  try {
    const buffer = Buffer.from(imageBase64, 'base64');
    const targetPath = path.join(__dirname, 'public', 'streamer_logo.jpg');
    
    fs.writeFileSync(targetPath, buffer);
    res.json({ success: true, message: 'Streamer logo updated successfully' });
  } catch (error) {
    console.error('Logo upload error:', error);
    res.status(500).json({ error: 'Failed to save logo image file' });
  }
});

// Banner Image Upload Endpoint
app.post('/api/upload-banner', (req, res) => {
  const { imageBase64 } = req.body;
  if (!imageBase64) {
    return res.status(400).json({ error: 'No image data provided' });
  }
  
  try {
    const buffer = Buffer.from(imageBase64, 'base64');
    const targetPath = path.join(__dirname, 'public', 'streamer_banner.jpg');
    
    fs.writeFileSync(targetPath, buffer);
    
    const config = loadConfig();
    config.viewerBannerFile = 'streamer_banner.jpg';
    saveConfig(config);
    
    res.json({ success: true, message: 'Streamer banner updated successfully' });
  } catch (error) {
    console.error('Banner upload error:', error);
    res.status(500).json({ error: 'Failed to save banner image file' });
  }
});

// Custom sound file upload endpoint
app.post('/api/upload-sound', (req, res) => {
  const { soundBase64, filename } = req.body;
  if (!soundBase64) {
    return res.status(400).json({ error: 'No sound data provided' });
  }
  
  try {
    const ext = path.extname(filename || 'alert.mp3').toLowerCase();
    const buffer = Buffer.from(soundBase64, 'base64');
    const targetFilename = `alert_chime${ext}`;
    const targetPath = path.join(__dirname, 'public', targetFilename);
    
    // Clean old files
    const possibleFiles = ['alert_chime.mp3', 'alert_chime.wav', 'alert_chime.ogg'];
    for (const f of possibleFiles) {
      const p = path.join(__dirname, 'public', f);
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch(err){}
      }
    }
    
    fs.writeFileSync(targetPath, buffer);
    
    // Write into config
    const config = loadConfig();
    config.alertSoundFile = targetFilename;
    saveConfig(config);
    
    res.json({ success: true, message: 'Sound chime uploaded successfully', filename: targetFilename });
  } catch (error) {
    console.error('Sound upload error:', error);
    res.status(500).json({ error: 'Failed to save sound file' });
  }
});

// Donations list API
app.get('/api/donations', (req, res) => {
  res.json(loadDonations());
});

// Register a Donation (Applies profanity filtering)
app.post('/api/donate', (req, res) => {
  const { name, message, amount } = req.body;
  
  if (!name || !amount || isNaN(amount) || parseFloat(amount) <= 0) {
    return res.status(400).json({ error: 'Invalid name or amount' });
  }
  
  const config = loadConfig();
  
  // Enforce general minimum donation amount validation
  const minAmount = Number(config.minDonateAmount) || 1;
  if (parseFloat(amount) < minAmount) {
    return res.status(400).json({ error: `จำนวนเงินสนับสนุนต่ำกว่าเกณฑ์ขั้นต่ำ (${minAmount} บาท)` });
  }
  
  // Filter profanity on name and message
  const filteredName = filterProfanity(name.trim(), config.bannedWords);
  const filteredMessage = filterProfanity((message || '').trim(), config.bannedWords);
  
  const donationId = 'don_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  const qrPayload = generatePayload(config.promptpayId, { amount: parseFloat(amount) });
  
  const donation = {
    id: donationId,
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

// Trigger Mock Success manually or automatically in simulation mode
app.post('/api/simulate-success', (req, res) => {
  const { donationId } = req.body;
  const donations = loadDonations();
  const donationIndex = donations.findIndex(d => d.id === donationId);
  
  if (donationIndex === -1) {
    return res.status(404).json({ error: 'Donation not found' });
  }
  
  const donation = donations[donationIndex];
  if (donation.status === 'paid' || donation.status === 'pending_approval') {
    return res.status(400).json({ error: 'Donation already processed' });
  }
  
  const config = loadConfig();
  completePayment(donation, config);
  saveDonations(donations);
  
  res.json({ success: true, donation });
});

// Verify Slip using EasySlip API v2
app.post('/api/verify', async (req, res) => {
  const { qrData, donationId } = req.body;
  
  if (!qrData || !donationId) {
    return res.status(400).json({ error: 'QR Data and Donation ID are required' });
  }
  
  const donations = loadDonations();
  const donationIndex = donations.findIndex(d => d.id === donationId);
  if (donationIndex === -1) {
    return res.status(404).json({ error: 'Donation record not found' });
  }
  
  const donation = donations[donationIndex];
  if (donation.status === 'paid' || donation.status === 'pending_approval') {
    return res.json({ success: true, message: 'Already processed', donation });
  }
  
  const config = loadConfig();
  
  // Guard check for Simulation Mode vs EasySlip Mode
  if (config.verifyMode === 'simulate') {
    completePayment(donation, config);
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
      
      completePayment(donation, config);
      saveDonations(donations);
      
      return res.json({ 
        success: true, 
        message: 'ตรวจสลิปทดสอบสำเร็จ (ไม่ต้องใช้ API Key)', 
        donation 
      });
    }
    
    return res.status(400).json({ error: 'ตั้งค่า API Key ของ EasySlip ไม่ครบถ้วน และ QR Code ของสลิปไม่ถูกต้อง' });
  }
  
  try {
    const response = await axios.post(
      'https://api.easyslip.com/v2/verify/bank',
      {
        payload: qrData,
        matchAmount: donation.amount
      },
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
        return res.status(400).json({ error: `ยอดเงินในสลิป (${slipAmount} THB) ไม่ตรงกับยอดที่ระบุ (${donation.amount} THB)` });
      }
      
      const rawSenderName = slipData.rawSlip?.sender?.displayName || slipData.rawSlip?.sender?.nameTh || donation.name;
      const filteredSenderName = filterProfanity(rawSenderName, config.bannedWords);
      
      donation.slipQrData = qrData;
      donation.transRef = slipData.transRef;
      donation.senderName = filteredSenderName;
      
      completePayment(donation, config);
      saveDonations(donations);
      
      res.json({ success: true, donation });
    } else {
      res.status(400).json({ error: result.error?.message || 'สลิปไม่ถูกต้อง หรือไม่ผ่านการตรวจสอบ' });
    }
  } catch (error) {
    console.error('EasySlip API Error:', error.response?.data || error.message);
    const errorMsg = error.response?.data?.error?.message || 'การเชื่อมต่อ EasySlip ล้มเหลว โปรดตรวจสอบคีย์ API';
    res.status(500).json({ error: errorMsg });
  }
});

// --- METHOD 1: Mobile Notification Webhook (MacroDroid / Tasker) ---
app.all('/api/webhook/notification', (req, res) => {
  const title = req.query.title || req.body.title || '';
  const text = req.query.text || req.body.text || '';
  
  console.log(`[Notification Webhook] Received notification via ${req.method}: Title="${title}", Text="${text}"`);
  
  if (!text) {
    return res.status(400).json({ error: 'Notification text is required' });
  }
  
  const parsed = parseNotificationText(title, text);
  console.log(`[Notification Webhook] Parsed: Amount=${parsed.amount} THB, Sender="${parsed.sender}"`);
  
  if (!parsed.amount || isNaN(parsed.amount)) {
    return res.status(200).json({ status: 'ignored', message: 'No valid transfer amount found in notification text' });
  }
  
  const config = loadConfig();
  const filteredSender = filterProfanity(parsed.sender, config.bannedWords);
  const donations = loadDonations();
  const now = new Date();
  const timeLimitMs = 20 * 60 * 1000;
  
  const matchIndex = donations.findIndex(d => {
    if (d.status !== 'pending') return false;
    const isAmountMatch = Math.abs(d.amount - parsed.amount) < 0.01;
    const isWithinTime = (now - new Date(d.createdAt)) < timeLimitMs;
    return isAmountMatch && isWithinTime;
  });
  
  if (matchIndex !== -1) {
    const donation = donations[matchIndex];
    donation.senderName = filteredSender;
    donation.verificationMethod = 'Notification Forwarder';
    
    completePayment(donation, config);
    saveDonations(donations);
    
    console.log(`[Notification Webhook] Matched pending donation ID ${donation.id} for ${donation.amount} THB`);
    return res.json({ status: 'success', matched: true, donation });
  } else {
    const donationId = 'don_direct_' + Date.now();
    const newDonation = {
      id: donationId,
      name: `คุณ ${filteredSender} (โอนตรง)`,
      message: filterProfanity('สนับสนุนสตรีมเมอร์ผ่านบัญชีธนาคารโดยตรง', config.bannedWords),
      amount: parsed.amount,
      createdAt: now.toISOString(),
      senderName: filteredSender,
      verificationMethod: 'Notification Forwarder (Direct)'
    };
    
    completePayment(newDonation, config);
    donations.push(newDonation);
    saveDonations(donations);
    
    console.log(`[Notification Webhook] Created direct donation for ${newDonation.amount} THB`);
    return res.json({ status: 'success', matched: false, donation: newDonation });
  }
});

// Approve Pending Donation
app.post('/api/donations/approve', (req, res) => {
  const { donationId } = req.body;
  if (!donationId) return res.status(400).json({ error: 'Donation ID is required' });
  
  const donations = loadDonations();
  const donationIndex = donations.findIndex(d => d.id === donationId);
  if (donationIndex === -1) {
    return res.status(404).json({ error: 'Donation not found' });
  }
  
  const donation = donations[donationIndex];
  if (donation.status !== 'pending_approval') {
    return res.status(400).json({ error: 'Donation is not in pending approval state' });
  }
  
  donation.status = 'paid';
  donation.approvedAt = new Date().toISOString();
  saveDonations(donations);
  
  // Trigger overlay alert display
  io.emit('donation-alert', {
    id: donation.id,
    name: donation.name,
    senderRealName: donation.senderName || donation.name,
    message: donation.message,
    amount: donation.amount,
    timestamp: donation.paidAt
  });
  
  res.json({ success: true, donation });
});

// Reject Pending Donation
app.post('/api/donations/reject', (req, res) => {
  const { donationId } = req.body;
  if (!donationId) return res.status(400).json({ error: 'Donation ID is required' });
  
  const donations = loadDonations();
  const donationIndex = donations.findIndex(d => d.id === donationId);
  if (donationIndex === -1) {
    return res.status(404).json({ error: 'Donation not found' });
  }
  
  const donation = donations[donationIndex];
  if (donation.status !== 'pending_approval') {
    return res.status(400).json({ error: 'Donation is not in pending approval state' });
  }
  
  donation.status = 'rejected';
  donation.rejectedAt = new Date().toISOString();
  saveDonations(donations);
  
  res.json({ success: true, donation });
});

// Get Statistics for Dashboard Summary Tab
app.get('/api/stats', (req, res) => {
  const donations = loadDonations();
  const paidAndApproval = donations.filter(d => d.status === 'paid' || d.status === 'pending_approval');
  
  const totalAmount = paidAndApproval.reduce((sum, d) => sum + d.amount, 0);
  
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  
  const todayAmount = paidAndApproval
    .filter(d => new Date(d.paidAt || d.createdAt) >= startOfToday)
    .reduce((sum, d) => sum + d.amount, 0);

  // Aggregate Top Donators list
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

// --- API Proxy for Google Translate TTS (Bypasses Referrer Blocks) ---
app.get('/api/tts', async (req, res) => {
  const { text, lang } = req.query;
  if (!text) {
    return res.status(400).send('Text is required');
  }
  
  const targetLang = lang || 'th';
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${targetLang}&client=tw-ob&q=${encodeURIComponent(text)}`;
  
  try {
    const response = await axios({
      method: 'get',
      url: url,
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36'
      }
    });
    
    res.setHeader('Content-Type', 'audio/mpeg');
    response.data.pipe(res);
  } catch (error) {
    console.error('[TTS Proxy Error]:', error.message);
    res.status(500).send('Failed to retrieve speech audio');
  }
});

// Trigger a Test Alert from Dashboard (bypasses approval queue for testing ease)
app.post('/api/test-alert', (req, res) => {
  const { name, message, amount } = req.body;
  const config = loadConfig();
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
  
  // Directly broadcast to overlay (bypassing requireApproval queue so testing works instantly)
  io.emit('donation-alert', testAlert);
  res.json({ success: true, alert: testAlert });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('=============================================');
  console.log(`Donate Overlay System is running!`);
  console.log(`- Web Server: http://localhost:${PORT}`);
  console.log(`- Viewer Page: http://localhost:${PORT}/index.html`);
  console.log(`- OBS Overlay: http://localhost:${PORT}/overlay.html`);
  console.log(`- Admin Panel: http://localhost:${PORT}/admin.html`);
  console.log('=============================================');
});
