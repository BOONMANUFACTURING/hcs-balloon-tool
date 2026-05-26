import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

interface ComboInputProps {
  value: string;
  onChange: (val: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
  "data-testid"?: string;
  onEnter?: () => void;
}

export function ComboInput({ value, onChange, options, placeholder, className, "data-testid": testId, onEnter }: ComboInputProps) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = value.trim()
    ? options.filter(o => o.toLowerCase().includes(value.toLowerCase()))
    : options;

  useEffect(() => {
    setHighlighted(0);
  }, [value]);

  // Position dropdown using fixed coords to escape overflow:hidden/scroll parents
  function updateDropdownPosition() {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setDropdownStyle({
      position: "fixed",
      top: rect.bottom + 2,
      left: rect.left,
      width: rect.width,
      zIndex: 9999,
    });
  }

  // Close on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      const inContainer = containerRef.current?.contains(target);
      const inList = listRef.current?.contains(target);
      if (!inContainer && !inList) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // Close on scroll (reposition or close)
  useEffect(() => {
    if (!open) return;
    function onScroll() { updateDropdownPosition(); }
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [open]);

  function pick(opt: string) {
    onChange(opt);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlighted(h => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted(h => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && filtered[highlighted]) {
        pick(filtered[highlighted]);
      } else {
        onEnter?.();
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  // Scroll highlighted item into view
  useEffect(() => {
    if (listRef.current) {
      const item = listRef.current.children[highlighted] as HTMLElement;
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [highlighted]);

  const dropdown = open && filtered.length > 0 ? createPortal(
    <ul
      ref={listRef}
      style={dropdownStyle}
      className="max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-lg"
    >
      {filtered.map((opt, i) => (
        <li
          key={opt}
          onMouseDown={e => { e.preventDefault(); pick(opt); }}
          className={`px-2 py-1.5 text-xs cursor-pointer text-foreground truncate ${
            i === highlighted ? "bg-primary text-primary-foreground" : "hover:bg-accent hover:text-accent-foreground"
          }`}
        >
          {opt}
        </li>
      ))}
    </ul>,
    document.body
  ) : null;

  return (
    <div ref={containerRef} className="relative w-full">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); updateDropdownPosition(); }}
        onFocus={() => { updateDropdownPosition(); setOpen(true); }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        data-testid={testId}
        className={`w-full border border-input bg-background text-foreground rounded-md px-2 text-xs h-8 focus:outline-none focus:ring-1 focus:ring-ring ${className ?? ""}`}
      />
      {dropdown}
    </div>
  );
}
