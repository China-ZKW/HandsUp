const api = window.classroomAPI;

const elements = {
  settingsButton: document.querySelector('#settingsButton'),
  providerBadge: document.querySelector('#providerBadge'),
  settingsDialog: document.querySelector('#settingsDialog'),
  settingsForm: document.querySelector('#settingsForm'),
  closeSettingsButton: document.querySelector('#closeSettingsButton'),
  providerInput: document.querySelector('#providerInput'),
  apiKeyLabel: document.querySelector('#apiKeyLabel'),
  apiKeyInput: document.querySelector('#apiKeyInput'),
  apiKeyHint: document.querySelector('#apiKeyHint'),
  modelInput: document.querySelector('#modelInput'),
  modelHint: document.querySelector('#modelHint'),
  alwaysOnTopInput: document.querySelector('#alwaysOnTopInput'),
  clearKeyButton: document.querySelector('#clearKeyButton'),
  chooseSourceButton: document.querySelector('#chooseSourceButton'),
  refreshButton: document.querySelector('#refreshButton'),
  clearCropButton: document.querySelector('#clearCropButton'),
  sourceDialog: document.querySelector('#sourceDialog'),
  sourceGrid: document.querySelector('#sourceGrid'),
  sourceStatus: document.querySelector('#sourceStatus'),
  previewStage: document.querySelector('#previewStage'),
  emptyPreview: document.querySelector('#emptyPreview'),
  canvas: document.querySelector('#captureCanvas'),
  cropHint: document.querySelector('#cropHint'),
  questionInput: document.querySelector('#questionInput'),
  askButton: document.querySelector('#askButton'),
  askButtonText: document.querySelector('#askButtonText'),
  loadingDot: document.querySelector('#loadingDot'),
  answerCard: document.querySelector('#answerCard'),
  answerPlaceholder: document.querySelector('#answerPlaceholder'),
  answerStatus: document.querySelector('#answerStatus'),
  answerText: document.querySelector('#answerText'),
  unclearNotice: document.querySelector('#unclearNotice'),
  evidenceDetails: document.querySelector('#evidenceDetails'),
  evidenceList: document.querySelector('#evidenceList'),
  copyButton: document.querySelector('#copyButton'),
  toast: document.querySelector('#toast')
};

const ctx = elements.canvas.getContext('2d');
const state = {
  sourceId: null,
  sourceName: '',
  image: null,
  crop: null,
  dragStart: null,
  dragging: false,
  busy: false,
  hasApiKey: false,
  settings: null
};

let toastTimer;

function showToast(message, type = 'info') {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.className = `toast show ${type === 'error' ? 'error' : ''}`;
  toastTimer = setTimeout(() => {
    elements.toast.className = 'toast';
  }, 3200);
}

function updateAskState() {
  elements.askButton.disabled = !state.sourceId || state.busy;
}

function updateProviderBadge(settings) {
  elements.providerBadge.textContent = settings.provider === 'deepseek'
    ? 'DeepSeek Flash'
    : 'OpenAI';
}

function canvasPoint(event) {
  const rect = elements.canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(elements.canvas.width, (event.clientX - rect.left) * elements.canvas.width / rect.width)),
    y: Math.max(0, Math.min(elements.canvas.height, (event.clientY - rect.top) * elements.canvas.height / rect.height))
  };
}

function normalizedRect(start, end) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  };
}

function drawCanvas(liveCrop = state.crop) {
  if (!state.image) return;
  ctx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
  ctx.drawImage(state.image, 0, 0, elements.canvas.width, elements.canvas.height);

  if (liveCrop && liveCrop.width > 4 && liveCrop.height > 4) {
    ctx.save();
    ctx.fillStyle = 'rgba(7, 13, 26, 0.5)';
    ctx.fillRect(0, 0, elements.canvas.width, elements.canvas.height);
    ctx.clearRect(liveCrop.x, liveCrop.y, liveCrop.width, liveCrop.height);
    ctx.drawImage(
      state.image,
      liveCrop.x,
      liveCrop.y,
      liveCrop.width,
      liveCrop.height,
      liveCrop.x,
      liveCrop.y,
      liveCrop.width,
      liveCrop.height
    );
    ctx.strokeStyle = '#63d9e8';
    ctx.lineWidth = Math.max(3, elements.canvas.width / 700);
    ctx.setLineDash([12, 8]);
    ctx.strokeRect(liveCrop.x, liveCrop.y, liveCrop.width, liveCrop.height);
    ctx.restore();
  }
}

function setCapturedImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      state.image = image;
      elements.canvas.width = image.naturalWidth;
      elements.canvas.height = image.naturalHeight;
      state.crop = null;
      elements.previewStage.classList.remove('empty');
      elements.previewStage.classList.add('has-image');
      elements.emptyPreview.hidden = true;
      elements.clearCropButton.disabled = true;
      elements.cropHint.textContent = '可在画面上拖拽框选 PPT；不框选则使用整个窗口。';
      drawCanvas();
      resolve();
    };
    image.onerror = () => reject(new Error('无法显示截取的画面。'));
    image.src = dataUrl;
  });
}

async function refreshCapture({ silent = false } = {}) {
  if (!state.sourceId) return;
  try {
    const result = await api.takeCapture(state.sourceId);
    await setCapturedImage(result.image);
    if (!silent) showToast('已刷新当前课堂画面');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function chooseSource() {
  elements.sourceGrid.innerHTML = '<p class="dialog-copy">正在读取可选窗口…</p>';
  elements.sourceDialog.showModal();
  try {
    const sources = await api.listSources();
    elements.sourceGrid.innerHTML = '';
    if (!sources.length) {
      elements.sourceGrid.innerHTML = '<p class="dialog-copy">没有找到可捕获的窗口。</p>';
      return;
    }

    for (const source of sources) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'source-item';

      const image = document.createElement('img');
      image.src = source.thumbnail;
      image.alt = '';

      const label = document.createElement('span');
      label.textContent = source.name;

      button.append(image, label);
      button.addEventListener('click', async () => {
        state.sourceId = source.id;
        state.sourceName = source.name;
        elements.sourceStatus.textContent = source.name;
        elements.sourceStatus.title = source.name;
        elements.sourceStatus.classList.remove('muted');
        elements.refreshButton.disabled = false;
        updateAskState();
        elements.sourceDialog.close();
        await refreshCapture({ silent: true });
        showToast('课程窗口已选择');
      });
      elements.sourceGrid.append(button);
    }
  } catch (error) {
    elements.sourceGrid.innerHTML = `<p class="dialog-copy">${error.message}</p>`;
  }
}

function finalImageDataUrl() {
  if (!state.image) return null;
  const crop = state.crop && state.crop.width > 12 && state.crop.height > 12
    ? state.crop
    : { x: 0, y: 0, width: elements.canvas.width, height: elements.canvas.height };

  const output = document.createElement('canvas');
  const scale = Math.min(2, Math.max(1, 900 / crop.width));
  output.width = Math.round(crop.width * scale);
  output.height = Math.round(crop.height * scale);
  const outputContext = output.getContext('2d');
  outputContext.imageSmoothingEnabled = true;
  outputContext.imageSmoothingQuality = 'high';
  outputContext.drawImage(
    state.image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    output.width,
    output.height
  );
  return output.toDataURL('image/png');
}

function showAnswer(response) {
  const statusLabels = {
    clear: '画面清晰',
    partial: '部分不清',
    unclear: '需要重选区域'
  };

  elements.answerText.textContent = response.answer;
  elements.answerStatus.textContent = statusLabels[response.status] || statusLabels.partial;
  elements.answerStatus.className = `answer-status ${response.status || 'partial'}`;

  elements.unclearNotice.hidden = !response.unclear;
  elements.unclearNotice.textContent = response.unclear ? `识别提示：${response.unclear}` : '';

  elements.evidenceList.replaceChildren();
  for (const evidence of response.evidence || []) {
    const item = document.createElement('li');
    item.textContent = evidence;
    elements.evidenceList.append(item);
  }
  elements.evidenceDetails.hidden = !response.evidence?.length;
  elements.evidenceDetails.open = false;
  elements.answerPlaceholder.hidden = true;
  elements.answerCard.hidden = false;
}

async function askQuestion() {
  const question = elements.questionInput.value.trim();
  if (!question) {
    showToast('请先输入问题，或点击一个快捷问题。', 'error');
    elements.questionInput.focus();
    return;
  }
  if (!state.hasApiKey) {
    showToast('请先在设置中填写 API 密钥。', 'error');
    openSettings();
    return;
  }

  state.busy = true;
  updateAskState();
  elements.askButtonText.textContent = '正在阅读这一页…';
  elements.loadingDot.hidden = false;

  try {
    const oldCrop = state.crop;
    const result = await api.takeCapture(state.sourceId);
    await setCapturedImage(result.image);
    state.crop = oldCrop;
    drawCanvas();

    const response = await api.ask({
      question,
      imageDataUrl: finalImageDataUrl()
    });

    showAnswer(response);
    elements.answerCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (error) {
    showToast(error.message || '提问失败，请重试。', 'error');
  } finally {
    state.busy = false;
    elements.askButtonText.textContent = '截取当前页并提问';
    elements.loadingDot.hidden = true;
    updateAskState();
  }
}

async function openSettings() {
  const settings = await api.getSettings();
  state.settings = settings;
  state.hasApiKey = settings.hasApiKey;
  updateProviderBadge(settings);
  elements.providerInput.value = settings.provider;
  updateProviderFields();
  elements.alwaysOnTopInput.checked = settings.alwaysOnTop;
  elements.settingsDialog.showModal();
}

function updateProviderFields() {
  const settings = state.settings || {};
  const provider = elements.providerInput.value;
  const isDeepSeek = provider === 'deepseek';
  const hasKey = isDeepSeek ? settings.hasDeepSeekKey : settings.hasOpenAIKey;

  elements.apiKeyInput.value = '';
  elements.apiKeyLabel.textContent = `${isDeepSeek ? 'DeepSeek' : 'OpenAI'} API 密钥`;
  elements.apiKeyInput.placeholder = hasKey ? '已安全保存；留空表示不修改' : 'sk-...';
  elements.apiKeyHint.textContent = hasKey
    ? '已保存密钥。输入新密钥可替换，留空则保持不变。'
    : '密钥会使用 Windows 系统加密后保存在本机。';
  elements.modelInput.value = isDeepSeek
    ? settings.deepseekModel || 'deepseek-flash'
    : settings.openaiModel || 'gpt-5.4-mini';
  elements.modelHint.textContent = isDeepSeek
    ? '课堂识图请使用 deepseek-flash；其他 DeepSeek 模型可能不支持图片。'
    : '默认模型兼顾识图效果与响应速度。';
}

elements.canvas.addEventListener('pointerdown', (event) => {
  if (!state.image) return;
  elements.canvas.setPointerCapture(event.pointerId);
  state.dragStart = canvasPoint(event);
  state.dragging = true;
});

elements.canvas.addEventListener('pointermove', (event) => {
  if (!state.dragging) return;
  const current = canvasPoint(event);
  drawCanvas(normalizedRect(state.dragStart, current));
});

elements.canvas.addEventListener('pointerup', (event) => {
  if (!state.dragging) return;
  state.dragging = false;
  const crop = normalizedRect(state.dragStart, canvasPoint(event));
  state.crop = crop.width > 20 && crop.height > 20 ? crop : null;
  elements.clearCropButton.disabled = !state.crop;
  elements.cropHint.textContent = state.crop
    ? '已框选 PPT 区域；提问时只发送框内内容。'
    : '框选范围太小，当前会使用整个窗口。';
  drawCanvas();
});

elements.clearCropButton.addEventListener('click', () => {
  state.crop = null;
  elements.clearCropButton.disabled = true;
  elements.cropHint.textContent = '已重置；提问时将使用整个窗口。';
  drawCanvas();
});

elements.chooseSourceButton.addEventListener('click', chooseSource);
elements.refreshButton.addEventListener('click', () => refreshCapture());
elements.settingsButton.addEventListener('click', openSettings);
elements.providerInput.addEventListener('change', updateProviderFields);
elements.closeSettingsButton.addEventListener('click', () => elements.settingsDialog.close());
elements.askButton.addEventListener('click', askQuestion);

elements.questionInput.addEventListener('keydown', (event) => {
  if (event.ctrlKey && event.key === 'Enter') askQuestion();
});

document.querySelectorAll('[data-question]').forEach((button) => {
  button.addEventListener('click', () => {
    elements.questionInput.value = button.dataset.question;
    elements.questionInput.focus();
  });
});

elements.copyButton.addEventListener('click', async () => {
  await navigator.clipboard.writeText(elements.answerText.textContent);
  showToast('答案已复制');
});

elements.settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const settings = await api.saveSettings({
      provider: elements.providerInput.value,
      apiKey: elements.apiKeyInput.value,
      model: elements.modelInput.value,
      alwaysOnTop: elements.alwaysOnTopInput.checked
    });
    state.settings = settings;
    state.hasApiKey = settings.hasApiKey;
    updateProviderBadge(settings);
    elements.settingsDialog.close();
    showToast('设置已保存');
  } catch (error) {
    showToast(error.message, 'error');
  }
});

elements.clearKeyButton.addEventListener('click', async () => {
  const settings = await api.saveSettings({
    provider: elements.providerInput.value,
    model: elements.modelInput.value,
    alwaysOnTop: elements.alwaysOnTopInput.checked,
    clearApiKey: true
  });
  state.settings = settings;
  state.hasApiKey = settings.hasApiKey;
  updateProviderBadge(settings);
  elements.apiKeyInput.value = '';
  elements.apiKeyInput.placeholder = 'sk-...';
  elements.apiKeyHint.textContent = '密钥已清除。';
  showToast('API 密钥已清除');
});

elements.alwaysOnTopInput.addEventListener('change', () => {
  api.setAlwaysOnTop(elements.alwaysOnTopInput.checked);
});

api.onAskShortcut(() => {
  elements.questionInput.focus();
  elements.questionInput.select();
});

(async () => {
  try {
    const settings = await api.getSettings();
    state.settings = settings;
    state.hasApiKey = settings.hasApiKey;
    updateProviderBadge(settings);
    elements.alwaysOnTopInput.checked = settings.alwaysOnTop;
    updateAskState();
  } catch (error) {
    showToast(error.message, 'error');
  }
})();
