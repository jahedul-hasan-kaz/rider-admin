"use client";

import type { Route } from "next";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useId, useState, type ReactNode } from "react";
import { BellPlus, Car, CarFront, Eye, FileUp, Pencil, Plus, Trash2, UserPlus } from "lucide-react";
import { useCan } from "@/components/permissions-provider";
import { Autocomplete, type SearchOption } from "@/components/domain/autocomplete";
import { DocumentViewer } from "@/components/domain/document-viewer";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ReasonDialog } from "@/components/domain/reason-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DOCUMENT_TYPES } from "@/lib/schemas/api";
import type { ActionResult } from "@/server/actions/run";
import {
  assignDriver,
  bookRide,
  cancelRequest,
  confirmCash,
  createAccount,
  createAlert,
  deleteAccount,
  resolveAlert,
  retireVehicle,
  saveVehicle,
  updateContact,
  updateDocument,
  updateRefund,
  updateRequest,
  withdrawDocument,
  type PickedPerson,
} from "@/server/actions/crud";

// Staff create / update / delete dialogs. Every one is a ReasonDialog: a required reason, the server's own validation
// messages, and nothing happens in one click. "Delete" always means a reversible or history-keeping step.

type Ref = { id: string; name: string };

function TextField({ label, value, onChange, hint, ...rest }: { label: string; value: string; onChange: (v: string) => void; hint?: ReactNode } & Omit<React.ComponentProps<typeof Input>, "value" | "onChange">) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />
      {hint ? <FieldDescription>{hint}</FieldDescription> : null}
    </Field>
  );
}

function SelectField({ label, value, onChange, options, placeholder }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string }) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/** A labelled server-side autocomplete (zones, vehicle types). */
function SearchField({ label, value, onChange, source, selectedLabel, placeholder }: { label: string; value: string; onChange: (v: string) => void; source: "zones" | "categories"; selectedLabel?: string; placeholder?: string }) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Autocomplete id={id} source={source} value={value} selectedLabel={selectedLabel} placeholder={placeholder} onChange={(v) => onChange(v)} />
    </Field>
  );
}

/** Search-as-you-type picker for passengers or drivers (names and masked phones only). */
function PersonPicker({ role, value, onChange, label }: { role: "passenger" | "driver"; value: PickedPerson | null; onChange: (p: PickedPerson | null) => void; label: string }) {
  const t = useTranslations("crud");
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Autocomplete
        id={id}
        source={role === "passenger" ? "passengers" : "drivers"}
        value={value?.id ?? ""}
        selectedLabel={value?.name}
        placeholder={t("searchPeople")}
        onChange={(_, o: SearchOption | null) => onChange(o ? { id: o.value, name: o.label, phone: o.hint ?? null } : null)}
      />
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------
export function NewAccountButton({ role, zones = [] }: { role: "passenger" | "driver"; zones?: Ref[] }) {
  const t = useTranslations("crud");
  const can = useCan();
  const router = useRouter();
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", password: "", homeZoneId: "" });
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  if (!can(role === "driver" ? "drivers.create" : "passengers.create")) return null;
  return (
    <ReasonDialog
      trigger={
        <Button>
          <UserPlus className="size-4" />
          {role === "driver" ? t("newDriver") : t("newPassenger")}
        </Button>
      }
      title={role === "driver" ? t("newDriver") : t("newPassenger")}
      description={role === "driver" ? t("newDriverBody") : t("newPassengerBody")}
      confirmLabel={t("create")}
      presets={[t("presetPhoneSignup"), t("presetOfficeSignup")]}
      successMessage={t("created")}
      onConfirm={(reason) => createAccount({ role, ...form, homeZoneId: form.homeZoneId || null, reason })}
      onSuccess={() => {
        setForm({ fullName: "", email: "", phone: "", password: "", homeZoneId: "" });
        router.refresh();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={t("fullName")} value={form.fullName} onChange={set("fullName")} required maxLength={100} />
        <TextField label={t("email")} type="email" value={form.email} onChange={set("email")} required />
        <TextField label={t("phone")} value={form.phone} onChange={set("phone")} placeholder="+8801712345678" />
        <TextField label={t("password")} type="password" value={form.password} onChange={set("password")} autoComplete="new-password" hint={t("passwordHint")} />
        {role === "driver" ? (
          <SearchField label={t("homeZone")} source="zones" value={form.homeZoneId} onChange={set("homeZoneId")} selectedLabel={zones.find((z) => z.id === form.homeZoneId)?.name} placeholder={t("optional")} />
        ) : null}
      </div>
    </ReasonDialog>
  );
}

export function EditContactButton({ profileId, role, name }: { profileId: string; role: "passenger" | "driver"; name: string }) {
  const t = useTranslations("crud");
  const can = useCan();
  const router = useRouter();
  const [fullName, setFullName] = useState(name);
  const [phone, setPhone] = useState("");
  if (!can(role === "driver" ? "drivers.update" : "passengers.update")) return null;
  return (
    <ReasonDialog
      trigger={
        <Button variant="outline">
          <Pencil className="size-4" />
          {t("editContact")}
        </Button>
      }
      title={t("editContactTitle", { name })}
      description={t("editContactBody")}
      confirmLabel={t("save")}
      presets={[t("presetAskedByPhone"), t("presetTypo")]}
      successMessage={t("saved")}
      onConfirm={(reason) => updateContact({ profileId, fullName, phone, reason })}
      onSuccess={() => router.refresh()}
    >
      <TextField label={t("fullName")} value={fullName} onChange={setFullName} required maxLength={100} />
      <TextField label={t("newPhone")} value={phone} onChange={setPhone} placeholder="+8801712345678" hint={t("newPhoneHint")} />
    </ReasonDialog>
  );
}

export function DeleteAccountButton({ profileId, role, name, status }: { profileId: string; role: "passenger" | "driver"; name: string; status: string }) {
  const t = useTranslations("crud");
  const can = useCan();
  const router = useRouter();
  if (status === "deactivated" || !can(role === "driver" ? "drivers.delete" : "passengers.delete")) return null;
  return (
    <ReasonDialog
      trigger={
        <Button variant="outline" className="text-destructive">
          <Trash2 className="size-4" />
          {t("deleteAccount")}
        </Button>
      }
      title={t("deleteAccountTitle", { name })}
      description={t("deleteAccountBody")}
      confirmLabel={t("deleteAccount")}
      destructive
      confirmWord="DELETE"
      presets={[t("presetCustomerAsked"), t("presetDuplicate"), t("presetFake")]}
      successMessage={t("deleted")}
      onConfirm={(reason) => deleteAccount({ profileId, reason })}
      onSuccess={() => router.refresh()}
    />
  );
}

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------
type VehicleValues = { id: string; category: { id: string }; make: string; model: string; color: string; registration_number: string; year: number };

export function VehicleFormButton({ driverId, vehicle, categories }: { driverId?: string; vehicle?: VehicleValues; categories: Ref[] }) {
  const t = useTranslations("crud");
  const can = useCan();
  const router = useRouter();
  const initial = {
    categoryId: vehicle?.category.id ?? "",
    make: vehicle?.make ?? "",
    model: vehicle?.model ?? "",
    color: vehicle?.color ?? "",
    registrationNumber: vehicle?.registration_number ?? "",
    year: String(vehicle?.year ?? new Date().getFullYear()),
  };
  const [form, setForm] = useState(initial);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  if (!can("vehicles.manage")) return null;
  return (
    <ReasonDialog
      trigger={
        <Button variant={vehicle ? "outline" : "default"}>
          {vehicle ? <Pencil className="size-4" /> : <CarFront className="size-4" />}
          {vehicle ? t("editVehicle") : t("addVehicle")}
        </Button>
      }
      title={vehicle ? t("editVehicle") : t("addVehicle")}
      description={vehicle ? t("editVehicleBody") : t("addVehicleBody")}
      confirmLabel={t("save")}
      presets={vehicle ? [t("presetTypo"), t("presetRepainted")] : [t("presetOfficeSignup")]}
      successMessage={t("saved")}
      onConfirm={(reason) => saveVehicle({ id: vehicle?.id ?? null, driverId: vehicle ? null : (driverId ?? null), ...form, reason })}
      onSuccess={() => {
        if (!vehicle) setForm(initial);
        router.refresh();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <SearchField label={t("category")} source="categories" value={form.categoryId} onChange={set("categoryId")} selectedLabel={categories.find((c) => c.id === form.categoryId)?.name} />
        <TextField label={t("registration")} value={form.registrationNumber} onChange={set("registrationNumber")} required maxLength={20} />
        <TextField label={t("make")} value={form.make} onChange={set("make")} required maxLength={40} />
        <TextField label={t("model")} value={form.model} onChange={set("model")} required maxLength={40} />
        <TextField label={t("color")} value={form.color} onChange={set("color")} required maxLength={30} />
        <TextField label={t("year")} type="number" value={form.year} onChange={set("year")} required min={1990} />
      </div>
    </ReasonDialog>
  );
}

export function RetireVehicleButton({ vehicleId, status }: { vehicleId: string; status: string }) {
  const t = useTranslations("crud");
  const can = useCan();
  const router = useRouter();
  if (status === "inactive" || !can("vehicles.manage")) return null;
  return (
    <ReasonDialog
      trigger={
        <Button variant="outline" className="text-destructive">
          <Trash2 className="size-4" />
          {t("retireVehicle")}
        </Button>
      }
      title={t("retireVehicle")}
      description={t("retireVehicleBody")}
      confirmLabel={t("retireVehicle")}
      destructive
      presets={[t("presetSold"), t("presetDuplicate")]}
      successMessage={t("retired")}
      onConfirm={(reason) => retireVehicle({ vehicleId, reason })}
      onSuccess={() => router.refresh()}
    />
  );
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_UPLOAD = 10 * 1024 * 1024;
export function UploadDocumentButton({ driverId, vehicles }: { driverId: string; vehicles: { id: string; registration_number: string }[] }) {
  const t = useTranslations("crud");
  const tDoc = useTranslations("documentTypes");
  const fieldId = useId();
  const can = useCan();
  const router = useRouter();
  const [form, setForm] = useState({ documentType: "", vehicleId: "", documentNumber: "", issuedAt: "", expiresAt: "" });
  const [file, setFile] = useState<File | null>(null);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const vehicleDoc = ["vehicle_registration", "fitness_certificate", "tax_token", "insurance", "route_permit"].includes(form.documentType);
  if (!can("documents.manage")) return null;

  const fail = (path: string, message: string): ActionResult<unknown> => ({
    ok: false,
    error: { code: "VALIDATION_FAILED", message, details: { fields: [{ path, message }] } },
  });

  async function submit(reason: string): Promise<ActionResult<unknown>> {
    // Check what we can before sending, so a wrong file is caught at once.
    if (!form.documentType) return fail("documentType", t("chooseDocumentType"));
    if (vehicleDoc && !form.vehicleId) return fail("vehicleId", t("chooseVehicle"));
    if (!file) return fail("file", t("chooseFile"));
    if (!ACCEPTED_TYPES.includes(file.type)) return fail("file", t("fileWrongType"));
    if (file.size > MAX_UPLOAD) return fail("file", t("fileTooBig"));

    const body = new FormData();
    Object.entries({ ...form, vehicleId: vehicleDoc ? form.vehicleId : "", driverId, reason }).forEach(([k, v]) => body.set(k, v));
    body.set("file", file);
    try {
      const res = await fetch("/api/admin/documents", { method: "POST", body });
      const json = (await res.json().catch(() => null)) as ActionResult<unknown> | null;
      if (json) return json;
      // Not JSON: the session ended (sign-in page) or the server failed before answering.
      return { ok: false, error: { code: res.status === 401 ? "UNAUTHENTICATED" : "INTERNAL", message: "", details: {} } };
    } catch {
      return { ok: false, error: { code: "UPSTREAM_UNAVAILABLE", message: "", details: {} } };
    }
  }

  return (
    <ReasonDialog
      trigger={
        <Button variant="outline">
          <FileUp className="size-4" />
          {t("uploadDocument")}
        </Button>
      }
      title={t("uploadDocument")}
      description={t("uploadDocumentBody")}
      confirmLabel={t("upload")}
      presets={[t("presetScannedAtOffice")]}
      successMessage={t("uploaded")}
      onConfirm={submit}
      onSuccess={() => {
        setFile(null);
        router.refresh();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${fieldId}-type`}>{t("documentType")}</FieldLabel>
          <Autocomplete id={`${fieldId}-type`} value={form.documentType} onChange={set("documentType")} options={DOCUMENT_TYPES.map((d) => ({ value: d, label: tDoc(d) }))} />
        </Field>
        {vehicleDoc ? (
          <SelectField label={t("vehicle")} value={form.vehicleId} onChange={set("vehicleId")} options={vehicles.map((v) => ({ value: v.id, label: v.registration_number }))} />
        ) : null}
        <TextField label={t("documentNumber")} value={form.documentNumber} onChange={set("documentNumber")} maxLength={40} />
        <TextField label={t("issuedAt")} type="date" value={form.issuedAt} onChange={set("issuedAt")} />
        <TextField label={t("expiresAt")} type="date" value={form.expiresAt} onChange={set("expiresAt")} />
        <Field>
          <FieldLabel htmlFor={`${fieldId}-file`}>{t("file")}</FieldLabel>
          <Input id={`${fieldId}-file`} type="file" accept={ACCEPTED_TYPES.join(",")} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <FieldDescription>
            {file ? t("fileChosen", { name: file.name, size: Math.max(1, Math.round(file.size / 1024)) }) : t("fileHint")}
          </FieldDescription>
        </Field>
      </div>
    </ReasonDialog>
  );
}

/** Opens an uploaded document in a drawer (60-second signed link; every open is logged). Needs documents.view. */
export function DocumentViewButton({ documentId, title, description }: { documentId: string; title: string; description?: string }) {
  const t = useTranslations("crud");
  const can = useCan();
  const [open, setOpen] = useState(false);
  if (!can("documents.view")) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7" aria-label={t("viewDocument")} title={t("viewDocument")}>
          <Eye className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description ?? t("viewDocumentBody")}</DialogDescription>
        </DialogHeader>
        <DialogBody className="p-0! sm:p-0!">
          {/* Mounted only while open, so the signed link (and the access log entry) is made on demand. */}
          {open ? <DocumentViewer documentId={documentId} className="flex min-h-full flex-col" /> : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

export function DocumentRowActions({ documentId, issuedAt, expiresAt }: { documentId: string; issuedAt: string | null; expiresAt: string | null }) {
  const t = useTranslations("crud");
  const can = useCan();
  const router = useRouter();
  const [dates, setDates] = useState({ issuedAt: issuedAt?.slice(0, 10) ?? "", expiresAt: expiresAt?.slice(0, 10) ?? "" });
  if (!can("documents.manage")) return null;
  return (
    <div className="flex gap-1">
      <ReasonDialog
        trigger={
          <Button variant="ghost" size="icon" className="size-7" aria-label={t("editDates")}>
            <Pencil className="size-3.5" />
          </Button>
        }
        title={t("editDates")}
        description={t("editDatesBody")}
        confirmLabel={t("save")}
        presets={[t("presetTypo")]}
        successMessage={t("saved")}
        onConfirm={(reason) => updateDocument({ documentId, ...dates, reason })}
        onSuccess={() => router.refresh()}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label={t("issuedAt")} type="date" value={dates.issuedAt} onChange={(v) => setDates((d) => ({ ...d, issuedAt: v }))} />
          <TextField label={t("expiresAt")} type="date" value={dates.expiresAt} onChange={(v) => setDates((d) => ({ ...d, expiresAt: v }))} />
        </div>
      </ReasonDialog>
      <ReasonDialog
        trigger={
          <Button variant="ghost" size="icon" className="size-7 text-destructive" aria-label={t("withdrawDocument")}>
            <Trash2 className="size-3.5" />
          </Button>
        }
        title={t("withdrawDocument")}
        description={t("withdrawDocumentBody")}
        confirmLabel={t("withdrawDocument")}
        destructive
        presets={[t("presetWrongFile")]}
        successMessage={t("withdrawn")}
        onConfirm={(reason) => withdrawDocument({ documentId, reason })}
        onSuccess={() => router.refresh()}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ride requests and trips
// ---------------------------------------------------------------------------
export function BookRideButton({ categories, passenger }: { categories: Ref[]; passenger?: Ref }) {
  const t = useTranslations("crud");
  const can = useCan();
  const router = useRouter();
  const blank = { categoryId: "", pickupLat: "", pickupLng: "", pickupLabel: "", destLat: "", destLng: "", destLabel: "", pickupNote: "" };
  const [form, setForm] = useState(blank);
  const [person, setPerson] = useState<PickedPerson | null>(passenger ? { id: passenger.id, name: passenger.name, phone: null } : null);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  // Accept "23.78, 90.41" pasted from any map into the latitude box.
  const coord = (lat: keyof typeof form, lng: keyof typeof form) => (v: string) => {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(v);
    if (m) setForm((f) => ({ ...f, [lat]: m[1], [lng]: m[2] }));
    else set(lat)(v);
  };
  if (!can("trips.create")) return null;
  return (
    <ReasonDialog
      trigger={
        <Button>
          <Car className="size-4" />
          {t("bookRide")}
        </Button>
      }
      title={t("bookRide")}
      description={t("bookRideBody")}
      confirmLabel={t("book")}
      presets={[t("presetPhoneBooking"), t("presetAppIssue")]}
      successMessage={t("booked")}
      onConfirm={(reason) =>
        person
          ? bookRide({
              passengerId: person.id,
              categoryId: form.categoryId,
              pickup: { lat: form.pickupLat, lng: form.pickupLng, label: form.pickupLabel },
              destination: { lat: form.destLat, lng: form.destLng, label: form.destLabel },
              paymentMethod: "cash",
              pickupNote: form.pickupNote,
              reason,
            })
          : Promise.resolve({ ok: false as const, error: { code: "VALIDATION_FAILED" as const, message: "", details: { fields: [{ path: "passengerId", message: t("choosePassenger") }] } } })
      }
      onSuccess={() => {
        setForm(blank);
        router.push("/requests" as Route);
        router.refresh();
      }}
    >
      <PersonPicker role="passenger" label={t("passenger")} value={person} onChange={setPerson} />
      <SearchField label={t("category")} source="categories" value={form.categoryId} onChange={set("categoryId")} selectedLabel={categories.find((c) => c.id === form.categoryId)?.name} />
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label={t("pickupLat")} value={form.pickupLat} onChange={coord("pickupLat", "pickupLng")} inputMode="decimal" placeholder="23.7806" required />
        <TextField label={t("pickupLng")} value={form.pickupLng} onChange={set("pickupLng")} inputMode="decimal" placeholder="90.4074" required />
        <TextField label={t("pickupLabel")} value={form.pickupLabel} onChange={set("pickupLabel")} maxLength={200} />
        <TextField label={t("destLat")} value={form.destLat} onChange={coord("destLat", "destLng")} inputMode="decimal" placeholder="23.7925" required />
        <TextField label={t("destLng")} value={form.destLng} onChange={set("destLng")} inputMode="decimal" placeholder="90.4078" required />
        <TextField label={t("destLabel")} value={form.destLabel} onChange={set("destLabel")} maxLength={200} />
      </div>
      <p className="text-xs text-muted-foreground">{t("coordHint")}</p>
      <TextField label={t("pickupNote")} value={form.pickupNote} onChange={set("pickupNote")} maxLength={200} />
    </ReasonDialog>
  );
}

export function RequestCrudActions({ request }: { request: { id: string; status: string; pickup_note: string | null } }) {
  const t = useTranslations("crud");
  const can = useCan();
  const router = useRouter();
  const [note, setNote] = useState(request.pickup_note ?? "");
  const [driver, setDriver] = useState<PickedPerson | null>(null);
  const open = request.status === "requested" || request.status === "searching";
  return (
    <>
      {open && can("dispatch.intervene") ? (
        <ReasonDialog
          trigger={
            <Button variant="outline">
              <Pencil className="size-4" />
              {t("editNote")}
            </Button>
          }
          title={t("editNote")}
          description={t("editNoteBody")}
          confirmLabel={t("save")}
          presets={[t("presetAskedByPhone")]}
          successMessage={t("saved")}
          onConfirm={(reason) => updateRequest({ requestId: request.id, pickupNote: note, reason })}
          onSuccess={() => router.refresh()}
        >
          <Field>
            <FieldLabel>{t("pickupNote")}</FieldLabel>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} rows={2} />
          </Field>
        </ReasonDialog>
      ) : null}
      {request.status === "searching" && can("trips.create") && can("dispatch.intervene") ? (
        <ReasonDialog
          trigger={
            <Button variant="outline">
              <Plus className="size-4" />
              {t("assignDriver")}
            </Button>
          }
          title={t("assignDriver")}
          description={t("assignDriverBody")}
          confirmLabel={t("assign")}
          presets={[t("presetNearestDriver"), t("presetDriverCalled")]}
          successMessage={t("assigned")}
          onConfirm={(reason) =>
            driver
              ? assignDriver({ requestId: request.id, driverId: driver.id, reason })
              : Promise.resolve({ ok: false as const, error: { code: "VALIDATION_FAILED" as const, message: "", details: { fields: [{ path: "driverId", message: t("chooseDriver") }] } } })
          }
          onSuccess={() => router.refresh()}
        >
          <PersonPicker role="driver" label={t("driver")} value={driver} onChange={setDriver} />
        </ReasonDialog>
      ) : null}
      {(open || request.status === "matched") && can("trips.cancel") ? (
        <ReasonDialog
          trigger={
            <Button variant="outline" className="text-destructive">
              <Trash2 className="size-4" />
              {t("cancelRequest")}
            </Button>
          }
          title={t("cancelRequest")}
          description={request.status === "matched" ? t("cancelMatchedBody") : t("cancelRequestBody")}
          confirmLabel={t("cancelRequest")}
          destructive
          presets={[t("presetCustomerAsked"), t("presetDuplicate")]}
          successMessage={t("cancelled")}
          onConfirm={(reason) => cancelRequest({ requestId: request.id, reason })}
          onSuccess={() => router.refresh()}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------
export function NewAlertButton() {
  const t = useTranslations("crud");
  const can = useCan();
  const router = useRouter();
  const [form, setForm] = useState({ severity: "warning", title: "", detail: "" });
  if (!can("alerts.manage")) return null;
  return (
    <ReasonDialog
      trigger={
        <Button>
          <BellPlus className="size-4" />
          {t("newAlert")}
        </Button>
      }
      title={t("newAlert")}
      description={t("newAlertBody")}
      confirmLabel={t("raise")}
      successMessage={t("raised")}
      onConfirm={(reason) => createAlert({ ...form, severity: form.severity as "info" | "warning" | "critical", reason })}
      onSuccess={() => {
        setForm({ severity: "warning", title: "", detail: "" });
        router.refresh();
      }}
    >
      <SelectField
        label={t("severity")}
        value={form.severity}
        onChange={(v) => setForm((f) => ({ ...f, severity: v }))}
        options={["info", "warning", "critical"].map((s) => ({ value: s, label: t(`severity_${s}`) }))}
      />
      <TextField label={t("alertTitle")} value={form.title} onChange={(v) => setForm((f) => ({ ...f, title: v }))} required maxLength={200} />
      <Field>
        <FieldLabel>{t("alertDetail")}</FieldLabel>
        <Textarea value={form.detail} onChange={(e) => setForm((f) => ({ ...f, detail: e.target.value }))} maxLength={2000} rows={3} />
      </Field>
    </ReasonDialog>
  );
}

export function ResolveAlertButton({ id }: { id: string }) {
  const t = useTranslations("crud");
  const can = useCan();
  const router = useRouter();
  if (!can("alerts.manage")) return null;
  return (
    <ReasonDialog
      trigger={
        <Button variant="outline" size="sm">
          {t("resolve")}
        </Button>
      }
      title={t("resolveAlert")}
      description={t("resolveAlertBody")}
      confirmLabel={t("resolve")}
      presets={[t("presetFixed"), t("presetFalseAlarm")]}
      successMessage={t("resolved")}
      onConfirm={(reason) => resolveAlert({ id, reason })}
      onSuccess={() => router.refresh()}
    />
  );
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------
export function ConfirmCashButton({ tripId, amount }: { tripId: string; amount: number }) {
  const t = useTranslations("crud");
  const can = useCan();
  const router = useRouter();
  const [value, setValue] = useState(String(amount));
  if (!can("payments.reconcile")) return null;
  return (
    <ReasonDialog
      trigger={
        <Button variant="outline" size="sm">
          {t("confirmCash")}
        </Button>
      }
      title={t("confirmCash")}
      description={t("confirmCashBody")}
      confirmLabel={t("confirmCash")}
      presets={[t("presetDriverConfirmedByPhone")]}
      successMessage={t("saved")}
      onConfirm={(reason) => confirmCash({ tripId, amount: value, reason })}
      onSuccess={() => router.refresh()}
    >
      <TextField label={t("amountCollected")} type="number" min={0} step="0.01" value={value} onChange={setValue} required />
    </ReasonDialog>
  );
}

export function EditRefundButton({ id, amount }: { id: string; amount: number }) {
  const t = useTranslations("crud");
  const router = useRouter();
  const [value, setValue] = useState(String(amount));
  return (
    <ReasonDialog
      trigger={
        <Button variant="ghost" size="sm">
          <Pencil className="size-3.5" />
          {t("edit")}
        </Button>
      }
      title={t("editRefund")}
      description={t("editRefundBody")}
      confirmLabel={t("save")}
      successMessage={t("saved")}
      onConfirm={(reason) => updateRefund({ id, amount: value, reason })}
      onSuccess={() => router.refresh()}
    >
      <TextField label={t("amount")} type="number" min={0.01} step="0.01" value={value} onChange={setValue} required />
    </ReasonDialog>
  );
}
