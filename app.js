/*
 * 页面操作模块：样本录入、标注台弹窗（拖框 / 冲突提示 / 编辑）、
 * 认可流转、复看队列、并排对比、导出。
 * 规则判定走 AnnotationRules，持久化走 SampleStore。
 */
(function () {
  const Rules = window.AnnotationRules;
  const Store = window.SampleStore;
  const state = Store.load();

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  const form = $("#sampleForm");
  const photoInput = $("#photoInput");
  const sampleGrid = $("#sampleGrid");
  const comparePane = $("#comparePane");
  const mineralFilter = $("#mineralFilter");
  const polarFilter = $("#polarFilter");
  const queuePane = $("#queuePane");
  const queueList = $("#queueList");
  const queueCount = $("#queueCount");

  const modal = $("#annotateModal");
  const modalSampleTitle = $("#modalSampleTitle");
  const modalClose = $("#modalClose");
  const viewPhotoInput = $("#viewPhotoInput");
  const viewMagnification = $("#viewMagnification");
  const viewPolarization = $("#viewPolarization");
  const applyViewBtn = $("#applyViewBtn");
  const viewHint = $("#viewHint");
  const stage = $("#stage");
  const stageImage = $("#stageImage");
  const rectLayer = $("#rectLayer");
  const drawGhost = $("#drawGhost");
  const stagePlaceholder = $("#stagePlaceholder");
  const annotationForm = $("#annotationForm");
  const annotationFormTitle = $("#annotationFormTitle");
  const annotationSaveBtn = $("#annotationSaveBtn");
  const annotationCancelBtn = $("#annotationCancelBtn");
  const conflictBox = $("#conflictBox");
  const annotationDetail = $("#annotationDetail");
  const annPhenomenonFilter = $("#annPhenomenonFilter");
  const annStatusFilter = $("#annStatusFilter");
  const annotationList = $("#annotationList");
  const historyViews = $("#historyViews");

  let pendingPhoto = "";

  // 标注台弹窗的会话状态
  const session = {
    sampleId: "",
    viewingViewId: "",   // 当前查看的视域；等于 sample.viewId 时是当前视域
    selectedId: null,   // 选中查看的标注
    draftRect: null,    // 正在新建的矩形
    editingId: null,    // 非空表示正在编辑已有标注
    conflicts: [],
    forceSave: false,
    pendingViewPhoto: ""
  };

  /* ---------- 通用小工具 ---------- */

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve) => {
      if (!file) return resolve("");
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(reader.result));
      reader.readAsDataURL(file);
    });
  }

  function formatTime(iso) {
    if (!iso) return "—";
    const date = new Date(iso);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  function coordText(annotation) {
    const x = annotation.coords && annotation.coords.x != null ? annotation.coords.x : null;
    const y = annotation.coords && annotation.coords.y != null ? annotation.coords.y : null;
    if (x === null && y === null) return "未记录";
    return `X ${x == null ? "—" : x} / Y ${y == null ? "—" : y} mm`;
  }

  function statusBadge(annotation) {
    return annotation.status === Rules.STATUS.APPROVED
      ? '<span class="badge badge-approved">已认可</span>'
      : '<span class="badge badge-pending">待审</span>';
  }

  /* ---------- 主页面：样本卡片、筛选、对比、队列 ---------- */

  function filteredSamples() {
    const mineral = mineralFilter.value.trim();
    const polarization = polarFilter.value;
    return state.samples.filter((sample) => {
      const mineralMatch = !mineral || (sample.minerals || "").includes(mineral);
      const polarMatch = !polarization || sample.polarization === polarization;
      return mineralMatch && polarMatch;
    });
  }

  function renderGrid() {
    const rows = filteredSamples();
    sampleGrid.innerHTML = rows.length ? rows.map((sample) => {
      const approved = Rules.conclusions(sample).length;
      const pending = Rules.currentAnnotations(sample)
        .filter((item) => item.status === Rules.STATUS.PENDING).length;
      const historyCount = Rules.historyAnnotations(sample).length;
      return `
        <article class="sample-card">
          ${sample.photo ? `<img src="${sample.photo}" alt="${esc(sample.code)}显微照片">` : "<div class=\"photo-placeholder\"></div>"}
          <div class="sample-body">
            <h3>${esc(sample.code)}</h3>
            <p>${esc(sample.location) || "未记录地点"} · ${esc(sample.magnification) || "未记录倍数"} · ${esc(sample.polarization) || "未记录偏光"}</p>
            <p>矿物：${esc(sample.minerals) || "未记录"}</p>
            <p>结构：${esc(sample.texture) || "未记录"}</p>
            <p class="annotation-summary">
              标注：<b>${approved}</b> 已并入结论 ·
              <b>${pending}</b> 待审${historyCount ? ` · <b>${historyCount}</b> 历史视域` : ""}
            </p>
            <div class="card-actions">
              <label><input type="checkbox" data-compare="${sample.id}" ${state.compare.includes(sample.id) ? "checked" : ""}>对比</label>
              <span class="card-buttons">
                <button type="button" data-annotate="${sample.id}">区域标注</button>
                <button type="button" data-delete="${sample.id}">删除</button>
              </span>
            </div>
          </div>
        </article>`;
    }).join("") : "<p>还没有样本，先从左侧录入一张薄片照片。</p>";
  }

  function renderCompare() {
    const compareSamples = state.compare
      .map((id) => Store.getSample(state, id))
      .filter(Boolean)
      .slice(0, 2);

    comparePane.innerHTML = compareSamples.length ? compareSamples.map((sample) => `
      <article class="compare-item">
        ${sample.photo ? `<img src="${sample.photo}" alt="${esc(sample.code)}对比图">` : ""}
        <h3>${esc(sample.code)}</h3>
        <p>${esc(sample.polarization)} · ${esc(sample.minerals) || "未记录矿物"}</p>
        <p>${esc(sample.texture) || "未记录结构"}</p>
        <p class="compare-conclusions">已认可现象：${Rules.conclusions(sample).map((item) => esc(item.phenomenon)).join("、") || "暂无"}</p>
      </article>
    `).join("") : "<p>勾选两张样本卡片后可并排对比。</p>";
  }

  function renderQueue() {
    const entries = [];
    state.samples.forEach((sample) => {
      Rules.currentAnnotations(sample)
        .filter((item) => item.status === Rules.STATUS.PENDING)
        .forEach((item) => entries.push({ sample, annotation: item }));
    });
    entries.sort((a, b) => a.annotation.updatedAt.localeCompare(b.annotation.updatedAt));
    queueCount.textContent = entries.length;
    queueCount.classList.toggle("is-zero", entries.length === 0);

    queueList.innerHTML = entries.length ? entries.map(({ sample, annotation }) => `
      <li class="queue-item" data-open="${sample.id}" data-annotation="${annotation.id}">
        <div class="queue-thumb">${sample.photo ? `<img src="${sample.photo}" alt="">` : ""}</div>
        <div class="queue-body">
          <p class="queue-title">${esc(sample.code)} · ${esc(annotation.phenomenon)}</p>
          <p class="queue-meta">置信度 ${esc(annotation.confidence)} · ${coordText(annotation)} · ${formatTime(annotation.updatedAt)}</p>
          ${annotation.note ? `<p class="queue-note">${esc(annotation.note)}</p>` : ""}
        </div>
        <div class="queue-actions">
          <button type="button" data-approve="${annotation.id}">认可</button>
        </div>
      </li>
    `).join("") : "<p class=\"queue-empty\">当前没有待审标注。新增或改动标注后会出现在这里。</p>";
  }

  function renderAll() {
    renderGrid();
    renderCompare();
    renderQueue();
  }

  /* ---------- 样本录入 ---------- */

  photoInput.addEventListener("change", async () => {
    pendingPhoto = await readFileAsDataUrl(photoInput.files[0]);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    if (!pendingPhoto && photoInput.files[0]) {
      pendingPhoto = await readFileAsDataUrl(photoInput.files[0]);
    }
    const now = new Date().toISOString();
    Store.addSample(state, {
      id: crypto.randomUUID(),
      photo: pendingPhoto,
      code: data.get("code").trim(),
      location: data.get("location").trim(),
      magnification: data.get("magnification").trim(),
      polarization: data.get("polarization"),
      minerals: data.get("minerals").trim(),
      texture: data.get("texture").trim(),
      comment: data.get("comment").trim(),
      viewId: crypto.randomUUID(),
      viewHistory: [],
      annotations: [],
      viewSwitchedAt: null,
      createdAt: now
    });
    pendingPhoto = "";
    photoInput.value = "";
    form.reset();
    renderAll();
  });

  sampleGrid.addEventListener("click", (event) => {
    const deleteId = event.target.dataset.delete;
    if (deleteId && confirm("删除该样本及其全部标注？")) {
      Store.removeSample(state, deleteId);
      renderAll();
      return;
    }
    const annotateId = event.target.dataset.annotate;
    if (annotateId) openModal(annotateId);
  });

  sampleGrid.addEventListener("change", (event) => {
    const id = event.target.dataset.compare;
    if (!id) return;
    let compare = state.compare.slice();
    if (event.target.checked) {
      compare = [id, ...compare.filter((item) => item !== id)].slice(0, 2);
    } else {
      compare = compare.filter((item) => item !== id);
    }
    Store.setCompare(state, compare);
    renderCompare();
  });

  // 队列里直接认可 / 点条目打开标注台
  queueList.addEventListener("click", (event) => {
    const approveId = event.target.dataset.approve;
    if (approveId) {
      approveById(approveId);
      return;
    }
    const item = event.target.closest(".queue-item");
    if (item) openModal(item.dataset.open, item.dataset.annotation);
  });

  function approveById(annotationId) {
    let next = null;
    state.samples.forEach((sample) => {
      const target = sample.annotations.find((item) => item.id === annotationId);
      if (target) next = Rules.approveAnnotation(target);
      if (next) Store.replaceAnnotation(state, annotationId, next);
    });
    if (next) {
      renderAll();
      if (modal.hidden === false) renderModal();
    }
  }

  [mineralFilter, polarFilter].forEach((field) => field.addEventListener("input", renderGrid));

  /* ---------- 侧栏页签 ---------- */

  $$(".side-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".side-tab").forEach((item) => item.classList.toggle("is-active", item === tab));
      const showQueue = tab.dataset.tab === "queue";
      queuePane.hidden = !showQueue;
      $("#comparePane").hidden = showQueue;
    });
  });

  /* ---------- 标注台弹窗 ---------- */

  function openModal(sampleId, focusAnnotationId) {
    const sample = Store.getSample(state, sampleId);
    if (!sample) return;
    session.sampleId = sampleId;
    session.viewingViewId = sample.viewId;
    session.selectedId = focusAnnotationId || null;
    session.draftRect = null;
    session.editingId = null;
    session.conflicts = [];
    session.forceSave = false;
    session.pendingViewPhoto = "";

    viewPhotoInput.value = "";
    viewMagnification.value = sample.magnification || "";
    viewPolarization.value = sample.polarization;
    syncViewInputs();
    annotationForm.hidden = true;
    modal.hidden = false;
    renderModal();
  }

  function closeModal() {
    modal.hidden = true;
    session.sampleId = "";
    renderAll();
  }

  function activeSample() {
    return Store.getSample(state, session.sampleId);
  }

  function isHistoryView() {
    const sample = activeSample();
    return sample && session.viewingViewId !== sample.viewId;
  }

  function viewingView() {
    const sample = activeSample();
    if (!sample) return null;
    if (session.viewingViewId === sample.viewId) {
      return {
        viewId: sample.viewId,
        photo: sample.photo,
        magnification: sample.magnification,
        polarization: sample.polarization,
        current: true
      };
    }
    const found = sample.viewHistory.find((view) => view.viewId === session.viewingViewId);
    return found ? Object.assign({}, found, { current: false }) : null;
  }

  function syncViewInputs() {
    const sample = activeSample();
    viewMagnification.disabled = isHistoryView();
    viewPolarization.disabled = isHistoryView();
    viewPhotoInput.disabled = isHistoryView();
    applyViewBtn.disabled = isHistoryView();
  }

  function renderModal() {
    const sample = activeSample();
    if (!sample) {
      closeModal();
      return;
    }
    const view = viewingView();
    if (!view) {
      session.viewingViewId = sample.viewId;
      renderModal();
      return;
    }
    modalSampleTitle.textContent = `${sample.code} · ${view.current ? "当前视域" : "历史视域"}`;

    viewHint.textContent = view.current
      ? `${sample.annotations.length ? `全部标注 ${sample.annotations.length} 条；` : ""}更改照片/倍数/偏光后，原标注保留在历史视域，不再计入当前结论。`
      : "正在查看历史视域，此视域只读；切回当前视域后可继续标注。";

    if (view.photo) {
      stageImage.src = view.photo;
      stageImage.hidden = false;
      stagePlaceholder.hidden = true;
    } else {
      stageImage.removeAttribute("src");
      stageImage.hidden = true;
      stagePlaceholder.hidden = false;
    }

    renderRects(view);
    renderAnnotationDetail(view);
    renderAnnotationList(view);
    renderHistoryViews();
    syncViewInputs();
    renderQueue();
  }

  function renderRects(view) {
    const sample = activeSample();
    const inView = sample.annotations.filter((item) => item.viewId === view.viewId);
    rectLayer.innerHTML = inView.map((item) => {
      const classes = [
        "ann-rect",
        item.viewId === sample.viewId
          ? (item.status === Rules.STATUS.APPROVED ? "is-approved" : "is-pending")
          : "is-history",
        item.id === session.selectedId ? "is-selected" : "",
        session.conflicts.some((conflict) => conflict.annotation.id === item.id) ? "is-conflict" : ""
      ].join(" ");
      return `<button type="button" class="${classes}" data-rect="${item.id}"
        style="left:${(item.rect.x * 100).toFixed(2)}%;top:${(item.rect.y * 100).toFixed(2)}%;width:${(item.rect.w * 100).toFixed(2)}%;height:${(item.rect.h * 100).toFixed(2)}%"
        title="${esc(item.phenomenon)}（${Rules.STATUS_LABEL[item.status]}）"></button>`;
    }).join("");

    if (session.draftRect) {
      drawGhost.hidden = false;
      drawGhost.style.left = `${(session.draftRect.x * 100).toFixed(2)}%`;
      drawGhost.style.top = `${(session.draftRect.y * 100).toFixed(2)}%`;
      drawGhost.style.width = `${(session.draftRect.w * 100).toFixed(2)}%`;
      drawGhost.style.height = `${(session.draftRect.h * 100).toFixed(2)}%`;
    } else {
      drawGhost.hidden = true;
    }
  }

  function renderAnnotationList(view) {
    const sample = activeSample();
    const inView = sample.annotations.filter((item) => item.viewId === view.viewId);
    const rows = Rules.filterAnnotations(inView, {
      phenomenon: annPhenomenonFilter.value,
      status: annStatusFilter.value
    });
    annotationList.innerHTML = rows.length ? rows.map((item) => `
      <li class="ann-row ${item.id === session.selectedId ? "is-selected" : ""}" data-row="${item.id}">
        <span class="ann-row-status ${item.status === Rules.STATUS.APPROVED ? "is-approved" : "is-pending"}"></span>
        <div class="ann-row-body">
          <p class="ann-row-title">${esc(item.phenomenon)} ${statusBadge(item)}</p>
          <p class="ann-row-meta">置信度 ${esc(item.confidence)} · ${coordText(item)} · ${formatTime(item.updatedAt)}</p>
        </div>
      </li>
    `).join("") : "<li class=\"ann-empty\">该视域还没有符合条件的标注。</li>";
  }

  function renderAnnotationDetail(view) {
    const sample = activeSample();
    const item = session.selectedId
      ? sample.annotations.find((annotation) => annotation.id === session.selectedId)
      : null;
    if (!item) {
      annotationDetail.hidden = true;
      annotationDetail.innerHTML = "";
      return;
    }
    const editable = item.viewId === sample.viewId;
    annotationDetail.hidden = false;
    annotationDetail.innerHTML = `
      <h3>${esc(item.phenomenon)} ${statusBadge(item)}</h3>
      <p class="detail-meta">置信度 <b>${esc(item.confidence)}</b> · ${coordText(item)}</p>
      ${item.note ? `<p class="detail-note">${esc(item.note)}</p>` : ""}
      <p class="detail-meta">位置 左 ${(item.rect.x * 100).toFixed(1)}% 上 ${(item.rect.y * 100).toFixed(1)}% 宽 ${(item.rect.w * 100).toFixed(1)}% 高 ${(item.rect.h * 100).toFixed(1)}%</p>
      <p class="detail-meta">视域 ${esc(item.viewMagnification || "倍数未记")} · ${esc(item.viewPolarization)} · ${formatTime(item.createdAt)}${item.changes ? `（已改 ${item.changes} 次）` : ""}</p>
      <div class="detail-actions">
        ${editable && item.status === Rules.STATUS.PENDING ? `<button type="button" data-detail-approve="${item.id}">老师认可，并入结论</button>` : ""}
        ${editable && item.status === Rules.STATUS.APPROVED ? `<button type="button" data-detail-unapprove="${item.id}">撤回认可</button>` : ""}
        ${editable ? `<button type="button" class="ghost-btn" data-detail-edit="${item.id}">改动</button>` : ""}
        ${editable ? `<button type="button" class="ghost-btn danger" data-detail-delete="${item.id}">删除</button>` : ""}
        ${!editable ? `<button type="button" data-detail-restore="${item.viewId}">切回该视域编辑</button>` : ""}
      </div>`;
  }

  function renderHistoryViews() {
    const sample = activeSample();
    if (!sample.viewHistory.length) {
      historyViews.innerHTML = "<p class=\"history-empty\">照片、倍数或偏光变更后，旧视域会归档在这里。</p>";
      return;
    }
    historyViews.innerHTML = sample.viewHistory.map((view) => {
      const count = sample.annotations.filter((item) => item.viewId === view.viewId).length;
      return `
        <button type="button" class="history-card ${view.viewId === session.viewingViewId ? "is-selected" : ""}" data-view="${view.viewId}">
          ${view.photo ? `<img src="${view.photo}" alt="">` : "<span class=\"history-no-photo\">无照片</span>"}
          <span class="history-meta">
            <b>${esc(view.magnification) || "倍数未记"} · ${esc(view.polarization)}</b>
            <small>${count} 条标注 · ${formatTime(view.switchedAt)}</small>
          </span>
        </button>`;
    }).join("");
  }

  /* ---------- 拖框绘制 ---------- */

  function pointerToNormalized(event) {
    const bounds = stageImage.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height))
    };
  }

  let drawing = null;

  stage.addEventListener("pointerdown", (event) => {
    if (event.target.dataset.rect || !stageImage.src || isHistoryView()) return;
    const start = pointerToNormalized(event);
    if (!start) return;
    event.preventDefault();
    stage.setPointerCapture(event.pointerId);
    drawing = { start };
  });

  stage.addEventListener("pointermove", (event) => {
    if (!drawing) return;
    const current = pointerToNormalized(event);
    if (!current) return;
    const rect = Rules.rectFromPoints(drawing.start.x, drawing.start.y, current.x, current.y);
    if (rect.w < Rules.MIN_SIDE || rect.h < Rules.MIN_SIDE) return;
    session.draftRect = rect;
    renderRects(viewingView());
  });

  stage.addEventListener("pointerup", () => {
    if (!drawing) return;
    drawing = null;
    if (session.draftRect && !Rules.validRect(session.draftRect)) {
      session.draftRect = null;
      renderRects(viewingView());
      return;
    }
    if (!session.draftRect) return;
    if (annotationForm.hidden) {
      beginDraftForm();
    } else {
      // 表单已打开时继续拖框＝替换当前矩形，立即重新核对重叠
      evaluateConflicts();
    }
  });

  // 点击已有方框：选中查看（编辑态下选框只是取消绘制）
  rectLayer.addEventListener("click", (event) => {
    const rectId = event.target.dataset.rect;
    if (!rectId) return;
    if (annotationForm.hidden === false) {
      // 正在新建/编辑时点其他框，不打断表单
      return;
    }
    session.selectedId = rectId;
    renderModal();
  });

  annotationList.addEventListener("click", (event) => {
    const row = event.target.closest("[data-row]");
    if (row) {
      session.selectedId = row.dataset.row;
      renderModal();
    }
  });

  /* ---------- 新建 / 编辑表单 ---------- */

  function beginDraftForm() {
    annotationDetail.hidden = true;
    annotationForm.hidden = false;
    annotationFormTitle.textContent = session.editingId ? "改动标注" : "新建标注";
    annotationSaveBtn.textContent = session.editingId ? "保存改动（自动退回待审）" : "保存为待审建议";
    evaluateConflicts();
    if (!session.editingId) {
      annotationForm.elements.namedItem("phenomenon").value = "";
      annotationForm.elements.namedItem("confidence").value = "";
      annotationForm.elements.namedItem("coordX").value = "";
      annotationForm.elements.namedItem("coordY").value = "";
      annotationForm.elements.namedItem("note").value = "";
    }
    annotationForm.elements.namedItem("phenomenon").focus();
  }

  function evaluateConflicts() {
    const sample = activeSample();
    const others = sample.annotations
      .filter((item) => item.viewId === sample.viewId)
      .filter((item) => item.id !== session.editingId);
    session.conflicts = Rules.findConflicts(session.draftRect, others);
    session.forceSave = false;
    renderConflictBox();
    renderRects(viewingView());
  }

  function renderConflictBox() {
    if (!session.conflicts.length) {
      conflictBox.hidden = true;
      conflictBox.innerHTML = "";
      return;
    }
    conflictBox.hidden = false;
    conflictBox.innerHTML = `
      <p class="conflict-title">该位置附近已有 ${session.conflicts.length} 条标注，请先核对：</p>
      <ul>
        ${session.conflicts.map((conflict, index) => {
          const item = conflict.annotation;
          const detail = conflict.kind === "重叠"
            ? `与该框重叠约 ${(conflict.rate * 100).toFixed(0)}%`
            : "两框相距很近";
          return `<li><b>${index + 1} 号位置：${esc(item.phenomenon)}</b>（${Rules.STATUS_LABEL[item.status]}，置信度 ${esc(item.confidence)}，${detail}）
            <button type="button" class="link-btn" data-jump-conflict="${item.id}">跳到该框</button></li>`;
        }).join("")}
      </ul>
      <label class="force-save"><input type="checkbox" id="forceSaveCheck"> 已核对，${session.conflicts.some((c) => c.kind === "重叠") ? "确属不同现象" : "仍要单独标注"}，继续保存</label>`;
  }

  conflictBox.addEventListener("click", (event) => {
    const jumpId = event.target.dataset.jumpConflict;
    if (jumpId) {
      // 仅高亮冲突框，不打断正在填写的表单
      session.selectedId = jumpId;
      renderRects(viewingView());
    }
  });

  conflictBox.addEventListener("change", (event) => {
    if (event.target.id === "forceSaveCheck") session.forceSave = event.target.checked;
  });

  annotationCancelBtn.addEventListener("click", cancelForm);

  function cancelForm() {
    annotationForm.hidden = true;
    session.draftRect = null;
    session.editingId = null;
    session.conflicts = [];
    session.forceSave = false;
    annotationForm.reset();
    renderModal();
  }

  annotationForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!session.draftRect || !Rules.validRect(session.draftRect)) {
      alert("请先在照片上拖出矩形区域。");
      return;
    }
    const sample = activeSample();
    if (isHistoryView()) {
      alert("历史视域为只读，请先切回当前视域。");
      return;
    }
    if (session.conflicts.length && !session.forceSave) {
      alert("附近已有标注，请先核对重叠位置，勾选“仍要保存”后再提交。");
      return;
    }
    const data = new FormData(annotationForm);
    const phenomenon = data.get("phenomenon").trim();
    const confidence = data.get("confidence");
    const coordXText = data.get("coordX").trim();
    const coordYText = data.get("coordY").trim();
    if (!phenomenon) {
      alert("请填写现象。");
      return;
    }
    if (!confidence) {
      alert("请选择置信度。");
      return;
    }
    if (coordXText && Rules.parseStageCoordinate(coordXText) === null) {
      alert("镜下坐标 X 需为数字（单位 mm）。");
      return;
    }
    if (coordYText && Rules.parseStageCoordinate(coordYText) === null) {
      alert("镜下坐标 Y 需为数字（单位 mm）。");
      return;
    }

    const payload = {
      viewId: sample.viewId,
      viewMagnification: sample.magnification,
      viewPolarization: sample.polarization,
      rect: session.draftRect,
      phenomenon,
      confidence,
      coords: {
        x: coordXText ? Rules.parseStageCoordinate(coordXText) : null,
        y: coordYText ? Rules.parseStageCoordinate(coordYText) : null
      },
      note: data.get("note").trim()
    };

    if (session.editingId) {
      const original = sample.annotations.find((item) => item.id === session.editingId);
      Store.replaceAnnotation(state, session.editingId, Rules.reviseAnnotation(original, payload));
    } else {
      Store.addAnnotation(state, sample.id, Rules.newAnnotation(payload));
    }

    annotationForm.hidden = true;
    annotationForm.reset();
    session.draftRect = null;
    session.editingId = null;
    session.conflicts = [];
    session.forceSave = false;
    session.selectedId = null;
    renderModal();
  });

  // 详情区按钮：认可 / 撤回 / 改动 / 删除 / 切回历史视域
  annotationDetail.addEventListener("click", (event) => {
    const approveId = event.target.dataset.detailApprove;
    const unapproveId = event.target.dataset.detailUnapprove;
    const editId = event.target.dataset.detailEdit;
    const deleteId = event.target.dataset.detailDelete;
    const restoreId = event.target.dataset.detailRestore;

    if (approveId) {
      const sample = activeSample();
      const target = sample.annotations.find((item) => item.id === approveId);
      Store.replaceAnnotation(state, approveId, Rules.approveAnnotation(target));
      renderModal();
      return;
    }
    if (unapproveId) {
      const sample = activeSample();
      const target = sample.annotations.find((item) => item.id === unapproveId);
      Store.replaceAnnotation(state, unapproveId, Rules.unapproveAnnotation(target));
      renderModal();
      return;
    }
    if (editId) {
      const sample = activeSample();
      const target = sample.annotations.find((item) => item.id === editId);
      if (!target) return;
      session.editingId = editId;
      session.selectedId = null;
      session.draftRect = target.rect;
      annotationDetail.hidden = true;
      annotationForm.hidden = false;
      annotationForm.elements.namedItem("phenomenon").value = target.phenomenon;
      annotationForm.elements.namedItem("confidence").value = target.confidence;
      annotationForm.elements.namedItem("coordX").value = target.coords && target.coords.x != null ? target.coords.x : "";
      annotationForm.elements.namedItem("coordY").value = target.coords && target.coords.y != null ? target.coords.y : "";
      annotationForm.elements.namedItem("note").value = target.note || "";
      beginDraftForm();
      return;
    }
    if (deleteId) {
      if (confirm("删除该标注？")) {
        Store.removeAnnotation(state, deleteId);
        session.selectedId = null;
        renderModal();
      }
      return;
    }
    if (restoreId) {
      Store.restoreView(state, session.sampleId, restoreId);
      session.viewingViewId = activeSample().viewId;
      session.selectedId = null;
      session.draftRect = null;
      session.editingId = null;
      session.conflicts = [];
      session.forceSave = false;
      annotationForm.hidden = true;
      annotationForm.reset();
      viewPhotoInput.value = "";
      session.pendingViewPhoto = "";
      viewMagnification.value = activeSample().magnification || "";
      viewPolarization.value = activeSample().polarization;
      renderModal();
    }
  });

  /* ---------- 视域切换（照片 / 倍数 / 偏光） ---------- */

  viewPhotoInput.addEventListener("change", async () => {
    session.pendingViewPhoto = await readFileAsDataUrl(viewPhotoInput.files[0]);
  });

  applyViewBtn.addEventListener("click", () => {
    const sample = activeSample();
    const next = {
      photo: session.pendingViewPhoto || sample.photo,
      magnification: viewMagnification.value.trim(),
      polarization: viewPolarization.value
    };
    if (!Rules.viewChanged(Store.currentViewSnapshot(sample), next)) {
      viewHint.textContent = "照片、倍数和偏光均未变化。";
      return;
    }
    const oldCount = Rules.currentAnnotations(sample).length;
    const message = oldCount
      ? `本次变更会把当前视域的 ${oldCount} 条标注归档（仍可查、不再计入当前结论），确认应用？`
      : "确认应用新的照片 / 倍数 / 偏光？";
    if (!confirm(message)) return;
    Store.switchView(state, sample.id, next);
    session.viewingViewId = activeSample().viewId;
    session.pendingViewPhoto = "";
    viewPhotoInput.value = "";
    session.selectedId = null;
    session.draftRect = null;
    session.editingId = null;
    session.conflicts = [];
    session.forceSave = false;
    annotationForm.hidden = true;
    annotationForm.reset();
    viewMagnification.value = activeSample().magnification || "";
    viewPolarization.value = activeSample().polarization;
    renderModal();
  });

  historyViews.addEventListener("click", (event) => {
    const card = event.target.closest("[data-view]");
    if (!card) return;
    session.viewingViewId = card.dataset.view;
    session.selectedId = null;
    session.draftRect = null;
    session.editingId = null;
    session.conflicts = [];
    session.forceSave = false;
    annotationForm.hidden = true;
    annotationForm.reset();
    const view = viewingView();
    if (!view) return;
    viewMagnification.value = view.magnification || "";
    viewPolarization.value = view.polarization;
    renderModal();
  });

  annPhenomenonFilter.addEventListener("input", () => renderAnnotationList(viewingView()));
  annStatusFilter.addEventListener("change", () => renderAnnotationList(viewingView()));

  modalClose.addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal.hidden === false) closeModal();
  });

  /* ---------- 现象候选词 ---------- */

  $("#phenomenonList").innerHTML = Rules.PHENOMENON_OPTIONS
    .map((option) => `<option value="${esc(option)}"></option>`).join("");

  /* ---------- 导出 ---------- */

  $("#exportBtn").addEventListener("click", () => {
    const checklist = state.samples.map((sample) => ({
      样本编号: sample.code,
      采样地点: sample.location,
      放大倍数: sample.magnification,
      偏光类型: sample.polarization,
      主要矿物: sample.minerals,
      颗粒结构: sample.texture,
      老师批注: sample.comment,
      当前结论: Rules.conclusions(sample).map((item) => ({
        现象: item.phenomenon,
        置信度: item.confidence,
        镜下坐标: item.coords,
        区域: item.rect,
        备注: item.note,
        认可时间: item.approvedAt
      })),
      待审建议: Rules.currentAnnotations(sample)
        .filter((item) => item.status === Rules.STATUS.PENDING)
        .map((item) => ({
          现象: item.phenomenon,
          置信度: item.confidence,
          镜下坐标: item.coords,
          更新时间: item.updatedAt
        })),
      历史视域数: sample.viewHistory.length,
      历史标注数: Rules.historyAnnotations(sample).length
    }));
    const blob = new Blob([JSON.stringify(checklist, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "thin-section-checklist.json";
    link.click();
    URL.revokeObjectURL(link.href);
  });

  renderAll();
})();
