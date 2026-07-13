let socket;
let pendingLogoBase64 = null; // Holds base64 data for upload

document.addEventListener('DOMContentLoaded', () => {
  initSocket();
  fetchConfig();
  fetchDonations();
  setupFormHandlers();
});

// Init Socket connection
function initSocket() {
  socket = io();

  socket.on('connect', () => {
    console.log('Admin connected to WebSocket');
  });

  // When a donation completes, refresh the logs in real-time
  socket.on('donation-alert', () => {
    fetchDonations();
  });
}

// Fetch current configurations
async function fetchConfig() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json();

    document.getElementById('promptpayId').value = config.promptpayId || '';
    document.getElementById('verifyMode').value = config.verifyMode || 'simulate';
    document.getElementById('easyslipApiKey').value = config.easyslipApiKey || '';
    document.getElementById('streamerName').value = config.streamerName || '';
    document.getElementById('streamerDescription').value = config.streamerDescription || '';

    // Cache buster for the profile preview image
    const adminLogo = document.getElementById('adminLogoPreview');
    adminLogo.src = `/streamer_logo.jpg?t=${Date.now()}`;

    toggleVerifyFields();
  } catch (error) {
    console.error('Error fetching config:', error);
  }
}

// Show/hide EasySlip settings based on selected mode
function toggleVerifyFields() {
  const mode = document.getElementById('verifyMode').value;
  const easyslipFields = document.getElementById('easyslip-settings');
  if (mode === 'easyslip') {
    easyslipFields.style.display = 'block';
  } else {
    easyslipFields.style.display = 'none';
  }
}

// Fetch all donation logs
async function fetchDonations() {
  try {
    const response = await fetch('/api/donations');
    const donations = await response.json();
    renderDonationsTable(donations);
  } catch (error) {
    console.error('Error fetching donations:', error);
  }
}

// Setup form submit events
function setupFormHandlers() {
  // Handle local image file selection
  const logoInput = document.getElementById('streamerLogoInput');
  const logoPreview = document.getElementById('adminLogoPreview');

  logoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        logoPreview.src = event.target.result; // Display preview locally
        pendingLogoBase64 = event.target.result.split(',')[1]; // Capture base64 portion
      };
      reader.readAsDataURL(file);
    }
  });

  // Save Settings Form
  const configForm = document.getElementById('configForm');
  configForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const promptpayId = document.getElementById('promptpayId').value.trim();
    const verifyMode = document.getElementById('verifyMode').value;
    const easyslipApiKey = document.getElementById('easyslipApiKey').value.trim();
    const streamerName = document.getElementById('streamerName').value.trim();
    const streamerDescription = document.getElementById('streamerDescription').value.trim();

    if (!promptpayId) {
      alert('กรุณากรอก PromptPay ID');
      return;
    }

    const btn = document.getElementById('btnSaveConfig');
    btn.disabled = true;
    btn.innerText = 'กำลังบันทึก...';

    try {
      // Step 1: Upload profile picture first if a new one was selected
      if (pendingLogoBase64) {
        console.log('Uploading new streamer logo image...');
        const logoUploadResponse = await fetch('/api/upload-logo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: pendingLogoBase64 })
        });
        
        const logoUploadResult = await logoUploadResponse.json();
        if (!logoUploadResult.success) {
          throw new Error(logoUploadResult.error || 'Failed to upload profile image');
        }
        pendingLogoBase64 = null; // Clear pending state
      }

      // Step 2: Upload other configurations
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptpayId, verifyMode, easyslipApiKey, streamerName, streamerDescription })
      });

      await response.json();
      alert('บันทึกการตั้งค่าทั้งหมดเรียบร้อยแล้ว');
      fetchConfig(); // Reload and refresh cache bust
    } catch (error) {
      console.error('Error saving configurations:', error);
      alert('บันทึกการตั้งค่าล้มเหลว: ' + error.message);
    } finally {
      btn.disabled = false;
      btn.innerText = 'บันทึกการตั้งค่า';
    }
  });

  // Submit Test Alert Form
  const testForm = document.getElementById('testForm');
  testForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('testName').value.trim();
    const message = document.getElementById('testMessage').value.trim();
    const amount = parseFloat(document.getElementById('testAmount').value);

    await triggerTestAlert(name, message, amount);
  });
}

// Quick Test Presets helper
async function sendQuickTest(amount) {
  const name = document.getElementById('testName').value.trim() || 'พี่เก่งสายเปย์';
  const message = document.getElementById('testMessage').value.trim() || 'โดเนททดสอบจ้า!';
  await triggerTestAlert(name, message, amount);
}

// REST call to trigger mock alerts
async function triggerTestAlert(name, message, amount) {
  try {
    const response = await fetch('/api/test-alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, message, amount })
    });
    const data = await response.json();
    if (data.success) {
      console.log('Test alert triggered successfully');
    } else {
      alert('เกิดข้อผิดพลาดในการส่งการทดสอบ');
    }
  } catch (error) {
    console.error('Error triggering test alert:', error);
    alert('เชื่อมต่อเซิร์ฟเวอร์ล้มเหลว');
  }
}

// Render donations to HTML table
function renderDonationsTable(donations) {
  const tbody = document.getElementById('logTableBody');
  
  if (donations.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 40px;">
          ไม่มีประวัติการโดเนทในปัจจุบัน
        </td>
      </tr>
    `;
    return;
  }

  // Sort: most recent first
  const sorted = [...donations].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  tbody.innerHTML = sorted.map(d => {
    const date = new Date(d.createdAt).toLocaleString('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });

    const statusBadge = d.status === 'paid' 
      ? `<span class="status-paid">✓ สำเร็จ (Paid)</span>` 
      : `<span class="status-pending">⏱ รอชำระ (Pending)</span>`;

    const verifyType = d.slipQrData 
      ? 'ตรวจสลิป (EasySlip)' 
      : (d.isTest ? 'โดเนททดสอบ' : 'โหมดจำลอง (Simulation)');

    return `
      <tr>
        <td style="color: var(--text-muted); font-size: 13px;">${date}</td>
        <td><strong>${escapeHtml(d.name)}</strong></td>
        <td style="color: #d1cde3; font-style: italic;">"${escapeHtml(d.message || '')}"</td>
        <td style="color: #00ff87; font-weight: 700;">${d.amount.toFixed(2)} บาท</td>
        <td>${statusBadge}</td>
        <td style="color: var(--text-muted); font-size: 13px;">${verifyType}</td>
      </tr>
    `;
  }).join('');
}

// Utility to escape HTML and prevent XSS
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
