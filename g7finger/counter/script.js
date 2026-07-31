const video = document.getElementById('video');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const fingerCountEl = document.getElementById('fingerCount');
const handsCountEl = document.getElementById('handsCount');
const statusTextEl = document.getElementById('statusText');
const errorTextEl = document.getElementById('errorText');
const cameraPlaceholder = document.getElementById('cameraPlaceholder');
const gestureBanner = document.getElementById('gestureBanner');
const gestureEmojiEl = document.getElementById('gestureEmoji');
const gestureLabelEl = document.getElementById('gestureLabel');

let hands = null;
let camera = null;
let streamStarted = false;
let currentGesture = null;
let gestureHoldFrames = 0;
let gestureHideTimer = null;
const GESTURE_HOLD_THRESHOLD = 4; // frames a gesture must persist before it "pops"

function setStatus(text) { statusTextEl.textContent = text; }
function setError(text = '') { errorTextEl.textContent = text; }

function resizeCanvas() {
  const w = video.videoWidth || video.clientWidth || 640;
  const h = video.videoHeight || video.clientHeight || 480;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function isFingerUp(landmarks, tipIndex, pipIndex) {
  return landmarks[tipIndex].y < landmarks[pipIndex].y;
}

function isThumbUp(landmarks, label) {
  const thumbTipX = landmarks[4].x;
  const thumbIpX = landmarks[3].x;
  return label === 'Right' ? thumbTipX < thumbIpX : thumbTipX > thumbIpX;
}

function countRaisedFingers(landmarks, label) {
  let count = 0;
  if (isThumbUp(landmarks, label)) count++;
  if (isFingerUp(landmarks, 8, 6)) count++;
  if (isFingerUp(landmarks, 12, 10)) count++;
  if (isFingerUp(landmarks, 16, 14)) count++;
  if (isFingerUp(landmarks, 20, 18)) count++;
  return count;
}

// ---------- Gesture recognition ----------
// Each finger's "up" state, reused across gesture checks.
function fingerStates(landmarks, label) {
  return {
    thumb: isThumbUp(landmarks, label),
    index: isFingerUp(landmarks, 8, 6),
    middle: isFingerUp(landmarks, 12, 10),
    ring: isFingerUp(landmarks, 16, 14),
    pinky: isFingerUp(landmarks, 20, 18),
  };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// One-hand gestures, checked in priority order (most specific first).
function detectSingleHandGesture(landmarks, label) {
  const f = fingerStates(landmarks, label);
  const up = [f.thumb, f.index, f.middle, f.ring, f.pinky].filter(Boolean).length;

  // I Love You (ASL): thumb + index + pinky up, middle + ring down
  if (f.thumb && f.index && f.pinky && !f.middle && !f.ring) {
    return { key: 'love', emoji: '🤟', label: 'I Love You!' };
  }

  // Peace / Victory: index + middle up, ring + pinky down, thumb tucked or out
  if (f.index && f.middle && !f.ring && !f.pinky) {
    return { key: 'peace', emoji: '✌️', label: 'Peace!' };
  }

  // Call Me / Shaka: thumb + pinky up, others down
  if (f.thumb && f.pinky && !f.index && !f.middle && !f.ring) {
    return { key: 'callme', emoji: '🤙', label: 'Call Me!' };
  }

  // OK sign: thumb tip close to index tip, other three fingers up
  const thumbIndexDist = dist(landmarks[4], landmarks[8]);
  if (thumbIndexDist < 0.055 && f.middle && f.ring && f.pinky) {
    return { key: 'ok', emoji: '👌', label: 'OK!' };
  }

  // Rock on / Horns: index + pinky up, middle + ring down, thumb down
  if (!f.thumb && f.index && f.pinky && !f.middle && !f.ring) {
    return { key: 'rock', emoji: '🤘', label: 'Rock On!' };
  }

  // Pointing: only index up
  if (f.index && !f.thumb && !f.middle && !f.ring && !f.pinky) {
    return { key: 'point', emoji: '☝️', label: 'Pointing' };
  }

  // Thumbs up: only thumb up, hand roughly upright
  if (f.thumb && !f.index && !f.middle && !f.ring && !f.pinky) {
    return { key: 'thumbsup', emoji: '👍', label: 'Thumbs Up!' };
  }

  // Fist: nothing up
  if (up === 0) {
    return { key: 'fist', emoji: '✊', label: 'Fist' };
  }

  // Open palm / high five: everything up
  if (up === 5) {
    return { key: 'palm', emoji: '🖐️', label: 'High Five!' };
  }

  return null;
}

// Two-hand gestures, checked across both hands together.
function detectTwoHandGesture(handsData) {
  if (handsData.length < 2) return null;
  const [a, b] = handsData;

  // Heart / Love: both index tips close together AND both thumb tips close together,
  // forming the classic finger-heart shape, with the other fingers curled down.
  const indexClose = dist(a.landmarks[8], b.landmarks[8]) < 0.09;
  const thumbsClose = dist(a.landmarks[4], b.landmarks[4]) < 0.09;
  const aCurled = !a.states.middle && !a.states.ring && !a.states.pinky;
  const bCurled = !b.states.middle && !b.states.ring && !b.states.pinky;

  if (indexClose && thumbsClose && aCurled && bCurled) {
    return { key: 'heart', emoji: '❤️', label: 'Love You!' };
  }

  // Big heart: both hands open palm, wrists close together (arms forming a heart above head, roughly)
  const wristsClose = dist(a.landmarks[0], b.landmarks[0]) < 0.22;
  const aOpen = a.states.thumb && a.states.index && a.states.middle && a.states.ring && a.states.pinky;
  const bOpen = b.states.thumb && b.states.index && b.states.middle && b.states.ring && b.states.pinky;
  if (wristsClose && aOpen && bOpen) {
    return { key: 'bighug', emoji: '🤗', label: 'Sending Love!' };
  }

  return null;
}

function showGesture(gesture) {
  gestureEmojiEl.textContent = gesture.emoji;
  gestureLabelEl.textContent = gesture.label;
  gestureBanner.classList.remove('hidden');
  gestureBanner.classList.remove('pop');
  // Force reflow so the pop animation replays even for the same gesture repeating.
  void gestureBanner.offsetWidth;
  gestureBanner.classList.add('pop');

  clearTimeout(gestureHideTimer);
  gestureHideTimer = setTimeout(() => {
    gestureBanner.classList.add('hidden');
    currentGesture = null;
  }, 1800);
}

function onResults(results) {
  resizeCanvas();
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

  let total = 0;
  const multi = results.multiHandLandmarks || [];
  const labels = results.multiHandedness || [];
  const handsData = [];
  let lowConfidence = false;

  for (let i = 0; i < multi.length; i++) {
    const landmarks = multi[i];
    const label = labels[i]?.label || 'Right';
    const score = labels[i]?.score ?? 1;
    if (score < 0.6) lowConfidence = true;

    total += countRaisedFingers(landmarks, label);
    handsData.push({ landmarks, label, states: fingerStates(landmarks, label) });

    drawConnectors(ctx, landmarks, HAND_CONNECTIONS, { color: '#7dd3fc', lineWidth: 4 });
    drawLandmarks(ctx, landmarks, { color: '#ffffff', fillColor: '#7c5cff', radius: 4, lineWidth: 1 });
  }

  fingerCountEl.textContent = String(total);
  handsCountEl.textContent = String(multi.length);
  setStatus(multi.length ? 'Tracking' : (streamStarted ? 'Searching' : 'Ready'));

  // Prefer a two-hand gesture (like the finger-heart) if present, otherwise check each hand.
  let detected = detectTwoHandGesture(handsData);
  if (!detected) {
    for (const hd of handsData) {
      detected = detectSingleHandGesture(hd.landmarks, hd.label);
      if (detected) break;
    }
  }

  // Skip acting on low-confidence detections (e.g. hand partly out of frame) so the
  // popup doesn't flicker between gestures on a shaky read.
  if (detected && !lowConfidence) {
    if (detected.key === currentGesture) {
      gestureHoldFrames++;
    } else {
      currentGesture = detected.key;
      gestureHoldFrames = 1;
    }
    if (gestureHoldFrames === GESTURE_HOLD_THRESHOLD) {
      showGesture(detected);
    }
  } else if (!lowConfidence) {
    currentGesture = null;
    gestureHoldFrames = 0;
  }

  ctx.restore();
}

async function ensureHands() {
  if (hands) return;
  if (typeof Hands === 'undefined' || typeof Camera === 'undefined') {
    throw new Error('MediaPipe files did not load. Check internet connection and reload the page.');
  }

  hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });

  hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.55,
    minTrackingConfidence: 0.55,
  });

  hands.onResults(onResults);
}

async function startCamera() {
  try {
    setError('');
    setStatus('Starting');

    if (!window.isSecureContext) {
      throw new Error('Camera needs localhost or HTTPS.');
    }

    await ensureHands();

    camera = new Camera(video, {
      onFrame: async () => {
        await hands.send({ image: video });
      },
      width: 640,
      height: 480,
    });

    await camera.start();
    streamStarted = true;
    cameraPlaceholder.classList.add('hidden');
    startBtn.disabled = true;
    stopBtn.disabled = false;
    setStatus('Camera started');
  } catch (err) {
    console.error(err);
    setStatus('Error');
    setError(err?.message || 'Failed to start camera.');
  }
}

function stopCamera() {
  try {
    const tracks = video.srcObject?.getTracks?.() || [];
    tracks.forEach((track) => track.stop());
    video.srcObject = null;
  } catch {}

  streamStarted = false;
  ctx.clearRect(0, 0, canvas.width || 1, canvas.height || 1);
  fingerCountEl.textContent = '0';
  handsCountEl.textContent = '0';
  cameraPlaceholder.classList.remove('hidden');
  startBtn.disabled = false;
  stopBtn.disabled = true;
  setStatus('Stopped');
  setError('');
  clearTimeout(gestureHideTimer);
  currentGesture = null;
  gestureHoldFrames = 0;
  gestureBanner.classList.add('hidden');
  gestureBanner.classList.remove('pop');
}

startBtn.addEventListener('click', startCamera);
stopBtn.addEventListener('click', stopCamera);
window.addEventListener('resize', resizeCanvas);
setStatus('Ready');
