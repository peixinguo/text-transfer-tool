import QRCode from 'qrcode';
import jsQR from 'jsqr';

const PROTOCOL = 'TXTQR1';
const MAX_QR_VERSION = 16;
const CHUNK_ECC_LEVELS = ['M', 'L'];
const SINGLE_ECC_LEVELS = ['M', 'L'];
const AUTO_ADVANCE_MS = 1400;

const state = {
  packets: [],
  packetIndex: 0,
  autoTimer: null,
  stream: null,
  scanTimer: null,
  lastScanValue: '',
  scanSession: null,
};

const els = {
  modeButtons: Array.from(document.querySelectorAll('[data-mode]')),
  panels: Array.from(document.querySelectorAll('[data-panel]')),
  textInput: document.getElementById('text-input'),
  charCount: document.getElementById('char-count'),
  byteCount: document.getElementById('byte-count'),
  generateButton: document.getElementById('generate-button'),
  clearInputButton: document.getElementById('clear-input-button'),
  qrCanvas: document.getElementById('qr-canvas'),
  packetMeta: document.getElementById('packet-meta'),
  packetHint: document.getElementById('packet-hint'),
  prevButton: document.getElementById('prev-button'),
  nextButton: document.getElementById('next-button'),
  autoButton: document.getElementById('auto-button'),
  copyPacketButton: document.getElementById('copy-packet-button'),
  sendSessionInfo: document.getElementById('session-info'),
  receiveSessionInfo: document.getElementById('session-info-receive'),
  resultMeta: document.getElementById('result-meta'),
  resultOutput: document.getElementById('result-output'),
  copyResultButton: document.getElementById('copy-result-button'),
  downloadResultButton: document.getElementById('download-result-button'),
  clearReceiveButton: document.getElementById('clear-receive-button'),
  startCameraButton: document.getElementById('start-camera-button'),
  stopCameraButton: document.getElementById('stop-camera-button'),
  imageInput: document.getElementById('image-input'),
  imageDecodeButton: document.getElementById('image-decode-button'),
  cameraStatus: document.getElementById('camera-status'),
  video: document.getElementById('camera-video'),
  captureCanvas: document.getElementById('capture-canvas'),
  toast: document.getElementById('toast'),
};

function setActiveMode(mode) {
  els.modeButtons.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.mode === mode);
  });
  els.panels.forEach((panel) => {
    panel.hidden = panel.dataset.panel !== mode;
  });
}

function updateInputMetrics() {
  const text = els.textInput.value;
  const bytes = new TextEncoder().encode(text).length;
  els.charCount.textContent = String(text.length);
  els.byteCount.textContent = String(bytes);
}

function toBase64Url(bytes) {
  let binary = '';
  const chunkSize = 32768;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const binary = atob(normalized + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function createTransferId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

function parsePacket(raw) {
  const parts = raw.split('|');
  if (parts.length !== 5 || parts[0] !== PROTOCOL) {
    return null;
  }
  const index = Number.parseInt(parts[2], 10);
  const total = Number.parseInt(parts[3], 10);
  if (!Number.isInteger(index) || !Number.isInteger(total) || index < 1 || total < 1 || index > total) {
    return null;
  }
  return {
    protocol: parts[0],
    transferId: parts[1],
    index,
    total,
    payload: parts[4],
  };
}

function estimateHeaderLength(transferId, total) {
  const digits = String(total).length;
  return `${PROTOCOL}|${transferId}|${'9'.repeat(digits)}|${'9'.repeat(digits)}|`.length;
}

function tryCreateQr(value, level) {
  try {
    const qr = QRCode.create(value, { errorCorrectionLevel: level, margin: 1 });
    return qr.version <= MAX_QR_VERSION ? qr : null;
  } catch (error) {
    return null;
  }
}

function splitIntoPackets(text) {
  const trimmed = text;
  for (const level of SINGLE_ECC_LEVELS) {
    const qr = tryCreateQr(trimmed, level);
    if (qr) {
      return {
        mode: 'single',
        ecc: level,
        packets: [{ text: trimmed, index: 1, total: 1, qr, ecc: level }],
      };
    }
  }

  const transferId = createTransferId();
  const encoded = toBase64Url(new TextEncoder().encode(trimmed));

  for (const level of CHUNK_ECC_LEVELS) {
    let total = 1;
    let chunkSize = 0;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      let low = 1;
      let high = encoded.length;
      let best = 0;

      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const probe = `${PROTOCOL}|${transferId}|${total}|${total}|${encoded.slice(0, mid)}`;
        if (tryCreateQr(probe, level)) {
          best = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }

      if (!best) {
        break;
      }

      chunkSize = best;
      const nextTotal = Math.ceil(encoded.length / chunkSize);
      if (nextTotal === total) {
        break;
      }
      total = nextTotal;
    }

    if (!chunkSize) {
      continue;
    }

    total = Math.ceil(encoded.length / chunkSize);
    const packets = [];
    let valid = true;

    for (let index = 1; index <= total; index += 1) {
      const start = (index - 1) * chunkSize;
      const payload = encoded.slice(start, start + chunkSize);
      const content = `${PROTOCOL}|${transferId}|${index}|${total}|${payload}`;
      const qr = tryCreateQr(content, level);
      if (!qr) {
        valid = false;
        break;
      }
      packets.push({ text: content, index, total, qr, ecc: level });
    }

    if (valid) {
      return {
        mode: 'chunked',
        ecc: level,
        packets,
      };
    }
  }

  throw new Error('文本过长，超出当前二维码分片上限。');
}

async function renderPacket(index) {
  const packet = state.packets[index];
  if (!packet) {
    return;
  }
  state.packetIndex = index;
  await QRCode.toCanvas(els.qrCanvas, packet.text, {
    errorCorrectionLevel: packet.ecc || 'M',
    margin: 1,
    width: 360,
    color: {
      dark: '#0b141f',
      light: '#f5f1e8',
    },
  });

  const isSingle = state.packets.length === 1 && !parsePacket(packet.text);
  els.packetMeta.textContent = isSingle
    ? '单码直传 · 系统相机可直接识别文本'
    : `分片 ${packet.index} / ${packet.total}`;
  els.packetHint.textContent = isSingle
    ? '短文本模式：手机扫这一张就能直接看到内容。'
    : '长文本模式：手机在接收页连续扫码，收齐后自动拼接。';
  els.prevButton.disabled = index === 0;
  els.nextButton.disabled = index === state.packets.length - 1;
  els.copyPacketButton.disabled = false;
}

function stopAutoAdvance() {
  if (state.autoTimer) {
    window.clearInterval(state.autoTimer);
    state.autoTimer = null;
    els.autoButton.textContent = '自动轮播';
  }
}

function startAutoAdvance() {
  stopAutoAdvance();
  if (state.packets.length < 2) {
    return;
  }
  state.autoTimer = window.setInterval(() => {
    const next = (state.packetIndex + 1) % state.packets.length;
    renderPacket(next);
  }, AUTO_ADVANCE_MS);
  els.autoButton.textContent = '停止轮播';
}

function setToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('is-visible');
  window.clearTimeout(setToast.timer);
  setToast.timer = window.setTimeout(() => {
    els.toast.classList.remove('is-visible');
  }, 2200);
}

async function copyText(value, successMessage) {
  await navigator.clipboard.writeText(value);
  setToast(successMessage);
}

function updateSendUi() {
  const hasPackets = state.packets.length > 0;
  els.packetMeta.textContent = hasPackets ? els.packetMeta.textContent : '等待生成';
  els.packetHint.textContent = hasPackets ? els.packetHint.textContent : '文本会自动判断走单码或分片模式。';
  els.prevButton.disabled = !hasPackets || state.packetIndex === 0;
  els.nextButton.disabled = !hasPackets || state.packetIndex === state.packets.length - 1;
  els.autoButton.disabled = state.packets.length < 2;
  els.copyPacketButton.disabled = !hasPackets;
}

async function handleGenerate() {
  const text = els.textInput.value;
  if (!text.trim()) {
    setToast('先输入要传输的文本。');
    return;
  }

  stopAutoAdvance();

  try {
    const result = splitIntoPackets(text);
    state.packets = result.packets;
    state.packetIndex = 0;
    await renderPacket(0);
    els.sendSessionInfo.textContent = result.mode === 'single'
      ? `已生成 1 张二维码 · 纠错 ${result.ecc}`
      : `已生成 ${result.packets.length} 张二维码 · 纠错 ${result.ecc}`;
    updateSendUi();
    setToast(result.mode === 'single' ? '已生成单码。' : `已生成 ${result.packets.length} 个分片。`);
  } catch (error) {
    console.error(error);
    state.packets = [];
    updateSendUi();
    setToast(error.message || '生成失败，请缩短文本后重试。');
  }
}

function resetReceiveState() {
  state.scanSession = null;
  state.lastScanValue = '';
  els.resultOutput.value = '';
  els.resultMeta.textContent = '暂无接收结果';
  els.receiveSessionInfo.textContent = '等待扫码';
}

function updateSessionUi() {
  const session = state.scanSession;
  if (!session) {
    els.receiveSessionInfo.textContent = '等待扫码';
    return;
  }
  const received = session.parts.filter(Boolean).length;
  els.receiveSessionInfo.textContent = `会话 ${session.transferId} · 已收 ${received}/${session.total}`;
}

function tryAssembleSession() {
  const session = state.scanSession;
  if (!session) {
    return;
  }
  if (session.parts.some((part) => !part)) {
    return;
  }
  const joined = session.parts.join('');
  const decoded = new TextDecoder().decode(fromBase64Url(joined));
  els.resultOutput.value = decoded;
  els.resultMeta.textContent = `已完成拼接 · ${decoded.length} 字符 · ${new TextEncoder().encode(decoded).length} 字节`;
  setToast('已收齐全部分片。');
}

function consumeDecodedText(raw) {
  if (!raw || raw === state.lastScanValue) {
    return;
  }
  state.lastScanValue = raw;
  window.setTimeout(() => {
    if (state.lastScanValue === raw) {
      state.lastScanValue = '';
    }
  }, 1200);

  const packet = parsePacket(raw);
  if (!packet) {
    els.resultOutput.value = raw;
    els.resultMeta.textContent = `单码文本 · ${raw.length} 字符 · ${new TextEncoder().encode(raw).length} 字节`;
    els.receiveSessionInfo.textContent = '已收到单码文本';
    setToast('收到单码文本。');
    return;
  }

  if (!state.scanSession || state.scanSession.transferId !== packet.transferId) {
    state.scanSession = {
      transferId: packet.transferId,
      total: packet.total,
      parts: new Array(packet.total).fill(''),
    };
  }

  if (state.scanSession.total !== packet.total) {
    state.scanSession = {
      transferId: packet.transferId,
      total: packet.total,
      parts: new Array(packet.total).fill(''),
    };
  }

  state.scanSession.parts[packet.index - 1] = packet.payload;
  updateSessionUi();
  tryAssembleSession();
}

async function decodeBitmapWithNative(bitmapSource) {
  if (!('BarcodeDetector' in window)) {
    return null;
  }
  const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
  const result = await detector.detect(bitmapSource);
  return result[0]?.rawValue || null;
}

function decodeImageDataWithJsQr(imageData) {
  const code = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'attemptBoth',
  });
  return code?.data || null;
}

async function decodeFromCanvas(canvas) {
  try {
    const nativeValue = await decodeBitmapWithNative(canvas);
    if (nativeValue) {
      return nativeValue;
    }
  } catch (error) {
    console.warn('BarcodeDetector decode failed', error);
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return decodeImageDataWithJsQr(imageData);
}

async function scanVideoFrame() {
  const { video, captureCanvas } = els;
  if (!video.videoWidth || !video.videoHeight) {
    return;
  }
  const ctx = captureCanvas.getContext('2d', { willReadFrequently: true });
  captureCanvas.width = video.videoWidth;
  captureCanvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
  const value = await decodeFromCanvas(captureCanvas);
  if (value) {
    consumeDecodedText(value);
  }
}

async function startCamera() {
  if (state.stream) {
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    state.stream = stream;
    els.video.srcObject = stream;
    await els.video.play();
    els.cameraStatus.textContent = '摄像头已启动，接收页会自动识别二维码。';
    els.stopCameraButton.disabled = false;
    els.startCameraButton.disabled = true;
    state.scanTimer = window.setInterval(() => {
      scanVideoFrame();
    }, 280);
  } catch (error) {
    console.error(error);
    els.cameraStatus.textContent = '无法打开摄像头，请检查浏览器权限，或改用图片识别。';
  }
}

function stopCamera() {
  if (state.scanTimer) {
    window.clearInterval(state.scanTimer);
    state.scanTimer = null;
  }
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }
  els.video.srcObject = null;
  els.cameraStatus.textContent = '摄像头未启动';
  els.stopCameraButton.disabled = true;
  els.startCameraButton.disabled = false;
}

async function decodeImageFile() {
  const [file] = els.imageInput.files || [];
  if (!file) {
    setToast('先选择一张二维码图片。');
    return;
  }
  const bitmap = await createImageBitmap(file);
  const canvas = els.captureCanvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  ctx.drawImage(bitmap, 0, 0);
  const value = await decodeFromCanvas(canvas);
  if (!value) {
    setToast('这张图片里没有识别到二维码。');
    return;
  }
  consumeDecodedText(value);
  setToast('图片识别完成。');
}

function downloadResult() {
  const text = els.resultOutput.value;
  if (!text) {
    setToast('当前没有可导出的文本。');
    return;
  }
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'received-text.txt';
  link.click();
  URL.revokeObjectURL(url);
}

function bindEvents() {
  els.modeButtons.forEach((button) => {
    button.addEventListener('click', () => setActiveMode(button.dataset.mode));
  });

  els.textInput.addEventListener('input', updateInputMetrics);
  els.generateButton.addEventListener('click', handleGenerate);
  els.clearInputButton.addEventListener('click', () => {
    els.textInput.value = '';
    updateInputMetrics();
    state.packets = [];
    state.packetIndex = 0;
    stopAutoAdvance();
    const ctx = els.qrCanvas.getContext('2d');
    ctx.clearRect(0, 0, els.qrCanvas.width, els.qrCanvas.height);
    updateSendUi();
    els.sendSessionInfo.textContent = '等待生成';
  });

  els.prevButton.addEventListener('click', () => {
    if (state.packetIndex > 0) {
      renderPacket(state.packetIndex - 1);
    }
  });
  els.nextButton.addEventListener('click', () => {
    if (state.packetIndex < state.packets.length - 1) {
      renderPacket(state.packetIndex + 1);
    }
  });
  els.autoButton.addEventListener('click', () => {
    if (state.autoTimer) {
      stopAutoAdvance();
    } else {
      startAutoAdvance();
    }
  });
  els.copyPacketButton.addEventListener('click', async () => {
    const packet = state.packets[state.packetIndex];
    if (!packet) {
      return;
    }
    await copyText(packet.text, '当前二维码内容已复制。');
  });

  els.startCameraButton.addEventListener('click', startCamera);
  els.stopCameraButton.addEventListener('click', stopCamera);
  els.imageDecodeButton.addEventListener('click', decodeImageFile);
  els.clearReceiveButton.addEventListener('click', resetReceiveState);
  els.copyResultButton.addEventListener('click', async () => {
    if (!els.resultOutput.value) {
      setToast('当前没有可复制的文本。');
      return;
    }
    await copyText(els.resultOutput.value, '结果已复制。');
  });
  els.downloadResultButton.addEventListener('click', downloadResult);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopAutoAdvance();
    }
  });
}

function init() {
  bindEvents();
  updateInputMetrics();
  updateSendUi();
  resetReceiveState();
  setActiveMode('send');
}

init();
