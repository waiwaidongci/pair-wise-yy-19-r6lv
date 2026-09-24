// 标注规则：矩形几何、重叠/邻近判定、认可状态与成像上下文（照片/倍数/偏光）匹配。
// 全部为纯函数，不触碰 DOM 与存储，供页面层调用。
(function () {
  "use strict";

  const GRID_LABELS = [
    ["左上", "正上方", "右上"],
    ["左侧", "中央", "右侧"],
    ["左下", "正下方", "右下"]
  ];

  const MIN_RECT_SIZE = 0.01; // 归一化宽/高阈值，误触产生的小框直接丢弃
  const NEARBY_MARGIN = 0.05; // “附近”判定边距：矩形四边外扩 5%

  // 照片指纹：抽样哈希，避免对每张 dataURL 全量计算
  function photoFingerprint(photo) {
    if (!photo) return "";
    let hash = 5381;
    const step = Math.max(1, Math.floor(photo.length / 512));
    for (let i = 0; i < photo.length; i += step) {
      hash = ((hash * 33) ^ photo.charCodeAt(i)) >>> 0;
    }
    return photo.length + ":" + hash;
  }

  function clamp01(value) {
    return Math.min(1, Math.max(0, value));
  }

  // 由两个角点构造归一化矩形（坐标 0~1，相对图片尺寸）
  function rectFromPoints(a, b) {
    const x1 = clamp01(Math.min(a.x, b.x));
    const y1 = clamp01(Math.min(a.y, b.y));
    const x2 = clamp01(Math.max(a.x, b.x));
    const y2 = clamp01(Math.max(a.y, b.y));
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  function isUsableRect(rect) {
    return !!rect && rect.w >= MIN_RECT_SIZE && rect.h >= MIN_RECT_SIZE;
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function expandRect(rect, margin) {
    return {
      x: rect.x - margin,
      y: rect.y - margin,
      w: rect.w + margin * 2,
      h: rect.h + margin * 2
    };
  }

  // 同一张图上与 draft 重叠或邻近的标注
  function findNearby(draft, annotations, margin = NEARBY_MARGIN) {
    const zone = expandRect(draft, margin);
    return annotations.filter((item) => item.rect && rectsOverlap(zone, item.rect));
  }

  // 用九宫格方位描述矩形中心，便于组会上口述位置
  function rectPositionLabel(rect) {
    const col = Math.min(2, Math.floor((rect.x + rect.w / 2) * 3));
    const row = Math.min(2, Math.floor((rect.y + rect.h / 2) * 3));
    return GRID_LABELS[row][col];
  }

  // 标注保存时的成像条件快照
  function contextOf(sample) {
    return {
      photo: photoFingerprint(sample.photo),
      magnification: sample.magnification,
      polarization: sample.polarization
    };
  }

  function matchesContext(annotation, sample) {
    const ctx = annotation.context || {};
    const now = contextOf(sample);
    return (
      ctx.photo === now.photo &&
      ctx.magnification === now.magnification &&
      ctx.polarization === now.polarization
    );
  }

  // 派生状态：stale(成像条件已变) / pending(待审) / approved(已认可)
  function effectiveStatus(annotation, sample) {
    if (!matchesContext(annotation, sample)) return "stale";
    return annotation.status === "approved" ? "approved" : "pending";
  }

  // 当前结论：已认可且成像条件未变的标注
  function currentConclusions(annotations, sample) {
    return annotations.filter(
      (annotation) =>
        annotation.sampleId === sample.id && effectiveStatus(annotation, sample) === "approved"
    );
  }

  window.AnnotationRules = {
    NEARBY_MARGIN,
    MIN_RECT_SIZE,
    photoFingerprint,
    rectFromPoints,
    isUsableRect,
    rectsOverlap,
    findNearby,
    rectPositionLabel,
    contextOf,
    matchesContext,
    effectiveStatus,
    currentConclusions
  };
})();
