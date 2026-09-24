// 本地保存：localStorage 读写与旧数据兜底，state 结构变更在这里兼容。
(function () {
  "use strict";

  const KEY = "wxyy-2-thin-section-index";
  const DEFAULTS = { samples: [], compare: [], annotations: [] };

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "null");
      return { ...DEFAULTS, ...(raw || {}) };
    } catch (error) {
      return { ...DEFAULTS };
    }
  }

  function save(state) {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  window.Store = { load, save };
})();
