import Link from "next/link";
import { Check, ArrowRight, X, ShieldCheck, Zap, Search } from "lucide-react";
import InstructionSteps from "@/components/demo-screen/InstructionSteps";
import DemoSection from "@/components/demo-screen/DemoSection";
import NavBar from "@/components/demo-screen/NavBar";
import FAQ from "@/components/demo-screen/FAQ";

const COMPANY_NAME = "Leash";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gray-50 text-slate-800 font-sans selection:bg-emerald-500 selection:text-white">
      <NavBar />

      {/* Hero */}
      <section className="max-w-4xl mx-auto text-center pt-20 pb-16 px-4">
        <div className="inline-block bg-emerald-500/10 text-emerald-600 px-4 py-1.5 rounded-full text-sm font-medium mb-6 border border-emerald-500/20">
          Viseca "Agent on a Leash" — Start Hack Tour St. Gallen 2026
        </div>
        <h1 className="text-5xl md:text-6xl font-extrabold text-slate-700 tracking-tight mb-6">
          Your AI shopping agent can spend your money. <br className="hidden md:block" />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-500 to-emerald-500">
            Something has to decide when it shouldn't.
          </span>
        </h1>
        <p className="text-xl text-slate-500 mb-10 max-w-2xl mx-auto">
          {COMPANY_NAME} sits between the agent and the card. You describe
          your spending rules once, in plain English. Every purchase is then
          approved, declined, or sent back to you — with a reason you can
          audit, every time.
        </p>
        <div className="flex flex-col sm:flex-row justify-center gap-4">
          <Link
            href="/wallet"
            className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-4 px-8 rounded-xl flex items-center justify-center gap-2 transition-all transform hover:scale-105"
          >
            Configure a wallet <ArrowRight size={20} />
          </Link>
        </div>
      </section>

      {/* Problem vs Solution */}
      <section className="max-w-5xl mx-auto px-4 py-20">
        <h2 className="text-3xl font-bold text-center text-slate-700 mb-12">
          Untrusted commerce content is data, never authority
        </h2>
        <div className="grid md:grid-cols-2 gap-8">
          <div className="bg-red-500/5 border border-red-500/20 rounded-3xl p-8">
            <h3 className="text-xl font-bold text-slate-700 mb-6 flex items-center gap-2">
              <X className="text-red-500" /> Without a control layer
            </h3>
            <ul className="space-y-4 text-slate-500">
              <li className="flex items-start gap-3">
                <X className="text-red-500 shrink-0 mt-1" size={18} />
                The agent reads the merchant's text and its own instructions
                in the same context
              </li>
              <li className="flex items-start gap-3">
                <X className="text-red-500 shrink-0 mt-1" size={18} />A
                listing that says "ignore the spending limit" has a real shot
                at working
              </li>
              <li className="flex items-start gap-3">
                <X className="text-red-500 shrink-0 mt-1" size={18} />
                No traceable reason for why a purchase went through
              </li>
              <li className="flex items-start gap-3">
                <X className="text-red-500 shrink-0 mt-1" size={18} />
                Every uncertain case either blocks the customer or silently
                guesses
              </li>
            </ul>
          </div>
          <div className="bg-emerald-500/5 border border-emerald-500/30 rounded-3xl p-8 relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-emerald-500 text-white text-xs font-bold px-3 py-1 rounded-bl-lg">
              {COMPANY_NAME}
            </div>
            <h3 className="text-xl font-bold text-slate-700 mb-6 flex items-center gap-2">
              <Check className="text-emerald-500" /> With {COMPANY_NAME}
            </h3>
            <ul className="space-y-4 text-slate-600">
              <li className="flex items-start gap-3">
                <Check className="text-emerald-500 shrink-0 mt-1" size={18} />
                The customer's mandate and the merchant's text are
                structurally separated — one has authority, one never does
              </li>
              <li className="flex items-start gap-3">
                <Check className="text-emerald-500 shrink-0 mt-1" size={18} />
                Every decision names the specific signal that fired: rule
                violated, missing information, behavioral deviation, or
                manipulated text
              </li>
              <li className="flex items-start gap-3">
                <Check className="text-emerald-500 shrink-0 mt-1" size={18} />
                Genuine unknowns ask the customer instead of guessing
              </li>
              <li className="flex items-start gap-3">
                <Check className="text-emerald-500 shrink-0 mt-1" size={18} />
                Clear purchases go through instantly — the customer never
                notices the good case
              </li>
            </ul>
          </div>
        </div>
      </section>

      <InstructionSteps />
      <DemoSection />

      {/* Who this is for */}
      <section className="bg-gray-200 py-20">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold text-slate-700 mb-10">
            Built for agentic commerce, not against it
          </h2>
          <div className="grid sm:grid-cols-3 gap-6">
            <div className="p-6 rounded-xl border border-slate-300 bg-white/50">
              <ShieldCheck className="text-emerald-500 mb-4 mx-auto" />
              <h3 className="font-bold text-slate-700 mb-2">Customers</h3>
              <p className="text-sm text-slate-500">
                Set the rule once. Stop reviewing every purchase your agent
                makes.
              </p>
            </div>
            <div className="p-6 rounded-xl border border-slate-300 bg-white/50">
              <Search className="text-emerald-500 mb-4 mx-auto" />
              <h3 className="font-bold text-slate-700 mb-2">
                Compliance teams
              </h3>
              <p className="text-sm text-slate-500">
                Every decision traces to a named, auditable reason — not a
                black-box score.
              </p>
            </div>
            <div className="p-6 rounded-xl border border-slate-300 bg-white/50">
              <Zap className="text-emerald-500 mb-4 mx-auto" />
              <h3 className="font-bold text-slate-700 mb-2">
                Card issuers
              </h3>
              <p className="text-sm text-slate-500">
                A decision layer that sits in front of agentic spend, built
                on the mandate lifecycle the API already exposes.
              </p>
            </div>
          </div>
        </div>
      </section>

      <FAQ />

      {/* Team */}
      <section className="py-20 text-center">
        <h2 className="text-3xl font-bold text-slate-700 mb-2">
          Team round up
        </h2>
        <p className="text-sm text-slate-400 mb-8">
          Start Hack Tour St. Gallen 2026 — Viseca case
        </p>
        <div className="flex flex-wrap justify-center gap-8">
          {[
            { name: "Yorian Melki", role: "Team lead" },
            { name: "Giannis Tsagkaropoulos", role: "Frontend" },
            { name: "Florian Gedeon", role: "Backend & security" },
            { name: "Jafar Hack", role: "Mandate generation" },
          ].map((member) => (
            <div key={member.name} className="text-center w-32">
              <div className="w-16 h-16 rounded-full mx-auto mb-3 bg-slate-800 text-white flex items-center justify-center text-lg font-bold">
                {member.name
                  .split(" ")
                  .map((n) => n[0])
                  .join("")}
              </div>
              <h4 className="font-bold text-slate-700 text-sm">
                {member.name}
              </h4>
              <p className="text-xs text-slate-400">{member.role}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-slate-300 py-8 text-center text-slate-500 text-sm">
        <p>Built for Start Hack Tour St. Gallen 2026 — team round up.</p>
      </footer>
    </div>
  );
}
