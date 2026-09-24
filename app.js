// 页面操作：样本录入/编辑、图上框选标注、复看队列与渲染。
// 标注规则见 annotations.js，本地保存见 store.js。
"use strict";

const Rules = window.AnnotationRules;
const state = window.Store.load();

const STATUS_LABELS = { pending: "待审", approved: "已认可", stale: "条件已变" };
const PHENOMENON_SUGGESTIONS = ["石英颗粒", "长石斑晶", "黑云母", "微裂隙", "蚀变带", "包裹体", "孔隙"];

const form = document.querySelector("#sampleForm");
const submitSampleBtn = document.querySelector("#submitSampleBtn");
const cancelEditBtn = document.querySelector("#cancelEditBtn");
const photoInput = document.querySelector("#photoInput");
const sampleGrid = document.querySelector("#sampleGrid");
const comparePane = document.querySelector("#comparePane");
const mineralFilter = document.querySelector("#mineralFilter");
const polarFilter = document.querySelector("#polarFilter");
const phenomenonFilter = document.querySelector("#phenomenonFilter");
const statusFilter = document.querySelector("#statusFilter");
const reviewList = document.querySelector("#reviewList");

const dialog = document.querySelector("#annotateDialog");
const annotateTitle = document.querySelector("#annotateTitle");
const annotateImg = document.querySelector("#annotateImg");
const annotateStage = document.querySelector("#annotateStage");
const rectLayer = document.querySelector("#rectLayer");
const annotationForm = document.querySelector("#annotationForm");
const phenomenonOptions = document.querySelector("#phenomenonOptions");
const draftHint = document.querySelector("#draftHint");
const overlapNotice = document.querySelector("#overlapNotice");
const annotationList = document.querySelector("#annotationList");
const clearDraftBtn = document.querySelector("#clearDraftBtn");
const closeDialogBtn = document.querySelector("#closeDialogBtn");

let pendingPhoto = "";
let editingSampleId = null;
let drawStart = null;
let lastPhenomenaKey = "";

const dialogState = {
  sampleId: null,
  draftRect: null,
  editingAnnotationId: null,
  overlapWarned: false
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[ch]));
}

function persist() {
  window.Store.save(state);
  render();
  if (dialog.open) renderDialog();
}

function sampleById(id) {
  return state.samples.find((sample) => sample.id === id);
}

function formatTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve) => {
    if (!file) return resolve("");
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.readAsDataURL(file);
  });
}

function filteredSamples() {
  const mineral = mineralFilter.value.trim();
  const polarization = polarFilter.value;
  return state.samples.filter((sample) => {
    const mineralMatch = !mineral || sample.minerals.includes(mineral);
    const polarMatch = !polarization || sample.polarization === polarization;
    return mineralMatch && polarMatch;
  });
}

// ---------- 样本卡片与对比 ----------

function renderSamples() {
  const rows = filteredSamples();
  sampleGrid.innerHTML = rows.length ? rows.map((sample) => {
    const own = state.annotations.filter((a) => a.sampleId === sample.id);
    const conclusions = Rules.currentConclusions(state.annotations, sample);
    const pendingCount = own.filter((a) => Rules.effectiveStatus(a, sample) === "pending").length;
    const staleCount = own.filter((a) => Rules.effectiveStatus(a, sample) === "stale").length;
    return `
    <article class="sample-card">
      ${sample.photo ? `<img src="${sample.photo}" alt="${esc(sample.code)}显微照片">` : `<div class="photo-placeholder"></div>`}
      <div class="sample-body">
        <h3>${esc(sample.code)}</h3>
        <p>${esc(sample.location || "未记录地点")} · ${esc(sample.magnification || "未记录倍数")} · ${esc(sample.polarization)}</p>
        <p>矿物：${esc(sample.minerals || "未记录")}</p>
        <p>结构：${esc(sample.texture || "未记录")}</p>
        <p>${esc(sample.comment || "未填写批注")}</p>
        <p class="conclusion">结论：${conclusions.length
          ? conclusions.map((a) => `${esc(a.phenomenon)}（${esc(a.confidence)}）`).join("、")
          : "暂无已认可标注"}</p>
        <p class="annotation-meta">待审建议 ${pendingCount} 条${staleCount ? ` · 历史标注 ${staleCount} 条（条件已变）` : ""}</p>
        <div class="card-actions">
          <label><input type="checkbox" data-compare="${sample.id}" ${state.compare.includes(sample.id) ? "checked" : ""}>对比</label>
          ${sample.photo ? `<button type="button" data-annotate="${sample.id}">标注</button>` : ""}
          <button type="button" data-edit="${sample.id}">编辑</button>
          <button type="button" data-delete="${sample.id}">删除</button>
        </div>
      </div>
    </article>`;
  }).join("") : "<p>还没有样本，先从左侧录入一张薄片照片。</p>";
}

function renderCompare() {
  const compareSamples = state.compare
    .map((id) => sampleById(id))
    .filter(Boolean)
    .slice(0, 2);

  comparePane.innerHTML = compareSamples.length ? compareSamples.map((sample) => `
    <article class="compare-item">
      ${sample.photo ? `<img src="${sample.photo}" alt="${esc(sample.code)}对比图">` : ""}
      <h3>${esc(sample.code)}</h3>
      <p>${esc(sample.polarization)} · ${esc(sample.minerals || "未记录矿物")}</p>
      <p>${esc(sample.texture || "未记录结构")}</p>
    </article>
  `).join("") : "<p>勾选两张样本卡片后可并排对比。</p>";
}

// ---------- 复看队列 ----------

function reviewRows() {
  const phenomenon = phenomenonFilter.value;
  const status = statusFilter.value;
  return state.annotations
    .map((annotation) => ({ annotation, sample: sampleById(annotation.sampleId) }))
    .filter(({ sample }) => !!sample)
    .filter(({ annotation }) => !phenomenon || annotation.phenomenon === phenomenon)
    .filter(({ annotation, sample }) => !status || Rules.effectiveStatus(annotation, sample) === status)
    .sort((a, b) => b.annotation.updatedAt.localeCompare(a.annotation.updatedAt));
}

function annotationItemHtml(annotation, sample) {
  const status = Rules.effectiveStatus(annotation, sample);
  return `
    <div class="item-head">
      <strong>${esc(annotation.phenomenon)}</strong>
      <span class="badge ${status}">${STATUS_LABELS[status]}</span>
    </div>
    <p>${esc(sample.code)} · 置信度${esc(annotation.confidence)} · 镜下坐标 ${esc(annotation.coords || "未填")}</p>
    <p class="item-meta">图像${Rules.rectPositionLabel(annotation.rect)} · ${formatTime(annotation.updatedAt)}</p>
    ${status === "stale" ? `<p class="stale-note">照片/倍数/偏光已变更，仅存档可查，不计入当前结论</p>` : ""}
    <div class="item-actions">
      ${status === "pending" ? `<button type="button" data-approve="${annotation.id}">认可</button>` : ""}
      <button type="button" data-edit-annotation="${annotation.id}">编辑</button>
      <button type="button" data-delete-annotation="${annotation.id}">删除</button>
    </div>`;
}

function renderReview() {
  const rows = reviewRows();
  reviewList.innerHTML = rows.length
    ? rows.map(({ annotation, sample }) => `<li class="review-item">${annotationItemHtml(annotation, sample)}</li>`).join("")
    : `<li class="review-empty">暂无符合条件的标注。</li>`;
}

function renderPhenomenonOptions() {
  const existing = [...new Set(state.annotations.map((a) => a.phenomenon).filter(Boolean))].sort();
  const key = existing.join("\n");
  if (key === lastPhenomenaKey) return;
  lastPhenomenaKey = key;
  const current = phenomenonFilter.value;
  phenomenonFilter.innerHTML =
    `<option value="">全部现象</option>` +
    existing.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
  phenomenonFilter.value = current;
  phenomenonOptions.innerHTML = [...new Set([...PHENOMENON_SUGGESTIONS, ...existing])]
    .map((p) => `<option value="${esc(p)}">`)
    .join("");
}

function render() {
  renderSamples();
  renderCompare();
  renderReview();
  renderPhenomenonOptions();
}

// ---------- 样本录入 / 编辑 ----------

function exitSampleEditMode() {
  editingSampleId = null;
  pendingPhoto = "";
  photoInput.value = "";
  form.reset();
  submitSampleBtn.textContent = "保存样本";
  cancelEditBtn.hidden = true;
}

function startSampleEdit(id) {
  const sample = sampleById(id);
  if (!sample) return;
  editingSampleId = id;
  form.elements.code.value = sample.code || "";
  form.elements.location.value = sample.location || "";
  form.elements.magnification.value = sample.magnification || "";
  form.elements.polarization.value = sample.polarization;
  form.elements.minerals.value = sample.minerals || "";
  form.elements.texture.value = sample.texture || "";
  form.elements.comment.value = sample.comment || "";
  pendingPhoto = "";
  photoInput.value = "";
  submitSampleBtn.textContent = "更新样本";
  cancelEditBtn.hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

photoInput.addEventListener("change", async () => {
  pendingPhoto = await readFileAsDataUrl(photoInput.files[0]);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  if (!pendingPhoto && photoInput.files[0]) {
    pendingPhoto = await readFileAsDataUrl(photoInput.files[0]);
  }
  const fields = {
    code: data.get("code").trim(),
    location: data.get("location").trim(),
    magnification: data.get("magnification").trim(),
    polarization: data.get("polarization"),
    minerals: data.get("minerals").trim(),
    texture: data.get("texture").trim(),
    comment: data.get("comment").trim()
  };
  if (editingSampleId) {
    const sample = sampleById(editingSampleId);
    if (sample) {
      Object.assign(sample, fields);
      if (pendingPhoto) sample.photo = pendingPhoto;
      // 照片/倍数/偏光变化后，旧标注因上下文不匹配自动转为“条件已变”，仍可在复看队列查询
    }
  } else {
    state.samples.unshift({
      id: crypto.randomUUID(),
      photo: pendingPhoto,
      ...fields,
      createdAt: new Date().toISOString()
    });
  }
  exitSampleEditMode();
  persist();
});

cancelEditBtn.addEventListener("click", exitSampleEditMode);

sampleGrid.addEventListener("click", (event) => {
  const { delete: deleteId, edit, annotate } = event.target.dataset;
  if (deleteId) {
    state.samples = state.samples.filter((sample) => sample.id !== deleteId);
    state.compare = state.compare.filter((id) => id !== deleteId);
    state.annotations = state.annotations.filter((a) => a.sampleId !== deleteId);
    if (editingSampleId === deleteId) exitSampleEditMode();
    persist();
  } else if (edit) {
    startSampleEdit(edit);
  } else if (annotate) {
    openAnnotateDialog(annotate);
  }
});

sampleGrid.addEventListener("change", (event) => {
  const id = event.target.dataset.compare;
  if (!id) return;
  if (event.target.checked) {
    state.compare = [id, ...state.compare.filter((item) => item !== id)].slice(0, 2);
  } else {
    state.compare = state.compare.filter((item) => item !== id);
  }
  persist();
});

// ---------- 区域标注弹窗 ----------

function openAnnotateDialog(sampleId, annotationId = null) {
  const sample = sampleById(sampleId);
  if (!sample || !sample.photo) return;
  dialogState.sampleId = sampleId;
  dialogState.draftRect = null;
  dialogState.editingAnnotationId = null;
  dialogState.overlapWarned = false;
  annotationForm.reset();
  if (annotationId) loadAnnotationIntoForm(annotationId);
  renderDialog();
  if (!dialog.open) dialog.showModal();
}

function loadAnnotationIntoForm(annotationId) {
  const annotation = state.annotations.find((a) => a.id === annotationId);
  if (!annotation) return;
  dialogState.editingAnnotationId = annotationId;
  dialogState.draftRect = { ...annotation.rect };
  annotationForm.elements.phenomenon.value = annotation.phenomenon;
  annotationForm.elements.confidence.value = annotation.confidence;
  annotationForm.elements.coords.value = annotation.coords || "";
}

function rectStyle(rect) {
  return `left:${rect.x * 100}%;top:${rect.y * 100}%;width:${rect.w * 100}%;height:${rect.h * 100}%`;
}

function renderRects() {
  const sample = sampleById(dialogState.sampleId);
  if (!sample) return;
  const boxes = state.annotations
    .filter((a) => a.sampleId === sample.id)
    .map((a) => {
      const status = Rules.effectiveStatus(a, sample);
      const editing = a.id === dialogState.editingAnnotationId ? " editing" : "";
      return `<div class="rect-box ${status}${editing}" style="${rectStyle(a.rect)}">
        <span class="rect-tag">${esc(a.phenomenon)}</span>
      </div>`;
    });
  if (dialogState.draftRect) {
    boxes.push(`<div class="rect-box draft" style="${rectStyle(dialogState.draftRect)}"></div>`);
  }
  rectLayer.innerHTML = boxes.join("");
}

function nearbyForDraft() {
  if (!dialogState.draftRect) return [];
  const others = state.annotations.filter(
    (a) => a.sampleId === dialogState.sampleId && a.id !== dialogState.editingAnnotationId
  );
  return Rules.findNearby(dialogState.draftRect, others);
}

function renderOverlapNotice() {
  const sample = sampleById(dialogState.sampleId);
  const nearby = nearbyForDraft();
  if (!sample || !nearby.length) {
    overlapNotice.hidden = true;
    overlapNotice.innerHTML = "";
    return;
  }
  overlapNotice.hidden = false;
  overlapNotice.innerHTML = `
    <strong>附近已有 ${nearby.length} 条标注，请核对重叠位置：</strong>
    <ul>${nearby.map((a) => `<li>「${esc(a.phenomenon)}」位于图像${Rules.rectPositionLabel(a.rect)}（${STATUS_LABELS[Rules.effectiveStatus(a, sample)]}）</li>`).join("")}</ul>
    <p>确认不是同一处现象后再保存，避免重复记录。</p>`;
}

function refreshDraftUI() {
  renderRects();
  const hasDraft = Rules.isUsableRect(dialogState.draftRect);
  draftHint.classList.remove("warn");
  draftHint.textContent = hasDraft
    ? dialogState.editingAnnotationId
      ? "正在修改已有标注，保存后将重新进入待审建议。"
      : "已框选区域，填写现象后保存；在图上重新拖拽可调整。"
    : "在照片上按住拖拽，框出要标注的区域。";
  if (hasDraft && nearbyForDraft().length) {
    dialogState.overlapWarned = true;
    renderOverlapNotice();
  } else {
    overlapNotice.hidden = true;
    overlapNotice.innerHTML = "";
  }
}

function renderDialog() {
  const sample = sampleById(dialogState.sampleId);
  if (!sample) {
    dialog.close();
    return;
  }
  annotateTitle.textContent = `区域标注 · ${sample.code}（${sample.magnification || "未记录倍数"} · ${sample.polarization}）`;
  annotateImg.src = sample.photo;
  annotateImg.alt = `${sample.code}标注底图`;
  refreshDraftUI();
  const own = state.annotations
    .filter((a) => a.sampleId === sample.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  annotationList.innerHTML = own.length
    ? own.map((a) => `<li class="annotation-item">${annotationItemHtml(a, sample)}</li>`).join("")
    : `<li class="review-empty">本图还没有标注。</li>`;
}

function stagePoint(event) {
  const bounds = annotateStage.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
    y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height))
  };
}

annotateStage.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !dialogState.sampleId) return;
  event.preventDefault();
  drawStart = stagePoint(event);
  dialogState.draftRect = { x: drawStart.x, y: drawStart.y, w: 0, h: 0 };
  dialogState.overlapWarned = false;
  annotateStage.setPointerCapture(event.pointerId);
  renderRects();
});

annotateStage.addEventListener("pointermove", (event) => {
  if (!drawStart) return;
  dialogState.draftRect = Rules.rectFromPoints(drawStart, stagePoint(event));
  renderRects();
});

annotateStage.addEventListener("pointerup", () => {
  if (!drawStart) return;
  drawStart = null;
  if (!Rules.isUsableRect(dialogState.draftRect)) {
    dialogState.draftRect = null;
  }
  dialogState.overlapWarned = false;
  refreshDraftUI();
});

annotationForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const sample = sampleById(dialogState.sampleId);
  if (!sample) return;
  if (!Rules.isUsableRect(dialogState.draftRect)) {
    draftHint.textContent = "请先在左侧照片上拖出矩形区域。";
    draftHint.classList.add("warn");
    return;
  }
  const nearby = nearbyForDraft();
  if (nearby.length && !dialogState.overlapWarned) {
    dialogState.overlapWarned = true;
    renderOverlapNotice();
    return;
  }
  const data = new FormData(annotationForm);
  const now = new Date().toISOString();
  const payload = {
    phenomenon: data.get("phenomenon").trim(),
    confidence: data.get("confidence"),
    coords: data.get("coords").trim(),
    rect: { ...dialogState.draftRect },
    context: Rules.contextOf(sample),
    status: "pending", // 新增或改动一律先进入待审建议，老师认可后才并入结论
    updatedAt: now
  };
  if (dialogState.editingAnnotationId) {
    const annotation = state.annotations.find((a) => a.id === dialogState.editingAnnotationId);
    if (annotation) Object.assign(annotation, payload);
  } else {
    state.annotations.push({ id: crypto.randomUUID(), sampleId: sample.id, createdAt: now, ...payload });
  }
  dialogState.draftRect = null;
  dialogState.editingAnnotationId = null;
  dialogState.overlapWarned = false;
  annotationForm.reset();
  persist();
});

clearDraftBtn.addEventListener("click", () => {
  dialogState.draftRect = null;
  dialogState.overlapWarned = false;
  refreshDraftUI();
});

closeDialogBtn.addEventListener("click", () => dialog.close());

dialog.addEventListener("close", () => {
  dialogState.sampleId = null;
  dialogState.draftRect = null;
  dialogState.editingAnnotationId = null;
  dialogState.overlapWarned = false;
});

// ---------- 标注的认可 / 编辑 / 删除 ----------

function approveAnnotation(id) {
  const annotation = state.annotations.find((a) => a.id === id);
  const sample = annotation && sampleById(annotation.sampleId);
  if (!annotation || !sample) return;
  if (Rules.effectiveStatus(annotation, sample) !== "pending") return; // 仅当前条件下的待审建议可认可
  if (!window.confirm(`认可「${annotation.phenomenon}」并并入 ${sample.code} 的当前结论？`)) return;
  annotation.status = "approved";
  annotation.updatedAt = new Date().toISOString();
  persist();
}

function editAnnotationById(id) {
  const annotation = state.annotations.find((a) => a.id === id);
  if (annotation) openAnnotateDialog(annotation.sampleId, annotation.id);
}

function removeAnnotation(id) {
  state.annotations = state.annotations.filter((a) => a.id !== id);
  persist();
}

[reviewList, annotationList].forEach((list) =>
  list.addEventListener("click", (event) => {
    const { approve, editAnnotation, deleteAnnotation } = event.target.dataset;
    if (approve) approveAnnotation(approve);
    else if (editAnnotation) editAnnotationById(editAnnotation);
    else if (deleteAnnotation) removeAnnotation(deleteAnnotation);
  })
);

// ---------- 筛选与导出 ----------

[mineralFilter, polarFilter, phenomenonFilter, statusFilter].forEach((field) =>
  field.addEventListener("input", render)
);

document.querySelector("#exportBtn").addEventListener("click", () => {
  const checklist = state.samples.map((sample) => ({
    样本编号: sample.code,
    采样地点: sample.location,
    放大倍数: sample.magnification,
    偏光类型: sample.polarization,
    主要矿物: sample.minerals,
    颗粒结构: sample.texture,
    老师批注: sample.comment,
    当前结论: Rules.currentConclusions(state.annotations, sample)
      .map((a) => `${a.phenomenon}（置信度${a.confidence}，${a.coords || "未填坐标"}）`)
      .join("；"),
    待审建议数: state.annotations.filter(
      (a) => a.sampleId === sample.id && Rules.effectiveStatus(a, sample) === "pending"
    ).length
  }));
  const blob = new Blob([JSON.stringify(checklist, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "thin-section-checklist.json";
  link.click();
  URL.revokeObjectURL(link.href);
});

render();
