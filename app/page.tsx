import Link from "next/link";
import { Check, ArrowRight, X, TrendingUp, Shield, Zap } from "lucide-react";
import InstructionSteps from "@/components/demo-screen/InstructionSteps";
import DemoSection from "@/components/demo-screen/DemoSection";
import NavBar from "@/components/demo-screen/NavBar";
import FAQ from "@/components/demo-screen/FAQ";

const COMPANY_NAME = "{SOLUTION}";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gray-50 text-slate-800 font-sans selection:bg-emerald-500 selection:text-white">
      {/* Navbar */}
      <NavBar />

      {/* Hero Section */}
      <section className="max-w-4xl mx-auto text-center text-black-800 pt-20 pb-16 px-4">
        <div className="inline-block bg-emerald-500/10 text-emerald-400 px-4 py-1.5 rounded-full text-sm font-medium mb-6 border border-emerald-500/20">
          Made for Modern Investors
        </div>
        <h1 className="text-5xl md:text-7xl font-extrabold text-slate-700 tracking-tight mb-6">
          Stop guessing. <br className="hidden md:block" />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-500 to-emerald-500">
            Let AI analyze your portfolio.
          </span>
        </h1>
        <p className="text-xl text-slate-400 mb-10 max-w-2xl mx-auto">
          Connect your brokerage, and get institutional-grade financial
          analysis, risk assessment, and tax harvesting strategies in 30
          seconds.
        </p>
        <div className="flex flex-col sm:flex-row justify-center gap-4">
          <Link
            href="/register"
            className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-4 px-8 rounded-xl flex items-center justify-center gap-2 transition-all transform hover:scale-105"
          >
            Start Free Trial <ArrowRight size={20} />
          </Link>
        </div>

        {/* Validation / Social Proof */}
        {/* <div className="mt-12 flex flex-col items-center gap-3">
          <div className="flex -space-x-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <img key={i} src={`https://i.pravatar.cc/100?img=${i + 10}`} alt="User" className="w-10 h-10 rounded-full border-2 border-[#0B0F19]" />
            ))}
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <div className="flex text-yellow-400"><Star size={16} fill="currentColor" /><Star size={16} fill="currentColor" /><Star size={16} fill="currentColor" /><Star size={16} fill="currentColor" /><Star size={16} fill="currentColor" /></div>
            <span>Trusted by 2,400+ investors</span>
          </div>
        </div> */}
      </section>

      {/* Problem vs Solution (The ZenVoice Style) */}
      <section className="max-w-5xl mx-auto px-4 py-20">
        <h2 className="text-3xl font-bold text-center text-slate-700 mb-12">
          Why spend hours in spreadsheets?
        </h2>
        <div className="grid md:grid-cols-2 gap-8">
          {/* Problem */}
          <div className="bg-red-500/5 border border-red-500/20 rounded-3xl p-8">
            <h3 className="text-xl font-bold text-slate-700 mb-6 flex items-center gap-2">
              <X className="text-red-500" /> The Old Way
            </h3>
            <ul className="space-y-4 text-slate-400">
              <li className="flex items-start gap-3">
                <X className="text-red-500 shrink-0 mt-1" size={18} /> Pay a
                wealth manager 1% AUM
              </li>
              <li className="flex items-start gap-3">
                <X className="text-red-500 shrink-0 mt-1" size={18} /> Waste
                weekends analyzing P&L
              </li>
              <li className="flex items-start gap-3">
                <X className="text-red-500 shrink-0 mt-1" size={18} /> Miss out
                on tax-loss harvesting
              </li>
              <li className="flex items-start gap-3">
                <X className="text-red-500 shrink-0 mt-1" size={18} /> Emotional
                trading decisions
              </li>
            </ul>
          </div>
          {/* Solution */}
          <div className="bg-emerald-500/5 border border-emerald-500/30 rounded-3xl p-8 relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-emerald-500 text-slate-700 text-xs font-bold px-3 py-1 rounded-bl-lg">
              {COMPANY_NAME}
            </div>
            <h3 className="text-xl font-bold text-slate-700 mb-6 flex items-center gap-2">
              <Check className="text-emerald-500" /> The New Way
            </h3>
            <ul className="space-y-4 text-slate-500">
              <li className="flex items-start gap-3">
                <Check className="text-emerald-500 shrink-0 mt-1" size={18} />{" "}
                Flat $15/mo. No AUM fees.
              </li>
              <li className="flex items-start gap-3">
                <Check className="text-emerald-500 shrink-0 mt-1" size={18} />{" "}
                Instant automated risk reports
              </li>
              <li className="flex items-start gap-3">
                <Check className="text-emerald-500 shrink-0 mt-1" size={18} />{" "}
                AI detects tax harvesting setups
              </li>
              <li className="flex items-start gap-3">
                <Check className="text-emerald-500 shrink-0 mt-1" size={18} />{" "}
                Data-driven, emotionless insights
              </li>
            </ul>
          </div>
        </div>
      </section>

      <InstructionSteps />
      <DemoSection />

      {/* Market (Who is this for) */}
      <section className="bg-gray-200 py-20">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold text-white-700 mb-10">
            Built for self-directed investors
          </h2>
          <div className="grid sm:grid-cols-3 gap-6">
            <div className="p-6 rounded-xl border border-slate-800">
              <TrendingUp className="text-emerald-400 mb-4 mx-auto" />
              <h3 className="font-bold text-slate-700 mb-2">Retail Traders</h3>
              <p className="text-sm text-slate-400">
                Stop trading blind. Get quant-level data.
              </p>
            </div>
            <div className="p-6 rounded-xl border border-slate-800">
              <Shield className="text-emerald-400 mb-4 mx-auto" />
              <h3 className="font-bold text-slate-700 mb-2">
                Long-term Holders
              </h3>
              <p className="text-sm text-slate-400">
                Optimize ETF overlaps and reduce risk.
              </p>
            </div>
            <div className="p-6 rounded-xl border border-slate-800">
              <Zap className="text-emerald-400 mb-4 mx-auto" />
              <h3 className="font-bold text-slate-700 mb-2">
                Crypto Investors
              </h3>
              <p className="text-sm text-slate-400">
                Track DeFi yield and impermanent loss.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section
        id="pricing"
        className="max-w-4xl mx-auto px-4 py-24 text-center"
      >
        <h2 className="text-4xl font-bold text-slate-700 mb-4">
          Pricing that makes sense
        </h2>
        <p className="text-slate-400 mb-12">
          Cancel anytime. Cheaper than a single bad trade.
        </p>

        <div className="bg-white max-w-md mx-auto rounded-3xl border border-emerald-500/30 p-8 shadow-2xl shadow-emerald-500/10">
          <h3 className="text-2xl font-bold text-slate-700 mb-2">Pro Plan</h3>
          <div className="flex justify-center items-baseline gap-1 mb-6">
            <span className="text-5xl font-extrabold text-slate-700">$15</span>
            <span className="text-slate-400">/mo</span>
          </div>
          <ul className="space-y-4 text-left mb-8">
            <li className="flex items-center gap-3 text-slate-700">
              <Check className="text-emerald-500" size={20} /> Unlimited AI
              portfolio scans
            </li>
            <li className="flex items-center gap-3 text-slate-700">
              <Check className="text-emerald-500" size={20} /> Tax-loss
              harvesting alerts
            </li>
            <li className="flex items-center gap-3 text-slate-700">
              <Check className="text-emerald-500" size={20} /> Connect up to 5
              brokerages
            </li>
          </ul>
          <Link
            href="/register"
            className="block w-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-4 rounded-xl transition"
          >
            Get {COMPANY_NAME} Now
          </Link>
        </div>
      </section>

      {/* FAQ & Roadmap */}
      <FAQ />

      {/* Team */}
      <section className="py-20 text-center">
        <h2 className="text-3xl font-bold text-slate-700 mb-8">
          Brought to you by
        </h2>
        <div className="flex justify-center gap-8">
          <div className="text-center">
            <img
              src="https://i.pravatar.cc/150?img=11"
              alt="Team"
              className="w-20 h-20 rounded-full mx-auto mb-3 grayscale hover:grayscale-0 transition"
            />
            <h4 className="font-bold text-slate-700">Test</h4>
            <p className="text-sm text-slate-400">
              M.Sc. in Computer Science @ETHZ
            </p>
          </div>
          <div className="text-center">
            <img
              src="https://i.pravatar.cc/150?img=11"
              alt="Team"
              className="w-20 h-20 rounded-full mx-auto mb-3 grayscale hover:grayscale-0 transition"
            />
            <h4 className="font-bold text-slate-700">Testiosky</h4>
            <p className="text-sm text-slate-400">
              M.Sc. in Computer Science, @ETHZ
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-8 text-center text-slate-500 text-sm">
        <p>© 2026 {COMPANY_NAME}. Built with ❤️ for the Start Hack 2026.</p>
      </footer>
    </div>
  );
}

// A local icon helper if lucide chevron isn't importing correctly
function ChevronDown(props: any) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
