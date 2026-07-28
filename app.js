let currentUser = null;
let currentProfile = null;
let records = [];
let auditRows = [];
let profiles = [];

const BOOLEAN_FIELDS = [
  "nda_signed","power_school","previous_boe",
  "data_management_1","data_management_2","account_created"
];

const RECORD_FIELDS = [
  "cert_number","last_name","first_name","position","location","doh","ein","dob",
  "gender","race_ethnicity","employee_id","degree","years_experience",
  "district_email","email","cell_phone","nda_signed","power_school","previous_boe",
  "data_management_1","data_management_2","account_created","note"
];

const LABELS = {
  cert_number:"Certification Number", last_name:"Last Name", first_name:"First Name",
  position:"Position", location:"Location", doh:"Date of Hire", ein:"EIN",
  dob:"Date of Birth", gender:"Gender", race_ethnicity:"Race/Ethnicity",
  employee_id:"Employee ID", degree:"Degree", years_experience:"Years Experience",
  district_email:"District Email", email:"Personal Email", cell_phone:"Cell Phone",
  nda_signed:"NDA Signed", power_school:"PowerSchool", previous_boe:"Previous BOE",
  data_management_1:"Data Management 1", data_management_2:"Data Management 2",
  account_created:"Account Created", note:"Note"
};

const $ = id => document.getElementById(id);

document.addEventListener("DOMContentLoaded", initialize);

async function initialize() {
  bindEvents();
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) await loadApplication(session.user);
}

function bindEvents() {
  $("loginButton").addEventListener("click", login);
  $("loginPassword").addEventListener("keydown", e => { if (e.key === "Enter") login(); });
  $("logoutButton").addEventListener("click", logout);

  document.querySelectorAll(".tab").forEach(btn =>
    btn.addEventListener("click", () => openTab(btn.dataset.tab))
  );

  $("newRecordButton").addEventListener("click", () => { resetForm(); openTab("entryTab"); });
  $("cancelEditButton").addEventListener("click", resetForm);
  $("recordForm").addEventListener("submit", saveRecord);
  $("searchInput").addEventListener("input", renderRecords);
  $("statusFilter").addEventListener("change", renderRecords);
  $("exportButton").addEventListener("click", exportCsv);

  $("refreshAuditButton").addEventListener("click", loadAudit);
  $("auditSearch").addEventListener("input", renderAudit);
  $("auditActionFilter").addEventListener("change", renderAudit);
  $("refreshUsersButton").addEventListener("click", loadUsers);

  $("closeDialogButton").addEventListener("click", () => $("detailsDialog").close());
}

async function login() {
  setMessage("loginMessage", "Signing in...", false);
  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;

  if (!email || !password) return setMessage("loginMessage", "Enter your email and password.");

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) return setMessage("loginMessage", error.message);

  await loadApplication(data.user);
}

async function logout() {
  await supabaseClient.auth.signOut();
  currentUser = null;
  currentProfile = null;
  $("appPage").classList.add("hidden");
  $("loginPage").classList.remove("hidden");
  $("loginPassword").value = "";
}

async function loadApplication(user) {
  currentUser = user;

  const { data: profile, error } = await supabaseClient
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    await supabaseClient.auth.signOut();
    return setMessage("loginMessage", "Your profile is missing. Ask an administrator to run the profile setup SQL.");
  }

  currentProfile = profile;
  $("welcomeText").textContent = `${profile.full_name || profile.email}`;
  $("roleBadge").textContent = profile.role;

  document.querySelectorAll(".admin-only").forEach(el =>
    el.classList.toggle("hidden", profile.role !== "admin")
  );

  $("loginPage").classList.add("hidden");
  $("appPage").classList.remove("hidden");
  setMessage("loginMessage", "");

  await loadRecords();
  if (profile.role === "admin") {
    await Promise.all([loadAudit(), loadUsers()]);
  }
}

function openTab(tabId) {
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.add("hidden"));
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  $(tabId).classList.remove("hidden");
  document.querySelector(`.tab[data-tab="${tabId}"]`)?.classList.add("active");
}

async function loadRecords() {
  const [{ data, error }, { data: profileRows }] = await Promise.all([
    supabaseClient.from("staff_records_with_status").select("*").order("last_name"),
    supabaseClient.from("profiles").select("id,full_name,email")
  ]);

  if (error) {
    alert(`Unable to load records: ${error.message}`);
    return;
  }

  const profileMap = Object.fromEntries((profileRows || []).map(p => [p.id, p.full_name || p.email]));
  records = (data || []).map(r => ({
    ...r,
    updated_by_name: profileMap[r.updated_by] || profileMap[r.created_by] || "Unknown"
  }));

  renderRecords();
  updateSummary();
}

function filteredRecords() {
  const q = $("searchInput").value.trim().toLowerCase();
  const status = $("statusFilter").value;

  return records.filter(r => {
    const haystack = [
      r.cert_number,r.last_name,r.first_name,r.position,r.location,
      r.degree,r.district_email,r.email,r.employee_id
    ].join(" ").toLowerCase();

    const searchMatch = !q || haystack.includes(q);
    const statusMatch =
      status === "all" ||
      (status === "complete" && r.is_complete) ||
      (status === "incomplete" && !r.is_complete);

    return searchMatch && statusMatch;
  });
}

function renderRecords() {
  const rows = filteredRecords();
  $("recordsBody").innerHTML = rows.length ? rows.map(r => `
    <tr>
      <td><span class="status ${r.is_complete ? "complete" : "incomplete"}">${r.is_complete ? "Complete" : `${r.completion_percent}%`}</span></td>
      <td>${esc(r.cert_number)}</td>
      <td>${esc(r.last_name)}</td>
      <td>${esc(r.first_name)}</td>
      <td>${esc(r.position)}</td>
      <td>${esc(r.location)}</td>
      <td>${esc(r.degree)}</td>
      <td>${esc(r.district_email)}</td>
      <td>${formatDateTime(r.updated_at)}</td>
      <td>${esc(r.updated_by_name)}</td>
      <td>
        <div class="action-row">
          <button class="secondary small-button" onclick="viewRecord(${r.id})">View</button>
          ${canEdit(r) ? `<button class="primary small-button" onclick="editRecord(${r.id})">Edit</button>` : ""}
          ${currentProfile.role === "admin" ? `<button class="danger small-button" onclick="deleteRecord(${r.id})">Delete</button>` : ""}
        </div>
      </td>
    </tr>
  `).join("") : `<tr><td colspan="11">No matching records.</td></tr>`;
}

function updateSummary() {
  const complete = records.filter(r => r.is_complete).length;
  $("totalRecords").textContent = records.length;
  $("completeRecords").textContent = complete;
  $("incompleteRecords").textContent = records.length - complete;
  $("completionRate").textContent = records.length ? `${Math.round(complete / records.length * 100)}%` : "0%";
}

function canEdit(record) {
  return currentProfile.role === "admin" || record.created_by === currentUser.id;
}

async function saveRecord(event) {
  event.preventDefault();
  const id = $("recordId").value;
  const payload = {};

  for (const field of RECORD_FIELDS) {
    if (BOOLEAN_FIELDS.includes(field)) {
      const raw = $(field).value;
      payload[field] = raw === "" ? null : raw === "true";
    } else if (field === "years_experience") {
      payload[field] = $(field).value === "" ? null : Number($(field).value);
    } else {
      payload[field] = $(field).value.trim() || null;
    }
  }

  payload.updated_by = currentUser.id;

  let result;
  if (id) {
    result = await supabaseClient.from("staff_records").update(payload).eq("id", id);
  } else {
    payload.created_by = currentUser.id;
    result = await supabaseClient.from("staff_records").insert(payload);
  }

  if (result.error) {
    const duplicate = result.error.code === "23505";
    return setMessage("formMessage", duplicate
      ? "Certification Number or Employee ID already exists."
      : result.error.message
    );
  }

  setMessage("formMessage", id ? "Record updated successfully." : "Record created successfully.", false);
  resetForm(false);
  await loadRecords();
  if (currentProfile.role === "admin") await loadAudit();
  openTab("recordsTab");
}

function resetForm(clearMessage = true) {
  $("recordForm").reset();
  $("recordId").value = "";
  $("formTitle").textContent = "Add Staff Record";
  if (clearMessage) setMessage("formMessage", "");
}

function editRecord(id) {
  const r = records.find(x => x.id === id);
  if (!r || !canEdit(r)) return;

  $("recordId").value = r.id;
  for (const field of RECORD_FIELDS) {
    if (BOOLEAN_FIELDS.includes(field)) {
      $(field).value = r[field] === null ? "" : String(r[field]);
    } else {
      $(field).value = r[field] ?? "";
    }
  }

  $("formTitle").textContent = `Edit ${r.first_name || ""} ${r.last_name || ""}`;
  setMessage("formMessage", "");
  openTab("entryTab");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function viewRecord(id) {
  const r = records.find(x => x.id === id);
  if (!r) return;

  $("detailsContent").innerHTML = `
    <div class="detail-grid">
      ${RECORD_FIELDS.map(field => `
        <div class="detail-item">
          <span>${LABELS[field]}</span>
          <strong>${esc(displayValue(r[field]))}</strong>
        </div>
      `).join("")}
      <div class="detail-item"><span>Completion</span><strong>${r.is_complete ? "Complete" : `${r.completion_percent}% Complete`}</strong></div>
      <div class="detail-item"><span>Created</span><strong>${formatDateTime(r.created_at)}</strong></div>
      <div class="detail-item"><span>Last Updated</span><strong>${formatDateTime(r.updated_at)}</strong></div>
      <div class="detail-item"><span>Updated By</span><strong>${esc(r.updated_by_name)}</strong></div>
    </div>
  `;
  $("detailsDialog").showModal();
}

async function deleteRecord(id) {
  const r = records.find(x => x.id === id);
  if (!r || !confirm(`Delete ${r.first_name} ${r.last_name}? This will remain visible in the audit log.`)) return;

  const { error } = await supabaseClient.from("staff_records").delete().eq("id", id);
  if (error) return alert(error.message);

  await loadRecords();
  await loadAudit();
}

async function loadAudit() {
  if (currentProfile?.role !== "admin") return;

  const [{ data, error }, { data: profileRows }] = await Promise.all([
    supabaseClient.from("staff_record_audit").select("*").order("changed_at", { ascending: false }).limit(2000),
    supabaseClient.from("profiles").select("id,full_name,email")
  ]);

  if (error) return alert(`Audit load failed: ${error.message}`);

  const profileMap = Object.fromEntries((profileRows || []).map(p => [p.id, p.full_name || p.email]));
  auditRows = (data || []).map(a => ({ ...a, changed_by_name: profileMap[a.changed_by] || "Unknown" }));
  renderAudit();
}

function renderAudit() {
  const q = $("auditSearch").value.trim().toLowerCase();
  const action = $("auditActionFilter").value;

  const rows = auditRows.filter(a => {
    const snapshot = a.new_data || a.old_data || {};
    const text = `${snapshot.first_name || ""} ${snapshot.last_name || ""} ${a.action} ${a.changed_by_name}`.toLowerCase();
    return (!q || text.includes(q)) && (action === "all" || a.action === action);
  });

  $("auditBody").innerHTML = rows.length ? rows.map(a => {
    const snap = a.new_data || a.old_data || {};
    const changes = changedFields(a);
    return `
      <tr>
        <td>${formatDateTime(a.changed_at)}</td>
        <td><span class="status ${a.action === "DELETE" ? "incomplete" : "complete"}">${esc(a.action)}</span></td>
        <td>${esc(`${snap.first_name || ""} ${snap.last_name || ""}`.trim() || `Record ${a.staff_record_id}`)}</td>
        <td>${esc(a.changed_by_name)}</td>
        <td>${esc(changes.join(", ") || "New record")}</td>
        <td><button class="secondary small-button" onclick="viewAudit(${a.id})">View</button></td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="6">No audit entries found.</td></tr>`;
}

function changedFields(audit) {
  if (audit.action !== "UPDATE" || !audit.old_data || !audit.new_data) return [];
  return RECORD_FIELDS.filter(f => JSON.stringify(audit.old_data[f]) !== JSON.stringify(audit.new_data[f]))
    .map(f => LABELS[f]);
}

function viewAudit(id) {
  const a = auditRows.find(x => x.id === id);
  if (!a) return;

  const oldData = a.old_data || {};
  const newData = a.new_data || {};
  const fields = a.action === "UPDATE" ? changedFields(a).map(label =>
    Object.keys(LABELS).find(key => LABELS[key] === label)
  ) : RECORD_FIELDS;

  $("detailsContent").innerHTML = `
    <p><strong>${esc(a.action)}</strong> by ${esc(a.changed_by_name)} on ${formatDateTime(a.changed_at)}</p>
    <div class="detail-grid">
      ${fields.map(field => `
        <div class="detail-item">
          <span>${LABELS[field]}</span>
          ${a.action === "UPDATE"
            ? `<div><strong>Before:</strong> ${esc(displayValue(oldData[field]))}</div>
               <div><strong>After:</strong> ${esc(displayValue(newData[field]))}</div>`
            : `<strong>${esc(displayValue((a.new_data || a.old_data || {})[field]))}</strong>`
          }
        </div>
      `).join("")}
    </div>
  `;
  $("detailsDialog").showModal();
}

async function loadUsers() {
  if (currentProfile?.role !== "admin") return;
  const { data, error } = await supabaseClient.from("profiles").select("*").order("full_name");
  if (error) return alert(error.message);
  profiles = data || [];
  renderUsers();
}

function renderUsers() {
  $("usersBody").innerHTML = profiles.map(p => `
    <tr>
      <td>${esc(p.full_name)}</td>
      <td>${esc(p.email)}</td>
      <td>
        <select id="role-${p.id}">
          <option value="user" ${p.role === "user" ? "selected" : ""}>User</option>
          <option value="admin" ${p.role === "admin" ? "selected" : ""}>Administrator</option>
        </select>
      </td>
      <td><button class="primary small-button" onclick="saveRole('${p.id}')">Save Role</button></td>
    </tr>
  `).join("");
}

async function saveRole(id) {
  const role = $(`role-${id}`).value;
  const { error } = await supabaseClient.from("profiles").update({ role }).eq("id", id);
  if (error) return alert(error.message);
  await loadUsers();
  alert("Role updated.");
}

function exportCsv() {
  const rows = filteredRecords();
  const headers = [
    "Complete","Completion Percent",...RECORD_FIELDS.map(f => LABELS[f]),
    "Created At","Updated At","Updated By"
  ];

  const data = rows.map(r => [
    r.is_complete ? "Yes" : "No", r.completion_percent,
    ...RECORD_FIELDS.map(f => displayValue(r[f])),
    r.created_at, r.updated_at, r.updated_by_name
  ]);

  const csv = [headers, ...data]
    .map(row => row.map(csvCell).join(","))
    .join("\r\n");

  downloadBlob(csv, `staff-records-${new Date().toISOString().slice(0,10)}.csv`, "text/csv;charset=utf-8;");
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"','""')}"`;
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function displayValue(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return value ?? "";
}

function formatDateTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString();
}

function setMessage(id, text, isError = true) {
  const el = $(id);
  el.textContent = text;
  el.style.color = isError ? "var(--red)" : "var(--green)";
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
