// ========== STATE ==========
const DB_KEY = 'tactile_tutor_words';
let words = JSON.parse(localStorage.getItem(DB_KEY) || '[]');
let currentScreen = 'dashboard';
let practiceSession = [];
let practiceIndex = 0;
let cardFlipped = false;
let pendingImageWord = null;
let deepseekAssociation = null; // stores the last DeepSeek-proposed association

function getDeepSeekKey() { return localStorage.getItem('deepseek_api_key') || ''; }
function saveDeepSeekKey(k) { localStorage.setItem('deepseek_api_key', k.trim()); }

// ========== SEED DATA ==========
if (words.length === 0) {
  words = [
    { id: uid(), word: 'Ephemeral', phonetic: '/əˈfem(ə)rəl/', translation: 'Мимолётный, недолговечный', association: '"A film that is real but short"', image: null, mastery: 1, nextReview: Date.now(), reviews: 3 },
    { id: uid(), word: 'Árbol', phonetic: '/ˈaɾ.βol/', translation: 'Дерево (исп.)', association: '"The Archer hit the bole of the tree"', image: null, mastery: 2, nextReview: Date.now(), reviews: 7 },
    { id: uid(), word: 'Serendipity', phonetic: '/ˌserənˈdɪpɪti/', translation: 'Счастливая случайность', association: '"Serene dip — a lucky swim"', image: null, mastery: 0, nextReview: Date.now(), reviews: 1 },
  ];
  saveWords();
}

function uid() { return Math.random().toString(36).slice(2, 10); }
function saveWords() { localStorage.setItem(DB_KEY, JSON.stringify(words)); }
function today() { return new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }); }
function dueWords() { return words.filter(w => w.nextReview <= Date.now()); }

// ========== NAVIGATION ==========
function navigate(screen) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('screen-' + screen).classList.add('active');
  document.querySelector(`.nav-btn[data-screen="${screen}"]`).classList.add('active');
  currentScreen = screen;
  renderScreen(screen);
}

function renderScreen(name) {
  if (name === 'dashboard') renderDashboard();
  else if (name === 'add') renderAddWord();
  else if (name === 'practice') renderPractice();
  else if (name === 'library') renderLibrary();
}

// ========== TOAST ==========
function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ========== AUTO-TRANSLATE (MyMemory API — multiple variants) ==========
async function autoTranslate(word) {
  if (!word) return [];
  try {
    const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|ru`);
    const data = await res.json();
    const variants = new Set();
    // Primary result
    if (data.responseData?.translatedText && data.responseData.translatedText.toLowerCase() !== word.toLowerCase())
      variants.add(data.responseData.translatedText);
    // Matches from MyMemory
    if (data.matches) {
      data.matches.slice(0, 8).forEach(m => {
        if (m.translation && m.translation.toLowerCase() !== word.toLowerCase() && /[а-яёА-ЯЁ]/.test(m.translation))
          variants.add(m.translation);
      });
    }
    return [...variants].slice(0, 4);
  } catch { return []; }
}

// ========== AUTO-PHONETIC (Free Dictionary API — real IPA) ==========
async function autoPhonetic(word) {
  if (!word) return '';
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
    const data = await res.json();
    if (Array.isArray(data) && data[0]?.phonetics) {
      const ph = data[0].phonetics.find(p => p.text) || data[0].phonetics[0];
      if (ph?.text) return ph.text.startsWith('/') ? ph.text : '/' + ph.text + '/';
    }
    if (data[0]?.phonetic) return data[0].phonetic;
    return '';
  } catch { return ''; }
}

// ========== DEEPSEEK API ==========
async function callDeepSeek(prompt) {
  const key = getDeepSeekKey();
  window.lastDeepSeekError = '';
  
  if (!key) {
    window.lastDeepSeekError = 'API ключ не найден. Нажмите ⚙️ и вставьте ключ.';
    return null;
  }

  // Путь к нашей серверной функции на Netlify
  const url = '/.netlify/functions/deepseek';

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, key })
    });
    
    // Если мы не на Netlify (локально), функция может не существовать
    if (res.status === 404) {
      window.lastDeepSeekError = 'Функция не найдена. Работает только после деплоя на Netlify.';
      return null;
    }

    const data = await res.json();

    if (data.error) {
      const msg = data.error.message || '';
      window.lastDeepSeekError = msg || 'Ошибка API';
      return null;
    }

    const text = data?.choices?.[0]?.message?.content;
    if (text) return text;
    
    window.lastDeepSeekError = 'Получен пустой ответ от ИИ';
    return null;
  } catch (e) {
    window.lastDeepSeekError = 'Ошибка вызова функции. Вы развернули проект на Netlify?';
    console.error('Netlify function error:', e);
    return null;
  }
}

async function deepseekGetAssociation(word, phonetic, translation) {
  const prompt = `Ты помогаешь запоминать английские слова методом фонетических ассоциаций (метод Аткинсона).

Слово: "${word}"
Транскрипция: ${phonetic}
Перевод: ${translation}

Придумай яркую мнемоническую ассоциацию на русском языке, используя созвучие слова с русскими словами. Ассоциация должна быть образной, запоминающейся и связывать звучание с переводом.

Ответ СТРОГО в формате JSON (без markdown, без \`\`\`):
{
  "association": "текст ассоциации",
  "imagePrompt": "detailed English prompt for illustration based on this mnemonic"
}`;
  const raw = await callDeepSeek(prompt);
  if (!raw) return null;
  try {
    // Strip possible markdown code fences
    const clean = raw.replace(/```json?/gi, '').replace(/```/g, '').trim();
    const jsonStr = clean.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonStr) throw new Error("JSON не найден в ответе");
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error('DeepSeek JSON Parse Error:', e, raw);
    window.lastDeepSeekError = 'Ошибка обработки ответа ИИ: ' + e.message;
    return null;
  }
}

// ========== IMAGE GENERATION (Pollinations.ai) ==========
async function generateImage(prompt) {
  const encoded = encodeURIComponent(prompt + ', mnemonic illustration, watercolor, vivid colors, soft lighting');
  return `https://image.pollinations.ai/prompt/${encoded}?width=512&height=288&nologo=true&seed=${Math.floor(Math.random()*9999)}`;
}

async function handleGenerateImage(wordId, prompt) {
  const btn = document.getElementById('gen-img-btn');
  const wrap = document.getElementById('assoc-image-wrap');
  if (!btn || !wrap) return;

  btn.disabled = true;
  wrap.innerHTML = `<div class="image-loading"><div class="spinner"></div><div class="body-sm">Генерирую образ…</div></div>`;

  try {
    const url = await generateImage(prompt, wordId);
    const img = new Image();
    img.onload = () => {
      wrap.innerHTML = `<img src="${url}" alt="${prompt}">`;
      // Save image URL to word
      const w = words.find(x => x.id === wordId);
      if (w) { w.image = url; saveWords(); }
      if (btn) btn.disabled = false;
    };
    img.onerror = () => {
      wrap.innerHTML = `<div class="assoc-image-placeholder"><span class="material-icons-round">broken_image</span><span class="body-sm">Не удалось загрузить</span></div>`;
      if (btn) btn.disabled = false;
      showToast('⚠️ Ошибка загрузки изображения');
    };
    img.src = url;
  } catch (e) {
    wrap.innerHTML = `<div class="assoc-image-placeholder"><span class="material-icons-round">image</span><span class="body-sm">Нажмите для генерации</span></div>`;
    if (btn) btn.disabled = false;
    showToast('⚠️ Ошибка API');
  }
}

// ========== DASHBOARD ==========
function renderDashboard() {
  const el = document.getElementById('screen-dashboard');
  const due = dueWords().length;
  const total = words.length;
  const learned = words.filter(w => w.mastery >= 3).length;
  const streak = parseInt(localStorage.getItem('streak') || '12');
  const todayDone = parseInt(localStorage.getItem('todayDone') || '0');
  const dailyGoal = 5;

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
      <div>
        <div class="label">${today()}</div>
        <div class="headline" style="margin-top:4px;">Привет, Alex! 👋</div>
      </div>
      <div class="streak-badge"><span class="material-icons-round" style="font-size:16px;">local_fire_department</span>${streak} дней</div>
    </div>

    <div class="card-white" style="background:linear-gradient(135deg,#266d00,#3a9900);color:#fff;margin-bottom:16px;">
      <div class="label" style="color:rgba(255,255,255,0.7);">Цель на сегодня</div>
      <div class="headline" style="color:#fff;margin:8px 0;">${todayDone} / ${dailyGoal} слов</div>
      <div class="progress-track" style="background:rgba(255,255,255,0.25);">
        <div class="progress-fill" style="background:#fff;width:${Math.min(100, (todayDone/dailyGoal)*100)}%;"></div>
      </div>
      <div style="margin-top:16px;font-size:13px;color:rgba(255,255,255,0.85);">Осталось повторить: ${due} слов</div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
      <div class="card" style="padding:16px;text-align:center;">
        <div class="display" style="font-size:32px;color:var(--primary);">${total}</div>
        <div class="label">Всего слов</div>
      </div>
      <div class="card" style="padding:16px;text-align:center;">
        <div class="display" style="font-size:32px;color:var(--tertiary);">${learned}</div>
        <div class="label">Освоено</div>
      </div>
    </div>

    ${due > 0 ? `
    <div class="card-white" style="margin-bottom:16px;">
      <div class="section-header">
        <span class="title">📚 Пора повторить</span>
        <span class="body-sm">${due} слов</span>
      </div>
      ${dueWords().slice(0,3).map(w => `
        <div class="word-chip" onclick="navigate('practice')">
          <div class="mastery-dot mastery-${w.mastery}"></div>
          <div style="flex:1">
            <div class="word-chip-word">${w.word}</div>
            <div class="word-chip-meta">${w.phonetic}</div>
          </div>
          <span class="material-icons-round" style="color:var(--outline-variant);font-size:18px;">chevron_right</span>
        </div>
      `).join('')}
      <button class="btn btn-primary" style="margin-top:12px;" onclick="navigate('practice')">
        <span class="material-icons-round">play_arrow</span> Начать практику
      </button>
    </div>
    ` : `
    <div class="card" style="text-align:center;padding:32px;">
      <div style="font-size:48px;margin-bottom:8px;">🎉</div>
      <div class="title">Все слова повторены!</div>
      <div class="body-sm" style="margin-top:6px;">Отличная работа. Добавь новые слова.</div>
      <button class="btn btn-primary" style="margin-top:16px;" onclick="navigate('add')">
        <span class="material-icons-round">add</span> Добавить слово
      </button>
    </div>
    `}

    <div class="section-header" style="margin-top:8px;">
      <span class="title">Последние добавленные</span>
      <span class="body-sm" style="cursor:pointer;color:var(--secondary);" onclick="navigate('library')">Все →</span>
    </div>
    ${words.slice(-3).reverse().map(w => wordChip(w)).join('')}
  `;
}

function wordChip(w) {
  return `
    <div class="word-chip" onclick="openWordDetail('${w.id}')">
      ${w.image ? `<img class="word-chip-img" src="${w.image}" alt="${w.word}">` : `<div class="word-chip-img" style="display:flex;align-items:center;justify-content:center;"><span class="material-icons-round" style="color:var(--outline-variant);">image</span></div>`}
      <div style="flex:1">
        <div class="word-chip-word">${w.word}</div>
        <div class="word-chip-meta">${w.phonetic} · ${w.translation}</div>
      </div>
      <div class="mastery-dot mastery-${w.mastery}"></div>
    </div>
  `;
}

// ========== ADD WORD ==========
function renderAddWord() {
  deepseekAssociation = null;
  const el = document.getElementById('screen-add');
  const hasDeepSeek = !!getDeepSeekKey();
  el.innerHTML = `
    <div style="margin-bottom:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div class="headline">Новое слово</div>
        <button class="btn-icon btn" title="Настройки DeepSeek" onclick="openDeepSeekSettings()">
          <span class="material-icons-round" style="font-size:20px;">settings</span>
        </button>
      </div>
      <div class="body-sm">Введите слово голосом или вручную — всё остальное сделает ИИ</div>
    </div>

    <div class="input-wrap">
      <label class="input-label">Слово / фраза (английский)</label>
      <div style="position:relative;">
        <input id="inp-word" class="input" placeholder="например: ephemeral" autocomplete="off"
          oninput="onWordInput()" style="padding-right:52px;">
        <button id="mic-btn" class="btn-icon btn" onclick="startVoiceInput()"
          title="Голосовой ввод"
          style="position:absolute;right:8px;top:50%;transform:translateY(-50%);width:36px;height:36px;background:var(--primary-light);color:var(--primary);">
          <span class="material-icons-round" style="font-size:18px;">mic</span>
        </button>
      </div>
    </div>

    <div class="input-wrap" style="position:relative;">
      <label class="input-label">Транскрипция (IPA)</label>
      <input id="inp-phonetic" class="input" placeholder="/загружается…/" readonly style="color:var(--secondary);font-weight:500;letter-spacing:0.03em;">
      <span id="phonetic-spinner" style="display:none;position:absolute;right:14px;top:34px;"><div class="spinner" style="width:16px;height:16px;border-width:2px;"></div></span>
    </div>

    <div class="input-wrap">
      <label class="input-label">Перевод на русский</label>
      <div id="translation-variants" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;"></div>
      <input id="inp-translation" class="input" placeholder="выберите вариант выше или введите вручную">
      <span id="translate-spinner" style="display:none;margin-top:6px;"><div class="spinner" style="width:16px;height:16px;border-width:2px;"></div></span>
    </div>

    <div class="input-wrap">
      <label class="input-label">Мнемоническая ассоциация</label>
      <textarea id="inp-association" class="input" rows="3"
        placeholder="Нажмите «DeepSeek» — ИИ предложит ассоциацию…"></textarea>
      <button id="deepseek-assoc-btn" class="btn btn-secondary" style="margin-top:8px;"
        onclick="requestDeepSeekAssociation()" ${hasDeepSeek ? '' : 'title="Добавьте DeepSeek API ключ в настройках"'}>
        <span class="material-icons-round">psychology</span>
        ${hasDeepSeek ? 'Предложить ассоциацию (DeepSeek)' : '🔑 Нужен DeepSeek API ключ'}
      </button>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <div class="section-header">
        <span class="title">🎨 Визуальный образ</span>
        <span class="body-sm">Pollinations.ai</span>
      </div>
      <div class="assoc-image-wrap" id="assoc-image-wrap">
        <div class="assoc-image-placeholder">
          <span class="material-icons-round">image_search</span>
          <span class="body-sm" id="img-hint">Сначала получите ассоциацию от DeepSeek</span>
        </div>
      </div>
      <button id="gen-img-btn" class="btn btn-secondary" onclick="handleGenerateImageNew()">
        <span class="material-icons-round">auto_awesome</span> Сгенерировать образ
      </button>
    </div>

    <button class="btn btn-primary" onclick="saveNewWord()">
      <span class="material-icons-round">check</span> Сохранить слово
    </button>
  `;
}

// ========== VOICE INPUT ==========
function startVoiceInput() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { showToast('Голосовой ввод не поддерживается браузером'); return; }
  const rec = new SR();
  rec.lang = 'en-US';
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  const btn = document.getElementById('mic-btn');
  if (btn) { btn.style.background = '#ff4444'; btn.querySelector('span').textContent = 'mic'; }
  rec.start();
  rec.onresult = (e) => {
    const word = e.results[0][0].transcript.trim();
    const inp = document.getElementById('inp-word');
    if (inp) { inp.value = word; onWordInput(); }
    if (btn) { btn.style.background = 'var(--primary-light)'; }
  };
  rec.onerror = () => {
    showToast('Ошибка микрофона');
    if (btn) { btn.style.background = 'var(--primary-light)'; }
  };
  rec.onend = () => {
    if (btn) { btn.style.background = 'var(--primary-light)'; btn.querySelector('span').textContent = 'mic'; }
  };
}

// ========== DEEPSEEK ASSOCIATION ==========
async function requestDeepSeekAssociation() {
  const word = document.getElementById('inp-word')?.value.trim();
  const phonetic = document.getElementById('inp-phonetic')?.value.trim();
  const translation = document.getElementById('inp-translation')?.value.trim();
  if (!word) { showToast('Введите слово'); return; }
  if (!getDeepSeekKey()) { openDeepSeekSettings(); return; }

  const btn = document.getElementById('deepseek-assoc-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner" style="width:16px;height:16px;border-width:2px;margin:0 auto;"></div>'; }

  const result = await deepseekGetAssociation(word, phonetic || '', translation || '');

  if (btn) { btn.disabled = false; btn.innerHTML = '<span class="material-icons-round">psychology</span> Предложить снова'; }

  if (!result) { 
    showToast('⚠️ ' + (window.lastDeepSeekError || 'DeepSeek не ответил. Проверьте API ключ.')); 
    return; 
  }

  deepseekAssociation = result;
  const assocTA = document.getElementById('inp-association');
  if (assocTA) assocTA.value = result.association || '';

  // Show image prompt hint
  const hint = document.getElementById('img-hint');
  if (hint && result.imagePrompt) hint.textContent = '💡 ' + result.imagePrompt.slice(0, 80) + '…';

  showToast('✅ Ассоциация от DeepSeek готова!');
}

// ========== DEEPSEEK SETTINGS MODAL ==========
function openDeepSeekSettings() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(45,52,44,0.5);z-index:400;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML = `
    <div style="background:var(--surface);border-radius:var(--radius-lg);padding:24px;width:100%;max-width:380px;">
      <div class="title" style="margin-bottom:8px;">🔑 DeepSeek API ключ <span style="font-size:10px;opacity:0.5;float:right;">v1.3</span></div>
      <div class="body-sm" style="margin-bottom:16px;">Получите ключ на <a href="https://platform.deepseek.com/" target="_blank" style="color:var(--secondary);">platform.deepseek.com</a></div>
      <input id="deepseek-key-input" class="input" type="password" placeholder="sk-..."
        value="${getDeepSeekKey()}" style="margin-bottom:12px;">
      <div id="deepseek-test-status" class="body-sm" style="margin-bottom:16px;min-height:20px;"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <button class="btn btn-secondary" onclick="this.closest('div[style]').remove()">Отмена</button>
        <button id="btn-save-deepseek" class="btn btn-primary" onclick="
          const v = document.getElementById('deepseek-key-input').value.trim();
          if(!v) { showToast('Введите ключ'); return; }
          saveDeepSeekKey(v);
          this.textContent = 'Проверяю...';
          this.disabled = true;
          callDeepSeek('test').then(res => {
            if(res) {
              showToast('✅ Ключ работает!');
              this.closest('div[style]').remove();
              renderAddWord();
            } else {
              document.getElementById('deepseek-test-status').innerHTML = '<span style=&quot;color:var(--error)&quot;>❌ ' + (window.lastDeepSeekError || 'Ошибка') + '</span>';
              this.textContent = 'Сохранить';
              this.disabled = false;
            }
          });
        ">Сохранить</button>
      </div>
    </div>
  `;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

let autoLookupTimer = null;
function onWordInput() {
  clearTimeout(autoLookupTimer);
  const word = document.getElementById('inp-word').value.trim();
  if (!word) return;
  // Debounce: trigger after 800ms of no typing
  autoLookupTimer = setTimeout(() => fetchWordInfo(word), 800);
}

async function fetchWordInfo(word) {
  // --- Phonetic ---
  const phSpinner = document.getElementById('phonetic-spinner');
  const phInput = document.getElementById('inp-phonetic');
  if (phSpinner) phSpinner.style.display = 'block';

  // --- Translation ---
  const trSpinner = document.getElementById('translate-spinner');
  if (trSpinner) trSpinner.style.display = 'block';

  const [variants, phonetic] = await Promise.all([
    autoTranslate(word),
    autoPhonetic(word)
  ]);

  if (phSpinner) phSpinner.style.display = 'none';
  if (trSpinner) trSpinner.style.display = 'none';

  // Render phonetic
  if (phInput) {
    phInput.value = phonetic || '';
    phInput.placeholder = phonetic ? '' : '/транскрипция не найдена/';
  }

  // Render translation variants as chips
  const variantsDiv = document.getElementById('translation-variants');
  const trInput = document.getElementById('inp-translation');
  if (variantsDiv && variants.length > 0) {
    variantsDiv.innerHTML = variants.map(v =>
      `<button class="translation-chip" onclick="selectTranslation(this,'${v.replace(/'/g,"\\'")}')">` +
      `${v}</button>`
    ).join('');
    // Auto-select first variant
    if (trInput && !trInput.value) {
      trInput.value = variants[0];
      variantsDiv.querySelectorAll('.translation-chip')[0]?.classList.add('active');
    }
  } else if (variantsDiv) {
    variantsDiv.innerHTML = '<span class="body-sm" style="color:var(--outline);">Вариантов не найдено — введите вручную</span>';
  }
}

function selectTranslation(btn, value) {
  document.querySelectorAll('.translation-chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const inp = document.getElementById('inp-translation');
  if (inp) inp.value = value;
}

async function handleGenerateImageNew() {
  const word = document.getElementById('inp-word')?.value.trim();
  if (!word) { showToast('Введите слово'); return; }
  // Prefer DeepSeek imagePrompt if available, else use association text or word
  const assoc = document.getElementById('inp-association')?.value.trim();
  const prompt = (deepseekAssociation?.imagePrompt) || assoc || word;
  pendingImageWord = null;
  await handleGenerateImage('__new__', prompt);
}

function saveNewWord() {
  const word = document.getElementById('inp-word').value.trim();
  const phonetic = document.getElementById('inp-phonetic').value.trim();
  const translation = document.getElementById('inp-translation').value.trim();
  const association = document.getElementById('inp-association').value.trim();
  if (!word) { showToast('Введите слово'); return; }
  if (!translation) { showToast('Дождитесь перевода или введите вручную'); return; }

  const img = document.querySelector('#assoc-image-wrap img');
  // Capitalize word
  const wordCap = word.charAt(0).toUpperCase() + word.slice(1);
  const entry = {
    id: uid(),
    word: wordCap,
    phonetic: phonetic || '',
    translation,
    association,
    image: img ? img.src : null,
    mastery: 0,
    nextReview: Date.now(),
    reviews: 0
  };
  words.unshift(entry);
  saveWords();

  const done = parseInt(localStorage.getItem('todayDone') || '0') + 1;
  localStorage.setItem('todayDone', done);

  showToast('✅ Слово «' + wordCap + '» сохранено!');
  setTimeout(() => navigate('dashboard'), 900);
}

// ========== PRACTICE ==========
function renderPractice() {
  const el = document.getElementById('screen-practice');
  const due = dueWords();

  if (due.length === 0 && words.length === 0) {
    el.innerHTML = `<div class="empty-state"><span class="material-icons-round empty-icon">style</span><div class="headline">Нет слов</div><div class="body-sm">Добавьте первое слово в «Добавить»</div></div>`;
    return;
  }
  if (due.length === 0) {
    el.innerHTML = `<div class="empty-state"><span class="material-icons-round empty-icon" style="color:var(--primary);">emoji_events</span><div class="headline">Всё повторено!</div><div class="body-sm">Возвращайтесь завтра</div><button class="btn btn-primary" style="margin-top:16px;" onclick="startFreePlay()"><span class="material-icons-round">shuffle</span> Свободная практика</button></div>`;
    return;
  }

  practiceSession = [...due].sort(() => Math.random() - 0.5);
  practiceIndex = 0;
  renderPracticeCard();
}

function startFreePlay() {
  practiceSession = [...words].sort(() => Math.random() - 0.5);
  practiceIndex = 0;
  renderPracticeCard();
}

function renderPracticeCard() {
  const el = document.getElementById('screen-practice');
  if (practiceIndex >= practiceSession.length) {
    el.innerHTML = `
      <div class="empty-state">
        <div style="font-size:64px;">🏆</div>
        <div class="headline">Сессия завершена!</div>
        <div class="body-sm">Повторено слов: ${practiceSession.length}</div>
        <button class="btn btn-primary" style="margin-top:16px;" onclick="navigate('dashboard')">На главную</button>
      </div>`;
    return;
  }

  const w = practiceSession[practiceIndex];
  cardFlipped = false;
  const progress = Math.round((practiceIndex / practiceSession.length) * 100);

  // Generate wrong choices
  const allTranslations = words.map(x => x.translation).filter(t => t !== w.translation);
  const shuffle = arr => arr.sort(() => Math.random() - 0.5);
  const wrongChoices = shuffle(allTranslations).slice(0, 3);
  const choices = shuffle([w.translation, ...wrongChoices]);

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <div class="label">${practiceIndex + 1} / ${practiceSession.length}</div>
      <div class="mastery-dot mastery-${w.mastery}" style="width:14px;height:14px;"></div>
    </div>
    <div class="progress-track" style="margin-bottom:20px;">
      <div class="progress-fill" style="width:${progress}%;"></div>
    </div>

    <div class="flashcard-wrap" style="margin-bottom:20px;">
      <div class="flashcard" id="flashcard" onclick="flipCard()" style="min-height:${w.image ? '380px' : '260px'};">
        <div class="card-face card-front" style="min-height:${w.image ? '380px' : '260px'};">
          ${w.image ? `<img src="${w.image}" style="width:calc(100% + 48px);margin:-32px -24px 16px;height:160px;object-fit:cover;border-radius:var(--radius-lg) var(--radius-lg) 0 0;">` : ''}
          <div class="display" style="${w.image ? 'font-size:32px;' : ''}">${w.word}</div>
          <div class="phonetic" style="color:rgba(255,255,255,0.8);">${w.phonetic}</div>
          <div class="card-hint" style="margin-top:16px;">Нажмите для подсказки</div>
        </div>
        <div class="card-face card-back" style="min-height:${w.image ? '380px' : '260px'};">
          ${w.image ? `<img src="${w.image}" style="width:calc(100% + 48px);margin:-32px -24px 16px;height:160px;object-fit:cover;border-radius:var(--radius-lg) var(--radius-lg) 0 0;">` : ''}
          <div class="title" style="margin-bottom:8px;">💡 Ассоциация</div>
          <div class="body-lg" style="font-style:italic;color:var(--on-surface-variant);margin-bottom:8px;">${w.association || 'Нет ассоциации'}</div>
          <div style="font-size:13px;color:var(--secondary);font-weight:500;">${w.translation}</div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <div class="label" style="margin-bottom:10px;">Выберите перевод</div>
      <div class="choices" id="choices">
        ${choices.map((c, i) => `<button class="choice-btn" id="choice-${i}" onclick="checkChoice(this,'${escQ(c)}','${escQ(w.translation)}','${w.id}')">${c}</button>`).join('')}
      </div>
    </div>
  `;
}

function escQ(s) { return s.replace(/'/g, "\\'"); }

function flipCard() {
  cardFlipped = !cardFlipped;
  document.getElementById('flashcard').classList.toggle('flipped', cardFlipped);
}

function checkChoice(btn, chosen, correct, wordId) {
  document.querySelectorAll('.choice-btn').forEach(b => b.disabled = true);
  if (chosen === correct) {
    btn.classList.add('correct');
    showToast('✅ Правильно!');
    updateMastery(wordId, true);
    setTimeout(() => { practiceIndex++; renderPracticeCard(); }, 1200);
  } else {
    btn.classList.add('wrong');
    document.querySelectorAll('.choice-btn').forEach(b => { if (b.textContent === correct) b.classList.add('correct'); });
    updateMastery(wordId, false);
    setTimeout(() => { practiceIndex++; renderPracticeCard(); }, 1800);
  }
}

function updateMastery(wordId, correct) {
  const w = words.find(x => x.id === wordId);
  if (!w) return;
  w.reviews++;
  if (correct) {
    w.mastery = Math.min(3, w.mastery + 1);
    const intervals = [1, 3, 7, 14];
    const days = intervals[Math.min(w.mastery, intervals.length - 1)];
    w.nextReview = Date.now() + days * 86400000;
  } else {
    w.mastery = Math.max(0, w.mastery - 1);
    w.nextReview = Date.now() + 3600000;
  }
  saveWords();
}

// ========== LIBRARY ==========
function renderLibrary() {
  const el = document.getElementById('screen-library');
  if (words.length === 0) {
    el.innerHTML = `<div class="empty-state"><span class="material-icons-round empty-icon">menu_book</span><div class="headline">Библиотека пуста</div><div class="body-sm">Добавьте первое слово</div></div>`;
    return;
  }
  const masteryLabels = ['Новое', 'Учу', 'Знакомо', 'Освоено'];
  const sorted = [...words].sort((a, b) => a.mastery - b.mastery);
  el.innerHTML = `
    <div style="margin-bottom:20px;">
      <div class="headline">Библиотека</div>
      <div class="body-sm">${words.length} слов</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:20px;">
      ${[0,1,2,3].map(m => `
        <div class="card" style="padding:12px;text-align:center;">
          <div class="mastery-dot mastery-${m}" style="width:12px;height:12px;margin:0 auto 6px;"></div>
          <div style="font-size:20px;font-weight:700;font-family:var(--font-display);color:var(--on-surface);">${words.filter(w=>w.mastery===m).length}</div>
          <div style="font-size:10px;color:var(--on-surface-variant);font-weight:600;">${masteryLabels[m]}</div>
        </div>
      `).join('')}
    </div>
    ${sorted.map(w => `
      <div class="word-chip" onclick="openWordDetail('${w.id}')">
        ${w.image ? `<img class="word-chip-img" src="${w.image}" alt="${w.word}">` : `<div class="word-chip-img" style="display:flex;align-items:center;justify-content:center;background:var(--surface-container);"><span class="material-icons-round" style="color:var(--outline-variant);font-size:20px;">image</span></div>`}
        <div style="flex:1;">
          <div class="word-chip-word">${w.word}</div>
          <div class="word-chip-meta">${w.phonetic} · ${w.translation}</div>
          <div style="font-size:11px;color:var(--tertiary);margin-top:2px;font-weight:600;">${masteryLabels[w.mastery]} · ${w.reviews} повторений</div>
        </div>
        <div class="mastery-dot mastery-${w.mastery}"></div>
      </div>
    `).join('')}
  `;
}

// ========== WORD DETAIL ==========
function openWordDetail(wordId) {
  const w = words.find(x => x.id === wordId);
  if (!w) return;

  const overlay = document.createElement('div');
  overlay.id = 'word-detail-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(45,52,44,0.5);z-index:300;display:flex;align-items:flex-end;animation:fadeIn 0.2s ease;';

  const panel = document.createElement('div');
  panel.style.cssText = 'background:var(--surface);border-radius:28px 28px 0 0;width:100%;max-height:85vh;overflow-y:auto;padding:24px 20px 40px;animation:slideUp 0.3s cubic-bezier(0.4,0,0.2,1);';

  const style = document.createElement('style');
  style.textContent = '@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}';
  document.head.appendChild(style);

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;">
      <div>
        <div class="display" style="font-size:36px;">${w.word}</div>
        <div class="phonetic">${w.phonetic}</div>
      </div>
      <button class="btn-icon btn" onclick="document.getElementById('word-detail-overlay').remove()">
        <span class="material-icons-round">close</span>
      </button>
    </div>

    <div class="card" style="margin-bottom:12px;">
      <div class="label" style="margin-bottom:6px;">Перевод</div>
      <div class="body-lg">${w.translation}</div>
    </div>

    ${w.association ? `
    <div class="card" style="margin-bottom:12px;">
      <div class="label" style="margin-bottom:6px;">💡 Ассоциация</div>
      <div class="body-lg" style="font-style:italic;">${w.association}</div>
    </div>
    ` : ''}

    <div class="card" style="margin-bottom:16px;">
      <div class="section-header">
        <span class="label">Визуальный образ</span>
        <span class="body-sm">Pollinations.ai</span>
      </div>
      <div class="assoc-image-wrap" id="detail-image-wrap" style="aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:var(--surface-container);display:flex;align-items:center;justify-content:center;margin-bottom:12px;">
        ${w.image ? `<img src="${w.image}" style="width:100%;height:100%;object-fit:cover;" alt="${w.word}">` : `<div class="assoc-image-placeholder"><span class="material-icons-round">image</span><div class="body-sm">Нет изображения</div></div>`}
      </div>
      <button id="gen-img-btn" class="btn btn-secondary" onclick="handleDetailGenerateImage('${w.id}','${escQ(w.association || w.word)}')">
        <span class="material-icons-round">auto_awesome</span> ${w.image ? 'Перегенерировать' : 'Сгенерировать образ'}
      </button>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
      <button class="btn btn-secondary" onclick="deleteWord('${w.id}')">
        <span class="material-icons-round">delete_outline</span> Удалить
      </button>
      <button class="btn btn-primary" onclick="document.getElementById('word-detail-overlay').remove();navigate('practice')">
        <span class="material-icons-round">play_arrow</span> Практика
      </button>
    </div>
  `;

  overlay.appendChild(panel);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

async function handleDetailGenerateImage(wordId, prompt) {
  const btn = document.getElementById('gen-img-btn');
  const wrap = document.getElementById('detail-image-wrap');
  if (!wrap) return;
  if (btn) btn.disabled = true;
  wrap.innerHTML = `<div class="image-loading"><div class="spinner"></div><div class="body-sm">Генерирую образ…</div></div>`;

  const encoded = encodeURIComponent((prompt || wordId) + ', mnemonic illustration, watercolor, vivid, soft lighting');
  const url = `https://image.pollinations.ai/prompt/${encoded}?width=512&height=288&nologo=true&seed=${Math.floor(Math.random()*9999)}`;

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    wrap.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;" alt="association">`;
    const w = words.find(x => x.id === wordId);
    if (w) { w.image = url; saveWords(); }
    if (btn) btn.disabled = false;
  };
  img.onerror = () => {
    wrap.innerHTML = `<div class="assoc-image-placeholder"><span class="material-icons-round">broken_image</span><div class="body-sm">Ошибка загрузки</div></div>`;
    if (btn) btn.disabled = false;
    showToast('⚠️ Не удалось загрузить изображение');
  };
  img.src = url;
}

function deleteWord(wordId) {
  if (!confirm('Удалить это слово?')) return;
  words = words.filter(w => w.id !== wordId);
  saveWords();
  document.getElementById('word-detail-overlay')?.remove();
  showToast('🗑️ Слово удалено');
  renderScreen(currentScreen);
}

// ========== INIT ==========
renderDashboard();
