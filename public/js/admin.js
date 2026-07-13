let socket;
let pendingLogoBase64 = null; // Streamer avatar file storage
let pendingBannerBase64 = null; // Streamer page banner file storage
let pendingSoundBase64 = null; // Custom chime file storage
let pendingSoundFilename = '';
let currentConfig = {};
let currentUsername = '';

document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  setupEventListeners();
});

// Verify Authenticated State
async function checkAuth() {
  try {
    const response = await fetch('/api/auth/me?t=' + Date.now());
    if (!response.ok) {
      window.location.href = '/login.html';
      return;
    }
    const data = await response.json();
    currentUsername = data.user.username;
    
    // Display Super Admin link for Platform Owner
    if (data.user.role === 'admin') {
      const ownerLink = document.getElementById('superAdminLinkContainer');
      if (ownerLink) ownerLink.style.display = 'block';
    }

    // Populate links into the dashboard inputs immediately
    populateWidgetLinks();
    
    // Initialize Dashboard data loads
    initSocket();
    fetchConfig();
    fetchStats();
    fetchDonations();
  } catch (error) {
    console.error('Authentication check failed:', error);
    window.location.href = '/login.html';
  }
}

// Init Socket connection
function initSocket() {
  socket = io();

  socket.on('connect', () => {
    console.log('Admin dashboard connected to WebSocket');
    // Join scoped streamer room
    if (currentUsername) {
      socket.emit('join-room', currentUsername);
    }
  });

  // Listen for real-time payments or queues to trigger updates
  socket.on('donation-alert', () => {
    refreshAllData();
  });

  socket.on('admin-pending-approval', () => {
    refreshAllData();
  });
}

// Refresh all stats, queue tables and logs
function refreshAllData() {
  fetchStats();
  fetchDonations();
}

// Populate the widget browser source link
function populateWidgetLinks() {
  const base = `${window.location.origin}/${currentUsername}`;

  const goalLinkInput = document.getElementById('goalWidgetLink');
  if (goalLinkInput) {
    goalLinkInput.value = `${base}/goal`;
  }
  
  // Populate Dashboard links
  const viewerLink = document.getElementById('viewerPageLink');
  if (viewerLink) {
    viewerLink.value = `${window.location.origin}/${currentUsername}`;
  }
  
  const overlayLink = document.getElementById('overlayWidgetLink');
  if (overlayLink) {
    overlayLink.value = `${base}/overlay`;
  }
  
  const goalDashLink = document.getElementById('goalWidgetLinkDash');
  if (goalDashLink) {
    goalDashLink.value = `${base}/goal`;
  }
}

// Log Out Handler
window.handleLogout = async function() {
  if (!confirm('คุณแน่ใจหรือไม่ว่าต้องการออกจากระบบ?')) return;
  try {
    const response = await fetch('/api/auth/logout', { method: 'POST' });
    if (response.ok) {
      window.location.href = '/login.html';
    }
  } catch (err) {
    console.error('Logout error:', err);
  }
};

// Helper to switch dashboard tabs
window.switchTab = function(tabId) {
  // Toggle tab buttons active class
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach(btn => {
    if (btn.getAttribute('onclick').includes(tabId)) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Toggle content panels active class
  const tabContents = document.querySelectorAll('.tab-content');
  tabContents.forEach(content => {
    if (content.id === tabId) {
      content.classList.add('active');
    } else {
      content.classList.remove('active');
    }
  });
};

// Copy widget browser source link to clipboard
window.copyWidgetLink = function(inputId) {
  const copyText = document.getElementById(inputId);
  copyText.select();
  copyText.setSelectionRange(0, 99999); // For mobile devices
  
  navigator.clipboard.writeText(copyText.value)
    .then(() => alert('คัดลอกลิงก์เรียบร้อยแล้ว! นำไปใส่ใน Browser Source ของ OBS ได้ทันที'))
    .catch(err => console.error('Failed to copy widget link:', err));
};

// Helper to update slider labels in settings
window.updateRangeText = function(spanId, value) {
  const val = Number(value);
  document.getElementById(spanId).innerText = val.toFixed(2);
};

// Fetch current configurations
async function fetchConfig() {
  try {
    const response = await fetch('/api/config?t=' + Date.now());
    currentConfig = await response.json();

    // Populate Settings form
    document.getElementById('promptpayId').value = currentConfig.promptpayId || '';
    document.getElementById('minDonateAmount').value = currentConfig.minDonateAmount || 1;
    document.getElementById('verifyMode').value = currentConfig.verifyMode || 'simulate';
    document.getElementById('easyslipApiKey').value = currentConfig.easyslipApiKey || '';
    document.getElementById('streamerName').value = currentConfig.streamerName || '';
    document.getElementById('streamerDescription').value = currentConfig.streamerDescription || '';
    document.getElementById('viewerAccentColor').value = currentConfig.viewerAccentColor || '#8a2be2';

    // EasySlip UI restrictions (Only platform owner admin configures the key)
    const isOwner = (currentUsername === 'admin');
    const ownerApiKeyGroup = document.getElementById('ownerApiKeyGroup');
    const streamerApiKeyStatus = document.getElementById('streamerApiKeyStatus');
    
    if (!isOwner) {
      if (ownerApiKeyGroup) ownerApiKeyGroup.style.display = 'none';
      if (streamerApiKeyStatus) {
        streamerApiKeyStatus.style.display = 'block';
        if (currentConfig.isPlatformSlipEnabled) {
          streamerApiKeyStatus.innerHTML = '✅ <strong>ระบบสแกนสลิปพร้อมใช้งาน:</strong> เจ้าของระบบได้เปิดใช้งาน EasySlip สำหรับตรวจสลิปจริงเรียบร้อยแล้ว คุณสามารถเปิดใช้งานโหมดสลิปจริงได้ทันที';
          streamerApiKeyStatus.style.borderColor = 'rgba(0, 255, 135, 0.2)';
          streamerApiKeyStatus.style.background = 'rgba(0, 255, 135, 0.08)';
          streamerApiKeyStatus.style.color = '#00ff87';
        } else {
          streamerApiKeyStatus.innerHTML = '⚠️ <strong>ระบบตรวจสลิปจริงยังไม่พร้อมใช้งาน:</strong> รอเจ้าของระบบเปิดใช้คีย์ตรวจสอบสลิปส่วนกลาง (ปัจจุบันใช้งานได้เฉพาะโหมดจำลอง)';
          streamerApiKeyStatus.style.borderColor = 'rgba(255, 0, 127, 0.2)';
          streamerApiKeyStatus.style.background = 'rgba(255, 0, 127, 0.08)';
          streamerApiKeyStatus.style.color = '#ff3366';
        }
      }
    } else {
      if (ownerApiKeyGroup) ownerApiKeyGroup.style.display = 'block';
      if (streamerApiKeyStatus) streamerApiKeyStatus.style.display = 'none';
    }

    // Populate Advanced settings form
    document.getElementById('requireApproval').checked = !!currentConfig.requireApproval;
    document.getElementById('minAmountTts').value = currentConfig.minAmountTts || 1;
    document.getElementById('soundVolume').value = currentConfig.soundVolume !== undefined ? currentConfig.soundVolume : 0.8;
    updateRangeText('volumeVal', currentConfig.soundVolume !== undefined ? currentConfig.soundVolume : 0.8);
    
    document.getElementById('ttsSpeed').value = currentConfig.ttsSpeed !== undefined ? currentConfig.ttsSpeed : 1.0;
    updateRangeText('speedVal', currentConfig.ttsSpeed !== undefined ? currentConfig.ttsSpeed : 1.0);
    
    document.getElementById('overlayAccentColor').value = currentConfig.overlayAccentColor || '#ff007f';
    document.getElementById('overlayTextColor').value = currentConfig.overlayTextColor || '#ffffff';
    document.getElementById('bannedWords').value = currentConfig.bannedWords || '';
    
    const soundText = document.getElementById('currentSoundText');
    if (currentConfig.alertSoundFile) {
      soundText.innerText = currentConfig.alertSoundFile;
    } else {
      soundText.innerText = 'ใช้เสียงกระดิ่งดนตรีเดิม';
    }

    // Populate Goal tab form
    document.getElementById('goalEnabled').checked = !!currentConfig.goalEnabled;
    document.getElementById('goalTitle').value = currentConfig.goalTitle || '';
    document.getElementById('goalTarget').value = currentConfig.goalTarget || 5000;
    document.getElementById('goalCurrent').value = currentConfig.goalCurrent || 0;

    // Cache buster for the profile preview image
    const adminLogo = document.getElementById('adminLogoPreview');
    adminLogo.src = `/uploads/logos/${currentConfig.userId}.jpg?t=${Date.now()}`;
    adminLogo.onerror = function() {
      this.src = '/streamer_logo.jpg';
      this.onerror = null; // Prevent infinite loops
    };

    // Cache buster for the banner preview image
    const adminBanner = document.getElementById('adminBannerPreview');
    adminBanner.src = `/uploads/banners/${currentConfig.userId}.jpg?t=${Date.now()}`;
    adminBanner.onerror = function() {
      this.src = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=600&q=80';
      this.onerror = null;
    };

    toggleVerifyFields();
  } catch (error) {
    console.error('Error loading config:', error);
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

// Fetch stats panel analytics
async function fetchStats() {
  try {
    const response = await fetch('/api/stats');
    const stats = await response.json();

    document.getElementById('stat-total-amount').innerText = `${stats.totalAmount.toFixed(2)} THB`;
    document.getElementById('stat-today-amount').innerText = `${stats.todayAmount.toFixed(2)} THB`;
    document.getElementById('stat-pending-approvals').innerText = stats.approvalCount;

    // Moderation queue badge in tab bar
    const badge = document.getElementById('approvalBadgeCount');
    if (stats.approvalCount > 0) {
      badge.innerText = stats.approvalCount;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }

    renderTopDonatorsTable(stats.topDonators);
  } catch (error) {
    console.error('Error fetching statistics:', error);
  }
}

// Fetch and render table log history & approval queue
async function fetchDonations() {
  try {
    const response = await fetch('/api/donations');
    const donations = await response.json();
    
    renderDonationsTable(donations);
    renderQueueTable(donations);
  } catch (error) {
    console.error('Error fetching logs:', error);
  }
}

// Setup file pickers and forms submit events
function setupEventListeners() {
  // General config form
  const configForm = document.getElementById('configForm');
  configForm.addEventListener('submit', handleConfigSubmit);

  // Logo file selection preview
  const logoInput = document.getElementById('streamerLogoInput');
  const logoPreview = document.getElementById('adminLogoPreview');
  logoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        logoPreview.src = event.target.result;
        pendingLogoBase64 = event.target.result.split(',')[1];
      };
      reader.readAsDataURL(file);
    }
  });

  // Banner file selection preview
  const bannerInput = document.getElementById('streamerBannerInput');
  const bannerPreview = document.getElementById('adminBannerPreview');
  bannerInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        bannerPreview.src = event.target.result;
        pendingBannerBase64 = event.target.result.split(',')[1];
      };
      reader.readAsDataURL(file);
    }
  });

  // Advanced overlay settings form
  const advConfigForm = document.getElementById('advConfigForm');
  advConfigForm.addEventListener('submit', handleAdvConfigSubmit);

  // Sound file selection capture
  const soundInput = document.getElementById('soundFileInput');
  const soundText = document.getElementById('currentSoundText');
  soundInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      soundText.innerText = `กำลังเลือก: ${file.name}`;
      const reader = new FileReader();
      reader.onload = (event) => {
        pendingSoundBase64 = event.target.result.split(',')[1];
        pendingSoundFilename = file.name;
        soundText.innerText = file.name + ' (พร้อมบันทึก)';
      };
      reader.readAsDataURL(file);
    }
  });

  // Goal configurations form
  const goalForm = document.getElementById('goalForm');
  goalForm.addEventListener('submit', handleGoalSubmit);

  // Standalone min donate form
  const minDonateForm = document.getElementById('minDonateForm');
  minDonateForm.addEventListener('submit', handleMinDonateSubmit);

  // Test Alert trigger form
  const testForm = document.getElementById('testForm');
  testForm.addEventListener('submit', handleTestAlertSubmit);
}

// Save General settings config
async function handleConfigSubmit(e) {
  e.preventDefault();

  const promptpayId = document.getElementById('promptpayId').value.trim();
  const minDonateAmount = parseFloat(document.getElementById('minDonateAmount').value) || 1;
  const verifyMode = document.getElementById('verifyMode').value;
  const easyslipApiKey = document.getElementById('easyslipApiKey').value.trim();
  const streamerName = document.getElementById('streamerName').value.trim();
  const streamerDescription = document.getElementById('streamerDescription').value.trim();
  const viewerAccentColor = document.getElementById('viewerAccentColor').value;

  if (!promptpayId) {
    alert('กรุณากรอก PromptPay ID');
    return;
  }

  const btn = document.getElementById('btnSaveConfig');
  btn.disabled = true;
  btn.innerText = 'กำลังบันทึก...';

  try {
    // 1. Upload logo image first if selected
    if (pendingLogoBase64) {
      console.log('Uploading custom logo...');
      const uploadRes = await fetch('/api/upload-logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: pendingLogoBase64 })
      });
      const uploadResult = await uploadRes.json();
      if (!uploadResult.success) throw new Error(uploadResult.error || 'Failed logo upload');
      pendingLogoBase64 = null; // Reset
    }

    // 2. Upload banner image if selected
    if (pendingBannerBase64) {
      console.log('Uploading custom banner...');
      const uploadBannerRes = await fetch('/api/upload-banner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: pendingBannerBase64 })
      });
      const bannerResult = await uploadBannerRes.json();
      if (!bannerResult.success) throw new Error(bannerResult.error || 'Failed banner upload');
      pendingBannerBase64 = null; // Reset
    }

    // 3. Save configs
    const response = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ promptpayId, minDonateAmount, verifyMode, easyslipApiKey, streamerName, streamerDescription, viewerAccentColor })
    });
    
    await response.json();
    alert('บันทึกข้อมูลการตั้งค่าเรียบร้อยแล้ว');
    fetchConfig(); // Reload
  } catch (error) {
    console.error('Error saving config:', error);
    alert('เกิดข้อผิดพลาด: ' + error.message);
  } finally {
    btn.disabled = false;
    btn.innerText = 'บันทึกการตั้งค่า';
  }
}

// Save Advanced Overlay Settings config
async function handleAdvConfigSubmit(e) {
  e.preventDefault();

  const btn = document.getElementById('btnSaveAdvConfig');
  btn.disabled = true;
  btn.innerText = 'กำลังบันทึก...';

  const requireApproval = document.getElementById('requireApproval').checked;
  const minAmountTts = parseFloat(document.getElementById('minAmountTts').value) || 1;
  const soundVolume = parseFloat(document.getElementById('soundVolume').value);
  const ttsSpeed = parseFloat(document.getElementById('ttsSpeed').value);
  const overlayAccentColor = document.getElementById('overlayAccentColor').value;
  const overlayTextColor = document.getElementById('overlayTextColor').value;
  const bannedWords = document.getElementById('bannedWords').value.trim();

  try {
    // 1. Upload custom sound file if selected
    if (pendingSoundBase64) {
      console.log('Uploading custom sound chime...');
      const uploadSoundRes = await fetch('/api/upload-sound', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ soundBase64: pendingSoundBase64, filename: pendingSoundFilename })
      });
      const soundResult = await uploadSoundRes.json();
      if (!soundResult.success) throw new Error(soundResult.error || 'Failed sound upload');
      pendingSoundBase64 = null; // Reset
    }

    // 2. Save advanced params
    const response = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        promptpayId: currentConfig.promptpayId, // keep existing PromptPay
        requireApproval, minAmountTts, soundVolume, ttsSpeed, 
        overlayAccentColor, overlayTextColor, bannedWords
      })
    });
    
    await response.json();
    alert('บันทึกสไตล์การ์ดและการกรองระบบข้อความสำเร็จ!');
    fetchConfig(); // Reload
  } catch (error) {
    console.error('Error saving advanced configurations:', error);
    alert('เกิดข้อผิดพลาด: ' + error.message);
  } finally {
    btn.disabled = false;
    btn.innerText = 'บันทึกสไตล์ระบบคัดกรอง';
  }
}

// Save Minimum Donation Amount independently
async function handleMinDonateSubmit(e) {
  e.preventDefault();

  const minDonateAmount = parseFloat(document.getElementById('minDonateAmount').value);
  if (isNaN(minDonateAmount) || minDonateAmount < 1) {
    alert('กรุณาระบุยอดขั้นต่ำที่ถูกต้อง (1 บาทขึ้นไป)');
    return;
  }

  const btn = document.getElementById('btnSaveMinDonate');
  btn.disabled = true;
  btn.innerText = 'กำลังบันทึก...';

  try {
    const response = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        promptpayId: currentConfig.promptpayId || '0000000000',
        minDonateAmount
      })
    });
    const data = await response.json();
    if (data.config) {
      currentConfig = data.config;
      alert(`บันทึกยอดขั้นต่ำ ${minDonateAmount} บาทเรียบร้อยแล้ว! หน้าเว็บผู้ชมจะเห็นยอดใหม่ทันที`);
    } else {
      alert('เกิดข้อผิดพลาดในการบันทึก');
    }
  } catch (err) {
    console.error('Error saving min donate:', err);
    alert('เชื่อมต่อเซิร์ฟเวอร์ล้มเหลว');
  } finally {
    btn.disabled = false;
    btn.innerText = 'บันทึกยอดขั้นต่ำ';
  }
}

// Save Goal configurations
async function handleGoalSubmit(e) {
  e.preventDefault();

  const goalEnabled = document.getElementById('goalEnabled').checked;
  const goalTitle = document.getElementById('goalTitle').value.trim();
  const goalTarget = parseFloat(document.getElementById('goalTarget').value) || 5000;
  const goalCurrent = parseFloat(document.getElementById('goalCurrent').value) || 0;

  const btn = document.getElementById('btnSaveGoal');
  btn.disabled = true;
  btn.innerText = 'กำลังบันทึก...';

  try {
    const response = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        promptpayId: currentConfig.promptpayId, // Keep original
        goalEnabled, goalTitle, goalTarget, goalCurrent
      })
    });

    await response.json();
    alert('บันทึกรายละเอียดของเป้าหมายสนับสนุนเรียบร้อย!');
    fetchConfig(); // Reload
  } catch (error) {
    console.error('Error saving goal config:', error);
    alert('เกิดข้อผิดพลาดการเซฟเป้าหมาย');
  } finally {
    btn.disabled = false;
    btn.innerText = 'บันทึกเป้าหมาย';
  }
}

// Handle manual test alert submission
async function handleTestAlertSubmit(e) {
  e.preventDefault();

  const name = document.getElementById('testName').value.trim();
  const message = document.getElementById('testMessage').value.trim();
  const amount = parseFloat(document.getElementById('testAmount').value);

  await triggerTestAlert(name, message, amount);
}

// Quick presets test triggers helper
window.sendQuickTest = async function(amount) {
  const name = document.getElementById('testName').value.trim() || 'พี่เก่งสายเปย์';
  const message = document.getElementById('testMessage').value.trim() || 'โอนสนับสนุนทดสอบจ้า!';
  await triggerTestAlert(name, message, amount);
};

// REST call to trigger test alert
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

// Render Top Donators to Dashboard Tab Table
function renderTopDonatorsTable(topDonators) {
  const tbody = document.getElementById('topDonatorsList');
  if (!topDonators || topDonators.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="3" style="text-align: center; color: var(--text-muted); padding: 20px;">ไม่มีข้อมูลสถิติ</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = topDonators.map((d, index) => {
    return `
      <tr>
        <td><strong>#${index + 1}</strong></td>
        <td>${escapeHtml(d.name)}</td>
        <td style="text-align: right; color: #00ff87; font-weight: 700;">${d.amount.toFixed(2)} บาท</td>
      </tr>
    `;
  }).join('');
}

// Render normal Table log History Tab
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
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      day: '2-digit', month: '2-digit', year: 'numeric'
    });

    let badgeClass = 'status-pending';
    let badgeText = 'รอชำระ (Pending)';
    if (d.status === 'paid') {
      badgeClass = 'status-paid';
      badgeText = 'สำเร็จ (Paid)';
    } else if (d.status === 'pending_approval') {
      badgeClass = 'status-approval';
      badgeText = 'รอคัดกรอง (Waiting)';
    } else if (d.status === 'rejected') {
      badgeClass = 'status-rejected';
      badgeText = 'ปัดตก (Rejected)';
    }

    const verifyType = d.slipQrData 
      ? 'ตรวจสลิป (EasySlip)' 
      : (d.isTest ? 'โดเนททดสอบ' : (d.verificationMethod || 'โหมดจำลอง'));

    return `
      <tr>
        <td style="color: var(--text-muted); font-size: 13px;">${date}</td>
        <td><strong>${escapeHtml(d.name)}</strong></td>
        <td style="color: #d1cde3; font-style: italic;">"${escapeHtml(d.message || '')}"</td>
        <td style="color: #00ff87; font-weight: 700;">${d.amount.toFixed(2)} บาท</td>
        <td><span class="${badgeClass}">${badgeText}</span></td>
        <td style="color: var(--text-muted); font-size: 13px;">${verifyType}</td>
      </tr>
    `;
  }).join('');
}

// Render Approvals queue list Tab
function renderQueueTable(donations) {
  const tbody = document.getElementById('queueTableBody');
  const pendingApprovals = donations.filter(d => d.status === 'pending_approval');
  
  if (pendingApprovals.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 40px;">
          ไม่มีรายการรอคัดกรองอนุมัติในคิวขณะนี้
        </td>
      </tr>
    `;
    return;
  }

  // Sort oldest first (so they are approved in order of transfer)
  const sorted = [...pendingApprovals].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  tbody.innerHTML = sorted.map(d => {
    const date = new Date(d.createdAt).toLocaleString('th-TH', {
      hour: '2-digit', minute: '2-digit',
      day: '2-digit', month: '2-digit'
    });

    const verifyType = d.slipQrData ? 'ตรวจสลิปธนาคาร' : (d.verificationMethod || 'โหมดจำลอง');

    return `
      <tr>
        <td style="color: var(--text-muted); font-size: 13px;">${date}</td>
        <td><strong>${escapeHtml(d.name)}</strong></td>
        <td style="color: #d1cde3; font-style: italic;">"${escapeHtml(d.message || '')}"</td>
        <td style="color: #00ff87; font-weight: 700;">${d.amount.toFixed(2)} บาท</td>
        <td style="color: var(--text-muted); font-size: 13px;">${verifyType}</td>
        <td>
          <div class="action-buttons">
            <button class="approve-btn" onclick="approveDonation('${d.id}')">อนุมัติออกจอ</button>
            <button class="reject-btn" onclick="rejectDonation('${d.id}')">ปฏิเสธ</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Action: Approve pending donation
window.approveDonation = async function(id) {
  try {
    const response = await fetch('/api/donations/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ donationId: id })
    });
    const data = await response.json();
    if (data.success) {
      refreshAllData(); // Refresh Tables and stats
    } else {
      alert('การอนุมัติล้มเหลว: ' + data.error);
    }
  } catch (error) {
    console.error('Approve error:', error);
    alert('เชื่อมต่อระบบหลังบ้านขัดข้อง');
  }
};

// Action: Reject pending donation
window.rejectDonation = async function(id) {
  if (!confirm('คุณแน่ใจหรือไม่ว่าต้องการคัดกรองข้อความและปัดรายการแจ้งเตือนนี้ทิ้ง?')) return;
  
  try {
    const response = await fetch('/api/donations/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ donationId: id })
    });
    const data = await response.json();
    if (data.success) {
      refreshAllData(); // Refresh Tables
    } else {
      alert('การปัดทิ้งล้มเหลว: ' + data.error);
    }
  } catch (error) {
    console.error('Reject error:', error);
    alert('เชื่อมต่อระบบหลังบ้านขัดข้อง');
  }
};

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
