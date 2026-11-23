(() => {
  const { label, t } = window.plainSpeechLocale;
  const get = (id) => document.getElementById(id);
  const colorPattern = /^#[0-9a-f]{6}$/i;
  const mix = (left, right, amount) => left.map((value, i) => Math.round(value * (1 - amount) + right[i] * amount));
  const rgb = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  const cssColor = (channels) => `rgb(${channels.join(' ')})`;

  function luminance(channels) {
    const [r, g, b] = channels.map((value) => {
      const x = value / 255;
      return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4;
    });
    return .2126 * r + .7152 * g + .0722 * b;
  }

  function contrast(a, b) {
    const left = luminance(a);
    const right = luminance(b);
    return (Math.max(left, right) + .05) / (Math.min(left, right) + .05);
  }

  // Hand-tuned palettes. Each preset picks its own cover tint so the card
  // doesn't look like a single flat color wash; dark variants use a pastel
  // primary that stays readable on the deep cover.
  const presets = [
    { id: 'default', accent: null,
      light: { cover: '#edf4ff', 'cover-end': '#d9e7ff', primary: '#2851d5' },
      dark: { cover: '#17284f', 'cover-end': '#234680', primary: '#afc8ff' } },
    { id: 'terracotta', accent: '#b3452f',
      light: { cover: '#fdf0e9', 'cover-end': '#f8dfce' },
      dark: { cover: '#2b211c', 'cover-end': '#3e2a20', primary: '#efa78d' } },
    { id: 'matcha', accent: '#3f7a52',
      light: { cover: '#eef5ea', 'cover-end': '#dcebd6' },
      dark: { cover: '#1f2a22', 'cover-end': '#2a3f2d', primary: '#a4d3b0' } },
    { id: 'celadon', accent: '#1e6e6e',
      light: { cover: '#e9f3f1', 'cover-end': '#d3e7e3' },
      dark: { cover: '#1b2928', 'cover-end': '#23403e', primary: '#93ccc5' } },
    { id: 'grape', accent: '#6d4fae',
      light: { cover: '#f1ecf9', 'cover-end': '#e2d7f4' },
      dark: { cover: '#251f35', 'cover-end': '#352749', primary: '#c6b3f2' } },
    { id: 'honey', accent: '#a8640e',
      light: { cover: '#fdf3e2', 'cover-end': '#f9e5c2' },
      dark: { cover: '#2d2316', 'cover-end': '#422f18', primary: '#eebd7d' } },
    { id: 'sakura', accent: '#c1507a',
      light: { cover: '#fceef3', 'cover-end': '#f6d9e6' },
      dark: { cover: '#2f1f27', 'cover-end': '#462639', primary: '#f2a9c6' } },
  ];

  const findPreset = (color) => color
    ? presets.find((preset) => preset.accent?.toLowerCase() === color.toLowerCase())
    : undefined;

  // Exact default theme values, so the default swatch previews the real card.
  const defaultSwatch = {
    light: { card: '#ffffff', cover: '#edf4ff', 'cover-end': '#d9e7ff', primary: '#2851d5', muted: '#506690' },
    dark: { card: '#142039', cover: '#17284f', 'cover-end': '#234680', primary: '#afc8ff', muted: '#bdccec' },
  };

  function themePalette(color, dark, overrides = {}) {
    const accent = rgb(color);
    const base = rgb(dark ? '#181818' : '#ffffff');
    const paper = rgb(dark ? '#212121' : '#fafafa');
    const neutralInk = rgb(dark ? '#f8f8f8' : '#171717');
    const contrastInk = rgb(dark ? '#ffffff' : '#000000');
    const card = mix(base, accent, dark ? .07 : .035);
    const cover = overrides.cover ? rgb(overrides.cover) : mix(paper, accent, dark ? .17 : .10);
    const coverEnd = overrides['cover-end'] ? rgb(overrides['cover-end']) : mix(paper, accent, dark ? .25 : .19);
    const surfaces = [card, cover, coverEnd];
    let readable;
    if (overrides.primary) readable = rgb(overrides.primary);
    else {
      // Keep even the smallest labels readable on every surface, including the tinted cover.
      for (let step = 0; step <= 20; step++) {
        readable = mix(accent, contrastInk, step / 20);
        if (surfaces.every((surface) => contrast(surface, readable) >= 4.5)) break;
      }
    }
    return {
      card, cover, 'cover-end': coverEnd,
      ink: mix(neutralInk, readable, .34),
      muted: mix(neutralInk, readable, .78),
      hairline: mix(card, readable, dark ? .32 : .24),
      primary: readable,
      'primary-hover': mix(readable, contrastInk, .15),
      'primary-ink': rgb(dark ? '#000000' : '#ffffff'),
      track: mix(card, readable, dark ? .58 : .48),
    };
  }

  window.setupPlainSpeechAppearance = (request, modelChanged) => {
    const toggle = get('settings-toggle');
    const back = get('settings-back');
    const card = toggle.closest('.card');
    const workspace = get('workspace');
    const panel = get('appearance');
    const swatches = get('swatches');
    const customSwatch = get('custom-swatch');
    const picker = get('accent-color');
    const petStatus = get('pet-status');
    const file = get('pet-file');
    const importPet = get('import-pet');
    const resetPet = get('reset-pet');
    const currentPet = get('current-pet');
    const credit = get('pet-credit');
    const notice = get('appearance-status');
    const sizes = [...panel.querySelectorAll('input[name="pet-size"]')];
    let savedColor = null;
    let savedSize = 'medium';
    let pending = false;
    const modelForm = get('model-form');
    const provider = get('model-provider');
    const codexModel = get('model-option');
    const apiModel = get('api-model');
    const protocol = get('api-protocol');
    const endpoint = get('api-endpoint');
    const loadModels = get('list-models');
    const apiOptions = get('api-model-options');
    const key = get('provider-key');
    const saveModel = get('save-model');
    const removeKey = get('remove-provider-key');
    const modelStatus = get('model-status');
    let modelData;
    let modelLoading = false;
    let apiLoading = false;
    let modelSaving = false;
    let modelLocked = false;

    function showModelStatus(message) {
      label(modelStatus, message);
      modelStatus.hidden = !message;
    }

    function lockModels() {
      const blocked = !modelData || modelLocked || modelLoading || modelSaving || apiLoading;
      saveModel.disabled = removeKey.disabled = provider.disabled = codexModel.disabled = blocked;
      apiModel.disabled = key.disabled = protocol.disabled = endpoint.disabled = loadModels.disabled =
        blocked || provider.value === 'codex';
      back.disabled = modelSaving;
    }

    function paintKeyHint() {
      const saved = modelData?.settings[protocol.value];
      const hasKey = saved?.hasKey && endpoint.value.trim().replace(/\/$/, '') === saved.baseURL;
      key.placeholder = t(hasKey ? 'keySaved' : 'enterKey');
      removeKey.hidden = provider.value !== 'api' || !hasKey;
    }

    function renderModel() {
      const external = provider.value === 'api';
      const name = external ? protocol.value : 'codex';
      const stored = modelData.settings[name];
      get('api-fields').hidden = !external;
      codexModel.hidden = get('model-option-label').hidden = external;
      key.value = '';
      apiModel.required = endpoint.required = external;
      if (external) {
        endpoint.value = stored?.baseURL ?? '';
        endpoint.placeholder = { compatible: 'https://api.deepseek.com', openai: 'https://api.openai.com/v1',
          gemini: 'https://generativelanguage.googleapis.com/v1beta' }[name];
        apiModel.value = stored?.model ?? '';
        apiOptions.replaceChildren();
      } else {
        const available = new Map((modelData.catalog ?? []).map((item) => [item.model, item]));
        const fallback = modelData.defaultModel;
        if (!available.has(fallback.model)) available.set(fallback.model, { ...fallback, name: 'GPT-6 Luna' });
        if (stored && !available.has(stored.model)) available.set(stored.model, stored);
        codexModel.replaceChildren(...[...available.values()].map(({ model, name, effort }) => {
          const item = new Option(name ?? model, model);
          item.dataset.effort = effort;
          return item;
        }));
        codexModel.value = stored?.model ?? fallback.model;
      }
      paintKeyHint();
      showModelStatus(!external && !modelData.catalog ? 'modelCatalogUnavailable' : null);
      lockModels();
    }

    async function readModels() {
      if (!request || modelLoading || modelSaving) return;
      modelLoading = true;
      lockModels();
      showModelStatus('modelLoading');
      try {
        const { _meta: data } = await request('read_plain_speech_models', {});
        if (!data?.settings || !data.defaultModel) throw new Error('modelSettingError');
        const activeRoute = (saved) => JSON.stringify([saved.provider, saved.settings[saved.provider]]);
        const changed = modelData && activeRoute(modelData) !== activeRoute(data);
        modelData = data;
        provider.value = data.provider === 'codex' ? 'codex' : 'api';
        if (data.provider !== 'codex') protocol.value = data.provider;
        renderModel();
        if (changed) modelChanged();
      } catch {
        showModelStatus('modelSettingError');
      } finally {
        modelLoading = false;
        lockModels();
      }
    }

    async function readApiModels() {
      if (loadModels.disabled || !endpoint.reportValidity()) return;
      apiLoading = true;
      lockModels();
      showModelStatus('modelLoading');
      try {
        const apiKey = key.value.trim();
        const { _meta } = await request('list_plain_speech_api_models', {
          provider: protocol.value, baseURL: endpoint.value.trim(), ...(apiKey ? { apiKey } : {}),
        });
        if (!Array.isArray(_meta?.catalog)) throw new Error('apiCatalogUnavailable');
        const options = document.createDocumentFragment();
        for (const { model, name } of _meta.catalog) {
          const option = new Option(name, model);
          options.append(option);
        }
        apiOptions.replaceChildren(options);
        if (!apiModel.value && _meta.catalog.length) apiModel.value = _meta.catalog[0].model;
        showModelStatus(_meta.catalog.length ? 'modelsLoaded' : 'noApiModels');
      } catch (error) {
        apiOptions.replaceChildren();
        showModelStatus(error.message);
      } finally {
        apiLoading = false;
        lockModels();
      }
    }

    async function saveModelChoice(remove = false) {
      if (saveModel.disabled) return;
      const external = provider.value === 'api';
      const selected = external ? protocol.value : 'codex';
      const model = remove ? modelData.settings[selected].model : external ? apiModel.value.trim() : codexModel.value;
      const effort = external ? undefined : codexModel.selectedOptions[0].dataset.effort;
      const apiKey = external ? (remove ? null : key.value.trim() || undefined) : undefined;
      modelSaving = true;
      lockModels();
      showModelStatus(null);
      try {
        const { _meta: saved } = await request('update_plain_speech_model', {
          provider: selected, model, ...(effort === undefined ? {} : { effort }), ...(apiKey === undefined ? {} : { apiKey }),
          ...(external ? { baseURL: remove ? modelData.settings[selected].baseURL : endpoint.value.trim() } : {}),
        });
        if (!saved?.settings) throw new Error('modelSettingError');
        modelData = { ...modelData, ...saved };
        renderModel();
        if (modelData.provider === selected) modelChanged();
        showModelStatus('appearanceSaved');
      } catch {
        key.value = '';
        showModelStatus('modelSettingError');
      } finally {
        modelSaving = false;
        lockModels();
        if (!panel.hidden) saveModel.focus();
      }
    }
    provider.addEventListener('change', renderModel);
    protocol.addEventListener('change', renderModel);
    for (const field of [endpoint, key]) field.addEventListener('input', () => {
      apiOptions.replaceChildren();
      paintKeyHint();
      showModelStatus(null);
    });
    loadModels.addEventListener('click', readApiModels);
    modelForm.addEventListener('submit', (event) => {
      event.preventDefault();
      saveModelChoice();
    });
    removeKey.addEventListener('click', () => saveModelChoice(true));

    const scheme = () => document.documentElement.dataset.scheme === 'dark' ? 'dark' : 'light';

    // Build one swatch per preset; the custom swatch already lives in the markup.
    const mini = () => {
      const wrap = document.createElement('span');
      wrap.className = 'swatch-mini';
      wrap.setAttribute('aria-hidden', 'true');
      const cover = document.createElement('i');
      cover.className = 'sw-mini-cover';
      const pill = document.createElement('i');
      pill.className = 'sw-mini-pill';
      cover.append(pill);
      const body = document.createElement('i');
      body.className = 'sw-mini-body';
      body.append(document.createElement('i'), document.createElement('i'));
      wrap.append(cover, body);
      return wrap;
    };
    const swatchButtons = presets.map((preset) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'swatch';
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', 'false');
      button.dataset.preset = preset.id;
      button.append(mini());
      button.addEventListener('click', () => saveColor(preset.accent));
      swatches.insertBefore(button, customSwatch);
      return button;
    });
    const controls = [picker, importPet, resetPet, ...swatchButtons, ...sizes];

    function paintMini(element, palette) {
      for (const [key, value] of Object.entries(palette)) {
        element.style.setProperty(`--sw-${key}`, typeof value === 'string' ? value : cssColor(value));
      }
    }

    function paintSwatches() {
      const dark = scheme() === 'dark';
      for (const button of swatchButtons) {
        const preset = presets.find(({ id }) => id === button.dataset.preset);
        const mode = dark ? 'dark' : 'light';
        // The swatch previews the exact palette the card would get.
        paintMini(button, preset.accent
          ? themePalette(preset.accent, dark, preset[mode])
          : defaultSwatch[mode]);
        const name = t(`preset_${preset.id}`);
        button.setAttribute('aria-label', name);
        button.title = name;
        const selected = preset.accent
          ? preset.accent.toLowerCase() === savedColor?.toLowerCase()
          : !savedColor;
        button.setAttribute('aria-checked', String(selected));
      }
      const custom = Boolean(savedColor) && !findPreset(savedColor);
      customSwatch.setAttribute('aria-checked', String(custom));
      const customName = t('customColor');
      customSwatch.setAttribute('aria-label', customName);
      customSwatch.title = customName;
      if (custom) paintMini(customSwatch, themePalette(savedColor, dark));
      else for (const key of ['card', 'cover', 'cover-end', 'primary', 'muted']) {
        customSwatch.style.removeProperty(`--sw-${key}`);
      }
    }

    function showStatus(key) {
      label(notice, key);
      notice.hidden = !key;
    }

    function applyColor(color) {
      const root = document.documentElement;
      const dark = root.dataset.scheme === 'dark';
      root.toggleAttribute('data-user-accent', Boolean(color));
      if (color) {
        const palette = themePalette(color, dark, findPreset(color)?.[dark ? 'dark' : 'light']);
        Object.entries(palette).forEach(([name, value]) => root.style.setProperty(`--chosen-${name}`, cssColor(value)));
      }
      paintSwatches();
      window.dispatchEvent(new Event('appearancechange'));
    }

    function renderColor() {
      picker.value = savedColor ?? (scheme() === 'dark' ? '#afc8ff' : '#2851d5');
      applyColor(savedColor);
    }

    function renderSize() {
      card.dataset.petSize = savedSize;
      sizes.forEach((size) => { size.checked = size.value === savedSize; });
    }

    function renderPet(pack, prepared, custom) {
      window.setPlainSpeechPet(prepared);
      petStatus.classList.toggle('has-pet', Boolean(pack));
      if (pack) {
        delete currentPet.dataset.i18n;
        currentPet.textContent = pack.name;
      } else label(currentPet, 'noPet');
      credit.textContent = pack?.credit ?? '';
      credit.hidden = !credit.textContent;
      resetPet.hidden = !custom;
    }

    async function perform(work, showSaved = true) {
      if (pending) return;
      const restoreSizeFocus = sizes.includes(document.activeElement);
      pending = true;
      controls.forEach((control) => { control.disabled = true; });
      customSwatch.setAttribute('aria-disabled', 'true');
      showStatus(null);
      try {
        await work();
        if (showSaved) showStatus(request ? 'appearanceSaved' : 'appearancePreview');
      } catch (error) {
        renderColor();
        renderSize();
        showStatus(error.message === 'invalidPet' ? 'invalidPet' : 'appearanceError');
      } finally {
        pending = false;
        controls.forEach((control) => { control.disabled = false; });
        customSwatch.removeAttribute('aria-disabled');
        if (restoreSizeFocus && !panel.hidden && document.activeElement === document.body) {
          sizes.find((size) => size.checked)?.focus();
        }
      }
    }

    async function readAppearance() {
      const { _meta: appearance } = await request('read_plain_speech_appearance', {});
      savedColor = colorPattern.test(appearance?.accent) ? appearance.accent : null;
      savedSize = sizes.some((size) => size.value === appearance?.petSize) ? appearance.petSize : 'medium';
      renderColor();
      renderSize();
      const pack = appearance?.pet;
      renderPet(pack, await window.preparePlainSpeechPet(pack), appearance?.customPet);
    }

    function setOpen(open) {
      if (!open && modelSaving) return;
      if (open) {
        const height = workspace.offsetHeight;
        // Preserve the opening height while allowing the form to reflow.
        panel.style.minBlockSize = `max(var(--idle-height), ${height}px)`;
        workspace.hidden = true;
        panel.hidden = false;
        readModels();
      } else {
        panel.style.minBlockSize = '';
        panel.hidden = true;
        workspace.hidden = false;
        key.value = '';
      }
      toggle.setAttribute('aria-expanded', String(open));
      (open ? back : toggle).focus();
      window.dispatchEvent(new Event('workspacevisibilitychange'));
    }
    toggle.addEventListener('click', () => setOpen(true));
    back.addEventListener('click', () => setOpen(false));
    window.addEventListener('keydown', (event) => {
      if (panel.hidden || event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
    });

    function saveColor(accent) {
      perform(async () => {
        await request?.('update_plain_speech_appearance', { setting: 'accent', accent });
        savedColor = accent;
        renderColor();
      });
    }
    picker.addEventListener('input', () => applyColor(picker.value));
    picker.addEventListener('change', () => saveColor(picker.value));
    customSwatch.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        picker.click();
      }
    });
    sizes.forEach((size) => size.addEventListener('change', () => perform(async () => {
      await request?.('update_plain_speech_appearance', { setting: 'petSize', petSize: size.value });
      savedSize = size.value;
      renderSize();
    })));
    importPet.addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      const selected = file.files[0];
      file.value = '';
      if (!selected) return;
      perform(async () => {
        if (selected.size > 710_000) throw new Error('invalidPet');
        let raw;
        try {
          raw = JSON.parse(await selected.text());
        } catch {
          throw new Error('invalidPet');
        }
        const decoded = window.decodeGrandmaPetPack(raw);
        if (!decoded) throw new Error('invalidPet');
        const prepared = await window.preparePlainSpeechPet(decoded.pack);
        try {
          await request?.('update_plain_speech_appearance', { setting: 'pet', pet: decoded.pack });
        } catch (error) {
          Object.values(prepared.atlases).forEach((image) => image.close());
          throw error;
        }
        renderPet(decoded.pack, prepared, true);
      });
    });
    resetPet.addEventListener('click', () => perform(async () => {
      await request?.('update_plain_speech_appearance', { setting: 'pet', pet: null });
      renderPet(null, null, false);
    }));
    window.addEventListener('schemechange', renderColor);
    window.addEventListener('languagechange', paintSwatches);
    window.addEventListener('languagechange', paintKeyHint);
    if (request) perform(readAppearance, false);
    else renderColor();
    return (locked) => {
      modelLocked = locked;
      lockModels();
    };
  };
})();
