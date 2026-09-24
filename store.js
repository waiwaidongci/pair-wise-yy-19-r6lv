/*
 * 本地保存模块：只负责 localStorage 读写、数据迁移与样本/视域/标注的落库操作。
 * 所有标注业务判定在 annotations.js 内，本文件不重复规则。
 */
(function () {
  const STORAGE_KEY = "wxyy-2-thin-section-index";
  const SCHEMA_VERSION = 2;

  function load() {
    let parsed = { samples: [], compare: [] };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) parsed = JSON.parse(raw);
    } catch (error) {
      console.warn("本地数据读取失败，已按空库启动", error);
    }
    return migrate(parsed);
  }

  function persist(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  // v1 -> v2：为旧样本补当前视域，并把旧标注（若有）挂到当前视域
  function migrate(state) {
    state.samples = Array.isArray(state.samples) ? state.samples : [];
    state.compare = Array.isArray(state.compare) ? state.compare : [];
    if (state.schemaVersion >= SCHEMA_VERSION) return state;

    state.samples.forEach((sample) => {
      sample.viewId = sample.viewId || crypto.randomUUID();
      sample.viewHistory = Array.isArray(sample.viewHistory) ? sample.viewHistory : [];
      sample.annotations = Array.isArray(sample.annotations) ? sample.annotations : [];
      sample.annotations.forEach((annotation) => {
        if (!annotation.viewId) annotation.viewId = sample.viewId;
        if (!annotation.status) annotation.status = window.AnnotationRules.STATUS.PENDING;
        annotation.changes = annotation.changes || 0;
        annotation.coords = annotation.coords || { x: null, y: null };
        annotation.note = annotation.note || "";
        if (!annotation.updatedAt) annotation.updatedAt = annotation.createdAt || sample.createdAt || new Date().toISOString();
        if (!annotation.createdAt) annotation.createdAt = annotation.updatedAt;
        if (annotation.status === window.AnnotationRules.STATUS.APPROVED && !annotation.approvedAt) {
          annotation.approvedAt = annotation.updatedAt;
        }
        if (!annotation.viewMagnification) annotation.viewMagnification = sample.magnification || "";
        if (!annotation.viewPolarization) annotation.viewPolarization = sample.polarization || "";
      });
    });
    state.schemaVersion = SCHEMA_VERSION;
    persist(state);
    return state;
  }

  function addSample(state, sample) {
    state.samples.unshift(sample);
    persist(state);
  }

  function removeSample(state, sampleId) {
    state.samples = state.samples.filter((sample) => sample.id !== sampleId);
    state.compare = state.compare.filter((id) => id !== sampleId);
    persist(state);
  }

  function getSample(state, sampleId) {
    return state.samples.find((sample) => sample.id === sampleId) || null;
  }

  // 照片/倍数/偏光变化时归档旧视域并开启新视域；旧标注原样保留、可查但不再算当前结论
  function switchView(state, sampleId, nextView) {
    const sample = getSample(state, sampleId);
    if (!sample || !window.AnnotationRules.viewChanged(currentViewSnapshot(sample), nextView)) {
      return false;
    }
    const target = nextView;
    // 当前视域没有任何标注时直接就地更新，避免产生空的历史视域
    const currentHasAnnotations = sample.annotations.some((item) => item.viewId === sample.viewId);
    if (currentHasAnnotations && (sample.viewHistory.length === 0 || sample.viewHistory[0].viewId !== sample.viewId)) {
      sample.viewHistory.unshift({
        viewId: sample.viewId,
        photo: sample.photo,
        magnification: sample.magnification,
        polarization: sample.polarization,
        switchedAt: sample.viewSwitchedAt || sample.createdAt
      });
    }
    sample.photo = nextView.photo;
    sample.magnification = nextView.magnification;
    sample.polarization = nextView.polarization;
    sample.viewId = crypto.randomUUID();
    sample.viewSwitchedAt = new Date().toISOString();
    persist(state);
    return true;
  }

  function currentViewSnapshot(sample) {
    return {
      photo: sample.photo,
      magnification: sample.magnification,
      polarization: sample.polarization
    };
  }

  // 切回某个历史视域：当前视域若已有标注则归档，目标视域恢复为当前（其标注重新计入结论候选）
  function restoreView(state, sampleId, viewId) {
    const sample = getSample(state, sampleId);
    if (!sample || viewId === sample.viewId) return false;
    const index = sample.viewHistory.findIndex((view) => view.viewId === viewId);
    if (index === -1) return false;
    const target = sample.viewHistory[index];
    const now = new Date().toISOString();

    sample.viewHistory.splice(index, 1);
    const currentHasAnnotations = sample.annotations.some((item) => item.viewId === sample.viewId);
    if (currentHasAnnotations) {
      sample.viewHistory.unshift({
        viewId: sample.viewId,
        photo: sample.photo,
        magnification: sample.magnification,
        polarization: sample.polarization,
        switchedAt: now
      });
    }
    sample.viewId = target.viewId;
    sample.photo = target.photo;
    sample.magnification = target.magnification;
    sample.polarization = target.polarization;
    sample.viewSwitchedAt = now;
    persist(state);
    return true;
  }

  function addAnnotation(state, sampleId, annotation) {
    const sample = getSample(state, sampleId);
    if (!sample) return;
    sample.annotations.push(annotation);
    persist(state);
  }

  function replaceAnnotation(state, annotationId, nextAnnotation) {
    state.samples.forEach((sample) => {
      const index = sample.annotations.findIndex((item) => item.id === annotationId);
      if (index !== -1) sample.annotations[index] = nextAnnotation;
    });
    persist(state);
  }

  function removeAnnotation(state, annotationId) {
    state.samples.forEach((sample) => {
      sample.annotations = sample.annotations.filter((item) => item.id !== annotationId);
    });
    persist(state);
  }

  function setCompare(state, ids) {
    state.compare = ids;
    persist(state);
  }

  window.SampleStore = {
    STORAGE_KEY,
    load,
    persist,
    addSample,
    removeSample,
    getSample,
    switchView,
    currentViewSnapshot,
    addAnnotation,
    replaceAnnotation,
    removeAnnotation,
    restoreView,
    setCompare
  };
})();
