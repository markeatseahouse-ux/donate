let socket;
const alertQueue = [];
let isAlertActive = false;
let audioUnlocked = false;

// Audio context variable
let audioCtx = null;

// Speech voices
let voiceTh = null;
let voiceEn = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initSocket();
  initVoices();
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

// Unlock audio helper for OBS
function unlockAudio() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();
    
    const buffer = audioCtx.createBuffer(1, 1, 22050);
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.start(0);
    
    audioUnlocked = true;
    
    const u = new SpeechSynthesisUtterance('');
    window.speechSynthesis.speak(u);
    
    document.getElementById('audio-activator').style.display = 'none';
    console.log('Audio unlocked successfully');
  } catch (e) {
    console.error('Failed to unlock audio context', e);
  }
}

// Setup Speech voices
function initVoices() {
  const loadVoices = () => {
    const voices = window.speechSynthesis.getVoices();
    
    // Find Thai voice (usually Pattara, Premwadee, or Google th-TH)
    voiceTh = voices.find(v => v.lang.startsWith('th') || v.name.includes('Thai') || v.name.includes('Pattara') || v.name.includes('Premwadee'));
    
    // Find English voice
    voiceEn = voices.find(v => v.lang.startsWith('en') || v.name.includes('English') || v.name.includes('Google US English'));
    
    // Fallbacks
    if (!voiceTh && voices.length > 0) {
      // Check if any voice is Thai
      const thVoice = voices.find(v => v.lang.toLowerCase().includes('th'));
      if (thVoice) voiceTh = thVoice;
    }
    if (!voiceEn && voices.length > 0) voiceEn = voices.find(v => v.lang.startsWith('en')) || voices[0];
    
    console.log('TTS Voices initialized - TH:', voiceTh?.name, 'EN:', voiceEn?.name);
  };
  
  loadVoices();
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }
}

// Play synthesizer chime using Web Audio API
function playChime() {
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
    gain.gain.linearRampToValueAtTime(0.35, startTime + 0.02);
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
  
  document.getElementById('donor-name').innerText = alert.name;
  document.getElementById('donor-amount').innerText = alert.amount.toFixed(2) + ' THB';
  
  const msgEl = document.getElementById('donor-message');
  if (alert.message) {
    msgEl.style.display = 'block';
    msgEl.innerText = `"${alert.message}"`;
  } else {
    msgEl.style.display = 'none';
  }

  // Trigger Sound
  playChime();
  
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
}

// Text-to-Speech playback engine with Google Translate TTS fallback
function speakText(text, lang, callback) {
  const synth = window.speechSynthesis;
  
  // Check if we should use Google Translate TTS online fallback for Thai
  // If voiceTh is missing, or is not a real Thai voice, we fall back to Google Translate Audio Stream!
  const isThaiVoiceAvailable = voiceTh && voiceTh.lang.toLowerCase().includes('th');
  
  if (lang === 'th' && !isThaiVoiceAvailable) {
    console.log('[TTS] No local Thai speech engine found. Using Google Translate TTS Online Fallback Proxy.');
    const url = `/api/tts?lang=th&text=${encodeURIComponent(text)}`;
    const audio = new Audio(url);
    
    audio.onended = () => callback();
    audio.onerror = (e) => {
      console.error('[TTS] Google Translate fallback audio failed:', e);
      callback(); // Continue to next queue item
    };
    
    audio.play().catch(err => {
      console.error('[TTS] Audio playback failed (possibly blocked by browser autoplay rules):', err);
      callback();
    });
    return;
  }
  
  // Standard Web Speech API Synthesis
  if (!synth) {
    console.warn('[TTS] Web Speech API not supported in this browser');
    callback();
    return;
  }
  
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = lang === 'th' ? voiceTh : voiceEn;
  utterance.rate = lang === 'th' ? 1.0 : 0.95;
  utterance.pitch = lang === 'th' ? 1.05 : 1.0;
  
  utterance.onend = () => callback();
  utterance.onerror = (e) => {
    console.error('[TTS] Web Speech Synthesis error:', e);
    callback();
  };
  
  synth.speak(utterance);
}

// Speak the alert name + amount + message
function speakAlert(alert, callback) {
  const synth = window.speechSynthesis;
  if (synth) {
    synth.cancel(); // Clear any hung speech
  }
  
  const introText = `คุณ ${alert.name} ส่งสนับสนุน จำนวน ${Math.floor(alert.amount)} บาท`;
  
  // Safety timeout in case speech engine gets stuck
  let safetyTimeout = setTimeout(() => {
    console.warn('[TTS] Safety timeout triggered');
    if (synth) synth.cancel();
    callback();
  }, 20000); // 20 seconds maximum per alert

  // 1. Speak Intro (in Thai)
  speakText(introText, 'th', () => {
    // 2. Speak Message if present
    if (alert.message) {
      setTimeout(() => {
        const msgLang = hasThai(alert.message) ? 'th' : 'en';
        speakText(alert.message, msgLang, () => {
          clearTimeout(safetyTimeout);
          callback();
        });
      }, 300);
    } else {
      clearTimeout(safetyTimeout);
      callback();
    }
  });
}
