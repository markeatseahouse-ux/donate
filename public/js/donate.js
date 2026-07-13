let socket;
let currentDonationId = null;
let currentAmount = 0;
let currentName = '';
let currentMessage = '';
let config = {};
let countdownInterval = null;

// QR code renderer instance
let qrCodeInstance = null;

// Initialize components
document.addEventListener('DOMContentLoaded', () => {
  initSocket();
  fetchConfig();
  setupEventListeners();
});

// Connect to WebSocket Server
function initSocket() {
  socket = io();
  
  socket.on('connect', () => {
    console.log('Connected to server WebSocket');
  });

  // Listen for real-time success broadcast
  socket.on('donation-alert', (alertData) => {
    if (currentDonationId && alertData.id === currentDonationId) {
      if (countdownInterval) clearInterval(countdownInterval);
      showSuccessScreen(alertData);
    }
  });
}

// Fetch current system configuration
async function fetchConfig() {
  try {
    const response = await fetch('/api/config?t=' + Date.now());
    config = await response.json();
    
    // Dynamic page branding
    document.getElementById('streamerName').innerText = config.streamerName || 'SEAHOUSE STREAM';
    document.getElementById('streamerDescription').innerText = config.streamerDescription || 'ขอบคุณสำหรับการสนับสนุน!';
    
    const avatarImg = document.querySelector('.streamer-avatar');
    if (avatarImg) {
      avatarImg.src = `/streamer_logo.jpg?t=${Date.now()}`;
    }

    const bannerImg = document.getElementById('streamerBanner');
    if (bannerImg) {
      bannerImg.src = `/streamer_banner.jpg?t=${Date.now()}`;
    }

    // Apply custom page accent styling colors dynamically
    if (config.viewerAccentColor) {
      document.documentElement.style.setProperty('--accent-color', config.viewerAccentColor);
      document.documentElement.style.setProperty('--primary-gradient', `linear-gradient(135deg, ${config.viewerAccentColor} 0%, #ff007f 100%)`);
    }

    // Set minimum donation constraints
    const minVal = config.minDonateAmount !== undefined ? config.minDonateAmount : 1;
    const amountInput = document.getElementById('donateAmount');
    if (amountInput) {
      amountInput.min = minVal;
    }
    const minText = document.getElementById('minDonateText');
    if (minText) {
      minText.innerText = `โอนสนับสนุนขั้นต่ำ ${minVal} บาท`;
    }
  } catch (error) {
    console.error('Error fetching config:', error);
  }
}

// Set up UI events
function setupEventListeners() {
  const form = document.getElementById('donateForm');
  form.addEventListener('submit', handleFormSubmit);

  // Clear presets active state if user types custom amount
  const amountInput = document.getElementById('donateAmount');
  amountInput.addEventListener('input', () => {
    const chips = document.querySelectorAll('.preset-chip');
    chips.forEach(chip => chip.classList.remove('active'));
  });

  // Simulation Mode payment button
  const btnSimulatePay = document.getElementById('btnSimulatePay');
  btnSimulatePay.addEventListener('click', handleSimulatePayment);

  // File upload input and drop zone
  const uploadBox = document.getElementById('uploadBox');
  const slipInput = document.getElementById('slipInput');

  uploadBox.addEventListener('click', () => slipInput.click());
  
  uploadBox.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadBox.classList.add('dragover');
  });

  uploadBox.addEventListener('dragleave', () => {
    uploadBox.classList.remove('dragover');
  });

  uploadBox.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadBox.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      slipInput.files = e.dataTransfer.files;
      handleSlipUpload(e.dataTransfer.files[0]);
    }
  });

  slipInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleSlipUpload(e.target.files[0]);
    }
  });
}

// Preset chip helper
function setPresetAmount(amount) {
  document.getElementById('donateAmount').value = amount;
  
  const chips = document.querySelectorAll('.preset-chip');
  chips.forEach(chip => {
    if (parseInt(chip.innerText) === amount) {
      chip.classList.add('active');
    } else {
      chip.classList.remove('active');
    }
  });
}

// Counter helper
function updateCharCounter(el) {
  const counter = document.getElementById('charCounter');
  counter.innerText = `${el.value.length} / 200`;
}

// Step 1 Form Submission -> Generates PromptPay QR
async function handleFormSubmit(e) {
  e.preventDefault();
  
  const name = document.getElementById('donorName').value.trim();
  const message = document.getElementById('donorMessage').value.trim();
  const amount = parseFloat(document.getElementById('donateAmount').value);

  const minAmount = config.minDonateAmount !== undefined ? config.minDonateAmount : 1;

  if (!name || isNaN(amount) || amount < minAmount) {
    alert(`กรุณากรอกข้อมูลให้ถูกต้อง ยอดโอนสนับสนุนขั้นต่ำคือ ${minAmount} บาท`);
    return;
  }

  const btnSubmit = document.getElementById('btnSubmit');
  btnSubmit.disabled = true;
  btnSubmit.innerHTML = '<span class="spinner"></span> <span>กำลังสร้าง QR Code...</span>';

  try {
    const response = await fetch('/api/donate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, message, amount })
    });

    const data = await response.json();
    
    if (data.success) {
      currentDonationId = data.donationId;
      currentAmount = data.amount;
      currentName = name;
      currentMessage = message;

      // Show Payment Step
      showPaymentStep(data.qrPayload, data.amount);
    } else {
      alert('เกิดข้อผิดพลาด: ' + (data.error || 'ไม่สามารถสร้างรายการได้'));
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = '<span>ดำเนินการต่อ</span>';
    }
  } catch (error) {
    console.error('Submit error:', error);
    alert('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
    btnSubmit.disabled = false;
    btnSubmit.innerHTML = '<span>ดำเนินการต่อ</span>';
  }
}

// Display Step 2 Screen
function showPaymentStep(qrPayload, amount) {
  document.getElementById('displayAmount').innerHTML = `${amount.toFixed(2)} <span>THB</span>`;
  
  // Render QR Code
  const qrContainer = document.getElementById('qrcode');
  qrContainer.innerHTML = '';
  qrContainer.style.opacity = '1';
  
  qrCodeInstance = new QRCode(qrContainer, {
    text: qrPayload,
    width: 256,
    height: 256,
    colorDark: "#000000",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.M
  });

  // Toggle sections based on verifyMode
  const simulateSec = document.getElementById('simulate-section');
  const slipSec = document.getElementById('slip-section');
  
  // Hide image preview initially
  document.getElementById('slipPreviewContainer').style.display = 'none';
  document.getElementById('slipPreviewImg').src = '';
  document.getElementById('slipInput').value = ''; // Reset file input

  fetchConfig().then(() => {
    if (config.verifyMode === 'simulate') {
      simulateSec.style.display = 'block';
      slipSec.style.display = 'none';
    } else {
      simulateSec.style.display = 'none';
      slipSec.style.display = 'block';
    }
  });

  // Reset status badge
  updateStatusBadge('pending', 'รอการชำระเงิน...');
  
  // Start countdown timer
  startPaymentCountdown();

  // Swap tabs
  switchStep('step-form', 'step-payment');
}

// 10-Minute payment countdown timer
function startPaymentCountdown() {
  if (countdownInterval) clearInterval(countdownInterval);
  
  let timeLeft = 600; // 10 minutes in seconds
  const timerText = document.getElementById('timerText');
  const countdownTimer = document.getElementById('countdownTimer');
  
  countdownTimer.style.display = 'flex';
  
  const updateTimer = () => {
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    timerText.innerText = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    
    if (timeLeft <= 0) {
      clearInterval(countdownInterval);
      updateStatusBadge('pending', 'QR Code หมดอายุแล้ว กรุณากดย้อนกลับเพื่อสร้างใหม่');
      document.getElementById('qrcode').style.opacity = '0.25';
    }
    timeLeft--;
  };
  
  updateTimer();
  countdownInterval = setInterval(updateTimer, 1000);
}

// Switch step containers
function switchStep(fromId, toId) {
  document.getElementById(fromId).classList.remove('active');
  document.getElementById(toId).classList.add('active');
}

// Return to edit details
function goBackToForm() {
  if (countdownInterval) clearInterval(countdownInterval);
  document.getElementById('btnSubmit').disabled = false;
  document.getElementById('btnSubmit').innerHTML = '<span>ดำเนินการต่อ</span>';
  switchStep('step-payment', 'step-form');
}

// Simulate Payment Process
async function handleSimulatePayment() {
  if (!currentDonationId) return;
  
  const btn = document.getElementById('btnSimulatePay');
  btn.disabled = true;
  btn.innerText = 'กำลังส่งข้อมูล...';
  
  updateStatusBadge('loading', 'กำลังส่งข้อมูลการชำระเงิน...');

  try {
    const response = await fetch('/api/simulate-success', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ donationId: currentDonationId })
    });
    
    const data = await response.json();
    if (!data.success) {
      alert('เกิดข้อผิดพลาด: ' + (data.error || 'ล้มเหลว'));
      btn.disabled = false;
      btn.innerText = 'ยืนยันการชำระเงิน (จำลอง)';
      updateStatusBadge('pending', 'รอการชำระเงิน...');
    }
  } catch (error) {
    console.error('Simulation error:', error);
    alert('เกิดข้อผิดพลาดในการเชื่อมต่อ');
    btn.disabled = false;
    btn.innerText = 'ยืนยันการชำระเงิน (จำลอง)';
    updateStatusBadge('pending', 'รอการชำระเงิน...');
  }
}

// Handle image upload and parse QR code from receipt
function handleSlipUpload(file) {
  if (!file) return;

  updateStatusBadge('loading', 'กำลังอ่านไฟล์รูปภาพสลิป...');

  const reader = new FileReader();
  reader.onload = (e) => {
    // Show thumbnail preview of the uploaded slip
    const previewContainer = document.getElementById('slipPreviewContainer');
    const previewImg = document.getElementById('slipPreviewImg');
    
    previewImg.src = e.target.result;
    previewContainer.style.display = 'block';
    
    const img = new Image();
    img.onload = () => {
      // Decode QR Code
      const canvas = document.getElementById('scanCanvas');
      const ctx = canvas.getContext('2d');
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0, img.width, img.height);
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);

      if (code) {
        console.log('Slip QR Code Payload Found:', code.data);
        verifySlipOnServer(code.data);
      } else {
        updateStatusBadge('pending', 'ไม่พบคิวอาร์โค้ดบนสลิป โปรดลองอีกครั้ง');
        alert('ไม่พบคิวอาร์โค้ดในสลิปของคุณ กรุณาอัปโหลดรูปภาพสลิปใบเสร็จเต็มใบที่ชัดเจน');
      }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// Verify QR string with Server -> EasySlip
async function verifySlipOnServer(qrData) {
  updateStatusBadge('loading', 'กำลังตรวจสอบสลิปกับระบบธนาคาร...');
  
  try {
    const response = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        qrData: qrData,
        donationId: currentDonationId
      })
    });

    const data = await response.json();
    
    if (data.success) {
      if (countdownInterval) clearInterval(countdownInterval);
      showSuccessScreen(data.donation);
    } else {
      updateStatusBadge('pending', 'ตรวจสอบล้มเหลว');
      alert('ตรวจสอบสลิปไม่ผ่าน: ' + (data.error || 'ยอดเงินไม่ตรง หรือสลิปถูกนำมาใช้ซ้ำแล้ว'));
    }
  } catch (error) {
    console.error('Slip verify error:', error);
    updateStatusBadge('pending', 'เชื่อมต่อระบบตรวจสลิปล้มเหลว');
    alert('การตรวจสอบสลิปล้มเหลวเนื่องจากการเชื่อมต่อขัดข้อง');
  }
}

// Update Status Badge UI
function updateStatusBadge(state, text) {
  const badge = document.getElementById('statusBadge');
  const spinner = document.getElementById('statusSpinner');
  const textSpan = document.getElementById('statusText');

  badge.className = 'status-badge ' + state;
  textSpan.innerText = text;

  if (state === 'loading') {
    spinner.style.display = 'inline-block';
  } else {
    spinner.style.display = 'none';
  }
}

// Transition to Step 3 (Success)
function showSuccessScreen(donationData) {
  if (countdownInterval) clearInterval(countdownInterval);
  document.getElementById('successAmount').innerText = donationData.amount.toFixed(2) + ' THB';
  document.getElementById('successName').innerText = donationData.name;
  document.getElementById('successMessage').innerText = donationData.message ? `"${donationData.message}"` : '';

  switchStep('step-payment', 'step-success');
}

// Reset state
function resetForm() {
  document.getElementById('donateForm').reset();
  document.getElementById('btnSubmit').disabled = false;
  document.getElementById('btnSubmit').innerHTML = '<span>ดำเนินการต่อ</span>';
  
  // Clear presets active state
  const chips = document.querySelectorAll('.preset-chip');
  chips.forEach(chip => chip.classList.remove('active'));
  
  // Clear char counter text
  document.getElementById('charCounter').innerText = '0 / 200';
  
  currentDonationId = null;
  currentAmount = 0;
  currentName = '';
  currentMessage = '';

  switchStep('step-success', 'step-form');
}
