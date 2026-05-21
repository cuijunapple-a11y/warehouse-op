/* ==========================================================================
   Warehouse Clock-in — Mobile Logic
   Handles: code entry → verify → action selection → clockin submit → reset
   ========================================================================== */

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────
  const state = {
    currentScreen: 'code',   // 'code' | 'actions' | 'input'
    codeDigits: [],           // max 4
    dailyToken: null,
    currentEmployee: null,    // { name, nameCn }
    selectedAction: null,     // e.g. 'take-task', 'transfer'
    isLoading: false,
  };

  // ── Action definitions ─────────────────────────────────────────────────
  const ACTIONS = {
    'checkin':     { cn: '到岗', en: 'Check In', needsInput: false },
    'take-task':   { cn: '领任务', en: 'Take Task', needsInput: 'task' },
    'return-task': { cn: '还任务', en: 'Return Task', needsInput: false },
    'break':       { cn: '休息', en: 'Break', needsInput: false },
    'lunch':       { cn: '午餐', en: 'Lunch', needsInput: false },
    'checkout':    { cn: '下班', en: 'Check Out', needsInput: false },
    'transfer':    { cn: '借调', en: 'Transfer', needsInput: 'group' },
  };

  // ── DOM refs (cached on init) ──────────────────────────────────────────
  let $screens, $dots, $errorMsg, $confirmBtn, $spinner;
  let $welcomeCn, $welcomeEn;
  let $overlay, $overlayTextCn, $overlayTextEn;
  let $inputSections, $taskInput;

  // ── Initialisation ─────────────────────────────────────────────────────
  function init() {
    // Parse token from URL
    const params = new URLSearchParams(window.location.search);
    state.dailyToken = params.get('token');

    if (!state.dailyToken) {
      document.body.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;height:100dvh;' +
        'color:#94a3b8;font-family:Inter,sans-serif;text-align:center;padding:24px;">' +
        '<div><p style="font-size:1.2rem;margin-bottom:8px;">⚠️ 缺少令牌</p>' +
        '<p style="font-size:0.85rem;color:#64748b;">Missing token. Please scan the QR code.</p></div></div>';
      return;
    }

    // Cache DOM elements
    $screens = {
      code: document.getElementById('screen-code'),
      actions: document.getElementById('screen-actions'),
      input: document.getElementById('screen-input'),
    };
    $dots = document.querySelectorAll('.code-dot');
    $errorMsg = document.getElementById('error-message');
    $confirmBtn = document.getElementById('btn-confirm');
    $spinner = document.getElementById('spinner-code');
    $welcomeCn = document.getElementById('welcome-cn');
    $welcomeEn = document.getElementById('welcome-en');
    $overlay = document.getElementById('overlay-success');
    $overlayTextCn = document.getElementById('overlay-text-cn');
    $overlayTextEn = document.getElementById('overlay-text-en');
    $inputSections = {
      task: document.getElementById('input-task'),
      group: document.getElementById('input-group'),
    };
    $taskInput = document.getElementById('task-number-input');

    // Attach numpad listeners
    document.querySelectorAll('.numpad-btn').forEach(function (btn) {
      btn.addEventListener('click', handleNumpadClick);
    });

    // Attach action button listeners
    document.querySelectorAll('.action-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectAction(btn.dataset.action);
      });
    });

    // Back buttons
    document.getElementById('btn-logout').addEventListener('click', function () {
      resetState();
      showScreen('code');
    });
    document.getElementById('btn-back-input').addEventListener('click', function () {
      showScreen('actions');
    });

    // Task submit
    document.getElementById('btn-submit-task').addEventListener('click', function () {
      var taskNo = ($taskInput.value || '').trim();
      if (!taskNo) return;
      submitClockin('take-task', { taskNo: taskNo });
    });

    // Group buttons
    document.querySelectorAll('.group-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        submitClockin('transfer', { group: btn.dataset.group });
      });
    });

    // Keyboard support (for desktop testing)
    document.addEventListener('keydown', handleKeydown);

    // Show code screen
    showScreen('code');
  }

  // ── Numpad handling ────────────────────────────────────────────────────
  function handleNumpadClick(e) {
    var btn = e.currentTarget;
    var role = btn.dataset.role;

    if (state.isLoading) return;

    if (role === 'backspace') {
      removeDigit();
    } else if (role === 'confirm') {
      submitCode();
    } else if (role === 'digit') {
      addDigit(btn.dataset.value);
    }
  }

  function handleKeydown(e) {
    if (state.currentScreen !== 'code' || state.isLoading) return;

    if (e.key >= '0' && e.key <= '9') {
      addDigit(e.key);
    } else if (e.key === 'Backspace') {
      removeDigit();
    } else if (e.key === 'Enter') {
      submitCode();
    }
  }

  function addDigit(d) {
    if (state.codeDigits.length >= 4) return;

    state.codeDigits.push(d);
    updateDots();
    vibrate();
    hideError();
    updateConfirmState();
  }

  function removeDigit() {
    if (state.codeDigits.length === 0) return;

    state.codeDigits.pop();
    updateDots();
    vibrate();
    hideError();
    updateConfirmState();
  }

  function updateDots() {
    $dots.forEach(function (dot, i) {
      if (i < state.codeDigits.length) {
        dot.classList.add('filled');
      } else {
        dot.classList.remove('filled');
      }
    });
  }

  function updateConfirmState() {
    if (state.codeDigits.length === 4) {
      $confirmBtn.classList.remove('disabled');
    } else {
      $confirmBtn.classList.add('disabled');
    }
  }

  // ── Code submission & verify ───────────────────────────────────────────
  function submitCode() {
    if (state.codeDigits.length !== 4 || state.isLoading) return;

    var code = state.codeDigits.join('');
    setLoading(true);

    apiPost('/api/clockin', {
      token: state.dailyToken,
      code: code,
      type: 'verify',
    })
      .then(function (data) {
        setLoading(false);

        if (data.success && data.employee) {
          state.currentEmployee = data.employee;
          var nameCn = data.employee.nameCn || data.employee.name || '';
          var nameEn = data.employee.name || '';

          $welcomeCn.textContent = '欢迎, ' + nameCn;
          $welcomeEn.textContent = 'Welcome, ' + nameEn;

          showScreen('actions');
        } else {
          showError(data.error || '员工代码无效 / Invalid employee code');
        }
      })
      .catch(function (err) {
        setLoading(false);
        showError('网络错误 / Network error');
        console.error('Verify failed:', err);
      });
  }

  // ── Action selection ───────────────────────────────────────────────────
  function selectAction(actionType) {
    if (state.isLoading) return;

    var action = ACTIONS[actionType];
    if (!action) return;

    state.selectedAction = actionType;

    if (action.needsInput) {
      // Show the sub-input screen
      showInputSection(action.needsInput);
      showScreen('input');
    } else {
      // Submit directly
      submitClockin(actionType, {});
    }
  }

  function showInputSection(type) {
    // Hide all input sections
    Object.values($inputSections).forEach(function (el) {
      if (el) el.classList.remove('active');
    });

    // Show the relevant one
    if ($inputSections[type]) {
      $inputSections[type].classList.add('active');
    }

    // Clear previous input
    if ($taskInput) $taskInput.value = '';
  }

  // ── Clockin submission ─────────────────────────────────────────────────
  function submitClockin(type, extra) {
    if (state.isLoading) return;

    var code = state.codeDigits.join('');
    var body = {
      token: state.dailyToken,
      code: code,
      type: type,
    };

    if (extra.taskNo) body.taskNo = extra.taskNo;
    if (extra.group) body.group = extra.group;

    setLoading(true);

    apiPost('/api/clockin', body)
      .then(function (data) {
        setLoading(false);

        if (data.success) {
          var action = ACTIONS[type] || { cn: type, en: type };
          showSuccess(action.cn, action.en);
        } else {
          showError(data.error || '操作失败 / Action failed');
        }
      })
      .catch(function (err) {
        setLoading(false);
        showError('网络错误 / Network error');
        console.error('Clockin failed:', err);
      });
  }

  // ── Screen transitions ─────────────────────────────────────────────────
  function showScreen(screenId) {
    state.currentScreen = screenId;

    Object.keys($screens).forEach(function (key) {
      var el = $screens[key];
      if (!el) return;

      if (key === screenId) {
        el.classList.add('active');
        el.classList.remove('exit-down');
      } else {
        el.classList.remove('active');
      }
    });
  }

  // ── Success overlay ────────────────────────────────────────────────────
  function showSuccess(textCn, textEn) {
    $overlayTextCn.textContent = textCn + ' 成功';
    $overlayTextEn.textContent = textEn + ' Successful';
    $overlay.classList.add('visible');

    setTimeout(function () {
      $overlay.classList.remove('visible');

      // After overlay fade-out animation completes, reset
      setTimeout(function () {
        resetState();
        showScreen('code');
      }, 350);
    }, 2000);
  }

  // ── Error display ──────────────────────────────────────────────────────
  function showError(msg) {
    $errorMsg.textContent = msg;
    $errorMsg.classList.add('visible');

    // Shake the dots
    var dotsContainer = document.querySelector('.code-dots');
    dotsContainer.classList.add('shake');

    setTimeout(function () {
      dotsContainer.classList.remove('shake');
    }, 600);

    // Clear dots after shake
    setTimeout(function () {
      state.codeDigits = [];
      updateDots();
      updateConfirmState();
    }, 800);
  }

  function hideError() {
    $errorMsg.classList.remove('visible');
  }

  // ── Loading state ──────────────────────────────────────────────────────
  function setLoading(loading) {
    state.isLoading = loading;

    if ($spinner) {
      if (loading) {
        $spinner.classList.add('visible');
        $confirmBtn.classList.add('disabled');
      } else {
        $spinner.classList.remove('visible');
        updateConfirmState();
      }
    }
  }

  // ── Reset ──────────────────────────────────────────────────────────────
  function resetState() {
    state.codeDigits = [];
    state.currentEmployee = null;
    state.selectedAction = null;
    state.isLoading = false;

    updateDots();
    updateConfirmState();
    hideError();

    if ($taskInput) $taskInput.value = '';

    // Hide all input sections
    Object.values($inputSections).forEach(function (el) {
      if (el) el.classList.remove('active');
    });
  }

  // ── API helper ─────────────────────────────────────────────────────────
  function apiPost(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (res) {
      if (!res.ok) {
        return res.json().then(function (data) {
          return Promise.reject(data);
        }).catch(function () {
          return Promise.reject(new Error('HTTP ' + res.status));
        });
      }
      return res.json();
    });
  }

  // ── Haptic feedback ────────────────────────────────────────────────────
  function vibrate() {
    if (navigator.vibrate) {
      navigator.vibrate(35);
    }
  }

  // ── Boot ───────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
