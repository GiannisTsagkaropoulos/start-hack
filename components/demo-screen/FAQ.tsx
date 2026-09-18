import { Plus, Minus } from "lucide-react";

export default function FAQ() {
  const faqs = [
    {
      q: "How does it work?",
      a: "Connect your brokerage or account in seconds, no code needed. FinAI listens for patterns and automatically triggers insights.",
    },
    {
      q: "Is it secure?",
      a: "Yes. We use read-only API access. We cannot move or touch your funds.",
    },
    {
      q: "Do you support my brokerage?",
      a: "We support Robinhood, Fidelity, Charles Schwab, Coinbase, and 10,000+ others via Plaid.",
    },
    {
      q: "Do I need coding skills?",
      a: "No coding skills are required at all. Setup takes less than a minute.",
    },
    {
      q: "What data do you collect?",
      a: "We only access minimal read-only portfolio data required to generate risk analyses and financial reports.",
    },
    {
      q: "Can I still get a dispute?",
      a: "While our system mitigates trading risks and errors, market risks and platform rules still apply.",
    },
    {
      q: "What's on the roadmap?",
      a: "Q3: AI-driven option spread strategies. Q4: Automated tax-document generation.",
    },
  ];

  return (
    <section
      id="faq"
      className="max-w-6xl mx-auto px-4 py-24 border-t border-slate-800"
    >
      {/* Two-column layout on desktop: Left header, right accordions */}
      <div className="grid md:grid-cols-12 gap-12 items-start">
        {/* Left Column: Sticky Title Header */}
        <div className="md:col-span-5 md:sticky md:top-24">
          <span className="text-emerald-400 font-bold uppercase tracking-wider text-sm mb-3 block">
            FAQ
          </span>
          <h2 className="text-4xl md:text-5xl font-extrabold text-slate-800 tracking-tight leading-tight">
            Frequently Asked Questions
          </h2>
        </div>

        {/* Right Column: Accordions List */}
        <div className="md:col-span-7 divide-y divide-slate-800 border-t border-b border-slate-800">
          {faqs.map((faq, i) => (
            <details
              key={i}
              className="group py-6 [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex cursor-pointer items-center justify-between font-semibold text-lg text-slate-800 list-none group-open:text-emerald-400 hover:text-slate-500 transition-colors">
                <span>{faq.q}</span>
                {/* Switches between Plus and Minus icon dynamically when opened */}
                <span className="text-slate-400 group-open:text-emerald-400 shrink-0 ml-4">
                  <Plus size={20} className="block group-open:hidden" />
                  <Minus size={20} className="hidden group-open:block" />
                </span>
              </summary>
              <div className="mt-4 text-slate-400 leading-relaxed pr-8 text-sm md:text-base">
                {faq.a}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
