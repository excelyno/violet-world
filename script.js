/**
 * IanthoSim — script.js
 * Simulasi persepsi visual ianthinopsia (chromatopsia violet)
 *
 * Pipeline per pixel:
 *   RGBA[] -> normalize -> RGB->HSV -> Hue Mapping -> HSV->RGB -> clamp -> RGBA[]
 *
 * Kompleksitas: O(N) dimana N = lebar x tinggi pixel
 */

'use strict';

// ── State ────────────────────────────────────────────────────────────────────

const state = {
  originalImage:  null,   // HTMLImageElement
  originalData:   null,   // ImageData dari gambar asli
  filteredData:   null,   // ImageData hasil filter
  splitX:         0.5,    // posisi divider (0.0 – 1.0)
  dragging:       false,
  processed:      false,
};

// ── DOM References ────────────────────────────────────────────────────────────

const dropZone        = document.getElementById('dropZone');
const fileInput       = document.getElementById('fileInput');
const splitSection    = document.getElementById('splitSection');
const splitWrapper    = document.getElementById('splitWrapper');
const splitDivider    = document.getElementById('splitDivider');
const canvasOriginal  = document.getElementById('canvasOriginal');
const canvasFiltered  = document.getElementById('canvasFiltered');
const controlsSection = document.getElementById('controlsSection');
const previewSection  = document.getElementById('previewSection');
const previewOriginal = document.getElementById('previewOriginal');
const previewFiltered = document.getElementById('previewFiltered');
const btnProcess      = document.getElementById('btnProcess');
const btnDownload     = document.getElementById('btnDownload');
const progressWrap    = document.getElementById('progressWrap');
const progressBar     = document.getElementById('progressBar');
const progressLabel   = document.getElementById('progressLabel');

const sliderStrength  = document.getElementById('sliderStrength');
const sliderSaturation= document.getElementById('sliderSaturation');
const sliderBrightness= document.getElementById('sliderBrightness');
const sliderHue       = document.getElementById('sliderHue');
const valStrength     = document.getElementById('valStrength');
const valSaturation   = document.getElementById('valSaturation');
const valBrightness   = document.getElementById('valBrightness');
const valHue          = document.getElementById('valHue');

// ── Algoritma Inti ────────────────────────────────────────────────────────────

/**
 * RGB -> HSV
 * Input:  r, g, b dalam [0, 1]
 * Output: { h: [0,360), s: [0,1], v: [0,1] }
 */
function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) {
      h = 60 * (((g - b) / delta) % 6);
    } else if (max === g) {
      h = 60 * ((b - r) / delta + 2);
    } else {
      h = 60 * ((r - g) / delta + 4);
    }
  }
  if (h < 0) h += 360;

  const s = max === 0 ? 0 : delta / max;
  const v = max;

  return { h, s, v };
}

/**
 * HSV -> RGB
 * Input:  h [0,360), s [0,1], v [0,1]
 * Output: { r, g, b } dalam [0, 1]
 */
function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let r = 0, g = 0, b = 0;
  if      (h < 60)  { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }

  return { r: r + m, g: g + m, b: b + m };
}

/**
 * Circular Angular Difference (signed, shortest path)
 * Output: [-180, 180]
 */
function angularDiff(from, to) {
  let diff = to - from;
  while (diff >  180) diff -= 360;
  while (diff < -180) diff += 360;
  return diff;
}

/**
 * Hue Mapping — Circular Attraction ke target hue
 *
 * Rumus:
 *   diff    = angularDiff(H, H_target)     // arah & jarak ke target
 *   falloff = (1 - |diff| / 180)^2        // quadratic falloff
 *   H_new   = H + strength * diff * falloff
 *
 * Efek:
 *   - Warna dekat violet: bergeser sedikit (sudah mendekati target)
 *   - Warna jauh (merah/kuning): ditarik kuat tapi falloff melunakkan
 *   - Warna SANGAT jauh (180 derajat berlawanan): falloff mendekati 0,
 *     sehingga masih punya identitas — tidak "terhapus" total
 *   - V (brightness) tidak disentuh -> detail & tekstur terjaga
 */
function mapHue(h, targetHue, strength) {
  const diff    = angularDiff(h, targetHue);
  const absDiff = Math.abs(diff);
  const falloff = Math.pow(1 - absDiff / 180, 2);
  let newH = h + strength * diff * falloff;
  // normalize ke [0, 360)
  newH = ((newH % 360) + 360) % 360;
  return newH;
}

/**
 * Proses satu ImageData: terapkan filter ianthinopsia
 * Gunakan chunked loop + requestAnimationFrame untuk update progress
 * agar UI tidak freeze pada gambar besar.
 */
function applyFilter(imageData, params, onProgress, onDone) {
  const { strength, satMul, briMul, targetHue } = params;
  const data   = imageData.data;
  const total  = data.length / 4;        // jumlah pixel
  const CHUNK  = 20000;                  // pixel per chunk
  let   i      = 0;

  // copy data supaya original tidak dimodifikasi
  const out    = new ImageData(
    new Uint8ClampedArray(data),
    imageData.width,
    imageData.height
  );
  const outD   = out.data;

  function processChunk() {
    const end = Math.min(i + CHUNK, total);
    for (; i < end; i++) {
      const idx = i * 4;
      const r   = outD[idx]     / 255;
      const g   = outD[idx + 1] / 255;
      const b   = outD[idx + 2] / 255;
      // alpha dibiarkan

      let { h, s, v } = rgbToHsv(r, g, b);

      // 1. Hue attraction ke violet
      h = mapHue(h, targetHue, strength);

      // 2. Saturation scale (clamp [0,1])
      s = Math.min(1, Math.max(0, s * satMul));

      // 3. Brightness scale (clamp [0,1])
      v = Math.min(1, Math.max(0, v * briMul));

      const rgb = hsvToRgb(h, s, v);

      outD[idx]     = Math.round(rgb.r * 255);
      outD[idx + 1] = Math.round(rgb.g * 255);
      outD[idx + 2] = Math.round(rgb.b * 255);
    }

    const pct = Math.round((i / total) * 100);
    onProgress(pct);

    if (i < total) {
      requestAnimationFrame(processChunk);
    } else {
      onDone(out);
    }
  }

  requestAnimationFrame(processChunk);
}

// ── Canvas Utilities ──────────────────────────────────────────────────────────

/**
 * Gambar ImageData ke canvas (resize canvas ke dimensi data)
 */
function renderToCanvas(canvas, imageData) {
  canvas.width  = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext('2d').putImageData(imageData, 0, 0);
}

/**
 * Gambar Image ke canvas (fit ke max width)
 */
function renderImageToCanvas(canvas, img, maxW) {
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (maxW && w > maxW) {
    h = Math.round(h * maxW / w);
    w = maxW;
  }
  canvas.width  = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  return canvas.getContext('2d').getImageData(0, 0, w, h);
}

/**
 * Update split view: kanvas original penuh, kanvas filtered di-clip
 */
function updateSplitView() {
  if (!state.filteredData || !state.originalData) return;

  const wrapper = splitWrapper;
  const w = canvasOriginal.width;
  const h = canvasOriginal.height;
  const splitPx = Math.round(state.splitX * w);

  // Render original (full)
  // sudah ter-render saat load gambar

  // Render filtered dengan clip kiri = splitPx
  const ctxF = canvasFiltered.getContext('2d');
  ctxF.clearRect(0, 0, w, h);
  ctxF.save();
  ctxF.beginPath();
  ctxF.rect(0, 0, splitPx, h);
  ctxF.clip();
  ctxF.putImageData(state.filteredData, 0, 0);
  ctxF.restore();

  // Posisikan divider
  // canvas memiliki CSS width=100%, kita perlu scale
  const cssW    = canvasOriginal.getBoundingClientRect().width;
  const scaleX  = cssW / w;
  const divPxCSS = splitPx * scaleX;
  splitDivider.style.left = divPxCSS + 'px';

  // set wrapper height ke tinggi canvas (CSS)
  const cssH = h * scaleX;
  splitWrapper.style.height = cssH + 'px';
}

// ── Image Load ────────────────────────────────────────────────────────────────

function loadImage(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    state.originalImage = img;

    // Render ke split canvases (max 1400px wide)
    const MAX_W = 1400;
    state.originalData = renderImageToCanvas(canvasOriginal, img, MAX_W);

    // canvasFiltered sama dimensi, tapi kosong sampai diproses
    canvasFiltered.width  = canvasOriginal.width;
    canvasFiltered.height = canvasOriginal.height;

    // Render ke small preview
    renderImageToCanvas(previewOriginal, img, 600);

    // Tampilkan UI
    splitSection.classList.remove('hidden');
    controlsSection.classList.remove('hidden');

    state.processed = false;
    btnDownload.classList.add('hidden');

    // auto-process
    processImage();
  };
  img.src = url;
}

// ── Process ───────────────────────────────────────────────────────────────────

function getParams() {
  return {
    strength:  parseFloat(sliderStrength.value),
    satMul:    parseFloat(sliderSaturation.value),
    briMul:    parseFloat(sliderBrightness.value),
    targetHue: parseFloat(sliderHue.value),
  };
}

function processImage() {
  if (!state.originalData) return;

  btnProcess.disabled = true;
  progressWrap.classList.remove('hidden');
  progressBar.style.width = '0%';
  progressLabel.textContent = 'Memproses...';

  const params = getParams();

  applyFilter(
    state.originalData,
    params,
    (pct) => {
      progressBar.style.width = pct + '%';
      progressLabel.textContent = 'Memproses ' + pct + '%';
    },
    (resultData) => {
      state.filteredData = resultData;
      state.processed    = true;

      // Update split view
      canvasFiltered.width  = resultData.width;
      canvasFiltered.height = resultData.height;
      updateSplitView();

      // Update small preview
      renderToCanvas(previewFiltered, resultData);
      previewSection.classList.remove('hidden');

      progressBar.style.width = '100%';
      progressLabel.textContent = 'Selesai!';

      setTimeout(() => {
        progressWrap.classList.add('hidden');
      }, 800);

      btnProcess.disabled = false;
      btnDownload.classList.remove('hidden');
    }
  );
}

// ── Download ──────────────────────────────────────────────────────────────────

function downloadResult() {
  if (!state.filteredData) return;

  // render ke offscreen canvas full resolution
  const offscreen = document.createElement('canvas');
  renderToCanvas(offscreen, state.filteredData);

  const link = document.createElement('a');
  link.download = 'ianthoSim-result.png';
  link.href = offscreen.toDataURL('image/png');
  link.click();
}

// ── Split View Drag ───────────────────────────────────────────────────────────

function getSplitX(clientX) {
  const rect = splitWrapper.getBoundingClientRect();
  return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
}

splitWrapper.addEventListener('mousedown', (e) => {
  state.dragging = true;
  state.splitX = getSplitX(e.clientX);
  updateSplitView();
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!state.dragging) return;
  state.splitX = getSplitX(e.clientX);
  updateSplitView();
});

window.addEventListener('mouseup', () => {
  state.dragging = false;
});

// Touch support
splitWrapper.addEventListener('touchstart', (e) => {
  state.dragging = true;
  state.splitX = getSplitX(e.touches[0].clientX);
  updateSplitView();
  e.preventDefault();
}, { passive: false });

window.addEventListener('touchmove', (e) => {
  if (!state.dragging) return;
  state.splitX = getSplitX(e.touches[0].clientX);
  updateSplitView();
}, { passive: true });

window.addEventListener('touchend', () => {
  state.dragging = false;
});

window.addEventListener('resize', () => {
  updateSplitView();
});

// ── Slider Events ─────────────────────────────────────────────────────────────

sliderStrength.addEventListener('input', () => {
  valStrength.textContent = parseFloat(sliderStrength.value).toFixed(2);
});

sliderSaturation.addEventListener('input', () => {
  valSaturation.textContent = parseFloat(sliderSaturation.value).toFixed(2) + 'x';
});

sliderBrightness.addEventListener('input', () => {
  valBrightness.textContent = parseFloat(sliderBrightness.value).toFixed(2) + 'x';
});

sliderHue.addEventListener('input', () => {
  valHue.textContent = sliderHue.value + ' deg';
});

// ── File Upload ───────────────────────────────────────────────────────────────

fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) loadImage(e.target.files[0]);
});

dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) {
    loadImage(file);
  }
});

// ── Button Events ─────────────────────────────────────────────────────────────

btnProcess.addEventListener('click', processImage);
btnDownload.addEventListener('click', downloadResult);

// ── Init ──────────────────────────────────────────────────────────────────────
// Tidak ada inisialisasi tambahan yang dibutuhkan.
// Semua dimulai saat user upload gambar.