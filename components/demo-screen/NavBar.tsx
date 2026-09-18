"use client";
import Link from "next/link";

export default function NavBar() {
  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });

    if (window.location.hash) {
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }
  };
  const COMPANY_NAME = "{SOLUTION}";

  return (
    <nav className="sticky z-100 bg-gray-50 top-0 flex justify-between items-center p-6 max-w-6xl mx-auto text-l font-semibold">
      <div className="flex items-center gap-2 font-bold text-xl text-slate-700">
        <button
          onClick={scrollToTop}
          aria-label="Scroll to top"
          className="hover:cursor-pointer"
        >
          {COMPANY_NAME}
        </button>
      </div>
      <div className="flex gap-4 items-center">
        <Link href="#pricing" className="hover:underline">
          Pricing
        </Link>
        <Link href="#faq" className="hover:underline">
          FAQ
        </Link>
        <Link href="/login" className="hover:underline">
          Login
        </Link>
      </div>
    </nav>
  );
}
