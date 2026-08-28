(() => {
  "use strict";

  const ROOT_ID = "cwv21-root";
  const STORE = "cwv21:";
  const CACHE_STORE = "cwv23:turnCache:";
  const API_CACHE_STORE = "cwv25:apiConversation:";
  const MAX_PANEL_NODES = 1000;
  const MAX_CACHE_TURNS = 1000;
  const MAX_API_USER_MESSAGES = 3000;

  // V2.4 storage schema
  const STORAGE_SCHEMA_VERSION = 1;
  const STORAGE_META_KEY = "cwv24:storageMeta";
  const STORAGE_MIGRATION_KEY = "cwv24:migratedFromWebLocalStorage";

  const WORKFLOW = [
    { id:"data", short:"数据", title:"数据准备 / 上传",
      patterns:[/已上传|上传.*文件|数据包|所需文件|原始数据|开始整理数据|开始交叉分析/i] },
    { id:"first", short:"初盘", title:"第一轮复盘",
      patterns:[/开始.*复盘|开始分析|交叉分析.*复盘|第一轮分析|正式复盘/i] },
    { id:"second", short:"二盘", title:"二次深度复盘",
      patterns:[/二次复盘|再次全面|重新.*深入分析|独立.*全面.*深入|从头梳理|最优方案/i] },
    { id:"action", short:"执行", title:"优化动作执行",
      patterns:[/已完成设置|已执行|动作已完成|添加.*否定词|删除.*关键词|优化动作/i] },
    { id:"check", short:"核对", title:"执行结果核对",
      patterns:[/检查.*有没有.*问题|检查.*错误|核对.*内容|再次检查|执行后.*检查/i] },
    { id:"card", short:"项目卡", title:"项目卡更新",
      patterns:[/项目卡.*更新|更新.*项目卡|生成项目卡|项目卡表格|封板|版本与审计/i] },
    { id:"schedule", short:"排期", title:"下一轮复盘排期",
      patterns:[/下一轮.*复盘|下次.*复盘|下一次.*复盘|复盘时间|复盘日期|设置.*提醒/i] }
  ];

  const QUICK_PROMPTS = [
    {
      id:"formal-review",
      label:"正式复盘",
      text:"开始本轮正式复盘。请基于本轮最新数据、当前设置、历史动作和项目记录进行完整交叉分析；先还原数据口径与时间范围，再计算关键衍生指标并定位瓶颈，最后给出本轮最优动作方案。不要只看表面指标，也不要为了调整而调整。"
    },
    {
      id:"second-review",
      label:"二次复盘",
      text:"请对刚才的第一轮分析进行一次独立、全面、深入的二次复盘。不要默认上一轮结论一定正确，也不要为了体现“二次分析”而刻意得出不同方案。请重新整合本轮全部数据、历史数据、当前设置、历史动作和项目记录，从头梳理、拆解、组合和交叉验证。不要只看表面指标，要补充计算并分析必要的衍生指标，完整检查流量—点击—加购—转化—成交—ROI漏斗，并结合四象限、瓶颈、边际效率、扩量空间和风险约束判断当前问题所在。重点重新验证第一轮的核心判断、动作必要性、动作幅度和预期收益；如果重新验证后第一轮方案仍然是当前最优解，就明确保留，不要为了“二次复盘”强行改方案；只有在新证据充分支持时才进行局部修正或推翻。最终只保留当前最优方案，并明确哪些动作本轮执行、哪些继续观察、哪些暂不调整。"
    },
    {
      id:"action-check",
      label:"动作检查",
      text:"已完成本轮优化动作。请只核对实际执行结果是否与最终方案一致，检查是否存在漏操作、误操作、额外改动、匹配方式错误、出价或预算误改、否定词冲突等问题；不要重新复盘或改变已经确认的优化方案。"
    },
    {
      id:"card-plan",
      label:"项目卡规划",
      text:"开始分析本轮项目卡需要更新的内容。以当前最新版项目卡为基础，结合本轮最终复盘结论、已执行动作、最新数据和当前状态，逐项判断哪些内容需要更新覆盖、哪些需要新增追加、哪些只需变更状态、哪些历史事实必须继续保留、哪些内容禁止修改。不要重新复盘或改变已确认结论，也不要直接生成文件。先输出完整的项目卡更新规划，并检查遗漏、重复、冲突和历史数据误覆盖风险。"
    },
    {
      id:"card-build",
      label:"生成项目卡",
      text:"开始按照刚才已经确认的项目卡更新规划执行更新并生成最新版项目卡表格文件。严格保留历史事实、原有结构、公式、验证、条件格式、冻结窗格和版本审计，只修改本轮规划中明确允许更新的内容；完成后进行完整一致性检查。"
    },
    {
      id:"seal-check",
      label:"封板检查",
      text:"请对当前最新版项目卡进行最终封板检查：检查表结构、ID、历史记录保留、结构化枚举值、公式及错误值、数据验证、条件格式、冻结窗格、合并单元格、版本与审计、关键文本与关键公式，以及是否存在本轮更新误覆盖历史数据。只做检查和必要的定点修复，不进行无关的大改。"
    }
  ];

  const PROMPT_STORE_KEY = "cwv21:quickPrompts";

  let root = null;
  let observer = null;
  let renderTimer = null;
  let lastPath = location.pathname;
  let nodeMode = "all";
  let isLoadingHistory = false;
  let flyoutCloseTimer = null;
  let panelCloseTimer = null;

  // chrome.storage.local 的内存镜像。
  // UI 仍可同步读取，不需要把整套渲染逻辑改成 async。
  const extensionStorageMemory = new Map();
  let extensionStorageReady = false;
  let extensionStorageFallback = false;
  let cacheWriteTimer = null;
  let pendingCacheWrite = null;

  let internalBridgeReady = false;
  let internalSourceState = "waiting";
  let internalSourceError = "";
  const internalRequestWaiters = new Map();

  const esc = s => (s || "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  }[c]));

  function convKey() {
    const m = location.pathname.match(/\/c\/([^/?#]+)/);
    return m ? m[1] : `path:${location.pathname}`;
  }

  function chromeStorageGet(keys=null) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.get(keys, (result) => {
          const err = chrome.runtime?.lastError;
          if (err) reject(new Error(err.message));
          else resolve(result || {});
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function chromeStorageSet(values) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.set(values, () => {
          const err = chrome.runtime?.lastError;
          if (err) reject(new Error(err.message));
          else resolve();
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function decodeLegacyValue(raw, fallback) {
    if (raw == null) return fallback;
    if (typeof raw !== "string") return raw;

    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function isPluginStorageKey(key) {
    return key === PROMPT_STORE_KEY ||
           key.startsWith(STORE) ||
           key.startsWith(CACHE_STORE) ||
           key.startsWith(API_CACHE_STORE);
  }

  async function migrateLegacyWebStorage(existing) {
    const migration = existing[STORAGE_MIGRATION_KEY];

    if (migration?.done) return migration;

    const toWrite = {};
    let migratedCount = 0;

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !isPluginStorageKey(key)) continue;

        // 扩展存储已经存在的数据优先，绝不让旧网页数据覆盖新数据。
        if (existing[key] !== undefined) continue;

        const raw = localStorage.getItem(key);
        const decoded = decodeLegacyValue(
          raw,
          key.startsWith(CACHE_STORE) ? [] : {}
        );

        toWrite[key] = decoded;
        migratedCount++;
      }
    } catch (e) {
      console.warn("[CWV V2.4] 读取旧 localStorage 失败：", e);
    }

    const migrationInfo = {
      done: true,
      schema: STORAGE_SCHEMA_VERSION,
      migratedCount,
      migratedAt: Date.now(),
      legacyDataRetained: true
    };

    toWrite[STORAGE_MIGRATION_KEY] = migrationInfo;
    toWrite[STORAGE_META_KEY] = {
      schema: STORAGE_SCHEMA_VERSION,
      storage: "chrome.storage.local",
      updatedAt: Date.now()
    };

    await chromeStorageSet(toWrite);

    Object.entries(toWrite).forEach(([key, value]) => {
      extensionStorageMemory.set(key, value);
    });

    return migrationInfo;
  }

  async function initExtensionStorage() {
    try {
      if (!globalThis.chrome?.storage?.local) {
        throw new Error("chrome.storage.local unavailable");
      }

      const existing = await chromeStorageGet(null);

      Object.entries(existing).forEach(([key, value]) => {
        extensionStorageMemory.set(key, value);
      });

      const migrationInfo = await migrateLegacyWebStorage(existing);

      extensionStorageMemory.set(STORAGE_MIGRATION_KEY, migrationInfo);
      extensionStorageReady = true;
      extensionStorageFallback = false;

      // 多个 ChatGPT 标签页之间同步快捷提示词等配置。
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "local") return;

        let promptsChanged = false;

        Object.entries(changes).forEach(([key, change]) => {
          const before = extensionStorageMemory.get(key);

          if (change.newValue === undefined) {
            extensionStorageMemory.delete(key);
          } else {
            extensionStorageMemory.set(key, change.newValue);
          }

          if (
            key === PROMPT_STORE_KEY &&
            JSON.stringify(before) !== JSON.stringify(change.newValue)
          ) {
            promptsChanged = true;
          }
        });

        if (promptsChanged) scheduleRender(80);
      });

      console.info(
        `[CWV V2.4] chrome.storage.local ready; migrated=${migrationInfo?.migratedCount || 0}`
      );
    } catch (e) {
      // 极端情况下保持旧版可用，而不是让整个插件失效。
      extensionStorageFallback = true;
      extensionStorageReady = true;
      console.warn(
        "[CWV V2.4] 扩展存储初始化失败，暂时回退网页 localStorage：",
        e
      );
    }
  }

  function memoryGet(key, fallback) {
    if (extensionStorageFallback) {
      try {
        return decodeLegacyValue(localStorage.getItem(key), fallback);
      } catch {
        return fallback;
      }
    }

    return extensionStorageMemory.has(key)
      ? extensionStorageMemory.get(key)
      : fallback;
  }

  function writeStorageImmediate(key, value) {
    if (extensionStorageFallback) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {}
      return;
    }

    extensionStorageMemory.set(key, value);

    chromeStorageSet({ [key]: value }).catch((e) => {
      console.warn("[CWV V2.4] storage write failed:", key, e);
    });
  }

  function flushCacheWrite() {
    clearTimeout(cacheWriteTimer);
    cacheWriteTimer = null;

    if (!pendingCacheWrite) return;

    const { key, value } = pendingCacheWrite;
    pendingCacheWrite = null;
    writeStorageImmediate(key, value);
  }

  function queueCacheWrite(key, value) {
    // 节点缓存会在 DOM observer/render 中高频变化，使用短防抖减少磁盘写入。
    pendingCacheWrite = { key, value };
    clearTimeout(cacheWriteTimer);
    cacheWriteTimer = setTimeout(flushCacheWrite, 320);
  }

  function load() {
    const value = memoryGet(STORE + convKey(), {});
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  }

  function save(patch) {
    const key = STORE + convKey();
    const next = { ...load(), ...patch };
    writeStorageImmediate(key, next);
    return next;
  }

  function cacheKey() {
    return CACHE_STORE + convKey();
  }

  function loadTurnCache() {
    const value = memoryGet(cacheKey(), []);
    return Array.isArray(value) ? value : [];
  }

  function saveTurnCache(items) {
    const trimmed = items.slice(-MAX_CACHE_TURNS);
    extensionStorageMemory.set(cacheKey(), trimmed);

    if (extensionStorageFallback) {
      try {
        localStorage.setItem(cacheKey(), JSON.stringify(trimmed));
      } catch {}
      return;
    }

    queueCacheWrite(cacheKey(), trimmed);
  }


  function apiCacheKey() {
    return API_CACHE_STORE + convKey();
  }

  function loadApiConversation() {
    const value = memoryGet(apiCacheKey(), null);

    if (
      !value ||
      typeof value !== "object" ||
      !Array.isArray(value.messages)
    ) {
      return null;
    }

    return value;
  }

  function saveApiConversation(value) {
    if (!value || !Array.isArray(value.messages)) return;

    const safe = {
      conversationId: value.conversationId || convKey(),
      title: value.title || "",
      format: value.format || "unknown",
      source: "internal-api",
      complete: !!value.complete,
      pageCount: Number(value.pageCount || 1) || 1,
      currentNode: value.currentNode || "",
      capturedAt: Number(value.capturedAt || Date.now()),
      savedAt: Date.now(),
      messages: value.messages
        .slice(-MAX_API_USER_MESSAGES)
        .map((m, i) => ({
          id: m.id || `api-${i}`,
          text: String(m.text || "[用户消息]"),
          createTime: Number(m.createTime || 0) || 0,
          updateTime: Number(m.updateTime || 0) || 0,
          order: Number.isFinite(m.order) ? m.order : i,
          hasAttachments: !!m.hasAttachments,
          attachments: Array.isArray(m.attachments)
            ? m.attachments.slice(0, 30)
            : []
        }))
    };

    writeStorageImmediate(apiCacheKey(), safe);
  }

  function normalizeMessageText(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function mergeInternalPayload(incoming) {
    if (!incoming?.conversationId || !Array.isArray(incoming.messages)) return;

    const existing = loadApiConversation();
    const sameConversation =
      existing &&
      existing.conversationId === incoming.conversationId;

    let messages;

    if (incoming.complete) {
      messages = incoming.messages;
    } else if (sameConversation) {
      const map = new Map();

      [...existing.messages, ...incoming.messages].forEach((m, i) => {
        const id = m?.id || `text:${normalizeMessageText(m?.text)}:${i}`;

        if (!map.has(id)) map.set(id, m);
        else map.set(id, { ...map.get(id), ...m });
      });

      messages = [...map.values()].sort((a, b) => {
        const at = Number(a.createTime || 0);
        const bt = Number(b.createTime || 0);

        if (at && bt && at !== bt) return at - bt;
        return Number(a.order || 0) - Number(b.order || 0);
      });
    } else {
      messages = incoming.messages;
    }

    saveApiConversation({
      ...(sameConversation ? existing : {}),
      ...incoming,
      complete: !!incoming.complete || !!existing?.complete,
      messages
    });
  }

  function postToPage(type, {
    requestId="",
    conversationId=convKey()
  }={}) {
    window.postMessage({
      __cwv25: true,
      channel: "extension-to-page",
      type,
      requestId,
      conversationId
    }, "*");
  }

  function installInternalBridgeListener() {
    window.addEventListener("message", (event) => {
      if (event.source !== window) return;

      const data = event.data;

      if (
        !data ||
        data.__cwv25 !== true ||
        data.channel !== "page-to-extension"
      ) return;

      if (data.type === "CWV25_BRIDGE_READY") {
        internalBridgeReady = true;
        internalSourceState = "waiting";
        postToPage("CWV25_REQUEST_SNAPSHOT");
        scheduleRender(50);
        return;
      }

      if (data.type === "CWV25_CONVERSATION_DATA") {
        const payload = data.payload;

        if (
          payload?.conversationId &&
          payload.conversationId === convKey()
        ) {
          mergeInternalPayload(payload);
          internalSourceState = payload.complete ? "ready" : "partial";
          internalSourceError = "";

          const waiter = data.requestId
            ? internalRequestWaiters.get(data.requestId)
            : null;

          if (waiter && payload.complete) {
            clearTimeout(waiter.timer);
            internalRequestWaiters.delete(data.requestId);
            waiter.resolve({ ok:true, payload });
          }

          scheduleRender(30);
        }

        return;
      }

      if (data.type === "CWV25_INTERNAL_STATUS") {
        if (
          data.conversationId &&
          data.conversationId !== convKey()
        ) return;

        internalSourceState = data.state || internalSourceState;

        if (data.state === "error") {
          internalSourceError = data.error || "内部对话读取失败";
        }

        const waiter = data.requestId
          ? internalRequestWaiters.get(data.requestId)
          : null;

        if (waiter) {
          if (data.state === "ready") {
            clearTimeout(waiter.timer);
            internalRequestWaiters.delete(data.requestId);
            waiter.resolve({ ok:true, status:data });
          } else if (data.state === "error") {
            clearTimeout(waiter.timer);
            internalRequestWaiters.delete(data.requestId);
            waiter.resolve({
              ok:false,
              error:data.error || "internal fetch failed"
            });
          }
        }

        scheduleRender(80);
      }
    });
  }

  function requestInternalSnapshot() {
    postToPage("CWV25_REQUEST_SNAPSHOT");
  }

  function requestInternalFull({
    timeout=22000,
    wait=true
  }={}) {
    const requestId =
      `cwv25-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    postToPage("CWV25_REQUEST_FULL_CONVERSATION", {
      requestId
    });

    if (!wait) return Promise.resolve({ ok:true, queued:true });

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        internalRequestWaiters.delete(requestId);
        resolve({ ok:false, error:"内部数据读取超时" });
      }, timeout);

      internalRequestWaiters.set(requestId, { resolve, timer });
    });
  }

  function attachLiveTargetsToApi(apiMessages, liveTurns) {
    const apiTurns = apiMessages.map((m, i) => ({
      stableId: `api:${m.id || i}`,
      apiMessageId: m.id || "",
      text: m.text || "[用户消息]",
      createTime: Number(m.createTime || 0) || 0,
      hasAttachments: !!m.hasAttachments,
      attachments: Array.isArray(m.attachments) ? m.attachments : [],
      source: "internal-api",
      target: null,
      roleNode: null,
      testid: "",
      domOrder: i,
      index: i
    }));

    const byText = new Map();

    apiTurns.forEach((t, i) => {
      const key = normalizeMessageText(t.text);
      if (!key) return;

      if (!byText.has(key)) byText.set(key, []);
      byText.get(key).push(i);
    });

    const matchedApi = new Set();
    const unmatchedLive = [];

    [...liveTurns].reverse().forEach((live) => {
      const key = normalizeMessageText(live.text);
      const candidates = byText.get(key) || [];

      let apiIndex = null;

      for (let j = candidates.length - 1; j >= 0; j--) {
        if (!matchedApi.has(candidates[j])) {
          apiIndex = candidates[j];
          break;
        }
      }

      if (apiIndex == null) {
        unmatchedLive.push(live);
        return;
      }

      matchedApi.add(apiIndex);

      apiTurns[apiIndex] = {
        ...apiTurns[apiIndex],
        target: live.target || null,
        roleNode: live.roleNode || null,
        testid: live.testid || "",
        domOrder: live.domOrder
      };
    });

    unmatchedLive.reverse().forEach((live) => {
      apiTurns.push({
        ...live,
        source: "dom-live"
      });
    });

    apiTurns.forEach((t, i) => t.index = i);
    return apiTurns;
  }

  function buildNavigationTurns(liveTurns) {
    const domTurns = mergeTurnCache(liveTurns);
    const api = loadApiConversation();

    if (!api?.messages?.length) return domTurns;

    return attachLiveTargetsToApi(api.messages, liveTurns);
  }

  function dataSourceLabel() {
    const api = loadApiConversation();

    if (api?.messages?.length) {
      if (api.complete) {
        return `完整对话 · 内部数据 · ${api.messages.length} 条`;
      }

      return `内部数据 · 已获取 ${api.messages.length} 条`;
    }

    if (internalSourceState === "loading") return "内部数据读取中…";
    if (internalSourceState === "error") return "页面扫描 · 内部读取失败";
    return "页面扫描 · DOM 缓存";
  }

  function mergeTurnCache(liveTurns) {
    const cached = loadTurnCache();
    const map = new Map();

    // 先放缓存，再用当前 DOM 的 live target 覆盖
    [...cached, ...liveTurns].forEach((t) => {
      const key = t.stableId || t.testid || `text:${(t.text || "").slice(0,160)}`;
      if (!key) return;
      const old = map.get(key) || {};
      map.set(key, {
        ...old,
        stableId: key,
        text: t.text || old.text || "",
        target: t.target || old.target || null,
        roleNode: t.roleNode || old.roleNode || null,
        testid: t.testid || old.testid || "",
        domOrder: Number.isFinite(t.domOrder) ? t.domOrder : old.domOrder,
        cachedAt: Date.now()
      });
    });

    let merged = [...map.values()];

    // conversation-turn-N 可以直接用于排序；没有编号的按缓存顺序兜底
    merged.sort((a, b) => {
      const ai = extractTurnNumber(a.testid || a.stableId);
      const bi = extractTurnNumber(b.testid || b.stableId);
      if (ai != null && bi != null) return ai - bi;
      if (ai != null) return -1;
      if (bi != null) return 1;
      return (a.domOrder ?? 999999) - (b.domOrder ?? 999999);
    });

    merged.forEach((t, i) => t.index = i);

    // 只把可序列化字段落盘
    saveTurnCache(merged.map(t => ({
      stableId: t.stableId,
      text: t.text,
      testid: t.testid || "",
      domOrder: t.domOrder ?? iSafe(t.index)
    })));

    return merged;
  }

  function iSafe(v) {
    return Number.isFinite(v) ? v : 999999;
  }

  function extractTurnNumber(value) {
    if (!value) return null;
    const m = String(value).match(/conversation-turn-(\d+)/);
    return m ? Number(m[1]) : null;
  }

  function cloneDefaultPrompts() {
    return QUICK_PROMPTS.map(p => ({ ...p }));
  }

  function loadPrompts() {
    try {
      const parsed = memoryGet(PROMPT_STORE_KEY, null);
      if (!Array.isArray(parsed) || !parsed.length) return cloneDefaultPrompts();

      return parsed
        .filter(p => p && typeof p.label === "string" && typeof p.text === "string")
        .map((p, i) => ({
          id: p.id || `custom-${Date.now()}-${i}`,
          label: p.label.trim() || `快捷提示词${i + 1}`,
          text: p.text
        }));
    } catch {
      return cloneDefaultPrompts();
    }
  }

  function savePrompts(prompts) {
    writeStorageImmediate(PROMPT_STORE_KEY, prompts);
  }

  function cleanText(el) {
    return (el?.innerText || el?.textContent || "")
      .replace(/\s+/g, " ")
      .replace(/^You said:\s*/i, "")
      .trim();
  }

  function getUserTurns() {
    /*
      V2.2.2
      不再使用“主选择器有结果就完全放弃 fallback”的二选一逻辑。
      ChatGPT 不同批次/历史消息可能使用不同 DOM 结构，因此需要把多个来源
      同时扫描、合并、去重，并按页面真实顺序排序。
    */

    const candidates = [];
    const candidateSeen = new Set();

    function addCandidate(target, roleNode=null, source="unknown") {
      if (!target || !(target instanceof Element)) return;

      // 尽量统一到完整 conversation turn / article，避免同一条消息被重复计数。
      const normalizedTarget =
        target.closest?.('[data-testid^="conversation-turn-"]') ||
        target.closest?.("article") ||
        target;

      if (!normalizedTarget || candidateSeen.has(normalizedTarget)) return;

      // 确认它确实是用户消息。
      const directRole =
        normalizedTarget.getAttribute?.("data-message-author-role") ||
        roleNode?.getAttribute?.("data-message-author-role") ||
        normalizedTarget.querySelector?.('[data-message-author-role]')?.getAttribute("data-message-author-role") ||
        "";

      const aria = (
        normalizedTarget.getAttribute?.("aria-label") ||
        normalizedTarget.querySelector?.("[aria-label]")?.getAttribute("aria-label") ||
        ""
      ).toLowerCase();

      const testid = (normalizedTarget.getAttribute?.("data-testid") || "").toLowerCase();

      const isUser =
        directRole === "user" ||
        !!normalizedTarget.querySelector?.('[data-message-author-role="user"]') ||
        /\byou\b|你|您/.test(aria) && !/assistant|chatgpt/.test(aria);

      if (!isUser) return;

      candidateSeen.add(normalizedTarget);
      candidates.push({
        target: normalizedTarget,
        roleNode:
          roleNode ||
          normalizedTarget.querySelector?.('[data-message-author-role="user"]') ||
          normalizedTarget,
        source,
        testid
      });
    }

    // 来源 A：标准角色节点
    document.querySelectorAll('[data-message-author-role="user"]').forEach(node => {
      addCandidate(node, node, "role");
    });

    // 来源 B：所有 conversation-turn；无论 A 是否有结果都扫描
    document.querySelectorAll('[data-testid^="conversation-turn-"]').forEach(turn => {
      const userRole = turn.querySelector('[data-message-author-role="user"]');
      if (userRole) addCandidate(turn, userRole, "turn");
    });

    // 来源 C：article 中的用户角色节点
    document.querySelectorAll("article").forEach(article => {
      const userRole = article.querySelector('[data-message-author-role="user"]');
      if (userRole) addCandidate(article, userRole, "article");
    });

    // 按 DOM 页面顺序排序，避免不同来源合并后顺序错乱
    candidates.sort((a, b) => {
      if (a.target === b.target) return 0;
      const pos = a.target.compareDocumentPosition(b.target);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    const turns = [];
    const textSeen = new Set();

    candidates.forEach((c) => {
      // 优先取 user role 本身的文本，避免整篇 article 混入 assistant 文本
      let text = cleanText(c.roleNode);
      if (!text || text.length < 1) text = cleanText(c.target);
      if (!text) return;

      // 二级去重：部分 DOM 版本会生成不同 wrapper 指向同一条用户消息
      const stableTestId = c.target.getAttribute?.("data-testid") || "";
      const dedupeKey = stableTestId || text.slice(0, 240);
      if (textSeen.has(dedupeKey)) return;
      textSeen.add(dedupeKey);

      turns.push({
        target: c.target,
        roleNode: c.roleNode,
        text,
        index: turns.length,
        stableId: stableTestId || `text:${text.slice(0,160)}`,
        testid: stableTestId || "",
        domOrder: turns.length
      });
    });

    turns.forEach((t, i) => {
      t.index = i;
      try {
        t.target.dataset.cwv21Turn = String(i);
      } catch {}
    });

    return turns;
  }

  function stageFor(text) {
    for (let i = WORKFLOW.length - 1; i >= 0; i--) {
      if (WORKFLOW[i].patterns.some(re => re.test(text))) {
        return { index:i, ...WORKFLOW[i] };
      }
    }
    return null;
  }

  function autoStage(turns) {
    let best = -1;
    for (const t of turns) {
      const s = stageFor(t.text);
      if (s) best = Math.max(best, s.index);
    }
    return best;
  }

  function ensureRoot() {
    const old = document.getElementById(ROOT_ID);
    if (old) {
      root = old;
      return;
    }

    root = document.createElement("div");
    root.id = ROOT_ID;
    root.innerHTML = `
      <div class="cwv21-nav-rail" aria-label="对话节点导航">
        <div class="cwv21-rail-head">
          <button class="cwv21-top-btn" title="回到顶部">↑</button>
          <span class="cwv21-rail-count">0</span>
        </div>
        <div class="cwv21-ticks"></div>
        <button class="cwv21-workbench-btn" title="打开工作台">工</button>

        <div class="cwv21-flyout">
          <div class="cwv21-flyout-head">
            <div>
              <b>对话导航</b>
              <span class="cwv21-flyout-sub">全部用户消息</span>
            </div>
            <div class="cwv23-fly-actions">
              <button class="cwv23-load-all">加载全部</button>
              <button class="cwv21-open-panel">工作台 ›</button>
            </div>
          </div>
          <div class="cwv21-fly-list"></div>
        </div>
      </div>

      <aside class="cwv21-panel">
        <header class="cwv21-header">
          <div>
            <div class="cwv21-kicker">CHATGPT WORKFLOW</div>
            <div class="cwv21-title">本轮工作台</div>
          </div>
          <button class="cwv21-close" title="收起">×</button>
        </header>

        <section class="cwv21-section">
          <div class="cwv21-section-head">
            <span>快捷提示词</span>
            <div class="cwv21-prompt-head-actions">
              <span class="cwv21-tip">点击填入输入框</span>
              <button class="cwv21-prompt-manage">编辑</button>
            </div>
          </div>
          <div class="cwv21-prompt-grid"></div>
        </section>

        <section class="cwv21-section cwv21-nav-section">
          <div class="cwv21-section-head">
            <span>对话节点</span>
            <div class="cwv23-node-head-actions">
              <button class="cwv23-load-all-panel">加载全部</button>
              <div class="cwv21-mode">
                <button data-mode="all" class="is-active">全部</button>
                <button data-mode="key">关键</button>
              </div>
            </div>
          </div>
          <div class="cwv21-node-meta"></div>
          <div class="cwv21-node-list"></div>
        </section>
      </aside>

      <div class="cwv21-editor-backdrop">
        <div class="cwv21-editor" role="dialog" aria-modal="true">
          <header class="cwv21-editor-header">
            <div>
              <div class="cwv21-kicker">QUICK PROMPTS</div>
              <div class="cwv21-editor-title">编辑快捷提示词</div>
            </div>
            <button class="cwv21-editor-close" title="关闭">×</button>
          </header>

          <div class="cwv21-editor-note">
            修改后会保存到当前浏览器，并在所有 ChatGPT 对话中共用。
          </div>

          <div class="cwv21-editor-list"></div>

          <div class="cwv21-editor-footer">
            <button class="cwv21-editor-reset">恢复默认</button>
            <div class="cwv21-editor-footer-right">
              <button class="cwv21-editor-add">＋ 新增</button>
              <button class="cwv21-editor-save">保存修改</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    // V2.2.1：把编辑器移出带 transform 的插件根容器，
    // 避免 position:fixed 被错误限制在侧栏坐标系中。
    const detachedPromptEditor = root.querySelector(".cwv21-editor-backdrop");
    if (detachedPromptEditor) {
      detachedPromptEditor.remove();
      document.body.appendChild(detachedPromptEditor);
    }

    root.querySelector(".cwv21-top-btn").addEventListener("click", scrollTop);
    root.querySelector(".cwv21-workbench-btn").addEventListener("click", openPanel);
    root.querySelector(".cwv21-open-panel").addEventListener("click", openPanel);
    root.querySelector(".cwv23-load-all")?.addEventListener("click", loadAllHistory);
    root.querySelector(".cwv23-load-all-panel")?.addEventListener("click", loadAllHistory);
    root.querySelector(".cwv21-close").addEventListener("click", closePanel);

    // V2.3.1：用 JS 保持导航展开状态，避免从细条移动到浮层途中因 hover 空隙而消失。
    const navRail = root.querySelector(".cwv21-nav-rail");
    const flyout = root.querySelector(".cwv21-flyout");

    const keepFlyoutOpen = () => {
      clearTimeout(flyoutCloseTimer);

      // V2.5.2：对话导航与工作台严格互斥。
      // 只要准备显示对话导航，就立即关闭工作台。
      if (root.classList.contains("panel-open")) {
        closePanel();
      }

      root.classList.add("flyout-open");
    };

    const scheduleFlyoutClose = () => {
      clearTimeout(flyoutCloseTimer);
      flyoutCloseTimer = setTimeout(() => {
        root.classList.remove("flyout-open");
      }, 320);
    };

    navRail?.addEventListener("mouseenter", keepFlyoutOpen);
    navRail?.addEventListener("mouseleave", scheduleFlyoutClose);
    flyout?.addEventListener("mouseenter", keepFlyoutOpen);
    flyout?.addEventListener("mouseleave", scheduleFlyoutClose);

    // V2.3.3：工作台鼠标移开后自动隐藏。
    // 进入工作台取消关闭计时；离开后延迟 450ms 收起。
    const workbenchPanel = root.querySelector(".cwv21-panel");
    workbenchPanel?.addEventListener("mouseenter", cancelPanelAutoClose);
    workbenchPanel?.addEventListener("mouseleave", schedulePanelAutoClose);

    // 鼠标移到右侧导航细条时，也暂时保持工作台，
    // 避免从工作台移向右侧控制区时过早收起。
    navRail?.addEventListener("mouseenter", cancelPanelAutoClose);
    navRail?.addEventListener("mouseleave", () => {
      if (root.classList.contains("panel-open")) {
        schedulePanelAutoClose();
      }
    });
    root.querySelector(".cwv21-prompt-manage").addEventListener("click", openPromptEditor);

    const promptEditorLayer = document.querySelector(".cwv21-editor-backdrop");
    promptEditorLayer?.querySelector(".cwv21-editor-close")?.addEventListener("click", closePromptEditor);
    promptEditorLayer?.addEventListener("click", (e) => {
      if (e.target === promptEditorLayer) closePromptEditor();
    });
    promptEditorLayer?.querySelector(".cwv21-editor-add")?.addEventListener("click", addPromptEditorRow);
    promptEditorLayer?.querySelector(".cwv21-editor-save")?.addEventListener("click", savePromptEditor);
    promptEditorLayer?.querySelector(".cwv21-editor-reset")?.addEventListener("click", resetPromptEditor);

    root.querySelectorAll(".cwv21-mode button").forEach(btn => {
      btn.addEventListener("click", () => {
        nodeMode = btn.dataset.mode;
        root.querySelectorAll(".cwv21-mode button").forEach(b =>
          b.classList.toggle("is-active", b === btn)
        );
        renderNodes(getUserTurns());
      });
    });

    const state = load();
    if (state.panelOpen) {
      root.classList.remove("flyout-open");
      root.classList.add("panel-open");
    }
  }

  function cancelPanelAutoClose() {
    clearTimeout(panelCloseTimer);
    panelCloseTimer = null;
  }

  function schedulePanelAutoClose() {
    cancelPanelAutoClose();

    panelCloseTimer = setTimeout(() => {
      // 快捷提示词编辑器打开时不自动收起工作台，
      // 避免用户编辑提示词时工作台在背景中突然消失。
      if (getPromptEditor()?.classList.contains("is-open")) return;

      closePanel();
    }, 450);
  }

  function openPanel() {
    cancelPanelAutoClose();

    // V2.5.2：工作台与对话导航严格互斥。
    clearTimeout(flyoutCloseTimer);
    root.classList.remove("flyout-open");

    root.classList.add("panel-open");
    save({ panelOpen:true });
  }

  function closePanel() {
    cancelPanelAutoClose();
    root.classList.remove("panel-open");
    save({ panelOpen:false });
  }

  function scrollTop() {
    const main = document.querySelector("main");
    window.scrollTo({ top:0, behavior:"smooth" });
    if (main) {
      try { main.scrollTo({ top:0, behavior:"smooth" }); } catch {}
    }
    const first = getUserTurns()[0];
    if (first?.target) first.target.scrollIntoView({ behavior:"smooth", block:"start" });
  }

  async function jump(turn) {
    if (!turn) return;

    // 1. 当前 DOM 中仍然有 target
    if (turn.target && document.contains(turn.target)) {
      turn.target.scrollIntoView({ behavior:"smooth", block:"center" });
      flashTurn(turn.target);
      return;
    }

    // 2. 内部数据带有真实 message id 时优先匹配。
    if (turn.apiMessageId) {
      const escapedId = CSS.escape(turn.apiMessageId);

      const byMessageId =
        document.querySelector(`[data-message-id="${escapedId}"]`) ||
        document.querySelector(`[data-message-id^="${escapedId}"]`);

      if (byMessageId) {
        const target =
          byMessageId.closest('[data-testid^="conversation-turn-"]') ||
          byMessageId.closest("article") ||
          byMessageId;

        target.scrollIntoView({ behavior:"smooth", block:"center" });
        flashTurn(target);
        return;
      }
    }

    // 3. DOM 缓存节点：尝试通过 stable testid 重新定位
    if (turn.testid) {
      const byId = document.querySelector(`[data-testid="${CSS.escape(turn.testid)}"]`);
      if (byId) {
        byId.scrollIntoView({ behavior:"smooth", block:"center" });
        flashTurn(byId);
        return;
      }
    }

    // 3. 旧消息被虚拟化卸载：自动向上加载并寻找
    toast("正在加载该历史节点…");
    const found = await seekCachedTurn(turn);
    if (found) {
      found.scrollIntoView({ behavior:"smooth", block:"center" });
      flashTurn(found);
    } else {
      toast("暂未定位到该节点，可先点“加载全部”");
    }
  }

  function flashTurn(target) {
    if (!target) return;
    target.classList.remove("cwv21-flash");
    void target.offsetWidth;
    target.classList.add("cwv21-flash");
    setTimeout(() => target.classList.remove("cwv21-flash"), 1500);
  }


  function isDocumentScroller(el) {
    return el === document.scrollingElement ||
           el === document.documentElement ||
           el === document.body;
  }

  function scrollerTop(el) {
    if (isDocumentScroller(el)) {
      return window.scrollY ||
             document.documentElement.scrollTop ||
             document.body.scrollTop ||
             0;
    }
    return el.scrollTop;
  }

  function scrollerHeight(el) {
    if (isDocumentScroller(el)) {
      return Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight
      );
    }
    return el.scrollHeight;
  }

  function scrollerClientHeight(el) {
    if (isDocumentScroller(el)) return window.innerHeight;
    return el.clientHeight;
  }

  function setScrollerTop(el, top) {
    top = Math.max(0, top);
    if (isDocumentScroller(el)) {
      window.scrollTo({ top, behavior:"instant" });
      document.documentElement.scrollTop = top;
      document.body.scrollTop = top;
    } else {
      el.scrollTop = top;
    }
  }

  function findConversationScroller() {
    /*
      V2.3.1：
      ChatGPT 当前桌面版常直接使用页面主滚动条。
      旧版优先从 main 内挑 scrollHeight 最大的节点，可能误选内部容器。
      现在先判断 document scrollingElement，再检查消息祖先。
    */
    const docScroller = document.scrollingElement || document.documentElement;
    if (docScroller &&
        scrollerHeight(docScroller) > scrollerClientHeight(docScroller) + 160) {
      return docScroller;
    }

    const live = getUserTurns();
    const anchor = live[live.length - 1]?.target || document.querySelector("main");
    let el = anchor;

    while (el && el !== document.body) {
      const style = getComputedStyle(el);
      const oy = style.overflowY;
      if ((oy === "auto" || oy === "scroll") &&
          el.scrollHeight > el.clientHeight + 120) {
        return el;
      }
      el = el.parentElement;
    }

    const candidates = [...document.querySelectorAll("main *")].filter(node => {
      const style = getComputedStyle(node);
      return (style.overflowY === "auto" || style.overflowY === "scroll") &&
             node.scrollHeight > node.clientHeight + 250;
    });

    // 更偏向接近视口宽度的大型容器，而不是内部小列表。
    candidates.sort((a, b) => {
      const aWidthScore = Math.min(a.clientWidth / Math.max(window.innerWidth,1), 1);
      const bWidthScore = Math.min(b.clientWidth / Math.max(window.innerWidth,1), 1);
      const aScore = a.scrollHeight * (0.45 + aWidthScore);
      const bScore = b.scrollHeight * (0.45 + bWidthScore);
      return bScore - aScore;
    });

    return candidates[0] || docScroller || document.documentElement;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function updateHistoryLoadButtons(text, disabled=false) {
    root?.querySelectorAll(".cwv23-load-all, .cwv23-load-all-panel").forEach(btn => {
      btn.textContent = text;
      btn.disabled = disabled;
    });
  }

  function historySignature(scroller) {
    const merged = mergeTurnCache(getUserTurns());
    const nums = merged
      .map(t => extractTurnNumber(t.testid || t.stableId))
      .filter(n => n != null);

    return {
      count: merged.length,
      minTurn: nums.length ? Math.min(...nums) : null,
      height: scrollerHeight(scroller)
    };
  }

  function sameHistorySignature(a, b) {
    return !!a && !!b &&
      a.count === b.count &&
      a.minTurn === b.minTurn &&
      Math.abs(a.height - b.height) < 8;
  }


  async function loadAllHistory() {
    if (isLoadingHistory) return;

    updateHistoryLoadButtons("读取完整…", true);
    internalSourceState = "loading";
    scheduleRender(30);

    const result = await requestInternalFull({
      timeout: 22000,
      wait: true
    });

    const api = loadApiConversation();

    if (result.ok && api?.complete && api.messages.length) {
      updateHistoryLoadButtons("加载全部", false);
      internalSourceState = "ready";
      render();
      toast(`已直接读取完整对话：${api.messages.length} 条用户消息`);
      return;
    }

    internalSourceState = "error";
    internalSourceError = result.error || "内部数据读取失败";
    updateHistoryLoadButtons("DOM加载…", true);

    await loadAllHistoryByDom();
  }

  async function loadAllHistoryByDom() {
    if (isLoadingHistory) return;
    isLoadingHistory = true;

    const scroller = findConversationScroller();
    if (!scroller) {
      isLoadingHistory = false;
      toast("未找到对话滚动区域");
      return;
    }

    // 用“距底部距离”恢复阅读位置，比直接记 scrollTop 更适合历史内容不断向顶部插入的页面。
    const originalHeight = scrollerHeight(scroller);
    const originalClient = scrollerClientHeight(scroller);
    const originalTop = scrollerTop(scroller);
    const originalDistanceFromBottom =
      Math.max(0, originalHeight - originalClient - originalTop);

    let rounds = 0;
    let topStableRounds = 0;
    let previousTopSignature = null;
    let lastCount = mergeTurnCache(getUserTurns()).length;

    updateHistoryLoadButtons("加载中…", true);
    toast("正在向上加载完整历史消息…");

    try {
      /*
        关键修复：
        旧版只要连续 5 轮“节点数没增长”就结束，
        即使还离对话顶部很远也会退出。

        新版规则：
        - 没到顶部：无条件继续向上翻，绝不因“节点没增长”结束。
        - 真正到顶部后：等待 ChatGPT 加载/插入更早历史。
        - 只有顶部连续稳定多轮，且节点数/最早 turn/scrollHeight 都不再变化，才结束。
      */
      while (rounds < 220) {
        rounds++;

        const topBefore = scrollerTop(scroller);
        const clientH = scrollerClientHeight(scroller);

        if (topBefore > 3) {
          const step = Math.max(clientH * 0.78, 560);
          setScrollerTop(scroller, topBefore - step);

          // 每次真的向上移动后都给 DOM/虚拟列表一些挂载时间。
          await sleep(230);

          const merged = mergeTurnCache(getUserTurns());
          if (merged.length !== lastCount) {
            lastCount = merged.length;
            render();
          }

          updateHistoryLoadButtons(`已发现 ${lastCount}`, true);
          topStableRounds = 0;
          previousTopSignature = null;
          continue;
        }

        // 已经到当前顶部。这里需要更长等待，因为 ChatGPT 可能正在请求/挂载更早历史。
        setScrollerTop(scroller, 0);
        await sleep(720);

        // 再轻推一次到顶部，兼容 prepend 后浏览器自动锚定导致 scrollTop 被抬高。
        if (scrollerTop(scroller) > 3) {
          setScrollerTop(scroller, 0);
          await sleep(360);
        }

        const merged = mergeTurnCache(getUserTurns());
        lastCount = merged.length;
        render();
        updateHistoryLoadButtons(`顶部扫描 ${lastCount}`, true);

        const sig = historySignature(scroller);

        if (sameHistorySignature(sig, previousTopSignature) &&
            scrollerTop(scroller) <= 3) {
          topStableRounds++;
        } else {
          topStableRounds = 0;
        }

        previousTopSignature = sig;

        // 顶部至少连续稳定 7 轮（约 5~8 秒）才认定没有更早历史可加载。
        if (topStableRounds >= 7) break;
      }

      const finalTurns = mergeTurnCache(getUserTurns());
      render();

      // 恢复原位置
      const newHeight = scrollerHeight(scroller);
      const newClient = scrollerClientHeight(scroller);
      const restoreTop = Math.max(
        0,
        newHeight - newClient - originalDistanceFromBottom
      );
      setScrollerTop(scroller, restoreTop);
      await sleep(160);

      toast(`历史扫描完成：已缓存 ${finalTurns.length} 条用户消息`);
    } finally {
      isLoadingHistory = false;
      updateHistoryLoadButtons("加载全部", false);
    }
  }

  async function seekCachedTurn(turn) {
    const scroller = findConversationScroller();
    if (!scroller) return null;

    let rounds = 0;
    while (rounds < 55) {
      rounds++;

      if (turn.testid) {
        const byId = document.querySelector(`[data-testid="${CSS.escape(turn.testid)}"]`);
        if (byId) return byId;
      }

      // 用文本前缀兜底
      const prefix = (turn.text || "").slice(0, 48);
      if (prefix) {
        const live = getUserTurns();
        const match = live.find(t => t.text.startsWith(prefix) || prefix.startsWith(t.text.slice(0, 32)));
        if (match?.target) return match.target;
      }

      const before = scroller.scrollTop;
      scroller.scrollTop = Math.max(0, before - Math.max(scroller.clientHeight * .85, 480));
      await sleep(150);
      mergeTurnCache(getUserTurns());

      if (scroller.scrollTop <= 2 && before <= 2) break;
    }
    return null;
  }

  function renderRail(turns) {
    const ticks = root.querySelector(".cwv21-ticks");
    const fly = root.querySelector(".cwv21-fly-list");
    root.querySelector(".cwv21-rail-count").textContent = String(turns.length);

    const flyoutSub = root.querySelector(".cwv21-flyout-sub");
    if (flyoutSub) flyoutSub.textContent = dataSourceLabel();

    ticks.innerHTML = "";
    fly.innerHTML = "";

    if (!turns.length) {
      fly.innerHTML = `<div class="cwv21-empty">暂未识别到用户消息</div>`;
      return;
    }

    turns.forEach((turn, i) => {
      const pct = turns.length === 1 ? 50 : (i / (turns.length - 1)) * 100;

      const tick = document.createElement("button");
      tick.className = "cwv21-tick";
      tick.style.top = `${pct}%`;
      tick.title = `${i + 1}. ${turn.text.slice(0, 120)}`;
      if (stageFor(turn.text)) tick.classList.add("is-key");
      tick.innerHTML = `<span></span>`;
      tick.addEventListener("click", (e) => {
        e.stopPropagation();
        jump(turn);
      });
      ticks.appendChild(tick);

      const row = document.createElement("button");
      row.className = "cwv21-fly-row";
      const stage = stageFor(turn.text);
      row.innerHTML = `
        <span class="cwv21-fly-num">${String(i + 1).padStart(2,"0")}</span>
        <span class="cwv21-fly-text">
          ${stage ? `<em>${esc(stage.short)}</em>` : ""}
          ${esc(turn.text.length > 74 ? turn.text.slice(0,74) + "…" : turn.text)}
        </span>
      `;
      row.addEventListener("click", () => jump(turn));
      fly.appendChild(row);
    });
  }

  function renderWorkflow(turns) {
    const box = root.querySelector(".cwv21-stages");
    const note = root.querySelector(".cwv21-stage-note");
    const fill = root.querySelector(".cwv21-progress i");
    const state = load();

    const detected = autoStage(turns);
    const current = Number.isInteger(state.manualStage) ? state.manualStage : detected;

    box.innerHTML = "";
    WORKFLOW.forEach((s, i) => {
      const btn = document.createElement("button");
      btn.className = "cwv21-stage";
      if (i <= current) btn.classList.add("is-done");
      if (i === current) btn.classList.add("is-current");
      btn.title = `${s.title}｜点击手动设为当前阶段`;
      btn.innerHTML = `
        <span>${i < current ? "✓" : i + 1}</span>
        <small>${s.short}</small>
      `;
      btn.addEventListener("click", () => {
        save({ manualStage:i });
        render();
      });
      box.appendChild(btn);
    });

    fill.style.width = `${current < 0 ? 0 : ((current + 1) / WORKFLOW.length) * 100}%`;
    if (current < 0) {
      note.textContent = "尚未识别到工作流阶段";
    } else {
      note.textContent = `${Number.isInteger(state.manualStage) ? "手动" : "自动"}｜当前：${WORKFLOW[current].title}`;
    }
  }

  function renderNodes(turns) {
    const list = root.querySelector(".cwv21-node-list");
    const meta = root.querySelector(".cwv21-node-meta");

    const nodes = turns
      .map(t => ({ turn:t, stage:stageFor(t.text) }))
      .filter(x => nodeMode === "all" || x.stage)
      .slice(-MAX_PANEL_NODES);

    const sourceText = dataSourceLabel();

    meta.textContent =
      nodeMode === "all"
        ? `共 ${turns.length} 条用户消息 · ${sourceText}`
        : `关键节点 ${nodes.length} 个 · ${sourceText}`;

    list.innerHTML = "";
    if (!nodes.length) {
      list.innerHTML = `<div class="cwv21-empty">当前筛选下没有节点</div>`;
      return;
    }

    nodes.forEach(({turn, stage}) => {
      const item = document.createElement("button");
      item.className = "cwv21-node";
      item.innerHTML = `
        <span class="cwv21-node-num">${String(turn.index + 1).padStart(2,"0")}</span>
        <span class="cwv21-node-main">
          <span class="cwv21-node-top">
            ${stage ? `<b>${esc(stage.title)}</b>` : `<b>用户消息</b>`}
            ${stage ? `<em>${esc(stage.short)}</em>` : ""}
          </span>
          <span class="cwv21-node-snippet">${esc(turn.text.length > 88 ? turn.text.slice(0,88)+"…" : turn.text)}</span>
        </span>
        <span class="cwv21-node-arrow">↗</span>
      `;
      item.addEventListener("click", () => jump(turn));
      list.appendChild(item);
    });
  }

  function renderPrompts() {
    const grid = root.querySelector(".cwv21-prompt-grid");
    const prompts = loadPrompts();
    grid.innerHTML = "";

    if (!prompts.length) {
      grid.innerHTML = `<div class="cwv21-empty cwv21-prompt-empty">还没有快捷提示词，点击“编辑”添加。</div>`;
      return;
    }

    prompts.forEach(p => {
      const btn = document.createElement("button");
      btn.textContent = p.label;
      btn.title = p.text;
      btn.addEventListener("click", () => insertPrompt(p.text, p.label));
      grid.appendChild(btn);
    });
  }

  function getPromptEditor() {
    return document.querySelector(".cwv21-editor-backdrop");
  }

  function openPromptEditor() {
    renderPromptEditorRows(loadPrompts());
    const editorLayer = getPromptEditor();
    if (!editorLayer) {
      toast("提示词编辑器加载失败，请重新加载扩展");
      return;
    }
    editorLayer.classList.add("is-open");
  }

  function closePromptEditor() {
    getPromptEditor()?.classList.remove("is-open");

    // 如果工作台仍打开，编辑器关闭后恢复自动收起机制。
    if (root?.classList.contains("panel-open")) {
      schedulePanelAutoClose();
    }
  }

  function renderPromptEditorRows(prompts) {
    const list = getPromptEditor()?.querySelector(".cwv21-editor-list");
    if (!list) return;
    list.innerHTML = "";

    prompts.forEach((p, i) => {
      list.appendChild(createPromptEditorRow(p, i));
    });
  }

  function createPromptEditorRow(prompt, index) {
    const row = document.createElement("div");
    row.className = "cwv21-editor-row";
    row.dataset.id = prompt.id || `custom-${Date.now()}-${index}`;
    row.innerHTML = `
      <div class="cwv21-editor-row-head">
        <span>快捷提示词 ${index + 1}</span>
        <button class="cwv21-editor-delete" title="删除此快捷提示词">删除</button>
      </div>
      <label>
        <span>按钮名称</span>
        <input class="cwv21-editor-label" maxlength="20" value="${esc(prompt.label || "")}">
      </label>
      <label>
        <span>提示词内容</span>
        <textarea class="cwv21-editor-text" rows="6">${esc(prompt.text || "")}</textarea>
      </label>
    `;

    row.querySelector(".cwv21-editor-delete").addEventListener("click", () => {
      row.remove();
      refreshPromptRowNumbers();
    });
    return row;
  }

  function refreshPromptRowNumbers() {
    getPromptEditor()?.querySelectorAll(".cwv21-editor-row").forEach((row, i) => {
      const title = row.querySelector(".cwv21-editor-row-head span");
      if (title) title.textContent = `快捷提示词 ${i + 1}`;
    });
  }

  function addPromptEditorRow() {
    const list = getPromptEditor()?.querySelector(".cwv21-editor-list");
    if (!list) return;
    const count = list.querySelectorAll(".cwv21-editor-row").length;

    if (count >= 12) {
      toast("最多保留 12 个快捷提示词");
      return;
    }

    const row = createPromptEditorRow({
      id:`custom-${Date.now()}`,
      label:"新提示词",
      text:""
    }, count);

    list.appendChild(row);
    row.scrollIntoView({ behavior:"smooth", block:"nearest" });
    row.querySelector(".cwv21-editor-label")?.focus();
  }

  function collectPromptEditorRows() {
    const editorLayer = getPromptEditor();
    if (!editorLayer) return [];
    return [...editorLayer.querySelectorAll(".cwv21-editor-row")].map((row, i) => ({
      id: row.dataset.id || `custom-${Date.now()}-${i}`,
      label: row.querySelector(".cwv21-editor-label")?.value.trim() || `快捷提示词${i + 1}`,
      text: row.querySelector(".cwv21-editor-text")?.value.trim() || ""
    })).filter(p => p.text);
  }

  function savePromptEditor() {
    const prompts = collectPromptEditorRows();

    if (!prompts.length) {
      toast("至少保留一个有内容的快捷提示词");
      return;
    }

    savePrompts(prompts);
    renderPrompts();
    closePromptEditor();
    toast("快捷提示词已保存");
  }

  function resetPromptEditor() {
    const defaults = cloneDefaultPrompts();
    savePrompts(defaults);
    renderPromptEditorRows(defaults);
    renderPrompts();
    toast("已恢复默认快捷提示词");
  }

  function composer() {
    return (
      document.querySelector("#prompt-textarea") ||
      document.querySelector('div[contenteditable="true"][data-lexical-editor="true"]') ||
      [...document.querySelectorAll('div[contenteditable="true"]')].find(el => el.closest("form")) ||
      document.querySelector("textarea")
    );
  }

  function insertPrompt(text, label) {
    const el = composer();
    if (!el) return toast("未找到 ChatGPT 输入框");

    el.focus();
    if (el.tagName === "TEXTAREA") {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter ? setter.call(el, text) : (el.value = text);
      el.dispatchEvent(new Event("input", { bubbles:true }));
    } else {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);

      let ok = false;
      try { ok = document.execCommand("insertText", false, text); } catch {}
      if (!ok) {
        el.textContent = text;
        el.dispatchEvent(new InputEvent("input", {
          bubbles:true, inputType:"insertText", data:text
        }));
      }
    }
    toast(`已填入：${label}`);
  }

  function toast(text) {
    let t = document.querySelector(".cwv21-toast");
    if (!t) {
      t = document.createElement("div");
      t.className = "cwv21-toast";
      document.body.appendChild(t);
    }
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), 1400);
  }

  function render() {
    ensureRoot();
    const liveTurns = getUserTurns();
    const turns = buildNavigationTurns(liveTurns);
    renderRail(turns);
    renderNodes(turns);
    renderPrompts();
  }

  function scheduleRender(delay=260) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, delay);
  }

  function startObserver() {
    observer?.disconnect();
    observer = new MutationObserver(() => scheduleRender(320));
    observer.observe(document.documentElement, {
      childList:true,
      subtree:true,
      attributes:true,
      attributeFilter:["data-message-author-role","data-testid","aria-label"]
    });
  }

  async function init() {
    installInternalBridgeListener();
    await initExtensionStorage();

    ensureRoot();
    render();
    startObserver();

    requestInternalSnapshot();

    setTimeout(() => {
      requestInternalFull({
        timeout: 22000,
        wait: true
      }).then((result) => {
        const api = loadApiConversation();

        if (result.ok && api?.complete) {
          internalSourceState = "ready";
          scheduleRender(20);
        } else if (!api?.messages?.length) {
          internalSourceState = "error";
          internalSourceError = result.error || "内部数据读取失败";
          scheduleRender(80);
        }
      });
    }, 1600);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && getPromptEditor()?.classList.contains("is-open")) {
        closePromptEditor();
      }
    });

    window.addEventListener("pagehide", flushCacheWrite);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushCacheWrite();
    });

    // ChatGPT 会分批 hydrate 历史消息；主动补扫几次，避免首次只抓到部分节点。
    setTimeout(() => scheduleRender(80), 700);
    setTimeout(() => scheduleRender(80), 1800);
    setTimeout(() => scheduleRender(80), 3500);

    setInterval(() => {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        nodeMode = "all";
        internalSourceState = "waiting";
        internalSourceError = "";
        scheduleRender(100);

        requestInternalSnapshot();

        setTimeout(() => {
          requestInternalFull({
            timeout:22000,
            wait:true
          }).then(() => scheduleRender(30));
        }, 1200);

        // DOM fallback 继续补扫
        setTimeout(() => scheduleRender(80), 700);
        setTimeout(() => scheduleRender(80), 1800);
      }
    }, 900);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once:true });
  } else {
    init();
  }
})();
