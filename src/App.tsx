import React, { useEffect, useMemo, useRef, useState } from "react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

type Shift = {
  id: number;
  date: string;
  start: string;
  end: string;
  rosteredEnd: string;
  jobNumber: string;
  station: string;
  vehicleCallsign: string;
  crewmate: string;
  mealBreakOffStation: boolean;
  paidMinutes: number;
  overtimeMinutes: number;
  unsocialWeekdaySaturdayMinutes: number;
  unsocialSundayHolidayMinutes: number;
  unsocialEnhancementPay: number;
  basicPay: number;
  overtimePay: number;
  totalShiftPay: number;
};

type Draft = {
  date: string;
  start: string;
  end: string;
  rosteredEnd: string;
  jobNumber: string;
  station: string;
  vehicleCallsign: string;
  crewmate: string;
  mealBreakOffStation: boolean;
};

type Settings = {
  baseHourlyRate: number;
  bandPreset: "band1to3" | "band4to9" | "custom";
  weekdaySaturdayEnhancement: number;
  sundayHolidayEnhancement: number;
};

type ShiftTemplate = {
  id: number;
  name: string;
  start: string;
  end: string;
  rosteredEnd: string;
};

type Totals = {
  paid: number;
  ot: number;
  unsocialMinutes: number;
  unsocialPay: number;
  basicPay: number;
  overtimePay: number;
  totalShiftPay: number;
};

type UnsocialSummary = {
  unsocialWeekdaySaturdayMinutes: number;
  unsocialSundayHolidayMinutes: number;
  unsocialEnhancementPay: number;
};

const STORAGE_KEY = "awsl_clean_v17_shifts";
const SETTINGS_KEY = "awsl_clean_v17_settings";
const TEMPLATE_KEY = "awsl_clean_v17_templates";
const GRS_URL = "https://swast-web.grs.totalmobile-cloud.com/Frontend/Dashboard.aspx";

const DEFAULT_SETTINGS: Settings = {
  baseHourlyRate: 20,
  bandPreset: "band4to9",
  weekdaySaturdayEnhancement: 0.3,
  sundayHolidayEnhancement: 0.6,
};

const DEFAULT_TEMPLATES: ShiftTemplate[] = [
  { id: 1, name: "Day Shift", start: "07:00", end: "19:00", rosteredEnd: "19:00" },
  { id: 2, name: "Night Shift", start: "19:00", end: "07:00", rosteredEnd: "07:00" },
  { id: 3, name: "Late Shift", start: "10:00", end: "22:00", rosteredEnd: "22:00" },
];

const EXPORT_HEADERS = [
  "Date",
  "Start",
  "End",
  "Rostered End",
  "Paid",
  "Overtime",
  "Unsocial Wk/Sat",
  "Unsocial Sun/PH",
  "Basic Pay",
  "OT Pay",
  "Unsocial +",
  "Total",
  "Job",
  "Meal Break Off Station",
  "Station",
  "Vehicle",
  "Crewmate",
] as const;

const styles: Record<string, React.CSSProperties> = {
  input: {
    display: "block",
    width: "100%",
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid #cbd5e1",
    fontSize: 16,
    background: "#fff",
    boxSizing: "border-box",
    WebkitAppearance: "none",
  },
  primaryButton: {
    width: "100%",
    minHeight: 46,
    borderRadius: 12,
    border: "none",
    background: "#0f172a",
    color: "#fff",
    fontSize: 15,
    fontWeight: 700,
    padding: "12px 14px",
  },
  secondaryButton: {
    width: "100%",
    minHeight: 46,
    borderRadius: 12,
    border: "1px solid #cbd5e1",
    background: "#fff",
    color: "#0f172a",
    fontSize: 15,
    fontWeight: 600,
    padding: "12px 14px",
  },
  secondaryButtonCompact: {
    minHeight: 36,
    minWidth: 36,
    borderRadius: 10,
    border: "1px solid #cbd5e1",
    background: "#fff",
    color: "#0f172a",
    fontSize: 16,
    fontWeight: 600,
    padding: "6px 10px",
  },
  dangerButton: {
    width: "100%",
    minHeight: 46,
    borderRadius: 12,
    border: "1px solid #fecaca",
    background: "#fff1f2",
    color: "#be123c",
    fontSize: 15,
    fontWeight: 600,
    padding: "12px 14px",
  },
  uploadButtonBlock: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    minHeight: 46,
    borderRadius: 12,
    border: "1px solid #cbd5e1",
    background: "#fff",
    color: "#0f172a",
    fontSize: 15,
    fontWeight: 600,
    padding: "12px 14px",
    cursor: "pointer",
    boxSizing: "border-box",
  },
};

function getTodayDate(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function getMonthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
}

function defaultDraft(): Draft {
  return {
    date: getTodayDate(),
    start: "07:00",
    end: "19:00",
    rosteredEnd: "19:00",
    jobNumber: "",
    station: "",
    vehicleCallsign: "",
    crewmate: "",
    mealBreakOffStation: false,
  };
}

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function durationMinutes(start: string, end: string): number {
  const s = toMinutes(start);
  const e = toMinutes(end);
  return e >= s ? e - s : 1440 - s + e;
}

function mealBreakMinutes(worked: number): number {
  return worked >= 720 ? 60 : 30;
}

function paidMinutes(start: string, end: string): number {
  const worked = durationMinutes(start, end);
  return Math.max(0, worked - mealBreakMinutes(worked));
}

function overtimeMinutes(rosteredEnd: string, end: string): number {
  const r = toMinutes(rosteredEnd);
  const e = toMinutes(end);
  if (e === r) return 0;
  return e > r ? e - r : 1440 - r + e;
}

function formatMinutes(mins: number): string {
  const safe = Math.max(0, Math.round(mins || 0));
  return `${Math.floor(safe / 60)}h ${safe % 60}m`;
}

function formatDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

function getDateTime(date: string, time: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

function isValidJobNumber(value: string): boolean {
  return !value.trim() || /^\d{6,10}$/.test(value.trim());
}

function calculateUnsocial(draft: Draft, settings: Settings): UnsocialSummary {
  const start = getDateTime(draft.date, draft.start);
  let end = getDateTime(draft.date, draft.end);
  if (end <= start) end = new Date(end.getTime() + 86400000);

  const worked = Math.round((end.getTime() - start.getTime()) / 60000);
  const paid = paidMinutes(draft.start, draft.end);
  let weekdayNight = 0;
  let saturday = 0;
  let sundayHoliday = 0;

  for (let i = 0; i < worked; i += 1) {
    const t = new Date(start.getTime() + i * 60000);
    const day = t.getDay();
    const minuteOfDay = t.getHours() * 60 + t.getMinutes();
    if (day === 0) sundayHoliday += 1;
    else if (day === 6) saturday += 1;
    else if (minuteOfDay >= 20 * 60 || minuteOfDay < 6 * 60) weekdayNight += 1;
  }

  const capped = Math.min(weekdayNight + saturday + sundayHoliday, paid);
  let remaining = capped;
  const payableSundayHoliday = Math.min(sundayHoliday, remaining);
  remaining -= payableSundayHoliday;
  const payableSaturday = Math.min(saturday, remaining);
  remaining -= payableSaturday;
  const payableWeekdayNight = Math.min(weekdayNight, remaining);

  const enhancement =
    ((payableWeekdayNight + payableSaturday) / 60) * settings.baseHourlyRate * settings.weekdaySaturdayEnhancement +
    (payableSundayHoliday / 60) * settings.baseHourlyRate * settings.sundayHolidayEnhancement;

  return {
    unsocialWeekdaySaturdayMinutes: payableWeekdayNight + payableSaturday,
    unsocialSundayHolidayMinutes: payableSundayHoliday,
    unsocialEnhancementPay: enhancement,
  };
}

function buildShift(source: Draft, settings: Settings, id?: number): Shift {
  const paid = paidMinutes(source.start, source.end);
  const overtime = overtimeMinutes(source.rosteredEnd, source.end);
  const unsocial = calculateUnsocial(source, settings);
  const basicPay = (paid / 60) * settings.baseHourlyRate;
  const overtimePay = (overtime / 60) * settings.baseHourlyRate;

  return {
    id: id ?? Date.now() + Math.floor(Math.random() * 1000000),
    date: source.date,
    start: source.start,
    end: source.end,
    rosteredEnd: source.rosteredEnd,
    jobNumber: source.jobNumber.trim(),
    station: source.station,
    vehicleCallsign: source.vehicleCallsign,
    crewmate: source.crewmate,
    mealBreakOffStation: source.mealBreakOffStation,
    paidMinutes: paid,
    overtimeMinutes: overtime,
    unsocialWeekdaySaturdayMinutes: unsocial.unsocialWeekdaySaturdayMinutes,
    unsocialSundayHolidayMinutes: unsocial.unsocialSundayHolidayMinutes,
    unsocialEnhancementPay: unsocial.unsocialEnhancementPay,
    basicPay,
    overtimePay,
    totalShiftPay: basicPay + overtimePay + unsocial.unsocialEnhancementPay,
  };
}

function calculateTotals(shifts: Shift[]): Totals {
  return {
    paid: shifts.reduce((a, b) => a + b.paidMinutes, 0),
    ot: shifts.reduce((a, b) => a + b.overtimeMinutes, 0),
    unsocialMinutes: shifts.reduce((a, b) => a + b.unsocialWeekdaySaturdayMinutes + b.unsocialSundayHolidayMinutes, 0),
    unsocialPay: shifts.reduce((a, b) => a + b.unsocialEnhancementPay, 0),
    basicPay: shifts.reduce((a, b) => a + b.basicPay, 0),
    overtimePay: shifts.reduce((a, b) => a + b.overtimePay, 0),
    totalShiftPay: shifts.reduce((a, b) => a + b.totalShiftPay, 0),
  };
}

function csvRows(shifts: Shift[]) {
  return [
    [...EXPORT_HEADERS],
    ...shifts.map((s) => [
      s.date,
      s.start,
      s.end,
      s.rosteredEnd,
      s.paidMinutes,
      s.overtimeMinutes,
      s.unsocialWeekdaySaturdayMinutes,
      s.unsocialSundayHolidayMinutes,
      s.basicPay.toFixed(2),
      s.overtimePay.toFixed(2),
      s.unsocialEnhancementPay.toFixed(2),
      s.totalShiftPay.toFixed(2),
      s.jobNumber,
      s.mealBreakOffStation ? "Yes" : "No",
      s.station,
      s.vehicleCallsign,
      s.crewmate,
    ]),
  ];
}

function pdfRows(shifts: Shift[]) {
  return shifts.map((s) => [
    formatDate(s.date),
    s.start,
    s.end,
    s.rosteredEnd,
    formatMinutes(s.paidMinutes),
    formatMinutes(s.overtimeMinutes),
    formatMinutes(s.unsocialWeekdaySaturdayMinutes),
    formatMinutes(s.unsocialSundayHolidayMinutes),
    `£${s.basicPay.toFixed(2)}`,
    `£${s.overtimePay.toFixed(2)}`,
    `£${s.unsocialEnhancementPay.toFixed(2)}`,
    `£${s.totalShiftPay.toFixed(2)}`,
    s.jobNumber || "-",
    s.mealBreakOffStation ? "Yes" : "No",
    s.station || "-",
    s.vehicleCallsign || "-",
    s.crewmate || "-",
  ]);
}

function downloadBlob(blob: Blob, filename: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function useStoredState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue] as const;
}

function runSmokeTests(): void {
  console.assert(durationMinutes("07:00", "19:00") === 720, "durationMinutes failed");
  console.assert(paidMinutes("07:00", "19:00") === 660, "paidMinutes failed");
  console.assert(overtimeMinutes("19:00", "19:30") === 30, "overtimeMinutes failed");
  console.assert(isValidJobNumber("12345678"), "isValidJobNumber failed");
}

runSmokeTests();

export default function App() {
  const [selectedMonth] = useState(getMonthKey());
  const [shifts, setShifts] = useStoredState<Shift[]>(STORAGE_KEY, []);
  const [settings, setSettings] = useStoredState<Settings>(SETTINGS_KEY, DEFAULT_SETTINGS);
  const [templates, setTemplates] = useStoredState<ShiftTemplate[]>(TEMPLATE_KEY, DEFAULT_TEMPLATES);
  const [draft, setDraft] = useState<Draft>(defaultDraft());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [error, setError] = useState("");

  const worked = useMemo(() => durationMinutes(draft.start, draft.end), [draft.start, draft.end]);
  const paid = useMemo(() => paidMinutes(draft.start, draft.end), [draft.start, draft.end]);
  const overtime = useMemo(() => overtimeMinutes(draft.rosteredEnd, draft.end), [draft.rosteredEnd, draft.end]);
  const unsocial = useMemo(() => calculateUnsocial(draft, settings), [draft, settings]);
  const basicPay = (paid / 60) * settings.baseHourlyRate;
  const overtimePay = (overtime / 60) * settings.baseHourlyRate;
  const totalShiftPay = basicPay + overtimePay + unsocial.unsocialEnhancementPay;

  function saveShift() {
    if (!draft.date || !draft.start || !draft.end || !draft.rosteredEnd) {
      setError("Please complete the date and times.");
      return;
    }
    if (overtime > 0 && !draft.jobNumber.trim()) {
      setError("Please add a job number for any overtime / overrun.");
      return;
    }
    if (!isValidJobNumber(draft.jobNumber)) {
      setError("Job number must be 6 to 10 digits.");
      return;
    }

    const shift = buildShift(draft, settings, editingId ?? undefined);
    setShifts((current) =>
      editingId ? current.map((s) => (s.id === editingId ? shift : s)) : [shift, ...current],
    );
    setEditingId(null);
    setDraft(defaultDraft());
    setError("");
  }

  function startEdit(shift: Shift) {
    setDraft({
      date: shift.date,
      start: shift.start,
      end: shift.end,
      rosteredEnd: shift.rosteredEnd,
      jobNumber: shift.jobNumber,
      station: shift.station,
      vehicleCallsign: shift.vehicleCallsign,
      crewmate: shift.crewmate,
      mealBreakOffStation: shift.mealBreakOffStation,
    });
    setEditingId(shift.id);
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function deleteShift(id: number) {
    setShifts((current) => current.filter((s) => s.id !== id));
    if (editingId === id) {
      setEditingId(null);
      setDraft(defaultDraft());
    }
  }

  function duplicateShiftToTomorrow(shift: Shift) {
    const currentDate = new Date(`${shift.date}T00:00:00`);
    currentDate.setDate(currentDate.getDate() + 1);
    const nextDate = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}-${String(currentDate.getDate()).padStart(2, "0")}`;
    const duplicatedDraft: Draft = {
      date: nextDate,
      start: shift.start,
      end: shift.end,
      rosteredEnd: shift.rosteredEnd,
      jobNumber: "",
      station: shift.station,
      vehicleCallsign: shift.vehicleCallsign,
      crewmate: shift.crewmate,
      mealBreakOffStation: shift.mealBreakOffStation,
    };
    setShifts((current) => [buildShift(duplicatedDraft, settings), ...current]);
  }

  function addTemplate() {
    setTemplates((current) => [
      ...current,
      { id: Date.now(), name: "New Template", start: "07:00", end: "19:00", rosteredEnd: "19:00" },
    ]);
  }

  function updateTemplate(id: number, field: keyof ShiftTemplate, value: string | number) {
    setTemplates((current) =>
      current.map((template) => (template.id === id ? { ...template, [field]: value } : template)),
    );
  }

  function removeTemplate(id: number) {
    setTemplates((current) => current.filter((template) => template.id !== id));
  }

  function applyTemplate(template: ShiftTemplate) {
    setDraft((current) => ({
      ...current,
      start: template.start,
      end: template.end,
      rosteredEnd: template.rosteredEnd,
    }));
  }

  function exportBackup() {
    const payload = {
      shifts,
      settings,
      templates,
      exportedAt: new Date().toISOString(),
      version: 1,
    };
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8;" }),
      `ambulance-worker-backup-${selectedMonth}.json`,
    );
  }

  async function importBackup(file: File) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const importedShifts = Array.isArray(parsed?.shifts) ? parsed.shifts : [];
      const importedSettings =
        parsed?.settings && typeof parsed.settings === "object"
          ? { ...DEFAULT_SETTINGS, ...parsed.settings }
          : null;
      const importedTemplates =
        Array.isArray(parsed?.templates) && parsed.templates.length > 0 ? parsed.templates : null;

      setShifts(importedShifts);
      if (importedSettings) setSettings(importedSettings);
      if (importedTemplates) setTemplates(importedTemplates);
      setEditingId(null);
      setDraft(defaultDraft());
      setError("");
    } catch {
      setError("Could not import backup file.");
    }
  }

  function exportCSV() {
    downloadBlob(
      new Blob([csvRows(shifts).map((r) => r.join(",")).join("\n")], {
        type: "text/csv;charset=utf-8;",
      }),
      `ambulance-worker-shifts-${selectedMonth}.csv`,
    );
  }

  function exportPDF() {
    const totals = calculateTotals(shifts);
    const pdf = new jsPDF({ orientation: "landscape" });
    pdf.setFontSize(18);
    pdf.text(`Ambulance Worker Shift Logger - ${getMonthLabel(selectedMonth)}`, 14, 16);
    pdf.setFontSize(11);
    pdf.text(
      `Paid: ${formatMinutes(totals.paid)}   Overtime: ${formatMinutes(totals.ot)}   Unsocial: ${formatMinutes(totals.unsocialMinutes)}   Total: £${totals.totalShiftPay.toFixed(2)}`,
      14,
      24,
    );
    autoTable(pdf, {
      startY: 30,
      head: [[...EXPORT_HEADERS]],
      body: pdfRows(shifts),
    });
    pdf.save(`ambulance-worker-shifts-${selectedMonth}.pdf`);
  }

  const bandLabel =
    settings.bandPreset === "band1to3"
      ? "AfC Band 1–3"
      : settings.bandPreset === "band4to9"
        ? "AfC Band 4–9"
        : "Custom";

  return (
    <div className="min-h-screen bg-slate-100 p-4 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-4">
        <HeaderCard title="Ambulance Worker Shift Logger" />

        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowSettings((v) => !v)} style={styles.secondaryButton}>
            {showSettings ? "Hide Settings" : "Show Settings"}
          </button>
        </div>

        {showSettings && (
          <SettingsSection
            settings={settings}
            setSettings={setSettings}
            templates={templates}
            showTemplateEditor={showTemplateEditor}
            setShowTemplateEditor={setShowTemplateEditor}
            addTemplate={addTemplate}
            updateTemplate={updateTemplate}
            removeTemplate={removeTemplate}
          />
        )}

        <Section title="Current Settings" right={<Badge>{bandLabel}</Badge>}>
          <StatsGrid>
            <Stat label="Band" value={bandLabel} />
            <Stat label="Base Rate" value={`£${settings.baseHourlyRate.toFixed(2)}/hr`} />
            <Stat label="Wkday / Sat" value={`${(settings.weekdaySaturdayEnhancement * 100).toFixed(0)}%`} />
            <Stat label="Sun / Holiday" value={`${(settings.sundayHolidayEnhancement * 100).toFixed(0)}%`} />
          </StatsGrid>
        </Section>

        <ShiftFormSection
          editingId={editingId}
          templates={templates}
          applyTemplate={applyTemplate}
          draft={draft}
          setDraft={setDraft}
          worked={worked}
          paid={paid}
          overtime={overtime}
          unsocial={unsocial}
          basicPay={basicPay}
          overtimePay={overtimePay}
          totalShiftPay={totalShiftPay}
          error={error}
          saveShift={saveShift}
          resetForm={() => {
            setDraft(defaultDraft());
            setEditingId(null);
            setError("");
          }}
        />

        <ExportSection
          exportBackup={exportBackup}
          importBackup={importBackup}
          exportPDF={exportPDF}
          exportCSV={exportCSV}
        />

        <ShiftListSection
          shifts={shifts}
          startEdit={startEdit}
          duplicateShiftToTomorrow={duplicateShiftToTomorrow}
          deleteShift={deleteShift}
        />
      </div>
    </div>
  );
}

function HeaderCard({ title }: { title: string }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">{title}</h1>
        <a
          href={GRS_URL}
          target="_blank"
          rel="noopener noreferrer"
          title="Open GRS Dashboard"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 40,
            height: 40,
            borderRadius: 10,
            border: "1px solid #cbd5e1",
            background: "#fff",
            textDecoration: "none",
            color: "#0f172a",
            fontSize: 18,
            fontWeight: 700,
          }}
        >
          🚑
        </a>
      </div>
    </div>
  );
}

function SettingsSection({
  settings,
  setSettings,
  templates,
  showTemplateEditor,
  setShowTemplateEditor,
  addTemplate,
  updateTemplate,
  removeTemplate,
}: {
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  templates: ShiftTemplate[];
  showTemplateEditor: boolean;
  setShowTemplateEditor: React.Dispatch<React.SetStateAction<boolean>>;
  addTemplate: () => void;
  updateTemplate: (id: number, field: keyof ShiftTemplate, value: string | number) => void;
  removeTemplate: (id: number) => void;
}) {
  return (
    <Section title="Settings">
      <div className="mb-4">
        <button style={styles.secondaryButton} onClick={() => setShowTemplateEditor((v) => !v)}>
          {showTemplateEditor ? "Hide Shift Templates" : "Edit Shift Templates"}
        </button>
      </div>

      {showTemplateEditor && (
        <div className="mb-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">Shift Templates</div>
            <button type="button" style={styles.secondaryButtonCompact} onClick={addTemplate}>
              +
            </button>
          </div>
          <div className="grid gap-3">
            {templates.map((template) => (
              <div
                key={template.id}
                className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-3 md:grid-cols-4 xl:grid-cols-5"
              >
                <input
                  value={template.name}
                  onChange={(e) => updateTemplate(template.id, "name", e.target.value)}
                  placeholder="Template name"
                  style={styles.input}
                />
                <input
                  type="time"
                  value={template.start}
                  onChange={(e) => updateTemplate(template.id, "start", e.target.value)}
                  style={styles.input}
                />
                <input
                  type="time"
                  value={template.end}
                  onChange={(e) => updateTemplate(template.id, "end", e.target.value)}
                  style={styles.input}
                />
                <input
                  type="time"
                  value={template.rosteredEnd}
                  onChange={(e) => updateTemplate(template.id, "rosteredEnd", e.target.value)}
                  style={styles.input}
                />
                <button type="button" style={styles.dangerButton} onClick={() => removeTemplate(template.id)}>
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-sm text-slate-600">The app uses values saved in settings. It does not fetch live NHS pay rates.</p>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field label="AfC Band Preset">
          <select
            value={settings.bandPreset}
            onChange={(e) => {
              const value = e.target.value as Settings["bandPreset"];
              if (value === "band1to3") {
                setSettings({
                  ...settings,
                  bandPreset: value,
                  weekdaySaturdayEnhancement: 0.47,
                  sundayHolidayEnhancement: 0.94,
                });
              } else if (value === "band4to9") {
                setSettings({
                  ...settings,
                  bandPreset: value,
                  weekdaySaturdayEnhancement: 0.3,
                  sundayHolidayEnhancement: 0.6,
                });
              } else {
                setSettings((prev) => ({ ...prev, bandPreset: value }));
              }
            }}
            style={styles.input}
          >
            <option value="band1to3">AfC Band 1–3 Preset</option>
            <option value="band4to9">AfC Band 4–9 Preset</option>
            <option value="custom">Custom</option>
          </select>
        </Field>
        <Field label="Base Hourly Rate (£)">
          <input
            type="number"
            step="0.01"
            value={settings.baseHourlyRate}
            onChange={(e) =>
              setSettings((prev) => ({ ...prev, baseHourlyRate: Number(e.target.value) || 0 }))
            }
            style={styles.input}
          />
        </Field>
        <Field label="Weekday / Saturday Enhancement">
          <input
            type="number"
            step="0.01"
            value={settings.weekdaySaturdayEnhancement}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                bandPreset: "custom",
                weekdaySaturdayEnhancement: Number(e.target.value) || 0,
              }))
            }
            style={styles.input}
          />
        </Field>
        <Field label="Sunday / Public Holiday Enhancement">
          <input
            type="number"
            step="0.01"
            value={settings.sundayHolidayEnhancement}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                bandPreset: "custom",
                sundayHolidayEnhancement: Number(e.target.value) || 0,
              }))
            }
            style={styles.input}
          />
        </Field>
      </div>
    </Section>
  );
}

function ShiftFormSection({
  editingId,
  templates,
  applyTemplate,
  draft,
  setDraft,
  worked,
  paid,
  overtime,
  unsocial,
  basicPay,
  overtimePay,
  totalShiftPay,
  error,
  saveShift,
  resetForm,
}: {
  editingId: number | null;
  templates: ShiftTemplate[];
  applyTemplate: (template: ShiftTemplate) => void;
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  worked: number;
  paid: number;
  overtime: number;
  unsocial: UnsocialSummary;
  basicPay: number;
  overtimePay: number;
  totalShiftPay: number;
  error: string;
  saveShift: () => void;
  resetForm: () => void;
}) {
  const jobInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (overtime > 0 && jobInputRef.current) {
      jobInputRef.current.focus();
    }
  }, [overtime]);

  function addOvertimeMinutes(minutes: number) {
    setDraft((current) => {
      const total = (toMinutes(current.end) + minutes) % 1440;
      const hh = String(Math.floor(total / 60)).padStart(2, "0");
      const mm = String(total % 60).padStart(2, "0");
      return { ...current, end: `${hh}:${mm}` };
    });
  }

  return (
    <Section title={editingId ? "Edit Shift" : "Log Shift"} right={<Badge>{editingId ? "Editing" : "New"}</Badge>}>
      <div className="mb-4">
        <div className="mb-2 text-sm font-semibold">Shift Templates</div>
        <div className="grid gap-2 md:grid-cols-3">
          {templates.map((template) => (
            <button
              key={template.id}
              type="button"
              style={styles.secondaryButton}
              onClick={() => applyTemplate(template)}
            >
              {`${template.name} (${template.start}–${template.end})`}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Date">
          <input type="date" value={draft.date} onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} style={styles.input} />
        </Field>
        <Field label="Start">
          <input type="time" value={draft.start} onChange={(e) => setDraft((d) => ({ ...d, start: e.target.value }))} style={styles.input} />
        </Field>
        <Field label="Rostered End">
          <input type="time" value={draft.rosteredEnd} onChange={(e) => setDraft((d) => ({ ...d, rosteredEnd: e.target.value }))} style={styles.input} />
        </Field>
        <Field label="Actual End">
          <input type="time" value={draft.end} onChange={(e) => setDraft((d) => ({ ...d, end: e.target.value }))} style={styles.input} />
        </Field>
        <Field label="Station">
          <input value={draft.station} onChange={(e) => setDraft((d) => ({ ...d, station: e.target.value }))} placeholder="Station" style={styles.input} />
        </Field>
        <Field label="Vehicle Callsign">
          <input value={draft.vehicleCallsign} onChange={(e) => setDraft((d) => ({ ...d, vehicleCallsign: e.target.value }))} placeholder="e.g. H34" style={styles.input} />
        </Field>
        <Field label="Crewmate">
          <input value={draft.crewmate} onChange={(e) => setDraft((d) => ({ ...d, crewmate: e.target.value }))} placeholder="Crewmate name" style={styles.input} />
        </Field>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <button type="button" onClick={() => addOvertimeMinutes(15)} style={styles.secondaryButton}>+15 min OT</button>
        <button type="button" onClick={() => addOvertimeMinutes(30)} style={styles.secondaryButton}>+30 min OT</button>
        <button type="button" onClick={() => addOvertimeMinutes(45)} style={styles.secondaryButton}>+45 min OT</button>
      </div>

      {overtime > 0 && (
        <div className="mt-3">
          <Field label="Job Number for Over-Run" full>
            <input
              ref={jobInputRef}
              value={draft.jobNumber}
              onChange={(e) => setDraft((d) => ({ ...d, jobNumber: e.target.value.replace(/[^0-9]/g, "") }))}
              placeholder="12345678"
              inputMode="numeric"
              style={styles.input}
            />
          </Field>
        </div>
      )}

      <div className="mt-3">
        <button
          type="button"
          onClick={() => setDraft((d) => ({ ...d, mealBreakOffStation: !d.mealBreakOffStation }))}
          style={{
            ...styles.secondaryButton,
            background: draft.mealBreakOffStation ? "#0f172a" : "#fff",
            color: draft.mealBreakOffStation ? "#fff" : "#0f172a",
          }}
        >
          {draft.mealBreakOffStation ? "Meal Break Off Station: YES" : "Meal Break Off Station: NO"}
        </button>
      </div>

      <div className="mt-3 text-sm text-slate-600">Meal break deduction: {formatMinutes(mealBreakMinutes(worked))}</div>

      <StatsGrid small>
        <Stat label="Worked" value={formatMinutes(worked)} />
        <Stat label="Paid" value={formatMinutes(paid)} />
        <Stat label="Overtime" value={formatMinutes(overtime)} />
        <Stat label="Unsocial" value={formatMinutes(unsocial.unsocialWeekdaySaturdayMinutes + unsocial.unsocialSundayHolidayMinutes)} />
        <Stat label="Basic Pay" value={`£${basicPay.toFixed(2)}`} />
        <Stat label="Overtime Pay" value={`£${overtimePay.toFixed(2)}`} />
        <Stat label="Unsocial +" value={`£${unsocial.unsocialEnhancementPay.toFixed(2)}`} />
        <Stat label="Total Shift Pay" value={`£${totalShiftPay.toFixed(2)}`} />
      </StatsGrid>

      {error && <div className="mt-3 text-sm font-semibold text-red-700">{error}</div>}

      <div className="mt-4 grid gap-2 md:grid-cols-2">
        <button type="button" onClick={saveShift} style={styles.primaryButton}>
          {editingId ? "Update Shift" : "Save Shift"}
        </button>
        <button type="button" onClick={resetForm} style={styles.secondaryButton}>Reset</button>
      </div>
    </Section>
  );
}

function ExportSection({
  exportBackup,
  importBackup,
  exportPDF,
  exportCSV,
}: {
  exportBackup: () => void;
  importBackup: (file: File) => Promise<void>;
  exportPDF: () => void;
  exportCSV: () => void;
}) {
  return (
    <Section title="Export Options">
      <div className="mb-4 grid gap-2 md:grid-cols-2">
        <button type="button" onClick={exportBackup} style={styles.secondaryButton}>Export Backup</button>
        <label style={styles.uploadButtonBlock}>
          Import Backup
          <input
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importBackup(file);
              e.currentTarget.value = "";
            }}
          />
        </label>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <button type="button" onClick={exportPDF} style={styles.primaryButton}>Export PDF</button>
        <button type="button" onClick={exportCSV} style={styles.secondaryButton}>Export CSV</button>
      </div>
    </Section>
  );
}

function ShiftListSection({
  shifts,
  startEdit,
  duplicateShiftToTomorrow,
  deleteShift,
}: {
  shifts: Shift[];
  startEdit: (shift: Shift) => void;
  duplicateShiftToTomorrow: (shift: Shift) => void;
  deleteShift: (id: number) => void;
}) {
  return (
    <Section title="Shifts">
      {shifts.length === 0 && <p className="text-sm text-slate-600">No shifts logged yet.</p>}
      <div className="grid gap-3">
        {shifts.map((shift) => (
          <div key={shift.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <strong>{formatDate(shift.date)}</strong>
                <div className="text-sm text-slate-600">{`${shift.start} - ${shift.end}`}</div>
              </div>
              <Badge>{`OT ${formatMinutes(shift.overtimeMinutes)}`}</Badge>
            </div>

            <div className="mb-3 grid gap-2 text-sm md:grid-cols-2 xl:grid-cols-4">
              <div>{`Paid: ${formatMinutes(shift.paidMinutes)}`}</div>
              <div>{`Unsocial: ${formatMinutes(shift.unsocialWeekdaySaturdayMinutes + shift.unsocialSundayHolidayMinutes)}`}</div>
              <div>{`Basic: £${shift.basicPay.toFixed(2)}`}</div>
              <div>{`OT Pay: £${shift.overtimePay.toFixed(2)}`}</div>
              <div>{`Enhancement: £${shift.unsocialEnhancementPay.toFixed(2)}`}</div>
              <div>{`Total: £${shift.totalShiftPay.toFixed(2)}`}</div>
              <div>{`Job: ${shift.jobNumber || "-"}`}</div>
              <div>{`Station: ${shift.station || "-"}`}</div>
              <div>{`Vehicle: ${shift.vehicleCallsign || "-"}`}</div>
              <div>{`Crewmate: ${shift.crewmate || "-"}`}</div>
              <div>{`Meal break off station: ${shift.mealBreakOffStation ? "Yes" : "No"}`}</div>
            </div>

            <div className="grid gap-2 md:grid-cols-3">
              <button type="button" onClick={() => startEdit(shift)} style={styles.secondaryButton}>Edit</button>
              <button type="button" onClick={() => duplicateShiftToTomorrow(shift)} style={styles.secondaryButton}>Duplicate Tomorrow</button>
              <button type="button" onClick={() => deleteShift(shift.id)} style={styles.dangerButton}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-2xl font-bold">{title}</h2>
        {right}
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <label
      className={
        full
          ? "flex flex-col gap-1.5 text-sm font-semibold md:col-span-2 xl:col-span-4"
          : "flex flex-col gap-1.5 text-sm font-semibold"
      }
    >
      <span>{label}</span>
      {children}
    </label>
  );
}

function Stat({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
      <div className="font-semibold">{label}</div>
      <div className={strong ? "text-lg font-bold" : ""}>{value}</div>
    </div>
  );
}

function StatsGrid({
  children,
  small,
}: {
  children: React.ReactNode;
  small?: boolean;
}) {
  return (
    <div className={small ? "mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4" : "grid gap-3 md:grid-cols-2 xl:grid-cols-4"}>
      {children}
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="whitespace-nowrap rounded-full bg-slate-200 px-3 py-1 text-xs">{children}</span>;
}
