"use client";

import { useState } from "react";
import { Plus, Minus } from "lucide-react";

export default function InstructionSteps() {
  const [activeIndex, setActiveIndex] = useState(0);

  const steps = [
    {
      id: 1,
      title: "Connect and detect instantly",
      description: "Connect your brokerage account in seconds, no code needed. Choose the risk parameters you want to monitor. FinAI listens for market events and triggers your rules when a pattern is detected.",
      gif: "/instructions/gif1.gif"
    },
    {
      id: 2,
      title: "Proactively optimize up to 80% of trades",
      description: "Our LLM scans 10,000+ data points against your portfolio. Receive actionable alerts before the market shifts to secure your positions.",
      gif: "/instructions/gif2.gif"
    },
    {
      id: 3,
      title: "Save taxes and keep your portfolio safe",
      description: "Automatically harvest tax losses and maintain your ideal risk profile without spending weekends staring at spreadsheets.",
      gif: "/instructions/gif3.gif"
    }
  ];

  return (
    <section className="max-w-6xl mx-auto px-4 py-24 border-t border-slate-800">
      <div className="mb-16">
        <p className="text-emerald-400 font-medium mb-3">There's a better way...</p>
        <h2 className="space-y-4 text-4xl md:text-5xl font-extrabold text-slate-700 tracking-tight">
          Automate finances <span className="bg-emerald-500 text-white px-2 py-1 rounded-lg">before you lose money</span>
        </h2>
      </div>

      <div className="grid md:grid-cols-2 gap-12 lg:gap-20 items-start">
        {/* Left Column: Accordion */}
        <div className="flex flex-col w-full">
          {steps.map((step, index) => {
            const isActive = index === activeIndex;
            
            return (
              <div 
                key={step.id} 
                className="border-t border-slate-800 py-6 cursor-pointer group"
                onClick={() => setActiveIndex(index)}
              >
                <div className="flex justify-between items-center w-full">
                  <h3 className={`text-xl font-bold transition-colors duration-200 ${
                    isActive ? "text-emerald-500" : "text-slate-700 group-hover:text-slate-400"
                  }`}>
                    {step.id}. {step.title}
                  </h3>
                  <div className="text-slate-400 ml-4 shrink-0">
                    {isActive ? <Minus size={20} /> : <Plus size={20} />}
                  </div>
                </div>
                
                {/* Accordion Description */}
                <div 
                  className={`overflow-hidden transition-all duration-300 ease-in-out ${
                    isActive ? "max-h-40 opacity-100 mt-4" : "max-h-0 opacity-0"
                  }`}
                >
                  <p className="text-slate-400 leading-relaxed pr-8">
                    {step.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right Column: GIF Display */}
        <div className="relative w-full aspect-[4/3] bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden shadow-2xl shadow-emerald-500/10 flex items-center justify-center">
          {steps.map((step, index) => (
            <img
              key={step.id}
              src={step.gif}
              alt={`Step ${step.id} demonstration`}
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${
                index === activeIndex ? "opacity-100 z-10" : "opacity-0 z-0"
              }`}
            />
          ))}
          {/* Fallback placeholder text in case GIFs aren't loaded yet */}
          <div className="text-slate-600 text-sm absolute z-0">
            Loading {steps[activeIndex].gif}...
          </div>
        </div>
      </div>
    </section>
  );
}