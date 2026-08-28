(() => {
  "use strict";

  if (window.__CWV25_INTERNAL_DATA_BRIDGE__) return;
  window.__CWV25_INTERNAL_DATA_BRIDGE__ = true;

  const nativeFetch = window.fetch.bind(window);

  // 认证相关请求模板只保存在页面内存中，不跨层、不落盘。
  const requestTemplates = new Map();
  const lastPayloads = new Map();
  const activeFullFetches = new Map();

  function post(type, payload={}) {
    window.postMessage({
      __cwv25: true,
      channel: "page-to-extension",
      type,
      ...payload
    }, "*");
  }

  function currentConversationId() {
    const m = location.pathname.match(/\/c\/([^/?#]+)/);
    return m ? m[1] : "";
  }

  function parseConversationIdFromUrl(url) {
    try {
      const u = new URL(url, location.href);

      let m = u.pathname.match(/\/backend-api\/conversations\/([^/?#]+)/);
      if (m) return decodeURIComponent(m[1]);

      m = u.pathname.match(/\/backend-api\/conversation\/([^/?#]+)/);
      if (m && !/^(init|gen_title|limit|prepare|textdocs)$/i.test(m[1])) {
        return decodeURIComponent(m[1]);
      }
    } catch {}
    return "";
  }

  function isConversationDetailUrl(url) {
    try {
      const u = new URL(url, location.href);
      return (
        /\/backend-api\/conversations\/[^/?#]+/.test(u.pathname) ||
        /\/backend-api\/conversation\/[^/?#]+/.test(u.pathname)
      );
    } catch {
      return false;
    }
  }

  function safeHeadersFrom(headersLike) {
    const result = {};

    try {
      if (!headersLike) return result;

      const headers =
        headersLike instanceof Headers
          ? headersLike
          : new Headers(headersLike);

      headers.forEach((value, key) => {
        const lower = key.toLowerCase();

        if (
          lower === "content-length" ||
          lower === "host" ||
          lower === "origin" ||
          lower === "referer"
        ) return;

        result[key] = value;
      });
    } catch {}

    return result;
  }

  function getFetchMeta(input, init) {
    /*
      V2.5.1：这里只读请求元信息。
      不重新构造 Request，不读取 FormData / Blob / File / stream。
    */
    let url = "";
    let method = "GET";
    let credentials = "same-origin";
    let headersLike = null;

    try {
      if (typeof input === "string" || input instanceof URL) {
        url = String(input);
        method = String(init?.method || "GET").toUpperCase();
        credentials = init?.credentials || "same-origin";
        headersLike = init?.headers || null;
      } else if (input && typeof input === "object") {
        url = input.url || "";
        method = String(init?.method || input.method || "GET").toUpperCase();
        credentials =
          init?.credentials ||
          input.credentials ||
          "same-origin";

        headersLike =
          init?.headers !== undefined
            ? init.headers
            : input.headers;
      }
    } catch {}

    return {
      url,
      method,
      credentials,
      headers: safeHeadersFrom(headersLike)
    };
  }

  function rememberTemplate(meta) {
    if (!meta || meta.method !== "GET") return;

    const id = parseConversationIdFromUrl(meta.url);
    if (!id) return;

    requestTemplates.set(id, {
      headers: meta.headers || {},
      credentials: meta.credentials || "include"
    });
  }

  function attachmentInfo(message) {
    const metadata = message?.metadata || {};
    const out = [];

    for (const list of [
      metadata.attachments,
      metadata.files,
      metadata.uploaded_files
    ]) {
      if (!Array.isArray(list)) continue;

      for (const item of list) {
        if (!item || typeof item !== "object") continue;

        out.push({
          id: item.id || item.file_id || item.asset_pointer || "",
          name: item.name || item.file_name || item.filename || "",
          mime: item.mime_type || item.content_type || ""
        });
      }
    }

    return out;
  }

  function contentToText(message) {
    const content = message?.content || {};
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const texts = [];
    let visualCount = 0;

    for (const part of parts) {
      if (typeof part === "string") {
        if (part.trim()) texts.push(part.trim());
        continue;
      }

      if (!part || typeof part !== "object") continue;

      if (typeof part.text === "string" && part.text.trim()) {
        texts.push(part.text.trim());
        continue;
      }

      if (typeof part.content === "string" && part.content.trim()) {
        texts.push(part.content.trim());
        continue;
      }

      if (
        part.asset_pointer ||
        part.image_url ||
        part.content_type === "image_asset_pointer" ||
        part.type === "image"
      ) {
        visualCount++;
      }
    }

    if (!texts.length && typeof content.text === "string" && content.text.trim()) {
      texts.push(content.text.trim());
    }

    const attachments = attachmentInfo(message);

    if (!texts.length) {
      if (attachments.length) return `[附件 ${attachments.length} 个]`;
      if (visualCount) return visualCount > 1 ? `[图片 ${visualCount} 张]` : "[图片]";
      return "[用户消息]";
    }

    return texts.join("\n").replace(/\s+\n/g, "\n").trim();
  }

  function sanitizeMessage(message, order) {
    if (!message || message.author?.role !== "user") return null;

    const attachments = attachmentInfo(message);

    return {
      id: message.id || message.message_id || `user-${order}`,
      text: contentToText(message),
      createTime: Number(message.create_time || 0) || 0,
      updateTime: Number(message.update_time || 0) || 0,
      order,
      attachments,
      hasAttachments: attachments.length > 0
    };
  }

  function dedupeMessages(messages) {
    const map = new Map();

    messages.forEach((m, i) => {
      if (!m) return;
      const id = m.id || `fallback:${m.createTime || 0}:${m.text || ""}:${i}`;
      if (!map.has(id)) map.set(id, m);
    });

    return [...map.values()];
  }

  function sanitizeFlatConversation(data, conversationId, {
    complete=false,
    pageCount=1
  }={}) {
    if (!data || !Array.isArray(data.messages)) return null;

    const userMessages = data.messages
      .map((m, i) => sanitizeMessage(m, i))
      .filter(Boolean);

    return {
      conversationId,
      title: typeof data.title === "string" ? data.title : "",
      format: "messages",
      source: "internal-api",
      complete,
      pageCount,
      currentNode: data.current_node || "",
      messages: dedupeMessages(userMessages),
      capturedAt: Date.now()
    };
  }

  function mappingCurrentPath(data) {
    const mapping = data?.mapping;
    if (!mapping || typeof mapping !== "object") return [];

    const currentNode = data.current_node;

    if (currentNode && mapping[currentNode]) {
      const chain = [];
      const seen = new Set();
      let cursor = currentNode;

      while (cursor && mapping[cursor] && !seen.has(cursor)) {
        seen.add(cursor);
        chain.push(mapping[cursor]);
        cursor = mapping[cursor]?.parent || null;
      }

      return chain.reverse();
    }

    return Object.values(mapping).sort((a, b) => {
      const at = Number(a?.message?.create_time || 0);
      const bt = Number(b?.message?.create_time || 0);
      return at - bt;
    });
  }

  function sanitizeMappingConversation(data, conversationId) {
    if (!data?.mapping || typeof data.mapping !== "object") return null;

    const nodes = mappingCurrentPath(data);
    const userMessages = nodes
      .map((node, i) => sanitizeMessage(node?.message, i))
      .filter(Boolean);

    return {
      conversationId,
      title: typeof data.title === "string" ? data.title : "",
      format: "mapping",
      source: "internal-api",
      complete: true,
      pageCount: 1,
      currentNode: data.current_node || "",
      messages: dedupeMessages(userMessages),
      capturedAt: Date.now()
    };
  }

  function sanitizeConversation(data, conversationId, options={}) {
    return (
      sanitizeFlatConversation(data, conversationId, options) ||
      sanitizeMappingConversation(data, conversationId)
    );
  }

  function rememberAndPost(payload, {
    requestId="",
    passive=false
  }={}) {
    if (!payload?.conversationId || !Array.isArray(payload.messages)) return;

    lastPayloads.set(payload.conversationId, payload);

    // 只传净化后的用户消息索引。
    post("CWV25_CONVERSATION_DATA", {
      requestId,
      passive,
      payload
    });
  }

  async function inspectResponse(requestUrl, response) {
    if (!response || !response.ok || !isConversationDetailUrl(requestUrl)) return;

    const id = parseConversationIdFromUrl(requestUrl);
    if (!id) return;

    try {
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("json")) return;

      const data = await response.clone().json();
      const pageInfo = data?.page_info || {};

      const complete =
        Array.isArray(data?.messages)
          ? !pageInfo.has_previous_page
          : !!data?.mapping;

      const payload = sanitizeConversation(data, id, {
        complete,
        pageCount: 1
      });

      if (payload) rememberAndPost(payload, { passive:true });
    } catch {}
  }

  // ---------- passive fetch ----------
  window.fetch = async function(input, init) {
    /*
      原 input/init 完全透传。
      不复制 Request，不触碰上传 body。
    */
    const meta = getFetchMeta(input, init);

    if (
      meta.method === "GET" &&
      meta.url &&
      isConversationDetailUrl(meta.url)
    ) {
      rememberTemplate(meta);
    }

    const response = await nativeFetch(input, init);

    try {
      if (
        meta.method === "GET" &&
        meta.url &&
        isConversationDetailUrl(meta.url)
      ) {
        inspectResponse(meta.url, response).catch(() => {});
      }
    } catch {}

    return response;
  };

  // ---------- passive XHR ----------
  try {
    const XHR = window.XMLHttpRequest;
    const nativeOpen = XHR.prototype.open;
    const nativeSend = XHR.prototype.send;

    XHR.prototype.open = function(method, url, ...rest) {
      this.__cwv25Method = String(method || "GET").toUpperCase();
      this.__cwv25Url = new URL(url, location.href).href;
      return nativeOpen.call(this, method, url, ...rest);
    };

    XHR.prototype.send = function(...args) {
      if (
        this.__cwv25Method === "GET" &&
        isConversationDetailUrl(this.__cwv25Url)
      ) {
        this.addEventListener("load", () => {
          try {
            if (this.status < 200 || this.status >= 300) return;

            let data = null;

            if (this.responseType === "json") {
              data = this.response;
            } else if (!this.responseType || this.responseType === "text") {
              data = JSON.parse(this.responseText);
            }

            const id = parseConversationIdFromUrl(this.__cwv25Url);
            const pageInfo = data?.page_info || {};

            const payload = sanitizeConversation(data, id, {
              complete: Array.isArray(data?.messages)
                ? !pageInfo.has_previous_page
                : !!data?.mapping,
              pageCount: 1
            });

            if (payload) rememberAndPost(payload, { passive:true });
          } catch {}
        }, { once:true });
      }

      return nativeSend.apply(this, args);
    };
  } catch {}

  // ---------- direct pagination ----------
  async function fetchWithTemplate(url, conversationId) {
    const template = requestTemplates.get(conversationId);

    return nativeFetch(url, {
      method: "GET",
      credentials: template?.credentials || "include",
      cache: "no-store",
      headers: template?.headers || {}
    });
  }

  async function fetchNewConversationAll(conversationId, requestId) {
    let before = "";
    let pageCount = 0;
    let title = "";
    let currentNode = "";
    const combined = [];
    const seenCursors = new Set();

    while (pageCount < 250) {
      const params = new URLSearchParams();
      params.set("include_has_versions", "true");
      params.set("num_turns", "100");
      if (before) params.set("before", before);

      const url =
        `/backend-api/conversations/${encodeURIComponent(conversationId)}?${params.toString()}`;

      post("CWV25_INTERNAL_STATUS", {
        requestId,
        conversationId,
        state: "loading",
        page: pageCount + 1
      });

      const response = await fetchWithTemplate(url, conversationId);

      if (!response.ok) {
        throw new Error(`new-endpoint HTTP ${response.status}`);
      }

      const data = await response.json();

      if (!Array.isArray(data?.messages)) {
        throw new Error("new-endpoint invalid messages payload");
      }

      pageCount++;
      title = title || data.title || "";
      currentNode = data.current_node || currentNode || "";

      // before=start_cursor 获取的是更早的一页，因此 prepend。
      combined.unshift(...data.messages);

      const info = data.page_info || {};
      const nextBefore = info.start_cursor || "";

      if (!info.has_previous_page || !nextBefore) break;
      if (seenCursors.has(nextBefore)) break;

      seenCursors.add(nextBefore);
      before = nextBefore;
    }

    const payload = sanitizeFlatConversation({
      title,
      current_node: currentNode,
      messages: combined
    }, conversationId, {
      complete: true,
      pageCount
    });

    if (!payload) throw new Error("failed to sanitize new endpoint payload");
    return payload;
  }

  async function fetchOldConversation(conversationId) {
    const response = await fetchWithTemplate(
      `/backend-api/conversation/${encodeURIComponent(conversationId)}`,
      conversationId
    );

    if (!response.ok) {
      throw new Error(`old-endpoint HTTP ${response.status}`);
    }

    const data = await response.json();
    const payload = sanitizeMappingConversation(data, conversationId);

    if (!payload) throw new Error("old-endpoint invalid mapping payload");
    return payload;
  }

  async function fetchFullConversation(conversationId, requestId) {
    let firstError = null;

    try {
      return await fetchNewConversationAll(conversationId, requestId);
    } catch (e) {
      firstError = e;
    }

    try {
      return await fetchOldConversation(conversationId);
    } catch (e) {
      throw new Error(
        `${firstError?.message || "new endpoint failed"}; ${e?.message || "old endpoint failed"}`
      );
    }
  }

  async function runFullFetch(conversationId, requestId) {
    let promise = activeFullFetches.get(conversationId);

    if (!promise) {
      promise = fetchFullConversation(conversationId, requestId)
        .finally(() => activeFullFetches.delete(conversationId));

      activeFullFetches.set(conversationId, promise);
    }

    try {
      const payload = await promise;

      rememberAndPost(payload, {
        requestId,
        passive:false
      });

      post("CWV25_INTERNAL_STATUS", {
        requestId,
        conversationId,
        state: "ready",
        count: payload.messages.length,
        complete: !!payload.complete,
        format: payload.format,
        pageCount: payload.pageCount || 1
      });
    } catch (e) {
      post("CWV25_INTERNAL_STATUS", {
        requestId,
        conversationId,
        state: "error",
        error: String(e?.message || e || "internal fetch failed")
      });
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;

    const data = event.data;

    if (
      !data ||
      data.__cwv25 !== true ||
      data.channel !== "extension-to-page"
    ) return;

    const conversationId =
      data.conversationId ||
      currentConversationId();

    if (!conversationId) return;

    if (data.type === "CWV25_REQUEST_SNAPSHOT") {
      const cached = lastPayloads.get(conversationId);

      if (cached) {
        rememberAndPost(cached, {
          requestId: data.requestId || "",
          passive:true
        });
      } else {
        post("CWV25_INTERNAL_STATUS", {
          requestId: data.requestId || "",
          conversationId,
          state: "waiting"
        });
      }

      return;
    }

    if (data.type === "CWV25_REQUEST_FULL_CONVERSATION") {
      runFullFetch(conversationId, data.requestId || "");
    }
  });

  post("CWV25_BRIDGE_READY", {
    conversationId: currentConversationId()
  });
})();
