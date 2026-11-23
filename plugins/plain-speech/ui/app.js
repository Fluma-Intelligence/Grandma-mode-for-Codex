(() => {
  const { t, label } = window.plainSpeechLocale;
  const get = (id) => document.getElementById(id);
  const source = get('source');
  const output = get('answer');
  const notice = get('notice');
  const status = get('status');
  const loading = get('loading');
  const original = get('original');
  const button = get('translate');
  const example = get('example');
  const copy = get('copy');
  const retry = get('retry');
  const history = get('history');
  const historyToggle = get('history-toggle');
  const historyPanel = get('history-panel');
  const historyNotice = get('history-notice');
  const replyList = get('reply-list');
  const moreReplies = get('more-replies');
  const replyButton = get('translate-reply');
  const selectionButton = get('translate-selection');
  const standalone = window.parent === window && !window.openai?.callTool;
  const latestMode = !standalone && ['current', 'latest'].includes(document.body.dataset.mode);
  const linkedMode = !standalone && document.body.dataset.mode === 'linked';
  let busy = false;
  let answer = '';
  let answerSource = '';
  let firstAnswer = '';
  let sourceTarget;
  let edited = false;
  let linkedThread;
  let view = 0;
  let sourcePending = false;
  let historyPending = false;
  let historyLoaded = false;
  let historyCursor;
  const listed = new Set();
  let sample;
  let snapshot;
  let extraPending = false;
  let cachedDiagramPending;
  let modelRevision = 0;
  let lockModelSelection;
  const views = window.createPlainSpeechViews({ onTab: switchView, onAction: loadExtraView });

  function hasChat() {
    return latestMode || Boolean(linkedThread);
  }

  function wantsLatest() {
    return hasChat() && (!edited || !source.value.trim());
  }

  function selectedRange() {
    const { selectionStart: start, selectionEnd: end } = source;
    return start !== end && source.value.slice(start, end).trim() ? { start, end } : undefined;
  }

  function sync() {
    const unavailable = busy || sourcePending || extraPending;
    button.disabled = unavailable;
    source.readOnly = unavailable;
    copy.disabled = !answer;
    retry.disabled = unavailable || !answer || !answerSource;
    example.hidden = unavailable || Boolean(source.value.trim());
    loading.hidden = !busy;
    history.hidden = !hasChat();
    moreReplies.hidden = !historyCursor;
    moreReplies.disabled = historyPending;
    replyButton.hidden = !sourceTarget;
    replyButton.disabled = unavailable;
    selectionButton.hidden = standalone || !original.open || !selectedRange();
    selectionButton.disabled = unavailable;
    for (const action of replyList.querySelectorAll('button')) action.disabled = unavailable;
    views.setBusy(unavailable);
    lockModelSelection?.(unavailable);
    label(get('action-label'), wantsLatest() ? 'latest' : 'title');
  }

  function showNotice(key) {
    notice.hidden = !key;
    label(notice, key);
  }

  function syncOriginalLabel() {
    const summary = original.querySelector('summary');
    const message = t(original.open ? 'closeOriginal' : 'openOriginal');
    summary.setAttribute('aria-label', message);
    summary.title = message;
    label(get('original-title'), original.open ? 'original' : 'sealedSource');
    label(get('original-hint'), original.open ? 'sealSource' : 'unsealSource');
  }
  original.addEventListener('toggle', () => {
    syncOriginalLabel();
    if (original.open && hasChat() && !source.value && !busy && !sourcePending && !extraPending && !edited) loadSource(sourceTarget);
    sync();
  });
  window.addEventListener('languagechange', syncOriginalLabel);

  function prefill(text) {
    if (!text || edited || busy || sourcePending || snapshot?.target || source.value) return;
    source.value = text;
    setSnapshot({ source: text });
    if (answer && !answerSource) answerSource = text;
    sync();
  }

  function clear() {
    answer = '';
    answerSource = '';
    label(output, 'waiting');
    output.classList.add('placeholder');
    label(get('copy-label'), 'copy');
    showNotice(null);
  }

  source.addEventListener('input', () => {
    edited = true;
    sourceTarget = undefined;
    setSnapshot(source.value.trim() ? { source: source.value.trim() } : undefined);
    clear();
    sync();
  });

  example.addEventListener('click', () => {
    edited = true;
    sourceTarget = undefined;
    sample = { source: t('sampleSource'), answer: t('sampleAnswer'), alternate: t('sampleAlternate') };
    source.value = sample.source;
    setSnapshot({ source: sample.source });
    clear();
    sync();
    views.select('text');
    button.focus();
  });

  for (const event of ['selectionchange', 'select', 'keyup', 'pointerup']) {
    source.addEventListener(event, () => {
      selectionButton.hidden = standalone || !original.open || !selectedRange();
    });
  }

  function chatArgs(arguments_ = {}) {
    return linkedThread ? { ...arguments_, threadId: linkedThread } : arguments_;
  }

  function checkResult(result) {
    if (result?.structuredContent?.error) throw new Error(result.structuredContent.code || 'retry');
    if (result?.isError) throw new Error('retry');
    return result;
  }

  function showSource(text, target) {
    source.value = text;
    source.setSelectionRange(0, 0);
    sourceTarget = target;
    edited = false;
  }

  function setSnapshot(next) {
    const key = next && JSON.stringify([next.source, next.target?.turnId, next.target?.messageId, next.target?.hash,
      next.selection?.start, next.selection?.end]);
    if (key === snapshot?.key) return false;
    snapshot = next ? { ...next, key } : undefined;
    firstAnswer = '';
    views.reset();
    return true;
  }

  function captureSelection() {
    const selection = original.open && selectedRange();
    if (!selection) return;
    const text = source.value.slice(selection.start, selection.end);
    const picked = sourceTarget ? { source: text, target: sourceTarget, selection } : { source: text };
    if (setSnapshot(picked)) clear();
  }

  function chooseReply(target, selection, text) {
    const current = snapshot?.target;
    if (current?.turnId === target.turnId && current.messageId === target.messageId
        && (!target.hash || current.hash === target.hash)
        && snapshot.selection?.start === selection?.start && snapshot.selection?.end === selection?.end) return;
    if (!selection) showSource('', target);
    setSnapshot({ target, selection, source: text });
    clear();
  }

  function modelChanged() {
    modelRevision += 1;
    cachedDiagramPending = undefined;
    firstAnswer = '';
    views.reset();
    clear();
    label(status, null);
    sync();
    if (views.current() === 'diagram') loadExtraView('diagram', false);
  }

  function switchView(name) {
    if (name === 'text' || busy || sourcePending || extraPending) return;
    captureSelection();
    if (name === 'diagram') loadExtraView('diagram', false);
  }

  async function loadExtraView(action, generate) {
    if (busy || sourcePending || extraPending) return;
    if (generate) captureSelection();
    if (action === 'diagram' && views.hasDiagram()) return;
    const chosen = snapshot;
    if (!chosen?.source && !hasChat()) {
      if (generate) {
        original.open = true;
        source.focus();
      }
      return;
    }
    const currentView = view;
    const currentModel = modelRevision;
    if (!generate && cachedDiagramPending?.view === currentView && cachedDiagramPending.chosen === chosen) return;
    const request = { view: currentView, chosen };
    if (generate) {
      extraPending = true;
      views.showStatus(action, action === 'diagram' ? 'diagramWorking' : 'askWorking');
      sync();
    } else cachedDiagramPending = request;
    try {
      let result;
      if (standalone) {
        if (!generate) return;
        if (chosen?.source !== sample?.source) throw new Error('previewOnly');
        if (action === 'simpler' && !firstAnswer) throw new Error('simplerNeedsAnswer');
        result = { structuredContent: action === 'diagram' ? { diagram: { type: 'text', text: sample.answer } }
          : { translation: action === 'next' ? t('sampleNext') : action === 'simpler' ? t('sampleSimpler') : sample.answer } };
      } else {
        const args = chatArgs({ action, generate, ...(chosen?.target
          ? { target: chosen.target, ...(chosen.selection ? { selection: chosen.selection } : {}) }
          : chosen ? { source: chosen.source } : {}),
        ...(action === 'simpler' && firstAnswer ? { firstAnswer } : {}) });
        result = checkResult(await call('plain_speech_view', args, generate ? 108_000 : 14_000));
      }
      if (currentView !== view || currentModel !== modelRevision || snapshot !== chosen
          || (!generate && (busy || sourcePending || extraPending))) return;
      const data = result?.structuredContent;
      if (data?.diagram || data?.translation) {
        if (!chosen?.source && result._meta?.source) {
          showSource(result._meta.source, result._meta.target);
          setSnapshot({ source: result._meta.source, target: result._meta.target });
        }
        views.show(action, data);
      }
      if (generate) views.showStatus(action);
    } catch (error) {
      if (generate && currentView === view && snapshot === chosen) views.showStatus(action, error.message);
    } finally {
      if (generate && currentView === view) {
        extraPending = false;
        sync();
      }
      if (cachedDiagramPending === request) cachedDiagramPending = undefined;
    }
  }

  async function loadSource(target) {
    const currentView = view;
    if (target) chooseReply(target);
    sourcePending = true;
    showNotice('readingSource');
    sync();
    try {
      const result = checkResult(await call('read_plain_speech_reply', chatArgs(target ? { target } : {}), 14_000));
      if (view !== currentView) return;
      const data = result?._meta;
      if (typeof data?.source !== 'string' || !data.target) throw new Error('historyUnavailable');
      clear();
      showSource(data.source, data.target);
      setSnapshot({ source: data.source, target: data.target });
      original.open = true;
    } catch (error) {
      if (view === currentView) showNotice(error.message);
    } finally {
      if (view === currentView) {
        sourcePending = false;
        sync();
        if (views.current() === 'diagram') loadExtraView('diagram', false);
      }
    }
  }

  function addHistoryRow({ target, preview }) {
    const key = `${target.turnId}/${target.messageId}`;
    if (listed.has(key)) return;
    listed.add(key);
    const row = document.createElement('li');
    const open = document.createElement('button');
    const translate = document.createElement('button');
    open.type = translate.type = 'button';
    open.className = 'reply-preview';
    open.textContent = preview;
    open.addEventListener('click', () => loadSource(target));
    translate.className = 'quiet-action';
    label(translate, 'rewriteReply');
    translate.addEventListener('click', () => rewriteReply(target));
    row.append(open, translate);
    replyList.append(row);
  }

  async function loadHistory(cursor) {
    const currentView = view;
    historyPending = true;
    label(historyNotice, 'readingReplies');
    historyNotice.hidden = false;
    sync();
    try {
      const result = checkResult(await call('list_plain_speech_replies', chatArgs(cursor ? { cursor } : {}), 14_000));
      if (view !== currentView) return;
      const page = result?._meta;
      if (!Array.isArray(page?.replies)) throw new Error('historyUnavailable');
      for (const reply of page.replies) addHistoryRow(reply);
      historyLoaded = true;
      historyCursor = page.nextCursor;
      label(historyNotice, 'noReply');
      historyNotice.hidden = Boolean(historyCursor) || listed.size > 0;
    } catch (error) {
      if (view === currentView) label(historyNotice, error.message);
    } finally {
      if (view === currentView) {
        historyPending = false;
        sync();
      }
    }
  }

  historyToggle.addEventListener('click', () => {
    historyPanel.hidden = !historyPanel.hidden;
    historyToggle.setAttribute('aria-expanded', String(!historyPanel.hidden));
    if (!historyPanel.hidden && !historyLoaded && !historyPending) loadHistory();
  });
  moreReplies.addEventListener('click', () => loadHistory(historyCursor));

  source.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !button.disabled) {
      event.preventDefault();
      views.select('text');
      (selectedRange() && !selectionButton.hidden ? selectionButton : button).click();
    }
  });

  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(answer);
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(output);
      selection.removeAllRanges();
      selection.addRange(range);
      if (!document.execCommand('copy')) {
        showNotice('copying');
        return;
      }
      selection.removeAllRanges();
    }
    label(get('copy-label'), 'copied');
    label(status, 'copied');
  });

  function begin() {
    busy = true;
    if (!answer) {
      label(output, 'waiting');
      output.classList.add('placeholder');
    }
    output.setAttribute('aria-busy', 'true');
    showNotice(null);
    label(status, 'working');
    sync();
  }

  function finish(result, error, submittedSource = '', selection, previousRewrite) {
    try {
      if (error) throw error;
      checkResult(result);
      const translation = result?.structuredContent?.translation ?? result?.translation;
      if (typeof translation !== 'string' || !translation) throw new Error('retry');
      const loadedSource = result._meta?.source;
      if (typeof loadedSource === 'string' && !selection) showSource(loadedSource, result._meta.target);
      answer = translation;
      answerSource = selection ? submittedSource : loadedSource ?? (submittedSource || source.value.trim());
      if (!previousRewrite && answerSource) setSnapshot({ source: answerSource, target: result._meta?.target, selection });
      if (snapshot?.source === answerSource && !firstAnswer) firstAnswer = translation;
      delete output.dataset.i18n;
      output.textContent = answer;
      output.classList.remove('placeholder');
      label(get('copy-label'), 'copy');
      label(status, 'finished');
    } catch (error) {
      if (!answer) label(output, 'unfinished');
      label(status, null);
      showNotice(error.message);
    } finally {
      busy = false;
      output.setAttribute('aria-busy', 'false');
      sync();
      if (views.current() === 'diagram') loadExtraView('diagram', false);
    }
  }

  function receiveInitial(result) {
    if (!latestMode) {
      prefill(result?._meta?.source);
      return;
    }
    if (!busy && !snapshot && !answer && !edited && result?.structuredContent?.translation) finish(result);
  }

  async function runRewrite(name, args, { text, selection, previousRewrite } = {}) {
    const currentView = view;
    if (name === 'translate_latest_reply' || name === 'translate_linked_reply') {
      showSource('', undefined);
      setSnapshot(undefined);
    }
    views.select('text');
    if (!previousRewrite) clear();
    begin();
    try {
      let result;
      if (standalone) {
        if (text !== sample?.source) throw new Error('previewOnly');
        await new Promise((resolve) => setTimeout(resolve, 760));
        result = { translation: previousRewrite === sample.answer ? sample.alternate : sample.answer };
      } else {
        result = await call(name, args, 108_000);
      }
      if (view === currentView) finish(result, null, text, selection, previousRewrite);
    } catch (error) {
      if (view === currentView) finish(null, error);
    }
  }

  function rewriteText(text, previousRewrite) {
    const args = previousRewrite ? { source: text, previousRewrite } : { source: text };
    return runRewrite('translate_plain_speech', args, { text, previousRewrite });
  }

  function rewriteReply(target, selection) {
    const args = chatArgs({ target, confirmed: true, ...(selection ? { selection } : {}) });
    const text = selection ? source.value.slice(selection.start, selection.end) : undefined;
    chooseReply(target, selection, text);
    return runRewrite('translate_plain_speech_reply', args, { text, selection });
  }

  button.addEventListener('click', () => {
    if (button.disabled) return;
    const latest = wantsLatest();
    const text = source.value.trim();
    if (!latest && !text) {
      original.open = true;
      source.focus();
      return;
    }
    if (latest) {
      const name = linkedThread ? 'translate_linked_reply' : 'translate_latest_reply';
      runRewrite(name, chatArgs({ confirmed: true }));
    } else rewriteText(text);
  });

  retry.addEventListener('click', () => {
    if (retry.disabled) return;
    rewriteText(answerSource, answer.slice(0, source.maxLength));
  });
  replyButton.addEventListener('click', () => rewriteReply(sourceTarget));
  selectionButton.addEventListener('pointerdown', (event) => event.preventDefault());
  selectionButton.addEventListener('click', () => {
    const selection = selectedRange();
    if (!selection) return;
    if (sourceTarget) rewriteReply(sourceTarget, selection);
    else rewriteText(source.value.slice(selection.start, selection.end));
  });

  function resetLinkedView() {
    view += 1;
    busy = sourcePending = historyPending = historyLoaded = extraPending = false;
    cachedDiagramPending = undefined;
    historyCursor = undefined;
    listed.clear();
    replyList.replaceChildren();
    historyPanel.hidden = historyNotice.hidden = true;
    historyToggle.setAttribute('aria-expanded', 'false');
    original.open = false;
    clear();
    showSource('', undefined);
    if (!setSnapshot(undefined)) views.reset();
    output.setAttribute('aria-busy', 'false');
    label(status, null);
    sync();
  }

  function acceptDeepLink(context) {
    if (!linkedMode) return;
    const url = context?.['openai/deepLink']?.url;
    const threadId = typeof url === 'string' && /^\/chat\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.exec(url)?.[1];
    if (!threadId || threadId === linkedThread) return;
    linkedThread = threadId;
    resetLinkedView();
  }

  let nextId = 1;
  let origin = '*';
  const pending = new Map();
  let bridgeReady;
  let hostOpensLinks = false;

  function post(message) {
    window.parent.postMessage({ jsonrpc: '2.0', ...message }, origin);
  }

  function request(method, params, timeoutMs) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error('connection'));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timeout });
      post({ id, method, params });
    });
  }

  function connect() {
    window.addEventListener('message', (event) => {
      if (event.source !== window.parent || (origin !== '*' && event.origin !== origin)) return;
      const message = event.data;
      if (message?.jsonrpc !== '2.0') return;
      const call = pending.get(message.id);
      if (call && (message.result !== undefined || message.error)) {
        if (message.id === 1 && event.origin !== 'null') origin = event.origin;
        pending.delete(message.id);
        clearTimeout(call.timeout);
        if (message.error) call.reject(new Error('connection'));
        else call.resolve(message.result);
        return;
      }
      if (message.method === 'ui/notifications/tool-input') prefill(message.params?.arguments?.source);
      if (message.method === 'ui/notifications/tool-result') receiveInitial(message.params);
      if (message.method === 'ui/notifications/host-context-changed') acceptDeepLink(message.params);
      if (message.method === 'ui/resource-teardown') post({ id: message.id, result: {} });
    });

    bridgeReady = request('ui/initialize', {
      appInfo: { name: 'plain-speech', version: '0.6.4' },
      appCapabilities: {},
      protocolVersion: '2026-01-26',
    }, 4500).then((result) => {
      hostOpensLinks = Boolean(result?.hostCapabilities?.openLinks);
      post({ method: 'ui/notifications/initialized' });
      new ResizeObserver(() => {
        const { width, height } = document.querySelector('.card').getBoundingClientRect();
        post({ method: 'ui/notifications/size-changed', params: { width: Math.ceil(width), height: Math.ceil(height) } });
      }).observe(document.querySelector('.card'));
      acceptDeepLink(result?.hostContext);
      return true;
    }, () => false);

    function legacyState(globals) {
      if (latestMode && globals?.toolOutput?.translation) {
        receiveInitial({ structuredContent: globals.toolOutput, _meta: globals.toolResponseMetadata });
      } else if (!latestMode) {
        prefill(globals?.toolInput?.source ?? globals?.toolResponseMetadata?.source);
      }
    }
    legacyState(window.openai);
    window.addEventListener('openai:set_globals', (event) => {
      legacyState(event.detail?.globals);
    });
  }

  async function call(name, args, timeoutMs) {
    if (await bridgeReady) {
      return request('tools/call', { name, arguments: args }, timeoutMs);
    }
    if (window.openai?.callTool) return window.openai.callTool(name, args);
    throw new Error('connection');
  }

  if (!standalone) connect();
  get('project-link').addEventListener('click', (event) => {
    const { href } = event.currentTarget;
    if (hostOpensLinks) {
      event.preventDefault();
      request('ui/open-link', { url: href }, 4500).then((result) => {
        if (result?.isError) window.openai?.openExternal?.({ href });
      }, () => window.openai?.openExternal?.({ href }));
    } else if (window.openai?.openExternal) {
      event.preventDefault();
      window.openai.openExternal({ href });
    }
  });
  lockModelSelection = window.setupPlainSpeechAppearance(
    standalone ? undefined : async (name, args) => checkResult(await call(name, args, 14_000)), modelChanged,
  );
  syncOriginalLabel();
  sync();
})();
