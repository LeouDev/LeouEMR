"use client";

import { useId, useState } from "react";
import { MAX_MATCHES, countMatches, matchAgents, type AgentOption } from "@/lib/quality/agent-search";

/**
 * A search box that picks one agent: type part of a name, employee ID or
 * team leader, arrow through the matches, Enter or click to choose. The
 * chosen agent's name stays in the box; typing again lets it go.
 */
export function AgentSearch({
  agents,
  value,
  onChange,
  classes,
}: {
  agents: readonly AgentOption[];
  /** The chosen agent's id, or "" for none. */
  value: string;
  onChange: (id: string) => void;
  classes: { label: string; control: string };
}) {
  const inputId = useId();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const chosen = agents.find((a) => a.id === value) ?? null;
  const matches = matchAgents(agents, query);
  const total = countMatches(agents, query);
  const showsList = open && chosen === null;

  function pick(agent: AgentOption) {
    onChange(agent.id);
    setQuery("");
    setOpen(false);
  }

  function clear() {
    onChange("");
    setQuery("");
    setOpen(true);
    setActive(0);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (chosen) return;
      setOpen(true);
      setActive((i) => Math.min(matches.length - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === "Enter") {
      if (showsList && matches[active]) {
        event.preventDefault();
        pick(matches[active]);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
    } else if (chosen && event.key.length === 1) {
      // Typing over a chosen name starts a new search from that keystroke.
      onChange("");
      setQuery("");
      setOpen(true);
      setActive(0);
    } else if (chosen && event.key === "Backspace") {
      event.preventDefault();
      clear();
    }
  }

  return (
    <div className="relative">
      <label htmlFor={inputId} className={classes.label}>
        Agent
      </label>
      <div className="relative">
        <input
          id={inputId}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-autocomplete="list"
          aria-expanded={showsList}
          aria-controls={listId}
          aria-activedescendant={showsList && matches[active] ? `${listId}-${matches[active].id}` : undefined}
          placeholder="Search by name, employee ID or team leader…"
          value={chosen ? chosen.name : query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          // Closes after a click on an option has landed (options use mousedown, which fires before blur).
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className={`${classes.control} ${chosen ? "pr-9 font-semibold" : ""}`}
        />
        {chosen && (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear the chosen agent"
            className="absolute inset-y-0 right-0 px-3 text-lg leading-none text-muted transition hover:text-ink"
          >
            ×
          </button>
        )}
      </div>
      {chosen ? (
        <p className="mt-1.5 text-xs text-muted">
          EID {chosen.eid}
          {chosen.supervisorName && ` · Team leader: ${chosen.supervisorName}`}
        </p>
      ) : (
        <p className="mt-1.5 text-xs text-muted">
          {agents.length} {agents.length === 1 ? "agent" : "agents"} you can audit.
        </p>
      )}
      {showsList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching agents"
          className="absolute left-0 right-0 z-20 mt-1 max-h-80 overflow-y-auto border-2 border-ink bg-surface shadow-lg"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">No agent matches “{query.trim()}”.</li>
          ) : (
            matches.map((agent, index) => (
              <li
                key={agent.id}
                id={`${listId}-${agent.id}`}
                role="option"
                aria-selected={index === active}
                // mousedown, not click: the input's blur fires between the two and would close the list first.
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(agent);
                }}
                onMouseEnter={() => setActive(index)}
                className={`cursor-pointer px-3 py-2 text-sm ${index === active ? "bg-ink text-white" : "text-ink"}`}
              >
                <span className="font-semibold">{agent.name}</span>
                <span className={`ml-2 text-xs ${index === active ? "text-white/80" : "text-muted"}`}>
                  {agent.eid}
                  {agent.supervisorName && ` · ${agent.supervisorName}`}
                </span>
              </li>
            ))
          )}
          {total > matches.length && (
            <li className="border-t border-line px-3 py-1.5 text-xs text-muted">
              Showing {MAX_MATCHES} of {total} — keep typing to narrow it down.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
