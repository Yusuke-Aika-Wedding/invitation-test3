(() => {
  'use strict';

  const config = window.WEDDING_CONFIG || {};
  const GUEST_ID_STORAGE_KEY = 'yusuke-aika-wedding-guest-id-v1';
  const targetDate = new Date(config.weddingDateIso || '2027-03-21T10:00:00+09:00');
  const puzzleOpenDate = new Date(config.finalPuzzleOpenIso || '2026-08-11T18:30:00+09:00');
  const els = {};
  let guestId = '';
  let latestStatus = { completed: false, attending: false };
  let currentSlide = 0;
  let authenticated = false;

  document.addEventListener('DOMContentLoaded', init);
  window.addEventListener('resize', setViewportHeight, { passive: true });
  window.addEventListener('hashchange', applyRoute);

  function init() {
    cacheElements();
    setViewportHeight();
    setupAuth();
    setupOverlay();
    setupMenu();
    setupFadeIn();
    setupCountdown();
    setupCarousel();
    setupAllergyFields();
    setupForm();
    createPetals();
    updateFinalPuzzleAvailability();
  }

  function cacheElements() {
    Object.assign(els, {
      authOverlay: document.getElementById('authOverlay'),
      authForm: document.getElementById('authForm'),
      guestIdEntry: document.getElementById('guestIdEntry'),
      authButton: document.getElementById('authButton'),
      authStatus: document.getElementById('authStatus'),
      overlay: document.getElementById('messageOverlay'),
      messageGuestName: document.getElementById('messageGuestName'),
      messageBody: document.getElementById('messageBody'),
      form: document.getElementById('rsvpForm'),
      thanks: document.getElementById('thanksMessage'),
      formStatus: document.getElementById('formStatus'),
      submitButton: document.getElementById('submitButton'),
      guestIdInput: document.getElementById('guestId'),
      nameInput: document.getElementById('name'),
      emailInput: document.getElementById('email'),
      allergyDetailsField: document.getElementById('allergyDetailsField'),
      allergyDetailsInput: document.getElementById('allergyDetails'),
      guestMessageInput: document.getElementById('guestMessage'),
      days: document.getElementById('days'),
      hours: document.getElementById('hours'),
      minutes: document.getElementById('minutes'),
      seconds: document.getElementById('seconds'),
      menuButton: document.getElementById('menuButton'),
      menuPanel: document.getElementById('menuPanel'),
      menuGuestName: document.getElementById('menuGuestName'),
      changeIdButton: document.getElementById('changeIdButton'),
      finalPuzzleMenuLink: document.getElementById('finalPuzzleMenuLink'),
      invitationPage: document.getElementById('invitationPage'),
      profilePage: document.getElementById('profilePage'),
      finalPuzzlePage: document.getElementById('finalPuzzlePage')
    });
  }

  function setupAuth() {
    if (!els.authForm) return;

    els.authForm.addEventListener('submit', event => {
      event.preventDefault();
      authenticateGuest(els.guestIdEntry ? els.guestIdEntry.value : '');
    });

    const initialId = getInitialGuestId();
    if (initialId && els.guestIdEntry) {
      els.guestIdEntry.value = initialId;
      authenticateGuest(initialId, { returningGuest: true });
    }
  }

  function getInitialGuestId() {
    const params = new URLSearchParams(location.search);
    const fromUrl = params.get('id') || params.get('guest') || params.get('g');
    if (fromUrl) return normalizeGuestId(fromUrl);
    try {
      return normalizeGuestId(localStorage.getItem(GUEST_ID_STORAGE_KEY) || '');
    } catch (_) {
      return '';
    }
  }

  async function authenticateGuest(rawId, options = {}) {
    const candidate = normalizeGuestId(rawId);
    if (!candidate || !/^[A-Za-z0-9_-]{4,64}$/.test(candidate)) {
      setAuthStatus('IDを半角英数字で正しく入力してください。', 'error');
      if (els.guestIdEntry) els.guestIdEntry.focus();
      return;
    }
    if (!isGasConfigured()) {
      setAuthStatus('GASのWebアプリURLが未設定です。先にセットアップを完了してください。', 'error');
      return;
    }

    setAuthLoading(true);
    setAuthStatus(options.returningGuest ? '招待状を準備しています。' : 'IDを確認しています。', '');
    try {
      const result = await jsonp('status', { guestId: candidate });
      if (!result || !result.ok) throw new Error((result && result.error) || 'IDを確認できませんでした。');

      guestId = normalizeGuestId(result.guestId || candidate);
      latestStatus = {
        completed: Boolean(result.completed),
        attending: Boolean(result.attending)
      };
      try {
        localStorage.setItem(GUEST_ID_STORAGE_KEY, guestId);
      } catch (_) {
        // ストレージを使用できない環境では、次回のみ再入力になります。
      }

      hydrateGuest(result);
      revealAuthenticatedSite();
      removeIdFromAddressBar();
    } catch (error) {
      try {
        localStorage.removeItem(GUEST_ID_STORAGE_KEY);
      } catch (_) {
        // 何もしません。
      }
      setAuthStatus(`IDを確認できませんでした。${error.message || '入力内容をご確認ください。'}`, 'error');
      if (els.guestIdEntry) {
        els.guestIdEntry.select();
        els.guestIdEntry.focus();
      }
    } finally {
      setAuthLoading(false);
    }
  }

  function normalizeGuestId(value) {
    return String(value || '')
      .trim()
      .replace(/^https?:\/\/[^/]+\//i, '')
      .replace(/^.*[?&](?:id|guest|g)=/i, '')
      .replace(/^\/+|\/+$/g, '');
  }

  function hydrateGuest(status) {
    const displayName = String(status.displayName || 'ゲスト').trim();
    document.body.dataset.defaultName = displayName;
    if (els.guestIdInput) els.guestIdInput.value = guestId;
    if (els.nameInput) els.nameInput.value = displayName;
    if (els.emailInput) els.emailInput.value = status.email || '';
    if (els.guestMessageInput) els.guestMessageInput.value = status.message || '';
    if (els.menuGuestName) els.menuGuestName.textContent = `${displayName} 様`;
    if (status.ceremonyAttendance) checkRadio('ceremonyAttendance', status.ceremonyAttendance);
    if (status.receptionAttendance) checkRadio('receptionAttendance', status.receptionAttendance);
    hydrateAllergy(status.allergy || '');
    renderMessage(latestStatus);
  }

  function hydrateAllergy(allergy) {
    const value = String(allergy || '').trim();
    if (!value) {
      updateAllergyFields();
      return;
    }
    if (value === 'なし') {
      checkRadio('allergyChoice', 'なし');
      if (els.allergyDetailsInput) els.allergyDetailsInput.value = '';
    } else {
      checkRadio('allergyChoice', 'あり');
      if (els.allergyDetailsInput) els.allergyDetailsInput.value = value;
    }
    updateAllergyFields();
  }

  function revealAuthenticatedSite() {
    authenticated = true;
    document.body.classList.remove('auth-locked');
    document.body.classList.add('has-overlay');
    if (els.authOverlay) {
      els.authOverlay.classList.add('is-closing');
      window.setTimeout(() => { els.authOverlay.hidden = true; }, 620);
    }
    if (els.overlay) {
      els.overlay.hidden = false;
      els.overlay.classList.remove('is-closing');
    }
    updateFinalPuzzleAvailability();
    applyRoute();
  }

  function removeIdFromAddressBar() {
    if (!location.search || !window.history || !window.history.replaceState) return;
    window.history.replaceState(null, '', `${location.pathname}${location.hash || ''}`);
  }

  function resetToAuth() {
    authenticated = false;
    guestId = '';
    latestStatus = { completed: false, attending: false };
    try {
      localStorage.removeItem(GUEST_ID_STORAGE_KEY);
    } catch (_) {
      // 何もしません。
    }
    closeMenu();
    document.body.classList.add('auth-locked');
    document.body.classList.remove('has-overlay');
    document.body.dataset.defaultName = '';
    if (els.overlay) els.overlay.hidden = true;
    if (els.authOverlay) {
      els.authOverlay.hidden = false;
      els.authOverlay.classList.remove('is-closing');
    }
    if (els.authForm) els.authForm.reset();
    if (els.form) els.form.reset();
    updateAllergyFields();
    setFormCompleted(false, false);
    setAuthStatus('', '');
    window.history.replaceState(null, '', location.pathname);
    window.setTimeout(() => { if (els.guestIdEntry) els.guestIdEntry.focus(); }, 50);
  }

  function setAuthLoading(loading) {
    if (!els.authButton) return;
    els.authButton.disabled = loading;
    els.authButton.textContent = loading ? 'Checking...' : 'Open Invitation';
  }

  function setAuthStatus(message, type) {
    if (!els.authStatus) return;
    els.authStatus.textContent = message || '';
    els.authStatus.classList.toggle('is-error', type === 'error');
    els.authStatus.classList.toggle('is-success', type === 'success');
  }

  function setViewportHeight() {
    document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
  }

  function isGasConfigured() {
    return typeof config.gasWebAppUrl === 'string'
      && config.gasWebAppUrl.startsWith('https://script.google.com/')
      && !config.gasWebAppUrl.includes('PASTE_YOUR_GAS_WEB_APP_URL_HERE');
  }

  function getDisplayName() {
    const fromInput = els.nameInput ? els.nameInput.value.trim() : '';
    const fromBody = document.body ? document.body.dataset.defaultName : '';
    return fromInput || fromBody || 'ゲスト';
  }

  function renderMessage(status) {
    latestStatus = {
      completed: Boolean(status && status.completed),
      attending: Boolean(status && status.attending)
    };

    const displayName = getDisplayName();
    if (els.messageGuestName) els.messageGuestName.textContent = `${displayName}様`;

    let lines;
    if (!latestStatus.completed) {
      lines = [
        'この度、白戸祐輔と大貫愛佳は',
        '結婚することとなりました。',
        'つきましては、結婚式へのご出欠について、',
        'ご入力・ご回答をお願いいたします。',
        '皆様と当日お会いできますことを、',
        '心より楽しみにしております。'
      ];
    } else if (latestStatus.attending) {
      lines = [
        '結婚式へのご出欠について、',
        'ご回答いただき、誠にありがとうございました。',
        '皆様と当日お会いできますことを、',
        '心より楽しみにしております！'
      ];
    } else {
      lines = [
        '結婚式へのご出欠について、',
        'ご回答いただき、誠にありがとうございました。',
        'またお会いできる日を楽しみにしております。'
      ];
    }

    if (els.messageBody) els.messageBody.innerHTML = lines.join('<br>');
    setFormCompleted(latestStatus.completed, latestStatus.attending);
  }

  function setFormCompleted(completed, attending) {
    if (els.form) els.form.classList.toggle('is-hidden', Boolean(completed));
    if (els.thanks) {
      els.thanks.classList.toggle('is-hidden', !completed);
      const title = els.thanks.querySelector('strong');
      const text = els.thanks.querySelector('p');
      if (title) title.textContent = 'ご回答ありがとうございました！';
      if (text) {
        text.textContent = attending
          ? '当日お会いできますことを、心より楽しみにしております。'
          : 'またお会いできる日を楽しみにしております。';
      }
    }
  }

  function setupOverlay() {
    if (!els.overlay) return;
    const openInvitation = () => {
      els.overlay.classList.add('is-closing');
      document.body.classList.remove('has-overlay');
      window.setTimeout(() => { els.overlay.hidden = true; }, 780);
    };
    els.overlay.addEventListener('click', openInvitation);
    els.overlay.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openInvitation();
      }
    });
  }

  function setupMenu() {
    if (!els.menuButton || !els.menuPanel) return;
    els.menuButton.addEventListener('click', () => {
      const open = !els.menuPanel.classList.contains('is-open');
      els.menuPanel.classList.toggle('is-open', open);
      els.menuButton.classList.toggle('is-open', open);
      els.menuButton.setAttribute('aria-expanded', String(open));
    });
    els.menuPanel.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
    if (els.changeIdButton) els.changeIdButton.addEventListener('click', resetToAuth);
    document.addEventListener('click', event => {
      if (!event.target.closest('.top-menu')) closeMenu();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeMenu();
    });
  }

  function closeMenu() {
    if (!els.menuButton || !els.menuPanel) return;
    els.menuPanel.classList.remove('is-open');
    els.menuButton.classList.remove('is-open');
    els.menuButton.setAttribute('aria-expanded', 'false');
  }

  function isFinalPuzzleOpen() {
    return Number.isFinite(puzzleOpenDate.getTime()) && Date.now() >= puzzleOpenDate.getTime();
  }

  function updateFinalPuzzleAvailability() {
    const isOpen = isFinalPuzzleOpen();
    if (els.finalPuzzleMenuLink) els.finalPuzzleMenuLink.classList.toggle('is-hidden', !isOpen);
    if (authenticated && !isOpen && ['#final-puzzle', '#puzzle', '#final'].includes(location.hash.toLowerCase())) {
      window.history.replaceState(null, '', `${location.pathname}#invitation`);
      applyRoute();
    }
  }

  function applyRoute() {
    if (!authenticated) return;
    const routeRaw = (location.hash || '#invitation').replace('#', '').toLowerCase();
    const requested = routeRaw === 'puzzle' || routeRaw === 'final' ? 'final-puzzle' : routeRaw;
    const finalAllowed = requested !== 'final-puzzle' || isFinalPuzzleOpen();
    const active = finalAllowed && ['invitation', 'profile', 'final-puzzle'].includes(requested)
      ? requested
      : 'invitation';

    Object.entries({
      invitation: els.invitationPage,
      profile: els.profilePage,
      'final-puzzle': els.finalPuzzlePage
    }).forEach(([key, page]) => {
      if (page) page.classList.toggle('is-hidden', key !== active);
    });
    document.querySelectorAll('[data-nav]').forEach(item => {
      item.classList.toggle('is-current', item.dataset.nav === active);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setupFadeIn() {
    const nodes = document.querySelectorAll('.fade-in');
    if (!('IntersectionObserver' in window)) {
      nodes.forEach(node => node.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    nodes.forEach(node => observer.observe(node));
  }

  function setupCountdown() {
    const tick = () => {
      const diff = Math.max(0, targetDate.getTime() - Date.now());
      const totalSeconds = Math.floor(diff / 1000);
      const days = Math.floor(totalSeconds / 86400);
      const hours = Math.floor((totalSeconds % 86400) / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      setText(els.days, days);
      setText(els.hours, pad2(hours));
      setText(els.minutes, pad2(minutes));
      setText(els.seconds, pad2(seconds));
      updateFinalPuzzleAvailability();
    };
    tick();
    window.setInterval(tick, 1000);
  }

  function setupCarousel() {
    const slides = Array.from(document.querySelectorAll('.hero-slide'));
    const dots = Array.from(document.querySelectorAll('.slide-dot'));
    if (slides.length <= 1) return;
    const show = index => {
      currentSlide = ((index % slides.length) + slides.length) % slides.length;
      slides.forEach((slide, i) => slide.classList.toggle('is-active', i === currentSlide));
      dots.forEach((dot, i) => dot.classList.toggle('is-active', i === currentSlide));
    };
    dots.forEach((dot, i) => dot.addEventListener('click', () => show(i)));
    show(0);
    window.setInterval(() => show(currentSlide + 1), 5000);
  }

  function setupAllergyFields() {
    document.querySelectorAll('input[name="allergyChoice"]').forEach(radio => {
      radio.addEventListener('change', updateAllergyFields);
    });
    updateAllergyFields();
  }

  function updateAllergyFields() {
    const selected = document.querySelector('input[name="allergyChoice"]:checked');
    const hasAllergy = selected && selected.value === 'あり';
    if (els.allergyDetailsField) els.allergyDetailsField.classList.toggle('is-hidden', !hasAllergy);
    if (els.allergyDetailsInput) {
      els.allergyDetailsInput.required = Boolean(hasAllergy);
      if (!hasAllergy) els.allergyDetailsInput.value = '';
    }
  }

  function setupForm() {
    if (!els.form) return;
    els.form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!guestId || !authenticated) {
        setStatus('IDの認証情報がありません。IDを再入力してください。', 'error');
        return;
      }
      if (!isGasConfigured()) {
        setStatus('GASのWebアプリURLが未設定です。', 'error');
        return;
      }
      if (!els.form.checkValidity()) {
        els.form.reportValidity();
        setStatus('必須項目を入力・選択してください。', 'error');
        return;
      }

      const formData = new FormData(els.form);
      const payload = Object.fromEntries(formData.entries());
      payload.guestId = guestId;
      payload.name = String(payload.name || '').trim();
      payload.email = String(payload.email || '').trim();
      payload.allergyDetails = String(payload.allergyDetails || '').trim();
      payload.message = String(payload.message || '').trim();
      payload.allergy = payload.allergyChoice === 'なし' ? 'なし' : payload.allergyDetails;

      if (payload.allergyChoice === 'あり' && !payload.allergyDetails) {
        setStatus('アレルギーの詳細を入力してください。', 'error');
        if (els.allergyDetailsInput) els.allergyDetailsInput.focus();
        return;
      }

      setLoading(true);
      setStatus('送信しています。画面を閉じずにお待ちください。', '');
      try {
        const result = await jsonp('submit', payload);
        if (!result || !result.ok) throw new Error((result && result.error) || '送信に失敗しました。');
        if (els.nameInput && result.displayName) els.nameInput.value = result.displayName;
        renderMessage({ completed: true, attending: Boolean(result.attending) });
        setStatus('ご回答ありがとうございました。確認メールをご確認ください。', 'success');
        const target = document.getElementById('rsvp');
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (error) {
        setStatus(`送信できませんでした。${error.message || 'GASの設定を確認してください。'}`, 'error');
      } finally {
        setLoading(false);
      }
    });
  }

  function checkRadio(name, value) {
    const radio = Array.from(document.querySelectorAll(`input[name="${name}"]`))
      .find(input => input.value === value);
    if (radio) radio.checked = true;
  }

  function jsonp(action, params = {}) {
    return new Promise((resolve, reject) => {
      let url;
      try {
        url = new URL(config.gasWebAppUrl);
      } catch (_) {
        reject(new Error('GASのWebアプリURLが正しくありません。'));
        return;
      }
      const callbackName = `__weddingJsonp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      url.searchParams.set('action', action);
      url.searchParams.set('callback', callbackName);
      url.searchParams.set('_', String(Date.now()));
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      });

      const script = document.createElement('script');
      const timer = window.setTimeout(() => cleanup(new Error('通信がタイムアウトしました。')), 22000);
      window[callbackName] = data => cleanup(null, data);
      script.onerror = () => cleanup(new Error('GASと通信できませんでした。'));
      script.src = url.toString();
      document.body.appendChild(script);

      function cleanup(error, data) {
        window.clearTimeout(timer);
        delete window[callbackName];
        if (script.parentNode) script.parentNode.removeChild(script);
        if (error) reject(error);
        else resolve(data);
      }
    });
  }

  function createPetals() {
    const layer = document.querySelector('.petal-layer');
    if (!layer) return;
    layer.innerHTML = '';
    const isSmallScreen = window.matchMedia('(max-width: 640px)').matches;
    const count = isSmallScreen ? 44 : 78;

    for (let i = 0; i < count; i++) {
      const petal = document.createElement('span');
      const duration = 8 + Math.random() * 12;
      petal.className = 'petal';
      petal.style.setProperty('--left', `${Math.random() * 100}%`);
      petal.style.setProperty('--static-top', `${Math.random() * 100}%`);
      petal.style.setProperty('--size', `${7 + Math.random() * 19}px`);
      petal.style.setProperty('--rotate', `${Math.random() * 360}deg`);
      petal.style.setProperty('--alpha', `${0.28 + Math.random() * 0.42}`);
      petal.style.setProperty('--drift', `${(Math.random() * 58 - 29).toFixed(1)}vw`);
      petal.style.setProperty('--duration', `${duration.toFixed(1)}s`);
      petal.style.setProperty('--delay', `${(-Math.random() * duration).toFixed(1)}s`);
      layer.appendChild(petal);
    }
  }

  function setLoading(loading) {
    if (!els.submitButton) return;
    els.submitButton.disabled = loading;
    els.submitButton.textContent = loading ? 'Sending...' : 'Send Reply';
  }

  function setStatus(message, type) {
    if (!els.formStatus) return;
    els.formStatus.textContent = message || '';
    els.formStatus.classList.toggle('is-error', type === 'error');
    els.formStatus.classList.toggle('is-success', type === 'success');
  }

  function pad2(value) { return String(value).padStart(2, '0'); }
  function setText(element, value) { if (element) element.textContent = String(value); }
})();
