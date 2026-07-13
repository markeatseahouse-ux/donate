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
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to load configurations (Supports Environment Variables for Cloud Deployment)
function loadConfig() {
  const defaults = {
    promptpayId: process.env.PROMPTPAY_ID || '0812345678', 
    verifyMode: process.env.VERIFY_MODE || 'simulate',    
    easyslipApiKey: process.env.EASYSLIP_API_KEY || ''     
  };

  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  try {
    const data = fs.readFileSync(CONFIG_PATH, 'utf8');
    const diskConfig = JSON.parse(data);
    
    // PRIORITIZE diskConfig (saved via admin panel) OVER process.env (Render setup default/fallback)
    return {
      promptpayId: diskConfig.promptpayId || process.env.PROMPTPAY_ID || defaults.promptpayId,
      verifyMode: diskConfig.verifyMode || process.env.VERIFY_MODE || defaults.verifyMode,
      easyslipApiKey: diskConfig.easyslipApiKey || process.env.EASYSLIP_API_KEY || defaults.easyslipApiKey
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

// Socket Connection Handler
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
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
  const { promptpayId, verifyMode, easyslipApiKey } = req.body;
  if (!promptpayId) {
    return res.status(400).json({ error: 'PromptPay ID is required' });
  }
  const config = { promptpayId, verifyMode, easyslipApiKey };
  saveConfig(config);
  res.json({ message: 'Configuration saved successfully', config });
});

// Donations list API
app.get('/api/donations', (req, res) => {
  res.json(loadDonations());
});

// Register a Donation
app.post('/api/donate', (req, res) => {
  const { name, message, amount } = req.body;
  
  if (!name || !amount || isNaN(amount) || parseFloat(amount) <= 0) {
    return res.status(400).json({ error: 'Invalid name or amount' });
  }
  
  const config = loadConfig();
  const donationId = 'don_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  
  const qrPayload = generatePayload(config.promptpayId, { amount: parseFloat(amount) });
  
  const donation = {
    id: donationId,
    name: name.trim(),
    message: (message || '').trim(),
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
  if (donation.status === 'paid') {
    return res.status(400).json({ error: 'Donation already paid' });
  }
  
  donation.status = 'paid';
  donation.paidAt = new Date().toISOString();
  saveDonations(donations);
  
  io.emit('donation-alert', {
    id: donation.id,
    name: donation.name,
    message: donation.message,
    amount: donation.amount,
    timestamp: donation.paidAt
  });
  
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
  if (donation.status === 'paid') {
    return res.json({ success: true, message: 'Already paid', donation });
  }
  
  const config = loadConfig();
  
  // Guard check for Simulation Mode vs EasySlip Mode
  if (config.verifyMode === 'simulate') {
    donation.status = 'paid';
    donation.paidAt = new Date().toISOString();
    saveDonations(donations);
    
    io.emit('donation-alert', {
      id: donation.id,
      name: donation.name,
      message: donation.message,
      amount: donation.amount,
      timestamp: donation.paidAt
    });
    
    return res.json({ success: true, message: 'Simulated payment verified', donation });
  }
  
  const duplicate = donations.find(d => d.slipQrData === qrData && d.status === 'paid');
  if (duplicate) {
    return res.status(400).json({ error: 'สลิปนี้ถูกใช้ไปแล้ว (Duplicate Slip QR Code)' });
  }
  
  if (!config.easyslipApiKey) {
    if (qrData.startsWith('0046')) {
      donation.status = 'paid';
      donation.paidAt = new Date().toISOString();
      donation.slipQrData = qrData;
      donation.transRef = 'MOCK_REF_' + Date.now();
      donation.senderName = 'ผู้โอนตัวจริง (สแกนทดสอบ)';
      
      saveDonations(donations);
      
      io.emit('donation-alert', {
        id: donation.id,
        name: donation.name,
        senderRealName: donation.senderName,
        message: donation.message,
        amount: donation.amount,
        timestamp: donation.paidAt
      });
      
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
      
      donation.status = 'paid';
      donation.paidAt = new Date().toISOString();
      donation.slipQrData = qrData;
      donation.transRef = slipData.transRef;
      donation.senderName = rawSenderName;
      
      saveDonations(donations);
      
      io.emit('donation-alert', {
        id: donation.id,
        name: donation.name,
        senderRealName: donation.senderName,
        message: donation.message,
        amount: donation.amount,
        timestamp: donation.paidAt
      });
      
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
    donation.status = 'paid';
    donation.paidAt = now.toISOString();
    donation.senderName = parsed.sender;
    donation.verificationMethod = 'Notification Forwarder';
    
    saveDonations(donations);
    
    io.emit('donation-alert', {
      id: donation.id,
      name: donation.name,
      senderRealName: parsed.sender,
      message: donation.message,
      amount: donation.amount,
      timestamp: donation.paidAt
    });
    
    console.log(`[Notification Webhook] Matched pending donation ID ${donation.id} for ${donation.amount} THB`);
    return res.json({ status: 'success', matched: true, donation });
  } else {
    const donationId = 'don_direct_' + Date.now();
    const newDonation = {
      id: donationId,
      name: `คุณ ${parsed.sender} (โอนตรง)`,
      message: 'สนับสนุนสตรีมเมอร์ผ่านบัญชีธนาคารโดยตรง',
      amount: parsed.amount,
      status: 'paid',
      paidAt: now.toISOString(),
      createdAt: now.toISOString(),
      senderName: parsed.sender,
      verificationMethod: 'Notification Forwarder (Direct)'
    };
    
    donations.push(newDonation);
    saveDonations(donations);
    
    io.emit('donation-alert', {
      id: newDonation.id,
      name: newDonation.name,
      senderRealName: parsed.sender,
      message: newDonation.message,
      amount: newDonation.amount,
      timestamp: newDonation.paidAt
    });
    
    console.log(`[Notification Webhook] Created direct donation for ${newDonation.amount} THB`);
    return res.json({ status: 'success', matched: false, donation: newDonation });
  }
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

// Trigger a Test Alert from Dashboard
app.post('/api/test-alert', (req, res) => {
  const { name, message, amount } = req.body;
  const testAlert = {
    id: 'test_' + Date.now(),
    name: name || 'ผู้สนับสนุนปริศนา',
    message: message || 'ขอให้สตรีมเมอร์มีความสุขมากๆ ครับ!',
    amount: parseFloat(amount) || 99,
    timestamp: new Date().toISOString(),
    isTest: true
  };
  
  io.emit('donation-alert', testAlert);
  res.json({ success: true, alert: testAlert });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`=============================================`);
  console.log(`Donate Overlay System is running!`);
  console.log(`- Web Server: http://localhost:${PORT}`);
  console.log(`- Viewer Page: http://localhost:${PORT}/index.html`);
  console.log(`- OBS Overlay: http://localhost:${PORT}/overlay.html`);
  console.log(`- Admin Panel: http://localhost:${PORT}/admin.html`);
  console.log(`=============================================`);
});
