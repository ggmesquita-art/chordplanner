import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const REPO = "https://github.com/ggmesquita-art/chordplanner";

type LinkItem = { href: string; label: string; detail: string; icon: React.ReactNode };

const svg = (path: React.ReactNode) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {path}
  </svg>
);

const LINKS: LinkItem[] = [
  {
    href: "mailto:ggmesquita@gmail.com",
    label: "Contato",
    detail: "ggmesquita@gmail.com",
    icon: svg(
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 7 9 6 9-6" />
      </>,
    ),
  },
  {
    href: REPO,
    label: "Código-fonte",
    detail: "github.com/ggmesquita-art/chordplanner",
    icon: svg(<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />),
  },
  {
    href: "https://linktr.ee/themesquita",
    label: "Links",
    detail: "linktr.ee/themesquita",
    icon: svg(
      <>
        <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
        <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
      </>,
    ),
  },
  {
    href: "https://soundcloud.com/themesquita",
    label: "Músicas",
    detail: "soundcloud.com/themesquita",
    icon: svg(<path d="M3 15v2M6 12v5M9 10v7M12 8v9M15 7.5c3.5 0 6 1.8 6 4.75S18.5 17 15 17" />),
  },
];

/** Janela "About": o app e o criador. */
function AboutDialog({ onClose }: { onClose: () => void }) {
  const closeBtn = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      close.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal about" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={(e) => e.stopPropagation()}>
        <button ref={closeBtn} className="icon-btn about-close" onClick={onClose} aria-label="Fechar">
          ✕
        </button>
        <div className="about-hero">
          <img className="about-icon" src="icons/icon-192.png" alt="" width={64} height={64} />
          <div>
            <h3 id="about-title" className="logo about-name">
              Chord<span>Planner</span>
            </h3>
            <p className="muted small">Planejador de progressões de acordes guiado por escala.</p>
          </div>
        </div>

        <div className="about-creator">
          <span className="about-kicker">Criado por</span>
          <strong className="about-person">Guilherme Mesquita</strong>
          <span className="about-alias">THE MESQUITA DJ</span>
        </div>

        <ul className="about-links">
          {LINKS.map((l) => (
            <li key={l.href}>
              <a href={l.href} target={l.href.startsWith("mailto:") ? undefined : "_blank"} rel="noopener noreferrer">
                <span className="about-link-icon">{l.icon}</span>
                <span className="about-link-text">
                  <b>{l.label}</b>
                  <span className="muted small">{l.detail}</span>
                </span>
                <span className="about-arrow" aria-hidden="true">
                  ↗
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

/** Botão "About" do cabeçalho. */
export function AboutButton() {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={btn} className="btn about-btn" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label="About" title="About: sobre o ChordPlanner e o criador">
        <span aria-hidden="true">ⓘ</span>
        <span className="about-label" aria-hidden="true">
          {" "}
          About
        </span>
      </button>
      {open && (
        <AboutDialog
          onClose={() => {
            setOpen(false);
            btn.current?.focus();
          }}
        />
      )}
    </>
  );
}
