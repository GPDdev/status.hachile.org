"use strict";

const byId = id => document.getElementById(id);
const catalog = [...document.querySelectorAll(".branch-sites .site-link")].map(link => ({
  name: link.querySelector(".site-name").firstChild.textContent.trim(),
  url: link.href
}));
const formatTime = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});
const statusLabels = { up: "可访问", down: "异常", unknown: "待检查" };
const statusRank = { down: 0, unknown: 1, up: 2 };
const staleAfterMs = 60 * 60 * 1000;
let snapshot = null;
let rows = [];
let fetching = false;
let renderedSnapshot;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function validDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function timeElement(value) {
  if (!validDate(value)) return document.createTextNode("暂无时间");
  const node = element("time", formatTime.format(new Date(value)));
  node.dateTime = value;
  return node;
}

function signal(text, tone) {
  const node = element("span", text, "site-signal");
  node.dataset.tone = tone;
  return node;
}

function renderRows() {
  const filter = byId("site-filter").value;
  const visible = filter === "all" ? rows : rows.filter(site => site.status === filter);
  const body = byId("check-list");
  body.replaceChildren();
  for (const site of visible) {
    const row = body.insertRow();
    const siteLink = element("a", "", "check-site");
    siteLink.href = site.url;
    siteLink.append(element("strong", site.name), element("span", new URL(site.url).hostname, "check-domain"));
    row.insertCell().append(siteLink);
    const result = row.insertCell();
    result.append(signal(statusLabels[site.status], site.status));
    if (site.status === "down") {
      const reason = site.detail || (site.httpStatus ? `HTTP ${site.httpStatus}` : "请求失败");
      result.append(element("small", reason, "signal-detail"));
    }
    row.insertCell().append(timeElement(site.checkedAt));
  }
  if (!visible.length) {
    const cell = body.insertRow().insertCell();
    cell.colSpan = 3;
    cell.textContent = filter === "down" ? "已收到的检查结果中没有异常站点。" : "没有符合条件的站点。";
  }
}

function renderSummary(error) {
  const counts = { up: 0, down: 0, unknown: 0 };
  for (const site of rows) counts[site.status]++;
  for (const [key, count] of Object.entries(counts)) byId(key + "-count").textContent = count;
  const hasSample = validDate(snapshot?.checkedAt);
  const stale = hasSample && Date.now() - Date.parse(snapshot.checkedAt) > staleAfterMs;
  let text = "等待首次检查";
  let tone = "unknown";
  if (!hasSample && error) {
    text = "暂时无法读取检查数据";
  } else if (hasSample && stale) {
    text = "检查数据已过期";
    tone = "stale";
  } else if (counts.down) {
    text = `最近检查发现 ${counts.down} 个站点异常`;
    tone = "down";
  } else if (hasSample && counts.unknown) {
    text = `有 ${counts.unknown} 个站点待检查`;
  } else if (hasSample && counts.up) {
    text = "最近检查全部可访问";
    tone = "up";
  }
  const headline = byId("snapshot-state");
  headline.dataset.tone = tone;
  if (headline.textContent !== text) headline.textContent = text;
  byId("latest-check").replaceChildren(timeElement(snapshot?.checkedAt));
  const note = byId("snapshot-note");
  let explanation = "";
  if (stale) explanation = "超过一小时未收到新记录，以下为上次检查结果。";
  else if (error && hasSample) explanation = "暂时无法刷新，以下为最近成功读取的结果。";
  else if (error) explanation = "页面稍后会自动重试。";
  note.textContent = explanation;
  note.hidden = !explanation;
}

function incidentList(incidents) {
  const list = element("ul", "", "incident-list");
  for (const incident of incidents) {
    const item = element("li", "", "incident-item");
    const heading = element("div", "", "incident-head");
    heading.append(element("strong", incident.name, "incident-name"));
    const resolved = validDate(incident.resolvedAt);
    heading.append(signal(resolved ? "已恢复" : "尚无恢复记录", resolved ? "up" : "down"));
    const times = element("p", "", "incident-times");
    const started = element("span", "首次发现");
    started.append(timeElement(incident.startedAt));
    times.append(started);
    if (resolved) {
      const ended = element("span", "恢复于");
      ended.append(timeElement(incident.resolvedAt));
      times.append(ended);
    }
    item.append(heading, times);
    if (incident.detail) item.append(element("p", incident.detail, "incident-detail"));
    list.append(item);
  }
  return list;
}

function renderIncidents(error) {
  const log = byId("incident-log");
  const wasOpen = log.querySelector("details")?.open ?? false;
  const items = [...(snapshot?.incidents || [])].sort((a, b) =>
    Date.parse(b.resolvedAt || b.startedAt) - Date.parse(a.resolvedAt || a.startedAt)
  );
  const open = items.filter(item => !item.resolvedAt);
  const closed = items.filter(item => item.resolvedAt);
  const content = document.createDocumentFragment();
  if (open.length) content.append(incidentList(open));
  else {
    let message = "历史检查中没有未恢复的故障。";
    if (!snapshot?.checkedAt) message = error ? "暂时无法读取故障记录。" : "首次检查完成后会在这里记录故障。";
    else if (!items.length) message = "监测开始以来尚无故障记录。";
    content.append(element("p", message, "data-note"));
  }
  if (closed.length) {
    const archive = element("details", "", "incident-archive");
    archive.open = wasOpen;
    archive.append(element("summary", `已恢复的故障（${closed.length}）`), incidentList(closed));
    content.append(archive);
  }
  log.replaceChildren(content);
}

function render(error = false) {
  if (renderedSnapshot === snapshot) {
    renderSummary(error);
    if (!snapshot) renderIncidents(error);
    return;
  }
  const samples = new Map((snapshot?.sites || []).map(site => [site.url, site]));
  rows = catalog.map(site => {
    const sample = samples.get(site.url);
    if (!sample || !validDate(sample.checkedAt) || !["up", "down"].includes(sample.status)) {
      return { ...site, status: "unknown" };
    }
    return { ...sample, ...site };
  }).sort((a, b) => statusRank[a.status] - statusRank[b.status]);
  renderSummary(error);
  renderRows();
  renderIncidents(error);
  renderedSnapshot = snapshot;
}

async function refresh() {
  if (fetching) return;
  fetching = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch("./data/status.json", { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error("Snapshot unavailable");
    const next = await response.json();
    if (next?.schemaVersion !== 1 || !(next.checkedAt === null || validDate(next.checkedAt))
      || !Array.isArray(next.sites) || !next.sites.every(site => site && typeof site.url === "string")
      || !Array.isArray(next.incidents) || !next.incidents.every(incident =>
        incident && typeof incident.name === "string" && validDate(incident.startedAt)
        && (incident.resolvedAt === null || validDate(incident.resolvedAt))
      )) throw new Error("Invalid snapshot");
    if (next.checkedAt !== snapshot?.checkedAt) snapshot = next;
    render();
  } catch {
    render(true);
  } finally {
    clearTimeout(timeout);
    fetching = false;
  }
}

byId("site-filter").closest("label").hidden = false;
byId("site-filter").addEventListener("change", renderRows);
render();
refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
