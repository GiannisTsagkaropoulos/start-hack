import Link from "next/link";
import { Check, ArrowRight, X, ShieldCheck, Zap, Search } from "lucide-react";
import InstructionSteps from "@/components/demo-screen/InstructionSteps";
import DemoSection from "@/components/demo-screen/DemoSection";
import NavBar from "@/components/demo-screen/NavBar";
import FAQ from "@/components/demo-screen/FAQ";

const COMPANY_NAME = "Leash";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-void text-ink-0 font-sans ">
      <NavBar />

      {/* Hero */}
      <section className="max-w-4xl mx-auto text-center pt-20 pb-16 px-4">
        <div className="inline-block bg-authority-dim text-authority-strong px-4 py-1.5 rounded-full text-sm font-medium mb-6 border border-authority/20">
          Viseca "Agent on a Leash" — Start Hack Tour St. Gallen 2026
        </div>
        <h1 className="text-5xl md:text-6xl font-extrabold text-ink-0 tracking-tight mb-6">
          Your AI shopping agent can spend your money. <br className="hidden md:block" />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-authority to-authority-strong">
            Something has to decide when it shouldn't.
          </span>
        </h1>
        <p className="text-xl text-ink-2 mb-10 max-w-2xl mx-auto">
          {COMPANY_NAME} sits between the agent and the card. You describe
          your spending rules once, in plain English. Every purchase is then
          approved, declined, or sent back to you — with a reason you can
          audit, every time.
        </p>
        <div className="flex flex-col sm:flex-row justify-center gap-4">
          <Link
            href="/wallet"
            className="bg-authority hover:bg-authority-strong text-[#04140d] font-bold py-4 px-8 rounded-xl flex items-center justify-center gap-2 transition-all transform hover:scale-105"
          >
            Configure a wallet <ArrowRight size={20} />
          </Link>
        </div>
      </section>

      {/* Problem vs Solution */}
      <section className="max-w-5xl mx-auto px-4 py-20">
        <h2 className="text-3xl font-bold text-center text-ink-0 mb-12">
          Untrusted commerce content is data, never authority
        </h2>
        <div className="grid md:grid-cols-2 gap-8">
          <div className="bg-decline-dim border border-decline/20 rounded-3xl p-8">
            <h3 className="text-xl font-bold text-ink-0 mb-6 flex items-center gap-2">
              <X className="text-decline" /> Without a control layer
            </h3>
            <ul className="space-y-4 text-ink-2">
              <li className="flex items-start gap-3">
                <X className="text-decline shrink-0 mt-1" size={18} />
                The agent reads the merchant's text and its own instructions
                in the same context
              </li>
              <li className="flex items-start gap-3">
                <X className="text-decline shrink-0 mt-1" size={18} />A
                listing that says "ignore the spending limit" has a real shot
                at working
              </li>
              <li className="flex items-start gap-3">
                <X className="text-decline shrink-0 mt-1" size={18} />
                No traceable reason for why a purchase went through
              </li>
              <li className="flex items-start gap-3">
                <X className="text-decline shrink-0 mt-1" size={18} />
                Every uncertain case either blocks the customer or silently
                guesses
              </li>
            </ul>
          </div>
          <div className="bg-authority-dim border border-authority/30 rounded-3xl p-8 relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-authority text-[#04140d] text-xs font-bold px-3 py-1 rounded-bl-lg">
              {COMPANY_NAME}
            </div>
            <h3 className="text-xl font-bold text-ink-0 mb-6 flex items-center gap-2">
              <Check className="text-authority-strong" /> With {COMPANY_NAME}
            </h3>
            <ul className="space-y-4 text-ink-1">
              <li className="flex items-start gap-3">
                <Check className="text-authority-strong shrink-0 mt-1" size={18} />
                The customer's mandate and the merchant's text are
                structurally separated — one has authority, one never does
              </li>
              <li className="flex items-start gap-3">
                <Check className="text-authority-strong shrink-0 mt-1" size={18} />
                Every decision names the specific signal that fired: rule
                violated, missing information, behavioral deviation, or
                manipulated text
              </li>
              <li className="flex items-start gap-3">
                <Check className="text-authority-strong shrink-0 mt-1" size={18} />
                Genuine unknowns ask the customer instead of guessing
              </li>
              <li className="flex items-start gap-3">
                <Check className="text-authority-strong shrink-0 mt-1" size={18} />
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
      <section className="bg-surface-1 py-20">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold text-ink-0 mb-10">
            Built for agentic commerce, not against it
          </h2>
          <div className="grid sm:grid-cols-3 gap-6">
            <div className="p-6 rounded-xl border border-border-hairline bg-white/[0.03]">
              <ShieldCheck className="text-authority-strong mb-4 mx-auto" />
              <h3 className="font-bold text-ink-0 mb-2">Customers</h3>
              <p className="text-sm text-ink-2">
                Set the rule once. Stop reviewing every purchase your agent
                makes.
              </p>
            </div>
            <div className="p-6 rounded-xl border border-border-hairline bg-white/[0.03]">
              <Search className="text-authority-strong mb-4 mx-auto" />
              <h3 className="font-bold text-ink-0 mb-2">
                Compliance teams
              </h3>
              <p className="text-sm text-ink-2">
                Every decision traces to a named, auditable reason — not a
                black-box score.
              </p>
            </div>
            <div className="p-6 rounded-xl border border-border-hairline bg-white/[0.03]">
              <Zap className="text-authority-strong mb-4 mx-auto" />
              <h3 className="font-bold text-ink-0 mb-2">
                Card issuers
              </h3>
              <p className="text-sm text-ink-2">
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
        <h2 className="text-3xl font-bold text-ink-0 mb-2">
          Team round up
        </h2>
        <p className="text-sm text-ink-3 mb-8">
          Start Hack Tour St. Gallen 2026 — Viseca case
        </p>
        <div className="flex flex-wrap justify-center gap-8">
          {[
            { name: "Yorian Melki", role: "Team lead" },
            { name: "Giannis Tsagkaropoulos", role: "Frontend" },
            { name: "Florian Gedeon", role: "Backend & security" },
            { name: "Jafar Sadig", role: "Mandate generation" },
          ].map((member) => (
            <div key={member.name} className="text-center w-32">
              <div className="w-16 h-16 rounded-full mx-auto mb-3 bg-surface-2 text-white flex items-center justify-center text-lg font-bold">
                {member.name
                  .split(" ")
                  .map((n) => n[0])
                  .join("")}
              </div>
              <h4 className="font-bold text-ink-0 text-sm">
                {member.name}
              </h4>
              <p className="text-xs text-ink-3">{member.role}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border-hairline py-8 text-center text-ink-2 text-sm">
        <p>Built for Start Hack Tour St. Gallen 2026 — team round up.</p>
      </footer>
    </div>
  );
}
