"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Award,
  Bell,
  Calendar,
  CheckCircle,
  Download,
  Edit3,
  Gavel,
  Lock,
  LogOut,
  Mail,
  Phone,
  Trophy,
  Users,
  X,
} from "lucide-react";

import { NominationModule } from "./nomination-module";
import { NominationsAdminPanel } from "./nominations-admin-panel";
import { PremiumCard } from "./premium-card";
import { SuperUserPanel } from "./super-user-panel";
import type { PortalNomination, RegistryMember } from "./types";
import { COMMITTEES, COMMITTEE_SEATS } from "@/lib/election";

const ID_OFFSET = 5100;
const ID_YEAR = "2026";

function makeObfuscatedB2cId(seed: number): string {
  const token = seed.toString(36).toUpperCase().padStart(6, "0");
  return `B2C-${ID_YEAR}-${token}`;
}

type ApiUser = {
  lastName: string;
  firstName: string;
  b2cId: string;
  role: string;
  tinNo: string;
  dob: string;
  mobile?: string | null;
  email?: string | null;
  registeredAt: string | null;
};

function mapApiUserToRegistry(u: ApiUser): RegistryMember {
  const dob =
    typeof u.dob === "string" && u.dob.includes("T")
      ? u.dob.slice(0, 10)
      : String(u.dob).slice(0, 10);
  const ts = u.registeredAt
    ? new Date(u.registeredAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
    : "";
  return {
    lastName: u.lastName.toUpperCase(),
    firstName: u.firstName,
    city: "",
    timestamp: ts,
    role: u.role,
    tinNo: u.tinNo.replace(/\D/g, ""),
    dob,
    b2cId: u.b2cId,
  };
}

type ActiveMember = RegistryMember & {
  b2cId: string;
  password?: string;
  mobile?: string;
  email?: string;
};

const PORTAL_SESSION_KEY = "b2c_portal_active_member";

type ApiNominationRow = {
  id: string;
  nomineeName: string;
  position: string;
  nominatorId: string;
  nomineeB2cId: string | null;
  status: "pending" | "accepted";
};

function mapApiNominationToPortal(row: ApiNominationRow): PortalNomination {
  return {
    id: row.id,
    nomineeId: row.nomineeB2cId ?? "",
    name: row.nomineeName,
    position: row.position,
    nomineeB2cId: row.nomineeB2cId ?? undefined,
    status: row.status,
  };
}

type GovernanceLogEntry = {
  time: string;
  user: string;
  action: string;
  details: string;
};

type PortalFlags = {
  canViewRegistry: boolean;
  canManageAdmins: boolean;
  canUseElectionCommitteeControls: boolean;
  displayRole: string;
  officerTitle: string | null;
  officerPositions?: {
    id: string;
    slug: string;
    title: string;
    category: string;
    grantsPortalAdmin: boolean;
    maxAssignees: number | null;
  }[];
};

type ElectionConfigApi = {
  status: string;
  lockedPositions: string[];
};

type ElectionResultsApi = Record<
  "byCommittee",
  Record<
    string,
    {
      seats: number;
      candidates: { nominationId: string; nomineeName: string; votes: number }[];
      winners: { nominationId: string; nomineeName: string; votes: number }[];
    }
  >
> & {
  declaredAt: string | null;
};

export function ElectionPortalApp() {
  const router = useRouter();
  const [step, setStep] = useState("auth");
  const [activeMember, setActiveMember] = useState<ActiveMember | null>(null);
  const [isReturning, setIsReturning] = useState(false);
  const [authError, setAuthError] = useState("");

  const [electionStatus, setElectionStatus] = useState("nomination");
  const [lockedPositions, setLockedPositions] = useState<string[]>([]);
  const [nominations, setNominations] = useState<PortalNomination[]>([]);
  const [motions, setMotions] = useState<Record<string, { stage: string; moverId: string | null }>>({});
  const [voteTallies, setVoteTallies] = useState<Record<string, number>>({});
  const [ballot, setBallot] = useState<Record<string, string[]>>({
    "Board of Director": [],
    "Audit Committee": [],
    "Election Committee": [],
  });
  const [governanceLog, setGovernanceLog] = useState<GovernanceLogEntry[]>([]);

  const [localRegistry, setLocalRegistry] = useState<Record<string, ActiveMember>>({});
  const [masterRegistry, setMasterRegistry] = useState<RegistryMember[]>([]);
  const [registryLoading, setRegistryLoading] = useState(true);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [portalFlags, setPortalFlags] = useState<PortalFlags | null>(null);
  const [showAdminTools, setShowAdminTools] = useState(false);
  const [resultsDeclaredAt, setResultsDeclaredAt] = useState<string | null>(null);
  const [profileDob, setProfileDob] = useState("");
  const [profileMobile, setProfileMobile] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileError, setProfileError] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [nominationNotice, setNominationNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!nominationNotice) return;
    const t = window.setTimeout(() => setNominationNotice(null), 6000);
    return () => window.clearTimeout(t);
  }, [nominationNotice]);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(PORTAL_SESSION_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<ActiveMember>;
      if (
        typeof parsed.b2cId === "string" &&
        typeof parsed.firstName === "string" &&
        typeof parsed.lastName === "string"
      ) {
        setActiveMember(parsed as ActiveMember);
        setStep("dashboard");
        setIsReturning(true);
      }
    } catch {
      // Ignore malformed/empty session payload.
    }
  }, []);

  useEffect(() => {
    try {
      if (!activeMember) {
        window.sessionStorage.removeItem(PORTAL_SESSION_KEY);
        return;
      }
      window.sessionStorage.setItem(PORTAL_SESSION_KEY, JSON.stringify(activeMember));
    } catch {
      // Ignore storage errors (private mode, quota).
    }
  }, [activeMember]);

  const applyResultsToTallies = useCallback((results: ElectionResultsApi | null | undefined) => {
    if (!results) return;
    const byCommittee = results.byCommittee ?? {};
    const tallies: Record<string, number> = {};
    for (const committee of COMMITTEES) {
      const rows = byCommittee[committee]?.candidates ?? [];
      for (const row of rows) tallies[row.nominationId] = row.votes;
    }
    setVoteTallies(tallies);
    setResultsDeclaredAt(results.declaredAt ?? null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [usersRes, nomsRes, configRes, resultsRes] = await Promise.all([
          fetch("/api/users"),
          fetch("/api/nominations"),
          fetch("/api/election/config"),
          fetch("/api/election/results"),
        ]);
        const usersJson = await usersRes.json();
        const nomsJson = await nomsRes.json();
        const configJson = await configRes.json();
        const resultsJson = await resultsRes.json();

        if (cancelled) return;

        if (usersJson.ok && Array.isArray(usersJson.data)) {
          const mapped: RegistryMember[] = (usersJson.data as ApiUser[]).map(mapApiUserToRegistry);
          mapped.sort((a, b) => a.lastName.localeCompare(b.lastName));
          setMasterRegistry(mapped);
          setRegistryError(null);
        } else {
          setRegistryError("Could not load member registry.");
          setMasterRegistry([]);
        }

        if (nomsJson.ok && Array.isArray(nomsJson.data)) {
          setNominations((nomsJson.data as ApiNominationRow[]).map(mapApiNominationToPortal));
        }
        if (configJson.ok && configJson.data) {
          const cfg = configJson.data as ElectionConfigApi;
          setElectionStatus(cfg.status);
          setLockedPositions(Array.isArray(cfg.lockedPositions) ? cfg.lockedPositions : []);
        }
        if (resultsJson.ok && resultsJson.data) {
          applyResultsToTallies(resultsJson.data as ElectionResultsApi);
        }
      } catch {
        if (!cancelled) {
          setRegistryError("Failed to load registry. Check your connection and try again.");
          setMasterRegistry([]);
        }
      } finally {
        if (!cancelled) setRegistryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyResultsToTallies]);

  useEffect(() => {
    if (!activeMember) {
      setPortalFlags(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/portal/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          b2cId: activeMember.b2cId,
          password: activeMember.password ?? "",
        }),
      });
      const json = await res.json();
      if (!cancelled && json.ok && json.data) {
        setPortalFlags(json.data as PortalFlags);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeMember]);

  useEffect(() => {
    if (step !== "profile" || !activeMember) return;
    setProfileDob(activeMember.dob ?? "");
    setProfileMobile(activeMember.mobile ?? "");
    setProfileEmail(activeMember.email ?? "");
    setProfileError("");
  }, [step, activeMember]);

  const reloadRegistry = useCallback(async () => {
    try {
      const [usersRes, nomsRes] = await Promise.all([fetch("/api/users"), fetch("/api/nominations")]);
      const usersJson = await usersRes.json();
      const nomsJson = await nomsRes.json();
      if (usersJson.ok && Array.isArray(usersJson.data)) {
        const mapped: RegistryMember[] = (usersJson.data as ApiUser[]).map(mapApiUserToRegistry);
        mapped.sort((a, b) => a.lastName.localeCompare(b.lastName));
        setMasterRegistry(mapped);
      }
      if (nomsJson.ok && Array.isArray(nomsJson.data)) {
        setNominations((nomsJson.data as ApiNominationRow[]).map(mapApiNominationToPortal));
      }
    } catch {
      // Non-blocking refresh; UI already has error surfaces for initial load.
    }
  }, []);

  const refreshElectionServerData = useCallback(async () => {
    try {
      const [configRes, resultsRes] = await Promise.all([
        fetch("/api/election/config"),
        fetch("/api/election/results"),
      ]);
      const configJson = await configRes.json();
      const resultsJson = await resultsRes.json();
      if (configJson.ok && configJson.data) {
        const cfg = configJson.data as ElectionConfigApi;
        setElectionStatus(cfg.status);
        setLockedPositions(Array.isArray(cfg.lockedPositions) ? cfg.lockedPositions : []);
      }
      if (resultsJson.ok && resultsJson.data) {
        applyResultsToTallies(resultsJson.data as ElectionResultsApi);
      }
    } catch {
      // Non-blocking refresh path.
    }
  }, [applyResultsToTallies]);

  const addLog = useCallback((action: string, details: string) => {
    const entry: GovernanceLogEntry = {
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      user: activeMember ? `${activeMember.firstName} ${activeMember.lastName}` : "SYSTEM",
      action: action.toUpperCase(),
      details,
    };
    setGovernanceLog((prev) => [entry, ...prev]);
  }, [activeMember]);

  const handleAuth = (ln: string, fn: string, pw?: string) => {
    const lastName = ln.trim().toUpperCase();
    const firstName = fn.trim().toUpperCase();
    const fullName = `${firstName} ${lastName}`;
    const registered = localRegistry[fullName];

    if (registered) {
      if (!isReturning) {
        setIsReturning(true);
        setAuthError("");
        return;
      }
      if (registered.password === pw) {
        setActiveMember(registered);
        setStep("dashboard");
        addLog("LOGIN", "Secure member session established.");
      } else {
        setAuthError("Invalid credentials.");
      }
    } else {
      const match = masterRegistry.find(
        (m) => m.lastName.toUpperCase() === lastName && m.firstName.toUpperCase() === firstName,
      );
      if (match) {
        const idx = masterRegistry.indexOf(match);
        const seq = ID_OFFSET + idx + 1;
        const b2cId = match.b2cId ?? makeObfuscatedB2cId(seq);
        setActiveMember({ ...match, b2cId, mobile: "", email: "" });
        setStep("onboarding");
      } else {
        setActiveMember({
          lastName: lastName,
          firstName: firstName,
          city: "",
          timestamp: "",
          role: "Member",
          tinNo: "",
          dob: "",
          b2cId: "",
          mobile: "",
          email: "",
        });
        setAuthError("");
        setStep("self_register");
      }
    }
  };

  const handleSelfRegister = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const lastName = (form.elements.namedItem("ln") as HTMLInputElement).value.trim();
    const firstName = (form.elements.namedItem("fn") as HTMLInputElement).value.trim();
    const tinNo = (form.elements.namedItem("tin") as HTMLInputElement).value.trim();
    const dob = (form.elements.namedItem("dob") as HTMLInputElement).value.trim();
    const mobile = (form.elements.namedItem("mobile") as HTMLInputElement).value.trim();
    const email = (form.elements.namedItem("email") as HTMLInputElement).value.trim();
    const password = (form.elements.namedItem("pw") as HTMLInputElement).value;

    const res = await fetch("/api/users/self-register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lastName,
        firstName,
        tinNo,
        dob,
        mobile,
        email,
        password,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      message?: string;
      data?: ApiUser & { mobile?: string | null; email?: string | null };
    };
    if (!res.ok || !json.ok || !json.data) {
      setAuthError(typeof json.message === "string" ? json.message : "Could not complete registration.");
      return;
    }

    const mapped = mapApiUserToRegistry(json.data);
    const profile: ActiveMember = {
      ...mapped,
      b2cId: json.data.b2cId,
      mobile: json.data.mobile ?? mobile,
      email: json.data.email ?? email,
      password,
    };
    const fullName = `${profile.firstName.toUpperCase()} ${profile.lastName.toUpperCase()}`;
    setLocalRegistry((prev) => ({ ...prev, [fullName]: profile }));
    setActiveMember(profile);
    setAuthError("");
    setStep("dashboard");
    addLog("REGISTRATION", "Self-registration completed with minimum identity details.");
    void reloadRegistry();
  };

  const handleReset = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const ln = (form.elements.namedItem("ln") as HTMLInputElement).value.trim().toUpperCase();
    const fn = (form.elements.namedItem("fn") as HTMLInputElement).value.trim().toUpperCase();
    const tin = (form.elements.namedItem("tin") as HTMLInputElement).value.trim();
    const dob = (form.elements.namedItem("dob") as HTMLInputElement).value.trim();

    const match = masterRegistry.find(
      (m) =>
        m.lastName.toUpperCase() === ln &&
        m.firstName.toUpperCase() === fn &&
        m.tinNo === tin.replace(/\D/g, "") &&
        m.dob === dob,
    );
    if (match) {
      const idx = masterRegistry.indexOf(match);
      const seq = ID_OFFSET + idx + 1;
      setActiveMember({ ...match, b2cId: match.b2cId ?? makeObfuscatedB2cId(seq), mobile: "", email: "" });
      setStep("create_password");
      setAuthError("");
      addLog("SECURITY", "Identity verified via TIN/DOB for reset.");
    } else {
      setAuthError("Verification failed. Details do not match.");
    }
  };

  const handleCreatePassword = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const pw = (form.elements.namedItem("pw") as HTMLInputElement).value;
    if (!activeMember) return;
    const fullName = `${activeMember.firstName.toUpperCase()} ${activeMember.lastName.toUpperCase()}`;
    const profile: ActiveMember = { ...activeMember, password: pw };
    setLocalRegistry((prev) => ({ ...prev, [fullName]: profile }));
    setActiveMember(profile);
    setStep("dashboard");
    addLog("SECURITY", "Password established successfully.");
  };

  const handleNominate = async (m: RegistryMember, pos: string): Promise<boolean> => {
    if (!activeMember) return false;
    if (!m.b2cId) {
      addLog("NOMINATION", "Selected member has no B2C ID and cannot be nominated yet.");
      return false;
    }
    try {
      const res = await fetch("/api/nominations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nomineeName: `${m.firstName} ${m.lastName}`.trim(),
          position: pos,
          nominatorId: activeMember.b2cId,
          nomineeB2cId: m.b2cId,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; data?: ApiNominationRow; message?: string };
      if (!json.ok || !json.data) {
        addLog(
          "NOMINATION",
          typeof json.message === "string" ? json.message : "Could not save nomination to the server.",
        );
        return false;
      }
      const row = mapApiNominationToPortal(json.data);
      setNominations((prev) => [...prev, row]);
      addLog("NOMINATION", `Proposed ${m.firstName} ${m.lastName} for ${pos}.`);
      return true;
    } catch {
      addLog("NOMINATION", "Network error while saving nomination.");
      return false;
    }
  };

  const handleAcceptNomination = async (nominationId: string) => {
    if (!activeMember) return;
    try {
      const res = await fetch("/api/nominations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nominationId,
          nomineeB2cId: activeMember.b2cId,
          password: activeMember.password ?? "",
          action: "accept",
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        data?: { id: string; status: "pending" | "accepted"; respondedAt?: string | null };
        message?: string;
      };
      if (!json.ok || !json.data) {
        addLog(
          "NOMINATION",
          typeof json.message === "string"
            ? `Acceptance failed: ${json.message}`
            : "Could not confirm nomination acceptance.",
        );
        return;
      }
      setNominations((prev) =>
        prev.map((n) => (n.id === json.data?.id ? { ...n, status: "accepted" } : n)),
      );
      addLog("NOMINATION", "Nomination accepted. Availability confirmed.");
    } catch {
      addLog("NOMINATION", "Network error while confirming nomination.");
    }
  };

  const openMembersRegistry = async () => {
    if (!activeMember || !portalFlags?.canViewRegistry) return;
    const res = await fetch("/api/auth/registry-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        b2cId: activeMember.b2cId,
        password: activeMember.password ?? "",
      }),
    });
    if (res.ok) {
      router.push("/members");
      return;
    }
    const j = await res.json().catch(() => ({}));
    window.alert(
      typeof j.message === "string"
        ? j.message
        : "Could not open registry. Ensure you have portal authorization and your password matches the server record.",
    );
  };

  const handleVoteSubmit = async () => {
    if (!activeMember) return;
    const isComplete = COMMITTEES.every((c) => ballot[c].length === COMMITTEE_SEATS[c]);
    if (!isComplete) return;

    const res = await fetch("/api/votes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        voterB2cId: activeMember.b2cId,
        password: activeMember.password ?? "",
        ballot,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
    if (!res.ok || !json.ok) {
      addLog("VOTING", typeof json.message === "string" ? json.message : "Failed to cast ballot.");
      return;
    }
    addLog("VOTING", "Ballot recorded by server.");
    setBallot({
      "Board of Director": [],
      "Audit Committee": [],
      "Election Committee": [],
    });
    await refreshElectionServerData();
    setStep("success");
  };

  const updateElectionConfig = async (patch: { status?: string; lockedPositions?: string[] }) => {
    if (!activeMember) return false;
    const res = await fetch("/api/election/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actorB2cId: activeMember.b2cId,
        password: activeMember.password ?? "",
        ...patch,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; data?: ElectionConfigApi };
    if (!res.ok || !json.ok || !json.data) {
      addLog("ADMIN", typeof json.message === "string" ? json.message : "Failed to update election config.");
      return false;
    }
    setElectionStatus(json.data.status);
    setLockedPositions(Array.isArray(json.data.lockedPositions) ? json.data.lockedPositions : []);
    return true;
  };

  const handleProfileSave = async () => {
    if (!activeMember) return;
    setProfileError("");
    if (!profileDob.trim()) {
      setProfileError("Date of birth is required.");
      return;
    }
    setProfileSaving(true);
    try {
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          b2cId: activeMember.b2cId,
          password: activeMember.password ?? "",
          dob: profileDob,
          mobile: profileMobile,
          email: profileEmail,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        data?: ApiUser;
      };
      if (!res.ok || !json.ok || !json.data) {
        setProfileError(typeof json.message === "string" ? json.message : "Could not update profile.");
        return;
      }

      const mapped = mapApiUserToRegistry(json.data);
      const updatedMember: ActiveMember = {
        ...activeMember,
        ...mapped,
        mobile: json.data.mobile ?? profileMobile,
        email: json.data.email ?? profileEmail,
      };
      const fullName = `${updatedMember.firstName.toUpperCase()} ${updatedMember.lastName.toUpperCase()}`;
      setLocalRegistry((prev) => ({ ...prev, [fullName]: updatedMember }));
      setActiveMember(updatedMember);
      addLog("PROFILE", "Member profile updated securely.");
      setStep("dashboard");
      void reloadRegistry();
    } finally {
      setProfileSaving(false);
    }
  };

  return (
    <div className="selection:bg-blue-100 mx-auto max-w-xl pb-20 font-sans text-slate-900">
      <header className="fixed left-0 right-0 top-0 z-40 mx-auto flex h-16 max-w-xl items-center justify-between border-b border-slate-100 bg-white/80 px-4 backdrop-blur-md sm:px-6">
        <button
          type="button"
          className="flex items-center gap-2"
          onClick={() => activeMember && setStep("dashboard")}
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-700 text-xs font-bold text-white shadow-lg">
            B
          </div>
          <span className="text-[10px] font-extrabold uppercase tracking-tighter text-blue-950">
            B2C <span className="font-bold text-blue-600">Portal</span>
          </span>
        </button>
        <div className="flex items-center gap-2 sm:gap-3">
          {activeMember && portalFlags?.canViewRegistry && !portalFlags?.canManageAdmins && (
            <button
              type="button"
              onClick={() => void openMembersRegistry()}
              className="whitespace-nowrap rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-tight text-blue-700 transition-colors hover:bg-blue-100 sm:px-3 sm:text-[10px]"
            >
              View Members Registry
            </button>
          )}
          {activeMember && (
            <>
              <Bell className="h-5 w-5 text-slate-300" />
              <div className="h-8 w-8 overflow-hidden rounded-full border-2 border-white bg-slate-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(activeMember.lastName)}`}
                  alt=""
                  width={32}
                  height={32}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  void fetch("/api/auth/registry-session", { method: "DELETE" });
                  setPortalFlags(null);
                  setStep("auth");
                  setActiveMember(null);
                  setIsReturning(false);
                }}
                className="text-slate-400"
                aria-label="Log out"
              >
                <LogOut size={18} />
              </button>
            </>
          )}
        </div>
      </header>

      <main className="px-6 pt-24">
        {registryLoading && step === "auth" && (
          <p className="py-8 text-center text-sm text-slate-500">Loading official registry…</p>
        )}
        {registryError && (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-xs font-bold text-amber-900">
            {registryError}
          </p>
        )}

        {step === "auth" && !registryLoading && (
          <div className="slide-up space-y-8">
            <div className="py-6 text-center">
              <h1 className="text-4xl font-black leading-none tracking-tighter text-slate-900">Member Access</h1>
              <p className="mt-2 font-medium text-slate-500">Verified Identity Portal</p>
            </div>
            <PremiumCard>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const ln = (form.elements.namedItem("ln") as HTMLInputElement).value;
                  const fn = (form.elements.namedItem("fn") as HTMLInputElement).value;
                  const pw = (form.elements.namedItem("pw") as HTMLInputElement | undefined)?.value;
                  handleAuth(ln, fn, pw);
                }}
                className="space-y-4"
              >
                <input
                  name="ln"
                  type="text"
                  placeholder="Last Name"
                  className="w-full rounded-2xl border-2 border-transparent bg-slate-50 px-6 py-4 font-bold uppercase outline-none transition-all focus:border-blue-500"
                  required
                />
                <input
                  name="fn"
                  type="text"
                  placeholder="First Name"
                  className="w-full rounded-2xl border-2 border-transparent bg-slate-50 px-6 py-4 font-bold uppercase outline-none transition-all focus:border-blue-500"
                  required
                />
                {isReturning && (
                  <div className="fade-in space-y-2">
                    <input
                      name="pw"
                      type="password"
                      placeholder="Password"
                      className="w-full rounded-2xl border-2 border-blue-200 bg-white px-6 py-4 font-bold outline-none transition-all focus:border-blue-600"
                      required
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setStep("forgot_password")}
                      className="ml-1 text-[10px] font-bold uppercase tracking-widest text-blue-600"
                    >
                      Forgot Password?
                    </button>
                  </div>
                )}
                {authError && <p className="text-center text-xs font-bold text-red-500">{authError}</p>}
                <button
                  type="submit"
                  className="w-full rounded-3xl bg-blue-700 py-5 text-lg font-black text-white shadow-2xl shadow-blue-100 transition-all active:scale-95"
                >
                  {isReturning ? "Secure Login" : "Verify Identity"}
                </button>
              </form>
            </PremiumCard>
          </div>
        )}

        {step === "forgot_password" && (
          <div className="slide-up space-y-8">
            <div className="py-6 text-center">
              <h1 className="text-3xl font-black leading-tight text-slate-900">Reset Portal</h1>
            </div>
            <PremiumCard>
              <form onSubmit={handleReset} className="space-y-4">
                <input name="ln" type="text" placeholder="Last Name" className="w-full rounded-2xl bg-slate-50 px-6 py-4 font-bold uppercase outline-none" required />
                <input name="fn" type="text" placeholder="First Name" className="w-full rounded-2xl bg-slate-50 px-6 py-4 font-bold uppercase outline-none" required />
                <div className="space-y-1">
                  <label className="ml-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    <Lock size={10} /> TIN Number
                  </label>
                  <input name="tin" type="text" placeholder="e.g. 123456789" className="w-full rounded-2xl bg-slate-50 px-6 py-4 font-bold outline-none transition-all focus:border-blue-500" required />
                </div>
                <div className="space-y-1">
                  <label className="ml-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    <Calendar size={10} /> Date of Birth
                  </label>
                  <input name="dob" type="date" className="w-full rounded-2xl bg-slate-50 px-6 py-4 font-bold outline-none transition-all focus:border-blue-500" required />
                </div>
                {authError && <p className="text-center text-xs font-bold text-red-500">{authError}</p>}
                <button type="submit" className="w-full rounded-3xl bg-blue-700 py-5 text-lg font-black text-white shadow-xl">
                  Verify & Proceed
                </button>
                <button type="button" onClick={() => setStep("auth")} className="w-full pt-2 text-xs font-bold uppercase text-slate-400">
                  Cancel
                </button>
              </form>
            </PremiumCard>
          </div>
        )}

        {step === "self_register" && (
          <div className="slide-up space-y-8">
            <div className="py-6 text-center">
              <h1 className="text-3xl font-black leading-tight text-slate-900">Complete Identity Registration</h1>
              <p className="mt-2 text-sm text-slate-500">You can proceed with minimum identity details.</p>
            </div>
            <PremiumCard>
              <form onSubmit={handleSelfRegister} className="space-y-4">
                <input
                  name="ln"
                  type="text"
                  placeholder="Last Name"
                  defaultValue={activeMember?.lastName ?? ""}
                  className="w-full rounded-2xl bg-slate-50 px-6 py-4 font-bold uppercase outline-none"
                  required
                />
                <input
                  name="fn"
                  type="text"
                  placeholder="First Name"
                  defaultValue={activeMember?.firstName ?? ""}
                  className="w-full rounded-2xl bg-slate-50 px-6 py-4 font-bold uppercase outline-none"
                  required
                />
                <div className="space-y-1">
                  <label className="ml-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    <Lock size={10} /> TIN Number
                  </label>
                  <input
                    name="tin"
                    type="text"
                    placeholder="e.g. 123456789"
                    className="w-full rounded-2xl bg-slate-50 px-6 py-4 font-bold outline-none transition-all focus:border-blue-500"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="ml-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    <Calendar size={10} /> Date of Birth
                  </label>
                  <input
                    name="dob"
                    type="date"
                    className="w-full rounded-2xl bg-slate-50 px-6 py-4 font-bold outline-none transition-all focus:border-blue-500"
                    required
                  />
                </div>
                <input
                  name="mobile"
                  type="text"
                  placeholder="Mobile Number (required if no email)"
                  className="w-full rounded-2xl bg-slate-50 px-6 py-4 font-bold outline-none"
                />
                <input
                  name="email"
                  type="email"
                  placeholder="Email (required if no mobile)"
                  className="w-full rounded-2xl bg-slate-50 px-6 py-4 font-bold outline-none"
                />
                <input
                  name="pw"
                  type="password"
                  placeholder="Password"
                  className="w-full rounded-2xl bg-slate-50 px-6 py-4 font-bold outline-none"
                  required
                />
                {authError && <p className="text-center text-xs font-bold text-red-500">{authError}</p>}
                <button type="submit" className="w-full rounded-3xl bg-blue-700 py-5 text-lg font-black text-white shadow-xl">
                  Register & Continue
                </button>
                <button type="button" onClick={() => setStep("auth")} className="w-full pt-2 text-xs font-bold uppercase text-slate-400">
                  Back to Login
                </button>
              </form>
            </PremiumCard>
          </div>
        )}

        {step === "onboarding" && activeMember && (
          <div className="slide-up space-y-8 py-10 text-center">
            <h2 className="text-3xl font-black text-slate-900">Identity Verified</h2>
            <PremiumCard dark className="relative overflow-hidden bg-gradient-to-br from-blue-700 to-blue-900 py-12">
              <div className="relative z-10">
                <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.4em] text-blue-200">Official ID Assigned</p>
                <p className="font-mono text-5xl font-black leading-none tracking-tighter text-white">{activeMember.b2cId}</p>
              </div>
              <Award className="absolute -bottom-10 -right-10 h-48 w-48 rotate-12 text-white/10" />
            </PremiumCard>
            <button
              type="button"
              onClick={() => setStep("create_password")}
              className="w-full rounded-3xl bg-blue-700 py-5 text-lg font-black text-white shadow-xl shadow-blue-100"
            >
              Set Security Password
            </button>
          </div>
        )}

        {step === "create_password" && activeMember && (
          <div className="slide-up space-y-8">
            <div className="py-6 text-center">
              <h1 className="text-3xl font-black text-slate-900">Final Security</h1>
              <p className="mt-2 text-sm text-slate-500">Create your personal login credential.</p>
            </div>
            <PremiumCard>
              <form onSubmit={handleCreatePassword} className="space-y-4">
                <input name="pw" type="password" placeholder="New Password" required className="w-full rounded-2xl bg-slate-50 px-6 py-4 font-bold outline-none" />
                <input type="password" placeholder="Confirm Password" required className="w-full rounded-2xl bg-slate-50 px-6 py-4 font-bold outline-none" />
                <button type="submit" className="w-full rounded-3xl bg-blue-700 py-5 text-lg font-black text-white shadow-xl">
                  Complete Setup
                </button>
              </form>
            </PremiumCard>
          </div>
        )}

        {step === "dashboard" && activeMember && (
          <div className="slide-up space-y-8 pb-10">
            <div>
              <div className="mb-6 flex items-start justify-between">
                <div>
                  <h1 className="text-3xl font-black leading-tight text-slate-900">Hello, {activeMember.firstName}! 👋</h1>
                  <p className="font-medium text-slate-500">
                    Member ID: <span className="font-bold text-blue-600">{activeMember.b2cId}</span>
                  </p>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                    Member in Good Standing
                  </p>
                  {portalFlags?.officerTitle && (
                    <p className="mt-1 text-xs font-medium text-slate-400">{portalFlags.officerTitle}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setStep("profile")}
                  className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-100 bg-white text-blue-600 shadow-lg transition-all active:scale-95"
                  aria-label="Edit profile"
                >
                  <Edit3 size={20} />
                </button>
              </div>

              {nominationNotice && (
                <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center text-xs font-bold text-emerald-900">
                  {nominationNotice}
                </div>
              )}

              <PremiumCard dark className="relative mb-8 overflow-hidden bg-blue-700">
                <div className="relative z-10">
                  <span className="mb-4 inline-block rounded-full bg-white/20 px-3 py-1 text-[10px] font-bold uppercase tracking-wider">
                    Official Election Cycle
                  </span>
                  <h2 className="mb-1 text-2xl font-black">2024 General Assembly</h2>
                  <p className="mb-6 text-xs font-medium leading-relaxed text-blue-100">
                    Phase: <span className="font-black uppercase text-white underline">{electionStatus}</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => setStep(electionStatus === "voting" ? "vote" : "nominate")}
                    className="rounded-2xl bg-white px-6 py-3 text-sm font-black text-blue-700 shadow-lg transition-all active:scale-95"
                  >
                    {electionStatus === "voting" ? "Cast Ballot" : "Manage Nominations"}
                  </button>
                </div>
                <Gavel className="absolute -bottom-10 -right-10 h-48 w-48 rotate-12 text-white/10" />
              </PremiumCard>

              {activeMember && (
                (() => {
                  const pendingForMe = nominations.filter(
                    (n) => n.nomineeB2cId === activeMember.b2cId && n.status === "pending",
                  );
                  if (pendingForMe.length === 0) return null;
                  return (
                    <div className="mb-8 space-y-3">
                      <h3 className="ml-1 text-xs font-bold uppercase tracking-widest text-amber-700">
                        Pending Nomination Confirmations
                      </h3>
                      {pendingForMe.map((n) => (
                        <PremiumCard key={n.id} className="space-y-3 border border-amber-200 bg-amber-50/60">
                          <p className="text-sm font-bold text-slate-800">
                            You are nominated for <span className="text-amber-800">{n.position}</span>.
                          </p>
                          <button
                            type="button"
                            onClick={() => void handleAcceptNomination(n.id)}
                            className="rounded-2xl bg-amber-700 px-4 py-2 text-xs font-black uppercase text-white"
                          >
                            Accept Nomination
                          </button>
                        </PremiumCard>
                      ))}
                    </div>
                  );
                })()
              )}

              {(portalFlags?.canUseElectionCommitteeControls || portalFlags?.canManageAdmins) && (
                <div className="mb-8 space-y-4">
                  <h3 className="ml-1 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400">
                    <Gavel size={12} /> Committee Controls
                  </h3>
                  {(() => {
                    const allNominationsReadyToClose = COMMITTEES.every(
                      (committee) => lockedPositions.includes(committee) || motions[committee]?.stage === "seconded",
                    );
                    const canStartVoting =
                      allNominationsReadyToClose || Boolean(portalFlags?.canManageAdmins);
                    return (
                      <div className="grid grid-cols-2 gap-4">
                        {electionStatus === "nomination" &&
                          (portalFlags?.canUseElectionCommitteeControls || portalFlags?.canManageAdmins) && (
                          <button
                            type="button"
                            onClick={async () => {
                              const ok = await updateElectionConfig({
                                status: "voting",
                                lockedPositions: COMMITTEES,
                              });
                              if (ok) addLog("ADMIN", "NOMINATIONS CLOSED. VOTING PHASE OPENED.");
                            }}
                            disabled={!canStartVoting}
                            className={`rounded-2xl p-4 text-xs font-bold uppercase shadow-xl transition-all ${
                              canStartVoting
                                ? "bg-slate-900 text-white active:scale-95"
                                : "cursor-not-allowed bg-slate-300 text-slate-500"
                            }`}
                            title={
                              canStartVoting
                                ? allNominationsReadyToClose
                                  ? "Close nominations and open voting."
                                  : "Super user: start voting without all committees seconded."
                                : "Each committee needs a seconded motion before voting can start."
                            }
                          >
                            Close Nominations & Start Voting
                          </button>
                        )}
                        {electionStatus === "voting" && (
                          <button
                            type="button"
                            onClick={async () => {
                              const ok = await updateElectionConfig({ status: "ended" });
                              if (!ok || !activeMember) return;
                              const declareRes = await fetch("/api/election/declare", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  actorB2cId: activeMember.b2cId,
                                  password: activeMember.password ?? "",
                                }),
                              });
                              const declareJson = (await declareRes.json().catch(() => ({}))) as {
                                ok?: boolean;
                                message?: string;
                                data?: { status?: string };
                              };
                              if (!declareRes.ok || !declareJson.ok) {
                                addLog(
                                  "ADMIN",
                                  typeof declareJson.message === "string"
                                    ? `Polls closed; declaration pending: ${declareJson.message}`
                                    : "Polls closed; could not declare results.",
                                );
                                return;
                              }
                              await refreshElectionServerData();
                              addLog("ADMIN", "POLLS CLOSED. RESULTS OFFICIAL.");
                            }}
                            className="rounded-2xl bg-red-600 p-4 text-xs font-bold uppercase text-white shadow-xl transition-all active:scale-95"
                          >
                            Close Polls
                          </button>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              {(portalFlags?.canManageAdmins || portalFlags?.canUseElectionCommitteeControls) && (
                <div className="mb-8">
                  <NominationsAdminPanel
                    actorB2cId={activeMember.b2cId}
                    password={activeMember.password ?? ""}
                    electionEnded={electionStatus === "ended"}
                    onNominationsChanged={reloadRegistry}
                  />
                </div>
              )}

              {portalFlags?.canManageAdmins && portalFlags.officerPositions && portalFlags.officerPositions.length > 0 && (
                <div className="mb-8 space-y-3">
                  <button
                    type="button"
                    onClick={() => setShowAdminTools((prev) => !prev)}
                    className="rounded-2xl border border-amber-300 bg-amber-100 px-4 py-2 text-xs font-black uppercase tracking-widest text-amber-900 transition-colors hover:bg-amber-200"
                  >
                    {showAdminTools ? "Hide Admin Tools" : "Show Admin Tools"}
                  </button>
                  {showAdminTools && (
                    <div className="space-y-3">
                      {portalFlags?.canViewRegistry && (
                        <button
                          type="button"
                          onClick={() => void openMembersRegistry()}
                          className="w-full rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-black uppercase tracking-widest text-blue-700 transition-colors hover:bg-blue-100"
                        >
                          View Members Registry
                        </button>
                      )}
                      <SuperUserPanel
                        actorB2cId={activeMember.b2cId}
                        password={activeMember.password ?? ""}
                        positions={portalFlags.officerPositions}
                      />
                    </div>
                  )}
                </div>
              )}

              {(electionStatus === "voting" || electionStatus === "ended") && (
                <div className="mb-8 space-y-6">
                  <div className="flex items-center justify-between px-1">
                    <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400">
                      <Trophy size={12} /> {electionStatus === "ended" ? "Official Winners" : "Live Tally"}
                    </h3>
                  </div>
                  {electionStatus === "ended" && resultsDeclaredAt && (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[11px] font-semibold text-emerald-800">
                      Results declared at{" "}
                      <span className="font-black">
                        {new Date(resultsDeclaredAt).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </span>
                    </div>
                  )}
                  {COMMITTEES.map((com) => {
                    const candidates = nominations.filter((n) => n.position === com && n.status === "accepted");
                    const sorted = [...candidates].sort((a, b) => (voteTallies[b.id] || 0) - (voteTallies[a.id] || 0));
                    const winnerCount = COMMITTEE_SEATS[com];
                    return (
                      <PremiumCard key={com} className="space-y-3">
                        <p className="border-b pb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">{com}</p>
                        {sorted.length === 0 ? (
                          <p className="text-xs italic text-slate-300">Awaiting candidates...</p>
                        ) : (
                          sorted.map((c, i) => {
                            const isWinner = electionStatus === "ended" && i < winnerCount;
                            return (
                              <div
                                key={c.id}
                                className={`flex items-center justify-between rounded-xl p-3 transition-all ${
                                  isWinner ? "border border-emerald-200 bg-emerald-50" : ""
                                }`}
                              >
                                <div className="flex items-center gap-3">
                                  <span className={`text-[10px] font-black ${i < winnerCount ? "text-blue-600" : "text-slate-300"}`}>
                                    0{i + 1}
                                  </span>
                                  <span className={`text-xs font-bold ${isWinner ? "text-emerald-900" : "text-slate-700"}`}>{c.name}</span>
                                  {isWinner && <Award size={14} className="text-emerald-500" />}
                                </div>
                                <span className={`text-xs font-black ${isWinner ? "text-emerald-600" : "text-blue-900"}`}>
                                  {voteTallies[c.id] || 0}
                                </span>
                              </div>
                            );
                          })
                        )}
                      </PremiumCard>
                    );
                  })}
                </div>
              )}

              <div className="grid grid-cols-1 gap-4">
                <div className="rounded-3xl border border-blue-100 bg-blue-50 p-5">
                  <Users className="mb-2 text-blue-600" size={24} />
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Status</p>
                  <p className="text-xl font-black text-blue-900">Active</p>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-8">
              <div className="mb-6 flex items-center justify-between">
                <h3 className="ml-1 text-xs font-bold uppercase tracking-widest text-slate-400">Governance Audit Log</h3>
                <button type="button" className="flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1.5 text-[9px] font-black uppercase tracking-tighter text-blue-600">
                  <Download size={10} /> PDF Log
                </button>
              </div>
              <div className="max-h-60 overflow-y-auto overflow-x-hidden rounded-[2.5rem] border border-slate-100 bg-white shadow-sm">
                {governanceLog.length === 0 ? (
                  <p className="p-6 text-center text-[10px] italic text-slate-300">No activity recorded for this session.</p>
                ) : (
                  governanceLog.map((log, i) => (
                    <div key={i} className="border-b border-slate-50 p-5 transition-colors last:border-0 hover:bg-slate-50">
                      <div className="mb-1.5 flex justify-between">
                        <span className="text-[9px] font-black uppercase tracking-widest text-blue-600">{log.action}</span>
                        <span className="text-[9px] font-bold text-slate-300">{log.time}</span>
                      </div>
                      <p className="mb-0.5 text-[11px] font-bold leading-none text-slate-800">{log.user}</p>
                      <p className="text-[10px] font-medium text-slate-400">{log.details}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {step === "profile" && activeMember && (
          <div className="slide-up space-y-8 pb-10">
            <button type="button" className="mb-2 flex cursor-pointer items-center gap-2" onClick={() => setStep("dashboard")}>
              <ArrowLeft size={16} /> <span className="text-sm font-bold uppercase tracking-widest text-blue-600">Back</span>
            </button>
            <h1 className="mb-8 px-1 text-4xl font-black leading-none tracking-tighter text-slate-900">Update Profile</h1>
            <PremiumCard className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="ml-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                    <Phone size={10} /> Mobile Number
                  </label>
                  <input
                    type="tel"
                    placeholder="0917-XXX-XXXX"
                    value={profileMobile}
                    onChange={(e) => setProfileMobile(e.target.value)}
                    className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 p-4 font-bold uppercase outline-none focus:border-blue-600"
                  />
                </div>
                <div className="space-y-1">
                  <label className="ml-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                    <Mail size={10} /> Email Address
                  </label>
                  <input
                    type="email"
                    placeholder="name@coop.com"
                    value={profileEmail}
                    onChange={(e) => setProfileEmail(e.target.value)}
                    className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 p-4 font-bold uppercase outline-none focus:border-blue-600"
                  />
                </div>
                <div className="space-y-1">
                  <label className="ml-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                    <Calendar size={10} /> Date of Birth
                  </label>
                  <input
                    type="date"
                    value={profileDob}
                    onChange={(e) => setProfileDob(e.target.value)}
                    className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 p-4 font-bold uppercase outline-none focus:border-blue-600"
                  />
                </div>
              </div>
              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-5">
                <p className="mb-1 text-[8px] font-black uppercase tracking-widest text-blue-600">Permanent Registry Data</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[8px] font-bold uppercase text-slate-400">TIN</p>
                    <p className="text-xs font-black text-slate-700">{activeMember.tinNo}</p>
                  </div>
                  <div>
                    <p className="text-[8px] font-bold uppercase text-slate-400">DOB</p>
                    <p className="text-xs font-black text-slate-700">{profileDob || activeMember.dob}</p>
                  </div>
                </div>
              </div>
              {profileError && <p className="text-center text-xs font-bold text-red-500">{profileError}</p>}
              <button
                type="button"
                onClick={() => void handleProfileSave()}
                disabled={profileSaving}
                className="w-full rounded-3xl bg-blue-700 py-5 text-lg font-black text-white shadow-xl transition-all active:scale-95"
              >
                {profileSaving ? "Saving..." : "Save Changes"}
              </button>
            </PremiumCard>
          </div>
        )}

        {step === "nominate" && activeMember && (
          <NominationModule
            activeMember={activeMember}
            nominations={nominations}
            lockedPositions={lockedPositions}
            electionStatus={electionStatus}
            motions={motions}
            onNominate={handleNominate}
            onMotionUpdate={(pos, stage, mover) => {
              setMotions((prev) => ({ ...prev, [pos]: { stage, moverId: mover } }));
              addLog("MOTION", `${stage.toUpperCase()} motion for ${pos}.`);
            }}
            onObjection={(pos) => {
              setMotions((prev) => ({ ...prev, [pos]: { stage: "none", moverId: null } }));
              addLog("OBJECTION", `Member objected to closing ${pos}.`);
            }}
            onFinish={() => setStep("dashboard")}
            masterRegistry={masterRegistry}
            onNominationRecorded={(msg) => setNominationNotice(msg)}
          />
        )}

        {step === "vote" && (
          <div className="slide-up space-y-10 pb-32">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-4xl font-black tracking-tighter text-slate-900">Cast Ballot</h2>
              <button type="button" onClick={() => setStep("dashboard")} className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100" aria-label="Close">
                <X />
              </button>
            </div>
            {COMMITTEES.map((committee) => {
              const candidates = nominations.filter((n) => n.position === committee && n.status === "accepted");
              const requiredSelections = COMMITTEE_SEATS[committee];
              return (
                <div key={committee} className="space-y-4">
                  <div className="flex items-end justify-between px-1">
                    <h3 className="text-lg font-black uppercase leading-none tracking-tight text-blue-900">{committee}</h3>
                    <span
                      className={`rounded-full px-3 py-1 text-[10px] font-black transition-all ${
                        ballot[committee].length === requiredSelections
                          ? "bg-emerald-500 text-white shadow-lg"
                          : "bg-slate-200 text-slate-500"
                      }`}
                    >
                      {ballot[committee].length} / {requiredSelections} Selected
                    </span>
                  </div>
                  <div className="space-y-2">
                    {candidates.length === 0 ? (
                      <p className="rounded-3xl border-2 border-dashed border-slate-100 p-6 text-center text-xs italic text-slate-300">
                        No nominees for this office.
                      </p>
                    ) : (
                      candidates.map((n) => {
                        const selected = ballot[committee].includes(n.id);
                        return (
                          <PremiumCard
                            key={n.id}
                            onClick={() => {
                              const current = ballot[committee];
                              if (selected) {
                                setBallot((prev) => ({
                                  ...prev,
                                  [committee]: current.filter((id) => id !== n.id),
                                }));
                              } else if (current.length < requiredSelections) {
                                setBallot((prev) => ({
                                  ...prev,
                                  [committee]: [...current, n.id],
                                }));
                              }
                            }}
                            className={`border-2 p-4 transition-all ${selected ? "border-blue-600 bg-blue-50/50" : "border-transparent"}`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div
                                  className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                                    selected ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-400"
                                  }`}
                                >
                                  {n.name.charAt(0)}
                                </div>
                                <span className="text-sm font-black text-slate-800">{n.name}</span>
                              </div>
                              <div
                                className={`flex h-6 w-6 items-center justify-center rounded-full border-2 transition-all ${
                                  selected ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 text-transparent"
                                }`}
                              >
                                <CheckCircle size={14} />
                              </div>
                            </div>
                          </PremiumCard>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
            <div className="fixed bottom-0 left-0 right-0 z-50 mx-auto max-w-xl bg-gradient-to-t from-slate-50 via-slate-50 to-transparent p-6">
              <button
                type="button"
                onClick={handleVoteSubmit}
                disabled={!COMMITTEES.every((c) => ballot[c].length === COMMITTEE_SEATS[c])}
                className={`w-full rounded-[2.5rem] py-5 text-lg font-black shadow-2xl transition-all ${
                  COMMITTEES.every((c) => ballot[c].length === COMMITTEE_SEATS[c])
                    ? "bg-blue-950 text-white opacity-100 active:scale-95"
                    : "cursor-not-allowed bg-slate-300 text-slate-500 opacity-50"
                }`}
              >
                Confirm Selections ({Object.values(COMMITTEE_SEATS).reduce((sum, seats) => sum + seats, 0)} Votes)
              </button>
            </div>
          </div>
        )}

        {step === "success" && (
          <div className="slide-up py-20 text-center">
            <div className="mx-auto mb-8 flex h-24 w-24 animate-bounce items-center justify-center rounded-[2.5rem] bg-emerald-500 text-white shadow-2xl shadow-emerald-100">
              <CheckCircle size={40} />
            </div>
            <h2 className="mb-4 text-4xl font-black leading-none tracking-tighter text-slate-900">Ballot Recorded</h2>
            <p className="px-10 font-medium text-slate-500">
              Thank you for participating. Your votes have been added to the secure tally. Official results are live on the dashboard.
            </p>
            <button type="button" onClick={() => setStep("dashboard")} className="mt-12 text-xs font-black uppercase tracking-widest text-blue-700 underline">
              Back to Dashboard
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
