import { Plus, Minus } from "lucide-react";

export default function FAQ() {
  const faqs = [
    {
      q: "What does the control layer actually decide?",
      a: "For every purchase your AI shopping agent tries to make, it returns one of three outcomes: approve, decline, or step up (ask you directly) — never a silent guess.",
    },
    {
      q: "How do you handle prompt injection from a merchant?",
      a: "A merchant's product description is only ever mined for facts, never treated as an instruction. If a listing says \"ignore the spending limit,\" that text has no path to changing what's authorized — the rules underneath still apply regardless.",
    },
    {
      q: "Why not just have an LLM decide every purchase?",
      a: "Latency and auditability. The deterministic checks run in under a millisecond and every decision traces to a named reason a compliance team could point to — an LLM call on the hot path risks both.",
    },
    {
      q: "Why not just use fixed rules with no AI at all?",
      a: "Because a rule engine can't read \"buy me running shoes under 200\" — turning a customer's sentence into a structured policy is a real language-understanding step, and it's one of the two jobs this case actually asks for.",
    },
    {
      q: "What happens when something is genuinely unclear?",
      a: "We ask, rather than guess. If a fact we need to check your policy is missing from the purchase, the agent gets a step-up request instead of a silent approve or decline.",
    },
    {
      q: "What don't you claim?",
      a: "We don't call any result \"accuracy\" — there's no official answer key for this dataset. We report what resolves without escalation, and we say plainly where a gap (like a swapped product with the same category) is still open.",
    },
  ];

  return (
    <section
      id="faq"
      className="max-w-6xl mx-auto px-4 py-24 border-t border-border-hairline"
    >
      <div className="grid md:grid-cols-12 gap-12 items-start">
        <div className="md:col-span-5 md:sticky md:top-24">
          <span className="text-authority-strong font-bold uppercase tracking-wider text-sm mb-3 block">
            FAQ
          </span>
          <h2 className="text-4xl md:text-5xl font-extrabold text-ink-0 tracking-tight leading-tight">
            Frequently Asked Questions
          </h2>
        </div>

        <div className="md:col-span-7 divide-y divide-slate-800 border-t border-b border-border-hairline">
          {faqs.map((faq, i) => (
            <details
              key={i}
              className="group py-6 [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex cursor-pointer items-center justify-between font-semibold text-lg text-ink-0 list-none group-open:text-authority-strong hover:text-ink-2 transition-colors">
                <span>{faq.q}</span>
                <span className="text-ink-3 group-open:text-authority-strong shrink-0 ml-4">
                  <Plus size={20} className="block group-open:hidden" />
                  <Minus size={20} className="hidden group-open:block" />
                </span>
              </summary>
              <div className="mt-4 text-ink-3 leading-relaxed pr-8 text-sm md:text-base">
                {faq.a}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
