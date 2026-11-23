(() => {
  const { label, t } = window.plainSpeechLocale;
  const get = (id) => document.getElementById(id);
  const make = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const note = (text) => make('p', 'diagram-note', text);

  function arrow(text) {
    const element = make('span', 'diagram-arrow', text);
    element.setAttribute('aria-hidden', 'true');
    return element;
  }

  function drawComparison(before, after) {
    const comparison = make('div', 'diagram-compare');
    for (const [key, text] of [['before', before], ['after', after]]) {
      const value = make('div', `diagram-value diagram-value-${key}`);
      const heading = make('small');
      label(heading, key);
      value.append(heading, make('strong', '', text));
      if (key === 'after') comparison.append(arrow('→'));
      comparison.append(value);
    }
    return comparison;
  }

  function drawDiagram(data) {
    if (data.type === 'text') return make('p', 'translation', data.text);
    const card = make('section', 'diagram');
    card.dataset.type = data.type;
    card.append(make('h2', '', data.title));
    if (data.type === 'compare') {
      card.append(drawComparison(data.before, data.after));
    } else if (data.type === 'beforeAfter') {
      const list = make('ul', 'diagram-list diagram-pairs');
      for (const [index, [topic, before, after]] of data.items.entries()) {
        const row = make('li');
        row.style.setProperty('--d', `${index * 45}ms`);
        row.append(make('h3', '', topic), drawComparison(before, after));
        list.append(row);
      }
      card.append(list);
    } else {
      const list = make(data.type === 'flow' || data.type === 'timeline' ? 'ol' : 'ul', `diagram-list diagram-${data.type}`);
      if (data.type === 'relation') card.append(make('strong', 'diagram-center', data.center));
      let scale;
      if (data.type === 'chart') {
        const values = data.items.map((item) => item[1]);
        const magnitude = Math.max(...values.map(Math.abs)) || 1;
        const low = Math.min(0, ...values) / magnitude;
        const high = Math.max(0, ...values) / magnitude;
        scale = (value) => 100 * (value / magnitude - low) / (high - low || 1);
      }
      for (const [i, item] of data.items.entries()) {
        const row = make('li');
        row.style.setProperty('--d', `${Math.min(i * 45, 360)}ms`);
        if (data.type === 'flow') {
          if (i) row.append(arrow('↓'));
          row.append(document.createTextNode(item));
        } else if (data.type === 'chart') {
          const heads = make('div', 'diagram-row-head');
          heads.append(make('span', '', item[0]), make('strong', '', `${item[1]} ${data.unit}`.trim()));
          const meter = make('div', 'diagram-meter');
          meter.setAttribute('aria-hidden', 'true');
          const bar = make('i');
          const startAt = `${Math.min(scale(0), scale(item[1]))}%`;
          const barWidth = `${Math.abs(scale(item[1]) - scale(0))}%`;
          bar.style.setProperty('--start', '0%');
          bar.style.setProperty('--width', '0%');
          requestAnimationFrame(() => requestAnimationFrame(() => {
            bar.style.setProperty('--start', startAt);
            bar.style.setProperty('--width', barWidth);
          }));
          meter.append(bar);
          row.append(heads, meter);
        } else if (data.type === 'status') {
          const heads = make('div', 'diagram-row-head');
          const state = make('span', 'diagram-state');
          state.dataset.state = item[1];
          label(state, item[1]);
          heads.append(make('strong', '', item[0]), state);
          row.append(heads);
          if (item[2]) row.append(note(item[2]));
        } else {
          row.append(make('strong', '', item[0]), note(item[1]));
        }
        list.append(row);
      }
      card.append(list);
    }
    if (data.note) card.append(note(data.note));
    if (data.pending) card.append(make('p', 'diagram-pending', data.pending));
    return card;
  }

  window.createPlainSpeechViews = ({ onTab, onAction }) => {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const askButtons = [...get('ask-options').querySelectorAll('button')];
    const generate = get('generate-diagram');
    const diagramNotice = get('diagram-notice');
    const askNotice = get('ask-notice');
    const diagramResult = get('diagram-result');
    const askResults = get('ask-results');
    const copyDiagram = get('copy-diagram');
    let current = 'text';
    let diagram;
    const answers = new Set();

    const tabsBar = document.querySelector('.tabs');
    const glider = make('span', 'tab-glider');
    glider.setAttribute('aria-hidden', 'true');
    tabsBar.append(glider);
    tabsBar.classList.add('glider-on');

    function moveGlider() {
      const active = tabs.find((button) => button.getAttribute('aria-selected') === 'true') || tabs[0];
      glider.style.width = `${active.offsetWidth}px`;
      glider.style.transform = `translateX(${active.offsetLeft}px)`;
    }
    requestAnimationFrame(moveGlider);
    window.addEventListener('resize', moveGlider);
    window.addEventListener('workspacevisibilitychange', () => requestAnimationFrame(moveGlider));
    window.addEventListener('languagechange', () => requestAnimationFrame(moveGlider));
    document.fonts?.ready?.then(moveGlider);

    function select(name, focus = false) {
      if (name === current) return;
      current = name;
      for (const button of tabs) {
        const active = button.id === `${name}-tab`;
        button.tabIndex = active ? 0 : -1;
        button.setAttribute('aria-selected', String(active));
        get(button.getAttribute('aria-controls')).hidden = !active;
        if (focus && active) button.focus();
      }
      moveGlider();
      get('translate').hidden = name !== 'text';
      window.setPlainSpeechMascot(name);
      onTab(name);
    }

    for (const [index, button] of tabs.entries()) {
      button.addEventListener('click', () => select(button.id.replace('-tab', '')));
      button.addEventListener('keydown', (event) => {
        const targets = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: tabs.length - 1 };
        if (!Object.hasOwn(targets, event.key)) return;
        event.preventDefault();
        const next = tabs[(targets[event.key] + tabs.length) % tabs.length];
        select(next.id.replace('-tab', ''), true);
      });
    }

    function showStatus(action, key) {
      const element = action === 'diagram' ? diagramNotice : askNotice;
      element.hidden = !key;
      label(element, key);
    }

    function reset() {
      diagram = undefined;
      answers.clear();
      diagramResult.replaceChildren();
      askResults.replaceChildren();
      get('diagram-action').hidden = false;
      copyDiagram.hidden = true;
      label(copyDiagram, 'copy');
      get('ask-usage').hidden = false;
      for (const button of askButtons) button.hidden = false;
      showStatus('diagram');
      showStatus('ask');
    }

    function show(action, data) {
      if (action === 'diagram') {
        if (!data?.diagram) return;
        diagram = data.diagram;
        diagramResult.replaceChildren(drawDiagram(diagram));
        get('diagram-action').hidden = true;
        copyDiagram.hidden = false;
      } else if (data?.translation && !answers.has(action)) {
        const button = askButtons.find(({ dataset }) => dataset.action === action);
        if (!button) return;
        const exchange = make('div', 'ask-exchange');
        exchange.dataset.action = action;
        const question = make('p', 'bubble bubble-prompt');
        label(question, button.dataset.i18n);
        exchange.append(question, make('p', 'bubble bubble-answer', data.translation));
        const previous = action === 'simpler' && askResults.querySelector('[data-action="simpler"]');
        if (previous) previous.replaceWith(exchange);
        else askResults.append(exchange);
        if (data.fallback) return;
        answers.add(action);
        button.hidden = true;
        get('ask-usage').hidden = answers.size === askButtons.length;
      }
    }

    generate.addEventListener('click', () => onAction('diagram', true));
    for (const button of askButtons) button.addEventListener('click', () => onAction(button.dataset.action, true));
    copyDiagram.addEventListener('click', async () => {
      if (!diagram) return;
      try {
        await navigator.clipboard.writeText(diagramResult.innerText);
        label(copyDiagram, 'copied');
      } catch {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(diagramResult);
        selection.removeAllRanges();
        selection.addRange(range);
        showStatus('diagram', 'copying');
      }
    });

    const api = {
      select, reset, show, showStatus, current: () => current, hasDiagram: () => Boolean(diagram),
      setBusy(disabled) {
        generate.disabled = disabled;
        for (const button of askButtons) button.disabled = disabled;
      },
    };
    window.plainSpeechViews = api;
    return api;
  };
})();
