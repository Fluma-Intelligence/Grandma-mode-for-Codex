(() => {
  const mascot = document.querySelector('#pet');
  const workspace = document.getElementById('workspace');
  const { t } = window.plainSpeechLocale;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const originalLabels = { text: 'slidePet', diagram: 'drawingPet', ask: 'grandmaPet' };
  const petLabels = { text: 'petSlideLabel', diagram: 'petDrawLabel', ask: 'petKnitLabel' };
  let atlases = {};
  let layout;
  let mode = 'text';

  const floor = 184;
  const cycle = 2240;
  const atlasFrames = {
    run: { crop: [47, 110, 441, 520], anchor: 222 },
    impact: { crop: [588, 154, 499, 481], anchor: 321 },
    slide: { crop: [1155, 150, 422, 488], anchor: 221 },
    deliver: { crop: [1640, 139, 514, 499], anchor: 320 },
  };
  const scenes = {
    run: { x: 229, pose: 'run', lift: 12, trail: .85 },
    impact: { x: 182, pose: 'impact', trail: 1, impact: 1 },
    slide: { x: 159, pose: 'slide', trail: .85 },
    deliver: { x: 159, pose: 'deliver' },
  };
  // The measured ground and left margin compensate for pose-sheet registration.
  const loops = {
    diagram: {
      beats: [0, 360, 745, 1150], baseline: [.903, .903, .860, .863],
      nudge: [0, 5, 0, 5], x: 84, width: 190, rest: 2,
    },
    ask: {
      beats: [0, 460, 815, 1340], baseline: [.920, .920, .920, .920],
      nudge: [0, 0, 0, 0], x: 77, width: 194, rest: 0,
    },
  };
  const gridLoop = {
    beats: [0, 420, 840, 1280], baseline: [.92, .92, .92, .92],
    nudge: [0, 0, 0, 0], x: 87, width: 194, rest: 3,
  };
  const gridSlide = {
    ...gridLoop,
    beats: [0, 300, 560, 1200],
    shift: (ms) => 62 * Math.max(0, 1 - ms / 1170) ** 2,
  };
  let colors;
  let loopFrame;
  let elapsed = 0;

  function refreshPalette() {
    const css = getComputedStyle(document.documentElement);
    colors = {
      floor: css.getPropertyValue('--track').trim(),
      dust: css.getPropertyValue('--dust').trim(),
      shade: css.getPropertyValue('--shadow').trim(),
      word: css.getPropertyValue('--lettering').trim(),
    };
  }

  function path(ctx, points, outline, width = 2) {
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    for (const point of points.slice(1)) ctx.lineTo(...point);
    ctx.strokeStyle = outline;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  function drawMascot(ctx, scene) {
    const { crop, anchor } = atlasFrames[scene.pose];
    const scale = .31;
    const width = Math.round(crop[2] * scale);
    const height = Math.round(crop[3] * scale);
    const [left, top, cropWidth, cropHeight] = crop;
    ctx.drawImage(atlases.text, left / 2, top / 2, cropWidth / 2, cropHeight / 2, Math.round(scene.x - anchor * scale),
      Math.round(floor - height - (scene.lift || 0)), width, height);
  }

  function drawTrail(ctx, x, amount) {
    if (!amount) return;
    const traces = [[39, -20, 42], [51, -14, 62], [30, -5, 53], [56, 1, 36]];
    for (const [left, offset, length] of traces) {
      path(ctx, [[x + left, floor + offset], [x + left + length * amount, floor + offset]], colors.dust);
    }
    ctx.fillStyle = colors.dust;
    for (const [dx, dy, size] of [[25,0,5],[36,6,3],[48,-1,4],[65,2,2],[76,-7,3]]) {
      ctx.fillRect(Math.round(x + dx + 12 * amount), floor + dy, size, size);
    }
  }

  function paintSlide(ctx, scene) {
    ctx.save();
    ctx.globalAlpha = scene.opacity ?? 1;
    ctx.fillStyle = colors.shade;
    ctx.beginPath();
    ctx.ellipse(scene.x, floor + 2, scene.pose === 'run' ? 33 : 46, 5, 0, 0, 2 * Math.PI);
    ctx.fill();
    drawTrail(ctx, scene.x, scene.trail);
    drawMascot(ctx, scene);

    if (scene.impact > .2) {
      ctx.save();
      ctx.translate(scene.x - 92, floor - 64);
      ctx.rotate(-.20);
      ctx.fillStyle = colors.word;
      ctx.globalAlpha *= scene.impact;
      ctx.font = '900 23px "Segoe UI", "Yu Gothic UI", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(t('impactWord'), 0, 0, Math.max(55, scene.x - 99));
      ctx.restore();
    }
    ctx.restore();
  }

  function poseAt(ms) {
    if (ms < 275) {
      const t = ms / 275;
      return { x: 291 - 74 * t, pose: 'run', lift: 6 + Math.sin(t * Math.PI) * 13,
        trail: .8, opacity: Math.min(1, t * 4) };
    }
    if (ms < 450) {
      const t = (ms - 275) / 175;
      return { x: 217 - 32 * t, pose: 'impact', lift: 6 * (1 - t) ** 3,
        trail: 1, impact: Math.min(1, t * 4) };
    }
    if (ms < 875) {
      const t = (ms - 450) / 425;
      return { x: 185 - 26 * (1 - (1 - t) ** 2.3), pose: 'slide', trail: 1 - t,
        impact: Math.max(0, .86 - t * 2.3) };
    }
    if (ms > 1870) {
      const fade = (ms - 1870) / (cycle - 1870);
      return { ...scenes.deliver, x: 159 - 9 * fade, opacity: 1 - fade };
    }
    return scenes.deliver;
  }

  function paintSprite(ctx, sprite, scene, time) {
    const resting = reduceMotion.matches;
    const index = resting ? scene.rest : scene.beats.findLastIndex((beat) => time >= beat);
    const cellWidth = sprite.width / 2;
    const cellHeight = sprite.height / 2;
    const pulse = resting ? 1 : 1 + .008 * Math.sin(time / cycle * Math.PI * 2);
    const height = scene.width * cellHeight / cellWidth * pulse;
    const age = time - scene.beats[index];
    const settle = resting || index === 0 ? 0 : Math.max(0, 1 - age / 160);
    const y = floor - scene.baseline[index] * height - settle * settle * 1.4;
    ctx.save();
    // The finished chart gets a beat to read before the next sketch starts.
    if (mode === 'diagram' && !resting) {
      ctx.globalAlpha = .64 + .36 * Math.min(1, time / 100, (cycle - time) / 135);
    }
    const x = scene.x + scene.nudge[index] + (resting ? 0 : scene.shift?.(time) ?? 0);
    ctx.drawImage(sprite, (index % 2) * cellWidth, Math.floor(index / 2) * cellHeight,
      cellWidth, cellHeight, x, y, scene.width, height);
    ctx.restore();
  }

  function paintFrameSequence(ctx, sprite, time) {
    const columns = 4;
    const lastFrame = columns * columns - 1;
    const index = reduceMotion.matches ? lastFrame : Math.min(lastFrame, Math.floor(time * 24 / 1000 + 1e-8));
    const cell = sprite.width / columns;
    const { x, width } = gridLoop;
    ctx.save();
    if (mode === 'text' && !reduceMotion.matches) ctx.globalAlpha = Math.min(1, (cycle - time) / 180);
    ctx.drawImage(sprite, (index % columns) * cell, Math.floor(index / columns) * cell,
      cell, cell, x, floor - .92 * width, width, width);
    ctx.restore();
  }

  function paint(time) {
    const ctx = mascot.getContext('2d');
    ctx.clearRect(0, 0, mascot.width, mascot.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    path(ctx, [[24, floor + 2], [359, floor + 2]], colors.floor, 1.3);
    path(ctx, [[32, floor + 8], [72, floor + 8]], colors.floor, 1);
    if (layout === 'grid-4x4-v1') {
      paintFrameSequence(ctx, atlases[mode], time % cycle);
    } else if (layout === 'grid-2x2-v1') {
      paintSprite(ctx, atlases[mode], mode === 'text' ? gridSlide : gridLoop, time % cycle);
    } else if (loops[mode] && atlases[mode]) {
      paintSprite(ctx, atlases[mode], loops[mode], time % cycle);
    } else if (atlases.text) {
      paintSlide(ctx, reduceMotion.matches ? scenes.deliver : poseAt(time % cycle));
    }
  }

  function startMascot() {
    cancelAnimationFrame(loopFrame);
    elapsed = 0;
    mascot.classList.add('fade');
    paint(elapsed);
    requestAnimationFrame(() => mascot.classList.remove('fade'));
    if (!layout || workspace.hidden || reduceMotion.matches || document.hidden) return;
    const start = performance.now();
    let lastFrame = -1;
    function animate(now) {
      const frame = Math.floor((now - start) * 24 / 1000);
      if (frame !== lastFrame) {
        lastFrame = frame;
        elapsed = frame * 1000 / 24;
        paint(elapsed);
      }
      loopFrame = requestAnimationFrame(animate);
    }
    loopFrame = requestAnimationFrame(animate);
  }

  function syncLabel() {
    const key = (layout === 'codex-v1' ? originalLabels : petLabels)[mode];
    mascot.dataset.pose = mode;
    mascot.dataset.i18nLabel = key;
    mascot.setAttribute('aria-label', t(key));
  }

  window.preparePlainSpeechPet = async (pack) => {
    if (!pack) return null;
    const decoded = window.decodeGrandmaPetPack(pack);
    if (!decoded) throw new Error('invalidPet');
    const names = Object.keys(petLabels);
    const loaded = await Promise.allSettled(names.map((name) =>
      createImageBitmap(new Blob([decoded.bytes[name]], { type: 'image/webp' }))));
    if (loaded.some((image) => image.status !== 'fulfilled')) {
      loaded.forEach((image) => image.value?.close());
      throw new Error('invalidPet');
    }
    return { layout: decoded.pack.layout, atlases: Object.fromEntries(names.map((name, index) => [name, loaded[index].value])) };
  };

  window.setPlainSpeechPet = (prepared) => {
    for (const image of Object.values(atlases)) image.close();
    atlases = prepared?.atlases ?? {};
    layout = prepared?.layout;
    mascot.hidden = !layout;
    syncLabel();
    startMascot();
  };

  window.setPlainSpeechMascot = (name) => {
    if (!Object.hasOwn(petLabels, name) || name === mode) return;
    mode = name;
    syncLabel();
    startMascot();
  };

  mascot.hidden = true;
  syncLabel();
  refreshPalette();
  window.addEventListener('schemechange', () => {
    refreshPalette();
    paint(elapsed);
  });
  window.addEventListener('appearancechange', () => {
    refreshPalette();
    paint(elapsed);
  });
  reduceMotion.addEventListener('change', startMascot);
  document.addEventListener('visibilitychange', startMascot);
  window.addEventListener('workspacevisibilitychange', startMascot);
  window.addEventListener('languagechange', () => paint(elapsed));
})();
