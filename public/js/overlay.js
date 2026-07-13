let socket;
const alertQueue = [];
let isAlertActive = false;
let audioUnlocked = false;
let config = {}; // Loaded dynamically from server

// Audio context variable
let audioCtx = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initSocket();
  fetchConfig();
});

// Init socket client
function initSocket() {
  socket = io();
  
  socket.on('connect', () => {
    console.log('Overlay connected to WebSocket');
  });

  socket.on('donation-alert', (data) => {
    console.log('Received donation alert:', data);
    alertQueue.push(data);
    if (!isAlertActive) {
      processNextAlert();
    }
  });
}

// Fetch current configurations (volume, speed, colors, sounds)
async function fetchConfig() {
  try {
    const response = await fetch('/api/config');
    config = await response.json();
    applyCustomStyles();
  } catch (error) {
    console.error('Error fetching overlay config:', error);
  }
}

// Inject custom CSS styling overrides dynamically
function applyCustomStyles() {
  const accent = config.overlayAccentColor || '#ff007f';
  const textColor = config.overlayTextColor || '#ffffff';

  let styleEl = document.getElementById('custom-overlay-styles');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'custom-overlay-styles';
    document.head.appendChild(styleEl);
  }

  styleEl.innerHTML = `
    .alert-title {
      color: ${accent} !important;
      text-shadow: 0 0 8px ${accent}66 !important;
    }
    .progress-bar {
      background: linear-gradient(90deg, #8a2be2, ${accent}) !important;
    }
    .donor-name {
      color: ${textColor} !important;
    }
    .donation-card-active {
      border-color: ${accent}44 !important;
      box-shadow: 0 15px 35px ${accent}1a, 0 10px 25px rgba(0,0,0,0.4) !important;
    }
    .card-glow {
      background: radial-gradient(circle, rgba(138, 43, 226, 0.12) 0%, ${accent}0d 50%, transparent 70%) !important;
    }
  `;
}

// Unlock audio helper for OBS
function unlockAudio() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();
    
    // Play quick silent buffer to unlock browser audio context
    const buffer = audioCtx.createBuffer(1, 1, 22050);
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.start(0);
    
    audioUnlocked = true;
    
    // Hide activator
    document.getElementById('audio-activator').style.display = 'none';
    console.log('Audio unlocked successfully');
  } catch (e) {
    console.error('Failed to unlock audio context', e);
  }
}

// Play notification sound (custom upload or fallback synthesized chime)
function playAlertSound() {
  const volume = config.soundVolume !== undefined ? Number(config.soundVolume) : 0.8;
  
  if (config.alertSoundFile) {
    console.log('[Overlay] Playing custom alert sound:', config.alertSoundFile);
    const url = `/${config.alertSoundFile}?t=${Date.now()}`; // cache buster
    const audio = new Audio(url);
    audio.volume = volume;
    audio.play().catch(err => {
      console.error('[Overlay] Custom sound playback failed, falling back to chime:', err);
      playChime(volume);
    });
  } else {
    playChime(volume);
  }
}

// Play synthesizer chime using Web Audio API
function playChime(volume) {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) audioCtx = new AudioContext();
  }
  
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  
  const now = audioCtx.currentTime;
  
  const playNode = (freq, startTime, duration) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startTime);
    
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(0.35 * volume, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.start(startTime);
    osc.stop(startTime + duration);
  };
  
  playNode(587.33, now, 0.8);        // D5
  playNode(783.99, now + 0.1, 1.0);  // G5
  playNode(987.77, now + 0.2, 1.2);  // B5
  playNode(1174.66, now + 0.3, 1.5); // D6
}

// Check if string contains Thai characters
function hasThai(text) {
  return /[\u0e00-\u0e7f]/.test(text);
}

// Process the queue
function processNextAlert() {
  if (alertQueue.length === 0) {
    isAlertActive = false;
    return;
  }

  isAlertActive = true;
  const alert = alertQueue.shift();
  
  // Reload configurations on each alert to ensure color/volume updates apply in real-time
  fetchConfig().then(() => {
    document.getElementById('donor-name').innerText = alert.name;
    document.getElementById('donor-amount').innerText = alert.amount.toFixed(2) + ' THB';
    
    const msgEl = document.getElementById('donor-message');
    if (alert.message) {
      msgEl.style.display = 'block';
      msgEl.innerText = `"${alert.message}"`;
    } else {
      msgEl.style.display = 'none';
    }

    // Play chime sound
    playAlertSound();
    
    // Show Card
    const card = document.getElementById('donation-card');
    card.className = 'donation-card-active';
    
    // Reset and animate progress bar
    const progressBar = document.getElementById('progress-bar');
    progressBar.style.transition = 'none';
    progressBar.style.width = '100%';
    progressBar.offsetHeight; // Force reflow

    // Speak and wait for it to complete
    speakAlert(alert, () => {
      const hideTimeout = 2500;
      
      progressBar.style.transition = `width ${hideTimeout}ms linear`;
      progressBar.style.width = '0%';
      
      setTimeout(() => {
        // Slide Out
        card.classList.add('slide-out');
        
        setTimeout(() => {
          card.className = 'donation-card-hidden';
          processNextAlert();
        }, 500);
        
      }, hideTimeout);
    });
  });
}

// Play speech alert sequentially using HTML5 Audio via proxy
function speakAlert(alert, callback) {
  // TTS Threshold check
  const minAmount = config.minAmountTts !== undefined ? Number(config.minAmountTts) : 1;
  if (alert.amount < minAmount) {
    console.log(`[TTS] Amount ${alert.amount} THB is below threshold (${minAmount} THB). Skipping speech.`);
    callback();
    return;
  }

  const introText = `คุณ ${alert.name} ส่งสนับสนุน จำนวน ${Math.floor(alert.amount)} บาท`;
  const introUrl = `/api/tts?lang=th&text=${encodeURIComponent(introText)}`;
  
  console.log('[TTS] Playing intro:', introText);
  const audioIntro = new Audio(introUrl);
  
  // Set volume and speed
  const volume = config.soundVolume !== undefined ? Number(config.soundVolume) : 0.8;
  const speed = config.ttsSpeed !== undefined ? Number(config.ttsSpeed) : 1.0;
  
  audioIntro.volume = volume;
  audioIntro.playbackRate = speed;
  
  // Safety timeout in case speech engine gets stuck (25 seconds limit)
  let safetyTimeout = setTimeout(() => {
    console.warn('[TTS] Safety timeout triggered');
    audioIntro.pause();
    callback();
  }, 25000);

  audioIntro.onended = () => {
    // If there is a message, play it next
    if (alert.message) {
      setTimeout(() => {
        const lang = hasThai(alert.message) ? 'th' : 'en';
        const msgUrl = `/api/tts?lang=${lang}&text=${encodeURIComponent(alert.message)}`;
        console.log('[TTS] Playing message:', alert.message);
        
        const audioMsg = new Audio(msgUrl);
        audioMsg.volume = volume;
        audioMsg.playbackRate = speed;

        audioMsg.onended = () => {
          clearTimeout(safetyTimeout);
          callback();
        };
        audioMsg.onerror = (e) => {
          console.error('[TTS] Message playback error:', e);
          clearTimeout(safetyTimeout);
          callback();
        };
        audioMsg.play().catch(err => {
          console.error('[TTS] Message play failed:', err);
          clearTimeout(safetyTimeout);
          callback();
        });
      }, 350); // Small natural delay between intro and message
    } else {
      // No message, wrap up
      clearTimeout(safetyTimeout);
      callback();
    }
  };
  
  audioIntro.onerror = (e) => {
    console.error('[TTS] Intro playback error:', e);
    clearTimeout(safetyTimeout);
    callback();
  };
  
  // Play the intro speech
  audioIntro.play().catch(err => {
    console.error('[TTS] Intro play failed (unlocked check needed):', err);
    clearTimeout(safetyTimeout);
    callback();
  });
}
