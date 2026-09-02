// Empty string = "same origin as the page". This means the app works
// unchanged whether it's opened at 127.0.0.1:5000, on your real domain, or
// on any hosting platform — it never has to know its own address.
const backendURL = "";

let analysisHistory = [];
let startTime = 0;
let currentPatient = {};
let selectedType = null;
// Initialize

const ALL_TYPES = ['ct', 'lung', 'skin'];

// ---------------------------------------------------------------------
// Lightweight toast notifications — replaces blocking alert() popups with
// a small message that appears in the corner and fades out on its own.
// ---------------------------------------------------------------------
function ensureToastContainer() {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  return container;
}

function showToast(message, kind = 'info') {
  const container = ensureToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${kind}`;
  toast.textContent = message;
  container.appendChild(toast);

  // trigger the enter animation on the next frame
  requestAnimationFrame(() => toast.classList.add('toast-visible'));

  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

// Escapes text before it's inserted via innerHTML, so a patient name (or
// any other user-typed text) can never be interpreted as HTML/script.
function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value == null ? '' : String(value);
  return div.innerHTML;
}

// Shrinks a scan image down to a small JPEG before it's stored in history/
// localStorage — full-resolution medical images would quickly exceed the
// browser's ~5-10 MB localStorage quota after a handful of analyses. The
// compressed copy is still plenty sharp for the PDF report.
const HISTORY_IMAGE_MAX_WIDTH = 480;
const HISTORY_IMAGE_QUALITY = 0.6;

function compressImageForHistory(dataUrl) {
  return new Promise((resolve) => {
    if (!dataUrl) { resolve(null); return; }
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, HISTORY_IMAGE_MAX_WIDTH / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', HISTORY_IMAGE_QUALITY));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function selectType(type) {
  selectedType = type;

  // Remove highlight + hide all forms/drop areas
  ALL_TYPES.forEach(t => {
    document.getElementById(`${t}Card`).classList.remove('selected-card');
    document.getElementById(`${t}Form`).classList.add('hidden');
    document.getElementById(`${t}DropArea`).classList.add('hidden');
  });

  // Show selected
  document.getElementById(`${type}Card`).classList.add('selected-card');
  document.getElementById(`${type}Form`).classList.remove('hidden');
}


document.addEventListener('DOMContentLoaded', () => {
  loadHistory();
  setupDragAndDrop();
  updateStatistics();
  setupSearch();

  // 🔒 Disable buttons initially
  ALL_TYPES.forEach(type => {
    document.getElementById(`${type}Btn`).disabled = true;
  });
});


// Drag and Drop functionality
function setupDragAndDrop() {
  const types = ALL_TYPES;

  types.forEach(type => {
    const dropArea = document.getElementById(`${type}DropArea`);
    const fileInput = document.getElementById(`${type}Image`);

    // 🔥 SAFETY CHECK (THIS WAS MISSING)
    if (!dropArea || !fileInput) {
      console.log(`Missing element for ${type}`);
      return;
    }

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      dropArea.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
      e.preventDefault();
      e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
      dropArea.addEventListener(eventName, () => {
        dropArea.classList.add('drag-over');
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropArea.addEventListener(eventName, () => {
        dropArea.classList.remove('drag-over');
      });
    });

    dropArea.addEventListener('drop', (e) => {
      const files = e.dataTransfer.files;
      if (files.length) {
        fileInput.files = files;
        previewImage(type);
      }
    });

    dropArea.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => previewImage(type));
  });
}

// Preview Image
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB — must match app.py's MAX_CONTENT_LENGTH

function previewImage(type) {
  const input = document.getElementById(`${type}Image`);
  const preview = document.getElementById(`${type}Preview`);
  const file = input.files[0];

  if (!file || !file.type.startsWith('image/')) {
    showToast('Please select a valid image file.', 'error');
    input.value = '';
    return;
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    showToast('That image is too large. Please choose a file under 10 MB.', 'error');
    input.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    preview.src = e.target.result;
    preview.style.display = 'block';
  };
  reader.readAsDataURL(file);
}

function submitPatient(type) {

  //if (type !== selectedType) {
   // alert("Please select correct section first");
   // return;
  //}
   // relaxed condition for better UX
  selectedType = type;
  const name = document.getElementById(`${type}Name`).value;
  const age = document.getElementById(`${type}Age`).value;
  const gender = document.getElementById(`${type}Gender`).value;

  if (!name || !age || !gender) {
    showToast('Please fill in name, age, and gender.', 'error');
    return;
  }

  currentPatient[type] = {
    name,
    age,
    gender,
    phone: document.getElementById(`${type}Phone`).value,
    address: document.getElementById(`${type}Address`).value
  };

  // SHOW upload
  document.getElementById(`${type}DropArea`).classList.remove('hidden');

  // ENABLE button
  document.getElementById(`${type}Btn`).disabled = false;

  showToast('Details saved. Now upload an image.', 'success');
  console.log("Submit working", type);
}

// Upload and Analyze
function uploadImage(type) {
  const input = document.getElementById(`${type}Image`);
  const file = input.files[0];

  if (!file) {
    showToast('Please select an image first.', 'error');
    return;
  }

  const btn = document.getElementById(`${type}Btn`);
  const loader = document.getElementById(`${type}Loader`);
  const content = document.getElementById(`${type}Content`);

  btn.disabled = true;
  loader.classList.remove('hidden');
  content.classList.add('hidden');

  startTime = Date.now();

  const formData = new FormData();
  formData.append('image', file);
  formData.append('type', type);

  fetch(`${backendURL}/predict-${type}`, {
    method: 'POST',
    credentials: 'same-origin',
    body: formData
  })
    .then(res => {
      if (!res.ok) {
        return res.json().then(err => { throw new Error(err.error || 'Analysis failed'); });
      }
      return res.json();
    })
    .then(data => {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      
      // Update UI
      document.getElementById(`${type}Prediction`).textContent = data.prediction;
      document.getElementById(`${type}ConfidenceText`).textContent = `${data.confidence}%`;
      document.getElementById(`${type}Time`).textContent = new Date().toLocaleString();

      // Update confidence badge
      const confidence = parseInt(data.confidence);
      const badge = document.getElementById(`${type}Confidence`);
      badge.textContent = `${data.confidence}%`;
      badge.classList.remove('confidence-high', 'confidence-medium', 'confidence-low');
      
      if (confidence >= 80) {
        badge.classList.add('confidence-high');
      } else if (confidence >= 60) {
        badge.classList.add('confidence-medium');
      } else {
        badge.classList.add('confidence-low');
      }

      // Save to history
      addToHistory({
  type: type.toUpperCase(),
  prediction: data.prediction,
  confidence: data.confidence,
  timestamp: new Date().toISOString(),
  duration: duration,
  fileName: file.name,

  // 🔥 IMPORTANT
  patient: currentPatient[type] || {}
});

      content.classList.remove('hidden');

      // Ask the AI health assistant to explain the result
      fetchAIInsight(type, data.prediction, data.confidence);

      // Store a compressed copy of the scan image on the history entry itself,
      // so the PDF report still has the image later even after a page reload
      // or after switching to a different card (both clear the live preview).
      const previewSrc = document.getElementById(`${type}Preview`).src;
      compressImageForHistory(previewSrc).then(compressed => {
        if (!compressed) return;
        const histEntry = analysisHistory[0]; // just unshifted onto the front by addToHistory
        if (histEntry) {
          histEntry.imageData = compressed;
          saveHistory();
        }
      });
    })
    .catch(error => {
      console.error('Error:', error);
      showToast(error.message || 'Error processing image. Make sure the backend server is running!', 'error');
    })
    .finally(() => {
      loader.classList.add('hidden');
      btn.disabled = false;
    });
}

// context kept per analysis type so follow-up chat knows what it's discussing
const assistantContext = {
  ct:   { prediction: null, confidence: null, history: [] },
  lung: { prediction: null, confidence: null, history: [] },
  skin: { prediction: null, confidence: null, history: [] },
};

const SECTION_KEYS = ['overview', 'symptoms', 'causes', 'treatment', 'when_to_see_doctor'];

// AI Health Assistant — structured explanation right after a prediction
function fetchAIInsight(type, prediction, confidence) {
  const loading = document.getElementById(`${type}AssistantLoading`);
  const sectionsBox = document.getElementById(`${type}AssistantSections`);
  const chatBox = document.getElementById(`${type}Chat`);
  const thread = document.getElementById(`${type}ChatThread`);

  // reset state for a fresh analysis
  assistantContext[type] = { prediction, confidence, history: [] };
  thread.innerHTML = '';
  sectionsBox.classList.add('hidden');
  chatBox.classList.add('hidden');
  loading.classList.remove('hidden');

  fetch(`${backendURL}/assistant`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, prediction, confidence })
  })
    .then(res => res.json())
    .then(data => {
      if (data.error) {
        sectionsBox.classList.remove('hidden');
        document.querySelector(`#${type}Section-overview p`).textContent = `Assistant unavailable: ${data.error}`;
        return;
      }

      SECTION_KEYS.forEach(key => {
        const el = document.getElementById(`${type}Section-${key}`);
        const text = (data.sections && data.sections[key]) || '';
        el.classList.toggle('hidden', !text);
        el.querySelector('p').textContent = text;
      });

      sectionsBox.classList.remove('hidden');
      sectionsBox.classList.toggle('low-confidence', !!data.low_confidence);

      chatBox.classList.remove('hidden');

      // persist the insight onto the matching history entry so past reports can include it too
      const histEntry = analysisHistory.find(e =>
        e.type === type.toUpperCase() && e.prediction === prediction && String(e.confidence) === String(confidence)
      );
      if (histEntry && data.sections) {
        histEntry.aiSections = data.sections;
        histEntry.lowConfidence = !!data.low_confidence;
        saveHistory();
      }
    })
    .catch(error => {
      console.error('Assistant error:', error);
      sectionsBox.classList.remove('hidden');
      document.querySelector(`#${type}Section-overview p`).textContent = 'Could not reach the AI assistant right now.';
    })
    .finally(() => {
      loading.classList.add('hidden');
    });
}

// Follow-up chat — asks a question about the same result, with prior turns as context
function sendAssistantMessage(type) {
  const input = document.getElementById(`${type}ChatInput`);
  const thread = document.getElementById(`${type}ChatThread`);
  const question = input.value.trim();
  if (!question) return;

  const ctx = assistantContext[type];
  if (!ctx || ctx.prediction == null) {
    showToast('Run an analysis first.', 'error');
    return;
  }

  appendChatBubble(thread, 'user', question);
  input.value = '';
  input.disabled = true;

  const typingEl = appendChatBubble(thread, 'model', '…');

  fetch(`${backendURL}/assistant/chat`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type,
      prediction: ctx.prediction,
      confidence: ctx.confidence,
      history: ctx.history,
      question
    })
  })
    .then(res => res.json())
    .then(data => {
      const answer = data.answer || data.error || 'No response.';
      typingEl.textContent = answer;
      ctx.history.push({ role: 'user', text: question });
      ctx.history.push({ role: 'model', text: answer });
    })
    .catch(error => {
      console.error('Chat error:', error);
      typingEl.textContent = 'Could not reach the AI assistant right now.';
    })
    .finally(() => {
      input.disabled = false;
      input.focus();
    });
}

function appendChatBubble(thread, role, text) {
  const bubble = document.createElement('div');
  bubble.className = `ai-chat-bubble ai-chat-${role}`;
  bubble.textContent = text;
  thread.appendChild(bubble);
  thread.scrollTop = thread.scrollHeight;
  return bubble;
}

// let Enter key send the message too
document.addEventListener('DOMContentLoaded', () => {
  ['ct', 'lung', 'skin'].forEach(type => {
    const input = document.getElementById(`${type}ChatInput`);
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') sendAssistantMessage(type);
      });
    }
  });
});

// History Management
function addToHistory(entry) {
  analysisHistory.unshift(entry);
  saveHistory();
  updateStatistics();
  updateHistoryTable();
}

function saveHistory() {
  try {
    localStorage.setItem('medaiHistory', JSON.stringify(analysisHistory));
  } catch (e) {
    // Most likely the storage quota is full (lots of saved scan images).
    console.error('Could not save history:', e);
    showToast('Storage is nearly full — the oldest scan images may not be saved.', 'error');
  }
}

function loadHistory() {
  const saved = localStorage.getItem('medaiHistory');
  if (saved) {
    analysisHistory = JSON.parse(saved);
    updateHistoryTable();
    updateStatistics();
  }
}

function updateHistoryTable() {
  const tbody = document.getElementById('historyTableBody');
  const searchValue = document.getElementById('searchInput').value.toLowerCase();

 const filtered = analysisHistory.filter(entry => 
  entry.type.toLowerCase().includes(searchValue) ||
  entry.prediction.toLowerCase().includes(searchValue) ||
  (entry.patient?.name && entry.patient.name.toLowerCase().includes(searchValue))
);

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr class="empty-state">
        <td colspan="9">No analysis found matching your search.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map((entry, index) => `
    <tr>
  <td>${index + 1}</td>
  <td>
    <span class="type-badge ${entry.type === 'CT' ? 'type-ct' : entry.type === 'LUNG' ? 'type-lung' : 'type-skin'}">
      ${entry.type}
    </span>
  </td>
  <td>${escapeHtml(entry.patient?.name) || '—'}</td>
  <td>${escapeHtml(entry.patient?.age) || '—'}</td>
  <td><strong>${escapeHtml(entry.prediction)}</strong></td>
  <td>
    <span class="confidence-badge ${getConfidenceClass(entry.confidence)}">
      ${entry.confidence}%
    </span>
  </td>
  <td>${new Date(entry.timestamp).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
  <td>${entry.duration}s</td>
  <td>
    <button class="btn btn-small btn-primary" onclick="downloadHistoryPDF(${analysisHistory.indexOf(entry)})">
      <i class="fas fa-file-pdf"></i>
    </button>
    <button class="btn btn-small btn-secondary" onclick="downloadHistoryCSV(${analysisHistory.indexOf(entry)})">
      <i class="fas fa-download"></i>
    </button>
  </td>
</tr>
  `).join('');
}

function getConfidenceClass(confidence) {
  const conf = parseInt(confidence);
  if (conf >= 80) return 'confidence-high';
  if (conf >= 60) return 'confidence-medium';
  return 'confidence-low';
}

// Statistics
function updateStatistics() {
  const total = analysisHistory.length;
  const ctCount = analysisHistory.filter(e => e.type === 'CT').length;
  const lungCount = analysisHistory.filter(e => e.type === 'LUNG').length;
  const skinCount = analysisHistory.filter(e => e.type === 'SKIN').length;
  const avgTime = total > 0 ? 
    (analysisHistory.reduce((sum, e) => sum + parseFloat(e.duration || 0), 0) / total).toFixed(1) : 
    '0';

  document.getElementById('totalAnalysis').textContent = total;
  document.getElementById('ctCount').textContent = ctCount;
  document.getElementById('lungCount').textContent = lungCount;
  document.getElementById('skinCount').textContent = skinCount;
  document.getElementById('avgTime').textContent = avgTime + 's';
}

// Search
function setupSearch() {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', updateHistoryTable);
  }
}

// Reset Analysis
function resetAnalysis(type) {
  const elements = {
    preview: document.getElementById(`${type}Preview`),
    input: document.getElementById(`${type}Image`),
    btn: document.getElementById(`${type}Btn`),
    content: document.getElementById(`${type}Content`)
  };

  elements.preview.style.display = 'none';
  elements.preview.src = '';
  elements.input.value = '';
  elements.btn.disabled = false;
  elements.content.classList.add('hidden');

  const sectionsBox = document.getElementById(`${type}AssistantSections`);
  const chatBox = document.getElementById(`${type}Chat`);
  const thread = document.getElementById(`${type}ChatThread`);
  if (sectionsBox) {
    sectionsBox.classList.add('hidden');
    sectionsBox.classList.remove('low-confidence');
  }
  if (chatBox) chatBox.classList.add('hidden');
  if (thread) thread.innerHTML = '';
  assistantContext[type] = { prediction: null, confidence: null, history: [] };
}

// ============================================================
// PDF Report Generation — shared brand kit + layout helpers
// ============================================================

const PDF_THEME = {
  tealDark:  [8, 79, 72],     // header band / headings
  teal:      [11, 110, 100],  // accents
  coral:     [201, 79, 44],   // warnings / low-confidence
  ink:       [18, 34, 29],    // body text
  inkMuted:  [91, 107, 100],  // secondary text
  line:      [219, 225, 217], // borders/rules
  surface:   [251, 251, 248], // card fill
  white:     [255, 255, 255],
  good:      [43, 130, 87],   // high confidence
  warn:      [191, 138, 15],  // medium confidence
};

const ANALYSIS_TYPE_LABELS = { ct: 'Brain MRI Analysis', lung: 'Lung Disease Detection', skin: 'Skin Lesion Analysis' };
const SECTION_LABELS = {
  overview: 'Overview',
  symptoms: 'Symptoms',
  causes: 'Causes',
  treatment: 'Primary Treatment',
  when_to_see_doctor: 'When To See A Doctor',
};

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 18;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_Y = PAGE_H - 14;

function confidenceTier(confidenceNum) {
  if (confidenceNum >= 80) return { label: 'HIGH CONFIDENCE', color: PDF_THEME.good };
  if (confidenceNum >= 60) return { label: 'MODERATE CONFIDENCE', color: PDF_THEME.warn };
  return { label: 'LOW CONFIDENCE', color: PDF_THEME.coral };
}

function shortId() {
  return `MED-${Date.now().toString(36).toUpperCase()}`;
}

// Ensures there's room for the next block; adds a new page (with slim header) if not.
function ensureSpace(doc, yPos, needed) {
  if (yPos + needed > FOOTER_Y - 6) {
    doc.addPage();
    drawSlimHeader(doc);
    return MARGIN + 20;
  }
  return yPos;
}

function drawBrandHeader(doc, subtitle, reportId) {
  const [r, g, b] = PDF_THEME.tealDark;
  doc.setFillColor(r, g, b);
  doc.rect(0, 0, PAGE_W, 34, 'F');
  doc.setFillColor(...PDF_THEME.coral);
  doc.rect(0, 34, PAGE_W, 1.4, 'F');

  doc.setTextColor(...PDF_THEME.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('MediScan AI', MARGIN, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(214, 232, 227);
  doc.text(subtitle, MARGIN, 24);

  doc.setFontSize(8.5);
  doc.setTextColor(214, 232, 227);
  doc.text(`Report ID: ${reportId}`, PAGE_W - MARGIN, 15, { align: 'right' });
  doc.text(`Generated: ${new Date().toLocaleString()}`, PAGE_W - MARGIN, 21, { align: 'right' });

  doc.setTextColor(...PDF_THEME.ink);
}

function drawSlimHeader(doc) {
  const [r, g, b] = PDF_THEME.tealDark;
  doc.setFillColor(r, g, b);
  doc.rect(0, 0, PAGE_W, 14, 'F');
  doc.setTextColor(...PDF_THEME.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('MediScan AI', MARGIN, 9.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('Diagnostic Support Report (continued)', PAGE_W - MARGIN, 9.5, { align: 'right' });
  doc.setTextColor(...PDF_THEME.ink);
}

function drawSectionTitle(doc, title, yPos) {
  doc.setFillColor(...PDF_THEME.teal);
  doc.rect(MARGIN, yPos - 3.6, 2.4, 5.2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(...PDF_THEME.tealDark);
  doc.text(title.toUpperCase(), MARGIN + 5, yPos);
  doc.setTextColor(...PDF_THEME.ink);
  return yPos + 6;
}

function drawFooters(doc, disclaimerLines) {
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(...PDF_THEME.line);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, FOOTER_Y - 8, PAGE_W - MARGIN, FOOTER_Y - 8);

    if (i === pageCount && disclaimerLines && disclaimerLines.length) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7.5);
      doc.setTextColor(...PDF_THEME.inkMuted);
      doc.text(disclaimerLines, MARGIN, FOOTER_Y - 3.5);
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...PDF_THEME.inkMuted);
    doc.text('MediScan AI · Diagnostic Support Report', MARGIN, FOOTER_Y + 4);
    doc.text(`Page ${i} of ${pageCount}`, PAGE_W / 2, FOOTER_Y + 4, { align: 'center' });
    doc.text(new Date().toLocaleDateString(), PAGE_W - MARGIN, FOOTER_Y + 4, { align: 'right' });
  }
}

// Draws the patient-info card as a two-column key/value table
function drawPatientInfo(doc, p, yPos) {
  yPos = drawSectionTitle(doc, 'Patient Information', yPos);
  const rows = [
    ['Name', p.name || 'N/A'],
    ['Age', p.age || 'N/A'],
    ['Gender', p.gender || 'N/A'],
    ['Phone', p.phone || 'N/A'],
    ['Address', p.address || 'N/A'],
  ];
  doc.autoTable({
    startY: yPos,
    margin: { left: MARGIN, right: MARGIN },
    theme: 'plain',
    styles: { fontSize: 10, textColor: PDF_THEME.ink, cellPadding: { top: 1.6, bottom: 1.6, left: 0 } },
    columnStyles: {
      0: { fontStyle: 'bold', textColor: PDF_THEME.inkMuted, cellWidth: 28 },
      1: { textColor: PDF_THEME.ink },
    },
    body: rows,
  });
  return doc.lastAutoTable.finalY + 8;
}

// Draws the analysis-summary card with a colored confidence badge
function drawAnalysisSummary(doc, { analysisType, prediction, confidenceNum, confidenceDisplay, timeAnalyzed }, yPos) {
  yPos = drawSectionTitle(doc, 'Analysis Summary', yPos);

  const cardH = 30;
  doc.setFillColor(...PDF_THEME.surface);
  doc.setDrawColor(...PDF_THEME.line);
  doc.setLineWidth(0.3);
  doc.roundedRect(MARGIN, yPos, CONTENT_W, cardH, 2, 2, 'FD');

  const tier = confidenceTier(confidenceNum);
  const badgeW = 46, badgeH = 12;
  const badgeX = PAGE_W - MARGIN - 6 - badgeW;
  const badgeY = yPos + 6;
  doc.setFillColor(...tier.color);
  doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 2, 2, 'F');
  doc.setTextColor(...PDF_THEME.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(`${confidenceDisplay}`, badgeX + badgeW / 2, badgeY + 6, { align: 'center' });
  doc.setFontSize(6.5);
  doc.text(tier.label, badgeX + badgeW / 2, badgeY + 10, { align: 'center' });

  doc.setTextColor(...PDF_THEME.inkMuted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('SCAN TYPE', MARGIN + 6, yPos + 8);
  doc.text('PREDICTED RESULT', MARGIN + 6, yPos + 20);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...PDF_THEME.ink);
  doc.text(analysisType, MARGIN + 6, yPos + 13);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...PDF_THEME.tealDark);
  doc.text(String(prediction), MARGIN + 6, yPos + 25.5, { maxWidth: badgeX - MARGIN - 12 });

  yPos += cardH + 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF_THEME.inkMuted);
  doc.text(`Analyzed: ${timeAnalyzed}`, MARGIN, yPos);

  return yPos + 8;
}

function drawLowConfidenceBanner(doc, yPos) {
  const h = 12;
  doc.setFillColor(253, 237, 231);
  doc.setDrawColor(...PDF_THEME.coral);
  doc.setLineWidth(0.4);
  doc.roundedRect(MARGIN, yPos, CONTENT_W, h, 1.5, 1.5, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...PDF_THEME.coral);
  doc.text('⚠  Low-confidence result — clinical correlation and re-evaluation are recommended.', MARGIN + 4, yPos + 7.5);
  doc.setTextColor(...PDF_THEME.ink);
  return yPos + h + 8;
}

// Draws the scan image, preserving aspect ratio within a max box
function drawScanImage(doc, dataUrl, yPos) {
  try {
    const props = doc.getImageProperties(dataUrl);
    const maxW = CONTENT_W;
    const maxH = 85;
    let w = maxW, h = (props.height / props.width) * maxW;
    if (h > maxH) { h = maxH; w = (props.width / props.height) * maxH; }
    const x = MARGIN + (maxW - w) / 2;

    yPos = drawSectionTitle(doc, 'Scan Image', yPos);
    doc.setDrawColor(...PDF_THEME.line);
    doc.setLineWidth(0.3);
    doc.rect(x - 1, yPos - 1, w + 2, h + 2, 'S');
    // Use the image's actual format (PNG/JPEG/WEBP) instead of assuming JPEG —
    // forcing the wrong format here silently corrupts the embedded image.
    doc.addImage(dataUrl, props.fileType || 'JPEG', x, yPos, w, h);
    return yPos + h + 10;
  } catch (e) {
    console.log('Could not add image to PDF', e);
    return yPos;
  }
}

// Draws the AI health-assistant sections (overview/symptoms/causes/treatment/when-to-see-doctor)
function drawAiInsights(doc, sections, lowConfidence, yPos) {
  const entries = Object.keys(SECTION_LABELS)
    .map(key => [SECTION_LABELS[key], (sections[key] || '').trim()])
    .filter(([, text]) => text.length > 0);

  if (!entries.length) return yPos;

  yPos = ensureSpace(doc, yPos, 16);
  yPos = drawSectionTitle(doc, 'AI Health Assistant Insights', yPos);

  if (lowConfidence) {
    yPos = ensureSpace(doc, yPos, 20);
    yPos = drawLowConfidenceBanner(doc, yPos);
  }

  entries.forEach(([label, text]) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    yPos = ensureSpace(doc, yPos, 10);
    doc.setTextColor(...PDF_THEME.teal);
    doc.text(label, MARGIN, yPos);
    yPos += 5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...PDF_THEME.ink);
    const lines = doc.splitTextToSize(text, CONTENT_W);
    yPos = ensureSpace(doc, yPos, lines.length * 4.6 + 4);
    doc.text(lines, MARGIN, yPos);
    yPos += lines.length * 4.6 + 5;
  });

  return yPos;
}

function readAiSectionsFromDom(type) {
  const box = document.getElementById(`${type}AssistantSections`);
  if (!box || box.classList.contains('hidden')) return null;

  const sections = {};
  let hasAny = false;
  Object.keys(SECTION_LABELS).forEach(key => {
    const p = document.querySelector(`#${type}Section-${key} p`);
    const text = p ? p.textContent.trim() : '';
    sections[key] = text;
    if (text) hasAny = true;
  });

  return hasAny ? { sections, lowConfidence: box.classList.contains('low-confidence') } : null;
}

// PDF Export with advanced, brand-consistent formatting
function downloadPDF(type) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const reportId = shortId();

  const analysisType = ANALYSIS_TYPE_LABELS[type] || 'Medical Image Analysis';
  drawBrandHeader(doc, analysisType, reportId);

  let yPos = 46;

  const p = analysisHistory[0]?.patient || currentPatient[type] || {};
  if (p.name) {
    yPos = drawPatientInfo(doc, p, yPos);
  }

  const prediction      = document.getElementById(`${type}Prediction`)?.textContent || analysisHistory[0]?.prediction || 'N/A';
  const confidenceDisplay = document.getElementById(`${type}ConfidenceText`)?.textContent || (analysisHistory[0]?.confidence != null ? `${analysisHistory[0].confidence}%` : 'N/A');
  const confidenceNum   = parseFloat(confidenceDisplay) || 0;
  const timeAnalyzed    = document.getElementById(`${type}Time`)?.textContent || (analysisHistory[0]?.timestamp ? new Date(analysisHistory[0].timestamp).toLocaleString() : 'N/A');

  yPos = ensureSpace(doc, yPos, 44);
  yPos = drawAnalysisSummary(doc, { analysisType, prediction, confidenceNum, confidenceDisplay, timeAnalyzed }, yPos);

  const preview = document.getElementById(`${type}Preview`);
  const imageSrc = (preview && preview.src) || analysisHistory[0]?.imageData;
  if (imageSrc) {
    yPos = ensureSpace(doc, yPos, 40);
    yPos = drawScanImage(doc, imageSrc, yPos);
  }

  const aiInsight = readAiSectionsFromDom(type);
  if (aiInsight) {
    yPos = drawAiInsights(doc, aiInsight.sections, aiInsight.lowConfidence, yPos);
  }

  drawFooters(doc, [
    'Disclaimer: This report is generated by an AI diagnostic-support system and is not a medical diagnosis.',
    'Always consult a qualified clinician to interpret these results.',
  ]);

  doc.save(`${type}_analysis_report_${Date.now()}.pdf`);
}

// CSV Export
function downloadCSV(type) {
  const entry = analysisHistory[0];
  if (!entry) {
    showToast('No analysis to export yet.', 'error');
    return;
  }

  const headers = ['Patient Name', 'Age', 'Gender', 'Phone', 'Address', 'Analysis Type', 'Prediction', 'Confidence (%)', 'Date & Time', 'Duration (Seconds)', 'File Name'];
  const values = [
    entry.patient?.name || 'N/A',
    entry.patient?.age || 'N/A',
    entry.patient?.gender || 'N/A',
    entry.patient?.phone || 'N/A',
    entry.patient?.address || 'N/A',
    entry.type,
    entry.prediction,
    entry.confidence,
    new Date(entry.timestamp).toLocaleString(),
    entry.duration,
    entry.fileName || 'N/A'
  ];

  const csv = [headers.join(','), values.join(',')].join('\n');
  downloadAsFile(csv, `${type}_analysis_${new Date().getTime()}.csv`, 'text/csv');
}

// Export all data as CSV
function exportAllData() {
  if (analysisHistory.length === 0) {
    showToast('No data to export yet.', 'error');
    return;
  }

  const headers = ['#', 'Type', 'Patient Name', 'Age', 'Gender', 'Phone', 'Address', 'Prediction', 'Confidence (%)', 'Date & Time', 'Duration (Seconds)', 'File Name'];
  const rows = analysisHistory.map((entry, index) => [
    index + 1,
    entry.type,
    entry.patient?.name || 'N/A',
    entry.patient?.age || 'N/A',
    entry.patient?.gender || 'N/A',
    entry.patient?.phone || 'N/A',
    entry.patient?.address || 'N/A',
    entry.prediction,
    entry.confidence,
    new Date(entry.timestamp).toLocaleString(),
    entry.duration,
    entry.fileName || 'N/A'
  ]);

  const csv = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
  ].join('\n');

  downloadAsFile(csv, `medai_pro_analysis_history_${new Date().getTime()}.csv`, 'text/csv');
}

// Download History PDF — same brand-consistent layout, built from a saved history entry
function downloadHistoryPDF(index) {
  if (index < 0 || index >= analysisHistory.length) {
    showToast('Analysis not found.', 'error');
    return;
  }

  const entry = analysisHistory[index];
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const reportId = shortId();

  const typeKey = (entry.type || '').toLowerCase();
  const analysisType = ANALYSIS_TYPE_LABELS[typeKey] || 'Medical Image Analysis';
  drawBrandHeader(doc, analysisType, reportId);

  let yPos = 46;

  if (entry.patient?.name) {
    yPos = drawPatientInfo(doc, entry.patient, yPos);
  }

  const confidenceNum = parseFloat(entry.confidence) || 0;
  yPos = ensureSpace(doc, yPos, 44);
  yPos = drawAnalysisSummary(doc, {
    analysisType,
    prediction: entry.prediction,
    confidenceNum,
    confidenceDisplay: `${entry.confidence}%`,
    timeAnalyzed: new Date(entry.timestamp).toLocaleString(),
  }, yPos);

  // The scan image itself — this was previously missing from history-based
  // reports entirely (it only appeared on the very first, immediate download).
  if (entry.imageData) {
    yPos = ensureSpace(doc, yPos, 40);
    yPos = drawScanImage(doc, entry.imageData, yPos);
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF_THEME.inkMuted);
  yPos = ensureSpace(doc, yPos, 10);
  doc.text(`Analysis duration: ${entry.duration}s   ·   File: ${entry.fileName || 'N/A'}`, MARGIN, yPos);
  yPos += 8;

  if (entry.aiSections) {
    yPos = drawAiInsights(doc, entry.aiSections, !!entry.lowConfidence, yPos);
  }

  drawFooters(doc, [
    'Disclaimer: This report is generated by an AI diagnostic-support system and is not a medical diagnosis.',
    'Always consult a qualified clinician to interpret these results.',
  ]);

  doc.save(`analysis_${entry.type}_${Date.now()}.pdf`);
}

// Download History CSV
function downloadHistoryCSV(index) {
  if (index < 0 || index >= analysisHistory.length) {
    showToast('Analysis not found.', 'error');
    return;
  }

  const entry = analysisHistory[index];
  const headers = ['Patient Name', 'Age', 'Gender', 'Phone', 'Address', 'Analysis Type', 'Prediction', 'Confidence (%)', 'Date & Time', 'Duration (Seconds)', 'File Name'];
  const values = [
  entry.patient?.name || 'N/A',
  entry.patient?.age || 'N/A',
  entry.patient?.gender || 'N/A',
  entry.patient?.phone || 'N/A',
  entry.patient?.address || 'N/A',
  entry.type,
  entry.prediction,
  entry.confidence,
  new Date(entry.timestamp).toLocaleString(),
  entry.duration,
  entry.fileName || 'N/A'
  ];

  const csv = [headers.join(','), values.join(',')].join('\n');
  downloadAsFile(csv, `${entry.type}_analysis_${new Date().getTime()}.csv`, 'text/csv');
}

// Helper: Download file
function downloadAsFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

// Clear all data
function clearAllData() {
  if (confirm('Are you sure you want to clear all analysis history? This action cannot be undone.')) {
    analysisHistory = [];
    saveHistory();
    updateStatistics();
    updateHistoryTable();
    ALL_TYPES.forEach(type => resetAnalysis(type));
    showToast('All data cleared successfully.', 'success');
  }
}

function clearSection(type) {
  analysisHistory = analysisHistory.filter(e => e.type !== type.toUpperCase());
  saveHistory();
  updateHistoryTable();
  updateStatistics();

  showToast(`${type.toUpperCase()} data cleared.`, 'success');
}
