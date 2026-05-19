// ═══════════════════════════════════════════════════════════════════
// SKINWISE — Acne Severity Analyzer
// 3-photo capture + MediaPipe face detection + Gemini analysis
// ═══════════════════════════════════════════════════════════════════

(function() {

  // ─── Constants ───────────────────────────────────────────────────
  const POSES = ['front', 'left', 'right'];
  const POSE_CONFIG = {
    front: { title: 'Frontal scan', subtitle: 'Position your face within the oval · Look straight ahead' },
    left: { title: 'Left profile scan', subtitle: 'Turn your head to the right · Expose your left cheek' },
    right: { title: 'Right profile scan', subtitle: 'Turn your head to the left · Expose your right cheek' }
  };

  // GAGS face-only — chest/back factor 3 excluded
  const REGION_FACTORS = { forehead: 2, right_cheek: 2, left_cheek: 2, nose: 1, chin: 1 };
  const REGION_LABELS = { forehead: 'Forehead', right_cheek: 'Right cheek', left_cheek: 'Left cheek', nose: 'Nose', chin: 'Chin' };
  const LESION_GRADE = { none: 0, comedones: 1, papules: 2, pustules: 3, nodules: 4 };
  const LESION_LABELS = { none: 'None', comedones: 'Comedones', papules: 'Papules', pustules: 'Pustules', nodules: 'Nodules' };
  const LESION_DESC = {
    comedones: 'Non-inflammatory · blackheads/whiteheads',
    papules: 'Inflammatory · small red bumps',
    pustules: 'Inflammatory · pus-filled spots',
    nodules: 'Severe · deep painful lesions'
  };

  // Hotspot coordinates per view (% of image)
  const HOTSPOTS = {
    front: {
      full:        { x: 50, y: 50, scale: 1 },
      forehead:    { x: 50, y: 22, scale: 2.3 },
      left_cheek:  { x: 68, y: 50, scale: 2.3 },
      right_cheek: { x: 32, y: 50, scale: 2.3 },
      nose:        { x: 50, y: 45, scale: 2.5 },
      chin:        { x: 50, y: 78, scale: 2.3 }
    },
    left: {
      full:        { x: 50, y: 50, scale: 1 },
      forehead:    { x: 55, y: 22, scale: 2.3 },
      left_cheek:  { x: 50, y: 52, scale: 2.3 },
      right_cheek: null, // not visible
      nose:        { x: 65, y: 48, scale: 2.5 },
      chin:        { x: 50, y: 80, scale: 2.3 }
    },
    right: {
      full:        { x: 50, y: 50, scale: 1 },
      forehead:    { x: 45, y: 22, scale: 2.3 },
      left_cheek:  null,
      right_cheek: { x: 50, y: 52, scale: 2.3 },
      nose:        { x: 35, y: 48, scale: 2.5 },
      chin:        { x: 50, y: 80, scale: 2.3 }
    }
  };

  // ─── State ───────────────────────────────────────────────────────
  const state = {
    user: { name: '', gender: null, age: null, pregnant: null, sensitive: null, skin_type: null, consent: null },
    captures: { front: null, left: null, right: null },
    poseIndex: 0,
    stream: null,
    useFrontCamera: true,
    pendingPhoto: null,
    analysisResult: null,
    resultRows: [],
    currentView: 'front',
    currentRegion: 'full',
    faceDetection: null,
    detectionRunning: false,
    checks: { pose: false, position: false, lighting: false }
  };

  // ─── DOM refs ────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ─── View routing ────────────────────────────────────────────────
  const VIEW_STEPS = {
    'view-landing': null,
    'view-about': 1,
    'view-prep': 2,
    'view-scan': 3,
    'view-complete': 4,
    'view-analyzing': 5,
    'view-results': 6
  };
  const TOTAL_STEPS = 6;

  function setView(id) {
    $$('.view').forEach(v => v.classList.remove('active'));
    $(id).classList.add('active');
    const step = VIEW_STEPS[id];
    const indicator = $('step-indicator');
    if (step) {
      indicator.classList.remove('hidden');
      $('step-current').textContent = step;
      $('step-total').textContent = TOTAL_STEPS;
      $('step-bar-fill').style.width = ((step / TOTAL_STEPS) * 100) + '%';
    } else {
      indicator.classList.add('hidden');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ─── Pill group helper ───────────────────────────────────────────
  function initPillGroups() {
    $$('.pill-group').forEach(group => {
      const field = group.dataset.field;
      group.querySelectorAll('.pill').forEach(pill => {
        pill.addEventListener('click', () => {
          group.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
          pill.classList.add('active');
          state.user[field] = pill.dataset.value;
          validateForm();
          validateConsent();
        });
      });
    });
  }

  // ─── About form validation ───────────────────────────────────────
  function validateForm() {
    const name = $('user-name').value.trim();
    state.user.name = name;
    const required = ['gender', 'age', 'pregnant', 'sensitive', 'skin_type'];
    const allFilled = name.length > 0 && required.every(f => state.user[f]);
    $('next-from-about').disabled = !allFilled;
  }
  function validateConsent() {
    const consented = state.user.consent === 'yes';
    $('start-scan-btn').disabled = !consented;
    $('upload-instead-btn').disabled = !consented;
  }

  // ─── Landing → About ─────────────────────────────────────────────
  $('start-btn').addEventListener('click', () => setView('view-about'));
  $('user-name').addEventListener('input', validateForm);

  $('back-to-landing').addEventListener('click', () => setView('view-landing'));
  $('next-from-about').addEventListener('click', () => setView('view-prep'));
  $('back-to-about').addEventListener('click', () => setView('view-about'));

  // ─── Prep → Scan ─────────────────────────────────────────────────
  $('start-scan-btn').addEventListener('click', () => {
    setView('view-scan');
    startCamera();
    initFaceDetection();
  });
  $('upload-instead-btn').addEventListener('click', () => {
    setView('view-scan');
    showCameraError('Upload mode selected. Use the upload links below to add your photos.', false);
  });
  $('upload-fallback-link').addEventListener('click', () => $('file-input').click());

  // ─── Camera ──────────────────────────────────────────────────────
  const video = $('video');
  const captureCanvas = $('capture-canvas');
  const detectCanvas = $('detect-canvas');
  const capturedPreview = $('captured-preview');
  const snapBtn = $('snap-btn');
  const previewControls = $('preview-controls');
  const cameraError = $('camera-error');

  async function startCamera() {
    cameraError.classList.add('hidden');
    $('scan-stage').style.display = 'block';
    try {
      if (state.stream) state.stream.getTracks().forEach(t => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: state.useFrontCamera ? 'user' : 'environment',
          width: { ideal: 1280 },
          height: { ideal: 1280 }
        },
        audio: false
      });
      state.stream = stream;
      video.srcObject = stream;
      video.style.display = 'block';
      capturedPreview.style.display = 'none';
      previewControls.classList.remove('visible');
      snapBtn.style.display = 'flex';
      updatePoseUI();
    } catch (err) {
      showCameraError('Camera permission denied or unavailable. Please allow camera access in your browser settings.', true);
    }
  }

  function showCameraError(msg, showRetry) {
    cameraError.classList.remove('hidden');
    cameraError.querySelector('p').textContent = msg;
    $('retry-camera-btn').style.display = showRetry ? 'inline-flex' : 'none';
    $('scan-stage').style.display = 'none';
  }

  $('retry-camera-btn').addEventListener('click', startCamera);

  // ─── MediaPipe Face Detection ─────────────────────────────────────
  function initFaceDetection() {
    if (state.faceDetection || typeof FaceDetection === 'undefined') return;

    try {
      state.faceDetection = new FaceDetection({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/${file}`
      });
      state.faceDetection.setOptions({
        model: 'short',
        minDetectionConfidence: 0.5
      });
      state.faceDetection.onResults(onFaceResults);

      // Detection loop
      state.detectionRunning = true;
      detectLoop();
    } catch (err) {
      console.warn('Face detection unavailable:', err);
      // Fallback: enable snap button without checks
      snapBtn.disabled = false;
    }
  }

  async function detectLoop() {
    if (!state.detectionRunning) return;
    if (video.readyState === 4 && state.faceDetection) {
      try {
        await state.faceDetection.send({ image: video });
      } catch (e) { /* swallow */ }
    }
    setTimeout(detectLoop, 200); // 5fps is plenty for live checks
  }

  function onFaceResults(results) {
    const ctx = detectCanvas.getContext('2d');
    detectCanvas.width = detectCanvas.clientWidth;
    detectCanvas.height = detectCanvas.clientHeight;
    ctx.clearRect(0, 0, detectCanvas.width, detectCanvas.height);

    const faces = results.detections || [];

    if (faces.length === 0) {
      updateChecks({ pose: false, position: false, lighting: false });
      snapBtn.disabled = true;
      return;
    }

    const face = faces[0];
    const bbox = face.boundingBox; // {xCenter, yCenter, width, height} normalized
    const currentPose = POSES[state.poseIndex];

    // ─── Lighting check (sample center brightness) ───
    let lighting = true;
    try {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = 64;
      tempCanvas.height = 64;
      const tctx = tempCanvas.getContext('2d');
      tctx.drawImage(video, 0, 0, 64, 64);
      const data = tctx.getImageData(0, 0, 64, 64).data;
      let total = 0;
      for (let i = 0; i < data.length; i += 4) {
        total += (data[i] + data[i+1] + data[i+2]) / 3;
      }
      const avg = total / (data.length / 4);
      lighting = avg > 50 && avg < 240;
    } catch (e) { lighting = true; }

    // ─── Face position check (face roughly fills oval) ───
    // bbox is mirrored because video is mirrored; flip xCenter
    const xC = 1 - bbox.xCenter;
    const yC = bbox.yCenter;
    const w = bbox.width;
    const h = bbox.height;

    let position;
    if (currentPose === 'front') {
      // More forgiving thresholds for front pose
      position = (
        xC > 0.25 && xC < 0.75 &&
        yC > 0.25 && yC < 0.75 &&
        w > 0.18 && w < 0.75
      );
    } else if (currentPose === 'left') {
      // For left profile, face center can be slightly right
      position = (
        xC > 0.35 && xC < 0.85 &&
        yC > 0.25 && yC < 0.75 &&
        w > 0.12 && w < 0.6
      );
    } else { // right
      position = (
        xC > 0.15 && xC < 0.65 &&
        yC > 0.25 && yC < 0.75 &&
        w > 0.12 && w < 0.6
      );
    }

    // ─── Pose check (front needs square aspect; sides need narrower) ───
    const aspect = h / w;
    let pose;
    if (currentPose === 'front') {
      // More forgiving — most front faces have aspect 0.9 to 1.8
      pose = aspect > 0.9 && aspect < 1.8;
    } else {
      // Profile faces appear narrower → higher aspect ratio (also more forgiving)
      pose = aspect > 1.0;
    }

    updateChecks({ pose, position, lighting });

    const allPass = pose && position && lighting;
    snapBtn.disabled = !allPass;

    const guideOval = $('guide-oval');
    if (allPass) guideOval.classList.add('aligned');
    else guideOval.classList.remove('aligned');
  }

  function updateChecks(checks) {
    state.checks = checks;
    ['pose', 'position', 'lighting'].forEach(key => {
      const el = $('check-' + key);
      el.classList.remove('pass', 'fail');
      el.classList.add(checks[key] ? 'pass' : 'fail');
    });
    // Update pose label
    const poseLabel = POSES[state.poseIndex] === 'front' ? 'Look straight' :
                      POSES[state.poseIndex] === 'left' ? 'Turn right' : 'Turn left';
    $('check-pose-label').textContent = poseLabel;
  }

  // ─── Pose UI ─────────────────────────────────────────────────────
  function updatePoseUI() {
    const pose = POSES[state.poseIndex];
    const cfg = POSE_CONFIG[pose];
    $('scan-title').textContent = cfg.title;
    $('scan-subtitle').textContent = cfg.subtitle;

    // Update progress pills
    $$('.pose-step').forEach(step => {
      const p = step.dataset.pose;
      step.classList.remove('active', 'done');
      if (state.captures[p]) step.classList.add('done');
      else if (p === pose) step.classList.add('active');
    });

    // Adjust face guide oval per pose
    const oval = $('guide-oval');
    if (pose === 'front') {
      oval.setAttribute('cx', '50');
      oval.setAttribute('rx', '22');
    } else if (pose === 'left') {
      oval.setAttribute('cx', '58');
      oval.setAttribute('rx', '18');
    } else {
      oval.setAttribute('cx', '42');
      oval.setAttribute('rx', '18');
    }
  }

  // ─── Snap photo (compressed to avoid "files too large" error) ────
  snapBtn.addEventListener('click', () => {
    if (snapBtn.disabled) return;
    if (!video.videoWidth) return;
    // Compress: scale down to max 800px on longest edge
    const MAX_SIZE = 800;
    let w = video.videoWidth, h = video.videoHeight;
    if (w > h && w > MAX_SIZE) { h = h * (MAX_SIZE / w); w = MAX_SIZE; }
    else if (h > MAX_SIZE) { w = w * (MAX_SIZE / h); h = MAX_SIZE; }
    captureCanvas.width = w;
    captureCanvas.height = h;
    const ctx = captureCanvas.getContext('2d');
    if (state.useFrontCamera) {
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(video, -w, 0, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(video, 0, 0, w, h);
    }
    const dataUrl = captureCanvas.toDataURL('image/jpeg', 0.75);
    state.pendingPhoto = {
      dataUrl,
      base64: dataUrl.split(',')[1],
      mediaType: 'image/jpeg'
    };
    capturedPreview.src = dataUrl;
    capturedPreview.style.display = 'block';
    video.style.display = 'none';
    snapBtn.style.display = 'none';
    previewControls.classList.add('visible');
    $('checks-bar').style.display = 'none';
    $('face-guide-svg').style.display = 'none';
  });

  $('retake-btn').addEventListener('click', () => {
    state.pendingPhoto = null;
    capturedPreview.style.display = 'none';
    video.style.display = 'block';
    snapBtn.style.display = 'flex';
    previewControls.classList.remove('visible');
    $('checks-bar').style.display = 'flex';
    $('face-guide-svg').style.display = 'block';
  });

  $('use-photo-btn').addEventListener('click', () => {
    const pose = POSES[state.poseIndex];
    state.captures[pose] = state.pendingPhoto;
    state.pendingPhoto = null;

    // Update thumbnail
    const thumb = document.querySelector(`.thumb[data-pose="${pose}"]`);
    thumb.classList.remove('empty');
    thumb.classList.add('filled');
    thumb.innerHTML = `<img src="${state.captures[pose].dataUrl}" alt="${pose}"><span class="thumb-label">${pose}</span>`;

    if (state.poseIndex < POSES.length - 1) {
      state.poseIndex++;
      capturedPreview.style.display = 'none';
      video.style.display = 'block';
      snapBtn.style.display = 'flex';
      previewControls.classList.remove('visible');
      $('checks-bar').style.display = 'flex';
      $('face-guide-svg').style.display = 'block';
      updatePoseUI();
    } else {
      // Done with all 3
      stopCamera();
      goToCompleteView();
    }
  });

  function stopCamera() {
    state.detectionRunning = false;
    if (state.stream) {
      state.stream.getTracks().forEach(t => t.stop());
      state.stream = null;
    }
  }

  // ─── Upload fallback (with compression) ──────────────────────────
  $('file-input').addEventListener('change', (e) => {
    if (!e.target.files.length) return;
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = (ev) => {
      // Compress the uploaded image to max 800px on longest edge
      const img = new Image();
      img.onload = () => {
        const MAX_SIZE = 800;
        let w = img.width, h = img.height;
        if (w > h && w > MAX_SIZE) { h = h * (MAX_SIZE / w); w = MAX_SIZE; }
        else if (h > MAX_SIZE) { w = w * (MAX_SIZE / h); h = MAX_SIZE; }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        const compressedUrl = c.toDataURL('image/jpeg', 0.75);
        const pose = POSES[state.poseIndex];
        state.captures[pose] = {
          dataUrl: compressedUrl,
          base64: compressedUrl.split(',')[1],
          mediaType: 'image/jpeg'
        };
        const thumb = document.querySelector(`.thumb[data-pose="${pose}"]`);
        thumb.classList.remove('empty');
        thumb.classList.add('filled');
        thumb.innerHTML = `<img src="${state.captures[pose].dataUrl}"><span class="thumb-label">${pose}</span>`;

        if (state.poseIndex < POSES.length - 1) {
          state.poseIndex++;
          updatePoseUI();
        } else {
          stopCamera();
          goToCompleteView();
        }
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    $('file-input').value = '';
  });

  // ─── Complete view ───────────────────────────────────────────────
  function goToCompleteView() {
    const row = $('complete-photo-row');
    row.innerHTML = '';
    POSES.forEach(pose => {
      if (state.captures[pose]) {
        const div = document.createElement('div');
        div.className = 'complete-thumb';
        div.innerHTML = `<img src="${state.captures[pose].dataUrl}"><span class="complete-thumb-label">${pose}</span>`;
        row.appendChild(div);
      }
    });
    setView('view-complete');
  }

  $('scan-again-link').addEventListener('click', resetToScan);

  function resetToScan() {
    POSES.forEach(p => {
      state.captures[p] = null;
      const t = document.querySelector(`.thumb[data-pose="${p}"]`);
      t.classList.remove('filled');
      t.classList.add('empty');
      t.innerHTML = `<span class="thumb-label">${p}</span>`;
    });
    state.poseIndex = 0;
    setView('view-scan');
    startCamera();
    initFaceDetection();
  }

  $('see-results-btn').addEventListener('click', runAnalysis);

  // ─── Run analysis ────────────────────────────────────────────────
  async function runAnalysis() {
    setView('view-analyzing');
    // Show the captured front photo with scanning animation
    if (state.captures.front) {
      $('scanning-img').src = state.captures.front.dataUrl;
    }
    const subEl = $('analyzing-sub');
    const messages = [
      'Detecting lesions across 5 regions',
      'Counting comedones and inflammatory lesions',
      'Computing region scores',
      'Stratifying GAGS severity'
    ];
    let i = 0;
    const subInterval = setInterval(() => {
      i = (i + 1) % messages.length;
      subEl.textContent = messages[i];
    }, 1400);

    try {
      const result = await callAnalyzeAPI();
      clearInterval(subInterval);
      state.analysisResult = result;
      renderResults(result);
      setView('view-results');
    } catch (err) {
      clearInterval(subInterval);
      alert('Analysis failed: ' + err.message + '\n\nPlease check your Gemini API key in Vercel environment variables, or try again.');
      setView('view-complete');
    }
  }

  async function callAnalyzeAPI() {
    const payload = {
      user: state.user,
      images: {
        front: state.captures.front ? state.captures.front.base64 : null,
        left: state.captures.left ? state.captures.left.base64 : null,
        right: state.captures.right ? state.captures.right.base64 : null
      },
      mediaTypes: {
        front: state.captures.front ? state.captures.front.mediaType : null,
        left: state.captures.left ? state.captures.left.mediaType : null,
        right: state.captures.right ? state.captures.right.mediaType : null
      }
    };
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API ${response.status}: ${text.substring(0, 100)}`);
    }
    return await response.json();
  }

  // ─── Stratification ──────────────────────────────────────────────
  function stratify(score) {
    if (score === 0) return { name: 'No Acne', tier: 0 };
    if (score <= 18) return { name: 'Mild', tier: 1 };
    if (score <= 30) return { name: 'Moderate', tier: 2 };
    if (score <= 38) return { name: 'Severe', tier: 3 };
    return { name: 'Very Severe', tier: 4 };
  }

  function tierStyle(t) {
    return [
      { c: 'var(--tier-0)', bg: 'var(--tier-0-bg)' },
      { c: 'var(--tier-1)', bg: 'var(--tier-1-bg)' },
      { c: 'var(--tier-2)', bg: 'var(--tier-2-bg)' },
      { c: 'var(--tier-3)', bg: 'var(--tier-3-bg)' },
      { c: 'var(--tier-4)', bg: 'var(--tier-4-bg)' }
    ][t];
  }

  // ─── Render results ──────────────────────────────────────────────
  function renderResults(r) {
    // Compute scores
    let total = 0;
    state.resultRows = [];
    Object.keys(REGION_FACTORS).forEach(key => {
      const region = (r.regions && r.regions[key]) || { comedones: 0, papules: 0, pustules: 0, nodules: 0, worst: 'none' };
      const factor = REGION_FACTORS[key];
      const worst = region.worst || 'none';
      const grade = LESION_GRADE[worst] || 0;
      const score = factor * grade;
      total += score;
      state.resultRows.push({
        key, label: REGION_LABELS[key], factor, worst, worstLabel: LESION_LABELS[worst], grade, score,
        counts: {
          comedones: region.comedones || 0,
          papules: region.papules || 0,
          pustules: region.pustules || 0,
          nodules: region.nodules || 0
        }
      });
    });
    state.totalScore = total;

    // Title with name
    $('result-name').textContent = state.user.name ? `, ${state.user.name}` : '';

    // Region table
    const tbody = $('region-tbody');
    const strat = stratify(total);
    const style = tierStyle(strat.tier);
    tbody.innerHTML = '';
    state.resultRows.forEach(row => {
      const chipC = row.grade === 0 ? 'var(--ink-3)' : style.c;
      const chipBg = row.grade === 0 ? 'var(--bg-soft)' : style.bg;
      const tr = document.createElement('tr');
      tr.dataset.region = row.key;
      tr.innerHTML = `
        <td class="region">${row.label}</td>
        <td class="center"><span class="factor-pill">× ${row.factor}</span></td>
        <td class="center"><span class="lesion-pill" style="background:${chipBg};color:${chipC};">${row.worstLabel}</span></td>
        <td class="center"><span class="grade-num">${row.grade}</span></td>
        <td class="right"><span class="score-cell">${row.score}</span></td>
      `;
      tr.addEventListener('click', () => focusRegion(row.key));
      tbody.appendChild(tr);
    });

    // Summary bullets
    const summary = $('summary-bullets');
    summary.innerHTML = '';
    const summaryItems = buildSummary(r, total, strat);
    summaryItems.forEach(item => {
      const li = document.createElement('li');
      li.textContent = item;
      summary.appendChild(li);
    });

    // Initial view
    state.currentView = 'front';
    state.currentRegion = 'full';
    updateResultView();
    focusRegion('full');
  }

  function buildSummary(r, total, strat) {
    const items = [];
    items.push(`Overall severity: ${strat.name} (GAGS ${total} / 44)`);
    const inflam = state.resultRows.reduce((acc, row) =>
      acc + row.counts.papules + row.counts.pustules + row.counts.nodules, 0);
    const noninflam = state.resultRows.reduce((acc, row) => acc + row.counts.comedones, 0);
    if (inflam > 0) items.push(`${inflam} inflammatory lesions detected`);
    if (noninflam > 0) items.push(`${noninflam} non-inflammatory lesions (comedones)`);
    if (state.user.skin_type === 'oily') items.push('Oily skin · prone to comedonal acne');
    if (state.user.sensitive === 'yes') items.push('Sensitive skin · favor gentle ingredients');
    const worstRegion = state.resultRows.reduce((max, row) => row.score > max.score ? row : max, state.resultRows[0]);
    if (worstRegion && worstRegion.score > 0) items.push(`Most affected region: ${worstRegion.label}`);
    if (r.image_quality_note && r.image_quality_note.trim()) {
      items.push(r.image_quality_note);
    }
    return items;
  }

  // ─── Region focus + zoom ─────────────────────────────────────────
  function focusRegion(regionKey) {
    state.currentRegion = regionKey;

    // Update focus pills
    $$('.focus-pill').forEach(p => {
      p.classList.toggle('active', p.dataset.region === regionKey);
    });

    // If region is hidden in current view, swap view
    const positions = HOTSPOTS[state.currentView];
    if (regionKey !== 'full' && positions[regionKey] === null) {
      if (regionKey === 'right_cheek') state.currentView = 'right';
      else if (regionKey === 'left_cheek') state.currentView = 'left';
      updateResultView();
    }

    // Apply zoom
    const pos = HOTSPOTS[state.currentView][regionKey] || HOTSPOTS[state.currentView].full;
    const img = $('result-img');
    if (regionKey === 'full') {
      img.style.transformOrigin = 'center center';
      img.classList.remove('zoomed');
    } else {
      img.style.transformOrigin = pos.x + '% ' + pos.y + '%';
      img.classList.add('zoomed');
    }

    // Update right panel
    updateRegionDetail(regionKey);

    // Update score bar to show region or full
    updateScoreBar(regionKey);

    // Highlight table row
    $$('#region-tbody tr').forEach(tr => {
      tr.classList.toggle('selected', tr.dataset.region === regionKey);
    });
  }

  function updateResultView() {
    const view = state.currentView;
    const cap = state.captures[view];
    if (cap) $('result-img').src = cap.dataUrl;
    $$('.view-toggle-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.view === view);
    });
  }

  function updateRegionDetail(regionKey) {
    const labelEl = $('region-active-label');
    if (regionKey === 'full') {
      labelEl.textContent = 'Full face';
      // Show aggregate
      const totals = state.resultRows.reduce((acc, row) => {
        acc.comedones += row.counts.comedones;
        acc.papules += row.counts.papules;
        acc.pustules += row.counts.pustules;
        acc.nodules += row.counts.nodules;
        return acc;
      }, { comedones: 0, papules: 0, pustules: 0, nodules: 0 });
      const totalLes = totals.comedones + totals.papules + totals.pustules + totals.nodules;
      const worstAll = ['nodules', 'pustules', 'papules', 'comedones'].find(t => totals[t] > 0) || 'none';
      $('rd-worst').textContent = LESION_LABELS[worstAll];
      $('rd-total').textContent = totalLes;
      renderLesionRows(totals, worstAll);
    } else {
      const row = state.resultRows.find(r => r.key === regionKey);
      if (!row) return;
      labelEl.textContent = row.label;
      $('rd-worst').textContent = row.worstLabel;
      const total = row.counts.comedones + row.counts.papules + row.counts.pustules + row.counts.nodules;
      $('rd-total').textContent = total;
      renderLesionRows(row.counts, row.worst);
    }
  }

  function renderLesionRows(counts, worst) {
    const container = $('rd-lesions');
    container.innerHTML = '';
    ['comedones', 'papules', 'pustules', 'nodules'].forEach(type => {
      const row = document.createElement('div');
      row.className = 'lesion-row' + (type === worst ? ' is-worst' : '');
      row.innerHTML = `
        <span class="lesion-name">${LESION_LABELS[type]}${type === worst ? ' · worst' : ''}</span>
        <span class="lesion-count">${counts[type]}</span>
      `;
      container.appendChild(row);
    });
  }

  function updateScoreBar(regionKey) {
    // For region-specific, show that region's score relative to its max
    // For full face, show total / 44
    let value, max, displayVal;
    if (regionKey === 'full') {
      value = state.totalScore;
      max = 44;
      displayVal = state.totalScore;
    } else {
      const row = state.resultRows.find(r => r.key === regionKey);
      value = row.score;
      max = row.factor * 4;
      displayVal = row.score;
    }
    const pct = max > 0 ? (value / max) * 100 : 0;
    $('score-bar-fill').style.width = pct + '%';
    $('score-bar-marker').style.left = pct + '%';
    $('score-bar-val').textContent = displayVal;

    const strat = stratify(state.totalScore);
    const style = tierStyle(strat.tier);
    const badge = $('tier-badge');
    badge.style.background = style.bg;
    badge.style.color = style.c;
    $('tier-text').textContent = strat.name;
  }

  // Focus pill listeners
  $$('.focus-pill').forEach(p => {
    p.addEventListener('click', () => focusRegion(p.dataset.region));
  });
  // View toggle listeners
  $$('.view-toggle-btn').forEach(b => {
    b.addEventListener('click', () => {
      state.currentView = b.dataset.view;
      updateResultView();
      focusRegion(state.currentRegion);
    });
  });

  // ─── New analysis & export ────────────────────────────────────────
  $('new-scan-btn').addEventListener('click', () => {
    POSES.forEach(p => {
      state.captures[p] = null;
      const t = document.querySelector(`.thumb[data-pose="${p}"]`);
      t.classList.remove('filled');
      t.classList.add('empty');
      t.innerHTML = `<span class="thumb-label">${p}</span>`;
    });
    state.poseIndex = 0;
    state.analysisResult = null;
    state.resultRows = [];
    setView('view-landing');
  });

  $('export-btn').addEventListener('click', () => window.print());

  // ─── Init ────────────────────────────────────────────────────────
  initPillGroups();
  setView('view-landing');

})();
