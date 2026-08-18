import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';

const $ = (selector) => document.querySelector(selector);
const state = { documents: [], operations: [] };
const MAX_FILE_SIZE = 15 * 1024 * 1024;
const HORIZON_DAYS = 30;
let toastTimer;

const el = {
  fileInput: $('#file-input'),
  chooseFiles: $('#choose-files'),
  dropzone: $('#dropzone'),
  alert: $('#recognition-alert'),
  ocrStatus: $('#ocr-status'),
  ocrPercent: $('#ocr-percent'),
  ocrProgress: $('#ocr-progress'),
  statusUpload: $('#status-upload'),
  statusOcr: $('#status-ocr'),
  statusFields: $('#status-fields'),
  documentList: $('#document-list'),
  documentCounter: $('#document-counter'),
  clearDocuments: $('#clear-documents'),
  heroDocCount: $('#hero-doc-count'),
  heroOperationCount: $('#hero-operation-count'),
  openingBalance: $('#opening-balance'),
  reserveBalance: $('#reserve-balance'),
  forecastStats: $('#forecast-stats'),
  chart: $('#forecast-chart'),
  chartCaption: $('#chart-caption'),
  recommendations: $('#recommendations'),
  operationForm: $('#operation-form'),
  operationDirection: $('#operation-direction'),
  operationDate: $('#operation-date'),
  operationAmount: $('#operation-amount'),
  operationProbability: $('#operation-probability'),
  operationCounterparty: $('#operation-counterparty'),
  operationNote: $('#operation-note'),
  operationMessage: $('#operation-form-message'),
  operationTableBody: $('#operation-table-body'),
  clearOperations: $('#clear-operations'),
  csvInput: $('#csv-input'),
  chooseCsv: $('#choose-csv'),
  downloadTemplate: $('#download-csv-template'),
  importFeedback: $('#import-feedback'),
  downloadJson: $('#download-json'),
  toast: $('#toast')
};

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function dateKey(date) {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
}

function localToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function formatDate(value) {
  const date = parseFlexibleDate(value);
  return date ? new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date) : 'Не указана';
}

function formatShortDate(value) {
  const date = parseFlexibleDate(value);
  return date ? new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short' }).format(date).replace('.', '') : '—';
}

function formatRub(value, signed = false) {
  const numeric = Number(value) || 0;
  const absolute = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Math.abs(numeric));
  const sign = signed && numeric !== 0 ? (numeric > 0 ? '+' : '−') : (numeric < 0 ? '−' : '');
  return `${sign}${absolute} ₽`;
}

function parseAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  const cleaned = String(value ?? '')
    .replace(/[₽Рр][Уу][Бб]?\.?/g, '')
    .replace(/\s/g, '')
    .replace(/[^0-9,.-]/g, '')
    .replace(',', '.');
  if (!cleaned || cleaned === '-' || cleaned === '.') return NaN;
  return Number(cleaned);
}

function parseFlexibleDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const string = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(string)) {
    const [year, month, day] = string.split('-').map(Number);
    const result = new Date(year, month - 1, day);
    return result.getFullYear() === year && result.getMonth() === month - 1 && result.getDate() === day ? result : null;
  }
  const match = string.match(/\b(0?[1-9]|[12]\d|3[01])[.\/-](0?[1-9]|1[0-2])[.\/-](20\d{2}|19\d{2})\b/);
  if (!match) return null;
  const [, day, month, year] = match.map(Number);
  const result = new Date(year, month - 1, day);
  return result.getFullYear() === year && result.getMonth() === month - 1 && result.getDate() === day ? result : null;
}

function toInputDate(value) {
  const date = parseFlexibleDate(value) || localToday();
  return dateKey(date);
}

function setStatus(step, percent, text) {
  el.ocrStatus.textContent = text;
  el.ocrPercent.textContent = `${Math.max(0, Math.min(100, Math.round(percent)))}%`;
  el.ocrProgress.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  const steps = [el.statusUpload, el.statusOcr, el.statusFields];
  steps.forEach((node, index) => {
    node.classList.remove('done', 'active');
    if (index < step) node.classList.add('done');
    if (index === step) node.classList.add('active');
  });
}

function resetStatus() {
  setStatus(0, 0, 'Ожидание документов');
  [el.statusUpload, el.statusOcr, el.statusFields].forEach((node, index) => { node.textContent = String(index + 1); node.classList.remove('done', 'active'); });
}

function showAlert(message) {
  el.alert.textContent = message;
  el.alert.classList.remove('hidden');
}

function hideAlert() {
  el.alert.classList.add('hidden');
  el.alert.textContent = '';
}

function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  el.toast.textContent = message;
  el.toast.classList.toggle('error', isError);
  el.toast.classList.add('visible');
  toastTimer = setTimeout(() => el.toast.classList.remove('visible'), 4200);
}

function normalizeText(text) {
  return String(text ?? '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function findFirst(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return String(match[1]).trim();
  }
  return '';
}

function classifyDocument(text) {
  const source = text.toLowerCase();
  if (/универсальн\w*\s+передаточн\w*\s+документ|\bупд\b/i.test(source)) return 'УПД';
  if (/сч[её]т[\s-]*фактур/i.test(source)) return 'Счёт-фактура';
  if (/плат[её]жн\w*\s+поручен/i.test(source)) return 'Платёжное поручение';
  if (/товарн\w*\s+накладн|\bторг[\s-]?12\b/i.test(source)) return 'Накладная';
  if (/акт\s+(?:выполн|оказан|при[её]м|сдач)/i.test(source)) return 'Акт';
  if (/сч[её]т\s+(?:на\s+оплату|№|n|no)/i.test(source)) return 'Счёт';
  if (/кассов\w*\s+(?:чек|ордер)/i.test(source)) return 'Кассовый документ';
  return 'Не определён';
}

function normalizeInn(value) {
  const digits = String(value).replace(/\D/g, '');
  return digits.length === 10 || digits.length === 12 ? digits : '';
}

function extractFields(rawText, ocrConfidence) {
  const text = normalizeText(rawText);
  const type = classifyDocument(text);
  const dateMatch = findFirst(text, [
    /(?:дата|от)\s*[:№]?\s*(\d{1,2}[.\/-]\d{1,2}[.\/-](?:19|20)\d{2})/i,
    /\b(\d{1,2}[.\/-]\d{1,2}[.\/-](?:19|20)\d{2})\b/
  ]);
  const docNumber = findFirst(text, [
    /(?:сч[её]т(?:[\s-]*фактур\w*)?|акт|упд|накладн\w*|плат[её]жн\w*\s+поручен\w*|кассов\w*\s+(?:чек|ордер))\s*(?:№|n\.?|no\.?)\s*([A-ZА-ЯЁ0-9][A-ZА-ЯЁ0-9_./-]{0,30})/i,
    /(?:№|n\.?|no\.?)\s*([A-ZА-ЯЁ0-9][A-ZА-ЯЁ0-9_./-]{0,30})/i
  ]);
  const inn = normalizeInn(findFirst(text, [/(?:инн|иhн)\s*[:№]?\s*([0-9\s]{10,16})/i]));
  const amountText = findFirst(text, [
    /(?:итого\s*(?:к\s*оплате)?|всего\s*(?:к\s*оплате)?|сумма\s*(?:к\s*оплате)?|к\s*оплате)\s*[:—–-]?\s*([0-9][0-9\s]{0,16}(?:[,.]\d{1,2})?)/i,
    /\b([0-9]{1,3}(?:\s[0-9]{3})+(?:[,.]\d{1,2})?)\s*(?:руб\.?|₽)/i
  ]);
  const vatText = findFirst(text, [
    /ндс(?:\s*\(?\s*\d{1,2}\s*%\s*\)?)?\s*[:—–-]?\s*([0-9][0-9\s]{0,16}(?:[,.]\d{1,2})?)/i
  ]);
  let counterparty = findFirst(text, [
    /(?:поставщик|продавец|исполнитель|получатель|заказчик|плательщик)\s*[:—–-]?\s*([^\n]{3,110})/i
  ]).replace(/\s+инн\s*\d{10,12}.*/i, '').trim();
  if (counterparty.length > 100) counterparty = counterparty.slice(0, 100).trim();

  const amount = parseAmount(amountText);
  const vat = parseAmount(vatText);
  const found = [dateMatch, docNumber, inn, Number.isFinite(amount), Number.isFinite(vat), counterparty].filter(Boolean).length;
  const quality = Math.max(0, Math.min(100, Math.round((Number(ocrConfidence) || 0) * 0.68 + (found / 6) * 32)));

  return {
    type,
    number: docNumber,
    date: dateMatch ? toInputDate(dateMatch) : '',
    inn,
    amount: Number.isFinite(amount) ? amount : '',
    vat: Number.isFinite(vat) ? vat : '',
    counterparty,
    quality
  };
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Не удалось прочитать файл.'));
    reader.readAsDataURL(file);
  });
}

async function extractPdfContent(file) {
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pagesToProcess = Math.min(pdf.numPages, 5);
  const results = [];
  for (let pageNumber = 1; pageNumber <= pagesToProcess; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const layerText = textContent.items.map((item) => item.str).join(' ').trim();
    if (layerText.length >= 35) {
      results.push({ text: layerText, confidence: 100 });
      continue;
    }
    const viewport = page.getViewport({ scale: 1.8 });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: false });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: context, viewport }).promise;
    results.push({ image: canvas.toDataURL('image/png') });
  }
  return { pages: results, truncated: pdf.numPages > pagesToProcess, pageCount: pdf.numPages };
}

async function recognizeImage(image, progressBase, progressSpan) {
  if (!window.Tesseract) throw new Error('Библиотека OCR не загрузилась. Проверьте подключение к интернету и повторите попытку.');
  const worker = await window.Tesseract.createWorker('rus+eng', 1, {
    logger: (message) => {
      if (message.status === 'recognizing text' && Number.isFinite(message.progress)) {
        const current = progressBase + message.progress * progressSpan;
        setStatus(1, current, 'Распознаём русскоязычный текст');
      }
    }
  });
  try {
    const result = await worker.recognize(image);
    return { text: result.data.text, confidence: result.data.confidence ?? 0 };
  } finally {
    await worker.terminate();
  }
}

async function processFile(file, index, total) {
  if (file.size > MAX_FILE_SIZE) throw new Error(`${file.name}: размер превышает 15 МБ.`);
  setStatus(0, (index / total) * 100, `Принимаем файл ${index + 1} из ${total}`);
  el.statusUpload.textContent = '✓';

  let rawText = '';
  let ocrConfidence = 0;
  let pageNote = '';
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const pdfContent = await extractPdfContent(file);
    const recognized = [];
    for (let pageIndex = 0; pageIndex < pdfContent.pages.length; pageIndex += 1) {
      const page = pdfContent.pages[pageIndex];
      if (page.text) {
        recognized.push(page);
        setStatus(1, ((index + (pageIndex + 1) / pdfContent.pages.length) / total) * 100, `Извлекаем текстовый слой PDF: страница ${pageIndex + 1}`);
      } else {
        const result = await recognizeImage(page.image, ((index + pageIndex / pdfContent.pages.length) / total) * 100, (1 / total / pdfContent.pages.length) * 100);
        recognized.push(result);
      }
    }
    rawText = recognized.map((page, pageIndex) => `— Страница ${pageIndex + 1} —\n${page.text}`).join('\n\n');
    ocrConfidence = Math.round(recognized.reduce((sum, page) => sum + (page.confidence ?? 0), 0) / Math.max(recognized.length, 1));
    if (pdfContent.truncated) pageNote = ` Обработаны первые 5 из ${pdfContent.pageCount} страниц.`;
  } else {
    const image = await fileToDataUrl(file);
    const result = await recognizeImage(image, (index / total) * 100, (1 / total) * 100);
    rawText = result.text;
    ocrConfidence = Math.round(result.confidence ?? 0);
  }

  setStatus(2, ((index + 0.93) / total) * 100, 'Выделяем реквизиты и оцениваем уверенность');
  const fields = extractFields(rawText, ocrConfidence);
  state.documents.unshift({ id: uid('doc'), fileName: file.name, rawText: normalizeText(rawText), ocrConfidence, pageNote, ...fields });
  setStatus(3, ((index + 1) / total) * 100, `Готово: ${file.name}`);
}

async function processFiles(files) {
  const validFiles = [...files].filter(Boolean);
  if (!validFiles.length) return;
  hideAlert();
  el.chooseFiles.disabled = true;
  el.dropzone.setAttribute('aria-busy', 'true');
  let failed = 0;
  for (let index = 0; index < validFiles.length; index += 1) {
    try {
      await processFile(validFiles[index], index, validFiles.length);
    } catch (error) {
      failed += 1;
      showAlert(error.message || `Не удалось распознать ${validFiles[index].name}.`);
      console.error(error);
    }
  }
  renderDocuments();
  el.chooseFiles.disabled = false;
  el.dropzone.removeAttribute('aria-busy');
  if (!failed) showToast(`Распознано документов: ${validFiles.length}. Проверьте выделенные реквизиты.`);
  else showToast(`Готово с ошибками: распознано ${validFiles.length - failed} из ${validFiles.length}.`, true);
  setTimeout(resetStatus, 750);
}

function qualityClass(value) {
  if (value >= 80) return 'good';
  if (value >= 55) return 'medium';
  return 'low';
}

function inputValue(value) {
  return value === 0 ? '0' : (value ?? '');
}

function renderDocuments() {
  el.documentCounter.textContent = `${state.documents.length} ${pluralize(state.documents.length, 'документ', 'документа', 'документов')}`;
  el.heroDocCount.textContent = String(state.documents.length);
  el.clearDocuments.disabled = state.documents.length === 0;
  if (!state.documents.length) {
    el.documentList.innerHTML = `<div class="empty-state" id="documents-empty"><div class="empty-icon" aria-hidden="true">▤</div><h3>Реестр пока пуст</h3><p>После распознавания здесь появятся тип документа, номер, дата, ИНН, сумма, НДС и исходный текст для проверки.</p></div>`;
    return;
  }
  el.documentList.innerHTML = state.documents.map((doc) => {
    const confidenceClass = qualityClass(doc.quality);
    return `<details class="document-card" data-doc-id="${doc.id}" open>
      <summary>
        <div class="document-title"><span class="doc-type">${escapeHtml(doc.type)}</span><span class="doc-name">${escapeHtml(doc.fileName)}</span></div>
        <div class="doc-summary"><span>${doc.amount !== '' ? formatRub(doc.amount) : 'Сумма не найдена'}</span><span class="confidence ${confidenceClass}">${doc.quality}% уверенность</span></div>
      </summary>
      <div class="document-body">
        <div class="field-grid">
          <label>Тип документа<input data-field="type" value="${escapeHtml(doc.type)}" /></label>
          <label>Номер<input data-field="number" value="${escapeHtml(doc.number)}" placeholder="Не найден" /></label>
          <label>Дата<input data-field="date" type="date" value="${escapeHtml(doc.date)}" /></label>
          <label>ИНН контрагента<input data-field="inn" inputmode="numeric" value="${escapeHtml(doc.inn)}" placeholder="10 или 12 цифр" /></label>
          <label>Сумма, ₽<input data-field="amount" inputmode="decimal" value="${escapeHtml(inputValue(doc.amount))}" placeholder="Не найдена" /></label>
          <label>НДС, ₽<input data-field="vat" inputmode="decimal" value="${escapeHtml(inputValue(doc.vat))}" placeholder="Не выделен" /></label>
          <label style="grid-column: span 3">Контрагент<input data-field="counterparty" value="${escapeHtml(doc.counterparty)}" placeholder="Не найден" /></label>
        </div>
        ${doc.pageNote ? `<p class="privacy-callout">${escapeHtml(doc.pageNote)}</p>` : ''}
        <details class="raw-text-box"><summary>Показать исходный распознанный текст</summary><pre class="raw-text">${escapeHtml(doc.rawText || 'Текст не извлечён')}</pre></details>
        <div class="document-actions"><button class="button button-secondary" data-action="to-plan" type="button">Внести в кассовый план</button><button class="text-button danger" data-action="delete" type="button">Удалить из реестра</button></div>
      </div>
    </details>`;
  }).join('');
}

function pluralize(value, one, few, many) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function addDocumentToPlan(doc) {
  el.operationAmount.value = doc.amount === '' ? '' : String(doc.amount);
  el.operationDate.value = doc.date || dateKey(localToday());
  el.operationCounterparty.value = doc.counterparty || doc.inn || '';
  el.operationNote.value = [doc.type, doc.number ? `№ ${doc.number}` : '', doc.fileName].filter(Boolean).join(' · ');
  el.operationDirection.value = doc.type === 'Платёжное поручение' || doc.type === 'Кассовый документ' ? 'expense' : 'income';
  el.operationProbability.value = '100';
  $('#forecast').scrollIntoView({ behavior: 'smooth', block: 'start' });
  setTimeout(() => el.operationAmount.focus(), 500);
  showToast('Реквизиты перенесены в форму. Проверьте направление, дату и сумму перед добавлением.');
}

function expectedAmount(operation) {
  return operation.amount * (operation.probability / 100);
}

function getForecast() {
  const opening = parseAmount(el.openingBalance.value);
  const reserve = parseAmount(el.reserveBalance.value);
  const openingBalance = Number.isFinite(opening) ? opening : 0;
  const reserveBalance = Number.isFinite(reserve) ? reserve : 0;
  const today = localToday();
  const days = Array.from({ length: HORIZON_DAYS }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + index);
    return { date, key: dateKey(date), incomes: 0, expenses: 0, balance: openingBalance, isGap: false };
  });
  const lookup = new Map(days.map((day) => [day.key, day]));
  for (const operation of state.operations) {
    const day = lookup.get(operation.date);
    if (!day) continue;
    if (operation.direction === 'income') day.incomes += expectedAmount(operation);
    else day.expenses += expectedAmount(operation);
  }
  let balance = openingBalance;
  for (const day of days) {
    balance += day.incomes - day.expenses;
    day.balance = balance;
    day.isGap = balance < reserveBalance;
  }
  const minDay = days.reduce((current, day) => day.balance < current.balance ? day : current, days[0]);
  const firstGap = days.find((day) => day.isGap);
  return {
    days,
    openingBalance,
    reserveBalance,
    minDay,
    firstGap,
    finalBalance: days.at(-1).balance,
    totalIncome: days.reduce((sum, day) => sum + day.incomes, 0),
    totalExpense: days.reduce((sum, day) => sum + day.expenses, 0)
  };
}

function renderStats(forecast) {
  const need = Math.max(0, forecast.reserveBalance - forecast.minDay.balance);
  const hasGap = Boolean(forecast.firstGap);
  const cards = [
    { label: 'Остаток на 30-й день', value: formatRub(forecast.finalBalance, true), subtext: `Поступления ${formatRub(forecast.totalIncome)} · списания ${formatRub(forecast.totalExpense)}` },
    { label: 'Минимальный остаток', value: formatRub(forecast.minDay.balance, true), subtext: formatShortDate(forecast.minDay.date) },
    { label: hasGap ? 'Первый дефицит' : 'Статус резерва', value: hasGap ? formatShortDate(forecast.firstGap.date) : 'Резерв соблюдён', subtext: hasGap ? `Остаток ${formatRub(forecast.firstGap.balance)}` : `Резерв ${formatRub(forecast.reserveBalance)}`, className: hasGap ? 'warning' : '' },
    { label: 'Максимальная потребность', value: formatRub(need), subtext: hasGap ? 'Чтобы восстановить резерв в минимумe' : 'Пополнение не требуется', className: hasGap ? 'danger' : '' }
  ];
  el.forecastStats.innerHTML = cards.map((card) => `<div class="stat-card ${card.className || ''}"><span class="stat-label">${card.label}</span><span class="stat-value">${card.value}</span><span class="stat-subtext">${card.subtext}</span></div>`).join('');
}

function renderChart(forecast) {
  const { days, reserveBalance } = forecast;
  const hasOperations = state.operations.some((operation) => days.some((day) => day.key === operation.date));
  el.chartCaption.textContent = hasOperations ? `Горизонт: ${formatShortDate(days[0].date)} — ${formatShortDate(days.at(-1).date)} · резерв: ${formatRub(reserveBalance)}` : 'Добавьте операции для расчёта динамики.';
  const width = 780;
  const height = 205;
  const padding = { left: 66, right: 16, top: 18, bottom: 31 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const values = [...days.map((day) => day.balance), reserveBalance, 0];
  let min = Math.min(...values);
  let max = Math.max(...values);
  const range = Math.max(max - min, 1);
  min -= range * 0.14;
  max += range * 0.14;
  const scaledRange = max - min;
  const x = (index) => padding.left + (index / (days.length - 1)) * innerWidth;
  const y = (value) => padding.top + ((max - value) / scaledRange) * innerHeight;
  const points = days.map((day, index) => `${x(index).toFixed(1)},${y(day.balance).toFixed(1)}`).join(' ');
  const areaPoints = `${padding.left},${y(min)} ${points} ${x(days.length - 1)},${y(min)}`;
  const labels = [max, max - scaledRange / 2, min].map((value) => `<text class="chart-label" x="0" y="${y(value) + 3}">${escapeHtml(formatRub(value))}</text><line class="chart-axis" x1="${padding.left}" x2="${width - padding.right}" y1="${y(value)}" y2="${y(value)}"></line>`).join('');
  const dateLabels = days.map((day, index) => index % 5 === 0 || index === days.length - 1 ? `<text class="chart-label" text-anchor="middle" x="${x(index)}" y="${height - 7}">${formatShortDate(day.date)}</text>` : '').join('');
  const dots = days.map((day, index) => (index % 5 === 0 || day.isGap || index === days.length - 1) ? `<circle class="${day.isGap ? 'chart-dot-risk' : 'chart-dot'}" cx="${x(index)}" cy="${y(day.balance)}" r="${day.isGap ? 4.4 : 3.2}"><title>${formatDate(day.date)}: ${formatRub(day.balance, true)}</title></circle>` : '').join('');
  el.chart.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Прогноз остатка денежных средств"><defs><linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#6ea5ff" stop-opacity=".34"/><stop offset="100%" stop-color="#6ea5ff" stop-opacity=".03"/></linearGradient></defs>${labels}<line class="chart-reserve" x1="${padding.left}" x2="${width - padding.right}" y1="${y(reserveBalance)}" y2="${y(reserveBalance)}"></line><text class="chart-label" x="${width - padding.right}" y="${y(reserveBalance) - 5}" text-anchor="end">Резерв</text><polygon class="chart-area" points="${areaPoints}"></polygon><polyline class="chart-line" points="${points}"></polyline>${dots}${dateLabels}</svg>`;
}

function renderOperations() {
  el.heroOperationCount.textContent = String(state.operations.length);
  el.clearOperations.disabled = state.operations.length === 0;
  if (!state.operations.length) {
    el.operationTableBody.innerHTML = '<tr class="empty-row"><td colspan="7">Добавьте операцию вручную, загрузите CSV или внесите распознанный документ в план.</td></tr>';
    return;
  }
  const ordered = [...state.operations].sort((a, b) => a.date.localeCompare(b.date));
  el.operationTableBody.innerHTML = ordered.map((operation) => `<tr data-operation-id="${operation.id}">
    <td>${formatDate(operation.date)}</td>
    <td><span class="direction ${operation.direction}">${operation.direction === 'income' ? 'Поступление' : 'Списание'}</span></td>
    <td>${escapeHtml(operation.counterparty || 'Не указан')}<span class="table-subtext">${escapeHtml(operation.note || 'Без комментария')}</span></td>
    <td class="${operation.direction === 'income' ? 'amount-positive' : 'amount-negative'}">${operation.direction === 'income' ? '+' : '−'}${formatRub(operation.amount)}</td>
    <td>${operation.probability}%</td>
    <td>${formatRub(expectedAmount(operation))}</td>
    <td><button class="delete-operation" type="button" data-action="delete-operation" aria-label="Удалить операцию">×</button></td>
  </tr>`).join('');
}

function renderRecommendations(forecast) {
  if (!state.operations.length) {
    el.recommendations.innerHTML = `<div class="recommendation-card"><div class="recommendation-title"><span class="signal">i</span>Добавьте фактические ожидания</div><p>Для осмысленного прогноза укажите начальный остаток, резерв и даты ожидаемых поступлений или списаний. Приложение не генерирует предполагаемые платежи без ваших данных.</p></div>`;
    return;
  }
  if (!forecast.firstGap) {
    el.recommendations.innerHTML = `<div class="recommendation-card safe"><div class="recommendation-title"><span class="signal">✓</span>Прогнозный резерв не нарушается</div><p>На горизонте 30 дней остаток не опускается ниже установленного резерва. Контролируйте операции с вероятностью ниже 100%: изменение их статуса может изменить картину.</p></div>`;
    return;
  }
  const gap = forecast.firstGap;
  const uncertainty = state.operations.filter((operation) => operation.direction === 'income' && operation.probability < 100 && operation.date >= gap.key).sort((a, b) => a.date.localeCompare(b.date));
  const nearExpenses = state.operations.filter((operation) => operation.direction === 'expense' && operation.date <= gap.key).sort((a, b) => b.amount - a.amount).slice(0, 2);
  const suggested = [];
  if (uncertainty.length) suggested.push(`Подтвердите поступления с неполной вероятностью, включая «${escapeHtml(uncertainty[0].counterparty || uncertainty[0].note || 'контрагента не указан')}» на ${formatRub(expectedAmount(uncertainty[0]))}.`);
  if (nearExpenses.length) suggested.push(`Проверьте возможность согласовать сроки ближайших оттоков по договору: «${escapeHtml(nearExpenses[0].counterparty || nearExpenses[0].note || 'расход не указан')}» на ${formatRub(nearExpenses[0].amount)}.`);
  suggested.push('Сверьте план с банковской выпиской и договорными сроками; при необходимости оцените доступные источники покрытия с учётом их условий.');
  el.recommendations.innerHTML = `<div class="recommendation-card"><div class="recommendation-title"><span class="signal">!</span>Вероятен дефицит ${formatShortDate(gap.date)}</div><p>Прогнозный остаток составит ${formatRub(gap.balance)} при резерве ${formatRub(forecast.reserveBalance)}. Это индикатор для проверки плана, а не автоматическое решение о финансировании.</p><ul>${suggested.map((item) => `<li>${item}</li>`).join('')}</ul></div>`;
}

function renderForecast() {
  const forecast = getForecast();
  renderStats(forecast);
  renderChart(forecast);
  renderOperations();
  renderRecommendations(forecast);
}

function addOperation(data, feedback = true) {
  const date = parseFlexibleDate(data.date);
  const amount = parseAmount(data.amount);
  const probability = Number(data.probability);
  if (!date || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(probability) || probability < 0 || probability > 100) {
    throw new Error('Проверьте дату, положительную сумму и вероятность от 0 до 100%.');
  }
  state.operations.push({
    id: uid('operation'),
    date: dateKey(date),
    direction: data.direction === 'expense' ? 'expense' : 'income',
    amount,
    probability: Math.round(probability * 100) / 100,
    counterparty: String(data.counterparty || '').trim(),
    note: String(data.note || '').trim()
  });
  renderForecast();
  if (feedback) showToast('Операция добавлена в кассовый план.');
}

function parseCsvLine(line, delimiter) {
  const values = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { current += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) { values.push(current.trim()); current = ''; }
    else current += char;
  }
  values.push(current.trim());
  return values;
}

function normalizedHeader(value) {
  return String(value || '').toLowerCase().replaceAll('ё', 'е').trim();
}

function pickColumn(headers, names) {
  return headers.findIndex((header) => names.includes(header));
}

function importCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error('CSV должен содержать строку заголовков и хотя бы одну операцию.');
  const delimiter = lines[0].split(';').length >= lines[0].split(',').length ? ';' : ',';
  const headers = parseCsvLine(lines[0], delimiter).map(normalizedHeader);
  const columns = {
    date: pickColumn(headers, ['дата', 'date']),
    direction: pickColumn(headers, ['направление', 'тип', 'direction', 'type']),
    amount: pickColumn(headers, ['сумма', 'amount']),
    counterparty: pickColumn(headers, ['контрагент', 'counterparty']),
    probability: pickColumn(headers, ['вероятность', 'probability']),
    note: pickColumn(headers, ['комментарий', 'основание', 'note', 'comment'])
  };
  if (columns.date < 0 || columns.direction < 0 || columns.amount < 0) throw new Error('Не найдены обязательные колонки: дата, направление и сумма.');
  let imported = 0;
  let rejected = 0;
  for (const line of lines.slice(1)) {
    const row = parseCsvLine(line, delimiter);
    const directionRaw = String(row[columns.direction] || '').toLowerCase().replaceAll('ё', 'е').trim();
    const direction = /^(поступление|приход|income|in)$/.test(directionRaw) ? 'income' : /^(списание|расход|expense|out)$/.test(directionRaw) ? 'expense' : '';
    try {
      if (!direction) throw new Error('direction');
      addOperation({
        date: row[columns.date],
        direction,
        amount: row[columns.amount],
        probability: columns.probability >= 0 && row[columns.probability] !== '' ? row[columns.probability] : 100,
        counterparty: columns.counterparty >= 0 ? row[columns.counterparty] : '',
        note: columns.note >= 0 ? row[columns.note] : ''
      }, false);
      imported += 1;
    } catch { rejected += 1; }
  }
  if (!imported) throw new Error('Не удалось импортировать ни одной строки. Проверьте даты, направления и суммы.');
  el.importFeedback.textContent = `Импортировано: ${imported}. Пропущено: ${rejected}.`;
  showToast(`План обновлён: импортировано ${imported} ${pluralize(imported, 'операция', 'операции', 'операций')}.`);
}

function downloadFile(fileName, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportJson() {
  const payload = {
    exportedAt: new Date().toISOString(),
    assumptions: {
      horizonDays: HORIZON_DAYS,
      openingBalance: Number.isFinite(parseAmount(el.openingBalance.value)) ? parseAmount(el.openingBalance.value) : 0,
      reserveBalance: Number.isFinite(parseAmount(el.reserveBalance.value)) ? parseAmount(el.reserveBalance.value) : 0,
      formula: 'Остаток дня = остаток вчера + Σ(поступления × вероятность) − Σ(списания × вероятность)'
    },
    documents: state.documents,
    operations: state.operations
  };
  downloadFile(`ai-buhgalter-reestr-${dateKey(localToday())}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
  showToast('Реестр и кассовый план сохранены в JSON-файл.');
}

function attachEvents() {
  el.chooseFiles.addEventListener('click', () => el.fileInput.click());
  el.dropzone.addEventListener('click', (event) => { if (event.target !== el.chooseFiles) el.fileInput.click(); });
  el.dropzone.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); el.fileInput.click(); } });
  el.fileInput.addEventListener('change', (event) => { processFiles(event.target.files); event.target.value = ''; });
  ['dragenter', 'dragover'].forEach((eventName) => el.dropzone.addEventListener(eventName, (event) => { event.preventDefault(); el.dropzone.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach((eventName) => el.dropzone.addEventListener(eventName, (event) => { event.preventDefault(); el.dropzone.classList.remove('dragging'); }));
  el.dropzone.addEventListener('drop', (event) => processFiles(event.dataTransfer.files));

  el.documentList.addEventListener('input', (event) => {
    const input = event.target.closest('[data-field]');
    if (!input) return;
    const card = input.closest('[data-doc-id]');
    const doc = state.documents.find((item) => item.id === card.dataset.docId);
    if (!doc) return;
    const field = input.dataset.field;
    doc[field] = ['amount', 'vat'].includes(field) ? (input.value === '' ? '' : (Number.isFinite(parseAmount(input.value)) ? parseAmount(input.value) : '')) : input.value;
  });
  el.documentList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const card = button.closest('[data-doc-id]');
    const index = state.documents.findIndex((doc) => doc.id === card.dataset.docId);
    if (index < 0) return;
    if (button.dataset.action === 'delete') {
      state.documents.splice(index, 1);
      renderDocuments();
      showToast('Документ удалён из реестра.');
    }
    if (button.dataset.action === 'to-plan') addDocumentToPlan(state.documents[index]);
  });
  el.clearDocuments.addEventListener('click', () => { state.documents = []; renderDocuments(); showToast('Реестр очищен.'); });

  [el.openingBalance, el.reserveBalance].forEach((input) => input.addEventListener('input', renderForecast));
  el.operationForm.addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      addOperation({ date: el.operationDate.value, direction: el.operationDirection.value, amount: el.operationAmount.value, probability: el.operationProbability.value, counterparty: el.operationCounterparty.value, note: el.operationNote.value });
      el.operationForm.reset();
      el.operationDate.value = dateKey(localToday());
      el.operationProbability.value = '100';
      el.operationMessage.textContent = 'Добавлено в расчёт.';
      setTimeout(() => { el.operationMessage.textContent = ''; }, 2400);
    } catch (error) {
      el.operationMessage.textContent = error.message;
      el.operationMessage.style.color = 'var(--red)';
      setTimeout(() => { el.operationMessage.textContent = ''; el.operationMessage.style.color = ''; }, 4500);
    }
  });
  el.operationTableBody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="delete-operation"]');
    if (!button) return;
    const row = button.closest('[data-operation-id]');
    state.operations = state.operations.filter((operation) => operation.id !== row.dataset.operationId);
    renderForecast();
    showToast('Операция удалена из плана.');
  });
  el.clearOperations.addEventListener('click', () => { state.operations = []; renderForecast(); showToast('Кассовый план очищен.'); });

  el.chooseCsv.addEventListener('click', () => el.csvInput.click());
  el.csvInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try { importCsv(await file.text()); }
    catch (error) { el.importFeedback.textContent = error.message; showToast(error.message, true); }
    event.target.value = '';
  });
  el.downloadTemplate.addEventListener('click', () => {
    const csv = 'дата;направление;сумма;контрагент;вероятность;комментарий\n2026-08-19;Поступление;125000;ООО Альфа;90;Оплата счёта №45\n2026-08-22;Списание;56000;ООО Логистика;100;Оплата услуг\n';
    downloadFile('cash-plan-template.csv', csv, 'text/csv;charset=utf-8');
  });
  el.downloadJson.addEventListener('click', exportJson);
}

function initialize() {
  el.operationDate.value = dateKey(localToday());
  attachEvents();
  renderDocuments();
  renderForecast();
  resetStatus();
}

initialize();
