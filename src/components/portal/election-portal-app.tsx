"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { dedupeByCandidateIdentity, isRegistryMemberAlreadyNominatedForPosition } from "@/lib/nomination-groups";
import { mergeSessionMemberIntoRegistry } from "@/lib/registry-for-voting";

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
  hasVoted?: boolean;
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
  /** Synced from server after ballot is cast. */
  hasVoted?: boolean;
};

const PORTAL_SESSION_KEY = "b2c_portal_active_member";
const VOTE_CONFIRM_STORAGE_KEY = "b2c_portal_vote_confirmation";

type VoteConfirmation = {
  recordedAt: string;
  votesRecorded: number;
};

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
  /** Present for election committee and portal super-admins; turnout across all registered members. */
  votingProgress?: {
    totalMembers: number;
    ballotsCast: number;
    allMembersHaveVoted: boolean;
  };
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
      candidates: {
        nominationId: string;
        nomineeName: string;
        votes: number;
        mergedNominationIds?: string[];
      }[];
      winners: {
        nominationId: string;
        nomineeName: string;
        votes: number;
        mergedNominationIds?: string[];
      }[];
    }
  >
> & {
  declaredAt: string | null;
  voterStats?: {
    registeredMembers: number;
    membersWhoVoted: number;
  };
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
  const [resultsVoterStats, setResultsVoterStats] = useState<{
    registeredMembers: number;
    membersWhoVoted: number;
  } | null>(null);
  const [profileDob, setProfileDob] = useState("");
  const [profileMobile, setProfileMobile] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileError, setProfileError] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [nominationNotice, setNominationNotice] = useState<string | null>(null);
  const [voteConfirmation, setVoteConfirmation] = useState<VoteConfirmation | null>(null);
  const activeMemberRef = useRef<ActiveMember | null>(null);

  /** Server roster plus any signed-in / locally registered members not yet in the fetched list (new signups, refresh races). */
  const registryForVoting = useMemo(() => {
    let merged = masterRegistry;
    for (const profile of Object.values(localRegistry)) {
      merged = mergeSessionMemberIntoRegistry(merged, profile);
    }
    merged = mergeSessionMemberIntoRegistry(merged, activeMember);
    return merged;
  }, [masterRegistry, localRegistry, activeMember]);

  useEffect(() => {
    activeMemberRef.current = activeMember;
  }, [activeMember]);

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
        window.sessionStorage.removeItem(VOTE_CONFIRM_STORAGE_KEY);
        setVoteConfirmation(null);
        return;
      }
      window.sessionStorage.setItem(PORTAL_SESSION_KEY, JSON.stringify(activeMember));
    } catch {
      // Ignore storage errors (private mode, quota).
    }
  }, [activeMember]);

  useEffect(() => {
    if (!activeMember?.b2cId) return;
    try {
      const raw = window.sessionStorage.getItem(VOTE_CONFIRM_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        voterB2cId?: string;
        recordedAt?: string;
        votesRecorded?: unknown;
      };
      if (
        parsed.voterB2cId === activeMember.b2cId &&
        typeof parsed.recordedAt === "string" &&
        typeof parsed.votesRecorded === "number"
      ) {
        setVoteConfirmation({ recordedAt: parsed.recordedAt, votesRecorded: parsed.votesRecorded });
      }
    } catch {
      // Ignore malformed storage.
    }
  }, [activeMember?.b2cId]);

  const applyResultsToTallies = useCallback((results: ElectionResultsApi | null | undefined) => {
    if (!results) return;
    const byCommittee = results.byCommittee ?? {};
    const tallies: Record<string, number> = {};
    for (const committee of COMMITTEES) {
      const rows = byCommittee[committee]?.candidates ?? [];
      for (const row of rows) {
        tallies[row.nominationId] = row.votes;
        const merged = row.mergedNominationIds;
        if (merged?.length) {
          for (const id of merged) tallies[id] = row.votes;
        }
      }
    }
    setVoteTallies(tallies);
    setResultsDeclaredAt(results.declaredAt ?? null);
    const vs = results.voterStats;
    if (
      vs &&
      typeof vs.registeredMembers === "number" &&
      typeof vs.membersWhoVoted === "number"
    ) {
      setResultsVoterStats({ registeredMembers: vs.registeredMembers, membersWhoVoted: vs.membersWhoVoted });
    } else {
      setResultsVoterStats(null);
    }
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
          const rows = usersJson.data as ApiUser[];
          const mapped: RegistryMember[] = rows.map(mapApiUserToRegistry);
          mapped.sort((a, b) => a.lastName.localeCompare(b.lastName));
          setMasterRegistry(mapped);
          setActiveMember((prev) => {
            if (!prev?.b2cId) return prev;
            const row = rows.find((u) => u.b2cId === prev.b2cId);
            if (!row || typeof row.hasVoted !== "boolean") return prev;
            return { ...prev, hasVoted: row.hasVoted };
          });
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

  const fetchPortalFlags = useCallback(async () => {
    const m = activeMemberRef.current;
    if (!m?.b2cId) return;
    try {
      const res = await fetch("/api/portal/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          b2cId: m.b2cId,
          password: m.password ?? "",
        }),
      });
      const json = await res.json();
      if (json.ok && json.data) setPortalFlags(json.data as PortalFlags);
    } catch {
      // Ignore network errors.
    }
  }, []);

  useEffect(() => {
    if (!activeMember) {
      setPortalFlags(null);
      return;
    }
    void fetchPortalFlags();
  }, [activeMember, fetchPortalFlags]);

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
        const rows = usersJson.data as ApiUser[];
        const mapped: RegistryMember[] = rows.map(mapApiUserToRegistry);
        mapped.sort((a, b) => a.lastName.localeCompare(b.lastName));
        setMasterRegistry(mapped);
        setActiveMember((prev) => {
          if (!prev?.b2cId) return prev;
          const row = rows.find((u) => u.b2cId === prev.b2cId);
          if (!row || typeof row.hasVoted !== "boolean") return prev;
          return { ...prev, hasVoted: row.hasVoted };
        });
      }
      if (nomsJson.ok && Array.isArray(nomsJson.data)) {
        setNominations((nomsJson.data as ApiNominationRow[]).map(mapApiNominationToPortal));
      }
    } catch {
      // Non-blocking refresh; UI already has error surfaces for initial load.
    }
    await fetchPortalFlags();
  }, [fetchPortalFlags]);

  useEffect(() => {
    if (!activeMember?.b2cId) return;
    void reloadRegistry();
  }, [activeMember?.b2cId, reloadRegistry]);

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
    await fetchPortalFlags();
  }, [applyResultsToTallies, fetchPortalFlags]);

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
    if (isRegistryMemberAlreadyNominatedForPosition(m, pos, nominations)) {
      addLog("NOMINATION", "This member is already nominated for this position.");
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
      if (res.status === 409) {
        addLog(
          "NOMINATION",
          typeof json.message === "string" ? json.message : "This member is already nominated for this position.",
        );
        return false;
      }
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
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      message?: string;
      data?: { status?: string; recordedAt?: string; votesRecorded?: number };
    };
    if (!res.ok || !json.ok) {
      addLog("VOTING", typeof json.message === "string" ? json.message : "Failed to cast ballot.");
      return;
    }
    const totalSeats = Object.values(COMMITTEE_SEATS).reduce((a, b) => a + b, 0);
    const confirmed: VoteConfirmation = {
      recordedAt:
        typeof json.data?.recordedAt === "string" ? json.data.recordedAt : new Date().toISOString(),
      votesRecorded: typeof json.data?.votesRecorded === "number" ? json.data.votesRecorded : totalSeats,
    };
    setVoteConfirmation(confirmed);
    try {
      window.sessionStorage.setItem(
        VOTE_CONFIRM_STORAGE_KEY,
        JSON.stringify({ ...confirmed, voterB2cId: activeMember.b2cId }),
      );
    } catch {
      // Ignore storage errors.
    }
    addLog("VOTING", "Ballot recorded by server.");
    setBallot({
      "Board of Director": [],
      "Audit Committee": [],
      "Election Committee": [],
    });
    setActiveMember((prev) => (prev ? { ...prev, hasVoted: true } : null));
    await refreshElectionServerData();
    await reloadRegistry();
    setStep("success");
  };

  useEffect(() => {
    if (step !== "vote" || !activeMember?.hasVoted) return;
    setStep("success");
  }, [step, activeMember?.hasVoted, activeMember]);

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
        ...(typeof json.data.hasVoted === "boolean" ? { hasVoted: json.data.hasVoted } : {}),
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
    <div className="selection:bg-blue-100 portal-shell pb-[max(5rem,env(safe-area-inset-bottom))] font-sans text-slate-900">
      <header className="fixed left-0 right-0 top-0 z-40 border-b border-slate-200/80 bg-white/90 pt-[env(safe-area-inset-top)] shadow-sm backdrop-blur-md supports-[backdrop-filter]:bg-white/80">
        <div className="portal-shell flex min-h-[3.5rem] items-center justify-between gap-2 py-2 sm:min-h-16 sm:py-0">
          <button
            type="button"
            className="flex min-w-0 items-center gap-2.5 rounded-xl py-1 text-left transition-colors hover:bg-slate-50/80"
            onClick={() => activeMember && setStep("dashboard")}
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#1e3a5f] text-xs font-bold text-white shadow-md ring-1 ring-slate-900/10">
              B2C
            </div>
            <div className="min-w-0 leading-tight">
              <span className="block truncate text-[9px] font-extrabold uppercase tracking-[0.12em] text-slate-500 sm:text-[10px]">
                Cooperative
              </span>
              <span className="block truncate text-xs font-extrabold tracking-tight text-slate-900 sm:text-sm">
                Election <span className="text-blue-700">Portal</span>
              </span>
            </div>
          </button>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            {activeMember && portalFlags?.canViewRegistry && !portalFlags?.canManageAdmins && (
              <button
                type="button"
                onClick={() => void openMembersRegistry()}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-2 text-[9px] font-bold uppercase tracking-wide text-slate-700 shadow-sm transition-colors hover:bg-slate-50 sm:px-3 sm:text-[10px]"
                aria-label="View members registry"
              >
                <Users className="h-4 w-4 sm:hidden" aria-hidden />
                <span className="hidden sm:inline">Registry</span>
              </button>
            )}
            {activeMember && (
              <>
                <Bell className="hidden h-5 w-5 text-slate-300 sm:block" aria-hidden />
                <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full border-2 border-white bg-slate-100 shadow-sm ring-1 ring-slate-200/80">
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
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Log out"
                >
                  <LogOut size={18} />
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="pt-[calc(3.75rem+env(safe-area-inset-top))] sm:pt-[calc(5rem+env(safe-area-inset-top))]">
        {registryLoading && step === "auth" && (
          <p className="py-8 text-center text-sm text-slate-500">Loading official registry…</p>
        )}
        {registryError && (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-xs font-bold text-amber-900">
            {registryError}
          </p>
        )}

        {step === "auth" && !registryLoading && (
          <div className="slide-up space-y-8 sm:space-y-10">
            <div className="space-y-2 py-4 text-center sm:py-6">
              <p className="portal-eyebrow text-slate-500">Secure access</p>
              <h1 className="portal-section-title">Member sign-in</h1>
              <p className="mx-auto max-w-md text-sm font-medium leading-relaxed text-slate-600">
                Use your registered name as it appears on official records.
              </p>
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
                className="space-y-3 sm:space-y-4"
              >
                <input
                  name="ln"
                  type="text"
                  placeholder="Last name"
                  autoComplete="family-name"
                  className="portal-input portal-input-muted uppercase"
                  required
                />
                <input
                  name="fn"
                  type="text"
                  placeholder="First name"
                  autoComplete="given-name"
                  className="portal-input portal-input-muted uppercase"
                  required
                />
                {isReturning && (
                  <div className="fade-in space-y-2">
                    <input
                      name="pw"
                      type="password"
                      placeholder="Password"
                      autoComplete="current-password"
                      className="portal-input border-blue-200 bg-white focus:border-blue-600"
                      required
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setStep("forgot_password")}
                      className="ml-1 text-left text-[10px] font-bold uppercase tracking-widest text-blue-700 underline-offset-2 hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                )}
                {authError && (
                  <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-center text-xs font-semibold text-red-700">
                    {authError}
                  </p>
                )}
                <button
                  type="submit"
                  className="w-full rounded-2xl bg-[#1e3a5f] py-4 text-base font-bold text-white shadow-lg shadow-slate-900/10 transition-all hover:bg-[#152a45] active:scale-[0.99] sm:rounded-3xl sm:py-5 sm:text-lg"
                >
                  {isReturning ? "Sign in securely" : "Continue"}
                </button>
              </form>
            </PremiumCard>
          </div>
        )}

        {step === "forgot_password" && (
          <div className="slide-up space-y-8">
            <div className="space-y-2 py-4 text-center sm:py-6">
              <p className="portal-eyebrow text-slate-500">Account recovery</p>
              <h1 className="portal-section-title">Verify your identity</h1>
              <p className="text-sm text-slate-600">Match your details to the official registry.</p>
            </div>
            <PremiumCard>
              <form onSubmit={handleReset} className="space-y-3 sm:space-y-4">
                <input
                  name="ln"
                  type="text"
                  placeholder="Last name"
                  className="portal-input portal-input-muted uppercase"
                  required
                />
                <input
                  name="fn"
                  type="text"
                  placeholder="First name"
                  className="portal-input portal-input-muted uppercase"
                  required
                />
                <div className="space-y-1">
                  <label className="ml-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    <Lock size={10} /> TIN Number
                  </label>
                  <input name="tin" type="text" placeholder="e.g. 123456789" className="portal-input portal-input-muted" required />
                </div>
                <div className="space-y-1">
                  <label className="ml-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    <Calendar size={10} /> Date of Birth
                  </label>
                  <input name="dob" type="date" className="portal-input portal-input-muted" required />
                </div>
                {authError && (
                  <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-center text-xs font-semibold text-red-700">
                    {authError}
                  </p>
                )}
                <button
                  type="submit"
                  className="w-full rounded-2xl bg-[#1e3a5f] py-4 text-base font-bold text-white shadow-lg transition hover:bg-[#152a45] sm:rounded-3xl sm:py-5"
                >
                  Verify & continue
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
            <div className="space-y-2 py-4 text-center sm:py-6">
              <p className="portal-eyebrow text-slate-500">New registration</p>
              <h1 className="portal-section-title">Create your record</h1>
              <p className="mx-auto max-w-md text-sm text-slate-600">
                Provide minimum identity details. At least one contact method is required.
              </p>
            </div>
            <PremiumCard>
              <form onSubmit={handleSelfRegister} className="space-y-3 sm:space-y-4">
                <input
                  name="ln"
                  type="text"
                  placeholder="Last name"
                  defaultValue={activeMember?.lastName ?? ""}
                  className="portal-input portal-input-muted uppercase"
                  required
                />
                <input
                  name="fn"
                  type="text"
                  placeholder="First name"
                  defaultValue={activeMember?.firstName ?? ""}
                  className="portal-input portal-input-muted uppercase"
                  required
                />
                <div className="space-y-1">
                  <label className="ml-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    <Lock size={10} /> TIN Number
                  </label>
                  <input name="tin" type="text" placeholder="e.g. 123456789" className="portal-input portal-input-muted" required />
                </div>
                <div className="space-y-1">
                  <label className="ml-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    <Calendar size={10} /> Date of Birth
                  </label>
                  <input name="dob" type="date" className="portal-input portal-input-muted" required />
                </div>
                <input
                  name="mobile"
                  type="tel"
                  placeholder="Mobile (required if no email)"
                  className="portal-input portal-input-muted"
                />
                <input
                  name="email"
                  type="email"
                  placeholder="Email (required if no mobile)"
                  className="portal-input portal-input-muted"
                />
                <input name="pw" type="password" placeholder="Password" className="portal-input" required />
                {authError && (
                  <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-center text-xs font-semibold text-red-700">
                    {authError}
                  </p>
                )}
                <button
                  type="submit"
                  className="w-full rounded-2xl bg-[#1e3a5f] py-4 text-base font-bold text-white shadow-lg transition hover:bg-[#152a45] sm:rounded-3xl sm:py-5 sm:text-lg"
                >
                  Register & continue
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
              <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-2">
                  <p className="portal-eyebrow text-slate-500">Dashboard</p>
                  <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
                    Welcome, {activeMember.firstName}
                  </h1>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600 shadow-sm">
                      {portalFlags?.displayRole ?? "Member"}
                    </span>
                    <span className="text-xs font-semibold text-emerald-800">In good standing</span>
                  </div>
                  <p className="font-mono text-sm font-semibold text-slate-700">
                    <span className="text-xs font-sans font-medium text-slate-500">B2C ID </span>
                    <span className="text-blue-700">{activeMember.b2cId}</span>
                  </p>
                  {portalFlags?.officerTitle && (
                    <p className="text-xs font-medium text-slate-500">{portalFlags.officerTitle}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setStep("profile")}
                  className="flex h-12 w-12 shrink-0 items-center justify-center self-end rounded-2xl border border-slate-200 bg-white text-blue-700 shadow-md transition-all hover:bg-slate-50 active:scale-95 sm:self-start"
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

              <PremiumCard dark className="relative mb-8 overflow-hidden border-0 bg-gradient-to-br from-[#1e3a5f] to-[#0f2744] text-white ring-white/10">
                <div className="relative z-10 max-w-lg">
                  <span className="mb-3 inline-block rounded-full bg-white/15 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-blue-100">
                    2026 General Assembly
                  </span>
                  <h2 className="mb-2 text-xl font-bold tracking-tight sm:text-2xl">Election cycle</h2>
                  <p className="mb-6 text-sm font-medium leading-relaxed text-blue-100/90">
                    Current phase:{" "}
                    <span className="font-bold uppercase tracking-wide text-white">{electionStatus}</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (electionStatus === "voting" && activeMember.hasVoted) {
                        setStep("success");
                        return;
                      }
                      setStep(electionStatus === "voting" ? "vote" : "nominate");
                    }}
                    className="rounded-2xl bg-white px-6 py-3.5 text-sm font-bold text-[#1e3a5f] shadow-lg transition-all hover:bg-blue-50 active:scale-[0.99]"
                  >
                    {electionStatus === "voting"
                      ? activeMember.hasVoted
                        ? "View ballot confirmation"
                        : "Cast ballot"
                      : "Manage nominations"}
                  </button>
                </div>
                <Gavel className="pointer-events-none absolute -bottom-10 -right-10 h-48 w-48 rotate-12 text-white/10" aria-hidden />
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

              {electionStatus === "voting" &&
                (portalFlags?.canUseElectionCommitteeControls || portalFlags?.canManageAdmins) &&
                portalFlags?.votingProgress && (
                  <div
                    className={`mb-8 rounded-2xl border-2 px-4 py-4 shadow-sm ${
                      portalFlags.votingProgress.allMembersHaveVoted
                        ? "border-amber-400 bg-amber-50"
                        : "border-slate-200 bg-slate-50/90"
                    }`}
                  >
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                        <Bell size={20} />
                      </div>
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-xs font-black uppercase tracking-widest text-amber-900">
                            {portalFlags.votingProgress.allMembersHaveVoted
                              ? "Full turnout — ready to close polls"
                              : "Voting turnout (committee)"}
                          </p>
                          {portalFlags.canManageAdmins && (
                            <span className="rounded-full bg-amber-900 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-white">
                              Admin
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-semibold text-slate-800">
                          Ballots cast:{" "}
                          <span className="font-black tabular-nums">
                            {portalFlags.votingProgress.ballotsCast} / {portalFlags.votingProgress.totalMembers}
                          </span>{" "}
                          registered members
                        </p>
                        {portalFlags.votingProgress.allMembersHaveVoted ? (
                          <p className="text-xs leading-relaxed text-slate-700">
                            Every registered member has voted. Check the live tallies below, then use{" "}
                            <strong>Close Polls</strong> to end voting and run <strong>Declare results</strong> (same
                            action).
                          </p>
                        ) : (
                          <p className="text-xs leading-relaxed text-slate-600">
                            Counts update as ballots are cast. You may close polls when your rules allow — full turnout
                            is not required.
                          </p>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            document.getElementById("election-live-tally")?.scrollIntoView({ behavior: "smooth" })
                          }
                          className="text-xs font-black uppercase tracking-widest text-amber-800 underline decoration-amber-400 underline-offset-2"
                        >
                          View live vote counts
                        </button>
                      </div>
                    </div>
                  </div>
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
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
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
                            className={`min-h-[3rem] rounded-2xl px-4 py-3 text-left text-xs font-bold uppercase leading-snug shadow-md transition-all sm:min-h-0 sm:p-4 ${
                              canStartVoting
                                ? "bg-slate-900 text-white active:scale-[0.99]"
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
                            className={`min-h-[3rem] rounded-2xl px-4 py-3 text-left text-xs font-bold uppercase leading-snug text-white shadow-md transition-all active:scale-[0.99] sm:min-h-0 sm:p-4 ${
                              portalFlags?.votingProgress?.allMembersHaveVoted
                                ? "bg-red-600 ring-2 ring-amber-400 ring-offset-2"
                                : "bg-red-600"
                            }`}
                            title={
                              portalFlags?.votingProgress?.allMembersHaveVoted
                                ? "Full turnout: close polls and declare winners."
                                : "Close voting and declare official winners."
                            }
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
                    votingProgress={portalFlags?.votingProgress ?? null}
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
                <div id="election-live-tally" className="mb-8 scroll-mt-28 space-y-6">
                  <div className="flex items-center justify-between px-1">
                    <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400">
                      <Trophy size={12} /> {electionStatus === "ended" ? "Official Winners" : "Live Tally"}
                    </h3>
                  </div>
                  {electionStatus === "ended" && (resultsDeclaredAt || resultsVoterStats) && (
                    <div className="space-y-3">
                      {resultsDeclaredAt && (
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
                      {resultsVoterStats && (
                        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                          <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                            Voter participation
                          </p>
                          <p className="text-sm font-semibold text-slate-800">
                            <span className="tabular-nums font-black text-emerald-700">
                              {resultsVoterStats.membersWhoVoted}
                            </span>{" "}
                            of{" "}
                            <span className="tabular-nums font-black text-slate-900">
                              {resultsVoterStats.registeredMembers}
                            </span>{" "}
                            registered members cast a ballot
                            {resultsVoterStats.registeredMembers > 0 && (
                              <span className="ml-2 text-xs font-medium text-slate-500">
                                (
                                {Math.round(
                                  (100 * resultsVoterStats.membersWhoVoted) /
                                    resultsVoterStats.registeredMembers,
                                )}
                                % turnout)
                              </span>
                            )}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                  {COMMITTEES.map((com) => {
                    const raw = nominations.filter((n) => n.position === com && n.status === "accepted");
                    const candidates = dedupeByCandidateIdentity(raw);
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
            <button
              type="button"
              className="mb-2 inline-flex min-h-11 items-center gap-2 rounded-xl px-1 text-sm font-bold text-blue-700 hover:bg-blue-50"
              onClick={() => setStep("dashboard")}
            >
              <ArrowLeft size={16} aria-hidden /> Back
            </button>
            <div className="mb-6 space-y-1">
              <p className="portal-eyebrow text-slate-500">Your profile</p>
              <h1 className="portal-section-title">Contact & identity</h1>
            </div>
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
                    className="portal-input uppercase"
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
                    className="portal-input"
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
                    className="portal-input"
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
                className="w-full rounded-2xl bg-[#1e3a5f] py-4 text-base font-bold text-white shadow-lg transition hover:bg-[#152a45] disabled:opacity-60 sm:rounded-3xl sm:py-5 sm:text-lg"
              >
                {profileSaving ? "Saving..." : "Save changes"}
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
            masterRegistry={registryForVoting}
            onNominationRecorded={(msg) => setNominationNotice(msg)}
          />
        )}

        {step === "vote" && (
          <div className="slide-up space-y-8 pb-36 sm:space-y-10 sm:pb-40">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="portal-eyebrow text-slate-500">Voting</p>
                <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl md:text-4xl">Cast your ballot</h2>
                <p className="mt-1 max-w-md text-sm text-slate-600">Select the required number of candidates per committee.</p>
              </div>
              <button
                type="button"
                onClick={() => setStep("dashboard")}
                className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {COMMITTEES.map((committee) => {
              const candidates = dedupeByCandidateIdentity(
                nominations.filter((n) => n.position === committee && n.status === "accepted"),
              );
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
            <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200/80 bg-white/95 backdrop-blur-md sm:px-6">
              <div className="portal-shell mx-auto max-w-xl pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:max-w-2xl lg:max-w-3xl">
                <button
                  type="button"
                  onClick={handleVoteSubmit}
                  disabled={!COMMITTEES.every((c) => ballot[c].length === COMMITTEE_SEATS[c])}
                  className={`w-full rounded-2xl py-4 text-base font-bold shadow-lg transition-all sm:rounded-3xl sm:py-5 sm:text-lg ${
                    COMMITTEES.every((c) => ballot[c].length === COMMITTEE_SEATS[c])
                      ? "bg-[#0f2744] text-white active:scale-[0.99]"
                      : "cursor-not-allowed bg-slate-300 text-slate-500"
                  }`}
                >
                  Confirm ballot (
                  {Object.values(COMMITTEE_SEATS).reduce((sum, seats) => sum + seats, 0)} selections)
                </button>
              </div>
            </div>
          </div>
        )}

        {step === "success" && (
          <div className="slide-up py-20 text-center">
            <div className="mx-auto mb-8 flex h-24 w-24 items-center justify-center rounded-full bg-emerald-600 text-white shadow-xl shadow-emerald-900/10 motion-safe:animate-bounce">
              <CheckCircle size={40} />
            </div>
            <p className="portal-eyebrow mb-2 text-emerald-800">Confirmation</p>
            <h2 className="mb-4 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">Ballot recorded</h2>
            {voteConfirmation && (
              <div className="mx-auto mb-6 max-w-sm rounded-2xl border border-emerald-200 bg-emerald-50/80 px-5 py-4 text-left shadow-sm">
                <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-emerald-800">Confirmation</p>
                <p className="text-sm font-bold text-slate-800">
                  {voteConfirmation.votesRecorded} selections recorded
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  Server time:{" "}
                  <span className="font-semibold text-slate-800">
                    {new Date(voteConfirmation.recordedAt).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </span>
                </p>
              </div>
            )}
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
