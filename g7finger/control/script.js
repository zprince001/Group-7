
const video = document.getElementById('video');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const errorTextEl = document.getElementById('errorText');
const camPlaceholder = document.getElementById('camPlaceholder');
const camWidget = document.getElementById('camWidget');
const camToggle = document.getElementById('camToggle');

const gestureToast = document.getElementById('gestureToast');
const gestureToastEmoji = document.getElementById('gestureToastEmoji');
const gestureToastLabel = document.getElementById('gestureToastLabel');

const sectionTrack = document.getElementById('sectionTrack');
const sections = Array.from(document.querySelectorAll('.page-section'));
const pageDots = Array.from(document.querySelectorAll('.page-dot'));

const galleryImg = document.getElementById('galleryImg');
const galleryCaption = document.getElementById('galleryCaption');
const photoDotsEl = document.getElementById('photoDots');
const photoPrevBtn = document.getElementById('photoPrev');
const photoNextBtn = document.getElementById('photoNext');


let hands = null;
let camera = null;
let streamStarted = false;

let currentSection = 0;
let focusIndex = 0;

let currentGesture = null;
let gestureHoldFrames = 0;
let gestureHideTimer = null;
const GESTURE_HOLD_THRESHOLD = 4;

let lastActionKey = null;
let actionCooldownUntil = 0;
const ACTION_COOLDOWN_MS = 850;


const PHOTOS = [
  { src: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1200&q=80', caption: 'Mountain ridge at sunrise' },
  { src: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1200&q=80', caption: 'Forest trail in fog' },
  { src: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&q=80', caption: 'Desert dunes at dusk' },
  { src: 'https://images.unsplash.com/photo-1500534623283-312aade485b7?w=1200&q=80', caption: 'Ocean cliffs at golden hour' },
];
let photoIndex = 0;


function getFocusableEls(sectionIndex) {
  const sec = sections[sectionIndex];
  return Array.from(sec.querySelectorAll('.focusable'));
}

function clearFocusHighlight() {
  document.querySelectorAll('.focusable.gesture-focused').forEach((el) => el.classList.remove('gesture-focused'));
}

function applyFocusHighlight() {
  clearFocusHighlight();
  const items = getFocusableEls(currentSection);
  if (!items.length) return;
  focusIndex = ((focusIndex % items.length) + items.length) % items.length;
  items[focusIndex].classList.add('gesture-focused');
  items[focusIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function goToSection(index) {
  const clamped = Math.max(0, Math.min(sections.length - 1, index));
  if (clamped === currentSection) return;

  const goingForward = clamped > currentSection;
  sections[currentSection].classList.remove('active');
  sections[currentSection].classList.toggle('exit-left', goingForward);

  currentSection = clamped;
  focusIndex = 0;

  sections.forEach((s, i) => {
    if (i === currentSection) {
      s.classList.remove('exit-left');
      
      void s.offsetWidth;
      s.classList.add('active');
    } else if (i !== (goingForward ? currentSection - 1 : currentSection + 1)) {
      s.classList.remove('active', 'exit-left');
    }
  });

  pageDots.forEach((d, i) => d.classList.toggle('active', i === currentSection));
  applyFocusHighlight();
}

pageDots.forEach((dot) => {
  dot.addEventListener('click', () => goToSection(Number(dot.dataset.section)));
});


document.querySelectorAll('[data-action]').forEach((el) => {
  el.addEventListener('click', (e) => {
    const action = el.dataset.action;
    if (action === 'goto-gallery') { e.preventDefault(); goToSection(1); }
    if (action === 'goto-contact') { e.preventDefault(); goToSection(3); }
    if (action === 'goto-home') { e.preventDefault(); goToSection(0); }
  });
});


function renderPhoto() {
  const p = PHOTOS[photoIndex];
  galleryImg.src = p.src;
  galleryImg.alt = p.caption;
  galleryCaption.textContent = p.caption;
  photoDotsEl.innerHTML = '';
  PHOTOS.forEach((_, i) => {
    const dot = document.createElement('span');
    if (i === photoIndex) dot.classList.add('active');
    photoDotsEl.appendChild(dot);
  });
}
function nextPhoto() { photoIndex = (photoIndex + 1) % PHOTOS.length; renderPhoto(); }
function prevPhoto() { photoIndex = (photoIndex - 1 + PHOTOS.length) % PHOTOS.length; renderPhoto(); }
photoNextBtn.addEventListener('click', nextPhoto);
photoPrevBtn.addEventListener('click', prevPhoto);
renderPhoto();


camToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  camWidget.classList.toggle('collapsed');
});
document.querySelector('.cam-widget-head').addEventListener('click', () => {
  camWidget.classList.toggle('collapsed');
});


function showToast(gesture) {
  gestureToastEmoji.textContent = gesture.emoji;
  gestureToastLabel.textContent = gesture.label;
  gestureToast.classList.remove('hidden');
  gestureToast.classList.remove('pop');
  void gestureToast.offsetWidth;
  gestureToast.classList.add('pop');
  clearTimeout(gestureHideTimer);
  gestureHideTimer = setTimeout(() => gestureToast.classList.add('hidden'), 1400);
}


function isFingerUp(landmarks, tipIndex, pipIndex) {
  return landmarks[tipIndex].y < landmarks[pipIndex].y;
}
function isThumbUp(landmarks, label) {
  const thumbTipX = landmarks[4].x;
  const thumbIpX = landmarks[3].x;
  return label === 'Right' ? thumbTipX < thumbIpX : thumbTipX > thumbIpX;
}
function fingerStates(landmarks, label) {
  return {
    thumb: isThumbUp(landmarks, label),
    index: isFingerUp(landmarks, 8, 6),
    middle: isFingerUp(landmarks, 12, 10),
    ring: isFingerUp(landmarks, 16, 14),
    pinky: isFingerUp(landmarks, 20, 18),
  };
}

function detectGesture(landmarks, label) {
  const f = fingerStates(landmarks, label);
  const up = [f.thumb, f.index, f.middle, f.ring, f.pinky].filter(Boolean).length;

  if (f.thumb && f.index && f.pinky && !f.middle && !f.ring) {
    return { key: 'love', emoji: '🤟', label: 'Previous Section' };
  }
  if (f.index && f.middle && !f.ring && !f.pinky) {
    return { key: 'peace', emoji: '✌️', label: 'Next Photo' };
  }
  if (f.thumb && f.pinky && !f.index && !f.middle && !f.ring) {
    return { key: 'callme', emoji: '🤙', label: 'Next Section' };
  }
  if (f.index && !f.thumb && !f.middle && !f.ring && !f.pinky) {
    return { key: 'point', emoji: '☝️', label: 'Move Focus' };
  }
  if (f.thumb && !f.index && !f.middle && !f.ring && !f.pinky) {
    return { key: 'thumbsup', emoji: '👍', label: 'Select' };
  }
  if (up === 0) {
    return { key: 'fist', emoji: '✊', label: 'Previous Photo' };
  }
  return null;
}


function applyGestureAction(gesture) {
  const now = performance.now();
  if (!gesture) return;
  if (gesture.key === lastActionKey && now < actionCooldownUntil) return;

  const onGallery = currentSection === 1;

  switch (gesture.key) {
    case 'callme': 
      goToSection(currentSection + 1);
      break;
    case 'love': 
      goToSection(currentSection - 1);
      break;
    case 'point': { 
      const items = getFocusableEls(currentSection);
      if (items.length) {
        focusIndex = (focusIndex + 1) % items.length;
        applyFocusHighlight();
      }
      break;
    }
    case 'thumbsup': { 
      const items = getFocusableEls(currentSection);
      if (items.length) {
        const el = items[focusIndex];
        el.classList.remove('gesture-clicked');
        void el.offsetWidth;
        el.classList.add('gesture-clicked');
        el.click();
      }
      break;
    }
    case 'peace': 
      if (onGallery) nextPhoto();
      break;
    case 'fist': 
      if (onGallery) prevPhoto();
      break;
    default:
      return;
  }

  lastActionKey = gesture.key;
  actionCooldownUntil = now + ACTION_COOLDOWN_MS;
}


function resizeCanvas() {
  const w = video.videoWidth || video.clientWidth || 320;
  const h = video.videoHeight || video.clientHeight || 240;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function onResults(results) {
  resizeCanvas();
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

  const multi = results.multiHandLandmarks || [];
  const labels = results.multiHandedness || [];
  let detected = null;
  let lowConfidence = false;

  for (let i = 0; i < multi.length; i++) {
    const landmarks = multi[i];
    const label = labels[i]?.label || 'Right';
    const score = labels[i]?.score ?? 1;
    if (score < 0.6) lowConfidence = true;

    if (!detected) detected = detectGesture(landmarks, label);

    drawConnectors(ctx, landmarks, HAND_CONNECTIONS, { color: '#7dd3fc', lineWidth: 3 });
    drawLandmarks(ctx, landmarks, { color: '#ffffff', fillColor: '#7c5cff', radius: 3, lineWidth: 1 });
  }

  if (detected && !lowConfidence) {
    if (detected.key === currentGesture) {
      gestureHoldFrames++;
    } else {
      currentGesture = detected.key;
      gestureHoldFrames = 1;
    }
    if (gestureHoldFrames === GESTURE_HOLD_THRESHOLD) {
      showToast(detected);
      applyGestureAction(detected);
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
    throw new Error('MediaPipe failed to load. Check your connection and reload.');
  }
  hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });
  hands.onResults(onResults);
}

async function startCamera() {
  try {
    errorTextEl.textContent = '';
    if (!window.isSecureContext) throw new Error('Needs HTTPS or localhost.');
    await ensureHands();

    camera = new Camera(video, {
      onFrame: async () => { await hands.send({ image: video }); },
      width: 320,
      height: 240,
    });
    await camera.start();

    streamStarted = true;
    camPlaceholder.classList.add('hidden');
    camWidget.classList.add('camera-on');
    startBtn.disabled = true;
    stopBtn.disabled = false;
  } catch (err) {
    console.error(err);
    errorTextEl.textContent = err?.message || 'Failed to start camera.';
  }
}

function stopCamera() {
  try {
    const tracks = video.srcObject?.getTracks?.() || [];
    tracks.forEach((t) => t.stop());
    video.srcObject = null;
  } catch {}

  streamStarted = false;
  ctx.clearRect(0, 0, canvas.width || 1, canvas.height || 1);
  camPlaceholder.classList.remove('hidden');
  camWidget.classList.remove('camera-on');
  startBtn.disabled = false;
  stopBtn.disabled = true;
  currentGesture = null;
  gestureHoldFrames = 0;
  lastActionKey = null;
  actionCooldownUntil = 0;
  clearTimeout(gestureHideTimer);
  gestureToast.classList.add('hidden');
}

startBtn.addEventListener('click', startCamera);
stopBtn.addEventListener('click', stopCamera);
window.addEventListener('resize', resizeCanvas);


sections[0].classList.add('active');
applyFocusHighlight();
