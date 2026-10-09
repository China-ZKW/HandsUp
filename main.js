const { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

let mainWindow;

const PROVIDERS = {
  openai: {
    label: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/responses',
    defaultModel: 'gpt-5.4-mini'
  },
  deepseek: {
    label: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/responses',
    defaultModel: 'deepseek-flash'
  }
};

function normalizeProvider(value) {
  return value === 'deepseek' ? 'deepseek' : 'openai';
}

function providerModel(saved, provider) {
  if (provider === 'deepseek') {
    return saved.deepseekModel || PROVIDERS.deepseek.defaultModel;
  }
  return saved.openaiModel || saved.model || PROVIDERS.openai.defaultModel;
}

function encryptedProviderKey(saved, provider) {
  return provider === 'deepseek'
    ? saved.encryptedDeepSeekKey
    : saved.encryptedOpenAIKey || saved.encryptedApiKey;
}

function settingsView(saved) {
  const provider = normalizeProvider(saved.provider);
  const hasOpenAIKey = Boolean(decryptSecret(encryptedProviderKey(saved, 'openai')));
  const hasDeepSeekKey = Boolean(decryptSecret(encryptedProviderKey(saved, 'deepseek')));
  return {
    provider,
    hasApiKey: provider === 'deepseek' ? hasDeepSeekKey : hasOpenAIKey,
    hasOpenAIKey,
    hasDeepSeekKey,
    model: providerModel(saved, provider),
    openaiModel: providerModel(saved, 'openai'),
    deepseekModel: providerModel(saved, 'deepseek'),
    alwaysOnTop: saved.alwaysOnTop !== false
  };
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readSettingsFile() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeSettingsFile(settings) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
}

function encryptSecret(value) {
  if (!value) return '';
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('当前系统无法安全保存 API 密钥，请检查 Windows 登录状态。');
  }
  return safeStorage.encryptString(value).toString('base64');
}

function decryptSecret(value) {
  if (!value) return '';
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'));
  } catch {
    return '';
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 720,
    minWidth: 960,
    minHeight: 620,
    show: false,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    backgroundColor: '#f1f1f3',
    title: 'HandsUp · 课堂 PPT 助手',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  if (process.argv.includes('--capture-preview')) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const image = await mainWindow.webContents.capturePage();
        const previewName = app.isPackaged ? 'packaged-ui-preview.png' : 'ui-preview.png';
        fs.writeFileSync(path.join(process.cwd(), previewName), image.toPNG());
        app.quit();
      }, 800);
    });
  }

  if (process.argv.includes('--smoke-sources')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        const result = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const sources = await window.classroomAPI.listSources();
            const capture = sources[0]
              ? await window.classroomAPI.takeCapture(sources[0].id)
              : null;
            return {
              ok: true,
              count: sources.length,
              thumbnailsReady: sources.every((source) => Boolean(source.thumbnail)),
              captureReady: Boolean(capture && capture.image && capture.image.startsWith('data:image/'))
            };
          })()
        `);
        fs.writeFileSync(
          path.join(process.cwd(), 'smoke-result.json'),
          JSON.stringify(result, null, 2),
          'utf8'
        );
        app.quit();
      } catch (error) {
        fs.writeFileSync(
          path.join(process.cwd(), 'smoke-result.json'),
          JSON.stringify({ ok: false, error: error.message }, null, 2),
          'utf8'
        );
        app.exit(1);
      }
    });
  }
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('shortcut:ask');
  }
}

function outputText(response) {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const parts = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && content.text) parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
}

function compactText(value, limit = 220) {
  const text = String(value || '').trim();
  if (text.length <= limit) return text;

  const preview = text.slice(0, limit);
  const sentenceEnd = Math.max(
    preview.lastIndexOf('。'),
    preview.lastIndexOf('！'),
    preview.lastIndexOf('？'),
    preview.lastIndexOf('\n')
  );
  if (sentenceEnd >= 60) return preview.slice(0, sentenceEnd + 1).trim();
  return `${preview.trim()}…`;
}

function parseClassroomAnswer(response) {
  if (response.status === 'incomplete') {
    const reason = response.incomplete_details?.reason;
    if (reason === 'max_output_tokens') {
      throw new Error('回答生成不完整，请重试或把问题问得更具体。');
    }
    throw new Error('回答未完整生成，请重试。');
  }

  const raw = outputText(response);
  if (!raw) throw new Error('模型没有返回文字答案，请重试。');

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('模型返回格式异常，请重试。');
  }

  const allowedStatuses = new Set(['clear', 'partial', 'unclear']);
  const status = allowedStatuses.has(parsed.status) ? parsed.status : 'partial';
  const answer = compactText(parsed.answer);
  const evidence = Array.isArray(parsed.evidence)
    ? parsed.evidence.map((item) => compactText(item, 100)).filter(Boolean).slice(0, 2)
    : [];
  const unclear = compactText(parsed.unclear, 120);

  if (!answer) throw new Error('模型没有返回有效答案，请重试。');
  return { status, answer, evidence, unclear };
}

const classroomAnswerFormat = {
  type: 'json_schema',
  name: 'handsup_classroom_answer',
  description: 'A concise, screenshot-grounded classroom explanation.',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['clear', 'partial', 'unclear'],
        description: 'clear when key evidence is readable, partial when noncritical details are unclear, unclear when the question cannot be answered reliably.'
      },
      answer: {
        type: 'string',
        description: 'A direct Simplified Chinese answer. Give the conclusion first and keep the normal answer within 160 Chinese characters.'
      },
      evidence: {
        type: 'array',
        description: 'Zero to two short facts directly visible in the screenshot that support the answer.',
        items: { type: 'string' }
      },
      unclear: {
        type: 'string',
        description: 'What exact text, symbol, subscript, number, or diagram relation is unreadable. Use an empty string when nothing important is unclear.'
      }
    },
    required: ['status', 'answer', 'evidence', 'unclear'],
    additionalProperties: false
  }
};

function providerAnswerFormat(provider) {
  if (provider === 'deepseek') {
    return {
      type: classroomAnswerFormat.type,
      name: classroomAnswerFormat.name,
      schema: classroomAnswerFormat.schema
    };
  }
  return classroomAnswerFormat;
}

ipcMain.handle('capture:list-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: 300, height: 180 },
    fetchWindowIcons: false
  });

  const ownSourceId = mainWindow && !mainWindow.isDestroyed()
    ? mainWindow.getMediaSourceId()
    : '';

  return sources
    .filter((source) => source.id !== ownSourceId)
    .map((source) => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL()
    }));
});

ipcMain.handle('capture:take', async (_event, sourceId) => {
  if (!sourceId) throw new Error('请先选择微信课程窗口或屏幕。');

  const sourceTypes = sourceId.startsWith('screen:') ? ['screen'] : ['window'];
  const sources = await desktopCapturer.getSources({
    types: sourceTypes,
    thumbnailSize: { width: 1920, height: 1200 },
    fetchWindowIcons: false
  });
  const source = sources.find((item) => item.id === sourceId);
  if (!source) throw new Error('找不到之前选择的窗口，请重新选择。');
  if (source.thumbnail.isEmpty()) throw new Error('窗口画面为空，请确认窗口没有最小化。');

  return {
    name: source.name,
    image: source.thumbnail.toDataURL()
  };
});

ipcMain.handle('settings:get', () => {
  return settingsView(readSettingsFile());
});

ipcMain.handle('settings:save', (_event, incoming) => {
  const saved = readSettingsFile();
  const provider = normalizeProvider(incoming.provider);
  const next = {
    ...saved,
    provider,
    alwaysOnTop: incoming.alwaysOnTop !== false
  };

  if (provider === 'deepseek') {
    next.deepseekModel = String(incoming.model || PROVIDERS.deepseek.defaultModel).trim();
  } else {
    next.openaiModel = String(incoming.model || PROVIDERS.openai.defaultModel).trim();
  }

  if (typeof incoming.apiKey === 'string' && incoming.apiKey.trim()) {
    const encrypted = encryptSecret(incoming.apiKey.trim());
    if (provider === 'deepseek') {
      next.encryptedDeepSeekKey = encrypted;
    } else {
      next.encryptedOpenAIKey = encrypted;
      next.encryptedApiKey = '';
    }
  }
  if (incoming.clearApiKey === true) {
    if (provider === 'deepseek') {
      next.encryptedDeepSeekKey = '';
    } else {
      next.encryptedOpenAIKey = '';
      next.encryptedApiKey = '';
    }
  }

  writeSettingsFile(next);
  if (mainWindow) mainWindow.setAlwaysOnTop(next.alwaysOnTop);
  return settingsView(next);
});

ipcMain.handle('window:set-always-on-top', (_event, enabled) => {
  if (mainWindow) mainWindow.setAlwaysOnTop(Boolean(enabled));
});

ipcMain.handle('ai:ask', async (_event, payload) => {
  const saved = readSettingsFile();
  const provider = normalizeProvider(saved.provider);
  const providerConfig = PROVIDERS[provider];
  const apiKey = decryptSecret(encryptedProviderKey(saved, provider));
  if (!apiKey) throw new Error(`请先在设置中填写 ${providerConfig.label} API 密钥。`);
  if (!payload?.imageDataUrl) throw new Error('还没有截取 PPT 页面。');

  const question = String(payload.question || '').trim();
  if (!question) throw new Error('请输入问题或选择一个快捷问题。');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const requestBody = {
      model: providerModel(saved, provider),
      instructions: [
        '你是 HandsUp，一名课堂实时学习助手。',
        '只根据截图中能够直接辨认的信息回答学生的问题。',
        '第一句直接给结论；默认答案不超过 160 个中文字符，最多 3 个短要点。',
        '只解释与问题有关的内容，不完整复述整张 PPT，不使用空泛鼓励语。',
        '结论必须由截图中的标题、文字、公式、代码、数值或图示支持，并在 evidence 中列出至多 2 条可见依据。',
        '不得补写截图中不存在的数值、变量、代码、步骤或箭头关系。',
        '遇到容易混淆的字符、上下标和运算符时保持谨慎，不要擅自纠正。',
        '如果非关键内容看不清，status 使用 partial，并在 unclear 中指出具体位置。',
        '如果回答问题所需的关键内容看不清，status 使用 unclear；明确建议重新框选，不要猜测答案。',
        '使用截图之外的知识时，在 answer 中明确标记“补充：”，不能说成 PPT 原文。',
        '只有学生明确要求详细解释时才展开；即使展开，也先给结论。'
      ].join('\n'),
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: `学生问题：${question}` },
            {
              type: 'input_image',
              image_url: payload.imageDataUrl,
              detail: 'high'
            }
          ]
        }
      ],
      text: { format: providerAnswerFormat(provider) },
      max_output_tokens: 450
    };

    if (provider === 'openai') requestBody.store = false;
    if (provider === 'deepseek') requestBody.reasoning = { effort: 'none' };

    const response = await fetch(providerConfig.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    const data = await response.json();
    if (!response.ok) {
      const message = data?.error?.message || `请求失败（HTTP ${response.status}）`;
      throw new Error(message);
    }
    if (data.status === 'failed') {
      throw new Error(data?.error?.message || `${providerConfig.label} 未能生成回答。`);
    }

    return parseClassroomAnswer(data);
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('请求超时，请检查网络后重试。');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
});

app.whenReady().then(() => {
  createWindow();
  globalShortcut.register('Alt+Q', toggleWindow);
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
