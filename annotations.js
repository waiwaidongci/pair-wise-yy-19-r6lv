/*
 * 标注规则（纯逻辑：不碰 DOM，不读写本地存储）
 *
 * 规则摘要：
 * 1. 矩形框一律按“相对照片宽高的归一化坐标”保存（0~1），换屏幕尺寸也能对齐。
 * 2. 新建标注默认进入“待审建议(pending)”；只有老师认可后才转为“已认可(approved)”，
 *    并入样本结论。已认可标注被改动后自动退回待审，需要重新认可。
 * 3. 新矩形与同一视域内已有标注重叠（IoU 达到阈值）或相距过近时，
 *    必须先提示冲突位置，使用者确认“仍要保存”后才允许提交。
 * 4. 标注绑定视域（照片 + 放大倍数 + 偏光类型）。三者任一变化即开启新视域，
 *    原标注保留可查，但不再计入当前结论。
 * 5. 列表可按“现象”关键字与“认可状态”筛选；当前结论只统计当前视域内已认可标注。
 */
(function () {
  const STATUS = {
    PENDING: "pending",
    APPROVED: "approved"
  };

  const STATUS_LABEL = {
    pending: "待审建议",
    approved: "已认可"
  };

  const CONFIDENCE_LEVELS = ["高", "中", "低"];

  // 现象候选词，输入框同时允许自由填写
  const PHENOMENON_OPTIONS = [
    "裂隙",
    "微裂隙",
    "孔隙",
    "碎屑颗粒",
    "杂基",
    "胶结物",
    "蚀变",
    "交代结构",
    "波状消光",
    "微断层",
    "包裹体"
  ];

  const MIN_SIDE = 0.004;   // 矩形任一边不得短于照片宽/高的 0.4%
  const OVERLAP_IOU = 0.1;  // 交并比 ≥ 0.1 判为“重叠”
  const NEAR_GAP = 0.02;    // 两框外扩 2% 后仍相交，判为“邻近”

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function round4(value) {
    return Math.round(value * 10000) / 10000;
  }

  // 由拖拽的两个角点生成归一化矩形
  function rectFromPoints(x1, y1, x2, y2) {
    const rect = {
      x: clamp(Math.min(x1, x2), 0, 1),
      y: clamp(Math.min(y1, y2), 0, 1),
      w: Math.abs(x2 - x1),
      h: Math.abs(y2 - y1)
    };
    rect.w = clamp(rect.x + rect.w, 0, 1) - rect.x;
    rect.h = clamp(rect.y + rect.h, 0, 1) - rect.y;
    return {
      x: round4(rect.x),
      y: round4(rect.y),
      w: round4(rect.w),
      h: round4(rect.h)
    };
  }

  function validRect(rect) {
    return rect && rect.w >= MIN_SIDE && rect.h >= MIN_SIDE;
  }

  function intersection(a, b) {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.w, b.x + b.w);
    const bottom = Math.min(a.y + a.h, b.y + b.h);
    if (right <= x || bottom <= y) return null;
    return { x, y, w: right - x, h: bottom - y };
  }

  function area(rect) {
    return rect.w * rect.h;
  }

  function iou(a, b) {
    const cross = intersection(a, b);
    if (!cross) return 0;
    const union = area(a) + area(b) - area(cross);
    return union ? area(cross) / union : 0;
  }

  function expandedIntersects(a, b, gap) {
    return Boolean(intersection(
      { x: a.x - gap, y: a.y - gap, w: a.w + gap * 2, h: a.h + gap * 2 },
      { x: b.x - gap, y: b.y - gap, w: b.w + gap * 2, h: b.h + gap * 2 }
    ));
  }

  // 冲突检测：返回 [{ annotation, kind: '重叠'|'邻近', rate }]，rate 为占较小框的面积比
  function findConflicts(targetRect, annotations) {
    const conflicts = [];
    annotations.forEach((annotation) => {
      const other = annotation.rect;
      const score = iou(targetRect, other);
      if (score >= OVERLAP_IOU) {
        const cross = intersection(targetRect, other);
        const rate = area(cross) / Math.min(area(targetRect), area(other));
        conflicts.push({ annotation, kind: "重叠", rate: round4(rate) });
      } else if (expandedIntersects(targetRect, other, NEAR_GAP)) {
        conflicts.push({ annotation, kind: "邻近", rate: 0 });
      }
    });
    return conflicts;
  }

  // 镜下坐标（物台坐标），单位 mm，允许负值与小数
  function parseStageCoordinate(value) {
    const text = String(value == null ? "" : value).trim();
    if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
    return Number(text);
  }

  function newAnnotation(input, now) {
    const timestamp = now || new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      viewId: input.viewId,
      viewMagnification: input.viewMagnification,
      viewPolarization: input.viewPolarization,
      rect: input.rect,
      phenomenon: input.phenomenon.trim(),
      confidence: input.confidence,
      coords: input.coords,
      note: (input.note || "").trim(),
      status: STATUS.PENDING,
      changes: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      approvedAt: null
    };
  }

  // 任何改动（含已认可标注）都退回待审
  function reviseAnnotation(annotation, patch, now) {
    const timestamp = now || new Date().toISOString();
    return Object.assign({}, annotation, patch, {
      status: STATUS.PENDING,
      approvedAt: null,
      changes: (annotation.changes || 0) + 1,
      updatedAt: timestamp
    });
  }

  function approveAnnotation(annotation, now) {
    return Object.assign({}, annotation, {
      status: STATUS.APPROVED,
      approvedAt: now || new Date().toISOString()
    });
  }

  function unapproveAnnotation(annotation, now) {
    return Object.assign({}, annotation, {
      status: STATUS.PENDING,
      approvedAt: null,
      updatedAt: now || new Date().toISOString()
    });
  }

  // 视域：照片、倍数、偏光任一变化即视为新视域
  function viewChanged(prev, next) {
    return Boolean(
      prev &&
      (prev.photo !== next.photo ||
        (prev.magnification || "") !== (next.magnification || "") ||
        (prev.polarization || "") !== (next.polarization || ""))
    );
  }

  function isCurrent(annotation, sample) {
    return annotation.viewId === sample.viewId;
  }

  function currentAnnotations(sample) {
    return (sample.annotations || []).filter((annotation) => isCurrent(annotation, sample));
  }

  function historyAnnotations(sample) {
    return (sample.annotations || []).filter((annotation) => !isCurrent(annotation, sample));
  }

  // 当前结论 = 当前视域内、老师已认可
  function conclusions(sample) {
    return currentAnnotations(sample).filter((annotation) => annotation.status === STATUS.APPROVED);
  }

  function pendingAnnotations(sample) {
    return (sample.annotations || []).filter((annotation) => annotation.status === STATUS.PENDING);
  }

  // 按现象关键字 + 认可状态筛选（状态空串表示全部）
  function filterAnnotations(annotations, query) {
    const phenomenon = (query.phenomenon || "").trim().toLowerCase();
    const status = query.status || "";
    return annotations.filter((annotation) => {
      const phenomenonMatch = !phenomenon || annotation.phenomenon.toLowerCase().includes(phenomenon);
      const statusMatch = !status || annotation.status === status;
      return phenomenonMatch && statusMatch;
    });
  }

  window.AnnotationRules = {
    STATUS,
    STATUS_LABEL,
    CONFIDENCE_LEVELS,
    PHENOMENON_OPTIONS,
    MIN_SIDE,
    OVERLAP_IOU,
    NEAR_GAP,
    rectFromPoints,
    validRect,
    intersection,
    iou,
    findConflicts,
    parseStageCoordinate,
    newAnnotation,
    reviseAnnotation,
    approveAnnotation,
    unapproveAnnotation,
    viewChanged,
    isCurrent,
    currentAnnotations,
    historyAnnotations,
    conclusions,
    pendingAnnotations,
    filterAnnotations
  };
})();
