"use client";

import { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";


export default function KeyModal() {
  const [isOpen, setIsOpen] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  const KEY_TO_PRESS = "D";
  const LEARN_WORD = "dispute";

  useEffect(() => {
    // Handle Keyboard Events
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }

      if (e.key.toLowerCase() === "d" && !isOpen) {
        setIsOpen(true);
      }

      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };

    // Handle Mouse Events (Click Outside)
    const handleClickOutside = (e: MouseEvent) => {
      if (isOpen && modalRef.current && !modalRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mousedown", handleClickOutside);
    
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  return (
    <>
      {/* Floating Desktop Hint */}
      <div className="hidden md:flex fixed bottom-6 right-6 z-40">
        <div className="bg-sand-900/90 backdrop-blur-sm border border-slate-800 text-slate-700 text-md py-3 px-4 rounded-sm shadow-lg flex items-center gap-2">
          Press <kbd className="border-slate-800 text-emerald-400 px-2 py-0.5 rounded font-mono text-xs border border-slate-700">{KEY_TO_PRESS}</kbd> to learn about {LEARN_WORD}
        </div>
      </div>

      {/* Modal Overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-base/60 backdrop-blur-sm transition-opacity">
          <div 
            ref={modalRef}
            className="relative w-full max-w-lg bg-slate-700 border border-slate-800 rounded-xl shadow-2xl p-6 md:p-8 animate-in fade-in zoom-in duration-200"
            role="dialog"
            aria-modal="true"
          >
            {/* Close Button */}
            <button
              onClick={() => setIsOpen(false)}
              className="absolute top-4 right-4 text-white hover:text-white hover:cursor-pointer transition-colors p-1 bg-grey-400"
              aria-label="Close"
            >
              <X size={24} />
            </button>
            
            <h2 className="text-2xl font-bold text-white mb-6">
              What is a {LEARN_WORD}?
            </h2>
            
            <div className="space-y-4 text-slate-100 leading-relaxed text-sm md:text-base">
              <p>
                A {LEARN_WORD}  (or chargeback) occurs when your customer tells their bank they didn't make/authorize the payment on your site.
              </p>
              <p>
                The payment amount + $15 {LEARN_WORD} fee (+ $15 to counter the {LEARN_WORD}) is deducted from your Stripe account.
              </p>
              <p>
                There is a {LEARN_WORD} resolution process through which you have to prove the payment was valid. A {LEARN_WORD} rate above 0.75% is punishable.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
