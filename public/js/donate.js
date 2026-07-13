let socket;
let currentDonationId = null;
let currentAmount = 0;
let currentName = '';
let currentMessage = '';
let config = {};

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
      showSuccessScreen(alertData);
    }
  });
}

// Fetch current system configuration
async function fetchConfig() {
  try {
    const response = await fetch('/api/config');
    config = await response.json();
  } catch (error) {
    console.error('Error fetching config:', error);
  }
}

// Set up UI events
function setupEventListeners() {
  const form = document.getElementById('donateForm');
  form.addEventListener('submit', handleFormSubmit);

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

// Step 1 Form Submission -> Generates PromptPay QR
async function handleFormSubmit(e) {
  e.preventDefault();
  
  const name = document.getElementById('donorName').value.trim();
  const message = document.getElementById('donorMessage').value.trim();
  const amount = parseFloat(document.getElementById('donateAmount').value);

  if (!name || isNaN(amount) || amount <= 0) {
    alert('กรุณากรอกข้อมูลให้ครบถ้วน และถูกต้อง');
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
  qrContainer.innerHTML = ''; // Clear previous
  
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
  
  // Refresh config state just in case admin changed it
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

  // Swap tabs
  switchStep('step-form', 'step-payment');
}

// Switch step containers
function switchStep(fromId, toId) {
  document.getElementById(fromId).classList.remove('active');
  document.getElementById(toId).classList.add('active');
}

// Return to edit details
function goBackToForm() {
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
        // QR Code Found, verify payload
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

// Verify QR string with Server -> SlipOK
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
      // The WebSocket event will also trigger success, but we trigger it here just in case
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
  
  currentDonationId = null;
  currentAmount = 0;
  currentName = '';
  currentMessage = '';

  switchStep('step-success', 'step-form');
}
