let currentUser = null;
let currentProfile = null;
let records = [];
let auditRows = [];
let profiles = [];
let workspaceStatus = "all";
let pendingDuplicateId = null;
let saveAfterAction = "records";
let importPreviewRows = [];
let availableLocations = [];
let selectedLocations = [];

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
  cert_number:"CERT/NON-CERT", last_name:"Last Name", first_name:"First Name",
  position:"Position", location:"Location", doh:"Date of Hire", ein:"EIN",
  dob:"Date of Birth", gender:"Gender", race_ethnicity:"Race/Ethnicity",
  employee_id:"Employee ID", degree:"Degree", years_experience:"Years Experience",
  district_email:"District Email", email:"Personal Email", cell_phone:"Cell Phone",
  nda_signed:"NDA Signed", power_school:"PowerSchool", previous_boe:"Previous BOE",
  data_management_1:"Data Mgmnt EDS", data_management_2:"Data Mgmt PowerSchool",
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

  $("newRecordButton").addEventListener("click", () => { resetForm(); openTab("entryTab"); renderWorkspaceEmployees(); });
  $("workspaceNewButton").addEventListener("click", () => { resetForm(); renderWorkspaceEmployees(); });
  $("clearFormButton").addEventListener("click", resetForm);
  $("cancelEditButton").addEventListener("click", () => { resetForm(); openTab("recordsTab"); });
  $("recordForm").addEventListener("submit", saveRecord);
  $("saveNewButton").addEventListener("click", () => {
    saveAfterAction = "new";
    $("recordForm").requestSubmit();
  });
  $("duplicateRecordButton").addEventListener("click", duplicateCurrentRecord);
  $("deleteEditorButton").addEventListener("click", deleteCurrentEditorRecord);
  $("workspaceSearch").addEventListener("input", renderWorkspaceEmployees);
  document.querySelectorAll(".browser-filter").forEach(button => {
    button.addEventListener("click", () => {
      workspaceStatus = button.dataset.workspaceStatus;
      document.querySelectorAll(".browser-filter").forEach(x => x.classList.remove("active"));
      button.classList.add("active");
      renderWorkspaceEmployees();
    });
  });
  $("openDuplicateButton").addEventListener("click", () => {
    if (pendingDuplicateId) editRecord(pendingDuplicateId);
  });
  $("refreshRecordHistoryButton").addEventListener("click", renderCurrentRecordHistory);
  $("recordForm").addEventListener("input", handleLiveFormChange);
  $("recordForm").addEventListener("change", handleLiveFormChange);
  $("searchInput").addEventListener("input", renderRecords);
  $("statusFilter").addEventListener("change", renderRecords);
  $("exportButton").addEventListener("click", exportCsv);
  $("showIncompleteButton").addEventListener("click", () => {
    $("statusFilter").value = "incomplete";
    renderRecords();
  });
  $("printIncompleteButton").addEventListener("click", printIncompleteChecklist);

  $("refreshAuditButton").addEventListener("click", loadAudit);
  $("auditSearch").addEventListener("input", renderAudit);
  $("auditActionFilter").addEventListener("change", renderAudit);
  $("refreshUsersButton").addEventListener("click", loadUsers);
  $("previewImportButton").addEventListener("click", previewImportFile);
  $("runImportButton").addEventListener("click", runImport);
  $("downloadTemplateButton").addEventListener("click", downloadImportTemplate);
  $("importFile").addEventListener("change", clearImportPreview);
  $("locationInput").addEventListener("input", renderLocationSuggestions);
  $("locationInput").addEventListener("keydown", handleLocationKeydown);
  document.addEventListener("click", e => {
    if (!$("locationSelector").contains(e.target)) $("locationSuggestions").classList.add("hidden");
  });

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

  await loadLocations();
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
  if (tabId === "entryTab") {
    renderWorkspaceEmployees();
    updateLiveCompletion();
  }
}


async function loadLocations() {
  const { data, error } = await supabaseClient.from("locations").select("id,location_name").eq("active", true).order("location_name");
  if (error) {
    console.warn("Locations could not be loaded:", error.message);
    availableLocations = [];
    return;
  }
  availableLocations = data || [];
}

function parseLocations(value) {
  return [...new Set(String(value || "").split(/[;,|]/).map(x => x.trim()).filter(Boolean))];
}

function setSelectedLocations(values) {
  selectedLocations = [...new Set((values || []).map(x => String(x).trim()).filter(Boolean))];
  $("location").value = selectedLocations.join("; ");
  renderLocationTags();
}

function addLocation(name) {
  const clean = String(name || "").trim();
  if (!clean || selectedLocations.some(x => x.toLowerCase() === clean.toLowerCase())) return;
  selectedLocations.push(clean);
  $("location").value = selectedLocations.join("; ");
  $("locationInput").value = "";
  renderLocationTags();
  renderLocationSuggestions();
}

function removeLocation(index) {
  selectedLocations.splice(index, 1);
  $("location").value = selectedLocations.join("; ");
  renderLocationTags();
}

function renderLocationTags() {
  $("locationTags").innerHTML = selectedLocations.map((name, index) => `
    <span class="location-tag">${esc(name)}<button type="button" aria-label="Remove ${esc(name)}" onclick="removeLocation(${index})">×</button></span>
  `).join("");
}

function renderLocationSuggestions() {
  const q = $("locationInput").value.trim().toLowerCase();
  const choices = availableLocations
    .map(x => x.location_name)
    .filter(name => !selectedLocations.some(x => x.toLowerCase() === name.toLowerCase()))
    .filter(name => !q || name.toLowerCase().includes(q))
    .slice(0, 12);
  const box = $("locationSuggestions");
  box.innerHTML = choices.map(name => `<div class="tag-suggestion" onclick='addLocation(${JSON.stringify(name)})'>${esc(name)}</div>`).join("");
  box.classList.toggle("hidden", choices.length === 0);
}

function handleLocationKeydown(event) {
  if (["Enter", ",", ";"].includes(event.key)) {
    event.preventDefault();
    addLocation($("locationInput").value.replace(/[;,]+$/, ""));
  } else if (event.key === "Backspace" && !$("locationInput").value && selectedLocations.length) {
    removeLocation(selectedLocations.length - 1);
  }
}

async function syncStaffLocations(staffId, locationNames) {
  const names = [...new Set((locationNames || []).map(x => x.trim()).filter(Boolean))];
  const { error: deleteError } = await supabaseClient.from("staff_locations").delete().eq("staff_id", staffId);
  if (deleteError) throw deleteError;
  if (!names.length) return;

  for (const locationName of names) {
    let location = availableLocations.find(x => x.location_name.toLowerCase() === locationName.toLowerCase());
    if (!location) {
      const { data, error } = await supabaseClient.from("locations")
        .upsert({ location_name: locationName, active: true }, { onConflict: "location_name" })
        .select("id,location_name").single();
      if (error) throw error;
      location = data;
      availableLocations.push(location);
    }
    const { error } = await supabaseClient.from("staff_locations").insert({ staff_id: staffId, location_id: location.id });
    if (error && error.code !== "23505") throw error;
  }
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
    created_by_name: profileMap[r.created_by] || "Unknown",
    updated_by_name: profileMap[r.updated_by] || profileMap[r.created_by] || "Unknown"
  }));

  renderRecords();
  updateSummary();
  renderWorkspaceEmployees();
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
  $("recordsBody").innerHTML = rows.length ? rows.map(r => {
    const missing = getMissingFields(r);
    const critical = hasCriticalMissing(r);
    const rowClass = r.is_complete ? "complete-row" : (critical ? "critical-row" : "incomplete-row");

    return `
    <tr class="${rowClass}">
      <td class="sticky-left">
        <div class="action-row">
          <button class="secondary small-button" onclick="viewRecord(${r.id})">View</button>
          ${canEdit(r) ? `<button class="primary small-button" onclick="editRecord(${r.id})">Edit</button>` : ""}
          ${currentProfile.role === "admin" ? `<button class="danger small-button" onclick="deleteRecord(${r.id})">Delete</button>` : ""}
        </div>
      </td>
      <td><span class="status ${r.is_complete ? "complete" : "incomplete"}">${r.is_complete ? "Complete" : "Incomplete"}</span></td>
      <td class="missing-cell">${r.is_complete ? "—" : esc(missing.join(", "))}</td>
      <td>${esc(r.cert_number)}</td>
      <td>${esc(r.last_name)}</td>
      <td>${esc(r.first_name)}</td>
      <td>${esc(r.position)}</td>
      <td class="wide-cell">${esc(r.location)}</td>
      <td>${formatDateOnly(r.doh)}</td>
      <td>${esc(r.ein)}</td>
      <td>${formatDateOnly(r.dob)}</td>
      <td>${esc(r.gender)}</td>
      <td class="wide-cell">${esc(r.race_ethnicity)}</td>
      <td>${esc(r.employee_id)}</td>
      <td>${esc(r.degree)}</td>
      <td>${esc(r.years_experience)}</td>
      <td>${esc(r.district_email)}</td>
      <td>${esc(r.email)}</td>
      <td>${esc(r.cell_phone)}</td>
      <td>${yesNo(r.nda_signed)}</td>
      <td>${yesNo(r.power_school)}</td>
      <td>${yesNo(r.previous_boe)}</td>
      <td>${yesNo(r.data_management_1)}</td>
      <td>${yesNo(r.data_management_2)}</td>
      <td>${yesNo(r.account_created)}</td>
      <td class="note-cell" title="${esc(r.note)}">${esc(r.note)}</td>
      <td>${formatDateTime(r.created_at)}</td>
      <td>${formatDateTime(r.updated_at)}</td>
      <td>${esc(r.updated_by_name)}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="29">No matching records.</td></tr>`;
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

  if (!$("first_name").value.trim() || !$("last_name").value.trim() || !$("employee_id").value.trim()) {
    saveAfterAction = "records";
    return setMessage("formMessage", "First Name, Last Name, and Employee ID are required.");
  }

  const duplicate = await findServerDuplicate(id ? Number(id) : null);
  if (duplicate) {
    saveAfterAction = "records";
    pendingDuplicateId = duplicate.id;
    showDuplicateWarning(duplicate);
    return setMessage("formMessage", "This Employee ID or email is already assigned to another employee.");
  }

  for (const field of RECORD_FIELDS) {
    if (field === "location") {
      payload[field] = selectedLocations.join("; ") || null;
    } else if (BOOLEAN_FIELDS.includes(field)) {
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
  let savedId = id ? Number(id) : null;
  if (id) {
    result = await supabaseClient.from("staff_records").update(payload).eq("id", id).select("id").single();
  } else {
    payload.created_by = currentUser.id;
    result = await supabaseClient.from("staff_records").insert(payload).select("id").single();
  }

  if (result.error) {
    if (result.error.code === "23505") {
      const constraint = result.error.details || result.error.message || "";
      if (constraint.toLowerCase().includes("cert_number")) {
        return setMessage(
          "formMessage",
          "The old Certification Number unique index is still installed. Run DATABASE_EDIT_FIX.sql in Supabase, then save again."
        );
      }
      if (constraint.toLowerCase().includes("employee_id")) {
        return setMessage("formMessage", "That Employee ID is assigned to another employee.");
      }
      return setMessage("formMessage", `A duplicate-value database rule blocked this edit: ${constraint}`);
    }
    return setMessage("formMessage", result.error.message);
  }

  savedId = result.data?.id || savedId;
  try {
    await syncStaffLocations(savedId, selectedLocations);
  } catch (locationError) {
    return setMessage("formMessage", `Record saved, but locations could not be synchronized: ${locationError.message}`);
  }

  const successMessage = id ? "Record updated successfully." : "Record created successfully.";
  await loadRecords();
  if (currentProfile.role === "admin") await loadAudit();

  if (saveAfterAction === "new") {
    resetForm(false);
    setMessage("formMessage", `${successMessage} Ready for a new employee.`, false);
    openTab("entryTab");
  } else {
    const savedRecord = records.find(r => r.id === savedId);
    if (savedRecord) editRecord(savedId);
    setMessage("formMessage", successMessage, false);
    openTab("entryTab");
  }
  saveAfterAction = "records";
}

function resetForm(clearMessage = true) {
  $("recordForm").reset();
  $("recordId").value = "";
  setSelectedLocations([]);
  $("locationInput").value = "";
  $("formTitle").textContent = "Add Staff Record";
  $("deleteEditorButton").classList.add("hidden");
  pendingDuplicateId = null;
  $("duplicateWarning").classList.add("hidden");
  updateRecordMetadata(null);
  renderCurrentRecordHistory();
  updateLiveCompletion();
  highlightWorkspaceSelection(null);
  if (clearMessage) setMessage("formMessage", "");
}

function editRecord(id) {
  const r = records.find(x => x.id === id);
  if (!r || !canEdit(r)) return;

  $("recordId").value = r.id;
  setSelectedLocations(parseLocations(r.location));
  for (const field of RECORD_FIELDS) {
    if (field === "location") {
      continue;
    } else if (field === "cert_number") {
      const certValue = String(r[field] || "").trim().toUpperCase();
      $(field).value =
        certValue === "NON-CERT" || certValue === "NON CERT" || certValue === "NONCERT"
          ? "NON-CERT"
          : (certValue ? "CERT" : "");
    } else if (BOOLEAN_FIELDS.includes(field)) {
      $(field).value = r[field] === null ? "" : String(r[field]);
    } else {
      $(field).value = r[field] ?? "";
    }
  }

  $("formTitle").textContent = `Edit ${r.first_name || ""} ${r.last_name || ""}`;
  $("deleteEditorButton").classList.toggle("hidden", currentProfile.role !== "admin");
  pendingDuplicateId = null;
  $("duplicateWarning").classList.add("hidden");
  updateRecordMetadata(r);
  updateLiveCompletion();
  highlightWorkspaceSelection(r.id);
  renderCurrentRecordHistory();
  setMessage("formMessage", "");
  openTab("entryTab");
  window.scrollTo({ top: 0, behavior: "smooth" });
}


function renderWorkspaceEmployees() {
  const container = $("workspaceEmployeeList");
  if (!container) return;

  const q = $("workspaceSearch")?.value.trim().toLowerCase() || "";
  const currentId = Number($("recordId")?.value || 0);

  const rows = records
    .filter(r => {
      const text = `${r.last_name || ""} ${r.first_name || ""} ${r.employee_id || ""} ${r.position || ""} ${r.location || ""}`.toLowerCase();
      const statusMatch =
        workspaceStatus === "all" ||
        (workspaceStatus === "complete" && r.is_complete) ||
        (workspaceStatus === "incomplete" && !r.is_complete);
      return (!q || text.includes(q)) && statusMatch;
    })
    .sort((a, b) => `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`));

  $("browserCount").textContent = rows.length;
  container.innerHTML = rows.length ? rows.map(r => `
    <button type="button"
      class="employee-list-item ${r.id === currentId ? "selected" : ""}"
      onclick="${canEdit(r) ? `editRecord(${r.id})` : `viewRecord(${r.id})`}">
      <span class="employee-list-main">
        <strong>${esc(`${r.last_name || ""}, ${r.first_name || ""}`)}</strong>
        <small>${esc(r.position || "No position")} · ID ${esc(r.employee_id || "—")}</small>
      </span>
      <span class="mini-status ${r.is_complete ? "complete" : "incomplete"}">${r.is_complete ? "Complete" : "Incomplete"}</span>
    </button>
  `).join("") : `<p class="empty-state">No employees found.</p>`;
}

function highlightWorkspaceSelection(id) {
  document.querySelectorAll(".employee-list-item").forEach(item => item.classList.remove("selected"));
  if (id) {
    const selected = [...document.querySelectorAll(".employee-list-item")]
      .find(item => item.getAttribute("onclick")?.includes(`(${id})`));
    selected?.classList.add("selected");
  }
}

function getFormSnapshot() {
  const snapshot = {};
  for (const field of RECORD_FIELDS) {
    if (field === "location") {
      snapshot[field] = selectedLocations.join("; ");
    } else if (BOOLEAN_FIELDS.includes(field)) {
      const raw = $(field).value;
      snapshot[field] = raw === "" ? null : raw === "true";
    } else {
      snapshot[field] = $(field).value.trim();
    }
  }
  return snapshot;
}

function handleLiveFormChange() {
  updateLiveCompletion();
  checkForDuplicateLive();
}

function updateLiveCompletion() {
  if (!$("liveChecklist")) return;
  const snapshot = getFormSnapshot();
  const missing = getMissingFields(snapshot);
  const completeCount = RECORD_FIELDS.length - missing.length;
  const percent = Math.round((completeCount / RECORD_FIELDS.length) * 100);
  const complete = missing.length === 0;

  $("completionStatusText").textContent = complete ? "COMPLETE" : "INCOMPLETE";
  $("completionSummary").textContent = complete
    ? "Every field is filled out."
    : `${missing.length} field${missing.length === 1 ? "" : "s"} still missing.`;
  $("completionPercent").textContent = `${percent}%`;
  $("completionProgress").style.width = `${percent}%`;
  $("completionBanner").classList.toggle("complete", complete);
  $("completionBanner").classList.toggle("incomplete", !complete);

  $("liveChecklist").innerHTML = RECORD_FIELDS.map(field => {
    const isMissing = missing.includes(LABELS[field]);
    return `<div class="checklist-item ${isMissing ? "missing" : "done"}">
      <span>${isMissing ? "✕" : "✓"}</span>
      <span>${esc(LABELS[field])}</span>
    </div>`;
  }).join("");
}

async function findServerDuplicate(currentRecordId = null) {
  const employeeId = $("employee_id").value.trim();
  const districtEmail = $("district_email").value.trim();
  const personalEmail = $("email").value.trim();

  const checks = [];
  if (employeeId) checks.push(`employee_id.eq.${escapePostgrestValue(employeeId)}`);
  if (districtEmail) checks.push(`district_email.ilike.${escapePostgrestValue(districtEmail)}`);
  if (personalEmail) checks.push(`email.ilike.${escapePostgrestValue(personalEmail)}`);
  if (!checks.length) return null;

  let query = supabaseClient
    .from("staff_records")
    .select("id,first_name,last_name,position,employee_id,district_email,email")
    .or(checks.join(","))
    .limit(1);

  if (currentRecordId) query = query.neq("id", currentRecordId);

  const { data, error } = await query;
  if (error) {
    console.warn("Duplicate check failed:", error);
    return findLiveDuplicate();
  }
  return data?.[0] || null;
}

function escapePostgrestValue(value) {
  return `"${String(value).replaceAll("\\\\", "\\\\\\\\").replaceAll('"', '\\\\"')}"`;
}

function findLiveDuplicate() {
  const currentId = Number($("recordId").value || 0);
  const employeeId = $("employee_id").value.trim().toLowerCase();
  const districtEmail = $("district_email").value.trim().toLowerCase();
  const personalEmail = $("email").value.trim().toLowerCase();

  if (!employeeId && !districtEmail && !personalEmail) return null;

  return records.find(r => {
    if (r.id === currentId) return false;
    return (
      (employeeId && String(r.employee_id || "").trim().toLowerCase() === employeeId) ||
      (districtEmail && String(r.district_email || "").trim().toLowerCase() === districtEmail) ||
      (personalEmail && String(r.email || "").trim().toLowerCase() === personalEmail)
    );
  }) || null;
}

function checkForDuplicateLive() {
  const duplicate = findLiveDuplicate();
  if (!duplicate) {
    pendingDuplicateId = null;
    $("duplicateWarning").classList.add("hidden");
    return;
  }
  pendingDuplicateId = duplicate.id;
  showDuplicateWarning(duplicate);
}

function showDuplicateWarning(record) {
  const matches = [];
  const employeeId = $("employee_id").value.trim().toLowerCase();
  const districtEmail = $("district_email").value.trim().toLowerCase();
  const personalEmail = $("email").value.trim().toLowerCase();

  if (employeeId && String(record.employee_id || "").toLowerCase() === employeeId) matches.push("Employee ID");
  if (districtEmail && String(record.district_email || "").toLowerCase() === districtEmail) matches.push("District Email");
  if (personalEmail && String(record.email || "").toLowerCase() === personalEmail) matches.push("Personal Email");

  $("duplicateWarningText").textContent =
    `${matches.join(", ")} matches ${record.first_name || ""} ${record.last_name || ""} (${record.position || "No position"}).`;
  $("duplicateWarning").classList.remove("hidden");
}

function duplicateCurrentRecord() {
  const id = Number($("recordId").value || 0);
  if (!id) {
    setMessage("formMessage", "Select an existing record before duplicating it.");
    return;
  }

  $("recordId").value = "";
  $("employee_id").value = "";
  $("district_email").value = "";
  $("email").value = "";
  $("formTitle").textContent = `New Record Copied from ${$("first_name").value} ${$("last_name").value}`;
  $("deleteEditorButton").classList.add("hidden");
  updateRecordMetadata(null);
  pendingDuplicateId = null;
  $("duplicateWarning").classList.add("hidden");
  updateLiveCompletion();
  highlightWorkspaceSelection(null);
  setMessage("formMessage", "Copy created. Enter a new Employee ID and email addresses, then save.", false);
}

async function deleteCurrentEditorRecord() {
  const id = Number($("recordId").value || 0);
  if (!id) return;
  await deleteRecord(id);
  resetForm();
  openTab("recordsTab");
}

function updateRecordMetadata(record) {
  const metadata = $("recordMetadata");
  if (!metadata) return;
  metadata.innerHTML = `
    <div><dt>Created By</dt><dd>${esc(record?.created_by_name || record?.updated_by_name || "—")}</dd></div>
    <div><dt>Created</dt><dd>${record ? formatDateTime(record.created_at) : "—"}</dd></div>
    <div><dt>Last Updated By</dt><dd>${esc(record?.updated_by_name || "—")}</dd></div>
    <div><dt>Last Updated</dt><dd>${record ? formatDateTime(record.updated_at) : "—"}</dd></div>
  `;
}

function renderCurrentRecordHistory() {
  const container = $("recordHistory");
  if (!container || currentProfile?.role !== "admin") return;

  const recordId = Number($("recordId")?.value || 0);
  if (!recordId) {
    container.innerHTML = `<p class="muted">Save or select a record to view its history.</p>`;
    return;
  }

  const entries = auditRows
    .filter(a => Number(a.staff_record_id) === recordId)
    .sort((a, b) => new Date(b.changed_at) - new Date(a.changed_at))
    .slice(0, 20);

  container.innerHTML = entries.length ? entries.map(a => {
    const changes = changedFields(a);
    const detail = a.action === "UPDATE"
      ? (changes.join(", ") || "Record updated")
      : (a.action === "INSERT" ? "Record created" : "Record deleted");
    return `<button type="button" class="history-entry" onclick="viewAudit(${a.id})">
      <span><strong>${esc(a.action)}</strong> · ${esc(a.changed_by_name)}</span>
      <small>${formatDateTime(a.changed_at)}</small>
      <small>${esc(detail)}</small>
    </button>`;
  }).join("") : `<p class="muted">No audit history found.</p>`;
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
      <div class="detail-item"><span>Status</span><strong>${r.is_complete ? "Complete" : "Incomplete"}</strong></div>
      <div class="detail-item"><span>Missing Information</span><strong>${r.is_complete ? "None" : esc(getMissingFields(r).join(", "))}</strong></div>
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
  renderCurrentRecordHistory();
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


const IMPORT_HEADERS = {
  cert_number: ["cert/non-cert", "cert non-cert", "cert or non-cert", "cert status", "certification status", "certno", "cert no"],
  last_name: ["last name", "lastname"],
  first_name: ["first name", "firstname"],
  position: ["position", "job title", "title"],
  location: ["location", "school", "work location"],
  doh: ["doh", "date of hire", "hire date"],
  ein: ["ein"],
  dob: ["dob", "date of birth", "birth date"],
  gender: ["gender", "sex"],
  race_ethnicity: ["race/ethnicity", "race ethnicity", "race", "ethnicity", "race/ethnic"],
  employee_id: ["id", "employee id", "employeeid", "staff id"],
  degree: ["degree", "highest degree"],
  years_experience: ["yrs exp", "years experience", "years of experience", "experience"],
  district_email: ["district email", "work email"],
  email: ["email", "personal email"],
  cell_phone: ["cell phone #", "cell phone", "phone", "mobile", "cell"],
  nda_signed: ["nda signed", "nda"],
  power_school: ["power school", "powerschool"],
  previous_boe: ["previous boe", "prior boe"],
  data_management_1: ["data mgmnt eds", "data mgmt eds", "data management eds", "powerschool 1", "data mgmt 1", "data management 1", "data mgmt"],
  data_management_2: ["data mgmt powerschool", "data management powerschool", "powerschool 2", "data mgmt 2", "data management 2"],
  account_created: ["account?", "account created", "account"],
  note: ["note", "notes"]
};

const ALLOWED_CERT_STATUSES = ["CERT", "NON-CERT"];
const ALLOWED_DEGREES = ["Associate", "Bachelor's", "Master's", "6th Year", "Doctorate"];
const ALLOWED_RACES = [
  "Hispanic/Latino (of any race)",
  "American Indian or Alaska Native",
  "Asian",
  "Black or African American",
  "Native Hawaiian or Other Pacific Islander",
  "White",
  "Two or More Races"
];

function normalizeHeader(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function buildHeaderMap(headers) {
  const normalized = headers.map(normalizeHeader);
  const map = {};
  for (const [field, aliases] of Object.entries(IMPORT_HEADERS)) {
    const index = normalized.findIndex(h => aliases.includes(h));
    if (index >= 0) map[field] = headers[index];
  }
  return map;
}

function normalizeBoolean(value) {
  if (value === true || value === false) return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (["yes","y","true","1","x","complete","completed","signed"].includes(text)) return true;
  if (["no","n","false","0","incomplete","not signed"].includes(text)) return false;
  return null;
}

function normalizeDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && !isNaN(value)) return value.toISOString().slice(0,10);
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2,"0")}-${String(parsed.d).padStart(2,"0")}`;
  }
  const date = new Date(value);
  return isNaN(date) ? null : date.toISOString().slice(0,10);
}

function normalizeText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function rowToPayload(row, headerMap) {
  const payload = {};
  for (const field of RECORD_FIELDS) {
    const sourceHeader = headerMap[field];
    const raw = sourceHeader ? row[sourceHeader] : null;
    if (field === "cert_number") {
      const status = normalizeText(raw);
      payload[field] = status ? status.toUpperCase() : null;
    } else if (BOOLEAN_FIELDS.includes(field)) payload[field] = normalizeBoolean(raw);
    else if (["doh","dob"].includes(field)) payload[field] = normalizeDate(raw);
    else if (field === "years_experience") {
      const number = Number(raw);
      payload[field] = raw === null || raw === undefined || raw === "" || Number.isNaN(number) ? null : number;
    } else payload[field] = normalizeText(raw);
  }
  return payload;
}

function validateImportPayload(payload) {
  const warnings = [];
  if (!payload.employee_id) warnings.push("Missing Employee ID");
  if (payload.cert_number && !ALLOWED_CERT_STATUSES.includes(payload.cert_number.toUpperCase())) warnings.push(`CERT/NON-CERT must be CERT or NON-CERT: ${payload.cert_number}`);
  if (!payload.first_name && !payload.last_name) warnings.push("Missing employee name");
  if (payload.degree && !ALLOWED_DEGREES.includes(payload.degree)) warnings.push(`Unknown degree: ${payload.degree}`);
  if (payload.race_ethnicity && !ALLOWED_RACES.includes(payload.race_ethnicity)) warnings.push(`Unknown race/ethnicity: ${payload.race_ethnicity}`);
  if (payload.years_experience !== null && payload.years_experience < 0) warnings.push("Years Experience cannot be negative");
  return warnings;
}

function findExistingRecord(payload) {
  const employeeId = (payload.employee_id || "").toLowerCase();
  return records.find(r =>
    employeeId && String(r.employee_id || "").toLowerCase() === employeeId
  );
}

function clearImportPreview() {
  importPreviewRows = [];
  $("importPreviewPanel").classList.add("hidden");
  $("importResultPanel").classList.add("hidden");
  $("runImportButton").disabled = true;
  setMessage("importMessage", "");
}

async function previewImportFile() {
  if (currentProfile?.role !== "admin") return;
  const file = $("importFile").files[0];
  if (!file) return setMessage("importMessage", "Select an Excel or CSV file first.");

  setMessage("importMessage", "Reading file...", false);
  try {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: "array", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
    if (!rawRows.length) throw new Error("The first worksheet does not contain any data rows.");

    const headers = Object.keys(rawRows[0]);
    const headerMap = buildHeaderMap(headers);
    const requiredColumnsFound = ["first_name","last_name","employee_id"].some(f => headerMap[f]);
    if (!requiredColumnsFound) throw new Error("The file headings could not be recognized. Use the downloadable template or the original headings shown in the system.");

    importPreviewRows = rawRows.map((row, index) => {
      const payload = rowToPayload(row, headerMap);
      const existing = findExistingRecord(payload);
      const warnings = validateImportPayload(payload);
      return { rowNumber: index + 2, payload, existing, warnings };
    }).filter(item => Object.values(item.payload).some(v => v !== null));

    renderImportPreview();
    $("runImportButton").disabled = importPreviewRows.length === 0;
    setMessage("importMessage", `${importPreviewRows.length} data rows are ready for review.`, false);
  } catch (error) {
    clearImportPreview();
    setMessage("importMessage", error.message || "Unable to read the file.");
  }
}

function renderImportPreview() {
  const newCount = importPreviewRows.filter(r => !r.existing).length;
  const duplicateCount = importPreviewRows.filter(r => r.existing).length;
  const warningCount = importPreviewRows.filter(r => r.warnings.length).length;

  $("importRowsFound").textContent = importPreviewRows.length;
  $("importNewCount").textContent = newCount;
  $("importDuplicateCount").textContent = duplicateCount;
  $("importWarningCount").textContent = warningCount;

  $("importPreviewBody").innerHTML = importPreviewRows.slice(0,250).map(item => {
    const p = item.payload;
    const result = item.warnings.length
      ? `<span class="preview-warning">Review</span>`
      : `<span class="preview-ready">${item.existing ? "Duplicate" : "New"}</span>`;
    return `<tr>
      <td>${item.rowNumber}</td>
      <td>${esc(`${p.first_name || ""} ${p.last_name || ""}`.trim())}</td>
      <td>${esc(p.cert_number)}</td>
      <td>${esc(p.employee_id)}</td>
      <td>${result}</td>
      <td>${esc(item.warnings.join("; "))}</td>
    </tr>`;
  }).join("") + (importPreviewRows.length > 250 ? `<tr><td colspan="6">Preview limited to the first 250 rows. All ${importPreviewRows.length} rows will be processed.</td></tr>` : "");

  $("importPreviewPanel").classList.remove("hidden");
}

async function runImport() {
  if (currentProfile?.role !== "admin" || !importPreviewRows.length) return;
  const invalid = importPreviewRows.filter(r => r.warnings.some(w => w.startsWith("Unknown degree") || w.startsWith("Unknown race") || w.startsWith("CERT/NON-CERT") || w.includes("cannot be negative")));
  if (invalid.length) {
    return setMessage("importMessage", `Correct the ${invalid.length} row(s) with invalid dropdown or numeric values before importing.`);
  }

  const duplicateMode = $("duplicateMode").value;
  $("runImportButton").disabled = true;
  $("previewImportButton").disabled = true;
  setMessage("importMessage", "Importing records...", false);

  let inserted = 0, updated = 0, skipped = 0, errors = 0;
  const errorDetails = [];

  for (let i = 0; i < importPreviewRows.length; i++) {
    const item = importPreviewRows[i];
    const payload = { ...item.payload, updated_by: currentUser.id };

    try {
      if (item.existing) {
        if (duplicateMode === "skip") {
          skipped++;
          continue;
        }
        // Blank upload cells do not overwrite populated values.
        const merged = {};
        for (const field of RECORD_FIELDS) {
          merged[field] = payload[field] === null ? item.existing[field] : payload[field];
        }
        merged.updated_by = currentUser.id;
        const { error } = await supabaseClient.from("staff_records").update(merged).eq("id", item.existing.id);
        if (error) throw error;
        if (payload.location !== null) await syncStaffLocations(item.existing.id, parseLocations(merged.location));
        updated++;
      } else {
        payload.created_by = currentUser.id;
        const { data: insertedRow, error } = await supabaseClient.from("staff_records").insert(payload).select("id").single();
        if (error) throw error;
        await syncStaffLocations(insertedRow.id, parseLocations(payload.location));
        inserted++;
      }
    } catch (error) {
      errors++;
      errorDetails.push(`Row ${item.rowNumber}: ${error.message || "Import failed"}`);
    }

    if ((i + 1) % 20 === 0 || i === importPreviewRows.length - 1) {
      setMessage("importMessage", `Processed ${i + 1} of ${importPreviewRows.length} rows...`, false);
    }
  }

  await loadRecords();
  await loadAudit();

  const result = $("importResultPanel");
  result.className = `import-result ${errors ? "warning" : "success"}`;
  result.innerHTML = `
    <h3>Import Complete</h3>
    <p><strong>${inserted}</strong> added &nbsp; | &nbsp; <strong>${updated}</strong> updated &nbsp; | &nbsp; <strong>${skipped}</strong> skipped &nbsp; | &nbsp; <strong>${errors}</strong> errors</p>
    ${errorDetails.length ? `<details><summary>View errors</summary><ul>${errorDetails.slice(0,100).map(e => `<li>${esc(e)}</li>`).join("")}</ul></details>` : ""}
  `;
  result.classList.remove("hidden");
  setMessage("importMessage", errors ? "Import finished with some errors." : "Import completed successfully.", !errors);
  $("runImportButton").disabled = false;
  $("previewImportButton").disabled = false;
}

function downloadImportTemplate() {
  const headers = RECORD_FIELDS.map(f => LABELS[f]);
  const example = [
    "CERT","Example","Employee","Teacher","Example School; District Office","2026-08-20","123456789","1990-01-15",
    "Female","White","EMP-1001","Master's",10,"employee@district.org","personal@example.com","203-555-0100",
    "Yes","Yes","No","Yes","No","Yes","Example template row"
  ];
  const worksheet = XLSX.utils.aoa_to_sheet([headers, example]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Staff Import");
  XLSX.writeFile(workbook, "staff-import-template.xlsx");
}

function exportCsv() {
  const rows = filteredRecords();
  const headers = [
    "Status","Missing Information",...RECORD_FIELDS.map(f => LABELS[f]),
    "Created At","Updated At","Updated By"
  ];

  const data = rows.map(r => [
    r.is_complete ? "Complete" : "Incomplete", getMissingFields(r).join("; "),
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

function getMissingFields(record) {
  return RECORD_FIELDS.filter(field => {
    const value = record[field];
    if (BOOLEAN_FIELDS.includes(field)) return value === null || value === undefined;
    return value === null || value === undefined || String(value).trim() === "";
  }).map(field => LABELS[field]);
}

function hasCriticalMissing(record) {
  const criticalFields = [
    "cert_number", "last_name", "first_name", "position",
    "location", "employee_id", "district_email"
  ];
  return criticalFields.some(field => {
    const value = record[field];
    return value === null || value === undefined || String(value).trim() === "";
  });
}

function printIncompleteChecklist() {
  const incomplete = records.filter(r => !r.is_complete);
  if (!incomplete.length) {
    alert("There are no incomplete records.");
    return;
  }

  const rows = incomplete.map(r => `
    <tr>
      <td>${esc(`${r.last_name || ""}, ${r.first_name || ""}`)}</td>
      <td>${esc(r.employee_id)}</td>
      <td>${esc(r.location)}</td>
      <td>${esc(getMissingFields(r).join(", "))}</td>
    </tr>
  `).join("");

  const printWindow = window.open("", "_blank");
  printWindow.document.write(`
    <!doctype html>
    <html>
    <head>
      <title>Incomplete Staff Records</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 24px; color: #243447; }
        h1 { margin-bottom: 4px; }
        p { color: #667788; }
        table { width: 100%; border-collapse: collapse; margin-top: 18px; }
        th, td { border: 1px solid #cbd5df; padding: 8px; text-align: left; vertical-align: top; }
        th { background: #eef4f8; }
      </style>
    </head>
    <body>
      <h1>Incomplete Staff Records</h1>
      <p>${incomplete.length} record(s) require additional information.</p>
      <table>
        <thead><tr><th>Employee</th><th>Employee ID</th><th>Locations</th><th>Missing Information</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

function formatDateOnly(value) {
  if (!value) return "";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  return year && month && day ? `${month}/${day}/${year}` : value;
}

function formatDateTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString();
}

function yesNo(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "";
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
