"use client";

import type { ReactNode } from "react";

type PremiumCardProps = {
  children: ReactNode;
  className?: string;
  dark?: boolean;
  onClick?: () => void;
};

export function PremiumCard({ children, className = "", dark = false, onClick }: PremiumCardProps) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={[
        "rounded-2xl p-5 shadow-[0_1px_0_rgb(0_0_0_/0.03),0_8px_24px_-6px_rgb(15_23_42_/0.08)] ring-1 ring-slate-900/[0.04] transition-[transform,box-shadow] sm:rounded-3xl sm:p-6",
        dark
          ? "bg-gradient-to-br from-[#1e3a5f] to-[#0f2744] text-white ring-white/10 shadow-blue-950/20"
          : "border border-slate-200/80 bg-white text-slate-900",
        onClick ? "cursor-pointer hover:shadow-md active:scale-[0.99]" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}
