let socket;

document.addEventListener('DOMContentLoaded', () => {
  initSocket();
  fetchInitialGoal();
});

// Get target username from path
function getTargetUsername() {
  const pathParts = window.location.pathname.split('/').filter(p => p.length > 0);
  return pathParts[0] || 'admin';
}

// Connect to Socket.io
function initSocket() {
  socket = io();

  socket.on('connect', () => {
    console.log('Goal widget connected to WebSocket');
    socket.emit('join-room', getTargetUsername());
  });

  // Listen for real-time goal progress updates
  socket.on('goal-update', (data) => {
    console.log('Goal updated:', data);
    updateGoalUI(data);
  });
}

// Fetch initial goal data on startup
async function fetchInitialGoal() {
  try {
    const targetUsername = getTargetUsername();
    const response = await fetch(`/api/config?username=${targetUsername}&t=${Date.now()}`);
    const config = await response.json();
    
    updateGoalUI({
      title: config.goalTitle,
      target: config.goalTarget,
      current: config.goalCurrent,
      enabled: config.goalEnabled
    });
  } catch (error) {
    console.error('Failed to fetch initial goal config:', error);
  }
}

// Update the Widget interface
function updateGoalUI(data) {
  const container = document.getElementById('goalWidget');
  
  if (!data.enabled) {
    container.style.display = 'none'; // Hide if goal is disabled
    return;
  }
  
  container.style.display = 'block';

  // Set titles and values
  document.getElementById('goalTitle').innerText = data.title || 'เป้าหมายสนับสนุน';
  document.getElementById('goalNumbers').innerText = `${data.current.toFixed(2)} / ${data.target.toFixed(2)} THB`;

  // Calculate percentage
  let percent = 0;
  if (data.target > 0) {
    percent = (data.current / data.target) * 100;
  }
  
  // Cap percentage at 100% (or let it expand if desired, but 100% looks clean for styling)
  const displayPercent = Math.min(Math.round(percent), 100);
  const actualPercent = Math.round(percent);

  // Set styles and transitions
  const fill = document.getElementById('goalBarFill');
  const percentText = document.getElementById('goalPercentText');

  fill.style.width = `${displayPercent}%`;
  percentText.innerText = `${actualPercent}%`;
  
  // Apply a dynamic background glow if target is exceeded
  if (actualPercent >= 100) {
    fill.style.boxShadow = '0 0 25px rgba(0, 255, 135, 0.8)';
    fill.style.background = 'linear-gradient(90deg, #00ff87 0%, #60efff 100%)';
  } else {
    fill.style.boxShadow = '0 0 15px rgba(255, 0, 127, 0.6)';
    fill.style.background = 'linear-gradient(90deg, #8a2be2 0%, #ff007f 100%)';
  }
}
