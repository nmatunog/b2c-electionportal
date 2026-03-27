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
      className={`
      ${dark ? "bg-blue-700 text-white shadow-blue-200" : "border border-slate-100 bg-white text-slate-900"}
      rounded-[32px] p-6 shadow-xl transition-all ${onClick ? "cursor-pointer active:scale-[0.98]" : ""} ${className}
    `}
    >
      {children}
    </div>
  );
}
