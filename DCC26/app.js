const canvas = document.getElementById("replayCanvas");
const ctx = canvas.getContext("2d");

const sessionInput = document.getElementById("sessionFile");
const imageInput = document.getElementById("imageFolder");
const playButton = document.getElementById("playButton");
const pauseButton = document.getElementById("pauseButton");
const resetButton = document.getElementById("resetButton");
const viewMode = document.getElementById("viewMode");
const statusText = document.getElementById("statusText");

let events = [];
let images = new Map();

let currentIndex = 0;
let playing = false;
let timer = null;

let currentImage = null;
let currentAffect = null;

const WIDTH = 1512;
const HEIGHT = 982;
const RADIUS = 25;

let heatmaps = {};

function resetHeatmaps() {
  heatmaps = {
    heatmap: new Float32Array(WIDTH * HEIGHT),
    focus: new Float32Array(WIDTH * HEIGHT),
    engagement: new Float32Array(WIDTH * HEIGHT),
    excitement: new Float32Array(WIDTH * HEIGHT),
    interest: new Float32Array(WIDTH * HEIGHT),
    relaxation: new Float32Array(WIDTH * HEIGHT),
    stress: new Float32Array(WIDTH * HEIGHT)
  };
}

resetHeatmaps();

sessionInput.addEventListener("change", loadSessionFile);
imageInput.addEventListener("change", loadImageFolder);
playButton.addEventListener("click", play);
pauseButton.addEventListener("click", pause);
resetButton.addEventListener("click", resetReplay);
viewMode.addEventListener("change", draw);

async function loadSessionFile(event) {
  const file = event.target.files[0];

  if (!file) {
    return;
  }

  const text = await file.text();

  events = text
    .split(/\r?\n/)
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line));

  events.sort((a, b) => a.time - b.time);

  currentIndex = 0;
  currentImage = null;
  currentAffect = null;

  resetHeatmaps();
  chooseInitialImage();

  statusText.textContent =
    `Loaded ${events.length} session events.`;

  draw();
}

function loadImageFolder(event) {
  images.clear();

  for (const file of event.target.files) {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => draw();
    img.src = url;

    images.set(file.name, img);
  }

  chooseInitialImage();

  statusText.textContent =
    `Loaded ${images.size} images.`;

  draw();
}

function chooseInitialImage() {
  if (currentImage !== null || images.size === 0) {
    return;
  }

  const stimulusEvent = events.find(event =>
    event.type === "stimulus" &&
    images.has(event.filename)
  );

  if (stimulusEvent) {
    currentImage = images.get(stimulusEvent.filename);
    return;
  }

  if (images.has("Slide1.png")) {
    currentImage = images.get("Slide1.png");
    return;
  }

  currentImage = images.values().next().value || null;
}

function play() {
  if (events.length === 0) {
    statusText.textContent = "Load a session file first.";
    return;
  }

  chooseInitialImage();

  playing = true;
  scheduleNext();
}

function pause() {
  playing = false;

  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

function resetReplay() {
  pause();

  currentIndex = 0;
  currentImage = null;
  currentAffect = null;

  resetHeatmaps();
  chooseInitialImage();
  draw();
}

function scheduleNext() {
  if (!playing) {
    return;
  }

  if (currentIndex >= events.length) {
    pause();
    statusText.textContent = "Replay finished.";
    return;
  }

  const currentEvent = events[currentIndex];
  const previousEvent =
    currentIndex > 0 ? events[currentIndex - 1] : currentEvent;

  const delaySeconds =
    Math.max(0, currentEvent.time - previousEvent.time);

  timer = setTimeout(() => {
    processEvent(currentEvent);
    currentIndex++;
    scheduleNext();
  }, delaySeconds * 1000);
}

function processEvent(event) {
  if (event.type === "stimulus") {
    currentImage = images.get(event.filename) || currentImage;
    currentAffect = null;
    resetHeatmaps();
  }

  if (event.type === "affect") {
    currentAffect = event;
  }

  if (event.type === "gaze") {
    addGaze(event);
  }

  draw();
}

function addGaze(event) {
  addBlob("heatmap", event.x, event.y, 1.0, true);

  if (!currentAffect) {
    return;
  }

  addBlob("focus", event.x, event.y, currentAffect.focus, false);
  addBlob("engagement", event.x, event.y, currentAffect.engagement, false);
  addBlob("excitement", event.x, event.y, currentAffect.excitement, false);
  addBlob("interest", event.x, event.y, currentAffect.interest, false);
  addBlob("relaxation", event.x, event.y, currentAffect.relaxation, false);
  addBlob("stress", event.x, event.y, currentAffect.stress, false);
}

function addBlob(mode, gx, gy, weight, accumulate) {
  const map = heatmaps[mode];

  if (!map) {
    return;
  }

  weight = Math.max(0, Math.min(1, weight));

  if (weight <= 0) {
    return;
  }

  const centerX = Math.floor(gx * WIDTH);
  const centerY = Math.floor(gy * HEIGHT);

  for (let dx = -RADIUS; dx <= RADIUS; dx++) {
    for (let dy = -RADIUS; dy <= RADIUS; dy++) {
      const x = centerX + dx;
      const y = centerY + dy;

      if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) {
        continue;
      }

      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance > RADIUS) {
        continue;
      }

      const spatialWeight = 1.0 - distance / RADIUS;
      const value = spatialWeight * weight;
      const index = y * WIDTH + x;

      if (accumulate) {
        map[index] += value;
      } else {
        map[index] = Math.max(map[index], value);
      }
    }
  }
}

function draw() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  if (currentImage) {
    ctx.drawImage(currentImage, 0, 0, WIDTH, HEIGHT);
  }

  drawHeatmap(viewMode.value);
}

function drawHeatmap(mode) {
  const map = heatmaps[mode];

  if (!map) {
    return;
  }

  let max = 0;

  for (const value of map) {
    if (value > max) {
      max = value;
    }
  }

  if (max <= 0) {
    return;
  }

  const imageData = ctx.createImageData(WIDTH, HEIGHT);

  for (let i = 0; i < map.length; i++) {
    let normalized = map[i] / max;

    if (!Number.isFinite(normalized)) {
      normalized = 0;
    }

    const color = getHeatColor(normalized);
    const p = i * 4;

    imageData.data[p] = color.r;
    imageData.data[p + 1] = color.g;
    imageData.data[p + 2] = color.b;
    imageData.data[p + 3] = color.a;
  }

  const overlayCanvas = document.createElement("canvas");
  overlayCanvas.width = WIDTH;
  overlayCanvas.height = HEIGHT;

  const overlayContext = overlayCanvas.getContext("2d");
  overlayContext.putImageData(imageData, 0, 0);

  ctx.drawImage(overlayCanvas, 0, 0);
}

function getHeatColor(value) {
  if (value <= 0) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  value = Math.sqrt(Math.max(0, Math.min(1, value)));

  let r;
  let g;
  let b;

  if (value < 0.33) {
    const ratio = value / 0.33;
    r = 0;
    g = Math.floor(255 * ratio);
    b = 255;
  } else if (value < 0.66) {
    const ratio = (value - 0.33) / 0.33;
    r = Math.floor(255 * ratio);
    g = 255;
    b = Math.floor(255 * (1 - ratio));
  } else {
    const ratio = (value - 0.66) / 0.34;
    r = 255;
    g = Math.floor(255 * (1 - ratio));
    b = 0;
  }

  return { r, g, b, a: 150 };
}
