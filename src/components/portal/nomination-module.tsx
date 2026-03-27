"use client";

import { useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  Gavel,
  Users,
  X,
} from "lucide-react";

import { PremiumCard } from "./premium-card";
import type { PortalNomination, RegistryMember } from "./types";

const COMMITTEES = ["Board of Director", "Audit Committee", "Election Committee"];

type MotionState = { stage: string; moverId: string | null };

type NominationModuleProps = {
  activeMember: RegistryMember & { b2cId: string };
  nominations: PortalNomination[];
  onNominate: (m: RegistryMember, pos: string) => boolean | Promise<boolean>;
  lockedPositions: string[];
  electionStatus: string;
  motions: Record<string, MotionState>;
  onMotionUpdate: (pos: string, stage: string, mover: string) => void;
  onObjection: (pos: string) => void;
  onLock: (pos: string) => void;
  onFinish: () => void;
  initialTarget?: string | null;
  masterRegistry: RegistryMember[];
};

export function NominationModule({
  activeMember,
  nominations,
  onNominate,
  lockedPositions,
  electionStatus,
  motions,
  onMotionUpdate,
  onObjection,
  onLock,
  onFinish,
  initialTarget = null,
  masterRegistry,
}: NominationModuleProps) {
  const [view, setView] = useState<"committees" | "detail">(initialTarget ? "detail" : "committees");
  const [targetPos, setTargetPos] = useState<string | null>(initialTarget);
  const [selectedTinNo, setSelectedTinNo] = useState("");
  const [selectedMember, setSelectedMember] = useState<RegistryMember | null>(null);

  const currentNominees = nominations.filter((n) => n.position === targetPos);
  const currentMotion = targetPos ? motions[targetPos] || { stage: "none", moverId: null } : { stage: "none", moverId: null };
  const isMover = currentMotion.moverId === activeMember.b2cId;
  const isLocked =
    targetPos != null && (lockedPositions.includes(targetPos) || electionStatus !== "nomination");

  if (view === "committees" || !targetPos) {
    return (
      <div className="slide-up space-y-6">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-3xl font-extrabold text-slate-900">Nominations</h2>
          <button
            type="button"
            onClick={onFinish}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400"
            aria-label="Close"
          >
            <X />
          </button>
        </div>
        <div className="grid gap-4">
          {COMMITTEES.map((c) => {
            const locked = lockedPositions.includes(c) || electionStatus !== "nomination";
            const count = nominations.filter((n) => n.position === c).length;
            const motionActive = (motions[c]?.stage ?? "none") !== "none";

            return (
              <PremiumCard
                key={c}
                onClick={() => {
                  setTargetPos(c);
                  setView("detail");
                }}
                className={locked ? "opacity-60 grayscale" : "hover:border-blue-400"}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">{c}</h3>
                    <div className="mt-1 flex items-center gap-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        {locked ? "Registry Locked" : `${count} Nominees Recorded`}
                      </p>
                      {motionActive && !locked && (
                        <span className="animate-pulse rounded-full bg-amber-100 px-2 py-0.5 text-[8px] font-black text-amber-700">
                          MOTION ACTIVE
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-slate-300" />
                </div>
              </PremiumCard>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="slide-up space-y-6">
      <button
        type="button"
        onClick={() => setView("committees")}
        className="flex items-center gap-2 text-sm font-bold text-blue-600"
      >
        <ArrowLeft size={16} /> Back to List
      </button>
      <h2 className="text-3xl font-extrabold text-slate-900">{targetPos}</h2>

      <div className="space-y-3">
        {currentNominees.map((n) => (
          <div
            key={n.id}
            className="flex items-center justify-between rounded-2xl border border-slate-100 bg-white p-5 shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-xs font-bold text-blue-600">
                {n.name.charAt(0)}
              </div>
              <span className="font-bold text-slate-900">{n.name}</span>
            </div>
            <span className="rounded bg-emerald-50 px-2 py-1 text-[9px] font-black uppercase tracking-tighter text-emerald-600">
              {n.status === "accepted" ? "Accepted" : "Pending Acceptance"}
            </span>
          </div>
        ))}
      </div>

      {!isLocked && currentMotion.stage !== "none" && (
        <PremiumCard dark className="space-y-4 border-none bg-blue-900 shadow-2xl">
          <h3 className="flex items-center gap-2 text-lg font-black italic">
            <Gavel size={20} /> Active Motion
          </h3>
          {currentMotion.stage === "moved" ? (
            <>
              <p className="text-sm leading-relaxed text-blue-100">
                A motion to <span className="font-bold underline">close nominations</span> has been made for this
                position.
              </p>
              <button
                type="button"
                disabled={isMover}
                onClick={() => onMotionUpdate(targetPos, "seconded", currentMotion.moverId ?? "")}
                className={`w-full rounded-2xl py-4 text-sm font-bold uppercase transition-all ${
                  isMover ? "cursor-not-allowed bg-blue-800 text-blue-400" : "bg-white text-blue-900 shadow-lg"
                }`}
              >
                {isMover ? "Waiting for Second..." : "I Second the Motion"}
              </button>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => onObjection(targetPos)}
                className="rounded-2xl border border-white/20 bg-white/10 py-4 text-xs font-bold uppercase text-red-200"
              >
                I Object
              </button>
              <button
                type="button"
                onClick={() => onLock(targetPos)}
                className="rounded-2xl bg-emerald-500 py-4 text-xs font-bold uppercase text-white shadow-lg shadow-emerald-900/20"
              >
                Close Polls
              </button>
            </div>
          )}
        </PremiumCard>
      )}

      {!isLocked && currentMotion.stage === "none" && !selectedMember && (
        <PremiumCard className="space-y-6">
          <div className="space-y-2">
            <p className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Select from full registry</p>
            <div className="relative">
              <Users className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" size={20} />
              <select
                value={selectedTinNo}
                onChange={(e) => {
                  const tin = e.target.value;
                  setSelectedTinNo(tin);
                  const picked = masterRegistry.find((m) => m.tinNo === tin);
                  if (picked) setSelectedMember(picked);
                }}
                className="w-full appearance-none rounded-2xl border-2 border-slate-100 bg-slate-50 py-4 pl-12 pr-10 text-sm font-bold text-slate-700 outline-none transition-all focus:border-blue-500 focus:bg-white"
              >
                <option value="">Choose a member...</option>
                {masterRegistry.map((m) => (
                  <option key={m.tinNo} value={m.tinNo}>
                    {m.lastName}, {m.firstName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {currentNominees.length > 0 && (
            <button
              type="button"
              onClick={() => onMotionUpdate(targetPos, "moved", activeMember.b2cId)}
              className="w-full py-2 text-center text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400 transition-colors hover:text-blue-600"
            >
              Move to close nominations
            </button>
          )}
        </PremiumCard>
      )}

      {selectedMember && (
        <div className="slide-up space-y-6">
          <div className="rounded-[2.5rem] border-2 border-blue-100 bg-blue-50/50 p-8 text-center shadow-inner">
            <AlertCircle className="mx-auto mb-4 h-12 w-12 text-blue-600" />
            <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">Confirm Candidate</p>
            <h3 className="text-2xl font-black text-blue-900">
              {selectedMember.firstName} {selectedMember.lastName}
            </h3>
            <p className="mt-3 inline-block rounded-full bg-blue-600 px-4 py-1.5 text-[9px] font-black uppercase tracking-widest text-white">
              {targetPos}
            </p>
          </div>

          <div className="space-y-4">
            <p className="text-center text-[10px] font-black uppercase tracking-widest text-slate-400">
              Would you like to nominate for another position?
            </p>
            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={async () => {
                  const ok = await onNominate(selectedMember, targetPos);
                  if (!ok) return;
                  setSelectedTinNo("");
                  setSelectedMember(null);
                  setView("committees");
                }}
                className="rounded-3xl border-2 border-blue-600 bg-white py-5 text-xs font-black uppercase text-blue-600"
              >
                Yes, another
              </button>
              <button
                type="button"
                onClick={async () => {
                  const ok = await onNominate(selectedMember, targetPos);
                  if (!ok) return;
                  setSelectedTinNo("");
                  onFinish();
                }}
                className="rounded-3xl bg-blue-600 py-5 text-xs font-black uppercase text-white shadow-xl shadow-blue-200"
              >
                No, finish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
