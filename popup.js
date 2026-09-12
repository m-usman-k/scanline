let currentTab = 'overview';
let lastResults = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function init() {
  $('#scanBtn').addEventListener('click', runScan);
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });
}

async function runScan() {
  const btn = $('#scanBtn');
  btn.disabled = true;
  btn.textContent = 'Scanning...';

  $('#welcome').classList.add('hidden');
  $('#results').classList.add('hidden');
  $('#loading').classList.remove('hidden');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      throw new Error('Cannot scan this page');
    }

    const response = await chrome.tabs.sendMessage(tab.id, { type: 'SCAN' });

    // Get security headers from background
    let securityHeaders = {};
    try {
      const headerResponse = await chrome.runtime.sendMessage({
        type: 'GET_SECURITY_HEADERS',
        tabId: tab.id,
      });
      securityHeaders = headerResponse.headers || {};
    } catch (e) { /* skip */ }

    // Add header checks to security
    const headerChecks = analyzeHeaders(securityHeaders);
    response.security = [...response.security, ...headerChecks];
    response.score = calculateScore(response.health, response.performance, response.security);

    lastResults = response;
    displayResults(response);
  } catch (err) {
    $('#loading').classList.add('hidden');
    $('#welcome').classList.remove('hidden');
    alert('Scan failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Scan';
  }
}

function analyzeHeaders(headers) {
  const checks = [];

  checks.push({
    name: 'Content-Security-Policy',
    detail: headers['content-security-policy'] ? 'Set' : 'Not set',
    status: headers['content-security-policy'] ? 'pass' : 'warn',
    icon: headers['content-security-policy'] ? '✓' : '⚠',
    iconClass: headers['content-security-policy'] ? 'green' : 'yellow',
  });

  checks.push({
    name: 'Strict-Transport-Security',
    detail: headers['strict-transport-security'] ? 'Set' : 'Not set',
    status: headers['strict-transport-security'] ? 'pass' : 'warn',
    icon: headers['strict-transport-security'] ? '✓' : '⚠',
    iconClass: headers['strict-transport-security'] ? 'green' : 'yellow',
  });

  checks.push({
    name: 'X-Content-Type-Options',
    detail: headers['x-content-type-options'] === 'nosniff' ? 'nosniff' : 'Not set or wrong value',
    status: headers['x-content-type-options'] === 'nosniff' ? 'pass' : 'warn',
    icon: headers['x-content-type-options'] === 'nosniff' ? '✓' : '⚠',
    iconClass: headers['x-content-type-options'] === 'nosniff' ? 'green' : 'yellow',
  });

  checks.push({
    name: 'X-Frame-Options',
    detail: headers['x-frame-options'] ? 'Set' : 'Not set',
    status: headers['x-frame-options'] ? 'pass' : 'warn',
    icon: headers['x-frame-options'] ? '✓' : '⚠',
    iconClass: headers['x-frame-options'] ? 'green' : 'yellow',
  });

  checks.push({
    name: 'Referrer-Policy',
    detail: headers['referrer-policy'] || 'Not set',
    status: headers['referrer-policy'] ? 'pass' : 'info',
    icon: headers['referrer-policy'] ? '✓' : 'i',
    iconClass: headers['referrer-policy'] ? 'green' : 'blue',
  });

  checks.push({
    name: 'Permissions-Policy',
    detail: headers['permissions-policy'] ? 'Set' : 'Not set',
    status: headers['permissions-policy'] ? 'pass' : 'info',
    icon: headers['permissions-policy'] ? '✓' : 'i',
    iconClass: headers['permissions-policy'] ? 'green' : 'blue',
  });

  checks.push({
    name: 'Cross-Origin-Opener-Policy',
    detail: headers['cross-origin-opener-policy'] ? 'Set' : 'Not set',
    status: headers['cross-origin-opener-policy'] ? 'pass' : 'info',
    icon: headers['cross-origin-opener-policy'] ? '✓' : 'i',
    iconClass: headers['cross-origin-opener-policy'] ? 'green' : 'blue',
  });

  return checks;
}

function calculateScore(health, perf, security) {
  const allItems = [...health, ...perf, ...security];
  if (allItems.length === 0) return 0;

  let score = 0;
  let total = 0;

  for (const item of allItems) {
    total += 10;
    if (item.status === 'pass') score += 10;
    else if (item.status === 'warn') score += 5;
    else if (item.status === 'info') score += 7;
    else score += 0;
  }

  return Math.round((score / total) * 100) || 0;
}

function displayResults(data) {
  $('#loading').classList.add('hidden');
  $('#results').classList.remove('hidden');
  $('#pageUrl').textContent = data.url;

  updateScore(data.score);
  switchTab(currentTab);
}

function updateScore(score) {
  const circle = $('#scoreCircle');
  const circumference = 339.292;
  const offset = circumference - (score / 100) * circumference;
  circle.style.strokeDashoffset = offset;

  const scoreValue = $('#scoreValue');
  animateNumber(scoreValue, 0, score, 800);

  const grade = $('#scoreLabel');
  if (score >= 80) {
    grade.textContent = 'Excellent';
    grade.className = 'score-grade good';
    circle.style.stroke = '#00b894';
  } else if (score >= 60) {
    grade.textContent = 'Good';
    grade.className = 'score-grade fair';
    circle.style.stroke = '#fdcb6e';
  } else {
    grade.textContent = 'Needs Work';
    grade.className = 'score-grade poor';
    circle.style.stroke = '#e17055';
  }
}

function animateNumber(el, from, to, duration) {
  const start = performance.now();
  function update(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(from + (to - from) * eased);
    if (progress < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

function switchTab(tabName) {
  currentTab = tabName;
  $$('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === tabName);
  });

  if (!lastResults) {
    $('#tabContent').innerHTML = '<div class="empty-state"><div class="empty-state-icon">📊</div>Click Scan to analyze this page</div>';
    return;
  }

  const content = $('#tabContent');

  switch (tabName) {
    case 'overview':
      content.innerHTML = renderOverview(lastResults);
      break;
    case 'stack':
      content.innerHTML = renderStack(lastResults.techStack);
      break;
    case 'security':
      content.innerHTML = renderItems(lastResults.security, 'Security Checks');
      break;
    case 'performance':
      content.innerHTML = renderItems(lastResults.performance, 'Performance Metrics');
      break;
    case 'seo':
      content.innerHTML = renderItems(lastResults.health, 'SEO & Health');
      break;
  }
}

function renderOverview(data) {
  const passCount = [...data.health, ...data.performance, ...data.security].filter(i => i.status === 'pass').length;
  const warnCount = [...data.health, ...data.performance, ...data.security].filter(i => i.status === 'warn').length;
  const failCount = [...data.health, ...data.performance, ...data.security].filter(i => i.status === 'fail').length;

  const securityScore = calcCategoryScore(data.security);
  const perfScore = calcCategoryScore(data.performance);
  const seoScore = calcCategoryScore(data.health);

  return `
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-value" style="color:#00b894">${passCount}</div>
        <div class="stat-label">Passed</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:#fdcb6e">${warnCount}</div>
        <div class="stat-label">Warnings</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:#e17055">${failCount}</div>
        <div class="stat-label">Failed</div>
      </div>
    </div>
    <div class="category-summary">
      <div class="category-card" onclick="document.querySelector('[data-tab=security]').click()">
        <div class="category-card-header">
          <span class="category-card-title">Security</span>
          <span class="category-card-score" style="color:${getScoreColor(securityScore)}">${securityScore}</span>
        </div>
        <div class="category-card-bar">
          <div class="category-card-bar-fill" style="width:${securityScore}%;background:${getScoreColor(securityScore)}"></div>
        </div>
      </div>
      <div class="category-card" onclick="document.querySelector('[data-tab=performance]').click()">
        <div class="category-card-header">
          <span class="category-card-title">Performance</span>
          <span class="category-card-score" style="color:${getScoreColor(perfScore)}">${perfScore}</span>
        </div>
        <div class="category-card-bar">
          <div class="category-card-bar-fill" style="width:${perfScore}%;background:${getScoreColor(perfScore)}"></div>
        </div>
      </div>
      <div class="category-card" onclick="document.querySelector('[data-tab=seo]').click()">
        <div class="category-card-header">
          <span class="category-card-title">SEO & Health</span>
          <span class="category-card-score" style="color:${getScoreColor(seoScore)}">${seoScore}</span>
        </div>
        <div class="category-card-bar">
          <div class="category-card-bar-fill" style="width:${seoScore}%;background:${getScoreColor(seoScore)}"></div>
        </div>
      </div>
      <div class="category-card" onclick="document.querySelector('[data-tab=stack]').click()">
        <div class="category-card-header">
          <span class="category-card-title">Tech Stack</span>
          <span class="category-card-score" style="color:#6C5CE7">${data.techStack.length}</span>
        </div>
        <div class="category-card-bar">
          <div class="category-card-bar-fill" style="width:${Math.min(data.techStack.length * 10, 100)}%;background:#6C5CE7"></div>
        </div>
      </div>
    </div>
  `;
}

function calcCategoryScore(items) {
  if (items.length === 0) return 0;
  let score = 0;
  for (const item of items) {
    if (item.status === 'pass') score += 100;
    else if (item.status === 'warn') score += 50;
    else if (item.status === 'info') score += 70;
  }
  return Math.round(score / items.length);
}

function getScoreColor(score) {
  if (score >= 80) return '#00b894';
  if (score >= 50) return '#fdcb6e';
  return '#e17055';
}

function renderStack(stack) {
  if (stack.length === 0) {
    return '<div class="empty-state"><div class="empty-state-icon">🔍</div>No technologies detected</div>';
  }

  const categories = {};
  for (const item of stack) {
    if (!categories[item.category]) categories[item.category] = [];
    categories[item.category].push(item);
  }

  let html = '';
  for (const [category, items] of Object.entries(categories)) {
    html += `<div class="section-title">${category}</div>`;
    for (const item of items) {
      html += `
        <div class="item">
          <div class="item-icon blue">⚡</div>
          <div class="item-info">
            <div class="item-name">${item.name}</div>
          </div>
          <span class="item-badge info">Detected</span>
        </div>
      `;
    }
  }
  return html;
}

function renderItems(items, title) {
  if (items.length === 0) {
    return '<div class="empty-state"><div class="empty-state-icon">📋</div>No data available</div>';
  }

  let html = `<div class="section-title">${title}</div>`;
  for (const item of items) {
    html += `
      <div class="item">
        <div class="item-icon ${item.iconClass}">${item.icon}</div>
        <div class="item-info">
          <div class="item-name">${item.name}</div>
          <div class="item-detail">${item.detail}</div>
        </div>
        <span class="item-badge ${item.status}">${item.status === 'pass' ? 'Pass' : item.status === 'warn' ? 'Warn' : item.status === 'fail' ? 'Fail' : 'Info'}</span>
      </div>
    `;
  }
  return html;
}

document.addEventListener('DOMContentLoaded', init);
