const byId = (id) => document.getElementById(id);
const escapeHtml = (value = "") =>
  String(value).replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        character
      ],
  );

function render(snapshot) {
  const workflow = snapshot.workflow;
  byId("workflow").innerHTML = workflow
    ? `<div><p class="eyebrow">${escapeHtml(workflow.status)}</p><h2>${escapeHtml(workflow.title)}</h2><p>${escapeHtml(workflow.currentItem || "No active item")} · ${escapeHtml(workflow.stage || "No stage")}</p></div><p>${escapeHtml(workflow.message)}</p>`
    : `<div><p class="eyebrow">Idle</p><h2>No workflow reported</h2><p>Send a workflow.upsert event to begin.</p></div>`;
  for (const key of ["running", "blocked", "completed", "total"])
    byId(key).textContent = snapshot.summary[key];
  byId("updated").textContent =
    `Updated ${new Date(snapshot.updatedAt).toLocaleString()}`;
  byId("agents").innerHTML = snapshot.agents.length
    ? snapshot.agents
        .map(
          (agent) =>
            `<article class="agent panel"><div class="agent-head"><div><p class="eyebrow">${escapeHtml(agent.provider)}</p><h3>${escapeHtml(agent.name)}</h3></div><span class="badge ${escapeHtml(agent.status)}">${escapeHtml(agent.status)}</span></div><dl><dt>Item</dt><dd>${escapeHtml(agent.item || "—")}</dd><dt>Stage</dt><dd>${escapeHtml(agent.stage || "—")}</dd></dl><p>${escapeHtml(agent.message)}</p><small>${new Date(agent.updatedAt).toLocaleString()}</small></article>`,
        )
        .join("")
    : `<p class="empty">No agents have reported yet.</p>`;
}

const stream = new EventSource("/api/events/stream");
stream.onopen = () => {
  byId("connection").textContent = "Live";
  byId("connection").classList.add("live");
};
stream.onmessage = ({ data }) => render(JSON.parse(data));
stream.onerror = () => {
  byId("connection").textContent = "Reconnecting";
  byId("connection").classList.remove("live");
};
fetch("/api/status")
  .then((response) => response.json())
  .then(render);
