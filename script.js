/**
 * IanthoSim — script.js
 * Simulasi persepsi visual ianthinopsia (chromatopsia violet) & Dekode Invers Restorasi Warna
 *
 * Pipeline per pixel:
 *   Mode ENCODE (Simulasi):  RGBA -> normalize -> RGB->HSV -> Hue Attraction -> HSV->RGB -> RGBA
 *   Mode DECODE (Restorasi): RGBA -> normalize -> RGB->HSV -> Hue Expansion -> HSV->RGB -> RGBA
 *
 * Kompleksitas: O(N) dimana N = lebar x tinggi pixel
 */

'use strict';

// ── State ────────────────────────────────────────────────────────────────────

const state = {
  originalImage:            null,   // HTMLImageElement
  originalData:             null,   // ImageData dari gambar input
  filteredData:             null,   // ImageData hasil pemrosesan
  offscreenFilteredCanvas:  null,   // Canvas tersembunyi untuk perbandingan split-view
  splitX:                   0.5,    // posisi divider split view (0.0 – 1.0)
  dragging:                 false,
  processed:                false,
  mode:                     'encode', // 'encode' (simulasi) | 'decode' (restorasi/invers)
};

// ── DOM References ────────────────────────────────────────────────────────────

const btnModeEncode         = document.getElementById('btnModeEncode');
const btnModeDecode         = document.getElementById('btnModeDecode');
const modeDescription       = document.getElementById('modeDescription');

const dropZone              = document.getElementById('dropZone');
const fileInput             = document.getElementById('fileInput');
const dropTitle             = document.getElementById('dropTitle');
const lblUpload             = document.getElementById('lblUpload');

const splitSection          = document.getElementById('splitSection');
const splitWrapper          = document.getElementById('splitWrapper');
const splitDivider          = document.getElementById('splitDivider');
const splitLabelLeft        = document.getElementById('splitLabelLeft');
const splitLabelRight       = document.getElementById('splitLabelRight');

const canvasOriginal        = document.getElementById('canvasOriginal');
const canvasFiltered        = document.getElementById('canvasFiltered');

const controlsSection       = document.getElementById('controlsSection');
const lblStrengthTitle      = document.getElementById('lblStrengthTitle');
const lblSaturationTitle    = document.getElementById('lblSaturationTitle');
const lblBrightnessTitle    = document.getElementById('lblBrightnessTitle');
const lblHueTitle           = document.getElementById('lblHueTitle');
const hintStrength          = document.getElementById('hintStrength');
const hintSaturation        = document.getElementById('hintSaturation');
const hintBrightness        = document.getElementById('hintBrightness');
const hintHue               = document.getElementById('hintHue');

const previewSection        = document.getElementById('previewSection');
const previewOriginal       = document.getElementById('previewOriginal');
const previewFiltered       = document.getElementById('previewFiltered');
const previewTitleLeft      = document.getElementById('previewTitleLeft');
const previewTitleRight     = document.getElementById('previewTitleRight');

const btnProcess            = document.getElementById('btnProcess');
const txtBtnProcess         = document.getElementById('txtBtnProcess');
const btnUseAsDecodeInput   = document.getElementById('btnUseAsDecodeInput');
const btnDownload           = document.getElementById('btnDownload');

const progressWrap          = document.getElementById('progressWrap');
const progressBar           = document.getElementById('progressBar');
const progressLabel         = document.getElementById('progressLabel');

const sliderStrength        = document.getElementById('sliderStrength');
const sliderSaturation      = document.getElementById('sliderSaturation');
const sliderBrightness      = document.getElementById('sliderBrightness');
const sliderHue             = document.getElementById('sliderHue');
const valStrength           = document.getElementById('valStrength');
const valSaturation         = document.getElementById('valSaturation');
const valBrightness         = document.getElementById('valBrightness');
const valHue                = document.getElementById('valHue');

// ── Algoritma Inti (Warna & Matematika Invers) ────────────────────────────────

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
 * Hue Mapping Forward (Mode Encode / Simulasi)
 * Menarik Hue dari warna asli menuju target violet.
 * Blend factor: strength * 0.75 (memberikan kompresi yang dapat di-invers secara presisi)
 */
function mapHueForward(h, targetHue, strength) {
  const diff = angularDiff(h, targetHue);
  const blend = strength * 0.75;
  let newH = h + blend * diff;
  return ((newH % 360) + 360) % 360;
}

/**
 * Hue Mapping Inverse (Mode Decode / Restorasi)
 * Menguraikan (Merekonstruksi) Hue terkompresi dari violet kembali ke warna asal.
 *
 * Persamaan Invers Eksak:
 *   diffToTarget = angularDiff(targetHue, h_input)  // h_input - targetHue
 *   originalDiff = diffToTarget / (1 - blend)
 *   h_restored   = targetHue + originalDiff
 */
function mapHueInverse(h, targetHue, strength) {
  const blend = Math.min(0.90, strength * 0.75);
  const factor = 1 - blend;
  if (factor <= 0.001) return h;

  const diffToTarget = angularDiff(targetHue, h); // h - targetHue
  let restoredH = targetHue + (diffToTarget / factor);
  return ((restoredH % 360) + 360) % 360;
}

/**
 * Terapkan filter (Encode atau Decode) pada ImageData
 */
function applyFilter(imageData, params, mode, onProgress, onDone) {
  const { strength, satMul, briMul, targetHue } = params;
  const data   = imageData.data;
  const total  = data.length / 4;
  const CHUNK  = 25000;
  let   i      = 0;

  const out  = new ImageData(
    new Uint8ClampedArray(data),
    imageData.width,
    imageData.height
  );
  const outD = out.data;

  function processChunk() {
    const end = Math.min(i + CHUNK, total);
    for (; i < end; i++) {
      const idx = i * 4;
      const r   = outD[idx]     / 255;
      const g   = outD[idx + 1] / 255;
      const b   = outD[idx + 2] / 255;

      let { h, s, v } = rgbToHsv(r, g, b);

      if (mode === 'encode') {
        // ENCODE: Kompresi Hue ke Violet
        h = mapHueForward(h, targetHue, strength);
        s = Math.min(1, Math.max(0, s * satMul));
        v = Math.min(1, Math.max(0, v * briMul));
      } else {
        // DECODE: Rekonstruksi Hue Asli
        h = mapHueInverse(h, targetHue, strength);
        s = Math.min(1, Math.max(0, s / (satMul || 1)));
        v = Math.min(1, Math.max(0, v / (briMul || 1)));
      }

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

function renderToCanvas(canvas, imageData) {
  canvas.width  = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext('2d').putImageData(imageData, 0, 0);
}

function renderImageToCanvas(canvas, img, maxW) {
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (maxW && w > maxW) {
    h = Math.round(h * maxW / w);
    w = maxW;
  }
  canvas.width  = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/**
 * Perbaikan Split View: Menggunakan Offscreen Canvas agar ctx.clip() bekerja nyata
 */
function updateSplitView() {
  if (!state.filteredData || !state.originalData) return;

  const w = canvasOriginal.width;
  const h = canvasOriginal.height;
  const splitPx = Math.round(state.splitX * w);

  // 1. Render data original ke kanvas latar belakang (canvasOriginal)
  renderToCanvas(canvasOriginal, state.originalData);

  // 2. Siapkan canvas tersembunyi (offscreen) untuk menampung filteredData
  if (!state.offscreenFilteredCanvas) {
    state.offscreenFilteredCanvas = document.createElement('canvas');
  }
  state.offscreenFilteredCanvas.width = w;
  state.offscreenFilteredCanvas.height = h;
  const offCtx = state.offscreenFilteredCanvas.getContext('2d');
  offCtx.putImageData(state.filteredData, 0, 0);

  // 3. Render canvasFiltered dengan clip area kanan saja dari divider (splitPx)
  const ctxF = canvasFiltered.getContext('2d');
  ctxF.clearRect(0, 0, w, h);
  ctxF.save();
  ctxF.beginPath();
  ctxF.rect(splitPx, 0, w - splitPx, h);
  ctxF.clip();
  ctxF.drawImage(state.offscreenFilteredCanvas, 0, 0);
  ctxF.restore();

  // 4. Posisikan divider garis perbandingan
  const cssW    = canvasOriginal.getBoundingClientRect().width;
  const scaleX  = cssW / w;
  const divPxCSS = splitPx * scaleX;
  splitDivider.style.left = divPxCSS + 'px';

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

    const MAX_W = 1400;
    state.originalData = renderImageToCanvas(canvasOriginal, img, MAX_W);

    canvasFiltered.width  = canvasOriginal.width;
    canvasFiltered.height = canvasOriginal.height;

    renderImageToCanvas(previewOriginal, img, 600);

    splitSection.classList.remove('hidden');
    controlsSection.classList.remove('hidden');

    state.processed = false;
    btnDownload.classList.add('hidden');
    btnUseAsDecodeInput.classList.add('hidden');

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
    state.mode,
    (pct) => {
      progressBar.style.width = pct + '%';
      progressLabel.textContent = 'Memproses ' + pct + '%';
    },
    (resultData) => {
      state.filteredData = resultData;
      state.processed    = true;

      canvasFiltered.width  = resultData.width;
      canvasFiltered.height = resultData.height;
      updateSplitView();

      renderToCanvas(previewFiltered, resultData);
      previewSection.classList.remove('hidden');

      progressBar.style.width = '100%';
      progressLabel.textContent = 'Selesai!';

      setTimeout(() => {
        progressWrap.classList.add('hidden');
      }, 800);

      btnProcess.disabled = false;
      btnDownload.classList.remove('hidden');

      if (state.mode === 'encode') {
        btnUseAsDecodeInput.classList.remove('hidden');
      } else {
        btnUseAsDecodeInput.classList.add('hidden');
      }
    }
  );
}

// ── Mode Switcher & Dynamic UI ────────────────────────────────────────────────

function setMode(newMode) {
  if (state.mode === newMode) return;
  state.mode = newMode;

  if (newMode === 'encode') {
    btnModeEncode.classList.add('active');
    btnModeDecode.classList.remove('active');

    modeDescription.innerHTML = '<strong>Mode Encode (Simulasi):</strong> Mengubah gambar normal menjadi dominan violet (simulasi penglihatan ianthinopsia).';
    dropTitle.textContent = 'Drag & drop gambar normal di sini';
    lblUpload.textContent = 'Pilih Gambar Normal';

    splitLabelLeft.textContent  = 'Original (Input)';
    splitLabelRight.textContent = 'Simulasi Ianthinopsia (Hasil)';

    previewTitleLeft.textContent  = 'Original (Input)';
    previewTitleRight.textContent = 'IanthoSim — Ianthinopsia';

    lblStrengthTitle.textContent  = 'Filter Strength';
    hintStrength.textContent      = 'Seberapa kuat hue ditarik ke violet';

    txtBtnProcess.textContent     = 'Proses Simulasi';
  } else {
    btnModeDecode.classList.add('active');
    btnModeEncode.classList.remove('active');

    modeDescription.innerHTML = '<strong>Mode Decode (Restorasi):</strong> Menguraikan warna dari gambar violet kembali ke warna spektrum aslinya.';
    dropTitle.textContent = 'Drag & drop gambar hasil simulasi (violet) di sini';
    lblUpload.textContent = 'Pilih Gambar Violet (Hasil Simulasi)';

    splitLabelLeft.textContent  = 'Input Violet (Hasil Simulasi)';
    splitLabelRight.textContent = 'Hasil Dekode (Restorasi Warna Asli)';

    previewTitleLeft.textContent  = 'Input Violet (Gambar Terolah)';
    previewTitleRight.textContent = 'Hasil Restorasi Warna (Dekode)';

    lblStrengthTitle.textContent  = 'Un-pull Strength';
    hintStrength.textContent      = 'Kekuatan menguraikan / mengembalikan ekspansi hue';

    txtBtnProcess.textContent     = 'Dekode / Pulihkan Warna';
  }

  if (state.originalData) {
    processImage();
  }
}

// Transfer hasil Encode sebagai input Decode
function useResultAsDecodeInput() {
  if (!state.filteredData) return;

  // Salin filteredData ke originalData
  const copy = new ImageData(
    new Uint8ClampedArray(state.filteredData.data),
    state.filteredData.width,
    state.filteredData.height
  );

  state.originalData = copy;

  // Render ke preview original
  renderToCanvas(previewOriginal, copy);
  renderToCanvas(canvasOriginal, copy);

  // Switch ke Decode mode
  setMode('decode');
}

// ── Download ──────────────────────────────────────────────────────────────────

function downloadResult() {
  if (!state.filteredData) return;

  const offscreen = document.createElement('canvas');
  renderToCanvas(offscreen, state.filteredData);

  const prefix = state.mode === 'encode' ? 'ianthoSim-simulated' : 'ianthoSim-restored';
  const link = document.createElement('a');
  link.download = `${prefix}.png`;
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

// ── Button & Mode Events ──────────────────────────────────────────────────────

btnModeEncode.addEventListener('click', () => setMode('encode'));
btnModeDecode.addEventListener('click', () => setMode('decode'));
btnUseAsDecodeInput.addEventListener('click', useResultAsDecodeInput);

btnProcess.addEventListener('click', processImage);
btnDownload.addEventListener('click', downloadResult);

// ── Init ──────────────────────────────────────────────────────────────────────
// Init mode tampilan awal
setMode('encode');